import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const {Client}=pg,requireB8b=process.argv.includes("--require-b8b"),expectPreB8b=process.argv.includes("--expect-pre-b8b"),cache=join(tmpdir(),"onspace-b8b-npm-cache");mkdirSync(cache,{recursive:true});let captured="";
if(!process.env.PGHOST||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD){const cli=spawnSync(process.env.ComSpec,["/d","/s","/c","npx.cmd supabase db dump --linked --schema public --dry-run"],{cwd:process.cwd(),encoding:"utf8",windowsHide:true,env:{...process.env,npm_config_cache:cache,DO_NOT_TRACK:"1"}});captured=String(cli.stdout??"")+String(cli.stderr??"");if(cli.status!==0)throw new Error("b8b_remote_secure_connection_failed:"+captured.replace(/(PGPASSWORD[=\"']+)[^\"'\r\n ]+/gi,"$1[redacted]").replace(/postgres(?:ql)?:\/\/[^\s]+/gi,"[redacted-database-url]").slice(-800))}
const env=(name)=>process.env[name]??captured.match(new RegExp("(?:export |set \\\"?)"+name+"=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1],config={host:env("PGHOST"),port:Number(env("PGPORT")),user:env("PGUSER"),password:env("PGPASSWORD"),database:env("PGDATABASE"),ssl:{rejectUnauthorized:false}};assert(config.host&&config.port&&config.user&&config.password&&config.database,"b8b_remote_config_missing");
const observational=new Set(["confirmed","processing","shipped","delivered","refunded_fixture","escrow_expected_held_total","escrow_actual_balance"]);function healthy(value,path=""){if(Array.isArray(value)){assert.equal(value.length,0,path+"_not_empty");return}if(value&&typeof value==="object"){for(const[key,nested]of Object.entries(value))if(!observational.has(key))healthy(nested,path?path+"."+key:key);return}if(typeof value==="number")assert.equal(value,0,path+"_nonzero")}
const db=new Client(config);
try{await db.connect();await db.query("set role postgres");await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)",[JSON.stringify({role:"service_role"})]);const names=(await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'reconcile_marketplace_%'and p.pronargs=0 order by p.proname")).rows.map((row)=>row.proname),reconciliations={};for(const name of names){const value=(await db.query(`select public.${name}()value`)).rows[0].value;healthy(value,name);reconciliations[name]=value}
 const audit=(await db.query(`select
 (select version from supabase_migrations.schema_migrations order by version desc limit 1)latest_migration,
 exists(select 1 from supabase_migrations.schema_migrations where version='20260811028000')b8a_applied,
 exists(select 1 from supabase_migrations.schema_migrations where version='20260811029000')b8b_applied,
 to_regclass('public.marketplace_admin_action_audit')is not null audit_table_present,
 to_regprocedure('public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer)')is not null disputes_read_present,
 to_regprocedure('public.get_marketplace_admin_dispute_detail(uuid)')is not null dispute_detail_present,
 to_regprocedure('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)')is not null dispute_write_present,
 to_regprocedure('public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer)')is not null sellers_read_present,
 to_regprocedure('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)')is not null seller_write_present,
 to_regprocedure('public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)')is not null products_read_present,
 to_regprocedure('public.admin_moderate_marketplace_product(uuid,text,text,uuid)')is not null product_write_present,
 to_regprocedure('public.reconcile_marketplace_admin_operations()')is not null b8b_reconciliation_present,
 case when to_regclass('public.marketplace_admin_action_audit')is not null then not has_table_privilege('authenticated','public.marketplace_admin_action_audit','insert,update,delete')else false end audit_client_write_denied,
 case when to_regprocedure('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)')is not null then not has_function_privilege('anon',to_regprocedure('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)'),'execute')else false end anon_dispute_write_denied,
 case when to_regprocedure('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)')is not null then not has_function_privilege('anon',to_regprocedure('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)'),'execute')else false end anon_seller_write_denied,
 case when to_regprocedure('public.admin_moderate_marketplace_product(uuid,text,text,uuid)')is not null then not has_function_privilege('anon',to_regprocedure('public.admin_moderate_marketplace_product(uuid,text,text,uuid)'),'execute')else false end anon_product_write_denied,
 case when to_regprocedure('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)')is not null then position('marketplace_require_admin' in lower(pg_get_functiondef(to_regprocedure('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)'))))>0 else false end dispute_requires_admin,
 case when to_regprocedure('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)')is not null then position('marketplace_require_admin' in lower(pg_get_functiondef(to_regprocedure('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)'))))>0 else false end seller_requires_admin,
 case when to_regprocedure('public.admin_moderate_marketplace_product(uuid,text,text,uuid)')is not null then position('marketplace_require_admin' in lower(pg_get_functiondef(to_regprocedure('public.admin_moderate_marketplace_product(uuid,text,text,uuid)'))))>0 else false end product_requires_admin,
 (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'admin_%marketplace%'and pg_get_functiondef(p.oid)~*'(ledger_debit|ledger_credit|commission_bps[ ]*[*]|balance[ ]*=)')dangerous_finance_functions,
 to_regprocedure('fixture_ops.fail_b8b_admin_operations()')is not null failure_function_present,
 exists(select 1 from pg_trigger where not tgisinternal and tgname like'fixture_b8b%')failure_trigger_present,
 (select count(*)::int from auth.users where email like'b8b-%@proof.local')fixture_users`)).rows[0];
 assert.equal(audit.b8a_applied,true);assert.equal(audit.dangerous_finance_functions,0);assert.equal(audit.failure_function_present,false);assert.equal(audit.failure_trigger_present,false);assert.equal(audit.fixture_users,0);
 if(expectPreB8b){assert.equal(audit.latest_migration,"20260811028000","b8b_predeploy_parity_mismatch");assert.equal(audit.b8b_applied,false);assert.equal(audit.audit_table_present,false)}
 if(requireB8b){assert.equal(audit.latest_migration,"20260811029000","b8b_migration_parity_mismatch");for(const key of["b8b_applied","audit_table_present","disputes_read_present","dispute_detail_present","dispute_write_present","sellers_read_present","seller_write_present","products_read_present","product_write_present","b8b_reconciliation_present","audit_client_write_denied","anon_dispute_write_denied","anon_seller_write_denied","anon_product_write_denied","dispute_requires_admin","seller_requires_admin","product_requires_admin"])assert.equal(audit[key],true,`b8b_${key}`)}
 for(const[name,count]of[["reconcile_marketplace_creator_commerce_analytics",18],["reconcile_marketplace_creator_content_tags",28],["reconcile_marketplace_creator_showcase",23],["reconcile_marketplace_creator_commerce",36],["reconcile_marketplace_multi_creator_allocations",27],["reconcile_marketplace_settlement_reversals",32]])if(Object.hasOwn(reconciliations,name))assert.equal(Object.keys(reconciliations[name]).length,count,`${name}_counter_count`);
 console.log(JSON.stringify({ok:true,...audit,reconciliations},null,2));
}finally{await db.end().catch(()=>{})}
