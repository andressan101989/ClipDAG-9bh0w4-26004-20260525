begin;

-- F9-A: extend immutable rules without rewriting any existing competitive fact.
do $$ begin
  if (select max(rule_version) from public.live_battle_rule_sets) <> 2 then
    raise exception 'live_battle_f9_rule_version_conflict';
  end if;
end $$;
alter table public.live_battle_rule_sets
  add column gift_points_per_coin integer not null default 1,
  add column like_points integer not null default 0,
  add column max_scoreable_likes_per_viewer integer not null default 0,
  add constraint live_battle_rule_sets_scoring_check check (
    gift_points_per_coin between 1 and 1000 and like_points between 0 and 1000
    and max_scoreable_likes_per_viewer between 0 and 1000
    and (like_points = 0) = (max_scoreable_likes_per_viewer = 0)
  );
insert into public.live_battle_rule_sets (
  rule_version, rose_gift_id, rose_target_units, rose_multiplier,
  rose_duration_seconds, rose_activation_limit_per_side, glove_multiplier,
  glove_duration_seconds, glove_uses_per_side, glove_acquisition_mode,
  gift_points_per_coin, like_points, max_scoreable_likes_per_viewer
)
select 3, rose_gift_id, rose_target_units, rose_multiplier,
  rose_duration_seconds, rose_activation_limit_per_side, glove_multiplier,
  glove_duration_seconds, glove_uses_per_side, glove_acquisition_mode, 10, 5, 20
from public.live_battle_rule_sets where rule_version = 2;
update public.live_battle_current_rule_set
set rule_set_id = (select id from public.live_battle_rule_sets where rule_version = 3),
    updated_at = pg_catalog.clock_timestamp()
where singleton;

-- A distinct journal preserves the NOT NULL/UNIQUE gift FK of the paid journal.
-- Zero-accepted batches are receipts too: a confirmed retry never changes its result.
create table public.live_battle_like_score_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  battle_id uuid not null references public.live_battles(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null references public.live_sessions(id) on delete restrict,
  requested_count integer not null check (requested_count between 1 and 64),
  accepted_count integer not null check (accepted_count between 0 and requested_count),
  like_points integer not null check (like_points between 0 and 1000),
  awarded_points bigint not null check (awarded_points = accepted_count::bigint * like_points),
  rule_set_id uuid not null,
  rule_version integer not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (rule_set_id, rule_version) references public.live_battle_rule_sets(id, rule_version) on delete restrict,
  unique (battle_id, actor_user_id, idempotency_key)
);
create index live_battle_like_score_actor_idx on public.live_battle_like_score_events(actor_user_id);
create index live_battle_like_score_target_idx on public.live_battle_like_score_events(target_user_id);
create index live_battle_like_score_session_idx on public.live_battle_like_score_events(session_id);
create index live_battle_like_score_rule_idx on public.live_battle_like_score_events(rule_set_id, rule_version);
alter table public.live_battle_like_score_events owner to postgres;
alter table public.live_battle_like_score_events enable row level security;
revoke all on public.live_battle_like_score_events from public, anon, authenticated, service_role;
create policy live_battle_like_no_client_access on public.live_battle_like_score_events
as restrictive for all to anon, authenticated, service_role using (false) with check (false);
comment on table public.live_battle_like_score_events is 'F9-A server-only immutable free-like receipts. No money, gifts, rose progression or boosts.';

create or replace function private.reject_live_battle_like_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'live_battle_like_immutable';
end;
$$;
create trigger live_battle_like_immutable before update or delete on public.live_battle_like_score_events
for each row execute function private.reject_live_battle_like_mutation();
create trigger live_battle_like_no_truncate before truncate on public.live_battle_like_score_events
for each statement execute function private.reject_live_battle_like_mutation();

create or replace function private.validate_live_battle_like_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_battle public.live_battles%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_used bigint;
begin
  select * into strict v_battle from public.live_battles where id = new.battle_id for update;
  select * into strict v_rules from public.live_battle_rule_sets where id = v_battle.battle_rule_set_id;
  select coalesce(sum(event.accepted_count), 0) into v_used
  from public.live_battle_like_score_events as event
  where event.battle_id = new.battle_id and event.actor_user_id = new.actor_user_id;
  if new.actor_user_id is distinct from auth.uid()
    or new.rule_set_id is distinct from v_rules.id or new.rule_version is distinct from v_rules.rule_version
    or new.like_points is distinct from v_rules.like_points
    or not ((new.session_id = v_battle.challenger_session_id and new.target_user_id = v_battle.challenger_user_id)
         or (new.session_id = v_battle.opponent_session_id and new.target_user_id = v_battle.opponent_user_id))
    or v_used + new.accepted_count > v_rules.max_scoreable_likes_per_viewer
    or (new.accepted_count > 0 and (v_battle.status <> 'active'
        or v_battle.scheduled_start_at is null or v_battle.scheduled_end_at is null
        or new.created_at < v_battle.scheduled_start_at or new.created_at >= v_battle.scheduled_end_at
        or new.actor_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id))) then
    raise exception using errcode = '23514', message = 'live_battle_like_contract_invalid';
  end if;
  return new;
end;
$$;
create trigger live_battle_like_validate before insert on public.live_battle_like_score_events
for each row execute function private.validate_live_battle_like_event();

create or replace function public.send_live_battle_likes(
  p_session_id uuid, p_battle_id uuid, p_count integer, p_idempotency_key text
)
returns table (accepted_count integer, awarded_points bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_battle public.live_battles%rowtype;
  v_session public.live_sessions%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_existing public.live_battle_like_score_events%rowtype;
  v_target uuid;
  v_used bigint;
  v_accepted integer := 0;
  v_now timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_auth_required';
  end if;
  if p_session_id is null or p_battle_id is null or p_count is null or p_count not between 1 and 64
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception using errcode = '22023', message = 'live_battle_like_input_invalid';
  end if;
  -- Same canonical lock as gifts, reconciliation and finalization; clock read after waiting.
  select * into v_battle from public.live_battles where id = p_battle_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'live_battle_not_found';
  end if;
  select * into v_existing from public.live_battle_like_score_events as event
  where event.battle_id = p_battle_id and event.actor_user_id = v_actor and event.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.session_id <> p_session_id or v_existing.requested_count <> p_count then
      raise exception using errcode = '22023', message = 'live_battle_like_idempotency_conflict';
    end if;
    return query select v_existing.accepted_count, v_existing.awarded_points;
    return;
  end if;
  v_target := case p_session_id when v_battle.challenger_session_id then v_battle.challenger_user_id
    when v_battle.opponent_session_id then v_battle.opponent_user_id else null end;
  select * into v_session from public.live_sessions where id = p_session_id for share;
  if v_target is null or v_session.id is null or v_session.host_id is distinct from v_target then
    raise exception using errcode = '42501', message = 'live_battle_like_session_invalid';
  end if;
  if v_actor <> v_session.host_id and not exists (select 1 from public.live_participants
      where session_id = p_session_id and user_id = v_actor and status = 'active') then
    raise exception using errcode = '42501', message = 'live_participant_required';
  end if;
  select * into strict v_rules from public.live_battle_rule_sets where id = v_battle.battle_rule_set_id;
  select coalesce(sum(event.accepted_count), 0) into v_used from public.live_battle_like_score_events as event
  where event.battle_id = p_battle_id and event.actor_user_id = v_actor;
  v_now := pg_catalog.clock_timestamp();
  if v_battle.status = 'active' and v_session.status = 'live'
     and v_now >= v_battle.scheduled_start_at and v_now < v_battle.scheduled_end_at
     and v_actor not in (v_battle.challenger_user_id, v_battle.opponent_user_id) then
    v_accepted := least(p_count::bigint, greatest(0, v_rules.max_scoreable_likes_per_viewer - v_used))::integer;
  end if;
  insert into public.live_battle_like_score_events (
    battle_id, actor_user_id, target_user_id, session_id, requested_count, accepted_count,
    like_points, awarded_points, rule_set_id, rule_version, idempotency_key, created_at
  ) values (p_battle_id, v_actor, v_target, p_session_id, p_count, v_accepted,
    v_rules.like_points, v_accepted::bigint * v_rules.like_points, v_rules.id, v_rules.rule_version, p_idempotency_key, v_now);
  if v_accepted > 0 then
    perform private.reconcile_live_battle_score_locked(p_battle_id, v_now);
  end if;
  return query select v_accepted, v_accepted::bigint * v_rules.like_points;
end;
$$;

-- Preserve the existing gift and boost contracts; scale only the pinned competitive base.
create or replace function private.live_battle_score_event_contract_is_valid(
  p_event public.live_battle_score_events,
  p_gift public.live_gift_transactions,
  p_battle public.live_battles
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rule public.live_battle_rule_sets%rowtype;
  v_boost public.live_battle_boost_events%rowtype;
  v_side text;
begin
  select rules.* into v_rule
  from public.live_battle_rule_sets as rules
  where rules.id = p_battle.battle_rule_set_id;
  if not found
     or p_gift.battle_id is distinct from p_battle.id
     or p_event.battle_id is distinct from p_battle.id
     or p_event.gift_transaction_id is distinct from p_gift.id
     or p_event.target_user_id is distinct from p_gift.receiver_user_id
     or p_event.target_user_id not in (
       p_battle.challenger_user_id, p_battle.opponent_user_id
     )
     or p_event.base_points is distinct from p_gift.amount_coins::bigint * v_rule.gift_points_per_coin
     or p_event.multiplier not in (1, 2, 3)
     or p_event.awarded_points is distinct from
        p_event.base_points * p_event.multiplier
     or p_event.rule_version is distinct from v_rule.rule_version then
    return false;
  end if;
  if p_event.multiplier = 1 then
    return p_event.boost_id is null;
  end if;
  if p_event.boost_id is null then
    return false;
  end if;
  v_side := case
    when p_event.target_user_id = p_battle.challenger_user_id
      then 'challenger' else 'opponent' end;
  select boost.* into v_boost
  from public.live_battle_boost_events as boost
  where boost.id = p_event.boost_id;
  return found
    and v_boost.battle_id = p_battle.id
    and v_boost.side = v_side
    and v_boost.rule_set_id = p_battle.battle_rule_set_id
    and v_boost.rule_version = p_event.rule_version
    and v_boost.multiplier = p_event.multiplier
    and v_boost.starts_at <= p_event.created_at
    and p_event.created_at < v_boost.expires_at;
end;
$$;

create or replace function private.record_live_battle_score_locked(
  p_battle_id uuid,
  p_gift_transaction_id uuid,
  p_now timestamptz
)
returns public.live_battle_score_states
language plpgsql security invoker set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_gift public.live_gift_transactions%rowtype;
  v_existing_event public.live_battle_score_events%rowtype;
  v_event public.live_battle_score_events%rowtype;
  v_state public.live_battle_score_states%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_boost public.live_battle_boost_events%rowtype;
  v_side text;
  v_multiplier integer := 1;
  v_awarded_points bigint;
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
    if not private.live_battle_score_event_contract_is_valid(
      v_existing_event, v_gift, v_battle
    ) then
      raise exception using errcode = '55000',
        message = 'live_battle_score_event_conflict';
    end if;
    select state.* into strict v_state
    from public.live_battle_score_states as state
    where state.battle_id = p_battle_id;
    return v_state;
  end if;
  if v_battle.status is distinct from 'active' then
    raise exception using errcode = '55000', message = 'live_battle_score_not_active';
  end if;
  select rules.* into strict v_rules
  from public.live_battle_rule_sets as rules
  where rules.id = v_battle.battle_rule_set_id;
  v_side := case
    when v_gift.receiver_user_id = v_battle.challenger_user_id
      then 'challenger' else 'opponent' end;

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

  v_boost := private.resolve_live_battle_effective_boost_locked(
    p_battle_id, v_side, p_now
  );
  if v_boost.id is not null then
    v_multiplier := v_boost.multiplier;
  end if;
  v_awarded_points := v_gift.amount_coins::bigint * v_rules.gift_points_per_coin * v_multiplier;
  insert into public.live_battle_score_events (
    battle_id, gift_transaction_id, target_user_id, base_points,
    multiplier, awarded_points, boost_id, rule_version, created_at
  ) values (
    p_battle_id, p_gift_transaction_id, v_gift.receiver_user_id,
    v_gift.amount_coins::bigint * v_rules.gift_points_per_coin, v_multiplier, v_awarded_points,
    v_boost.id, v_rules.rule_version, p_now
  ) returning * into v_event;

  update public.live_battle_score_states as state
  set challenger_score = state.challenger_score + case
        when v_side = 'challenger' then v_awarded_points else 0 end,
      opponent_score = state.opponent_score + case
        when v_side = 'opponent' then v_awarded_points else 0 end,
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
    raise exception using errcode = '55000',
      message = 'live_battle_score_projection_incomplete';
  end if;

  perform private.advance_live_battle_rose_mission_locked(
    p_battle_id, p_gift_transaction_id, v_event.id, p_now
  );
  return v_state;
end;
$$;

create or replace function private.reconcile_live_battle_score_locked(
  p_battle_id uuid,
  p_now timestamptz
)
returns public.live_battle_score_states
language plpgsql security definer set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_state public.live_battle_score_states%rowtype;
  v_challenger_score bigint;
  v_opponent_score bigint;
  v_event_count bigint;
  v_gift_count bigint;
  v_like_challenger bigint;
  v_like_opponent bigint;
  v_like_count bigint;
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
  select pg_catalog.count(*)::bigint into v_gift_count
  from public.live_gift_transactions as gift
  where gift.battle_id = p_battle_id;
  select
    coalesce(pg_catalog.sum(event.awarded_points) filter (
      where event.target_user_id = v_battle.challenger_user_id
    ), 0)::bigint,
    coalesce(pg_catalog.sum(event.awarded_points) filter (
      where event.target_user_id = v_battle.opponent_user_id
    ), 0)::bigint,
    pg_catalog.count(*)::bigint
  into v_challenger_score, v_opponent_score, v_event_count
  from public.live_battle_score_events as event
  where event.battle_id = p_battle_id;
  if v_event_count is distinct from v_gift_count or exists (
    select 1
    from public.live_battle_score_events as event
    join public.live_gift_transactions as gift
      on gift.id = event.gift_transaction_id
    where event.battle_id = p_battle_id
      and not private.live_battle_score_event_contract_is_valid(
        event, gift, v_battle
      )
  ) then
    raise exception using errcode = '55000',
      message = 'live_battle_score_reconciliation_mismatch';
  end if;
  -- Confirmed free-like facts share this aggregate and the finalization path.
  select coalesce(sum(event.awarded_points) filter (where event.target_user_id = v_battle.challenger_user_id), 0)::bigint,
    coalesce(sum(event.awarded_points) filter (where event.target_user_id = v_battle.opponent_user_id), 0)::bigint,
    count(*) filter (where event.accepted_count > 0)
  into v_like_challenger, v_like_opponent, v_like_count
  from public.live_battle_like_score_events as event where event.battle_id = p_battle_id;
  v_challenger_score := v_challenger_score + v_like_challenger;
  v_opponent_score := v_opponent_score + v_like_opponent;
  v_event_count := v_event_count + v_like_count;
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
    else coalesce(v_state.finalized_at, p_now) end;
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

alter function private.reject_live_battle_like_mutation() owner to postgres;
revoke all on function private.reject_live_battle_like_mutation() from public, anon, authenticated, service_role;

alter function private.validate_live_battle_like_event() owner to postgres;
revoke all on function private.validate_live_battle_like_event() from public, anon, authenticated, service_role;

alter function public.send_live_battle_likes(uuid,uuid,integer,text) owner to postgres;
revoke all on function public.send_live_battle_likes(uuid,uuid,integer,text) from public, anon, authenticated, service_role;

alter function private.live_battle_score_event_contract_is_valid(public.live_battle_score_events,public.live_gift_transactions,public.live_battles) owner to postgres;
revoke all on function private.live_battle_score_event_contract_is_valid(public.live_battle_score_events,public.live_gift_transactions,public.live_battles) from public, anon, authenticated, service_role;

alter function private.record_live_battle_score_locked(uuid,uuid,timestamptz) owner to postgres;
revoke all on function private.record_live_battle_score_locked(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;

alter function private.reconcile_live_battle_score_locked(uuid,timestamptz) owner to postgres;
revoke all on function private.reconcile_live_battle_score_locked(uuid,timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.send_live_battle_likes(uuid,uuid,integer,text) to authenticated;
commit;
