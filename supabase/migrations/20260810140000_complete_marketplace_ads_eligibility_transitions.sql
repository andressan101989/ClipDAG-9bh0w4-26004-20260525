begin;

create or replace function public.marketplace_ad_delivery_eligibility_at(p_campaign_id uuid,p_at_time timestamptz)
returns table(eligible boolean,reason text)
language plpgsql stable security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns;p public.products;
begin
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id;
 if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if c.funded_at is null then return query select false,'unfunded'::text;return;end if;
 if c.status='paused'then return query select false,'paused'::text;return;end if;
 if c.status in('completed','cancelled','exhausted')then return query select false,case when c.status='exhausted'then'budget_exhausted'else'terminal'end;return;end if;
 if c.spent_bdag+c.released_bdag>=c.total_budget_bdag then return query select false,'budget_exhausted'::text;return;end if;
 if not public.marketplace_seller_is_approved(c.seller_id)then return query select false,'seller_restricted'::text;return;end if;
 if not exists(select 1 from public.marketplace_stores s where s.id=c.store_id and s.seller_id=c.seller_id and s.status='active')then return query select false,'store_inactive'::text;return;end if;
 select*into p from public.products where id=c.product_id and seller_id=c.seller_id and store_id=c.store_id;
 if not found or p.deleted_at is not null or p.status<>'active'then return query select false,'product_inactive'::text;return;end if;
 if p.moderation_status<>'approved'then return query select false,'moderation'::text;return;end if;
 if p.published_at is null then return query select false,'product_unpublished'::text;return;end if;
 if p.product_type<>'physical'or p.currency<>'BDAG'then return query select false,'unsupported_product'::text;return;end if;
 if not exists(select 1 from public.marketplace_product_variants v where v.product_id=p.id and v.status='active'and v.archived_at is null)then return query select false,'no_variant'::text;return;end if;
 if not exists(select 1 from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id where v.product_id=p.id and v.status='active'and v.archived_at is null and l.on_hand-l.reserved>0)then return query select false,'out_of_stock'::text;return;end if;
 if p_at_time<c.starts_at then return query select false,'scheduled'::text;return;end if;
 if p_at_time>=c.ends_at then return query select false,'expired'::text;return;end if;
 return query select true,'eligible'::text;
end;$$;

create or replace function public.marketplace_ad_checkpoint_eligibility_at(p_campaign_id uuid,p_at_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns;next_state boolean;next_reason text;from_at timestamptz;to_at timestamptz;delta bigint:=0;
begin
 if auth.role()<>'service_role'and pg_trigger_depth()=0 then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_at_time is null then raise exception using errcode='22023',message='marketplace_ad_checkpoint_time_required';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;
 if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 if c.eligibility_checkpoint_at is not null and p_at_time<c.eligibility_checkpoint_at then raise exception using errcode='22023',message='marketplace_ad_checkpoint_time_regression';end if;
 select e.eligible,e.reason into next_state,next_reason from public.marketplace_ad_delivery_eligibility_at(c.id,p_at_time)e;
 if c.eligibility_state and c.eligibility_checkpoint_at is not null then
   from_at:=greatest(c.eligibility_checkpoint_at,c.starts_at,coalesce(c.funded_at,c.starts_at));to_at:=least(p_at_time,c.ends_at);
 elsif c.eligibility_reason='scheduled'and next_state and c.eligibility_checkpoint_at is not null then
   from_at:=greatest(c.eligibility_checkpoint_at,c.starts_at,coalesce(c.funded_at,c.starts_at));to_at:=least(p_at_time,c.ends_at);
 end if;
 if from_at is not null and to_at>from_at then delta:=floor(extract(epoch from(to_at-from_at)))::bigint;end if;
 update public.marketplace_ad_campaigns set eligible_elapsed_seconds=eligible_elapsed_seconds+delta,eligibility_checkpoint_at=p_at_time,eligibility_state=next_state,eligibility_reason=next_reason where id=c.id;
 return jsonb_build_object('campaign_id',c.id,'eligible_elapsed_seconds',c.eligible_elapsed_seconds+delta,'eligibility_checkpoint_at',p_at_time,'eligibility_state',next_state,'eligibility_reason',next_reason);
end;$$;

create trigger marketplace_ad_variant_clock_after_insert after insert on public.marketplace_product_variants
for each row execute function public.marketplace_ad_source_clock_after_trigger();
create trigger marketplace_ad_inventory_clock_after_insert after insert on public.marketplace_inventory_levels
for each row execute function public.marketplace_ad_source_clock_after_trigger();

revoke all on function public.marketplace_ad_delivery_eligibility_at(uuid,timestamptz),public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz)from public,anon,authenticated;
grant execute on function public.marketplace_ad_delivery_eligibility_at(uuid,timestamptz),public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz)to service_role;

comment on function public.marketplace_ad_checkpoint_eligibility_at(uuid,timestamptz)is 'Accumulates stored eligible time, including a proven healthy scheduled interval from starts_at. No money movement.';
commit;
