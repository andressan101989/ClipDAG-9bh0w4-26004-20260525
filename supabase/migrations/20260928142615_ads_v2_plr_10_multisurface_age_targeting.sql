-- ADS-V2-PLR-10: canonical multi-surface delivery adapters and configurable
-- age-range targeting. This migration intentionally leaves launch mode
-- DISARMED and every placement disabled.
begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_audience_versions') is null
    or pg_catalog.to_regclass('private.advertising_placement_catalog') is null
    or pg_catalog.to_regclass('private.user_age_eligibility') is null
    or pg_catalog.to_regprocedure('private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)') is null then
    raise exception 'ads_v2_plr_10_foundation_required';
  end if;
  if not exists(select 1 from private.advertising_targeting_policy
      where singleton and policy_version='nelyon-ads-targeting-v2'
        and advertiser_minimum_age=18 and audience_minimum_age=18) then
    raise exception 'ads_v2_plr_10_targeting_policy_precondition_failed';
  end if;
  if not exists(select 1 from private.age_eligibility_policy
      where singleton and policy_version='nelyon-age-v2'
        and minimum_age=13 and creator_exclusive_minimum_age=18) then
    raise exception 'ads_v2_plr_10_age_policy_precondition_failed';
  end if;
  if (select launch_mode from private.advertising_canary_policy where singleton) <> 'DISARMED'
    or exists (select 1 from private.advertising_placement_catalog where v2_delivery_enabled) then
    raise exception 'ads_v2_plr_10_requires_disarmed_state';
  end if;
end;
$$;

-- Exact date of birth stays inside the existing canonical private age
-- authority. It is used only for server-side range eligibility and is never
-- returned by an Ads RPC.
alter table private.user_age_eligibility
  add column birth_date date;

alter table private.user_age_eligibility
  add constraint user_age_eligibility_birth_date_state_chk check (
    (status = 'unknown_legacy' and birth_date is null)
    or status in ('eligible', 'ineligible')
  );

create or replace function private.age_parse_dob(
  p_dob text,
  p_as_of date default (pg_catalog.now() at time zone 'UTC')::date
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_birth_date date;
begin
  if p_dob is null or p_dob !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_as_of is null then
    return null;
  end if;
  begin
    v_birth_date := p_dob::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return null;
  end;
  if pg_catalog.to_char(v_birth_date, 'YYYY-MM-DD') <> p_dob or v_birth_date > p_as_of then
    return null;
  end if;
  return v_birth_date;
end;
$$;

revoke all on function private.age_parse_dob(text,date)
from public,anon,authenticated,service_role;

-- Bounded best-effort enrichment for already-classified accounts. Invalid or
-- contradictory metadata remains unavailable rather than being trusted.
update private.user_age_eligibility eligibility
set birth_date = candidate.birth_date,
    updated_at = pg_catalog.clock_timestamp()
from (
  select users.id,
    private.age_parse_dob(users.raw_user_meta_data->>'date_of_birth') as birth_date,
    private.age_classify_dob(users.raw_user_meta_data->>'date_of_birth') as age_band
  from auth.users users
) candidate
where eligibility.user_id = candidate.id
  and eligibility.status in ('eligible','ineligible')
  and candidate.birth_date is not null
  and candidate.age_band = eligibility.age_band
  and eligibility.birth_date is null;

create or replace function private.materialize_user_age_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.age_eligibility_policy%rowtype;
  v_band text;
  v_status text;
  v_birth_date date;
begin
  select * into strict v_policy
  from private.age_eligibility_policy
  where singleton = true;

  v_birth_date := private.age_parse_dob(new.raw_user_meta_data->>'date_of_birth');
  v_band := private.age_classify_dob(new.raw_user_meta_data->>'date_of_birth');
  v_status := case v_band
    when 'age_13_17' then 'eligible'
    when 'age_18_plus' then 'eligible'
    when 'under_13' then 'ineligible'
    else 'unknown_legacy'
  end;

  insert into private.user_age_eligibility (
    user_id,status,age_band,minimum_age,policy_version,evaluated_at,source,birth_date
  ) values (
    new.id,v_status,v_band,v_policy.minimum_age,v_policy.policy_version,
    case when v_band='unknown_legacy' then null else pg_catalog.now() end,
    case when v_band='unknown_legacy' then 'legacy_unknown' else 'signup_metadata' end,
    case when v_band='unknown_legacy' then null else v_birth_date end
  );
  return new;
end;
$$;

revoke all on function private.materialize_user_age_eligibility()
from public,anon,authenticated,service_role;

create or replace function public.remediate_my_age_eligibility(p_date_of_birth text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_policy private.age_eligibility_policy%rowtype;
  v_existing private.user_age_eligibility%rowtype;
  v_birth_date date;
  v_band text;
  v_status text;
  v_now timestamptz;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  v_birth_date := private.age_parse_dob(p_date_of_birth);
  v_band := private.age_classify_dob(p_date_of_birth);
  if v_birth_date is null or v_band='unknown_legacy' then
    raise exception using errcode='22023',message='age_eligibility_invalid_date_of_birth';
  end if;
  v_status := case when v_band in ('age_13_17','age_18_plus') then 'eligible' else 'ineligible' end;
  select * into strict v_policy from private.age_eligibility_policy where singleton;
  insert into private.user_age_eligibility(
    user_id,status,age_band,minimum_age,policy_version,evaluated_at,source,birth_date
  ) values (
    v_actor,'unknown_legacy','unknown_legacy',v_policy.minimum_age,v_policy.policy_version,null,'legacy_unknown',null
  ) on conflict(user_id) do nothing;
  select * into strict v_existing from private.user_age_eligibility where user_id=v_actor for update;

  if v_existing.status <> 'unknown_legacy' then
    if v_existing.age_band is distinct from v_band then
      raise exception using errcode='22023',message='age_eligibility_existing_classification_conflict';
    end if;
    if v_existing.birth_date is null then
      update private.user_age_eligibility
      set birth_date=v_birth_date,updated_at=pg_catalog.clock_timestamp()
      where user_id=v_actor;
    elsif v_existing.birth_date is distinct from v_birth_date then
      raise exception using errcode='22023',message='age_eligibility_existing_birth_date_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'status',v_existing.status,'age_band',v_existing.age_band,'evaluated',true,
      'advertiser_18_plus_eligible',private.ads_actor_is_advertiser_age_eligible(v_actor),
      'policy_version',v_existing.policy_version,'minimum_age',v_existing.minimum_age,
      'already_evaluated',true
    );
  end if;

  v_now := pg_catalog.clock_timestamp();
  update private.user_age_eligibility
  set status=v_status,age_band=v_band,minimum_age=v_policy.minimum_age,
      policy_version=v_policy.policy_version,evaluated_at=v_now,
      source='legacy_remediation',birth_date=v_birth_date,updated_at=v_now
  where user_id=v_actor and status='unknown_legacy';
  return pg_catalog.jsonb_build_object(
    'status',v_status,'age_band',v_band,'evaluated',true,
    'advertiser_18_plus_eligible',v_band='age_18_plus',
    'policy_version',v_policy.policy_version,'minimum_age',v_policy.minimum_age,
    'already_evaluated',false
  );
end;
$$;

revoke all on function public.remediate_my_age_eligibility(text)
from public,anon,authenticated,service_role;
grant execute on function public.remediate_my_age_eligibility(text) to authenticated;

-- Expand the same immutable audience version authority. Existing rows become
-- explicit adults-only 18+ definitions without changing their meaning.
alter table private.advertising_audience_versions
  disable trigger advertising_audience_versions_immutable;
alter table private.advertising_audience_versions
  drop constraint advertising_audience_versions_age_scope_check;
alter table private.advertising_audience_versions
  add column min_age smallint,
  add column max_age smallint;
update private.advertising_audience_versions
set min_age=18,max_age=null
where age_scope='adults_only';
alter table private.advertising_audience_versions
  alter column min_age set default 18,
  alter column min_age set not null,
  add constraint advertising_audience_versions_age_scope_check
    check (age_scope in ('adults_only','age_range')),
  add constraint advertising_audience_versions_age_range_chk check (
    (age_scope='adults_only' and min_age=18 and max_age is null)
    or (age_scope='age_range' and min_age between 13 and 120
      and (max_age is null or (max_age between min_age and 120)))
  );
alter table private.advertising_audience_versions
  enable trigger advertising_audience_versions_immutable;

alter table private.advertising_targeting_policy
  drop constraint advertising_targeting_policy_v1_age_chk,
  drop constraint advertising_targeting_policy_v1_privacy_chk,
  add constraint advertising_targeting_policy_core_privacy_chk check (
    advertiser_minimum_age=18 and audience_minimum_age between 13 and 18
    and minor_targeting_allowed=(audience_minimum_age<18)
    and not interest_targeting_enabled and not behavioral_targeting_enabled
    and not custom_audiences_enabled and not lookalike_targeting_enabled
    and not sensitive_targeting_allowed and not precise_viewer_location_matching_enabled
  ),
  add constraint advertising_targeting_policy_v3_safe_chk check (
    policy_version <> 'nelyon-ads-targeting-v3'
    or (
      advertiser_minimum_age=18 and audience_minimum_age=13
      and minor_targeting_allowed
      and not interest_targeting_enabled and not behavioral_targeting_enabled
      and not custom_audiences_enabled and not lookalike_targeting_enabled
      and not sensitive_targeting_allowed
      and not precise_viewer_location_matching_enabled
      and not geo_targeting_enabled and not language_targeting_enabled
      and daypart_targeting_enabled and frequency_targeting_enabled
    )
  );
alter table private.advertising_targeting_policy
  disable trigger advertising_targeting_policy_immutable;
update private.advertising_targeting_policy
set policy_version='nelyon-ads-targeting-v3',audience_minimum_age=13,
    minor_targeting_allowed=true,updated_at=pg_catalog.clock_timestamp()
where singleton;
alter table private.advertising_targeting_policy
  enable trigger advertising_targeting_policy_immutable;

create or replace function private.ads_normalize_audience_definition(p_definition jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_targeting_policy%rowtype;
  v_age_scope text;
  v_min_age integer;
  v_max_age integer;
  v_item jsonb;
  v_dayparts jsonb := '[]'::jsonb;
  v_frequency jsonb := null;
  v_timezone text;
  v_weekday integer;
  v_start_text text;
  v_end_text text;
  v_start time;
  v_end time;
  v_max_impressions integer;
  v_window_hours integer;
begin
  if p_definition is null or pg_catalog.jsonb_typeof(p_definition)<>'object' then
    raise exception using errcode='22023',message='advertising_audience_definition_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_definition) key
    where key not in ('age_scope','min_age','max_age','geographies','languages','dayparts','frequency')
  ) then
    raise exception using errcode='22023',message='advertising_audience_definition_unknown_key';
  end if;

  select * into strict v_policy from private.advertising_targeting_policy where singleton;
  if v_policy.policy_version<>'nelyon-ads-targeting-v3'
    or v_policy.advertiser_minimum_age<>18 or v_policy.audience_minimum_age<>13
    or not v_policy.minor_targeting_allowed
    or v_policy.interest_targeting_enabled or v_policy.behavioral_targeting_enabled
    or v_policy.custom_audiences_enabled or v_policy.lookalike_targeting_enabled
    or v_policy.sensitive_targeting_allowed or v_policy.precise_viewer_location_matching_enabled
    or v_policy.geo_targeting_enabled or v_policy.language_targeting_enabled
    or not v_policy.daypart_targeting_enabled or not v_policy.frequency_targeting_enabled then
    raise exception using errcode='55000',message='advertising_targeting_policy_not_safe';
  end if;

  v_age_scope := p_definition->>'age_scope';
  if v_age_scope='adults_only' then
    if (p_definition ? 'min_age' and (
        pg_catalog.jsonb_typeof(p_definition->'min_age')<>'number'
        or (p_definition->>'min_age')!~'^[0-9]+$'
        or (p_definition->>'min_age')::integer<>18
      )) or (p_definition ? 'max_age' and p_definition->'max_age'<>'null'::jsonb) then
      raise exception using errcode='22023',message='advertising_audience_adults_only_range_invalid';
    end if;
    v_min_age:=18;v_max_age:=null;
  elsif v_age_scope='age_range' then
    if not (p_definition ? 'min_age')
      or pg_catalog.jsonb_typeof(p_definition->'min_age')<>'number'
      or (p_definition->>'min_age')!~'^[0-9]+$' then
      raise exception using errcode='22023',message='advertising_audience_min_age_invalid';
    end if;
    v_min_age:=(p_definition->>'min_age')::integer;
    if v_min_age<v_policy.audience_minimum_age or v_min_age>120 then
      raise exception using errcode='22023',message='advertising_audience_min_age_invalid';
    end if;
    if not (p_definition ? 'max_age') or p_definition->'max_age'='null'::jsonb then
      v_max_age:=null;
    elsif pg_catalog.jsonb_typeof(p_definition->'max_age')='number'
      and (p_definition->>'max_age')~'^[0-9]+$' then
      v_max_age:=(p_definition->>'max_age')::integer;
    else
      raise exception using errcode='22023',message='advertising_audience_max_age_invalid';
    end if;
    if v_max_age is not null and (v_max_age<v_min_age or v_max_age>120) then
      raise exception using errcode='22023',message='advertising_audience_max_age_invalid';
    end if;
  else
    raise exception using errcode='22023',message='advertising_audience_age_scope_invalid';
  end if;

  if p_definition ? 'geographies' then
    if pg_catalog.jsonb_typeof(p_definition->'geographies')<>'array'
      or pg_catalog.jsonb_array_length(p_definition->'geographies')>100 then
      raise exception using errcode='22023',message='advertising_audience_geographies_invalid';
    end if;
    if pg_catalog.jsonb_array_length(p_definition->'geographies')>0 then
      raise exception using errcode='55000',message='advertising_audience_geo_targeting_not_enabled';
    end if;
  end if;
  if p_definition ? 'languages' then
    if pg_catalog.jsonb_typeof(p_definition->'languages')<>'array'
      or pg_catalog.jsonb_array_length(p_definition->'languages')>50 then
      raise exception using errcode='22023',message='advertising_audience_languages_invalid';
    end if;
    if pg_catalog.jsonb_array_length(p_definition->'languages')>0 then
      raise exception using errcode='55000',message='advertising_audience_language_targeting_not_enabled';
    end if;
  end if;

  if p_definition ? 'dayparts' then
    if pg_catalog.jsonb_typeof(p_definition->'dayparts')<>'array'
      or pg_catalog.jsonb_array_length(p_definition->'dayparts')>100 then
      raise exception using errcode='22023',message='advertising_audience_dayparts_invalid';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_definition->'dayparts')
    loop
      if pg_catalog.jsonb_typeof(v_item)<>'object' or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_item) key
        where key not in ('timezone','weekday','start','end')
      ) then
        raise exception using errcode='22023',message='advertising_audience_daypart_invalid';
      end if;
      v_timezone:=btrim(v_item->>'timezone');
      if pg_catalog.jsonb_typeof(v_item->'weekday')<>'number'
        or (v_item->>'weekday')!~'^[0-9]+$' then
        raise exception using errcode='22023',message='advertising_audience_weekday_invalid';
      end if;
      v_weekday:=(v_item->>'weekday')::integer;
      v_start_text:=v_item->>'start';v_end_text:=v_item->>'end';
      if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone)
        or v_weekday not between 1 and 7
        or v_start_text!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or v_end_text!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception using errcode='22023',message='advertising_audience_daypart_invalid';
      end if;
      v_start:=v_start_text::time;v_end:=v_end_text::time;
      if v_start>=v_end then
        raise exception using errcode='22023',message='advertising_audience_daypart_order_invalid';
      end if;
      v_dayparts:=v_dayparts||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'timezone',v_timezone,'weekday',v_weekday,
        'start',pg_catalog.to_char(v_start,'HH24:MI'),'end',pg_catalog.to_char(v_end,'HH24:MI')
      ));
    end loop;
  end if;

  if p_definition ? 'frequency' and p_definition->'frequency'<>'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_definition->'frequency')<>'object' or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_definition->'frequency') key
      where key not in ('max_impressions','window_hours')
    ) or pg_catalog.jsonb_typeof(p_definition->'frequency'->'max_impressions')<>'number'
      or (p_definition->'frequency'->>'max_impressions')!~'^[0-9]+$'
      or pg_catalog.jsonb_typeof(p_definition->'frequency'->'window_hours')<>'number'
      or (p_definition->'frequency'->>'window_hours')!~'^[0-9]+$' then
      raise exception using errcode='22023',message='advertising_audience_frequency_invalid';
    end if;
    v_max_impressions:=(p_definition->'frequency'->>'max_impressions')::integer;
    v_window_hours:=(p_definition->'frequency'->>'window_hours')::integer;
    if v_max_impressions not between 1 and 20 or v_window_hours not between 1 and 168 then
      raise exception using errcode='22023',message='advertising_audience_frequency_invalid';
    end if;
    v_frequency:=pg_catalog.jsonb_build_object('max_impressions',v_max_impressions,'window_hours',v_window_hours);
  end if;

  select coalesce(pg_catalog.jsonb_agg(value order by value::text),'[]'::jsonb)
  into v_dayparts from pg_catalog.jsonb_array_elements(v_dayparts);
  return pg_catalog.jsonb_build_object(
    'age_scope',v_age_scope,'min_age',v_min_age,'max_age',v_max_age,
    'targeting_policy_version',v_policy.policy_version,
    'geographies','[]'::jsonb,'languages','[]'::jsonb,
    'dayparts',v_dayparts,'frequency',v_frequency
  );
end;
$$;

revoke all on function private.ads_normalize_audience_definition(jsonb)
from public,anon,authenticated,service_role;

create or replace function private.ads_insert_audience_version(
  p_actor uuid,p_audience_id uuid,p_definition jsonb,p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience private.advertising_audiences;
  v_campaign_id uuid;v_normalized jsonb;v_fingerprint text;
  v_existing private.advertising_audience_versions;
  v_version private.advertising_audience_versions;
  v_version_number integer;v_item jsonb;
begin
  if p_actor is null or p_audience_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_audience_version_input_invalid';
  end if;
  select audience.* into v_audience
  from private.advertising_audiences audience
  join private.advertising_ad_sets ad_set on ad_set.id=audience.ad_set_id
  where audience.id=p_audience_id and audience.status='draft' and ad_set.status='draft'
  for update of audience;
  if not found then
    raise exception using errcode='42501',message='advertising_audience_draft_access_denied';
  end if;
  select campaign_id into strict v_campaign_id from private.advertising_ad_sets where id=v_audience.ad_set_id;
  perform 1 from private.ads_require_owned_draft_campaign(p_actor,v_campaign_id);
  v_normalized:=private.ads_normalize_audience_definition(p_definition);
  v_fingerprint:=private.ads_audience_definition_fingerprint(v_normalized);
  select * into v_existing from private.advertising_audience_versions
  where audience_id=p_audience_id and creation_idempotency_key=p_idempotency_key;
  if found then
    if v_existing.created_by is distinct from p_actor or v_existing.definition_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505',message='advertising_audience_version_idempotency_conflict';
    end if;
    return v_existing.id;
  end if;
  select coalesce(max(version_number),0)+1 into v_version_number
  from private.advertising_audience_versions where audience_id=p_audience_id;
  insert into private.advertising_audience_versions(
    audience_id,version_number,age_scope,min_age,max_age,targeting_policy_version,
    definition_fingerprint,creation_idempotency_key,created_by
  ) values (
    p_audience_id,v_version_number,v_normalized->>'age_scope',
    (v_normalized->>'min_age')::smallint,(v_normalized->>'max_age')::smallint,
    v_normalized->>'targeting_policy_version',v_fingerprint,p_idempotency_key,p_actor
  ) returning * into v_version;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_normalized->'dayparts') loop
    insert into private.advertising_daypart_windows(
      audience_version_id,timezone_name,weekday,start_local,end_local
    ) values (
      v_version.id,v_item->>'timezone',(v_item->>'weekday')::smallint,
      (v_item->>'start')::time,(v_item->>'end')::time
    );
  end loop;
  if v_normalized->'frequency'<>'null'::jsonb then
    insert into private.advertising_frequency_policies(audience_version_id,max_impressions,window_hours)
    values(v_version.id,(v_normalized->'frequency'->>'max_impressions')::integer,
      (v_normalized->'frequency'->>'window_hours')::integer);
  end if;
  return v_version.id;
end;
$$;

revoke all on function private.ads_insert_audience_version(uuid,uuid,jsonb,uuid)
from public,anon,authenticated,service_role;

-- Advance each current audience definition by one semantically-equivalent v3
-- version. Historical versions remain immutable and retain their original
-- policy/fingerprint; runtime readiness can continue using the latest version.
do $$
declare
  v_audience record;v_old private.advertising_audience_versions%rowtype;
  v_definition jsonb;v_normalized jsonb;v_new_id uuid;v_item record;
begin
  for v_audience in select id from private.advertising_audiences order by id loop
    select * into v_old from private.advertising_audience_versions
    where audience_id=v_audience.id order by version_number desc limit 1;
    if not found or v_old.targeting_policy_version='nelyon-ads-targeting-v3' then continue;end if;
    v_definition:=pg_catalog.jsonb_build_object(
      'age_scope','adults_only','min_age',18,'max_age',null,
      'geographies',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'mode',match_mode,'type',target_type,'country_code',country_code,'region_code',region_code,
        'city_name',city_name,'latitude',latitude,'longitude',longitude,'radius_km',radius_km
      ) order by id) from private.advertising_geo_targets where audience_version_id=v_old.id),'[]'::jsonb),
      'languages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'mode',match_mode,'tag',language_tag) order by id)
        from private.advertising_language_targets where audience_version_id=v_old.id),'[]'::jsonb),
      'dayparts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'timezone',timezone_name,'weekday',weekday,'start',pg_catalog.to_char(start_local,'HH24:MI'),
        'end',pg_catalog.to_char(end_local,'HH24:MI')) order by id)
        from private.advertising_daypart_windows where audience_version_id=v_old.id),'[]'::jsonb),
      'frequency',(select pg_catalog.jsonb_build_object('max_impressions',max_impressions,'window_hours',window_hours)
        from private.advertising_frequency_policies where audience_version_id=v_old.id)
    );
    v_normalized:=private.ads_normalize_audience_definition(v_definition);
    insert into private.advertising_audience_versions(
      audience_id,version_number,age_scope,min_age,max_age,targeting_policy_version,
      definition_fingerprint,creation_idempotency_key,created_by
    ) values(
      v_old.audience_id,v_old.version_number+1,'adults_only',18,null,'nelyon-ads-targeting-v3',
      private.ads_audience_definition_fingerprint(v_normalized),pg_catalog.gen_random_uuid(),v_old.created_by
    ) returning id into v_new_id;
    insert into private.advertising_geo_targets(
      audience_version_id,match_mode,target_type,country_code,region_code,city_name,latitude,longitude,radius_km
    ) select v_new_id,match_mode,target_type,country_code,region_code,city_name,latitude,longitude,radius_km
      from private.advertising_geo_targets where audience_version_id=v_old.id;
    insert into private.advertising_language_targets(audience_version_id,match_mode,language_tag)
      select v_new_id,match_mode,language_tag from private.advertising_language_targets where audience_version_id=v_old.id;
    insert into private.advertising_daypart_windows(audience_version_id,timezone_name,weekday,start_local,end_local)
      select v_new_id,timezone_name,weekday,start_local,end_local from private.advertising_daypart_windows where audience_version_id=v_old.id;
    insert into private.advertising_frequency_policies(audience_version_id,max_impressions,window_hours)
      select v_new_id,max_impressions,window_hours from private.advertising_frequency_policies where audience_version_id=v_old.id;
  end loop;
end;
$$;

create or replace function private.ads_audience_result(p_audience_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'audience_id',audience.id,'ad_set_id',audience.ad_set_id,'status',audience.status,
    'latest_version',case when version.id is null then null else pg_catalog.jsonb_build_object(
      'id',version.id,'version_number',version.version_number,'age_scope',version.age_scope,
      'min_age',version.min_age,'max_age',version.max_age,
      'targeting_policy_version',version.targeting_policy_version,
      'definition_fingerprint',version.definition_fingerprint,'created_at',version.created_at,
      'geographies',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'mode',geo.match_mode,'type',geo.target_type,'country_code',geo.country_code,
        'region_code',geo.region_code,'city_name',geo.city_name,'latitude',geo.latitude,
        'longitude',geo.longitude,'radius_km',geo.radius_km
      ) order by geo.match_mode,geo.target_type,geo.country_code,geo.id),'[]'::jsonb)
        from private.advertising_geo_targets geo where geo.audience_version_id=version.id),
      'languages',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'mode',language.match_mode,'tag',language.language_tag) order by language.match_mode,language.language_tag),'[]'::jsonb)
        from private.advertising_language_targets language where language.audience_version_id=version.id),
      'dayparts',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'timezone',daypart.timezone_name,'weekday',daypart.weekday,
        'start',pg_catalog.to_char(daypart.start_local,'HH24:MI'),
        'end',pg_catalog.to_char(daypart.end_local,'HH24:MI'))
        order by daypart.timezone_name,daypart.weekday,daypart.start_local,daypart.end_local),'[]'::jsonb)
        from private.advertising_daypart_windows daypart where daypart.audience_version_id=version.id),
      'frequency',(select pg_catalog.jsonb_build_object('max_impressions',frequency.max_impressions,
        'window_hours',frequency.window_hours) from private.advertising_frequency_policies frequency
        where frequency.audience_version_id=version.id)
    ) end,
    'capabilities',pg_catalog.jsonb_build_object(
      'delivery_implemented',true,'interest_targeting',false,'behavioral_targeting',false,
      'custom_audiences',false,'lookalikes',false,'minor_targeting',true,
      'precise_viewer_location_matching',false
    )
  )
  from private.advertising_audiences audience
  left join lateral(select candidate.* from private.advertising_audience_versions candidate
    where candidate.audience_id=audience.id order by candidate.version_number desc limit 1) version on true
  where audience.id=p_audience_id;
$$;

revoke all on function private.ads_audience_result(uuid)
from public,anon,authenticated,service_role;

create or replace function private.ads_delivery_viewer_matches_audience_age(
  p_audience_version_id uuid,p_viewer_user_id uuid,p_at_time timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version private.advertising_audience_versions%rowtype;
  v_eligibility private.user_age_eligibility%rowtype;
  v_age integer;v_as_of date:=(coalesce(p_at_time,pg_catalog.now()) at time zone 'UTC')::date;
begin
  if p_audience_version_id is null or p_viewer_user_id is null then return false;end if;
  select * into v_version from private.advertising_audience_versions where id=p_audience_version_id;
  if not found then return false;end if;
  if v_version.age_scope='adults_only' then
    return private.ads_delivery_viewer_is_adult(p_viewer_user_id);
  end if;
  select * into v_eligibility from private.user_age_eligibility where user_id=p_viewer_user_id;
  if not found or v_eligibility.status<>'eligible' or v_eligibility.birth_date is null
    or v_eligibility.minimum_age<>13 or v_eligibility.policy_version<>'nelyon-age-v2' then
    return false;
  end if;
  v_age:=extract(year from pg_catalog.age(v_as_of,v_eligibility.birth_date))::integer;
  return v_age>=v_version.min_age and (v_version.max_age is null or v_age<=v_version.max_age);
end;
$$;

revoke all on function private.ads_delivery_viewer_matches_audience_age(uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;

-- Delivery policy v4 replaces a global adults-only gate with the canonical
-- audience-version age predicate. All other fail-closed controls are retained.
alter table private.advertising_delivery_policy
  add constraint advertising_delivery_policy_v4_safe_chk check (
    policy_version<>'nelyon-ads-delivery-v4'
    or (require_authenticated_viewer and not require_adult_viewer and require_approved_ad
      and not geo_matching_enabled and not language_matching_enabled and frequency_enforcement_enabled)
  );
update private.advertising_delivery_policy
set policy_version='nelyon-ads-delivery-v4',require_adult_viewer=false,
    updated_at=pg_catalog.clock_timestamp()
where singleton;

alter function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
  rename to advertising_delivery_preflight_without_age_range_at;
revoke all on function private.advertising_delivery_preflight_without_age_range_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.advertising_delivery_preflight_structural_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;v_audience_version uuid;v_reasons jsonb;
begin
  v_result:=private.advertising_delivery_preflight_without_age_range_at(
    p_ad_id,p_placement_code,p_viewer_user_id,p_at_time
  );
  select version.id into v_audience_version
  from private.advertising_ads ad
  join private.advertising_audiences audience on audience.ad_set_id=ad.ad_set_id and audience.status='draft'
  join lateral(select candidate.id from private.advertising_audience_versions candidate
    where candidate.audience_id=audience.id order by candidate.version_number desc limit 1) version on true
  where ad.id=p_ad_id;
  if v_audience_version is not null and not private.ads_delivery_viewer_matches_audience_age(
      v_audience_version,p_viewer_user_id,p_at_time
    ) then
    v_reasons:=coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array('viewer_age_range_mismatch');
    v_result:=pg_catalog.jsonb_set(v_result,'{viewer_match}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',v_reasons,true);
  end if;
  return v_result;
end;
$$;

revoke all on function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function public.get_my_advertising_targeting_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid());v_policy private.advertising_targeting_policy%rowtype;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select * into strict v_policy from private.advertising_targeting_policy where singleton;
  return pg_catalog.jsonb_build_object(
    'policy_version',v_policy.policy_version,'advertiser_minimum_age',v_policy.advertiser_minimum_age,
    'audience_minimum_age',v_policy.audience_minimum_age,'audience_maximum_age',120,
    'age_scope','age_range','supports_open_upper_bound',true,
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

revoke all on function public.get_my_advertising_targeting_capabilities()
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_targeting_capabilities() to authenticated;

update private.advertising_placement_catalog
set adapter_version='ads-v2-plr-10',selection_enabled=true,
    v2_delivery_enabled=false,updated_at=pg_catalog.clock_timestamp()
where code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search');

create or replace function public.get_my_advertising_placement_capabilities_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid());v_launch_mode text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select launch_mode into strict v_launch_mode from private.advertising_canary_policy where singleton;
  return pg_catalog.jsonb_build_object(
    'authority','advertising_placement_catalog','launch_mode',v_launch_mode,
    'placements',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code',catalog.code,'label',catalog.label,'surface_family',catalog.surface_family,
      'selection_enabled',catalog.selection_enabled,
      'adapter_ready',catalog.adapter_version='ads-v2-plr-10',
      'production_delivery_enabled',catalog.v2_delivery_enabled,
      'status',case
        when catalog.status<>'active' or not catalog.surface_verified then 'not_available'
        when not catalog.selection_enabled then 'not_available'
        when catalog.v2_delivery_enabled then 'available'
        else 'selected_when_launched'
      end
    ) order by catalog.code) from private.advertising_placement_catalog catalog
      where catalog.code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search')),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_advertising_placement_capabilities_v2()
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_placement_capabilities_v2() to authenticated;

comment on column private.user_age_eligibility.birth_date is
  'Private canonical DOB used only for server-side age-range eligibility; never returned by Ads projections.';
comment on function private.ads_delivery_viewer_matches_audience_age(uuid,uuid,timestamptz) is
  'Server-only age-range matcher. Historical adults_only definitions use the canonical 18+ band; exact ranges require private DOB.';
comment on function public.get_my_advertising_placement_capabilities_v2() is
  'Authenticated advertiser projection of canonical placement adapter and current delivery state; it exposes no viewer data.';

do $$
begin
  if (select launch_mode from private.advertising_canary_policy where singleton)<>'DISARMED'
    or exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled)
    or (select global_v2_delivery_enabled from private.advertising_delivery_policy where singleton)
    or (select funding_enabled or spend_enabled or settlement_enabled from private.advertising_finance_policy where singleton)
    or (select activation_enabled or automatic_transitions_enabled from private.advertising_campaign_lifecycle_policy where singleton) then
    raise exception 'ads_v2_plr_10_disarmed_postcondition_failed';
  end if;
  if (select count(*) from private.advertising_placement_catalog
      where code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search')
        and selection_enabled and adapter_version='ads-v2-plr-10' and not v2_delivery_enabled)<>6 then
    raise exception 'ads_v2_plr_10_adapter_postcondition_failed';
  end if;
end;
$$;

commit;
