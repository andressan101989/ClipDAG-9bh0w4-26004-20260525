begin;

-- F4 turns the already deployed F2/F3 authority on for every eligible actor in
-- this Supabase project. It deliberately creates no balance, transaction,
-- receipt, subscription, period or entitlement. Every new commercial fact is
-- still bound to one immutable, owner-attested authorization row.
do $$
declare v_policy private.creator_premium_finance_policy;
begin
  select policy.* into strict v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton
  for update;
  if v_policy.activation_mode<>'off'
    or v_policy.purchase_enabled or v_policy.subscription_enabled or v_policy.refunds_enabled
    or v_policy.platform_fee_bps<>0 or v_policy.active_authorization_id is not null
    or exists(select 1 from private.creator_premium_finance_authorizations where status='OPEN') then
    raise exception using errcode='55000',message='creator_premium_f4_requires_exact_finance_off';
  end if;
  if exists(select 1 from private.creator_premium_finance_authorizations
      where id='f4000000-0000-4000-8000-000000000001') then
    raise exception using errcode='23505',message='creator_premium_f4_authorization_already_exists';
  end if;
end;
$$;

alter table private.creator_premium_finance_authorizations
  add column authorization_scope text not null default 'CANARY'
    check (authorization_scope in ('CANARY','GENERAL')),
  drop constraint creator_premium_finance_authorizations_identity_check,
  drop constraint creator_premium_finance_authorizations_amounts_check,
  drop constraint creator_premium_finance_authorizations_window_check,
  alter column buyer_id drop not null,
  alter column creator_id drop not null,
  alter column buyer_account_id drop not null,
  alter column creator_account_id drop not null,
  alter column purchase_content_id drop not null,
  alter column purchase_offer_version_id drop not null,
  alter column subscription_plan_id drop not null,
  alter column purchase_amount_bdag drop not null,
  alter column subscription_amount_bdag drop not null,
  alter column max_purchase_count drop not null,
  alter column max_subscription_count drop not null,
  alter column max_refund_count drop not null,
  alter column max_gross_bdag drop not null,
  alter column charge_expires_at drop not null,
  alter column refund_expires_at drop not null,
  add constraint creator_premium_finance_authorizations_identity_check check (
    (authorization_scope='CANARY'
      and buyer_id is not null and creator_id is not null
      and buyer_account_id is not null and creator_account_id is not null
      and purchase_content_id is not null and purchase_offer_version_id is not null
      and subscription_plan_id is not null
      and buyer_id<>creator_id and buyer_account_id<>creator_account_id
      and buyer_account_id<>platform_account_id and creator_account_id<>platform_account_id)
    or
    (authorization_scope='GENERAL'
      and buyer_id is null and creator_id is null
      and buyer_account_id is null and creator_account_id is null
      and purchase_content_id is null and purchase_offer_version_id is null
      and subscription_plan_id is null)
  ),
  add constraint creator_premium_finance_authorizations_amounts_check check (
    (authorization_scope='CANARY'
      and purchase_amount_bdag is not null and subscription_amount_bdag is not null
      and max_purchase_count is not null and max_subscription_count is not null
      and max_refund_count is not null and max_gross_bdag is not null
      and purchase_amount_bdag>0 and purchase_amount_bdag<=1000000000000
      and subscription_amount_bdag>0 and subscription_amount_bdag<=1000000000000
      and purchase_amount_bdag=pg_catalog.round(purchase_amount_bdag,8)
      and subscription_amount_bdag=pg_catalog.round(subscription_amount_bdag,8)
      and max_gross_bdag=pg_catalog.round(max_gross_bdag,8)
      and max_gross_bdag>=greatest(purchase_amount_bdag,subscription_amount_bdag)
      and max_gross_bdag<=purchase_amount_bdag*max_purchase_count
        +subscription_amount_bdag*max_subscription_count
      and max_refund_count<=max_purchase_count+max_subscription_count)
    or
    (authorization_scope='GENERAL'
      and purchase_amount_bdag is null and subscription_amount_bdag is null
      and max_purchase_count is null and max_subscription_count is null
      and max_refund_count is null and max_gross_bdag is null
      and platform_fee_bps=2000)
  ),
  add constraint creator_premium_finance_authorizations_window_check check (
    pg_catalog.isfinite(charge_starts_at) and pg_catalog.isfinite(created_at)
    and (
      (authorization_scope='CANARY'
        and charge_expires_at is not null and refund_expires_at is not null
        and pg_catalog.isfinite(charge_expires_at) and pg_catalog.isfinite(refund_expires_at)
        and charge_expires_at>charge_starts_at
        and charge_expires_at<=charge_starts_at+interval '60 minutes'
        and refund_expires_at>=charge_expires_at
        and refund_expires_at<=charge_expires_at+interval '24 hours')
      or
      (authorization_scope='GENERAL'
        and charge_expires_at is null and refund_expires_at is null)
    )
  );

alter table private.creator_premium_finance_policy
  drop constraint creator_premium_finance_policy_f3_foundation_off_check,
  drop constraint creator_premium_finance_policy_f3_mode_check,
  add constraint creator_premium_finance_policy_f3_mode_check check (
    (activation_mode='off' and not purchase_enabled and not subscription_enabled
      and not refunds_enabled and platform_fee_bps=0 and active_authorization_id is null)
    or (activation_mode='canary' and active_authorization_id is not null)
    or (activation_mode='general' and active_authorization_id is not null
      and platform_fee_bps=2000 and purchase_enabled=subscription_enabled
      and (not purchase_enabled or refunds_enabled))
  );

create function private.creator_premium_finance_configuration_payload_f4_v1(p_configuration jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select private.creator_premium_finance_serialize_f3_c2_v1(
    array['domain','id','authorization_scope','client_contract','platform_account_id',
      'platform_fee_bps','charge_starts_at','purchase_enabled','subscription_enabled','refunds_enabled'],
    array['creator-premium-f4-general-configuration-v1',(p_configuration->>'id')::uuid::text,
      p_configuration->>'authorization_scope',p_configuration->>'client_contract',
      (p_configuration->>'platform_account_id')::uuid::text,
      (p_configuration->>'platform_fee_bps')::integer::text,
      (extract(epoch from (p_configuration->>'charge_starts_at')::timestamptz)*1000000)::bigint::text,
      'true','true','true']);
$$;

create function private.creator_premium_finance_configuration_digest_f4_v1(p_configuration jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    private.creator_premium_finance_configuration_payload_f4_v1(p_configuration),'UTF8')),'hex');
$$;

create or replace function private.creator_premium_finance_authorization_integrity_f3_c2_v1(
  p_authorization_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from private.creator_premium_finance_authorizations envelope
    join private.creator_premium_finance_owner_attestations_f3_c2 attestation
      on (attestation.approval_digest,attestation.configuration_digest)
        =(envelope.approval_digest,envelope.configuration_digest)
    where envelope.id=p_authorization_id
      and envelope.platform_fee_bps=2000
      and envelope.configuration_digest=case envelope.authorization_scope
        when 'CANARY' then private.creator_premium_finance_configuration_digest_f3_c2_v1(pg_catalog.to_jsonb(envelope))
        when 'GENERAL' then private.creator_premium_finance_configuration_digest_f4_v1(pg_catalog.to_jsonb(envelope))
        else null end
      and attestation.approval_digest
        =private.creator_premium_finance_attestation_digest_f3_c2_v1(pg_catalog.to_jsonb(attestation))
      and attestation.registered_by='postgres'
  );
$$;

create or replace function private.guard_creator_premium_authorization_insert_f3_c2_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_expected_digest text;
begin
  v_expected_digest := case new.authorization_scope
    when 'CANARY' then private.creator_premium_finance_configuration_digest_f3_c2_v1(pg_catalog.to_jsonb(new))
    when 'GENERAL' then private.creator_premium_finance_configuration_digest_f4_v1(pg_catalog.to_jsonb(new))
    else null end;
  if new.status<>'OPEN' or new.closed_at is not null or new.closed_by is not null
    or new.close_reason is not null or new.platform_fee_bps<>2000
    or new.configuration_digest is distinct from v_expected_digest
    or not exists(
      select 1 from private.creator_premium_finance_owner_attestations_f3_c2 attestation
      where (attestation.approval_digest,attestation.configuration_digest)
        =(new.approval_digest,new.configuration_digest)
        and attestation.approval_digest
          =private.creator_premium_finance_attestation_digest_f3_c2_v1(pg_catalog.to_jsonb(attestation))
        and attestation.registered_by='postgres'
    ) then
    raise exception using errcode='23514',message='creator_premium_finance_authorization_attestation_invalid';
  end if;
  return new;
end;
$$;

create or replace function private.guard_creator_premium_finance_authorization_f3_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_expected_digest text;
begin
  if tg_op='INSERT' then
    if current_user<>'postgres' then
      raise exception using errcode='42501',message='creator_premium_finance_owner_required';
    end if;
    v_expected_digest := case new.authorization_scope
      when 'CANARY' then private.creator_premium_finance_configuration_digest_f3_c2_v1(pg_catalog.to_jsonb(new))
      when 'GENERAL' then private.creator_premium_finance_configuration_digest_f4_v1(pg_catalog.to_jsonb(new))
      else null end;
    if new.status='OPEN' and new.platform_fee_bps=2000
      and new.configuration_digest is not distinct from v_expected_digest then
      return new;
    end if;
  elsif tg_op='UPDATE' then
    if old.status='OPEN' and new.status='CLOSED'
      and (pg_catalog.to_jsonb(new)-array['status','closed_at','closed_by','close_reason'])
        is not distinct from (pg_catalog.to_jsonb(old)-array['status','closed_at','closed_by','close_reason'])
      and old.closed_at is null and old.closed_by is null and old.close_reason is null
      and new.closed_at is not null and pg_catalog.isfinite(new.closed_at)
      and new.closed_by='postgres'
      and pg_catalog.length(pg_catalog.btrim(new.close_reason)) between 1 and 2000
      and exists(
        select 1 from private.creator_premium_finance_policy policy
        where policy.singleton and policy.active_authorization_id=new.id
          and policy.platform_fee_bps=new.platform_fee_bps
          and not policy.purchase_enabled and not policy.subscription_enabled
          and ((new.authorization_scope='CANARY' and policy.activation_mode='canary')
            or (new.authorization_scope='GENERAL' and policy.activation_mode='general'))
      ) then
      return new;
    end if;
  end if;
  raise exception using errcode='23514',message='creator_premium_finance_authorization_immutable';
end;
$$;

create or replace function private.creator_premium_charge_blocker_f3_v1(
  p_operation text,p_buyer_id uuid,p_creator_id uuid,p_target_id uuid,p_offer_id uuid,p_amount numeric,
  p_client_contract text
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select policy.* into v_policy from private.creator_premium_finance_policy policy where singleton;
  if not found or v_policy.activation_mode not in ('canary','general')
    or (p_operation='purchase' and not v_policy.purchase_enabled)
    or (p_operation='subscription' and not v_policy.subscription_enabled) then
    return case when p_operation='purchase' then 'creator_premium_purchase_disabled'
      else 'creator_premium_subscription_disabled' end;
  end if;
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where envelope.id=v_policy.active_authorization_id;
  if not found or v_authorization.status<>'OPEN'
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(v_authorization.id) then
    return 'creator_premium_finance_not_open';
  end if;
  if p_client_contract is distinct from v_authorization.client_contract then
    return 'creator_premium_client_upgrade_required';
  end if;
  if p_operation not in ('purchase','subscription') or p_buyer_id is null or p_creator_id is null
    or p_target_id is null or p_buyer_id=p_creator_id or p_amount is null or p_amount<=0
    or p_amount>1000000000000 or p_amount<>pg_catalog.round(p_amount,8)
    or (p_operation='purchase' and p_offer_id is null)
    or (p_operation='subscription' and p_offer_id is not null)
    or v_policy.platform_fee_bps<>2000 or v_authorization.platform_fee_bps<>2000
    or pg_catalog.clock_timestamp()<v_authorization.charge_starts_at then
    return 'creator_premium_finance_denied';
  end if;

  if v_authorization.authorization_scope='GENERAL' then
    if v_policy.activation_mode<>'general'
      or not exists(select 1 from public.ledger_accounts account
        where account.id=v_authorization.platform_account_id and account.owner_id is null
          and account.account_type='platform' and account.currency='BDAG' and not account.frozen)
      or (select count(*) from public.ledger_accounts account
        where account.owner_id is null and account.account_type='platform' and account.currency='BDAG')<>1
      or (select count(*) from public.ledger_accounts account
        where account.owner_id=p_buyer_id and account.account_type='user'
          and account.currency='BDAG')<>1
      or (select count(*) from public.ledger_accounts account
        where account.owner_id=p_buyer_id and account.account_type='user'
          and account.currency='BDAG' and not account.frozen)<>1 then
      return 'creator_premium_finance_denied';
    end if;
    -- The canonical charge composer provisions a missing creator account under
    -- lock.  Admission must therefore allow zero creator accounts, while any
    -- pre-existing account must be the single usable BDAG account.  Other
    -- account types/currencies are unrelated and must not deny an otherwise
    -- eligible charge.
    if (select count(*) from public.ledger_accounts account
        where account.owner_id=p_creator_id and account.account_type='user'
          and account.currency='BDAG')>1
      or exists(select 1 from public.ledger_accounts account
        where account.owner_id=p_creator_id and account.account_type='user'
          and account.currency='BDAG' and account.frozen) then
      return 'creator_premium_finance_denied';
    end if;
    return null;
  end if;

  if v_authorization.authorization_scope<>'CANARY' or v_policy.activation_mode<>'canary'
    or p_buyer_id is distinct from v_authorization.buyer_id
    or p_creator_id is distinct from v_authorization.creator_id
    or (p_operation='purchase' and (p_target_id is distinct from v_authorization.purchase_content_id
      or p_offer_id is distinct from v_authorization.purchase_offer_version_id
      or p_amount is distinct from v_authorization.purchase_amount_bdag))
    or (p_operation='subscription' and (p_target_id is distinct from v_authorization.subscription_plan_id
      or p_amount is distinct from v_authorization.subscription_amount_bdag))
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.buyer_account_id
      and owner_id=p_buyer_id and account_type='user' and currency='BDAG' and not frozen)
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.creator_account_id
      and owner_id=p_creator_id and account_type='user' and currency='BDAG' and not frozen)
    or not exists(select 1 from public.ledger_accounts where id=v_authorization.platform_account_id
      and owner_id is null and account_type='platform' and currency='BDAG' and not frozen) then
    return 'creator_premium_canary_denied';
  end if;
  if v_now>=v_authorization.charge_expires_at then return 'creator_premium_canary_expired'; end if;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
  if (p_operation='purchase' and v_usage.purchase_count>=v_authorization.max_purchase_count)
    or (p_operation='subscription' and v_usage.subscription_count>=v_authorization.max_subscription_count)
    or v_usage.gross_bdag+p_amount>v_authorization.max_gross_bdag then
    return 'creator_premium_canary_limit_reached';
  end if;
  return null;
end;
$$;

create or replace function private.creator_premium_authorization_binding_f3_v1(
  p_authorization_id uuid,p_operation text,p_buyer_id uuid,p_creator_id uuid,
  p_target_id uuid,p_offer_id uuid,p_amount numeric,p_fee integer,
  p_buyer_account_id uuid,p_creator_account_id uuid,p_platform_account_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_authorization_id is null or exists(
    select 1
    from private.creator_premium_finance_authorizations envelope
    where envelope.id=p_authorization_id
      and private.creator_premium_finance_authorization_integrity_f3_c2_v1(envelope.id)
      and envelope.platform_account_id=p_platform_account_id
      and envelope.platform_fee_bps=p_fee
      and p_fee=2000
      and (
        (envelope.authorization_scope='CANARY'
          and envelope.buyer_id=p_buyer_id and envelope.creator_id=p_creator_id
          and envelope.buyer_account_id=p_buyer_account_id
          and envelope.creator_account_id=p_creator_account_id
          and ((p_operation='purchase' and envelope.purchase_content_id=p_target_id
            and envelope.purchase_offer_version_id=p_offer_id
            and envelope.purchase_amount_bdag=p_amount)
          or (p_operation='subscription' and envelope.subscription_plan_id=p_target_id
            and p_offer_id is null and envelope.subscription_amount_bdag=p_amount)))
        or
        (envelope.authorization_scope='GENERAL'
          and p_operation in ('purchase','subscription')
          and p_buyer_id is not null and p_creator_id is not null and p_buyer_id<>p_creator_id
          and p_target_id is not null and p_amount>0 and p_amount<=1000000000000
          and p_amount=pg_catalog.round(p_amount,8)
          and ((p_operation='purchase' and p_offer_id is not null)
            or (p_operation='subscription' and p_offer_id is null))
          and exists(select 1 from public.ledger_accounts account
            where account.id=p_buyer_account_id and account.owner_id=p_buyer_id
              and account.account_type='user' and account.currency='BDAG')
          and exists(select 1 from public.ledger_accounts account
            where account.id=p_creator_account_id and account.owner_id=p_creator_id
              and account.account_type='user' and account.currency='BDAG')
          and exists(select 1 from public.ledger_accounts account
            where account.id=p_platform_account_id and account.owner_id is null
              and account.account_type='platform' and account.currency='BDAG'))
      )
  );
$$;

create or replace function private.admit_creator_premium_refund_f3_v1(p_authorization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
begin
  v_policy := private.lock_creator_premium_finance_f3_v1();
  if v_policy.activation_mode not in ('canary','general') or not v_policy.refunds_enabled then
    raise exception using errcode='55000',message='creator_premium_refunds_disabled';
  end if;
  if p_authorization_id is null then return; end if;
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where id=p_authorization_id
  for share;
  if not found or v_authorization.status not in ('OPEN','CLOSED')
    or v_authorization.platform_fee_bps<>2000
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(v_authorization.id) then
    raise exception using errcode='55000',message='creator_premium_finance_refund_denied';
  end if;
  if v_authorization.authorization_scope='CANARY' then
    if pg_catalog.clock_timestamp()<v_authorization.charge_starts_at then
      raise exception using errcode='55000',message='creator_premium_canary_not_open';
    end if;
    if pg_catalog.clock_timestamp()>=v_authorization.refund_expires_at then
      raise exception using errcode='55000',message='creator_premium_canary_expired';
    end if;
    select * into v_usage from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
    if v_usage.refund_count>=v_authorization.max_refund_count then
      raise exception using errcode='55000',message='creator_premium_canary_limit_reached';
    end if;
  elsif v_authorization.authorization_scope<>'GENERAL' then
    raise exception using errcode='55000',message='creator_premium_finance_refund_denied';
  end if;
end;
$$;

create or replace function private.assert_creator_premium_finance_deadline_f3_v1(
  p_authorization_id uuid,p_operation text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_authorization private.creator_premium_finance_authorizations;
  v_policy private.creator_premium_finance_policy;
begin
  if p_operation not in ('charge','refund') then
    raise exception using errcode='22023',message='creator_premium_finance_operation_invalid';
  end if;
  select policy.* into strict v_policy
  from private.creator_premium_finance_policy policy where singleton;
  if p_operation='refund' and p_authorization_id is null then
    if v_policy.activation_mode not in ('canary','general') or not v_policy.refunds_enabled then
      raise exception using errcode='55000',message='creator_premium_refunds_disabled';
    end if;
    return;
  end if;
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where id=p_authorization_id;
  if not found or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(v_authorization.id) then
    raise exception using errcode='55000',message='creator_premium_finance_denied';
  end if;
  if p_operation='charge' then
    if v_authorization.status<>'OPEN'
      or v_policy.active_authorization_id is distinct from v_authorization.id
      or not ((v_authorization.authorization_scope='CANARY' and v_policy.activation_mode='canary')
        or (v_authorization.authorization_scope='GENERAL' and v_policy.activation_mode='general'))
      or not v_policy.purchase_enabled or not v_policy.subscription_enabled
      or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps then
      raise exception using errcode='55000',message='creator_premium_finance_not_open';
    end if;
    if pg_catalog.clock_timestamp()<v_authorization.charge_starts_at
      or (v_authorization.authorization_scope='CANARY'
        and pg_catalog.clock_timestamp()>=v_authorization.charge_expires_at) then
      raise exception using errcode='55000',message='creator_premium_finance_expired';
    end if;
    return;
  end if;
  if v_policy.activation_mode not in ('canary','general') or not v_policy.refunds_enabled
    or v_authorization.status not in ('OPEN','CLOSED') then
    raise exception using errcode='55000',message='creator_premium_refunds_disabled';
  end if;
  if v_authorization.authorization_scope='CANARY'
    and (pg_catalog.clock_timestamp()<v_authorization.charge_starts_at
      or pg_catalog.clock_timestamp()>=v_authorization.refund_expires_at) then
    raise exception using errcode='55000',message='creator_premium_canary_expired';
  end if;
end;
$$;

create or replace function private.close_creator_premium_finance_authorization_f3_c2_v1(
  p_authorization_id uuid,p_reason text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_refunds boolean;
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='creator_premium_finance_owner_required';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='22023',message='creator_premium_finance_close_reason_invalid';
  end if;
  v_policy := private.lock_creator_premium_finance_f3_v1();
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where id=p_authorization_id;
  if not found or v_authorization.status<>'OPEN'
    or v_policy.active_authorization_id is distinct from p_authorization_id
    or not ((v_authorization.authorization_scope='CANARY' and v_policy.activation_mode='canary')
      or (v_authorization.authorization_scope='GENERAL' and v_policy.activation_mode='general'))
    or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id) then
    raise exception using errcode='55000',message='creator_premium_finance_close_denied';
  end if;
  if v_authorization.authorization_scope='CANARY' then
    select * into v_usage from private.creator_premium_finance_consumption_f3_v1(p_authorization_id);
    v_refunds := v_policy.refunds_enabled
      and pg_catalog.clock_timestamp()>=v_authorization.charge_starts_at
      and pg_catalog.clock_timestamp()<v_authorization.refund_expires_at
      and v_usage.refund_count<v_authorization.max_refund_count
      and v_usage.refund_count<v_usage.purchase_count+v_usage.subscription_count;
  else
    v_refunds := v_policy.refunds_enabled;
  end if;
  update private.creator_premium_finance_policy
  set purchase_enabled=false,subscription_enabled=false,refunds_enabled=v_refunds,
    updated_at=pg_catalog.clock_timestamp()
  where singleton;
  update private.creator_premium_finance_authorizations
  set status='CLOSED',closed_at=pg_catalog.clock_timestamp(),closed_by=current_user,
    close_reason=pg_catalog.btrim(p_reason)
  where id=p_authorization_id;
  if not v_refunds then
    update private.creator_premium_finance_policy
    set activation_mode='off',purchase_enabled=false,subscription_enabled=false,
      refunds_enabled=false,platform_fee_bps=0,active_authorization_id=null,
      updated_at=pg_catalog.clock_timestamp()
    where singleton;
  end if;
end;
$$;

create or replace function private.finalize_creator_premium_finance_authorization_f3_c2_v1(
  p_authorization_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_has_unreversed_facts boolean;
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='creator_premium_finance_owner_required';
  end if;
  v_policy := private.lock_creator_premium_finance_f3_v1();
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where id=p_authorization_id;
  if not found or v_authorization.status<>'CLOSED'
    or v_policy.active_authorization_id is distinct from p_authorization_id
    or not ((v_authorization.authorization_scope='CANARY' and v_policy.activation_mode='canary')
      or (v_authorization.authorization_scope='GENERAL' and v_policy.activation_mode='general'))
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id)
    or exists(select 1 from private.creator_premium_purchase_receipts receipt
      where receipt.finance_authorization_id=p_authorization_id
        and not private.creator_premium_financial_fact_is_valid_v1(
          receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
          receipt.access_state,receipt.buyer_id,receipt.creator_id,
          receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
          'creator_premium_purchase_receipt',receipt.id,
          'creator_premium_purchase','creator_premium_purchase_refund',
          receipt.idempotency_key,receipt.refund_idempotency_key,
          receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
          receipt.platform_fee_bps))
    or exists(select 1 from private.creator_premium_subscription_periods period
      where period.finance_authorization_id=p_authorization_id
        and not private.creator_premium_financial_fact_is_valid_v1(
          period.financial_transaction_id,period.reversal_financial_transaction_id,
          period.access_state,period.subscriber_id,period.creator_id,
          period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
          'creator_premium_subscription_period',period.id,
          'creator_premium_subscription','creator_premium_subscription_refund',
          period.idempotency_key,period.refund_idempotency_key,
          period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
          period.platform_fee_bps)) then
    raise exception using errcode='55000',message='creator_premium_finance_finalize_denied';
  end if;
  if v_authorization.authorization_scope='CANARY' then
    select * into v_usage from private.creator_premium_finance_consumption_f3_v1(p_authorization_id);
    select exists(
      select 1 from private.creator_premium_purchase_receipts receipt
      where receipt.finance_authorization_id=p_authorization_id and receipt.access_state<>'refunded'
      union all
      select 1 from private.creator_premium_subscription_periods period
      where period.finance_authorization_id=p_authorization_id and period.access_state<>'refunded'
    ) into v_has_unreversed_facts;
    if v_has_unreversed_facts and v_policy.refunds_enabled
      and pg_catalog.clock_timestamp()<v_authorization.refund_expires_at
      and v_usage.refund_count<v_authorization.max_refund_count then
      raise exception using errcode='55000',message='creator_premium_finance_finalize_denied';
    end if;
  end if;
  update private.creator_premium_finance_policy
  set activation_mode='off',purchase_enabled=false,subscription_enabled=false,
    refunds_enabled=false,platform_fee_bps=0,active_authorization_id=null,
    updated_at=pg_catalog.clock_timestamp()
  where singleton;
end;
$$;

create or replace function public.get_admin_creator_premium_finance_activation_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_limits jsonb;
  v_consumed jsonb;
  v_remaining jsonb;
begin
  perform public.admin_require_capability('finance.ledger.read');
  select policy.* into strict v_policy
  from private.creator_premium_finance_policy policy where singleton;
  select envelope.* into v_authorization
  from private.creator_premium_finance_authorizations envelope
  where id=v_policy.active_authorization_id;
  if v_authorization.id is null then
    v_limits := pg_catalog.jsonb_build_object(
      'purchase_count',0,'subscription_count',0,'refund_count',0,
      'purchase_amount_bdag','0.00000000','subscription_amount_bdag','0.00000000',
      'gross_bdag','0.00000000');
    v_consumed := pg_catalog.jsonb_build_object(
      'purchase_count',0,'subscription_count',0,'refund_count',0,'gross_bdag','0.00000000');
    v_remaining := pg_catalog.jsonb_build_object(
      'purchase_count',0,'subscription_count',0,'refund_count',0,'gross_bdag','0.00000000');
  else
    select * into v_usage
    from private.creator_premium_finance_consumption_f3_v1(v_authorization.id);
    v_consumed := pg_catalog.jsonb_build_object(
      'purchase_count',v_usage.purchase_count,'subscription_count',v_usage.subscription_count,
      'refund_count',v_usage.refund_count,'gross_bdag',v_usage.gross_bdag::numeric(38,8)::text);
  end if;
  if v_authorization.authorization_scope='CANARY' then
    v_limits := pg_catalog.jsonb_build_object(
      'purchase_count',v_authorization.max_purchase_count,
      'subscription_count',v_authorization.max_subscription_count,
      'refund_count',v_authorization.max_refund_count,
      'purchase_amount_bdag',v_authorization.purchase_amount_bdag::numeric(38,8)::text,
      'subscription_amount_bdag',v_authorization.subscription_amount_bdag::numeric(38,8)::text,
      'gross_bdag',v_authorization.max_gross_bdag::numeric(38,8)::text);
    v_remaining := pg_catalog.jsonb_build_object(
      'purchase_count',v_authorization.max_purchase_count-v_usage.purchase_count,
      'subscription_count',v_authorization.max_subscription_count-v_usage.subscription_count,
      'refund_count',v_authorization.max_refund_count-v_usage.refund_count,
      'gross_bdag',(v_authorization.max_gross_bdag-v_usage.gross_bdag)::numeric(38,8)::text);
  elsif v_authorization.authorization_scope='GENERAL' then
    v_limits := null;
    v_remaining := null;
  end if;
  return pg_catalog.jsonb_build_object('activation',pg_catalog.jsonb_build_object(
    'mode',v_policy.activation_mode,'scope',v_authorization.authorization_scope,
    'authorization_id',v_policy.active_authorization_id,
    'charge_starts_at',v_authorization.charge_starts_at,
    'charge_expires_at',v_authorization.charge_expires_at,
    'refund_expires_at',v_authorization.refund_expires_at,
    'operations',pg_catalog.jsonb_build_object('purchase_enabled',v_policy.purchase_enabled,
      'subscription_enabled',v_policy.subscription_enabled,'refunds_enabled',v_policy.refunds_enabled),
    'limits',v_limits,
    'consumed',v_consumed,
    'remaining',v_remaining));
end;
$$;

-- Register exactly one owner attestation and one general authorization. The
-- existing platform account is selected through the same canonical invariant
-- used by the ledger composer; no account is created by this migration.
do $$
declare
  v_platform_account_id uuid;
  v_configuration jsonb;
  v_configuration_digest text;
  v_attestation jsonb;
  v_approval_digest text;
  v_authorization_id constant uuid := 'f4000000-0000-4000-8000-000000000001';
  v_charge_starts_at constant timestamptz := '2026-10-25 00:00:00+00';
begin
  select private.resolve_creator_premium_platform_account_v1()
  into strict v_platform_account_id;
  v_configuration := pg_catalog.jsonb_build_object(
    'id',v_authorization_id,'authorization_scope','GENERAL',
    'client_contract','creator-premium-f3-v2','platform_account_id',v_platform_account_id,
    'platform_fee_bps',2000,'charge_starts_at',v_charge_starts_at);
  v_configuration_digest := private.creator_premium_finance_configuration_digest_f4_v1(v_configuration);
  v_attestation := pg_catalog.jsonb_build_object(
    'configuration_digest',v_configuration_digest,
    'approval_reference','CLIPDAG-NELYON-F4-GENERAL-ACTIVATION-OWNER-DIRECTIVE-2026-10-25',
    'evidence_digest',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'F4 owner approval: general Creator Premium BDAG purchase, subscription and refund operations; platform fee 2000 bps; owner-only suspension; no seeded balance or transaction.','UTF8')),'hex'),
    'repository','andressan101989/ClipDAG-9bh0w4-26004-20260525',
    'protected_source_sha','aa31271700f54f8d3c27a9fa89b592d8b56ddad1',
    'environment','production-general','approved_at','2026-10-25T00:00:00Z',
    'attestation_version','creator-premium-f3-c2-attestation-v1');
  v_approval_digest := private.creator_premium_finance_attestation_digest_f3_c2_v1(v_attestation);

  insert into private.creator_premium_finance_owner_attestations_f3_c2(
    approval_digest,configuration_digest,approval_reference,evidence_digest,repository,
    protected_source_sha,environment,approved_at,attestation_version
  ) values(
    v_approval_digest,v_configuration_digest,v_attestation->>'approval_reference',
    v_attestation->>'evidence_digest',v_attestation->>'repository',
    v_attestation->>'protected_source_sha',v_attestation->>'environment',
    (v_attestation->>'approved_at')::timestamptz,v_attestation->>'attestation_version'
  );

  insert into private.creator_premium_finance_authorizations(
    id,status,approval_digest,configuration_digest,client_contract,platform_account_id,
    platform_fee_bps,charge_starts_at,authorization_scope
  ) values(
    v_authorization_id,'OPEN',v_approval_digest,v_configuration_digest,
    'creator-premium-f3-v2',v_platform_account_id,2000,v_charge_starts_at,'GENERAL'
  );

  update private.creator_premium_finance_policy
  set activation_mode='general',active_authorization_id=v_authorization_id,
    purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,
    platform_fee_bps=2000,policy_version='creator-premium-f4-general-v1',
    updated_at=pg_catalog.clock_timestamp()
  where singleton;
  if not found or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(v_authorization_id) then
    raise exception using errcode='23514',message='creator_premium_f4_activation_integrity_failed';
  end if;
end;
$$;

alter function private.creator_premium_finance_configuration_payload_f4_v1(jsonb) owner to postgres;
alter function private.creator_premium_finance_configuration_digest_f4_v1(jsonb) owner to postgres;
alter function private.creator_premium_finance_authorization_integrity_f3_c2_v1(uuid) owner to postgres;
alter function private.guard_creator_premium_authorization_insert_f3_c2_v1() owner to postgres;
alter function private.guard_creator_premium_finance_authorization_f3_v1() owner to postgres;
alter function private.creator_premium_charge_blocker_f3_v1(text,uuid,uuid,uuid,uuid,numeric,text) owner to postgres;
alter function private.creator_premium_authorization_binding_f3_v1(uuid,text,uuid,uuid,uuid,uuid,numeric,integer,uuid,uuid,uuid) owner to postgres;
alter function private.admit_creator_premium_refund_f3_v1(uuid) owner to postgres;
alter function private.assert_creator_premium_finance_deadline_f3_v1(uuid,text) owner to postgres;
alter function private.close_creator_premium_finance_authorization_f3_c2_v1(uuid,text) owner to postgres;
alter function private.finalize_creator_premium_finance_authorization_f3_c2_v1(uuid) owner to postgres;
alter function public.get_admin_creator_premium_finance_activation_v1() owner to postgres;

revoke all on function private.creator_premium_finance_configuration_payload_f4_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.creator_premium_finance_configuration_digest_f4_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.creator_premium_finance_authorization_integrity_f3_c2_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.guard_creator_premium_authorization_insert_f3_c2_v1() from public,anon,authenticated,service_role;
revoke all on function private.guard_creator_premium_finance_authorization_f3_v1() from public,anon,authenticated,service_role;
revoke all on function private.creator_premium_charge_blocker_f3_v1(text,uuid,uuid,uuid,uuid,numeric,text) from public,anon,authenticated,service_role;
revoke all on function private.creator_premium_authorization_binding_f3_v1(uuid,text,uuid,uuid,uuid,uuid,numeric,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.admit_creator_premium_refund_f3_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.assert_creator_premium_finance_deadline_f3_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.close_creator_premium_finance_authorization_f3_c2_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.finalize_creator_premium_finance_authorization_f3_c2_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_creator_premium_finance_activation_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_creator_premium_finance_activation_v1() to authenticated;

notify pgrst, 'reload schema';
commit;
