begin;
-- Stablecoin-only settlement matrix and atomic withdrawal completion.

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_token_type_check;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_token_type_check
  check (token_type in ('ETH', 'USDT', 'USDC')) not valid;
-- ETH remains valid only so historical rows stay readable. New requests are
-- rejected by request_withdrawal_from_ledger below.

create index if not exists withdrawal_requests_fin_txn_id_idx
  on public.withdrawal_requests(fin_txn_id);

create or replace function public.enforce_new_withdrawal_stablecoin_matrix()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not (
      (new.chain_id = '1' and new.token_type in ('USDT', 'USDC')) or
      (new.chain_id = '8453' and new.token_type = 'USDC')
    ) then
      raise exception 'unsupported withdrawal asset/network';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_new_withdrawal_stablecoin_matrix on public.withdrawal_requests;
create trigger enforce_new_withdrawal_stablecoin_matrix
before insert on public.withdrawal_requests
for each row execute function public.enforce_new_withdrawal_stablecoin_matrix();

create or replace function public.complete_withdrawal_settlement(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_confirmations integer,
  p_block_number bigint,
  p_receipt jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wr public.withdrawal_requests%rowtype;
  v_escrow uuid;
begin
  select * into v_wr
  from public.withdrawal_requests
  where id = p_withdrawal_id
  for update;

  if not found then return jsonb_build_object('success', false, 'error', 'withdrawal_not_found'); end if;
  if v_wr.status = 'completed' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_wr.status not in ('broadcasted', 'signing') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_wr.tx_hash is null or lower(v_wr.tx_hash) <> lower(p_tx_hash) then
    return jsonb_build_object('success', false, 'error', 'tx_hash_mismatch');
  end if;
  if p_confirmations < 2 then
    return jsonb_build_object('success', false, 'error', 'insufficient_confirmations');
  end if;

  select id into v_escrow from public.ledger_accounts
  where account_type = 'escrow' limit 1 for update;
  if v_escrow is null then raise exception 'escrow_account_missing'; end if;

  perform public.ledger_debit(
    gen_random_uuid(), v_escrow, v_wr.net_bdag,
    'withdrawal settled: ' || v_wr.token_type,
    jsonb_build_object('withdrawal_id', v_wr.id, 'token_type', v_wr.token_type)
  );

  update public.withdrawal_requests
  set status = 'completed', confirmations = p_confirmations, updated_at = now()
  where id = v_wr.id;

  if v_wr.fin_txn_id is not null then
    update public.financial_transactions
    set status = 'completed', blockchain_txid = p_tx_hash
    where id = v_wr.fin_txn_id;
  end if;

  insert into public.blockchain_settlements(
    settlement_type, reference_id, chain_id, tx_hash, to_address,
    amount_wei, block_number, status, rpc_verified, verified_at, raw_receipt
  ) values (
    'withdrawal', v_wr.id, v_wr.chain_id, p_tx_hash, v_wr.to_address,
    '0', p_block_number, 'confirmed', true, now(), p_receipt
  )
  on conflict (tx_hash) do update set
    status = 'confirmed', rpc_verified = true, verified_at = now(),
    block_number = excluded.block_number, raw_receipt = excluded.raw_receipt;

  return jsonb_build_object('success', true, 'already_completed', false);
end;
$$;

revoke all on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) to service_role;

create or replace function public.wake_bdag_monitor()
returns bigint language plpgsql security definer
set search_path = public, vault, net as $$
declare v_url text; v_key text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'call_dispatch_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'call_dispatch_publishable_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'call_dispatch_secret';
  if v_url is null or v_key is null or v_secret is null then raise exception 'bdag monitor internal configuration missing'; end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/bdag-monitor',
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_key,'X-Monitor-Secret',v_secret),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 50000
  );
end; $$;

commit;
revoke all on function public.wake_bdag_monitor() from public, anon, authenticated;
grant execute on function public.wake_bdag_monitor() to service_role;

do $$
declare v_count integer;
begin
  select count(*) into v_count from cron.job where jobname = 'bdag-monitor';
  if v_count > 1 then raise exception 'multiple bdag-monitor jobs found'; end if;
  if v_count = 0 then
    perform cron.schedule('bdag-monitor','* * * * *','select public.wake_bdag_monitor()');
  else
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'bdag-monitor'),
      schedule := '* * * * *', command := 'select public.wake_bdag_monitor()', active := true
    );
  end if;
end; $$;
