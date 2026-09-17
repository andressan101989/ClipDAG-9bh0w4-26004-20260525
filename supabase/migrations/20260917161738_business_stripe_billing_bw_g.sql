-- BW-G: Stripe is a private provider adapter; canonical balance and money
-- movement remain public.ledger_accounts / financial_transactions / ledger_entries.

create table private.stripe_customers (
  owner_id uuid not null references public.user_profiles(id) on delete restrict,
  livemode boolean not null,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, livemode),
  unique (livemode, stripe_customer_id),
  check (length(stripe_customer_id) between 3 and 255)
);

create table private.stripe_bdag_topups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.user_profiles(id) on delete restrict,
  actor_id uuid not null references public.user_profiles(id) on delete restrict,
  amount_usd_cents bigint not null check (amount_usd_cents between 50 and 99999999),
  usd_to_bdag_rate numeric(20,8) not null check (usd_to_bdag_rate > 0),
  bdag_amount numeric(38,8) not null check (bdag_amount > 0),
  status text not null default 'created' check (status in (
    'created','checkout_open','paid','credited','failed','expired','requires_review'
  )),
  livemode boolean not null,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) between 16 and 255),
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_checkout_url text,
  stripe_payment_intent_id text unique,
  financial_transaction_id uuid unique references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  credited_at timestamptz,
  unique (owner_id, idempotency_key)
);

create index stripe_bdag_topups_owner_created_idx
  on private.stripe_bdag_topups (owner_id, created_at desc);
create index stripe_bdag_topups_customer_idx
  on private.stripe_bdag_topups (livemode, stripe_customer_id)
  where stripe_customer_id is not null;

create table private.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  livemode boolean not null,
  payload_hash text not null check (length(payload_hash) between 32 and 255),
  topup_id uuid references private.stripe_bdag_topups(id) on delete restrict,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','ignored','error')),
  error_code text
);

create index stripe_webhook_events_topup_idx
  on private.stripe_webhook_events (topup_id, received_at desc)
  where topup_id is not null;

alter table private.stripe_customers enable row level security;
alter table private.stripe_customers force row level security;
alter table private.stripe_bdag_topups enable row level security;
alter table private.stripe_bdag_topups force row level security;
alter table private.stripe_webhook_events enable row level security;
alter table private.stripe_webhook_events force row level security;

revoke all on table private.stripe_customers from public, anon, authenticated;
revoke all on table private.stripe_bdag_topups from public, anon, authenticated;
revoke all on table private.stripe_webhook_events from public, anon, authenticated;
grant all on table private.stripe_customers to service_role;
grant all on table private.stripe_bdag_topups to service_role;
grant all on table private.stripe_webhook_events to service_role;

create or replace function public.get_my_business_billing_overview(
  p_business_owner_id uuid,
  p_limit integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,20),1),100);
  v_balance numeric := 0;
  v_topups jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'authentication_required' using errcode='28000';
  end if;
  if p_business_owner_id is null or not private.business_actor_has_capability(
    p_business_owner_id,'business.finance.read'
  ) then
    raise exception 'business_capability_required' using errcode='42501';
  end if;

  select coalesce(la.balance,0)
  into v_balance
  from public.ledger_accounts la
  where la.owner_id=p_business_owner_id
    and la.account_type='user'
    and la.currency='BDAG';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'status',t.status,
    'amount_usd_cents',t.amount_usd_cents,
    'bdag_amount',t.bdag_amount,
    'created_at',t.created_at,
    'credited_at',t.credited_at
  ) order by t.created_at desc,t.id desc),'[]'::jsonb)
  into v_topups
  from (
    select s.id,s.status,s.amount_usd_cents,s.bdag_amount,s.created_at,s.credited_at
    from private.stripe_bdag_topups s
    where s.owner_id=p_business_owner_id
    order by s.created_at desc,s.id desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'business_owner_id',p_business_owner_id,
    'bdag_balance',coalesce(v_balance,0),
    'stripe',jsonb_build_object(
      'available',false,
      'mode','test',
      'topups',v_topups
    )
  );
end;
$$;

-- One enumerated service-role adapter keeps all private provider state out of
-- the Data API while avoiding broad table grants to the browser.
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
  v_url text;
  v_hash text;
  v_status text;
  v_error text;
  v_existing private.stripe_bdag_topups%rowtype;
  v_event private.stripe_webhook_events%rowtype;
begin
  if p_action='prepare_checkout' then
    v_owner_id := (p_payload->>'owner_id')::uuid;
    v_actor_id := (p_payload->>'actor_id')::uuid;
    v_amount := (p_payload->>'amount_usd_cents')::bigint;
    v_rate := (p_payload->>'usd_to_bdag_rate')::numeric;
    v_bdag := (p_payload->>'bdag_amount')::numeric;
    v_key := (p_payload->>'idempotency_key')::uuid;
    v_fingerprint := p_payload->>'request_fingerprint';
    v_livemode := (p_payload->>'livemode')::boolean;

    if v_owner_id is null or v_actor_id is null or v_owner_id<>v_actor_id then
      raise exception 'business_owner_required' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.marketplace_sellers s
      where s.user_id=v_owner_id and s.status='approved'
    ) then
      raise exception 'approved_business_owner_required' using errcode='42501';
    end if;
    if v_amount<50 or v_amount>99999999 or v_rate<=0 or v_bdag<=0 then
      raise exception 'invalid_topup_amount' using errcode='22023';
    end if;

    insert into private.stripe_bdag_topups(
      owner_id,actor_id,amount_usd_cents,usd_to_bdag_rate,bdag_amount,
      livemode,idempotency_key,request_fingerprint
    ) values (
      v_owner_id,v_actor_id,v_amount,v_rate,v_bdag,
      v_livemode,v_key,v_fingerprint
    ) on conflict (owner_id,idempotency_key) do nothing;

    select * into v_existing
    from private.stripe_bdag_topups t
    where t.owner_id=v_owner_id and t.idempotency_key=v_key
    for update;

    if v_existing.request_fingerprint<>v_fingerprint
      or v_existing.amount_usd_cents<>v_amount
      or v_existing.livemode<>v_livemode then
      raise exception 'idempotency_conflict' using errcode='23505';
    end if;

    select c.stripe_customer_id into v_customer
    from private.stripe_customers c
    where c.owner_id=v_owner_id and c.livemode=v_livemode;

    return jsonb_build_object(
      'topup_id',v_existing.id,
      'status',v_existing.status,
      'stripe_customer_id',coalesce(v_existing.stripe_customer_id,v_customer),
      'stripe_checkout_session_id',v_existing.stripe_checkout_session_id,
      'checkout_url',v_existing.stripe_checkout_url,
      'amount_usd_cents',v_existing.amount_usd_cents,
      'bdag_amount',v_existing.bdag_amount,
      'reused',v_existing.stripe_checkout_session_id is not null
    );
  elsif p_action='bind_checkout' then
    v_topup_id := (p_payload->>'topup_id')::uuid;
    v_owner_id := (p_payload->>'owner_id')::uuid;
    v_livemode := (p_payload->>'livemode')::boolean;
    v_customer := p_payload->>'stripe_customer_id';
    v_session := p_payload->>'stripe_checkout_session_id';
    v_url := p_payload->>'checkout_url';

    select * into v_existing
    from private.stripe_bdag_topups t
    where t.id=v_topup_id
    for update;
    if not found or v_existing.owner_id<>v_owner_id or v_existing.livemode<>v_livemode then
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
    values(v_owner_id,v_livemode,v_customer)
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
    v_event_id := p_payload->>'stripe_event_id';
    v_event_type := p_payload->>'event_type';
    v_livemode := (p_payload->>'livemode')::boolean;
    v_hash := p_payload->>'payload_hash';
    v_topup_id := nullif(p_payload->>'topup_id','')::uuid;
    v_session := nullif(p_payload->>'stripe_checkout_session_id','');
    v_payment_intent := nullif(p_payload->>'stripe_payment_intent_id','');

    insert into private.stripe_webhook_events(
      stripe_event_id,event_type,livemode,payload_hash,topup_id
    ) values(v_event_id,v_event_type,v_livemode,v_hash,v_topup_id)
    on conflict(stripe_event_id) do nothing;

    select * into v_event
    from private.stripe_webhook_events e
    where e.stripe_event_id=v_event_id
    for update;
    if v_event.event_type<>v_event_type or v_event.livemode<>v_livemode or v_event.payload_hash<>v_hash then
      raise exception 'webhook_event_conflict' using errcode='23505';
    end if;
    if v_event.status in ('processed','ignored') then
      return jsonb_build_object('already_processed',true,'status',v_event.status,'topup_id',v_event.topup_id);
    end if;

    if v_topup_id is null and v_session is not null then
      select t.id into v_topup_id from private.stripe_bdag_topups t
      where t.stripe_checkout_session_id=v_session;
    end if;
    if v_topup_id is null and v_payment_intent is not null then
      select t.id into v_topup_id from private.stripe_bdag_topups t
      where t.stripe_payment_intent_id=v_payment_intent;
    end if;
    update private.stripe_webhook_events set topup_id=v_topup_id where stripe_event_id=v_event_id;

    if v_event_type in ('checkout.session.async_payment_failed','checkout.session.expired')
      and v_topup_id is not null then
      update private.stripe_bdag_topups
      set status=case when v_event_type='checkout.session.expired' then 'expired' else 'failed' end,
          updated_at=now()
      where id=v_topup_id and status in ('created','checkout_open','paid');
    elsif v_event_type in ('charge.refunded','charge.dispute.created')
      and v_topup_id is not null then
      update private.stripe_bdag_topups
      set status='requires_review',updated_at=now()
      where id=v_topup_id;
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
    where stripe_event_id=v_event_id;
    if not found then raise exception 'webhook_event_not_found' using errcode='P0002'; end if;
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
  v_account_id uuid;
  v_transaction_id uuid;
  v_new_balance numeric;
begin
  select * into v_topup
  from private.stripe_bdag_topups t
  where t.id=p_topup_id
  for update;
  if not found then raise exception 'topup_not_found' using errcode='P0002'; end if;

  if not exists (
    select 1 from private.stripe_webhook_events e
    where e.stripe_event_id=p_stripe_event_id
      and e.livemode=p_livemode
      and e.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
  ) then
    raise exception 'verified_success_event_required' using errcode='42501';
  end if;
  if v_topup.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    raise exception 'checkout_session_mismatch' using errcode='22023';
  end if;
  if v_topup.amount_usd_cents<>p_amount_usd_cents then
    raise exception 'checkout_amount_mismatch' using errcode='22023';
  end if;
  if lower(p_currency)<>'usd' then
    raise exception 'checkout_currency_mismatch' using errcode='22023';
  end if;
  if p_stripe_payment_intent_id is null or pg_catalog.length(p_stripe_payment_intent_id)<3 then
    raise exception 'payment_intent_required' using errcode='22023';
  end if;
  if v_topup.livemode<>p_livemode then
    raise exception 'checkout_mode_mismatch' using errcode='22023';
  end if;
  if v_topup.stripe_payment_intent_id is not null
    and v_topup.stripe_payment_intent_id<>p_stripe_payment_intent_id then
    raise exception 'payment_intent_mismatch' using errcode='22023';
  end if;
  if v_topup.bdag_amount<=0 then
    raise exception 'invalid_bdag_amount' using errcode='22023';
  end if;

  if v_topup.financial_transaction_id is not null then
    select la.balance into v_new_balance
    from public.ledger_accounts la
    where la.owner_id=v_topup.owner_id and la.account_type='user';
    return jsonb_build_object(
      'success',true,'idempotent',true,'topup_id',v_topup.id,
      'financial_transaction_id',v_topup.financial_transaction_id,
      'bdag_credited',v_topup.bdag_amount,'new_balance',coalesce(v_new_balance,0)
    );
  end if;

  v_account_id := public.ensure_ledger_account(v_topup.owner_id);
  if v_account_id is null then raise exception 'ledger_account_not_found'; end if;
  v_transaction_id := gen_random_uuid();

  insert into public.financial_transactions(
    id,idempotency_key,operation_type,from_account_id,to_account_id,
    amount,fee_amount,currency,status,reference_type,reference_id,initiated_by
  ) values(
    v_transaction_id,'stripe:bdag:'||v_topup.id::text,'deposit',null,v_account_id,
    v_topup.bdag_amount,0,'BDAG','completed','stripe_bdag_topup',v_topup.id::text,v_topup.owner_id
  );

  v_new_balance := public.ledger_credit(
    v_transaction_id,v_account_id,v_topup.bdag_amount,
    'Stripe-hosted USD to BDAG top-up',
    jsonb_build_object('reference_type','stripe_bdag_topup','topup_id',v_topup.id)
  );

  update private.stripe_bdag_topups
  set status='credited',stripe_payment_intent_id=p_stripe_payment_intent_id,
      financial_transaction_id=v_transaction_id,paid_at=coalesce(paid_at,now()),
      credited_at=now(),updated_at=now()
  where id=v_topup.id;

  return jsonb_build_object(
    'success',true,'idempotent',false,'topup_id',v_topup.id,
    'financial_transaction_id',v_transaction_id,
    'bdag_credited',v_topup.bdag_amount,'new_balance',v_new_balance
  );
end;
$$;

revoke all on function public.get_my_business_billing_overview(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_my_business_billing_overview(uuid,integer) to authenticated;

revoke all on function public.manage_stripe_bdag_adapter(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_stripe_bdag_adapter(text,jsonb) to service_role;

revoke all on function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) to service_role;

comment on table private.stripe_customers is 'Private Stripe customer mapping only; never a balance authority.';
comment on table private.stripe_bdag_topups is 'Private Stripe provider reconciliation state; canonical balance remains ledger_accounts.';
comment on table private.stripe_webhook_events is 'Minimal Stripe webhook replay/audit metadata; full provider payloads and card data are never stored.';
comment on function public.get_my_business_billing_overview(uuid,integer) is 'Capability-scoped Business billing projection with no provider identifiers.';
comment on function public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean) is 'Service-role-only exact-once Stripe provider credit into the canonical Nelyon ledger.';
