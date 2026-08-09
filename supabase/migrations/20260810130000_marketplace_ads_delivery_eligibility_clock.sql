begin;

alter table public.marketplace_ad_campaigns
  add column eligible_elapsed_seconds bigint not null default 0 check(eligible_elapsed_seconds>=0),
  add column eligibility_checkpoint_at timestamptz,
  add column eligibility_state boolean not null default false,
  add column eligibility_reason text;

alter table public.marketplace_ad_campaigns add constraint marketplace_ad_eligibility_reason_check
  check(eligibility_reason is null or eligibility_reason in(
    'unfunded','paused','scheduled','expired','budget_exhausted','terminal',
    'seller_restricted','store_inactive','product_inactive','moderation',
    'product_unpublished','unsupported_product','no_variant','out_of_stock','eligible'
  ));

create index marketplace_ad_campaigns_product_clock_idx on public.marketplace_ad_campaigns(product_id,id)
  where funded_at is not null and status in('scheduled','active','paused');
create index marketplace_ad_campaigns_store_clock_idx on public.marketplace_ad_campaigns(store_id,id)
  where funded_at is not null and status in('scheduled','active','paused');
create index marketplace_ad_campaigns_seller_clock_idx on public.marketplace_ad_campaigns(seller_id,id)
  where funded_at is not null and status in('scheduled','active','paused');

create or replace function public.marketplace_ad_clock_time() returns timestamptz
language plpgsql volatile security definer set search_path=public as $$
declare test_time text;
begin
 if auth.role()='service_role'then test_time:=current_setting('app.marketplace_ad_test_time',true);end if;
 return case when nullif(test_time,'')is null then clock_timestamp()else test_time::timestamptz end;
end;$$;

create or replace function public.marketplace_ad_delivery_eligibility_at(p_campaign_id uuid,p_at_time timestamptz)
returns table(eligible boolean,reason text)
language plpgsql stable security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns; p public.products;
begin
 select * into c from public.marketplace_ad_campaigns where id=p_campaign_id;
 if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if c.funded_at is null then return query select false,'unfunded'::text;return;end if;
 if c.status='paused' then return query select false,'paused'::text;return;end if;
 if c.status in('completed','cancelled','exhausted') then return query select false,case when c.status='exhausted'then'budget_exhausted'else'terminal'end;return;end if;
 if p_at_time<c.starts_at then return query select false,'scheduled'::text;return;end if;
 if p_at_time>=c.ends_at then return query select false,'expired'::text;return;end if;
 if c.spent_bdag+c.released_bdag>=c.total_budget_bdag then return query select false,'budget_exhausted'::text;return;end if;
 if not public.marketplace_seller_is_approved(c.seller_id) then return query select false,'seller_restricted'::text;return;end if;
 if not exists(select 1 from public.marketplace_stores s where s.id=c.store_id and s.seller_id=c.seller_id and s.status='active') then return query select false,'store_inactive'::text;return;end if;
 select * into p from public.products where id=c.product_id and seller_id=c.seller_id and store_id=c.store_id;
 if not found or p.deleted_at is not null or p.status<>'active' then return query select false,'product_inactive'::text;return;end if;
 if p.moderation_status<>'approved' then return query select false,'moderation'::text;return;end if;
 if p.published_at is null then return query select false,'product_unpublished'::text;return;end if;
 if p.product_type<>'physical' or p.currency<>'BDAG' then return query select false,'unsupported_product'::text;return;end if;
 if not exists(select 1 from public.marketplace_product_variants v where v.product_id=p.id and v.status='active' and v.archived_at is null) then return query select false,'no_variant'::text;return;end if;
 if not exists(select 1 from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id where v.product_id=p.id and v.status='active' and v.archived_at is null and l.on_hand-l.reserved>0) then return query select false,'out_of_stock'::text;return;end if;
 return query select true,'eligible'::text;
end;$$;

create or replace function public.marketplace_ad_checkpoint_eligibility_at(p_campaign_id uuid,p_at_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns; next_state boolean;next_reason text;from_at timestamptz;to_at timestamptz;delta bigint:=0;
begin
 if auth.role()<>'service_role' and pg_trigger_depth()=0 then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_at_time is null then raise exception using errcode='22023',message='marketplace_ad_checkpoint_time_required';end if;
 select * into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;
 if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if c.eligibility_checkpoint_at is not null and p_at_time<c.eligibility_checkpoint_at then raise exception using errcode='22023',message='marketplace_ad_checkpoint_time_regression';end if;
 if c.eligibility_state and c.eligibility_checkpoint_at is not null then
   from_at:=greatest(c.eligibility_checkpoint_at,c.starts_at,coalesce(c.funded_at,c.starts_at));to_at:=least(p_at_time,c.ends_at);
   if to_at>from_at then delta:=floor(extract(epoch from(to_at-from_at)))::bigint;end if;
 end if;
 select e.eligible,e.reason into next_state,next_reason from public.marketplace_ad_delivery_eligibility_at(c.id,p_at_time)e;
 update public.marketplace_ad_campaigns set eligible_elapsed_seconds=eligible_elapsed_seconds+delta,
   eligibility_checkpoint_at=p_at_time,eligibility_state=next_state,eligibility_reason=next_reason where id=c.id;
 return jsonb_build_object('campaign_id',c.id,'eligible_elapsed_seconds',c.eligible_elapsed_seconds+delta,
   'eligibility_checkpoint_at',p_at_time,'eligibility_state',next_state,'eligibility_reason',next_reason);
end;$$;

create or replace function public.checkpoint_marketplace_ad_eligibility(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.role()<>'service_role' then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 return public.marketplace_ad_checkpoint_eligibility_at(p_campaign_id,public.marketplace_ad_clock_time());
end;$$;

create or replace function public.marketplace_ad_checkpoint_campaign_set(p_seller_id uuid,p_store_id uuid,p_product_id uuid,p_at_time timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare campaign_id uuid;
begin
 for campaign_id in select c.id from public.marketplace_ad_campaigns c
   where c.funded_at is not null and c.status in('scheduled','active','paused')
   and(p_seller_id is null or c.seller_id=p_seller_id)and(p_store_id is null or c.store_id=p_store_id)and(p_product_id is null or c.product_id=p_product_id)
   order by c.id
 loop perform public.marketplace_ad_checkpoint_eligibility_at(campaign_id,p_at_time);end loop;
end;$$;

create or replace function public.marketplace_ad_campaign_clock_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
declare at_time timestamptz:=public.marketplace_ad_clock_time();from_at timestamptz;to_at timestamptz;delta bigint:=0;state boolean;reason text;
begin
 if old.eligibility_state and old.eligibility_checkpoint_at is not null then from_at:=greatest(old.eligibility_checkpoint_at,old.starts_at,coalesce(old.funded_at,old.starts_at));to_at:=least(at_time,old.ends_at);if to_at>from_at then delta:=floor(extract(epoch from(to_at-from_at)))::bigint;end if;end if;
 new.eligible_elapsed_seconds:=old.eligible_elapsed_seconds+delta;new.eligibility_checkpoint_at:=at_time;
 if new.funded_at is null then state:=false;reason:='unfunded';
 elsif new.status='paused'then state:=false;reason:='paused';
 elsif new.status in('completed','cancelled','exhausted')then state:=false;reason:=case when new.status='exhausted'then'budget_exhausted'else'terminal'end;
 elsif at_time<new.starts_at then state:=false;reason:='scheduled';elsif at_time>=new.ends_at then state:=false;reason:='expired';
 elsif new.spent_bdag+new.released_bdag>=new.total_budget_bdag then state:=false;reason:='budget_exhausted';
 elsif not public.marketplace_seller_is_approved(new.seller_id)then state:=false;reason:='seller_restricted';
 elsif not exists(select 1 from public.marketplace_stores s where s.id=new.store_id and s.seller_id=new.seller_id and s.status='active')then state:=false;reason:='store_inactive';
 elsif not exists(select 1 from public.products p where p.id=new.product_id and p.seller_id=new.seller_id and p.store_id=new.store_id and p.deleted_at is null and p.status='active')then state:=false;reason:='product_inactive';
 elsif exists(select 1 from public.products p where p.id=new.product_id and p.moderation_status<>'approved')then state:=false;reason:='moderation';
 elsif exists(select 1 from public.products p where p.id=new.product_id and p.published_at is null)then state:=false;reason:='product_unpublished';
 elsif exists(select 1 from public.products p where p.id=new.product_id and(p.product_type<>'physical'or p.currency<>'BDAG'))then state:=false;reason:='unsupported_product';
 elsif not exists(select 1 from public.marketplace_product_variants v where v.product_id=new.product_id and v.status='active'and v.archived_at is null)then state:=false;reason:='no_variant';
 elsif not exists(select 1 from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id where v.product_id=new.product_id and v.status='active'and v.archived_at is null and l.on_hand-l.reserved>0)then state:=false;reason:='out_of_stock';
 else state:=true;reason:='eligible';end if;
 new.eligibility_state:=state;new.eligibility_reason:=reason;
 return new;
end;$$;
create trigger marketplace_ad_campaign_clock_before before update of status,starts_at,ends_at,spent_bdag,released_bdag,funded_at on public.marketplace_ad_campaigns for each row execute function public.marketplace_ad_campaign_clock_trigger();

create or replace function public.marketplace_ad_source_clock_before_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
declare at_time timestamptz:=public.marketplace_ad_clock_time();pid uuid;sid uuid;stid uuid;
begin
 if tg_table_name='marketplace_sellers'then sid:=old.user_id;
 elsif tg_table_name='marketplace_stores'then stid:=old.id;
 elsif tg_table_name='products'then pid:=old.id;
 elsif tg_table_name='marketplace_product_variants'then pid:=old.product_id;
 else select v.product_id into pid from public.marketplace_product_variants v where v.id=old.variant_id;end if;
 perform public.marketplace_ad_checkpoint_campaign_set(sid,stid,pid,at_time);return new;
end;$$;
create or replace function public.marketplace_ad_source_clock_after_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
declare at_time timestamptz:=public.marketplace_ad_clock_time();pid uuid;sid uuid;stid uuid;
begin
 if tg_table_name='marketplace_sellers'then sid:=new.user_id;
 elsif tg_table_name='marketplace_stores'then stid:=new.id;
 elsif tg_table_name='products'then pid:=new.id;
 elsif tg_table_name='marketplace_product_variants'then pid:=new.product_id;
 else select v.product_id into pid from public.marketplace_product_variants v where v.id=new.variant_id;end if;
 perform public.marketplace_ad_checkpoint_campaign_set(sid,stid,pid,at_time);return new;
end;$$;

create trigger marketplace_ad_seller_clock_before before update of status,approved_at on public.marketplace_sellers for each row when((old.status,old.approved_at)is distinct from(new.status,new.approved_at))execute function public.marketplace_ad_source_clock_before_trigger();
create trigger marketplace_ad_seller_clock_after after update of status,approved_at on public.marketplace_sellers for each row when((old.status,old.approved_at)is distinct from(new.status,new.approved_at))execute function public.marketplace_ad_source_clock_after_trigger();
create trigger marketplace_ad_store_clock_before before update of status on public.marketplace_stores for each row when(old.status is distinct from new.status)execute function public.marketplace_ad_source_clock_before_trigger();
create trigger marketplace_ad_store_clock_after after update of status on public.marketplace_stores for each row when(old.status is distinct from new.status)execute function public.marketplace_ad_source_clock_after_trigger();
create trigger marketplace_ad_product_clock_before before update of status,moderation_status,deleted_at,published_at,currency,product_type on public.products for each row when((old.status,old.moderation_status,old.deleted_at,old.published_at,old.currency,old.product_type)is distinct from(new.status,new.moderation_status,new.deleted_at,new.published_at,new.currency,new.product_type))execute function public.marketplace_ad_source_clock_before_trigger();
create trigger marketplace_ad_product_clock_after after update of status,moderation_status,deleted_at,published_at,currency,product_type on public.products for each row when((old.status,old.moderation_status,old.deleted_at,old.published_at,old.currency,old.product_type)is distinct from(new.status,new.moderation_status,new.deleted_at,new.published_at,new.currency,new.product_type))execute function public.marketplace_ad_source_clock_after_trigger();
create trigger marketplace_ad_variant_clock_before before update of status,archived_at on public.marketplace_product_variants for each row when((old.status,old.archived_at)is distinct from(new.status,new.archived_at))execute function public.marketplace_ad_source_clock_before_trigger();
create trigger marketplace_ad_variant_clock_after after update of status,archived_at on public.marketplace_product_variants for each row when((old.status,old.archived_at)is distinct from(new.status,new.archived_at))execute function public.marketplace_ad_source_clock_after_trigger();
create trigger marketplace_ad_inventory_clock_before before update of on_hand,reserved on public.marketplace_inventory_levels for each row when((old.on_hand-old.reserved>0)is distinct from(new.on_hand-new.reserved>0))execute function public.marketplace_ad_source_clock_before_trigger();
create trigger marketplace_ad_inventory_clock_after after update of on_hand,reserved on public.marketplace_inventory_levels for each row when((old.on_hand-old.reserved>0)is distinct from(new.on_hand-new.reserved>0))execute function public.marketplace_ad_source_clock_after_trigger();

create or replace function public.marketplace_ad_eligibility_clock_projection(p_campaign_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();c public.marketplace_ad_campaigns;effective bigint;at_time timestamptz:=statement_timestamp();live_state boolean;live_reason text;
begin
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id;if not found or(auth.role()<>'service_role'and c.seller_id<>actor)then raise exception using errcode='42501',message='marketplace_ad_campaign_not_owned';end if;
 select e.eligible,e.reason into live_state,live_reason from public.marketplace_ad_delivery_eligibility_at(c.id,at_time)e;
 effective:=c.eligible_elapsed_seconds;
 if(c.eligibility_state or(c.eligibility_reason='scheduled'and live_state))and c.eligibility_checkpoint_at is not null then effective:=effective+greatest(0,floor(extract(epoch from(least(at_time,c.ends_at)-greatest(c.eligibility_checkpoint_at,c.starts_at,coalesce(c.funded_at,c.starts_at)))))::bigint);end if;
 return jsonb_build_object('campaign_id',c.id,'eligible_elapsed_seconds',c.eligible_elapsed_seconds,'effective_eligible_elapsed_seconds',effective,'eligibility_checkpoint_at',c.eligibility_checkpoint_at,'eligibility_state',live_state,'eligibility_reason',live_reason);
end;$$;

create or replace function public.reconcile_marketplace_ad_eligibility_clock() returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object('clock_mismatches',count(*)filter(where eligible_elapsed_seconds<0 or eligibility_checkpoint_at>clock_timestamp()+interval'5 seconds' or(status in('paused','completed','cancelled','exhausted')and eligibility_state)or(funded_at is null and(eligible_elapsed_seconds<>0 or eligibility_state))or(eligibility_state and eligibility_reason<>'eligible')or(not eligibility_state and eligibility_reason='eligible')),
 'terminal_eligible',count(*)filter(where status in('completed','cancelled','exhausted')and eligibility_state),
 'paused_eligible',count(*)filter(where status='paused'and eligibility_state),'unfunded_elapsed',count(*)filter(where funded_at is null and eligible_elapsed_seconds<>0))from public.marketplace_ad_campaigns;$$;

revoke all on function public.marketplace_ad_clock_time(),public.marketplace_ad_delivery_eligibility_at(uuid,timestamptz),public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz),public.checkpoint_marketplace_ad_eligibility(uuid),public.marketplace_ad_checkpoint_campaign_set(uuid,uuid,uuid,timestamptz),public.reconcile_marketplace_ad_eligibility_clock() from public,anon,authenticated;
grant execute on function public.marketplace_ad_delivery_eligibility_at(uuid,timestamptz),public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz),public.checkpoint_marketplace_ad_eligibility(uuid),public.marketplace_ad_checkpoint_campaign_set(uuid,uuid,uuid,timestamptz),public.reconcile_marketplace_ad_eligibility_clock() to service_role;
revoke all on function public.marketplace_ad_eligibility_clock_projection(uuid) from public,anon;
grant execute on function public.marketplace_ad_eligibility_clock_projection(uuid) to authenticated,service_role;

comment on function public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz)is 'Internal service-role/testable eligibility clock. No ledger or Ads spend mutation.';
commit;
