begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_ads') is null
    or pg_catalog.to_regclass('private.advertising_audience_versions') is null
    or pg_catalog.to_regclass('private.advertising_placement_selection_versions') is null
    or pg_catalog.to_regclass('private.advertising_delivery_policy') is null then
    raise exception 'ads_v2_f_foundation_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_events') is not null
    or pg_catalog.to_regclass('private.advertising_conversions') is not null
    or pg_catalog.to_regclass('private.advertising_attributions') is not null then
    raise exception 'ads_v2_g_authority_conflict';
  end if;
end;
$$;

create table private.advertising_event_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null,
  authenticated_viewers_only boolean not null default true,
  anonymous_events_enabled boolean not null default false,
  interaction_max_delay_hours integer not null default 24,
  click_attribution_window_hours integer not null default 24,
  impression_attribution_window_hours integer not null default 24,
  external_conversion_ingestion_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_event_policy_version_chk check (
    policy_version ~ '^nelyon-ads-events-v[0-9]+$'
  ),
  constraint advertising_event_policy_windows_chk check (
    interaction_max_delay_hours between 1 and 168
    and click_attribution_window_hours between 1 and 720
    and impression_attribution_window_hours between 1 and 720
  ),
  constraint advertising_event_policy_v1_privacy_chk check (
    policy_version <> 'nelyon-ads-events-v1'
    or (
      authenticated_viewers_only
      and not anonymous_events_enabled
      and interaction_max_delay_hours = 24
      and click_attribution_window_hours = 24
      and impression_attribution_window_hours = 24
      and not external_conversion_ingestion_enabled
    )
  )
);

create table private.advertising_events (
  id uuid primary key default gen_random_uuid(),
  event_key uuid not null unique,
  event_type text not null check (event_type in (
    'impression', 'click', 'destination_open', 'video_view', 'engagement'
  )),
  ad_id uuid not null references private.advertising_ads(id),
  campaign_id uuid not null references private.advertising_campaigns(id),
  ad_set_id uuid not null references private.advertising_ad_sets(id),
  creative_version_id uuid not null references private.advertising_creative_versions(id),
  destination_id uuid not null references private.advertising_destinations(id),
  audience_version_id uuid not null references private.advertising_audience_versions(id),
  placement_selection_version_id uuid not null references private.advertising_placement_selection_versions(id),
  placement_code text not null references private.advertising_placement_catalog(code),
  viewer_user_id uuid references auth.users(id) on delete set null,
  parent_impression_event_id uuid references private.advertising_events(id),
  context_fingerprint text not null check (context_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint advertising_events_parent_shape_chk check (
    (event_type = 'impression' and parent_impression_event_id is null)
    or (event_type <> 'impression' and parent_impression_event_id is not null)
  )
);

create index advertising_events_frequency_idx
  on private.advertising_events(viewer_user_id, ad_set_id, event_type, occurred_at desc)
  where event_type = 'impression';
create index advertising_events_viewer_type_time_idx
  on private.advertising_events(viewer_user_id, event_type, occurred_at desc);
create index advertising_events_parent_impression_idx
  on private.advertising_events(parent_impression_event_id)
  where parent_impression_event_id is not null;
create index advertising_events_campaign_time_idx
  on private.advertising_events(campaign_id, occurred_at desc);
create index advertising_events_placement_time_idx
  on private.advertising_events(placement_code, occurred_at desc);
create index advertising_events_ad_idx on private.advertising_events(ad_id);
create index advertising_events_creative_version_idx on private.advertising_events(creative_version_id);
create index advertising_events_destination_idx on private.advertising_events(destination_id);
create index advertising_events_audience_version_idx on private.advertising_events(audience_version_id);
create index advertising_events_placement_selection_version_idx on private.advertising_events(placement_selection_version_id);

create table private.advertising_conversions (
  id uuid primary key default gen_random_uuid(),
  conversion_key uuid not null unique,
  conversion_type text not null check (conversion_type in (
    'marketplace_purchase', 'website_conversion', 'app_conversion',
    'message_start', 'profile_visit'
  )),
  viewer_user_id uuid references auth.users(id) on delete set null,
  source_type text not null,
  source_reference_id uuid not null,
  value_bdag numeric(20,8),
  currency text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint advertising_conversions_marketplace_shape_chk check (
    conversion_type <> 'marketplace_purchase'
    or (
      source_type = 'marketplace_order_item'
      and value_bdag is not null and value_bdag > 0
      and value_bdag = round(value_bdag, 8)
      and currency = 'BDAG'
    )
  ),
  constraint advertising_conversions_source_unique
    unique (source_type, source_reference_id, conversion_type)
);

create index advertising_conversions_viewer_time_idx
  on private.advertising_conversions(viewer_user_id, occurred_at desc);

create table private.advertising_attributions (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null unique references private.advertising_conversions(id),
  touch_event_id uuid not null references private.advertising_events(id),
  touch_event_type text not null check (touch_event_type in ('click', 'impression')),
  campaign_id uuid not null references private.advertising_campaigns(id),
  ad_set_id uuid not null references private.advertising_ad_sets(id),
  ad_id uuid not null references private.advertising_ads(id),
  creative_version_id uuid not null references private.advertising_creative_versions(id),
  destination_id uuid not null references private.advertising_destinations(id),
  placement_code text not null references private.advertising_placement_catalog(code),
  attribution_model text not null check (attribution_model = 'last_click_then_impression'),
  attribution_window_hours integer not null check (attribution_window_hours between 1 and 720),
  attributed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create index advertising_attributions_touch_event_idx on private.advertising_attributions(touch_event_id);
create index advertising_attributions_campaign_idx on private.advertising_attributions(campaign_id);
create index advertising_attributions_ad_set_idx on private.advertising_attributions(ad_set_id);
create index advertising_attributions_ad_idx on private.advertising_attributions(ad_id);
create index advertising_attributions_creative_version_idx on private.advertising_attributions(creative_version_id);
create index advertising_attributions_destination_idx on private.advertising_attributions(destination_id);
create index advertising_attributions_placement_idx on private.advertising_attributions(placement_code);

insert into private.advertising_event_policy(singleton, policy_version)
values (true, 'nelyon-ads-events-v1');

create trigger advertising_event_policy_touch_updated_at
before update on private.advertising_event_policy
for each row execute function private.advertising_touch_updated_at();

create or replace function private.advertising_g_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name in ('advertising_events', 'advertising_conversions') then
    if old.viewer_user_id is not null
      and new.viewer_user_id is null
      and (pg_catalog.to_jsonb(new) - 'viewer_user_id') = (pg_catalog.to_jsonb(old) - 'viewer_user_id') then
      return new;
    end if;
  end if;
  raise exception using errcode = '42501', message = 'advertising_event_history_append_only';
end;
$$;

create trigger advertising_events_append_only
before update or delete on private.advertising_events
for each row execute function private.advertising_g_append_only();
create trigger advertising_conversions_append_only
before update or delete on private.advertising_conversions
for each row execute function private.advertising_g_append_only();
create trigger advertising_attributions_append_only
before update or delete on private.advertising_attributions
for each row execute function private.advertising_g_append_only();

alter table private.advertising_event_policy enable row level security;
alter table private.advertising_event_policy force row level security;
alter table private.advertising_events enable row level security;
alter table private.advertising_events force row level security;
alter table private.advertising_conversions enable row level security;
alter table private.advertising_conversions force row level security;
alter table private.advertising_attributions enable row level security;
alter table private.advertising_attributions force row level security;

create policy advertising_event_policy_deny_clients
  on private.advertising_event_policy for all to anon, authenticated
  using (false) with check (false);
create policy advertising_events_deny_clients
  on private.advertising_events for all to anon, authenticated
  using (false) with check (false);
create policy advertising_conversions_deny_clients
  on private.advertising_conversions for all to anon, authenticated
  using (false) with check (false);
create policy advertising_attributions_deny_clients
  on private.advertising_attributions for all to anon, authenticated
  using (false) with check (false);

revoke all on table private.advertising_event_policy from public, anon, authenticated, service_role;
revoke all on table private.advertising_events from public, anon, authenticated, service_role;
revoke all on table private.advertising_conversions from public, anon, authenticated, service_role;
revoke all on table private.advertising_attributions from public, anon, authenticated, service_role;

create or replace function private.advertising_current_delivery_context(
  p_ad_id uuid,
  p_placement_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_fingerprint text;
begin
  select
    ad.id as ad_id,
    campaign.id as campaign_id,
    ad_set.id as ad_set_id,
    ad.creative_version_id,
    ad.destination_id,
    audience_version.id as audience_version_id,
    selection_version.id as placement_selection_version_id,
    p_placement_code as placement_code
  into v_context
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id = ad_set.campaign_id
  join private.advertising_audiences audience
    on audience.ad_set_id = ad_set.id and audience.status = 'draft'
  join lateral (
    select candidate.id
    from private.advertising_audience_versions candidate
    where candidate.audience_id = audience.id
    order by candidate.version_number desc
    limit 1
  ) audience_version on true
  join private.advertising_placement_selections selection
    on selection.ad_set_id = ad_set.id and selection.status = 'draft'
  join lateral (
    select candidate.id
    from private.advertising_placement_selection_versions candidate
    where candidate.placement_selection_id = selection.id
    order by candidate.version_number desc
    limit 1
  ) selection_version on true
  join private.advertising_placement_selection_items item
    on item.placement_selection_version_id = selection_version.id
   and item.placement_code = p_placement_code
  where ad.id = p_ad_id;

  if not found then
    raise exception using errcode = '22023', message = 'advertising_delivery_context_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'ad_id', v_context.ad_id,
        'campaign_id', v_context.campaign_id,
        'ad_set_id', v_context.ad_set_id,
        'creative_version_id', v_context.creative_version_id,
        'destination_id', v_context.destination_id,
        'audience_version_id', v_context.audience_version_id,
        'placement_selection_version_id', v_context.placement_selection_version_id,
        'placement_code', v_context.placement_code
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'ad_id', v_context.ad_id,
    'campaign_id', v_context.campaign_id,
    'ad_set_id', v_context.ad_set_id,
    'creative_version_id', v_context.creative_version_id,
    'destination_id', v_context.destination_id,
    'audience_version_id', v_context.audience_version_id,
    'placement_selection_version_id', v_context.placement_selection_version_id,
    'placement_code', v_context.placement_code,
    'context_fingerprint', v_fingerprint
  );
end;
$$;

create or replace function private.advertising_impression_count_for_frequency(
  p_ad_set_id uuid,
  p_viewer_user_id uuid,
  p_since timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from private.advertising_events event
  where event.ad_set_id = p_ad_set_id
    and event.viewer_user_id = p_viewer_user_id
    and event.event_type = 'impression'
    and event.occurred_at >= p_since;
$$;

alter table private.advertising_delivery_policy
  drop constraint advertising_delivery_policy_v1_fail_closed_chk;

update private.advertising_delivery_policy
set policy_version = 'nelyon-ads-delivery-v2',
    frequency_enforcement_enabled = true,
    updated_at = now()
where singleton = true;

alter table private.advertising_delivery_policy
  add constraint advertising_delivery_policy_v2_fail_closed_chk check (
    policy_version <> 'nelyon-ads-delivery-v2'
    or (
      not global_v2_delivery_enabled
      and require_authenticated_viewer
      and require_adult_viewer
      and require_approved_ad
      and not geo_matching_enabled
      and not language_matching_enabled
      and frequency_enforcement_enabled
    )
  );

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid, p_placement_code text, p_viewer_user_id uuid, p_at_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ad record; v_catalog private.advertising_placement_catalog; v_policy private.advertising_delivery_policy;
  v_audience_version uuid; v_selection_version uuid; v_reasons text[] := array[]::text[];
  v_structural boolean := true; v_viewer boolean := true; v_media_ready boolean := false;
  v_frequency private.advertising_frequency_policies; v_impression_count bigint;
  v_at_time timestamptz := coalesce(p_at_time, now());
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
    select * into v_frequency from private.advertising_frequency_policies where audience_version_id=v_audience_version;
    if found then
      if not v_policy.frequency_enforcement_enabled then
        v_reasons:=v_reasons||'frequency_enforcement_disabled'; v_viewer:=false;
      elsif p_viewer_user_id is null then
        v_reasons:=v_reasons||'authenticated_viewer_required'; v_viewer:=false;
      else
        v_impression_count := private.advertising_impression_count_for_frequency(
          v_ad.ad_set_id, p_viewer_user_id, v_at_time - pg_catalog.make_interval(hours => v_frequency.window_hours)
        );
        if v_impression_count >= v_frequency.max_impressions then
          v_reasons:=v_reasons||'frequency_cap_reached'; v_viewer:=false;
        end if;
      end if;
    end if;
    if exists(select 1 from private.advertising_daypart_windows where audience_version_id=v_audience_version)
      and not exists(select 1 from private.advertising_daypart_windows daypart where daypart.audience_version_id=v_audience_version
        and daypart.weekday=extract(isodow from (v_at_time at time zone daypart.timezone_name))::integer
        and (v_at_time at time zone daypart.timezone_name)::time>=daypart.start_local
        and (v_at_time at time zone daypart.timezone_name)::time<daypart.end_local) then
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

create or replace function public.record_advertising_impression_v2(
  p_ad_id uuid,
  p_placement_code text,
  p_viewer_user_id uuid,
  p_event_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_event_policy;
  v_prior private.advertising_events;
  v_context jsonb;
  v_preflight jsonb;
  v_created private.advertising_events;
begin
  if p_event_key is null then raise exception using errcode='22023', message='advertising_event_key_required'; end if;
  if p_viewer_user_id is null then raise exception using errcode='22023', message='advertising_authenticated_viewer_required'; end if;
  select * into strict v_policy from private.advertising_event_policy where singleton=true;
  if not v_policy.authenticated_viewers_only or v_policy.anonymous_events_enabled then
    raise exception using errcode='55000', message='advertising_event_policy_unsafe';
  end if;
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if found then
    if v_prior.event_type<>'impression' or v_prior.ad_id<>p_ad_id
      or v_prior.placement_code<>p_placement_code
      or v_prior.viewer_user_id is distinct from p_viewer_user_id then
      raise exception using errcode='23505', message='advertising_event_idempotency_conflict';
    end if;
    return pg_catalog.to_jsonb(v_prior);
  end if;
  v_preflight := private.advertising_delivery_preflight_at(p_ad_id,p_placement_code,p_viewer_user_id,clock_timestamp());
  if not coalesce((v_preflight->>'production_deliverable')::boolean,false) then
    raise exception using errcode='55000', message='advertising_impression_not_deliverable', detail=v_preflight::text;
  end if;
  v_context := private.advertising_current_delivery_context(p_ad_id,p_placement_code);
  insert into private.advertising_events(
    event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
    context_fingerprint
  ) values (
    p_event_key,'impression',p_ad_id,(v_context->>'campaign_id')::uuid,(v_context->>'ad_set_id')::uuid,
    (v_context->>'creative_version_id')::uuid,(v_context->>'destination_id')::uuid,
    (v_context->>'audience_version_id')::uuid,(v_context->>'placement_selection_version_id')::uuid,
    p_placement_code,p_viewer_user_id,v_context->>'context_fingerprint'
  ) returning * into v_created;
  return pg_catalog.to_jsonb(v_created);
exception when unique_violation then
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if not found or v_prior.event_type<>'impression' or v_prior.ad_id<>p_ad_id
    or v_prior.placement_code<>p_placement_code
    or v_prior.viewer_user_id is distinct from p_viewer_user_id then
    raise exception using errcode='23505', message='advertising_event_idempotency_conflict';
  end if;
  return pg_catalog.to_jsonb(v_prior);
end;
$$;

create or replace function public.record_advertising_interaction_v2(
  p_impression_event_id uuid,
  p_event_type text,
  p_event_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_event_policy;
  v_parent private.advertising_events;
  v_prior private.advertising_events;
  v_created private.advertising_events;
begin
  if p_event_type not in ('click','destination_open','video_view','engagement') then
    raise exception using errcode='22023', message='advertising_interaction_type_invalid';
  end if;
  if p_event_key is null then raise exception using errcode='22023', message='advertising_event_key_required'; end if;
  select * into strict v_policy from private.advertising_event_policy where singleton=true;
  select * into v_parent from private.advertising_events where id=p_impression_event_id and event_type='impression';
  if not found then raise exception using errcode='22023', message='advertising_parent_impression_required'; end if;
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if found then
    if v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
      raise exception using errcode='23505', message='advertising_event_idempotency_conflict';
    end if;
    return pg_catalog.to_jsonb(v_prior);
  end if;
  if clock_timestamp() > v_parent.occurred_at + pg_catalog.make_interval(hours => v_policy.interaction_max_delay_hours) then
    raise exception using errcode='22023', message='advertising_interaction_window_expired';
  end if;
  insert into private.advertising_events(
    event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
    parent_impression_event_id,context_fingerprint
  ) values (
    p_event_key,p_event_type,v_parent.ad_id,v_parent.campaign_id,v_parent.ad_set_id,
    v_parent.creative_version_id,v_parent.destination_id,v_parent.audience_version_id,
    v_parent.placement_selection_version_id,v_parent.placement_code,v_parent.viewer_user_id,
    v_parent.id,v_parent.context_fingerprint
  ) returning * into v_created;
  return pg_catalog.to_jsonb(v_created);
exception when unique_violation then
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if not found or v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
    raise exception using errcode='23505', message='advertising_event_idempotency_conflict';
  end if;
  return pg_catalog.to_jsonb(v_prior);
end;
$$;

create or replace function private.resolve_advertising_marketplace_purchase_attribution(
  p_conversion_id uuid,
  p_viewer_user_id uuid,
  p_product_id uuid,
  p_store_id uuid,
  p_occurred_at timestamptz
)
returns private.advertising_attributions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_event_policy;
  v_touch private.advertising_events;
  v_result private.advertising_attributions;
  v_window integer;
begin
  select * into v_result from private.advertising_attributions where conversion_id=p_conversion_id;
  if found then return v_result; end if;
  select * into strict v_policy from private.advertising_event_policy where singleton=true;

  select event.* into v_touch
  from private.advertising_events event
  join private.advertising_campaigns campaign on campaign.id=event.campaign_id
  join private.advertising_destinations destination on destination.id=event.destination_id
  where event.viewer_user_id=p_viewer_user_id
    and event.event_type='click'
    and event.occurred_at<=p_occurred_at
    and event.occurred_at>=p_occurred_at-pg_catalog.make_interval(hours=>v_policy.click_attribution_window_hours)
    and campaign.objective = 'marketplace_sales'
    and (
      (destination.destination_type = 'marketplace_product' and destination.target_product_id=p_product_id)
      or (destination.destination_type = 'marketplace_store' and destination.target_store_id=p_store_id)
    )
  order by event.occurred_at desc,event.id desc limit 1;
  v_window:=v_policy.click_attribution_window_hours;

  if not found then
    select event.* into v_touch
    from private.advertising_events event
    join private.advertising_campaigns campaign on campaign.id=event.campaign_id
    join private.advertising_destinations destination on destination.id=event.destination_id
    where event.viewer_user_id=p_viewer_user_id
      and event.event_type='impression'
      and event.occurred_at<=p_occurred_at
      and event.occurred_at>=p_occurred_at-pg_catalog.make_interval(hours=>v_policy.impression_attribution_window_hours)
      and campaign.objective = 'marketplace_sales'
      and (
        (destination.destination_type = 'marketplace_product' and destination.target_product_id=p_product_id)
        or (destination.destination_type = 'marketplace_store' and destination.target_store_id=p_store_id)
      )
    order by event.occurred_at desc,event.id desc limit 1;
    v_window:=v_policy.impression_attribution_window_hours;
  end if;

  if v_touch.id is null then return null; end if;
  insert into private.advertising_attributions(
    conversion_id,touch_event_id,touch_event_type,campaign_id,ad_set_id,ad_id,
    creative_version_id,destination_id,placement_code,attribution_model,attribution_window_hours
  ) values (
    p_conversion_id,v_touch.id,v_touch.event_type,v_touch.campaign_id,v_touch.ad_set_id,v_touch.ad_id,
    v_touch.creative_version_id,v_touch.destination_id,v_touch.placement_code,
    'last_click_then_impression',v_window
  ) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.record_advertising_marketplace_purchase_conversion_v2(
  p_order_item_id uuid,
  p_conversion_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_prior private.advertising_conversions;
  v_conversion private.advertising_conversions;
  v_attribution private.advertising_attributions;
begin
  if p_conversion_key is null then raise exception using errcode='22023', message='advertising_conversion_key_required'; end if;
  select item.id,item.product_id,item.store_id,item.line_total,item.currency,
    order_row.buyer_id,order_row.confirmed_at,order_row.cancelled_at,order_row.expired_at
  into v_item
  from public.marketplace_order_items item
  join public.marketplace_orders order_row on order_row.id=item.order_id
  where item.id=p_order_item_id;
  if not found then raise exception using errcode='P0002', message='advertising_marketplace_order_item_not_found'; end if;
  if v_item.confirmed_at is null then raise exception using errcode='22023', message='advertising_marketplace_order_unconfirmed'; end if;
  if v_item.cancelled_at is not null then raise exception using errcode='22023', message='advertising_marketplace_order_cancelled'; end if;
  if v_item.expired_at is not null then raise exception using errcode='22023', message='advertising_marketplace_order_expired'; end if;

  select * into v_prior from private.advertising_conversions where conversion_key=p_conversion_key;
  if found and (v_prior.conversion_type<>'marketplace_purchase'
    or v_prior.source_type<>'marketplace_order_item' or v_prior.source_reference_id<>p_order_item_id) then
    raise exception using errcode='23505', message='advertising_conversion_idempotency_conflict';
  end if;
  if not found then
    select * into v_prior from private.advertising_conversions
    where source_type='marketplace_order_item' and source_reference_id=p_order_item_id
      and conversion_type='marketplace_purchase';
  end if;
  if found then
    v_conversion:=v_prior;
  else
    insert into private.advertising_conversions(
      conversion_key,conversion_type,viewer_user_id,source_type,source_reference_id,
      value_bdag,currency,occurred_at
    ) values (
      p_conversion_key,'marketplace_purchase',v_item.buyer_id,'marketplace_order_item',p_order_item_id,
      v_item.line_total,v_item.currency,v_item.confirmed_at
    ) returning * into v_conversion;
  end if;

  v_attribution:=private.resolve_advertising_marketplace_purchase_attribution(
    v_conversion.id,v_item.buyer_id,v_item.product_id,v_item.store_id,v_conversion.occurred_at
  );
  return pg_catalog.jsonb_build_object(
    'conversion_id',v_conversion.id,
    'conversion_type',v_conversion.conversion_type,
    'attributed',v_attribution.id is not null,
    'attribution_model',v_attribution.attribution_model,
    'authority','ads_v2'
  );
exception when unique_violation then
  select * into v_conversion from private.advertising_conversions
  where source_type='marketplace_order_item' and source_reference_id=p_order_item_id
    and conversion_type='marketplace_purchase';
  if not found then raise; end if;
  v_attribution:=private.resolve_advertising_marketplace_purchase_attribution(
    v_conversion.id,v_item.buyer_id,v_item.product_id,v_item.store_id,v_conversion.occurred_at
  );
  return pg_catalog.jsonb_build_object(
    'conversion_id',v_conversion.id,'conversion_type',v_conversion.conversion_type,
    'attributed',v_attribution.id is not null,'attribution_model',v_attribution.attribution_model,
    'authority','ads_v2'
  );
end;
$$;

create or replace function public.get_my_advertising_event_summary(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='28000', message='advertising_auth_required'; end if;
  perform 1
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501', message='advertising_campaign_access_denied'; end if;

  select pg_catalog.jsonb_build_object(
    'authority','ads_v2',
    'impressions',count(*) filter(where event.event_type='impression'),
    'clicks',count(*) filter(where event.event_type='click'),
    'destination_opens',count(*) filter(where event.event_type='destination_open'),
    'video_views',count(*) filter(where event.event_type='video_view'),
    'engagements',count(*) filter(where event.event_type='engagement'),
    'conversions',(select count(*) from private.advertising_conversions conversion
      where exists(select 1 from private.advertising_attributions attribution where attribution.conversion_id=conversion.id and attribution.campaign_id=p_campaign_id)),
    'attributed_conversions',(select count(*) from private.advertising_attributions attribution where attribution.campaign_id=p_campaign_id),
    'marketplace_purchase_value_bdag',coalesce((select sum(conversion.value_bdag)
      from private.advertising_conversions conversion
      join private.advertising_attributions attribution on attribution.conversion_id=conversion.id
      where attribution.campaign_id=p_campaign_id and conversion.conversion_type='marketplace_purchase'),0),
    'ctr',case when count(*) filter(where event.event_type='impression')=0 then 0
      else round((count(*) filter(where event.event_type='click'))::numeric
        / (count(*) filter(where event.event_type='impression'))::numeric,8) end
  ) into v_result
  from private.advertising_events event
  where event.campaign_id=p_campaign_id;
  return v_result;
end;
$$;

create or replace function public.reconcile_marketplace_ad_events()returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'campaign_product_mismatch',(select count(*)from public.marketplace_ad_events e join public.marketplace_ad_campaigns c on c.id=e.campaign_id where c.product_id<>e.product_id),
 'purchase_without_order_attribution',(select count(*)from public.marketplace_ad_events e left join public.marketplace_order_ad_attribution a on a.order_item_id=e.order_item_id where e.event_type='purchase'and a.order_item_id is null),
 'invalid_events',(select count(*)from public.marketplace_ad_events where event_type not in('impression','click','product_view','add_to_cart','purchase')or surface not in('marketplace_home','marketplace_search','social_feed','product_detail','cart','checkout')),
 'duplicate_event_keys',(select count(*)from(select event_key,count(*)from public.marketplace_ad_events group by event_key having count(*)>1)x),
 'touch_event_mismatch',(select count(*)from public.marketplace_ad_touches t left join public.marketplace_ad_events e on e.id=t.source_event_id where t.source_event_id is null or e.id is null or e.event_type<>'product_view'or e.campaign_id<>t.campaign_id or e.product_id<>t.product_id or e.viewer_id is distinct from t.viewer_id or e.anonymous_session_id is distinct from t.anonymous_session_id),
 'purchase_gmv_mismatch',(select count(*)from public.marketplace_order_ad_attribution a join public.marketplace_order_items i on i.id=a.order_item_id where a.attributed_gmv_bdag<>i.line_total),
 'purchase_event_link_mismatch',(select count(*)from public.marketplace_order_ad_attribution a left join public.marketplace_ad_events e on e.order_item_id=a.order_item_id and e.event_type='purchase' where e.id is null or e.campaign_id<>a.campaign_id or(e.metadata->>'line_total')::numeric<>a.attributed_gmv_bdag)
)$$;

revoke execute on function private.advertising_g_append_only() from public, anon, authenticated, service_role;
revoke execute on function private.advertising_current_delivery_context(uuid,text) from public, anon, authenticated, service_role;
revoke execute on function private.advertising_impression_count_for_frequency(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke execute on function private.resolve_advertising_marketplace_purchase_attribution(uuid,uuid,uuid,uuid,timestamptz) from public, anon, authenticated, service_role;

revoke all on function public.record_advertising_impression_v2(uuid,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.record_advertising_interaction_v2(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.record_advertising_marketplace_purchase_conversion_v2(uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_advertising_impression_v2(uuid,text,uuid,uuid) to service_role;
grant execute on function public.record_advertising_interaction_v2(uuid,text,uuid) to service_role;
grant execute on function public.record_advertising_marketplace_purchase_conversion_v2(uuid,uuid) to service_role;

revoke all on function public.get_my_advertising_event_summary(uuid) from public, anon;
grant execute on function public.get_my_advertising_event_summary(uuid) to authenticated;

revoke execute on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
