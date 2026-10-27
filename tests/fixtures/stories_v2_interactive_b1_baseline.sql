-- REDUCED SCHEMA SQL-REAL BASELINE ONLY. Fresh disposable local cluster.
-- Auth compatibility scaffold follows repository local SQL proof fixtures.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE PUBLICATION supabase_realtime;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN NOSUPERUSER BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,is_anonymous boolean NOT NULL DEFAULT false,raw_app_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt(),auth.role() TO anon,authenticated,service_role;
SET search_path=public,extensions;

-- SOURCE: 20260703212533_migration_to_supabase.sql
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
--   release_premium_dm, run_reconciliation_check,
--   refund_expired_premium_dms, cleanup_expired_idempotency_keys,
--   follow_user, unfollow_user, __increment_likes.
--   Their source isn't present anywhere in this repo, and money-movement
--   logic (debits/credits/escrow) is exactly the kind of thing that must
--   not be guessed at — an invented version could silently corrupt
--   balances. If those functions don't already exist in the target
--   Supabase project, bdag-withdraw / bdag-deposit / bdag-monitor /
--   bdag-ledger / AuthContext.toggleFollow will fail at the .rpc() call
--   until the real definitions are sourced and added separately.
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
;


-- SOURCE: 20260703215405_functions_export_schema.sql
alter table ledger_accounts          add column if not exists currency text not null default 'BDAG';
alter table financial_transactions   add column if not exists idempotency_key text;
alter table financial_transactions   add column if not exists initiated_by uuid references user_profiles(id);
alter table financial_transactions   add column if not exists chain_id text;
alter table withdrawal_requests      add column if not exists ledger_account_id uuid references ledger_accounts(id);
alter table deposit_confirmations    add column if not exists fin_txn_id uuid references financial_transactions(id);
alter table deposit_confirmations    add column if not exists credited_at timestamptz;

create table if not exists ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  txn_id         uuid not null,
  account_id     uuid not null references ledger_accounts(id) on delete cascade,
  entry_type     text not null check (entry_type in ('debit', 'credit')),
  amount         numeric not null,
  balance_after  numeric not null,
  description    text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists ledger_entries_account_id_idx on ledger_entries (account_id);
create index if not exists ledger_entries_txn_id_idx     on ledger_entries (txn_id);

create table if not exists idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null,
  operation_type   text not null,
  user_id          uuid references user_profiles(id) on delete cascade,
  request_hash     text,
  status           text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  response_body    jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (idempotency_key, operation_type, user_id)
);

create index if not exists idempotency_keys_user_id_idx on idempotency_keys (user_id);

create table if not exists velocity_counters (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references user_profiles(id) on delete cascade,
  operation_type text not null,
  window_start   timestamptz not null,
  window_end     timestamptz not null,
  count          integer not null default 0,
  total_amount   numeric not null default 0,
  unique (user_id, operation_type, window_start)
);

create index if not exists velocity_counters_window_end_idx on velocity_counters (window_end);

create table if not exists follows (
  id            uuid primary key default gen_random_uuid(),
  follower_id   uuid not null references user_profiles(id) on delete cascade,
  following_id  uuid not null references user_profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (follower_id, following_id)
);

create index if not exists follows_follower_id_idx  on follows (follower_id);
create index if not exists follows_following_id_idx on follows (following_id);

alter table ledger_entries     enable row level security;
alter table idempotency_keys   enable row level security;
alter table velocity_counters  enable row level security;
alter table follows            enable row level security;

drop policy if exists "follows_select_all" on follows;
create policy "follows_select_all" on follows
  for select using (true);

drop policy if exists "follows_insert_own" on follows;
create policy "follows_insert_own" on follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on follows;
create policy "follows_delete_own" on follows
  for delete using (auth.uid() = follower_id);

do $$
declare
  t text;
begin
  foreach t in array array['follows']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
;


-- SOURCE: 20260726090000_media_asset_foundation.sql
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('r2','cloudflare_stream','supabase_legacy')),
  media_kind text not null check (media_kind in ('image','audio','document','video')),
  purpose text not null,
  visibility text not null check (visibility in ('public','private')),
  bucket_name text not null,
  object_key text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  original_filename text,
  etag text,
  width integer,
  height integer,
  duration_ms bigint,
  status text not null default 'pending' check (status in ('pending','uploading','ready','failed','delete_pending','deleted')),
  error_code text,
  cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
  last_cleanup_attempt_at timestamptz,
  next_cleanup_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  unique(bucket_name, object_key)
);

create table if not exists public.media_asset_links (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  entity_type text not null check (entity_type in ('user_profile','video_post','story','chat_message','shop_product','exclusive_content')),
  entity_id uuid not null,
  slot text not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique(asset_id, entity_type, entity_id, slot, position)
);

create index if not exists media_assets_owner_created_idx on public.media_assets(owner_id, created_at desc);
create index if not exists media_assets_stale_idx on public.media_assets(status, created_at);
create index if not exists media_assets_cleanup_idx on public.media_assets(status, next_cleanup_attempt_at)
  where status = 'delete_pending';
create index if not exists media_asset_links_entity_idx on public.media_asset_links(entity_type, entity_id);

alter table public.media_assets enable row level security;
alter table public.media_asset_links enable row level security;

create policy media_assets_owner_read on public.media_assets for select to authenticated
  using (owner_id = auth.uid());
create policy media_assets_public_read on public.media_assets for select to anon, authenticated
  using (visibility = 'public' and status = 'ready');
create policy media_asset_links_owner_read on public.media_asset_links for select to authenticated
  using (exists(select 1 from public.media_assets a where a.id=asset_id and a.owner_id=auth.uid()));
create policy media_asset_links_public_read on public.media_asset_links for select to anon, authenticated
  using (exists(select 1 from public.media_assets a where a.id=asset_id and a.visibility='public' and a.status='ready'));

-- Mutations intentionally have no client policy. Only service_role Edge Functions
-- may choose keys/buckets or perform lifecycle transitions.



-- SOURCE: 20260726105000_media_public_urls_and_safe_links.sql
alter table public.media_assets
  add column if not exists public_url text;

update public.media_assets
set public_url =
  'https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/' ||
  replace(object_key, ' ', '%20'),
  updated_at = now()
where provider = 'r2'
  and visibility = 'public'
  and status = 'ready'
  and public_url is null;

alter table public.media_assets
  drop constraint if exists media_assets_ready_public_url_check;
alter table public.media_assets
  add constraint media_assets_ready_public_url_check
  check (
    provider <> 'r2'
    or visibility <> 'public'
    or status <> 'ready'
    or (public_url is not null and public_url ~ '^https://')
  );



-- SOURCE: 20260726100000_create_stories_schema.sql
begin;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  media_url text not null,
  media_type text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_user_id_fkey
    foreign key (user_id) references public.user_profiles(id) on delete cascade,
  constraint stories_media_type_check
    check (media_type in ('photo', 'video')),
  constraint stories_media_url_not_empty
    check (length(btrim(media_url)) > 0),
  constraint stories_expiry_after_creation
    check (expires_at > created_at)
);

create index stories_user_created_idx
  on public.stories(user_id, created_at desc);
create index stories_expires_idx
  on public.stories(expires_at);
create index stories_active_user_idx
  on public.stories(user_id, expires_at desc);

create table public.story_views (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.user_profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  constraint story_views_story_viewer_key unique(story_id, viewer_id)
);

create index story_views_viewer_idx
  on public.story_views(viewer_id, viewed_at desc);
create index story_views_story_idx
  on public.story_views(story_id);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

create policy stories_read_active_or_owned
  on public.stories
  for select
  to authenticated
  using (expires_at > now() or user_id = auth.uid());

create policy stories_insert_owned
  on public.stories
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy stories_delete_owned
  on public.stories
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy story_views_read_owned
  on public.story_views
  for select
  to authenticated
  using (viewer_id = auth.uid());

create policy story_views_insert_owned
  on public.story_views
  for insert
  to authenticated
  with check (
    viewer_id = auth.uid()
    and exists (
      select 1
      from public.stories s
      where s.id = story_id
        and (s.expires_at > now() or s.user_id = auth.uid())
    )
  );

grant select, insert, delete on public.stories to authenticated;
grant select, insert on public.story_views to authenticated;

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260908225020_stories_v2_b_canonical_contract_security_hardening.sql
begin;

-- Stories visibility is decided in Postgres, including blocks initiated by
-- either participant. SECURITY DEFINER is required because blocked_users RLS
-- intentionally exposes only rows created by the current blocker.
create or replace function private.story_can_view_owner(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    (select auth.uid()) is not null
    and p_owner_id is not null
    and (
      p_owner_id = (select auth.uid())
      or (
        exists (
          select 1
          from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = p_owner_id
        )
        and not exists (
          select 1
          from public.blocked_users b
          where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_owner_id)
             or (b.blocker_id = p_owner_id and b.blocked_id = (select auth.uid()))
        )
      )
    );
$$;

revoke all on function private.story_can_view_owner(uuid)
  from public, anon, authenticated, service_role;
-- The helper is outside PostgREST's exposed schemas, but the authenticated
-- database role still needs schema USAGE and function EXECUTE while Postgres
-- evaluates the stored RLS expression. This does not create an RPC endpoint.
grant usage on schema private to authenticated;
grant execute on function private.story_can_view_owner(uuid)
  to authenticated;

drop policy if exists stories_read_active_or_owned on public.stories;
drop policy if exists stories_read_visible on public.stories;
create policy stories_read_visible
  on public.stories
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and private.story_can_view_owner(user_id)
    )
  );

-- Story rows are created only by the canonical RPC below. The owner retains
-- read/delete access, while media and expiry are no longer caller-controlled.
drop policy if exists stories_insert_owned on public.stories;

revoke all on table public.stories from anon, authenticated;
grant select, delete on table public.stories to authenticated;

revoke all on table public.story_views from anon, authenticated;
grant select, insert on table public.story_views to authenticated;

-- media_assets/media_asset_links are read models for clients. Mutations remain
-- owned by the canonical media Edge/RPC lifecycle and service_role.
revoke all on table public.media_assets from anon, authenticated;
grant select on table public.media_assets to anon, authenticated;

revoke all on table public.media_asset_links from anon, authenticated;
grant select on table public.media_asset_links to anon, authenticated;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_media_url text;
  v_media_type text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'invalid_asset_id';
  end if;

  perform a.id
  from public.media_assets a
  where a.id = p_asset_id
  for update;

  select
    a.public_url,
    case
      when a.media_kind = 'image' and a.purpose = 'post_image' then 'photo'
      when a.media_kind = 'video' and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id
    and a.owner_id = v_actor
    and a.provider = 'r2'
    and a.status = 'ready'
    and a.visibility = 'public'
    and a.public_url is not null
    and a.public_url ~* '^https://'
    and (
      (a.media_kind = 'image' and a.purpose = 'post_image')
      or (a.media_kind = 'video' and a.purpose = 'story_video')
    );

  if v_media_url is null or v_media_type is null then
    raise exception using errcode = '42501', message = 'story_asset_not_ready_or_owned';
  end if;

  if exists (
    select 1
    from public.media_asset_links l
    where l.asset_id = p_asset_id
  ) then
    raise exception using errcode = '23505', message = 'story_asset_already_linked';
  end if;

  insert into public.stories(user_id, media_url, media_type)
  values(v_actor, v_media_url, v_media_type)
  returning id into v_story_id;

  insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
  values(p_asset_id, 'story', v_story_id, 'media', 0);

  return v_story_id;
end;
$$;

revoke all on function public.create_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid)
  to authenticated, service_role;

-- Compatibility aliases retain their signatures but delegate creation to the
-- one canonical implementation. The URL-array overload remains service-only.
create or replace function public.create_photo_story_with_media(p_asset_id uuid)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.create_story_with_media(p_asset_id);
$$;

revoke all on function public.create_photo_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_photo_story_with_media(uuid)
  to authenticated, service_role;

create or replace function public.create_photo_story_with_media(
  p_media_urls text[],
  p_asset_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if coalesce(array_length(p_asset_ids, 1), 0) <> 1
     or coalesce(array_length(p_media_urls, 1), 0) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_media_count';
  end if;
  if p_media_urls[1] is null or btrim(p_media_urls[1]) !~* '^https://' then
    raise exception using errcode = '22023', message = 'invalid_media_url';
  end if;

  return public.create_story_with_media(p_asset_ids[1]);
end;
$$;

revoke all on function public.create_photo_story_with_media(text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.create_photo_story_with_media(text[], uuid[])
  to service_role;

comment on function public.create_story_with_media(uuid) is
  'Canonical atomic Story creation from one owned READY public R2 media asset; server controls media URL, type, expiry, and link.';
comment on function public.create_photo_story_with_media(uuid) is
  'Compatibility alias. New callers must use create_story_with_media(uuid).';
comment on function public.create_photo_story_with_media(text[], uuid[]) is
  'Legacy service-only compatibility alias. URLs are not authoritative; creation delegates to create_story_with_media(uuid).';

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260909003332_stories_v2_c_private_media_lifecycle.sql
begin;

-- B briefly allowed public story_video assets. C1 must reconcile any such
-- linked rows explicitly rather than silently making an existing Story
-- unplayable. The approved production baseline has no Story links.
do $$
begin
  if exists (
    select 1
    from public.media_asset_links l
    join public.media_assets a on a.id = l.asset_id
    where l.entity_type = 'story'
      and l.slot = 'media'
      and l.position = 0
      and a.purpose in ('story_image', 'story_video')
      and a.visibility <> 'private'
  ) then
    raise exception using
      errcode = '55000',
      message = 'story_private_media_reconciliation_required';
  end if;
end;
$$;

-- Canonical Story rows identify media through media_asset_links. The URL
-- column remains only for public legacy photo rows and must never contain a
-- private object key or temporary signed URL.
alter table public.stories
  alter column media_url drop not null;

comment on column public.stories.media_url is
  'Legacy public HTTPS fallback only. Canonical private Story media is resolved from media_asset_links and this column remains null.';

-- Every Story link has one canonical shape and at most one media asset.
alter table public.media_asset_links
  drop constraint if exists media_asset_links_story_shape_check;
alter table public.media_asset_links
  add constraint media_asset_links_story_shape_check
  check (
    entity_type <> 'story'
    or (slot = 'media' and position = 0)
  );

create unique index story_media_slot_position_unique
  on public.media_asset_links(entity_id, slot, position)
  where entity_type = 'story';

-- A follower may discover only the opaque asset UUID linked to a Story that
-- is active and visible through the existing Stories RLS authority. This does
-- not expose the private media_assets row or its bucket/object identity.
drop policy if exists media_asset_links_owner_read
  on public.media_asset_links;
create policy media_asset_links_owner_read
  on public.media_asset_links
  for select
  to authenticated
  using (
    entity_type <> 'story'
    and exists (
      select 1
      from public.media_assets a
      where a.id = media_asset_links.asset_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists media_asset_links_public_read
  on public.media_asset_links;
create policy media_asset_links_public_read
  on public.media_asset_links
  for select
  to anon, authenticated
  using (
    entity_type <> 'story'
    and exists (
      select 1
      from public.media_assets a
      where a.id = media_asset_links.asset_id
        and a.visibility = 'public'
        and a.status = 'ready'
    )
  );

drop policy if exists media_asset_links_story_visible_read
  on public.media_asset_links;
create policy media_asset_links_story_visible_read
  on public.media_asset_links
  for select
  to authenticated
  using (
    entity_type = 'story'
    and slot = 'media'
    and position = 0
    and exists (
      select 1
      from public.stories s
      where s.id = media_asset_links.entity_id
        and s.expires_at > now()
    )
  );

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_media_url text;
  v_media_type text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'invalid_asset_id';
  end if;

  perform a.id
  from public.media_assets a
  where a.id = p_asset_id
  for update;

  select
    case
      when a.media_kind = 'image'
       and a.purpose = 'post_image'
       and a.visibility = 'public'
        then a.public_url
      else null
    end,
    case
      when a.media_kind = 'image'
       and a.purpose in ('story_image', 'post_image') then 'photo'
      when a.media_kind = 'video'
       and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id
    and a.owner_id = v_actor
    and a.provider = 'r2'
    and a.status = 'ready'
    and a.bucket_name is not null
    and btrim(a.bucket_name) <> ''
    and a.object_key is not null
    and btrim(a.object_key) <> ''
    and (
      (
        a.visibility = 'private'
        and a.public_url is null
        and (
          (a.media_kind = 'image' and a.purpose = 'story_image')
          or (a.media_kind = 'video' and a.purpose = 'story_video')
        )
      )
      or (
        a.visibility = 'public'
        and a.public_url is not null
        and a.public_url ~* '^https://'
        and a.media_kind = 'image'
        and a.purpose = 'post_image'
      )
    );

  if v_media_type is null then
    raise exception using errcode = '42501', message = 'story_asset_not_ready_or_owned';
  end if;

  if exists (
    select 1
    from public.media_asset_links l
    where l.asset_id = p_asset_id
  ) then
    raise exception using errcode = '23505', message = 'story_asset_already_linked';
  end if;

  insert into public.stories(user_id, media_url, media_type)
  values(v_actor, v_media_url, v_media_type)
  returning id into v_story_id;

  insert into public.media_asset_links(
    asset_id,
    entity_type,
    entity_id,
    slot,
    position
  )
  values(p_asset_id, 'story', v_story_id, 'media', 0);

  return v_story_id;
end;
$$;

comment on function public.create_story_with_media(uuid) is
  'Canonical atomic Story creation. New Stories use one owned READY private R2 story_image/story_video asset with a null media_url; public post_image remains a legacy photo compatibility path.';

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260909045509_stories_v2_d_viewer_integrity.sql
begin;

-- Story view writes are owned by one server-side RPC. Clients retain the
-- narrow SELECT policy used to render their own seen/unseen state.
drop policy if exists story_views_insert_owned on public.story_views;
drop policy if exists story_views_read_owned on public.story_views;
create policy story_views_read_owned
  on public.story_views
  for select
  to authenticated
  using (viewer_id = (select auth.uid()));

revoke all on table public.story_views from anon, authenticated;
grant select on table public.story_views to authenticated;

-- Supports the owner-only keyset query: equality by Story, then descending
-- timestamp and UUID tie-breaker. Existing indexes do not cover this order.
create index story_views_story_viewed_at_viewer_idx
  on public.story_views(story_id, viewed_at desc, viewer_id desc);

create or replace function public.mark_story_viewed(p_story_id uuid)
returns table(status text, viewed_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_viewed_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id
    and s.expires_at > now()
    and private.story_can_view_owner(s.user_id);

  if v_owner is null then
    raise exception using errcode = '42501', message = 'story_not_visible_or_expired';
  end if;

  if v_owner = v_actor then
    return query select 'owner'::text, null::timestamptz;
    return;
  end if;

  insert into public.story_views as sv(story_id, viewer_id)
  values(p_story_id, v_actor)
  on conflict (story_id, viewer_id) do nothing
  returning sv.viewed_at into v_viewed_at;

  if v_viewed_at is not null then
    return query select 'recorded'::text, v_viewed_at;
    return;
  end if;

  select sv.viewed_at
  into v_viewed_at
  from public.story_views sv
  where sv.story_id = p_story_id
    and sv.viewer_id = v_actor;

  return query select 'already_recorded'::text, v_viewed_at;
end;
$$;

revoke all on function public.mark_story_viewed(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_story_viewed(uuid)
  to authenticated;

comment on function public.mark_story_viewed(uuid) is
  'Canonical idempotent Story view mutation. Active visible non-owner views are recorded once; owner self-views are never persisted.';

create or replace function public.get_story_viewers(
  p_story_id uuid,
  p_limit integer default 50,
  p_before_viewed_at timestamptz default null,
  p_before_viewer_id uuid default null
)
returns table(
  viewer_id uuid,
  username text,
  avatar_url text,
  viewed_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  if (p_before_viewed_at is null) <> (p_before_viewer_id is null) then
    raise exception using errcode = '22023', message = 'invalid_viewer_cursor';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id;

  if v_owner is null then
    raise exception using errcode = '42501', message = 'story_not_found';
  end if;

  if v_owner <> v_actor then
    raise exception using errcode = '42501', message = 'story_viewers_owner_only';
  end if;

  return query
  with viewer_total as (
    select count(*)::bigint as total_count
    from public.story_views sv
    where sv.story_id = p_story_id
      and sv.viewer_id <> v_owner
  ), viewer_page as (
    select
      sv.viewer_id,
      up.username,
      up.avatar_url,
      sv.viewed_at
    from public.story_views sv
    join public.user_profiles up on up.id = sv.viewer_id
    where sv.story_id = p_story_id
      and sv.viewer_id <> v_owner
      and (
        p_before_viewed_at is null
        or sv.viewed_at < p_before_viewed_at
        or (
          sv.viewed_at = p_before_viewed_at
          and sv.viewer_id < p_before_viewer_id
        )
      )
    order by sv.viewed_at desc, sv.viewer_id desc
    limit v_limit
  )
  select
    vp.viewer_id,
    vp.username,
    vp.avatar_url,
    vp.viewed_at,
    vt.total_count
  from viewer_page vp
  cross join viewer_total vt
  order by vp.viewed_at desc, vp.viewer_id desc;
end;
$$;

revoke all on function public.get_story_viewers(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_viewers(uuid, integer, timestamptz, uuid)
  to authenticated;

comment on function public.get_story_viewers(uuid, integer, timestamptz, uuid) is
  'Owner-only Story viewer list with unique-viewer count and stable viewed_at/viewer_id keyset pagination. Returns public profile display fields only.';

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260909144214_stories_v2_e_delete_own_lifecycle_closure.sql
begin;

-- Story deletion is coordinated by one owner-authorized RPC. Clients retain
-- read-only table access and cannot bypass the media deletion lifecycle.
drop policy if exists stories_delete_owned on public.stories;

revoke all on table public.stories from anon, authenticated;
grant select on table public.stories to authenticated;

create or replace function public.delete_story(p_story_id uuid)
returns table(
  deleted_story_id uuid,
  media_asset_id uuid,
  media_cleanup_status text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_asset_id uuid;
  v_asset_owner uuid;
  v_cleanup_status text := 'none';
  v_affected integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  select s.id
  into v_story_id
  from public.stories s
  where s.id = p_story_id
    and s.user_id = v_actor
  for update;

  if v_story_id is null then
    raise exception using errcode = '42501', message = 'story_not_found_or_not_owned';
  end if;

  -- Discover the canonical Story link without treating legacy media_url as an
  -- object identity. C's partial unique index guarantees at most one row.
  select l.asset_id
  into v_asset_id
  from public.media_asset_links l
  where l.entity_type = 'story'
    and l.entity_id = v_story_id
    and l.slot = 'media'
    and l.position = 0;

  if v_asset_id is not null then
    -- Match the generic lifecycle lock order: media asset before media link.
    select a.owner_id
    into v_asset_owner
    from public.media_assets a
    where a.id = v_asset_id
    for update;

    if v_asset_owner is null or v_asset_owner <> v_actor then
      raise exception using errcode = '55000', message = 'story_media_contract_invalid';
    end if;

    perform 1
    from public.media_asset_links l
    where l.asset_id = v_asset_id
      and l.entity_type = 'story'
      and l.entity_id = v_story_id
      and l.slot = 'media'
      and l.position = 0
    for update;

    if not found then
      raise exception using errcode = '55000', message = 'story_media_contract_changed';
    end if;

    delete from public.media_asset_links l
    where l.asset_id = v_asset_id
      and l.entity_type = 'story'
      and l.entity_id = v_story_id
      and l.slot = 'media'
      and l.position = 0;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '55000', message = 'story_media_unlink_failed';
    end if;
  end if;

  delete from public.stories s
  where s.id = v_story_id
    and s.user_id = v_actor;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '55000', message = 'story_delete_failed';
  end if;

  -- Physical object deletion remains asynchronous and generic. A shared asset
  -- is retained when another authoritative link is still valid.
  if v_asset_id is not null then
    v_cleanup_status := public.schedule_media_asset_deletion(v_asset_id, v_actor);
    if v_cleanup_status not in ('scheduled', 'deleted', 'asset_in_use') then
      raise exception using errcode = '55000', message = 'story_media_schedule_failed';
    end if;
  end if;

  return query
  select v_story_id, v_asset_id, v_cleanup_status;
end;
$$;

revoke all on function public.delete_story(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_story(uuid)
  to authenticated;

comment on function public.delete_story(uuid) is
  'Canonical owner-only Story deletion. Removes the Story link and row atomically, relies on story_views cascade, and delegates media scheduling to the generic lifecycle.';

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260910002320_stories_v2_g_enable_stories_realtime.sql
-- STORIES-V2-G: Realtime is an invalidation signal only. Canonical Story
-- visibility remains public.stories RLS and every client event is reconciled
-- through the normal SELECT path before it can affect shared state.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end
$$;


-- SOURCE: 20260910140101_stories_v2_i_share_editor_integrity.sql
begin;

alter table public.stories
  add column if not exists story_kind text not null default 'media',
  add column if not exists shared_video_id uuid,
  add column if not exists shared_content_type text,
  add column if not exists story_composition jsonb not null
    default '{"version":1,"elements":[]}'::jsonb,
  add column if not exists client_story_id uuid;

alter table public.stories
  drop constraint if exists stories_story_kind_check,
  drop constraint if exists stories_shared_content_type_check,
  drop constraint if exists stories_source_coherence_check,
  drop constraint if exists stories_shared_video_id_fkey;

alter table public.stories
  add constraint stories_story_kind_check
    check (story_kind in ('media', 'shared')),
  add constraint stories_shared_content_type_check
    check (shared_content_type is null or shared_content_type in ('feed', 'reel')),
  add constraint stories_source_coherence_check
    check (
      (story_kind = 'media' and shared_video_id is null and shared_content_type is null)
      or
      (story_kind = 'shared' and media_url is null and shared_content_type is not null)
    ),
  add constraint stories_shared_video_id_fkey
    foreign key (shared_video_id) references public.videos(id) on delete set null;

create unique index if not exists stories_owner_client_story_unique
  on public.stories(user_id, client_story_id)
  where client_story_id is not null;

create index if not exists stories_shared_video_idx
  on public.stories(shared_video_id)
  where shared_video_id is not null;

comment on column public.stories.story_kind is
  'Story presentation kind. media uses canonical Story media; shared references existing public.videos content.';
comment on column public.stories.shared_video_id is
  'Nullable canonical public.videos identity. ON DELETE SET NULL preserves the Story shell without retaining source media.';
comment on column public.stories.shared_content_type is
  'Server-derived feed/reel presentation type retained only so a deleted source can render an unavailable shell.';
comment on column public.stories.story_composition is
  'Validated versioned normalized text/sticker composition. Never contains source or signed media URLs.';
comment on column public.stories.client_story_id is
  'Owner-scoped client idempotency key for one logical Story publish attempt.';

create or replace function private.story_validate_composition(p_composition jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_element jsonb;
  v_type text;
  v_text_count integer := 0;
  v_sticker_count integer := 0;
begin
  if p_composition is null
     or jsonb_typeof(p_composition) <> 'object'
     or octet_length(p_composition::text) > 32768
     or jsonb_typeof(p_composition -> 'version') <> 'number'
     or (p_composition ->> 'version') <> '1'
     or jsonb_typeof(p_composition -> 'elements') <> 'array'
     or jsonb_array_length(p_composition -> 'elements') > 32
     or exists (
       select 1 from jsonb_object_keys(p_composition) as key
       where key not in ('version', 'elements')
     ) then
    raise exception using errcode = '22023', message = 'invalid_story_composition';
  end if;

  for v_element in select value from jsonb_array_elements(p_composition -> 'elements')
  loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_story_element';
    end if;
    v_type := v_element ->> 'type';
    if v_type not in ('text', 'sticker')
       or coalesce(v_element ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_element -> 'x') <> 'number'
       or jsonb_typeof(v_element -> 'y') <> 'number'
       or jsonb_typeof(v_element -> 'scale') <> 'number'
       or jsonb_typeof(v_element -> 'rotation') <> 'number'
       or (v_element ->> 'x')::numeric not between 0 and 1
       or (v_element ->> 'y')::numeric not between 0 and 1
       or (v_element ->> 'scale')::numeric not between 0.5 and 4
       or (v_element ->> 'rotation')::numeric not between -180 and 180 then
      raise exception using errcode = '22023', message = 'invalid_story_element';
    end if;

    if v_type = 'text' then
      v_text_count := v_text_count + 1;
      if exists (
           select 1 from jsonb_object_keys(v_element) as key
           where key not in ('id','type','text','x','y','scale','rotation','color','align','size')
         )
         or jsonb_typeof(v_element -> 'text') <> 'string'
         or char_length(btrim(v_element ->> 'text')) not between 1 and 200
         or (v_element ->> 'text') ~ '[<>]'
         or (v_element ->> 'color') not in ('#FFFFFF','#111111','#FF2D78','#7C5CFF','#00D4FF','#FFD60A')
         or (v_element ->> 'align') not in ('left','center','right')
         or (v_element ->> 'size') not in ('small','medium','large') then
        raise exception using errcode = '22023', message = 'invalid_story_text_element';
      end if;
    else
      v_sticker_count := v_sticker_count + 1;
      if exists (
           select 1 from jsonb_object_keys(v_element) as key
           where key not in ('id','type','value','x','y','scale','rotation')
         )
         or jsonb_typeof(v_element -> 'value') <> 'string'
         or (v_element ->> 'value') not in ('❤️','😂','😮','😢','🔥','👏','✨','⭐','💯','🎉','😍') then
        raise exception using errcode = '22023', message = 'invalid_story_sticker_element';
      end if;
    end if;
  end loop;

  if v_text_count > 10 or v_sticker_count > 24 then
    raise exception using errcode = '22023', message = 'story_composition_limit_exceeded';
  end if;
  if (
    select count(*) <> count(distinct value ->> 'id')
    from jsonb_array_elements(p_composition -> 'elements')
  ) then
    raise exception using errcode = '22023', message = 'duplicate_story_element_id';
  end if;
  return p_composition;
end;
$$;

revoke all on function private.story_validate_composition(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.create_story_with_media_core(
  p_asset_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_media_url text;
  v_media_type text;
  v_composition jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'invalid_asset_id';
  end if;
  v_composition := private.story_validate_composition(p_composition);

  if p_client_story_id is not null then
    select s.id into v_story_id
    from public.stories s
    where s.user_id = v_actor and s.client_story_id = p_client_story_id
      and s.story_kind = 'media' and s.story_composition = v_composition
      and exists (
        select 1 from public.media_asset_links l
        where l.entity_type = 'story' and l.entity_id = s.id
          and l.slot = 'media' and l.position = 0 and l.asset_id = p_asset_id
      );
    if v_story_id is not null then return v_story_id; end if;
    if exists (
      select 1 from public.stories s
      where s.user_id = v_actor and s.client_story_id = p_client_story_id
    ) then
      raise exception using errcode = '23505', message = 'story_idempotency_conflict';
    end if;
  end if;

  perform a.id from public.media_assets a where a.id = p_asset_id for update;
  select
    case when a.media_kind = 'image' and a.purpose = 'post_image'
      and a.visibility = 'public' then a.public_url else null end,
    case
      when a.media_kind = 'image' and a.purpose in ('story_image','post_image') then 'photo'
      when a.media_kind = 'video' and a.purpose = 'story_video' then 'video'
      else null
    end
  into v_media_url, v_media_type
  from public.media_assets a
  where a.id = p_asset_id and a.owner_id = v_actor and a.provider = 'r2'
    and a.status = 'ready' and nullif(btrim(a.bucket_name), '') is not null
    and nullif(btrim(a.object_key), '') is not null
    and (
      (a.visibility = 'private' and a.public_url is null and
        ((a.media_kind = 'image' and a.purpose = 'story_image') or
         (a.media_kind = 'video' and a.purpose = 'story_video')))
      or
      (a.visibility = 'public' and a.public_url ~* '^https://'
        and a.media_kind = 'image' and a.purpose = 'post_image')
    );
  if v_media_type is null then
    raise exception using errcode = '42501', message = 'story_asset_not_ready_or_owned';
  end if;
  if exists (select 1 from public.media_asset_links l where l.asset_id = p_asset_id) then
    raise exception using errcode = '23505', message = 'story_asset_already_linked';
  end if;

  insert into public.stories(
    user_id, media_url, media_type, story_kind, story_composition, client_story_id
  ) values (
    v_actor, v_media_url, v_media_type, 'media', v_composition, p_client_story_id
  ) returning id into v_story_id;
  insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
  values(p_asset_id, 'story', v_story_id, 'media', 0);
  return v_story_id;
end;
$$;

revoke all on function private.create_story_with_media_core(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_story_with_media(
  p_asset_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select private.create_story_with_media_core(p_asset_id, p_composition, p_client_story_id);
$$;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select private.create_story_with_media_core(
    p_asset_id, '{"version":1,"elements":[]}'::jsonb, null
  );
$$;

revoke all on function public.create_story_with_media(uuid,jsonb,uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid)
  to authenticated, service_role;
revoke all on function public.create_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_story_with_media(uuid)
  to authenticated, service_role;

create or replace function public.create_story_from_content(
  p_video_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_content_type text;
  v_composition jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_video_id is null or p_client_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_source';
  end if;
  v_composition := private.story_validate_composition(p_composition);

  select s.id into v_story_id
  from public.stories s
  where s.user_id = v_actor and s.client_story_id = p_client_story_id
    and s.story_kind = 'shared' and s.shared_video_id = p_video_id
    and s.story_composition = v_composition;
  if v_story_id is not null then return v_story_id; end if;
  if exists (
    select 1 from public.stories s
    where s.user_id = v_actor and s.client_story_id = p_client_story_id
  ) then
    raise exception using errcode = '23505', message = 'story_idempotency_conflict';
  end if;

  perform v.id from public.videos v where v.id = p_video_id for key share;
  if not found or not public.marketplace_creator_content_visible(p_video_id, v_actor) then
    raise exception using errcode = '42501', message = 'story_source_not_visible';
  end if;
  v_content_type := public.marketplace_video_content_type(p_video_id);
  if v_content_type not in ('feed','reel') then
    raise exception using errcode = '22023', message = 'story_source_type_invalid';
  end if;

  insert into public.stories(
    user_id, media_url, media_type, story_kind, shared_video_id,
    shared_content_type, story_composition, client_story_id
  ) values (
    v_actor, null, 'photo', 'shared', p_video_id,
    v_content_type, v_composition, p_client_story_id
  ) returning id into v_story_id;
  return v_story_id;
end;
$$;

revoke all on function public.create_story_from_content(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_story_from_content(uuid,jsonb,uuid)
  to authenticated;

create or replace function public.get_story_shared_content(p_story_id uuid)
returns table(
  status text,
  source_video_id uuid,
  content_type text,
  owner_id uuid,
  username text,
  avatar_url text,
  caption text,
  preview_url text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story public.stories%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  select s.* into v_story from public.stories s
  where s.id = p_story_id and s.story_kind = 'shared' and s.expires_at > now()
    and (s.user_id = v_actor or private.story_can_view_owner(s.user_id));
  if not found then
    raise exception using errcode = '42501', message = 'story_not_visible';
  end if;
  if v_story.shared_video_id is null
     or not public.marketplace_creator_content_visible(v_story.shared_video_id, v_actor) then
    return query select 'unavailable'::text, null::uuid, null::text,
      null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;
  return query
  select 'available'::text, v.id, v_story.shared_content_type, v.user_id,
    p.username, p.avatar_url, left(v.caption, 160),
    case
      when v_story.shared_content_type = 'reel' then
        case when v.thumbnail_url ~* '^https://' then v.thumbnail_url else null end
      when coalesce(cardinality(v.media_urls),0) > 0 then
        case when v.media_urls[1] ~* '^https://' then v.media_urls[1] else null end
      else case when v.video_url ~* '^https://' then v.video_url else null end
    end
  from public.videos v
  join public.user_profiles p on p.id = v.user_id
  where v.id = v_story.shared_video_id;
end;
$$;

revoke all on function public.get_story_shared_content(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_shared_content(uuid)
  to authenticated;

comment on function public.create_story_with_media(uuid,jsonb,uuid) is
  'Canonical Story media creation core wrapper with validated normalized composition and owner-scoped client idempotency.';
comment on function public.create_story_from_content(uuid,jsonb,uuid) is
  'Creates one Story shell that references canonical visible public.videos content without copying media.';
comment on function public.get_story_shared_content(uuid) is
  'Resolves a currently authorized shared Story preview; unavailable sources return no identity or media fields.';

notify pgrst, 'reload schema';

commit;


-- SOURCE: 20260910012140_stories_v2_h_replies_reactions_integrity.sql
create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  reactor_id uuid not null references public.user_profiles(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_reactions_pkey primary key (story_id, reactor_id),
  constraint story_reactions_reaction_check check (
    reaction = any (array['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']::text[])
  )
);

create index if not exists story_reactions_story_updated_reactor_idx
  on public.story_reactions (story_id, updated_at desc, reactor_id desc);

alter table public.story_reactions enable row level security;

drop policy if exists story_reactions_read_own on public.story_reactions;
create policy story_reactions_read_own
  on public.story_reactions
  for select
  to authenticated
  using (reactor_id = (select auth.uid()));

revoke all on table public.story_reactions from public, anon, authenticated;
grant select on table public.story_reactions to authenticated;

create or replace function public.set_story_reaction(
  p_story_id uuid,
  p_reaction text
)
returns table (
  status text,
  reaction text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_expires_at timestamptz;
  v_previous text;
  v_updated_at timestamptz;
  v_removed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  if p_reaction is not null and p_reaction <> all (
    array['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']::text[]
  ) then
    raise exception using errcode = '22023', message = 'invalid_story_reaction';
  end if;

  select s.user_id, s.expires_at
  into v_owner, v_expires_at
  from public.stories s
  where s.id = p_story_id
  for share;

  if v_owner is null or v_expires_at <= now() then
    raise exception using errcode = '42501', message = 'story_not_available';
  end if;
  if v_owner = v_actor then
    raise exception using errcode = '42501', message = 'story_owner_cannot_react';
  end if;
  if not private.story_can_view_owner(v_owner) then
    raise exception using errcode = '42501', message = 'story_not_visible';
  end if;

  if p_reaction is null then
    delete from public.story_reactions r
    where r.story_id = p_story_id
      and r.reactor_id = v_actor
    returning r.updated_at into v_updated_at;
    v_removed := found;

    return query select
      case when v_removed then 'removed'::text else 'unchanged'::text end,
      null::text,
      v_updated_at;
    return;
  end if;

  select r.reaction
  into v_previous
  from public.story_reactions r
  where r.story_id = p_story_id
    and r.reactor_id = v_actor
  for update;

  insert into public.story_reactions as r (
    story_id, reactor_id, reaction, created_at, updated_at
  ) values (
    p_story_id, v_actor, p_reaction, now(), now()
  )
  on conflict (story_id, reactor_id) do update
  set reaction = excluded.reaction,
      updated_at = case
        when r.reaction is distinct from excluded.reaction then now()
        else r.updated_at
      end
  returning r.updated_at into v_updated_at;

  return query select
    case when v_previous = p_reaction then 'unchanged'::text else 'set'::text end,
    p_reaction,
    v_updated_at;
end;
$function$;

create or replace function public.get_story_reactions(
  p_story_id uuid,
  p_limit integer default 50,
  p_before_updated_at timestamptz default null,
  p_before_reactor_id uuid default null
)
returns table (
  reactor_id uuid,
  username text,
  avatar_url text,
  reaction text,
  reacted_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  if (p_before_updated_at is null) <> (p_before_reactor_id is null) then
    raise exception using errcode = '22023', message = 'invalid_reaction_cursor';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id;

  if v_owner is null or v_owner <> v_actor then
    raise exception using errcode = '42501', message = 'story_not_found_or_not_owned';
  end if;

  return query
  with reaction_total as (
    select count(*)::bigint as total_count
    from public.story_reactions r
    where r.story_id = p_story_id
  ), reaction_page as (
    select r.reactor_id, r.reaction, r.updated_at
    from public.story_reactions r
    where r.story_id = p_story_id
      and (
        p_before_updated_at is null
        or (r.updated_at, r.reactor_id) < (p_before_updated_at, p_before_reactor_id)
      )
    order by r.updated_at desc, r.reactor_id desc
    limit v_limit
  )
  select
    rp.reactor_id,
    coalesce(up.username, 'user')::text,
    up.avatar_url,
    rp.reaction,
    rp.updated_at,
    rt.total_count
  from reaction_page rp
  join public.user_profiles up on up.id = rp.reactor_id
  cross join reaction_total rt
  order by rp.updated_at desc, rp.reactor_id desc;
end;
$function$;



-- SOURCE: 20260910012140_stories_v2_h_replies_reactions_integrity.sql
revoke all on function public.set_story_reaction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_story_reaction(uuid, text) to authenticated;

revoke all on function public.get_story_reactions(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_reactions(uuid, integer, timestamptz, uuid) to authenticated;



-- SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create table private.admin_capabilities(
  capability_code text primary key,
  domain text not null,
  effect text not null,
  description text not null,
  is_sensitive boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_capabilities_code_check check(capability_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$'),
  constraint admin_capabilities_domain_check check(domain ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint admin_capabilities_effect_check check(effect in('read','write','workflow'))
);



-- SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create table private.admin_content_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on update restrict on delete restrict,
  actor_role_snapshot text[] not null,
  actor_capability text not null references private.admin_capabilities(capability_code)
    on update restrict on delete restrict,
  target_type text not null check(target_type in('video','comment','story','chat_message')),
  target_id uuid not null,
  action text not null check(action in('hide','restore')),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 2 and 500),
  idempotency_scope text not null check(
    idempotency_scope=btrim(idempotency_scope) and char_length(idempotency_scope) between 8 and 300
  ),
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  visibility_before text not null check(visibility_before in('visible','hidden')),
  visibility_after text not null check(visibility_after in('visible','hidden')),
  result text not null check(result in('succeeded','no_op')),
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_content_chat_action_check check(target_type<>'chat_message' or action='hide'),
  constraint admin_content_action_capability_check check(
    (target_type in('video','comment') and action='hide' and actor_capability='content.items.hide')
    or (target_type in('video','comment') and action='restore' and actor_capability='content.items.restore')
    or (target_type='story' and actor_capability='stories.items.moderate')
    or (target_type='chat_message' and action='hide' and actor_capability='chat.abuse_reports.moderate')
  ),
  unique(idempotency_scope,idempotency_key)
);

create index admin_content_moderation_actions_target_idx
  on private.admin_content_moderation_actions(target_type,target_id,created_at desc,id desc);

create table private.admin_content_moderation_state (
  target_type text not null check(target_type in('video','comment','story')),
  target_id uuid not null,
  visibility text not null check(visibility in('visible','hidden')),
  version bigint not null default 1 check(version>0),
  last_action_id uuid not null references private.admin_content_moderation_actions(id)
    on update restrict on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(target_type,target_id)
);

alter table private.admin_content_moderation_actions enable row level security;
alter table private.admin_content_moderation_state enable row level security;
revoke all privileges on table private.admin_content_moderation_actions
  from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_content_moderation_state
  from public,anon,authenticated,service_role;

create function private.admin_reject_content_action_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  raise exception using errcode='42501',message='admin_content_moderation_action_immutable';
end;
$$;

create trigger admin_content_moderation_actions_immutable
before update or delete on private.admin_content_moderation_actions
for each row execute function private.admin_reject_content_action_mutation();

create function private.admin_content_is_visible(p_target_type text,p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select case
    when p_target_type not in('video','comment','story') or p_target_id is null then false
    else not exists(
      select 1 from private.admin_content_moderation_state s
      where s.target_type=p_target_type and s.target_id=p_target_id and s.visibility='hidden'
    )
  end;
$$;

create function private.admin_cleanup_content_moderation_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  delete from private.admin_content_moderation_state
  where target_type=tg_argv[0] and target_id=old.id;
  return old;
end;
$$;

revoke all on function private.admin_reject_content_action_mutation()
  from public,anon,authenticated,service_role;
revoke all on function private.admin_content_is_visible(text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.admin_cleanup_content_moderation_state()
  from public,anon,authenticated,service_role;
grant usage on schema private to anon,authenticated;
grant execute on function private.admin_content_is_visible(text,uuid) to anon,authenticated;

create trigger videos_cleanup_admin_moderation_state
after delete on public.videos for each row
execute function private.admin_cleanup_content_moderation_state('video');
create trigger comments_cleanup_admin_moderation_state
after delete on public.comments for each row
execute function private.admin_cleanup_content_moderation_state('comment');
create trigger stories_cleanup_admin_moderation_state
after delete on public.stories for each row
execute function private.admin_cleanup_content_moderation_state('story');

drop policy if exists videos_select_all on public.videos;
create policy videos_select_all on public.videos for select
using(private.admin_content_is_visible('video',id));

drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments for select
using(private.admin_content_is_visible('comment',id));

drop policy if exists stories_read_visible on public.stories;
create policy stories_read_visible on public.stories for select to authenticated
using(
  private.admin_content_is_visible('story',id)
  and (user_id=auth.uid() or(expires_at>now() and private.story_can_view_owner(user_id)))
);

drop policy if exists media_asset_links_story_visible_read on public.media_asset_links;
create policy media_asset_links_story_visible_read on public.media_asset_links
for select to authenticated
using(
  entity_type='story' and slot='media' and position=0 and exists(
    select 1 from public.stories s
    where s.id=entity_id and s.expires_at>now()
      and private.admin_content_is_visible('story',s.id)
      and (s.user_id=auth.uid() or private.story_can_view_owner(s.user_id))
  )
);



-- SOURCE: 20261023141630_creator_premium_media_lifecycle_c1.sql
alter table public.media_assets
  add column upload_authorization_expires_at timestamptz,
  add column lifecycle_contract_version smallint,
  add column provider_absence_verified_at timestamptz,
  add column provider_absence_recheck_after timestamptz,
  add column post_delete_verification_attempts integer not null default 0;

alter table public.media_assets
  add constraint media_assets_lifecycle_contract_version_check
    check (lifecycle_contract_version is null or lifecycle_contract_version = 1),
  add constraint media_assets_provider_absence_contract_check
    check (
      (provider_absence_verified_at is null and provider_absence_recheck_after is null)
      or lifecycle_contract_version = 1
    ),
  add constraint media_assets_post_delete_verification_attempts_check
    check (post_delete_verification_attempts between 0 and 3);



-- FUNCTION SOURCE: 20261023141630_creator_premium_media_lifecycle_c1.sql
create or replace function public.schedule_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_due timestamptz;
begin
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id and asset.owner_id = p_owner_id
  for update;

  if not found then return 'not_found'; end if;
  if v_asset.status = 'deleted' then return 'deleted'; end if;
  if exists (
    select 1 from public.media_asset_links link where link.asset_id = v_asset.id
  ) then
    return 'asset_in_use';
  end if;
  if v_asset.status = 'delete_pending'
     and v_asset.lifecycle_contract_version = 1 then
    if v_asset.cleanup_attempts >= 12
       and v_asset.next_cleanup_attempt_at is null then
      return 'exhausted';
    end if;
    return 'scheduled';
  end if;

  v_due := greatest(
    pg_catalog.clock_timestamp(),
    coalesce(v_asset.upload_authorization_expires_at,pg_catalog.clock_timestamp())
  );

  update public.media_assets asset
  set status = 'delete_pending',
      error_code = null,
      cleanup_attempts = 0,
      last_cleanup_attempt_at = null,
      post_delete_verification_attempts = 0,
      lifecycle_contract_version = 1,
      provider_absence_verified_at = null,
      provider_absence_recheck_after = null,
      next_cleanup_attempt_at = v_due,
      updated_at = pg_catalog.clock_timestamp()
  where asset.id = v_asset.id;
  return 'scheduled';
end;
$$;

-- SOURCE: 20261024173500_creator_premium_f2_complete_monetization.sql
create or replace function public.check_velocity_limit(
  p_user_id uuid,
  p_operation text,
  p_amount numeric,
  p_max_ops integer,
  p_max_amount numeric,
  p_window_hours integer default 1
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_total numeric;
begin
  if p_user_id is null
     or p_operation is null
     or pg_catalog.btrim(p_operation)=''
     or pg_catalog.char_length(p_operation)>128
     or p_amount is null or p_amount<0
     or p_max_ops is null or p_max_ops<=0
     or p_max_amount is null or p_max_amount<0
     or p_window_hours is null or p_window_hours not between 1 and 168 then
    raise exception using errcode='22023',message='velocity_limit_invalid_input';
  end if;

  select coalesce(pg_catalog.sum(counter.count),0),
         coalesce(pg_catalog.sum(counter.total_amount),0)
  into v_count,v_total
  from public.velocity_counters counter
  where counter.user_id=p_user_id
    and counter.operation_type=p_operation
    and counter.window_end>v_now-pg_catalog.make_interval(hours=>p_window_hours);

  if v_count>=p_max_ops then
    insert into public.suspicious_activity_logs(
      user_id,event_type,severity,description,metadata
    ) values(
      p_user_id,'velocity_breach','medium',
      pg_catalog.format('Operation %s exceeded %s ops/window (actual: %s)',
        p_operation,p_max_ops,v_count),
      pg_catalog.jsonb_build_object(
        'operation',p_operation,'count',v_count,'limit',p_max_ops
      )
    );
    return false;
  end if;

  if p_max_amount>0 and v_total+p_amount>p_max_amount then
    insert into public.suspicious_activity_logs(
      user_id,event_type,severity,description,metadata
    ) values(
      p_user_id,'velocity_breach','medium',
      pg_catalog.format('Operation %s exceeded %s BDAG/window (actual: %s)',
        p_operation,p_max_amount,v_total),
      pg_catalog.jsonb_build_object(
        'operation',p_operation,'total',v_total,'limit',p_max_amount
      )
    );
    return false;
  end if;

  insert into public.velocity_counters as counter(
    user_id,operation_type,window_start,window_end,count,total_amount
  ) values(
    p_user_id,p_operation,pg_catalog.date_trunc('hour',v_now),
    pg_catalog.date_trunc('hour',v_now)+interval '1 hour',1,p_amount
  )
  on conflict(user_id,operation_type,window_start)
  do update set count=counter.count+1,
                total_amount=counter.total_amount+excluded.total_amount;

  return true;
end;
$$;

revoke all on function public.check_velocity_limit(uuid,text,numeric,integer,numeric,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.check_velocity_limit(uuid,text,numeric,integer,numeric,integer)
  to service_role;



REVOKE ALL ON FUNCTION public.schedule_media_asset_deletion(uuid,uuid) FROM public,anon,authenticated; GRANT EXECUTE ON FUNCTION public.schedule_media_asset_deletion(uuid,uuid) TO service_role;

-- CURRENT AUTHORITY SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.mark_story_viewed(p_story_id uuid)
returns table(status text,viewed_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_viewed_at timestamptz;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null then raise exception using errcode='22023',message='invalid_story_id';end if;
  select s.user_id into v_owner from public.stories s where s.id=p_story_id
    and s.expires_at>now() and private.admin_content_is_visible('story',s.id)
    and (s.user_id=v_actor or private.story_can_view_owner(s.user_id));
  if v_owner is null then raise exception using errcode='42501',message='story_not_visible_or_expired';end if;
  if v_owner=v_actor then return query select 'owner'::text,null::timestamptz;return;end if;
  insert into public.story_views as sv(story_id,viewer_id) values(p_story_id,v_actor)
    on conflict(story_id,viewer_id) do nothing returning sv.viewed_at into v_viewed_at;
  if v_viewed_at is not null then return query select 'recorded'::text,v_viewed_at;return;end if;
  select sv.viewed_at into v_viewed_at from public.story_views sv
    where sv.story_id=p_story_id and sv.viewer_id=v_actor;
  return query select 'already_recorded'::text,v_viewed_at;
end;
$$;

-- CURRENT AUTHORITY SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.set_story_reaction(p_story_id uuid,p_reaction text)
returns table(status text,reaction text,updated_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_expires_at timestamptz;v_prior text;
  v_updated_at timestamptz;v_deleted boolean;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or (p_reaction is not null and p_reaction not in('heart','laugh','wow','sad','fire','clap')) then
    raise exception using errcode='22023',message='invalid_story_reaction';end if;
  select s.user_id,s.expires_at into v_owner,v_expires_at from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id) for share;
  if v_owner is null or v_expires_at<=now() then raise exception using errcode='42501',message='story_not_available';end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_react';end if;
  if not private.story_can_view_owner(v_owner) then raise exception using errcode='42501',message='story_not_visible';end if;
  if p_reaction is null then
    delete from public.story_reactions r where r.story_id=p_story_id and r.reactor_id=v_actor
      returning r.updated_at into v_updated_at;
    v_deleted:=found;
    return query select case when v_deleted then 'removed' else 'unchanged' end::text,
      null::text,v_updated_at;return;
  end if;
  select r.reaction into v_prior from public.story_reactions r
    where r.story_id=p_story_id and r.reactor_id=v_actor;
  insert into public.story_reactions as r(story_id,reactor_id,reaction)
  values(p_story_id,v_actor,p_reaction)
  on conflict(story_id,reactor_id) do update set reaction=excluded.reaction,updated_at=clock_timestamp()
  returning r.updated_at into v_updated_at;
  return query select case when v_prior=p_reaction then 'unchanged' else 'set' end::text,
    p_reaction,v_updated_at;
end;
$$;

-- CURRENT AUTHORITY SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.get_story_reactions(
  p_story_id uuid,p_limit integer default 50,p_before_updated_at timestamptz default null,
  p_before_reactor_id uuid default null
) returns table(reactor_id uuid,username text,avatar_url text,reaction text,reacted_at timestamptz,total_count bigint)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or (p_before_updated_at is null)<>(p_before_reactor_id is null) then
    raise exception using errcode='22023',message='invalid_reaction_cursor';end if;
  select s.user_id into v_owner from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id);
  if v_owner is null or v_owner<>v_actor then
    raise exception using errcode='42501',message='story_not_found_or_not_owned';end if;
  return query with total as(select count(*)::bigint n from public.story_reactions r where r.story_id=p_story_id),
  page as(select r.reactor_id,r.reaction,r.updated_at from public.story_reactions r
    where r.story_id=p_story_id and (p_before_updated_at is null
      or(r.updated_at,r.reactor_id)<(p_before_updated_at,p_before_reactor_id))
    order by r.updated_at desc,r.reactor_id desc limit v_limit)
  select page.reactor_id,coalesce(p.username,'user')::text,p.avatar_url,page.reaction,
    page.updated_at,total.n from page join public.public_user_profiles p on p.id=page.reactor_id
    cross join total order by page.updated_at desc,page.reactor_id desc;
end;
$$;

-- CURRENT AUTHORITY SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.get_story_viewers(
  p_story_id uuid,p_limit integer default 50,p_before_viewed_at timestamptz default null,
  p_before_viewer_id uuid default null
) returns table(viewer_id uuid,username text,avatar_url text,viewed_at timestamptz,total_count bigint)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null or (p_before_viewed_at is null)<>(p_before_viewer_id is null) then
    raise exception using errcode='22023',message='invalid_viewer_cursor';end if;
  select s.user_id into v_owner from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id);
  if v_owner is null then raise exception using errcode='42501',message='story_not_found';end if;
  if v_owner<>v_actor then raise exception using errcode='42501',message='story_viewers_owner_only';end if;
  return query with total as(select count(*)::bigint n from public.story_views sv
    where sv.story_id=p_story_id and sv.viewer_id<>v_owner),
  page as(select sv.viewer_id,p.username,p.avatar_url,sv.viewed_at from public.story_views sv
    join public.public_user_profiles p on p.id=sv.viewer_id
    where sv.story_id=p_story_id and sv.viewer_id<>v_owner and (p_before_viewed_at is null
      or(sv.viewed_at,sv.viewer_id)<(p_before_viewed_at,p_before_viewer_id))
    order by sv.viewed_at desc,sv.viewer_id desc limit v_limit)
  select page.viewer_id,page.username,page.avatar_url,page.viewed_at,total.n
    from page cross join total order by page.viewed_at desc,page.viewer_id desc;
end;
$$;

-- CURRENT AUTHORITY SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.get_story_shared_content(p_story_id uuid)
returns table(status text,source_video_id uuid,content_type text,owner_id uuid,username text,
  avatar_url text,caption text,preview_url text)
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_story public.stories;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null then raise exception using errcode='22023',message='invalid_story_id';end if;
  select s.* into v_story from public.stories s where s.id=p_story_id and s.story_kind='shared'
    and s.expires_at>now() and private.admin_content_is_visible('story',s.id)
    and(s.user_id=v_actor or private.story_can_view_owner(s.user_id));
  if not found then raise exception using errcode='42501',message='story_not_visible';end if;
  if v_story.shared_video_id is null
     or not private.admin_content_is_visible('video',v_story.shared_video_id)
     or not public.marketplace_creator_content_visible(v_story.shared_video_id,v_actor) then
    return query select 'unavailable'::text,null::uuid,null::text,null::uuid,
      null::text,null::text,null::text,null::text;return;
  end if;
  return query select 'available'::text,v.id,v_story.shared_content_type,v.user_id,
    p.username,p.avatar_url,left(v.caption,160),case
      when v_story.shared_content_type='reel' then case when v.thumbnail_url~*'^https://' then v.thumbnail_url end
      when coalesce(cardinality(v.media_urls),0)>0 then case when v.media_urls[1]~*'^https://' then v.media_urls[1] end
      else case when v.video_url~*'^https://' then v.video_url end end
  from public.videos v join public.public_user_profiles p on p.id=v.user_id
  where v.id=v_story.shared_video_id;
end;
$$;

-- SOURCE: 20260704010000_live_db_audit_fixes.sql
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



-- SOURCE: 20260906222020_chat_v2_a_canonical_foundation.sql
begin;

-- CHAT-V2-A evolves public.messages in place. Historical message UUIDs remain
-- unchanged so Premium DM and message-push foreign keys remain valid.
lock table public.messages in share row exclusive mode;

do $$
begin
  if exists (select 1 from public.messages where sender_id is null or recipient_id is null) then
    raise exception 'chat_v2_a_precondition_null_direct_participant';
  end if;
  if exists (select 1 from public.messages where sender_id = recipient_id) then
    raise exception 'chat_v2_a_precondition_self_message';
  end if;
end;
$$;

create temporary table _chat_v2_a_counts (
  message_count bigint not null,
  message_id_digest text not null,
  premium_link_count bigint,
  push_outbox_count bigint,
  push_delivery_count bigint
) on commit drop;

do $$
declare
  v_premium bigint := null;
  v_outbox bigint := null;
  v_deliveries bigint := null;
begin
  if to_regclass('public.premium_dm_payments') is not null then
    execute 'select count(*) from public.premium_dm_payments where message_id is not null' into v_premium;
  end if;
  if to_regclass('public.message_push_outbox') is not null then
    execute 'select count(*) from public.message_push_outbox' into v_outbox;
  end if;
  if to_regclass('public.message_push_deliveries') is not null then
    execute 'select count(*) from public.message_push_deliveries' into v_deliveries;
  end if;
  insert into _chat_v2_a_counts
  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')), v_premium, v_outbox, v_deliveries
    from public.messages;
end;
$$;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null check (conversation_type in ('direct', 'group')),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  group_name text,
  group_avatar_url text,
  direct_user_a uuid references public.user_profiles(id) on delete restrict,
  direct_user_b uuid references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint chat_conversations_direct_shape check (
    (conversation_type = 'direct'
      and direct_user_a is not null and direct_user_b is not null
      and direct_user_a::text < direct_user_b::text
      and group_name is null and group_avatar_url is null)
    or
    (conversation_type = 'group'
      and direct_user_a is null and direct_user_b is null)
  ),
  constraint chat_conversations_group_name_length check (
    group_name is null or length(btrim(group_name)) between 1 and 120
  )
);

create unique index chat_conversations_direct_pair_uidx
  on public.chat_conversations (direct_user_a, direct_user_b)
  where conversation_type = 'direct';
create index chat_conversations_activity_idx
  on public.chat_conversations (last_activity_at desc, id desc);

create table public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_active boolean not null default true,
  notifications_enabled boolean not null default true,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint chat_conversation_members_active_shape check (
    (is_active and left_at is null) or (not is_active and left_at is not null)
  )
);

create index chat_conversation_members_user_active_idx
  on public.chat_conversation_members (user_id, conversation_id)
  where is_active;
create index chat_conversation_members_conversation_active_idx
  on public.chat_conversation_members (conversation_id, user_id)
  where is_active;

alter table public.messages
  add column conversation_id uuid,
  add column client_message_id uuid,
  add column message_type text,
  add column reply_to_message_id uuid,
  add column deleted_at timestamptz,
  add column media_asset_id uuid,
  add column consumption_policy text not null default 'standard',
  add column audio_duration_ms integer;

insert into public.chat_conversations (
  id, conversation_type, status, created_by, direct_user_a, direct_user_b,
  created_at, updated_at, last_activity_at
)
select
  md5('clipdag:chat:direct:' || pair.user_a::text || ':' || pair.user_b::text)::uuid,
  'direct', 'active', pair.user_a, pair.user_a, pair.user_b,
  pair.first_message_at, pair.last_message_at, pair.last_message_at
from (
  select
    case when sender_id::text < recipient_id::text then sender_id else recipient_id end as user_a,
    case when sender_id::text < recipient_id::text then recipient_id else sender_id end as user_b,
    min(created_at) as first_message_at,
    max(created_at) as last_message_at
  from public.messages
  group by 1, 2
) pair;

insert into public.chat_conversation_members (
  conversation_id, user_id, role, joined_at, is_active, created_at, updated_at
)
select c.id, member.user_id, 'member', c.created_at, true, c.created_at, c.created_at
from public.chat_conversations c
cross join lateral (values (c.direct_user_a), (c.direct_user_b)) member(user_id)
where c.conversation_type = 'direct';

update public.messages m
set conversation_id = c.id,
    client_message_id = m.id,
    message_type = case
      when m.media_type = 'image' then 'image'
      when m.media_type = 'video' then 'video'
      when m.media_type = 'premium_dm' then 'premium_dm'
      else 'text'
    end
from public.chat_conversations c
where c.conversation_type = 'direct'
  and c.direct_user_a = case when m.sender_id::text < m.recipient_id::text then m.sender_id else m.recipient_id end
  and c.direct_user_b = case when m.sender_id::text < m.recipient_id::text then m.recipient_id else m.sender_id end;

alter table public.messages
  alter column conversation_id set not null,
  alter column client_message_id set not null,
  alter column message_type set not null,
  add constraint messages_conversation_id_fkey foreign key (conversation_id)
    references public.chat_conversations(id) on delete restrict,
  add constraint messages_reply_to_message_id_fkey foreign key (reply_to_message_id)
    references public.messages(id) on delete set null,
  add constraint messages_message_type_check check (
    message_type in ('text', 'image', 'video', 'premium_dm', 'one_time_image', 'voice', 'system')
  ),
  add constraint messages_consumption_policy_check check (
    consumption_policy in ('standard', 'one_time')
  ),
  add constraint messages_audio_duration_check check (
    audio_duration_ms is null or audio_duration_ms between 1 and 3600000
  ),
  add constraint messages_deleted_at_check check (deleted_at is null or deleted_at >= created_at);

create unique index messages_sender_client_message_uidx
  on public.messages (sender_id, client_message_id);
create index messages_conversation_cursor_idx
  on public.messages (conversation_id, created_at desc, id desc)
  where deleted_at is null;
create index messages_reply_to_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;
create index messages_media_asset_idx
  on public.messages (media_asset_id)
  where media_asset_id is not null;

create table public.chat_message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  legacy_delivered boolean not null default false,
  legacy_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint chat_message_receipts_read_delivery_check check (
    read_at is null or delivered_at is not null
  ),
  constraint chat_message_receipts_timestamp_order_check check (
    read_at is null or delivered_at <= read_at
  ),
  constraint chat_message_receipts_legacy_read_check check (
    not legacy_read or legacy_delivered
  )
);

create index chat_message_receipts_user_unread_idx
  on public.chat_message_receipts (user_id, created_at desc, message_id)
  where read_at is null and not legacy_read;
create index chat_message_receipts_message_idx
  on public.chat_message_receipts (message_id, user_id);

-- Historical boolean state is preserved without fabricating delivery/read
-- timestamps. legacy_* records that the state existed before receipts did.
insert into public.chat_message_receipts (
  message_id, user_id, delivered_at, read_at,
  legacy_delivered, legacy_read, created_at, updated_at
)
select m.id, m.recipient_id, null, null, m.read, m.read, m.created_at, now()
from public.messages m;

create or replace function public.chat_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger chat_conversations_touch_updated_at
before update on public.chat_conversations
for each row execute function public.chat_touch_updated_at();
create trigger chat_conversation_members_touch_updated_at
before update on public.chat_conversation_members
for each row execute function public.chat_touch_updated_at();
create trigger chat_message_receipts_touch_updated_at
before update on public.chat_message_receipts
for each row execute function public.chat_touch_updated_at();

create or replace function public.chat_is_active_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.chat_conversation_members member
    where member.conversation_id = p_conversation_id
      and member.user_id = (select auth.uid()) and member.is_active
  );
$$;

create or replace function public.chat_guard_direct_membership()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.chat_conversations%rowtype;
begin
  select * into v_conversation
  from public.chat_conversations
  where id = coalesce(new.conversation_id, old.conversation_id);

  if v_conversation.conversation_type = 'direct' then
    if tg_op = 'DELETE' then
      raise exception 'chat_direct_membership_immutable';
    end if;
    if new.user_id not in (v_conversation.direct_user_a, v_conversation.direct_user_b)
      or not new.is_active or new.left_at is not null or new.role <> 'member' then
      raise exception 'chat_direct_membership_invalid';
    end if;
    if tg_op = 'UPDATE'
      and (new.user_id <> old.user_id or new.conversation_id <> old.conversation_id) then
      raise exception 'chat_direct_membership_immutable';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger chat_conversation_members_guard_direct
before insert or update or delete on public.chat_conversation_members
for each row execute function public.chat_guard_direct_membership();

create or replace function public.chat_prepare_legacy_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
begin
  if v_actor is not null and new.sender_id <> v_actor then
    raise exception 'chat_sender_identity_mismatch';
  end if;
  if new.sender_id is null or new.recipient_id is null or new.sender_id = new.recipient_id then
    raise exception 'chat_direct_participants_invalid';
  end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm') then
    raise exception 'chat_message_type_invalid';
  end if;
  if length(coalesce(new.text, '')) > 5000 then
    raise exception 'chat_message_too_long';
  end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then
    raise exception 'chat_text_required';
  end if;
  if new.media_type in ('image', 'video')
    and nullif(btrim(coalesce(new.media_url, '')), '') is null then
    raise exception 'chat_media_required';
  end if;
  if v_actor is not null then
    new.read := false;
  end if;
  v_a := case when new.sender_id::text < new.recipient_id::text then new.sender_id else new.recipient_id end;
  v_b := case when new.sender_id::text < new.recipient_id::text then new.recipient_id else new.sender_id end;

  if new.conversation_id is null then
    insert into public.chat_conversations (
      conversation_type, created_by, direct_user_a, direct_user_b
    ) values ('direct', new.sender_id, v_a, v_b)
    on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct'
    do nothing
    returning id into new.conversation_id;
    if new.conversation_id is null then
      select id into new.conversation_id from public.chat_conversations
      where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b;
    end if;
  end if;

  if not exists (
    select 1 from public.chat_conversations c
    where c.id = new.conversation_id and c.conversation_type = 'direct'
      and c.status = 'active' and c.direct_user_a = v_a and c.direct_user_b = v_b
  ) then
    raise exception 'chat_message_conversation_mismatch';
  end if;

  insert into public.chat_conversation_members (conversation_id, user_id, role)
  values (new.conversation_id, v_a, 'member'), (new.conversation_id, v_b, 'member')
  on conflict (conversation_id, user_id) do nothing;

  new.client_message_id := coalesce(new.client_message_id, new.id, gen_random_uuid());
  new.message_type := coalesce(new.message_type, case
    when new.media_type = 'image' then 'image'
    when new.media_type = 'video' then 'video'
    when new.media_type = 'premium_dm' then 'premium_dm'
    else 'text'
  end);
  return new;
end;
$$;

revoke all on function public.chat_prepare_legacy_message() from public, anon, authenticated;

create trigger messages_chat_prepare
before insert on public.messages
for each row execute function public.chat_prepare_legacy_message();

create or replace function public.chat_after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null and new.sender_id <> v_actor then
    raise exception 'chat_sender_identity_mismatch';
  end if;
  update public.chat_conversations
  set last_activity_at = greatest(last_activity_at, new.created_at)
  where id = new.conversation_id;

  insert into public.chat_message_receipts (message_id, user_id, created_at)
  values (new.id, new.recipient_id, new.created_at)
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.chat_after_message_insert() from public, anon, authenticated;

create trigger messages_chat_after_insert
after insert on public.messages
for each row execute function public.chat_after_message_insert();

create or replace function public.chat_sync_legacy_read()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if old.read and not new.read then
    raise exception 'chat_read_state_cannot_regress';
  end if;
  if v_actor is not null and new.recipient_id <> v_actor then
    raise exception 'chat_receipt_identity_mismatch';
  end if;
  if not old.read and new.read then
    insert into public.chat_message_receipts (
      message_id, user_id, delivered_at, read_at, created_at, updated_at
    ) values (new.id, new.recipient_id, now(), now(), new.created_at, now())
    on conflict (message_id, user_id) do update
      set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
          read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
          legacy_delivered = false,
          legacy_read = false;
  end if;
  return new;
end;
$$;

revoke all on function public.chat_sync_legacy_read() from public, anon, authenticated;

create trigger messages_chat_sync_legacy_read
before update of read on public.messages
for each row execute function public.chat_sync_legacy_read();

create or replace function public.chat_get_or_create_direct(p_other_user_id uuid)
returns public.chat_conversations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
  v_result public.chat_conversations%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_other_user_id is null or p_other_user_id = v_actor then
    raise exception 'chat_direct_participants_invalid';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_other_user_id) then
    raise exception 'chat_recipient_not_found';
  end if;
  v_a := case when v_actor::text < p_other_user_id::text then v_actor else p_other_user_id end;
  v_b := case when v_actor::text < p_other_user_id::text then p_other_user_id else v_actor end;

  insert into public.chat_conversations (conversation_type, created_by, direct_user_a, direct_user_b)
  values ('direct', v_actor, v_a, v_b)
  on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct'
  do nothing
  returning * into v_result;
  if v_result.id is null then
    select * into v_result from public.chat_conversations
    where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b;
  end if;

  insert into public.chat_conversation_members (conversation_id, user_id, role)
  values (v_result.id, v_a, 'member'), (v_result.id, v_b, 'member')
  on conflict (conversation_id, user_id) do nothing;
  return v_result;
end;
$$;

create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_text text default '',
  p_message_type text default 'text',
  p_media_url text default null,
  p_media_asset_id uuid default null,
  p_reply_to_message_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_conversation public.chat_conversations%rowtype;
  v_recipient uuid;
  v_existing public.messages%rowtype;
  v_result public.messages%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_client_message_id is null then raise exception 'chat_idempotency_key_required'; end if;
  select * into v_conversation from public.chat_conversations where id = p_conversation_id;
  if v_conversation.id is null or v_conversation.status <> 'active' then
    raise exception 'chat_conversation_unavailable';
  end if;
  if not exists (
    select 1 from public.chat_conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = v_actor and cm.is_active
  ) then raise exception 'chat_membership_required'; end if;
  if v_conversation.conversation_type <> 'direct' then
    raise exception 'chat_group_send_not_enabled';
  end if;
  v_recipient := case when v_conversation.direct_user_a = v_actor
    then v_conversation.direct_user_b else v_conversation.direct_user_a end;
  if p_message_type not in ('text', 'image', 'video') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(p_text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if p_message_type = 'text' and length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if p_message_type in ('image', 'video') and nullif(btrim(coalesce(p_media_url, '')), '') is null
    and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_message_id and conversation_id = p_conversation_id
  ) then raise exception 'chat_reply_target_invalid'; end if;

  select * into v_existing from public.messages
  where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.message_type <> p_message_type
      or v_existing.text <> coalesce(p_text, '')
      or v_existing.media_url is distinct from p_media_url
      or v_existing.media_asset_id is distinct from p_media_asset_id
      or v_existing.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    return v_existing;
  end if;

  insert into public.messages (
    sender_id, recipient_id, conversation_id, client_message_id, text,
    media_url, media_type, message_type, media_asset_id, reply_to_message_id, read
  ) values (
    v_actor, v_recipient, p_conversation_id, p_client_message_id, coalesce(p_text, ''),
    p_media_url, p_message_type, p_message_type, p_media_asset_id, p_reply_to_message_id, false
  ) returning * into v_result;
  return v_result;
exception
  when unique_violation then
    select * into v_result from public.messages
    where sender_id = v_actor and client_message_id = p_client_message_id;
    if v_result.id is null then raise; end if;
    if v_result.conversation_id <> p_conversation_id
      or v_result.message_type <> p_message_type
      or v_result.text <> coalesce(p_text, '')
      or v_result.media_url is distinct from p_media_url
      or v_result.media_asset_id is distinct from p_media_asset_id
      or v_result.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    return v_result;
end;
$$;

create or replace function public.chat_acknowledge_delivery(p_message_id uuid)
returns public.chat_message_receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_result public.chat_message_receipts%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.sender_id = v_actor or v_message.recipient_id <> v_actor then
    raise exception 'chat_receipt_not_authorized';
  end if;
  insert into public.chat_message_receipts (message_id, user_id, delivered_at, created_at, updated_at)
  values (p_message_id, v_actor, now(), v_message.created_at, now())
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        legacy_delivered = public.chat_message_receipts.legacy_read
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.chat_acknowledge_read(p_message_id uuid)
returns public.chat_message_receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_now timestamptz := now();
  v_result public.chat_message_receipts%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.sender_id = v_actor or v_message.recipient_id <> v_actor then
    raise exception 'chat_receipt_not_authorized';
  end if;
  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, read_at, created_at, updated_at
  ) values (p_message_id, v_actor, v_now, v_now, v_message.created_at, v_now)
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
        legacy_delivered = false, legacy_read = false
  returning * into v_result;
  update public.messages set read = true where id = p_message_id and not read;
  return v_result;
end;
$$;

create or replace function public.chat_mark_conversation_read(p_conversation_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_count bigint;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if not exists (
    select 1 from public.chat_conversation_members
    where conversation_id = p_conversation_id and user_id = v_actor and is_active
  ) then raise exception 'chat_membership_required'; end if;

  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, read_at, created_at, updated_at
  )
  select m.id, v_actor, v_now, v_now, m.created_at, v_now
  from public.messages m
  where m.conversation_id = p_conversation_id and m.sender_id <> v_actor
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
        legacy_delivered = false, legacy_read = false;
  get diagnostics v_count = row_count;
  update public.messages set read = true
  where conversation_id = p_conversation_id and recipient_id = v_actor and not read;
  return v_count;
end;
$$;

create or replace function public.chat_get_conversations(
  p_limit integer default 30,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  conversation_id uuid,
  conversation_type text,
  conversation_status text,
  last_activity_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_avatar_url text,
  last_message jsonb,
  unread_count bigint
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select c.id, c.conversation_type, c.status, c.last_activity_at,
         other.user_id, profile.username, profile.avatar_url,
         case when latest.id is null then null else jsonb_build_object(
           'id', latest.id, 'sender_id', latest.sender_id, 'recipient_id', latest.recipient_id,
           'conversation_id', latest.conversation_id, 'client_message_id', latest.client_message_id,
           'text', latest.text, 'media_url', latest.media_url, 'media_type', latest.media_type,
           'message_type', latest.message_type, 'read', latest.read, 'created_at', latest.created_at
         ) end,
         (select count(*) from public.chat_message_receipts receipt
          join public.messages unread_message on unread_message.id = receipt.message_id
          where unread_message.conversation_id = c.id and receipt.user_id = (select auth.uid())
            and receipt.read_at is null and not receipt.legacy_read)
  from public.chat_conversation_members mine
  join public.chat_conversations c on c.id = mine.conversation_id
  left join lateral (
    select member.user_id from public.chat_conversation_members member
    where member.conversation_id = c.id and member.user_id <> (select auth.uid()) and member.is_active
    order by member.user_id limit 1
  ) other on true
  left join public.user_profiles profile on profile.id = other.user_id
  left join lateral (
    select m.* from public.messages m where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
  where mine.user_id = (select auth.uid()) and mine.is_active
    and (p_before_activity_at is null
      or (c.last_activity_at, c.id) < (p_before_activity_at, p_before_id))
  order by c.last_activity_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

create or replace function public.chat_get_recent_messages(
  p_conversation_id uuid,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.messages
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select m.* from public.messages m
  where m.conversation_id = p_conversation_id and m.deleted_at is null
    and exists (
      select 1 from public.chat_conversation_members member
      where member.conversation_id = m.conversation_id
        and member.user_id = (select auth.uid()) and member.is_active
    )
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.chat_get_members(p_conversation_id uuid)
returns setof public.chat_conversation_members
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select member.* from public.chat_conversation_members member
  where member.conversation_id = p_conversation_id
    and exists (
      select 1 from public.chat_conversation_members mine
      where mine.conversation_id = p_conversation_id
        and mine.user_id = (select auth.uid()) and mine.is_active
    )
  order by member.joined_at, member.user_id;
$$;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_message_receipts enable row level security;

drop policy if exists chat_conversations_member_select on public.chat_conversations;
create policy chat_conversations_member_select on public.chat_conversations
for select to authenticated using (
  public.chat_is_active_member(id)
);

drop policy if exists chat_conversation_members_member_select on public.chat_conversation_members;
create policy chat_conversation_members_member_select on public.chat_conversation_members
for select to authenticated using (
  public.chat_is_active_member(chat_conversation_members.conversation_id)
);

drop policy if exists chat_message_receipts_member_select on public.chat_message_receipts;
create policy chat_message_receipts_member_select on public.chat_message_receipts
for select to authenticated using (
  exists (select 1 from public.messages message
    where message.id = chat_message_receipts.message_id
      and public.chat_is_active_member(message.conversation_id))
);

drop policy if exists messages_select_participant on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
create policy messages_select_participant on public.messages
for select to authenticated using (
  public.chat_is_active_member(messages.conversation_id)
);

drop policy if exists messages_insert_own on public.messages;
drop policy if exists "messages_insert_own" on public.messages;
create policy messages_insert_own on public.messages
for insert to authenticated with check ((select auth.uid()) = sender_id);

drop policy if exists messages_update_recipient on public.messages;
drop policy if exists "messages_update_recipient" on public.messages;
create policy messages_update_recipient on public.messages
for update to authenticated
using ((select auth.uid()) = recipient_id)
with check ((select auth.uid()) = recipient_id);

revoke all on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts from public, anon, authenticated;
grant select on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts to authenticated;
grant all on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts to service_role;

revoke all on table public.messages from public, anon;
revoke insert, update, delete on table public.messages from authenticated;
grant select on table public.messages to authenticated;
grant insert (sender_id, recipient_id, text, media_url, media_type, read)
  on public.messages to authenticated;
grant update (read) on public.messages to authenticated;

revoke all on function public.chat_touch_updated_at() from public, anon, authenticated;
revoke all on function public.chat_guard_direct_membership() from public, anon, authenticated;
revoke all on function public.chat_is_active_member(uuid) from public, anon;
revoke all on function public.chat_get_or_create_direct(uuid) from public, anon;
revoke all on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.chat_acknowledge_delivery(uuid) from public, anon;
revoke all on function public.chat_acknowledge_read(uuid) from public, anon;
revoke all on function public.chat_mark_conversation_read(uuid) from public, anon;
revoke all on function public.chat_get_conversations(integer, timestamptz, uuid) from public, anon;
revoke all on function public.chat_get_recent_messages(uuid, integer, timestamptz, uuid) from public, anon;
revoke all on function public.chat_get_members(uuid) from public, anon;
grant execute on function public.chat_get_or_create_direct(uuid) to authenticated;
grant execute on function public.chat_is_active_member(uuid) to authenticated;
grant execute on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.chat_acknowledge_delivery(uuid) to authenticated;
grant execute on function public.chat_acknowledge_read(uuid) to authenticated;
grant execute on function public.chat_mark_conversation_read(uuid) to authenticated;
grant execute on function public.chat_get_conversations(integer, timestamptz, uuid) to authenticated;
grant execute on function public.chat_get_recent_messages(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.chat_get_members(uuid) to authenticated;

-- Trigger functions do not need client EXECUTE. Reassert the existing push
-- trigger's intended ACL without changing its dispatcher behavior.
-- OMITTED absent external push dispatcher ACL: revoke all on function public.message_push_delivery_wake() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_conversations'
  ) then alter publication supabase_realtime add table public.chat_conversations; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_conversation_members'
  ) then alter publication supabase_realtime add table public.chat_conversation_members; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_message_receipts'
  ) then alter publication supabase_realtime add table public.chat_message_receipts; end if;
end;
$$;

do $$
declare
  v_before _chat_v2_a_counts%rowtype;
  v_count bigint;
  v_digest text;
  v_compare bigint;
begin
  select * into v_before from _chat_v2_a_counts;
  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
    into v_count, v_digest from public.messages;
  if v_count <> v_before.message_count or v_digest <> v_before.message_id_digest then
    raise exception 'chat_v2_a_message_identity_mismatch';
  end if;
  if exists (select 1 from public.messages where conversation_id is null) then
    raise exception 'chat_v2_a_orphan_message';
  end if;
  if (select count(*) from public.chat_message_receipts) <> v_before.message_count then
    raise exception 'chat_v2_a_receipt_backfill_mismatch';
  end if;
  if exists (
    select direct_user_a, direct_user_b from public.chat_conversations
    where conversation_type = 'direct' group by direct_user_a, direct_user_b having count(*) <> 1
  ) then raise exception 'chat_v2_a_duplicate_direct_conversation'; end if;
  if exists (
    select c.id from public.chat_conversations c
    left join public.chat_conversation_members member on member.conversation_id = c.id and member.is_active
    where c.conversation_type = 'direct' group by c.id having count(member.user_id) <> 2
  ) then raise exception 'chat_v2_a_direct_membership_mismatch'; end if;

  if v_before.premium_link_count is not null then
    execute 'select count(*) from public.premium_dm_payments where message_id is not null' into v_compare;
    if v_compare <> v_before.premium_link_count then raise exception 'chat_v2_a_premium_link_mismatch'; end if;
    execute 'select count(*) from public.premium_dm_payments payment left join public.messages message on message.id = payment.message_id where payment.message_id is not null and message.id is null' into v_compare;
    if v_compare <> 0 then raise exception 'chat_v2_a_premium_orphan'; end if;
  end if;
  if v_before.push_outbox_count is not null then
    execute 'select count(*) from public.message_push_outbox' into v_compare;
    if v_compare <> v_before.push_outbox_count then raise exception 'chat_v2_a_push_outbox_mismatch'; end if;
  end if;
  if v_before.push_delivery_count is not null then
    execute 'select count(*) from public.message_push_deliveries' into v_compare;
    if v_compare <> v_before.push_delivery_count then raise exception 'chat_v2_a_push_delivery_mismatch'; end if;
  end if;
end;
$$;

comment on column public.messages.recipient_id is
  'Temporary direct-message compatibility column. CHAT-V2-B must update group push/read consumers before allowing NULL for group messages.';
comment on column public.chat_message_receipts.legacy_read is
  'True when only the historical messages.read boolean is known; no read timestamp was invented during backfill.';
comment on function public.chat_prepare_legacy_message() is
  'Temporary one-way compatibility adapter for legacy direct inserts. Remove after all supported clients use chat_send_message.';

commit;


-- SOURCE: 20260907012906_chat_v2_c_private_media_one_time.sql
alter table public.chat_message_receipts
  add column media_consumed_at timestamptz;

comment on column public.chat_message_receipts.media_consumed_at is
  'Server timestamp of the successful one-time media claim for this recipient. NULL means unconsumed.';

create index chat_message_receipts_consumed_idx
  on public.chat_message_receipts (message_id, user_id, media_consumed_at)
  where media_consumed_at is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_media_asset_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_media_asset_id_fkey
      foreign key (media_asset_id) references public.media_assets(id) on delete restrict
      not valid;
    alter table public.messages validate constraint messages_media_asset_id_fkey;
  end if;
end;
$$;

alter table public.messages
  add constraint messages_one_time_media_consistency_check check (
    (message_type = 'one_time_image'
      and consumption_policy = 'one_time'
      and media_asset_id is not null
      and media_url is null)
    or
    (message_type <> 'one_time_image' and consumption_policy = 'standard')
  );

create unique index chat_message_asset_unique
  on public.media_asset_links (asset_id)
  where entity_type = 'chat_message';

create unique index chat_message_content_unique
  on public.media_asset_links (entity_id)
  where entity_type = 'chat_message' and slot = 'content';



-- SOURCE: 20260907030000_chat_v2_d_voice_notes.sql
alter table public.messages
  add column audio_waveform smallint[];

alter table public.messages
  add constraint messages_voice_contract_check check (
    (
      message_type = 'voice'
      and media_type = 'voice'
      and consumption_policy = 'standard'
      and media_asset_id is not null
      and media_url is null
      and audio_duration_ms between 1 and 3600000
      and array_length(audio_waveform, 1) = 48
      and array_position(audio_waveform, null) is null
      and 0 <= all(audio_waveform)
      and 100 >= all(audio_waveform)
    )
    or (
      message_type <> 'voice'
      and audio_duration_ms is null
      and audio_waveform is null
    )
  );



-- SOURCE: 20260907043715_chat_v2_e_groups.sql
alter table public.messages alter column recipient_id drop not null;

create unique index chat_group_one_active_owner_uidx
  on public.chat_conversation_members(conversation_id)
  where is_active and role = 'owner';

create index chat_group_members_active_joined_idx
  on public.chat_conversation_members(conversation_id, joined_at, user_id)
  where is_active;

create or replace function public.chat_can_read_message(p_conversation_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.chat_conversation_members cm
    join public.chat_conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = (select auth.uid()) and cm.is_active
      and (c.conversation_type = 'direct' or p_created_at >= cm.joined_at)
  );
$$;
revoke all on function public.chat_can_read_message(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_can_read_message(uuid, timestamptz) to authenticated, service_role;

create or replace function public.chat_enforce_group_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare v_id uuid := coalesce(new.conversation_id, old.conversation_id); v_count integer;
begin
  if exists (select 1 from public.chat_conversations c where c.id=v_id and c.conversation_type='group' and c.status='active') then
    select count(*) into v_count from public.chat_conversation_members
    where conversation_id=v_id and is_active and role='owner';
    if v_count <> 1 then raise exception 'chat_group_owner_invariant'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.chat_enforce_group_owner() from public, anon, authenticated;
create constraint trigger chat_group_owner_member_guard
after insert or update or delete on public.chat_conversation_members
deferrable initially deferred for each row execute function public.chat_enforce_group_owner();

create or replace function public.chat_enforce_group_conversation_owner()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  if new.conversation_type='group' and new.status='active' then
    select count(*) into v_count from public.chat_conversation_members
    where conversation_id=new.id and is_active and role='owner';
    if v_count <> 1 then raise exception 'chat_group_owner_invariant'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.chat_enforce_group_conversation_owner() from public, anon, authenticated;
create constraint trigger chat_group_owner_conversation_guard
after insert or update of status on public.chat_conversations
deferrable initially deferred for each row execute function public.chat_enforce_group_conversation_owner();



-- FUNCTION SOURCE: 20260907043715_chat_v2_e_groups.sql
create or replace function public.chat_after_message_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.chat_conversations set last_activity_at=greatest(last_activity_at,new.created_at) where id=new.conversation_id;
 insert into public.chat_message_receipts(message_id,user_id,created_at)
 select new.id,cm.user_id,new.created_at from public.chat_conversation_members cm
 where cm.conversation_id=new.conversation_id and cm.is_active and cm.user_id<>new.sender_id
   and (new.recipient_id is null or cm.user_id=new.recipient_id)
 on conflict(message_id,user_id) do nothing;
 if new.media_asset_id is not null then
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(new.media_asset_id,'chat_message',new.id,'content',0);
 end if;
 return new;
end; $$;

-- FUNCTION SOURCE: 20260907043715_chat_v2_e_groups.sql
create or replace function public.chat_sync_legacy_read()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid());
begin
 if old.read and not new.read then raise exception 'chat_read_state_cannot_regress'; end if;
 if new.recipient_id is null and new.read is distinct from old.read then raise exception 'chat_group_legacy_read_forbidden'; end if;
 if v_actor is not null and new.recipient_id<>v_actor then raise exception 'chat_receipt_identity_mismatch'; end if;
 if not old.read and new.read then
  insert into public.chat_message_receipts(message_id,user_id,delivered_at,read_at,created_at,updated_at)
  values(new.id,new.recipient_id,now(),now(),new.created_at,now()) on conflict(message_id,user_id) do update
  set delivered_at=coalesce(public.chat_message_receipts.delivered_at,excluded.delivered_at),read_at=coalesce(public.chat_message_receipts.read_at,excluded.read_at),legacy_delivered=false,legacy_read=false;
 end if; return new;
end; $$;

-- FUNCTION SOURCE: 20260908061603_chat_v2_h_f1_legacy_video_trigger_alignment.sql
create or replace function public.chat_prepare_legacy_message()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
  v_asset public.media_assets%rowtype;
  v_conversation public.chat_conversations%rowtype;
begin
  if v_actor is not null and new.sender_id <> v_actor then raise exception 'chat_sender_identity_mismatch'; end if;
  if new.sender_id is null then raise exception 'chat_sender_required'; end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm', 'one_time_image', 'voice') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(new.text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if new.media_type in ('image', 'video') and nullif(btrim(coalesce(new.media_url, '')), '') is null and new.media_asset_id is null then raise exception 'chat_media_required'; end if;
  if new.media_type = 'video' and (new.media_asset_id is null or new.media_url is not null) then raise exception 'chat_video_private_asset_required'; end if;
  if new.media_type = 'one_time_image' and (new.media_asset_id is null or new.media_url is not null) then raise exception 'chat_one_time_private_asset_required'; end if;
  if new.media_type = 'voice' and (
    new.media_asset_id is null or new.media_url is not null
    or new.audio_duration_ms is null or new.audio_duration_ms not between 1 and 3600000
    or array_length(new.audio_waveform, 1) is distinct from 48
    or array_position(new.audio_waveform, null) is not null
    or not (0 <= all(new.audio_waveform) and 100 >= all(new.audio_waveform))
  ) then raise exception 'chat_voice_contract_invalid'; end if;
  if new.media_type <> 'voice' and (new.audio_duration_ms is not null or new.audio_waveform is not null) then raise exception 'chat_audio_metadata_not_allowed'; end if;
  if new.media_asset_id is not null then
    select * into v_asset from public.media_assets where id = new.media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> new.sender_id or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2' or v_asset.public_url is not null then raise exception 'chat_media_asset_invalid'; end if;
    if new.media_type = 'voice' then
      if v_asset.media_kind <> 'audio' or v_asset.purpose <> 'voice_note' then raise exception 'chat_voice_asset_invalid'; end if;
    elsif new.media_type in ('image', 'one_time_image') then
      if v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image' then raise exception 'chat_media_asset_invalid'; end if;
    elsif new.media_type = 'video' then
      if v_asset.media_kind <> 'video' or v_asset.purpose <> 'chat_video' then raise exception 'chat_video_asset_invalid'; end if;
    else raise exception 'chat_private_media_contract_invalid'; end if;
    if new.media_url is not null then raise exception 'chat_private_media_contract_invalid'; end if;
    if exists (select 1 from public.media_asset_links l where l.asset_id = new.media_asset_id) then raise exception 'chat_media_asset_already_linked'; end if;
  end if;
  if v_actor is not null then new.read := false; end if;

  if new.conversation_id is not null then select * into v_conversation from public.chat_conversations where id = new.conversation_id; end if;
  if v_conversation.conversation_type = 'group' then
    if v_conversation.status <> 'active' then raise exception 'chat_conversation_unavailable'; end if;
    if new.recipient_id is not null then raise exception 'chat_group_recipient_must_be_null'; end if;
    if new.media_type not in ('text', 'image', 'video', 'voice') then raise exception 'chat_group_message_type_invalid'; end if;
    if not exists (select 1 from public.chat_conversation_members cm where cm.conversation_id = new.conversation_id and cm.user_id = new.sender_id and cm.is_active) then raise exception 'chat_membership_required'; end if;
  else
    if new.recipient_id is null or new.sender_id = new.recipient_id then raise exception 'chat_direct_participants_invalid'; end if;
    v_a := case when new.sender_id::text < new.recipient_id::text then new.sender_id else new.recipient_id end;
    v_b := case when new.sender_id::text < new.recipient_id::text then new.recipient_id else new.sender_id end;
    if new.conversation_id is null then
      insert into public.chat_conversations (conversation_type, created_by, direct_user_a, direct_user_b)
      values ('direct', new.sender_id, v_a, v_b)
      on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct' do nothing
      returning id into new.conversation_id;
      if new.conversation_id is null then select id into new.conversation_id from public.chat_conversations where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b; end if;
    end if;
    if not exists (select 1 from public.chat_conversations c where c.id = new.conversation_id and c.conversation_type = 'direct' and c.status = 'active' and c.direct_user_a = v_a and c.direct_user_b = v_b) then raise exception 'chat_message_conversation_mismatch'; end if;
    insert into public.chat_conversation_members (conversation_id, user_id, role)
    values (new.conversation_id, v_a, 'member'), (new.conversation_id, v_b, 'member')
    on conflict (conversation_id, user_id) do nothing;
  end if;
  new.client_message_id := coalesce(new.client_message_id, new.id, gen_random_uuid());
  new.message_type := coalesce(new.message_type, new.media_type);
  new.consumption_policy := case when new.message_type = 'one_time_image' then 'one_time' else 'standard' end;
  return new;
end;
$function$;

-- SOURCE: 20260907030000_chat_v2_d_voice_notes.sql
drop function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid);



-- FUNCTION SOURCE: 20260908040726_chat_v2_h_video_inbox_truth.sql
create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_text text default ''::text,
  p_message_type text default 'text'::text,
  p_media_url text default null::text,
  p_media_asset_id uuid default null::uuid,
  p_reply_to_message_id uuid default null::uuid,
  p_audio_duration_ms integer default null::integer,
  p_audio_waveform smallint[] default null::smallint[]
)
returns public.messages
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_c public.chat_conversations%rowtype;
  v_recipient uuid;
  v_allow text;
  v_asset public.media_assets%rowtype;
  v_existing public.messages%rowtype;
  v_result public.messages%rowtype;
  v_policy text := case when p_message_type = 'one_time_image' then 'one_time' else 'standard' end;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_client_message_id is null then raise exception 'chat_idempotency_key_required'; end if;

  select * into v_c from public.chat_conversations where id = p_conversation_id and status = 'active';
  if v_c.id is null then raise exception 'chat_conversation_unavailable'; end if;
  if not exists (
    select 1 from public.chat_conversation_members
    where conversation_id = p_conversation_id and user_id = v_actor and is_active
  ) then raise exception 'chat_membership_required'; end if;

  if v_c.conversation_type = 'direct' then
    v_recipient := case when v_c.direct_user_a = v_actor then v_c.direct_user_b else v_c.direct_user_a end;
    if v_recipient is null or v_recipient = v_actor then raise exception 'chat_recipient_invalid'; end if;
    if exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = v_actor and b.blocked_id = v_recipient)
         or (b.blocker_id = v_recipient and b.blocked_id = v_actor)
    ) then raise exception 'chat_interaction_blocked'; end if;
    select coalesce(allow_messages_from, 'everyone') into v_allow from public.user_profiles where id = v_recipient;
    if v_allow = 'nobody' then raise exception 'chat_recipient_messages_disabled'; end if;
    if v_allow = 'followers' and not exists (
      select 1 from public.follows where follower_id = v_actor and following_id = v_recipient
    ) then raise exception 'chat_recipient_followers_only'; end if;
  elsif v_c.conversation_type = 'group' then
    v_recipient := null;
    if p_message_type not in ('text', 'image', 'video', 'voice') then raise exception 'chat_group_message_type_invalid'; end if;
  else
    raise exception 'chat_conversation_type_invalid';
  end if;

  if p_message_type not in ('text', 'image', 'video', 'one_time_image', 'voice') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(p_text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if p_message_type = 'text' and length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if p_message_type = 'image' and nullif(btrim(coalesce(p_media_url, '')), '') is null and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
  if p_message_type = 'video' and (p_media_asset_id is null or p_media_url is not null) then raise exception 'chat_video_private_asset_required'; end if;
  if p_message_type = 'one_time_image' and (v_c.conversation_type <> 'direct' or p_media_asset_id is null or p_media_url is not null) then raise exception 'chat_one_time_private_asset_required'; end if;
  if p_message_type = 'voice' and (
    p_media_asset_id is null or p_media_url is not null or p_audio_duration_ms is null
    or p_audio_duration_ms not between 1 and 3600000
    or array_length(p_audio_waveform, 1) is distinct from 48
    or array_position(p_audio_waveform, null) is not null
    or not (0 <= all(p_audio_waveform) and 100 >= all(p_audio_waveform))
  ) then raise exception 'chat_voice_contract_invalid'; end if;
  if p_message_type <> 'voice' and (p_audio_duration_ms is not null or p_audio_waveform is not null) then raise exception 'chat_audio_metadata_not_allowed'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to_message_id and m.conversation_id = p_conversation_id
      and public.chat_can_read_message(m.conversation_id, m.created_at)
  ) then raise exception 'chat_reply_target_invalid'; end if;

  select * into v_existing from public.messages where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.message_type <> p_message_type
      or v_existing.consumption_policy <> v_policy
      or v_existing.text <> coalesce(p_text, '')
      or v_existing.media_url is distinct from p_media_url
      or v_existing.media_asset_id is distinct from p_media_asset_id
      or v_existing.reply_to_message_id is distinct from p_reply_to_message_id
      or v_existing.audio_duration_ms is distinct from p_audio_duration_ms
      or v_existing.audio_waveform is distinct from p_audio_waveform
    then raise exception 'chat_idempotency_conflict'; end if;
    return v_existing;
  end if;

  if p_media_asset_id is not null then
    select * into v_asset from public.media_assets where id = p_media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> v_actor or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2' or v_asset.public_url is not null
      or exists (select 1 from public.media_asset_links where asset_id = p_media_asset_id)
    then raise exception 'chat_media_asset_invalid'; end if;
    if p_message_type = 'voice' and (v_asset.media_kind <> 'audio' or v_asset.purpose <> 'voice_note') then raise exception 'chat_voice_asset_invalid'; end if;
    if p_message_type in ('image', 'one_time_image') and (v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image') then raise exception 'chat_media_asset_invalid'; end if;
    if p_message_type = 'video' and (v_asset.media_kind <> 'video' or v_asset.purpose <> 'chat_video') then raise exception 'chat_video_asset_invalid'; end if;
  end if;

  insert into public.messages (
    sender_id, recipient_id, conversation_id, client_message_id, text, media_url, media_type,
    message_type, media_asset_id, consumption_policy, reply_to_message_id,
    audio_duration_ms, audio_waveform, read
  ) values (
    v_actor, v_recipient, p_conversation_id, p_client_message_id, coalesce(p_text, ''), p_media_url,
    p_message_type, p_message_type, p_media_asset_id, v_policy, p_reply_to_message_id,
    p_audio_duration_ms, p_audio_waveform, false
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  select * into v_result from public.messages where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_result.id is null then raise; end if;
  if v_result.conversation_id <> p_conversation_id
    or v_result.message_type <> p_message_type
    or v_result.consumption_policy <> v_policy
    or v_result.text <> coalesce(p_text, '')
    or v_result.media_url is distinct from p_media_url
    or v_result.media_asset_id is distinct from p_media_asset_id
    or v_result.reply_to_message_id is distinct from p_reply_to_message_id
    or v_result.audio_duration_ms is distinct from p_audio_duration_ms
    or v_result.audio_waveform is distinct from p_audio_waveform
  then raise exception 'chat_idempotency_conflict'; end if;
  return v_result;
end;
$function$;

-- SOURCE: 20260907043715_chat_v2_e_groups.sql
drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant on public.messages for select to authenticated using(public.chat_can_read_message(conversation_id,created_at));
drop policy if exists chat_message_receipts_member_select on public.chat_message_receipts;
create policy chat_message_receipts_member_select on public.chat_message_receipts for select to authenticated using(
 user_id=(select auth.uid())or exists(select 1 from public.messages m where m.id=chat_message_receipts.message_id and m.sender_id=(select auth.uid())));



-- FUNCTION SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
create or replace function public.reply_to_story(p_story_id uuid,p_client_message_id uuid,p_text text)
returns public.messages
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_expires_at timestamptz;
  v_body text:=btrim(coalesce(p_text,''));v_conversation public.chat_conversations;v_message public.messages;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or p_client_message_id is null then
    raise exception using errcode='22023',message='invalid_story_reply';end if;
  if v_body='' or char_length(v_body)>4975 then
    raise exception using errcode='22023',message='invalid_story_reply';end if;
  select s.user_id,s.expires_at into v_owner,v_expires_at from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id) for share;
  if v_owner is null or v_expires_at<=now() then raise exception using errcode='42501',message='story_not_available';end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_reply';end if;
  if not private.story_can_view_owner(v_owner) then raise exception using errcode='42501',message='story_not_visible';end if;
  select * into v_conversation from public.chat_get_or_create_direct(v_owner);
  select * into v_message from public.chat_send_message(v_conversation.id,p_client_message_id,
    'Respondió a tu historia'||E'\n'||v_body,'text',null,null,null,null,null);
  return v_message;
end;
$$;

-- SOURCE: 20260911200240_superuser_a5_content_stories_chat_moderation.sql
alter table public.reports drop constraint reports_reported_content_type_check;
alter table public.reports add constraint reports_reported_content_type_check
  check(reported_content_type in('video','comment','user','story','message'));
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated
with check(
  reporter_user_id=auth.uid()
  and reported_content_type in('video','comment','user')
);

create function public.report_story(
  p_story_id uuid,p_reason text,p_details text default null
) returns uuid
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_reason text:=nullif(btrim(p_reason),'');
  v_details text:=nullif(btrim(p_details),'');v_story public.stories;v_id uuid;
begin
  if v_actor is null then raise exception using errcode='28000',message='authentication_required';end if;
  if p_story_id is null or v_reason is null or char_length(v_reason) not between 2 and 120
     or (v_details is not null and char_length(v_details)>1000) then
    raise exception using errcode='22023',message='story_report_invalid';end if;
  select * into v_story from public.stories where id=p_story_id;
  if not found or v_story.expires_at<=now()
     or not private.admin_content_is_visible('story',v_story.id)
     or not private.story_can_view_owner(v_story.user_id) then
    raise exception using errcode='42501',message='story_not_visible';end if;
  if v_story.user_id=v_actor then
    raise exception using errcode='42501',message='story_self_report_forbidden';end if;
  insert into public.reports(reporter_user_id,reported_content_id,reported_content_type,reason,details)
  values(v_actor,v_story.id,'story',v_reason,v_details) returning id into v_id;
  return v_id;
end;
$$;



-- SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create table private.admin_roles(
  role_code text primary key,
  display_name text not null,
  description text not null,
  is_assignable boolean not null,
  is_root boolean not null,
  is_exclusive boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_roles_code_check check(role_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint admin_roles_root_check check(not is_root or(not is_assignable and is_exclusive))
);



-- SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create table private.admin_role_capabilities(
  role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  capability_code text not null references private.admin_capabilities(capability_code) on update restrict on delete restrict,
  primary key(role_code,capability_code)
);

create table private.admin_role_grant_rules(
  actor_role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  target_role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  can_assign boolean not null,
  can_revoke boolean not null,
  primary key(actor_role_code,target_role_code),
  constraint admin_role_grant_rules_nonempty_check check(can_assign or can_revoke),
  constraint admin_role_grant_rules_no_self_check check(actor_role_code<>target_role_code),
  constraint admin_role_grant_rules_no_root_target_check check(target_role_code<>'SUPER_ADMIN')
);

create table private.admin_user_roles(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on update restrict on delete restrict,
  role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  grant_actor_kind text not null,
  granted_by_user_id uuid references auth.users(id) on update restrict on delete restrict,
  grant_operator_reference text,
  granted_at timestamptz not null default clock_timestamp(),
  grant_reason text not null,
  revoke_actor_kind text,
  revoked_by_user_id uuid references auth.users(id) on update restrict on delete restrict,
  revoke_operator_reference text,
  revoked_at timestamptz,
  revoke_reason text,
  version bigint not null default 1,
  constraint admin_user_roles_grant_actor_kind_check check(grant_actor_kind in('human_admin','trusted_operator')),
  constraint admin_user_roles_revoke_actor_kind_check check(revoke_actor_kind is null or revoke_actor_kind in('human_admin','trusted_operator')),
  constraint admin_user_roles_grant_provenance_check check(
    (grant_actor_kind='human_admin' and granted_by_user_id is not null and grant_operator_reference is null)
    or
    (grant_actor_kind='trusted_operator' and granted_by_user_id is null and grant_operator_reference is not null)
  ),
  constraint admin_user_roles_revoke_provenance_check check(
    (revoked_at is null and revoke_actor_kind is null and revoked_by_user_id is null
      and revoke_operator_reference is null and revoke_reason is null)
    or
    (revoked_at is not null and revoke_actor_kind='human_admin' and revoked_by_user_id is not null
      and revoke_operator_reference is null and revoke_reason is not null)
    or
    (revoked_at is not null and revoke_actor_kind='trusted_operator' and revoked_by_user_id is null
      and revoke_operator_reference is not null and revoke_reason is not null)
  ),
  constraint admin_user_roles_grant_reason_check check(grant_reason=btrim(grant_reason) and char_length(grant_reason) between 2 and 500),
  constraint admin_user_roles_revoke_reason_check check(revoke_reason is null or(revoke_reason=btrim(revoke_reason) and char_length(revoke_reason) between 2 and 500)),
  constraint admin_user_roles_grant_operator_check check(grant_operator_reference is null or(grant_operator_reference=btrim(grant_operator_reference) and char_length(grant_operator_reference) between 8 and 200)),
  constraint admin_user_roles_revoke_operator_check check(revoke_operator_reference is null or(revoke_operator_reference=btrim(revoke_operator_reference) and char_length(revoke_operator_reference) between 8 and 200)),
  constraint admin_user_roles_version_check check(version>0)
);

create unique index admin_user_roles_active_uidx
  on private.admin_user_roles(user_id,role_code)
  where revoked_at is null;
create index admin_user_roles_user_active_idx
  on private.admin_user_roles(user_id,granted_at,id)
  where revoked_at is null;

insert into private.admin_roles(role_code,display_name,description,is_assignable,is_root,is_exclusive) values
('SUPER_ADMIN','Super Admin','Root application authority; never database superuser.',false,true,true),
('PLATFORM_ADMIN','Platform Admin','Broad non-root platform operations without finance audit or dispute resolution.',true,false,true),
('MODERATOR','Moderator','Cross-domain safety and moderation authority.',true,false,false),
('SUPPORT','Support','Bounded customer support and case triage authority.',true,false,false),
('MARKETPLACE_ADMIN','Marketplace Admin','Canonical Marketplace administration and dispute workflow authority.',true,false,true),
('FINANCE_AUDITOR','Finance Auditor','Read-only financial investigation and reconciliation authority.',true,false,true);

insert into private.admin_capabilities(capability_code,domain,effect,description,is_sensitive) values
('admin.shell.access','admin','read','Access the global admin shell.',false),
('admin.roles.read','admin','read','Read canonical role assignments.',true),
('admin.roles.assign','admin','write','Assign permitted non-root roles.',true),
('admin.roles.revoke','admin','write','Revoke permitted non-root roles.',true),
('admin.audit.read','admin','read','Read non-financial platform administration audit.',true),
('users.accounts.read','users','read','Read bounded user administration projections.',true),
('users.accounts.moderate','users','write','Perform bounded user moderation.',true),
('users.accounts.suspend','users','write','Suspend an account through its canonical workflow.',true),
('users.accounts.restore','users','write','Restore an account through its canonical workflow.',true),
('reports.cases.read','reports','read','Read report cases.',true),
('reports.cases.review','reports','write','Review report cases.',true),
('reports.cases.resolve','reports','write','Resolve report cases.',true),
('content.items.read','content','read','Read content administration projections.',false),
('content.items.moderate','content','write','Moderate content.',true),
('content.items.hide','content','write','Hide content through a canonical workflow.',true),
('content.items.restore','content','write','Restore hidden content.',true),
('stories.items.read','stories','read','Read Stories administration projections.',false),
('stories.items.moderate','stories','write','Moderate Stories.',true),
('chat.abuse_reports.read','chat','read','Read case-bounded Chat abuse context.',true),
('chat.abuse_reports.moderate','chat','write','Moderate Chat abuse cases.',true),
('live.sessions.read','live','read','Read LIVE administration projections.',false),
('live.sessions.moderate','live','write','Moderate LIVE sessions.',true),
('live.sessions.terminate','live','write','Terminate LIVE sessions through a canonical workflow.',true),
('battles.sessions.read','battles','read','Read Battle administration projections.',false),
('battles.sessions.moderate','battles','write','Moderate Battles.',true),
('marketplace.overview.read','marketplace','read','Read Marketplace overview.',false),
('marketplace.orders.read','marketplace','read','Read Marketplace orders.',true),
('marketplace.sellers.read','marketplace','read','Read Marketplace sellers.',true),
('marketplace.sellers.moderate','marketplace','write','Moderate Marketplace sellers.',true),
('marketplace.products.read','marketplace','read','Read Marketplace products.',false),
('marketplace.products.moderate','marketplace','write','Moderate Marketplace products.',true),
('marketplace.disputes.read','marketplace','read','Read Marketplace disputes.',true),
('marketplace.disputes.resolve','marketplace','workflow','Invoke the canonical Marketplace dispute workflow.',true),
('marketplace.promotions.read','marketplace','read','Read Marketplace promotions.',false),
('marketplace.ads.read','marketplace','read','Read Marketplace advertising.',true),
('marketplace.creators.read','marketplace','read','Read creator commerce projections.',true),
('marketplace.health.read','marketplace','read','Read Marketplace health.',false),
('marketplace.audit.read','marketplace','read','Read capability-scoped Marketplace audit.',true),
('finance.ledger.read','finance','read','Read bounded ledger projections.',true),
('finance.reconciliation.read','finance','read','Read reconciliation projections.',true),
('finance.anomalies.read','finance','read','Read financial anomaly projections.',true),
('finance.audit.read','finance','read','Read redacted financial audit.',true),
('system.health.read','system','read','Read system health.',false),
('system.jobs.read','system','read','Read jobs and cron status.',false),
('system.audit.read','system','read','Read system and security audit.',true),
('media.assets.read','media','read','Read media administration projections.',true),
('media.assets.moderate','media','write','Moderate media assets.',true);

insert into private.admin_role_capabilities(role_code,capability_code)
select 'SUPER_ADMIN',capability_code from private.admin_capabilities;

insert into private.admin_role_capabilities(role_code,capability_code)
select 'PLATFORM_ADMIN',capability_code from private.admin_capabilities
where capability_code not in(
  'marketplace.disputes.resolve','finance.ledger.read','finance.reconciliation.read',
  'finance.anomalies.read','finance.audit.read');

insert into private.admin_role_capabilities(role_code,capability_code) values
('MODERATOR','admin.shell.access'),
('MODERATOR','users.accounts.read'),('MODERATOR','users.accounts.moderate'),
('MODERATOR','users.accounts.suspend'),('MODERATOR','users.accounts.restore'),
('MODERATOR','reports.cases.read'),('MODERATOR','reports.cases.review'),('MODERATOR','reports.cases.resolve'),
('MODERATOR','content.items.read'),('MODERATOR','content.items.moderate'),
('MODERATOR','content.items.hide'),('MODERATOR','content.items.restore'),
('MODERATOR','stories.items.read'),('MODERATOR','stories.items.moderate'),
('MODERATOR','chat.abuse_reports.read'),('MODERATOR','chat.abuse_reports.moderate'),
('MODERATOR','live.sessions.read'),('MODERATOR','live.sessions.moderate'),('MODERATOR','live.sessions.terminate'),
('MODERATOR','battles.sessions.read'),('MODERATOR','battles.sessions.moderate'),
('MODERATOR','media.assets.read'),('MODERATOR','media.assets.moderate'),
('SUPPORT','admin.shell.access'),('SUPPORT','users.accounts.read'),
('SUPPORT','reports.cases.read'),('SUPPORT','reports.cases.review'),
('SUPPORT','marketplace.orders.read'),('SUPPORT','marketplace.disputes.read'),
('MARKETPLACE_ADMIN','admin.shell.access'),
('MARKETPLACE_ADMIN','marketplace.overview.read'),('MARKETPLACE_ADMIN','marketplace.orders.read'),
('MARKETPLACE_ADMIN','marketplace.sellers.read'),('MARKETPLACE_ADMIN','marketplace.sellers.moderate'),
('MARKETPLACE_ADMIN','marketplace.products.read'),('MARKETPLACE_ADMIN','marketplace.products.moderate'),
('MARKETPLACE_ADMIN','marketplace.disputes.read'),('MARKETPLACE_ADMIN','marketplace.disputes.resolve'),
('MARKETPLACE_ADMIN','marketplace.promotions.read'),('MARKETPLACE_ADMIN','marketplace.ads.read'),
('MARKETPLACE_ADMIN','marketplace.creators.read'),('MARKETPLACE_ADMIN','marketplace.health.read'),
('MARKETPLACE_ADMIN','marketplace.audit.read'),
('FINANCE_AUDITOR','admin.shell.access'),('FINANCE_AUDITOR','marketplace.orders.read'),
('FINANCE_AUDITOR','marketplace.disputes.read'),('FINANCE_AUDITOR','marketplace.health.read'),
('FINANCE_AUDITOR','marketplace.audit.read'),('FINANCE_AUDITOR','finance.ledger.read'),
('FINANCE_AUDITOR','finance.reconciliation.read'),('FINANCE_AUDITOR','finance.anomalies.read'),
('FINANCE_AUDITOR','finance.audit.read'),('FINANCE_AUDITOR','system.health.read');

insert into private.admin_role_grant_rules(actor_role_code,target_role_code,can_assign,can_revoke) values
('SUPER_ADMIN','PLATFORM_ADMIN',true,true),
('SUPER_ADMIN','MODERATOR',true,true),
('SUPER_ADMIN','SUPPORT',true,true),
('SUPER_ADMIN','MARKETPLACE_ADMIN',true,true),
('SUPER_ADMIN','FINANCE_AUDITOR',true,true),
('PLATFORM_ADMIN','MODERATOR',true,true),
('PLATFORM_ADMIN','SUPPORT',true,true);

alter table private.admin_roles enable row level security;
alter table private.admin_capabilities enable row level security;
alter table private.admin_role_capabilities enable row level security;
alter table private.admin_role_grant_rules enable row level security;
alter table private.admin_user_roles enable row level security;

revoke all privileges on table private.admin_roles from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_capabilities from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_role_capabilities from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_role_grant_rules from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_user_roles from public,anon,authenticated,service_role;
revoke all on schema private from public,anon,authenticated,service_role;



-- SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create function private.admin_active_role_codes(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select coalesce(array_agg(role_code order by role_code),'{}'::text[])
  from private.admin_user_roles
  where user_id=p_user_id and revoked_at is null;
$$;

create function private.admin_role_set_is_valid(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  with normalized as(
    select coalesce(array_agg(distinct role_code order by role_code),'{}'::text[]) roles
    from unnest(coalesce(p_roles,'{}'::text[])) role_code
  )
  select cardinality(roles)<=1 or roles=array['MODERATOR','SUPPORT']::text[]
  from normalized;
$$;

create function private.admin_effective_capabilities(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_roles text[];
begin
  v_roles:=private.admin_active_role_codes(p_user_id);
  if not private.admin_role_set_is_valid(v_roles) then return '{}'::text[];end if;
  return coalesce((
    select array_agg(distinct rc.capability_code order by rc.capability_code)
    from private.admin_role_capabilities rc
    where rc.role_code=any(v_roles)
  ),'{}'::text[]);
end;
$$;

create function private.admin_authority_version(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select encode(extensions.digest(coalesce(string_agg(
    id::text||':'||role_code||':'||version::text,'|' order by role_code,id
  ),''),'sha256'),'hex')
  from private.admin_user_roles
  where user_id=p_user_id and revoked_at is null;
$$;

create function private.admin_request_fingerprint(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path to 'pg_catalog','private','public'
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;

create function private.admin_guard_user_role_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='admin_user_roles_delete_forbidden';
  end if;
  if (new.id,new.user_id,new.role_code,new.grant_actor_kind,new.granted_by_user_id,
      new.grant_operator_reference,new.granted_at,new.grant_reason)
     is distinct from
     (old.id,old.user_id,old.role_code,old.grant_actor_kind,old.granted_by_user_id,
      old.grant_operator_reference,old.granted_at,old.grant_reason) then
    raise exception using errcode='42501',message='admin_user_roles_grant_immutable';
  end if;
  if old.revoked_at is not null or new.revoked_at is null or new.version<>old.version+1 then
    raise exception using errcode='42501',message='admin_user_roles_invalid_transition';
  end if;
  return new;
end;
$$;

create trigger admin_user_roles_guard
before update or delete on private.admin_user_roles
for each row execute function private.admin_guard_user_role_mutation();

revoke all on function private.admin_active_role_codes(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_role_set_is_valid(text[]) from public,anon,authenticated,service_role;
revoke all on function private.admin_effective_capabilities(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_authority_version(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_request_fingerprint(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.admin_guard_user_role_mutation() from public,anon,authenticated,service_role;



-- FUNCTION SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create function public.admin_actor_has_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];
begin
  if v_actor is null or p_capability is null then return false;end if;
  if not exists(select 1 from private.admin_capabilities where capability_code=p_capability) then return false;end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then return false;end if;
  return p_capability=any(private.admin_effective_capabilities(v_actor));
end;
$$;

-- FUNCTION SOURCE: 20260911162054_superuser_a3_canonical_authority_foundation.sql
create function public.admin_require_capability(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];
begin
  if v_actor is null then raise exception using errcode='28000',message='admin_auth_required';end if;
  if p_capability is null or not exists(select 1 from private.admin_capabilities where capability_code=p_capability) then
    raise exception using errcode='22023',message='admin_capability_invalid';
  end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then
    raise exception using errcode='42501',message='admin_role_set_invalid';
  end if;
  if not p_capability=any(private.admin_effective_capabilities(v_actor)) then
    raise exception using errcode='42501',message='admin_capability_forbidden';
  end if;
  return v_actor;
end;
$$;

-- ACLs matching canonical A3/A5/Chat E signatures; omitted functions are not created.
REVOKE ALL ON FUNCTION public.admin_actor_has_capability(text),public.admin_require_capability(text) FROM public,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_actor_has_capability(text),public.admin_require_capability(text) TO authenticated;
REVOKE ALL ON FUNCTION public.reply_to_story(uuid,uuid,text),public.report_story(uuid,text,text) FROM public,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reply_to_story(uuid,uuid,text),public.report_story(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,uuid,uuid,integer,smallint[]) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,uuid,uuid,integer,smallint[]) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.chat_prepare_legacy_message(),public.chat_after_message_insert(),public.chat_sync_legacy_read() FROM public,anon,authenticated;
-- The canonical A3 schema revoke precedes A5's later private helper grants.
GRANT USAGE ON SCHEMA private TO anon,authenticated;

-- Task 3 reduced-schema authorities. These are structural test doubles for
-- the already-deployed Stream, MEDIA-C1 and Content Safety contracts; the B1
-- migration itself is still applied byte-for-byte by the SQL-real suite.
create table public.video_assets(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'cloudflare_stream',
  purpose text not null,
  visibility text not null default 'public' check(visibility in('public','private')),
  status text not null default 'pending' check(status in('pending','uploading','processing','ready','failed','delete_pending','deleted')),
  cloudflare_uid text unique,mime_type text not null,size_bytes bigint not null,
  original_filename text,max_duration_seconds integer not null default 60,
  duration_seconds numeric,width integer,height integer,hls_url text,dash_url text,
  thumbnail_url text,upload_expires_at timestamptz,provider_status text,
  provider_progress numeric,provider_metadata jsonb not null default '{}'::jsonb,
  error_code text,error_message text,last_provider_check_at timestamptz,ready_at timestamptz,
  delete_attempts integer not null default 0,next_cleanup_attempt_at timestamptz,
  deleted_at timestamptz,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),lifecycle_contract_version smallint,
  provider_absence_verified_at timestamptz,provider_absence_recheck_after timestamptz,
  post_delete_verification_attempts integer not null default 0,
  constraint video_assets_purpose_check check(purpose in('feed_video','business_library','creator_premium_video')),
  constraint video_assets_duration_limit_check check(
    (purpose='creator_premium_video' and max_duration_seconds between 1 and 180)
    or (purpose<>'creator_premium_video' and max_duration_seconds between 1 and 60)),
  constraint video_assets_creator_premium_contract_check check(
    purpose<>'creator_premium_video' or(provider='cloudflare_stream' and visibility='private'
      and mime_type in('video/mp4','video/quicktime','video/webm')
      and size_bytes between 1 and 200000000 and max_duration_seconds=180)),
  constraint video_assets_ready_invariants_check check(
    (status='ready' and cloudflare_uid is not null and ready_at is not null
      and duration_seconds is not null and duration_seconds>0
      and duration_seconds<=max_duration_seconds
      and ((purpose='creator_premium_video' and visibility='private' and hls_url is null
        and dash_url is null and thumbnail_url is null
        and provider_metadata->'require_signed_urls'='true'::jsonb)
        or(purpose<>'creator_premium_video' and hls_url is not null)))
    or(status<>'ready' and hls_url is null and dash_url is null and thumbnail_url is null))
);
create table public.video_asset_links(
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.video_assets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check(entity_type in('video_post','story','exclusive_content','ai_avatar')),
  entity_id uuid not null,slot text not null default 'video',
  position integer not null default 0 check(position>=0),created_at timestamptz not null default now(),
  unique(entity_type,entity_id,slot,position),unique(asset_id,entity_type,entity_id,slot,position)
);
alter table public.video_assets enable row level security;
alter table public.video_asset_links enable row level security;
revoke all on public.video_assets,public.video_asset_links from public,anon,authenticated;
grant select on public.video_assets,public.video_asset_links to authenticated;
grant all on public.video_assets,public.video_asset_links to service_role;

create function private.record_media_lifecycle_audit_v1(
  p_asset_id uuid,p_target_type text,p_provider text,p_operation text,p_attempt integer,
  p_provider_outcome text,p_provider_request_id text,p_audit_outcome text
) returns void language plpgsql security definer set search_path='' as $$ begin return; end $$;
create function private.schedule_video_asset_deletion_v1(
  p_asset_id uuid,p_owner_id uuid,p_required_purpose text default null
) returns text language plpgsql security definer set search_path='' as $$
declare v_asset public.video_assets;
begin
  select * into v_asset from public.video_assets where id=p_asset_id and owner_id=p_owner_id for update;
  if not found then return 'not_found';end if;
  if p_required_purpose is not null and v_asset.purpose<>p_required_purpose then return 'not_found';end if;
  if exists(select 1 from public.video_asset_links where asset_id=p_asset_id) then return 'asset_in_use';end if;
  if v_asset.status='deleted' then return 'deleted';end if;
  update public.video_assets set status='delete_pending',hls_url=null,dash_url=null,
    thumbnail_url=null,lifecycle_contract_version=1,delete_attempts=0,
    post_delete_verification_attempts=0,next_cleanup_attempt_at=pg_catalog.clock_timestamp(),
    updated_at=pg_catalog.clock_timestamp() where id=p_asset_id;
  return 'scheduled';
end $$;
create function public.schedule_video_asset_deletion_v1(p_asset_id uuid,p_owner_id uuid)
returns text language sql security definer set search_path='' as $$
  select private.schedule_video_asset_deletion_v1(p_asset_id,p_owner_id,null)
$$;
create function public.reserve_stream_upload_asset(
  p_asset_id uuid,p_owner_id uuid,p_mime_type text,p_size_bytes bigint,
  p_original_filename text,p_purpose text
) returns text language plpgsql security definer set search_path='' as $$ begin return 'legacy'; end $$;
create function public.cleanup_stale_creator_premium_video_records(p_limit integer default 50)
returns table(id uuid,cloudflare_uid text,purpose text,delete_attempts integer,
  operation text,failure_exhausts boolean)
language sql security definer set search_path='' as $$
  select null::uuid,null::text,null::text,null::integer,null::text,null::boolean where false
$$;

create table private.admin_user_warnings(
  id uuid primary key default gen_random_uuid(),target_user_id uuid not null,
  status text not null default 'active',issued_at timestamptz not null default now()
);
create table private.admin_user_moderation_actions(
  id uuid primary key default gen_random_uuid(),target_user_id uuid not null,
  action text not null,status text not null default 'succeeded',completed_at timestamptz
);
create table private.content_safety_scans(
  id uuid primary key default gen_random_uuid(),target_type text not null,target_id uuid not null,
  owner_user_id uuid not null,content_fingerprint text not null,media_source_scan_id uuid,
  status text not null default 'queued',requested_reason text not null,text_status text not null default 'analyzed',
  audio_status text not null default 'not_configured',visual_status text not null default 'not_configured',
  reports_status text not null default 'analyzed',attempt_count integer not null default 0,
  available_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,
  last_error_code text,audio_provider text,audio_model text,audio_source_asset_id uuid,
  audio_available_at timestamptz not null default now(),audio_last_error_code text,
  audio_attempt_count integer not null default 0,audio_started_at timestamptz,audio_completed_at timestamptz,
  audio_cleanup_pending boolean not null default false,audio_cleanup_attempt_count integer not null default 0,
  audio_cleanup_available_at timestamptz,audio_provider_call_count integer not null default 0,
  visual_provider text,visual_model text,visual_prompt_version text,visual_source_kind text,
  visual_video_asset_id uuid,visual_media_asset_id uuid,visual_analysis_id uuid,
  visual_frame_cursor integer not null default 0,visual_partial_result jsonb,
  visual_provider_call_count integer not null default 0,visual_attempt_count integer not null default 0,
  visual_available_at timestamptz not null default now(),visual_started_at timestamptz,
  visual_completed_at timestamptz,visual_last_error_code text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(target_type,target_id,content_fingerprint)
);
create table private.content_safety_audio_transcripts(
  id uuid primary key default gen_random_uuid(),source_scan_id uuid not null,
  source_asset_id uuid not null,source_content_fingerprint text not null,
  provider text not null,model text not null,detected_language text,transcript_text text not null,
  word_count integer not null,segments jsonb not null,no_speech boolean not null,
  transcript_fingerprint text not null,rule_eval_status text not null,
  rule_eval_available_at timestamptz,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_scan_id,source_content_fingerprint,provider,model)
);
create table private.content_safety_visual_analyses(
  id uuid primary key default gen_random_uuid(),source_scan_id uuid not null,
  video_asset_id uuid,media_asset_id uuid,source_content_fingerprint text not null,
  provider text not null,model text not null,prompt_version text not null,
  sample_strategy text not null,frame_count integer not null,frame_timestamps_ms integer[] not null,
  analysis_result jsonb not null,analysis_fingerprint text not null,
  provider_call_count integer not null,created_at timestamptz not null default now(),
  unique(video_asset_id,media_asset_id,provider,model,prompt_version)
);
create table private.content_safety_alerts(
  id uuid primary key default gen_random_uuid(),scan_id uuid,target_type text not null,
  target_id uuid not null,owner_user_id uuid not null,source_type text not null,
  rule_id uuid,category text,severity text,confidence numeric,priority_score integer,
  alert_fingerprint text not null unique,reach bigint,related_report_count integer,
  pending_report_count integer,reports_last_15m integer,latest_report_at timestamptz,
  active_warning_count integer,evidence jsonb,updated_at timestamptz not null default now()
);

create function private.content_safety_sha256(p_value text)
returns text language sql immutable set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_value,''),'UTF8')),'hex')
$$;
create function private.content_safety_priority(
  p_severity text,p_pending integer,p_recent integer,p_warnings integer,p_reach bigint
) returns integer language sql immutable set search_path='' as $$ select 1 $$;
create function private.content_safety_target_snapshot(p_target_type text,p_target_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_target_type='story' then pg_catalog.jsonb_build_object(
    'owner_user_id',s.user_id,'content_version',s.id::text,'shared_video_id',s.shared_video_id,'reach',0)
    else null end from public.stories s where s.id=p_target_id
$$;
create function private.content_safety_audio_source(p_target_type text,p_target_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('kind','not_configured','reason','fixture_core')
$$;
create function private.content_safety_visual_source(p_target_type text,p_target_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('kind','not_configured','reason','fixture_core')
$$;
create function private.enqueue_content_safety_scan(
  p_target_type text,p_target_id uuid,p_requested_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb;v_fingerprint text;v_id uuid;
begin
  v_snapshot:=private.content_safety_target_snapshot(p_target_type,p_target_id);
  if v_snapshot is null then return null;end if;
  v_fingerprint:=private.content_safety_sha256(p_target_type||'|'||p_target_id::text||'|'||coalesce(v_snapshot->>'content_version',''));
  insert into private.content_safety_scans(target_type,target_id,owner_user_id,content_fingerprint,
    requested_reason,text_status,audio_status,visual_status,reports_status)
  values(p_target_type,p_target_id,(v_snapshot->>'owner_user_id')::uuid,v_fingerprint,
    p_requested_reason,'analyzed','not_configured','not_configured','analyzed')
  on conflict(target_type,target_id,content_fingerprint) do update
    set requested_reason=excluded.requested_reason,updated_at=pg_catalog.clock_timestamp()
  returning id into v_id;
  return v_id;
end $$;
create function public.claim_content_safety_audio_scans(p_limit integer default 1)
returns jsonb language sql security definer set search_path='' as $$ select '[]'::jsonb $$;
create function public.complete_content_safety_audio_transcription(
  p_scan_id uuid,p_source_asset_id uuid,p_content_fingerprint text,p_detected_language text,
  p_transcript_text text,p_word_count integer,p_segments jsonb,p_no_speech boolean,
  p_transcript_fingerprint text,p_cleanup_pending boolean
) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
create function private.claim_content_safety_visual_scans_for_prompts(p_limit integer,p_prompt_versions text[])
returns jsonb language sql security definer set search_path='' as $$ select '[]'::jsonb $$;
create function public.claim_content_safety_visual_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',
    message='content_safety_service_role_required';end if;
  return private.claim_content_safety_visual_scans_for_prompts(
    p_limit,array['visual-safety-v1']::text[]);
end $$;
create function public.claim_content_safety_visual_scans(
  p_limit integer,p_worker_contract text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',
    message='content_safety_service_role_required';end if;
  if p_worker_contract<>'content-safety-scan-p3-v1' then raise exception using errcode='22023',
    message='unsupported_content_safety_worker_contract';end if;
  return private.claim_content_safety_visual_scans_for_prompts(
    p_limit,array['visual-safety-v1','creator-premium-visual-safety-p3-v1']::text[]);
end $$;
create function private.content_safety_visual_analysis_id_for_asset(
  p_video_asset_id uuid,p_media_asset_id uuid,p_prompt_version text
) returns uuid language sql stable security definer set search_path='' as $$
  select id from private.content_safety_visual_analyses where prompt_version=p_prompt_version
    and video_asset_id is not distinct from p_video_asset_id
    and media_asset_id is not distinct from p_media_asset_id order by created_at,id limit 1
$$;
create function private.content_safety_visual_producer_scan_id(
  p_video_asset_id uuid,p_media_asset_id uuid,p_prompt_version text
) returns uuid language sql stable security definer set search_path='' as $$ select null::uuid $$;
create function private.content_safety_visual_result_valid_for_prompt(
  p_result jsonb,p_prompt_version text,p_source_kind text,
  p_expected_frame_index integer,p_frame_count integer
) returns boolean language sql immutable set search_path='' as $$
  select p_prompt_version in('visual-safety-v1','creator-premium-visual-safety-p3-v1')
    and p_source_kind in('eligible_image','eligible_stream_video')
    and pg_catalog.jsonb_typeof(p_result)='object'
    and p_result->>'schema_version'=p_prompt_version
    and pg_catalog.jsonb_typeof(p_result->'review_required')='boolean'
    and pg_catalog.jsonb_typeof(p_result->'findings')='array'
    and pg_catalog.jsonb_typeof(p_result->'summary')='string'
$$;
create function public.advance_content_safety_visual_scan(
  p_scan_id uuid,p_expected_cursor integer,p_frame_timestamp_ms integer,p_frame_result jsonb
) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
create function private.content_safety_create_visual_alerts_for_scan(p_scan_id uuid,p_analysis_id uuid)
returns integer language sql security definer set search_path='' as $$ select 0 $$;
create function private.content_safety_attach_visual_analysis(p_analysis_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('scans_attached',0,'stories_attached',0,'alerts_processed',0)
$$;
create function public.complete_content_safety_visual_analysis(
  p_scan_id uuid,p_content_fingerprint text,p_analysis_result jsonb,
  p_analysis_fingerprint text,p_frame_timestamps_ms integer[]
) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
create function public.fail_content_safety_visual_scan(
  p_scan_id uuid,p_error_code text,p_retryable boolean default true,p_provider_called boolean default false
) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
