begin;

create table public.live_battles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  challenger_user_id uuid not null references auth.users(id) on delete restrict,
  opponent_user_id uuid not null references auth.users(id) on delete restrict,
  challenger_session_id uuid not null references public.live_sessions(id) on delete restrict,
  opponent_session_id uuid not null references public.live_sessions(id) on delete restrict,
  status text not null default 'pending',
  invite_expires_at timestamptz not null,
  accepted_at timestamptz,
  countdown_started_at timestamptz,
  scheduled_start_at timestamptz,
  started_at timestamptz,
  scheduled_end_at timestamptz,
  ended_at timestamptz,
  last_transition_actor_id uuid references auth.users(id) on delete set null,
  last_transition_reason text not null,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint live_battles_status_check check (status in (
    'pending', 'accepted', 'countdown', 'active',
    'completed', 'rejected', 'cancelled', 'expired'
  )),
  constraint live_battles_distinct_users_check check (challenger_user_id <> opponent_user_id),
  constraint live_battles_distinct_sessions_check check (challenger_session_id <> opponent_session_id),
  constraint live_battles_version_check check (version >= 1),
  constraint live_battles_invite_window_check check (invite_expires_at > created_at),
  constraint live_battles_updated_order_check check (updated_at >= created_at),
  constraint live_battles_timeline_prefix_check check (
    (accepted_at is not null or (
      countdown_started_at is null and scheduled_start_at is null and
      started_at is null and scheduled_end_at is null
    )) and
    (countdown_started_at is not null or (
      scheduled_start_at is null and started_at is null and scheduled_end_at is null
    )) and
    (started_at is not null or scheduled_end_at is null) and
    (scheduled_start_at is null or countdown_started_at is not null) and
    (countdown_started_at is null or scheduled_start_at = countdown_started_at + interval '3 seconds') and
    (started_at is null or started_at = scheduled_start_at) and
    (scheduled_end_at is null or scheduled_end_at = started_at + interval '300 seconds')
  ),
  constraint live_battles_status_timestamps_check check (
    (status = 'pending' and accepted_at is null and countdown_started_at is null and
      started_at is null and ended_at is null) or
    (status = 'accepted' and accepted_at is not null and countdown_started_at is null and
      started_at is null and ended_at is null) or
    (status = 'countdown' and accepted_at is not null and countdown_started_at is not null and
      scheduled_start_at is not null and started_at is null and ended_at is null) or
    (status = 'active' and accepted_at is not null and countdown_started_at is not null and
      scheduled_start_at is not null and started_at is not null and
      scheduled_end_at is not null and ended_at is null) or
    (status = 'completed' and accepted_at is not null and countdown_started_at is not null and
      scheduled_start_at is not null and started_at is not null and
      scheduled_end_at is not null and ended_at is not null) or
    (status in ('rejected', 'expired') and accepted_at is null and
      countdown_started_at is null and started_at is null and ended_at is not null) or
    (status = 'cancelled' and ended_at is not null)
  )
);

create table public.live_battle_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  battle_id uuid not null references public.live_battles(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text not null,
  reason text not null,
  version bigint not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint live_battle_events_from_status_check check (
    from_status is null or from_status in (
      'pending', 'accepted', 'countdown', 'active',
      'completed', 'rejected', 'cancelled', 'expired'
    )
  ),
  constraint live_battle_events_to_status_check check (to_status in (
    'pending', 'accepted', 'countdown', 'active',
    'completed', 'rejected', 'cancelled', 'expired'
  )),
  constraint live_battle_events_version_check check (version >= 1),
  constraint live_battle_events_battle_version_key unique (battle_id, version)
);

create unique index live_battles_open_pair_uidx
  on public.live_battles (
    least(challenger_user_id, opponent_user_id),
    greatest(challenger_user_id, opponent_user_id)
  )
  where status in ('pending', 'accepted', 'countdown', 'active');

create index live_battles_challenger_status_idx
  on public.live_battles (challenger_user_id, status, updated_at desc);
create index live_battles_opponent_status_idx
  on public.live_battles (opponent_user_id, status, updated_at desc);
create index live_battles_challenger_session_idx
  on public.live_battles (challenger_session_id);
create index live_battles_opponent_session_idx
  on public.live_battles (opponent_session_id);
create index live_battles_pending_expiry_idx
  on public.live_battles (invite_expires_at)
  where status = 'pending';
create index live_battles_countdown_start_idx
  on public.live_battles (scheduled_start_at)
  where status = 'countdown';
create index live_battles_active_end_idx
  on public.live_battles (scheduled_end_at)
  where status = 'active';
create index live_battles_last_actor_idx
  on public.live_battles (last_transition_actor_id)
  where last_transition_actor_id is not null;
create index live_battle_events_battle_created_idx
  on public.live_battle_events (battle_id, created_at desc);
create index live_battle_events_actor_idx
  on public.live_battle_events (actor_user_id)
  where actor_user_id is not null;

alter table public.live_battles enable row level security;
alter table public.live_battle_events enable row level security;

create policy live_battles_read_participant
  on public.live_battles for select to authenticated
  using (
    (select auth.uid()) is not null and
    ((select auth.uid()) = challenger_user_id or (select auth.uid()) = opponent_user_id)
  );

create policy live_battle_events_read_participant
  on public.live_battle_events for select to authenticated
  using (
    (select auth.uid()) is not null and exists (
      select 1
      from public.live_battles b
      where b.id = live_battle_events.battle_id
        and ((select auth.uid()) = b.challenger_user_id or (select auth.uid()) = b.opponent_user_id)
    )
  );

revoke all on table public.live_battles, public.live_battle_events
  from public, anon, authenticated, service_role;
grant select on table public.live_battles, public.live_battle_events to authenticated;

create or replace function private.live_battle_lock_users(
  p_first_user_id uuid,
  p_second_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_first_user_id is null or p_second_user_id is null or p_first_user_id = p_second_user_id then
    raise exception using errcode = '22023', message = 'live_battle_users_invalid';
  end if;

  perform u.id
  from auth.users u
  where u.id in (p_first_user_id, p_second_user_id)
  order by u.id
  for update;

  select pg_catalog.count(*)::integer into v_count
  from auth.users u
  where u.id in (p_first_user_id, p_second_user_id);
  if v_count <> 2 then
    raise exception using errcode = 'P0002', message = 'live_battle_user_not_found';
  end if;
end;
$$;

create or replace function private.live_battle_lock_sessions(
  p_first_session_id uuid,
  p_second_session_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_first_session_id is null or p_second_session_id is null or p_first_session_id = p_second_session_id then
    raise exception using errcode = '22023', message = 'live_battle_sessions_invalid';
  end if;

  perform s.id
  from public.live_sessions s
  where s.id in (p_first_session_id, p_second_session_id)
  order by s.id
  for update;

  select pg_catalog.count(*)::integer into v_count
  from public.live_sessions s
  where s.id in (p_first_session_id, p_second_session_id);
  if v_count <> 2 then
    raise exception using errcode = 'P0002', message = 'live_battle_session_not_found';
  end if;
end;
$$;

create or replace function private.live_battle_to_json(p_battle public.live_battles)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.to_jsonb(p_battle);
$$;

create or replace function private.live_battle_transition(
  p_battle_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_now timestamptz
)
returns public.live_battles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_next_version bigint;
begin
  select * into v_battle
  from public.live_battles b
  where b.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_battle.status <> p_expected_status then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;
  if not (
    (p_expected_status = 'pending' and p_next_status in ('accepted', 'rejected', 'cancelled', 'expired')) or
    (p_expected_status = 'accepted' and p_next_status in ('countdown', 'cancelled')) or
    (p_expected_status = 'countdown' and p_next_status in ('active', 'cancelled')) or
    (p_expected_status = 'active' and p_next_status in ('completed', 'cancelled'))
  ) then
    raise exception using errcode = '55000', message = 'live_battle_transition_invalid';
  end if;

  if p_next_status = 'accepted' and
     (p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason <> 'invite_accepted') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'rejected' and
     (p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason <> 'invite_rejected') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'expired' and
     (p_actor_user_id is not null or p_reason <> 'invite_expired') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'countdown' and
     (p_actor_user_id not in (v_battle.challenger_user_id, v_battle.opponent_user_id) or
      p_reason <> 'countdown_started') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'active' and
     (p_actor_user_id is not null or p_reason <> 'countdown_elapsed') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'completed' and
     (p_actor_user_id is not null or p_reason <> 'battle_duration_elapsed') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'cancelled' and not (
    (p_actor_user_id = v_battle.challenger_user_id and p_reason = 'challenger_cancelled') or
    (p_actor_user_id = v_battle.opponent_user_id and p_reason = 'opponent_cancelled')
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  end if;

  v_next_version := v_battle.version + 1;
  update public.live_battles b
  set status = p_next_status,
      accepted_at = case when p_next_status = 'accepted' then p_now else b.accepted_at end,
      countdown_started_at = case when p_next_status = 'countdown' then p_now else b.countdown_started_at end,
      scheduled_start_at = case when p_next_status = 'countdown' then p_now + interval '3 seconds' else b.scheduled_start_at end,
      started_at = case when p_next_status = 'active' then b.scheduled_start_at else b.started_at end,
      scheduled_end_at = case when p_next_status = 'active' then b.scheduled_start_at + interval '300 seconds' else b.scheduled_end_at end,
      ended_at = case
        when p_next_status = 'expired' then b.invite_expires_at
        when p_next_status = 'completed' then b.scheduled_end_at
        when p_next_status in ('rejected', 'cancelled') then p_now
        else b.ended_at
      end,
      last_transition_actor_id = p_actor_user_id,
      last_transition_reason = p_reason,
      version = v_next_version,
      updated_at = p_now
  where b.id = p_battle_id
    and b.status = p_expected_status
    and b.version = v_battle.version
  returning * into v_battle;
  if not found then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;

  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, p_actor_user_id, p_expected_status, p_next_status,
    p_reason, v_next_version, p_now
  );
  return v_battle;
end;
$$;

create or replace function private.live_battle_reconcile_locked(
  p_battle_id uuid,
  p_now timestamptz
)
returns public.live_battles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
begin
  loop
    select * into v_battle
    from public.live_battles b
    where b.id = p_battle_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'live_battle_not_found';
    end if;

    if v_battle.status = 'pending' and v_battle.invite_expires_at <= p_now then
      v_battle := private.live_battle_transition(
        v_battle.id, 'pending', 'expired', null, 'invite_expired', p_now
      );
    elsif v_battle.status = 'countdown' and v_battle.scheduled_start_at <= p_now then
      v_battle := private.live_battle_transition(
        v_battle.id, 'countdown', 'active', null, 'countdown_elapsed', p_now
      );
    elsif v_battle.status = 'active' and v_battle.scheduled_end_at <= p_now then
      v_battle := private.live_battle_transition(
        v_battle.id, 'active', 'completed', null, 'battle_duration_elapsed', p_now
      );
    else
      return v_battle;
    end if;
  end loop;
  return v_battle;
end;
$$;

create or replace function public.create_live_battle_invite(
  p_opponent_user_id uuid,
  p_challenger_session_id uuid,
  p_opponent_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
  v_existing public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  if p_opponent_user_id is null or p_opponent_user_id = v_actor then
    raise exception using errcode = '22023', message = 'live_battle_opponent_invalid';
  end if;
  if p_challenger_session_id is null or p_opponent_session_id is null or
     p_challenger_session_id = p_opponent_session_id then
    raise exception using errcode = '22023', message = 'live_battle_sessions_invalid';
  end if;

  perform private.live_battle_lock_users(v_actor, p_opponent_user_id);
  perform private.live_battle_lock_sessions(p_challenger_session_id, p_opponent_session_id);

  select * into v_challenger_session from public.live_sessions s
  where s.id = p_challenger_session_id;
  select * into v_opponent_session from public.live_sessions s
  where s.id = p_opponent_session_id;
  if v_challenger_session.host_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_challenger_not_host';
  end if;
  if v_opponent_session.host_id <> p_opponent_user_id then
    raise exception using errcode = '42501', message = 'live_battle_opponent_not_host';
  end if;
  if v_challenger_session.status <> 'live' or v_opponent_session.status <> 'live' then
    raise exception using errcode = '55000', message = 'live_battle_session_not_live';
  end if;

  select * into v_existing
  from public.live_battles b
  where b.status in ('pending', 'accepted', 'countdown', 'active')
    and ((b.challenger_user_id = v_actor and b.opponent_user_id = p_opponent_user_id) or
         (b.challenger_user_id = p_opponent_user_id and b.opponent_user_id = v_actor))
  order by b.created_at desc
  limit 1
  for update;
  if found and v_existing.status = 'pending' and v_existing.invite_expires_at <= v_now then
    v_existing := private.live_battle_reconcile_locked(v_existing.id, v_now);
  end if;
  if v_existing.status = 'pending' and v_existing.ended_at is null then
    if v_existing.challenger_user_id = v_actor and
       v_existing.opponent_user_id = p_opponent_user_id and
       v_existing.challenger_session_id = p_challenger_session_id and
       v_existing.opponent_session_id = p_opponent_session_id then
      return private.live_battle_to_json(v_existing);
    end if;
    raise exception using errcode = '55000', message = 'live_battle_pair_busy';
  elsif v_existing.status in ('accepted', 'countdown', 'active') then
    raise exception using errcode = '55000', message = 'live_battle_pair_busy';
  end if;

  insert into public.live_battles (
    challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at
  ) values (
    v_actor, p_opponent_user_id,
    p_challenger_session_id, p_opponent_session_id,
    'pending', v_now + interval '30 seconds', v_actor,
    'invite_created', 1, v_now, v_now
  ) returning * into v_battle;

  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, v_actor, null, 'pending', 'invite_created', 1, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

create or replace function public.respond_live_battle_invite(
  p_battle_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  if p_accept is null then
    raise exception using errcode = '22023', message = 'live_battle_response_invalid';
  end if;
  select * into v_seed from public.live_battles b where b.id = p_battle_id;
  if not found then raise exception using errcode = 'P0002', message = 'live_battle_not_found'; end if;
  if v_seed.opponent_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_response_forbidden';
  end if;

  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id = p_battle_id for update;
  if v_battle.opponent_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_response_forbidden';
  end if;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'expired' then
    return private.live_battle_to_json(v_battle);
  end if;
  if (p_accept and v_battle.status = 'accepted') or
     (not p_accept and v_battle.status = 'rejected') then
    return private.live_battle_to_json(v_battle);
  end if;
  if v_battle.status <> 'pending' then
    raise exception using errcode = '55000', message = 'live_battle_response_state_invalid';
  end if;

  select * into v_challenger_session from public.live_sessions s
  where s.id = v_battle.challenger_session_id;
  select * into v_opponent_session from public.live_sessions s
  where s.id = v_battle.opponent_session_id;
  if v_challenger_session.host_id <> v_battle.challenger_user_id or
     v_opponent_session.host_id <> v_battle.opponent_user_id then
    raise exception using errcode = '42501', message = 'live_battle_host_authority_changed';
  end if;

  if not p_accept then
    v_battle := private.live_battle_transition(
      v_battle.id, 'pending', 'rejected', v_actor, 'invite_rejected', v_now
    );
    return private.live_battle_to_json(v_battle);
  end if;
  if v_challenger_session.status <> 'live' or v_opponent_session.status <> 'live' then
    raise exception using errcode = '55000', message = 'live_battle_session_not_live';
  end if;
  if exists (
    select 1 from public.live_battles b
    where b.id <> v_battle.id
      and b.status in ('accepted', 'countdown', 'active')
      and (
        b.challenger_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id) or
        b.opponent_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id)
      )
  ) then
    raise exception using errcode = '55000', message = 'live_battle_participant_busy';
  end if;

  v_battle := private.live_battle_transition(
    v_battle.id, 'pending', 'accepted', v_actor, 'invite_accepted', v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

create or replace function public.start_live_battle(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_battle_auth_required'; end if;
  select * into v_seed from public.live_battles b where b.id = p_battle_id;
  if not found then raise exception using errcode='P0002', message='live_battle_not_found'; end if;
  if v_actor not in (v_seed.challenger_user_id, v_seed.opponent_user_id) then
    raise exception using errcode='42501', message='live_battle_forbidden';
  end if;
  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id=p_battle_id for update;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status in ('countdown', 'active', 'completed') then
    return private.live_battle_to_json(v_battle);
  end if;
  if v_battle.status <> 'accepted' then
    raise exception using errcode='55000', message='live_battle_start_state_invalid';
  end if;
  select * into v_challenger_session from public.live_sessions s where s.id=v_battle.challenger_session_id;
  select * into v_opponent_session from public.live_sessions s where s.id=v_battle.opponent_session_id;
  if v_challenger_session.host_id <> v_battle.challenger_user_id or
     v_opponent_session.host_id <> v_battle.opponent_user_id then
    raise exception using errcode='42501', message='live_battle_host_authority_changed';
  end if;
  if v_challenger_session.status <> 'live' or v_opponent_session.status <> 'live' then
    raise exception using errcode='55000', message='live_battle_session_not_live';
  end if;
  v_battle := private.live_battle_transition(
    v_battle.id, 'accepted', 'countdown', v_actor, 'countdown_started', v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

create or replace function public.cancel_live_battle(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
  v_reason text;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_battle_auth_required'; end if;
  select * into v_seed from public.live_battles b where b.id=p_battle_id;
  if not found then raise exception using errcode='P0002', message='live_battle_not_found'; end if;
  if v_actor not in (v_seed.challenger_user_id, v_seed.opponent_user_id) then
    raise exception using errcode='42501', message='live_battle_forbidden';
  end if;
  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id=p_battle_id for update;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'cancelled' then return private.live_battle_to_json(v_battle); end if;
  if v_battle.status not in ('pending', 'accepted', 'countdown', 'active') then
    raise exception using errcode='55000', message='live_battle_terminal';
  end if;
  v_reason := case when v_actor=v_battle.challenger_user_id
    then 'challenger_cancelled' else 'opponent_cancelled' end;
  v_battle := private.live_battle_transition(
    v_battle.id, v_battle.status, 'cancelled', v_actor, v_reason, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

create or replace function public.complete_live_battle(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_battle_auth_required'; end if;
  select * into v_seed from public.live_battles b where b.id=p_battle_id;
  if not found then raise exception using errcode='P0002', message='live_battle_not_found'; end if;
  if v_actor not in (v_seed.challenger_user_id, v_seed.opponent_user_id) then
    raise exception using errcode='42501', message='live_battle_forbidden';
  end if;
  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id=p_battle_id for update;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'completed' then return private.live_battle_to_json(v_battle); end if;
  if v_battle.status = 'active' and v_battle.scheduled_end_at > v_now then
    raise exception using errcode='55000', message='live_battle_completion_too_early';
  end if;
  raise exception using errcode='55000', message='live_battle_complete_state_invalid';
end;
$$;

create or replace function public.get_live_battle_state(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_battle_auth_required'; end if;
  select * into v_seed from public.live_battles b where b.id=p_battle_id;
  if not found then raise exception using errcode='P0002', message='live_battle_not_found'; end if;
  if v_actor not in (v_seed.challenger_user_id, v_seed.opponent_user_id) then
    raise exception using errcode='42501', message='live_battle_forbidden';
  end if;
  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id=p_battle_id for update;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  return private.live_battle_to_json(v_battle);
end;
$$;

revoke all on function private.live_battle_lock_users(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_lock_sessions(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_to_json(public.live_battles)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_reconcile_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.create_live_battle_invite(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_live_battle_invite(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.start_live_battle(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_live_battle(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_live_battle(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_live_battle_state(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_live_battle_invite(uuid, uuid, uuid) to authenticated;
grant execute on function public.respond_live_battle_invite(uuid, boolean) to authenticated;
grant execute on function public.start_live_battle(uuid) to authenticated;
grant execute on function public.cancel_live_battle(uuid) to authenticated;
grant execute on function public.complete_live_battle(uuid) to authenticated;
grant execute on function public.get_live_battle_state(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception using errcode='55000', message='live_battle_realtime_publication_missing';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='live_battles'
  ) then
    alter publication supabase_realtime add table public.live_battles;
  end if;
end;
$$;

commit;
