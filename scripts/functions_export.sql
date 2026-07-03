-- ============================================================================
-- scripts/functions_export.sql
--
-- Definiciones SQL completas de las funciones PostgreSQL de OnSpace Cloud
-- exportadas para recrear en un proyecto Supabase externo.
--
-- ORDEN DE EJECUCIÓN REQUERIDO (respetar dependencias):
--   1. check_velocity_limit        (sin deps de otras funciones custom)
--   2. ensure_ledger_account       (sin deps de otras funciones custom)
--   3. ledger_debit                (sin deps de otras funciones custom)
--   4. ledger_credit               (sin deps de otras funciones custom)
--   5. atomic_ledger_transfer      (depende de: ensure_ledger_account,
--                                               ledger_debit, ledger_credit,
--                                               check_velocity_limit)
--   6. transfer_bdag_internal      (depende de: atomic_ledger_transfer,
--                                               check_velocity_limit)
--   7. credit_deposit_to_ledger    (depende de: ensure_ledger_account,
--                                               ledger_credit)
--   8. request_withdrawal_from_ledger (depende de: ensure_ledger_account,
--                                                  ledger_debit, ledger_credit)
--   9. follow_user                 (sin deps de otras funciones custom)
--  10. unfollow_user               (sin deps de otras funciones custom)
--
-- NOTA: process_dag_reward NO existe como función PostgreSQL en la base de
-- datos — únicamente existe como Edge Function Deno en
-- supabase/functions/process_dag_reward/index.ts.
--
-- TABLAS REQUERIDAS (deben existir antes de ejecutar estas funciones):
--   ledger_accounts, ledger_entries, financial_transactions,
--   idempotency_keys, velocity_counters, suspicious_activity_logs,
--   deposit_confirmations, withdrawal_requests, user_profiles,
--   follows
--
-- NOTA (verificación 2026-07-03): además de las 4 tablas nuevas listadas
-- arriba, estas funciones referencian columnas que no existen en el schema
-- de migration_to_supabase.sql. Esos prerequisitos de schema se agregaron
-- por separado en scripts/functions_export_schema.sql — ver ese archivo
-- para el detalle exacto de qué se añadió y por qué.
-- ============================================================================


-- ============================================================================
-- 1. check_velocity_limit
--    Verifica límites de velocidad (ops/hora y monto/hora) para un usuario.
--    Retorna TRUE si la operación está dentro de los límites.
-- ============================================================================
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
  -- Aggregate all windows in the rolling period
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

  -- Increment counter
  insert into velocity_counters(user_id, operation_type, window_start, window_end, count, total_amount)
  values (p_user_id, p_operation, date_trunc('hour', now()),
          date_trunc('hour', now()) + interval '1 hour', 1, p_amount)
  on conflict (user_id, operation_type, window_start)
  do update set count        = velocity_counters.count + 1,
                total_amount = velocity_counters.total_amount + p_amount;

  return true;
end;
$function$;


-- ============================================================================
-- 2. ensure_ledger_account
--    Obtiene (o crea) la cuenta ledger de tipo 'user' para un usuario dado.
--    Retorna el UUID de la cuenta.
-- ============================================================================
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


-- ============================================================================
-- 3. ledger_debit
--    Debita p_amount de la cuenta p_account_id dentro de una transacción
--    existente (p_txn_id). Verifica saldo suficiente y que la cuenta no
--    esté congelada. Registra la entrada en ledger_entries.
--    Retorna el saldo resultante.
-- ============================================================================
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


-- ============================================================================
-- 4. ledger_credit
--    Acredita p_amount en la cuenta p_account_id dentro de una transacción
--    existente (p_txn_id). Verifica que la cuenta no esté congelada.
--    Registra la entrada en ledger_entries.
--    Retorna el saldo resultante.
-- ============================================================================
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


-- ============================================================================
-- 5. atomic_ledger_transfer
--    Transfiere fondos de un usuario a otro de forma atómica con soporte de
--    idempotencia, comisión de plataforma y bloqueo de filas ordenado para
--    prevenir deadlocks.
--
--    Parámetros:
--      p_from_user_id   — UUID del usuario origen
--      p_to_user_id     — UUID del usuario destino
--      p_amount         — Monto bruto a transferir (incluye fee)
--      p_fee            — Comisión de plataforma (va a cuenta 'platform')
--      p_operation_type — Etiqueta de operación (ej: 'transfer', 'tip', 'gift')
--      p_idempotency_key — Clave única para prevenir doble ejecución
--      p_reference_type — (opcional) tipo de referencia (ej: 'video')
--      p_reference_id   — (opcional) UUID de la referencia
--      p_description    — (opcional) descripción de la transacción
--
--    Retorna jsonb con: success, fin_txn_id, from_balance, to_balance, fee_collected
-- ============================================================================
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
  -- ── Idempotency check ──────────────────────────────────────────────────
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

  -- ── Validate ───────────────────────────────────────────────────────────
  if p_amount <= 0   then raise exception 'amount must be positive'; end if;
  if p_fee < 0       then raise exception 'fee cannot be negative'; end if;
  if v_net <= 0      then raise exception 'net amount after fee must be positive'; end if;
  if p_from_user_id = p_to_user_id then raise exception 'self-transfer not allowed'; end if;

  -- ── Resolve ledger accounts ─────────────────────────────────────────────
  v_from_acct := ensure_ledger_account(p_from_user_id);
  v_to_acct   := ensure_ledger_account(p_to_user_id);
  select id into v_fee_acct from ledger_accounts where account_type = 'platform' limit 1;

  -- ── Lock rows in consistent order to prevent deadlocks ─────────────────
  if v_from_acct < v_to_acct then v_lock1 := v_from_acct; v_lock2 := v_to_acct;
  else                             v_lock1 := v_to_acct;   v_lock2 := v_from_acct;
  end if;
  perform 1 from ledger_accounts where id = v_lock1 for update;
  perform 1 from ledger_accounts where id = v_lock2 for update;

  -- ── Record financial transaction ────────────────────────────────────────
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

  -- ── Move funds ──────────────────────────────────────────────────────────
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

  -- ── Build response ──────────────────────────────────────────────────────
  v_response := jsonb_build_object(
    'success',       true,
    'fin_txn_id',    v_fin_id,
    'from_balance',  (select balance from ledger_accounts where id = v_from_acct),
    'to_balance',    (select balance from ledger_accounts where id = v_to_acct),
    'fee_collected', p_fee
  );

  -- ── Mark idempotency key as completed ───────────────────────────────────
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


-- ============================================================================
-- 6. transfer_bdag_internal
--    Wrapper de alto nivel para transferencias usuario-a-usuario.
--    Verifica que el destinatario exista, aplica velocity limit y delega
--    en atomic_ledger_transfer.
--
--    Parámetros:
--      p_from_user_id    — UUID del remitente
--      p_to_user_id      — UUID del destinatario
--      p_amount          — Cantidad de BDAG a transferir
--      p_idempotency_key — Clave única para prevenir doble ejecución
--
--    Retorna jsonb de atomic_ledger_transfer
-- ============================================================================
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


-- ============================================================================
-- 7. credit_deposit_to_ledger
--    Acredita BDAG en la cuenta ledger de un usuario tras confirmar un depósito
--    blockchain. Maneja idempotencia completa via deposit_confirmations y
--    financial_transactions.
--
--    Parámetros:
--      p_user_id     — UUID del usuario a acreditar
--      p_bdag_amount — Cantidad de BDAG a acreditar
--      p_tx_hash     — Hash de la transacción blockchain
--      p_chain_id    — Identificador de la red (ej: 'eth_mainnet')
--      p_deposit_id  — UUID del registro en deposit_confirmations
--
--    Retorna jsonb con: success, fin_txn_id, new_balance, bdag_credited
-- ============================================================================
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
  -- ── Idempotency: check deposit status ────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM deposit_confirmations
    WHERE tx_hash = p_tx_hash AND chain_id = p_chain_id
      AND status IN ('credited', 'confirmed')
      AND fin_txn_id IS NOT NULL      -- already has a financial record → truly credited
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_credited', 'idempotent', true);
  END IF;

  -- ── Idempotency: check financial_transactions (blockchain_txid) ───────────
  IF EXISTS (
    SELECT 1 FROM financial_transactions
    WHERE blockchain_txid = p_tx_hash
  ) THEN
    SELECT id INTO v_fin_id FROM financial_transactions WHERE blockchain_txid = p_tx_hash;
    RETURN jsonb_build_object('success', false, 'error', 'already_credited', 'idempotent', true, 'fin_txn_id', v_fin_id);
  END IF;

  -- ── Ensure user ledger account exists ────────────────────────────────────
  v_user_acct := public.ensure_ledger_account(p_user_id);
  IF v_user_acct IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ledger_account_not_found');
  END IF;

  -- ── Insert financial_transactions record ──────────────────────────────────
  -- Single-entry credit: blockchain already moved real funds; BDAG is internal.
  -- No treasury debit needed (treasury_hot tracks on-chain balance separately).
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

  -- ── Credit ledger ─────────────────────────────────────────────────────────
  v_new_balance := public.ledger_credit(
    v_txn_id, v_user_acct, p_bdag_amount,
    'Blockchain deposit: ' || p_tx_hash,
    jsonb_build_object('fin_txn_id', v_fin_id, 'chain_id', p_chain_id)
  );

  -- ── Update deposit_confirmations status to 'credited' ─────────────────────
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


-- ============================================================================
-- 8. request_withdrawal_from_ledger
--    Inicia un retiro: debita BDAG del usuario, lo mueve a la cuenta escrow,
--    registra la transacción financiera pendiente y crea el registro en
--    withdrawal_requests para que bdag-withdraw lo procese.
--
--    Fee: 1% del monto solicitado.
--    Mínimo: 100 BDAG.
--
--    Parámetros:
--      p_user_id          — UUID del usuario
--      p_bdag_amount      — Monto bruto a retirar (incluyendo fee)
--      p_to_address       — Dirección blockchain destino (0x...)
--      p_chain_id         — Red blockchain (ej: 'eth_mainnet')
--      p_token_type       — 'ETH' o 'USDT'
--      p_idempotency_key  — Clave única para prevenir doble retiro
--
--    Retorna jsonb con: success, withdrawal_id, fin_txn_id, fee, net_amount
-- ============================================================================
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
  v_fee         numeric := p_bdag_amount * 0.01;  -- 1% withdrawal fee
  v_net         numeric := p_bdag_amount - v_fee;
  v_idm_id      uuid;
begin
  -- Idempotency check
  select id from idempotency_keys
  into v_idm_id
  where idempotency_key = p_idempotency_key and operation_type = 'withdrawal' and user_id = p_user_id;
  if found then raise exception 'duplicate withdrawal request'; end if;

  if p_bdag_amount < 100 then raise exception 'minimum withdrawal: 100 BDAG'; end if;
  if v_net <= 0          then raise exception 'net amount invalid'; end if;
  if length(p_to_address) < 10 then raise exception 'invalid destination address'; end if;

  v_user_acct   := ensure_ledger_account(p_user_id);
  select id into v_escrow_acct from ledger_accounts where account_type = 'escrow' limit 1;

  -- Lock user account row to prevent concurrent withdrawals
  perform 1 from ledger_accounts where id = v_user_acct for update;

  -- Move funds from user → escrow (held during processing)
  perform ledger_debit(v_txn_id, v_user_acct,   p_bdag_amount, 'withdrawal hold: ' || p_to_address, null);
  perform ledger_credit(v_txn_id, v_escrow_acct, v_net,         'withdrawal escrow: ' || p_to_address, null);

  -- Record pending financial transaction
  insert into financial_transactions(
    idempotency_key, operation_type,
    from_account_id, to_account_id,
    amount, fee_amount, currency, status, initiated_by
  ) values (
    p_idempotency_key, 'withdrawal',
    v_user_acct, v_escrow_acct,
    p_bdag_amount, v_fee, 'BDAG', 'pending', p_user_id
  ) returning id into v_fin_id;

  -- Create withdrawal request in queue
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

  -- Register idempotency key
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


-- ============================================================================
-- 9. follow_user
--    Inserta una fila en follows e incrementa los contadores de forma atómica.
--    Ignora si ya existe (ON CONFLICT DO NOTHING).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.follow_user(
  p_follower_id uuid,
  p_target_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  -- Guard: no self-follow
  if p_follower_id = p_target_id then
    raise exception 'self_follow_not_allowed';
  end if;

  -- Insert follow row (ignore duplicate)
  insert into public.follows (follower_id, following_id)
  values (p_follower_id, p_target_id)
  on conflict (follower_id, following_id) do nothing;

  -- Increment counters atomically
  update public.user_profiles
  set following_count = following_count + 1
  where id = p_follower_id;

  update public.user_profiles
  set followers_count = followers_count + 1
  where id = p_target_id;
end;
$function$;


-- ============================================================================
-- 10. unfollow_user
--     Elimina la fila de follows y decrementa los contadores (mínimo 0).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.unfollow_user(
  p_follower_id uuid,
  p_target_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  -- Delete follow row
  delete from public.follows
  where follower_id = p_follower_id and following_id = p_target_id;

  -- Decrement counters (floor at 0)
  update public.user_profiles
  set following_count = greatest(0, following_count - 1)
  where id = p_follower_id;

  update public.user_profiles
  set followers_count = greatest(0, followers_count - 1)
  where id = p_target_id;
end;
$function$;


-- ============================================================================
-- NOTA SOBRE process_dag_reward
-- ============================================================================
-- process_dag_reward NO existe como función PostgreSQL en la base de datos.
-- Solo existe como Edge Function Deno en:
--   supabase/functions/process_dag_reward/index.ts
--
-- Para replicarla en tu Supabase, despliega esa Edge Function usando:
--   supabase functions deploy process_dag_reward
-- ============================================================================
