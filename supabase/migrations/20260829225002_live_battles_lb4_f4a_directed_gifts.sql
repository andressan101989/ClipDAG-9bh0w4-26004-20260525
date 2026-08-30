begin;

alter table public.live_gift_transactions add column battle_id uuid;
alter table public.live_gift_transactions
  add constraint live_gift_transactions_battle_id_fkey
  foreign key (battle_id) references public.live_battles(id) on delete restrict;
comment on column public.live_gift_transactions.battle_id is
  'Canonical Battle attribution for a directed LIVE gift. NULL identifies a normal LIVE gift.';

alter table public.live_gift_transactions
  drop constraint live_gift_transactions_sender_user_id_session_id_idempotenc_key;
create unique index live_gift_transactions_normal_idempotency_uidx
  on public.live_gift_transactions (sender_user_id, session_id, idempotency_key)
  where battle_id is null;
create unique index live_gift_transactions_battle_idempotency_uidx
  on public.live_gift_transactions (sender_user_id, battle_id, idempotency_key)
  where battle_id is not null;
create index live_gift_transactions_battle_receiver_created_idx
  on public.live_gift_transactions (battle_id, receiver_user_id, created_at, id)
  where battle_id is not null;
create unique index live_gift_transactions_financial_transaction_uidx
  on public.live_gift_transactions (financial_transaction_id)
  where financial_transaction_id is not null;

drop index public.live_control_events_gift_transaction_uidx;
create unique index live_control_events_session_gift_transaction_uidx
  on public.live_control_events (session_id, (payload ->> 'transaction_id'))
  where event_type = 'reaction'
    and payload ->> 'gift_real' = 'true'
    and payload ? 'transaction_id';

create or replace function public.emit_live_gift_control_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gift public.gift_catalog%rowtype;
  v_battle public.live_battles%rowtype;
  v_sender_username text;
  v_sender_avatar_url text;
begin
  select gc.* into v_gift from public.gift_catalog as gc where gc.id = new.gift_id;
  select up.username, up.avatar_url into v_sender_username, v_sender_avatar_url
  from public.user_profiles as up where up.id = new.sender_user_id;

  if new.battle_id is null then
    insert into public.live_control_events (
      session_id, target_user_id, actor_user_id, event_type, payload
    ) values (
      new.session_id, new.sender_user_id, new.sender_user_id, 'reaction',
      pg_catalog.jsonb_build_object(
        'gift_real', true, 'gift_visual', true, 'transaction_id', new.id,
        'session_id', new.session_id, 'sender_user_id', new.sender_user_id,
        'sender_username', coalesce(v_sender_username, 'Invitado'),
        'username', coalesce(v_sender_username, 'Invitado'),
        'sender_avatar_url', v_sender_avatar_url, 'avatar_url', v_sender_avatar_url,
        'recipient_user_id', new.receiver_user_id, 'gift_id', new.gift_id,
        'gift_name', coalesce(v_gift.label, new.gift_id),
        'emoji', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
        'icon', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
        'amount_bdag', new.amount_coins, 'amount_coins', new.amount_coins,
        'category', coalesce(v_gift.category, 'basic'),
        'animation_type', coalesce(v_gift.animation_type, 'floating'),
        'animation_asset', v_gift.animation_asset,
        'duration_ms', coalesce(v_gift.duration_ms, 1800),
        'priority', coalesce(v_gift.priority, 0), 'created_at', new.created_at
      )
    ) on conflict (
      session_id, (payload ->> 'transaction_id')
    ) where event_type = 'reaction'
      and payload ->> 'gift_real' = 'true'
      and payload ? 'transaction_id'
    do nothing;
    return new;
  end if;

  select b.* into strict v_battle
  from public.live_battles as b where b.id = new.battle_id;

  insert into public.live_control_events (
    session_id, target_user_id, actor_user_id, event_type, payload
  )
  select projection.session_id, new.receiver_user_id, new.sender_user_id, 'reaction',
    pg_catalog.jsonb_build_object(
      'gift_real', true, 'gift_visual', true, 'battle_gift', true,
      'transaction_id', new.id, 'battle_id', new.battle_id,
      'session_id', projection.session_id, 'recipient_session_id', new.session_id,
      'battle_target_user_id', new.receiver_user_id,
      'sender_user_id', new.sender_user_id,
      'sender_username', coalesce(v_sender_username, 'Invitado'),
      'username', coalesce(v_sender_username, 'Invitado'),
      'sender_avatar_url', v_sender_avatar_url, 'avatar_url', v_sender_avatar_url,
      'recipient_user_id', new.receiver_user_id, 'gift_id', new.gift_id,
      'gift_name', coalesce(v_gift.label, new.gift_id),
      'emoji', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
      'icon', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
      'amount_bdag', new.amount_coins, 'amount_coins', new.amount_coins,
      'category', coalesce(v_gift.category, 'basic'),
      'animation_type', coalesce(v_gift.animation_type, 'floating'),
      'animation_asset', v_gift.animation_asset,
      'duration_ms', coalesce(v_gift.duration_ms, 1800),
      'priority', coalesce(v_gift.priority, 0), 'created_at', new.created_at
    )
  from (values (v_battle.challenger_session_id), (v_battle.opponent_session_id))
    as projection(session_id)
  on conflict (
    session_id, (payload ->> 'transaction_id')
  ) where event_type = 'reaction'
    and payload ->> 'gift_real' = 'true'
    and payload ? 'transaction_id'
  do nothing;
  return new;
end;
$$;

alter function public.emit_live_gift_control_event() owner to postgres;
revoke all on function public.emit_live_gift_control_event()
  from public, anon, authenticated, service_role;

create function public.send_live_battle_gift(
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

  select b.* into v_battle from public.live_battles as b
  where b.id = p_battle_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  v_server_now := pg_catalog.clock_timestamp();

  select g.* into v_existing from public.live_gift_transactions as g
  where g.sender_user_id = v_sender
    and g.battle_id = p_battle_id
    and g.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.receiver_user_id is distinct from p_target_user_id
       or v_existing.gift_id is distinct from p_gift_id then
      raise exception using errcode = '22023', message = 'live_battle_gift_idempotency_conflict';
    end if;
    select la.balance into v_sender_balance from public.ledger_accounts as la
    where la.owner_id = v_sender and la.account_type = 'user';
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

  perform 1 from public.live_sessions as s
  where s.id = v_target_session_id and s.host_id = p_target_user_id
    and s.status = 'live' and s.ended_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'live_battle_gift_target_session_not_live';
  end if;

  select gc.* into v_gift from public.gift_catalog as gc
  where gc.id = p_gift_id and gc.active and gc.enabled;
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
    raise exception using errcode = 'P0001', message = 'live_battle_gift_financial_result_invalid';
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

  return query select
    v_transaction_id, p_battle_id, v_target_session_id, v_gift.id,
    v_gift.emoji, v_gift.cost_coins, v_creator_amount, v_sender_balance,
    p_target_user_id;
end;
$$;

alter function public.send_live_battle_gift(uuid, uuid, text, text) owner to postgres;
revoke all on function public.send_live_battle_gift(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.send_live_battle_gift(uuid, uuid, text, text)
  to authenticated;

commit;
