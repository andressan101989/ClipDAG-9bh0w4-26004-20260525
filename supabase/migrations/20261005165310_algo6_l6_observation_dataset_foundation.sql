begin;

do $$
declare
  v_existing integer;
begin
  select count(*) into v_existing
  from cron.job
  where jobname = 'algo6_l6_observation_retention_v1';
  if v_existing <> 0 then
    raise exception 'algo6_l6_observation_retention_job_already_exists'
      using errcode = '55000';
  end if;
end;
$$;

do $$
declare
  v_function oid;
  v_dependents integer;
begin
  select p.oid into v_function
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_ranked_feed_l1_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_client_session_id uuid, p_limit integer, p_as_of timestamp with time zone, p_before_score numeric, p_before_created_at timestamp with time zone, p_before_id uuid, p_policy_version text';

  if v_function is null then
    raise exception 'algo6_l6_canonical_ranking_function_missing'
      using errcode = '55000';
  end if;

  select count(*) into v_dependents
  from pg_catalog.pg_depend d
  where d.refclassid = 'pg_proc'::pg_catalog.regclass
    and d.refobjid = v_function
    and not (d.classid = 'pg_proc'::pg_catalog.regclass and d.objid = v_function);

  if v_dependents <> 0 then
    raise exception 'algo6_l6_canonical_ranking_function_has_dependents'
      using errcode = '55000';
  end if;
end;
$$;

create table private.organic_ranking_decisions (
  id uuid primary key,
  viewer_user_id uuid null,
  client_session_id uuid not null,
  feed_as_of timestamp with time zone not null,
  ranking_mode text not null
    check (ranking_mode in (
      'chronological','behavioral_l1','behavioral_l2',
      'behavioral_l3','behavioral_l4','behavioral_l5'
    )),
  policy_version text not null check (btrim(policy_version) <> ''),
  base_policy_version text not null check (btrim(base_policy_version) <> ''),
  canary_generation bigint not null check (canary_generation >= 0),
  canary_target_layer text not null
    check (canary_target_layer in ('l1','l2','l3','l4','l5')),
  directed_canary boolean not null,
  production_rollout_bps integer not null
    check (production_rollout_bps between 0 and 10000),
  candidate_count integer not null check (candidate_count >= 0),
  returned_count integer not null check (returned_count between 0 and 50),
  requested_limit integer not null check (requested_limit > 0),
  effective_page_limit integer not null check (effective_page_limit between 1 and 50),
  cursor_before_score numeric null,
  cursor_before_created_at timestamp with time zone null,
  cursor_before_id uuid null,
  observation_schema_version text not null
    check (observation_schema_version = 'organic-ranking-observation-v1'),
  feature_contract_version text not null
    check (feature_contract_version = 'organic-ranking-features-l1-l5-v1'),
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint organic_ranking_decisions_returned_candidate_check
    check (returned_count <= candidate_count),
  constraint organic_ranking_decisions_cursor_shape_check
    check (num_nonnulls(cursor_before_score,cursor_before_created_at,cursor_before_id) in (0,3))
);

create table private.organic_ranking_items (
  decision_id uuid not null
    references private.organic_ranking_decisions(id) on delete cascade,
  organic_position integer not null check (organic_position between 1 and 50),
  video_id uuid not null,
  creator_id uuid not null,
  is_self_authored boolean not null,
  rank_score numeric(18,6) not null,
  delivery_score numeric(18,6) not null,
  feature_snapshot jsonb not null check (jsonb_typeof(feature_snapshot) = 'object'),
  primary key (decision_id, organic_position),
  unique (decision_id, video_id),
  unique (decision_id, organic_position, video_id)
);

create table private.organic_ranking_impressions (
  client_event_id uuid primary key,
  decision_id uuid not null,
  organic_position integer not null,
  video_id uuid not null,
  viewer_user_id uuid null,
  client_session_id uuid not null,
  surface_position integer not null check (surface_position between 1 and 1000),
  viewability_contract_version text not null
    check (viewability_contract_version = 'organic-feed-viewability-75pct-v1'),
  visible_percent_threshold integer not null
    check (visible_percent_threshold = 75),
  created_at timestamp with time zone not null default clock_timestamp(),
  foreign key (decision_id, organic_position, video_id)
    references private.organic_ranking_items(decision_id, organic_position, video_id)
    on delete cascade
);

create table private.organic_ranking_engagement_events (
  client_action_id uuid primary key,
  impression_client_event_id uuid not null
    references private.organic_ranking_impressions(client_event_id) on delete cascade,
  decision_id uuid not null,
  video_id uuid not null,
  creator_id uuid not null,
  viewer_user_id uuid not null,
  client_session_id uuid not null,
  action text not null check (action in ('like','unlike','save','unsave','follow','unfollow')),
  attribution_contract_version text not null
    check (attribution_contract_version = 'organic-engagement-24h-v1'),
  created_at timestamp with time zone not null default clock_timestamp()
);

create index organic_ranking_decisions_created_at_idx
  on private.organic_ranking_decisions(created_at desc);
create index organic_ranking_items_video_idx
  on private.organic_ranking_items(video_id, decision_id);
create index organic_ranking_impressions_decision_idx
  on private.organic_ranking_impressions(decision_id, organic_position, video_id);
create index organic_ranking_impressions_created_at_idx
  on private.organic_ranking_impressions(created_at desc);
create index organic_ranking_engagement_impression_idx
  on private.organic_ranking_engagement_events(impression_client_event_id, created_at);
create index organic_ranking_engagement_action_created_idx
  on private.organic_ranking_engagement_events(action, created_at desc);

alter table private.organic_ranking_decisions enable row level security;
alter table private.organic_ranking_decisions force row level security;
alter table private.organic_ranking_items enable row level security;
alter table private.organic_ranking_items force row level security;
alter table private.organic_ranking_impressions enable row level security;
alter table private.organic_ranking_impressions force row level security;
alter table private.organic_ranking_engagement_events enable row level security;
alter table private.organic_ranking_engagement_events force row level security;

revoke all on table private.organic_ranking_decisions from public, anon, authenticated, service_role;
revoke all on table private.organic_ranking_items from public, anon, authenticated, service_role;
revoke all on table private.organic_ranking_impressions from public, anon, authenticated, service_role;
revoke all on table private.organic_ranking_engagement_events from public, anon, authenticated, service_role;

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
  v_allowed_keys text[] := array[
    'freshness_points','follow_points','like_points','comment_points','save_points',
    'completion_points','rewatch_points','exploration_points','same_session_points',
    'short_watch_points','completed_points','repeat_points','creator_affinity_points',
    'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
    'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
    'l4_context_adjustment','l5_semantic_positive_points',
    'l5_semantic_negative_penalty','l5_semantic_adjustment'
  ];
begin
  begin
    if p_client_session_id is null
       or p_feed_as_of is null
       or p_ranking_mode not in (
         'chronological','behavioral_l1','behavioral_l2',
         'behavioral_l3','behavioral_l4','behavioral_l5'
       )
       or nullif(btrim(p_policy_version), '') is null
       or nullif(btrim(p_base_policy_version), '') is null
       or p_canary_generation is null or p_canary_generation < 0
       or p_canary_target_layer not in ('l1','l2','l3','l4','l5')
       or p_directed_canary is null
       or p_production_rollout_bps not between 0 and 10000
       or p_candidate_count is null or p_candidate_count < 0
       or p_requested_limit is null or p_requested_limit <= 0
       or p_effective_page_limit not between 1 and 50
       or num_nonnulls(
         p_cursor_before_score,p_cursor_before_created_at,p_cursor_before_id
       ) not in (0,3)
       or p_observation_schema_version <> 'organic-ranking-observation-v1'
       or p_feature_contract_version <> 'organic-ranking-features-l1-l5-v1'
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
         or (select count(*) from jsonb_object_keys(entry.item->'feature_snapshot')) <> 24
         or not (entry.item->'feature_snapshot' ?& v_allowed_keys)
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

create or replace function public.record_organic_ranking_impression_v1(
  p_decision_id uuid,
  p_video_id uuid,
  p_client_event_id uuid,
  p_client_session_id uuid,
  p_surface_position integer
)
returns table (
  status text,
  client_event_id uuid,
  decision_id uuid,
  organic_position integer,
  video_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing private.organic_ranking_impressions%rowtype;
  v_decision private.organic_ranking_decisions%rowtype;
  v_position integer;
  v_inserted integer;
begin
  if p_decision_id is null or p_video_id is null
     or p_client_event_id is null or p_client_session_id is null
     or p_surface_position not between 1 and 1000 then
    raise exception 'organic_ranking_impression_invalid' using errcode = '22023';
  end if;

  select * into v_existing
  from private.organic_ranking_impressions i
  where i.client_event_id = p_client_event_id;

  if found then
    if v_existing.decision_id = p_decision_id
       and v_existing.video_id = p_video_id
       and v_existing.client_session_id = p_client_session_id
       and v_existing.surface_position = p_surface_position
       and v_existing.viewer_user_id is not distinct from v_actor then
      return query select 'existing',v_existing.client_event_id,
        v_existing.decision_id,v_existing.organic_position,v_existing.video_id;
      return;
    end if;
    raise exception 'organic_ranking_impression_event_conflict' using errcode = '23505';
  end if;

  select * into v_decision
  from private.organic_ranking_decisions d
  where d.id = p_decision_id;

  if not found
     or v_decision.client_session_id <> p_client_session_id
     or v_decision.viewer_user_id is distinct from v_actor then
    raise exception 'organic_ranking_impression_not_authorized' using errcode = '42501';
  end if;

  select item.organic_position into v_position
  from private.organic_ranking_items item
  where item.decision_id = p_decision_id
    and item.video_id = p_video_id;

  if not found then
    raise exception 'organic_ranking_impression_item_missing' using errcode = '22023';
  end if;

  insert into private.organic_ranking_impressions(
    client_event_id,decision_id,organic_position,video_id,viewer_user_id,
    client_session_id,surface_position,viewability_contract_version,
    visible_percent_threshold
  ) values (
    p_client_event_id,p_decision_id,v_position,p_video_id,v_actor,
    p_client_session_id,p_surface_position,'organic-feed-viewability-75pct-v1',75
  )
  on conflict on constraint organic_ranking_impressions_pkey do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
  from private.organic_ranking_impressions i
  where i.client_event_id = p_client_event_id;

  if v_existing.decision_id = p_decision_id
     and v_existing.video_id = p_video_id
     and v_existing.client_session_id = p_client_session_id
     and v_existing.surface_position = p_surface_position
     and v_existing.viewer_user_id is not distinct from v_actor then
    return query select case when v_inserted = 1 then 'recorded' else 'existing' end,
      v_existing.client_event_id,v_existing.decision_id,
      v_existing.organic_position,v_existing.video_id;
    return;
  end if;

  raise exception 'organic_ranking_impression_event_conflict' using errcode = '23505';
end;
$$;

revoke all on function public.record_organic_ranking_impression_v1(
  uuid,uuid,uuid,uuid,integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_organic_ranking_impression_v1(
  uuid,uuid,uuid,uuid,integer
) to anon, authenticated;

create or replace function public.record_organic_ranking_engagement_v1(
  p_impression_client_event_id uuid,
  p_client_action_id uuid,
  p_action text
)
returns table (
  status text,
  client_action_id uuid,
  impression_client_event_id uuid,
  action text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamp with time zone := clock_timestamp();
  v_existing private.organic_ranking_engagement_events%rowtype;
  v_impression_decision_id uuid;
  v_impression_video_id uuid;
  v_impression_viewer_user_id uuid;
  v_impression_client_session_id uuid;
  v_impression_created_at timestamp with time zone;
  v_creator_id uuid;
  v_state_matches boolean;
  v_inserted integer;
begin
  if v_actor is null then
    raise exception 'organic_ranking_engagement_auth_required' using errcode = '42501';
  end if;
  if p_impression_client_event_id is null or p_client_action_id is null
     or p_action not in ('like','unlike','save','unsave','follow','unfollow') then
    raise exception 'organic_ranking_engagement_invalid' using errcode = '22023';
  end if;

  select * into v_existing
  from private.organic_ranking_engagement_events e
  where e.client_action_id = p_client_action_id;

  if found then
    if v_existing.impression_client_event_id = p_impression_client_event_id
       and v_existing.action = p_action then
      if v_existing.viewer_user_id is distinct from v_actor then
        raise exception 'organic_ranking_engagement_not_authorized' using errcode = '42501';
      end if;
      return query select 'existing',v_existing.client_action_id,
        v_existing.impression_client_event_id,v_existing.action;
      return;
    end if;
    raise exception 'organic_ranking_engagement_event_conflict' using errcode = '23505';
  end if;

  select i.decision_id,i.video_id,i.viewer_user_id,i.client_session_id,
    i.created_at,item.creator_id
  into v_impression_decision_id,v_impression_video_id,v_impression_viewer_user_id,
    v_impression_client_session_id,v_impression_created_at,v_creator_id
  from private.organic_ranking_impressions i
  join private.organic_ranking_items item
    on item.decision_id = i.decision_id
   and item.organic_position = i.organic_position
   and item.video_id = i.video_id
  where i.client_event_id = p_impression_client_event_id;

  if not found or v_impression_viewer_user_id is distinct from v_actor then
    raise exception 'organic_ranking_engagement_not_authorized' using errcode = '42501';
  end if;
  if v_now < v_impression_created_at
     or v_now > v_impression_created_at + interval '24 hours' then
    raise exception 'organic_ranking_engagement_outside_window' using errcode = '22023';
  end if;

  if v_actor = v_creator_id then
    return query select 'ignored_self_action',p_client_action_id,
      p_impression_client_event_id,p_action;
    return;
  end if;

  v_state_matches := case p_action
    when 'like' then exists (
      select 1 from public.likes l
      where l.user_id = v_actor and l.video_id = v_impression_video_id
    )
    when 'unlike' then not exists (
      select 1 from public.likes l
      where l.user_id = v_actor and l.video_id = v_impression_video_id
    )
    when 'save' then exists (
      select 1 from public.video_saves s
      where s.user_id = v_actor and s.video_id = v_impression_video_id
    )
    when 'unsave' then not exists (
      select 1 from public.video_saves s
      where s.user_id = v_actor and s.video_id = v_impression_video_id
    )
    when 'follow' then exists (
      select 1 from public.follows f
      where f.follower_id = v_actor and f.following_id = v_creator_id
    )
    when 'unfollow' then not exists (
      select 1 from public.follows f
      where f.follower_id = v_actor and f.following_id = v_creator_id
    )
    else false
  end;

  if not v_state_matches then
    raise exception 'organic_ranking_engagement_state_mismatch' using errcode = '22023';
  end if;

  insert into private.organic_ranking_engagement_events(
    client_action_id,impression_client_event_id,decision_id,video_id,creator_id,
    viewer_user_id,client_session_id,action,attribution_contract_version
  ) values (
    p_client_action_id,p_impression_client_event_id,v_impression_decision_id,
    v_impression_video_id,v_creator_id,v_actor,v_impression_client_session_id,
    p_action,'organic-engagement-24h-v1'
  )
  on conflict on constraint organic_ranking_engagement_events_pkey do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
  from private.organic_ranking_engagement_events e
  where e.client_action_id = p_client_action_id;

  if v_existing.impression_client_event_id = p_impression_client_event_id
     and v_existing.action = p_action then
    return query select case when v_inserted = 1 then 'recorded' else 'existing' end,
      v_existing.client_action_id,v_existing.impression_client_event_id,v_existing.action;
    return;
  end if;

  raise exception 'organic_ranking_engagement_event_conflict' using errcode = '23505';
end;
$$;

revoke all on function public.record_organic_ranking_engagement_v1(
  uuid,uuid,text
) from public, anon, authenticated, service_role;
grant execute on function public.record_organic_ranking_engagement_v1(
  uuid,uuid,text
) to authenticated;

create or replace function public.get_algo6_l6_observation_progress_v1()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'decisions_total', (select count(*) from private.organic_ranking_decisions),
    'decisions_1d', (select count(*) from private.organic_ranking_decisions where created_at >= clock_timestamp() - interval '1 day'),
    'decisions_7d', (select count(*) from private.organic_ranking_decisions where created_at >= clock_timestamp() - interval '7 days'),
    'decisions_30d', (select count(*) from private.organic_ranking_decisions where created_at >= clock_timestamp() - interval '30 days'),
    'decisions_90d', (select count(*) from private.organic_ranking_decisions where created_at >= clock_timestamp() - interval '90 days'),
    'decision_items', (select count(*) from private.organic_ranking_items),
    'visible_impressions', (select count(*) from private.organic_ranking_impressions),
    'impressions_with_finalized_view', (
      select count(*)
      from private.organic_ranking_impressions i
      where exists (
        select 1 from public.video_views v where v.client_event_id = i.client_event_id
      )
    ),
    'view_link_coverage_ratio', (
      select case when count(*) = 0 then 0::numeric
        else round(
          count(*) filter (
            where exists (
              select 1 from public.video_views v where v.client_event_id = i.client_event_id
            )
          )::numeric / count(*)::numeric,
          6
        )
      end
      from private.organic_ranking_impressions i
    ),
    'mature_impressions', (
      select count(*) from private.organic_ranking_impressions
      where created_at <= clock_timestamp() - interval '24 hours'
    ),
    'authenticated_viewers_count', (
      select count(distinct viewer_user_id)
      from private.organic_ranking_impressions
      where viewer_user_id is not null
    ),
    'anonymous_client_sessions_count', (
      select count(distinct client_session_id)
      from private.organic_ranking_impressions
      where viewer_user_id is null
    ),
    'distinct_videos', (select count(distinct video_id) from private.organic_ranking_items),
    'distinct_creators', (select count(distinct creator_id) from private.organic_ranking_items),
    'engagement_events', jsonb_build_object(
      'like', (select count(*) from private.organic_ranking_engagement_events where action = 'like'),
      'unlike', (select count(*) from private.organic_ranking_engagement_events where action = 'unlike'),
      'save', (select count(*) from private.organic_ranking_engagement_events where action = 'save'),
      'unsave', (select count(*) from private.organic_ranking_engagement_events where action = 'unsave'),
      'follow', (select count(*) from private.organic_ranking_engagement_events where action = 'follow'),
      'unfollow', (select count(*) from private.organic_ranking_engagement_events where action = 'unfollow')
    ),
    'self_authored_impression_count', (
      select count(*)
      from private.organic_ranking_impressions i
      join private.organic_ranking_items item
        on item.decision_id = i.decision_id
       and item.organic_position = i.organic_position
       and item.video_id = i.video_id
      where item.is_self_authored
    ),
    'oldest_decision_at', (select min(created_at) from private.organic_ranking_decisions),
    'newest_decision_at', (select max(created_at) from private.organic_ranking_decisions)
  );
$$;

revoke all on function public.get_algo6_l6_observation_progress_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_algo6_l6_observation_progress_v1()
  to service_role;

create or replace function private.prune_algo6_l6_observations_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from private.organic_ranking_decisions
  where created_at < clock_timestamp() - interval '180 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.prune_algo6_l6_observations_v1()
  from public, anon, authenticated, service_role;

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
  v_l2_effective boolean;
  v_l3_effective boolean;
  v_l4_effective boolean;
  v_l5_effective boolean;
  v_effective_policy_version text;
  v_behavioral boolean;
  v_mode text;
  v_useful_actions bigint := 0;
  v_cold_start boolean;
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
  v_l2_effective := v_viewer_id is not null
    and (v_policy.l2_affinity_enabled or v_directed_l2_canary);
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
    );
  v_l3_effective := v_behavioral
    and (v_policy.l3_quality_enabled or v_directed_l3_canary);
  v_l4_effective := v_behavioral
    and (v_policy.l4_context_enabled or v_directed_l4_canary);
  v_l5_effective := v_behavioral
    and v_viewer_id is not null
    and (v_policy.l5_semantic_enabled or v_directed_l5_canary);
  v_mode := case
    when not v_behavioral then 'chronological'
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
      and l.created_at >= v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days)
    group by l.video_id
  ),
  l5_positive_save_signals as materialized (
    select s.video_id, max(s.created_at) as positive_signal
    from public.video_saves s
    where v_l5_effective
      and s.user_id = v_viewer_id
      and s.created_at <= v_as_of
      and s.created_at >= v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days)
    group by s.video_id
  ),
  l5_positive_view_signals as materialized (
    select vv.video_id, max(vv.created_at) as positive_signal
    from public.video_views vv
    where v_l5_effective
      and vv.viewer_id = v_viewer_id
      and vv.created_at <= v_as_of
      and vv.created_at >= v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days)
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
      and vv.created_at >= v_as_of - make_interval(days => v_policy.l5_semantic_horizon_days)
      and vv.media_duration_ms is not null
      and vv.media_duration_ms > 0
      and vv.completion_ratio is not null
  ),
  l5_negative_distinct as materialized (
    select nve.video_id, nve.latest_negative_signal
    from l5_negative_valid_events nve
    where nve.retention_rank = 1
      and nve.completion_ratio < v_policy.short_watch_ratio_threshold
      and nve.exit_reason in ('swipe', 'background', 'unmount')
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
  scored as (
    select
      adjusted_components.*,
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
          - same_session_points
          - short_watch_points
          - completed_points
          - repeat_points
        )::numeric, 6)
        else 0::numeric
      end::numeric(18,6) as rank_score
    from adjusted_components
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
      -- feature_snapshot_v1_begin
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
        'l5_semantic_adjustment', pr.l5_semantic_adjustment
      ) as feature_snapshot
      -- feature_snapshot_v1_end
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
      'organic-ranking-features-l1-l5-v1',
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

create or replace function public.reconcile_algo_l1_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranking_function as (
    select p.oid, p.proacl, p.proconfig, pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_ranked_feed_l1_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_client_session_id uuid, p_limit integer, p_as_of timestamp with time zone, p_before_score numeric, p_before_created_at timestamp with time zone, p_before_id uuid, p_policy_version text'
  ),
  request_function as (
    select p.oid, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'request_my_algo_l1_canary_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ),
  manage_function as (
    select p.oid, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'manage_algo_l1_canary_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_action text, p_request_id uuid, p_ttl_minutes integer'
  ),
  semantic_input_function as (
    select p.oid, p.proacl, p.proconfig, pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('video_semantic_input_v1','video_semantic_input_v2','video_semantic_visual_source_v1')
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_video_id uuid'
  ),
  semantic_queue_functions as (
    select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'refresh_video_semantic_profile_v1',
        'claim_video_semantic_profiles_v1',
        'complete_video_semantic_profile_v1',
        'fail_video_semantic_profile_v1'
      )
  )
  select jsonb_build_object(
    'l5_visual_semantic_authority_missing', (
      select case when
        pg_catalog.to_regprocedure('private.video_semantic_visual_source_v1(uuid)') is not null
        and pg_catalog.to_regprocedure('private.video_semantic_input_v2(uuid)') is not null
        and (
          select count(*) = 18
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attnum > 0
            and not a.attisdropped
            and a.attname in (
              'visual_semantic_status','visual_source_kind',
              'visual_source_fingerprint','visual_source_video_asset_id',
              'visual_source_media_asset_id','visual_provider','visual_model',
              'visual_prompt_version','visual_sample_strategy',
              'visual_frame_timestamps_ms','visual_semantic_text',
              'visual_semantic_fingerprint','visual_attempt_count',
              'visual_available_at','visual_started_at','visual_completed_at',
              'visual_last_error_code','visual_provider_call_count'
            )
        )
        and (
          select count(*) = 3
            and bool_and(
              p.prosecdef
              and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']::text[]
              and pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
            )
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in (
              'claim_video_semantic_visual_v1',
              'complete_video_semantic_visual_v1',
              'fail_video_semantic_visual_v1'
            )
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('cloudflare_workers_ai' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('@cf/google/gemma-4-26b-a4b-it' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('video-semantic-visual-v1' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname in (
              'visual_semantic_profiles','video_visual_embeddings',
              'video_semantic_visuals','visual_semantic_queue'
            )
        )
      then 0 else 1 end
    ),
    'l5_visual_semantic_sensitive_inference_present', (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in (
          'video_semantic_visual_source_v1',
          'video_semantic_input_v2',
          'sync_video_semantic_profile_v1'
        )
        and (
          lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(content_safety_visual_analyses|content_safety_alerts|public\\.reports|admin_user_warnings)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(person_identity|identity_inference|face_recognition|race_inference|ethnicity_inference|nationality_inference|religion_inference|sexual_orientation|gender_identity|health_inference|disability_inference|political_affiliation)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(advertising|marketplace|shipping|orders|financial_transactions|ledger_entries|wallet)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(public\\.messages|private_chat|user_profiles\\.location|gps|ip_address|device_model|network_type|network_state)'
        )
    ),
    'l5_vector_extension_missing', (
      select case when count(*) = 1
        and bool_and(n.nspname = 'extensions')
      then 0 else 1 end
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'vector'
    ),
    'l5_semantic_profile_authority_missing', (
      select case when
        pg_catalog.to_regclass('private.video_semantic_profiles') is not null
        and exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and c.relkind = 'r'
            and c.relrowsecurity
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          join pg_catalog.pg_type t on t.oid = a.atttypid
          join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attname = 'embedding'
            and not a.attisdropped
            and tn.nspname = 'extensions'
            and t.typname = 'vector'
            and pg_catalog.format_type(a.atttypid, a.atttypmod) ~ 'vector\(1024\)$'
        )
        and (
          select count(*) = 39
            and count(*) filter (
              where a.attname in (
                'video_id',
                'source_content_fingerprint',
                'semantic_input_version',
                'semantic_input_fingerprint',
                'caption_fingerprint',
                'source_transcript_id',
                'source_transcript_fingerprint',
                'detected_language',
                'provider',
                'model',
                'embedding_dimensions',
                'embedding',
                'status',
                'attempt_count',
                'available_at',
                'started_at',
                'completed_at',
                'last_error_code',
                'provider_call_count',
                'created_at',
                'updated_at'
              )
            ) = 21
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attnum > 0
            and not a.attisdropped
        )
        and (
          select count(*) = 15
          from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and con.conname in (
              'video_semantic_profiles_source_fingerprint_check',
              'video_semantic_profiles_input_version_check',
              'video_semantic_profiles_input_fingerprint_check',
              'video_semantic_profiles_caption_fingerprint_check',
              'video_semantic_profiles_transcript_fingerprint_check',
              'video_semantic_profiles_language_check',
              'video_semantic_profiles_provider_check',
              'video_semantic_profiles_model_check',
              'video_semantic_profiles_dimensions_check',
              'video_semantic_profiles_status_check',
              'video_semantic_profiles_attempt_check',
              'video_semantic_profiles_provider_calls_check',
              'video_semantic_profiles_error_check',
              'video_semantic_profiles_state_check',
              'video_semantic_profiles_timestamps_check'
            )
        )
        and exists (
          select 1
          from pg_catalog.pg_index i
          join pg_catalog.pg_class c on c.oid = i.indrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and i.indisprimary
        )
        and not pg_catalog.has_table_privilege(
          'public', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'anon', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'authenticated', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'service_role', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
      then 0 else 1 end
    ),
    'l5_semantic_queue_authority_missing', (
      select case when count(*) = 4
        and bool_and(
          prosecdef
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
          and pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('authenticated', oid, 'execute')
        )
        and pg_catalog.to_regprocedure('private.video_semantic_input_v1(uuid)') is not null
        and pg_catalog.to_regprocedure('private.sync_video_semantic_profile_v1(uuid)') is not null
        and (
          select count(*) = 2
          from pg_catalog.pg_trigger t
          where not t.tgisinternal
            and t.tgname in (
              'video_semantic_profile_sync',
              'video_semantic_profile_transcript_sync'
            )
        )
      then 0 else 1 end
      from semantic_queue_functions
    ),
    'l5_parallel_semantic_authority_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'video_embeddings',
          'content_embeddings',
          'semantic_embeddings',
          'video_semantic_scores',
          'semantic_ranking_cache',
          'user_interest_vectors',
          'user_semantic_profiles',
          'visual_semantic_profiles',
          'video_visual_embeddings',
          'video_semantic_visuals',
          'visual_semantic_queue'
        )
    ),
    'l5_sensitive_semantic_source_present', (
      select count(*)
      from semantic_input_function
      where position('content_safety_alerts' in lower(definition)) > 0
         or position('public.reports' in lower(definition)) > 0
         or position('admin_user_warnings' in lower(definition)) > 0
         or position('content_safety_visual_analyses' in lower(definition)) > 0
         or position('analysis_result' in lower(definition)) > 0
         or position('review_required' in lower(definition)) > 0
         or lower(definition) ~ '(advertising|marketplace|shipping|orders)'
         or lower(definition) ~ '(financial_transactions|ledger_entries|wallet)'
         or lower(definition) ~ '(public\\.messages|private_chat)'
         or lower(definition) ~ '(user_profiles\\.location|gps|ip_address)'
         or lower(definition) ~ '(call_devices|device_model|network_type|network_state)'
    ),
    'policy_singleton_invalid', (
      select case when count(*) = 1 and bool_and(singleton) then 0 else 1 end
      from private.algo_l1_policy
    ),
    'policy_values_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.production_rollout_bps not between 0 and 10000
         or p.candidate_pool_size not between 1 and 1000
         or p.max_page_size not between 1 and 50
         or p.freshness_horizon_hours not between 1 and 720
         or p.short_watch_ratio_threshold not between 0 and 1
         or p.minimum_watch_samples not between 1 and 100
         or p.creator_page_cap not between 1 and 50
         or p.cursor_ttl_minutes not between 1 and 1440
         or least(
           p.freshness_weight,p.follow_weight,p.like_weight,p.comment_weight,
           p.save_weight,p.completion_weight,p.rewatch_weight,p.exploration_weight,
           p.short_watch_penalty,p.recent_completed_penalty,p.repeat_view_penalty,
           p.repeat_view_penalty_cap,p.same_session_penalty
         ) < 0
    ),
    'l2_affinity_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l2_affinity_horizon_days not between 1 and 365
         or p.l2_affinity_long_watch_ratio_threshold not between 0 and 1
         or p.l2_affinity_negative_min_distinct_videos < 1
         or least(
           p.l2_affinity_like_weight,
           p.l2_affinity_comment_weight,
           p.l2_affinity_save_weight,
           p.l2_affinity_completed_weight,
           p.l2_affinity_long_watch_weight,
           p.l2_affinity_rewatch_weight,
           p.l2_affinity_short_watch_penalty,
           p.l2_affinity_per_video_positive_cap,
           p.l2_affinity_per_video_negative_cap,
           p.l2_affinity_creator_positive_cap,
           p.l2_affinity_creator_negative_cap
         ) < 0
    ),
    'l2_affinity_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l2_affinity_enabled
    ),
    'l2_affinity_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('affinity_creator_scores as' in lower(definition)) > 0
          and position('creator_affinity_points' in lower(definition)) > 0
          and position('behavioral_l2' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l2_affinity_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and (
          c.relname ~ '(affinity|creator_interest|user_interest)'
          or c.relname in ('creator_scores','user_creator_scores','affinity_cache')
        )
    ),
    'l3_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l3_retention_horizon_days not between 1 and 365
         or p.l3_quality_min_samples not between 1 and 100
         or p.l3_quality_full_confidence_samples
              not between p.l3_quality_min_samples and 1000
         or p.l3_long_watch_ratio_threshold not between 0 and 1
         or p.l3_creator_burst_horizon_hours not between 1 and 720
         or p.l3_creator_burst_free_posts not between 0 and 1000
         or p.l3_duplicate_horizon_days not between 1 and 3650
         or p.l3_creator_history_cap not between 1 and 1000
         or least(
           p.l3_quality_weight,
           p.l3_creator_burst_penalty_per_post,
           p.l3_creator_burst_penalty_cap,
           p.l3_duplicate_penalty
         ) < 0
         or greatest(
           p.l3_quality_weight,
           p.l3_creator_burst_penalty_per_post,
           p.l3_creator_burst_penalty_cap,
           p.l3_duplicate_penalty
         ) > 1000
    ),
    'l3_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l3_quality_enabled
    ),
    'l3_retention_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l3_retention_ranked as' in lower(definition)) > 0
          and position('l3_retention_features as' in lower(definition)) > 0
          and position('l3_quality_points' in lower(definition)) > 0
          and position('behavioral_l3' in lower(definition)) > 0
          and position('public.video_views' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l3_duplicate_fingerprint_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l3_creator_burst_features as' in lower(definition)) > 0
          and position('l3_creator_history as materialized' in lower(definition)) > 0
          and position('private.content_safety_scans' in lower(definition)) > 0
          and position('content_fingerprint' in lower(definition)) > 0
          and position('private.admin_content_is_visible' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l3_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'l3_quality_scores','video_quality_scores','creator_quality_scores',
          'creator_spam_scores','l3_ranking_cache','quality_ranking_cache'
        )
    ),
    'l3_raw_report_signal_present', (
      select count(*)
      from ranking_function
      where position('public.reports' in lower(definition)) > 0
         or position('content_safety_alerts' in lower(definition)) > 0
    ),
    'l4_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l4_session_horizon_minutes not between 1 and 1440
         or p.l4_session_history_cap not between 1 and 200
         or p.l4_positive_watch_ratio_threshold not between 0 and 1
         or p.l4_negative_min_distinct_videos not between 1 and 50
         or p.l4_creator_repeat_free_videos not between 0 and 50
         or least(
           p.l4_positive_creator_weight,
           p.l4_positive_creator_cap,
           p.l4_negative_creator_penalty_per_video,
           p.l4_negative_creator_penalty_cap,
           p.l4_creator_repeat_penalty_per_video,
           p.l4_creator_repeat_penalty_cap
         ) < 0
         or greatest(
           p.l4_positive_creator_weight,
           p.l4_positive_creator_cap,
           p.l4_negative_creator_penalty_per_video,
           p.l4_negative_creator_penalty_cap,
           p.l4_creator_repeat_penalty_per_video,
           p.l4_creator_repeat_penalty_cap
         ) > 100
    ),
    'l4_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l4_context_enabled
    ),
    'l4_session_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l4_raw_session_history as materialized' in lower(definition)) > 0
          and position('l4_session_history as materialized' in lower(definition)) > 0
          and position('l4_latest_exposure as' in lower(definition)) > 0
          and position('l4_valid_retention_ranked as' in lower(definition)) > 0
          and position('l4_creator_context as' in lower(definition)) > 0
          and position('vv.client_session_id = p_client_session_id' in lower(definition)) > 0
          and position('limit v_policy.l4_session_history_cap' in lower(definition)) > 0
          and position('v_l4_effective' in lower(definition)) > 0
          and position('behavioral_l4' in lower(definition)) > 0
          and position('public.video_views' in lower(definition)) > 0
          and position('public.videos' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l4_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'l4_context_scores','session_context_scores','creator_session_context',
          'l4_ranking_cache','session_ranking_cache','context_ranking_cache'
        )
    ),
    'l4_sensitive_context_dependency_present', (
      select count(*)
      from ranking_function
      where position('user_profiles.location' in lower(definition)) > 0
         or position('advertising_geo_targets' in lower(definition)) > 0
         or position('advertising_language_targets' in lower(definition)) > 0
         or lower(definition) ~ 'marketplace_(checkout|shipping|address|destination)'
         or position('call_devices' in lower(definition)) > 0
         or position('device_model' in lower(definition)) > 0
         or lower(definition) ~ 'network_(type|state)'
         or position('ip_address' in lower(definition)) > 0
         or position('context_fingerprint' in lower(definition)) > 0
         or lower(definition) ~ '(^|[^a-z0-9_])(gps|latitude|longitude|location|geo_lat|geo_lng)([^a-z0-9_]|$)'
         or position('public.reports' in lower(definition)) > 0
         or position('content_safety_alerts' in lower(definition)) > 0
    ),
    'canary_target_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_target_layer not in ('l1','l2','l3','l4','l5')
    ),
    'l2_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l2_canary' in lower(definition)) > 0
          and position('v_l2_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l2''' in lower(definition)) > 0
          and position('behavioral_l2' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l2' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l2.*canary|l2.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
      then 0 else 1 end
    ),
    'l2_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l2'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l2_affinity_enabled
        )
    ),
    'l3_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l3_canary' in lower(definition)) > 0
          and position('v_l3_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l3''' in lower(definition)) > 0
          and position('behavioral_l3' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l3' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l3_canary_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l3_canary_l2_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l3.*canary|l3.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname ~ '(l3.*canary|canary.*l3)'
        )
      then 0 else 1 end
    ),
    'l3_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l3'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l3_quality_enabled
          or l2_affinity_enabled
        )
    ),
    'l4_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l4_canary' in lower(definition)) > 0
          and position('v_l4_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l4''' in lower(definition)) > 0
          and position('behavioral_l4' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l4' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_l3_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_l2_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l4.*canary|l4.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname ~ '(l4.*canary|canary.*l4)'
        )
      then 0 else 1 end
    ),
    'l4_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l4'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l4_context_enabled
          or l3_quality_enabled
          or l2_affinity_enabled
        )
    ),
    'production_rollout_nonzero', (
      select count(*) from private.algo_l1_policy where production_rollout_bps <> 0
    ),
    'ranking_rpc_missing', (select case when count(*) = 1 then 0 else 1 end from ranking_function),
    'ranking_rpc_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('anon', oid, 'execute')
          and pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
        )
      then 0 else 1 end
      from ranking_function
    ),
    'ranking_rpc_search_path_invalid', (
      select case when count(*) = 1
        and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
      then 0 else 1 end
      from ranking_function
    ),
    'policy_browser_readable', (
      select (
        pg_catalog.has_table_privilege('anon', 'private.algo_l1_policy', 'select')
        or pg_catalog.has_table_privilege('authenticated', 'private.algo_l1_policy', 'select')
      )::integer
    ),
    'policy_browser_writable', (
      select (
        pg_catalog.has_table_privilege('anon', 'private.algo_l1_policy', 'insert,update,delete')
        or pg_catalog.has_table_privilege('authenticated', 'private.algo_l1_policy', 'insert,update,delete')
      )::integer
    ),
    'policy_version_guard_missing', (
      select (count(*) <> 1)::integer
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relname = 'algo_l1_policy'
        and t.tgname = 'algo_l1_policy_version_guard'
        and not t.tgisinternal
        and t.tgenabled = 'O'
        and t.tgtype = 19
        and t.tgfoid = pg_catalog.to_regprocedure('private.guard_algo_l1_policy_v1()')
    ),
    'raw_signal_authority_missing', (
      select (pg_catalog.to_regclass('public.video_views') is null)::integer
    ),
    'video_eligibility_authority_missing', (
      select (
        pg_catalog.to_regprocedure('private.video_can_view_owner(uuid)') is null
        or pg_catalog.to_regprocedure('private.admin_content_is_visible(text,uuid)') is null
      )::integer
    ),
    'required_indexes_missing', (
      select count(*)
      from (
        values
          ('likes_video_created_idx'),
          ('comments_video_created_idx'),
          ('video_saves_video_created_idx'),
          ('video_views_session_video_created_idx'),
          ('videos_created_id_desc_idx'),
          ('video_views_video_created_idx'),
          ('video_views_viewer_created_idx')
      ) required(index_name)
      where not exists (
        select 1 from pg_catalog.pg_indexes i
        where i.schemaname = 'public' and i.indexname = required.index_name
      )
    ),
    'ranking_materialization_present', (
      select count(*)
      from information_schema.tables t
      where t.table_schema in ('public', 'private')
        and t.table_name in (
          'ranking_scores','ranked_feed','user_ranked_feed','feed_cache',
          'user_feed_cache','recommendation_scores'
        )
    ),
    'duplicate_feed_ranking_authority', (
      select greatest(count(*) - 1, 0)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%ranked_feed%'
    ),
    'ads_dependency_present', (
      select count(*)
      from ranking_function
      where lower(definition) ~ '(advertising|campaign|billing|ad_spend|marketplace_ads)'
    ),
    'canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where (
          num_nonnulls(p.canary_user_id,p.canary_request_id,p.canary_requested_at) not in (0,3)
          or num_nonnulls(p.canary_armed_at,p.canary_expires_at) not in (0,2)
          or (p.canary_armed_at is not null and p.canary_request_id is null)
          or (p.canary_expires_at is not null and p.canary_expires_at <= p.canary_armed_at)
          or (
            p.canary_enabled
            and num_nonnulls(
              p.canary_user_id,p.canary_request_id,p.canary_requested_at,
              p.canary_armed_at,p.canary_expires_at
            ) <> 5
          )
          or (
            p.canary_user_id is not null
            and not exists (select 1 from auth.users u where u.id = p.canary_user_id)
          )
        )
    ),
    'canary_request_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and not pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
        )
      then 0 else 1 end
      from request_function
    ),
    'canary_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and not pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
        )
      then 0 else 1 end
      from manage_function
    ),
    'canary_expired_but_effective', (
      select case when count(*) = 1
        and bool_and(
          position('v_now < v_policy.canary_expires_at' in definition) > 0
          and position('v_as_of < v_policy.canary_expires_at' in definition) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'canary_rollout_conflict', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled and production_rollout_bps <> 0
    )
  ) || jsonb_build_object(
    'l5_semantic_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l5_semantic_horizon_days not between 1 and 365
        or p.l5_semantic_history_cap not between 1 and 200
        or p.l5_semantic_positive_watch_ratio_threshold not between 0 and 1
        or p.l5_semantic_positive_min_distinct_videos not between 1 and 50
        or p.l5_semantic_negative_min_distinct_videos not between 1 and 50
        or p.l5_semantic_full_confidence_videos < p.l5_semantic_positive_min_distinct_videos
        or p.l5_semantic_full_confidence_videos > 200
        or p.l5_semantic_positive_similarity_floor < -1
        or p.l5_semantic_positive_similarity_floor >= 1
        or p.l5_semantic_negative_similarity_floor < -1
        or p.l5_semantic_negative_similarity_floor >= 1
        or p.l5_semantic_positive_cap not between 0 and 100
        or p.l5_semantic_negative_cap not between 0 and 100
    ),
    'l5_semantic_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy p
      where p.l5_semantic_enabled
    ),
    'l5_semantic_ranking_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l5_positive_history' in lower(definition)) > 0
          and position('l5_negative_history' in lower(definition)) > 0
          and position('extensions.avg' in lower(definition)) > 0
          and position('l5_candidate_semantics' in lower(definition)) > 0
          and position('<=>' in definition) > 0
          and position('l5_semantic_adjustment' in lower(definition)) > 0
          and position('behavioral_l5' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l5_semantic_user_vector_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private')
        and c.relkind in ('r', 'p', 'v', 'm')
        and c.relname in (
          'user_interest_vectors',
          'user_semantic_profiles',
          'viewer_embeddings',
          'semantic_centroids',
          'semantic_interest_cache',
          'user_embedding_cache'
        )
    ),
    'l5_semantic_ranking_sensitive_dependency_present', (
      select count(*)
      from ranking_function
      where lower(definition) ~ 'content_safety_alerts|content_safety_visual_analyses|analysis_result|review_required|visual_summary|visual_findings|public\\.reports|admin_user_warnings|advertising_|marketplace_|financial_transactions|ledger_entries|wallet|public\\.messages|private_chat|user_profiles\\.location|gps|latitude|longitude|device_model|network_type|network_state'
    ),
    'l5_directed_canary_authority_missing', (
      select case when
        exists (
          select 1
          from pg_catalog.pg_constraint c
          join pg_catalog.pg_class t on t.oid = c.conrelid
          join pg_catalog.pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'private'
            and t.relname = 'algo_l1_policy'
            and c.conname = 'algo_l1_policy_canary_target_layer_check'
            and position('l5' in lower(pg_catalog.pg_get_constraintdef(c.oid))) > 0
        )
        and (select count(*) = 1 and bool_and(
          position('v_directed_l5_canary' in lower(definition)) > 0
          and position('v_l5_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l5''' in lower(definition)) > 0
          and position('l5_semantic_enabled or v_directed_l5_canary' in lower(definition)) > 0
          and position('behavioral_l5' in lower(definition)) > 0
          and position('then '':l5''' in lower(definition)) > 0
        ) from ranking_function)
        and (select count(*) = 1 and bool_and(
          position('arm_l5' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l5_canary_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l5_canary_l4_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l5_canary_l3_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l5_canary_l2_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l5.*canary|l5.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname ~ '(l5.*canary|canary.*l5)'
        )
      then 0 else 1 end
    ),
    'l5_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l5'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l5_semantic_enabled
          or l4_context_enabled
          or l3_quality_enabled
          or l2_affinity_enabled
        )
    ),
    'canary_generation_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_generation is null or canary_generation < 0
    )
  ) || jsonb_build_object(
    'l6_observation_decision_authority_missing', (
      select case when
        (select count(*) = 2
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'private'
           and c.relkind = 'r'
           and c.relname in ('organic_ranking_decisions','organic_ranking_items'))
        and (select count(*) = 1
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private'
               and p.proname = 'record_organic_ranking_decision_v1'
               and p.prosecdef
               and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']::text[]
               and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute'))
        then 0 else 1 end
    ),
    'l6_observation_impression_authority_missing', (
      select case when
        pg_catalog.to_regclass('private.organic_ranking_impressions') is not null
        and (select count(*) = 1
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'record_organic_ranking_impression_v1'
               and p.prosecdef
               and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']::text[]
               and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
               and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute'))
        then 0 else 1 end
    ),
    'l6_observation_engagement_authority_missing', (
      select case when
        pg_catalog.to_regclass('private.organic_ranking_engagement_events') is not null
        and (select count(*) = 1
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'record_organic_ranking_engagement_v1'
               and p.prosecdef
               and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']::text[]
               and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
               and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute'))
        then 0 else 1 end
    ),
    'l6_observation_ranking_contract_missing', (
      select case when count(*) = 1
        and bool_and(
          position('ranking_decision_id uuid' in lower(pg_catalog.pg_get_function_result(oid))) > 0
          and position('ranking_organic_position integer' in lower(pg_catalog.pg_get_function_result(oid))) > 0
          and position('record_organic_ranking_decision_v1' in lower(definition)) > 0
          and position('observed_page' in lower(definition)) > 0
          and position('organic-ranking-features-l1-l5-v1' in lower(definition)) > 0
        )
        then 0 else 1 end
      from ranking_function
    ),
    'l6_observation_browser_access_present', (
      select (
        exists (
          select 1
          from (values
            ('private.organic_ranking_decisions'),
            ('private.organic_ranking_items'),
            ('private.organic_ranking_impressions'),
            ('private.organic_ranking_engagement_events')
          ) t(relation_name)
          where pg_catalog.has_table_privilege('public', t.relation_name, 'select,insert,update,delete')
             or pg_catalog.has_table_privilege('anon', t.relation_name, 'select,insert,update,delete')
             or pg_catalog.has_table_privilege('authenticated', t.relation_name, 'select,insert,update,delete')
        )
        or exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private'
            and p.proname in (
              'record_organic_ranking_decision_v1',
              'prune_algo6_l6_observations_v1'
            )
            and (
              pg_catalog.has_function_privilege('public', p.oid, 'execute')
              or pg_catalog.has_function_privilege('anon', p.oid, 'execute')
              or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
              or pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
            )
        )
      )::integer
    ),
    'l6_observation_orphan_present', (
      select (
        (select count(*)
         from private.organic_ranking_impressions i
         left join private.organic_ranking_items ri
           on ri.decision_id = i.decision_id
          and ri.organic_position = i.organic_position
          and ri.video_id = i.video_id
         where ri.decision_id is null)
        +
        (select count(*)
         from private.organic_ranking_engagement_events e
         left join private.organic_ranking_impressions i
           on i.client_event_id = e.impression_client_event_id
         where i.client_event_id is null)
        +
        (select count(*)
         from private.organic_ranking_decisions d
         left join (
           select decision_id, count(*)::integer as item_count
           from private.organic_ranking_items
           group by decision_id
         ) i on i.decision_id = d.id
         where d.returned_count <> coalesce(i.item_count, 0))
      )::integer
    ),
    'l6_observation_retention_missing', (
      select case when
        (select count(*) = 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private'
           and p.proname = 'prune_algo6_l6_observations_v1'
           and position('interval ''180 days''' in lower(pg_catalog.pg_get_functiondef(p.oid))) > 0
           and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
           and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
           and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
           and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute'))
        and (select count(*) = 1
             from cron.job
             where jobname = 'algo6_l6_observation_retention_v1'
               and schedule = '17 3 * * *'
               and lower(command) like '%private.prune_algo6_l6_observations_v1()%')
        then 0 else 1 end
    ),
    'l6_observation_forbidden_dependency_present', (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where (
        (
          n.nspname = 'private'
          and p.proname in (
            'record_organic_ranking_decision_v1',
            'prune_algo6_l6_observations_v1'
          )
        ) or (
          n.nspname = 'public'
          and p.proname in (
            'record_organic_ranking_impression_v1',
            'record_organic_ranking_engagement_v1',
            'get_algo6_l6_observation_progress_v1'
          )
        )
      )
      and lower(pg_catalog.pg_get_functiondef(p.oid)) ~
        'advertising_|marketplace_|financial_transactions|ledger_entries|wallet|public\\.messages|private_chat|(^|[^a-z])location([^a-z]|$)|(^|[^a-z])gps([^a-z]|$)|(^|[^a-z])ip([^a-z]|$)|device_fingerprint|network_type|content_safety_(alerts|reports|warnings)'
    )
  );
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1()
  to service_role;

select cron.schedule(
  'algo6_l6_observation_retention_v1',
  '17 3 * * *',
  $cron$select private.prune_algo6_l6_observations_v1();$cron$
);

commit;
