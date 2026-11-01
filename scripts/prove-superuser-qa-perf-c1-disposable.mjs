// PostgreSQL 17 loopback-only synthetic proof. It never accepts project URLs or credentials.
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {basename,dirname,join,resolve} from "node:path";
import {spawn,spawnSync} from "node:child_process";

const repo=resolve(import.meta.dirname,".."),scratch=resolve("D:/CodexTemp"),bin=join(scratch,"postgres-17.11-disposable/pgsql/bin");
const migrationNames=readdirSync(join(repo,"supabase/migrations")).filter(name=>name.includes("_superuser_qa_perf_c1")).sort();
assert.equal(migrationNames.length,1,"expected one transactional bounded-health C1 migration");
const [migration]=migrationNames.map(name=>readFileSync(join(repo,"supabase/migrations",name),"utf8"));
const evidence=join(repo,".superpowers/sdd/2026-11-01-superuser-qa-perf-c1/task-1-disposable");mkdirSync(evidence,{recursive:true});
const environment={...process.env};for(const key of Object.keys(environment))if(/^PG/i.test(key))delete environment[key];
environment.PGHOST="127.0.0.1";environment.PGHOSTADDR="127.0.0.1";environment.PGCONNECT_TIMEOUT="3";environment.PGSSLMODE="disable";
const listener=createServer();await new Promise((resolveListen,reject)=>{listener.once("error",reject);listener.listen(0,"127.0.0.1",resolveListen)});const port=listener.address().port;await new Promise(resolveClose=>listener.close(resolveClose));
let cluster,cliProject,sequence=0,started=false,created=false,stopped=false,dropped=false,removed=false,cliRemoved=false,proofError;
function invoke(tool,args,input,allowFailure=false){
 const result=spawnSync(join(bin,`${tool}.exe`),args,{input,encoding:"utf8",env:environment,windowsHide:true,timeout:180000,stdio:tool==="pg_ctl"?"ignore":"pipe"});
 writeFileSync(join(evidence,`${++sequence}-${tool}.log`),`${result.stdout??""}${result.stderr??""}`);
 if(!allowFailure)assert.equal(result.status,0,`${tool}: ${result.error?.message??result.stderr??result.stdout}`);return result;
}
function invokeRunning(tool,args,input,label){
 const child=spawn(join(bin,`${tool}.exe`),args,{encoding:"utf8",env:environment,windowsHide:true,stdio:["pipe","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",chunk=>{stdout+=chunk});child.stderr.on("data",chunk=>{stderr+=chunk});child.stdin.end(input);
 const done=new Promise((resolveRun,rejectRun)=>{child.once("error",rejectRun);child.once("close",status=>{writeFileSync(join(evidence,`${++sequence}-${label}.log`),`${stdout}${stderr}`);resolveRun({status,stdout,stderr})})});
 return {child,done};
}
function invokeExternalRunning(command,args,label,cwd){
 const options={cwd,encoding:"utf8",env:environment,windowsHide:true,stdio:["ignore","pipe","pipe"]};
 const child=process.platform==="win32"
  ?spawn(process.env.ComSpec??"cmd.exe",["/d","/s","/c","call",command,...args],options)
  :spawn(command,args,options);
 let stdout="",stderr="";child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",chunk=>{stdout+=chunk});child.stderr.on("data",chunk=>{stderr+=chunk});
 const done=new Promise((resolveRun,rejectRun)=>{child.once("error",rejectRun);child.once("close",status=>{writeFileSync(join(evidence,`${++sequence}-${label}.log`),`${stdout}${stderr}`);resolveRun({status,stdout,stderr})})});
 return {child,done};
}
const connection=["-X","--no-password","-h","127.0.0.1","-p",String(port),"-U","postgres","-d","perfproof","-v","ON_ERROR_STOP=1"];
const adminConnection=["-X","--no-password","-h","127.0.0.1","-p",String(port),"-U","supabase_admin","-d","perfproof","-v","ON_ERROR_STOP=1"];
const sql=(source,allowFailure=false)=>invoke("psql",connection,source,allowFailure);
const sqlAdmin=(source,allowFailure=false)=>invoke("psql",adminConnection,source,allowFailure);
const scalar=source=>sql(`\\pset format unaligned\n\\pset tuples_only on\n${source}`).stdout.trim().split(/\r?\n/).filter(line=>line!=="Output format is unaligned.").join("\n");
async function waitUntil(probe,label,timeoutMs=5000){
 const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(probe())return;await new Promise(resolveWait=>setTimeout(resolveWait,50))}throw new Error(`timed out waiting for ${label}`);
}
const marketplacePlanningTrials=3;
function measureMarketplacePlanning(label){
 sqlAdmin("select pg_stat_reset();select pg_stat_statements_reset();");
 const payloads=Array.from({length:marketplacePlanningTrials},()=>scalar("select (public.get_marketplace_admin_health()-'checked_at')::text;"));
 for(const payload of payloads)assert.equal(payload,payloads[0],`${label} Marketplace payload varied across fresh planning sessions`);
 const statistics=JSON.parse(scalar(`
select json_build_object(
 'planCount',coalesce(sum(plans),0)::bigint,
 'callCount',coalesce(sum(calls),0)::bigint,
 'statementCount',count(*)::integer,
 'totalPlanMs',coalesce(sum(total_plan_time),0),
 'totalExecMs',coalesce(sum(total_exec_time),0)
)::text
from pg_stat_statements
where query ilike '%marketplace_planner_orders%'
  and query not ilike '%pg_stat_statements%';`));
 const functionCalls=JSON.parse(scalar(`
select coalesce(json_object_agg(funcname,calls order by funcname),'{}'::json)::text
from pg_stat_user_functions
where schemaname='public' and funcname=any(array[${canonicalMarketplaceReconciliations.map(name=>`'${name}'`).join(",")}]);`));
 assert.deepEqual(Object.keys(functionCalls).sort(),[...canonicalMarketplaceReconciliations].sort(),`${label} must execute all fifteen canonical identities`);
 for(const [functionName,calls]of Object.entries(functionCalls))assert.equal(calls,marketplacePlanningTrials,`${label} ${functionName} must execute once in every fresh planning session`);
 writeFileSync(join(evidence,`marketplace-planning-${label}.json`),JSON.stringify({trials:marketplacePlanningTrials,...statistics,functionCalls},null,2));
 return {payload:payloads[0],...statistics,functionCalls};
}
const predecessor=readFileSync(join(repo,"supabase/migrations/20260911231907_superuser_a8_finance_audit_system_health.sql"),"utf8");
const functionStart=predecessor.indexOf("create or replace function public.get_admin_system_health()"),functionEnd=predecessor.indexOf("$$;",functionStart)+3;
assert.ok(functionStart>=0&&functionEnd>functionStart,"predecessor system-health function");
const predecessorFunction=predecessor.slice(functionStart,functionEnd);
const predecessorClone=predecessorFunction.replace("public.get_admin_system_health()","public.get_admin_system_health_pre_c1()");
const marketplaceSource=readFileSync(join(repo,"supabase/migrations/20260811031000_marketplace_admin_intelligence_ops.sql"),"utf8");
const marketplaceHelperStart=marketplaceSource.indexOf("create or replace function public.marketplace_admin_health_failure_count"),marketplaceFunctionStart=marketplaceSource.indexOf("create or replace function public.get_marketplace_admin_health()"),marketplaceFunctionEnd=marketplaceSource.indexOf("create or replace function public.search_marketplace_admin_activity",marketplaceFunctionStart+30);
assert.ok(marketplaceHelperStart>=0&&marketplaceFunctionStart>marketplaceHelperStart&&marketplaceFunctionEnd>marketplaceFunctionStart,"canonical Marketplace health authority source");
const marketplaceHelpers=marketplaceSource.slice(marketplaceHelperStart,marketplaceFunctionStart);
const marketplacePredecessorFunction=marketplaceSource.slice(marketplaceFunctionStart,marketplaceFunctionEnd)
 .replace("set search_path=pg_catalog,public","set search_path=pg_catalog,private,public")
 .replace("public.marketplace_require_admin()","public.admin_require_capability('marketplace.health.read')");
const canonicalMarketplaceReconciliations=[
 "reconcile_marketplace_payments","reconcile_marketplace_settlements","reconcile_marketplace_creator_commerce",
 "reconcile_marketplace_creator_showcase","reconcile_marketplace_creator_content_tags","reconcile_marketplace_multi_creator_allocations",
 "reconcile_marketplace_live_commissions","reconcile_marketplace_creator_commerce_analytics","reconcile_marketplace_settlement_reversals",
 "reconcile_marketplace_ad_finance","reconcile_marketplace_ad_eligibility_clock","reconcile_marketplace_ad_finalization",
 "reconcile_marketplace_ad_delivery","reconcile_marketplace_ad_events","reconcile_marketplace_admin_operations",
];
assert.equal(canonicalMarketplaceReconciliations.length,15);
const allMigrationSources=readdirSync(join(repo,"supabase/migrations"))
 .filter(name=>name.endsWith(".sql")).sort()
 .map(name=>({name,sql:readFileSync(join(repo,"supabase/migrations",name),"utf8")}));
const marketplacePlannerRelationNames=["orders","payments","allocations","settlements","legs","events","attributions","audits"];
const marketplacePlannerJoinsPerCounter=marketplacePlannerRelationNames.length-1;
function latestCanonicalReconciliationShape(functionName){
 const signaturePattern=new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(\\s*\\)`,"ig");
 let latest;
 for(const migrationSource of allMigrationSources){
  for(const signatureMatch of migrationSource.sql.matchAll(signaturePattern)){
   const tail=migrationSource.sql.slice(signatureMatch.index),opening=/\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(tail);
   assert.ok(opening,`${functionName} in ${migrationSource.name} must use a dollar-quoted body`);
   const delimiter=opening[1],bodyStart=opening.index+opening[0].length,bodyEnd=tail.indexOf(delimiter,bodyStart);
   assert.ok(bodyEnd>=bodyStart,`${functionName} in ${migrationSource.name} must close ${delimiter}`);
   const terminator=/^\s*;/.exec(tail.slice(bodyEnd+delimiter.length));
   assert.ok(terminator,`${functionName} in ${migrationSource.name} must terminate after ${delimiter}`);
   latest={migration:migrationSource.name,ddl:tail.slice(0,bodyEnd+delimiter.length+terminator[0].length)};
  }
 }
 assert.ok(latest,`latest canonical source for ${functionName}`);
 const joins=(latest.ddl.match(/\bjoin\b/gi)??[]).length,selects=(latest.ddl.match(/\bselect\b/gi)??[]).length;
 assert.ok(selects>0,`${functionName} canonical body must contain a query`);
 // Each counter is one eight-relation reconciliation chain. The per-function
 // counter count is derived from the latest production join count (with a one
 // chain floor for the few light identities), preserving the production
 // suite's aggregate planner pressure without recreating its business schema.
 const fixtureCounters=Math.max(1,Math.ceil(Math.max(joins,1)/marketplacePlannerJoinsPerCounter));
 return {name:functionName,migration:latest.migration,joins,selects,fixtureCounters};
}
const marketplaceCanonicalSourceShapes=canonicalMarketplaceReconciliations.map(latestCanonicalReconciliationShape);
const canonicalSourceJoins=marketplaceCanonicalSourceShapes.reduce((sum,shape)=>sum+shape.joins,0);
const marketplacePlannerFixtureTables=marketplacePlannerRelationNames.map((name,index)=>`
create table public.marketplace_planner_${name}(fixture_id integer not null,amount numeric not null,status text not null);
insert into public.marketplace_planner_${name} values(1,100,'settled');`).join("\n");
function marketplacePlannerCounter(counterIndex){
 const suffix=String(counterIndex+1).padStart(2,"0");
 return `'reconciliation_${suffix}_mismatch',(
  select count(*) from(
   select o.fixture_id,o.amount expected_amount,audit.amount observed_amount
   from public.marketplace_planner_orders o
   join public.marketplace_planner_payments p on p.fixture_id=o.fixture_id
   join(
    select allocation.fixture_id
    from public.marketplace_planner_allocations allocation
    join public.marketplace_planner_settlements settlement on settlement.fixture_id=allocation.fixture_id
    join public.marketplace_planner_legs leg on leg.fixture_id=settlement.fixture_id
    join public.marketplace_planner_events event on event.fixture_id=leg.fixture_id
    where allocation.status=settlement.status and leg.status=event.status
   )financial_chain on financial_chain.fixture_id=p.fixture_id
   join public.marketplace_planner_attributions attribution on attribution.fixture_id=financial_chain.fixture_id
   join public.marketplace_planner_audits audit on audit.fixture_id=attribution.fixture_id
   where o.status=p.status and attribution.status=audit.status
  )reconciliation_${suffix}
  where expected_amount is distinct from observed_amount
 )`;
}
const marketplaceReconciliationFixtures=marketplaceCanonicalSourceShapes.map(shape=>`
create function public.${shape.name}()returns jsonb language sql stable security definer set search_path=pg_catalog,public as $fixture$
 select jsonb_build_object(${Array.from({length:shape.fixtureCounters},(_,index)=>marketplacePlannerCounter(index)).join(",")});
$fixture$;`).join("\n");
const fixturePlannedJoins=marketplaceCanonicalSourceShapes.reduce((sum,shape)=>sum+shape.fixtureCounters*marketplacePlannerJoinsPerCounter,0);
assert.ok(fixturePlannedJoins>=canonicalSourceJoins,"planner fixture must preserve at least the latest canonical aggregate join pressure");
const managedCronSetup=`
create extension pg_stat_statements;
create schema cron;
alter schema cron owner to supabase_admin;
create table cron.job(jobid bigint primary key,active boolean not null);
create table cron.job_run_details(runid bigint primary key,jobid bigint not null,job_pid integer,database text,username text,command text,status text,return_message text,start_time timestamptz,end_time timestamptz);
alter table cron.job owner to supabase_admin;
alter table cron.job_run_details owner to supabase_admin;
grant usage on schema cron to postgres;
grant select,insert,update,delete on cron.job,cron.job_run_details to postgres;
grant pg_read_all_stats to postgres;
`;
const setup=`
create role anon;create role authenticated;create role service_role;
create schema private;
create function public.admin_require_capability(text)returns void language plpgsql as $$begin return;end$$;
create table private.admin_roles(role_code text);create table private.admin_capabilities(capability_code text);
create table private.admin_role_capabilities(role_code text,capability_code text);create table private.admin_role_grant_rules(role_code text);
create table private.admin_user_roles(role_code text,revoked_at timestamptz);
create table private.creator_premium_finance_policy(singleton boolean,activation_mode text,purchase_enabled boolean,subscription_enabled boolean,refunds_enabled boolean,platform_fee_bps integer,active_authorization_id uuid);
insert into private.creator_premium_finance_policy values(true,'general',true,true,true,2000,'f4000000-0000-4000-8000-000000000001');
create table public.ledger_accounts(id uuid,balance numeric,owner_id uuid,account_type text,currency text);
create table public.financial_transactions(id uuid,status text);create table public.ledger_entries(id uuid);
create table public.app_wallets(id uuid);create table public.app_wallet_ledger_entries(id uuid);
create table public.marketplace_settlement_run_failures(id uuid);create table public.marketplace_order_settlements(id uuid);
create table public.marketplace_return_refunds(id uuid);create table public.live_sessions(id uuid,status text);
create table public.live_battles(id uuid,status text);create table public.media_assets(id uuid,status text);
create table public.marketplace_ad_campaigns(id uuid,funded_at timestamptz,ends_at timestamptz,status text,eligibility_state boolean);
${marketplacePlannerFixtureTables}
insert into cron.job select n,true from generate_series(1,7)n;
insert into cron.job_run_details(runid,jobid,status,start_time,end_time)
select n,1+(n%7),case when n%19=0 then 'failed' else 'succeeded' end,
  statement_timestamp()-(40000-n)*interval '1 second',
  statement_timestamp()-(40000-n)*interval '1 second'+interval '100 milliseconds'
from generate_series(1,40000)n;
insert into cron.job_run_details(runid,jobid,status,start_time,end_time) values(-1,1,'failed',null,null);
${predecessorFunction}
${predecessorClone}
revoke all on function public.get_admin_system_health() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_system_health() to authenticated;
${marketplaceHelpers}
${marketplaceReconciliationFixtures}
${marketplacePredecessorFunction}
revoke all on function public.get_marketplace_admin_health() from public,anon,authenticated,service_role;
grant execute on function public.get_marketplace_admin_health() to authenticated;
analyze cron.job_run_details;`;

try{
 cluster=mkdtempSync(join(scratch,"superuser-qa-perf-c1-"));
 cliProject=mkdtempSync(join(scratch,"superuser-qa-perf-c1-cli-"));
 assert.equal(dirname(cluster),scratch);assert.equal(dirname(cliProject),scratch);
 const cliMigrations=join(cliProject,"supabase","migrations");mkdirSync(cliMigrations,{recursive:true});
 mkdirSync(join(cliProject,"supabase"),{recursive:true});writeFileSync(join(cliProject,"supabase","config.toml"),'project_id = "superuser-qa-perf-c1"\n[db]\nmajor_version = 17\n');
 writeFileSync(join(cliMigrations,migrationNames[0]),migration);
 console.log(`Fresh PostgreSQL 17 C1 proof: ${cluster}, 127.0.0.1:${port}`);
 assert.ok(existsSync(join(bin,"postgres.exe")),"disposable PostgreSQL 17 binaries missing");
 invoke("initdb",["-D",cluster,"-U","supabase_admin","-A","trust","--no-locale","--encoding=UTF8","--no-sync"]);
 started=true;invoke("pg_ctl",["-D",cluster,"-l",join(evidence,"server.log"),"-o",`-h 127.0.0.1 -p ${port} -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all -c pg_stat_statements.track_planning=on -c track_functions=all -c jit=off`,"-w","-t","30","start"]);
 invoke("psql",["-X","--no-password","-h","127.0.0.1","-p",String(port),"-U","supabase_admin","-d","postgres","-v","ON_ERROR_STOP=1"],"create role postgres login createrole;");
 invoke("createdb",["-h","127.0.0.1","-p",String(port),"-U","supabase_admin","-O","postgres","perfproof"]);created=true;
 sqlAdmin(managedCronSetup);
 sql(setup);
 assert.equal(scalar("select current_setting('pg_stat_statements.track')||':'||current_setting('pg_stat_statements.track_planning')||':'||current_setting('track_functions');"),"all:on:all","nested planning and per-function statistics must be enabled");
 const marketplaceBeforePlanning=measureMarketplacePlanning("before"),beforeMarketplace=marketplaceBeforePlanning.payload;
 const marketplaceReconcilerCount=Number(scalar("select jsonb_array_length(public.get_marketplace_admin_health()->'groups');"));
 assert.equal(marketplaceReconcilerCount,15,"canonical Marketplace health must execute all fifteen reconciliators");
 const marketplaceBeforePlan=sql("\\pset format unaligned\n\\pset tuples_only on\nexplain(analyze,buffers,format json) select public.get_marketplace_admin_health();").stdout;
 writeFileSync(join(evidence,"marketplace-before.json"),marketplaceBeforePlan);
 const marketplaceBeforeExecutionMs=Number(JSON.parse(marketplaceBeforePlan.slice(marketplaceBeforePlan.indexOf("[")))[0]["Execution Time"]);
 const marketplaceDefinitionBefore=scalar("select encode(sha256(convert_to(pg_get_functiondef('public.get_marketplace_admin_health()'::regprocedure),'UTF8')),'hex');");
 assert.equal(marketplaceDefinitionBefore,"f0222d0af1d6b5f3317174f8b05fb91ea14f9786e87a17d0535baa70829102ab","fixture must reproduce the exact production predecessor");
 const beforePlan=sql("\\pset format unaligned\n\\pset tuples_only on\nexplain(analyze,buffers,format json) select count(*) from cron.job_run_details where start_time>=clock_timestamp()-interval '24 hours';").stdout;
 writeFileSync(join(evidence,"cron-before.json"),beforePlan);
 assert.match(beforePlan,/Seq Scan/i,"predecessor must reproduce the unindexed cron scan");
 const dbUrl=`postgresql://postgres@127.0.0.1:${port}/perfproof?sslmode=disable`;
 const cronCatalogBefore=scalar("select json_build_object('schema_owner',pg_get_userbyid(n.nspowner),'table_owner',pg_get_userbyid(c.relowner),'indexes',(select json_agg(pg_get_indexdef(i.indexrelid) order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid))::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cron' and c.relname='job_run_details';");
 const cronCatalog=JSON.parse(cronCatalogBefore);
 assert.equal(cronCatalog.schema_owner,"supabase_admin");
 assert.equal(cronCatalog.table_owner,"supabase_admin");
 assert.deepEqual(cronCatalog.indexes,["CREATE UNIQUE INDEX job_run_details_pkey ON cron.job_run_details USING btree (runid)"]);
 const canonicalPush=invokeExternalRunning(process.platform==="win32"?"npx.cmd":"npx",["--yes","supabase@2.120.0","db","push","--db-url",dbUrl,"--skip-vault","--yes","--workdir",cliProject],"supabase-2.120-db-push",cliProject);
 const pushResult=await canonicalPush.done;assert.equal(pushResult.status,0,pushResult.stderr);
 const cronCatalogAfter=scalar("select json_build_object('schema_owner',pg_get_userbyid(n.nspowner),'table_owner',pg_get_userbyid(c.relowner),'indexes',(select json_agg(pg_get_indexdef(i.indexrelid) order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid))::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cron' and c.relname='job_run_details';");
 assert.equal(cronCatalogAfter,cronCatalogBefore,"C1 must not mutate the managed cron relation");
 const completeSystem=JSON.parse(scalar("select public.get_admin_system_health()::text;"));
 assert.equal(completeSystem.cron.run_metrics_available,true);
 assert.equal(completeSystem.cron.runs_24h,40000);
 const historyWindowComplete=true,cronRelationUnmodified=true;
 sql("insert into cron.job_run_details(runid,jobid,status,start_time,end_time) select 40000+n,1+(n%7),'succeeded',statement_timestamp()-interval '36 hours'-n*interval '1 millisecond',statement_timestamp()-interval '36 hours'-n*interval '1 millisecond'+interval '100 milliseconds' from generate_series(1,960000)n;");
 sql("insert into cron.job_run_details(runid,jobid,status,start_time,end_time) select 1000000+n,1+(n%7),'succeeded',statement_timestamp()-n*interval '1 millisecond',statement_timestamp()-n*interval '1 millisecond'+interval '100 milliseconds' from generate_series(1,60000)n;");
 const saturatedSystem=JSON.parse(scalar("select public.get_admin_system_health()::text;"));
 assert.equal(saturatedSystem.cron.run_metrics_available,false);
 assert.equal(saturatedSystem.cron.run_metrics_reason,"history_probe_limit_reached");
 assert.equal(saturatedSystem.cron.runs_24h,null);
 assert.equal(saturatedSystem.cron.non_successes_24h,null);
 const historyProbeSaturated=true,historyUnavailableReturnsNull=true;
 const marketplaceAfterPlanning=measureMarketplacePlanning("after"),afterMarketplace=marketplaceAfterPlanning.payload;
 assert.equal(afterMarketplace,beforeMarketplace,"Marketplace health output changed by planner-only settings");
 const expectedMarketplacePlans=marketplacePlanningTrials*canonicalMarketplaceReconciliations.length;
 assert.equal(marketplaceBeforePlanning.planCount,expectedMarketplacePlans,"pre-C1 measurement must plan every canonical reconciliator in every fresh session");
 assert.equal(marketplaceAfterPlanning.planCount,expectedMarketplacePlans,"post-C1 measurement must plan every canonical reconciliator in every fresh session");
 assert.equal(marketplaceAfterPlanning.callCount,marketplaceBeforePlanning.callCount,"before/after nested statement work must be identical");
 const marketplacePlanningRatio=marketplaceBeforePlanning.totalPlanMs/marketplaceAfterPlanning.totalPlanMs;
 assert.ok(Number.isFinite(marketplacePlanningRatio)&&marketplacePlanningRatio>=2,`function-local collapse limits did not halve nested planning work: ${JSON.stringify({marketplaceBeforePlanning,marketplaceAfterPlanning,marketplacePlanningRatio})}`);
 const marketplacePlanningPlanCount=marketplaceAfterPlanning.planCount,marketplacePlanningImprovement=true;
 const afterPlan=sql("\\pset format unaligned\n\\pset tuples_only on\nexplain(analyze,buffers,format json) select public.get_admin_system_health();").stdout;
 writeFileSync(join(evidence,"cron-after.json"),afterPlan);
 const afterJson=JSON.parse(afterPlan.slice(afterPlan.indexOf("[")))[0],executionMs=Number(afterJson["Execution Time"]);
 assert.ok(executionMs<8000,`bounded representative system health exceeded the production statement timeout: ${executionMs}`);
 const settings=scalar("select array_to_string(proconfig,',') from pg_proc where oid='public.get_marketplace_admin_health()'::regprocedure;");
 assert.equal(settings,"search_path=pg_catalog, private, public,join_collapse_limit=1,from_collapse_limit=1");
 const marketplaceAfterPlan=sql("\\pset format unaligned\n\\pset tuples_only on\nexplain(analyze,buffers,format json) select public.get_marketplace_admin_health();").stdout;
 writeFileSync(join(evidence,"marketplace-after.json"),marketplaceAfterPlan);
 const marketplaceAfterExecutionMs=Number(JSON.parse(marketplaceAfterPlan.slice(marketplaceAfterPlan.indexOf("[")))[0]["Execution Time"]);
 assert.ok(marketplaceAfterExecutionMs<8000,`bounded Marketplace health exceeded the production statement timeout: ${marketplaceAfterExecutionMs}`);
 const systemUnderProductionTimeout=sql("begin;set local statement_timeout='8s';select public.get_admin_system_health();rollback;");
 const marketplaceUnderProductionTimeout=sql("begin;set local statement_timeout='8s';select public.get_marketplace_admin_health();rollback;");
 assert.equal(systemUnderProductionTimeout.status,0,"system health did not complete under the production timeout");
 assert.equal(marketplaceUnderProductionTimeout.status,0,"Marketplace health did not complete under the production timeout");
 const acl=scalar("select has_function_privilege('authenticated','public.get_admin_system_health()','execute')::text||':'||has_function_privilege('anon','public.get_admin_system_health()','execute')::text;");
 assert.equal(acl,"true:false");
 const [systemDefinitionSha256,marketplaceDefinitionSha256]=scalar("select encode(sha256(convert_to(pg_get_functiondef('public.get_admin_system_health()'::regprocedure),'UTF8')),'hex') union all select encode(sha256(convert_to(pg_get_functiondef('public.get_marketplace_admin_health()'::regprocedure),'UTF8')),'hex');").split(/\r?\n/);
 assert.notEqual(marketplaceDefinitionSha256,marketplaceDefinitionBefore,"function-local planner settings must change the canonical function definition hash");
 console.log(JSON.stringify({rows:1060001,cronBefore:"sequential",cronAfter:"bounded_runid_pk_probe",cronAfterExecutionMs:executionMs,historyWindowComplete,historyProbeSaturated,historyUnavailableReturnsNull,cronRelationUnmodified,productionTimeoutMs:8000,systemUnderProductionTimeout:true,marketplaceUnderProductionTimeout:true,marketplacePayloadParity:true,marketplaceReconcilerCount:15,marketplaceCanonicalSourceShapes,canonicalSourceJoins,fixturePlannedJoins,marketplacePlannerJoinsPerCounter,marketplacePlanningTrials,marketplacePlanningPlanCount,marketplaceCanonicalFunctionCalls:marketplaceAfterPlanning.functionCalls,marketplaceBeforePlanningMs:marketplaceBeforePlanning.totalPlanMs,marketplaceAfterPlanningMs:marketplaceAfterPlanning.totalPlanMs,marketplacePlanningRatio,marketplacePlanningImprovement,marketplaceBeforeExecutionMs,marketplaceAfterExecutionMs,marketplacePlannerScope:"function_local",marketplaceDefinitionChanged:true,systemDefinitionSha256,marketplaceDefinitionSha256,acl:"authenticated_only"},null,2));
}catch(error){proofError=error}
finally{
 const cleanupErrors=[];
 if(started){
  if(created){try{invoke("dropdb",["-h","127.0.0.1","-p",String(port),"-U","postgres","--if-exists","--force","perfproof"]);dropped=true;}catch(error){cleanupErrors.push(error)}}
  try{invoke("pg_ctl",["-D",cluster,"-w","-t","30","-m","fast","stop"],undefined,true);stopped=invoke("pg_ctl",["-D",cluster,"status"],undefined,true).status===3;assert.ok(stopped,"server confirmed stopped before cleanup");}catch(error){cleanupErrors.push(error)}
 }
 if(cluster&&(stopped||!started)){try{assert.equal(dirname(resolve(cluster)),scratch);assert.ok(basename(cluster).startsWith("superuser-qa-perf-c1-"));rmSync(cluster,{recursive:true});removed=!existsSync(cluster);assert.ok(removed,"cluster directory removed");}catch(error){cleanupErrors.push(error)}}
 if(cliProject){try{assert.equal(dirname(resolve(cliProject)),scratch);assert.ok(basename(cliProject).startsWith("superuser-qa-perf-c1-cli-"));rmSync(cliProject,{recursive:true});cliRemoved=!existsSync(cliProject);assert.ok(cliRemoved,"CLI directory removed");}catch(error){cleanupErrors.push(error)}}
 const cleanup={cluster:cluster??null,cliProject:cliProject??null,port,databaseDropped:dropped,serverStopped:stopped,directoryRemoved:removed,cliDirectoryRemoved:cliRemoved};
 try{writeFileSync(join(evidence,"cleanup.json"),JSON.stringify(cleanup,null,2));console.log(`CLEANUP ${JSON.stringify(cleanup)}`);}catch(error){cleanupErrors.push(error)}
 if(proofError||cleanupErrors.length)throw new AggregateError([...(proofError?[proofError]:[]),...cleanupErrors],"disposable C1 proof or cleanup failed");
}
