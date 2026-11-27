import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import * as explicitConnection from '../scripts/nelyon-b2-explicit-connection.mjs';
const {runB2ExplicitConnection} = explicitConnection;
const ref='aewwdlvbwpczqyvkwvvj';
const secret='temporary-test-password';
const token='test-management-token';
const sessionPoolerHost='aws-0-us-east-1.pooler.supabase.com';
const primaryPoolerConfig=(overrides={})=>{
 const connection=`postgresql://postgres.${ref}:[YOUR-PASSWORD]@${sessionPoolerHost}:6543/postgres`;
 return [{
  identifier:'primary-fixture',database_type:'PRIMARY',is_using_scram_auth:true,
  db_user:`postgres.${ref}`,db_host:sessionPoolerHost,db_port:6543,db_name:'postgres',
  connection_string:connection,connectionString:connection,default_pool_size:15,
  max_client_conn:200,pool_mode:'transaction',...overrides,
 }];
};
const fixture=()=>{
 const calls=[];
 return {calls, input:{phase:'dry-run',projectRef:ref,host:`db.${ref}.supabase.co`,token,cwd:'fixture-workdir',
   manifest:{resources:{migrations:[{path:'supabase/migrations/20260102000000_b2.sql',version:'20260102000000'}]}},
   verifyContext:async()=>{calls.push('gate');return {cliVersion:'2.120.0',effectiveConfigVerified:true};},
   request:async spec=>{calls.push(spec);return spec.method==='GET'
    ?primaryPoolerConfig():{role:'cli_login_postgres',password:secret,ttl_seconds:300};},
   execute:async spec=>{calls.push(spec);return {exitCode:0,stdout:spec.args[1]==='query'
    ?JSON.stringify([{ok:true}]):JSON.stringify({dryRun:true,message:'ok',migrations:['20260102000000_b2.sql'],roles:[],seeds:[],upToDate:false})};},
   wait:async()=>{},
 }};
};
test('explicit dry-run validates gate before mint, no credentials in argv or output',async()=>{
 const {input,calls}=fixture(); const result=await runB2ExplicitConnection(input);
 assert.deepEqual(result,{complete:true,pending_versions:['20260102000000']});
 assert.equal(calls[0],'gate'); assert.equal(calls.length,7);
 assert.equal(calls[1].url,`https://api.supabase.com/v1/projects/${ref}/config/database/pooler`);
 assert.equal(calls[1].method,'GET');
 assert.equal(calls[2].url,`https://api.supabase.com/v1/projects/${ref}/cli/login-role`);
 assert.deepEqual(calls[2].body,{read_only:false});
 assert.equal(calls[4].args[1],'query');assert.equal(calls[5],'gate');
 assert.equal(calls[4].args[6],"select session_user = 'cli_login_postgres' and current_user = 'postgres' and current_database() = 'postgres' as ok");
 assert.equal(calls[6].env.PGPASSWORD,secret);
 assert.deepEqual(Object.keys(calls[6].env),['PGPASSWORD']);
 assert.ok(calls[6].args.includes('--db-url'));
 assert.ok(!calls[6].args.includes('--project-ref'));
 assert.ok(calls[6].args.includes('--skip-vault'));
 assert.ok(calls[6].args.includes('--dry-run'));
 assert.ok(calls[6].args.some(x=>x.endsWith('?sslmode=verify-full')));
 assert.ok(!JSON.stringify(calls[6].args).includes(secret));
 assert.ok(!JSON.stringify(result).includes(secret));
});
test('uses the provider PRIMARY session pooler and never executes the IPv6-only direct host',async()=>{
 const {input,calls}=fixture();
 input.request=async specification=>{
  calls.push(specification);
  if(specification.method==='GET') return primaryPoolerConfig();
  if(specification.method==='POST') return {role:'cli_login_postgres',password:secret,ttl_seconds:300};
  throw new Error('unexpected provider request');
 };
 await runB2ExplicitConnection(input);
 assert.equal(calls[0],'gate');
 assert.equal(calls[1].method,'GET');
 assert.equal(calls[1].url,`https://api.supabase.com/v1/projects/${ref}/config/database/pooler`);
 assert.equal(calls[2].method,'POST');
 assert.equal(calls[3],'gate');
 assert.equal(calls[4].args[1],'query');assert.equal(calls[5],'gate');
 assert.match(calls[6].args[3],new RegExp(`^postgresql://cli_login_postgres\\.${ref}@${sessionPoolerHost.replaceAll('.','\\.')}:5432/postgres\\?sslmode=verify-full$`));
 assert.ok(!calls[6].args.some(value=>String(value).includes(`db.${ref}.supabase.co`)));
 assert.ok(!JSON.stringify(calls[6].args).includes(secret));
 assert.ok(!JSON.stringify(calls[6].args).includes(token));
});
test('accepts the documented provider response without an undocumented camelCase alias',async()=>{
 const {input}=fixture();input.request=async spec=>spec.method==='GET'
  ?primaryPoolerConfig({connectionString:undefined}).map(({connectionString,...entry})=>entry)
  :{role:'cli_login_postgres',password:secret,ttl_seconds:300};
 assert.deepEqual(await runB2ExplicitConnection(input),{complete:true,pending_versions:['20260102000000']});
});
for(const [name,change] of [
 ['wrong project',x=>x.projectRef='other'], ['wrong host',x=>x.host='localhost'],
 ['wrong phase',x=>x.phase='repair'], ['wrong version',x=>x.verifyContext=async()=>({cliVersion:'latest',effectiveConfigVerified:true})],
 ['unverified config',x=>x.verifyContext=async()=>({cliVersion:'2.120.0',effectiveConfigVerified:false})],
]) test(`rejects ${name} before request`,async()=>{
 const {input,calls}=fixture(); change(input); await assert.rejects(()=>runB2ExplicitConnection(input));
 assert.ok(!calls.some(x=>x?.url));
});
test('authentication failure stops once and hides remote message',async()=>{
 const {input,calls}=fixture(); input.execute=async spec=>{calls.push(spec);return {exitCode:1,stderr:secret+token};};
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(calls.filter(value=>value?.args?.[1]==='query').length,9);
 assert.equal(calls.filter(value=>value?.args?.[1]==='push').length,0);
});
test('readiness exhaustion exposes only a closed sanitized diagnostic for the final attempt',async()=>{
 const {input,calls}=fixture();let monotonic=0;
 input.monotonicClock=()=>{const value=monotonic;monotonic+=25;return value;};
 input.execute=async spec=>{calls.push(spec);return spec.args[1]==='query'
  ?{exitCode:28,stdout:'x',stderr:secret+token}:{exitCode:0,stdout:'{}'};};
 let captured;
 await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.equal(captured.message,'B2_EXPLICIT_CONNECTION_FAILED');
 assert.equal(captured.stack,'Error: B2_EXPLICIT_CONNECTION_FAILED');
 assert.equal(Object.hasOwn(captured,'diagnostic'),false);
 const diagnostic=explicitConnection.readB2ExplicitConnectionDiagnostic(captured);
 assert.deepEqual(diagnostic,{phase:'B2_EXPLICIT_CONNECTION',boundary:'READINESS',kind:'EXIT_NONZERO',
  attempt:9,elapsedMs:25,exitCode:28,stdoutBytes:1,stderrBytes:Buffer.byteLength(secret+token)});
 assert.ok(Object.isFrozen(diagnostic));
 assert.doesNotMatch(JSON.stringify(diagnostic)+captured.stack,new RegExp(`${secret}|${token}`));
 assert.equal(calls.filter(value=>value?.args?.[1]==='query').length,9);
});
test('transport failure does not fall back or expose token',async()=>{
 const {input,calls}=fixture();let monotonic=0;input.monotonicClock=()=>{const value=monotonic;monotonic+=25;return value;};
 input.request=async spec=>{calls.push(spec);throw Error(token);};let captured;
 await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.deepEqual(explicitConnection.readB2ExplicitConnectionDiagnostic(captured),{
  phase:'B2_EXPLICIT_CONNECTION',boundary:'POOLER_CONFIG',kind:'TRANSPORT',attempt:0,elapsedMs:25,
  exitCode:null,stdoutBytes:0,stderrBytes:0});
 assert.equal(calls.length,2);
});
test('invalid successful readiness output is classified without retry or secret disclosure',async()=>{
 const {input}=fixture();let monotonic=0;let pushes=0;
 input.monotonicClock=()=>{const value=monotonic;monotonic+=25;return value;};
 input.execute=async spec=>{if(spec.args[1]==='query')return {exitCode:0,stdout:`not-json-${secret}`,stderr:''};
  pushes++;return {exitCode:0,stdout:'{}'};};
 let captured;await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.deepEqual(explicitConnection.readB2ExplicitConnectionDiagnostic(captured),{
  phase:'B2_EXPLICIT_CONNECTION',boundary:'READINESS',kind:'OUTPUT_INVALID',attempt:1,elapsedMs:25,
  exitCode:0,stdoutBytes:Buffer.byteLength(`not-json-${secret}`),stderrBytes:0});
 assert.equal(pushes,0);assert.doesNotMatch(JSON.stringify(captured),new RegExp(secret));
});
test('invalid subprocess exit-code shape is output invalid and never retried',async()=>{
 const {input,calls}=fixture();let monotonic=0;
 input.monotonicClock=()=>{const value=monotonic;monotonic+=25;return value;};
 input.execute=async spec=>{calls.push(spec);return {exitCode:'1',stdout:secret,stderr:token};};
 let captured;await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.deepEqual(explicitConnection.readB2ExplicitConnectionDiagnostic(captured),{
  phase:'B2_EXPLICIT_CONNECTION',boundary:'READINESS',kind:'OUTPUT_INVALID',attempt:1,elapsedMs:25,
  exitCode:null,stdoutBytes:0,stderrBytes:0});
 assert.equal(calls.filter(value=>value?.args?.[1]==='query').length,1);
 assert.doesNotMatch(String(captured.stack),new RegExp(`${secret}|${token}`));
});
test('dry-run nonzero is classified after readiness without copying provider output',async()=>{
 const {input}=fixture();let monotonic=0;
 input.monotonicClock=()=>{const value=monotonic;monotonic+=25;return value;};
 input.execute=async spec=>spec.args[1]==='query'?{exitCode:0,stdout:'[{"ok":true}]',stderr:''}
  :{exitCode:19,stdout:'x',stderr:secret+token};
 let captured;await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 const diagnostic=explicitConnection.readB2ExplicitConnectionDiagnostic(captured);
 assert.deepEqual(diagnostic,{phase:'B2_EXPLICIT_CONNECTION',boundary:'DRY_RUN',kind:'EXIT_NONZERO',
  attempt:0,elapsedMs:25,exitCode:19,stdoutBytes:1,stderrBytes:Buffer.byteLength(secret+token)});
 assert.doesNotMatch(JSON.stringify(diagnostic)+captured.stack,new RegExp(`${secret}|${token}`));
});
test('diagnostic reader cannot be spoofed by properties, getters, or proxies',()=>{
 let inspected=0;const forged=Object.assign(new Error(secret),{diagnostic:{phase:'B2_EXPLICIT_CONNECTION'}});
 const getter=Object.defineProperty(new Error(secret),'diagnostic',{get(){inspected++;throw new Error(secret);}});
 const proxy=new Proxy(forged,{get(){inspected++;throw new Error(secret);},getPrototypeOf(){inspected++;throw new Error(secret);}});
 for(const value of [forged,getter,proxy,{},null])assert.equal(explicitConnection.readB2ExplicitConnectionDiagnostic(value),undefined);
 assert.equal(inspected,0);
});
for(const [name,providerResponse] of [
 ['missing PRIMARY',()=>primaryPoolerConfig({database_type:'READ_REPLICA'})],
 ['multiple PRIMARY',()=>[...primaryPoolerConfig(),...primaryPoolerConfig({identifier:'second'})]],
 ['wrong tenant',()=>{const value=primaryPoolerConfig()[0];const connection=value.connection_string.replace(ref,'wrongtenant');return [{...value,connection_string:connection,connectionString:connection}];}],
 ['missing tenant suffix',()=>{const value=primaryPoolerConfig()[0];const connection=value.connection_string.replace(`postgres.${ref}`,'postgres');return [{...value,db_user:'postgres',connection_string:connection,connectionString:connection}];}],
 ['lookalike pooler domain',()=>{const value=primaryPoolerConfig()[0];const host=`${sessionPoolerHost}.evil.invalid`;const connection=value.connection_string.replace(sessionPoolerHost,host);return [{...value,db_host:host,connection_string:connection,connectionString:connection}];}],
 ['different database',()=>{const value=primaryPoolerConfig()[0];const connection=value.connection_string.replace('/postgres','/other');return [{...value,db_name:'other',connection_string:connection,connectionString:connection}];}],
 ['real embedded password',()=>{const value=primaryPoolerConfig()[0];const connection=value.connection_string.replace('[YOUR-PASSWORD]','provider-secret');return [{...value,connection_string:connection,connectionString:connection}];}],
 ['unexpected query',()=>{const value=primaryPoolerConfig()[0];const connection=`${value.connection_string}?application_name=unsafe`;return [{...value,connection_string:connection,connectionString:connection}];}],
 ['divergent connection aliases',()=>primaryPoolerConfig({connectionString:'postgresql://different.invalid/postgres'})],
 ['non PostgreSQL scheme',()=>{const value=primaryPoolerConfig()[0];const connection=value.connection_string.replace('postgresql:','https:');return [{...value,connection_string:connection,connectionString:connection}];}],
 ['non-array response',()=>({database_type:'PRIMARY'})],
]) test(`rejects ${name} pooler config before mint or subprocess`,async()=>{
 const {input,calls}=fixture();let mints=0;let executions=0;
 input.request=async specification=>{calls.push(specification);if(specification.method==='GET')return providerResponse();mints++;return {role:'cli_login_postgres',password:secret,ttl_seconds:300};};
 input.execute=async()=>{executions++;return {exitCode:0,stdout:'{}'};};
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(mints,0);assert.equal(executions,0);assert.equal(calls.length,2);
});
test('rejects unexpected role without launching CLI',async()=>{
 const {input,calls}=fixture(); input.request=async spec=>{calls.push(spec);return spec.method==='GET'
  ?primaryPoolerConfig():{role:'postgres',password:secret,ttl_seconds:300};};
 await assert.rejects(()=>runB2ExplicitConnection(input)); assert.equal(calls.length,3);
});
test('apply preserves no dry-run and returns no child output',async()=>{
 const {input,calls}=fixture(); input.phase='apply'; input.execute=async spec=>{calls.push(spec);return {exitCode:0,stdout:spec.args[1]==='query'?'[{"ok":true}]':secret};};
 assert.deepEqual(await runB2ExplicitConnection(input),{complete:true});
 assert.ok(!calls[6].args.includes('--dry-run'));
});
test('rejects dry-run mismatch against existing manifest gate',async()=>{
 const {input}=fixture(); input.manifest.resources.migrations=[];
 await assert.rejects(()=>runB2ExplicitConnection(input));
});
test('transport and child specifications bound execution and forbid shell/redirects',async()=>{
 const {input,calls}=fixture(); await runB2ExplicitConnection(input);
 assert.equal(calls[1].redirect,'error'); assert.equal(calls[1].timeoutMs,15000);
 assert.equal(calls[2].redirect,'error'); assert.equal(calls[2].timeoutMs,15000);
 assert.equal(calls[4].shell,false); assert.equal(calls[4].timeoutMs,15000); assert.equal(calls[4].maxBuffer,65536);
 assert.equal(calls[6].shell,false); assert.equal(calls[6].timeoutMs,120000); assert.equal(calls[6].maxBuffer,1048576);
});
test('context rejection cannot mint role',async()=>{
 const {input,calls}=fixture(); input.verifyContext=async()=>{throw Error('expired authority');};
 await assert.rejects(()=>runB2ExplicitConnection(input)); assert.deepEqual(calls,[]);
});
for(const role of [null,{role:'cli_login_postgres',password:secret},{role:'cli_login_postgres',password:'',ttl_seconds:300},{role:'cli_login_postgres',password:'x\0y',ttl_seconds:300},{role:'cli_login_fixture',password:secret,ttl_seconds:300},{role:'cli_login_bad@host',password:secret,ttl_seconds:300},{role:'cli_login_postgres',password:secret,ttl_seconds:0},{role:'cli_login_postgres',password:secret,ttl_seconds:300.5}]) {
 test('invalid login-role response prevents subprocess',async()=>{
  const {input,calls}=fixture(); input.request=async spec=>{calls.push(spec);return spec.method==='GET'?primaryPoolerConfig():role;};
  await assert.rejects(()=>runB2ExplicitConnection(input)); assert.equal(calls.length,3);
 });
}
test('successful dry-run output containing credential is rejected',async()=>{
 const {input}=fixture(); input.execute=async spec=>({exitCode:0,stdout:spec.args[1]==='query'?'[{"ok":true}]':secret});
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
});
test('revalidates authority after mint and aborts changed context before execute',async()=>{
 const {input,calls}=fixture();let count=0;input.verifyContext=async()=>{count++;return {cliVersion:'2.120.0',effectiveConfigVerified:count===1};};let captured;
 await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.deepEqual(explicitConnection.readB2ExplicitConnectionDiagnostic(captured),{
  phase:'B2_EXPLICIT_CONNECTION',boundary:'READINESS',kind:'CONTEXT_INVALID',attempt:1,elapsedMs:0,
  exitCode:null,stdoutBytes:0,stderrBytes:0});
 assert.equal(count,2);assert.equal(calls.length,2);
});
test('revalidates authority after readiness and aborts before migration push',async()=>{
 const {input}=fixture();let gates=0;let probes=0;let pushes=0;
 input.verifyContext=async()=>({cliVersion:'2.120.0',effectiveConfigVerified:++gates<3});
 input.execute=async spec=>{
  if(spec.args[1]==='query'){probes++;return {exitCode:0,stdout:'[{"ok":true}]'};}
  pushes++;return {exitCode:0,stdout:'{}'};
 };
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(gates,3);assert.equal(probes,1);assert.equal(pushes,0);
});
test('retries only the read-only readiness probe with the same role before migration planning',async()=>{
 const {input}=fixture();let probes=0;let pushes=0;let mints=0;const waits=[];
 input.request=async spec=>spec.method==='GET'?primaryPoolerConfig():(mints++,{role:'cli_login_postgres',password:secret,ttl_seconds:300});
 input.wait=async delay=>waits.push(delay);
 input.execute=async spec=>{
  if(spec.args[1]==='query'){
   probes++;if(probes===1)throw new Error(secret+token);
   return {exitCode:0,stdout:'[{"ok":true}]'};
  }
  pushes++;return {exitCode:0,stdout:JSON.stringify({dryRun:true,message:'ok',migrations:['20260102000000_b2.sql'],roles:[],seeds:[],upToDate:false})};
 };
 assert.deepEqual(await runB2ExplicitConnection(input),{complete:true,pending_versions:['20260102000000']});
 assert.equal(mints,1);assert.equal(probes,2);assert.equal(pushes,1);assert.deepEqual(waits,[3000]);
});
test('rejects a readiness response that does not prove the exact role and database contract',async()=>{
 const {input}=fixture();let pushes=0;input.execute=async spec=>{
  if(spec.args[1]==='query')return {exitCode:0,stdout:'[{"ok":false}]'};
  pushes++;return {exitCode:0,stdout:'{}'};
 };
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(pushes,0);
});
for(const stdout of ['{}','[]','[{"ok":true,"extra":false}]','[{"ok":"true"}]','[{"ok":true},{"ok":true}]']) {
 test('rejects hostile readiness JSON before migration push',async()=>{
  const {input}=fixture();let pushes=0;
  input.execute=async spec=>{
   if(spec.args[1]==='query')return {exitCode:0,stdout};
   pushes++;return {exitCode:0,stdout:'{}'};
  };
  await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
  assert.equal(pushes,0);
 });
}
test('fails closed before push when the temporary role cannot retain the full push budget',async()=>{
 const {input}=fixture();let now=0;let pushes=0;let probes=0;
 input.clock=()=>now;
 input.request=async spec=>spec.method==='GET'?primaryPoolerConfig():{role:'cli_login_postgres',password:secret,ttl_seconds:130};
 input.execute=async spec=>{
  if(spec.args[1]==='query'){probes++;now=6000;return {exitCode:0,stdout:'[{"ok":true}]'};}
  pushes++;return {exitCode:0,stdout:'{}'};
 };
 let captured;await assert.rejects(()=>runB2ExplicitConnection(input),error=>{captured=error;return true;});
 assert.deepEqual(explicitConnection.readB2ExplicitConnectionDiagnostic(captured),{
  phase:'B2_EXPLICIT_CONNECTION',boundary:'READINESS',kind:'EXPIRY_BUDGET',attempt:1,elapsedMs:0,
  exitCode:null,stdoutBytes:0,stderrBytes:0});
 assert.equal(probes,0);assert.equal(pushes,0);
});
test('accounts for probe duration and refuses to start push inside the expiry reserve',async()=>{
 const {input}=fixture();let now=0;let pushes=0;let probes=0;
 input.clock=()=>now;
 input.request=async spec=>spec.method==='GET'?primaryPoolerConfig():{role:'cli_login_postgres',password:secret,ttl_seconds:150};
 input.execute=async spec=>{
  if(spec.args[1]==='query'){probes++;now=26000;return {exitCode:0,stdout:'[{"ok":true}]'};}
  pushes++;return {exitCode:0,stdout:'{}'};
 };
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(probes,1);assert.equal(pushes,0);
});
test('does not sleep into the reserved push window after a failed probe',async()=>{
 const {input}=fixture();let now=0;let pushes=0;let probes=0;let waits=0;
 input.clock=()=>now;
 input.request=async spec=>spec.method==='GET'?primaryPoolerConfig():{role:'cli_login_postgres',password:secret,ttl_seconds:150};
 input.execute=async spec=>{
  if(spec.args[1]==='query'){probes++;now=10000;return {exitCode:1,stdout:''};}
  pushes++;return {exitCode:0,stdout:'{}'};
 };
 input.wait=async()=>{waits++;};
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(probes,1);assert.equal(waits,0);assert.equal(pushes,0);
});
for(const values of [[NaN],[0,-1],[0,0.5]]) {
 test('rejects an invalid or regressing role-lifetime clock before mutation',async()=>{
  const {input}=fixture();let index=0;let executions=0;
  input.clock=()=>values[Math.min(index++,values.length-1)];
  input.execute=async()=>{executions++;return {exitCode:0,stdout:'[{"ok":true}]'};};
  await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
  assert.equal(executions,0);
 });
}
for(const stdout of ['not-json','x'.repeat(65537),`[{"ok":true,"echo":"${secret}"}]`,`[{"ok":true,"echo":"${token}"}]`]) {
 test('rejects malformed, oversized or credential-bearing readiness output',async()=>{
  const {input}=fixture();let pushes=0;
  input.execute=async spec=>{
   if(spec.args[1]==='query')return {exitCode:0,stdout};
   pushes++;return {exitCode:0,stdout:'{}'};
  };
  await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
  assert.equal(pushes,0);
 });
}
