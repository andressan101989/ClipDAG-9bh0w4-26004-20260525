begin;

-- Story view writes are owned by one server-side RPC. Clients retain the
-- narrow SELECT policy used to render their own seen/unseen state.
drop policy if exists story_views_insert_owned on public.story_views;
drop policy if exists story_views_read_owned on public.story_views;
create policy story_views_read_owned
  on public.story_views
  for select
  to authenticated
  using (viewer_id = (select auth.uid()));

revoke all on table public.story_views from anon, authenticated;
grant select on table public.story_views to authenticated;

-- Supports the owner-only keyset query: equality by Story, then descending
-- timestamp and UUID tie-breaker. Existing indexes do not cover this order.
create index story_views_story_viewed_at_viewer_idx
  on public.story_views(story_id, viewed_at desc, viewer_id desc);

create or replace function public.mark_story_viewed(p_story_id uuid)
returns table(status text, viewed_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_viewed_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id
    and s.expires_at > now()
    and private.story_can_view_owner(s.user_id);

  if v_owner is null then
    raise exception using errcode = '42501', message = 'story_not_visible_or_expired';
  end if;

  if v_owner = v_actor then
    return query select 'owner'::text, null::timestamptz;
    return;
  end if;

  insert into public.story_views as sv(story_id, viewer_id)
  values(p_story_id, v_actor)
  on conflict (story_id, viewer_id) do nothing
  returning sv.viewed_at into v_viewed_at;

  if v_viewed_at is not null then
    return query select 'recorded'::text, v_viewed_at;
    return;
  end if;

  select sv.viewed_at
  into v_viewed_at
  from public.story_views sv
  where sv.story_id = p_story_id
    and sv.viewer_id = v_actor;

  return query select 'already_recorded'::text, v_viewed_at;
end;
$$;

revoke all on function public.mark_story_viewed(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_story_viewed(uuid)
  to authenticated;

comment on function public.mark_story_viewed(uuid) is
  'Canonical idempotent Story view mutation. Active visible non-owner views are recorded once; owner self-views are never persisted.';

create or replace function public.get_story_viewers(
  p_story_id uuid,
  p_limit integer default 50,
  p_before_viewed_at timestamptz default null,
  p_before_viewer_id uuid default null
)
returns table(
  viewer_id uuid,
  username text,
  avatar_url text,
  viewed_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  if (p_before_viewed_at is null) <> (p_before_viewer_id is null) then
    raise exception using errcode = '22023', message = 'invalid_viewer_cursor';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id;

  if v_owner is null then
    raise exception using errcode = '42501', message = 'story_not_found';
  end if;

  if v_owner <> v_actor then
    raise exception using errcode = '42501', message = 'story_viewers_owner_only';
  end if;

  return query
  with viewer_total as (
    select count(*)::bigint as total_count
    from public.story_views sv
    where sv.story_id = p_story_id
      and sv.viewer_id <> v_owner
  ), viewer_page as (
    select
      sv.viewer_id,
      up.username,
      up.avatar_url,
      sv.viewed_at
    from public.story_views sv
    join public.user_profiles up on up.id = sv.viewer_id
    where sv.story_id = p_story_id
      and sv.viewer_id <> v_owner
      and (
        p_before_viewed_at is null
        or sv.viewed_at < p_before_viewed_at
        or (
          sv.viewed_at = p_before_viewed_at
          and sv.viewer_id < p_before_viewer_id
        )
      )
    order by sv.viewed_at desc, sv.viewer_id desc
    limit v_limit
  )
  select
    vp.viewer_id,
    vp.username,
    vp.avatar_url,
    vp.viewed_at,
    vt.total_count
  from viewer_page vp
  cross join viewer_total vt
  order by vp.viewed_at desc, vp.viewer_id desc;
end;
$$;

revoke all on function public.get_story_viewers(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_viewers(uuid, integer, timestamptz, uuid)
  to authenticated;

comment on function public.get_story_viewers(uuid, integer, timestamptz, uuid) is
  'Owner-only Story viewer list with unique-viewer count and stable viewed_at/viewer_id keyset pagination. Returns public profile display fields only.';

notify pgrst, 'reload schema';

commit;
