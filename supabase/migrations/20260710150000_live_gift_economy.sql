-- ============================================================================
-- supabase/migrations/20260710150000_live_gift_economy.sql
--
-- DÍA 2E — Real gifts/donations for LIVE.
--
-- This is a NEW, separate "coins" economy for in-app LIVE gifting. It does
-- NOT reuse ledger_accounts / atomic_ledger_transfer / gifts (the BDAG
-- crypto ledger used by GiftSheet.tsx for video gifts) — those tables move
-- real BDAG balances (per 20260704_live_db_audit_fixes.sql's FIX 1 comment)
-- and are explicitly out of scope for this task. app_wallets here is a
-- virtual "coins" balance, unrelated to BDAG/crypto.
--
-- SAFE TO RE-RUN: guarded with IF NOT EXISTS / OR REPLACE / ON CONFLICT DO
-- NOTHING / DROP POLICY IF EXISTS before CREATE POLICY.
-- ============================================================================

-- ── gift_catalog ─────────────────────────────────────────────────────────────
create table if not exists public.gift_catalog (
  id          text primary key,
  emoji       text not null,
  label       text not null,
  cost_coins  integer not null check (cost_coins > 0),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.gift_catalog (id, emoji, label, cost_coins, sort_order) values
  ('heart',   '❤️', 'Corazón',  1,   1),
  ('rose',    '🌹', 'Rosa',     5,   2),
  ('fire',    '🔥', 'Fuego',    10,  3),
  ('crown',   '👑', 'Corona',   50,  4),
  ('diamond', '💎', 'Diamante', 100, 5)
on conflict (id) do nothing;

alter table public.gift_catalog enable row level security;

drop policy if exists "gift_catalog_select_active" on public.gift_catalog;
create policy "gift_catalog_select_active" on public.gift_catalog
  for select to authenticated
  using (active = true);

-- ── app_wallets ──────────────────────────────────────────────────────────────
-- In-app "coins" balance. Independent of ledger_accounts (BDAG).
create table if not exists public.app_wallets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  balance_coins  integer not null default 0 check (balance_coins >= 0),
  earned_coins   integer not null default 0 check (earned_coins >= 0),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table public.app_wallets enable row level security;

drop policy if exists "app_wallets_select_own" on public.app_wallets;
create policy "app_wallets_select_own" on public.app_wallets
  for select to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies: balance can only move via
-- send_live_gift() (SECURITY DEFINER, bypasses RLS as the function owner).

-- ── app_wallet_ledger_entries ────────────────────────────────────────────────
create table if not exists public.app_wallet_ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  entry_type        text not null,
  amount_coins      integer not null,
  balance_after     integer,
  related_user_id   uuid,
  session_id        uuid,
  transaction_id    uuid,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists app_wallet_ledger_entries_user_created_idx
  on public.app_wallet_ledger_entries (user_id, created_at desc);

alter table public.app_wallet_ledger_entries enable row level security;

drop policy if exists "app_wallet_ledger_entries_select_own" on public.app_wallet_ledger_entries;
create policy "app_wallet_ledger_entries_select_own" on public.app_wallet_ledger_entries
  for select to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies: rows are only written by send_live_gift().

-- ── live_gift_transactions ───────────────────────────────────────────────────
create table if not exists public.live_gift_transactions (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references public.live_sessions(id) on delete cascade,
  sender_user_id         uuid not null references auth.users(id) on delete cascade,
  receiver_user_id       uuid not null references auth.users(id) on delete cascade,
  gift_id                text not null references public.gift_catalog(id),
  emoji                  text not null,
  amount_coins           integer not null check (amount_coins > 0),
  platform_fee_coins     integer not null default 0,
  creator_amount_coins   integer not null check (creator_amount_coins >= 0),
  idempotency_key        text not null,
  created_at             timestamptz not null default now(),
  unique (sender_user_id, session_id, idempotency_key)
);

create index if not exists live_gift_transactions_session_created_idx
  on public.live_gift_transactions (session_id, created_at);

alter table public.live_gift_transactions enable row level security;

drop policy if exists "live_gift_transactions_select_participant" on public.live_gift_transactions;
create policy "live_gift_transactions_select_participant" on public.live_gift_transactions
  for select to authenticated
  using (
    auth.uid() = sender_user_id
    or auth.uid() = receiver_user_id
    or exists (
      select 1 from public.live_sessions ls
      where ls.id = live_gift_transactions.session_id
        and ls.host_id = auth.uid()
    )
  );

-- No insert/update/delete policies: rows are only written by send_live_gift().

-- ── send_live_gift() — atomic, idempotent, server-side balance movement ─────
create or replace function public.send_live_gift(
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
  new_sender_balance      integer,
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
  v_sender_balance  integer;
  v_fee             integer;
  v_creator_amount  integer;
  v_tx_id           uuid;
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

  -- Ensure both wallets exist before anything else.
  insert into public.app_wallets (user_id) values (v_sender)
    on conflict (user_id) do nothing;
  insert into public.app_wallets (user_id) values (v_receiver)
    on conflict (user_id) do nothing;

  -- Idempotency: same sender + session + key already processed → return it
  -- as-is, without charging again.
  select lgt.id, lgt.gift_id, lgt.emoji, lgt.amount_coins, lgt.creator_amount_coins, lgt.receiver_user_id
    into v_existing_id, v_existing_gift_id, v_existing_emoji, v_existing_amount, v_existing_creator_amount, v_existing_receiver
  from public.live_gift_transactions lgt
  where lgt.sender_user_id = v_sender
    and lgt.session_id = p_session_id
    and lgt.idempotency_key = p_idempotency_key;

  if found then
    select aw.balance_coins into v_sender_balance
    from public.app_wallets aw where aw.user_id = v_sender;

    return query select
      v_existing_id, v_existing_gift_id, v_existing_emoji,
      v_existing_amount, v_existing_creator_amount,
      v_sender_balance, v_existing_receiver;
    return;
  end if;

  -- Lock both wallet rows in a fixed order (by user_id) to avoid deadlocks
  -- against a concurrent gift flowing the opposite direction.
  if v_sender < v_receiver then
    perform 1 from public.app_wallets where user_id = v_sender for update;
    perform 1 from public.app_wallets where user_id = v_receiver for update;
  else
    perform 1 from public.app_wallets where user_id = v_receiver for update;
    perform 1 from public.app_wallets where user_id = v_sender for update;
  end if;

  select aw.balance_coins into v_sender_balance
  from public.app_wallets aw where aw.user_id = v_sender;

  if v_sender_balance < v_gift_cost then
    raise exception 'insufficient balance' using errcode = '22023';
  end if;

  -- 10% platform fee, matching the split already used for BDAG gifts
  -- (see components/feature/GiftSheet.tsx / bdag-ledger 'gift' action).
  v_fee := floor(v_gift_cost * 0.10);
  v_creator_amount := v_gift_cost - v_fee;

  update public.app_wallets
  set balance_coins = balance_coins - v_gift_cost,
      updated_at = now()
  where user_id = v_sender
  returning balance_coins into v_sender_balance;

  update public.app_wallets
  set balance_coins = balance_coins + v_creator_amount,
      earned_coins = earned_coins + v_creator_amount,
      updated_at = now()
  where user_id = v_receiver;

  -- Unique (sender_user_id, session_id, idempotency_key) makes this the
  -- single source of truth: a true concurrent double-submit under the same
  -- idempotency_key fails this insert with unique_violation, which aborts
  -- and rolls back the whole function call (including the wallet updates
  -- above) since it all runs in one transaction. The client's retry will
  -- then hit the idempotent-return branch above.
  insert into public.live_gift_transactions (
    session_id, sender_user_id, receiver_user_id, gift_id, emoji,
    amount_coins, platform_fee_coins, creator_amount_coins, idempotency_key
  ) values (
    p_session_id, v_sender, v_receiver, v_gift_id, v_gift_emoji,
    v_gift_cost, v_fee, v_creator_amount, p_idempotency_key
  )
  returning id into v_tx_id;

  insert into public.app_wallet_ledger_entries (
    user_id, entry_type, amount_coins, balance_after, related_user_id, session_id, transaction_id, metadata
  ) values (
    v_sender, 'gift_send_debit', -v_gift_cost, v_sender_balance, v_receiver, p_session_id, v_tx_id,
    jsonb_build_object('gift_id', v_gift_id, 'emoji', v_gift_emoji)
  );

  insert into public.app_wallet_ledger_entries (
    user_id, entry_type, amount_coins, balance_after, related_user_id, session_id, transaction_id, metadata
  )
  select v_receiver, 'gift_receive_credit', v_creator_amount, aw.balance_coins, v_sender, p_session_id, v_tx_id,
         jsonb_build_object('gift_id', v_gift_id, 'emoji', v_gift_emoji, 'platform_fee_coins', v_fee)
  from public.app_wallets aw where aw.user_id = v_receiver;

  return query select
    v_tx_id, v_gift_id, v_gift_emoji, v_gift_cost, v_creator_amount, v_sender_balance, v_receiver;
end;
$$;

revoke all on function public.send_live_gift(uuid, text, text) from public;
grant execute on function public.send_live_gift(uuid, text, text) to authenticated;
