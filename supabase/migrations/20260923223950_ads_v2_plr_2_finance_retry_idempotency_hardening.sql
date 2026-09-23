-- PLR-2 allows exact completed-operation replay after a finance kill switch is
-- disabled while preserving authorization and all new-mutation safety gates.
begin;

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
  v_age_rows bigint;
  v_adult_eligible_rows bigint;
  v_enabled bigint;
  v_blockers text[] := array['campaign_activation_not_implemented'];
  v_capability_not_enabled text[] := array[]::text[];
begin
  perform public.admin_require_capability('advertising.ads.read');
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select * into strict v_events from private.advertising_event_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
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
      'precise_viewer_location_matching_enabled',v_targeting.precise_viewer_location_matching_enabled
    ),
    'delivery',pg_catalog.jsonb_build_object(
      'delivery_policy_version',v_delivery.policy_version,
      'global_v2_delivery_enabled',v_delivery.global_v2_delivery_enabled,
      'enabled_placement_count',v_enabled,
      'frequency_enforcement_enabled',v_delivery.frequency_enforcement_enabled,
      'geo_matching_enabled',v_delivery.geo_matching_enabled,
      'language_matching_enabled',v_delivery.language_matching_enabled,
      'campaign_activation_implemented',false
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

commit;
