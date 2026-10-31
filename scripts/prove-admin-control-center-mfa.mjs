// Native, isolated PostgreSQL proof. Never accepts a project URL or credentials.
import assert from "node:assert/strict";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createServer} from "node:net";

const bin=resolve(process.argv[2]??"D:/CodexTemp/postgres-17.11-disposable/pgsql/bin");
const base=resolve("D:/CodexTemp");
const cluster=mkdtempSync(join(base,"control-center-mfa-task3-"));
assert.ok(cluster.startsWith(base+"\\control-center-mfa-task3-"),"bounded disposable cluster");
const listener=createServer();await new Promise((resolve,reject)=>{listener.once("error",reject);listener.listen(0,"127.0.0.1",resolve)});
const port=listener.address().port;await new Promise((resolve)=>listener.close(resolve));
const invoke=(tool,args,input)=>{
  // pg_ctl's detached Windows server can inherit pipe handles and keep spawnSync
  // waiting after pg_ctl exits. The server writes only to its explicit log file.
  const taskEnvironment={...process.env};
  for(const key of Object.keys(taskEnvironment))if(/^PG/i.test(key))delete taskEnvironment[key];
  const result=spawnSync(join(bin,`${tool}.exe`),args,{input,stdio:tool==="pg_ctl"?"ignore":"pipe",encoding:"utf8",windowsHide:true,timeout:180000,env:taskEnvironment});
  if(result.status!==0)throw new Error(`${tool}: ${result.error?.message??result.stderr??result.stdout}`);
  return result.stdout;
};
const sql=(source)=>invoke("psql",["-X","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p",String(port),"-U","postgres","-d","postgres"],source);
let started=false;
try{
  console.log(`Initializing isolated cluster: ${cluster}`);
  invoke("initdb",["-D",cluster,"-U","postgres","-A","trust","--no-locale","--encoding=UTF8","--no-sync"]);
  console.log(`Starting disposable PostgreSQL on 127.0.0.1:${port}`);
  started=true;
  invoke("pg_ctl",["-D",cluster,"-l",join(cluster,"proof.log"),"-o",`-h 127.0.0.1 -p ${port}`,"-w","start"]);
  const foundation=readFileSync(new URL("../supabase/migrations/20260911162054_superuser_a3_canonical_authority_foundation.sql",import.meta.url),"utf8");
  const canonical=(name)=>{const found=foundation.match(new RegExp(`create function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\$\\$;`));assert.ok(found,`canonical ${name}`);return found[0]};
  const catalog=foundation.slice(foundation.indexOf("create table private.admin_roles("),foundation.indexOf("create function private.admin_active_role_codes("));
  console.log("Loading canonical catalog, helpers and synthetic Super Admin; reproducing the AAL1 write gap.");
  sql(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    ${catalog}
    ${canonical("private.admin_active_role_codes")}
    ${canonical("private.admin_role_set_is_valid")}
    ${canonical("private.admin_effective_capabilities")}
    ${canonical("private.admin_authority_version")}
    ${canonical("public.admin_actor_has_capability")}
    ${canonical("public.admin_require_capability")}
    create view public.public_user_profiles as select id,null::text username,null::text display_name,null::text avatar_url from auth.users;
    ${canonical("public.get_my_admin_access")}
    revoke all on function public.admin_actor_has_capability(text),public.admin_require_capability(text),public.get_my_admin_access() from public,anon,authenticated,service_role;
    grant execute on function public.admin_actor_has_capability(text),public.admin_require_capability(text),public.get_my_admin_access() to authenticated;
    insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
    insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('10000000-0000-4000-8000-000000000001','SUPER_ADMIN','trusted_operator','disposable-task3','MFA proof only');
    create temp table original_guards as select oid,proowner,proacl from pg_proc where oid in('public.admin_actor_has_capability(text)'::regprocedure,'public.admin_require_capability(text)'::regprocedure);
    select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal1"}',false);
    do $$begin
      if not public.admin_actor_has_capability('users.accounts.suspend') then raise exception 'baseline RED missing';end if;
      perform public.admin_require_capability('users.accounts.suspend');
    end$$;
  `);
  // A separate connection gets fresh temporary snapshots; persist them only in this isolated cluster.
  sql("create table private.proof_guards as select oid,proowner,proacl from pg_proc where oid in('public.admin_actor_has_capability(text)'::regprocedure,'public.admin_require_capability(text)'::regprocedure,'public.get_my_admin_access()'::regprocedure);");
  const dir=new URL("../supabase/migrations/",import.meta.url);
  const name=readdirSync(dir).find((file)=>file.endsWith("_superuser_control_center_mfa_aal2.sql"));assert.ok(name);
  console.log(`Applying only ${name} to the isolated database.`);
  sql(`begin;${readFileSync(new URL(name,dir),"utf8")}commit;`);
  const claims=(id="10000000-0000-4000-8000-000000000001",aal="aal1")=>`select set_config('request.jwt.claims','${JSON.stringify({sub:id,aal})}',false);`;
  const denied=(capability,message)=>`do $$begin
    if public.admin_actor_has_capability('${capability}') then raise exception 'boolean guard allowed';end if;
    begin perform public.admin_require_capability('${capability}');raise exception 'throwing guard allowed';
    exception when sqlstate '42501' then if sqlerrm<>'${message}' then raise;end if;end;
  end$$;`;
  const allowed=(capability)=>`do $$begin
    if not public.admin_actor_has_capability('${capability}') then raise exception 'boolean guard denied';end if;
    perform public.admin_require_capability('${capability}');end$$;`;
  const bootstrapDenied=`do $$begin
    begin perform public.get_my_admin_access();raise exception 'inactive bootstrap allowed';
    exception when sqlstate '42501' then if sqlerrm<>'admin_actor_inactive' then raise;end if;end;
  end$$;`;
  console.log("Checking AAL1/AAL2, active accounts, roles, catalog constraints and security metadata.");
  sql(`
    do $$begin
      if exists(select 1 from private.admin_capabilities where required_aal<>case when is_sensitive and effect in('write','workflow') then 'aal2' else 'aal1' end) then raise exception 'incorrect mapping';end if;
      if exists(select 1 from private.proof_guards old join pg_proc p using(oid) where (old.proowner,old.proacl) is distinct from(p.proowner,p.proacl)) then raise exception 'owner or ACL changed';end if;
      if exists(select 1 from pg_proc where oid in(select oid from private.proof_guards) and (not prosecdef or proconfig<>array['search_path=pg_catalog, private, public'])) then raise exception 'definer/search path changed';end if;
      if exists(select 1 from pg_class where oid in('private.admin_roles'::regclass,'private.admin_capabilities'::regclass,'private.admin_user_roles'::regclass) and not relrowsecurity) then raise exception 'RLS lost';end if;
      begin insert into private.admin_capabilities(capability_code,domain,effect,description,is_sensitive) values('proof.future.write','proof','write','Synthetic future capability',true);raise exception 'future capability accepted at aal1';exception when check_violation then null;end;
      if has_function_privilege('anon','public.admin_require_capability(text)','execute') or has_function_privilege('service_role','public.admin_require_capability(text)','execute') then raise exception 'ACL broadened';end if;
    end$$;
    ${claims()}set role authenticated;
    ${allowed("admin.shell.access")}${allowed("users.accounts.read")}
    do $$begin if (public.get_my_admin_access()->>'admin')::boolean is not true then raise exception 'AAL1 super admin locked out';end if;end$$;
    ${denied("users.accounts.suspend","admin_aal2_required")}
    ${denied("marketplace.disputes.resolve","admin_aal2_required")}
    reset role;${claims(undefined,"aal2")}set role authenticated;
    ${allowed("users.accounts.suspend")}${allowed("marketplace.disputes.resolve")}
    reset role;
    insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('10000000-0000-4000-8000-000000000001','SUPPORT','trusted_operator','disposable-task3','Invalid role set proof');
    set role authenticated;${denied("users.accounts.suspend","admin_role_set_invalid")}reset role;
    delete from private.admin_user_roles where role_code='SUPPORT';
    update auth.users set banned_until=now()-interval '1 hour' where id='10000000-0000-4000-8000-000000000001';
    set role authenticated;${allowed("users.accounts.suspend")}reset role;
    update auth.users set banned_until=now()+interval '1 hour' where id='10000000-0000-4000-8000-000000000001';
    set role authenticated;${denied("admin.shell.access","admin_actor_inactive")}${bootstrapDenied}reset role;
    update auth.users set banned_until=null,deleted_at=now() where id='10000000-0000-4000-8000-000000000001';
    set role authenticated;${denied("users.accounts.suspend","admin_actor_inactive")}${bootstrapDenied}reset role;
    update auth.users set deleted_at=null where id='10000000-0000-4000-8000-000000000001';
    update private.admin_user_roles set revoked_at=now(),revoke_actor_kind='trusted_operator',revoke_operator_reference='disposable-task3',revoke_reason='MFA proof only',version=version+1 where user_id='10000000-0000-4000-8000-000000000001';
    set role authenticated;${denied("users.accounts.suspend","admin_capability_forbidden")}reset role;
    ${claims("10000000-0000-4000-8000-000000000002","aal2")}set role authenticated;
    ${denied("users.accounts.suspend","admin_capability_forbidden")}reset role;
    select set_config('request.jwt.claims','{}',false);set role authenticated;
    do $$begin if public.admin_actor_has_capability('admin.shell.access') then raise exception 'anonymous allowed';end if;
      begin perform public.admin_require_capability('admin.shell.access');raise exception 'anonymous allowed';exception when sqlstate '28000' then null;end;
    end$$;reset role;
  `);
  console.log("PASS: isolated PostgreSQL 17 canonical catalog/guard proof; baseline AAL1 write reproduced, migration enforces AAL2, reads/bootstrap preserved, inactive/revoked/unprivileged actors denied, ACL/owners/search paths/RLS unchanged.");
}finally{
  if(started){
    invoke("pg_ctl",["-D",cluster,"-m","immediate","-w","stop"]);
    console.log(`Stopped disposable PostgreSQL: ${cluster}`);
    assert.ok(resolve(cluster).startsWith(base+"\\control-center-mfa-task3-"),"verify bounded deletion target");
    rmSync(cluster,{recursive:true,force:true});
    console.log(`Dropped disposable cluster: ${cluster}`);
  }else console.log(`Initialization failed; inspect retained disposable directory: ${cluster}`);
}
