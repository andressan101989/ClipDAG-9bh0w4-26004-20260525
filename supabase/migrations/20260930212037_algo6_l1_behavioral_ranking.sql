begin;

do $precheck$
begin
  if to_regclass('public.video_views') is null
     or to_regprocedure('private.video_can_view_owner(uuid)') is null
     or to_regprocedure('private.admin_content_is_visible(text,uuid)') is null then
    raise exception 'algo6_l1_f0_authority_missing';
  end if;
  if to_regclass('private.algo_l1_policy') is not null
     or to_regprocedure(
       'public.get_ranked_feed_l1_v1(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text)'
     ) is not null then
    raise exception 'algo6_l1_authority_already_exists';
  end if;
end;
$precheck$;

create table private.algo_l1_policy (
  singleton boolean primary key default true constraint algo_l1_policy_singleton_check check (singleton),
  policy_version text not null constraint algo_l1_policy_version_check
    check (policy_version = btrim(policy_version) and length(policy_version) between 1 and 100),
  enabled boolean not null,
  production_rollout_bps integer not null
    constraint algo_l1_policy_rollout_check check (production_rollout_bps between 0 and 10000),
  candidate_pool_size integer not null
    constraint algo_l1_policy_candidate_pool_check check (candidate_pool_size between 1 and 1000),
  max_page_size integer not null
    constraint algo_l1_policy_page_size_check check (max_page_size between 1 and 50),
  freshness_horizon_hours integer not null
    constraint algo_l1_policy_freshness_horizon_check check (freshness_horizon_hours between 1 and 720),
  freshness_weight numeric(12,6) not null
    constraint algo_l1_policy_freshness_weight_check check (freshness_weight between 0 and 100),
  follow_weight numeric(12,6) not null
    constraint algo_l1_policy_follow_weight_check check (follow_weight between 0 and 100),
  like_weight numeric(12,6) not null
    constraint algo_l1_policy_like_weight_check check (like_weight between 0 and 100),
  comment_weight numeric(12,6) not null
    constraint algo_l1_policy_comment_weight_check check (comment_weight between 0 and 100),
  save_weight numeric(12,6) not null
    constraint algo_l1_policy_save_weight_check check (save_weight between 0 and 100),
  completion_weight numeric(12,6) not null
    constraint algo_l1_policy_completion_weight_check check (completion_weight between 0 and 100),
  rewatch_weight numeric(12,6) not null
    constraint algo_l1_policy_rewatch_weight_check check (rewatch_weight between 0 and 100),
  exploration_weight numeric(12,6) not null
    constraint algo_l1_policy_exploration_weight_check check (exploration_weight between 0 and 100),
  short_watch_ratio_threshold numeric(8,6) not null
    constraint algo_l1_policy_short_ratio_check check (short_watch_ratio_threshold between 0 and 1),
  short_watch_penalty numeric(12,6) not null
    constraint algo_l1_policy_short_penalty_check check (short_watch_penalty between 0 and 1000),
  recent_completed_penalty numeric(12,6) not null
    constraint algo_l1_policy_completed_penalty_check check (recent_completed_penalty between 0 and 1000),
  repeat_view_penalty numeric(12,6) not null
    constraint algo_l1_policy_repeat_penalty_check check (repeat_view_penalty between 0 and 1000),
  repeat_view_penalty_cap numeric(12,6) not null
    constraint algo_l1_policy_repeat_cap_check check (repeat_view_penalty_cap between 0 and 1000),
  same_session_penalty numeric(12,6) not null
    constraint algo_l1_policy_session_penalty_check check (same_session_penalty between 0 and 1000),
  minimum_watch_samples integer not null
    constraint algo_l1_policy_watch_samples_check check (minimum_watch_samples between 1 and 100),
  creator_page_cap integer not null
    constraint algo_l1_policy_creator_cap_check check (creator_page_cap between 1 and 50),
  cursor_ttl_minutes integer not null
    constraint algo_l1_policy_cursor_ttl_check check (cursor_ttl_minutes between 1 and 1440),
  created_at timestamp with time zone not null default clock_timestamp(),
  updated_at timestamp with time zone not null default clock_timestamp()
);

alter table private.algo_l1_policy enable row level security;
alter table private.algo_l1_policy force row level security;

revoke all privileges on table private.algo_l1_policy
  from public, anon, authenticated, service_role;

insert into private.algo_l1_policy(
  singleton,
  policy_version,
  enabled,
  production_rollout_bps,
  candidate_pool_size,
  max_page_size,
  freshness_horizon_hours,
  freshness_weight,
  follow_weight,
  like_weight,
  comment_weight,
  save_weight,
  completion_weight,
  rewatch_weight,
  exploration_weight,
  short_watch_ratio_threshold,
  short_watch_penalty,
  recent_completed_penalty,
  repeat_view_penalty,
  repeat_view_penalty_cap,
  same_session_penalty,
  minimum_watch_samples,
  creator_page_cap,
  cursor_ttl_minutes
) values (
  true,
  'nelyon-algo-l1-v1',
  true,
  0,
  200,
  50,
  168,
  30,
  20,
  8,
  10,
  12,
  12,
  6,
  5,
  0.20,
  35,
  25,
  5,
  20,
  100,
  3,
  2,
  30
);

create index likes_video_created_idx
  on public.likes(video_id, created_at desc);
create index comments_video_created_idx
  on public.comments(video_id, created_at desc);
create index video_saves_video_created_idx
  on public.video_saves(video_id, created_at desc);
create index video_views_session_video_created_idx
  on public.video_views(client_session_id, video_id, created_at desc);

create or replace function private.algo_l1_hash_u32_v1(p_value text)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select (('x' || substr(pg_catalog.md5(p_value), 1, 8))::bit(32)::bigint);
$$;

revoke all on function private.algo_l1_hash_u32_v1(text)
  from public, anon, authenticated, service_role;

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
  cursor_id uuid
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
    if p_policy_version is distinct from v_policy.policy_version then
      raise exception 'algo_l1_policy_mismatch' using errcode = '22023';
    end if;
    v_as_of := p_as_of;
  end if;

  if v_viewer_id is not null then
    select count(*)
    into v_useful_actions
    from (
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
    ) actions;
  end if;
  v_cold_start := v_viewer_id is null or v_useful_actions < 3;

  v_rollout_seed := coalesce(v_viewer_id::text, p_client_session_id::text)
    || '|' || v_policy.policy_version;
  v_rollout_bucket := mod(private.algo_l1_hash_u32_v1(v_rollout_seed), 10000)::integer;
  v_behavioral := v_policy.enabled
    and v_rollout_bucket < v_policy.production_rollout_bps;
  v_mode := case when v_behavioral then 'behavioral_l1' else 'chronological' end;

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
  like_features as (
    select l.video_id, count(*)::bigint as raw_likes
    from public.likes l
    join candidates c on c.id = l.video_id
    where l.created_at <= v_as_of
    group by l.video_id
  ),
  comment_features as (
    select cmt.video_id, count(*)::bigint as raw_comments
    from public.comments cmt
    join candidates c on c.id = cmt.video_id
    where cmt.created_at <= v_as_of
    group by cmt.video_id
  ),
  save_features as (
    select s.video_id, count(*)::bigint as raw_saves
    from public.video_saves s
    join candidates c on c.id = s.video_id
    where s.created_at <= v_as_of
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
    join candidates c on c.id = vv.video_id
    where vv.created_at <= v_as_of
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
    join candidates c on c.id = vv.video_id
    where vv.created_at <= v_as_of
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
      case when coalesce(vh.short_watch_seen, false)
        then v_policy.short_watch_penalty else 0 end as short_watch_points,
      case when coalesce(vh.recent_completed, false)
        then v_policy.recent_completed_penalty else 0 end as completed_points,
      least(
        v_policy.repeat_view_penalty_cap,
        coalesce(vh.recent_exposures, 0) * v_policy.repeat_view_penalty
      ) as repeat_points
    from candidates c
    left join like_features lf on lf.video_id = c.id
    left join comment_features cf on cf.video_id = c.id
    left join save_features sf on sf.video_id = c.id
    left join watch_features wf on wf.video_id = c.id
    left join follow_features ff on ff.creator_id = c.user_id
    left join viewer_history vh on vh.video_id = c.id
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
          - same_session_points
          - short_watch_points
          - completed_points
          - repeat_points
        )::numeric, 6)
        else 0::numeric
      end::numeric(18,6) as rank_score
    from components
  ),
  after_cursor as (
    select s.*
    from scored s
    where p_as_of is null
       or (s.rank_score, s.created_at, s.id)
          < (p_before_score, p_before_created_at, p_before_id)
  ),
  creator_numbered as (
    select
      ac.*,
      row_number() over (
        partition by ac.user_id
        order by ac.rank_score desc, ac.created_at desc, ac.id desc
      ) as creator_rank
    from after_cursor ac
  ),
  preferred_numbered as (
    select
      cn.*,
      row_number() over (
        order by cn.rank_score desc, cn.created_at desc, cn.id desc
      ) as preferred_rank
    from creator_numbered cn
    where cn.creator_rank <= v_policy.creator_page_cap
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
      cn.*,
      row_number() over (
        order by cn.rank_score desc, cn.created_at desc, cn.id desc
      ) as fill_rank
    from creator_numbered cn
    where not exists (select 1 from pass_one p1 where p1.id = cn.id)
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
    v_policy.policy_version,
    pr.rank_score,
    v_as_of,
    pr.rank_score,
    pr.created_at,
    pr.id
  from page_rows pr
  order by pr.rank_score desc, pr.created_at desc, pr.id desc;
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
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_ranked_feed_l1_v1'
      and pg_get_function_identity_arguments(p.oid) =
        'p_client_session_id uuid, p_limit integer, p_as_of timestamp with time zone, p_before_score numeric, p_before_created_at timestamp with time zone, p_before_id uuid, p_policy_version text'
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
    'raw_signal_authority_missing', (
      select (to_regclass('public.video_views') is null)::integer
    ),
    'video_eligibility_authority_missing', (
      select (
        to_regprocedure('private.video_can_view_owner(uuid)') is null
        or to_regprocedure('private.admin_content_is_visible(text,uuid)') is null
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
        select 1 from pg_indexes i
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
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%ranked_feed%'
    ),
    'ads_dependency_present', (
      select count(*)
      from ranking_function
      where lower(definition) ~ '(advertising|campaign|billing|ad_spend|marketplace_ads)'
    )
  );
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1() to service_role;

commit;
