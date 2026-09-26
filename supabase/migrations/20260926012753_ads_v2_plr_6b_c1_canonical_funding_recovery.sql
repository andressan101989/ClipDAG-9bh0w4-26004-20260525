-- ADS-V2-PLR-6B-C1: presentation-safe Funding capability and a trusted
-- management-session path through the existing canonical settlement authority.
-- This migration does not enable any production policy or mutate Ads data.

do $$
begin
  if pg_catalog.to_regprocedure('public.get_my_advertising_campaign_finance(uuid)') is null
    or pg_catalog.to_regprocedure('public.settle_advertising_campaign_budget_v2(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('private.advertising_canary_campaign_allowed(uuid,timestamptz,boolean,numeric)') is null then
    raise exception 'ads_v2_plr_6b_c1_foundation_required';
  end if;
end;
$$;

create or replace function public.get_my_advertising_campaign_finance(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_finance private.advertising_campaign_finance;
  v_policy private.advertising_finance_policy;
  v_result jsonb;
  v_funding_available boolean:=false;
  v_funding_state text;
begin
  if v_actor is null then
    raise exception using errcode='28000',message='advertising_auth_required';
  end if;

  perform 1 from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then
    raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';
  end if;

  select * into v_finance
  from private.advertising_campaign_finance
  where campaign_id=p_campaign_id;
  if not found then
    raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';
  end if;

  select * into strict v_policy
  from private.advertising_finance_policy
  where singleton=true;

  v_funding_available:=v_policy.funding_enabled
    and v_finance.finance_status='draft'
    and private.advertising_canary_campaign_allowed(
      p_campaign_id,
      pg_catalog.now(),
      true,
      v_finance.budget_bdag
    );

  v_funding_state:=case
    when v_finance.finance_status<>'draft' then 'already_funded'
    when not v_policy.funding_enabled then 'platform_disabled'
    when v_funding_available then 'available'
    else 'campaign_restricted'
  end;

  v_result:=private.advertising_campaign_finance_result(p_campaign_id)
    ||pg_catalog.jsonb_build_object(
      'finance_policy',pg_catalog.jsonb_build_object(
        'funding_enabled',v_policy.funding_enabled,
        'spend_enabled',v_policy.spend_enabled,
        'settlement_enabled',v_policy.settlement_enabled
      ),
      'funding_available',v_funding_available,
      'funding_state',v_funding_state,
      'budget_bdag_exact',v_finance.budget_bdag::text
    );

  return v_result;
end;
$$;

create or replace function public.settle_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce((select auth.role()),'');
  v_policy private.advertising_finance_policy;
  v_finance private.advertising_campaign_finance;
  v_prior private.advertising_financial_events;
  v_settlement private.advertising_financial_settlements;
  v_unused numeric(20,8);v_escrow uuid;v_tx uuid;v_settled_at timestamptz:=clock_timestamp();
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_finance_internal_only';
  end if;
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

revoke all on function public.get_my_advertising_campaign_finance(uuid) from public,anon;
grant execute on function public.get_my_advertising_campaign_finance(uuid) to authenticated;

revoke all on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) from public,anon;
grant execute on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) to authenticated,service_role;

revoke all on function public.settle_advertising_campaign_budget_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_advertising_campaign_budget_v2(uuid,uuid) to service_role;

comment on function public.get_my_advertising_campaign_finance(uuid) is
  'Owner-authorized canonical Ads Finance projection with server-derived Funding capability.';
comment on function public.settle_advertising_campaign_budget_v2(uuid,uuid) is
  'Canonical service/management-only unused-budget settlement authority; never browser executable.';
