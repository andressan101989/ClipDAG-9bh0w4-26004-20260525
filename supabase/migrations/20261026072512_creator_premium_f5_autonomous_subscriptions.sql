begin;

-- Explicit consent only: there is deliberately no INSERT/SELECT backfill.
create table private.creator_premium_auto_renewal_mandates (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.user_profiles(id),
  creator_id uuid not null references public.user_profiles(id),
  plan_key text not null,
  plan_id uuid not null references private.creator_premium_plans(id),
  plan_version integer not null check (plan_version>0),
  authorized_price_bdag numeric(38,8) not null check (authorized_price_bdag>0),
  currency text not null check (currency='BDAG'),
  billing_period_days integer not null check (billing_period_days between 1 and 365),
  current_period_id uuid not null references private.creator_premium_subscription_periods(id),
  generation integer not null default 1 check (generation>0),
  state text not null check (state in ('ENABLED','PAUSED','REVOKED')),
  consented_at timestamptz not null,
  revoked_at timestamptz,
  due_at timestamptz not null,
  next_attempt_at timestamptz,
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  last_result text,
  last_attempt_at timestamptz,
  unique(subscriber_id,creator_id,plan_key),
  check (subscriber_id<>creator_id),
  check ((state='ENABLED' and next_attempt_at is not null and retry_count<3 and revoked_at is null)
    or (state<>'ENABLED' and next_attempt_at is null))
);
create index creator_premium_auto_renewal_due_idx on private.creator_premium_auto_renewal_mandates(next_attempt_at,id)
  where state='ENABLED';

-- Also records immutable consent snapshots, revocations and pauses. No raw
-- exceptions, JWTs or provider payloads enter this append-only journal.
create table private.creator_premium_auto_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references private.creator_premium_auto_renewal_mandates(id),
  generation integer not null,
  due_at timestamptz not null,
  attempt_number integer not null check (attempt_number between 0 and 3),
  command_id uuid,
  outcome text not null check (outcome in ('consented','revoked','renewed','adopted','cancelled','refunded',
    'insufficient_balance','retryable_failure','plan_changed','safety_blocked','finance_unavailable','account_unavailable','binding_invalid')),
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.creator_premium_auto_renewal_mandates owner to postgres;
alter table private.creator_premium_auto_renewal_attempts owner to postgres;
alter table private.creator_premium_auto_renewal_mandates enable row level security;
alter table private.creator_premium_auto_renewal_mandates force row level security;
alter table private.creator_premium_auto_renewal_attempts enable row level security;
alter table private.creator_premium_auto_renewal_attempts force row level security;
revoke all on private.creator_premium_auto_renewal_mandates,private.creator_premium_auto_renewal_attempts
  from public,anon,authenticated,service_role;

create function private.creator_premium_auto_renewal_append_only_f5_v1()
returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='creator_premium_auto_renewal_append_only'; end;
$$;
create trigger creator_premium_auto_renewal_append_only before update or delete or truncate
  on private.creator_premium_auto_renewal_attempts for each statement
  execute function private.creator_premium_auto_renewal_append_only_f5_v1();

create function private.creator_premium_auto_renewal_projection_f5_v1(p_mandate_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('enabled',coalesce(m.state='ENABLED',false),'mandate_state',m.state,
    'consented_at',m.consented_at,'revoked_at',m.revoked_at,
    'next_charge_at',case when m.state='ENABLED' then m.next_attempt_at else null end,
    'authorized_price_bdag',m.authorized_price_bdag::numeric(38,8)::text,
    'authorized_plan_version',m.plan_version,'retry_count',coalesce(m.retry_count,0),
    'last_result',m.last_result,'last_attempt_at',m.last_attempt_at)
  from (select 1) anchor left join private.creator_premium_auto_renewal_mandates m on m.id=p_mandate_id;
$$;

create function private.record_creator_premium_auto_renewal_f5_v1(p_mandate_id uuid,p_outcome text,p_command_id uuid default null)
returns void language sql security definer set search_path='' as $$
  insert into private.creator_premium_auto_renewal_attempts(mandate_id,generation,due_at,attempt_number,command_id,outcome,snapshot)
  select id,generation,due_at,retry_count,p_command_id,p_outcome,
    jsonb_build_object('plan_id',plan_id,'plan_version',plan_version,'price_bdag',authorized_price_bdag::text,
      'currency',currency,'billing_period_days',billing_period_days,'current_period_id',current_period_id)
  from private.creator_premium_auto_renewal_mandates where id=p_mandate_id;
$$;

-- Preserve reviewed F4 financial bodies, including the durable command journal.
-- The wrappers establish family-before-row ordering for every caller.
alter function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text) set schema private;
alter function private.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text) rename to subscribe_creator_premium_plan_f4_v1;
revoke all on function private.subscribe_creator_premium_plan_f4_v1(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.subscribe_creator_premium_plan_v1(p_subscriber_id uuid,p_plan_id uuid,p_idempotency_key uuid,p_client_contract text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_plan private.creator_premium_plans;
begin
  select * into v_plan from private.creator_premium_plans where id=p_plan_id;
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-plan-version:'||v_plan.creator_id::text||':'||v_plan.plan_key,0));
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-subscription-family|'||p_subscriber_id::text||'|'||v_plan.creator_id::text||'|'||v_plan.plan_key,0));
  return private.subscribe_creator_premium_plan_f4_v1(p_subscriber_id,p_plan_id,p_idempotency_key,p_client_contract);
end;
$$;

create function public.set_creator_premium_auto_renewal_v1(
  p_subscriber_id uuid,p_subscription_id uuid,p_enabled boolean,p_expected_price_bdag numeric,
  p_expected_plan_version integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_subscription private.creator_premium_subscriptions;
  v_plan private.creator_premium_plans;
  v_period private.creator_premium_subscription_periods;
  v_mandate private.creator_premium_auto_renewal_mandates;
  v_command public.idempotency_keys;
  v_fingerprint text;
  v_response jsonb;
begin
  -- p_subscriber_id is supplied exclusively by the trusted JWT-verifying Edge
  -- path. ACL excludes authenticated/anon, as for the existing charge RPC.
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_subscription_id is null or p_enabled is null
     or p_idempotency_key is null or p_idempotency_key!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='creator_premium_auto_renewal_invalid_input';
  end if;
  v_fingerprint:=md5(jsonb_build_array(p_subscriber_id,p_subscription_id,p_enabled,p_expected_price_bdag,p_expected_plan_version)::text);
  select * into v_subscription from private.creator_premium_subscriptions where id=p_subscription_id and subscriber_id=p_subscriber_id;
  if not found then raise exception using errcode='P0002',message='creator_premium_subscription_not_found'; end if;
  select * into strict v_plan from private.creator_premium_plans where id=v_subscription.plan_id;
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-plan-version:'||v_plan.creator_id::text||':'||v_plan.plan_key,0));
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-subscription-family|'||p_subscriber_id::text||'|'||v_plan.creator_id::text||'|'||v_plan.plan_key,0));
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-auto-renewal-command|'||p_subscriber_id::text||'|'||p_idempotency_key,0));
  select * into v_command from public.idempotency_keys where idempotency_key=p_idempotency_key
    and user_id=p_subscriber_id and operation_type='creator_premium_auto_renewal_command';
  if found then
    if v_command.request_hash is distinct from v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_auto_renewal_idempotency_conflict';
    end if;
    return v_command.response_body||jsonb_build_object('replayed',true);
  end if;
  select * into strict v_plan from private.creator_premium_plans where id=v_subscription.plan_id for share;
  select period.* into v_period from private.creator_premium_subscription_periods period
    join private.creator_premium_plans plan on plan.id=period.plan_id
    where period.subscriber_id=p_subscriber_id and period.creator_id=v_plan.creator_id and plan.plan_key=v_plan.plan_key
    order by period.starts_at desc,period.id desc limit 1 for update of period;
  select * into v_mandate from private.creator_premium_auto_renewal_mandates
    where subscriber_id=p_subscriber_id and creator_id=v_plan.creator_id and plan_key=v_plan.plan_key for update;
  if p_enabled then
    if v_plan.status<>'active' or v_plan.price_bdag is distinct from p_expected_price_bdag
      or v_plan.version is distinct from p_expected_plan_version then
      raise exception using errcode='55000',message='creator_premium_auto_renewal_snapshot_changed';
    end if;
    if v_period.id is null or v_period.plan_id<>v_plan.id or v_period.subscription_id<>p_subscription_id
      or v_period.access_state not in ('active','expired')
      or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_period.id) then
      raise exception using errcode='55000',message='creator_premium_auto_renewal_binding_invalid';
    end if;
    insert into private.creator_premium_auto_renewal_mandates(subscriber_id,creator_id,plan_key,plan_id,plan_version,
      authorized_price_bdag,currency,billing_period_days,current_period_id,state,consented_at,due_at,next_attempt_at)
    values(p_subscriber_id,v_plan.creator_id,v_plan.plan_key,v_plan.id,v_plan.version,v_plan.price_bdag,v_plan.currency,
      v_plan.billing_period_days,v_period.id,'ENABLED',clock_timestamp(),v_period.paid_through_at,v_period.paid_through_at)
    on conflict(subscriber_id,creator_id,plan_key) do update set
      plan_id=excluded.plan_id,plan_version=excluded.plan_version,authorized_price_bdag=excluded.authorized_price_bdag,
      currency=excluded.currency,billing_period_days=excluded.billing_period_days,current_period_id=excluded.current_period_id,
      state='ENABLED',consented_at=excluded.consented_at,revoked_at=null,due_at=excluded.due_at,next_attempt_at=excluded.next_attempt_at,
      generation=private.creator_premium_auto_renewal_mandates.generation+1,retry_count=0,last_result=null,last_attempt_at=null
    returning * into v_mandate;
    perform private.record_creator_premium_auto_renewal_f5_v1(v_mandate.id,'consented',p_idempotency_key::uuid);
  elsif v_mandate.id is not null and v_mandate.state<>'REVOKED' then
    update private.creator_premium_auto_renewal_mandates set state='REVOKED',revoked_at=clock_timestamp(),
      next_attempt_at=null,last_result='revoked' where id=v_mandate.id;
    perform private.record_creator_premium_auto_renewal_f5_v1(v_mandate.id,'revoked',p_idempotency_key::uuid);
  end if;
  v_response:=jsonb_build_object('subscription_id',p_subscription_id,'auto_renewal',
    private.creator_premium_auto_renewal_projection_f5_v1(v_mandate.id),'money_moved',false,'replayed',false);
  insert into public.idempotency_keys(idempotency_key,operation_type,user_id,request_hash,status,response_body)
    values(p_idempotency_key,'creator_premium_auto_renewal_command',p_subscriber_id,v_fingerprint,'completed',v_response);
  return v_response;
end;
$$;

create function private.creator_premium_auto_renewal_command_id_f5_v1(p_mandate_id uuid,p_generation integer,p_due_at timestamptz)
returns uuid language sql immutable strict set search_path='' as $$
  select (substr(h,1,12)||'3'||substr(h,14,3)||'8'||substr(h,18))::uuid
  from (select md5('creator-premium-f5|'||p_mandate_id::text||'|'||p_generation::text||'|'||extract(epoch from p_due_at)::text) h) digest;
$$;

create function private.process_creator_premium_auto_renewals_f5_v1(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare
  v_candidate private.creator_premium_auto_renewal_mandates;
  v_m private.creator_premium_auto_renewal_mandates;
  v_plan private.creator_premium_plans;
  v_period private.creator_premium_subscription_periods;
  v_policy private.creator_premium_finance_policy;
  v_key uuid;
  v_response jsonb;
  v_outcome text;
  v_retry boolean;
  v_count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='creator_premium_auto_renewal_invalid_limit';
  end if;
  for v_candidate in select * from private.creator_premium_auto_renewal_mandates
    where state='ENABLED' and next_attempt_at<=clock_timestamp() order by next_attempt_at,id limit p_limit
  loop
    begin
    -- Nonblocking claims avoid retaining a global Finance row lock while waiting
    -- for another family in a multi-mandate batch. Row locks follow the family.
    if not pg_try_advisory_xact_lock(hashtextextended('creator-premium-plan-version:'||v_candidate.creator_id::text||':'||v_candidate.plan_key,0)) then continue; end if;
    if not pg_try_advisory_xact_lock(hashtextextended('creator-premium-subscription-family|'||v_candidate.subscriber_id::text||'|'||v_candidate.creator_id::text||'|'||v_candidate.plan_key,0)) then continue; end if;
    -- RFC 4122 name-based v3 UUID: the canonical ledger requires both the
    -- version and variant bits, not merely a UUID-shaped arbitrary MD5 digest.
    v_key:=private.creator_premium_auto_renewal_command_id_f5_v1(v_candidate.id,v_candidate.generation,v_candidate.due_at);
    if not pg_try_advisory_xact_lock(hashtextextended('creator-premium-subscription-command|'||v_candidate.subscriber_id::text||'|'||v_key::text,0)) then continue; end if;
    -- Never wait for global Finance while holding another family's rows.
    -- PostgreSQL retains these locks to the end of this bounded transaction.
    select * into v_policy from private.creator_premium_finance_policy where singleton for update nowait;
    perform 1 from private.creator_premium_finance_authorizations where id=v_policy.active_authorization_id for update nowait;
    select * into v_plan from private.creator_premium_plans where id=v_candidate.plan_id for share nowait;
    select period.* into v_period from private.creator_premium_subscription_periods period
      join private.creator_premium_plans plan on plan.id=period.plan_id
      where period.subscriber_id=v_candidate.subscriber_id and period.creator_id=v_candidate.creator_id and plan.plan_key=v_candidate.plan_key
      order by period.starts_at desc,period.id desc limit 1 for update of period nowait;
    perform 1 from private.creator_premium_subscriptions where id=v_period.subscription_id for update nowait;
    select * into v_m from private.creator_premium_auto_renewal_mandates where id=v_candidate.id for update nowait;
    if v_m.state<>'ENABLED' or v_m.generation<>v_candidate.generation or v_m.next_attempt_at>clock_timestamp() then continue; end if;
    v_count:=v_count+1;
    v_outcome:=null; v_retry:=false;
    -- Epoch representation avoids session timezone-dependent idempotency keys.
    begin
      select * into v_policy from private.creator_premium_finance_policy where singleton;
      if v_plan.id is null or v_plan.status<>'active' or v_plan.version<>v_m.plan_version
        or v_plan.price_bdag<>v_m.authorized_price_bdag or v_plan.currency<>v_m.currency
        or v_plan.billing_period_days<>v_m.billing_period_days then v_outcome:='plan_changed';
      elsif v_policy.activation_mode<>'general' or not v_policy.subscription_enabled or v_policy.platform_fee_bps<>2000 then v_outcome:='finance_unavailable';
      elsif not private.creator_premium_actor_is_age_eligible_v1(v_m.subscriber_id)
        or not private.creator_premium_actor_is_operational_v1(v_m.subscriber_id)
        or not private.creator_premium_actor_is_operational_v1(v_m.creator_id)
        or not private.creator_premium_pair_is_unblocked_v1(v_m.subscriber_id,v_m.creator_id)
        or not exists(select 1 from private.creator_premium_plan_contents map join private.creator_premium_contents content on content.id=map.content_id
          where map.plan_id=v_plan.id and content.lifecycle_status='published' and content.verification_status='passed'
          and content.access_mode in ('subscription','purchase_or_subscription')) then v_outcome:='safety_blocked';
      elsif exists(select 1 from public.ledger_accounts where currency='BDAG' and account_type='user'
        and owner_id in (v_m.subscriber_id,v_m.creator_id) and frozen) then v_outcome:='account_unavailable';
      elsif v_period.id is null or v_period.plan_id<>v_m.plan_id or v_period.access_state not in ('active','expired')
        or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_period.id) then v_outcome:='binding_invalid';
      elsif exists(select 1 from private.creator_premium_subscriptions where id=v_period.subscription_id
        and status='cancelled' and cancelled_at>=v_m.consented_at) then v_outcome:='cancelled';
      elsif v_period.paid_through_at>clock_timestamp() then
        v_outcome:='adopted';
      else
        v_response:=public.subscribe_creator_premium_plan_v1(v_m.subscriber_id,v_m.plan_id,v_key,'creator-premium-f3-v2');
        select * into strict v_period from private.creator_premium_subscription_periods where id=(v_response->>'period_id')::uuid;
        if v_period.access_state<>'active' or v_period.paid_through_at<=clock_timestamp()
          or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_period.id) then
          raise exception using errcode='23514',message='creator_premium_auto_renewal_binding_invalid';
        end if;
        v_outcome:=case when (v_response->>'money_moved')::boolean then 'renewed' else 'adopted' end;
      end if;
    exception when query_canceled then v_outcome:='retryable_failure';v_retry:=true;
      when others then
        if sqlerrm ilike '%insufficient%' then v_outcome:='insufficient_balance';v_retry:=true;
        elsif sqlstate in ('40001','40P01','55P03','57014','08000','08003','08006') then v_outcome:='retryable_failure';v_retry:=true;
        elsif sqlerrm ilike '%account%' or sqlerrm ilike '%frozen%' then v_outcome:='account_unavailable';
        elsif sqlerrm ilike '%finance%' or sqlerrm ilike '%canary%' or sqlerrm ilike '%disabled%' then v_outcome:='finance_unavailable';
        else v_outcome:='binding_invalid'; end if;
    end;
    -- Financial writes in the nested block have rolled back on failure. The
    -- outer transaction records a sanitized outcome and bounded retry state.
    update private.creator_premium_auto_renewal_mandates set retry_count=v_m.retry_count+1,
      last_result=v_outcome,last_attempt_at=clock_timestamp(),
      state=case when v_retry and v_m.retry_count<2 then 'ENABLED' else 'PAUSED' end,
      next_attempt_at=case when v_retry and v_m.retry_count<2 then clock_timestamp()+case when v_m.retry_count=0 then interval '15 minutes' else interval '1 hour' end else null end
      where id=v_m.id;
    perform private.record_creator_premium_auto_renewal_f5_v1(v_m.id,v_outcome,v_key);
    if v_outcome in ('renewed','adopted') then
      update private.creator_premium_auto_renewal_mandates set state='ENABLED',next_attempt_at=v_period.paid_through_at,
        current_period_id=v_period.id,due_at=v_period.paid_through_at,retry_count=0 where id=v_m.id;
    end if;
    exception when lock_not_available then continue;
    end;
  end loop;
  return jsonb_build_object('processed',v_count);
end;
$$;

alter function public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid) set schema private;
alter function private.cancel_creator_premium_subscription_v1(uuid,uuid,uuid) rename to cancel_creator_premium_subscription_f4_v1;
revoke all on function private.cancel_creator_premium_subscription_f4_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.cancel_creator_premium_subscription_v1(p_subscriber_id uuid,p_subscription_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_plan private.creator_premium_plans;v_subscription private.creator_premium_subscriptions;
  v_m uuid;v_response jsonb;v_command public.idempotency_keys;v_fingerprint text;
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_subscription_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_cancellation_invalid_input';
  end if;
  select plan.* into v_plan from private.creator_premium_plans plan join private.creator_premium_subscriptions subscription on subscription.plan_id=plan.id
    where subscription.id=p_subscription_id and subscription.subscriber_id=p_subscriber_id;
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-subscription-family|'||p_subscriber_id::text||'|'||v_plan.creator_id::text||'|'||v_plan.plan_key,0));
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-cancel|'||p_subscriber_id::text||'|'||p_idempotency_key::text,0));
  v_fingerprint:=private.creator_premium_request_fingerprint_v1('creator_premium_cancel_subscription',p_subscriber_id,p_subscription_id);
  select * into v_command from public.idempotency_keys where user_id=p_subscriber_id
    and operation_type='creator_premium_cancel_subscription_command' and idempotency_key=p_idempotency_key::text;
  if found then
    if v_command.request_hash is distinct from v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_cancellation_idempotency_conflict';
    end if;
    return v_command.response_body||jsonb_build_object('replayed',true,'money_moved',false)
      ||case when v_command.response_body->>'status'='cancelled'
        and not (v_command.response_body ? 'cancellation_effect')
        then jsonb_build_object('already_cancelled',true) else '{}'::jsonb end;
  end if;
  select * into v_subscription from private.creator_premium_subscriptions where id=p_subscription_id and subscriber_id=p_subscriber_id;
  if v_subscription.status='expired' and exists(select 1 from private.creator_premium_auto_renewal_mandates m
    join private.creator_premium_subscription_periods period on period.id=m.current_period_id
    join private.creator_premium_auto_renewal_attempts attempt on attempt.mandate_id=m.id
      and attempt.generation=m.generation and attempt.outcome='renewed'
      and attempt.command_id=period.idempotency_key
    join private.creator_premium_subscription_periods previous_period
      on previous_period.id=(attempt.snapshot->>'current_period_id')::uuid
      and previous_period.subscription_id=p_subscription_id
    where m.subscriber_id=p_subscriber_id and m.creator_id=v_plan.creator_id and m.plan_key=v_plan.plan_key
      and m.state='ENABLED' and period.subscription_id<>p_subscription_id
      and period.access_state='active' and period.paid_through_at>clock_timestamp()
      and private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)) then
    -- Immutable evidence ties this exact old relationship to the immediately
    -- succeeding automatic charge under this consent generation. A stale ID
    -- from a different generation cannot revoke a later explicit consent.
    v_response:=jsonb_build_object('subscription_id',p_subscription_id,'status','expired',
      'paid_through_at',v_subscription.ended_at,'money_moved',false,'replayed',false,'already_cancelled',false,
      'cancellation_effect','future_renewal_revoked_after_race');
  else
    v_response:=private.cancel_creator_premium_subscription_f4_v1(p_subscriber_id,p_subscription_id,p_idempotency_key);
    -- Pre-F5 commands have no wrapper journal. Their canonical replay receipt
    -- acknowledges the old cancellation, not authority over later consent.
    if (v_response->>'replayed')::boolean then return v_response; end if;
  end if;
  update private.creator_premium_auto_renewal_mandates set state='REVOKED',revoked_at=clock_timestamp(),next_attempt_at=null,last_result='cancelled'
    where subscriber_id=p_subscriber_id and creator_id=v_plan.creator_id and plan_key=v_plan.plan_key and state<>'REVOKED' returning id into v_m;
  if v_m is not null then perform private.record_creator_premium_auto_renewal_f5_v1(v_m,'cancelled',p_idempotency_key); end if;
  insert into public.idempotency_keys(idempotency_key,operation_type,user_id,request_hash,status,response_body)
    values(p_idempotency_key::text,'creator_premium_cancel_subscription_command',p_subscriber_id,v_fingerprint,'completed',v_response);
  return v_response;
end;
$$;

alter function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) set schema private;
alter function private.refund_creator_premium_subscription_period_v1(uuid,uuid,text) rename to refund_creator_premium_subscription_period_f4_v1;
revoke all on function private.refund_creator_premium_subscription_period_f4_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.refund_creator_premium_subscription_period_v1(p_period_id uuid,p_idempotency_key uuid,p_reason_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_period private.creator_premium_subscription_periods;v_plan private.creator_premium_plans;v_m uuid;v_response jsonb;
begin
  select * into v_period from private.creator_premium_subscription_periods where id=p_period_id;
  select * into v_plan from private.creator_premium_plans where id=v_period.plan_id;
  perform pg_advisory_xact_lock(hashtextextended('creator-premium-subscription-family|'||v_period.subscriber_id::text||'|'||v_plan.creator_id::text||'|'||v_plan.plan_key,0));
  v_response:=private.refund_creator_premium_subscription_period_f4_v1(p_period_id,p_idempotency_key,p_reason_code);
  -- A later independently paid period makes this a historical refund even if
  -- cron has not yet adopted that manual renewal into the mandate pointer.
  -- Expiry ends access, not the identity of the newer paid renewal basis.
  if not exists(select 1 from private.creator_premium_subscription_periods newer join private.creator_premium_plans plan on plan.id=newer.plan_id
    where newer.subscriber_id=v_period.subscriber_id and newer.creator_id=v_period.creator_id and plan.plan_key=v_plan.plan_key
      and newer.starts_at>v_period.starts_at and newer.access_state in ('active','expired')
      and private.creator_premium_subscription_period_fact_is_valid_f2_v1(newer.id)) then
    update private.creator_premium_auto_renewal_mandates set state='PAUSED',next_attempt_at=null,last_result='refunded'
      where subscriber_id=v_period.subscriber_id and creator_id=v_period.creator_id and plan_key=v_plan.plan_key and state='ENABLED' returning id into v_m;
    if v_m is not null then perform private.record_creator_premium_auto_renewal_f5_v1(v_m,'refunded',p_idempotency_key); end if;
  end if;
  return v_response;
end;
$$;

-- Keep the installed v1/v2 endpoints unchanged; F5 has its own exact contract.
create function public.get_my_creator_premium_subscriptions_v3(
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=private.creator_premium_subscriptions_projection_f3_v1(false,p_cursor_created_at,p_cursor_id,p_limit);
  return jsonb_set(v_result,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('auto_renewal',
    private.creator_premium_auto_renewal_projection_f5_v1(m.id)) order by ordinal)
    from jsonb_array_elements(v_result->'items') with ordinality entries(item,ordinal)
    left join private.creator_premium_plans plan on plan.id=(item->'plan'->>'id')::uuid
    left join private.creator_premium_auto_renewal_mandates m on m.subscriber_id=auth.uid()
      and m.creator_id=plan.creator_id and m.plan_key=plan.plan_key),'[]'::jsonb));
end;
$$;

alter function private.creator_premium_auto_renewal_append_only_f5_v1() owner to postgres;
alter function private.creator_premium_auto_renewal_command_id_f5_v1(uuid,integer,timestamptz) owner to postgres;
alter function private.subscribe_creator_premium_plan_f4_v1(uuid,uuid,uuid,text) owner to postgres;
alter function private.cancel_creator_premium_subscription_f4_v1(uuid,uuid,uuid) owner to postgres;
alter function private.refund_creator_premium_subscription_period_f4_v1(uuid,uuid,text) owner to postgres;
alter function private.creator_premium_auto_renewal_projection_f5_v1(uuid) owner to postgres;
alter function private.record_creator_premium_auto_renewal_f5_v1(uuid,text,uuid) owner to postgres;
alter function private.process_creator_premium_auto_renewals_f5_v1(integer) owner to postgres;
alter function public.set_creator_premium_auto_renewal_v1(uuid,uuid,boolean,numeric,integer,text) owner to postgres;
alter function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text) owner to postgres;
alter function public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid) owner to postgres;
alter function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) owner to postgres;
alter function public.get_my_creator_premium_subscriptions_v3(timestamptz,uuid,integer) owner to postgres;
revoke all on function private.creator_premium_auto_renewal_append_only_f5_v1(),
  private.creator_premium_auto_renewal_command_id_f5_v1(uuid,integer,timestamptz),
  private.creator_premium_auto_renewal_projection_f5_v1(uuid),private.record_creator_premium_auto_renewal_f5_v1(uuid,text,uuid),
  private.process_creator_premium_auto_renewals_f5_v1(integer) from public,anon,authenticated,service_role;
revoke all on function public.set_creator_premium_auto_renewal_v1(uuid,uuid,boolean,numeric,integer,text),
  public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text),public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid),
  public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_creator_premium_auto_renewal_v1(uuid,uuid,boolean,numeric,integer,text),
  public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text),public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid),
  public.refund_creator_premium_subscription_period_v1(uuid,uuid,text) to service_role;
revoke all on function public.get_my_creator_premium_subscriptions_v3(timestamptz,uuid,integer) from public,anon,service_role;
grant execute on function public.get_my_creator_premium_subscriptions_v3(timestamptz,uuid,integer) to authenticated;

select cron.schedule('creator-premium-auto-renewals-f5','*/5 * * * *',
  'select private.process_creator_premium_auto_renewals_f5_v1(25);');

commit;
