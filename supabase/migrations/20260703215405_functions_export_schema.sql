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
