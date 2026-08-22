-- R1C-F1: permit an Admin to finalize held settlement after an immutable reject_claim decision.
begin;

create or replace function public.release_marketplace_order_after_dispute_resolution(
  p_resolver_id uuid,p_order_id uuid,p_dispute_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;
  a public.marketplace_payment_allocations;s public.marketplace_order_settlements;
  prior public.marketplace_dispute_decisions;
  v_settlement uuid:=gen_random_uuid();v_fingerprint text;v_post_reject boolean:=false;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true) then
    raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';
  end if;
  if p_order_id is null or p_dispute_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_dispute_resolution_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-order-settlement:'||p_order_id::text,0));
  select * into d from public.marketplace_order_disputes where id=p_dispute_id for update;
  select * into o from public.marketplace_orders where id=p_order_id for update;
  if d.id is null or o.id is null or d.order_id<>o.id then
    raise exception using errcode='P0002',message='marketplace_dispute_not_found';
  end if;
  select * into prior from public.marketplace_dispute_decisions where dispute_id=d.id;
  if d.status in('open','under_review') then
    if found then
      raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';
    end if;
  elsif d.status='rejected' then
    if not found or prior.outcome<>'reject_claim'
      or coalesce((prior.financial_result->>'settlement_eligible')::boolean,false)<>true then
      raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';
    end if;
    v_post_reject:=true;
  else
    raise exception using errcode='22023',message='marketplace_dispute_not_open';
  end if;
  select * into s from public.marketplace_order_settlements where order_id=o.id;
  if found then return jsonb_build_object('settlement',jsonb_build_object(
    'id',s.id,'status',s.status,'released_at',s.released_at),
    'money_moved',false,'already_released',true);end if;
  select * into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  select * into a from public.marketplace_payment_allocations where order_id=o.id for update;
  if p.id is null or p.status<>'paid' then
    raise exception using errcode='22023',message='marketplace_refund_payment_not_paid';
  end if;
  if o.status not in('shipped','delivered') then
    raise exception using errcode='22023',message='marketplace_refund_order_state_invalid';
  end if;
  if a.id is null or a.status<>'held' then
    raise exception using errcode='22023',message='marketplace_refund_allocation_not_held';
  end if;
  v_fingerprint:=encode(extensions.digest(
    case when v_post_reject then 'marketplace_post_reject_support_release:'
      else 'marketplace_dispute_support_release:' end||d.id::text,'sha256'),'hex');
  perform public.marketplace_create_order_settlement_b7f(
    p_resolver_id,o.id,v_settlement,p_idempotency_key,v_fingerprint);
  return jsonb_build_object('settlement',jsonb_build_object(
    'id',v_settlement,'status','released','released_at',now()),
    'allocation',jsonb_build_object('status','released','gross_amount',a.gross_amount),
    'money_moved',true,'actor_role','admin');
end$$;

create or replace function public.admin_resolve_marketplace_dispute(
  p_dispute_id uuid,
  p_outcome text,
  p_reason_code text,
  p_note text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid;
  v_result jsonb;
  v_release jsonb;
  v_role text;
  v_claims_text text;
  v_claims jsonb;
  v_action text;
  v_reason text:=lower(btrim(coalesce(p_reason_code,'')));
  v_note text:=nullif(btrim(p_note),'');
  v_fingerprint text;
  v_prior public.marketplace_admin_action_audit;
  v_dispute public.marketplace_order_disputes;
  v_decision public.marketplace_dispute_decisions;
  v_settlement public.marketplace_order_settlements;
  v_allocation public.marketplace_payment_allocations;
  v_post_reject boolean:=false;
begin
  v_actor:=public.marketplace_require_admin();
  if p_dispute_id is null or p_idempotency_key is null
    or p_outcome not in('manual_review','refund_buyer','release_seller','reject_claim')
    or char_length(v_reason) not between 2 and 100
    or(v_note is not null and char_length(v_note)>1000) then
    raise exception using errcode='22023',message='marketplace_admin_dispute_command_invalid';
  end if;

  v_action:='dispute_'||p_outcome;
  v_fingerprint:=public.marketplace_admin_operation_fingerprint(
    v_action,p_dispute_id,v_reason,v_note);
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-admin-command:'||v_actor::text||':'||p_idempotency_key::text,0));
  select * into v_prior
  from public.marketplace_admin_action_audit
  where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found and(v_prior.action,v_prior.target_type,v_prior.target_id,
    v_prior.metadata->>'request_fingerprint') is distinct from
    (v_action,'dispute',p_dispute_id,v_fingerprint) then
    raise exception using errcode='23505',message='marketplace_admin_idempotency_conflict';
  end if;

  select * into v_dispute from public.marketplace_order_disputes where id=p_dispute_id;
  if found then
    select * into v_decision from public.marketplace_dispute_decisions
      where dispute_id=p_dispute_id;
    v_post_reject:=p_outcome='release_seller'
      and v_dispute.status='rejected'
      and v_decision.id is not null
      and v_decision.outcome='reject_claim'
      and coalesce((v_decision.financial_result->>'settlement_eligible')::boolean,false)=true;
  end if;

  if v_prior.id is not null and v_prior.metadata->>'result_kind'='post_reject_release' then
    select * into v_settlement from public.marketplace_order_settlements
      where id=(v_prior.metadata->>'canonical_id')::uuid;
    select * into v_allocation from public.marketplace_payment_allocations
      where order_id=v_dispute.order_id;
    if v_settlement.id is null or v_allocation.id is null then
      raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';
    end if;
    return jsonb_build_object(
      'kind','post_reject_release',
      'money_moved',coalesce((v_prior.metadata->>'money_moved')::boolean,false),
      'dispute_id',p_dispute_id,
      'prior_decision_id',v_decision.id,
      'prior_outcome','reject_claim',
      'settlement',jsonb_build_object('id',v_settlement.id,'status',v_settlement.status,
        'released_at',v_settlement.released_at),
      'allocation',jsonb_build_object('status',v_allocation.status,'gross_amount',v_allocation.gross_amount),
      'already_released',coalesce((v_prior.metadata->>'already_released')::boolean,false));
  end if;

  v_claims_text:=nullif(current_setting('request.jwt.claims',true),'');
  if v_claims_text is null then
    raise exception using errcode='42501',message='marketplace_admin_auth_required';
  end if;
  begin
    v_claims:=v_claims_text::jsonb;
  exception when others then
    raise exception using errcode='42501',message='marketplace_admin_auth_required';
  end;
  if nullif(v_claims->>'sub','') is distinct from v_actor::text then
    raise exception using errcode='42501',message='marketplace_admin_actor_mismatch';
  end if;
  v_role:=coalesce(current_setting('request.jwt.claim.role',true),'');

  begin
    perform set_config('request.jwt.claims',
      (v_claims||jsonb_build_object('role','service_role'))::text,true);
    perform set_config('request.jwt.claim.role','service_role',true);
    if v_post_reject then
      v_release:=public.release_marketplace_order_after_dispute_resolution(
        v_actor,v_dispute.order_id,p_dispute_id,p_idempotency_key);
      select * into v_settlement from public.marketplace_order_settlements
        where order_id=v_dispute.order_id;
      select * into v_allocation from public.marketplace_payment_allocations
        where order_id=v_dispute.order_id;
      if v_settlement.id is null or v_allocation.id is null then
        raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';
      end if;
      v_result:=jsonb_build_object(
        'kind','post_reject_release',
        'money_moved',coalesce((v_release->>'money_moved')::boolean,false),
        'dispute_id',p_dispute_id,
        'prior_decision_id',v_decision.id,
        'prior_outcome','reject_claim',
        'settlement',jsonb_build_object('id',v_settlement.id,'status',v_settlement.status,
          'released_at',v_settlement.released_at),
        'allocation',jsonb_build_object('status',v_allocation.status,'gross_amount',v_allocation.gross_amount),
        'already_released',coalesce((v_release->>'already_released')::boolean,false));
    else
      v_result:=public.resolve_marketplace_dispute(
        v_actor,p_dispute_id,p_outcome,v_reason,v_note,p_idempotency_key,null);
    end if;
    perform set_config('request.jwt.claims',v_claims_text,true);
    perform set_config('request.jwt.claim.role',v_role,true);
  exception when others then
    perform set_config('request.jwt.claims',v_claims_text,true);
    perform set_config('request.jwt.claim.role',v_role,true);
    raise;
  end;

  insert into public.marketplace_admin_action_audit(
    actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)
  values(
    v_actor,v_action,'dispute',p_dispute_id,p_idempotency_key,v_reason,
    jsonb_build_object(
      'request_fingerprint',v_fingerprint,
      'result_kind',v_result->>'kind',
      'canonical_id',coalesce(
        v_result->'settlement'->>'id',
        v_result->'finalDecision'->>'id',v_result->'reviewAction'->>'id'),
      'money_moved',coalesce(
        (v_result->>'money_moved')::boolean,
        (v_result->'finalDecision'->'financial_result'->>'money_moved')::boolean,
        false),
      'already_released',coalesce((v_result->>'already_released')::boolean,false)))
  on conflict(actor_id,idempotency_key) do nothing;
  return v_result;
end
$$;

create or replace function public.reconcile_marketplace_admin_operations()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$select jsonb_build_object(
  'audit_orphan_actor',(select count(*)from public.marketplace_admin_action_audit a left join auth.users u on u.id=a.actor_id where u.id is null),
  'audit_orphan_dispute',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_order_disputes d on d.id=a.target_id where a.target_type='dispute'and d.id is null),
  'audit_orphan_seller',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_sellers s on s.user_id=a.target_id where a.target_type='seller'and s.user_id is null),
  'audit_orphan_product',(select count(*)from public.marketplace_admin_action_audit a left join public.products p on p.id=a.target_id where a.target_type='product'and p.id is null),
  'audit_invalid_fingerprint',(select count(*)from public.marketplace_admin_action_audit where coalesce(metadata->>'request_fingerprint','')!~'^[0-9a-f]{64}$'),
  'audit_action_target_mismatch',(select count(*)from public.marketplace_admin_action_audit where(action like'dispute_%')<>(target_type='dispute')or(action like'seller_%')<>(target_type='seller')or(action like'product_%')<>(target_type='product')),
  'audit_dispute_actor_mismatch',(select count(*)from public.marketplace_admin_action_audit a
    left join public.marketplace_dispute_decisions d on d.id=(a.metadata->>'canonical_id')::uuid
    left join public.marketplace_dispute_review_actions r on r.id=(a.metadata->>'canonical_id')::uuid
    left join public.marketplace_order_settlements s on s.id=(a.metadata->>'canonical_id')::uuid
      and a.metadata->>'result_kind'='post_reject_release'
    where a.target_type='dispute'and coalesce(d.resolver_id,r.actor_id,s.release_actor_id)is distinct from a.actor_id),
  'audit_dispute_target_mismatch',(select count(*)from public.marketplace_admin_action_audit a
    left join public.marketplace_dispute_decisions d on d.id=(a.metadata->>'canonical_id')::uuid
    left join public.marketplace_dispute_review_actions r on r.id=(a.metadata->>'canonical_id')::uuid
    left join public.marketplace_order_settlements s on s.id=(a.metadata->>'canonical_id')::uuid
      and a.metadata->>'result_kind'='post_reject_release'
    left join public.marketplace_order_disputes sd on sd.id=a.target_id and sd.order_id=s.order_id
    where a.target_type='dispute'and coalesce(d.dispute_id,r.dispute_id,sd.id)is distinct from a.target_id)
)$$;

revoke all on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)
  from public,anon;
grant execute on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)
  to authenticated,service_role;
revoke all on function public.reconcile_marketplace_admin_operations()
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_marketplace_admin_operations()
  to service_role;

comment on function public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid) is
  'Canonical B7F settlement release for active dispute resolution or a narrowly authorized immutable reject_claim follow-up.';
comment on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid) is
  'Authenticated admin-only bridge to canonical dispute resolution and post-reject held settlement finalization.';

notify pgrst,'reload schema';
commit;
