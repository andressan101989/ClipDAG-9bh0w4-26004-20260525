import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB7d = process.argv.includes("--require-b7d"), expectPreB7d = process.argv.includes("--expect-pre-b7d");
const npmCache=join(tmpdir(),"onspace-b7a-npm-cache");mkdirSync(npmCache,{recursive:true});let captured="";
if(!process.env.PGHOST||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD){const cli=spawnSync(process.env.ComSpec,["/d","/s","/c","npx.cmd supabase db dump --linked --schema public --dry-run"],{cwd:process.cwd(),encoding:"utf8",windowsHide:true,env:{...process.env,npm_config_cache:npmCache,DO_NOT_TRACK:"1"}});captured=`${cli.stdout??""}${cli.stderr??""}`;if(cli.status!==0){const diagnostic=captured.replace(/(PGPASSWORD[="']+)[^"'\r\n ]+/gi,"$1[redacted]").replace(/postgres(?:ql)?:\/\/[^\s]+/gi,"[redacted-database-url]").slice(-800);throw new Error(`b7d_remote_secure_connection_failed:${diagnostic}`);}}
const envValue=(name)=>process.env[name]??captured.match(new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`))?.[1];
const config={host:envValue("PGHOST"),port:Number(envValue("PGPORT")),user:envValue("PGUSER"),password:envValue("PGPASSWORD"),database:envValue("PGDATABASE"),ssl:{rejectUnauthorized:false}};
assert(config.host&&config.port&&config.user&&config.password&&config.database,"b7d_remote_config_missing");
const observational=new Set(["confirmed","processing","shipped","delivered","refunded_fixture","escrow_expected_held_total","escrow_actual_balance"]);
function assertHealthy(result,path=""){if(Array.isArray(result)){assert.equal(result.length,0,`${path}_not_empty`);return;}if(result&&typeof result==="object"){for(const[key,item]of Object.entries(result))if(!observational.has(key))assertHealthy(item,path?`${path}.${key}`:key);return;}if(typeof result==="number")assert.equal(result,0,`${path}_nonzero`);}
const db=new Client(config);
try{
  await db.connect();await db.query("set role postgres");await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)",[JSON.stringify({role:"service_role"})]);
  const functionNames=(await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'reconcile_marketplace_%'and p.pronargs=0 order by p.proname")).rows.map((row)=>row.proname),reconciliations={};for(const name of functionNames){const result=(await db.query(`select public.${name}()value`)).rows[0].value;assertHealthy(result,name);reconciliations[name]=result;}
  const audit=(await db.query(`select
    (select version from supabase_migrations.schema_migrations order by version desc limit 1)latest_migration,
    exists(select 1 from supabase_migrations.schema_migrations where version='20260811025000')b7d_applied,
    to_regprocedure('public.get_my_marketplace_creator_commerce_analytics(text)')is not null analytics_rpc_present,
    to_regprocedure('public.reconcile_marketplace_creator_commerce_analytics()')is not null reconciliation_present,
    to_regclass('public.marketplace_creator_commerce_analytics_facts')is not null financial_projection_present,
    to_regclass('public.marketplace_creator_commerce_event_facts')is not null event_projection_present,
    to_regprocedure('fixture_ops.fail_b7d_analytics()')is not null failure_function_present,
    exists(select 1 from pg_trigger where not tgisinternal and tgname like'fixture_b7d%')failure_trigger_present,
    (select count(*)::int from auth.users where email like'b7d-%@proof.local')b7d_fixture_users`)).rows[0];
  let authority=null;if(audit.analytics_rpc_present){authority=(await db.query(`select
    has_function_privilege('authenticated','public.get_my_marketplace_creator_commerce_analytics(text)','EXECUTE')authenticated_self_read_granted,
    not has_function_privilege('anon','public.get_my_marketplace_creator_commerce_analytics(text)','EXECUTE')anon_read_denied,
    not has_function_privilege('authenticated','public.reconcile_marketplace_creator_commerce_analytics()','EXECUTE')client_reconciliation_denied,
    not has_table_privilege('authenticated','public.marketplace_creator_commerce_analytics_facts','SELECT,INSERT,UPDATE,DELETE')financial_projection_private,
    not has_table_privilege('authenticated','public.marketplace_creator_commerce_event_facts','SELECT,INSERT,UPDATE,DELETE')event_projection_private,
    not has_function_privilege('authenticated','public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE')b7a_helper_private,
    not has_function_privilege('authenticated','public.apply_marketplace_order_item_creator_allocations(uuid,jsonb,uuid)','EXECUTE')b7f_helper_private`)).rows[0];for(const[name,healthy]of Object.entries(authority))assert.equal(healthy,true,`b7d_remote_authority_${name}`);}
  assert.equal(audit.b7d_fixture_users,0,"b7d_remote_fixture_users_present");assert.equal(audit.failure_function_present,false,"b7d_remote_failure_function_present");assert.equal(audit.failure_trigger_present,false,"b7d_remote_failure_trigger_present");
  if(expectPreB7d){assert.equal(audit.latest_migration,"20260811024000","b7d_remote_predeploy_parity_mismatch");assert.equal(audit.b7d_applied,false,"b7d_remote_unexpectedly_applied");assert.equal(audit.analytics_rpc_present,false,"b7d_remote_rpc_unexpected");}
  if(requireB7d){assert.equal(audit.latest_migration,"20260811025000","b7d_remote_migration_parity_mismatch");assert.equal(audit.b7d_applied,true,"b7d_remote_migration_missing");assert.equal(audit.analytics_rpc_present,true,"b7d_remote_rpc_missing");assert.equal(audit.reconciliation_present,true,"b7d_remote_reconciliation_missing");assert.equal(Object.keys(reconciliations.reconcile_marketplace_creator_commerce_analytics).length,18);}
  for(const[name,count]of[["reconcile_marketplace_creator_content_tags",28],["reconcile_marketplace_creator_showcase",23],["reconcile_marketplace_creator_commerce",36],["reconcile_marketplace_multi_creator_allocations",27],["reconcile_marketplace_settlement_reversals",32]])if(Object.hasOwn(reconciliations,name))assert.equal(Object.keys(reconciliations[name]).length,count,`${name}_counter_count`);
  console.log(JSON.stringify({ok:true,...audit,authority,reconciliations},null,2));
}finally{await db.end().catch(()=>{});}
