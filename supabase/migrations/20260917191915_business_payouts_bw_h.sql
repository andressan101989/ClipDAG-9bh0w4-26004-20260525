-- BW-H hardens the existing withdrawal authority forward-only. Historical
-- rows and historical ledger entries are deliberately left untouched.
alter table public.withdrawal_requests
  add column if not exists request_fingerprint text,
  add column if not exists refund_fin_txn_id uuid references public.financial_transactions(id),
  add column if not exists settlement_fin_txn_id uuid references public.financial_transactions(id),
  add column if not exists broadcast_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz;

create unique index if not exists withdrawal_requests_refund_fin_txn_id_uidx
  on public.withdrawal_requests(refund_fin_txn_id)
  where refund_fin_txn_id is not null;

create unique index if not exists withdrawal_requests_settlement_fin_txn_id_uidx
  on public.withdrawal_requests(settlement_fin_txn_id)
  where settlement_fin_txn_id is not null;

create or replace function public.get_withdrawal_config()
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'minimum_bdag', 100,
    'maximum_bdag', 1000000,
    'fee_bps', 100,
    'bdag_per_usd', 100,
    'max_active_per_user', 10,
    'required_confirmations', 2
  );
$$;

-- The request mutation has one controlled caller: bdag-withdraw. Replace the
-- text idempotency signature with UUID and remove the obsolete overload.
drop function public.request_withdrawal_from_ledger(uuid,numeric,text,text,text,text);

create function public.request_withdrawal_from_ledger(
  p_user_id uuid,
  p_bdag_amount numeric,
  p_to_address text,
  p_chain_id text,
  p_token_type text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_config jsonb := public.get_withdrawal_config();
  v_minimum numeric := (v_config->>'minimum_bdag')::numeric;
  v_maximum numeric := (v_config->>'maximum_bdag')::numeric;
  v_fee_bps integer := (v_config->>'fee_bps')::integer;
  v_max_active integer := (v_config->>'max_active_per_user')::integer;
  v_gross numeric;
  v_fee numeric;
  v_net numeric;
  v_address text;
  v_token text;
  v_fingerprint text;
  v_existing public.withdrawal_requests%rowtype;
  v_active integer;
  v_user_account uuid;
  v_escrow_account uuid;
  v_platform_account uuid;
  v_system_count integer;
  v_withdrawal_id uuid := gen_random_uuid();
  v_fin_txn_id uuid := gen_random_uuid();
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception 'withdrawal_request_invalid' using errcode='22023';
  end if;

  v_gross := round(p_bdag_amount,8);
  v_address := lower(trim(p_to_address));
  v_token := upper(trim(p_token_type));

  if v_gross is null or v_gross < v_minimum then
    raise exception 'minimum_withdrawal_%_bdag',v_minimum using errcode='22023';
  end if;
  if v_gross > v_maximum then
    raise exception 'maximum_withdrawal_%_bdag',v_maximum using errcode='22023';
  end if;
  if v_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid_destination_address' using errcode='22023';
  end if;
  if not (
    (p_chain_id='1' and v_token in ('USDT','USDC'))
    or (p_chain_id='8453' and v_token='USDC')
  ) then
    raise exception 'unsupported_withdrawal_asset_network' using errcode='22023';
  end if;

  v_fee := round(v_gross * v_fee_bps / 10000.0,8);
  v_net := v_gross - v_fee;
  if v_net <= 0 then
    raise exception 'withdrawal_net_invalid' using errcode='22023';
  end if;

  v_fingerprint := md5(concat_ws('|',
    p_user_id::text,
    to_char(v_gross,'FM999999999999990.99999999'),
    v_address,
    p_chain_id,
    v_token
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key::text,0)
  );

  select w.* into v_existing
  from public.withdrawal_requests w
  where w.idempotency_key=p_idempotency_key::text
  for update;

  if found then
    if v_existing.user_id<>p_user_id or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'withdrawal_idempotency_conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'success',true,
      'idempotent',true,
      'withdrawal_id',v_existing.id,
      'fin_txn_id',v_existing.fin_txn_id,
      'fee',v_existing.fee_bdag,
      'net_amount',v_existing.net_bdag,
      'status',v_existing.status
    );
  end if;

  select count(*) into v_active
  from public.withdrawal_requests w
  where w.user_id=p_user_id
    and w.status in ('queued','requested','signing','broadcasted');
  if v_active>=v_max_active then
    raise exception 'withdrawal_active_limit_reached' using errcode='P0001';
  end if;

  v_user_account := public.ensure_ledger_account(p_user_id);

  select (array_agg(a.id order by a.id))[1],count(*) into v_escrow_account,v_system_count
  from public.ledger_accounts a
  where a.account_type='escrow' and a.currency='BDAG' and a.owner_id is null;
  if v_system_count<>1 then
    raise exception 'withdrawal_escrow_authority_ambiguous';
  end if;

  select (array_agg(a.id order by a.id))[1],count(*) into v_platform_account,v_system_count
  from public.ledger_accounts a
  where a.account_type='platform' and a.currency='BDAG' and a.owner_id is null;
  if v_system_count<>1 then
    raise exception 'withdrawal_platform_authority_ambiguous';
  end if;

  perform 1
  from public.ledger_accounts a
  where a.id=any(array[v_user_account,v_escrow_account,v_platform_account])
  order by a.id
  for update;

  insert into public.financial_transactions(
    id,idempotency_key,operation_type,from_account_id,to_account_id,
    amount,fee_amount,currency,status,reference_type,reference_id,initiated_by
  ) values (
    v_fin_txn_id,'withdrawal:'||p_idempotency_key::text,'withdrawal',
    v_user_account,v_escrow_account,v_gross,v_fee,'BDAG','completed',
    'withdrawal_request',v_withdrawal_id::text,p_user_id
  );

  perform public.ledger_debit(
    v_fin_txn_id,v_user_account,v_gross,'withdrawal hold',
    jsonb_build_object('withdrawal_id',v_withdrawal_id,'leg','gross')
  );
  perform public.ledger_credit(
    v_fin_txn_id,v_escrow_account,v_net,'withdrawal escrow reserve',
    jsonb_build_object('withdrawal_id',v_withdrawal_id,'leg','net')
  );
  perform public.ledger_credit(
    v_fin_txn_id,v_platform_account,v_fee,'withdrawal platform fee',
    jsonb_build_object('withdrawal_id',v_withdrawal_id,'leg','fee')
  );

  insert into public.withdrawal_requests(
    id,idempotency_key,request_fingerprint,user_id,ledger_account_id,fin_txn_id,
    bdag_amount,fee_bdag,net_bdag,chain_id,token_type,to_address,status,expires_at
  ) values (
    v_withdrawal_id,p_idempotency_key::text,v_fingerprint,p_user_id,v_user_account,v_fin_txn_id,
    v_gross,v_fee,v_net,p_chain_id,v_token,v_address,'requested',now()+interval '24 hours'
  );

  insert into public.idempotency_keys(
    idempotency_key,operation_type,user_id,request_hash,status,response_body
  ) values (
    p_idempotency_key::text,'withdrawal',p_user_id,v_fingerprint,'completed',
    jsonb_build_object('withdrawal_id',v_withdrawal_id)
  ) on conflict(idempotency_key,operation_type,user_id) do nothing;

  return jsonb_build_object(
    'success',true,
    'idempotent',false,
    'withdrawal_id',v_withdrawal_id,
    'fin_txn_id',v_fin_txn_id,
    'fee',v_fee,
    'net_amount',v_net,
    'status','requested'
  );
end;
$$;

create or replace function public.refund_withdrawal_to_ledger(
  p_withdrawal_id uuid,
  p_failure_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_withdrawal public.withdrawal_requests%rowtype;
  v_is_canonical boolean;
  v_escrow_account uuid;
  v_platform_account uuid;
  v_system_count integer;
  v_refund_txn_id uuid := gen_random_uuid();
  v_legacy_txn_id uuid := gen_random_uuid();
begin
  select w.* into v_withdrawal
  from public.withdrawal_requests w
  where w.id=p_withdrawal_id
  for update;
  if not found then
    raise exception 'withdrawal_not_found' using errcode='P0002';
  end if;

  v_is_canonical := v_withdrawal.request_fingerprint is not null;
  if v_withdrawal.status='completed' then
    return jsonb_build_object('success',true,'already_final',true,'status','completed');
  end if;
  if v_withdrawal.status='failed' or (v_is_canonical and v_withdrawal.refund_fin_txn_id is not null) then
    return jsonb_build_object('success',true,'already_final',true,'status','failed');
  end if;

  select (array_agg(a.id order by a.id))[1],count(*) into v_escrow_account,v_system_count
  from public.ledger_accounts a
  where a.account_type='escrow' and a.currency='BDAG' and a.owner_id is null;
  if v_system_count<>1 then raise exception 'withdrawal_escrow_authority_ambiguous'; end if;

  if v_is_canonical then
    select (array_agg(a.id order by a.id))[1],count(*) into v_platform_account,v_system_count
    from public.ledger_accounts a
    where a.account_type='platform' and a.currency='BDAG' and a.owner_id is null;
    if v_system_count<>1 then raise exception 'withdrawal_platform_authority_ambiguous'; end if;

    perform 1 from public.ledger_accounts a
    where a.id=any(array[v_withdrawal.ledger_account_id,v_escrow_account,v_platform_account])
    order by a.id for update;

    insert into public.financial_transactions(
      id,idempotency_key,operation_type,from_account_id,to_account_id,
      amount,fee_amount,currency,status,reference_type,reference_id,initiated_by
    ) values (
      v_refund_txn_id,'withdrawal-refund:'||v_withdrawal.id::text,'withdrawal_refund',
      v_escrow_account,v_withdrawal.ledger_account_id,v_withdrawal.bdag_amount,0,
      'BDAG','completed','withdrawal_request',v_withdrawal.id::text,v_withdrawal.user_id
    );

    perform public.ledger_debit(v_refund_txn_id,v_escrow_account,v_withdrawal.net_bdag,
      'withdrawal refund escrow',jsonb_build_object('withdrawal_id',v_withdrawal.id,'leg','net'));
    perform public.ledger_debit(v_refund_txn_id,v_platform_account,v_withdrawal.fee_bdag,
      'withdrawal refund fee',jsonb_build_object('withdrawal_id',v_withdrawal.id,'leg','fee'));
    perform public.ledger_credit(v_refund_txn_id,v_withdrawal.ledger_account_id,v_withdrawal.bdag_amount,
      'withdrawal refund user',jsonb_build_object('withdrawal_id',v_withdrawal.id,'leg','gross'));

    update public.withdrawal_requests
    set status='failed',failure_reason=p_failure_reason,failed_at=now(),
        refund_fin_txn_id=v_refund_txn_id,updated_at=now()
    where id=v_withdrawal.id;
  else
    -- Legacy holds never credited the platform fee. Preserve the historical
    -- economic model instead of debiting a fee leg that never existed.
    perform 1 from public.ledger_accounts a
    where a.id=any(array[v_withdrawal.ledger_account_id,v_escrow_account])
    order by a.id for update;
    perform public.ledger_debit(v_legacy_txn_id,v_escrow_account,v_withdrawal.net_bdag,
      'legacy withdrawal refund',jsonb_build_object('withdrawal_id',v_withdrawal.id,'legacy',true));
    perform public.ledger_credit(v_legacy_txn_id,v_withdrawal.ledger_account_id,v_withdrawal.bdag_amount,
      'legacy withdrawal refund',jsonb_build_object('withdrawal_id',v_withdrawal.id,'legacy',true));
    update public.withdrawal_requests
    set status='failed',failure_reason=p_failure_reason,failed_at=now(),updated_at=now()
    where id=v_withdrawal.id;
    if v_withdrawal.fin_txn_id is not null then
      update public.financial_transactions set status='failed' where id=v_withdrawal.fin_txn_id;
    end if;
  end if;

  return jsonb_build_object(
    'success',true,'already_final',false,'legacy',not v_is_canonical,
    'refunded_bdag',v_withdrawal.bdag_amount
  );
end;
$$;

create or replace function public.complete_withdrawal_settlement(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_confirmations integer,
  p_block_number bigint,
  p_receipt jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_withdrawal public.withdrawal_requests%rowtype;
  v_is_canonical boolean;
  v_escrow_account uuid;
  v_system_count integer;
  v_settlement_txn_id uuid := gen_random_uuid();
  v_legacy_txn_id uuid := gen_random_uuid();
  v_existing_reference uuid;
begin
  select w.* into v_withdrawal
  from public.withdrawal_requests w
  where w.id=p_withdrawal_id
  for update;
  if not found then return jsonb_build_object('success',false,'error','withdrawal_not_found'); end if;

  if v_withdrawal.status='completed' then
    if v_withdrawal.tx_hash is not null and lower(v_withdrawal.tx_hash)=lower(p_tx_hash) then
      return jsonb_build_object('success',true,'already_completed',true);
    end if;
    return jsonb_build_object('success',false,'error','tx_hash_conflict');
  end if;
  if v_withdrawal.status not in ('broadcasted','signing') then
    return jsonb_build_object('success',false,'error','invalid_status');
  end if;
  if v_withdrawal.tx_hash is null or lower(v_withdrawal.tx_hash)<>lower(p_tx_hash) then
    return jsonb_build_object('success',false,'error','tx_hash_mismatch');
  end if;
  if p_confirmations<2 then
    return jsonb_build_object('success',false,'error','insufficient_confirmations');
  end if;

  select w.id into v_existing_reference
  from public.withdrawal_requests w
  where lower(w.tx_hash)=lower(p_tx_hash) and w.id<>v_withdrawal.id
  limit 1;
  if v_existing_reference is not null then
    return jsonb_build_object('success',false,'error','tx_hash_conflict');
  end if;

  select (array_agg(a.id order by a.id))[1],count(*) into v_escrow_account,v_system_count
  from public.ledger_accounts a
  where a.account_type='escrow' and a.currency='BDAG' and a.owner_id is null;
  if v_system_count<>1 then raise exception 'withdrawal_escrow_authority_ambiguous'; end if;

  perform 1 from public.ledger_accounts a where a.id=v_escrow_account for update;
  v_is_canonical := v_withdrawal.request_fingerprint is not null;

  if v_is_canonical then
    insert into public.financial_transactions(
      id,idempotency_key,operation_type,from_account_id,to_account_id,
      amount,fee_amount,currency,status,blockchain_txid,reference_type,reference_id,initiated_by,chain_id
    ) values (
      v_settlement_txn_id,'withdrawal-settlement:'||v_withdrawal.id::text,'withdrawal_settlement',
      v_escrow_account,null,v_withdrawal.net_bdag,0,'BDAG','completed',p_tx_hash,
      'withdrawal_request',v_withdrawal.id::text,v_withdrawal.user_id,v_withdrawal.chain_id
    );
    perform public.ledger_debit(v_settlement_txn_id,v_escrow_account,v_withdrawal.net_bdag,
      'withdrawal external settlement',jsonb_build_object('withdrawal_id',v_withdrawal.id,'tx_hash',p_tx_hash));
    update public.withdrawal_requests
    set status='completed',confirmations=p_confirmations,confirmed_at=now(),completed_at=now(),
        settlement_fin_txn_id=v_settlement_txn_id,updated_at=now()
    where id=v_withdrawal.id;
  else
    perform public.ledger_debit(v_legacy_txn_id,v_escrow_account,v_withdrawal.net_bdag,
      'legacy withdrawal settled',jsonb_build_object('withdrawal_id',v_withdrawal.id,'legacy',true));
    update public.withdrawal_requests
    set status='completed',confirmations=p_confirmations,confirmed_at=now(),completed_at=now(),updated_at=now()
    where id=v_withdrawal.id;
    if v_withdrawal.fin_txn_id is not null then
      update public.financial_transactions
      set status='completed',blockchain_txid=p_tx_hash
      where id=v_withdrawal.fin_txn_id;
    end if;
  end if;

  select b.reference_id into v_existing_reference
  from public.blockchain_settlements b
  where lower(b.tx_hash)=lower(p_tx_hash)
  limit 1;
  if v_existing_reference is not null and v_existing_reference<>v_withdrawal.id then
    raise exception 'blockchain_settlement_tx_hash_conflict';
  end if;

  insert into public.blockchain_settlements(
    settlement_type,reference_id,chain_id,tx_hash,to_address,amount_wei,
    block_number,status,rpc_verified,verified_at,raw_receipt
  ) values (
    'withdrawal',v_withdrawal.id,v_withdrawal.chain_id,p_tx_hash,v_withdrawal.to_address,
    '0',p_block_number,'confirmed',true,now(),p_receipt
  ) on conflict(tx_hash) do update set
    status='confirmed',rpc_verified=true,verified_at=now(),block_number=excluded.block_number,
    raw_receipt=excluded.raw_receipt;

  return jsonb_build_object('success',true,'already_completed',false,'legacy',not v_is_canonical);
end;
$$;

create or replace function public.search_my_business_payouts(
  p_business_owner_id uuid,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,20),1),50);
  v_items jsonb := '[]'::jsonb;
  v_next_cursor jsonb;
  v_summary jsonb;
  v_balance numeric := 0;
begin
  if v_actor is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_business_owner_id is null or not (
    private.business_actor_has_capability(p_business_owner_id,'business.payouts.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.payouts.manage')
  ) then
    raise exception 'business_capability_required' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('pending','broadcasting','completed','failed') then
    raise exception 'withdrawal_status_invalid' using errcode='22023';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception 'withdrawal_cursor_invalid' using errcode='22023';
  end if;

  select coalesce(a.balance,0) into v_balance
  from public.ledger_accounts a
  where a.owner_id=p_business_owner_id and a.account_type='user' and a.currency='BDAG';

  with filtered as (
    select w.*,
      case
        when w.status in ('queued','requested','signing') then 'pending'
        when w.status='broadcasted' then 'broadcasting'
        else w.status
      end as public_status
    from public.withdrawal_requests w
    where w.user_id=p_business_owner_id
      and (p_cursor_created_at is null or (w.created_at,w.id)<(p_cursor_created_at,p_cursor_id))
  ), candidates as (
    select f.*
    from filtered f
    where p_status is null or f.public_status=p_status
    order by f.created_at desc,f.id desc
    limit v_limit+1
  ), numbered as (
    select c.*,row_number() over(order by c.created_at desc,c.id desc) rn
    from candidates c
  ), page_rows as (
    select n.* from numbered n where n.rn<=v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,
      'status',p.public_status,
      'bdag_amount',p.bdag_amount,
      'fee_bdag',p.fee_bdag,
      'net_bdag',p.net_bdag,
      'stablecoin_amount',round(p.net_bdag/100.0,6),
      'token_type',p.token_type,
      'chain_id',p.chain_id,
      'masked_destination',case when length(p.to_address)>10 then left(p.to_address,6)||'…'||right(p.to_address,4) else '••••' end,
      'tx_hash',p.tx_hash,
      'confirmations',p.confirmations,
      'required_confirmations',2,
      'created_at',p.created_at,
      'broadcast_at',p.broadcast_at,
      'confirmed_at',p.confirmed_at,
      'completed_at',p.completed_at,
      'failed_at',p.failed_at,
      'failure_reason',case when p.public_status='failed' then 'El retiro no pudo procesarse.' else null end
    ) order by p.created_at desc,p.id desc),'[]'::jsonb),
    case when exists(select 1 from numbered where rn=v_limit+1)
      then (select jsonb_build_object('created_at',n.created_at,'id',n.id) from numbered n where n.rn=v_limit)
      else null end
  into v_items,v_next_cursor
  from page_rows p;

  select jsonb_build_object(
    'pending_count',count(*) filter(where w.status in ('queued','requested','signing')),
    'broadcasting_count',count(*) filter(where w.status='broadcasted'),
    'completed_count',count(*) filter(where w.status='completed'),
    'failed_count',count(*) filter(where w.status='failed'),
    'total_completed_bdag',coalesce(sum(w.bdag_amount) filter(where w.status='completed'),0)
  ) into v_summary
  from public.withdrawal_requests w
  where w.user_id=p_business_owner_id;

  return jsonb_build_object(
    'business_owner_id',p_business_owner_id,
    'bdag_balance',coalesce(v_balance,0),
    'items',v_items,
    'next_cursor',v_next_cursor,
    'summary',v_summary
  );
end;
$$;

create or replace function public.reconcile_withdrawal_escrow()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  with classified as (
    select w.*,(w.request_fingerprint is not null) canonical
    from public.withdrawal_requests w
  ), request_checks as (
    select c.id,c.canonical,
      coalesce(sum(le.amount) filter(where le.entry_type='debit' and la.account_type='user'),0) user_debit,
      coalesce(sum(le.amount) filter(where le.entry_type='credit' and la.account_type='escrow'),0) escrow_credit,
      coalesce(sum(le.amount) filter(where le.entry_type='credit' and la.account_type='platform'),0) platform_credit
    from classified c
    left join public.ledger_entries le on le.txn_id=c.fin_txn_id
    left join public.ledger_accounts la on la.id=le.account_id
    group by c.id,c.canonical
  ), refund_checks as (
    select c.id,
      coalesce(sum(le.amount) filter(where le.entry_type='debit' and la.account_type='escrow'),0) escrow_debit,
      coalesce(sum(le.amount) filter(where le.entry_type='debit' and la.account_type='platform'),0) platform_debit,
      coalesce(sum(le.amount) filter(where le.entry_type='credit' and la.account_type='user'),0) user_credit
    from classified c
    left join public.ledger_entries le on le.txn_id=c.refund_fin_txn_id
    left join public.ledger_accounts la on la.id=le.account_id
    group by c.id
  ), settlement_checks as (
    select c.id,
      coalesce(sum(le.amount) filter(where le.entry_type='debit' and la.account_type='escrow'),0) escrow_debit,
      coalesce(sum(le.amount) filter(where le.entry_type='credit'),0) internal_credit
    from classified c
    left join public.ledger_entries le on le.txn_id=c.settlement_fin_txn_id
    left join public.ledger_accounts la on la.id=le.account_id
    group by c.id
  )
  select jsonb_build_object(
    'legacy_pre_bw_h',(select count(*) from classified where not canonical),
    'canonical_bw_h',(select count(*) from classified where canonical),
    'canonical_request_failures',(
      select count(*) from classified c join request_checks r using(id)
      where c.canonical and (r.user_debit<>c.bdag_amount or r.escrow_credit<>c.net_bdag or r.platform_credit<>c.fee_bdag)
    ),
    'canonical_refund_failures',(
      select count(*) from classified c join refund_checks r using(id)
      where c.canonical and c.refund_fin_txn_id is not null and (
        not exists(
          select 1 from public.financial_transactions f
          where f.id=c.refund_fin_txn_id and f.operation_type='withdrawal_refund'
            and f.reference_type='withdrawal_request' and f.reference_id=c.id::text
        )
        or r.escrow_debit<>c.net_bdag
        or r.platform_debit<>c.fee_bdag
        or r.user_credit<>c.bdag_amount
      )
    ),
    'canonical_settlement_failures',(
      select count(*) from classified c join settlement_checks s using(id)
      where c.canonical and c.status='completed' and (
        not exists(
          select 1 from public.financial_transactions f
          where f.id=c.settlement_fin_txn_id and f.operation_type='withdrawal_settlement'
            and f.reference_type='withdrawal_request' and f.reference_id=c.id::text
            and f.from_account_id is not null and f.to_account_id is null
        )
        or s.escrow_debit<>c.net_bdag
        or s.internal_credit<>0
      )
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_withdrawal_config() from public,anon,authenticated,service_role;
grant execute on function public.get_withdrawal_config() to service_role;

revoke all on function public.request_withdrawal_from_ledger(uuid,numeric,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_withdrawal_from_ledger(uuid,numeric,text,text,text,uuid) to service_role;

revoke all on function public.refund_withdrawal_to_ledger(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.refund_withdrawal_to_ledger(uuid,text) to service_role;

revoke all on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_withdrawal_settlement(uuid,text,integer,bigint,jsonb) to service_role;

revoke all on function public.reconcile_withdrawal_escrow() from public,anon,authenticated,service_role;
grant execute on function public.reconcile_withdrawal_escrow() to service_role;

revoke all on function public.search_my_business_payouts(uuid,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_my_business_payouts(uuid,text,timestamptz,uuid,integer) to authenticated;

-- Retain own-row SELECT for the mobile status/list compatibility path, but
-- remove broad client mutation/table-administration privileges.
revoke insert,update,delete,truncate,references,trigger
  on table public.withdrawal_requests from public,anon,authenticated;

comment on function public.get_withdrawal_config() is 'Canonical server-side withdrawal policy for all clients.';
comment on function public.search_my_business_payouts(uuid,text,timestamptz,uuid,integer) is 'Capability-scoped Business payout projection without internal financial identifiers.';
comment on function public.reconcile_withdrawal_escrow() is 'Read-only service reconciliation separating legacy withdrawals from BW-H canonical accounting.';
