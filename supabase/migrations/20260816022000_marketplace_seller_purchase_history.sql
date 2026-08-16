begin;

create or replace function public.fetch_my_marketplace_sale(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.marketplace_orders;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;

  select * into o from public.marketplace_orders where id = p_order_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace_order_not_found';
  end if;
  if o.seller_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'marketplace_order_not_owned';
  end if;
  if not exists (
    select 1 from public.marketplace_sellers
    where user_id = auth.uid() and status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'marketplace_seller_not_approved';
  end if;
  if not exists (
    select 1 from public.marketplace_stores
    where id = o.store_id and seller_id = auth.uid() and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'marketplace_store_inactive';
  end if;
  if not exists (
    select 1
    from public.marketplace_checkout_sessions c
    join public.marketplace_payments p on p.checkout_id = c.id
    where c.id = o.checkout_id
      and c.status = 'paid'
      and p.paid_at is not null
      and p.status in ('paid', 'partially_refunded', 'refunded')
  ) then
    raise exception using errcode = '42501', message = 'marketplace_order_not_paid';
  end if;
  if not exists (
    select 1
    from public.marketplace_payments p
    join public.marketplace_payment_allocations a
      on a.payment_id = p.id
     and a.order_id = o.id
     and a.seller_id = auth.uid()
    where p.checkout_id = o.checkout_id
      and (
        (
          o.status in ('confirmed', 'processing', 'shipped', 'cancelled')
          and p.status = 'paid'
          and a.status = 'held'
        )
        or (
          o.status = 'delivered'
          and p.status = 'paid'
          and a.status = 'released'
        )
        or (
          o.status = 'refunded'
          and p.status in ('paid', 'refunded')
          and a.status = 'refunded'
        )
        or (
          o.status = 'partially_refunded'
          and p.status in ('paid', 'partially_refunded')
          and a.status = 'partially_refunded'
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'marketplace_order_not_fulfillable';
  end if;

  return public.marketplace_order_detail_response(o.id, 'seller');
end;
$$;

revoke all on function public.fetch_my_marketplace_sale(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_my_marketplace_sale(uuid)
  to authenticated, service_role;

commit;
