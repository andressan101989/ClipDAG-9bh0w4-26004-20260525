// PostgreSQL 17 loopback-only synthetic proofs. No project URL or credential input.
import assert from "node:assert/strict";
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname,basename} from "node:path";
import {spawnSync} from "node:child_process";
import {createServer} from "node:net";
const mode=process.argv[2]??"task5";assert.ok(["task5","plans"].includes(mode));
const repo=resolve(import.meta.dirname,".."),base=resolve("D:/CodexTemp"),bin=join(base,"postgres-17.11-disposable/pgsql/bin");
const cluster=mkdtempSync(join(base,`control-center-task8-${mode}-`));assert.equal(dirname(cluster),base);
const evidence=join(repo,`.superpowers/sdd/2026-10-30-superuser-control-center/task-8-${mode}`);
const {mkdirSync}=await import("node:fs");mkdirSync(evidence,{recursive:true});
const environment={...process.env};for(const key of Object.keys(environment))if(/^PG/i.test(key))delete environment[key];
environment.PGHOST="127.0.0.1";environment.PGHOSTADDR="127.0.0.1";environment.PGCONNECT_TIMEOUT="3";environment.PGSSLMODE="disable";
const listener=createServer();await new Promise((res,rej)=>{listener.once("error",rej);listener.listen(0,"127.0.0.1",res)});const port=listener.address().port;await new Promise(res=>listener.close(res));
let count=0,started=false,created=false,stopped=false,dropped=false,removed=false;
function invoke(tool,args,input,allowFailure=false){
 const result=spawnSync(join(bin,`${tool}.exe`),args,{input,encoding:"utf8",env:environment,windowsHide:true,timeout:45000,stdio:tool==="pg_ctl"?"ignore":"pipe"});
 writeFileSync(join(evidence,`${++count}-${tool}.log`),`${result.stdout??""}${result.stderr??""}`);
 if(!allowFailure)assert.equal(result.status,0,`${tool}: ${result.error?.message??result.stderr??result.stdout}`);return result;
}
const connection=["-X","--no-password","-h","127.0.0.1","-p",String(port),"-U","postgres","-d","task8proof","-v","ON_ERROR_STOP=1"];
const sql=(source,allowFailure=false)=>invoke("psql",connection,source,allowFailure);
const file=path=>readFileSync(join(repo,path),"utf8");
const migrationDir=join(repo,"supabase/migrations"),files=readdirSync(migrationDir).filter(name=>name.endsWith(".sql")).sort();
function latestFunction(name,before){let result;for(const nameOfFile of files){if(nameOfFile>=before)break;const source=readFileSync(join(migrationDir,nameOfFile),"utf8");const matches=[...source.matchAll(new RegExp(`create (?:or replace )?function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\$\\$;`,"gi"))];if(matches.length)result={source:matches.at(-1)[0],file:nameOfFile};}assert.ok(result,`latest ${name}`);return result;}
const names=["search_admin_ledger_accounts","search_admin_financial_transactions","search_admin_global_audit","search_admin_finance_audit","search_admin_system_audit"];
try{
 console.log(`Fresh PostgreSQL17 ${mode}: ${cluster}, 127.0.0.1:${port}`);
 console.log(invoke("postgres",["--version"]).stdout.trim());
 invoke("initdb",["-D",cluster,"-U","postgres","-A","trust","--no-locale","--encoding=UTF8","--no-sync"]);
 started=true;invoke("pg_ctl",["-D",cluster,"-l",join(evidence,"server.log"),"-o",`-h 127.0.0.1 -p ${port}`,"-w","-t","20","start"]);
 invoke("createdb",["-h","127.0.0.1","-p",String(port),"-U","postgres","task8proof"]);created=true;
 if(mode==="task5"){
  sql(file("tests/fixtures/adminControlCenterTask5Predecessor.sql"));
  const before="20261031025722_superuser_control_center_cursor_terminal_truth.sql",loaded=[];
  for(const name of ["private.admin_audit_safe_metadata","private.admin_audit_row_visible",...names.map(name=>`public.${name}`)]){const found=latestFunction(name,before);loaded.push({name,file:found.file});sql(found.source);}
  writeFileSync(join(evidence,"latest-predecessors.json"),JSON.stringify(loaded,null,2));
  // Match canonical authenticated-only read ACL before replacement.
  sql(`do $$declare r record;begin for r in select oid::regprocedure identity from pg_proc where proname=any(array[${names.map(n=>`'${n}'`).join(",")}]) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.identity);execute format('grant execute on function %s to authenticated',r.identity);end loop;end$$;`);
  const digestSql=`select md5(string_agg(pg_get_functiondef(oid)||proowner::text||proacl::text,'' order by oid)) from pg_proc where proname=any(array[${names.map(n=>`'${n}'`).join(",")}]);`;
  const baseline=sql(digestSql).stdout;
  const migration=file(`supabase/migrations/${before}`),body=migration.replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"");
  const rollback=sql(`begin;${body}\nselect 1/0;commit;`,true);assert.notEqual(rollback.status,0);assert.match(rollback.stderr,/division by zero/);
  assert.equal(sql(digestSql).stdout,baseline,"rollback restores exact predecessor definitions/owners/ACL");
  console.log("PASS: deliberate transaction failure restores exact predecessor function/owner/ACL digests");
  sql(migration);const result=sql(file("tests/fixtures/adminControlCenterTask5Assertions.sql"));console.log(result.stdout.trim());console.log(result.stderr.trim());
 }else{
  sql(file("tests/fixtures/adminControlCenterTask6Predecessor.sql"));sql(file("supabase/migrations/20261031032022_superuser_control_center_overview.sql"));sql(file("tests/fixtures/adminControlCenterTask6Assertions.sql"));
  // Real predecessor indexes on the synthetic shapes, never guessed substitutes.
  const indexSource=file("supabase/migrations/20260922174702_ads_v2_d_creative_moderation_foundation.sql");
  for(const name of ["advertising_ads_review_queue_idx","advertising_ad_review_events_ad_created_idx"]){const source=indexSource.match(new RegExp(`create index ${name}[\\s\\S]*?;`))?.[0];assert.ok(source);sql(source);}
  sql(`insert into private.advertising_ads select task6_proof.id(n),task6_proof.id(1),task6_proof.id(1),task6_proof.id(1),'Synthetic plan ad','draft',case n%4 when 0 then 'pending' when 1 then 'rejected' when 2 then 'approved' else 'not_submitted' end,repeat('a',64),'2026-01-01Z'::timestamptz+n*interval '1 minute',null from generate_series(1000,100999)n;
   insert into private.advertising_ad_review_events select task6_proof.id(n),task6_proof.id(n),'approved',null,null,task6_proof.id(1),'2026-10-30Z'::timestamptz from generate_series(1000,100999)n;
   analyze;`);
  const planBaseline=sql('select task6_proof.row_snapshot();').stdout;
  // Explain the exact bounded SELECT inside the actual PL/pgSQL RPC, including
  // joins/projection/lateral decision, rather than opaque Function Scan alone.
  const migration=file("supabase/migrations/20261031032022_superuser_control_center_overview.sql");
  const review=migration.slice(migration.indexOf("create or replace function public.search_admin_advertising_ads"));
  const select=review.match(/from \(\s*(select ad\.id[\s\S]*?)\) as item/)?.[1];assert.ok(select,"exact review select");
  const query=select;
  if(!query.includes("from private.advertising_ads"))throw new Error("review extraction did not retain base query");
  const plans=[];
  for(const status of ["pending","rejected","approved",null]){
   const q=query.replaceAll("p_review_status",status===null?"null::text":`'${status}'::text`).replaceAll("p_ad_id","null::uuid").replaceAll("p_cursor_id","null::uuid").replaceAll("p_cursor_submitted_at","null::timestamptz").replaceAll("v_limit","50");
   const result=sql(`\\pset format unaligned\n\\pset tuples_only on\nexplain(analyze,buffers,format json) ${q};`);writeFileSync(join(evidence,`review-${status??"all"}.json`),result.stdout);plans.push(status??"all");
   if(process.argv.includes("--require-index")&&(status==="approved"||status===null))assert.match(result.stdout,/advertising_ads_submitted_cursor_idx/,`${status??"all"} must use the measured bounded-order index`);
   const plan=JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))[0];console.log(`PLAN ${status??"all"}: ${plan['Execution Time']} ms, rows=${plan.Plan['Actual Rows']}`);
  }
  const exact=query.replaceAll("p_review_status","null::text").replaceAll("p_ad_id","task6_proof.id(100998)").replaceAll("p_cursor_id","null::uuid").replaceAll("p_cursor_submitted_at","null::timestamptz").replaceAll("v_limit","1");
  writeFileSync(join(evidence,"review-exact-id.json"),sql(`explain(analyze,buffers,format json) ${exact};`).stdout);
  // Overview EXPLAIN uses actual module statement text from its function body.
  const overview=migration.match(/create function public.get_admin_control_center_overview_v1[\s\S]*?\$\$;/)?.[0];assert.ok(overview);
  const users=overview.slice(overview.indexOf("when 'users' then"),overview.indexOf("when 'content' then"));
  const metricEnd=users.indexOf(" into v_metrics;")+" into v_metrics;".length;
  const statements=[users.slice(users.indexOf("select "),metricEnd),users.slice(metricEnd).trim()].map(q=>q.replace(/ into v_(?:metrics|series)/g,"").replaceAll("v_from","'2026-10-01Z'::timestamptz").replaceAll("v_until","'2026-10-31Z'::timestamptz"));
  for(const [index,statement] of statements.entries())writeFileSync(join(evidence,`overview-users-${index}.txt`),sql(`explain(analyze,buffers) ${statement}`).stdout);
  assert.equal(sql('select task6_proof.row_snapshot();').stdout,planBaseline,'EXPLAIN ANALYZE preserves all synthetic rows');
  console.log(`PASS: synthetic EXPLAIN ANALYZE exact review SELECT for ${plans.join("/")}/exact ID; overview RPC plan retained. ${statements.length} candidate overview statements inspected.`);
 }
}finally{
 if(started){try{if(created){invoke("dropdb",["-h","127.0.0.1","-p",String(port),"-U","postgres","--if-exists","task8proof"]);dropped=true;}}finally{invoke("pg_ctl",["-D",cluster,"-w","-t","20","-m","fast","stop"],undefined,true);stopped=invoke("pg_ctl",["-D",cluster,"status"],undefined,true).status===3;assert.ok(stopped,"server confirmed stopped before cleanup");}}
 if(stopped||!started){assert.equal(dirname(resolve(cluster)),base);assert.ok(basename(cluster).startsWith(`control-center-task8-${mode}-`));rmSync(cluster,{recursive:true});removed=!existsSync(cluster);}
 const cleanup={cluster,port,databaseDropped:dropped,serverStopped:stopped,directoryRemoved:removed};writeFileSync(join(evidence,"cleanup.json"),JSON.stringify(cleanup,null,2));console.log(`CLEANUP ${JSON.stringify(cleanup)}`);
}
