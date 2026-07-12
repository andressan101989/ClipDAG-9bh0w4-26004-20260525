CREATE OR REPLACE FUNCTION public.refund_withdrawal_to_ledger(
  p_withdrawal_id uuid,
  p_failure_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_wr            withdrawal_requests%rowtype;
  v_escrow_acct   uuid;
  v_txn_id        uuid := gen_random_uuid();
begin
  select * into v_wr from withdrawal_requests where id = p_withdrawal_id for update;

  if not found then
    raise exception 'withdrawal_request % not found', p_withdrawal_id;
  end if;

  -- idempotent: if already refunded/failed or already completed, don't touch the ledger again
  if v_wr.status in ('failed', 'completed', 'refunded') then
    return jsonb_build_object('success', true, 'already_final', true, 'status', v_wr.status);
  end if;

  select id into v_escrow_acct from ledger_accounts where account_type = 'escrow' limit 1;
  if v_escrow_acct is null then
    raise exception 'escrow account not found - cannot refund';
  end if;

  -- reverse: escrow -> user (move the net amount that was credited to escrow back to the user)
  perform ledger_debit(v_txn_id, v_escrow_acct, v_wr.net_bdag, 'refund withdrawal ' || p_withdrawal_id::text, null);
  perform ledger_credit(v_txn_id, v_wr.ledger_account_id, v_wr.bdag_amount, 'refund withdrawal ' || p_withdrawal_id::text, null);

  update withdrawal_requests
  set status = 'failed',
      failure_reason = p_failure_reason,
      updated_at = now()
  where id = p_withdrawal_id;

  if v_wr.fin_txn_id is not null then
    update financial_transactions
    set status = 'failed'
    where id = v_wr.fin_txn_id;
  end if;

  return jsonb_build_object('success', true, 'refunded_bdag', v_wr.bdag_amount);
end;
$function$;;
