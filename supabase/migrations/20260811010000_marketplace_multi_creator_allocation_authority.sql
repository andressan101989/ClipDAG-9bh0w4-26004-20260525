create table public.marketplace_order_item_creator_allocations(
  id uuid primary key,
  checkout_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  payment_id uuid not null,
  payment_allocation_id uuid not null,
  seller_id uuid not null,
  store_id uuid not null,
  creator_user_id uuid not null references auth.users(id),
  currency text not null default 'BDAG',
  commission_bps integer not null,
  commission_base_amount numeric(20,8) not null,
  commission_amount numeric(20,8) not null,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_item_creator_currency_check check(currency='BDAG'),
  constraint marketplace_item_creator_bps_check check(commission_bps between 1 and 3000),
  constraint marketplace_item_creator_amount_check check(
    commission_base_amount>0 and commission_base_amount=round(commission_base_amount,8)
    and commission_amount>0 and commission_amount=round(commission_amount,8)
    and commission_amount<=commission_base_amount),
  constraint marketplace_item_creator_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'),
  constraint marketplace_item_creator_not_seller check(creator_user_id<>seller_id),
  constraint marketplace_item_creator_order_item_key unique(order_item_id),
  constraint marketplace_item_creator_request_item_key unique(idempotency_key,order_item_id)
);

alter table public.marketplace_order_items
  add constraint marketplace_order_items_b7f_identity_key
  unique(id,order_id,checkout_id,seller_id,store_id);
alter table public.marketplace_orders
  add constraint marketplace_orders_b7f_identity_key unique(id,checkout_id,seller_id,store_id);
alter table public.marketplace_payments
  add constraint marketplace_payments_b7f_identity_key unique(id,checkout_id);
alter table public.marketplace_payment_allocations
  add constraint marketplace_allocations_b7f_identity_key
  unique(id,payment_id,order_id,seller_id,store_id);

alter table public.marketplace_order_item_creator_allocations
  add constraint marketplace_item_creator_item_identity_fkey
    foreign key(order_item_id,order_id,checkout_id,seller_id,store_id)
    references public.marketplace_order_items(id,order_id,checkout_id,seller_id,store_id),
  add constraint marketplace_item_creator_order_identity_fkey
    foreign key(order_id,checkout_id,seller_id,store_id)
    references public.marketplace_orders(id,checkout_id,seller_id,store_id),
  add constraint marketplace_item_creator_payment_identity_fkey
    foreign key(payment_id,checkout_id)
    references public.marketplace_payments(id,checkout_id),
  add constraint marketplace_item_creator_allocation_identity_fkey
    foreign key(payment_allocation_id,payment_id,order_id,seller_id,store_id)
    references public.marketplace_payment_allocations(id,payment_id,order_id,seller_id,store_id);

create index marketplace_item_creator_order_idx
  on public.marketplace_order_item_creator_allocations(order_id,creator_user_id);
create index marketplace_item_creator_allocation_idx
  on public.marketplace_order_item_creator_allocations(payment_allocation_id,creator_user_id);
create index marketplace_item_creator_request_idx
  on public.marketplace_order_item_creator_allocations(idempotency_key);

alter table public.marketplace_order_item_creator_allocations enable row level security;

create or replace function public.marketplace_reject_item_creator_allocation_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='marketplace_item_creator_allocation_immutable';
end$$;

create or replace function public.reconcile_marketplace_multi_creator_allocations()
returns jsonb language sql stable security definer set search_path=public as $$
with x as(
  select c.*,i.order_id item_order_id,i.checkout_id item_checkout_id,i.seller_id item_seller_id,
    i.store_id item_store_id,i.currency item_currency,i.line_total item_line_total,
    o.checkout_id order_checkout_id,o.seller_id order_seller_id,o.store_id order_store_id,o.status order_status,
    p.checkout_id payment_checkout_id,p.status payment_status,
    a.payment_id allocation_payment_id,a.order_id allocation_order_id,a.seller_id allocation_seller_id,
    a.store_id allocation_store_id,a.creator_user_id parent_creator_user_id,
    a.creator_commission_amount parent_creator_amount,a.seller_net_amount,a.platform_fee_amount,a.gross_amount
  from public.marketplace_order_item_creator_allocations c
  left join public.marketplace_order_items i on i.id=c.order_item_id
  left join public.marketplace_orders o on o.id=c.order_id
  left join public.marketplace_payments p on p.id=c.payment_id
  left join public.marketplace_payment_allocations a on a.id=c.payment_allocation_id
),creator_totals as(
  select payment_allocation_id,creator_user_id,round(sum(commission_amount),8) amount
  from public.marketplace_order_item_creator_allocations group by payment_allocation_id,creator_user_id
),allocation_totals as(
  select payment_allocation_id,round(sum(commission_amount),8) amount,
    count(distinct creator_user_id) creator_count
  from public.marketplace_order_item_creator_allocations group by payment_allocation_id
),settlement_creator_legs as(
  select s.allocation_id,l.settlement_id,l.beneficiary_user_id,round(sum(l.amount),8) amount,count(*) leg_count
  from public.marketplace_order_settlements s join public.marketplace_settlement_legs l
    on l.settlement_id=s.id and l.leg_type='creator_commission'
  group by s.allocation_id,l.settlement_id,l.beneficiary_user_id
),creator_leg_tx as(
  select l.*,s.order_id,f.operation_type,f.amount tx_amount,f.currency tx_currency,
    f.status tx_status,f.from_account_id,f.to_account_id
  from public.marketplace_settlement_legs l
  join public.marketplace_order_settlements s on s.id=l.settlement_id
  left join public.financial_transactions f on f.id=l.financial_transaction_id
  where l.leg_type='creator_commission'
)
select jsonb_build_object(
  'orphan_item_creator_allocation',(select count(*) from x where item_order_id is null),
  'wrong_order',(select count(*) from x where item_order_id is distinct from order_id),
  'wrong_checkout',(select count(*) from x where item_checkout_id is distinct from checkout_id
    or order_checkout_id is distinct from checkout_id or payment_checkout_id is distinct from checkout_id),
  'wrong_payment',(select count(*) from x where allocation_payment_id is distinct from payment_id),
  'wrong_payment_allocation',(select count(*) from x where allocation_order_id is distinct from order_id),
  'wrong_seller',(select count(*) from x where item_seller_id is distinct from seller_id
    or order_seller_id is distinct from seller_id or allocation_seller_id is distinct from seller_id),
  'wrong_store',(select count(*) from x where item_store_id is distinct from store_id
    or order_store_id is distinct from store_id or allocation_store_id is distinct from store_id),
  'missing_creator',(select count(*) from x left join auth.users u on u.id=x.creator_user_id where u.id is null),
  'wrong_currency',(select count(*) from x where currency<>'BDAG' or item_currency<>'BDAG'),
  'invalid_bps',(select count(*) from x where commission_bps not between 1 and 3000),
  'invalid_base_amount',(select count(*) from x where commission_base_amount<=0
    or commission_base_amount<>round(commission_base_amount,8)
    or commission_base_amount is distinct from item_line_total),
  'invalid_commission_amount',(select count(*) from x where commission_amount<=0
    or commission_amount<>round(commission_amount,8) or commission_amount>commission_base_amount
    or commission_amount is distinct from round(commission_base_amount*commission_bps/10000.0,8)
      +case when order_item_id=(select z.order_item_id
          from public.marketplace_order_item_creator_allocations z
          where z.order_id=x.order_id order by z.order_item_id desc limit 1)
        and(select count(*) from public.marketplace_order_item_creator_allocations z where z.order_id=x.order_id)
          =(select count(*) from public.marketplace_order_items i where i.order_id=x.order_id)
        and(select count(distinct z.creator_user_id) from public.marketplace_order_item_creator_allocations z where z.order_id=x.order_id)=1
        and(select count(distinct z.commission_bps) from public.marketplace_order_item_creator_allocations z where z.order_id=x.order_id)=1
       then round((select sum(z.commission_base_amount) from public.marketplace_order_item_creator_allocations z where z.order_id=x.order_id)
          *commission_bps/10000.0,8)
        -(select sum(round(z.commission_base_amount*z.commission_bps/10000.0,8))
          from public.marketplace_order_item_creator_allocations z where z.order_id=x.order_id)
       else 0 end),
  'duplicate_order_item_allocation',(select count(*) from(
    select order_item_id from public.marketplace_order_item_creator_allocations group by order_item_id having count(*)>1)d),
  'allocation_after_settlement',(select count(*) from public.marketplace_order_item_creator_allocations c
    join public.marketplace_order_settlements s on s.order_id=c.order_id where c.created_at>s.created_at),
  'allocation_after_refund',(select count(*) from x where payment_status in('refunded','partially_refunded')
    and created_at>coalesce((select refunded_at from public.marketplace_payments where id=payment_id),'-infinity')),
  'request_fingerprint_invalid',(select count(*) from x where char_length(request_fingerprint)<>64
    or request_fingerprint!~'^[0-9a-f]{64}$'),
  'parent_creator_total_mismatch',(select count(*) from allocation_totals t
    join public.marketplace_payment_allocations a on a.id=t.payment_allocation_id
    where a.creator_commission_amount is distinct from t.amount),
  'legacy_single_creator_identity_mismatch',(select count(*) from allocation_totals t
    join public.marketplace_payment_allocations a on a.id=t.payment_allocation_id
    join creator_totals c on c.payment_allocation_id=t.payment_allocation_id
    where t.creator_count=1 and a.creator_user_id is distinct from c.creator_user_id),
  'legacy_multi_creator_identity_mismatch',(select count(*) from allocation_totals t
    join public.marketplace_payment_allocations a on a.id=t.payment_allocation_id
    where t.creator_count>1 and a.creator_user_id is not null),
  'settlement_creator_total_mismatch',(select count(*) from public.marketplace_order_settlements s
    join allocation_totals t on t.payment_allocation_id=s.allocation_id
    where s.creator_commission_amount is distinct from t.amount),
  'settlement_creator_recipient_mismatch',(select count(*) from creator_totals t
    join public.marketplace_order_settlements s on s.allocation_id=t.payment_allocation_id
    left join settlement_creator_legs l on l.allocation_id=t.payment_allocation_id
      and l.beneficiary_user_id=t.creator_user_id
    where l.amount is distinct from t.amount),
  'missing_creator_settlement_leg',(select count(*) from creator_totals t
    join public.marketplace_order_settlements s on s.allocation_id=t.payment_allocation_id
    where not exists(select 1 from public.marketplace_settlement_legs l
      where l.settlement_id=s.id and l.leg_type='creator_commission'
        and l.beneficiary_user_id=t.creator_user_id)),
  'unexpected_creator_settlement_leg',(select count(*) from settlement_creator_legs l
    join allocation_totals a on a.payment_allocation_id=l.allocation_id
    left join creator_totals t on t.payment_allocation_id=l.allocation_id
      and t.creator_user_id=l.beneficiary_user_id where t.creator_user_id is null),
  'duplicate_creator_settlement_recipient',(select count(*) from settlement_creator_legs where leg_count>1),
  'seller_platform_creator_gross_mismatch',(select count(*) from public.marketplace_payment_allocations a
    where a.gross_amount is distinct from a.seller_net_amount+a.platform_fee_amount+a.creator_commission_amount),
  'creator_transaction_mismatch',(select count(*) from creator_leg_tx where financial_transaction_id is null
    or operation_type is distinct from 'marketplace_creator_commission_settlement'
    or tx_amount is distinct from amount or tx_currency is distinct from 'BDAG'
    or tx_status is distinct from 'completed'),
  'creator_ledger_destination_mismatch',(select count(*) from creator_leg_tx l
    left join public.ledger_accounts a on a.id=l.destination_account_id
    where l.to_account_id is distinct from l.destination_account_id
      or a.owner_id is distinct from l.beneficiary_user_id or a.account_type<>'user' or a.currency<>'BDAG')
)$$;

-- The legacy LIVE reconciliation is scoped to LIVE orders so valid B7F
-- multi-creator settlements elsewhere cannot look like duplicate LIVE legs.
create or replace function public.reconcile_marketplace_live_commissions()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'allocation_split_mismatch',(select count(*) from public.marketplace_payment_allocations
    where gross_amount is distinct from seller_net_amount+platform_fee_amount+creator_commission_amount),
  'own_product_commission_mismatch',(select count(*) from public.marketplace_live_commission_sources s
    join public.marketplace_payment_allocations a on a.id=s.allocation_id where s.commerce_mode='own_product'
      and(a.creator_commission_amount<>0 or a.creator_user_id is not null)),
  'affiliate_commission_mismatch',(select count(*) from public.marketplace_live_commission_sources s
    join public.marketplace_payment_allocations a on a.id=s.allocation_id where s.commerce_mode='affiliate_product'
      and(a.creator_user_id is distinct from s.host_id or a.creator_commission_amount is distinct from s.creator_commission_amount
        or a.creator_commission_amount<=0)),
  'source_allocation_mismatch',(select count(*) from public.marketplace_live_commission_sources s
    join public.marketplace_payment_allocations a on a.id=s.allocation_id
    where(s.checkout_id,s.order_id,s.payment_id,s.seller_id,s.store_id,s.currency,s.creator_commission_amount)
      is distinct from(a.checkout_id,a.order_id,a.payment_id,a.seller_id,a.store_id,a.currency,a.creator_commission_amount)),
  'missing_creator_leg',(select count(*) from public.marketplace_live_commission_sources src
    join public.marketplace_order_settlements s on s.order_id=src.order_id
    where s.creator_commission_amount>0 and not exists(select 1 from public.marketplace_settlement_legs l
      where l.settlement_id=s.id and l.leg_type='creator_commission')),
  'duplicate_creator_leg',(select count(*) from(select s.id from public.marketplace_live_commission_sources src
    join public.marketplace_order_settlements s on s.order_id=src.order_id
    join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'
    group by s.id having count(*)>1)q),
  'unexpected_creator_leg',(select count(*) from public.marketplace_live_commission_sources src
    join public.marketplace_order_settlements s on s.order_id=src.order_id
    join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'
    where s.creator_commission_amount=0),
  'creator_transaction_mismatch',(select count(*) from public.marketplace_live_commission_sources src
    join public.marketplace_order_settlements s on s.order_id=src.order_id
    join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'
    left join public.financial_transactions f on f.id=l.financial_transaction_id
    where(l.amount,l.beneficiary_user_id,f.operation_type,f.amount,f.currency,f.status,f.reference_type,f.reference_id)
      is distinct from(s.creator_commission_amount,s.creator_user_id,'marketplace_creator_commission_settlement',
        s.creator_commission_amount,'BDAG','completed','marketplace_order',s.order_id::text)),
  'creator_credit_before_delivery',(select count(*) from public.marketplace_payment_allocations a
    join public.marketplace_live_commission_sources src on src.allocation_id=a.id
    join public.financial_transactions f on f.reference_type='marketplace_order'
      and f.reference_id=a.order_id::text and f.operation_type='marketplace_creator_commission_settlement'
    where a.status='held'))$$;

create or replace function public.marketplace_record_live_purchase()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  src public.marketplace_live_order_sources;pin public.live_session_products;
  item public.marketplace_order_items;buyer_name text;v_key uuid;v_fingerprint text;
begin
  select * into src from public.marketplace_live_order_sources where order_id=new.order_id;
  if not found then return new;end if;
  select * into pin from public.live_session_products where id=src.live_session_product_id;
  select * into item from public.marketplace_order_items where order_id=new.order_id order by id limit 1;
  if item.id is null then raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';end if;
  if pin.commerce_mode='affiliate_product' then
    if new.creator_user_id is distinct from pin.host_id
      or new.creator_commission_amount is distinct from round(item.line_total*pin.creator_commission_bps/10000.0,8)
      or new.creator_commission_amount<=0 then
      raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';
    end if;
    v_key:=md5('marketplace-live-item-allocation:'||new.id::text)::uuid;
    v_fingerprint:=encode(extensions.digest(concat_ws('|',
      'marketplace_live_item_creator_allocation',new.order_id,item.id,pin.host_id,
      pin.creator_commission_bps),'sha256'),'hex');
    insert into public.marketplace_order_item_creator_allocations(
      id,checkout_id,order_id,order_item_id,payment_id,payment_allocation_id,seller_id,store_id,
      creator_user_id,currency,commission_bps,commission_base_amount,commission_amount,
      idempotency_key,request_fingerprint)
    values(gen_random_uuid(),new.checkout_id,new.order_id,item.id,new.payment_id,new.id,
      new.seller_id,new.store_id,pin.host_id,'BDAG',pin.creator_commission_bps,item.line_total,
      new.creator_commission_amount,v_key,v_fingerprint);
  elsif new.creator_commission_amount<>0 or new.creator_user_id is not null then
    raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';
  end if;
  select coalesce(nullif(btrim(display_name),''),username,'Comprador') into buyer_name
    from public.user_profiles where id=src.buyer_id;
  insert into public.marketplace_live_commission_sources(
    checkout_id,order_id,payment_id,allocation_id,live_session_id,host_id,seller_id,store_id,
    product_id,variant_id,affiliate_offer_id,commerce_mode,creator_commission_bps,creator_commission_amount)
  values(new.checkout_id,new.order_id,new.payment_id,new.id,src.live_session_id,src.live_host_id,
    new.seller_id,new.store_id,src.product_id,src.variant_id,pin.affiliate_offer_id,
    pin.commerce_mode,pin.creator_commission_bps,new.creator_commission_amount);
  insert into public.live_commerce_purchase_events(
    session_id,host_id,buyer_id,checkout_id,order_id,order_item_id,product_id,variant_id,
    quantity,gross_amount,creator_commission_amount,creator_commission_status,buyer_display_name)
  values(src.live_session_id,src.live_host_id,src.buyer_id,new.checkout_id,new.order_id,item.id,
    item.product_id,item.variant_id,item.quantity,new.gross_amount,new.creator_commission_amount,
    case when new.creator_commission_amount>0 then'held'else'none'end,left(buyer_name,80));
  return new;
end$$;

create or replace function public.marketplace_create_order_settlement_b7f(
  p_actor_id uuid,p_order_id uuid,p_settlement_id uuid,p_idempotency_key uuid,
  p_request_fingerprint text
)returns uuid language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
  v_escrow uuid;v_seller_account uuid;v_platform_account uuid;v_tx uuid;v_now timestamptz:=now();
  v_balance numeric(20,8);v_item_count integer;v_creator_count integer;v_creator_total numeric(20,8);
  v_expected_creator uuid;v_creator record;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_settlement_service_role_required';
  end if;
  select * into o from public.marketplace_orders where id=p_order_id for update;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if o.id is null or p.id is null or a.id is null or p.status<>'paid' or a.status<>'held'
    or a.payment_id<>p.id or a.checkout_id<>o.checkout_id or a.seller_id<>o.seller_id
    or a.store_id<>o.store_id or a.currency<>'BDAG' or o.currency<>'BDAG'
    or a.gross_amount<>o.total
    or a.gross_amount<>a.seller_net_amount+a.creator_commission_amount+a.platform_fee_amount then
    raise exception using errcode='23514',message='marketplace_settlement_integrity_error';
  end if;
  select count(*),coalesce(round(sum(commission_amount),8),0),count(distinct creator_user_id)
  into v_item_count,v_creator_total,v_creator_count
  from public.marketplace_order_item_creator_allocations where payment_allocation_id=a.id;
  if v_item_count>0 then
    if v_creator_total<>a.creator_commission_amount then
      raise exception using errcode='23514',message='marketplace_settlement_creator_total_mismatch';
    end if;
    if v_creator_count=1 then
      select creator_user_id into v_expected_creator
      from public.marketplace_order_item_creator_allocations where payment_allocation_id=a.id
      order by creator_user_id limit 1;
      if a.creator_user_id is distinct from v_expected_creator then
        raise exception using errcode='23514',message='marketplace_settlement_creator_identity_mismatch';
      end if;
    elsif a.creator_user_id is not null then
      raise exception using errcode='23514',message='marketplace_settlement_creator_identity_mismatch';
    end if;
  elsif (a.creator_commission_amount=0)<>(a.creator_user_id is null) then
    -- Existing held single-creator rows created before B7F remain releasable.
    raise exception using errcode='23514',message='marketplace_settlement_creator_identity_mismatch';
  end if;
  v_escrow:=public.ensure_marketplace_escrow_account();
  v_seller_account:=public.ensure_ledger_account(o.seller_id);
  v_platform_account:=public.ensure_marketplace_platform_account();
  if v_item_count>0 then
    for v_creator in select creator_user_id from public.marketplace_order_item_creator_allocations
      where payment_allocation_id=a.id group by creator_user_id order by creator_user_id loop
      perform public.ensure_ledger_account(v_creator.creator_user_id);
    end loop;
  elsif a.creator_commission_amount>0 then
    perform public.ensure_ledger_account(a.creator_user_id);
  end if;
  perform 1 from public.ledger_accounts la where la.id in(v_escrow,v_seller_account,v_platform_account)
    or la.id in(select account.id from public.ledger_accounts account
      where account.account_type='user' and account.currency='BDAG'
        and account.owner_id in(select creator_user_id
          from public.marketplace_order_item_creator_allocations where payment_allocation_id=a.id
          union all select a.creator_user_id where v_item_count=0 and a.creator_commission_amount>0))
    order by la.id for update;
  select balance into v_balance from public.ledger_accounts
    where id=v_escrow and currency='BDAG' and not frozen;
  if v_balance is null or v_balance<a.gross_amount or exists(select 1 from public.ledger_accounts la
      where(la.id in(v_seller_account,v_platform_account) or la.owner_id in(
        select creator_user_id from public.marketplace_order_item_creator_allocations
        where payment_allocation_id=a.id union all select a.creator_user_id
        where v_item_count=0 and a.creator_commission_amount>0))
      and(la.currency<>'BDAG' or la.frozen)) then
    raise exception using errcode='23514',message='marketplace_settlement_integrity_error';
  end if;
  insert into public.marketplace_order_settlements(
    id,payment_id,allocation_id,checkout_id,order_id,buyer_id,seller_id,store_id,
    gross_amount,seller_net_amount,creator_user_id,creator_commission_amount,platform_fee_amount,
    confirmed_by,idempotency_key,request_fingerprint,confirmed_at,released_at)
  values(p_settlement_id,p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id,
    a.gross_amount,a.seller_net_amount,a.creator_user_id,a.creator_commission_amount,
    a.platform_fee_amount,p_actor_id,p_idempotency_key,p_request_fingerprint,v_now,v_now);
  v_tx:=null;
  if a.seller_net_amount>0 then
    v_tx:=gen_random_uuid();
    insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,
      amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values(v_tx,v_escrow,v_seller_account,'marketplace_seller_settlement',a.seller_net_amount,
      0,'BDAG','completed','marketplace_order',o.id::text,p_settlement_id::text||':seller',p_actor_id);
    perform public.ledger_debit(v_tx,v_escrow,a.seller_net_amount,'Marketplace seller settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
    perform public.ledger_credit(v_tx,v_seller_account,a.seller_net_amount,'Marketplace seller settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
  end if;
  insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,
    beneficiary_user_id,destination_account_id,amount,financial_transaction_id)
  values(p_settlement_id,'seller_net','seller_net',o.seller_id,v_seller_account,a.seller_net_amount,v_tx);
  if v_item_count>0 then
    for v_creator in select x.creator_user_id,round(sum(x.commission_amount),8) amount,
        la.id account_id from public.marketplace_order_item_creator_allocations x
      join public.ledger_accounts la on la.owner_id=x.creator_user_id and la.account_type='user' and la.currency='BDAG'
      where x.payment_allocation_id=a.id group by x.creator_user_id,la.id order by x.creator_user_id loop
      v_tx:=gen_random_uuid();
      insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,
        amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
      values(v_tx,v_escrow,v_creator.account_id,'marketplace_creator_commission_settlement',v_creator.amount,
        0,'BDAG','completed','marketplace_order',o.id::text,
        p_settlement_id::text||':creator:'||v_creator.creator_user_id::text,p_actor_id);
      perform public.ledger_debit(v_tx,v_escrow,v_creator.amount,'Marketplace creator commission settlement',
        jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id,'creator_user_id',v_creator.creator_user_id));
      perform public.ledger_credit(v_tx,v_creator.account_id,v_creator.amount,'Marketplace creator commission settlement',
        jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id,'creator_user_id',v_creator.creator_user_id));
      insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,
        beneficiary_user_id,destination_account_id,amount,financial_transaction_id)
      values(p_settlement_id,'creator_commission:'||v_creator.creator_user_id::text,'creator_commission',
        v_creator.creator_user_id,v_creator.account_id,v_creator.amount,v_tx);
    end loop;
  elsif a.creator_commission_amount>0 then
    select id into strict v_seller_account from public.ledger_accounts
      where owner_id=a.creator_user_id and account_type='user' and currency='BDAG';
    v_tx:=gen_random_uuid();
    insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,
      amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values(v_tx,v_escrow,v_seller_account,'marketplace_creator_commission_settlement',a.creator_commission_amount,
      0,'BDAG','completed','marketplace_order',o.id::text,p_settlement_id::text||':creator',p_actor_id);
    perform public.ledger_debit(v_tx,v_escrow,a.creator_commission_amount,'Marketplace creator commission settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
    perform public.ledger_credit(v_tx,v_seller_account,a.creator_commission_amount,'Marketplace creator commission settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
    insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,
      beneficiary_user_id,destination_account_id,amount,financial_transaction_id)
    values(p_settlement_id,'creator_commission','creator_commission',a.creator_user_id,
      v_seller_account,a.creator_commission_amount,v_tx);
  end if;
  v_tx:=null;
  if a.platform_fee_amount>0 then
    v_tx:=gen_random_uuid();
    insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,
      amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values(v_tx,v_escrow,v_platform_account,'marketplace_platform_fee_settlement',a.platform_fee_amount,
      0,'BDAG','completed','marketplace_order',o.id::text,p_settlement_id::text||':platform',p_actor_id);
    perform public.ledger_debit(v_tx,v_escrow,a.platform_fee_amount,'Marketplace platform fee settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
    perform public.ledger_credit(v_tx,v_platform_account,a.platform_fee_amount,'Marketplace platform fee settlement',
      jsonb_build_object('fin_txn_id',v_tx,'order_id',o.id));
  end if;
  insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,
    beneficiary_user_id,destination_account_id,amount,financial_transaction_id)
  values(p_settlement_id,'platform_fee','platform_fee',null,v_platform_account,a.platform_fee_amount,v_tx);
  perform set_config('app.marketplace_settlement','on',true);
  update public.marketplace_payment_allocations set status='released',released_at=v_now
    where id=a.id and status='held';
  return p_settlement_id;
end$$;

create or replace function public.confirm_marketplace_order_delivery_and_release(
  p_buyer_id uuid,p_order_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;sh public.marketplace_order_shipments;
  p public.marketplace_payments;a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;v_fingerprint text;
  v_settlement uuid:=gen_random_uuid();v_now timestamptz:=now();
begin
  if p_buyer_id is null or p_order_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_delivery_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest('marketplace_order_confirm_delivery:'||p_order_id::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text||':marketplace-delivery:'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-order-settlement:'||p_order_id::text,0));
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
  if o.buyer_id<>p_buyer_id then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
  select * into s from public.marketplace_order_settlements
    where buyer_id=p_buyer_id and idempotency_key=p_idempotency_key;
  if found then
    if s.order_id<>p_order_id or s.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_settlement_idempotency_conflict';
    end if;
    return public.marketplace_order_settlement_receipt(s.id,'buyer');
  end if;
  select * into s from public.marketplace_order_settlements where order_id=p_order_id;
  if found then return public.marketplace_order_settlement_receipt(s.id,'buyer');end if;
  select * into sh from public.marketplace_order_shipments where order_id=o.id for update;
  select mp.* into p from public.marketplace_payments mp
    join public.marketplace_checkout_sessions c on c.id=mp.checkout_id
    where mp.checkout_id=o.checkout_id and c.status='paid' for update of mp;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if p.id is null or p.status<>'paid' then raise exception using message='marketplace_order_not_paid';end if;
  if o.status<>'shipped' then raise exception using message='marketplace_order_not_shipped';end if;
  if sh.id is null or sh.status<>'shipped' then raise exception using message='marketplace_shipment_not_shipped';end if;
  if a.id is null or a.status<>'held' then raise exception using message='marketplace_allocation_not_held';end if;
  perform public.marketplace_create_order_settlement_b7f(
    p_buyer_id,o.id,v_settlement,p_idempotency_key,v_fingerprint);
  update public.marketplace_orders set status='delivered',delivered_at=v_now,
    fulfillment_updated_at=v_now,fulfillment_version=fulfillment_version+1
    where id=o.id and status='shipped';
  update public.marketplace_order_shipments set status='delivered',delivered_at=v_now
    where id=sh.id and status='shipped';
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,idempotency_key,metadata,created_at)
  values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'delivery_confirmed','shipped','delivered',
    p_buyer_id,'buyer',p_idempotency_key,jsonb_build_object('settlement_id',v_settlement,'currency','BDAG'),v_now),
    (o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'escrow_released','delivered','delivered',
    p_buyer_id,'buyer',p_idempotency_key,jsonb_build_object('settlement_id',v_settlement,'currency','BDAG','status','released'),v_now);
  return public.marketplace_order_settlement_receipt(v_settlement,'buyer');
end$$;

create or replace function public.release_marketplace_order_after_dispute_resolution(
  p_resolver_id uuid,p_order_id uuid,p_dispute_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;
  a public.marketplace_payment_allocations;s public.marketplace_order_settlements;
  v_settlement uuid:=gen_random_uuid();v_fingerprint text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';
  end if;
  if p_order_id is null or p_dispute_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_dispute_resolution_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-order-settlement:'||p_order_id::text,0));
  select * into d from public.marketplace_order_disputes where id=p_dispute_id for update;
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if d.id is null or o.id is null or d.order_id<>o.id then
    raise exception using errcode='P0002',message='marketplace_dispute_not_found';
  end if;
  if d.status not in('open','under_review') then
    raise exception using errcode='22023',message='marketplace_dispute_not_open';
  end if;
  if exists(select 1 from public.marketplace_dispute_decisions where dispute_id=d.id) then
    raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';
  end if;
  select * into s from public.marketplace_order_settlements where order_id=o.id;
  if found then return jsonb_build_object('settlement',jsonb_build_object(
    'id',s.id,'status',s.status,'released_at',s.released_at),
    'money_moved',false,'already_released',true);end if;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if p.id is null or p.status<>'paid' then
    raise exception using errcode='22023',message='marketplace_refund_payment_not_paid';
  end if;
  if o.status not in('shipped','delivered') then
    raise exception using errcode='22023',message='marketplace_refund_order_state_invalid';
  end if;
  if a.id is null or a.status<>'held' then
    raise exception using errcode='22023',message='marketplace_refund_allocation_not_held';
  end if;
  v_fingerprint:=encode(extensions.digest('marketplace_dispute_support_release:'||d.id::text,'sha256'),'hex');
  perform public.marketplace_create_order_settlement_b7f(
    p_resolver_id,o.id,v_settlement,p_idempotency_key,v_fingerprint);
  return jsonb_build_object('settlement',jsonb_build_object(
    'id',v_settlement,'status','released','released_at',now()),
    'allocation',jsonb_build_object('status','released','gross_amount',a.gross_amount),
    'money_moved',true,'actor_role','admin');
end$$;



create trigger marketplace_item_creator_allocations_immutable
before update or delete on public.marketplace_order_item_creator_allocations
for each row execute function public.marketplace_reject_item_creator_allocation_mutation();

-- Multi-creator compatibility keeps the economic total scalar while using a
-- nullable identity to mean that more than one creator owns that total.
alter table public.marketplace_payment_allocations
  drop constraint marketplace_allocation_split_check;
alter table public.marketplace_payment_allocations
  add constraint marketplace_allocation_split_check check(
    gross_amount=platform_fee_amount+seller_net_amount+creator_commission_amount
    and creator_commission_amount>=0
    and creator_commission_amount=round(creator_commission_amount,8)
    and (creator_commission_amount>0 or creator_user_id is null));

alter table public.marketplace_order_settlements
  drop constraint marketplace_settlement_amount_check;
alter table public.marketplace_order_settlements
  add constraint marketplace_settlement_amount_check check(
    gross_amount>0 and seller_net_amount>=0 and platform_fee_amount>=0
    and creator_commission_amount>=0
    and gross_amount=round(gross_amount,8)
    and seller_net_amount=round(seller_net_amount,8)
    and platform_fee_amount=round(platform_fee_amount,8)
    and creator_commission_amount=round(creator_commission_amount,8)
    and gross_amount=seller_net_amount+platform_fee_amount+creator_commission_amount
    and (creator_commission_amount>0 or creator_user_id is null));

-- Preserve the deployed B7R refund/release branches and add one narrow held
-- snapshot update usable only by the canonical B7F authority.
do $$
declare v_body text;v_extended text;
begin
  select p.prosrc into strict v_body from pg_proc p
  where p.oid='public.marketplace_allocation_release_guard()'::regprocedure;
  if position('marketplace_b7f_creator_allocation_guard' in v_body)=0 then
    v_extended:=regexp_replace(v_body,'^[[:space:]]*begin',E'begin\n  -- marketplace_b7f_creator_allocation_guard\n  if tg_op=''UPDATE''\n    and current_setting(''app.marketplace_multi_creator_allocation'',true)=''on''\n    and old.status=''held'' and new.status=''held''\n    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,\n        old.currency,old.gross_amount,old.platform_fee_amount,old.fee_bps,old.status,\n        old.released_at,old.refunded_at)\n       is not distinct from\n       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,\n        new.currency,new.gross_amount,new.platform_fee_amount,new.fee_bps,new.status,\n        new.released_at,new.refunded_at)\n    and old.seller_net_amount+old.creator_commission_amount\n        =new.seller_net_amount+new.creator_commission_amount\n    and new.creator_commission_amount>=0\n    and new.seller_net_amount=new.gross_amount-new.platform_fee_amount-new.creator_commission_amount\n    then return new;\n  end if;','');
    if v_extended=v_body then
      raise exception using errcode='P0001',message='marketplace_b7f_allocation_guard_extension_failed';
    end if;
    execute 'create or replace function public.marketplace_allocation_release_guard() returns trigger language plpgsql set search_path=public as '
      ||quote_literal(v_extended);
  end if;
  if position('marketplace_b7f_creator_allocation_guard' in
    pg_get_functiondef('public.marketplace_allocation_release_guard()'::regprocedure))=0 then
    raise exception using errcode='P0001',message='marketplace_b7f_allocation_guard_extension_failed';
  end if;
end$$;

create or replace function public.marketplace_item_creator_allocation_receipt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'order_id',a.order_id,
  'payment_id',a.payment_id,
  'payment_allocation_id',a.id,
  'currency',a.currency,
  'creator_commission_amount',a.creator_commission_amount,
  'creator_user_id',a.creator_user_id,
  'seller_net_amount',a.seller_net_amount,
  'platform_fee_amount',a.platform_fee_amount,
  'gross_amount',a.gross_amount,
  'allocations',coalesce((select jsonb_agg(jsonb_build_object(
    'id',x.id,'order_item_id',x.order_item_id,'creator_user_id',x.creator_user_id,
    'commission_bps',x.commission_bps,'commission_base_amount',x.commission_base_amount,
    'commission_amount',x.commission_amount,'currency',x.currency)
    order by x.order_item_id) from public.marketplace_order_item_creator_allocations x
    where x.order_id=a.order_id),'[]'::jsonb))
from public.marketplace_payment_allocations a where a.order_id=p_order_id
$$;

create or replace function public.apply_marketplace_order_item_creator_allocations(
  p_order_id uuid,p_allocations jsonb,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
  v_element jsonb;v_normalized jsonb;v_fingerprint text;v_input_count integer;v_distinct_items integer;
  v_order_item_count integer;v_creator_count integer;v_bps_count integer;
  v_total numeric(20,8);v_target numeric(20,8);v_provisional numeric(20,8);v_residual numeric(20,8):=0;
  v_creator uuid;v_max_item uuid;v_prior_count integer;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_creator_allocation_service_role_required';
  end if;
  if p_order_id is null or p_idempotency_key is null or jsonb_typeof(p_allocations)<>'array'
    or jsonb_array_length(p_allocations)=0 then
    raise exception using errcode='22023',message='marketplace_creator_allocation_invalid_input';
  end if;
  for v_element in select value from jsonb_array_elements(p_allocations) loop
    if jsonb_typeof(v_element)<>'object' or not(v_element?'order_item_id') or not(v_element?'creator_user_id')
      or not(v_element?'commission_bps')
      or (v_element-'order_item_id'-'creator_user_id'-'commission_bps')<>'{}'::jsonb then
      raise exception using errcode='22023',message='marketplace_creator_allocation_invalid_input';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('order_item_id',(e->>'order_item_id')::uuid,
    'creator_user_id',(e->>'creator_user_id')::uuid,'commission_bps',(e->>'commission_bps')::integer)
    order by(e->>'order_item_id')::uuid),count(*),count(distinct(e->>'order_item_id')::uuid)
  into v_normalized,v_input_count,v_distinct_items from jsonb_array_elements(p_allocations)e;
  if v_input_count<>v_distinct_items then
    raise exception using errcode='23505',message='marketplace_creator_allocation_duplicate_item';
  end if;
  if exists(select 1 from jsonb_array_elements(v_normalized)e
    where(e->>'commission_bps')::integer not between 1 and 3000) then
    raise exception using errcode='22023',message='marketplace_creator_allocation_invalid_bps';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|',
    'apply_marketplace_order_item_creator_allocations',p_order_id,v_normalized::text),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-allocation-key:'||p_idempotency_key::text,0));
  select count(*) into v_prior_count from public.marketplace_order_item_creator_allocations
    where idempotency_key=p_idempotency_key;
  if v_prior_count>0 then
    if exists(select 1 from public.marketplace_order_item_creator_allocations
      where idempotency_key=p_idempotency_key
        and(order_id<>p_order_id or request_fingerprint<>v_fingerprint)) then
      raise exception using errcode='23505',message='marketplace_creator_allocation_idempotency_conflict';
    end if;
    if v_prior_count<>v_input_count then
      raise exception using errcode='23505',message='marketplace_creator_allocation_idempotency_conflict';
    end if;
    return public.marketplace_item_creator_allocation_receipt(p_order_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-allocation-order:'||p_order_id::text,0));
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if exists(select 1 from public.marketplace_order_settlements where order_id=o.id) then
    raise exception using errcode='22023',message='marketplace_creator_allocation_after_settlement';
  end if;
  if o.status in('refunded','partially_refunded') or p.status in('refunded','partially_refunded')
    or a.status in('refunded','partially_refunded') then
    raise exception using errcode='22023',message='marketplace_creator_allocation_after_refund';
  end if;
  if p.id is null or p.status<>'paid' or a.id is null or a.status<>'held'
    or a.payment_id<>p.id or a.checkout_id<>o.checkout_id or a.seller_id<>o.seller_id
    or a.store_id<>o.store_id or a.currency<>'BDAG' or o.currency<>'BDAG' then
    raise exception using errcode='22023',message='marketplace_creator_allocation_state_ineligible';
  end if;
  if exists(select 1 from public.marketplace_order_item_creator_allocations where order_id=o.id)
    or a.creator_commission_amount<>0 or a.creator_user_id is not null then
    raise exception using errcode='23505',message='marketplace_creator_allocation_already_frozen';
  end if;
  perform 1 from public.marketplace_order_items i join jsonb_array_elements(v_normalized)e
    on i.id=(e->>'order_item_id')::uuid order by i.id for update of i;
  if (select count(*) from public.marketplace_order_items i join jsonb_array_elements(v_normalized)e
      on i.id=(e->>'order_item_id')::uuid
      where i.order_id=o.id and i.checkout_id=o.checkout_id and i.seller_id=o.seller_id
        and i.store_id=o.store_id and i.currency='BDAG')<>v_input_count then
    raise exception using errcode='23514',message='marketplace_creator_allocation_item_mismatch';
  end if;
  if exists(select 1 from jsonb_array_elements(v_normalized)e
      left join auth.users u on u.id=(e->>'creator_user_id')::uuid
      where u.id is null or u.id=o.seller_id) then
    raise exception using errcode='23514',message='marketplace_creator_allocation_creator_invalid';
  end if;
  select count(*) into v_order_item_count from public.marketplace_order_items where order_id=o.id;
  select count(distinct(e->>'creator_user_id')::uuid),count(distinct(e->>'commission_bps')::integer)
  into v_creator_count,v_bps_count from jsonb_array_elements(v_normalized)e;
  select(e->>'order_item_id')::uuid into v_max_item from jsonb_array_elements(v_normalized)e
    order by(e->>'order_item_id')::uuid desc limit 1;
  select round(sum(round(i.line_total*(e->>'commission_bps')::integer/10000.0,8)),8)
  into v_provisional from jsonb_array_elements(v_normalized)e
  join public.marketplace_order_items i on i.id=(e->>'order_item_id')::uuid;
  if v_input_count=v_order_item_count and v_creator_count=1 and v_bps_count=1 then
    select round(sum(i.line_total)*(min((e->>'commission_bps')::integer))/10000.0,8)
    into v_target from jsonb_array_elements(v_normalized)e
    join public.marketplace_order_items i on i.id=(e->>'order_item_id')::uuid;
    v_residual:=v_target-v_provisional;
  end if;
  insert into public.marketplace_order_item_creator_allocations(
    id,checkout_id,order_id,order_item_id,payment_id,payment_allocation_id,seller_id,store_id,
    creator_user_id,currency,commission_bps,commission_base_amount,commission_amount,
    idempotency_key,request_fingerprint)
  select gen_random_uuid(),o.checkout_id,o.id,i.id,p.id,a.id,o.seller_id,o.store_id,
    (e->>'creator_user_id')::uuid,'BDAG',(e->>'commission_bps')::integer,i.line_total,
    round(i.line_total*(e->>'commission_bps')::integer/10000.0,8)
      +case when i.id=v_max_item then v_residual else 0 end,
    p_idempotency_key,v_fingerprint
  from jsonb_array_elements(v_normalized)e
  join public.marketplace_order_items i on i.id=(e->>'order_item_id')::uuid
  order by i.id;
  select round(sum(commission_amount),8),count(distinct creator_user_id)
  into v_total,v_creator_count from public.marketplace_order_item_creator_allocations
  where order_id=o.id;
  if v_creator_count=1 then
    select creator_user_id into v_creator from public.marketplace_order_item_creator_allocations
    where order_id=o.id order by creator_user_id limit 1;
  end if;
  if v_total<=0 or v_total>a.gross_amount-a.platform_fee_amount then
    raise exception using errcode='23514',message='marketplace_creator_allocation_economic_integrity_error';
  end if;
  perform set_config('app.marketplace_multi_creator_allocation','on',true);
  update public.marketplace_payment_allocations set creator_commission_amount=v_total,
    creator_user_id=case when v_creator_count=1 then v_creator else null end,
    seller_net_amount=gross_amount-platform_fee_amount-v_total where id=a.id;
  return public.marketplace_item_creator_allocation_receipt(o.id);
end$$;

revoke all on table public.marketplace_order_item_creator_allocations from public,anon,authenticated,service_role;
grant select on table public.marketplace_order_item_creator_allocations to service_role;

revoke all on function public.apply_marketplace_order_item_creator_allocations(uuid,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.apply_marketplace_order_item_creator_allocations(uuid,jsonb,uuid)
  to service_role;
revoke all on function public.marketplace_item_creator_allocation_receipt(uuid)
  from public,anon,authenticated;
grant execute on function public.marketplace_item_creator_allocation_receipt(uuid) to service_role;
revoke all on function public.marketplace_create_order_settlement_b7f(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.reconcile_marketplace_multi_creator_allocations()
  from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_multi_creator_allocations() to service_role;
revoke all on function public.marketplace_reject_item_creator_allocation_mutation()
  from public,anon,authenticated;
