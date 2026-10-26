-- Minimal current-contract schema for a NEW, EMPTY, disposable local database.
-- Canonical functions and core Battle/series/score DDL are loaded verbatim from
-- predecessor migrations by the harness. This is not full-schema E2E coverage.
create schema auth;
create schema private;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create table auth.users(id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema public, auth to authenticated, anon, service_role;
create table public.live_sessions(
  id uuid primary key default gen_random_uuid(), host_id uuid not null references auth.users,
  status text not null default 'live', ended_at timestamptz
);
create table public.live_participants(
  session_id uuid references public.live_sessions, user_id uuid references auth.users,
  status text not null, primary key(session_id,user_id)
);
create table public.gift_catalog(
  id text primary key, emoji text not null, cost_coins integer not null,
  active boolean not null default true, enabled boolean not null default true
);
create table public.ledger_accounts(
  id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users,
  account_type text not null, currency text not null default 'BDAG',
  balance numeric not null default 0, frozen boolean not null default false,
  updated_at timestamptz not null default now(), unique(owner_id,account_type,currency)
);
create table public.financial_transactions(
  id uuid primary key default gen_random_uuid(), idempotency_key text,
  operation_type text, from_account_id uuid references public.ledger_accounts,
  to_account_id uuid references public.ledger_accounts, amount numeric, fee_amount numeric,
  currency text, status text, reference_type text, reference_id text, initiated_by uuid
);
create table public.ledger_entries(
  id uuid primary key default gen_random_uuid(), txn_id uuid, account_id uuid references public.ledger_accounts,
  entry_type text, amount numeric, balance_after numeric, description text, metadata jsonb
);
create table public.idempotency_keys(
  id uuid primary key default gen_random_uuid(), idempotency_key text,
  operation_type text, user_id uuid, request_hash text, status text, response_body jsonb,
  unique(idempotency_key,operation_type,user_id)
);
create table public.live_battle_rule_sets(
  id uuid primary key default gen_random_uuid(), rule_version integer default 2,
  gift_points_per_coin integer default 100, rose_gift_id text, rose_target_units integer default 0,
  like_points integer default 5, max_scoreable_likes_per_viewer integer default 20,
  unique(id,rule_version)
);
create table public.live_battle_current_rule_set(singleton boolean primary key, rule_set_id uuid);
create table public.live_battle_boost_events(
  id uuid primary key default gen_random_uuid(), battle_id uuid, side text,
  rule_set_id uuid, rule_version integer, multiplier integer, starts_at timestamptz, expires_at timestamptz
);
create table public.live_battle_power_states(
  battle_id uuid, side text, rose_progress_units integer default 0,
  rose_activations_used integer default 0, power_version bigint default 0,
  updated_at timestamptz default now(), primary key(battle_id,side)
);
create table public.live_battle_public_states(
  session_id uuid primary key, battle_id uuid not null, opponent_session_id uuid,
  local_host_user_id uuid, opponent_host_user_id uuid,
  challenger_score bigint default 0, opponent_score bigint default 0,
  score_version bigint default 0, outcome text default 'pending', winner_user_id uuid,
  score_updated_at timestamptz, projection_version bigint default 1,
  series_id uuid, series_format text, round_number integer, series_max_rounds integer,
  series_wins_required integer, challenger_series_wins integer, opponent_series_wins integer,
  series_ties integer, series_rounds_completed integer, series_status text,
  series_champion_user_id uuid, series_version bigint, rematch_request_id uuid,
  rematch_request_after_battle_id uuid, rematch_request_status text,
  rematch_requested_by_user_id uuid, rematch_request_expires_at timestamptz,
  rematch_window_expires_at timestamptz, server_clock_at timestamptz,
  constraint live_battle_public_states_winner_check check (
    (outcome in ('pending', 'tie', 'cancelled') and winner_user_id is null) or
    (outcome in ('challenger', 'opponent') and winner_user_id in (
      local_host_user_id, opponent_host_user_id
    ))
  ),
  constraint live_battle_public_states_result_check check (
    outcome in ('pending', 'cancelled') or
    (outcome = 'challenger' and challenger_score > opponent_score) or
    (outcome = 'opponent' and opponent_score > challenger_score) or
    (outcome = 'tie' and challenger_score = opponent_score)
  )
);
