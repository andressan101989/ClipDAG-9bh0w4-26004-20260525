-- ============================================================================
-- scripts/migration_to_supabase.sql
--
-- Consolidated schema for the tables this app's client code and Edge
-- Functions actually read/write, reverse-engineered from:
--   contexts/AuthContext.tsx, contexts/FeedContext.tsx,
--   contexts/NotificationsContext.tsx, contexts/AgoraCallContext.tsx,
--   components/feature/CommentSheet.tsx, components/feature/ReportModal.tsx,
--   services/reportService.ts, hooks/useWallet.tsx,
--   services/financial/ledgerClient.ts,
--   supabase/functions/{bdag-withdraw,bdag-deposit,bdag-monitor,bdag-ledger}
--
-- SCOPE / WHAT THIS FILE DOES NOT DO
--   This creates the 13 tables requested, their indexes, and RLS policies.
--   It does NOT recreate the PostgreSQL RPC functions the Edge Functions
--   call via admin.rpc(...) — e.g. transfer_bdag_internal,
--   atomic_ledger_transfer, request_withdrawal_from_ledger,
--   refund_withdrawal_to_ledger, credit_deposit_to_ledger, ledger_debit,
--   ensure_ledger_account, purchase_exclusive_content, subscribe_to_creator,
--   purchase_boost, get_user_bdag_balance, send_premium_dm,
--   release_premium_dm,
--   follow_user, unfollow_user, __increment_likes.
--   Their source isn't present anywhere in this repo, and money-movement
--   logic (debits/credits/escrow) is exactly the kind of thing that must
--   not be guessed at — an invented version could silently corrupt
--   balances. If those functions don't already exist in the target
--   Supabase project, bdag-withdraw / bdag-deposit / bdag-ledger /
--   AuthContext.toggleFollow will fail at the .rpc() call
--   until the real definitions are sourced and added separately.
--   bdag-monitor intentionally does not call the removed generic
--   reconciliation, Premium DM expiry, or idempotency cleanup RPCs.
--
--   Also out of scope (referenced by code but not in the requested table
--   list): follows, likes, video_saves, gifts, exclusive_content,
--   subscription_plans, blockchain_settlements, audit_events,
--   velocity_counters, idempotency keys table.
--
-- SAFE TO RE-RUN: every statement is guarded (IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS before CREATE POLICY), so re-running this file
-- against a database that already has some of these objects will not error.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. user_profiles
-- ----------------------------------------------------------------------------
create table if not exists user_profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  username         text unique,
  display_name     text,
  avatar_url       text,
  bio              text,
  profession       text,
  website          text,
  location         text,
  followers_count  integer not null default 0,
  following_count  integer not null default 0,
  dag_balance      numeric not null default 0,
  wallet_address   text,
  is_admin         boolean not null default false,
  is_private       boolean not null default false,
  hide_activity    boolean not null default false,
  allow_comments_from text not null default 'everyone',
  allow_messages_from text not null default 'everyone',
  push_token       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists user_profiles_username_idx on user_profiles (username);

-- ----------------------------------------------------------------------------
-- 2. videos
-- ----------------------------------------------------------------------------
create table if not exists videos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references user_profiles(id) on delete cascade,
  video_url      text not null,
  thumbnail_url  text,
  media_urls     text[],
  caption        text not null default '',
  music          text not null default 'Sin musica',
  likes_count    integer not null default 0,
  comments_count integer not null default 0,
  shares_count   integer not null default 0,
  views_count    integer not null default 0,
  saves_count    integer not null default 0,
  created_at     timestamptz not null default now(),
  edited_at      timestamptz
);

create index if not exists videos_user_id_idx    on videos (user_id);
create index if not exists videos_created_at_idx on videos (created_at desc);

-- ----------------------------------------------------------------------------
-- 3. comments
-- ----------------------------------------------------------------------------
create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references videos(id) on delete cascade,
  user_id      uuid not null references user_profiles(id) on delete cascade,
  text         text not null,
  likes_count  integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists comments_video_id_idx on comments (video_id);
create index if not exists comments_user_id_idx  on comments (user_id);

-- ----------------------------------------------------------------------------
-- 4. comment_likes
-- ----------------------------------------------------------------------------
create table if not exists comment_likes (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references comments(id) on delete cascade,
  user_id     uuid not null references user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists comment_likes_comment_id_idx on comment_likes (comment_id);
create index if not exists comment_likes_user_id_idx    on comment_likes (user_id);

-- ----------------------------------------------------------------------------
-- 5. reports
-- ----------------------------------------------------------------------------
create table if not exists reports (
  id                     uuid primary key default gen_random_uuid(),
  reporter_user_id       uuid not null references user_profiles(id) on delete cascade,
  reported_content_id    uuid not null,
  reported_content_type  text not null check (reported_content_type in ('video', 'comment', 'user')),
  reason                 text not null,
  details                text,
  status                 text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at             timestamptz not null default now()
);

create index if not exists reports_reporter_user_id_idx      on reports (reporter_user_id);
create index if not exists reports_status_idx                on reports (status);
create index if not exists reports_reported_content_id_idx   on reports (reported_content_id);

-- ----------------------------------------------------------------------------
-- 6. blocked_users
-- ----------------------------------------------------------------------------
create table if not exists blocked_users (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references user_profiles(id) on delete cascade,
  blocked_id  uuid not null references user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

create index if not exists blocked_users_blocker_id_idx on blocked_users (blocker_id);
create index if not exists blocked_users_blocked_id_idx on blocked_users (blocked_id);

-- ----------------------------------------------------------------------------
-- 7. calls
--    (matches supabase/migrations/20260703152201_create_calls_table.sql —
--    repeated here so this file is a single consolidated reference; the
--    IF NOT EXISTS guards make running both files harmless.)
-- ----------------------------------------------------------------------------
create table if not exists calls (
  id            uuid primary key default gen_random_uuid(),
  caller_id     uuid references user_profiles(id),
  callee_id     uuid references user_profiles(id),
  channel_name  text not null,
  status        text default 'ringing',
  created_at    timestamptz default now()
);

create index if not exists calls_callee_id_idx on calls (callee_id);
create index if not exists calls_caller_id_idx on calls (caller_id);

-- ----------------------------------------------------------------------------
-- 8. notifications
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references user_profiles(id) on delete cascade,
  type            text not null,
  from_user_id    uuid references user_profiles(id) on delete set null,
  from_username   text,
  from_avatar     text,
  reference_id    text,
  reference_type  text,
  message         text,
  read            boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists notifications_user_id_idx    on notifications (user_id, created_at desc);
create index if not exists notifications_user_read_idx  on notifications (user_id, read);

-- ----------------------------------------------------------------------------
-- 9. ledger_accounts
-- ----------------------------------------------------------------------------
create table if not exists ledger_accounts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references user_profiles(id) on delete cascade,
  account_type  text not null check (account_type in ('user', 'escrow', 'treasury', 'platform')),
  balance       numeric not null default 0,
  frozen        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, account_type)
);

create index if not exists ledger_accounts_owner_id_idx on ledger_accounts (owner_id);

-- ----------------------------------------------------------------------------
-- 10. financial_transactions
-- ----------------------------------------------------------------------------
create table if not exists financial_transactions (
  id                uuid primary key default gen_random_uuid(),
  from_account_id   uuid references ledger_accounts(id),
  to_account_id     uuid references ledger_accounts(id),
  operation_type    text not null,
  amount            numeric not null,
  fee_amount        numeric not null default 0,
  currency          text not null default 'BDAG',
  status            text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'reversed')),
  blockchain_txid   text,
  reference_type    text,
  reference_id      text,
  created_at        timestamptz not null default now()
);

create index if not exists financial_transactions_from_account_id_idx on financial_transactions (from_account_id);
create index if not exists financial_transactions_to_account_id_idx   on financial_transactions (to_account_id);
create index if not exists financial_transactions_status_idx          on financial_transactions (status);
create index if not exists financial_transactions_created_at_idx      on financial_transactions (created_at desc);

-- ----------------------------------------------------------------------------
-- 11. withdrawal_requests
-- ----------------------------------------------------------------------------
create table if not exists withdrawal_requests (
  id                             uuid primary key default gen_random_uuid(),
  user_id                        uuid not null references user_profiles(id) on delete cascade,
  fin_txn_id                     uuid references financial_transactions(id),
  status                         text not null default 'queued' check (
                                   status in ('queued', 'requested', 'signing', 'broadcasted', 'completed', 'failed')
                                 ),
  bdag_amount                    numeric not null,
  net_bdag                       numeric,
  fee_bdag                       numeric,
  chain_id                       text not null,
  token_type                     text not null check (token_type in ('ETH', 'USDT')),
  to_address                     text not null,
  tx_hash                        text,
  eth_price_usd                  numeric,
  usd_equivalent_at_withdrawal   numeric,
  confirmations                  integer not null default 0,
  attempts                       integer not null default 0,
  last_attempt_at                timestamptz,
  failure_reason                 text,
  idempotency_key                text unique,
  expires_at                     timestamptz not null default (now() + interval '1 hour'),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create index if not exists withdrawal_requests_user_id_idx on withdrawal_requests (user_id, created_at desc);
create index if not exists withdrawal_requests_status_idx  on withdrawal_requests (status);

-- ----------------------------------------------------------------------------
-- 12. deposit_confirmations
-- ----------------------------------------------------------------------------
create table if not exists deposit_confirmations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references user_profiles(id) on delete cascade,
  tx_hash               text not null,
  chain_id              text not null,
  from_address          text not null,
  to_address            text not null,
  raw_amount_wei        text,
  bdag_credited         numeric not null default 0,
  eth_price_usd         numeric,
  usd_value             numeric,
  conversion_rate_used  text,
  block_number          bigint,
  confirmations         integer not null default 0,
  status                text not null default 'provisional' check (
                          status in ('provisional', 'pending', 'confirmed', 'credited', 'failed', 'duplicate')
                        ),
  rejection_reason      text,
  validated_at          timestamptz,
  created_at            timestamptz not null default now(),
  unique (tx_hash, chain_id)
);

create index if not exists deposit_confirmations_user_id_idx on deposit_confirmations (user_id, created_at desc);
create index if not exists deposit_confirmations_status_idx  on deposit_confirmations (status);

-- ----------------------------------------------------------------------------
-- 13. suspicious_activity_logs
-- ----------------------------------------------------------------------------
create table if not exists suspicious_activity_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references user_profiles(id) on delete set null,
  event_type   text not null,
  severity     text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  description  text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists suspicious_activity_logs_user_id_idx  on suspicious_activity_logs (user_id);
create index if not exists suspicious_activity_logs_severity_idx on suspicious_activity_logs (severity);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table user_profiles            enable row level security;
alter table videos                   enable row level security;
alter table comments                 enable row level security;
alter table comment_likes            enable row level security;
alter table reports                  enable row level security;
alter table blocked_users            enable row level security;
alter table calls                    enable row level security;
alter table notifications            enable row level security;
alter table ledger_accounts          enable row level security;
alter table financial_transactions   enable row level security;
alter table withdrawal_requests      enable row level security;
alter table deposit_confirmations    enable row level security;
alter table suspicious_activity_logs enable row level security;

-- ── user_profiles: profiles are public read (social feed), self-write ──────
drop policy if exists "user_profiles_select_all" on user_profiles;
create policy "user_profiles_select_all" on user_profiles
  for select using (true);

drop policy if exists "user_profiles_insert_self" on user_profiles;
create policy "user_profiles_insert_self" on user_profiles
  for insert with check (auth.uid() = id);

drop policy if exists "user_profiles_update_self" on user_profiles;
create policy "user_profiles_update_self" on user_profiles
  for update using (auth.uid() = id);

-- ── videos: public read, owner write ────────────────────────────────────────
drop policy if exists "videos_select_all" on videos;
create policy "videos_select_all" on videos
  for select using (true);

drop policy if exists "videos_insert_own" on videos;
create policy "videos_insert_own" on videos
  for insert with check (auth.uid() = user_id);

drop policy if exists "videos_update_own" on videos;
create policy "videos_update_own" on videos
  for update using (auth.uid() = user_id);

drop policy if exists "videos_delete_own" on videos;
create policy "videos_delete_own" on videos
  for delete using (auth.uid() = user_id);

-- ── comments: public read, owner write ──────────────────────────────────────
drop policy if exists "comments_select_all" on comments;
create policy "comments_select_all" on comments
  for select using (true);

drop policy if exists "comments_insert_own" on comments;
create policy "comments_insert_own" on comments
  for insert with check (auth.uid() = user_id);

drop policy if exists "comments_delete_own" on comments;
create policy "comments_delete_own" on comments
  for delete using (auth.uid() = user_id);

-- ── comment_likes: public read, self write ──────────────────────────────────
drop policy if exists "comment_likes_select_all" on comment_likes;
create policy "comment_likes_select_all" on comment_likes
  for select using (true);

drop policy if exists "comment_likes_insert_own" on comment_likes;
create policy "comment_likes_insert_own" on comment_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "comment_likes_delete_own" on comment_likes;
create policy "comment_likes_delete_own" on comment_likes
  for delete using (auth.uid() = user_id);

-- ── reports: private — reporter can create/read their own reports only ─────
drop policy if exists "reports_select_own" on reports;
create policy "reports_select_own" on reports
  for select using (auth.uid() = reporter_user_id);

drop policy if exists "reports_insert_own" on reports;
create policy "reports_insert_own" on reports
  for insert with check (auth.uid() = reporter_user_id);

-- (Admin moderation reads/updates use the service-role key, which bypasses
-- RLS entirely — see app/admin/index.tsx — so no admin policy is needed here.)

-- ── blocked_users: private — blocker only ───────────────────────────────────
drop policy if exists "blocked_users_select_own" on blocked_users;
create policy "blocked_users_select_own" on blocked_users
  for select using (auth.uid() = blocker_id);

drop policy if exists "blocked_users_insert_own" on blocked_users;
create policy "blocked_users_insert_own" on blocked_users
  for insert with check (auth.uid() = blocker_id);

drop policy if exists "blocked_users_delete_own" on blocked_users;
create policy "blocked_users_delete_own" on blocked_users
  for delete using (auth.uid() = blocker_id);

-- ── calls: participant-only (caller or callee) ──────────────────────────────
drop policy if exists "calls_select_participant" on calls;
create policy "calls_select_participant" on calls
  for select using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists "calls_insert_caller" on calls;
create policy "calls_insert_caller" on calls
  for insert with check (auth.uid() = caller_id);

drop policy if exists "calls_update_participant" on calls;
create policy "calls_update_participant" on calls
  for update using (auth.uid() = caller_id or auth.uid() = callee_id);

-- ── notifications: recipient-only read/update; sender can create as self ───
drop policy if exists "notifications_select_own" on notifications;
create policy "notifications_select_own" on notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on notifications;
create policy "notifications_update_own" on notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications_insert_as_self" on notifications;
create policy "notifications_insert_as_self" on notifications
  for insert with check (from_user_id is null or auth.uid() = from_user_id);

-- ── ledger_accounts: owner can read their own 'user' account only ───────────
-- Writes (balance mutation) happen exclusively through service-role RPCs
-- (ledger_debit / credit_deposit_to_ledger / etc.) — no client write policy.
drop policy if exists "ledger_accounts_select_own" on ledger_accounts;
create policy "ledger_accounts_select_own" on ledger_accounts
  for select using (auth.uid() = owner_id and account_type = 'user');

-- ── financial_transactions: participant-only read via owned ledger account ─
-- Writes happen exclusively via service-role Edge Functions — no client
-- write policy.
drop policy if exists "financial_transactions_select_participant" on financial_transactions;
create policy "financial_transactions_select_participant" on financial_transactions
  for select using (
    exists (
      select 1 from ledger_accounts la
      where la.id in (financial_transactions.from_account_id, financial_transactions.to_account_id)
        and la.owner_id = auth.uid()
    )
  );

-- ── withdrawal_requests: owner can read own requests; writes are service-role only ──
drop policy if exists "withdrawal_requests_select_own" on withdrawal_requests;
create policy "withdrawal_requests_select_own" on withdrawal_requests
  for select using (auth.uid() = user_id);

-- ── deposit_confirmations: owner can read own deposits; writes are service-role only ──
drop policy if exists "deposit_confirmations_select_own" on deposit_confirmations;
create policy "deposit_confirmations_select_own" on deposit_confirmations
  for select using (auth.uid() = user_id);

-- ── suspicious_activity_logs: no client policies at all ─────────────────────
-- RLS is enabled with zero policies for authenticated/anon, so this table is
-- readable/writable only via the service-role key (bdag-monitor). This is
-- intentional — it's a security/fraud log, not user-facing data.

-- ============================================================================
-- REALTIME
-- ============================================================================
-- Adding a table that's already a publication member throws, so guard each
-- one individually.
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles', 'videos', 'comments', 'comment_likes', 'reports',
    'blocked_users', 'calls', 'notifications', 'ledger_accounts',
    'financial_transactions', 'withdrawal_requests', 'deposit_confirmations',
    'suspicious_activity_logs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
