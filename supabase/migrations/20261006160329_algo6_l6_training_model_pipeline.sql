begin;

-- Retain the F4 contract for historical audits, but expose exactly one public
-- canonical readiness authority after this migration.
alter function public.get_algo6_l6_training_readiness_v1() set schema private;
alter function private.get_algo6_l6_training_readiness_v1()
  rename to get_algo6_l6_training_readiness_v1_historical;
revoke all on function private.get_algo6_l6_training_readiness_v1_historical()
  from public, anon, authenticated, service_role;

create table private.algo6_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_version text not null unique,
  status text not null,
  feature_contract_version text not null,
  label_contract_version text not null,
  training_window_start timestamptz not null,
  training_window_end timestamptz not null,
  training_sample_count bigint not null,
  head_metrics jsonb not null,
  model_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid null references auth.users(id) on update restrict on delete set null,
  promoted_at timestamptz null,
  retired_at timestamptz null,
  constraint algo6_model_versions_version_check
    check (model_version = btrim(model_version) and model_version ~ '^algo6-l6-[a-z0-9][a-z0-9._-]{2,95}$'),
  constraint algo6_model_versions_status_check
    check (status in ('candidate','canary','active','rejected','retired')),
  constraint algo6_model_versions_feature_contract_check
    check (feature_contract_version = 'organic-ranking-features-personalization-v2'),
  constraint algo6_model_versions_label_contract_check
    check (label_contract_version = 'algo6-l6-label-contract-v1'),
  constraint algo6_model_versions_window_check
    check (training_window_start < training_window_end),
  constraint algo6_model_versions_sample_check check (training_sample_count > 0),
  constraint algo6_model_versions_metrics_check check (jsonb_typeof(head_metrics) = 'object'),
  constraint algo6_model_versions_payload_check check (
    jsonb_typeof(model_payload) = 'object'
    and jsonb_typeof(model_payload -> 'heads') = 'object'
    and model_payload -> 'heads' ?& array['long_watch','completion','early_exit','rewatch','save','like']
  )
);

create unique index algo6_model_versions_single_active_idx
  on private.algo6_model_versions((status)) where status = 'active';
create unique index algo6_model_versions_single_canary_idx
  on private.algo6_model_versions((status)) where status = 'canary';
create index algo6_model_versions_status_created_idx
  on private.algo6_model_versions(status,created_at desc);

alter table private.algo6_model_versions enable row level security;
alter table private.algo6_model_versions force row level security;
revoke all on table private.algo6_model_versions from public, anon, authenticated, service_role;

alter table private.algo_l1_policy
  add column l6_ml_enabled boolean not null default false,
  add column l6_active_model_id uuid null references private.algo6_model_versions(id) on update restrict on delete restrict,
  add column l6_canary_model_id uuid null references private.algo6_model_versions(id) on update restrict on delete restrict,
  add column l6_objective_version text not null default 'algo6-l6-objective-v1'
    check (l6_objective_version = 'algo6-l6-objective-v1'),
  add column l6_objective_weights jsonb not null default
    '{"long_watch":0.30,"completion":0.20,"early_exit":-0.20,"rewatch":0.10,"save":0.12,"like":0.08}'::jsonb
    check (
      jsonb_typeof(l6_objective_weights) = 'object'
      and l6_objective_weights ?& array['long_watch','completion','early_exit','rewatch','save','like']
      and not jsonb_path_exists(l6_objective_weights,'$.* ? (@.type() != "number")'::jsonpath)
    ),
  add column l6_model_score_weight numeric(12,6) not null default 20
    check (l6_model_score_weight between 0 and 100);

alter table private.algo_l1_policy
  drop constraint algo_l1_policy_canary_target_layer_check;
alter table private.algo_l1_policy
  add constraint algo_l1_policy_canary_target_layer_check
  check (canary_target_layer in ('l1','l2','l3','l4','l5','l6'));

alter table private.organic_ranking_decisions
  drop constraint organic_ranking_decisions_ranking_mode_check;
alter table private.organic_ranking_decisions
  add constraint organic_ranking_decisions_ranking_mode_check
  check (ranking_mode in (
    'chronological','behavioral_l1','behavioral_l2','behavioral_l3',
    'behavioral_l4','behavioral_l5','behavioral_l6'
  ));
alter table private.organic_ranking_decisions
  drop constraint organic_ranking_decisions_canary_target_layer_check;
alter table private.organic_ranking_decisions
  add constraint organic_ranking_decisions_canary_target_layer_check
  check (canary_target_layer in ('l1','l2','l3','l4','l5','l6'));

-- Private, point-in-time-correct final label authority. The early-exit V1
-- threshold is fixed at the approved 0.20; policy drift is a readiness failure.
create function private.algo6_l6_training_rows_v1(
  p_include_features boolean default true
)
returns table(
  impression_client_event_id uuid,
  impression_at timestamptz,
  viewer_user_id uuid,
  video_id uuid,
  creator_id uuid,
  feature_snapshot jsonb,
  valid_retention boolean,
  long_watch_label boolean,
  completion_label boolean,
  early_exit_label boolean,
  rewatch_label boolean,
  like_label boolean,
  save_label boolean,
  follow_label boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with view_events as materialized (
    select
      v.client_event_id,
      1::integer as event_count,
      v.video_id,
      v.viewer_id,
      v.client_session_id,
      v.media_duration_ms,
      v.completion_ratio,
      v.completed,
      v.rewatch_count,
      v.exit_reason
    from public.video_views v
  ),
  final_actions as materialized (
    select distinct on (e.impression_client_event_id, action_family)
      e.impression_client_event_id,
      action_family,
      e.action
    from private.organic_ranking_engagement_events e
    cross join lateral (values (
      case
        when e.action in ('like','unlike') then 'like'
        when e.action in ('save','unsave') then 'save'
        when e.action in ('follow','unfollow') then 'follow'
      end
    )) family(action_family)
    where e.created_at <= clock_timestamp()
      and family.action_family is not null
    order by e.impression_client_event_id,action_family,e.created_at desc,e.client_action_id desc
  )
  select
    i.client_event_id,
    i.created_at,
    i.viewer_user_id,
    i.video_id,
    item.creator_id,
    case when p_include_features then item.feature_snapshot else null::jsonb end,
    (
      v.event_count = 1
      and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
      and v.media_duration_ms > 0
      and v.completion_ratio is not null
    ) as valid_retention,
    case when v.event_count = 1 and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
      and v.media_duration_ms > 0 and v.completion_ratio is not null
      then v.completion_ratio >= 0.50 else null end as long_watch_label,
    case when v.event_count = 1 and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
      and v.media_duration_ms > 0 and v.completion_ratio is not null
      then v.completed else null end as completion_label,
    case when v.event_count = 1 and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
      and v.media_duration_ms > 0 and v.completion_ratio is not null
      then case
        when v.exit_reason = 'swipe' and v.completion_ratio < 0.20 then true
        when v.completed is true or v.exit_reason = 'ended'
          or (v.exit_reason = 'swipe' and v.completion_ratio >= 0.20) then false
        else null
      end else null end as early_exit_label,
    case when v.event_count = 1 and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
      and v.media_duration_ms > 0 and v.completion_ratio is not null
      then coalesce(v.rewatch_count,0) > 0 else null end as rewatch_label,
    case when not item.is_self_authored then coalesce(like_action.action = 'like',false) else null end,
    case when not item.is_self_authored then coalesce(save_action.action = 'save',false) else null end,
    case when not item.is_self_authored then coalesce(follow_action.action = 'follow',false) else null end
  from private.organic_ranking_impressions i
  join private.organic_ranking_decisions d on d.id = i.decision_id
    and d.observation_schema_version = 'organic-ranking-observation-v1'
    and d.feature_contract_version = 'organic-ranking-features-personalization-v2'
  join private.organic_ranking_items item
    on item.decision_id=i.decision_id and item.organic_position=i.organic_position and item.video_id=i.video_id
  left join view_events v on v.client_event_id=i.client_event_id
  left join final_actions like_action
    on like_action.impression_client_event_id=i.client_event_id and like_action.action_family='like'
  left join final_actions save_action
    on save_action.impression_client_event_id=i.client_event_id and save_action.action_family='save'
  left join final_actions follow_action
    on follow_action.impression_client_event_id=i.client_event_id and follow_action.action_family='follow'
  where i.created_at <= clock_timestamp() - interval '24 hours';
$$;

revoke all on function private.algo6_l6_training_rows_v1(boolean)
  from public, anon, authenticated, service_role;

create function public.get_algo6_l6_training_samples_v1(
  p_after_created_at timestamptz default null,
  p_after_sample_key text default null,
  p_limit integer default 1000
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000
     or num_nonnulls(p_after_created_at,p_after_sample_key) not in (0,2)
     or (p_after_sample_key is not null and p_after_sample_key !~ '^[0-9a-f]{64}$') then
    raise exception using errcode='22023',message='algo6_training_sample_page_invalid';
  end if;
  select coalesce(jsonb_agg(row_data order by impression_at,sample_key),'[]'::jsonb)
  into v_rows
  from (
    select
      r.impression_at,
      pg_catalog.encode(extensions.digest(r.impression_client_event_id::text,'sha256'),'hex') as sample_key,
      jsonb_build_object(
        'sample_key',pg_catalog.encode(extensions.digest(r.impression_client_event_id::text,'sha256'),'hex'),
        'impression_at',r.impression_at,
        'features',r.feature_snapshot,
        'labels',jsonb_build_object(
          'long_watch',r.long_watch_label,'completion',r.completion_label,
          'early_exit',r.early_exit_label,'rewatch',r.rewatch_label,
          'save',r.save_label,'like',r.like_label,'follow',r.follow_label
        )
      ) as row_data
    from private.algo6_l6_training_rows_v1(true) r
    where p_after_created_at is null
       or (r.impression_at,pg_catalog.encode(extensions.digest(r.impression_client_event_id::text,'sha256'),'hex'))
          > (p_after_created_at,p_after_sample_key)
    order by r.impression_at,r.impression_client_event_id
    limit p_limit
  ) page;
  return jsonb_build_object(
    'contract_version','algo6-l6-training-samples-v1',
    'feature_contract_version','organic-ranking-features-personalization-v2',
    'label_contract_version','algo6-l6-label-contract-v1',
    'rows',v_rows,
    'count',jsonb_array_length(v_rows)
  );
end;
$$;

revoke all on function public.get_algo6_l6_training_samples_v1(timestamptz,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_algo6_l6_training_samples_v1(timestamptz,text,integer) to service_role;

create function public.get_algo6_l6_training_readiness_v2()
returns jsonb
language sql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
with
anchor as materialized (select clock_timestamp() as generated_at),
expected_keys as materialized (select array[
  'freshness_points','follow_points','like_points','comment_points','save_points',
  'completion_points','rewatch_points','exploration_points','same_session_points',
  'short_watch_points','completed_points','repeat_points','creator_affinity_points',
  'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
  'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
  'l4_context_adjustment','l5_semantic_positive_points','l5_semantic_negative_penalty',
  'l5_semantic_adjustment','explicit_interest_similarity','explicit_interest_points',
  'preferred_language_points','content_region_points','explicit_seed_weight','behavioral_confidence'
]::text[] as keys),
impression_base as materialized (
  -- Keep the hot integrity join narrow. Feature snapshots are validated in a
  -- separate aggregate so 250k JSON documents never enter this hash relation.
  select i.client_event_id,i.decision_id,i.organic_position,i.video_id,
    i.viewer_user_id,i.client_session_id,i.created_at,
    d.id as authority_decision_id,d.feature_contract_version,d.observation_schema_version,
    item.creator_id,item.is_self_authored
  from private.organic_ranking_impressions i
  left join private.organic_ranking_decisions d on d.id=i.decision_id
  left join private.organic_ranking_items item
    on item.decision_id=i.decision_id and item.organic_position=i.organic_position and item.video_id=i.video_id
),
view_identity as materialized (
  -- client_event_id is a canonical UNIQUE key. Readiness separately verifies
  -- the authority contract, so this narrow projection avoids sorting a wide
  -- impression/snapshot relation merely to rediscover the enforced value 1.
  select client_event_id,1::bigint as row_count,video_id,viewer_id,client_session_id
  from public.video_views
),
snapshot_quality as materialized (
  select count(*) filter (
    where d.feature_contract_version='organic-ranking-features-personalization-v2'
      and (
        item.feature_snapshot is null
        or jsonb_typeof(item.feature_snapshot)<>'object'
        or not (item.feature_snapshot ?& e.keys)
        or not ((item.feature_snapshot-e.keys)='{}'::jsonb)
        or jsonb_path_exists(item.feature_snapshot,'$.* ? (@.type() != "number" && @.type() != "null")'::jsonpath)
      )
  )::bigint as malformed_v2_snapshots
  from private.organic_ranking_impressions i
  left join private.organic_ranking_decisions d on d.id=i.decision_id
  left join private.organic_ranking_items item
    on item.decision_id=i.decision_id and item.organic_position=i.organic_position and item.video_id=i.video_id
  cross join expected_keys e
),
quality as materialized (
  select
    count(*)::bigint as visible_impressions_total,
    count(distinct i.client_event_id)::bigint as unique_visible_impressions_total,
    count(*) filter (where i.created_at<=a.generated_at-interval '24 hours'
      and i.feature_contract_version='organic-ranking-features-personalization-v2')::bigint as mature_v2_impressions,
    count(distinct i.client_event_id) filter (where i.created_at<=a.generated_at-interval '24 hours'
      and i.feature_contract_version='organic-ranking-features-personalization-v2')::bigint as unique_mature_v2_impressions,
    max(sq.malformed_v2_snapshots)::bigint as malformed_v2_snapshots,
    count(*) filter (where coalesce(v.row_count,0)>1)::bigint as duplicate_finalized_views,
    count(*) filter (where v.row_count=1 and v.video_id<>i.video_id)::bigint as wrong_video_joins,
    count(*) filter (where v.row_count=1 and v.client_session_id<>i.client_session_id)::bigint as wrong_session_joins,
    count(*) filter (where v.row_count=1 and v.viewer_id is distinct from i.viewer_user_id)::bigint as wrong_viewer_joins,
    count(*) filter (where i.created_at>a.generated_at)::bigint as future_impressions,
    count(*) filter (where i.authority_decision_id is null or i.creator_id is null)::bigint as orphan_impressions,
    count(*) filter (where i.created_at<=a.generated_at-interval '24 hours' and coalesce(v.row_count,0)=0)::bigint as censored_mature_impressions
  from impression_base i cross join anchor a cross join snapshot_quality sq
  left join view_identity v on v.client_event_id=i.client_event_id
),
decision_quality as materialized (
  select
    count(*) filter (where d.returned_count<>coalesce(items.item_count,0))::bigint as returned_item_mismatches,
    count(*) filter (where d.observation_schema_version<>'organic-ranking-observation-v1'
      or d.feature_contract_version not in ('organic-ranking-features-l1-l5-v1','organic-ranking-features-personalization-v2'))::bigint as invalid_contract_versions,
    count(*) filter (where d.created_at>a.generated_at)::bigint as future_decisions
  from private.organic_ranking_decisions d cross join anchor a
  left join (select decision_id,count(*)::integer as item_count from private.organic_ranking_items group by decision_id) items
    on items.decision_id=d.id
),
engagement_quality as materialized (
  select
    count(*)::bigint as events_total,
    count(distinct e.client_action_id)::bigint as unique_action_ids,
    (count(*)-count(distinct e.client_action_id))::bigint as duplicate_action_ids,
    count(*) filter (where i.client_event_id is null)::bigint as orphan_events,
    count(*) filter (where e.viewer_user_id=e.creator_id)::bigint as self_authored_events,
    count(*) filter (where i.client_event_id is not null and (e.created_at<i.created_at or e.created_at>i.created_at+interval '24 hours'))::bigint as outside_window_events,
    count(*) filter (where e.created_at>a.generated_at)::bigint as future_events,
    count(*) filter (where e.attribution_contract_version<>'organic-engagement-24h-v1')::bigint as invalid_contract_versions,
    count(*) filter (where e.action='unlike')::bigint as unlike_events,
    count(*) filter (where e.action='unsave')::bigint as unsave_events,
    count(*) filter (where e.action='unfollow')::bigint as unfollow_events
  from private.organic_ranking_engagement_events e cross join anchor a
  left join private.organic_ranking_impressions i on i.client_event_id=e.impression_client_event_id
),
training_rows as materialized (select * from private.algo6_l6_training_rows_v1(false)),
window_anchor as materialized (
  select date_trunc('day',max(impression_at) at time zone 'UTC')+interval '1 day' as window_end from training_rows
),
windowed as materialized (
  select r.*,
    case
      when r.impression_at < w.window_end-interval '28 days' then 'train'
      when r.impression_at < w.window_end-interval '14 days' then 'validation'
      else 'test'
    end as split_name
  from training_rows r cross join window_anchor w
  where r.impression_at>=w.window_end-interval '84 days' and r.impression_at<w.window_end
),
days as materialized (
  select distinct (impression_at at time zone 'UTC')::date as observed_day from training_rows
),
numbered_days as (
  select observed_day,observed_day-(row_number() over(order by observed_day))::integer as island from days
),
continuity as materialized (
  select count(*)::bigint as observed_calendar_days,
    coalesce((select max(n) from (select count(*)::bigint n from numbered_days group by island) x),0)::bigint
      as longest_consecutive_observation_days from days
),
heads as materialized (
  select
    count(*) filter(where long_watch_label is true)::bigint as long_watch_positive,
    count(*) filter(where long_watch_label is false)::bigint as long_watch_negative,
    count(*) filter(where completion_label is true)::bigint as completion_positive,
    count(*) filter(where completion_label is false)::bigint as completion_negative,
    count(*) filter(where early_exit_label is true)::bigint as early_exit_positive,
    count(*) filter(where early_exit_label is false)::bigint as early_exit_negative,
    count(*) filter(where rewatch_label is true)::bigint as rewatch_positive,
    count(*) filter(where save_label is true)::bigint as save_positive,
    count(*) filter(where like_label is true)::bigint as like_positive,
    count(*) filter(where follow_label is true)::bigint as follow_positive,
    count(*) filter(where split_name='validation' and rewatch_label is true)::bigint as val_rewatch_positive,
    count(*) filter(where split_name='validation' and save_label is true)::bigint as val_save_positive,
    count(*) filter(where split_name='validation' and like_label is true)::bigint as val_like_positive,
    count(*) filter(where split_name='test' and rewatch_label is true)::bigint as test_rewatch_positive,
    count(*) filter(where split_name='test' and save_label is true)::bigint as test_save_positive,
    count(*) filter(where split_name='test' and like_label is true)::bigint as test_like_positive
  from windowed
),
global_counts as materialized (
  select count(*)::bigint as samples,
    count(*) filter(where valid_retention)::bigint as valid_retention,
    count(distinct viewer_user_id) filter(where viewer_user_id is not null)::bigint as viewers,
    count(distinct video_id)::bigint as videos,count(distinct creator_id)::bigint as creators
  from training_rows
),
policy as materialized (select * from private.algo_l1_policy where singleton),
failures as materialized (
  select (
    (q.visible_impressions_total-q.unique_visible_impressions_total)+q.malformed_v2_snapshots+
    q.duplicate_finalized_views+q.wrong_video_joins+q.wrong_session_joins+q.wrong_viewer_joins+
    q.future_impressions+q.orphan_impressions+d.returned_item_mismatches+d.invalid_contract_versions+
    d.future_decisions+e.duplicate_action_ids+e.orphan_events+e.self_authored_events+
    e.outside_window_events+e.future_events+e.invalid_contract_versions+
    case when p.short_watch_ratio_threshold<>0.20 then 1 else 0 end
  )::bigint as structural_failure_count
  from quality q cross join decision_quality d cross join engagement_quality e cross join policy p
),
gate as materialized (
  select
    f.structural_failure_count=0
    and q.mature_v2_impressions=q.unique_mature_v2_impressions
    and g.samples>=250000 and g.valid_retention>=100000 and g.viewers>=2000
    and g.videos>=2000 and g.creators>=200 and c.longest_consecutive_observation_days>=84
    and h.long_watch_positive>=10000 and h.long_watch_negative>=10000
    and h.completion_positive>=10000 and h.completion_negative>=10000
    and h.early_exit_positive>=10000 and h.early_exit_negative>=10000
    and h.rewatch_positive>=5000 and h.save_positive>=5000 and h.like_positive>=5000
    and least(h.val_rewatch_positive,h.val_save_positive,h.val_like_positive)>=500
    and least(h.test_rewatch_positive,h.test_save_positive,h.test_like_positive)>=500
      as ready
  from failures f cross join quality q cross join global_counts g cross join continuity c cross join heads h
)
select jsonb_build_object(
  'contract_version','algo6-l6-training-readiness-v2',
  'generated_at',a.generated_at,
  'observation_schema_version','organic-ranking-observation-v1',
  'feature_contract_version','organic-ranking-features-personalization-v2',
  'label_contract_version','algo6-l6-label-contract-v1',
  'overall_status',case when f.structural_failure_count>0 then 'STRUCTURAL_FAILURE' when gate.ready then 'READY' else 'NOT_READY' end,
  'training_entry_ready',gate.ready,
  'blocking_reasons',to_jsonb(array_remove(array[
    case when f.structural_failure_count>0 then 'structural_failure' end,
    case when g.samples<250000 then 'unique_visible_organic_impressions' end,
    case when g.valid_retention<100000 then 'valid_retention_samples' end,
    case when g.viewers<2000 then 'authenticated_viewers' end,
    case when g.videos<2000 then 'distinct_videos' end,
    case when g.creators<200 then 'distinct_creators' end,
    case when c.longest_consecutive_observation_days<84 then 'continuous_observation_days' end,
    case when h.long_watch_positive<10000 or h.long_watch_negative<10000 then 'long_watch_support' end,
    case when h.completion_positive<10000 or h.completion_negative<10000 then 'completion_support' end,
    case when h.early_exit_positive<10000 or h.early_exit_negative<10000 then 'early_exit_support' end,
    case when h.rewatch_positive<5000 then 'rewatch_support' end,
    case when h.save_positive<5000 then 'save_support' end,
    case when h.like_positive<5000 then 'like_support' end,
    case when least(h.val_rewatch_positive,h.val_save_positive,h.val_like_positive)<500 then 'validation_sparse_support' end,
    case when least(h.test_rewatch_positive,h.test_save_positive,h.test_like_positive)<500 then 'untouched_test_sparse_support' end
  ],null)),
  'global_gates',jsonb_build_object(
    'unique_visible_organic_impressions',jsonb_build_object('current',g.samples,'total',q.mature_v2_impressions,'distinct',q.unique_mature_v2_impressions,'required',250000,'status',case when q.mature_v2_impressions<>q.unique_mature_v2_impressions then 'STRUCTURAL_FAILURE' when g.samples>=250000 then 'PASS' else 'NOT_READY' end),
    'valid_retention_samples',jsonb_build_object('current',g.valid_retention,'required',100000,'status',case when g.valid_retention>=100000 then 'PASS' else 'NOT_READY' end),
    'authenticated_viewers',jsonb_build_object('current',g.viewers,'required',2000,'status',case when g.viewers>=2000 then 'PASS' else 'NOT_READY' end),
    'distinct_videos',jsonb_build_object('current',g.videos,'required',2000,'status',case when g.videos>=2000 then 'PASS' else 'NOT_READY' end),
    'distinct_creators',jsonb_build_object('current',g.creators,'required',200,'status',case when g.creators>=200 then 'PASS' else 'NOT_READY' end),
    'continuous_observation_days',jsonb_build_object('current',c.longest_consecutive_observation_days,'required',84,'status',case when c.longest_consecutive_observation_days>=84 then 'PASS' else 'NOT_READY' end)
  ),
  'head_monitoring',jsonb_build_object(
    'long_watch',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.long_watch_positive,'negative_count',h.long_watch_negative,'required_positive',10000,'required_negative',10000),
    'completion',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.completion_positive,'negative_count',h.completion_negative,'required_positive',10000,'required_negative',10000),
    'early_exit',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.early_exit_positive,'negative_count',h.early_exit_negative,'required_positive',10000,'required_negative',10000,'short_watch_ratio_threshold',0.20,'excluded_exit_reasons',jsonb_build_array('background','unmount','unknown')),
    'rewatch',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.rewatch_positive,'required_positive',5000),
    'save',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.save_positive,'required_positive',5000),
    'like',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT','positive_count',h.like_positive,'required_positive',5000),
    'follow',jsonb_build_object('label_contract_status','FINAL_LABEL_CONTRACT_AUXILIARY','positive_count',h.follow_positive,'required_positive',null),
    'reversals',jsonb_build_object('unlike',e.unlike_events,'unsave',e.unsave_events,'unfollow',e.unfollow_events,'label_interpretation','FINAL_STATE_RESOLUTION_ONLY')
  ),
  'temporal_split',jsonb_build_object(
    'status','FINAL_TEMPORAL_SPLIT_V1','train_weeks',8,'validation_weeks',2,'untouched_test_weeks',2,
    'validation_sparse_support',jsonb_build_object('rewatch',h.val_rewatch_positive,'save',h.val_save_positive,'like',h.val_like_positive,'required_each',500),
    'untouched_test_sparse_support',jsonb_build_object('rewatch',h.test_rewatch_positive,'save',h.test_save_positive,'like',h.test_like_positive,'required_each',500)
  ),
  'observation_continuity',jsonb_build_object('observed_calendar_days',c.observed_calendar_days,'longest_consecutive_observation_days',c.longest_consecutive_observation_days,'required_continuous_days',84),
  'data_quality',jsonb_build_object(
    'visible_impressions_total',q.visible_impressions_total,'unique_impression_client_event_ids',q.unique_visible_impressions_total,
    'mature_compatible_v2_impressions',q.mature_v2_impressions,'malformed_feature_snapshots',q.malformed_v2_snapshots,
    'duplicate_impression_identities',q.visible_impressions_total-q.unique_visible_impressions_total,
    'duplicate_action_ids',e.duplicate_action_ids,'wrong_video_joins',q.wrong_video_joins,
    'wrong_session_joins',q.wrong_session_joins,'wrong_viewer_joins',q.wrong_viewer_joins,
    'unlinked_mature_impressions',q.censored_mature_impressions,'orphan_engagements',e.orphan_events,
    'self_authored_engagement_rows',e.self_authored_events,'outside_window_engagements',e.outside_window_events,
    'structural_failure_count',f.structural_failure_count
  ),
  'current_policy_state',jsonb_build_object(
    'policy_version',p.policy_version,'canary_generation',p.canary_generation,'canary_enabled',p.canary_enabled,
    'canary_target_layer',p.canary_target_layer,'production_rollout_bps',p.production_rollout_bps,
    'l2_affinity_enabled',p.l2_affinity_enabled,'l3_quality_enabled',p.l3_quality_enabled,
    'l4_context_enabled',p.l4_context_enabled,'l5_semantic_enabled',p.l5_semantic_enabled,
    'l6_ml_enabled',p.l6_ml_enabled,'l6_active_model_id',p.l6_active_model_id,'l6_canary_model_id',p.l6_canary_model_id
  )
)
from anchor a cross join quality q cross join decision_quality d cross join engagement_quality e
cross join global_counts g cross join continuity c cross join heads h cross join policy p
cross join failures f cross join gate;
$$;

revoke all on function public.get_algo6_l6_training_readiness_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.get_algo6_l6_training_readiness_v2() to service_role;

create function public.register_algo6_model_candidate_v1(
  p_model_version text,
  p_training_window_start timestamptz,
  p_training_window_end timestamptz,
  p_training_sample_count bigint,
  p_head_metrics jsonb,
  p_model_payload jsonb,
  p_rejected boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_readiness jsonb;
  v_id uuid;
begin
  v_readiness:=public.get_algo6_l6_training_readiness_v2();
  if coalesce((v_readiness->>'training_entry_ready')::boolean,false) is not true then
    raise exception using errcode='55000',message='algo6_training_not_ready';
  end if;
  if jsonb_typeof(p_head_metrics)<>'object' or jsonb_typeof(p_model_payload)<>'object'
     or not (p_model_payload->'heads' ?& array['long_watch','completion','early_exit','rewatch','save','like']) then
    raise exception using errcode='22023',message='algo6_model_payload_invalid';
  end if;
  insert into private.algo6_model_versions(
    model_version,status,feature_contract_version,label_contract_version,
    training_window_start,training_window_end,training_sample_count,
    head_metrics,model_payload,created_by
  ) values (
    p_model_version,case when coalesce(p_rejected,false) then 'rejected' else 'candidate' end,
    'organic-ranking-features-personalization-v2','algo6-l6-label-contract-v1',
    p_training_window_start,p_training_window_end,p_training_sample_count,
    p_head_metrics,p_model_payload,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.register_algo6_model_candidate_v1(text,timestamptz,timestamptz,bigint,jsonb,jsonb,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.register_algo6_model_candidate_v1(text,timestamptz,timestamptz,bigint,jsonb,jsonb,boolean) to service_role;

create function public.manage_algo6_model_v1(
  p_action text,
  p_model_id uuid,
  p_rollback_model_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model private.algo6_model_versions;
  v_target private.algo6_model_versions;
  v_readiness jsonb;
  v_now timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('algo6-model-promotion',0));
  select * into v_model from private.algo6_model_versions where id=p_model_id for update;
  if not found then raise exception using errcode='P0002',message='algo6_model_not_found'; end if;
  if v_model.feature_contract_version<>'organic-ranking-features-personalization-v2'
     or v_model.label_contract_version<>'algo6-l6-label-contract-v1' then
    raise exception using errcode='55000',message='algo6_model_contract_mismatch';
  end if;
  if p_action in ('candidate_to_canary','canary_to_active','rollback') then
    v_readiness:=public.get_algo6_l6_training_readiness_v2();
    if (v_readiness->>'overall_status')='STRUCTURAL_FAILURE' then
      raise exception using errcode='55000',message='algo6_model_structural_failure';
    end if;
  end if;
  if p_action in ('candidate_to_canary','canary_to_active')
     and coalesce((v_model.head_metrics->>'promotion_eligible')::boolean,false) is not true then
    raise exception using errcode='55000',message='algo6_model_metrics_not_eligible';
  end if;
  if p_action='candidate_to_canary' then
    if v_model.status<>'candidate' then raise exception using errcode='22023',message='algo6_model_transition_invalid'; end if;
    update private.algo6_model_versions set status='retired',retired_at=v_now where status='canary' and id<>v_model.id;
    update private.algo6_model_versions set status='canary',promoted_at=v_now where id=v_model.id;
    update private.algo_l1_policy set l6_canary_model_id=v_model.id,
      policy_version=left('nelyon-algo-l6-canary-'||extract(epoch from v_now)::bigint||'-'||v_model.id::text,100)
      where singleton;
  elsif p_action='canary_to_active' then
    if v_model.status<>'canary' then raise exception using errcode='22023',message='algo6_model_transition_invalid'; end if;
    update private.algo6_model_versions set status='retired',retired_at=v_now where status='active' and id<>v_model.id;
    update private.algo6_model_versions set status='active',promoted_at=v_now,retired_at=null where id=v_model.id;
    update private.algo_l1_policy set l6_active_model_id=v_model.id,l6_canary_model_id=null,l6_ml_enabled=true,
      policy_version=left('nelyon-algo-l6-active-'||extract(epoch from v_now)::bigint||'-'||v_model.id::text,100)
      where singleton;
  elsif p_action='active_to_retired' then
    if v_model.status<>'active' then raise exception using errcode='22023',message='algo6_model_transition_invalid'; end if;
    update private.algo6_model_versions set status='retired',retired_at=v_now where id=v_model.id;
    update private.algo_l1_policy set l6_active_model_id=null,l6_ml_enabled=false,
      policy_version=left('nelyon-algo-l6-off-'||extract(epoch from v_now)::bigint||'-'||v_model.id::text,100)
      where singleton;
  elsif p_action='candidate_to_rejected' then
    if v_model.status<>'candidate' then raise exception using errcode='22023',message='algo6_model_transition_invalid'; end if;
    update private.algo6_model_versions set status='rejected',retired_at=v_now where id=v_model.id;
  elsif p_action='rollback' then
    select * into v_target from private.algo6_model_versions where id=p_rollback_model_id for update;
    if not found or v_model.status<>'active' or v_target.status<>'retired' then
      raise exception using errcode='22023',message='algo6_model_rollback_invalid';
    end if;
    if v_target.feature_contract_version<>v_model.feature_contract_version or v_target.label_contract_version<>v_model.label_contract_version then
      raise exception using errcode='55000',message='algo6_model_rollback_contract_mismatch';
    end if;
    update private.algo6_model_versions set status='retired',retired_at=v_now where id=v_model.id;
    update private.algo6_model_versions set status='active',promoted_at=v_now,retired_at=null where id=v_target.id;
    update private.algo_l1_policy set l6_active_model_id=v_target.id,l6_ml_enabled=true,
      policy_version=left('nelyon-algo-l6-rollback-'||extract(epoch from v_now)::bigint||'-'||v_target.id::text,100)
      where singleton;
    v_model:=v_target;
  else
    raise exception using errcode='22023',message='algo6_model_action_invalid';
  end if;
  return jsonb_build_object('model_id',v_model.id,'action',p_action,'status',(select status from private.algo6_model_versions where id=v_model.id),'automatic_global_promotion',false);
end;
$$;

revoke all on function public.manage_algo6_model_v1(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_algo6_model_v1(text,uuid,uuid) to service_role;


create or replace function private.record_organic_ranking_decision_v1(
  p_viewer_user_id uuid,
  p_client_session_id uuid,
  p_feed_as_of timestamp with time zone,
  p_ranking_mode text,
  p_policy_version text,
  p_base_policy_version text,
  p_canary_generation bigint,
  p_canary_target_layer text,
  p_directed_canary boolean,
  p_production_rollout_bps integer,
  p_candidate_count integer,
  p_requested_limit integer,
  p_effective_page_limit integer,
  p_cursor_before_score numeric,
  p_cursor_before_created_at timestamp with time zone,
  p_cursor_before_id uuid,
  p_observation_schema_version text,
  p_feature_contract_version text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision_id uuid := pg_catalog.gen_random_uuid();
  v_returned_count integer;
  v_error_state text;
  v_allowed_keys_v1 text[] := array[
    'freshness_points','follow_points','like_points','comment_points','save_points',
    'completion_points','rewatch_points','exploration_points','same_session_points',
    'short_watch_points','completed_points','repeat_points','creator_affinity_points',
    'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
    'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
    'l4_context_adjustment','l5_semantic_positive_points',
    'l5_semantic_negative_penalty','l5_semantic_adjustment'
  ];
  v_allowed_keys_v2 text[] := v_allowed_keys_v1 || array[
    'explicit_interest_similarity','explicit_interest_points',
    'preferred_language_points','content_region_points',
    'explicit_seed_weight','behavioral_confidence'
  ];
begin
  begin
    if p_client_session_id is null
       or p_feed_as_of is null
       or p_ranking_mode not in (
         'chronological','behavioral_l1','behavioral_l2',
         'behavioral_l3','behavioral_l4','behavioral_l5','behavioral_l6'
       )
       or nullif(btrim(p_policy_version), '') is null
       or nullif(btrim(p_base_policy_version), '') is null
       or p_canary_generation is null or p_canary_generation < 0
       or p_canary_target_layer not in ('l1','l2','l3','l4','l5','l6')
       or p_directed_canary is null
       or p_production_rollout_bps not between 0 and 10000
       or p_candidate_count is null or p_candidate_count < 0
       or p_requested_limit is null or p_requested_limit <= 0
       or p_effective_page_limit not between 1 and 50
       or num_nonnulls(
         p_cursor_before_score,p_cursor_before_created_at,p_cursor_before_id
       ) not in (0,3)
       or p_observation_schema_version <> 'organic-ranking-observation-v1'
       or p_feature_contract_version not in (
         'organic-ranking-features-l1-l5-v1',
         'organic-ranking-features-personalization-v2'
       )
       or jsonb_typeof(p_items) <> 'array' then
      raise exception 'algo6_l6_observation_payload_invalid' using errcode = '22023';
    end if;

    v_returned_count := jsonb_array_length(p_items);
    if v_returned_count not between 0 and 50
       or v_returned_count > p_candidate_count then
      raise exception 'algo6_l6_observation_returned_count_invalid' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) with ordinality entry(item, item_ordinal)
      where jsonb_typeof(entry.item) <> 'object'
         or (entry.item->>'organic_position')::integer <> entry.item_ordinal
         or (entry.item->>'organic_position')::integer not between 1 and 50
         or (entry.item->>'video_id')::uuid is null
         or (entry.item->>'creator_id')::uuid is null
         or jsonb_typeof(entry.item->'is_self_authored') <> 'boolean'
         or (entry.item->>'rank_score')::numeric is null
         or (entry.item->>'delivery_score')::numeric is null
         or jsonb_typeof(entry.item->'feature_snapshot') <> 'object'
         or (select count(*) from jsonb_object_keys(entry.item->'feature_snapshot')) <>
           case when p_feature_contract_version = 'organic-ranking-features-personalization-v2'
             then 30 else 24 end
         or not (entry.item->'feature_snapshot' ?&
           case when p_feature_contract_version = 'organic-ranking-features-personalization-v2'
             then v_allowed_keys_v2 else v_allowed_keys_v1 end)
         or exists (
           select 1
           from jsonb_each(entry.item->'feature_snapshot') feature
           where jsonb_typeof(feature.value) not in ('number','null')
         )
    ) then
      raise exception 'algo6_l6_observation_item_invalid' using errcode = '22023';
    end if;

    if (
      select count(distinct (entry.item->>'video_id')) <> v_returned_count
      from jsonb_array_elements(p_items) entry(item)
    ) then
      raise exception 'algo6_l6_observation_duplicate_video' using errcode = '22023';
    end if;

    insert into private.organic_ranking_decisions(
      id,viewer_user_id,client_session_id,feed_as_of,ranking_mode,
      policy_version,base_policy_version,canary_generation,canary_target_layer,
      directed_canary,production_rollout_bps,candidate_count,returned_count,
      requested_limit,effective_page_limit,cursor_before_score,
      cursor_before_created_at,cursor_before_id,observation_schema_version,
      feature_contract_version
    ) values (
      v_decision_id,p_viewer_user_id,p_client_session_id,p_feed_as_of,p_ranking_mode,
      p_policy_version,p_base_policy_version,p_canary_generation,p_canary_target_layer,
      p_directed_canary,p_production_rollout_bps,p_candidate_count,v_returned_count,
      p_requested_limit,p_effective_page_limit,p_cursor_before_score,
      p_cursor_before_created_at,p_cursor_before_id,p_observation_schema_version,
      p_feature_contract_version
    );

    insert into private.organic_ranking_items(
      decision_id,organic_position,video_id,creator_id,is_self_authored,
      rank_score,delivery_score,feature_snapshot
    )
    select
      v_decision_id,
      (entry.item->>'organic_position')::integer,
      (entry.item->>'video_id')::uuid,
      (entry.item->>'creator_id')::uuid,
      (entry.item->>'is_self_authored')::boolean,
      (entry.item->>'rank_score')::numeric(18,6),
      (entry.item->>'delivery_score')::numeric(18,6),
      entry.item->'feature_snapshot'
    from jsonb_array_elements(p_items) entry(item)
    order by (entry.item->>'organic_position')::integer;

    return v_decision_id;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    raise warning 'algo6_l6_observation_write_failed SQLSTATE=%', v_error_state;
    return null;
  end;
end;
$$;

revoke all on function private.record_organic_ranking_decision_v1(
  uuid,uuid,timestamp with time zone,text,text,text,bigint,text,boolean,integer,
  integer,integer,integer,numeric,timestamp with time zone,uuid,text,text,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.manage_algo_l1_canary_v1(
  p_action text,
  p_request_id uuid default null,
  p_ttl_minutes integer default null
)
returns table (
  status text,
  request_id uuid,
  requested_at timestamp with time zone,
  armed_at timestamp with time zone,
  expires_at timestamp with time zone,
  generation bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_now timestamp with time zone := clock_timestamp();
  v_policy private.algo_l1_policy%rowtype;
  v_target_layer text;
begin
  select *
  into v_policy
  from private.algo_l1_policy p
  where p.singleton
  for update;

  if not found then
    raise exception 'algo_l1_policy_missing' using errcode = '55000';
  end if;

  if v_action in ('arm', 'arm_l2', 'arm_l3', 'arm_l4', 'arm_l5', 'arm_l6') then
    v_target_layer := case
      when v_action = 'arm_l2' then 'l2'
      when v_action = 'arm_l3' then 'l3'
      when v_action = 'arm_l4' then 'l4'
      when v_action = 'arm_l5' then 'l5'
      when v_action = 'arm_l6' then 'l6'
      else 'l1'
    end;
    if p_ttl_minutes is null or p_ttl_minutes not between 5 and 60 then
      raise exception 'algo_l1_canary_ttl_invalid' using errcode = '22023';
    end if;
    if not v_policy.enabled then
      raise exception 'algo_l1_canary_policy_disabled' using errcode = '55000';
    end if;
    if v_policy.production_rollout_bps <> 0 then
      raise exception 'algo_l1_canary_rollout_conflict' using errcode = '55000';
    end if;
    if v_action = 'arm_l2' and v_policy.l2_affinity_enabled then
      raise exception 'algo_l2_canary_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l3' and v_policy.l3_quality_enabled then
      raise exception 'algo_l3_canary_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l3' and v_policy.l2_affinity_enabled then
      raise exception 'algo_l3_canary_l2_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l4' and v_policy.l4_context_enabled then
      raise exception 'algo_l4_canary_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l4' and v_policy.l3_quality_enabled then
      raise exception 'algo_l4_canary_l3_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l4' and v_policy.l2_affinity_enabled then
      raise exception 'algo_l4_canary_l2_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l5' and v_policy.l5_semantic_enabled then
      raise exception 'algo_l5_canary_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l5' and v_policy.l4_context_enabled then
      raise exception 'algo_l5_canary_l4_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l5' and v_policy.l3_quality_enabled then
      raise exception 'algo_l5_canary_l3_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l5' and v_policy.l2_affinity_enabled then
      raise exception 'algo_l5_canary_l2_global_enabled' using errcode = '55000';
    end if;
    if v_action = 'arm_l6' and v_policy.l6_canary_model_id is null then
      raise exception 'algo_l6_canary_model_missing' using errcode = '55000';
    end if;
    if v_action = 'arm_l6' and v_policy.l6_ml_enabled then
      raise exception 'algo_l6_canary_global_enabled' using errcode = '55000';
    end if;
    if v_policy.canary_enabled then
      raise exception 'algo_l1_canary_already_active' using errcode = '55000';
    end if;
    if v_policy.canary_request_id is distinct from p_request_id
       or v_policy.canary_user_id is null
       or v_policy.canary_requested_at is null
       or v_policy.canary_armed_at is not null
       or v_policy.canary_expires_at is not null then
      raise exception 'algo_l1_canary_request_not_pending' using errcode = '22023';
    end if;
    if v_policy.canary_requested_at > v_now
       or v_policy.canary_requested_at <= v_now - interval '30 minutes' then
      raise exception 'algo_l1_canary_request_expired' using errcode = '22023';
    end if;
    if not exists (select 1 from auth.users u where u.id = v_policy.canary_user_id) then
      raise exception 'algo_l1_canary_user_missing' using errcode = '55000';
    end if;

    update private.algo_l1_policy
    set canary_enabled = true,
        canary_target_layer = v_target_layer,
        canary_armed_at = v_now,
        canary_expires_at = v_now + make_interval(mins => p_ttl_minutes),
        canary_generation = canary_generation + 1
    where singleton
    returning * into v_policy;

    return query select
      'active'::text,
      v_policy.canary_request_id,
      v_policy.canary_requested_at,
      v_policy.canary_armed_at,
      v_policy.canary_expires_at,
      v_policy.canary_generation;
    return;
  end if;

  if v_action = 'disarm' then
    if p_ttl_minutes is not null
       or p_request_id is null
       or v_policy.canary_request_id is distinct from p_request_id
       or not v_policy.canary_enabled
       or v_policy.canary_armed_at is null
       or v_policy.canary_expires_at is null then
      raise exception 'algo_l1_canary_disarm_invalid' using errcode = '22023';
    end if;

    update private.algo_l1_policy
    set canary_enabled = false,
        canary_generation = canary_generation + 1
    where singleton
    returning * into v_policy;

    return query select
      'disarmed'::text,
      v_policy.canary_request_id,
      v_policy.canary_requested_at,
      v_policy.canary_armed_at,
      v_policy.canary_expires_at,
      v_policy.canary_generation;
    return;
  end if;

  raise exception 'algo_l1_canary_action_invalid' using errcode = '22023';
end;
$$;

revoke all on function public.manage_algo_l1_canary_v1(text,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_algo_l1_canary_v1(text,uuid,integer) to service_role;

drop function public.get_ranked_feed_l1_v1(
  uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text
);

create function public.get_ranked_feed_l1_v1(
  p_client_session_id uuid,
  p_limit integer default 10,
  p_as_of timestamp with time zone default null,
  p_before_score numeric default null,
  p_before_created_at timestamp with time zone default null,
  p_before_id uuid default null,
  p_policy_version text default null
)
returns table (
  id uuid,
  user_id uuid,
  video_url text,
  thumbnail_url text,
  media_urls text[],
  caption text,
  music text,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  views_count integer,
  saves_count integer,
  created_at timestamp with time zone,
  edited_at timestamp with time zone,
  creator_username text,
  creator_avatar text,
  ranking_mode text,
  policy_version text,
  rank_score numeric(18,6),
  feed_as_of timestamp with time zone,
  cursor_score numeric(18,6),
  cursor_created_at timestamp with time zone,
  cursor_id uuid,
  effective_page_limit integer,
  ranking_decision_id uuid,
  ranking_organic_position integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer_id uuid := (select auth.uid());
  v_policy private.algo_l1_policy%rowtype;
  v_now timestamp with time zone := clock_timestamp();
  v_as_of timestamp with time zone;
  v_page_limit integer;
  v_candidate_pool integer;
  v_cursor_parts integer;
  v_rollout_seed text;
  v_rollout_bucket integer;
  v_directed_canary_current boolean;
  v_directed_canary boolean;
  v_directed_l2_canary boolean;
  v_directed_l3_canary boolean;
  v_directed_l4_canary boolean;
  v_directed_l5_canary boolean;
  v_directed_l6_canary boolean;
  v_l2_effective boolean;
  v_l3_effective boolean;
  v_l4_effective boolean;
  v_l5_effective boolean;
  v_l6_effective boolean := false;
  v_l6_model_payload jsonb;
  v_effective_policy_version text;
  v_behavioral boolean;
  v_mode text;
  v_useful_actions bigint := 0;
  v_cold_start boolean;
  v_personalization_profile private.user_personalization_profiles%rowtype;
  v_personalization_effective boolean := false;
  v_behavior_signal_count integer := 0;
  v_behavioral_confidence numeric := 0;
  v_explicit_seed_weight numeric := 0;
  v_preference_epoch timestamp with time zone;
  v_output record;
begin
  if p_client_session_id is null then
    raise exception 'algo_l1_session_required' using errcode = '22023';
  end if;

  select *
  into v_policy
  from private.algo_l1_policy p
  where p.singleton;

  if not found then
    raise exception 'algo_l1_policy_missing' using errcode = '55000';
  end if;

  if coalesce(p_limit, 10) <= 0 then
    raise exception 'algo_l1_limit_invalid' using errcode = '22023';
  end if;
  v_page_limit := least(coalesce(p_limit, 10), v_policy.max_page_size);
  v_candidate_pool := v_policy.candidate_pool_size;

  v_cursor_parts := num_nonnulls(
    p_before_score,
    p_before_created_at,
    p_before_id,
    p_policy_version
  );

  if p_as_of is null then
    if v_cursor_parts <> 0 then
      raise exception 'algo_l1_partial_cursor' using errcode = '22023';
    end if;
    v_as_of := v_now;
  else
    if v_cursor_parts <> 4 then
      raise exception 'algo_l1_partial_cursor' using errcode = '22023';
    end if;
    if p_as_of > v_now then
      raise exception 'algo_l1_cursor_future' using errcode = '22023';
    end if;
    if p_as_of < v_now - make_interval(mins => v_policy.cursor_ttl_minutes) then
      raise exception 'algo_l1_cursor_expired' using errcode = '22023';
    end if;
    v_as_of := p_as_of;
  end if;

  if v_viewer_id is not null then
    select p.* into v_personalization_profile
    from private.user_personalization_profiles p
    where p.user_id = v_viewer_id
      and p.onboarding_completed_at is not null
      and p.personalization_enabled;
    v_personalization_effective := found and v_policy.personalization_enabled;
  end if;
  v_preference_epoch := coalesce(
    v_personalization_profile.preferences_updated_at,
    v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days)
  );
  if v_personalization_effective then
    select count(*)::integer into v_behavior_signal_count
    from (
      select evidence.video_id
      from (
        select l.video_id
        from public.likes l join public.videos v on v.id = l.video_id
        where l.user_id = v_viewer_id and v.user_id <> v_viewer_id
          and l.created_at >= v_preference_epoch and l.created_at <= v_as_of
        union
        select s.video_id
        from public.video_saves s join public.videos v on v.id = s.video_id
        where s.user_id = v_viewer_id and v.user_id <> v_viewer_id
          and s.created_at >= v_preference_epoch and s.created_at <= v_as_of
        union
        select vv.video_id
        from public.video_views vv join public.videos v on v.id = vv.video_id
        where vv.viewer_id = v_viewer_id and v.user_id <> v_viewer_id
          and vv.created_at >= v_preference_epoch and vv.created_at <= v_as_of
          and vv.media_duration_ms > 0 and vv.completion_ratio is not null
          and (
            vv.completed is true or vv.rewatch_count > 0
            or vv.completion_ratio >= v_policy.l3_long_watch_ratio_threshold
            or (vv.exit_reason = 'swipe' and vv.completion_ratio < v_policy.short_watch_ratio_threshold)
          )
      ) evidence
      limit 20
    ) bounded_evidence;
    v_behavioral_confidence := least(1::numeric, v_behavior_signal_count::numeric / 20.0::numeric);
    v_explicit_seed_weight := greatest(0::numeric, 1::numeric - v_behavioral_confidence);
  end if;

  v_directed_canary_current := v_policy.enabled
    and v_policy.production_rollout_bps = 0
    and v_viewer_id is not null
    and v_viewer_id = v_policy.canary_user_id
    and v_policy.canary_enabled
    and v_policy.canary_armed_at is not null
    and v_policy.canary_expires_at is not null
    and v_now >= v_policy.canary_armed_at
    and v_now < v_policy.canary_expires_at;
  v_directed_canary := v_directed_canary_current
    and v_as_of >= v_policy.canary_armed_at
    and v_as_of < v_policy.canary_expires_at;
  v_directed_l2_canary := v_directed_canary
    and v_policy.canary_target_layer = 'l2';
  v_directed_l3_canary := v_directed_canary
    and v_policy.canary_target_layer = 'l3';
  v_directed_l4_canary := v_directed_canary
    and v_policy.canary_target_layer = 'l4';
  v_directed_l5_canary := v_directed_canary
    and v_policy.canary_target_layer = 'l5';
  v_directed_l6_canary := v_directed_canary
    and v_policy.canary_target_layer = 'l6';
  v_l2_effective := v_viewer_id is not null
    and (v_policy.l2_affinity_enabled or v_directed_l2_canary or v_personalization_effective);
  v_effective_policy_version := case
    when v_viewer_id is not null
      and v_viewer_id = v_policy.canary_user_id
      and v_policy.canary_generation > 0
      then v_policy.policy_version || '|canary:' || v_policy.canary_generation
        || case
          when v_policy.canary_target_layer = 'l2' then ':l2'
          when v_policy.canary_target_layer = 'l3' then ':l3'
          when v_policy.canary_target_layer = 'l4' then ':l4'
          when v_policy.canary_target_layer = 'l5' then ':l5'
          when v_policy.canary_target_layer = 'l6' then ':l6'
          else ''
        end
        || case when v_directed_canary_current then ':active' else ':inactive' end
    else v_policy.policy_version
  end;

  if p_as_of is not null
     and p_policy_version is distinct from v_effective_policy_version then
    raise exception 'algo_l1_policy_mismatch' using errcode = '22023';
  end if;

  if v_viewer_id is not null then
    select count(*)
    into v_useful_actions
    from (
      select 1
      from (
        select f.id from public.follows f
        where f.follower_id = v_viewer_id and f.created_at <= v_as_of
        union all
        select l.id from public.likes l
        where l.user_id = v_viewer_id and l.created_at <= v_as_of
        union all
        select c.id from public.comments c
        where c.user_id = v_viewer_id and c.created_at <= v_as_of
        union all
        select s.id from public.video_saves s
        where s.user_id = v_viewer_id and s.created_at <= v_as_of
        union all
        select vv.id from public.video_views vv
        where vv.viewer_id = v_viewer_id and vv.created_at <= v_as_of
      ) raw_actions
      limit 3
    ) actions;
  end if;
  v_cold_start := v_viewer_id is null or v_useful_actions < 3;

  v_rollout_seed := coalesce(v_viewer_id::text, p_client_session_id::text)
    || '|' || v_policy.policy_version;
  v_rollout_bucket := mod(private.algo_l1_hash_u32_v1(v_rollout_seed), 10000)::integer;
  v_behavioral := v_policy.enabled
    and (
      v_directed_canary
      or v_rollout_bucket < v_policy.production_rollout_bps
      or v_personalization_effective
    );
  v_l3_effective := v_behavioral
    and (v_policy.l3_quality_enabled or v_directed_l3_canary);
  v_l4_effective := v_behavioral
    and (v_policy.l4_context_enabled or v_directed_l4_canary);
  v_l5_effective := v_behavioral
    and v_viewer_id is not null
    and (v_policy.l5_semantic_enabled or v_directed_l5_canary or v_personalization_effective);
  if v_directed_l6_canary and v_policy.l6_canary_model_id is not null then
    select m.model_payload into v_l6_model_payload
    from private.algo6_model_versions m
    where m.id=v_policy.l6_canary_model_id and m.status='canary'
      and m.feature_contract_version='organic-ranking-features-personalization-v2'
      and m.label_contract_version='algo6-l6-label-contract-v1';
  elsif v_policy.l6_ml_enabled and v_policy.l6_active_model_id is not null then
    select m.model_payload into v_l6_model_payload
    from private.algo6_model_versions m
    where m.id=v_policy.l6_active_model_id and m.status='active'
      and m.feature_contract_version='organic-ranking-features-personalization-v2'
      and m.label_contract_version='algo6-l6-label-contract-v1';
  end if;
  v_l6_effective := v_behavioral and v_viewer_id is not null and v_l6_model_payload is not null;
  v_mode := case
    when not v_behavioral then 'chronological'
    when v_l6_effective then 'behavioral_l6'
    when v_l5_effective then 'behavioral_l5'
    when v_l4_effective then 'behavioral_l4'
    when v_l3_effective then 'behavioral_l3'
    when v_l2_effective then 'behavioral_l2'
    else 'behavioral_l1'
  end;

  for v_output in
  with candidates as materialized (
    select
      v.id,
      v.user_id,
      v.video_url,
      v.thumbnail_url,
      v.media_urls,
      v.caption,
      v.music,
      v.likes_count,
      v.comments_count,
      v.shares_count,
      v.views_count,
      v.saves_count,
      v.created_at,
      v.edited_at,
      coalesce(up.username, 'user') as creator_username,
      coalesce(up.avatar_url, '') as creator_avatar
    from public.videos v
    join public.user_profiles up on up.id = v.user_id
    where v.created_at <= v_as_of
      and private.admin_content_is_visible('video', v.id)
      and private.video_can_view_owner(v.user_id)
    order by v.created_at desc, v.id desc
    limit v_candidate_pool
  ),
  candidate_ids as materialized (
    select pg_catalog.array_agg(c.id) as ids
    from candidates c
  ),
  candidate_creators as materialized (
    select distinct c.user_id as creator_id
    from candidates c
  ),
  explicit_interest_centroid as materialized (
    select extensions.avg(t.embedding) as embedding
    from private.user_personalization_interests ui
    join private.personalization_interest_taxonomy t on t.id = ui.interest_id
    where v_personalization_effective
      and ui.user_id = v_viewer_id
      and t.active
      and t.embedding_status = 'ready'
      and t.embedding_provider = 'cloudflare_workers_ai'
      and t.embedding_model = '@cf/baai/bge-m3'
      and t.embedding_dimensions = 1024
      and t.embedding is not null
      and extensions.vector_norm(t.embedding) > 0
      and t.embedding_completed_at <= v_as_of
      and t.updated_at <= v_as_of
  ),
  explicit_candidate_semantics as materialized (
    select
      c.id as video_id,
      p.detected_language,
      case when eic.embedding is not null
        and extensions.vector_norm(eic.embedding) > 0
        and p.embedding is not null
      then greatest(-1::numeric,least(1::numeric,
        (1 - (p.embedding operator(extensions.<=>) eic.embedding))::numeric
      )) else null::numeric end as explicit_interest_similarity
    from candidates c
    cross join explicit_interest_centroid eic
    left join private.video_semantic_profiles p
      on p.video_id = c.id
      and p.status = 'ready'
      and p.semantic_input_version = 'video-semantic-v2'
      and p.provider = 'cloudflare_workers_ai'
      and p.model = '@cf/baai/bge-m3'
      and p.embedding_dimensions = 1024
      and p.embedding is not null
      and extensions.vector_norm(p.embedding) > 0
      and p.completed_at <= v_as_of
      and p.updated_at <= v_as_of
    where v_personalization_effective
  ),
  l4_raw_session_history as materialized (
    select
      vv.id,
      vv.video_id,
      vv.viewer_id,
      vv.media_duration_ms,
      vv.completion_ratio,
      vv.exit_reason,
      vv.created_at
    from public.video_views vv
    where v_l4_effective
      and vv.client_session_id = p_client_session_id
      and vv.created_at <= v_as_of
      and vv.created_at >= v_as_of
        - make_interval(mins => v_policy.l4_session_horizon_minutes)
    order by vv.created_at desc, vv.id desc
    limit v_policy.l4_session_history_cap
  ),
  l4_session_history as materialized (
    select
      l4rsh.id,
      l4rsh.video_id,
      l4rsh.viewer_id,
      v.user_id as creator_id,
      l4rsh.media_duration_ms,
      l4rsh.completion_ratio,
      l4rsh.exit_reason,
      l4rsh.created_at
    from l4_raw_session_history l4rsh
    join public.videos v on v.id = l4rsh.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
  ),
  l4_exposure_ranked as (
    select
      l4sh.*,
      row_number() over (
        partition by l4sh.video_id
        order by l4sh.created_at desc, l4sh.id desc
      ) as exposure_rank
    from l4_session_history l4sh
  ),
  l4_latest_exposure as (
    select
      video_id,
      creator_id
    from l4_exposure_ranked
    where exposure_rank = 1
  ),
  l4_valid_retention_ranked as (
    select
      l4sh.video_id,
      l4sh.creator_id,
      l4sh.viewer_id,
      least(
        1::numeric,
        greatest(0::numeric, l4sh.completion_ratio)
      ) as bounded_completion_ratio,
      l4sh.exit_reason,
      row_number() over (
        partition by l4sh.video_id
        order by l4sh.created_at desc, l4sh.id desc
      ) as retention_rank
    from l4_session_history l4sh
    where l4sh.media_duration_ms is not null
      and l4sh.media_duration_ms > 0
      and l4sh.completion_ratio is not null
  ),
  l4_latest_valid_retention as (
    select
      video_id,
      creator_id,
      viewer_id,
      bounded_completion_ratio,
      exit_reason
    from l4_valid_retention_ranked
    where retention_rank = 1
  ),
  l4_creator_context as (
    select
      cc.creator_id,
      count(distinct l4le.video_id)::integer as session_distinct_videos_seen,
      count(distinct l4lvr.video_id) filter (
        where (l4lvr.viewer_id is null or l4lvr.viewer_id <> cc.creator_id)
          and l4lvr.bounded_completion_ratio
          >= v_policy.l4_positive_watch_ratio_threshold
      )::integer as positive_distinct_videos,
      count(distinct l4lvr.video_id) filter (
        where l4lvr.bounded_completion_ratio < v_policy.short_watch_ratio_threshold
          and l4lvr.exit_reason in ('swipe', 'background', 'unmount')
      )::integer as negative_distinct_videos
    from candidate_creators cc
    left join l4_latest_exposure l4le on l4le.creator_id = cc.creator_id
    left join l4_latest_valid_retention l4lvr
      on l4lvr.video_id = l4le.video_id
    where v_l4_effective
    group by cc.creator_id
  ),
  l3_retention_ranked as (
    select
      vv.video_id,
      vv.viewer_id,
      vv.client_session_id,
      vv.completed,
      least(1::numeric, greatest(0::numeric, vv.completion_ratio)) as bounded_completion_ratio,
      vv.exit_reason,
      row_number() over (
        partition by
          vv.video_id,
          vv.viewer_id,
          case when vv.viewer_id is null then vv.client_session_id else null end
        order by vv.created_at desc, vv.id desc
      ) as audience_rank
    from public.video_views vv
    join candidates c on c.id = vv.video_id
    where v_l3_effective
      and vv.created_at <= v_as_of
      and vv.created_at >= v_as_of
        - make_interval(days => v_policy.l3_retention_horizon_days)
      and vv.media_duration_ms is not null
      and vv.media_duration_ms > 0
      and vv.completion_ratio is not null
      and (vv.viewer_id is not null or vv.client_session_id is not null)
      and (vv.viewer_id is null or vv.viewer_id <> c.user_id)
  ),
  l3_retention_features as (
    select
      lrr.video_id,
      count(*)::bigint as sample_count,
      avg(case when lrr.completed is true then 1::numeric else 0::numeric end)
        as completion_rate,
      avg(case
        when lrr.bounded_completion_ratio >= v_policy.l3_long_watch_ratio_threshold
        then 1::numeric else 0::numeric
      end) as long_watch_rate,
      avg(case
        when lrr.bounded_completion_ratio < v_policy.short_watch_ratio_threshold
          and lrr.exit_reason in ('swipe', 'background', 'unmount')
        then 1::numeric else 0::numeric
      end) as early_exit_rate
    from l3_retention_ranked lrr
    where lrr.audience_rank = 1
    group by lrr.video_id
  ),
  l3_creator_burst_features as (
    select
      v.user_id as creator_id,
      least(
        v_policy.l3_creator_burst_penalty_cap,
        greatest(
          0::numeric,
          count(*)::numeric - v_policy.l3_creator_burst_free_posts
        ) * v_policy.l3_creator_burst_penalty_per_post
      ) as creator_burst_penalty
    from public.videos v
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_l3_effective
      and v.created_at <= v_as_of
      and v.created_at >= v_as_of
        - make_interval(hours => v_policy.l3_creator_burst_horizon_hours)
      and private.admin_content_is_visible('video', v.id)
    group by v.user_id
  ),
  l3_creator_history as materialized (
    select
      history.id,
      history.user_id,
      history.created_at
    from candidate_creators cc
    cross join lateral (
      select v.id, v.user_id, v.created_at
      from public.videos v
      where v_l3_effective
        and v.user_id = cc.creator_id
        and v.created_at <= v_as_of
        and v.created_at >= v_as_of
          - make_interval(days => v_policy.l3_duplicate_horizon_days)
        and private.admin_content_is_visible('video', v.id)
      order by v.created_at desc, v.id desc
      limit v_policy.l3_creator_history_cap
    ) history
  ),
  l3_creator_fingerprints as (
    select
      lch.id as video_id,
      lch.user_id,
      lch.created_at,
      fingerprint.content_fingerprint
    from l3_creator_history lch
    left join lateral (
      select css.content_fingerprint
      from private.content_safety_scans css
      where css.target_type = 'video'
        and css.target_id = lch.id
        and css.content_fingerprint is not null
        and css.created_at <= v_as_of
      order by css.created_at desc, css.id desc
      limit 1
    ) fingerprint on true
  ),
  l3_duplicate_ranked as (
    select
      lcf.video_id,
      row_number() over (
        partition by lcf.user_id, lcf.content_fingerprint
        order by lcf.created_at asc, lcf.video_id asc
      ) as duplicate_rank
    from l3_creator_fingerprints lcf
    where lcf.content_fingerprint is not null
  ),
  l3_duplicate_features as (
    select
      ldr.video_id,
      v_policy.l3_duplicate_penalty as duplicate_penalty
    from l3_duplicate_ranked ldr
    where ldr.duplicate_rank > 1
  ),
  affinity_like_signals as (
    select v.user_id as creator_id, l.video_id, max(l.created_at) as last_like_at
    from public.likes l
    join public.videos v on v.id = l.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_l2_effective
      and v_viewer_id is not null
      and v.user_id <> v_viewer_id
      and l.user_id = v_viewer_id
      and l.created_at <= v_as_of
      and l.created_at >= v_as_of
        - make_interval(days => v_policy.l2_affinity_horizon_days)
    group by v.user_id, l.video_id
  ),
  affinity_comment_signals as (
    select v.user_id as creator_id, cmt.video_id, max(cmt.created_at) as last_comment_at
    from public.comments cmt
    join public.videos v on v.id = cmt.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_l2_effective
      and v_viewer_id is not null
      and v.user_id <> v_viewer_id
      and cmt.user_id = v_viewer_id
      and cmt.created_at <= v_as_of
      and cmt.created_at >= v_as_of
        - make_interval(days => v_policy.l2_affinity_horizon_days)
    group by v.user_id, cmt.video_id
  ),
  affinity_save_signals as (
    select v.user_id as creator_id, s.video_id, max(s.created_at) as last_save_at
    from public.video_saves s
    join public.videos v on v.id = s.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_l2_effective
      and v_viewer_id is not null
      and v.user_id <> v_viewer_id
      and s.user_id = v_viewer_id
      and s.created_at <= v_as_of
      and s.created_at >= v_as_of
        - make_interval(days => v_policy.l2_affinity_horizon_days)
    group by v.user_id, s.video_id
  ),
  affinity_view_signals as (
    select
      v.user_id as creator_id,
      vv.video_id,
      max(vv.created_at) filter (where vv.completed is true) as last_completed_at,
      max(vv.created_at) filter (
        where vv.media_duration_ms is not null
          and vv.completion_ratio >= v_policy.l2_affinity_long_watch_ratio_threshold
      ) as last_long_watch_at,
      max(vv.created_at) filter (where vv.rewatch_count > 0) as last_rewatch_at,
      max(vv.created_at) filter (
        where vv.media_duration_ms is not null
          and vv.completion_ratio < v_policy.short_watch_ratio_threshold
          and vv.exit_reason in ('swipe', 'background', 'unmount')
      ) as last_short_watch_at
    from public.video_views vv
    join public.videos v on v.id = vv.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_l2_effective
      and v_viewer_id is not null
      and v.user_id <> v_viewer_id
      and vv.viewer_id = v_viewer_id
      and vv.created_at <= v_as_of
      and vv.created_at >= v_as_of
        - make_interval(days => v_policy.l2_affinity_horizon_days)
    group by v.user_id, vv.video_id
  ),
  affinity_video_keys as materialized (
    select als.creator_id, als.video_id from affinity_like_signals als
    union
    select acs.creator_id, acs.video_id from affinity_comment_signals acs
    union
    select ass.creator_id, ass.video_id from affinity_save_signals ass
    union
    select avs.creator_id, avs.video_id from affinity_view_signals avs
  ),
  affinity_short_watch_counts as (
    select
      avs.creator_id,
      count(distinct avs.video_id)::integer as distinct_short_watch_videos
    from affinity_view_signals avs
    where avs.last_short_watch_at is not null
    group by avs.creator_id
  ),
  affinity_video_components as (
    select
      avk.creator_id,
      avk.video_id,
      case when als.last_like_at is null then 0::numeric else
        v_policy.l2_affinity_like_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - als.last_like_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as like_affinity,
      case when acs.last_comment_at is null then 0::numeric else
        v_policy.l2_affinity_comment_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - acs.last_comment_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as comment_affinity,
      case when ass.last_save_at is null then 0::numeric else
        v_policy.l2_affinity_save_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - ass.last_save_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as save_affinity,
      case when avs.last_completed_at is null then 0::numeric else
        v_policy.l2_affinity_completed_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - avs.last_completed_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as completed_affinity,
      case when avs.last_long_watch_at is null then 0::numeric else
        v_policy.l2_affinity_long_watch_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - avs.last_long_watch_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as long_watch_affinity,
      case when avs.last_rewatch_at is null then 0::numeric else
        v_policy.l2_affinity_rewatch_weight * greatest(
          0::numeric,
          1 - extract(epoch from (v_as_of - avs.last_rewatch_at))::numeric
            / 86400::numeric / v_policy.l2_affinity_horizon_days
        )
      end as rewatch_affinity,
      avs.last_short_watch_at,
      coalesce(aswc.distinct_short_watch_videos, 0) as distinct_short_watch_videos
    from affinity_video_keys avk
    left join affinity_like_signals als
      on als.creator_id = avk.creator_id and als.video_id = avk.video_id
    left join affinity_comment_signals acs
      on acs.creator_id = avk.creator_id and acs.video_id = avk.video_id
    left join affinity_save_signals ass
      on ass.creator_id = avk.creator_id and ass.video_id = avk.video_id
    left join affinity_view_signals avs
      on avs.creator_id = avk.creator_id and avs.video_id = avk.video_id
    left join affinity_short_watch_counts aswc on aswc.creator_id = avk.creator_id
  ),
  affinity_video_scores as (
    select
      avc.creator_id,
      avc.video_id,
      least(
        v_policy.l2_affinity_per_video_positive_cap,
        avc.like_affinity
          + avc.comment_affinity
          + avc.save_affinity
          + avc.completed_affinity
          + avc.long_watch_affinity
          + avc.rewatch_affinity
      ) - case
        when avc.last_short_watch_at is not null
          and avc.distinct_short_watch_videos
            >= v_policy.l2_affinity_negative_min_distinct_videos
        then least(
          v_policy.l2_affinity_per_video_negative_cap,
          v_policy.l2_affinity_short_watch_penalty * greatest(
            0::numeric,
            1 - extract(epoch from (v_as_of - avc.last_short_watch_at))::numeric
              / 86400::numeric / v_policy.l2_affinity_horizon_days
          )
        )
        else 0::numeric
      end as per_video_affinity
    from affinity_video_components avc
  ),
  affinity_creator_scores as (
    select
      avs.creator_id,
      least(
        v_policy.l2_affinity_creator_positive_cap,
        greatest(
          -v_policy.l2_affinity_creator_negative_cap,
          sum(avs.per_video_affinity)
        )
      ) as creator_affinity_points
    from affinity_video_scores avs
    group by avs.creator_id
  ),
  l5_positive_like_signals as materialized (
    select l.video_id, max(l.created_at) as positive_signal
    from public.likes l
    where v_l5_effective
      and l.user_id = v_viewer_id
      and l.created_at <= v_as_of
      and l.created_at >= greatest(
        v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days),
        v_preference_epoch
      )
    group by l.video_id
  ),
  l5_positive_save_signals as materialized (
    select s.video_id, max(s.created_at) as positive_signal
    from public.video_saves s
    where v_l5_effective
      and s.user_id = v_viewer_id
      and s.created_at <= v_as_of
      and s.created_at >= greatest(
        v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days),
        v_preference_epoch
      )
    group by s.video_id
  ),
  l5_positive_view_signals as materialized (
    select vv.video_id, max(vv.created_at) as positive_signal
    from public.video_views vv
    where v_l5_effective
      and vv.viewer_id = v_viewer_id
      and vv.created_at <= v_as_of
      and vv.created_at >= greatest(
        v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days),
        v_preference_epoch
      )
      and vv.media_duration_ms is not null
      and vv.media_duration_ms > 0
      and vv.completion_ratio is not null
      and (
        vv.completed is true
        or vv.completion_ratio >= v_policy.l5_semantic_positive_watch_ratio_threshold
        or vv.rewatch_count > 0
      )
    group by vv.video_id
  ),
  l5_positive_signal_union as materialized (
    select pls.video_id, pls.positive_signal from l5_positive_like_signals pls
    union all
    select pss.video_id, pss.positive_signal from l5_positive_save_signals pss
    union all
    select pvs.video_id, pvs.positive_signal from l5_positive_view_signals pvs
  ),
  l5_positive_distinct as materialized (
    select
      psu.video_id,
      max(psu.positive_signal) as most_recent_positive_signal
    from l5_positive_signal_union psu
    join public.videos v on v.id = psu.video_id
    where v.user_id <> v_viewer_id
    group by psu.video_id
  ),
  l5_positive_history as materialized (
    select lpd.video_id, lpd.most_recent_positive_signal
    from l5_positive_distinct lpd
    order by most_recent_positive_signal desc, video_id desc
    limit v_policy.l5_semantic_history_cap
  ),
  l5_positive_embeddings as materialized (
    select lph.video_id, p.embedding
    from l5_positive_history lph
    join private.video_semantic_profiles p on p.video_id = lph.video_id
    where p.status = 'ready'
      and p.semantic_input_version = 'video-semantic-v2'
      and p.provider = 'cloudflare_workers_ai'
      and p.model = '@cf/baai/bge-m3'
      and p.embedding_dimensions = 1024
      and p.embedding is not null
      and extensions.vector_norm(p.embedding) > 0
      and p.completed_at is not null
      and p.completed_at <= v_as_of
      and p.updated_at <= v_as_of
  ),
  l5_negative_valid_events as materialized (
    select
      vv.id,
      vv.video_id,
      vv.created_at as latest_negative_signal,
      vv.completion_ratio,
      vv.exit_reason,
      row_number() over (
        partition by vv.video_id order by vv.created_at desc, vv.id desc
      ) as retention_rank
    from public.video_views vv
    join public.videos v on v.id = vv.video_id
    where v_l5_effective
      and vv.viewer_id = v_viewer_id
      and v.user_id <> v_viewer_id
      and vv.created_at <= v_as_of
      and vv.created_at >= greatest(
        v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days),
        v_preference_epoch
      )
      and vv.media_duration_ms is not null
      and vv.media_duration_ms > 0
      and vv.completion_ratio is not null
  ),
  l5_negative_distinct as materialized (
    select nve.video_id, nve.latest_negative_signal
    from l5_negative_valid_events nve
    where nve.retention_rank = 1
      and nve.completion_ratio < v_policy.short_watch_ratio_threshold
      and nve.exit_reason = 'swipe'
      and not exists (
        select 1
        from l5_positive_distinct l5_positive
        where l5_positive.video_id = nve.video_id
      )
  ),
  l5_negative_history as materialized (
    select lnd.video_id, lnd.latest_negative_signal
    from l5_negative_distinct lnd
    order by latest_negative_signal desc, video_id desc
    limit v_policy.l5_semantic_history_cap
  ),
  l5_negative_embeddings as materialized (
    select lnh.video_id, p.embedding
    from l5_negative_history lnh
    join private.video_semantic_profiles p on p.video_id = lnh.video_id
    where p.status = 'ready'
      and p.semantic_input_version = 'video-semantic-v2'
      and p.provider = 'cloudflare_workers_ai'
      and p.model = '@cf/baai/bge-m3'
      and p.embedding_dimensions = 1024
      and p.embedding is not null
      and extensions.vector_norm(p.embedding) > 0
      and p.completed_at is not null
      and p.completed_at <= v_as_of
      and p.updated_at <= v_as_of
  ),
  l5_positive_centroid as materialized (
    select
      count(*)::integer as positive_distinct_video_count,
      extensions.avg(lpe.embedding) as positive_centroid
    from l5_positive_embeddings lpe
  ),
  l5_negative_centroid as materialized (
    select
      count(*)::integer as negative_distinct_video_count,
      extensions.avg(lne.embedding) as negative_centroid
    from l5_negative_embeddings lne
  ),
  l5_candidate_semantics as materialized (
    select
      c.id as video_id,
      l5pc.positive_distinct_video_count,
      l5nc.negative_distinct_video_count,
      case
        when l5pc.positive_distinct_video_count
            >= v_policy.l5_semantic_positive_min_distinct_videos
          and l5pc.positive_centroid is not null
          and extensions.vector_norm(l5pc.positive_centroid) > 0
          and p.embedding is not null
        then greatest(
          -1::numeric,
          least(
            1::numeric,
            (1 - (p.embedding operator(extensions.<=>) l5pc.positive_centroid))::numeric
          )
        )
        else null::numeric
      end as positive_similarity,
      case
        when l5nc.negative_distinct_video_count
            >= v_policy.l5_semantic_negative_min_distinct_videos
          and l5nc.negative_centroid is not null
          and extensions.vector_norm(l5nc.negative_centroid) > 0
          and p.embedding is not null
        then greatest(
          -1::numeric,
          least(
            1::numeric,
            (1 - (p.embedding operator(extensions.<=>) l5nc.negative_centroid))::numeric
          )
        )
        else null::numeric
      end as negative_similarity
    from candidates c
    cross join l5_positive_centroid l5pc
    cross join l5_negative_centroid l5nc
    left join private.video_semantic_profiles p
      on p.video_id = c.id
      and p.status = 'ready'
      and p.semantic_input_version = 'video-semantic-v2'
      and p.provider = 'cloudflare_workers_ai'
      and p.model = '@cf/baai/bge-m3'
      and p.embedding_dimensions = 1024
      and p.embedding is not null
      and extensions.vector_norm(p.embedding) > 0
      and p.completed_at is not null
      and p.completed_at <= v_as_of
      and p.updated_at <= v_as_of
    where v_l5_effective
  ),
  like_features as (
    select l.video_id, count(*)::bigint as raw_likes
    from public.likes l
    cross join candidate_ids ci
    where l.video_id = any(ci.ids)
      and l.created_at <= v_as_of
    group by l.video_id
  ),
  comment_features as (
    select cmt.video_id, count(*)::bigint as raw_comments
    from public.comments cmt
    cross join candidate_ids ci
    where cmt.video_id = any(ci.ids)
      and cmt.created_at <= v_as_of
    group by cmt.video_id
  ),
  save_features as (
    select s.video_id, count(*)::bigint as raw_saves
    from public.video_saves s
    cross join candidate_ids ci
    where s.video_id = any(ci.ids)
      and s.created_at <= v_as_of
    group by s.video_id
  ),
  watch_features as (
    select
      vv.video_id,
      count(*)::bigint as raw_exposures,
      count(*) filter (where vv.media_duration_ms is not null)::bigint as duration_samples,
      avg(case when vv.media_duration_ms is not null then vv.completed::integer end)::numeric
        as completion_rate,
      coalesce(sum(vv.rewatch_count) filter (where vv.media_duration_ms is not null), 0)::numeric
        as total_rewatches
    from public.video_views vv
    cross join candidate_ids ci
    where vv.video_id = any(ci.ids)
      and vv.created_at <= v_as_of
    group by vv.video_id
  ),
  follow_features as (
    select f.following_id as creator_id, true as is_followed
    from public.follows f
    where v_viewer_id is not null
      and f.follower_id = v_viewer_id
      and f.created_at <= v_as_of
  ),
  viewer_history as (
    select
      vv.video_id,
      bool_or(vv.client_session_id = p_client_session_id) as same_session_seen,
      bool_or(
        vv.created_at >= v_as_of - make_interval(hours => v_policy.freshness_horizon_hours)
        and vv.media_duration_ms is not null
        and vv.completion_ratio < v_policy.short_watch_ratio_threshold
        and vv.exit_reason in ('swipe', 'background', 'unmount')
      ) as short_watch_seen,
      bool_or(
        vv.created_at >= v_as_of - make_interval(hours => v_policy.freshness_horizon_hours)
        and vv.completed is true
      ) as recent_completed,
      count(*) filter (
        where vv.created_at >= v_as_of - make_interval(hours => v_policy.freshness_horizon_hours)
      )::bigint as recent_exposures
    from public.video_views vv
    cross join candidate_ids ci
    where vv.video_id = any(ci.ids)
      and vv.created_at <= v_as_of
      and (
        (v_viewer_id is not null and vv.viewer_id = v_viewer_id)
        or (
          v_viewer_id is null
          and vv.viewer_id is null
          and vv.client_session_id = p_client_session_id
        )
      )
    group by vv.video_id
  ),
  components as (
    select
      c.*,
      coalesce(ecs.explicit_interest_similarity,0::numeric) as explicit_interest_similarity,
      case when v_personalization_effective and ecs.explicit_interest_similarity is not null
        then v_policy.explicit_interest_weight * v_explicit_seed_weight
          * greatest(0::numeric,ecs.explicit_interest_similarity)
        else 0::numeric end as explicit_interest_points,
      case when v_personalization_effective
        and ecs.detected_language = v_personalization_profile.primary_language_tag
        then v_policy.preferred_primary_language_weight
        when v_personalization_effective
        and ecs.detected_language = any(v_personalization_profile.additional_language_tags)
        then v_policy.preferred_additional_language_weight
        else 0::numeric end as preferred_language_points,
      case when v_personalization_effective
        and v_personalization_profile.content_region_code <> 'GLOBAL'
        and creator_profile.content_region_code = v_personalization_profile.content_region_code
        then v_policy.content_region_weight
        else 0::numeric end as content_region_points,
      v_explicit_seed_weight as explicit_seed_weight,
      v_behavioral_confidence as behavioral_confidence,
      greatest(
        0::numeric,
        v_policy.freshness_weight * (
          1 - least(
            1::numeric,
            greatest(0::numeric, extract(epoch from (v_as_of - c.created_at))::numeric / 3600)
              / v_policy.freshness_horizon_hours
          )
        )
      ) as freshness_points,
      case when coalesce(ff.is_followed, false) then v_policy.follow_weight else 0 end
        as follow_points,
      v_policy.like_weight * least(
        1::numeric,
        pg_catalog.ln(1 + coalesce(lf.raw_likes, 0)::numeric) / pg_catalog.ln(101::numeric)
      ) as like_points,
      v_policy.comment_weight * least(
        1::numeric,
        pg_catalog.ln(1 + coalesce(cf.raw_comments, 0)::numeric) / pg_catalog.ln(101::numeric)
      ) as comment_points,
      v_policy.save_weight * least(
        1::numeric,
        pg_catalog.ln(1 + coalesce(sf.raw_saves, 0)::numeric) / pg_catalog.ln(101::numeric)
      ) as save_points,
      case
        when coalesce(wf.duration_samples, 0) >= v_policy.minimum_watch_samples
        then v_policy.completion_weight * coalesce(wf.completion_rate, 0)
        else 0
      end as completion_points,
      case
        when coalesce(wf.duration_samples, 0) >= v_policy.minimum_watch_samples
        then v_policy.rewatch_weight * least(
          1::numeric,
          coalesce(wf.total_rewatches, 0) / wf.duration_samples
        )
        else 0
      end as rewatch_points,
      v_policy.exploration_weight
        * (
          private.algo_l1_hash_u32_v1(
            coalesce(v_viewer_id::text, p_client_session_id::text)
            || '|' || c.id::text
            || '|' || v_policy.policy_version
          )::numeric / 4294967295::numeric
        )
        / pg_catalog.sqrt(1 + coalesce(wf.raw_exposures, 0)::numeric)
        as exploration_points,
      case when coalesce(vh.same_session_seen, false)
        then v_policy.same_session_penalty else 0 end as same_session_points,
      case when not v_cold_start and coalesce(vh.short_watch_seen, false)
        then v_policy.short_watch_penalty else 0 end as short_watch_points,
      case when not v_cold_start and coalesce(vh.recent_completed, false)
        then v_policy.recent_completed_penalty else 0 end as completed_points,
      case when not v_cold_start then
        least(
          v_policy.repeat_view_penalty_cap,
          coalesce(vh.recent_exposures, 0) * v_policy.repeat_view_penalty
        )
        else 0
      end as repeat_points,
      case
        when not v_l2_effective
          or v_viewer_id is null
          or c.user_id = v_viewer_id
        then 0::numeric
        else coalesce(afs.creator_affinity_points, 0::numeric)
      end as creator_affinity_points,
      case
        when coalesce(l3rf.sample_count, 0) < v_policy.l3_quality_min_samples
        then 0::numeric
        else v_policy.l3_quality_weight
          * least(
              1::numeric,
              l3rf.sample_count::numeric / v_policy.l3_quality_full_confidence_samples
            )
          * greatest(
              -1::numeric,
              least(
                1::numeric,
                0.60::numeric * coalesce(l3rf.completion_rate, 0::numeric)
                  + 0.40::numeric * coalesce(l3rf.long_watch_rate, 0::numeric)
                  - coalesce(l3rf.early_exit_rate, 0::numeric)
              )
            )
      end as l3_quality_points,
      coalesce(l3cbf.creator_burst_penalty, 0::numeric) as creator_burst_penalty,
      coalesce(l3df.duplicate_penalty, 0::numeric) as duplicate_penalty,
      case
        when v_viewer_id is not null and c.user_id = v_viewer_id then 0::numeric
        else least(
          v_policy.l4_positive_creator_cap,
          coalesce(l4cc.positive_distinct_videos, 0)::numeric
            * v_policy.l4_positive_creator_weight
        )
      end as positive_creator_points,
      case
        when coalesce(l4cc.negative_distinct_videos, 0)
          >= v_policy.l4_negative_min_distinct_videos
        then least(
          v_policy.l4_negative_creator_penalty_cap,
          l4cc.negative_distinct_videos::numeric
            * v_policy.l4_negative_creator_penalty_per_video
        )
        else 0::numeric
      end as negative_creator_penalty,
      least(
        v_policy.l4_creator_repeat_penalty_cap,
        greatest(
          0::numeric,
          coalesce(l4cc.session_distinct_videos_seen, 0)::numeric
            - v_policy.l4_creator_repeat_free_videos
        ) * v_policy.l4_creator_repeat_penalty_per_video
      ) as creator_session_repeat_penalty,
      case
        when not v_l5_effective
          or v_viewer_id is null
          or c.user_id = v_viewer_id
          or l5cs.positive_similarity is null
        then 0::numeric
        else least(
          v_policy.l5_semantic_positive_cap,
          v_policy.l5_semantic_positive_cap
            * least(
                1::numeric,
                l5cs.positive_distinct_video_count::numeric
                  / v_policy.l5_semantic_full_confidence_videos
              )
            * least(
                1::numeric,
                greatest(
                  0::numeric,
                  (l5cs.positive_similarity - v_policy.l5_semantic_positive_similarity_floor)
                    / (1 - v_policy.l5_semantic_positive_similarity_floor)
                )
              )
        )
      end as l5_semantic_positive_points,
      case
        when not v_l5_effective
          or v_viewer_id is null
          or c.user_id = v_viewer_id
          or l5cs.negative_similarity is null
        then 0::numeric
        else least(
          v_policy.l5_semantic_negative_cap,
          v_policy.l5_semantic_negative_cap
            * least(
                1::numeric,
                l5cs.negative_distinct_video_count::numeric
                  / v_policy.l5_semantic_full_confidence_videos
              )
            * least(
                1::numeric,
                greatest(
                  0::numeric,
                  (l5cs.negative_similarity - v_policy.l5_semantic_negative_similarity_floor)
                    / (1 - v_policy.l5_semantic_negative_similarity_floor)
                )
              )
        )
      end as l5_semantic_negative_penalty
    from candidates c
    left join like_features lf on lf.video_id = c.id
    left join comment_features cf on cf.video_id = c.id
    left join save_features sf on sf.video_id = c.id
    left join watch_features wf on wf.video_id = c.id
    left join follow_features ff on ff.creator_id = c.user_id
    left join viewer_history vh on vh.video_id = c.id
    left join affinity_creator_scores afs on afs.creator_id = c.user_id
    left join l3_retention_features l3rf on l3rf.video_id = c.id
    left join l3_creator_burst_features l3cbf on l3cbf.creator_id = c.user_id
    left join l3_duplicate_features l3df on l3df.video_id = c.id
    left join l4_creator_context l4cc on l4cc.creator_id = c.user_id
    left join l5_candidate_semantics l5cs on l5cs.video_id = c.id
    left join explicit_candidate_semantics ecs on ecs.video_id = c.id
    left join private.user_personalization_profiles creator_profile
      on creator_profile.user_id = c.user_id
      and creator_profile.onboarding_completed_at is not null
  ),
  adjusted_components as (
    select
      components.*,
      case
        when v_l3_effective then
          l3_quality_points
          - creator_burst_penalty
          - duplicate_penalty
        else 0::numeric
      end as l3_adjustment,
      case
        when v_l4_effective then
          positive_creator_points
          - negative_creator_penalty
          - creator_session_repeat_penalty
        else 0::numeric
      end as l4_context_adjustment,
      case
        when v_l5_effective then
          l5_semantic_positive_points
          - l5_semantic_negative_penalty
        else 0::numeric
      end as l5_semantic_adjustment
    from components
  ),
  model_features as (
    select
      adjusted_components.*,
      case when v_l6_effective then jsonb_build_object(
        'freshness_points',freshness_points,'follow_points',follow_points,
        'like_points',like_points,'comment_points',comment_points,'save_points',save_points,
        'completion_points',completion_points,'rewatch_points',rewatch_points,
        'exploration_points',exploration_points,'same_session_points',same_session_points,
        'short_watch_points',short_watch_points,'completed_points',completed_points,
        'repeat_points',repeat_points,'creator_affinity_points',creator_affinity_points,
        'l3_quality_points',l3_quality_points,'creator_burst_penalty',creator_burst_penalty,
        'duplicate_penalty',duplicate_penalty,'l3_adjustment',l3_adjustment,
        'positive_creator_points',positive_creator_points,'negative_creator_penalty',negative_creator_penalty,
        'creator_session_repeat_penalty',creator_session_repeat_penalty,
        'l4_context_adjustment',l4_context_adjustment,
        'l5_semantic_positive_points',l5_semantic_positive_points,
        'l5_semantic_negative_penalty',l5_semantic_negative_penalty,
        'l5_semantic_adjustment',l5_semantic_adjustment,
        'explicit_interest_similarity',explicit_interest_similarity,
        'explicit_interest_points',explicit_interest_points,
        'preferred_language_points',preferred_language_points,
        'content_region_points',content_region_points,
        'explicit_seed_weight',explicit_seed_weight,'behavioral_confidence',behavioral_confidence
      ) else null::jsonb end as model_feature_snapshot
    from adjusted_components
  ),
  model_raw_scores as materialized (
    select
      mf.id,
      head.key as head,
      coalesce((head.value->>'intercept')::numeric,0)
      + coalesce(sum(
          coefficient.value::numeric
          * coalesce((mf.model_feature_snapshot->>coefficient.key)::numeric,0)
        ) filter(where coefficient.key is not null),0) as raw_score,
      head.value as head_payload
    from model_features mf
    cross join lateral jsonb_each(v_l6_model_payload->'heads') head
    left join lateral jsonb_each_text(
      coalesce(head.value->'coefficients','{}'::jsonb)
    ) coefficient on true
    where v_l6_effective
    group by mf.id,head.key,head.value
  ),
  model_probability_pivot as materialized (
      select calibrated.id,
        max(calibrated.probability) filter(where calibrated.head='long_watch') as long_watch,
        max(calibrated.probability) filter(where calibrated.head='completion') as completion,
        max(calibrated.probability) filter(where calibrated.head='early_exit') as early_exit,
        max(calibrated.probability) filter(where calibrated.head='rewatch') as rewatch,
        max(calibrated.probability) filter(where calibrated.head='save') as save,
        max(calibrated.probability) filter(where calibrated.head='like') as like
      from (
        select mrs.id,mrs.head,
          1::numeric / (1::numeric + pg_catalog.exp(-greatest(-40::numeric,least(40::numeric,
            coalesce((mrs.head_payload->>'calibration_coefficient')::numeric,1)*mrs.raw_score
            + coalesce((mrs.head_payload->>'calibration_intercept')::numeric,0)
          )))) as probability
        from model_raw_scores mrs
      ) calibrated
      group by calibrated.id
  ),
  model_predictions as (
    select model_features.*,
      coalesce(prediction.long_watch,0) as l6_long_watch_probability,
      coalesce(prediction.completion,0) as l6_completion_probability,
      coalesce(prediction.early_exit,0) as l6_early_exit_probability,
      coalesce(prediction.rewatch,0) as l6_rewatch_probability,
      coalesce(prediction.save,0) as l6_save_probability,
      coalesce(prediction.like,0) as l6_like_probability
    from model_features
    left join model_probability_pivot prediction using(id)
  ),
  model_objective as (
    select model_predictions.*,
      case when v_l6_effective then
        l6_long_watch_probability*(v_policy.l6_objective_weights->>'long_watch')::numeric
        +l6_completion_probability*(v_policy.l6_objective_weights->>'completion')::numeric
        +l6_early_exit_probability*(v_policy.l6_objective_weights->>'early_exit')::numeric
        +l6_rewatch_probability*(v_policy.l6_objective_weights->>'rewatch')::numeric
        +l6_save_probability*(v_policy.l6_objective_weights->>'save')::numeric
        +l6_like_probability*(v_policy.l6_objective_weights->>'like')::numeric
      else 0::numeric end as l6_model_score
    from model_predictions
  ),
  scored as (
    select
      model_objective.*,
      case
        when v_behavioral then round((
          freshness_points
          + follow_points
          + like_points
          + comment_points
          + save_points
          + completion_points
          + rewatch_points
          + exploration_points
          + creator_affinity_points
          + l3_adjustment
          + l4_context_adjustment
          + l5_semantic_adjustment
          + explicit_interest_points
          + preferred_language_points
          + content_region_points
          + case when v_l6_effective then v_policy.l6_model_score_weight*l6_model_score else 0 end
          - same_session_points
          - short_watch_points
          - completed_points
          - repeat_points
        )::numeric, 6)
        else 0::numeric
      end::numeric(18,6) as rank_score
    from model_objective
  ),
  creator_numbered as (
    select
      s.*,
      row_number() over (
        partition by s.user_id
        order by s.rank_score desc, s.created_at desc, s.id desc
      ) as creator_rank
    from scored s
  ),
  diversified as (
    select
      cn.*,
      case when v_behavioral
        then ((cn.creator_rank - 1) / v_policy.creator_page_cap)::bigint
        else 0::bigint
      end as diversity_tier,
      case when v_behavioral
        then round(
          cn.rank_score
          - (((cn.creator_rank - 1) / v_policy.creator_page_cap)::numeric * 10000),
          6
        )
        else cn.rank_score
      end::numeric(18,6) as delivery_score
    from creator_numbered cn
  ),
  after_cursor as (
    select d.*
    from diversified d
    where p_as_of is null
       or (d.delivery_score, d.created_at, d.id)
          < (p_before_score, p_before_created_at, p_before_id)
  ),
  current_tier as (
    select min(ac.diversity_tier) as value
    from after_cursor ac
  ),
  preferred_numbered as (
    select
      ac.*,
      row_number() over (
        order by ac.delivery_score desc, ac.created_at desc, ac.id desc
      ) as preferred_rank
    from after_cursor ac
    cross join current_tier ct
    where ac.diversity_tier = ct.value
  ),
  pass_one as (
    select pn.*
    from preferred_numbered pn
    where pn.preferred_rank <= v_page_limit
  ),
  fill_count as (
    select greatest(0, v_page_limit - count(*)::integer) as needed
    from pass_one
  ),
  fill_numbered as (
    select
      ac.*,
      row_number() over (
        order by ac.delivery_score desc, ac.created_at desc, ac.id desc
      ) as fill_rank
    from after_cursor ac
    where not exists (select 1 from pass_one p1 where p1.id = ac.id)
  ),
  page_rows as (
    select p1.* from pass_one p1
    union all
    select fn.* from fill_numbered fn
    cross join fill_count fc
    where fn.fill_rank <= fc.needed
  ),
  observed_page as materialized (
    select
      pr.*,
      row_number() over (
        order by pr.delivery_score desc, pr.created_at desc, pr.id desc
      )::integer as organic_position,
      -- feature_snapshot_v2_begin
      jsonb_build_object(
        'freshness_points', pr.freshness_points,
        'follow_points', pr.follow_points,
        'like_points', pr.like_points,
        'comment_points', pr.comment_points,
        'save_points', pr.save_points,
        'completion_points', pr.completion_points,
        'rewatch_points', pr.rewatch_points,
        'exploration_points', pr.exploration_points,
        'same_session_points', pr.same_session_points,
        'short_watch_points', pr.short_watch_points,
        'completed_points', pr.completed_points,
        'repeat_points', pr.repeat_points,
        'creator_affinity_points', pr.creator_affinity_points,
        'l3_quality_points', pr.l3_quality_points,
        'creator_burst_penalty', pr.creator_burst_penalty,
        'duplicate_penalty', pr.duplicate_penalty,
        'l3_adjustment', pr.l3_adjustment,
        'positive_creator_points', pr.positive_creator_points,
        'negative_creator_penalty', pr.negative_creator_penalty,
        'creator_session_repeat_penalty', pr.creator_session_repeat_penalty,
        'l4_context_adjustment', pr.l4_context_adjustment,
        'l5_semantic_positive_points', pr.l5_semantic_positive_points,
        'l5_semantic_negative_penalty', pr.l5_semantic_negative_penalty,
        'l5_semantic_adjustment', pr.l5_semantic_adjustment,
        'explicit_interest_similarity', pr.explicit_interest_similarity,
        'explicit_interest_points', pr.explicit_interest_points,
        'preferred_language_points', pr.preferred_language_points,
        'content_region_points', pr.content_region_points,
        'explicit_seed_weight', pr.explicit_seed_weight,
        'behavioral_confidence', pr.behavioral_confidence
      ) as feature_snapshot
      -- feature_snapshot_v2_end
    from page_rows pr
  ),
  observation_payload as materialized (
    select
      (select count(*)::integer from candidates) as candidate_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'organic_position', op.organic_position,
            'video_id', op.id,
            'creator_id', op.user_id,
            'is_self_authored', coalesce(op.user_id = v_viewer_id, false),
            'rank_score', op.rank_score,
            'delivery_score', op.delivery_score,
            'feature_snapshot', op.feature_snapshot
          )
          order by op.organic_position
        ) filter (where op.id is not null),
        '[]'::jsonb
      ) as items
    from observed_page op
  ),
  observation_decision as materialized (
    select private.record_organic_ranking_decision_v1(
      v_viewer_id,
      p_client_session_id,
      v_as_of,
      v_mode,
      v_effective_policy_version,
      v_policy.policy_version,
      v_policy.canary_generation,
      v_policy.canary_target_layer,
      v_directed_canary,
      v_policy.production_rollout_bps,
      payload.candidate_count,
      coalesce(p_limit, 10),
      v_page_limit,
      p_before_score,
      p_before_created_at,
      p_before_id,
      'organic-ranking-observation-v1',
      'organic-ranking-features-personalization-v2',
      payload.items
    ) as ranking_decision_id
    from observation_payload payload
  )
  select
    op.id,
    op.user_id,
    op.video_url,
    op.thumbnail_url,
    op.media_urls,
    op.caption,
    op.music,
    op.likes_count,
    op.comments_count,
    op.shares_count,
    op.views_count,
    op.saves_count,
    op.created_at,
    op.edited_at,
    op.creator_username,
    op.creator_avatar,
    v_mode as ranking_mode,
    v_effective_policy_version as policy_version,
    op.rank_score as rank_score,
    v_as_of as feed_as_of,
    op.delivery_score as cursor_score,
    op.created_at as cursor_created_at,
    op.id as cursor_id,
    v_page_limit as effective_page_limit,
    observed.ranking_decision_id as ranking_decision_id,
    case
      when observed.ranking_decision_id is null then null
      else op.organic_position
    end as observed_organic_position,
    op.id is null as observation_empty
  from observation_decision observed
  left join observed_page op on true
  order by op.delivery_score desc nulls last, op.created_at desc nulls last, op.id desc nulls last
  loop
    if v_output.observation_empty then
      continue;
    end if;

    id := v_output.id;
    user_id := v_output.user_id;
    video_url := v_output.video_url;
    thumbnail_url := v_output.thumbnail_url;
    media_urls := v_output.media_urls;
    caption := v_output.caption;
    music := v_output.music;
    likes_count := v_output.likes_count;
    comments_count := v_output.comments_count;
    shares_count := v_output.shares_count;
    views_count := v_output.views_count;
    saves_count := v_output.saves_count;
    created_at := v_output.created_at;
    edited_at := v_output.edited_at;
    creator_username := v_output.creator_username;
    creator_avatar := v_output.creator_avatar;
    ranking_mode := v_output.ranking_mode;
    policy_version := v_output.policy_version;
    rank_score := v_output.rank_score;
    feed_as_of := v_output.feed_as_of;
    cursor_score := v_output.cursor_score;
    cursor_created_at := v_output.cursor_created_at;
    cursor_id := v_output.cursor_id;
    effective_page_limit := v_output.effective_page_limit;
    ranking_decision_id := v_output.ranking_decision_id;
    ranking_organic_position := v_output.observed_organic_position;
    return next;
  end loop;
end;
$$;

revoke all on function public.get_ranked_feed_l1_v1(
  uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text
) from public, anon, authenticated, service_role;
grant execute on function public.get_ranked_feed_l1_v1(
  uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text
) to anon, authenticated;

commit;
