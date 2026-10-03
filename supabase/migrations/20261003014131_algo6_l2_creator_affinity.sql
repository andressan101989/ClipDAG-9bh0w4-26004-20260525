begin;

do $precheck$
begin
  if to_regclass('private.algo_l1_policy') is null
     or to_regprocedure(
       'public.get_ranked_feed_l1_v1(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text)'
     ) is null
     or to_regprocedure('public.reconcile_algo_l1_v1()') is null then
    raise exception 'algo_l2_base_authority_missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'algo_l1_policy'
      and column_name like 'l2_affinity_%'
  ) then
    raise exception 'algo_l2_policy_already_exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'v', 'm')
      and lower(c.relname) ~ '(affinity|creator_interest|user_creator_interest|ranked_feed_l2)'
  ) or exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and lower(p.proname) ~ '(affinity|creator_interest|user_creator_interest|ranked_feed_l2)'
  ) then
    raise exception 'algo_l2_parallel_authority_exists';
  end if;

  if not exists (
    select 1
    from private.algo_l1_policy p
    where p.singleton
      and p.policy_version = 'nelyon-algo-l1-v1'
      and p.enabled
      and p.production_rollout_bps = 0
      and not p.canary_enabled
      and p.canary_generation >= 0
  ) then
    raise exception 'algo_l2_base_policy_invalid';
  end if;
end;
$precheck$;

alter table private.algo_l1_policy
  add column l2_affinity_enabled boolean not null default false,
  add column l2_affinity_horizon_days integer not null default 90,
  add column l2_affinity_like_weight numeric(10,6) not null default 2.0,
  add column l2_affinity_comment_weight numeric(10,6) not null default 3.0,
  add column l2_affinity_save_weight numeric(10,6) not null default 4.0,
  add column l2_affinity_completed_weight numeric(10,6) not null default 2.0,
  add column l2_affinity_long_watch_weight numeric(10,6) not null default 1.0,
  add column l2_affinity_rewatch_weight numeric(10,6) not null default 1.0,
  add column l2_affinity_short_watch_penalty numeric(10,6) not null default 1.5,
  add column l2_affinity_long_watch_ratio_threshold numeric(10,6) not null default 0.50,
  add column l2_affinity_negative_min_distinct_videos integer not null default 2,
  add column l2_affinity_per_video_positive_cap numeric(10,6) not null default 8.0,
  add column l2_affinity_per_video_negative_cap numeric(10,6) not null default 2.0,
  add column l2_affinity_creator_positive_cap numeric(10,6) not null default 18.0,
  add column l2_affinity_creator_negative_cap numeric(10,6) not null default 12.0,
  add constraint algo_l1_policy_l2_horizon_check
    check (l2_affinity_horizon_days between 1 and 365),
  add constraint algo_l1_policy_l2_long_watch_ratio_check
    check (l2_affinity_long_watch_ratio_threshold between 0 and 1),
  add constraint algo_l1_policy_l2_negative_min_check
    check (l2_affinity_negative_min_distinct_videos >= 1),
  add constraint algo_l1_policy_l2_nonnegative_check check (
    least(
      l2_affinity_like_weight,
      l2_affinity_comment_weight,
      l2_affinity_save_weight,
      l2_affinity_completed_weight,
      l2_affinity_long_watch_weight,
      l2_affinity_rewatch_weight,
      l2_affinity_short_watch_penalty,
      l2_affinity_per_video_positive_cap,
      l2_affinity_per_video_negative_cap,
      l2_affinity_creator_positive_cap,
      l2_affinity_creator_negative_cap
    ) >= 0
  ),
  add constraint algo_l1_policy_l2_upper_bound_check check (
    greatest(
      l2_affinity_like_weight,
      l2_affinity_comment_weight,
      l2_affinity_save_weight,
      l2_affinity_completed_weight,
      l2_affinity_long_watch_weight,
      l2_affinity_rewatch_weight,
      l2_affinity_short_watch_penalty,
      l2_affinity_per_video_positive_cap,
      l2_affinity_per_video_negative_cap,
      l2_affinity_creator_positive_cap,
      l2_affinity_creator_negative_cap
    ) <= 1000
  );

create or replace function public.get_ranked_feed_l1_v1(
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
  effective_page_limit integer
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
  v_effective_policy_version text;
  v_behavioral boolean;
  v_mode text;
  v_useful_actions bigint := 0;
  v_cold_start boolean;
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
  v_effective_policy_version := case
    when v_viewer_id is not null
      and v_viewer_id = v_policy.canary_user_id
      and v_policy.canary_generation > 0
      then v_policy.policy_version || '|canary:' || v_policy.canary_generation
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
  v_mode := case
    when not v_behavioral then 'chronological'
    when v_policy.l2_affinity_enabled and v_viewer_id is not null then 'behavioral_l2'
    else 'behavioral_l1'
  end;

  return query
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
  affinity_like_signals as (
    select v.user_id as creator_id, l.video_id, max(l.created_at) as last_like_at
    from public.likes l
    join public.videos v on v.id = l.video_id
    join candidate_creators cc on cc.creator_id = v.user_id
    where v_policy.l2_affinity_enabled
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
    where v_policy.l2_affinity_enabled
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
    where v_policy.l2_affinity_enabled
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
    where v_policy.l2_affinity_enabled
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
        when not v_policy.l2_affinity_enabled
          or v_viewer_id is null
          or c.user_id = v_viewer_id
        then 0::numeric
        else coalesce(afs.creator_affinity_points, 0::numeric)
      end as creator_affinity_points
    from candidates c
    left join like_features lf on lf.video_id = c.id
    left join comment_features cf on cf.video_id = c.id
    left join save_features sf on sf.video_id = c.id
    left join watch_features wf on wf.video_id = c.id
    left join follow_features ff on ff.creator_id = c.user_id
    left join viewer_history vh on vh.video_id = c.id
    left join affinity_creator_scores afs on afs.creator_id = c.user_id
  ),
  scored as (
    select
      components.*,
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
          - same_session_points
          - short_watch_points
          - completed_points
          - repeat_points
        )::numeric, 6)
        else 0::numeric
      end::numeric(18,6) as rank_score
    from components
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
  )
  select
    pr.id,
    pr.user_id,
    pr.video_url,
    pr.thumbnail_url,
    pr.media_urls,
    pr.caption,
    pr.music,
    pr.likes_count,
    pr.comments_count,
    pr.shares_count,
    pr.views_count,
    pr.saves_count,
    pr.created_at,
    pr.edited_at,
    pr.creator_username,
    pr.creator_avatar,
    v_mode,
    v_effective_policy_version,
    pr.rank_score,
    v_as_of,
    pr.delivery_score,
    pr.created_at,
    pr.id,
    v_page_limit
  from page_rows pr
  order by pr.delivery_score desc, pr.created_at desc, pr.id desc;
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
  )
  select jsonb_build_object(
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
    ),
    'canary_generation_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_generation is null or canary_generation < 0
    )
  );
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1() to service_role;

commit;
