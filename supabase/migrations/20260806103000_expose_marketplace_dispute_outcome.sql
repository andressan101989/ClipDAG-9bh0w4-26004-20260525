begin;

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
  'dispute',(select jsonb_build_object('status',d.status,'reason_code',d.reason_code,'created_at',d.created_at,
    'outcome',x.outcome,'decided_at',x.decided_at)
   from public.marketplace_order_disputes d left join public.marketplace_dispute_decisions x on x.dispute_id=d.id
   where d.order_id=o.id order by d.created_at desc limit 1)
 );
end$$;

revoke all on function public.fetch_my_marketplace_order_lifecycle(uuid)from public,anon;
grant execute on function public.fetch_my_marketplace_order_lifecycle(uuid)to authenticated,service_role;

commit;
