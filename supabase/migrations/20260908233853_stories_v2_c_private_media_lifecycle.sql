begin;

-- B briefly allowed public story_video assets. C1 must reconcile any such
-- linked rows explicitly rather than silently making an existing Story
-- unplayable. The approved production baseline has no Story links.
do $$
begin
  if exists (
    select 1
    from public.media_asset_links l
    join public.media_assets a on a.id = l.asset_id
    where l.entity_type = 'story'
      and l.slot = 'media'
      and l.position = 0
      and a.purpose in ('story_image', 'story_video')
      and a.visibility <> 'private'
  ) then
    raise exception using
      errcode = '55000',
      message = 'story_private_media_reconciliation_required';
  end if;
end;
$$;

-- Canonical Story rows identify media through media_asset_links. The URL
-- column remains only for public legacy photo rows and must never contain a
-- private object key or temporary signed URL.
alter table public.stories
  alter column media_url drop not null;

comment on column public.stories.media_url is
  'Legacy public HTTPS fallback only. Canonical private Story media is resolved from media_asset_links and this column remains null.';

-- Every Story link has one canonical shape and at most one media asset.
alter table public.media_asset_links
  drop constraint if exists media_asset_links_story_shape_check;
alter table public.media_asset_links
  add constraint media_asset_links_story_shape_check
  check (
    entity_type <> 'story'
    or (slot = 'media' and position = 0)
  );

create unique index story_media_slot_position_unique
  on public.media_asset_links(entity_id, slot, position)
  where entity_type = 'story';

-- A follower may discover only the opaque asset UUID linked to a Story that
-- is active and visible through the existing Stories RLS authority. This does
-- not expose the private media_assets row or its bucket/object identity.
drop policy if exists media_asset_links_owner_read
  on public.media_asset_links;
create policy media_asset_links_owner_read
  on public.media_asset_links
  for select
  to authenticated
  using (
    entity_type <> 'story'
    and exists (
      select 1
      from public.media_assets a
      where a.id = media_asset_links.asset_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists media_asset_links_public_read
  on public.media_asset_links;
create policy media_asset_links_public_read
  on public.media_asset_links
  for select
  to anon, authenticated
  using (
    entity_type <> 'story'
    and exists (
      select 1
      from public.media_assets a
      where a.id = media_asset_links.asset_id
        and a.visibility = 'public'
        and a.status = 'ready'
    )
  );

drop policy if exists media_asset_links_story_visible_read
  on public.media_asset_links;
create policy media_asset_links_story_visible_read
  on public.media_asset_links
  for select
  to authenticated
  using (
    entity_type = 'story'
    and slot = 'media'
    and position = 0
    and exists (
      select 1
      from public.stories s
      where s.id = media_asset_links.entity_id
        and s.expires_at > now()
    )
  );

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
    case
      when a.media_kind = 'image'
       and a.purpose = 'post_image'
       and a.visibility = 'public'
        then a.public_url
      else null
    end,
    case
      when a.media_kind = 'image'
       and a.purpose in ('story_image', 'post_image') then 'photo'
      when a.media_kind = 'video'
       and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id
    and a.owner_id = v_actor
    and a.provider = 'r2'
    and a.status = 'ready'
    and a.bucket_name is not null
    and btrim(a.bucket_name) <> ''
    and a.object_key is not null
    and btrim(a.object_key) <> ''
    and (
      (
        a.visibility = 'private'
        and a.public_url is null
        and (
          (a.media_kind = 'image' and a.purpose = 'story_image')
          or (a.media_kind = 'video' and a.purpose = 'story_video')
        )
      )
      or (
        a.visibility = 'public'
        and a.public_url is not null
        and a.public_url ~* '^https://'
        and a.media_kind = 'image'
        and a.purpose = 'post_image'
      )
    );

  if v_media_type is null then
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

  insert into public.media_asset_links(
    asset_id,
    entity_type,
    entity_id,
    slot,
    position
  )
  values(p_asset_id, 'story', v_story_id, 'media', 0);

  return v_story_id;
end;
$$;

comment on function public.create_story_with_media(uuid) is
  'Canonical atomic Story creation. New Stories use one owned READY private R2 story_image/story_video asset with a null media_url; public post_image remains a legacy photo compatibility path.';

notify pgrst, 'reload schema';

commit;
