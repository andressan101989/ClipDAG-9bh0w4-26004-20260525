begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_targeting_policy') is null
    or pg_catalog.to_regclass('private.advertising_audience_versions') is null
    or pg_catalog.to_regclass('private.advertising_campaign_lifecycle_policy') is null
    or pg_catalog.to_regclass('private.advertising_delivery_policy') is null then
    raise exception 'ads_v2_plr_3_foundation_required';
  end if;
  if not exists (
    select 1 from private.advertising_targeting_policy
    where singleton and policy_version='nelyon-ads-targeting-v1'
  ) then
    raise exception 'ads_v2_plr_4_targeting_policy_precondition_failed';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid='private.advertising_targeting_policy'::pg_catalog.regclass
      and attname in ('geo_targeting_enabled','language_targeting_enabled','daypart_targeting_enabled','frequency_targeting_enabled')
      and not attisdropped
  ) then
    raise exception 'ads_v2_plr_4_targeting_capability_conflict';
  end if;
end;
$$;

alter table private.advertising_targeting_policy
  add column geo_targeting_enabled boolean not null default false,
  add column language_targeting_enabled boolean not null default false,
  add column daypart_targeting_enabled boolean not null default true,
  add column frequency_targeting_enabled boolean not null default true;

alter table private.advertising_targeting_policy
  add constraint advertising_targeting_policy_v2_safe_chk check (
    policy_version <> 'nelyon-ads-targeting-v2'
    or (
      advertiser_minimum_age=18
      and audience_minimum_age=18
      and not minor_targeting_allowed
      and not interest_targeting_enabled
      and not behavioral_targeting_enabled
      and not custom_audiences_enabled
      and not lookalike_targeting_enabled
      and not sensitive_targeting_allowed
      and not precise_viewer_location_matching_enabled
      and not geo_targeting_enabled
      and not language_targeting_enabled
      and daypart_targeting_enabled
      and frequency_targeting_enabled
    )
  );

alter table private.advertising_targeting_policy
  disable trigger advertising_targeting_policy_immutable;

update private.advertising_targeting_policy
set policy_version='nelyon-ads-targeting-v2',
    geo_targeting_enabled=false,
    language_targeting_enabled=false,
    daypart_targeting_enabled=true,
    frequency_targeting_enabled=true,
    updated_at=pg_catalog.now()
where singleton;

alter table private.advertising_targeting_policy
  enable trigger advertising_targeting_policy_immutable;

create or replace function private.ads_normalize_audience_definition(
  p_definition jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_targeting_policy%rowtype;
  v_item jsonb;
  v_geo jsonb := '[]'::jsonb;
  v_languages jsonb := '[]'::jsonb;
  v_dayparts jsonb := '[]'::jsonb;
  v_frequency jsonb := null;
  v_mode text;
  v_type text;
  v_country text;
  v_region text;
  v_city text;
  v_latitude numeric;
  v_longitude numeric;
  v_radius numeric;
  v_tag text;
  v_timezone text;
  v_weekday integer;
  v_start_text text;
  v_end_text text;
  v_start time;
  v_end time;
  v_max_impressions integer;
  v_window_hours integer;
begin
  if p_definition is null or pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'advertising_audience_definition_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_definition) as key
    where key not in ('age_scope', 'geographies', 'languages', 'dayparts', 'frequency')
  ) then
    raise exception using errcode = '22023', message = 'advertising_audience_definition_unknown_key';
  end if;
  if p_definition->>'age_scope' is distinct from 'adults_only' then
    raise exception using errcode = '22023', message = 'advertising_audience_adults_only_required';
  end if;

  select * into strict v_policy
  from private.advertising_targeting_policy
  where singleton = true;
  if v_policy.policy_version <> 'nelyon-ads-targeting-v2'
    or v_policy.advertiser_minimum_age <> 18
    or v_policy.audience_minimum_age <> 18
    or v_policy.minor_targeting_allowed
    or v_policy.interest_targeting_enabled
    or v_policy.behavioral_targeting_enabled
    or v_policy.custom_audiences_enabled
    or v_policy.lookalike_targeting_enabled
    or v_policy.sensitive_targeting_allowed
    or v_policy.precise_viewer_location_matching_enabled
    or v_policy.geo_targeting_enabled
    or v_policy.language_targeting_enabled
    or not v_policy.daypart_targeting_enabled
    or not v_policy.frequency_targeting_enabled then
    raise exception using errcode = '55000', message = 'advertising_targeting_policy_not_safe';
  end if;

  if p_definition ? 'geographies' then
    if pg_catalog.jsonb_typeof(p_definition->'geographies') <> 'array'
      or pg_catalog.jsonb_array_length(p_definition->'geographies') > 100 then
      raise exception using errcode = '22023', message = 'advertising_audience_geographies_invalid';
    end if;
    if pg_catalog.jsonb_array_length(p_definition->'geographies') > 0
      and not v_policy.geo_targeting_enabled then
      raise exception using errcode = '55000', message = 'advertising_audience_geo_targeting_not_enabled';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_definition->'geographies')
    loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception using errcode = '22023', message = 'advertising_audience_geography_invalid';
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_object_keys(v_item) as key
        where key not in (
          'mode', 'type', 'country_code', 'region_code', 'city_name',
          'latitude', 'longitude', 'radius_km'
        )
      ) then
        raise exception using errcode = '22023', message = 'advertising_audience_geography_unknown_key';
      end if;
      v_mode := lower(btrim(v_item->>'mode'));
      v_type := lower(btrim(v_item->>'type'));
      v_country := upper(btrim(v_item->>'country_code'));
      v_region := nullif(btrim(v_item->>'region_code'), '');
      v_city := nullif(btrim(v_item->>'city_name'), '');
      if v_mode not in ('include', 'exclude')
        or v_type not in ('country', 'region', 'city', 'radius')
        or v_country !~ '^[A-Z]{2}$' then
        raise exception using errcode = '22023', message = 'advertising_audience_geography_invalid';
      end if;
      if v_region is not null and (char_length(v_region) > 32 or v_region !~ '^[A-Za-z0-9][A-Za-z0-9._ -]*$') then
        raise exception using errcode = '22023', message = 'advertising_audience_region_invalid';
      end if;
      if v_city is not null and char_length(v_city) > 120 then
        raise exception using errcode = '22023', message = 'advertising_audience_city_invalid';
      end if;
      if v_item ? 'latitude' then
        if pg_catalog.jsonb_typeof(v_item->'latitude') <> 'number'
          or (v_item->>'latitude') !~ '^-?[0-9]+([.][0-9]+)?$' then
          raise exception using errcode = '22023', message = 'advertising_audience_latitude_invalid';
        end if;
        v_latitude := (v_item->>'latitude')::numeric;
      else v_latitude := null;
      end if;
      if v_item ? 'longitude' then
        if pg_catalog.jsonb_typeof(v_item->'longitude') <> 'number'
          or (v_item->>'longitude') !~ '^-?[0-9]+([.][0-9]+)?$' then
          raise exception using errcode = '22023', message = 'advertising_audience_longitude_invalid';
        end if;
        v_longitude := (v_item->>'longitude')::numeric;
      else v_longitude := null;
      end if;
      if v_item ? 'radius_km' then
        if pg_catalog.jsonb_typeof(v_item->'radius_km') <> 'number'
          or (v_item->>'radius_km') !~ '^[0-9]+([.][0-9]+)?$' then
          raise exception using errcode = '22023', message = 'advertising_audience_radius_invalid';
        end if;
        v_radius := (v_item->>'radius_km')::numeric;
      else v_radius := null;
      end if;

      if (v_type = 'country' and not (
          v_region is null and v_city is null and v_latitude is null and v_longitude is null and v_radius is null
        ))
        or (v_type = 'region' and not (
          v_region is not null and v_city is null and v_latitude is null and v_longitude is null and v_radius is null
        ))
        or (v_type = 'city' and not (
          v_city is not null and v_latitude is null and v_longitude is null and v_radius is null
        ))
        or (v_type = 'radius' and not (
          v_region is null and v_city is null and v_latitude between -90 and 90
          and v_longitude between -180 and 180 and v_radius > 0 and v_radius <= 100
        )) then
        raise exception using errcode = '22023', message = 'advertising_audience_geography_shape_invalid';
      end if;
      v_geo := v_geo || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'mode', v_mode, 'type', v_type, 'country_code', v_country,
        'region_code', v_region, 'city_name', v_city,
        'latitude', v_latitude, 'longitude', v_longitude, 'radius_km', v_radius
      ));
    end loop;
  end if;

  if p_definition ? 'languages' then
    if pg_catalog.jsonb_typeof(p_definition->'languages') <> 'array'
      or pg_catalog.jsonb_array_length(p_definition->'languages') > 50 then
      raise exception using errcode = '22023', message = 'advertising_audience_languages_invalid';
    end if;
    if pg_catalog.jsonb_array_length(p_definition->'languages') > 0
      and not v_policy.language_targeting_enabled then
      raise exception using errcode = '55000', message = 'advertising_audience_language_targeting_not_enabled';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_definition->'languages')
    loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception using errcode = '22023', message = 'advertising_audience_language_invalid';
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_object_keys(v_item) as key
        where key not in ('mode', 'tag')
      ) then
        raise exception using errcode = '22023', message = 'advertising_audience_language_unknown_key';
      end if;
      v_mode := lower(btrim(v_item->>'mode'));
      v_tag := lower(btrim(v_item->>'tag'));
      if v_mode not in ('include', 'exclude')
        or v_tag !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' then
        raise exception using errcode = '22023', message = 'advertising_audience_language_invalid';
      end if;
      v_languages := v_languages || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('mode', v_mode, 'tag', v_tag)
      );
    end loop;
  end if;

  if p_definition ? 'dayparts' then
    if pg_catalog.jsonb_typeof(p_definition->'dayparts') <> 'array'
      or pg_catalog.jsonb_array_length(p_definition->'dayparts') > 100 then
      raise exception using errcode = '22023', message = 'advertising_audience_dayparts_invalid';
    end if;
    if pg_catalog.jsonb_array_length(p_definition->'dayparts') > 0
      and not v_policy.daypart_targeting_enabled then
      raise exception using errcode = '55000', message = 'advertising_audience_daypart_targeting_not_enabled';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_definition->'dayparts')
    loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception using errcode = '22023', message = 'advertising_audience_daypart_invalid';
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_object_keys(v_item) as key
        where key not in ('timezone', 'weekday', 'start', 'end')
      ) then
        raise exception using errcode = '22023', message = 'advertising_audience_daypart_unknown_key';
      end if;
      v_timezone := btrim(v_item->>'timezone');
      if pg_catalog.jsonb_typeof(v_item->'weekday') <> 'number'
        or (v_item->>'weekday') !~ '^[0-9]+$' then
        raise exception using errcode = '22023', message = 'advertising_audience_weekday_invalid';
      end if;
      v_weekday := (v_item->>'weekday')::integer;
      v_start_text := v_item->>'start';
      v_end_text := v_item->>'end';
      if v_timezone is null or not exists (
          select 1 from pg_catalog.pg_timezone_names where name = v_timezone
        ) then
        raise exception using errcode = '22023', message = 'advertising_audience_timezone_invalid';
      end if;
      if v_weekday not between 1 and 7 then
        raise exception using errcode = '22023', message = 'advertising_audience_weekday_invalid';
      end if;
      if v_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or v_end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception using errcode = '22023', message = 'advertising_audience_daypart_time_invalid';
      end if;
      v_start := v_start_text::time;
      v_end := v_end_text::time;
      if v_start >= v_end then
        raise exception using errcode = '22023', message = 'advertising_audience_daypart_order_invalid';
      end if;
      v_dayparts := v_dayparts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'timezone', v_timezone, 'weekday', v_weekday,
        'start', pg_catalog.to_char(v_start, 'HH24:MI'),
        'end', pg_catalog.to_char(v_end, 'HH24:MI')
      ));
    end loop;
  end if;

  if p_definition ? 'frequency' and p_definition->'frequency' <> 'null'::jsonb then
    if not v_policy.frequency_targeting_enabled then
      raise exception using errcode = '55000', message = 'advertising_audience_frequency_targeting_not_enabled';
    end if;
    if pg_catalog.jsonb_typeof(p_definition->'frequency') <> 'object' then
      raise exception using errcode = '22023', message = 'advertising_audience_frequency_invalid';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(p_definition->'frequency') as key
      where key not in ('max_impressions', 'window_hours')
    ) then
      raise exception using errcode = '22023', message = 'advertising_audience_frequency_unknown_key';
    end if;
    if pg_catalog.jsonb_typeof(p_definition->'frequency'->'max_impressions') <> 'number'
      or (p_definition->'frequency'->>'max_impressions') !~ '^[0-9]+$'
      or pg_catalog.jsonb_typeof(p_definition->'frequency'->'window_hours') <> 'number'
      or (p_definition->'frequency'->>'window_hours') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'advertising_audience_frequency_invalid';
    end if;
    v_max_impressions := (p_definition->'frequency'->>'max_impressions')::integer;
    v_window_hours := (p_definition->'frequency'->>'window_hours')::integer;
    if v_max_impressions not between 1 and 20 or v_window_hours not between 1 and 168 then
      raise exception using errcode = '22023', message = 'advertising_audience_frequency_invalid';
    end if;
    v_frequency := pg_catalog.jsonb_build_object(
      'max_impressions', v_max_impressions, 'window_hours', v_window_hours
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(value order by value::text), '[]'::jsonb)
    into v_geo from pg_catalog.jsonb_array_elements(v_geo);
  select coalesce(pg_catalog.jsonb_agg(value order by value::text), '[]'::jsonb)
    into v_languages from pg_catalog.jsonb_array_elements(v_languages);
  select coalesce(pg_catalog.jsonb_agg(value order by value::text), '[]'::jsonb)
    into v_dayparts from pg_catalog.jsonb_array_elements(v_dayparts);

  return pg_catalog.jsonb_build_object(
    'age_scope', 'adults_only',
    'targeting_policy_version', v_policy.policy_version,
    'geographies', v_geo,
    'languages', v_languages,
    'dayparts', v_dayparts,
    'frequency', v_frequency
  );
end;
$$;

create or replace function public.get_my_advertising_targeting_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_policy private.advertising_targeting_policy;
begin
  if v_actor is null then
    raise exception using errcode='28000',message='advertising_auth_required';
  end if;
  select * into strict v_policy
  from private.advertising_targeting_policy
  where singleton;
  return pg_catalog.jsonb_build_object(
    'policy_version',v_policy.policy_version,
    'advertiser_minimum_age',v_policy.advertiser_minimum_age,
    'audience_minimum_age',v_policy.audience_minimum_age,
    'age_scope','adults_only',
    'geo_targeting_enabled',v_policy.geo_targeting_enabled,
    'language_targeting_enabled',v_policy.language_targeting_enabled,
    'daypart_targeting_enabled',v_policy.daypart_targeting_enabled,
    'frequency_targeting_enabled',v_policy.frequency_targeting_enabled,
    'interest_targeting_enabled',v_policy.interest_targeting_enabled,
    'behavioral_targeting_enabled',v_policy.behavioral_targeting_enabled,
    'custom_audiences_enabled',v_policy.custom_audiences_enabled,
    'lookalike_targeting_enabled',v_policy.lookalike_targeting_enabled,
    'sensitive_targeting_allowed',v_policy.sensitive_targeting_allowed,
    'precise_viewer_location_matching_enabled',v_policy.precise_viewer_location_matching_enabled
  );
end;
$$;

create or replace function private.advertising_campaign_operational_readiness_at(
  p_campaign_id uuid,
  p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_at_time timestamptz:=coalesce(p_at_time,pg_catalog.now());
  v_campaign record;
  v_finance private.advertising_campaign_finance;
  v_delivery private.advertising_delivery_policy;
  v_targeting private.advertising_targeting_policy;
  v_ad_set private.advertising_ad_sets;
  v_ad record;
  v_audience_version uuid;
  v_audience_policy_version text;
  v_selection_version uuid;
  v_blockers text[]:=array[]::text[];
  v_candidate_blockers text[]:=array[]::text[];
  v_set_ready boolean;
  v_media_ready boolean;
  v_ready_ad_count integer:=0;
  v_current_window_count integer:=0;
  v_future_window_count integer:=0;
  v_target_status text;
  v_finance_ready boolean:=false;
  v_age_ready boolean:=false;
  v_structurally_ready boolean:=false;
begin
  select campaign.id,campaign.status,account.id account_id,account.status account_status,
    business.id business_id,business.status business_status,business.owner_user_id
  into v_campaign
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'campaign_id',p_campaign_id,'structurally_ready',false,'target_status',null,
      'blockers',pg_catalog.jsonb_build_array('campaign_not_found'),'ready_ad_count',0,
      'current_window_ad_set_count',0,'future_window_ad_set_count',0,
      'finance_ready',false,'advertiser_age_ready',false
    );
  end if;

  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  if v_campaign.business_status<>'active' then v_blockers:=pg_catalog.array_append(v_blockers,'business_inactive'); end if;
  if v_campaign.account_status<>'active' then v_blockers:=pg_catalog.array_append(v_blockers,'ad_account_inactive'); end if;
  v_age_ready:=private.ads_actor_is_advertiser_age_eligible(v_campaign.owner_user_id);
  if not v_age_ready then v_blockers:=pg_catalog.array_append(v_blockers,'advertiser_adult_eligibility_required'); end if;

  select * into v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  if not found or v_finance.finance_status<>'funded' or v_finance.funded_bdag<=0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_finance_not_funded');
  elsif v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag<=0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_budget_exhausted');
  else
    v_finance_ready:=true;
  end if;

  for v_ad_set in
    select * from private.advertising_ad_sets
    where campaign_id=p_campaign_id and status='draft'
    order by created_at,id
  loop
    v_set_ready:=false;
    v_audience_version:=null;
    v_audience_policy_version:=null;
    v_selection_version:=null;

    select version.id,version.targeting_policy_version
    into v_audience_version,v_audience_policy_version
    from private.advertising_audiences audience
    join lateral(
      select candidate.id,candidate.targeting_policy_version from private.advertising_audience_versions candidate
      where candidate.audience_id=audience.id order by candidate.version_number desc limit 1
    ) version on true
    where audience.ad_set_id=v_ad_set.id and audience.status='draft';
    if v_audience_version is null then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'audience_version_missing');
      continue;
    end if;
    if v_audience_policy_version is distinct from v_targeting.policy_version then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'audience_targeting_policy_stale');
      continue;
    end if;
    if exists(select 1 from private.advertising_geo_targets where audience_version_id=v_audience_version)
      and (not v_targeting.geo_targeting_enabled or not v_delivery.geo_matching_enabled) then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'viewer_geo_authority_unavailable');
      continue;
    end if;
    if exists(select 1 from private.advertising_language_targets where audience_version_id=v_audience_version)
      and (not v_targeting.language_targeting_enabled or not v_delivery.language_matching_enabled) then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'viewer_language_authority_unavailable');
      continue;
    end if;

    select version.id into v_selection_version
    from private.advertising_placement_selections selection
    join lateral(
      select candidate.id from private.advertising_placement_selection_versions candidate
      where candidate.placement_selection_id=selection.id order by candidate.version_number desc limit 1
    ) version on true
    where selection.ad_set_id=v_ad_set.id and selection.status='draft';
    if v_selection_version is null then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'placement_selection_missing');
      continue;
    end if;
    if not exists(select 1 from private.advertising_placement_selection_items where placement_selection_version_id=v_selection_version)
      or exists(
        select 1 from private.advertising_placement_selection_items item
        left join private.advertising_placement_catalog catalog on catalog.code=item.placement_code
        where item.placement_selection_version_id=v_selection_version
          and (catalog.code is null or catalog.status<>'active' or not catalog.surface_verified or not catalog.v2_delivery_enabled)
      ) then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'placement_v2_delivery_disabled');
      continue;
    end if;

    for v_ad in
      select ad.*,destination.status destination_status,destination.campaign_id destination_campaign_id,
        creative.status creative_status,creative.ad_account_id creative_account_id,
        version.format creative_format,version.media_asset_id,version.video_asset_id
      from private.advertising_ads ad
      join private.advertising_destinations destination on destination.id=ad.destination_id
      join private.advertising_creative_versions version on version.id=ad.creative_version_id
      join private.advertising_creatives creative on creative.id=version.creative_id
      where ad.ad_set_id=v_ad_set.id
      order by ad.created_at,ad.id
    loop
      if v_ad.status<>'draft' or v_ad.review_status<>'approved'
        or v_ad.destination_status<>'draft' or v_ad.creative_status<>'draft'
        or v_ad.destination_campaign_id<>p_campaign_id
        or v_ad.creative_account_id<>v_campaign.account_id then
        continue;
      end if;
      if v_ad.submission_fingerprint is null
        or v_ad.submission_fingerprint is distinct from private.ads_ad_submission_fingerprint(v_ad.id) then
        v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'ad_review_fingerprint_mismatch');
        continue;
      end if;
      v_media_ready:=false;
      if v_ad.creative_format='image' then
        select exists(select 1 from public.media_assets where id=v_ad.media_asset_id and status='ready' and deleted_at is null) into v_media_ready;
      elsif v_ad.creative_format='video' then
        select exists(select 1 from public.video_assets where id=v_ad.video_asset_id and status='ready' and deleted_at is null) into v_media_ready;
      end if;
      if not v_media_ready then
        v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'creative_media_unavailable');
        continue;
      end if;
      v_set_ready:=true;
      v_ready_ad_count:=v_ready_ad_count+1;
    end loop;

    if v_set_ready then
      if v_ad_set.starts_at is null then
        v_current_window_count:=v_current_window_count+1;
      elsif v_ad_set.starts_at<=v_at_time and v_at_time<v_ad_set.ends_at then
        v_current_window_count:=v_current_window_count+1;
      elsif v_ad_set.starts_at>v_at_time then
        v_future_window_count:=v_future_window_count+1;
      end if;
    end if;
  end loop;

  if v_ready_ad_count=0 then
    v_blockers:=v_blockers||v_candidate_blockers;
    v_blockers:=pg_catalog.array_append(v_blockers,'no_operational_ad_set');
  end if;
  if v_current_window_count>0 then
    v_target_status:='active';
  elsif v_future_window_count>0 then
    v_target_status:='scheduled';
  elsif v_ready_ad_count>0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_schedule_expired');
  end if;

  select not exists(select 1 from pg_catalog.unnest(v_blockers) blocker) and v_target_status is not null
  into v_structurally_ready;
  return pg_catalog.jsonb_build_object(
    'campaign_id',p_campaign_id,'structurally_ready',v_structurally_ready,'target_status',v_target_status,
    'blockers',coalesce((select pg_catalog.jsonb_agg(blocker order by blocker) from(
      select distinct pg_catalog.unnest(v_blockers) blocker
    ) distinct_blockers),'[]'::jsonb),
    'ready_ad_count',v_ready_ad_count,
    'current_window_ad_set_count',v_current_window_count,
    'future_window_ad_set_count',v_future_window_count,
    'finance_ready',v_finance_ready,'advertiser_age_ready',v_age_ready
  );
end;
$$;

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_ad record;
  v_catalog private.advertising_placement_catalog;
  v_policy private.advertising_delivery_policy;
  v_targeting private.advertising_targeting_policy;
  v_finance private.advertising_campaign_finance;
  v_audience_version uuid;
  v_audience_policy_version text;
  v_selection_version uuid;
  v_reasons text[]:=array[]::text[];
  v_structural boolean:=true;
  v_viewer boolean:=true;
  v_media_ready boolean:=false;
  v_frequency private.advertising_frequency_policies;
  v_impression_count bigint;
  v_at_time timestamptz:=coalesce(p_at_time,pg_catalog.now());
  v_production_deliverable boolean:=false;
begin
  select * into strict v_policy from private.advertising_delivery_policy where singleton;
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  select ad.id ad_id,ad.status ad_status,ad.review_status,ad.submission_fingerprint,
    ad_set.id ad_set_id,ad_set.status ad_set_status,ad_set.starts_at,ad_set.ends_at,
    campaign.id campaign_id,campaign.status campaign_status,
    account.id account_id,account.status account_status,
    business.id business_id,business.status business_status,business.owner_user_id,
    destination.id destination_id,destination.status destination_status,destination.campaign_id destination_campaign_id,
    version.id creative_version_id,version.format creative_format,version.media_asset_id,version.video_asset_id,
    creative.id creative_id,creative.status creative_status,creative.ad_account_id creative_account_id
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
    return pg_catalog.jsonb_build_object('structurally_ready',false,'viewer_match',false,'production_deliverable',false,'reason_codes',pg_catalog.jsonb_build_array('ad_not_found'));
  end if;

  if v_ad.business_status<>'active' then v_reasons:=pg_catalog.array_append(v_reasons,'business_inactive');v_structural:=false;end if;
  if v_ad.account_status<>'active' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_account_inactive');v_structural:=false;end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_ad.owner_user_id) then v_reasons:=pg_catalog.array_append(v_reasons,'advertiser_adult_eligibility_required');v_structural:=false;end if;
  if v_ad.campaign_status<>'active' then
    v_reasons:=pg_catalog.array_append(v_reasons,case v_ad.campaign_status
      when 'paused' then 'campaign_paused' when 'completed' then 'campaign_completed'
      when 'cancelled' then 'campaign_cancelled' when 'archived' then 'campaign_unavailable'
      else 'campaign_not_active' end);
    v_structural:=false;
  end if;
  if v_ad.ad_set_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_set_unavailable');v_structural:=false;end if;
  if v_ad.starts_at is not null and (v_at_time<v_ad.starts_at or v_at_time>=v_ad.ends_at) then v_reasons:=pg_catalog.array_append(v_reasons,'ad_set_outside_schedule');v_structural:=false;end if;

  select * into v_finance from private.advertising_campaign_finance where campaign_id=v_ad.campaign_id;
  if not found or v_finance.finance_status<>'funded' or v_finance.funded_bdag<=0 then
    v_reasons:=pg_catalog.array_append(v_reasons,'campaign_finance_not_funded');v_structural:=false;
  elsif v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag<=0 then
    v_reasons:=pg_catalog.array_append(v_reasons,'campaign_budget_exhausted');v_structural:=false;
  end if;

  if v_ad.ad_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_unavailable');v_structural:=false;end if;
  if not v_policy.require_approved_ad or v_ad.review_status<>'approved' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_not_approved');v_structural:=false;end if;
  if v_ad.review_status='approved' and (v_ad.submission_fingerprint is null or v_ad.submission_fingerprint is distinct from private.ads_ad_submission_fingerprint(v_ad.ad_id)) then
    v_reasons:=pg_catalog.array_append(v_reasons,'ad_review_fingerprint_mismatch');v_structural:=false;
  end if;
  if v_ad.creative_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'creative_unavailable');v_structural:=false;end if;
  if v_ad.destination_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'destination_unavailable');v_structural:=false;end if;
  if v_ad.destination_campaign_id<>v_ad.campaign_id or v_ad.creative_account_id<>v_ad.account_id then v_reasons:=pg_catalog.array_append(v_reasons,'same_authority_violation');v_structural:=false;end if;
  if v_ad.creative_format='image' then
    select exists(select 1 from public.media_assets where id=v_ad.media_asset_id and status='ready' and deleted_at is null) into v_media_ready;
  elsif v_ad.creative_format='video' then
    select exists(select 1 from public.video_assets where id=v_ad.video_asset_id and status='ready' and deleted_at is null) into v_media_ready;
  end if;
  if not v_media_ready then v_reasons:=pg_catalog.array_append(v_reasons,'creative_media_unavailable');v_structural:=false;end if;

  select version.id,version.targeting_policy_version
  into v_audience_version,v_audience_policy_version
  from private.advertising_audiences audience
  join lateral(select candidate.id,candidate.targeting_policy_version from private.advertising_audience_versions candidate where candidate.audience_id=audience.id order by candidate.version_number desc limit 1) version on true
  where audience.ad_set_id=v_ad.ad_set_id and audience.status='draft';
  if v_audience_version is null then v_reasons:=pg_catalog.array_append(v_reasons,'audience_version_missing');v_structural:=false;end if;
  if v_audience_version is not null and v_audience_policy_version is distinct from v_targeting.policy_version then
    v_reasons:=pg_catalog.array_append(v_reasons,'audience_targeting_policy_stale');v_structural:=false;
  end if;
  select version.id into v_selection_version from private.advertising_placement_selections selection
  join lateral(select candidate.id from private.advertising_placement_selection_versions candidate where candidate.placement_selection_id=selection.id order by candidate.version_number desc limit 1) version on true
  where selection.ad_set_id=v_ad.ad_set_id and selection.status='draft';
  if v_selection_version is null then v_reasons:=pg_catalog.array_append(v_reasons,'placement_selection_missing');v_structural:=false;end if;

  select * into v_catalog from private.advertising_placement_catalog where code=p_placement_code;
  if not found then v_reasons:=pg_catalog.array_append(v_reasons,'placement_unknown');v_structural:=false;
  else
    if v_catalog.status<>'active' or not v_catalog.surface_verified then v_reasons:=pg_catalog.array_append(v_reasons,'placement_surface_unavailable');v_structural:=false;end if;
    if not v_catalog.v2_delivery_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'placement_v2_delivery_disabled');end if;
  end if;
  if v_selection_version is not null and not exists(select 1 from private.advertising_placement_selection_items where placement_selection_version_id=v_selection_version and placement_code=p_placement_code) then v_reasons:=pg_catalog.array_append(v_reasons,'placement_not_selected');v_structural:=false;end if;

  if v_policy.require_authenticated_viewer and p_viewer_user_id is null then v_reasons:=pg_catalog.array_append(v_reasons,'authenticated_viewer_required');v_viewer:=false;end if;
  if v_policy.require_adult_viewer and not private.ads_delivery_viewer_is_adult(p_viewer_user_id) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_adult_eligibility_required');v_viewer:=false;end if;
  if v_audience_version is not null then
    if exists(select 1 from private.advertising_geo_targets where audience_version_id=v_audience_version) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_geo_authority_unavailable');v_viewer:=false;end if;
    if exists(select 1 from private.advertising_language_targets where audience_version_id=v_audience_version) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_language_authority_unavailable');v_viewer:=false;end if;
    select * into v_frequency from private.advertising_frequency_policies where audience_version_id=v_audience_version;
    if found then
      if not v_policy.frequency_enforcement_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'frequency_enforcement_disabled');v_viewer:=false;
      elsif p_viewer_user_id is null then v_reasons:=pg_catalog.array_append(v_reasons,'authenticated_viewer_required');v_viewer:=false;
      else
        v_impression_count:=private.advertising_impression_count_for_frequency(v_ad.ad_set_id,p_viewer_user_id,v_at_time-pg_catalog.make_interval(hours=>v_frequency.window_hours));
        if v_impression_count>=v_frequency.max_impressions then v_reasons:=pg_catalog.array_append(v_reasons,'frequency_cap_reached');v_viewer:=false;end if;
      end if;
    end if;
    if exists(select 1 from private.advertising_daypart_windows where audience_version_id=v_audience_version)
      and not exists(select 1 from private.advertising_daypart_windows daypart where daypart.audience_version_id=v_audience_version
        and daypart.weekday=extract(isodow from(v_at_time at time zone daypart.timezone_name))::integer
        and (v_at_time at time zone daypart.timezone_name)::time>=daypart.start_local
        and (v_at_time at time zone daypart.timezone_name)::time<daypart.end_local) then
      v_reasons:=pg_catalog.array_append(v_reasons,'outside_daypart');v_viewer:=false;
    end if;
  end if;
  if not v_policy.global_v2_delivery_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'global_delivery_disabled');end if;
  v_production_deliverable:=v_structural and v_viewer and v_policy.global_v2_delivery_enabled
    and coalesce(v_catalog.v2_delivery_enabled,false);
  return pg_catalog.jsonb_build_object(
    'structurally_ready',v_structural,'viewer_match',v_viewer,'production_deliverable',v_production_deliverable,
    'reason_codes',coalesce((select pg_catalog.jsonb_agg(reason order by reason) from(select distinct pg_catalog.unnest(v_reasons) reason) reasons),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_admin_advertising_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_targeting private.advertising_targeting_policy;
  v_delivery private.advertising_delivery_policy;
  v_events private.advertising_event_policy;
  v_finance private.advertising_finance_policy;
  v_lifecycle private.advertising_campaign_lifecycle_policy;
  v_age_rows bigint;
  v_adult_eligible_rows bigint;
  v_enabled bigint;
  v_blockers text[] := array[]::text[];
  v_capability_not_enabled text[] := array[]::text[];
begin
  perform public.admin_require_capability('advertising.ads.read');
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select * into strict v_events from private.advertising_event_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
  select * into strict v_lifecycle from private.advertising_campaign_lifecycle_policy where singleton;
  select count(*) into v_age_rows from private.user_age_eligibility;
  select count(*) into v_adult_eligible_rows
  from private.user_age_eligibility eligibility
  join private.age_eligibility_policy policy on policy.singleton
  where eligibility.status='eligible'
    and eligibility.age_band='age_18_plus'
    and eligibility.minimum_age=policy.minimum_age
    and eligibility.policy_version=policy.policy_version
    and eligibility.evaluated_at is not null
    and policy.creator_exclusive_minimum_age=18;
  select count(*) into v_enabled from private.advertising_placement_catalog where v2_delivery_enabled;

  if not v_lifecycle.activation_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'campaign_activation_disabled'); end if;
  if not v_lifecycle.automatic_transitions_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'campaign_automatic_transitions_disabled'); end if;
  if v_adult_eligible_rows=0 then v_blockers:=pg_catalog.array_append(v_blockers,'age_authority_unavailable'); end if;
  if not v_finance.funding_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_funding_disabled'); end if;
  if not v_finance.spend_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_spend_disabled'); end if;
  if not v_finance.settlement_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_settlement_disabled'); end if;
  if not v_delivery.global_v2_delivery_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'global_delivery_disabled'); end if;
  if v_enabled=0 then v_blockers:=pg_catalog.array_append(v_blockers,'no_v2_placement_enabled'); end if;
  if not v_delivery.geo_matching_enabled then v_capability_not_enabled:=pg_catalog.array_append(v_capability_not_enabled,'geo_matching_disabled'); end if;
  if not v_delivery.language_matching_enabled then v_capability_not_enabled:=pg_catalog.array_append(v_capability_not_enabled,'language_matching_disabled'); end if;

  return pg_catalog.jsonb_build_object(
    'authority','ads_v2','production_delivery_ready',false,
    'blockers',pg_catalog.to_jsonb(v_blockers),
    'capability_not_enabled',pg_catalog.to_jsonb(v_capability_not_enabled),
    'identity',pg_catalog.jsonb_build_object(
      'business_accounts',(select count(*) from private.business_accounts),
      'ad_accounts',(select count(*) from private.ad_accounts)
    ),
    'age',pg_catalog.jsonb_build_object(
      'age_eligibility_rows',v_age_rows,
      'advertiser_eligible_rows',v_adult_eligible_rows,
      'advertiser_eligibility_operational',v_adult_eligible_rows>0
    ),
    'targeting',pg_catalog.jsonb_build_object(
      'targeting_policy_version',v_targeting.policy_version,
      'minor_targeting_allowed',v_targeting.minor_targeting_allowed,
      'interest_targeting_enabled',v_targeting.interest_targeting_enabled,
      'behavioral_targeting_enabled',v_targeting.behavioral_targeting_enabled,
      'custom_audiences_enabled',v_targeting.custom_audiences_enabled,
      'lookalike_targeting_enabled',v_targeting.lookalike_targeting_enabled,
      'sensitive_targeting_allowed',v_targeting.sensitive_targeting_allowed,
      'precise_viewer_location_matching_enabled',v_targeting.precise_viewer_location_matching_enabled,
      'geo_targeting_enabled',v_targeting.geo_targeting_enabled,
      'language_targeting_enabled',v_targeting.language_targeting_enabled,
      'daypart_targeting_enabled',v_targeting.daypart_targeting_enabled,
      'frequency_targeting_enabled',v_targeting.frequency_targeting_enabled
    ),
    'delivery',pg_catalog.jsonb_build_object(
      'delivery_policy_version',v_delivery.policy_version,
      'global_v2_delivery_enabled',v_delivery.global_v2_delivery_enabled,
      'enabled_placement_count',v_enabled,
      'frequency_enforcement_enabled',v_delivery.frequency_enforcement_enabled,
      'geo_matching_enabled',v_delivery.geo_matching_enabled,
      'language_matching_enabled',v_delivery.language_matching_enabled,
      'campaign_activation_implemented',true
    ),
    'lifecycle',pg_catalog.jsonb_build_object(
      'policy_version',v_lifecycle.policy_version,
      'activation_enabled',v_lifecycle.activation_enabled,
      'automatic_transitions_enabled',v_lifecycle.automatic_transitions_enabled
    ),
    'events',pg_catalog.jsonb_build_object(
      'event_policy_version',v_events.policy_version,
      'events',(select count(*) from private.advertising_events),
      'conversions',(select count(*) from private.advertising_conversions),
      'attributions',(select count(*) from private.advertising_attributions),
      'anonymous_events_enabled',v_events.anonymous_events_enabled,
      'external_conversion_ingestion_enabled',v_events.external_conversion_ingestion_enabled
    ),
    'finance',pg_catalog.jsonb_build_object(
      'finance_policy_version',v_finance.policy_version,
      'funding_enabled',v_finance.funding_enabled,
      'spend_enabled',v_finance.spend_enabled,
      'settlement_enabled',v_finance.settlement_enabled,
      'campaign_finance_rows',(select count(*) from private.advertising_campaign_finance),
      'financial_event_rows',(select count(*) from private.advertising_financial_events),
      'settlement_rows',(select count(*) from private.advertising_financial_settlements)
    )
  );
end;
$$;

comment on function public.get_my_advertising_targeting_capabilities() is
  'Returns the current Ads V2 targeting launch capabilities for the authenticated actor without viewer data.';

revoke all on function public.get_my_advertising_targeting_capabilities() from public,anon,service_role;
grant execute on function public.get_my_advertising_targeting_capabilities() to authenticated;

revoke all on function private.ads_normalize_audience_definition(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.advertising_campaign_operational_readiness_at(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz) to service_role;

revoke all on function public.get_admin_advertising_health() from public,anon,service_role;
grant execute on function public.get_admin_advertising_health() to authenticated;

commit;
