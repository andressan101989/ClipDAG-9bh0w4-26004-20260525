create table public.marketplace_creator_content_product_tags(
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id),
  content_id uuid not null,
  video_id uuid references public.videos(id),
  content_type text not null check(content_type in('feed','reel')),
  product_id uuid not null references public.products(id),
  seller_id uuid not null references public.marketplace_sellers(user_id),
  store_id uuid not null references public.marketplace_stores(id),
  selected_entitlement_id uuid not null references public.marketplace_live_affiliate_offers(id),
  status text not null default 'active' check(status in('active','removed')),
  sort_position integer not null check(sort_position between 0 and 1000000),
  selected_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_content_tag_status_time_check check(
    (status='active' and removed_at is null and video_id=content_id)
    or(status='removed' and removed_at is not null and(video_id is null or video_id=content_id))),
  constraint marketplace_content_tag_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'),
  constraint marketplace_content_tag_not_seller check(creator_user_id<>seller_id)
);

create unique index marketplace_content_tag_active_product_unique
  on public.marketplace_creator_content_product_tags(content_id,product_id)
  where status='active';
create unique index marketplace_content_tag_active_position_unique
  on public.marketplace_creator_content_product_tags(content_id,sort_position)
  where status='active';
create index marketplace_content_tag_video_status_idx
  on public.marketplace_creator_content_product_tags(content_id,status,sort_position,id);
create index marketplace_content_tag_product_creator_idx
  on public.marketplace_creator_content_product_tags(product_id,creator_user_id);

create table public.marketplace_creator_content_tag_commands(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  content_id uuid not null,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_content_tag_command_key unique(actor_id,idempotency_key),
  constraint marketplace_content_tag_command_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$')
);

alter table public.marketplace_creator_content_product_tags enable row level security;
alter table public.marketplace_creator_content_tag_commands enable row level security;

create or replace function public.marketplace_video_content_type(p_video_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select case
    when coalesce(cardinality(v.media_urls),0)>1 then 'feed'
    when lower(split_part(v.video_url,'?',1))~'\.(mp4|mov|avi|mkv|webm|m4v|m3u8|mpd)$'
      or lower(v.video_url) like '%/videos/%'
      or lower(v.video_url) like '%cloudflarestream.com%'
      or lower(v.video_url) like '%videodelivery.net%'
      or lower(v.video_url) like '%gtv-videos-bucket%' then 'reel'
    else 'feed' end
  from public.videos v where v.id=p_video_id
$$;

create or replace function public.marketplace_creator_content_visible(
  p_video_id uuid,p_viewer_id uuid default auth.uid()
)returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.videos v join public.user_profiles u on u.id=v.user_id
    where v.id=p_video_id
      and not exists(select 1 from public.blocked_users b where
        (b.blocker_id=p_viewer_id and b.blocked_id=v.user_id)
        or(b.blocker_id=v.user_id and b.blocked_id=p_viewer_id))
      and(not u.is_private or p_viewer_id=v.user_id or exists(
        select 1 from public.follows f
        where f.follower_id=p_viewer_id and f.following_id=v.user_id))
  )
$$;

create or replace function public.marketplace_reject_creator_content_tag_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' or coalesce(current_setting(
    'marketplace.creator_content_tag_authorized_mutation',true),'')<>'on' then
    raise exception using errcode='42501',message='marketplace_creator_content_tag_immutable';
  end if;
  if coalesce(current_setting('marketplace.creator_content_deletion',true),'')='on'
    and old.video_id is not null and new.video_id is null and new.content_id=old.content_id
    and new.status='removed' and new.removed_at is not null
    and(to_jsonb(new)-array['status','video_id','removed_at','updated_at'])
       is not distinct from(to_jsonb(old)-array['status','video_id','removed_at','updated_at']) then
    return new;
  end if;
  if (to_jsonb(new)-array['status','sort_position','removed_at','updated_at'])
      is distinct from(to_jsonb(old)-array['status','sort_position','removed_at','updated_at'])
    or old.status='removed' or new.status not in('active','removed') then
    raise exception using errcode='42501',message='marketplace_creator_content_tag_immutable';
  end if;
  return new;
end$$;

create trigger marketplace_creator_content_product_tags_guard
before update or delete on public.marketplace_creator_content_product_tags
for each row execute function public.marketplace_reject_creator_content_tag_mutation();

create trigger marketplace_creator_content_tag_commands_immutable
before update or delete on public.marketplace_creator_content_tag_commands
for each row execute function public.marketplace_reject_creator_commerce_snapshot_mutation();

create or replace function public.marketplace_lock_video_content_delete()
returns trigger language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-content:'||old.id::text,0));
  perform set_config('marketplace.creator_content_tag_authorized_mutation','on',true);
  perform set_config('marketplace.creator_content_deletion','on',true);
  update public.marketplace_creator_content_product_tags
    set status='removed',removed_at=coalesce(removed_at,clock_timestamp()),video_id=null,updated_at=clock_timestamp()
    where content_id=old.id;
  return old;
end$$;

create trigger marketplace_video_content_delete_lock
before delete on public.videos for each row execute function public.marketplace_lock_video_content_delete();

alter table public.marketplace_creator_commerce_attributions
  drop constraint marketplace_creator_attribution_source_check;
alter table public.marketplace_creator_commerce_attributions
  add constraint marketplace_creator_attribution_source_check
  check(source_surface in('live','direct_creator_link','creator_showcase','feed','reel'));
alter table public.marketplace_order_item_creator_attributions
  drop constraint marketplace_item_attribution_source_check;
alter table public.marketplace_order_item_creator_attributions
  add constraint marketplace_item_attribution_source_check
  check(source_surface in('live','direct_creator_link','creator_showcase','feed','reel'));

create or replace function public.marketplace_create_creator_commerce_attribution_internal(
  p_entitlement_id uuid,p_creator_user_id uuid,p_variant_id uuid,
  p_source_surface text,p_source_entity_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_offer public.marketplace_live_affiliate_offers;
  v_product public.products;v_variant public.marketplace_product_variants;
  v_prior public.marketplace_creator_commerce_attributions;
  v_showcase public.marketplace_creator_showcase_items;
  v_tag public.marketplace_creator_content_product_tags;
  v_id uuid:=gen_random_uuid();v_fingerprint text;v_now timestamptz:=clock_timestamp();
begin
  if p_entitlement_id is null or p_creator_user_id is null or p_source_entity_id is null
    or p_idempotency_key is null
    or p_source_surface not in('live','direct_creator_link','creator_showcase','feed','reel') then
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
  if p_source_surface in('feed','reel') then
    select * into v_tag from public.marketplace_creator_content_product_tags
      where id=p_source_entity_id for share;
    if not found then raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';end if;
    perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-content:'||v_tag.content_id::text,0));
    select * into v_tag from public.marketplace_creator_content_product_tags
      where id=p_source_entity_id for share;
  end if;
  select * into v_offer from public.marketplace_live_affiliate_offers where id=p_entitlement_id;
  if found then
    perform 1 from public.products where id=v_offer.product_id for share;
    select * into v_offer from public.marketplace_live_affiliate_offers where id=p_entitlement_id for share;
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
    or not exists(select 1 from public.marketplace_stores s where s.id=v_offer.store_id and s.seller_id=v_offer.seller_id and s.status='active')
    or not exists(select 1 from public.marketplace_sellers s where s.user_id=v_offer.seller_id and s.status='approved') then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_product_ineligible';
  end if;
  if p_creator_user_id=v_offer.seller_id or not exists(select 1 from auth.users u where u.id=p_creator_user_id) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_creator_invalid';
  end if;
  if p_variant_id is not null then
    select * into v_variant from public.marketplace_product_variants where id=p_variant_id;
    if not found or v_variant.product_id<>v_offer.product_id or v_variant.seller_id<>v_offer.seller_id
      or v_variant.store_id<>v_offer.store_id or v_variant.status<>'active' or v_variant.archived_at is not null then
      raise exception using errcode='23514',message='marketplace_creator_attribution_variant_mismatch';
    end if;
  end if;
  if p_source_surface='direct_creator_link' and p_source_entity_id<>p_entitlement_id then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  if p_source_surface='live' and not exists(select 1 from public.live_session_products pin
    where pin.id=p_source_entity_id and pin.affiliate_offer_id=v_offer.id
      and pin.product_id=v_offer.product_id and pin.seller_id=v_offer.seller_id
      and pin.store_id=v_offer.store_id and pin.host_id=p_creator_user_id
      and pin.commerce_mode='affiliate_product' and pin.creator_commission_bps=v_offer.commission_bps) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  if p_source_surface='creator_showcase' then
    select * into v_showcase from public.marketplace_creator_showcase_items where id=p_source_entity_id for share;
    if not found or v_showcase.status<>'active' or v_showcase.creator_user_id<>p_creator_user_id
      or v_showcase.product_id<>v_offer.product_id or v_showcase.seller_id<>v_offer.seller_id
      or v_showcase.store_id<>v_offer.store_id then
      raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
    end if;
  end if;
  if p_source_surface in('feed','reel') and(
    v_tag.id is null or v_tag.status<>'active' or v_tag.content_type<>p_source_surface
    or v_tag.creator_user_id<>p_creator_user_id or v_tag.product_id<>v_offer.product_id
    or v_tag.seller_id<>v_offer.seller_id or v_tag.store_id<>v_offer.store_id
    or v_tag.video_id is null or not exists(select 1 from public.videos v where v.id=v_tag.video_id and v.user_id=p_creator_user_id)
  )then raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';end if;
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

create or replace function public.set_my_marketplace_content_product_tags(
  p_content_type text,p_content_id uuid,p_product_ids uuid[],p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_video public.videos;v_fp text;v_prior public.marketplace_creator_content_tag_commands;
  v_product public.products;v_offer record;v_tag public.marketplace_creator_content_product_tags;
  v_product_id uuid;v_position integer;v_result jsonb;v_count integer:=coalesce(cardinality(p_product_ids),0);
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_content_type not in('feed','reel') or p_content_id is null or p_product_ids is null or p_idempotency_key is null
    or v_count>5 then raise exception using errcode='22023',message='marketplace_creator_content_tag_limit_reached';end if;
  if v_count<>(select count(distinct x)from unnest(p_product_ids)x) then
    raise exception using errcode='22023',message='marketplace_creator_content_tag_duplicate_product';end if;
  v_fp:=encode(extensions.digest(concat_ws('|','marketplace_creator_content_tag_set',v_actor,
    p_content_type,p_content_id,array_to_string(p_product_ids,',')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-content-command:'||v_actor||':'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_content_tag_commands where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fp then raise exception using errcode='23505',message='marketplace_creator_content_tag_idempotency_conflict';end if;
    return v_prior.result_json;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-content:'||p_content_id,0));
  select * into v_video from public.videos where id=p_content_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_creator_content_not_found';end if;
  if v_video.user_id<>v_actor then raise exception using errcode='42501',message='marketplace_creator_content_forbidden';end if;
  if public.marketplace_video_content_type(v_video.id)<>p_content_type then
    raise exception using errcode='23514',message='marketplace_creator_content_type_mismatch';end if;
  perform set_config('marketplace.creator_content_tag_authorized_mutation','on',true);
  update public.marketplace_creator_content_product_tags set status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp()
    where content_id=v_video.id and status='active' and not(product_id=any(p_product_ids));
  update public.marketplace_creator_content_product_tags
    set sort_position=sort_position+100,updated_at=clock_timestamp()
    where content_id=v_video.id and status='active';
  if v_count>0 then
    for v_product_id,v_position in select x,ord::integer-1 from unnest(p_product_ids)with ordinality q(x,ord) order by ord loop
      select * into v_product from public.products where id=v_product_id for share;
      if not found or v_product.seller_id=v_actor or v_product.status<>'active'
        or v_product.moderation_status<>'approved' or v_product.published_at is null
        or v_product.deleted_at is not null or v_product.product_type<>'physical' or v_product.currency<>'BDAG' then
        raise exception using errcode='22023',message='marketplace_creator_content_tag_product_ineligible';end if;
      select * into v_offer from public.marketplace_resolve_live_affiliate_offer(v_product_id,v_actor);
      if not found then raise exception using errcode='22023',message='marketplace_creator_content_tag_offer_ineligible';end if;
      perform 1 from public.marketplace_live_affiliate_offers where id=v_offer.offer_id for share;
      v_tag:=null;
      select * into v_tag from public.marketplace_creator_content_product_tags
        where content_id=v_video.id and product_id=v_product_id and status='active' for update;
      if v_tag.id is null then
        insert into public.marketplace_creator_content_product_tags(creator_user_id,content_id,video_id,content_type,
          product_id,seller_id,store_id,selected_entitlement_id,sort_position,idempotency_key,request_fingerprint)
        values(v_actor,v_video.id,v_video.id,p_content_type,v_product_id,v_offer.seller_id,v_offer.store_id,
          v_offer.offer_id,v_position,p_idempotency_key,v_fp);
      else
        update public.marketplace_creator_content_product_tags set sort_position=v_position,updated_at=clock_timestamp()
          where id=v_tag.id;
      end if;
    end loop;
  end if;
  select jsonb_build_object('content_type',p_content_type,'content_id',p_content_id,'count',count(*),
    'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,
      'sort_position',sort_position,'status',status)order by sort_position,id),'[]'::jsonb))
    into v_result from public.marketplace_creator_content_product_tags where content_id=v_video.id and status='active';
  insert into public.marketplace_creator_content_tag_commands(actor_id,content_id,idempotency_key,request_fingerprint,result_json)
    values(v_actor,v_video.id,p_idempotency_key,v_fp,v_result);
  return v_result;
end$$;

create or replace function public.get_marketplace_content_product_tags(
  p_content_type text,p_content_id uuid
)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_items jsonb;
begin
  if p_content_type not in('feed','reel') or p_content_id is null
    or public.marketplace_video_content_type(p_content_id)is distinct from p_content_type then
    raise exception using errcode='22023',message='marketplace_creator_content_tag_invalid_input';end if;
  if not public.marketplace_creator_content_visible(p_content_id,auth.uid()) then
    return jsonb_build_object('items','[]'::jsonb,'visible',false);end if;
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.id,'content_type',t.content_type,
    'product_id',p.id,'title',p.title,'store_id',p.store_id,'store_name',s.name,
    'image_url',public.marketplace_safe_public_image_url(p.images[1]),
    'min_price',coalesce(x.min_price,p.price),'max_price',coalesce(x.max_price,p.price),
    'available_quantity',coalesce(x.available_quantity,0),'sort_position',t.sort_position)
    order by t.sort_position,t.id),'[]'::jsonb)into v_items
  from public.marketplace_creator_content_product_tags t
  join public.products p on p.id=t.product_id and p.status='active' and p.moderation_status='approved'
    and p.published_at is not null and p.deleted_at is null and p.product_type='physical' and p.currency='BDAG'
  join public.marketplace_stores s on s.id=t.store_id and s.status='active'
  join public.marketplace_sellers ms on ms.user_id=t.seller_id and ms.status='approved'
  cross join lateral public.marketplace_resolve_live_affiliate_offer(t.product_id,t.creator_user_id)o
  left join lateral(select min(v.price)filter(where v.status='active'and v.archived_at is null)min_price,
    max(v.price)filter(where v.status='active'and v.archived_at is null)max_price,
    sum(greatest(i.on_hand-i.reserved,0))filter(where v.status='active'and v.archived_at is null)available_quantity
    from public.marketplace_product_variants v left join public.marketplace_inventory_levels i on i.variant_id=v.id
    where v.product_id=p.id)x on true
  where t.content_id=p_content_id and t.video_id=p_content_id and t.content_type=p_content_type and t.status='active';
  return jsonb_build_object('items',v_items,'visible',true);
end$$;

create or replace function public.get_marketplace_content_product_tag_summaries(p_content_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_items jsonb;
begin
  if p_content_ids is null or cardinality(p_content_ids)>50
    or cardinality(p_content_ids)<>(select count(distinct x)from unnest(p_content_ids)x) then
    raise exception using errcode='22023',message='marketplace_creator_content_tag_invalid_batch';end if;
  select coalesce(jsonb_agg(jsonb_build_object('content_id',q.video_id,'content_type',q.content_type,
    'tag_count',q.tag_count)order by q.video_id),'[]'::jsonb)into v_items from(
    select t.content_id video_id,t.content_type,count(*)tag_count
    from public.marketplace_creator_content_product_tags t
    join public.products p on p.id=t.product_id and p.status='active'and p.moderation_status='approved'
      and p.published_at is not null and p.deleted_at is null
    cross join lateral public.marketplace_resolve_live_affiliate_offer(t.product_id,t.creator_user_id)o
    where t.content_id=any(p_content_ids)and t.video_id=t.content_id and t.status='active'
      and public.marketplace_creator_content_visible(t.content_id,auth.uid())
    group by t.content_id,t.content_type
  )q;
  return jsonb_build_object('items',v_items);
end$$;

create or replace function public.create_marketplace_creator_content_attribution(
  p_content_product_tag_id uuid,p_variant_id uuid default null,p_idempotency_key uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_buyer uuid:=auth.uid();v_tag public.marketplace_creator_content_product_tags;
  v_offer record;v_prior public.marketplace_creator_commerce_attributions;
begin
  if v_buyer is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_content_product_tag_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_creator_content_attribution_invalid_input';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-attribution-key:'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_commerce_attributions where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.source_surface not in('feed','reel')or v_prior.source_entity_id<>p_content_product_tag_id
      or v_prior.variant_id is distinct from p_variant_id then
      raise exception using errcode='23505',message='marketplace_creator_content_attribution_idempotency_conflict';end if;
    return jsonb_build_object('id',v_prior.id,'entitlement_id',v_prior.entitlement_id,
      'creator_user_id',v_prior.creator_user_id,'product_id',v_prior.product_id,
      'variant_id',v_prior.variant_id,'commission_bps',v_prior.commission_bps,
      'source_surface',v_prior.source_surface,'source_entity_id',v_prior.source_entity_id,
      'attributed_at',v_prior.attributed_at,'expires_at',v_prior.expires_at);
  end if;
  select * into v_tag from public.marketplace_creator_content_product_tags where id=p_content_product_tag_id;
  if not found then raise exception using errcode='P0002',message='marketplace_creator_content_tag_not_found';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-content:'||v_tag.content_id,0));
  select * into v_tag from public.marketplace_creator_content_product_tags where id=p_content_product_tag_id for share;
  if not found or v_tag.status<>'active' or v_tag.video_id is null
    or not exists(select 1 from public.videos v where v.id=v_tag.video_id and v.user_id=v_tag.creator_user_id)then
    raise exception using errcode='22023',message='marketplace_creator_content_attribution_unavailable';end if;
  perform 1 from public.products where id=v_tag.product_id for share;
  select * into v_offer from public.marketplace_resolve_live_affiliate_offer(v_tag.product_id,v_tag.creator_user_id);
  if not found then raise exception using errcode='22023',message='marketplace_creator_content_tag_offer_ineligible';end if;
  return public.marketplace_create_creator_commerce_attribution_internal(v_offer.offer_id,
    v_tag.creator_user_id,p_variant_id,v_tag.content_type,v_tag.id,p_idempotency_key);
end$$;

create or replace function public.reconcile_marketplace_creator_content_tags()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'orphan_tag_creator',(select count(*)from public.marketplace_creator_content_product_tags t left join auth.users u on u.id=t.creator_user_id where u.id is null),
 'orphan_tag_content',(select count(*)from public.marketplace_creator_content_product_tags t left join public.videos v on v.id=t.video_id where t.status='active'and v.id is null),
 'wrong_content_owner',(select count(*)from public.marketplace_creator_content_product_tags t join public.videos v on v.id=t.video_id where t.creator_user_id<>v.user_id),
 'orphan_tag_product',(select count(*)from public.marketplace_creator_content_product_tags t left join public.products p on p.id=t.product_id where p.id is null),
 'wrong_tag_seller',(select count(*)from public.marketplace_creator_content_product_tags t join public.products p on p.id=t.product_id where t.seller_id<>p.seller_id),
 'wrong_tag_store',(select count(*)from public.marketplace_creator_content_product_tags t join public.products p on p.id=t.product_id where t.store_id<>p.store_id),
 'self_tagged_seller_product',(select count(*)from public.marketplace_creator_content_product_tags where creator_user_id=seller_id),
 'invalid_tag_content_type',(select count(*)from public.marketplace_creator_content_product_tags t where content_type not in('feed','reel')or(status='active'and content_type is distinct from public.marketplace_video_content_type(video_id))),
 'invalid_tag_status',(select count(*)from public.marketplace_creator_content_product_tags where status not in('active','removed')or(status='active')is distinct from(removed_at is null)),
 'duplicate_active_content_product',(select count(*)from(select content_id,product_id from public.marketplace_creator_content_product_tags where status='active'group by 1,2 having count(*)>1)x),
 'active_content_tag_over_limit',(select count(*)from(select content_id from public.marketplace_creator_content_product_tags where status='active'group by 1 having count(*)>5)x),
 'invalid_sort_position',(select count(*)from public.marketplace_creator_content_product_tags where sort_position not between 0 and 4),
 'duplicate_active_sort_position',(select count(*)from(select content_id,sort_position from public.marketplace_creator_content_product_tags where status='active'group by 1,2 having count(*)>1)x),
 'selected_entitlement_missing',(select count(*)from public.marketplace_creator_content_product_tags t left join public.marketplace_live_affiliate_offers o on o.id=t.selected_entitlement_id where o.id is null),
 'selected_entitlement_product_mismatch',(select count(*)from public.marketplace_creator_content_product_tags t join public.marketplace_live_affiliate_offers o on o.id=t.selected_entitlement_id where o.product_id<>t.product_id or o.seller_id<>t.seller_id or o.store_id<>t.store_id),
 'selected_entitlement_creator_scope_mismatch',(select count(*)from public.marketplace_creator_content_product_tags t join public.marketplace_live_affiliate_offers o on o.id=t.selected_entitlement_id where(o.offer_scope='specific_creator'and o.creator_id<>t.creator_user_id)or(o.offer_scope='public_creator'and o.creator_id is not null)),
 'invalid_request_fingerprint',(select count(*)from public.marketplace_creator_content_product_tags where char_length(request_fingerprint)<>64 or request_fingerprint!~'^[0-9a-f]{64}$'),
 'feed_tag_source_mismatch',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface='feed'and t.content_type<>'feed'),
 'reel_tag_source_mismatch',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface='reel'and t.content_type<>'reel'),
 'content_attribution_missing_source_tag',(select count(*)from public.marketplace_creator_commerce_attributions a left join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface in('feed','reel')and t.id is null),
 'content_attribution_creator_mismatch',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface in('feed','reel')and a.creator_user_id<>t.creator_user_id),
 'content_attribution_product_mismatch',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface in('feed','reel')and a.product_id<>t.product_id),
 'content_attribution_source_mismatch',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface in('feed','reel')and a.source_surface<>t.content_type),
 'attribution_created_after_tag_removal',(select count(*)from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_content_product_tags t on t.id=a.source_entity_id where a.source_surface in('feed','reel')and t.removed_at is not null and a.attributed_at>t.removed_at),
 'content_item_snapshot_mismatch',(select count(*)from public.marketplace_order_item_creator_attributions s join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id where a.source_surface in('feed','reel')and(s.creator_user_id<>a.creator_user_id or s.product_id<>a.product_id or s.commission_bps<>a.commission_bps or s.source_surface<>a.source_surface or s.source_entity_id<>a.source_entity_id)),
 'content_b7f_creator_mismatch',(select count(*)from public.marketplace_order_item_creator_attributions s join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id join public.marketplace_order_item_creator_allocations b on b.order_item_id=s.order_item_id where a.source_surface in('feed','reel')and b.creator_user_id<>a.creator_user_id),
 'content_b7f_bps_mismatch',(select count(*)from public.marketplace_order_item_creator_attributions s join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id join public.marketplace_order_item_creator_allocations b on b.order_item_id=s.order_item_id where a.source_surface in('feed','reel')and b.commission_bps<>a.commission_bps),
 'content_settlement_creator_mismatch',(select count(*)from(select distinct b.order_id,b.creator_user_id from public.marketplace_order_item_creator_allocations b join public.marketplace_order_item_creator_attributions s on s.order_item_id=b.order_item_id join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id where a.source_surface in('feed','reel'))x join public.marketplace_order_settlements st on st.order_id=x.order_id left join public.marketplace_settlement_legs l on l.settlement_id=st.id and l.leg_type='creator_commission'and l.beneficiary_user_id=x.creator_user_id where l.id is null)
)$$;

revoke all on public.marketplace_creator_content_product_tags,public.marketplace_creator_content_tag_commands from public,anon,authenticated;
revoke all on function public.marketplace_video_content_type(uuid),public.marketplace_creator_content_visible(uuid,uuid),
 public.marketplace_reject_creator_content_tag_mutation(),public.marketplace_lock_video_content_delete(),
 public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid),
 public.set_my_marketplace_content_product_tags(text,uuid,uuid[],uuid),
 public.get_marketplace_content_product_tags(text,uuid),public.get_marketplace_content_product_tag_summaries(uuid[]),
 public.create_marketplace_creator_content_attribution(uuid,uuid,uuid),
 public.reconcile_marketplace_creator_content_tags() from public,anon,authenticated;
grant execute on function public.set_my_marketplace_content_product_tags(text,uuid,uuid[],uuid),
 public.create_marketplace_creator_content_attribution(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.get_marketplace_content_product_tags(text,uuid),
 public.get_marketplace_content_product_tag_summaries(uuid[]) to anon,authenticated,service_role;
grant execute on function public.marketplace_video_content_type(uuid),public.marketplace_creator_content_visible(uuid,uuid),
 public.marketplace_reject_creator_content_tag_mutation(),public.marketplace_lock_video_content_delete(),
 public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid),
 public.reconcile_marketplace_creator_content_tags() to service_role;

comment on table public.marketplace_creator_content_product_tags is
  'B7C immutable creator-intent product tags for canonical Feed/Reel content; current offer authority is resolved only at buyer attribution time.';
comment on function public.create_marketplace_creator_content_attribution(uuid,uuid,uuid) is
  'Buyer-safe B7C wrapper deriving creator, product, seller, store, entitlement, and BPS from an active content tag and the current seller offer.';
