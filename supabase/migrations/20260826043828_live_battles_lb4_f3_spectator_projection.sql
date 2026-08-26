begin;

create table public.live_battle_public_states (
  session_id uuid primary key
    references public.live_sessions(id) on delete cascade,
  battle_id uuid not null
    references public.live_battles(id) on delete cascade,
  opponent_session_id uuid not null
    references public.live_sessions(id) on delete cascade,
  local_host_user_id uuid not null,
  opponent_host_user_id uuid not null,
  local_host_agora_uid integer not null,
  opponent_host_agora_uid integer not null,
  status text not null,
  version bigint not null,
  scheduled_start_at timestamptz,
  started_at timestamptz,
  scheduled_end_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null,
  constraint live_battle_public_states_distinct_sessions_check
    check (session_id <> opponent_session_id),
  constraint live_battle_public_states_distinct_hosts_check
    check (local_host_user_id <> opponent_host_user_id),
  constraint live_battle_public_states_local_uid_check
    check (local_host_agora_uid between 1 and 2147483647),
  constraint live_battle_public_states_opponent_uid_check
    check (opponent_host_agora_uid between 1 and 2147483647),
  constraint live_battle_public_states_status_check
    check (status in ('countdown', 'active', 'completed', 'cancelled')),
  constraint live_battle_public_states_version_check
    check (version >= 1),
  constraint live_battle_public_states_terminal_timestamp_check
    check (
      (status in ('countdown', 'active') and ended_at is null) or
      (status in ('completed', 'cancelled') and ended_at is not null)
    )
);

create index live_battle_public_states_battle_idx
  on public.live_battle_public_states (battle_id);
create index live_battle_public_states_opponent_session_idx
  on public.live_battle_public_states (opponent_session_id);

comment on table public.live_battle_public_states is
  'Sanitized symmetric Battle projection. Authenticated users may intentionally observe a row only while its LIVE session remains public and active.';
comment on column public.live_battle_public_states.session_id is
  'The observed LIVE session; this is the exact Realtime filter key.';
comment on column public.live_battle_public_states.local_host_agora_uid is
  'Canonical Agora UID for the host of session_id, computed server-side.';
comment on column public.live_battle_public_states.opponent_host_agora_uid is
  'Canonical Agora UID for the opposing host, computed server-side.';

alter table public.live_battle_public_states enable row level security;
alter table public.live_battle_public_states replica identity full;

create policy live_battle_public_states_read_observable_live
  on public.live_battle_public_states
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.live_sessions as observed_session
      where observed_session.id = live_battle_public_states.session_id
        and observed_session.status = 'live'
        and observed_session.ended_at is null
    )
  );

revoke all on table public.live_battle_public_states
  from public, anon, authenticated, service_role;
grant select on table public.live_battle_public_states to authenticated;

create or replace function private.sync_live_battle_public_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_public boolean;
begin
  if tg_op = 'DELETE' then
    delete from public.live_battle_public_states
    where battle_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id or
    old.challenger_session_id is distinct from new.challenger_session_id or
    old.opponent_session_id is distinct from new.opponent_session_id
  ) then
    delete from public.live_battle_public_states
    where battle_id = old.id;
  end if;

  v_is_public := new.status in ('countdown', 'active', 'completed') or (
    new.status = 'cancelled' and new.countdown_started_at is not null
  );

  if not v_is_public then
    delete from public.live_battle_public_states
    where battle_id = new.id;
    return new;
  end if;

  if exists (
    select 1
    from public.live_battle_public_states as existing
    where existing.session_id in (
      new.challenger_session_id,
      new.opponent_session_id
    )
      and existing.battle_id <> new.id
      and existing.status not in ('completed', 'cancelled')
  ) then
    raise exception using
      errcode = '55000',
      message = 'live_battle_public_projection_conflict';
  end if;

  insert into public.live_battle_public_states (
    session_id,
    battle_id,
    opponent_session_id,
    local_host_user_id,
    opponent_host_user_id,
    local_host_agora_uid,
    opponent_host_agora_uid,
    status,
    version,
    scheduled_start_at,
    started_at,
    scheduled_end_at,
    ended_at,
    updated_at
  ) values
  (
    new.challenger_session_id,
    new.id,
    new.opponent_session_id,
    new.challenger_user_id,
    new.opponent_user_id,
    private.live_agora_uid(new.challenger_user_id),
    private.live_agora_uid(new.opponent_user_id),
    new.status,
    new.version,
    new.scheduled_start_at,
    new.started_at,
    new.scheduled_end_at,
    new.ended_at,
    new.updated_at
  ),
  (
    new.opponent_session_id,
    new.id,
    new.challenger_session_id,
    new.opponent_user_id,
    new.challenger_user_id,
    private.live_agora_uid(new.opponent_user_id),
    private.live_agora_uid(new.challenger_user_id),
    new.status,
    new.version,
    new.scheduled_start_at,
    new.started_at,
    new.scheduled_end_at,
    new.ended_at,
    new.updated_at
  )
  on conflict (session_id) do update
  set battle_id = excluded.battle_id,
      opponent_session_id = excluded.opponent_session_id,
      local_host_user_id = excluded.local_host_user_id,
      opponent_host_user_id = excluded.opponent_host_user_id,
      local_host_agora_uid = excluded.local_host_agora_uid,
      opponent_host_agora_uid = excluded.opponent_host_agora_uid,
      status = excluded.status,
      version = excluded.version,
      scheduled_start_at = excluded.scheduled_start_at,
      started_at = excluded.started_at,
      scheduled_end_at = excluded.scheduled_end_at,
      ended_at = excluded.ended_at,
      updated_at = excluded.updated_at
  where live_battle_public_states.battle_id <> excluded.battle_id
     or excluded.version >= live_battle_public_states.version;

  return new;
end;
$$;

alter function private.sync_live_battle_public_states() owner to postgres;
revoke all on function private.sync_live_battle_public_states()
  from public, anon, authenticated, service_role;

create trigger live_battles_sync_public_states
after insert or update or delete on public.live_battles
for each row execute function private.sync_live_battle_public_states();

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication as publication
    join pg_catalog.pg_publication_rel as publication_relation
      on publication_relation.prpubid = publication.oid
    where publication.pubname = 'supabase_realtime'
      and publication_relation.prrelid = 'public.live_battle_public_states'::regclass
  ) then
    alter publication supabase_realtime
      add table public.live_battle_public_states;
  end if;
end;
$$;

commit;
