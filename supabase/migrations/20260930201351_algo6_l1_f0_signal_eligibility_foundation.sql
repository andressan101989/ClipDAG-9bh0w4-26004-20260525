begin;

do $precheck$
begin
  if to_regclass('public.video_views') is not null then
    raise exception 'algo6_f0_video_views_already_exists';
  end if;
  if to_regclass('public.videos') is null
     or to_regclass('public.user_profiles') is null
     or to_regclass('public.follows') is null
     or to_regclass('public.blocked_users') is null
     or to_regclass('public.video_assets') is null
     or to_regclass('public.video_asset_links') is null
     or to_regclass('public.media_assets') is null
     or to_regclass('public.media_asset_links') is null
     or to_regprocedure('private.admin_content_is_visible(text,uuid)') is null then
    raise exception 'algo6_f0_required_authority_missing';
  end if;
end
$precheck$;

create table public.video_views (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  viewer_id uuid references public.user_profiles(id) on delete set null,
  client_event_id uuid not null unique,
  client_session_id uuid not null,
  watch_duration_ms bigint not null,
  media_duration_ms bigint,
  completion_ratio numeric(14,6),
  completed boolean,
  rewatch_count integer not null default 0,
  exit_reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint video_views_watch_duration_check
    check (watch_duration_ms between 0 and 86400000),
  constraint video_views_media_duration_check
    check (media_duration_ms is null or media_duration_ms between 1 and 86400000),
  constraint video_views_completion_ratio_check
    check (completion_ratio is null or completion_ratio between 0 and 86400000),
  constraint video_views_rewatch_count_check
    check (rewatch_count >= 0),
  constraint video_views_exit_reason_check
    check (exit_reason in ('swipe','background','unmount','unknown','ended')),
  constraint video_views_duration_derivation_check check (
    (
      media_duration_ms is null
      and completion_ratio is null
      and completed is null
      and rewatch_count = 0
    )
    or (
      media_duration_ms is not null
      and completion_ratio = round(watch_duration_ms::numeric / media_duration_ms::numeric, 6)
      and completed = (watch_duration_ms >= media_duration_ms)
      and rewatch_count = greatest(
        floor(watch_duration_ms::numeric / media_duration_ms::numeric)::integer - 1,
        0
      )
    )
  )
);

alter table public.video_views enable row level security;
alter table public.video_views force row level security;

revoke all privileges on table public.video_views
  from public, anon, authenticated, service_role;

create index video_views_viewer_created_idx
  on public.video_views(viewer_id, created_at desc)
  where viewer_id is not null;
create index video_views_video_created_idx
  on public.video_views(video_id, created_at desc);

drop index if exists public.videos_created_at_idx;
drop index if exists public.videos_user_id_idx;
create index videos_created_id_desc_idx
  on public.videos(created_at desc, id desc);
create index videos_user_created_id_desc_idx
  on public.videos(user_id, created_at desc, id desc);

create or replace function private.video_can_view_owner(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles u
    where u.id = p_owner_id
      and (
        p_owner_id = (select auth.uid())
        or (
          not exists (
            select 1
            from public.blocked_users b
            where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_owner_id)
               or (b.blocker_id = p_owner_id and b.blocked_id = (select auth.uid()))
          )
          and (
            not u.is_private
            or (
              (select auth.uid()) is not null
              and exists (
                select 1
                from public.follows f
                where f.follower_id = (select auth.uid())
                  and f.following_id = p_owner_id
              )
            )
          )
        )
      )
  );
$$;

revoke all on function private.video_can_view_owner(uuid)
  from public, anon, authenticated, service_role;
grant usage on schema private to anon, authenticated;
grant execute on function private.video_can_view_owner(uuid)
  to anon, authenticated;

drop policy if exists videos_select_all on public.videos;
create policy videos_select_all
  on public.videos
  for select
  to anon, authenticated
  using (
    private.admin_content_is_visible('video', id)
    and private.video_can_view_owner(user_id)
  );

create or replace function private.resolve_video_media_duration_ms_v1(p_video_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select round(va.duration_seconds * 1000)::bigint
      from public.video_asset_links val
      join public.video_assets va on va.id = val.asset_id
      where val.entity_type = 'video_post'
        and val.entity_id = p_video_id
        and val.slot = 'video'
        and va.status = 'ready'
        and va.deleted_at is null
        and va.duration_seconds > 0
        and va.duration_seconds * 1000 <= 86400000
      order by val.position, val.id
      limit 1
    ),
    (
      select ma.duration_ms
      from public.media_asset_links mal
      join public.media_assets ma on ma.id = mal.asset_id
      where mal.entity_type = 'video_post'
        and mal.entity_id = p_video_id
        and mal.slot in ('video', 'media')
        and ma.status = 'ready'
        and ma.deleted_at is null
        and ma.duration_ms between 1 and 86400000
      order by case when mal.slot = 'video' then 0 else 1 end, mal.position, mal.id
      limit 1
    )
  );
$$;

revoke all on function private.resolve_video_media_duration_ms_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.record_video_view_v1(
  p_video_id uuid,
  p_client_event_id uuid,
  p_client_session_id uuid,
  p_watch_duration_ms bigint,
  p_exit_reason text
)
returns table(
  status text,
  view_id uuid,
  video_id uuid,
  watch_duration_ms bigint,
  media_duration_ms bigint,
  completion_ratio numeric,
  completed boolean,
  rewatch_count integer,
  views_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_existing public.video_views;
  v_created public.video_views;
  v_media_duration_ms bigint;
  v_completion_ratio numeric(14,6);
  v_completed boolean;
  v_rewatch_count integer := 0;
  v_views_count bigint;
begin
  if p_video_id is null
     or p_client_event_id is null
     or p_client_session_id is null
     or p_watch_duration_ms is null
     or p_watch_duration_ms not between 0 and 86400000
     or p_exit_reason is null
     or p_exit_reason not in ('swipe','background','unmount','unknown','ended') then
    raise exception using errcode = '22023', message = 'video_view_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('algo6-video-view:' || p_client_event_id::text, 0)
  );

  select vv.* into v_existing
  from public.video_views vv
  where vv.client_event_id = p_client_event_id;

  if found then
    if v_existing.video_id <> p_video_id
       or v_existing.viewer_id is distinct from v_actor
       or v_existing.client_session_id <> p_client_session_id
       or v_existing.watch_duration_ms <> p_watch_duration_ms
       or v_existing.exit_reason <> p_exit_reason then
      raise exception using errcode = '23505', message = 'video_view_idempotency_conflict';
    end if;

    select v.views_count::bigint into v_views_count
    from public.videos v
    where v.id = v_existing.video_id;

    return query select
      'replayed'::text,
      v_existing.id,
      v_existing.video_id,
      v_existing.watch_duration_ms,
      v_existing.media_duration_ms,
      v_existing.completion_ratio,
      v_existing.completed,
      v_existing.rewatch_count,
      v_views_count;
    return;
  end if;

  select v.user_id into v_owner
  from public.videos v
  where v.id = p_video_id
    and private.admin_content_is_visible('video', v.id)
    and private.video_can_view_owner(v.user_id)
  for key share;

  if not found then
    raise exception using errcode = '42501', message = 'video_not_visible';
  end if;

  v_media_duration_ms := private.resolve_video_media_duration_ms_v1(p_video_id);
  if v_media_duration_ms is not null then
    v_completion_ratio := round(p_watch_duration_ms::numeric / v_media_duration_ms::numeric, 6);
    v_completed := p_watch_duration_ms >= v_media_duration_ms;
    v_rewatch_count := greatest(
      floor(p_watch_duration_ms::numeric / v_media_duration_ms::numeric)::integer - 1,
      0
    );
  end if;

  insert into public.video_views(
    video_id,
    viewer_id,
    client_event_id,
    client_session_id,
    watch_duration_ms,
    media_duration_ms,
    completion_ratio,
    completed,
    rewatch_count,
    exit_reason
  ) values (
    p_video_id,
    v_actor,
    p_client_event_id,
    p_client_session_id,
    p_watch_duration_ms,
    v_media_duration_ms,
    v_completion_ratio,
    v_completed,
    v_rewatch_count,
    p_exit_reason
  )
  returning * into v_created;

  update public.videos v
  set views_count = v.views_count + 1
  where v.id = p_video_id
  returning v.views_count::bigint into v_views_count;

  return query select
    'recorded'::text,
    v_created.id,
    v_created.video_id,
    v_created.watch_duration_ms,
    v_created.media_duration_ms,
    v_created.completion_ratio,
    v_created.completed,
    v_created.rewatch_count,
    v_views_count;
end;
$$;

revoke all on function public.record_video_view_v1(uuid,uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_video_view_v1(uuid,uuid,uuid,bigint,text)
  to anon, authenticated;

create or replace function public.get_my_video_analytics_v1(p_video_id uuid)
returns table(
  views bigint,
  unique_authenticated_viewers bigint,
  avg_watch_ms bigint,
  completion_rate numeric,
  rewatch_count bigint,
  rewatch_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_video_id is null or not exists (
    select 1
    from public.videos v
    where v.id = p_video_id
      and v.user_id = v_actor
  ) then
    raise exception using errcode = '42501', message = 'video_analytics_owner_only';
  end if;

  return query
  select
    count(*)::bigint,
    count(distinct vv.viewer_id) filter (where vv.viewer_id is not null)::bigint,
    coalesce(round(avg(vv.watch_duration_ms)), 0)::bigint,
    coalesce(
      round(
        100::numeric * count(*) filter (where vv.completed is true)
        / nullif(count(*) filter (where vv.completed is not null), 0),
        6
      ),
      0::numeric
    ),
    coalesce(sum(vv.rewatch_count), 0)::bigint,
    coalesce(
      round(
        100::numeric * count(*) filter (where vv.rewatch_count > 0)
        / nullif(count(*) filter (where vv.media_duration_ms is not null), 0),
        6
      ),
      0::numeric
    )
  from public.video_views vv
  where vv.video_id = p_video_id;
end;
$$;

revoke all on function public.get_my_video_analytics_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_video_analytics_v1(uuid) to authenticated;

create or replace function public.reconcile_algo_signal_foundation_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'view_event_without_video', (
      select count(*) from public.video_views vv
      left join public.videos v on v.id = vv.video_id
      where v.id is null
    ),
    'invalid_viewer_reference', (
      select count(*) from public.video_views vv
      left join public.user_profiles p on p.id = vv.viewer_id
      where vv.viewer_id is not null and p.id is null
    ),
    'duplicated_client_event', (
      select count(*) from (
        select vv.client_event_id
        from public.video_views vv
        group by vv.client_event_id
        having count(*) > 1
      ) duplicates
    ),
    'impossible_watch_duration', (
      select count(*) from public.video_views vv
      where vv.watch_duration_ms < 0 or vv.watch_duration_ms > 86400000
    ),
    'impossible_media_duration', (
      select count(*) from public.video_views vv
      where vv.media_duration_ms is not null
        and vv.media_duration_ms not between 1 and 86400000
    ),
    'invalid_completion_derivation', (
      select count(*) from public.video_views vv
      where (
        vv.media_duration_ms is null
        and (vv.completion_ratio is not null or vv.completed is not null)
      ) or (
        vv.media_duration_ms is not null
        and (
          vv.completion_ratio is distinct from round(vv.watch_duration_ms::numeric / vv.media_duration_ms::numeric, 6)
          or vv.completed is distinct from (vv.watch_duration_ms >= vv.media_duration_ms)
        )
      )
    ),
    'invalid_rewatch_derivation', (
      select count(*) from public.video_views vv
      where vv.rewatch_count <> case
        when vv.media_duration_ms is null then 0
        else greatest(
          floor(vv.watch_duration_ms::numeric / vv.media_duration_ms::numeric)::integer - 1,
          0
        )
      end
    ),
    'views_count_below_raw_events', (
      select count(*) from (
        select v.id
        from public.videos v
        join public.video_views vv on vv.video_id = v.id
        group by v.id, v.views_count
        having v.views_count < count(vv.id)
      ) inconsistent
    ),
    'raw_table_browser_readable', case when
      pg_catalog.has_table_privilege('anon', 'public.video_views', 'select')
      or pg_catalog.has_table_privilege('authenticated', 'public.video_views', 'select')
      then 1 else 0 end,
    'raw_table_browser_writable', case when
      pg_catalog.has_table_privilege('anon', 'public.video_views', 'insert,update,delete')
      or pg_catalog.has_table_privilege('authenticated', 'public.video_views', 'insert,update,delete')
      then 1 else 0 end,
    'raw_table_rls_missing', case when exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = 'public.video_views'::pg_catalog.regclass
        and (not c.relrowsecurity or not c.relforcerowsecurity)
    ) then 1 else 0 end,
    'video_privacy_helper_missing', case when
      pg_catalog.to_regprocedure('private.video_can_view_owner(uuid)') is null
      then 1 else 0 end,
    'video_rls_contract_missing', case when not exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = 'public.videos'::pg_catalog.regclass
        and p.polname = 'videos_select_all'
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%admin_content_is_visible%'
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%video_can_view_owner%'
    ) then 1 else 0 end,
    'required_indexes_missing', 5 - (
      select count(*)
      from pg_catalog.pg_indexes i
      where i.schemaname = 'public'
        and i.indexname in (
          'video_views_client_event_id_key',
          'video_views_viewer_created_idx',
          'video_views_video_created_idx',
          'videos_created_id_desc_idx',
          'videos_user_created_id_desc_idx'
        )
    )
  );
$$;

revoke all on function public.reconcile_algo_signal_foundation_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_signal_foundation_v1() to service_role;

commit;
