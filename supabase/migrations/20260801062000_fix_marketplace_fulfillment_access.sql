begin;

revoke select on public.marketplace_order_shipments from public,anon,authenticated;
revoke select on public.marketplace_order_events from public,anon,authenticated;

create or replace function public.fetch_my_marketplace_order(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 select * into o from public.marketplace_orders where id=p_order_id;
 if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
 if o.buyer_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_found';end if;
 if not exists(select 1 from public.marketplace_checkout_sessions c join public.marketplace_payments p on p.checkout_id=c.id where c.id=o.checkout_id and c.status='paid' and p.status='paid') then raise exception using errcode='42501',message='marketplace_order_not_paid';end if;
 return public.marketplace_order_detail_response(o.id,'buyer');
end $$;

create or replace function public.fetch_my_marketplace_sale(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 select * into o from public.marketplace_orders where id=p_order_id;
 if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
 if o.seller_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
 if not exists(select 1 from public.marketplace_stores where id=o.store_id and seller_id=auth.uid() and status='active') then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 if not exists(select 1 from public.marketplace_checkout_sessions c join public.marketplace_payments p on p.checkout_id=c.id and p.status='paid' where c.id=o.checkout_id and c.status='paid') then raise exception using errcode='42501',message='marketplace_order_not_paid';end if;
 if not exists(select 1 from public.marketplace_payment_allocations where order_id=o.id and seller_id=auth.uid() and status='held') then raise exception using errcode='42501',message='marketplace_order_not_fulfillable';end if;
 return public.marketplace_order_detail_response(o.id,'seller');
end $$;

create or replace function public.fetch_my_marketplace_sales(p_status text default null,p_limit integer default 20,p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);v_store uuid;begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
 select id into v_store from public.marketplace_stores where seller_id=auth.uid() and status='active';if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 if p_status is not null and p_status not in ('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
 return coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id desc) from (select o.created_at,o.id,jsonb_build_object('id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,'status',o.status,'store_id',o.store_id,'store_name',s.name,'total',o.total,'currency',o.currency,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'recipient_name',sa.recipient_name,'city',sa.city,'region',sa.region,'country',sa.country,'distinct_lines',(select count(*) from public.marketplace_order_items i where i.order_id=o.id),'total_quantity',(select sum(i.quantity) from public.marketplace_order_items i where i.order_id=o.id),'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'allocation_status',a.status,'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number) row from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid' join public.marketplace_stores s on s.id=o.store_id join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id join public.marketplace_payment_allocations a on a.order_id=o.id and a.status='held' left join public.marketplace_order_shipments sh on sh.order_id=o.id where o.seller_id=auth.uid() and o.store_id=v_store and (p_status is null or o.status=p_status) and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id)) order by o.created_at desc,o.id desc limit v_limit)x),'[]'::jsonb);end $$;

revoke all on function public.fetch_my_marketplace_order(uuid),public.fetch_my_marketplace_sale(uuid),public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order(uuid),public.fetch_my_marketplace_sale(uuid),public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) to authenticated,service_role;
commit;
