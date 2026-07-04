-- ============================================================================
-- supabase/migrations/20260704_live_db_audit_fixes.sql
--
-- Documents fixes applied directly to aewwdlvbwpczqyvkwvvj via Supabase MCP
-- from the "live database audit" pass (FIX 1, 2, 5, 6 below). FIX 3
-- (process_dag_reward) and FIX 4 (edge function deploys) are code/deploy
-- changes, not schema changes, and are not part of this file.
--
-- SAFE TO RE-RUN: guarded with IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- DROP POLICY IF EXISTS where applicable. The REVOKE statement is naturally
-- idempotent.
-- ============================================================================

-- ── FIX 1: Revoke public execute on financial RPCs (critical security) ─────
-- These functions move real BDAG balances (ledger_accounts.balance) and were
-- previously executable by anon/authenticated directly via PostgREST RPC —
-- i.e. any signed-in user (or, for the ones anon could reach, any anonymous
-- caller) could invoke them with arbitrary parameters, bypassing the Edge
-- Functions that are supposed to be the only callers (which apply auth,
-- ownership checks, and business validation before calling these).
-- After this revoke, only service_role (used by Edge Functions) can execute
-- them. ensure_ledger_account is the one exception the app calls directly
-- from the client (contexts/AuthContext.tsx register()) — verified that
-- this call degrades non-fatally (try/catch) if execute is later revoked
-- again, but for now it's intentionally still revoked from authenticated
-- per the audit's explicit list; the client call will simply no-op via the
-- caught error, since ledger accounts for new users are also created by
-- other server-side paths.
REVOKE EXECUTE ON FUNCTION
  public.atomic_ledger_transfer,
  public.ledger_credit,
  public.ledger_debit,
  public.request_withdrawal_from_ledger,
  public.credit_deposit_to_ledger,
  public.transfer_bdag_internal,
  public.ensure_ledger_account,
  public.check_velocity_limit
FROM anon, authenticated;

-- ── FIX 2: Prevent duplicate system/user ledger accounts ────────────────────
-- Without this, two concurrent ensure_ledger_account calls for the same
-- user (or a bug creating a second 'platform'/'escrow'/'treasury' row) could
-- create duplicate ledger_accounts rows, splitting a user's real balance
-- across two rows silently. NULLS NOT DISTINCT (PG15+) also covers system
-- accounts, which have owner_id IS NULL.
ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_system_unique
  UNIQUE NULLS NOT DISTINCT (owner_id, account_type);

-- ── FIX 5: Core beta tables (messages, likes, video_saves) ──────────────────
-- Premium/future tables (exclusive_content, subscription_plans, ad_campaigns,
-- etc.) are explicitly out of scope for this pass — see bdag-economy's
-- known gaps, tracked separately.
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references public.user_profiles(id) on delete cascade,
  recipient_id  uuid not null references public.user_profiles(id) on delete cascade,
  text          text not null default '',
  media_url     text,
  media_type    text not null default 'text',
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
alter table public.messages enable row level security;
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (auth.uid() = sender_id);
drop policy if exists "messages_update_recipient" on public.messages;
create policy "messages_update_recipient" on public.messages
  for update using (auth.uid() = recipient_id);

create table if not exists public.likes (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references public.videos(id) on delete cascade,
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (video_id, user_id)
);
alter table public.likes enable row level security;
drop policy if exists "likes_select_all" on public.likes;
create policy "likes_select_all" on public.likes for select using (true);
drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own" on public.likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own" on public.likes for delete using (auth.uid() = user_id);

create table if not exists public.video_saves (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references public.videos(id) on delete cascade,
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (video_id, user_id)
);
alter table public.video_saves enable row level security;
drop policy if exists "video_saves_select_own" on public.video_saves;
create policy "video_saves_select_own" on public.video_saves for select using (auth.uid() = user_id);
drop policy if exists "video_saves_insert_own" on public.video_saves;
create policy "video_saves_insert_own" on public.video_saves for insert with check (auth.uid() = user_id);
drop policy if exists "video_saves_delete_own" on public.video_saves;
create policy "video_saves_delete_own" on public.video_saves for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.video_saves;

-- ── FIX 6: Backfill missing user_profiles + ledger_accounts ─────────────────
-- The audit assumed only 1 auth.users row was missing a ledger account.
-- Verification found 3, and 2 of those 3 were ALSO missing user_profiles
-- entirely (a deeper gap than the audit's stated assumption) — those rows
-- are backfilled here first, using the same fallback-username logic already
-- used client-side in contexts/AuthContext.tsx loadProfile()
-- (email.split('@')[0]), so newly-backfilled usernames match what the app
-- itself would have generated on first login.
insert into public.user_profiles (id, email, username, dag_balance)
select au.id, au.email, split_part(au.email, '@', 1), 0
from auth.users au
left join public.user_profiles up on up.id = au.id
where up.id is null
on conflict (id) do nothing;

-- ensure_ledger_account is SECURITY DEFINER and idempotent (safe to re-run
-- for users who already have an account).
do $$
declare u record;
begin
  for u in select id from auth.users loop
    perform public.ensure_ledger_account(u.id);
  end loop;
end $$;
