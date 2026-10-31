-- Control Center MFA policy v1. Extend the canonical catalog only.
-- Enable only the approved nondelegable root refund capability. No domain data
-- or financial records are changed, and no refund RPC is executed.
alter table private.admin_capabilities
  add column required_aal text not null default 'aal1',
  add constraint admin_capabilities_required_aal_check check(required_aal in('aal1','aal2'));

update private.admin_capabilities set required_aal='aal2'
where is_sensitive and effect in('write','workflow');

update private.admin_capabilities set required_aal='aal2'
where capability_code='creator_premium.refunds.write';

insert into private.admin_role_capabilities(role_code,capability_code)
values('SUPER_ADMIN','creator_premium.refunds.write')
on conflict(role_code,capability_code) do nothing;

-- Fail closed on catalog drift; never broaden roles or rewrite delegation.
do $$begin
  if (select required_aal from private.admin_capabilities
      where capability_code='creator_premium.refunds.write') is distinct from 'aal2'
    or (select array_agg(role_code order by role_code) from private.admin_role_capabilities
        where capability_code='creator_premium.refunds.write') is distinct from array['SUPER_ADMIN']
    or not exists(select 1 from private.admin_roles
      where role_code='SUPER_ADMIN' and is_root and is_exclusive and not is_assignable)
    or exists(select 1 from private.admin_role_grant_rules where target_role_code='SUPER_ADMIN') then
    raise exception 'control_center_refund_authority_invalid';
  end if;
end$$;

alter table private.admin_capabilities
  add constraint admin_capabilities_sensitive_aal_check
  check(not (is_sensitive and effect in('write','workflow')) or required_aal='aal2');

comment on column private.admin_capabilities.required_aal is
  'Control Center MFA policy v1: sensitive write/workflow requires aal2; shell, reads and enrollment remain aal1.';

-- CREATE OR REPLACE retains existing owners; preserve the definer, search path and ACL.
create or replace function public.admin_actor_has_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];v_required_aal text;
begin
  if v_actor is null or p_capability is null then return false;end if;
  if not exists(select 1 from auth.users where id=v_actor and deleted_at is null
    and (banned_until is null or banned_until<=now())) then return false;end if;
  select required_aal into v_required_aal from private.admin_capabilities where capability_code=p_capability;
  if not found then return false;end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then return false;end if;
  if not p_capability=any(private.admin_effective_capabilities(v_actor)) then return false;end if;
  if coalesce(auth.jwt()->>'aal','aal1') not in('aal1','aal2') then return false;end if;
  return v_required_aal='aal1' or coalesce(auth.jwt()->>'aal','aal1')='aal2';
end;
$$;

create or replace function public.admin_require_capability(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];v_required_aal text;
begin
  if v_actor is null then raise exception using errcode='28000',message='admin_auth_required';end if;
  if not exists(select 1 from auth.users where id=v_actor and deleted_at is null
    and (banned_until is null or banned_until<=now())) then
    raise exception using errcode='42501',message='admin_actor_inactive';
  end if;
  select required_aal into v_required_aal from private.admin_capabilities where capability_code=p_capability;
  if not found then raise exception using errcode='22023',message='admin_capability_invalid';end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then
    raise exception using errcode='42501',message='admin_role_set_invalid';
  end if;
  if not p_capability=any(private.admin_effective_capabilities(v_actor)) then
    raise exception using errcode='42501',message='admin_capability_forbidden';
  end if;
  if coalesce(auth.jwt()->>'aal','aal1') not in('aal1','aal2') then
    raise exception using errcode='42501',message='admin_assurance_invalid';
  end if;
  if v_required_aal='aal2' and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception using errcode='42501',message='admin_aal2_required';
  end if;
  return v_actor;
end;
$$;

-- Bootstrap shares the active-account boundary, while remaining available at AAL1.
create or replace function public.get_my_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid:=auth.uid();v_roles text[];v_capabilities text[];v_profile record;v_admin boolean;
begin
  if v_actor is null then raise exception using errcode='28000',message='admin_auth_required';end if;
  if not exists(select 1 from auth.users where id=v_actor and deleted_at is null
    and (banned_until is null or banned_until<=now())) then
    raise exception using errcode='42501',message='admin_actor_inactive';
  end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then
    raise exception using errcode='42501',message='admin_role_set_invalid';
  end if;
  v_capabilities:=private.admin_effective_capabilities(v_actor);
  v_admin:='admin.shell.access'=any(v_capabilities);
  if not v_admin then
    return jsonb_build_object('admin',false,'roles','[]'::jsonb,'capabilities','[]'::jsonb,
      'effective_capabilities','[]'::jsonb,'authority_version',private.admin_authority_version(v_actor));
  end if;
  select id,username,display_name,avatar_url into v_profile
  from public.public_user_profiles where id=v_actor;
  return jsonb_build_object(
    'user_id',v_actor,'username',v_profile.username,'display_name',v_profile.display_name,
    'avatar_url',v_profile.avatar_url,'admin',true,'roles',to_jsonb(v_roles),
    'capabilities',to_jsonb(v_capabilities),'effective_capabilities',to_jsonb(v_capabilities),
    'authority_version',private.admin_authority_version(v_actor));
end;
$$;

revoke all on function public.get_my_admin_access() from public,anon,authenticated,service_role;
grant execute on function public.get_my_admin_access() to authenticated;
revoke all on function public.admin_actor_has_capability(text) from public,anon,authenticated,service_role;
revoke all on function public.admin_require_capability(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_actor_has_capability(text) to authenticated;
grant execute on function public.admin_require_capability(text) to authenticated;
