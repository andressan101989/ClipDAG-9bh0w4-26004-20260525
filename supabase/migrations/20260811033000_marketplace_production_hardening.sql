-- MKT-B8D-1H: close the five production-readiness P2 findings without
-- changing Marketplace economics or creating new mutation authority.
begin;

-- Marketplace objects are owned by postgres. Keep service_role defaults for
-- internal Supabase/Marketplace authorities, but require intentional browser
-- grants for every future postgres-owned public object.
revoke create on schema public from public, anon, authenticated, authenticator, service_role;
grant usage on schema public to public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
-- PostgreSQL's built-in function default grants EXECUTE to PUBLIC globally;
-- a schema-scoped revoke cannot override that global default.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

revoke references, trigger, truncate on table public.marketplace_product_promotions
  from anon, authenticated;

create or replace function public.expire_marketplace_checkout_reservations(
  p_limit integer default 100
) returns integer
language plpgsql security definer set search_path=public as $$
declare c record; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='marketplace_invalid_expiration_limit';
  end if;
  for c in
    select id from public.marketplace_checkout_sessions
    where status='pending_payment' and expires_at<=now()
    order by expires_at,id for update skip locked limit p_limit
  loop
    perform public.marketplace_release_checkout(c.id,'expired','reservation_expired',null);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$$;

-- Public sponsored reads historically clamp 0..8. Explicit NULL now means the
-- documented default of four rather than an unbounded LIMIT NULL.
create or replace function public.fetch_marketplace_sponsored_products(
  p_surface text,p_category_id uuid default null,p_limit integer default 4,p_session text default null
) returns setof jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('campaign_id',c.id,'product_id',p.id,'title',p.title,'images',p.images,
 'seller',jsonb_build_object('username',u.username,'display_name',u.display_name),
 'price',(ep->>'effective_price')::numeric,'base_price',(ep->>'base_price')::numeric,
 'promotion_id',ep->>'promotion_id','sponsored',true,'label','Patrocinado')
 from public.marketplace_ad_campaigns c
 join public.products p on p.id=c.product_id
 join public.user_profiles u on u.id=c.seller_id
 join lateral(select v.id from public.marketplace_product_variants v
   join public.marketplace_inventory_levels l on l.variant_id=v.id
   where v.product_id=p.id and v.status='active'and v.archived_at is null and l.on_hand-l.reserved>0
   order by v.is_default desc,v.created_at limit 1)v on true
 cross join lateral public.marketplace_ad_delivery_eligibility_at(c.id,now())elig
 cross join lateral public.marketplace_effective_price(p.id,v.id,now())ep
 where p_surface in('marketplace_home','marketplace_search')and elig.eligible
   and c.funded_at is not null and c.status in('active','scheduled')
   and c.spent_bdag+c.released_bdag<c.total_budget_bdag
   and(p_category_id is null or p.category_id=p_category_id)
 order by md5(c.id::text||coalesce(p_session,'public')||date_trunc('hour',now())::text)
 limit least(greatest(coalesce(p_limit,4),0),8)
$$;

create or replace function public.fetch_marketplace_sponsored_products_v2(
  p_surface text,p_category text default null,p_limit integer default 4,p_session text default null
) returns setof jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
   'campaign_id',c.id,'product_id',p.id,'title',p.title,'images',p.images,
   'seller',jsonb_build_object('username',u.username,'display_name',u.display_name),
   'price',(card->>'price')::numeric,'base_price',(card->>'base_price')::numeric,
   'promotion_id',card->>'promotion_id','sponsored',true,'label','Patrocinado')
 from public.marketplace_ad_campaigns c
 join public.products p on p.id=c.product_id
 join public.user_profiles u on u.id=c.seller_id
 cross join lateral public.marketplace_ad_delivery_eligibility_at(c.id,now()) elig
 join lateral public.marketplace_public_product_card_price(p.id,now()) card on true
 where p_surface in('marketplace_home','marketplace_search') and elig.eligible
   and c.funded_at is not null and c.status in('active','scheduled')
   and c.spent_bdag+c.released_bdag<c.total_budget_bdag
   and(p_category is null or p.category=p_category)
 order by md5(c.id::text||coalesce(p_session,'public')||date_trunc('hour',now())::text)
 limit least(greatest(coalesce(p_limit,4),0),8)
$$;

-- Seller Ads list historically clamps 0 to one and >100 to 100. Explicit NULL
-- now uses the documented default 50.
create or replace function public.fetch_my_marketplace_ad_campaigns(
  p_status text default null,p_limit integer default 50
) returns setof jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'product_id',c.product_id,'product_title',p.title,
 'images',p.images,'name',c.name,'status',c.status,'budget',c.total_budget_bdag,
 'spent',c.spent_bdag,'released',c.released_bdag,
 'remaining',c.total_budget_bdag-c.spent_bdag-c.released_bdag,
 'starts_at',c.starts_at,'ends_at',c.ends_at,'eligible_elapsed_seconds',c.eligible_elapsed_seconds,
 'impressions',count(e.id)filter(where e.event_type='impression'),
 'clicks',count(e.id)filter(where e.event_type='click'),
 'product_views',count(e.id)filter(where e.event_type='product_view'),
 'cart_adds',count(e.id)filter(where e.event_type='add_to_cart'),
 'orders',count(e.id)filter(where e.event_type='purchase'),
 'gmv',coalesce(sum((e.metadata->>'line_total')::numeric)filter(where e.event_type='purchase'),0))
 from public.marketplace_ad_campaigns c
 join public.products p on p.id=c.product_id
 left join public.marketplace_ad_events e on e.campaign_id=c.id
 where c.seller_id=auth.uid()and(p_status is null or c.status=p_status
   or(p_status='terminal'and c.status in('completed','exhausted','cancelled')))
 group by c.id,p.id order by c.created_at desc
 limit least(greatest(coalesce(p_limit,50),1),100)
$$;

create index if not exists products_seller_updated_keyset_idx
  on public.products(seller_id,updated_at desc,id desc)
  where deleted_at is null and status<>'deleted';
create index if not exists marketplace_promotions_seller_keyset_idx
  on public.marketplace_product_promotions(seller_id,created_at desc,id desc);
create index if not exists marketplace_shipping_profiles_seller_store_keyset_idx
  on public.marketplace_shipping_profiles(seller_id,store_id,created_at,id);

create or replace function public.fetch_my_marketplace_products_v2(
  p_cursor_updated_at timestamptz default null,p_cursor_product_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();v_rows jsonb;v_page jsonb;v_more boolean;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_limit is null or p_limit<1 or p_limit>100
   or((p_cursor_updated_at is null)<>(p_cursor_product_id is null))then
   raise exception using errcode='22023',message='marketplace_seller_product_page_invalid';end if;
 with rows as(
  select jsonb_build_object(
   'id',p.id,'seller_id',p.seller_id,'store_id',p.store_id,'category_id',p.category_id,
   'title',p.title,'description',p.description,'price',p.price,'currency',p.currency,
   'category',p.category,'images',p.images,'stock',p.stock,'status',p.status,'tags',p.tags,
   'total_sales',p.total_sales,'brand',p.brand,'compare_at_price',p.compare_at_price,
   'product_type',p.product_type,'moderation_status',p.moderation_status,
   'published_at',p.published_at,'deleted_at',p.deleted_at,'created_at',p.created_at,
   'updated_at',p.updated_at,'variant_price_max',p.variant_price_max,
   'active_variant_count',p.active_variant_count,'shipping_profile_id',p.shipping_profile_id,
   'available_quantity',coalesce(inv.available_quantity,0),
   'publication_readiness_reason',public.marketplace_product_publication_reason(p.id,actor),
   'seller',jsonb_build_object('username',u.username,'avatar_url',u.avatar_url,'display_name',u.display_name)
  )j
  from public.products p
  join public.marketplace_stores s on s.id=p.store_id and s.seller_id=actor
  left join public.user_profiles u on u.id=p.seller_id
  left join lateral(select sum(greatest(i.on_hand-i.reserved,0))::int available_quantity
   from public.marketplace_product_variants v join public.marketplace_inventory_levels i on i.variant_id=v.id
   where v.product_id=p.id and v.status='active')inv on true
  where p.seller_id=actor and p.deleted_at is null and p.status<>'deleted'
   and(p_cursor_updated_at is null or(p.updated_at,p.id)<(p_cursor_updated_at,p_cursor_product_id))
  order by p.updated_at desc,p.id desc limit p_limit+1)
 select coalesce(jsonb_agg(j),'[]')into v_rows from rows;
 v_more:=jsonb_array_length(v_rows)>p_limit;
 select coalesce(jsonb_agg(value order by ord),'[]')into v_page
 from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
 return jsonb_build_object('items',v_page,'page_size',jsonb_array_length(v_page),
  'next_cursor',case when v_more then jsonb_build_object(
   'updated_at',v_page->(p_limit-1)->>'updated_at','product_id',v_page->(p_limit-1)->>'id')else null end);
end$$;

create or replace function public.fetch_my_marketplace_products()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select public.fetch_my_marketplace_products_v2(null,null,100)->'items'
$$;

create or replace function public.list_my_marketplace_promotions_v2(
 p_cursor_created_at timestamptz default null,p_cursor_promotion_id uuid default null,
 p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();v_rows jsonb;v_page jsonb;v_more boolean;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_limit is null or p_limit<1 or p_limit>100
  or((p_cursor_created_at is null)<>(p_cursor_promotion_id is null))then
  raise exception using errcode='22023',message='marketplace_seller_promotion_page_invalid';end if;
 with rows as(
  select jsonb_build_object('id',p.id,'product_id',p.product_id,'variant_id',p.variant_id,
   'product_title',pr.title,'variant_title',v.title,'promotion_type',p.promotion_type,
   'percentage_off',p.percentage_off,'fixed_amount_bdag',p.fixed_amount_bdag,
   'promotional_price_bdag',p.promotional_price_bdag,'starts_at',p.starts_at,'ends_at',p.ends_at,
   'created_at',p.created_at,'state',case when p.status in('ended','cancelled')then'ended'
    when now()<p.starts_at then'scheduled'when now()<p.ends_at then'active'else'ended'end)j
  from public.marketplace_product_promotions p
  join public.products pr on pr.id=p.product_id
  left join public.marketplace_product_variants v on v.id=p.variant_id
  where p.seller_id=actor and(p_cursor_created_at is null or(p.created_at,p.id)<(p_cursor_created_at,p_cursor_promotion_id))
  order by p.created_at desc,p.id desc limit p_limit+1)
 select coalesce(jsonb_agg(j),'[]')into v_rows from rows;
 v_more:=jsonb_array_length(v_rows)>p_limit;
 select coalesce(jsonb_agg(value order by ord),'[]')into v_page
 from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
 return jsonb_build_object('items',v_page,'page_size',jsonb_array_length(v_page),
  'next_cursor',case when v_more then jsonb_build_object('created_at',v_page->(p_limit-1)->>'created_at',
   'promotion_id',v_page->(p_limit-1)->>'id')else null end);
end$$;

create or replace function public.list_my_marketplace_promotions()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select public.list_my_marketplace_promotions_v2(null,null,100)->'items'
$$;

create or replace function public.fetch_my_marketplace_shipping_profiles_v2(
 p_store_id uuid,p_cursor_created_at timestamptz default null,p_cursor_profile_id uuid default null,
 p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();v_rows jsonb;v_page jsonb;v_more boolean;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_store_id is null or p_limit is null or p_limit<1 or p_limit>100
  or((p_cursor_created_at is null)<>(p_cursor_profile_id is null))then
  raise exception using errcode='22023',message='marketplace_shipping_profile_page_invalid';end if;
 with rows as(
  select jsonb_build_object('id',p.id,'name',p.name,'status',p.status,
   'configuration_status',p.configuration_status,'processing_days_min',p.processing_days_min,
   'processing_days_max',p.processing_days_max,'ships_from_country',p.ships_from_country,
   'return_policy_summary',p.return_policy_summary,'legacy_unrestricted',false,'created_at',p.created_at,
   'products_using',(select count(*)from public.products x where x.shipping_profile_id=p.id and x.deleted_at is null),
   'regions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'country_code',r.country_code,
    'region_code',r.region_code,'shipping_price',r.shipping_price,
    'free_shipping_threshold',r.free_shipping_threshold,'transit_days_min',r.transit_days_min,
    'transit_days_max',r.transit_days_max,'status',r.status)order by r.created_at,r.id)
    from public.marketplace_shipping_profile_regions r
    where r.profile_id=p.id and r.archived_at is null),'[]'::jsonb))j
  from public.marketplace_shipping_profiles p
  where p.store_id=p_store_id and p.seller_id=actor
   and(p_cursor_created_at is null or(p.created_at,p.id)>(p_cursor_created_at,p_cursor_profile_id))
  order by p.created_at,p.id limit p_limit+1)
 select coalesce(jsonb_agg(j),'[]')into v_rows from rows;
 v_more:=jsonb_array_length(v_rows)>p_limit;
 select coalesce(jsonb_agg(value order by ord),'[]')into v_page
 from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
 return jsonb_build_object('items',v_page,'page_size',jsonb_array_length(v_page),
  'next_cursor',case when v_more then jsonb_build_object('created_at',v_page->(p_limit-1)->>'created_at',
   'profile_id',v_page->(p_limit-1)->>'id')else null end);
end$$;

create or replace function public.fetch_my_marketplace_shipping_profiles(p_store_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select public.fetch_my_marketplace_shipping_profiles_v2(p_store_id,null,null,100)->'items'
$$;

-- The corrected temporal contract is v2. No supported repository client calls
-- v1; retain it only for trusted service-side compatibility.
revoke all on function public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)
 to service_role;
revoke all on function public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)
 to authenticated,service_role;

revoke all on function public.fetch_my_marketplace_products_v2(timestamptz,uuid,integer),
 public.list_my_marketplace_promotions_v2(timestamptz,uuid,integer),
 public.fetch_my_marketplace_shipping_profiles_v2(uuid,timestamptz,uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.fetch_my_marketplace_products_v2(timestamptz,uuid,integer),
 public.list_my_marketplace_promotions_v2(timestamptz,uuid,integer),
 public.fetch_my_marketplace_shipping_profiles_v2(uuid,timestamptz,uuid,integer)
 to authenticated,service_role;

revoke all on function public.fetch_my_marketplace_products(),
 public.list_my_marketplace_promotions(),public.fetch_my_marketplace_shipping_profiles(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.fetch_my_marketplace_products(),
 public.list_my_marketplace_promotions(),public.fetch_my_marketplace_shipping_profiles(uuid)
 to authenticated,service_role;

revoke all on function public.expire_marketplace_checkout_reservations(integer)from public,anon;
grant execute on function public.expire_marketplace_checkout_reservations(integer)to authenticated,service_role;
revoke all on function public.fetch_marketplace_sponsored_products(text,uuid,integer,text),
 public.fetch_marketplace_sponsored_products_v2(text,text,integer,text)from public;
grant execute on function public.fetch_marketplace_sponsored_products(text,uuid,integer,text),
 public.fetch_marketplace_sponsored_products_v2(text,text,integer,text)to anon,authenticated,service_role;
revoke all on function public.fetch_my_marketplace_ad_campaigns(text,integer)from public,anon;
grant execute on function public.fetch_my_marketplace_ad_campaigns(text,integer)to authenticated,service_role;

notify pgrst,'reload schema';
commit;
