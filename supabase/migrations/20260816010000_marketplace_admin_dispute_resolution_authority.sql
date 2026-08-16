-- MKT-B8D-3-C5: restore the trusted admin bridge to dispute resolution.
begin;

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
  v_role text;
  v_claims_text text;
  v_claims jsonb;
  v_action text;
  v_reason text:=lower(btrim(coalesce(p_reason_code,'')));
  v_note text:=nullif(btrim(p_note),'');
  v_fingerprint text;
  v_prior public.marketplace_admin_action_audit;
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

  -- The core resolver is intentionally service-role-only. This trusted wrapper
  -- has already derived and verified the admin actor, so it temporarily amends
  -- the server-side JWT claims while preserving the authenticated subject.
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
    v_result:=public.resolve_marketplace_dispute(
      v_actor,p_dispute_id,p_outcome,v_reason,v_note,p_idempotency_key,null);
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
        v_result->'finalDecision'->>'id',v_result->'reviewAction'->>'id'),
      'money_moved',coalesce(
        (v_result->>'money_moved')::boolean,
        (v_result->'finalDecision'->'financial_result'->>'money_moved')::boolean,
        false)))
  on conflict(actor_id,idempotency_key) do nothing;
  return v_result;
end
$$;

create or replace function public.get_my_marketplace_admin_dispute_resolution_result(
  p_dispute_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=public.marketplace_require_admin();
  v_audit public.marketplace_admin_action_audit;
begin
  if p_dispute_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_admin_resolution_lookup_invalid';
  end if;
  select * into v_audit
  from public.marketplace_admin_action_audit
  where actor_id=v_actor
    and idempotency_key=p_idempotency_key
    and target_type='dispute'
    and target_id=p_dispute_id;
  if not found then return null;end if;
  return jsonb_build_object(
    'committed',true,
    'action',v_audit.action,
    'target_id',v_audit.target_id,
    'idempotency_key',v_audit.idempotency_key,
    'result_kind',v_audit.metadata->>'result_kind',
    'canonical_id',v_audit.metadata->>'canonical_id',
    'money_moved',coalesce((v_audit.metadata->>'money_moved')::boolean,false));
end
$$;

revoke all on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)
  from public,anon;
grant execute on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)
  to authenticated,service_role;
revoke all on function public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)
  from public,anon;
grant execute on function public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)
  to authenticated,service_role;

comment on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid) is
  'Authenticated admin-only bridge that derives the actor, establishes trusted server-side resolver context, and accepts no financial authority.';
comment on function public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid) is
  'Admin-only canonical idempotency receipt lookup for ambiguous dispute-resolution transport outcomes.';

notify pgrst,'reload schema';
commit;
