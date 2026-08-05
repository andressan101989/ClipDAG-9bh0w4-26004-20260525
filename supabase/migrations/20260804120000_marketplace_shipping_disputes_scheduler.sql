begin;

create table public.marketplace_shipping_profiles (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.marketplace_sellers(user_id),
  store_id uuid not null references public.marketplace_stores(id),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  status text not null default 'active' check (status in ('active','paused')),
  processing_days_min integer not null check (processing_days_min between 0 and 30),
  processing_days_max integer not null check (processing_days_max between processing_days_min and 60),
  ships_from_country text not null check (ships_from_country ~ '^[A-Z]{2}$'),
  return_policy_summary text not null check (char_length(btrim(return_policy_summary)) between 2 and 1000),
  legacy_unrestricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,store_id,seller_id)
);

create table public.marketplace_shipping_profile_regions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.marketplace_shipping_profiles(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  shipping_price numeric(20,8) not null check (shipping_price >= 0 and shipping_price=round(shipping_price,8)),
  free_shipping_threshold numeric(20,8) check (free_shipping_threshold is null or free_shipping_threshold > 0),
  transit_days_min integer not null check (transit_days_min between 1 and 90),
  transit_days_max integer not null check (transit_days_max between transit_days_min and 180),
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (profile_id,country_code,region_code)
);

alter table public.products add column shipping_profile_id uuid references public.marketplace_shipping_profiles(id);

-- Preserve the exact pre-migration behavior for already-published products. Sellers
-- can replace this explicit legacy profile with a destination-scoped profile.
insert into public.marketplace_shipping_profiles(
  seller_id,store_id,name,processing_days_min,processing_days_max,
  ships_from_country,return_policy_summary,legacy_unrestricted
)
select s.seller_id,s.id,'Envío heredado',0,3,'US',
  'Política de devolución heredada; el vendedor debe actualizarla.',true
from public.marketplace_stores s
where exists(select 1 from public.products p where p.store_id=s.id and p.product_type='physical')
on conflict do nothing;

update public.products p set shipping_profile_id=(
  select x.id from public.marketplace_shipping_profiles x
  where x.store_id=p.store_id and x.seller_id=p.seller_id and x.legacy_unrestricted
  order by x.created_at,x.id limit 1
)
where p.product_type='physical' and p.shipping_profile_id is null;

create table public.marketplace_order_shipping_snapshots (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.marketplace_checkout_sessions(id),
  order_id uuid not null references public.marketplace_orders(id),
  profile_id uuid not null references public.marketplace_shipping_profiles(id),
  destination_country text not null,
  destination_region text,
  shipping_price numeric(20,8) not null check (shipping_price>=0),
  processing_days_min integer not null,
  processing_days_max integer not null,
  transit_days_min integer not null,
  transit_days_max integer not null,
  return_policy_summary text not null,
  created_at timestamptz not null default now(),
  unique(order_id,profile_id)
);

alter table public.marketplace_checkout_sessions add column shipping_amount numeric(20,8) not null default 0;
alter table public.marketplace_orders add column shipping_amount numeric(20,8) not null default 0;
alter table public.marketplace_checkout_sessions drop constraint marketplace_checkout_amount_check;
alter table public.marketplace_checkout_sessions add constraint marketplace_checkout_amount_check
  check(subtotal>0 and subtotal=round(subtotal,8) and shipping_amount>=0 and total=round(subtotal+shipping_amount,8));
alter table public.marketplace_orders drop constraint marketplace_orders_amount_check;
alter table public.marketplace_orders add constraint marketplace_orders_amount_check
  check(subtotal>0 and subtotal=round(subtotal,8) and shipping_amount>=0 and total=round(subtotal+shipping_amount,8));

create or replace function public.marketplace_freeze_order_shipping()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.products; sp public.marketplace_shipping_profiles; rg public.marketplace_shipping_profile_regions;
  destination text; destination_region text; amount numeric(20,8); snapshot_exists boolean;
begin
  select * into p from public.products where id=new.product_id;
  select * into sp from public.marketplace_shipping_profiles where id=p.shipping_profile_id and status='active';
  if sp.id is null then raise exception using message='marketplace_product_not_ready_shipping_incomplete';end if;
  select upper(country),upper(region) into destination,destination_region
  from public.marketplace_checkout_shipping_addresses where checkout_id=new.checkout_id;
  if not sp.legacy_unrestricted then
    select * into rg from public.marketplace_shipping_profile_regions r
    where r.profile_id=sp.id and r.status='active' and r.country_code=destination
      and (r.region_code is null or upper(r.region_code)=destination_region)
    order by (r.region_code is not null) desc limit 1;
    if rg.id is null then raise exception using message='marketplace_shipping_destination_unsupported';end if;
  end if;
  select exists(select 1 from public.marketplace_order_shipping_snapshots s where s.order_id=new.order_id and s.profile_id=sp.id) into snapshot_exists;
  if snapshot_exists then
    if not sp.legacy_unrestricted and rg.free_shipping_threshold is not null
      and (select subtotal from public.marketplace_orders where id=new.order_id)>=rg.free_shipping_threshold then
      select shipping_price into amount from public.marketplace_order_shipping_snapshots where order_id=new.order_id and profile_id=sp.id for update;
      if amount>0 then
        update public.marketplace_order_shipping_snapshots set shipping_price=0 where order_id=new.order_id and profile_id=sp.id;
        update public.marketplace_orders set shipping_amount=shipping_amount-amount,total=total-amount where id=new.order_id;
        update public.marketplace_checkout_sessions set shipping_amount=shipping_amount-amount,total=total-amount where id=new.checkout_id;
      end if;
    end if;
    return new;
  end if;
  amount:=case when sp.legacy_unrestricted then 0
    when rg.free_shipping_threshold is not null and
      (select subtotal from public.marketplace_orders where id=new.order_id)>=rg.free_shipping_threshold then 0
    else rg.shipping_price end;
  insert into public.marketplace_order_shipping_snapshots(
    checkout_id,order_id,profile_id,destination_country,destination_region,shipping_price,
    processing_days_min,processing_days_max,transit_days_min,transit_days_max,return_policy_summary
  ) values(new.checkout_id,new.order_id,sp.id,destination,destination_region,amount,
    sp.processing_days_min,sp.processing_days_max,coalesce(rg.transit_days_min,1),coalesce(rg.transit_days_max,30),sp.return_policy_summary);
  update public.marketplace_orders set shipping_amount=shipping_amount+amount,total=subtotal+shipping_amount+amount where id=new.order_id;
  update public.marketplace_checkout_sessions set shipping_amount=shipping_amount+amount,total=subtotal+shipping_amount+amount where id=new.checkout_id;
  return new;
end$$;
create trigger marketplace_order_item_freeze_shipping after insert on public.marketplace_order_items
for each row execute function public.marketplace_freeze_order_shipping();

alter table public.marketplace_order_shipments add column estimated_delivery_at timestamptz;
create or replace function public.marketplace_set_shipment_estimate()
returns trigger language plpgsql set search_path=public as $$
declare maximum_days integer;
begin
  select max(processing_days_max+transit_days_max) into maximum_days
  from public.marketplace_order_shipping_snapshots where order_id=new.order_id;
  new.estimated_delivery_at:=new.shipped_at+make_interval(days=>coalesce(maximum_days,30));
  return new;
end$$;
create trigger marketplace_shipment_estimate before insert on public.marketplace_order_shipments
for each row execute function public.marketplace_set_shipment_estimate();

create or replace function public.fetch_my_marketplace_shipping_profiles(p_store_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'status',p.status,'processing_days_min',p.processing_days_min,
  'processing_days_max',p.processing_days_max,'ships_from_country',p.ships_from_country,
  'return_policy_summary',p.return_policy_summary,'legacy_unrestricted',p.legacy_unrestricted,
  'regions',coalesce((select jsonb_agg(jsonb_build_object('country_code',r.country_code,'region_code',r.region_code,
    'shipping_price',r.shipping_price,'free_shipping_threshold',r.free_shipping_threshold,
    'transit_days_min',r.transit_days_min,'transit_days_max',r.transit_days_max,'status',r.status))
    from public.marketplace_shipping_profile_regions r where r.profile_id=p.id),'[]'::jsonb)
) order by p.created_at,p.id),'[]'::jsonb)
from public.marketplace_shipping_profiles p where p.store_id=p_store_id and p.seller_id=auth.uid()
$$;

create or replace function public.upsert_my_marketplace_shipping_profile(
  p_profile_id uuid,p_store_id uuid,p_name text,p_processing_days_min integer,p_processing_days_max integer,
  p_ships_from_country text,p_return_policy_summary text,p_regions jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();result uuid:=coalesce(p_profile_id,gen_random_uuid());r jsonb;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_stores s join public.marketplace_sellers ms on ms.user_id=s.seller_id
   where s.id=p_store_id and s.seller_id=actor and s.status='active' and ms.status='approved') then
   raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 or p_processing_days_min not between 0 and 30
   or p_processing_days_max not between p_processing_days_min and 60 or upper(p_ships_from_country)!~'^[A-Z]{2}$'
   or char_length(btrim(coalesce(p_return_policy_summary,''))) not between 2 and 1000
   or jsonb_typeof(p_regions)<>'array' or jsonb_array_length(p_regions)<1 then
   raise exception using message='marketplace_invalid_shipping_profile';end if;
 if p_profile_id is not null and not exists(select 1 from public.marketplace_shipping_profiles where id=p_profile_id and seller_id=actor and store_id=p_store_id) then
   raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
 insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,legacy_unrestricted)
 values(result,actor,p_store_id,btrim(p_name),p_processing_days_min,p_processing_days_max,upper(p_ships_from_country),btrim(p_return_policy_summary),false)
 on conflict(id) do update set name=excluded.name,processing_days_min=excluded.processing_days_min,
 processing_days_max=excluded.processing_days_max,ships_from_country=excluded.ships_from_country,
 return_policy_summary=excluded.return_policy_summary,legacy_unrestricted=false,status='active',updated_at=now();
 delete from public.marketplace_shipping_profile_regions where profile_id=result;
 for r in select * from jsonb_array_elements(p_regions) loop
   if upper(r->>'country_code')!~'^[A-Z]{2}$' or (r->>'shipping_price')::numeric<0
    or (r->>'transit_days_min')::integer not between 1 and 90
    or (r->>'transit_days_max')::integer not between (r->>'transit_days_min')::integer and 180 then
    raise exception using message='marketplace_invalid_shipping_profile';end if;
   insert into public.marketplace_shipping_profile_regions(profile_id,country_code,region_code,shipping_price,free_shipping_threshold,transit_days_min,transit_days_max)
   values(result,upper(r->>'country_code'),nullif(upper(btrim(coalesce(r->>'region_code',''))),''),(r->>'shipping_price')::numeric,
    nullif(r->>'free_shipping_threshold','')::numeric,(r->>'transit_days_min')::integer,(r->>'transit_days_max')::integer);
 end loop;
 return result;
end$$;

create or replace function public.set_my_marketplace_product_shipping_profile(p_product_id uuid,p_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.products p set shipping_profile_id=p_profile_id,updated_at=now()
 where p.id=p_product_id and p.seller_id=auth.uid() and exists(select 1 from public.marketplace_shipping_profiles sp
   where sp.id=p_profile_id and sp.seller_id=auth.uid() and sp.store_id=p.store_id and sp.status='active');
 if not found then raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
end$$;

create or replace function public.publish_marketplace_product(p_product_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare readiness record;
begin
 if not exists(select 1 from public.products p join public.marketplace_shipping_profiles sp on sp.id=p.shipping_profile_id
   where p.id=p_product_id and p.seller_id=auth.uid() and sp.seller_id=auth.uid() and sp.store_id=p.store_id and sp.status='active') then
   raise exception using message='marketplace_product_not_ready_shipping_incomplete';end if;
 perform public.set_marketplace_product_publication(p_product_id,true);
 select * into readiness from public.marketplace_evaluate_live_product_readiness(p_product_id,auth.uid());
 if readiness.reason_code not in('ready','out_of_stock') then
   raise exception using message='marketplace_product_not_ready_'||coalesce(readiness.reason_code,'product_unavailable');end if;
end$$;

alter table public.marketplace_settlement_policy add column dispute_window_days integer not null default 3 check(dispute_window_days between 1 and 30);
alter table public.marketplace_settlement_policy add column maximum_shipment_fallback_days integer not null default 21 check(maximum_shipment_fallback_days between 7 and 90);
update public.marketplace_settlement_policy set maximum_shipment_fallback_days=greatest(maximum_confirmation_days,14);

create or replace function public.marketplace_block_disputed_allocation_release()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.status='held' and new.status='released' and exists(select 1 from public.marketplace_order_disputes d
   where d.order_id=old.order_id and d.status in('open','under_review')) then
   raise exception using message='marketplace_settlement_dispute_active';
 end if;
 return new;
end$$;
create trigger marketplace_dispute_blocks_allocation_release before update of status on public.marketplace_payment_allocations
for each row execute function public.marketplace_block_disputed_allocation_release();

create or replace function public.marketplace_apply_live_commission()
returns trigger language plpgsql set search_path=public as $$
declare src public.marketplace_live_order_sources;pin public.live_session_products;commission numeric(20,8);product_subtotal numeric(20,8);
begin
 select*into src from public.marketplace_live_order_sources where order_id=new.order_id;
 if not found then new.creator_user_id:=null;new.creator_commission_amount:=0;return new;end if;
 select*into pin from public.live_session_products where id=src.live_session_product_id;
 if pin.commerce_mode='affiliate_product' then
  select subtotal into product_subtotal from public.marketplace_orders where id=new.order_id;
  commission:=round(product_subtotal*pin.creator_commission_bps/10000.0,8);
  if commission<=0 or commission>new.gross_amount-new.platform_fee_amount then raise exception using message='marketplace_live_commission_integrity_error';end if;
  new.creator_user_id:=pin.host_id;new.creator_commission_amount:=commission;
  new.seller_net_amount:=new.gross_amount-new.platform_fee_amount-commission;
 else new.creator_user_id:=null;new.creator_commission_amount:=0;end if;
 return new;
end$$;

create table public.marketplace_settlement_run_failures(
 id bigint generated always as identity primary key,order_id uuid,run_at timestamptz not null default now(),failure_code text not null
);
alter table public.marketplace_settlement_run_failures enable row level security;

create or replace function public.settle_eligible_marketplace_orders(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare policy public.marketplace_settlement_policy;candidate record;processed integer:=0;failed integer:=0;v_key uuid;failure text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='marketplace_settlement_service_role_required';end if;
 if p_limit is null or p_limit not between 1 and 500 then raise exception using message='marketplace_settlement_invalid_limit';end if;
 select * into strict policy from public.marketplace_settlement_policy where singleton;
 for candidate in select o.id,o.buyer_id from public.marketplace_orders o
  join public.marketplace_order_shipments sh on sh.order_id=o.id and sh.status='shipped'
  join public.marketplace_payment_allocations a on a.order_id=o.id and a.status='held'
  where o.status='shipped' and sh.shipped_at<=now()-make_interval(days=>policy.maximum_shipment_fallback_days)
   and not exists(select 1 from public.marketplace_order_disputes d where d.order_id=o.id and d.status in('open','under_review'))
   and not exists(select 1 from public.marketplace_order_settlements s where s.order_id=o.id)
  order by sh.shipped_at,o.id limit p_limit for update of o skip locked
 loop begin
  v_key=(substr(md5('marketplace-auto-settlement:'||candidate.id),1,8)||'-'||substr(md5('marketplace-auto-settlement:'||candidate.id),9,4)||'-4'||substr(md5('marketplace-auto-settlement:'||candidate.id),14,3)||'-8'||substr(md5('marketplace-auto-settlement:'||candidate.id),18,3)||'-'||substr(md5('marketplace-auto-settlement:'||candidate.id),21,12))::uuid;
  perform public.confirm_marketplace_order_delivery_and_release(candidate.buyer_id,candidate.id,v_key);processed:=processed+1;
 exception when others then
  failed:=failed+1;failure:=case when sqlstate='40001' then'marketplace_settlement_retryable' else'marketplace_settlement_order_failed'end;
  insert into public.marketplace_settlement_run_failures(order_id,failure_code)values(candidate.id,failure);
 end;end loop;
 return jsonb_build_object('processed',processed,'failed',failed,'dispute_window_days',policy.dispute_window_days,'fallback_days',policy.maximum_shipment_fallback_days);
end$$;

create or replace function public.run_scheduled_marketplace_settlement()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform set_config('request.jwt.claim.role','service_role',true);
 return public.settle_eligible_marketplace_orders(100);
end$$;

do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='settle-eligible-marketplace-orders';
  perform cron.schedule('settle-eligible-marketplace-orders','17 * * * *','select public.run_scheduled_marketplace_settlement()');
 end if;
end$$;

create or replace function public.fetch_my_marketplace_order_lifecycle(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 select * into o from public.marketplace_orders where id=p_order_id;
 if o.id is null then raise exception using message='marketplace_order_not_found';end if;
 if auth.uid() not in(o.buyer_id,o.seller_id) then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 return jsonb_build_object(
  'shipping_amount',o.shipping_amount,
  'shipping',(select jsonb_build_object('estimated_delivery_at',sh.estimated_delivery_at)from public.marketplace_order_shipments sh where sh.order_id=o.id),
  'shipping_snapshot',(select jsonb_build_object('processing_days_min',min(s.processing_days_min),'processing_days_max',max(s.processing_days_max),
   'transit_days_min',min(s.transit_days_min),'transit_days_max',max(s.transit_days_max),'return_policy_summary',max(s.return_policy_summary))
   from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),
  'dispute',(select jsonb_build_object('status',d.status,'reason_code',d.reason_code,'created_at',d.created_at)
   from public.marketplace_order_disputes d where d.order_id=o.id order by d.created_at desc limit 1)
 );
end$$;

alter table public.marketplace_shipping_profiles enable row level security;
alter table public.marketplace_shipping_profile_regions enable row level security;
alter table public.marketplace_order_shipping_snapshots enable row level security;
revoke all on public.marketplace_shipping_profiles,public.marketplace_shipping_profile_regions,
 public.marketplace_order_shipping_snapshots,public.marketplace_settlement_run_failures from public,anon,authenticated;
revoke all on function public.marketplace_freeze_order_shipping(),public.marketplace_set_shipment_estimate(),public.marketplace_block_disputed_allocation_release(),
 public.run_scheduled_marketplace_settlement() from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_shipping_profiles(uuid),public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb),
 public.set_my_marketplace_product_shipping_profile(uuid,uuid),public.fetch_my_marketplace_order_lifecycle(uuid) from public,anon;
grant execute on function public.fetch_my_marketplace_shipping_profiles(uuid),public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb),
 public.set_my_marketplace_product_shipping_profile(uuid,uuid),public.fetch_my_marketplace_order_lifecycle(uuid) to authenticated,service_role;
grant execute on function public.run_scheduled_marketplace_settlement() to service_role;

comment on function public.run_scheduled_marketplace_settlement() is 'Trusted hourly pg_cron entrypoint; never callable by mobile clients.';
comment on table public.marketplace_order_shipping_snapshots is 'Immutable checkout-time shipping price and estimate snapshot.';

commit;
