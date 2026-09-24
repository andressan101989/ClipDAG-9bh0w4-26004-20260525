begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_canary_policy') is not null then
    raise exception 'advertising_canary_policy_conflict';
  end if;
  if pg_catalog.to_regprocedure('public.activate_my_advertising_campaign_v2(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.resume_my_advertising_campaign_v2(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.fund_my_advertising_campaign_budget_v2(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid)') is null
    or pg_catalog.to_regprocedure('public.settle_advertising_campaign_budget_v2(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('private.advertising_delivery_preflight_at(uuid,text,uuid,timestamp with time zone)') is null
    or pg_catalog.to_regprocedure('public.record_advertising_impression_v2(uuid,text,uuid,uuid)') is null then
    raise exception 'ads_v2_plr_6a_foundation_required';
  end if;
end;
$$;

create table private.advertising_canary_policy(
  singleton boolean primary key default true constraint advertising_canary_policy_singleton_chk check(singleton),
  policy_version text not null constraint advertising_canary_policy_version_chk check(policy_version~'^nelyon-ads-canary-v[0-9]+$'),
  canary_enabled boolean not null default false,
  business_account_id uuid references private.business_accounts(id) on delete restrict,
  ad_account_id uuid references private.ad_accounts(id) on delete restrict,
  campaign_id uuid references private.advertising_campaigns(id) on delete restrict,
  viewer_user_id uuid references auth.users(id) on delete restrict,
  placement_code text references private.advertising_placement_catalog(code) on delete restrict,
  max_budget_bdag numeric(20,8) not null,
  max_impressions integer not null,
  enabled_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint advertising_canary_policy_budget_chk check(max_budget_bdag>0 and max_budget_bdag<=0.01000000),
  constraint advertising_canary_policy_impressions_chk check(max_impressions=1),
  constraint advertising_canary_policy_enabled_shape_chk check(
    not canary_enabled or (
      business_account_id is not null and ad_account_id is not null and campaign_id is not null
      and viewer_user_id is not null and placement_code='social_feed'
      and enabled_at is not null and expires_at is not null
      and enabled_at<expires_at and expires_at<=enabled_at+interval '60 minutes'
    )
  )
);

alter table private.advertising_canary_policy enable row level security;
alter table private.advertising_canary_policy force row level security;
revoke all on table private.advertising_canary_policy from public,anon,authenticated;

insert into private.advertising_canary_policy(
  singleton,policy_version,canary_enabled,business_account_id,ad_account_id,campaign_id,
  viewer_user_id,placement_code,max_budget_bdag,max_impressions,enabled_at,expires_at
) values(true,'nelyon-ads-canary-v1',false,null,null,null,null,null,0.01000000,1,null,null);

create or replace function private.advertising_canary_campaign_allowed(
  p_campaign_id uuid,p_at_time timestamptz,p_require_open boolean,p_budget_bdag numeric
)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_canary private.advertising_canary_policy;
begin
  select * into strict v_canary from private.advertising_canary_policy where singleton;
  if not v_canary.canary_enabled then return true;end if;
  if p_campaign_id is null then return false;end if;
  if p_require_open and not (
    v_canary.enabled_at is not null and v_canary.expires_at is not null
    and v_canary.enabled_at<=p_at_time and p_at_time<v_canary.expires_at
  ) then return false;end if;
  if p_budget_bdag is not null and (p_budget_bdag<=0 or p_budget_bdag>v_canary.max_budget_bdag) then return false;end if;
  return exists(
    select 1 from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    where campaign.id=p_campaign_id
      and campaign.id=v_canary.campaign_id
      and account.id=v_canary.ad_account_id
      and account.business_account_id=v_canary.business_account_id
  );
end;
$$;

create or replace function private.advertising_canary_delivery_allowed(
  p_campaign_id uuid,p_viewer_user_id uuid,p_placement_code text,p_at_time timestamptz
)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_canary private.advertising_canary_policy;v_count bigint;
begin
  select * into strict v_canary from private.advertising_canary_policy where singleton;
  if not v_canary.canary_enabled then return true;end if;
  if p_viewer_user_id is distinct from v_canary.viewer_user_id
    or p_placement_code is distinct from v_canary.placement_code
    or p_placement_code is distinct from 'social_feed'
    or not private.advertising_canary_campaign_allowed(p_campaign_id,p_at_time,true,null) then return false;end if;
  select pg_catalog.count(*) into v_count from private.advertising_events event
  where event.event_type='impression' and event.campaign_id=v_canary.campaign_id
    and event.viewer_user_id=v_canary.viewer_user_id and event.placement_code=v_canary.placement_code
    and event.occurred_at>=v_canary.enabled_at and event.occurred_at<v_canary.expires_at;
  return v_count<v_canary.max_impressions;
end;
$$;

revoke all on function private.advertising_canary_campaign_allowed(uuid,timestamptz,boolean,numeric) from public,anon,authenticated;
revoke all on function private.advertising_canary_delivery_allowed(uuid,uuid,text,timestamptz) from public,anon,authenticated;

comment on table private.advertising_canary_policy is 'Singleton server-only hard limit envelope for separately authorized Ads V2 production canaries.';
comment on function private.advertising_canary_campaign_allowed(uuid,timestamptz,boolean,numeric) is 'Dormant exact campaign/account, time-window and budget gate; returns true while canary is disabled.';
comment on function private.advertising_canary_delivery_allowed(uuid,uuid,text,timestamptz) is 'Dormant exact campaign/viewer/social_feed/time/impression-cap gate; returns true while canary is disabled.';



create or replace function public.activate_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;
  v_readiness jsonb;
  v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(
    select 1 from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    where campaign.id=p_campaign_id and business.owner_user_id=v_actor
  ) then raise exception using errcode='42501',message='advertising_campaign_access_denied'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'activate' or v_prior.actor_user_id is distinct from v_actor then
      raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict';
    end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled then raise exception using errcode='55000',message='advertising_campaign_activation_disabled'; end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,pg_catalog.clock_timestamp(),true,null) then
    raise exception using errcode='55000',message='advertising_canary_campaign_denied';
  end if;
  if v_campaign.status<>'draft' then raise exception using errcode='55000',message='advertising_campaign_activation_state_invalid'; end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,pg_catalog.now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text;
  end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(
    campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
  ) values(p_campaign_id,'activate','draft',v_target,v_actor,'owner',p_idempotency_key,'owner_activation');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.resume_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;
  v_readiness jsonb;
  v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'resume' or v_prior.actor_user_id is distinct from v_actor then raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict'; end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled then raise exception using errcode='55000',message='advertising_campaign_activation_disabled'; end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,pg_catalog.clock_timestamp(),true,null) then
    raise exception using errcode='55000',message='advertising_canary_campaign_denied';
  end if;
  if v_campaign.status<>'paused' then raise exception using errcode='55000',message='advertising_campaign_resume_state_invalid'; end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,pg_catalog.now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text; end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code)
  values(p_campaign_id,'resume','paused',v_target,v_actor,'owner',p_idempotency_key,'owner_resume');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.fund_my_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_policy private.advertising_finance_policy;
  v_finance private.advertising_campaign_finance;
  v_prior private.advertising_financial_events;
  v_source uuid;v_escrow uuid;v_balance numeric;v_tx uuid;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;

  -- Historical replay is still owner-authorized, but does not depend on the
  -- current mutable lifecycle status of the Business, Ad Account or Campaign.
  perform 1 from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;

  select * into v_finance from private.advertising_campaign_finance
  where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;

  select * into v_prior from private.advertising_financial_events
  where event_type='fund' and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.amount_bdag<>v_finance.budget_bdag then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;

  select * into strict v_policy from private.advertising_finance_policy where singleton=true;
  if not v_policy.funding_enabled then raise exception using errcode='55000',message='advertising_finance_funding_disabled';end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,pg_catalog.clock_timestamp(),true,v_finance.budget_bdag) then
    raise exception using errcode='55000',message='advertising_canary_funding_denied';end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode='42501',message='advertising_adult_eligibility_required';end if;
  perform 1 from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and campaign.status='draft'
    and account.status='active' and business.status='active' and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;
  if v_finance.finance_status<>'draft' then raise exception using errcode='23505',message='advertising_campaign_already_funded';end if;

  v_source:=public.ensure_ledger_account(v_actor);
  v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
  perform 1 from public.ledger_accounts where id=any(array[v_source,v_escrow]) order by id for update;
  select balance into v_balance from public.ledger_accounts
  where id=v_source and owner_id=v_actor and account_type='user'
    and currency=v_policy.currency and not frozen;
  if v_balance is null or v_balance<v_finance.budget_bdag then
    raise exception using errcode='P0001',message='advertising_insufficient_bdag_balance';end if;

  v_tx:=gen_random_uuid();
  insert into public.financial_transactions(
    id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
    reference_type,reference_id,idempotency_key,initiated_by
  ) values (
    v_tx,v_source,v_escrow,'advertising_campaign_fund',v_finance.budget_bdag,0,'BDAG','completed',
    'advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_actor
  );
  perform public.ledger_debit(v_tx,v_source,v_finance.budget_bdag,'Advertising campaign funding',
    pg_catalog.jsonb_build_object('campaign_id',p_campaign_id));
  perform public.ledger_credit(v_tx,v_escrow,v_finance.budget_bdag,'Shared Ads escrow funding',
    pg_catalog.jsonb_build_object('campaign_id',p_campaign_id));
  insert into private.advertising_financial_events(
    campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key
  ) values (p_campaign_id,'fund',v_finance.budget_bdag,v_tx,p_idempotency_key);
  update private.advertising_campaign_finance set
    finance_status='funded',funded_bdag=budget_bdag,funding_source_account_id=v_source,
    funded_by_user_id=v_actor,funded_at=clock_timestamp()
  where campaign_id=p_campaign_id;
  return private.advertising_campaign_finance_result(p_campaign_id);
end;
$$;

create or replace function public.spend_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_billable_event_id uuid,p_amount_bdag numeric,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_policy private.advertising_finance_policy;
  v_finance private.advertising_campaign_finance;
  v_event private.advertising_events;
  v_prior private.advertising_financial_events;
  v_amount numeric(20,8);v_escrow uuid;v_revenue uuid;v_tx uuid;
begin
  if coalesce((select auth.role()),'')<>'service_role' then raise exception using errcode='42501',message='advertising_finance_internal_only';end if;
  if p_idempotency_key is null or p_billable_event_id is null or p_amount_bdag is null
    or p_amount_bdag<=0 or p_amount_bdag<>round(p_amount_bdag,8) then
    raise exception using errcode='22023',message='advertising_spend_invalid';end if;
  v_amount:=p_amount_bdag::numeric(20,8);

  select * into v_finance from private.advertising_campaign_finance
  where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;

  select * into v_prior from private.advertising_financial_events
  where event_type='spend' and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.billable_event_id<>p_billable_event_id
      or v_prior.amount_bdag<>v_amount then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;

  select * into strict v_policy from private.advertising_finance_policy where singleton=true;
  if not v_policy.spend_enabled then raise exception using errcode='55000',message='advertising_finance_spend_disabled';end if;
  if exists(select 1 from private.advertising_canary_policy where singleton and canary_enabled) then
    raise exception using errcode='55000',message='advertising_canary_spend_disabled';end if;
  if v_finance.finance_status<>'funded' then raise exception using errcode='22023',message='advertising_campaign_not_spendable';end if;
  select * into v_event from private.advertising_events where id=p_billable_event_id;
  if not found or v_event.campaign_id<>p_campaign_id or v_event.event_type not in('impression','click') then
    raise exception using errcode='22023',message='advertising_billable_event_invalid';end if;
  if v_policy.spend_requires_billable_event and exists(
    select 1 from private.advertising_financial_events
    where event_type='spend' and billable_event_id=p_billable_event_id
  ) then raise exception using errcode='23505',message='advertising_billable_event_already_charged';end if;
  if v_amount>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag then
    raise exception using errcode='22023',message='advertising_campaign_overspend';end if;

  v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
  v_revenue:=public.ensure_marketplace_ads_account(v_policy.shared_revenue_account_type);
  perform 1 from public.ledger_accounts where id=any(array[v_escrow,v_revenue]) order by id for update;
  v_tx:=gen_random_uuid();
  insert into public.financial_transactions(
    id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
    reference_type,reference_id,idempotency_key,initiated_by
  ) values (
    v_tx,v_escrow,v_revenue,'advertising_campaign_spend',v_amount,0,'BDAG','completed',
    'advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_finance.funded_by_user_id
  );
  perform public.ledger_debit(v_tx,v_escrow,v_amount,'Advertising campaign billable spend',
    pg_catalog.jsonb_build_object('campaign_id',p_campaign_id,'billable_event_id',p_billable_event_id));
  perform public.ledger_credit(v_tx,v_revenue,v_amount,'Shared Ads revenue',
    pg_catalog.jsonb_build_object('campaign_id',p_campaign_id,'billable_event_id',p_billable_event_id));
  insert into private.advertising_financial_events(
    campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key,billable_event_id
  ) values (p_campaign_id,'spend',v_amount,v_tx,p_idempotency_key,p_billable_event_id);
  update private.advertising_campaign_finance set spent_bdag=spent_bdag+v_amount
  where campaign_id=p_campaign_id;
  return private.advertising_campaign_finance_result(p_campaign_id);
end;
$$;

create or replace function public.settle_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_policy private.advertising_finance_policy;
  v_finance private.advertising_campaign_finance;
  v_prior private.advertising_financial_events;
  v_settlement private.advertising_financial_settlements;
  v_unused numeric(20,8);v_escrow uuid;v_tx uuid;v_settled_at timestamptz:=clock_timestamp();
begin
  if coalesce((select auth.role()),'')<>'service_role' then raise exception using errcode='42501',message='advertising_finance_internal_only';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;

  select * into v_finance from private.advertising_campaign_finance
  where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;

  select * into v_settlement from private.advertising_financial_settlements
  where idempotency_key=p_idempotency_key;
  if found then
    if v_settlement.campaign_id<>p_campaign_id then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;

  select * into strict v_policy from private.advertising_finance_policy where singleton=true;
  if not v_policy.settlement_enabled then raise exception using errcode='55000',message='advertising_finance_settlement_disabled';end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,pg_catalog.clock_timestamp(),false,null) then
    raise exception using errcode='55000',message='advertising_canary_settlement_denied';end if;
  select * into v_settlement from private.advertising_financial_settlements where campaign_id=p_campaign_id;
  if found then return private.advertising_campaign_finance_result(p_campaign_id);end if;
  if v_finance.finance_status<>'funded' then raise exception using errcode='22023',message='advertising_campaign_not_settleable';end if;
  v_unused:=v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag;
  if v_unused<0 then raise exception using errcode='23514',message='advertising_campaign_finance_equation_invalid';end if;
  if v_unused>0 then
    select * into v_prior from private.advertising_financial_events
    where event_type='release' and idempotency_key=p_idempotency_key;
    if found and (v_prior.campaign_id<>p_campaign_id or v_prior.amount_bdag<>v_unused) then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
    perform 1 from public.ledger_accounts
    where id=any(array[v_escrow,v_finance.funding_source_account_id]) order by id for update;
    v_tx:=gen_random_uuid();
    insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,idempotency_key,initiated_by
    ) values (
      v_tx,v_escrow,v_finance.funding_source_account_id,'advertising_campaign_release',v_unused,0,'BDAG','completed',
      'advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_finance.funded_by_user_id
    );
    perform public.ledger_debit(v_tx,v_escrow,v_unused,'Advertising campaign unused budget release',
      pg_catalog.jsonb_build_object('campaign_id',p_campaign_id));
    perform public.ledger_credit(v_tx,v_finance.funding_source_account_id,v_unused,'Advertising budget returned to original source',
      pg_catalog.jsonb_build_object('campaign_id',p_campaign_id));
    insert into private.advertising_financial_events(
      campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key
    ) values (p_campaign_id,'release',v_unused,v_tx,p_idempotency_key);
  end if;
  update private.advertising_campaign_finance set
    released_bdag=released_bdag+v_unused,finance_status='settled',settled_at=v_settled_at
  where campaign_id=p_campaign_id;
  insert into private.advertising_financial_settlements(
    campaign_id,idempotency_key,budget_bdag,funded_bdag,spent_bdag,
    released_before_bdag,released_on_settlement_bdag,settled_at
  ) values (
    p_campaign_id,p_idempotency_key,v_finance.budget_bdag,v_finance.funded_bdag,
    v_finance.spent_bdag,v_finance.released_bdag,v_unused,v_settled_at
  );
  return private.advertising_campaign_finance_result(p_campaign_id);
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
  if not private.advertising_canary_delivery_allowed(v_ad.campaign_id,p_viewer_user_id,p_placement_code,v_at_time) then
    v_reasons:=pg_catalog.array_append(v_reasons,'advertising_canary_restriction');
    v_structural:=false;v_viewer:=false;
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
  v_canary private.advertising_canary_policy;
  v_canary_count bigint;
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
  select * into v_canary from private.advertising_canary_policy where singleton;
  if v_canary.canary_enabled then
    select * into strict v_canary from private.advertising_canary_policy where singleton for update;
    select * into v_prior from private.advertising_events where event_key=p_event_key;
    if found then
      if v_prior.event_type<>'impression' or v_prior.ad_id<>p_ad_id
        or v_prior.placement_code<>p_placement_code
        or v_prior.viewer_user_id is distinct from p_viewer_user_id then
        raise exception using errcode='23505', message='advertising_event_idempotency_conflict';
      end if;
      return pg_catalog.to_jsonb(v_prior);
    end if;
    v_context := private.advertising_current_delivery_context(p_ad_id,p_placement_code);
    if (v_context->>'campaign_id')::uuid is distinct from v_canary.campaign_id
      or p_viewer_user_id is distinct from v_canary.viewer_user_id
      or p_placement_code is distinct from v_canary.placement_code
      or v_canary.enabled_at is null or v_canary.expires_at is null
      or not (v_canary.enabled_at<=pg_catalog.clock_timestamp() and pg_catalog.clock_timestamp()<v_canary.expires_at) then
      raise exception using errcode='55000',message='advertising_canary_impression_denied';
    end if;
    select pg_catalog.count(*) into v_canary_count
    from private.advertising_events event
    where event.event_type='impression'
      and event.campaign_id=v_canary.campaign_id
      and event.viewer_user_id=v_canary.viewer_user_id
      and event.placement_code=v_canary.placement_code
      and event.occurred_at>=v_canary.enabled_at
      and event.occurred_at<v_canary.expires_at;
    if v_canary_count>=v_canary.max_impressions then
      raise exception using errcode='55000',message='advertising_canary_impression_limit_reached';
    end if;
  end if;
  v_preflight := private.advertising_delivery_preflight_at(p_ad_id,p_placement_code,p_viewer_user_id,clock_timestamp());
  if not coalesce((v_preflight->>'production_deliverable')::boolean,false) then
    raise exception using errcode='55000', message='advertising_impression_not_deliverable', detail=v_preflight::text;
  end if;
  if v_context is null then v_context := private.advertising_current_delivery_context(p_ad_id,p_placement_code); end if;
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


commit;
