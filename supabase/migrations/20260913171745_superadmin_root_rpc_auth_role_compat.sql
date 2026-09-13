-- SUPERADMIN-NELYON-A1-F3
-- Keep the canonical root workflows compatible with both legacy and current
-- PostgREST JWT claim settings through the platform-owned auth.role() helper.

create or replace function public.admin_trusted_provision_super_admin(
  p_user_id uuid,p_reason text,p_operator_reference text,p_idempotency_key uuid,
  p_replace_existing_roles boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_reason text:=nullif(btrim(p_reason),'');v_operator text:=nullif(btrim(p_operator_reference),'');
  v_scope text:='v1|trusted_operator|admin.root.provision';v_fingerprint text;
  v_prior private.admin_action_audit;v_existing private.admin_user_roles;v_assignment private.admin_user_roles;
  v_receipt jsonb;v_child_key uuid;v_child_fingerprint text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='admin_trusted_operator_required';
  end if;
  if p_user_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 or v_operator is null
     or char_length(v_operator) not between 8 and 200 then
    raise exception using errcode='22023',message='admin_root_provision_invalid';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
    'action','admin.root.provision','target_type','user','target_id',p_user_id,
    'role_code','SUPER_ADMIN','reason',v_reason,'replace_existing_roles',p_replace_existing_roles));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-super-admin-roster',0));
  perform pg_advisory_xact_lock(hashtextextended('admin-role-target:'||p_user_id::text,0));
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null) then
    raise exception using errcode='P0002',message='admin_root_target_not_found';
  end if;
  if exists(select 1 from private.admin_user_roles where user_id=p_user_id
    and role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception using errcode='23505',message='admin_root_already_active';
  end if;
  if exists(select 1 from private.admin_user_roles where user_id=p_user_id and revoked_at is null)
     and not p_replace_existing_roles then
    raise exception using errcode='55000',message='admin_root_requires_atomic_role_replacement';
  end if;
  if p_replace_existing_roles then
    for v_existing in select * from private.admin_user_roles
      where user_id=p_user_id and revoked_at is null for update
    loop
      update private.admin_user_roles set
        revoke_actor_kind='trusted_operator',revoked_by_user_id=null,
        revoke_operator_reference=v_operator,revoked_at=clock_timestamp(),
        revoke_reason='Atomic replacement for SUPER_ADMIN: '||v_reason,version=version+1
      where id=v_existing.id returning * into v_existing;
      v_child_key:=md5(p_idempotency_key::text||':'||v_existing.id::text)::uuid;
      v_child_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
        'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
        'action','admin.role.revoke_for_root','assignment_id',v_existing.id,
        'target_id',p_user_id,'role_code',v_existing.role_code,'reason',v_reason));
      insert into private.admin_action_audit(
        actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
        target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
        idempotency_scope,idempotency_key,request_fingerprint
      ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.role.revoke_for_root',
        'user',p_user_id,v_existing.role_code,'Atomic replacement for SUPER_ADMIN: '||v_reason,
        'succeeded',false,true,jsonb_build_object('operator_reference',v_operator,
          'assignment_id',v_existing.id,'version',v_existing.version),
        'v1|trusted_operator|admin.role.revoke_for_root',v_child_key,v_child_fingerprint);
    end loop;
  end if;
  insert into private.admin_user_roles(
    user_id,role_code,grant_actor_kind,granted_by_user_id,grant_operator_reference,grant_reason
  ) values(p_user_id,'SUPER_ADMIN','trusted_operator',null,v_operator,v_reason)
  returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',p_user_id,
    'role_code','SUPER_ADMIN','version',v_assignment.version,'granted_at',v_assignment.granted_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.root.provision','user',
    p_user_id,'SUPER_ADMIN',v_reason,'succeeded',false,true,
    jsonb_build_object('operator_reference',v_operator,'receipt',v_receipt),v_scope,
    p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create or replace function public.admin_trusted_revoke_super_admin(
  p_assignment_id uuid,p_reason text,p_operator_reference text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_reason text:=nullif(btrim(p_reason),'');v_operator text:=nullif(btrim(p_operator_reference),'');
  v_scope text:='v1|trusted_operator|admin.root.revoke';v_fingerprint text;
  v_prior private.admin_action_audit;v_assignment private.admin_user_roles;v_receipt jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='admin_trusted_operator_required';
  end if;
  if p_assignment_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 or v_operator is null
     or char_length(v_operator) not between 8 and 200 then
    raise exception using errcode='22023',message='admin_root_revocation_invalid';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
    'action','admin.root.revoke','assignment_id',p_assignment_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-super-admin-roster',0));
  select * into v_assignment from private.admin_user_roles
    where id=p_assignment_id and role_code='SUPER_ADMIN' for update;
  if not found or v_assignment.revoked_at is not null then
    raise exception using errcode='P0002',message='admin_root_assignment_not_active';
  end if;
  if (select count(*) from private.admin_user_roles
      where role_code='SUPER_ADMIN' and revoked_at is null)<=1 then
    raise exception using errcode='55000',message='admin_last_super_admin';
  end if;
  update private.admin_user_roles set
    revoke_actor_kind='trusted_operator',revoked_by_user_id=null,revoke_operator_reference=v_operator,
    revoked_at=clock_timestamp(),revoke_reason=v_reason,version=version+1
  where id=v_assignment.id returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',v_assignment.user_id,
    'role_code','SUPER_ADMIN','version',v_assignment.version,'revoked_at',v_assignment.revoked_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.root.revoke','user',
    v_assignment.user_id,'SUPER_ADMIN',v_reason,'succeeded',false,true,
    jsonb_build_object('operator_reference',v_operator,'receipt',v_receipt),v_scope,
    p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

revoke all on function public.admin_trusted_provision_super_admin(uuid,text,text,uuid,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_trusted_revoke_super_admin(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.admin_trusted_provision_super_admin(uuid,text,text,uuid,boolean)
  to service_role;
grant execute on function public.admin_trusted_revoke_super_admin(uuid,text,text,uuid)
  to service_role;
