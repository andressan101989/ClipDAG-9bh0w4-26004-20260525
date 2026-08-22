-- R1C-F1B: preserve Admin release intent across identity collisions and allow canonical seller readback.
begin;

alter table public.marketplace_order_settlements
  drop constraint marketplace_settlement_actor_semantics_check;

alter table public.marketplace_order_settlements
  add constraint marketplace_settlement_actor_semantics_check check (
    (
      release_actor_role = 'buyer'
      and confirmed_by is not null
      and confirmed_by = buyer_id
      and release_actor_id = buyer_id
    )
    or (
      release_actor_role = 'admin'
      and confirmed_by is null
      and release_actor_id is not null
    )
  );

create or replace function public.marketplace_settlement_capture_actor()
returns trigger language plpgsql set search_path=public as $$begin
 if current_setting('app.marketplace_admin_dispute_release',true)='on' then
   new.release_actor_id:=new.confirmed_by;new.release_actor_role:='admin';new.confirmed_by:=null;
 elsif new.confirmed_by=new.buyer_id then
   new.release_actor_id:=new.buyer_id;new.release_actor_role:='buyer';
 else
   new.release_actor_id:=new.confirmed_by;new.release_actor_role:='admin';new.confirmed_by:=null;
 end if;
 return new;
end$$;

revoke all on function public.marketplace_settlement_capture_actor()
  from public,anon,authenticated;

create or replace function public.release_marketplace_order_after_dispute_resolution(
  p_resolver_id uuid,p_order_id uuid,p_dispute_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;
  a public.marketplace_payment_allocations;s public.marketplace_order_settlements;
  prior public.marketplace_dispute_decisions;
  v_settlement uuid:=gen_random_uuid();v_fingerprint text;v_post_reject boolean:=false;
  v_admin_release_marker text:=coalesce(nullif(
    current_setting('app.marketplace_admin_dispute_release',true),''),'off');
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
  perform set_config('app.marketplace_admin_dispute_release','on',true);
  begin
    perform public.marketplace_create_order_settlement_b7f(
      p_resolver_id,o.id,v_settlement,p_idempotency_key,v_fingerprint);
  exception when others then
    perform set_config('app.marketplace_admin_dispute_release',v_admin_release_marker,true);
    raise;
  end;
  perform set_config('app.marketplace_admin_dispute_release',v_admin_release_marker,true);
  return jsonb_build_object('settlement',jsonb_build_object(
    'id',v_settlement,'status','released','released_at',now()),
    'allocation',jsonb_build_object('status','released','gross_amount',a.gross_amount),
    'money_moved',true,'actor_role','admin');
end$$;

comment on function public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid) is
  'Canonical B7F settlement release with explicit transaction-local Admin actor intent for active disputes and immutable reject_claim follow-up.';

create or replace function public.fetch_my_marketplace_sale(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.marketplace_orders;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;

  select * into o from public.marketplace_orders where id = p_order_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace_order_not_found';
  end if;
  if o.seller_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'marketplace_order_not_owned';
  end if;
  if not exists (
    select 1 from public.marketplace_sellers
    where user_id = auth.uid() and status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'marketplace_seller_not_approved';
  end if;
  if not exists (
    select 1 from public.marketplace_stores
    where id = o.store_id and seller_id = auth.uid() and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'marketplace_store_inactive';
  end if;
  if not exists (
    select 1
    from public.marketplace_checkout_sessions c
    join public.marketplace_payments p on p.checkout_id = c.id
    where c.id = o.checkout_id
      and c.status = 'paid'
      and p.paid_at is not null
      and p.status in ('paid', 'partially_refunded', 'refunded')
  ) then
    raise exception using errcode = '42501', message = 'marketplace_order_not_paid';
  end if;
  if not exists (
    select 1
    from public.marketplace_payments p
    join public.marketplace_payment_allocations a
      on a.payment_id = p.id
     and a.order_id = o.id
     and a.seller_id = auth.uid()
    where p.checkout_id = o.checkout_id
      and (
        (
          o.status in ('confirmed', 'processing', 'shipped', 'cancelled')
          and p.status = 'paid'
          and a.status = 'held'
        )
        or (
          o.status = 'delivered'
          and p.status = 'paid'
          and a.status = 'released'
        )
        or (
          o.status = 'shipped'
          and p.status = 'paid'
          and a.status = 'released'
          and exists (
            select 1
            from public.marketplace_order_settlements s
            where s.order_id = o.id
              and s.payment_id = p.id
              and s.allocation_id = a.id
              and s.checkout_id = o.checkout_id
              and s.status = 'completed'
              and s.released_at is not null
          )
        )
        or (
          o.status = 'refunded'
          and p.status in ('paid', 'refunded')
          and a.status = 'refunded'
        )
        or (
          o.status = 'partially_refunded'
          and p.status in ('paid', 'partially_refunded')
          and a.status = 'partially_refunded'
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'marketplace_order_not_fulfillable';
  end if;

  return public.marketplace_order_detail_response(o.id, 'seller');
end;
$$;

revoke all on function public.fetch_my_marketplace_sale(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_my_marketplace_sale(uuid)
  to authenticated, service_role;

create or replace function public.reconcile_marketplace_settlements()
returns jsonb language sql stable security definer set search_path=public as $$
with e as(
  select id,balance from ledger_accounts
  where owner_id is null and account_type='marketplace_escrow' and currency='BDAG'
),p as(
  select id from ledger_accounts
  where owner_id is null and account_type='platform' and currency='BDAG'
),h as(
  select coalesce(sum(gross_amount),0) n from marketplace_payment_allocations where status='held'
),x as(
  select coalesce(sum(balance),0) n from e
),sr as(
  select s.*,
    case when legacy.actor_id is not null then 'admin' else s.release_actor_role end
      effective_release_actor_role,
    case when legacy.actor_id is not null then legacy.actor_id else s.release_actor_id end
      effective_release_actor_id
  from marketplace_order_settlements s
  left join lateral(
    select aa.actor_id
    from marketplace_admin_action_audit aa
    join marketplace_order_disputes d
      on d.id=aa.target_id and d.order_id=s.order_id
    where s.release_actor_role='buyer'
      and aa.action='dispute_release_seller'
      and aa.target_type='dispute'
      and aa.metadata->>'result_kind'='post_reject_release'
      and aa.metadata->>'canonical_id'=s.id::text
      and coalesce((aa.metadata->>'money_moved')::boolean,false)=true
      and aa.actor_id=s.release_actor_id
    limit 1
  )legacy on true
),lt as(
  select l.*,s.order_id,s.buyer_id,s.seller_id,
    s.effective_release_actor_id,s.effective_release_actor_role,
    f.id tx,f.operation_type,f.amount tx_amount,f.currency tx_currency,f.status tx_status,
    f.reference_type,f.reference_id,f.from_account_id,f.to_account_id,f.initiated_by
  from marketplace_settlement_legs l
  join sr s on s.id=l.settlement_id
  left join financial_transactions f on f.id=l.financial_transaction_id
)
select jsonb_build_object(
  'released_without_settlement',(select count(*) from marketplace_payment_allocations a left join marketplace_order_settlements s on s.allocation_id=a.id where a.status='released' and s.id is null),
  'settlement_without_release',(select count(*) from marketplace_order_settlements s join marketplace_payment_allocations a on a.id=s.allocation_id where a.status is distinct from 'released'),
  'delivered_with_held_allocation',(select count(*) from marketplace_orders o join marketplace_payment_allocations a on a.order_id=o.id where o.status='delivered' and a.status='held'),
  'released_order_not_delivered',(select count(*) from marketplace_payment_allocations a left join sr s on s.allocation_id=a.id join marketplace_orders o on o.id=a.order_id where a.status='released' and(s.id is null or(s.effective_release_actor_role='buyer'and o.status is distinct from 'delivered')or(s.effective_release_actor_role='admin'and o.status not in('shipped','delivered')))),
  'released_shipment_not_delivered',(select count(*) from marketplace_payment_allocations a left join sr s on s.allocation_id=a.id left join marketplace_order_shipments sh on sh.order_id=a.order_id where a.status='released' and(s.id is null or(s.effective_release_actor_role='buyer'and(sh.id is null or sh.status is distinct from 'delivered' or sh.delivered_at is null))or(s.effective_release_actor_role='admin'and(sh.id is null or sh.status not in('shipped','delivered'))))),
  'delivery_timestamp_mismatch',(select count(*) from sr s join marketplace_orders o on o.id=s.order_id left join marketplace_order_shipments sh on sh.order_id=o.id where s.effective_release_actor_role='buyer'and(sh.id is null or o.delivered_at is null or sh.delivered_at is null or o.delivered_at is distinct from sh.delivered_at or s.confirmed_at is distinct from o.delivered_at)),
  'settlement_amount_mismatch',(select count(*) from marketplace_order_settlements s join marketplace_payment_allocations a on a.id=s.allocation_id where(s.currency,s.gross_amount,s.seller_net_amount,s.platform_fee_amount)is distinct from(a.currency,a.gross_amount,a.seller_net_amount,a.platform_fee_amount)),
  'settlement_leg_sum_mismatch',(select count(*) from marketplace_order_settlements s where s.gross_amount is distinct from(select coalesce(sum(amount),0) from marketplace_settlement_legs l where l.settlement_id=s.id and l.status='completed')),
  'missing_seller_leg',(select count(*) from marketplace_order_settlements s where not exists(select 1 from marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='seller_net')),
  'missing_platform_leg',(select count(*) from marketplace_order_settlements s where not exists(select 1 from marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='platform_fee')),
  'duplicate_seller_leg',(select count(*) from(select settlement_id from marketplace_settlement_legs where leg_type='seller_net' group by 1 having count(*)>1)q),
  'duplicate_platform_leg',(select count(*) from(select settlement_id from marketplace_settlement_legs where leg_type='platform_fee' group by 1 having count(*)>1)q),
  'positive_leg_without_transaction',(select count(*) from lt where amount>0 and tx is null),
  'transaction_amount_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_amount is distinct from amount),
  'transaction_currency_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_currency is distinct from 'BDAG'),
  'transaction_status_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_status is distinct from 'completed'),
  'transaction_operation_type_mismatch',(select count(*) from lt where amount>0 and tx is not null and operation_type is distinct from case leg_type when'seller_net'then'marketplace_seller_settlement'when'platform_fee'then'marketplace_platform_fee_settlement'else operation_type end),
  'transaction_reference_mismatch',(select count(*) from lt where amount>0 and tx is not null and(reference_type is distinct from'marketplace_order'or reference_id is distinct from order_id::text or initiated_by is distinct from case effective_release_actor_role when'buyer'then buyer_id when'admin'then effective_release_actor_id end)),
  'transaction_source_account_mismatch',(select count(*) from lt where amount>0 and tx is not null and not exists(select 1 from e where e.id is not distinct from from_account_id)),
  'transaction_destination_account_mismatch',(select count(*) from lt where amount>0 and tx is not null and((leg_type='seller_net'and not exists(select 1 from ledger_accounts a where a.id is not distinct from to_account_id and a.owner_id is not distinct from seller_id and a.account_type='user'and a.currency='BDAG'))or(leg_type='platform_fee'and not exists(select 1 from p where p.id is not distinct from to_account_id)))),
  'seller_beneficiary_mismatch',(select count(*) from lt where leg_type='seller_net'and beneficiary_user_id is distinct from seller_id),
  'platform_beneficiary_mismatch',(select count(*) from lt where leg_type='platform_fee'and beneficiary_user_id is not null),
  'settlement_order_identity_mismatch',(select count(*) from marketplace_order_settlements s join marketplace_orders o on o.id=s.order_id where(s.checkout_id,s.buyer_id,s.seller_id,s.store_id,s.currency,s.gross_amount)is distinct from(o.checkout_id,o.buyer_id,o.seller_id,o.store_id,o.currency,o.total)),
  'settlement_payment_identity_mismatch',(select count(*) from marketplace_order_settlements s join marketplace_payments m on m.id=s.payment_id where(s.checkout_id,s.buyer_id,s.currency)is distinct from(m.checkout_id,m.buyer_id,m.currency)),
  'settlement_allocation_identity_mismatch',(select count(*) from marketplace_order_settlements s join marketplace_payment_allocations a on a.id=s.allocation_id where(s.payment_id,s.checkout_id,s.order_id,s.seller_id,s.store_id,s.currency)is distinct from(a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id,a.currency)),
  'escrow_expected_held_total',(select n from h),
  'escrow_actual_balance',(select n from x),
  'escrow_difference',(select x.n-h.n from x,h),
  'escrow_shortage',(select greatest(h.n-x.n,0)from x,h),
  'escrow_surplus',(select greatest(x.n-h.n,0)from x,h)
)$$;

revoke all on function public.reconcile_marketplace_settlements()
  from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_settlements()
  to service_role;

comment on function public.reconcile_marketplace_settlements() is
  'Read-only Marketplace settlement integrity counters with strict buyer delivery, explicit Admin release actors, and narrow immutable-audit compatibility.';

notify pgrst,'reload schema';
commit;
