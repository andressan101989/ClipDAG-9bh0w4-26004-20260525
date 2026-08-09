begin;

create table public.marketplace_ad_finalizations(
  campaign_id uuid primary key references public.marketplace_ad_campaigns(id),
  idempotency_key uuid not null unique,
  eligible_elapsed_seconds bigint not null check(eligible_elapsed_seconds>=0),
  delivery_target_seconds bigint not null check(delivery_target_seconds>0),
  final_target_bdag numeric(20,8) not null check(final_target_bdag>=0),
  spent_before_bdag numeric(20,8) not null check(spent_before_bdag>=0),
  final_spend_delta_bdag numeric(20,8) not null check(final_spend_delta_bdag>=0),
  released_bdag numeric(20,8) not null check(released_bdag>=0),
  finalized_at timestamptz not null default now()
);

create or replace function public.finalize_marketplace_ad_campaign_delivery(p_campaign_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 c public.marketplace_ad_campaigns; prior public.marketplace_ad_finalizations;
 target_seconds bigint; target numeric(20,8); delta numeric(20,8); unused numeric(20,8);
 escrow uuid; revenue uuid; seller_account uuid; spend_tx uuid; release_tx uuid;
 spend_key uuid; release_key uuid; result jsonb;
begin
 if auth.role()<>'service_role' then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
 select*into prior from public.marketplace_ad_finalizations where idempotency_key=p_idempotency_key;
 if found and prior.campaign_id<>p_campaign_id then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;
 if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 select*into prior from public.marketplace_ad_finalizations where campaign_id=c.id;
 if found then
  return jsonb_build_object('campaign',public.marketplace_ad_campaign_result(c.id),'eligible_elapsed_seconds',prior.eligible_elapsed_seconds,'delivery_target_seconds',prior.delivery_target_seconds,'final_target_bdag',prior.final_target_bdag,'spent_before_bdag',prior.spent_before_bdag,'final_spend_delta_bdag',prior.final_spend_delta_bdag,'released_bdag',prior.released_bdag,'finalized_at',prior.finalized_at);
 end if;
 if c.funded_at is null then raise exception using errcode='22023',message='marketplace_ad_not_funded';end if;
 if now()<c.ends_at then raise exception using errcode='22023',message='marketplace_ad_not_expired';end if;
 if c.status in('completed','cancelled','exhausted') then raise exception using errcode='22023',message='marketplace_ad_terminal_without_finalization';end if;

 if c.eligibility_checkpoint_at is null or c.eligibility_checkpoint_at<=c.ends_at then
  perform public.marketplace_ad_checkpoint_eligibility_at(c.id,c.ends_at);
 else
  perform public.marketplace_ad_checkpoint_eligibility_at(c.id,c.eligibility_checkpoint_at);
 end if;
 select*into c from public.marketplace_ad_campaigns where id=c.id for update;
 target_seconds:=floor(extract(epoch from(c.ends_at-c.starts_at)))::bigint;
 if target_seconds<=0 then raise exception using errcode='22023',message='marketplace_ad_delivery_target_invalid';end if;
 target:=least(c.total_budget_bdag,round(c.total_budget_bdag*c.eligible_elapsed_seconds::numeric/target_seconds::numeric,8));
 if c.spent_bdag>target then raise exception using errcode='22023',message='marketplace_ad_spend_above_final_pacing_target';end if;
 delta:=target-c.spent_bdag;
 unused:=c.total_budget_bdag-target-c.released_bdag;
 if delta<0 or unused<0 or delta+unused<>c.total_budget_bdag-c.spent_bdag-c.released_bdag then raise exception using errcode='22023',message='marketplace_ad_finalization_accounting_invalid';end if;

 escrow:=public.ensure_marketplace_ads_account('marketplace_ads_escrow');
 revenue:=public.ensure_marketplace_ads_account('marketplace_ads_revenue');
 seller_account:=public.ensure_ledger_account(c.seller_id);
 perform 1 from public.ledger_accounts where id=any(array[escrow,revenue,seller_account]) order by id for update;
 spend_key:=((substr(md5(c.id::text||':final-pacing-spend'),1,8)||'-'||substr(md5(c.id::text||':final-pacing-spend'),9,4)||'-'||substr(md5(c.id::text||':final-pacing-spend'),13,4)||'-'||substr(md5(c.id::text||':final-pacing-spend'),17,4)||'-'||substr(md5(c.id::text||':final-pacing-spend'),21,12))::uuid);
 release_key:=((substr(md5(c.id::text||':final-pacing-release'),1,8)||'-'||substr(md5(c.id::text||':final-pacing-release'),9,4)||'-'||substr(md5(c.id::text||':final-pacing-release'),13,4)||'-'||substr(md5(c.id::text||':final-pacing-release'),17,4)||'-'||substr(md5(c.id::text||':final-pacing-release'),21,12))::uuid);
 if delta>0 then
  spend_tx:=gen_random_uuid();
  insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
  values(spend_tx,escrow,revenue,'marketplace_ad_spend',delta,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,spend_key::text,c.seller_id);
  perform public.ledger_debit(spend_tx,escrow,delta,'Marketplace ad final pacing spend',jsonb_build_object('campaign_id',c.id,'finalization',true,'effective_delivery_at',c.ends_at));
  perform public.ledger_credit(spend_tx,revenue,delta,'Marketplace ads final pacing revenue',jsonb_build_object('campaign_id',c.id,'finalization',true,'effective_delivery_at',c.ends_at));
  insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)values(c.id,c.seller_id,'spend',delta,spend_tx,spend_key);
 end if;
 if unused>0 then
  release_tx:=gen_random_uuid();
  insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
  values(release_tx,escrow,seller_account,'marketplace_ad_release',unused,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,release_key::text,c.seller_id);
  perform public.ledger_debit(release_tx,escrow,unused,'Marketplace ad final unused budget release',jsonb_build_object('campaign_id',c.id,'finalization',true,'effective_delivery_at',c.ends_at));
  perform public.ledger_credit(release_tx,seller_account,unused,'Marketplace ad final budget returned',jsonb_build_object('campaign_id',c.id,'finalization',true,'effective_delivery_at',c.ends_at));
  insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)values(c.id,c.seller_id,'release',unused,release_tx,release_key);
 end if;
 update public.marketplace_ad_campaigns set spent_bdag=spent_bdag+delta,released_bdag=released_bdag+unused,status=case when spent_bdag+delta=total_budget_bdag then'exhausted'else'completed'end,completed_at=now(),eligibility_state=false,eligibility_reason=case when spent_bdag+delta=total_budget_bdag then'budget_exhausted'else'terminal'end,updated_at=now()where id=c.id;
 insert into public.marketplace_ad_finalizations(campaign_id,idempotency_key,eligible_elapsed_seconds,delivery_target_seconds,final_target_bdag,spent_before_bdag,final_spend_delta_bdag,released_bdag)
 values(c.id,p_idempotency_key,c.eligible_elapsed_seconds,target_seconds,target,c.spent_bdag,delta,unused) returning jsonb_build_object('campaign',public.marketplace_ad_campaign_result(c.id),'eligible_elapsed_seconds',eligible_elapsed_seconds,'delivery_target_seconds',delivery_target_seconds,'final_target_bdag',final_target_bdag,'spent_before_bdag',spent_before_bdag,'final_spend_delta_bdag',final_spend_delta_bdag,'released_bdag',released_bdag,'finalized_at',finalized_at)into result;
 return result;
end;$$;

create or replace function public.release_marketplace_ad_unused_budget(p_campaign_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns;amount numeric(20,8);escrow uuid;seller_account uuid;tx uuid:=gen_random_uuid();prior public.marketplace_ad_financial_events;
begin
 if auth.role()<>'service_role'then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
 select*into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 select*into prior from public.marketplace_ad_financial_events where event_type='release'and idempotency_key=p_idempotency_key;
 if found then if prior.campaign_id<>c.id then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;return public.marketplace_ad_campaign_result(c.id);end if;
 if c.funded_at is null or c.status not in('completed','exhausted','cancelled')then raise exception using errcode='22023',message='marketplace_ad_finalization_required';end if;
 amount:=c.total_budget_bdag-c.spent_bdag-c.released_bdag;
 if amount=0 then return public.marketplace_ad_campaign_result(c.id);end if;
 escrow:=public.ensure_marketplace_ads_account('marketplace_ads_escrow');seller_account:=public.ensure_ledger_account(c.seller_id);perform 1 from public.ledger_accounts where id=any(array[escrow,seller_account])order by id for update;
 insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(tx,escrow,seller_account,'marketplace_ad_release',amount,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,p_idempotency_key::text,c.seller_id);
 perform public.ledger_debit(tx,escrow,amount,'Marketplace ad unused budget release',jsonb_build_object('campaign_id',c.id));perform public.ledger_credit(tx,seller_account,amount,'Marketplace ad budget returned',jsonb_build_object('campaign_id',c.id));insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)values(c.id,c.seller_id,'release',amount,tx,p_idempotency_key);update public.marketplace_ad_campaigns set released_bdag=released_bdag+amount,updated_at=now()where id=c.id;return public.marketplace_ad_campaign_result(c.id);
end;$$;

create or replace function public.finalize_expired_marketplace_ad_campaigns(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=public as $$
declare c record;n integer:=0;k uuid;
begin
 if auth.role()<>'service_role'then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_limit not between 1 and 500 then raise exception using errcode='22023',message='marketplace_ad_limit_invalid';end if;
 for c in select id from public.marketplace_ad_campaigns where funded_at is not null and ends_at<=now()and status in('scheduled','active','paused')order by ends_at,id for update skip locked limit p_limit loop
  k:=((substr(md5(c.id::text||':final-delivery-settlement'),1,8)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),9,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),13,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),17,4)||'-'||substr(md5(c.id::text||':final-delivery-settlement'),21,12))::uuid);
  perform public.finalize_marketplace_ad_campaign_delivery(c.id,k);n:=n+1;
 end loop;
 return jsonb_build_object('finalized',n);
end;$$;

create or replace function public.reconcile_marketplace_ad_finalization()returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'expired_unfinalized_liability',(select count(*)from public.marketplace_ad_campaigns c where c.funded_at is not null and c.ends_at<=now()and c.status in('scheduled','active','paused')and c.total_budget_bdag-c.spent_bdag-c.released_bdag>0),
 'final_spend_above_pacing_target',(select count(*)from public.marketplace_ad_finalizations f where f.spent_before_bdag+f.final_spend_delta_bdag>f.final_target_bdag),
 'completed_campaign_remaining_reserved',(select count(*)from public.marketplace_ad_campaigns c where c.status in('completed','exhausted')and c.total_budget_bdag-c.spent_bdag-c.released_bdag<>0),
 'finalization_record_mismatches',(select count(*)from public.marketplace_ad_finalizations f join public.marketplace_ad_campaigns c on c.id=f.campaign_id where f.final_target_bdag<>f.spent_before_bdag+f.final_spend_delta_bdag or f.released_bdag<>c.released_bdag or c.spent_bdag<>f.final_target_bdag)
);$$;

create or replace function public.marketplace_ad_finalizations_immutable()returns trigger language plpgsql set search_path=public as $$begin raise exception using errcode='55000',message='marketplace_ad_finalization_immutable';end;$$;
create trigger marketplace_ad_finalizations_immutable before update or delete on public.marketplace_ad_finalizations for each row execute function public.marketplace_ad_finalizations_immutable();

alter table public.marketplace_ad_finalizations enable row level security;
revoke all on public.marketplace_ad_finalizations from public,anon,authenticated;
grant all on public.marketplace_ad_finalizations to service_role;
revoke all on function public.finalize_marketplace_ad_campaign_delivery(uuid,uuid),public.reconcile_marketplace_ad_finalization()from public,anon,authenticated;
grant execute on function public.finalize_marketplace_ad_campaign_delivery(uuid,uuid),public.reconcile_marketplace_ad_finalization()to service_role;
comment on function public.finalize_marketplace_ad_campaign_delivery(uuid,uuid)is 'Atomically checkpoints delivery at ends_at, settles only earned pacing spend, then releases unused Ads escrow.';
notify pgrst,'reload schema';
commit;
