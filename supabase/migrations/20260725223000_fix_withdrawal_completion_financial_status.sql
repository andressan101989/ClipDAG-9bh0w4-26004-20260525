begin;
create or replace function public.complete_withdrawal_settlement(
  p_withdrawal_id uuid, p_tx_hash text, p_confirmations integer,
  p_block_number bigint, p_receipt jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wr public.withdrawal_requests%rowtype; v_escrow uuid;
begin
  select * into v_wr from public.withdrawal_requests where id=p_withdrawal_id for update;
  if not found then return jsonb_build_object('success',false,'error','withdrawal_not_found'); end if;
  if v_wr.status='completed' then return jsonb_build_object('success',true,'already_completed',true); end if;
  if v_wr.status not in ('broadcasted','signing') then return jsonb_build_object('success',false,'error','invalid_status'); end if;
  if v_wr.tx_hash is null or lower(v_wr.tx_hash)<>lower(p_tx_hash) then return jsonb_build_object('success',false,'error','tx_hash_mismatch'); end if;
  if p_confirmations<2 then return jsonb_build_object('success',false,'error','insufficient_confirmations'); end if;
  select id into v_escrow from public.ledger_accounts where account_type='escrow' limit 1 for update;
  if v_escrow is null then raise exception 'escrow_account_missing'; end if;
  perform public.ledger_debit(gen_random_uuid(),v_escrow,v_wr.net_bdag,'withdrawal settled: '||v_wr.token_type,
    jsonb_build_object('withdrawal_id',v_wr.id,'token_type',v_wr.token_type));
  update public.withdrawal_requests set status='completed',confirmations=p_confirmations,updated_at=now() where id=v_wr.id;
  if v_wr.fin_txn_id is not null then
    update public.financial_transactions set status='completed',blockchain_txid=p_tx_hash where id=v_wr.fin_txn_id;
  end if;
  insert into public.blockchain_settlements(settlement_type,reference_id,chain_id,tx_hash,to_address,amount_wei,block_number,status,rpc_verified,verified_at,raw_receipt)
  values('withdrawal',v_wr.id,v_wr.chain_id,p_tx_hash,v_wr.to_address,'0',p_block_number,'confirmed',true,now(),p_receipt)
  on conflict(tx_hash) do update set status='confirmed',rpc_verified=true,verified_at=now(),block_number=excluded.block_number,raw_receipt=excluded.raw_receipt;
  return jsonb_build_object('success',true,'already_completed',false);
end; $$;
revoke all on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) to service_role;
commit;
