begin;

alter table public.ledger_accounts drop constraint ledger_accounts_account_type_check;
alter table public.ledger_accounts add constraint ledger_accounts_account_type_check
  check(account_type in('user','escrow','treasury','platform','marketplace_escrow','marketplace_ads_escrow','marketplace_ads_revenue'));

create table public.marketplace_ad_config(
  singleton boolean primary key default true check(singleton),
  minimum_budget_bdag numeric(20,8) not null check(minimum_budget_bdag>0),
  maximum_budget_bdag numeric(20,8) not null check(maximum_budget_bdag>=minimum_budget_bdag),
  minimum_duration interval not null check(minimum_duration>=interval '1 hour'),
  maximum_duration interval not null check(maximum_duration<=interval '30 days'),
  updated_at timestamptz not null default now()
);
insert into public.marketplace_ad_config(singleton,minimum_budget_bdag,maximum_budget_bdag,minimum_duration,maximum_duration)
values(true,10,1000000,interval '1 hour',interval '30 days');

create table public.marketplace_ad_campaigns(
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references auth.users(id),
  store_id uuid not null references public.marketplace_stores(id), product_id uuid not null references public.products(id),
  name text, status text not null default 'draft' check(status in('draft','scheduled','active','paused','exhausted','completed','cancelled')),
  starts_at timestamptz not null, ends_at timestamptz not null,
  total_budget_bdag numeric(20,8) not null, spent_bdag numeric(20,8) not null default 0, released_bdag numeric(20,8) not null default 0,
  funded_at timestamptz, paused_at timestamptz, completed_at timestamptz,
  creation_idempotency_key uuid not null, funding_idempotency_key uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(seller_id,creation_idempotency_key), unique(funding_idempotency_key),
  check(name is null or char_length(name) between 1 and 120), check(starts_at<ends_at),
  check(total_budget_bdag=round(total_budget_bdag,8) and total_budget_bdag>0),
  check(spent_bdag=round(spent_bdag,8) and released_bdag=round(released_bdag,8)),
  check(spent_bdag>=0 and released_bdag>=0 and spent_bdag+released_bdag<=total_budget_bdag),
  check((funded_at is null and funding_idempotency_key is null and status='draft') or (funded_at is not null and funding_idempotency_key is not null and status<>'draft'))
);
create index marketplace_ad_campaigns_seller_idx on public.marketplace_ad_campaigns(seller_id,created_at desc);
create index marketplace_ad_campaigns_terminal_idx on public.marketplace_ad_campaigns(ends_at) where status in('scheduled','active','paused');

create table public.marketplace_ad_financial_events(
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.marketplace_ad_campaigns(id),
  seller_id uuid not null references auth.users(id), event_type text not null check(event_type in('fund','spend','release')),
  amount_bdag numeric(20,8) not null check(amount_bdag>0 and amount_bdag=round(amount_bdag,8)),
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  idempotency_key uuid not null, created_at timestamptz not null default now(),
  unique(event_type,idempotency_key)
);
create index marketplace_ad_financial_events_campaign_idx on public.marketplace_ad_financial_events(campaign_id,created_at);
create index marketplace_ad_financial_events_seller_idx on public.marketplace_ad_financial_events(seller_id,created_at desc);

create or replace function public.ensure_marketplace_ads_account(p_account_type text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_account_type not in('marketplace_ads_escrow','marketplace_ads_revenue') then raise exception using errcode='22023',message='marketplace_ads_account_type_invalid';end if;
  insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen) values(null,p_account_type,'BDAG',0,false)
  on conflict on constraint ledger_accounts_system_unique do nothing;
  select id into strict v_id from public.ledger_accounts where owner_id is null and account_type=p_account_type and currency='BDAG';
  return v_id;
end;$$;
select public.ensure_marketplace_ads_account('marketplace_ads_escrow');
select public.ensure_marketplace_ads_account('marketplace_ads_revenue');

create or replace function public.marketplace_ad_product_is_eligible(p_seller uuid,p_product uuid,p_store uuid) returns boolean
language sql stable security definer set search_path=public as $$
select exists(select 1 from public.marketplace_sellers ms join public.marketplace_stores s on s.seller_id=ms.user_id
join public.products p on p.store_id=s.id and p.seller_id=ms.user_id
where ms.user_id=p_seller and s.id=p_store and p.id=p_product and public.marketplace_seller_is_approved(ms.user_id)
and s.status='active' and p.product_type='physical' and p.status='active' and p.moderation_status='approved'
and p.deleted_at is null and p.currency='BDAG' and p.published_at is not null
and exists(select 1 from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id
 where v.product_id=p.id and v.status='active' and v.archived_at is null and l.on_hand-l.reserved>0));$$;

create or replace function public.marketplace_ad_campaign_result(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('id',c.id,'seller_id',c.seller_id,'store_id',c.store_id,'product_id',c.product_id,'name',c.name,'status',c.status,
'starts_at',c.starts_at,'ends_at',c.ends_at,'total_budget_bdag',c.total_budget_bdag,'spent_bdag',c.spent_bdag,'released_bdag',c.released_bdag,
'remaining_reserved_bdag',c.total_budget_bdag-c.spent_bdag-c.released_bdag,'funded_at',c.funded_at,'paused_at',c.paused_at,'completed_at',c.completed_at)
from public.marketplace_ad_campaigns c where c.id=p_id;$$;

create or replace function public.create_marketplace_ad_campaign_draft(p_product_id uuid,p_name text,p_budget_bdag numeric,p_starts_at timestamptz,p_ends_at timestamptz,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); prod public.products; prior public.marketplace_ad_campaigns; cfg public.marketplace_ad_config; normalized numeric(20,8):=round(p_budget_bdag,8); created uuid;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':marketplace-ad-draft:'||p_idempotency_key::text,0));
 select * into prior from public.marketplace_ad_campaigns where seller_id=actor and creation_idempotency_key=p_idempotency_key;
 if found then
  if prior.product_id is distinct from p_product_id or prior.name is distinct from nullif(btrim(p_name),'') or prior.total_budget_bdag is distinct from normalized or prior.starts_at is distinct from p_starts_at or prior.ends_at is distinct from p_ends_at then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;
  return public.marketplace_ad_campaign_result(prior.id);
 end if;
 select * into prod from public.products where id=p_product_id and seller_id=actor and deleted_at is null;
 if not found or not public.marketplace_ad_product_is_eligible(actor,prod.id,prod.store_id) then raise exception using errcode='42501',message='marketplace_ad_product_ineligible';end if;
 select * into strict cfg from public.marketplace_ad_config where singleton;
 if normalized<cfg.minimum_budget_bdag or normalized>cfg.maximum_budget_bdag then raise exception using errcode='22023',message='marketplace_ad_budget_invalid';end if;
 if p_starts_at is null or p_ends_at is null or p_ends_at<=now() or p_ends_at-p_starts_at<cfg.minimum_duration or p_ends_at-p_starts_at>cfg.maximum_duration then raise exception using errcode='22023',message='marketplace_ad_window_invalid';end if;
 insert into public.marketplace_ad_campaigns(seller_id,store_id,product_id,name,starts_at,ends_at,total_budget_bdag,creation_idempotency_key)
 values(actor,prod.store_id,prod.id,nullif(btrim(p_name),''),p_starts_at,p_ends_at,normalized,p_idempotency_key) returning id into created;
 return public.marketplace_ad_campaign_result(created);
end;$$;

create or replace function public.activate_marketplace_ad_campaign(p_campaign_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); c public.marketplace_ad_campaigns; seller_account uuid; escrow_account uuid; tx uuid:=gen_random_uuid(); seller_balance numeric; prior public.marketplace_ad_financial_events;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
 select * into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;
 if not found or c.seller_id<>actor then raise exception using errcode='42501',message='marketplace_ad_campaign_not_owned';end if;
 select * into prior from public.marketplace_ad_financial_events where event_type='fund' and idempotency_key=p_idempotency_key;
 if found then if prior.campaign_id<>c.id or prior.amount_bdag<>c.total_budget_bdag or c.funding_idempotency_key<>p_idempotency_key then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;return public.marketplace_ad_campaign_result(c.id);end if;
 if c.funded_at is not null or c.status<>'draft' then raise exception using errcode='23505',message='marketplace_ad_already_funded';end if;
 if not public.marketplace_ad_product_is_eligible(c.seller_id,c.product_id,c.store_id) then raise exception using errcode='22023',message='marketplace_ad_product_ineligible';end if;
 if c.ends_at<=now() then raise exception using errcode='22023',message='marketplace_ad_window_invalid';end if;
 seller_account:=public.ensure_ledger_account(actor);escrow_account:=public.ensure_marketplace_ads_account('marketplace_ads_escrow');
 perform 1 from public.ledger_accounts where id=any(array[seller_account,escrow_account]) order by id for update;
 select balance into seller_balance from public.ledger_accounts where id=seller_account and currency='BDAG' and not frozen;
 if seller_balance is null or seller_balance<c.total_budget_bdag then raise exception using errcode='P0001',message='marketplace_ad_insufficient_bdag_balance';end if;
 insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
 values(tx,seller_account,escrow_account,'marketplace_ad_fund',c.total_budget_bdag,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,p_idempotency_key::text,actor);
 perform public.ledger_debit(tx,seller_account,c.total_budget_bdag,'Marketplace ad campaign funding',jsonb_build_object('campaign_id',c.id));
 perform public.ledger_credit(tx,escrow_account,c.total_budget_bdag,'Marketplace ads escrow funding',jsonb_build_object('campaign_id',c.id));
 insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key) values(c.id,actor,'fund',c.total_budget_bdag,tx,p_idempotency_key);
 update public.marketplace_ad_campaigns set funded_at=now(),funding_idempotency_key=p_idempotency_key,status=case when starts_at>now() then'scheduled'else'active'end,updated_at=now() where id=c.id;
 return public.marketplace_ad_campaign_result(c.id);
end;$$;

create or replace function public.spend_marketplace_ad_budget(p_campaign_id uuid,p_amount_bdag numeric,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns; amount numeric(20,8):=round(p_amount_bdag,8); escrow uuid; revenue uuid; tx uuid:=gen_random_uuid(); prior public.marketplace_ad_financial_events; remaining numeric;
begin
 if auth.role()<>'service_role' then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_idempotency_key is null or amount<=0 then raise exception using errcode='22023',message='marketplace_ad_spend_invalid';end if;
 select * into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 select * into prior from public.marketplace_ad_financial_events where event_type='spend' and idempotency_key=p_idempotency_key;
 if found then if prior.campaign_id<>c.id or prior.amount_bdag<>amount then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;return public.marketplace_ad_campaign_result(c.id);end if;
 remaining:=c.total_budget_bdag-c.spent_bdag-c.released_bdag;
 if c.status not in('active','scheduled') or now()<c.starts_at or now()>=c.ends_at or not public.marketplace_ad_product_is_eligible(c.seller_id,c.product_id,c.store_id) then raise exception using errcode='22023',message='marketplace_ad_not_spend_eligible';end if;
 if amount>remaining then raise exception using errcode='22023',message='marketplace_ad_overspend';end if;
 escrow:=public.ensure_marketplace_ads_account('marketplace_ads_escrow');revenue:=public.ensure_marketplace_ads_account('marketplace_ads_revenue');
 perform 1 from public.ledger_accounts where id=any(array[escrow,revenue]) order by id for update;
 insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
 values(tx,escrow,revenue,'marketplace_ad_spend',amount,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,p_idempotency_key::text,c.seller_id);
 perform public.ledger_debit(tx,escrow,amount,'Marketplace ad spend',jsonb_build_object('campaign_id',c.id));perform public.ledger_credit(tx,revenue,amount,'Marketplace ads revenue',jsonb_build_object('campaign_id',c.id));
 insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)values(c.id,c.seller_id,'spend',amount,tx,p_idempotency_key);
 update public.marketplace_ad_campaigns set spent_bdag=spent_bdag+amount,status=case when remaining=amount then'exhausted'else'active'end,completed_at=case when remaining=amount then now() else completed_at end,updated_at=now() where id=c.id;
 return public.marketplace_ad_campaign_result(c.id);
end;$$;

create or replace function public.release_marketplace_ad_unused_budget(p_campaign_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketplace_ad_campaigns; amount numeric(20,8); escrow uuid;seller_account uuid;tx uuid:=gen_random_uuid();prior public.marketplace_ad_financial_events;
begin
 if auth.role()<>'service_role' then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required';end if;
 select * into c from public.marketplace_ad_campaigns where id=p_campaign_id for update;if not found then raise exception using errcode='P0002',message='marketplace_ad_campaign_not_found';end if;
 select * into prior from public.marketplace_ad_financial_events where event_type='release' and idempotency_key=p_idempotency_key;
 if found then if prior.campaign_id<>c.id then raise exception using errcode='23505',message='marketplace_ad_idempotency_conflict';end if;return public.marketplace_ad_campaign_result(c.id);end if;
 if c.funded_at is null or not(c.ends_at<=now() or c.status in('completed','exhausted','cancelled')) then raise exception using errcode='22023',message='marketplace_ad_not_releasable';end if;
 amount:=c.total_budget_bdag-c.spent_bdag-c.released_bdag;
 if amount=0 then update public.marketplace_ad_campaigns set status=case when spent_bdag=total_budget_bdag then'exhausted'else'completed'end,completed_at=coalesce(completed_at,now()),updated_at=now() where id=c.id;return public.marketplace_ad_campaign_result(c.id);end if;
 escrow:=public.ensure_marketplace_ads_account('marketplace_ads_escrow');seller_account:=public.ensure_ledger_account(c.seller_id);
 perform 1 from public.ledger_accounts where id=any(array[escrow,seller_account]) order by id for update;
 insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
 values(tx,escrow,seller_account,'marketplace_ad_release',amount,0,'BDAG','completed','marketplace_ad_campaign',c.id::text,p_idempotency_key::text,c.seller_id);
 perform public.ledger_debit(tx,escrow,amount,'Marketplace ad unused budget release',jsonb_build_object('campaign_id',c.id));perform public.ledger_credit(tx,seller_account,amount,'Marketplace ad budget returned',jsonb_build_object('campaign_id',c.id));
 insert into public.marketplace_ad_financial_events(campaign_id,seller_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)values(c.id,c.seller_id,'release',amount,tx,p_idempotency_key);
 update public.marketplace_ad_campaigns set released_bdag=released_bdag+amount,status=case when spent_bdag=total_budget_bdag then'exhausted'else'completed'end,completed_at=coalesce(completed_at,now()),updated_at=now() where id=c.id;
 return public.marketplace_ad_campaign_result(c.id);
end;$$;

create or replace function public.pause_marketplace_ad_campaign(p_campaign_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();c public.marketplace_ad_campaigns;begin update public.marketplace_ad_campaigns set status='paused',paused_at=now(),updated_at=now() where id=p_campaign_id and seller_id=actor and status in('active','scheduled') returning * into c;if not found then raise exception using errcode='42501',message='marketplace_ad_not_pauseable';end if;return public.marketplace_ad_campaign_result(c.id);end;$$;
create or replace function public.resume_marketplace_ad_campaign(p_campaign_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();c public.marketplace_ad_campaigns;begin select*into c from public.marketplace_ad_campaigns where id=p_campaign_id and seller_id=actor for update;if not found or c.status<>'paused'then raise exception using errcode='42501',message='marketplace_ad_not_resumable';end if;if now()>=c.ends_at or c.spent_bdag+c.released_bdag>=c.total_budget_bdag or not public.marketplace_ad_product_is_eligible(c.seller_id,c.product_id,c.store_id)then raise exception using errcode='22023',message='marketplace_ad_not_resumable';end if;update public.marketplace_ad_campaigns set status=case when starts_at>now()then'scheduled'else'active'end,paused_at=null,updated_at=now()where id=c.id;return public.marketplace_ad_campaign_result(c.id);end;$$;

create or replace function public.finalize_expired_marketplace_ad_campaigns(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=public as $$
declare c record;n integer:=0;k uuid;begin if auth.role()<>'service_role'then raise exception using errcode='42501',message='marketplace_ad_internal_only';end if;if p_limit not between 1 and 500 then raise exception using errcode='22023',message='marketplace_ad_limit_invalid';end if;
for c in select id from public.marketplace_ad_campaigns where funded_at is not null and ends_at<=now() and status in('scheduled','active','paused') order by ends_at,id for update skip locked limit p_limit loop k:=((substr(md5(c.id::text||':expiry-release'),1,8)||'-'||substr(md5(c.id::text||':expiry-release'),9,4)||'-'||substr(md5(c.id::text||':expiry-release'),13,4)||'-'||substr(md5(c.id::text||':expiry-release'),17,4)||'-'||substr(md5(c.id::text||':expiry-release'),21,12))::uuid);perform public.release_marketplace_ad_unused_budget(c.id,k);n:=n+1;end loop;return jsonb_build_object('finalized',n);end;$$;

create or replace function public.reconcile_marketplace_ad_finance() returns jsonb language sql stable security definer set search_path=public as $$
with e as(select event_type,coalesce(sum(amount_bdag),0) amount from public.marketplace_ad_financial_events group by event_type),
entry_check as(select f.operation_type,coalesce(sum(case when le.entry_type='debit'then le.amount else 0 end),0) debits,coalesce(sum(case when le.entry_type='credit'then le.amount else 0 end),0) credits from public.financial_transactions f left join public.ledger_entries le on le.txn_id=f.id where f.operation_type in('marketplace_ad_fund','marketplace_ad_spend','marketplace_ad_release')group by f.operation_type),
liability as(select coalesce(sum(total_budget_bdag-spent_bdag-released_bdag),0) amount from public.marketplace_ad_campaigns where funded_at is not null),escrow as(select coalesce(balance,0) amount from public.ledger_accounts where owner_id is null and account_type='marketplace_ads_escrow')
select jsonb_build_object('funding_reconciliation',coalesce((select debits-credits from entry_check where operation_type='marketplace_ad_fund'),0),'spend_reconciliation',coalesce((select debits-credits from entry_check where operation_type='marketplace_ad_spend'),0),'release_reconciliation',coalesce((select debits-credits from entry_check where operation_type='marketplace_ad_release'),0),'campaign_equation_mismatches',(select count(*)from public.marketplace_ad_campaigns where total_budget_bdag<>spent_bdag+released_bdag+(total_budget_bdag-spent_bdag-released_bdag)),'escrow_liability_difference',(select amount from escrow)-(select amount from liability));$$;

create or replace function public.marketplace_ad_financial_events_immutable()returns trigger language plpgsql set search_path=public as $$begin raise exception using errcode='55000',message='marketplace_ad_financial_event_immutable';end;$$;
create trigger marketplace_ad_financial_events_immutable before update or delete on public.marketplace_ad_financial_events for each row execute function public.marketplace_ad_financial_events_immutable();

alter table public.marketplace_ad_config enable row level security;alter table public.marketplace_ad_campaigns enable row level security;alter table public.marketplace_ad_financial_events enable row level security;
create policy marketplace_ad_campaigns_seller_read on public.marketplace_ad_campaigns for select to authenticated using(seller_id=auth.uid());
create policy marketplace_ad_events_seller_read on public.marketplace_ad_financial_events for select to authenticated using(seller_id=auth.uid());
revoke all on public.marketplace_ad_config,public.marketplace_ad_campaigns,public.marketplace_ad_financial_events from public,anon,authenticated;
grant select on public.marketplace_ad_campaigns,public.marketplace_ad_financial_events to authenticated;grant all on public.marketplace_ad_config,public.marketplace_ad_campaigns,public.marketplace_ad_financial_events to service_role;
revoke all on function public.ensure_marketplace_ads_account(text),public.marketplace_ad_product_is_eligible(uuid,uuid,uuid),public.marketplace_ad_campaign_result(uuid),public.spend_marketplace_ad_budget(uuid,numeric,uuid),public.release_marketplace_ad_unused_budget(uuid,uuid),public.finalize_expired_marketplace_ad_campaigns(integer),public.reconcile_marketplace_ad_finance() from public,anon,authenticated;
grant execute on function public.ensure_marketplace_ads_account(text),public.marketplace_ad_product_is_eligible(uuid,uuid,uuid),public.marketplace_ad_campaign_result(uuid),public.spend_marketplace_ad_budget(uuid,numeric,uuid),public.release_marketplace_ad_unused_budget(uuid,uuid),public.finalize_expired_marketplace_ad_campaigns(integer),public.reconcile_marketplace_ad_finance() to service_role;
revoke all on function public.create_marketplace_ad_campaign_draft(uuid,text,numeric,timestamptz,timestamptz,uuid),public.activate_marketplace_ad_campaign(uuid,uuid),public.pause_marketplace_ad_campaign(uuid),public.resume_marketplace_ad_campaign(uuid) from public,anon;
grant execute on function public.create_marketplace_ad_campaign_draft(uuid,text,numeric,timestamptz,timestamptz,uuid),public.activate_marketplace_ad_campaign(uuid,uuid),public.pause_marketplace_ad_campaign(uuid),public.resume_marketplace_ad_campaign(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
