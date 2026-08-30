begin;

create temp table lb4_f4d_a_baseline as
select
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as balance,
  (select count(*) from public.live_battle_boost_events) as boosts;

create function pg_temp.proof_user(p_id integer)
returns uuid language sql immutable
as $$ select ('d4da1000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.proof_session(p_id integer)
returns uuid language sql immutable
as $$ select ('d4da2000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.proof_battle()
returns uuid language sql immutable
as $$ select 'd4da3000-0000-4000-8000-000000000001'::uuid $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.proof_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f4da-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 6) as n;
insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.proof_user(n), 'lb4f4da_' || n, 'LB4-F4D-A ' || n, false
from pg_catalog.generate_series(1, 6) as n;
insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.proof_session(n), pg_temp.proof_user(n), 'LB4-F4D-A session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 6) as n;
insert into public.gift_catalog (
  id, emoji, label, cost_coins, active, enabled, category,
  animation_type, duration_ms, priority, sort_order
) values (
  'lb4_f4d_a_plain', 'P', 'Plain proof', 10, true, true,
  'basic', 'floating', 1800, 1, 9941
);
insert into public.ledger_accounts (owner_id, account_type, balance, currency)
select pg_temp.proof_user(n), 'user',
  case when n = 1 then 2000 else 0 end, 'BDAG'
from pg_catalog.generate_series(1, 6) as n;

with timing as (
  select pg_catalog.clock_timestamp() as now_at
)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
) select
  pg_temp.proof_battle(), pg_temp.proof_user(2), pg_temp.proof_user(3),
  pg_temp.proof_session(2), pg_temp.proof_session(3),
  'active', timing.now_at - interval '50 seconds',
  timing.now_at - interval '40 seconds',
  timing.now_at - interval '35 seconds',
  timing.now_at - interval '32 seconds',
  timing.now_at - interval '32 seconds',
  timing.now_at + interval '4 minutes 28 seconds',
  null, null, 'countdown_elapsed', 4,
  timing.now_at - interval '1 minute', timing.now_at
from timing;

do $$
begin
  if (select rules.rule_version
      from public.live_battles as battle
      join public.live_battle_rule_sets as rules
        on rules.id = battle.battle_rule_set_id
      where battle.id = pg_temp.proof_battle()) <> 2
     or (select count(*) from public.live_battle_power_states
         where battle_id = pg_temp.proof_battle()) <> 2
     or exists (
       select 1 from public.live_battle_power_states
       where battle_id = pg_temp.proof_battle()
         and (glove_uses_available <> 1 or glove_uses_consumed <> 0)
     ) then
    raise exception 'power_state_initialization_failed';
  end if;
end;
$$;

select pg_catalog.set_config(
  'request.jwt.claim.sub', pg_temp.proof_user(1)::text, true
);
do $$
begin
  for n in 1..9 loop
    perform public.send_live_battle_gift(
      pg_temp.proof_battle(), pg_temp.proof_user(2), 'rose',
      'f4d-rose-' || n
    );
  end loop;
  if (select rose_progress_units from public.live_battle_power_states
      where battle_id = pg_temp.proof_battle() and side = 'challenger') <> 9
     or exists (
       select 1 from public.live_battle_boost_events
       where battle_id = pg_temp.proof_battle() and kind = 'rose_x2'
     ) then raise exception 'rose_progress_nine_failed'; end if;
end;
$$;

create temp table lb4_f4d_a_tenth as
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(), pg_temp.proof_user(2), 'rose', 'f4d-rose-10'
);
do $$
declare
  v_tx uuid := (select transaction_id from pg_temp.lb4_f4d_a_tenth);
begin
  if not exists (
    select 1 from public.live_battle_power_states
    where battle_id = pg_temp.proof_battle() and side = 'challenger'
      and rose_progress_units = 10 and rose_activations_used = 1
  ) or (select count(*) from public.live_battle_boost_events
        where battle_id = pg_temp.proof_battle() and kind = 'rose_x2') <> 1
  then raise exception 'rose_tenth_activation_failed'; end if;
  if exists (
    select 1 from public.live_battle_score_events
    where gift_transaction_id = v_tx
      and (multiplier <> 1 or boost_id is not null)
  ) then raise exception 'activating_rose_received_new_x2'; end if;
end;
$$;

select * from public.send_live_battle_gift(
  pg_temp.proof_battle(), pg_temp.proof_user(2),
  'rose', 'f4d-rose-10'
);
do $$
begin
  if (select count(*) from public.live_battle_boost_events
      where battle_id = pg_temp.proof_battle() and kind = 'rose_x2') <> 1
     or (select rose_activations_used from public.live_battle_power_states
         where battle_id = pg_temp.proof_battle() and side = 'challenger') <> 1
  then raise exception 'rose_retry_reactivated'; end if;
end;
$$;

create temp table lb4_f4d_a_x2 as
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(), pg_temp.proof_user(2),
  'lb4_f4d_a_plain', 'f4d-x2'
);
do $$
begin
  if not exists (
    select 1 from public.live_battle_score_events
    where gift_transaction_id = (
      select transaction_id from pg_temp.lb4_f4d_a_x2
    ) and base_points = 10 and multiplier = 2 and awarded_points = 20
      and boost_id is not null and rule_version = 2
  ) then raise exception 'post_rose_gift_not_x2'; end if;
end;
$$;

select pg_catalog.set_config(
  'request.jwt.claim.sub', pg_temp.proof_user(2)::text, true
);
create temp table lb4_f4d_a_glove as
select * from public.activate_live_battle_glove(
  pg_temp.proof_battle(), 'f4d-glove-1'
);
do $$
begin
  if not exists (
    select 1 from pg_temp.lb4_f4d_a_glove
    where side = 'challenger' and kind = 'glove_x3' and multiplier = 3
      and expires_at > starts_at
  ) or not exists (
    select 1 from public.live_battle_power_states
    where battle_id = pg_temp.proof_battle() and side = 'challenger'
      and glove_uses_available = 0 and glove_uses_consumed = 1
  ) then raise exception 'glove_activation_failed'; end if;
end;
$$;

select * from public.activate_live_battle_glove(
  pg_temp.proof_battle(), 'f4d-glove-1'
);
do $$
begin
  if (select count(*) from public.live_battle_boost_events
      where battle_id = pg_temp.proof_battle() and kind = 'glove_x3') <> 1
     or (select glove_uses_consumed from public.live_battle_power_states
         where battle_id = pg_temp.proof_battle() and side = 'challenger') <> 1
  then raise exception 'glove_retry_consumed_use'; end if;
  begin
    perform public.activate_live_battle_glove(
      pg_temp.proof_battle(), 'f4d-glove-2'
    );
    raise exception 'second_active_glove_allowed';
  exception when sqlstate '55000' then
    if sqlerrm not in (
      'live_battle_glove_unavailable',
      'live_battle_glove_already_active'
    ) then raise; end if;
  end;
end;
$$;

do $$
declare
  v_key text;
begin
  for v_key in select unnest(array['', 'bad key', repeat('x', 129)])
  loop
    begin
      perform public.activate_live_battle_glove(pg_temp.proof_battle(), v_key);
      raise exception 'invalid_glove_key_allowed';
    exception when sqlstate '22023' then
      if sqlerrm <> 'live_battle_glove_input_invalid' then raise; end if;
    end;
  end loop;
end;
$$;

select pg_catalog.set_config(
  'request.jwt.claim.sub', pg_temp.proof_user(4)::text, true
);
do $$
begin
  begin
    perform public.activate_live_battle_glove(
      pg_temp.proof_battle(), 'outsider-key'
    );
    raise exception 'outsider_glove_allowed';
  exception when sqlstate '42501' then
    if sqlerrm <> 'live_battle_glove_forbidden' then raise; end if;
  end;
end;
$$;

select pg_catalog.set_config(
  'request.jwt.claim.sub', pg_temp.proof_user(1)::text, true
);
create temp table lb4_f4d_a_x3 as
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(), pg_temp.proof_user(2),
  'lb4_f4d_a_plain', 'f4d-x3'
);
do $$
declare
  v_glove public.live_battle_boost_events%rowtype;
  v_resumed public.live_battle_boost_events%rowtype;
begin
  if not exists (
    select 1 from public.live_battle_score_events
    where gift_transaction_id = (
      select transaction_id from pg_temp.lb4_f4d_a_x3
    ) and base_points = 10 and multiplier = 3 and awarded_points = 30
      and boost_id = (select boost_id from pg_temp.lb4_f4d_a_glove limit 1)
  ) then raise exception 'parallel_boost_precedence_failed'; end if;
  select boost.* into strict v_glove
  from public.live_battle_boost_events as boost
  where boost.id = (select boost_id from pg_temp.lb4_f4d_a_glove limit 1);
  v_resumed := private.resolve_live_battle_effective_boost_locked(
    pg_temp.proof_battle(), 'challenger',
    v_glove.expires_at + interval '1 millisecond'
  );
  if v_resumed.kind is distinct from 'rose_x2' then
    raise exception 'x2_did_not_resume_after_x3';
  end if;
end;
$$;

do $$
declare
  v_tx uuid := (select transaction_id from pg_temp.lb4_f4d_a_x3);
  v_gift public.live_gift_transactions%rowtype;
  v_event public.live_battle_score_events%rowtype;
begin
  select gift.* into strict v_gift
  from public.live_gift_transactions as gift where gift.id = v_tx;
  select event.* into strict v_event
  from public.live_battle_score_events as event
  where event.gift_transaction_id = v_tx;
  if v_gift.amount_coins <> 10 or v_event.base_points <> 10
     or v_event.multiplier <> 3 or v_event.awarded_points <> 30
     or v_gift.platform_fee_coins <> pg_catalog.floor(10::numeric * 0.10)
     or v_gift.creator_amount_coins
        <> v_gift.amount_coins - v_gift.platform_fee_coins then
    raise exception 'financial_multiplier_leak';
  end if;
  perform private.reconcile_live_battle_score_locked(
    pg_temp.proof_battle(), pg_catalog.clock_timestamp()
  );
  if (select challenger_score from public.live_battle_score_states
      where battle_id = pg_temp.proof_battle())
     is distinct from (
       select coalesce(sum(awarded_points), 0)
       from public.live_battle_score_events
       where battle_id = pg_temp.proof_battle()
         and target_user_id = pg_temp.proof_user(2)
     ) then raise exception 'score_reconciliation_failed'; end if;
end;
$$;

with timing as (
  select pg_catalog.clock_timestamp() as now_at
)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id, status,
  invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at, battle_rule_set_id
) select
  'd4da3000-0000-4000-8000-000000000002'::uuid,
  pg_temp.proof_user(5), pg_temp.proof_user(6),
  pg_temp.proof_session(5), pg_temp.proof_session(6), 'completed',
  timing.now_at - interval '9 minutes 30 seconds',
  timing.now_at - interval '9 minutes',
  timing.now_at - interval '7 minutes 3 seconds',
  timing.now_at - interval '7 minutes',
  timing.now_at - interval '7 minutes',
  timing.now_at - interval '2 minutes',
  timing.now_at - interval '2 minutes',
  null, 'battle_duration_elapsed', 5,
  timing.now_at - interval '10 minutes',
  timing.now_at - interval '2 minutes', rules.id
from public.live_battle_rule_sets as rules
cross join timing
where rules.rule_version = 1;

do $$
begin
  if exists (
    select 1 from public.live_battle_power_states
    where battle_id = 'd4da3000-0000-4000-8000-000000000002'::uuid
      and (rose_progress_units <> 0 or rose_activations_used <> 0
        or glove_uses_available <> 0 or glove_uses_consumed <> 0)
  ) then raise exception 'historical_rule_changed'; end if;
  begin
    update public.live_battle_rule_sets
    set rose_target_units = 11 where rule_version = 2;
    raise exception 'rule_mutation_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_rule_set_immutable' then raise; end if;
  end;
  begin
    update public.live_battles
    set battle_rule_set_id = (
      select id from public.live_battle_rule_sets where rule_version = 1
    ) where id = pg_temp.proof_battle();
    raise exception 'battle_rule_mutation_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_rule_set_immutable' then raise; end if;
  end;
  begin
    update public.live_battle_boost_events
    set expires_at = expires_at + interval '1 second'
    where battle_id = pg_temp.proof_battle();
    raise exception 'boost_mutation_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_boost_event_immutable' then raise; end if;
  end;
end;
$$;

select pg_catalog.set_config(
  'request.jwt.claim.sub', pg_temp.proof_user(5)::text, true
);
do $$
begin
  begin
    perform public.activate_live_battle_glove(
      'd4da3000-0000-4000-8000-000000000002'::uuid,
      'terminal-glove'
    );
    raise exception 'terminal_glove_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_glove_not_active' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_table text;
  v_privilege text;
begin
  foreach v_table in array array[
    'live_battle_rule_sets', 'live_battle_current_rule_set',
    'live_battle_power_states', 'live_battle_boost_events'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relname = v_table
        and class.relrowsecurity
    ) then raise exception 'power_rls_not_enabled'; end if;
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    loop
      if pg_catalog.has_table_privilege(
        'authenticated', 'public.' || v_table, v_privilege
      ) or pg_catalog.has_table_privilege(
        'anon', 'public.' || v_table, v_privilege
      ) then raise exception 'internal_power_table_privilege_present'; end if;
    end loop;
  end loop;
  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.activate_live_battle_glove(uuid,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'anon',
       'public.activate_live_battle_glove(uuid,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role',
       'public.activate_live_battle_glove(uuid,text)',
       'EXECUTE'
     ) then raise exception 'glove_acl_invalid'; end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where schemaname = 'public'
      and tablename in (
        'live_battle_rule_sets', 'live_battle_current_rule_set',
        'live_battle_power_states', 'live_battle_boost_events'
      )
  ) then raise exception 'internal_power_table_published'; end if;
end;
$$;

do $$
begin
  if (select count(*) from public.live_gift_transactions
      where battle_id = pg_temp.proof_battle())
     is distinct from
     (select count(*) from public.live_battle_score_events
      where battle_id = pg_temp.proof_battle())
     or exists (
       select 1
       from public.live_battle_score_events as event
       join public.live_gift_transactions as gift
         on gift.id = event.gift_transaction_id
       where event.battle_id = pg_temp.proof_battle()
         and event.base_points <> gift.amount_coins
     )
  then raise exception 'gift_score_one_to_one_failed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users
    where id::text like 'd4da1000-0000-4000-8000-%'
  ) or exists (
    select 1 from public.live_battles
    where id in (
      'd4da3000-0000-4000-8000-000000000001'::uuid,
      'd4da3000-0000-4000-8000-000000000002'::uuid
    )
  ) or exists (
    select 1 from public.gift_catalog where id = 'lb4_f4d_a_plain'
  ) then raise exception 'lb4_f4d_a_fixture_residue'; end if;
end;
$$;
