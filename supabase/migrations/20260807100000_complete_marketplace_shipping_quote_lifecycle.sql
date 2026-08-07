begin;

-- A shipping quote is frozen for the checkout's 15-minute reservation window.
-- Profile edits after reservation do not reprice that checkout. Payment validates
-- only the immutable snapshot, expiry, and checkout arithmetic; a new checkout
-- obtains a new authoritative quote.
create or replace function public.validate_marketplace_checkout_shipping_snapshot(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_checkout_sessions; snapshot_total numeric(20,8); physical_orders integer; snapshot_orders integer;
begin
  select * into c from public.marketplace_checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_checkout_not_found';end if;
  if c.status='expired' or c.expires_at<=now() then raise exception using errcode='22023',message='marketplace_checkout_expired';end if;
  if c.status<>'pending_payment' then raise exception using errcode='22023',message='marketplace_checkout_not_payable';end if;

  select count(distinct o.id) into physical_orders from public.marketplace_orders o
  join public.marketplace_order_items i on i.order_id=o.id join public.products p on p.id=i.product_id
  where o.checkout_id=c.id and p.product_type='physical';
  select count(distinct s.order_id),coalesce(round(sum(s.shipping_price),8),0) into snapshot_orders,snapshot_total
  from public.marketplace_order_shipping_snapshots s where s.checkout_id=c.id;
  if physical_orders<>snapshot_orders or exists(
    select 1 from public.marketplace_order_shipping_snapshots s where s.checkout_id=c.id and
      (s.profile_id is null or s.matched_rule_id is null or s.destination_country is null or
       s.quote_fingerprint is null or s.quote_fingerprint!~'^[0-9a-f]{64}$' or s.quoted_at is null or
       s.shipping_price<0 or s.processing_days_min>s.processing_days_max or s.transit_days_min>s.transit_days_max)
  ) or snapshot_total<>c.shipping_amount or exists(
    select 1 from public.marketplace_orders o where o.checkout_id=c.id and o.shipping_amount<>
      coalesce((select round(sum(s.shipping_price),8) from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),0)
  ) or c.total<>round(c.subtotal+c.shipping_amount,8) then
    raise exception using errcode='23514',message='marketplace_shipping_quote_stale';
  end if;
  return jsonb_build_object('valid',true,'checkout_id',c.id,'expires_at',c.expires_at,
    'shipping_amount',c.shipping_amount,'snapshot_count',snapshot_orders,'policy','frozen_until_expiry');
end$$;

alter function public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid)
  rename to pay_marketplace_checkout_with_bdag_canonical_internal;
revoke all on function public.pay_marketplace_checkout_with_bdag_canonical_internal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pay_marketplace_checkout_with_bdag_canonical_internal(uuid,uuid,uuid) to service_role;

create function public.pay_marketplace_checkout_with_bdag(p_buyer_id uuid,p_checkout_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_checkout_sessions;
begin
  select * into c from public.marketplace_checkout_sessions where id=p_checkout_id for update;
  if found and c.status='pending_payment' then perform public.validate_marketplace_checkout_shipping_snapshot(p_checkout_id);end if;
  return public.pay_marketplace_checkout_with_bdag_canonical_internal(p_buyer_id,p_checkout_id,p_idempotency_key);
end$$;

revoke all on function public.validate_marketplace_checkout_shipping_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.validate_marketplace_checkout_shipping_snapshot(uuid) to service_role;
revoke all on function public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pay_marketplace_checkout_with_bdag(uuid,uuid,uuid) to service_role;

create or replace function public.marketplace_checkout_response(p_checkout_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'checkout',jsonb_build_object('id',c.id,'reference',c.reference,'status',c.status,'currency',c.currency,
   'subtotal',c.subtotal,'shipping_amount',c.shipping_amount,'total',c.total,'expires_at',c.expires_at,'created_at',c.created_at,
   'shipping_quote_policy','frozen_until_expiry'),
 'shipping_address',jsonb_build_object('recipient_name',a.recipient_name,'line1',a.line1,'line2',a.line2,
   'city',a.city,'region',a.region,'postal_code',a.postal_code,'country',a.country,'phone',a.phone),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,
   'seller_id',o.seller_id,'store_id',o.store_id,'status',o.status,'subtotal',o.subtotal,'shipping_amount',o.shipping_amount,'total',o.total,
   'reservation_expires_at',o.reservation_expires_at,'frozen_shipping',coalesce((select jsonb_agg(jsonb_build_object(
     'shipping_profile_id',s.profile_id,'matched_rule_id',s.matched_rule_id,'country_code',s.destination_country,'region_code',s.destination_region,
     'shipping_amount',s.shipping_price,'currency','BDAG','processing_days_min',s.processing_days_min,'processing_days_max',s.processing_days_max,
     'transit_days_min',s.transit_days_min,'transit_days_max',s.transit_days_max,'quote_timestamp',s.quoted_at,
     'quote_fingerprint',s.quote_fingerprint,'quantity_policy','per_order_profile')) from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'variant_id',i.variant_id,
     'product_title',i.product_title,'variant_title',i.variant_title,'sku',i.sku,'options',i.option_snapshot,'image_url',i.image_url,
     'currency',i.currency,'unit_price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total,'reservation_status',r.status) order by i.created_at)
     from public.marketplace_order_items i join public.marketplace_inventory_reservations r on r.order_item_id=i.id where i.order_id=o.id),'[]'::jsonb)) order by o.created_at)
   from public.marketplace_orders o where o.checkout_id=c.id),'[]'::jsonb))
from public.marketplace_checkout_sessions c join public.marketplace_checkout_shipping_addresses a on a.checkout_id=c.id where c.id=p_checkout_id;
$$;

revoke all on function public.marketplace_checkout_response(uuid) from public,anon,authenticated;
grant execute on function public.marketplace_checkout_response(uuid) to service_role;

commit;
