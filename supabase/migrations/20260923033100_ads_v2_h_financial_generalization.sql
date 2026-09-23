begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_campaigns') is null
    or pg_catalog.to_regclass('private.advertising_events') is null
    or pg_catalog.to_regclass('public.financial_transactions') is null
    or pg_catalog.to_regclass('public.ledger_accounts') is null
    or pg_catalog.to_regclass('public.ledger_entries') is null then
    raise exception 'ads_v2_g_and_global_ledger_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_campaign_finance') is not null
    or pg_catalog.to_regclass('private.advertising_financial_events') is not null then
    raise exception 'ads_v2_h_finance_authority_conflict';
  end if;
  if (select count(*) from public.ledger_accounts
      where owner_id is null and account_type='marketplace_ads_escrow' and currency='BDAG') <> 1
    or (select count(*) from public.ledger_accounts
      where owner_id is null and account_type='marketplace_ads_revenue' and currency='BDAG') <> 1 then
    raise exception 'canonical_shared_ads_accounts_required';
  end if;
end;
$$;

create table private.advertising_finance_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null,
  currency text not null default 'BDAG',
  funding_enabled boolean not null default false,
  spend_enabled boolean not null default false,
  settlement_enabled boolean not null default false,
  shared_escrow_account_type text not null,
  shared_revenue_account_type text not null,
  spend_requires_billable_event boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_finance_policy_version_chk check (
    policy_version ~ '^nelyon-ads-finance-v[0-9]+$'
  ),
  constraint advertising_finance_policy_v1_safe_chk check (
    policy_version <> 'nelyon-ads-finance-v1'
    or (
      currency='BDAG'
      and not funding_enabled
      and not spend_enabled
      and not settlement_enabled
      and shared_escrow_account_type='marketplace_ads_escrow'
      and shared_revenue_account_type='marketplace_ads_revenue'
      and spend_requires_billable_event
    )
  )
);

create table private.advertising_campaign_finance (
  campaign_id uuid primary key references private.advertising_campaigns(id),
  budget_bdag numeric(20,8) not null,
  currency text not null default 'BDAG',
  finance_status text not null default 'draft',
  funded_bdag numeric(20,8) not null default 0,
  spent_bdag numeric(20,8) not null default 0,
  released_bdag numeric(20,8) not null default 0,
  funding_source_account_id uuid references public.ledger_accounts(id),
  funded_by_user_id uuid references public.user_profiles(id),
  funded_at timestamptz,
  settled_at timestamptz,
  created_by uuid not null references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_campaign_finance_budget_chk check (
    budget_bdag>0 and budget_bdag=round(budget_bdag,8)
  ),
  constraint advertising_campaign_finance_currency_chk check (currency='BDAG'),
  constraint advertising_campaign_finance_status_chk check (
    finance_status in ('draft','funded','settled')
  ),
  constraint advertising_campaign_finance_amounts_chk check (
    funded_bdag>=0 and spent_bdag>=0 and released_bdag>=0
    and spent_bdag + released_bdag <= funded_bdag
    and funded_bdag <= budget_bdag
  ),
  constraint advertising_campaign_finance_state_chk check (
    (finance_status='draft'
      and funded_bdag=0 and spent_bdag=0 and released_bdag=0
      and funding_source_account_id is null and funded_by_user_id is null
      and funded_at is null and settled_at is null)
    or
    (finance_status='funded'
      and funded_bdag=budget_bdag
      and funding_source_account_id is not null and funded_by_user_id is not null
      and funded_at is not null and settled_at is null)
    or
    (finance_status='settled'
      and funded_bdag=budget_bdag
      and spent_bdag+released_bdag=funded_bdag
      and funding_source_account_id is not null and funded_by_user_id is not null
      and funded_at is not null and settled_at is not null)
  ),
  constraint advertising_campaign_finance_creator_idempotency_unique
    unique (created_by,creation_idempotency_key)
);

create index advertising_campaign_finance_source_idx
  on private.advertising_campaign_finance(funding_source_account_id)
  where funding_source_account_id is not null;
create index advertising_campaign_finance_funded_by_idx
  on private.advertising_campaign_finance(funded_by_user_id)
  where funded_by_user_id is not null;
create index advertising_campaign_finance_created_by_idx
  on private.advertising_campaign_finance(created_by);

create table private.advertising_financial_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.advertising_campaigns(id),
  event_type text not null check (event_type in ('fund','spend','release')),
  amount_bdag numeric(20,8) not null check (
    amount_bdag>0 and amount_bdag=round(amount_bdag,8)
  ),
  financial_transaction_id uuid not null
    references public.financial_transactions(id),
  idempotency_key uuid not null,
  billable_event_id uuid references private.advertising_events(id),
  created_at timestamptz not null default clock_timestamp(),
  constraint advertising_financial_events_transaction_unique
    unique (financial_transaction_id),
  constraint advertising_financial_events_idempotency_unique
    unique (event_type,idempotency_key),
  constraint advertising_financial_events_billable_shape_chk check (
    (event_type='spend' and billable_event_id is not null)
    or (event_type in ('fund','release') and billable_event_id is null)
  )
);

create unique index advertising_financial_events_billable_unique
  on private.advertising_financial_events(billable_event_id)
  where event_type='spend';
create index advertising_financial_events_campaign_created_idx
  on private.advertising_financial_events(campaign_id,created_at);

create table private.advertising_financial_settlements (
  campaign_id uuid primary key references private.advertising_campaigns(id),
  idempotency_key uuid not null unique,
  budget_bdag numeric(20,8) not null,
  funded_bdag numeric(20,8) not null,
  spent_bdag numeric(20,8) not null,
  released_before_bdag numeric(20,8) not null,
  released_on_settlement_bdag numeric(20,8) not null,
  settled_at timestamptz not null default clock_timestamp(),
  constraint advertising_financial_settlements_amounts_chk check (
    budget_bdag>0 and funded_bdag=budget_bdag
    and spent_bdag>=0 and released_before_bdag>=0
    and released_on_settlement_bdag>=0
    and spent_bdag+released_before_bdag+released_on_settlement_bdag=funded_bdag
  )
);

insert into private.advertising_finance_policy(
  singleton,policy_version,shared_escrow_account_type,shared_revenue_account_type
) values (
  true,'nelyon-ads-finance-v1','marketplace_ads_escrow','marketplace_ads_revenue'
);

create trigger advertising_finance_policy_touch_updated_at
before update on private.advertising_finance_policy
for each row execute function private.advertising_touch_updated_at();
create trigger advertising_campaign_finance_touch_updated_at
before update on private.advertising_campaign_finance
for each row execute function private.advertising_touch_updated_at();

create or replace function private.advertising_financial_history_append_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='42501',message='advertising_financial_history_append_only';
end;
$$;

create trigger advertising_financial_events_append_only
before update or delete on private.advertising_financial_events
for each row execute function private.advertising_financial_history_append_only();
create trigger advertising_financial_settlements_append_only
before update or delete on private.advertising_financial_settlements
for each row execute function private.advertising_financial_history_append_only();

alter table private.advertising_finance_policy enable row level security;
alter table private.advertising_finance_policy force row level security;
alter table private.advertising_campaign_finance enable row level security;
alter table private.advertising_campaign_finance force row level security;
alter table private.advertising_financial_events enable row level security;
alter table private.advertising_financial_events force row level security;
alter table private.advertising_financial_settlements enable row level security;
alter table private.advertising_financial_settlements force row level security;

create policy advertising_finance_policy_deny_clients
on private.advertising_finance_policy for all to anon,authenticated
using(false) with check(false);
create policy advertising_campaign_finance_deny_clients
on private.advertising_campaign_finance for all to anon,authenticated
using(false) with check(false);
create policy advertising_financial_events_deny_clients
on private.advertising_financial_events for all to anon,authenticated
using(false) with check(false);
create policy advertising_financial_settlements_deny_clients
on private.advertising_financial_settlements for all to anon,authenticated
using(false) with check(false);

revoke all on table private.advertising_finance_policy from public, anon, authenticated, service_role;
revoke all on table private.advertising_campaign_finance from public, anon, authenticated, service_role;
revoke all on table private.advertising_financial_events from public, anon, authenticated, service_role;
revoke all on table private.advertising_financial_settlements from public, anon, authenticated, service_role;

create or replace function private.advertising_campaign_finance_result(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'authority','ads_v2','campaign_id',finance.campaign_id,'currency',finance.currency,
    'budget_bdag',finance.budget_bdag,'finance_status',finance.finance_status,
    'funded_bdag',finance.funded_bdag,'spent_bdag',finance.spent_bdag,
    'released_bdag',finance.released_bdag,
    'reserved_bdag',finance.funded_bdag-finance.spent_bdag-finance.released_bdag,
    'funded_at',finance.funded_at,'settled_at',finance.settled_at
  ) from private.advertising_campaign_finance finance where finance.campaign_id=p_campaign_id;
$$;

create or replace function public.create_my_advertising_campaign_finance_draft(
  p_campaign_id uuid,p_budget_bdag numeric,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_budget numeric(20,8);
  v_prior private.advertising_campaign_finance;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  if p_budget_bdag is null or p_budget_bdag<=0 or p_budget_bdag<>round(p_budget_bdag,8) then
    raise exception using errcode='22023',message='advertising_budget_invalid';
  end if;
  v_budget:=p_budget_bdag::numeric(20,8);
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode='42501',message='advertising_adult_eligibility_required';
  end if;
  perform 1 from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and campaign.status='draft'
    and account.status='active' and business.status='active'
    and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':ads-finance-draft:'||p_idempotency_key::text,0));
  select * into v_prior from private.advertising_campaign_finance
  where created_by=v_actor and creation_idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.budget_bdag<>v_budget then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';
    end if;
    return private.advertising_campaign_finance_result(v_prior.campaign_id);
  end if;
  select * into v_prior from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  if found then raise exception using errcode='23505',message='advertising_campaign_finance_exists';end if;
  insert into private.advertising_campaign_finance(
    campaign_id,budget_bdag,created_by,creation_idempotency_key
  ) values (p_campaign_id,v_budget,v_actor,p_idempotency_key);
  return private.advertising_campaign_finance_result(p_campaign_id);
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
  v_source uuid;v_escrow uuid;v_balance numeric;v_tx uuid:=gen_random_uuid();
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
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
  if v_finance.finance_status<>'draft' then raise exception using errcode='23505',message='advertising_campaign_already_funded';end if;
  v_source:=public.ensure_ledger_account(v_actor);
  v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
  perform 1 from public.ledger_accounts where id=any(array[v_source,v_escrow]) order by id for update;
  select balance into v_balance from public.ledger_accounts
  where id=v_source and owner_id=v_actor and account_type='user'
    and currency=v_policy.currency and not frozen;
  if v_balance is null or v_balance<v_finance.budget_bdag then
    raise exception using errcode='P0001',message='advertising_insufficient_bdag_balance';end if;
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
  v_amount numeric(20,8);v_escrow uuid;v_revenue uuid;v_tx uuid:=gen_random_uuid();
begin
  if coalesce((select auth.role()),'')<>'service_role' then raise exception using errcode='42501',message='advertising_finance_internal_only';end if;
  if p_idempotency_key is null or p_billable_event_id is null or p_amount_bdag is null
    or p_amount_bdag<=0 or p_amount_bdag<>round(p_amount_bdag,8) then
    raise exception using errcode='22023',message='advertising_spend_invalid';end if;
  v_amount:=p_amount_bdag::numeric(20,8);
  select * into strict v_policy from private.advertising_finance_policy where singleton=true;
  if not v_policy.spend_enabled then raise exception using errcode='55000',message='advertising_finance_spend_disabled';end if;
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
  select * into strict v_policy from private.advertising_finance_policy where singleton=true;
  if not v_policy.settlement_enabled then raise exception using errcode='55000',message='advertising_finance_settlement_disabled';end if;
  select * into v_finance from private.advertising_campaign_finance
  where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;
  select * into v_settlement from private.advertising_financial_settlements
  where idempotency_key=p_idempotency_key;
  if found and v_settlement.campaign_id<>p_campaign_id then
    raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
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

create or replace function public.get_my_advertising_campaign_finance(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  perform 1 from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;
  select private.advertising_campaign_finance_result(p_campaign_id)||pg_catalog.jsonb_build_object(
    'finance_policy',pg_catalog.jsonb_build_object(
      'funding_enabled',policy.funding_enabled,
      'spend_enabled',policy.spend_enabled,
      'settlement_enabled',policy.settlement_enabled
    )
  ) into v_result from private.advertising_finance_policy policy where policy.singleton;
  if v_result is null then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;
  return v_result;
end;
$$;

create or replace function public.reconcile_advertising_finance()
returns jsonb language sql stable security definer set search_path='' as $$
with event_rows as (
  select event.id,event.campaign_id,event.event_type,event.amount_bdag,event.billable_event_id,
    event.financial_transaction_id,finance.funding_source_account_id,
    transaction.operation_type,transaction.amount transaction_amount,transaction.reference_type,
    transaction.reference_id,transaction.from_account_id,transaction.to_account_id,
    source.account_type source_type,source.owner_id source_owner,
    destination.account_type destination_type,destination.owner_id destination_owner,
    coalesce((select sum(entry.amount) from public.ledger_entries entry
      where entry.txn_id=transaction.id and entry.entry_type='debit'
        and entry.account_id=transaction.from_account_id),0) source_debits,
    coalesce((select sum(entry.amount) from public.ledger_entries entry
      where entry.txn_id=transaction.id and entry.entry_type='credit'
        and entry.account_id=transaction.to_account_id),0) destination_credits,
    (select count(*) from public.ledger_entries entry where entry.txn_id=transaction.id) entry_count
  from private.advertising_financial_events event
  join private.advertising_campaign_finance finance on finance.campaign_id=event.campaign_id
  left join public.financial_transactions transaction on transaction.id=event.financial_transaction_id
  left join public.ledger_accounts source on source.id=transaction.from_account_id
  left join public.ledger_accounts destination on destination.id=transaction.to_account_id
), direction_audit as (
  select
    coalesce(sum(source_debits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_source_difference,
    coalesce(sum(destination_credits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_escrow_difference,
    count(*)filter(where event_type='fund' and (
      from_account_id is distinct from funding_source_account_id or source_type is distinct from'user'
      or destination_type is distinct from'marketplace_ads_escrow' or destination_owner is not null
      or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2
    )) funding_unexpected_entries,
    coalesce(sum(source_debits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_escrow_difference,
    coalesce(sum(destination_credits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_revenue_difference,
    count(*)filter(where event_type='spend' and (
      source_type is distinct from'marketplace_ads_escrow' or source_owner is not null
      or destination_type is distinct from'marketplace_ads_revenue' or destination_owner is not null
      or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2
    )) spend_unexpected_entries,
    coalesce(sum(source_debits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_escrow_difference,
    coalesce(sum(destination_credits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_destination_difference,
    count(*)filter(where event_type='release' and (
      source_type is distinct from'marketplace_ads_escrow' or source_owner is not null
      or to_account_id is distinct from funding_source_account_id
      or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2
    )) release_unexpected_entries,
    count(*)filter(where event_type='release' and to_account_id is distinct from funding_source_account_id) wrong_release_destination_count,
    count(*)filter(where operation_type is null) orphan_advertising_financial_events,
    count(*)filter(where operation_type is distinct from case event_type
      when'fund'then'advertising_campaign_fund'
      when'spend'then'advertising_campaign_spend'
      when'release'then'advertising_campaign_release'end
      or transaction_amount is distinct from amount_bdag
      or reference_type is distinct from'advertising_campaign'
      or reference_id is distinct from campaign_id::text) event_transaction_mismatches
  from event_rows
), ads_transactions as (
  select transaction.id,transaction.operation_type,count(event.id) event_count,
    count(event.id)filter(where event.event_type=case transaction.operation_type
      when'advertising_campaign_fund'then'fund'
      when'advertising_campaign_spend'then'spend'
      when'advertising_campaign_release'then'release'end) matching_event_count
  from public.financial_transactions transaction
  left join private.advertising_financial_events event on event.financial_transaction_id=transaction.id
  where transaction.operation_type in(
    'advertising_campaign_fund','advertising_campaign_spend','advertising_campaign_release')
  group by transaction.id,transaction.operation_type
), transaction_audit as (
  select count(*)filter(where event_count<>1 or matching_event_count<>1) orphan_advertising_transactions
  from ads_transactions
), campaign_events as (
  select campaign_id,count(*)filter(where event_type='fund') fund_count,
    coalesce(sum(amount_bdag)filter(where event_type='fund'),0) fund_amount,
    coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_amount,
    coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_amount
  from private.advertising_financial_events group by campaign_id
), campaign_audit as (
  select count(*) campaign_finance_state_mismatches
  from private.advertising_campaign_finance finance
  left join campaign_events event on event.campaign_id=finance.campaign_id
  where coalesce(event.spend_amount,0)<>finance.spent_bdag
    or coalesce(event.release_amount,0)<>finance.released_bdag
    or (finance.finance_status='draft' and (coalesce(event.fund_count,0)<>0 or coalesce(event.fund_amount,0)<>0))
    or (finance.finance_status in('funded','settled') and (coalesce(event.fund_count,0)<>1 or coalesce(event.fund_amount,0)<>finance.funded_bdag))
    or finance.spent_bdag+finance.released_bdag>finance.funded_bdag
), settlement_audit as (
  select count(*) settlement_mismatches
  from private.advertising_financial_settlements settlement
  join private.advertising_campaign_finance finance on finance.campaign_id=settlement.campaign_id
  where finance.finance_status<>'settled' or finance.settled_at is null
    or settlement.budget_bdag<>finance.budget_bdag or settlement.funded_bdag<>finance.funded_bdag
    or settlement.spent_bdag<>finance.spent_bdag
    or settlement.released_before_bdag+settlement.released_on_settlement_bdag<>finance.released_bdag
    or settlement.spent_bdag+settlement.released_before_bdag+settlement.released_on_settlement_bdag<>settlement.funded_bdag
), billable_audit as (
  select
    count(*)filter(where source.id is null or source.campaign_id<>event.campaign_id or source.event_type not in('impression','click')) billable_event_mismatches,
    coalesce(sum(greatest(duplicate.count-1,0)),0)::bigint duplicate_billable_spend_count
  from private.advertising_financial_events event
  left join private.advertising_events source on source.id=event.billable_event_id
  left join lateral (
    select count(*)::bigint count from private.advertising_financial_events candidate
    where candidate.event_type='spend' and candidate.billable_event_id=event.billable_event_id
  ) duplicate on true
  where event.event_type='spend'
), legacy_liability as (
  select coalesce(sum(total_budget_bdag-spent_bdag-released_bdag),0) amount
  from public.marketplace_ad_campaigns where funded_at is not null
), v2_liability as (
  select coalesce(sum(funded_bdag-spent_bdag-released_bdag),0) amount
  from private.advertising_campaign_finance where finance_status in('funded','settled')
), escrow as (
  select coalesce(balance,0) amount from public.ledger_accounts
  where owner_id is null and account_type='marketplace_ads_escrow' and currency='BDAG'
)
select pg_catalog.jsonb_build_object(
  'funding_reconciliation',funding_source_difference-funding_escrow_difference,
  'spend_reconciliation',spend_escrow_difference-spend_revenue_difference,
  'release_reconciliation',release_escrow_difference-release_destination_difference,
  'funding_unexpected_entries',funding_unexpected_entries,
  'spend_unexpected_entries',spend_unexpected_entries,
  'release_unexpected_entries',release_unexpected_entries,
  'event_transaction_mismatches',event_transaction_mismatches,
  'orphan_advertising_financial_events',orphan_advertising_financial_events,
  'orphan_advertising_transactions',orphan_advertising_transactions,
  'campaign_finance_state_mismatches',campaign_finance_state_mismatches,
  'settlement_mismatches',settlement_mismatches,
  'billable_event_mismatches',billable_event_mismatches,
  'duplicate_billable_spend_count',duplicate_billable_spend_count,
  'wrong_release_destination_count',wrong_release_destination_count,
  'shared_escrow_liability_difference',(select amount from escrow)-(select amount from legacy_liability)-(select amount from v2_liability)
)
from direction_audit cross join transaction_audit cross join campaign_audit
cross join settlement_audit cross join billable_audit;
$$;

create or replace function public.reconcile_marketplace_ad_finance() returns jsonb
language sql stable security definer set search_path=public as $$
with ad as(
 select e.id event_id,e.campaign_id,e.seller_id,e.event_type,e.amount_bdag,e.financial_transaction_id,
  f.operation_type,f.amount transaction_amount,f.reference_type,f.reference_id,
  src.account_type source_type,src.owner_id source_owner,dst.account_type destination_type,dst.owner_id destination_owner,
  coalesce((select sum(le.amount)from public.ledger_entries le where le.txn_id=f.id and le.entry_type='debit'and le.account_id=f.from_account_id),0) source_debits,
  coalesce((select sum(le.amount)from public.ledger_entries le where le.txn_id=f.id and le.entry_type='credit'and le.account_id=f.to_account_id),0) destination_credits,
  (select count(*)from public.ledger_entries le where le.txn_id=f.id) entry_count
 from public.marketplace_ad_financial_events e left join public.financial_transactions f on f.id=e.financial_transaction_id
 left join public.ledger_accounts src on src.id=f.from_account_id left join public.ledger_accounts dst on dst.id=f.to_account_id
), directional as(
 select
  coalesce(sum(source_debits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_source_difference,
  coalesce(sum(destination_credits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_escrow_difference,
  count(*)filter(where event_type='fund'and(source_type is distinct from'user'or source_owner is distinct from seller_id or destination_type is distinct from'marketplace_ads_escrow'or destination_owner is not null or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) funding_unexpected_entries,
  coalesce(sum(source_debits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_escrow_difference,
  coalesce(sum(destination_credits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_revenue_difference,
  count(*)filter(where event_type='spend'and(source_type is distinct from'marketplace_ads_escrow'or source_owner is not null or destination_type is distinct from'marketplace_ads_revenue'or destination_owner is not null or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) spend_unexpected_entries,
  coalesce(sum(source_debits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_escrow_difference,
  coalesce(sum(destination_credits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_destination_difference,
  count(*)filter(where event_type='release'and(source_type is distinct from'marketplace_ads_escrow'or source_owner is not null or destination_type is distinct from'user'or destination_owner is distinct from seller_id or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) release_unexpected_entries,
  count(*)filter(where event_type='release'and(destination_type is distinct from'user'or destination_owner is distinct from seller_id)) release_wrong_recipient,
  count(*)filter(where operation_type is null) orphan_ads_events,
  count(*)filter(where operation_type is distinct from case event_type when'fund'then'marketplace_ad_fund'when'spend'then'marketplace_ad_spend'when'release'then'marketplace_ad_release'end or transaction_amount is distinct from amount_bdag or reference_type is distinct from'marketplace_ad_campaign'or reference_id is distinct from campaign_id::text) event_transaction_mismatches
 from ad
), ads_tx as(
 select f.id,f.operation_type,count(e.id) event_count,
  count(e.id)filter(where e.event_type=case f.operation_type when'marketplace_ad_fund'then'fund'when'marketplace_ad_spend'then'spend'when'marketplace_ad_release'then'release'end) matching_event_count
 from public.financial_transactions f left join public.marketplace_ad_financial_events e on e.financial_transaction_id=f.id
 where f.operation_type in('marketplace_ad_fund','marketplace_ad_spend','marketplace_ad_release') group by f.id,f.operation_type
), tx_audit as(
 select count(*)filter(where event_count<>1 or matching_event_count<>1) orphan_ads_transactions,
  count(*)filter(where operation_type='marketplace_ad_fund')-(select count(*)from public.marketplace_ad_financial_events where event_type='fund') fund_transaction_event_count_difference,
  count(*)filter(where operation_type='marketplace_ad_spend')-(select count(*)from public.marketplace_ad_financial_events where event_type='spend') spend_transaction_event_count_difference,
  count(*)filter(where operation_type='marketplace_ad_release')-(select count(*)from public.marketplace_ad_financial_events where event_type='release') release_transaction_event_count_difference
 from ads_tx
), campaign_events as(
 select campaign_id,count(*)filter(where event_type='fund') fund_count,coalesce(sum(amount_bdag)filter(where event_type='fund'),0) fund_amount,
  coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_amount,coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_amount
 from public.marketplace_ad_financial_events group by campaign_id
), campaign_audit as(
 select count(*) campaign_accounting_mismatches from public.marketplace_ad_campaigns c left join campaign_events e on e.campaign_id=c.id
 where c.spent_bdag<0 or c.released_bdag<0 or c.spent_bdag+c.released_bdag>c.total_budget_bdag or c.total_budget_bdag-c.spent_bdag-c.released_bdag<0
 or coalesce(e.spend_amount,0)<>c.spent_bdag or coalesce(e.release_amount,0)<>c.released_bdag
 or (c.funded_at is null and(coalesce(e.fund_count,0)<>0 or coalesce(e.fund_amount,0)<>0))
 or (c.funded_at is not null and(coalesce(e.fund_count,0)<>1 or coalesce(e.fund_amount,0)<>c.total_budget_bdag))
), legacy_liability as(
 select coalesce(sum(total_budget_bdag-spent_bdag-released_bdag),0) amount
 from public.marketplace_ad_campaigns where funded_at is not null
), v2_liability as(
 select coalesce(sum(funded_bdag-spent_bdag-released_bdag),0) amount
 from private.advertising_campaign_finance where finance_status in('funded','settled')
), liability as(
 select (select amount from legacy_liability)+(select amount from v2_liability) amount
), escrow as(select coalesce(balance,0) amount from public.ledger_accounts where owner_id is null and account_type='marketplace_ads_escrow')
select jsonb_build_object(
 'funding_reconciliation',funding_source_difference-funding_escrow_difference,'spend_reconciliation',spend_escrow_difference-spend_revenue_difference,'release_reconciliation',release_escrow_difference-release_destination_difference,
 'funding_source_difference',funding_source_difference,'funding_escrow_difference',funding_escrow_difference,'funding_unexpected_entries',funding_unexpected_entries,
 'spend_escrow_difference',spend_escrow_difference,'spend_revenue_difference',spend_revenue_difference,'spend_unexpected_entries',spend_unexpected_entries,
 'release_escrow_difference',release_escrow_difference,'release_destination_difference',release_destination_difference,'release_unexpected_entries',release_unexpected_entries,'release_wrong_recipient',release_wrong_recipient,
 'unexpected_ads_entries',funding_unexpected_entries+spend_unexpected_entries+release_unexpected_entries,'event_transaction_mismatches',event_transaction_mismatches,'orphan_ads_events',orphan_ads_events,
 'orphan_ads_transactions',orphan_ads_transactions,'fund_transaction_event_count_difference',fund_transaction_event_count_difference,'spend_transaction_event_count_difference',spend_transaction_event_count_difference,'release_transaction_event_count_difference',release_transaction_event_count_difference,
 'campaign_accounting_mismatches',campaign_accounting_mismatches,'campaign_equation_mismatches',campaign_accounting_mismatches,'escrow_liability_difference',(select amount from escrow)-(select amount from liability)
)from directional cross join tx_audit cross join campaign_audit;
$$;

revoke execute on function private.advertising_financial_history_append_only() from public,anon,authenticated,service_role;
revoke execute on function private.advertising_campaign_finance_result(uuid) from public,anon,authenticated;

revoke all on function public.create_my_advertising_campaign_finance_draft(uuid,numeric,uuid) from public,anon;
revoke all on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) from public,anon;
revoke all on function public.get_my_advertising_campaign_finance(uuid) from public,anon;
grant execute on function public.create_my_advertising_campaign_finance_draft(uuid,numeric,uuid) to authenticated;
grant execute on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) to authenticated;
grant execute on function public.get_my_advertising_campaign_finance(uuid) to authenticated;

revoke all on function public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid) from public, anon, authenticated;
revoke all on function public.settle_advertising_campaign_budget_v2(uuid,uuid) from public, anon, authenticated;
revoke all on function public.reconcile_advertising_finance() from public, anon, authenticated;
grant execute on function public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid) to service_role;
grant execute on function public.settle_advertising_campaign_budget_v2(uuid,uuid) to service_role;
grant execute on function public.reconcile_advertising_finance() to service_role;

revoke all on function public.reconcile_marketplace_ad_finance() from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_ad_finance() to service_role;

notify pgrst,'reload schema';
commit;
