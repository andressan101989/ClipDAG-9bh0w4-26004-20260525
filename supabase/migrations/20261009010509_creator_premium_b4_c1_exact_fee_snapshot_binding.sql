-- CREATOR-PREMIUM-B4-C1: bind immutable fee snapshots to the policy bps
-- used by the canonical B4 PostgreSQL charge composer.

alter table private.creator_premium_purchase_receipts
  drop constraint creator_premium_purchase_receipts_split_check,
  add constraint creator_premium_purchase_receipts_split_check check (
    gross_amount_bdag > 0
    and creator_net_bdag > 0
    and platform_fee_bdag >= 0
    and platform_fee_bps between 0 and 9999
    and gross_amount_bdag = creator_net_bdag + platform_fee_bdag
    and platform_fee_bdag = pg_catalog.round(
      gross_amount_bdag * platform_fee_bps / 10000,
      8
    )
    and gross_amount_bdag = pg_catalog.round(gross_amount_bdag, 8)
    and creator_net_bdag = pg_catalog.round(creator_net_bdag, 8)
    and platform_fee_bdag = pg_catalog.round(platform_fee_bdag, 8)
  );

alter table private.creator_premium_subscription_periods
  drop constraint creator_premium_subscription_periods_split_check,
  add constraint creator_premium_subscription_periods_split_check check (
    gross_amount_bdag > 0
    and creator_net_bdag > 0
    and platform_fee_bdag >= 0
    and platform_fee_bps between 0 and 9999
    and gross_amount_bdag = creator_net_bdag + platform_fee_bdag
    and platform_fee_bdag = pg_catalog.round(
      gross_amount_bdag * platform_fee_bps / 10000,
      8
    )
    and gross_amount_bdag = pg_catalog.round(gross_amount_bdag, 8)
    and creator_net_bdag = pg_catalog.round(creator_net_bdag, 8)
    and platform_fee_bdag = pg_catalog.round(platform_fee_bdag, 8)
  );

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
    where receipt.id = p_receipt_id
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
    where period.id = p_period_id
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
