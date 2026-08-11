create table public.marketplace_settlement_reversals(
  id uuid primary key,
  settlement_id uuid not null references public.marketplace_order_settlements(id),
  payment_id uuid not null references public.marketplace_payments(id),
  allocation_id uuid not null references public.marketplace_payment_allocations(id),
  checkout_id uuid not null references public.marketplace_checkout_sessions(id),
  order_id uuid not null references public.marketplace_orders(id),
  dispute_id uuid not null references public.marketplace_order_disputes(id),
  buyer_id uuid not null references auth.users(id),
  resolver_id uuid not null references auth.users(id),
  gross_amount numeric(20,8) not null,
  currency text not null,
  reason_code text not null,
  buyer_refund_transaction_id uuid not null,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint marketplace_settlement_reversals_amount_check
    check(gross_amount>0 and gross_amount=round(gross_amount,8)),
  constraint marketplace_settlement_reversals_currency_check check(currency='BDAG'),
  constraint marketplace_settlement_reversals_reason_check
    check(reason_code=btrim(reason_code) and char_length(reason_code) between 2 and 100),
  constraint marketplace_settlement_reversals_fingerprint_check
    check(char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'),
  constraint marketplace_settlement_reversals_settlement_key unique(settlement_id),
  constraint marketplace_settlement_reversals_order_key unique(order_id),
  constraint marketplace_settlement_reversals_dispute_key unique(dispute_id),
  constraint marketplace_settlement_reversals_resolver_idempotency_key unique(resolver_id,idempotency_key),
  constraint marketplace_settlement_reversals_buyer_refund_key unique(buyer_refund_transaction_id),
  constraint marketplace_settlement_reversals_buyer_refund_fkey
    foreign key(buyer_refund_transaction_id) references public.financial_transactions(id)
    deferrable initially deferred
);

create table public.marketplace_settlement_reversal_legs(
  id uuid primary key,
  reversal_id uuid not null references public.marketplace_settlement_reversals(id),
  settlement_id uuid not null references public.marketplace_order_settlements(id),
  original_settlement_leg_id uuid not null references public.marketplace_settlement_legs(id),
  leg_type text not null,
  beneficiary_user_id uuid references auth.users(id),
  source_account_id uuid not null references public.ledger_accounts(id),
  destination_account_id uuid not null references public.ledger_accounts(id),
  original_amount numeric(20,8) not null,
  reversal_amount numeric(20,8) not null,
  original_financial_transaction_id uuid not null references public.financial_transactions(id),
  reversal_financial_transaction_id uuid not null references public.financial_transactions(id),
  created_at timestamptz not null default now(),
  constraint marketplace_settlement_reversal_legs_type_check
    check(leg_type in('seller_net','platform_fee','creator_commission')),
  constraint marketplace_settlement_reversal_legs_amount_check
    check(original_amount>0 and original_amount=round(original_amount,8)
      and reversal_amount>0 and reversal_amount=round(reversal_amount,8)
      and reversal_amount<=original_amount),
  constraint marketplace_settlement_reversal_legs_accounts_check
    check(source_account_id<>destination_account_id),
  constraint marketplace_settlement_reversal_legs_original_key unique(original_settlement_leg_id),
  constraint marketplace_settlement_reversal_legs_transaction_key unique(reversal_financial_transaction_id)
);

create index marketplace_settlement_reversals_payment_idx
  on public.marketplace_settlement_reversals(payment_id);
create index marketplace_settlement_reversal_legs_reversal_idx
  on public.marketplace_settlement_reversal_legs(reversal_id);
create index marketplace_settlement_reversal_legs_settlement_idx
  on public.marketplace_settlement_reversal_legs(settlement_id);

alter table public.marketplace_settlement_reversals enable row level security;
alter table public.marketplace_settlement_reversal_legs enable row level security;

create or replace function public.marketplace_reject_settlement_reversal_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='marketplace_settlement_reversal_immutable';
end$$;

create trigger marketplace_settlement_reversals_immutable
before update or delete on public.marketplace_settlement_reversals
for each row execute function public.marketplace_reject_settlement_reversal_mutation();
create trigger marketplace_settlement_reversal_legs_immutable
before update or delete on public.marketplace_settlement_reversal_legs
for each row execute function public.marketplace_reject_settlement_reversal_mutation();

-- Preserve every deployed allocation guard branch and extend it with the one
-- refund transition required for an already released allocation.  Replacing
-- the trigger or duplicating its evolving historical body would be less safe.
do $$
declare v_body text;v_extended text;
begin
  select p.prosrc into strict v_body
  from pg_proc p
  where p.oid='public.marketplace_allocation_release_guard()'::regprocedure;
  if position('marketplace_b7r_released_refund_guard' in v_body)=0 then
    v_extended:=regexp_replace(v_body,'^[[:space:]]*begin',E'begin\n  -- marketplace_b7r_released_refund_guard\n  if tg_op=''UPDATE''\n    and current_setting(''app.marketplace_dispute_refund'',true)=''on''\n    and old.status=''released'' and new.status=''refunded''\n    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,\n        old.currency,old.gross_amount,old.platform_fee_amount,old.seller_net_amount,\n        old.fee_bps,old.creator_user_id,old.creator_commission_amount)\n       is not distinct from\n       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,\n        new.currency,new.gross_amount,new.platform_fee_amount,new.seller_net_amount,\n        new.fee_bps,new.creator_user_id,new.creator_commission_amount)\n    and old.released_at is not null and new.released_at is not distinct from old.released_at\n    and old.refunded_at is null and new.refunded_at is not null then return new;\n  end if;','');
    if v_extended=v_body then
      raise exception using errcode='P0001',message='marketplace_b7r_allocation_guard_extension_failed';
    end if;
    execute 'create or replace function public.marketplace_allocation_release_guard() returns trigger language plpgsql set search_path=public as '
      ||quote_literal(v_extended);
  end if;
  if position('marketplace_b7r_released_refund_guard' in
    pg_get_functiondef('public.marketplace_allocation_release_guard()'::regprocedure))=0 then
    raise exception using errcode='P0001',message='marketplace_b7r_allocation_guard_extension_failed';
  end if;
end$$;

create or replace function public.marketplace_post_settlement_review_receipt(p_action_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'kind','post_settlement_review',
  'review_id',a.id,
  'dispute_id',d.id,
  'order_id',o.id,
  'settlement_id',s.id,
  'payment_id',s.payment_id,
  'allocation_id',s.allocation_id,
  'status',d.status,
  'reason_code',a.reason_code,
  'money_moved',false,
  'requiresHumanFollowUp',true,
  'created_at',a.created_at)
from public.marketplace_dispute_review_actions a
join public.marketplace_order_disputes d on d.id=a.dispute_id
join public.marketplace_orders o on o.id=d.order_id
join public.marketplace_order_settlements s on s.order_id=o.id
where a.id=p_action_id
$$;

create or replace function public.open_marketplace_post_settlement_review(
  p_resolver_id uuid,p_order_id uuid,p_reason_code text,p_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;d public.marketplace_order_disputes;
  prior public.marketplace_dispute_review_actions;
  v_action_id uuid:=gen_random_uuid();v_dispute_id uuid:=gen_random_uuid();
  v_reason text:=lower(btrim(coalesce(p_reason_code,'')));v_note text:=nullif(btrim(p_note),'');
  v_fingerprint text;v_dispute_key uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_post_settlement_review_service_role_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_post_settlement_review_resolver_forbidden';
  end if;
  if p_order_id is null or p_idempotency_key is null or char_length(v_reason) not between 2 and 100
    or(p_note is not null and char_length(v_note) not between 1 and 1000) then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|','open_marketplace_post_settlement_review',
    p_resolver_id,p_order_id,v_reason,coalesce(v_note,'')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_resolver_id::text||':marketplace-post-settlement-review:'||p_idempotency_key::text,0));
  select * into prior from public.marketplace_dispute_review_actions
  where actor_id=p_resolver_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.order_id<>p_order_id or prior.reason_code<>v_reason
      or coalesce(prior.note,'')<>coalesce(v_note,'')
      or prior.metadata->>'review_type'<>'post_settlement'
      or prior.metadata->>'request_fingerprint'<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_post_settlement_review_idempotency_conflict';
    end if;
    return public.marketplace_post_settlement_review_receipt(prior.id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-post-settlement-review-order:'||p_order_id::text,0));
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
  select * into s from public.marketplace_order_settlements where order_id=o.id for update;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if s.id is null or s.status<>'completed' or s.released_at is null then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_requires_released_settlement';
  end if;
  if p.id is null or p.id<>s.payment_id or p.status<>'paid'
    or a.id is null or a.id<>s.allocation_id or a.status<>'released'
    or o.status in('refunded','partially_refunded') then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_financial_state_invalid';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals r
    where r.settlement_id=s.id or r.order_id=o.id) then
    raise exception using errcode='22023',message='marketplace_post_settlement_review_already_reversed';
  end if;
  if exists(select 1 from public.marketplace_order_disputes x
    where x.order_id=o.id and x.status in('open','under_review')) then
    raise exception using errcode='23505',message='marketplace_post_settlement_review_already_open';
  end if;
  v_dispute_key:=md5(p_resolver_id::text||':'||p_idempotency_key::text)::uuid;
  insert into public.marketplace_order_disputes(
    id,order_id,checkout_id,buyer_id,seller_id,status,reason_code,buyer_note,idempotency_key)
  values(v_dispute_id,o.id,o.checkout_id,o.buyer_id,o.seller_id,'under_review',
    case when v_reason in('not_received','damaged','incorrect_item','missing_items','other')then v_reason else'other'end,
    null,v_dispute_key) returning * into d;
  insert into public.marketplace_dispute_review_actions(
    id,dispute_id,order_id,actor_id,action,reason_code,note,idempotency_key,metadata)
  values(v_action_id,d.id,o.id,p_resolver_id,'review_reopened',v_reason,v_note,p_idempotency_key,
    jsonb_build_object('review_type','post_settlement','request_fingerprint',v_fingerprint,
      'settlement_id',s.id,'payment_id',p.id,'allocation_id',a.id));
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata)
  values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'dispute_opened',o.status,o.status,
    p_resolver_id,'admin',v_reason,p_idempotency_key,
    jsonb_build_object('dispute_id',d.id,'review_id',v_action_id,'review_type','post_settlement','settlement_id',s.id));
  return public.marketplace_post_settlement_review_receipt(v_action_id);
end$$;

alter function public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)
rename to resolve_marketplace_dispute_held_v1;

create or replace function public.reverse_marketplace_released_settlement(
  p_resolver_id uuid,p_dispute_id uuid,p_reason_code text,p_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;
  a public.marketplace_payment_allocations;s public.marketplace_order_settlements;
  prior public.marketplace_settlement_reversals;original_leg record;account_need record;
  v_reversal_id uuid:=gen_random_uuid();v_refund_tx uuid:=gen_random_uuid();v_decision_id uuid:=gen_random_uuid();
  v_leg_tx uuid;v_leg_snapshot uuid;v_escrow uuid;v_buyer_account uuid;
  v_reason text:=lower(btrim(coalesce(p_reason_code,'')));v_note text:=nullif(btrim(p_note),'');
  v_fingerprint text;v_leg_count integer;v_leg_total numeric(20,8);v_balance numeric(20,8);
  v_seller_total numeric(20,8);v_platform_total numeric(20,8);v_creator_total numeric(20,8);
  v_rows integer;v_result jsonb;v_operation text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_reversal_service_role_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_reversal_resolver_forbidden';
  end if;
  if p_dispute_id is null or p_idempotency_key is null or char_length(v_reason) not between 2 and 100
    or(p_note is not null and char_length(v_note) not between 1 and 1000) then
    raise exception using errcode='22023',message='marketplace_reversal_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
  select * into d from public.marketplace_order_disputes where id=p_dispute_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_dispute_not_found';end if;
  select * into o from public.marketplace_orders where id=d.order_id for update;
  select * into s from public.marketplace_order_settlements where order_id=o.id;
  if s.id is null then
    raise exception using errcode='22023',message='marketplace_reversal_requires_released_settlement';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-released-settlement-reversal:'||s.id::text,0));
  select * into s from public.marketplace_order_settlements where id=s.id for update;
  select * into p from public.marketplace_payments where id=s.payment_id for update;
  select * into a from public.marketplace_payment_allocations where id=s.allocation_id for update;
  v_fingerprint:=encode(extensions.digest(concat_ws('|','marketplace_released_settlement_full_refund',
    p_resolver_id,d.id,s.id,v_reason,'full_refund'),'sha256'),'hex');
  select * into prior from public.marketplace_settlement_reversals r
  where r.settlement_id=s.id or r.order_id=o.id or r.dispute_id=d.id
    or(r.resolver_id=p_resolver_id and r.idempotency_key=p_idempotency_key)
  order by(r.resolver_id=p_resolver_id and r.idempotency_key=p_idempotency_key)desc limit 1;
  if found then
    if prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_reversal_idempotency_conflict';
    end if;
    select public.marketplace_dispute_resolution_receipt(x.id) into v_result
    from public.marketplace_dispute_decisions x where x.dispute_id=prior.dispute_id;
    if v_result is null then
      raise exception using errcode='23514',message='marketplace_reversal_integrity_error';
    end if;
    return v_result;
  end if;
  if exists(select 1 from public.marketplace_dispute_decisions x
    where x.dispute_id=d.id or(x.resolver_id=p_resolver_id and x.idempotency_key=p_idempotency_key)) then
    raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';
  end if;
  if d.status not in('open','under_review') or not exists(
    select 1 from public.marketplace_dispute_review_actions x
    where x.dispute_id=d.id and x.metadata->>'review_type'='post_settlement') then
    raise exception using errcode='22023',message='marketplace_reversal_requires_post_settlement_review';
  end if;
  if s.status<>'completed' or s.released_at is null
    or p.id is null or p.status<>'paid' or p.currency<>'BDAG'
    or a.id is null or a.status<>'released' or a.currency<>'BDAG'
    or o.status in('refunded','partially_refunded') or o.currency<>'BDAG'
    or(s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id)
      is distinct from(p.id,a.id,o.checkout_id,o.id,o.buyer_id)
    or(a.payment_id,a.checkout_id,a.order_id) is distinct from(p.id,o.checkout_id,o.id)
    or s.currency<>'BDAG' or s.gross_amount<>p.gross_amount or s.gross_amount<>a.gross_amount
    or s.gross_amount<>o.total or o.total<>round(o.subtotal+o.shipping_amount,8) then
    raise exception using errcode='23514',message='marketplace_reversal_settlement_basis_invalid';
  end if;
  if exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=s.id
    and(l.leg_type not in('seller_net','platform_fee','creator_commission') or l.status<>'completed' or l.amount<0)) then
    raise exception using errcode='23514',message='marketplace_reversal_settlement_basis_invalid';
  end if;
  select count(*)::int,coalesce(sum(l.amount),0),
    coalesce(sum(l.amount)filter(where l.leg_type='seller_net'),0),
    coalesce(sum(l.amount)filter(where l.leg_type='platform_fee'),0),
    coalesce(sum(l.amount)filter(where l.leg_type='creator_commission'),0)
  into v_leg_count,v_leg_total,v_seller_total,v_platform_total,v_creator_total
  from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.amount>0;
  if v_leg_count=0 or v_leg_total<>s.gross_amount
    or v_seller_total<>s.seller_net_amount or v_platform_total<>s.platform_fee_amount
    or v_creator_total<>s.creator_commission_amount then
    raise exception using errcode='23514',message='marketplace_reversal_settlement_basis_invalid';
  end if;
  if exists(
    select 1 from public.marketplace_settlement_legs l
    left join public.financial_transactions f on f.id=l.financial_transaction_id
    where l.settlement_id=s.id and l.amount>0 and(
      f.id is null or f.status<>'completed' or f.amount<>l.amount or f.currency<>'BDAG'
      or f.to_account_id<>l.destination_account_id)) then
    raise exception using errcode='23514',message='marketplace_reversal_settlement_basis_invalid';
  end if;
  v_escrow:=public.ensure_marketplace_escrow_account();
  v_buyer_account:=public.ensure_ledger_account(o.buyer_id);
  perform la.id from public.ledger_accounts la
  where la.id in(
    select l.destination_account_id from public.marketplace_settlement_legs l
      where l.settlement_id=s.id and l.amount>0
    union select v_escrow union select v_buyer_account)
  order by la.id for update;
  if exists(select 1 from public.ledger_accounts la
    where la.id in(v_escrow,v_buyer_account) and(la.currency<>'BDAG' or la.frozen)) then
    raise exception using errcode='23514',message='marketplace_reversal_account_integrity_error';
  end if;
  for account_need in
    select l.destination_account_id,sum(l.amount) required_debit
    from public.marketplace_settlement_legs l
    where l.settlement_id=s.id and l.amount>0 group by l.destination_account_id
  loop
    select la.balance into v_balance from public.ledger_accounts la
    where la.id=account_need.destination_account_id and la.currency='BDAG' and not la.frozen;
    if v_balance is null or v_balance<account_need.required_debit then
      return jsonb_build_object('kind','manual_review','money_moved',false,
        'reason','insufficient_beneficiary_balance','dispute_id',d.id,'settlement_id',s.id,
        'request_fingerprint',v_fingerprint);
    end if;
  end loop;
  insert into public.marketplace_settlement_reversals(
    id,settlement_id,payment_id,allocation_id,checkout_id,order_id,dispute_id,buyer_id,resolver_id,
    gross_amount,currency,reason_code,buyer_refund_transaction_id,idempotency_key,request_fingerprint)
  values(v_reversal_id,s.id,p.id,a.id,o.checkout_id,o.id,d.id,o.buyer_id,p_resolver_id,
    s.gross_amount,'BDAG',v_reason,v_refund_tx,p_idempotency_key,v_fingerprint);
  for original_leg in
    select l.* from public.marketplace_settlement_legs l
    where l.settlement_id=s.id and l.amount>0 order by l.destination_account_id,l.id
  loop
    v_leg_tx:=gen_random_uuid();v_leg_snapshot:=gen_random_uuid();
    v_operation:=case original_leg.leg_type
      when'seller_net'then'marketplace_seller_settlement_reversal'
      when'platform_fee'then'marketplace_platform_fee_reversal'
      when'creator_commission'then'marketplace_creator_commission_reversal'end;
    if v_operation is null then
      raise exception using errcode='23514',message='marketplace_reversal_settlement_basis_invalid';
    end if;
    insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,idempotency_key,initiated_by)
    values(v_leg_tx,original_leg.destination_account_id,v_escrow,v_operation,original_leg.amount,0,
      'BDAG','completed','marketplace_settlement_reversal',v_reversal_id::text,
      v_reversal_id::text||':'||original_leg.id::text,p_resolver_id);
    perform public.ledger_debit(v_leg_tx,original_leg.destination_account_id,original_leg.amount,
      'Marketplace settlement reversal',jsonb_build_object('reversal_id',v_reversal_id,'original_leg_id',original_leg.id));
    perform public.ledger_credit(v_leg_tx,v_escrow,original_leg.amount,
      'Marketplace settlement reversal',jsonb_build_object('reversal_id',v_reversal_id,'original_leg_id',original_leg.id));
    insert into public.marketplace_settlement_reversal_legs(
      id,reversal_id,settlement_id,original_settlement_leg_id,leg_type,beneficiary_user_id,
      source_account_id,destination_account_id,original_amount,reversal_amount,
      original_financial_transaction_id,reversal_financial_transaction_id)
    values(v_leg_snapshot,v_reversal_id,s.id,original_leg.id,original_leg.leg_type,
      original_leg.beneficiary_user_id,original_leg.destination_account_id,v_escrow,
      original_leg.amount,original_leg.amount,original_leg.financial_transaction_id,v_leg_tx);
  end loop;
  insert into public.financial_transactions(
    id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
    reference_type,reference_id,idempotency_key,initiated_by)
  values(v_refund_tx,v_escrow,v_buyer_account,'marketplace_post_settlement_refund',s.gross_amount,0,
    'BDAG','completed','marketplace_settlement_reversal',v_reversal_id::text,
    v_reversal_id::text||':buyer-refund',p_resolver_id);
  perform public.ledger_debit(v_refund_tx,v_escrow,s.gross_amount,'Marketplace post-settlement refund',
    jsonb_build_object('reversal_id',v_reversal_id,'dispute_id',d.id));
  perform public.ledger_credit(v_refund_tx,v_buyer_account,s.gross_amount,'Marketplace post-settlement refund',
    jsonb_build_object('reversal_id',v_reversal_id,'dispute_id',d.id));
  perform set_config('app.marketplace_dispute_refund','on',true);
  update public.marketplace_payment_allocations set status='refunded',refunded_at=now()
    where id=a.id and status='released';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_reversal_state_transition_failed';end if;
  update public.marketplace_payments set status='refunded',refunded_at=now(),updated_at=now()
    where id=p.id and status='paid';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_reversal_state_transition_failed';end if;
  update public.marketplace_orders set status='refunded',fulfillment_updated_at=now(),
    fulfillment_version=fulfillment_version+1 where id=o.id and status not in('refunded','partially_refunded');
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_reversal_state_transition_failed';end if;
  update public.marketplace_order_disputes set status='resolved',resolved_at=now()
    where id=d.id and status in('open','under_review');get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_reversal_state_transition_failed';end if;
  insert into public.marketplace_dispute_decisions(
    id,dispute_id,order_id,resolver_id,outcome,reason_code,note,idempotency_key,financial_result,decided_at)
  values(v_decision_id,d.id,o.id,p_resolver_id,'refund_buyer',v_reason,v_note,p_idempotency_key,
    jsonb_build_object('reversal_id',v_reversal_id,'buyer_refund_transaction_id',v_refund_tx,
      'gross_refund_amount',s.gross_amount,'money_moved',true),now());
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata)
  values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'refund_created',o.status,'refunded',
    p_resolver_id,'admin',v_reason,p_idempotency_key,
    jsonb_build_object('dispute_id',d.id,'decision_id',v_decision_id,'reversal_id',v_reversal_id,
      'buyer_refund_transaction_id',v_refund_tx,'gross_refund_amount',s.gross_amount));
  return public.marketplace_dispute_resolution_receipt(v_decision_id);
end$$;

create or replace function public.resolve_marketplace_dispute(
  p_resolver_id uuid,p_dispute_id uuid,p_outcome text,p_reason_code text,p_note text,
  p_idempotency_key uuid,p_partial_amount numeric default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketplace_order_disputes;a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;v_result jsonb;v_action public.marketplace_dispute_review_actions;
  v_action_id uuid:=gen_random_uuid();v_note text:=nullif(btrim(p_note),'');v_reason text:=lower(btrim(coalesce(p_reason_code,'')));
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';
  end if;
  select * into d from public.marketplace_order_disputes where id=p_dispute_id;
  if found then
    select * into a from public.marketplace_payment_allocations where order_id=d.order_id;
    select * into s from public.marketplace_order_settlements where order_id=d.order_id;
  end if;
  if p_outcome='refund_buyer' and p_partial_amount is null
    and s.status='completed' and s.released_at is not null
    and(a.status='released' or exists(
      select 1 from public.marketplace_settlement_reversals r where r.dispute_id=p_dispute_id)) then
    v_result:=public.reverse_marketplace_released_settlement(
      p_resolver_id,p_dispute_id,p_reason_code,p_note,p_idempotency_key);
    if coalesce((v_result->>'money_moved')::boolean,
      (v_result->'finalDecision'->'financial_result'->>'money_moved')::boolean,false) then
      return v_result;
    end if;
    select * into v_action from public.marketplace_dispute_review_actions
    where actor_id=p_resolver_id and idempotency_key=p_idempotency_key;
    if found then
      if v_action.dispute_id<>p_dispute_id or v_action.reason_code<>v_reason
        or coalesce(v_action.note,'')<>coalesce(v_note,'')
        or v_action.metadata->>'request_fingerprint'<>v_result->>'request_fingerprint' then
        raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';
      end if;
    else
      insert into public.marketplace_dispute_review_actions(
        id,dispute_id,order_id,actor_id,action,reason_code,note,idempotency_key,metadata)
      values(v_action_id,p_dispute_id,d.order_id,p_resolver_id,'manual_review_requested',v_reason,v_note,
        p_idempotency_key,jsonb_build_object('code','insufficient_beneficiary_balance',
          'requested_outcome','refund_buyer','review_type','post_settlement',
          'request_fingerprint',v_result->>'request_fingerprint','settlement_id',s.id)) returning * into v_action;
      update public.marketplace_order_disputes set status='under_review',resolved_at=null where id=p_dispute_id;
    end if;
    return public.marketplace_dispute_review_receipt(v_action.id)
      ||jsonb_build_object('money_moved',false,'reason','insufficient_beneficiary_balance');
  end if;
  return public.resolve_marketplace_dispute_held_v1(
    p_resolver_id,p_dispute_id,p_outcome,p_reason_code,p_note,p_idempotency_key,p_partial_amount);
end$$;

create or replace function public.reconcile_marketplace_settlement_reversals()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'orphan_reversal',(select count(*) from public.marketplace_settlement_reversals r
    left join public.marketplace_order_settlements s on s.id=r.settlement_id
    left join public.marketplace_payments p on p.id=r.payment_id
    left join public.marketplace_payment_allocations a on a.id=r.allocation_id
    left join public.marketplace_orders o on o.id=r.order_id
    left join public.marketplace_order_disputes d on d.id=r.dispute_id
    where s.id is null or p.id is null or a.id is null or o.id is null or d.id is null),
  'orphan_reversal_leg',(select count(*) from public.marketplace_settlement_reversal_legs l
    left join public.marketplace_settlement_reversals r on r.id=l.reversal_id
    left join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where r.id is null or x.id is null),
  'duplicate_original_leg_reversal',(select count(*) from(
    select original_settlement_leg_id from public.marketplace_settlement_reversal_legs
    group by 1 having count(*)>1)x),
  'reversal_above_original',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.reversal_amount>l.original_amount or l.reversal_amount>x.amount),
  'wrong_leg_type',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.leg_type not in('seller_net','platform_fee','creator_commission') or l.leg_type<>x.leg_type),
  'wrong_beneficiary',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.beneficiary_user_id is distinct from x.beneficiary_user_id),
  'wrong_source_account',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.source_account_id<>x.destination_account_id),
  'wrong_escrow_destination',(select count(*) from public.marketplace_settlement_reversal_legs l
    left join public.ledger_accounts a on a.id=l.destination_account_id
    where a.id is null or a.owner_id is not null or a.account_type<>'marketplace_escrow' or a.currency<>'BDAG'),
  'wrong_original_transaction',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    left join public.financial_transactions f on f.id=l.original_financial_transaction_id
    where l.original_financial_transaction_id is distinct from x.financial_transaction_id or f.id is null),
  'wrong_original_transaction_amount',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.original_financial_transaction_id where f.amount<>l.original_amount),
  'wrong_original_transaction_currency',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.original_financial_transaction_id where f.currency<>'BDAG'),
  'wrong_original_transaction_destination',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.original_financial_transaction_id where f.to_account_id<>l.source_account_id),
  'wrong_reversal_operation_type',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.reversal_financial_transaction_id
    where f.operation_type<>case l.leg_type when'seller_net'then'marketplace_seller_settlement_reversal'
      when'platform_fee'then'marketplace_platform_fee_reversal'
      when'creator_commission'then'marketplace_creator_commission_reversal'end),
  'wrong_reversal_transaction_amount',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.reversal_financial_transaction_id where f.amount<>l.reversal_amount),
  'wrong_reversal_transaction_accounts',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.reversal_financial_transaction_id
    where(f.from_account_id,f.to_account_id)is distinct from(l.source_account_id,l.destination_account_id)),
  'wrong_reversal_transaction_status',(select count(*) from public.marketplace_settlement_reversal_legs l
    join public.financial_transactions f on f.id=l.reversal_financial_transaction_id where f.status<>'completed'),
  'buyer_refund_missing',(select count(*) from public.marketplace_settlement_reversals r
    left join public.financial_transactions f on f.id=r.buyer_refund_transaction_id where f.id is null),
  'buyer_refund_amount_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.financial_transactions f on f.id=r.buyer_refund_transaction_id where f.amount<>r.gross_amount or f.currency<>'BDAG'),
  'buyer_refund_account_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.financial_transactions f on f.id=r.buyer_refund_transaction_id
    left join public.ledger_accounts src on src.id=f.from_account_id
    left join public.ledger_accounts dst on dst.id=f.to_account_id
    where src.owner_id is not null or src.account_type<>'marketplace_escrow' or src.currency<>'BDAG'
      or dst.owner_id is distinct from r.buyer_id or dst.account_type<>'user' or dst.currency<>'BDAG'),
  'buyer_refund_operation_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.financial_transactions f on f.id=r.buyer_refund_transaction_id
    where f.operation_type<>'marketplace_post_settlement_refund' or f.status<>'completed'),
  'partial_reversal_leg_count',(select count(*) from public.marketplace_settlement_reversals r
    where(select count(*) from public.marketplace_settlement_reversal_legs l where l.reversal_id=r.id)
      <>(select count(*) from public.marketplace_settlement_legs x where x.settlement_id=r.settlement_id and x.amount>0)),
  'reversed_total_gross_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    where r.gross_amount<>(select coalesce(sum(l.reversal_amount),0)
      from public.marketplace_settlement_reversal_legs l where l.reversal_id=r.id)),
  'creator_reversal_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    where(select coalesce(sum(x.amount),0) from public.marketplace_settlement_legs x
      where x.settlement_id=r.settlement_id and x.leg_type='creator_commission' and x.amount>0)
      <>(select coalesce(sum(l.reversal_amount),0) from public.marketplace_settlement_reversal_legs l
      where l.reversal_id=r.id and l.leg_type='creator_commission')),
  'payment_state_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_payments p on p.id=r.payment_id where p.status<>'refunded' or p.refunded_at is null),
  'allocation_state_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_payment_allocations a on a.id=r.allocation_id where a.status<>'refunded' or a.refunded_at is null),
  'order_state_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_orders o on o.id=r.order_id where o.status<>'refunded'),
  'dispute_state_mismatch',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_order_disputes d on d.id=r.dispute_id where d.status<>'resolved' or d.resolved_at is null),
  'duplicate_buyer_refund',(select count(*) from(
    select f.reference_id from public.financial_transactions f
    where f.reference_type='marketplace_settlement_reversal'
      and f.operation_type='marketplace_post_settlement_refund' group by 1 having count(*)>1)x),
  'unexpected_pre_release_reversal',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_order_settlements s on s.id=r.settlement_id where s.released_at is null),
  'reversal_without_completed_settlement',(select count(*) from public.marketplace_settlement_reversals r
    join public.marketplace_order_settlements s on s.id=r.settlement_id
    where s.status<>'completed' or s.released_at is null),
  'reversal_without_resolution_decision',(select count(*) from public.marketplace_settlement_reversals r
    left join public.marketplace_dispute_decisions d on d.dispute_id=r.dispute_id
      and d.outcome='refund_buyer' and d.financial_result->>'reversal_id'=r.id::text where d.id is null),
  'resolution_decision_without_reversal',(select count(*) from public.marketplace_dispute_decisions d
    left join public.marketplace_settlement_reversals r on r.id=(d.financial_result->>'reversal_id')::uuid
    where d.outcome='refund_buyer' and d.financial_result->>'money_moved'='true'
      and d.financial_result?'reversal_id' and r.id is null)
)$$;

revoke all on public.marketplace_settlement_reversals,
  public.marketplace_settlement_reversal_legs from public,anon,authenticated;
grant select on public.marketplace_settlement_reversals,
  public.marketplace_settlement_reversal_legs to service_role;

revoke all on function public.marketplace_reject_settlement_reversal_mutation(),
  public.marketplace_post_settlement_review_receipt(uuid),
  public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid),
  public.reverse_marketplace_released_settlement(uuid,uuid,text,text,uuid),
  public.resolve_marketplace_dispute_held_v1(uuid,uuid,text,text,text,uuid,numeric),
  public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric),
  public.reconcile_marketplace_settlement_reversals()
from public,anon,authenticated;
revoke execute on function public.resolve_marketplace_dispute_held_v1(uuid,uuid,text,text,text,uuid,numeric)
from service_role;
grant execute on function public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid),
  public.reverse_marketplace_released_settlement(uuid,uuid,text,text,uuid),
  public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric),
  public.reconcile_marketplace_settlement_reversals()
to service_role;

comment on table public.marketplace_settlement_reversals is
  'Immutable completed post-settlement economic reversal headers. Manual-review results create no row.';
comment on table public.marketplace_settlement_reversal_legs is
  'Immutable one-for-one snapshots of reversed completed settlement legs.';
comment on function public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid) is
  'Admin-only, service-role entry authority for released-settlement review. It moves no money.';
comment on function public.reverse_marketplace_released_settlement(uuid,uuid,text,text,uuid) is
  'Service-role full-refund authority using immutable completed settlement legs and aggregate beneficiary preflight.';
comment on function public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric) is
  'Canonical dispute resolver: held cases retain the deployed resolver; full released refunds use immutable settlement reversal authority.';
