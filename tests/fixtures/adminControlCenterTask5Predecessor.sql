-- Reduced synthetic dependencies. The proof loader adds the exact latest
-- predecessor function bodies from committed migrations, never copies them.
create role anon nologin;create role authenticated nologin;create role service_role nologin;
create schema private;create schema task5_proof;
create function task5_proof.assert(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end$$;
create function task5_proof.id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
-- Controlled authority inputs; real canonical guards are proved separately by
-- prove-admin-control-center-mfa.mjs, including every role/AAL combination.
create function public.admin_actor_has_capability(cap text) returns boolean language sql stable security definer set search_path='' as $$select current_setting('task5.actor',true)='active' and cap=any(string_to_array(current_setting('task5.caps',true),','))$$;
create function public.admin_require_capability(cap text) returns void language plpgsql stable security definer set search_path='' as $$begin if not coalesce(public.admin_actor_has_capability(cap),false) then raise exception using errcode='42501',message='fixture_forbidden';end if;end$$;
create table public.user_profiles(id uuid primary key,username text,display_name text,avatar_url text,email text);
create table public.ledger_accounts(id uuid primary key,owner_id uuid,account_type text,currency text,balance numeric,frozen boolean,created_at timestamptz,updated_at timestamptz,secret text);
create table public.financial_transactions(id uuid primary key,operation_type text,amount numeric,fee_amount numeric,currency text,status text,reference_type text,created_at timestamptz,secret text);
create table public.ledger_entries(id uuid primary key,txn_id uuid);
create table private.admin_action_audit(id uuid primary key,actor_id uuid,actor_kind text,actor_role_snapshot jsonb,actor_capability text,domain text,action text,target_type text,target_id uuid,target_ref text,reason text,outcome text,financial_effect boolean,contains_pii boolean,metadata jsonb,created_at timestamptz);
insert into public.user_profiles values(task5_proof.id(1),'Synthetic','Synthetic',null,'secret-email');
insert into public.ledger_accounts select task5_proof.id(n),task5_proof.id(1),'user','BDAG',10,false,'2026-10-30 12:00Z','2026-10-30 12:00Z','secret-account' from generate_series(1,5)n;
insert into public.financial_transactions select task5_proof.id(n),'synthetic',10,2,'BDAG','completed','synthetic','2026-10-30 12:00Z','secret-transaction' from generate_series(1,5)n;
insert into public.ledger_entries select task5_proof.id(n),task5_proof.id(n) from generate_series(1,5)n;
insert into private.admin_action_audit select task5_proof.id(n),task5_proof.id(1),'human_admin','["FINANCE_AUDITOR"]','finance.audit.read',domain,
 case when domain='advertising' then 'advertising.rate.publish' else 'synthetic.read' end,'synthetic',task5_proof.id(1),'secret-target','secret-reason','success',domain='finance',true,
 '{"result":"success","money_moved":false,"reference_id":"safe-reference","email":"secret-email","idempotency_key":"secret-key","raw":"secret-raw"}',
 '2026-10-30 12:00Z' from (select n,case when n<=5 then 'system' when n<=10 then 'finance' when n<=15 then 'advertising' else 'users' end domain from generate_series(1,20)n)seed;
create function task5_proof.snapshot() returns jsonb language plpgsql set timezone='UTC' as $$
declare r record;digest text;result jsonb:='{}';begin
 for r in select schemaname,tablename from pg_tables where schemaname in('public','private') order by 1,2 loop
 execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,%L order by id),%L)) from %I.%I t','','',r.schemaname,r.tablename) into digest;
 result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,digest);end loop;return result;end$$;
create table task5_proof.baseline as select task5_proof.snapshot() digest;
do $$declare r record;begin for r in select schemaname,tablename from pg_tables where schemaname in('public','private') loop execute format('alter table %I.%I enable row level security',r.schemaname,r.tablename);execute format('alter table %I.%I force row level security',r.schemaname,r.tablename);end loop;end$$;
revoke all on all tables in schema public,private from public,anon,authenticated,service_role;
grant usage on schema task5_proof to authenticated;grant execute on all functions in schema task5_proof to authenticated;
