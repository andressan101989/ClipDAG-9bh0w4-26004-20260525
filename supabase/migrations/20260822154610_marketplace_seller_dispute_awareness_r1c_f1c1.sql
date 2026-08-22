-- R1C-F1C1: event-specific dispute history and seller active-dispute awareness.
begin;

create or replace function public.marketplace_order_detail_response(p_order_id uuid,p_role text)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'order',jsonb_build_object('id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,'status',o.status,'currency',o.currency,'total',o.total,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,'fulfillment_version',o.fulfillment_version),
  'store',jsonb_build_object('id',st.id,'name',st.name,'slug',st.slug),
  'payment',jsonb_build_object('status',p.status,'paid_at',p.paid_at),
  'allocation',case when p_role='seller' then jsonb_build_object('gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'status',a.status,'released_at',a.released_at) else null end,
  'settlement',case when se.id is null then null else jsonb_build_object('status',se.status,'gross_amount',se.gross_amount,'seller_net_amount',case when p_role='seller' then se.seller_net_amount else null end,'platform_fee_amount',case when p_role='seller' then se.platform_fee_amount else null end,'confirmed_at',se.confirmed_at,'released_at',se.released_at,'seller_bdag_balance',case when p_role='seller' then (select balance from public.ledger_accounts where owner_id=o.seller_id and account_type='user' and currency='BDAG') else null end) end,
  'shipping_address',jsonb_build_object('recipient_name',sa.recipient_name,'line1',sa.line1,'line2',sa.line2,'city',sa.city,'region',sa.region,'postal_code',sa.postal_code,'country',sa.country,'phone',sa.phone),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_title',i.product_title,'variant_title',i.variant_title,'sku',i.sku,'options',i.option_snapshot,'image_url',i.image_url,'unit_price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total) order by i.created_at) from public.marketplace_order_items i where i.order_id=o.id),'[]'::jsonb),
  'shipment',(select jsonb_build_object('id',case when p_role='seller' then sh.id else null end,'status',sh.status,'carrier_name',sh.carrier_name,'service_level',sh.service_level,'tracking_number',sh.tracking_number,'tracking_url',sh.tracking_url,'seller_note',case when p_role='seller' then sh.seller_note else null end,'shipped_at',sh.shipped_at,'delivered_at',sh.delivered_at) from public.marketplace_order_shipments sh where sh.order_id=o.id),
  'events',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',e.id,
      'event_type',e.event_type,
      'from_status',e.from_status,
      'to_status',e.to_status,
      'actor_role',e.actor_role,
      'dispute_outcome',case
        when e.event_type='dispute_resolved'
          and e.metadata->>'outcome' in('refund_buyer','release_seller','reject_claim')
        then e.metadata->>'outcome'
        else null
      end,
      'created_at',e.created_at
    ) order by e.created_at,e.id)
    from public.marketplace_order_events e where e.order_id=o.id
  ),'[]'::jsonb),
  'escrow_protected',a.status='held'
)
from public.marketplace_orders o
join public.marketplace_checkout_sessions c on c.id=o.checkout_id
join public.marketplace_stores st on st.id=o.store_id
join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id
join public.marketplace_payments p on p.checkout_id=o.checkout_id
join public.marketplace_payment_allocations a on a.order_id=o.id
left join public.marketplace_order_settlements se on se.order_id=o.id
where o.id=p_order_id;
$$;

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
  if p_status is not null and p_status not in ('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
  return coalesce((
    select jsonb_agg(x.row order by x.created_at desc,x.id desc)
    from (
      select o.created_at,o.id,jsonb_build_object(
        'id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,
        'status',o.status,'store_id',o.store_id,'store_name',st.name,'total',o.total,'currency',o.currency,
        'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,
        'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,'recipient_name',sa.recipient_name,
        'city',sa.city,'region',sa.region,'country',sa.country,
        'distinct_lines',(select count(*) from public.marketplace_order_items i where i.order_id=o.id),
        'total_quantity',(select sum(i.quantity) from public.marketplace_order_items i where i.order_id=o.id),
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
        )
      ) row
      from public.marketplace_orders o
      join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
      join public.marketplace_stores st on st.id=o.store_id
      join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id
      join public.marketplace_payment_allocations a on a.order_id=o.id
      left join public.marketplace_order_shipments sh on sh.order_id=o.id
      where o.seller_id=auth.uid() and o.store_id=v_store
        and (p_status is null or o.status=p_status)
        and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id))
      order by o.created_at desc,o.id desc limit v_limit
    )x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.fetch_my_marketplace_disputes(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_limit integer;v_store uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=auth.uid() and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_invalid_limit';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='marketplace_invalid_cursor';end if;
  v_limit:=p_limit;
  return (
    with scoped as(
      select d.id,d.status,d.reason_code,d.created_at,o.id order_id,o.order_number,o.status order_status,
        st.id store_id,st.name store_name,
        exists(select 1 from public.marketplace_dispute_seller_responses sr where sr.dispute_id=d.id) seller_response_submitted,
        (select count(*) from public.marketplace_dispute_items di where di.dispute_id=d.id) affected_item_count,
        (select count(*) from public.media_asset_links ml where ml.entity_type='marketplace_dispute' and ml.entity_id=d.id and ml.slot='buyer_evidence') buyer_evidence_count
      from public.marketplace_order_disputes d
      join public.marketplace_orders o on o.id=d.order_id and o.seller_id=auth.uid()
      join public.marketplace_stores st on st.id=o.store_id and st.id=v_store
      where d.seller_id=auth.uid() and d.status in('open','under_review')
    ),paged as(
      select * from scoped
      where p_before_created_at is null or (created_at,id)<(p_before_created_at,p_before_id)
      order by created_at desc,id desc limit v_limit+1
    ),selected as(
      select * from paged order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'active_count',(select count(*) from scoped),
      'open_count',(select count(*) from scoped where status='open'),
      'under_review_count',(select count(*) from scoped where status='under_review'),
      'disputes',coalesce((select jsonb_agg(jsonb_build_object(
        'dispute_id',id,'status',status,'reason_code',reason_code,'created_at',created_at,
        'order_id',order_id,'order_number',order_number,'order_status',order_status,
        'store_id',store_id,'store_name',store_name,
        'seller_response_submitted',seller_response_submitted,
        'affected_item_count',affected_item_count,'buyer_evidence_count',buyer_evidence_count
      ) order by created_at desc,id desc) from selected),'[]'::jsonb),
      'next_cursor',case when (select count(*) from paged)>v_limit then(
        select jsonb_build_object('created_at',created_at,'id',id)
        from selected order by created_at asc,id asc limit 1
      )else null end
    ));
end;
$$;

comment on function public.fetch_my_marketplace_disputes(integer,timestamptz,uuid) is
  'Seller-owned active Marketplace dispute inbox summary with stable cursor pagination and no private evidence identifiers.';

revoke all on function public.marketplace_order_detail_response(uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_order_detail_response(uuid,text) to service_role;
revoke all on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) to authenticated,service_role;
revoke all on function public.fetch_my_marketplace_disputes(integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_disputes(integer,timestamptz,uuid) to authenticated,service_role;

commit;
