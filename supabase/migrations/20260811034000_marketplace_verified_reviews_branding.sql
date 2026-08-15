begin;

create table public.marketplace_product_reviews (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.user_profiles(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  order_item_id uuid not null references public.marketplace_order_items(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or (comment=btrim(comment) and char_length(comment) between 1 and 1000)),
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_item_id)
);

create table public.marketplace_seller_reviews (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.user_profiles(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or (comment=btrim(comment) and char_length(comment) between 1 and 1000)),
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id)
);

create index marketplace_product_reviews_public_idx
  on public.marketplace_product_reviews(product_id,created_at desc,id desc)
  where status='visible';
create index marketplace_seller_reviews_public_idx
  on public.marketplace_seller_reviews(store_id,created_at desc,id desc)
  where status='visible';
create index marketplace_product_reviews_buyer_idx
  on public.marketplace_product_reviews(buyer_id,updated_at desc);
create index marketplace_seller_reviews_buyer_idx
  on public.marketplace_seller_reviews(buyer_id,updated_at desc);

create trigger marketplace_product_reviews_set_updated_at
before update on public.marketplace_product_reviews
for each row execute function public.marketplace_set_updated_at();
create trigger marketplace_seller_reviews_set_updated_at
before update on public.marketplace_seller_reviews
for each row execute function public.marketplace_set_updated_at();

alter table public.marketplace_product_reviews enable row level security;
alter table public.marketplace_seller_reviews enable row level security;
revoke all on public.marketplace_product_reviews from public,anon,authenticated;
revoke all on public.marketplace_seller_reviews from public,anon,authenticated;
grant all on public.marketplace_product_reviews to service_role;
grant all on public.marketplace_seller_reviews to service_role;

create or replace function public.submit_my_marketplace_product_review(
  p_order_item_id uuid,p_rating integer,p_comment text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
  v_item public.marketplace_order_items;v_order public.marketplace_orders;
  v_review public.marketplace_product_reviews;v_profile public.user_profiles;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_review_auth_required';end if;
  if p_order_item_id is null or p_rating is null or p_rating<1 or p_rating>5 or char_length(coalesce(v_comment,''))>1000 then
    raise exception using errcode='22023',message='marketplace_product_review_invalid_input';
  end if;
  select * into v_item from public.marketplace_order_items where id=p_order_item_id for share;
  if not found then raise exception using errcode='P0002',message='marketplace_review_purchase_not_found';end if;
  select * into v_order from public.marketplace_orders where id=v_item.order_id for share;
  if not found or v_order.buyer_id<>v_actor then raise exception using errcode='42501',message='marketplace_review_purchase_not_owned';end if;
  if v_order.status<>'delivered' or v_order.delivered_at is null then raise exception using errcode='22023',message='marketplace_review_purchase_not_delivered';end if;
  if (v_item.order_id,v_item.checkout_id,v_item.seller_id,v_item.store_id) is distinct from
     (v_order.id,v_order.checkout_id,v_order.seller_id,v_order.store_id) then
    raise exception using errcode='22023',message='marketplace_review_purchase_identity_invalid';
  end if;
  if v_order.buyer_id=v_order.seller_id then raise exception using errcode='42501',message='marketplace_review_self_review_forbidden';end if;
  insert into public.marketplace_product_reviews(
    buyer_id,product_id,seller_id,store_id,order_id,order_item_id,rating,comment
  )values(v_actor,v_item.product_id,v_item.seller_id,v_item.store_id,v_item.order_id,v_item.id,p_rating,v_comment)
  on conflict(order_item_id)do update set rating=excluded.rating,comment=excluded.comment
  where marketplace_product_reviews.buyer_id=excluded.buyer_id
    and marketplace_product_reviews.product_id=excluded.product_id
    and marketplace_product_reviews.seller_id=excluded.seller_id
    and marketplace_product_reviews.store_id=excluded.store_id
    and marketplace_product_reviews.order_id=excluded.order_id
  returning * into v_review;
  if not found then raise exception using errcode='42501',message='marketplace_review_identity_conflict';end if;
  select * into v_profile from public.user_profiles where id=v_actor;
  return jsonb_build_object(
    'id',v_review.id,'rating',v_review.rating,'comment',v_review.comment,
    'status',v_review.status,'created_at',v_review.created_at,'updated_at',v_review.updated_at,
    'verified_purchase',true,
    'reviewer',jsonb_build_object('display_name',coalesce(nullif(btrim(v_profile.display_name),''),nullif(btrim(v_profile.username),''),'Comprador'),'username',v_profile.username,'avatar_url',v_profile.avatar_url)
  );
end$$;

create or replace function public.submit_my_marketplace_seller_review(
  p_order_id uuid,p_rating integer,p_comment text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
  v_order public.marketplace_orders;v_review public.marketplace_seller_reviews;v_profile public.user_profiles;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_review_auth_required';end if;
  if p_order_id is null or p_rating is null or p_rating<1 or p_rating>5 or char_length(coalesce(v_comment,''))>1000 then
    raise exception using errcode='22023',message='marketplace_seller_review_invalid_input';
  end if;
  select * into v_order from public.marketplace_orders where id=p_order_id for share;
  if not found or v_order.buyer_id<>v_actor then raise exception using errcode='42501',message='marketplace_review_purchase_not_owned';end if;
  if v_order.status<>'delivered' or v_order.delivered_at is null then raise exception using errcode='22023',message='marketplace_review_purchase_not_delivered';end if;
  if v_order.buyer_id=v_order.seller_id then raise exception using errcode='42501',message='marketplace_review_self_review_forbidden';end if;
  insert into public.marketplace_seller_reviews(buyer_id,seller_id,store_id,order_id,rating,comment)
  values(v_actor,v_order.seller_id,v_order.store_id,v_order.id,p_rating,v_comment)
  on conflict(order_id)do update set rating=excluded.rating,comment=excluded.comment
  where marketplace_seller_reviews.buyer_id=excluded.buyer_id
    and marketplace_seller_reviews.seller_id=excluded.seller_id
    and marketplace_seller_reviews.store_id=excluded.store_id
  returning * into v_review;
  if not found then raise exception using errcode='42501',message='marketplace_review_identity_conflict';end if;
  select * into v_profile from public.user_profiles where id=v_actor;
  return jsonb_build_object(
    'id',v_review.id,'rating',v_review.rating,'comment',v_review.comment,
    'status',v_review.status,'created_at',v_review.created_at,'updated_at',v_review.updated_at,
    'verified_purchase',true,
    'reviewer',jsonb_build_object('display_name',coalesce(nullif(btrim(v_profile.display_name),''),nullif(btrim(v_profile.username),''),'Comprador'),'username',v_profile.username,'avatar_url',v_profile.avatar_url)
  );
end$$;

create or replace function public.search_marketplace_product_reviews(
  p_product_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_result jsonb;
begin
  if p_product_id is null or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_review_search_invalid_input';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='marketplace_review_cursor_invalid';end if;
  if not exists(select 1 from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_categories c on c.id=p.category_id where p.id=p_product_id and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and s.status='active'and c.status='active'and public.marketplace_seller_is_approved(p.seller_id)) then raise exception using errcode='P0002',message='marketplace_product_not_found';end if;
  with candidate as materialized(
    select r.id,r.rating,r.comment,r.created_at,r.updated_at,
      jsonb_build_object('display_name',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(u.username),''),'Comprador'),'username',u.username,'avatar_url',u.avatar_url)reviewer
    from public.marketplace_product_reviews r join public.user_profiles u on u.id=r.buyer_id
    where r.product_id=p_product_id and r.status='visible'
      and(p_before_created_at is null or(r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ),page as(select * from candidate order by created_at desc,id desc limit p_limit),stats as(select count(*)n from candidate),terminal as(select created_at,id from page order by created_at,id limit 1)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'rating',rating,'comment',comment,'verified_purchase',true,'reviewer',reviewer,'created_at',created_at,'updated_at',updated_at)order by created_at desc,id desc)from page),'[]'::jsonb),
    'page_size',(select count(*)from page),
    'next_cursor',case when(select n from stats)>p_limit then(select jsonb_build_object('created_at',created_at,'id',id)from terminal)else null end
  )into v_result;
  return v_result;
end$$;

create or replace function public.search_marketplace_store_reviews(
  p_store_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_result jsonb;
begin
  if p_store_id is null or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_review_search_invalid_input';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='marketplace_review_cursor_invalid';end if;
  if not exists(select 1 from public.marketplace_stores s where s.id=p_store_id and s.status='active'and public.marketplace_seller_is_approved(s.seller_id)) then raise exception using errcode='P0002',message='marketplace_store_not_found';end if;
  with candidate as materialized(
    select r.id,r.rating,r.comment,r.created_at,r.updated_at,
      jsonb_build_object('display_name',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(u.username),''),'Comprador'),'username',u.username,'avatar_url',u.avatar_url)reviewer
    from public.marketplace_seller_reviews r join public.user_profiles u on u.id=r.buyer_id
    where r.store_id=p_store_id and r.status='visible'
      and(p_before_created_at is null or(r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ),page as(select * from candidate order by created_at desc,id desc limit p_limit),stats as(select count(*)n from candidate),terminal as(select created_at,id from page order by created_at,id limit 1)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'rating',rating,'comment',comment,'verified_purchase',true,'reviewer',reviewer,'created_at',created_at,'updated_at',updated_at)order by created_at desc,id desc)from page),'[]'::jsonb),
    'page_size',(select count(*)from page),
    'next_cursor',case when(select n from stats)>p_limit then(select jsonb_build_object('created_at',created_at,'id',id)from terminal)else null end
  )into v_result;
  return v_result;
end$$;

create or replace function public.get_marketplace_product_reputation(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();v_product public.products;v_store public.marketplace_stores;
  v_item_id uuid;v_order_id uuid;v_product_review jsonb;v_seller_review jsonb;v_result jsonb;
begin
  select p.* into v_product from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_categories c on c.id=p.category_id
  where p.id=p_product_id and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and s.status='active'and c.status='active'and public.marketplace_seller_is_approved(p.seller_id);
  if not found then raise exception using errcode='P0002',message='marketplace_product_not_found';end if;
  select * into v_store from public.marketplace_stores where id=v_product.store_id;
  if v_actor is not null then
    select i.id,o.id into v_item_id,v_order_id from public.marketplace_order_items i join public.marketplace_orders o on o.id=i.order_id
    where i.product_id=v_product.id and o.buyer_id=v_actor and o.status='delivered'and o.delivered_at is not null
    order by o.delivered_at desc,i.created_at desc,i.id desc limit 1;
    if v_item_id is not null then select jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at)into v_product_review from public.marketplace_product_reviews r where r.order_item_id=v_item_id and r.buyer_id=v_actor;end if;
    select o.id into v_order_id from public.marketplace_orders o where o.store_id=v_store.id and o.buyer_id=v_actor and o.status='delivered'and o.delivered_at is not null order by o.delivered_at desc,o.id desc limit 1;
    if v_order_id is not null then select jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at)into v_seller_review from public.marketplace_seller_reviews r where r.order_id=v_order_id and r.buyer_id=v_actor;end if;
  end if;
  select jsonb_build_object(
    'product_id',v_product.id,
    'product_aggregate',jsonb_build_object(
      'average_rating',(select round(avg(r.rating)::numeric,2)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'),
      'review_count',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'),
      'distribution',jsonb_build_object(
        '1',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'and r.rating=1),
        '2',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'and r.rating=2),
        '3',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'and r.rating=3),
        '4',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'and r.rating=4),
        '5',(select count(*)from public.marketplace_product_reviews r where r.product_id=v_product.id and r.status='visible'and r.rating=5))),
    'store',jsonb_build_object(
      'id',v_store.id,'seller_id',v_store.seller_id,'name',v_store.name,'slug',v_store.slug,'description',v_store.description,
      'logo_url',(select a.public_url from public.media_assets a where a.id=v_store.logo_asset_id and a.owner_id=v_store.seller_id and a.status='ready'and a.visibility='public'and a.media_kind='image'and a.purpose='store_logo'),
      'banner_url',(select a.public_url from public.media_assets a where a.id=v_store.banner_asset_id and a.owner_id=v_store.seller_id and a.status='ready'and a.visibility='public'and a.media_kind='image'and a.purpose='store_banner'),
      'seller_display_name',(select ms.display_name from public.marketplace_sellers ms where ms.user_id=v_store.seller_id),
      'seller_username',(select u.username from public.user_profiles u where u.id=v_store.seller_id)),
    'seller_aggregate',jsonb_build_object(
      'average_rating',(select round(avg(r.rating)::numeric,2)from public.marketplace_seller_reviews r where r.store_id=v_store.id and r.status='visible'),
      'review_count',(select count(*)from public.marketplace_seller_reviews r where r.store_id=v_store.id and r.status='visible')),
    'product_eligibility',jsonb_build_object('eligible',v_item_id is not null,'order_item_id',v_item_id,'review',v_product_review),
    'seller_eligibility',jsonb_build_object('eligible',v_order_id is not null,'order_id',v_order_id,'review',v_seller_review)
  )into v_result;
  return v_result;
end$$;

create or replace function public.get_marketplace_store_reputation(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_store public.marketplace_stores;v_result jsonb;
begin
  select * into v_store from public.marketplace_stores s where s.id=p_store_id and s.status='active'and public.marketplace_seller_is_approved(s.seller_id);
  if not found then raise exception using errcode='P0002',message='marketplace_store_not_found';end if;
  select jsonb_build_object(
    'store',jsonb_build_object('id',v_store.id,'seller_id',v_store.seller_id,'name',v_store.name,'slug',v_store.slug,'description',v_store.description,
      'logo_url',(select a.public_url from public.media_assets a where a.id=v_store.logo_asset_id and a.owner_id=v_store.seller_id and a.status='ready'and a.visibility='public'and a.media_kind='image'and a.purpose='store_logo'),
      'banner_url',(select a.public_url from public.media_assets a where a.id=v_store.banner_asset_id and a.owner_id=v_store.seller_id and a.status='ready'and a.visibility='public'and a.media_kind='image'and a.purpose='store_banner'),
      'seller_display_name',(select ms.display_name from public.marketplace_sellers ms where ms.user_id=v_store.seller_id),
      'seller_username',(select u.username from public.user_profiles u where u.id=v_store.seller_id)),
    'seller_aggregate',jsonb_build_object('average_rating',(select round(avg(r.rating)::numeric,2)from public.marketplace_seller_reviews r where r.store_id=v_store.id and r.status='visible'),'review_count',(select count(*)from public.marketplace_seller_reviews r where r.store_id=v_store.id and r.status='visible')),
    'product_aggregate',jsonb_build_object('average_rating',(select round(avg(r.rating)::numeric,2)from public.marketplace_product_reviews r where r.store_id=v_store.id and r.status='visible'),'review_count',(select count(*)from public.marketplace_product_reviews r where r.store_id=v_store.id and r.status='visible'))
  )into v_result;return v_result;
end$$;

create or replace function public.reconcile_marketplace_reviews()
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$select jsonb_build_object(
  'product_identity_mismatch',(select count(*)from public.marketplace_product_reviews r join public.marketplace_order_items i on i.id=r.order_item_id join public.marketplace_orders o on o.id=i.order_id where(r.buyer_id,r.product_id,r.seller_id,r.store_id,r.order_id)is distinct from(o.buyer_id,i.product_id,i.seller_id,i.store_id,i.order_id)),
  'product_without_delivery',(select count(*)from public.marketplace_product_reviews r join public.marketplace_orders o on o.id=r.order_id where o.status<>'delivered'or o.delivered_at is null),
  'seller_identity_mismatch',(select count(*)from public.marketplace_seller_reviews r join public.marketplace_orders o on o.id=r.order_id where(r.buyer_id,r.seller_id,r.store_id)is distinct from(o.buyer_id,o.seller_id,o.store_id)),
  'seller_without_delivery',(select count(*)from public.marketplace_seller_reviews r join public.marketplace_orders o on o.id=r.order_id where o.status<>'delivered'or o.delivered_at is null),
  'self_reviews',(select(select count(*)from public.marketplace_product_reviews r where r.buyer_id=r.seller_id)+(select count(*)from public.marketplace_seller_reviews r where r.buyer_id=r.seller_id))
)$$;

revoke all on function public.submit_my_marketplace_product_review(uuid,integer,text),public.submit_my_marketplace_seller_review(uuid,integer,text),public.search_marketplace_product_reviews(uuid,timestamptz,uuid,integer),public.search_marketplace_store_reviews(uuid,timestamptz,uuid,integer),public.get_marketplace_product_reputation(uuid),public.get_marketplace_store_reputation(uuid),public.reconcile_marketplace_reviews() from public,anon,authenticated;
grant execute on function public.submit_my_marketplace_product_review(uuid,integer,text),public.submit_my_marketplace_seller_review(uuid,integer,text) to authenticated,service_role;
grant execute on function public.search_marketplace_product_reviews(uuid,timestamptz,uuid,integer),public.search_marketplace_store_reviews(uuid,timestamptz,uuid,integer),public.get_marketplace_product_reputation(uuid),public.get_marketplace_store_reputation(uuid) to anon,authenticated,service_role;
grant execute on function public.reconcile_marketplace_reviews() to service_role;

comment on table public.marketplace_product_reviews is 'Verified delivered-purchase product reputation. Public reads use bounded projections; moderation may hide without deleting purchase linkage.';
comment on table public.marketplace_seller_reviews is 'Verified delivered-order seller/store reputation, distinct from product sentiment.';

notify pgrst,'reload schema';
commit;
