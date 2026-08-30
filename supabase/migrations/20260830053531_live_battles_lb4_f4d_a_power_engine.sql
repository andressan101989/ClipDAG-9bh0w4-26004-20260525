begin;

create table public.live_battle_rule_sets (
  id uuid primary key default gen_random_uuid(),
  rule_version integer not null unique,
  rose_gift_id text references public.gift_catalog(id) on delete restrict,
  rose_target_units integer not null,
  rose_multiplier integer not null,
  rose_duration_seconds integer not null,
  rose_activation_limit_per_side integer not null,
  glove_multiplier integer not null,
  glove_duration_seconds integer not null,
  glove_uses_per_side integer not null,
  glove_acquisition_mode text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_rule_sets_version_check check (rule_version > 0),
  constraint live_battle_rule_sets_bounds_check check (
    rose_target_units between 0 and 100000 and
    rose_duration_seconds between 0 and 3600 and
    rose_activation_limit_per_side between 0 and 100 and
    glove_duration_seconds between 0 and 3600 and
    glove_uses_per_side between 0 and 100
  ),
  constraint live_battle_rule_sets_contract_check check (
    (glove_acquisition_mode = 'disabled' and rose_gift_id is null and
     rose_target_units = 0 and rose_multiplier = 1 and
     rose_duration_seconds = 0 and rose_activation_limit_per_side = 0 and
     glove_multiplier = 1 and glove_duration_seconds = 0 and
     glove_uses_per_side = 0) or
    (glove_acquisition_mode = 'fixed_battle_grant' and
     rose_gift_id is not null and rose_target_units > 0 and
     rose_multiplier = 2 and rose_duration_seconds > 0 and
     rose_activation_limit_per_side = 1 and glove_multiplier = 3 and
     glove_duration_seconds > 0 and glove_uses_per_side = 1)
  ),
  constraint live_battle_rule_sets_id_version_key unique (id, rule_version)
);
alter table public.live_battle_rule_sets enable row level security;
revoke all on table public.live_battle_rule_sets
  from public, anon, authenticated, service_role;

create or replace function private.reject_live_battle_rule_set_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'live_battle_rule_set_immutable';
end;
$$;
create trigger live_battle_rule_sets_immutable
before update or delete on public.live_battle_rule_sets
for each row execute function private.reject_live_battle_rule_set_mutation();

insert into public.live_battle_rule_sets (
  rule_version, rose_gift_id, rose_target_units, rose_multiplier,
  rose_duration_seconds, rose_activation_limit_per_side,
  glove_multiplier, glove_duration_seconds, glove_uses_per_side,
  glove_acquisition_mode
) values
  (1, null, 0, 1, 0, 0, 1, 0, 0, 'disabled'),
  (2, 'rose', 10, 2, 30, 1, 3, 15, 1, 'fixed_battle_grant');

create table public.live_battle_current_rule_set (
  singleton boolean primary key default true,
  rule_set_id uuid not null unique
    references public.live_battle_rule_sets(id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_current_rule_set_singleton_check check (singleton)
);
alter table public.live_battle_current_rule_set enable row level security;
revoke all on table public.live_battle_current_rule_set
  from public, anon, authenticated, service_role;
insert into public.live_battle_current_rule_set (singleton, rule_set_id)
select true, rules.id from public.live_battle_rule_sets as rules
where rules.rule_version = 2;

create or replace function private.current_live_battle_rule_set_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select current_rules.rule_set_id
  from public.live_battle_current_rule_set as current_rules
  where current_rules.singleton;
$$;

alter table public.live_battles add column battle_rule_set_id uuid;
update public.live_battles as battle
set battle_rule_set_id = rules.id
from public.live_battle_rule_sets as rules
where rules.rule_version = 1;
alter table public.live_battles
  alter column battle_rule_set_id
    set default private.current_live_battle_rule_set_id(),
  alter column battle_rule_set_id set not null,
  add constraint live_battles_rule_set_fkey foreign key (battle_rule_set_id)
    references public.live_battle_rule_sets(id) on delete restrict;
create index live_battles_rule_set_idx on public.live_battles (battle_rule_set_id);

create or replace function private.reject_live_battle_rule_set_change()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.battle_rule_set_id is distinct from old.battle_rule_set_id then
    raise exception using errcode = '55000',
      message = 'live_battle_rule_set_immutable';
  end if;
  return new;
end;
$$;
create trigger live_battles_rule_set_immutable
before update of battle_rule_set_id on public.live_battles
for each row execute function private.reject_live_battle_rule_set_change();

create or replace function private.live_battle_to_json(p_battle public.live_battles)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select pg_catalog.to_jsonb(p_battle) - 'battle_rule_set_id';
$$;

create table public.live_battle_power_states (
  battle_id uuid not null references public.live_battles(id) on delete cascade,
  side text not null,
  rule_set_id uuid not null references public.live_battle_rule_sets(id) on delete restrict,
  rose_progress_units integer not null default 0,
  rose_activations_used integer not null default 0,
  glove_uses_available integer not null default 0,
  glove_uses_consumed integer not null default 0,
  power_version bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (battle_id, side),
  constraint live_battle_power_states_side_check
    check (side in ('challenger', 'opponent')),
  constraint live_battle_power_states_values_check check (
    rose_progress_units >= 0 and rose_activations_used >= 0 and
    glove_uses_available >= 0 and glove_uses_consumed >= 0 and
    power_version >= 0
  ),
  constraint live_battle_power_states_battle_rule_side_key
    unique (battle_id, rule_set_id, side)
);
create index live_battle_power_states_rule_set_idx
  on public.live_battle_power_states (rule_set_id);
alter table public.live_battle_power_states enable row level security;
revoke all on table public.live_battle_power_states
  from public, anon, authenticated, service_role;

create or replace function private.validate_live_battle_power_state()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_battle_rule_set_id uuid;
  v_rules public.live_battle_rule_sets%rowtype;
begin
  select battle.battle_rule_set_id into v_battle_rule_set_id
  from public.live_battles as battle
  where battle.id = new.battle_id;
  if not found or new.rule_set_id is distinct from v_battle_rule_set_id then
    raise exception using errcode = '23514',
      message = 'live_battle_power_rule_mismatch';
  end if;
  select rules.* into strict v_rules
  from public.live_battle_rule_sets as rules
  where rules.id = new.rule_set_id;
  if new.rose_progress_units > v_rules.rose_target_units
     or new.rose_activations_used > v_rules.rose_activation_limit_per_side
     or new.glove_uses_available + new.glove_uses_consumed
        is distinct from v_rules.glove_uses_per_side then
    raise exception using errcode = '23514',
      message = 'live_battle_power_state_invalid';
  end if;
  return new;
end;
$$;
create trigger live_battle_power_states_validate
before insert or update on public.live_battle_power_states
for each row execute function private.validate_live_battle_power_state();

create or replace function private.initialize_live_battle_power_states(
  p_battle_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_rule_set_id uuid;
  v_glove_uses integer;
begin
  select battle.battle_rule_set_id, rules.glove_uses_per_side
    into v_rule_set_id, v_glove_uses
  from public.live_battles as battle
  join public.live_battle_rule_sets as rules
    on rules.id = battle.battle_rule_set_id
  where battle.id = p_battle_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  insert into public.live_battle_power_states (
    battle_id, side, rule_set_id, glove_uses_available
  ) values
    (p_battle_id, 'challenger', v_rule_set_id, v_glove_uses),
    (p_battle_id, 'opponent', v_rule_set_id, v_glove_uses)
  on conflict (battle_id, side) do nothing;
end;
$$;

create or replace function private.initialize_live_battle_power_states_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.initialize_live_battle_power_states(new.id);
  return new;
end;
$$;
create trigger live_battles_initialize_power_states
after insert on public.live_battles
for each row execute function private.initialize_live_battle_power_states_trigger();

do $$
declare
  v_battle_id uuid;
begin
  for v_battle_id in select battle.id from public.live_battles as battle
  loop
    perform private.initialize_live_battle_power_states(v_battle_id);
  end loop;
end;
$$;

create table public.live_battle_boost_events (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.live_battles(id) on delete cascade,
  side text not null,
  kind text not null,
  multiplier integer not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  activated_by_user_id uuid references auth.users(id) on delete restrict,
  source_score_event_id uuid
    references public.live_battle_score_events(id) on delete restrict,
  idempotency_key text,
  rule_set_id uuid not null,
  rule_version integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint live_battle_boost_events_side_check
    check (side in ('challenger', 'opponent')),
  constraint live_battle_boost_events_kind_check
    check (kind in ('rose_x2', 'glove_x3')),
  constraint live_battle_boost_events_timeline_check
    check (expires_at > starts_at),
  constraint live_battle_boost_events_rule_fkey
    foreign key (rule_set_id, rule_version)
    references public.live_battle_rule_sets(id, rule_version) on delete restrict,
  constraint live_battle_boost_events_kind_contract_check check (
    (kind = 'rose_x2' and multiplier = 2 and
     activated_by_user_id is null and source_score_event_id is not null and
     idempotency_key is null) or
    (kind = 'glove_x3' and multiplier = 3 and
     activated_by_user_id is not null and source_score_event_id is null and
     idempotency_key is not null and
     idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
  )
);
create index live_battle_boost_events_active_lookup_idx
  on public.live_battle_boost_events
    (battle_id, side, expires_at, multiplier desc, starts_at, id);
create index live_battle_boost_events_rule_set_idx
  on public.live_battle_boost_events (rule_set_id);
create index live_battle_boost_events_actor_idx
  on public.live_battle_boost_events (activated_by_user_id)
  where activated_by_user_id is not null;
create unique index live_battle_boost_events_source_score_unique
  on public.live_battle_boost_events (source_score_event_id)
  where source_score_event_id is not null;
create unique index live_battle_boost_events_idempotency_unique
  on public.live_battle_boost_events (battle_id, side, idempotency_key)
  where idempotency_key is not null;
alter table public.live_battle_boost_events enable row level security;
revoke all on table public.live_battle_boost_events
  from public, anon, authenticated, service_role;

create or replace function private.validate_live_battle_boost_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_source public.live_battle_score_events%rowtype;
  v_source_gift_id text;
  v_expected_target uuid;
begin
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = new.battle_id;
  if not found
     or v_battle.battle_rule_set_id is distinct from new.rule_set_id
     or v_battle.status is distinct from 'active'
     or v_battle.scheduled_end_at is null
     or new.starts_at >= v_battle.scheduled_end_at
     or new.expires_at > v_battle.scheduled_end_at then
    raise exception using errcode = '23514',
      message = 'live_battle_boost_battle_invalid';
  end if;
  select rules.* into strict v_rules
  from public.live_battle_rule_sets as rules
  where rules.id = new.rule_set_id and rules.rule_version = new.rule_version;
  v_expected_target := case new.side
    when 'challenger' then v_battle.challenger_user_id
    else v_battle.opponent_user_id end;
  if new.kind = 'rose_x2' then
    select event.* into v_source
    from public.live_battle_score_events as event
    where event.id = new.source_score_event_id;
    select gift.gift_id into v_source_gift_id
    from public.live_gift_transactions as gift
    where gift.id = v_source.gift_transaction_id;
    if not found
       or v_source.battle_id is distinct from new.battle_id
       or v_source.target_user_id is distinct from v_expected_target
       or v_source.rule_version is distinct from new.rule_version
       or v_source.created_at > new.starts_at
       or v_source_gift_id is distinct from v_rules.rose_gift_id
       or v_rules.rose_activation_limit_per_side <= 0
       or new.multiplier is distinct from v_rules.rose_multiplier
       or new.expires_at is distinct from least(
         new.starts_at + pg_catalog.make_interval(
           secs => v_rules.rose_duration_seconds
         ),
         v_battle.scheduled_end_at
       ) then
      raise exception using errcode = '23514',
        message = 'live_battle_boost_source_invalid';
    end if;
  elsif new.activated_by_user_id is distinct from v_expected_target
     or v_rules.glove_acquisition_mode is distinct from 'fixed_battle_grant'
     or v_rules.glove_uses_per_side <= 0
     or new.multiplier is distinct from v_rules.glove_multiplier
     or new.expires_at is distinct from least(
       new.starts_at + pg_catalog.make_interval(
         secs => v_rules.glove_duration_seconds
       ),
       v_battle.scheduled_end_at
     ) then
    raise exception using errcode = '23514',
      message = 'live_battle_boost_actor_invalid';
  end if;
  return new;
end;
$$;
create trigger live_battle_boost_events_validate
before insert on public.live_battle_boost_events
for each row execute function private.validate_live_battle_boost_event();

create or replace function private.reject_live_battle_boost_event_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'live_battle_boost_event_immutable';
end;
$$;
create trigger live_battle_boost_events_immutable
before update or delete on public.live_battle_boost_events
for each row execute function private.reject_live_battle_boost_event_mutation();

alter table public.live_battle_score_events
  drop constraint live_battle_score_events_f4b_rule_check,
  drop constraint live_battle_score_events_multiplier_check,
  add constraint live_battle_score_events_multiplier_check
    check (multiplier in (1, 2, 3)),
  add constraint live_battle_score_events_boost_contract_check check (
    (multiplier = 1 and boost_id is null) or
    (multiplier in (2, 3) and boost_id is not null)
  ),
  add constraint live_battle_score_events_boost_fkey
    foreign key (boost_id)
    references public.live_battle_boost_events(id) on delete restrict;
create index live_battle_score_events_boost_idx
  on public.live_battle_score_events (boost_id)
  where boost_id is not null;

create or replace function private.resolve_live_battle_effective_boost_locked(
  p_battle_id uuid,
  p_side text,
  p_now timestamptz
)
returns public.live_battle_boost_events
language plpgsql security definer set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_boost public.live_battle_boost_events%rowtype;
begin
  if p_side not in ('challenger', 'opponent') or p_now is null then
    raise exception using errcode = '22023',
      message = 'live_battle_boost_input_invalid';
  end if;
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_battle.status is distinct from 'active'
     or v_battle.scheduled_end_at is null
     or p_now >= v_battle.scheduled_end_at then
    return null;
  end if;
  select boost.* into v_boost
  from public.live_battle_boost_events as boost
  where boost.battle_id = p_battle_id
    and boost.side = p_side
    and boost.starts_at <= p_now
    and p_now < boost.expires_at
  order by boost.multiplier desc, boost.starts_at, boost.id
  limit 1;
  return v_boost;
end;
$$;

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
     or p_event.base_points is distinct from p_gift.amount_coins::bigint
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

create or replace function private.advance_live_battle_rose_mission_locked(
  p_battle_id uuid,
  p_gift_transaction_id uuid,
  p_score_event_id uuid,
  p_now timestamptz
)
returns public.live_battle_power_states
language plpgsql security definer set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_gift public.live_gift_transactions%rowtype;
  v_score_event public.live_battle_score_events%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_state public.live_battle_power_states%rowtype;
  v_side text;
  v_rose_count integer;
  v_progress integer;
  v_expires_at timestamptz;
  v_activate boolean := false;
begin
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  select gift.* into strict v_gift
  from public.live_gift_transactions as gift
  where gift.id = p_gift_transaction_id and gift.battle_id = p_battle_id;
  select event.* into strict v_score_event
  from public.live_battle_score_events as event
  where event.id = p_score_event_id
    and event.gift_transaction_id = p_gift_transaction_id;
  select rules.* into strict v_rules
  from public.live_battle_rule_sets as rules
  where rules.id = v_battle.battle_rule_set_id;
  v_side := case
    when v_gift.receiver_user_id = v_battle.challenger_user_id
      then 'challenger'
    when v_gift.receiver_user_id = v_battle.opponent_user_id
      then 'opponent'
    else null end;
  if v_side is null then
    raise exception using errcode = '55000',
      message = 'live_battle_score_gift_invalid';
  end if;
  select state.* into v_state
  from public.live_battle_power_states as state
  where state.battle_id = p_battle_id and state.side = v_side
  for update;
  if not found then
    perform private.initialize_live_battle_power_states(p_battle_id);
    select state.* into strict v_state
    from public.live_battle_power_states as state
    where state.battle_id = p_battle_id and state.side = v_side
    for update;
  end if;
  if v_rules.rose_gift_id is null
     or v_gift.gift_id is distinct from v_rules.rose_gift_id
     or v_rules.rose_target_units = 0 then
    return v_state;
  end if;
  select pg_catalog.count(*)::integer into v_rose_count
  from public.live_battle_score_events as event
  join public.live_gift_transactions as gift
    on gift.id = event.gift_transaction_id
  where event.battle_id = p_battle_id
    and event.target_user_id = v_gift.receiver_user_id
    and gift.gift_id = v_rules.rose_gift_id;
  v_progress := least(v_rose_count, v_rules.rose_target_units);
  v_activate := v_state.rose_progress_units < v_rules.rose_target_units
    and v_progress = v_rules.rose_target_units
    and v_state.rose_activations_used < v_rules.rose_activation_limit_per_side
    and v_battle.status = 'active'
    and p_now < v_battle.scheduled_end_at;
  if v_activate then
    v_expires_at := least(
      p_now + pg_catalog.make_interval(secs => v_rules.rose_duration_seconds),
      v_battle.scheduled_end_at
    );
    if v_expires_at > p_now then
      insert into public.live_battle_boost_events (
        battle_id, side, kind, multiplier, starts_at, expires_at,
        source_score_event_id, rule_set_id, rule_version, created_at
      ) values (
        p_battle_id, v_side, 'rose_x2', v_rules.rose_multiplier,
        p_now, v_expires_at, v_score_event.id,
        v_rules.id, v_rules.rule_version, p_now
      );
    else
      v_activate := false;
    end if;
  end if;
  update public.live_battle_power_states as state
  set rose_progress_units = v_progress,
      rose_activations_used = state.rose_activations_used
        + case when v_activate then 1 else 0 end,
      power_version = state.power_version + 1,
      updated_at = p_now
  where state.battle_id = p_battle_id and state.side = v_side
  returning * into v_state;
  return v_state;
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
  v_awarded_points := v_gift.amount_coins::bigint * v_multiplier;
  insert into public.live_battle_score_events (
    battle_id, gift_transaction_id, target_user_id, base_points,
    multiplier, awarded_points, boost_id, rule_version, created_at
  ) values (
    p_battle_id, p_gift_transaction_id, v_gift.receiver_user_id,
    v_gift.amount_coins::bigint, v_multiplier, v_awarded_points,
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

create or replace function public.activate_live_battle_glove(
  p_battle_id uuid,
  p_idempotency_key text
)
returns table (
  boost_id uuid,
  battle_id uuid,
  side text,
  kind text,
  multiplier integer,
  starts_at timestamptz,
  expires_at timestamptz,
  power_version bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_battle public.live_battles%rowtype;
  v_rules public.live_battle_rule_sets%rowtype;
  v_state public.live_battle_power_states%rowtype;
  v_existing public.live_battle_boost_events%rowtype;
  v_boost public.live_battle_boost_events%rowtype;
  v_side text;
  v_server_now timestamptz;
  v_expires_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '28000',
      message = 'live_battle_glove_auth_required';
  end if;
  if p_battle_id is null
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = '22023',
      message = 'live_battle_glove_input_invalid';
  end if;
  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  v_side := case
    when v_actor = v_battle.challenger_user_id then 'challenger'
    when v_actor = v_battle.opponent_user_id then 'opponent'
    else null end;
  if v_side is null then
    raise exception using errcode = '42501',
      message = 'live_battle_glove_forbidden';
  end if;
  select boost.* into v_existing
  from public.live_battle_boost_events as boost
  where boost.battle_id = p_battle_id
    and boost.side = v_side
    and boost.idempotency_key = p_idempotency_key;
  if found then
    select state.* into strict v_state
    from public.live_battle_power_states as state
    where state.battle_id = p_battle_id and state.side = v_side;
    return query select
      v_existing.id, v_existing.battle_id, v_existing.side,
      v_existing.kind, v_existing.multiplier, v_existing.starts_at,
      v_existing.expires_at, v_state.power_version;
    return;
  end if;
  v_server_now := pg_catalog.clock_timestamp();
  if v_battle.status is distinct from 'active' then
    raise exception using errcode = '55000',
      message = 'live_battle_glove_not_active';
  end if;
  if v_battle.scheduled_end_at is null
     or v_server_now >= v_battle.scheduled_end_at then
    raise exception using errcode = '55000',
      message = 'live_battle_glove_deadline_elapsed';
  end if;
  select rules.* into strict v_rules
  from public.live_battle_rule_sets as rules
  where rules.id = v_battle.battle_rule_set_id;
  select state.* into v_state
  from public.live_battle_power_states as state
  where state.battle_id = p_battle_id and state.side = v_side
  for update;
  if not found then
    perform private.initialize_live_battle_power_states(p_battle_id);
    select state.* into strict v_state
    from public.live_battle_power_states as state
    where state.battle_id = p_battle_id and state.side = v_side
    for update;
  end if;
  if v_rules.glove_acquisition_mode is distinct from 'fixed_battle_grant'
     or v_rules.glove_multiplier is distinct from 3
     or v_state.glove_uses_available <= 0 then
    raise exception using errcode = '55000',
      message = 'live_battle_glove_unavailable';
  end if;
  if exists (
    select 1 from public.live_battle_boost_events as boost
    where boost.battle_id = p_battle_id
      and boost.side = v_side
      and boost.kind = 'glove_x3'
      and boost.starts_at <= v_server_now
      and v_server_now < boost.expires_at
  ) then
    raise exception using errcode = '55000',
      message = 'live_battle_glove_already_active';
  end if;
  v_expires_at := least(
    v_server_now + pg_catalog.make_interval(secs => v_rules.glove_duration_seconds),
    v_battle.scheduled_end_at
  );
  if v_expires_at <= v_server_now then
    raise exception using errcode = '55000',
      message = 'live_battle_glove_deadline_elapsed';
  end if;
  insert into public.live_battle_boost_events (
    battle_id, side, kind, multiplier, starts_at, expires_at,
    activated_by_user_id, idempotency_key, rule_set_id, rule_version, created_at
  ) values (
    p_battle_id, v_side, 'glove_x3', v_rules.glove_multiplier,
    v_server_now, v_expires_at, v_actor, p_idempotency_key,
    v_rules.id, v_rules.rule_version, v_server_now
  ) returning * into v_boost;
  update public.live_battle_power_states as state
  set glove_uses_available = state.glove_uses_available - 1,
      glove_uses_consumed = state.glove_uses_consumed + 1,
      power_version = state.power_version + 1,
      updated_at = v_server_now
  where state.battle_id = p_battle_id and state.side = v_side
  returning * into v_state;
  return query select
    v_boost.id, v_boost.battle_id, v_boost.side, v_boost.kind,
    v_boost.multiplier, v_boost.starts_at, v_boost.expires_at,
    v_state.power_version;
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
  select current_rules.rule_set_id into strict v_rule_set_id
  from public.live_battle_current_rule_set as current_rules
  where current_rules.singleton;
  insert into public.live_battles (
    challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at,
    battle_rule_set_id
  ) values (
    v_actor, p_opponent_user_id,
    p_challenger_session_id, p_opponent_session_id,
    'pending', v_now + interval '30 seconds', v_actor,
    'invite_created', 1, v_now, v_now, v_rule_set_id
  ) returning * into v_battle;
  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, v_actor, null, 'pending', 'invite_created', 1, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

alter table public.live_battle_rule_sets owner to postgres;
alter table public.live_battle_current_rule_set owner to postgres;
alter table public.live_battle_power_states owner to postgres;
alter table public.live_battle_boost_events owner to postgres;

alter function private.reject_live_battle_rule_set_mutation() owner to postgres;
alter function private.current_live_battle_rule_set_id() owner to postgres;
alter function private.reject_live_battle_rule_set_change() owner to postgres;
alter function private.live_battle_to_json(public.live_battles) owner to postgres;
alter function private.validate_live_battle_power_state() owner to postgres;
alter function private.initialize_live_battle_power_states(uuid) owner to postgres;
alter function private.initialize_live_battle_power_states_trigger() owner to postgres;
alter function private.validate_live_battle_boost_event() owner to postgres;
alter function private.reject_live_battle_boost_event_mutation() owner to postgres;
alter function private.resolve_live_battle_effective_boost_locked(uuid, text, timestamptz)
  owner to postgres;
alter function private.live_battle_score_event_contract_is_valid(
  public.live_battle_score_events,
  public.live_gift_transactions,
  public.live_battles
) owner to postgres;
alter function private.advance_live_battle_rose_mission_locked(
  uuid, uuid, uuid, timestamptz
) owner to postgres;
alter function private.record_live_battle_score_locked(uuid, uuid, timestamptz)
  owner to postgres;
alter function private.reconcile_live_battle_score_locked(uuid, timestamptz)
  owner to postgres;
alter function public.activate_live_battle_glove(uuid, text) owner to postgres;
alter function public.create_live_battle_invite(uuid, uuid, uuid)
  owner to postgres;

revoke all on function private.reject_live_battle_rule_set_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.current_live_battle_rule_set_id()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_live_battle_rule_set_change()
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_to_json(public.live_battles)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_live_battle_power_state()
  from public, anon, authenticated, service_role;
revoke all on function private.initialize_live_battle_power_states(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.initialize_live_battle_power_states_trigger()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_live_battle_boost_event()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_live_battle_boost_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_live_battle_effective_boost_locked(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.live_battle_score_event_contract_is_valid(
  public.live_battle_score_events,
  public.live_gift_transactions,
  public.live_battles
) from public, anon, authenticated, service_role;
revoke all on function private.advance_live_battle_rose_mission_locked(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.record_live_battle_score_locked(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.reconcile_live_battle_score_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.activate_live_battle_glove(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_live_battle_invite(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_live_battle_glove(uuid, text)
  to authenticated;
grant execute on function public.create_live_battle_invite(uuid, uuid, uuid)
  to authenticated;

comment on table public.live_battle_rule_sets is
  'Immutable server-only Battle scoring rules pinned to each Battle.';
comment on table public.live_battle_power_states is
  'Server-only rose progress and deterministic glove inventory by Battle side.';
comment on table public.live_battle_boost_events is
  'Immutable server-only x2/x3 activation facts; never a financial authority.';

do $$
begin
  if (select pg_catalog.count(*) from public.live_battle_rule_sets) <> 2
     or not exists (
       select 1 from public.live_battle_rule_sets
       where rule_version = 1 and glove_acquisition_mode = 'disabled'
     )
     or not exists (
       select 1 from public.live_battle_rule_sets
       where rule_version = 2 and rose_gift_id = 'rose'
         and rose_target_units = 10 and rose_multiplier = 2
         and rose_duration_seconds = 30
         and rose_activation_limit_per_side = 1
         and glove_multiplier = 3 and glove_duration_seconds = 15
         and glove_uses_per_side = 1
         and glove_acquisition_mode = 'fixed_battle_grant'
     )
     or (select pg_catalog.count(*) from public.live_battle_current_rule_set) <> 1
     or exists (
       select 1
       from public.live_battles as battle
       join public.live_battle_rule_sets as rules
         on rules.id = battle.battle_rule_set_id
       where rules.rule_version <> 1
     )
     or (select pg_catalog.count(*) from public.live_battle_power_states)
        <> 2 * (select pg_catalog.count(*) from public.live_battles)
     or exists (select 1 from public.live_battle_boost_events)
  then
    raise exception 'live Battle F4D-A backfill contract invalid';
  end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where schemaname = 'public'
      and tablename in (
        'live_battle_rule_sets',
        'live_battle_current_rule_set',
        'live_battle_power_states',
        'live_battle_boost_events'
      )
  ) then
    raise exception 'live Battle F4D-A internal table published unexpectedly';
  end if;
end;
$$;

commit;
