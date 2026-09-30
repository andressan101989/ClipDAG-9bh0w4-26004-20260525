-- STRIPE-A2: harden the existing test-mode provider adapter. Stripe remains
-- an external rail; the canonical Nelyon ledger remains the balance authority.

begin;

create or replace function private.stripe_bdag_per_usd()
returns numeric
language sql
immutable
security definer
set search_path=''
as $$ select 100.00000000::numeric $$;

alter function private.stripe_bdag_per_usd() owner to postgres;
revoke all on function private.stripe_bdag_per_usd() from public,anon,authenticated,service_role;

do $$
begin
  if exists (
    select 1 from private.stripe_bdag_topups t
    where t.usd_to_bdag_rate<>private.stripe_bdag_per_usd()
       or t.bdag_amount<>round(t.amount_usd_cents::numeric*private.stripe_bdag_per_usd()/100,8)
       or t.livemode
  ) then
    raise exception 'stripe_existing_economic_snapshot_incompatible' using errcode='55000';
  end if;
  if exists (select 1 from private.stripe_customers c where c.livemode)
    or exists (select 1 from private.stripe_webhook_events e where e.livemode) then
    raise exception 'stripe_existing_live_event_in_test_domain' using errcode='55000';
  end if;
  if exists (select 1 from private.stripe_webhook_events) then
    raise exception 'stripe_legacy_webhook_evidence_requires_review' using errcode='55000';
  end if;
end;
$$;

alter table private.stripe_customers
  add constraint stripe_customers_test_mode_chk check (not livemode);

alter table private.stripe_bdag_topups
  drop constraint if exists stripe_bdag_topups_status_check;

alter table private.stripe_bdag_topups
  add column credit_stripe_event_id text,
  add column refunded_usd_cents bigint not null default 0,
  add column refund_required_bdag numeric(38,8) not null default 0,
  add column refund_event_created_at timestamptz,
  add column dispute_status text not null default 'none',
  add column disputed_usd_cents bigint not null default 0,
  add column dispute_required_bdag numeric(38,8) not null default 0,
  add column dispute_event_created_at timestamptz,
  add column reversed_bdag_amount numeric(38,8) not null default 0,
  add column reversal_pending_reason text,
  add column pending_reversal_bdag numeric(38,8) generated always as (
    greatest(refund_required_bdag+dispute_required_bdag-reversed_bdag_amount,0::numeric)
  ) stored,
  add constraint stripe_bdag_topups_status_check check (status in (
    'created','checkout_open','paid','credited','failed','expired',
    'requires_review','partially_refunded','refunded'
  )),
  add constraint stripe_bdag_topups_test_mode_chk check (not livemode),
  add constraint stripe_bdag_topups_economic_snapshot_chk check (
    usd_to_bdag_rate=private.stripe_bdag_per_usd()
    and bdag_amount=round(amount_usd_cents::numeric*private.stripe_bdag_per_usd()/100,8)
  ),
  add constraint stripe_bdag_topups_refund_amount_chk check (
    refunded_usd_cents between 0 and amount_usd_cents
    and refund_required_bdag between 0 and bdag_amount
  ),
  add constraint stripe_bdag_topups_dispute_amount_chk check (
    disputed_usd_cents between 0 and amount_usd_cents
    and dispute_required_bdag between 0 and bdag_amount
  ),
  add constraint stripe_bdag_topups_dispute_status_chk check (
    dispute_status in ('none','opened','funds_withdrawn','won','lost')
  ),
  add constraint stripe_bdag_topups_reversed_amount_chk check (
    reversed_bdag_amount between 0 and bdag_amount*2
  );

create unique index stripe_bdag_topups_credit_event_uidx
  on private.stripe_bdag_topups(credit_stripe_event_id)
  where credit_stripe_event_id is not null;

alter table private.stripe_webhook_events
  add column provider_created_at timestamptz,
  add column stripe_checkout_session_id text,
  add column stripe_payment_intent_id text,
  add column provider_object_id text,
  add column amount_usd_cents bigint,
  add column currency text,
  add column provider_status text,
  add column adjustment_kind text,
  add column adjustment_target_bdag numeric(38,8),
  add column adjustment_delta_bdag numeric(38,8),
  add column adjustment_status text not null default 'none',
  add column financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  add constraint stripe_webhook_events_test_mode_chk check (not livemode),
  add constraint stripe_webhook_events_amount_chk check (amount_usd_cents is null or amount_usd_cents>=0),
  add constraint stripe_webhook_events_currency_chk check (currency is null or currency=lower(currency)),
  add constraint stripe_webhook_events_adjustment_kind_chk check (
    adjustment_kind is null or adjustment_kind in ('refund','dispute','dispute_reinstatement')
  ),
  add constraint stripe_webhook_events_adjustment_status_chk check (
    adjustment_status in ('none','not_required','applied','pending_insufficient_funds','stale')
  ),
  add constraint stripe_webhook_events_adjustment_amount_chk check (
    (adjustment_target_bdag is null or adjustment_target_bdag>=0)
    and (adjustment_delta_bdag is null or adjustment_delta_bdag>=0)
  );

create index stripe_webhook_events_payment_intent_idx
  on private.stripe_webhook_events(stripe_payment_intent_id,provider_created_at)
  where stripe_payment_intent_id is not null;

create or replace function public.manage_stripe_bdag_adapter(
  p_action text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner_id uuid;
  v_actor_id uuid;
  v_topup_id uuid;
  v_resolved_id uuid;
  v_event_id text;
  v_event_type text;
  v_livemode boolean;
  v_amount bigint;
  v_rate numeric;
  v_bdag numeric;
  v_key uuid;
  v_fingerprint text;
  v_customer text;
  v_session text;
  v_payment_intent text;
  v_object_id text;
  v_url text;
  v_hash text;
  v_status text;
  v_error text;
  v_currency text;
  v_provider_status text;
  v_provider_created_at timestamptz;
  v_existing private.stripe_bdag_topups%rowtype;
  v_event private.stripe_webhook_events%rowtype;
begin
  if p_action='prepare_checkout' then
    v_owner_id := nullif(p_payload->>'owner_id','')::uuid;
    v_actor_id := nullif(p_payload->>'actor_id','')::uuid;
    v_amount := nullif(p_payload->>'amount_usd_cents','')::bigint;
    v_rate := private.stripe_bdag_per_usd();
    v_bdag := round(v_amount::numeric*v_rate/100,8);
    v_key := nullif(p_payload->>'idempotency_key','')::uuid;
    v_fingerprint := p_payload->>'request_fingerprint';
    v_livemode := coalesce((p_payload->>'livemode')::boolean,false);

    if not (p_payload ? 'livemode') or v_livemode is distinct from false then
      raise exception 'stripe_mode_mismatch' using errcode='22023';
    end if;
    if p_payload ? 'usd_to_bdag_rate'
      and (p_payload->>'usd_to_bdag_rate')::numeric<>v_rate then
      raise exception 'stripe_topup_rate_mismatch' using errcode='22023';
    end if;
    if p_payload ? 'bdag_amount'
      and (p_payload->>'bdag_amount')::numeric<>v_bdag then
      raise exception 'stripe_topup_bdag_mismatch' using errcode='22023';
    end if;
    if v_owner_id is null or v_actor_id is null or v_owner_id<>v_actor_id then
      raise exception 'business_owner_required' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.marketplace_sellers s
      where s.user_id=v_owner_id and s.status='approved'
    ) then
      raise exception 'approved_business_owner_required' using errcode='42501';
    end if;
    if v_amount is null or v_amount<50 or v_amount>99999999 or v_bdag<=0
      or v_key is null or pg_catalog.length(coalesce(v_fingerprint,''))<16 then
      raise exception 'invalid_topup_amount' using errcode='22023';
    end if;

    insert into private.stripe_bdag_topups(
      owner_id,actor_id,amount_usd_cents,usd_to_bdag_rate,bdag_amount,
      livemode,idempotency_key,request_fingerprint
    ) values (
      v_owner_id,v_actor_id,v_amount,v_rate,v_bdag,
      false,v_key,v_fingerprint
    ) on conflict(owner_id,idempotency_key) do nothing;

    select * into v_existing
    from private.stripe_bdag_topups t
    where t.owner_id=v_owner_id and t.idempotency_key=v_key
    for update;

    if v_existing.request_fingerprint<>v_fingerprint
      or v_existing.amount_usd_cents<>v_amount
      or v_existing.livemode
      or v_existing.usd_to_bdag_rate<>v_rate
      or v_existing.bdag_amount<>v_bdag then
      raise exception 'idempotency_conflict' using errcode='23505';
    end if;

    select c.stripe_customer_id into v_customer
    from private.stripe_customers c
    where c.owner_id=v_owner_id and not c.livemode;

    return jsonb_build_object(
      'topup_id',v_existing.id,
      'status',v_existing.status,
      'stripe_customer_id',coalesce(v_existing.stripe_customer_id,v_customer),
      'stripe_checkout_session_id',v_existing.stripe_checkout_session_id,
      'checkout_url',v_existing.stripe_checkout_url,
      'amount_usd_cents',v_existing.amount_usd_cents,
      'usd_to_bdag_rate',v_existing.usd_to_bdag_rate,
      'bdag_amount',v_existing.bdag_amount,
      'reused',v_existing.stripe_checkout_session_id is not null
    );
  elsif p_action='bind_checkout' then
    v_topup_id := nullif(p_payload->>'topup_id','')::uuid;
    v_owner_id := nullif(p_payload->>'owner_id','')::uuid;
    v_livemode := coalesce((p_payload->>'livemode')::boolean,false);
    v_customer := nullif(p_payload->>'stripe_customer_id','');
    v_session := nullif(p_payload->>'stripe_checkout_session_id','');
    v_url := nullif(p_payload->>'checkout_url','');

    if not (p_payload ? 'livemode') or v_livemode is distinct from false then
      raise exception 'stripe_mode_mismatch' using errcode='22023';
    end if;
    if v_customer is null or v_session is null or v_url is null then
      raise exception 'stripe_checkout_binding_invalid' using errcode='22023';
    end if;
    select * into v_existing
    from private.stripe_bdag_topups t
    where t.id=v_topup_id
    for update;
    if not found or v_existing.owner_id<>v_owner_id or v_existing.livemode then
      raise exception 'topup_not_found' using errcode='P0002';
    end if;
    if v_existing.stripe_checkout_session_id is not null
      and v_existing.stripe_checkout_session_id<>v_session then
      raise exception 'checkout_session_conflict' using errcode='23505';
    end if;
    if v_existing.status not in ('created','checkout_open') then
      raise exception 'topup_not_open' using errcode='55000';
    end if;

    insert into private.stripe_customers(owner_id,livemode,stripe_customer_id)
    values(v_owner_id,false,v_customer)
    on conflict(owner_id,livemode) do update
      set stripe_customer_id=excluded.stripe_customer_id,updated_at=now();

    update private.stripe_bdag_topups
    set stripe_customer_id=v_customer,
        stripe_checkout_session_id=v_session,
        stripe_checkout_url=v_url,
        status='checkout_open',updated_at=now()
    where id=v_topup_id;

    return jsonb_build_object('topup_id',v_topup_id,'status','checkout_open','checkout_url',v_url);
  elsif p_action='ingest_webhook' then
    v_event_id := nullif(p_payload->>'stripe_event_id','');
    v_event_type := nullif(p_payload->>'event_type','');
    v_livemode := coalesce((p_payload->>'livemode')::boolean,false);
    v_hash := nullif(p_payload->>'payload_hash','');
    v_topup_id := nullif(p_payload->>'topup_id','')::uuid;
    v_session := nullif(p_payload->>'stripe_checkout_session_id','');
    v_payment_intent := nullif(p_payload->>'stripe_payment_intent_id','');
    v_object_id := nullif(p_payload->>'provider_object_id','');
    v_amount := nullif(p_payload->>'amount_usd_cents','')::bigint;
    v_currency := lower(nullif(p_payload->>'currency',''));
    v_provider_status := nullif(p_payload->>'provider_status','');
    v_provider_created_at := nullif(p_payload->>'provider_created_at','')::timestamptz;

    if not (p_payload ? 'livemode') or v_livemode is distinct from false then
      raise exception 'stripe_mode_mismatch' using errcode='22023';
    end if;
    if v_event_id is null or v_event_type is null or pg_catalog.length(coalesce(v_hash,''))<32
      or v_provider_created_at is null then
      raise exception 'stripe_webhook_evidence_invalid' using errcode='22023';
    end if;

    if v_topup_id is not null then
      select t.id into v_resolved_id from private.stripe_bdag_topups t where t.id=v_topup_id;
      if v_resolved_id is null then raise exception 'stripe_webhook_topup_not_found' using errcode='P0002'; end if;
    end if;
    if v_session is not null then
      select t.id into v_resolved_id from private.stripe_bdag_topups t
      where t.stripe_checkout_session_id=v_session;
      if v_resolved_id is not null and v_topup_id is not null and v_resolved_id<>v_topup_id then
        raise exception 'stripe_webhook_topup_binding_mismatch' using errcode='22023';
      end if;
      v_topup_id:=coalesce(v_topup_id,v_resolved_id);
    end if;
    if v_payment_intent is not null then
      select t.id into v_resolved_id from private.stripe_bdag_topups t
      where t.stripe_payment_intent_id=v_payment_intent;
      if v_resolved_id is not null and v_topup_id is not null and v_resolved_id<>v_topup_id then
        raise exception 'stripe_webhook_topup_binding_mismatch' using errcode='22023';
      end if;
      v_topup_id:=coalesce(v_topup_id,v_resolved_id);
    end if;
    if v_topup_id is not null then
      select * into v_existing from private.stripe_bdag_topups t where t.id=v_topup_id for update;
      if not found or v_existing.livemode then raise exception 'stripe_webhook_topup_not_found' using errcode='P0002'; end if;
      if v_session is not null and v_existing.stripe_checkout_session_id is distinct from v_session then
        raise exception 'stripe_webhook_checkout_session_mismatch' using errcode='22023';
      end if;
      if v_existing.stripe_payment_intent_id is not null
        and v_payment_intent is distinct from v_existing.stripe_payment_intent_id then
        raise exception 'stripe_webhook_payment_intent_mismatch' using errcode='22023';
      end if;
    end if;

    insert into private.stripe_webhook_events(
      stripe_event_id,event_type,livemode,payload_hash,topup_id,provider_created_at,
      stripe_checkout_session_id,stripe_payment_intent_id,provider_object_id,
      amount_usd_cents,currency,provider_status
    ) values(
      v_event_id,v_event_type,false,v_hash,v_topup_id,v_provider_created_at,
      v_session,v_payment_intent,v_object_id,v_amount,v_currency,v_provider_status
    ) on conflict(stripe_event_id) do nothing;

    select * into v_event
    from private.stripe_webhook_events e
    where e.stripe_event_id=v_event_id
    for update;
    if v_event.event_type<>v_event_type or v_event.livemode
      or v_event.payload_hash<>v_hash or v_event.topup_id is distinct from v_topup_id
      or v_event.stripe_checkout_session_id is distinct from v_session
      or v_event.stripe_payment_intent_id is distinct from v_payment_intent
      or v_event.amount_usd_cents is distinct from v_amount
      or v_event.currency is distinct from v_currency
      or v_event.provider_status is distinct from v_provider_status then
      raise exception 'webhook_event_conflict' using errcode='23505';
    end if;
    if v_event.status in ('processed','ignored') then
      return jsonb_build_object('already_processed',true,'status',v_event.status,'topup_id',v_event.topup_id);
    end if;

    if v_topup_id is not null then
      if v_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
        and v_provider_status='paid' then
        update private.stripe_bdag_topups
        set status='paid',updated_at=now()
        where id=v_topup_id and status in ('created','checkout_open','paid');
      elsif v_event_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
        update private.stripe_bdag_topups
        set status=case when v_event_type='checkout.session.expired' then 'expired' else 'failed' end,
            updated_at=now()
        where id=v_topup_id and status in ('created','checkout_open','paid');
      elsif v_event_type in (
        'charge.refunded','charge.dispute.created','charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated','charge.dispute.closed'
      ) then
        update private.stripe_bdag_topups
        set status='requires_review',updated_at=now()
        where id=v_topup_id and financial_transaction_id is null;
      end if;
    end if;

    return jsonb_build_object('already_processed',false,'status','received','topup_id',v_topup_id);
  elsif p_action='complete_webhook' then
    v_event_id := p_payload->>'stripe_event_id';
    v_status := p_payload->>'status';
    v_error := nullif(p_payload->>'error_code','');
    if v_status not in ('processed','ignored','error') then
      raise exception 'invalid_webhook_status' using errcode='22023';
    end if;
    update private.stripe_webhook_events
    set status=v_status,error_code=v_error,processed_at=now()
    where stripe_event_id=v_event_id and status not in ('processed','ignored');
    if not found and not exists(
      select 1 from private.stripe_webhook_events e where e.stripe_event_id=v_event_id and e.status=v_status
    ) then raise exception 'webhook_event_not_found_or_terminal' using errcode='P0002'; end if;
    return jsonb_build_object('stripe_event_id',v_event_id,'status',v_status);
  else
    raise exception 'invalid_adapter_action' using errcode='22023';
  end if;
end;
$$;

create or replace function public.credit_stripe_bdag_topup(
  p_topup_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
  p_amount_usd_cents bigint,
  p_currency text,
  p_stripe_event_id text,
  p_livemode boolean
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_topup private.stripe_bdag_topups%rowtype;
  v_event private.stripe_webhook_events%rowtype;
  v_account_id uuid;
  v_transaction_id uuid;
  v_new_balance numeric;
begin
  if p_livemode is distinct from false then raise exception 'stripe_mode_mismatch' using errcode='22023'; end if;
  select * into v_topup from private.stripe_bdag_topups t where t.id=p_topup_id for update;
  if not found then raise exception 'topup_not_found' using errcode='P0002'; end if;
  select * into v_event from private.stripe_webhook_events e
  where e.stripe_event_id=p_stripe_event_id for update;
  if not found
    or v_event.topup_id is distinct from p_topup_id
    or v_event.livemode<>p_livemode
    or v_event.event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded')
    or v_event.provider_status<>'paid'
    or v_event.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id
    or v_event.stripe_payment_intent_id is distinct from p_stripe_payment_intent_id then
    raise exception 'stripe_credit_event_binding_mismatch' using errcode='42501';
  end if;
  if v_topup.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    raise exception 'checkout_session_mismatch' using errcode='22023';
  end if;
  if v_topup.amount_usd_cents<>p_amount_usd_cents
    or v_event.amount_usd_cents is distinct from p_amount_usd_cents then
    raise exception 'checkout_amount_mismatch' using errcode='22023';
  end if;
  if lower(p_currency)<>'usd' or v_event.currency is distinct from 'usd' then
    raise exception 'checkout_currency_mismatch' using errcode='22023';
  end if;
  if p_stripe_payment_intent_id is null or pg_catalog.length(p_stripe_payment_intent_id)<3 then
    raise exception 'payment_intent_required' using errcode='22023';
  end if;
  if v_topup.livemode<>p_livemode then raise exception 'checkout_mode_mismatch' using errcode='22023'; end if;
  if v_topup.stripe_payment_intent_id is not null
    and v_topup.stripe_payment_intent_id<>p_stripe_payment_intent_id then
    raise exception 'payment_intent_mismatch' using errcode='22023';
  end if;
  if v_topup.usd_to_bdag_rate<>private.stripe_bdag_per_usd()
    or v_topup.bdag_amount<>round(v_topup.amount_usd_cents::numeric*private.stripe_bdag_per_usd()/100,8) then
    raise exception 'stripe_topup_economic_snapshot_invalid' using errcode='22023';
  end if;

  if v_topup.financial_transaction_id is not null then
    if v_topup.credit_stripe_event_id is distinct from p_stripe_event_id
      or v_topup.stripe_payment_intent_id is distinct from p_stripe_payment_intent_id then
      raise exception 'stripe_credit_replay_conflict' using errcode='23505';
    end if;
    select la.balance into v_new_balance from public.ledger_accounts la
    where la.owner_id=v_topup.owner_id and la.account_type='user' and la.currency='BDAG';
    return jsonb_build_object(
      'success',true,'idempotent',true,'topup_id',v_topup.id,
      'financial_transaction_id',v_topup.financial_transaction_id,
      'bdag_credited',v_topup.bdag_amount,'new_balance',coalesce(v_new_balance,0)
    );
  end if;

  if v_topup.status not in ('created','checkout_open','paid') then
    raise exception 'stripe_credit_state_invalid' using errcode='55000';
  end if;
  v_account_id:=public.ensure_ledger_account(v_topup.owner_id);
  if v_account_id is null then raise exception 'ledger_account_not_found'; end if;
  v_transaction_id:=gen_random_uuid();

  insert into public.financial_transactions(
    id,idempotency_key,operation_type,from_account_id,to_account_id,
    amount,fee_amount,currency,status,reference_type,reference_id,initiated_by
  ) values(
    v_transaction_id,'stripe:bdag:'||v_topup.id::text,'deposit',null,v_account_id,
    v_topup.bdag_amount,0,'BDAG','completed','stripe_bdag_topup',v_topup.id::text,v_topup.owner_id
  );
  v_new_balance:=public.ledger_credit(
    v_transaction_id,v_account_id,v_topup.bdag_amount,
    'Stripe-hosted USD to BDAG top-up',
    jsonb_build_object('reference_type','stripe_bdag_topup','topup_id',v_topup.id)
  );
  update private.stripe_bdag_topups
  set status='credited',stripe_payment_intent_id=p_stripe_payment_intent_id,
      credit_stripe_event_id=p_stripe_event_id,financial_transaction_id=v_transaction_id,
      paid_at=coalesce(paid_at,now()),credited_at=now(),updated_at=now()
  where id=v_topup.id;
  return jsonb_build_object(
    'success',true,'idempotent',false,'topup_id',v_topup.id,
    'financial_transaction_id',v_transaction_id,
    'bdag_credited',v_topup.bdag_amount,'new_balance',v_new_balance
  );
end;
$$;

create or replace function public.apply_stripe_bdag_adjustment(
  p_stripe_event_id text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event private.stripe_webhook_events%rowtype;
  v_topup private.stripe_bdag_topups%rowtype;
  v_account_id uuid;
  v_account_balance numeric;
  v_required numeric;
  v_target numeric;
  v_delta numeric;
  v_transaction_id uuid;
  v_operation text;
  v_kind text;
  v_new_status text;
  v_applied_delta numeric := 0;
  v_current_dispute_rank integer;
  v_incoming_dispute_rank integer;
begin
  select * into v_event from private.stripe_webhook_events e
  where e.stripe_event_id=p_stripe_event_id for update;
  if not found or v_event.topup_id is null then
    raise exception 'stripe_adjustment_event_not_bound' using errcode='P0002';
  end if;
  if v_event.livemode then raise exception 'stripe_mode_mismatch' using errcode='22023'; end if;
  if v_event.event_type not in (
    'charge.refunded','charge.dispute.created','charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated','charge.dispute.closed'
  ) then raise exception 'stripe_adjustment_event_invalid' using errcode='22023'; end if;
  if v_event.adjustment_status in ('applied','not_required','stale') then
    return jsonb_build_object('success',true,'idempotent',true,'status',v_event.adjustment_status,
      'financial_transaction_id',v_event.financial_transaction_id);
  end if;

  select * into v_topup from private.stripe_bdag_topups t where t.id=v_event.topup_id for update;
  if not found then raise exception 'topup_not_found' using errcode='P0002'; end if;
  if v_event.stripe_payment_intent_id is null
    or (v_topup.stripe_payment_intent_id is not null
      and v_topup.stripe_payment_intent_id is distinct from v_event.stripe_payment_intent_id) then
    raise exception 'stripe_adjustment_payment_intent_mismatch' using errcode='22023';
  end if;
  if v_event.currency is distinct from 'usd' or v_event.amount_usd_cents is null
    or v_event.amount_usd_cents<0 or v_event.amount_usd_cents>v_topup.amount_usd_cents then
    raise exception 'stripe_adjustment_amount_invalid' using errcode='22023';
  end if;

  if v_event.event_type='charge.refunded' then
    if v_topup.refund_event_created_at is not null
      and v_event.provider_created_at<v_topup.refund_event_created_at then
      update private.stripe_webhook_events set adjustment_kind='refund',adjustment_status='stale',
        adjustment_target_bdag=v_topup.refund_required_bdag,adjustment_delta_bdag=0
      where stripe_event_id=p_stripe_event_id;
      return jsonb_build_object('success',true,'idempotent',false,'status','stale');
    end if;
    update private.stripe_bdag_topups
    set refunded_usd_cents=greatest(refunded_usd_cents,v_event.amount_usd_cents),
        refund_required_bdag=case when financial_transaction_id is null then 0
          else greatest(refund_required_bdag,round(v_event.amount_usd_cents::numeric*usd_to_bdag_rate/100,8)) end,
        refund_event_created_at=greatest(coalesce(refund_event_created_at,v_event.provider_created_at),v_event.provider_created_at),
        status=case when financial_transaction_id is null then 'requires_review' else status end,
        updated_at=now()
    where id=v_topup.id;
    v_kind:='refund';
  else
    v_current_dispute_rank:=case v_topup.dispute_status
      when 'opened' then 1 when 'funds_withdrawn' then 2
      when 'won' then 3 when 'lost' then 3 else 0 end;
    v_incoming_dispute_rank:=case v_event.event_type
      when 'charge.dispute.created' then 1
      when 'charge.dispute.funds_withdrawn' then 2
      else 3 end;
    if v_topup.dispute_status in ('won','lost') then
      update private.stripe_webhook_events set adjustment_kind='dispute',adjustment_status='stale',
        adjustment_target_bdag=v_topup.dispute_required_bdag,adjustment_delta_bdag=0
      where stripe_event_id=p_stripe_event_id;
      return jsonb_build_object('success',true,'idempotent',false,'status','stale');
    end if;
    if v_topup.dispute_event_created_at is not null
      and (v_event.provider_created_at<v_topup.dispute_event_created_at
        or (v_event.provider_created_at=v_topup.dispute_event_created_at
          and v_incoming_dispute_rank<=v_current_dispute_rank)) then
      update private.stripe_webhook_events set adjustment_kind='dispute',adjustment_status='stale',
        adjustment_target_bdag=v_topup.dispute_required_bdag,adjustment_delta_bdag=0
      where stripe_event_id=p_stripe_event_id;
      return jsonb_build_object('success',true,'idempotent',false,'status','stale');
    end if;
    if v_event.event_type='charge.dispute.created' then
      update private.stripe_bdag_topups set dispute_status='opened',disputed_usd_cents=v_event.amount_usd_cents,
        dispute_event_created_at=v_event.provider_created_at,status='requires_review',updated_at=now()
      where id=v_topup.id;
    elsif v_event.event_type='charge.dispute.funds_withdrawn' then
      update private.stripe_bdag_topups set dispute_status='funds_withdrawn',
        disputed_usd_cents=v_event.amount_usd_cents,
        dispute_required_bdag=case when financial_transaction_id is null then 0
          else round(v_event.amount_usd_cents::numeric*usd_to_bdag_rate/100,8) end,
        dispute_event_created_at=v_event.provider_created_at,status='requires_review',updated_at=now()
      where id=v_topup.id;
    elsif v_event.event_type='charge.dispute.funds_reinstated'
      or (v_event.event_type='charge.dispute.closed' and v_event.provider_status='won') then
      update private.stripe_bdag_topups set dispute_status='won',disputed_usd_cents=v_event.amount_usd_cents,
        dispute_required_bdag=0,dispute_event_created_at=v_event.provider_created_at,updated_at=now()
      where id=v_topup.id;
    elsif v_event.event_type='charge.dispute.closed' and v_event.provider_status='lost' then
      update private.stripe_bdag_topups set dispute_status='lost',disputed_usd_cents=v_event.amount_usd_cents,
        dispute_required_bdag=case when financial_transaction_id is null then 0
          else round(v_event.amount_usd_cents::numeric*usd_to_bdag_rate/100,8) end,
        dispute_event_created_at=v_event.provider_created_at,status='requires_review',updated_at=now()
      where id=v_topup.id;
    else
      raise exception 'stripe_dispute_status_unsupported' using errcode='22023';
    end if;
    v_kind:=case when v_event.event_type='charge.dispute.funds_reinstated'
      or v_event.provider_status='won' then 'dispute_reinstatement' else 'dispute' end;
  end if;

  select * into v_topup from private.stripe_bdag_topups t where t.id=v_event.topup_id for update;
  v_required:=v_topup.refund_required_bdag+v_topup.dispute_required_bdag;
  v_delta:=v_required-v_topup.reversed_bdag_amount;
  v_target:=v_required;
  if v_topup.financial_transaction_id is null then
    update private.stripe_webhook_events
    set adjustment_kind=v_kind,adjustment_target_bdag=v_target,adjustment_delta_bdag=0,
        adjustment_status='not_required'
    where stripe_event_id=p_stripe_event_id;
    return jsonb_build_object('success',true,'idempotent',false,'status','not_required','money_moved',false);
  end if;

  if v_delta>0 then
    v_account_id:=public.ensure_ledger_account(v_topup.owner_id);
    select a.balance into v_account_balance from public.ledger_accounts a
    where a.id=v_account_id and not a.frozen for update;
    if v_account_balance is null or v_account_balance<v_delta then
      update private.stripe_bdag_topups set status='requires_review',
        reversal_pending_reason='insufficient_funds',updated_at=now() where id=v_topup.id;
      update private.stripe_webhook_events set adjustment_kind=v_kind,
        adjustment_target_bdag=v_target,adjustment_delta_bdag=v_delta,
        adjustment_status='pending_insufficient_funds'
      where stripe_event_id=p_stripe_event_id;
      return jsonb_build_object('success',false,'pending',true,'reason','pending_insufficient_funds',
        'pending_bdag',v_delta,'money_moved',false);
    end if;
    v_transaction_id:=gen_random_uuid();
    v_applied_delta:=v_delta;
    v_operation:=case when v_kind='refund' then 'stripe_bdag_refund_reversal'
      else 'stripe_bdag_dispute_reversal' end;
    insert into public.financial_transactions(
      id,idempotency_key,operation_type,from_account_id,to_account_id,amount,fee_amount,
      currency,status,reference_type,reference_id,initiated_by
    ) values(
      v_transaction_id,'stripe:adjustment:'||p_stripe_event_id,v_operation,v_account_id,null,
      v_delta,0,'BDAG','completed','stripe_bdag_topup_adjustment',p_stripe_event_id,v_topup.owner_id
    );
    perform public.ledger_debit(v_transaction_id,v_account_id,v_delta,
      'Stripe provider BDAG reversal',jsonb_build_object('topup_id',v_topup.id,'stripe_event_id',p_stripe_event_id));
    update private.stripe_bdag_topups set reversed_bdag_amount=v_required,
      reversal_pending_reason=null,updated_at=now() where id=v_topup.id;
  elsif v_delta<0 then
    v_delta:=abs(v_delta);
    v_applied_delta:=v_delta;
    v_account_id:=public.ensure_ledger_account(v_topup.owner_id);
    v_transaction_id:=gen_random_uuid();
    v_operation:='stripe_bdag_dispute_reinstatement';
    insert into public.financial_transactions(
      id,idempotency_key,operation_type,from_account_id,to_account_id,amount,fee_amount,
      currency,status,reference_type,reference_id,initiated_by
    ) values(
      v_transaction_id,'stripe:adjustment:'||p_stripe_event_id,v_operation,null,v_account_id,
      v_delta,0,'BDAG','completed','stripe_bdag_topup_adjustment',p_stripe_event_id,v_topup.owner_id
    );
    perform public.ledger_credit(v_transaction_id,v_account_id,v_delta,
      'Stripe dispute reinstatement',jsonb_build_object('topup_id',v_topup.id,'stripe_event_id',p_stripe_event_id));
    update private.stripe_bdag_topups set reversed_bdag_amount=v_required,
      reversal_pending_reason=null,updated_at=now() where id=v_topup.id;
  end if;

  select * into v_topup from private.stripe_bdag_topups t where t.id=v_event.topup_id for update;
  v_new_status:=case
    when v_topup.dispute_status in ('opened','funds_withdrawn','lost') then 'requires_review'
    when v_topup.refunded_usd_cents=v_topup.amount_usd_cents then 'refunded'
    when v_topup.refunded_usd_cents>0 then 'partially_refunded'
    else 'credited' end;
  update private.stripe_bdag_topups set status=v_new_status,updated_at=now() where id=v_topup.id;
  update private.stripe_webhook_events
  set adjustment_kind=v_kind,adjustment_target_bdag=v_target,
      adjustment_delta_bdag=v_applied_delta,
      adjustment_status=case when v_transaction_id is null then 'not_required' else 'applied' end,
      financial_transaction_id=v_transaction_id
  where stripe_event_id=p_stripe_event_id;
  return jsonb_build_object('success',true,'idempotent',false,
    'status',case when v_transaction_id is null then 'not_required' else 'applied' end,
    'financial_transaction_id',v_transaction_id,'money_moved',v_transaction_id is not null,
    'topup_status',v_new_status);
end;
$$;

create or replace function public.reconcile_stripe_bdag_finance()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with adjustment_totals as (
  select e.topup_id,
    coalesce(sum(case
      when f.operation_type in ('stripe_bdag_refund_reversal','stripe_bdag_dispute_reversal') then f.amount
      when f.operation_type='stripe_bdag_dispute_reinstatement' then -f.amount
      else 0 end),0)::numeric reversed
  from private.stripe_webhook_events e
  join public.financial_transactions f on f.id=e.financial_transaction_id
  group by e.topup_id
), findings as (
  select
    (select count(*) from private.stripe_bdag_topups t
      where t.status in ('credited','partially_refunded','refunded') and t.financial_transaction_id is null) credited_without_financial_transaction,
    (select count(*) from public.financial_transactions f
      left join private.stripe_bdag_topups t on t.id::text=f.reference_id
      where f.reference_type='stripe_bdag_topup'
        and (t.id is null or f.id is distinct from t.financial_transaction_id)) stripe_transaction_without_topup,
    (select count(*) from private.stripe_bdag_topups t
      join public.financial_transactions f on f.id=t.financial_transaction_id
      left join public.ledger_accounts a on a.id=f.to_account_id
      where f.amount<>t.bdag_amount or f.fee_amount<>0 or f.currency<>'BDAG' or f.status<>'completed'
        or f.operation_type<>'deposit' or f.reference_type is distinct from 'stripe_bdag_topup'
        or f.reference_id is distinct from t.id::text or f.idempotency_key is distinct from 'stripe:bdag:'||t.id::text
        or f.initiated_by is distinct from t.owner_id or f.from_account_id is not null
        or a.id is null or a.owner_id is distinct from t.owner_id
        or a.account_type<>'user' or a.currency<>'BDAG') topup_transaction_amount_mismatch,
    (select count(*) from private.stripe_bdag_topups t
      join public.financial_transactions f on f.id=t.financial_transaction_id
      where (select count(*) from public.ledger_entries e where e.txn_id=t.financial_transaction_id
          and e.entry_type='credit' and e.amount=t.bdag_amount and e.account_id=f.to_account_id)<>1
        or (select count(*) from public.ledger_entries e where e.txn_id=t.financial_transaction_id)<>1) missing_credit_ledger_entry,
    (select count(*) from private.stripe_webhook_events w
      join private.stripe_bdag_topups t on t.id=w.topup_id
      join public.financial_transactions f on f.id=w.financial_transaction_id
      left join public.ledger_accounts a on a.id=case
        when f.operation_type='stripe_bdag_dispute_reinstatement' then f.to_account_id
        else f.from_account_id end
      where w.adjustment_status='applied' and (
        f.amount is distinct from w.adjustment_delta_bdag or f.fee_amount<>0
        or f.currency<>'BDAG' or f.status<>'completed'
        or f.reference_type is distinct from 'stripe_bdag_topup_adjustment'
        or f.reference_id is distinct from w.stripe_event_id
        or f.idempotency_key is distinct from 'stripe:adjustment:'||w.stripe_event_id
        or f.initiated_by is distinct from t.owner_id
        or (w.adjustment_kind='refund' and f.operation_type<>'stripe_bdag_refund_reversal')
        or (w.adjustment_kind='dispute' and f.operation_type<>'stripe_bdag_dispute_reversal')
        or (w.adjustment_kind='dispute_reinstatement' and f.operation_type<>'stripe_bdag_dispute_reinstatement')
        or (f.operation_type='stripe_bdag_dispute_reinstatement' and (f.from_account_id is not null or f.to_account_id is null))
        or (f.operation_type<>'stripe_bdag_dispute_reinstatement' and (f.from_account_id is null or f.to_account_id is not null))
        or a.id is null or a.owner_id is distinct from t.owner_id
        or a.account_type<>'user' or a.currency<>'BDAG'
      )) adjustment_transaction_authority_mismatch,
    (select count(*) from private.stripe_webhook_events w
      join public.financial_transactions f on f.id=w.financial_transaction_id
      where (select count(*) from public.ledger_entries e where e.txn_id=f.id
          and e.amount=f.amount
          and e.entry_type=case when f.operation_type='stripe_bdag_dispute_reinstatement' then 'credit' else 'debit' end
          and e.account_id=case when f.operation_type='stripe_bdag_dispute_reinstatement'
            then f.to_account_id else f.from_account_id end)<>1
        or (select count(*) from public.ledger_entries e where e.txn_id=f.id)<>1) missing_adjustment_ledger_entry,
    (select count(*) from private.stripe_webhook_events e
      join private.stripe_bdag_topups t on t.id=e.topup_id
      where (e.stripe_checkout_session_id is not null and e.stripe_checkout_session_id is distinct from t.stripe_checkout_session_id)
         or (e.stripe_payment_intent_id is not null and t.stripe_payment_intent_id is not null
             and e.stripe_payment_intent_id is distinct from t.stripe_payment_intent_id)) webhook_linked_to_wrong_topup,
    (select count(*) from private.stripe_webhook_events e
      where e.status not in ('processed','ignored')) unresolved_webhook_event,
    (select coalesce(sum(x.c-1),0) from (select count(*) c from private.stripe_bdag_topups
      where stripe_payment_intent_id is not null group by stripe_payment_intent_id having count(*)>1) x) duplicate_payment_intent,
    (select coalesce(sum(x.c-1),0) from (select count(*) c from private.stripe_bdag_topups
      where stripe_checkout_session_id is not null group by stripe_checkout_session_id having count(*)>1) x) duplicate_checkout_session,
    (select (select count(*) from private.stripe_customers where livemode)
      +(select count(*) from private.stripe_bdag_topups where livemode)
      +(select count(*) from private.stripe_webhook_events where livemode)) test_live_mismatch,
    (select count(*) from private.stripe_bdag_topups t left join adjustment_totals a on a.topup_id=t.id
      where t.reversed_bdag_amount<>coalesce(a.reversed,0)) refund_reversal_amount_mismatch,
    (select count(*) from private.stripe_bdag_topups t
      where t.pending_reversal_bdag>0
         or t.reversed_bdag_amount<>t.refund_required_bdag+t.dispute_required_bdag) economically_unreconciled_refund_or_dispute,
    (select count(*) from private.stripe_bdag_topups t
      where t.reversal_pending_reason='insufficient_funds' and t.pending_reversal_bdag>0) pending_reversal_insufficient_funds,
    (select count(*) from private.stripe_bdag_topups t
      where t.usd_to_bdag_rate<>private.stripe_bdag_per_usd()
         or t.bdag_amount<>round(t.amount_usd_cents::numeric*private.stripe_bdag_per_usd()/100,8)) snapshot_formula_mismatch,
    (select count(*) from private.stripe_bdag_topups t
      where (t.status='credited' and (t.refunded_usd_cents>0 or t.dispute_status in ('opened','funds_withdrawn','lost')))
         or (t.status='refunded' and t.refunded_usd_cents<>t.amount_usd_cents)
         or (t.status='partially_refunded' and (t.refunded_usd_cents<=0 or t.refunded_usd_cents>=t.amount_usd_cents))) impossible_credited_status,
    (select count(*) from public.financial_transactions f
      left join private.stripe_webhook_events e on e.financial_transaction_id=f.id
      where f.reference_type='stripe_bdag_topup_adjustment' and e.stripe_event_id is null) orphan_adjustment_transaction
)
select jsonb_build_object(
  'credited_without_financial_transaction',credited_without_financial_transaction,
  'stripe_transaction_without_topup',stripe_transaction_without_topup,
  'topup_transaction_amount_mismatch',topup_transaction_amount_mismatch,
  'missing_credit_ledger_entry',missing_credit_ledger_entry,
  'adjustment_transaction_authority_mismatch',adjustment_transaction_authority_mismatch,
  'missing_adjustment_ledger_entry',missing_adjustment_ledger_entry,
  'webhook_linked_to_wrong_topup',webhook_linked_to_wrong_topup,
  'unresolved_webhook_event',unresolved_webhook_event,
  'duplicate_payment_intent',duplicate_payment_intent,
  'duplicate_checkout_session',duplicate_checkout_session,
  'test_live_mismatch',test_live_mismatch,
  'refund_reversal_amount_mismatch',refund_reversal_amount_mismatch,
  'economically_unreconciled_refund_or_dispute',economically_unreconciled_refund_or_dispute,
  'pending_reversal_insufficient_funds',pending_reversal_insufficient_funds,
  'snapshot_formula_mismatch',snapshot_formula_mismatch,
  'impossible_credited_status',impossible_credited_status,
  'orphan_adjustment_transaction',orphan_adjustment_transaction
) from findings;
$$;

alter function public.manage_stripe_bdag_adapter(text,jsonb) owner to postgres;
alter function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) owner to postgres;
alter function public.apply_stripe_bdag_adjustment(text) owner to postgres;
alter function public.reconcile_stripe_bdag_finance() owner to postgres;

revoke all on function public.manage_stripe_bdag_adapter(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_stripe_bdag_adapter(text,jsonb) to service_role;
revoke all on function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) to service_role;
revoke all on function public.apply_stripe_bdag_adjustment(text) from public,anon,authenticated,service_role;
grant execute on function public.apply_stripe_bdag_adjustment(text) to service_role;
revoke all on function public.reconcile_stripe_bdag_finance() from public,anon,authenticated,service_role;
grant execute on function public.reconcile_stripe_bdag_finance() to service_role;

comment on function private.stripe_bdag_per_usd() is
  'Immutable Stripe test top-up economic authority: 100 BDAG per USD.';
comment on function public.apply_stripe_bdag_adjustment(text) is
  'Service-role-only exact-once Stripe refund/dispute adjustment through the canonical Nelyon ledger.';
comment on function public.reconcile_stripe_bdag_finance() is
  'Read-only Stripe provider-to-ledger integrity reconciliation.';

commit;
