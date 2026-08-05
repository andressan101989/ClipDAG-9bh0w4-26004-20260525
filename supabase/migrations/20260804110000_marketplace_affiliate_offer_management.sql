begin;

create or replace function public.fetch_my_live_affiliate_offer(
  p_product_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  offer_row public.marketplace_live_affiliate_offers;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.seller_id = actor
      and p.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'live_affiliate_product_unavailable';
  end if;

  select o.*
  into offer_row
  from public.marketplace_live_affiliate_offers o
  where o.product_id = p_product_id
    and o.seller_id = actor
    and o.offer_scope = 'public_creator'
  order by
    case o.status when 'active' then 0 when 'paused' then 1 else 2 end,
    o.updated_at desc,
    o.id desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'product_id', offer_row.product_id,
    'offer_scope', offer_row.offer_scope,
    'commission_bps', offer_row.commission_bps,
    'status', offer_row.status,
    'starts_at', offer_row.starts_at,
    'ends_at', offer_row.ends_at,
    'updated_at', offer_row.updated_at
  );
end;
$$;

revoke all on function public.fetch_my_live_affiliate_offer(uuid)
from public, anon;
grant execute on function public.fetch_my_live_affiliate_offer(uuid)
to authenticated, service_role;

commit;
