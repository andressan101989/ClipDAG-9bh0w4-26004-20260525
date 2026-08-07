begin;

create table public.marketplace_dispute_review_actions(
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.marketplace_order_disputes(id),
  order_id uuid not null references public.marketplace_orders(id),
  actor_id uuid not null references auth.users(id),
  action text not null check(action in('manual_review_requested','escalated','note_added','review_assigned','review_reopened')),
  reason_code text not null check(reason_code=btrim(reason_code)and char_length(reason_code)between 2 and 100),
  note text check(note is null or(note=btrim(note)and char_length(note)between 1 and 1000)),
  idempotency_key uuid not null,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.marketplace_dispute_review_actions enable row level security;
revoke all on public.marketplace_dispute_review_actions from public,anon,authenticated;
grant all on public.marketplace_dispute_review_actions to service_role;

create or replace function public.marketplace_reject_dispute_review_action_mutation()
returns trigger language plpgsql set search_path=public as $$begin
 raise exception using errcode='42501',message='marketplace_dispute_review_action_immutable';
end$$;
create trigger marketplace_dispute_review_actions_immutable before update or delete
on public.marketplace_dispute_review_actions for each row execute function public.marketplace_reject_dispute_review_action_mutation();

-- Deployed data was audited before this migration. This deterministic conversion also protects
-- environments where an intermediate result was created between audit and deployment.
insert into public.marketplace_dispute_review_actions(id,dispute_id,order_id,actor_id,action,reason_code,note,idempotency_key,metadata,created_at)
select id,dispute_id,order_id,resolver_id,'manual_review_requested',reason_code,note,idempotency_key,
       jsonb_build_object('legacy_financial_result',financial_result,'legacy_decided_at',decided_at),created_at
from public.marketplace_dispute_decisions where outcome='manual_review'
on conflict(actor_id,idempotency_key)do nothing;
delete from public.marketplace_dispute_decisions where outcome='manual_review';
alter table public.marketplace_dispute_decisions drop constraint marketplace_dispute_decisions_outcome_check;
alter table public.marketplace_dispute_decisions add constraint marketplace_dispute_decisions_outcome_check
check(outcome in('refund_buyer','release_seller','reject_claim'));

create or replace function public.marketplace_dispute_resolution_receipt(p_decision_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'kind','final_resolution',
 'finalDecision',jsonb_build_object('id',d.id,'dispute_id',d.dispute_id,'order_id',d.order_id,
   'outcome',d.outcome,'reason_code',d.reason_code,'financial_result',d.financial_result,'decided_at',d.decided_at),
 'dispute',jsonb_build_object('status',x.status,'resolved_at',x.resolved_at),
 'order',jsonb_build_object('status',o.status),
 'payment',jsonb_build_object('status',p.status,'gross_amount',p.gross_amount),
 'allocation',jsonb_build_object('status',a.status,'gross_amount',a.gross_amount,'seller_net_amount',a.seller_net_amount,
   'creator_commission_amount',a.creator_commission_amount,'platform_fee_amount',a.platform_fee_amount))
from public.marketplace_dispute_decisions d join public.marketplace_order_disputes x on x.id=d.dispute_id
join public.marketplace_orders o on o.id=d.order_id join public.marketplace_payments p on p.checkout_id=o.checkout_id
join public.marketplace_payment_allocations a on a.order_id=o.id where d.id=p_decision_id$$;

create or replace function public.marketplace_dispute_review_receipt(p_action_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'kind','intermediate_review','finalDecision',null,
 'reviewAction',jsonb_build_object('id',a.id,'dispute_id',a.dispute_id,'order_id',a.order_id,'action',a.action,
   'reason_code',a.reason_code,'metadata',a.metadata,'created_at',a.created_at),
 'dispute',jsonb_build_object('status',d.status,'resolved_at',d.resolved_at),
 'moneyMoved',false,'requiresHumanFollowUp',true)
from public.marketplace_dispute_review_actions a join public.marketplace_order_disputes d on d.id=a.dispute_id
where a.id=p_action_id$$;

create or replace function public.release_marketplace_order_after_dispute_resolution(
 p_resolver_id uuid,p_order_id uuid,p_dispute_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;
 a public.marketplace_payment_allocations;s public.marketplace_order_settlements;v_settlement uuid:=gen_random_uuid();
 v_escrow uuid;v_seller_account uuid;v_creator_account uuid;v_platform_account uuid;
 v_seller_tx uuid;v_creator_tx uuid;v_platform_tx uuid;v_now timestamptz:=now();v_balance numeric;v_fingerprint text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role'then raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';end if;
 if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true)then raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';end if;
 if p_order_id is null or p_dispute_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_dispute_resolution_invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('marketplace-order-settlement:'||p_order_id::text,0));
 select*into d from public.marketplace_order_disputes where id=p_dispute_id for update;
 select*into o from public.marketplace_orders where id=p_order_id for update;
 if d.id is null or o.id is null or d.order_id<>o.id then raise exception using errcode='P0002',message='marketplace_dispute_not_found';end if;
 if d.status not in('open','under_review')then raise exception using errcode='22023',message='marketplace_dispute_not_open';end if;
 if exists(select 1 from public.marketplace_dispute_decisions where dispute_id=d.id)then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;
 select*into s from public.marketplace_order_settlements where order_id=o.id;
 if found then return jsonb_build_object('settlement',jsonb_build_object('id',s.id,'status',s.status,'released_at',s.released_at),'money_moved',false,'already_released',true);end if;
 select*into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
 select*into a from public.marketplace_payment_allocations where order_id=o.id for update;
 if p.id is null or p.status<>'paid'then raise exception using errcode='22023',message='marketplace_refund_payment_not_paid';end if;
 if o.status not in('shipped','delivered')then raise exception using errcode='22023',message='marketplace_refund_order_state_invalid';end if;
 if a.id is null or a.status<>'held'then raise exception using errcode='22023',message='marketplace_refund_allocation_not_held';end if;
 if a.payment_id<>p.id or a.checkout_id<>o.checkout_id or a.gross_amount<>o.total or
    a.gross_amount<>a.seller_net_amount+a.creator_commission_amount+a.platform_fee_amount then
   raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
 v_fingerprint:=encode(extensions.digest('marketplace_dispute_support_release:'||d.id::text,'sha256'),'hex');
 v_escrow:=public.ensure_marketplace_escrow_account();v_seller_account:=public.ensure_ledger_account(o.seller_id);
 v_platform_account:=public.ensure_marketplace_platform_account();if a.creator_commission_amount>0 then v_creator_account:=public.ensure_ledger_account(a.creator_user_id);end if;
 perform 1 from public.ledger_accounts where id=any(array_remove(array[v_escrow,v_seller_account,v_creator_account,v_platform_account],null))order by id for update;
 select balance into v_balance from public.ledger_accounts where id=v_escrow and currency='BDAG'and not frozen;
 if v_balance is null or v_balance<a.gross_amount then raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
 insert into public.marketplace_order_settlements(id,payment_id,allocation_id,checkout_id,order_id,buyer_id,seller_id,store_id,gross_amount,seller_net_amount,creator_user_id,creator_commission_amount,platform_fee_amount,confirmed_by,idempotency_key,request_fingerprint,confirmed_at,released_at)
 values(v_settlement,p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id,a.gross_amount,a.seller_net_amount,a.creator_user_id,a.creator_commission_amount,a.platform_fee_amount,p_resolver_id,p_idempotency_key,v_fingerprint,v_now,v_now);
 if a.seller_net_amount>0 then v_seller_tx:=gen_random_uuid();insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(v_seller_tx,v_escrow,v_seller_account,'marketplace_seller_settlement',a.seller_net_amount,0,'BDAG','completed','marketplace_order',o.id::text,v_settlement::text||':seller',p_resolver_id);perform public.ledger_debit(v_seller_tx,v_escrow,a.seller_net_amount,'Marketplace seller settlement',jsonb_build_object('fin_txn_id',v_seller_tx,'order_id',o.id));perform public.ledger_credit(v_seller_tx,v_seller_account,a.seller_net_amount,'Marketplace seller settlement',jsonb_build_object('fin_txn_id',v_seller_tx,'order_id',o.id));end if;
 insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,beneficiary_user_id,destination_account_id,amount,financial_transaction_id)values(v_settlement,'seller_net','seller_net',o.seller_id,v_seller_account,a.seller_net_amount,v_seller_tx);
 if a.creator_commission_amount>0 then v_creator_tx:=gen_random_uuid();insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(v_creator_tx,v_escrow,v_creator_account,'marketplace_creator_commission_settlement',a.creator_commission_amount,0,'BDAG','completed','marketplace_order',o.id::text,v_settlement::text||':creator',p_resolver_id);perform public.ledger_debit(v_creator_tx,v_escrow,a.creator_commission_amount,'Marketplace creator commission settlement',jsonb_build_object('fin_txn_id',v_creator_tx,'order_id',o.id));perform public.ledger_credit(v_creator_tx,v_creator_account,a.creator_commission_amount,'Marketplace creator commission settlement',jsonb_build_object('fin_txn_id',v_creator_tx,'order_id',o.id));insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,beneficiary_user_id,destination_account_id,amount,financial_transaction_id)values(v_settlement,'creator_commission','creator_commission',a.creator_user_id,v_creator_account,a.creator_commission_amount,v_creator_tx);end if;
 if a.platform_fee_amount>0 then v_platform_tx:=gen_random_uuid();insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(v_platform_tx,v_escrow,v_platform_account,'marketplace_platform_fee_settlement',a.platform_fee_amount,0,'BDAG','completed','marketplace_order',o.id::text,v_settlement::text||':platform',p_resolver_id);perform public.ledger_debit(v_platform_tx,v_escrow,a.platform_fee_amount,'Marketplace platform fee settlement',jsonb_build_object('fin_txn_id',v_platform_tx,'order_id',o.id));perform public.ledger_credit(v_platform_tx,v_platform_account,a.platform_fee_amount,'Marketplace platform fee settlement',jsonb_build_object('fin_txn_id',v_platform_tx,'order_id',o.id));end if;
 insert into public.marketplace_settlement_legs(settlement_id,leg_key,leg_type,beneficiary_user_id,destination_account_id,amount,financial_transaction_id)values(v_settlement,'platform_fee','platform_fee',null,v_platform_account,a.platform_fee_amount,v_platform_tx);
 perform set_config('app.marketplace_settlement','on',true);update public.marketplace_payment_allocations set status='released',released_at=v_now where id=a.id and status='held';
 return jsonb_build_object('settlement',jsonb_build_object('id',v_settlement,'status','released','released_at',v_now),'allocation',jsonb_build_object('status','released','gross_amount',a.gross_amount),'money_moved',true,'actor_role','admin');
end$$;

create or replace function public.resolve_marketplace_dispute(
 p_resolver_id uuid,p_dispute_id uuid,p_outcome text,p_reason_code text,p_note text,p_idempotency_key uuid,p_partial_amount numeric default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
 prior public.marketplace_dispute_decisions;review public.marketplace_dispute_review_actions;decision_id uuid:=gen_random_uuid();action_id uuid:=gen_random_uuid();tx uuid;escrow uuid;buyer_account uuid;
 escrow_balance numeric;allocation_count integer;now_at timestamptz:=now();result jsonb:='{}'::jsonb;settlement jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role'then raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';end if;
 if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true)then raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';end if;
 if p_partial_amount is not null then raise exception using errcode='22023',message='marketplace_partial_refund_unsupported';end if;
 if p_dispute_id is null or p_idempotency_key is null or p_outcome not in('refund_buyer','release_seller','reject_claim','manual_review')or char_length(btrim(coalesce(p_reason_code,'')))not between 2 and 100 or(p_note is not null and char_length(btrim(p_note))not between 1 and 1000)then raise exception using errcode='22023',message='marketplace_dispute_resolution_invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
 select*into d from public.marketplace_order_disputes where id=p_dispute_id for update;if not found then raise exception using errcode='P0002',message='marketplace_dispute_not_found';end if;
 select*into review from public.marketplace_dispute_review_actions where actor_id=p_resolver_id and idempotency_key=p_idempotency_key;
 if found then if(review.dispute_id,review.reason_code,coalesce(review.note,''))is distinct from(p_dispute_id,btrim(p_reason_code),coalesce(nullif(btrim(p_note),''),''))or p_outcome<>'manual_review'then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;return public.marketplace_dispute_review_receipt(review.id);end if;
 select*into prior from public.marketplace_dispute_decisions where resolver_id=p_resolver_id and idempotency_key=p_idempotency_key;
 if found then if(prior.dispute_id,prior.outcome,prior.reason_code,coalesce(prior.note,''))is distinct from(p_dispute_id,p_outcome,btrim(p_reason_code),coalesce(nullif(btrim(p_note),''),''))then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;return public.marketplace_dispute_resolution_receipt(prior.id);end if;
 select*into prior from public.marketplace_dispute_decisions where dispute_id=p_dispute_id;if found then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;
 if d.status not in('open','under_review')then raise exception using errcode='22023',message='marketplace_dispute_not_open';end if;
 select*into o from public.marketplace_orders where id=d.order_id for update;select*into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
 perform 1 from public.marketplace_payment_allocations where payment_id=p.id order by id for update;select count(*)into allocation_count from public.marketplace_payment_allocations where payment_id=p.id;select*into a from public.marketplace_payment_allocations where order_id=o.id;
 if p_outcome='manual_review'or(p_outcome='refund_buyer'and(allocation_count<>1 or a.status<>'held'))then
   insert into public.marketplace_dispute_review_actions(id,dispute_id,order_id,actor_id,action,reason_code,note,idempotency_key,metadata)
   values(action_id,d.id,o.id,p_resolver_id,'manual_review_requested',btrim(p_reason_code),nullif(btrim(p_note),''),p_idempotency_key,
     case when p_outcome='refund_buyer'then jsonb_build_object('code','marketplace_refund_requires_manual_review','requested_outcome','refund_buyer')else'{}'::jsonb end);
   update public.marketplace_order_disputes set status='under_review',resolved_at=null where id=d.id;
   return public.marketplace_dispute_review_receipt(action_id);
 end if;
 if p.id is null or p.status<>'paid'then raise exception using errcode='22023',message=case when p.status='refunded'then'marketplace_refund_already_completed'else'marketplace_refund_payment_not_paid'end;end if;
 if p_outcome='refund_buyer'then
   if o.status not in('confirmed','processing','shipped','delivered')or a.gross_amount<>p.gross_amount or a.gross_amount<>o.total or o.total<>round(o.subtotal+o.shipping_amount,8)or a.gross_amount<>a.seller_net_amount+a.creator_commission_amount+a.platform_fee_amount then raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
   escrow:=public.ensure_marketplace_escrow_account();buyer_account:=public.ensure_ledger_account(o.buyer_id);perform 1 from public.ledger_accounts where id=any(array[escrow,buyer_account])order by id for update;select balance into escrow_balance from public.ledger_accounts where id=escrow and currency='BDAG'and not frozen;if escrow_balance is null or escrow_balance<a.gross_amount then raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
   tx:=gen_random_uuid();insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(tx,escrow,buyer_account,'marketplace_dispute_refund',a.gross_amount,0,'BDAG','completed','marketplace_order',o.id::text,'marketplace-dispute-refund:'||d.id,p_resolver_id);perform public.ledger_debit(tx,escrow,a.gross_amount,'Marketplace held dispute refund',jsonb_build_object('fin_txn_id',tx,'order_id',o.id,'dispute_id',d.id));perform public.ledger_credit(tx,buyer_account,a.gross_amount,'Marketplace held dispute refund',jsonb_build_object('fin_txn_id',tx,'order_id',o.id,'dispute_id',d.id));perform set_config('app.marketplace_dispute_refund','on',true);update public.marketplace_payment_allocations set status='refunded',refunded_at=now_at where id=a.id;update public.marketplace_payments set status='refunded',refunded_at=now_at,updated_at=now_at where id=p.id;update public.marketplace_orders set status='refunded',fulfillment_updated_at=now_at,fulfillment_version=fulfillment_version+1 where id=o.id;result:=jsonb_build_object('money_moved',true,'refund_amount',a.gross_amount,'financial_transaction_id',tx,'seller_allocation','refunded','creator_allocation','refunded','platform_allocation','refunded');
 elsif p_outcome='release_seller'then settlement:=public.release_marketplace_order_after_dispute_resolution(p_resolver_id,o.id,d.id,p_idempotency_key);result:=jsonb_build_object('money_moved',true,'settlement',settlement);
 else result:=jsonb_build_object('money_moved',false,'settlement_eligible',true);end if;
 update public.marketplace_order_disputes set status=case when p_outcome='reject_claim'then'rejected'else'resolved'end,resolved_at=now_at where id=d.id;
 insert into public.marketplace_dispute_decisions(id,dispute_id,order_id,resolver_id,outcome,reason_code,note,idempotency_key,financial_result,decided_at)values(decision_id,d.id,o.id,p_resolver_id,p_outcome,btrim(p_reason_code),nullif(btrim(p_note),''),p_idempotency_key,result,now_at);
 insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,reason_code,idempotency_key,metadata,created_at)values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,case when p_outcome='refund_buyer'then'refund_created'else'dispute_resolved'end,o.status,case when p_outcome='refund_buyer'then'refunded'else o.status end,p_resolver_id,'admin',case when p_outcome='release_seller'then'dispute_release_seller'else btrim(p_reason_code)end,p_idempotency_key,jsonb_build_object('dispute_id',d.id,'decision_id',decision_id,'outcome',p_outcome,'settlement',settlement),now_at);
 return public.marketplace_dispute_resolution_receipt(decision_id);
end$$;

revoke all on function public.marketplace_reject_dispute_review_action_mutation(),public.marketplace_dispute_review_receipt(uuid),public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid),public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)from public,anon,authenticated;
grant execute on function public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)to service_role;
comment on table public.marketplace_dispute_review_actions is 'Immutable append-only operational history. Intermediate review does not consume the final dispute decision.';
comment on function public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid)is 'Internal support-authorized release using frozen held allocations without buyer receipt semantics.';

commit;
