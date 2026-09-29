-- ADS-V2-PLR-14A
-- Canonical, deterministic multi-surface production rollout controls.
-- This migration deliberately leaves production DISARMED with zero runtime
-- placements enabled and no billing authorization window.

begin;

do $$
declare
  v_coverage jsonb;
  v_placement text;
begin
  if (select launch_mode from private.advertising_canary_policy where singleton)<>'DISARMED'
    or (select canary_enabled from private.advertising_canary_policy where singleton)
    or (select funding_enabled or spend_enabled or settlement_enabled
        from private.advertising_finance_policy where singleton)
    or (select activation_enabled or automatic_transitions_enabled
        from private.advertising_campaign_lifecycle_policy where singleton)
    or (select global_v2_delivery_enabled
        from private.advertising_delivery_policy where singleton)
    or exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled)
    or exists(select 1 from private.advertising_billing_authorization_windows where status='OPEN') then
    raise exception using errcode='55000',message='advertising_plr14a_disarmed_precondition_failed';
  end if;
  if (select count(*) from private.advertising_placement_catalog
      where code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search'))<>6
    or (select count(*) from private.advertising_placement_catalog)<>6 then
    raise exception using errcode='55000',message='advertising_plr14a_placement_catalog_precondition_failed';
  end if;
  if (select count(*) from private.advertising_billing_rate_versions
      where state='published' and scope='global' and scope_campaign_id is null)<>54 then
    raise exception using errcode='55000',message='advertising_plr14a_global_rate_matrix_precondition_failed';
  end if;
  foreach v_placement in array array[
    'social_feed','clips','stories','live','marketplace_home','marketplace_search'
  ] loop
    v_coverage:=private.advertising_rate_coverage_at(
      'PRODUCTION',null,v_placement,pg_catalog.clock_timestamp(),null
    );
    if not coalesce((v_coverage->>'ready')::boolean,false)
      or coalesce((v_coverage->>'required_count')::integer,0)<>9
      or coalesce((v_coverage->>'covered_count')::integer,0)<>9
      or coalesce((v_coverage->>'missing_count')::integer,0)<>0 then
      raise exception using errcode='55000',message='advertising_plr14a_rate_coverage_precondition_failed',detail=v_placement;
    end if;
  end loop;
end;
$$;

alter table private.advertising_delivery_policy
  add column production_rollout_version text not null default 'nelyon-ads-rollout-v1',
  add column production_delivery_paused boolean not null default false,
  add column production_rollout_config_version bigint not null default 1,
  add constraint advertising_delivery_policy_rollout_version_chk check (
    production_rollout_version ~ '^nelyon-ads-rollout-v[1-9][0-9]*$'
  ),
  add constraint advertising_delivery_policy_rollout_config_version_chk check (
    production_rollout_config_version>0
  );

alter table private.advertising_placement_catalog
  add column production_rollout_bps integer not null default 0,
  add column production_kill_switch boolean not null default false,
  add constraint advertising_placement_catalog_rollout_bps_chk check (
    production_rollout_bps between 0 and 10000
  );

insert into private.admin_capabilities(
  capability_code,domain,effect,description,is_sensitive
) values(
  'advertising.rollout.manage','advertising','workflow',
  'Manage Ads V2 production rollout, placement kill switches, delivery pause, and production launch state.',
  true
)
on conflict(capability_code) do update set
  domain=excluded.domain,effect=excluded.effect,description=excluded.description,is_sensitive=excluded.is_sensitive;

insert into private.admin_role_capabilities(role_code,capability_code)
values('SUPER_ADMIN','advertising.rollout.manage')
on conflict(role_code,capability_code) do nothing;

do $$
begin
  if exists(select 1 from private.admin_role_capabilities
    where capability_code='advertising.rollout.manage' and role_code<>'SUPER_ADMIN') then
    raise exception using errcode='55000',message='advertising_rollout_capability_assignment_invalid';
  end if;
end;
$$;

create or replace function private.advertising_viewer_in_production_rollout(
  p_placement_code text,
  p_viewer_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_launch_mode text;
  v_policy private.advertising_delivery_policy%rowtype;
  v_placement private.advertising_placement_catalog%rowtype;
  v_bucket integer;
begin
  if p_viewer_user_id is null or p_placement_code is null then return false;end if;
  select launch_mode into strict v_launch_mode
  from private.advertising_canary_policy where singleton;
  select * into strict v_policy
  from private.advertising_delivery_policy where singleton;
  select * into v_placement
  from private.advertising_placement_catalog where code=p_placement_code;
  if not found or v_launch_mode<>'PRODUCTION'
    or v_policy.production_delivery_paused
    or not v_policy.global_v2_delivery_enabled
    or v_placement.production_kill_switch
    or not v_placement.v2_delivery_enabled
    or v_placement.production_rollout_bps<=0 then
    return false;
  end if;
  v_bucket:=(('x'||pg_catalog.substr(pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(
      p_viewer_user_id::text||'|'||p_placement_code||'|'||v_policy.production_rollout_version,
      'UTF8'
    ),'sha256'),'hex'),1,8))::bit(32)::bigint % 10000)::integer;
  return v_bucket<v_placement.production_rollout_bps;
end;
$$;

revoke all on function private.advertising_viewer_in_production_rollout(text,uuid)
from public,anon,authenticated,service_role;

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;v_billing jsonb;v_campaign_id uuid;v_launch_mode text;v_blocker text;
  v_delivery_runtime_ready boolean:=false;v_objective_issue text;
begin
  v_result:=private.advertising_delivery_preflight_structural_at(
    p_ad_id,p_placement_code,p_viewer_user_id,p_at_time
  );
  select ad_set.campaign_id,coalesce(capability.delivery_runtime_ready,false)
  into v_campaign_id,v_delivery_runtime_ready
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  left join private.advertising_objective_capabilities capability on capability.objective=campaign.objective
  where ad.id=p_ad_id;
  select launch_mode into strict v_launch_mode
  from private.advertising_canary_policy where singleton;
  v_objective_issue:=private.advertising_ad_objective_contract_issue(p_ad_id);
  if v_campaign_id is not null and not v_delivery_runtime_ready then
    v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array('objective_delivery_not_available'),true);
  elsif v_campaign_id is not null and v_objective_issue is not null then
    v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array(v_objective_issue),true);
  elsif v_campaign_id is not null and v_launch_mode in ('CANARY_BILLING','PRODUCTION') then
    v_billing:=private.advertising_campaign_billing_readiness_at(v_campaign_id,p_placement_code,p_at_time);
    if not coalesce((v_billing->>'ready')::boolean,false) then
      v_blocker:=v_billing->>'blocker';
      v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
      v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
      v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array(v_blocker),true);
    end if;
    v_result:=v_result||pg_catalog.jsonb_build_object('billing_readiness',v_billing);
  end if;
  if v_campaign_id is not null and v_launch_mode='PRODUCTION'
    and not private.advertising_viewer_in_production_rollout(p_placement_code,p_viewer_user_id) then
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(
      v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)
        ||pg_catalog.jsonb_build_array('production_rollout_not_selected'),true
    );
  end if;
  return v_result;
end;
$$;

revoke all on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.advertising_assert_canary_launch_envelope()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_canary private.advertising_canary_policy%rowtype;
  v_finance private.advertising_finance_policy%rowtype;
  v_lifecycle private.advertising_campaign_lifecycle_policy%rowtype;
  v_delivery private.advertising_delivery_policy%rowtype;
  v_enabled_count integer;
  v_effective_count integer;
  v_open_count integer;
  v_open private.advertising_billing_authorization_windows%rowtype;
  v_coverage jsonb;
  v_placement record;
begin
  select * into strict v_canary from private.advertising_canary_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
  select * into strict v_lifecycle from private.advertising_campaign_lifecycle_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select count(*) into v_enabled_count
  from private.advertising_placement_catalog where v2_delivery_enabled;
  select count(*) into v_effective_count
  from private.advertising_placement_catalog
  where production_rollout_bps>0 and not production_kill_switch
    and status='active' and surface_verified and selection_enabled
    and adapter_version='ads-v2-plr-10';
  select count(*) into v_open_count
  from private.advertising_billing_authorization_windows where status='OPEN';
  select * into v_open
  from private.advertising_billing_authorization_windows where status='OPEN';

  if v_canary.canary_enabled<>(v_canary.launch_mode in ('CANARY_DELIVERY','CANARY_BILLING')) then
    raise exception using errcode='23514',message='advertising_launch_mode_canary_authority_conflict';
  end if;

  if v_canary.launch_mode='DISARMED' then
    if v_finance.funding_enabled or v_finance.spend_enabled or v_finance.settlement_enabled
      or v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or v_delivery.global_v2_delivery_enabled or v_enabled_count<>0 or v_open_count<>0 then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=DISARMED';
    end if;
  elsif v_canary.launch_mode='CANARY_DELIVERY' then
    if not v_finance.funding_enabled or v_finance.spend_enabled or v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled or v_enabled_count<>1
      or not exists(select 1 from private.advertising_placement_catalog
        where code=v_canary.placement_code and v2_delivery_enabled)
      or v_open_count<>0 then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=CANARY_DELIVERY';
    end if;
  elsif v_canary.launch_mode='CANARY_BILLING' then
    if v_finance.funding_enabled or not v_finance.spend_enabled or v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled or v_enabled_count<>1
      or not exists(select 1 from private.advertising_placement_catalog
        where code=v_canary.placement_code and v2_delivery_enabled)
      or v_open_count<>1 or v_open.mode<>'CANARY_BILLING'
      or v_open.scope<>'canary_campaign' or v_open.campaign_id<>v_canary.campaign_id
      or v_open.opened_at<>v_canary.enabled_at or v_open.expires_at<>v_canary.expires_at
      or v_open.max_spend_bdag<>v_canary.max_spend_bdag
      or v_open.max_billable_events<>v_canary.max_billable_events then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=CANARY_BILLING';
    end if;
    v_coverage:=private.advertising_rate_coverage_at(
      'CANARY_BILLING',v_canary.campaign_id,v_canary.placement_code,
      v_canary.enabled_at,v_canary.expires_at
    );
    if not coalesce((v_coverage->>'ready')::boolean,false) then
      raise exception using errcode='23514',message='advertising_canary_billing_rate_coverage_incomplete';
    end if;
  elsif v_canary.launch_mode='SETTLEMENT_ONLY' then
    if v_finance.funding_enabled or v_finance.spend_enabled or not v_finance.settlement_enabled
      or v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or v_delivery.global_v2_delivery_enabled or v_enabled_count<>0 or v_open_count<>0 then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=SETTLEMENT_ONLY';
    end if;
  elsif v_canary.launch_mode='PRODUCTION' then
    if not v_finance.funding_enabled or not v_finance.spend_enabled or not v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or not v_lifecycle.automatic_transitions_enabled
      or v_open_count<>1 or v_open.mode<>'PRODUCTION' or v_open.scope<>'global'
      or v_open.campaign_id is not null or v_open.expires_at is not null then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=PRODUCTION';
    end if;
    if exists(select 1 from private.advertising_placement_catalog
      where production_rollout_bps>0 and not production_kill_switch
        and (status<>'active' or not surface_verified or not selection_enabled
          or adapter_version is distinct from 'ads-v2-plr-10')) then
      raise exception using errcode='23514',message='advertising_production_placement_not_launchable';
    end if;
    if v_delivery.production_delivery_paused then
      if v_delivery.global_v2_delivery_enabled or v_enabled_count<>0 then
        raise exception using errcode='23514',message='advertising_production_runtime_placement_mismatch',detail='paused';
      end if;
    elsif not v_delivery.global_v2_delivery_enabled or v_effective_count<1
      or v_enabled_count<>v_effective_count
      or exists(
        select 1 from private.advertising_placement_catalog
        where v2_delivery_enabled is distinct from(
          production_rollout_bps>0 and not production_kill_switch
          and status='active' and surface_verified and selection_enabled
          and adapter_version='ads-v2-plr-10'
        )
      ) then
      raise exception using errcode='23514',message='advertising_production_runtime_placement_mismatch',detail='running';
    end if;
    for v_placement in
      select code from private.advertising_placement_catalog
      where production_rollout_bps>0 and not production_kill_switch
      order by code
    loop
      v_coverage:=private.advertising_rate_coverage_at(
        'PRODUCTION',null,v_placement.code,v_open.opened_at,null
      );
      if not coalesce((v_coverage->>'ready')::boolean,false)
        or coalesce((v_coverage->>'required_count')::integer,0)<>9
        or coalesce((v_coverage->>'covered_count')::integer,0)<>9
        or coalesce((v_coverage->>'missing_count')::integer,0)<>0 then
        raise exception using errcode='23514',message='advertising_production_rate_coverage_incomplete',detail=v_placement.code;
      end if;
    end loop;
  else
    raise exception using errcode='23514',message='advertising_launch_mode_invalid';
  end if;
  return null;
end;
$$;

revoke all on function private.advertising_assert_canary_launch_envelope()
from public,anon,authenticated,service_role;

create or replace function public.get_admin_advertising_rollout_control_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_launch private.advertising_canary_policy%rowtype;
  v_policy private.advertising_delivery_policy%rowtype;
  v_window jsonb;
  v_placements jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_effective_count integer;
  v_production_ready boolean;
begin
  if v_actor is null then
    raise exception using errcode='28000',message='admin_auth_required';
  end if;
  if not(public.admin_actor_has_capability('advertising.ads.read')
    or public.admin_actor_has_capability('advertising.billing.read')) then
    raise exception using errcode='42501',message='admin_capability_forbidden';
  end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton;
  select * into strict v_policy from private.advertising_delivery_policy where singleton;
  select pg_catalog.jsonb_build_object(
    'open_count',count(*),
    'current',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',id,'mode',mode,'scope',scope,'opened_at',opened_at,'expires_at',expires_at,
      'max_spend_bdag',max_spend_bdag,'max_billable_events',max_billable_events
    ) order by opened_at desc)->0,'null'::jsonb)
  ) into v_window
  from private.advertising_billing_authorization_windows where status='OPEN';
  select count(*) into v_effective_count
  from private.advertising_placement_catalog
  where production_rollout_bps>0 and not production_kill_switch
    and status='active' and surface_verified and selection_enabled
    and adapter_version='ads-v2-plr-10';
  if v_policy.production_delivery_paused then
    v_blockers:=v_blockers||pg_catalog.jsonb_build_array('production_delivery_paused');
  end if;
  if v_effective_count=0 then
    v_blockers:=v_blockers||pg_catalog.jsonb_build_array('no_effective_production_placements');
  end if;
  if exists(select 1 from private.advertising_placement_catalog
    where production_rollout_bps>0 and not production_kill_switch
      and (status<>'active' or not surface_verified or not selection_enabled
        or adapter_version is distinct from 'ads-v2-plr-10')) then
    v_blockers:=v_blockers||pg_catalog.jsonb_build_array('production_placement_not_launchable');
  end if;
  if exists(
    select 1 from private.advertising_placement_catalog placement
    cross join lateral private.advertising_rate_coverage_at(
      'PRODUCTION',null,placement.code,pg_catalog.statement_timestamp(),null
    ) coverage(value)
    where placement.production_rollout_bps>0 and not placement.production_kill_switch
      and(not coalesce((coverage.value->>'ready')::boolean,false)
        or coalesce((coverage.value->>'required_count')::integer,0)<>9
        or coalesce((coverage.value->>'covered_count')::integer,0)<>9
        or coalesce((coverage.value->>'missing_count')::integer,0)<>0)
  ) then
    v_blockers:=v_blockers||pg_catalog.jsonb_build_array('production_rate_coverage_incomplete');
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code',placement.code,'label',placement.label,'status',placement.status,
    'surface_verified',placement.surface_verified,'selection_enabled',placement.selection_enabled,
    'adapter_version',placement.adapter_version,
    'production_rollout_bps',placement.production_rollout_bps,
    'rollout_percent',placement.production_rollout_bps/100.0,
    'production_kill_switch',placement.production_kill_switch,
    'effective_runtime_enabled',placement.v2_delivery_enabled,
    'production_rate_coverage',pg_catalog.jsonb_build_object(
      'required',coalesce((coverage.value->>'required_count')::integer,0),
      'covered',coalesce((coverage.value->>'covered_count')::integer,0),
      'missing',coalesce((coverage.value->>'missing_count')::integer,0),
      'ready',coalesce((coverage.value->>'ready')::boolean,false)
    )
  ) order by placement.code),'[]'::jsonb) into v_placements
  from private.advertising_placement_catalog placement
  cross join lateral private.advertising_rate_coverage_at(
    'PRODUCTION',null,placement.code,pg_catalog.statement_timestamp(),null
  ) coverage(value)
  where placement.code in(
    'social_feed','clips','stories','live','marketplace_home','marketplace_search'
  );
  v_production_ready=pg_catalog.jsonb_array_length(v_blockers)=0;
  return pg_catalog.jsonb_build_object(
    'authority','ads_v2_production_rollout','launch_mode',v_launch.launch_mode,
    'global_delivery_enabled',v_policy.global_v2_delivery_enabled,
    'production_delivery_paused',v_policy.production_delivery_paused,
    'rollout_version',v_policy.production_rollout_version,
    'config_version',v_policy.production_rollout_config_version,
    'authorization_window',v_window,'placements',v_placements,
    'production_ready',v_production_ready,'blockers',v_blockers
  );
end;
$$;

revoke all on function public.get_admin_advertising_rollout_control_v1()
from public,anon,authenticated,service_role;
grant execute on function public.get_admin_advertising_rollout_control_v1()
to authenticated;

create or replace function public.set_admin_advertising_production_rollout_v1(
  p_expected_config_version bigint,
  p_global_paused boolean,
  p_placements jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_launch private.advertising_canary_policy%rowtype;
  v_policy private.advertising_delivery_policy%rowtype;
  v_existing private.admin_action_audit%rowtype;
  v_scope text:='v1|admin|advertising|production_rollout.configure';
  v_fingerprint text;
  v_normalized jsonb;
  v_before jsonb;
  v_after jsonb;
  v_effective jsonb;
  v_receipt jsonb;
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_old_global_paused boolean;
  v_coverage jsonb;
  v_placement record;
begin
  v_actor:=public.admin_require_capability('advertising.rollout.manage');
  if p_expected_config_version is null or p_expected_config_version<1
    or p_global_paused is null or p_idempotency_key is null
    or p_placements is null or pg_catalog.jsonb_typeof(p_placements)<>'array'
    or pg_catalog.jsonb_array_length(p_placements)<>6 then
    raise exception using errcode='22023',message='advertising_rollout_configuration_invalid';
  end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(p_placements) entry(value)
    where pg_catalog.jsonb_typeof(value)<>'object'
      or not(value ?& array['code','rollout_bps','kill_switch'])
      or value-array['code','rollout_bps','kill_switch']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(value->'code')<>'string'
      or pg_catalog.jsonb_typeof(value->'rollout_bps')<>'number'
      or pg_catalog.jsonb_typeof(value->'kill_switch')<>'boolean'
      or not((value->>'rollout_bps')~'^[0-9]+$')
      or (value->>'rollout_bps')::integer not between 0 and 10000
  ) then
    raise exception using errcode='22023',message='advertising_rollout_placement_payload_invalid';
  end if;
  if (select count(distinct item.code) from pg_catalog.jsonb_to_recordset(p_placements)
      as item(code text,rollout_bps integer,kill_switch boolean))<>6
    or exists(select 1 from pg_catalog.jsonb_to_recordset(p_placements)
      as item(code text,rollout_bps integer,kill_switch boolean)
      where item.code not in('social_feed','clips','stories','live','marketplace_home','marketplace_search')) then
    raise exception using errcode='22023',message='advertising_rollout_placement_set_invalid';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code',item.code,'rollout_bps',item.rollout_bps,'kill_switch',item.kill_switch
  ) order by item.code) into v_normalized
  from pg_catalog.jsonb_to_recordset(p_placements)
    as item(code text,rollout_bps integer,kill_switch boolean);
  v_fingerprint:=private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'actor_id',v_actor,'expected_config_version',p_expected_config_version,
    'global_paused',p_global_paused,'placements',v_normalized
  ));

  select * into strict v_launch
  from private.advertising_canary_policy where singleton for update;
  select * into strict v_policy
  from private.advertising_delivery_policy where singleton for update;
  perform 1 from private.advertising_placement_catalog order by code for update;

  select * into v_existing from private.admin_action_audit
  where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return(v_existing.metadata->'receipt')||pg_catalog.jsonb_build_object('idempotent',true);
  end if;
  if v_policy.production_rollout_config_version<>p_expected_config_version then
    raise exception using errcode='40001',message='advertising_rollout_config_version_stale';
  end if;
  if v_launch.launch_mode not in('DISARMED','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_rollout_config_launch_mode_invalid';
  end if;
  v_old_global_paused:=v_policy.production_delivery_paused;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code',code,'rollout_bps',production_rollout_bps,'kill_switch',production_kill_switch
  ) order by code),'[]'::jsonb) into v_before
  from private.advertising_placement_catalog;

  if v_launch.launch_mode='PRODUCTION' and not p_global_paused then
    if not exists(select 1 from pg_catalog.jsonb_to_recordset(v_normalized)
      as item(code text,rollout_bps integer,kill_switch boolean)
      where item.rollout_bps>0 and not item.kill_switch) then
      raise exception using errcode='55000',message='advertising_production_effective_placement_required';
    end if;
    if exists(select 1 from pg_catalog.jsonb_to_recordset(v_normalized)
      as item(code text,rollout_bps integer,kill_switch boolean)
      join private.advertising_placement_catalog placement on placement.code=item.code
      where item.rollout_bps>0 and not item.kill_switch
        and(placement.status<>'active' or not placement.surface_verified
          or not placement.selection_enabled or placement.adapter_version is distinct from 'ads-v2-plr-10')) then
      raise exception using errcode='55000',message='advertising_production_placement_not_launchable';
    end if;
    for v_placement in
      select item.code from pg_catalog.jsonb_to_recordset(v_normalized)
        as item(code text,rollout_bps integer,kill_switch boolean)
      where item.rollout_bps>0 and not item.kill_switch order by item.code
    loop
      v_coverage:=private.advertising_rate_coverage_at(
        'PRODUCTION',null,v_placement.code,v_now,null
      );
      if not coalesce((v_coverage->>'ready')::boolean,false)
        or coalesce((v_coverage->>'required_count')::integer,0)<>9
        or coalesce((v_coverage->>'covered_count')::integer,0)<>9
        or coalesce((v_coverage->>'missing_count')::integer,0)<>0 then
        raise exception using errcode='55000',message='advertising_production_rate_coverage_incomplete',detail=v_placement.code;
      end if;
    end loop;
  end if;

  update private.advertising_placement_catalog placement set
    production_rollout_bps=item.rollout_bps,
    production_kill_switch=item.kill_switch,
    updated_at=v_now
  from pg_catalog.jsonb_to_recordset(v_normalized)
    as item(code text,rollout_bps integer,kill_switch boolean)
  where placement.code=item.code;

  update private.advertising_placement_catalog placement set
    v2_delivery_enabled=(
      v_launch.launch_mode='PRODUCTION' and not p_global_paused
      and placement.production_rollout_bps>0 and not placement.production_kill_switch
      and placement.status='active' and placement.surface_verified
      and placement.selection_enabled and placement.adapter_version='ads-v2-plr-10'
    ),updated_at=v_now;

  update private.advertising_delivery_policy set
    production_delivery_paused=p_global_paused,
    production_rollout_config_version=production_rollout_config_version+1,
    global_v2_delivery_enabled=(
      v_launch.launch_mode='PRODUCTION' and not p_global_paused
      and exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled)
    ),updated_at=v_now
  where singleton
  returning * into v_policy;

  set constraints all immediate;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code',code,'rollout_bps',production_rollout_bps,'kill_switch',production_kill_switch
  ) order by code),'[]'::jsonb) into v_after
  from private.advertising_placement_catalog;
  select coalesce(pg_catalog.jsonb_agg(code order by code),'[]'::jsonb) into v_effective
  from private.advertising_placement_catalog where v2_delivery_enabled;
  v_receipt:=pg_catalog.jsonb_build_object(
    'authority','ads_v2_production_rollout','config_version',v_policy.production_rollout_config_version,
    'launch_mode',v_launch.launch_mode,'production_delivery_paused',p_global_paused,
    'effective_runtime_placements',v_effective,'updated_at',v_now,'idempotent',false
  );
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,outcome,financial_effect,contains_pii,
    idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'advertising.rollout.manage',
    'advertising','advertising.production_rollout.configure','advertising_control_plane',
    '00000000-0000-0000-0000-000000000014'::uuid,'production_rollout','succeeded',
    true,false,v_scope,p_idempotency_key,v_fingerprint,
    pg_catalog.jsonb_build_object(
      'old_config_version',p_expected_config_version,
      'new_config_version',v_policy.production_rollout_config_version,
      'old_global_pause',v_old_global_paused,
      'new_global_pause',p_global_paused,'placements_before',v_before,
      'placements_after',v_after,'launch_mode',v_launch.launch_mode,
      'effective_runtime_placements',v_effective,'receipt',v_receipt
    )
  );
  return v_receipt;
end;
$$;

revoke all on function public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)
to authenticated;

create or replace function public.set_advertising_launch_mode_v2(
  p_launch_mode text,
  p_idempotency_key uuid,
  p_business_account_id uuid default null,
  p_ad_account_id uuid default null,
  p_campaign_id uuid default null,
  p_viewer_user_id uuid default null,
  p_placement_code text default null,
  p_expires_at timestamptz default null,
  p_max_budget_bdag numeric default null,
  p_max_impressions integer default null,
  p_max_spend_bdag numeric default null,
  p_max_billable_events integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=coalesce(current_setting('request.jwt.claim.role',true),session_user,current_user);
  v_actor uuid;
  v_admin_authorized boolean:=false;
  v_scope text;
  v_now timestamptz;
  v_from_mode text;
  v_window_id uuid;
  v_fingerprint text;
  v_existing private.admin_action_audit%rowtype;
  v_receipt jsonb;
  v_campaign private.advertising_campaigns%rowtype;
  v_finance private.advertising_campaign_finance%rowtype;
  v_policy private.advertising_canary_policy%rowtype;
  v_delivery private.advertising_delivery_policy%rowtype;
  v_prior_window private.advertising_billing_authorization_windows%rowtype;
  v_coverage jsonb;
  v_active_refresh boolean:=false;
  v_closed_window_count integer:=0;
  v_placement record;
  v_effective_placements jsonb:='[]'::jsonb;
begin
  if v_role='authenticated' then
    v_actor:=public.admin_require_capability('advertising.rollout.manage');
    v_admin_authorized:=true;
    if p_launch_mode not in('DISARMED','PRODUCTION') then
      raise exception using errcode='42501',message='advertising_admin_launch_mode_forbidden';
    end if;
  elsif v_role not in('service_role','postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_internal_authority_required';
  end if;
  if p_launch_mode not in('DISARMED','CANARY_DELIVERY','CANARY_BILLING','SETTLEMENT_ONLY','PRODUCTION') then
    raise exception using errcode='22023',message='advertising_launch_mode_invalid';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_idempotency_key_required';
  end if;
  v_scope:=case when v_admin_authorized
    then 'v1|admin|advertising|launch_mode.transition'
    else 'v1|system|advertising|launch_mode.transition' end;
  v_fingerprint:=private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'actor_id',v_actor,'launch_mode',p_launch_mode,'business_account_id',p_business_account_id,
    'ad_account_id',p_ad_account_id,'campaign_id',p_campaign_id,
    'viewer_user_id',p_viewer_user_id,'placement_code',p_placement_code,
    'expires_at',p_expires_at,'max_budget_bdag',p_max_budget_bdag,
    'max_impressions',p_max_impressions,'max_spend_bdag',p_max_spend_bdag,
    'max_billable_events',p_max_billable_events
  ));

  select * into strict v_policy
  from private.advertising_canary_policy where singleton for update;
  select * into strict v_delivery
  from private.advertising_delivery_policy where singleton for update;
  perform 1 from private.advertising_placement_catalog order by code for update;
  v_now:=pg_catalog.clock_timestamp();
  v_from_mode:=v_policy.launch_mode;

  select * into v_existing from private.admin_action_audit
  where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return(v_existing.metadata->'receipt')||pg_catalog.jsonb_build_object('idempotent',true);
  end if;

  if p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then
    if p_business_account_id is null or p_ad_account_id is null or p_campaign_id is null
      or p_viewer_user_id is null or p_placement_code is null or p_expires_at is null
      or p_expires_at<=v_now or p_max_budget_bdag is null or p_max_budget_bdag<=0
      or p_max_impressions is null or p_max_impressions<1 then
      raise exception using errcode='22023',message='advertising_canary_launch_target_invalid';
    end if;
    select campaign.* into v_campaign
    from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    where campaign.id=p_campaign_id and account.id=p_ad_account_id
      and business.id=p_business_account_id and business.owner_user_id=p_viewer_user_id
    for update of campaign;
    if not found then
      raise exception using errcode='55000',message='advertising_canary_campaign_not_eligible';
    end if;

    if v_campaign.status='active' then
      if p_launch_mode<>'CANARY_BILLING' or v_from_mode<>'CANARY_BILLING'
        or not v_policy.canary_enabled or v_policy.expires_at is null
        or v_policy.expires_at>=v_now
        or v_policy.business_account_id is distinct from p_business_account_id
        or v_policy.ad_account_id is distinct from p_ad_account_id
        or v_policy.campaign_id is distinct from p_campaign_id
        or v_policy.viewer_user_id is distinct from p_viewer_user_id
        or v_policy.placement_code is distinct from p_placement_code
        or p_placement_code<>'social_feed'
        or v_policy.max_budget_bdag is distinct from 0.30000000::numeric
        or p_max_budget_bdag is distinct from 0.30000000::numeric
        or v_policy.max_impressions is distinct from 1 or p_max_impressions is distinct from 1
        or v_policy.max_spend_bdag is distinct from 0.30000000::numeric
        or p_max_spend_bdag is distinct from 0.30000000::numeric
        or v_policy.max_billable_events is distinct from 1 or p_max_billable_events is distinct from 1
        or p_expires_at>v_now+interval '30 minutes' then
        raise exception using errcode='55000',message='advertising_active_canary_billing_refresh_invalid';
      end if;
      if exists(select 1 from private.advertising_billing_authorization_windows window_row
        where window_row.status='OPEN' and window_row.opened_at<=v_now
          and(window_row.expires_at is null or v_now<window_row.expires_at)) then
        raise exception using errcode='55000',message='advertising_active_canary_billing_window_still_valid';
      end if;
      select * into v_prior_window
      from private.advertising_billing_authorization_windows where status='OPEN' for update;
      if not found or v_prior_window.mode<>'CANARY_BILLING'
        or v_prior_window.scope<>'canary_campaign'
        or v_prior_window.campaign_id is distinct from p_campaign_id
        or v_prior_window.opened_at>v_now or v_prior_window.expires_at is null
        or v_prior_window.expires_at>=v_now
        or v_prior_window.expires_at is distinct from v_policy.expires_at
        or v_prior_window.max_spend_bdag is distinct from 0.30000000::numeric
        or v_prior_window.max_billable_events is distinct from 1 then
        raise exception using errcode='55000',message='advertising_active_canary_billing_prior_window_invalid';
      end if;
      v_active_refresh:=true;
    elsif v_campaign.status not in('draft','paused') then
      raise exception using errcode='55000',message='advertising_canary_campaign_not_eligible';
    end if;

    if p_placement_code<>'social_feed' or not exists(
      select 1 from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(select version.id from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code=p_placement_code
    ) or exists(
      select 1 from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(select version.id from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code<>p_placement_code
    ) then
      raise exception using errcode='22023',message='advertising_canary_placement_invalid';
    end if;

    select * into v_finance from private.advertising_campaign_finance
    where campaign_id=p_campaign_id for update;
    if not found or v_finance.budget_bdag<>p_max_budget_bdag
      or v_finance.spent_bdag<>0 or v_finance.released_bdag<>0 then
      raise exception using errcode='55000',message='advertising_canary_finance_invalid';
    end if;
    if v_active_refresh then
      if v_finance.finance_status<>'funded' or v_finance.budget_bdag<>0.30000000
        or v_finance.funded_bdag<>0.30000000 or v_finance.spent_bdag<>0
        or v_finance.released_bdag<>0 then
        raise exception using errcode='55000',message='advertising_active_canary_billing_finance_invalid';
      end if;
      if exists(select 1 from private.advertising_events where campaign_id=p_campaign_id)
        or exists(select 1 from private.advertising_event_billing_materializations where campaign_id=p_campaign_id)
        or exists(select 1 from private.advertising_financial_events
          where campaign_id=p_campaign_id and event_type='spend') then
        raise exception using errcode='55000',message='advertising_active_canary_billing_evidence_present';
      end if;
      if not exists(
        select 1 from private.advertising_ad_sets ad_set
        join private.advertising_placement_selections selection
          on selection.ad_set_id=ad_set.id and selection.status='draft'
        join lateral(select version.id from private.advertising_placement_selection_versions version
          where version.placement_selection_id=selection.id
          order by version.version_number desc limit 1) latest on true
        join private.advertising_placement_selection_items item
          on item.placement_selection_version_id=latest.id and item.placement_code=p_placement_code
        where ad_set.campaign_id=p_campaign_id
          and ad_set.starts_at is not null and ad_set.starts_at<=v_now
          and ad_set.ends_at is not null and p_expires_at<=ad_set.ends_at
      ) then
        raise exception using errcode='55000',message='advertising_active_canary_billing_schedule_invalid';
      end if;
    end if;

    if p_launch_mode='CANARY_BILLING' then
      if v_finance.finance_status<>'funded' or p_max_spend_bdag is null or p_max_spend_bdag<=0
        or p_max_spend_bdag>p_max_budget_bdag or p_max_billable_events is null
        or p_max_billable_events<1 then
        raise exception using errcode='55000',message='advertising_canary_billing_caps_invalid';
      end if;
      v_coverage:=private.advertising_rate_coverage_at(
        'CANARY_BILLING',p_campaign_id,p_placement_code,v_now,p_expires_at
      );
      if not coalesce((v_coverage->>'ready')::boolean,false)
        or coalesce((v_coverage->>'required_count')::integer,0)<>1
        or coalesce((v_coverage->>'covered_count')::integer,0)<>1 then
        raise exception using errcode='55000',message='advertising_canary_billing_rate_coverage_incomplete';
      end if;
    elsif p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_delivery_canary_billing_caps_forbidden';
    end if;
  else
    if p_business_account_id is not null or p_ad_account_id is not null or p_campaign_id is not null
      or p_viewer_user_id is not null or p_placement_code is not null or p_expires_at is not null
      or p_max_budget_bdag is not null or p_max_impressions is not null
      or p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_non_canary_target_forbidden';
    end if;
    if p_launch_mode='PRODUCTION' then
      if v_delivery.production_delivery_paused then
        raise exception using errcode='55000',message='advertising_production_delivery_paused';
      end if;
      if not exists(select 1 from private.advertising_placement_catalog
        where production_rollout_bps>0 and not production_kill_switch) then
        raise exception using errcode='55000',message='advertising_production_effective_placement_required';
      end if;
      if exists(select 1 from private.advertising_placement_catalog
        where production_rollout_bps>0 and not production_kill_switch
          and(status<>'active' or not surface_verified or not selection_enabled
            or adapter_version is distinct from 'ads-v2-plr-10')) then
        raise exception using errcode='55000',message='advertising_production_placement_not_launchable';
      end if;
      for v_placement in
        select code from private.advertising_placement_catalog
        where production_rollout_bps>0 and not production_kill_switch order by code
      loop
        v_coverage:=private.advertising_rate_coverage_at(
          'PRODUCTION',null,v_placement.code,v_now,null
        );
        if not coalesce((v_coverage->>'ready')::boolean,false)
          or coalesce((v_coverage->>'required_count')::integer,0)<>9
          or coalesce((v_coverage->>'covered_count')::integer,0)<>9
          or coalesce((v_coverage->>'missing_count')::integer,0)<>0 then
          raise exception using errcode='55000',message='advertising_production_rate_coverage_incomplete',detail=v_placement.code;
        end if;
      end loop;
    end if;
  end if;

  update private.advertising_billing_authorization_windows
  set status='CLOSED',closed_at=v_now,updated_at=v_now where status='OPEN';
  get diagnostics v_closed_window_count=row_count;
  if v_active_refresh and v_closed_window_count<>1 then
    raise exception using errcode='55000',message='advertising_active_canary_billing_window_close_invalid';
  end if;
  if p_launch_mode='CANARY_BILLING' then
    insert into private.advertising_billing_authorization_windows(
      mode,scope,campaign_id,opened_at,expires_at,max_spend_bdag,max_billable_events
    ) values(
      'CANARY_BILLING','canary_campaign',p_campaign_id,v_now,p_expires_at,
      p_max_spend_bdag,p_max_billable_events
    ) returning id into v_window_id;
  elsif p_launch_mode='PRODUCTION' then
    insert into private.advertising_billing_authorization_windows(mode,scope,opened_at)
    values('PRODUCTION','global',v_now) returning id into v_window_id;
  end if;

  update private.advertising_finance_policy set
    funding_enabled=p_launch_mode in('CANARY_DELIVERY','PRODUCTION'),
    spend_enabled=p_launch_mode in('CANARY_BILLING','PRODUCTION'),
    settlement_enabled=p_launch_mode in('SETTLEMENT_ONLY','PRODUCTION'),updated_at=v_now
  where singleton;
  update private.advertising_campaign_lifecycle_policy set
    activation_enabled=p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION'),
    automatic_transitions_enabled=p_launch_mode='PRODUCTION',updated_at=v_now
  where singleton;
  update private.advertising_delivery_policy set
    global_v2_delivery_enabled=(
      p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING')
      or p_launch_mode='PRODUCTION' and not production_delivery_paused
    ),updated_at=v_now
  where singleton;
  update private.advertising_placement_catalog set
    v2_delivery_enabled=(
      p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') and code=p_placement_code
      or p_launch_mode='PRODUCTION' and production_rollout_bps>0
        and not production_kill_switch and status='active' and surface_verified
        and selection_enabled and adapter_version='ads-v2-plr-10'
    ),updated_at=v_now;
  update private.advertising_canary_policy set
    launch_mode=p_launch_mode,
    canary_enabled=p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING'),
    business_account_id=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_business_account_id end,
    ad_account_id=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_ad_account_id end,
    campaign_id=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_campaign_id end,
    viewer_user_id=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_viewer_user_id end,
    placement_code=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_placement_code end,
    max_budget_bdag=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_max_budget_bdag end,
    max_impressions=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_max_impressions end,
    max_spend_bdag=case when p_launch_mode='CANARY_BILLING' then p_max_spend_bdag end,
    max_billable_events=case when p_launch_mode='CANARY_BILLING' then p_max_billable_events end,
    enabled_at=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then v_now end,
    expires_at=case when p_launch_mode in('CANARY_DELIVERY','CANARY_BILLING') then p_expires_at end,
    updated_at=v_now
  where singleton;

  set constraints all immediate;
  select coalesce(pg_catalog.jsonb_agg(code order by code),'[]'::jsonb)
  into v_effective_placements
  from private.advertising_placement_catalog where v2_delivery_enabled;
  v_receipt:=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'from_mode',v_from_mode,'to_mode',p_launch_mode,'authorization_window_id',v_window_id,
    'campaign_id',p_campaign_id,'placement_code',p_placement_code,'transitioned_at',v_now,
    'opened_at',case when v_window_id is not null then v_now end,
    'expires_at',case when p_launch_mode='CANARY_BILLING' then p_expires_at end,
    'effective_runtime_placements',v_effective_placements,'idempotent',false,
    'active_canary_billing_refresh',case when v_active_refresh then true end,
    'prior_authorization_window_id',case when v_active_refresh then v_prior_window.id end,
    'new_authorization_window_id',case when v_active_refresh then v_window_id end,
    'old_expires_at',case when v_active_refresh then v_prior_window.expires_at end,
    'new_expires_at',case when v_active_refresh then p_expires_at end
  ));
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,outcome,financial_effect,contains_pii,
    idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,case when v_admin_authorized then 'human_admin' else 'system_workflow' end,
    case when v_admin_authorized then private.admin_active_role_codes(v_actor) else '{}'::text[] end,
    case when v_admin_authorized then 'advertising.rollout.manage' end,
    'advertising','advertising.launch_mode.transition','advertising_control_plane',
    '00000000-0000-0000-0000-000000000009'::uuid,p_launch_mode,'succeeded',true,false,
    v_scope,p_idempotency_key,v_fingerprint,
    pg_catalog.jsonb_build_object('receipt',v_receipt,'admin_authorized',v_admin_authorized)
  );
  return v_receipt;
end;
$$;

revoke all on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) from public,anon,authenticated,service_role;
grant execute on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) to service_role;
grant execute on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) to authenticated;

comment on column private.advertising_delivery_policy.production_rollout_version is
  'Stable server-side cohort version; it is part of the deterministic viewer-placement rollout hash.';
comment on column private.advertising_delivery_policy.production_delivery_paused is
  'Production delivery-only pause. Desired per-placement configuration and the global authorization window are preserved.';
comment on column private.advertising_delivery_policy.production_rollout_config_version is
  'Optimistic concurrency version for the sole canonical Admin production rollout mutation.';
comment on column private.advertising_placement_catalog.production_rollout_bps is
  'Desired production rollout in basis points. Runtime v2_delivery_enabled remains derived state.';
comment on column private.advertising_placement_catalog.production_kill_switch is
  'Independent production placement stop preserving desired rollout percentage.';
comment on function private.advertising_viewer_in_production_rollout(text,uuid) is
  'Private deterministic cohort decision for one authenticated viewer and canonical placement.';
comment on function public.get_admin_advertising_rollout_control_v1() is
  'Capability-gated truthful projection of desired and effective Ads V2 production rollout state.';
comment on function public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid) is
  'SUPER_ADMIN-only audited optimistic mutation for the canonical six-placement production rollout configuration.';

do $$
begin
  if (select launch_mode from private.advertising_canary_policy where singleton)<>'DISARMED'
    or (select canary_enabled from private.advertising_canary_policy where singleton)
    or (select funding_enabled or spend_enabled or settlement_enabled
        from private.advertising_finance_policy where singleton)
    or (select activation_enabled or automatic_transitions_enabled
        from private.advertising_campaign_lifecycle_policy where singleton)
    or (select global_v2_delivery_enabled
        from private.advertising_delivery_policy where singleton)
    or (select production_delivery_paused
        from private.advertising_delivery_policy where singleton)
    or (select production_rollout_config_version
        from private.advertising_delivery_policy where singleton)<>1
    or exists(select 1 from private.advertising_placement_catalog
      where v2_delivery_enabled or production_rollout_bps<>0 or production_kill_switch)
    or exists(select 1 from private.advertising_billing_authorization_windows where status='OPEN') then
    raise exception using errcode='55000',message='advertising_plr14a_disarmed_postcondition_failed';
  end if;
  if (select count(*) from private.admin_role_capabilities
      where capability_code='advertising.rollout.manage' and role_code='SUPER_ADMIN')<>1
    or exists(select 1 from private.admin_role_capabilities
      where capability_code='advertising.rollout.manage' and role_code<>'SUPER_ADMIN') then
    raise exception using errcode='55000',message='advertising_plr14a_capability_postcondition_failed';
  end if;
end;
$$;

commit;
