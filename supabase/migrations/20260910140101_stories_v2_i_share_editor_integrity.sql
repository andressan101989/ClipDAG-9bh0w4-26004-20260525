begin;

alter table public.stories
  add column if not exists story_kind text not null default 'media',
  add column if not exists shared_video_id uuid,
  add column if not exists shared_content_type text,
  add column if not exists story_composition jsonb not null
    default '{"version":1,"elements":[]}'::jsonb,
  add column if not exists client_story_id uuid;

alter table public.stories
  drop constraint if exists stories_story_kind_check,
  drop constraint if exists stories_shared_content_type_check,
  drop constraint if exists stories_source_coherence_check,
  drop constraint if exists stories_shared_video_id_fkey;

alter table public.stories
  add constraint stories_story_kind_check
    check (story_kind in ('media', 'shared')),
  add constraint stories_shared_content_type_check
    check (shared_content_type is null or shared_content_type in ('feed', 'reel')),
  add constraint stories_source_coherence_check
    check (
      (story_kind = 'media' and shared_video_id is null and shared_content_type is null)
      or
      (story_kind = 'shared' and media_url is null and shared_content_type is not null)
    ),
  add constraint stories_shared_video_id_fkey
    foreign key (shared_video_id) references public.videos(id) on delete set null;

create unique index if not exists stories_owner_client_story_unique
  on public.stories(user_id, client_story_id)
  where client_story_id is not null;

create index if not exists stories_shared_video_idx
  on public.stories(shared_video_id)
  where shared_video_id is not null;

comment on column public.stories.story_kind is
  'Story presentation kind. media uses canonical Story media; shared references existing public.videos content.';
comment on column public.stories.shared_video_id is
  'Nullable canonical public.videos identity. ON DELETE SET NULL preserves the Story shell without retaining source media.';
comment on column public.stories.shared_content_type is
  'Server-derived feed/reel presentation type retained only so a deleted source can render an unavailable shell.';
comment on column public.stories.story_composition is
  'Validated versioned normalized text/sticker composition. Never contains source or signed media URLs.';
comment on column public.stories.client_story_id is
  'Owner-scoped client idempotency key for one logical Story publish attempt.';

create or replace function private.story_validate_composition(p_composition jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_element jsonb;
  v_type text;
  v_text_count integer := 0;
  v_sticker_count integer := 0;
begin
  if p_composition is null
     or jsonb_typeof(p_composition) <> 'object'
     or octet_length(p_composition::text) > 32768
     or jsonb_typeof(p_composition -> 'version') <> 'number'
     or (p_composition ->> 'version') <> '1'
     or jsonb_typeof(p_composition -> 'elements') <> 'array'
     or jsonb_array_length(p_composition -> 'elements') > 32
     or exists (
       select 1 from jsonb_object_keys(p_composition) as key
       where key not in ('version', 'elements')
     ) then
    raise exception using errcode = '22023', message = 'invalid_story_composition';
  end if;

  for v_element in select value from jsonb_array_elements(p_composition -> 'elements')
  loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_story_element';
    end if;
    v_type := v_element ->> 'type';
    if v_type not in ('text', 'sticker')
       or coalesce(v_element ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_element -> 'x') <> 'number'
       or jsonb_typeof(v_element -> 'y') <> 'number'
       or jsonb_typeof(v_element -> 'scale') <> 'number'
       or jsonb_typeof(v_element -> 'rotation') <> 'number'
       or (v_element ->> 'x')::numeric not between 0 and 1
       or (v_element ->> 'y')::numeric not between 0 and 1
       or (v_element ->> 'scale')::numeric not between 0.5 and 4
       or (v_element ->> 'rotation')::numeric not between -180 and 180 then
      raise exception using errcode = '22023', message = 'invalid_story_element';
    end if;

    if v_type = 'text' then
      v_text_count := v_text_count + 1;
      if exists (
           select 1 from jsonb_object_keys(v_element) as key
           where key not in ('id','type','text','x','y','scale','rotation','color','align','size')
         )
         or jsonb_typeof(v_element -> 'text') <> 'string'
         or char_length(btrim(v_element ->> 'text')) not between 1 and 200
         or (v_element ->> 'text') ~ '[<>]'
         or (v_element ->> 'color') not in ('#FFFFFF','#111111','#FF2D78','#7C5CFF','#00D4FF','#FFD60A')
         or (v_element ->> 'align') not in ('left','center','right')
         or (v_element ->> 'size') not in ('small','medium','large') then
        raise exception using errcode = '22023', message = 'invalid_story_text_element';
      end if;
    else
      v_sticker_count := v_sticker_count + 1;
      if exists (
           select 1 from jsonb_object_keys(v_element) as key
           where key not in ('id','type','value','x','y','scale','rotation')
         )
         or jsonb_typeof(v_element -> 'value') <> 'string'
         or (v_element ->> 'value') not in ('❤️','😂','😮','😢','🔥','👏','✨','⭐','💯','🎉','😍') then
        raise exception using errcode = '22023', message = 'invalid_story_sticker_element';
      end if;
    end if;
  end loop;

  if v_text_count > 10 or v_sticker_count > 24 then
    raise exception using errcode = '22023', message = 'story_composition_limit_exceeded';
  end if;
  if (
    select count(*) <> count(distinct value ->> 'id')
    from jsonb_array_elements(p_composition -> 'elements')
  ) then
    raise exception using errcode = '22023', message = 'duplicate_story_element_id';
  end if;
  return p_composition;
end;
$$;

revoke all on function private.story_validate_composition(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.create_story_with_media_core(
  p_asset_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
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
  v_composition jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'invalid_asset_id';
  end if;
  v_composition := private.story_validate_composition(p_composition);

  if p_client_story_id is not null then
    select s.id into v_story_id
    from public.stories s
    where s.user_id = v_actor and s.client_story_id = p_client_story_id
      and s.story_kind = 'media' and s.story_composition = v_composition
      and exists (
        select 1 from public.media_asset_links l
        where l.entity_type = 'story' and l.entity_id = s.id
          and l.slot = 'media' and l.position = 0 and l.asset_id = p_asset_id
      );
    if v_story_id is not null then return v_story_id; end if;
    if exists (
      select 1 from public.stories s
      where s.user_id = v_actor and s.client_story_id = p_client_story_id
    ) then
      raise exception using errcode = '23505', message = 'story_idempotency_conflict';
    end if;
  end if;

  perform a.id from public.media_assets a where a.id = p_asset_id for update;
  select
    case when a.media_kind = 'image' and a.purpose = 'post_image'
      and a.visibility = 'public' then a.public_url else null end,
    case
      when a.media_kind = 'image' and a.purpose in ('story_image','post_image') then 'photo'
      when a.media_kind = 'video' and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id and a.owner_id = v_actor and a.provider = 'r2'
    and a.status = 'ready' and nullif(btrim(a.bucket_name), '') is not null
    and nullif(btrim(a.object_key), '') is not null
    and (
      (a.visibility = 'private' and a.public_url is null and
        ((a.media_kind = 'image' and a.purpose = 'story_image') or
         (a.media_kind = 'video' and a.purpose = 'story_video')))
      or
      (a.visibility = 'public' and a.public_url ~* '^https://'
        and a.media_kind = 'image' and a.purpose = 'post_image')
    );
  if v_media_type is null then
    raise exception using errcode = '42501', message = 'story_asset_not_ready_or_owned';
  end if;
  if exists (select 1 from public.media_asset_links l where l.asset_id = p_asset_id) then
    raise exception using errcode = '23505', message = 'story_asset_already_linked';
  end if;

  insert into public.stories(
    user_id, media_url, media_type, story_kind, story_composition, client_story_id
  ) values (
    v_actor, v_media_url, v_media_type, 'media', v_composition, p_client_story_id
  ) returning id into v_story_id;
  insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
  values(p_asset_id, 'story', v_story_id, 'media', 0);
  return v_story_id;
end;
$$;

revoke all on function private.create_story_with_media_core(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_story_with_media(
  p_asset_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select private.create_story_with_media_core(p_asset_id, p_composition, p_client_story_id);
$$;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select private.create_story_with_media_core(
    p_asset_id, '{"version":1,"elements":[]}'::jsonb, null
  );
$$;

revoke all on function public.create_story_with_media(uuid,jsonb,uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid)
  to authenticated, service_role;
revoke all on function public.create_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid)
  to authenticated, service_role;

create or replace function public.create_story_from_content(
  p_video_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_content_type text;
  v_composition jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_video_id is null or p_client_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_source';
  end if;
  v_composition := private.story_validate_composition(p_composition);

  select s.id into v_story_id
  from public.stories s
  where s.user_id = v_actor and s.client_story_id = p_client_story_id
    and s.story_kind = 'shared' and s.shared_video_id = p_video_id
    and s.story_composition = v_composition;
  if v_story_id is not null then return v_story_id; end if;
  if exists (
    select 1 from public.stories s
    where s.user_id = v_actor and s.client_story_id = p_client_story_id
  ) then
    raise exception using errcode = '23505', message = 'story_idempotency_conflict';
  end if;

  perform v.id from public.videos v where v.id = p_video_id for key share;
  if not found or not public.marketplace_creator_content_visible(p_video_id, v_actor) then
    raise exception using errcode = '42501', message = 'story_source_not_visible';
  end if;
  v_content_type := public.marketplace_video_content_type(p_video_id);
  if v_content_type not in ('feed','reel') then
    raise exception using errcode = '22023', message = 'story_source_type_invalid';
  end if;

  insert into public.stories(
    user_id, media_url, media_type, story_kind, shared_video_id,
    shared_content_type, story_composition, client_story_id
  ) values (
    v_actor, null, 'photo', 'shared', p_video_id,
    v_content_type, v_composition, p_client_story_id
  ) returning id into v_story_id;
  return v_story_id;
end;
$$;

revoke all on function public.create_story_from_content(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_story_from_content(uuid,jsonb,uuid)
  to authenticated;

create or replace function public.get_story_shared_content(p_story_id uuid)
returns table(
  status text,
  source_video_id uuid,
  content_type text,
  owner_id uuid,
  username text,
  avatar_url text,
  caption text,
  preview_url text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story public.stories%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  select s.* into v_story from public.stories s
  where s.id = p_story_id and s.story_kind = 'shared' and s.expires_at > now()
    and (s.user_id = v_actor or private.story_can_view_owner(s.user_id));
  if not found then
    raise exception using errcode = '42501', message = 'story_not_visible';
  end if;
  if v_story.shared_video_id is null
     or not public.marketplace_creator_content_visible(v_story.shared_video_id, v_actor) then
    return query select 'unavailable'::text, null::uuid, null::text,
      null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;
  return query
  select 'available'::text, v.id, v_story.shared_content_type, v.user_id,
    p.username, p.avatar_url, left(v.caption, 160),
    case
      when v_story.shared_content_type = 'reel' then
        case when v.thumbnail_url ~* '^https://' then v.thumbnail_url else null end
      when coalesce(cardinality(v.media_urls),0) > 0 then
        case when v.media_urls[1] ~* '^https://' then v.media_urls[1] else null end
      else case when v.video_url ~* '^https://' then v.video_url else null end
    end
  from public.videos v
  join public.user_profiles p on p.id = v.user_id
  where v.id = v_story.shared_video_id;
end;
$$;

revoke all on function public.get_story_shared_content(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_shared_content(uuid)
  to authenticated;

comment on function public.create_story_with_media(uuid,jsonb,uuid) is
  'Canonical Story media creation core wrapper with validated normalized composition and owner-scoped client idempotency.';
comment on function public.create_story_from_content(uuid,jsonb,uuid) is
  'Creates one Story shell that references canonical visible public.videos content without copying media.';
comment on function public.get_story_shared_content(uuid) is
  'Resolves a currently authorized shared Story preview; unavailable sources return no identity or media fields.';

notify pgrst, 'reload schema';

commit;
