begin;

alter table public.ledger_accounts drop constraint ledger_accounts_account_type_check;
alter table public.ledger_accounts add constraint ledger_accounts_account_type_check
  check(account_type in ('user','escrow','treasury','platform','marketplace_escrow'));

alter table public.marketplace_inventory_movements drop constraint marketplace_inventory_movement_type_check;
alter table public.marketplace_inventory_movements add constraint marketplace_inventory_movement_type_check
  check(movement_type in ('backfill','initial','seller_set','seller_adjust','correction','sale'));

alter table public.marketplace_inventory_reservations
  add column consumed_at timestamptz,
  add column payment_id uuid;

create table public.marketplace_fee_settings(
  singleton boolean primary key default true check(singleton),
  fee_bps integer not null default 1000 check(fee_bps between 0 and 5000),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
insert into public.marketplace_fee_settings(singleton,fee_bps) values(true,1000);

create table public.marketplace_payments(
  id uuid primary key default gen_random_uuid(),checkout_id uuid not null unique references public.marketplace_checkout_sessions(id),
  buyer_id uuid not null references auth.users(id),status text not null default 'paid' check(status in ('paid','partially_refunded','refunded')),
  currency text not null default 'BDAG' check(currency='BDAG'),gross_amount numeric(20,8) not null,
  escrow_amount numeric(20,8) not null,fee_bps integer not null check(fee_bps between 0 and 5000),
  financial_transaction_id uuid not null unique references public.financial_transactions(id),idempotency_key uuid not null,
  request_fingerprint text not null,paid_at timestamptz not null,refunded_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(gross_amount>0 and gross_amount=round(gross_amount,8) and escrow_amount=gross_amount),
  check((status='paid' and refunded_at is null) or (status<>'paid' and refunded_at is not null)),unique(buyer_id,idempotency_key)
);

create table public.marketplace_payment_allocations(
  id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.marketplace_payments(id),
  checkout_id uuid not null references public.marketplace_checkout_sessions(id),order_id uuid not null unique references public.marketplace_orders(id),
  seller_id uuid not null references public.marketplace_sellers(user_id),store_id uuid not null references public.marketplace_stores(id),
  currency text not null default 'BDAG' check(currency='BDAG'),gross_amount numeric(20,8) not null,
  platform_fee_amount numeric(20,8) not null,seller_net_amount numeric(20,8) not null,
  fee_bps integer not null check(fee_bps between 0 and 5000),status text not null default 'held' check(status in ('held','released','partially_refunded','refunded')),
  released_at timestamptz,refunded_at timestamptz,created_at timestamptz not null default now(),
  check(gross_amount>0 and platform_fee_amount>=0 and seller_net_amount>=0),
  check(gross_amount=round(gross_amount,8) and platform_fee_amount=round(platform_fee_amount,8) and seller_net_amount=round(seller_net_amount,8)),
  check(gross_amount=platform_fee_amount+seller_net_amount),unique(payment_id,order_id)
);
alter table public.marketplace_inventory_reservations add constraint marketplace_reservations_payment_fk foreign key(payment_id) references public.marketplace_payments(id);
alter table public.marketplace_inventory_reservations add constraint marketplace_reservations_consumed_check check(
  (status='consumed' and consumed_at is not null and payment_id is not null and released_at is null) or
  (status<>'consumed' and consumed_at is null and payment_id is null));

create or replace function public.ensure_marketplace_escrow_account() returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
    values(null,'marketplace_escrow','BDAG',0,false) on conflict on constraint ledger_accounts_system_unique do nothing;
  select id into strict v_id from public.ledger_accounts where owner_id is null and account_type='marketplace_escrow';
  return v_id;
end;$$;

create or replace function public.marketplace_payment_receipt(p_payment_id uuid) returns jsonb
language sql security definer stable set search_path=public as $$
select jsonb_build_object(
 'payment',jsonb_build_object('id',p.id,'checkout_id',p.checkout_id,'status',p.status,'currency',p.currency,'gross_amount',p.gross_amount,
   'escrow_amount',p.escrow_amount,'fee_bps',p.fee_bps,'financial_transaction_id',p.financial_transaction_id,'paid_at',p.paid_at),
 'checkout',jsonb_build_object('id',c.id,'reference',c.reference,'status',c.status,'total',c.total,'currency',c.currency),
 'buyer',jsonb_build_object('new_bdag_balance',(select balance from public.ledger_accounts where owner_id=p.buyer_id and account_type='user')),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'gross_amount',a.gross_amount,
   'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'allocation_status',a.status) order by o.id)
   from public.marketplace_orders o join public.marketplace_payment_allocations a on a.order_id=o.id where o.checkout_id=p.checkout_id),'[]'::jsonb),
 'inventory',jsonb_build_object('consumed_reservations',(select count(*) from public.marketplace_inventory_reservations r where r.payment_id=p.id and r.status='consumed'),
   'units_consumed',coalesce((select sum(quantity) from public.marketplace_inventory_reservations r where r.payment_id=p.id and r.status='consumed'),0)))
from public.marketplace_payments p join public.marketplace_checkout_sessions c on c.id=p.checkout_id where p.id=p_payment_id;
$$;

create or replace function public.pay_marketplace_checkout_with_bdag(p_buyer_id uuid,p_checkout_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_checkout_sessions; p public.marketplace_payments; r record; o record; i record;
 v_fingerprint text;v_fee_bps integer;v_total numeric(20,8);v_order_total numeric(20,8);v_fee numeric(20,8);
 v_buyer_account uuid;v_escrow_account uuid;v_buyer_balance numeric;v_escrow_balance numeric;v_fin uuid:=gen_random_uuid();v_payment uuid:=gen_random_uuid();
 v_previous_on_hand integer;v_previous_reserved integer;v_products uuid[]:='{}';v_order_items integer;v_reservations integer;
begin
 if p_buyer_id is null or p_checkout_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_payment_invalid_input';end if;
 v_fingerprint:=pg_catalog.encode(extensions.digest(p_checkout_id::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_buyer_id::text||':marketplace-payment:'||p_idempotency_key::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-payment-checkout:'||p_checkout_id::text,0));
 select * into c from public.marketplace_checkout_sessions where id=p_checkout_id for update;
 if not found or c.buyer_id<>p_buyer_id then raise exception using errcode='P0002',message='marketplace_checkout_not_found';end if;
 select * into p from public.marketplace_payments where buyer_id=p_buyer_id and idempotency_key=p_idempotency_key;
 if found then
   if p.checkout_id<>p_checkout_id or p.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='marketplace_payment_idempotency_conflict';end if;
   return public.marketplace_payment_receipt(p.id);
 end if;
 select * into p from public.marketplace_payments where checkout_id=p_checkout_id;
 if found then return public.marketplace_payment_receipt(p.id);end if;
 if c.status='cancelled' then raise exception using errcode='22023',message='marketplace_checkout_cancelled';end if;
 if c.status='expired' then raise exception using errcode='22023',message='marketplace_checkout_expired';end if;
 if c.status<>'pending_payment' then raise exception using errcode='22023',message='marketplace_checkout_not_payable';end if;
 if c.expires_at<=now() then
   perform public.marketplace_release_checkout(c.id,'expired','payment_attempt_after_expiry',p_buyer_id);
   return jsonb_build_object('error_code','marketplace_checkout_expired');
 end if;
 perform 1 from public.marketplace_orders where checkout_id=c.id order by id for update;
 perform 1 from public.marketplace_order_items where checkout_id=c.id order by variant_id for update;
 perform 1 from public.marketplace_inventory_reservations where checkout_id=c.id order by variant_id for update;
 perform 1 from public.marketplace_inventory_levels l join public.marketplace_inventory_reservations ir on ir.variant_id=l.variant_id
   where ir.checkout_id=c.id order by l.variant_id for update of l;
 select count(*) into v_order_items from public.marketplace_order_items where checkout_id=c.id;
 select count(*) into v_reservations from public.marketplace_inventory_reservations where checkout_id=c.id and status='active';
 if v_order_items=0 or v_order_items<>v_reservations or exists(select 1 from public.marketplace_order_items oi left join public.marketplace_inventory_reservations ir
   on ir.order_item_id=oi.id and ir.status='active' where oi.checkout_id=c.id and (ir.id is null or ir.quantity<>oi.quantity or ir.expires_at<>c.expires_at)) then
   raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
 select round(sum(line_total),8) into v_total from public.marketplace_order_items where checkout_id=c.id;
 if c.currency<>'BDAG' or v_total<>c.total or exists(select 1 from public.marketplace_order_items where checkout_id=c.id and line_total<>round(unit_price*quantity,8)) then
   raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
 for o in select * from public.marketplace_orders where checkout_id=c.id order by id loop
   select round(sum(line_total),8) into v_order_total from public.marketplace_order_items where order_id=o.id;
   if v_order_total<>o.total or o.currency<>'BDAG' then raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
 end loop;
 select fee_bps into strict v_fee_bps from public.marketplace_fee_settings where singleton;
 v_buyer_account:=public.ensure_ledger_account(p_buyer_id);v_escrow_account:=public.ensure_marketplace_escrow_account();
 perform 1 from public.ledger_accounts where id in(v_buyer_account,v_escrow_account) order by id for update;
 select balance into v_buyer_balance from public.ledger_accounts where id=v_buyer_account and not frozen;
 if v_buyer_balance is null or v_buyer_balance<v_total then raise exception using errcode='P0001',message='marketplace_insufficient_bdag_balance',
   detail=jsonb_build_object('required',v_total,'available',coalesce(v_buyer_balance,0))::text;end if;
 insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
   values(v_fin,v_buyer_account,v_escrow_account,'marketplace_payment_capture',v_total,0,'BDAG','completed','marketplace_checkout',c.id::text,p_idempotency_key::text,p_buyer_id);
 v_buyer_balance:=public.ledger_debit(v_fin,v_buyer_account,v_total,'Marketplace checkout '||c.reference,jsonb_build_object('fin_txn_id',v_fin,'checkout_id',c.id));
 v_escrow_balance:=public.ledger_credit(v_fin,v_escrow_account,v_total,'Marketplace checkout escrow '||c.reference,jsonb_build_object('fin_txn_id',v_fin,'checkout_id',c.id));
 insert into public.marketplace_payments(id,checkout_id,buyer_id,gross_amount,escrow_amount,fee_bps,financial_transaction_id,idempotency_key,request_fingerprint,paid_at)
   values(v_payment,c.id,p_buyer_id,v_total,v_total,v_fee_bps,v_fin,p_idempotency_key,v_fingerprint,now());
 for o in select * from public.marketplace_orders where checkout_id=c.id order by id loop
   v_fee:=round(o.total*v_fee_bps/10000.0,8);
   insert into public.marketplace_payment_allocations(payment_id,checkout_id,order_id,seller_id,store_id,gross_amount,platform_fee_amount,seller_net_amount,fee_bps)
     values(v_payment,c.id,o.id,o.seller_id,o.store_id,o.total,v_fee,o.total-v_fee,v_fee_bps);
 end loop;
 for r in select ir.*,v.product_id,v.seller_id from public.marketplace_inventory_reservations ir join public.marketplace_product_variants v on v.id=ir.variant_id
   where ir.checkout_id=c.id and ir.status='active' order by ir.variant_id loop
   select on_hand,reserved into v_previous_on_hand,v_previous_reserved from public.marketplace_inventory_levels where variant_id=r.variant_id;
   if v_previous_on_hand<r.quantity or v_previous_reserved<r.quantity then raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
   update public.marketplace_inventory_levels set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity,version=version+1 where variant_id=r.variant_id;
   update public.marketplace_inventory_reservations set status='consumed',consumed_at=now(),payment_id=v_payment where id=r.id and status='active';
   insert into public.marketplace_inventory_reservation_events(reservation_id,checkout_id,variant_id,event_type,quantity_delta,previous_reserved,resulting_reserved,reason,actor_id)
     values(r.id,c.id,r.variant_id,'consume',-r.quantity,v_previous_reserved,v_previous_reserved-r.quantity,'marketplace_payment',p_buyer_id);
   insert into public.marketplace_inventory_movements(variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,reason,idempotency_key,request_fingerprint,created_by)
     values(r.variant_id,r.seller_id,'sale',-r.quantity,v_previous_on_hand,v_previous_on_hand-r.quantity,'Marketplace checkout '||c.reference,r.id,v_fingerprint,p_buyer_id);
   v_products:=array_append(v_products,r.product_id);
 end loop;
 update public.marketplace_orders set status='confirmed',confirmed_at=now() where checkout_id=c.id and status='pending_payment';
 update public.marketplace_checkout_sessions set status='paid',updated_at=now() where id=c.id and status='pending_payment';
 for r in select distinct unnest(v_products) product_id loop perform public.refresh_marketplace_product_projection(r.product_id);end loop;
 return public.marketplace_payment_receipt(v_payment);
end;$$;

create or replace function public.marketplace_checkout_response(p_checkout_id uuid) returns jsonb
language sql security definer stable set search_path=public as $$
select jsonb_build_object('checkout',jsonb_build_object('id',c.id,'reference',c.reference,'status',c.status,'currency',c.currency,
 'subtotal',c.subtotal,'total',c.total,'expires_at',c.expires_at,'created_at',c.created_at,'paid_at',p.paid_at),
 'shipping_address',jsonb_build_object('recipient_name',a.recipient_name,'city',a.city,'region',a.region,'country',a.country),
 'payment',case when p.id is null then null else jsonb_build_object('id',p.id,'status',p.status,'currency',p.currency,'gross_amount',p.gross_amount,'fee_bps',p.fee_bps,'paid_at',p.paid_at) end,
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'seller_id',o.seller_id,'store_id',o.store_id,
 'status',o.status,'subtotal',o.subtotal,'total',o.total,'reservation_expires_at',o.reservation_expires_at,
 'allocation',case when pa.id is null then null else jsonb_build_object('status',pa.status,'gross_amount',pa.gross_amount,'platform_fee_amount',pa.platform_fee_amount,'seller_net_amount',pa.seller_net_amount) end,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'variant_id',i.variant_id,'product_title',i.product_title,
 'variant_title',i.variant_title,'sku',i.sku,'options',i.option_snapshot,'image_url',i.image_url,'currency',i.currency,'unit_price',i.unit_price,
 'quantity',i.quantity,'line_total',i.line_total,'reservation_status',r.status) order by i.created_at),'[]'::jsonb)
 from public.marketplace_order_items i join public.marketplace_inventory_reservations r on r.order_item_id=i.id where i.order_id=o.id)) order by o.created_at)
 from public.marketplace_orders o left join public.marketplace_payment_allocations pa on pa.order_id=o.id where o.checkout_id=c.id),'[]'::jsonb))
from public.marketplace_checkout_sessions c join public.marketplace_checkout_shipping_addresses a on a.checkout_id=c.id
left join public.marketplace_payments p on p.checkout_id=c.id where c.id=p_checkout_id and c.buyer_id=auth.uid();$$;

create or replace function public.reconcile_marketplace_payments() returns jsonb language sql security definer stable set search_path=public as $$
select jsonb_build_object(
 'paid_without_payment',(select count(*) from public.marketplace_checkout_sessions c left join public.marketplace_payments p on p.checkout_id=c.id where c.status='paid' and p.id is null),
 'payment_without_transaction',(select count(*) from public.marketplace_payments p left join public.financial_transactions f on f.id=p.financial_transaction_id where f.id is null),
 'unbalanced_transactions',(select count(*) from public.marketplace_payments p where (select coalesce(sum(case when entry_type='debit' then amount else -amount end),0) from public.ledger_entries where txn_id=p.financial_transaction_id)<>0),
 'allocation_mismatches',(select count(*) from public.marketplace_payments p where p.escrow_amount<>(select coalesce(sum(gross_amount),0) from public.marketplace_payment_allocations a where a.payment_id=p.id)),
 'paid_with_active_reservations',(select count(*) from public.marketplace_payments p join public.marketplace_inventory_reservations r on r.checkout_id=p.checkout_id where r.status='active'),
 'consumed_without_sale',(select count(*) from public.marketplace_inventory_reservations r left join public.marketplace_inventory_movements m on m.idempotency_key=r.id and m.movement_type='sale' where r.status='consumed' and m.id is null),
 'confirmed_state_mismatches',(select count(*) from public.marketplace_checkout_sessions c join public.marketplace_orders o on o.checkout_id=c.id where c.status='paid' and o.status<>'confirmed'),
 'invalid_inventory',(select count(*) from public.marketplace_inventory_levels where on_hand<0 or reserved<0 or reserved>on_hand),
 'escrow_shortfall',greatest((select coalesce(sum(gross_amount),0) from public.marketplace_payment_allocations where status='held')-
   (select coalesce(balance,0) from public.ledger_accounts where owner_id is null and account_type='marketplace_escrow'),0));$$;

alter table public.marketplace_fee_settings enable row level security;
alter table public.marketplace_payments enable row level security;
alter table public.marketplace_payment_allocations enable row level security;
create policy marketplace_payments_buyer_read on public.marketplace_payments for select to authenticated using(buyer_id=auth.uid());
create policy marketplace_allocations_buyer_read on public.marketplace_payment_allocations for select to authenticated using(exists(select 1 from public.marketplace_checkout_sessions c where c.id=checkout_id and c.buyer_id=auth.uid()));
create policy marketplace_allocations_seller_read on public.marketplace_payment_allocations for select to authenticated using(seller_id=auth.uid());
create trigger marketplace_payments_immutable before update or delete on public.marketplace_payments for each row execute function public.marketplace_reject_order_item_mutation();
create trigger marketplace_allocations_immutable before update or delete on public.marketplace_payment_allocations for each row execute function public.marketplace_reject_order_item_mutation();

revoke all on public.marketplace_fee_settings,public.marketplace_payments,public.marketplace_payment_allocations from public,anon,authenticated;
grant select on public.marketplace_payments,public.marketplace_payment_allocations to authenticated;
grant all on public.marketplace_fee_settings,public.marketplace_payments,public.marketplace_payment_allocations to service_role;
revoke all on function public.ensure_marketplace_escrow_account(),public.marketplace_payment_receipt(uuid),public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid),public.reconcile_marketplace_payments() from public,anon,authenticated;
grant execute on function public.ensure_marketplace_escrow_account(),public.marketplace_payment_receipt(uuid),public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid),public.reconcile_marketplace_payments() to service_role;
revoke all on function public.marketplace_checkout_response(uuid) from public,anon,authenticated;

commit;
