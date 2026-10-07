begin;

-- CREATOR-PREMIUM-B2
-- Extend the one canonical R2 media authority for Premium images only.
-- No Premium video, finance, publishing, bucket, or parallel media authority.

alter table public.media_asset_links
  drop constraint media_asset_links_entity_type_check;

alter table public.media_asset_links
  add constraint media_asset_links_entity_type_check check (
    entity_type in (
      'user_profile',
      'video_post',
      'story',
      'chat_message',
      'shop_product',
      'exclusive_content',
      'marketplace_store',
      'marketplace_dispute',
      'marketplace_return_shipment',
      'creator_premium_content'
    )
  );

alter table public.media_asset_links
  add constraint media_asset_links_creator_premium_shape_check check (
    entity_type <> 'creator_premium_content'
    or (slot in ('teaser','original') and "position" = 0)
  );

alter table public.media_assets
  add constraint media_assets_creator_premium_teaser_contract_check check (
    purpose <> 'creator_premium_teaser_image'
    or (
      provider = 'r2'
      and media_kind = 'image'
      and visibility = 'public'
      and mime_type in ('image/jpeg','image/png','image/webp')
      and size_bytes between 1 and 25000000
      and (
        status <> 'ready'
        or (public_url is not null and public_url ~* '^https://')
      )
    )
  );

alter table public.media_assets
  add constraint media_assets_creator_premium_original_contract_check check (
    purpose <> 'creator_premium_original_image'
    or (
      provider = 'r2'
      and media_kind = 'image'
      and visibility = 'private'
      and mime_type in ('image/jpeg','image/png','image/webp')
      and size_bytes between 1 and 25000000
      and public_url is null
    )
  );

create unique index creator_premium_media_content_slot_uidx
  on public.media_asset_links(entity_id, slot)
  where entity_type = 'creator_premium_content';

create unique index creator_premium_media_asset_uidx
  on public.media_asset_links(asset_id)
  where entity_type = 'creator_premium_content';

create function private.guard_creator_premium_media_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_content private.creator_premium_contents;
begin
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = new.asset_id;

  if not found then
    if new.entity_type = 'creator_premium_content' then
      raise exception using errcode = '23503', message = 'creator_premium_media_asset_not_found';
    end if;
    return new;
  end if;

  if v_asset.purpose in ('creator_premium_teaser_image','creator_premium_original_image')
     and new.entity_type <> 'creator_premium_content' then
    raise exception using errcode = '23514', message = 'creator_premium_media_entity_required';
  end if;

  if new.entity_type <> 'creator_premium_content' then
    return new;
  end if;

  if new.slot not in ('teaser','original') or new."position" <> 0 then
    raise exception using errcode = '23514', message = 'creator_premium_media_link_shape_invalid';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = new.entity_id;

  if not found then
    raise exception using errcode = '23503', message = 'creator_premium_content_not_found';
  end if;
  if v_content.creator_id is distinct from v_asset.owner_id then
    raise exception using errcode = '42501', message = 'creator_premium_media_cross_creator';
  end if;
  if v_content.content_kind <> 'image' then
    raise exception using errcode = '23514', message = 'creator_premium_image_content_required';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_asset.status <> 'ready'
     or v_asset.provider <> 'r2'
     or v_asset.media_kind <> 'image' then
    raise exception using errcode = '23514', message = 'creator_premium_media_asset_invalid';
  end if;

  if new.slot = 'teaser' and (
    v_asset.purpose <> 'creator_premium_teaser_image'
    or v_asset.visibility <> 'public'
    or v_asset.public_url is null
    or v_asset.public_url !~* '^https://'
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_teaser_invalid';
  end if;

  if new.slot = 'original' and (
    v_asset.purpose <> 'creator_premium_original_image'
    or v_asset.visibility <> 'private'
    or v_asset.public_url is not null
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_original_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_creator_premium_media_link_v1()
  from public, anon, authenticated, service_role;

create trigger media_asset_links_guard_creator_premium
before insert or update on public.media_asset_links
for each row execute function private.guard_creator_premium_media_link_v1();

drop policy media_asset_links_owner_read on public.media_asset_links;
create policy media_asset_links_owner_read on public.media_asset_links
for select to authenticated
using (
  entity_type not in ('story','creator_premium_content')
  and exists (
    select 1
    from public.media_assets asset
    where asset.id = media_asset_links.asset_id
      and asset.owner_id = (select auth.uid())
  )
);

drop policy media_asset_links_public_read on public.media_asset_links;
create policy media_asset_links_public_read on public.media_asset_links
for select to anon, authenticated
using (
  entity_type not in ('story','creator_premium_content')
  and exists (
    select 1
    from public.media_assets asset
    where asset.id = media_asset_links.asset_id
      and asset.visibility = 'public'
      and asset.status = 'ready'
  )
);

drop policy media_assets_owner_read on public.media_assets;
create policy media_assets_owner_read on public.media_assets
for select to authenticated
using (
  owner_id = (select auth.uid())
  and purpose <> 'creator_premium_original_image'
);

create function public.authorize_my_creator_premium_image_upload_v1(
  p_content_id uuid,
  p_purpose text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null
     or p_purpose not in ('creator_premium_teaser_image','creator_premium_original_image') then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_purpose';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_content.content_kind <> 'image' then
    raise exception using errcode = '22023', message = 'creator_premium_image_content_required';
  end if;
  return true;
end;
$$;

revoke all on function public.authorize_my_creator_premium_image_upload_v1(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_my_creator_premium_image_upload_v1(uuid,text)
  to authenticated;

create function public.set_my_creator_premium_image_media_v1(
  p_content_id uuid,
  p_teaser_asset_id uuid,
  p_original_asset_id uuid
) returns table (
  content_id uuid,
  teaser_url text,
  teaser_attached boolean,
  original_attached boolean,
  media_ready boolean,
  replayed boolean,
  replacement_cleanup_scheduled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_teaser public.media_assets;
  v_original public.media_assets;
  v_old_teaser uuid;
  v_old_original uuid;
  v_cleanup_result text;
  v_cleanup_scheduled boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null
     or p_teaser_asset_id is null
     or p_original_asset_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_image_media_required';
  end if;
  if p_teaser_asset_id = p_original_asset_id then
    raise exception using errcode = '22023', message = 'creator_premium_image_assets_must_differ';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-image-media:' || p_content_id::text, 0)
  );

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_content.content_kind <> 'image' then
    raise exception using errcode = '22023', message = 'creator_premium_image_content_required';
  end if;

  perform asset.id
  from public.media_assets asset
  where asset.id in (p_teaser_asset_id, p_original_asset_id)
  order by asset.id
  for update;

  select asset.* into v_teaser
  from public.media_assets asset
  where asset.id = p_teaser_asset_id;

  if not found
     or v_teaser.owner_id <> v_actor
     or v_teaser.status <> 'ready'
     or v_teaser.provider <> 'r2'
     or v_teaser.media_kind <> 'image'
     or v_teaser.purpose <> 'creator_premium_teaser_image'
     or v_teaser.visibility <> 'public'
     or v_teaser.public_url is null
     or v_teaser.public_url !~* '^https://' then
    raise exception using errcode = '42501', message = 'creator_premium_teaser_invalid';
  end if;

  select asset.* into v_original
  from public.media_assets asset
  where asset.id = p_original_asset_id;

  if not found
     or v_original.owner_id <> v_actor
     or v_original.status <> 'ready'
     or v_original.provider <> 'r2'
     or v_original.media_kind <> 'image'
     or v_original.purpose <> 'creator_premium_original_image'
     or v_original.visibility <> 'private'
     or v_original.public_url is not null then
    raise exception using errcode = '42501', message = 'creator_premium_original_invalid';
  end if;

  if exists (
    select 1 from public.media_asset_links link
    where link.asset_id = p_teaser_asset_id
      and not (
        link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'teaser'
        and link."position" = 0
      )
  ) then
    raise exception using errcode = '23505', message = 'creator_premium_teaser_asset_in_use';
  end if;

  if exists (
    select 1 from public.media_asset_links link
    where link.asset_id = p_original_asset_id
      and not (
        link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'original'
        and link."position" = 0
      )
  ) then
    raise exception using errcode = '23505', message = 'creator_premium_original_asset_in_use';
  end if;

  select
    (array_agg(link.asset_id order by link.created_at)
      filter (where link.slot = 'teaser'))[1],
    (array_agg(link.asset_id order by link.created_at)
      filter (where link.slot = 'original'))[1]
  into v_old_teaser, v_old_original
  from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id;

  if v_old_teaser = p_teaser_asset_id
     and v_old_original = p_original_asset_id then
    return query select p_content_id, v_teaser.public_url, true, true, true, true, false;
    return;
  end if;

  delete from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id;

  insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, "position", is_cover)
  values
    (p_teaser_asset_id, 'creator_premium_content', p_content_id, 'teaser', 0, false),
    (p_original_asset_id, 'creator_premium_content', p_content_id, 'original', 0, false);

  if v_old_teaser is not null
     and v_old_teaser not in (p_teaser_asset_id, p_original_asset_id) then
    v_cleanup_result := public.schedule_media_asset_deletion(v_old_teaser, v_actor);
    v_cleanup_scheduled := v_cleanup_scheduled or v_cleanup_result = 'scheduled';
  end if;

  if v_old_original is not null
     and v_old_original not in (p_teaser_asset_id, p_original_asset_id) then
    v_cleanup_result := public.schedule_media_asset_deletion(v_old_original, v_actor);
    v_cleanup_scheduled := v_cleanup_scheduled or v_cleanup_result = 'scheduled';
  end if;

  return query select p_content_id, v_teaser.public_url, true, true, true, false, v_cleanup_scheduled;
end;
$$;

revoke all on function public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid)
  to authenticated;

create function public.get_my_creator_premium_image_media_v1(p_content_id uuid)
returns table (
  content_id uuid,
  content_kind text,
  lifecycle_status text,
  teaser_url text,
  teaser_attached boolean,
  original_attached boolean,
  media_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.content_kind <> 'image' then
    raise exception using errcode = '22023', message = 'creator_premium_image_content_required';
  end if;

  return query
  select v_content.id, v_content.content_kind, v_content.lifecycle_status,
    max(asset.public_url) filter (
      where link.slot = 'teaser'
        and asset.purpose = 'creator_premium_teaser_image'
        and asset.visibility = 'public'
        and asset.status = 'ready'
        and asset.public_url ~* '^https://'
    ),
    coalesce(bool_or(
      link.slot = 'teaser'
      and asset.purpose = 'creator_premium_teaser_image'
      and asset.visibility = 'public'
      and asset.status = 'ready'
      and asset.public_url ~* '^https://'
    ), false),
    coalesce(bool_or(
      link.slot = 'original'
      and asset.purpose = 'creator_premium_original_image'
      and asset.visibility = 'private'
      and asset.status = 'ready'
      and asset.public_url is null
    ), false),
    coalesce(bool_or(
      link.slot = 'teaser'
      and asset.purpose = 'creator_premium_teaser_image'
      and asset.visibility = 'public'
      and asset.status = 'ready'
      and asset.public_url ~* '^https://'
    ), false)
    and coalesce(bool_or(
      link.slot = 'original'
      and asset.purpose = 'creator_premium_original_image'
      and asset.visibility = 'private'
      and asset.status = 'ready'
      and asset.public_url is null
    ), false)
  from public.media_asset_links link
  join public.media_assets asset on asset.id = link.asset_id
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;
end;
$$;

revoke all on function public.get_my_creator_premium_image_media_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_image_media_v1(uuid)
  to authenticated;

create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.asset_id = p_asset_id
      and (
        (link.entity_type = 'user_profile' and exists (
          select 1 from public.user_profiles profile
          where profile.id = link.entity_id and profile.avatar_url = asset.public_url
        ))
        or (link.entity_type = 'video_post' and exists (
          select 1 from public.videos video where video.id = link.entity_id
        ))
        or (link.entity_type = 'story' and exists (
          select 1 from public.stories story
          where story.id = link.entity_id and story.expires_at > pg_catalog.now()
        ))
        or (link.entity_type = 'shop_product' and exists (
          select 1 from public.products product
          where product.id = link.entity_id and product.status <> 'deleted'
        ))
        or (link.entity_type = 'marketplace_store' and exists (
          select 1 from public.marketplace_stores store
          where store.id = link.entity_id
            and ((link.slot = 'logo' and store.logo_asset_id = link.asset_id)
              or (link.slot = 'banner' and store.banner_asset_id = link.asset_id))
        ))
        or (link.entity_type = 'marketplace_dispute'
          and link.slot in ('buyer_evidence','seller_evidence')
          and exists (
            select 1 from public.marketplace_order_disputes dispute
            where dispute.id = link.entity_id
          ))
        or (link.entity_type = 'marketplace_return_shipment'
          and link.slot = 'return_label'
          and exists (
            select 1 from public.marketplace_return_shipments shipment
            where shipment.id = link.entity_id
              and shipment.return_label_asset_id = link.asset_id
          ))
        or (link.entity_type = 'chat_message'
          and link.slot = 'content'
          and exists (
            select 1 from public.messages message
            where message.id = link.entity_id
              and message.media_asset_id = link.asset_id
              and (
                message.deleted_at is null
                or exists (
                  select 1 from private.admin_content_moderation_actions action
                  where action.target_type = 'chat_message'
                    and action.target_id = message.id
                    and action.action = 'hide'
                )
              )
          ))
        or (link.entity_type = 'creator_premium_content'
          and link.slot in ('teaser','original')
          and link."position" = 0
          and exists (
            select 1
            from private.creator_premium_contents content
            where content.id = link.entity_id
              and content.creator_id = asset.owner_id
              and content.content_kind = 'image'
              and (
                (link.slot = 'teaser'
                  and asset.purpose = 'creator_premium_teaser_image'
                  and asset.provider = 'r2'
                  and asset.media_kind = 'image'
                  and asset.visibility = 'public'
                  and asset.status = 'ready'
                  and asset.public_url ~* '^https://')
                or (link.slot = 'original'
                  and asset.purpose = 'creator_premium_original_image'
                  and asset.provider = 'r2'
                  and asset.media_kind = 'image'
                  and asset.visibility = 'private'
                  and asset.status = 'ready'
                  and asset.public_url is null)
              )
          ))
      )
  );
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;

drop function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid);

create function public.get_creator_premium_catalog_v1(
  p_creator_id uuid,
  p_limit integer default 24,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  creator_id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  published_at timestamptz,
  created_at timestamptz,
  teaser_url text,
  entitled boolean,
  entitlement_source text,
  entitlement_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_creator_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_creator';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor)
     or not private.creator_premium_actor_is_operational_v1(p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor, p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;

  return query
  select content.id, content.creator_id, content.title, content.description,
    content.content_kind, content.access_mode, content.published_at, content.created_at,
    teaser.teaser_url, entitlement.allowed, entitlement.source, entitlement.expires_at
  from private.creator_premium_contents content
  left join lateral (
    select asset.public_url as teaser_url
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
      and link.slot = 'teaser'
      and link."position" = 0
      and asset.owner_id = content.creator_id
      and asset.provider = 'r2'
      and asset.media_kind = 'image'
      and asset.purpose = 'creator_premium_teaser_image'
      and asset.visibility = 'public'
      and asset.status = 'ready'
      and asset.public_url ~* '^https://'
    limit 1
  ) teaser on true
  cross join lateral private.resolve_creator_premium_entitlement_v1(content.id) entitlement
  where content.creator_id = p_creator_id
    and content.lifecycle_status = 'published'
    and content.published_at is not null
    and (content.content_kind <> 'image' or teaser.teaser_url is not null)
    and (p_cursor_published_at is null
      or (content.published_at, content.id) < (p_cursor_published_at, p_cursor_id))
  order by content.published_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  to authenticated;

drop function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid);

create function public.get_my_creator_premium_contents_v1(
  p_limit integer default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  lifecycle_status text,
  published_at timestamptz,
  quarantined_at timestamptz,
  removed_at timestamptz,
  deleted_at timestamptz,
  removal_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  teaser_url text,
  teaser_attached boolean,
  original_attached boolean,
  image_media_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  select content.id, content.title, content.description, content.content_kind,
    content.access_mode, content.lifecycle_status, content.published_at,
    content.quarantined_at, content.removed_at, content.deleted_at,
    content.removal_reason, content.created_at, content.updated_at,
    media.teaser_url, media.teaser_attached, media.original_attached,
    content.content_kind = 'image' and media.teaser_attached and media.original_attached
  from private.creator_premium_contents content
  left join lateral (
    select
      max(asset.public_url) filter (
        where link.slot = 'teaser'
          and asset.purpose = 'creator_premium_teaser_image'
          and asset.visibility = 'public'
          and asset.status = 'ready'
          and asset.public_url ~* '^https://'
      ) as teaser_url,
      coalesce(bool_or(
        link.slot = 'teaser'
        and asset.purpose = 'creator_premium_teaser_image'
        and asset.visibility = 'public'
        and asset.status = 'ready'
        and asset.public_url ~* '^https://'
      ), false) as teaser_attached,
      coalesce(bool_or(
        link.slot = 'original'
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
      ), false) as original_attached
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
  ) media on true
  where content.creator_id = v_actor
    and (p_cursor_created_at is null
      or (content.created_at, content.id) < (p_cursor_created_at, p_cursor_id))
  order by content.created_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

comment on function public.authorize_my_creator_premium_image_upload_v1(uuid,text) is
  'B2 authenticated upload authorization for an owned 18+ operational IMAGE draft and one exact Premium image purpose.';
comment on function public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid) is
  'B2 atomic/idempotent teaser and private-original binding with canonical orphan cleanup scheduling.';
comment on function public.get_my_creator_premium_image_media_v1(uuid) is
  'B2 safe owner media-state projection; never returns private original identity or storage metadata.';

commit;
