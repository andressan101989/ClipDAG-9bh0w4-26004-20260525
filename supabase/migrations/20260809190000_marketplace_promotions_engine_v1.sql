begin;

create table public.marketplace_product_promotions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.marketplace_product_variants(id) on delete restrict,
  promotion_type text not null check (promotion_type in ('percentage','fixed_amount','promotional_price')),
  percentage_off numeric(5,2),
  fixed_amount_bdag numeric(20,8),
  promotional_price_bdag numeric(20,8),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'enabled' check (status in ('enabled','ended','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_promotion_window_check check (starts_at<ends_at),
  constraint marketplace_promotion_value_check check (
    (promotion_type='percentage' and percentage_off between 1 and 95 and fixed_amount_bdag is null and promotional_price_bdag is null) or
    (promotion_type='fixed_amount' and percentage_off is null and fixed_amount_bdag>0 and fixed_amount_bdag=round(fixed_amount_bdag,8) and promotional_price_bdag is null) or
    (promotion_type='promotional_price' and percentage_off is null and fixed_amount_bdag is null and promotional_price_bdag>0 and promotional_price_bdag=round(promotional_price_bdag,8))
  )
);
create unique index marketplace_promotions_idempotency_unique on public.marketplace_product_promotions(created_by,idempotency_key);
create index marketplace_promotions_resolver_idx on public.marketplace_product_promotions(product_id,variant_id,starts_at,ends_at) where status='enabled';
create index marketplace_promotions_seller_idx on public.marketplace_product_promotions(seller_id,created_at desc);
create trigger marketplace_product_promotions_set_updated_at before update on public.marketplace_product_promotions for each row execute function public.marketplace_set_updated_at();

alter table public.marketplace_product_promotions enable row level security;
create policy marketplace_promotions_owner_read on public.marketplace_product_promotions for select to authenticated using (seller_id=auth.uid());
revoke insert,update,delete on public.marketplace_product_promotions from anon,authenticated;

alter table public.marketplace_order_items
  add column promotion_id uuid references public.marketplace_product_promotions(id) on delete set null,
  add column base_unit_price numeric(20,8),
  add column discount_amount numeric(20,8);
alter table public.marketplace_order_items add constraint marketplace_order_items_promotion_snapshot_check check (
  (promotion_id is null and base_unit_price is null and discount_amount is null) or
  (promotion_id is not null and base_unit_price>=unit_price and base_unit_price=round(base_unit_price,8) and discount_amount=round(base_unit_price-unit_price,8) and discount_amount>0)
);

create or replace function public.marketplace_effective_price(p_product_id uuid,p_variant_id uuid,p_at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v public.marketplace_product_variants; promo public.marketplace_product_promotions; effective numeric(20,8);
begin
  select * into v from public.marketplace_product_variants where id=p_variant_id and product_id=p_product_id and status='active' and archived_at is null;
  if not found then raise exception using errcode='22023',message='marketplace_variant_unavailable'; end if;
  select * into promo from public.marketplace_product_promotions p where p.product_id=p_product_id and p.status='enabled'
    and p.starts_at<=p_at_time and p.ends_at>p_at_time and (p.variant_id=p_variant_id or p.variant_id is null)
    order by (p.variant_id is not null) desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('base_price',v.price,'effective_price',v.price,'promotion_id',null,'promotion_type',null,'discount_amount',0,'discount_percentage',null,'promotion_ends_at',null); end if;
  effective:=case promo.promotion_type
    when 'percentage' then round(v.price*(1-promo.percentage_off/100),8)
    when 'fixed_amount' then round(v.price-promo.fixed_amount_bdag,8)
    else promo.promotional_price_bdag end;
  if effective<=0 or effective>=v.price then raise exception using errcode='22023',message='marketplace_promotion_invalid_for_price'; end if;
  return jsonb_build_object('base_price',v.price,'effective_price',effective,'promotion_id',promo.id,'promotion_type',promo.promotion_type,
    'discount_amount',round(v.price-effective,8),'discount_percentage',round((v.price-effective)*100/v.price,2),'promotion_ends_at',promo.ends_at);
end;$$;

create or replace function public.create_marketplace_product_promotion(p_product_id uuid,p_variant_id uuid,p_promotion_type text,p_value numeric,p_starts_at timestamptz,p_ends_at timestamptz,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); prod public.products; variant public.marketplace_product_variants; prior public.marketplace_product_promotions; created public.marketplace_product_promotions; base_price numeric(20,8); normalized numeric(20,8);
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-promotion:'||p_product_id::text||':'||coalesce(p_variant_id::text,'product'),0));
  select * into prior from public.marketplace_product_promotions where created_by=actor and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(prior); end if;
  select * into prod from public.products where id=p_product_id and seller_id=actor and deleted_at is null;
  if not found then raise exception using errcode='42501',message='marketplace_promotion_product_not_owned'; end if;
  if prod.store_id is null or prod.product_type<>'physical' or prod.currency<>'BDAG' then raise exception using errcode='22023',message='marketplace_promotion_product_ineligible'; end if;
  if p_variant_id is not null then select * into variant from public.marketplace_product_variants where id=p_variant_id and product_id=prod.id and seller_id=actor and archived_at is null;
    if not found then raise exception using errcode='22023',message='marketplace_promotion_variant_invalid'; end if; base_price:=variant.price;
  else select min(price) into base_price from public.marketplace_product_variants where product_id=prod.id and status='active' and archived_at is null; end if;
  if base_price is null then raise exception using errcode='22023',message='marketplace_promotion_product_ineligible'; end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at>=p_ends_at or p_ends_at<=now() or p_ends_at>now()+interval '2 years' then raise exception using errcode='22023',message='marketplace_promotion_window_invalid'; end if;
  normalized:=round(p_value,8);
  if p_promotion_type='percentage' and (p_value<1 or p_value>95) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type='fixed_amount' and (normalized<=0 or normalized>=base_price) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type='promotional_price' and (normalized<=0 or normalized>=base_price or (p_variant_id is null and (select count(*) from public.marketplace_product_variants where product_id=prod.id and status='active' and archived_at is null)>1)) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type not in ('percentage','fixed_amount','promotional_price') then raise exception using errcode='22023',message='marketplace_promotion_type_invalid'; end if;
  if exists(select 1 from public.marketplace_product_promotions p where p.product_id=prod.id and p.variant_id is not distinct from p_variant_id and p.status='enabled' and tstzrange(p.starts_at,p.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception using errcode='23P01',message='marketplace_promotion_overlap'; end if;
  insert into public.marketplace_product_promotions(seller_id,store_id,product_id,variant_id,promotion_type,percentage_off,fixed_amount_bdag,promotional_price_bdag,starts_at,ends_at,created_by,idempotency_key)
  values(actor,prod.store_id,prod.id,p_variant_id,p_promotion_type,case when p_promotion_type='percentage' then p_value end,case when p_promotion_type='fixed_amount' then normalized end,case when p_promotion_type='promotional_price' then normalized end,p_starts_at,p_ends_at,actor,p_idempotency_key) returning * into created;
  return to_jsonb(created);
end;$$;

create or replace function public.list_my_marketplace_promotions() returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'product_id',p.product_id,'variant_id',p.variant_id,'product_title',pr.title,'variant_title',v.title,'promotion_type',p.promotion_type,'percentage_off',p.percentage_off,'fixed_amount_bdag',p.fixed_amount_bdag,'promotional_price_bdag',p.promotional_price_bdag,'starts_at',p.starts_at,'ends_at',p.ends_at,'state',case when p.status in('ended','cancelled')then'ended'when now()<p.starts_at then'scheduled'when now()<p.ends_at then'active'else'ended'end) order by p.created_at desc),'[]'::jsonb)
from public.marketplace_product_promotions p join public.products pr on pr.id=p.product_id left join public.marketplace_product_variants v on v.id=p.variant_id where p.seller_id=auth.uid();$$;

create or replace function public.end_marketplace_product_promotion(p_promotion_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); changed public.marketplace_product_promotions;
begin update public.marketplace_product_promotions set status='ended',ends_at=least(ends_at,now()) where id=p_promotion_id and seller_id=actor and status='enabled' and starts_at<=now() returning * into changed;
if not found then raise exception using errcode='42501',message='marketplace_promotion_not_endable'; end if; return to_jsonb(changed); end;$$;

create or replace function public.fetch_marketplace_product_detail(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_public boolean; v_owner boolean; result jsonb;
begin
  select p.seller_id=auth.uid(),p.status='active' and p.moderation_status='approved' and p.deleted_at is null and p.product_type='physical' and public.marketplace_seller_is_approved(p.seller_id) and s.status='active' and c.status='active'
  into v_owner,v_public from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_categories c on c.id=p.category_id where p.id=p_product_id;
  if not coalesce(v_owner,false) and not coalesce(v_public,false) then return null; end if;
  select jsonb_build_object('product_id',p.id,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'position',o.position,'values',(select coalesce(jsonb_agg(jsonb_build_object('id',ov.id,'value',ov.value,'position',ov.position)order by ov.position),'[]'::jsonb)from public.marketplace_product_option_values ov where ov.option_id=o.id))order by o.position)from public.marketplace_product_options o where o.product_id=p.id),'[]'::jsonb),
  'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'product_id',v.product_id,'sku',case when v_owner then v.sku else null end,'title',v.title,'price',(ep->>'effective_price')::numeric,'base_price',(ep->>'base_price')::numeric,'compare_at_price',case when ep->>'promotion_id' is not null then(ep->>'base_price')::numeric else v.compare_at_price end,'promotion_id',ep->>'promotion_id','promotion_type',ep->>'promotion_type','discount_percentage',(ep->>'discount_percentage')::numeric,'promotion_ends_at',ep->>'promotion_ends_at','status',v.status,'is_default',v.is_default,'image_asset_id',v.image_asset_id,'image_url',a.public_url,'available_quantity',greatest(l.on_hand-l.reserved,0),'option_value_ids',coalesce((select jsonb_agg(x.option_value_id order by o.position)from public.marketplace_variant_option_values x join public.marketplace_product_option_values ov on ov.id=x.option_value_id join public.marketplace_product_options o on o.id=ov.option_id where x.variant_id=v.id),'[]'::jsonb))order by v.is_default desc,v.created_at)
    from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id left join public.media_assets a on a.id=v.image_asset_id and a.status='ready' cross join lateral public.marketplace_effective_price(p.id,v.id,now()) ep where v.product_id=p.id and v.status<>'archived' and(v_owner or v.status='active')),'[]'::jsonb)) into result from public.products p where p.id=p_product_id; return result;
end;$$;

-- Only the catalog price reads below change to the promotion resolver; reservation snapshots remain immutable.
create or replace function public.create_marketplace_checkout_reservation(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_fingerprint text;v_prior public.marketplace_checkout_sessions;v_checkout uuid:=gen_random_uuid();v_expires timestamptz:=now()+interval'15 minutes';v_subtotal numeric(20,8):=0;x record;v_variant public.marketplace_product_variants;v_product public.products;v_inventory public.marketplace_inventory_levels;v_order uuid;v_item uuid;v_line numeric(20,8);v_options jsonb;v_image text;v_address jsonb;v_total_qty bigint;v_price jsonb;v_unit numeric(20,8);v_promotion uuid;v_base numeric(20,8);
begin
if v_user is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
if jsonb_typeof(p_items)<>'array'or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception using errcode='22023',message='marketplace_invalid_checkout_items';end if;
if exists(select 1 from jsonb_array_elements(p_items)e where jsonb_typeof(e)<>'object'or not(e?'variant_id'and e?'quantity')or(select count(*)from jsonb_object_keys(e))<>2 or(e->>'variant_id')is null or(e->>'quantity')!~'^[1-9][0-9]{0,2}$')then raise exception using errcode='22023',message='marketplace_invalid_checkout_items';end if;
if(select count(*)<>count(distinct(e->>'variant_id'))from jsonb_array_elements(p_items)e)then raise exception using errcode='22023',message='marketplace_duplicate_variant';end if;select sum((e->>'quantity')::integer)into v_total_qty from jsonb_array_elements(p_items)e;if v_total_qty>1000 then raise exception using errcode='22023',message='marketplace_invalid_checkout_items';end if;
v_address:=jsonb_build_object('recipient_name',btrim(coalesce(p_shipping_address->>'recipient_name','')),'line1',btrim(coalesce(p_shipping_address->>'line1','')),'line2',nullif(btrim(coalesce(p_shipping_address->>'line2','')),''),'city',btrim(coalesce(p_shipping_address->>'city','')),'region',btrim(coalesce(p_shipping_address->>'region','')),'postal_code',btrim(coalesce(p_shipping_address->>'postal_code','')),'country',btrim(coalesce(p_shipping_address->>'country','')),'phone',nullif(btrim(coalesce(p_shipping_address->>'phone','')),''));
if char_length(v_address->>'recipient_name')not between 2 and 120 or char_length(v_address->>'line1')not between 2 and 180 or char_length(v_address->>'city')not between 1 and 100 or char_length(v_address->>'region')not between 1 and 100 or char_length(v_address->>'postal_code')not between 1 and 30 or char_length(v_address->>'country')not between 2 and 100 or char_length(coalesce(v_address->>'line2',''))>180 or char_length(coalesce(v_address->>'phone',''))>40 then raise exception using errcode='22023',message='marketplace_invalid_shipping_address';end if;
v_fingerprint:=pg_catalog.encode(extensions.digest((select jsonb_agg(jsonb_build_object('variant_id',e->>'variant_id','quantity',(e->>'quantity')::integer)order by e->>'variant_id')::text from jsonb_array_elements(p_items)e)||v_address::text,'sha256'),'hex');perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_idempotency_key::text,0));perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-checkout-buyer:'||v_user::text,0));select*into v_prior from public.marketplace_checkout_sessions where buyer_id=v_user and idempotency_key=p_idempotency_key;if found then if v_prior.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='marketplace_idempotency_conflict';end if;return public.marketplace_checkout_response(v_prior.id);end if;perform public.expire_marketplace_checkout_reservations(100);if exists(select 1 from public.marketplace_checkout_sessions where buyer_id=v_user and status='pending_payment')then raise exception using errcode='23505',message='marketplace_active_checkout_exists';end if;
perform 1 from public.marketplace_inventory_levels l join public.marketplace_product_variants v on v.id=l.variant_id join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid order by v.id for update of v,l;
for x in select(e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity from jsonb_array_elements(p_items)e order by(e->>'variant_id')::uuid loop select*into v_variant from public.marketplace_product_variants where id=x.variant_id;if not found or v_variant.status<>'active'or v_variant.archived_at is not null then raise exception using message='marketplace_variant_unavailable';end if;select*into v_product from public.products where id=v_variant.product_id;if not found or v_product.status<>'active'or v_product.published_at is null or v_product.deleted_at is not null or v_product.moderation_status<>'approved'or v_product.currency<>'BDAG'or not exists(select 1 from public.marketplace_stores s where s.id=v_variant.store_id and s.status='active')or not public.marketplace_seller_is_approved(v_variant.seller_id)then raise exception using message='marketplace_product_unavailable';end if;if v_variant.seller_id=v_user then raise exception using message='marketplace_own_product_forbidden';end if;select*into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;if v_inventory.on_hand-v_inventory.reserved<x.quantity then raise exception using message='marketplace_insufficient_inventory',detail=jsonb_build_object('variant_id',x.variant_id,'requested',x.quantity,'available',greatest(v_inventory.on_hand-v_inventory.reserved,0))::text;end if;v_price:=public.marketplace_effective_price(v_product.id,v_variant.id,now());v_subtotal:=v_subtotal+round((v_price->>'effective_price')::numeric*x.quantity,8);end loop;
insert into public.marketplace_checkout_sessions(id,reference,buyer_id,subtotal,total,idempotency_key,request_fingerprint,expires_at)values(v_checkout,'CHK-'||upper(substr(replace(v_checkout::text,'-',''),1,16)),v_user,v_subtotal,v_subtotal,p_idempotency_key,v_fingerprint,v_expires);insert into public.marketplace_checkout_shipping_addresses(checkout_id,recipient_name,line1,line2,city,region,postal_code,country,phone)values(v_checkout,v_address->>'recipient_name',v_address->>'line1',v_address->>'line2',v_address->>'city',v_address->>'region',v_address->>'postal_code',v_address->>'country',v_address->>'phone');
for x in select(e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity from jsonb_array_elements(p_items)e order by(e->>'variant_id')::uuid loop select*into v_variant from public.marketplace_product_variants where id=x.variant_id;select*into v_product from public.products where id=v_variant.product_id;v_price:=public.marketplace_effective_price(v_product.id,v_variant.id,now());v_unit:=(v_price->>'effective_price')::numeric;v_base:=(v_price->>'base_price')::numeric;v_promotion:=nullif(v_price->>'promotion_id','')::uuid;select id into v_order from public.marketplace_orders where checkout_id=v_checkout and store_id=v_variant.store_id;if v_order is null then v_order:=gen_random_uuid();insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,subtotal,total,reservation_expires_at)values(v_order,'ORD-'||upper(substr(replace(v_order::text,'-',''),1,16)),v_checkout,v_user,v_variant.seller_id,v_variant.store_id,v_unit*x.quantity,v_unit*x.quantity,v_expires);else update public.marketplace_orders set subtotal=subtotal+v_unit*x.quantity,total=total+v_unit*x.quantity where id=v_order;end if;select coalesce(jsonb_agg(jsonb_build_object('option_id',o.id,'option_name',o.name,'value_id',ov.id,'value',ov.value)order by o.position),'[]'::jsonb)into v_options from public.marketplace_variant_option_values vv join public.marketplace_product_option_values ov on ov.id=vv.option_value_id join public.marketplace_product_options o on o.id=ov.option_id where vv.variant_id=x.variant_id;select a.public_url into v_image from public.media_assets a where a.id=v_variant.image_asset_id and a.status='ready';v_line:=round(v_unit*x.quantity,8);v_item:=gen_random_uuid();insert into public.marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,variant_title,sku,option_snapshot,image_url,unit_price,quantity,line_total,promotion_id,base_unit_price,discount_amount)values(v_item,v_order,v_checkout,v_product.id,v_variant.id,v_variant.seller_id,v_variant.store_id,v_product.title,v_variant.title,v_variant.sku,v_options,v_image,v_unit,x.quantity,v_line,v_promotion,case when v_promotion is null then null else v_base end,case when v_promotion is null then null else round(v_base-v_unit,8)end);select*into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;update public.marketplace_inventory_levels set reserved=reserved+x.quantity,version=version+1 where variant_id=x.variant_id;insert into public.marketplace_inventory_reservations(checkout_id,order_id,order_item_id,buyer_id,variant_id,quantity,expires_at)values(v_checkout,v_order,v_item,v_user,x.variant_id,x.quantity,v_expires)returning id into v_item;insert into public.marketplace_inventory_reservation_events(reservation_id,checkout_id,variant_id,event_type,quantity_delta,previous_reserved,resulting_reserved,reason,actor_id)values(v_item,v_checkout,x.variant_id,'reserve',x.quantity,v_inventory.reserved,v_inventory.reserved+x.quantity,'checkout_created',v_user);end loop;
for x in select distinct v.product_id from public.marketplace_product_variants v join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid loop perform public.refresh_marketplace_product_projection(x.product_id);end loop;return public.marketplace_checkout_response(v_checkout);end;$$;

revoke all on function public.marketplace_effective_price(uuid,uuid,timestamptz) from public,anon,authenticated;grant execute on function public.marketplace_effective_price(uuid,uuid,timestamptz) to service_role;
revoke all on function public.create_marketplace_product_promotion(uuid,uuid,text,numeric,timestamptz,timestamptz,uuid) from public,anon;grant execute on function public.create_marketplace_product_promotion(uuid,uuid,text,numeric,timestamptz,timestamptz,uuid) to authenticated;
revoke all on function public.list_my_marketplace_promotions() from public,anon;grant execute on function public.list_my_marketplace_promotions() to authenticated;
revoke all on function public.end_marketplace_product_promotion(uuid) from public,anon;grant execute on function public.end_marketplace_product_promotion(uuid) to authenticated;
grant select on public.marketplace_product_promotions to service_role;grant all on public.marketplace_product_promotions to service_role;
notify pgrst,'reload schema';
commit;
