begin;

create or replace function public.get_my_marketplace_variant_analytics(p_date_from timestamptz,p_date_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_date_from is null or p_date_to is null or p_date_from>=p_date_to or p_date_to-p_date_from>interval '366 days' then
    raise exception using errcode='22023',message='marketplace_analytics_range_invalid';
  end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=actor) then
    raise exception using errcode='42501',message='marketplace_seller_required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.gmv_bdag desc,x.units_sold desc,x.add_to_cart desc),'[]'::jsonb) into result
  from(
    select e.product_id,e.variant_id,max(p.title) product_title,max(v.sku) sku,
      count(*)filter(where e.event_name='variant_selected')::int selections,
      count(*)filter(where e.event_name='add_to_cart')::int add_to_cart,
      count(*)filter(where e.event_name='purchase_completed')::int purchases,
      coalesce(sum(e.quantity)filter(where e.event_name='purchase_completed'),0)::int units_sold,
      coalesce(sum(e.gross_merchandise_bdag)filter(where e.event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag
    from public.marketplace_commerce_events e
    left join public.products p on p.id=e.product_id
    left join public.marketplace_product_variants v on v.id=e.variant_id
    where e.seller_id=actor and e.variant_id is not null and e.occurred_at>=p_date_from and e.occurred_at<p_date_to
    group by e.product_id,e.variant_id
  )x;
  return result;
end;$$;

revoke all on function public.get_my_marketplace_variant_analytics(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_my_marketplace_variant_analytics(timestamptz,timestamptz) to authenticated,service_role;

commit;
