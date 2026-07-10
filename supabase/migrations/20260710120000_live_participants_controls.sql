-- ============================================================================
-- supabase/migrations/20260710120000_live_participants_controls.sql
--
-- Foundation for structured LIVE participant/co-host controls.
-- Keeps chat in live_messages and moves moderation/control state into
-- dedicated tables that can be consumed via polling or Supabase Realtime.
--
-- SAFE TO RE-RUN: guarded with IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS before CREATE POLICY.
-- ============================================================================

create table if not exists public.live_participants (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references public.live_sessions(id) on delete cascade,
  user_id                uuid not null references auth.users(id) on delete cascade,
  agora_uid              integer,
  username               text,
  role                   text not null default 'audience',
  status                 text not null default 'active',
  mic_muted              boolean not null default false,
  mic_locked             boolean not null default false,
  camera_enabled         boolean not null default true,
  floor_granted          boolean not null default false,
  floor_started_at       timestamptz,
  floor_duration_seconds integer,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (session_id, user_id),
  constraint live_participants_role_check
    check (role in ('audience', 'requested', 'cohost', 'removed')),
  constraint live_participants_status_check
    check (status in ('active', 'inactive', 'removed'))
);

create table if not exists public.live_control_events (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.live_sessions(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  actor_user_id  uuid references auth.users(id) on delete cascade,
  event_type     text not null,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint live_control_events_event_type_check
    check (event_type in (
      'request_join',
      'approve_join',
      'reject_join',
      'mute',
      'unmute',
      'lock_mic',
      'unlock_mic',
      'grant_floor',
      'revoke_floor',
      'remove_cohost',
      'timer_start',
      'timer_stop',
      'reaction'
    ))
);

create index if not exists live_participants_session_idx
  on public.live_participants (session_id);

create index if not exists live_participants_session_user_idx
  on public.live_participants (session_id, user_id);

create index if not exists live_participants_session_role_idx
  on public.live_participants (session_id, role);

create index if not exists live_control_events_session_created_idx
  on public.live_control_events (session_id, created_at);

create index if not exists live_control_events_session_target_created_idx
  on public.live_control_events (session_id, target_user_id, created_at);

create or replace function public.set_live_participants_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists live_participants_set_updated_at on public.live_participants;
create trigger live_participants_set_updated_at
  before update on public.live_participants
  for each row
  execute function public.set_live_participants_updated_at();

alter table public.live_participants enable row level security;
alter table public.live_control_events enable row level security;

-- live_participants: authenticated users can read participants for live sessions.
drop policy if exists "live_participants_select_live" on public.live_participants;
create policy "live_participants_select_live" on public.live_participants
  for select to authenticated
  using (
    exists (
      select 1
      from public.live_sessions ls
      where ls.id = live_participants.session_id
        and ls.status = 'live'
    )
  );

-- Users can create their own participant row.
drop policy if exists "live_participants_insert_self" on public.live_participants;
create policy "live_participants_insert_self" on public.live_participants
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Users may keep their own non-control state current, but cannot promote
-- themselves to cohost/removed through this policy.
drop policy if exists "live_participants_update_self_basic" on public.live_participants;
create policy "live_participants_update_self_basic" on public.live_participants
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and role in ('audience', 'requested')
    and status in ('active', 'inactive')
  );

-- The host can update participant control state for their own live session.
drop policy if exists "live_participants_update_host" on public.live_participants;
create policy "live_participants_update_host" on public.live_participants
  for update to authenticated
  using (
    exists (
      select 1
      from public.live_sessions ls
      where ls.id = live_participants.session_id
        and ls.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.live_sessions ls
      where ls.id = live_participants.session_id
        and ls.host_id = auth.uid()
    )
  );

-- No delete policy: participants should be marked removed/inactive.

-- live_control_events: authenticated users can read control events for live sessions.
drop policy if exists "live_control_events_select_live" on public.live_control_events;
create policy "live_control_events_select_live" on public.live_control_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.live_sessions ls
      where ls.id = live_control_events.session_id
        and ls.status = 'live'
    )
  );

-- Users can request to join or emit reactions for themselves.
drop policy if exists "live_control_events_insert_self" on public.live_control_events;
create policy "live_control_events_insert_self" on public.live_control_events
  for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and target_user_id = auth.uid()
    and event_type in ('request_join', 'reaction')
  );

-- The host can emit control events for participants in their own live session.
drop policy if exists "live_control_events_insert_host" on public.live_control_events;
create policy "live_control_events_insert_host" on public.live_control_events
  for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and exists (
      select 1
      from public.live_sessions ls
      where ls.id = live_control_events.session_id
        and ls.host_id = auth.uid()
    )
  );

-- Required for Supabase Realtime postgres_changes consumers.
do $$
declare
  t text;
begin
  foreach t in array array['live_participants', 'live_control_events']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
