-- CREATOR-PREMIUM-B4: canonical, production-disabled Premium finance authority.
-- This migration extends the existing Premium commercial facts and the
-- canonical BDAG ledger. It creates no wallet, balance, escrow, or ledger.

create table private.creator_premium_finance_policy (
  singleton boolean primary key default true check (singleton = true),
  purchase_enabled boolean not null default false,
  subscription_enabled boolean not null default false,
  refunds_enabled boolean not null default false,
  platform_fee_bps integer not null default 0
    check (platform_fee_bps between 0 and 9999),
  policy_version text not null
    check (policy_version = pg_catalog.btrim(policy_version)
      and pg_catalog.char_length(policy_version) between 1 and 80),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint creator_premium_finance_policy_timestamps_check
    check (updated_at >= created_at)
);

alter table private.creator_premium_finance_policy enable row level security;
alter table private.creator_premium_finance_policy force row level security;
revoke all on table private.creator_premium_finance_policy
  from public, anon, authenticated, service_role;

insert into private.creator_premium_finance_policy(
  singleton, purchase_enabled, subscription_enabled, refunds_enabled,
  platform_fee_bps, policy_version
) values (
  true, false, false, false, 0, 'creator-premium-b4-v1'
);

alter table private.creator_premium_plans
  add column billing_period_days integer not null,
  add constraint creator_premium_plans_billing_period_days_check
    check (billing_period_days between 1 and 365);

alter table private.creator_premium_purchase_receipts
  add column request_fingerprint text not null,
  add column gross_amount_bdag numeric(38,8) not null,
  add column platform_fee_bdag numeric(38,8) not null,
  add column creator_net_bdag numeric(38,8) not null,
  add column platform_fee_bps integer not null,
  add column buyer_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column creator_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column platform_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column refund_idempotency_key uuid,
  add column refund_request_fingerprint text,
  add column refund_reason_code text,
  add column refunded_at timestamptz,
  add constraint creator_premium_purchase_receipts_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint creator_premium_purchase_receipts_split_check check (
    gross_amount_bdag > 0
    and creator_net_bdag > 0
    and platform_fee_bdag >= 0
    and platform_fee_bps between 0 and 9999
    and gross_amount_bdag = creator_net_bdag + platform_fee_bdag
    and gross_amount_bdag = round(gross_amount_bdag, 8)
    and creator_net_bdag = round(creator_net_bdag, 8)
    and platform_fee_bdag = round(platform_fee_bdag, 8)
  ),
  add constraint creator_premium_purchase_receipts_accounts_distinct_check check (
    buyer_account_id <> creator_account_id
    and buyer_account_id <> platform_account_id
    and creator_account_id <> platform_account_id
  ),
  add constraint creator_premium_purchase_receipts_refund_fields_check check (
    (access_state <> 'refunded'
      and refund_idempotency_key is null
      and refund_request_fingerprint is null
      and refund_reason_code is null
      and refunded_at is null)
    or
    (access_state = 'refunded'
      and refund_idempotency_key is not null
      and refund_request_fingerprint ~ '^[0-9a-f]{64}$'
      and refund_reason_code = pg_catalog.btrim(refund_reason_code)
      and pg_catalog.char_length(refund_reason_code) between 1 and 80
      and refunded_at is not null)
  );

create unique index creator_premium_purchase_receipts_active_buyer_content_uidx
  on private.creator_premium_purchase_receipts(buyer_id, content_id)
  where access_state = 'active';

create unique index creator_premium_purchase_receipts_refund_idempotency_uidx
  on private.creator_premium_purchase_receipts(buyer_id, refund_idempotency_key)
  where refund_idempotency_key is not null;

alter table private.creator_premium_subscriptions
  add column cancel_idempotency_key uuid,
  add column cancel_request_fingerprint text,
  add constraint creator_premium_subscriptions_cancel_fields_check check (
    (cancel_idempotency_key is null
      and cancel_request_fingerprint is null
      and status <> 'cancelled')
    or
    (cancel_idempotency_key is not null
      and cancel_request_fingerprint ~ '^[0-9a-f]{64}$')
  );

create unique index creator_premium_subscriptions_cancel_idempotency_uidx
  on private.creator_premium_subscriptions(subscriber_id, cancel_idempotency_key)
  where cancel_idempotency_key is not null;

alter table private.creator_premium_subscription_periods
  add column idempotency_key uuid not null,
  add column request_fingerprint text not null,
  add column billing_period_days integer not null,
  add column gross_amount_bdag numeric(38,8) not null,
  add column platform_fee_bdag numeric(38,8) not null,
  add column creator_net_bdag numeric(38,8) not null,
  add column platform_fee_bps integer not null,
  add column subscriber_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column creator_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column platform_account_id uuid not null references public.ledger_accounts(id) on update restrict on delete restrict,
  add column refund_idempotency_key uuid,
  add column refund_request_fingerprint text,
  add column refund_reason_code text,
  add column refunded_at timestamptz,
  add constraint creator_premium_subscription_periods_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint creator_premium_subscription_periods_billing_days_check
    check (billing_period_days between 1 and 365),
  add constraint creator_premium_subscription_periods_split_check check (
    gross_amount_bdag > 0
    and creator_net_bdag > 0
    and platform_fee_bdag >= 0
    and platform_fee_bps between 0 and 9999
    and gross_amount_bdag = creator_net_bdag + platform_fee_bdag
    and gross_amount_bdag = round(gross_amount_bdag, 8)
    and creator_net_bdag = round(creator_net_bdag, 8)
    and platform_fee_bdag = round(platform_fee_bdag, 8)
  ),
  add constraint creator_premium_subscription_periods_accounts_distinct_check check (
    subscriber_account_id <> creator_account_id
    and subscriber_account_id <> platform_account_id
    and creator_account_id <> platform_account_id
  ),
  add constraint creator_premium_subscription_periods_refund_fields_check check (
    (access_state <> 'refunded'
      and refund_idempotency_key is null
      and refund_request_fingerprint is null
      and refund_reason_code is null
      and refunded_at is null)
    or
    (access_state = 'refunded'
      and refund_idempotency_key is not null
      and refund_request_fingerprint ~ '^[0-9a-f]{64}$'
      and refund_reason_code = pg_catalog.btrim(refund_reason_code)
      and pg_catalog.char_length(refund_reason_code) between 1 and 80
      and refunded_at is not null)
  );

alter table private.creator_premium_subscription_periods
  drop constraint creator_premium_subscription_periods_state_name_check,
  drop constraint creator_premium_subscription_periods_state_check,
  add constraint creator_premium_subscription_periods_state_name_check
    check (access_state in ('active','expired','revoked','refunded')),
  add constraint creator_premium_subscription_periods_state_check check (
    (access_state in ('active','expired')
      and revoked_at is null
      and reversal_financial_transaction_id is null)
    or
    (access_state = 'revoked'
      and revoked_at is not null
      and reversal_financial_transaction_id is null)
    or
    (access_state = 'refunded'
      and revoked_at is not null
      and reversal_financial_transaction_id is not null)
  );

alter table private.creator_premium_subscription_periods
  add constraint creator_premium_subscription_periods_idempotency_key
    unique (subscriber_id, idempotency_key);

create unique index creator_premium_subscription_periods_refund_idempotency_uidx
  on private.creator_premium_subscription_periods(subscriber_id, refund_idempotency_key)
  where refund_idempotency_key is not null;

alter table public.financial_transactions
  add constraint financial_transactions_creator_premium_integrity_check check (
    operation_type not like 'creator_premium_%'
    or (
      operation_type in (
        'creator_premium_purchase',
        'creator_premium_subscription',
        'creator_premium_purchase_refund',
        'creator_premium_subscription_refund'
      )
      and from_account_id is not null
      and to_account_id is not null
      and from_account_id <> to_account_id
      and currency = 'BDAG'
      and amount > 0
      and amount = round(amount, 8)
      and fee_amount >= 0
      and fee_amount < amount
      and fee_amount = round(fee_amount, 8)
      and idempotency_key is not null
      and idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and reference_id is not null
      and reference_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and initiated_by is not null
      and (
        operation_type in ('creator_premium_purchase','creator_premium_purchase_refund')
        and reference_type = 'creator_premium_purchase_receipt'
        or
        operation_type in ('creator_premium_subscription','creator_premium_subscription_refund')
        and reference_type = 'creator_premium_subscription_period'
      )
    )
  );

create unique index financial_transactions_creator_premium_reference_uidx
  on public.financial_transactions(operation_type, reference_type, reference_id)
  where operation_type like 'creator_premium_%';

create unique index financial_transactions_creator_premium_idempotency_uidx
  on public.financial_transactions(operation_type, idempotency_key)
  where operation_type like 'creator_premium_%';

create function private.guard_creator_premium_offer_financial_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active','retired') and (
    new.content_id is distinct from old.content_id
    or new.creator_id is distinct from old.creator_id
    or new.version is distinct from old.version
    or new.price_bdag is distinct from old.price_bdag
    or new.currency is distinct from old.currency
    or new.activated_at is distinct from old.activated_at
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_offer_financial_identity_immutable';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'draft' and new.status = 'active')
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_offer_lifecycle_invalid';
  end if;
  return new;
end;
$$;

create trigger creator_premium_offer_financial_identity_guard
before update on private.creator_premium_offer_versions
for each row execute function private.guard_creator_premium_offer_financial_identity_v1();

create function private.guard_creator_premium_plan_financial_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active','retired') and (
    new.creator_id is distinct from old.creator_id
    or new.plan_key is distinct from old.plan_key
    or new.version is distinct from old.version
    or new.price_bdag is distinct from old.price_bdag
    or new.currency is distinct from old.currency
    or new.billing_period_days is distinct from old.billing_period_days
    or new.activated_at is distinct from old.activated_at
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_plan_financial_identity_immutable';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'draft' and new.status = 'active')
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_plan_lifecycle_invalid';
  end if;
  return new;
end;
$$;

create trigger creator_premium_plan_financial_identity_guard
before update on private.creator_premium_plans
for each row execute function private.guard_creator_premium_plan_financial_identity_v1();

create function private.guard_creator_premium_plan_content_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan private.creator_premium_plans;
  v_content private.creator_premium_contents;
  v_plan_id uuid := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  v_content_id uuid := case when tg_op = 'DELETE' then old.content_id else new.content_id end;
  v_creator_id uuid := case when tg_op = 'DELETE' then old.creator_id else new.creator_id end;
begin
  if tg_op = 'UPDATE' and (old.plan_id, old.content_id, old.creator_id)
      is distinct from (new.plan_id, new.content_id, new.creator_id) then
    select plan.* into v_plan from private.creator_premium_plans plan where plan.id = old.plan_id;
    if not found or v_plan.status <> 'draft' then
      raise exception using errcode = '23514', message = 'creator_premium_plan_contents_immutable';
    end if;
  end if;

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = v_plan_id
    and plan.creator_id = v_creator_id;
  if not found then
    raise exception using errcode = '23503', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'draft' then
    raise exception using errcode = '23514', message = 'creator_premium_plan_contents_immutable';
  end if;

  if tg_op <> 'DELETE' then
    select content.* into v_content
    from private.creator_premium_contents content
    where content.id = v_content_id
      and content.creator_id = v_creator_id;
    if not found then
      raise exception using errcode = '23503', message = 'creator_premium_plan_content_not_found';
    end if;
    if v_content.access_mode not in ('subscription','purchase_or_subscription') then
      raise exception using errcode = '23514', message = 'creator_premium_plan_content_subscription_required';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger creator_premium_plan_content_guard
before insert or update or delete on private.creator_premium_plan_contents
for each row execute function private.guard_creator_premium_plan_content_v1();

create function private.guard_creator_premium_purchase_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.buyer_id, new.creator_id, new.content_id, new.offer_version_id,
      new.financial_transaction_id, new.idempotency_key, new.request_fingerprint,
      new.gross_amount_bdag, new.platform_fee_bdag, new.creator_net_bdag,
      new.platform_fee_bps, new.buyer_account_id, new.creator_account_id,
      new.platform_account_id, new.purchased_at, new.activated_at, new.access_expires_at)
     is distinct from
     (old.buyer_id, old.creator_id, old.content_id, old.offer_version_id,
      old.financial_transaction_id, old.idempotency_key, old.request_fingerprint,
      old.gross_amount_bdag, old.platform_fee_bdag, old.creator_net_bdag,
      old.platform_fee_bps, old.buyer_account_id, old.creator_account_id,
      old.platform_account_id, old.purchased_at, old.activated_at, old.access_expires_at) then
    raise exception using errcode = '23514', message = 'creator_premium_purchase_snapshot_immutable';
  end if;
  return new;
end;
$$;

create trigger creator_premium_purchase_snapshot_guard
before update on private.creator_premium_purchase_receipts
for each row execute function private.guard_creator_premium_purchase_snapshot_v1();

create function private.guard_creator_premium_period_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.subscription_id, new.subscriber_id, new.creator_id, new.plan_id,
      new.starts_at, new.paid_through_at, new.financial_transaction_id,
      new.idempotency_key, new.request_fingerprint, new.billing_period_days,
      new.gross_amount_bdag, new.platform_fee_bdag, new.creator_net_bdag,
      new.platform_fee_bps, new.subscriber_account_id, new.creator_account_id,
      new.platform_account_id)
     is distinct from
     (old.subscription_id, old.subscriber_id, old.creator_id, old.plan_id,
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

create trigger creator_premium_period_snapshot_guard
before update on private.creator_premium_subscription_periods
for each row execute function private.guard_creator_premium_period_snapshot_v1();

create function private.creator_premium_actor_is_age_eligible_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.user_age_eligibility eligibility
    join private.age_eligibility_policy policy on policy.singleton = true
    where eligibility.user_id = p_user_id
      and eligibility.status = 'eligible'
      and eligibility.age_band = 'age_18_plus'
      and eligibility.minimum_age = policy.minimum_age
      and eligibility.policy_version = policy.policy_version
      and eligibility.evaluated_at is not null
  ), false);
$$;

create or replace function private.current_user_is_creator_exclusive_age_eligible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.user_age_eligibility eligibility
    join private.age_eligibility_policy policy on policy.singleton = true
    where eligibility.user_id = auth.uid()
      and eligibility.status = 'eligible'
      and eligibility.age_band = 'age_18_plus'
      and eligibility.minimum_age = policy.minimum_age
      and eligibility.policy_version = policy.policy_version
      and eligibility.evaluated_at is not null
  ), false);
$$;

create function private.resolve_creator_premium_platform_account_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_count integer;
  v_frozen boolean;
begin
  select (pg_catalog.array_agg(account.id order by account.id))[1],
         pg_catalog.count(*),
         pg_catalog.bool_or(account.frozen)
    into v_account_id, v_count, v_frozen
  from public.ledger_accounts account
  where account.account_type = 'platform'
    and account.owner_id is null
    and account.currency = 'BDAG';

  if v_count <> 1 then
    raise exception using errcode = '55000', message = 'creator_premium_platform_account_ambiguous';
  end if;
  if v_frozen then
    raise exception using errcode = '55000', message = 'creator_premium_platform_account_frozen';
  end if;
  return v_account_id;
end;
$$;

create function private.calculate_creator_premium_split_v1(
  p_gross numeric,
  p_platform_fee_bps integer
) returns table (
  gross_amount_bdag numeric,
  platform_fee_bdag numeric,
  creator_net_bdag numeric
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_gross is null or p_gross <= 0 or p_gross <> pg_catalog.round(p_gross, 8) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_gross';
  end if;
  if p_platform_fee_bps is null or p_platform_fee_bps not between 0 and 9999 then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_platform_fee_bps';
  end if;
  gross_amount_bdag := p_gross;
  platform_fee_bdag := pg_catalog.round(p_gross * p_platform_fee_bps / 10000, 8);
  creator_net_bdag := p_gross - platform_fee_bdag;
  if creator_net_bdag <= 0 then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_creator_net';
  end if;
  return next;
end;
$$;

create function private.post_creator_premium_charge_v1(
  p_payer_id uuid,
  p_creator_id uuid,
  p_operation_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key uuid,
  p_gross numeric,
  p_platform_fee_bps integer
) returns table (
  financial_transaction_id uuid,
  payer_account_id uuid,
  creator_account_id uuid,
  platform_account_id uuid,
  gross_amount_bdag numeric,
  platform_fee_bdag numeric,
  creator_net_bdag numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_split record;
  v_account record;
begin
  if p_payer_id is null or p_creator_id is null or p_payer_id = p_creator_id
     or p_reference_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_financial_input_invalid';
  end if;
  if (p_operation_type, p_reference_type) not in (
    ('creator_premium_purchase','creator_premium_purchase_receipt'),
    ('creator_premium_subscription','creator_premium_subscription_period')
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_charge_operation_invalid';
  end if;

  select split.* into v_split
  from private.calculate_creator_premium_split_v1(p_gross, p_platform_fee_bps) split;

  payer_account_id := public.ensure_ledger_account(p_payer_id);
  creator_account_id := public.ensure_ledger_account(p_creator_id);
  platform_account_id := private.resolve_creator_premium_platform_account_v1();

  perform 1
  from public.ledger_accounts account
  where account.id = any(array[payer_account_id, creator_account_id, platform_account_id])
  order by account.id
  for update;

  select account.* into v_account from public.ledger_accounts account where account.id = payer_account_id;
  if not found or v_account.owner_id is distinct from p_payer_id
     or v_account.account_type <> 'user' or v_account.currency <> 'BDAG' or v_account.frozen then
    raise exception using errcode = '55000', message = 'creator_premium_payer_account_invalid';
  end if;
  select account.* into v_account from public.ledger_accounts account where account.id = creator_account_id;
  if not found or v_account.owner_id is distinct from p_creator_id
     or v_account.account_type <> 'user' or v_account.currency <> 'BDAG' or v_account.frozen then
    raise exception using errcode = '55000', message = 'creator_premium_creator_account_invalid';
  end if;
  select account.* into v_account from public.ledger_accounts account where account.id = platform_account_id;
  if not found or v_account.owner_id is not null
     or v_account.account_type <> 'platform' or v_account.currency <> 'BDAG' or v_account.frozen then
    raise exception using errcode = '55000', message = 'creator_premium_platform_account_invalid';
  end if;

  financial_transaction_id := gen_random_uuid();
  gross_amount_bdag := v_split.gross_amount_bdag;
  platform_fee_bdag := v_split.platform_fee_bdag;
  creator_net_bdag := v_split.creator_net_bdag;

  insert into public.financial_transactions(
    id, from_account_id, to_account_id, operation_type, amount, fee_amount,
    currency, status, reference_type, reference_id, idempotency_key, initiated_by
  ) values (
    financial_transaction_id, payer_account_id, creator_account_id,
    p_operation_type, gross_amount_bdag, platform_fee_bdag,
    'BDAG', 'completed', p_reference_type, p_reference_id::text,
    p_idempotency_key::text, p_payer_id
  );

  perform public.ledger_debit(
    financial_transaction_id, payer_account_id, gross_amount_bdag,
    'Creator Premium charge payer',
    pg_catalog.jsonb_build_object(
      'fin_txn_id', financial_transaction_id,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'financial_leg', 'payer_gross_debit'
    )
  );
  perform public.ledger_credit(
    financial_transaction_id, creator_account_id, creator_net_bdag,
    'Creator Premium charge creator',
    pg_catalog.jsonb_build_object(
      'fin_txn_id', financial_transaction_id,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'financial_leg', 'creator_net_credit'
    )
  );
  if platform_fee_bdag > 0 then
    perform public.ledger_credit(
      financial_transaction_id, platform_account_id, platform_fee_bdag,
      'Creator Premium charge platform fee',
      pg_catalog.jsonb_build_object(
        'fin_txn_id', financial_transaction_id,
        'reference_type', p_reference_type,
        'reference_id', p_reference_id,
        'financial_leg', 'platform_fee_credit'
      )
    );
  end if;
  return next;
end;
$$;

create function private.creator_premium_purchase_binding_is_valid_v1(p_receipt_id uuid)
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
    where receipt.id = p_receipt_id
      and receipt.access_state = 'active'
      and receipt.revoked_at is null
      and receipt.reversal_financial_transaction_id is null
      and receipt.gross_amount_bdag = receipt.creator_net_bdag + receipt.platform_fee_bdag
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

create function private.creator_premium_period_binding_is_valid_v1(p_period_id uuid)
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
    where period.id = p_period_id
      and period.access_state = 'active'
      and period.revoked_at is null
      and period.reversal_financial_transaction_id is null
      and period.gross_amount_bdag = period.creator_net_bdag + period.platform_fee_bdag
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

create or replace function private.resolve_creator_premium_entitlement_v1(p_content_id uuid)
returns table (
  allowed boolean,
  source text,
  reason text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_expires_at timestamptz;
begin
  if v_actor is null then
    return query select false, 'none'::text, 'auth_required'::text, null::timestamptz;
    return;
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    return query select false, 'none'::text, 'age_eligibility_required'::text, null::timestamptz;
    return;
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    return query select false, 'none'::text, 'actor_account_restricted'::text, null::timestamptz;
    return;
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id;
  if not found then
    return query select false, 'none'::text, 'content_not_found'::text, null::timestamptz;
    return;
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    return query select false, 'none'::text, 'creator_account_restricted'::text, null::timestamptz;
    return;
  end if;
  if v_content.lifecycle_status in ('quarantined','removed','deleted') then
    return query select false, 'none'::text, 'content_unavailable'::text, null::timestamptz;
    return;
  end if;
  if v_actor = v_content.creator_id then
    return query select true, 'owner'::text, 'owner'::text, null::timestamptz;
    return;
  end if;
  if v_content.lifecycle_status <> 'published' then
    return query select false, 'none'::text, 'content_not_published'::text, null::timestamptz;
    return;
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor, v_content.creator_id) then
    return query select false, 'none'::text, 'blocked_relationship'::text, null::timestamptz;
    return;
  end if;

  if v_content.access_mode in ('purchase','purchase_or_subscription') then
    select receipt.access_expires_at into v_expires_at
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id = v_actor
      and receipt.content_id = v_content.id
      and receipt.access_state = 'active'
      and receipt.revoked_at is null
      and receipt.reversal_financial_transaction_id is null
      and (receipt.access_expires_at is null
        or receipt.access_expires_at > pg_catalog.clock_timestamp())
      and private.creator_premium_purchase_binding_is_valid_v1(receipt.id)
    order by receipt.activated_at desc, receipt.id desc
    limit 1;
    if found then
      return query select true, 'purchase'::text, 'active_purchase'::text, v_expires_at;
      return;
    end if;
  end if;

  if v_content.access_mode in ('subscription','purchase_or_subscription') then
    select period.paid_through_at into v_expires_at
    from private.creator_premium_subscriptions subscription
    join private.creator_premium_subscription_periods period
      on period.subscription_id = subscription.id
     and period.subscriber_id = subscription.subscriber_id
     and period.creator_id = subscription.creator_id
     and period.plan_id = subscription.plan_id
    join private.creator_premium_plan_contents grant_map
      on grant_map.plan_id = subscription.plan_id
     and grant_map.creator_id = subscription.creator_id
     and grant_map.content_id = v_content.id
    where subscription.subscriber_id = v_actor
      and subscription.creator_id = v_content.creator_id
      and subscription.status in ('active','cancelled')
      and period.access_state = 'active'
      and period.revoked_at is null
      and period.reversal_financial_transaction_id is null
      and period.starts_at <= pg_catalog.clock_timestamp()
      and period.paid_through_at > pg_catalog.clock_timestamp()
      and private.creator_premium_period_binding_is_valid_v1(period.id)
    order by period.paid_through_at desc, period.id desc
    limit 1;
    if found then
      return query select true, 'subscription'::text, 'active_subscription_period'::text, v_expires_at;
      return;
    end if;
  end if;

  return query select false, 'none'::text, 'not_entitled'::text, null::timestamptz;
end;
$$;

revoke all on function private.guard_creator_premium_offer_financial_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_creator_premium_plan_financial_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_creator_premium_plan_content_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_creator_premium_purchase_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_creator_premium_period_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_actor_is_age_eligible_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_creator_premium_platform_account_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.calculate_creator_premium_split_v1(numeric,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.post_creator_premium_charge_v1(uuid,uuid,text,text,uuid,uuid,numeric,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_purchase_binding_is_valid_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_period_binding_is_valid_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_is_creator_exclusive_age_eligible()
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_creator_premium_entitlement_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.creator_premium_internal_finance_authority_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    session_user in ('postgres','supabase_admin')
    or auth.role() = 'service_role'
    or pg_catalog.current_setting('request.jwt.claim.role', true) = 'service_role',
    false
  );
$$;

create function private.creator_premium_request_fingerprint_v1(
  p_operation text,
  p_actor_id uuid,
  p_reference_id uuid,
  p_detail text default ''
) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws('|', p_operation, p_actor_id::text, p_reference_id::text, coalesce(p_detail,'')),
      'sha256'
    ),
    'hex'
  );
$$;

create function private.validate_creator_premium_refund_reason_v1(p_reason_code text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason_code,''));
begin
  if v_reason !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception using errcode = '22023', message = 'creator_premium_refund_reason_invalid';
  end if;
  return v_reason;
end;
$$;

create function private.post_creator_premium_refund_v1(
  p_payer_id uuid,
  p_creator_id uuid,
  p_payer_account_id uuid,
  p_creator_account_id uuid,
  p_platform_account_id uuid,
  p_operation_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key uuid,
  p_gross_amount_bdag numeric,
  p_platform_fee_bdag numeric,
  p_creator_net_bdag numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund_transaction_id uuid := gen_random_uuid();
  v_account public.ledger_accounts;
begin
  if (p_operation_type, p_reference_type) not in (
    ('creator_premium_purchase_refund','creator_premium_purchase_receipt'),
    ('creator_premium_subscription_refund','creator_premium_subscription_period')
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_refund_operation_invalid';
  end if;
  if p_gross_amount_bdag <= 0 or p_creator_net_bdag <= 0 or p_platform_fee_bdag < 0
     or p_gross_amount_bdag <> p_creator_net_bdag + p_platform_fee_bdag then
    raise exception using errcode = '22023', message = 'creator_premium_refund_split_invalid';
  end if;

  perform 1
  from public.ledger_accounts account
  where account.id = any(array[p_payer_account_id, p_creator_account_id, p_platform_account_id])
  order by account.id
  for update;

  select account.* into v_account from public.ledger_accounts account where account.id = p_creator_account_id;
  if not found or v_account.owner_id is distinct from p_creator_id
     or v_account.account_type <> 'user' or v_account.currency <> 'BDAG'
     or v_account.frozen or v_account.balance < p_creator_net_bdag then
    raise exception using errcode = 'P0001', message = 'creator_premium_refund_source_balance_insufficient';
  end if;
  select account.* into v_account from public.ledger_accounts account where account.id = p_platform_account_id;
  if not found or v_account.owner_id is not null
     or v_account.account_type <> 'platform' or v_account.currency <> 'BDAG'
     or v_account.frozen or v_account.balance < p_platform_fee_bdag then
    raise exception using errcode = 'P0001', message = 'creator_premium_refund_source_balance_insufficient';
  end if;
  select account.* into v_account from public.ledger_accounts account where account.id = p_payer_account_id;
  if not found or v_account.owner_id is distinct from p_payer_id
     or v_account.account_type <> 'user' or v_account.currency <> 'BDAG' or v_account.frozen then
    raise exception using errcode = '55000', message = 'creator_premium_refund_destination_account_invalid';
  end if;

  insert into public.financial_transactions(
    id, from_account_id, to_account_id, operation_type, amount, fee_amount,
    currency, status, reference_type, reference_id, idempotency_key, initiated_by
  ) values (
    v_refund_transaction_id, p_creator_account_id, p_payer_account_id,
    p_operation_type, p_gross_amount_bdag, p_platform_fee_bdag,
    'BDAG', 'completed', p_reference_type, p_reference_id::text,
    p_idempotency_key::text, p_payer_id
  );

  perform public.ledger_debit(
    v_refund_transaction_id, p_creator_account_id, p_creator_net_bdag,
    'Creator Premium refund creator',
    pg_catalog.jsonb_build_object(
      'fin_txn_id', v_refund_transaction_id,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'financial_leg', 'creator_net_debit'
    )
  );
  if p_platform_fee_bdag > 0 then
    perform public.ledger_debit(
      v_refund_transaction_id, p_platform_account_id, p_platform_fee_bdag,
      'Creator Premium refund platform fee',
      pg_catalog.jsonb_build_object(
        'fin_txn_id', v_refund_transaction_id,
        'reference_type', p_reference_type,
        'reference_id', p_reference_id,
        'financial_leg', 'platform_fee_debit'
      )
    );
  end if;
  perform public.ledger_credit(
    v_refund_transaction_id, p_payer_account_id, p_gross_amount_bdag,
    'Creator Premium refund payer',
    pg_catalog.jsonb_build_object(
      'fin_txn_id', v_refund_transaction_id,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'financial_leg', 'payer_gross_credit'
    )
  );
  return v_refund_transaction_id;
end;
$$;

create function public.purchase_creator_premium_content_v1(
  p_buyer_id uuid,
  p_content_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_policy private.creator_premium_finance_policy;
  v_content private.creator_premium_contents;
  v_offer private.creator_premium_offer_versions;
  v_existing private.creator_premium_purchase_receipts;
  v_receipt_id uuid := gen_random_uuid();
  v_charge record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode = '42501', message = 'creator_premium_internal_authority_required';
  end if;
  if p_buyer_id is null or p_content_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_purchase_invalid_input';
  end if;

  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_purchase', p_buyer_id, p_content_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-purchase|' || p_buyer_id::text || '|' || p_idempotency_key::text, 0)
  );

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id = p_buyer_id
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_purchase_idempotency_conflict';
    end if;
    if v_existing.access_state = 'active'
       and not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode = '23514', message = 'creator_premium_purchase_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id', v_existing.id,
      'content_id', v_existing.content_id,
      'financial_transaction_id', v_existing.financial_transaction_id,
      'gross_amount_bdag', v_existing.gross_amount_bdag,
      'platform_fee_bdag', v_existing.platform_fee_bdag,
      'creator_net_bdag', v_existing.creator_net_bdag,
      'access_state', v_existing.access_state,
      'already_owned', v_existing.access_state = 'active',
      'money_moved', false,
      'replayed', true
    );
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton = true
  for share;
  if not found or not v_policy.purchase_enabled then
    raise exception using errcode = '55000', message = 'creator_premium_purchase_disabled';
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(p_buyer_id) then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_buyer_id) then
    raise exception using errcode = '42501', message = 'creator_premium_buyer_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'published' then
    raise exception using errcode = '55000', message = 'creator_premium_content_not_published';
  end if;
  if v_content.access_mode not in ('purchase','purchase_or_subscription') then
    raise exception using errcode = '55000', message = 'creator_premium_purchase_access_mode_invalid';
  end if;
  if p_buyer_id = v_content.creator_id then
    raise exception using errcode = '42501', message = 'creator_premium_self_purchase_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_buyer_id, v_content.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;

  select offer.* into v_offer
  from private.creator_premium_offer_versions offer
  where offer.content_id = v_content.id
    and offer.creator_id = v_content.creator_id
    and offer.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_active_offer_not_found';
  end if;
  if v_offer.currency <> 'BDAG' then
    raise exception using errcode = '23514', message = 'creator_premium_offer_currency_invalid';
  end if;

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id = p_buyer_id
    and receipt.content_id = p_content_id
    and receipt.access_state = 'active'
  for update;
  if found then
    if not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode = '23514', message = 'creator_premium_purchase_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id', v_existing.id,
      'content_id', v_existing.content_id,
      'financial_transaction_id', v_existing.financial_transaction_id,
      'gross_amount_bdag', v_existing.gross_amount_bdag,
      'platform_fee_bdag', v_existing.platform_fee_bdag,
      'creator_net_bdag', v_existing.creator_net_bdag,
      'access_state', v_existing.access_state,
      'already_owned', true,
      'money_moved', false,
      'replayed', false
    );
  end if;

  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_buyer_id, v_content.creator_id,
    'creator_premium_purchase', 'creator_premium_purchase_receipt',
    v_receipt_id, p_idempotency_key, v_offer.price_bdag, v_policy.platform_fee_bps
  ) charge;

  insert into private.creator_premium_purchase_receipts(
    id, buyer_id, creator_id, content_id, offer_version_id,
    financial_transaction_id, idempotency_key, request_fingerprint,
    gross_amount_bdag, platform_fee_bdag, creator_net_bdag, platform_fee_bps,
    buyer_account_id, creator_account_id, platform_account_id,
    access_state, purchased_at, activated_at
  ) values (
    v_receipt_id, p_buyer_id, v_content.creator_id, v_content.id, v_offer.id,
    v_charge.financial_transaction_id, p_idempotency_key, v_fingerprint,
    v_charge.gross_amount_bdag, v_charge.platform_fee_bdag,
    v_charge.creator_net_bdag, v_policy.platform_fee_bps,
    v_charge.payer_account_id, v_charge.creator_account_id, v_charge.platform_account_id,
    'active', v_now, v_now
  );

  return pg_catalog.jsonb_build_object(
    'receipt_id', v_receipt_id,
    'content_id', v_content.id,
    'financial_transaction_id', v_charge.financial_transaction_id,
    'gross_amount_bdag', v_charge.gross_amount_bdag,
    'platform_fee_bdag', v_charge.platform_fee_bdag,
    'creator_net_bdag', v_charge.creator_net_bdag,
    'access_state', 'active',
    'already_owned', false,
    'money_moved', true,
    'replayed', false
  );
end;
$$;

create function public.subscribe_creator_premium_plan_v1(
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
  v_policy private.creator_premium_finance_policy;
  v_plan private.creator_premium_plans;
  v_existing private.creator_premium_subscriptions;
  v_existing_period private.creator_premium_subscription_periods;
  v_subscription_id uuid := gen_random_uuid();
  v_period_id uuid := gen_random_uuid();
  v_charge record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_paid_through timestamptz;
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode = '42501', message = 'creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_plan_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_subscription_invalid_input';
  end if;
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription', p_subscriber_id, p_plan_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-subscription|' || p_subscriber_id::text || '|' || p_idempotency_key::text, 0)
  );

  select subscription.* into v_existing
  from private.creator_premium_subscriptions subscription
  where subscription.subscriber_id = p_subscriber_id
    and subscription.idempotency_key = p_idempotency_key
  for update;
  if found then
    select period.* into v_existing_period
    from private.creator_premium_subscription_periods period
    where period.subscription_id = v_existing.id
    order by period.starts_at desc, period.id desc
    limit 1
    for update;
    if not found or v_existing_period.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_subscription_idempotency_conflict';
    end if;
    if v_existing_period.access_state = 'active'
       and not private.creator_premium_period_binding_is_valid_v1(v_existing_period.id) then
      raise exception using errcode = '23514', message = 'creator_premium_subscription_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'subscription_id', v_existing.id,
      'period_id', v_existing_period.id,
      'financial_transaction_id', v_existing_period.financial_transaction_id,
      'gross_amount_bdag', v_existing_period.gross_amount_bdag,
      'platform_fee_bdag', v_existing_period.platform_fee_bdag,
      'creator_net_bdag', v_existing_period.creator_net_bdag,
      'billing_period_days', v_existing_period.billing_period_days,
      'starts_at', v_existing_period.starts_at,
      'paid_through_at', v_existing_period.paid_through_at,
      'status', v_existing.status,
      'already_subscribed', v_existing.status in ('active','cancelled'),
      'money_moved', false,
      'replayed', true
    );
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton = true
  for share;
  if not found or not v_policy.subscription_enabled then
    raise exception using errcode = '55000', message = 'creator_premium_subscription_disabled';
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(p_subscriber_id) then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_subscriber_id) then
    raise exception using errcode = '42501', message = 'creator_premium_subscriber_account_restricted';
  end if;

  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
  for update;
  if not found or v_plan.status <> 'active' then
    raise exception using errcode = 'P0002', message = 'creator_premium_active_plan_not_found';
  end if;
  if v_plan.currency <> 'BDAG' or v_plan.billing_period_days not between 1 and 365 then
    raise exception using errcode = '23514', message = 'creator_premium_plan_financial_identity_invalid';
  end if;
  if p_subscriber_id = v_plan.creator_id then
    raise exception using errcode = '42501', message = 'creator_premium_self_subscription_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_plan.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_subscriber_id, v_plan.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;
  if not exists (
    select 1
    from private.creator_premium_plan_contents grant_map
    join private.creator_premium_contents content
      on content.id = grant_map.content_id
     and content.creator_id = grant_map.creator_id
    where grant_map.plan_id = v_plan.id
      and grant_map.creator_id = v_plan.creator_id
      and content.lifecycle_status = 'published'
      and content.access_mode in ('subscription','purchase_or_subscription')
  ) then
    raise exception using errcode = '23514', message = 'creator_premium_plan_has_no_valid_content';
  end if;

  select subscription.* into v_existing
  from private.creator_premium_subscriptions subscription
  where subscription.subscriber_id = p_subscriber_id
    and subscription.plan_id = p_plan_id
  for update;
  if found then
    if v_existing.status in ('expired','revoked') then
      raise exception using errcode = '0A000', message = 'creator_premium_subscription_renewal_not_implemented';
    end if;
    if v_existing.status not in ('active','cancelled') then
      raise exception using errcode = '23514', message = 'creator_premium_subscription_state_invalid';
    end if;
    select period.* into v_existing_period
    from private.creator_premium_subscription_periods period
    where period.subscription_id = v_existing.id
    order by period.starts_at desc, period.id desc
    limit 1
    for update;
    if not found or not private.creator_premium_period_binding_is_valid_v1(v_existing_period.id) then
      raise exception using errcode = '23514', message = 'creator_premium_subscription_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'subscription_id', v_existing.id,
      'period_id', v_existing_period.id,
      'financial_transaction_id', v_existing_period.financial_transaction_id,
      'gross_amount_bdag', v_existing_period.gross_amount_bdag,
      'platform_fee_bdag', v_existing_period.platform_fee_bdag,
      'creator_net_bdag', v_existing_period.creator_net_bdag,
      'billing_period_days', v_existing_period.billing_period_days,
      'starts_at', v_existing_period.starts_at,
      'paid_through_at', v_existing_period.paid_through_at,
      'status', v_existing.status,
      'already_subscribed', true,
      'money_moved', false,
      'replayed', false
    );
  end if;

  v_paid_through := v_now + pg_catalog.make_interval(days => v_plan.billing_period_days);
  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_subscriber_id, v_plan.creator_id,
    'creator_premium_subscription', 'creator_premium_subscription_period',
    v_period_id, p_idempotency_key, v_plan.price_bdag, v_policy.platform_fee_bps
  ) charge;

  insert into private.creator_premium_subscriptions(
    id, subscriber_id, creator_id, plan_id, idempotency_key,
    status, started_at
  ) values (
    v_subscription_id, p_subscriber_id, v_plan.creator_id, v_plan.id,
    p_idempotency_key, 'active', v_now
  );
  insert into private.creator_premium_subscription_periods(
    id, subscription_id, subscriber_id, creator_id, plan_id,
    starts_at, paid_through_at, financial_transaction_id,
    idempotency_key, request_fingerprint, billing_period_days,
    gross_amount_bdag, platform_fee_bdag, creator_net_bdag, platform_fee_bps,
    subscriber_account_id, creator_account_id, platform_account_id,
    access_state
  ) values (
    v_period_id, v_subscription_id, p_subscriber_id, v_plan.creator_id, v_plan.id,
    v_now, v_paid_through, v_charge.financial_transaction_id,
    p_idempotency_key, v_fingerprint, v_plan.billing_period_days,
    v_charge.gross_amount_bdag, v_charge.platform_fee_bdag,
    v_charge.creator_net_bdag, v_policy.platform_fee_bps,
    v_charge.payer_account_id, v_charge.creator_account_id, v_charge.platform_account_id,
    'active'
  );

  return pg_catalog.jsonb_build_object(
    'subscription_id', v_subscription_id,
    'period_id', v_period_id,
    'financial_transaction_id', v_charge.financial_transaction_id,
    'gross_amount_bdag', v_charge.gross_amount_bdag,
    'platform_fee_bdag', v_charge.platform_fee_bdag,
    'creator_net_bdag', v_charge.creator_net_bdag,
    'billing_period_days', v_plan.billing_period_days,
    'starts_at', v_now,
    'paid_through_at', v_paid_through,
    'status', 'active',
    'already_subscribed', false,
    'money_moved', true,
    'replayed', false
  );
end;
$$;

create function public.cancel_creator_premium_subscription_v1(
  p_subscriber_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription private.creator_premium_subscriptions;
  v_fingerprint text;
  v_paid_through timestamptz;
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode = '42501', message = 'creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_subscription_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_cancellation_invalid_input';
  end if;
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_cancel_subscription', p_subscriber_id, p_subscription_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-cancel|' || p_subscriber_id::text || '|' || p_idempotency_key::text, 0)
  );
  select subscription.* into v_subscription
  from private.creator_premium_subscriptions subscription
  where subscription.id = p_subscription_id
    and subscription.subscriber_id = p_subscriber_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_subscription_not_found';
  end if;
  select pg_catalog.max(period.paid_through_at) into v_paid_through
  from private.creator_premium_subscription_periods period
  where period.subscription_id = v_subscription.id
    and period.access_state = 'active';

  if v_subscription.status = 'cancelled' then
    if v_subscription.cancel_idempotency_key = p_idempotency_key
       and v_subscription.cancel_request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_cancellation_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'subscription_id', v_subscription.id,
      'status', 'cancelled',
      'paid_through_at', v_paid_through,
      'money_moved', false,
      'replayed', v_subscription.cancel_idempotency_key = p_idempotency_key,
      'already_cancelled', true
    );
  end if;
  if v_subscription.status <> 'active' then
    raise exception using errcode = '55000', message = 'creator_premium_subscription_not_cancellable';
  end if;

  update private.creator_premium_subscriptions
  set status = 'cancelled',
      cancelled_at = pg_catalog.clock_timestamp(),
      cancel_idempotency_key = p_idempotency_key,
      cancel_request_fingerprint = v_fingerprint,
      updated_at = pg_catalog.clock_timestamp()
  where id = v_subscription.id;

  return pg_catalog.jsonb_build_object(
    'subscription_id', v_subscription.id,
    'status', 'cancelled',
    'paid_through_at', v_paid_through,
    'money_moved', false,
    'replayed', false,
    'already_cancelled', false
  );
end;
$$;

create function public.refund_creator_premium_purchase_v1(
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
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton = true
  for share;
  if not found or not v_policy.refunds_enabled then
    raise exception using errcode = '55000', message = 'creator_premium_refunds_disabled';
  end if;
  if not private.creator_premium_purchase_binding_is_valid_v1(v_receipt.id) then
    raise exception using errcode = '23514', message = 'creator_premium_purchase_financial_binding_invalid';
  end if;
  select finance_tx.* into v_original
  from public.financial_transactions finance_tx
  where finance_tx.id = v_receipt.financial_transaction_id
  for update;

  v_refund_transaction_id := private.post_creator_premium_refund_v1(
    v_receipt.buyer_id, v_receipt.creator_id,
    v_receipt.buyer_account_id, v_receipt.creator_account_id, v_receipt.platform_account_id,
    'creator_premium_purchase_refund', 'creator_premium_purchase_receipt',
    v_receipt.id, p_idempotency_key,
    v_receipt.gross_amount_bdag, v_receipt.platform_fee_bdag, v_receipt.creator_net_bdag
  );
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

create function public.refund_creator_premium_subscription_period_v1(
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
    raise exception using errcode = '42501', message = 'creator_premium_internal_authority_required';
  end if;
  if p_period_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'creator_premium_subscription_refund_invalid_input';
  end if;
  v_reason := private.validate_creator_premium_refund_reason_v1(p_reason_code);
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription_refund', p_period_id, p_period_id, v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-subscription-refund|' || p_period_id::text || '|' || p_idempotency_key::text, 0)
  );
  select period.* into v_period
  from private.creator_premium_subscription_periods period
  where period.id = p_period_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_subscription_period_not_found';
  end if;
  if v_period.access_state = 'refunded' then
    if v_period.refund_idempotency_key = p_idempotency_key
       and v_period.refund_request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_subscription_refund_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'period_id', v_period.id,
      'subscription_id', v_period.subscription_id,
      'reversal_financial_transaction_id', v_period.reversal_financial_transaction_id,
      'access_state', 'refunded',
      'money_moved', false,
      'replayed', v_period.refund_idempotency_key = p_idempotency_key,
      'already_refunded', true
    );
  end if;
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton = true
  for share;
  if not found or not v_policy.refunds_enabled then
    raise exception using errcode = '55000', message = 'creator_premium_refunds_disabled';
  end if;
  if not private.creator_premium_period_binding_is_valid_v1(v_period.id) then
    raise exception using errcode = '23514', message = 'creator_premium_subscription_financial_binding_invalid';
  end if;
  select subscription.* into v_subscription
  from private.creator_premium_subscriptions subscription
  where subscription.id = v_period.subscription_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'creator_premium_subscription_relationship_invalid';
  end if;
  select finance_tx.* into v_original
  from public.financial_transactions finance_tx
  where finance_tx.id = v_period.financial_transaction_id
  for update;

  v_refund_transaction_id := private.post_creator_premium_refund_v1(
    v_period.subscriber_id, v_period.creator_id,
    v_period.subscriber_account_id, v_period.creator_account_id, v_period.platform_account_id,
    'creator_premium_subscription_refund', 'creator_premium_subscription_period',
    v_period.id, p_idempotency_key,
    v_period.gross_amount_bdag, v_period.platform_fee_bdag, v_period.creator_net_bdag
  );
  update public.financial_transactions
  set status = 'reversed'
  where id = v_original.id and status = 'completed';
  if not found then
    raise exception using errcode = '23514', message = 'creator_premium_subscription_financial_binding_invalid';
  end if;
  update private.creator_premium_subscription_periods
  set access_state = 'refunded',
      reversal_financial_transaction_id = v_refund_transaction_id,
      refund_idempotency_key = p_idempotency_key,
      refund_request_fingerprint = v_fingerprint,
      refund_reason_code = v_reason,
      refunded_at = v_now,
      revoked_at = v_now,
      updated_at = v_now
  where id = v_period.id;
  update private.creator_premium_subscriptions
  set status = 'revoked',
      ended_at = v_now,
      updated_at = v_now
  where id = v_subscription.id;

  return pg_catalog.jsonb_build_object(
    'period_id', v_period.id,
    'subscription_id', v_period.subscription_id,
    'reversal_financial_transaction_id', v_refund_transaction_id,
    'access_state', 'refunded',
    'subscription_status', 'revoked',
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

revoke all on function private.creator_premium_internal_finance_authority_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_request_fingerprint_v1(text,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_creator_premium_refund_reason_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.post_creator_premium_refund_v1(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,numeric,numeric,numeric)
  from public, anon, authenticated, service_role;

revoke all on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid)
  to service_role;
revoke all on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)
  to service_role;
revoke all on function public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid)
  to service_role;
revoke all on function public.refund_creator_premium_purchase_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_creator_premium_purchase_v1(uuid,uuid,text)
  to service_role;
revoke all on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  to service_role;
