begin;

-- A7 closes only the authority already migrated by A3. Abort rather than
-- infer or create assignments if production does not match the approved
-- authority catalog and legacy-user correspondence.
do $precheck$
declare
  v_legacy_admins integer;
  v_canonical_matches integer;
begin
  if (select count(*) from private.admin_roles) <> 6 then
    raise exception using errcode='55000',message='a7_role_catalog_drift';
  end if;
  if (select count(*) from private.admin_capabilities) <> 47 then
    raise exception using errcode='55000',message='a7_capability_catalog_drift';
  end if;
  if (select count(*) from private.admin_role_capabilities) <> 142 then
    raise exception using errcode='55000',message='a7_role_capability_mapping_drift';
  end if;
  if (select count(*) from private.admin_role_grant_rules) <> 7 then
    raise exception using errcode='55000',message='a7_role_grant_rule_drift';
  end if;
  if (select count(*) from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) <> 0 then
    raise exception using errcode='55000',message='a7_super_admin_assignment_unexpected';
  end if;
  if (select count(*) from private.admin_user_roles where role_code='MARKETPLACE_ADMIN' and revoked_at is null) <> 1 then
    raise exception using errcode='55000',message='a7_marketplace_admin_assignment_drift';
  end if;

  select count(*) into v_legacy_admins
  from public.user_profiles
  where is_admin is true;
  if v_legacy_admins <> 1 then
    raise exception using errcode='55000',message='a7_legacy_admin_count_drift',detail=v_legacy_admins::text;
  end if;

  select count(*) into v_canonical_matches
  from public.user_profiles up
  join private.admin_user_roles aur
    on aur.user_id=up.id
   and aur.role_code='MARKETPLACE_ADMIN'
   and aur.revoked_at is null
  where up.is_admin is true;
  if v_canonical_matches <> v_legacy_admins then
    raise exception using errcode='55000',message='a7_legacy_admin_not_canonicalized';
  end if;
end
$precheck$;

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self
on public.user_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = id
  and dag_balance = 0
  and followers_count = 0
  and following_count = 0
);

create or replace function public.protect_user_profile_server_fields()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare
  v_trusted_role boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
begin
  if v_trusted_role then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.dag_balance <> 0
      or new.followers_count <> 0
      or new.following_count <> 0 then
      raise exception using errcode = '42501', message = 'user_profile_server_field_forbidden';
    end if;
  else
    if new.dag_balance is distinct from old.dag_balance
      or new.followers_count is distinct from old.followers_count
      or new.following_count is distinct from old.following_count
      or new.id is distinct from old.id
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'user_profile_server_field_forbidden';
    end if;
  end if;

  return new;
end
$$;

drop function public.get_my_marketplace_admin_access();
drop function public.marketplace_actor_is_admin();
drop function public.marketplace_require_admin();

alter table public.user_profiles
  drop column is_admin;

do $postcheck$
begin
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='user_profiles'
      and a.attname='is_admin'
      and not a.attisdropped
  ) then
    raise exception using errcode='55000',message='a7_legacy_admin_column_remains';
  end if;
  if to_regprocedure('public.get_my_marketplace_admin_access()') is not null
    or to_regprocedure('public.marketplace_actor_is_admin()') is not null
    or to_regprocedure('public.marketplace_require_admin()') is not null then
    raise exception using errcode='55000',message='a7_legacy_marketplace_adapter_remains';
  end if;
  if (select count(*) from private.admin_roles) <> 6
    or (select count(*) from private.admin_capabilities) <> 47
    or (select count(*) from private.admin_role_capabilities) <> 142
    or (select count(*) from private.admin_role_grant_rules) <> 7 then
    raise exception using errcode='55000',message='a7_authority_catalog_changed';
  end if;
  if (select count(*) from private.admin_user_roles where role_code='MARKETPLACE_ADMIN' and revoked_at is null) <> 1
    or (select count(*) from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) <> 0 then
    raise exception using errcode='55000',message='a7_authority_assignment_changed';
  end if;
end
$postcheck$;

commit;
