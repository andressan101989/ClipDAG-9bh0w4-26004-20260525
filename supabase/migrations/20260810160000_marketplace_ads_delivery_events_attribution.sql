begin;

create table public.marketplace_ad_delivery_materializations(
 campaign_id uuid not null references public.marketplace_ad_campaigns(id),bucket_start timestamptz not null,
 eligible_elapsed_seconds bigint not null check(eligible_elapsed_seconds>=0),target_spend_bdag numeric(20,8) not null,
 spent_before_bdag numeric(20,8) not null,delta_spend_bdag numeric(20,8) not null check(delta_spend_bdag>=0),
 financial_event_id uuid references public.marketplace_ad_financial_events(id),created_at timestamptz not null default now(),
 primary key(campaign_id,bucket_start),check((delta_spend_bdag=0 and financial_event_id is null)or(delta_spend_bdag>0 and financial_event_id is not null))
);
create table public.marketplace_ad_events(
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.marketplace_ad_campaigns(id),
 product_id uuid not null references public.products(id),viewer_id uuid references auth.users(id),anonymous_session_id text,
 event_type text not null check(event_type in('impression','click','product_view','add_to_cart','purchase')),
 surface text not null check(surface in('marketplace_home','marketplace_search','product_detail','cart','checkout')),
 event_key text not null,occurred_at timestamptz not null default now(),event_bucket timestamptz not null,
 metadata jsonb not null default'{}',order_item_id uuid references public.marketplace_order_items(id),
 check((viewer_id is not null)or(anonymous_session_id is not null and char_length(anonymous_session_id)between 16 and 128)),
 unique(event_key),unique(order_item_id,event_type)
);
create unique index marketplace_ad_impression_dedupe on public.marketplace_ad_events(campaign_id,coalesce(viewer_id::text,anonymous_session_id),surface,event_bucket)where event_type='impression';
create index marketplace_ad_events_campaign_type_time on public.marketplace_ad_events(campaign_id,event_type,occurred_at);
create index marketplace_ad_events_product_time on public.marketplace_ad_events(product_id,occurred_at);
create table public.marketplace_ad_touches(
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.marketplace_ad_campaigns(id),product_id uuid not null references public.products(id),
 viewer_id uuid references auth.users(id),anonymous_session_id text,surface text not null, touched_at timestamptz not null default now(),expires_at timestamptz not null,
 check(expires_at=touched_at+interval'24 hours'),check(viewer_id is not null or anonymous_session_id is not null)
);
create index marketplace_ad_touches_buyer_product on public.marketplace_ad_touches(viewer_id,product_id,touched_at desc)where viewer_id is not null;
create table public.marketplace_order_ad_attribution(
 order_item_id uuid primary key references public.marketplace_order_items(id),order_id uuid not null references public.marketplace_orders(id),
 campaign_id uuid not null references public.marketplace_ad_campaigns(id),touch_id uuid not null references public.marketplace_ad_touches(id),
 attributed_gmv_bdag numeric(20,8) not null check(attributed_gmv_bdag>=0),attributed_at timestamptz not null default now()
);
create index marketplace_order_ad_campaign_idx on public.marketplace_order_ad_attribution(campaign_id,attributed_at);

create or replace function public.materialize_marketplace_ad_campaign_spend(p_campaign_id uuid)returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns;b timestamptz;seconds bigint;target numeric(20,8);delta numeric(20,8);k uuid;prior public.marketplace_ad_delivery_materializations;event_id uuid;
begin
 if auth.role()<>'service_role'then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if now()>=c.ends_at then k:=((substr(md5(c.id::text||':final-delivery-settlement'),1,8)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),9,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),13,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),17,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),21,12))::uuid);return public.finalize_marketplace_ad_campaign_delivery(c.id,k);end if;
 perform public.checkpoint_marketplace_ad_eligibility(c.id);select*into c from public.marketplace_ad_campaigns where id=c.id for update;
 if not c.eligibility_state or c.status not in('active','scheduled')then return jsonb_build_object('campaign_id',c.id,'materialized',false,'reason',c.eligibility_reason);end if;
 b:=to_timestamp(floor(extract(epoch from now())/600)*600);select*into prior from public.marketplace_ad_delivery_materializations where campaign_id=c.id and bucket_start=b;if found then return to_jsonb(prior);end if;
 seconds:=floor(extract(epoch from(c.ends_at-c.starts_at)))::bigint;target:=least(c.total_budget_bdag,round(c.total_budget_bdag*c.eligible_elapsed_seconds::numeric/seconds,8));delta:=target-c.spent_bdag;
 if delta<0 then raise exception using errcode='22023',message='marketplace_ad_pacing_target_regression';end if;
 if delta>0 then k:=((substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),1,8)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),9,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),13,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),17,4)||'-'||substr(md5(c.id::text||':'||b::text||':marketplace-ad-pacing'),21,12))::uuid);perform public.spend_marketplace_ad_budget(c.id,delta,k);select id into event_id from public.marketplace_ad_financial_events where event_type='spend'and idempotency_key=k;end if;
 insert into public.marketplace_ad_delivery_materializations values(c.id,b,c.eligible_elapsed_seconds,target,c.spent_bdag,delta,event_id,now())returning*into prior;return to_jsonb(prior);
end;$$;

create or replace function public.fetch_marketplace_sponsored_products(p_surface text,p_category_id uuid default null,p_limit integer default 4,p_session text default null)returns setof jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('campaign_id',c.id,'product_id',p.id,'title',p.title,'images',p.images,'seller',jsonb_build_object('username',u.username,'display_name',u.display_name),
 'price',(ep->>'effective_price')::numeric,'base_price',(ep->>'base_price')::numeric,'promotion_id',ep->>'promotion_id','sponsored',true,'label','Patrocinado')
 from public.marketplace_ad_campaigns c join public.products p on p.id=c.product_id join public.user_profiles u on u.id=c.seller_id
 join lateral(select v.id from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id where v.product_id=p.id and v.status='active'and v.archived_at is null and l.on_hand-l.reserved>0 order by v.is_default desc,v.created_at limit 1)v on true
 cross join lateral public.marketplace_ad_delivery_eligibility_at(c.id,now())elig
 cross join lateral public.marketplace_effective_price(p.id,v.id,now())ep
 where p_surface in('marketplace_home','marketplace_search')and elig.eligible and c.funded_at is not null and c.status in('active','scheduled')and c.spent_bdag+c.released_bdag<c.total_budget_bdag and(p_category_id is null or p.category_id=p_category_id)
 order by md5(c.id::text||coalesce(p_session,'public')||date_trunc('hour',now())::text) limit least(greatest(p_limit,0),8);
$$;

create or replace function public.record_marketplace_ad_event(p_campaign_id uuid,p_product_id uuid,p_event_type text,p_surface text,p_event_key text,p_anonymous_session_id text default null,p_metadata jsonb default'{}')returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();c public.marketplace_ad_campaigns;prior public.marketplace_ad_events;bucket timestamptz:=to_timestamp(floor(extract(epoch from now())/600)*600);created public.marketplace_ad_events;touch uuid;allowed text[];
begin
 if actor is null and(p_anonymous_session_id is null or char_length(p_anonymous_session_id)not between 16 and 128)then raise exception using errcode='22023',message='marketplace_ad_actor_required';end if;
 if p_event_type not in('impression','click','product_view','add_to_cart')or p_surface not in('marketplace_home','marketplace_search','product_detail','cart')then raise exception using errcode='22023',message='marketplace_ad_event_invalid';end if;
 if p_event_key is null or char_length(p_event_key)not between 16 and 160 then raise exception using errcode='22023',message='marketplace_ad_event_key_invalid';end if;
 allowed:=case p_event_type when'impression'then array['position']when'click'then array['position']when'product_view'then array[]::text[]else array['variant_id','quantity']end;
 if jsonb_typeof(p_metadata)<>'object'or exists(select 1 from jsonb_object_keys(p_metadata)k where not(k=any(allowed)))then raise exception using errcode='22023',message='marketplace_ad_metadata_invalid';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id and product_id=p_product_id;if not found then raise exception using errcode='22023',message='marketplace_ad_product_mismatch';end if;
 if p_event_type in('impression','click','product_view')and(not c.eligibility_state or c.starts_at>now()or c.ends_at<=now()or c.status not in('active','scheduled'))then raise exception using errcode='22023',message='marketplace_ad_not_delivery_eligible';end if;
 select*into prior from public.marketplace_ad_events where event_key=p_event_key;if found then if prior.campaign_id<>c.id or prior.product_id<>p_product_id or prior.event_type<>p_event_type or prior.surface<>p_surface or prior.metadata<>p_metadata then raise exception using errcode='23505',message='marketplace_ad_event_idempotency_conflict';end if;return to_jsonb(prior);end if;
 begin insert into public.marketplace_ad_events(campaign_id,product_id,viewer_id,anonymous_session_id,event_type,surface,event_key,event_bucket,metadata)values(c.id,p_product_id,actor,case when actor is null then p_anonymous_session_id end,p_event_type,p_surface,p_event_key,bucket,p_metadata)returning*into created;
 exception when unique_violation then if p_event_type='impression'then select*into created from public.marketplace_ad_events where campaign_id=c.id and coalesce(viewer_id::text,anonymous_session_id)=coalesce(actor::text,p_anonymous_session_id)and surface=p_surface and event_bucket=bucket and event_type='impression';else raise;end if;end;
 if p_event_type='product_view'then insert into public.marketplace_ad_touches(campaign_id,product_id,viewer_id,anonymous_session_id,surface,touched_at,expires_at)values(c.id,p_product_id,actor,case when actor is null then p_anonymous_session_id end,p_surface,now(),now()+interval'24 hours')returning id into touch;end if;
 return to_jsonb(created)||jsonb_build_object('touch_id',touch);
end;$$;

create or replace function public.marketplace_order_item_ad_attribution_trigger()returns trigger language plpgsql security definer set search_path=public as $$
declare buyer uuid;t public.marketplace_ad_touches;
begin select o.buyer_id into buyer from public.marketplace_orders o where o.id=new.order_id;select*into t from public.marketplace_ad_touches where viewer_id=buyer and product_id=new.product_id and touched_at<=now()and expires_at>now()order by touched_at desc limit 1;if found then insert into public.marketplace_order_ad_attribution(order_item_id,order_id,campaign_id,touch_id,attributed_gmv_bdag)values(new.id,new.order_id,t.campaign_id,t.id,new.line_total);insert into public.marketplace_ad_events(campaign_id,product_id,viewer_id,event_type,surface,event_key,event_bucket,metadata,order_item_id)values(t.campaign_id,new.product_id,buyer,'purchase','checkout','purchase:'||new.id,date_trunc('minute',now()),jsonb_build_object('line_total',new.line_total),new.id);end if;return new;end;$$;
create trigger marketplace_order_item_ad_attribution after insert on public.marketplace_order_items for each row execute function public.marketplace_order_item_ad_attribution_trigger();

create or replace function public.fetch_my_marketplace_ad_campaigns(p_status text default null,p_limit integer default 50)returns setof jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'product_id',c.product_id,'product_title',p.title,'images',p.images,'name',c.name,'status',c.status,'budget',c.total_budget_bdag,'spent',c.spent_bdag,'released',c.released_bdag,'remaining',c.total_budget_bdag-c.spent_bdag-c.released_bdag,'starts_at',c.starts_at,'ends_at',c.ends_at,'eligible_elapsed_seconds',c.eligible_elapsed_seconds,'impressions',count(e.id)filter(where e.event_type='impression'),'clicks',count(e.id)filter(where e.event_type='click'),'product_views',count(e.id)filter(where e.event_type='product_view'),'cart_adds',count(e.id)filter(where e.event_type='add_to_cart'),'orders',count(e.id)filter(where e.event_type='purchase'),'gmv',coalesce(sum((e.metadata->>'line_total')::numeric)filter(where e.event_type='purchase'),0))
 from public.marketplace_ad_campaigns c join public.products p on p.id=c.product_id left join public.marketplace_ad_events e on e.campaign_id=c.id where c.seller_id=auth.uid()and(p_status is null or c.status=p_status)group by c.id,p.id order by c.created_at desc limit least(greatest(p_limit,1),100);$$;
create or replace function public.fetch_my_marketplace_ad_campaign_detail(p_campaign_id uuid)returns jsonb language sql stable security definer set search_path=public as $$select x from public.fetch_my_marketplace_ad_campaigns(null,100)x where(x->>'id')::uuid=p_campaign_id and exists(select 1 from public.marketplace_ad_campaigns c where c.id=p_campaign_id and c.seller_id=auth.uid());$$;
create or replace function public.fetch_marketplace_ad_config()returns jsonb language sql stable security definer set search_path=public as $$select to_jsonb(c)from public.marketplace_ad_config c where singleton;$$;

create or replace function public.reconcile_marketplace_ad_delivery()returns jsonb language sql stable security definer set search_path=public as $$select jsonb_build_object('overspend',(select count(*)from public.marketplace_ad_campaigns where spent_bdag>total_budget_bdag),'bucket_duplicates',0,'materialization_finance_mismatch',(select count(*)from public.marketplace_ad_delivery_materializations m left join public.marketplace_ad_financial_events e on e.id=m.financial_event_id where(m.delta_spend_bdag>0 and(e.id is null or e.amount_bdag<>m.delta_spend_bdag or e.event_type<>'spend'))or(m.delta_spend_bdag=0 and e.id is not null)),'orphan_materialization',0,'target_violations',(select count(*)from public.marketplace_ad_delivery_materializations where spent_before_bdag+delta_spend_bdag>target_spend_bdag));$$;
create or replace function public.reconcile_marketplace_ad_events()returns jsonb language sql stable security definer set search_path=public as $$select jsonb_build_object('campaign_product_mismatch',(select count(*)from public.marketplace_ad_events e join public.marketplace_ad_campaigns c on c.id=e.campaign_id where c.product_id<>e.product_id),'purchase_without_order_attribution',(select count(*)from public.marketplace_ad_events e left join public.marketplace_order_ad_attribution a on a.order_item_id=e.order_item_id where e.event_type='purchase'and a.order_item_id is null),'invalid_events',0,'duplicate_event_keys',0);$$;

alter table public.marketplace_ad_delivery_materializations enable row level security;alter table public.marketplace_ad_events enable row level security;alter table public.marketplace_ad_touches enable row level security;alter table public.marketplace_order_ad_attribution enable row level security;
revoke all on public.marketplace_ad_delivery_materializations,public.marketplace_ad_events,public.marketplace_ad_touches,public.marketplace_order_ad_attribution from public,anon,authenticated;
grant all on public.marketplace_ad_delivery_materializations,public.marketplace_ad_events,public.marketplace_ad_touches,public.marketplace_order_ad_attribution to service_role;
revoke all on function public.materialize_marketplace_ad_campaign_spend(uuid),public.reconcile_marketplace_ad_delivery(),public.reconcile_marketplace_ad_events()from public,anon,authenticated;grant execute on function public.materialize_marketplace_ad_campaign_spend(uuid),public.reconcile_marketplace_ad_delivery(),public.reconcile_marketplace_ad_events()to service_role;
revoke all on function public.fetch_marketplace_sponsored_products(text,uuid,integer,text),public.record_marketplace_ad_event(uuid,uuid,text,text,text,text,jsonb)from public;grant execute on function public.fetch_marketplace_sponsored_products(text,uuid,integer,text),public.record_marketplace_ad_event(uuid,uuid,text,text,text,text,jsonb)to anon,authenticated;
revoke all on function public.fetch_my_marketplace_ad_campaigns(text,integer),public.fetch_my_marketplace_ad_campaign_detail(uuid),public.fetch_marketplace_ad_config()from public,anon;grant execute on function public.fetch_my_marketplace_ad_campaigns(text,integer),public.fetch_my_marketplace_ad_campaign_detail(uuid),public.fetch_marketplace_ad_config()to authenticated;
notify pgrst,'reload schema';commit;
