begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_audience_versions') is null
    or pg_catalog.to_regclass('private.advertising_ads') is null
    or pg_catalog.to_regclass('private.advertising_ad_sets') is null then
    raise exception 'ads_v2_e_foundation_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_placement_catalog') is not null
    or pg_catalog.to_regclass('private.advertising_delivery_policy') is not null
    or pg_catalog.to_regclass('private.advertising_placement_selections') is not null then
    raise exception 'ads_v2_f_authority_conflict';
  end if;
end;
$$;

create table private.advertising_placement_catalog (
  code text primary key,
  label text not null,
  surface_family text not null,
  status text not null check (status in ('active', 'reserved', 'retired')),
  surface_verified boolean not null,
  legacy_compatible boolean not null,
  selection_enabled boolean not null,
  v2_delivery_enabled boolean not null default false,
  adapter_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_placement_catalog_code_chk check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint advertising_placement_catalog_label_chk check (label = btrim(label) and char_length(label) between 2 and 120),
  constraint advertising_placement_catalog_surface_family_chk check (surface_family = btrim(surface_family) and char_length(surface_family) between 2 and 64),
  constraint advertising_placement_catalog_verified_gate_chk check (surface_verified or (not selection_enabled and not v2_delivery_enabled)),
  constraint advertising_placement_catalog_retired_gate_chk check (status <> 'retired' or (not selection_enabled and not v2_delivery_enabled)),
  constraint advertising_placement_catalog_adapter_gate_chk check (not v2_delivery_enabled or adapter_version is not null)
);

create table private.advertising_delivery_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null check (policy_version ~ '^nelyon-ads-delivery-v[0-9]+$'),
  global_v2_delivery_enabled boolean not null default false,
  require_authenticated_viewer boolean not null default true,
  require_adult_viewer boolean not null default true,
  require_approved_ad boolean not null default true,
  geo_matching_enabled boolean not null default false,
  language_matching_enabled boolean not null default false,
  frequency_enforcement_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_delivery_policy_v1_fail_closed_chk check (
    policy_version <> 'nelyon-ads-delivery-v1'
    or (
      not global_v2_delivery_enabled
      and require_authenticated_viewer
      and require_adult_viewer
      and require_approved_ad
      and not geo_matching_enabled
      and not language_matching_enabled
      and not frequency_enforcement_enabled
    )
  )
);

create table private.advertising_placement_selections (
  id uuid primary key default gen_random_uuid(),
  ad_set_id uuid not null references private.advertising_ad_sets(id),
  status text not null default 'draft' check (status in ('draft', 'archived')),
  created_by uuid not null references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertising_placement_selections_archive_chk check (
    (status = 'draft' and archived_at is null) or (status = 'archived' and archived_at is not null)
  ),
  constraint advertising_placement_selections_ad_set_unique unique (ad_set_id),
  constraint advertising_placement_selections_idempotency_unique unique (ad_set_id, creation_idempotency_key)
);

create index advertising_placement_selections_created_by_idx on private.advertising_placement_selections(created_by);

create table private.advertising_placement_selection_versions (
  id uuid primary key default gen_random_uuid(),
  placement_selection_id uuid not null references private.advertising_placement_selections(id),
  version_number integer not null check (version_number > 0),
  registry_policy_version text not null check (registry_policy_version ~ '^nelyon-ads-delivery-v[0-9]+$'),
  definition_fingerprint text not null check (definition_fingerprint ~ '^[0-9a-f]{64}$'),
  creation_idempotency_key uuid not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  constraint advertising_placement_selection_versions_number_unique unique (placement_selection_id, version_number),
  constraint advertising_placement_selection_versions_idempotency_unique unique (placement_selection_id, creation_idempotency_key)
);

create index advertising_placement_selection_versions_created_by_idx on private.advertising_placement_selection_versions(created_by);

create table private.advertising_placement_selection_items (
  placement_selection_version_id uuid not null references private.advertising_placement_selection_versions(id),
  placement_code text not null references private.advertising_placement_catalog(code),
  created_at timestamptz not null default now(),
  primary key (placement_selection_version_id, placement_code)
);

insert into private.advertising_placement_catalog(
  code, label, surface_family, status, surface_verified, legacy_compatible,
  selection_enabled, v2_delivery_enabled, adapter_version
) values
  ('marketplace_home', 'Marketplace Home', 'marketplace', 'active', true, true, true, false, 'legacy-marketplace-v2'),
  ('marketplace_search', 'Marketplace Search', 'marketplace', 'active', true, true, true, false, null),
  ('social_feed', 'Social Feed', 'social', 'active', true, true, true, false, 'legacy-marketplace-v2'),
  ('stories', 'Stories', 'social', 'active', true, false, true, false, null),
  ('clips', 'Clips', 'social', 'active', true, false, true, false, null),
  ('live', 'LIVE', 'live', 'active', true, false, true, false, null);

insert into private.advertising_delivery_policy(singleton, policy_version)
values (true, 'nelyon-ads-delivery-v1');

create trigger advertising_placement_catalog_touch_updated_at
before update on private.advertising_placement_catalog
for each row execute function private.advertising_touch_updated_at();

create trigger advertising_delivery_policy_touch_updated_at
before update on private.advertising_delivery_policy
for each row execute function private.advertising_touch_updated_at();

create trigger advertising_placement_selections_touch_updated_at
before update on private.advertising_placement_selections
for each row execute function private.advertising_touch_updated_at();

create or replace function private.advertising_placement_selection_definition_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'advertising_placement_selection_definition_immutable';
end;
$$;

create trigger advertising_placement_selection_versions_immutable
before update or delete on private.advertising_placement_selection_versions
for each row execute function private.advertising_placement_selection_definition_immutable();

create trigger advertising_placement_selection_items_immutable
before update or delete on private.advertising_placement_selection_items
for each row execute function private.advertising_placement_selection_definition_immutable();

alter table private.advertising_placement_catalog enable row level security;
alter table private.advertising_placement_catalog force row level security;
alter table private.advertising_delivery_policy enable row level security;
alter table private.advertising_delivery_policy force row level security;
alter table private.advertising_placement_selections enable row level security;
alter table private.advertising_placement_selections force row level security;
alter table private.advertising_placement_selection_versions enable row level security;
alter table private.advertising_placement_selection_versions force row level security;
alter table private.advertising_placement_selection_items enable row level security;
alter table private.advertising_placement_selection_items force row level security;

create policy advertising_placement_catalog_deny_clients on private.advertising_placement_catalog for all to anon, authenticated using (false) with check (false);
create policy advertising_delivery_policy_deny_clients on private.advertising_delivery_policy for all to anon, authenticated using (false) with check (false);
create policy advertising_placement_selections_deny_clients on private.advertising_placement_selections for all to anon, authenticated using (false) with check (false);
create policy advertising_placement_selection_versions_deny_clients on private.advertising_placement_selection_versions for all to anon, authenticated using (false) with check (false);
create policy advertising_placement_selection_items_deny_clients on private.advertising_placement_selection_items for all to anon, authenticated using (false) with check (false);

revoke all on table private.advertising_placement_catalog from public, anon, authenticated;
revoke all on table private.advertising_delivery_policy from public, anon, authenticated;
revoke all on table private.advertising_placement_selections from public, anon, authenticated;
revoke all on table private.advertising_placement_selection_versions from public, anon, authenticated;
revoke all on table private.advertising_placement_selection_items from public, anon, authenticated;

create or replace function private.ads_normalize_placement_codes(p_codes text[])
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_codes text[];
begin
  if p_codes is null or pg_catalog.array_length(p_codes, 1) is null or pg_catalog.array_length(p_codes, 1) > 32 then
    raise exception using errcode = '22023', message = 'advertising_placement_codes_invalid';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_codes) as input(code) where input.code is null or input.code <> btrim(input.code) or input.code !~ '^[a-z][a-z0-9_]{1,63}$') then
    raise exception using errcode = '22023', message = 'advertising_placement_code_invalid';
  end if;
  select pg_catalog.array_agg(normalized.code order by normalized.code) into v_codes
  from (select distinct input.code from pg_catalog.unnest(p_codes) as input(code)) normalized;
  if pg_catalog.cardinality(v_codes) <> pg_catalog.cardinality(p_codes) then
    raise exception using errcode = '22023', message = 'advertising_placement_duplicate_code';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(v_codes) as input(code)
    left join private.advertising_placement_catalog catalog on catalog.code = input.code
    where catalog.code is null or catalog.status <> 'active' or not catalog.surface_verified or not catalog.selection_enabled
  ) then
    raise exception using errcode = '22023', message = 'advertising_placement_unavailable';
  end if;
  return v_codes;
end;
$$;

create or replace function private.ads_placement_fingerprint(p_codes text[], p_policy_version text)
returns text language sql immutable security definer set search_path = '' as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('placements', p_codes, 'policy_version', p_policy_version)::text, 'UTF8'
  ), 'sha256'), 'hex');
$$;

create or replace function private.ads_insert_placement_selection_version(
  p_actor uuid, p_selection_id uuid, p_codes text[], p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_selection private.advertising_placement_selections;
  v_codes text[];
  v_policy_version text;
  v_fingerprint text;
  v_version private.advertising_placement_selection_versions;
  v_next integer;
begin
  if p_actor is null or p_selection_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_placement_selection_input_invalid';
  end if;
  select selection.* into strict v_selection
  from private.advertising_placement_selections selection
  join private.advertising_ad_sets ad_set on ad_set.id = selection.ad_set_id and ad_set.status = 'draft'
  join private.advertising_campaigns campaign on campaign.id = ad_set.campaign_id and campaign.status = 'draft'
  join private.ad_accounts account on account.id = campaign.ad_account_id and account.status = 'active'
  join private.business_accounts business on business.id = account.business_account_id and business.status = 'active'
  where selection.id = p_selection_id and selection.status = 'draft' and business.owner_user_id = p_actor
  for update of selection;
  v_codes := private.ads_normalize_placement_codes(p_codes);
  select policy_version into strict v_policy_version from private.advertising_delivery_policy where singleton = true;
  v_fingerprint := private.ads_placement_fingerprint(v_codes, v_policy_version);
  select * into v_version from private.advertising_placement_selection_versions
  where placement_selection_id = p_selection_id and creation_idempotency_key = p_idempotency_key;
  if found then
    if v_version.created_by <> p_actor or v_version.definition_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_placement_selection_idempotency_conflict';
    end if;
    return v_version.id;
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next from private.advertising_placement_selection_versions where placement_selection_id = p_selection_id;
  insert into private.advertising_placement_selection_versions(
    placement_selection_id, version_number, registry_policy_version, definition_fingerprint, creation_idempotency_key, created_by
  ) values (p_selection_id, v_next, v_policy_version, v_fingerprint, p_idempotency_key, p_actor)
  returning * into v_version;
  insert into private.advertising_placement_selection_items(placement_selection_version_id, placement_code)
  select v_version.id, input.code from pg_catalog.unnest(v_codes) as input(code);
  return v_version.id;
end;
$$;

create or replace function private.ads_placement_selection_result(p_selection_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'placement_selection_id', selection.id,
    'ad_set_id', selection.ad_set_id,
    'status', selection.status,
    'latest_version', case when version.id is null then null else pg_catalog.jsonb_build_object(
      'version_number', version.version_number,
      'registry_policy_version', version.registry_policy_version,
      'definition_fingerprint', version.definition_fingerprint,
      'placements', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'code', catalog.code, 'label', catalog.label, 'surface_family', catalog.surface_family,
          'surface_verified', catalog.surface_verified, 'selection_enabled', catalog.selection_enabled,
          'v2_delivery_enabled', catalog.v2_delivery_enabled
        ) order by catalog.code), '[]'::jsonb)
        from private.advertising_placement_selection_items item
        join private.advertising_placement_catalog catalog on catalog.code = item.placement_code
        where item.placement_selection_version_id = version.id
      )
    ) end,
    'production_delivery_enabled', false
  )
  from private.advertising_placement_selections selection
  left join lateral (
    select candidate.* from private.advertising_placement_selection_versions candidate
    where candidate.placement_selection_id = selection.id order by candidate.version_number desc limit 1
  ) version on true
  where selection.id = p_selection_id;
$$;

create or replace function public.create_my_advertising_placement_selection_draft(
  p_ad_set_id uuid, p_placement_codes text[], p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_campaign uuid; v_selection private.advertising_placement_selections;
begin
  if v_actor is null then raise exception using errcode='28000', message='advertising_auth_required'; end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501', message='advertising_adult_eligibility_required'; end if;
  if p_ad_set_id is null or p_idempotency_key is null then raise exception using errcode='22023', message='advertising_placement_selection_input_invalid'; end if;
  select campaign_id into v_campaign from private.advertising_ad_sets where id=p_ad_set_id and status='draft' for update;
  if not found then raise exception using errcode='42501', message='advertising_ad_set_draft_access_denied'; end if;
  perform 1 from private.ads_require_owned_draft_campaign(v_actor, v_campaign);
  insert into private.advertising_placement_selections(ad_set_id,status,created_by,creation_idempotency_key)
  values(p_ad_set_id,'draft',v_actor,p_idempotency_key) on conflict(ad_set_id) do nothing returning * into v_selection;
  if v_selection.id is null then
    select * into strict v_selection from private.advertising_placement_selections where ad_set_id=p_ad_set_id;
    if v_selection.created_by<>v_actor or v_selection.creation_idempotency_key<>p_idempotency_key then
      raise exception using errcode='23505', message='advertising_placement_selection_idempotency_conflict';
    end if;
  end if;
  perform private.ads_insert_placement_selection_version(v_actor,v_selection.id,p_placement_codes,p_idempotency_key);
  return private.ads_placement_selection_result(v_selection.id);
end;
$$;

create or replace function public.create_my_advertising_placement_selection_version(
  p_placement_selection_id uuid, p_placement_codes text[], p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception using errcode='28000', message='advertising_auth_required'; end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501', message='advertising_adult_eligibility_required'; end if;
  perform private.ads_insert_placement_selection_version(v_actor,p_placement_selection_id,p_placement_codes,p_idempotency_key);
  return private.ads_placement_selection_result(p_placement_selection_id);
end;
$$;

create or replace function public.get_my_advertising_placement_selection(p_placement_selection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception using errcode='28000', message='advertising_auth_required'; end if;
  perform 1 from private.advertising_placement_selections selection
  join private.advertising_ad_sets ad_set on ad_set.id=selection.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where selection.id=p_placement_selection_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501', message='advertising_placement_selection_access_denied'; end if;
  return private.ads_placement_selection_result(p_placement_selection_id);
end;
$$;

create or replace function private.ads_delivery_viewer_is_adult(p_viewer_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists(
    select 1 from private.user_age_eligibility eligibility
    join private.age_eligibility_policy policy on policy.singleton=true
    where p_viewer_user_id is not null and eligibility.user_id=p_viewer_user_id
      and eligibility.status='eligible' and eligibility.age_band='age_18_plus'
      and eligibility.minimum_age=policy.minimum_age and eligibility.policy_version=policy.policy_version
      and policy.creator_exclusive_minimum_age=18 and eligibility.evaluated_at is not null
  ),false);
$$;

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid, p_placement_code text, p_viewer_user_id uuid, p_at_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ad record; v_catalog private.advertising_placement_catalog; v_policy private.advertising_delivery_policy;
  v_audience_version uuid; v_selection_version uuid; v_reasons text[] := array[]::text[];
  v_structural boolean := true; v_viewer boolean := true; v_media_ready boolean := false;
begin
  select * into strict v_policy from private.advertising_delivery_policy where singleton=true;
  select ad.id ad_id, ad.status ad_status, ad.review_status, ad_set.id ad_set_id, ad_set.status ad_set_status,
    campaign.id campaign_id, campaign.status campaign_status, account.id account_id, account.status account_status,
    business.id business_id, business.status business_status, destination.id destination_id, destination.status destination_status,
    destination.campaign_id destination_campaign_id, version.id creative_version_id, version.format creative_format,
    version.media_asset_id, version.video_asset_id, creative.id creative_id, creative.status creative_status,
    creative.ad_account_id creative_account_id
  into v_ad
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  join private.advertising_destinations destination on destination.id=ad.destination_id
  join private.advertising_creative_versions version on version.id=ad.creative_version_id
  join private.advertising_creatives creative on creative.id=version.creative_id
  where ad.id=p_ad_id;
  if not found then
    return pg_catalog.jsonb_build_object('structurally_ready',false,'viewer_match',false,'production_deliverable',false,'reason_codes',array['ad_not_found']);
  end if;
  if v_ad.business_status<>'active' then v_reasons:=v_reasons||'business_inactive'; v_structural:=false; end if;
  if v_ad.account_status<>'active' then v_reasons:=v_reasons||'ad_account_inactive'; v_structural:=false; end if;
  if v_ad.ad_status<>'draft' then v_reasons:=v_reasons||'ad_unavailable'; v_structural:=false; end if;
  if v_policy.require_approved_ad and v_ad.review_status<>'approved' then v_reasons:=v_reasons||'ad_not_approved'; v_structural:=false; end if;
  if v_ad.creative_status<>'draft' then v_reasons:=v_reasons||'creative_unavailable'; v_structural:=false; end if;
  if v_ad.destination_status<>'draft' then v_reasons:=v_reasons||'destination_unavailable'; v_structural:=false; end if;
  if v_ad.destination_campaign_id<>v_ad.campaign_id or v_ad.creative_account_id<>v_ad.account_id then v_reasons:=v_reasons||'same_authority_violation'; v_structural:=false; end if;
  if v_ad.creative_format='image' then select exists(select 1 from public.media_assets where id=v_ad.media_asset_id and status='ready' and deleted_at is null) into v_media_ready;
  elsif v_ad.creative_format='video' then select exists(select 1 from public.video_assets where id=v_ad.video_asset_id and status='ready' and deleted_at is null) into v_media_ready; end if;
  if not v_media_ready then v_reasons:=v_reasons||'creative_media_unavailable'; v_structural:=false; end if;
  select version.id into v_audience_version from private.advertising_audiences audience
  join lateral (select candidate.id from private.advertising_audience_versions candidate where candidate.audience_id=audience.id order by candidate.version_number desc limit 1) version on true
  where audience.ad_set_id=v_ad.ad_set_id and audience.status='draft';
  if v_audience_version is null then v_reasons:=v_reasons||'audience_version_missing'; v_structural:=false; end if;
  select version.id into v_selection_version from private.advertising_placement_selections selection
  join lateral (select candidate.id from private.advertising_placement_selection_versions candidate where candidate.placement_selection_id=selection.id order by candidate.version_number desc limit 1) version on true
  where selection.ad_set_id=v_ad.ad_set_id and selection.status='draft';
  if v_selection_version is null then v_reasons:=v_reasons||'placement_selection_missing'; v_structural:=false; end if;
  select * into v_catalog from private.advertising_placement_catalog where code=p_placement_code;
  if not found then v_reasons:=v_reasons||'placement_unknown'; v_structural:=false;
  else
    if v_catalog.status<>'active' or not v_catalog.surface_verified then v_reasons:=v_reasons||'placement_surface_unavailable'; v_structural:=false; end if;
    if not v_catalog.v2_delivery_enabled then v_reasons:=v_reasons||'placement_v2_delivery_disabled'; end if;
  end if;
  if v_selection_version is not null and not exists(select 1 from private.advertising_placement_selection_items where placement_selection_version_id=v_selection_version and placement_code=p_placement_code) then
    v_reasons:=v_reasons||'placement_not_selected'; v_structural:=false;
  end if;
  if v_policy.require_authenticated_viewer and p_viewer_user_id is null then v_reasons:=v_reasons||'authenticated_viewer_required'; v_viewer:=false; end if;
  if v_policy.require_adult_viewer and not private.ads_delivery_viewer_is_adult(p_viewer_user_id) then v_reasons:=v_reasons||'viewer_adult_eligibility_required'; v_viewer:=false; end if;
  if v_audience_version is not null then
    if exists(select 1 from private.advertising_geo_targets where audience_version_id=v_audience_version) then v_reasons:=v_reasons||'viewer_geo_authority_unavailable'; v_viewer:=false; end if;
    if exists(select 1 from private.advertising_language_targets where audience_version_id=v_audience_version) then v_reasons:=v_reasons||'viewer_language_authority_unavailable'; v_viewer:=false; end if;
    if exists(select 1 from private.advertising_frequency_policies where audience_version_id=v_audience_version) then v_reasons:=v_reasons||'frequency_authority_unavailable'; v_viewer:=false; end if;
    if exists(select 1 from private.advertising_daypart_windows where audience_version_id=v_audience_version)
      and not exists(select 1 from private.advertising_daypart_windows daypart where daypart.audience_version_id=v_audience_version
        and daypart.weekday=extract(isodow from (coalesce(p_at_time,now()) at time zone daypart.timezone_name))::integer
        and (coalesce(p_at_time,now()) at time zone daypart.timezone_name)::time>=daypart.start_local
        and (coalesce(p_at_time,now()) at time zone daypart.timezone_name)::time<daypart.end_local) then
      v_reasons:=v_reasons||'outside_daypart'; v_viewer:=false;
    end if;
  end if;
  v_reasons:=v_reasons||'campaign_activation_not_implemented'; v_structural:=false;
  if not v_policy.global_v2_delivery_enabled then v_reasons:=v_reasons||'global_delivery_disabled'; end if;
  return pg_catalog.jsonb_build_object(
    'structurally_ready',v_structural,'viewer_match',v_viewer,'production_deliverable',false,
    'reason_codes',(select pg_catalog.jsonb_agg(reason order by reason) from (select distinct pg_catalog.unnest(v_reasons) reason) reasons)
  );
end;
$$;

create or replace function public.preview_my_advertising_delivery(
  p_ad_id uuid, p_placement_code text, p_viewer_user_id uuid, p_at_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception using errcode='28000', message='advertising_auth_required'; end if;
  perform 1 from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where ad.id=p_ad_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501', message='advertising_delivery_preview_access_denied'; end if;
  return private.advertising_delivery_preflight_at(p_ad_id,p_placement_code,p_viewer_user_id,coalesce(p_at_time,now()));
end;
$$;

create or replace function public.fetch_advertising_delivery_candidates_v2(
  p_placement_code text, p_viewer_user_id uuid, p_limit integer, p_at_time timestamptz
)
returns table(ad_id uuid, preflight jsonb) language plpgsql stable security definer set search_path = '' as $$
declare v_policy private.advertising_delivery_policy;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='22023', message='advertising_delivery_limit_invalid'; end if;
  select * into strict v_policy from private.advertising_delivery_policy where singleton=true;
  if not v_policy.global_v2_delivery_enabled then return; end if;
  if not exists(select 1 from private.advertising_placement_catalog where code=p_placement_code and status='active' and surface_verified and v2_delivery_enabled) then return; end if;
  return query
  select candidate.id, result.preflight
  from private.advertising_ads candidate
  cross join lateral (select private.advertising_delivery_preflight_at(candidate.id,p_placement_code,p_viewer_user_id,coalesce(p_at_time,now())) preflight) result
  where (result.preflight->>'production_deliverable')::boolean
  order by candidate.created_at,candidate.id limit p_limit;
end;
$$;

revoke execute on function private.advertising_placement_selection_definition_immutable() from public, anon, authenticated, service_role;
revoke execute on function private.ads_normalize_placement_codes(text[]) from public, anon, authenticated;
revoke execute on function private.ads_placement_fingerprint(text[],text) from public, anon, authenticated;
revoke execute on function private.ads_insert_placement_selection_version(uuid,uuid,text[],uuid) from public, anon, authenticated;
revoke execute on function private.ads_placement_selection_result(uuid) from public, anon, authenticated;
revoke execute on function private.ads_delivery_viewer_is_adult(uuid) from public, anon, authenticated;
revoke execute on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz) from public, anon, authenticated;

revoke all on function public.create_my_advertising_placement_selection_draft(uuid,text[],uuid) from public, anon;
revoke all on function public.create_my_advertising_placement_selection_version(uuid,text[],uuid) from public, anon;
revoke all on function public.get_my_advertising_placement_selection(uuid) from public, anon;
revoke all on function public.preview_my_advertising_delivery(uuid,text,uuid,timestamptz) from public, anon;
grant execute on function public.create_my_advertising_placement_selection_draft(uuid,text[],uuid) to authenticated;
grant execute on function public.create_my_advertising_placement_selection_version(uuid,text[],uuid) to authenticated;
grant execute on function public.get_my_advertising_placement_selection(uuid) to authenticated;
grant execute on function public.preview_my_advertising_delivery(uuid,text,uuid,timestamptz) to authenticated;

revoke all on function public.fetch_advertising_delivery_candidates_v2(text,uuid,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.fetch_advertising_delivery_candidates_v2(text,uuid,integer,timestamptz) to service_role;

commit;
