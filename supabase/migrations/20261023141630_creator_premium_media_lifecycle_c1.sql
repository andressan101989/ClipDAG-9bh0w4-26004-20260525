begin;

-- C1 applies only to rows explicitly enrolled by a new upload reservation or an
-- explicit owner deletion request. Existing rows remain NULL and are never
-- swept into the new provider-verification loop by this migration.
alter table public.media_assets
  add column upload_authorization_expires_at timestamptz,
  add column lifecycle_contract_version smallint,
  add column provider_absence_verified_at timestamptz,
  add column provider_absence_recheck_after timestamptz,
  add column post_delete_verification_attempts integer not null default 0;

alter table public.media_assets
  add constraint media_assets_lifecycle_contract_version_check
    check (lifecycle_contract_version is null or lifecycle_contract_version = 1),
  add constraint media_assets_provider_absence_contract_check
    check (
      (provider_absence_verified_at is null and provider_absence_recheck_after is null)
      or lifecycle_contract_version = 1
    ),
  add constraint media_assets_post_delete_verification_attempts_check
    check (post_delete_verification_attempts between 0 and 3);

alter table public.video_assets
  add column lifecycle_contract_version smallint,
  add column provider_absence_verified_at timestamptz,
  add column provider_absence_recheck_after timestamptz,
  add column post_delete_verification_attempts integer not null default 0;

alter table public.video_assets
  add constraint video_assets_lifecycle_contract_version_check
    check (lifecycle_contract_version is null or lifecycle_contract_version = 1),
  add constraint video_assets_provider_absence_contract_check
    check (
      (provider_absence_verified_at is null and provider_absence_recheck_after is null)
      or lifecycle_contract_version = 1
    ),
  add constraint video_assets_post_delete_verification_attempts_check
    check (post_delete_verification_attempts between 0 and 3);

create index media_assets_c1_cleanup_due_idx
  on public.media_assets (
    status,
    next_cleanup_attempt_at,
    provider_absence_recheck_after,
    created_at,
    id
  )
  where lifecycle_contract_version = 1
    and provider = 'r2'
    and status in ('delete_pending','deleted');

create index video_assets_c1_cleanup_due_idx
  on public.video_assets (
    status,
    next_cleanup_attempt_at,
    provider_absence_recheck_after,
    created_at,
    id
  )
  where lifecycle_contract_version = 1
    and provider = 'cloudflare_stream'
    and status in ('delete_pending','deleted');

-- Keep the canonical reservation RPC and enroll only newly inserted rows.
create or replace function public.reserve_stream_upload_asset(
  p_asset_id uuid,
  p_owner_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_original_filename text,
  p_purpose text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
  v_active_count integer;
begin
  if p_asset_id is null
     or p_owner_id is null
     or p_purpose not in ('feed_video','business_library','creator_premium_video') then
    raise exception using errcode = '22023', message = 'invalid_stream_reservation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 0)
  );

  select count(*) into v_recent_count
  from public.video_assets asset
  where asset.owner_id = p_owner_id
    and asset.created_at >= pg_catalog.now() - interval '60 seconds';
  if v_recent_count >= 5 then
    return 'rate_limited';
  end if;

  select count(*) into v_active_count
  from public.video_assets asset
  where asset.owner_id = p_owner_id
    and asset.status in ('pending','uploading','processing');
  if v_active_count >= 3 then
    return 'active_limit_reached';
  end if;

  insert into public.video_assets(
    id, owner_id, provider, purpose, visibility, status, mime_type,
    size_bytes, original_filename, max_duration_seconds,
    upload_expires_at, lifecycle_contract_version
  ) values (
    p_asset_id,
    p_owner_id,
    'cloudflare_stream',
    p_purpose,
    case when p_purpose = 'creator_premium_video' then 'private' else 'public' end,
    'pending',
    p_mime_type,
    p_size_bytes,
    p_original_filename,
    case when p_purpose = 'creator_premium_video' then 180 else 60 end,
    pg_catalog.clock_timestamp() + interval '15 minutes',
    1
  );

  return 'created';
end;
$$;

-- Extend the existing identity guards. Identity remains immutable once ready,
-- and terminal cleanup states may never be resurrected by stale callbacks.
create or replace function private.guard_ready_media_asset_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- The production release applies migrations before deploying Edge code.  A
  -- pre-C1 cleanup worker must therefore fail closed instead of declaring a
  -- C1-enrolled row deleted after only its provider DELETE.  The canonical C1
  -- finalizer supplies both the independent first absence observation and the
  -- scheduled follow-up observation in the same fenced transition.
  if old.lifecycle_contract_version = 1
     and old.status = 'delete_pending'
     and new.status = 'deleted'
     and (
       new.provider_absence_verified_at is null
       or new.provider_absence_recheck_after is null
     ) then
    raise exception using
      errcode = '55000',
      message = 'media_asset_delete_confirmation_required';
  end if;

  if old.status in ('delete_pending','deleted') and (
    (old.status = 'delete_pending' and new.status not in ('delete_pending','deleted'))
    or (old.status = 'deleted' and new.status <> 'deleted')
  ) then
    raise exception using
      errcode = '55000',
      message = 'media_asset_terminal_state_immutable';
  end if;

  if old.status in ('delete_pending','deleted') and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.media_kind is distinct from old.media_kind
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.bucket_name is distinct from old.bucket_name
    or new.object_key is distinct from old.object_key
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
  ) then
    raise exception using
      errcode = '55000',
      message = 'media_asset_terminal_identity_immutable';
  end if;

  if old.ready_at is not null and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.media_kind is distinct from old.media_kind
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.bucket_name is distinct from old.bucket_name
    or new.object_key is distinct from old.object_key
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.etag is distinct from old.etag
  ) then
    raise exception using
      errcode = '55000',
      message = 'media_asset_ready_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.guard_ready_video_asset_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Keep the migration/Edge rollout boundary fail-closed for Stream too.  The
  -- pre-C1 worker updates status directly; only the fenced C1 finalizer carries
  -- the two-phase absence evidence required by this transition.
  if old.lifecycle_contract_version = 1
     and old.status = 'delete_pending'
     and new.status = 'deleted'
     and (
       new.provider_absence_verified_at is null
       or new.provider_absence_recheck_after is null
     ) then
    raise exception using
      errcode = '55000',
      message = 'video_asset_delete_confirmation_required';
  end if;

  if old.status in ('delete_pending','deleted') and (
    (old.status = 'delete_pending' and new.status not in ('delete_pending','deleted'))
    or (old.status = 'deleted' and new.status <> 'deleted')
  ) then
    raise exception using
      errcode = '55000',
      message = 'video_asset_terminal_state_immutable';
  end if;

  if old.status in ('delete_pending','deleted') and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.cloudflare_uid is distinct from old.cloudflare_uid
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.max_duration_seconds is distinct from old.max_duration_seconds
  ) then
    raise exception using
      errcode = '55000',
      message = 'video_asset_terminal_identity_immutable';
  end if;

  if old.ready_at is not null and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.cloudflare_uid is distinct from old.cloudflare_uid
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.max_duration_seconds is distinct from old.max_duration_seconds
  ) then
    raise exception using
      errcode = '55000',
      message = 'video_asset_ready_identity_immutable';
  end if;
  return new;
end;
$$;

-- Every link authority, including legacy Business callers, participates in the
-- same asset-row serialization protocol.  Product-specific guards still own
-- their shape/ownership rules; this trigger owns only the universal physical
-- lifecycle invariant.
create or replace function private.guard_media_asset_link_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select asset.status into v_status
  from public.media_assets asset
  where asset.id = new.asset_id
  for update;
  if not found then return new; end if;
  if v_status <> 'ready' then
    raise exception using errcode = '55000', message = 'media_asset_link_lifecycle_invalid';
  end if;
  return new;
end;
$$;

create or replace function private.guard_video_asset_link_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select asset.status into v_status
  from public.video_assets asset
  where asset.id = new.asset_id
  for update;
  if not found then return new; end if;
  if v_status <> 'ready' then
    raise exception using errcode = '55000', message = 'video_asset_link_lifecycle_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists media_asset_links_guard_lifecycle_c1 on public.media_asset_links;
create trigger media_asset_links_guard_lifecycle_c1
before insert or update on public.media_asset_links
for each row execute function private.guard_media_asset_link_lifecycle_v1();

drop trigger if exists video_asset_links_guard_lifecycle_c1 on public.video_asset_links;
create trigger video_asset_links_guard_lifecycle_c1
before insert or update on public.video_asset_links
for each row execute function private.guard_video_asset_link_lifecycle_v1();

-- One generic Stream scheduler owns row locking and link/delete ordering. The
-- historical Premium authority and both public service boundaries delegate to
-- this function; they contain no duplicated transition logic.
create or replace function private.schedule_video_asset_deletion_v1(
  p_asset_id uuid,
  p_owner_id uuid,
  p_required_purpose text default null
)
returns text
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
  if v_asset.owner_id <> p_owner_id then
    raise exception using errcode = '42501', message = 'stream_video_cleanup_owner_invalid';
  end if;
  if p_required_purpose is not null
     and v_asset.purpose <> p_required_purpose then
    raise exception using errcode = '42501', message = 'stream_video_cleanup_scope_invalid';
  end if;
  if v_asset.status = 'deleted' then
    return 'deleted';
  end if;
  if exists (
    select 1 from public.video_asset_links link where link.asset_id = v_asset.id
  ) then
    return 'asset_in_use';
  end if;
  if v_asset.status = 'delete_pending'
     and v_asset.lifecycle_contract_version = 1 then
    if v_asset.delete_attempts >= 12
       and v_asset.next_cleanup_attempt_at is null then
      return 'exhausted';
    end if;
    return 'scheduled';
  end if;

  update public.video_assets asset
  set status = 'delete_pending',
      hls_url = null,
      dash_url = null,
      thumbnail_url = null,
      error_code = null,
      error_message = null,
      delete_attempts = 0,
      post_delete_verification_attempts = 0,
      lifecycle_contract_version = 1,
      provider_absence_verified_at = null,
      provider_absence_recheck_after = null,
      next_cleanup_attempt_at = greatest(
        pg_catalog.clock_timestamp(),
        coalesce(v_asset.upload_expires_at,pg_catalog.clock_timestamp())
      ),
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id;

  return 'scheduled';
end;
$$;

create or replace function private.schedule_creator_premium_video_deletion_v1(
  p_asset_id uuid,
  p_owner_id uuid
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.schedule_video_asset_deletion_v1(
    p_asset_id,
    p_owner_id,
    'creator_premium_video'
  )
$$;

create or replace function public.schedule_video_asset_deletion_v1(
  p_asset_id uuid,
  p_owner_id uuid
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.schedule_video_asset_deletion_v1(p_asset_id,p_owner_id,null)
$$;

create or replace function public.schedule_creator_premium_video_deletion_v1(
  p_asset_id uuid,
  p_owner_id uuid
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.schedule_creator_premium_video_deletion_v1(p_asset_id,p_owner_id)
$$;

-- Explicit R2 deletion also enrolls only that row in C1. A still-valid PUT
-- capability delays provider deletion until its exact persisted expiry.
create or replace function public.schedule_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_due timestamptz;
begin
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id and asset.owner_id = p_owner_id
  for update;

  if not found then return 'not_found'; end if;
  if v_asset.status = 'deleted' then return 'deleted'; end if;
  if exists (
    select 1 from public.media_asset_links link where link.asset_id = v_asset.id
  ) then
    return 'asset_in_use';
  end if;
  if v_asset.status = 'delete_pending'
     and v_asset.lifecycle_contract_version = 1 then
    if v_asset.cleanup_attempts >= 12
       and v_asset.next_cleanup_attempt_at is null then
      return 'exhausted';
    end if;
    return 'scheduled';
  end if;

  v_due := greatest(
    pg_catalog.clock_timestamp(),
    coalesce(v_asset.upload_authorization_expires_at,pg_catalog.clock_timestamp())
  );

  update public.media_assets asset
  set status = 'delete_pending',
      error_code = null,
      cleanup_attempts = 0,
      last_cleanup_attempt_at = null,
      post_delete_verification_attempts = 0,
      lifecycle_contract_version = 1,
      provider_absence_verified_at = null,
      provider_absence_recheck_after = null,
      next_cleanup_attempt_at = v_due,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id;
  return 'scheduled';
end;
$$;

-- Keep the old finalizer for unversioned compatibility only. C1 rows must use
-- the fenced provider-verification authority below.
create or replace function public.finalize_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
begin
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id and asset.owner_id = p_owner_id
  for update;
  if not found
     or v_asset.status <> 'delete_pending'
     or v_asset.lifecycle_contract_version is not null then
    return false;
  end if;
  if exists (
    select 1 from public.media_asset_links link where link.asset_id = v_asset.id
  ) then
    return false;
  end if;
  update public.media_assets asset
  set status = 'deleted',
      deleted_at = coalesce(asset.deleted_at,pg_catalog.clock_timestamp()),
      error_code = null,
      cleanup_attempts = asset.cleanup_attempts + 1,
      last_cleanup_attempt_at = pg_catalog.clock_timestamp(),
      next_cleanup_attempt_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id
    and asset.status = 'delete_pending'
    and asset.lifecycle_contract_version is null;
  return found;
end;
$$;

-- Return shapes change by one operation discriminator; drop/recreate is needed
-- because PostgreSQL cannot CREATE OR REPLACE a table-returning signature.
drop function public.cleanup_stale_media_upload_records(integer);

create function public.cleanup_stale_media_upload_records(p_limit integer default 50)
returns table(
  id uuid,
  bucket_name text,
  object_key text,
  cleanup_attempts integer,
  operation text,
  failure_exhausts boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim record;
  v_housekeeping record;
  v_reaper record;
begin
  -- Preserve the canonical housekeeping that this function already owned
  -- before C1. Rows become C1-enrolled only when an actual lifecycle event
  -- (expired story or missing linked entity) makes an unlinked asset eligible.
  -- Lock the asset before removing an invalid link.  A concurrent binder uses
  -- the same row lock, so SKIP LOCKED leaves both the asset and its link intact
  -- for the next sweep instead of losing the event while another transaction
  -- owns the row.
  for v_housekeeping in
    select asset.id,
      exists (
        select 1
        from public.media_asset_links story_link
        join public.stories story on story.id = story_link.entity_id
        where story_link.asset_id = asset.id
          and story_link.entity_type = 'story'
          and story.expires_at <= pg_catalog.clock_timestamp()
      ) as has_expired_story
    from public.media_assets asset
    where exists (
      select 1
      from public.media_asset_links link
      where link.asset_id = asset.id
        and (
          (
            link.entity_type = 'user_profile'
            and not exists (
              select 1 from public.user_profiles profile
              where profile.id = link.entity_id
                and profile.avatar_url = asset.public_url
            )
          )
          or (
            link.entity_type = 'video_post'
            and not exists (
              select 1 from public.videos video where video.id = link.entity_id
            )
          )
          or (
            link.entity_type = 'story'
            and not exists (
              select 1 from public.stories story
              where story.id = link.entity_id
                and story.expires_at > pg_catalog.clock_timestamp()
            )
          )
          or (
            link.entity_type = 'shop_product'
            and not exists (
              select 1 from public.products product
              where product.id = link.entity_id and product.status <> 'deleted'
            )
          )
        )
    )
    order by asset.id
    for update of asset skip locked
  loop
    delete from public.media_asset_links link
    using public.media_assets asset
    where asset.id = v_housekeeping.id
      and link.asset_id = asset.id
      and (
        (
          link.entity_type = 'user_profile'
          and not exists (
            select 1 from public.user_profiles profile
            where profile.id = link.entity_id
              and profile.avatar_url = asset.public_url
          )
        )
        or (
          link.entity_type = 'video_post'
          and not exists (
            select 1 from public.videos video where video.id = link.entity_id
          )
        )
        or (
          link.entity_type = 'story'
          and not exists (
            select 1 from public.stories story
            where story.id = link.entity_id
              and story.expires_at > pg_catalog.clock_timestamp()
          )
        )
        or (
          link.entity_type = 'shop_product'
          and not exists (
            select 1 from public.products product
            where product.id = link.entity_id and product.status <> 'deleted'
          )
        )
      );

    update public.media_assets asset
    set status = 'delete_pending',
        error_code = case when v_housekeeping.has_expired_story
          then 'story_expired' else 'linked_entity_missing' end,
        lifecycle_contract_version = 1,
        cleanup_attempts = 0,
        last_cleanup_attempt_at = null,
        post_delete_verification_attempts = 0,
        provider_absence_verified_at = null,
        provider_absence_recheck_after = null,
        next_cleanup_attempt_at = greatest(
          pg_catalog.clock_timestamp(),
          coalesce(asset.upload_authorization_expires_at,pg_catalog.clock_timestamp())
        ),
        updated_at = pg_catalog.clock_timestamp()
    where asset.id = v_housekeeping.id
      and asset.status = 'ready'
      and not exists (
        select 1 from public.media_asset_links remaining
        where remaining.asset_id = asset.id
      );
  end loop;

  delete from public.stories story
  where story.expires_at <= pg_catalog.clock_timestamp();

  with abandoned as (
    select asset.id
    from public.media_assets asset
    where asset.lifecycle_contract_version = 1
      and asset.provider = 'r2'
      and asset.status in ('pending','uploading','failed')
      and greatest(
        asset.created_at + interval '1 hour',
        coalesce(asset.upload_authorization_expires_at,asset.created_at + interval '1 hour')
      ) <= pg_catalog.clock_timestamp()
      and not exists (
        select 1 from public.media_asset_links link where link.asset_id = asset.id
      )
    order by asset.created_at,asset.id
    for update of asset skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.media_assets asset
  set status = 'delete_pending',
      error_code = 'upload_expired',
      cleanup_attempts = 0,
      last_cleanup_attempt_at = null,
      post_delete_verification_attempts = 0,
      next_cleanup_attempt_at = greatest(
        pg_catalog.clock_timestamp(),
        coalesce(asset.upload_authorization_expires_at,pg_catalog.clock_timestamp())
      ),
      updated_at = pg_catalog.clock_timestamp()
  from abandoned
  where asset.id = abandoned.id;

  with orphan_ready as (
    select asset.id
    from public.media_assets asset
    where asset.lifecycle_contract_version = 1
      and asset.provider = 'r2'
      and asset.status = 'ready'
      and asset.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
      and not exists (
        select 1 from public.media_asset_links link where link.asset_id = asset.id
      )
    order by asset.created_at,asset.id
    for update of asset skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.media_assets asset
  set status = 'delete_pending',
      error_code = 'orphan_ready',
      cleanup_attempts = 0,
      last_cleanup_attempt_at = null,
      post_delete_verification_attempts = 0,
      next_cleanup_attempt_at = greatest(
        pg_catalog.clock_timestamp(),
        coalesce(asset.upload_authorization_expires_at,pg_catalog.clock_timestamp())
      ),
      updated_at = pg_catalog.clock_timestamp()
  from orphan_ready
  where asset.id = orphan_ready.id;

  -- A worker can disappear after acquiring its final provider claim. Reap an
  -- expired final lease into a stable terminal error without issuing attempt
  -- 13/14 or a fourth post-delete provider request. The global counter remains
  -- the monotonic provider fence; the post-delete counter bounds only that
  -- separate verification phase.
  for v_reaper in
    with expired_final_claim as (
      select asset.id,asset.status,asset.cleanup_attempts
      from public.media_assets asset
      where asset.lifecycle_contract_version = 1
        and asset.provider = 'r2'
        and (
          (
            asset.status = 'delete_pending'
            and asset.provider_absence_verified_at is null
            and asset.cleanup_attempts >= 12
            and asset.next_cleanup_attempt_at is not null
            and asset.next_cleanup_attempt_at <= pg_catalog.clock_timestamp()
          )
          or (
            asset.status = 'delete_pending'
            and asset.provider_absence_verified_at is not null
            and asset.cleanup_attempts >= 13
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
          or (
            asset.status = 'deleted'
            and asset.post_delete_verification_attempts >= 3
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
        )
        and not exists (
          select 1 from public.media_asset_links link where link.asset_id = asset.id
        )
      order by coalesce(
        asset.provider_absence_recheck_after,
        asset.next_cleanup_attempt_at,
        asset.updated_at
      ),asset.id
      for update of asset skip locked
      limit greatest(1,least(coalesce(p_limit,50),100))
    )
    update public.media_assets asset
    set error_code = case when expired_final_claim.status = 'deleted'
          then 'media_post_delete_verification_exhausted'
          else 'media_cleanup_attempts_exhausted' end,
        next_cleanup_attempt_at = null,
        provider_absence_recheck_after = null,
        updated_at = pg_catalog.clock_timestamp()
    from expired_final_claim
    where asset.id = expired_final_claim.id
    returning asset.id as reaped_id,
      asset.cleanup_attempts as reaped_attempt,
      expired_final_claim.status as reaped_status
  loop
    perform private.record_media_lifecycle_audit_v1(
      v_reaper.reaped_id,'media_asset','r2',
      case when v_reaper.reaped_status = 'deleted'
        then 'post_delete_verification_exhausted' else 'cleanup_exhausted' end,
      v_reaper.reaped_attempt,'claim_lease_expired',null,'failed'
    );
  end loop;

  for v_claim in
    with claimed as (
      select asset.id,asset.status,asset.provider_absence_verified_at
      from public.media_assets asset
      where asset.lifecycle_contract_version = 1
        and asset.provider = 'r2'
        and (
          (
            asset.status = 'delete_pending'
            and (
              (
                asset.provider_absence_verified_at is null
                and asset.cleanup_attempts < 12
                and coalesce(asset.next_cleanup_attempt_at,pg_catalog.clock_timestamp())
                    <= pg_catalog.clock_timestamp()
                and coalesce(asset.upload_authorization_expires_at,'-infinity'::timestamptz)
                    <= pg_catalog.clock_timestamp()
              )
              or (
                asset.provider_absence_verified_at is not null
                and asset.cleanup_attempts < 13
                and asset.provider_absence_recheck_after is not null
                and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
              )
            )
          )
          or (
            asset.status = 'deleted'
            and asset.post_delete_verification_attempts < 3
            and asset.provider_absence_verified_at is not null
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
        )
        and not exists (
          select 1 from public.media_asset_links link where link.asset_id = asset.id
        )
      order by coalesce(
        asset.provider_absence_recheck_after,
        asset.next_cleanup_attempt_at,
        asset.created_at
      ),asset.id
      for update of asset skip locked
      limit greatest(1,least(coalesce(p_limit,50),100))
    )
    update public.media_assets asset
    set cleanup_attempts = asset.cleanup_attempts + 1,
        post_delete_verification_attempts = case when claimed.status = 'deleted'
          then asset.post_delete_verification_attempts + 1
          else asset.post_delete_verification_attempts end,
        last_cleanup_attempt_at = pg_catalog.clock_timestamp(),
        next_cleanup_attempt_at = case when claimed.status = 'delete_pending'
          then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
            secs => least(21600,30 * pg_catalog.power(2,least(asset.cleanup_attempts,9))::integer)
          )
          else asset.next_cleanup_attempt_at end,
        provider_absence_recheck_after = case
          when claimed.status = 'deleted'
            then pg_catalog.clock_timestamp() + interval '15 minutes'
          when claimed.status = 'delete_pending'
            and claimed.provider_absence_verified_at is not null
            then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
              secs => least(21600,30 * pg_catalog.power(2,least(asset.cleanup_attempts,9))::integer)
            )
          else asset.provider_absence_recheck_after end,
        updated_at = pg_catalog.clock_timestamp()
    from claimed
    where asset.id = claimed.id
      and not exists (
        select 1 from public.media_asset_links link where link.asset_id = asset.id
      )
    returning asset.id as claimed_id,asset.bucket_name as claimed_bucket_name,
      asset.object_key as claimed_object_key,asset.cleanup_attempts as claimed_attempt,
      case when claimed.status = 'deleted'
          or claimed.provider_absence_verified_at is not null
        then 'verify_absence' else 'delete' end
        as claimed_operation,
      (
        (claimed.status = 'delete_pending' and asset.cleanup_attempts >= 12)
        or (claimed.status = 'deleted' and asset.post_delete_verification_attempts >= 3)
      )
        as claimed_failure_exhausts
  loop
    perform private.record_media_lifecycle_audit_v1(
      v_claim.claimed_id,'media_asset','r2',
      case when v_claim.claimed_operation = 'delete'
        then 'delete_requested' else 'absence_check_requested' end,
      v_claim.claimed_attempt,'claim_acquired',null,'succeeded'
    );
    id := v_claim.claimed_id;
    bucket_name := v_claim.claimed_bucket_name;
    object_key := v_claim.claimed_object_key;
    cleanup_attempts := v_claim.claimed_attempt;
    operation := v_claim.claimed_operation;
    failure_exhausts := v_claim.claimed_failure_exhausts;
    return next;
  end loop;
end;
$$;

drop function public.cleanup_stale_creator_premium_video_records(integer);

create function public.cleanup_stale_creator_premium_video_records(p_limit integer default 50)
returns table(
  id uuid,
  cloudflare_uid text,
  purpose text,
  delete_attempts integer,
  operation text,
  failure_exhausts boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim record;
  v_reaper record;
begin
  with abandoned as (
    select asset.id
    from public.video_assets asset
    where asset.lifecycle_contract_version = 1
      and asset.provider = 'cloudflare_stream'
      and asset.purpose = 'creator_premium_video'
      and asset.status in ('pending','uploading','processing','ready','failed')
      and asset.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
      and not exists (
        select 1 from public.video_asset_links link where link.asset_id = asset.id
      )
    order by asset.created_at,asset.id
    for update of asset skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.video_assets asset
  set status = 'delete_pending',
      hls_url = null,
      dash_url = null,
      thumbnail_url = null,
      error_code = 'creator_premium_video_abandoned',
      error_message = null,
      delete_attempts = 0,
      post_delete_verification_attempts = 0,
      next_cleanup_attempt_at = coalesce(
        asset.next_cleanup_attempt_at,
        pg_catalog.clock_timestamp()
      ),
      updated_at = pg_catalog.clock_timestamp()
  from abandoned
  where asset.id = abandoned.id;

  -- Classify a lost final worker lease locally. No additional Cloudflare
  -- request is returned to the Edge caller once the bounded phase is spent.
  for v_reaper in
    with expired_final_claim as (
      select asset.id,asset.status,asset.delete_attempts
      from public.video_assets asset
      where asset.lifecycle_contract_version = 1
        and asset.provider = 'cloudflare_stream'
        and asset.purpose in ('feed_video','business_library','creator_premium_video')
        and (
          (
            asset.status = 'delete_pending'
            and asset.provider_absence_verified_at is null
            and asset.delete_attempts >= 12
            and asset.next_cleanup_attempt_at is not null
            and asset.next_cleanup_attempt_at <= pg_catalog.clock_timestamp()
          )
          or (
            asset.status = 'delete_pending'
            and asset.provider_absence_verified_at is not null
            and asset.delete_attempts >= 13
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
          or (
            asset.status = 'deleted'
            and asset.post_delete_verification_attempts >= 3
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
        )
        and not exists (
          select 1 from public.video_asset_links link where link.asset_id = asset.id
        )
      order by coalesce(
        asset.provider_absence_recheck_after,
        asset.next_cleanup_attempt_at,
        asset.updated_at
      ),asset.id
      for update of asset skip locked
      limit greatest(1,least(coalesce(p_limit,50),100))
    )
    update public.video_assets asset
    set error_code = case when expired_final_claim.status = 'deleted'
          then 'stream_post_delete_verification_exhausted'
          else 'stream_cleanup_attempts_exhausted' end,
        error_message = null,
        next_cleanup_attempt_at = null,
        provider_absence_recheck_after = null,
        updated_at = pg_catalog.clock_timestamp()
    from expired_final_claim
    where asset.id = expired_final_claim.id
    returning asset.id as reaped_id,
      asset.delete_attempts as reaped_attempt,
      expired_final_claim.status as reaped_status
  loop
    perform private.record_media_lifecycle_audit_v1(
      v_reaper.reaped_id,'video_asset','cloudflare_stream',
      case when v_reaper.reaped_status = 'deleted'
        then 'post_delete_verification_exhausted' else 'cleanup_exhausted' end,
      v_reaper.reaped_attempt,'claim_lease_expired',null,'failed'
    );
  end loop;

  for v_claim in
    with claimed as (
      select asset.id,asset.status,asset.provider_absence_verified_at
      from public.video_assets asset
      where asset.lifecycle_contract_version = 1
        and asset.provider = 'cloudflare_stream'
        and asset.purpose in ('feed_video','business_library','creator_premium_video')
        and (
          (
            asset.status = 'delete_pending'
            and (
              (
                asset.provider_absence_verified_at is null
                and asset.delete_attempts < 12
                and coalesce(asset.next_cleanup_attempt_at,pg_catalog.clock_timestamp())
                    <= pg_catalog.clock_timestamp()
                and coalesce(asset.upload_expires_at,'-infinity'::timestamptz)
                    <= pg_catalog.clock_timestamp()
              )
              or (
                asset.provider_absence_verified_at is not null
                and asset.delete_attempts < 13
                and asset.provider_absence_recheck_after is not null
                and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
              )
            )
          )
          or (
            asset.status = 'deleted'
            and asset.post_delete_verification_attempts < 3
            and asset.provider_absence_verified_at is not null
            and asset.provider_absence_recheck_after is not null
            and asset.provider_absence_recheck_after <= pg_catalog.clock_timestamp()
          )
        )
        and not exists (
          select 1 from public.video_asset_links link where link.asset_id = asset.id
        )
      order by coalesce(
        asset.provider_absence_recheck_after,
        asset.next_cleanup_attempt_at,
        asset.created_at
      ),asset.id
      for update of asset skip locked
      limit greatest(1,least(coalesce(p_limit,50),100))
    )
    update public.video_assets asset
    set delete_attempts = asset.delete_attempts + 1,
        post_delete_verification_attempts = case when claimed.status = 'deleted'
          then asset.post_delete_verification_attempts + 1
          else asset.post_delete_verification_attempts end,
        next_cleanup_attempt_at = case when claimed.status = 'delete_pending'
          then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
            secs => least(21600,30 * pg_catalog.power(2,least(asset.delete_attempts,9))::integer)
          )
          else asset.next_cleanup_attempt_at end,
        provider_absence_recheck_after = case
          when claimed.status = 'deleted'
            then pg_catalog.clock_timestamp() + interval '15 minutes'
          when claimed.status = 'delete_pending'
            and claimed.provider_absence_verified_at is not null
            then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
              secs => least(21600,30 * pg_catalog.power(2,least(asset.delete_attempts,9))::integer)
            )
          else asset.provider_absence_recheck_after end,
        updated_at = pg_catalog.clock_timestamp()
    from claimed
    where asset.id = claimed.id
      and not exists (
        select 1 from public.video_asset_links link where link.asset_id = asset.id
      )
    returning asset.id as claimed_id,asset.cloudflare_uid as claimed_provider_identity,
      asset.purpose as claimed_purpose,
      asset.delete_attempts as claimed_attempt,
      case when claimed.status = 'deleted'
          or claimed.provider_absence_verified_at is not null
        then 'verify_absence' else 'delete' end
        as claimed_operation,
      (
        (claimed.status = 'delete_pending' and asset.delete_attempts >= 12)
        or (claimed.status = 'deleted' and asset.post_delete_verification_attempts >= 3)
      )
        as claimed_failure_exhausts
  loop
    perform private.record_media_lifecycle_audit_v1(
      v_claim.claimed_id,'video_asset','cloudflare_stream',
      case when v_claim.claimed_operation = 'delete'
        then 'delete_requested' else 'absence_check_requested' end,
      v_claim.claimed_attempt,'claim_acquired',null,'succeeded'
    );
    id := v_claim.claimed_id;
    cloudflare_uid := v_claim.claimed_provider_identity;
    purpose := v_claim.claimed_purpose;
    delete_attempts := v_claim.claimed_attempt;
    operation := v_claim.claimed_operation;
    failure_exhausts := v_claim.claimed_failure_exhausts;
    return next;
  end loop;
end;
$$;

-- The audit helper accepts only bounded safe values. It never receives or
-- stores provider object identities, URLs, filenames, tokens, or media data.
create or replace function private.record_media_lifecycle_audit_v1(
  p_asset_id uuid,
  p_target_type text,
  p_provider text,
  p_operation text,
  p_attempt integer,
  p_provider_outcome text,
  p_provider_request_id text,
  p_audit_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text := nullif(pg_catalog.btrim(p_provider_request_id),'');
  v_scope text;
  v_key uuid;
  v_fingerprint text;
begin
  if p_asset_id is null
     or p_target_type is null
     or p_provider is null
     or p_operation is null
     or p_attempt is null
     or p_provider_outcome is null
     or p_audit_outcome is null
     or p_target_type not in ('media_asset','video_asset')
     or p_provider not in ('r2','cloudflare_stream')
     or p_operation !~ '^[a-z][a-z0-9_]{2,63}$'
     or p_attempt < 1
     or p_provider_outcome !~ '^[a-z][a-z0-9_]{2,99}$'
     or p_audit_outcome not in ('succeeded','failed') then
    raise exception using errcode = '22023', message = 'media_lifecycle_audit_invalid';
  end if;
  if v_request_id is not null and (
    pg_catalog.char_length(v_request_id) > 128
    or v_request_id !~ '^[A-Za-z0-9._:-]+$'
  ) then
    v_request_id := null;
  end if;

  v_scope := 'v1|system|media_lifecycle|' || p_provider || '|'
    || p_operation || '|' || p_asset_id::text;
  v_key := pg_catalog.md5(
    v_scope || '|' || p_attempt::text || '|' || p_provider_outcome
  )::uuid;
  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|',v_scope,p_attempt::text,p_provider_outcome,
      coalesce(v_request_id,'')),
    'sha256'
  ),'hex');

  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,
    domain,action,target_type,target_id,target_ref,reason,
    outcome,financial_effect,contains_pii,metadata,
    idempotency_scope,idempotency_key,request_fingerprint
  ) values (
    null,'system_workflow','{}'::text[],null,
    'media_lifecycle','media_lifecycle.' || p_operation,p_target_type,
    p_asset_id,p_asset_id::text,null,
    p_audit_outcome,false,false,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'contract_version',1,
      'provider',p_provider,
      'operation',p_operation,
      'attempt',p_attempt,
      'provider_outcome',p_provider_outcome,
      'provider_request_id',v_request_id
    )),
    v_scope,v_key,v_fingerprint
  )
  on conflict do nothing;
end;
$$;

-- Persist the provider acknowledgement before the independent HEAD/metadata
-- verification.  If the verifier times out, the accepted DELETE still has an
-- immutable, sanitized receipt and the same attempt fence can be retried.
create or replace function public.record_media_asset_provider_delete_v1(
  p_asset_id uuid,
  p_cleanup_attempt integer,
  p_operation text,
  p_delete_outcome text,
  p_delete_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
begin
  if p_operation not in ('delete','verify_absence')
     or p_delete_outcome not in ('delete_accepted','already_absent') then
    raise exception using errcode = '22023', message = 'media_delete_receipt_invalid';
  end if;
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'r2'
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.cleanup_attempts <> p_cleanup_attempt
     or (p_operation = 'delete' and (
       v_asset.status <> 'delete_pending'
       or v_asset.provider_absence_verified_at is not null
       or v_asset.next_cleanup_attempt_at is null
     ))
     or (p_operation = 'verify_absence' and not (
       (v_asset.status = 'deleted'
         and v_asset.provider_absence_recheck_after is not null)
       or (v_asset.status = 'delete_pending'
         and v_asset.provider_absence_verified_at is not null
         and v_asset.provider_absence_recheck_after is not null)
     ))
     or exists (
       select 1 from public.media_asset_links link where link.asset_id = v_asset.id
     ) then
    return false;
  end if;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'media_asset','r2','delete_accepted',p_cleanup_attempt,
    p_delete_outcome,p_delete_request_id,'succeeded'
  );
  return true;
end;
$$;

create or replace function public.record_creator_premium_video_provider_delete_v1(
  p_asset_id uuid,
  p_delete_attempt integer,
  p_operation text,
  p_delete_outcome text,
  p_delete_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
begin
  if p_operation not in ('delete','verify_absence')
     or p_delete_outcome not in ('delete_accepted','already_absent') then
    raise exception using errcode = '22023', message = 'stream_delete_receipt_invalid';
  end if;
  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'cloudflare_stream'
     or v_asset.cloudflare_uid is null
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.delete_attempts <> p_delete_attempt
     or (p_operation = 'delete' and (
       v_asset.status <> 'delete_pending'
       or v_asset.provider_absence_verified_at is not null
       or v_asset.next_cleanup_attempt_at is null
     ))
     or (p_operation = 'verify_absence' and not (
       (v_asset.status = 'deleted'
         and v_asset.provider_absence_recheck_after is not null)
       or (v_asset.status = 'delete_pending'
         and v_asset.provider_absence_verified_at is not null
         and v_asset.provider_absence_recheck_after is not null)
     ))
     or exists (
       select 1 from public.video_asset_links link where link.asset_id = v_asset.id
     ) then
    return false;
  end if;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'video_asset','cloudflare_stream','delete_accepted',p_delete_attempt,
    p_delete_outcome,p_delete_request_id,'succeeded'
  );
  return true;
end;
$$;

create or replace function public.finalize_media_asset_cleanup_v1(
  p_asset_id uuid,
  p_cleanup_attempt integer,
  p_operation text,
  p_delete_outcome text,
  p_delete_request_id text,
  p_absence_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_next timestamptz;
begin
  if p_operation is null
     or p_operation not in ('delete','verify_absence')
     or (
       p_operation = 'delete'
       and (
         p_delete_outcome is null
         or p_delete_outcome not in ('delete_accepted','already_absent')
       )
     )
     or (p_delete_outcome is null
       and nullif(pg_catalog.btrim(p_delete_request_id),'') is not null)
     or (p_delete_outcome is not null
       and p_delete_outcome not in ('delete_accepted','already_absent')) then
    raise exception using errcode = '22023', message = 'media_cleanup_outcome_invalid';
  end if;
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'r2'
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.status not in ('delete_pending','deleted')
     or (v_asset.status = 'delete_pending' and (
       (v_asset.provider_absence_verified_at is null and (
         p_operation <> 'delete' or v_asset.next_cleanup_attempt_at is null
       ))
       or (v_asset.provider_absence_verified_at is not null
         and (p_operation <> 'verify_absence'
           or v_asset.provider_absence_recheck_after is null))
     ))
     or (v_asset.status = 'deleted' and (
       p_operation <> 'verify_absence'
       or v_asset.provider_absence_recheck_after is null
     ))
     or v_asset.cleanup_attempts <> p_cleanup_attempt then
    return 'stale';
  end if;
  if exists (
    select 1 from public.media_asset_links link where link.asset_id = v_asset.id
  ) then
    return 'stale';
  end if;

  if p_delete_outcome is not null then
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'media_asset','r2','delete_accepted',p_cleanup_attempt,
      p_delete_outcome,p_delete_request_id,'succeeded'
    );
  end if;

  if v_asset.status = 'delete_pending'
     and v_asset.provider_absence_verified_at is null then
    -- Existing stale-upload policy uses a one-hour safety window. C1 waits
    -- until at least one hour after the issued PUT capability expires before
    -- accepting the second observation; it does not claim URL revocation.
    v_next := greatest(
      pg_catalog.clock_timestamp() + interval '15 minutes',
      coalesce(v_asset.upload_authorization_expires_at,v_asset.created_at)
        + interval '1 hour'
    );
    update public.media_assets asset
    set provider_absence_verified_at = pg_catalog.clock_timestamp(),
        provider_absence_recheck_after = v_next,
        next_cleanup_attempt_at = v_next,
        error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where asset.id = v_asset.id
      and asset.status = 'delete_pending'
      and asset.cleanup_attempts = p_cleanup_attempt;
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'media_asset','r2','absence_observed',p_cleanup_attempt,
      'verified_absent',p_absence_request_id,'succeeded'
    );
    return 'recheck_scheduled';
  end if;

  if v_asset.status = 'delete_pending' then
    v_next := pg_catalog.clock_timestamp() + interval '24 hours';
    update public.media_assets asset
    set status = 'deleted',
        deleted_at = coalesce(asset.deleted_at,pg_catalog.clock_timestamp()),
        post_delete_verification_attempts = 0,
        provider_absence_verified_at = pg_catalog.clock_timestamp(),
        provider_absence_recheck_after = v_next,
        next_cleanup_attempt_at = null,
        error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where asset.id = v_asset.id
      and asset.status = 'delete_pending'
      and asset.cleanup_attempts = p_cleanup_attempt;
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'media_asset','r2','tombstone_confirmed',p_cleanup_attempt,
      'verified_absent',p_absence_request_id,'succeeded'
    );
    return 'finalized';
  end if;

  -- The post-delete observation has a separate, finite fence. A reappeared
  -- object is re-deleted by the Edge worker before this success is recorded;
  -- a confirmed absence closes the loop instead of scheduling perpetual HEADs.
  update public.media_assets asset
  set provider_absence_verified_at = pg_catalog.clock_timestamp(),
      provider_absence_recheck_after = null,
      next_cleanup_attempt_at = null,
      error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id
    and asset.status = 'deleted'
    and asset.cleanup_attempts = p_cleanup_attempt;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'media_asset','r2','absence_verified',p_cleanup_attempt,
    'verified_absent',p_absence_request_id,'succeeded'
  );
  return 'verified';
end;
$$;

create or replace function public.record_media_asset_cleanup_failure_v1(
  p_asset_id uuid,
  p_cleanup_attempt integer,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_error text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_error_code,'')));
  v_next timestamptz;
begin
  if v_error !~ '^[a-z][a-z0-9_]{2,99}$' then
    v_error := 'provider_cleanup_failed';
  end if;
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'r2'
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.status not in ('delete_pending','deleted')
     or v_asset.cleanup_attempts <> p_cleanup_attempt
     or (v_asset.status = 'delete_pending' and (
       (v_asset.provider_absence_verified_at is null
         and v_asset.next_cleanup_attempt_at is null)
       or (v_asset.provider_absence_verified_at is not null
         and v_asset.provider_absence_recheck_after is null)
     ))
     or (v_asset.status = 'deleted'
       and v_asset.provider_absence_recheck_after is null) then
    return false;
  end if;
  if exists (
    select 1 from public.media_asset_links link where link.asset_id = v_asset.id
  ) then
    return false;
  end if;
  v_next := pg_catalog.clock_timestamp() + pg_catalog.make_interval(
    secs => least(21600,30 * pg_catalog.power(2,least(v_asset.cleanup_attempts,9))::integer)
  );
  update public.media_assets asset
  set error_code = case
        when asset.status = 'delete_pending' and p_cleanup_attempt >= 12
          then 'media_cleanup_attempts_exhausted'
        when asset.status = 'deleted'
          and asset.post_delete_verification_attempts >= 3
          then 'media_post_delete_verification_exhausted'
        else v_error end,
      next_cleanup_attempt_at = case
        when asset.status = 'delete_pending' and p_cleanup_attempt >= 12 then null
        when asset.status = 'delete_pending' then v_next
        when asset.status = 'deleted' then null
        else asset.next_cleanup_attempt_at end,
      provider_absence_recheck_after = case
        when asset.status = 'delete_pending' and p_cleanup_attempt >= 12 then null
        when asset.status = 'delete_pending'
          and asset.provider_absence_verified_at is not null then v_next
        when asset.status = 'deleted'
          and asset.post_delete_verification_attempts >= 3 then null
        when asset.status = 'deleted' then v_next
        else asset.provider_absence_recheck_after end,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id
    and asset.cleanup_attempts = p_cleanup_attempt;
  if not found then return false; end if;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'media_asset','r2',case
      when p_cleanup_attempt >= 12 and v_asset.status = 'delete_pending'
        then 'cleanup_exhausted'
      when v_asset.post_delete_verification_attempts >= 3
        and v_asset.status = 'deleted'
        then 'post_delete_verification_exhausted'
      else 'cleanup_failed' end,p_cleanup_attempt,
    v_error,null,'failed'
  );
  return true;
end;
$$;

create or replace function public.finalize_creator_premium_video_cleanup_v1(
  p_asset_id uuid,
  p_delete_attempt integer,
  p_operation text,
  p_delete_outcome text,
  p_delete_request_id text,
  p_absence_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
  v_next timestamptz;
begin
  if p_operation is null
     or p_operation not in ('delete','verify_absence')
     or (
       p_operation = 'delete'
       and (
         p_delete_outcome is null
         or p_delete_outcome not in ('delete_accepted','already_absent')
       )
     )
     or (p_delete_outcome is null
       and nullif(pg_catalog.btrim(p_delete_request_id),'') is not null)
     or (p_delete_outcome is not null
       and p_delete_outcome not in ('delete_accepted','already_absent')) then
    raise exception using errcode = '22023', message = 'stream_cleanup_outcome_invalid';
  end if;
  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'cloudflare_stream'
     or v_asset.cloudflare_uid is null
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.status not in ('delete_pending','deleted')
     or (v_asset.status = 'delete_pending' and (
       (v_asset.provider_absence_verified_at is null and (
         p_operation <> 'delete' or v_asset.next_cleanup_attempt_at is null
       ))
       or (v_asset.provider_absence_verified_at is not null
         and (p_operation <> 'verify_absence'
           or v_asset.provider_absence_recheck_after is null))
     ))
     or (v_asset.status = 'deleted' and (
       p_operation <> 'verify_absence'
       or v_asset.provider_absence_recheck_after is null
     ))
     or v_asset.delete_attempts <> p_delete_attempt then
    return 'stale';
  end if;
  if exists (
    select 1 from public.video_asset_links link where link.asset_id = v_asset.id
  ) then
    return 'stale';
  end if;

  if p_delete_outcome is not null then
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'video_asset','cloudflare_stream','delete_accepted',p_delete_attempt,
      p_delete_outcome,p_delete_request_id,'succeeded'
    );
  end if;

  if v_asset.status = 'delete_pending'
     and v_asset.provider_absence_verified_at is null then
    v_next := greatest(
      pg_catalog.clock_timestamp() + interval '15 minutes',
      coalesce(v_asset.upload_expires_at,v_asset.created_at) + interval '1 hour'
    );
    update public.video_assets asset
    set provider_absence_verified_at = pg_catalog.clock_timestamp(),
        provider_absence_recheck_after = v_next,
        next_cleanup_attempt_at = v_next,
        error_code = null,
        error_message = null,
        updated_at = pg_catalog.clock_timestamp()
    where asset.id = v_asset.id
      and asset.status = 'delete_pending'
      and asset.delete_attempts = p_delete_attempt;
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'video_asset','cloudflare_stream','absence_observed',p_delete_attempt,
      'verified_absent',p_absence_request_id,'succeeded'
    );
    return 'recheck_scheduled';
  end if;

  if v_asset.status = 'delete_pending' then
    v_next := pg_catalog.clock_timestamp() + interval '24 hours';
    update public.video_assets asset
    set status = 'deleted',
        deleted_at = coalesce(asset.deleted_at,pg_catalog.clock_timestamp()),
        post_delete_verification_attempts = 0,
        hls_url = null,
        dash_url = null,
        thumbnail_url = null,
        provider_absence_verified_at = pg_catalog.clock_timestamp(),
        provider_absence_recheck_after = v_next,
        next_cleanup_attempt_at = null,
        error_code = null,
        error_message = null,
        updated_at = pg_catalog.clock_timestamp()
    where asset.id = v_asset.id
      and asset.status = 'delete_pending'
      and asset.delete_attempts = p_delete_attempt;
    perform private.record_media_lifecycle_audit_v1(
      v_asset.id,'video_asset','cloudflare_stream','tombstone_confirmed',p_delete_attempt,
      'verified_absent',p_absence_request_id,'succeeded'
    );
    return 'finalized';
  end if;

  update public.video_assets asset
  set provider_absence_verified_at = pg_catalog.clock_timestamp(),
      provider_absence_recheck_after = null,
      next_cleanup_attempt_at = null,
      error_code = null,
      error_message = null,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id
    and asset.status = 'deleted'
    and asset.delete_attempts = p_delete_attempt;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'video_asset','cloudflare_stream','absence_verified',p_delete_attempt,
    'verified_absent',p_absence_request_id,'succeeded'
  );
  return 'verified';
end;
$$;

create or replace function public.record_creator_premium_video_cleanup_failure_v1(
  p_asset_id uuid,
  p_delete_attempt integer,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
  v_error text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_error_code,'')));
  v_next timestamptz;
begin
  if v_error !~ '^[a-z][a-z0-9_]{2,99}$' then
    v_error := 'provider_cleanup_failed';
  end if;
  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;
  if not found
     or v_asset.provider <> 'cloudflare_stream'
     or v_asset.lifecycle_contract_version <> 1
     or v_asset.status not in ('delete_pending','deleted')
     or v_asset.delete_attempts <> p_delete_attempt
     or (v_asset.status = 'delete_pending' and (
       (v_asset.provider_absence_verified_at is null
         and v_asset.next_cleanup_attempt_at is null)
       or (v_asset.provider_absence_verified_at is not null
         and v_asset.provider_absence_recheck_after is null)
     ))
     or (v_asset.status = 'deleted'
       and v_asset.provider_absence_recheck_after is null) then
    return false;
  end if;
  if exists (
    select 1 from public.video_asset_links link where link.asset_id = v_asset.id
  ) then
    return false;
  end if;
  v_next := pg_catalog.clock_timestamp() + pg_catalog.make_interval(
    secs => least(21600,30 * pg_catalog.power(2,least(v_asset.delete_attempts,9))::integer)
  );
  update public.video_assets asset
  set error_code = case
        when asset.status = 'delete_pending' and p_delete_attempt >= 12
          then 'stream_cleanup_attempts_exhausted'
        when asset.status = 'deleted'
          and asset.post_delete_verification_attempts >= 3
          then 'stream_post_delete_verification_exhausted'
        else v_error end,
      error_message = null,
      next_cleanup_attempt_at = case
        when asset.status = 'delete_pending' and p_delete_attempt >= 12 then null
        when asset.status = 'delete_pending' then v_next
        when asset.status = 'deleted' then null
        else asset.next_cleanup_attempt_at end,
      provider_absence_recheck_after = case
        when asset.status = 'delete_pending' and p_delete_attempt >= 12 then null
        when asset.status = 'delete_pending'
          and asset.provider_absence_verified_at is not null then v_next
        when asset.status = 'deleted'
          and asset.post_delete_verification_attempts >= 3 then null
        when asset.status = 'deleted' then v_next
        else asset.provider_absence_recheck_after end,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id
    and asset.delete_attempts = p_delete_attempt;
  if not found then return false; end if;
  perform private.record_media_lifecycle_audit_v1(
    v_asset.id,'video_asset','cloudflare_stream',case
      when p_delete_attempt >= 12 and v_asset.status = 'delete_pending'
        then 'cleanup_exhausted'
      when v_asset.post_delete_verification_attempts >= 3
        and v_asset.status = 'deleted'
        then 'post_delete_verification_exhausted'
      else 'cleanup_failed' end,p_delete_attempt,
    v_error,null,'failed'
  );
  return true;
end;
$$;

-- Maintenance boundaries are service-only. Private helpers remain unavailable
-- even to service_role over PostgREST and are reachable only by definer code.
revoke all on function private.guard_ready_media_asset_identity()
  from public,anon,authenticated,service_role;
revoke all on function private.guard_ready_video_asset_identity()
  from public,anon,authenticated,service_role;
revoke all on function private.guard_media_asset_link_lifecycle_v1()
  from public,anon,authenticated,service_role;
revoke all on function private.guard_video_asset_link_lifecycle_v1()
  from public,anon,authenticated,service_role;
revoke all on function private.schedule_video_asset_deletion_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.schedule_creator_premium_video_deletion_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.record_media_lifecycle_audit_v1(uuid,text,text,text,integer,text,text,text)
  from public,anon,authenticated,service_role;

revoke all on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  to service_role;

revoke all on function public.schedule_media_asset_deletion(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.schedule_media_asset_deletion(uuid,uuid)
  to service_role;
revoke all on function public.finalize_media_asset_deletion(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.finalize_media_asset_deletion(uuid,uuid)
  to service_role;

revoke all on function public.schedule_video_asset_deletion_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.schedule_video_asset_deletion_v1(uuid,uuid)
  to service_role;
revoke all on function public.schedule_creator_premium_video_deletion_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.schedule_creator_premium_video_deletion_v1(uuid,uuid)
  to service_role;

revoke all on function public.cleanup_stale_media_upload_records(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.cleanup_stale_media_upload_records(integer)
  to service_role;
revoke all on function public.cleanup_stale_creator_premium_video_records(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.cleanup_stale_creator_premium_video_records(integer)
  to service_role;

revoke all on function public.record_media_asset_provider_delete_v1(uuid,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function public.record_media_asset_provider_delete_v1(uuid,integer,text,text,text)
  to service_role;
revoke all on function public.record_creator_premium_video_provider_delete_v1(uuid,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function public.record_creator_premium_video_provider_delete_v1(uuid,integer,text,text,text)
  to service_role;

revoke all on function public.finalize_media_asset_cleanup_v1(uuid,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_media_asset_cleanup_v1(uuid,integer,text,text,text,text)
  to service_role;
revoke all on function public.record_media_asset_cleanup_failure_v1(uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.record_media_asset_cleanup_failure_v1(uuid,integer,text)
  to service_role;
revoke all on function public.finalize_creator_premium_video_cleanup_v1(uuid,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_creator_premium_video_cleanup_v1(uuid,integer,text,text,text,text)
  to service_role;
revoke all on function public.record_creator_premium_video_cleanup_failure_v1(uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.record_creator_premium_video_cleanup_failure_v1(uuid,integer,text)
  to service_role;

comment on function public.schedule_video_asset_deletion_v1(uuid,uuid) is
  'Service-only canonical Stream deletion scheduler. Row locking serializes bind versus delete; provider mutation is delegated to cleanup.';
comment on function public.cleanup_stale_media_upload_records(integer) is
  'Claims only explicitly C1-enrolled R2 rows and returns a monotonic attempt fence plus delete/verify_absence operation.';
comment on function public.cleanup_stale_creator_premium_video_records(integer) is
  'Claims C1 Stream tombstones; automatic abandonment remains Creator Premium-only while explicit generic deletes are supported.';
comment on function public.record_media_asset_provider_delete_v1(uuid,integer,text,text,text) is
  'Persists a sanitized R2 DELETE acknowledgement immediately under the active cleanup attempt fence, before absence verification.';
comment on function public.record_creator_premium_video_provider_delete_v1(uuid,integer,text,text,text) is
  'Persists a sanitized Stream DELETE acknowledgement immediately under the active cleanup attempt fence, before absence verification.';
comment on function public.finalize_media_asset_cleanup_v1(uuid,integer,text,text,text,text) is
  'Fenced R2 cleanup authority. It records independent absence evidence and confirms a tombstone only after the signed-PUT safety window.';
comment on function public.finalize_creator_premium_video_cleanup_v1(uuid,integer,text,text,text,text) is
  'Fenced Stream cleanup authority. It records provider DELETE and independent absence evidence while handling explicitly C1-enrolled Stream purposes.';

notify pgrst,'reload schema';

commit;
