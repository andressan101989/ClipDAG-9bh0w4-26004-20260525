begin;

create temp table f8_baseline as
select
  (select pg_catalog.count(*) from public.live_gift_transactions) gifts,
  (select pg_catalog.count(*) from public.financial_transactions) financial,
  (select pg_catalog.count(*) from public.ledger_entries) ledger,
  (select coalesce(pg_catalog.sum(balance), 0) from public.ledger_accounts) balances,
  (select pg_catalog.count(*) from public.live_battle_score_events) score_events;

create function pg_temp.f8_user(p_id integer)
returns uuid language sql immutable
as $$ select ('f8a10000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.f8_session(p_id integer)
returns uuid language sql immutable
as $$ select ('f8a20000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.f8_series()
returns uuid language sql immutable
as $$ select 'f8a30000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.f8_battle()
returns uuid language sql immutable
as $$ select 'f8a40000-0000-4000-8000-000000000001'::uuid $$;

do $$
declare
  v_case record;
begin
  for v_case in
    select * from (values
      (1::bigint, 0::bigint, 1::bigint),
      (5::bigint, 2::bigint, 3::bigint),
      (10::bigint, 4::bigint, 6::bigint),
      (20::bigint, 7::bigint, 13::bigint),
      (100::bigint, 35::bigint, 65::bigint)
    ) as expected(gross, fee, net)
  loop
    if not exists (
      select 1
      from private.live_gift_commission_split(v_case.gross) as split
      where split.platform_fee_amount = v_case.fee
        and split.creator_net_amount = v_case.net
    ) then
      raise exception 'f8_half_up_case_failed gross=%', v_case.gross;
    end if;
  end loop;

  if exists (
    select 1
    from public.gift_catalog as gift
    cross join lateral private.live_gift_commission_split(gift.cost_coins::bigint) as split
    where gift.active and gift.enabled
      and (split.platform_fee_amount < 0
        or split.platform_fee_amount > gift.cost_coins
        or split.creator_net_amount < 0
        or split.creator_net_amount + split.platform_fee_amount <> gift.cost_coins)
  ) then
    raise exception 'f8_active_catalog_split_invariant_failed';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.f8_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f8a-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 3) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.f8_user(n), 'lb4f8a_' || n, 'LB4-F8-A ' || n, false
from pg_catalog.generate_series(1, 3) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.f8_session(n), pg_temp.f8_user(n), 'LB4-F8-A session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(2, 3) as n;

insert into public.ledger_accounts (owner_id, account_type, balance, currency)
values
  (pg_temp.f8_user(1), 'user', 100, 'BDAG'),
  (pg_temp.f8_user(2), 'user', 0, 'BDAG'),
  (pg_temp.f8_user(3), 'user', 0, 'BDAG');

insert into public.ledger_accounts (
  id, owner_id, account_type, balance, currency
) values (
  'f8a50000-0000-4000-8000-000000000001'::uuid,
  null, 'platform', 0, 'BDAG'
) on conflict do nothing;

insert into public.live_battle_series (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  format, max_rounds, wins_required, status
) values (
  pg_temp.f8_series(), pg_temp.f8_user(2), pg_temp.f8_user(3),
  pg_temp.f8_session(2), pg_temp.f8_session(3),
  'best_of_5', 5, 3, 'active'
);

with timing as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at, series_id, round_number, battle_rule_set_id
)
select
  pg_temp.f8_battle(), pg_temp.f8_user(2), pg_temp.f8_user(3),
  pg_temp.f8_session(2), pg_temp.f8_session(3),
  'active', timing.now_at - interval '50 seconds',
  timing.now_at - interval '40 seconds', timing.now_at - interval '35 seconds',
  timing.now_at - interval '32 seconds', timing.now_at - interval '32 seconds',
  timing.now_at + interval '4 minutes 28 seconds', null,
  null, 'countdown_elapsed', 4, timing.now_at - interval '1 minute',
  timing.now_at, pg_temp.f8_series(), 1, rules.id
from timing
join public.live_battle_rule_sets as rules on rules.rule_version = 2;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f8_user(1)::text, true);

create temp table f8_live_result as
select * from public.send_live_gift(pg_temp.f8_session(2), 'rose', 'f8-live-rose');
create temp table f8_live_retry as
select * from public.send_live_gift(pg_temp.f8_session(2), 'rose', 'f8-live-rose');

do $$
declare
  v_financial_id uuid;
  v_sender_account uuid;
  v_creator_account uuid;
  v_platform_account uuid;
begin
  select financial_transaction_id into strict v_financial_id
  from public.live_gift_transactions
  where id = (select transaction_id from f8_live_result);
  select id into strict v_sender_account from public.ledger_accounts
    where owner_id = pg_temp.f8_user(1) and account_type = 'user';
  select id into strict v_creator_account from public.ledger_accounts
    where owner_id = pg_temp.f8_user(2) and account_type = 'user';
  select id into strict v_platform_account from public.ledger_accounts
    where owner_id is null and account_type = 'platform';

  if (select transaction_id from f8_live_result) is distinct from
       (select transaction_id from f8_live_retry)
     or (select pg_catalog.count(*) from public.live_gift_transactions
         where session_id = pg_temp.f8_session(2)
           and sender_user_id = pg_temp.f8_user(1)
           and idempotency_key = 'f8-live-rose') <> 1
     or (select pg_catalog.count(*) from public.financial_transactions
         where id = v_financial_id) <> 1
     or (select pg_catalog.count(*) from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 3
     or not exists (
       select 1 from public.live_gift_transactions
       where id = (select transaction_id from f8_live_result)
         and amount_coins = 5 and platform_fee_coins = 2
         and creator_amount_coins = 3
     )
     or not exists (
       select 1 from public.financial_transactions
       where id = v_financial_id and amount = 5 and fee_amount = 2
         and operation_type = 'live_gift'
         and reference_type = 'live_session'
         and reference_id = pg_temp.f8_session(2)::text
     )
     or not exists (
       select 1 from public.ledger_entries
       where metadata ->> 'fin_txn_id' = v_financial_id::text
         and account_id = v_sender_account and entry_type = 'debit' and amount = 5
     )
     or not exists (
       select 1 from public.ledger_entries
       where metadata ->> 'fin_txn_id' = v_financial_id::text
         and account_id = v_creator_account and entry_type = 'credit' and amount = 3
     )
     or not exists (
       select 1 from public.ledger_entries
       where metadata ->> 'fin_txn_id' = v_financial_id::text
         and account_id = v_platform_account and entry_type = 'credit' and amount = 2
     )
     or (select pg_catalog.sum(case when entry_type = 'credit' then amount else -amount end)
         from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 0
     or (select balance from public.ledger_accounts where id = v_sender_account) <> 95
     or (select balance from public.ledger_accounts where id = v_creator_account) <> 3
     or (select balance from public.ledger_accounts where id = v_platform_account) <> 2
  then
    raise exception 'f8_live_5_split_or_idempotency_invalid';
  end if;
end;
$$;

create temp table f8_battle_result as
select * from public.send_live_battle_gift(
  pg_temp.f8_battle(), pg_temp.f8_user(2), 'rose', 'f8-battle-rose'
);
create temp table f8_battle_retry as
select * from public.send_live_battle_gift(
  pg_temp.f8_battle(), pg_temp.f8_user(2), 'rose', 'f8-battle-rose'
);

do $$
declare
  v_financial_id uuid;
  v_sender_account uuid;
  v_creator_account uuid;
  v_platform_account uuid;
begin
  select financial_transaction_id into strict v_financial_id
  from public.live_gift_transactions
  where id = (select transaction_id from f8_battle_result);
  select id into strict v_sender_account from public.ledger_accounts
    where owner_id = pg_temp.f8_user(1) and account_type = 'user';
  select id into strict v_creator_account from public.ledger_accounts
    where owner_id = pg_temp.f8_user(2) and account_type = 'user';
  select id into strict v_platform_account from public.ledger_accounts
    where owner_id is null and account_type = 'platform';

  if (select transaction_id from f8_battle_result) is distinct from
       (select transaction_id from f8_battle_retry)
     or (select pg_catalog.count(*) from public.live_gift_transactions
         where battle_id = pg_temp.f8_battle()
           and idempotency_key = 'f8-battle-rose') <> 1
     or (select pg_catalog.count(*) from public.financial_transactions
         where id = v_financial_id) <> 1
     or (select pg_catalog.count(*) from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 3
     or not exists (
       select 1 from public.live_gift_transactions
       where id = (select transaction_id from f8_battle_result)
         and battle_id = pg_temp.f8_battle()
         and amount_coins = 5 and platform_fee_coins = 2
         and creator_amount_coins = 3
     )
     or not exists (
       select 1 from public.live_battle_score_events
       where gift_transaction_id = (select transaction_id from f8_battle_result)
         and base_points = 5 and multiplier = 1 and awarded_points = 5
     )
     or (select pg_catalog.count(*) from public.live_battle_score_events
         where gift_transaction_id = (select transaction_id from f8_battle_result)) <> 1
     or (select rose_progress_units from public.live_battle_power_states
         where battle_id = pg_temp.f8_battle() and side = 'challenger') <> 1
     or (select balance from public.ledger_accounts where id = v_sender_account) <> 90
     or (select balance from public.ledger_accounts where id = v_creator_account) <> 6
     or (select balance from public.ledger_accounts where id = v_platform_account) <> 4
     or (select pg_catalog.sum(case when entry_type = 'credit' then amount else -amount end)
         from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 0
  then
    raise exception 'f8_battle_5_split_score_or_idempotency_invalid';
  end if;
end;
$$;

create temp table f8_zero_fee_result as
select * from public.send_live_gift(pg_temp.f8_session(3), 'heart', 'f8-live-one');

do $$
declare
  v_financial_id uuid;
begin
  select financial_transaction_id into strict v_financial_id
  from public.live_gift_transactions
  where id = (select transaction_id from f8_zero_fee_result);
  if not exists (
       select 1 from public.live_gift_transactions
       where id = (select transaction_id from f8_zero_fee_result)
         and amount_coins = 1 and platform_fee_coins = 0
         and creator_amount_coins = 1
     )
     or (select pg_catalog.count(*) from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 2
     or exists (
       select 1 from public.ledger_entries
       where metadata ->> 'fin_txn_id' = v_financial_id::text and amount = 0
     )
     or (select pg_catalog.sum(case when entry_type = 'credit' then amount else -amount end)
         from public.ledger_entries
         where metadata ->> 'fin_txn_id' = v_financial_id::text) <> 0
  then
    raise exception 'f8_zero_fee_journal_invalid';
  end if;
end;
$$;

create temp table f8_before_insufficient as
select
  (select pg_catalog.count(*) from public.live_gift_transactions) gifts,
  (select pg_catalog.count(*) from public.financial_transactions) financial,
  (select pg_catalog.count(*) from public.ledger_entries) ledger,
  (select pg_catalog.count(*) from public.live_battle_score_events) score,
  (select balance from public.ledger_accounts
   where owner_id = pg_temp.f8_user(1) and account_type = 'user') sender_balance;

do $$
begin
  begin
    perform public.send_live_battle_gift(
      pg_temp.f8_battle(), pg_temp.f8_user(2),
      'corona_de_auroras', 'f8-insufficient'
    );
    raise exception 'f8_insufficient_balance_allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'insufficient balance or account frozen%' then raise; end if;
  end;

  if (select pg_catalog.count(*) from public.live_gift_transactions) <>
       (select gifts from f8_before_insufficient)
     or (select pg_catalog.count(*) from public.financial_transactions) <>
       (select financial from f8_before_insufficient)
     or (select pg_catalog.count(*) from public.ledger_entries) <>
       (select ledger from f8_before_insufficient)
     or (select pg_catalog.count(*) from public.live_battle_score_events) <>
       (select score from f8_before_insufficient)
     or (select balance from public.ledger_accounts
         where owner_id = pg_temp.f8_user(1) and account_type = 'user') <>
       (select sender_balance from f8_before_insufficient)
  then
    raise exception 'f8_insufficient_balance_moved_value';
  end if;
end;
$$;

do $$
begin
  if pg_catalog.has_function_privilege(
       'authenticated', 'private.live_gift_commission_split(bigint)', 'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'private.live_gift_commission_split(bigint)', 'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'private.live_gift_commission_split(bigint)', 'execute'
     )
     or pg_catalog.has_function_privilege(
       'public', 'private.live_gift_commission_split(bigint)', 'execute'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.send_live_gift(uuid,text,text)', 'execute'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.send_live_battle_gift(uuid,uuid,text,text)', 'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.send_live_gift(uuid,text,text)', 'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.send_live_battle_gift(uuid,uuid,text,text)', 'execute'
     )
  then
    raise exception 'f8_function_acl_invalid';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_proc as proc
       join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
       where namespace.nspname = 'private'
         and proc.proname = 'live_gift_commission_split'
         and not proc.prosecdef
         and proc.proconfig = array['search_path=""']
     )
     or exists (
       select 1 from pg_catalog.pg_proc as proc
       join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
       where namespace.nspname = 'public'
         and proc.proname in ('send_live_gift', 'send_live_battle_gift')
         and (not proc.prosecdef or proc.proconfig <> array['search_path=""'])
     )
  then
    raise exception 'f8_function_security_invalid';
  end if;
end;
$$;

do $$
begin
  if (select pg_catalog.count(*) from public.live_gift_transactions) <>
       (select gifts + 3 from f8_baseline)
     or (select pg_catalog.count(*) from public.financial_transactions) <>
       (select financial + 3 from f8_baseline)
     or (select pg_catalog.count(*) from public.ledger_entries) <>
       (select ledger + 8 from f8_baseline)
     or (select pg_catalog.count(*) from public.live_battle_score_events) <>
       (select score_events + 1 from f8_baseline)
  then
    raise exception 'f8_exact_operation_cardinality_invalid';
  end if;
end;
$$;

-- Every C1 case gets its own PL/pgSQL subtransaction, including successful
-- cases. This permits collecting every red failure without leaving fixtures.
create temp table c1_results (name text, passed boolean, detail text);
create function pg_temp.c1_economy() returns jsonb language sql as $$
select pg_catalog.jsonb_build_object(
  'gifts', (select pg_catalog.jsonb_agg(g order by g.id) from public.live_gift_transactions g),
  'financial', (select pg_catalog.jsonb_agg(f order by f.id) from public.financial_transactions f),
  'ledger', (select pg_catalog.jsonb_agg(e order by e.id) from public.ledger_entries e),
  'accounts', (select pg_catalog.jsonb_agg(a order by a.id) from public.ledger_accounts a),
  'score', (select pg_catalog.jsonb_agg(s order by s.battle_id) from public.live_battle_score_states s),
  'events', (select pg_catalog.jsonb_agg(e order by e.id) from public.live_battle_score_events e),
  'power', (select pg_catalog.jsonb_agg(p order by p.battle_id,p.side) from public.live_battle_power_states p),
  'boost', (select pg_catalog.jsonb_agg(b order by b.id) from public.live_battle_boost_events b),
  'idempotency', (select pg_catalog.jsonb_agg(i order by i.id) from public.idempotency_keys i)
);
$$;
create function pg_temp.c1_case(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception using errcode='ZX001', message='case_rollback';
  exception
    when sqlstate 'ZX001' then
      insert into c1_results values(p_name,true,'all assertions passed; case rolled back');
    when others then
      insert into c1_results values(p_name,false,sqlstate || ': ' || sqlerrm);
  end;
end;
$$;

select pg_temp.c1_case('cross_context', $case$
do $body$
declare b record; l record; retry record; before_retry jsonb; ids uuid[];
begin
  select * into strict b from public.send_live_battle_gift(
    pg_temp.f8_battle(),pg_temp.f8_user(2),'rose','f8-c1-cross');
  select * into strict l from public.send_live_gift(pg_temp.f8_session(2),'rose','f8-c1-cross');
  if l.transaction_id = b.transaction_id then
    raise exception 'LIVE returned Battle ID: expected 2 gifts/2 financial/6 entries, got 1/1/3';
  end if;
  select pg_catalog.array_agg(financial_transaction_id) into ids
    from public.live_gift_transactions where sender_user_id=pg_temp.f8_user(1) and idempotency_key='f8-c1-cross';
  if pg_catalog.cardinality(ids) <> 2 or ids[1]=ids[2]
    or (select count(*) from public.financial_transactions where id=any(ids))<>2
    or (select count(*) from public.ledger_entries where (metadata->>'fin_txn_id')::uuid=any(ids))<>6
    or exists(select 1 from public.ledger_entries where (metadata->>'fin_txn_id')::uuid=any(ids)
      group by metadata->>'fin_txn_id' having sum(case when entry_type='debit' then -amount else amount end)<>0)
    or not exists(select 1 from public.live_gift_transactions where id=l.transaction_id and battle_id is null)
  then raise exception 'c1_cross_context_journal_invalid'; end if;
  before_retry:=pg_temp.c1_economy();
  select * into strict retry from public.send_live_gift(pg_temp.f8_session(2),'rose','f8-c1-cross');
  if retry.transaction_id<>l.transaction_id then raise exception 'c1_live_retry_wrong_id'; end if;
  select * into strict retry from public.send_live_battle_gift(pg_temp.f8_battle(),pg_temp.f8_user(2),'rose','f8-c1-cross');
  if retry.transaction_id<>b.transaction_id or pg_temp.c1_economy()<>before_retry then raise exception 'c1_retry_moved_value'; end if;
end $body$;
$case$);

select pg_temp.c1_case('replay_closed_inactive', $case$
do $body$
declare r record; before_retry jsonb;
begin
  update public.live_sessions set status='ended', ended_at=clock_timestamp() where id=pg_temp.f8_session(2);
  update public.gift_catalog set active=false,enabled=false where id='rose';
  before_retry:=pg_temp.c1_economy();
  select * into strict r from public.send_live_gift(pg_temp.f8_session(2),'rose','f8-live-rose');
  if r.transaction_id<>(select transaction_id from f8_live_result)
    or r.new_sender_balance<>(select balance from public.ledger_accounts where owner_id=pg_temp.f8_user(1) and account_type='user' and currency='BDAG')
    or pg_temp.c1_economy()<>before_retry then raise exception 'c1_closed_replay_moved_value'; end if;
end $body$;
$case$);

select pg_temp.c1_case('conflicts_and_key_format', $case$
do $body$
declare before_request jsonb; v_session uuid; v_gift text; k text;
begin
  before_request:=pg_temp.c1_economy();
  for v_session,v_gift in select * from (values(pg_temp.f8_session(3),'rose'),(pg_temp.f8_session(2),'heart')) t(s,g) loop
    begin
      perform public.send_live_gift(v_session,v_gift,'f8-live-rose');
      raise exception 'c1_conflict_allowed';
    exception when sqlstate '22023' then
      if sqlerrm<>'live_gift_idempotency_conflict' then raise; end if;
    end;
  end loop;
  foreach k in array array[null::text,'','   ',repeat('k',201)] loop
    begin
      perform public.send_live_gift(pg_temp.f8_session(2),'rose',k);
      raise exception 'c1_invalid_key_allowed';
    exception when sqlstate '22023' then null;
    end;
  end loop;
  if pg_temp.c1_economy()<>before_request then raise exception 'c1_conflict_moved_value'; end if;
  perform public.send_live_gift(pg_temp.f8_session(2),'rose',repeat('k',200));
end $body$;
$case$);

-- Absence, a user-owned platform account, and a wrong-currency platform
-- account must all reject in BOTH RPCs. Fixture mutations also roll back.
select pg_temp.c1_case('platform_' || mode || '_' || context, pg_catalog.format($case$
do $body$
declare before_request jsonb; r record; returned_fee numeric; actual_credits bigint;
begin
  update public.ledger_accounts set account_type='escrow'
    where owner_id is null and account_type='platform';
  if %1$L='owned' then
    insert into public.ledger_accounts(owner_id,account_type,balance,currency) values(pg_temp.f8_user(3),'platform',0,'BDAG');
  elsif %1$L='currency' then
    insert into public.ledger_accounts(owner_id,account_type,balance,currency) values(null,'platform',0,'USD');
  end if;
  before_request:=pg_temp.c1_economy();
  begin
    if %2$L='live' then
      select * into strict r from public.send_live_gift(pg_temp.f8_session(2),'rose','f8-c1-platform');
    else
      select * into strict r from public.send_live_battle_gift(pg_temp.f8_battle(),pg_temp.f8_user(2),'rose','f8-c1-platform');
    end if;
  exception when sqlstate '55000' then
    if sqlerrm<>'live_gift_journal_invalid' then raise; end if;
    if pg_temp.c1_economy()<>before_request then raise exception 'c1_fail_closed_partial_state'; end if;
    return;
  end;
  select (i.response_body->>'fee_collected')::numeric into returned_fee from public.idempotency_keys i
    where user_id=pg_temp.f8_user(1) and idempotency_key like '%%f8-c1-platform';
  select count(*) into actual_credits from public.ledger_entries e join public.ledger_accounts a on a.id=e.account_id
    where e.metadata->>'fin_txn_id'=(select financial_transaction_id::text from public.live_gift_transactions where id=r.transaction_id)
      and a.owner_id is null and a.account_type='platform' and a.currency='BDAG' and e.entry_type='credit' and e.amount=2;
  raise exception 'fee_collected=%% canonical_platform_credits=%%; request incorrectly succeeded',returned_fee,actual_credits;
end $body$;
$case$,mode,context))
from (values('absent'),('owned'),('currency')) m(mode)
cross join (values('live'),('battle')) c(context);

select pg_temp.c1_case('battle_x2_gross_score', $case$
do $body$
declare r record; before_sender numeric; before_creator numeric; before_platform numeric; before_score bigint; before_roses integer; f uuid;
begin
  insert into public.live_battle_boost_events(battle_id,side,kind,multiplier,starts_at,expires_at,
    source_score_event_id,rule_set_id,rule_version)
  select pg_temp.f8_battle(),'challenger','rose_x2',2,t.now_at,t.now_at+interval '30 seconds',
    e.id,b.battle_rule_set_id,2
  from public.live_battle_score_events e join public.live_battles b on b.id=e.battle_id
  cross join (select clock_timestamp() now_at) t
  where e.gift_transaction_id=(select transaction_id from f8_battle_result);
  select balance into strict before_sender from public.ledger_accounts where owner_id=pg_temp.f8_user(1) and account_type='user' and currency='BDAG';
  select balance into strict before_creator from public.ledger_accounts where owner_id=pg_temp.f8_user(2) and account_type='user' and currency='BDAG';
  select balance into strict before_platform from public.ledger_accounts where owner_id is null and account_type='platform' and currency='BDAG';
  select challenger_score into strict before_score from public.live_battle_score_states where battle_id=pg_temp.f8_battle();
  select rose_progress_units into strict before_roses from public.live_battle_power_states where battle_id=pg_temp.f8_battle() and side='challenger';
  select * into strict r from public.send_live_battle_gift(pg_temp.f8_battle(),pg_temp.f8_user(2),'rose','f8-c1-x2');
  select financial_transaction_id into strict f from public.live_gift_transactions where id=r.transaction_id;
  if (select balance from public.ledger_accounts where owner_id=pg_temp.f8_user(1) and account_type='user')<>before_sender-5
    or (select balance from public.ledger_accounts where owner_id=pg_temp.f8_user(2) and account_type='user')<>before_creator+3
    or (select balance from public.ledger_accounts where owner_id is null and account_type='platform')<>before_platform+2
    or (select challenger_score from public.live_battle_score_states where battle_id=pg_temp.f8_battle())<>before_score+10
    or (select rose_progress_units from public.live_battle_power_states where battle_id=pg_temp.f8_battle() and side='challenger')<>before_roses+1
    or not exists(select 1 from public.live_battle_score_events where gift_transaction_id=r.transaction_id and base_points=5 and multiplier=2 and awarded_points=10)
    or (select count(*) from public.ledger_entries where metadata->>'fin_txn_id'=f::text)<>3
    or (select sum(case when entry_type='debit' then -amount else amount end) from public.ledger_entries where metadata->>'fin_txn_id'=f::text)<>0
  then raise exception 'c1_x2_economy_score_roses_invalid'; end if;
end $body$;
$case$);

select pg_temp.c1_case('private_verifier_acl', $case$
do $body$
declare role_name text; signature text:='private.verify_live_gift_journal(uuid,uuid,uuid,bigint,bigint,bigint,text,text,uuid)';
begin
  foreach role_name in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,signature,'execute') then raise exception 'c1_private_acl_invalid'; end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_proc where oid=signature::regprocedure
    and proowner='postgres'::regrole and not prosecdef and proconfig=array['search_path=""']) then
    raise exception 'c1_private_owner_search_path_invalid';
  end if;
end $body$;
$case$);

select name,passed,detail from c1_results order by name;
do $$ begin
  if exists(select 1 from c1_results where not passed) then raise exception 'c1_postconditions_failed'; end if;
end $$;

rollback;
