begin;

create table public.live_battle_score_events (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.live_battles(id) on delete cascade,
  gift_transaction_id uuid not null unique
    references public.live_gift_transactions(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  base_points bigint not null,
  multiplier integer not null default 1,
  awarded_points bigint not null,
  boost_id uuid,
  rule_version integer not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_score_events_base_points_check check (base_points >= 0),
  constraint live_battle_score_events_multiplier_check check (multiplier >= 1),
  constraint live_battle_score_events_awarded_points_check
    check (awarded_points = base_points * multiplier),
  constraint live_battle_score_events_f4b_rule_check
    check (multiplier = 1 and boost_id is null and rule_version = 1)
);

create index live_battle_score_events_battle_target_created_idx
  on public.live_battle_score_events (battle_id, target_user_id, created_at, id);
create index live_battle_score_events_target_user_idx
  on public.live_battle_score_events (target_user_id);

comment on table public.live_battle_score_events is
  'Immutable competitive facts. One server-side score event per confirmed Battle gift.';
comment on column public.live_battle_score_events.base_points is
  'Gross gift value in BDAG. F4B uses 1 BDAG = 1 base point.';
comment on column public.live_battle_score_events.multiplier is
  'Reserved multiplier contract for F4D. F4B enforces multiplier 1.';
comment on column public.live_battle_score_events.boost_id is
  'Reserved immutable boost attribution for F4D. F4B enforces NULL.';

alter table public.live_battle_score_events enable row level security;
revoke all on table public.live_battle_score_events
  from public, anon, authenticated, service_role;

create table public.live_battle_score_states (
  battle_id uuid primary key references public.live_battles(id) on delete cascade,
  challenger_score bigint not null default 0,
  opponent_score bigint not null default 0,
  score_version bigint not null default 0,
  outcome text not null default 'pending',
  winner_user_id uuid references auth.users(id) on delete restrict,
  finalized_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_score_states_scores_check
    check (challenger_score >= 0 and opponent_score >= 0),
  constraint live_battle_score_states_version_check check (score_version >= 0),
  constraint live_battle_score_states_outcome_check
    check (outcome in ('pending', 'challenger', 'opponent', 'tie', 'cancelled')),
  constraint live_battle_score_states_finalization_check check (
    (outcome = 'pending' and winner_user_id is null and finalized_at is null) or
    (outcome in ('challenger', 'opponent') and winner_user_id is not null and finalized_at is not null) or
    (outcome in ('tie', 'cancelled') and winner_user_id is null and finalized_at is not null)
  ),
  constraint live_battle_score_states_result_check check (
    outcome in ('pending', 'cancelled') or
    (outcome = 'challenger' and challenger_score > opponent_score) or
    (outcome = 'opponent' and opponent_score > challenger_score) or
    (outcome = 'tie' and challenger_score = opponent_score)
  )
);

create index live_battle_score_states_winner_idx
  on public.live_battle_score_states (winner_user_id)
  where winner_user_id is not null;

comment on table public.live_battle_score_states is
  'Server-only Battle aggregate and terminal result reconstructable from score events.';
comment on column public.live_battle_score_states.score_version is
  'Competitive version independent from live_battles.version.';

alter table public.live_battle_score_states enable row level security;
revoke all on table public.live_battle_score_states
  from public, anon, authenticated, service_role;

alter table public.live_battle_public_states
  add column challenger_score bigint not null default 0,
  add column opponent_score bigint not null default 0,
  add column score_version bigint not null default 0,
  add column outcome text not null default 'pending',
  add column winner_user_id uuid,
  add column score_updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  add column projection_version bigint not null default 1,
  add constraint live_battle_public_states_scores_check
    check (challenger_score >= 0 and opponent_score >= 0),
  add constraint live_battle_public_states_score_version_check check (score_version >= 0),
  add constraint live_battle_public_states_outcome_check
    check (outcome in ('pending', 'challenger', 'opponent', 'tie', 'cancelled')),
  add constraint live_battle_public_states_winner_check check (
    (outcome in ('pending', 'tie', 'cancelled') and winner_user_id is null) or
    (outcome in ('challenger', 'opponent') and winner_user_id in (
      local_host_user_id, opponent_host_user_id
    ))
  ),
  add constraint live_battle_public_states_result_check check (
    outcome in ('pending', 'cancelled') or
    (outcome = 'challenger' and challenger_score > opponent_score) or
    (outcome = 'opponent' and opponent_score > challenger_score) or
    (outcome = 'tie' and challenger_score = opponent_score)
  ),
  add constraint live_battle_public_states_projection_version_check
    check (projection_version >= 1);

comment on column public.live_battle_public_states.projection_version is
  'Monotonic public projection version spanning lifecycle and score updates.';
comment on column public.live_battle_public_states.score_version is
  'Competitive version independent from the Battle lifecycle version.';

insert into public.live_battle_score_events (
  battle_id, gift_transaction_id, target_user_id, base_points,
  multiplier, awarded_points, boost_id, rule_version, created_at
)
select
  gift.battle_id, gift.id, gift.receiver_user_id, gift.amount_coins::bigint,
  1, gift.amount_coins::bigint, null, 1, gift.created_at
from public.live_gift_transactions as gift
join public.live_battles as battle on battle.id = gift.battle_id
where gift.battle_id is not null
  and gift.receiver_user_id in (battle.challenger_user_id, battle.opponent_user_id);

with score_totals as (
  select battle.id as battle_id,
    coalesce(sum(event.awarded_points) filter (
      where event.target_user_id = battle.challenger_user_id
    ), 0)::bigint as challenger_score,
    coalesce(sum(event.awarded_points) filter (
      where event.target_user_id = battle.opponent_user_id
    ), 0)::bigint as opponent_score,
    count(event.id)::bigint as score_version
  from public.live_battles as battle
  left join public.live_battle_score_events as event on event.battle_id = battle.id
  group by battle.id
)
insert into public.live_battle_score_states (
  battle_id, challenger_score, opponent_score, score_version,
  outcome, winner_user_id, finalized_at, updated_at
)
select battle.id, totals.challenger_score, totals.opponent_score, totals.score_version,
  case
    when battle.status = 'completed' and totals.challenger_score > totals.opponent_score then 'challenger'
    when battle.status = 'completed' and totals.opponent_score > totals.challenger_score then 'opponent'
    when battle.status = 'completed' then 'tie'
    when battle.status = 'cancelled' then 'cancelled'
    else 'pending'
  end,
  case
    when battle.status = 'completed' and totals.challenger_score > totals.opponent_score then battle.challenger_user_id
    when battle.status = 'completed' and totals.opponent_score > totals.challenger_score then battle.opponent_user_id
    else null
  end,
  case when battle.status in ('completed', 'cancelled')
    then coalesce(battle.ended_at, battle.updated_at) else null end,
  coalesce(battle.ended_at, battle.updated_at)
from public.live_battles as battle
join score_totals as totals on totals.battle_id = battle.id;

update public.live_battle_public_states as projection
set challenger_score = score.challenger_score,
    opponent_score = score.opponent_score,
    score_version = score.score_version,
    outcome = score.outcome,
    winner_user_id = score.winner_user_id,
    score_updated_at = score.updated_at,
    projection_version = greatest(projection.version, 1::bigint)
from public.live_battle_score_states as score
where score.battle_id = projection.battle_id;

create or replace function private.reject_live_battle_score_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'live_battle_score_event_immutable';
end;
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

  select score.* into strict v_score
  from public.live_battle_score_states as score
  where score.battle_id = new.id;

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
    where existing.session_id in (new.challenger_session_id, new.opponent_session_id)
      and existing.battle_id <> new.id
      and existing.status not in ('completed', 'cancelled')
  ) then
    raise exception using errcode = '55000', message = 'live_battle_public_projection_conflict';
  end if;

  insert into public.live_battle_public_states (
    session_id, battle_id, opponent_session_id,
    local_host_user_id, opponent_host_user_id,
    local_host_agora_uid, opponent_host_agora_uid,
    status, version, scheduled_start_at, started_at,
    scheduled_end_at, ended_at, updated_at,
    challenger_score, opponent_score, score_version,
    outcome, winner_user_id, score_updated_at, projection_version
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
    greatest(new.version, 1::bigint)
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
    greatest(new.version, 1::bigint)
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
      projection_version = greatest(
        live_battle_public_states.projection_version + 1,
        excluded.projection_version
      )
  where live_battle_public_states.battle_id <> excluded.battle_id
     or excluded.version >= live_battle_public_states.version;

  return new;
end;
$$;

create or replace function public.get_live_battle_public_snapshot(p_session_id uuid)
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
        'projection_version', public_state.projection_version
      )
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

create trigger live_battle_score_events_immutable
before update or delete on public.live_battle_score_events
for each row execute function private.reject_live_battle_score_event_mutation();

create or replace function private.record_live_battle_score_locked(
  p_battle_id uuid,
  p_gift_transaction_id uuid,
  p_now timestamptz
)
returns public.live_battle_score_states
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_gift public.live_gift_transactions%rowtype;
  v_existing_event public.live_battle_score_events%rowtype;
  v_state public.live_battle_score_states%rowtype;
  v_projection_rows integer;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'live_battle_score_time_invalid';
  end if;

  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;

  select gift.* into v_gift
  from public.live_gift_transactions as gift
  where gift.id = p_gift_transaction_id;
  if not found
     or v_gift.battle_id is distinct from p_battle_id
     or v_gift.receiver_user_id not in (
       v_battle.challenger_user_id, v_battle.opponent_user_id
     )
     or v_gift.amount_coins < 0 then
    raise exception using errcode = '55000', message = 'live_battle_score_gift_invalid';
  end if;

  select event.* into v_existing_event
  from public.live_battle_score_events as event
  where event.gift_transaction_id = p_gift_transaction_id;
  if found then
    if v_existing_event.battle_id is distinct from p_battle_id
       or v_existing_event.target_user_id is distinct from v_gift.receiver_user_id
       or v_existing_event.base_points is distinct from v_gift.amount_coins::bigint
       or v_existing_event.multiplier is distinct from 1
       or v_existing_event.awarded_points is distinct from v_gift.amount_coins::bigint
       or v_existing_event.boost_id is not null
       or v_existing_event.rule_version is distinct from 1 then
      raise exception using errcode = '55000', message = 'live_battle_score_event_conflict';
    end if;
    select state.* into strict v_state
    from public.live_battle_score_states as state
    where state.battle_id = p_battle_id;
    return v_state;
  end if;

  if v_battle.status is distinct from 'active' then
    raise exception using errcode = '55000', message = 'live_battle_score_not_active';
  end if;

  insert into public.live_battle_score_states (battle_id, updated_at)
  values (p_battle_id, p_now)
  on conflict (battle_id) do nothing;

  select state.* into v_state
  from public.live_battle_score_states as state
  where state.battle_id = p_battle_id
  for update;
  if v_state.outcome is distinct from 'pending' then
    raise exception using errcode = '55000', message = 'live_battle_score_finalized';
  end if;

  insert into public.live_battle_score_events (
    battle_id, gift_transaction_id, target_user_id, base_points,
    multiplier, awarded_points, boost_id, rule_version, created_at
  ) values (
    p_battle_id, p_gift_transaction_id, v_gift.receiver_user_id,
    v_gift.amount_coins::bigint, 1, v_gift.amount_coins::bigint, null, 1, p_now
  );

  update public.live_battle_score_states as state
  set challenger_score = state.challenger_score + case
        when v_gift.receiver_user_id = v_battle.challenger_user_id
          then v_gift.amount_coins::bigint else 0 end,
      opponent_score = state.opponent_score + case
        when v_gift.receiver_user_id = v_battle.opponent_user_id
          then v_gift.amount_coins::bigint else 0 end,
      score_version = state.score_version + 1,
      updated_at = p_now
  where state.battle_id = p_battle_id
  returning * into v_state;

  update public.live_battle_public_states as projection
  set challenger_score = v_state.challenger_score,
      opponent_score = v_state.opponent_score,
      score_version = v_state.score_version,
      outcome = v_state.outcome,
      winner_user_id = v_state.winner_user_id,
      score_updated_at = v_state.updated_at,
      projection_version = projection.projection_version + 1
  where projection.battle_id = p_battle_id;
  get diagnostics v_projection_rows = row_count;
  if v_projection_rows <> 2 then
    raise exception using errcode = '55000', message = 'live_battle_score_projection_incomplete';
  end if;

  return v_state;
end;
$$;

create or replace function public.send_live_battle_gift(
  p_battle_id uuid, p_target_user_id uuid, p_gift_id text, p_idempotency_key text
)
returns table (
  transaction_id uuid, battle_id uuid, target_session_id uuid, gift_id text,
  emoji text, amount_coins integer, creator_amount_coins integer,
  new_sender_balance numeric, receiver_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := (select auth.uid());
  v_battle public.live_battles%rowtype;
  v_target_session_id uuid;
  v_server_now timestamptz;
  v_gift public.gift_catalog%rowtype;
  v_fee integer;
  v_creator_amount integer;
  v_transfer_result jsonb;
  v_financial_transaction_id uuid;
  v_transaction_id uuid;
  v_sender_balance numeric;
  v_ledger_idempotency_key text;
  v_existing public.live_gift_transactions%rowtype;
begin
  if v_sender is null then
    raise exception using errcode = '28000', message = 'live_battle_gift_auth_required';
  end if;
  if p_battle_id is null or p_target_user_id is null or p_gift_id is null then
    raise exception using errcode = '22023', message = 'live_battle_gift_input_invalid';
  end if;
  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0
     or pg_catalog.length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'live_battle_gift_idempotency_invalid';
  end if;

  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  v_server_now := pg_catalog.clock_timestamp();

  select gift.* into v_existing
  from public.live_gift_transactions as gift
  where gift.sender_user_id = v_sender
    and gift.battle_id = p_battle_id
    and gift.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.receiver_user_id is distinct from p_target_user_id
       or v_existing.gift_id is distinct from p_gift_id then
      raise exception using errcode = '22023', message = 'live_battle_gift_idempotency_conflict';
    end if;
    perform private.record_live_battle_score_locked(
      p_battle_id, v_existing.id, v_server_now
    );
    select account.balance into v_sender_balance
    from public.ledger_accounts as account
    where account.owner_id = v_sender and account.account_type = 'user';
    return query select
      v_existing.id, v_existing.battle_id, v_existing.session_id,
      v_existing.gift_id, v_existing.emoji, v_existing.amount_coins,
      v_existing.creator_amount_coins, coalesce(v_sender_balance, 0),
      v_existing.receiver_user_id;
    return;
  end if;

  if v_battle.status is distinct from 'active' then
    raise exception using errcode = 'P0001', message = 'live_battle_gift_not_active';
  end if;
  if v_battle.scheduled_end_at is null or v_server_now >= v_battle.scheduled_end_at then
    raise exception using errcode = 'P0001', message = 'live_battle_gift_deadline_elapsed';
  end if;
  if p_target_user_id = v_battle.challenger_user_id then
    v_target_session_id := v_battle.challenger_session_id;
  elsif p_target_user_id = v_battle.opponent_user_id then
    v_target_session_id := v_battle.opponent_session_id;
  else
    raise exception using errcode = '22023', message = 'live_battle_gift_target_invalid';
  end if;
  if p_target_user_id = v_sender then
    raise exception using errcode = '22023', message = 'live_battle_gift_self_forbidden';
  end if;

  perform 1 from public.live_sessions as session
  where session.id = v_target_session_id
    and session.host_id = p_target_user_id
    and session.status = 'live'
    and session.ended_at is null;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'live_battle_gift_target_session_not_live';
  end if;

  select catalog.* into v_gift
  from public.gift_catalog as catalog
  where catalog.id = p_gift_id and catalog.active and catalog.enabled;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_gift_unavailable';
  end if;

  v_fee := pg_catalog.floor(v_gift.cost_coins::numeric * 0.10)::integer;
  v_creator_amount := v_gift.cost_coins - v_fee;
  v_ledger_idempotency_key :=
    pg_catalog.format('live_battle:%s:%s', p_battle_id, p_idempotency_key);
  v_transfer_result := public.atomic_ledger_transfer(
    v_sender, p_target_user_id, v_gift.cost_coins, v_fee,
    'live_gift', v_ledger_idempotency_key, 'live_battle', p_battle_id,
    'Directed LIVE Battle gift: ' || v_gift.id
  );
  v_sender_balance := (v_transfer_result ->> 'from_balance')::numeric;
  v_financial_transaction_id :=
    nullif(v_transfer_result ->> 'fin_txn_id', '')::uuid;
  if v_financial_transaction_id is null then
    raise exception using
      errcode = 'P0001', message = 'live_battle_gift_financial_result_invalid';
  end if;

  insert into public.live_gift_transactions (
    session_id, sender_user_id, receiver_user_id, gift_id, emoji,
    amount_coins, platform_fee_coins, creator_amount_coins, idempotency_key,
    financial_transaction_id, battle_id
  ) values (
    v_target_session_id, v_sender, p_target_user_id, v_gift.id, v_gift.emoji,
    v_gift.cost_coins, v_fee, v_creator_amount, p_idempotency_key,
    v_financial_transaction_id, p_battle_id
  ) returning id into v_transaction_id;

  perform private.record_live_battle_score_locked(
    p_battle_id, v_transaction_id, v_server_now
  );

  return query select
    v_transaction_id, p_battle_id, v_target_session_id, v_gift.id,
    v_gift.emoji, v_gift.cost_coins, v_creator_amount, v_sender_balance,
    p_target_user_id;
end;
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
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_battle.status is distinct from p_expected_status then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;
  if not coalesce(
    (p_expected_status = 'pending' and p_next_status in ('accepted', 'rejected', 'cancelled', 'expired')) or
    (p_expected_status = 'accepted' and p_next_status in ('countdown', 'cancelled')) or
    (p_expected_status = 'countdown' and p_next_status in ('active', 'cancelled')) or
    (p_expected_status = 'active' and p_next_status in ('completed', 'cancelled')),
    false
  ) then
    raise exception using errcode = '55000', message = 'live_battle_transition_invalid';
  end if;

  if p_next_status = 'accepted' and (
    p_actor_user_id is distinct from v_battle.opponent_user_id
    or p_reason is distinct from 'invite_accepted'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'rejected' and (
    p_actor_user_id is distinct from v_battle.opponent_user_id
    or p_reason is distinct from 'invite_rejected'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'expired' and (
    p_actor_user_id is not null or p_reason is distinct from 'invite_expired'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'countdown' and (
    p_actor_user_id is null
    or p_actor_user_id not in (v_battle.challenger_user_id, v_battle.opponent_user_id)
    or p_reason is distinct from 'countdown_started'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'active' and (
    p_actor_user_id is not null or p_reason is distinct from 'countdown_elapsed'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'completed' and (
    p_actor_user_id is not null or p_reason is distinct from 'battle_duration_elapsed'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'cancelled' and not (
    p_reason is not null and (
      (p_actor_user_id is not null and p_actor_user_id = v_battle.challenger_user_id and p_reason = 'challenger_cancelled') or
      (p_actor_user_id is not null and p_actor_user_id = v_battle.opponent_user_id and p_reason = 'opponent_cancelled') or
      (p_expected_status = 'accepted' and p_actor_user_id is null and p_reason in ('accepted_start_timeout', 'session_not_live_after_accept')) or
      (p_expected_status = 'countdown' and p_actor_user_id is null and p_reason = 'session_not_live_before_start')
    )
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  end if;

  v_next_version := v_battle.version + 1;
  update public.live_battles as battle
  set status = p_next_status,
      accepted_at = case when p_next_status = 'accepted' then p_now else battle.accepted_at end,
      countdown_started_at = case when p_next_status = 'countdown' then p_now else battle.countdown_started_at end,
      scheduled_start_at = case when p_next_status = 'countdown' then p_now + interval '3 seconds' else battle.scheduled_start_at end,
      started_at = case when p_next_status = 'active' then battle.scheduled_start_at else battle.started_at end,
      scheduled_end_at = case when p_next_status = 'active' then battle.scheduled_start_at + interval '300 seconds' else battle.scheduled_end_at end,
      ended_at = case
        when p_next_status = 'expired' then battle.invite_expires_at
        when p_next_status = 'completed' then battle.scheduled_end_at
        when p_next_status in ('rejected', 'cancelled') then p_now
        else battle.ended_at
      end,
      last_transition_actor_id = p_actor_user_id,
      last_transition_reason = p_reason,
      version = v_next_version,
      updated_at = p_now
  where battle.id = p_battle_id
    and battle.status = p_expected_status
    and battle.version = v_battle.version
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

  if p_next_status in ('completed', 'cancelled') then
    perform private.reconcile_live_battle_score_locked(v_battle.id, p_now);
  end if;
  return v_battle;
end;
$$;

create or replace function private.reconcile_live_battle_score_locked(
  p_battle_id uuid,
  p_now timestamptz
)
returns public.live_battle_score_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_state public.live_battle_score_states%rowtype;
  v_challenger_score bigint;
  v_opponent_score bigint;
  v_event_count bigint;
  v_gift_count bigint;
  v_outcome text;
  v_winner_user_id uuid;
  v_finalized_at timestamptz;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'live_battle_score_time_invalid';
  end if;

  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;

  select count(*)::bigint into v_gift_count
  from public.live_gift_transactions as gift
  where gift.battle_id = p_battle_id;

  select
    coalesce(sum(event.awarded_points) filter (
      where event.target_user_id = v_battle.challenger_user_id
    ), 0)::bigint,
    coalesce(sum(event.awarded_points) filter (
      where event.target_user_id = v_battle.opponent_user_id
    ), 0)::bigint,
    count(*)::bigint
  into v_challenger_score, v_opponent_score, v_event_count
  from public.live_battle_score_events as event
  where event.battle_id = p_battle_id;

  if v_event_count is distinct from v_gift_count or exists (
    select 1
    from public.live_battle_score_events as event
    join public.live_gift_transactions as gift
      on gift.id = event.gift_transaction_id
    where event.battle_id = p_battle_id
      and (
        gift.battle_id is distinct from p_battle_id
        or event.target_user_id is distinct from gift.receiver_user_id
        or event.target_user_id not in (
          v_battle.challenger_user_id, v_battle.opponent_user_id
        )
        or event.base_points is distinct from gift.amount_coins::bigint
        or event.multiplier is distinct from 1
        or event.awarded_points is distinct from gift.amount_coins::bigint
        or event.boost_id is not null
        or event.rule_version is distinct from 1
      )
  ) then
    raise exception using
      errcode = '55000', message = 'live_battle_score_reconciliation_mismatch';
  end if;

  if v_battle.status = 'completed' then
    if v_challenger_score > v_opponent_score then
      v_outcome := 'challenger';
      v_winner_user_id := v_battle.challenger_user_id;
    elsif v_opponent_score > v_challenger_score then
      v_outcome := 'opponent';
      v_winner_user_id := v_battle.opponent_user_id;
    else
      v_outcome := 'tie';
      v_winner_user_id := null;
    end if;
  elsif v_battle.status = 'cancelled' then
    v_outcome := 'cancelled';
    v_winner_user_id := null;
  else
    v_outcome := 'pending';
    v_winner_user_id := null;
  end if;

  insert into public.live_battle_score_states (battle_id, updated_at)
  values (p_battle_id, p_now)
  on conflict (battle_id) do nothing;

  select state.* into v_state
  from public.live_battle_score_states as state
  where state.battle_id = p_battle_id
  for update;

  v_finalized_at := case
    when v_outcome = 'pending' then null
    else coalesce(v_state.finalized_at, p_now)
  end;

  update public.live_battle_score_states as state
  set challenger_score = v_challenger_score,
      opponent_score = v_opponent_score,
      score_version = v_event_count,
      outcome = v_outcome,
      winner_user_id = v_winner_user_id,
      finalized_at = v_finalized_at,
      updated_at = case when
        state.challenger_score is distinct from v_challenger_score or
        state.opponent_score is distinct from v_opponent_score or
        state.score_version is distinct from v_event_count or
        state.outcome is distinct from v_outcome or
        state.winner_user_id is distinct from v_winner_user_id or
        state.finalized_at is distinct from v_finalized_at
      then p_now else state.updated_at end
  where state.battle_id = p_battle_id
  returning * into v_state;

  update public.live_battle_public_states as projection
  set challenger_score = v_state.challenger_score,
      opponent_score = v_state.opponent_score,
      score_version = v_state.score_version,
      outcome = v_state.outcome,
      winner_user_id = v_state.winner_user_id,
      score_updated_at = v_state.updated_at,
      projection_version = projection.projection_version + 1
  where projection.battle_id = p_battle_id
    and (
      projection.challenger_score is distinct from v_state.challenger_score or
      projection.opponent_score is distinct from v_state.opponent_score or
      projection.score_version is distinct from v_state.score_version or
      projection.outcome is distinct from v_state.outcome or
      projection.winner_user_id is distinct from v_state.winner_user_id or
      projection.score_updated_at is distinct from v_state.updated_at
    );

  return v_state;
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
  v_now timestamptz;
  v_battle public.live_battles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_actor not in (v_battle.challenger_user_id, v_battle.opponent_user_id) then
    raise exception using errcode = '42501', message = 'live_battle_forbidden';
  end if;
  v_now := pg_catalog.clock_timestamp();
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'completed' then
    return private.live_battle_to_json(v_battle);
  end if;
  if v_battle.status = 'active' and v_battle.scheduled_end_at > v_now then
    raise exception using errcode = '55000', message = 'live_battle_completion_too_early';
  end if;
  raise exception using errcode = '55000', message = 'live_battle_complete_state_invalid';
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
  v_now timestamptz;
  v_battle public.live_battles%rowtype;
  v_reason text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_actor not in (v_battle.challenger_user_id, v_battle.opponent_user_id) then
    raise exception using errcode = '42501', message = 'live_battle_forbidden';
  end if;
  v_now := pg_catalog.clock_timestamp();
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'cancelled' then
    return private.live_battle_to_json(v_battle);
  end if;
  if v_battle.status not in ('pending', 'accepted', 'countdown', 'active') then
    raise exception using errcode = '55000', message = 'live_battle_terminal';
  end if;
  v_reason := case when v_actor = v_battle.challenger_user_id
    then 'challenger_cancelled' else 'opponent_cancelled' end;
  v_battle := private.live_battle_transition(
    v_battle.id, v_battle.status, 'cancelled', v_actor, v_reason, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

alter function private.reject_live_battle_score_event_mutation() owner to postgres;
alter function private.record_live_battle_score_locked(uuid, uuid, timestamptz) owner to postgres;
alter function private.reconcile_live_battle_score_locked(uuid, timestamptz) owner to postgres;
alter function private.sync_live_battle_public_states() owner to postgres;
alter function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  owner to postgres;
alter function public.get_live_battle_public_snapshot(uuid) owner to postgres;
alter function public.send_live_battle_gift(uuid, uuid, text, text) owner to postgres;
alter function public.complete_live_battle(uuid) owner to postgres;
alter function public.cancel_live_battle(uuid) owner to postgres;

revoke all on function private.reject_live_battle_score_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.record_live_battle_score_locked(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_live_battle_score_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.sync_live_battle_public_states()
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.get_live_battle_public_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_live_battle_public_snapshot(uuid) to authenticated;

revoke all on function public.send_live_battle_gift(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.send_live_battle_gift(uuid, uuid, text, text)
  to authenticated;

revoke all on function public.complete_live_battle(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_live_battle(uuid) to authenticated;

revoke all on function public.cancel_live_battle(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_live_battle(uuid) to authenticated;

commit;
