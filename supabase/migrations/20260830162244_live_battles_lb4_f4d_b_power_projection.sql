begin;

alter table public.live_battle_public_states
  add column boost_rule_version integer not null default 1,
  add column rose_target_units integer not null default 0,
  add column challenger_rose_progress_units integer not null default 0,
  add column opponent_rose_progress_units integer not null default 0,
  add column challenger_rose_activations_remaining integer not null default 0,
  add column opponent_rose_activations_remaining integer not null default 0,
  add column challenger_glove_uses_remaining integer not null default 0,
  add column opponent_glove_uses_remaining integer not null default 0,
  add column challenger_x2_starts_at timestamptz,
  add column challenger_x2_expires_at timestamptz,
  add column opponent_x2_starts_at timestamptz,
  add column opponent_x2_expires_at timestamptz,
  add column challenger_x3_starts_at timestamptz,
  add column challenger_x3_expires_at timestamptz,
  add column opponent_x3_starts_at timestamptz,
  add column opponent_x3_expires_at timestamptz,
  add column power_version bigint not null default 0,
  add column power_updated_at timestamptz not null
    default pg_catalog.clock_timestamp(),
  add column server_clock_at timestamptz not null
    default pg_catalog.clock_timestamp();

alter table public.live_battle_public_states
  add constraint live_battle_public_states_power_values_check check (
    boost_rule_version > 0 and
    rose_target_units >= 0 and
    challenger_rose_progress_units between 0 and rose_target_units and
    opponent_rose_progress_units between 0 and rose_target_units and
    challenger_rose_activations_remaining >= 0 and
    opponent_rose_activations_remaining >= 0 and
    challenger_glove_uses_remaining >= 0 and
    opponent_glove_uses_remaining >= 0 and
    power_version >= 0
  ),
  add constraint live_battle_public_states_v1_power_check check (
    boost_rule_version <> 1 or (
      rose_target_units = 0 and
      challenger_rose_progress_units = 0 and
      opponent_rose_progress_units = 0 and
      challenger_rose_activations_remaining = 0 and
      opponent_rose_activations_remaining = 0 and
      challenger_glove_uses_remaining = 0 and
      opponent_glove_uses_remaining = 0 and
      challenger_x2_starts_at is null and challenger_x2_expires_at is null and
      opponent_x2_starts_at is null and opponent_x2_expires_at is null and
      challenger_x3_starts_at is null and challenger_x3_expires_at is null and
      opponent_x3_starts_at is null and opponent_x3_expires_at is null
    )
  ),
  add constraint live_battle_public_states_terminal_power_check check (
    status not in ('completed', 'cancelled') or (
      challenger_glove_uses_remaining = 0 and
      opponent_glove_uses_remaining = 0
    )
  ),
  add constraint live_battle_public_states_challenger_x2_window_check check (
    (challenger_x2_starts_at is null and challenger_x2_expires_at is null) or
    (
      challenger_x2_starts_at is not null and
      challenger_x2_expires_at > challenger_x2_starts_at and
      (scheduled_end_at is null or challenger_x2_expires_at <= scheduled_end_at)
    )
  ),
  add constraint live_battle_public_states_opponent_x2_window_check check (
    (opponent_x2_starts_at is null and opponent_x2_expires_at is null) or
    (
      opponent_x2_starts_at is not null and
      opponent_x2_expires_at > opponent_x2_starts_at and
      (scheduled_end_at is null or opponent_x2_expires_at <= scheduled_end_at)
    )
  ),
  add constraint live_battle_public_states_challenger_x3_window_check check (
    (challenger_x3_starts_at is null and challenger_x3_expires_at is null) or
    (
      challenger_x3_starts_at is not null and
      challenger_x3_expires_at > challenger_x3_starts_at and
      (scheduled_end_at is null or challenger_x3_expires_at <= scheduled_end_at)
    )
  ),
  add constraint live_battle_public_states_opponent_x3_window_check check (
    (opponent_x3_starts_at is null and opponent_x3_expires_at is null) or
    (
      opponent_x3_starts_at is not null and
      opponent_x3_expires_at > opponent_x3_starts_at and
      (scheduled_end_at is null or opponent_x3_expires_at <= scheduled_end_at)
    )
  );

comment on column public.live_battle_public_states.power_version is
  'Monotonic sum of the two server-only power-state versions.';
comment on column public.live_battle_public_states.server_clock_at is
  'Server time of the last material projection update; snapshot server_now is the fresh clock anchor.';

create or replace function private.get_live_battle_power_projection(
  p_battle_id uuid,
  p_server_clock_at timestamptz
)
returns table (
  boost_rule_version integer,
  rose_target_units integer,
  challenger_rose_progress_units integer,
  opponent_rose_progress_units integer,
  challenger_rose_activations_remaining integer,
  opponent_rose_activations_remaining integer,
  challenger_glove_uses_remaining integer,
  opponent_glove_uses_remaining integer,
  challenger_x2_starts_at timestamptz,
  challenger_x2_expires_at timestamptz,
  opponent_x2_starts_at timestamptz,
  opponent_x2_expires_at timestamptz,
  challenger_x3_starts_at timestamptz,
  challenger_x3_expires_at timestamptz,
  opponent_x3_starts_at timestamptz,
  opponent_x3_expires_at timestamptz,
  power_version bigint,
  power_updated_at timestamptz,
  server_clock_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select
    rules.rule_version,
    rules.rose_target_units,
    challenger_power.rose_progress_units,
    opponent_power.rose_progress_units,
    greatest(
      rules.rose_activation_limit_per_side -
        challenger_power.rose_activations_used,
      0
    ),
    greatest(
      rules.rose_activation_limit_per_side -
        opponent_power.rose_activations_used,
      0
    ),
    case when battle.status in ('completed', 'cancelled')
      then 0 else challenger_power.glove_uses_available end,
    case when battle.status in ('completed', 'cancelled')
      then 0 else opponent_power.glove_uses_available end,
    challenger_x2.starts_at, challenger_x2.expires_at,
    opponent_x2.starts_at, opponent_x2.expires_at,
    challenger_x3.starts_at, challenger_x3.expires_at,
    opponent_x3.starts_at, opponent_x3.expires_at,
    challenger_power.power_version + opponent_power.power_version,
    greatest(
      challenger_power.updated_at,
      opponent_power.updated_at
    ),
    p_server_clock_at
  from public.live_battles as battle
  join public.live_battle_rule_sets as rules
    on rules.id = battle.battle_rule_set_id
  join public.live_battle_power_states as challenger_power
    on challenger_power.battle_id = battle.id
   and challenger_power.side = 'challenger'
  join public.live_battle_power_states as opponent_power
    on opponent_power.battle_id = battle.id
   and opponent_power.side = 'opponent'
  left join lateral (
    select boost.starts_at, boost.expires_at
    from public.live_battle_boost_events as boost
    where boost.battle_id = battle.id
      and boost.side = 'challenger'
      and boost.kind = 'rose_x2'
    order by boost.starts_at desc, boost.id desc
    limit 1
  ) as challenger_x2 on true
  left join lateral (
    select boost.starts_at, boost.expires_at
    from public.live_battle_boost_events as boost
    where boost.battle_id = battle.id
      and boost.side = 'opponent'
      and boost.kind = 'rose_x2'
    order by boost.starts_at desc, boost.id desc
    limit 1
  ) as opponent_x2 on true
  left join lateral (
    select boost.starts_at, boost.expires_at
    from public.live_battle_boost_events as boost
    where boost.battle_id = battle.id
      and boost.side = 'challenger'
      and boost.kind = 'glove_x3'
    order by boost.starts_at desc, boost.id desc
    limit 1
  ) as challenger_x3 on true
  left join lateral (
    select boost.starts_at, boost.expires_at
    from public.live_battle_boost_events as boost
    where boost.battle_id = battle.id
      and boost.side = 'opponent'
      and boost.kind = 'glove_x3'
    order by boost.starts_at desc, boost.id desc
    limit 1
  ) as opponent_x3 on true
  where battle.id = p_battle_id;
$$;

create or replace function private.sync_live_battle_public_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_public boolean;
  v_score public.live_battle_score_states%rowtype;
  v_power record;
  v_server_clock_at timestamptz := pg_catalog.clock_timestamp();
begin
  if tg_op = 'DELETE' then
    delete from public.live_battle_public_states where battle_id = old.id;
    return old;
  end if;

  insert into public.live_battle_score_states (
    battle_id, outcome, winner_user_id, finalized_at, updated_at
  ) values (
    new.id,
    case
      when new.status = 'completed' then 'tie'
      when new.status = 'cancelled' then 'cancelled'
      else 'pending'
    end,
    null,
    case when new.status in ('completed', 'cancelled')
      then coalesce(new.ended_at, new.updated_at) else null end,
    new.updated_at
  ) on conflict (battle_id) do nothing;

  perform private.initialize_live_battle_power_states(new.id);

  select score.* into strict v_score
  from public.live_battle_score_states as score
  where score.battle_id = new.id;

  select * into strict v_power
  from private.get_live_battle_power_projection(
    new.id,
    v_server_clock_at
  );

  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id or
    old.challenger_session_id is distinct from new.challenger_session_id or
    old.opponent_session_id is distinct from new.opponent_session_id
  ) then
    delete from public.live_battle_public_states where battle_id = old.id;
  end if;

  v_is_public := new.status in ('countdown', 'active', 'completed') or (
    new.status = 'cancelled' and new.countdown_started_at is not null
  );
  if not v_is_public then
    delete from public.live_battle_public_states where battle_id = new.id;
    return new;
  end if;

  if exists (
    select 1 from public.live_battle_public_states as existing
    where existing.session_id in (
      new.challenger_session_id,
      new.opponent_session_id
    )
      and existing.battle_id <> new.id
      and existing.status not in ('completed', 'cancelled')
  ) then
    raise exception using errcode = '55000',
      message = 'live_battle_public_projection_conflict';
  end if;

  insert into public.live_battle_public_states (
    session_id, battle_id, opponent_session_id,
    local_host_user_id, opponent_host_user_id,
    local_host_agora_uid, opponent_host_agora_uid,
    status, version, scheduled_start_at, started_at,
    scheduled_end_at, ended_at, updated_at,
    challenger_score, opponent_score, score_version,
    outcome, winner_user_id, score_updated_at, projection_version,
    boost_rule_version, rose_target_units,
    challenger_rose_progress_units, opponent_rose_progress_units,
    challenger_rose_activations_remaining,
    opponent_rose_activations_remaining,
    challenger_glove_uses_remaining, opponent_glove_uses_remaining,
    challenger_x2_starts_at, challenger_x2_expires_at,
    opponent_x2_starts_at, opponent_x2_expires_at,
    challenger_x3_starts_at, challenger_x3_expires_at,
    opponent_x3_starts_at, opponent_x3_expires_at,
    power_version, power_updated_at, server_clock_at
  ) values
  (
    new.challenger_session_id, new.id, new.opponent_session_id,
    new.challenger_user_id, new.opponent_user_id,
    private.live_agora_uid(new.challenger_user_id),
    private.live_agora_uid(new.opponent_user_id),
    new.status, new.version, new.scheduled_start_at, new.started_at,
    new.scheduled_end_at, new.ended_at, new.updated_at,
    v_score.challenger_score, v_score.opponent_score, v_score.score_version,
    v_score.outcome, v_score.winner_user_id, v_score.updated_at,
    greatest(new.version, 1::bigint),
    v_power.boost_rule_version, v_power.rose_target_units,
    v_power.challenger_rose_progress_units,
    v_power.opponent_rose_progress_units,
    v_power.challenger_rose_activations_remaining,
    v_power.opponent_rose_activations_remaining,
    v_power.challenger_glove_uses_remaining,
    v_power.opponent_glove_uses_remaining,
    v_power.challenger_x2_starts_at, v_power.challenger_x2_expires_at,
    v_power.opponent_x2_starts_at, v_power.opponent_x2_expires_at,
    v_power.challenger_x3_starts_at, v_power.challenger_x3_expires_at,
    v_power.opponent_x3_starts_at, v_power.opponent_x3_expires_at,
    v_power.power_version, v_power.power_updated_at,
    v_power.server_clock_at
  ),
  (
    new.opponent_session_id, new.id, new.challenger_session_id,
    new.opponent_user_id, new.challenger_user_id,
    private.live_agora_uid(new.opponent_user_id),
    private.live_agora_uid(new.challenger_user_id),
    new.status, new.version, new.scheduled_start_at, new.started_at,
    new.scheduled_end_at, new.ended_at, new.updated_at,
    v_score.challenger_score, v_score.opponent_score, v_score.score_version,
    v_score.outcome, v_score.winner_user_id, v_score.updated_at,
    greatest(new.version, 1::bigint),
    v_power.boost_rule_version, v_power.rose_target_units,
    v_power.challenger_rose_progress_units,
    v_power.opponent_rose_progress_units,
    v_power.challenger_rose_activations_remaining,
    v_power.opponent_rose_activations_remaining,
    v_power.challenger_glove_uses_remaining,
    v_power.opponent_glove_uses_remaining,
    v_power.challenger_x2_starts_at, v_power.challenger_x2_expires_at,
    v_power.opponent_x2_starts_at, v_power.opponent_x2_expires_at,
    v_power.challenger_x3_starts_at, v_power.challenger_x3_expires_at,
    v_power.opponent_x3_starts_at, v_power.opponent_x3_expires_at,
    v_power.power_version, v_power.power_updated_at,
    v_power.server_clock_at
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
      updated_at = excluded.updated_at,
      challenger_score = excluded.challenger_score,
      opponent_score = excluded.opponent_score,
      score_version = excluded.score_version,
      outcome = excluded.outcome,
      winner_user_id = excluded.winner_user_id,
      score_updated_at = excluded.score_updated_at,
      boost_rule_version = excluded.boost_rule_version,
      rose_target_units = excluded.rose_target_units,
      challenger_rose_progress_units =
        excluded.challenger_rose_progress_units,
      opponent_rose_progress_units =
        excluded.opponent_rose_progress_units,
      challenger_rose_activations_remaining =
        excluded.challenger_rose_activations_remaining,
      opponent_rose_activations_remaining =
        excluded.opponent_rose_activations_remaining,
      challenger_glove_uses_remaining =
        excluded.challenger_glove_uses_remaining,
      opponent_glove_uses_remaining =
        excluded.opponent_glove_uses_remaining,
      challenger_x2_starts_at = excluded.challenger_x2_starts_at,
      challenger_x2_expires_at = excluded.challenger_x2_expires_at,
      opponent_x2_starts_at = excluded.opponent_x2_starts_at,
      opponent_x2_expires_at = excluded.opponent_x2_expires_at,
      challenger_x3_starts_at = excluded.challenger_x3_starts_at,
      challenger_x3_expires_at = excluded.challenger_x3_expires_at,
      opponent_x3_starts_at = excluded.opponent_x3_starts_at,
      opponent_x3_expires_at = excluded.opponent_x3_expires_at,
      power_version = excluded.power_version,
      power_updated_at = excluded.power_updated_at,
      server_clock_at = excluded.server_clock_at,
      projection_version = greatest(
        live_battle_public_states.projection_version + 1,
        excluded.projection_version
      )
  where live_battle_public_states.battle_id <> excluded.battle_id
     or excluded.version >= live_battle_public_states.version;

  return new;
end;
$$;

create or replace function private.sync_live_battle_competitive_projection_locked(
  p_battle_id uuid,
  p_server_clock_at timestamptz
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_score public.live_battle_score_states%rowtype;
  v_power record;
  v_projection_count integer;
  v_is_public boolean;
begin
  if p_server_clock_at is null then
    raise exception using errcode = '22023',
      message = 'live_battle_projection_time_invalid';
  end if;
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  select score.* into strict v_score
  from public.live_battle_score_states as score
  where score.battle_id = p_battle_id;
  select * into strict v_power
  from private.get_live_battle_power_projection(
    p_battle_id,
    p_server_clock_at
  );

  v_is_public := v_battle.status in ('countdown', 'active', 'completed') or (
    v_battle.status = 'cancelled' and
    v_battle.countdown_started_at is not null
  );
  select pg_catalog.count(*)::integer into v_projection_count
  from public.live_battle_public_states as projection
  where projection.battle_id = p_battle_id;
  if v_is_public and v_projection_count <> 2 then
    raise exception using errcode = '55000',
      message = 'live_battle_competitive_projection_incomplete';
  end if;
  if not v_is_public and v_projection_count <> 0 then
    raise exception using errcode = '55000',
      message = 'live_battle_private_projection_present';
  end if;

  update public.live_battle_public_states as projection
  set challenger_score = v_score.challenger_score,
      opponent_score = v_score.opponent_score,
      score_version = v_score.score_version,
      outcome = v_score.outcome,
      winner_user_id = v_score.winner_user_id,
      score_updated_at = v_score.updated_at,
      boost_rule_version = v_power.boost_rule_version,
      rose_target_units = v_power.rose_target_units,
      challenger_rose_progress_units =
        v_power.challenger_rose_progress_units,
      opponent_rose_progress_units =
        v_power.opponent_rose_progress_units,
      challenger_rose_activations_remaining =
        v_power.challenger_rose_activations_remaining,
      opponent_rose_activations_remaining =
        v_power.opponent_rose_activations_remaining,
      challenger_glove_uses_remaining =
        v_power.challenger_glove_uses_remaining,
      opponent_glove_uses_remaining =
        v_power.opponent_glove_uses_remaining,
      challenger_x2_starts_at = v_power.challenger_x2_starts_at,
      challenger_x2_expires_at = v_power.challenger_x2_expires_at,
      opponent_x2_starts_at = v_power.opponent_x2_starts_at,
      opponent_x2_expires_at = v_power.opponent_x2_expires_at,
      challenger_x3_starts_at = v_power.challenger_x3_starts_at,
      challenger_x3_expires_at = v_power.challenger_x3_expires_at,
      opponent_x3_starts_at = v_power.opponent_x3_starts_at,
      opponent_x3_expires_at = v_power.opponent_x3_expires_at,
      power_version = v_power.power_version,
      power_updated_at = v_power.power_updated_at,
      server_clock_at = v_power.server_clock_at,
      projection_version = projection.projection_version + 1
  where projection.battle_id = p_battle_id
    and (
      projection.challenger_score is distinct from v_score.challenger_score or
      projection.opponent_score is distinct from v_score.opponent_score or
      projection.score_version is distinct from v_score.score_version or
      projection.outcome is distinct from v_score.outcome or
      projection.winner_user_id is distinct from v_score.winner_user_id or
      projection.score_updated_at is distinct from v_score.updated_at or
      projection.boost_rule_version is distinct from v_power.boost_rule_version or
      projection.rose_target_units is distinct from v_power.rose_target_units or
      projection.challenger_rose_progress_units is distinct from
        v_power.challenger_rose_progress_units or
      projection.opponent_rose_progress_units is distinct from
        v_power.opponent_rose_progress_units or
      projection.challenger_rose_activations_remaining is distinct from
        v_power.challenger_rose_activations_remaining or
      projection.opponent_rose_activations_remaining is distinct from
        v_power.opponent_rose_activations_remaining or
      projection.challenger_glove_uses_remaining is distinct from
        v_power.challenger_glove_uses_remaining or
      projection.opponent_glove_uses_remaining is distinct from
        v_power.opponent_glove_uses_remaining or
      projection.challenger_x2_starts_at is distinct from
        v_power.challenger_x2_starts_at or
      projection.challenger_x2_expires_at is distinct from
        v_power.challenger_x2_expires_at or
      projection.opponent_x2_starts_at is distinct from
        v_power.opponent_x2_starts_at or
      projection.opponent_x2_expires_at is distinct from
        v_power.opponent_x2_expires_at or
      projection.challenger_x3_starts_at is distinct from
        v_power.challenger_x3_starts_at or
      projection.challenger_x3_expires_at is distinct from
        v_power.challenger_x3_expires_at or
      projection.opponent_x3_starts_at is distinct from
        v_power.opponent_x3_starts_at or
      projection.opponent_x3_expires_at is distinct from
        v_power.opponent_x3_expires_at or
      projection.power_version is distinct from v_power.power_version or
      projection.power_updated_at is distinct from v_power.power_updated_at
    );
end;
$$;

create or replace function private.sync_live_battle_power_state_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_live_battle_competitive_projection_locked(
    new.battle_id,
    new.updated_at
  );
  return new;
end;
$$;

create trigger live_battle_power_states_sync_public_projection
after update on public.live_battle_power_states
for each row execute function private.sync_live_battle_power_state_trigger();

create or replace function public.get_live_battle_public_snapshot(
  p_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'server_now', pg_catalog.clock_timestamp(),
    'state', (
      select pg_catalog.jsonb_build_object(
        'session_id', public_state.session_id,
        'battle_id', public_state.battle_id,
        'opponent_session_id', public_state.opponent_session_id,
        'local_host_user_id', public_state.local_host_user_id,
        'opponent_host_user_id', public_state.opponent_host_user_id,
        'local_host_agora_uid', public_state.local_host_agora_uid,
        'opponent_host_agora_uid', public_state.opponent_host_agora_uid,
        'status', public_state.status,
        'version', public_state.version,
        'scheduled_start_at', public_state.scheduled_start_at,
        'started_at', public_state.started_at,
        'scheduled_end_at', public_state.scheduled_end_at,
        'ended_at', public_state.ended_at,
        'updated_at', public_state.updated_at,
        'challenger_score', public_state.challenger_score,
        'opponent_score', public_state.opponent_score,
        'score_version', public_state.score_version,
        'outcome', public_state.outcome,
        'winner_user_id', public_state.winner_user_id,
        'score_updated_at', public_state.score_updated_at,
        'projection_version', public_state.projection_version,
        'boost_rule_version', public_state.boost_rule_version,
        'rose_target_units', public_state.rose_target_units,
        'challenger_rose_progress_units',
          public_state.challenger_rose_progress_units,
        'opponent_rose_progress_units',
          public_state.opponent_rose_progress_units,
        'challenger_rose_activations_remaining',
          public_state.challenger_rose_activations_remaining,
        'opponent_rose_activations_remaining',
          public_state.opponent_rose_activations_remaining,
        'challenger_glove_uses_remaining',
          public_state.challenger_glove_uses_remaining,
        'opponent_glove_uses_remaining',
          public_state.opponent_glove_uses_remaining,
        'challenger_x2_starts_at', public_state.challenger_x2_starts_at,
        'challenger_x2_expires_at', public_state.challenger_x2_expires_at,
        'opponent_x2_starts_at', public_state.opponent_x2_starts_at,
        'opponent_x2_expires_at', public_state.opponent_x2_expires_at,
        'challenger_x3_starts_at', public_state.challenger_x3_starts_at,
        'challenger_x3_expires_at', public_state.challenger_x3_expires_at,
        'opponent_x3_starts_at', public_state.opponent_x3_starts_at,
        'opponent_x3_expires_at', public_state.opponent_x3_expires_at,
        'power_version', public_state.power_version,
        'power_updated_at', public_state.power_updated_at,
        'server_clock_at', public_state.server_clock_at
      )
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

do $$
declare
  v_battle_id uuid;
  v_server_clock_at timestamptz := pg_catalog.clock_timestamp();
begin
  for v_battle_id in
    select distinct projection.battle_id
    from public.live_battle_public_states as projection
    order by projection.battle_id
  loop
    perform private.sync_live_battle_competitive_projection_locked(
      v_battle_id,
      v_server_clock_at
    );
  end loop;
end;
$$;

alter function private.get_live_battle_power_projection(uuid, timestamptz)
  owner to postgres;
alter function private.sync_live_battle_public_states()
  owner to postgres;
alter function private.sync_live_battle_competitive_projection_locked(
  uuid, timestamptz
) owner to postgres;
alter function private.sync_live_battle_power_state_trigger()
  owner to postgres;
alter function public.get_live_battle_public_snapshot(uuid)
  owner to postgres;

revoke all on function private.get_live_battle_power_projection(
  uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_public_states()
  from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_competitive_projection_locked(
  uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_power_state_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.get_live_battle_public_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_live_battle_public_snapshot(uuid)
  to authenticated;

commit;
