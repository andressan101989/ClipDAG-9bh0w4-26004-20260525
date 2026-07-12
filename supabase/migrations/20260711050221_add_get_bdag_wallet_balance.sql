-- ============================================================================
-- supabase/migrations/20260711120000_add_get_bdag_wallet_balance.sql
--
-- DÍA 2E.2 — HOTFIX: LIVE viewer balance read.
--
-- LIVE was reading ledger_accounts directly from React Native (via
-- services/financial/ledgerClient.ts's getLedgerBalance(), reused by
-- services/liveGiftsService.ts's fetchWalletBalance()). The RLS policy
-- (ledger_accounts_select_own) is correct and identical to what the Wallet
-- screen already relies on successfully, so this was not a missing-policy
-- bug — but a direct client read of a financial table under RLS is fragile
-- to session/token timing edge cases (auth.uid() only resolves correctly if
-- the request carries a fully-hydrated session). A SECURITY DEFINER RPC that
-- resolves auth.uid() itself and returns only the caller's own balance is
-- the more robust, auditable read path, and matches how every WRITE to this
-- balance already happens (through RPCs, never direct table access).
--
-- This migration only ADDS a new read-only RPC. It does not touch
-- ledger_accounts, RLS, or send_live_gift().
--
-- SAFE TO RE-RUN: CREATE OR REPLACE FUNCTION, same signature every time.
-- ============================================================================

create or replace function public.get_bdag_wallet_balance()
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select la.balance
  into v_balance
  from public.ledger_accounts la
  where la.owner_id = v_user_id
    and la.account_type = 'user';

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.get_bdag_wallet_balance() from public;
grant execute on function public.get_bdag_wallet_balance() to authenticated;
;
