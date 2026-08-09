begin;

alter table public.marketplace_ad_touches
  add column source_event_id uuid references public.marketplace_ad_events(id);
create unique index marketplace_ad_touches_source_event
  on public.marketplace_ad_touches(source_event_id)
  where source_event_id is not null;

create or replace function public.materialize_marketplace_ad_campaign_spend_at(p_campaign_id uuid,p_at_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns;b timestamptz;seconds bigint;target numeric(20,8);delta numeric(20,8);k uuid;prior public.marketplace_ad_delivery_materializations;event_id uuid;
begin
 if auth.role()<>'service_role'then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_at_time is null then raise exception using errcode='22023',message='marketplace_ad_materialization_time_required';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if p_at_time>=c.ends_at then
   if now()<c.ends_at then raise exception using errcode='22023',message='marketplace_ad_finalization_not_due';end if;
   k:=((substr(md5(c.id::text||':final-delivery-settlement'),1,8)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),9,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),13,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),17,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),21,12))::uuid);
   return public.finalize_marketplace_ad_campaign_delivery(c.id,k);
 end if;
 perform public.marketplace_ad_checkpoint_eligibility_at(c.id,p_at_time);select*into c from public.marketplace_ad_campaigns where id=c.id for update;
 if not c.eligibility_state or c.status not in('active','scheduled')then return jsonb_build_object('campaign_id',c.id,'materialized',false,'reason',c.eligibility_reason);end if;
 b:=to_timestamp(floor(extract(epoch from p_at_time)/600)*600);select*into prior from public.marketplace_ad_delivery_materializations where campaign_id=c.id and bucket_start=b;if found then return to_jsonb(prior);end if;
 seconds:=floor(extract(epoch from(c.ends_at-c.starts_at)))::bigint;target:=least(c.total_budget_bdag,round(c.total_budget_bdag*c.eligible_elapsed_seconds::numeric/seconds,8));delta:=target-c.spent_bdag;
 if delta<0 then raise exception using errcode='22023',message='marketplace_ad_pacing_target_regression';end if;
 if delta>0 then
   k:=((substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),1,8)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),9,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),13,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),17,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),21,12))::uuid);
   perform public.spend_marketplace_ad_budget(c.id,delta,k);select id into event_id from public.marketplace_ad_financial_events where event_type='spend'and idempotency_key=k;
 end if;
 insert into public.marketplace_ad_delivery_materializations values(c.id,b,c.eligible_elapsed_seconds,target,c.spent_bdag,delta,event_id,now())returning*into prior;return to_jsonb(prior);
end$$;

create or replace function public.materialize_marketplace_ad_campaign_spend(p_campaign_id uuid)returns jsonb
language plpgsql security definer set search_path=public as $$begin return public.materialize_marketplace_ad_campaign_spend_at(p_campaign_id,now());end$$;

create or replace function public.marketplace_public_product_card_price(
  p_product_id uuid,
  p_at_time timestamptz default now()
) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'variant_id', priced.variant_id,
    'price', priced.effective_price,
    'base_price', priced.base_price,
    'promotion_id', priced.promotion_id,
    'compare_at_price', case when priced.promotion_id is not null then priced.base_price else null end,
    'variant_price_max', max(priced.effective_price) over ()
  )
  from (
    select v.id variant_id,
      (ep->>'effective_price')::numeric effective_price,
      (ep->>'base_price')::numeric base_price,
      nullif(ep->>'promotion_id','')::uuid promotion_id
    from public.marketplace_product_variants v
    join public.marketplace_inventory_levels l on l.variant_id=v.id
    cross join lateral public.marketplace_effective_price(p_product_id,v.id,p_at_time) ep
    where v.product_id=p_product_id and v.status='active' and v.archived_at is null
      and l.on_hand-l.reserved>0
  ) priced
  order by priced.effective_price,priced.variant_id
  limit 1
$$;

create or replace function public.fetch_public_marketplace_products(
  p_category text default null,p_seller_id uuid default null,p_search text default null,
  p_limit integer default 30,p_product_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb) into result
  from(
    select jsonb_build_object(
      'id',p.id,'seller_id',p.seller_id,'store_id',p.store_id,'category_id',p.category_id,
      'title',p.title,'description',p.description,'price',(card->>'price')::numeric,'currency',p.currency,
      'category',p.category,'images',p.images,'stock',p.stock,'status',p.status,'tags',p.tags,
      'total_sales',p.total_sales,'brand',p.brand,'compare_at_price',(card->>'compare_at_price')::numeric,
      'product_type',p.product_type,'moderation_status',p.moderation_status,'published_at',p.published_at,
      'deleted_at',p.deleted_at,'created_at',p.created_at,'updated_at',p.updated_at,
      'variant_price_max',(card->>'variant_price_max')::numeric,'active_variant_count',p.active_variant_count,
      'promotion_id',card->>'promotion_id',
      'seller',jsonb_build_object('username',u.username,'avatar_url',u.avatar_url,'display_name',u.display_name)
    )row_data,p.created_at
    from public.products p
    left join public.user_profiles u on u.id=p.seller_id
    join lateral public.marketplace_evaluate_live_product_readiness(p.id,p.seller_id) ready on ready.reason_code='ready'
    join lateral public.marketplace_public_product_card_price(p.id,now()) card on true
    where p.status='active' and p.deleted_at is null and p.currency='BDAG'
      and not fixture_ops.is_fixture('product',p.id)
      and(p_product_id is null or p.id=p_product_id)
      and(p_category is null or p.category=p_category)
      and(p_seller_id is null or p.seller_id=p_seller_id)
      and(p_search is null or p.title ilike'%'||p_search||'%')
    order by p.created_at desc limit greatest(1,least(coalesce(p_limit,30),100))
  )visible;
  return result;
end$$;

create or replace function public.fetch_marketplace_sponsored_products_v2(
  p_surface text,p_category text default null,p_limit integer default 4,p_session text default null
) returns setof jsonb language sql stable security definer set search_path=public as $$
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
 limit least(greatest(p_limit,0),8)
$$;

create or replace function public.record_marketplace_ad_event(
  p_campaign_id uuid,p_product_id uuid,p_event_type text,p_surface text,p_event_key text,
  p_anonymous_session_id text default null,p_metadata jsonb default'{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();c public.marketplace_ad_campaigns;prior public.marketplace_ad_events;
 bucket timestamptz:=to_timestamp(floor(extract(epoch from now())/600)*600);
 created public.marketplace_ad_events;touch uuid;allowed text[];
begin
 if actor is null and(p_anonymous_session_id is null or char_length(p_anonymous_session_id)not between 16 and 128)then raise exception using errcode='22023',message='marketplace_ad_actor_required';end if;
 if p_event_type not in('impression','click','product_view','add_to_cart')or p_surface not in('marketplace_home','marketplace_search','product_detail','cart')then raise exception using errcode='22023',message='marketplace_ad_event_invalid';end if;
 if p_event_key is null or char_length(p_event_key)not between 16 and 160 then raise exception using errcode='22023',message='marketplace_ad_event_key_invalid';end if;
 allowed:=case p_event_type when'impression'then array['position']when'click'then array['position']when'product_view'then array[]::text[]else array['variant_id','quantity']end;
 if jsonb_typeof(p_metadata)<>'object'or exists(select 1 from jsonb_object_keys(p_metadata)k where not(k=any(allowed)))then raise exception using errcode='22023',message='marketplace_ad_metadata_invalid';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id and product_id=p_product_id;if not found then raise exception using errcode='22023',message='marketplace_ad_product_mismatch';end if;
 if p_event_type in('impression','click','product_view')and(not c.eligibility_state or c.starts_at>now()or c.ends_at<=now()or c.status not in('active','scheduled'))then raise exception using errcode='22023',message='marketplace_ad_not_delivery_eligible';end if;
 select*into prior from public.marketplace_ad_events where event_key=p_event_key;
 if found then
   if prior.campaign_id<>c.id or prior.product_id<>p_product_id or prior.event_type<>p_event_type or prior.surface<>p_surface or prior.metadata<>p_metadata
     or prior.viewer_id is distinct from actor
     or prior.anonymous_session_id is distinct from(case when actor is null then p_anonymous_session_id end)
   then raise exception using errcode='23505',message='marketplace_ad_event_idempotency_conflict';end if;
   if prior.event_type='product_view'then select id into touch from public.marketplace_ad_touches where source_event_id=prior.id;end if;
   return to_jsonb(prior)||jsonb_build_object('touch_id',touch);
 end if;
 begin
   insert into public.marketplace_ad_events(campaign_id,product_id,viewer_id,anonymous_session_id,event_type,surface,event_key,event_bucket,metadata)
   values(c.id,p_product_id,actor,case when actor is null then p_anonymous_session_id end,p_event_type,p_surface,p_event_key,bucket,p_metadata)returning*into created;
 exception when unique_violation then
   if p_event_type='impression'then select*into created from public.marketplace_ad_events where campaign_id=c.id and coalesce(viewer_id::text,anonymous_session_id)=coalesce(actor::text,p_anonymous_session_id)and surface=p_surface and event_bucket=bucket and event_type='impression';else raise;end if;
 end;
 if p_event_type='product_view'then
   insert into public.marketplace_ad_touches(campaign_id,product_id,viewer_id,anonymous_session_id,surface,touched_at,expires_at,source_event_id)
   values(c.id,p_product_id,actor,case when actor is null then p_anonymous_session_id end,p_surface,now(),now()+interval'24 hours',created.id)returning id into touch;
 end if;
 return to_jsonb(created)||jsonb_build_object('touch_id',touch);
end$$;

create or replace function public.reconcile_marketplace_ad_delivery()returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'overspend',(select count(*)from public.marketplace_ad_campaigns where spent_bdag>total_budget_bdag),
 'bucket_duplicates',(select count(*)from(select campaign_id,bucket_start,count(*)from public.marketplace_ad_delivery_materializations group by 1,2 having count(*)>1)x),
 'materialization_finance_mismatch',(select count(*)from public.marketplace_ad_delivery_materializations m left join public.marketplace_ad_financial_events e on e.id=m.financial_event_id where(m.delta_spend_bdag>0 and(e.id is null or e.amount_bdag<>m.delta_spend_bdag or e.event_type<>'spend'))or(m.delta_spend_bdag=0 and e.id is not null)),
 'orphan_materialization',(select count(*)from public.marketplace_ad_financial_events e left join public.marketplace_ad_delivery_materializations m on m.financial_event_id=e.id left join public.marketplace_ad_finalizations f on f.campaign_id=e.campaign_id and f.final_spend_delta_bdag=e.amount_bdag where e.event_type='spend'and m.financial_event_id is null and f.campaign_id is null),
 'target_violations',(select count(*)from public.marketplace_ad_delivery_materializations where spent_before_bdag+delta_spend_bdag>target_spend_bdag or target_spend_bdag<0)
)$$;

create or replace function public.reconcile_marketplace_ad_events()returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'campaign_product_mismatch',(select count(*)from public.marketplace_ad_events e join public.marketplace_ad_campaigns c on c.id=e.campaign_id where c.product_id<>e.product_id),
 'purchase_without_order_attribution',(select count(*)from public.marketplace_ad_events e left join public.marketplace_order_ad_attribution a on a.order_item_id=e.order_item_id where e.event_type='purchase'and a.order_item_id is null),
 'invalid_events',(select count(*)from public.marketplace_ad_events where event_type not in('impression','click','product_view','add_to_cart','purchase')or surface not in('marketplace_home','marketplace_search','product_detail','cart','checkout')),
 'duplicate_event_keys',(select count(*)from(select event_key,count(*)from public.marketplace_ad_events group by event_key having count(*)>1)x),
 'touch_event_mismatch',(select count(*)from public.marketplace_ad_touches t left join public.marketplace_ad_events e on e.id=t.source_event_id where t.source_event_id is null or e.id is null or e.event_type<>'product_view'or e.campaign_id<>t.campaign_id or e.product_id<>t.product_id or e.viewer_id is distinct from t.viewer_id or e.anonymous_session_id is distinct from t.anonymous_session_id),
 'purchase_gmv_mismatch',(select count(*)from public.marketplace_order_ad_attribution a join public.marketplace_order_items i on i.id=a.order_item_id where a.attributed_gmv_bdag<>i.line_total),
 'purchase_event_link_mismatch',(select count(*)from public.marketplace_order_ad_attribution a left join public.marketplace_ad_events e on e.order_item_id=a.order_item_id and e.event_type='purchase' where e.id is null or e.campaign_id<>a.campaign_id or(e.metadata->>'line_total')::numeric<>a.attributed_gmv_bdag)
)$$;

create or replace function public.fetch_marketplace_ad_config()returns jsonb
language sql stable security definer set search_path=public as $$
 select to_jsonb(c)||jsonb_build_object(
   'minimum_duration_seconds',floor(extract(epoch from c.minimum_duration))::bigint,
   'maximum_duration_seconds',floor(extract(epoch from c.maximum_duration))::bigint)
 from public.marketplace_ad_config c where singleton
$$;

create or replace function public.fetch_my_marketplace_ad_campaigns(p_status text default null,p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'product_id',c.product_id,'product_title',p.title,'images',p.images,'name',c.name,'status',c.status,'budget',c.total_budget_bdag,'spent',c.spent_bdag,'released',c.released_bdag,'remaining',c.total_budget_bdag-c.spent_bdag-c.released_bdag,'starts_at',c.starts_at,'ends_at',c.ends_at,'eligible_elapsed_seconds',c.eligible_elapsed_seconds,'impressions',count(e.id)filter(where e.event_type='impression'),'clicks',count(e.id)filter(where e.event_type='click'),'product_views',count(e.id)filter(where e.event_type='product_view'),'cart_adds',count(e.id)filter(where e.event_type='add_to_cart'),'orders',count(e.id)filter(where e.event_type='purchase'),'gmv',coalesce(sum((e.metadata->>'line_total')::numeric)filter(where e.event_type='purchase'),0))
 from public.marketplace_ad_campaigns c join public.products p on p.id=c.product_id left join public.marketplace_ad_events e on e.campaign_id=c.id
 where c.seller_id=auth.uid()and(p_status is null or c.status=p_status or(p_status='terminal'and c.status in('completed','exhausted','cancelled')))
 group by c.id,p.id order by c.created_at desc limit least(greatest(p_limit,1),100)
$$;

revoke all on function public.marketplace_public_product_card_price(uuid,timestamptz)from public,anon,authenticated;
grant execute on function public.marketplace_public_product_card_price(uuid,timestamptz)to service_role;
revoke all on function public.materialize_marketplace_ad_campaign_spend_at(uuid,timestamptz)from public,anon,authenticated;
grant execute on function public.materialize_marketplace_ad_campaign_spend_at(uuid,timestamptz)to service_role;
revoke all on function public.fetch_marketplace_sponsored_products_v2(text,text,integer,text)from public;
grant execute on function public.fetch_marketplace_sponsored_products_v2(text,text,integer,text)to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
