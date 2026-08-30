begin;

create temp table lb4_f4a_baseline as
select
  (select count(*) from public.app_wallets) as app_wallets,
  (select count(*) from public.app_wallet_ledger_entries) as app_wallet_ledger_entries,
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as aggregate_balance;

create function pg_temp.proof_user(p_id integer)
returns uuid language sql immutable
as $$ select ('f4a00000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

create function pg_temp.proof_session(p_id integer)
returns uuid language sql immutable
as $$ select ('f4b00000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

create function pg_temp.proof_battle(p_id integer)
returns uuid language sql immutable
as $$ select ('f4c00000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.proof_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f4a-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 14) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.proof_user(n), 'lb4f4a_' || n, 'LB4-F4A ' || n, false
from pg_catalog.generate_series(1, 14) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.proof_session(n), pg_temp.proof_user(n), 'LB4-F4A session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 14) as n;

insert into public.gift_catalog (
  id, emoji, label, cost_coins, active, enabled, category, animation_type,
  duration_ms, priority, sort_order
) values
  ('lb4_f4a_zero_fee', 'Z', 'Zero fee proof', 9, true, true, 'basic', 'floating', 1800, 1, 9901),
  ('lb4_f4a_normal_fee', 'N', 'Normal fee proof', 10, true, true, 'basic', 'floating', 1800, 2, 9902),
  ('lb4_f4a_inactive', 'I', 'Inactive proof', 10, false, false, 'basic', 'floating', 1800, 3, 9903);

insert into public.ledger_accounts (owner_id, account_type, balance, currency)
values
  (pg_temp.proof_user(1), 'user', 100, 'BDAG'),
  (pg_temp.proof_user(2), 'user', 0, 'BDAG'),
  (pg_temp.proof_user(3), 'user', 0, 'BDAG'),
  (pg_temp.proof_user(4), 'user', 0, 'BDAG'),
  (pg_temp.proof_user(5), 'user', 0, 'BDAG');

create function pg_temp.add_battle(
  p_id integer, p_challenger integer, p_opponent integer, p_status text,
  p_end_offset interval default interval '5 minutes'
)
returns uuid language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_accepted timestamptz;
  v_countdown timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_ended timestamptz;
  v_actor uuid;
  v_reason text;
  v_version bigint;
begin
  if p_status = 'pending' then
    v_actor := pg_temp.proof_user(p_challenger);
    v_reason := 'invite_created';
    v_version := 1;
  elsif p_status in ('active', 'completed', 'cancelled') then
    v_accepted := v_now - interval '20 seconds';
    v_countdown := v_now - interval '10 seconds';
    v_start := v_countdown + interval '3 seconds';
    v_end := v_start + interval '300 seconds';
    v_actor := case when p_status = 'cancelled' then pg_temp.proof_user(p_challenger) else null end;
    v_reason := case p_status when 'active' then 'countdown_elapsed'
      when 'completed' then 'battle_duration_elapsed' else 'challenger_cancelled' end;
    v_version := case when p_status = 'active' then 4 else 5 end;
    if p_status = 'active' then
      v_end := v_now + p_end_offset;
      v_start := v_end - interval '300 seconds';
      v_countdown := v_start - interval '3 seconds';
    else
      v_ended := case when p_status = 'completed' then v_end else v_now end;
    end if;
  else
    raise exception 'unsupported proof status';
  end if;

  insert into public.live_battles (
    id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
    status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
    started_at, scheduled_end_at, ended_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at
  ) values (
    pg_temp.proof_battle(p_id), pg_temp.proof_user(p_challenger), pg_temp.proof_user(p_opponent),
    pg_temp.proof_session(p_challenger), pg_temp.proof_session(p_opponent), p_status,
    v_now + interval '1 minute', v_accepted, v_countdown, v_start,
    case when p_status in ('active', 'completed', 'cancelled') then v_start end,
    v_end, v_ended, v_actor, v_reason, v_version, v_now - interval '1 minute', v_now
  );
  return pg_temp.proof_battle(p_id);
end;
$$;

create function pg_temp.assert_rejected(
  p_battle uuid, p_target uuid, p_gift text, p_key text,
  p_expected text, p_marker text
)
returns void language plpgsql
as $$
declare
  v_gifts bigint; v_financial bigint; v_ledger bigint; v_events bigint;
  v_balance numeric; v_message text;
begin
  select count(*) into v_gifts from public.live_gift_transactions;
  select count(*) into v_financial from public.financial_transactions;
  select count(*) into v_ledger from public.ledger_entries;
  select count(*) into v_events from public.live_control_events;
  select balance into v_balance from public.ledger_accounts
    where owner_id = (select auth.uid()) and account_type = 'user';
  begin
    perform public.send_live_battle_gift(p_battle, p_target, p_gift, p_key);
    raise exception using message = p_marker;
  exception when others then
    get stacked diagnostics v_message = message_text;
    if pg_catalog.strpos(v_message, p_expected) = 0 then
      raise exception '%: expected %, got %', p_marker, p_expected, v_message;
    end if;
  end;
  if (select count(*) from public.live_gift_transactions) <> v_gifts
    or (select count(*) from public.financial_transactions) <> v_financial
    or (select count(*) from public.ledger_entries) <> v_ledger
    or (select count(*) from public.live_control_events) <> v_events
    or (select balance from public.ledger_accounts
        where owner_id = (select auth.uid()) and account_type = 'user') is distinct from v_balance
  then raise exception '%: rejected call mutated state', p_marker; end if;
end;
$$;

select pg_temp.add_battle(1, 2, 3, 'active', interval '5 minutes');
select pg_temp.add_battle(2, 8, 9, 'pending');
select pg_temp.add_battle(3, 11, 12, 'completed');
select pg_temp.add_battle(4, 13, 14, 'cancelled');
select pg_temp.add_battle(5, 4, 5, 'active', interval '0 seconds');
select pg_temp.add_battle(6, 6, 7, 'active', interval '-1 second');

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(1)::text, true);

create temp table lb4_f4a_results as
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(1), pg_temp.proof_user(2),
  'lb4_f4a_zero_fee', 'valid-challenger'
);

do $$
declare
  v_result record;
begin
  select * into strict v_result from pg_temp.lb4_f4a_results;
  if v_result.battle_id <> pg_temp.proof_battle(1)
    or v_result.target_session_id <> pg_temp.proof_session(2)
    or v_result.receiver_user_id <> pg_temp.proof_user(2)
    or v_result.amount_coins <> 9
    or v_result.creator_amount_coins <> 9
    or v_result.new_sender_balance <> 91
  then raise exception 'valid_challenger_gift_failed'; end if;
end;
$$;

do $$
declare
  v_first uuid; v_retry uuid; v_gifts bigint; v_financial bigint; v_ledger bigint; v_events bigint;
begin
  select transaction_id into v_first from pg_temp.lb4_f4a_results;
  select count(*) into v_gifts from public.live_gift_transactions;
  select count(*) into v_financial from public.financial_transactions;
  select count(*) into v_ledger from public.ledger_entries;
  select count(*) into v_events from public.live_control_events;
  select transaction_id into v_retry from public.send_live_battle_gift(
    pg_temp.proof_battle(1), pg_temp.proof_user(2),
    'lb4_f4a_zero_fee', 'valid-challenger'
  );
  if v_retry <> v_first
    or (select count(*) from public.live_gift_transactions) <> v_gifts
    or (select count(*) from public.financial_transactions) <> v_financial
    or (select count(*) from public.ledger_entries) <> v_ledger
    or (select count(*) from public.live_control_events) <> v_events
  then raise exception 'idempotent_retry_changed_result'; end if;
end;
$$;

select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(3),
  'lb4_f4a_zero_fee', 'valid-challenger',
  'live_battle_gift_idempotency_conflict', 'idempotency_conflict_not_rejected'
);

insert into pg_temp.lb4_f4a_results
select * from public.send_live_battle_gift(
  pg_temp.proof_battle(1), pg_temp.proof_user(3),
  'lb4_f4a_normal_fee', 'valid-opponent'
);

do $$
declare v_result record;
begin
  select * into strict v_result from pg_temp.lb4_f4a_results
  where receiver_user_id = pg_temp.proof_user(3);
  if v_result.target_session_id <> pg_temp.proof_session(3)
    or v_result.amount_coins <> 10
    or v_result.creator_amount_coins <> 9
    or v_result.new_sender_balance <> 81
  then raise exception 'valid_opponent_gift_failed'; end if;

  if (select platform_fee_coins from public.live_gift_transactions
      where id = (select transaction_id from pg_temp.lb4_f4a_results
                  where receiver_user_id = pg_temp.proof_user(2))) <> 0
  then raise exception 'zero_fee_rounding_invalid'; end if;
  if (select platform_fee_coins from public.live_gift_transactions
      where id = v_result.transaction_id) <> 1
  then raise exception 'normal_fee_rounding_invalid'; end if;
end;
$$;

select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(4),
  'lb4_f4a_zero_fee', 'external-target',
  'live_battle_gift_target_invalid', 'external_target_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(2),
  'lb4_f4a_inactive', 'inactive-gift',
  'live_battle_gift_unavailable', 'inactive_gift_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(2), pg_temp.proof_user(8),
  'lb4_f4a_zero_fee', 'pending-battle',
  'live_battle_gift_not_active', 'non_active_battle_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(3), pg_temp.proof_user(11),
  'lb4_f4a_zero_fee', 'completed-battle',
  'live_battle_gift_not_active', 'completed_battle_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(4), pg_temp.proof_user(13),
  'lb4_f4a_zero_fee', 'cancelled-battle',
  'live_battle_gift_not_active', 'cancelled_battle_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(5), pg_temp.proof_user(4),
  'lb4_f4a_zero_fee', 'deadline-equality',
  'live_battle_gift_deadline_elapsed', 'deadline_equality_not_rejected'
);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(6), pg_temp.proof_user(6),
  'lb4_f4a_zero_fee', 'deadline-elapsed',
  'live_battle_gift_deadline_elapsed', 'deadline_elapsed_not_rejected'
);

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(2)::text, true);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(2),
  'lb4_f4a_zero_fee', 'self-gift',
  'live_battle_gift_self_forbidden', 'self_gift_not_rejected'
);

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(10)::text, true);
select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(2),
  'lb4_f4a_zero_fee', 'insufficient-balance',
  'insufficient balance', 'insufficient_balance_not_rejected'
);

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(1)::text, true);

do $$
declare
  v_battle_gifts bigint;
  v_battle_financial bigint;
  v_battle_entries bigint;
  v_battle_events bigint;
begin
  select count(*) into v_battle_gifts from public.live_gift_transactions
  where battle_id = pg_temp.proof_battle(1);
  select count(*) into v_battle_financial from public.financial_transactions
  where reference_type = 'live_battle' and reference_id = pg_temp.proof_battle(1)::text;
  select count(*) into v_battle_entries from public.ledger_entries e
  where e.metadata ->> 'fin_txn_id' in (
    select f.id::text from public.financial_transactions f
    where f.reference_type = 'live_battle' and f.reference_id = pg_temp.proof_battle(1)::text
  );
  select count(*) into v_battle_events from public.live_control_events e
  where e.payload ->> 'battle_id' = pg_temp.proof_battle(1)::text
    and e.payload ->> 'battle_gift' = 'true';
  if v_battle_gifts <> 2 or v_battle_financial <> 2 or v_battle_entries <> 5
  then raise exception 'economic_row_count_invalid'; end if;
  if v_battle_events <> 4
    or exists (
      select 1 from public.live_gift_transactions g
      where g.battle_id = pg_temp.proof_battle(1)
        and (select count(*) from public.live_control_events e
             where e.payload ->> 'transaction_id' = g.id::text) <> 2
    )
  then raise exception 'symmetric_event_count_invalid'; end if;
  if exists (
    select 1 from public.live_control_events e
    where e.payload ->> 'battle_id' = pg_temp.proof_battle(1)::text
      and (e.payload ? 'balance' or e.payload ? 'ledger_entries'
        or e.payload ? 'financial_transaction_id' or e.payload ? 'idempotency_key')
  ) then raise exception 'symmetric_event_exposes_financial_internal'; end if;
end;
$$;

do $$
declare v_normal record;
begin
  select * into strict v_normal from public.send_live_gift(
    pg_temp.proof_session(2), 'lb4_f4a_zero_fee', 'normal-live-compatible'
  );
  if v_normal.receiver_user_id <> pg_temp.proof_user(2)
    or (select battle_id from public.live_gift_transactions where id = v_normal.transaction_id) is not null
    or (select count(*) from public.live_control_events
        where payload ->> 'transaction_id' = v_normal.transaction_id::text) <> 1
  then raise exception 'normal_live_gift_regressed'; end if;
end;
$$;

create function pg_temp.reject_battle_gift_event()
returns trigger language plpgsql
as $$
begin
  if new.payload ->> 'battle_gift' = 'true'
    and new.payload ->> 'gift_id' = 'lb4_f4a_normal_fee'
  then raise exception 'lb4_f4a_forced_event_failure'; end if;
  return new;
end;
$$;

create trigger lb4_f4a_reject_battle_gift_event
before insert on public.live_control_events
for each row execute function pg_temp.reject_battle_gift_event();

select pg_temp.assert_rejected(
  pg_temp.proof_battle(1), pg_temp.proof_user(2),
  'lb4_f4a_normal_fee', 'forced-event-failure',
  'lb4_f4a_forced_event_failure', 'event_failure_did_not_rollback'
);

drop trigger lb4_f4a_reject_battle_gift_event on public.live_control_events;

do $$
declare
  v_signature regprocedure := 'public.send_live_battle_gift(uuid,uuid,text,text)'::regprocedure;
  v_config text[];
begin
  select p.proconfig into v_config from pg_proc p where p.oid = v_signature;
  if not (select p.prosecdef from pg_proc p where p.oid = v_signature)
    or pg_catalog.cardinality(v_config) <> 1
    or v_config[1] is distinct from
      ('search_path=' || pg_catalog.chr(34) || pg_catalog.chr(34))
    or (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid = v_signature) <> 'postgres'
    or not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
    or exists (
      select 1 from pg_proc p,
        lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where p.oid = v_signature and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  then raise exception 'battle_gift_rpc_acl_invalid'; end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'live_gift_transactions_battle_idempotency_uidx'
      and indexdef like '%(sender_user_id, battle_id, idempotency_key)%'
      and indexdef like '%WHERE (battle_id IS NOT NULL)%'
  ) or not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'live_control_events_session_gift_transaction_uidx'
      and indexdef like '%session_id%transaction_id%'
  ) then raise exception 'battle_gift_index_contract_invalid'; end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name like 'live_battle%score%'
  ) or exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('live_battles', 'live_battle_public_states')
      and column_name in ('score', 'winner', 'outcome', 'score_version')
  ) then raise exception 'score_or_winner_created'; end if;

  if (select count(*) from public.app_wallets)
       <> (select app_wallets from pg_temp.lb4_f4a_baseline)
    or (select count(*) from public.app_wallet_ledger_entries)
       <> (select app_wallet_ledger_entries from pg_temp.lb4_f4a_baseline)
  then raise exception 'legacy_tables_changed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from auth.users where id = 'f4a00000-0000-4000-8000-000000000001'::uuid)
    or exists (select 1 from public.live_sessions where id = 'f4b00000-0000-4000-8000-000000000001'::uuid)
    or exists (select 1 from public.live_battles where id = 'f4c00000-0000-4000-8000-000000000001'::uuid)
    or exists (select 1 from public.gift_catalog where id like 'lb4_f4a_%')
    or exists (select 1 from public.financial_transactions
               where reference_type = 'live_battle'
                 and reference_id::text like 'f4c00000-0000-4000-8000-%')
    or exists (select 1 from public.live_gift_transactions
               where idempotency_key like 'valid-%')
  then raise exception 'fixture_cleanup_failed'; end if;
end;
$$;
