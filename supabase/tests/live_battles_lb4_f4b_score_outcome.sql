begin;

create temp table lb4_f4b_baseline as
select
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select count(*) from public.live_battle_score_events) as score_events,
  (select count(*) from public.live_battle_score_states) as score_states,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as aggregate_balance;

create function pg_temp.proof_user(p_id integer)
returns uuid language sql immutable
as $$ select ('f4b10000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

create function pg_temp.proof_session(p_id integer)
returns uuid language sql immutable
as $$ select ('f4b20000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

create function pg_temp.proof_battle(p_id integer)
returns uuid language sql immutable
as $$ select ('f4b30000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.proof_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f4b-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 14) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.proof_user(n), 'lb4f4b_' || n, 'LB4-F4B ' || n, false
from pg_catalog.generate_series(1, 14) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.proof_session(n), pg_temp.proof_user(n), 'LB4-F4B session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 14) as n;

insert into public.gift_catalog (
  id, emoji, label, cost_coins, active, enabled, category, animation_type,
  duration_ms, priority, sort_order
) values
  ('lb4_f4b_nine', '9', 'Nine point proof', 9, true, true, 'basic', 'floating', 1800, 1, 9911),
  ('lb4_f4b_ten', '10', 'Ten point proof', 10, true, true, 'basic', 'floating', 1800, 2, 9912);

insert into public.ledger_accounts (owner_id, account_type, balance, currency)
select pg_temp.proof_user(n), 'user', case when n = 1 then 500 else 0 end, 'BDAG'
from pg_catalog.generate_series(1, 14) as n;

create function pg_temp.add_active_battle(
  p_id integer, p_challenger integer, p_opponent integer,
  p_end_offset interval default interval '5 minutes'
)
returns uuid language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_end timestamptz := v_now + p_end_offset;
  v_start timestamptz := v_end - interval '5 minutes';
begin
  insert into public.live_battles (
    id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
    status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
    started_at, scheduled_end_at, ended_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at
  ) values (
    pg_temp.proof_battle(p_id), pg_temp.proof_user(p_challenger), pg_temp.proof_user(p_opponent),
    pg_temp.proof_session(p_challenger), pg_temp.proof_session(p_opponent), 'active',
    v_now - interval '30 seconds', v_now - interval '20 seconds',
    v_start - interval '3 seconds', v_start, v_start, v_end, null, null,
    'countdown_elapsed', 4, v_now - interval '1 minute', v_now
  );
  return pg_temp.proof_battle(p_id);
end;
$$;

select pg_temp.add_active_battle(1, 2, 3);
select pg_temp.add_active_battle(2, 4, 5);
select pg_temp.add_active_battle(3, 6, 7);
select pg_temp.add_active_battle(4, 8, 9);
select pg_temp.add_active_battle(5, 10, 11, interval '-1 second');
select pg_temp.add_active_battle(6, 12, 13);

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(1)::text, true);

create temp table lb4_f4b_gifts as
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(1), pg_temp.proof_user(2), 'lb4_f4b_nine', 'battle-1-challenger-1'
);
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(1), pg_temp.proof_user(2), 'lb4_f4b_ten', 'battle-1-challenger-2'
);
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(1), pg_temp.proof_user(3), 'lb4_f4b_nine', 'battle-1-opponent-1'
);

do $$
declare
  v_gift uuid;
begin
  if (select count(*) from public.live_battle_score_events
      where battle_id = pg_temp.proof_battle(1)) <> 3 then
    raise exception 'one_score_event_per_gift_failed';
  end if;
  if exists (
    select 1 from public.live_battle_score_events
    where battle_id = pg_temp.proof_battle(1)
      and (base_points <> awarded_points or multiplier <> 1
        or boost_id is not null or rule_version <> 1)
  ) then raise exception 'f4b_multiplier_contract_failed'; end if;
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(1)
      and challenger_score = 19 and opponent_score = 9
      and score_version = 3 and outcome = 'pending' and winner_user_id is null
  ) then raise exception 'aggregate_score_failed'; end if;
  if (select count(distinct (challenger_score, opponent_score, score_version, outcome))
      from public.live_battle_public_states
      where battle_id = pg_temp.proof_battle(1)) <> 1
    or (select count(*) from public.live_battle_public_states
        where battle_id = pg_temp.proof_battle(1)
          and challenger_score = 19 and opponent_score = 9 and score_version = 3) <> 2
  then raise exception 'symmetric_projection_failed'; end if;

  select transaction_id into v_gift from pg_temp.lb4_f4b_gifts limit 1;
  perform public.send_live_battle_gift(
    pg_temp.proof_battle(1), pg_temp.proof_user(2), 'lb4_f4b_nine', 'battle-1-challenger-1'
  );
  if (select count(*) from public.live_battle_score_events
      where gift_transaction_id = v_gift) <> 1
    or (select score_version from public.live_battle_score_states
        where battle_id = pg_temp.proof_battle(1)) <> 3
  then raise exception 'idempotent_retry_changed_score'; end if;
end;
$$;

-- Reconciliation repairs only aggregate/projection and never creates financial facts.
update public.live_battle_score_states
set challenger_score = 0, opponent_score = 0, score_version = 0
where battle_id = pg_temp.proof_battle(1);
select private.reconcile_live_battle_score_locked(
  pg_temp.proof_battle(1), pg_catalog.clock_timestamp()
);

do $$
begin
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(1)
      and challenger_score = 19 and opponent_score = 9 and score_version = 3
  ) then raise exception 'aggregate_reconciliation_failed'; end if;
end;
$$;

-- Server-side completion decides challenger, opponent and tie outcomes.
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(2), pg_temp.proof_user(5), 'lb4_f4b_ten', 'battle-2-opponent'
);
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(3), pg_temp.proof_user(6), 'lb4_f4b_nine', 'battle-3-challenger'
);
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(3), pg_temp.proof_user(7), 'lb4_f4b_nine', 'battle-3-opponent'
);
insert into pg_temp.lb4_f4b_gifts
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(4), pg_temp.proof_user(8), 'lb4_f4b_nine', 'battle-4-cancelled'
);

select private.live_battle_transition(
  pg_temp.proof_battle(1), 'active', 'completed', null,
  'battle_duration_elapsed', pg_catalog.clock_timestamp()
);
select private.live_battle_transition(
  pg_temp.proof_battle(2), 'active', 'completed', null,
  'battle_duration_elapsed', pg_catalog.clock_timestamp()
);
select private.live_battle_transition(
  pg_temp.proof_battle(3), 'active', 'completed', null,
  'battle_duration_elapsed', pg_catalog.clock_timestamp()
);
select private.live_battle_transition(
  pg_temp.proof_battle(4), 'active', 'cancelled', pg_temp.proof_user(8),
  'challenger_cancelled', pg_catalog.clock_timestamp()
);

do $$
declare
  v_version bigint;
  v_projection bigint;
begin
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(1) and outcome = 'challenger'
      and winner_user_id = pg_temp.proof_user(2) and finalized_at is not null
  ) then raise exception 'challenger_outcome_failed'; end if;
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(2) and outcome = 'opponent'
      and winner_user_id = pg_temp.proof_user(5) and finalized_at is not null
  ) then raise exception 'opponent_outcome_failed'; end if;
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(3) and outcome = 'tie'
      and winner_user_id is null and finalized_at is not null
  ) then raise exception 'tie_outcome_failed'; end if;
  if not exists (
    select 1 from public.live_battle_score_states
    where battle_id = pg_temp.proof_battle(4) and outcome = 'cancelled'
      and winner_user_id is null and finalized_at is not null
      and challenger_score = 9
  ) then raise exception 'cancelled_outcome_or_gift_retention_failed'; end if;

  select score_version into v_version from public.live_battle_score_states
  where battle_id = pg_temp.proof_battle(1);
  select min(projection_version) into v_projection from public.live_battle_public_states
  where battle_id = pg_temp.proof_battle(1);
  perform private.reconcile_live_battle_score_locked(
    pg_temp.proof_battle(1), pg_catalog.clock_timestamp()
  );
  if (select score_version from public.live_battle_score_states
      where battle_id = pg_temp.proof_battle(1)) <> v_version
    or (select min(projection_version) from public.live_battle_public_states
        where battle_id = pg_temp.proof_battle(1)) <> v_projection
  then raise exception 'terminal_reconciliation_not_idempotent'; end if;
end;
$$;

-- Missing competitive facts are detected; the subtransaction rolls the probe back.
do $$
declare v_message text;
begin
  begin
    insert into public.live_gift_transactions (
      sender_user_id, receiver_user_id, session_id, gift_id, emoji,
      amount_coins, platform_fee_coins, creator_amount_coins,
      idempotency_key, battle_id, created_at
    ) values (
      pg_temp.proof_user(1), pg_temp.proof_user(2), pg_temp.proof_session(2),
      'lb4_f4b_nine', '9', 9, 0, 9, 'missing-score-probe',
      pg_temp.proof_battle(1), pg_catalog.clock_timestamp()
    );
    perform private.reconcile_live_battle_score_locked(
      pg_temp.proof_battle(1), pg_catalog.clock_timestamp()
    );
    raise exception 'missing_score_event_not_detected';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if pg_catalog.strpos(v_message, 'live_battle_score_reconciliation_mismatch') = 0 then
      raise exception 'unexpected_reconciliation_error: %', v_message;
    end if;
  end;
end;
$$;

-- A score write failure must roll back gift, money, ledger and visual events.
create function pg_temp.fail_score_insert()
returns trigger language plpgsql as $$
begin
  raise exception 'lb4_f4b_forced_score_failure';
end;
$$;
create trigger lb4_f4b_force_score_failure
before insert on public.live_battle_score_events
for each row execute function pg_temp.fail_score_insert();

do $$
declare
  v_gifts bigint; v_financial bigint; v_ledger bigint; v_visual bigint;
  v_balance numeric; v_message text;
begin
  select count(*) into v_gifts from public.live_gift_transactions;
  select count(*) into v_financial from public.financial_transactions;
  select count(*) into v_ledger from public.ledger_entries;
  select count(*) into v_visual from public.live_control_events;
  select balance into v_balance from public.ledger_accounts
    where owner_id = pg_temp.proof_user(1) and account_type = 'user';
  begin
    perform public.send_live_battle_gift(
      pg_temp.proof_battle(6), pg_temp.proof_user(12),
      'lb4_f4b_nine', 'forced-score-failure'
    );
    raise exception 'score_failure_not_raised';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if pg_catalog.strpos(v_message, 'lb4_f4b_forced_score_failure') = 0 then
      raise exception 'unexpected_score_failure: %', v_message;
    end if;
  end;
  if (select count(*) from public.live_gift_transactions) <> v_gifts
    or (select count(*) from public.financial_transactions) <> v_financial
    or (select count(*) from public.ledger_entries) <> v_ledger
    or (select count(*) from public.live_control_events) <> v_visual
    or (select balance from public.ledger_accounts
        where owner_id = pg_temp.proof_user(1) and account_type = 'user') <> v_balance
  then raise exception 'score_failure_did_not_roll_back_money'; end if;
end;
$$;
drop trigger lb4_f4b_force_score_failure on public.live_battle_score_events;

do $$
declare v_message text;
begin
  begin
    perform public.send_live_battle_gift(
      pg_temp.proof_battle(5), pg_temp.proof_user(10),
      'lb4_f4b_nine', 'past-deadline'
    );
    raise exception 'past_deadline_gift_not_rejected';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if pg_catalog.strpos(v_message, 'live_battle_gift_deadline_elapsed') = 0 then
      raise exception 'unexpected_deadline_error: %', v_message;
    end if;
  end;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_catalog.pg_class
      where oid = 'public.live_battle_score_events'::regclass)
    or not (select relrowsecurity from pg_catalog.pg_class
      where oid = 'public.live_battle_score_states'::regclass)
  then raise exception 'score_rls_not_enabled'; end if;
  if has_table_privilege('authenticated', 'public.live_battle_score_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.live_battle_score_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.live_battle_score_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.live_battle_score_events', 'DELETE')
    or has_table_privilege('authenticated', 'public.live_battle_score_states', 'SELECT')
    or has_table_privilege('authenticated', 'public.live_battle_score_states', 'INSERT')
    or has_table_privilege('authenticated', 'public.live_battle_score_states', 'UPDATE')
    or has_table_privilege('authenticated', 'public.live_battle_score_states', 'DELETE')
  then raise exception 'authenticated_score_table_privilege_present'; end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('live_battle_score_events', 'live_battle_score_states')
  ) then raise exception 'internal_score_table_published'; end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('live_battle_score_events', 'live_battle_score_states')
  ) then raise exception 'client_score_policy_present'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from auth.users where email like 'lb4f4b-%@proof.local')
    or exists (select 1 from public.gift_catalog where id like 'lb4_f4b_%')
    or exists (select 1 from public.live_battles where id::text like 'f4b30000-%')
  then raise exception 'lb4_f4b_fixture_residue'; end if;
end;
$$;
