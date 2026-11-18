import test from 'node:test';
import assert from 'node:assert/strict';
import {runB2ExplicitConnection} from '../scripts/nelyon-b2-explicit-connection.mjs';
const ref='aewwdlvbwpczqyvkwvvj';
const secret='temporary-test-password';
const token='test-management-token';
const fixture=()=>{
 const calls=[];
 return {calls, input:{phase:'dry-run',projectRef:ref,host:`db.${ref}.supabase.co`,token,cwd:'fixture-workdir',
   manifest:{resources:{migrations:[{path:'supabase/migrations/20260102000000_b2.sql',version:'20260102000000'}]}},
   verifyContext:async()=>{calls.push('gate');return {cliVersion:'2.120.0',effectiveConfigVerified:true};},
   request:async spec=>{calls.push(spec);return {role:'cli_login_postgres',password:secret};},
   execute:async spec=>{calls.push(spec);return {exitCode:0,stdout:JSON.stringify({dryRun:true,message:'ok',migrations:['20260102000000_b2.sql'],roles:[],seeds:[],upToDate:false})};}
 }};
};
test('explicit dry-run validates gate before mint, no credentials in argv or output',async()=>{
 const {input,calls}=fixture(); const result=await runB2ExplicitConnection(input);
 assert.deepEqual(result,{complete:true,pending_versions:['20260102000000']});
 assert.equal(calls[0],'gate'); assert.equal(calls.length,4);
 assert.equal(calls[1].url,`https://api.supabase.com/v1/projects/${ref}/cli/login-role`);
 assert.deepEqual(calls[1].body,{read_only:false});
 assert.equal(calls[3].env.PGPASSWORD,secret);
 assert.deepEqual(Object.keys(calls[3].env),['PGPASSWORD']);
 assert.ok(calls[3].args.includes('--db-url'));
 assert.ok(!calls[3].args.includes('--project-ref'));
 assert.ok(calls[3].args.includes('--skip-vault'));
 assert.ok(calls[3].args.includes('--dry-run'));
 assert.ok(calls[3].args.some(x=>x.endsWith('?sslmode=verify-full')));
 assert.ok(!JSON.stringify(calls[3].args).includes(secret));
 assert.ok(!JSON.stringify(result).includes(secret));
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
 assert.equal(calls.length,4);
});
test('transport failure does not fall back or expose token',async()=>{
 const {input,calls}=fixture(); input.request=async spec=>{calls.push(spec);throw Error(token);};
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 assert.equal(calls.length,2);
});
test('rejects unexpected role without launching CLI',async()=>{
 const {input,calls}=fixture(); input.request=async()=>({role:'postgres',password:secret});
 await assert.rejects(()=>runB2ExplicitConnection(input)); assert.equal(calls.length,1);
});
test('apply preserves no dry-run and returns no child output',async()=>{
 const {input,calls}=fixture(); input.phase='apply'; input.execute=async spec=>{calls.push(spec);return {exitCode:0,stdout:secret};};
 assert.deepEqual(await runB2ExplicitConnection(input),{complete:true});
 assert.ok(!calls[3].args.includes('--dry-run'));
});
test('rejects dry-run mismatch against existing manifest gate',async()=>{
 const {input}=fixture(); input.manifest.resources.migrations=[];
 await assert.rejects(()=>runB2ExplicitConnection(input));
});
test('transport and child specifications bound execution and forbid shell/redirects',async()=>{
 const {input,calls}=fixture(); await runB2ExplicitConnection(input);
 assert.equal(calls[1].redirect,'error'); assert.equal(calls[1].timeoutMs,15000);
 assert.equal(calls[3].shell,false); assert.equal(calls[3].timeoutMs,120000); assert.equal(calls[3].maxBuffer,1048576);
});
test('context rejection cannot mint role',async()=>{
 const {input,calls}=fixture(); input.verifyContext=async()=>{throw Error('expired authority');};
 await assert.rejects(()=>runB2ExplicitConnection(input)); assert.deepEqual(calls,[]);
});
for(const role of [null,{role:'cli_login_postgres',password:''},{role:'cli_login_postgres',password:'x\0y'},{role:'cli_login_bad@host',password:secret}]) {
 test('invalid login-role response prevents subprocess',async()=>{
  const {input,calls}=fixture(); input.request=async()=>role;
  await assert.rejects(()=>runB2ExplicitConnection(input)); assert.deepEqual(calls,['gate']);
 });
}
test('successful dry-run output containing credential is rejected',async()=>{
 const {input}=fixture(); input.execute=async()=>({exitCode:0,stdout:secret});
 await assert.rejects(()=>runB2ExplicitConnection(input),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
});
test('revalidates authority after mint and aborts changed context before execute',async()=>{
 const {input,calls}=fixture();let count=0;input.verifyContext=async()=>{count++;return {cliVersion:'2.120.0',effectiveConfigVerified:count===1};};
 await assert.rejects(()=>runB2ExplicitConnection(input));
 assert.equal(count,2);assert.equal(calls.length,1);
});
