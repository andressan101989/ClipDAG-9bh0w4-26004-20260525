begin;

-- Extend the one existing Ads audience-version authority. Historical V3
-- versions remain immutable and are not rewritten by this migration.
create table private.advertising_interest_targets (
  id uuid primary key default gen_random_uuid(),
  audience_version_id uuid not null references private.advertising_audience_versions(id),
  match_mode text not null check (match_mode in ('include','exclude')),
  interest_id uuid not null references private.personalization_interest_taxonomy(id),
  signal_source text not null check (signal_source in ('explicit','behavioral','either')),
  created_at timestamptz not null default clock_timestamp(),
  constraint advertising_interest_targets_unique
    unique (audience_version_id,match_mode,interest_id,signal_source)
);
create index advertising_interest_targets_version_idx
  on private.advertising_interest_targets(audience_version_id);
alter table private.advertising_interest_targets enable row level security;
alter table private.advertising_interest_targets force row level security;
revoke all on table private.advertising_interest_targets from public,anon,authenticated,service_role;
create trigger advertising_interest_targets_immutable
before update or delete on private.advertising_interest_targets
for each row execute function private.advertising_audience_definition_immutable();

alter table private.advertising_targeting_policy
  drop constraint advertising_targeting_policy_core_privacy_chk;
alter table private.advertising_targeting_policy
  add constraint advertising_targeting_policy_core_privacy_chk check (
    advertiser_minimum_age=18 and audience_minimum_age between 13 and 18
    and minor_targeting_allowed=(audience_minimum_age<18)
    and not custom_audiences_enabled and not lookalike_targeting_enabled
    and not sensitive_targeting_allowed
    and not precise_viewer_location_matching_enabled
  ),
  add constraint advertising_targeting_policy_v4_safe_chk check (
    policy_version<>'nelyon-ads-targeting-v4' or (
      advertiser_minimum_age=18 and audience_minimum_age=13 and minor_targeting_allowed
      and interest_targeting_enabled and behavioral_targeting_enabled
      and geo_targeting_enabled and language_targeting_enabled
      and daypart_targeting_enabled and frequency_targeting_enabled
      and not custom_audiences_enabled and not lookalike_targeting_enabled
      and sensitive_targeting_allowed=false
      and precise_viewer_location_matching_enabled=false
    )
  );
alter table private.advertising_targeting_policy disable trigger advertising_targeting_policy_immutable;
update private.advertising_targeting_policy
set policy_version='nelyon-ads-targeting-v4',
    interest_targeting_enabled=true,behavioral_targeting_enabled=true,
    geo_targeting_enabled=true,language_targeting_enabled=true,
    updated_at=clock_timestamp()
where singleton;
alter table private.advertising_targeting_policy enable trigger advertising_targeting_policy_immutable;

create or replace function private.ads_normalize_audience_definition(p_definition jsonb)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_policy private.advertising_targeting_policy%rowtype;
  v_age_scope text;v_min_age integer;v_max_age integer;v_item jsonb;
  v_geo jsonb:='[]'::jsonb;v_languages jsonb:='[]'::jsonb;v_interests jsonb:='[]'::jsonb;
  v_dayparts jsonb:='[]'::jsonb;v_frequency jsonb:=null;
  v_mode text;v_country text;v_tag text;v_slug text;v_source text;
  v_timezone text;v_weekday integer;v_start_text text;v_end_text text;
  v_start time;v_end time;v_max_impressions integer;v_window_hours integer;
begin
  if p_definition is null or jsonb_typeof(p_definition)<>'object' then
    raise exception using errcode='22023',message='advertising_audience_definition_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_definition) key
    where key not in ('age_scope','min_age','max_age','geographies','languages','interests','dayparts','frequency')) then
    raise exception using errcode='22023',message='advertising_audience_definition_unknown_key';
  end if;
  select * into strict v_policy from private.advertising_targeting_policy where singleton;
  if v_policy.policy_version<>'nelyon-ads-targeting-v4'
    or not v_policy.interest_targeting_enabled or not v_policy.behavioral_targeting_enabled
    or not v_policy.geo_targeting_enabled or not v_policy.language_targeting_enabled
    or v_policy.sensitive_targeting_allowed or v_policy.precise_viewer_location_matching_enabled then
    raise exception using errcode='55000',message='advertising_targeting_policy_not_safe';
  end if;

  v_age_scope:=p_definition->>'age_scope';
  if v_age_scope='adults_only' then
    if (p_definition?'min_age' and (
        jsonb_typeof(p_definition->'min_age')<>'number'
        or (p_definition->>'min_age')!~'^[0-9]+$'
        or (p_definition->>'min_age')::integer<>18
      )) or (p_definition?'max_age' and p_definition->'max_age'<>'null'::jsonb) then
      raise exception using errcode='22023',message='advertising_audience_adults_only_range_invalid';
    end if;
    v_min_age:=18;v_max_age:=null;
  elsif v_age_scope='age_range' then
    if jsonb_typeof(p_definition->'min_age')<>'number' or (p_definition->>'min_age')!~'^[0-9]+$' then
      raise exception using errcode='22023',message='advertising_audience_min_age_invalid';
    end if;
    v_min_age:=(p_definition->>'min_age')::integer;
    if v_min_age<v_policy.audience_minimum_age or v_min_age>120 then
      raise exception using errcode='22023',message='advertising_audience_min_age_invalid';
    end if;
    if not(p_definition?'max_age') or p_definition->'max_age'='null'::jsonb then v_max_age:=null;
    elsif jsonb_typeof(p_definition->'max_age')='number' and (p_definition->>'max_age')~'^[0-9]+$' then
      v_max_age:=(p_definition->>'max_age')::integer;
    else raise exception using errcode='22023',message='advertising_audience_max_age_invalid'; end if;
    if v_max_age is not null and (v_max_age<v_min_age or v_max_age>120) then
      raise exception using errcode='22023',message='advertising_audience_max_age_invalid';
    end if;
  else raise exception using errcode='22023',message='advertising_audience_age_scope_invalid'; end if;

  if p_definition?'geographies' then
    if jsonb_typeof(p_definition->'geographies')<>'array' or jsonb_array_length(p_definition->'geographies')>25 then
      raise exception using errcode='22023',message='advertising_audience_geographies_invalid';
    end if;
    for v_item in select value from jsonb_array_elements(p_definition->'geographies') loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) key
        where key not in ('mode','type','country_code')) then
        raise exception using errcode='22023',message='advertising_audience_broad_region_invalid';
      end if;
      v_mode:=lower(btrim(v_item->>'mode'));v_country:=upper(btrim(v_item->>'country_code'));
      if v_mode not in ('include','exclude') or v_item->>'type'<>'country' or v_country!~'^[A-Z]{2}$' then
        raise exception using errcode='22023',message='advertising_audience_broad_region_invalid';
      end if;
      v_geo:=v_geo||jsonb_build_array(jsonb_build_object('mode',v_mode,'type','country','country_code',v_country));
    end loop;
  end if;

  if p_definition?'languages' then
    if jsonb_typeof(p_definition->'languages')<>'array' or jsonb_array_length(p_definition->'languages')>10 then
      raise exception using errcode='22023',message='advertising_audience_languages_invalid';
    end if;
    for v_item in select value from jsonb_array_elements(p_definition->'languages') loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) key where key not in ('mode','tag')) then
        raise exception using errcode='22023',message='advertising_audience_language_invalid';
      end if;
      v_mode:=lower(btrim(v_item->>'mode'));v_tag:=lower(btrim(v_item->>'tag'));
      if v_mode not in ('include','exclude') or v_tag!~'^[a-z]{2,3}(-[a-z0-9]{2,8})*$' then
        raise exception using errcode='22023',message='advertising_audience_language_invalid';
      end if;
      v_languages:=v_languages||jsonb_build_array(jsonb_build_object('mode',v_mode,'tag',v_tag));
    end loop;
  end if;

  if p_definition?'interests' then
    if jsonb_typeof(p_definition->'interests')<>'array' or jsonb_array_length(p_definition->'interests')>20 then
      raise exception using errcode='22023',message='advertising_audience_invalid_interest';
    end if;
    for v_item in select value from jsonb_array_elements(p_definition->'interests') loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) key
        where key not in ('mode','slug','source')) then
        raise exception using errcode='22023',message='advertising_audience_invalid_interest';
      end if;
      v_mode:=lower(btrim(v_item->>'mode'));v_slug:=lower(btrim(v_item->>'slug'));
      v_source:=coalesce(lower(btrim(v_item->>'source')),'either');
      if v_mode not in ('include','exclude') or v_source not in ('explicit','behavioral','either')
        or not exists(select 1 from private.personalization_interest_taxonomy t
          where t.slug=v_slug and t.active and t.minor_safe and t.ads_eligible) then
        raise exception using errcode='22023',message='advertising_audience_unknown_interest_or_interest_not_ads_eligible';
      end if;
      v_interests:=v_interests||jsonb_build_array(jsonb_build_object('mode',v_mode,'slug',v_slug,'source',v_source));
    end loop;
  end if;

  if p_definition?'dayparts' then
    if jsonb_typeof(p_definition->'dayparts')<>'array' or jsonb_array_length(p_definition->'dayparts')>100 then
      raise exception using errcode='22023',message='advertising_audience_dayparts_invalid';
    end if;
    for v_item in select value from jsonb_array_elements(p_definition->'dayparts') loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) key
        where key not in ('timezone','weekday','start','end')) then
        raise exception using errcode='22023',message='advertising_audience_daypart_invalid';
      end if;
      v_timezone:=btrim(v_item->>'timezone');v_start_text:=v_item->>'start';v_end_text:=v_item->>'end';
      if jsonb_typeof(v_item->'weekday')<>'number' or (v_item->>'weekday')!~'^[0-9]+$' then
        raise exception using errcode='22023',message='advertising_audience_daypart_invalid';
      end if;
      v_weekday:=(v_item->>'weekday')::integer;
      if not exists(select 1 from pg_timezone_names where name=v_timezone) or v_weekday not between 1 and 7
        or v_start_text!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end_text!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception using errcode='22023',message='advertising_audience_daypart_invalid';
      end if;
      v_start:=v_start_text::time;v_end:=v_end_text::time;
      if v_start>=v_end then raise exception using errcode='22023',message='advertising_audience_daypart_order_invalid'; end if;
      v_dayparts:=v_dayparts||jsonb_build_array(jsonb_build_object('timezone',v_timezone,'weekday',v_weekday,'start',to_char(v_start,'HH24:MI'),'end',to_char(v_end,'HH24:MI')));
    end loop;
  end if;
  if p_definition?'frequency' and p_definition->'frequency'<>'null'::jsonb then
    if jsonb_typeof(p_definition->'frequency')<>'object'
      or exists(select 1 from jsonb_object_keys(p_definition->'frequency') key
        where key not in ('max_impressions','window_hours'))
      or jsonb_typeof(p_definition->'frequency'->'max_impressions')<>'number'
      or (p_definition->'frequency'->>'max_impressions')!~'^[0-9]+$'
      or jsonb_typeof(p_definition->'frequency'->'window_hours')<>'number'
      or (p_definition->'frequency'->>'window_hours')!~'^[0-9]+$' then
      raise exception using errcode='22023',message='advertising_audience_frequency_invalid';
    end if;
    v_max_impressions:=(p_definition->'frequency'->>'max_impressions')::integer;
    v_window_hours:=(p_definition->'frequency'->>'window_hours')::integer;
    if v_max_impressions not between 1 and 20 or v_window_hours not between 1 and 168 then
      raise exception using errcode='22023',message='advertising_audience_frequency_invalid';
    end if;
    v_frequency:=jsonb_build_object('max_impressions',v_max_impressions,'window_hours',v_window_hours);
  end if;
  select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into v_geo from jsonb_array_elements(v_geo);
  select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into v_languages from jsonb_array_elements(v_languages);
  select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into v_interests from jsonb_array_elements(v_interests);
  select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into v_dayparts from jsonb_array_elements(v_dayparts);
  return jsonb_build_object('age_scope',v_age_scope,'min_age',v_min_age,'max_age',v_max_age,
    'targeting_policy_version','nelyon-ads-targeting-v4','geographies',v_geo,
    'languages',v_languages,'interests',v_interests,'dayparts',v_dayparts,'frequency',v_frequency);
end;
$$;
revoke all on function private.ads_normalize_audience_definition(jsonb) from public,anon,authenticated,service_role;

create or replace function private.ads_insert_audience_version(
  p_actor uuid,p_audience_id uuid,p_definition jsonb,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_audience private.advertising_audiences;v_campaign_id uuid;v_normalized jsonb;v_fingerprint text;
  v_existing private.advertising_audience_versions;v_version private.advertising_audience_versions;
  v_number integer;v_item jsonb;v_interest_id uuid;
begin
  if p_actor is null or p_audience_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_audience_version_input_invalid';
  end if;
  select audience.* into v_audience from private.advertising_audiences audience
  join private.advertising_ad_sets ad_set on ad_set.id=audience.ad_set_id
  where audience.id=p_audience_id and audience.status='draft' and ad_set.status='draft' for update of audience;
  if not found then raise exception using errcode='42501',message='advertising_audience_draft_access_denied'; end if;
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
  select coalesce(max(version_number),0)+1 into v_number from private.advertising_audience_versions where audience_id=p_audience_id;
  insert into private.advertising_audience_versions(audience_id,version_number,age_scope,min_age,max_age,
    targeting_policy_version,definition_fingerprint,creation_idempotency_key,created_by)
  values(p_audience_id,v_number,v_normalized->>'age_scope',(v_normalized->>'min_age')::smallint,
    (v_normalized->>'max_age')::smallint,'nelyon-ads-targeting-v4',v_fingerprint,p_idempotency_key,p_actor)
  returning * into v_version;
  for v_item in select value from jsonb_array_elements(v_normalized->'geographies') loop
    insert into private.advertising_geo_targets(audience_version_id,match_mode,target_type,country_code)
    values(v_version.id,v_item->>'mode','country',v_item->>'country_code');
  end loop;
  for v_item in select value from jsonb_array_elements(v_normalized->'languages') loop
    insert into private.advertising_language_targets(audience_version_id,match_mode,language_tag)
    values(v_version.id,v_item->>'mode',v_item->>'tag');
  end loop;
  for v_item in select value from jsonb_array_elements(v_normalized->'interests') loop
    select id into strict v_interest_id from private.personalization_interest_taxonomy where slug=v_item->>'slug';
    insert into private.advertising_interest_targets(audience_version_id,match_mode,interest_id,signal_source)
    values(v_version.id,v_item->>'mode',v_interest_id,v_item->>'source');
  end loop;
  for v_item in select value from jsonb_array_elements(v_normalized->'dayparts') loop
    insert into private.advertising_daypart_windows(audience_version_id,timezone_name,weekday,start_local,end_local)
    values(v_version.id,v_item->>'timezone',(v_item->>'weekday')::smallint,(v_item->>'start')::time,(v_item->>'end')::time);
  end loop;
  if v_normalized->'frequency'<>'null'::jsonb then
    insert into private.advertising_frequency_policies(audience_version_id,max_impressions,window_hours)
    values(v_version.id,(v_normalized->'frequency'->>'max_impressions')::integer,(v_normalized->'frequency'->>'window_hours')::integer);
  end if;
  return v_version.id;
end;
$$;
revoke all on function private.ads_insert_audience_version(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function private.ads_audience_result(p_audience_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
select jsonb_build_object('audience_id',a.id,'ad_set_id',a.ad_set_id,'status',a.status,
  'latest_version',case when v.id is null then null else jsonb_build_object(
    'id',v.id,'version_number',v.version_number,'age_scope',v.age_scope,'min_age',v.min_age,'max_age',v.max_age,
    'targeting_policy_version',v.targeting_policy_version,'definition_fingerprint',v.definition_fingerprint,
    'created_at',v.created_at,
    'geographies',coalesce((select jsonb_agg(jsonb_build_object('mode',g.match_mode,'type','country','country_code',g.country_code) order by g.id)
      from private.advertising_geo_targets g where g.audience_version_id=v.id and g.target_type='country'),'[]'::jsonb),
    'languages',coalesce((select jsonb_agg(jsonb_build_object('mode',l.match_mode,'tag',l.language_tag) order by l.id)
      from private.advertising_language_targets l where l.audience_version_id=v.id),'[]'::jsonb),
    'interests',coalesce((select jsonb_agg(jsonb_build_object('mode',i.match_mode,'slug',t.slug,'source',i.signal_source) order by i.id)
      from private.advertising_interest_targets i join private.personalization_interest_taxonomy t on t.id=i.interest_id
      where i.audience_version_id=v.id),'[]'::jsonb),
    'dayparts',coalesce((select jsonb_agg(jsonb_build_object('timezone',d.timezone_name,'weekday',d.weekday,
      'start',to_char(d.start_local,'HH24:MI'),'end',to_char(d.end_local,'HH24:MI')) order by d.id)
      from private.advertising_daypart_windows d where d.audience_version_id=v.id),'[]'::jsonb),
    'frequency',(select jsonb_build_object('max_impressions',f.max_impressions,'window_hours',f.window_hours)
      from private.advertising_frequency_policies f where f.audience_version_id=v.id)
  ) end,
  'capabilities',jsonb_build_object('interest_targeting',true,'behavioral_targeting',true,
    'language_targeting',true,'broad_region_targeting',true,'sensitive_targeting',false,
    'precise_viewer_location_matching',false))
from private.advertising_audiences a
left join lateral(select x.* from private.advertising_audience_versions x where x.audience_id=a.id
  order by x.version_number desc limit 1)v on true where a.id=p_audience_id;
$$;
revoke all on function private.ads_audience_result(uuid) from public,anon,authenticated,service_role;

-- One privacy-safe trait resolver is shared by organic preferences and Ads.
-- It returns only safe taxonomy slugs and broad declared traits, never raw
-- history, watched content identifiers, or private vector values.
create function private.resolve_safe_personalization_traits_v1(p_user_id uuid,p_at_time timestamptz default clock_timestamp())
returns jsonb language sql stable security definer set search_path=''
as $$
with profile as materialized (
  select p.*,(e.status='eligible' and e.age_band='age_18_plus') adult
  from private.user_personalization_profiles p
  join private.user_age_eligibility e on e.user_id=p.user_id
  where p.user_id=p_user_id and p.onboarding_completed_at is not null
), explicit as materialized (
  select coalesce(jsonb_agg(t.slug order by t.slug),'[]'::jsonb) slugs
  from profile p join private.user_personalization_interests ui on ui.user_id=p.user_id
  join private.personalization_interest_taxonomy t on t.id=ui.interest_id
  where p.adult and p.ads_personalization_consent and t.active and t.minor_safe and t.ads_eligible
), positive_videos as materialized (
  select distinct signal.video_id from profile p cross join lateral (
    select v.video_id from public.video_views v where v.viewer_id=p.user_id and v.created_at<=p_at_time
      and v.media_duration_ms>0 and v.completion_ratio is not null
      and (v.completed or coalesce(v.rewatch_count,0)>0 or v.completion_ratio>=0.50)
    union select l.video_id from public.likes l where l.user_id=p.user_id and l.created_at<=p_at_time
    union select s.video_id from public.video_saves s where s.user_id=p.user_id and s.created_at<=p_at_time
  ) signal where p.adult and p.ads_personalization_consent limit 50
), centroid as materialized (
  select extensions.avg(s.embedding) embedding from positive_videos p
  join private.video_semantic_profiles s on s.video_id=p.video_id
  where s.status='ready' and s.provider='cloudflare_workers_ai' and s.model='@cf/baai/bge-m3'
    and s.embedding_dimensions=1024 and s.embedding is not null and s.completed_at<=p_at_time
), inferred as materialized (
  select coalesce(jsonb_agg(slug order by similarity desc,slug),'[]'::jsonb) slugs from (
    select t.slug,1-(t.embedding operator(extensions.<=>) c.embedding) similarity from centroid c
    join private.personalization_interest_taxonomy t on t.active and t.minor_safe and t.ads_eligible
      and t.embedding_status='ready' and t.embedding is not null
    where c.embedding is not null and 1-(t.embedding operator(extensions.<=>) c.embedding)>=0.35
    order by similarity desc,t.slug limit 8
  ) ranked
)
select jsonb_build_object('eligible',coalesce(p.adult and p.ads_personalization_consent,false),
  'ads_personalization_consent',coalesce(p.ads_personalization_consent,false),
  'primary_language_tag',p.primary_language_tag,'additional_language_tags',coalesce(to_jsonb(p.additional_language_tags),'[]'::jsonb),
  'content_region_code',p.content_region_code,'explicit_interest_slugs',coalesce(e.slugs,'[]'::jsonb),
  'behavioral_interest_slugs',coalesce(i.slugs,'[]'::jsonb))
from profile p left join explicit e on true left join inferred i on true;
$$;
revoke all on function private.resolve_safe_personalization_traits_v1(uuid,timestamptz) from public,anon,authenticated,service_role;

create function private.ads_v4_viewer_matches_personalization(
  p_audience_version_id uuid,p_viewer_user_id uuid,p_at_time timestamptz
) returns boolean language plpgsql stable security definer set search_path=''
as $$
declare v_traits jsonb;v_has_targets boolean;v_has_interest_targets boolean;
  v_languages text[];v_explicit text[];v_behavioral text[];v_region text;
begin
  select exists(select 1 from private.advertising_interest_targets where audience_version_id=p_audience_version_id),
    exists(select 1 from private.advertising_interest_targets where audience_version_id=p_audience_version_id)
    or exists(select 1 from private.advertising_language_targets where audience_version_id=p_audience_version_id)
    or exists(select 1 from private.advertising_geo_targets where audience_version_id=p_audience_version_id)
    into v_has_interest_targets,v_has_targets;
  if not v_has_targets then return true; end if;
  if p_viewer_user_id is null then return false; end if;
  v_traits:=private.resolve_safe_personalization_traits_v1(p_viewer_user_id,p_at_time);
  if v_traits is null then return false; end if;
  -- Language and broad self-declared country remain contextual. Any explicit
  -- or inferred interest target is adult-and-consent gated, so minors can
  -- never match an interest audience even when its taxonomy is minor-safe.
  if v_has_interest_targets
    and coalesce((v_traits->>'eligible')::boolean,false) is not true then return false; end if;
  select array_agg(value) into v_languages from (
    select v_traits->>'primary_language_tag' value union
    select jsonb_array_elements_text(coalesce(v_traits->'additional_language_tags','[]'::jsonb))
  )x where value is not null;
  select array_agg(value) into v_explicit from jsonb_array_elements_text(coalesce(v_traits->'explicit_interest_slugs','[]'::jsonb));
  select array_agg(value) into v_behavioral from jsonb_array_elements_text(coalesce(v_traits->'behavioral_interest_slugs','[]'::jsonb));
  v_region:=v_traits->>'content_region_code';
  if exists(select 1 from private.advertising_language_targets l where l.audience_version_id=p_audience_version_id and l.match_mode='exclude' and l.language_tag=any(coalesce(v_languages,array[]::text[]))) then return false; end if;
  if exists(select 1 from private.advertising_language_targets l where l.audience_version_id=p_audience_version_id and l.match_mode='include')
    and not exists(select 1 from private.advertising_language_targets l where l.audience_version_id=p_audience_version_id and l.match_mode='include' and l.language_tag=any(coalesce(v_languages,array[]::text[]))) then return false; end if;
  if exists(select 1 from private.advertising_geo_targets g where g.audience_version_id=p_audience_version_id and g.match_mode='exclude' and g.country_code=v_region) then return false; end if;
  if exists(select 1 from private.advertising_geo_targets g where g.audience_version_id=p_audience_version_id and g.match_mode='include')
    and not exists(select 1 from private.advertising_geo_targets g where g.audience_version_id=p_audience_version_id and g.match_mode='include' and g.country_code=v_region) then return false; end if;
  if exists(select 1 from private.advertising_interest_targets i join private.personalization_interest_taxonomy t on t.id=i.interest_id
      where i.audience_version_id=p_audience_version_id and i.match_mode='exclude' and
      ((i.signal_source in('explicit','either') and t.slug=any(coalesce(v_explicit,array[]::text[]))) or
       (i.signal_source in('behavioral','either') and t.slug=any(coalesce(v_behavioral,array[]::text[]))))) then return false; end if;
  if exists(select 1 from private.advertising_interest_targets i where i.audience_version_id=p_audience_version_id and i.match_mode='include')
    and not exists(select 1 from private.advertising_interest_targets i join private.personalization_interest_taxonomy t on t.id=i.interest_id
      where i.audience_version_id=p_audience_version_id and i.match_mode='include' and
      ((i.signal_source in('explicit','either') and t.slug=any(coalesce(v_explicit,array[]::text[]))) or
       (i.signal_source in('behavioral','either') and t.slug=any(coalesce(v_behavioral,array[]::text[]))))) then return false; end if;
  return true;
end;
$$;
revoke all on function private.ads_v4_viewer_matches_personalization(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

alter function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
  rename to advertising_delivery_preflight_before_personalization_v4_at;
revoke all on function private.advertising_delivery_preflight_before_personalization_v4_at(uuid,text,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function private.advertising_delivery_preflight_structural_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;v_version uuid;v_policy text;v_reasons text[];v_structural boolean;v_viewer boolean;v_production boolean;
begin
  v_result:=private.advertising_delivery_preflight_before_personalization_v4_at(p_ad_id,p_placement_code,p_viewer_user_id,p_at_time);
  select version.id,version.targeting_policy_version into v_version,v_policy
  from private.advertising_ads ad join private.advertising_audiences a on a.ad_set_id=ad.ad_set_id and a.status='draft'
  join lateral(select x.id,x.targeting_policy_version from private.advertising_audience_versions x
    where x.audience_id=a.id order by x.version_number desc limit 1)version on true where ad.id=p_ad_id;
  select coalesce(array_agg(value),array[]::text[]) into v_reasons from jsonb_array_elements_text(coalesce(v_result->'reason_codes','[]'::jsonb));
  if v_policy in ('nelyon-ads-targeting-v3','nelyon-ads-targeting-v4') then
    v_reasons:=array_remove(v_reasons,'audience_targeting_policy_stale');
  end if;
  if v_policy='nelyon-ads-targeting-v4' then
    v_reasons:=array_remove(array_remove(v_reasons,'viewer_geo_authority_unavailable'),'viewer_language_authority_unavailable');
    if not private.ads_v4_viewer_matches_personalization(v_version,p_viewer_user_id,p_at_time) then
      v_reasons:=array_append(v_reasons,'viewer_personalization_mismatch');
    end if;
  end if;
  v_structural:=not(v_reasons&&array['ad_not_found','business_inactive','ad_account_inactive','advertiser_adult_eligibility_required',
    'campaign_paused','campaign_completed','campaign_cancelled','campaign_unavailable','campaign_not_active','ad_set_unavailable',
    'ad_set_outside_schedule','campaign_finance_not_funded','campaign_budget_exhausted','ad_unavailable','ad_not_approved',
    'ad_review_fingerprint_mismatch','creative_unavailable','destination_unavailable','same_authority_violation',
    'creative_media_unavailable','audience_version_missing','audience_targeting_policy_stale','placement_selection_missing',
    'placement_unknown','placement_surface_unavailable','placement_not_selected','advertising_canary_restriction']::text[]);
  v_viewer:=not(v_reasons&&array['authenticated_viewer_required','viewer_adult_eligibility_required','viewer_age_range_mismatch',
    'viewer_geo_authority_unavailable','viewer_language_authority_unavailable','viewer_personalization_mismatch',
    'frequency_enforcement_disabled','frequency_cap_reached','outside_daypart']::text[]);
  v_production:=v_structural and v_viewer and not(v_reasons&&array['global_delivery_disabled','placement_v2_delivery_disabled']::text[]);
  return jsonb_build_object('structurally_ready',v_structural,'viewer_match',v_viewer,
    'production_deliverable',v_production,'reason_codes',coalesce((select jsonb_agg(distinct reason order by reason) from unnest(v_reasons)reason),'[]'::jsonb));
end;
$$;
revoke all on function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.get_my_advertising_targeting_capabilities()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());v_policy private.advertising_targeting_policy%rowtype;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select * into strict v_policy from private.advertising_targeting_policy where singleton;
  return jsonb_build_object('policy_version',v_policy.policy_version,'advertiser_minimum_age',18,
    'audience_minimum_age',13,'audience_maximum_age',120,'age_scope','age_range','supports_open_upper_bound',true,
    'geo_targeting_enabled',v_policy.geo_targeting_enabled,'language_targeting_enabled',v_policy.language_targeting_enabled,
    'daypart_targeting_enabled',v_policy.daypart_targeting_enabled,'frequency_targeting_enabled',v_policy.frequency_targeting_enabled,
    'interest_targeting_enabled',v_policy.interest_targeting_enabled,'behavioral_targeting_enabled',v_policy.behavioral_targeting_enabled,
    'custom_audiences_enabled',false,'lookalike_targeting_enabled',false,'sensitive_targeting_allowed',false,
    'precise_viewer_location_matching_enabled',false,
    'interest_catalog',coalesce((select jsonb_agg(jsonb_build_object('slug',t.slug,'label',t.labels->>'en') order by t.sort_order,t.slug)
      from private.personalization_interest_taxonomy t where t.active and t.minor_safe and t.ads_eligible),'[]'::jsonb));
end;
$$;
revoke all on function public.get_my_advertising_targeting_capabilities() from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_targeting_capabilities() to authenticated;

-- Extend the one ALGO reconciler with non-duplicate macro authorities. The
-- three historical F4 readiness checks are retained under their original keys
-- but now validate V2, which is the sole public readiness authority.
alter function public.reconcile_algo_l1_v1() set schema private;
alter function private.reconcile_algo_l1_v1() rename to reconcile_algo_l1_f4_v1;
revoke all on function private.reconcile_algo_l1_f4_v1() from public,anon,authenticated,service_role;

create function public.reconcile_algo_l1_v1()
returns jsonb language sql stable security definer set search_path=''
as $$
with base as materialized(select private.reconcile_algo_l1_f4_v1() result),
readiness as materialized(
  select p.oid,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_algo6_l6_training_readiness_v2'
    and pg_get_function_identity_arguments(p.oid)=''
), ranker as materialized(
  select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.oid=to_regprocedure('public.get_ranked_feed_l1_v1(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text)')
)
select (base.result-array['l6_training_readiness_authority_missing','l6_training_readiness_contract_invalid',
  'l6_training_readiness_forbidden_dependency_present','l6_observation_ranking_contract_missing']) || jsonb_build_object(
  'l6_training_readiness_authority_missing',(select case when count(*)=1 and bool_and(prosecdef
    and coalesce(proconfig,'{}'::text[])@>array['search_path=""']::text[]
    and has_function_privilege('service_role',oid,'execute')
    and not has_function_privilege('public',oid,'execute') and not has_function_privilege('anon',oid,'execute')
    and not has_function_privilege('authenticated',oid,'execute')) then 0 else 1 end from readiness),
  'l6_training_readiness_contract_invalid',(select case when count(*)=1 and bool_and(
    strpos(lower(definition),'algo6-l6-training-readiness-v2')>0
    and strpos(lower(definition),'organic-ranking-features-personalization-v2')>0
    and strpos(lower(definition),'algo6-l6-label-contract-v1')>0
    and strpos(lower(definition),'training_entry_ready')>0) then 0 else 1 end from readiness),
  'l6_training_readiness_forbidden_dependency_present',(select count(*) from readiness where lower(definition)~
    'marketplace_|financial_transactions|ledger_entries|ledger_accounts|wallet|escrow|stripe|creator_earnings|public\\.messages|private_chat|device_fingerprint|network_type'),
  'l6_observation_ranking_contract_missing',(select case when count(*)=1 and bool_and(
    strpos(lower(definition),'ranking_decision_id')>0 and strpos(lower(definition),'ranking_organic_position')>0
    and strpos(lower(definition),'record_organic_ranking_decision_v1')>0
    and strpos(lower(definition),'organic-ranking-features-personalization-v2')>0)
    then 0 else 1 end from ranker),
  'personalization_authority_missing',(select case when count(*)=3 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
    then 0 else 1 end from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in('personalization_interest_taxonomy','user_personalization_profiles','user_personalization_interests')),
  'personalization_taxonomy_invalid',(select count(*) from private.personalization_interest_taxonomy t
    where t.slug<>lower(t.slug) or jsonb_typeof(t.labels)<>'object' or not t.minor_safe
      or (t.embedding_status='ready' and (t.embedding is null or t.embedding_dimensions<>1024
        or t.embedding_provider<>'cloudflare_workers_ai' or t.embedding_model<>'@cf/baai/bge-m3'))),
  'personalization_onboarding_contract_missing',(select case when count(*)=5 then 0 else 1 end from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
      'get_my_personalization_onboarding_v1','get_personalization_onboarding_catalog_v1',
      'save_my_personalization_preferences_v1','complete_my_personalization_onboarding_v1',
      'get_my_onboarding_creator_recommendations_v1')),
  'personalization_ranking_contract_missing',(select case when count(*)=1 and bool_and(
    strpos(lower(definition),'explicit_interest_similarity')>0 and strpos(lower(definition),'explicit_seed_weight')>0
    and strpos(lower(definition),'behavioral_confidence')>0 and strpos(lower(definition),'organic-ranking-features-personalization-v2')>0)
    then 0 else 1 end from ranker),
  'l6_model_authority_invalid',(select case when to_regclass('private.algo6_model_versions') is not null
    and to_regprocedure('public.manage_algo6_model_v1(text,uuid,uuid)') is not null
    and to_regprocedure('public.register_algo6_model_candidate_v1(text,timestamp with time zone,timestamp with time zone,bigint,jsonb,jsonb,boolean)') is not null
    then 0 else 1 end),
  'ads_personalization_v4_authority_invalid',(select case when to_regclass('private.advertising_interest_targets') is not null
    and exists(select 1 from private.advertising_targeting_policy where singleton
      and policy_version='nelyon-ads-targeting-v4' and interest_targeting_enabled and behavioral_targeting_enabled
      and language_targeting_enabled and geo_targeting_enabled and not sensitive_targeting_allowed
      and not precise_viewer_location_matching_enabled) then 0 else 1 end)
)
from base;
$$;
revoke all on function public.reconcile_algo_l1_v1() from public,anon,authenticated,service_role;
grant execute on function public.reconcile_algo_l1_v1() to service_role;

commit;
