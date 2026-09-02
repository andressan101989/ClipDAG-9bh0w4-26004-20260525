begin;

create temp table f6_financial_baseline as
select
  (select pg_catalog.count(*) from public.live_gift_transactions) as gifts,
  (select pg_catalog.count(*) from public.financial_transactions) as financial,
  (select pg_catalog.count(*) from public.ledger_entries) as ledger,
  (select coalesce(pg_catalog.sum(balance), 0) from public.ledger_accounts) as balances;

create temp table f6_historical_expected (
  id text primary key,
  emoji text not null,
  label text not null,
  cost_coins integer not null,
  active boolean not null,
  enabled boolean not null,
  category text not null,
  animation_type text not null,
  duration_ms integer not null,
  priority integer not null,
  sort_order integer not null,
  display_order integer not null
);
insert into f6_historical_expected values
  ('heart', '❤️', 'Corazón', 1, true, true, 'basic', 'floating', 1800, 1, 1, 1),
  ('rose', '🌹', 'Rosa', 5, true, true, 'basic', 'floating', 1900, 2, 2, 2),
  ('fire', '🔥', 'Fuego', 10, true, true, 'basic', 'floating', 2000, 3, 3, 3),
  ('crown', '👑', 'Corona', 50, true, true, 'basic', 'center', 2400, 8, 4, 4),
  ('diamond', '💎', 'Diamante', 100, true, true, 'basic', 'center', 2600, 10, 5, 5),
  ('lion', '🦁', 'Leon', 250, true, true, 'premium', 'center', 3000, 20, 20, 20),
  ('rocket', '🚀', 'Cohete', 300, true, true, 'premium', 'entrance', 3200, 25, 25, 25),
  ('private_jet', '✈️', 'Jet Privado', 450, true, true, 'premium', 'entrance', 3600, 32, 30, 30),
  ('sports_car', '🏎️', 'Auto deportivo', 450, false, false, 'premium', 'entrance', 3400, 30, 30, 30),
  ('phoenix', '🔥', 'Fenix', 600, true, true, 'legendary', 'celebration', 4000, 45, 45, 45),
  ('dragon', '🐉', 'Dragon', 750, true, true, 'legendary', 'fullscreen', 4500, 50, 50, 50),
  ('castle', '🏰', 'Castillo', 900, true, true, 'legendary', 'center', 4600, 55, 55, 55),
  ('galaxy', '🌌', 'Galaxia', 1200, true, true, 'legendary', 'fullscreen', 5200, 60, 60, 60);

do $$
begin
  if (select pg_catalog.count(*) from public.gift_catalog) <> 101
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled) <> 100
     or (select pg_catalog.count(*) from public.gift_catalog where not active or not enabled) <> 1
     or (select pg_catalog.count(*) from public.gift_catalog
         where display_order between 101 and 188 and active and enabled) <> 88
  then raise exception 'f6_catalog_cardinality_invalid'; end if;

  if not exists (
    select 1 from public.gift_catalog
    where id = 'sports_car' and active = false and enabled = false
  ) or exists (
    select 1 from public.gift_catalog
    where (not active or not enabled) and id <> 'sports_car'
  ) or not exists (
    select 1 from public.gift_catalog
    where id = 'private_jet' and active and enabled
  ) then raise exception 'f6_historical_activation_invalid'; end if;

  if exists (
    select 1
    from f6_historical_expected as expected
    full join public.gift_catalog as actual using (id)
    where expected.id is not null and (
      actual.id is null
      or actual.emoji is distinct from expected.emoji
      or actual.icon is distinct from expected.emoji
      or actual.label is distinct from expected.label
      or actual.cost_coins is distinct from expected.cost_coins
      or actual.active is distinct from expected.active
      or actual.enabled is distinct from expected.enabled
      or actual.category is distinct from expected.category
      or actual.animation_type is distinct from expected.animation_type
      or actual.animation_asset is not null
      or actual.duration_ms is distinct from expected.duration_ms
      or actual.priority is distinct from expected.priority
      or actual.sort_order is distinct from expected.sort_order
      or actual.display_order is distinct from expected.display_order
    )
  ) then raise exception 'f6_historical_values_changed'; end if;

  if (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 1 and 20) <> 22
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 21 and 99) <> 22
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 100 and 499) <> 22
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 500 and 1999) <> 17
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 2000 and 9999) <> 11
     or (select pg_catalog.count(*) from public.gift_catalog where active and enabled and cost_coins between 10000 and 34999) <> 6
  then raise exception 'f6_price_distribution_invalid'; end if;

  if (select cost_coins from public.gift_catalog where id = 'rose') <> 5
     or exists (select 1 from public.gift_catalog where cost_coins <= 0 or cost_coins > 34999)
     or exists (select 1 from public.gift_catalog where display_order between 101 and 188 and (
       id !~ '^[a-z][a-z0-9_]*$' or label = '' or emoji = '' or icon = ''
       or category not in ('basic', 'premium', 'legendary')
       or animation_type not in ('floating', 'center', 'fullscreen', 'entrance', 'celebration')
       or animation_asset is not null or duration_ms not between 500 and 15000
       or not active or not enabled
     ))
  then raise exception 'f6_catalog_contract_invalid'; end if;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.gift_catalog'::regclass)
     or not pg_catalog.has_table_privilege('authenticated', 'public.gift_catalog', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.gift_catalog', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.gift_catalog', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.gift_catalog', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.gift_catalog', 'delete')
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'gift_catalog'
         and policyname = 'gift_catalog_read_active' and cmd = 'SELECT'
         and roles = array['authenticated']::name[]
     )
  then raise exception 'f6_catalog_security_invalid'; end if;
end;
$$;

create function pg_temp.f6_user(p_id integer)
returns uuid language sql immutable
as $$ select ('f6a10000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.f6_session(p_id integer)
returns uuid language sql immutable
as $$ select ('f6a20000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.f6_series()
returns uuid language sql immutable
as $$ select 'f6a30000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.f6_battle()
returns uuid language sql immutable
as $$ select 'f6a40000-0000-4000-8000-000000000001'::uuid $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.f6_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f6a-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 3) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.f6_user(n), 'lb4f6a_' || n, 'LB4-F6-A ' || n, false
from pg_catalog.generate_series(1, 3) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.f6_session(n), pg_temp.f6_user(n), 'LB4-F6-A session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(2, 3) as n;

insert into public.ledger_accounts (owner_id, account_type, balance, currency)
values
  (pg_temp.f6_user(1), 'user', 40000, 'BDAG'),
  (pg_temp.f6_user(2), 'user', 0, 'BDAG'),
  (pg_temp.f6_user(3), 'user', 0, 'BDAG');

-- The disposable schema is data-free; production already has this canonical
-- system account. Its fixture row lets the proof verify the exact fee credit.
insert into public.ledger_accounts (
  id, owner_id, account_type, balance, currency
) values (
  'f6a50000-0000-4000-8000-000000000001'::uuid,
  null, 'platform', 0, 'BDAG'
);

insert into public.live_battle_series (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  format, max_rounds, wins_required, status
) values (
  pg_temp.f6_series(), pg_temp.f6_user(2), pg_temp.f6_user(3),
  pg_temp.f6_session(2), pg_temp.f6_session(3),
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
  pg_temp.f6_battle(), pg_temp.f6_user(2), pg_temp.f6_user(3),
  pg_temp.f6_session(2), pg_temp.f6_session(3),
  'active', timing.now_at - interval '50 seconds',
  timing.now_at - interval '40 seconds', timing.now_at - interval '35 seconds',
  timing.now_at - interval '32 seconds', timing.now_at - interval '32 seconds',
  timing.now_at + interval '4 minutes 28 seconds', null,
  null, 'countdown_elapsed', 4, timing.now_at - interval '1 minute',
  timing.now_at, pg_temp.f6_series(), 1, rules.id
from timing
join public.live_battle_rule_sets as rules on rules.rule_version = 2;

create temp table f6_account_baseline as
select id, owner_id, account_type, balance
from public.ledger_accounts;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f6_user(1)::text, true);

do $$
declare
  v_gifts bigint := (select pg_catalog.count(*) from public.live_gift_transactions);
  v_financial bigint := (select pg_catalog.count(*) from public.financial_transactions);
  v_ledger bigint := (select pg_catalog.count(*) from public.ledger_entries);
begin
  begin
    perform public.send_live_battle_gift(
      pg_temp.f6_battle(), pg_temp.f6_user(2), 'sports_car', 'f6-inactive'
    );
    raise exception 'f6_inactive_gift_allowed';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'live_battle_gift_unavailable' then raise; end if;
  end;
  if (select pg_catalog.count(*) from public.live_gift_transactions) <> v_gifts
     or (select pg_catalog.count(*) from public.financial_transactions) <> v_financial
     or (select pg_catalog.count(*) from public.ledger_entries) <> v_ledger
  then raise exception 'f6_inactive_gift_moved_value'; end if;
end;
$$;

create temp table f6_low as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'brillo_suave', 'f6-low'
);
create temp table f6_mid as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'festival_del_sol', 'f6-mid'
);
create temp table f6_high as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'legado_de_las_estrellas', 'f6-high'
);
create temp table f6_high_retry as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'legado_de_las_estrellas', 'f6-high'
);

do $$
begin
  if (select transaction_id from f6_high) is distinct from
       (select transaction_id from f6_high_retry)
     or (select pg_catalog.count(*) from public.live_gift_transactions
         where battle_id = pg_temp.f6_battle() and idempotency_key = 'f6-high') <> 1
  then raise exception 'f6_idempotency_failed'; end if;
end;
$$;

do $$
declare n integer;
begin
  for n in 1..10 loop
    perform public.send_live_battle_gift(
      pg_temp.f6_battle(), pg_temp.f6_user(2), 'rose', 'f6-rose-' || n
    );
  end loop;
end;
$$;

create temp table f6_x2 as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'ballena_celeste', 'f6-x2'
);

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f6_user(2)::text, true);
create temp table f6_glove as
select * from public.activate_live_battle_glove(pg_temp.f6_battle(), 'f6-glove');

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f6_user(1)::text, true);
create temp table f6_x3 as
select * from public.send_live_battle_gift(
  pg_temp.f6_battle(), pg_temp.f6_user(2), 'templo_del_viento', 'f6-x3'
);

create temp table f6_before_insufficient as
select
  (select pg_catalog.count(*) from public.live_gift_transactions) gifts,
  (select pg_catalog.count(*) from public.financial_transactions) financial,
  (select pg_catalog.count(*) from public.ledger_entries) ledger,
  (select pg_catalog.count(*) from public.live_battle_score_events) score,
  (select balance from public.ledger_accounts
   where owner_id = pg_temp.f6_user(1) and account_type = 'user') sender_balance;

do $$
begin
  begin
    perform public.send_live_battle_gift(
      pg_temp.f6_battle(), pg_temp.f6_user(2),
      'corona_de_auroras', 'f6-insufficient'
    );
    raise exception 'f6_insufficient_balance_allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'insufficient balance or account frozen%' then raise; end if;
  end;

  if (select pg_catalog.count(*) from public.live_gift_transactions) <>
       (select gifts from f6_before_insufficient)
     or (select pg_catalog.count(*) from public.financial_transactions) <>
       (select financial from f6_before_insufficient)
     or (select pg_catalog.count(*) from public.ledger_entries) <>
       (select ledger from f6_before_insufficient)
     or (select pg_catalog.count(*) from public.live_battle_score_events) <>
       (select score from f6_before_insufficient)
     or (select balance from public.ledger_accounts
         where owner_id = pg_temp.f6_user(1) and account_type = 'user') <>
       (select sender_balance from f6_before_insufficient)
  then raise exception 'f6_insufficient_balance_moved_value'; end if;
end;
$$;

do $$
begin
  if (select pg_catalog.count(*) from public.live_gift_transactions
      where battle_id = pg_temp.f6_battle()) <> 15
     or (select pg_catalog.count(*) from public.live_battle_score_events
         where battle_id = pg_temp.f6_battle()) <> 15
     or (select pg_catalog.count(distinct financial_transaction_id)
         from public.live_gift_transactions where battle_id = pg_temp.f6_battle()) <> 15
     or (select pg_catalog.count(*)
         from public.financial_transactions as financial
         join public.live_gift_transactions as gift
           on gift.financial_transaction_id = financial.id
         where gift.battle_id = pg_temp.f6_battle()) <> 15
  then raise exception 'f6_one_to_one_financial_contract_invalid'; end if;

  if exists (
    select 1
    from public.live_gift_transactions as gift
    join public.gift_catalog as catalog on catalog.id = gift.gift_id
    join public.financial_transactions as financial
      on financial.id = gift.financial_transaction_id
    where gift.battle_id = pg_temp.f6_battle()
      and (gift.amount_coins <> catalog.cost_coins
        or gift.platform_fee_coins <> pg_catalog.floor(catalog.cost_coins::numeric * 0.10)
        or gift.creator_amount_coins <> gift.amount_coins - gift.platform_fee_coins
        or financial.amount <> gift.amount_coins
        or financial.fee_amount <> gift.platform_fee_coins
        or financial.operation_type <> 'live_gift'
        or financial.reference_type <> 'live_battle'
        or financial.reference_id <> pg_temp.f6_battle()::text)
  ) then raise exception 'f6_server_price_or_distribution_invalid'; end if;

  if not exists (
    select 1 from public.live_battle_score_events as score
    join public.live_gift_transactions as gift on gift.id = score.gift_transaction_id
    where gift.id = (select transaction_id from f6_high)
      and gift.amount_coins = 34999 and score.base_points = 34999
      and score.multiplier = 1 and score.awarded_points = 34999
  ) or not exists (
    select 1 from public.live_battle_score_events as score
    join public.live_gift_transactions as gift on gift.id = score.gift_transaction_id
    where gift.id = (select transaction_id from f6_x2)
      and gift.amount_coins = 500 and score.base_points = 500
      and score.multiplier = 2 and score.awarded_points = 1000
      and gift.creator_amount_coins = 450 and gift.platform_fee_coins = 50
  ) or not exists (
    select 1 from public.live_battle_score_events as score
    join public.live_gift_transactions as gift on gift.id = score.gift_transaction_id
    where gift.id = (select transaction_id from f6_x3)
      and gift.amount_coins = 1050 and score.base_points = 1050
      and score.multiplier = 3 and score.awarded_points = 3150
      and gift.creator_amount_coins = 945 and gift.platform_fee_coins = 105
  ) or exists (
    select 1 from public.live_battle_score_events
    where battle_id = pg_temp.f6_battle() and multiplier not in (1, 2, 3)
  ) then raise exception 'f6_battle_multiplier_leaked_to_economy'; end if;

  if not exists (
    select 1 from public.live_battle_score_events as score
    join public.live_gift_transactions as gift on gift.id = score.gift_transaction_id
    where gift.idempotency_key = 'f6-rose-10' and score.multiplier = 1
  ) or (select rose_progress_units from public.live_battle_power_states
        where battle_id = pg_temp.f6_battle() and side = 'challenger') <> 10
     or (select pg_catalog.count(*) from public.live_gift_transactions
         where battle_id = pg_temp.f6_battle() and gift_id = 'rose') <> 10
     or (select pg_catalog.count(*) from public.live_battle_boost_events
         where battle_id = pg_temp.f6_battle() and kind = 'rose_x2') <> 1
     or (select pg_catalog.count(*) from public.live_battle_boost_events
         where battle_id = pg_temp.f6_battle() and kind = 'glove_x3') <> 1
  then raise exception 'f6_rose_or_boost_contract_invalid'; end if;
end;
$$;

do $$
declare
  v_bad record;
begin
  with linked as (
    select gift.id, gift.amount_coins, gift.financial_transaction_id
    from public.live_gift_transactions as gift
    where gift.battle_id = pg_temp.f6_battle()
  ), totals as (
    select linked.id,
      coalesce(pg_catalog.sum(entry.amount) filter (where entry.entry_type = 'debit'), 0) debit,
      coalesce(pg_catalog.sum(entry.amount) filter (where entry.entry_type = 'credit'), 0) credit,
      linked.amount_coins
    from linked
    left join public.ledger_entries as entry
      on entry.metadata ->> 'fin_txn_id' = linked.financial_transaction_id::text
    group by linked.id, linked.amount_coins
  )
  select * into v_bad from totals
  where debit <> amount_coins or credit <> amount_coins or debit <> credit
  limit 1;
  if found then
    raise exception 'f6_ledger_not_balanced id=% debit=% credit=% amount=%',
      v_bad.id, v_bad.debit, v_bad.credit, v_bad.amount_coins;
  end if;

  if exists (
    select 1
    from public.ledger_accounts as account
    join f6_account_baseline as baseline using (id)
    left join lateral (
      select coalesce(pg_catalog.sum(case
        when entry.entry_type = 'credit' then entry.amount else -entry.amount end), 0) delta
      from public.ledger_entries as entry
      where entry.account_id = account.id
        and entry.metadata ->> 'fin_txn_id' in (
          select gift.financial_transaction_id::text
          from public.live_gift_transactions as gift
          where gift.battle_id = pg_temp.f6_battle()
        )
    ) movement on true
    where account.balance <> baseline.balance + movement.delta
  ) then raise exception 'f6_account_balance_delta_invalid'; end if;
end;
$$;

rollback;
