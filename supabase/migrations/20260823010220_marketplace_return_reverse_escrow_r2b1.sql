-- R2B-1: secure the complete full-order refund amount when a seller accepts a
-- post-settlement return. Funds move only from the immutable settlement-leg
-- beneficiaries into a dedicated return escrow. The buyer is not refunded in
-- this phase and B7R reversal authority remains unchanged.
begin;

alter table public.ledger_accounts
  drop constraint ledger_accounts_account_type_check;
alter table public.ledger_accounts
  add constraint ledger_accounts_account_type_check check(account_type in(
    'user','escrow','treasury','platform','marketplace_escrow',
    'marketplace_ads_escrow','marketplace_ads_revenue','marketplace_return_escrow'
  ));

create or replace function public.ensure_marketplace_return_escrow_account()
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
  values(null,'marketplace_return_escrow','BDAG',0,false)
  on conflict on constraint ledger_accounts_system_unique do nothing;
  select id into strict v_id from public.ledger_accounts
  where owner_id is null and account_type='marketplace_return_escrow' and currency='BDAG';
  return v_id;
end;
$$;

select public.ensure_marketplace_return_escrow_account();

create table public.marketplace_return_refund_holds(
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null references public.marketplace_return_requests(id) on delete restrict,
  settlement_id uuid not null references public.marketplace_order_settlements(id) on delete restrict,
  payment_id uuid not null references public.marketplace_payments(id) on delete restrict,
  allocation_id uuid not null references public.marketplace_payment_allocations(id) on delete restrict,
  checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  gross_amount numeric(20,8) not null,
  currency text not null default 'BDAG',
  status text not null default 'held',
  held_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint marketplace_return_refund_holds_return_key unique(return_request_id),
  constraint marketplace_return_refund_holds_settlement_key unique(settlement_id),
  constraint marketplace_return_refund_holds_order_key unique(order_id),
  constraint marketplace_return_refund_holds_seller_idempotency_key
    unique(seller_id,idempotency_key),
  constraint marketplace_return_refund_holds_amount_check check(
    gross_amount>0 and gross_amount=round(gross_amount,8)
  ),
  constraint marketplace_return_refund_holds_currency_check check(currency='BDAG'),
  constraint marketplace_return_refund_holds_status_check check(status='held'),
  constraint marketplace_return_refund_holds_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'
  )
);

create table public.marketplace_return_refund_hold_legs(
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.marketplace_return_refund_holds(id) on delete restrict,
  settlement_id uuid not null references public.marketplace_order_settlements(id) on delete restrict,
  original_settlement_leg_id uuid not null references public.marketplace_settlement_legs(id) on delete restrict,
  leg_type text not null,
  beneficiary_user_id uuid references auth.users(id) on delete restrict,
  source_account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  destination_account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  amount numeric(20,8) not null,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint marketplace_return_refund_hold_legs_original_key unique(original_settlement_leg_id),
  constraint marketplace_return_refund_hold_legs_transaction_key unique(financial_transaction_id),
  constraint marketplace_return_refund_hold_legs_hold_original_key unique(hold_id,original_settlement_leg_id),
  constraint marketplace_return_refund_hold_legs_type_check
    check(leg_type in('seller_net','platform_fee','creator_commission')),
  constraint marketplace_return_refund_hold_legs_amount_check
    check(amount>0 and amount=round(amount,8)),
  constraint marketplace_return_refund_hold_legs_accounts_check
    check(source_account_id<>destination_account_id)
);

create index marketplace_return_refund_hold_legs_hold_idx
  on public.marketplace_return_refund_hold_legs(hold_id,created_at,id);
create index marketplace_return_refund_holds_payment_idx
  on public.marketplace_return_refund_holds(payment_id);
create index marketplace_return_refund_holds_allocation_idx
  on public.marketplace_return_refund_holds(allocation_id);
create index marketplace_return_refund_holds_checkout_idx
  on public.marketplace_return_refund_holds(checkout_id);
create index marketplace_return_refund_holds_buyer_idx
  on public.marketplace_return_refund_holds(buyer_id);
create index marketplace_return_refund_holds_seller_idx
  on public.marketplace_return_refund_holds(seller_id);
create index marketplace_return_refund_holds_store_idx
  on public.marketplace_return_refund_holds(store_id);
create index marketplace_return_refund_hold_legs_settlement_idx
  on public.marketplace_return_refund_hold_legs(settlement_id);
create index marketplace_return_refund_hold_legs_source_idx
  on public.marketplace_return_refund_hold_legs(source_account_id);
create index marketplace_return_refund_hold_legs_destination_idx
  on public.marketplace_return_refund_hold_legs(destination_account_id);

alter table public.marketplace_return_refund_holds enable row level security;
alter table public.marketplace_return_refund_hold_legs enable row level security;
revoke all on table public.marketplace_return_refund_holds,
  public.marketplace_return_refund_hold_legs from public,anon,authenticated,service_role;
grant select on table public.marketplace_return_refund_holds,
  public.marketplace_return_refund_hold_legs to service_role;

create function public.marketplace_reject_return_refund_hold_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception using errcode='42501',message='marketplace_return_refund_hold_immutable';
end;
$$;

create trigger marketplace_return_refund_holds_immutable
before update or delete on public.marketplace_return_refund_holds
for each row execute function public.marketplace_reject_return_refund_hold_mutation();
create trigger marketplace_return_refund_hold_legs_immutable
before update or delete on public.marketplace_return_refund_hold_legs
for each row execute function public.marketplace_reject_return_refund_hold_mutation();

create function public.marketplace_return_refund_hold_receipt(
  p_return_id uuid,
  p_money_moved boolean
)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'return_request',jsonb_build_object(
    'id',rr.id,'order_id',rr.order_id,'status',rr.status,
    'buyer_note',rr.buyer_note,'seller_note',rr.seller_note,
    'created_at',rr.created_at,'decided_at',rr.decided_at,
    'refund_hold',case when h.id is null then null else jsonb_build_object(
      'status',h.status,'gross_amount',h.gross_amount,'held_at',h.held_at
    )end
  ),
  'money_moved',p_money_moved
)
from public.marketplace_return_requests rr
left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id
where rr.id=p_return_id
$$;

create function public.marketplace_create_return_refund_hold_core(
  p_return_id uuid,
  p_seller_id uuid,
  p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  rr public.marketplace_return_requests;
  o public.marketplace_orders;
  p public.marketplace_payments;
  a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;
  h public.marketplace_return_refund_holds;
  prior public.marketplace_return_refund_holds;
  original_leg record;
  account_need record;
  v_hold_id uuid:=gen_random_uuid();
  v_tx_id uuid;
  v_return_escrow uuid;
  v_fingerprint text;
  v_leg_count integer;
  v_leg_total numeric(20,8);
  v_seller_total numeric(20,8);
  v_platform_total numeric(20,8);
  v_creator_total numeric(20,8);
  v_balance numeric(20,8);
  v_operation text;
begin
  if p_return_id is null or p_seller_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_return_refund_hold_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-refund-hold:'||p_return_id::text,0));

  select * into rr from public.marketplace_return_requests
  where id=p_return_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_return_not_found';
  end if;
  if rr.seller_id<>p_seller_id then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  if not exists(select 1 from public.marketplace_sellers ms
    where ms.user_id=p_seller_id and ms.status='approved')
    or not exists(select 1 from public.marketplace_stores st
    where st.id=rr.store_id and st.seller_id=p_seller_id and st.status='active') then
    raise exception using errcode='42501',message='marketplace_seller_not_approved';
  end if;

  select * into prior from public.marketplace_return_refund_holds
  where seller_id=p_seller_id and idempotency_key=p_idempotency_key for update;
  if found and prior.return_request_id<>rr.id then
    raise exception using errcode='23505',message='marketplace_return_refund_hold_idempotency_conflict';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-review-order:'||rr.order_id::text,0));
  select * into o from public.marketplace_orders where id=rr.order_id for update;
  select * into s from public.marketplace_order_settlements where id=rr.settlement_id for update;
  if s.id is null then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
  end if;
  select * into p from public.marketplace_payments where id=s.payment_id for update;
  select * into a from public.marketplace_payment_allocations where id=s.allocation_id for update;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',rr.id,'settlement_id',s.id,'seller_id',p_seller_id,
    'gross_amount',s.gross_amount,'currency',s.currency
  )::text,'UTF8'),'sha256'),'hex');

  if prior.id is not null then
    if prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_refund_hold_idempotency_conflict';
    end if;
    return public.marketplace_return_refund_hold_receipt(rr.id,false);
  end if;
  select * into h from public.marketplace_return_refund_holds
  where return_request_id=rr.id for update;
  if found then
    if h.settlement_id<>s.id or h.seller_id<>p_seller_id
      or h.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23514',message='marketplace_return_refund_hold_integrity_error';
    end if;
    return public.marketplace_return_refund_hold_receipt(rr.id,false);
  end if;

  if rr.status not in('requested','approved')
    or o.id is null or o.status<>'delivered' or o.currency<>'BDAG'
    or p.id is null or p.status<>'paid' or p.refunded_at is not null or p.currency<>'BDAG'
    or a.id is null or a.status<>'released' or a.refunded_at is not null or a.currency<>'BDAG'
    or s.status<>'completed' or s.released_at is null or s.currency<>'BDAG'
    or(rr.order_id,rr.checkout_id,rr.settlement_id,rr.buyer_id,rr.seller_id,rr.store_id)
      is distinct from(o.id,o.checkout_id,s.id,o.buyer_id,o.seller_id,o.store_id)
    or(s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id,s.seller_id,s.store_id)
      is distinct from(p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id)
    or(a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id)
      is distinct from(p.id,o.checkout_id,o.id,o.seller_id,o.store_id)
    or s.gross_amount<>p.gross_amount or s.gross_amount<>a.gross_amount
    or s.gross_amount<>o.total or o.total<>round(o.subtotal+o.shipping_amount,8)
    or s.seller_net_amount<>a.seller_net_amount
    or s.platform_fee_amount<>a.platform_fee_amount
    or s.creator_commission_amount<>a.creator_commission_amount then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals r
    where r.order_id=o.id or r.settlement_id=s.id) then
    raise exception using errcode='55000',message='marketplace_return_refund_hold_settlement_reversed';
  end if;
  if exists(select 1 from public.marketplace_order_disputes d
    where d.order_id=o.id and d.status in('open','under_review')) then
    raise exception using errcode='55000',message='marketplace_return_refund_hold_active_review';
  end if;
  if exists(select 1 from public.marketplace_settlement_legs l
    where l.settlement_id=s.id and(
      l.leg_type not in('seller_net','platform_fee','creator_commission')
      or l.status<>'completed' or l.amount<0)) then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
  end if;

  select count(*)::integer,coalesce(sum(l.amount),0),
    coalesce(sum(l.amount)filter(where l.leg_type='seller_net'),0),
    coalesce(sum(l.amount)filter(where l.leg_type='platform_fee'),0),
    coalesce(sum(l.amount)filter(where l.leg_type='creator_commission'),0)
  into v_leg_count,v_leg_total,v_seller_total,v_platform_total,v_creator_total
  from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.amount>0;
  if v_leg_count=0 or v_leg_total<>s.gross_amount
    or v_seller_total<>s.seller_net_amount
    or v_platform_total<>s.platform_fee_amount
    or v_creator_total<>s.creator_commission_amount then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
  end if;

  if exists(
    select 1 from public.marketplace_settlement_legs l
    left join public.financial_transactions f on f.id=l.financial_transaction_id
    left join public.ledger_accounts src on src.id=f.from_account_id
    left join public.ledger_accounts dst on dst.id=l.destination_account_id
    where l.settlement_id=s.id and l.amount>0 and(
      f.id is null or f.status<>'completed' or f.amount<>l.amount or f.currency<>'BDAG'
      or f.to_account_id<>l.destination_account_id
      or f.reference_type<>'marketplace_order' or f.reference_id<>o.id::text
      or src.id is null or src.owner_id is not null
      or src.account_type<>'marketplace_escrow' or src.currency<>'BDAG'
      or dst.id is null or dst.currency<>'BDAG'
      or(l.leg_type='seller_net' and(
        l.beneficiary_user_id is distinct from o.seller_id
        or dst.owner_id is distinct from o.seller_id or dst.account_type<>'user'))
      or(l.leg_type='platform_fee' and(
        l.beneficiary_user_id is not null
        or dst.owner_id is not null or dst.account_type<>'platform'))
      or(l.leg_type='creator_commission' and(
        l.beneficiary_user_id is null
        or dst.owner_id is distinct from l.beneficiary_user_id or dst.account_type<>'user'))
    )) then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
  end if;

  v_return_escrow:=public.ensure_marketplace_return_escrow_account();
  perform 1 from public.ledger_accounts la
  where la.id in(
    select l.destination_account_id from public.marketplace_settlement_legs l
      where l.settlement_id=s.id and l.amount>0
    union select v_return_escrow
  ) order by la.id for update;
  if not exists(select 1 from public.ledger_accounts la
    where la.id=v_return_escrow and la.owner_id is null
      and la.account_type='marketplace_return_escrow'
      and la.currency='BDAG' and not la.frozen) then
    raise exception using errcode='23514',message='marketplace_return_refund_hold_account_integrity_error';
  end if;
  for account_need in
    select l.destination_account_id,sum(l.amount) required_debit
    from public.marketplace_settlement_legs l
    where l.settlement_id=s.id and l.amount>0 group by l.destination_account_id
  loop
    select la.balance into v_balance from public.ledger_accounts la
    where la.id=account_need.destination_account_id
      and la.currency='BDAG' and not la.frozen;
    if v_balance is null or v_balance<account_need.required_debit then
      raise exception using errcode='55000',
        message='marketplace_return_refund_funding_insufficient_balance';
    end if;
  end loop;

  insert into public.marketplace_return_refund_holds(
    id,return_request_id,settlement_id,payment_id,allocation_id,checkout_id,order_id,
    buyer_id,seller_id,store_id,gross_amount,currency,status,held_at,
    idempotency_key,request_fingerprint
  )values(
    v_hold_id,rr.id,s.id,p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id,
    s.gross_amount,'BDAG','held',clock_timestamp(),p_idempotency_key,v_fingerprint
  )returning * into h;

  for original_leg in
    select l.* from public.marketplace_settlement_legs l
    where l.settlement_id=s.id and l.amount>0
    order by l.destination_account_id,l.id
  loop
    v_tx_id:=gen_random_uuid();
    v_operation:=case original_leg.leg_type
      when'seller_net'then'marketplace_return_seller_hold'
      when'platform_fee'then'marketplace_return_platform_hold'
      when'creator_commission'then'marketplace_return_creator_hold'
    end;
    if v_operation is null then
      raise exception using errcode='23514',message='marketplace_return_refund_hold_settlement_basis_invalid';
    end if;
    insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,idempotency_key,initiated_by
    )values(
      v_tx_id,original_leg.destination_account_id,v_return_escrow,v_operation,
      original_leg.amount,0,'BDAG','completed','marketplace_return_refund_hold',h.id::text,
      h.id::text||':'||original_leg.id::text,p_seller_id
    );
    perform public.ledger_debit(
      v_tx_id,original_leg.destination_account_id,original_leg.amount,
      'Marketplace return refund hold',
      jsonb_build_object('return_request_id',rr.id,'refund_hold_id',h.id,
        'original_settlement_leg_id',original_leg.id)
    );
    perform public.ledger_credit(
      v_tx_id,v_return_escrow,original_leg.amount,
      'Marketplace return refund hold',
      jsonb_build_object('return_request_id',rr.id,'refund_hold_id',h.id,
        'original_settlement_leg_id',original_leg.id)
    );
    insert into public.marketplace_return_refund_hold_legs(
      hold_id,settlement_id,original_settlement_leg_id,leg_type,beneficiary_user_id,
      source_account_id,destination_account_id,amount,financial_transaction_id
    )values(
      h.id,s.id,original_leg.id,original_leg.leg_type,original_leg.beneficiary_user_id,
      original_leg.destination_account_id,v_return_escrow,original_leg.amount,v_tx_id
    );
  end loop;

  return public.marketplace_return_refund_hold_receipt(rr.id,true);
end;
$$;

create or replace function public.respond_to_marketplace_return(
  p_return_id uuid,
  p_decision text,
  p_seller_note text,
  p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  v_request public.marketplace_return_requests;
  v_prior public.marketplace_return_requests;
  v_decision text:=lower(regexp_replace(coalesce(p_decision,''),'^[[:space:]]+|[[:space:]]+$','','g'));
  v_note text:=nullif(regexp_replace(coalesce(p_seller_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_status text;
  v_fingerprint text;
  v_now timestamptz:=clock_timestamp();
  v_hold_receipt jsonb;
  v_money_moved boolean:=false;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null or v_decision not in('approve','reject')
     or(v_note is not null and(char_length(v_note)>1000
       or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>')) then
    raise exception using errcode='22023',message='marketplace_return_decision_invalid_input';
  end if;
  v_status:=case v_decision when'approve'then'approved'else'rejected'end;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'decision',v_decision,'seller_note',v_note
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-decision:'||p_return_id::text,0));
  select * into v_request from public.marketplace_return_requests
  where id=p_return_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_return_not_found';
  end if;
  if v_request.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  if not exists(select 1 from public.marketplace_sellers ms
    where ms.user_id=v_actor and ms.status='approved')
    or not exists(select 1 from public.marketplace_stores st
    where st.id=v_request.store_id and st.seller_id=v_actor and st.status='active') then
    raise exception using errcode='42501',message='marketplace_seller_not_approved';
  end if;

  select * into v_prior from public.marketplace_return_requests
  where seller_id=v_actor and decision_idempotency_key=p_idempotency_key for update;
  if found then
    if v_prior.id<>p_return_id or v_prior.decision_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_decision_idempotency_conflict';
    end if;
    return public.marketplace_return_refund_hold_receipt(v_prior.id,false);
  end if;
  if v_request.status<>'requested' then
    raise exception using errcode='23505',message='marketplace_return_already_decided';
  end if;

  if v_decision='approve' then
    v_hold_receipt:=public.marketplace_create_return_refund_hold_core(
      v_request.id,v_actor,p_idempotency_key);
    v_money_moved:=coalesce((v_hold_receipt->>'money_moved')::boolean,false);
    if v_money_moved is not true
      or v_hold_receipt->'return_request'->'refund_hold'->>'status'<>'held' then
      raise exception using errcode='23514',message='marketplace_return_refund_hold_integrity_error';
    end if;
  end if;

  update public.marketplace_return_requests set
    status=v_status,
    seller_note=v_note,
    decision_idempotency_key=p_idempotency_key,
    decision_fingerprint=v_fingerprint,
    decided_at=v_now,
    updated_at=v_now
  where id=v_request.id
  returning * into v_request;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    v_request.order_id,v_request.checkout_id,v_request.buyer_id,v_request.seller_id,v_request.store_id,
    case when v_status='approved'then'return_approved'else'return_rejected'end,
    (select status from public.marketplace_orders where id=v_request.order_id),
    (select status from public.marketplace_orders where id=v_request.order_id),
    v_actor,'seller',case when v_status='approved'then'marketplace_return_approved'else'marketplace_return_rejected'end,
    p_idempotency_key,jsonb_build_object(
      'return_request_id',v_request.id,'status',v_status,
      'refund_funded',v_status='approved',
      'refund_hold_id',case when v_status='approved'
        then(select h.id from public.marketplace_return_refund_holds h
          where h.return_request_id=v_request.id)else null end
    ),v_now
  );

  return public.marketplace_return_refund_hold_receipt(v_request.id,v_money_moved);
end;
$$;

create function public.fund_marketplace_return_refund_hold(
  p_return_id uuid,
  p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();rr public.marketplace_return_requests;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_return_refund_hold_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-decision:'||p_return_id::text,0));
  select * into rr from public.marketplace_return_requests
  where id=p_return_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_return_not_found';
  end if;
  if rr.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  if rr.status<>'approved' then
    raise exception using errcode='55000',message='marketplace_return_refund_hold_requires_approved';
  end if;
  return public.marketplace_create_return_refund_hold_core(
    rr.id,v_actor,p_idempotency_key);
end;
$$;

create or replace function public.fetch_my_marketplace_order_lifecycle(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 select*into o from public.marketplace_orders where id=p_order_id;
 if o.id is null then raise exception using message='marketplace_order_not_found';end if;
 if auth.uid()not in(o.buyer_id,o.seller_id)then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 return jsonb_build_object(
  'shipping_amount',o.shipping_amount,
  'shipping',(select jsonb_build_object('estimated_delivery_at',sh.estimated_delivery_at)from public.marketplace_order_shipments sh where sh.order_id=o.id),
  'shipping_snapshot',(select jsonb_build_object('processing_days_min',min(s.processing_days_min),'processing_days_max',max(s.processing_days_max),
   'transit_days_min',min(s.transit_days_min),'transit_days_max',max(s.transit_days_max),'return_policy_summary',max(s.return_policy_summary))
   from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),
  'dispute',(select jsonb_build_object(
    'id',d.id,'status',d.status,'reason_code',d.reason_code,'buyer_note',d.buyer_note,'created_at',d.created_at,
    'outcome',x.outcome,'decided_at',x.decided_at,
    'affected_item_ids',coalesce((select jsonb_agg(di.order_item_id order by di.order_item_id)
      from public.marketplace_dispute_items di where di.dispute_id=d.id),'[]'::jsonb),
    'buyer_evidence_asset_ids',coalesce((select jsonb_agg(l.asset_id order by l.position)
      from public.media_asset_links l where l.entity_type='marketplace_dispute'
        and l.entity_id=d.id and l.slot='buyer_evidence'),'[]'::jsonb),
    'seller_response',case when auth.uid()=o.seller_id then(
      select jsonb_build_object(
        'id',r.id,'note',r.note,'created_at',r.created_at,
        'evidence_asset_ids',coalesce((select jsonb_agg(sl.asset_id order by sl.position)
          from public.media_asset_links sl where sl.entity_type='marketplace_dispute'
            and sl.entity_id=d.id and sl.slot='seller_evidence'),'[]'::jsonb)
      )from public.marketplace_dispute_seller_responses r where r.dispute_id=d.id
    )else null end)
   from public.marketplace_order_disputes d left join public.marketplace_dispute_decisions x on x.dispute_id=d.id
   where d.order_id=o.id order by d.created_at desc limit 1),
  'return_eligible',auth.uid()=o.buyer_id
    and o.status='delivered'
    and(select count(*)from public.marketplace_order_settlements se where se.order_id=o.id)=1
    and exists(
      select 1 from public.marketplace_payments p
      join public.marketplace_payment_allocations a on a.payment_id=p.id and a.order_id=o.id
        and a.checkout_id=o.checkout_id
      join public.marketplace_order_settlements se on se.order_id=o.id and se.payment_id=p.id
        and se.allocation_id=a.id and se.checkout_id=o.checkout_id
      where p.checkout_id=o.checkout_id and p.buyer_id=o.buyer_id and p.status='paid'
        and a.seller_id=o.seller_id and a.store_id=o.store_id and a.status='released'
        and se.buyer_id=o.buyer_id and se.seller_id=o.seller_id and se.store_id=o.store_id
        and se.status='completed' and se.released_at is not null
        and not exists(select 1 from public.marketplace_settlement_reversals rv
                       where rv.order_id=o.id or rv.settlement_id=se.id)
    )
    and not exists(select 1 from public.marketplace_return_requests rr where rr.order_id=o.id)
    and not exists(select 1 from public.marketplace_order_disputes ad
                   where ad.order_id=o.id and ad.status in('open','under_review')),
  'return_request',(select jsonb_build_object(
    'id',rr.id,'status',rr.status,'buyer_note',rr.buyer_note,'seller_note',rr.seller_note,
    'created_at',rr.created_at,'decided_at',rr.decided_at,
    'refund_hold',(select jsonb_build_object(
      'status',h.status,'gross_amount',h.gross_amount,'held_at',h.held_at
    )from public.marketplace_return_refund_holds h where h.return_request_id=rr.id)
   )from public.marketplace_return_requests rr where rr.order_id=o.id)
 );
end$$;

create or replace function public.fetch_my_marketplace_sales(
  p_status text default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);v_store uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=auth.uid() and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_status is not null and p_status not in('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
  return coalesce((
    select jsonb_agg(x.row order by x.created_at desc,x.id desc)
    from(
      select o.created_at,o.id,jsonb_build_object(
        'id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,
        'status',o.status,'store_id',o.store_id,'store_name',st.name,'total',o.total,'currency',o.currency,
        'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,
        'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,'recipient_name',sa.recipient_name,
        'city',sa.city,'region',sa.region,'country',sa.country,
        'distinct_lines',(select count(*)from public.marketplace_order_items i where i.order_id=o.id),
        'total_quantity',(select sum(i.quantity)from public.marketplace_order_items i where i.order_id=o.id),
        'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,
        'seller_net_amount',a.seller_net_amount,'allocation_status',a.status,'released_at',a.released_at,
        'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number,
        'active_dispute',(
          select jsonb_build_object(
            'id',d.id,'status',d.status,'reason_code',d.reason_code,'created_at',d.created_at,
            'seller_response_submitted',exists(
              select 1 from public.marketplace_dispute_seller_responses sr where sr.dispute_id=d.id
            )
          )
          from public.marketplace_order_disputes d
          where d.order_id=o.id and d.seller_id=auth.uid() and d.status in('open','under_review')
          order by d.created_at desc,d.id desc limit 1
        ),
        'active_return_request',(
          select jsonb_build_object('id',rr.id,'status',rr.status,'created_at',rr.created_at)
          from public.marketplace_return_requests rr
          where rr.order_id=o.id and rr.seller_id=auth.uid() and(
            rr.status='requested' or(rr.status='approved' and not exists(
              select 1 from public.marketplace_return_refund_holds h
              where h.return_request_id=rr.id and h.status='held'
            ))
          )
          order by rr.created_at desc,rr.id desc limit 1
        )
      )row
      from public.marketplace_orders o
      join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
      join public.marketplace_stores st on st.id=o.store_id
      join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id
      join public.marketplace_payment_allocations a on a.order_id=o.id
      left join public.marketplace_order_shipments sh on sh.order_id=o.id
      where o.seller_id=auth.uid() and o.store_id=v_store
        and(p_status is null or o.status=p_status)
        and(p_before_created_at is null or(o.created_at,o.id)<(p_before_created_at,p_before_id))
      order by o.created_at desc,o.id desc limit v_limit
    )x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.fetch_my_marketplace_returns(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();v_limit integer;v_store uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=v_actor and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=v_actor and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_invalid_limit';end if;
  if(p_before_created_at is null)<>(p_before_id is null)then raise exception using errcode='22023',message='marketplace_invalid_cursor';end if;
  v_limit:=p_limit;
  return(
    with scoped as(
      select rr.id,rr.status,rr.created_at,o.id order_id,o.order_number,o.status order_status,
        st.id store_id,st.name store_name,
        exists(select 1 from public.marketplace_return_refund_holds h
          where h.return_request_id=rr.id and h.status='held') funded
      from public.marketplace_return_requests rr
      join public.marketplace_orders o on o.id=rr.order_id and o.seller_id=v_actor
      join public.marketplace_stores st on st.id=o.store_id and st.id=v_store
      where rr.seller_id=v_actor
    ),attention as(
      select * from scoped where status='requested' or(status='approved' and not funded)
    ),paged as(
      select * from attention
      where p_before_created_at is null or(created_at,id)<(p_before_created_at,p_before_id)
      order by created_at desc,id desc limit v_limit+1
    ),selected as(
      select * from paged order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'attention_count',(select count(*)from attention),
      'requested_count',(select count(*)from scoped where status='requested'),
      'approved_count',(select count(*)from scoped where status='approved' and not funded),
      'returns',coalesce((select jsonb_agg(jsonb_build_object(
        'return_id',id,'status',status,'created_at',created_at,
        'order_id',order_id,'order_number',order_number,'order_status',order_status,
        'store_id',store_id,'store_name',store_name
      )order by created_at desc,id desc)from selected),'[]'::jsonb),
      'next_cursor',case when(select count(*)from paged)>v_limit then(
        select jsonb_build_object('created_at',created_at,'id',id)
        from selected order by created_at asc,id asc limit 1
      )else null end
    ));
end;
$$;

create or replace function public.open_marketplace_post_settlement_review(
  p_resolver_id uuid,p_order_id uuid,p_reason_code text,p_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;d public.marketplace_order_disputes;
  prior public.marketplace_dispute_review_actions;
  v_action_id uuid:=gen_random_uuid();v_dispute_id uuid:=gen_random_uuid();
  v_reason text:=lower(btrim(coalesce(p_reason_code,'')));v_note text:=nullif(btrim(p_note),'');
  v_fingerprint text;v_dispute_key uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_post_settlement_review_service_role_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_post_settlement_review_resolver_forbidden';
  end if;
  if p_order_id is null or p_idempotency_key is null or char_length(v_reason) not between 2 and 100
    or(p_note is not null and char_length(v_note) not between 1 and 1000)then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|','open_marketplace_post_settlement_review',
    p_resolver_id,p_order_id,v_reason,coalesce(v_note,'')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_resolver_id::text||':marketplace-post-settlement-review:'||p_idempotency_key::text,0));
  select * into prior from public.marketplace_dispute_review_actions
  where actor_id=p_resolver_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.order_id<>p_order_id or prior.reason_code<>v_reason
      or coalesce(prior.note,'')<>coalesce(v_note,'')
      or prior.metadata->>'review_type'<>'post_settlement'
      or prior.metadata->>'request_fingerprint'<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_post_settlement_review_idempotency_conflict';
    end if;
    return public.marketplace_post_settlement_review_receipt(prior.id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-review-order:'||p_order_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-post-settlement-review-order:'||p_order_id::text,0));
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
  select * into s from public.marketplace_order_settlements where order_id=o.id for update;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if s.id is null or s.status<>'completed' or s.released_at is null then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_requires_released_settlement';
  end if;
  if p.id is null or p.id<>s.payment_id or p.status<>'paid'
    or a.id is null or a.id<>s.allocation_id or a.status<>'released'
    or o.status in('refunded','partially_refunded')then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_financial_state_invalid';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals r
    where r.settlement_id=s.id or r.order_id=o.id)then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_already_reversed';
  end if;
  if exists(select 1 from public.marketplace_return_refund_holds h
    where h.order_id=o.id and h.settlement_id=s.id and h.status='held')then
    raise exception using errcode='55000',message='marketplace_post_settlement_review_return_hold_active';
  end if;
  if exists(select 1 from public.marketplace_order_disputes x
    where x.order_id=o.id and x.status in('open','under_review'))then
    raise exception using errcode='23505',message='marketplace_post_settlement_review_already_open';
  end if;
  v_dispute_key:=md5(p_resolver_id::text||':'||p_idempotency_key::text)::uuid;
  insert into public.marketplace_order_disputes(
    id,order_id,checkout_id,buyer_id,seller_id,status,reason_code,buyer_note,idempotency_key
  )values(v_dispute_id,o.id,o.checkout_id,o.buyer_id,o.seller_id,'under_review',
    case when v_reason in('not_received','damaged','incorrect_item','missing_items','other')then v_reason else'other'end,
    null,v_dispute_key)returning * into d;
  insert into public.marketplace_dispute_review_actions(
    id,dispute_id,order_id,actor_id,action,reason_code,note,idempotency_key,metadata
  )values(v_action_id,d.id,o.id,p_resolver_id,'review_reopened',v_reason,v_note,p_idempotency_key,
    jsonb_build_object('review_type','post_settlement','request_fingerprint',v_fingerprint,
      'settlement_id',s.id,'payment_id',p.id,'allocation_id',a.id));
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata
  )values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'dispute_opened',o.status,o.status,
    p_resolver_id,'admin',v_reason,p_idempotency_key,
    jsonb_build_object('dispute_id',d.id,'review_id',v_action_id,'review_type','post_settlement','settlement_id',s.id));
  return public.marketplace_post_settlement_review_receipt(v_action_id);
end$$;

create function public.reconcile_marketplace_return_refund_holds()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
with escrow as(
  select
    coalesce((select sum(h.gross_amount)from public.marketplace_return_refund_holds h
      where h.status='held'),0)::numeric expected,
    coalesce((select sum(a.balance)from public.ledger_accounts a
      where a.owner_id is null and a.account_type='marketplace_return_escrow'
        and a.currency='BDAG'),0)::numeric actual
)
select jsonb_build_object(
  'orphan_hold',(select count(*)from public.marketplace_return_refund_holds h
    left join public.marketplace_return_requests rr on rr.id=h.return_request_id
    left join public.marketplace_order_settlements s on s.id=h.settlement_id
    left join public.marketplace_payments p on p.id=h.payment_id
    left join public.marketplace_payment_allocations a on a.id=h.allocation_id
    left join public.marketplace_orders o on o.id=h.order_id
    left join public.marketplace_stores st on st.id=h.store_id
    where rr.id is null or s.id is null or p.id is null or a.id is null or o.id is null or st.id is null),
  'orphan_hold_leg',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.marketplace_return_refund_holds h on h.id=l.hold_id
    left join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where h.id is null or x.id is null),
  'duplicate_original_leg',(select count(*)from(
    select original_settlement_leg_id from public.marketplace_return_refund_hold_legs
    group by 1 having count(*)>1
  )x),
  'hold_amount_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_order_settlements s on s.id=h.settlement_id
    where h.currency<>'BDAG' or h.status<>'held' or h.held_at is null
      or h.gross_amount<>s.gross_amount or h.currency<>s.currency),
  'hold_leg_sum_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    where h.gross_amount<>(select coalesce(sum(l.amount),0)
      from public.marketplace_return_refund_hold_legs l where l.hold_id=h.id)),
  'settlement_identity_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_return_requests rr on rr.id=h.return_request_id
    join public.marketplace_order_settlements s on s.id=h.settlement_id
    join public.marketplace_payments p on p.id=h.payment_id
    join public.marketplace_payment_allocations a on a.id=h.allocation_id
    join public.marketplace_orders o on o.id=h.order_id
    where(h.settlement_id,h.payment_id,h.allocation_id,h.checkout_id,h.order_id,
          h.buyer_id,h.seller_id,h.store_id,h.currency,h.gross_amount)
      is distinct from(rr.settlement_id,s.payment_id,s.allocation_id,o.checkout_id,o.id,
          o.buyer_id,o.seller_id,o.store_id,s.currency,s.gross_amount)
      or(s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id,s.seller_id,s.store_id)
        is distinct from(p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id)
      or(a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id)
        is distinct from(p.id,o.checkout_id,o.id,o.seller_id,o.store_id)),
  'wrong_leg_type',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_return_refund_holds h on h.id=l.hold_id
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.leg_type not in('seller_net','platform_fee','creator_commission')
      or l.settlement_id<>h.settlement_id or l.settlement_id<>x.settlement_id
      or l.leg_type<>x.leg_type or l.amount<>x.amount
      or l.beneficiary_user_id is distinct from x.beneficiary_user_id),
  'wrong_source_account',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    left join public.ledger_accounts a on a.id=l.source_account_id
    where l.source_account_id<>x.destination_account_id or a.id is null or a.currency<>'BDAG'
      or(l.leg_type in('seller_net','creator_commission')and(
        a.owner_id is distinct from l.beneficiary_user_id or a.account_type<>'user'))
      or(l.leg_type='platform_fee'and(
        a.owner_id is not null or a.account_type<>'platform'))),
  'wrong_destination_account',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.ledger_accounts a on a.id=l.destination_account_id
    where a.id is null or a.owner_id is not null
      or a.account_type<>'marketplace_return_escrow' or a.currency<>'BDAG'),
  'missing_transaction',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.financial_transactions f on f.id=l.financial_transaction_id where f.id is null),
  'transaction_amount_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id
    where f.amount<>l.amount or f.fee_amount<>0),
  'transaction_currency_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id where f.currency<>'BDAG'),
  'transaction_status_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id where f.status<>'completed'),
  'transaction_reference_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_return_refund_holds h on h.id=l.hold_id
    join public.financial_transactions f on f.id=l.financial_transaction_id
    where f.reference_type<>'marketplace_return_refund_hold' or f.reference_id<>h.id::text
      or f.idempotency_key<>h.id::text||':'||l.original_settlement_leg_id::text
      or f.initiated_by is distinct from h.seller_id
      or(f.from_account_id,f.to_account_id)is distinct from(l.source_account_id,l.destination_account_id)
      or f.operation_type<>case l.leg_type
        when'seller_net'then'marketplace_return_seller_hold'
        when'platform_fee'then'marketplace_return_platform_hold'
        when'creator_commission'then'marketplace_return_creator_hold'end),
  'funded_return_state_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_return_requests rr on rr.id=h.return_request_id
    where rr.status<>'approved'),
  'return_escrow_expected_held_total',(select expected from escrow),
  'return_escrow_actual_balance',(select actual from escrow),
  'return_escrow_difference',(select actual-expected from escrow),
  'return_escrow_surplus',(select greatest(actual-expected,0)from escrow),
  'return_escrow_shortage',(select greatest(expected-actual,0)from escrow)
)$$;

comment on table public.marketplace_return_refund_holds is
  'Immutable full-order return refund custody headers. R2B-1 holds complete settlement gross and does not refund the buyer.';
comment on table public.marketplace_return_refund_hold_legs is
  'Immutable one-for-one snapshots of positive completed settlement legs moved into dedicated return escrow.';
comment on function public.ensure_marketplace_return_escrow_account() is
  'Ensures the unique zero-seeded BDAG Marketplace return escrow system account.';
comment on function public.marketplace_create_return_refund_hold_core(uuid,uuid,uuid) is
  'Private atomic return-hold core using immutable settlement legs, aggregate balance preflight, and deterministic account locks.';
comment on function public.respond_to_marketplace_return(uuid,text,text,uuid) is
  'Seller-only idempotent return decision authority. Approval atomically funds complete return escrow before status becomes approved; rejection moves no money.';
comment on function public.fund_marketplace_return_refund_hold(uuid,uuid) is
  'Seller-only idempotent funding authority for a legacy approved return without a refund hold.';
comment on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid) is
  'Seller-owned return attention inbox: requested decisions and approved legacy returns whose refund funds remain unsecured.';
comment on function public.reconcile_marketplace_return_refund_holds() is
  'Read-only integrity contract for dedicated Marketplace return escrow and immutable hold legs.';
comment on function public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid) is
  'Admin-only released-settlement review authority; an active funded return hold is mutually exclusive.';

revoke all on function public.marketplace_reject_return_refund_hold_mutation(),
  public.marketplace_return_refund_hold_receipt(uuid,boolean),
  public.marketplace_create_return_refund_hold_core(uuid,uuid,uuid)
from public,anon,authenticated,service_role;

revoke all on function public.ensure_marketplace_return_escrow_account(),
  public.respond_to_marketplace_return(uuid,text,text,uuid),
  public.fund_marketplace_return_refund_hold(uuid,uuid),
  public.fetch_my_marketplace_order_lifecycle(uuid),
  public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid),
  public.fetch_my_marketplace_returns(integer,timestamptz,uuid),
  public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid),
  public.reconcile_marketplace_return_refund_holds()
from public,anon,authenticated;

grant execute on function public.respond_to_marketplace_return(uuid,text,text,uuid),
  public.fund_marketplace_return_refund_hold(uuid,uuid),
  public.fetch_my_marketplace_order_lifecycle(uuid),
  public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid),
  public.fetch_my_marketplace_returns(integer,timestamptz,uuid)
to authenticated,service_role;
grant execute on function public.ensure_marketplace_return_escrow_account(),
  public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid),
  public.reconcile_marketplace_return_refund_holds()
to service_role;

commit;
