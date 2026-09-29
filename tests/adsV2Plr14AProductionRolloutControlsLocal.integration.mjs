// Real disposable PostgreSQL proof. Set NELYON_PLR14A_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {spawn,spawnSync} from "node:child_process";
import test from "node:test";

const enabled=process.env.NELYON_PLR14A_LOCAL==="1";
const container=process.env.NELYON_PLR14A_CONTAINER??"nelyon-ads-v2-d-compile";
const template=process.env.NELYON_PLR14A_TEMPLATE??"plr9_production_clone2";
const user="supabase_admin";
const superAdmin="11000000-0000-4000-8000-000000000001";
const platformAdmin="11000000-0000-4000-8000-000000000002";
const migrationDirectory=new URL("../supabase/migrations/",import.meta.url);
const names=readdirSync(migrationDirectory);
const migration=(suffix)=>{const matching=names.filter((name)=>name.endsWith(suffix));assert.equal(matching.length,1,suffix);return readFileSync(new URL(matching[0],migrationDirectory),"utf8")};
const prerequisites=[
  "_ads_v2_plr_10_multisurface_age_targeting.sql",
  "_ads_v2_plr_10_c1_multisurface_render_payload.sql",
  "_ads_v2_plr_11_objective_runtime_measurement.sql",
  "_ads_v2_plr_11_c1_measurement_integrity.sql",
  "_ads_v2_plr_12_production_pricing_v1.sql",
];
const rolloutMigration=migration("_ads_v2_plr_14a_production_rollout_controls.sql");
const codes=["social_feed","clips","stories","live","marketplace_home","marketplace_search"];

function docker(args,{input,allowFailure=false}={}){const result=spawnSync("docker",args,{encoding:"utf8",input,maxBuffer:32*1024*1024});if(!allowFailure&&result.status!==0)throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);return{status:result.status,stdout:result.stdout.trim(),stderr:result.stderr.trim()}}
function psql(db,sql,options={}){return docker(["exec","-i",container,"psql","-X","-q","-v","ON_ERROR_STOP=1","-U",user,"-d",db,"-At"],{input:sql,...options})}
function psqlAsync(db,sql){return new Promise((resolve)=>{const child=spawn("docker",["exec","-i",container,"psql","-X","-q","-v","ON_ERROR_STOP=1","-U",user,"-d",db,"-At"]);let stdout="",stderr="";child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",(chunk)=>{stdout+=chunk});child.stderr.on("data",(chunk)=>{stderr+=chunk});child.on("close",(status)=>resolve({status,stdout:stdout.trim(),stderr:stderr.trim()}));child.stdin.end(sql)})}
function createDatabase(){const db=`plr14a_${randomUUID().replaceAll("-","").slice(0,12)}`;docker(["exec",container,"createdb","-U",user,"-T",template,db]);psql(db,"insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);");for(const suffix of prerequisites)psql(db,migration(suffix));psql(db,"set session_replication_role=replica;update private.advertising_billing_rate_versions set effective_from=clock_timestamp()-interval '1 minute',published_at=clock_timestamp()-interval '1 minute';set session_replication_role=origin;");psql(db,rolloutMigration);return db}
function dropDatabase(db){docker(["exec",container,"dropdb","-U",user,"--force","--if-exists",db],{allowFailure:true})}
function authSql(actor,sql){return `begin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`}
function payload(overrides={}){return JSON.stringify(codes.map((code)=>({code,rollout_bps:{social_feed:1000,clips:500,stories:250,live:100,marketplace_home:500,marketplace_search:500,...overrides}[code],kill_switch:false})))}
function configure(db,{version=1,paused=false,placements=payload(),key=randomUUID(),actor=superAdmin}={}){return psql(db,authSql(actor,`select public.set_admin_advertising_production_rollout_v1(${version},${paused},'${placements}'::jsonb,'${key}');`),{allowFailure:true})}

test("PLR-14A compiles and exposes a SUPER_ADMIN-only, fail-closed rollout authority",{skip:!enabled,timeout:120000},()=>{const db=createDatabase();try{
  assert.equal(psql(db,"select launch_mode||'|'||(select global_v2_delivery_enabled from private.advertising_delivery_policy)||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') from private.advertising_canary_policy where singleton;").stdout,"DISARMED|false|0|0");
  assert.equal(psql(db,"select production_rollout_version||'|'||production_rollout_config_version||'|'||production_delivery_paused from private.advertising_delivery_policy;").stdout,"nelyon-ads-rollout-v1|1|false");
  assert.equal(psql(db,"select count(*)||'|'||min(role_code) from private.admin_role_capabilities where capability_code='advertising.rollout.manage';").stdout,"1|SUPER_ADMIN");
  const projection=JSON.parse(psql(db,authSql(platformAdmin,"select public.get_admin_advertising_rollout_control_v1()::text;")).stdout.split(/\r?\n/).at(-1));
  assert.equal(projection.placements.length,6);assert.equal(projection.config_version,1);assert.equal(projection.production_ready,false);
  assert.notEqual(configure(db,{actor:platformAdmin}).status,0);
  assert.notEqual(psql(db,authSql(superAdmin,`select public.set_advertising_launch_mode_v2('CANARY_DELIVERY','${randomUUID()}');`),{allowFailure:true}).status,0);
  assert.equal(psql(db,"select concat_ws('|',has_function_privilege('anon','public.get_admin_advertising_rollout_control_v1()','execute'),has_function_privilege('authenticated','public.get_admin_advertising_rollout_control_v1()','execute'),has_function_privilege('service_role','public.get_admin_advertising_rollout_control_v1()','execute'),has_function_privilege('anon','public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)','execute'),has_function_privilege('authenticated','public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)','execute'),has_function_privilege('service_role','public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)','execute'),has_function_privilege('anon','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute'),has_function_privilege('authenticated','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute'),has_function_privilege('service_role','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute'),has_function_privilege('authenticated','private.advertising_viewer_in_production_rollout(text,uuid)','execute'));").stdout,"f|t|f|f|t|f|f|t|t|f");
  assert.equal(psql(db,"select count(*) from pg_proc where oid in('public.get_admin_advertising_rollout_control_v1()'::regprocedure,'public.set_admin_advertising_production_rollout_v1(bigint,boolean,jsonb,uuid)'::regprocedure,'public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)'::regprocedure,'private.advertising_viewer_in_production_rollout(text,uuid)'::regprocedure) and prosecdef and proconfig @> array['search_path=\"\"'];").stdout,"4");
}finally{dropDatabase(db)}});

test("desired rollout, launch, kill, pause, resume and disarm remain atomic and non-financial",{skip:!enabled,timeout:120000},()=>{const db=createDatabase();try{
  const key=randomUUID(),configured=configure(db,{key});assert.equal(configured.status,0,configured.stderr);
  assert.equal(psql(db,"select production_rollout_config_version||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled) from private.advertising_delivery_policy;").stdout,"2|0");
  assert.equal(configure(db,{key}).status,0,"same-key same-fingerprint replay");
  assert.notEqual(configure(db,{key,placements:payload({social_feed:2000})}).status,0,"same-key conflict");
  assert.notEqual(configure(db,{version:1}).status,0,"stale optimistic version");
  assert.equal(psql(db,authSql(superAdmin,`select public.set_advertising_launch_mode_v2('PRODUCTION','${randomUUID()}');`)).status,0);
  assert.equal(psql(db,"select launch_mode||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN' and mode='PRODUCTION') from private.advertising_canary_policy;").stdout,"PRODUCTION|6|1");
  const viewer="10000000-0000-4000-8000-000000000001";
  const stable=psql(db,`select private.advertising_viewer_in_production_rollout('stories','${viewer}')=private.advertising_viewer_in_production_rollout('stories','${viewer}');`).stdout;assert.equal(stable,"t");
  assert.equal(configure(db,{version:2,placements:payload({social_feed:10000,clips:0})}).status,0);
  assert.equal(psql(db,`select private.advertising_viewer_in_production_rollout('social_feed','${viewer}')||'|'||private.advertising_viewer_in_production_rollout('clips','${viewer}');`).stdout,"true|false");
  const killed=JSON.parse(payload({social_feed:10000,clips:0}));killed.find((item)=>item.code==="stories").kill_switch=true;
  assert.equal(configure(db,{version:3,placements:JSON.stringify(killed)}).status,0);
  assert.equal(psql(db,"select production_rollout_bps||'|'||production_kill_switch||'|'||v2_delivery_enabled from private.advertising_placement_catalog where code='stories';").stdout,"250|true|false");
  assert.equal(configure(db,{version:4,placements:payload({social_feed:10000,clips:0})}).status,0);
  assert.equal(configure(db,{version:5,paused:true,placements:payload({social_feed:10000,clips:0})}).status,0);
  assert.equal(psql(db,"select global_v2_delivery_enabled||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select funding_enabled||':'||spend_enabled||':'||settlement_enabled from private.advertising_finance_policy)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') from private.advertising_delivery_policy;").stdout,"false|0|true:true:true|1");
  assert.equal(configure(db,{version:6,paused:false,placements:payload({social_feed:10000,clips:0})}).status,0);
  assert.equal(psql(db,"select global_v2_delivery_enabled||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled) from private.advertising_delivery_policy;").stdout,"true|5");
  assert.equal(psql(db,authSql(superAdmin,`select public.set_advertising_launch_mode_v2('DISARMED','${randomUUID()}');`)).status,0);
  assert.equal(psql(db,"select launch_mode||'|'||(select global_v2_delivery_enabled from private.advertising_delivery_policy)||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select count(*) from private.advertising_placement_catalog where production_rollout_bps>0)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') from private.advertising_canary_policy;").stdout,"DISARMED|false|0|5|0");
  assert.equal(psql(db,"select count(*) from public.financial_transactions;").stdout,"0");
}finally{dropDatabase(db)}});

test("missing production rate fails launch without a partial control-plane change",{skip:!enabled,timeout:120000},()=>{const db=createDatabase();try{
  assert.equal(configure(db,{placements:payload({clips:0,stories:0,live:0,marketplace_home:0,marketplace_search:0})}).status,0);
  psql(db,"set session_replication_role=replica;update private.advertising_billing_rate_versions set effective_to=clock_timestamp()-interval '1 second' where objective='awareness' and placement_code='social_feed';set session_replication_role=origin;");
  const launch=psql(db,`select public.set_advertising_launch_mode_v2('PRODUCTION','${randomUUID()}');`,{allowFailure:true});assert.notEqual(launch.status,0);assert.match(launch.stderr,/advertising_production_rate_coverage_incomplete/);
  assert.equal(psql(db,"select launch_mode||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') from private.advertising_canary_policy;").stdout,"DISARMED|0|0");
}finally{dropDatabase(db)}});

test("concurrent config writers serialize and launch/config racing leaves one coherent window",{skip:!enabled,timeout:120000},async()=>{const db=createDatabase();try{
  const call=(placements)=>authSql(superAdmin,`select public.set_admin_advertising_production_rollout_v1(1,false,'${placements}'::jsonb,'${randomUUID()}');`);
  const racers=await Promise.all([psqlAsync(db,call(payload({social_feed:1000}))),psqlAsync(db,call(payload({social_feed:2000})))]);
  assert.equal(racers.filter((result)=>result.status===0).length,1);assert.equal(racers.filter((result)=>result.status!==0).length,1);assert.match(racers.find((result)=>result.status!==0).stderr,/advertising_rollout_config_version_stale/);
  assert.match(psql(db,"select production_rollout_config_version||'|'||(select production_rollout_bps from private.advertising_placement_catalog where code='social_feed') from private.advertising_delivery_policy;").stdout,/^2\|(1000|2000)$/);
  const raceConfig=authSql(superAdmin,`select public.set_admin_advertising_production_rollout_v1(2,false,'${payload({social_feed:3000})}'::jsonb,'${randomUUID()}');`);
  const raceLaunch=`select public.set_advertising_launch_mode_v2('PRODUCTION','${randomUUID()}');`;
  const race=await Promise.all([psqlAsync(db,raceConfig),psqlAsync(db,raceLaunch)]);assert.equal(race.filter((result)=>result.status===0).length,2,race.map((result)=>result.stderr).join("\n"));
  assert.equal(psql(db,"select launch_mode||'|'||(select production_rollout_config_version from private.advertising_delivery_policy)||'|'||(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') from private.advertising_canary_policy;").stdout,"PRODUCTION|3|6|1");
}finally{dropDatabase(db)}});
