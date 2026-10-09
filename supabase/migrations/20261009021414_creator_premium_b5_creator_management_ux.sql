begin;

-- CREATOR-PREMIUM-B5: creator management only.
-- Finance remains disabled and this migration creates no publication,
-- entitlement, media-provider, wallet, ledger, or scheduler authority.

alter table private.creator_premium_offer_versions
  drop constraint creator_premium_offer_versions_price_check;

alter table private.creator_premium_offer_versions
  add constraint creator_premium_offer_versions_price_check check (
    price_bdag::text not in ('NaN','Infinity','-Infinity')
    and price_bdag > 0
    and price_bdag = pg_catalog.round(price_bdag, 8)
  );

alter table private.creator_premium_plans
  drop constraint creator_premium_plans_price_check;

alter table private.creator_premium_plans
  add constraint creator_premium_plans_price_check check (
    price_bdag::text not in ('NaN','Infinity','-Infinity')
    and price_bdag > 0
    and price_bdag = pg_catalog.round(price_bdag, 8)
  );

alter table private.creator_premium_offer_versions
  add column client_request_id uuid,
  add column request_fingerprint text,
  add constraint creator_premium_offer_versions_request_check check (
    (client_request_id is null and request_fingerprint is null)
    or
    (client_request_id is not null
      and request_fingerprint ~ '^[0-9a-f]{64}$')
  );

create unique index creator_premium_offer_versions_creator_request_uidx
  on private.creator_premium_offer_versions(creator_id, client_request_id)
  where client_request_id is not null;

alter table private.creator_premium_plans
  add column client_request_id uuid,
  add column request_fingerprint text,
  add constraint creator_premium_plans_request_check check (
    (client_request_id is null and request_fingerprint is null)
    or
    (client_request_id is not null
      and request_fingerprint ~ '^[0-9a-f]{64}$')
  );

create unique index creator_premium_plans_creator_request_uidx
  on private.creator_premium_plans(creator_id, client_request_id)
  where client_request_id is not null;

create or replace function private.guard_creator_premium_offer_financial_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active','retired') and (
    new.content_id is distinct from old.content_id
    or new.creator_id is distinct from old.creator_id
    or new.version is distinct from old.version
    or new.price_bdag is distinct from old.price_bdag
    or new.currency is distinct from old.currency
    or new.activated_at is distinct from old.activated_at
    or new.client_request_id is distinct from old.client_request_id
    or new.request_fingerprint is distinct from old.request_fingerprint
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_offer_financial_identity_immutable';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'draft' and new.status = 'active')
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_offer_lifecycle_invalid';
  end if;
  return new;
end;
$$;

create or replace function private.guard_creator_premium_plan_financial_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active','retired') and (
    new.creator_id is distinct from old.creator_id
    or new.plan_key is distinct from old.plan_key
    or new.version is distinct from old.version
    or new.price_bdag is distinct from old.price_bdag
    or new.currency is distinct from old.currency
    or new.billing_period_days is distinct from old.billing_period_days
    or new.activated_at is distinct from old.activated_at
    or new.client_request_id is distinct from old.client_request_id
    or new.request_fingerprint is distinct from old.request_fingerprint
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_plan_financial_identity_immutable';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'draft' and new.status = 'active')
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_plan_lifecycle_invalid';
  end if;
  return new;
end;
$$;

create function private.creator_premium_teaser_url_v1(p_content_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select asset.public_url
  from public.media_asset_links link
  join public.media_assets asset on asset.id = link.asset_id
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id
    and link.slot = 'teaser'
    and link."position" = 0
    and asset.provider = 'r2'
    and asset.media_kind = 'image'
    and asset.purpose = 'creator_premium_teaser_image'
    and asset.visibility = 'public'
    and asset.status = 'ready'
    and asset.public_url ~* '^https://'
  limit 1;
$$;

create function private.creator_premium_image_is_ready_v1(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.creator_premium_teaser_url_v1(p_content_id) is not null
    and exists (
      select 1
      from public.media_asset_links link
      join public.media_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'original'
        and link."position" = 0
        and asset.provider = 'r2'
        and asset.media_kind = 'image'
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
    );
$$;

create function private.creator_premium_video_is_ready_v1(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.creator_premium_teaser_url_v1(p_content_id) is not null
    and exists (
      select 1
      from public.video_asset_links link
      join public.video_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'original'
        and link."position" = 0
        and asset.provider = 'cloudflare_stream'
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and nullif(pg_catalog.btrim(asset.cloudflare_uid), '') is not null
        and asset.hls_url is null
        and asset.dash_url is null
        and asset.thumbnail_url is null
        and asset.ready_at is not null
        and asset.duration_seconds > 0
        and asset.duration_seconds <= asset.max_duration_seconds
        and asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
    );
$$;

create function private.creator_premium_submission_blocker_v1(p_content_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_content private.creator_premium_contents;
begin
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id;

  if not found then
    return 'creator_premium_content_not_found';
  end if;

  if v_content.content_kind = 'image'
     and not private.creator_premium_image_is_ready_v1(v_content.id) then
    return 'creator_premium_image_media_not_ready';
  end if;
  if v_content.content_kind = 'video'
     and not private.creator_premium_video_is_ready_v1(v_content.id) then
    return 'creator_premium_video_media_not_ready';
  end if;

  if v_content.access_mode in ('purchase','purchase_or_subscription')
     and not exists (
       select 1
       from private.creator_premium_offer_versions offer
       where offer.content_id = v_content.id
         and offer.creator_id = v_content.creator_id
         and offer.status = 'active'
         and offer.currency = 'BDAG'
         and offer.price_bdag > 0
     ) then
    return 'creator_premium_active_offer_required';
  end if;

  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and not exists (
       select 1
       from private.creator_premium_plan_contents mapping
       join private.creator_premium_plans plan
         on plan.id = mapping.plan_id
        and plan.creator_id = mapping.creator_id
       where mapping.content_id = v_content.id
         and mapping.creator_id = v_content.creator_id
         and plan.status in ('draft','active')
     ) then
    return 'creator_premium_plan_mapping_required';
  end if;

  return null;
end;
$$;

create or replace function public.update_my_creator_premium_draft_v1(
  p_content_id uuid,
  p_title text,
  p_description text,
  p_content_kind text,
  p_access_mode text
) returns table (
  id uuid,
  lifecycle_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null
     or pg_catalog.char_length(v_title) not between 1 and 120
     or pg_catalog.char_length(v_description) > 2000
     or p_content_kind not in ('image','video')
     or p_access_mode not in ('purchase','subscription','purchase_or_subscription') then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_draft';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
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

  if p_content_kind is distinct from v_content.content_kind
     and (
       exists (
         select 1 from public.media_asset_links link
         where link.entity_type = 'creator_premium_content'
           and link.entity_id = v_content.id
       )
       or exists (
         select 1 from public.video_asset_links link
         where link.entity_type = 'creator_premium_content'
           and link.entity_id = v_content.id
       )
     ) then
    raise exception using errcode = '55000', message = 'creator_premium_content_kind_locked_by_media';
  end if;

  if p_access_mode is distinct from v_content.access_mode then
    if p_access_mode = 'subscription'
       and exists (
         select 1
         from private.creator_premium_offer_versions offer
         where offer.content_id = v_content.id
           and offer.creator_id = v_actor
           and offer.status = 'active'
       ) then
      raise exception using errcode = '55000', message = 'creator_premium_access_mode_locked_by_commercial_state';
    end if;
    if p_access_mode = 'purchase'
       and exists (
         select 1
         from private.creator_premium_plan_contents mapping
         where mapping.content_id = v_content.id
           and mapping.creator_id = v_actor
       ) then
      raise exception using errcode = '55000', message = 'creator_premium_access_mode_locked_by_commercial_state';
    end if;
  end if;

  update private.creator_premium_contents content
  set title = v_title,
      description = v_description,
      content_kind = p_content_kind,
      access_mode = p_access_mode,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status,
    v_content.created_at, v_content.updated_at;
end;
$$;

create function private.schedule_creator_premium_video_deletion_v1(
  p_asset_id uuid,
  p_owner_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
begin
  if p_asset_id is null or p_owner_id is null then
    return 'not_found';
  end if;

  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_asset.owner_id <> p_owner_id
     or v_asset.purpose <> 'creator_premium_video' then
    raise exception using errcode = '42501', message = 'creator_premium_video_cleanup_scope_invalid';
  end if;
  if v_asset.status = 'deleted' then
    return 'deleted';
  end if;
  if exists (
    select 1
    from public.video_asset_links link
    where link.asset_id = v_asset.id
  ) then
    return 'asset_in_use';
  end if;

  update public.video_assets asset
  set status = 'delete_pending',
      hls_url = null,
      dash_url = null,
      thumbnail_url = null,
      error_code = null,
      error_message = null,
      next_cleanup_attempt_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id;

  return 'scheduled';
end;
$$;

drop function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid);

create function public.set_my_creator_premium_video_media_v1(
  p_content_id uuid,
  p_teaser_asset_id uuid,
  p_video_asset_id uuid
) returns table (
  content_id uuid,
  teaser_url text,
  teaser_attached boolean,
  video_attached boolean,
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
  v_video public.video_assets;
  v_old_teaser uuid;
  v_old_video uuid;
  v_cleanup_result text;
  v_cleanup_scheduled boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null
     or p_teaser_asset_id is null
     or p_video_asset_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_video_media_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-video-media:' || p_content_id::text, 0)
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
  if v_content.content_kind <> 'video' then
    raise exception using errcode = '22023', message = 'creator_premium_video_content_required';
  end if;

  perform asset.id
  from public.media_assets asset
  where asset.id = p_teaser_asset_id
  for update;

  perform asset.id
  from public.video_assets asset
  where asset.id = p_video_asset_id
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

  select asset.* into v_video
  from public.video_assets asset
  where asset.id = p_video_asset_id;

  if not found
     or v_video.owner_id <> v_actor
     or v_video.provider <> 'cloudflare_stream'
     or v_video.purpose <> 'creator_premium_video'
     or v_video.visibility <> 'private'
     or v_video.status <> 'ready'
     or nullif(pg_catalog.btrim(v_video.cloudflare_uid), '') is null
     or v_video.hls_url is not null
     or v_video.dash_url is not null
     or v_video.thumbnail_url is not null
     or v_video.ready_at is null
     or v_video.duration_seconds is null
     or v_video.duration_seconds <= 0
     or v_video.duration_seconds > v_video.max_duration_seconds
     or v_video.provider_metadata -> 'require_signed_urls' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'creator_premium_video_invalid';
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
    select 1 from public.video_asset_links link
    where link.asset_id = p_video_asset_id
      and not (
        link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'original'
        and link."position" = 0
      )
  ) then
    raise exception using errcode = '23505', message = 'creator_premium_video_asset_in_use';
  end if;

  select link.asset_id into v_old_teaser
  from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id
    and link.slot = 'teaser'
    and link."position" = 0;

  select link.asset_id into v_old_video
  from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id
    and link.slot = 'original'
    and link."position" = 0;

  if v_old_teaser = p_teaser_asset_id
     and v_old_video = p_video_asset_id then
    return query
      select p_content_id, v_teaser.public_url, true, true, true, true, false;
    return;
  end if;

  delete from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id;

  delete from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id;

  insert into public.media_asset_links(
    asset_id, entity_type, entity_id, slot, "position", is_cover
  ) values (
    p_teaser_asset_id, 'creator_premium_content', p_content_id, 'teaser', 0, false
  );

  insert into public.video_asset_links(
    asset_id, owner_id, entity_type, entity_id, slot, "position"
  ) values (
    p_video_asset_id, v_actor, 'creator_premium_content', p_content_id, 'original', 0
  );

  if v_old_teaser is not null and v_old_teaser <> p_teaser_asset_id then
    v_cleanup_result := public.schedule_media_asset_deletion(v_old_teaser, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_replacement_cleanup_failed';
    end if;
    v_cleanup_scheduled := v_cleanup_scheduled or v_cleanup_result = 'scheduled';
  end if;

  if v_old_video is not null and v_old_video <> p_video_asset_id then
    v_cleanup_result := private.schedule_creator_premium_video_deletion_v1(v_old_video, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_replacement_cleanup_failed';
    end if;
    v_cleanup_scheduled := v_cleanup_scheduled or v_cleanup_result = 'scheduled';
  end if;

  return query
    select p_content_id, v_teaser.public_url, true, true, true, false, v_cleanup_scheduled;
end;
$$;

create function public.cleanup_stale_creator_premium_video_records(p_limit integer default 50)
returns table (
  id uuid,
  cloudflare_uid text,
  delete_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  with abandoned as (
    select asset.id
    from public.video_assets asset
    where asset.purpose = 'creator_premium_video'
      and asset.status in ('pending','uploading','processing','ready','failed')
      and asset.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
      and not exists (
        select 1
        from public.video_asset_links link
        where link.asset_id = asset.id
      )
    order by asset.created_at, asset.id
    for update of asset skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.video_assets asset
  set status = 'delete_pending',
      hls_url = null,
      dash_url = null,
      thumbnail_url = null,
      error_code = 'creator_premium_video_abandoned',
      error_message = null,
      next_cleanup_attempt_at = coalesce(
        asset.next_cleanup_attempt_at,
        pg_catalog.clock_timestamp()
      ),
      updated_at = pg_catalog.clock_timestamp()
  from abandoned
  where asset.id = abandoned.id;

  return query
  with claimed as (
    select asset.id
    from public.video_assets asset
    where asset.purpose = 'creator_premium_video'
      and asset.status = 'delete_pending'
      and coalesce(asset.next_cleanup_attempt_at, pg_catalog.clock_timestamp())
          <= pg_catalog.clock_timestamp()
      and not exists (
        select 1
        from public.video_asset_links link
        where link.asset_id = asset.id
      )
    order by coalesce(asset.next_cleanup_attempt_at, asset.created_at), asset.created_at, asset.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.video_assets asset
  set delete_attempts = asset.delete_attempts + 1,
      next_cleanup_attempt_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(
        secs => least(21600, 30 * pg_catalog.power(2, least(asset.delete_attempts, 9))::integer)
      ),
      updated_at = pg_catalog.clock_timestamp()
  from claimed
  where asset.id = claimed.id
  returning asset.id, asset.cloudflare_uid, asset.delete_attempts;
end;
$$;

create function public.set_my_creator_premium_offer_v1(
  p_content_id uuid,
  p_price_bdag numeric,
  p_client_request_id uuid
) returns table (
  content_id uuid,
  version integer,
  price_bdag text,
  currency text,
  status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_command public.idempotency_keys;
  v_active private.creator_premium_offer_versions;
  v_inserted private.creator_premium_offer_versions;
  v_fingerprint text;
  v_next_version integer;
  v_response jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null
     or p_client_request_id is null
     or p_price_bdag is null
     or p_price_bdag::text in ('NaN','Infinity','-Infinity')
     or p_price_bdag <= 0
     or p_price_bdag <> pg_catalog.round(p_price_bdag, 8) then
    raise exception using errcode = '22023', message = 'creator_premium_offer_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', 'creator_premium_offer', v_actor::text,
      p_content_id::text, p_price_bdag::numeric(20,8)::text),
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-offer-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );

  select command.* into v_command
  from public.idempotency_keys command
  where command.idempotency_key = p_client_request_id::text
    and command.operation_type = 'creator_premium_offer_set'
    and command.user_id = v_actor
  for update;

  if found then
    if v_command.request_hash is distinct from v_fingerprint
       or v_command.status <> 'completed'
       or v_command.response_body is null then
      raise exception using errcode = '23505', message = 'creator_premium_offer_idempotency_conflict';
    end if;
    return query select
      (v_command.response_body ->> 'content_id')::uuid,
      (v_command.response_body ->> 'version')::integer,
      v_command.response_body ->> 'price_bdag',
      v_command.response_body ->> 'currency',
      v_command.response_body ->> 'status',
      true;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-offer:' || p_content_id::text, 0)
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
  if v_content.access_mode not in ('purchase','purchase_or_subscription') then
    raise exception using errcode = '22023', message = 'creator_premium_purchase_access_required';
  end if;

  select offer.* into v_active
  from private.creator_premium_offer_versions offer
  where offer.content_id = v_content.id
    and offer.creator_id = v_actor
    and offer.status = 'active'
  for update;

  if found and v_active.price_bdag = p_price_bdag then
    v_response := pg_catalog.jsonb_build_object(
      'content_id', v_active.content_id,
      'version', v_active.version,
      'price_bdag', v_active.price_bdag,
      'currency', v_active.currency,
      'status', v_active.status
    );
    insert into public.idempotency_keys(
      idempotency_key, operation_type, user_id, request_hash, status, response_body
    ) values (
      p_client_request_id::text, 'creator_premium_offer_set', v_actor,
      v_fingerprint, 'completed', v_response
    );
    return query select v_active.content_id, v_active.version,
      v_active.price_bdag::text, v_active.currency, v_active.status, true;
    return;
  end if;

  select coalesce(max(offer.version), 0) + 1 into v_next_version
  from private.creator_premium_offer_versions offer
  where offer.content_id = v_content.id;

  if v_active.id is not null then
    update private.creator_premium_offer_versions offer
    set status = 'retired',
        retired_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where offer.id = v_active.id;
  end if;

  insert into private.creator_premium_offer_versions(
    content_id, creator_id, version, price_bdag, currency, status,
    activated_at, client_request_id, request_fingerprint
  ) values (
    v_content.id, v_actor, v_next_version, p_price_bdag, 'BDAG', 'active',
    pg_catalog.clock_timestamp(), p_client_request_id, v_fingerprint
  ) returning * into v_inserted;

  v_response := pg_catalog.jsonb_build_object(
    'content_id', v_inserted.content_id,
    'version', v_inserted.version,
    'price_bdag', v_inserted.price_bdag,
    'currency', v_inserted.currency,
    'status', v_inserted.status
  );
  insert into public.idempotency_keys(
    idempotency_key, operation_type, user_id, request_hash, status, response_body
  ) values (
    p_client_request_id::text, 'creator_premium_offer_set', v_actor,
    v_fingerprint, 'completed', v_response
  );

  return query select v_inserted.content_id, v_inserted.version,
    v_inserted.price_bdag::text, v_inserted.currency, v_inserted.status, false;
end;
$$;

create function public.create_my_creator_premium_plan_draft_v1(
  p_name text,
  p_description text,
  p_price_bdag numeric,
  p_billing_period_days integer,
  p_client_request_id uuid
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_fingerprint text;
  v_existing private.creator_premium_plans;
  v_inserted private.creator_premium_plans;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_client_request_id is null
     or pg_catalog.char_length(v_name) not between 1 and 80
     or pg_catalog.char_length(v_description) > 1000
     or p_price_bdag is null
     or p_price_bdag::text in ('NaN','Infinity','-Infinity')
     or p_price_bdag <= 0
     or p_price_bdag <> pg_catalog.round(p_price_bdag, 8)
     or p_billing_period_days is null
     or p_billing_period_days not between 1 and 365 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'operation', 'creator_premium_plan_create',
      'actor_id', v_actor::text,
      'name', v_name,
      'description', v_description,
      'price_bdag', p_price_bdag::numeric(20,8)::text,
      'billing_period_days', p_billing_period_days
    )::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );

  select plan.* into v_existing
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.client_request_id = p_client_request_id;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint
       or v_existing.name is distinct from v_name
       or v_existing.description is distinct from v_description
       or v_existing.price_bdag is distinct from p_price_bdag
       or v_existing.billing_period_days is distinct from p_billing_period_days then
      raise exception using errcode = '23505', message = 'creator_premium_plan_idempotency_conflict';
    end if;
    return query select v_existing.id, v_existing.name, v_existing.description,
      v_existing.price_bdag::text, v_existing.billing_period_days, v_existing.version,
      v_existing.status, v_existing.created_at, true;
    return;
  end if;

  insert into private.creator_premium_plans(
    creator_id, plan_key, version, name, description, price_bdag, currency,
    billing_period_days, status, client_request_id, request_fingerprint
  ) values (
    v_actor,
    'plan_' || pg_catalog.replace(gen_random_uuid()::text, '-', ''),
    1, v_name, v_description, p_price_bdag, 'BDAG',
    p_billing_period_days, 'draft', p_client_request_id, v_fingerprint
  ) returning * into v_inserted;

  return query select v_inserted.id, v_inserted.name, v_inserted.description,
    v_inserted.price_bdag::text, v_inserted.billing_period_days, v_inserted.version,
    v_inserted.status, v_inserted.created_at, false;
end;
$$;

create function public.update_my_creator_premium_plan_draft_v1(
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_price_bdag numeric,
  p_billing_period_days integer
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_plan private.creator_premium_plans;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null
     or pg_catalog.char_length(v_name) not between 1 and 80
     or pg_catalog.char_length(v_description) > 1000
     or p_price_bdag is null
     or p_price_bdag::text in ('NaN','Infinity','-Infinity')
     or p_price_bdag <= 0
     or p_price_bdag <> pg_catalog.round(p_price_bdag, 8)
     or p_billing_period_days is null
     or p_billing_period_days not between 1 and 365 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_draft_only';
  end if;

  update private.creator_premium_plans plan
  set name = v_name,
      description = v_description,
      price_bdag = p_price_bdag,
      billing_period_days = p_billing_period_days,
      updated_at = pg_catalog.clock_timestamp()
  where plan.id = v_plan.id
  returning plan.* into v_plan;

  return query select v_plan.id, v_plan.name, v_plan.description,
    v_plan.price_bdag::text, v_plan.billing_period_days, v_plan.version,
    v_plan.status, v_plan.updated_at;
end;
$$;

create function public.set_my_creator_premium_plan_contents_v1(
  p_plan_id uuid,
  p_content_ids uuid[]
) returns table (
  id uuid,
  mapped_content_count bigint,
  mapped_content_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan private.creator_premium_plans;
  v_content_ids uuid[];
  v_count bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null or coalesce(pg_catalog.cardinality(p_content_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_contents_invalid';
  end if;

  select coalesce(pg_catalog.array_agg(distinct item order by item), '{}'::uuid[])
  into v_content_ids
  from pg_catalog.unnest(coalesce(p_content_ids, '{}'::uuid[])) item;

  if exists (select 1 from pg_catalog.unnest(v_content_ids) item where item is null) then
    raise exception using errcode = '22023', message = 'creator_premium_plan_contents_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_draft_only';
  end if;

  perform content.id
  from private.creator_premium_contents content
  where content.id = any(v_content_ids)
     or exists (
       select 1
       from private.creator_premium_plan_contents mapping
       where mapping.plan_id = v_plan.id
         and mapping.content_id = content.id
     )
  order by content.id
  for update;

  select count(*) into v_count
  from private.creator_premium_contents content
  where content.id = any(v_content_ids)
    and content.creator_id = v_actor;
  if v_count <> pg_catalog.cardinality(v_content_ids) then
    raise exception using errcode = '42501', message = 'creator_premium_plan_content_not_found';
  end if;

  if exists (
    select 1
    from private.creator_premium_contents content
    where content.id = any(v_content_ids)
      and content.creator_id = v_actor
      and content.lifecycle_status in ('quarantined','removed','deleted')
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_content_unavailable';
  end if;

  if exists (
    select 1
    from private.creator_premium_contents content
    where content.id = any(v_content_ids)
      and content.creator_id = v_actor
      and content.access_mode not in ('subscription','purchase_or_subscription')
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_plan_content_subscription_required';
  end if;

  if exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_contents content
      on content.id = mapping.content_id
     and content.creator_id = mapping.creator_id
    where mapping.plan_id = v_plan.id
      and not (content.id = any(v_content_ids))
      and content.lifecycle_status = 'pending_review'
      and content.access_mode in ('subscription','purchase_or_subscription')
      and not exists (
        select 1
        from private.creator_premium_plan_contents other_mapping
        join private.creator_premium_plans other_plan
          on other_plan.id = other_mapping.plan_id
         and other_plan.creator_id = other_mapping.creator_id
        where other_mapping.content_id = content.id
          and other_mapping.creator_id = v_actor
          and other_mapping.plan_id <> v_plan.id
          and other_plan.status in ('draft','active')
      )
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_content_review_locked';
  end if;

  delete from private.creator_premium_plan_contents mapping
  where mapping.plan_id = v_plan.id
    and mapping.creator_id = v_actor;

  insert into private.creator_premium_plan_contents(plan_id, content_id, creator_id)
  select v_plan.id, item, v_actor
  from pg_catalog.unnest(v_content_ids) item;

  return query select v_plan.id, pg_catalog.cardinality(v_content_ids)::bigint, v_content_ids;
end;
$$;

create function public.clone_my_creator_premium_plan_version_v1(
  p_plan_id uuid,
  p_client_request_id uuid
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  mapped_content_count bigint,
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source private.creator_premium_plans;
  v_existing private.creator_premium_plans;
  v_inserted private.creator_premium_plans;
  v_plan_key text;
  v_fingerprint text;
  v_next_version integer;
  v_mapped_count bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_clone_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', 'creator_premium_plan_clone', v_actor::text, p_plan_id::text),
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );

  select plan.* into v_existing
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.client_request_id = p_client_request_id;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_plan_idempotency_conflict';
    end if;
    select count(*) into v_mapped_count
    from private.creator_premium_plan_contents mapping
    where mapping.plan_id = v_existing.id;
    return query select v_existing.id, v_existing.name, v_existing.description,
      v_existing.price_bdag::text, v_existing.billing_period_days, v_existing.version,
      v_existing.status, v_mapped_count, v_existing.created_at, true;
    return;
  end if;

  select plan.plan_key into v_plan_key
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-version:' || v_actor::text || ':' || v_plan_key,
      0
    )
  );

  select plan.* into v_source
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_source.status not in ('active','retired') then
    raise exception using errcode = '55000', message = 'creator_premium_plan_clone_source_invalid';
  end if;

  perform plan.id
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.plan_key = v_source.plan_key
  order by plan.id
  for update;

  select coalesce(max(plan.version), 0) + 1 into v_next_version
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.plan_key = v_source.plan_key;

  insert into private.creator_premium_plans(
    creator_id, plan_key, version, name, description, price_bdag, currency,
    billing_period_days, status, client_request_id, request_fingerprint
  ) values (
    v_actor, v_source.plan_key, v_next_version, v_source.name, v_source.description,
    v_source.price_bdag, v_source.currency, v_source.billing_period_days, 'draft',
    p_client_request_id, v_fingerprint
  ) returning * into v_inserted;

  insert into private.creator_premium_plan_contents(plan_id, content_id, creator_id)
  select v_inserted.id, mapping.content_id, v_actor
  from private.creator_premium_plan_contents mapping
  where mapping.plan_id = v_source.id
    and mapping.creator_id = v_actor;

  get diagnostics v_mapped_count = row_count;

  return query select v_inserted.id, v_inserted.name, v_inserted.description,
    v_inserted.price_bdag::text, v_inserted.billing_period_days, v_inserted.version,
    v_inserted.status, v_mapped_count, v_inserted.created_at, false;
end;
$$;

create function public.activate_my_creator_premium_plan_v1(p_plan_id uuid)
returns table (
  id uuid,
  version integer,
  status text,
  activated_at timestamptz,
  mapped_content_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan private.creator_premium_plans;
  v_plan_key text;
  v_count bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_invalid';
  end if;

  select plan.plan_key into v_plan_key
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-version:' || v_actor::text || ':' || v_plan_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_draft_only';
  end if;

  perform family_plan.id
  from private.creator_premium_plans family_plan
  where family_plan.creator_id = v_actor
    and family_plan.plan_key = v_plan.plan_key
  order by family_plan.id
  for update;

  perform content.id
  from private.creator_premium_contents content
  where content.creator_id = v_actor
    and content.id in (
      select mapping.content_id
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans affected_plan
        on affected_plan.id = mapping.plan_id
       and affected_plan.creator_id = mapping.creator_id
      where affected_plan.creator_id = v_actor
        and (
          affected_plan.id = v_plan.id
          or (
            affected_plan.plan_key = v_plan.plan_key
            and affected_plan.status = 'active'
          )
        )
    )
  order by content.id
  for update;

  select count(*) into v_count
  from private.creator_premium_plan_contents mapping
  where mapping.plan_id = v_plan.id
    and mapping.creator_id = v_actor;

  if v_count = 0 then
    raise exception using errcode = '55000', message = 'creator_premium_plan_contents_required';
  end if;

  if exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_contents content
      on content.id = mapping.content_id
     and content.creator_id = mapping.creator_id
    where mapping.plan_id = v_plan.id
      and (
        content.lifecycle_status not in ('pending_review','published')
        or content.access_mode not in ('subscription','purchase_or_subscription')
      )
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_content_review_required';
  end if;

  if exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans retiring_plan
      on retiring_plan.id = mapping.plan_id
     and retiring_plan.creator_id = mapping.creator_id
    join private.creator_premium_contents content
      on content.id = mapping.content_id
     and content.creator_id = mapping.creator_id
    where retiring_plan.creator_id = v_actor
      and retiring_plan.plan_key = v_plan.plan_key
      and retiring_plan.status = 'active'
      and retiring_plan.id <> v_plan.id
      and content.lifecycle_status = 'pending_review'
      and content.access_mode in ('subscription','purchase_or_subscription')
      and not exists (
        select 1
        from private.creator_premium_plan_contents other_mapping
        join private.creator_premium_plans other_plan
          on other_plan.id = other_mapping.plan_id
         and other_plan.creator_id = other_mapping.creator_id
        where other_mapping.content_id = content.id
          and other_mapping.creator_id = v_actor
          and other_plan.status in ('draft','active')
          and not (
            other_plan.plan_key = v_plan.plan_key
            and other_plan.status = 'active'
            and other_plan.id <> v_plan.id
          )
      )
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_content_review_locked';
  end if;

  update private.creator_premium_plans plan
  set status = 'retired',
      retired_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where plan.creator_id = v_actor
    and plan.plan_key = v_plan.plan_key
    and plan.status = 'active'
    and plan.id <> v_plan.id;

  update private.creator_premium_plans plan
  set status = 'active',
      activated_at = pg_catalog.clock_timestamp(),
      retired_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where plan.id = v_plan.id
  returning plan.* into v_plan;

  return query select v_plan.id, v_plan.version, v_plan.status,
    v_plan.activated_at, v_count;
end;
$$;

create function public.retire_my_creator_premium_plan_v1(p_plan_id uuid)
returns table (
  id uuid,
  version integer,
  status text,
  retired_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan private.creator_premium_plans;
  v_plan_key text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_invalid';
  end if;

  select plan.plan_key into v_plan_key
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-version:' || v_actor::text || ':' || v_plan_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'active' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_active_only';
  end if;

  perform content.id
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_contents content
    on content.id = mapping.content_id
   and content.creator_id = mapping.creator_id
  where mapping.plan_id = v_plan.id
  order by content.id
  for update of content;

  if exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_contents content
      on content.id = mapping.content_id
     and content.creator_id = mapping.creator_id
    where mapping.plan_id = v_plan.id
      and content.lifecycle_status = 'pending_review'
      and content.access_mode in ('subscription','purchase_or_subscription')
      and not exists (
        select 1
        from private.creator_premium_plan_contents other_mapping
        join private.creator_premium_plans other_plan
          on other_plan.id = other_mapping.plan_id
         and other_plan.creator_id = other_mapping.creator_id
        where other_mapping.content_id = content.id
          and other_mapping.creator_id = v_actor
          and other_plan.status in ('draft','active')
          and other_plan.id <> v_plan.id
      )
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_content_review_locked';
  end if;

  update private.creator_premium_plans plan
  set status = 'retired',
      retired_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where plan.id = v_plan.id
  returning plan.* into v_plan;

  return query select v_plan.id, v_plan.version, v_plan.status, v_plan.retired_at;
end;
$$;

create function public.submit_my_creator_premium_content_for_review_v1(p_content_id uuid)
returns table (
  content_id uuid,
  lifecycle_status text,
  submission_ready boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_blocker text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
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

  v_blocker := private.creator_premium_submission_blocker_v1(v_content.id);
  if v_blocker is not null then
    raise exception using errcode = '55000', message = v_blocker;
  end if;

  update private.creator_premium_contents content
  set lifecycle_status = 'pending_review',
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status, true;
end;
$$;

create function public.delete_my_creator_premium_draft_v1(p_content_id uuid)
returns table (
  content_id uuid,
  lifecycle_status text,
  r2_assets_scheduled integer,
  video_assets_scheduled integer,
  cleanup_scheduled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_media_ids uuid[] := '{}'::uuid[];
  v_video_ids uuid[] := '{}'::uuid[];
  v_asset_id uuid;
  v_cleanup_result text;
  v_r2_count integer := 0;
  v_video_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
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

  if exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans plan
      on plan.id = mapping.plan_id
     and plan.creator_id = mapping.creator_id
    where mapping.content_id = v_content.id
      and mapping.creator_id = v_actor
      and plan.status <> 'draft'
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_draft_in_immutable_plan';
  end if;

  if exists (
    select 1
    from private.creator_premium_purchase_receipts receipt
    where receipt.content_id = v_content.id
  ) or exists (
    select 1
    from private.creator_premium_subscription_periods period
    join private.creator_premium_plan_contents mapping
      on mapping.plan_id = period.plan_id
     and mapping.creator_id = period.creator_id
    where mapping.content_id = v_content.id
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_draft_has_financial_history';
  end if;

  select coalesce(pg_catalog.array_agg(link.asset_id order by link.asset_id), '{}'::uuid[])
  into v_media_ids
  from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  select coalesce(pg_catalog.array_agg(link.asset_id order by link.asset_id), '{}'::uuid[])
  into v_video_ids
  from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  delete from private.creator_premium_plan_contents mapping
  using private.creator_premium_plans plan
  where mapping.plan_id = plan.id
    and mapping.content_id = v_content.id
    and mapping.creator_id = v_actor
    and plan.creator_id = v_actor
    and plan.status = 'draft';

  delete from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  delete from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  foreach v_asset_id in array v_media_ids loop
    v_cleanup_result := public.schedule_media_asset_deletion(v_asset_id, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_draft_cleanup_failed';
    end if;
    if v_cleanup_result = 'scheduled' then
      v_r2_count := v_r2_count + 1;
    end if;
  end loop;

  foreach v_asset_id in array v_video_ids loop
    v_cleanup_result := private.schedule_creator_premium_video_deletion_v1(v_asset_id, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_draft_cleanup_failed';
    end if;
    if v_cleanup_result = 'scheduled' then
      v_video_count := v_video_count + 1;
    end if;
  end loop;

  update private.creator_premium_offer_versions offer
  set status = 'retired',
      retired_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where offer.content_id = v_content.id
    and offer.creator_id = v_actor
    and offer.status = 'active';

  update private.creator_premium_contents content
  set lifecycle_status = 'deleted',
      deleted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status,
    v_r2_count, v_video_count, (v_r2_count + v_video_count) > 0;
end;
$$;

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
  image_media_ready boolean,
  video_attached boolean,
  video_media_ready boolean,
  active_offer_version integer,
  price_bdag text,
  mapped_plan_count bigint,
  active_plan_count bigint,
  submission_ready boolean,
  submission_blocker text
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
  select
    content.id,
    content.title,
    content.description,
    content.content_kind,
    content.access_mode,
    content.lifecycle_status,
    content.published_at,
    content.quarantined_at,
    content.removed_at,
    content.deleted_at,
    content.removal_reason,
    content.created_at,
    content.updated_at,
    private.creator_premium_teaser_url_v1(content.id),
    private.creator_premium_teaser_url_v1(content.id) is not null,
    media.original_attached,
    content.content_kind = 'image'
      and private.creator_premium_image_is_ready_v1(content.id),
    video.video_attached,
    content.content_kind = 'video'
      and private.creator_premium_video_is_ready_v1(content.id),
    offer.version,
    offer.price_bdag::text,
    plans.mapped_plan_count,
    plans.active_plan_count,
    content.lifecycle_status = 'draft' and blocker.value is null,
    case when content.lifecycle_status = 'draft' then blocker.value else 'creator_premium_draft_only' end
  from private.creator_premium_contents content
  left join lateral (
    select exists (
      select 1
      from public.media_asset_links link
      join public.media_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
    ) as original_attached
  ) media on true
  left join lateral (
    select exists (
      select 1
      from public.video_asset_links link
      join public.video_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
    ) as video_attached
  ) video on true
  left join lateral (
    select active_offer.version, active_offer.price_bdag
    from private.creator_premium_offer_versions active_offer
    where active_offer.content_id = content.id
      and active_offer.creator_id = content.creator_id
      and active_offer.status = 'active'
    limit 1
  ) offer on true
  left join lateral (
    select
      count(*)::bigint as mapped_plan_count,
      count(*) filter (where plan.status = 'active')::bigint as active_plan_count
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans plan
      on plan.id = mapping.plan_id
     and plan.creator_id = mapping.creator_id
    where mapping.content_id = content.id
      and mapping.creator_id = content.creator_id
  ) plans on true
  left join lateral (
    select private.creator_premium_submission_blocker_v1(content.id) as value
  ) blocker on true
  where content.creator_id = v_actor
    and (
      p_cursor_created_at is null
      or (content.created_at, content.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by content.created_at desc, content.id desc
  limit p_limit;
end;
$$;

create function public.get_my_creator_premium_content_v1(p_content_id uuid)
returns table (
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
  image_media_ready boolean,
  video_attached boolean,
  video_media_ready boolean,
  active_offer_version integer,
  price_bdag text,
  mapped_plan_count bigint,
  active_plan_count bigint,
  submission_ready boolean,
  submission_blocker text
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
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_content_invalid';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  select
    content.id,
    content.title,
    content.description,
    content.content_kind,
    content.access_mode,
    content.lifecycle_status,
    content.published_at,
    content.quarantined_at,
    content.removed_at,
    content.deleted_at,
    content.removal_reason,
    content.created_at,
    content.updated_at,
    private.creator_premium_teaser_url_v1(content.id),
    private.creator_premium_teaser_url_v1(content.id) is not null,
    media.original_attached,
    content.content_kind = 'image'
      and private.creator_premium_image_is_ready_v1(content.id),
    video.video_attached,
    content.content_kind = 'video'
      and private.creator_premium_video_is_ready_v1(content.id),
    offer.version,
    offer.price_bdag::text,
    plans.mapped_plan_count,
    plans.active_plan_count,
    content.lifecycle_status = 'draft' and blocker.value is null,
    case when content.lifecycle_status = 'draft' then blocker.value else 'creator_premium_draft_only' end
  from private.creator_premium_contents content
  left join lateral (
    select exists (
      select 1
      from public.media_asset_links link
      join public.media_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
    ) as original_attached
  ) media on true
  left join lateral (
    select exists (
      select 1
      from public.video_asset_links link
      join public.video_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
    ) as video_attached
  ) video on true
  left join lateral (
    select active_offer.version, active_offer.price_bdag
    from private.creator_premium_offer_versions active_offer
    where active_offer.content_id = content.id
      and active_offer.creator_id = content.creator_id
      and active_offer.status = 'active'
    limit 1
  ) offer on true
  left join lateral (
    select
      count(*)::bigint as mapped_plan_count,
      count(*) filter (where plan.status = 'active')::bigint as active_plan_count
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans plan
      on plan.id = mapping.plan_id
     and plan.creator_id = mapping.creator_id
    where mapping.content_id = content.id
      and mapping.creator_id = content.creator_id
  ) plans on true
  left join lateral (
    select private.creator_premium_submission_blocker_v1(content.id) as value
  ) blocker on true
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
end;
$$;

create function public.get_my_creator_premium_plans_v1(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  mapped_content_count bigint,
  mapped_content_ids uuid[]
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
  select plan.id, plan.name, plan.description, plan.price_bdag::text,
    plan.billing_period_days, plan.version, plan.status, plan.created_at,
    plan.updated_at, plan.activated_at, plan.retired_at,
    mapped.count, mapped.ids
  from private.creator_premium_plans plan
  left join lateral (
    select count(*)::bigint as count,
      coalesce(pg_catalog.array_agg(mapping.content_id order by mapping.content_id), '{}'::uuid[]) as ids
    from private.creator_premium_plan_contents mapping
    where mapping.plan_id = plan.id
      and mapping.creator_id = plan.creator_id
  ) mapped on true
  where plan.creator_id = v_actor
    and (
      p_cursor_created_at is null
      or (plan.created_at, plan.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by plan.created_at desc, plan.id desc
  limit p_limit;
end;
$$;

revoke all on function private.guard_creator_premium_offer_financial_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_creator_premium_plan_financial_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_teaser_url_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_image_is_ready_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_video_is_ready_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_submission_blocker_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.schedule_creator_premium_video_deletion_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.update_my_creator_premium_draft_v1(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_my_creator_premium_draft_v1(uuid,text,text,text,text)
  to authenticated;

revoke all on function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)
  to authenticated;

revoke all on function public.set_my_creator_premium_offer_v1(uuid,numeric,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_creator_premium_offer_v1(uuid,numeric,uuid)
  to authenticated;

revoke all on function public.create_my_creator_premium_plan_draft_v1(text,text,numeric,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_my_creator_premium_plan_draft_v1(text,text,numeric,integer,uuid)
  to authenticated;

revoke all on function public.update_my_creator_premium_plan_draft_v1(uuid,text,text,numeric,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.update_my_creator_premium_plan_draft_v1(uuid,text,text,numeric,integer)
  to authenticated;

revoke all on function public.set_my_creator_premium_plan_contents_v1(uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_creator_premium_plan_contents_v1(uuid,uuid[])
  to authenticated;

revoke all on function public.clone_my_creator_premium_plan_version_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clone_my_creator_premium_plan_version_v1(uuid,uuid)
  to authenticated;

revoke all on function public.activate_my_creator_premium_plan_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_my_creator_premium_plan_v1(uuid)
  to authenticated;

revoke all on function public.retire_my_creator_premium_plan_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retire_my_creator_premium_plan_v1(uuid)
  to authenticated;

revoke all on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  to authenticated;

revoke all on function public.delete_my_creator_premium_draft_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_my_creator_premium_draft_v1(uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_content_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_content_v1(uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_plans_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_plans_v1(integer,timestamptz,uuid)
  to authenticated;

revoke all on function public.cleanup_stale_creator_premium_video_records(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_stale_creator_premium_video_records(integer)
  to service_role;

comment on function public.submit_my_creator_premium_content_for_review_v1(uuid) is
  'Creator-only draft to pending_review transition. This function cannot publish content.';
comment on function public.cleanup_stale_creator_premium_video_records(integer) is
  'Claims only unlinked creator_premium_video assets for the existing media cleanup Edge.';

notify pgrst, 'reload schema';

commit;
