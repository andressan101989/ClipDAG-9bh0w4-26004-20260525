begin;

-- Stories visibility is decided in Postgres, including blocks initiated by
-- either participant. SECURITY DEFINER is required because blocked_users RLS
-- intentionally exposes only rows created by the current blocker.
create or replace function private.story_can_view_owner(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    (select auth.uid()) is not null
    and p_owner_id is not null
    and (
      p_owner_id = (select auth.uid())
      or (
        exists (
          select 1
          from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = p_owner_id
        )
        and not exists (
          select 1
          from public.blocked_users b
          where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_owner_id)
             or (b.blocker_id = p_owner_id and b.blocked_id = (select auth.uid()))
        )
      )
    );
$$;

revoke all on function private.story_can_view_owner(uuid)
  from public, anon, authenticated, service_role;

drop policy if exists stories_read_active_or_owned on public.stories;
drop policy if exists stories_read_visible on public.stories;
create policy stories_read_visible
  on public.stories
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and private.story_can_view_owner(user_id)
    )
  );

-- Story rows are created only by the canonical RPC below. The owner retains
-- read/delete access, while media and expiry are no longer caller-controlled.
drop policy if exists stories_insert_owned on public.stories;

revoke all on table public.stories from anon, authenticated;
grant select, delete on table public.stories to authenticated;

revoke all on table public.story_views from anon, authenticated;
grant select, insert on table public.story_views to authenticated;

-- media_assets/media_asset_links are read models for clients. Mutations remain
-- owned by the canonical media Edge/RPC lifecycle and service_role.
revoke all on table public.media_assets from anon, authenticated;
grant select on table public.media_assets to anon, authenticated;

revoke all on table public.media_asset_links from anon, authenticated;
grant select on table public.media_asset_links to anon, authenticated;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_media_url text;
  v_media_type text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'invalid_asset_id';
  end if;

  perform a.id
  from public.media_assets a
  where a.id = p_asset_id
  for update;

  select
    a.public_url,
    case
      when a.media_kind = 'image' and a.purpose = 'post_image' then 'photo'
      when a.media_kind = 'video' and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id
    and a.owner_id = v_actor
    and a.provider = 'r2'
    and a.status = 'ready'
    and a.visibility = 'public'
    and a.public_url is not null
    and a.public_url ~* '^https://'
    and (
      (a.media_kind = 'image' and a.purpose = 'post_image')
      or (a.media_kind = 'video' and a.purpose = 'story_video')
    );

  if v_media_url is null or v_media_type is null then
    raise exception using errcode = '42501', message = 'story_asset_not_ready_or_owned';
  end if;

  if exists (
    select 1
    from public.media_asset_links l
    where l.asset_id = p_asset_id
  ) then
    raise exception using errcode = '23505', message = 'story_asset_already_linked';
  end if;

  insert into public.stories(user_id, media_url, media_type)
  values(v_actor, v_media_url, v_media_type)
  returning id into v_story_id;

  insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
  values(p_asset_id, 'story', v_story_id, 'media', 0);

  return v_story_id;
end;
$$;

revoke all on function public.create_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid)
  to authenticated, service_role;

-- Compatibility aliases retain their signatures but delegate creation to the
-- one canonical implementation. The URL-array overload remains service-only.
create or replace function public.create_photo_story_with_media(p_asset_id uuid)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.create_story_with_media(p_asset_id);
$$;

revoke all on function public.create_photo_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_photo_story_with_media(uuid)
  to authenticated, service_role;

create or replace function public.create_photo_story_with_media(
  p_media_urls text[],
  p_asset_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if coalesce(array_length(p_asset_ids, 1), 0) <> 1
     or coalesce(array_length(p_media_urls, 1), 0) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_media_count';
  end if;
  if p_media_urls[1] is null or btrim(p_media_urls[1]) !~* '^https://' then
    raise exception using errcode = '22023', message = 'invalid_media_url';
  end if;

  return public.create_story_with_media(p_asset_ids[1]);
end;
$$;

revoke all on function public.create_photo_story_with_media(text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.create_photo_story_with_media(text[], uuid[])
  to service_role;

comment on function public.create_story_with_media(uuid) is
  'Canonical atomic Story creation from one owned READY public R2 media asset; server controls media URL, type, expiry, and link.';
comment on function public.create_photo_story_with_media(uuid) is
  'Compatibility alias. New callers must use create_story_with_media(uuid).';
comment on function public.create_photo_story_with_media(text[], uuid[]) is
  'Legacy service-only compatibility alias. URLs are not authoritative; creation delegates to create_story_with_media(uuid).';

notify pgrst, 'reload schema';

commit;
