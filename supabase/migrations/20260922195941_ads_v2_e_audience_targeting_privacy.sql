begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_ad_sets') is null
    or pg_catalog.to_regclass('private.advertising_ads') is null
    or pg_catalog.to_regclass('private.ad_accounts') is null then
    raise exception 'ads_v2_d_foundation_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_targeting_policy') is not null
    or pg_catalog.to_regclass('private.advertising_audiences') is not null
    or pg_catalog.to_regclass('private.advertising_audience_versions') is not null
    or pg_catalog.to_regclass('private.advertising_geo_targets') is not null
    or pg_catalog.to_regclass('private.advertising_language_targets') is not null
    or pg_catalog.to_regclass('private.advertising_daypart_windows') is not null
    or pg_catalog.to_regclass('private.advertising_frequency_policies') is not null then
    raise exception 'ads_v2_e_authority_conflict';
  end if;
end;
$$;

create table private.advertising_targeting_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null,
  advertiser_minimum_age smallint not null default 18,
  audience_minimum_age smallint not null default 18,
  minor_targeting_allowed boolean not null default false,
  interest_targeting_enabled boolean not null default false,
  behavioral_targeting_enabled boolean not null default false,
  custom_audiences_enabled boolean not null default false,
  lookalike_targeting_enabled boolean not null default false,
  sensitive_targeting_allowed boolean not null default false,
  precise_viewer_location_matching_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_targeting_policy_version_chk
    check (policy_version ~ '^nelyon-ads-targeting-v[0-9]+$'),
  constraint advertising_targeting_policy_v1_age_chk
    check (advertiser_minimum_age = 18 and audience_minimum_age = 18),
  constraint advertising_targeting_policy_v1_privacy_chk check (
    not minor_targeting_allowed
    and not interest_targeting_enabled
    and not behavioral_targeting_enabled
    and not custom_audiences_enabled
    and not lookalike_targeting_enabled
    and not sensitive_targeting_allowed
    and not precise_viewer_location_matching_enabled
  )
);

insert into private.advertising_targeting_policy(
  singleton, policy_version, advertiser_minimum_age, audience_minimum_age
) values (true, 'nelyon-ads-targeting-v1', 18, 18);

create table private.advertising_audiences (
  id uuid primary key default gen_random_uuid(),
  ad_set_id uuid not null references private.advertising_ad_sets(id),
  status text not null default 'draft',
  created_by uuid not null references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertising_audiences_status_chk check (status in ('draft', 'archived')),
  constraint advertising_audiences_archive_state_chk check (
    (status = 'draft' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint advertising_audiences_ad_set_unique unique (ad_set_id),
  constraint advertising_audiences_ad_set_idempotency_unique
    unique (ad_set_id, creation_idempotency_key)
);

create index advertising_audiences_created_by_idx
  on private.advertising_audiences(created_by);

create table private.advertising_audience_versions (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references private.advertising_audiences(id),
  version_number integer not null check (version_number > 0),
  age_scope text not null check (age_scope = 'adults_only'),
  targeting_policy_version text not null
    check (targeting_policy_version ~ '^nelyon-ads-targeting-v[0-9]+$'),
  definition_fingerprint text not null
    check (definition_fingerprint ~ '^[0-9a-f]{64}$'),
  creation_idempotency_key uuid not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  constraint advertising_audience_versions_number_unique
    unique (audience_id, version_number),
  constraint advertising_audience_versions_idempotency_unique
    unique (audience_id, creation_idempotency_key)
);

create index advertising_audience_versions_created_by_idx
  on private.advertising_audience_versions(created_by);

create table private.advertising_geo_targets (
  id uuid primary key default gen_random_uuid(),
  audience_version_id uuid not null references private.advertising_audience_versions(id),
  match_mode text not null check (match_mode in ('include', 'exclude')),
  target_type text not null check (target_type in ('country', 'region', 'city', 'radius')),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text check (
    region_code is null or (region_code = btrim(region_code) and char_length(region_code) between 1 and 32)
  ),
  city_name text check (
    city_name is null or (city_name = btrim(city_name) and char_length(city_name) between 1 and 120)
  ),
  latitude numeric,
  longitude numeric,
  radius_km numeric,
  created_at timestamptz not null default now(),
  constraint advertising_geo_targets_latitude_chk check (
    latitude is null or latitude between -90 and 90
  ),
  constraint advertising_geo_targets_longitude_chk check (
    longitude is null or longitude between -180 and 180
  ),
  constraint advertising_geo_targets_radius_chk check (
    radius_km is null or (radius_km > 0 and radius_km <= 100)
  ),
  constraint advertising_geo_targets_shape_chk check (
    (target_type = 'country'
      and region_code is null and city_name is null
      and latitude is null and longitude is null and radius_km is null)
    or (target_type = 'region'
      and region_code is not null and city_name is null
      and latitude is null and longitude is null and radius_km is null)
    or (target_type = 'city'
      and city_name is not null
      and latitude is null and longitude is null and radius_km is null)
    or (target_type = 'radius'
      and region_code is null and city_name is null
      and latitude is not null and longitude is not null and radius_km is not null)
  )
);

create index advertising_geo_targets_version_idx
  on private.advertising_geo_targets(audience_version_id);
create unique index advertising_geo_targets_definition_unique
  on private.advertising_geo_targets(
    audience_version_id, match_mode, target_type, country_code,
    coalesce(region_code, ''), coalesce(city_name, ''),
    coalesce(latitude, 999::numeric), coalesce(longitude, 999::numeric),
    coalesce(radius_km, 0::numeric)
  );

create table private.advertising_language_targets (
  id uuid primary key default gen_random_uuid(),
  audience_version_id uuid not null references private.advertising_audience_versions(id),
  match_mode text not null check (match_mode in ('include', 'exclude')),
  language_tag text not null check (
    language_tag = lower(language_tag)
    and language_tag ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
  ),
  created_at timestamptz not null default now(),
  constraint advertising_language_targets_definition_unique
    unique (audience_version_id, match_mode, language_tag)
);

create table private.advertising_daypart_windows (
  id uuid primary key default gen_random_uuid(),
  audience_version_id uuid not null references private.advertising_audience_versions(id),
  timezone_name text not null check (
    timezone_name = btrim(timezone_name) and char_length(timezone_name) between 1 and 120
  ),
  weekday smallint not null check (weekday between 1 and 7),
  start_local time not null,
  end_local time not null,
  created_at timestamptz not null default now(),
  constraint advertising_daypart_windows_order_chk check (start_local < end_local),
  constraint advertising_daypart_windows_definition_unique
    unique (audience_version_id, timezone_name, weekday, start_local, end_local)
);

create table private.advertising_frequency_policies (
  audience_version_id uuid primary key references private.advertising_audience_versions(id),
  max_impressions integer not null check (max_impressions between 1 and 20),
  window_hours integer not null check (window_hours between 1 and 168),
  created_at timestamptz not null default now()
);

alter table private.advertising_targeting_policy enable row level security;
alter table private.advertising_targeting_policy force row level security;
alter table private.advertising_audiences enable row level security;
alter table private.advertising_audiences force row level security;
alter table private.advertising_audience_versions enable row level security;
alter table private.advertising_audience_versions force row level security;
alter table private.advertising_geo_targets enable row level security;
alter table private.advertising_geo_targets force row level security;
alter table private.advertising_language_targets enable row level security;
alter table private.advertising_language_targets force row level security;
alter table private.advertising_daypart_windows enable row level security;
alter table private.advertising_daypart_windows force row level security;
alter table private.advertising_frequency_policies enable row level security;
alter table private.advertising_frequency_policies force row level security;

create policy advertising_targeting_policy_deny_clients
  on private.advertising_targeting_policy for all to anon, authenticated
  using (false) with check (false);
create policy advertising_audiences_deny_clients
  on private.advertising_audiences for all to anon, authenticated
  using (false) with check (false);
create policy advertising_audience_versions_deny_clients
  on private.advertising_audience_versions for all to anon, authenticated
  using (false) with check (false);
create policy advertising_geo_targets_deny_clients
  on private.advertising_geo_targets for all to anon, authenticated
  using (false) with check (false);
create policy advertising_language_targets_deny_clients
  on private.advertising_language_targets for all to anon, authenticated
  using (false) with check (false);
create policy advertising_daypart_windows_deny_clients
  on private.advertising_daypart_windows for all to anon, authenticated
  using (false) with check (false);
create policy advertising_frequency_policies_deny_clients
  on private.advertising_frequency_policies for all to anon, authenticated
  using (false) with check (false);

revoke all on table private.advertising_targeting_policy from public, anon, authenticated, service_role;
revoke all on table private.advertising_audiences from public, anon, authenticated, service_role;
revoke all on table private.advertising_audience_versions from public, anon, authenticated, service_role;
revoke all on table private.advertising_geo_targets from public, anon, authenticated, service_role;
revoke all on table private.advertising_language_targets from public, anon, authenticated, service_role;
revoke all on table private.advertising_daypart_windows from public, anon, authenticated, service_role;
revoke all on table private.advertising_frequency_policies from public, anon, authenticated, service_role;

create or replace function private.advertising_targeting_policy_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'advertising_targeting_policy_migration_required';
end;
$$;

create trigger advertising_targeting_policy_immutable
before update or delete on private.advertising_targeting_policy
for each row execute function private.advertising_targeting_policy_immutable();

create or replace function private.advertising_audience_definition_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'advertising_audience_definition_immutable';
end;
$$;

create trigger advertising_audience_versions_immutable
before update or delete on private.advertising_audience_versions
for each row execute function private.advertising_audience_definition_immutable();
create trigger advertising_geo_targets_immutable
before update or delete on private.advertising_geo_targets
for each row execute function private.advertising_audience_definition_immutable();
create trigger advertising_language_targets_immutable
before update or delete on private.advertising_language_targets
for each row execute function private.advertising_audience_definition_immutable();
create trigger advertising_daypart_windows_immutable
before update or delete on private.advertising_daypart_windows
for each row execute function private.advertising_audience_definition_immutable();
create trigger advertising_frequency_policies_immutable
before update or delete on private.advertising_frequency_policies
for each row execute function private.advertising_audience_definition_immutable();

create trigger advertising_audiences_touch_updated_at
before update on private.advertising_audiences
for each row execute function private.advertising_touch_updated_at();

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
  if v_policy.policy_version <> 'nelyon-ads-targeting-v1'
    or v_policy.advertiser_minimum_age <> 18
    or v_policy.audience_minimum_age <> 18
    or v_policy.minor_targeting_allowed
    or v_policy.interest_targeting_enabled
    or v_policy.behavioral_targeting_enabled
    or v_policy.custom_audiences_enabled
    or v_policy.lookalike_targeting_enabled
    or v_policy.sensitive_targeting_allowed
    or v_policy.precise_viewer_location_matching_enabled then
    raise exception using errcode = '55000', message = 'advertising_targeting_policy_not_safe';
  end if;

  if p_definition ? 'geographies' then
    if pg_catalog.jsonb_typeof(p_definition->'geographies') <> 'array'
      or pg_catalog.jsonb_array_length(p_definition->'geographies') > 100 then
      raise exception using errcode = '22023', message = 'advertising_audience_geographies_invalid';
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

create or replace function private.ads_audience_definition_fingerprint(
  p_normalized_definition jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_normalized_definition::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.ads_insert_audience_version(
  p_actor uuid,
  p_audience_id uuid,
  p_definition jsonb,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience private.advertising_audiences;
  v_campaign_id uuid;
  v_normalized jsonb;
  v_fingerprint text;
  v_existing private.advertising_audience_versions;
  v_version private.advertising_audience_versions;
  v_version_number integer;
  v_item jsonb;
begin
  if p_actor is null or p_audience_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_audience_version_input_invalid';
  end if;

  select audience.*
    into v_audience
  from private.advertising_audiences as audience
  join private.advertising_ad_sets as ad_set on ad_set.id = audience.ad_set_id
  where audience.id = p_audience_id
    and audience.status = 'draft'
    and ad_set.status = 'draft'
  for update of audience;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_audience_draft_access_denied';
  end if;
  select ad_set.campaign_id into strict v_campaign_id
  from private.advertising_ad_sets as ad_set
  where ad_set.id = v_audience.ad_set_id;
  perform 1 from private.ads_require_owned_draft_campaign(p_actor, v_campaign_id);

  v_normalized := private.ads_normalize_audience_definition(p_definition);
  v_fingerprint := private.ads_audience_definition_fingerprint(v_normalized);

  select * into v_existing
  from private.advertising_audience_versions
  where audience_id = p_audience_id
    and creation_idempotency_key = p_idempotency_key;
  if found then
    if v_existing.created_by is distinct from p_actor
      or v_existing.definition_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_audience_version_idempotency_conflict';
    end if;
    return v_existing.id;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version_number
  from private.advertising_audience_versions
  where audience_id = p_audience_id;

  insert into private.advertising_audience_versions(
    audience_id, version_number, age_scope, targeting_policy_version,
    definition_fingerprint, creation_idempotency_key, created_by
  ) values (
    p_audience_id, v_version_number, v_normalized->>'age_scope',
    v_normalized->>'targeting_policy_version', v_fingerprint,
    p_idempotency_key, p_actor
  ) returning * into v_version;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_normalized->'geographies')
  loop
    insert into private.advertising_geo_targets(
      audience_version_id, match_mode, target_type, country_code,
      region_code, city_name, latitude, longitude, radius_km
    ) values (
      v_version.id, v_item->>'mode', v_item->>'type', v_item->>'country_code',
      v_item->>'region_code', v_item->>'city_name',
      (v_item->>'latitude')::numeric, (v_item->>'longitude')::numeric,
      (v_item->>'radius_km')::numeric
    );
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_normalized->'languages')
  loop
    insert into private.advertising_language_targets(
      audience_version_id, match_mode, language_tag
    ) values (v_version.id, v_item->>'mode', v_item->>'tag');
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_normalized->'dayparts')
  loop
    insert into private.advertising_daypart_windows(
      audience_version_id, timezone_name, weekday, start_local, end_local
    ) values (
      v_version.id, v_item->>'timezone', (v_item->>'weekday')::smallint,
      (v_item->>'start')::time, (v_item->>'end')::time
    );
  end loop;
  if v_normalized->'frequency' <> 'null'::jsonb then
    insert into private.advertising_frequency_policies(
      audience_version_id, max_impressions, window_hours
    ) values (
      v_version.id,
      (v_normalized->'frequency'->>'max_impressions')::integer,
      (v_normalized->'frequency'->>'window_hours')::integer
    );
  end if;
  return v_version.id;
end;
$$;

create or replace function private.ads_audience_result(
  p_audience_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'audience_id', audience.id,
    'ad_set_id', audience.ad_set_id,
    'status', audience.status,
    'latest_version', case when version.id is null then null else pg_catalog.jsonb_build_object(
      'id', version.id,
      'version_number', version.version_number,
      'age_scope', version.age_scope,
      'targeting_policy_version', version.targeting_policy_version,
      'definition_fingerprint', version.definition_fingerprint,
      'created_at', version.created_at,
      'geographies', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'mode', geo.match_mode, 'type', geo.target_type,
          'country_code', geo.country_code, 'region_code', geo.region_code,
          'city_name', geo.city_name, 'latitude', geo.latitude,
          'longitude', geo.longitude, 'radius_km', geo.radius_km
        ) order by geo.match_mode, geo.target_type, geo.country_code,
          geo.region_code, geo.city_name, geo.latitude, geo.longitude, geo.radius_km), '[]'::jsonb)
        from private.advertising_geo_targets as geo
        where geo.audience_version_id = version.id
      ),
      'languages', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'mode', language.match_mode, 'tag', language.language_tag
        ) order by language.match_mode, language.language_tag), '[]'::jsonb)
        from private.advertising_language_targets as language
        where language.audience_version_id = version.id
      ),
      'dayparts', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'timezone', daypart.timezone_name, 'weekday', daypart.weekday,
          'start', pg_catalog.to_char(daypart.start_local, 'HH24:MI'),
          'end', pg_catalog.to_char(daypart.end_local, 'HH24:MI')
        ) order by daypart.timezone_name, daypart.weekday,
          daypart.start_local, daypart.end_local), '[]'::jsonb)
        from private.advertising_daypart_windows as daypart
        where daypart.audience_version_id = version.id
      ),
      'frequency', (
        select pg_catalog.jsonb_build_object(
          'max_impressions', frequency.max_impressions,
          'window_hours', frequency.window_hours
        )
        from private.advertising_frequency_policies as frequency
        where frequency.audience_version_id = version.id
      )
    )
    end,
    'capabilities', pg_catalog.jsonb_build_object(
      'delivery_implemented', false,
      'interest_targeting', false,
      'behavioral_targeting', false,
      'custom_audiences', false,
      'lookalikes', false,
      'minor_targeting', false,
      'precise_viewer_location_matching', false
    )
  )
  from private.advertising_audiences as audience
  left join lateral (
    select candidate.*
    from private.advertising_audience_versions as candidate
    where candidate.audience_id = audience.id
    order by candidate.version_number desc
    limit 1
  ) as version on true
  where audience.id = p_audience_id;
$$;

create or replace function public.create_my_advertising_audience_draft(
  p_ad_set_id uuid,
  p_definition jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_campaign_id uuid;
  v_audience private.advertising_audiences;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_ad_set_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_audience_input_invalid';
  end if;

  select ad_set.campaign_id into v_campaign_id
  from private.advertising_ad_sets as ad_set
  where ad_set.id = p_ad_set_id and ad_set.status = 'draft'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_set_draft_access_denied';
  end if;
  perform 1 from private.ads_require_owned_draft_campaign(v_actor, v_campaign_id);

  insert into private.advertising_audiences(
    ad_set_id, status, created_by, creation_idempotency_key
  ) values (p_ad_set_id, 'draft', v_actor, p_idempotency_key)
  on conflict (ad_set_id) do nothing
  returning * into v_audience;

  if v_audience.id is null then
    select * into strict v_audience
    from private.advertising_audiences
    where ad_set_id = p_ad_set_id;
    if v_audience.creation_idempotency_key is distinct from p_idempotency_key
      or v_audience.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_audience_idempotency_conflict';
    end if;
  end if;

  perform private.ads_insert_audience_version(
    v_actor, v_audience.id, p_definition, p_idempotency_key
  );
  return private.ads_audience_result(v_audience.id);
end;
$$;

create or replace function public.create_my_advertising_audience_version(
  p_audience_id uuid,
  p_definition jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  perform private.ads_insert_audience_version(
    v_actor, p_audience_id, p_definition, p_idempotency_key
  );
  return private.ads_audience_result(p_audience_id);
end;
$$;

create or replace function public.get_my_advertising_audience(
  p_audience_id uuid
)
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
  perform 1
  from private.advertising_audiences as audience
  join private.advertising_ad_sets as ad_set on ad_set.id = audience.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  where audience.id = p_audience_id
    and business.owner_user_id = v_actor;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_audience_access_denied';
  end if;
  return private.ads_audience_result(p_audience_id);
end;
$$;

revoke execute on function private.advertising_targeting_policy_immutable() from public, anon, authenticated;
revoke execute on function private.advertising_audience_definition_immutable() from public, anon, authenticated;
revoke execute on function private.ads_normalize_audience_definition(jsonb) from public, anon, authenticated;
revoke execute on function private.ads_audience_definition_fingerprint(jsonb) from public, anon, authenticated;
revoke execute on function private.ads_insert_audience_version(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
revoke execute on function private.ads_audience_result(uuid) from public, anon, authenticated;

revoke all on function public.create_my_advertising_audience_draft(uuid,jsonb,uuid) from public, anon;
revoke all on function public.create_my_advertising_audience_version(uuid,jsonb,uuid) from public, anon;
revoke all on function public.get_my_advertising_audience(uuid) from public, anon;
grant execute on function public.create_my_advertising_audience_draft(uuid,jsonb,uuid) to authenticated;
grant execute on function public.create_my_advertising_audience_version(uuid,jsonb,uuid) to authenticated;
grant execute on function public.get_my_advertising_audience(uuid) to authenticated;

commit;
