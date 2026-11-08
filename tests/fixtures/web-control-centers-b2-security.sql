-- Run against the actual B2 migration in disposable PostgreSQL 17.
do $assertions$
declare v_name text; v_signature text; v_role text; v_proc pg_catalog.pg_proc;
begin
  foreach v_name in array array['publication_schedule_policy','publication_schedules',
    'publication_schedule_commands','publication_schedule_attempts','publication_schedule_materializations'] loop
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=v_name and c.relrowsecurity and c.relforcerowsecurity)
      then raise exception 'B2 RLS missing: %',v_name; end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(v_role,'private.'||v_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        then raise exception 'B2 direct table privilege: % %',v_role,v_name; end if;
    end loop;
  end loop;
  foreach v_signature in array array[
    'schedule_my_publication_draft_v1(uuid,bigint,uuid,timestamp without time zone,text,integer)',
    'list_my_publication_schedules_v1(integer,timestamp with time zone,uuid)',
    'reschedule_my_publication_v1(uuid,bigint,uuid,timestamp without time zone,text,integer)',
    'cancel_my_publication_schedule_v1(uuid,bigint,uuid)',
    'retry_my_publication_schedule_v1(uuid,bigint,uuid)'] loop
    select p.* into strict v_proc from pg_catalog.pg_proc p where p.oid=('public.'||v_signature)::regprocedure;
    if not v_proc.prosecdef or v_proc.proconfig is distinct from array['search_path=""']
      or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
      or v_proc.prorettype<>'jsonb'::regtype then raise exception 'B2 unsafe RPC: %',v_signature; end if;
    if not pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
      or exists(select 1 from pg_catalog.aclexplode(v_proc.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')
      then raise exception 'B2 unsafe ACL: %',v_signature; end if;
  end loop;
  for v_proc in select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like '%publication_schedule%' or p.proname='execute_publication_schedule_command_v1') loop
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(v_role,v_proc.oid,'EXECUTE')
        then raise exception 'B2 private helper exposed: %',v_proc.proname; end if;
    end loop;
  end loop;
end
$assertions$;
