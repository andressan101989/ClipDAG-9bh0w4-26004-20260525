create table public.marketplace_creator_showcase_items(
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id),
  seller_id uuid not null references public.marketplace_sellers(user_id),
  store_id uuid not null references public.marketplace_stores(id),
  product_id uuid not null references public.products(id),
  selected_entitlement_id uuid not null references public.marketplace_live_affiliate_offers(id),
  status text not null default 'active' check(status in('active','removed')),
  sort_position integer not null check(sort_position>=0 and sort_position<=1000000),
  selected_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_creator_showcase_status_time_check check(
    (status='active' and removed_at is null) or(status='removed' and removed_at is not null)),
  constraint marketplace_creator_showcase_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$')
);

create unique index marketplace_creator_showcase_active_product_unique
  on public.marketplace_creator_showcase_items(creator_user_id,product_id)
  where status='active';
create index marketplace_creator_showcase_public_order_idx
  on public.marketplace_creator_showcase_items(creator_user_id,status,sort_position,id);
create index marketplace_creator_showcase_product_idx
  on public.marketplace_creator_showcase_items(product_id,creator_user_id);

create table public.marketplace_creator_showcase_commands(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  command_type text not null check(command_type in('add','remove','reorder')),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_creator_showcase_command_key unique(actor_id,idempotency_key),
  constraint marketplace_creator_showcase_command_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$')
);

alter table public.marketplace_creator_showcase_items enable row level security;
alter table public.marketplace_creator_showcase_commands enable row level security;

create or replace function public.marketplace_reject_creator_showcase_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' or coalesce(current_setting(
    'marketplace.creator_showcase_authorized_mutation',true),'')<>'on' then
    raise exception using errcode='42501',message='marketplace_creator_showcase_immutable';
  end if;
  if (to_jsonb(new)-array['status','sort_position','removed_at','updated_at'])
      is distinct from
     (to_jsonb(old)-array['status','sort_position','removed_at','updated_at'])
    or old.status='removed' or new.status not in('active','removed') then
    raise exception using errcode='42501',message='marketplace_creator_showcase_immutable';
  end if;
  return new;
end$$;

create trigger marketplace_creator_showcase_items_guard
before update or delete on public.marketplace_creator_showcase_items
for each row execute function public.marketplace_reject_creator_showcase_mutation();

create trigger marketplace_creator_showcase_commands_immutable
before update or delete on public.marketplace_creator_showcase_commands
for each row execute function public.marketplace_reject_creator_commerce_snapshot_mutation();

alter table public.marketplace_creator_commerce_attributions
  drop constraint marketplace_creator_attribution_source_check;
alter table public.marketplace_creator_commerce_attributions
  add constraint marketplace_creator_attribution_source_check
  check(source_surface in('live','direct_creator_link','creator_showcase'));
alter table public.marketplace_order_item_creator_attributions
  drop constraint marketplace_item_attribution_source_check;
alter table public.marketplace_order_item_creator_attributions
  add constraint marketplace_item_attribution_source_check
  check(source_surface in('live','direct_creator_link','creator_showcase'));

create or replace function public.marketplace_create_creator_commerce_attribution_internal(
  p_entitlement_id uuid,p_creator_user_id uuid,p_variant_id uuid,
  p_source_surface text,p_source_entity_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_offer public.marketplace_live_affiliate_offers;
  v_product public.products;v_variant public.marketplace_product_variants;
  v_prior public.marketplace_creator_commerce_attributions;
  v_showcase public.marketplace_creator_showcase_items;
  v_id uuid:=gen_random_uuid();v_fingerprint text;v_now timestamptz:=clock_timestamp();
begin
  if p_entitlement_id is null or p_creator_user_id is null or p_source_entity_id is null
    or p_idempotency_key is null
    or p_source_surface not in('live','direct_creator_link','creator_showcase') then
    raise exception using errcode='22023',message='marketplace_creator_attribution_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|',
    'marketplace_creator_commerce_attribution',p_entitlement_id,p_creator_user_id,
    coalesce(p_variant_id::text,''),p_source_surface,p_source_entity_id),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-creator-attribution-key:'||p_idempotency_key::text,0));
  select * into v_prior from public.marketplace_creator_commerce_attributions
    where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_creator_attribution_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_prior.id,'entitlement_id',v_prior.entitlement_id,
      'creator_user_id',v_prior.creator_user_id,'product_id',v_prior.product_id,
      'variant_id',v_prior.variant_id,'commission_bps',v_prior.commission_bps,
      'source_surface',v_prior.source_surface,'source_entity_id',v_prior.source_entity_id,
      'attributed_at',v_prior.attributed_at,'expires_at',v_prior.expires_at);
  end if;
  select * into v_offer from public.marketplace_live_affiliate_offers
    where id=p_entitlement_id;
  if found then
    perform 1 from public.products where id=v_offer.product_id for share;
    select * into v_offer from public.marketplace_live_affiliate_offers
      where id=p_entitlement_id for share;
  end if;
  if not found or v_offer.status<>'active'
    or(v_offer.starts_at is not null and v_offer.starts_at>v_now)
    or(v_offer.ends_at is not null and v_offer.ends_at<=v_now)
    or(v_offer.offer_scope='specific_creator' and v_offer.creator_id<>p_creator_user_id)
    or(v_offer.offer_scope='public_creator' and v_offer.creator_id is not null) then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_ineligible';
  end if;
  select * into v_product from public.products where id=v_offer.product_id;
  if not found or v_product.seller_id<>v_offer.seller_id or v_product.store_id<>v_offer.store_id
    or v_product.status<>'active' or v_product.moderation_status<>'approved'
    or v_product.published_at is null or v_product.deleted_at is not null
    or v_product.product_type<>'physical' or v_product.currency<>'BDAG'
    or not exists(select 1 from public.marketplace_stores s
      where s.id=v_offer.store_id and s.seller_id=v_offer.seller_id and s.status='active')
    or not exists(select 1 from public.marketplace_sellers s
      where s.user_id=v_offer.seller_id and s.status='approved') then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_product_ineligible';
  end if;
  if p_creator_user_id=v_offer.seller_id
    or not exists(select 1 from auth.users u where u.id=p_creator_user_id) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_creator_invalid';
  end if;
  if p_variant_id is not null then
    select * into v_variant from public.marketplace_product_variants where id=p_variant_id;
    if not found or v_variant.product_id<>v_offer.product_id or v_variant.seller_id<>v_offer.seller_id
      or v_variant.store_id<>v_offer.store_id or v_variant.status<>'active'
      or v_variant.archived_at is not null then
      raise exception using errcode='23514',message='marketplace_creator_attribution_variant_mismatch';
    end if;
  end if;
  if p_source_surface='direct_creator_link' and p_source_entity_id<>p_entitlement_id then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  if p_source_surface='live' and not exists(
    select 1 from public.live_session_products pin
    where pin.id=p_source_entity_id and pin.affiliate_offer_id=v_offer.id
      and pin.product_id=v_offer.product_id and pin.seller_id=v_offer.seller_id
      and pin.store_id=v_offer.store_id and pin.host_id=p_creator_user_id
      and pin.commerce_mode='affiliate_product' and pin.creator_commission_bps=v_offer.commission_bps) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  if p_source_surface='creator_showcase' then
    select * into v_showcase from public.marketplace_creator_showcase_items
      where id=p_source_entity_id for share;
    if not found or v_showcase.status<>'active'
      or v_showcase.creator_user_id<>p_creator_user_id
      or v_showcase.product_id<>v_offer.product_id
      or v_showcase.seller_id<>v_offer.seller_id or v_showcase.store_id<>v_offer.store_id then
      raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
    end if;
  end if;
  insert into public.marketplace_creator_commerce_attributions(
    id,entitlement_id,seller_id,store_id,product_id,variant_id,creator_user_id,
    commission_bps,source_surface,source_entity_id,authorized_by,
    entitlement_updated_at_attribution,attributed_at,expires_at,idempotency_key,request_fingerprint)
  values(v_id,v_offer.id,v_offer.seller_id,v_offer.store_id,v_offer.product_id,p_variant_id,
    p_creator_user_id,v_offer.commission_bps,p_source_surface,p_source_entity_id,
    v_offer.seller_id,v_offer.updated_at,v_now,v_offer.ends_at,p_idempotency_key,v_fingerprint);
  return jsonb_build_object('id',v_id,'entitlement_id',v_offer.id,
    'creator_user_id',p_creator_user_id,'product_id',v_offer.product_id,
    'variant_id',p_variant_id,'commission_bps',v_offer.commission_bps,
    'source_surface',p_source_surface,'source_entity_id',p_source_entity_id,
    'attributed_at',v_now,'expires_at',v_offer.ends_at);
end$$;

create or replace function public.get_my_marketplace_creator_eligible_products(
  p_search text default null,p_limit integer default 20,
  p_before_updated_at timestamptz default null,p_before_id uuid default null
)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
  v_items jsonb;v_more boolean;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if(p_before_updated_at is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_cursor';
  end if;
  with offered as(
    select distinct o.product_id from public.marketplace_live_affiliate_offers o
    where o.status='active' and(o.starts_at is null or o.starts_at<=now())
      and(o.ends_at is null or o.ends_at>now())
      and(o.offer_scope='public_creator' or(o.offer_scope='specific_creator' and o.creator_id=v_actor))
  ),candidate as(
    select p.id product_id,p.updated_at,p.title,p.seller_id,p.store_id,st.name store_name,
      coalesce(up.display_name,up.username,'Vendedor') seller_name,
      public.marketplace_safe_public_image_url(p.images[1]) image_url,
      coalesce(min(v.price)filter(where v.status='active' and v.archived_at is null),p.price) min_price,
      coalesce(max(v.price)filter(where v.status='active' and v.archived_at is null),p.price) max_price,
      coalesce(sum(greatest(i.on_hand-i.reserved,0))filter(where v.status='active' and v.archived_at is null),0) available_quantity,
      offer.offer_id,offer.offer_scope,offer.commission_bps,
      selected.id showcase_item_id,selected.id is not null selected
    from offered e join public.products p on p.id=e.product_id
    join public.marketplace_stores st on st.id=p.store_id and st.seller_id=p.seller_id and st.status='active'
    join public.marketplace_sellers ms on ms.user_id=p.seller_id and ms.status='approved'
    left join public.user_profiles up on up.id=p.seller_id
    cross join lateral public.marketplace_resolve_live_affiliate_offer(p.id,v_actor)offer
    left join public.marketplace_product_variants v on v.product_id=p.id
    left join public.marketplace_inventory_levels i on i.variant_id=v.id
    left join lateral(select s.id from public.marketplace_creator_showcase_items s
      where s.creator_user_id=v_actor and s.product_id=p.id and s.status='active' limit 1)selected on true
    where p.seller_id<>v_actor and p.status='active' and p.moderation_status='approved'
      and p.published_at is not null and p.deleted_at is null and p.product_type='physical'
      and p.currency='BDAG' and(p_search is null or btrim(p_search)=''
        or p.title ilike '%'||btrim(p_search)||'%' or st.name ilike '%'||btrim(p_search)||'%')
      and(p_before_updated_at is null or(p.updated_at,p.id)<(p_before_updated_at,p_before_id))
    group by p.id,st.id,up.id,offer.offer_id,offer.offer_scope,offer.commission_bps,selected.id
    order by p.updated_at desc,p.id desc limit v_limit+1
  ),numbered as(select *,row_number()over(order by updated_at desc,product_id desc)rn from candidate)
  select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'title',title,
      'seller_id',seller_id,'store_id',store_id,'store_name',store_name,'seller_name',seller_name,
      'image_url',image_url,'min_price',min_price,'max_price',max_price,
      'available_quantity',available_quantity,'commission_bps',commission_bps,
      'offer_scope',offer_scope,'selected',selected,'showcase_item_id',showcase_item_id,
      'updated_at',updated_at)order by updated_at desc,product_id desc)filter(where rn<=v_limit),'[]'::jsonb),
    coalesce(bool_or(rn>v_limit),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then(
    select jsonb_build_object('updated_at',x->>'updated_at','id',x->>'product_id')
    from jsonb_array_elements(v_items)x order by x->>'updated_at',x->>'product_id' limit 1)else null end);
end$$;

create or replace function public.get_my_marketplace_creator_showcase(
  p_limit integer default 50,p_before_selected_at timestamptz default null,p_before_id uuid default null
)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);v_items jsonb;v_more boolean;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if(p_before_selected_at is null)<>(p_before_id is null)then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_cursor';end if;
  with rows as(
    select s.*,p.title,st.name store_name,public.marketplace_safe_public_image_url(p.images[1])image_url,
      coalesce(min(v.price)filter(where v.status='active'and v.archived_at is null),p.price)min_price,
      coalesce(sum(greatest(i.on_hand-i.reserved,0))filter(where v.status='active'and v.archived_at is null),0)available_quantity,
      offer.offer_id current_entitlement_id,offer.commission_bps current_commission_bps,
      offer.offer_id is not null and p.status='active'and p.moderation_status='approved'
        and p.published_at is not null and p.deleted_at is null and st.status='active'and ms.status='approved' current_eligible
    from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id
    join public.marketplace_stores st on st.id=s.store_id join public.marketplace_sellers ms on ms.user_id=s.seller_id
    left join lateral public.marketplace_resolve_live_affiliate_offer(s.product_id,s.creator_user_id)offer on true
    left join public.marketplace_product_variants v on v.product_id=p.id
    left join public.marketplace_inventory_levels i on i.variant_id=v.id
    where s.creator_user_id=v_actor and(p_before_selected_at is null or(s.selected_at,s.id)<(p_before_selected_at,p_before_id))
    group by s.id,p.id,st.id,ms.user_id,offer.offer_id,offer.commission_bps
    order by(s.status='active')desc,s.sort_position,s.selected_at desc,s.id desc limit v_limit+1
  ),numbered as(select *,row_number()over(order by(status='active')desc,sort_position,selected_at desc,id desc)rn from rows)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'title',title,
    'store_name',store_name,'image_url',image_url,'min_price',min_price,'available_quantity',available_quantity,
    'status',status,'sort_position',sort_position,'selected_at',selected_at,'removed_at',removed_at,
    'selected_entitlement_id',selected_entitlement_id,'current_entitlement_id',current_entitlement_id,
    'current_commission_bps',current_commission_bps,'current_eligible',current_eligible)
    order by(status='active')desc,sort_position,selected_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
    coalesce(bool_or(rn>v_limit),false)into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'has_more',v_more);
end$$;

create or replace function public.get_marketplace_creator_showcase(
  p_creator_user_id uuid,p_limit integer default 24,
  p_before_sort_position integer default null,p_before_id uuid default null
)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_viewer uuid:=auth.uid();v_limit integer:=least(greatest(coalesce(p_limit,24),1),48);v_items jsonb;v_more boolean;
begin
  if p_creator_user_id is null or(p_before_sort_position is null)<>(p_before_id is null)then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_cursor';end if;
  if exists(select 1 from public.blocked_users b where
      (b.blocker_id=v_viewer and b.blocked_id=p_creator_user_id)
      or(b.blocker_id=p_creator_user_id and b.blocked_id=v_viewer))
    or exists(select 1 from public.user_profiles u where u.id=p_creator_user_id and u.is_private
      and v_viewer is distinct from p_creator_user_id and not exists(select 1 from public.follows f
        where f.follower_id=v_viewer and f.following_id=p_creator_user_id)) then
    return jsonb_build_object('items','[]'::jsonb,'next_cursor',null,'visible',false);
  end if;
  with rows as(
    select s.id showcase_item_id,s.creator_user_id,s.product_id,s.sort_position,p.title,
      p.seller_id,p.store_id,st.name store_name,coalesce(up.display_name,up.username,'Vendedor')seller_name,
      public.marketplace_safe_public_image_url(p.images[1])image_url,
      coalesce(min(v.price)filter(where v.status='active'and v.archived_at is null),p.price)min_price,
      coalesce(max(v.price)filter(where v.status='active'and v.archived_at is null),p.price)max_price,
      coalesce(sum(greatest(i.on_hand-i.reserved,0))filter(where v.status='active'and v.archived_at is null),0)available_quantity
    from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id
    join public.marketplace_stores st on st.id=s.store_id and st.status='active'
    join public.marketplace_sellers ms on ms.user_id=s.seller_id and ms.status='approved'
    left join public.user_profiles up on up.id=s.seller_id
    cross join lateral public.marketplace_resolve_live_affiliate_offer(s.product_id,s.creator_user_id)offer
    left join public.marketplace_product_variants v on v.product_id=p.id
    left join public.marketplace_inventory_levels i on i.variant_id=v.id
    where s.creator_user_id=p_creator_user_id and s.status='active' and p.status='active'
      and p.moderation_status='approved' and p.published_at is not null and p.deleted_at is null
      and p.product_type='physical' and p.currency='BDAG'
      and(p_before_sort_position is null or(s.sort_position,s.id)>(p_before_sort_position,p_before_id))
    group by s.id,p.id,st.id,up.id order by s.sort_position,s.id limit v_limit+1
  ),numbered as(select *,row_number()over(order by sort_position,showcase_item_id)rn from rows)
  select coalesce(jsonb_agg(jsonb_build_object('showcase_item_id',showcase_item_id,
    'creator_user_id',creator_user_id,'product_id',product_id,'title',title,'seller_id',seller_id,
    'store_id',store_id,'store_name',store_name,'seller_name',seller_name,'image_url',image_url,
    'min_price',min_price,'max_price',max_price,'available_quantity',available_quantity,
    'sort_position',sort_position)order by sort_position,showcase_item_id)filter(where rn<=v_limit),'[]'::jsonb),
    coalesce(bool_or(rn>v_limit),false)into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then(
    select jsonb_build_object('sort_position',(x->>'sort_position')::integer,'id',x->>'showcase_item_id')
    from jsonb_array_elements(v_items)x order by(x->>'sort_position')::integer desc,x->>'showcase_item_id' desc limit 1)
    else null end,'visible',true);
end$$;

create or replace function public.add_my_marketplace_creator_showcase_product(
  p_product_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_fp text;v_prior public.marketplace_creator_showcase_commands;
  v_product public.products;v_offer record;v_item public.marketplace_creator_showcase_items;v_result jsonb;v_position integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_product_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_input';end if;
  v_fp:=encode(extensions.digest(concat_ws('|','marketplace_creator_showcase_add',v_actor,p_product_id),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-command:'||v_actor||':'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_showcase_commands where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_fingerprint<>v_fp then raise exception using errcode='23505',message='marketplace_creator_showcase_idempotency_conflict';end if;return v_prior.result_json;end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase:'||v_actor,0));
  select * into v_product from public.products where id=p_product_id for share;
  if not found or v_product.seller_id=v_actor or v_product.status<>'active'
    or v_product.moderation_status<>'approved' or v_product.published_at is null
    or v_product.deleted_at is not null or v_product.product_type<>'physical' or v_product.currency<>'BDAG' then
    raise exception using errcode='22023',message='marketplace_creator_showcase_product_ineligible';end if;
  select * into v_offer from public.marketplace_resolve_live_affiliate_offer(p_product_id,v_actor);
  if not found then raise exception using errcode='22023',message='marketplace_creator_showcase_offer_ineligible';end if;
  perform 1 from public.marketplace_live_affiliate_offers where id=v_offer.offer_id for share;
  select * into v_item from public.marketplace_creator_showcase_items
    where creator_user_id=v_actor and product_id=p_product_id and status='active' for update;
  if not found then
    select coalesce(max(sort_position),-1)+1 into v_position from public.marketplace_creator_showcase_items
      where creator_user_id=v_actor and status='active';
    insert into public.marketplace_creator_showcase_items(creator_user_id,seller_id,store_id,
      product_id,selected_entitlement_id,sort_position,idempotency_key,request_fingerprint)
    values(v_actor,v_offer.seller_id,v_offer.store_id,p_product_id,v_offer.offer_id,v_position,p_idempotency_key,v_fp)
    returning * into v_item;
  end if;
  v_result:=jsonb_build_object('id',v_item.id,'creator_user_id',v_item.creator_user_id,
    'product_id',v_item.product_id,'selected_entitlement_id',v_item.selected_entitlement_id,
    'status',v_item.status,'sort_position',v_item.sort_position,'selected_at',v_item.selected_at);
  insert into public.marketplace_creator_showcase_commands(actor_id,command_type,idempotency_key,request_fingerprint,result_json)
    values(v_actor,'add',p_idempotency_key,v_fp,v_result);
  return v_result;
end$$;

create or replace function public.remove_my_marketplace_creator_showcase_product(
  p_showcase_item_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_fp text;v_prior public.marketplace_creator_showcase_commands;
  v_item public.marketplace_creator_showcase_items;v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_showcase_item_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_input';end if;
  v_fp:=encode(extensions.digest(concat_ws('|','marketplace_creator_showcase_remove',v_actor,p_showcase_item_id),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-command:'||v_actor||':'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_showcase_commands where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_fingerprint<>v_fp then raise exception using errcode='23505',message='marketplace_creator_showcase_idempotency_conflict';end if;return v_prior.result_json;end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase:'||v_actor,0));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-item:'||p_showcase_item_id,0));
  select * into v_item from public.marketplace_creator_showcase_items where id=p_showcase_item_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_creator_showcase_item_not_found';end if;
  if v_item.creator_user_id<>v_actor then raise exception using errcode='42501',message='marketplace_creator_showcase_forbidden';end if;
  if v_item.status='active' then
    perform set_config('marketplace.creator_showcase_authorized_mutation','on',true);
    update public.marketplace_creator_showcase_items set status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_item.id returning * into v_item;
  end if;
  v_result:=jsonb_build_object('id',v_item.id,'product_id',v_item.product_id,'status',v_item.status,'removed_at',v_item.removed_at);
  insert into public.marketplace_creator_showcase_commands(actor_id,command_type,idempotency_key,request_fingerprint,result_json)
    values(v_actor,'remove',p_idempotency_key,v_fp,v_result);
  return v_result;
end$$;

create or replace function public.reorder_my_marketplace_creator_showcase(
  p_showcase_item_ids uuid[],p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_fp text;v_prior public.marketplace_creator_showcase_commands;
  v_active integer;v_result jsonb;v_id uuid;v_position integer:=0;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_showcase_item_ids is null or p_idempotency_key is null or cardinality(p_showcase_item_ids)>100
    or cardinality(p_showcase_item_ids)<>(select count(distinct x)from unnest(p_showcase_item_ids)x) then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_reorder';end if;
  v_fp:=encode(extensions.digest(concat_ws('|','marketplace_creator_showcase_reorder',v_actor,
    array_to_string(p_showcase_item_ids,',')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-command:'||v_actor||':'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_showcase_commands where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_fingerprint<>v_fp then raise exception using errcode='23505',message='marketplace_creator_showcase_idempotency_conflict';end if;return v_prior.result_json;end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase:'||v_actor,0));
  select count(*) into v_active from public.marketplace_creator_showcase_items where creator_user_id=v_actor and status='active';
  if v_active<>cardinality(p_showcase_item_ids) or exists(select 1 from unnest(p_showcase_item_ids)x
    left join public.marketplace_creator_showcase_items s on s.id=x and s.creator_user_id=v_actor and s.status='active' where s.id is null) then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_reorder';end if;
  perform 1 from public.marketplace_creator_showcase_items s join unnest(p_showcase_item_ids)x on x=s.id order by s.id for update of s;
  perform set_config('marketplace.creator_showcase_authorized_mutation','on',true);
  foreach v_id in array p_showcase_item_ids loop
    update public.marketplace_creator_showcase_items set sort_position=v_position,updated_at=clock_timestamp() where id=v_id;
    v_position:=v_position+1;
  end loop;
  select jsonb_build_object('creator_user_id',v_actor,'item_ids',to_jsonb(p_showcase_item_ids),'count',cardinality(p_showcase_item_ids))into v_result;
  insert into public.marketplace_creator_showcase_commands(actor_id,command_type,idempotency_key,request_fingerprint,result_json)
    values(v_actor,'reorder',p_idempotency_key,v_fp,v_result);
  return v_result;
end$$;

create or replace function public.create_marketplace_creator_showcase_attribution(
  p_showcase_item_id uuid,p_variant_id uuid default null,p_idempotency_key uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_buyer uuid:=auth.uid();v_item public.marketplace_creator_showcase_items;v_offer record;
  v_prior public.marketplace_creator_commerce_attributions;
begin
  if v_buyer is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_showcase_item_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_creator_showcase_attribution_invalid_input';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-attribution-key:'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_commerce_attributions where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.source_surface<>'creator_showcase' or v_prior.source_entity_id<>p_showcase_item_id
      or v_prior.variant_id is distinct from p_variant_id then
      raise exception using errcode='23505',message='marketplace_creator_showcase_attribution_idempotency_conflict';end if;
    return jsonb_build_object('id',v_prior.id,'entitlement_id',v_prior.entitlement_id,
      'creator_user_id',v_prior.creator_user_id,'product_id',v_prior.product_id,
      'variant_id',v_prior.variant_id,'commission_bps',v_prior.commission_bps,
      'source_surface',v_prior.source_surface,'source_entity_id',v_prior.source_entity_id,
      'attributed_at',v_prior.attributed_at,'expires_at',v_prior.expires_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-item:'||p_showcase_item_id,0));
  select * into v_item from public.marketplace_creator_showcase_items where id=p_showcase_item_id for share;
  if not found or v_item.status<>'active' then raise exception using errcode='22023',message='marketplace_creator_showcase_attribution_unavailable';end if;
  perform 1 from public.products where id=v_item.product_id for share;
  select * into v_offer from public.marketplace_resolve_live_affiliate_offer(v_item.product_id,v_item.creator_user_id);
  if not found then raise exception using errcode='22023',message='marketplace_creator_showcase_offer_ineligible';end if;
  return public.marketplace_create_creator_commerce_attribution_internal(v_offer.offer_id,
    v_item.creator_user_id,p_variant_id,'creator_showcase',v_item.id,p_idempotency_key);
end$$;

create or replace function public.reconcile_marketplace_creator_showcase()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'orphan_showcase_creator',(select count(*) from public.marketplace_creator_showcase_items s left join auth.users u on u.id=s.creator_user_id where u.id is null),
  'orphan_showcase_product',(select count(*) from public.marketplace_creator_showcase_items s left join public.products p on p.id=s.product_id where p.id is null),
  'wrong_showcase_seller',(select count(*) from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id where s.seller_id<>p.seller_id),
  'wrong_showcase_store',(select count(*) from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id where s.store_id<>p.store_id),
  'self_showcase_product',(select count(*) from public.marketplace_creator_showcase_items where creator_user_id=seller_id),
  'invalid_showcase_status',(select count(*) from public.marketplace_creator_showcase_items where status not in('active','removed') or(status='active')is distinct from(removed_at is null)),
  'duplicate_active_creator_product',(select count(*) from(select creator_user_id,product_id from public.marketplace_creator_showcase_items where status='active' group by 1,2 having count(*)>1)x),
  'invalid_sort_position',(select count(*) from public.marketplace_creator_showcase_items where sort_position<0 or sort_position>1000000),
  'duplicate_active_sort_position',(select count(*) from(select creator_user_id,sort_position from public.marketplace_creator_showcase_items where status='active' group by 1,2 having count(*)>1)x),
  'invalid_request_fingerprint',(select count(*) from public.marketplace_creator_showcase_items where char_length(request_fingerprint)<>64 or request_fingerprint!~'^[0-9a-f]{64}$'),
  'selected_entitlement_missing',(select count(*) from public.marketplace_creator_showcase_items s left join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where o.id is null),
  'selected_entitlement_product_mismatch',(select count(*) from public.marketplace_creator_showcase_items s join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where(o.product_id,o.seller_id,o.store_id)is distinct from(s.product_id,s.seller_id,s.store_id)),
  'selected_entitlement_creator_scope_mismatch',(select count(*) from public.marketplace_creator_showcase_items s join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where(o.offer_scope='specific_creator'and o.creator_id<>s.creator_user_id)or(o.offer_scope='public_creator'and o.creator_id is not null)),
  'showcase_attribution_missing_source_item',(select count(*) from public.marketplace_creator_commerce_attributions a left join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and s.id is null),
  'showcase_attribution_creator_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and a.creator_user_id<>s.creator_user_id),
  'showcase_attribution_product_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and(a.product_id,a.seller_id,a.store_id)is distinct from(s.product_id,s.seller_id,s.store_id)),
  'showcase_attribution_source_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and s.removed_at is not null and a.attributed_at>=s.removed_at),
  'showcase_attribution_entitlement_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_live_affiliate_offers o on o.id=a.entitlement_id where a.source_surface='creator_showcase'and(a.product_id,a.seller_id,a.store_id,a.commission_bps)is distinct from(o.product_id,o.seller_id,o.store_id,o.commission_bps)),
  'showcase_item_attribution_snapshot_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id where s.source_surface='creator_showcase'and(s.creator_user_id,s.product_id,s.variant_id,s.entitlement_id,s.commission_bps,s.source_entity_id)is distinct from(a.creator_user_id,a.product_id,coalesce(a.variant_id,s.variant_id),a.entitlement_id,a.commission_bps,a.source_entity_id)),
  'showcase_b7f_creator_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s left join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id where s.source_surface='creator_showcase'and exists(select 1 from public.marketplace_payments p where p.checkout_id=s.checkout_id)and(a.id is null or a.creator_user_id<>s.creator_user_id)),
  'showcase_b7f_bps_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id where s.source_surface='creator_showcase'and a.commission_bps<>s.commission_bps),
  'showcase_settlement_creator_mismatch',(select count(*) from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id join public.marketplace_order_settlements st on st.order_id=a.order_id where s.source_surface='creator_showcase'and st.status='completed'and not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=st.id and l.leg_type='creator_commission'and l.beneficiary_user_id=a.creator_user_id))
)$$;

revoke all on public.marketplace_creator_showcase_items,public.marketplace_creator_showcase_commands
  from public,anon,authenticated;
revoke all on function public.marketplace_reject_creator_showcase_mutation(),
  public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid),
  public.reconcile_marketplace_creator_showcase() from public,anon,authenticated,service_role;
revoke all on function public.get_my_marketplace_creator_eligible_products(text,integer,timestamptz,uuid),
  public.get_my_marketplace_creator_showcase(integer,timestamptz,uuid),
  public.add_my_marketplace_creator_showcase_product(uuid,uuid),
  public.remove_my_marketplace_creator_showcase_product(uuid,uuid),
  public.reorder_my_marketplace_creator_showcase(uuid[],uuid),
  public.create_marketplace_creator_showcase_attribution(uuid,uuid,uuid) from public,anon;
revoke all on function public.get_marketplace_creator_showcase(uuid,integer,integer,uuid) from public;
grant execute on function public.get_my_marketplace_creator_eligible_products(text,integer,timestamptz,uuid),
  public.get_my_marketplace_creator_showcase(integer,timestamptz,uuid),
  public.add_my_marketplace_creator_showcase_product(uuid,uuid),
  public.remove_my_marketplace_creator_showcase_product(uuid,uuid),
  public.reorder_my_marketplace_creator_showcase(uuid[],uuid),
  public.create_marketplace_creator_showcase_attribution(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.get_marketplace_creator_showcase(uuid,integer,integer,uuid) to anon,authenticated,service_role;
grant execute on function public.reconcile_marketplace_creator_showcase() to service_role;

comment on table public.marketplace_creator_showcase_items is
  'Creator-selected product presentation lifecycle. Selection records are non-financial; every buyer attribution resolves the current seller-approved offer through B7A.';
comment on function public.create_marketplace_creator_showcase_attribution(uuid,uuid,uuid) is
  'Authenticated buyer trust boundary accepting only an opaque showcase item, optional variant, and idempotency key. Creator, product, seller, store, entitlement, and BPS are server-derived.';
