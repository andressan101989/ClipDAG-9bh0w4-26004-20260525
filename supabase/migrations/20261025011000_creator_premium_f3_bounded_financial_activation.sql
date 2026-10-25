begin;

-- F3 extends the canonical finance policy and facts. This foundation cannot
-- be armed: a separately reviewed activation migration must replace BOTH
-- named foundation guards. No participant, envelope or movement is added.
create table private.creator_premium_finance_authorizations (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('OPEN','CLOSED')),
  approval_digest text not null check (approval_digest ~ '^[0-9a-f]{64}$'),
  configuration_digest text not null check (configuration_digest ~ '^[0-9a-f]{64}$'),
  buyer_id uuid not null references auth.users(id) on update restrict on delete restrict,
  creator_id uuid not null references auth.users(id) on update restrict on delete restrict,
  buyer_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  creator_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  platform_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  purchase_content_id uuid not null references private.creator_premium_contents(id) on update restrict on delete restrict,
  purchase_offer_version_id uuid not null references private.creator_premium_offer_versions(id) on update restrict on delete restrict,
  subscription_plan_id uuid not null references private.creator_premium_plans(id) on update restrict on delete restrict,
  purchase_amount_bdag numeric not null,
  subscription_amount_bdag numeric not null,
  max_purchase_count integer not null check (max_purchase_count between 1 and 100),
  max_subscription_count integer not null check (max_subscription_count between 1 and 100),
  max_refund_count integer not null check (max_refund_count between 1 and 200),
  max_gross_bdag numeric not null,
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 9999),
  charge_starts_at timestamptz not null,
  charge_expires_at timestamptz not null,
  refund_expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null default session_user,
  constraint creator_premium_finance_authorizations_identity_check check (
    buyer_id<>creator_id and buyer_account_id<>creator_account_id
    and buyer_account_id<>platform_account_id and creator_account_id<>platform_account_id
  ),
  constraint creator_premium_finance_authorizations_amounts_check check (
    purchase_amount_bdag>0 and purchase_amount_bdag<=1000000000000
    and subscription_amount_bdag>0 and subscription_amount_bdag<=1000000000000
    and purchase_amount_bdag=pg_catalog.round(purchase_amount_bdag,8)
    and subscription_amount_bdag=pg_catalog.round(subscription_amount_bdag,8)
    and max_gross_bdag=pg_catalog.round(max_gross_bdag,8)
    and max_gross_bdag>=greatest(purchase_amount_bdag,subscription_amount_bdag)
    and max_gross_bdag<=purchase_amount_bdag*max_purchase_count+subscription_amount_bdag*max_subscription_count
    and max_refund_count<=max_purchase_count+max_subscription_count
  ),
  constraint creator_premium_finance_authorizations_window_check check (
    pg_catalog.isfinite(charge_starts_at) and pg_catalog.isfinite(charge_expires_at)
    and pg_catalog.isfinite(refund_expires_at) and pg_catalog.isfinite(created_at)
    and charge_expires_at>charge_starts_at
    and charge_expires_at<=charge_starts_at+interval '60 minutes'
    and refund_expires_at>=charge_expires_at
    and refund_expires_at<=charge_expires_at+interval '24 hours'
  )
);
create unique index creator_premium_finance_authorizations_one_open_uidx
  on private.creator_premium_finance_authorizations(status) where status='OPEN';
alter table private.creator_premium_finance_authorizations owner to postgres;
alter table private.creator_premium_finance_authorizations enable row level security;
alter table private.creator_premium_finance_authorizations force row level security;
revoke all on table private.creator_premium_finance_authorizations from public,anon,authenticated,service_role;

alter table private.creator_premium_finance_policy
  add column activation_mode text not null default 'off',
  add column active_authorization_id uuid references private.creator_premium_finance_authorizations(id) on update restrict on delete restrict,
  add constraint creator_premium_finance_policy_f3_mode_check check (
    (activation_mode='off' and not purchase_enabled and not subscription_enabled
      and not refunds_enabled and platform_fee_bps=0 and active_authorization_id is null)
    or (activation_mode='canary' and active_authorization_id is not null)
  ),
  add constraint creator_premium_finance_policy_f3_foundation_off_check check (
    activation_mode='off' and not purchase_enabled and not subscription_enabled
    and not refunds_enabled and platform_fee_bps=0 and active_authorization_id is null
  );

create function private.guard_creator_premium_finance_authorization_f3_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    raise exception using errcode='55000',message='creator_premium_finance_foundation_off';
  end if;
  raise exception using errcode='23514',message='creator_premium_finance_authorization_immutable';
end;
$$;
create trigger creator_premium_finance_auth_f3_foundation_insert_guard
before insert on private.creator_premium_finance_authorizations
for each row execute function private.guard_creator_premium_finance_authorization_f3_v1();
create trigger creator_premium_finance_authorizations_f3_immutable_guard
before update or delete on private.creator_premium_finance_authorizations
for each row execute function private.guard_creator_premium_finance_authorization_f3_v1();

alter table private.creator_premium_purchase_receipts add column finance_authorization_id uuid
  references private.creator_premium_finance_authorizations(id) on update restrict on delete restrict;
alter table private.creator_premium_subscription_periods add column finance_authorization_id uuid
  references private.creator_premium_finance_authorizations(id) on update restrict on delete restrict;
create index creator_premium_purchase_receipts_f3_authorization_idx
  on private.creator_premium_purchase_receipts(finance_authorization_id);
create index creator_premium_subscription_periods_f3_authorization_idx
  on private.creator_premium_subscription_periods(finance_authorization_id);

-- This is the sole aggregate exposure projection. Never filter by mutable
-- lifecycle/transaction state: refunds and expiry cannot replenish admission.
create function private.creator_premium_finance_consumption_f3_v1(p_authorization_id uuid)
returns table(purchase_count bigint,subscription_count bigint,refund_count bigint,gross_bdag numeric)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from private.creator_premium_purchase_receipts where finance_authorization_id=p_authorization_id),
    (select count(*) from private.creator_premium_subscription_periods where finance_authorization_id=p_authorization_id),
    (select count(*) from private.creator_premium_purchase_receipts where finance_authorization_id=p_authorization_id and reversal_financial_transaction_id is not null)
      +(select count(*) from private.creator_premium_subscription_periods where finance_authorization_id=p_authorization_id and reversal_financial_transaction_id is not null),
    coalesce((select sum(gross_amount_bdag) from private.creator_premium_purchase_receipts where finance_authorization_id=p_authorization_id),0)
      +coalesce((select sum(gross_amount_bdag) from private.creator_premium_subscription_periods where finance_authorization_id=p_authorization_id),0);
$$;

-- All nonterminal commands take this boundary BEFORE targets or mutable facts.
-- Policy UPDATE (rather than SHARE) serializes acquisition with disarm and with
-- the opposite operation, including at the final aggregate slot.
create function private.lock_creator_premium_finance_f3_v1()
returns private.creator_premium_finance_policy
language plpgsql security definer set search_path = '' as $$
declare v_policy private.creator_premium_finance_policy;
begin
  select policy.* into strict v_policy from private.creator_premium_finance_policy policy where singleton for update;
  if v_policy.active_authorization_id is not null then
    perform envelope.id from private.creator_premium_finance_authorizations envelope
      where envelope.id=v_policy.active_authorization_id for update;
  end if;
  return v_policy;
end;
$$;

-- Shared read-only eligibility: NULL means eligible; all denials are sanitized.
-- Account identity is server-resolved without creating or locking accounts.
create function private.creator_premium_charge_blocker_f3_v1(
  p_operation text,p_buyer_id uuid,p_creator_id uuid,p_target_id uuid,p_offer_id uuid,p_amount numeric
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select policy.* into v_policy from private.creator_premium_finance_policy policy where singleton;
  if not found or v_policy.activation_mode<>'canary'
    or (p_operation='purchase' and not v_policy.purchase_enabled)
    or (p_operation='subscription' and not v_policy.subscription_enabled) then
    return case when p_operation='purchase' then 'creator_premium_purchase_disabled' else 'creator_premium_subscription_disabled' end;
  end if;
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope
    where id=v_policy.active_authorization_id;
  if not found or v_authorization.status<>'OPEN' then return 'creator_premium_canary_not_open'; end if;
  if p_operation not in ('purchase','subscription') or p_buyer_id is distinct from v_authorization.buyer_id
    or p_creator_id is distinct from v_authorization.creator_id
    or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps
    or (p_operation='purchase' and (p_target_id is distinct from v_authorization.purchase_content_id
      or p_offer_id is distinct from v_authorization.purchase_offer_version_id or p_amount is distinct from v_authorization.purchase_amount_bdag))
    or (p_operation='subscription' and (p_target_id is distinct from v_authorization.subscription_plan_id
      or p_offer_id is not null or p_amount is distinct from v_authorization.subscription_amount_bdag))
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.buyer_account_id
      and owner_id=p_buyer_id and account_type='user' and currency='BDAG' and not frozen)
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.creator_account_id
      and owner_id=p_creator_id and account_type='user' and currency='BDAG' and not frozen)
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.platform_account_id
      and owner_id is null and account_type='platform' and currency='BDAG' and not frozen)
    or (select count(*) from public.ledger_accounts where owner_id=p_buyer_id and account_type='user' and currency='BDAG')<>1
    or (select count(*) from public.ledger_accounts where owner_id=p_creator_id and account_type='user' and currency='BDAG')<>1
    or (select count(*) from public.ledger_accounts where owner_id is null and account_type='platform' and currency='BDAG')<>1
  then return 'creator_premium_canary_denied'; end if;
  if v_now<v_authorization.charge_starts_at then return 'creator_premium_canary_not_open'; end if;
  if v_now>=v_authorization.charge_expires_at then return 'creator_premium_canary_expired'; end if;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
  if (p_operation='purchase' and v_usage.purchase_count>=v_authorization.max_purchase_count)
    or (p_operation='subscription' and v_usage.subscription_count>=v_authorization.max_subscription_count)
    or v_usage.gross_bdag+p_amount>v_authorization.max_gross_bdag then
    return 'creator_premium_canary_limit_reached';
  end if;
  return null;
end;
$$;

create function private.admit_creator_premium_charge_f3_v1(
  p_operation text,p_buyer_id uuid,p_creator_id uuid,p_target_id uuid,p_offer_id uuid,p_amount numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_policy private.creator_premium_finance_policy; v_blocker text;
begin
  v_policy := private.lock_creator_premium_finance_f3_v1();
  v_blocker := private.creator_premium_charge_blocker_f3_v1(p_operation,p_buyer_id,p_creator_id,p_target_id,p_offer_id,p_amount);
  if v_blocker is not null then raise exception using errcode='55000',message=v_blocker; end if;
  return v_policy.active_authorization_id;
end;
$$;

-- Immutable binding is independent of OPEN/flags/expiry so acquired rights and
-- reconciliation survive disarm. Legacy facts retain their NULL provenance.
create function private.creator_premium_authorization_binding_f3_v1(
  p_authorization_id uuid,p_operation text,p_buyer_id uuid,p_creator_id uuid,
  p_target_id uuid,p_offer_id uuid,p_amount numeric,p_fee integer,
  p_buyer_account_id uuid,p_creator_account_id uuid,p_platform_account_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_authorization_id is null or exists(select 1 from private.creator_premium_finance_authorizations envelope
    where id=p_authorization_id and buyer_id=p_buyer_id and creator_id=p_creator_id
      and buyer_account_id=p_buyer_account_id and creator_account_id=p_creator_account_id
      and platform_account_id=p_platform_account_id and platform_fee_bps=p_fee
      and ((p_operation='purchase' and purchase_content_id=p_target_id
        and purchase_offer_version_id=p_offer_id and purchase_amount_bdag=p_amount)
      or (p_operation='subscription' and subscription_plan_id=p_target_id
        and p_offer_id is null and subscription_amount_bdag=p_amount)));
$$;

create function private.admit_creator_premium_refund_f3_v1(p_authorization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
begin
  v_policy := private.lock_creator_premium_finance_f3_v1();
  if v_policy.activation_mode<>'canary' or not v_policy.refunds_enabled then
    raise exception using errcode='55000',message='creator_premium_refunds_disabled';
  end if;
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope
    where id=v_policy.active_authorization_id;
  if not found or v_authorization.status<>'OPEN' or p_authorization_id is distinct from v_authorization.id
    or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps then
    raise exception using errcode='55000',message='creator_premium_canary_denied';
  end if;
  if pg_catalog.clock_timestamp()<v_authorization.charge_starts_at then
    raise exception using errcode='55000',message='creator_premium_canary_not_open';
  end if;
  if pg_catalog.clock_timestamp()>=v_authorization.refund_expires_at then
    raise exception using errcode='55000',message='creator_premium_canary_expired';
  end if;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
  if v_usage.refund_count>=v_authorization.max_refund_count then
    raise exception using errcode='55000',message='creator_premium_canary_limit_reached';
  end if;
end;
$$;

-- Admission is a decision, not a reservation of time. Recheck after blocking
-- boundaries and immediately before a monetary success returns. The caller
-- keeps policy/authorization locks; an exception rolls back provisional ledger,
-- immutable fact, journal and velocity work together. Replays/no-ops are exempt.
create function private.assert_creator_premium_finance_deadline_f3_v1(
  p_authorization_id uuid,p_operation text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_envelope private.creator_premium_finance_authorizations;
begin
  if p_operation is null or p_operation not in ('charge','refund') then
    raise exception using errcode='22023',message='creator_premium_finance_operation_invalid';
  end if;
  select envelope.* into v_envelope from private.creator_premium_finance_authorizations envelope
    where id=p_authorization_id;
  if not found or v_envelope.status<>'OPEN' then
    raise exception using errcode='55000',message='creator_premium_canary_not_open';
  end if;
  if pg_catalog.clock_timestamp()<v_envelope.charge_starts_at then
    raise exception using errcode='55000',message='creator_premium_canary_not_open';
  end if;
  if pg_catalog.clock_timestamp()>=(case when p_operation='refund'
      then v_envelope.refund_expires_at else v_envelope.charge_expires_at end) then
    raise exception using errcode='55000',message='creator_premium_canary_expired';
  end if;
end;
$$;

create or replace function private.guard_creator_premium_purchase_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.finance_authorization_id, new.buyer_id, new.creator_id, new.content_id, new.offer_version_id,
      new.financial_transaction_id, new.idempotency_key, new.request_fingerprint,
      new.gross_amount_bdag, new.platform_fee_bdag, new.creator_net_bdag,
      new.platform_fee_bps, new.buyer_account_id, new.creator_account_id,
      new.platform_account_id, new.purchased_at, new.activated_at, new.access_expires_at)
     is distinct from
     (old.finance_authorization_id, old.buyer_id, old.creator_id, old.content_id, old.offer_version_id,
      old.financial_transaction_id, old.idempotency_key, old.request_fingerprint,
      old.gross_amount_bdag, old.platform_fee_bdag, old.creator_net_bdag,
      old.platform_fee_bps, old.buyer_account_id, old.creator_account_id,
      old.platform_account_id, old.purchased_at, old.activated_at, old.access_expires_at) then
    raise exception using errcode = '23514', message = 'creator_premium_purchase_snapshot_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.guard_creator_premium_period_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.finance_authorization_id, new.subscription_id, new.subscriber_id, new.creator_id, new.plan_id,
      new.starts_at, new.paid_through_at, new.financial_transaction_id,
      new.idempotency_key, new.request_fingerprint, new.billing_period_days,
      new.gross_amount_bdag, new.platform_fee_bdag, new.creator_net_bdag,
      new.platform_fee_bps, new.subscriber_account_id, new.creator_account_id,
      new.platform_account_id)
     is distinct from
     (old.finance_authorization_id, old.subscription_id, old.subscriber_id, old.creator_id, old.plan_id,
      old.starts_at, old.paid_through_at, old.financial_transaction_id,
      old.idempotency_key, old.request_fingerprint, old.billing_period_days,
      old.gross_amount_bdag, old.platform_fee_bdag, old.creator_net_bdag,
      old.platform_fee_bps, old.subscriber_account_id, old.creator_account_id,
      old.platform_account_id) then
    raise exception using errcode = '23514', message = 'creator_premium_period_snapshot_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.creator_premium_purchase_binding_is_valid_v1(p_receipt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.creator_premium_purchase_receipts receipt
    join public.financial_transactions finance_tx
      on finance_tx.id = receipt.financial_transaction_id
     and finance_tx.operation_type = 'creator_premium_purchase'
     and finance_tx.reference_type = 'creator_premium_purchase_receipt'
     and finance_tx.reference_id = receipt.id::text
     and finance_tx.from_account_id = receipt.buyer_account_id
     and finance_tx.to_account_id = receipt.creator_account_id
     and finance_tx.amount = receipt.gross_amount_bdag
     and finance_tx.fee_amount = receipt.platform_fee_bdag
     and finance_tx.currency = 'BDAG'
     and finance_tx.initiated_by = receipt.buyer_id
     and finance_tx.idempotency_key = receipt.idempotency_key::text
     and finance_tx.status = 'completed'
    join public.ledger_accounts payer_account
      on payer_account.id = receipt.buyer_account_id
     and payer_account.owner_id = receipt.buyer_id
     and payer_account.account_type = 'user'
     and payer_account.currency = 'BDAG'
    join public.ledger_accounts creator_account
      on creator_account.id = receipt.creator_account_id
     and creator_account.owner_id = receipt.creator_id
     and creator_account.account_type = 'user'
     and creator_account.currency = 'BDAG'
    join public.ledger_accounts platform_account
      on platform_account.id = receipt.platform_account_id
     and platform_account.owner_id is null
     and platform_account.account_type = 'platform'
     and platform_account.currency = 'BDAG'
    where private.creator_premium_authorization_binding_f3_v1(
      receipt.finance_authorization_id,'purchase',
      receipt.buyer_id,receipt.creator_id,receipt.content_id,receipt.offer_version_id,
      receipt.gross_amount_bdag,receipt.platform_fee_bps,
      receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id
    ) and receipt.id = p_receipt_id
      and receipt.access_state = 'active'
      and receipt.revoked_at is null
      and receipt.reversal_financial_transaction_id is null
      and receipt.gross_amount_bdag = receipt.creator_net_bdag + receipt.platform_fee_bdag
      and receipt.platform_fee_bdag = pg_catalog.round(
        receipt.gross_amount_bdag * receipt.platform_fee_bps / 10000,
        8
      )
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id) =
          case when receipt.platform_fee_bdag = 0 then 2 else 3 end
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id
             and entry.account_id = receipt.buyer_account_id
             and entry.entry_type = 'debit'
             and entry.amount = receipt.gross_amount_bdag
             and entry.metadata->>'fin_txn_id' = finance_tx.id::text
             and entry.metadata->>'reference_type' = 'creator_premium_purchase_receipt'
             and entry.metadata->>'reference_id' = receipt.id::text
             and entry.metadata->>'financial_leg' = 'payer_gross_debit') = 1
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id
             and entry.account_id = receipt.creator_account_id
             and entry.entry_type = 'credit'
             and entry.amount = receipt.creator_net_bdag
             and entry.metadata->>'fin_txn_id' = finance_tx.id::text
             and entry.metadata->>'reference_type' = 'creator_premium_purchase_receipt'
             and entry.metadata->>'reference_id' = receipt.id::text
             and entry.metadata->>'financial_leg' = 'creator_net_credit') = 1
      and (
        receipt.platform_fee_bdag = 0
        or (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id = finance_tx.id
              and entry.account_id = receipt.platform_account_id
              and entry.entry_type = 'credit'
              and entry.amount = receipt.platform_fee_bdag
              and entry.metadata->>'fin_txn_id' = finance_tx.id::text
              and entry.metadata->>'reference_type' = 'creator_premium_purchase_receipt'
              and entry.metadata->>'reference_id' = receipt.id::text
              and entry.metadata->>'financial_leg' = 'platform_fee_credit') = 1
      )
  ), false);
$$;

create or replace function private.creator_premium_period_binding_is_valid_v1(p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.creator_premium_subscription_periods period
    join public.financial_transactions finance_tx
      on finance_tx.id = period.financial_transaction_id
     and finance_tx.operation_type = 'creator_premium_subscription'
     and finance_tx.reference_type = 'creator_premium_subscription_period'
     and finance_tx.reference_id = period.id::text
     and finance_tx.from_account_id = period.subscriber_account_id
     and finance_tx.to_account_id = period.creator_account_id
     and finance_tx.amount = period.gross_amount_bdag
     and finance_tx.fee_amount = period.platform_fee_bdag
     and finance_tx.currency = 'BDAG'
     and finance_tx.initiated_by = period.subscriber_id
     and finance_tx.idempotency_key = period.idempotency_key::text
     and finance_tx.status = 'completed'
    join public.ledger_accounts payer_account
      on payer_account.id = period.subscriber_account_id
     and payer_account.owner_id = period.subscriber_id
     and payer_account.account_type = 'user'
     and payer_account.currency = 'BDAG'
    join public.ledger_accounts creator_account
      on creator_account.id = period.creator_account_id
     and creator_account.owner_id = period.creator_id
     and creator_account.account_type = 'user'
     and creator_account.currency = 'BDAG'
    join public.ledger_accounts platform_account
      on platform_account.id = period.platform_account_id
     and platform_account.owner_id is null
     and platform_account.account_type = 'platform'
     and platform_account.currency = 'BDAG'
    where private.creator_premium_authorization_binding_f3_v1(
      period.finance_authorization_id,'subscription',
      period.subscriber_id,period.creator_id,period.plan_id,null,
      period.gross_amount_bdag,period.platform_fee_bps,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id
    ) and period.id = p_period_id
      and period.access_state = 'active'
      and period.revoked_at is null
      and period.reversal_financial_transaction_id is null
      and period.gross_amount_bdag = period.creator_net_bdag + period.platform_fee_bdag
      and period.platform_fee_bdag = pg_catalog.round(
        period.gross_amount_bdag * period.platform_fee_bps / 10000,
        8
      )
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id) =
          case when period.platform_fee_bdag = 0 then 2 else 3 end
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id
             and entry.account_id = period.subscriber_account_id
             and entry.entry_type = 'debit'
             and entry.amount = period.gross_amount_bdag
             and entry.metadata->>'fin_txn_id' = finance_tx.id::text
             and entry.metadata->>'reference_type' = 'creator_premium_subscription_period'
             and entry.metadata->>'reference_id' = period.id::text
             and entry.metadata->>'financial_leg' = 'payer_gross_debit') = 1
      and (select pg_catalog.count(*) from public.ledger_entries entry
           where entry.txn_id = finance_tx.id
             and entry.account_id = period.creator_account_id
             and entry.entry_type = 'credit'
             and entry.amount = period.creator_net_bdag
             and entry.metadata->>'fin_txn_id' = finance_tx.id::text
             and entry.metadata->>'reference_type' = 'creator_premium_subscription_period'
             and entry.metadata->>'reference_id' = period.id::text
             and entry.metadata->>'financial_leg' = 'creator_net_credit') = 1
      and (
        period.platform_fee_bdag = 0
        or (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id = finance_tx.id
              and entry.account_id = period.platform_account_id
              and entry.entry_type = 'credit'
              and entry.amount = period.platform_fee_bdag
              and entry.metadata->>'fin_txn_id' = finance_tx.id::text
              and entry.metadata->>'reference_type' = 'creator_premium_subscription_period'
              and entry.metadata->>'reference_id' = period.id::text
              and entry.metadata->>'financial_leg' = 'platform_fee_credit') = 1
      )
  ), false);
$$;

create or replace function private.creator_premium_subscription_period_fact_is_valid_f2_v1(
  p_period_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.creator_premium_authorization_binding_f3_v1(
      period.finance_authorization_id,'subscription',period.subscriber_id,period.creator_id,
      period.plan_id,null,period.gross_amount_bdag,period.platform_fee_bps,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id
    ) and private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,
      period.reversal_financial_transaction_id,
      period.access_state,
      period.subscriber_id,
      period.creator_id,
      period.subscriber_account_id,
      period.creator_account_id,
      period.platform_account_id,
      'creator_premium_subscription_period',
      period.id,
      'creator_premium_subscription',
      'creator_premium_subscription_refund',
      period.idempotency_key,
      period.refund_idempotency_key,
      period.gross_amount_bdag,
      period.platform_fee_bdag,
      period.creator_net_bdag,
      period.platform_fee_bps
    )
    from private.creator_premium_subscription_periods period
    where period.id=p_period_id
  ),false);
$$;

drop function public.purchase_creator_premium_content_v1(uuid,uuid,uuid);

create or replace function public.purchase_creator_premium_content_v1(
  p_buyer_id uuid,
  p_content_id uuid,
  p_offer_version_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_command public.idempotency_keys;
  v_response jsonb;
  v_authorization_id uuid;
  v_policy private.creator_premium_finance_policy;
  v_content private.creator_premium_contents;
  v_offer private.creator_premium_offer_versions;
  v_existing private.creator_premium_purchase_receipts;
  v_receipt_id uuid := gen_random_uuid();
  v_charge record;
  v_velocity_allowed boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_buyer_id is null or p_content_id is null or p_offer_version_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_purchase_invalid_input';
  end if;

  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_purchase',p_buyer_id,p_content_id,p_offer_version_id::text
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-purchase|'||p_buyer_id::text||'|'||p_idempotency_key::text,
    0
  ));

  -- Canonical request lock protects every durable result, including an owned
  -- no-op. Its key can never turn into a later debit after a refund.
  select journal.* into v_command from public.idempotency_keys journal
  where journal.idempotency_key=p_idempotency_key::text
    and journal.operation_type='creator_premium_purchase_command'
    and journal.user_id=p_buyer_id;
  if found then
    if v_command.request_hash is distinct from v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_purchase_idempotency_conflict';
    end if;
    if v_command.status<>'completed' or v_command.response_body is null then
      raise exception using errcode='55000',message='creator_premium_purchase_idempotency_in_progress';
    end if;
    return v_command.response_body||pg_catalog.jsonb_build_object('money_moved',false,'replayed',true);
  end if;

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id=p_buyer_id
    and receipt.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint and not (
      v_existing.finance_authorization_id is null
      and v_existing.offer_version_id=p_offer_version_id and v_existing.content_id=p_content_id
      and v_existing.request_fingerprint=private.creator_premium_request_fingerprint_v1(
        'creator_premium_purchase',p_buyer_id,p_content_id
      )
    ) then
      raise exception using errcode='23505',message='creator_premium_purchase_idempotency_conflict';
    end if;
    if v_existing.access_state='active'
       and not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode='23514',message='creator_premium_purchase_financial_binding_invalid';
    end if;
    v_response := pg_catalog.jsonb_build_object(
      'receipt_id',v_existing.id,
      'content_id',v_existing.content_id,
      'financial_transaction_id',v_existing.financial_transaction_id,
      'gross_amount_bdag',v_existing.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing.creator_net_bdag::numeric(38,8)::text,
      'access_state',v_existing.access_state,
      'already_owned',v_existing.access_state='active',
      'money_moved',false,
      'replayed',true
    );
    insert into public.idempotency_keys(
      idempotency_key,operation_type,user_id,request_hash,status,response_body
    ) values(
      p_idempotency_key::text,'creator_premium_purchase_command',
      p_buyer_id,v_fingerprint,'completed',v_response
    );
    return v_response;
  end if;

  v_policy := private.lock_creator_premium_finance_f3_v1();
  if not private.creator_premium_actor_is_age_eligible_v1(p_buyer_id) then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_buyer_id) then
    raise exception using errcode='42501',message='creator_premium_buyer_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status<>'published' then
    raise exception using errcode='55000',message='creator_premium_content_not_published';
  end if;
  if v_content.access_mode not in ('purchase','purchase_or_subscription') then
    raise exception using errcode='55000',message='creator_premium_purchase_access_mode_invalid';
  end if;
  if p_buyer_id=v_content.creator_id then
    raise exception using errcode='42501',message='creator_premium_self_purchase_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_buyer_id,v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;

  select offer.* into v_offer
  from private.creator_premium_offer_versions offer
  where offer.content_id=v_content.id
    and offer.creator_id=v_content.creator_id
    and offer.status='active'
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_active_offer_not_found';
  end if;
  if v_offer.id is distinct from p_offer_version_id then
    raise exception using errcode='55000',message='creator_premium_offer_changed';
  end if;
  if v_offer.currency<>'BDAG' then
    raise exception using errcode='23514',message='creator_premium_offer_currency_invalid';
  end if;

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id=p_buyer_id
    and receipt.content_id=p_content_id
    and receipt.access_state='active'
  for update;
  if found then
    if not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode='23514',message='creator_premium_purchase_financial_binding_invalid';
    end if;
    v_response := pg_catalog.jsonb_build_object(
      'receipt_id',v_existing.id,
      'content_id',v_existing.content_id,
      'financial_transaction_id',v_existing.financial_transaction_id,
      'gross_amount_bdag',v_existing.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing.creator_net_bdag::numeric(38,8)::text,
      'access_state',v_existing.access_state,
      'already_owned',true,
      'money_moved',false,
      'replayed',false
    );
    insert into public.idempotency_keys(
      idempotency_key,operation_type,user_id,request_hash,status,response_body
    ) values(
      p_idempotency_key::text,'creator_premium_purchase_command',
      p_buyer_id,v_fingerprint,'completed',v_response
    );
    return v_response;
  end if;

  v_authorization_id := private.admit_creator_premium_charge_f3_v1(
    'purchase',p_buyer_id,v_content.creator_id,v_content.id,v_offer.id,v_offer.price_bdag
  );
  v_now := pg_catalog.clock_timestamp();

  -- Count only a command that can create a new charge. Exact-key replays and
  -- already-owned no-ops returned above never consume velocity headroom.
  -- The actor/operation advisory lock closes the read/upsert race inside the
  -- shared canonical velocity authority.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-velocity|creator_premium_purchase|'||p_buyer_id::text,
    0
  ));
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  begin
    select public.check_velocity_limit(
      p_buyer_id,'creator_premium_purchase',v_offer.price_bdag,100,0,1
    ) into v_velocity_allowed;
  exception when others then
    raise exception using errcode='55000',message='creator_premium_velocity_check_unavailable';
  end;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  if v_velocity_allowed is distinct from true then
    raise exception using errcode='55000',message='creator_premium_rate_limited';
  end if;

  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_buyer_id,v_content.creator_id,
    'creator_premium_purchase','creator_premium_purchase_receipt',
    v_receipt_id,p_idempotency_key,v_offer.price_bdag,v_policy.platform_fee_bps
  ) charge;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');

  -- Recheck the exact approved accounts after the canonical composer has
  -- locked them. A concurrent account change must roll back the whole charge.
  if not private.creator_premium_authorization_binding_f3_v1(
    v_authorization_id,'purchase',p_buyer_id,v_content.creator_id,v_content.id,v_offer.id,
    v_charge.gross_amount_bdag,v_policy.platform_fee_bps,
    v_charge.payer_account_id,v_charge.creator_account_id,v_charge.platform_account_id
  ) then
    raise exception using errcode='55000',message='creator_premium_canary_denied';
  end if;

  insert into private.creator_premium_purchase_receipts(
    id,buyer_id,creator_id,content_id,offer_version_id,
    financial_transaction_id,idempotency_key,request_fingerprint,
    gross_amount_bdag,platform_fee_bdag,creator_net_bdag,platform_fee_bps,
    buyer_account_id,creator_account_id,platform_account_id,
    finance_authorization_id,access_state,purchased_at,activated_at
  ) values(
    v_receipt_id,p_buyer_id,v_content.creator_id,v_content.id,v_offer.id,
    v_charge.financial_transaction_id,p_idempotency_key,v_fingerprint,
    v_charge.gross_amount_bdag,v_charge.platform_fee_bdag,
    v_charge.creator_net_bdag,v_policy.platform_fee_bps,
    v_charge.payer_account_id,v_charge.creator_account_id,v_charge.platform_account_id,
    v_authorization_id,'active',v_now,v_now
  );

  v_response := pg_catalog.jsonb_build_object(
    'receipt_id',v_receipt_id,
    'content_id',v_content.id,
    'financial_transaction_id',v_charge.financial_transaction_id,
    'gross_amount_bdag',v_charge.gross_amount_bdag::numeric(38,8)::text,
    'platform_fee_bdag',v_charge.platform_fee_bdag::numeric(38,8)::text,
    'creator_net_bdag',v_charge.creator_net_bdag::numeric(38,8)::text,
    'access_state','active',
    'already_owned',false,
    'money_moved',true,
    'replayed',false
  );
  insert into public.idempotency_keys(
    idempotency_key,operation_type,user_id,request_hash,status,response_body
  ) values(
    p_idempotency_key::text,'creator_premium_purchase_command',
    p_buyer_id,v_fingerprint,'completed',v_response
  );
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  return v_response;
end;
$$;

create or replace function public.subscribe_creator_premium_plan_v1(
  p_subscriber_id uuid,
  p_plan_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_authorization_id uuid;
  v_command public.idempotency_keys;
  v_policy private.creator_premium_finance_policy;
  v_plan private.creator_premium_plans;
  v_existing private.creator_premium_subscriptions;
  v_existing_period private.creator_premium_subscription_periods;
  v_subscription_id uuid := gen_random_uuid();
  v_period_id uuid := gen_random_uuid();
  v_charge record;
  v_velocity_allowed boolean;
  v_response jsonb;
  v_now timestamptz;
  v_paid_through timestamptz;
  v_renewed boolean := false;
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_plan_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_subscription_invalid_input';
  end if;

  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription',p_subscriber_id,p_plan_id
  );

  -- The request lock and canonical command journal make every result durable,
  -- including a no-money no-op while an already-paid period is still valid.
  -- Therefore replaying that key after expiry can never become a new charge.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-command|'||p_subscriber_id::text||'|'||p_idempotency_key::text,
    0
  ));
  select journal.* into v_command
  from public.idempotency_keys journal
  where journal.idempotency_key=p_idempotency_key::text
    and journal.operation_type='creator_premium_subscription_command'
    and journal.user_id=p_subscriber_id;
  if found then
    if v_command.request_hash is distinct from v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_idempotency_conflict';
    end if;
    if v_command.status<>'completed' or v_command.response_body is null then
      raise exception using errcode='55000',message='creator_premium_subscription_idempotency_in_progress';
    end if;
    return v_command.response_body||pg_catalog.jsonb_build_object(
      'money_moved',false,
      'replayed',true
    );
  end if;

  -- B4 predates the F2 command journal.  Recover an exact historical charge
  -- by its immutable period key before a terminal relationship can be
  -- mistaken for a renewal.  This both prevents a constraint-shaped error
  -- and backfills a durable replay response without moving money.
  select period.* into v_existing_period
  from private.creator_premium_subscription_periods period
  where period.subscriber_id=p_subscriber_id
    and period.idempotency_key=p_idempotency_key;
  if found then
    if v_existing_period.plan_id<>p_plan_id
       or v_existing_period.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_idempotency_conflict';
    end if;
    if not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_existing_period.id) then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;
    select subscription.* into v_existing
    from private.creator_premium_subscriptions subscription
    where subscription.id=v_existing_period.subscription_id
      and subscription.subscriber_id=p_subscriber_id
      and subscription.plan_id=p_plan_id;
    if not found then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;
    v_response := pg_catalog.jsonb_build_object(
      'subscription_id',v_existing.id,
      'period_id',v_existing_period.id,
      'plan_id',p_plan_id,
      'financial_transaction_id',v_existing_period.financial_transaction_id,
      'gross_amount_bdag',v_existing_period.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing_period.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing_period.creator_net_bdag::numeric(38,8)::text,
      'billing_period_days',v_existing_period.billing_period_days,
      'starts_at',v_existing_period.starts_at,
      'paid_through_at',v_existing_period.paid_through_at,
      'status','active',
      'already_subscribed',false,
      'renewed',false,
      'auto_renew',false,
      'money_moved',false,
      'replayed',true
    );
    insert into public.idempotency_keys(
      idempotency_key,operation_type,user_id,request_hash,status,response_body
    ) values(
      p_idempotency_key::text,'creator_premium_subscription_command',
      p_subscriber_id,v_fingerprint,'completed',v_response
    );
    return v_response;
  end if;

  insert into public.idempotency_keys(
    idempotency_key,operation_type,user_id,request_hash,status
  ) values(
    p_idempotency_key::text,'creator_premium_subscription_command',
    p_subscriber_id,v_fingerprint,'processing'
  );

  v_policy := private.lock_creator_premium_finance_f3_v1();
  if not private.creator_premium_actor_is_age_eligible_v1(p_subscriber_id) then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_subscriber_id) then
    raise exception using errcode='42501',message='creator_premium_subscriber_account_restricted';
  end if;

  -- Resolve the immutable family identity, then share the exact advisory
  -- protocol used by version activation.  Different request keys and plan
  -- versions in one family therefore cannot create overlapping paid access.
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id=p_plan_id;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_active_plan_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-plan-version:'||v_plan.creator_id::text||':'||v_plan.plan_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-family|'||p_subscriber_id::text||'|'||
      v_plan.creator_id::text||'|'||v_plan.plan_key,
    0
  ));
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id=p_plan_id
  for share;
  if not found or v_plan.status<>'active' then
    raise exception using errcode='P0002',message='creator_premium_active_plan_not_found';
  end if;
  if v_plan.currency<>'BDAG' or v_plan.billing_period_days not between 1 and 365 then
    raise exception using errcode='23514',message='creator_premium_plan_financial_identity_invalid';
  end if;
  if p_subscriber_id=v_plan.creator_id then
    raise exception using errcode='42501',message='creator_premium_self_subscription_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_plan.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_subscriber_id,v_plan.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;
  if not exists(
    select 1
    from private.creator_premium_plan_contents grant_map
    join private.creator_premium_contents content
      on content.id=grant_map.content_id
     and content.creator_id=grant_map.creator_id
    where grant_map.plan_id=v_plan.id
      and grant_map.creator_id=v_plan.creator_id
      and content.lifecycle_status='published'
      and content.access_mode in ('subscription','purchase_or_subscription')
  ) then
    raise exception using errcode='23514',message='creator_premium_plan_has_no_valid_content';
  end if;

  -- Read the open relationship across every immutable version of the family,
  -- then acquire mutable locks in the same period -> relationship order used
  -- by the refund authority.
  select subscription.* into v_existing
  from private.creator_premium_subscriptions subscription
  join private.creator_premium_plans family_plan
    on family_plan.id=subscription.plan_id
   and family_plan.creator_id=subscription.creator_id
  where subscription.subscriber_id=p_subscriber_id
    and subscription.creator_id=v_plan.creator_id
    and family_plan.plan_key=v_plan.plan_key
    and subscription.status in ('pending','active','cancelled')
  order by subscription.created_at desc,subscription.id desc
  limit 1;

  if found then
    select period.* into v_existing_period
    from private.creator_premium_subscription_periods period
    where period.subscription_id=v_existing.id
      and period.subscriber_id=p_subscriber_id
      and period.plan_id=v_existing.plan_id
    order by period.paid_through_at desc,period.id desc
    limit 1
    for update;
    if not found then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;

    select subscription.* into v_existing
    from private.creator_premium_subscriptions subscription
    where subscription.id=v_existing.id
      and subscription.subscriber_id=p_subscriber_id
      and subscription.plan_id=v_existing.plan_id
    for update;
    if not found or v_existing.status not in ('active','cancelled') then
      raise exception using errcode='23514',message='creator_premium_subscription_state_invalid';
    end if;
    if v_existing_period.access_state not in ('active','expired')
       or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_existing_period.id) then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;

    v_now := pg_catalog.clock_timestamp();
    if v_existing_period.access_state='active'
       and v_existing_period.paid_through_at>v_now then
      if v_existing.plan_id<>v_plan.id then
        raise exception using errcode='55000',message='creator_premium_plan_family_access_active';
      end if;
      v_response := pg_catalog.jsonb_build_object(
        'subscription_id',v_existing.id,
        'period_id',v_existing_period.id,
        'plan_id',v_plan.id,
        'financial_transaction_id',v_existing_period.financial_transaction_id,
        'gross_amount_bdag',v_existing_period.gross_amount_bdag::text,
        'platform_fee_bdag',v_existing_period.platform_fee_bdag::text,
        'creator_net_bdag',v_existing_period.creator_net_bdag::text,
        'billing_period_days',v_existing_period.billing_period_days,
        'starts_at',v_existing_period.starts_at,
        'paid_through_at',v_existing_period.paid_through_at,
        'status',v_existing.status,
        'already_subscribed',true,
        'renewed',false,
        'auto_renew',false,
        'money_moved',false,
        'replayed',false
      );
      update public.idempotency_keys
      set status='completed',response_body=v_response,updated_at=v_now
      where idempotency_key=p_idempotency_key::text
        and operation_type='creator_premium_subscription_command'
        and user_id=p_subscriber_id;
      if not found then
        raise exception using errcode='23514',message='creator_premium_subscription_idempotency_journal_missing';
      end if;
      return v_response;
    end if;

    if v_existing_period.access_state='active' then
      update private.creator_premium_subscription_periods
      set access_state='expired',updated_at=v_now
      where id=v_existing_period.id and access_state='active';
      if not found then
        raise exception using errcode='40001',message='creator_premium_subscription_period_changed';
      end if;
    end if;
    update private.creator_premium_subscriptions
    set status='expired',ended_at=v_existing_period.paid_through_at,updated_at=v_now
    where id=v_existing.id and status in ('active','cancelled');
    if not found then
      raise exception using errcode='40001',message='creator_premium_subscription_state_changed';
    end if;
    v_renewed := true;
  else
    select exists(
      select 1
      from private.creator_premium_subscriptions history
      join private.creator_premium_plans history_plan
        on history_plan.id=history.plan_id
       and history_plan.creator_id=history.creator_id
      where history.subscriber_id=p_subscriber_id
        and history.creator_id=v_plan.creator_id
        and history_plan.plan_key=v_plan.plan_key
        and history.status in ('expired','revoked')
    ) into v_renewed;
    v_now := pg_catalog.clock_timestamp();
  end if;

  v_authorization_id := private.admit_creator_premium_charge_f3_v1(
    'subscription',p_subscriber_id,v_plan.creator_id,v_plan.id,null,v_plan.price_bdag
  );
  v_now := pg_catalog.clock_timestamp();

  -- The command journal, historical-period replay and active-period no-op all
  -- return above. Only a command that will charge consumes velocity headroom.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-velocity|creator_premium_subscribe|'||p_subscriber_id::text,
    0
  ));
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  begin
    select public.check_velocity_limit(
      p_subscriber_id,'creator_premium_subscribe',v_plan.price_bdag,20,0,24
    ) into v_velocity_allowed;
  exception when others then
    raise exception using errcode='55000',message='creator_premium_velocity_check_unavailable';
  end;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  if v_velocity_allowed is distinct from true then
    raise exception using errcode='55000',message='creator_premium_rate_limited';
  end if;

  v_paid_through := v_now+pg_catalog.make_interval(days=>v_plan.billing_period_days);
  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_subscriber_id,v_plan.creator_id,
    'creator_premium_subscription','creator_premium_subscription_period',
    v_period_id,p_idempotency_key,v_plan.price_bdag,v_policy.platform_fee_bps
  ) charge;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');

  if not private.creator_premium_authorization_binding_f3_v1(
    v_authorization_id,'subscription',p_subscriber_id,v_plan.creator_id,v_plan.id,null,
    v_charge.gross_amount_bdag,v_policy.platform_fee_bps,
    v_charge.payer_account_id,v_charge.creator_account_id,v_charge.platform_account_id
  ) then
    raise exception using errcode='55000',message='creator_premium_canary_denied';
  end if;

  insert into private.creator_premium_subscriptions(
    id,subscriber_id,creator_id,plan_id,idempotency_key,status,started_at
  ) values(
    v_subscription_id,p_subscriber_id,v_plan.creator_id,v_plan.id,
    p_idempotency_key,'active',v_now
  );
  insert into private.creator_premium_subscription_periods(
    id,subscription_id,subscriber_id,creator_id,plan_id,
    starts_at,paid_through_at,financial_transaction_id,
    idempotency_key,request_fingerprint,billing_period_days,
    gross_amount_bdag,platform_fee_bdag,creator_net_bdag,platform_fee_bps,
    subscriber_account_id,creator_account_id,platform_account_id,finance_authorization_id,access_state
  ) values(
    v_period_id,v_subscription_id,p_subscriber_id,v_plan.creator_id,v_plan.id,
    v_now,v_paid_through,v_charge.financial_transaction_id,
    p_idempotency_key,v_fingerprint,v_plan.billing_period_days,
    v_charge.gross_amount_bdag,v_charge.platform_fee_bdag,v_charge.creator_net_bdag,
    v_policy.platform_fee_bps,v_charge.payer_account_id,v_charge.creator_account_id,
    v_charge.platform_account_id,v_authorization_id,'active'
  );

  v_response := pg_catalog.jsonb_build_object(
    'subscription_id',v_subscription_id,
    'period_id',v_period_id,
    'plan_id',v_plan.id,
    'financial_transaction_id',v_charge.financial_transaction_id,
    'gross_amount_bdag',v_charge.gross_amount_bdag::text,
    'platform_fee_bdag',v_charge.platform_fee_bdag::text,
    'creator_net_bdag',v_charge.creator_net_bdag::text,
    'billing_period_days',v_plan.billing_period_days,
    'starts_at',v_now,
    'paid_through_at',v_paid_through,
    'status','active',
    'already_subscribed',v_renewed,
    'renewed',v_renewed,
    'auto_renew',false,
    'money_moved',true,
    'replayed',false
  );
  update public.idempotency_keys
  set status='completed',response_body=v_response,updated_at=pg_catalog.clock_timestamp()
  where idempotency_key=p_idempotency_key::text
    and operation_type='creator_premium_subscription_command'
    and user_id=p_subscriber_id;
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_idempotency_journal_missing';
  end if;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_authorization_id,'charge');
  return v_response;
end;
$$;

create or replace function public.refund_creator_premium_purchase_v1(
  p_receipt_id uuid,
  p_idempotency_key uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt private.creator_premium_purchase_receipts;
  v_policy private.creator_premium_finance_policy;
  v_original public.financial_transactions;
  v_reason text;
  v_fingerprint text;
  v_refund_transaction_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode = '42501', message = 'creator_premium_internal_authority_required';
  end if;
  if p_receipt_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_purchase_refund_invalid_input';
  end if;
  v_reason := private.validate_creator_premium_refund_reason_v1(p_reason_code);
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_purchase_refund', p_receipt_id, p_receipt_id, v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-purchase-refund|' || p_receipt_id::text || '|' || p_idempotency_key::text, 0)
  );
  v_policy := private.lock_creator_premium_finance_f3_v1();

  select receipt.* into v_receipt
  from private.creator_premium_purchase_receipts receipt
  where receipt.id = p_receipt_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_purchase_receipt_not_found';
  end if;
  if v_receipt.access_state = 'refunded' then
    if v_receipt.refund_idempotency_key = p_idempotency_key
       and v_receipt.refund_request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_purchase_refund_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id', v_receipt.id,
      'reversal_financial_transaction_id', v_receipt.reversal_financial_transaction_id,
      'access_state', 'refunded',
      'money_moved', false,
      'replayed', v_receipt.refund_idempotency_key = p_idempotency_key,
      'already_refunded', true
    );
  end if;
  perform private.admit_creator_premium_refund_f3_v1(v_receipt.finance_authorization_id);
  if not private.creator_premium_purchase_binding_is_valid_v1(v_receipt.id) then
    raise exception using errcode = '23514', message = 'creator_premium_purchase_financial_binding_invalid';
  end if;
  select finance_tx.* into v_original
  from public.financial_transactions finance_tx
  where finance_tx.id = v_receipt.financial_transaction_id
  for update;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_receipt.finance_authorization_id,'refund');

  v_refund_transaction_id := private.post_creator_premium_refund_v1(
    v_receipt.buyer_id, v_receipt.creator_id,
    v_receipt.buyer_account_id, v_receipt.creator_account_id, v_receipt.platform_account_id,
    'creator_premium_purchase_refund', 'creator_premium_purchase_receipt',
    v_receipt.id, p_idempotency_key,
    v_receipt.gross_amount_bdag, v_receipt.platform_fee_bdag, v_receipt.creator_net_bdag
  );
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_receipt.finance_authorization_id,'refund');
  update public.financial_transactions
  set status = 'reversed'
  where id = v_original.id and status = 'completed';
  if not found then
    raise exception using errcode = '23514', message = 'creator_premium_purchase_financial_binding_invalid';
  end if;
  update private.creator_premium_purchase_receipts
  set access_state = 'refunded',
      reversal_financial_transaction_id = v_refund_transaction_id,
      refund_idempotency_key = p_idempotency_key,
      refund_request_fingerprint = v_fingerprint,
      refund_reason_code = v_reason,
      refunded_at = v_now,
      revoked_at = v_now,
      updated_at = v_now
  where id = v_receipt.id;

  perform private.assert_creator_premium_finance_deadline_f3_v1(v_receipt.finance_authorization_id,'refund');
  return pg_catalog.jsonb_build_object(
    'receipt_id', v_receipt.id,
    'reversal_financial_transaction_id', v_refund_transaction_id,
    'access_state', 'refunded',
    'money_moved', true,
    'replayed', false,
    'already_refunded', false
  );
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'creator_premium_refund_source_balance_insufficient' then
      raise exception using errcode = 'P0001', message = 'creator_premium_refund_source_balance_insufficient';
    end if;
    raise;
end;
$$;

create or replace function public.refund_creator_premium_subscription_period_v1(
  p_period_id uuid,
  p_idempotency_key uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period private.creator_premium_subscription_periods;
  v_subscription private.creator_premium_subscriptions;
  v_policy private.creator_premium_finance_policy;
  v_original public.financial_transactions;
  v_reason text;
  v_fingerprint text;
  v_refund_transaction_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_period_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_subscription_refund_invalid_input';
  end if;
  v_reason := private.validate_creator_premium_refund_reason_v1(p_reason_code);
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription_refund',p_period_id,p_period_id,v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-refund|'||p_period_id::text||'|'||p_idempotency_key::text,
    0
  ));

  v_policy := private.lock_creator_premium_finance_f3_v1();

  -- Period -> relationship is the canonical lock order shared with renewal.
  select period.* into v_period
  from private.creator_premium_subscription_periods period
  where period.id=p_period_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_subscription_period_not_found';
  end if;
  if v_period.access_state='refunded' then
    if v_period.refund_idempotency_key=p_idempotency_key
       and v_period.refund_request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_refund_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'period_id',v_period.id,
      'subscription_id',v_period.subscription_id,
      'reversal_financial_transaction_id',v_period.reversal_financial_transaction_id,
      'access_state','refunded',
      'money_moved',false,
      'replayed',v_period.refund_idempotency_key=p_idempotency_key,
      'already_refunded',true
    );
  end if;

  perform private.admit_creator_premium_refund_f3_v1(v_period.finance_authorization_id);
  if v_period.access_state not in ('active','expired')
     or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_period.id) then
    raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
  end if;

  select subscription.* into v_subscription
  from private.creator_premium_subscriptions subscription
  where subscription.id=v_period.subscription_id
  for update;
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_relationship_invalid';
  end if;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_period.finance_authorization_id,'refund');
  select finance_tx.* into v_original
  from public.financial_transactions finance_tx
  where finance_tx.id=v_period.financial_transaction_id
  for update;
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_period.finance_authorization_id,'refund');

  v_refund_transaction_id := private.post_creator_premium_refund_v1(
    v_period.subscriber_id,v_period.creator_id,
    v_period.subscriber_account_id,v_period.creator_account_id,v_period.platform_account_id,
    'creator_premium_subscription_refund','creator_premium_subscription_period',
    v_period.id,p_idempotency_key,
    v_period.gross_amount_bdag,v_period.platform_fee_bdag,v_period.creator_net_bdag
  );
  perform private.assert_creator_premium_finance_deadline_f3_v1(v_period.finance_authorization_id,'refund');
  update public.financial_transactions
  set status='reversed'
  where id=v_original.id and status='completed';
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
  end if;
  update private.creator_premium_subscription_periods
  set access_state='refunded',
      reversal_financial_transaction_id=v_refund_transaction_id,
      refund_idempotency_key=p_idempotency_key,
      refund_request_fingerprint=v_fingerprint,
      refund_reason_code=v_reason,
      refunded_at=v_now,
      revoked_at=v_now,
      updated_at=v_now
  where id=v_period.id;
  update private.creator_premium_subscriptions
  set status='revoked',
      ended_at=coalesce(ended_at,v_now),
      updated_at=v_now
  where id=v_period.subscription_id;

  -- Refunds are scoped to the immutable relationship for this paid period.
  -- This read-only postcondition probe makes the preservation of a later,
  -- independently paid renewal explicit without changing its lifecycle.
  perform 1
  from private.creator_premium_subscription_periods renewed_period
  where renewed_period.subscriber_id=v_period.subscriber_id
    and renewed_period.plan_id=v_period.plan_id
    and renewed_period.subscription_id <> v_period.subscription_id
    and renewed_period.access_state='active'
    and renewed_period.starts_at<=v_now
    and renewed_period.paid_through_at>v_now
    and private.creator_premium_subscription_period_fact_is_valid_f2_v1(renewed_period.id)
  limit 1;

  perform private.assert_creator_premium_finance_deadline_f3_v1(v_period.finance_authorization_id,'refund');
  return pg_catalog.jsonb_build_object(
    'period_id',v_period.id,
    'subscription_id',v_period.subscription_id,
    'reversal_financial_transaction_id',v_refund_transaction_id,
    'access_state','refunded',
    'subscription_status','revoked',
    'money_moved',true,
    'replayed',false,
    'already_refunded',false
  );
exception
  when sqlstate 'P0001' then
    if sqlerrm='creator_premium_refund_source_balance_insufficient' then
      raise exception using errcode='P0001',message='creator_premium_refund_source_balance_insufficient';
    end if;
    raise;
end;
$$;

create or replace function private.creator_premium_commerce_projection_f3_v1(p_content_id uuid,p_legacy boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_entitlement record;
  v_policy private.creator_premium_finance_policy;
  v_media_ready boolean := false;
  v_purchase_owned boolean := false;
  v_result jsonb;
  v_f3_purchase_blocker text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode='22023',message='creator_premium_invalid_content';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id and content.lifecycle_status='published';
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor,v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;

  v_media_ready := case v_content.content_kind
    when 'image' then private.creator_premium_image_is_ready_v1(v_content.id)
    when 'video' then private.creator_premium_video_is_ready_v1(v_content.id)
    else false end;
  if not v_media_ready then
    raise exception using errcode='55000',message='creator_premium_media_unavailable';
  end if;

  select * into v_entitlement
  from private.resolve_creator_premium_entitlement_v1(v_content.id);
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  if p_legacy and v_policy.activation_mode='canary' then
    v_policy.purchase_enabled := false;
    v_policy.subscription_enabled := false;
    v_policy.refunds_enabled := false;
    v_policy.platform_fee_bps := 0;
  end if;
  select private.creator_premium_charge_blocker_f3_v1(
    'purchase',v_actor,v_content.creator_id,v_content.id,offer.id,offer.price_bdag
  ) into v_f3_purchase_blocker
  from private.creator_premium_offer_versions offer
  where offer.content_id=v_content.id and offer.creator_id=v_content.creator_id and offer.status='active';

  select exists(
    select 1
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id=v_actor
      and receipt.content_id=v_content.id
      and receipt.access_state='active'
      and private.creator_premium_purchase_binding_is_valid_v1(receipt.id)
  ) into v_purchase_owned;

  select pg_catalog.jsonb_build_object(
    'content',pg_catalog.jsonb_build_object(
      'id',content.id,'creator_id',content.creator_id,'title',content.title,
      'description',content.description,'content_kind',content.content_kind,
      'access_mode',content.access_mode,
      'teaser_url',private.creator_premium_teaser_url_v1(content.id),
      'published_at',content.published_at
    ),
    'creator',pg_catalog.jsonb_build_object(
      'id',content.creator_id,'username',profile.username,
      'display_name',profile.display_name,'avatar_url',profile.avatar_url
    ),
    'offer',(
      select pg_catalog.jsonb_build_object(
        'id',offer.id,'version',offer.version,'price_bdag',offer.price_bdag::text,
        'currency',offer.currency,'status',offer.status
      )
      from private.creator_premium_offer_versions offer
      where offer.content_id=content.id
        and offer.creator_id=content.creator_id
        and offer.status='active'
      order by offer.version desc,offer.id desc
      limit 1
    ),
    'plans',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',plan.id,'name',plan.name,'description',plan.description,
        'version',plan.version,'price_bdag',plan.price_bdag::text,
        'currency',plan.currency,'billing_period_days',plan.billing_period_days,
        'status',plan.status,
        'relationship',case when plan.relationship_id is null then null else
          pg_catalog.jsonb_build_object(
            'id',plan.relationship_id,'status',plan.relationship_status,
            'cancelled_at',plan.relationship_cancelled_at,
            'paid_through_at',plan.relationship_paid_through_at,
            'access_state',plan.relationship_access_state
          ) end,
        'subscription_available',v_policy.subscription_enabled and plan.f3_blocker is null
          and v_actor<>content.creator_id and plan.relationship_id is null,
        'subscription_blocker',case
          when v_actor=content.creator_id then 'creator_premium_self_subscription_forbidden'
          when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
          when plan.f3_blocker is not null then plan.f3_blocker
          when plan.relationship_access_active
            and plan.relationship_plan_id<>plan.id
            then 'creator_premium_plan_family_access_active'
          when plan.relationship_id is not null then 'creator_premium_renewal_required'
          else null end,
        'renewal_available',v_policy.subscription_enabled and plan.f3_blocker is null
          and v_actor<>content.creator_id
          and plan.relationship_id is not null
          and plan.relationship_status<>'pending'
          and plan.relationship_period_id is not null
          and plan.relationship_fact_valid
          and not plan.relationship_access_active,
        'renewal_blocker',case
          when v_actor=content.creator_id then 'creator_premium_self_subscription_forbidden'
          when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
          when plan.f3_blocker is not null then plan.f3_blocker
          when plan.relationship_id is null then 'creator_premium_subscription_not_found'
          when plan.relationship_status='pending' then 'creator_premium_subscription_state_invalid'
          when plan.relationship_period_id is null or not plan.relationship_fact_valid
            then 'creator_premium_subscription_financial_binding_invalid'
          when plan.relationship_access_active
            and plan.relationship_plan_id<>plan.id
            then 'creator_premium_plan_family_access_active'
          when plan.relationship_access_active then 'creator_premium_already_subscribed'
          else null end
      ) order by plan.price_bdag,plan.id)
      from (
        select active_plan.*,
          private.creator_premium_charge_blocker_f3_v1('subscription',v_actor,active_plan.creator_id,active_plan.id,null,active_plan.price_bdag) as f3_blocker,
          relationship.id as relationship_id,
          relationship.plan_id as relationship_plan_id,
          case when relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.paid_through_at<=v_now
            and relationship.fact_valid
            then 'expired' else relationship.status end as relationship_status,
          relationship.cancelled_at as relationship_cancelled_at,
          relationship.period_id as relationship_period_id,
          relationship.paid_through_at as relationship_paid_through_at,
          case when relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.paid_through_at<=v_now
            and relationship.fact_valid
            then 'expired' else relationship.access_state end as relationship_access_state,
          relationship.fact_valid as relationship_fact_valid,
          relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.starts_at<=v_now
            and relationship.paid_through_at>v_now
            and relationship.fact_valid as relationship_access_active
        from private.creator_premium_plan_contents mapping
        join private.creator_premium_plans active_plan
          on active_plan.id=mapping.plan_id
         and active_plan.creator_id=mapping.creator_id
        left join lateral (
          select subscription.id,subscription.plan_id,subscription.status,
            subscription.cancelled_at,
            period.id as period_id,period.starts_at,period.paid_through_at,
            period.access_state,
            private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)
              as fact_valid
          from private.creator_premium_subscriptions subscription
          join private.creator_premium_plans relationship_plan
            on relationship_plan.id=subscription.plan_id
           and relationship_plan.creator_id=subscription.creator_id
          left join lateral (
            select paid_period.*
            from private.creator_premium_subscription_periods paid_period
            where paid_period.subscription_id=subscription.id
              and paid_period.subscriber_id=subscription.subscriber_id
            order by paid_period.paid_through_at desc,paid_period.id desc
            limit 1
          ) period on true
          where subscription.subscriber_id=v_actor
            and subscription.creator_id=active_plan.creator_id
            and relationship_plan.plan_key=active_plan.plan_key
          order by subscription.created_at desc,subscription.id desc
          limit 1
        ) relationship on true
        where mapping.content_id=content.id
          and mapping.creator_id=content.creator_id
          and active_plan.status='active'
        order by active_plan.price_bdag,active_plan.id
        limit 100
      ) plan
    ),'[]'::jsonb),
    'plan_count',(
      select pg_catalog.count(*)
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans active_plan
        on active_plan.id=mapping.plan_id and active_plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id
        and mapping.creator_id=content.creator_id
        and active_plan.status='active'
    ),
    'plans_truncated',exists(
      select 1
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans active_plan
        on active_plan.id=mapping.plan_id and active_plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id
        and mapping.creator_id=content.creator_id
        and active_plan.status='active'
      order by active_plan.price_bdag,active_plan.id
      offset 100 limit 1
    ),
    'entitlement',pg_catalog.jsonb_build_object(
      'allowed',v_entitlement.allowed,'source',v_entitlement.source,
      'reason',v_entitlement.reason,'expires_at',v_entitlement.expires_at
    ),
    'operations',pg_catalog.jsonb_build_object(
      'purchase_available',v_policy.purchase_enabled and v_f3_purchase_blocker is null
        and v_actor<>content.creator_id
        and content.access_mode in ('purchase','purchase_or_subscription')
        and not v_purchase_owned
        and exists(
          select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active'
        ),
      'purchase_blocker',case
        when v_actor=content.creator_id then 'creator_premium_self_purchase_forbidden'
        when content.access_mode not in ('purchase','purchase_or_subscription')
          then 'creator_premium_purchase_access_mode_invalid'
        when v_purchase_owned then 'creator_premium_already_owned'
        when not exists(
          select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active'
        ) then 'creator_premium_active_offer_not_found'
        when not v_policy.purchase_enabled then 'creator_premium_purchase_disabled'
        when v_f3_purchase_blocker is not null then v_f3_purchase_blocker
        else null end
    ),
    'policy',pg_catalog.jsonb_build_object(
      'purchase_enabled',v_policy.purchase_enabled,
      'subscription_enabled',v_policy.subscription_enabled,
      'refunds_enabled',v_policy.refunds_enabled,
      'platform_fee_bps',v_policy.platform_fee_bps,
      'policy_version',v_policy.policy_version
    )
  ) into v_result
  from private.creator_premium_contents content
  left join public.public_user_profiles profile on profile.id=content.creator_id
  where content.id=v_content.id;

  return v_result;
end;
$$;

create or replace function private.creator_premium_subscriptions_projection_f3_v1(
  p_legacy boolean,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_policy private.creator_premium_finance_policy;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='creator_premium_subscription_cursor_invalid';
  end if;
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  if p_legacy and v_policy.activation_mode='canary' then
    v_policy.purchase_enabled := false;
    v_policy.subscription_enabled := false;
    v_policy.refunds_enabled := false;
    v_policy.platform_fee_bps := 0;
  end if;

  return (
    with base as (
      select
        subscription.id,subscription.creator_id,subscription.plan_id,
        subscription.status,subscription.started_at,subscription.cancelled_at,
        subscription.ended_at,subscription.created_at,subscription.updated_at,
        plan.name as plan_name,plan.description as plan_description,
        plan.version as plan_version,plan.billing_period_days,
        plan.price_bdag::text as plan_price_bdag,plan.currency,
        plan.status as plan_status,
        private.creator_premium_charge_blocker_f3_v1('subscription',v_actor,plan.creator_id,plan.id,null,plan.price_bdag) as f3_blocker,
        profile.username,profile.display_name,profile.avatar_url,
        period.id as period_id,period.starts_at,period.paid_through_at,
        period.access_state,period.gross_amount_bdag::text as gross_amount_bdag,
        private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)
          as period_fact_valid,
        not exists(
          select 1
          from private.creator_premium_subscriptions newer
          where newer.subscriber_id=subscription.subscriber_id
            and newer.plan_id=subscription.plan_id
            and (newer.created_at,newer.id)>(subscription.created_at,subscription.id)
        ) as is_latest_relationship
      from private.creator_premium_subscriptions subscription
      join private.creator_premium_plans plan
        on plan.id=subscription.plan_id and plan.creator_id=subscription.creator_id
      left join public.public_user_profiles profile on profile.id=subscription.creator_id
      left join lateral (
        select paid_period.*
        from private.creator_premium_subscription_periods paid_period
        where paid_period.subscription_id=subscription.id
          and paid_period.subscriber_id=subscription.subscriber_id
        order by paid_period.paid_through_at desc,paid_period.id desc
        limit 1
      ) period on true
      where subscription.subscriber_id=v_actor
        and (p_cursor_created_at is null
          or (subscription.created_at,subscription.id)<(p_cursor_created_at,p_cursor_id))
    ), projected as (
      select base.*,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then 'expired' else base.status end as effective_status,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then coalesce(base.ended_at,base.paid_through_at)
          else base.ended_at end as effective_ended_at,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then 'expired' else base.access_state end as effective_access_state,
        base.status in ('active','cancelled')
          and base.access_state='active'
          and base.starts_at<=v_now
          and base.paid_through_at>v_now
          and base.period_fact_valid as access_active
      from base
    ), candidates as (
      select projected.*,
        projected.is_latest_relationship
          and v_policy.subscription_enabled and projected.f3_blocker is null
          and projected.plan_status='active'
          and projected.effective_status<>'pending'
          and projected.period_id is not null
          and projected.period_fact_valid
          and not projected.access_active as renewal_available
      from projected
      order by projected.created_at desc,projected.id desc
      limit v_limit+1
    ), page as (
      select * from candidates
      order by created_at desc,id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'policy',pg_catalog.jsonb_build_object(
        'purchase_enabled',v_policy.purchase_enabled,
        'subscription_enabled',v_policy.subscription_enabled,
        'refunds_enabled',v_policy.refunds_enabled,
        'platform_fee_bps',v_policy.platform_fee_bps,
        'policy_version',v_policy.policy_version
      ),
      'items',coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',item.id,
          'creator',pg_catalog.jsonb_build_object(
            'id',item.creator_id,'username',item.username,
            'display_name',item.display_name,'avatar_url',item.avatar_url
          ),
          'plan',pg_catalog.jsonb_build_object(
            'id',item.plan_id,'name',item.plan_name,
            'description',item.plan_description,'version',item.plan_version,
            'price_bdag',item.plan_price_bdag,'currency',item.currency,
            'billing_period_days',item.billing_period_days,'status',item.plan_status,
            'relationship',pg_catalog.jsonb_build_object(
              'id',item.id,'status',item.effective_status,
              'cancelled_at',item.cancelled_at,
              'paid_through_at',item.paid_through_at,
              'access_state',item.effective_access_state
            ),
            'subscription_available',false,
            'subscription_blocker',case when item.access_active
              then 'creator_premium_already_subscribed'
              else 'creator_premium_renewal_required' end,
            'renewal_available',item.renewal_available,
            'renewal_blocker',case
              when not item.is_latest_relationship then 'creator_premium_subscription_superseded'
              when item.plan_status<>'active' then 'creator_premium_active_plan_not_found'
              when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
              when item.f3_blocker is not null then item.f3_blocker
              when item.effective_status='pending' then 'creator_premium_subscription_state_invalid'
              when item.period_id is null or not item.period_fact_valid
                then 'creator_premium_subscription_financial_binding_invalid'
              when item.access_active then 'creator_premium_already_subscribed'
              else null end
          ),
          'status',item.effective_status,'started_at',item.started_at,
          'cancelled_at',item.cancelled_at,'ended_at',item.effective_ended_at,
          'period',case when item.period_id is null then null else
            pg_catalog.jsonb_build_object(
              'id',item.period_id,'starts_at',item.starts_at,
              'paid_through_at',item.paid_through_at,
              'access_state',item.effective_access_state,
              'gross_amount_bdag',item.gross_amount_bdag
            ) end,
          'access_active',item.access_active,'auto_renew',false,
          'renewal_supported',true,
          'renewal_available',item.renewal_available,
          'renewal_blocker',case
            when not item.is_latest_relationship then 'creator_premium_subscription_superseded'
            when item.plan_status<>'active' then 'creator_premium_active_plan_not_found'
            when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
              when item.f3_blocker is not null then item.f3_blocker
            when item.effective_status='pending' then 'creator_premium_subscription_state_invalid'
            when item.period_id is null or not item.period_fact_valid
              then 'creator_premium_subscription_financial_binding_invalid'
            when item.access_active then 'creator_premium_already_subscribed'
            else null end,
          'is_latest_relationship',item.is_latest_relationship,
          'created_at',item.created_at,'updated_at',item.updated_at
        ) order by item.created_at desc,item.id desc)
        from page item
      ),'[]'::jsonb),
      'next_cursor',case when (select pg_catalog.count(*) from candidates)>v_limit then (
        select pg_catalog.jsonb_build_object('created_at',last_item.created_at,'id',last_item.id)
        from page last_item
        order by last_item.created_at,last_item.id
        limit 1
      ) else null end
    )
  );
end;
$$;

create or replace function public.get_creator_premium_commerce_v1(p_content_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.creator_premium_commerce_projection_f3_v1(p_content_id,true);
$$;

create or replace function public.get_my_creator_premium_subscriptions_v1(
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb language sql stable security definer set search_path = '' as $$
  select private.creator_premium_subscriptions_projection_f3_v1(true,p_cursor_created_at,p_cursor_id,p_limit);
$$;

create or replace function public.get_creator_premium_commerce_v2(p_content_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.creator_premium_commerce_projection_f3_v1(p_content_id,false);
$$;

create or replace function public.get_my_creator_premium_subscriptions_v2(
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb language sql stable security definer set search_path = '' as $$
  select private.creator_premium_subscriptions_projection_f3_v1(false,p_cursor_created_at,p_cursor_id,p_limit);
$$;

create function public.get_admin_creator_premium_finance_activation_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_limits jsonb;
  v_consumed jsonb;
  v_remaining jsonb;
begin
  perform public.admin_require_capability('finance.ledger.read');
  select policy.* into strict v_policy from private.creator_premium_finance_policy policy where singleton;
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope
    where id=v_policy.active_authorization_id;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
  v_limits := pg_catalog.jsonb_build_object(
    'purchase_count',coalesce(v_authorization.max_purchase_count,0),
    'subscription_count',coalesce(v_authorization.max_subscription_count,0),
    'refund_count',coalesce(v_authorization.max_refund_count,0),
    'purchase_amount_bdag',coalesce(v_authorization.purchase_amount_bdag,0)::numeric(38,8)::text,
    'subscription_amount_bdag',coalesce(v_authorization.subscription_amount_bdag,0)::numeric(38,8)::text,
    'gross_bdag',coalesce(v_authorization.max_gross_bdag,0)::numeric(38,8)::text);
  v_consumed := pg_catalog.jsonb_build_object(
    'purchase_count',v_usage.purchase_count,'subscription_count',v_usage.subscription_count,
    'refund_count',v_usage.refund_count,'gross_bdag',v_usage.gross_bdag::numeric(38,8)::text);
  v_remaining := pg_catalog.jsonb_build_object(
    'purchase_count',coalesce(v_authorization.max_purchase_count,0)-v_usage.purchase_count,
    'subscription_count',coalesce(v_authorization.max_subscription_count,0)-v_usage.subscription_count,
    'refund_count',coalesce(v_authorization.max_refund_count,0)-v_usage.refund_count,
    'gross_bdag',(coalesce(v_authorization.max_gross_bdag,0)-v_usage.gross_bdag)::numeric(38,8)::text);
  return pg_catalog.jsonb_build_object('activation',pg_catalog.jsonb_build_object(
    'mode',v_policy.activation_mode,'authorization_id',v_policy.active_authorization_id,
    'charge_starts_at',v_authorization.charge_starts_at,'charge_expires_at',v_authorization.charge_expires_at,
    'refund_expires_at',v_authorization.refund_expires_at,
    'operations',pg_catalog.jsonb_build_object('purchase_enabled',v_policy.purchase_enabled,
      'subscription_enabled',v_policy.subscription_enabled,'refunds_enabled',v_policy.refunds_enabled),
    'limits',v_limits,'consumed',v_consumed,'remaining',v_remaining));
end;
$$;

-- Explicit ACL and ownership include every newly created helper and every
-- changed canonical binding/mutation. No helper is a client-callable bypass.
do $$
declare v_function record;
begin
  for v_function in
    select proc.oid::regprocedure as signature from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid=proc.pronamespace
    where namespace.nspname='private' and (
      proc.proname like '%creator_premium%f3_v1'
      or proc.proname in ('guard_creator_premium_purchase_snapshot_v1',
        'guard_creator_premium_period_snapshot_v1','creator_premium_purchase_binding_is_valid_v1',
        'creator_premium_period_binding_is_valid_v1','creator_premium_subscription_period_fact_is_valid_f2_v1')
    )
  loop
    execute pg_catalog.format('alter function %s owner to postgres',v_function.signature);
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  end loop;
end;
$$;

alter function public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid) owner to postgres;
alter function public.refund_creator_premium_purchase_v1(uuid,uuid,text) owner to postgres;
alter function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) owner to postgres;
revoke all on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.refund_creator_premium_purchase_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.refund_creator_premium_purchase_v1(uuid,uuid,text) to service_role;
grant execute on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) to service_role;

alter function public.get_creator_premium_commerce_v1(uuid) owner to postgres;
alter function public.get_creator_premium_commerce_v2(uuid) owner to postgres;
alter function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer) owner to postgres;
alter function public.get_my_creator_premium_subscriptions_v2(timestamptz,uuid,integer) owner to postgres;
alter function public.get_admin_creator_premium_finance_activation_v1() owner to postgres;
revoke all on function public.get_creator_premium_commerce_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_creator_premium_commerce_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_my_creator_premium_subscriptions_v2(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_creator_premium_finance_activation_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_creator_premium_commerce_v1(uuid) to authenticated;
grant execute on function public.get_creator_premium_commerce_v2(uuid) to authenticated;
grant execute on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_my_creator_premium_subscriptions_v2(timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_creator_premium_finance_activation_v1() to authenticated;

notify pgrst, 'reload schema';
commit;
