begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_campaigns') is null
    or pg_catalog.to_regclass('private.advertising_ad_sets') is null
    or pg_catalog.to_regclass('private.advertising_destinations') is null
    or pg_catalog.to_regclass('private.ad_accounts') is null then
    raise exception 'ads_v2_c_foundation_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_creatives') is not null
    or pg_catalog.to_regclass('private.advertising_creative_versions') is not null
    or pg_catalog.to_regclass('private.advertising_ads') is not null
    or pg_catalog.to_regclass('private.advertising_ad_review_events') is not null then
    raise exception 'ads_v2_d_authority_conflict';
  end if;
  if not exists (
    select 1 from private.admin_capabilities
    where capability_code = 'content.items.read'
  ) or not exists (
    select 1 from private.admin_capabilities
    where capability_code = 'content.items.moderate'
  ) then
    raise exception 'ads_v2_d_admin_capability_required';
  end if;
end;
$$;

create table private.advertising_creatives (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references private.ad_accounts(id),
  name text not null,
  status text not null default 'draft',
  created_by uuid not null references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertising_creatives_name_chk check (
    name = btrim(name) and char_length(name) between 2 and 120
  ),
  constraint advertising_creatives_status_chk check (status in ('draft', 'archived')),
  constraint advertising_creatives_archive_state_chk check (
    (status = 'draft' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint advertising_creatives_ad_account_idempotency_key
    unique (ad_account_id, creation_idempotency_key)
);

create index advertising_creatives_ad_account_created_idx
  on private.advertising_creatives(ad_account_id, created_at desc, id desc);
create index advertising_creatives_created_by_idx
  on private.advertising_creatives(created_by);

create table private.advertising_creative_versions (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references private.advertising_creatives(id),
  version_number integer not null check (version_number > 0),
  format text not null check (format in ('image', 'video')),
  media_asset_id uuid references public.media_assets(id),
  video_asset_id uuid references public.video_assets(id),
  primary_text text check (
    primary_text is null
    or (primary_text = btrim(primary_text) and char_length(primary_text) between 1 and 2200)
  ),
  headline text check (
    headline is null
    or (headline = btrim(headline) and char_length(headline) between 1 and 255)
  ),
  description text check (
    description is null
    or (description = btrim(description) and char_length(description) between 1 and 500)
  ),
  call_to_action text not null default 'learn_more' check (call_to_action in (
    'learn_more', 'shop_now', 'sign_up', 'contact_us', 'send_message',
    'download', 'visit_profile', 'none'
  )),
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  constraint advertising_creative_versions_media_xor_chk check (
    (format = 'image' and media_asset_id is not null and video_asset_id is null)
    or (format = 'video' and media_asset_id is null and video_asset_id is not null)
  ),
  constraint advertising_creative_versions_number_unique unique (creative_id, version_number)
);

create index advertising_creative_versions_media_asset_idx
  on private.advertising_creative_versions(media_asset_id) where media_asset_id is not null;
create index advertising_creative_versions_video_asset_idx
  on private.advertising_creative_versions(video_asset_id) where video_asset_id is not null;
create index advertising_creative_versions_created_by_idx
  on private.advertising_creative_versions(created_by);

create table private.advertising_ads (
  id uuid primary key default gen_random_uuid(),
  ad_set_id uuid not null references private.advertising_ad_sets(id),
  creative_version_id uuid not null references private.advertising_creative_versions(id),
  destination_id uuid not null references private.advertising_destinations(id),
  name text not null,
  status text not null default 'draft',
  review_status text not null default 'not_submitted',
  submission_fingerprint text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_by uuid not null references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertising_ads_name_chk check (
    name = btrim(name) and char_length(name) between 2 and 120
  ),
  constraint advertising_ads_status_chk check (status in ('draft', 'archived')),
  constraint advertising_ads_review_status_chk check (
    review_status in ('not_submitted', 'pending', 'approved', 'rejected')
  ),
  constraint advertising_ads_archive_state_chk check (
    (status = 'draft' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint advertising_ads_review_state_chk check (
    (review_status = 'not_submitted'
      and submission_fingerprint is null and submitted_at is null and reviewed_at is null)
    or (review_status = 'pending'
      and submission_fingerprint ~ '^[0-9a-f]{64}$'
      and submitted_at is not null and reviewed_at is null)
    or (review_status in ('approved', 'rejected')
      and submission_fingerprint ~ '^[0-9a-f]{64}$'
      and submitted_at is not null and reviewed_at is not null)
  ),
  constraint advertising_ads_ad_set_idempotency_key
    unique (ad_set_id, creation_idempotency_key)
);

create index advertising_ads_ad_set_created_idx
  on private.advertising_ads(ad_set_id, created_at desc, id desc);
create index advertising_ads_creative_version_idx
  on private.advertising_ads(creative_version_id);
create index advertising_ads_destination_idx
  on private.advertising_ads(destination_id);
create index advertising_ads_review_queue_idx
  on private.advertising_ads(review_status, submitted_at, id)
  where review_status in ('pending', 'rejected');
create index advertising_ads_created_by_idx
  on private.advertising_ads(created_by);

create table private.advertising_ad_review_events (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references private.advertising_ads(id),
  event_type text not null check (event_type in ('submitted', 'approved', 'rejected')),
  actor_user_id uuid not null references public.user_profiles(id),
  submission_fingerprint text not null check (submission_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_code text check (reason_code is null or reason_code in (
    'policy_violation', 'misleading', 'unsafe_destination', 'prohibited_content',
    'restricted_content', 'media_invalid', 'copy_invalid', 'other'
  )),
  note text check (note is null or char_length(note) between 1 and 2000),
  note_is_internal boolean not null default true,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint advertising_ad_review_events_reason_chk check (
    (event_type = 'submitted' and reason_code is null and note is null)
    or (event_type = 'approved' and reason_code is null)
    or (event_type = 'rejected' and reason_code is not null)
  ),
  constraint advertising_ad_review_events_other_note_chk check (
    reason_code is distinct from 'other' or note is not null
  ),
  constraint advertising_ad_review_events_idempotency_unique unique (ad_id, idempotency_key)
);

create index advertising_ad_review_events_ad_created_idx
  on private.advertising_ad_review_events(ad_id, created_at desc, id desc);
create index advertising_ad_review_events_actor_idx
  on private.advertising_ad_review_events(actor_user_id);

alter table private.advertising_creatives enable row level security;
alter table private.advertising_creatives force row level security;
alter table private.advertising_creative_versions enable row level security;
alter table private.advertising_creative_versions force row level security;
alter table private.advertising_ads enable row level security;
alter table private.advertising_ads force row level security;
alter table private.advertising_ad_review_events enable row level security;
alter table private.advertising_ad_review_events force row level security;

create policy advertising_creatives_deny_clients
  on private.advertising_creatives for all to anon, authenticated
  using (false) with check (false);
create policy advertising_creative_versions_deny_clients
  on private.advertising_creative_versions for all to anon, authenticated
  using (false) with check (false);
create policy advertising_ads_deny_clients
  on private.advertising_ads for all to anon, authenticated
  using (false) with check (false);
create policy advertising_ad_review_events_deny_clients
  on private.advertising_ad_review_events for all to anon, authenticated
  using (false) with check (false);

revoke all on table private.advertising_creatives from public, anon, authenticated;
revoke all on table private.advertising_creative_versions from public, anon, authenticated;
revoke all on table private.advertising_ads from public, anon, authenticated;
revoke all on table private.advertising_ad_review_events from public, anon, authenticated;

create or replace function private.ads_content_fingerprint(
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'format', p_format,
        'media_asset_id', p_media_asset_id,
        'video_asset_id', p_video_asset_id,
        'primary_text', p_primary_text,
        'headline', p_headline,
        'description', p_description,
        'call_to_action', p_call_to_action
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.ads_validate_creative_payload(
  p_actor uuid,
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_copy text := concat_ws(' ', p_primary_text, p_headline, p_description);
begin
  if p_actor is null or p_format not in ('image', 'video') then
    raise exception using errcode = '22023', message = 'advertising_creative_payload_invalid';
  end if;
  if p_call_to_action is null or p_call_to_action not in (
    'learn_more', 'shop_now', 'sign_up', 'contact_us', 'send_message',
    'download', 'visit_profile', 'none'
  ) then
    raise exception using errcode = '22023', message = 'advertising_creative_call_to_action_invalid';
  end if;
  if (p_primary_text is not null and (
      p_primary_text <> btrim(p_primary_text) or char_length(p_primary_text) not between 1 and 2200
    )) or (p_headline is not null and (
      p_headline <> btrim(p_headline) or char_length(p_headline) not between 1 and 255
    )) or (p_description is not null and (
      p_description <> btrim(p_description) or char_length(p_description) not between 1 and 500
    )) then
    raise exception using errcode = '22023', message = 'advertising_creative_copy_invalid';
  end if;
  if v_copy ~* '<[[:space:]]*(script|iframe|object|embed|form|input|button|style|link|meta)([[:space:]>])'
    or v_copy ~* 'javascript[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'advertising_creative_active_content_denied';
  end if;

  if p_format = 'image' then
    if p_media_asset_id is null or p_video_asset_id is not null then
      raise exception using errcode = '22023', message = 'advertising_creative_image_asset_invalid';
    end if;
    perform 1
    from public.media_assets
    where id = p_media_asset_id
      and owner_id = p_actor
      and provider = 'r2'
      and media_kind = 'image'
      and purpose = 'business_library'
      and status = 'ready'
      and deleted_at is null;
    if not found then
      raise exception using errcode = '42501', message = 'advertising_creative_image_asset_unavailable';
    end if;
  else
    if p_video_asset_id is null or p_media_asset_id is not null then
      raise exception using errcode = '22023', message = 'advertising_creative_video_asset_invalid';
    end if;
    perform 1
    from public.video_assets
    where id = p_video_asset_id
      and owner_id = p_actor
      and provider = 'cloudflare_stream'
      and purpose = 'business_library'
      and status = 'ready'
      and deleted_at is null;
    if not found then
      raise exception using errcode = '42501', message = 'advertising_creative_video_asset_unavailable';
    end if;
  end if;

  return private.ads_content_fingerprint(
    p_format, p_media_asset_id, p_video_asset_id, p_primary_text,
    p_headline, p_description, p_call_to_action
  );
end;
$$;

create or replace function private.advertising_creative_versions_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'advertising_creative_version_immutable';
end;
$$;

create trigger advertising_creative_versions_immutable
before update or delete on private.advertising_creative_versions
for each row execute function private.advertising_creative_versions_immutable();

create or replace function private.advertising_ad_review_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'advertising_ad_review_event_immutable';
end;
$$;

create trigger advertising_ad_review_events_immutable
before update or delete on private.advertising_ad_review_events
for each row execute function private.advertising_ad_review_events_immutable();

create or replace function private.advertising_ads_same_authority_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_destination_campaign_id uuid;
  v_campaign_ad_account_id uuid;
  v_creative_ad_account_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.ad_set_id is distinct from old.ad_set_id
    or new.creative_version_id is distinct from old.creative_version_id
    or new.destination_id is distinct from old.destination_id
    or new.created_by is distinct from old.created_by
    or new.creation_idempotency_key is distinct from old.creation_idempotency_key
    or new.created_at is distinct from old.created_at
    or new.submission_fingerprint is distinct from old.submission_fingerprint
      and old.review_status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'advertising_ad_reviewed_assembly_immutable';
  end if;

  select ad_set.campaign_id, campaign.ad_account_id
  into v_campaign_id, v_campaign_ad_account_id
  from private.advertising_ad_sets as ad_set
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  where ad_set.id = new.ad_set_id;

  select destination.campaign_id
  into v_destination_campaign_id
  from private.advertising_destinations as destination
  where destination.id = new.destination_id;

  select creative.ad_account_id
  into v_creative_ad_account_id
  from private.advertising_creative_versions as version
  join private.advertising_creatives as creative on creative.id = version.creative_id
  where version.id = new.creative_version_id;

  if v_campaign_id is null
    or v_destination_campaign_id is distinct from v_campaign_id
    or v_creative_ad_account_id is distinct from v_campaign_ad_account_id then
    raise exception using errcode = '23514', message = 'advertising_ad_same_authority_invalid';
  end if;
  return new;
end;
$$;

create trigger advertising_ads_same_authority
before insert or update on private.advertising_ads
for each row execute function private.advertising_ads_same_authority_guard();

create trigger advertising_creatives_touch_updated_at
before update on private.advertising_creatives
for each row execute function private.advertising_touch_updated_at();

create trigger advertising_ads_touch_updated_at
before update on private.advertising_ads
for each row execute function private.advertising_touch_updated_at();

create or replace function private.ads_creative_result(p_creative_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', creative.id,
    'ad_account_id', creative.ad_account_id,
    'name', creative.name,
    'status', creative.status,
    'created_at', creative.created_at,
    'updated_at', creative.updated_at,
    'versions', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', version.id,
        'version_number', version.version_number,
        'format', version.format,
        'media_asset_id', version.media_asset_id,
        'video_asset_id', version.video_asset_id,
        'primary_text', version.primary_text,
        'headline', version.headline,
        'description', version.description,
        'call_to_action', version.call_to_action,
        'content_fingerprint', version.content_fingerprint,
        'created_at', version.created_at
      ) order by version.version_number), '[]'::jsonb)
      from private.advertising_creative_versions as version
      where version.creative_id = creative.id
    )
  )
  from private.advertising_creatives as creative
  where creative.id = p_creative_id;
$$;

create or replace function private.ads_ad_result(p_ad_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', ad.id,
    'ad_set_id', ad.ad_set_id,
    'creative_version_id', ad.creative_version_id,
    'destination_id', ad.destination_id,
    'name', ad.name,
    'status', ad.status,
    'review_status', ad.review_status,
    'submission_fingerprint', ad.submission_fingerprint,
    'submitted_at', ad.submitted_at,
    'reviewed_at', ad.reviewed_at,
    'created_at', ad.created_at,
    'updated_at', ad.updated_at
  )
  from private.advertising_ads as ad
  where ad.id = p_ad_id;
$$;

create or replace function private.ads_ad_submission_fingerprint(p_ad_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'ad_id', ad.id,
        'campaign_id', campaign.id,
        'objective', campaign.objective,
        'ad_set_id', ad_set.id,
        'creative_version_id', version.id,
        'creative_content_fingerprint', version.content_fingerprint,
        'destination_id', destination.id,
        'destination_type', destination.destination_type,
        'destination_target', pg_catalog.jsonb_build_object(
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id
        )
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
  from private.advertising_ads as ad
  join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.advertising_creative_versions as version on version.id = ad.creative_version_id
  join private.advertising_destinations as destination on destination.id = ad.destination_id
  where ad.id = p_ad_id;
$$;

create or replace function public.create_my_advertising_creative(
  p_ad_account_id uuid,
  p_name text,
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_format text := lower(btrim(p_format));
  v_call_to_action text := lower(btrim(p_call_to_action));
  v_fingerprint text;
  v_creative private.advertising_creatives;
  v_version private.advertising_creative_versions;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_ad_account_id is null or p_idempotency_key is null
    or v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'advertising_creative_input_invalid';
  end if;

  perform 1
  from private.ad_accounts as account
  join private.business_accounts as business on business.id = account.business_account_id
  where account.id = p_ad_account_id
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor
  for key share of account, business;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_account_access_denied';
  end if;

  v_fingerprint := private.ads_validate_creative_payload(
    v_actor, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action
  );

  insert into private.advertising_creatives(
    ad_account_id, name, status, created_by, creation_idempotency_key
  ) values (
    p_ad_account_id, v_name, 'draft', v_actor, p_idempotency_key
  )
  on conflict (ad_account_id, creation_idempotency_key) do nothing
  returning * into v_creative;

  if v_creative.id is null then
    select * into v_creative
    from private.advertising_creatives
    where ad_account_id = p_ad_account_id
      and creation_idempotency_key = p_idempotency_key;
    select * into v_version
    from private.advertising_creative_versions
    where creative_id = v_creative.id and version_number = 1;
    if v_creative.name is distinct from v_name
      or v_creative.created_by is distinct from v_actor
      or v_version.content_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_creative_idempotency_conflict';
    end if;
    return private.ads_creative_result(v_creative.id);
  end if;

  insert into private.advertising_creative_versions(
    creative_id, version_number, format, media_asset_id, video_asset_id,
    primary_text, headline, description, call_to_action,
    content_fingerprint, created_by
  ) values (
    v_creative.id, 1, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action,
    v_fingerprint, v_actor
  );
  return private.ads_creative_result(v_creative.id);
end;
$$;

create or replace function public.create_my_advertising_creative_version(
  p_creative_id uuid,
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_format text := lower(btrim(p_format));
  v_call_to_action text := lower(btrim(p_call_to_action));
  v_creative private.advertising_creatives;
  v_fingerprint text;
  v_version_number integer;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;

  select creative.* into v_creative
  from private.advertising_creatives as creative
  join private.ad_accounts as account on account.id = creative.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  where creative.id = p_creative_id
    and creative.status = 'draft'
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor
  for update of creative;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_creative_access_denied';
  end if;

  v_fingerprint := private.ads_validate_creative_payload(
    v_actor, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action
  );
  select coalesce(max(version_number), 0) + 1 into v_version_number
  from private.advertising_creative_versions
  where creative_id = p_creative_id;

  insert into private.advertising_creative_versions(
    creative_id, version_number, format, media_asset_id, video_asset_id,
    primary_text, headline, description, call_to_action,
    content_fingerprint, created_by
  ) values (
    p_creative_id, v_version_number, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action,
    v_fingerprint, v_actor
  );
  return private.ads_creative_result(p_creative_id);
end;
$$;

create or replace function public.create_my_advertising_ad_draft(
  p_ad_set_id uuid,
  p_creative_version_id uuid,
  p_destination_id uuid,
  p_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_campaign_id uuid;
  v_ad_account_id uuid;
  v_destination_campaign_id uuid;
  v_creative_ad_account_id uuid;
  v_ad private.advertising_ads;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_ad_set_id is null or p_creative_version_id is null or p_destination_id is null
    or p_idempotency_key is null or v_name is null
    or char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'advertising_ad_input_invalid';
  end if;

  select ad_set.campaign_id into v_campaign_id
  from private.advertising_ad_sets as ad_set
  where ad_set.id = p_ad_set_id and ad_set.status = 'draft'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_set_draft_access_denied';
  end if;
  select owned.ad_account_id into v_ad_account_id
  from private.ads_require_owned_draft_campaign(v_actor, v_campaign_id) as owned;

  select destination.campaign_id into v_destination_campaign_id
  from private.advertising_destinations as destination
  where destination.id = p_destination_id and destination.status = 'draft'
  for key share;

  select creative.ad_account_id into v_creative_ad_account_id
  from private.advertising_creative_versions as version
  join private.advertising_creatives as creative on creative.id = version.creative_id
  where version.id = p_creative_version_id and creative.status = 'draft'
  for key share of version, creative;

  if v_destination_campaign_id is distinct from v_campaign_id
    or v_creative_ad_account_id is distinct from v_ad_account_id then
    raise exception using errcode = '42501', message = 'advertising_ad_same_authority_invalid';
  end if;

  insert into private.advertising_ads(
    ad_set_id, creative_version_id, destination_id, name, status,
    review_status, created_by, creation_idempotency_key
  ) values (
    p_ad_set_id, p_creative_version_id, p_destination_id, v_name, 'draft',
    'not_submitted', v_actor, p_idempotency_key
  )
  on conflict (ad_set_id, creation_idempotency_key) do nothing
  returning * into v_ad;

  if v_ad.id is null then
    select * into v_ad from private.advertising_ads
    where ad_set_id = p_ad_set_id and creation_idempotency_key = p_idempotency_key;
    if v_ad.creative_version_id is distinct from p_creative_version_id
      or v_ad.destination_id is distinct from p_destination_id
      or v_ad.name is distinct from v_name
      or v_ad.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_ad_idempotency_conflict';
    end if;
  end if;
  return private.ads_ad_result(v_ad.id);
end;
$$;

create or replace function public.submit_my_advertising_ad_for_review(
  p_ad_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ad private.advertising_ads;
  v_version private.advertising_creative_versions;
  v_event private.advertising_ad_review_events;
  v_validated_content_fingerprint text;
  v_submission_fingerprint text;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if p_ad_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_ad_submission_input_invalid';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;

  select * into v_ad from private.advertising_ads where id = p_ad_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'advertising_ad_not_found';
  end if;

  perform 1
  from private.advertising_ads as ad
  join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  join private.advertising_destinations as destination on destination.id = ad.destination_id
  join private.advertising_creative_versions as version on version.id = ad.creative_version_id
  join private.advertising_creatives as creative on creative.id = version.creative_id
  where ad.id = p_ad_id
    and ad.status = 'draft'
    and ad_set.status = 'draft'
    and campaign.status = 'draft'
    and destination.status = 'draft'
    and destination.campaign_id = campaign.id
    and creative.status = 'draft'
    and creative.ad_account_id = campaign.ad_account_id
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_submission_access_denied';
  end if;

  select * into v_event
  from private.advertising_ad_review_events
  where ad_id = p_ad_id and idempotency_key = p_idempotency_key;
  if found then
    if v_event.event_type <> 'submitted'
      or v_event.actor_user_id <> v_actor
      or v_event.submission_fingerprint is distinct from v_ad.submission_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_ad_submission_idempotency_conflict';
    end if;
    return private.ads_ad_result(p_ad_id);
  end if;

  if v_ad.review_status = 'approved' then
    raise exception using errcode = '55000', message = 'advertising_ad_already_approved';
  end if;
  if v_ad.review_status = 'pending' then
    return private.ads_ad_result(p_ad_id);
  end if;

  select * into v_version
  from private.advertising_creative_versions
  where id = v_ad.creative_version_id;
  v_validated_content_fingerprint := private.ads_validate_creative_payload(
    v_version.created_by, v_version.format, v_version.media_asset_id,
    v_version.video_asset_id, v_version.primary_text, v_version.headline,
    v_version.description, v_version.call_to_action
  );
  if v_validated_content_fingerprint is distinct from v_version.content_fingerprint then
    raise exception using errcode = '55000', message = 'advertising_creative_content_changed';
  end if;

  v_submission_fingerprint := private.ads_ad_submission_fingerprint(p_ad_id);
  if v_submission_fingerprint is null then
    raise exception using errcode = '55000', message = 'advertising_ad_submission_fingerprint_failed';
  end if;

  update private.advertising_ads
  set review_status = 'pending', submission_fingerprint = v_submission_fingerprint,
      submitted_at = clock_timestamp(), reviewed_at = null
  where id = p_ad_id;

  insert into private.advertising_ad_review_events(
    ad_id, event_type, actor_user_id, submission_fingerprint,
    reason_code, note, note_is_internal, idempotency_key
  ) values (
    p_ad_id, 'submitted', v_actor, v_submission_fingerprint,
    null, null, true, p_idempotency_key
  );
  return private.ads_ad_result(p_ad_id);
end;
$$;

create or replace function public.admin_review_advertising_ad(
  p_ad_id uuid,
  p_action text,
  p_reason_code text,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text := lower(btrim(p_action));
  v_reason_code text := case when p_reason_code is null then null else lower(btrim(p_reason_code)) end;
  v_note text := case when p_note is null then null else btrim(p_note) end;
  v_ad private.advertising_ads;
  v_version private.advertising_creative_versions;
  v_event private.advertising_ad_review_events;
  v_current_fingerprint text;
  v_validated_content_fingerprint text;
begin
  v_actor := public.admin_require_capability('content.items.moderate');
  if p_ad_id is null or p_idempotency_key is null
    or v_action not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'advertising_ad_review_input_invalid';
  end if;
  if v_note is not null and char_length(v_note) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'advertising_ad_review_note_invalid';
  end if;
  if v_action = 'reject' then
    if v_reason_code is null or v_reason_code not in (
      'policy_violation', 'misleading', 'unsafe_destination', 'prohibited_content',
      'restricted_content', 'media_invalid', 'copy_invalid', 'other'
    ) then
      raise exception using errcode = '22023', message = 'advertising_ad_review_reason_invalid';
    end if;
    if v_reason_code = 'other' and v_note is null then
      raise exception using errcode = '22023', message = 'advertising_ad_review_other_note_required';
    end if;
  elsif v_reason_code is not null then
    raise exception using errcode = '22023', message = 'advertising_ad_approval_reason_not_allowed';
  end if;

  select * into v_ad from private.advertising_ads where id = p_ad_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'advertising_ad_not_found';
  end if;

  select * into v_event
  from private.advertising_ad_review_events
  where ad_id = p_ad_id and idempotency_key = p_idempotency_key;
  if found then
    if v_event.event_type is distinct from
      (case when v_action = 'approve' then 'approved' else 'rejected' end)
      or v_event.actor_user_id is distinct from v_actor
      or v_event.reason_code is distinct from v_reason_code
      or v_event.note is distinct from v_note
      or v_event.submission_fingerprint is distinct from v_ad.submission_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_ad_review_idempotency_conflict';
    end if;
    return private.ads_ad_result(p_ad_id);
  end if;

  if v_ad.review_status <> 'pending' then
    raise exception using errcode = '55000', message = 'advertising_ad_not_pending';
  end if;
  perform 1
  from private.advertising_ads as ad
  join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  join private.advertising_destinations as destination on destination.id = ad.destination_id
  join private.advertising_creative_versions as version on version.id = ad.creative_version_id
  join private.advertising_creatives as creative on creative.id = version.creative_id
  where ad.id = p_ad_id
    and ad.status = 'draft'
    and ad_set.status = 'draft'
    and campaign.status = 'draft'
    and destination.status = 'draft'
    and destination.campaign_id = campaign.id
    and creative.status = 'draft'
    and creative.ad_account_id = campaign.ad_account_id
    and account.status = 'active'
    and business.status = 'active';
  if not found then
    raise exception using errcode = '55000', message = 'advertising_ad_review_context_invalid';
  end if;
  v_current_fingerprint := private.ads_ad_submission_fingerprint(p_ad_id);
  if v_current_fingerprint is null
    or v_current_fingerprint is distinct from v_ad.submission_fingerprint then
    raise exception using errcode = '55000', message = 'advertising_ad_submission_changed';
  end if;

  select * into v_version
  from private.advertising_creative_versions
  where id = v_ad.creative_version_id;
  v_validated_content_fingerprint := private.ads_validate_creative_payload(
    v_version.created_by, v_version.format, v_version.media_asset_id,
    v_version.video_asset_id, v_version.primary_text, v_version.headline,
    v_version.description, v_version.call_to_action
  );
  if v_validated_content_fingerprint is distinct from v_version.content_fingerprint then
    raise exception using errcode = '55000', message = 'advertising_creative_content_changed';
  end if;

  update private.advertising_ads
  set review_status = case when v_action = 'approve' then 'approved' else 'rejected' end,
      reviewed_at = clock_timestamp()
  where id = p_ad_id;

  insert into private.advertising_ad_review_events(
    ad_id, event_type, actor_user_id, submission_fingerprint,
    reason_code, note, note_is_internal, idempotency_key
  ) values (
    p_ad_id,
    case when v_action = 'approve' then 'approved' else 'rejected' end,
    v_actor, v_current_fingerprint, v_reason_code, v_note, true, p_idempotency_key
  );
  return private.ads_ad_result(p_ad_id);
end;
$$;

create or replace function public.search_admin_advertising_ads(
  p_review_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform public.admin_require_capability('content.items.read');
  if p_review_status is not null
    and p_review_status not in ('not_submitted', 'pending', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'advertising_ad_review_status_invalid';
  end if;

  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(item.payload order by item.submitted_at asc nulls last, item.id)
    from (
      select ad.id, ad.submitted_at, pg_catalog.jsonb_build_object(
        'id', ad.id,
        'name', ad.name,
        'status', ad.status,
        'review_status', ad.review_status,
        'submission_fingerprint', ad.submission_fingerprint,
        'submitted_at', ad.submitted_at,
        'reviewed_at', ad.reviewed_at,
        'campaign', pg_catalog.jsonb_build_object(
          'id', campaign.id, 'name', campaign.name, 'objective', campaign.objective
        ),
        'ad_set', pg_catalog.jsonb_build_object('id', ad_set.id, 'name', ad_set.name),
        'business_account_id', business.id,
        'ad_account_id', account.id,
        'creative', pg_catalog.jsonb_build_object(
          'creative_id', creative.id,
          'creative_version_id', version.id,
          'version_number', version.version_number,
          'format', version.format,
          'media_asset_id', version.media_asset_id,
          'video_asset_id', version.video_asset_id,
          'primary_text', version.primary_text,
          'headline', version.headline,
          'description', version.description,
          'call_to_action', version.call_to_action,
          'media_status', coalesce(media.status, video.status),
          'media_mime_type', coalesce(media.mime_type, video.mime_type)
        ),
        'destination', pg_catalog.jsonb_build_object(
          'id', destination.id,
          'destination_type', destination.destination_type,
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id
        ),
        'latest_decision', case when latest.event_type in ('approved', 'rejected') then
          pg_catalog.jsonb_build_object(
            'event_type', latest.event_type,
            'reason_code', latest.reason_code,
            'note', latest.note,
            'actor_user_id', latest.actor_user_id,
            'created_at', latest.created_at
          ) else null end
      ) payload
      from private.advertising_ads as ad
      join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
      join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
      join private.ad_accounts as account on account.id = campaign.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      join private.advertising_creative_versions as version on version.id = ad.creative_version_id
      join private.advertising_creatives as creative on creative.id = version.creative_id
      join private.advertising_destinations as destination on destination.id = ad.destination_id
      left join public.media_assets as media on media.id = version.media_asset_id
      left join public.video_assets as video on video.id = version.video_asset_id
      left join lateral (
        select event.* from private.advertising_ad_review_events as event
        where event.ad_id = ad.id
        order by event.created_at desc, event.id desc limit 1
      ) as latest on true
      where p_review_status is null or ad.review_status = p_review_status
      order by ad.submitted_at asc nulls last, ad.id
      limit v_limit
    ) as item
  ), '[]'::jsonb));
end;
$$;

create or replace function public.get_my_advertising_creative_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;

  return pg_catalog.jsonb_build_object(
    'creatives', coalesce((
      select pg_catalog.jsonb_agg(private.ads_creative_result(creative.id)
        order by creative.created_at desc, creative.id desc)
      from private.advertising_creatives as creative
      join private.ad_accounts as account on account.id = creative.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      where business.owner_user_id = v_actor
    ), '[]'::jsonb),
    'ads', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ad.id,
        'name', ad.name,
        'campaign_id', campaign.id,
        'ad_set_id', ad.ad_set_id,
        'creative_version_id', ad.creative_version_id,
        'destination_id', ad.destination_id,
        'status', ad.status,
        'review_status', ad.review_status,
        'submitted_at', ad.submitted_at,
        'reviewed_at', ad.reviewed_at,
        'latest_rejection_reason_code', rejection.reason_code,
        'latest_rejection_message', case rejection.reason_code
          when 'policy_violation' then 'The ad does not meet advertising policy.'
          when 'misleading' then 'The ad may be misleading.'
          when 'unsafe_destination' then 'The destination could not be approved.'
          when 'prohibited_content' then 'The ad contains prohibited content.'
          when 'restricted_content' then 'The ad contains restricted content.'
          when 'media_invalid' then 'The ad media could not be approved.'
          when 'copy_invalid' then 'The ad copy could not be approved.'
          when 'other' then 'The ad requires changes before it can be approved.'
          else null
        end,
        'created_at', ad.created_at,
        'updated_at', ad.updated_at
      ) order by ad.created_at desc, ad.id desc)
      from private.advertising_ads as ad
      join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
      join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
      join private.ad_accounts as account on account.id = campaign.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      left join lateral (
        select event.reason_code
        from private.advertising_ad_review_events as event
        where event.ad_id = ad.id and event.event_type = 'rejected'
        order by event.created_at desc, event.id desc limit 1
      ) as rejection on true
      where business.owner_user_id = v_actor
    ), '[]'::jsonb)
  );
end;
$$;

comment on table private.advertising_creatives is
  'Canonical logical Ads V2 creative containers. Content lives only in immutable versions.';
comment on table private.advertising_creative_versions is
  'Immutable Ads V2 creative payload versions referencing canonical Business Media assets.';
comment on table private.advertising_ads is
  'Draft Ads V2 assemblies binding one Ad Set, immutable Creative Version, and Destination.';
comment on table private.advertising_ad_review_events is
  'Append-only Ads V2 human moderation submission and decision history.';

revoke all on function private.ads_content_fingerprint(text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.ads_validate_creative_payload(uuid, text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.advertising_creative_versions_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.advertising_ad_review_events_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.advertising_ads_same_authority_guard()
  from public, anon, authenticated, service_role;
revoke all on function private.ads_creative_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ads_ad_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ads_ad_submission_fingerprint(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_my_advertising_creative(
  uuid, text, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_my_advertising_ad_draft(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_my_advertising_ad_for_review(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_review_advertising_ad(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.search_admin_advertising_ads(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_advertising_creative_workspace()
  from public, anon, authenticated, service_role;

grant execute on function public.create_my_advertising_creative(
  uuid, text, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text
) to authenticated;
grant execute on function public.create_my_advertising_ad_draft(uuid, uuid, uuid, text, uuid)
  to authenticated;
grant execute on function public.submit_my_advertising_ad_for_review(uuid, uuid)
  to authenticated;
grant execute on function public.admin_review_advertising_ad(uuid, text, text, text, uuid)
  to authenticated;
grant execute on function public.search_admin_advertising_ads(text, integer)
  to authenticated;
grant execute on function public.get_my_advertising_creative_workspace()
  to authenticated;

do $$
begin
  if exists (select 1 from private.advertising_creatives)
    or exists (select 1 from private.advertising_creative_versions)
    or exists (select 1 from private.advertising_ads)
    or exists (select 1 from private.advertising_ad_review_events) then
    raise exception 'ads_v2_d_initial_state_not_empty';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
