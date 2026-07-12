CREATE OR REPLACE FUNCTION public.check_velocity_limit(
  p_user_id       uuid,
  p_operation     text,
  p_amount        numeric,
  p_max_ops       integer,
  p_max_amount    numeric,
  p_window_hours  integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_window_start timestamptz := date_trunc('hour', now()) - ((p_window_hours - 1) * interval '1 hour');
  v_count   int;
  v_total   numeric;
begin
  select coalesce(sum(count), 0), coalesce(sum(total_amount), 0)
  into v_count, v_total
  from velocity_counters
  where user_id = p_user_id
    and operation_type = p_operation
    and window_end > now() - (p_window_hours || ' hours')::interval;

  if v_count >= p_max_ops then
    insert into suspicious_activity_logs(user_id, event_type, severity, description, metadata)
    values (p_user_id, 'velocity_breach', 'medium',
      format('Operation %s exceeded %s ops/hour (actual: %s)', p_operation, p_max_ops, v_count),
      jsonb_build_object('operation', p_operation, 'count', v_count, 'limit', p_max_ops));
    return false;
  end if;

  if p_max_amount > 0 and v_total + p_amount > p_max_amount then
    insert into suspicious_activity_logs(user_id, event_type, severity, description, metadata)
    values (p_user_id, 'velocity_breach', 'medium',
      format('Operation %s exceeded %s BDAG/hour (actual: %s)', p_operation, p_max_amount, v_total),
      jsonb_build_object('operation', p_operation, 'total', v_total, 'limit', p_max_amount));
    return false;
  end if;

  insert into velocity_counters(user_id, operation_type, window_start, window_end, count, total_amount)
  values (p_user_id, p_operation, date_trunc('hour', now()),
          date_trunc('hour', now()) + interval '1 hour', 1, p_amount)
  on conflict (user_id, operation_type, window_start)
  do update set count        = velocity_counters.count + 1,
                total_amount = velocity_counters.total_amount + p_amount;

  return true;
end;
$function$;


CREATE OR REPLACE FUNCTION public.ensure_ledger_account(
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_id      uuid;
  v_balance numeric;
begin
  select id, balance into v_id, v_balance
  from ledger_accounts
  where owner_id = p_user_id and account_type = 'user';

  if not found then
    insert into ledger_accounts(account_type, owner_id, currency)
    values ('user', p_user_id, 'BDAG')
    on conflict do nothing
    returning id, balance into v_id, v_balance;

    if v_id is null then
      select id, balance into v_id, v_balance
      from ledger_accounts where owner_id = p_user_id and account_type = 'user';
    end if;
  end if;

  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.ledger_debit(
  p_txn_id     uuid,
  p_account_id uuid,
  p_amount     numeric,
  p_description text,
  p_metadata   jsonb
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare v_balance numeric;
begin
  if p_amount <= 0 then raise exception 'debit amount must be > 0'; end if;

  update ledger_accounts
  set balance    = balance - p_amount,
      updated_at = now()
  where id = p_account_id
    and balance >= p_amount
    and not frozen
  returning balance into v_balance;

  if not found then
    raise exception 'insufficient balance or account frozen (account %)', p_account_id;
  end if;

  insert into ledger_entries(txn_id, account_id, entry_type, amount, balance_after, description, metadata)
  values (p_txn_id, p_account_id, 'debit', p_amount, v_balance, p_description, p_metadata);

  return v_balance;
end;
$function$;


CREATE OR REPLACE FUNCTION public.ledger_credit(
  p_txn_id     uuid,
  p_account_id uuid,
  p_amount     numeric,
  p_description text,
  p_metadata   jsonb
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare v_balance numeric;
begin
  if p_amount <= 0 then raise exception 'credit amount must be > 0'; end if;

  update ledger_accounts
  set balance    = balance + p_amount,
      updated_at = now()
  where id = p_account_id and not frozen
  returning balance into v_balance;

  if not found then
    raise exception 'account % not found or frozen', p_account_id;
  end if;

  insert into ledger_entries(txn_id, account_id, entry_type, amount, balance_after, description, metadata)
  values (p_txn_id, p_account_id, 'credit', p_amount, v_balance, p_description, p_metadata);

  return v_balance;
end;
$function$;


CREATE OR REPLACE FUNCTION public.atomic_ledger_transfer(
  p_from_user_id   uuid,
  p_to_user_id     uuid,
  p_amount         numeric,
  p_fee            numeric,
  p_operation_type text,
  p_idempotency_key text,
  p_reference_type text    DEFAULT NULL,
  p_reference_id   uuid    DEFAULT NULL,
  p_description    text    DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_from_acct  uuid;
  v_to_acct    uuid;
  v_fee_acct   uuid;
  v_lock1      uuid;
  v_lock2      uuid;
  v_txn_id     uuid := gen_random_uuid();
  v_fin_id     uuid;
  v_net        numeric := p_amount - p_fee;
  v_idm_id     uuid;
  v_response   jsonb;
begin
  if p_idempotency_key is not null then
    select id, response_body into v_idm_id, v_response
    from idempotency_keys
    where idempotency_key = p_idempotency_key
      and operation_type  = p_operation_type
      and user_id         = p_from_user_id;

    if found then
      if v_response is not null then return v_response; end if;
      raise exception 'operation already in progress (idempotency key %)', p_idempotency_key;
    end if;

    insert into idempotency_keys(idempotency_key, operation_type, user_id, request_hash, status)
    values (p_idempotency_key, p_operation_type, p_from_user_id,
            md5(p_idempotency_key || p_operation_type || p_amount::text), 'processing')
    returning id into v_idm_id;
  end if;

  if p_amount <= 0   then raise exception 'amount must be positive'; end if;
  if p_fee < 0       then raise exception 'fee cannot be negative'; end if;
  if v_net <= 0      then raise exception 'net amount after fee must be positive'; end if;
  if p_from_user_id = p_to_user_id then raise exception 'self-transfer not allowed'; end if;

  v_from_acct := ensure_ledger_account(p_from_user_id);
  v_to_acct   := ensure_ledger_account(p_to_user_id);
  select id into v_fee_acct from ledger_accounts where account_type = 'platform' limit 1;

  if v_from_acct < v_to_acct then v_lock1 := v_from_acct; v_lock2 := v_to_acct;
  else                             v_lock1 := v_to_acct;   v_lock2 := v_from_acct;
  end if;
  perform 1 from ledger_accounts where id = v_lock1 for update;
  perform 1 from ledger_accounts where id = v_lock2 for update;

  insert into financial_transactions(
    idempotency_key, operation_type,
    from_account_id, to_account_id,
    amount, fee_amount, currency, status,
    reference_type, reference_id, initiated_by
  ) values (
    p_idempotency_key, p_operation_type,
    v_from_acct, v_to_acct,
    p_amount, p_fee, 'BDAG', 'completed',
    p_reference_type, p_reference_id, p_from_user_id
  ) returning id into v_fin_id;

  perform ledger_debit(v_txn_id, v_from_acct, p_amount,
    p_description,
    jsonb_build_object('fin_txn_id', v_fin_id));

  perform ledger_credit(v_txn_id, v_to_acct, v_net,
    p_description,
    jsonb_build_object('fin_txn_id', v_fin_id));

  if p_fee > 0 and v_fee_acct is not null then
    perform ledger_credit(v_txn_id, v_fee_acct, p_fee,
      'platform fee: ' || p_operation_type,
      jsonb_build_object('fin_txn_id', v_fin_id));
  end if;

  v_response := jsonb_build_object(
    'success',       true,
    'fin_txn_id',    v_fin_id,
    'from_balance',  (select balance from ledger_accounts where id = v_from_acct),
    'to_balance',    (select balance from ledger_accounts where id = v_to_acct),
    'fee_collected', p_fee
  );

  if v_idm_id is not null then
    update idempotency_keys
    set status = 'completed', response_body = v_response
    where id = v_idm_id;
  end if;

  return v_response;

exception when others then
  if v_idm_id is not null then
    update idempotency_keys
    set status = 'failed', response_body = jsonb_build_object('error', SQLERRM)
    where id = v_idm_id;
  end if;
  raise;
end;
$function$;


CREATE OR REPLACE FUNCTION public.transfer_bdag_internal(
  p_from_user_id    uuid,
  p_to_user_id      uuid,
  p_amount          numeric,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare v_to_profile user_profiles%rowtype;
begin
  select * into v_to_profile from user_profiles where id = p_to_user_id;
  if not found then raise exception 'recipient_not_found'; end if;

  if not check_velocity_limit(p_from_user_id, 'transfer', p_amount, 20, 50000, 1) then
    raise exception 'velocity_limit_exceeded';
  end if;

  return atomic_ledger_transfer(
    p_from_user_id, p_to_user_id, p_amount, 0,
    'transfer', p_idempotency_key, null, null,
    'BDAG transfer to ' || coalesce(v_to_profile.username, p_to_user_id::text)
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.credit_deposit_to_ledger(
  p_user_id     uuid,
  p_bdag_amount numeric,
  p_tx_hash     text,
  p_chain_id    text,
  p_deposit_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user_acct   uuid;
  v_txn_id      uuid := gen_random_uuid();
  v_fin_id      uuid;
  v_new_balance numeric;
  v_idm_key     text := 'deposit:' || p_tx_hash || ':' || p_chain_id;
BEGIN
  IF EXISTS (
    SELECT 1 FROM deposit_confirmations
    WHERE tx_hash = p_tx_hash AND chain_id = p_chain_id
      AND status IN ('credited', 'confirmed')
      AND fin_txn_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_credited', 'idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM financial_transactions
    WHERE blockchain_txid = p_tx_hash
  ) THEN
    SELECT id INTO v_fin_id FROM financial_transactions WHERE blockchain_txid = p_tx_hash;
    RETURN jsonb_build_object('success', false, 'error', 'already_credited', 'idempotent', true, 'fin_txn_id', v_fin_id);
  END IF;

  v_user_acct := public.ensure_ledger_account(p_user_id);
  IF v_user_acct IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ledger_account_not_found');
  END IF;

  INSERT INTO financial_transactions (
    id, idempotency_key, operation_type,
    to_account_id,
    amount, fee_amount, currency, status,
    blockchain_txid, chain_id,
    reference_type, reference_id,
    initiated_by
  ) VALUES (
    v_txn_id, v_idm_key, 'deposit',
    v_user_acct,
    p_bdag_amount, 0, 'BDAG', 'completed',
    p_tx_hash, p_chain_id,
    'deposit_confirmation', p_deposit_id,
    p_user_id
  ) RETURNING id INTO v_fin_id;

  v_new_balance := public.ledger_credit(
    v_txn_id, v_user_acct, p_bdag_amount,
    'Blockchain deposit: ' || p_tx_hash,
    jsonb_build_object('fin_txn_id', v_fin_id, 'chain_id', p_chain_id)
  );

  UPDATE deposit_confirmations
  SET status     = 'credited',
      fin_txn_id = v_fin_id,
      credited_at = now()
  WHERE id = p_deposit_id;

  RETURN jsonb_build_object(
    'success',      true,
    'fin_txn_id',   v_fin_id,
    'new_balance',  v_new_balance,
    'bdag_credited', p_bdag_amount
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[credit_deposit_to_ledger] ERROR: % %', SQLERRM, SQLSTATE;
  RETURN jsonb_build_object(
    'success',  false,
    'error',    SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.request_withdrawal_from_ledger(
  p_user_id         uuid,
  p_bdag_amount     numeric,
  p_to_address      text,
  p_chain_id        text,
  p_token_type      text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_user_acct   uuid;
  v_escrow_acct uuid;
  v_txn_id      uuid := gen_random_uuid();
  v_fin_id      uuid;
  v_wr_id       uuid;
  v_fee         numeric := p_bdag_amount * 0.01;
  v_net         numeric := p_bdag_amount - v_fee;
  v_idm_id      uuid;
begin
  select id from idempotency_keys
  into v_idm_id
  where idempotency_key = p_idempotency_key and operation_type = 'withdrawal' and user_id = p_user_id;
  if found then raise exception 'duplicate withdrawal request'; end if;

  if p_bdag_amount < 100 then raise exception 'minimum withdrawal: 100 BDAG'; end if;
  if v_net <= 0          then raise exception 'net amount invalid'; end if;
  if length(p_to_address) < 10 then raise exception 'invalid destination address'; end if;

  v_user_acct   := ensure_ledger_account(p_user_id);
  select id into v_escrow_acct from ledger_accounts where account_type = 'escrow' limit 1;

  perform 1 from ledger_accounts where id = v_user_acct for update;

  perform ledger_debit(v_txn_id, v_user_acct,   p_bdag_amount, 'withdrawal hold: ' || p_to_address, null);
  perform ledger_credit(v_txn_id, v_escrow_acct, v_net,         'withdrawal escrow: ' || p_to_address, null);

  insert into financial_transactions(
    idempotency_key, operation_type,
    from_account_id, to_account_id,
    amount, fee_amount, currency, status, initiated_by
  ) values (
    p_idempotency_key, 'withdrawal',
    v_user_acct, v_escrow_acct,
    p_bdag_amount, v_fee, 'BDAG', 'pending', p_user_id
  ) returning id into v_fin_id;

  insert into withdrawal_requests(
    idempotency_key, user_id, ledger_account_id, fin_txn_id,
    bdag_amount, fee_bdag, net_bdag,
    chain_id, token_type, to_address,
    status, expires_at
  ) values (
    p_idempotency_key, p_user_id, v_user_acct, v_fin_id,
    p_bdag_amount, v_fee, v_net,
    p_chain_id, p_token_type, p_to_address,
    'requested', now() + interval '24 hours'
  ) returning id into v_wr_id;

  insert into idempotency_keys(idempotency_key, operation_type, user_id, request_hash, status)
  values (p_idempotency_key, 'withdrawal', p_user_id,
          md5(p_idempotency_key || p_bdag_amount::text), 'completed');

  return jsonb_build_object(
    'success',        true,
    'withdrawal_id',  v_wr_id,
    'fin_txn_id',     v_fin_id,
    'fee',            v_fee,
    'net_amount',     v_net
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.follow_user(
  p_follower_id uuid,
  p_target_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  if p_follower_id = p_target_id then
    raise exception 'self_follow_not_allowed';
  end if;

  insert into public.follows (follower_id, following_id)
  values (p_follower_id, p_target_id)
  on conflict (follower_id, following_id) do nothing;

  update public.user_profiles
  set following_count = following_count + 1
  where id = p_follower_id;

  update public.user_profiles
  set followers_count = followers_count + 1
  where id = p_target_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.unfollow_user(
  p_follower_id uuid,
  p_target_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  delete from public.follows
  where follower_id = p_follower_id and following_id = p_target_id;

  update public.user_profiles
  set following_count = greatest(0, following_count - 1)
  where id = p_follower_id;

  update public.user_profiles
  set followers_count = greatest(0, followers_count - 1)
  where id = p_target_id;
end;
$function$;
;
