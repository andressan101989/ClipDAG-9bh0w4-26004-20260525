begin;

create or replace function public.fetch_my_marketplace_orders(
  p_status text default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if p_status is not null and p_status not in (
    'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
    'partially_refunded'
  ) then
    raise exception using errcode = '22023', message = 'marketplace_invalid_order_status';
  end if;

  return coalesce((
    select jsonb_agg(x.row order by x.created_at desc, x.id desc)
    from (
      select
        o.created_at,
        o.id,
        jsonb_build_object(
          'id', o.id,
          'order_number', o.order_number,
          'checkout_id', o.checkout_id,
          'checkout_reference', c.reference,
          'status', o.status,
          'store_id', o.store_id,
          'store_name', st.name,
          'total', o.total,
          'currency', o.currency,
          'created_at', o.created_at,
          'confirmed_at', o.confirmed_at,
          'processing_at', o.processing_at,
          'shipped_at', o.shipped_at,
          'delivered_at', o.delivered_at,
          'first_item_title', (
            select i.product_title
            from public.marketplace_order_items i
            where i.order_id = o.id
            order by i.created_at
            limit 1
          ),
          'first_item_image', (
            select i.image_url
            from public.marketplace_order_items i
            where i.order_id = o.id
            order by i.created_at
            limit 1
          ),
          'distinct_lines', (
            select count(*)
            from public.marketplace_order_items i
            where i.order_id = o.id
          ),
          'total_quantity', (
            select sum(i.quantity)
            from public.marketplace_order_items i
            where i.order_id = o.id
          ),
          'carrier_name', sh.carrier_name,
          'tracking_number', sh.tracking_number,
          'payment_status', p.status
        ) row
      from public.marketplace_orders o
      join public.marketplace_checkout_sessions c
        on c.id = o.checkout_id
       and c.status = 'paid'
       and c.paid_at is not null
      join public.marketplace_stores st on st.id = o.store_id
      join public.marketplace_payments p
        on p.checkout_id = o.checkout_id
       and p.paid_at is not null
       and p.status in ('paid', 'partially_refunded', 'refunded')
      left join public.marketplace_order_shipments sh on sh.order_id = o.id
      where o.buyer_id = auth.uid()
        and (p_status is null or o.status = p_status)
        and (
          p_before_created_at is null
          or (o.created_at, o.id) < (p_before_created_at, p_before_id)
        )
      order by o.created_at desc, o.id desc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_my_marketplace_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.marketplace_orders;
  v_response jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;

  select * into o
  from public.marketplace_orders
  where id = p_order_id;

  if not found or o.buyer_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'marketplace_order_not_found';
  end if;

  if not exists (
    select 1
    from public.marketplace_checkout_sessions c
    join public.marketplace_payments p on p.checkout_id = c.id
    where c.id = o.checkout_id
      and c.status = 'paid'
      and c.paid_at is not null
      and p.paid_at is not null
      and p.status in ('paid', 'partially_refunded', 'refunded')
  ) then
    raise exception using errcode = '42501', message = 'marketplace_order_not_paid';
  end if;

  v_response := public.marketplace_order_detail_response(o.id, 'buyer');
  return v_response #- '{shipment,seller_note}' #- '{shipment,id}';
end;
$$;

revoke all on function public.fetch_my_marketplace_orders(text, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_my_marketplace_order(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_my_marketplace_orders(text, integer, timestamptz, uuid)
  to authenticated, service_role;
grant execute on function public.fetch_my_marketplace_order(uuid)
  to authenticated, service_role;

commit;
