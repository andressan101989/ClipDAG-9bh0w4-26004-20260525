begin;

create table public.live_battle_series (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  challenger_user_id uuid not null references auth.users(id) on delete restrict,
  opponent_user_id uuid not null references auth.users(id) on delete restrict,
  challenger_session_id uuid not null references public.live_sessions(id) on delete restrict,
  opponent_session_id uuid not null references public.live_sessions(id) on delete restrict,
  format text not null,
  max_rounds smallint not null,
  wins_required smallint not null,
  status text not null default 'active',
  challenger_wins smallint not null default 0,
  opponent_wins smallint not null default 0,
  ties smallint not null default 0,
  rounds_completed smallint not null default 0,
  champion_user_id uuid references auth.users(id) on delete restrict,
  rematch_window_expires_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  constraint live_battle_series_distinct_users_check
    check (challenger_user_id <> opponent_user_id),
  constraint live_battle_series_distinct_sessions_check
    check (challenger_session_id <> opponent_session_id),
  constraint live_battle_series_format_check
    check (format in ('single', 'best_of_5')),
  constraint live_battle_series_format_limits_check check (
    (format = 'single' and max_rounds = 1 and wins_required = 1) or
    (format = 'best_of_5' and max_rounds = 5 and wins_required = 3)
  ),
  constraint live_battle_series_status_check check (status in (
    'active', 'awaiting_rematch', 'rematch_pending', 'completed', 'cancelled'
  )),
  constraint live_battle_series_counters_check check (
    challenger_wins >= 0 and opponent_wins >= 0 and ties >= 0 and
    rounds_completed >= 0 and rounds_completed <= max_rounds and
    challenger_wins + opponent_wins + ties = rounds_completed and
    challenger_wins <= wins_required and opponent_wins <= wins_required
  ),
  constraint live_battle_series_champion_participant_check check (
    champion_user_id is null or
    champion_user_id in (challenger_user_id, opponent_user_id)
  ),
  constraint live_battle_series_champion_result_check check (
    (status = 'completed' and (
      (challenger_wins > opponent_wins and champion_user_id = challenger_user_id) or
      (opponent_wins > challenger_wins and champion_user_id = opponent_user_id) or
      (challenger_wins = opponent_wins and champion_user_id is null)
    )) or
    (status <> 'completed' and champion_user_id is null)
  ),
  constraint live_battle_series_completion_check check (
    (status in ('completed', 'cancelled') and completed_at is not null) or
    (status in ('active', 'awaiting_rematch', 'rematch_pending') and completed_at is null)
  ),
  constraint live_battle_series_rematch_window_check check (
    (status in ('awaiting_rematch', 'rematch_pending') and rematch_window_expires_at is not null) or
    (status in ('active', 'completed', 'cancelled') and rematch_window_expires_at is null)
  ),
  constraint live_battle_series_version_check check (version >= 1),
  constraint live_battle_series_timestamp_check check (
    updated_at >= created_at and
    (completed_at is null or completed_at >= created_at)
  )
);

create unique index live_battle_series_open_pair_uidx
  on public.live_battle_series (
    least(challenger_user_id, opponent_user_id),
    greatest(challenger_user_id, opponent_user_id)
  )
  where status in ('active', 'awaiting_rematch', 'rematch_pending');

create index live_battle_series_due_rematch_idx
  on public.live_battle_series (rematch_window_expires_at, id)
  where status in ('awaiting_rematch', 'rematch_pending');
create index live_battle_series_challenger_user_idx
  on public.live_battle_series (challenger_user_id);
create index live_battle_series_opponent_user_idx
  on public.live_battle_series (opponent_user_id);
create index live_battle_series_challenger_session_idx
  on public.live_battle_series (challenger_session_id);
create index live_battle_series_opponent_session_idx
  on public.live_battle_series (opponent_session_id);
create index live_battle_series_champion_idx
  on public.live_battle_series (champion_user_id)
  where champion_user_id is not null;

create table public.live_battle_rematch_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  series_id uuid not null references public.live_battle_series(id) on delete cascade,
  after_battle_id uuid not null references public.live_battles(id) on delete restrict,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  idempotency_key uuid not null,
  expires_at timestamptz not null,
  responded_by_user_id uuid references auth.users(id) on delete restrict,
  responded_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_rematch_requests_status_check check (
    status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')
  ),
  constraint live_battle_rematch_requests_window_check check (expires_at > created_at),
  constraint live_battle_rematch_requests_response_check check (
    (status = 'pending' and responded_by_user_id is null and responded_at is null) or
    (status in ('accepted', 'rejected') and responded_by_user_id is not null and responded_at is not null) or
    (status = 'expired' and responded_by_user_id is null and responded_at is not null) or
    (status = 'cancelled' and responded_at is not null)
  ),
  constraint live_battle_rematch_requests_timestamp_check check (
    updated_at >= created_at and
    (responded_at is null or responded_at >= created_at)
  ),
  constraint live_battle_rematch_requests_actor_key_unique
    unique (requested_by_user_id, idempotency_key)
);

create unique index live_battle_rematch_requests_pending_round_uidx
  on public.live_battle_rematch_requests (series_id, after_battle_id)
  where status = 'pending';
create index live_battle_rematch_requests_due_idx
  on public.live_battle_rematch_requests (expires_at, id)
  where status = 'pending';
create index live_battle_rematch_requests_series_created_idx
  on public.live_battle_rematch_requests (series_id, created_at desc, id);
create index live_battle_rematch_requests_series_battle_created_idx
  on public.live_battle_rematch_requests
  (series_id, after_battle_id, created_at desc, id desc);
create index live_battle_rematch_requests_after_battle_idx
  on public.live_battle_rematch_requests (after_battle_id);

alter table public.live_battle_series enable row level security;
alter table public.live_battle_rematch_requests enable row level security;
revoke all on table public.live_battle_series,
  public.live_battle_rematch_requests
  from public, anon, authenticated, service_role;

alter table public.live_battles
  add column series_id uuid,
  add column round_number smallint;

insert into public.live_battle_series (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  format, max_rounds, wins_required, status,
  challenger_wins, opponent_wins, ties, rounds_completed,
  champion_user_id, rematch_window_expires_at, version,
  created_at, updated_at, completed_at
)
select
  battle.id,
  battle.challenger_user_id, battle.opponent_user_id,
  battle.challenger_session_id, battle.opponent_session_id,
  case when battle.status in ('pending', 'accepted', 'countdown', 'active')
    then 'best_of_5' else 'single' end,
  case when battle.status in ('pending', 'accepted', 'countdown', 'active')
    then 5 else 1 end,
  case when battle.status in ('pending', 'accepted', 'countdown', 'active')
    then 3 else 1 end,
  case
    when battle.status in ('pending', 'accepted', 'countdown', 'active') then 'active'
    when battle.status = 'completed' then 'completed'
    else 'cancelled'
  end,
  case when battle.status = 'completed' and score.outcome = 'challenger' then 1 else 0 end,
  case when battle.status = 'completed' and score.outcome = 'opponent' then 1 else 0 end,
  case when battle.status = 'completed' and score.outcome = 'tie' then 1 else 0 end,
  case when battle.status = 'completed' and score.outcome in ('challenger', 'opponent', 'tie')
    then 1 else 0 end,
  case when battle.status = 'completed' then score.winner_user_id else null end,
  null,
  1,
  battle.created_at,
  battle.updated_at,
  case when battle.status not in ('pending', 'accepted', 'countdown', 'active')
    then coalesce(score.finalized_at, battle.ended_at, battle.updated_at) else null end
from public.live_battles as battle
join public.live_battle_score_states as score on score.battle_id = battle.id;

update public.live_battles as battle
set series_id = battle.id,
    round_number = 1;

alter table public.live_battles
  alter column series_id set not null,
  alter column round_number set not null,
  add constraint live_battles_series_fkey
    foreign key (series_id) references public.live_battle_series(id) on delete restrict,
  add constraint live_battles_series_round_key unique (series_id, round_number),
  add constraint live_battles_round_number_check check (round_number between 1 and 5);

create index live_battles_series_round_desc_idx
  on public.live_battles (series_id, round_number desc);

alter table public.live_battle_public_states
  add column series_id uuid,
  add column series_format text,
  add column round_number smallint,
  add column series_max_rounds smallint,
  add column series_wins_required smallint,
  add column challenger_series_wins smallint,
  add column opponent_series_wins smallint,
  add column series_ties smallint,
  add column series_rounds_completed smallint,
  add column series_status text,
  add column series_champion_user_id uuid,
  add column series_version bigint,
  add column rematch_request_id uuid,
  add column rematch_request_after_battle_id uuid,
  add column rematch_request_status text,
  add column rematch_requested_by_user_id uuid,
  add column rematch_request_expires_at timestamptz,
  add column rematch_window_expires_at timestamptz;

update public.live_battle_public_states as projection
set series_id = series.id,
    series_format = series.format,
    round_number = battle.round_number,
    series_max_rounds = series.max_rounds,
    series_wins_required = series.wins_required,
    challenger_series_wins = series.challenger_wins,
    opponent_series_wins = series.opponent_wins,
    series_ties = series.ties,
    series_rounds_completed = series.rounds_completed,
    series_status = series.status,
    series_champion_user_id = series.champion_user_id,
    series_version = series.version,
    rematch_request_id = null,
    rematch_request_after_battle_id = null,
    rematch_request_status = null,
    rematch_requested_by_user_id = null,
    rematch_request_expires_at = null,
    rematch_window_expires_at = series.rematch_window_expires_at
from public.live_battles as battle
join public.live_battle_series as series on series.id = battle.series_id
where battle.id = projection.battle_id;

create or replace function private.clear_stale_live_battle_rematch_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.battle_id is distinct from old.battle_id then
    new.rematch_request_id := null;
    new.rematch_request_after_battle_id := null;
    new.rematch_request_status := null;
    new.rematch_requested_by_user_id := null;
    new.rematch_request_expires_at := null;
    new.rematch_window_expires_at := null;
  end if;
  return new;
end;
$$;

create trigger live_battle_public_states_clear_stale_rematch
before update on public.live_battle_public_states
for each row execute function private.clear_stale_live_battle_rematch_projection();

alter table public.live_battle_public_states
  add constraint live_battle_public_states_series_format_check
    check (series_format is null or series_format in ('single', 'best_of_5')),
  add constraint live_battle_public_states_series_status_check check (
    series_status is null or series_status in (
      'active', 'awaiting_rematch', 'rematch_pending', 'completed', 'cancelled'
    )
  ),
  add constraint live_battle_public_states_rematch_request_status_check check (
    rematch_request_status is null or rematch_request_status in (
      'pending', 'accepted', 'rejected', 'expired', 'cancelled'
    )
  ),
  add constraint live_battle_public_states_rematch_request_shape_check check (
    (
      rematch_request_id is null and
      rematch_request_after_battle_id is null and
      rematch_request_status is null and
      rematch_requested_by_user_id is null and
      rematch_request_expires_at is null
    ) or (
      rematch_request_id is not null and
      rematch_request_after_battle_id = battle_id and
      rematch_request_status is not null and
      rematch_requested_by_user_id is not null and
      rematch_request_expires_at is not null
    )
  ),
  add constraint live_battle_public_states_series_counters_check check (
    series_id is null or (
      round_number between 1 and 5 and
      series_max_rounds in (1, 5) and series_wins_required in (1, 3) and
      challenger_series_wins >= 0 and opponent_series_wins >= 0 and
      series_ties >= 0 and series_rounds_completed >= 0 and
      series_rounds_completed <= series_max_rounds and
      series_format is not null and series_status is not null and
      series_version is not null
    )
  );

create or replace function private.validate_live_battle_rematch_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.live_battle_series%rowtype;
  v_battle public.live_battles%rowtype;
  v_counterpart uuid;
begin
  select series.* into strict v_series
  from public.live_battle_series as series
  where series.id = new.series_id;

  select battle.* into strict v_battle
  from public.live_battles as battle
  where battle.id = new.after_battle_id;

  if v_battle.series_id <> new.series_id then
    raise exception using errcode = '23514',
      message = 'live_battle_rematch_battle_series_mismatch';
  end if;
  if new.requested_by_user_id = v_series.challenger_user_id then
    v_counterpart := v_series.opponent_user_id;
  elsif new.requested_by_user_id = v_series.opponent_user_id then
    v_counterpart := v_series.challenger_user_id;
  else
    raise exception using errcode = '23514',
      message = 'live_battle_rematch_requester_not_participant';
  end if;
  if new.responded_by_user_id is not null and
     new.responded_by_user_id <> v_counterpart then
    raise exception using errcode = '23514',
      message = 'live_battle_rematch_responder_not_counterpart';
  end if;
  return new;
end;
$$;

create trigger live_battle_rematch_requests_validate
before insert or update on public.live_battle_rematch_requests
for each row execute function private.validate_live_battle_rematch_request();

create or replace function private.live_battle_series_champion(
  p_challenger_user_id uuid,
  p_opponent_user_id uuid,
  p_challenger_wins smallint,
  p_opponent_wins smallint
)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_challenger_wins > p_opponent_wins then p_challenger_user_id
    when p_opponent_wins > p_challenger_wins then p_opponent_user_id
    else null::uuid
  end;
$$;

create or replace function private.sync_live_battle_series_projection_locked(
  p_series_id uuid,
  p_server_clock_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.live_battle_series%rowtype;
begin
  select series.* into strict v_series
  from public.live_battle_series as series
  where series.id = p_series_id;

  update public.live_battle_public_states as projection
  set series_id = v_series.id,
      series_format = v_series.format,
      round_number = battle.round_number,
      series_max_rounds = v_series.max_rounds,
      series_wins_required = v_series.wins_required,
      challenger_series_wins = v_series.challenger_wins,
      opponent_series_wins = v_series.opponent_wins,
      series_ties = v_series.ties,
      series_rounds_completed = v_series.rounds_completed,
      series_status = v_series.status,
      series_champion_user_id = v_series.champion_user_id,
      series_version = v_series.version,
      rematch_request_id = request.id,
      rematch_request_after_battle_id = request.after_battle_id,
      rematch_request_status = request.status,
      rematch_requested_by_user_id = request.requested_by_user_id,
      rematch_request_expires_at = request.expires_at,
      rematch_window_expires_at = v_series.rematch_window_expires_at,
      server_clock_at = p_server_clock_at,
      projection_version = projection.projection_version + 1
  from public.live_battles as battle
  left join lateral (
    select candidate.id, candidate.after_battle_id, candidate.status,
      candidate.requested_by_user_id, candidate.expires_at
    from public.live_battle_rematch_requests as candidate
    where candidate.series_id = p_series_id
      and candidate.after_battle_id = battle.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) as request on true
  where battle.id = projection.battle_id
    and battle.series_id = p_series_id
    and (
      projection.series_version is distinct from v_series.version or
      projection.series_status is distinct from v_series.status or
      projection.rematch_request_id is distinct from request.id or
      projection.rematch_request_after_battle_id is distinct from request.after_battle_id or
      projection.rematch_request_status is distinct from request.status or
      projection.rematch_requested_by_user_id is distinct from request.requested_by_user_id or
      projection.rematch_request_expires_at is distinct from request.expires_at or
      projection.rematch_window_expires_at is distinct from v_series.rematch_window_expires_at
    );
end;
$$;

create or replace function private.rebuild_live_battle_series_locked(
  p_series_id uuid,
  p_now timestamptz
)
returns public.live_battle_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.live_battle_series%rowtype;
  v_challenger_wins smallint;
  v_opponent_wins smallint;
  v_ties smallint;
  v_rounds_completed smallint;
  v_cancelled boolean;
  v_last_finalized_at timestamptz;
  v_status text;
  v_champion uuid;
  v_completed_at timestamptz;
  v_rematch_expires_at timestamptz;
begin
  select series.* into v_series
  from public.live_battle_series as series
  where series.id = p_series_id
  for update skip locked;
  if not found then
    return null;
  end if;

  select
    count(*) filter (where battle.status = 'completed' and score.outcome = 'challenger')::smallint,
    count(*) filter (where battle.status = 'completed' and score.outcome = 'opponent')::smallint,
    count(*) filter (where battle.status = 'completed' and score.outcome = 'tie')::smallint,
    count(*) filter (where battle.status = 'completed' and
      score.outcome in ('challenger', 'opponent', 'tie'))::smallint,
    bool_or(
      battle.status in ('rejected', 'cancelled', 'expired') or
      score.outcome = 'cancelled'
    ),
    max(score.finalized_at) filter (where battle.status = 'completed' and
      score.outcome in ('challenger', 'opponent', 'tie'))
  into v_challenger_wins, v_opponent_wins, v_ties,
       v_rounds_completed, v_cancelled, v_last_finalized_at
  from public.live_battles as battle
  join public.live_battle_score_states as score on score.battle_id = battle.id
  where battle.series_id = p_series_id;

  v_challenger_wins := coalesce(v_challenger_wins, 0);
  v_opponent_wins := coalesce(v_opponent_wins, 0);
  v_ties := coalesce(v_ties, 0);
  v_rounds_completed := coalesce(v_rounds_completed, 0);
  v_cancelled := coalesce(v_cancelled, false);

  if v_series.status = 'cancelled' or v_cancelled then
    v_status := 'cancelled';
    v_champion := null;
    v_completed_at := coalesce(v_series.completed_at, p_now);
    v_rematch_expires_at := null;
  elsif v_series.status = 'completed' then
    v_status := 'completed';
    v_champion := private.live_battle_series_champion(
      v_series.challenger_user_id, v_series.opponent_user_id,
      v_challenger_wins, v_opponent_wins
    );
    v_completed_at := coalesce(v_series.completed_at, p_now);
    v_rematch_expires_at := null;
  elsif v_challenger_wins >= v_series.wins_required or
        v_opponent_wins >= v_series.wins_required or
        v_rounds_completed >= v_series.max_rounds then
    v_status := 'completed';
    v_champion := private.live_battle_series_champion(
      v_series.challenger_user_id, v_series.opponent_user_id,
      v_challenger_wins, v_opponent_wins
    );
    v_completed_at := coalesce(v_last_finalized_at, p_now);
    v_rematch_expires_at := null;
  elsif exists (
    select 1 from public.live_battles as battle
    where battle.series_id = p_series_id
      and battle.status in ('pending', 'accepted', 'countdown', 'active')
  ) then
    v_status := 'active';
    v_champion := null;
    v_completed_at := null;
    v_rematch_expires_at := null;
  elsif v_rounds_completed > 0 then
    v_status := case when exists (
      select 1 from public.live_battle_rematch_requests as request
      where request.series_id = p_series_id and request.status = 'pending'
    ) then 'rematch_pending' else 'awaiting_rematch' end;
    v_champion := null;
    v_completed_at := null;
    v_rematch_expires_at := v_last_finalized_at + interval '30 seconds';
  else
    v_status := 'active';
    v_champion := null;
    v_completed_at := null;
    v_rematch_expires_at := null;
  end if;

  update public.live_battle_series as series
  set challenger_wins = v_challenger_wins,
      opponent_wins = v_opponent_wins,
      ties = v_ties,
      rounds_completed = v_rounds_completed,
      status = v_status,
      champion_user_id = v_champion,
      rematch_window_expires_at = v_rematch_expires_at,
      completed_at = v_completed_at,
      updated_at = p_now,
      version = case when
        series.challenger_wins is distinct from v_challenger_wins or
        series.opponent_wins is distinct from v_opponent_wins or
        series.ties is distinct from v_ties or
        series.rounds_completed is distinct from v_rounds_completed or
        series.status is distinct from v_status or
        series.champion_user_id is distinct from v_champion or
        series.rematch_window_expires_at is distinct from v_rematch_expires_at or
        series.completed_at is distinct from v_completed_at
      then series.version + 1 else series.version end
  where series.id = p_series_id
  returning * into v_series;

  perform private.sync_live_battle_series_projection_locked(p_series_id, p_now);
  return v_series;
end;
$$;

create or replace function private.live_battle_series_score_finalized_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
begin
  if new.outcome in ('challenger', 'opponent', 'tie', 'cancelled') and
     new.finalized_at is not null and
     (tg_op = 'INSERT' or old.outcome is distinct from new.outcome or
      old.finalized_at is distinct from new.finalized_at) then
    select battle.series_id into strict v_series_id
    from public.live_battles as battle
    where battle.id = new.battle_id;
    perform private.rebuild_live_battle_series_locked(
      v_series_id,
      pg_catalog.clock_timestamp()
    );
  end if;
  return new;
end;
$$;

create trigger live_battle_score_states_rebuild_series
after insert or update on public.live_battle_score_states
for each row execute function private.live_battle_series_score_finalized_trigger();

create or replace function private.live_battle_rematch_to_json(
  p_request public.live_battle_rematch_requests
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_request.id,
    'series_id', p_request.series_id,
    'after_battle_id', p_request.after_battle_id,
    'requested_by_user_id', p_request.requested_by_user_id,
    'status', p_request.status,
    'expires_at', p_request.expires_at,
    'responded_by_user_id', p_request.responded_by_user_id,
    'responded_at', p_request.responded_at,
    'created_at', p_request.created_at,
    'updated_at', p_request.updated_at
  );
$$;

create or replace function private.live_battle_series_to_json(
  p_series public.live_battle_series
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_series.id,
    'format', p_series.format,
    'max_rounds', p_series.max_rounds,
    'wins_required', p_series.wins_required,
    'status', p_series.status,
    'challenger_wins', p_series.challenger_wins,
    'opponent_wins', p_series.opponent_wins,
    'ties', p_series.ties,
    'rounds_completed', p_series.rounds_completed,
    'champion_user_id', p_series.champion_user_id,
    'rematch_window_expires_at', p_series.rematch_window_expires_at,
    'version', p_series.version,
    'completed_at', p_series.completed_at
  );
$$;

create or replace function private.reconcile_live_battle_series_locked(
  p_series_id uuid,
  p_now timestamptz
)
returns public.live_battle_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.live_battle_series%rowtype;
  v_champion uuid;
begin
  v_series := private.rebuild_live_battle_series_locked(p_series_id, p_now);
  if v_series.id is null then
    return null;
  end if;

  if v_series.status in ('awaiting_rematch', 'rematch_pending') and
     v_series.rematch_window_expires_at <= p_now then
    update public.live_battle_rematch_requests as request
    set status = 'expired', responded_at = p_now,
        responded_by_user_id = null, updated_at = p_now
    where request.series_id = p_series_id
      and request.status = 'pending';

    v_champion := private.live_battle_series_champion(
      v_series.challenger_user_id, v_series.opponent_user_id,
      v_series.challenger_wins, v_series.opponent_wins
    );
    update public.live_battle_series as series
    set status = 'completed', champion_user_id = v_champion,
        rematch_window_expires_at = null, completed_at = p_now,
        updated_at = p_now, version = series.version + 1
    where series.id = p_series_id
    returning * into v_series;
    perform private.sync_live_battle_series_projection_locked(p_series_id, p_now);
  end if;
  return v_series;
end;
$$;

create or replace function private.reconcile_due_live_battle_series(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_candidate record;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023',
      message = 'live_battle_series_reconcile_limit_invalid';
  end if;

  for v_candidate in
    select series.id
    from public.live_battle_series as series
    where series.status in ('awaiting_rematch', 'rematch_pending')
      and series.rematch_window_expires_at <= v_now
    order by series.rematch_window_expires_at, series.id
    for update skip locked
    limit p_limit
  loop
    perform private.reconcile_live_battle_series_locked(v_candidate.id, v_now);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.request_live_battle_rematch(
  p_battle_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_battle public.live_battles%rowtype;
  v_series public.live_battle_series%rowtype;
  v_request public.live_battle_rematch_requests%rowtype;
  v_latest_round smallint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_rematch_auth_required';
  end if;
  if p_battle_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'live_battle_rematch_arguments_invalid';
  end if;

  select battle.* into v_battle from public.live_battles as battle
  where battle.id = p_battle_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_rematch_battle_not_found';
  end if;
  if v_actor not in (v_battle.challenger_user_id, v_battle.opponent_user_id) then
    raise exception using errcode = '42501', message = 'live_battle_rematch_not_participant';
  end if;

  perform private.live_battle_lock_users(
    v_battle.challenger_user_id, v_battle.opponent_user_id
  );
  perform private.live_battle_lock_sessions(
    v_battle.challenger_session_id, v_battle.opponent_session_id
  );
  select series.* into strict v_series
  from public.live_battle_series as series
  where series.id = v_battle.series_id
  for update;
  select battle.* into strict v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;

  v_series := private.reconcile_live_battle_series_locked(v_series.id, v_now);

  select request.* into v_request
  from public.live_battle_rematch_requests as request
  where request.requested_by_user_id = v_actor
    and request.idempotency_key = p_idempotency_key
  for update;
  if found then
    return private.live_battle_rematch_to_json(v_request);
  end if;

  if v_battle.status <> 'completed' then
    raise exception using errcode = '55000', message = 'live_battle_rematch_round_not_completed';
  end if;
  select max(battle.round_number) into v_latest_round
  from public.live_battles as battle where battle.series_id = v_series.id;
  if v_battle.round_number <> v_latest_round then
    raise exception using errcode = '55000', message = 'live_battle_rematch_round_not_latest';
  end if;
  if v_series.format <> 'best_of_5' or
     v_series.status not in ('awaiting_rematch', 'rematch_pending') or
     v_series.rounds_completed >= 5 or
     v_series.challenger_wins >= 3 or v_series.opponent_wins >= 3 then
    raise exception using errcode = '55000', message = 'live_battle_rematch_series_not_open';
  end if;
  if v_series.rematch_window_expires_at is null or
     v_series.rematch_window_expires_at <= v_now then
    raise exception using errcode = '55000', message = 'live_battle_rematch_window_expired';
  end if;
  if not private.live_battle_session_pair_is_live(
    v_series.challenger_session_id, v_series.challenger_user_id,
    v_series.opponent_session_id, v_series.opponent_user_id
  ) then
    raise exception using errcode = '55000', message = 'live_battle_rematch_sessions_not_live';
  end if;

  select request.* into v_request
  from public.live_battle_rematch_requests as request
  where request.series_id = v_series.id
    and request.after_battle_id = v_battle.id
    and request.status = 'pending'
  for update;
  if found then
    return private.live_battle_rematch_to_json(v_request);
  end if;

  insert into public.live_battle_rematch_requests (
    series_id, after_battle_id, requested_by_user_id,
    status, idempotency_key, expires_at,
    created_at, updated_at
  ) values (
    v_series.id, v_battle.id, v_actor,
    'pending', p_idempotency_key, v_series.rematch_window_expires_at,
    v_now, v_now
  ) returning * into v_request;

  update public.live_battle_series as series
  set status = 'rematch_pending', updated_at = v_now,
      version = series.version + 1
  where series.id = v_series.id;
  perform private.sync_live_battle_series_projection_locked(v_series.id, v_now);
  return private.live_battle_rematch_to_json(v_request);
exception
  when unique_violation then
    select request.* into v_request
    from public.live_battle_rematch_requests as request
    where (request.requested_by_user_id = v_actor and
           request.idempotency_key = p_idempotency_key)
       or (request.series_id = v_battle.series_id and
           request.after_battle_id = p_battle_id and request.status = 'pending')
    order by request.created_at, request.id
    limit 1;
    if found then
      return private.live_battle_rematch_to_json(v_request);
    end if;
    raise;
end;
$$;

create or replace function public.respond_live_battle_rematch(
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_request public.live_battle_rematch_requests%rowtype;
  v_series public.live_battle_series%rowtype;
  v_previous public.live_battles%rowtype;
  v_new_battle public.live_battles%rowtype;
  v_counterpart uuid;
  v_rule_set_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_rematch_auth_required';
  end if;
  if p_request_id is null or p_decision not in ('accept', 'reject') then
    raise exception using errcode = '22023', message = 'live_battle_rematch_decision_invalid';
  end if;

  select request.* into v_request
  from public.live_battle_rematch_requests as request
  where request.id = p_request_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_rematch_request_not_found';
  end if;
  select series.* into strict v_series
  from public.live_battle_series as series where series.id = v_request.series_id;
  v_counterpart := case
    when v_request.requested_by_user_id = v_series.challenger_user_id
      then v_series.opponent_user_id
    else v_series.challenger_user_id
  end;
  if v_actor <> v_counterpart then
    raise exception using errcode = '42501', message = 'live_battle_rematch_responder_not_counterpart';
  end if;

  perform private.live_battle_lock_users(
    v_series.challenger_user_id, v_series.opponent_user_id
  );
  perform private.live_battle_lock_sessions(
    v_series.challenger_session_id, v_series.opponent_session_id
  );
  select series.* into strict v_series
  from public.live_battle_series as series
  where series.id = v_request.series_id
  for update;
  select battle.* into strict v_previous
  from public.live_battles as battle
  where battle.id = v_request.after_battle_id
  for update;
  select request.* into strict v_request
  from public.live_battle_rematch_requests as request
  where request.id = p_request_id
  for update;

  if v_request.status = 'accepted' and p_decision = 'accept' then
    select battle.* into strict v_new_battle
    from public.live_battles as battle
    where battle.series_id = v_series.id
      and battle.round_number = v_previous.round_number + 1;
    return pg_catalog.jsonb_build_object(
      'request', private.live_battle_rematch_to_json(v_request),
      'battle', private.live_battle_to_json(v_new_battle),
      'series', private.live_battle_series_to_json(v_series)
    );
  elsif v_request.status = 'rejected' and p_decision = 'reject' then
    return pg_catalog.jsonb_build_object(
      'request', private.live_battle_rematch_to_json(v_request),
      'battle', null,
      'series', private.live_battle_series_to_json(v_series)
    );
  elsif v_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'live_battle_rematch_request_not_pending';
  end if;

  v_series := private.reconcile_live_battle_series_locked(v_series.id, v_now);
  if v_request.expires_at <= v_now or v_series.status = 'completed' then
    raise exception using errcode = '55000', message = 'live_battle_rematch_request_expired';
  end if;
  if v_previous.status <> 'completed' then
    raise exception using errcode = '55000', message = 'live_battle_rematch_round_not_completed';
  end if;
  if not private.live_battle_session_pair_is_live(
    v_series.challenger_session_id, v_series.challenger_user_id,
    v_series.opponent_session_id, v_series.opponent_user_id
  ) then
    raise exception using errcode = '55000', message = 'live_battle_rematch_sessions_not_live';
  end if;

  if p_decision = 'reject' then
    update public.live_battle_rematch_requests as request
    set status = 'rejected', responded_by_user_id = v_actor,
        responded_at = v_now, updated_at = v_now
    where request.id = v_request.id
    returning * into v_request;
    update public.live_battle_series as series
    set status = 'completed',
        champion_user_id = private.live_battle_series_champion(
          series.challenger_user_id, series.opponent_user_id,
          series.challenger_wins, series.opponent_wins
        ),
        rematch_window_expires_at = null,
        completed_at = v_now, updated_at = v_now,
        version = series.version + 1
    where series.id = v_series.id
    returning * into v_series;
    perform private.sync_live_battle_series_projection_locked(v_series.id, v_now);
    return pg_catalog.jsonb_build_object(
      'request', private.live_battle_rematch_to_json(v_request),
      'battle', null,
      'series', private.live_battle_series_to_json(v_series)
    );
  end if;

  if v_series.format <> 'best_of_5' or
     v_series.status <> 'rematch_pending' or
     v_series.rounds_completed >= v_series.max_rounds or
     v_series.challenger_wins >= v_series.wins_required or
     v_series.opponent_wins >= v_series.wins_required or
     v_previous.round_number >= v_series.max_rounds then
    raise exception using errcode = '55000', message = 'live_battle_rematch_series_not_open';
  end if;
  if exists (
    select 1 from public.live_battles as battle
    where battle.series_id = v_series.id
      and battle.round_number = v_previous.round_number + 1
  ) then
    select battle.* into strict v_new_battle
    from public.live_battles as battle
    where battle.series_id = v_series.id
      and battle.round_number = v_previous.round_number + 1;
  else
    select current_rules.rule_set_id into strict v_rule_set_id
    from public.live_battle_current_rule_set as current_rules
    where current_rules.singleton;
    insert into public.live_battles (
      challenger_user_id, opponent_user_id,
      challenger_session_id, opponent_session_id,
      status, invite_expires_at, accepted_at,
      countdown_started_at, scheduled_start_at,
      last_transition_actor_id, last_transition_reason,
      version, created_at, updated_at, battle_rule_set_id,
      series_id, round_number
    ) values (
      v_series.challenger_user_id, v_series.opponent_user_id,
      v_series.challenger_session_id, v_series.opponent_session_id,
      'countdown', v_now + interval '30 seconds', v_now,
      v_now, v_now + interval '3 seconds',
      v_actor, 'rematch_countdown_started',
      3, v_now, v_now, v_rule_set_id,
      v_series.id, v_previous.round_number + 1
    ) returning * into v_new_battle;

    insert into public.live_battle_events (
      battle_id, actor_user_id, from_status, to_status,
      reason, version, created_at
    ) values
      (v_new_battle.id, v_request.requested_by_user_id, null, 'pending',
       'rematch_round_created', 1, v_now),
      (v_new_battle.id, v_actor, 'pending', 'accepted',
       'rematch_bilateral_accepted', 2, v_now),
      (v_new_battle.id, v_actor, 'accepted', 'countdown',
       'rematch_countdown_started', 3, v_now);
  end if;

  update public.live_battle_rematch_requests as request
  set status = 'accepted', responded_by_user_id = v_actor,
      responded_at = v_now, updated_at = v_now
  where request.id = v_request.id
  returning * into v_request;
  update public.live_battle_series as series
  set status = 'active', rematch_window_expires_at = null,
      updated_at = v_now, version = series.version + 1
  where series.id = v_series.id
  returning * into v_series;
  perform private.sync_live_battle_series_projection_locked(v_series.id, v_now);

  return pg_catalog.jsonb_build_object(
    'request', private.live_battle_rematch_to_json(v_request),
    'battle', private.live_battle_to_json(v_new_battle),
    'series', private.live_battle_series_to_json(v_series)
  );
end;
$$;

create or replace function public.leave_live_battle_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_series public.live_battle_series%rowtype;
  v_latest public.live_battles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_series_auth_required';
  end if;
  select series.* into v_series from public.live_battle_series as series
  where series.id = p_series_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_series_not_found';
  end if;
  if v_actor not in (v_series.challenger_user_id, v_series.opponent_user_id) then
    raise exception using errcode = '42501', message = 'live_battle_series_not_participant';
  end if;

  perform private.live_battle_lock_users(
    v_series.challenger_user_id, v_series.opponent_user_id
  );
  perform private.live_battle_lock_sessions(
    v_series.challenger_session_id, v_series.opponent_session_id
  );
  select series.* into strict v_series
  from public.live_battle_series as series where series.id = p_series_id
  for update;
  select battle.* into v_latest
  from public.live_battles as battle
  where battle.series_id = p_series_id
  order by battle.round_number desc
  limit 1
  for update;

  if v_series.status in ('completed', 'cancelled') then
    return private.live_battle_series_to_json(v_series);
  end if;
  v_series := private.reconcile_live_battle_series_locked(p_series_id, v_now);
  if v_series.status in ('completed', 'cancelled') then
    return private.live_battle_series_to_json(v_series);
  end if;
  if v_latest.status in ('pending', 'accepted', 'countdown', 'active') or
     v_series.rounds_completed = 0 then
    raise exception using errcode = '55000', message = 'live_battle_series_not_between_rounds';
  end if;

  update public.live_battle_rematch_requests as request
  set status = 'cancelled', responded_by_user_id = null,
      responded_at = v_now, updated_at = v_now
  where request.series_id = p_series_id and request.status = 'pending';
  update public.live_battle_series as series
  set status = 'completed',
      champion_user_id = private.live_battle_series_champion(
        series.challenger_user_id, series.opponent_user_id,
        series.challenger_wins, series.opponent_wins
      ),
      rematch_window_expires_at = null,
      completed_at = v_now, updated_at = v_now,
      version = series.version + 1
  where series.id = p_series_id
  returning * into v_series;
  perform private.sync_live_battle_series_projection_locked(p_series_id, v_now);
  return private.live_battle_series_to_json(v_series);
end;
$$;

create or replace function public.create_live_battle_invite(
  p_opponent_user_id uuid,
  p_challenger_session_id uuid,
  p_opponent_session_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
  v_existing public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
  v_series public.live_battle_series%rowtype;
  v_rule_set_id uuid;
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
  perform private.live_battle_lock_sessions(
    p_challenger_session_id, p_opponent_session_id
  );
  select * into v_challenger_session
  from public.live_sessions as session
  where session.id = p_challenger_session_id;
  select * into v_opponent_session
  from public.live_sessions as session
  where session.id = p_opponent_session_id;
  if v_challenger_session.host_id <> v_actor then
    raise exception using errcode = '42501',
      message = 'live_battle_challenger_not_host';
  end if;
  if v_opponent_session.host_id <> p_opponent_user_id then
    raise exception using errcode = '42501',
      message = 'live_battle_opponent_not_host';
  end if;
  if not private.live_battle_session_pair_is_live(
    p_challenger_session_id, v_actor,
    p_opponent_session_id, p_opponent_user_id
  ) then
    raise exception using errcode = '55000',
      message = 'live_battle_session_not_live';
  end if;

  select series.* into v_series
  from public.live_battle_series as series
  where series.status in ('active', 'awaiting_rematch', 'rematch_pending')
    and least(series.challenger_user_id, series.opponent_user_id) =
        least(v_actor, p_opponent_user_id)
    and greatest(series.challenger_user_id, series.opponent_user_id) =
        greatest(v_actor, p_opponent_user_id)
  for update;
  if found then
    v_series := private.reconcile_live_battle_series_locked(v_series.id, v_now);
  end if;

  select * into v_existing
  from public.live_battles as battle
  where battle.status in ('pending', 'accepted', 'countdown', 'active')
    and (
      (battle.challenger_user_id = v_actor and
       battle.opponent_user_id = p_opponent_user_id) or
      (battle.challenger_user_id = p_opponent_user_id and
       battle.opponent_user_id = v_actor)
    )
  order by battle.created_at desc
  limit 1
  for update;
  if found then
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
  if v_series.id is not null then
    v_series := private.reconcile_live_battle_series_locked(v_series.id, v_now);
  end if;
  if v_series.status in ('active', 'awaiting_rematch', 'rematch_pending') then
    raise exception using errcode = '55000', message = 'live_battle_series_pair_busy';
  end if;

  insert into public.live_battle_series (
    challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    format, max_rounds, wins_required, status,
    created_at, updated_at
  ) values (
    v_actor, p_opponent_user_id,
    p_challenger_session_id, p_opponent_session_id,
    'best_of_5', 5, 3, 'active', v_now, v_now
  ) returning * into v_series;

  select current_rules.rule_set_id into strict v_rule_set_id
  from public.live_battle_current_rule_set as current_rules
  where current_rules.singleton;
  insert into public.live_battles (
    challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at,
    battle_rule_set_id, series_id, round_number
  ) values (
    v_actor, p_opponent_user_id,
    p_challenger_session_id, p_opponent_session_id,
    'pending', v_now + interval '30 seconds', v_actor,
    'invite_created', 1, v_now, v_now,
    v_rule_set_id, v_series.id, 1
  ) returning * into v_battle;
  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, v_actor, null, 'pending', 'invite_created', 1, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

alter function private.sync_live_battle_public_states()
  rename to sync_live_battle_public_competitive_states;

create or replace function private.sync_live_battle_public_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' then
    perform private.sync_live_battle_series_projection_locked(
      new.series_id,
      pg_catalog.clock_timestamp()
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger live_battles_sync_series_public_states
after insert or update or delete on public.live_battles
for each row execute function private.sync_live_battle_public_states();

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
        'local_battle_side', public_state.local_battle_side,
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
        'challenger_rose_progress_units', public_state.challenger_rose_progress_units,
        'opponent_rose_progress_units', public_state.opponent_rose_progress_units,
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
      ) || pg_catalog.jsonb_build_object(
        'series_id', public_state.series_id,
        'series_format', public_state.series_format,
        'round_number', public_state.round_number,
        'series_max_rounds', public_state.series_max_rounds,
        'series_wins_required', public_state.series_wins_required,
        'challenger_series_wins', public_state.challenger_series_wins,
        'opponent_series_wins', public_state.opponent_series_wins,
        'series_ties', public_state.series_ties,
        'series_rounds_completed', public_state.series_rounds_completed,
        'series_status', public_state.series_status,
        'series_champion_user_id', public_state.series_champion_user_id,
        'series_version', public_state.series_version,
        'rematch_request_id', public_state.rematch_request_id,
        'rematch_request_after_battle_id',
          public_state.rematch_request_after_battle_id,
        'rematch_request_status', public_state.rematch_request_status,
        'rematch_requested_by_user_id', public_state.rematch_requested_by_user_id,
        'rematch_request_expires_at', public_state.rematch_request_expires_at,
        'rematch_window_expires_at', public_state.rematch_window_expires_at
      )
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

do $$
declare
  v_job record;
  v_job_id bigint;
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise exception 'live Battle series reconciliation requires pg_cron';
  end if;
  for v_job in
    select jobid from cron.job
    where jobname = 'reconcile-due-live-battle-series'
    order by jobid
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  select cron.schedule(
    'reconcile-due-live-battle-series',
    '* * * * *',
    'select private.reconcile_due_live_battle_series(100);'
  ) into v_job_id;
  if not exists (
    select 1 from cron.job
    where jobid = v_job_id
      and jobname = 'reconcile-due-live-battle-series'
      and schedule = '* * * * *'
      and command = 'select private.reconcile_due_live_battle_series(100);'
      and active and username = 'postgres'
  ) then
    raise exception 'live Battle series reconciliation cron installation failed';
  end if;
end;
$$;

select private.reconcile_due_live_battle_series(100);

alter table public.live_battle_series owner to postgres;
alter table public.live_battle_rematch_requests owner to postgres;

alter function private.validate_live_battle_rematch_request() owner to postgres;
alter function private.clear_stale_live_battle_rematch_projection()
  owner to postgres;
alter function private.live_battle_series_champion(uuid, uuid, smallint, smallint)
  owner to postgres;
alter function private.sync_live_battle_series_projection_locked(uuid, timestamptz)
  owner to postgres;
alter function private.rebuild_live_battle_series_locked(uuid, timestamptz)
  owner to postgres;
alter function private.live_battle_series_score_finalized_trigger()
  owner to postgres;
alter function private.live_battle_rematch_to_json(public.live_battle_rematch_requests)
  owner to postgres;
alter function private.live_battle_series_to_json(public.live_battle_series)
  owner to postgres;
alter function private.reconcile_live_battle_series_locked(uuid, timestamptz)
  owner to postgres;
alter function private.reconcile_due_live_battle_series(integer)
  owner to postgres;
alter function private.sync_live_battle_public_competitive_states()
  owner to postgres;
alter function private.sync_live_battle_public_states() owner to postgres;
alter function public.request_live_battle_rematch(uuid, uuid) owner to postgres;
alter function public.respond_live_battle_rematch(uuid, text) owner to postgres;
alter function public.leave_live_battle_series(uuid) owner to postgres;
alter function public.create_live_battle_invite(uuid, uuid, uuid) owner to postgres;
alter function public.get_live_battle_public_snapshot(uuid) owner to postgres;

revoke all on function private.validate_live_battle_rematch_request()
  from public, anon, authenticated, service_role;
revoke all on function private.clear_stale_live_battle_rematch_projection()
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_series_champion(uuid, uuid, smallint, smallint)
  from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_series_projection_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.rebuild_live_battle_series_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_series_score_finalized_trigger()
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_rematch_to_json(public.live_battle_rematch_requests)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_series_to_json(public.live_battle_series)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_live_battle_series_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_due_live_battle_series(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_public_competitive_states()
  from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_public_states()
  from public, anon, authenticated, service_role;
revoke all on function public.request_live_battle_rematch(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_live_battle_rematch(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.leave_live_battle_series(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_live_battle_invite(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_live_battle_public_snapshot(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.request_live_battle_rematch(uuid, uuid)
  to authenticated;
grant execute on function public.respond_live_battle_rematch(uuid, text)
  to authenticated;
grant execute on function public.leave_live_battle_series(uuid)
  to authenticated;
grant execute on function public.create_live_battle_invite(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.get_live_battle_public_snapshot(uuid)
  to authenticated;

comment on table public.live_battle_series is
  'Server-only authoritative best-of-five Battle series aggregate.';
comment on table public.live_battle_rematch_requests is
  'Server-only bilateral rematch decisions between canonical Battle hosts.';

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('live_battle_series', 'live_battle_rematch_requests')
  ) then
    raise exception 'live Battle series internal tables must not expose policies';
  end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where schemaname = 'public'
      and tablename in ('live_battle_series', 'live_battle_rematch_requests')
  ) then
    raise exception 'live Battle series internal tables published unexpectedly';
  end if;
  if (
    select pg_catalog.count(*) from public.live_battles
  ) <> (
    select pg_catalog.count(*) from public.live_battles
    where series_id is not null and round_number between 1 and 5
  ) then
    raise exception 'live Battle series backfill incomplete';
  end if;
end;
$$;

commit;
