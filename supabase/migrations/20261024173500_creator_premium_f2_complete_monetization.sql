begin;

-- CREATOR-PREMIUM-F2
-- Manual renewal extends the existing B4 authority.  Each successful charge
-- owns one immutable relationship and one immutable period; terminal history
-- is never reactivated.  Finance remains fail-closed and no recurring cron is
-- introduced by this migration.

-- The shared velocity authority predates hardened empty-search-path
-- functions. Replace it in place so Premium can call it transactionally
-- after replay/no-op resolution without inheriting an unsafe caller path.
create or replace function public.check_velocity_limit(
  p_user_id uuid,
  p_operation text,
  p_amount numeric,
  p_max_ops integer,
  p_max_amount numeric,
  p_window_hours integer default 1
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_total numeric;
begin
  if p_user_id is null
     or p_operation is null
     or pg_catalog.btrim(p_operation)=''
     or pg_catalog.char_length(p_operation)>128
     or p_amount is null or p_amount<0
     or p_max_ops is null or p_max_ops<=0
     or p_max_amount is null or p_max_amount<0
     or p_window_hours is null or p_window_hours not between 1 and 168 then
    raise exception using errcode='22023',message='velocity_limit_invalid_input';
  end if;

  select coalesce(pg_catalog.sum(counter.count),0),
         coalesce(pg_catalog.sum(counter.total_amount),0)
  into v_count,v_total
  from public.velocity_counters counter
  where counter.user_id=p_user_id
    and counter.operation_type=p_operation
    and counter.window_end>v_now-pg_catalog.make_interval(hours=>p_window_hours);

  if v_count>=p_max_ops then
    insert into public.suspicious_activity_logs(
      user_id,event_type,severity,description,metadata
    ) values(
      p_user_id,'velocity_breach','medium',
      pg_catalog.format('Operation %s exceeded %s ops/window (actual: %s)',
        p_operation,p_max_ops,v_count),
      pg_catalog.jsonb_build_object(
        'operation',p_operation,'count',v_count,'limit',p_max_ops
      )
    );
    return false;
  end if;

  if p_max_amount>0 and v_total+p_amount>p_max_amount then
    insert into public.suspicious_activity_logs(
      user_id,event_type,severity,description,metadata
    ) values(
      p_user_id,'velocity_breach','medium',
      pg_catalog.format('Operation %s exceeded %s BDAG/window (actual: %s)',
        p_operation,p_max_amount,v_total),
      pg_catalog.jsonb_build_object(
        'operation',p_operation,'total',v_total,'limit',p_max_amount
      )
    );
    return false;
  end if;

  insert into public.velocity_counters as counter(
    user_id,operation_type,window_start,window_end,count,total_amount
  ) values(
    p_user_id,p_operation,pg_catalog.date_trunc('hour',v_now),
    pg_catalog.date_trunc('hour',v_now)+interval '1 hour',1,p_amount
  )
  on conflict(user_id,operation_type,window_start)
  do update set count=counter.count+1,
                total_amount=counter.total_amount+excluded.total_amount;

  return true;
end;
$$;

revoke all on function public.check_velocity_limit(uuid,text,numeric,integer,numeric,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.check_velocity_limit(uuid,text,numeric,integer,numeric,integer)
  to service_role;

alter table private.creator_premium_subscriptions
  drop constraint creator_premium_subscriptions_relationship_key;

create unique index creator_premium_subscriptions_one_open_relationship_uidx
  on private.creator_premium_subscriptions(subscriber_id,plan_id)
  where status in ('pending','active','cancelled');

create function private.creator_premium_subscription_period_fact_is_valid_f2_v1(
  p_period_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,
      period.reversal_financial_transaction_id,
      period.access_state,
      period.subscriber_id,
      period.creator_id,
      period.subscriber_account_id,
      period.creator_account_id,
      period.platform_account_id,
      'creator_premium_subscription_period',
      period.id,
      'creator_premium_subscription',
      'creator_premium_subscription_refund',
      period.idempotency_key,
      period.refund_idempotency_key,
      period.gross_amount_bdag,
      period.platform_fee_bdag,
      period.creator_net_bdag,
      period.platform_fee_bps
    )
    from private.creator_premium_subscription_periods period
    where period.id=p_period_id
  ),false);
$$;

revoke all on function private.creator_premium_subscription_period_fact_is_valid_f2_v1(uuid)
  from public,anon,authenticated,service_role;

-- B4 returned numeric JSON values for the purchase receipt.  JavaScript
-- cannot preserve PostgreSQL numeric(38,8), so F2 keeps the same authority
-- and transaction semantics while serializing every money value as an exact
-- eight-decimal string at the RPC boundary.
create or replace function public.purchase_creator_premium_content_v1(
  p_buyer_id uuid,
  p_content_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_policy private.creator_premium_finance_policy;
  v_content private.creator_premium_contents;
  v_offer private.creator_premium_offer_versions;
  v_existing private.creator_premium_purchase_receipts;
  v_receipt_id uuid := gen_random_uuid();
  v_charge record;
  v_velocity_allowed boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_buyer_id is null or p_content_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_purchase_invalid_input';
  end if;

  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_purchase',p_buyer_id,p_content_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-purchase|'||p_buyer_id::text||'|'||p_idempotency_key::text,
    0
  ));

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id=p_buyer_id
    and receipt.idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_purchase_idempotency_conflict';
    end if;
    if v_existing.access_state='active'
       and not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode='23514',message='creator_premium_purchase_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id',v_existing.id,
      'content_id',v_existing.content_id,
      'financial_transaction_id',v_existing.financial_transaction_id,
      'gross_amount_bdag',v_existing.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing.creator_net_bdag::numeric(38,8)::text,
      'access_state',v_existing.access_state,
      'already_owned',v_existing.access_state='active',
      'money_moved',false,
      'replayed',true
    );
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true
  for share;
  if not found or not v_policy.purchase_enabled then
    raise exception using errcode='55000',message='creator_premium_purchase_disabled';
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(p_buyer_id) then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_buyer_id) then
    raise exception using errcode='42501',message='creator_premium_buyer_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status<>'published' then
    raise exception using errcode='55000',message='creator_premium_content_not_published';
  end if;
  if v_content.access_mode not in ('purchase','purchase_or_subscription') then
    raise exception using errcode='55000',message='creator_premium_purchase_access_mode_invalid';
  end if;
  if p_buyer_id=v_content.creator_id then
    raise exception using errcode='42501',message='creator_premium_self_purchase_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_buyer_id,v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;

  select offer.* into v_offer
  from private.creator_premium_offer_versions offer
  where offer.content_id=v_content.id
    and offer.creator_id=v_content.creator_id
    and offer.status='active'
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_active_offer_not_found';
  end if;
  if v_offer.currency<>'BDAG' then
    raise exception using errcode='23514',message='creator_premium_offer_currency_invalid';
  end if;

  select receipt.* into v_existing
  from private.creator_premium_purchase_receipts receipt
  where receipt.buyer_id=p_buyer_id
    and receipt.content_id=p_content_id
    and receipt.access_state='active'
  for update;
  if found then
    if not private.creator_premium_purchase_binding_is_valid_v1(v_existing.id) then
      raise exception using errcode='23514',message='creator_premium_purchase_financial_binding_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id',v_existing.id,
      'content_id',v_existing.content_id,
      'financial_transaction_id',v_existing.financial_transaction_id,
      'gross_amount_bdag',v_existing.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing.creator_net_bdag::numeric(38,8)::text,
      'access_state',v_existing.access_state,
      'already_owned',true,
      'money_moved',false,
      'replayed',false
    );
  end if;

  -- Count only a command that can create a new charge. Exact-key replays and
  -- already-owned no-ops returned above never consume velocity headroom.
  -- The actor/operation advisory lock closes the read/upsert race inside the
  -- shared canonical velocity authority.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-velocity|creator_premium_purchase|'||p_buyer_id::text,
    0
  ));
  begin
    select public.check_velocity_limit(
      p_buyer_id,'creator_premium_purchase',v_offer.price_bdag,100,0,1
    ) into v_velocity_allowed;
  exception when others then
    raise exception using errcode='55000',message='creator_premium_velocity_check_unavailable';
  end;
  if v_velocity_allowed is distinct from true then
    raise exception using errcode='55000',message='creator_premium_rate_limited';
  end if;

  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_buyer_id,v_content.creator_id,
    'creator_premium_purchase','creator_premium_purchase_receipt',
    v_receipt_id,p_idempotency_key,v_offer.price_bdag,v_policy.platform_fee_bps
  ) charge;

  insert into private.creator_premium_purchase_receipts(
    id,buyer_id,creator_id,content_id,offer_version_id,
    financial_transaction_id,idempotency_key,request_fingerprint,
    gross_amount_bdag,platform_fee_bdag,creator_net_bdag,platform_fee_bps,
    buyer_account_id,creator_account_id,platform_account_id,
    access_state,purchased_at,activated_at
  ) values(
    v_receipt_id,p_buyer_id,v_content.creator_id,v_content.id,v_offer.id,
    v_charge.financial_transaction_id,p_idempotency_key,v_fingerprint,
    v_charge.gross_amount_bdag,v_charge.platform_fee_bdag,
    v_charge.creator_net_bdag,v_policy.platform_fee_bps,
    v_charge.payer_account_id,v_charge.creator_account_id,v_charge.platform_account_id,
    'active',v_now,v_now
  );

  return pg_catalog.jsonb_build_object(
    'receipt_id',v_receipt_id,
    'content_id',v_content.id,
    'financial_transaction_id',v_charge.financial_transaction_id,
    'gross_amount_bdag',v_charge.gross_amount_bdag::numeric(38,8)::text,
    'platform_fee_bdag',v_charge.platform_fee_bdag::numeric(38,8)::text,
    'creator_net_bdag',v_charge.creator_net_bdag::numeric(38,8)::text,
    'access_state','active',
    'already_owned',false,
    'money_moved',true,
    'replayed',false
  );
end;
$$;

revoke all on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid)
  to service_role;

create or replace function public.subscribe_creator_premium_plan_v1(
  p_subscriber_id uuid,
  p_plan_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_command public.idempotency_keys;
  v_policy private.creator_premium_finance_policy;
  v_plan private.creator_premium_plans;
  v_existing private.creator_premium_subscriptions;
  v_existing_period private.creator_premium_subscription_periods;
  v_subscription_id uuid := gen_random_uuid();
  v_period_id uuid := gen_random_uuid();
  v_charge record;
  v_velocity_allowed boolean;
  v_response jsonb;
  v_now timestamptz;
  v_paid_through timestamptz;
  v_renewed boolean := false;
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_subscriber_id is null or p_plan_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_subscription_invalid_input';
  end if;

  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription',p_subscriber_id,p_plan_id
  );

  -- The request lock and canonical command journal make every result durable,
  -- including a no-money no-op while an already-paid period is still valid.
  -- Therefore replaying that key after expiry can never become a new charge.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-command|'||p_subscriber_id::text||'|'||p_idempotency_key::text,
    0
  ));
  select journal.* into v_command
  from public.idempotency_keys journal
  where journal.idempotency_key=p_idempotency_key::text
    and journal.operation_type='creator_premium_subscription_command'
    and journal.user_id=p_subscriber_id
  for update;
  if found then
    if v_command.request_hash is distinct from v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_idempotency_conflict';
    end if;
    if v_command.status<>'completed' or v_command.response_body is null then
      raise exception using errcode='55000',message='creator_premium_subscription_idempotency_in_progress';
    end if;
    return v_command.response_body||pg_catalog.jsonb_build_object(
      'money_moved',false,
      'replayed',true
    );
  end if;

  -- B4 predates the F2 command journal.  Recover an exact historical charge
  -- by its immutable period key before a terminal relationship can be
  -- mistaken for a renewal.  This both prevents a constraint-shaped error
  -- and backfills a durable replay response without moving money.
  select period.* into v_existing_period
  from private.creator_premium_subscription_periods period
  where period.subscriber_id=p_subscriber_id
    and period.idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing_period.plan_id<>p_plan_id
       or v_existing_period.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_idempotency_conflict';
    end if;
    if not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_existing_period.id) then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;
    select subscription.* into v_existing
    from private.creator_premium_subscriptions subscription
    where subscription.id=v_existing_period.subscription_id
      and subscription.subscriber_id=p_subscriber_id
      and subscription.plan_id=p_plan_id
    for update;
    if not found then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;
    v_response := pg_catalog.jsonb_build_object(
      'subscription_id',v_existing.id,
      'period_id',v_existing_period.id,
      'plan_id',p_plan_id,
      'financial_transaction_id',v_existing_period.financial_transaction_id,
      'gross_amount_bdag',v_existing_period.gross_amount_bdag::numeric(38,8)::text,
      'platform_fee_bdag',v_existing_period.platform_fee_bdag::numeric(38,8)::text,
      'creator_net_bdag',v_existing_period.creator_net_bdag::numeric(38,8)::text,
      'billing_period_days',v_existing_period.billing_period_days,
      'starts_at',v_existing_period.starts_at,
      'paid_through_at',v_existing_period.paid_through_at,
      'status','active',
      'already_subscribed',false,
      'renewed',false,
      'auto_renew',false,
      'money_moved',false,
      'replayed',true
    );
    insert into public.idempotency_keys(
      idempotency_key,operation_type,user_id,request_hash,status,response_body
    ) values(
      p_idempotency_key::text,'creator_premium_subscription_command',
      p_subscriber_id,v_fingerprint,'completed',v_response
    );
    return v_response;
  end if;

  insert into public.idempotency_keys(
    idempotency_key,operation_type,user_id,request_hash,status
  ) values(
    p_idempotency_key::text,'creator_premium_subscription_command',
    p_subscriber_id,v_fingerprint,'processing'
  );

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true
  for share;
  if not found or not v_policy.subscription_enabled then
    raise exception using errcode='55000',message='creator_premium_subscription_disabled';
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(p_subscriber_id) then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(p_subscriber_id) then
    raise exception using errcode='42501',message='creator_premium_subscriber_account_restricted';
  end if;

  -- Resolve the immutable family identity, then share the exact advisory
  -- protocol used by version activation.  Different request keys and plan
  -- versions in one family therefore cannot create overlapping paid access.
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id=p_plan_id;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_active_plan_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-plan-version:'||v_plan.creator_id::text||':'||v_plan.plan_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-family|'||p_subscriber_id::text||'|'||
      v_plan.creator_id::text||'|'||v_plan.plan_key,
    0
  ));
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id=p_plan_id
  for share;
  if not found or v_plan.status<>'active' then
    raise exception using errcode='P0002',message='creator_premium_active_plan_not_found';
  end if;
  if v_plan.currency<>'BDAG' or v_plan.billing_period_days not between 1 and 365 then
    raise exception using errcode='23514',message='creator_premium_plan_financial_identity_invalid';
  end if;
  if p_subscriber_id=v_plan.creator_id then
    raise exception using errcode='42501',message='creator_premium_self_subscription_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_plan.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(p_subscriber_id,v_plan.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;
  if not exists(
    select 1
    from private.creator_premium_plan_contents grant_map
    join private.creator_premium_contents content
      on content.id=grant_map.content_id
     and content.creator_id=grant_map.creator_id
    where grant_map.plan_id=v_plan.id
      and grant_map.creator_id=v_plan.creator_id
      and content.lifecycle_status='published'
      and content.access_mode in ('subscription','purchase_or_subscription')
  ) then
    raise exception using errcode='23514',message='creator_premium_plan_has_no_valid_content';
  end if;

  -- Read the open relationship across every immutable version of the family,
  -- then acquire mutable locks in the same period -> relationship order used
  -- by the refund authority.
  select subscription.* into v_existing
  from private.creator_premium_subscriptions subscription
  join private.creator_premium_plans family_plan
    on family_plan.id=subscription.plan_id
   and family_plan.creator_id=subscription.creator_id
  where subscription.subscriber_id=p_subscriber_id
    and subscription.creator_id=v_plan.creator_id
    and family_plan.plan_key=v_plan.plan_key
    and subscription.status in ('pending','active','cancelled')
  order by subscription.created_at desc,subscription.id desc
  limit 1;

  if found then
    select period.* into v_existing_period
    from private.creator_premium_subscription_periods period
    where period.subscription_id=v_existing.id
      and period.subscriber_id=p_subscriber_id
      and period.plan_id=v_existing.plan_id
    order by period.paid_through_at desc,period.id desc
    limit 1
    for update;
    if not found then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;

    select subscription.* into v_existing
    from private.creator_premium_subscriptions subscription
    where subscription.id=v_existing.id
      and subscription.subscriber_id=p_subscriber_id
      and subscription.plan_id=v_existing.plan_id
    for update;
    if not found or v_existing.status not in ('active','cancelled') then
      raise exception using errcode='23514',message='creator_premium_subscription_state_invalid';
    end if;
    if v_existing_period.access_state not in ('active','expired')
       or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_existing_period.id) then
      raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
    end if;

    v_now := pg_catalog.clock_timestamp();
    if v_existing_period.access_state='active'
       and v_existing_period.paid_through_at>v_now then
      if v_existing.plan_id<>v_plan.id then
        raise exception using errcode='55000',message='creator_premium_plan_family_access_active';
      end if;
      v_response := pg_catalog.jsonb_build_object(
        'subscription_id',v_existing.id,
        'period_id',v_existing_period.id,
        'plan_id',v_plan.id,
        'financial_transaction_id',v_existing_period.financial_transaction_id,
        'gross_amount_bdag',v_existing_period.gross_amount_bdag::text,
        'platform_fee_bdag',v_existing_period.platform_fee_bdag::text,
        'creator_net_bdag',v_existing_period.creator_net_bdag::text,
        'billing_period_days',v_existing_period.billing_period_days,
        'starts_at',v_existing_period.starts_at,
        'paid_through_at',v_existing_period.paid_through_at,
        'status',v_existing.status,
        'already_subscribed',true,
        'renewed',false,
        'auto_renew',false,
        'money_moved',false,
        'replayed',false
      );
      update public.idempotency_keys
      set status='completed',response_body=v_response,updated_at=v_now
      where idempotency_key=p_idempotency_key::text
        and operation_type='creator_premium_subscription_command'
        and user_id=p_subscriber_id;
      if not found then
        raise exception using errcode='23514',message='creator_premium_subscription_idempotency_journal_missing';
      end if;
      return v_response;
    end if;

    if v_existing_period.access_state='active' then
      update private.creator_premium_subscription_periods
      set access_state='expired',updated_at=v_now
      where id=v_existing_period.id and access_state='active';
      if not found then
        raise exception using errcode='40001',message='creator_premium_subscription_period_changed';
      end if;
    end if;
    update private.creator_premium_subscriptions
    set status='expired',ended_at=v_existing_period.paid_through_at,updated_at=v_now
    where id=v_existing.id and status in ('active','cancelled');
    if not found then
      raise exception using errcode='40001',message='creator_premium_subscription_state_changed';
    end if;
    v_renewed := true;
  else
    select exists(
      select 1
      from private.creator_premium_subscriptions history
      join private.creator_premium_plans history_plan
        on history_plan.id=history.plan_id
       and history_plan.creator_id=history.creator_id
      where history.subscriber_id=p_subscriber_id
        and history.creator_id=v_plan.creator_id
        and history_plan.plan_key=v_plan.plan_key
        and history.status in ('expired','revoked')
    ) into v_renewed;
    v_now := pg_catalog.clock_timestamp();
  end if;

  -- The command journal, historical-period replay and active-period no-op all
  -- return above. Only a command that will charge consumes velocity headroom.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-velocity|creator_premium_subscribe|'||p_subscriber_id::text,
    0
  ));
  begin
    select public.check_velocity_limit(
      p_subscriber_id,'creator_premium_subscribe',v_plan.price_bdag,20,0,24
    ) into v_velocity_allowed;
  exception when others then
    raise exception using errcode='55000',message='creator_premium_velocity_check_unavailable';
  end;
  if v_velocity_allowed is distinct from true then
    raise exception using errcode='55000',message='creator_premium_rate_limited';
  end if;

  v_paid_through := v_now+pg_catalog.make_interval(days=>v_plan.billing_period_days);
  select charge.* into v_charge
  from private.post_creator_premium_charge_v1(
    p_subscriber_id,v_plan.creator_id,
    'creator_premium_subscription','creator_premium_subscription_period',
    v_period_id,p_idempotency_key,v_plan.price_bdag,v_policy.platform_fee_bps
  ) charge;

  insert into private.creator_premium_subscriptions(
    id,subscriber_id,creator_id,plan_id,idempotency_key,status,started_at
  ) values(
    v_subscription_id,p_subscriber_id,v_plan.creator_id,v_plan.id,
    p_idempotency_key,'active',v_now
  );
  insert into private.creator_premium_subscription_periods(
    id,subscription_id,subscriber_id,creator_id,plan_id,
    starts_at,paid_through_at,financial_transaction_id,
    idempotency_key,request_fingerprint,billing_period_days,
    gross_amount_bdag,platform_fee_bdag,creator_net_bdag,platform_fee_bps,
    subscriber_account_id,creator_account_id,platform_account_id,access_state
  ) values(
    v_period_id,v_subscription_id,p_subscriber_id,v_plan.creator_id,v_plan.id,
    v_now,v_paid_through,v_charge.financial_transaction_id,
    p_idempotency_key,v_fingerprint,v_plan.billing_period_days,
    v_charge.gross_amount_bdag,v_charge.platform_fee_bdag,v_charge.creator_net_bdag,
    v_policy.platform_fee_bps,v_charge.payer_account_id,v_charge.creator_account_id,
    v_charge.platform_account_id,'active'
  );

  v_response := pg_catalog.jsonb_build_object(
    'subscription_id',v_subscription_id,
    'period_id',v_period_id,
    'plan_id',v_plan.id,
    'financial_transaction_id',v_charge.financial_transaction_id,
    'gross_amount_bdag',v_charge.gross_amount_bdag::text,
    'platform_fee_bdag',v_charge.platform_fee_bdag::text,
    'creator_net_bdag',v_charge.creator_net_bdag::text,
    'billing_period_days',v_plan.billing_period_days,
    'starts_at',v_now,
    'paid_through_at',v_paid_through,
    'status','active',
    'already_subscribed',v_renewed,
    'renewed',v_renewed,
    'auto_renew',false,
    'money_moved',true,
    'replayed',false
  );
  update public.idempotency_keys
  set status='completed',response_body=v_response,updated_at=pg_catalog.clock_timestamp()
  where idempotency_key=p_idempotency_key::text
    and operation_type='creator_premium_subscription_command'
    and user_id=p_subscriber_id;
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_idempotency_journal_missing';
  end if;
  return v_response;
end;
$$;

revoke all on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)
  to service_role;

create or replace function public.refund_creator_premium_subscription_period_v1(
  p_period_id uuid,
  p_idempotency_key uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period private.creator_premium_subscription_periods;
  v_subscription private.creator_premium_subscriptions;
  v_policy private.creator_premium_finance_policy;
  v_original public.financial_transactions;
  v_reason text;
  v_fingerprint text;
  v_refund_transaction_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.creator_premium_internal_finance_authority_v1() then
    raise exception using errcode='42501',message='creator_premium_internal_authority_required';
  end if;
  if p_period_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='creator_premium_subscription_refund_invalid_input';
  end if;
  v_reason := private.validate_creator_premium_refund_reason_v1(p_reason_code);
  v_fingerprint := private.creator_premium_request_fingerprint_v1(
    'creator_premium_subscription_refund',p_period_id,p_period_id,v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-subscription-refund|'||p_period_id::text||'|'||p_idempotency_key::text,
    0
  ));

  -- Period -> relationship is the canonical lock order shared with renewal.
  select period.* into v_period
  from private.creator_premium_subscription_periods period
  where period.id=p_period_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_subscription_period_not_found';
  end if;
  if v_period.access_state='refunded' then
    if v_period.refund_idempotency_key=p_idempotency_key
       and v_period.refund_request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='creator_premium_subscription_refund_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'period_id',v_period.id,
      'subscription_id',v_period.subscription_id,
      'reversal_financial_transaction_id',v_period.reversal_financial_transaction_id,
      'access_state','refunded',
      'money_moved',false,
      'replayed',v_period.refund_idempotency_key=p_idempotency_key,
      'already_refunded',true
    );
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true
  for share;
  if not found or not v_policy.refunds_enabled then
    raise exception using errcode='55000',message='creator_premium_refunds_disabled';
  end if;
  if v_period.access_state not in ('active','expired')
     or not private.creator_premium_subscription_period_fact_is_valid_f2_v1(v_period.id) then
    raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
  end if;

  select subscription.* into v_subscription
  from private.creator_premium_subscriptions subscription
  where subscription.id=v_period.subscription_id
  for update;
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_relationship_invalid';
  end if;
  select finance_tx.* into v_original
  from public.financial_transactions finance_tx
  where finance_tx.id=v_period.financial_transaction_id
  for update;

  v_refund_transaction_id := private.post_creator_premium_refund_v1(
    v_period.subscriber_id,v_period.creator_id,
    v_period.subscriber_account_id,v_period.creator_account_id,v_period.platform_account_id,
    'creator_premium_subscription_refund','creator_premium_subscription_period',
    v_period.id,p_idempotency_key,
    v_period.gross_amount_bdag,v_period.platform_fee_bdag,v_period.creator_net_bdag
  );
  update public.financial_transactions
  set status='reversed'
  where id=v_original.id and status='completed';
  if not found then
    raise exception using errcode='23514',message='creator_premium_subscription_financial_binding_invalid';
  end if;
  update private.creator_premium_subscription_periods
  set access_state='refunded',
      reversal_financial_transaction_id=v_refund_transaction_id,
      refund_idempotency_key=p_idempotency_key,
      refund_request_fingerprint=v_fingerprint,
      refund_reason_code=v_reason,
      refunded_at=v_now,
      revoked_at=v_now,
      updated_at=v_now
  where id=v_period.id;
  update private.creator_premium_subscriptions
  set status='revoked',
      ended_at=coalesce(ended_at,v_now),
      updated_at=v_now
  where id=v_period.subscription_id;

  -- Refunds are scoped to the immutable relationship for this paid period.
  -- This read-only postcondition probe makes the preservation of a later,
  -- independently paid renewal explicit without changing its lifecycle.
  perform 1
  from private.creator_premium_subscription_periods renewed_period
  where renewed_period.subscriber_id=v_period.subscriber_id
    and renewed_period.plan_id=v_period.plan_id
    and renewed_period.subscription_id <> v_period.subscription_id
    and renewed_period.access_state='active'
    and renewed_period.starts_at<=v_now
    and renewed_period.paid_through_at>v_now
    and private.creator_premium_subscription_period_fact_is_valid_f2_v1(renewed_period.id)
  limit 1;

  return pg_catalog.jsonb_build_object(
    'period_id',v_period.id,
    'subscription_id',v_period.subscription_id,
    'reversal_financial_transaction_id',v_refund_transaction_id,
    'access_state','refunded',
    'subscription_status','revoked',
    'money_moved',true,
    'replayed',false,
    'already_refunded',false
  );
exception
  when sqlstate 'P0001' then
    if sqlerrm='creator_premium_refund_source_balance_insufficient' then
      raise exception using errcode='P0001',message='creator_premium_refund_source_balance_insufficient';
    end if;
    raise;
end;
$$;

revoke all on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  to service_role;

-- Read projections use keyset-compatible indexes.  These do not create a new
-- financial authority; they only support the canonical B4/B7 fact tables.
create index creator_premium_purchase_receipts_buyer_history_f2_idx
  on private.creator_premium_purchase_receipts(buyer_id,created_at desc,id desc);
create index creator_premium_purchase_receipts_admin_history_f2_idx
  on private.creator_premium_purchase_receipts(created_at desc,id desc);
create index creator_premium_subscription_relationship_history_f2_idx
  on private.creator_premium_subscriptions(subscriber_id,plan_id,created_at desc,id desc);
create index creator_premium_subscriptions_buyer_history_f2_idx
  on private.creator_premium_subscriptions(subscriber_id,created_at desc,id desc);
create index creator_premium_subscription_periods_buyer_history_f2_idx
  on private.creator_premium_subscription_periods(subscriber_id,created_at desc,id desc);
create index creator_premium_subscription_periods_creator_history_f2_idx
  on private.creator_premium_subscription_periods(creator_id,created_at desc,id desc);
create index creator_premium_subscription_periods_admin_history_f2_idx
  on private.creator_premium_subscription_periods(created_at desc,id desc);

-- Commerce now exposes the latest immutable relationship and distinguishes a
-- first subscription from a manual renewal.  A terminal relationship is never
-- reactivated by this read path.
create or replace function public.get_creator_premium_commerce_v1(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_entitlement record;
  v_policy private.creator_premium_finance_policy;
  v_media_ready boolean := false;
  v_purchase_owned boolean := false;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode='22023',message='creator_premium_invalid_content';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id and content.lifecycle_status='published';
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor,v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;

  v_media_ready := case v_content.content_kind
    when 'image' then private.creator_premium_image_is_ready_v1(v_content.id)
    when 'video' then private.creator_premium_video_is_ready_v1(v_content.id)
    else false end;
  if not v_media_ready then
    raise exception using errcode='55000',message='creator_premium_media_unavailable';
  end if;

  select * into v_entitlement
  from private.resolve_creator_premium_entitlement_v1(v_content.id);
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  select exists(
    select 1
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id=v_actor
      and receipt.content_id=v_content.id
      and receipt.access_state='active'
      and private.creator_premium_purchase_binding_is_valid_v1(receipt.id)
  ) into v_purchase_owned;

  select pg_catalog.jsonb_build_object(
    'content',pg_catalog.jsonb_build_object(
      'id',content.id,'creator_id',content.creator_id,'title',content.title,
      'description',content.description,'content_kind',content.content_kind,
      'access_mode',content.access_mode,
      'teaser_url',private.creator_premium_teaser_url_v1(content.id),
      'published_at',content.published_at
    ),
    'creator',pg_catalog.jsonb_build_object(
      'id',content.creator_id,'username',profile.username,
      'display_name',profile.display_name,'avatar_url',profile.avatar_url
    ),
    'offer',(
      select pg_catalog.jsonb_build_object(
        'id',offer.id,'version',offer.version,'price_bdag',offer.price_bdag::text,
        'currency',offer.currency,'status',offer.status
      )
      from private.creator_premium_offer_versions offer
      where offer.content_id=content.id
        and offer.creator_id=content.creator_id
        and offer.status='active'
      order by offer.version desc,offer.id desc
      limit 1
    ),
    'plans',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',plan.id,'name',plan.name,'description',plan.description,
        'version',plan.version,'price_bdag',plan.price_bdag::text,
        'currency',plan.currency,'billing_period_days',plan.billing_period_days,
        'status',plan.status,
        'relationship',case when plan.relationship_id is null then null else
          pg_catalog.jsonb_build_object(
            'id',plan.relationship_id,'status',plan.relationship_status,
            'cancelled_at',plan.relationship_cancelled_at,
            'paid_through_at',plan.relationship_paid_through_at,
            'access_state',plan.relationship_access_state
          ) end,
        'subscription_available',v_policy.subscription_enabled
          and v_actor<>content.creator_id and plan.relationship_id is null,
        'subscription_blocker',case
          when v_actor=content.creator_id then 'creator_premium_self_subscription_forbidden'
          when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
          when plan.relationship_access_active
            and plan.relationship_plan_id<>plan.id
            then 'creator_premium_plan_family_access_active'
          when plan.relationship_id is not null then 'creator_premium_renewal_required'
          else null end,
        'renewal_available',v_policy.subscription_enabled
          and v_actor<>content.creator_id
          and plan.relationship_id is not null
          and plan.relationship_status<>'pending'
          and plan.relationship_period_id is not null
          and plan.relationship_fact_valid
          and not plan.relationship_access_active,
        'renewal_blocker',case
          when v_actor=content.creator_id then 'creator_premium_self_subscription_forbidden'
          when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
          when plan.relationship_id is null then 'creator_premium_subscription_not_found'
          when plan.relationship_status='pending' then 'creator_premium_subscription_state_invalid'
          when plan.relationship_period_id is null or not plan.relationship_fact_valid
            then 'creator_premium_subscription_financial_binding_invalid'
          when plan.relationship_access_active
            and plan.relationship_plan_id<>plan.id
            then 'creator_premium_plan_family_access_active'
          when plan.relationship_access_active then 'creator_premium_already_subscribed'
          else null end
      ) order by plan.price_bdag,plan.id)
      from (
        select active_plan.*,
          relationship.id as relationship_id,
          relationship.plan_id as relationship_plan_id,
          case when relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.paid_through_at<=v_now
            and relationship.fact_valid
            then 'expired' else relationship.status end as relationship_status,
          relationship.cancelled_at as relationship_cancelled_at,
          relationship.period_id as relationship_period_id,
          relationship.paid_through_at as relationship_paid_through_at,
          case when relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.paid_through_at<=v_now
            and relationship.fact_valid
            then 'expired' else relationship.access_state end as relationship_access_state,
          relationship.fact_valid as relationship_fact_valid,
          relationship.status in ('active','cancelled')
            and relationship.access_state='active'
            and relationship.starts_at<=v_now
            and relationship.paid_through_at>v_now
            and relationship.fact_valid as relationship_access_active
        from private.creator_premium_plan_contents mapping
        join private.creator_premium_plans active_plan
          on active_plan.id=mapping.plan_id
         and active_plan.creator_id=mapping.creator_id
        left join lateral (
          select subscription.id,subscription.plan_id,subscription.status,
            subscription.cancelled_at,
            period.id as period_id,period.starts_at,period.paid_through_at,
            period.access_state,
            private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)
              as fact_valid
          from private.creator_premium_subscriptions subscription
          join private.creator_premium_plans relationship_plan
            on relationship_plan.id=subscription.plan_id
           and relationship_plan.creator_id=subscription.creator_id
          left join lateral (
            select paid_period.*
            from private.creator_premium_subscription_periods paid_period
            where paid_period.subscription_id=subscription.id
              and paid_period.subscriber_id=subscription.subscriber_id
            order by paid_period.paid_through_at desc,paid_period.id desc
            limit 1
          ) period on true
          where subscription.subscriber_id=v_actor
            and subscription.creator_id=active_plan.creator_id
            and relationship_plan.plan_key=active_plan.plan_key
          order by subscription.created_at desc,subscription.id desc
          limit 1
        ) relationship on true
        where mapping.content_id=content.id
          and mapping.creator_id=content.creator_id
          and active_plan.status='active'
        order by active_plan.price_bdag,active_plan.id
        limit 100
      ) plan
    ),'[]'::jsonb),
    'plan_count',(
      select pg_catalog.count(*)
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans active_plan
        on active_plan.id=mapping.plan_id and active_plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id
        and mapping.creator_id=content.creator_id
        and active_plan.status='active'
    ),
    'plans_truncated',exists(
      select 1
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans active_plan
        on active_plan.id=mapping.plan_id and active_plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id
        and mapping.creator_id=content.creator_id
        and active_plan.status='active'
      order by active_plan.price_bdag,active_plan.id
      offset 100 limit 1
    ),
    'entitlement',pg_catalog.jsonb_build_object(
      'allowed',v_entitlement.allowed,'source',v_entitlement.source,
      'reason',v_entitlement.reason,'expires_at',v_entitlement.expires_at
    ),
    'operations',pg_catalog.jsonb_build_object(
      'purchase_available',v_policy.purchase_enabled
        and v_actor<>content.creator_id
        and content.access_mode in ('purchase','purchase_or_subscription')
        and not v_purchase_owned
        and exists(
          select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active'
        ),
      'purchase_blocker',case
        when v_actor=content.creator_id then 'creator_premium_self_purchase_forbidden'
        when content.access_mode not in ('purchase','purchase_or_subscription')
          then 'creator_premium_purchase_access_mode_invalid'
        when v_purchase_owned then 'creator_premium_already_owned'
        when not exists(
          select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active'
        ) then 'creator_premium_active_offer_not_found'
        when not v_policy.purchase_enabled then 'creator_premium_purchase_disabled'
        else null end
    ),
    'policy',pg_catalog.jsonb_build_object(
      'purchase_enabled',v_policy.purchase_enabled,
      'subscription_enabled',v_policy.subscription_enabled,
      'refunds_enabled',v_policy.refunds_enabled,
      'platform_fee_bps',v_policy.platform_fee_bps,
      'policy_version',v_policy.policy_version
    )
  ) into v_result
  from private.creator_premium_contents content
  left join public.public_user_profiles profile on profile.id=content.creator_id
  where content.id=v_content.id;

  return v_result;
end;
$$;

-- Every paid period owns an immutable relationship.  This projection returns
-- full history and marks only the latest relationship as renewable.
create or replace function public.get_my_creator_premium_subscriptions_v1(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_policy private.creator_premium_finance_policy;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='creator_premium_subscription_cursor_invalid';
  end if;
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  return (
    with base as (
      select
        subscription.id,subscription.creator_id,subscription.plan_id,
        subscription.status,subscription.started_at,subscription.cancelled_at,
        subscription.ended_at,subscription.created_at,subscription.updated_at,
        plan.name as plan_name,plan.description as plan_description,
        plan.version as plan_version,plan.billing_period_days,
        plan.price_bdag::text as plan_price_bdag,plan.currency,
        plan.status as plan_status,
        profile.username,profile.display_name,profile.avatar_url,
        period.id as period_id,period.starts_at,period.paid_through_at,
        period.access_state,period.gross_amount_bdag::text as gross_amount_bdag,
        private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)
          as period_fact_valid,
        not exists(
          select 1
          from private.creator_premium_subscriptions newer
          where newer.subscriber_id=subscription.subscriber_id
            and newer.plan_id=subscription.plan_id
            and (newer.created_at,newer.id)>(subscription.created_at,subscription.id)
        ) as is_latest_relationship
      from private.creator_premium_subscriptions subscription
      join private.creator_premium_plans plan
        on plan.id=subscription.plan_id and plan.creator_id=subscription.creator_id
      left join public.public_user_profiles profile on profile.id=subscription.creator_id
      left join lateral (
        select paid_period.*
        from private.creator_premium_subscription_periods paid_period
        where paid_period.subscription_id=subscription.id
          and paid_period.subscriber_id=subscription.subscriber_id
        order by paid_period.paid_through_at desc,paid_period.id desc
        limit 1
      ) period on true
      where subscription.subscriber_id=v_actor
        and (p_cursor_created_at is null
          or (subscription.created_at,subscription.id)<(p_cursor_created_at,p_cursor_id))
    ), projected as (
      select base.*,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then 'expired' else base.status end as effective_status,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then coalesce(base.ended_at,base.paid_through_at)
          else base.ended_at end as effective_ended_at,
        case when base.status in ('active','cancelled')
          and base.access_state='active'
          and base.paid_through_at<=v_now
          and base.period_fact_valid
          then 'expired' else base.access_state end as effective_access_state,
        base.status in ('active','cancelled')
          and base.access_state='active'
          and base.starts_at<=v_now
          and base.paid_through_at>v_now
          and base.period_fact_valid as access_active
      from base
    ), candidates as (
      select projected.*,
        projected.is_latest_relationship
          and v_policy.subscription_enabled
          and projected.plan_status='active'
          and projected.effective_status<>'pending'
          and projected.period_id is not null
          and projected.period_fact_valid
          and not projected.access_active as renewal_available
      from projected
      order by projected.created_at desc,projected.id desc
      limit v_limit+1
    ), page as (
      select * from candidates
      order by created_at desc,id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'policy',pg_catalog.jsonb_build_object(
        'purchase_enabled',v_policy.purchase_enabled,
        'subscription_enabled',v_policy.subscription_enabled,
        'refunds_enabled',v_policy.refunds_enabled,
        'platform_fee_bps',v_policy.platform_fee_bps,
        'policy_version',v_policy.policy_version
      ),
      'items',coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',item.id,
          'creator',pg_catalog.jsonb_build_object(
            'id',item.creator_id,'username',item.username,
            'display_name',item.display_name,'avatar_url',item.avatar_url
          ),
          'plan',pg_catalog.jsonb_build_object(
            'id',item.plan_id,'name',item.plan_name,
            'description',item.plan_description,'version',item.plan_version,
            'price_bdag',item.plan_price_bdag,'currency',item.currency,
            'billing_period_days',item.billing_period_days,'status',item.plan_status,
            'relationship',pg_catalog.jsonb_build_object(
              'id',item.id,'status',item.effective_status,
              'cancelled_at',item.cancelled_at,
              'paid_through_at',item.paid_through_at,
              'access_state',item.effective_access_state
            ),
            'subscription_available',false,
            'subscription_blocker',case when item.access_active
              then 'creator_premium_already_subscribed'
              else 'creator_premium_renewal_required' end,
            'renewal_available',item.renewal_available,
            'renewal_blocker',case
              when not item.is_latest_relationship then 'creator_premium_subscription_superseded'
              when item.plan_status<>'active' then 'creator_premium_active_plan_not_found'
              when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
              when item.effective_status='pending' then 'creator_premium_subscription_state_invalid'
              when item.period_id is null or not item.period_fact_valid
                then 'creator_premium_subscription_financial_binding_invalid'
              when item.access_active then 'creator_premium_already_subscribed'
              else null end
          ),
          'status',item.effective_status,'started_at',item.started_at,
          'cancelled_at',item.cancelled_at,'ended_at',item.effective_ended_at,
          'period',case when item.period_id is null then null else
            pg_catalog.jsonb_build_object(
              'id',item.period_id,'starts_at',item.starts_at,
              'paid_through_at',item.paid_through_at,
              'access_state',item.effective_access_state,
              'gross_amount_bdag',item.gross_amount_bdag
            ) end,
          'access_active',item.access_active,'auto_renew',false,
          'renewal_supported',true,
          'renewal_available',item.renewal_available,
          'renewal_blocker',case
            when not item.is_latest_relationship then 'creator_premium_subscription_superseded'
            when item.plan_status<>'active' then 'creator_premium_active_plan_not_found'
            when not v_policy.subscription_enabled then 'creator_premium_subscription_disabled'
            when item.effective_status='pending' then 'creator_premium_subscription_state_invalid'
            when item.period_id is null or not item.period_fact_valid
              then 'creator_premium_subscription_financial_binding_invalid'
            when item.access_active then 'creator_premium_already_subscribed'
            else null end,
          'is_latest_relationship',item.is_latest_relationship,
          'created_at',item.created_at,'updated_at',item.updated_at
        ) order by item.created_at desc,item.id desc)
        from page item
      ),'[]'::jsonb),
      'next_cursor',case when (select pg_catalog.count(*) from candidates)>v_limit then (
        select pg_catalog.jsonb_build_object('created_at',last_item.created_at,'id',last_item.id)
        from page last_item
        order by last_item.created_at,last_item.id
        limit 1
      ) else null end
    )
  );
end;
$$;

-- Buyer and creator history is derived exclusively from immutable, verified
-- receipts/periods.  Any malformed fact in the requested actor scope fails
-- closed instead of being silently omitted from the financial projection.
create or replace function public.get_my_creator_premium_financial_history_v1(
  p_perspective text default 'buyer',
  p_source text default null,
  p_cursor_event_at timestamptz default null,
  p_cursor_event_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := p_limit;
  v_policy private.creator_premium_finance_policy;
  v_integrity_failures bigint := 0;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if p_perspective not in ('buyer','creator') then
    raise exception using errcode='22023',message='creator_premium_history_perspective_invalid';
  end if;
  if p_source is not null and p_source not in ('purchase','subscription') then
    raise exception using errcode='22023',message='creator_premium_history_source_invalid';
  end if;
  if (p_cursor_event_at is null)<>(p_cursor_event_id is null) then
    raise exception using errcode='22023',message='creator_premium_history_cursor_invalid';
  end if;
  if v_limit is null or v_limit<1 or v_limit>100 then
    raise exception using errcode='22023',message='creator_premium_history_limit_invalid';
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  with purchase_facts as (
    select private.creator_premium_financial_fact_is_valid_v1(
      receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
      receipt.access_state,receipt.buyer_id,receipt.creator_id,
      receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
      'creator_premium_purchase_receipt',receipt.id,
      'creator_premium_purchase','creator_premium_purchase_refund',
      receipt.idempotency_key,receipt.refund_idempotency_key,
      receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
      receipt.platform_fee_bps
    ) as verified
    from private.creator_premium_purchase_receipts receipt
    where (p_source is null or p_source='purchase')
      and ((p_perspective='buyer' and receipt.buyer_id=v_actor)
        or (p_perspective='creator' and receipt.creator_id=v_actor))
  ), period_facts as (
    select private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,period.reversal_financial_transaction_id,
      period.access_state,period.subscriber_id,period.creator_id,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
      'creator_premium_subscription_period',period.id,
      'creator_premium_subscription','creator_premium_subscription_refund',
      period.idempotency_key,period.refund_idempotency_key,
      period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
      period.platform_fee_bps
    ) as verified
    from private.creator_premium_subscription_periods period
    where (p_source is null or p_source='subscription')
      and ((p_perspective='buyer' and period.subscriber_id=v_actor)
        or (p_perspective='creator' and period.creator_id=v_actor))
  )
  select (select pg_catalog.count(*) from purchase_facts where not verified)
       + (select pg_catalog.count(*) from period_facts where not verified)
  into v_integrity_failures;

  if v_integrity_failures>0 then
    raise exception using errcode='23514',message='creator_premium_financial_integrity_failure';
  end if;

  return (
    with purchase_facts as (
      select receipt.*,
        original.created_at as charge_created_at,
        reversal.created_at as refund_created_at,
        content.title as content_title,
        content.lifecycle_status as content_lifecycle_status
      from private.creator_premium_purchase_receipts receipt
      left join public.financial_transactions original
        on original.id=receipt.financial_transaction_id
      left join public.financial_transactions reversal
        on reversal.id=receipt.reversal_financial_transaction_id
      join private.creator_premium_contents content on content.id=receipt.content_id
      where ((p_perspective='buyer' and receipt.buyer_id=v_actor)
          or (p_perspective='creator' and receipt.creator_id=v_actor))
        and (p_source is null or p_source='purchase')
    ), period_facts as (
      select period.*,
        subscription.status as relationship_status,
        original.created_at as charge_created_at,
        reversal.created_at as refund_created_at,
        plan.name as plan_name,plan.version as plan_version,plan.status as plan_status
      from private.creator_premium_subscription_periods period
      join private.creator_premium_subscriptions subscription
        on subscription.id=period.subscription_id
       and subscription.subscriber_id=period.subscriber_id
       and subscription.creator_id=period.creator_id
       and subscription.plan_id=period.plan_id
      left join public.financial_transactions original
        on original.id=period.financial_transaction_id
      left join public.financial_transactions reversal
        on reversal.id=period.reversal_financial_transaction_id
      join private.creator_premium_plans plan
        on plan.id=period.plan_id and plan.creator_id=period.creator_id
      where ((p_perspective='buyer' and period.subscriber_id=v_actor)
          or (p_perspective='creator' and period.creator_id=v_actor))
        and (p_source is null or p_source='subscription')
    ), events as (
      select
        fact.financial_transaction_id as id,
        'purchase'::text as source,'charge'::text as event_type,
        fact.id as reference_id,null::uuid as subscription_id,
        fact.content_id,fact.content_title,fact.content_lifecycle_status,
        null::uuid as plan_id,null::text as plan_name,null::integer as plan_version,
        null::text as plan_status,
        fact.gross_amount_bdag,fact.platform_fee_bdag,fact.creator_net_bdag,
        fact.access_state,null::text as relationship_status,
        fact.charge_created_at as occurred_at,
        null::timestamptz as starts_at,null::timestamptz as paid_through_at
      from purchase_facts fact
      union all
      select
        fact.reversal_financial_transaction_id,'purchase'::text,'refund'::text,
        fact.id,null::uuid,fact.content_id,fact.content_title,
        fact.content_lifecycle_status,null::uuid,null::text,null::integer,null::text,
        fact.gross_amount_bdag,fact.platform_fee_bdag,fact.creator_net_bdag,
        fact.access_state,null::text,fact.refund_created_at,
        null::timestamptz,null::timestamptz
      from purchase_facts fact
      where fact.reversal_financial_transaction_id is not null
      union all
      select
        fact.financial_transaction_id,'subscription'::text,'charge'::text,
        fact.id,fact.subscription_id,null::uuid,null::text,null::text,
        fact.plan_id,fact.plan_name,fact.plan_version,fact.plan_status,
        fact.gross_amount_bdag,fact.platform_fee_bdag,fact.creator_net_bdag,
        fact.access_state,fact.relationship_status,fact.charge_created_at,
        fact.starts_at,fact.paid_through_at
      from period_facts fact
      union all
      select
        fact.reversal_financial_transaction_id,'subscription'::text,'refund'::text,
        fact.id,fact.subscription_id,null::uuid,null::text,null::text,
        fact.plan_id,fact.plan_name,fact.plan_version,fact.plan_status,
        fact.gross_amount_bdag,fact.platform_fee_bdag,fact.creator_net_bdag,
        fact.access_state,fact.relationship_status,fact.refund_created_at,
        fact.starts_at,fact.paid_through_at
      from period_facts fact
      where fact.reversal_financial_transaction_id is not null
    ), candidates as (
      select event.*
      from events event
      where event.id is not null and event.occurred_at is not null
        and (p_cursor_event_at is null
          or (event.occurred_at,event.id)<(p_cursor_event_at,p_cursor_event_id))
      order by event.occurred_at desc,event.id desc
      limit v_limit+1
    ), page as (
      select * from candidates
      order by occurred_at desc,id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'policy',pg_catalog.jsonb_build_object(
        'purchase_enabled',v_policy.purchase_enabled,
        'subscription_enabled',v_policy.subscription_enabled,
        'refunds_enabled',v_policy.refunds_enabled,
        'platform_fee_bps',v_policy.platform_fee_bps,
        'policy_version',v_policy.policy_version
      ),
      'settlement_model','immediate_direct_credit',
      'items',coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',item.id,'source',item.source,'event_type',item.event_type,
          'reference_id',item.reference_id,'subscription_id',item.subscription_id,
          'content',case when item.source='purchase' then pg_catalog.jsonb_build_object(
            'id',item.content_id,'title',item.content_title,
            'lifecycle_status',item.content_lifecycle_status
          ) else null end,
          'plan',case when item.source='subscription' then pg_catalog.jsonb_build_object(
            'id',item.plan_id,'name',item.plan_name,
            'version',item.plan_version,'status',item.plan_status
          ) else null end,
          'gross_amount_bdag',item.gross_amount_bdag::numeric(38,8)::text,
          'platform_fee_bdag',item.platform_fee_bdag::numeric(38,8)::text,
          'creator_net_bdag',item.creator_net_bdag::numeric(38,8)::text,
          'access_state',item.access_state,
          'relationship_status',item.relationship_status,
          'occurred_at',item.occurred_at,'starts_at',item.starts_at,
          'paid_through_at',item.paid_through_at
        ) order by item.occurred_at desc,item.id desc)
        from page item
      ),'[]'::jsonb),
      'next_cursor',case when (select pg_catalog.count(*) from candidates)>v_limit then (
        select pg_catalog.jsonb_build_object('event_at',last_item.occurred_at,'id',last_item.id)
        from page last_item
        order by last_item.occurred_at,last_item.id
        limit 1
      ) else null end
    )
  );
end;
$$;

-- Creator earnings are verified ledger-derived facts.  The canonical account
-- balance is deliberately labelled as all-BDAG activity rather than inferred
-- Premium availability, and direct-credit settlement has no pending balance.
create or replace function public.get_my_creator_premium_commercial_summary_v1(
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_from timestamptz := coalesce(p_from,pg_catalog.clock_timestamp()-interval '30 days');
  v_to timestamptz := coalesce(p_to,pg_catalog.clock_timestamp());
  v_policy private.creator_premium_finance_policy;
  v_integrity_failures bigint := 0;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if v_from>=v_to or v_to-v_from>interval '366 days' then
    raise exception using errcode='22023',message='creator_premium_summary_range_invalid';
  end if;
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  with purchase_checks as (
    select private.creator_premium_financial_fact_is_valid_v1(
      receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
      receipt.access_state,receipt.buyer_id,receipt.creator_id,
      receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
      'creator_premium_purchase_receipt',receipt.id,
      'creator_premium_purchase','creator_premium_purchase_refund',
      receipt.idempotency_key,receipt.refund_idempotency_key,
      receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
      receipt.platform_fee_bps
    ) as verified
    from private.creator_premium_purchase_receipts receipt
    where receipt.creator_id=v_actor
  ), period_checks as (
    select private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,period.reversal_financial_transaction_id,
      period.access_state,period.subscriber_id,period.creator_id,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
      'creator_premium_subscription_period',period.id,
      'creator_premium_subscription','creator_premium_subscription_refund',
      period.idempotency_key,period.refund_idempotency_key,
      period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
      period.platform_fee_bps
    ) as verified
    from private.creator_premium_subscription_periods period
    where period.creator_id=v_actor
  )
  select (select pg_catalog.count(*) from purchase_checks where not verified)
       + (select pg_catalog.count(*) from period_checks where not verified)
  into v_integrity_failures;

  if v_integrity_failures>0 then
    raise exception using errcode='23514',message='creator_premium_financial_integrity_failure';
  end if;

  with purchase_facts as (
    select receipt.*,original.created_at as charge_created_at,
      reversal.created_at as refund_created_at
    from private.creator_premium_purchase_receipts receipt
    left join public.financial_transactions original
      on original.id=receipt.financial_transaction_id
    left join public.financial_transactions reversal
      on reversal.id=receipt.reversal_financial_transaction_id
    where receipt.creator_id=v_actor
  ), period_facts as (
    select period.*,original.created_at as charge_created_at,
      reversal.created_at as refund_created_at
    from private.creator_premium_subscription_periods period
    left join public.financial_transactions original
      on original.id=period.financial_transaction_id
    left join public.financial_transactions reversal
      on reversal.id=period.reversal_financial_transaction_id
    where period.creator_id=v_actor
  ), charge_events as (
    select 'purchase'::text as source,id as reference_id,content_id,
      financial_transaction_id as transaction_id,gross_amount_bdag,
      platform_fee_bdag,creator_net_bdag,'charge'::text as event_type,
      charge_created_at as event_at
    from purchase_facts
    where charge_created_at>=v_from and charge_created_at<v_to
    union all
    select 'subscription'::text,id,null::uuid,financial_transaction_id,
      gross_amount_bdag,platform_fee_bdag,creator_net_bdag,'charge'::text,
      charge_created_at
    from period_facts
    where charge_created_at>=v_from and charge_created_at<v_to
  ), refund_events as (
    select 'purchase'::text as source,id as reference_id,content_id,
      reversal_financial_transaction_id as transaction_id,gross_amount_bdag,
      platform_fee_bdag,creator_net_bdag,'refund'::text as event_type,
      refund_created_at as event_at
    from purchase_facts
    where reversal_financial_transaction_id is not null
      and refund_created_at>=v_from and refund_created_at<v_to
    union all
    select 'subscription'::text,id,null::uuid,reversal_financial_transaction_id,
      gross_amount_bdag,platform_fee_bdag,creator_net_bdag,'refund'::text,
      refund_created_at
    from period_facts
    where reversal_financial_transaction_id is not null
      and refund_created_at>=v_from and refund_created_at<v_to
  ), all_events as (
    select * from charge_events
    union all
    select * from refund_events
  ), totals as (
    select
      coalesce((select pg_catalog.sum(gross_amount_bdag) from charge_events),0)::numeric(38,8) gross,
      coalesce((select pg_catalog.sum(platform_fee_bdag) from charge_events),0)::numeric(38,8) platform_fee,
      coalesce((select pg_catalog.sum(creator_net_bdag) from charge_events),0)::numeric(38,8) creator_net,
      coalesce((select pg_catalog.sum(gross_amount_bdag) from refund_events),0)::numeric(38,8) refund,
      coalesce((select pg_catalog.sum(creator_net_bdag) from refund_events),0)::numeric(38,8) creator_refund,
      (select pg_catalog.count(*) from charge_events where source='purchase') purchase_count,
      (select pg_catalog.count(*) from charge_events where source='subscription') subscription_period_count,
      (select pg_catalog.count(*) from refund_events) refund_count
  ), content_metrics as (
    select content.id,content.title,content.lifecycle_status,
      pg_catalog.count(fact.id) filter(
        where fact.charge_created_at>=v_from and fact.charge_created_at<v_to
      ) as purchase_sales,
      (coalesce(pg_catalog.sum(fact.creator_net_bdag) filter(
          where fact.charge_created_at>=v_from and fact.charge_created_at<v_to
        ),0)-coalesce(pg_catalog.sum(fact.creator_net_bdag) filter(
          where fact.reversal_financial_transaction_id is not null
            and fact.refund_created_at>=v_from and fact.refund_created_at<v_to
        ),0))::numeric(38,8) as purchase_net_retained
    from private.creator_premium_contents content
    left join purchase_facts fact on fact.content_id=content.id
    where content.creator_id=v_actor
    group by content.id,content.title,content.lifecycle_status
  )
  select pg_catalog.jsonb_build_object(
    'range',pg_catalog.jsonb_build_object('from',v_from,'to',v_to),
    'currency','BDAG','gross',totals.gross::text,
    'platform_fee',totals.platform_fee::text,
    'creator_net',totals.creator_net::text,'refund',totals.refund::text,
    'net_retained',(totals.creator_net-totals.creator_refund)::numeric(38,8)::text,
    'pending_bdag','0.00000000',
    'canonical_account_balance_bdag',(
      select coalesce(pg_catalog.sum(account.balance),0)::numeric(38,8)::text
      from public.ledger_accounts account
      where account.owner_id=v_actor and account.account_type='user'
        and account.currency='BDAG'
    ),
    'balance_scope','all_bdag_activity',
    'settlement_model','immediate_direct_credit',
    'integrity_failure_count',0,
    'policy',pg_catalog.jsonb_build_object(
      'purchase_enabled',v_policy.purchase_enabled,
      'subscription_enabled',v_policy.subscription_enabled,
      'refunds_enabled',v_policy.refunds_enabled,
      'platform_fee_bps',v_policy.platform_fee_bps,
      'policy_version',v_policy.policy_version
    ),
    'purchase_count',totals.purchase_count,
    'subscription_period_count',totals.subscription_period_count,
    'refund_count',totals.refund_count,
    'published_contents',(select pg_catalog.count(*)
      from private.creator_premium_contents content
      where content.creator_id=v_actor and content.lifecycle_status='published'),
    'pending_contents',(select pg_catalog.count(*)
      from private.creator_premium_contents content
      where content.creator_id=v_actor and content.lifecycle_status='pending_review'),
    'rejected_contents',(select pg_catalog.count(*)
      from private.creator_premium_contents content
      where content.creator_id=v_actor and content.lifecycle_status='rejected'),
    'active_subscription_grants',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions subscription
      where subscription.creator_id=v_actor
        and subscription.status in ('active','cancelled')
        and exists(
          select 1 from private.creator_premium_subscription_periods period
          where period.subscription_id=subscription.id
            and period.access_state='active'
            and period.starts_at<=pg_catalog.clock_timestamp()
            and period.paid_through_at>pg_catalog.clock_timestamp()
            and private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)
        )),
    'revoked_subscription_count',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions subscription
      where subscription.creator_id=v_actor and subscription.status='revoked'),
    'recent_transactions',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source',recent.source,'event_type',recent.event_type,
        'reference_id',recent.reference_id,'content_id',recent.content_id,
        'financial_transaction_id',recent.transaction_id,
        'gross_amount_bdag',recent.gross_amount_bdag::numeric(38,8)::text,
        'platform_fee_bdag',recent.platform_fee_bdag::numeric(38,8)::text,
        'creator_net_bdag',recent.creator_net_bdag::numeric(38,8)::text,
        'created_at',recent.event_at
      ) order by recent.event_at desc,recent.transaction_id desc)
      from (
        select event.* from all_events event
        order by event.event_at desc,event.transaction_id desc
        limit 50
      ) recent
    ),'[]'::jsonb),
    'content_performance',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'content_id',metric.id,'title',metric.title,
        'lifecycle_status',metric.lifecycle_status,
        'purchase_sales',metric.purchase_sales,
        'purchase_net_retained',metric.purchase_net_retained::text,
        'subscription_revenue_allocation','not_allocated'
      ) order by metric.title,metric.id)
      from content_metrics metric
    ),'[]'::jsonb),
    'views_instrumented',false
  ) into v_result
  from totals;

  return v_result;
end;
$$;

-- One bounded, read-only administrative authority exposes canonical Premium
-- facts plus reconciliation counters.  Invalid facts remain visible and are
-- explicitly marked; this function never performs a financial mutation.
create or replace function public.search_admin_creator_premium_finance_v1(
  p_source text default null,
  p_state text default null,
  p_query text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_reference_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(p_query),'');
  v_limit integer := p_limit;
  v_policy private.creator_premium_finance_policy;
  v_counts jsonb;
  v_reconciliation jsonb;
begin
  perform public.admin_require_capability('finance.ledger.read');
  if p_source is not null and p_source not in ('purchase','subscription') then
    raise exception using errcode='22023',message='creator_premium_admin_finance_source_invalid';
  end if;
  if p_state is not null
     and p_state not in ('active','expired','revoked','refunded','cancelled') then
    raise exception using errcode='22023',message='creator_premium_admin_finance_state_invalid';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query)>120 then
    raise exception using errcode='22023',message='creator_premium_admin_finance_query_invalid';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_reference_id is null) then
    raise exception using errcode='22023',message='creator_premium_admin_finance_cursor_invalid';
  end if;
  if v_limit is null or v_limit<1 or v_limit>100 then
    raise exception using errcode='22023',message='creator_premium_admin_finance_limit_invalid';
  end if;

  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  if not found then
    raise exception using errcode='23514',message='creator_premium_finance_policy_missing';
  end if;

  with purchase_checks as (
    select receipt.id,private.creator_premium_financial_fact_is_valid_v1(
      receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
      receipt.access_state,receipt.buyer_id,receipt.creator_id,
      receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
      'creator_premium_purchase_receipt',receipt.id,
      'creator_premium_purchase','creator_premium_purchase_refund',
      receipt.idempotency_key,receipt.refund_idempotency_key,
      receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
      receipt.platform_fee_bps
    ) as verified
    from private.creator_premium_purchase_receipts receipt
  ), period_checks as (
    select period.id,private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,period.reversal_financial_transaction_id,
      period.access_state,period.subscriber_id,period.creator_id,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
      'creator_premium_subscription_period',period.id,
      'creator_premium_subscription','creator_premium_subscription_refund',
      period.idempotency_key,period.refund_idempotency_key,
      period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
      period.platform_fee_bps
    ) as verified
    from private.creator_premium_subscription_periods period
  )
  select pg_catalog.jsonb_build_object(
    'purchase_receipts',(select pg_catalog.count(*)
      from private.creator_premium_purchase_receipts),
    'subscription_relationships',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions),
    'subscription_periods',(select pg_catalog.count(*)
      from private.creator_premium_subscription_periods),
    'refunds',(select pg_catalog.count(*)
      from private.creator_premium_purchase_receipts receipt
      where receipt.access_state='refunded')
      +(select pg_catalog.count(*)
        from private.creator_premium_subscription_periods period
        where period.access_state='refunded'),
    'integrity_failures',(select pg_catalog.count(*) from purchase_checks where not verified)
      +(select pg_catalog.count(*) from period_checks where not verified)
  ) into v_counts;

  with purchase_checks as (
    select private.creator_premium_financial_fact_is_valid_v1(
      receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
      receipt.access_state,receipt.buyer_id,receipt.creator_id,
      receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
      'creator_premium_purchase_receipt',receipt.id,
      'creator_premium_purchase','creator_premium_purchase_refund',
      receipt.idempotency_key,receipt.refund_idempotency_key,
      receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
      receipt.platform_fee_bps
    ) as verified
    from private.creator_premium_purchase_receipts receipt
  ), period_checks as (
    select private.creator_premium_financial_fact_is_valid_v1(
      period.financial_transaction_id,period.reversal_financial_transaction_id,
      period.access_state,period.subscriber_id,period.creator_id,
      period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
      'creator_premium_subscription_period',period.id,
      'creator_premium_subscription','creator_premium_subscription_refund',
      period.idempotency_key,period.refund_idempotency_key,
      period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
      period.platform_fee_bps
    ) as verified
    from private.creator_premium_subscription_periods period
  )
  select pg_catalog.jsonb_build_object(
    'invalid_purchase_facts',(select pg_catalog.count(*)
      from purchase_checks where not verified),
    'invalid_subscription_period_facts',(select pg_catalog.count(*)
      from period_checks where not verified),
    'subscriptions_without_period',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions relationship
      where not exists(
        select 1 from private.creator_premium_subscription_periods period
        where period.subscription_id=relationship.id
      )),
    'multiple_periods_per_relationship',(select pg_catalog.count(*)
      from (
        select period.subscription_id
        from private.creator_premium_subscription_periods period
        group by period.subscription_id
        having pg_catalog.count(*)>1
      ) multiple_periods),
    'orphan_creator_premium_transactions',(select pg_catalog.count(*)
      from public.financial_transactions finance_tx
      where finance_tx.operation_type in (
        'creator_premium_purchase','creator_premium_purchase_refund',
        'creator_premium_subscription','creator_premium_subscription_refund'
      ) and not exists(
        select 1
        from private.creator_premium_purchase_receipts receipt
        where finance_tx.reference_type='creator_premium_purchase_receipt'
          and finance_tx.reference_id=receipt.id::text
      ) and not exists(
        select 1
        from private.creator_premium_subscription_periods period
        where finance_tx.reference_type='creator_premium_subscription_period'
          and finance_tx.reference_id=period.id::text
      )),
    'duplicate_open_relationships',(select pg_catalog.count(*)
      from (
        select relationship.subscriber_id,relationship.creator_id,plan.plan_key
        from private.creator_premium_subscriptions relationship
        join private.creator_premium_plans plan
          on plan.id=relationship.plan_id
         and plan.creator_id=relationship.creator_id
        where relationship.status in ('pending','active','cancelled')
        group by relationship.subscriber_id,relationship.creator_id,plan.plan_key
        having pg_catalog.count(*)>1
      ) duplicate_relationships)
  ) into v_reconciliation;

  return (
    with facts as (
      select
        'purchase'::text as source,receipt.id as reference_id,
        receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
        receipt.content_id,content.title as content_title,
        null::uuid as plan_id,null::text as plan_name,
        receipt.buyer_id as customer_id,buyer.username as customer_username,
        buyer.display_name as customer_display_name,buyer.avatar_url as customer_avatar_url,
        receipt.creator_id,creator.username as creator_username,
        creator.display_name as creator_display_name,creator.avatar_url as creator_avatar_url,
        receipt.access_state,null::text as subscription_status,
        receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
        receipt.created_at,receipt.refunded_at,
        private.creator_premium_financial_fact_is_valid_v1(
          receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
          receipt.access_state,receipt.buyer_id,receipt.creator_id,
          receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
          'creator_premium_purchase_receipt',receipt.id,
          'creator_premium_purchase','creator_premium_purchase_refund',
          receipt.idempotency_key,receipt.refund_idempotency_key,
          receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
          receipt.platform_fee_bps
        ) as verified
      from private.creator_premium_purchase_receipts receipt
      join private.creator_premium_contents content on content.id=receipt.content_id
      left join public.public_user_profiles buyer on buyer.id=receipt.buyer_id
      left join public.public_user_profiles creator on creator.id=receipt.creator_id
      where receipt.access_state in ('active','revoked','refunded')
      union all
      select
        'subscription'::text,period.id,period.financial_transaction_id,
        period.reversal_financial_transaction_id,null::uuid,null::text,
        period.plan_id,plan.name,period.subscriber_id,
        subscriber.username,subscriber.display_name,subscriber.avatar_url,
        period.creator_id,creator.username,creator.display_name,creator.avatar_url,
        period.access_state,relationship.status,period.gross_amount_bdag,
        period.platform_fee_bdag,period.creator_net_bdag,
        period.created_at,period.refunded_at,
        private.creator_premium_financial_fact_is_valid_v1(
          period.financial_transaction_id,period.reversal_financial_transaction_id,
          period.access_state,period.subscriber_id,period.creator_id,
          period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
          'creator_premium_subscription_period',period.id,
          'creator_premium_subscription','creator_premium_subscription_refund',
          period.idempotency_key,period.refund_idempotency_key,
          period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
          period.platform_fee_bps
        )
      from private.creator_premium_subscription_periods period
      join private.creator_premium_subscriptions relationship
        on relationship.id=period.subscription_id
       and relationship.subscriber_id=period.subscriber_id
       and relationship.creator_id=period.creator_id
       and relationship.plan_id=period.plan_id
      join private.creator_premium_plans plan
        on plan.id=period.plan_id and plan.creator_id=period.creator_id
      left join public.public_user_profiles subscriber on subscriber.id=period.subscriber_id
      left join public.public_user_profiles creator on creator.id=period.creator_id
      where period.access_state in ('active','expired','revoked','refunded')
        and relationship.status in ('active','cancelled','expired','revoked')
    ), candidates as (
      select fact.*
      from facts fact
      where (p_source is null or fact.source=p_source)
        and (
          p_state is null
          or (p_state='cancelled' and fact.source='subscription'
            and fact.subscription_status='cancelled')
          or (p_state<>'cancelled' and fact.access_state=p_state)
        )
        and (v_query is null
          or fact.reference_id::text=v_query
          or coalesce(fact.content_title,'') ilike '%'||v_query||'%'
          or coalesce(fact.plan_name,'') ilike '%'||v_query||'%'
          or coalesce(fact.customer_username,'') ilike '%'||v_query||'%'
          or coalesce(fact.customer_display_name,'') ilike '%'||v_query||'%'
          or coalesce(fact.creator_username,'') ilike '%'||v_query||'%'
          or coalesce(fact.creator_display_name,'') ilike '%'||v_query||'%')
        and (p_cursor_created_at is null
          or (fact.created_at,fact.reference_id)<
             (p_cursor_created_at,p_cursor_reference_id))
      order by fact.created_at desc,fact.reference_id desc
      limit v_limit+1
    ), page as (
      select * from candidates
      order by created_at desc,reference_id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'policy',pg_catalog.jsonb_build_object(
        'purchase_enabled',v_policy.purchase_enabled,
        'subscription_enabled',v_policy.subscription_enabled,
        'refunds_enabled',v_policy.refunds_enabled,
        'platform_fee_bps',v_policy.platform_fee_bps,
        'policy_version',v_policy.policy_version
      ),
      'counts',v_counts,'reconciliation',v_reconciliation,
      'items',coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'source',item.source,'reference_id',item.reference_id,
          'financial_transaction_id',item.financial_transaction_id,
          'reversal_financial_transaction_id',item.reversal_financial_transaction_id,
          'content_id',item.content_id,'content_title',item.content_title,
          'plan_id',item.plan_id,'plan_name',item.plan_name,
          'customer',pg_catalog.jsonb_build_object(
            'id',item.customer_id,'username',item.customer_username,
            'display_name',item.customer_display_name,'avatar_url',item.customer_avatar_url
          ),
          'creator',pg_catalog.jsonb_build_object(
            'id',item.creator_id,'username',item.creator_username,
            'display_name',item.creator_display_name,'avatar_url',item.creator_avatar_url
          ),
          'access_state',item.access_state,
          'subscription_status',item.subscription_status,
          'gross_amount_bdag',item.gross_amount_bdag::numeric(38,8)::text,
          'platform_fee_bdag',item.platform_fee_bdag::numeric(38,8)::text,
          'creator_net_bdag',item.creator_net_bdag::numeric(38,8)::text,
          'currency','BDAG','created_at',item.created_at,
          'refunded_at',item.refunded_at,'verified',item.verified
        ) order by item.created_at desc,item.reference_id desc)
        from page item
      ),'[]'::jsonb),
      'next_cursor',case when (select pg_catalog.count(*) from candidates)>v_limit then (
        select pg_catalog.jsonb_build_object(
          'created_at',last_item.created_at,'reference_id',last_item.reference_id
        )
        from page last_item
        order by last_item.created_at,last_item.reference_id
        limit 1
      ) else null end
    )
  );
end;
$$;

-- Creator withdrawal closes new sales but does not erase access that was
-- already paid for.  Safety removals and deletion remain fail-closed.  For a
-- subscription, only a paid period that began before withdrawal may continue
-- to expose the withdrawn item; a later subscription to another plan version
-- cannot acquire it.
create or replace function private.resolve_creator_premium_entitlement_v1(p_content_id uuid)
returns table (
  allowed boolean,
  source text,
  reason text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_expires_at timestamptz;
begin
  if v_actor is null then
    return query select false,'none'::text,'auth_required'::text,null::timestamptz;
    return;
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    return query select false,'none'::text,'age_eligibility_required'::text,null::timestamptz;
    return;
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    return query select false,'none'::text,'actor_account_restricted'::text,null::timestamptz;
    return;
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id;
  if not found then
    return query select false,'none'::text,'content_not_found'::text,null::timestamptz;
    return;
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    return query select false,'none'::text,'creator_account_restricted'::text,null::timestamptz;
    return;
  end if;
  if v_content.lifecycle_status in ('quarantined','deleted')
     or (v_content.lifecycle_status='removed'
         and v_content.removal_reason is distinct from 'creator_withdrawn') then
    return query select false,'none'::text,'content_unavailable'::text,null::timestamptz;
    return;
  end if;
  if v_actor=v_content.creator_id then
    return query select true,'owner'::text,'owner'::text,null::timestamptz;
    return;
  end if;
  if not (
    v_content.lifecycle_status='published'
    or (v_content.lifecycle_status='removed'
        and v_content.removal_reason='creator_withdrawn')
  ) then
    return query select false,'none'::text,'content_not_published'::text,null::timestamptz;
    return;
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor,v_content.creator_id) then
    return query select false,'none'::text,'blocked_relationship'::text,null::timestamptz;
    return;
  end if;

  if v_content.access_mode in ('purchase','purchase_or_subscription') then
    select receipt.access_expires_at into v_expires_at
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id=v_actor
      and receipt.content_id=v_content.id
      and receipt.access_state='active'
      and receipt.revoked_at is null
      and receipt.reversal_financial_transaction_id is null
      and (receipt.access_expires_at is null
           or receipt.access_expires_at>pg_catalog.clock_timestamp())
      and private.creator_premium_purchase_binding_is_valid_v1(receipt.id)
    order by receipt.activated_at desc,receipt.id desc
    limit 1;
    if found then
      return query select true,'purchase'::text,'active_purchase'::text,v_expires_at;
      return;
    end if;
  end if;

  if v_content.access_mode in ('subscription','purchase_or_subscription') then
    select period.paid_through_at into v_expires_at
    from private.creator_premium_subscriptions subscription
    join private.creator_premium_subscription_periods period
      on period.subscription_id=subscription.id
     and period.subscriber_id=subscription.subscriber_id
     and period.creator_id=subscription.creator_id
     and period.plan_id=subscription.plan_id
    join private.creator_premium_plan_contents grant_map
      on grant_map.plan_id=subscription.plan_id
     and grant_map.creator_id=subscription.creator_id
     and grant_map.content_id=v_content.id
    where subscription.subscriber_id=v_actor
      and subscription.creator_id=v_content.creator_id
      and subscription.status in ('active','cancelled')
      and period.access_state='active'
      and period.revoked_at is null
      and period.reversal_financial_transaction_id is null
      and period.starts_at<=pg_catalog.clock_timestamp()
      and period.paid_through_at>pg_catalog.clock_timestamp()
      and (
        v_content.lifecycle_status='published'
        or period.starts_at<=v_content.removed_at
      )
      and private.creator_premium_period_binding_is_valid_v1(period.id)
    order by period.paid_through_at desc,period.id desc
    limit 1;
    if found then
      return query select true,'subscription'::text,'active_subscription_period'::text,v_expires_at;
      return;
    end if;
  end if;

  return query select false,'none'::text,'not_entitled'::text,null::timestamptz;
end;
$$;

revoke all on function private.resolve_creator_premium_entitlement_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_my_creator_premium_library_v1(
  p_limit integer default 24,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  creator_id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  published_at timestamptz,
  created_at timestamptz,
  entitlement_source text,
  entitlement_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode='22023',message='creator_premium_invalid_limit';
  end if;
  if (p_cursor_published_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;

  return query
  with candidate_content as (
    select receipt.content_id
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id=v_actor and receipt.access_state='active'
    union
    select grant_map.content_id
    from private.creator_premium_subscriptions subscription
    join private.creator_premium_subscription_periods period
      on period.subscription_id=subscription.id
     and period.subscriber_id=subscription.subscriber_id
     and period.creator_id=subscription.creator_id
     and period.plan_id=subscription.plan_id
    join private.creator_premium_plan_contents grant_map
      on grant_map.plan_id=subscription.plan_id
     and grant_map.creator_id=subscription.creator_id
    where subscription.subscriber_id=v_actor
      and subscription.status in ('active','cancelled')
      and period.access_state='active'
      and period.starts_at<=pg_catalog.clock_timestamp()
      and period.paid_through_at>pg_catalog.clock_timestamp()
  )
  select content.id,content.creator_id,content.title,content.description,
    content.content_kind,content.access_mode,content.published_at,content.created_at,
    entitlement.source,entitlement.expires_at
  from candidate_content candidate
  join private.creator_premium_contents content on content.id=candidate.content_id
  cross join lateral private.resolve_creator_premium_entitlement_v1(content.id) entitlement
  where entitlement.allowed
    and entitlement.source in ('purchase','subscription')
    and (
      content.lifecycle_status='published'
      or (content.lifecycle_status='removed'
          and content.removal_reason='creator_withdrawn')
    )
    and content.published_at is not null
    and (p_cursor_published_at is null
         or (content.published_at,content.id)<(p_cursor_published_at,p_cursor_id))
  order by content.published_at desc,content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_creator_premium_library_v1(integer,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_creator_premium_library_v1(integer,timestamptz,uuid)
  to authenticated;

create or replace function public.retire_my_creator_premium_content_v1(p_content_id uuid)
returns table (
  content_id uuid,
  lifecycle_status text,
  removed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_affected_plan_ids uuid[] := '{}'::uuid[];
  v_affected_plan_keys text[] := '{}'::text[];
  v_plan_id uuid;
  v_plan_key text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode='22023',message='creator_premium_invalid_content';
  end if;

  select coalesce(pg_catalog.array_agg(distinct plan.plan_key order by plan.plan_key),'{}'::text[])
  into v_affected_plan_keys
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
  where mapping.content_id=p_content_id and mapping.creator_id=v_actor;
  foreach v_plan_key in array v_affected_plan_keys loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'creator-premium-plan-version:'||v_actor::text||':'||v_plan_key,0
    ));
  end loop;

  select coalesce(pg_catalog.array_agg(plan.id order by plan.id),'{}'::uuid[])
  into v_affected_plan_ids
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
  where mapping.content_id=p_content_id and mapping.creator_id=v_actor;
  foreach v_plan_id in array v_affected_plan_ids loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('creator-premium-plan:'||v_plan_id::text,0)
    );
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:'||p_content_id::text,0)
  );
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id and content.creator_id=v_actor
  for update;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status='removed'
     and v_content.removal_reason='creator_withdrawn' then
    return query select v_content.id,v_content.lifecycle_status,v_content.removed_at,true;
    return;
  end if;
  if v_content.lifecycle_status<>'published' then
    raise exception using errcode='55000',message='creator_premium_content_published_only';
  end if;

  perform plan.id
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
  where mapping.content_id=v_content.id and mapping.creator_id=v_actor
  order by plan.id
  for update of plan;

  update private.creator_premium_offer_versions offer
  set status='retired',retired_at=coalesce(offer.retired_at,v_now),updated_at=v_now
  where offer.content_id=v_content.id
    and offer.creator_id=v_actor
    and offer.status='active';

  update private.creator_premium_contents content
  set lifecycle_status='removed',removed_at=v_now,reviewed_at=v_now,
      reviewed_by=v_actor,review_reason='Retirado por el creador',
      removal_reason='creator_withdrawn',updated_at=v_now
  where content.id=v_content.id
  returning content.* into v_content;

  return query select v_content.id,v_content.lifecycle_status,v_content.removed_at,false;
end;
$$;

revoke all on function public.retire_my_creator_premium_content_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.retire_my_creator_premium_content_v1(uuid)
  to authenticated;

comment on function public.retire_my_creator_premium_content_v1(uuid) is
  'Owner withdrawal closes new Premium sales while preserving verified access acquired before withdrawal.';
comment on function private.resolve_creator_premium_entitlement_v1(uuid) is
  'Canonical entitlement authority; creator withdrawal preserves prior purchase or pre-withdrawal subscription access while safety removals stay closed.';

-- Defense in depth: private facts remain inaccessible even if a future owner
-- or default privilege changes.  Runtime access is RPC-only.
alter table private.creator_premium_purchase_receipts enable row level security;
alter table private.creator_premium_purchase_receipts force row level security;
alter table private.creator_premium_subscriptions enable row level security;
alter table private.creator_premium_subscriptions force row level security;
alter table private.creator_premium_subscription_periods enable row level security;
alter table private.creator_premium_subscription_periods force row level security;

revoke all on table private.creator_premium_purchase_receipts
  from public,anon,authenticated,service_role;
revoke all on table private.creator_premium_subscriptions
  from public,anon,authenticated,service_role;
revoke all on table private.creator_premium_subscription_periods
  from public,anon,authenticated,service_role;

revoke all on function public.get_creator_premium_commerce_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_creator_premium_commerce_v1(uuid)
  to authenticated;
revoke all on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)
  to authenticated;
revoke all on function public.get_my_creator_premium_financial_history_v1(text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_creator_premium_financial_history_v1(text,text,timestamptz,uuid,integer)
  to authenticated;
revoke all on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)
  to authenticated;
revoke all on function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer)
  to authenticated;

comment on function public.get_my_creator_premium_financial_history_v1(text,text,timestamptz,uuid,integer)
  is 'F2 exact-string, verified Creator Premium financial history for the authenticated buyer or creator.';
comment on function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer)
  is 'F2 bounded read-only Creator Premium finance supervision and reconciliation projection.';

notify pgrst, 'reload schema';

commit;
