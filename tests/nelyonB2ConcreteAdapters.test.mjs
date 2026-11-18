import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import * as implementation from '../scripts/nelyon-b2-explicit-connection.mjs';
import {createHermeticMigrationWorkspace} from '../scripts/nelyon-b2-hermetic-workspace.mjs';
const request=()=>({url:'https://api.supabase.com/v1/projects/aewwdlvbwpczqyvkwvvj/cli/login-role',method:'POST',redirect:'error',timeoutMs:15000,headers:{Authorization:'Bearer test-token'},body:{read_only:false}});
test('HTTP adapter uses fixed role endpoint with bounded timeout and redirect rejection',async()=>{
 assert.equal(typeof implementation.createB2HttpAdapter,'function');let seen;
 const adapter=implementation.createB2HttpAdapter({fetchImpl:async(url,options)=>{seen={url,options};return new Response(JSON.stringify({role:'cli_login_postgres',password:'test-pass'}),{status:201});}});
 assert.deepEqual(await adapter(request()),{role:'cli_login_postgres',password:'test-pass'});
 assert.equal(seen.options.redirect,'error');assert.equal(seen.options.method,'POST');assert.ok(seen.options.signal instanceof AbortSignal);
 assert.equal(seen.options.body,'{"read_only":false}');
});
for(const [name,change] of [ ['wrong destination',s=>s.url='https://evil.invalid'],['redirect',s=>s.redirect='follow'],['wrong method',s=>s.method='DELETE'],['different body',s=>s.body={read_only:true}],['unbounded timeout',s=>s.timeoutMs=0]]) {
 test(`HTTP rejects ${name} before fetch`,async()=>{let calls=0;assert.equal(typeof implementation.createB2HttpAdapter,'function');const adapter=implementation.createB2HttpAdapter({fetchImpl:async()=>{calls++;}});const spec=request();change(spec);await assert.rejects(()=>adapter(spec));assert.equal(calls,0);});
}
for(const [name,response] of [['unauthorized',()=>new Response('test-token',{status:401})],['oversized',()=>new Response('x'.repeat(65537),{status:201})],['invalid JSON',()=>new Response('bad',{status:201})],['invalid role',()=>new Response(JSON.stringify({role:'postgres',password:'test-pass'}),{status:201})]]) {
 test(`HTTP ${name} returns only constant error and no retry`,async()=>{assert.equal(typeof implementation.createB2HttpAdapter,'function');let calls=0;const adapter=implementation.createB2HttpAdapter({fetchImpl:async()=>{calls++;return response();}});await assert.rejects(()=>adapter(request()),{message:'B2_EXPLICIT_CONNECTION_FAILED'});assert.equal(calls,1);});
}
function workspaceFixture(){
 const root=mkdtempSync(join(fileURLToPath(new URL('../',import.meta.url)),'.b2-adapter-test-'));
 const hash=x=>createHash('sha256').update(x).digest('hex');const binary=Buffer.from('not executable fixture');const binaryPath=join(root,'fake');writeFileSync(binaryPath,binary);
 const bytes=Buffer.from('[functions.example]\nverify_jwt = true\n');
 return {root,workspace:createHermeticMigrationWorkspace({parent:root,binaryPath,binarySha256:hash(binary),files:[{path:'supabase/config.toml',bytes,sha256:hash(bytes)}]})};
}
const execution=w=>({executable:w.binaryPath,cwd:w.cwd,args:['db','push','--db-url','postgresql://cli_login_postgres@db.aewwdlvbwpczqyvkwvvj.supabase.co:5432/postgres?sslmode=verify-full','--skip-vault','--yes','--dry-run','--output-format','json'],env:{PGPASSWORD:'test-pass'},shell:false,timeoutMs:120000,maxBuffer:1048576});
test('executor uses pinned absolute binary, no shell and isolated environment',async()=>{
 assert.equal(typeof implementation.createB2Executor,'function');const {root,workspace}=workspaceFixture();try{let seen;
 const execute=implementation.createB2Executor({workspace,execFileImpl:(file,args,options,callback)=>{seen={file,args,options};callback(null,'{}','ignored');}});
 assert.deepEqual(await execute(execution(workspace)),{exitCode:0,stdout:'{}'});
 assert.equal(seen.file,workspace.binaryPath);assert.deepEqual(seen.options.env,{PGPASSWORD:'test-pass',HOME:workspace.homePath,USERPROFILE:workspace.homePath,XDG_CONFIG_HOME:workspace.homePath,DO_NOT_TRACK:'1',SUPABASE_NO_UPDATE_NOTIFIER:'1',SUPABASE_TELEMETRY_DISABLED:'1'});assert.equal(seen.options.shell,false);assert.equal(seen.options.windowsHide,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const [name,change] of [['extra argument',x=>x.args.push('--include-all')],['inherited token',x=>x.env.SUPABASE_ACCESS_TOKEN='token'],['alternate executable',x=>x.executable='supabase'],['alternate cwd',x=>x.cwd='elsewhere'],['shell enabled',x=>x.shell=true]]) {
 test(`executor rejects ${name} without spawn`,async()=>{assert.equal(typeof implementation.createB2Executor,'function');const {root,workspace}=workspaceFixture();try{let calls=0;const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{calls++;cb(null,'{}','');}});const spec=execution(workspace);change(spec);await assert.rejects(()=>execute(spec));assert.equal(calls,0);}finally{rmSync(root,{recursive:true,force:true});}});
}
test('executor suppresses secret-bearing spawn errors',async()=>{assert.equal(typeof implementation.createB2Executor,'function');const {root,workspace}=workspaceFixture();try{const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>cb(Error('test-pass'))});await assert.rejects(()=>execute(execution(workspace)),{message:'B2_EXPLICIT_CONNECTION_FAILED'});}finally{rmSync(root,{recursive:true,force:true});}});
test('HTTP rejects undocumented success status 200',async()=>{
 const adapter=implementation.createB2HttpAdapter({fetchImpl:async()=>new Response(JSON.stringify({role:'cli_login_postgres',password:'test-pass'}),{status:200})});
 await assert.rejects(()=>adapter(request()),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
});
test('executor isolates HOME USERPROFILE and XDG to metadata-only managed workspace home',async()=>{
 const {root,workspace}=workspaceFixture();try{let seen;
 const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,options,cb)=>{seen=options.env;cb(null,'{}','');}});
 await execute(execution(workspace));assert.equal(seen.HOME,join(workspace.cwd,'home'));assert.equal(seen.USERPROFILE,seen.HOME);assert.equal(seen.XDG_CONFIG_HOME,seen.HOME);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('unexpected managed-home contents stop executable before spawn',async()=>{
 const {root,workspace}=workspaceFixture();try{let calls=0;const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{calls++;cb(null,'{}','');}});
 writeFileSync(join(workspace.cwd,'home','unexpected'),'not allowed');await assert.rejects(()=>execute(execution(workspace)));assert.equal(calls,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing managed home fails before executable launch',async()=>{
 const {root,workspace}=workspaceFixture();try{let calls=0;const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{calls++;cb(null,'{}','');}});
 rmSync(workspace.homePath,{recursive:true,force:true});await assert.rejects(()=>execute(execution(workspace)));assert.equal(calls,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('unexpected home write during executable run fails closed',async()=>{
 const {root,workspace}=workspaceFixture();try{const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{writeFileSync(join(workspace.homePath,'unexpected'),'bad');cb(null,'{}','');}});
 await assert.rejects(()=>execute(execution(workspace)),{message:'B2_EXPLICIT_CONNECTION_FAILED'});
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('executor explicitly disables CLI telemetry and update checks without inheriting environment',async()=>{
 const {root,workspace}=workspaceFixture();try{let seen;
 const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{seen=o.env;cb(null,'{}','');}});
 await execute(execution(workspace));
 assert.equal(seen.DO_NOT_TRACK,'1');assert.equal(seen.SUPABASE_NO_UPDATE_NOTIFIER,'1');assert.equal(seen.SUPABASE_TELEMETRY_DISABLED,'1');
 assert.equal(seen.SUPABASE_ACCESS_TOKEN,undefined);
 assert.deepEqual(Object.keys(seen).sort(),['DO_NOT_TRACK','HOME','PGPASSWORD','SUPABASE_NO_UPDATE_NOTIFIER','SUPABASE_TELEMETRY_DISABLED','USERPROFILE','XDG_CONFIG_HOME'].sort());
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('malicious CLI metadata output is rejected without exposing file contents',async()=>{
 const {root,workspace}=workspaceFixture();try{const execute=implementation.createB2Executor({workspace,execFileImpl:(f,a,o,cb)=>{writeFileSync(join(workspace.homePath,'.supabase','telemetry.json'),'{"distinct_id":"SYNTHETIC_SECRET_MARKER"}');cb(null,'{}','');}});
 await assert.rejects(()=>execute(execution(workspace)),error=>{assert.equal(error.message,'B2_EXPLICIT_CONNECTION_FAILED');assert.doesNotMatch(String(error.stack),/SYNTHETIC_SECRET_MARKER/);return true;});
 }finally{rmSync(root,{recursive:true,force:true});}
});
