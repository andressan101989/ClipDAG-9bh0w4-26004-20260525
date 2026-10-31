select set_config('task5.actor','active',false);
select set_config('task5.caps','finance.ledger.read,finance.audit.read,admin.audit.read,system.audit.read,advertising.billing.read,users.accounts.read',false);
do $$declare r record;begin
 for r in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'search_admin_%' loop
 perform task5_proof.assert(pg_get_userbyid(r.proowner)='postgres' and r.prosecdef and r.provolatile='s' and r.proconfig @> array['search_path=""'],r.proname||' owner/definer/stable/path');
 perform task5_proof.assert(has_function_privilege('authenticated',r.oid,'execute') and not has_function_privilege('anon',r.oid,'execute') and not has_function_privilege('service_role',r.oid,'execute'),r.proname||' role ACL');
 perform task5_proof.assert(not exists(select 1 from aclexplode(r.proacl) where grantee=0 and privilege_type='EXECUTE'),r.proname||' no PUBLIC execute');
 end loop;
 perform task5_proof.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r' and (not relrowsecurity or not relforcerowsecurity)),'RLS/FORCE RLS retained');
end$$;
set role authenticated;
do $$declare name text;data jsonb;next jsonb;ids uuid[];row jsonb;cursor jsonb;expected integer;begin
 foreach name in array array['search_admin_ledger_accounts','search_admin_financial_transactions','search_admin_global_audit','search_admin_finance_audit','search_admin_system_audit'] loop
  expected:=case name when 'search_admin_global_audit' then 20 when 'search_admin_finance_audit' then 10 else 5 end;
  execute format('select public.%I(p_limit=>%s)',name,expected) into data;
  perform task5_proof.assert(jsonb_array_length(data->'items')=expected and data->'next_cursor'='null',name||' exact-full terminal');
  execute format('select public.%I(p_limit=>100)',name) into data;
  perform task5_proof.assert(jsonb_array_length(data->'items')=expected and data->'next_cursor'='null',name||' undersized terminal');
  ids:='{}';cursor:=null;
  loop
   execute format('select public.%I(p_limit=>2,p_cursor_created_at=>$1,p_cursor_id=>$2)',name) into data using (cursor->>'created_at')::timestamptz,(cursor->>'id')::uuid;
   for row in select * from jsonb_array_elements(data->'items') loop ids:=array_append(ids,(row->>'id')::uuid);end loop;
   cursor:=nullif(data->'next_cursor','null');exit when cursor is null;
   perform task5_proof.assert(cardinality(ids)<=expected,name||' bounded keyset loop');
  end loop;
  perform task5_proof.assert(cardinality(ids)=expected and (select count(distinct value) from unnest(ids)value)=expected,name||' no duplicates/gaps across tied timestamps');
  perform task5_proof.assert(ids=(select array_agg(value order by value desc) from unnest(ids)value),name||' descending UUID tie break');
  execute format('select public.%I(p_limit=>2,p_cursor_created_at=>''1900-01-01Z'',p_cursor_id=>$1)',name) into data using task5_proof.id(1);
  perform task5_proof.assert(data='{"items":[],"next_cursor":null}',name||' empty terminal');
  begin execute format('select public.%I(p_cursor_id=>$1)',name) into data using task5_proof.id(1);raise exception 'partial cursor accepted';exception when invalid_parameter_value then null;end;
  begin execute format('select public.%I(p_cursor_created_at=>now())',name) into data;raise exception 'partial cursor accepted';exception when invalid_parameter_value then null;end;
  raise notice 'PAGINATION PASS: % exact-full/undersized/empty/keyset/partial',name;
 end loop;
 data:=public.search_admin_global_audit();
 perform task5_proof.assert(data::text !~ 'secret-|idempotency_key|"email"|"raw"','global PII/financial redaction');
 perform task5_proof.assert(not exists(select 1 from jsonb_array_elements(data->'items')r where r->'reason'<>'null' or r->'target_ref'<>'null'),'reason/target_ref redacted');
 data:=public.search_admin_finance_audit();
 perform task5_proof.assert(data::text !~ 'secret-|idempotency_key|"email"|"raw"','finance redaction');
 perform task5_proof.assert(exists(select 1 from jsonb_array_elements(data->'items')r where r->>'domain'='advertising'),'latest Ads rate visibility preserved');
 perform set_config('task5.caps','finance.audit.read,admin.audit.read',false);
 data:=public.search_admin_finance_audit();perform task5_proof.assert(jsonb_array_length(data->'items')=5 and not exists(select 1 from jsonb_array_elements(data->'items')r where r->>'domain'='advertising'),'Ads requires billing capability');
 data:=public.search_admin_global_audit();perform task5_proof.assert(jsonb_array_length(data->'items')=5,'global domain intersection');
 foreach name in array array['search_admin_ledger_accounts','search_admin_financial_transactions','search_admin_global_audit','search_admin_finance_audit','search_admin_system_audit'] loop
  perform set_config('task5.caps','',false);
  begin execute format('select public.%I()',name);raise exception 'missing capability allowed';exception when insufficient_privilege then null;end;
 end loop;
 begin perform count(*) from public.ledger_accounts;raise exception 'direct table access allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- A separate grant proves forced RLS actually denies rows, not just table ACL.
grant select on public.ledger_accounts to authenticated;
set role authenticated;
select task5_proof.assert((select count(*) from public.ledger_accounts)=0,'forced RLS denies direct browser rows even with SELECT');
reset role;revoke select on public.ledger_accounts from authenticated;
set role anon;
do $$begin begin perform public.search_admin_ledger_accounts();raise exception 'anon execute allowed';exception when insufficient_privilege then null;end;end$$;
reset role;set role service_role;
do $$begin begin perform public.search_admin_ledger_accounts();raise exception 'service execute allowed';exception when insufficient_privilege then null;end;end$$;
reset role;
select task5_proof.assert(task5_proof.snapshot()=(select digest from task5_proof.baseline),'all synthetic row digests unchanged');
select 'TASK5 PASS: latest predecessor, terminal cursors, ACL, RLS, redaction, Ads visibility, immutable rows';
