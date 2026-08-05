begin;

-- Preserve the existing authoritative payment implementation while extending its
-- integrity equation to the shipping amount frozen by the checkout transaction.
create or replace function public.pay_marketplace_checkout_with_bdag(p_buyer_id uuid,p_checkout_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_checkout_sessions; p public.marketplace_payments; r record; o record;
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
 if c.currency<>'BDAG' or v_total<>c.subtotal or c.total<>round(c.subtotal+c.shipping_amount,8)
   or exists(select 1 from public.marketplace_order_items where checkout_id=c.id and line_total<>round(unit_price*quantity,8)) then
   raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
 for o in select * from public.marketplace_orders where checkout_id=c.id order by id loop
   select round(sum(line_total),8) into v_order_total from public.marketplace_order_items where order_id=o.id;
   if v_order_total<>o.subtotal or o.total<>round(o.subtotal+o.shipping_amount,8) or o.currency<>'BDAG' then
     raise exception using errcode='23514',message='marketplace_checkout_integrity_error';end if;
 end loop;
 v_total:=c.total;
 select fee_bps into strict v_fee_bps from public.marketplace_fee_settings where singleton;
 v_buyer_account:=public.ensure_ledger_account(p_buyer_id);v_escrow_account:=public.ensure_marketplace_escrow_account();
 perform 1 from public.ledger_accounts where id in(v_buyer_account,v_escrow_account) order by id for update;
 select balance into v_buyer_balance from public.ledger_accounts where id=v_buyer_account and not frozen;
 if v_buyer_balance is null or v_buyer_balance<v_total then raise exception using errcode='P0001',message='marketplace_insufficient_bdag_balance',detail=jsonb_build_object('required',v_total,'available',coalesce(v_buyer_balance,0))::text;end if;
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

revoke all on function public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid) to service_role;

commit;
