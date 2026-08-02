begin;

create table public.live_commerce_commands (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null references public.live_sessions(id) on delete restrict,
  command_type text not null check(command_type in ('pin','unpin','feature')),
  idempotency_key uuid not null,
  request_fingerprint text not null check(char_length(request_fingerprint)>0),
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.live_commerce_commands enable row level security;
revoke all on public.live_commerce_commands from public,anon,authenticated;

create or replace function public.marketplace_safe_public_image_url(p_url text)
returns text language sql immutable strict set search_path=public as $$
  select case when p_url ~ '^https://[^[:space:]]+$'
    and lower(p_url) !~ '[?&](token|access_token|signature|expires|x-amz-[^=&#]*)='
    then p_url else null end
$$;

create or replace function public.fetch_live_session_products(p_session_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'product_id',q.product_id,'store_id',q.store_id,'store_name',q.store_name,
  'seller_name',q.seller_name,'title',q.title,'description',q.description,'image_url',q.image_url,
  'min_price',q.min_price,'max_price',q.max_price,'compare_at_price',q.compare_at_price,
  'active_variant_count',q.variant_count,'available_quantity',q.available_quantity,
  'featured_variant_id',q.safe_featured_variant_id,'is_featured',q.is_featured,
  'position',q.position,'availability',case when q.eligible and q.available_quantity>0 then 'available'
    when q.eligible then 'out_of_stock' else 'product_unavailable' end
) order by q.is_featured desc,q.position,q.id),'[]'::jsonb)
from (
  select lp.id,lp.product_id,lp.store_id,lp.featured_variant_id,lp.is_featured,lp.position,
    st.name store_name,coalesce(up.display_name,up.username) seller_name,p.title,p.description,
    public.marketplace_safe_public_image_url(p.images[1]) image_url,
    min(v.price) filter(where v.status='active' and v.archived_at is null) min_price,
    max(v.price) filter(where v.status='active' and v.archived_at is null) max_price,
    max(v.compare_at_price) filter(where v.status='active' and v.archived_at is null) compare_at_price,
    count(v.id) filter(where v.status='active' and v.archived_at is null) variant_count,
    coalesce(sum(greatest(i.on_hand-i.reserved,0)) filter(where v.status='active' and v.archived_at is null),0) available_quantity,
    (array_agg(v.id order by v.id) filter(where v.id=lp.featured_variant_id and v.status='active' and v.archived_at is null
      and greatest(coalesce(i.on_hand,0)-coalesce(i.reserved,0),0)>0))[1] safe_featured_variant_id,
    p.status='active' and p.moderation_status='approved' and p.deleted_at is null
      and p.product_type='physical' and p.currency='BDAG' and st.status='active' and ms.status='approved' eligible
  from public.live_session_products lp
  join public.live_sessions l on l.id=lp.session_id and l.status='live'
  join public.products p on p.id=lp.product_id
  join public.marketplace_stores st on st.id=lp.store_id
  join public.marketplace_sellers ms on ms.user_id=lp.seller_id
  join public.user_profiles up on up.id=lp.seller_id
  left join public.marketplace_product_variants v on v.product_id=p.id
  left join public.marketplace_inventory_levels i on i.variant_id=v.id
  where lp.session_id=p_session_id and lp.status='active'
  group by lp.id,st.id,up.id,p.id,ms.user_id
)q
$$;

create or replace function public.fetch_my_live_product_candidates(
  p_session_id uuid,p_limit integer default 20,p_before_updated_at timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c record; n integer:=least(greatest(coalesce(p_limit,20),1),50); rows_json jsonb; extra boolean;
begin
  if (p_before_updated_at is null)<>(p_before_id is null) then raise exception using message='live_commerce_invalid_cursor'; end if;
  select * into c from public.live_commerce_host_context(p_session_id);
  with candidates as (
    select p.id,p.store_id,s.name store_name,p.title,public.marketplace_safe_public_image_url(p.images[1]) image_url,
      p.updated_at,min(v.price) min_price,max(v.price) max_price,count(v.id) active_variant_count,
      coalesce(sum(greatest(i.on_hand-i.reserved,0)),0) available_quantity,
      pin.id pin_id,(pin.id is not null) is_pinned,coalesce(pin.is_featured,false) is_featured
    from public.products p join public.marketplace_stores s on s.id=p.store_id
    left join public.marketplace_product_variants v on v.product_id=p.id and v.status='active' and v.archived_at is null
    left join public.marketplace_inventory_levels i on i.variant_id=v.id
    left join lateral(select lp.id,lp.is_featured from public.live_session_products lp
      where lp.session_id=p_session_id and lp.product_id=p.id and lp.status='active'
      order by lp.pinned_at desc,lp.id desc limit 1)pin on true
    where p.seller_id=c.host_id and p.store_id=c.store_id and p.status='active' and p.moderation_status='approved'
      and p.deleted_at is null and p.product_type='physical' and p.currency='BDAG'
      and (p_before_updated_at is null or (p.updated_at,p.id)<(p_before_updated_at,p_before_id))
    group by p.id,s.id,pin.id,pin.is_featured order by p.updated_at desc,p.id desc limit n+1
  ), numbered as(select *,row_number()over(order by updated_at desc,id desc)rn from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('product_id',id,'store_id',store_id,'store_name',store_name,'title',title,
    'image_url',image_url,'min_price',min_price,'max_price',max_price,'active_variant_count',active_variant_count,
    'available_quantity',available_quantity,'pin_id',pin_id,'is_pinned',is_pinned,'is_featured',is_featured,
    'updated_at',updated_at)order by updated_at desc,id desc)filter(where rn<=n),'[]'::jsonb),bool_or(rn>n)
  into rows_json,extra from numbered;
  return jsonb_build_object('items',rows_json,'next_cursor',case when coalesce(extra,false) then
    (select jsonb_build_object('updated_at',x->>'updated_at','id',x->>'product_id') from jsonb_array_elements(rows_json)x order by x->>'updated_at',x->>'product_id' limit 1)
    else null end);
end$$;

create or replace function public.pin_live_session_product(p_session_id uuid,p_product_id uuid,p_featured_variant_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); fingerprint text; prior public.live_commerce_commands; c record;p public.products;v public.marketplace_product_variants;r public.live_session_products;result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='live_commerce_auth_required';end if;
  if p_session_id is null or p_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;
  fingerprint:=encode(extensions.digest(concat_ws('|','pin',p_session_id,p_product_id,coalesce(p_featured_variant_id::text,'')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;
  if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;
  select*into c from public.live_commerce_host_context(p_session_id);perform pg_advisory_xact_lock(hashtextextended('live-pin:'||p_session_id,0));
  select*into p from public.products where id=p_product_id and seller_id=c.host_id and store_id=c.store_id;
  if not found or p.status<>'active'or p.moderation_status<>'approved'or p.product_type<>'physical'or p.currency<>'BDAG'or p.deleted_at is not null then raise exception using message='live_commerce_product_unavailable';end if;
  if p_featured_variant_id is not null then select*into v from public.marketplace_product_variants where id=p_featured_variant_id and product_id=p.id and status='active'and archived_at is null;if not found then raise exception using message='live_commerce_invalid_variant';end if;end if;
  if not exists(select 1 from public.marketplace_product_variants x join public.marketplace_inventory_levels i on i.variant_id=x.id where x.product_id=p.id and x.status='active'and x.archived_at is null and i.on_hand>i.reserved)then raise exception using message='live_commerce_out_of_stock';end if;
  select*into r from public.live_session_products where session_id=p_session_id and product_id=p.id and status='active';
  if not found then if(select count(*)from public.live_session_products where session_id=p_session_id and status='active')>=20 then raise exception using message='live_commerce_pin_limit';end if;
    insert into public.live_session_products(session_id,host_id,seller_id,store_id,product_id,featured_variant_id,is_featured,position)values(p_session_id,c.host_id,c.host_id,c.store_id,p.id,p_featured_variant_id,false,(select count(*)from public.live_session_products where session_id=p_session_id and status='active'))returning*into r;
  end if;
  result:=jsonb_build_object('id',r.id,'status',r.status,'is_featured',r.is_featured);
  insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'pin',p_idempotency_key,fingerprint,result);
  return result;
end$$;

create or replace function public.unpin_live_session_product(p_session_id uuid,p_live_session_product_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();fingerprint text;prior public.live_commerce_commands;c record;r public.live_session_products;result jsonb;
begin
  if actor is null or p_session_id is null or p_live_session_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;
  fingerprint:=encode(extensions.digest(concat_ws('|','unpin',p_session_id,p_live_session_product_id),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;
  select*into c from public.live_commerce_host_context(p_session_id);select*into r from public.live_session_products where id=p_live_session_product_id and session_id=p_session_id for update;if not found then raise exception using message='live_commerce_pin_not_found';end if;
  if r.status='active'then update public.live_session_products set status='removed',is_featured=false,unpinned_at=now(),version=version+1 where id=r.id returning*into r;end if;
  result:=jsonb_build_object('id',r.id,'status',r.status);insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'unpin',p_idempotency_key,fingerprint,result);return result;
end$$;

create or replace function public.feature_live_session_product(p_session_id uuid,p_live_session_product_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();fingerprint text;prior public.live_commerce_commands;c record;r public.live_session_products;result jsonb;
begin
  if actor is null or p_session_id is null or p_live_session_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;
  fingerprint:=encode(extensions.digest(concat_ws('|','feature',p_session_id,p_live_session_product_id),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;
  select*into c from public.live_commerce_host_context(p_session_id);perform pg_advisory_xact_lock(hashtextextended('live-feature:'||p_session_id,0));select*into r from public.live_session_products where id=p_live_session_product_id and session_id=p_session_id and status='active'for update;if not found then raise exception using message='live_commerce_pin_not_found';end if;
  if not exists(select 1 from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_sellers ms on ms.user_id=p.seller_id join public.marketplace_product_variants v on v.product_id=p.id and v.status='active'and v.archived_at is null join public.marketplace_inventory_levels i on i.variant_id=v.id and i.on_hand>i.reserved where p.id=r.product_id and p.seller_id=r.seller_id and p.store_id=r.store_id and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and p.product_type='physical'and p.currency='BDAG'and s.status='active'and ms.status='approved')then raise exception using message='live_commerce_product_unavailable';end if;
  update public.live_session_products set is_featured=(id=r.id),version=version+1 where session_id=p_session_id and status='active'and is_featured is distinct from(id=r.id);
  result:=jsonb_build_object('id',r.id,'is_featured',true);insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'feature',p_idempotency_key,fingerprint,result);return result;
end$$;

create or replace function public.fetch_my_active_live_checkout(p_session_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('checkout_id',c.id,'reference',c.reference,'status',c.status,'expires_at',c.expires_at,'total',c.total,'currency',c.currency,'order_id',o.id,'session_id',src.live_session_id,'pin_id',src.live_session_product_id,'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'variant_id',i.variant_id,'title',i.product_title,'variant_title',i.variant_title,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,'image_url',public.marketplace_safe_public_image_url(i.image_url)))from public.marketplace_order_items i where i.order_id=o.id),'[]'::jsonb))
from public.marketplace_checkout_sessions c join public.marketplace_orders o on o.checkout_id=c.id join public.marketplace_live_order_sources src on src.order_id=o.id
where c.buyer_id=auth.uid()and c.status='pending_payment'and c.expires_at>now()and src.live_session_id=p_session_id order by c.created_at desc limit 1
$$;

revoke all on function public.marketplace_safe_public_image_url(text),public.fetch_my_live_product_candidates(uuid,integer,timestamptz,uuid),public.pin_live_session_product(uuid,uuid,uuid,uuid),public.unpin_live_session_product(uuid,uuid,uuid),public.feature_live_session_product(uuid,uuid,uuid),public.fetch_my_active_live_checkout(uuid) from public,anon;
grant execute on function public.fetch_my_live_product_candidates(uuid,integer,timestamptz,uuid),public.pin_live_session_product(uuid,uuid,uuid,uuid),public.unpin_live_session_product(uuid,uuid,uuid),public.feature_live_session_product(uuid,uuid,uuid),public.fetch_my_active_live_checkout(uuid) to authenticated,service_role;
grant execute on function public.marketplace_safe_public_image_url(text) to service_role;
commit;
