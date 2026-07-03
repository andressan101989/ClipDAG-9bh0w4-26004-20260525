-- Persisted call-signaling table for 1:1 video calls.
-- Replaces ephemeral, subscribe-race-prone Realtime broadcast with a durable
-- row the callee can pick up via postgres_changes even across app restarts.

create table if not exists calls (
  id uuid default gen_random_uuid() primary key,
  caller_id uuid references user_profiles(id),
  callee_id uuid references user_profiles(id),
  channel_name text not null,
  status text default 'ringing',
  created_at timestamptz default now()
);

create index if not exists calls_callee_id_idx on calls (callee_id);
create index if not exists calls_caller_id_idx on calls (caller_id);

alter table calls enable row level security;

drop policy if exists "calls_select_participant" on calls;
create policy "calls_select_participant" on calls
  for select using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists "calls_insert_caller" on calls;
create policy "calls_insert_caller" on calls
  for insert with check (auth.uid() = caller_id);

drop policy if exists "calls_update_participant" on calls;
create policy "calls_update_participant" on calls
  for update using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Required for the callee/caller Realtime postgres_changes subscriptions.
alter publication supabase_realtime add table calls;
