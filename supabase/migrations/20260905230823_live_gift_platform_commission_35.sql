begin;

-- One authoritative split for both normal LIVE gifts and directed Battle gifts.
-- Monetary amounts remain whole BDAG units.  Numeric is used only while
-- multiplying by basis points so the bigint input cannot overflow.
create or replace function private.live_gift_commission_split(
  p_gross_amount bigint
)
returns table (
  platform_fee_amount bigint,
  creator_net_amount bigint
)
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_platform_fee bigint;
begin
  if p_gross_amount <= 0 then
    raise exception using
      errcode = '22023', message = 'live_gift_commission_gross_invalid';
  end if;

  v_platform_fee := pg_catalog.floor(
    (p_gross_amount::numeric * 3500 + 5000) / 10000
  )::bigint;

  if v_platform_fee < 0 or v_platform_fee > p_gross_amount then
    raise exception using
      errcode = '22023', message = 'live_gift_commission_split_invalid';
  end if;

  return query select v_platform_fee, p_gross_amount - v_platform_fee;
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
  v_status text;
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
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select session.status, session.host_id into v_status, v_receiver
  from public.live_sessions as session
  where session.id = p_session_id;

  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if v_status <> 'live' then
    raise exception 'live session is not active' using errcode = 'P0001';
  end if;
  if v_receiver = v_sender then
    raise exception 'self-gift not allowed' using errcode = '22023';
  end if;

  select catalog.id, catalog.emoji, catalog.cost_coins
    into v_gift_id, v_gift_emoji, v_gift_cost
  from public.gift_catalog as catalog
  where catalog.id = p_gift_id and catalog.active = true;

  if not found then
    raise exception 'gift not found or inactive' using errcode = 'P0002';
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
    where account.owner_id = v_sender and account.account_type = 'user';

    return query select
      v_existing_id, v_existing_gift_id, v_existing_emoji,
      v_existing_amount, v_existing_creator_amount,
      coalesce(v_sender_balance, 0), v_existing_receiver;
    return;
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

alter function private.live_gift_commission_split(bigint) owner to postgres;
alter function public.send_live_gift(uuid, text, text) owner to postgres;
alter function public.send_live_battle_gift(uuid, uuid, text, text) owner to postgres;

revoke all on function private.live_gift_commission_split(bigint)
  from public, anon, authenticated, service_role;

revoke all on function public.send_live_gift(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.send_live_gift(uuid, text, text)
  to authenticated;

revoke all on function public.send_live_battle_gift(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.send_live_battle_gift(uuid, uuid, text, text)
  to authenticated;

commit;
