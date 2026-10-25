begin;

-- Governance only. The F3 foundation OFF constraint and named INSERT blocker
-- remain in force. Approval evidence is registered only by a separately
-- reviewed protected owner migration; this migration registers no evidence.
create function private.creator_premium_finance_serialize_f3_c2_v1(p_keys text[],p_values text[])
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare v_index integer; v_lines text[] := array[]::text[];
begin
  if pg_catalog.cardinality(p_keys) is distinct from pg_catalog.cardinality(p_values)
    or pg_catalog.cardinality(p_keys)=0 then
    raise exception using errcode='22023',message='creator_premium_canonical_payload_invalid';
  end if;
  for v_index in 1..pg_catalog.cardinality(p_keys) loop
    if p_keys[v_index] is null or p_values[v_index] is null then
      raise exception using errcode='22023',message='creator_premium_canonical_field_missing';
    end if;
    v_lines := pg_catalog.array_append(v_lines,p_keys[v_index]||':'||
      pg_catalog.octet_length(pg_catalog.convert_to(p_values[v_index],'UTF8'))::text||':'||p_values[v_index]);
  end loop;
  return pg_catalog.array_to_string(v_lines,E'\n');
end;
$$;

create function private.creator_premium_finance_configuration_payload_f3_c2_v1(p_configuration jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select private.creator_premium_finance_serialize_f3_c2_v1(
    array['domain','id','client_contract','buyer_id','creator_id','buyer_account_id','creator_account_id',
      'platform_account_id','purchase_content_id','purchase_offer_version_id','subscription_plan_id',
      'purchase_amount_bdag','subscription_amount_bdag','max_purchase_count','max_subscription_count',
      'max_refund_count','max_gross_bdag','platform_fee_bps','charge_starts_at','charge_expires_at','refund_expires_at'],
    array['creator-premium-f3-c2-configuration-v1',(p_configuration->>'id')::uuid::text,
      p_configuration->>'client_contract',(p_configuration->>'buyer_id')::uuid::text,
      (p_configuration->>'creator_id')::uuid::text,(p_configuration->>'buyer_account_id')::uuid::text,
      (p_configuration->>'creator_account_id')::uuid::text,(p_configuration->>'platform_account_id')::uuid::text,
      (p_configuration->>'purchase_content_id')::uuid::text,(p_configuration->>'purchase_offer_version_id')::uuid::text,
      (p_configuration->>'subscription_plan_id')::uuid::text,
      (p_configuration->>'purchase_amount_bdag')::numeric(38,8)::text,
      (p_configuration->>'subscription_amount_bdag')::numeric(38,8)::text,
      (p_configuration->>'max_purchase_count')::integer::text,(p_configuration->>'max_subscription_count')::integer::text,
      (p_configuration->>'max_refund_count')::integer::text,(p_configuration->>'max_gross_bdag')::numeric(38,8)::text,
      (p_configuration->>'platform_fee_bps')::integer::text,
      (extract(epoch from (p_configuration->>'charge_starts_at')::timestamptz)*1000000)::bigint::text,
      (extract(epoch from (p_configuration->>'charge_expires_at')::timestamptz)*1000000)::bigint::text,
      (extract(epoch from (p_configuration->>'refund_expires_at')::timestamptz)*1000000)::bigint::text]);
$$;

create function private.creator_premium_finance_configuration_digest_f3_c2_v1(p_configuration jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    private.creator_premium_finance_configuration_payload_f3_c2_v1(p_configuration),'UTF8')),'hex');
$$;

create function private.creator_premium_finance_attestation_payload_f3_c2_v1(p_attestation jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select private.creator_premium_finance_serialize_f3_c2_v1(
    array['domain','configuration_digest','approval_reference','evidence_digest','repository',
      'protected_source_sha','environment','approved_at','attestation_version'],
    array['creator-premium-f3-c2-attestation-v1',p_attestation->>'configuration_digest',
      p_attestation->>'approval_reference',p_attestation->>'evidence_digest',p_attestation->>'repository',
      p_attestation->>'protected_source_sha',p_attestation->>'environment',
      (extract(epoch from (p_attestation->>'approved_at')::timestamptz)*1000000)::bigint::text,
      p_attestation->>'attestation_version']);
$$;

create function private.creator_premium_finance_attestation_digest_f3_c2_v1(p_attestation jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    private.creator_premium_finance_attestation_payload_f3_c2_v1(p_attestation),'UTF8')),'hex');
$$;

-- These vectors assert the bytes, without creating an approval or envelope.
do $$
declare v_configuration jsonb; v_attestation jsonb;
begin
  v_configuration := pg_catalog.jsonb_build_object(
    'id','10000000-0000-4000-8000-000000000001','client_contract','creator-premium-f3-v2',
    'buyer_id','10000000-0000-4000-8000-000000000002','creator_id','10000000-0000-4000-8000-000000000003',
    'buyer_account_id','10000000-0000-4000-8000-000000000004','creator_account_id','10000000-0000-4000-8000-000000000005',
    'platform_account_id','10000000-0000-4000-8000-000000000006','purchase_content_id','10000000-0000-4000-8000-000000000007',
    'purchase_offer_version_id','10000000-0000-4000-8000-000000000008','subscription_plan_id','10000000-0000-4000-8000-000000000009',
    'purchase_amount_bdag','1500.00000000','subscription_amount_bdag','1500.00000000',
    'max_purchase_count',1,'max_subscription_count',1,'max_refund_count',2,'max_gross_bdag','3000.00000000',
    'platform_fee_bps',2000,'charge_starts_at','2026-10-25T00:00:00.000001Z',
    'charge_expires_at','2026-10-25T00:30:00.000001Z','refund_expires_at','2026-10-25T01:00:00.000001Z');
  if private.creator_premium_finance_configuration_digest_f3_c2_v1(v_configuration)
    <> '1b83b17e9b3895a377dd8a12daad5d1a59aec562acbfcf00b068e8f47dfb6f17' then
    raise exception 'creator_premium_configuration_golden_vector_failed';
  end if;
  v_attestation := pg_catalog.jsonb_build_object(
    'configuration_digest','1b83b17e9b3895a377dd8a12daad5d1a59aec562acbfcf00b068e8f47dfb6f17',
    'approval_reference',U&'synthetic aprobaci\00F3n \+01F512',
    'evidence_digest',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('F3-C2 disposable fixture evidence','UTF8')),'hex'),
    'repository','local/disposable-creator-premium-f3-c2','protected_source_sha','0dace3e84031922a35f9213957bd77d886cf3b7a',
    'environment','disposable-postgresql','approved_at','2026-10-25T00:00:00Z',
    'attestation_version','creator-premium-f3-c2-attestation-v1');
  if private.creator_premium_finance_attestation_digest_f3_c2_v1(v_attestation)
    <> '504d68c0054e08b57679d6efd30a7fcf1209b22fdcc53cf99c7d06759f30a7b0' then
    raise exception 'creator_premium_attestation_golden_vector_failed';
  end if;
end;
$$;

create table private.creator_premium_finance_owner_attestations_f3_c2 (
  approval_digest text primary key check (approval_digest ~ '^[0-9a-f]{64}$'),
  configuration_digest text not null check (configuration_digest ~ '^[0-9a-f]{64}$'),
  approval_reference text not null check (pg_catalog.length(pg_catalog.btrim(approval_reference)) between 1 and 2000),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  repository text not null check (pg_catalog.length(pg_catalog.btrim(repository)) between 1 and 500),
  protected_source_sha text not null check (protected_source_sha ~ '^[0-9a-f]{40}$'),
  environment text not null check (pg_catalog.length(pg_catalog.btrim(environment)) between 1 and 200),
  approved_at timestamptz not null check (pg_catalog.isfinite(approved_at)),
  attestation_version text not null check (attestation_version='creator-premium-f3-c2-attestation-v1'),
  registered_at timestamptz not null default pg_catalog.clock_timestamp() check (pg_catalog.isfinite(registered_at)),
  registered_by name not null default current_user check (registered_by='postgres'),
  unique(approval_digest,configuration_digest)
);
alter table private.creator_premium_finance_owner_attestations_f3_c2 owner to postgres;
alter table private.creator_premium_finance_owner_attestations_f3_c2 enable row level security;
alter table private.creator_premium_finance_owner_attestations_f3_c2 force row level security;
revoke all on table private.creator_premium_finance_owner_attestations_f3_c2 from public,anon,authenticated,service_role;

create function private.guard_creator_premium_owner_attestation_f3_c2_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op<>'INSERT' then
    raise exception using errcode='23514',message='creator_premium_owner_attestation_immutable';
  end if;
  if current_user<>'postgres' or new.registered_by<>'postgres'
    or new.approval_digest is distinct from private.creator_premium_finance_attestation_digest_f3_c2_v1(pg_catalog.to_jsonb(new)) then
    raise exception using errcode='23514',message='creator_premium_owner_attestation_invalid';
  end if;
  return new;
end;
$$;
create trigger creator_premium_owner_attestation_f3_c2_insert_guard
before insert on private.creator_premium_finance_owner_attestations_f3_c2
for each row execute function private.guard_creator_premium_owner_attestation_f3_c2_v1();
create trigger creator_premium_owner_attestation_f3_c2_immutable_guard
before update or delete on private.creator_premium_finance_owner_attestations_f3_c2
for each row execute function private.guard_creator_premium_owner_attestation_f3_c2_v1();

alter table private.creator_premium_finance_authorizations
  add column closed_at timestamptz,
  add column closed_by text,
  add column close_reason text,
  add constraint creator_premium_finance_authorizations_f3_c2_attestation_fk
    foreign key(approval_digest,configuration_digest)
    references private.creator_premium_finance_owner_attestations_f3_c2(approval_digest,configuration_digest)
    on update restrict on delete restrict,
  add constraint creator_premium_finance_authorizations_f3_c2_closure_check check (
    (status='OPEN' and closed_at is null and closed_by is null and close_reason is null)
    or (status='CLOSED' and closed_at is not null and pg_catalog.isfinite(closed_at)
      and closed_by is not null and pg_catalog.length(pg_catalog.btrim(closed_by))>0
      and close_reason is not null and pg_catalog.length(pg_catalog.btrim(close_reason)) between 1 and 2000)
  );

create function private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.creator_premium_finance_authorizations envelope
    join private.creator_premium_finance_owner_attestations_f3_c2 attestation
      on (attestation.approval_digest,attestation.configuration_digest)=(envelope.approval_digest,envelope.configuration_digest)
    where envelope.id=p_authorization_id and envelope.platform_fee_bps=2000
      and envelope.configuration_digest=private.creator_premium_finance_configuration_digest_f3_c2_v1(pg_catalog.to_jsonb(envelope))
      and attestation.approval_digest=private.creator_premium_finance_attestation_digest_f3_c2_v1(pg_catalog.to_jsonb(attestation))
      and attestation.registered_by='postgres');
$$;

create function private.guard_creator_premium_authorization_insert_f3_c2_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status<>'OPEN' or new.closed_at is not null or new.closed_by is not null or new.close_reason is not null
    or new.platform_fee_bps<>2000
    or new.configuration_digest is distinct from private.creator_premium_finance_configuration_digest_f3_c2_v1(pg_catalog.to_jsonb(new))
    or not exists(select 1 from private.creator_premium_finance_owner_attestations_f3_c2 attestation
      where (attestation.approval_digest,attestation.configuration_digest)=(new.approval_digest,new.configuration_digest)
        and attestation.approval_digest=private.creator_premium_finance_attestation_digest_f3_c2_v1(pg_catalog.to_jsonb(attestation))
        and attestation.registered_by='postgres') then
    raise exception using errcode='23514',message='creator_premium_finance_authorization_attestation_invalid';
  end if;
  return new;
end;
$$;
create trigger creator_premium_finance_authorization_f3_c2_insert_integrity_guard
before insert on private.creator_premium_finance_authorizations
for each row execute function private.guard_creator_premium_authorization_insert_f3_c2_v1();

-- The original INSERT trigger still calls this same unconditional foundation
-- rejection. Only its UPDATE branch gains the monotonic lifecycle transition.
create or replace function private.guard_creator_premium_finance_authorization_f3_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    raise exception using errcode='55000',message='creator_premium_finance_foundation_off';
  end if;
  if tg_op='UPDATE' then
    if old.status='OPEN' and new.status='CLOSED'
      and (pg_catalog.to_jsonb(new)-array['status','closed_at','closed_by','close_reason'])
        is not distinct from (pg_catalog.to_jsonb(old)-array['status','closed_at','closed_by','close_reason'])
      and old.closed_at is null and old.closed_by is null and old.close_reason is null
      and new.closed_at is not null and pg_catalog.isfinite(new.closed_at)
      and new.closed_by='postgres' and pg_catalog.length(pg_catalog.btrim(new.close_reason)) between 1 and 2000
      and exists(select 1 from private.creator_premium_finance_policy policy where singleton
        and activation_mode='canary' and active_authorization_id=new.id
        and platform_fee_bps=new.platform_fee_bps
        and not purchase_enabled and not subscription_enabled) then
      return new;
    end if;
  end if;
  raise exception using errcode='23514',message='creator_premium_finance_authorization_immutable';
end;
$$;

create function private.close_creator_premium_finance_authorization_f3_c2_v1(p_authorization_id uuid,p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations; v_usage record; v_refunds boolean;
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='creator_premium_finance_owner_required';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='22023',message='creator_premium_finance_close_reason_invalid';
  end if;
  v_policy := private.lock_creator_premium_finance_f3_v1();
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope
    where id=p_authorization_id;
  if not found or v_authorization.status<>'OPEN' or v_policy.activation_mode<>'canary'
    or v_policy.active_authorization_id is distinct from p_authorization_id
    or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id) then
    raise exception using errcode='55000',message='creator_premium_finance_close_denied';
  end if;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(p_authorization_id);
  v_refunds := v_policy.refunds_enabled and pg_catalog.clock_timestamp()>=v_authorization.charge_starts_at
    and pg_catalog.clock_timestamp()<v_authorization.refund_expires_at
    and v_usage.refund_count<v_authorization.max_refund_count
    and v_usage.refund_count<v_usage.purchase_count+v_usage.subscription_count;
  update private.creator_premium_finance_policy set purchase_enabled=false,subscription_enabled=false,
    refunds_enabled=v_refunds where singleton;
  update private.creator_premium_finance_authorizations set status='CLOSED',closed_at=pg_catalog.clock_timestamp(),
    closed_by=current_user,close_reason=pg_catalog.btrim(p_reason) where id=p_authorization_id;
  if not v_refunds then
    update private.creator_premium_finance_policy set activation_mode='off',purchase_enabled=false,
      subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,active_authorization_id=null where singleton;
  end if;
end;
$$;

create function private.finalize_creator_premium_finance_authorization_f3_c2_v1(p_authorization_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations;
  v_usage record;
  v_has_unreversed_facts boolean;
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='creator_premium_finance_owner_required';
  end if;
  v_policy := private.lock_creator_premium_finance_f3_v1();
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope where id=p_authorization_id;
  if not found then
    raise exception using errcode='55000',message='creator_premium_finance_finalize_denied';
  end if;
  select * into v_usage from private.creator_premium_finance_consumption_f3_v1(p_authorization_id);
  select exists(
    select 1 from private.creator_premium_purchase_receipts receipt
    where receipt.finance_authorization_id=p_authorization_id and receipt.access_state<>'refunded'
    union all
    select 1 from private.creator_premium_subscription_periods period
    where period.finance_authorization_id=p_authorization_id and period.access_state<>'refunded'
  ) into v_has_unreversed_facts;
  if v_authorization.status<>'CLOSED' or v_policy.activation_mode<>'canary'
    or v_policy.active_authorization_id is distinct from p_authorization_id
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id)
    or exists(select 1 from private.creator_premium_purchase_receipts receipt where finance_authorization_id=p_authorization_id
      and not private.creator_premium_financial_fact_is_valid_v1(
          receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,receipt.access_state,
          receipt.buyer_id,receipt.creator_id,receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
          'creator_premium_purchase_receipt',receipt.id,'creator_premium_purchase','creator_premium_purchase_refund',
          receipt.idempotency_key,receipt.refund_idempotency_key,receipt.gross_amount_bdag,receipt.platform_fee_bdag,
          receipt.creator_net_bdag,receipt.platform_fee_bps))
    or exists(select 1 from private.creator_premium_subscription_periods period where finance_authorization_id=p_authorization_id
      and not private.creator_premium_financial_fact_is_valid_v1(
          period.financial_transaction_id,period.reversal_financial_transaction_id,period.access_state,
          period.subscriber_id,period.creator_id,period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
          'creator_premium_subscription_period',period.id,'creator_premium_subscription','creator_premium_subscription_refund',
          period.idempotency_key,period.refund_idempotency_key,period.gross_amount_bdag,period.platform_fee_bdag,
          period.creator_net_bdag,period.platform_fee_bps))
    or (v_has_unreversed_facts and v_policy.refunds_enabled
      and pg_catalog.clock_timestamp()<v_authorization.refund_expires_at
      and v_usage.refund_count<v_authorization.max_refund_count) then
    raise exception using errcode='55000',message='creator_premium_finance_finalize_denied';
  end if;
  update private.creator_premium_finance_policy set activation_mode='off',purchase_enabled=false,
    subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,active_authorization_id=null where singleton;
end;
$$;

create or replace function private.creator_premium_authorization_binding_f3_v1(
  p_authorization_id uuid,p_operation text,p_buyer_id uuid,p_creator_id uuid,
  p_target_id uuid,p_offer_id uuid,p_amount numeric,p_fee integer,
  p_buyer_account_id uuid,p_creator_account_id uuid,p_platform_account_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_authorization_id is null or exists(select 1 from private.creator_premium_finance_authorizations envelope
    where id=p_authorization_id and buyer_id=p_buyer_id and creator_id=p_creator_id
      and buyer_account_id=p_buyer_account_id and creator_account_id=p_creator_account_id
      and platform_account_id=p_platform_account_id and platform_fee_bps=p_fee
      and private.creator_premium_finance_authorization_integrity_f3_c2_v1(envelope.id)
      and ((p_operation='purchase' and purchase_content_id=p_target_id
        and purchase_offer_version_id=p_offer_id and purchase_amount_bdag=p_amount)
      or (p_operation='subscription' and subscription_plan_id=p_target_id
        and p_offer_id is null and subscription_amount_bdag=p_amount)));
$$;

create or replace function private.admit_creator_premium_refund_f3_v1(p_authorization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_policy private.creator_premium_finance_policy;
  v_authorization private.creator_premium_finance_authorizations; v_usage record;
begin
  v_policy := private.lock_creator_premium_finance_f3_v1();
  if v_policy.activation_mode<>'canary' or not v_policy.refunds_enabled then
    raise exception using errcode='55000',message='creator_premium_refunds_disabled';
  end if;
  select envelope.* into v_authorization from private.creator_premium_finance_authorizations envelope
    where id=v_policy.active_authorization_id;
  if not found or v_authorization.status not in ('OPEN','CLOSED')
    or p_authorization_id is distinct from v_authorization.id
    or v_policy.platform_fee_bps<>v_authorization.platform_fee_bps
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(v_authorization.id) then
    raise exception using errcode='55000',message='creator_premium_canary_denied';
  end if;
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
end;
$$;

create or replace function private.assert_creator_premium_finance_deadline_f3_v1(p_authorization_id uuid,p_operation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_envelope private.creator_premium_finance_authorizations; v_policy private.creator_premium_finance_policy;
begin
  if p_operation is null or p_operation not in ('charge','refund') then
    raise exception using errcode='22023',message='creator_premium_finance_operation_invalid';
  end if;
  select envelope.* into v_envelope from private.creator_premium_finance_authorizations envelope where id=p_authorization_id;
  if not found or (p_operation='charge' and v_envelope.status<>'OPEN')
    or (p_operation='refund' and v_envelope.status not in ('OPEN','CLOSED')) then
    raise exception using errcode='55000',message='creator_premium_canary_not_open';
  end if;
  select policy.* into strict v_policy from private.creator_premium_finance_policy policy where singleton;
  if v_policy.activation_mode<>'canary' or v_policy.active_authorization_id is distinct from p_authorization_id
    or v_policy.platform_fee_bps<>v_envelope.platform_fee_bps
    or (p_operation='refund' and not v_policy.refunds_enabled)
    or not private.creator_premium_finance_authorization_integrity_f3_c2_v1(p_authorization_id) then
    raise exception using errcode='55000',message='creator_premium_canary_denied';
  end if;
  if pg_catalog.clock_timestamp()<v_envelope.charge_starts_at then
    raise exception using errcode='55000',message='creator_premium_canary_not_open';
  end if;
  if pg_catalog.clock_timestamp()>=(case when p_operation='refund' then v_envelope.refund_expires_at else v_envelope.charge_expires_at end) then
    raise exception using errcode='55000',message='creator_premium_canary_expired';
  end if;
end;
$$;

-- A reference is insufficient provenance: the canonical fact must name this
-- exact original/reversal pair and its immutable economic authorization.
-- The generic accounting validator below still checks every transaction and
-- ledger leg; this bridge adds the missing authorization/fact relationship.
create function private.creator_premium_financial_provenance_f3_c2_v1(
  p_reference_type text,p_reference_id uuid,p_original_transaction_id uuid,p_reversal_transaction_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.creator_premium_purchase_receipts receipt
    where p_reference_type='creator_premium_purchase_receipt' and receipt.id=p_reference_id
      and receipt.financial_transaction_id=p_original_transaction_id
      and receipt.reversal_financial_transaction_id is not distinct from p_reversal_transaction_id
      and private.creator_premium_authorization_binding_f3_v1(receipt.finance_authorization_id,'purchase',
        receipt.buyer_id,receipt.creator_id,receipt.content_id,receipt.offer_version_id,
        receipt.gross_amount_bdag,receipt.platform_fee_bps,receipt.buyer_account_id,
        receipt.creator_account_id,receipt.platform_account_id))
    or exists(select 1 from private.creator_premium_subscription_periods period
      where p_reference_type='creator_premium_subscription_period' and period.id=p_reference_id
        and period.financial_transaction_id=p_original_transaction_id
        and period.reversal_financial_transaction_id is not distinct from p_reversal_transaction_id
        and private.creator_premium_authorization_binding_f3_v1(period.finance_authorization_id,'subscription',
          period.subscriber_id,period.creator_id,period.plan_id,null,period.gross_amount_bdag,
          period.platform_fee_bps,period.subscriber_account_id,period.creator_account_id,period.platform_account_id));
$$;

-- Preserve the canonical accounting checks and public projection contracts;
-- only the fact/authorization bridge and exact reconciliation counters change.
create or replace function private.creator_premium_financial_fact_is_valid_v1(
  p_original_transaction_id uuid,
  p_reversal_transaction_id uuid,
  p_access_state text,
  p_payer_id uuid,
  p_creator_id uuid,
  p_payer_account_id uuid,
  p_creator_account_id uuid,
  p_platform_account_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_charge_operation_type text,
  p_refund_operation_type text,
  p_charge_idempotency_key uuid,
  p_refund_idempotency_key uuid,
  p_gross_amount_bdag numeric,
  p_platform_fee_bdag numeric,
  p_creator_net_bdag numeric,
  p_platform_fee_bps integer
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1
    from public.financial_transactions original
    join public.ledger_accounts payer_account
      on payer_account.id=p_payer_account_id
     and payer_account.owner_id=p_payer_id
     and payer_account.account_type='user'
     and payer_account.currency='BDAG'
    join public.ledger_accounts creator_account
      on creator_account.id=p_creator_account_id
     and creator_account.owner_id=p_creator_id
     and creator_account.account_type='user'
     and creator_account.currency='BDAG'
    join public.ledger_accounts platform_account
      on platform_account.id=p_platform_account_id
     and platform_account.owner_id is null
     and platform_account.account_type='platform'
     and platform_account.currency='BDAG'
    left join public.financial_transactions reversal
      on reversal.id=p_reversal_transaction_id
    where original.id=p_original_transaction_id
      and private.creator_premium_financial_provenance_f3_c2_v1(
        p_reference_type,p_reference_id,p_original_transaction_id,p_reversal_transaction_id)
      and (p_reference_type,p_charge_operation_type,p_refund_operation_type) in (
        ('creator_premium_purchase_receipt','creator_premium_purchase','creator_premium_purchase_refund'),
        ('creator_premium_subscription_period','creator_premium_subscription','creator_premium_subscription_refund')
      )
      and (
        (p_reference_type='creator_premium_purchase_receipt'
          and p_access_state in ('active','revoked','refunded'))
        or
        (p_reference_type='creator_premium_subscription_period'
          and p_access_state in ('active','expired','revoked','refunded'))
      )
      and p_gross_amount_bdag>0
      and p_creator_net_bdag>0
      and p_platform_fee_bdag>=0
      and p_platform_fee_bps between 0 and 9999
      and p_gross_amount_bdag=p_creator_net_bdag+p_platform_fee_bdag
      and p_platform_fee_bdag=pg_catalog.round(
        p_gross_amount_bdag*p_platform_fee_bps/10000,8)
      and p_gross_amount_bdag=pg_catalog.round(p_gross_amount_bdag,8)
      and p_creator_net_bdag=pg_catalog.round(p_creator_net_bdag,8)
      and p_platform_fee_bdag=pg_catalog.round(p_platform_fee_bdag,8)
      and original.operation_type=p_charge_operation_type
      and original.reference_type=p_reference_type
      and original.reference_id=p_reference_id::text
      and original.from_account_id=p_payer_account_id
      and original.to_account_id=p_creator_account_id
      and original.amount=p_gross_amount_bdag
      and original.fee_amount=p_platform_fee_bdag
      and original.currency='BDAG'
      and original.initiated_by=p_payer_id
      and original.idempotency_key=p_charge_idempotency_key::text
      and original.status=case
        when p_access_state='refunded' then 'reversed'
        else 'completed'
      end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id)=case
          when p_platform_fee_bdag=0 then 2 else 3 end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id
          and entry.account_id=p_payer_account_id
          and entry.entry_type='debit'
          and entry.amount=p_gross_amount_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'=p_reference_type
          and entry.metadata->>'reference_id'=p_reference_id::text
          and entry.metadata->>'financial_leg'='payer_gross_debit')=1
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id
          and entry.account_id=p_creator_account_id
          and entry.entry_type='credit'
          and entry.amount=p_creator_net_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'=p_reference_type
          and entry.metadata->>'reference_id'=p_reference_id::text
          and entry.metadata->>'financial_leg'='creator_net_credit')=1
      and (
        p_platform_fee_bdag=0
        or (select pg_catalog.count(*) from public.ledger_entries entry
          where entry.txn_id=original.id
            and entry.account_id=p_platform_account_id
            and entry.entry_type='credit'
            and entry.amount=p_platform_fee_bdag
            and entry.metadata->>'fin_txn_id'=original.id::text
            and entry.metadata->>'reference_type'=p_reference_type
            and entry.metadata->>'reference_id'=p_reference_id::text
            and entry.metadata->>'financial_leg'='platform_fee_credit')=1
      )
      and (
        (p_access_state<>'refunded'
          and p_reversal_transaction_id is null
          and p_refund_idempotency_key is null)
        or
        (p_access_state='refunded'
          and p_reversal_transaction_id is not null
          and p_refund_idempotency_key is not null
          and reversal.status='completed'
          and reversal.operation_type=p_refund_operation_type
          and reversal.reference_type=p_reference_type
          and reversal.reference_id=p_reference_id::text
          and reversal.from_account_id=p_creator_account_id
          and reversal.to_account_id=p_payer_account_id
          and reversal.amount=p_gross_amount_bdag
          and reversal.fee_amount=p_platform_fee_bdag
          and reversal.currency='BDAG'
          and reversal.initiated_by=p_payer_id
          and reversal.idempotency_key=p_refund_idempotency_key::text
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id)=case
              when p_platform_fee_bdag=0 then 2 else 3 end
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id
              and entry.account_id=p_creator_account_id
              and entry.entry_type='debit'
              and entry.amount=p_creator_net_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'=p_reference_type
              and entry.metadata->>'reference_id'=p_reference_id::text
              and entry.metadata->>'financial_leg'='creator_net_debit')=1
          and (
            p_platform_fee_bdag=0
            or (select pg_catalog.count(*) from public.ledger_entries entry
              where entry.txn_id=reversal.id
                and entry.account_id=p_platform_account_id
                and entry.entry_type='debit'
                and entry.amount=p_platform_fee_bdag
                and entry.metadata->>'fin_txn_id'=reversal.id::text
                and entry.metadata->>'reference_type'=p_reference_type
                and entry.metadata->>'reference_id'=p_reference_id::text
                and entry.metadata->>'financial_leg'='platform_fee_debit')=1
          )
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id
              and entry.account_id=p_payer_account_id
              and entry.entry_type='credit'
              and entry.amount=p_gross_amount_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'=p_reference_type
              and entry.metadata->>'reference_id'=p_reference_id::text
              and entry.metadata->>'financial_leg'='payer_gross_credit')=1)
      )
  ),false);
$$;

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
  ), canonical_transactions as (
    select receipt.financial_transaction_id as transaction_id,
      'creator_premium_purchase'::text as operation_type,
      'creator_premium_purchase_receipt'::text as reference_type,
      receipt.id as reference_id
    from private.creator_premium_purchase_receipts receipt
    union all
    select receipt.reversal_financial_transaction_id,
      'creator_premium_purchase_refund','creator_premium_purchase_receipt',receipt.id
    from private.creator_premium_purchase_receipts receipt
    where receipt.reversal_financial_transaction_id is not null
    union all
    select period.financial_transaction_id,
      'creator_premium_subscription','creator_premium_subscription_period',period.id
    from private.creator_premium_subscription_periods period
    union all
    select period.reversal_financial_transaction_id,
      'creator_premium_subscription_refund','creator_premium_subscription_period',period.id
    from private.creator_premium_subscription_periods period
    where period.reversal_financial_transaction_id is not null
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
      from (
        select finance_tx.id as transaction_id
        from public.financial_transactions finance_tx
        where finance_tx.operation_type in (
          'creator_premium_purchase','creator_premium_purchase_refund',
          'creator_premium_subscription','creator_premium_subscription_refund'
        ) and (
          not exists(
            select 1 from canonical_transactions fact
            where fact.transaction_id=finance_tx.id
              and fact.operation_type=finance_tx.operation_type
              and fact.reference_type=finance_tx.reference_type
              and fact.reference_id::text=finance_tx.reference_id
          ) or exists(
            select 1 from public.ledger_entries entry
            where entry.txn_id=finance_tx.id
              and not exists(
                select 1 from canonical_transactions fact
                where fact.transaction_id=finance_tx.id
                  and fact.operation_type=finance_tx.operation_type
                  and fact.reference_type=finance_tx.reference_type
                  and fact.reference_id::text=finance_tx.reference_id
                  and entry.metadata->>'fin_txn_id'=fact.transaction_id::text
                  and entry.metadata->>'reference_type'=fact.reference_type
                  and entry.metadata->>'reference_id'=fact.reference_id::text
              )
          )
        )
        union
        select entry.txn_id
        from public.ledger_entries entry
        left join public.financial_transactions finance_tx on finance_tx.id=entry.txn_id
        where entry.metadata->>'reference_type' in (
          'creator_premium_purchase_receipt','creator_premium_subscription_period'
        ) and (
          finance_tx.id is null or finance_tx.operation_type not in (
            'creator_premium_purchase','creator_premium_purchase_refund',
            'creator_premium_subscription','creator_premium_subscription_refund'
          )
        )
      ) orphan_provenance),
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

-- Every private helper remains owner-only, including pure payload helpers.
do $$
declare v_function record;
begin
  for v_function in
    select proc.oid::regprocedure as signature from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid=proc.pronamespace
    where namespace.nspname='private' and (
      proc.proname like '%creator_premium%f3_c2_v1'
      or proc.proname in ('guard_creator_premium_finance_authorization_f3_v1',
        'creator_premium_authorization_binding_f3_v1','admit_creator_premium_refund_f3_v1',
        'assert_creator_premium_finance_deadline_f3_v1','creator_premium_financial_fact_is_valid_v1')
    )
  loop
    execute pg_catalog.format('alter function %s owner to postgres',v_function.signature);
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  end loop;
end;
$$;

alter function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
