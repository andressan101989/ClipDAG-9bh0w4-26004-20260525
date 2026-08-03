begin;

create or replace function fixture_ops.is_business_purchase_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(
 select 1 from public.live_commerce_purchase_events e
 join public.marketplace_payment_allocations a on a.order_id=e.order_id
 where e.id=p_event_id
   and not fixture_ops.is_fixture('live_session',e.session_id)
   and not fixture_ops.is_fixture('product',e.product_id)
   and not fixture_ops.is_fixture('auth_user',e.buyer_id)
   and not fixture_ops.is_fixture('store',a.store_id)
)
$$;
revoke all on function fixture_ops.is_business_purchase_event(uuid)from public,anon,authenticated;

create or replace function public.fetch_live_session_products(p_session_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'product_id',q.product_id,'store_id',q.store_id,'store_name',q.store_name,
 'seller_name',q.seller_name,'title',q.title,'description',q.description,'image_url',q.image_url,
 'min_price',q.min_price,'max_price',q.max_price,'compare_at_price',q.compare_at_price,
 'active_variant_count',q.variant_count,'available_quantity',q.available_quantity,
 'featured_variant_id',q.safe_featured_variant_id,'is_featured',q.is_featured,'position',q.position,
 'sold_count',q.sold_count,'commerce_mode',q.commerce_mode,
 'availability',case when q.commerce_mode='affiliate_product'and not q.affiliate_valid then'affiliate_offer_unavailable'when q.base_eligible and q.available_quantity>0 then'available'when q.base_eligible then'out_of_stock'else'product_unavailable'end
)order by q.is_featured desc,q.position,q.id),'[]'::jsonb)
from(select lp.id,lp.product_id,lp.store_id,lp.featured_variant_id,lp.is_featured,lp.position,lp.commerce_mode,
 st.name store_name,coalesce(up.display_name,up.username)seller_name,p.title,p.description,
 public.marketplace_safe_public_image_url(p.images[1])image_url,
 min(v.price)filter(where v.status='active'and v.archived_at is null)min_price,
 max(v.price)filter(where v.status='active'and v.archived_at is null)max_price,
 max(v.compare_at_price)filter(where v.status='active'and v.archived_at is null)compare_at_price,
 count(v.id)filter(where v.status='active'and v.archived_at is null)variant_count,
 coalesce(sum(greatest(i.on_hand-i.reserved,0))filter(where v.status='active'and v.archived_at is null),0)available_quantity,
 (array_agg(v.id order by v.id)filter(where v.id=lp.featured_variant_id and v.status='active'and v.archived_at is null and greatest(coalesce(i.on_hand,0)-coalesce(i.reserved,0),0)>0))[1]safe_featured_variant_id,
 coalesce((select sum(e.quantity)from public.live_commerce_purchase_events e where e.session_id=lp.session_id and e.product_id=lp.product_id and fixture_ops.is_business_purchase_event(e.id)),0)sold_count,
 p.status='active'and p.moderation_status='approved'and p.deleted_at is null and p.product_type='physical'and p.currency='BDAG'and st.status='active'and ms.status='approved'and not fixture_ops.is_fixture('product',p.id)base_eligible,
 (lp.commerce_mode='own_product'or public.marketplace_live_affiliate_pin_is_valid(lp.id,lp.host_id))affiliate_valid
 from public.live_session_products lp join public.live_sessions l on l.id=lp.session_id and l.status='live'
 join public.products p on p.id=lp.product_id join public.marketplace_stores st on st.id=lp.store_id
 join public.marketplace_sellers ms on ms.user_id=lp.seller_id join public.user_profiles up on up.id=lp.seller_id
 left join public.marketplace_product_variants v on v.product_id=p.id left join public.marketplace_inventory_levels i on i.variant_id=v.id
 where lp.session_id=p_session_id and lp.status='active'and not fixture_ops.is_fixture('live_session',lp.session_id)
 group by lp.id,st.id,up.id,p.id,ms.user_id)q
$$;

create or replace function public.fetch_my_live_shop_stats(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 if auth.uid()is null or not exists(select 1 from public.live_sessions l where l.id=p_session_id and l.host_id=auth.uid())then raise exception using errcode='42501',message='live_commerce_host_not_eligible';end if;
 select jsonb_build_object('orders_count',count(e.id),'gross_sales',coalesce(sum(e.gross_amount),0),'creator_commission_held',coalesce(sum(e.creator_commission_amount)filter(where a.status='held'),0),'creator_commission_released',coalesce(sum(e.creator_commission_amount)filter(where a.status='released'),0),'units_sold',coalesce(sum(e.quantity),0))into result
 from public.live_commerce_purchase_events e join public.marketplace_payment_allocations a on a.order_id=e.order_id
 where e.session_id=p_session_id and e.host_id=auth.uid()and fixture_ops.is_business_purchase_event(e.id);
 return result;end$$;

create or replace function public.fetch_my_live_purchase_events(p_session_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'buyer_display_name',e.buyer_display_name,'product_title',i.product_title,'quantity',e.quantity,'gross_amount',e.gross_amount,'creator_commission_amount',e.creator_commission_amount,'creator_commission_status',case when e.creator_commission_amount=0 then'none'when a.status='released'then'released'else'held'end,'created_at',e.created_at)order by e.created_at desc),'[]'::jsonb)
from(select*from public.live_commerce_purchase_events x where x.session_id=p_session_id and x.host_id=auth.uid()and fixture_ops.is_business_purchase_event(x.id)order by x.created_at desc limit least(greatest(coalesce(p_limit,50),1),100))e
join public.marketplace_order_items i on i.id=e.order_item_id join public.marketplace_payment_allocations a on a.order_id=e.order_id
$$;

revoke all on function public.fetch_live_session_products(uuid)from public;
grant execute on function public.fetch_live_session_products(uuid)to anon,authenticated,service_role;
revoke all on function public.fetch_my_live_shop_stats(uuid),public.fetch_my_live_purchase_events(uuid,integer)from public,anon;
grant execute on function public.fetch_my_live_shop_stats(uuid),public.fetch_my_live_purchase_events(uuid,integer)to authenticated,service_role;

commit;
