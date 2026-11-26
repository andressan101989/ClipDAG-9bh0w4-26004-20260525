import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,symlinkSync,linkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHermeticMigrationWorkspace,verifyHermeticMigrationWorkspace} from '../scripts/nelyon-b2-hermetic-workspace.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const parent=fileURLToPath(new URL('../',import.meta.url));
const poolerConfig=()=>{const ref='aewwdlvbwpczqyvkwvvj',host='aws-0-us-east-1.pooler.supabase.com',connection=`postgresql://postgres.${ref}:[YOUR-PASSWORD]@${host}:6543/postgres`;return [{identifier:'primary-fixture',database_type:'PRIMARY',is_using_scram_auth:true,db_user:`postgres.${ref}`,db_host:host,db_port:6543,db_name:'postgres',connection_string:connection,connectionString:connection,default_pool_size:15,max_client_conn:200,pool_mode:'transaction'}];};
const make=()=>{
 const root=mkdtempSync(join(parent,'.b2-hermetic-test-'));
 const bytes=Buffer.from('fake binary never executed');const binary=join(root,'supabase-fixture');writeFileSync(binary,bytes);
 const config=Buffer.from('[functions.example]\nverify_jwt = true\n');
 const migration=Buffer.from('select 1;\n');
 return {root,input:{parent:root,binaryPath:binary,binarySha256:hash(bytes),files:[
  {path:'supabase/config.toml',bytes:config,sha256:hash(config)},
  {path:'supabase/migrations/20260102000000_b2.sql',bytes:migration,sha256:hash(migration)}
 ]}};
};
test('materializes only approved bytes and pins absolute executable digest',()=>{
 const {root,input}=make();try{
 const workspace=createHermeticMigrationWorkspace(input);assert.equal(typeof workspace?.cwd,'string');
 assert.equal(verifyHermeticMigrationWorkspace(workspace),true);
 assert.equal(readFileSync(join(workspace.cwd,'supabase/config.toml'),'utf8'),input.files[0].bytes.toString());
 assert.equal(readFileSync(workspace.binaryPath,'utf8'),'fake binary never executed');
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const [name,change] of [
 ['wrong binary digest',x=>x.binarySha256='0'.repeat(64)],
 ['wrong file digest',x=>x.files[1].sha256='0'.repeat(64)],
 ['traversal',x=>x.files[1].path='../escape.sql'],
 ['env file',x=>x.files[1].path='.env'],
 ['duplicate path',x=>x.files.push(x.files[1])],
 ['remotes override',x=>{x.files[0].bytes=Buffer.from('[remotes.other]\n');x.files[0].sha256=hash(x.files[0].bytes);}],
 ['env config',x=>{x.files[0].bytes=Buffer.from('password = "env(SECRET)"\n');x.files[0].sha256=hash(x.files[0].bytes);}]
])test(`workspace rejects ${name}`,()=>{const {root,input}=make();try{change(input);assert.throws(()=>createHermeticMigrationWorkspace(input));}finally{rmSync(root,{recursive:true,force:true});}});
for(const [name,change] of [
 ['changed migration',w=>{const p=join(w.cwd,'supabase/migrations/20260102000000_b2.sql');rmSync(p,{force:true});writeFileSync(p,'changed');}],
 ['injected dotenv',w=>writeFileSync(join(w.cwd,'.env'),'PGHOST=evil')],
 ['extra migration',w=>writeFileSync(join(w.cwd,'supabase/migrations/20260103000000_extra.sql'),'select 2;')],
 ['changed executable',w=>{rmSync(w.binaryPath,{force:true});writeFileSync(w.binaryPath,'changed');}]
])test(`recheck rejects ${name}`,()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);change(w);assert.throws(()=>verifyHermeticMigrationWorkspace(w));}finally{rmSync(root,{recursive:true,force:true});}});

test('hermetic wrapper checks bytes after role mint before starting pinned executable',async()=>{
 const module=await import('../scripts/nelyon-b2-explicit-connection.mjs');
 assert.equal(typeof module.runB2HermeticConnection,'function');
 const {root,input}=make();try{
 const workspace=createHermeticMigrationWorkspace(input);let executes=0;
 await assert.rejects(()=>module.runB2HermeticConnection({workspace,phase:'apply',projectRef:'aewwdlvbwpczqyvkwvvj',host:'db.aewwdlvbwpczqyvkwvvj.supabase.co',token:'fixture-token',manifest:{},
 verifyContext:async()=>({cliVersion:'2.120.0',effectiveConfigVerified:true}),
 request:async spec=>{if(spec.method==='GET')return poolerConfig();writeFileSync(join(workspace.cwd,'.env'),'bad');return {role:'cli_login_postgres',password:'fixture-password',ttl_seconds:300};},
 execute:async()=>{executes++;return {exitCode:0};}}));
 assert.equal(executes,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('offline extended closure fixture still rejects old member sets and grants no authority',async()=>{
 const {privateRuntimeClosureMemberPaths,buildPrivateRuntimeClosureFromExactBytes}=await import('../scripts/nelyon-private-runtime-closure.mjs');
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/nelyonB2ExplicitConnectionClosureCandidate.json',import.meta.url),'utf8'));
 assert.equal(fixture.fixture_only,true);assert.equal(fixture.deployment_authorized,false);
 const members=privateRuntimeClosureMemberPaths();
 assert.deepEqual(fixture.current_local_closure.files.map(item=>item.path),members);
 const exactBlob=relativePath=>{
  const listing=execFileSync('git',['ls-tree','-z','HEAD','--',relativePath],{cwd:parent});
  const match=/^[0-9]{6} blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(listing.toString('utf8'));
  assert.ok(match);assert.equal(match[2],relativePath);
  return execFileSync('git',['cat-file','blob',match[1]],{cwd:parent,maxBuffer:16*1024*1024});
 };
 const files=members.map(path=>({path,bytes:exactBlob(path)}));
 for(const [index,file] of files.entries())assert.equal(hash(file.bytes),fixture.current_local_closure.files[index].sha256);
 assert.deepEqual(buildPrivateRuntimeClosureFromExactBytes({files}),fixture.current_local_closure);
 for(const proposed of fixture.proposed_members){
  const current=fixture.current_local_closure.files.find(item=>item.path===proposed.path);
  assert.ok(current);assert.equal(proposed.sha256,current.sha256);
 }
 const incomplete=files.filter(file=>!fixture.proposed_members.some(item=>item.path===file.path));
 assert.throws(()=>buildPrivateRuntimeClosureFromExactBytes({files:incomplete}),/private runtime closure rejected/);
});
test('hermetic wrapper rejects missing executor before mint',async()=>{
 const {runB2HermeticConnection}=await import('../scripts/nelyon-b2-explicit-connection.mjs');
 const {root,input}=make();try{const workspace=createHermeticMigrationWorkspace(input);let requests=0;
 await assert.rejects(()=>runB2HermeticConnection({workspace,phase:'apply',projectRef:'aewwdlvbwpczqyvkwvvj',host:'db.aewwdlvbwpczqyvkwvvj.supabase.co',token:'fixture-token',manifest:{},verifyContext:async()=>({cliVersion:'2.120.0',effectiveConfigVerified:true}),request:async()=>{requests++;return {role:'cli_login_postgres',password:'fixture-password',ttl_seconds:300};}}));
 assert.equal(requests,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('hermetic migration bytes must match manifest before use',async()=>{
 const module=await import('../scripts/nelyon-b2-hermetic-workspace.mjs');assert.equal(typeof module.verifyHermeticMigrationManifest,'function');
 const {root,input}=make();try{const workspace=createHermeticMigrationWorkspace(input);const migration=input.files[1];
 const manifest={resources:{migrations:[{path:migration.path,version:'20260102000000',sha256:migration.sha256}]}};
 assert.equal(module.verifyHermeticMigrationManifest(workspace,manifest),true);
 manifest.resources.migrations[0].sha256='0'.repeat(64);assert.throws(()=>module.verifyHermeticMigrationManifest(workspace,manifest));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Git provenance rejects unapproved complete workspace inventory',async()=>{
 const module=await import('../scripts/nelyon-b2-hermetic-workspace.mjs');assert.equal(typeof module.verifyHermeticGitSource,'function');
 const {root,input}=make();try{const workspace=createHermeticMigrationWorkspace(input);
 assert.throws(()=>module.verifyHermeticGitSource(workspace,{repositoryRoot:parent,approvedSha:'0'.repeat(40)}));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('approved Git reader returns committed bytes not dirty working tree and rejects invalid inventory',async()=>{
 const {execFileSync}=await import('node:child_process');
 const module=await import('../scripts/nelyon-b2-hermetic-workspace.mjs');assert.equal(typeof module.readApprovedMigrationFiles,'function');
 const {root,input}=make();try{
 mkdirSync(join(root,'supabase','migrations'),{recursive:true});
 for(const item of input.files)writeFileSync(join(root,item.path),item.bytes);
 const git=args=>execFileSync('git',['-c','core.autocrlf=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8',windowsHide:true});
 git(['init','--quiet']);git(['add','supabase']);git(['commit','--quiet','-m','fixture']);const approvedSha=git(['rev-parse','HEAD']).trim();
 writeFileSync(join(root,input.files[1].path),'dirty unapproved');
 const files=module.readApprovedMigrationFiles({repositoryRoot:root,approvedSha});assert.deepEqual(files,input.files);
 assert.throws(()=>module.readApprovedMigrationFiles({repositoryRoot:root,approvedSha:'0'.repeat(40)}));
 writeFileSync(join(root,'supabase','migrations','evil.txt'),'bad');git(['add','supabase']);git(['commit','--quiet','-m','invalid inventory']);
 assert.throws(()=>module.readApprovedMigrationFiles({repositoryRoot:root,approvedSha:git(['rev-parse','HEAD']).trim()}));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('workspace seeds only private disabled CLI telemetry metadata and accepts bounded timestamp refresh',()=>{
 const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase','telemetry.json');
 const initial=JSON.parse(readFileSync(p,'utf8'));assert.equal(initial.enabled,false);assert.equal(initial.schema_version,1);
 assert.deepEqual(Object.keys(initial).sort(),['enabled','device_id','session_id','session_last_active','schema_version'].sort());
 initial.session_last_active=new Date().toISOString();writeFileSync(p,JSON.stringify(initial));assert.equal(verifyHermeticMigrationWorkspace(w),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const [name,mutate] of [
 ['enabled',x=>({...x,enabled:true})],['secret field',x=>({...x,distinct_id:'SYNTHETIC_SECRET_MARKER'})],
 ['device identity',x=>({...x,device_id:'00000000-0000-4000-8000-000000000000'})],
 ['session identity',x=>({...x,session_id:'00000000-0000-4000-8000-000000000000'})],
 ['schema',x=>({...x,schema_version:2})],['future time',x=>({...x,session_last_active:'2999-01-01T00:00:00.000Z'})],
 ['old time',x=>({...x,session_last_active:'2000-01-01T00:00:00.000Z'})],['wrong time type',x=>({...x,session_last_active:{token:'SYNTHETIC_SECRET_MARKER'}})]
])test(`metadata rejects ${name} with constant error`,()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase','telemetry.json');const x=JSON.parse(readFileSync(p,'utf8'));writeFileSync(p,JSON.stringify(mutate(x)));assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
for(const [name,bytes] of [['oversized','X'.repeat(513)],['duplicate keys','{"enabled":false,"enabled":false}'],['invalid UTF8',Buffer.from([0xff])]])test(`metadata rejects ${name}`,()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);writeFileSync(join(w.homePath,'.supabase','telemetry.json'),bytes);assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});

for(const kind of ['symlink','hardlink'])test('metadata rejects '+kind+' indirection',()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase','telemetry.json');const external=join(root,'metadata-external.json');writeFileSync(external,readFileSync(p));rmSync(p);if(kind==='symlink')symlinkSync(external,p,'file');else linkSync(external,p);assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
for(const name of ['access-token','cli-latest','.env'])test('metadata directory rejects extra '+name,()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);writeFileSync(join(w.homePath,'.supabase',name),'SYNTHETIC_SECRET_MARKER');assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
for(const [name,mutate] of [['BOM',x=>Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),x])],['whitespace',x=>Buffer.concat([Buffer.from(' '),x])]])test('metadata rejects noncanonical '+name,()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase','telemetry.json');writeFileSync(p,mutate(readFileSync(p)));assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
test('metadata missing file is rejected',()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);rmSync(join(w.homePath,'.supabase','telemetry.json'));assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
test('metadata rejects a junction directory and no file content is trusted through it',()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase');const external=join(root,'external-metadata');mkdirSync(external);writeFileSync(join(external,'telemetry.json'),readFileSync(join(p,'telemetry.json')));rmSync(p,{recursive:true,force:true});symlinkSync(external,p,'junction');assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
test('metadata rejects a parseable non-ISO date',()=>{const {root,input}=make();try{const w=createHermeticMigrationWorkspace(input);const p=join(w.homePath,'.supabase','telemetry.json');const x=JSON.parse(readFileSync(p,'utf8'));x.session_last_active=x.session_last_active.replace('T',' ');writeFileSync(p,JSON.stringify(x));assert.throws(()=>verifyHermeticMigrationWorkspace(w),{message:'B2_HERMETIC_WORKSPACE_INVALID'});}finally{rmSync(root,{recursive:true,force:true});}});
