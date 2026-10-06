begin;

create or replace function public.get_algo6_l6_training_readiness_v1()
returns jsonb
language sql
security definer
set search_path = ''
as $$
with
anchor as materialized (
  select pg_catalog.clock_timestamp() as generated_at
),
item_quality_rows as materialized (
  select
    item.decision_id,
    item.organic_position,
    item.video_id,
    item.creator_id,
    item.is_self_authored,
    item.feature_snapshot,
    not ((item.feature_snapshot - array[
        'freshness_points','follow_points','like_points','comment_points','save_points',
        'completion_points','rewatch_points','exploration_points','same_session_points',
        'short_watch_points','completed_points','repeat_points','creator_affinity_points',
        'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
        'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
        'l4_context_adjustment','l5_semantic_positive_points',
        'l5_semantic_negative_penalty','l5_semantic_adjustment'
      ]::text[]) = '{}'::jsonb) as has_unknown_key,
    not (item.feature_snapshot ?& array[
      'freshness_points','follow_points','like_points','comment_points','save_points',
      'completion_points','rewatch_points','exploration_points','same_session_points',
      'short_watch_points','completed_points','repeat_points','creator_affinity_points',
      'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
      'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
      'l4_context_adjustment','l5_semantic_positive_points',
      'l5_semantic_negative_penalty','l5_semantic_adjustment'
    ]::text[]) as has_missing_key,
    pg_catalog.jsonb_path_exists(
      item.feature_snapshot,
      '$.* ? (@.type() != "number" && @.type() != "null")'::jsonpath
    ) as has_invalid_value
  from private.organic_ranking_items item
),
item_quality as materialized (
  select
    q.*,
    (
      pg_catalog.jsonb_typeof(q.feature_snapshot) <> 'object'
      or q.has_unknown_key
      or q.has_missing_key
      or q.has_invalid_value
    ) as malformed_snapshot
  from item_quality_rows q
),
views_by_event as materialized (
  select
    v.client_event_id,
    count(*)::bigint as view_count,
    pg_catalog.min(v.video_id::text)::uuid as video_id,
    pg_catalog.min(v.viewer_id::text)::uuid as viewer_id,
    pg_catalog.min(v.client_session_id::text)::uuid as client_session_id,
    pg_catalog.min(v.media_duration_ms) as media_duration_ms,
    pg_catalog.min(v.completion_ratio) as completion_ratio,
    pg_catalog.bool_and(v.completed) filter (where v.completed is not null) as completed,
    pg_catalog.max(v.rewatch_count) as rewatch_count,
    pg_catalog.min(v.exit_reason) as exit_reason,
    pg_catalog.min(v.created_at) as created_at
  from public.video_views v
  group by v.client_event_id
),
impression_facts as materialized (
  select
    i.client_event_id,
    i.decision_id,
    i.organic_position,
    i.video_id,
    i.viewer_user_id,
    i.client_session_id,
    i.surface_position,
    i.viewability_contract_version,
    i.visible_percent_threshold,
    i.created_at,
    item.creator_id,
    item.is_self_authored,
    item.malformed_snapshot,
    d.observation_schema_version,
    d.feature_contract_version,
    coalesce(v.view_count, 0::bigint) as view_count,
    v.video_id as view_video_id,
    v.viewer_id as view_viewer_id,
    v.client_session_id as view_client_session_id,
    v.media_duration_ms,
    v.completion_ratio,
    v.completed,
    v.rewatch_count,
    v.exit_reason,
    (i.created_at <= a.generated_at - interval '24 hours') as mature,
    (
      coalesce(v.view_count, 0::bigint) = 1
      and v.video_id = i.video_id
      and v.client_session_id = i.client_session_id
      and v.viewer_id is not distinct from i.viewer_user_id
    ) as exact_view_link,
    (
      item.decision_id is not null
      and not item.malformed_snapshot
      and d.observation_schema_version = 'organic-ranking-observation-v1'
      and d.feature_contract_version = 'organic-ranking-features-l1-l5-v1'
      and i.viewability_contract_version = 'organic-feed-viewability-75pct-v1'
      and i.visible_percent_threshold = 75
    ) as eligible_contract
  from private.organic_ranking_impressions i
  cross join anchor a
  left join item_quality item
    on item.decision_id = i.decision_id
   and item.organic_position = i.organic_position
   and item.video_id = i.video_id
  left join private.organic_ranking_decisions d on d.id = i.decision_id
  left join views_by_event v on v.client_event_id = i.client_event_id
),
impression_summary as materialized (
  select
    count(*)::bigint as visible_impressions_total,
    count(distinct client_event_id)::bigint as unique_visible_impressions,
    (count(*) - count(distinct client_event_id))::bigint as duplicate_impression_identities,
    count(*) filter (where view_count > 0)::bigint as finalized_view_links,
    count(*) filter (where view_count > 1)::bigint as multiple_finalized_views_per_impression,
    count(*) filter (where mature and view_count = 0)::bigint as unlinked_mature_impressions,
    count(*) filter (where view_count = 1 and view_video_id <> video_id)::bigint as wrong_video_joins,
    count(*) filter (where view_count = 1 and view_client_session_id <> client_session_id)::bigint as wrong_session_joins,
    count(*) filter (where view_count = 1 and view_viewer_id is distinct from viewer_user_id)::bigint as wrong_viewer_joins,
    count(*) filter (where mature)::bigint as mature_impressions,
    count(*) filter (where not mature)::bigint as immature_impressions,
    count(*) filter (where viewer_user_id is not null)::bigint as authenticated_impressions,
    count(*) filter (where viewer_user_id is null)::bigint as anonymous_impressions,
    count(distinct viewer_user_id) filter (where viewer_user_id is not null)::bigint as authenticated_viewers,
    count(distinct client_session_id) filter (where viewer_user_id is null)::bigint as anonymous_client_sessions,
    count(distinct video_id)::bigint as distinct_videos,
    count(distinct creator_id) filter (where creator_id is not null)::bigint as distinct_creators,
    count(*) filter (where is_self_authored)::bigint as self_authored_impressions,
    count(*) filter (
      where mature
        and exact_view_link
        and media_duration_ms > 0
        and completion_ratio is not null
    )::bigint as valid_retention_samples,
    count(*) filter (
      where mature and exact_view_link and media_duration_ms > 0
        and completion_ratio is not null and completion_ratio >= 0.50
    )::bigint as long_watch_positive_source,
    count(*) filter (
      where mature and exact_view_link and media_duration_ms > 0
        and completion_ratio is not null and completion_ratio < 0.50
    )::bigint as long_watch_negative_source,
    count(*) filter (
      where mature and exact_view_link and media_duration_ms > 0
        and completion_ratio is not null and completed is true
    )::bigint as completion_true_source,
    count(*) filter (
      where mature and exact_view_link and media_duration_ms > 0
        and completion_ratio is not null and completed is false
    )::bigint as completion_false_source,
    count(*) filter (
      where mature and exact_view_link and media_duration_ms > 0
        and completion_ratio is not null and rewatch_count > 0
    )::bigint as rewatch_positive_source,
    count(*) filter (where mature and exact_view_link and exit_reason = 'swipe')::bigint as exit_swipe,
    count(*) filter (where mature and exact_view_link and exit_reason = 'background')::bigint as exit_background,
    count(*) filter (where mature and exact_view_link and exit_reason = 'unmount')::bigint as exit_unmount,
    count(*) filter (where mature and exact_view_link and exit_reason = 'unknown')::bigint as exit_unknown,
    count(*) filter (where mature and exact_view_link and exit_reason = 'ended')::bigint as exit_ended,
    pg_catalog.min(created_at) filter (where mature and eligible_contract) as oldest_mature_impression_at,
    pg_catalog.max(created_at) filter (where mature and eligible_contract) as newest_mature_impression_at
  from impression_facts
),
eligible_mature_days as materialized (
  select distinct (created_at at time zone 'UTC')::date as observed_day
  from impression_facts
  where mature and eligible_contract
),
numbered_mature_days as (
  select
    observed_day,
    observed_day - (pg_catalog.row_number() over (order by observed_day))::integer as day_island
  from eligible_mature_days
),
continuity_summary as materialized (
  select
    (select count(*)::bigint from eligible_mature_days) as observed_calendar_days,
    coalesce((select pg_catalog.max(day_count) from (
      select count(*)::bigint as day_count
      from numbered_mature_days
      group by day_island
    ) islands), 0::bigint) as longest_consecutive_observation_days
),
decision_item_summary as materialized (
  select
    count(*) filter (where d.returned_count <> coalesce(i.item_count, 0))::bigint
      as decision_item_count_mismatches,
    count(*) filter (
      where d.observation_schema_version <> 'organic-ranking-observation-v1'
    )::bigint as invalid_observation_contract_versions,
    count(*) filter (
      where d.feature_contract_version <> 'organic-ranking-features-l1-l5-v1'
    )::bigint as invalid_feature_contract_versions,
    count(*) filter (where d.created_at > a.generated_at)::bigint as future_decision_rows
  from private.organic_ranking_decisions d
  cross join anchor a
  left join (
    select decision_id, count(*)::integer as item_count
    from private.organic_ranking_items
    group by decision_id
  ) i on i.decision_id = d.id
),
item_summary as materialized (
  select
    count(*) filter (where malformed_snapshot)::bigint as malformed_feature_snapshots,
    count(*) filter (where has_unknown_key)::bigint as unknown_feature_keys,
    coalesce((select pg_catalog.sum(excess)::bigint from (
      select count(*) - 1 as excess
      from private.organic_ranking_items
      group by decision_id, video_id
      having count(*) > 1
    ) duplicates), 0::bigint) as duplicate_decision_video_memberships
  from item_quality
),
impression_identity as materialized (
  select
    i.client_event_id,
    count(*)::bigint as impression_row_count,
    pg_catalog.min(i.decision_id::text)::uuid as decision_id,
    pg_catalog.min(i.video_id::text)::uuid as video_id,
    pg_catalog.min(i.viewer_user_id::text)::uuid as viewer_user_id,
    pg_catalog.min(i.client_session_id::text)::uuid as client_session_id,
    pg_catalog.min(i.created_at) as created_at
  from private.organic_ranking_impressions i
  group by i.client_event_id
),
engagement_facts as materialized (
  select
    e.client_action_id,
    e.action,
    e.attribution_contract_version,
    e.created_at,
    imp.impression_row_count,
    imp.created_at as impression_created_at,
    item.is_self_authored,
    (
      imp.client_event_id is not null
      and imp.impression_row_count = 1
      and e.decision_id = imp.decision_id
      and e.video_id = imp.video_id
      and e.viewer_user_id = imp.viewer_user_id
      and e.client_session_id = imp.client_session_id
      and item.creator_id = e.creator_id
    ) as exact_identity,
    (coalesce(item.is_self_authored, false) or e.viewer_user_id = e.creator_id) as self_authored,
    (
      imp.created_at is not null
      and e.created_at >= imp.created_at
      and e.created_at <= imp.created_at + interval '24 hours'
    ) as inside_attribution_window,
    (imp.created_at <= a.generated_at - interval '24 hours') as mature_impression,
    (imp.client_event_id is null) as orphan_reference,
    (e.created_at > a.generated_at) as future_dated
  from private.organic_ranking_engagement_events e
  cross join anchor a
  left join impression_identity imp on imp.client_event_id = e.impression_client_event_id
  left join item_quality item
    on item.decision_id = e.decision_id
   and item.video_id = e.video_id
   and item.creator_id = e.creator_id
),
engagement_summary as materialized (
  select
    count(*)::bigint as engagement_events_total,
    count(distinct client_action_id)::bigint as unique_engagement_action_ids,
    (count(*) - count(distinct client_action_id))::bigint as duplicate_engagement_action_ids,
    count(*) filter (where orphan_reference)::bigint as orphan_engagement_references,
    count(*) filter (where self_authored)::bigint as self_authored_engagement_rows,
    count(*) filter (
      where not orphan_reference and not inside_attribution_window
    )::bigint as engagement_events_outside_attribution_window,
    count(*) filter (
      where attribution_contract_version <> 'organic-engagement-24h-v1'
    )::bigint as invalid_engagement_contract_versions,
    count(*) filter (where future_dated)::bigint as future_engagement_rows,
    count(*) filter (
      where action = 'like' and exact_identity and not self_authored
        and inside_attribution_window and mature_impression
        and attribution_contract_version = 'organic-engagement-24h-v1'
    )::bigint as external_mature_like_positives,
    count(*) filter (
      where action = 'save' and exact_identity and not self_authored
        and inside_attribution_window and mature_impression
        and attribution_contract_version = 'organic-engagement-24h-v1'
    )::bigint as external_mature_save_positives,
    count(*) filter (
      where action = 'follow' and exact_identity and not self_authored
        and inside_attribution_window and mature_impression
        and attribution_contract_version = 'organic-engagement-24h-v1'
    )::bigint as external_mature_follow_events,
    count(*) filter (where action = 'unlike')::bigint as unlike_events,
    count(*) filter (where action = 'unsave')::bigint as unsave_events,
    count(*) filter (where action = 'unfollow')::bigint as unfollow_events
  from engagement_facts
),
observation_integrity as materialized (
  select
    count(*) filter (where item.decision_id is null)::bigint as orphan_impression_references,
    count(*) filter (
      where i.viewability_contract_version <> 'organic-feed-viewability-75pct-v1'
         or i.visible_percent_threshold <> 75
    )::bigint as invalid_impression_contract_versions,
    count(*) filter (where i.created_at > a.generated_at)::bigint as future_impression_rows
  from private.organic_ranking_impressions i
  cross join anchor a
  left join private.organic_ranking_items item
    on item.decision_id = i.decision_id
   and item.organic_position = i.organic_position
   and item.video_id = i.video_id
),
quality_rollup as materialized (
  select
    (
      s.duplicate_impression_identities
      + s.multiple_finalized_views_per_impression
      + s.wrong_video_joins
      + s.wrong_session_joins
      + s.wrong_viewer_joins
      + items.malformed_feature_snapshots
      + decisions.invalid_observation_contract_versions
      + decisions.invalid_feature_contract_versions
      + observations.invalid_impression_contract_versions
      + engagements.invalid_engagement_contract_versions
      + engagements.duplicate_engagement_action_ids
      + engagements.orphan_engagement_references
      + engagements.self_authored_engagement_rows
      + engagements.engagement_events_outside_attribution_window
      + decisions.future_decision_rows
      + observations.future_impression_rows
      + engagements.future_engagement_rows
      + observations.orphan_impression_references
      + decisions.decision_item_count_mismatches
      + items.duplicate_decision_video_memberships
    )::bigint as structural_failure_count
  from impression_summary s
  cross join decision_item_summary decisions
  cross join item_summary items
  cross join observation_integrity observations
  cross join engagement_summary engagements
),
policy_state as materialized (
  select
    p.policy_version,
    p.canary_generation,
    p.canary_enabled,
    p.canary_target_layer,
    p.production_rollout_bps,
    p.l2_affinity_enabled,
    p.l3_quality_enabled,
    p.l4_context_enabled,
    p.l5_semantic_enabled
  from private.algo_l1_policy p
  limit 1
)
select pg_catalog.jsonb_build_object(
  'contract_version', 'algo6-l6-training-readiness-v1',
  'generated_at', a.generated_at,
  'observation_schema_version', 'organic-ranking-observation-v1',
  'feature_contract_version', 'organic-ranking-features-l1-l5-v1',
  'overall_status', case
    when quality.structural_failure_count > 0 then 'STRUCTURAL_FAILURE'
    else 'NOT_READY'
  end,
  'training_entry_ready', false,
  'blocking_reasons', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
    case when quality.structural_failure_count > 0 then 'structural_failure'::text end,
    case when s.unique_visible_impressions < 250000 then 'unique_visible_organic_impressions'::text end,
    case when s.valid_retention_samples < 100000 then 'valid_retention_samples'::text end,
    case when s.authenticated_viewers < 2000 then 'authenticated_viewers'::text end,
    case when s.distinct_videos < 2000 then 'distinct_videos'::text end,
    case when s.distinct_creators < 200 then 'distinct_creators'::text end,
    case when continuity.longest_consecutive_observation_days < 84 then 'continuous_observation_days'::text end,
    'unresolved_label_contracts'::text,
    'temporal_split_not_evaluable'::text
  ], null)),
  'global_gates', pg_catalog.jsonb_build_object(
    'unique_visible_organic_impressions', pg_catalog.jsonb_build_object(
      'current', s.unique_visible_impressions,
      'total', s.visible_impressions_total,
      'distinct', s.unique_visible_impressions,
      'required', 250000,
      'status', case
        when s.visible_impressions_total <> s.unique_visible_impressions then 'STRUCTURAL_FAILURE'
        when s.unique_visible_impressions >= 250000 then 'PASS'
        else 'NOT_READY'
      end
    ),
    'valid_retention_samples', pg_catalog.jsonb_build_object(
      'current', s.valid_retention_samples, 'required', 100000,
      'status', case when s.valid_retention_samples >= 100000 then 'PASS' else 'NOT_READY' end
    ),
    'authenticated_viewers', pg_catalog.jsonb_build_object(
      'current', s.authenticated_viewers, 'required', 2000,
      'status', case when s.authenticated_viewers >= 2000 then 'PASS' else 'NOT_READY' end
    ),
    'distinct_videos', pg_catalog.jsonb_build_object(
      'current', s.distinct_videos, 'required', 2000,
      'status', case when s.distinct_videos >= 2000 then 'PASS' else 'NOT_READY' end
    ),
    'distinct_creators', pg_catalog.jsonb_build_object(
      'current', s.distinct_creators, 'required', 200,
      'status', case when s.distinct_creators >= 200 then 'PASS' else 'NOT_READY' end
    ),
    'continuous_observation_days', pg_catalog.jsonb_build_object(
      'current', continuity.longest_consecutive_observation_days, 'required', 84,
      'status', case when continuity.longest_consecutive_observation_days >= 84 then 'PASS' else 'NOT_READY' end
    )
  ),
  'data_quality', pg_catalog.jsonb_build_object(
    'visible_impressions_total', s.visible_impressions_total,
    'unique_impression_client_event_ids', s.unique_visible_impressions,
    'duplicate_impression_identities', s.duplicate_impression_identities,
    'finalized_view_links', s.finalized_view_links,
    'multiple_finalized_views_per_impression', s.multiple_finalized_views_per_impression,
    'unlinked_mature_impressions', s.unlinked_mature_impressions,
    'view_link_coverage_ratio', case when s.visible_impressions_total = 0 then 0::numeric
      else pg_catalog.round(s.finalized_view_links::numeric / s.visible_impressions_total::numeric, 6) end,
    'wrong_video_joins', s.wrong_video_joins,
    'wrong_session_joins', s.wrong_session_joins,
    'wrong_viewer_joins', s.wrong_viewer_joins,
    'malformed_feature_snapshots', items.malformed_feature_snapshots,
    'unknown_feature_keys', items.unknown_feature_keys,
    'invalid_observation_contract_versions',
      decisions.invalid_observation_contract_versions
      + observations.invalid_impression_contract_versions
      + engagements.invalid_engagement_contract_versions,
    'invalid_feature_contract_versions', decisions.invalid_feature_contract_versions,
    'self_authored_engagement_rows', engagements.self_authored_engagement_rows,
    'orphan_impression_references', observations.orphan_impression_references,
    'orphan_engagement_references', engagements.orphan_engagement_references,
    'engagement_events_outside_attribution_window', engagements.engagement_events_outside_attribution_window,
    'future_dated_observation_rows',
      decisions.future_decision_rows + observations.future_impression_rows + engagements.future_engagement_rows,
    'decision_item_count_mismatches', decisions.decision_item_count_mismatches,
    'duplicate_decision_video_memberships', items.duplicate_decision_video_memberships,
    'engagement_events_total', engagements.engagement_events_total,
    'unique_engagement_action_ids', engagements.unique_engagement_action_ids,
    'duplicate_engagement_action_ids', engagements.duplicate_engagement_action_ids,
    'authenticated_impressions', s.authenticated_impressions,
    'anonymous_impressions', s.anonymous_impressions,
    'anonymous_client_sessions', s.anonymous_client_sessions,
    'mature_impressions', s.mature_impressions,
    'immature_impressions', s.immature_impressions,
    'self_authored_impressions', s.self_authored_impressions,
    'structural_failure_count', quality.structural_failure_count
  ),
  'observation_continuity', pg_catalog.jsonb_build_object(
    'oldest_mature_impression_at', s.oldest_mature_impression_at,
    'newest_mature_impression_at', s.newest_mature_impression_at,
    'observed_calendar_days', continuity.observed_calendar_days,
    'longest_consecutive_observation_days', continuity.longest_consecutive_observation_days,
    'required_continuous_days', 84,
    'continuity_pass', continuity.longest_consecutive_observation_days >= 84
  ),
  'head_monitoring', pg_catalog.jsonb_build_object(
    'long_watch', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PROVISIONAL_LABEL_CONTRACT',
      'monitoring_definition', 'completion_ratio >= 0.50',
      'positive_source_count', s.long_watch_positive_source,
      'negative_source_count', s.long_watch_negative_source,
      'required_positive', 10000,
      'required_negative', 10000,
      'status', 'PROVISIONAL_LABEL_CONTRACT'
    ),
    'completion', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PENDING_FINAL_LABEL_CONTRACT',
      'true_source_count', s.completion_true_source,
      'false_source_count', s.completion_false_source,
      'required_positive', 10000,
      'required_negative', 10000,
      'status', 'PENDING_FINAL_LABEL_CONTRACT'
    ),
    'early_exit', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PROVISIONAL_LABEL_CONTRACT',
      'positive_source_count', null,
      'negative_source_count', null,
      'required_positive', 10000,
      'required_negative', 10000,
      'status', 'PROVISIONAL_LABEL_CONTRACT',
      'exit_reason_distribution', pg_catalog.jsonb_build_object(
        'swipe', s.exit_swipe,
        'background', s.exit_background,
        'unmount', s.exit_unmount,
        'unknown', s.exit_unknown,
        'ended', s.exit_ended
      )
    ),
    'rewatch', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PENDING_FINAL_LABEL_CONTRACT',
      'positive_source_count', s.rewatch_positive_source,
      'required_positive', 5000,
      'status', 'PENDING_FINAL_LABEL_CONTRACT'
    ),
    'save', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PENDING_FINAL_LABEL_CONTRACT',
      'external_mature_positive_count', engagements.external_mature_save_positives,
      'required_positive', 5000,
      'status', 'PENDING_FINAL_LABEL_CONTRACT'
    ),
    'like', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PENDING_FINAL_LABEL_CONTRACT',
      'external_mature_positive_count', engagements.external_mature_like_positives,
      'required_positive', 5000,
      'status', 'PENDING_FINAL_LABEL_CONTRACT'
    ),
    'follow', pg_catalog.jsonb_build_object(
      'label_contract_status', 'PENDING_FINAL_LABEL_CONTRACT',
      'external_mature_event_count', engagements.external_mature_follow_events,
      'required_positive', null,
      'status', 'PENDING_FINAL_LABEL_CONTRACT'
    ),
    'reversals', pg_catalog.jsonb_build_object(
      'unlike', engagements.unlike_events,
      'unsave', engagements.unsave_events,
      'unfollow', engagements.unfollow_events,
      'label_interpretation', 'RAW_EVENTS_ONLY'
    )
  ),
  'temporal_split', pg_catalog.jsonb_build_object(
    'status', 'PROPOSED_TEMPORAL_SPLIT_V1',
    'train_weeks', 8,
    'validation_weeks', 2,
    'untouched_test_weeks', 2,
    'validation_sparse_support', pg_catalog.jsonb_build_object(
      'current', null, 'required', 500, 'status', 'NOT_EVALUABLE'
    ),
    'untouched_test_sparse_support', pg_catalog.jsonb_build_object(
      'current', null, 'required', 500, 'status', 'NOT_EVALUABLE'
    )
  ),
  'current_policy_state', pg_catalog.jsonb_build_object(
    'policy_version', policy.policy_version,
    'canary_generation', policy.canary_generation,
    'canary_enabled', policy.canary_enabled,
    'canary_target_layer', policy.canary_target_layer,
    'production_rollout_bps', policy.production_rollout_bps,
    'l2_affinity_enabled', policy.l2_affinity_enabled,
    'l3_quality_enabled', policy.l3_quality_enabled,
    'l4_context_enabled', policy.l4_context_enabled,
    'l5_semantic_enabled', policy.l5_semantic_enabled
  )
)
from anchor a
cross join impression_summary s
cross join continuity_summary continuity
cross join decision_item_summary decisions
cross join item_summary items
cross join observation_integrity observations
cross join engagement_summary engagements
cross join quality_rollup quality
cross join policy_state policy;
$$;

revoke all on function public.get_algo6_l6_training_readiness_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_algo6_l6_training_readiness_v1()
  to service_role;

alter function public.reconcile_algo_l1_v1() set schema private;
alter function private.reconcile_algo_l1_v1() rename to reconcile_algo_l1_f2_v1;
revoke all on function private.reconcile_algo_l1_f2_v1()
  from public, anon, authenticated, service_role;

create or replace function public.reconcile_algo_l1_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with readiness_function as (
    select
      p.oid,
      p.prosecdef,
      p.proacl,
      p.proconfig,
      pg_catalog.pg_get_function_result(p.oid) as result_type,
      pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_algo6_l6_training_readiness_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  )
  select private.reconcile_algo_l1_f2_v1() || pg_catalog.jsonb_build_object(
    'l6_training_readiness_authority_missing', (
      select case when count(*) = 1
        and pg_catalog.bool_and(
          prosecdef
          and result_type = 'jsonb'
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
          and pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('authenticated', oid, 'execute')
        )
      then 0 else 1 end
      from readiness_function
    ),
    'l6_training_readiness_contract_invalid', (
      select case when count(*) = 1
        and pg_catalog.bool_and(
          pg_catalog.strpos(lower(definition), 'algo6-l6-training-readiness-v1') > 0
          and pg_catalog.strpos(lower(definition), 'organic-ranking-observation-v1') > 0
          and pg_catalog.strpos(lower(definition), 'organic-ranking-features-l1-l5-v1') > 0
          and pg_catalog.strpos(lower(definition), 'unique_visible_organic_impressions') > 0
          and pg_catalog.strpos(lower(definition), 'visible_impressions_total') > 0
          and pg_catalog.strpos(lower(definition), 'duplicate_impression_identities') > 0
          and pg_catalog.strpos(lower(definition), 'provisional_label_contract') > 0
          and pg_catalog.strpos(lower(definition), 'pending_final_label_contract') > 0
          and pg_catalog.strpos(lower(definition), 'training_entry_ready') > 0
          and pg_catalog.strpos(lower(definition), '''training_entry_ready'', false') > 0
        )
      then 0 else 1 end
      from readiness_function
    ),
    'l6_training_readiness_forbidden_dependency_present', (
      select count(*)
      from readiness_function
      where lower(definition) ~
        'advertising_|marketplace_|financial_transactions|ledger_entries|ledger_accounts|wallet|escrow|stripe|creator_earnings|public\\.messages|private_chat|content_safety_(alerts|reports|warnings)|(^|[^a-z])gps([^a-z]|$)|latitude|longitude|device_fingerprint|network_type'
    )
  );
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1()
  to service_role;

commit;
