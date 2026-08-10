import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo=process.cwd();
const action=process.argv[2]??"self-test";
const candidate=process.argv[3]?resolve(process.argv[3]):null;
const name=process.env.MARKETPLACE_DISPOSABLE_CONTAINER??"clipdag-marketplace-disposable";
const port=Number(process.env.MARKETPLACE_DISPOSABLE_PORT??55422);
const image=process.env.MARKETPLACE_DISPOSABLE_IMAGE??"public.ecr.aws/supabase/postgres:17.6.1.143";
const password="marketplace-disposable-only";
const connection=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
const temp=mkdtempSync(join(tmpdir(),"clipdag-marketplace-db-"));
const dump=join(temp,"linked-public-schema.sql");
const smoke=join(temp,"candidate-smoke.sql");
const requiredTables=["marketplace_orders","marketplace_order_items","marketplace_payments","marketplace_payment_allocations","marketplace_order_settlements","marketplace_settlement_legs","marketplace_order_disputes","financial_transactions","ledger_accounts"];
const requiredFunctions=["resolve_marketplace_dispute","confirm_marketplace_order_delivery_and_release","marketplace_apply_live_commission","reconcile_marketplace_live_commissions"];

function run(command,args,{allowFailure=false,quiet=false}={}){
 const result=spawnSync(command,args,{cwd:repo,encoding:"utf8",windowsHide:true,stdio:quiet?"pipe":"inherit"});
 if(result.error)throw result.error;
 if(result.status!==0&&!allowFailure)throw new Error(`${command}_failed_${result.status}`);
 return result;
}
function docker(...args){return run("docker",args)}
function destroy(){run("docker",["rm","-f",name],{allowFailure:true,quiet:true});}
function waitReady(){for(let i=0;i<60;i++){const r=run("docker",["exec",name,"pg_isready","-U","postgres"],{allowFailure:true,quiet:true});if(r.status===0)return;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}throw new Error("disposable_database_not_ready");}
function psql(sql){return docker("exec",name,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-Atc",sql)}
function verify(){
 const tableSql=requiredTables.map(x=>`to_regclass('public.${x}') is not null`).join(" and ");
 psql(`do $$begin if not (${tableSql}) then raise exception 'marketplace_disposable_tables_missing';end if;end$$`);
 for(const fn of requiredFunctions)psql(`do $$begin if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='${fn}')then raise exception 'marketplace_disposable_function_missing:${fn}';end if;end$$`);
}
function create(){
 run("docker",["version"]);destroy();
 docker("run","-d","--name",name,"-e",`POSTGRES_PASSWORD=${password}`,"-p",`${port}:5432`,image);waitReady();
 if(process.platform==="win32")run(process.env.ComSpec,["/d","/s","/c",`npx.cmd supabase db dump --linked --schema public,fixture_ops --file ${dump}`]);
 else run("npx",["supabase","db","dump","--linked","--schema","public,fixture_ops","--file",dump]);
 docker("cp",dump,`${name}:/tmp/linked-public-schema.sql`);
 psql("drop schema if exists public cascade;create schema public;grant all on schema public to postgres,anon,authenticated,service_role;grant all on schema public to public;");
 const restored=run("docker",["exec",name,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-f","/tmp/linked-public-schema.sql"],{quiet:true});
 if(restored.status!==0)throw new Error("linked_schema_restore_failed");verify();
 console.log(JSON.stringify({ready:true,container:name,connection_string:connection,schema_only:true},null,2));
}
function apply(file){if(!file)throw new Error("candidate_migration_path_required");docker("cp",file,`${name}:/tmp/candidate.sql`);docker("exec",name,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-1","-f","/tmp/candidate.sql");}
try{
 if(action==="destroy"){destroy();console.log(JSON.stringify({destroyed:true,container:name}));}
 else if(action==="create"){create();}
 else if(action==="verify"){verify();console.log(JSON.stringify({verified:true,container:name}));}
 else if(action==="apply"){apply(candidate);console.log(JSON.stringify({applied:true,candidate}));}
 else if(action==="self-test"){
   create();
   writeFileSync(smoke,"create table public.marketplace_disposable_candidate_compile(id uuid primary key default gen_random_uuid());\n");
   apply(smoke);
   psql("begin;insert into public.marketplace_disposable_candidate_compile default values;rollback;");
   psql("do $$begin if to_regclass('public.marketplace_disposable_candidate_compile') is null then raise exception 'candidate_compile_missing';end if;if exists(select 1 from public.marketplace_disposable_candidate_compile)then raise exception 'fixture_rollback_failed';end if;end$$");
   console.log(JSON.stringify({schema_restore:true,candidate_compile:true,fixture_rollback:true,production_data_dumped:false},null,2));
 }else throw new Error("usage:create|verify|apply <migration>|destroy|self-test");
}finally{
 if(action==="self-test")destroy();
 rmSync(temp,{recursive:true,force:true});
}
