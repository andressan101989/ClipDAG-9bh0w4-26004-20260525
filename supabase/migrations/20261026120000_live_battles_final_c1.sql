begin;

-- LIVE Battles Final C1: forward-only lifecycle and gift integrity repair.
-- Preserve A6 transitions, canonical ledger/score authorities, and SKIP LOCKED rebuild.

-- Serialize participant admission without blocking the KEY SHARE lock taken
-- by a winner/receipt FK after Battle has been locked. Deletion and changes to
-- user identity still conflict with NO KEY UPDATE; the canonical UUID order stays.
create or replace function private.live_battle_lock_users(
  p_first_user_id uuid,
  p_second_user_id uuid
)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_first_user_id is null or p_second_user_id is null or p_first_user_id = p_second_user_id then
    raise exception using errcode = '22023', message = 'live_battle_users_invalid';
  end if;
  perform u.id from auth.users as u
  where u.id in (p_first_user_id, p_second_user_id)
  order by u.id
  for no key update;
  select pg_catalog.count(*)::integer into v_count
  from auth.users as u where u.id in (p_first_user_id, p_second_user_id);
  if v_count <> 2 then
    raise exception using errcode = 'P0002', message = 'live_battle_user_not_found';
  end if;
end;
$$;

create or replace function private.sync_live_battle_public_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status in ('rejected', 'expired')
     and old.status is distinct from new.status then
    perform private.rebuild_live_battle_series_locked(
      new.series_id, pg_catalog.clock_timestamp()
    );
  end if;
  if tg_op <> 'DELETE' then
    perform private.sync_live_battle_series_projection_locked(
      new.series_id,
      pg_catalog.clock_timestamp()
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
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
  v_now := pg_catalog.clock_timestamp();
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
    v_now := pg_catalog.clock_timestamp();
    v_existing := private.live_battle_reconcile_locked(v_existing.id, v_now);
  end if;
  if v_existing.status = 'pending' and v_existing.ended_at is null then
    if v_existing.challenger_user_id = v_actor and
       v_existing.opponent_user_id = p_opponent_user_id and
       v_existing.challenger_session_id = p_challenger_session_id and
       v_existing.opponent_session_id = p_opponent_session_id then
      return private.live_battle_to_json(v_existing);
    end if;
    raise exception using errcode = 'PT409', message = 'live_battle_pair_busy';
  elsif v_existing.status in ('accepted', 'countdown', 'active') then
    raise exception using errcode = 'PT409', message = 'live_battle_pair_busy';
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
    v_now := pg_catalog.clock_timestamp();
    v_series := private.reconcile_live_battle_series_locked(v_series.id, v_now);
  end if;

  if v_series.status in ('active', 'awaiting_rematch', 'rematch_pending') then
    raise exception using errcode = 'PT409', message = 'live_battle_series_pair_busy';
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
    where (series.status in ('awaiting_rematch', 'rematch_pending')
      and series.rematch_window_expires_at <= v_now)
      or (series.status = 'active'
        and exists (
          select 1 from public.live_battles as battle
          where battle.series_id = series.id
            and battle.status in ('completed', 'cancelled', 'rejected', 'expired')
        )
        and not exists (
          select 1 from public.live_battles as battle
          where battle.series_id = series.id
            and battle.status in ('pending', 'accepted', 'countdown', 'active')
        ))
    order by coalesce(series.rematch_window_expires_at, series.updated_at), series.id
    for update skip locked
    limit p_limit
  loop
    perform private.reconcile_live_battle_series_locked(v_candidate.id, v_now);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.send_live_gift(
  p_session_id uuid,
  p_gift_id text,
  p_idempotency_key text
)
returns table (
  transaction_id uuid,
  gift_id text,
  emoji text,
  amount_coins integer,
  creator_amount_coins integer,
  new_sender_balance numeric,
  receiver_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
  v_receiver uuid;
  v_route_receiver uuid;
  v_status text;
  v_ended_at timestamptz;
  v_gift_id text;
  v_gift_emoji text;
  v_gift_cost integer;
  v_fee integer;
  v_creator_amount integer;
  v_tx_id uuid;
  v_fin_txn_id uuid;
  v_sender_balance numeric;
  v_transfer_result jsonb;
  v_existing_id uuid;
  v_existing_gift_id text;
  v_existing_emoji text;
  v_existing_amount integer;
  v_existing_creator_amount integer;
  v_existing_receiver uuid;
  v_existing_session uuid;
begin
  v_sender := (select auth.uid());
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0
     or pg_catalog.length(p_idempotency_key) > 200 then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  -- Serialize only retries that share the sender/key.  The ledger core also
  -- scopes idempotency this way, so a concurrent retry cannot race past the
  -- canonical gift row after the financial journal commits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live_gift:' || v_sender::text || ':' || p_idempotency_key,
      0
    )
  );

  select gift.id, gift.gift_id, gift.emoji, gift.amount_coins,
         gift.creator_amount_coins, gift.receiver_user_id, gift.session_id
    into v_existing_id, v_existing_gift_id, v_existing_emoji,
         v_existing_amount, v_existing_creator_amount, v_existing_receiver,
         v_existing_session
  from public.live_gift_transactions as gift
  where gift.sender_user_id = v_sender
    and gift.idempotency_key = p_idempotency_key
    and gift.battle_id is null
  order by gift.created_at desc, gift.id desc
  limit 1;

  if found then
    if v_existing_session is distinct from p_session_id
       or v_existing_gift_id is distinct from p_gift_id then
      raise exception using
        errcode = '22023', message = 'live_gift_idempotency_conflict';
    end if;
    select account.balance into v_sender_balance
    from public.ledger_accounts as account
    where account.owner_id = v_sender and account.account_type = 'user'
      and account.currency = 'BDAG';

    return query select
      v_existing_id, v_existing_gift_id, v_existing_emoji,
      v_existing_amount, v_existing_creator_amount,
      coalesce(v_sender_balance, 0), v_existing_receiver;
    return;
  end if;

  -- Receipt FKs also lock users. Take those locks before the session so a
  -- simultaneous invite cannot hold a user while waiting for our session.
  select session.host_id into v_route_receiver
  from public.live_sessions as session where session.id = p_session_id;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if v_route_receiver = v_sender then
    raise exception 'self-gift not allowed' using errcode = '22023';
  end if;
  perform private.live_battle_lock_users(v_sender, v_route_receiver);

  select session.status, session.host_id, session.ended_at
    into v_status, v_receiver, v_ended_at
  from public.live_sessions as session
  where session.id = p_session_id
  for share;

  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if v_receiver is distinct from v_route_receiver then
    raise exception using errcode = '55000', message = 'live_gift_route_changed';
  end if;
  if v_status is distinct from 'live' or v_ended_at is not null then
    raise exception 'live session is not active' using errcode = 'P0001';
  end if;
  if v_receiver = v_sender then
    raise exception 'self-gift not allowed' using errcode = '22023';
  end if;

  select catalog.id, catalog.emoji, catalog.cost_coins
    into v_gift_id, v_gift_emoji, v_gift_cost
  from public.gift_catalog as catalog
  where catalog.id = p_gift_id and catalog.active = true and catalog.enabled = true;

  if not found then
    raise exception 'gift not found or inactive' using errcode = 'P0002';
  end if;

  select split.platform_fee_amount::integer,
         split.creator_net_amount::integer
    into strict v_fee, v_creator_amount
  from private.live_gift_commission_split(v_gift_cost::bigint) as split;

  v_transfer_result := public.atomic_ledger_transfer(
    v_sender, v_receiver, v_gift_cost, v_fee,
    'live_gift', p_idempotency_key,
    'live_session', p_session_id,
    'Live gift: ' || v_gift_id ||
      ' [live_gift_commission_v1_3500bps_half_up]'
  );

  v_sender_balance := (v_transfer_result ->> 'from_balance')::numeric;
  v_fin_txn_id := nullif(
    v_transfer_result ->> 'fin_txn_id', ''
  )::uuid;
  if v_fin_txn_id is null
     or (v_transfer_result ->> 'fee_collected')::numeric
        is distinct from v_fee::numeric then
    raise exception using
      errcode = '55000', message = 'live_gift_financial_result_invalid';
  end if;

  perform private.verify_live_gift_journal(
    v_fin_txn_id, v_sender, v_receiver, v_gift_cost::bigint,
    v_fee::bigint, v_creator_amount::bigint,
    p_idempotency_key, 'live_session', p_session_id
  );

  insert into public.live_gift_transactions (
    session_id, sender_user_id, receiver_user_id, gift_id, emoji,
    amount_coins, platform_fee_coins, creator_amount_coins, idempotency_key,
    financial_transaction_id
  ) values (
    p_session_id, v_sender, v_receiver, v_gift_id, v_gift_emoji,
    v_gift_cost, v_fee, v_creator_amount, p_idempotency_key, v_fin_txn_id
  )
  returning id into v_tx_id;

  return query select
    v_tx_id, v_gift_id, v_gift_emoji, v_gift_cost,
    v_creator_amount, v_sender_balance, v_receiver;
end;
$$;

create or replace function public.send_live_battle_gift(
  p_battle_id uuid,
  p_target_user_id uuid,
  p_gift_id text,
  p_idempotency_key text
)
returns table (
  transaction_id uuid,
  battle_id uuid,
  target_session_id uuid,
  gift_id text,
  emoji text,
  amount_coins integer,
  creator_amount_coins integer,
  new_sender_balance numeric,
  receiver_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := (select auth.uid());
  v_battle public.live_battles%rowtype;
  v_route public.live_battles%rowtype;
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

  -- Route identity is immutable. Lock participants and sessions before Battle,
  -- matching lifecycle admission; replay still precedes mutable eligibility.
  select battle.* into v_route
  from public.live_battles as battle where battle.id = p_battle_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  -- Include the sender: the retained receipt's sender FK also takes a user
  -- lock. Locking only hosts can deadlock against normal LIVE gift admission.
  perform participant.id from auth.users as participant
  where participant.id in (v_sender, v_route.challenger_user_id, v_route.opponent_user_id)
  order by participant.id
  for no key update;
  perform private.live_battle_lock_users(
    v_route.challenger_user_id, v_route.opponent_user_id
  );
  perform private.live_battle_lock_sessions(
    v_route.challenger_session_id, v_route.opponent_session_id
  );

  select battle.* into v_battle
  from public.live_battles as battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if row(v_battle.challenger_user_id, v_battle.opponent_user_id,
         v_battle.challenger_session_id, v_battle.opponent_session_id)
     is distinct from
     row(v_route.challenger_user_id, v_route.opponent_user_id,
         v_route.challenger_session_id, v_route.opponent_session_id) then
    raise exception using errcode = '55000', message = 'live_battle_gift_route_changed';
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
    where account.owner_id = v_sender and account.account_type = 'user'
      and account.currency = 'BDAG';
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

  select split.platform_fee_amount::integer,
         split.creator_net_amount::integer
    into strict v_fee, v_creator_amount
  from private.live_gift_commission_split(v_gift.cost_coins::bigint) as split;
  v_ledger_idempotency_key :=
    pg_catalog.format('live_battle:%s:%s', p_battle_id, p_idempotency_key);
  v_transfer_result := public.atomic_ledger_transfer(
    v_sender, p_target_user_id, v_gift.cost_coins, v_fee,
    'live_gift', v_ledger_idempotency_key, 'live_battle', p_battle_id,
    'Directed LIVE Battle gift: ' || v_gift.id ||
      ' [live_gift_commission_v1_3500bps_half_up]'
  );
  v_sender_balance := (v_transfer_result ->> 'from_balance')::numeric;
  v_financial_transaction_id :=
    nullif(v_transfer_result ->> 'fin_txn_id', '')::uuid;
  if v_financial_transaction_id is null
     or (v_transfer_result ->> 'fee_collected')::numeric
        is distinct from v_fee::numeric then
    raise exception using
      errcode = '55000', message = 'live_battle_gift_financial_result_invalid';
  end if;

  perform private.verify_live_gift_journal(
    v_financial_transaction_id, v_sender, p_target_user_id, v_gift.cost_coins::bigint,
    v_fee::bigint, v_creator_amount::bigint,
    v_ledger_idempotency_key, 'live_battle', p_battle_id
  );

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

-- Confirmed gifts are final economic facts. Session/Battle termination never
-- refunds them; future reversals require a separately authorized compensating
-- ledger contract. This migration adds no reversal authority.
create or replace function private.prevent_confirmed_live_gift_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.financial_transaction_id is not null then
    raise exception using errcode = '55000', message = 'live_gift_confirmed_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger live_gift_transactions_confirmed_immutable
before update or delete on public.live_gift_transactions
for each row execute function private.prevent_confirmed_live_gift_mutation();

alter table public.live_gift_transactions
  drop constraint live_gift_transactions_session_id_fkey,
  drop constraint live_gift_transactions_sender_user_id_fkey,
  drop constraint live_gift_transactions_receiver_user_id_fkey,
  add constraint live_gift_transactions_session_id_fkey
    foreign key (session_id) references public.live_sessions(id) on delete restrict,
  add constraint live_gift_transactions_sender_user_id_fkey
    foreign key (sender_user_id) references auth.users(id) on delete restrict,
  add constraint live_gift_transactions_receiver_user_id_fkey
    foreign key (receiver_user_id) references auth.users(id) on delete restrict;

comment on table public.live_gift_transactions is
  'Retained LIVE gift receipts. Confirmed gifts are immutable final economic facts; LIVE/Battle closure never refunds them. No refund authority is granted.';

-- Both projections use canonical challenger/opponent identity regardless of
-- which participant is the local host. Battle route identity is already immutable.
create or replace function private.validate_live_battle_winner_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_expected uuid;
begin
  select case new.outcome
    when 'challenger' then battle.challenger_user_id
    when 'opponent' then battle.opponent_user_id
    else null end
  into v_expected
  from public.live_battles as battle where battle.id = new.battle_id;
  if not found or new.winner_user_id is distinct from v_expected then
    raise exception using errcode = '23514', message = 'live_battle_winner_identity_invalid';
  end if;
  return new;
end;
$$;

create trigger live_battle_score_winner_identity
before insert or update on public.live_battle_score_states
for each row execute function private.validate_live_battle_winner_identity();
create trigger live_battle_public_winner_identity
before insert or update on public.live_battle_public_states
for each row execute function private.validate_live_battle_winner_identity();

-- Fail closed on existing inconsistent winner facts; never rewrite results.
do $$
begin
  if exists (
    select 1 from (
      select battle_id, outcome, winner_user_id from public.live_battle_score_states
      union all
      select battle_id, outcome, winner_user_id from public.live_battle_public_states
    ) as result
    join public.live_battles as battle on battle.id = result.battle_id
    where result.winner_user_id is distinct from case result.outcome
      when 'challenger' then battle.challenger_user_id
      when 'opponent' then battle.opponent_user_id else null end
  ) then
    raise exception 'live_battle_winner_identity_invalid';
  end if;
end;
$$;

alter table public.live_gift_transactions enable row level security;
alter table public.live_battle_score_states enable row level security;
alter table public.live_battle_public_states enable row level security;
revoke all on public.live_gift_transactions from public, anon, authenticated, service_role;
grant select on public.live_gift_transactions to authenticated;
revoke all on public.live_battle_score_states from public, anon, authenticated, service_role;
revoke all on public.live_battle_public_states from public, anon, authenticated, service_role;
grant select on public.live_battle_public_states to authenticated;

alter function private.prevent_confirmed_live_gift_mutation() owner to postgres;
alter function private.live_battle_lock_users(uuid, uuid) owner to postgres;
alter function private.validate_live_battle_winner_identity() owner to postgres;
alter function private.sync_live_battle_public_states() owner to postgres;
alter function private.reconcile_due_live_battle_series(integer) owner to postgres;
alter function public.create_live_battle_invite(uuid, uuid, uuid) owner to postgres;
alter function public.send_live_gift(uuid, text, text) owner to postgres;
alter function public.send_live_battle_gift(uuid, uuid, text, text) owner to postgres;
revoke all on function private.prevent_confirmed_live_gift_mutation(),
  private.live_battle_lock_users(uuid, uuid),
  private.validate_live_battle_winner_identity(),
  private.sync_live_battle_public_states(),
  private.reconcile_due_live_battle_series(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.create_live_battle_invite(uuid, uuid, uuid),
  public.send_live_gift(uuid, text, text),
  public.send_live_battle_gift(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_live_battle_invite(uuid, uuid, uuid),
  public.send_live_gift(uuid, text, text),
  public.send_live_battle_gift(uuid, uuid, text, text) to authenticated;

-- Release guard and repair run under locks so scope/finance cannot change
-- between validation and the canonical repair. No hard-coded production IDs.
lock table public.live_battle_series, public.live_battles,
  public.live_battle_rematch_requests, public.live_gift_transactions,
  public.financial_transactions, public.ledger_entries in share row exclusive mode;
do $$
declare
  v_count bigint;
  v_series_id uuid;
  v_series public.live_battle_series%rowtype;
  v_gift public.live_gift_transactions%rowtype;
begin
  select count(*), (array_agg(series.id order by series.id))[1]
  into v_count, v_series_id
  from public.live_battle_series as series
  where series.status = 'active'
    and exists (select 1 from public.live_battles as battle
      where battle.series_id = series.id
        and battle.status in ('completed', 'cancelled', 'rejected', 'expired'))
    and not exists (select 1 from public.live_battles as battle
      where battle.series_id = series.id
        and battle.status in ('pending', 'accepted', 'countdown', 'active'));
  if v_count <> 1 then
    raise exception 'live_battles_final_c1_repair_scope_drift';
  end if;
  select * into strict v_series from public.live_battle_series where id = v_series_id;
  if v_series.format <> 'best_of_5' or v_series.max_rounds <> 5 or v_series.wins_required <> 3
     or v_series.challenger_wins <> 0 or v_series.opponent_wins <> 0 or v_series.ties <> 0
     or v_series.rounds_completed <> 0 or v_series.champion_user_id is not null
     or v_series.completed_at is not null or v_series.rematch_window_expires_at is not null
     or (select count(*) from public.live_battles where series_id = v_series_id) <> 1
     or not exists (select 1 from public.live_battles
       where series_id = v_series_id and status = 'expired' and round_number = 1 and ended_at is not null)
     or exists (select 1 from public.live_battle_rematch_requests
       where series_id = v_series_id and status = 'pending') then
    raise exception 'live_battles_final_c1_repair_scope_drift';
  end if;
  -- Every linked operation must have a completed receipt. Include normal gifts
  -- to either retained session, and reject orphan/unresolved linked operations.
  if exists (
    select 1 from public.financial_transactions as financial
    where financial.operation_type = 'live_gift'
      and ((financial.reference_type = 'live_battle' and financial.reference_id in (
        select id::text from public.live_battles where series_id = v_series_id))
        or (financial.reference_type = 'live_session' and financial.reference_id in (
          v_series.challenger_session_id::text, v_series.opponent_session_id::text)))
      and (financial.status is distinct from 'completed' or not exists (
        select 1 from public.live_gift_transactions as gift
        where gift.financial_transaction_id = financial.id))
  ) then
    raise exception 'live_battles_final_c1_unresolved_gift_finance';
  end if;
  for v_gift in select gift.* from public.live_gift_transactions as gift
    where gift.session_id in (v_series.challenger_session_id, v_series.opponent_session_id)
       or gift.battle_id in (select id from public.live_battles where series_id = v_series_id)
       or exists (
         select 1 from public.financial_transactions as financial
         where financial.id = gift.financial_transaction_id
           and financial.operation_type = 'live_gift'
           and ((financial.reference_type = 'live_battle' and financial.reference_id in (
             select id::text from public.live_battles where series_id = v_series_id))
             or (financial.reference_type = 'live_session' and financial.reference_id in (
               v_series.challenger_session_id::text, v_series.opponent_session_id::text)))
       )
  loop
    begin
      if v_gift.battle_id is not null and not exists (
        select 1 from public.live_battles as battle
        where battle.id = v_gift.battle_id
          and ((v_gift.receiver_user_id = battle.challenger_user_id
                and v_gift.session_id = battle.challenger_session_id)
            or (v_gift.receiver_user_id = battle.opponent_user_id
                and v_gift.session_id = battle.opponent_session_id))
      ) then
        raise exception 'live_battles_final_c1_gift_route_invalid';
      end if;
      perform private.verify_live_gift_journal(
        v_gift.financial_transaction_id, v_gift.sender_user_id, v_gift.receiver_user_id,
        v_gift.amount_coins::bigint, v_gift.platform_fee_coins::bigint,
        v_gift.creator_amount_coins::bigint,
        case when v_gift.battle_id is null then v_gift.idempotency_key else
          pg_catalog.format('live_battle:%s:%s', v_gift.battle_id, v_gift.idempotency_key) end,
        case when v_gift.battle_id is null then 'live_session' else 'live_battle' end,
        coalesce(v_gift.battle_id, v_gift.session_id)
      );
    exception when others then
      raise exception 'live_battles_final_c1_unresolved_gift_finance';
    end;
  end loop;
  v_series := private.reconcile_live_battle_series_locked(v_series_id, pg_catalog.clock_timestamp());
  if v_series.id is null or v_series.status <> 'cancelled' then
    raise exception 'live_battles_final_c1_repair_failed';
  end if;
end;
$$;
commit;
