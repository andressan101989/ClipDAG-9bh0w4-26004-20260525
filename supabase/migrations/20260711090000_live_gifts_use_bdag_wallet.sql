-- ============================================================================
-- supabase/migrations/20260711090000_live_gifts_use_bdag_wallet.sql
--
-- DÍA 2E.1 — HOTFIX: LIVE gifts must debit/credit the user's REAL BDAG
-- balance (ledger_accounts), not the separate app_wallets.balance_coins
-- introduced by 20260710150000_live_gift_economy.sql.
--
-- Root cause: app_wallets was a brand-new, always-zero table, disconnected
-- from the BDAG the user actually funded (ledger_accounts.balance, via
-- ensure_ledger_account / atomic_ledger_transfer — the same system used
-- everywhere else in the app: useWallet.tsx, useFinancialAccount.tsx,
-- services/financial/ledgerClient.ts, GiftSheet.tsx, bdag-ledger edge fn).
--
-- This migration:
--   1. Replaces send_live_gift() to route the actual BDAG movement through
--      atomic_ledger_transfer() (real ledger_accounts, real fee-to-platform,
--      real financial_transactions/ledger_entries row) instead of touching
--      app_wallets.
--   2. Keeps live_gift_transactions as the LIVE-specific record of "who
--      sent what gift in which session", now carrying a financial_transaction_id
--      pointer into the real ledger for reconciliation.
--   3. Keeps gift_catalog.cost_coins / live_gift_transactions.amount_coins /
--      creator_amount_coins column NAMES as-is (renaming them is a larger,
--      separate migration — not safe to bundle into a hotfix already applied
--      remotely) but documents via COMMENT ON COLUMN that they represent
--      whole BDAG units, not a second currency.
--   4. Marks app_wallets / app_wallet_ledger_entries OBSOLETE via COMMENT ON
--      TABLE. Not dropped — no code reads/writes them after this migration,
--      dropping is a separate, later cleanup migration.
--
-- SAFE TO RE-RUN: guarded with ADD COLUMN IF NOT EXISTS / DROP FUNCTION IF
-- EXISTS before CREATE.
-- ============================================================================

-- ── live_gift_transactions: add pointer into the real BDAG ledger ──────────
alter table public.live_gift_transactions
  add column if not exists financial_transaction_id uuid references public.financial_transactions(id);

comment on column public.gift_catalog.cost_coins is
  'Gift cost in whole BDAG units. Column kept as cost_coins for backward compatibility with the already-applied 20260710150000 migration; it is NOT a separate coin currency — send_live_gift() charges this value directly against the sender''s real ledger_accounts (BDAG) balance.';

comment on column public.live_gift_transactions.amount_coins is
  'Gift face value in BDAG (== gift_catalog.cost_coins at time of send), debited from the sender''s real ledger_accounts balance via atomic_ledger_transfer().';

comment on column public.live_gift_transactions.platform_fee_coins is
  'Platform fee in BDAG, mirrors the fee atomic_ledger_transfer() credits to the platform ledger_accounts row.';

comment on column public.live_gift_transactions.creator_amount_coins is
  'Net BDAG credited to the host''s real ledger_accounts balance (amount_coins - platform_fee_coins).';

comment on table public.app_wallets is
  'OBSOLETE as of DÍA 2E.1 (20260711090000): superseded by ledger_accounts, the app''s real BDAG balance. No code path reads or writes this table anymore. Left in place (not dropped) to avoid remote schema churn; safe to drop in a dedicated later cleanup migration.';

comment on table public.app_wallet_ledger_entries is
  'OBSOLETE as of DÍA 2E.1 (20260711090000): superseded by ledger_entries/financial_transactions, the app''s real BDAG ledger. No code path reads or writes this table anymore.';

-- ── send_live_gift() — now moves REAL BDAG via atomic_ledger_transfer() ────
-- Return type changes (new_sender_balance integer -> numeric, to match
-- ledger_accounts.balance's precision) so the function must be dropped and
-- recreated rather than CREATE OR REPLACE'd.
drop function if exists public.send_live_gift(uuid, text, text);

create function public.send_live_gift(
  p_session_id uuid,
  p_gift_id text,
  p_idempotency_key text
)
returns table (
  transaction_id        uuid,
  gift_id                text,
  emoji                   text,
  amount_coins            integer,
  creator_amount_coins    integer,
  new_sender_balance      numeric,
  receiver_user_id        uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sender          uuid;
  v_receiver        uuid;
  v_status          text;
  v_gift_id         text;
  v_gift_emoji      text;
  v_gift_cost       integer;
  v_fee             integer;
  v_creator_amount  integer;
  v_tx_id           uuid;
  v_fin_txn_id      uuid;
  v_sender_balance  numeric;
  v_transfer_result jsonb;
  v_existing_id             uuid;
  v_existing_gift_id        text;
  v_existing_emoji          text;
  v_existing_amount         integer;
  v_existing_creator_amount integer;
  v_existing_receiver       uuid;
begin
  v_sender := auth.uid();
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select ls.status, ls.host_id into v_status, v_receiver
  from public.live_sessions ls
  where ls.id = p_session_id;

  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if v_status <> 'live' then
    raise exception 'live session is not active' using errcode = 'P0001';
  end if;
  if v_receiver = v_sender then
    raise exception 'self-gift not allowed' using errcode = '22023';
  end if;

  select gc.id, gc.emoji, gc.cost_coins into v_gift_id, v_gift_emoji, v_gift_cost
  from public.gift_catalog gc
  where gc.id = p_gift_id and gc.active = true;

  if not found then
    raise exception 'gift not found or inactive' using errcode = 'P0002';
  end if;

  -- Idempotency at the LIVE-gift layer, checked before touching the ledger
  -- at all. atomic_ledger_transfer() below has its OWN idempotency guard
  -- (idempotency_keys, unique on idempotency_key+operation_type+user_id) as
  -- defense in depth against a true concurrent double-submit racing past
  -- this check.
  select lgt.id, lgt.gift_id, lgt.emoji, lgt.amount_coins, lgt.creator_amount_coins, lgt.receiver_user_id
    into v_existing_id, v_existing_gift_id, v_existing_emoji, v_existing_amount, v_existing_creator_amount, v_existing_receiver
  from public.live_gift_transactions lgt
  where lgt.sender_user_id = v_sender
    and lgt.session_id = p_session_id
    and lgt.idempotency_key = p_idempotency_key;

  if found then
    select la.balance into v_sender_balance
    from public.ledger_accounts la
    where la.owner_id = v_sender and la.account_type = 'user';

    return query select
      v_existing_id, v_existing_gift_id, v_existing_emoji,
      v_existing_amount, v_existing_creator_amount,
      coalesce(v_sender_balance, 0), v_existing_receiver;
    return;
  end if;

  -- 10% platform fee, same split already used for BDAG gifts elsewhere
  -- (components/feature/GiftSheet.tsx / bdag-ledger 'gift' action).
  v_fee := floor(v_gift_cost * 0.10);
  v_creator_amount := v_gift_cost - v_fee;

  -- Real BDAG movement: ensures both ledger_accounts rows exist, locks them
  -- in a fixed order, debits sender, credits receiver net-of-fee, credits
  -- the platform account the fee, and writes financial_transactions +
  -- ledger_entries. Raises 'insufficient balance or account frozen (...)' if
  -- the sender can't afford it — nothing is debited in that case.
  v_transfer_result := public.atomic_ledger_transfer(
    v_sender, v_receiver, v_gift_cost, v_fee,
    'live_gift', p_idempotency_key,
    'live_session', p_session_id,
    'Live gift: ' || v_gift_id
  );

  v_sender_balance := (v_transfer_result ->> 'from_balance')::numeric;
  v_fin_txn_id      := nullif(v_transfer_result ->> 'fin_txn_id', '')::uuid;

  insert into public.live_gift_transactions (
    session_id, sender_user_id, receiver_user_id, gift_id, emoji,
    amount_coins, platform_fee_coins, creator_amount_coins, idempotency_key,
    financial_transaction_id
  ) values (
    p_session_id, v_sender, v_receiver, v_gift_id, v_gift_emoji,
    v_gift_cost, v_fee, v_creator_amount, p_idempotency_key, v_fin_txn_id
  )
  returning id into v_tx_id;

  return query select
    v_tx_id, v_gift_id, v_gift_emoji, v_gift_cost, v_creator_amount, v_sender_balance, v_receiver;
end;
$$;

revoke all on function public.send_live_gift(uuid, text, text) from public;
grant execute on function public.send_live_gift(uuid, text, text) to authenticated;
