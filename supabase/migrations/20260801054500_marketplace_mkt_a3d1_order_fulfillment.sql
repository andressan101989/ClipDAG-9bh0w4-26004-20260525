begin;

alter table public.marketplace_orders
  add column processing_at timestamptz,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column fulfillment_updated_at timestamptz,
  add column fulfillment_version bigint not null default 0,
  add constraint marketplace_orders_fulfillment_version_check check(fulfillment_version>=0),
  add constraint marketplace_orders_fulfillment_state_check check(
    (status in ('pending_payment','confirmed','cancelled','expired') and processing_at is null and shipped_at is null and delivered_at is null) or
    (status='processing' and processing_at is not null and shipped_at is null and delivered_at is null) or
    (status='shipped' and processing_at is not null and shipped_at is not null and delivered_at is null) or
    (status='delivered' and processing_at is not null and shipped_at is not null and delivered_at is not null) or
    (status in ('refunded','partially_refunded'))
  );

create index marketplace_orders_seller_fulfillment_idx on public.marketplace_orders(seller_id,status,created_at desc,id desc);

create table public.marketplace_order_events(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.marketplace_orders(id) on delete restrict,
 checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
 buyer_id uuid not null references auth.users(id) on delete restrict, seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
 store_id uuid not null references public.marketplace_stores(id) on delete restrict, event_type text not null,
 from_status text, to_status text, actor_id uuid, actor_role text not null, reason_code text,
 metadata jsonb not null default '{}'::jsonb, idempotency_key uuid, created_at timestamptz not null default now(),
 constraint marketplace_order_events_type_check check(event_type in ('order_confirmed','processing_started','shipment_created','shipment_updated','order_shipped','delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened')),
 constraint marketplace_order_events_role_check check(actor_role in ('system','buyer','seller','admin')),
 constraint marketplace_order_events_metadata_check check(jsonb_typeof(metadata)='object'),
 constraint marketplace_order_events_transition_check check(
   (event_type='order_confirmed' and to_status='confirmed') or
   (event_type='processing_started' and from_status='confirmed' and to_status='processing') or
   (event_type in ('shipment_created','order_shipped') and from_status='processing' and to_status='shipped') or
   event_type in ('shipment_updated','delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened'))
);
create unique index marketplace_order_events_command_unique on public.marketplace_order_events(order_id,actor_id,idempotency_key) where idempotency_key is not null;
create index marketplace_order_events_order_idx on public.marketplace_order_events(order_id,created_at,id);

create table public.marketplace_order_shipments(
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.marketplace_orders(id) on delete restrict,
 checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
 seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
 store_id uuid not null references public.marketplace_stores(id) on delete restrict,
 status text not null default 'shipped', carrier_name text not null, service_level text, tracking_number text not null,
 tracking_url text, seller_note text, shipped_at timestamptz not null, delivered_at timestamptz,
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint marketplace_shipments_status_check check(status in ('shipped','delivered','exception','returned')),
 constraint marketplace_shipments_carrier_check check(carrier_name=btrim(carrier_name) and char_length(carrier_name) between 2 and 100),
 constraint marketplace_shipments_service_check check(service_level is null or (service_level=btrim(service_level) and char_length(service_level) between 1 and 100)),
 constraint marketplace_shipments_tracking_check check(tracking_number=btrim(tracking_number) and char_length(tracking_number) between 2 and 120),
 constraint marketplace_shipments_url_check check(tracking_url is null or tracking_url ~ '^https://[^[:space:]]+$'),
 constraint marketplace_shipments_note_check check(seller_note is null or char_length(seller_note)<=500),
 constraint marketplace_shipments_delivery_check check((status='delivered' and delivered_at is not null) or (status<>'delivered' and delivered_at is null))
);
create trigger marketplace_shipments_set_updated_at before update on public.marketplace_order_shipments for each row execute function public.marketplace_set_updated_at();

insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,to_status,actor_role,created_at)
select o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'order_confirmed','confirmed','system',coalesce(o.confirmed_at,o.updated_at)
from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
where o.status in ('confirmed','processing','shipped','delivered') and not exists(select 1 from public.marketplace_order_events e where e.order_id=o.id and e.event_type='order_confirmed');

create or replace function public.marketplace_reject_fulfillment_audit_mutation() returns trigger language plpgsql set search_path=public as $$ begin raise exception using errcode='42501',message='marketplace_fulfillment_audit_immutable'; end $$;
create trigger marketplace_order_events_append_only before update or delete on public.marketplace_order_events for each row execute function public.marketplace_reject_fulfillment_audit_mutation();

create or replace function public.marketplace_order_detail_response(p_order_id uuid,p_role text) returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('order',jsonb_build_object('id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,'status',o.status,'currency',o.currency,'total',o.total,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'fulfillment_version',o.fulfillment_version),
 'store',jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug),
 'payment',jsonb_build_object('status',p.status,'paid_at',p.paid_at),
 'allocation',case when p_role='seller' then jsonb_build_object('gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'status',a.status) else null end,
 'shipping_address',jsonb_build_object('recipient_name',sa.recipient_name,'line1',sa.line1,'line2',sa.line2,'city',sa.city,'region',sa.region,'postal_code',sa.postal_code,'country',sa.country,'phone',sa.phone),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_title',i.product_title,'variant_title',i.variant_title,'sku',i.sku,'options',i.option_snapshot,'image_url',i.image_url,'unit_price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total) order by i.created_at) from public.marketplace_order_items i where i.order_id=o.id),'[]'::jsonb),
 'shipment',(select jsonb_build_object('id',sh.id,'status',sh.status,'carrier_name',sh.carrier_name,'service_level',sh.service_level,'tracking_number',sh.tracking_number,'tracking_url',sh.tracking_url,'seller_note',case when p_role='seller' then sh.seller_note else null end,'shipped_at',sh.shipped_at) from public.marketplace_order_shipments sh where sh.order_id=o.id),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'from_status',e.from_status,'to_status',e.to_status,'actor_role',e.actor_role,'created_at',e.created_at) order by e.created_at,e.id) from public.marketplace_order_events e where e.order_id=o.id),'[]'::jsonb),
 'escrow_protected',a.status='held')
from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id join public.marketplace_stores s on s.id=o.store_id
join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id join public.marketplace_payments p on p.checkout_id=o.checkout_id
join public.marketplace_payment_allocations a on a.order_id=o.id where o.id=p_order_id;
$$;

create or replace function public.fetch_my_marketplace_order(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_orders where id=p_order_id and buyer_id=auth.uid()) then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
 return public.marketplace_order_detail_response(p_order_id,'buyer'); end $$;

create or replace function public.fetch_my_marketplace_sale(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id where o.id=p_order_id and o.seller_id=auth.uid() and c.status='paid') then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
 return public.marketplace_order_detail_response(p_order_id,'seller'); end $$;

create or replace function public.fetch_my_marketplace_orders(p_status text default null,p_limit integer default 20,p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if p_status is not null and p_status not in ('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
 return coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id desc) from (select o.created_at,o.id,jsonb_build_object('id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,'status',o.status,'store_id',o.store_id,'store_name',s.name,'total',o.total,'currency',o.currency,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'first_item_title',(select i.product_title from public.marketplace_order_items i where i.order_id=o.id order by i.created_at limit 1),'first_item_image',(select i.image_url from public.marketplace_order_items i where i.order_id=o.id order by i.created_at limit 1),'distinct_lines',(select count(*) from public.marketplace_order_items i where i.order_id=o.id),'total_quantity',(select sum(i.quantity) from public.marketplace_order_items i where i.order_id=o.id),'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number,'payment_status',p.status) row from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id join public.marketplace_stores s on s.id=o.store_id join public.marketplace_payments p on p.checkout_id=o.checkout_id left join public.marketplace_order_shipments sh on sh.order_id=o.id where o.buyer_id=auth.uid() and (p_status is null or o.status=p_status) and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id)) order by o.created_at desc,o.id desc limit v_limit)x),'[]'::jsonb);end $$;

create or replace function public.fetch_my_marketplace_sales(p_status text default null,p_limit integer default 20,p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);begin
 if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
 return coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id desc) from (select o.created_at,o.id,jsonb_build_object('id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,'status',o.status,'store_id',o.store_id,'store_name',s.name,'total',o.total,'currency',o.currency,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'recipient_name',sa.recipient_name,'city',sa.city,'region',sa.region,'country',sa.country,'distinct_lines',(select count(*) from public.marketplace_order_items i where i.order_id=o.id),'total_quantity',(select sum(i.quantity) from public.marketplace_order_items i where i.order_id=o.id),'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'allocation_status',a.status,'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number) row from public.marketplace_orders o join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid' join public.marketplace_stores s on s.id=o.store_id join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id join public.marketplace_payment_allocations a on a.order_id=o.id left join public.marketplace_order_shipments sh on sh.order_id=o.id where o.seller_id=auth.uid() and (p_status is null or o.status=p_status) and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id)) order by o.created_at desc,o.id desc limit v_limit)x),'[]'::jsonb);end $$;

create or replace function public.seller_start_marketplace_order_processing(p_order_id uuid,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public as $$ declare o public.marketplace_orders;begin
 if auth.uid() is null or p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_invalid_fulfillment_command';end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-fulfillment:'||p_order_id::text,0)); select * into o from public.marketplace_orders where id=p_order_id for update;
 if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;if o.seller_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using message='marketplace_seller_not_approved';end if;
 if not exists(select 1 from public.marketplace_stores where id=o.store_id and status='active') then raise exception using message='marketplace_store_inactive';end if;
 if o.status in ('processing','shipped','delivered') then return public.marketplace_order_detail_response(o.id,'seller');end if;
 if o.status<>'confirmed' or not exists(select 1 from public.marketplace_checkout_sessions c join public.marketplace_payments p on p.checkout_id=c.id join public.marketplace_payment_allocations a on a.order_id=o.id and a.status='held' where c.id=o.checkout_id and c.status='paid' and p.status='paid') then raise exception using message='marketplace_order_not_fulfillable';end if;
 update public.marketplace_orders set status='processing',processing_at=now(),fulfillment_updated_at=now(),fulfillment_version=fulfillment_version+1 where id=o.id;
 insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,idempotency_key) values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'processing_started','confirmed','processing',auth.uid(),'seller',p_idempotency_key) on conflict do nothing;
 return public.marketplace_order_detail_response(o.id,'seller');end $$;

create or replace function public.seller_ship_marketplace_order(p_order_id uuid,p_carrier_name text,p_service_level text,p_tracking_number text,p_tracking_url text,p_seller_note text,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public as $$ declare o public.marketplace_orders;v_carrier text:=btrim(coalesce(p_carrier_name,''));v_service text:=nullif(btrim(coalesce(p_service_level,'')),'');v_tracking text:=btrim(coalesce(p_tracking_number,''));v_url text:=nullif(btrim(coalesce(p_tracking_url,'')),'');v_note text:=nullif(btrim(coalesce(p_seller_note,'')),'');v_hash text;v_existing text;begin
 if auth.uid() is null or p_idempotency_key is null or char_length(v_carrier) not between 2 and 100 or char_length(v_tracking) not between 2 and 120 or char_length(coalesce(v_service,''))>100 or char_length(coalesce(v_note,''))>500 or (v_url is not null and v_url!~'^https://[^[:space:]]+$') then raise exception using errcode='22023',message='marketplace_invalid_shipment';end if;
 v_hash:=encode(extensions.digest(concat_ws('|',v_carrier,v_service,v_tracking,v_url,v_note),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended('marketplace-fulfillment:'||p_order_id::text,0));select * into o from public.marketplace_orders where id=p_order_id for update;
 if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;if o.seller_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 select reason_code into v_existing from public.marketplace_order_events where order_id=o.id and actor_id=auth.uid() and idempotency_key=p_idempotency_key;
 if found and v_existing<>v_hash then raise exception using errcode='23505',message='marketplace_fulfillment_idempotency_conflict';end if;
 if o.status in ('shipped','delivered') then return public.marketplace_order_detail_response(o.id,'seller');end if;
 if o.status<>'processing' or not exists(select 1 from public.marketplace_sellers se join public.marketplace_stores st on st.seller_id=se.user_id and st.id=o.store_id join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid' join public.marketplace_payments p on p.checkout_id=c.id and p.status='paid' join public.marketplace_payment_allocations a on a.order_id=o.id and a.status='held' where se.user_id=auth.uid() and se.status='approved' and st.status='active') then raise exception using message='marketplace_order_not_fulfillable';end if;
 insert into public.marketplace_order_shipments(order_id,checkout_id,seller_id,store_id,carrier_name,service_level,tracking_number,tracking_url,seller_note,shipped_at,created_by) values(o.id,o.checkout_id,o.seller_id,o.store_id,v_carrier,v_service,v_tracking,v_url,v_note,now(),auth.uid());
 update public.marketplace_orders set status='shipped',shipped_at=now(),fulfillment_updated_at=now(),fulfillment_version=fulfillment_version+1 where id=o.id;
 insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,reason_code,idempotency_key) values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'order_shipped','processing','shipped',auth.uid(),'seller',v_hash,p_idempotency_key);
 return public.marketplace_order_detail_response(o.id,'seller');end $$;

alter table public.marketplace_order_events enable row level security;alter table public.marketplace_order_shipments enable row level security;
create policy marketplace_order_events_participant_read on public.marketplace_order_events for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid());
create policy marketplace_shipments_participant_read on public.marketplace_order_shipments for select to authenticated using(exists(select 1 from public.marketplace_orders o where o.id=order_id and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
revoke all on public.marketplace_order_events,public.marketplace_order_shipments from public,anon,authenticated;grant select on public.marketplace_order_events,public.marketplace_order_shipments to authenticated;
revoke all on function public.marketplace_order_detail_response(uuid,text),public.fetch_my_marketplace_order(uuid),public.fetch_my_marketplace_sale(uuid),public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid),public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid),public.seller_start_marketplace_order_processing(uuid,uuid),public.seller_ship_marketplace_order(uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order(uuid),public.fetch_my_marketplace_sale(uuid),public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid),public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid),public.seller_start_marketplace_order_processing(uuid,uuid),public.seller_ship_marketplace_order(uuid,text,text,text,text,text,uuid) to authenticated,service_role;
grant execute on function public.marketplace_order_detail_response(uuid,text) to service_role;

commit;
