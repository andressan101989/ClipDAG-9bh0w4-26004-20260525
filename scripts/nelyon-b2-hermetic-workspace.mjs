import {execFileSync} from 'node:child_process';
import {devNull} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync,readdirSync,mkdirSync,mkdtempSync,realpathSync,readlinkSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';

const states=new WeakMap();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw new Error('B2_HERMETIC_WORKSPACE_INVALID');};
const digest=/^[a-f0-9]{64}$/;
function regularBytes(path){
 const stat=lstatSync(path);if(!stat.isFile() || stat.isSymbolicLink())fail();
 return readFileSync(path);
}
const metadataPath='home/.supabase/telemetry.json';
function checkedMetadata(path,state){
 let fd;
 try{
  const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>512)fail();
  fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd);
  if(!opened.isFile()||opened.nlink!==1||opened.size>512||opened.ino!==before.ino||opened.dev!==before.dev)fail();
  const buffer=Buffer.alloc(513),length=readSync(fd,buffer,0,513,0);if(length>512||length!==opened.size)fail();
  const after=lstatSync(path);if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||after.ino!==opened.ino||after.dev!==opened.dev||after.size!==length)fail();
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,length));const value=JSON.parse(text);
  if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||JSON.stringify(value)!==text
   ||Object.keys(value).sort().join(',')!=='device_id,enabled,schema_version,session_id,session_last_active'
   ||value.enabled!==false||value.schema_version!==1||value.device_id!==state.metadata.device_id||value.session_id!==state.metadata.session_id
   ||typeof value.session_last_active!=='string')fail();
  const at=Date.parse(value.session_last_active);
  if(!Number.isFinite(at)||new Date(at).toISOString()!==value.session_last_active||at<state.metadataCreatedAt||at>Date.now())fail();
  return true;
 }finally{if(fd!==undefined)closeSync(fd);}
}
function checkedConfig(bytes){
 // Deliberately accepts only this repository's functions-only config domain.
 // All database settings are CLI defaults; any override requires explicit review.
 const sections=new Set();let inSection=false,seenKey=false;
 for(const line of bytes.toString('utf8').split(/\r?\n/)){
  const text=line.trim();if(!text || text.startsWith('#'))continue;
  const section=text.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/);
  if(section){if(sections.has(section[1]))fail();sections.add(section[1]);inSection=true;seenKey=false;continue;}
  if(!inSection || seenKey || !/^verify_jwt\s*=\s*(true|false)$/.test(text))fail();
  seenKey=true;
 }
}
export function createHermeticMigrationWorkspace({parent,binaryPath,binarySha256,files}){
 try{
  if(!isAbsolute(parent)||!isAbsolute(binaryPath)||!digest.test(binarySha256)||!Array.isArray(files))fail();
  const parentReal=realpathSync(parent);if(!lstatSync(parentReal).isDirectory())fail();
  const binary=regularBytes(binaryPath);if(hash(binary)!==binarySha256)fail();
  const checked=[];const names=new Set();
  for(const item of files){
   if(!item || typeof item.path!=='string' || !(item.path==='supabase/config.toml' || /^supabase\/migrations\/20[0-9]{12}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.test(item.path))
    ||names.has(item.path)||!Buffer.isBuffer(item.bytes)||!digest.test(item.sha256)||hash(item.bytes)!==item.sha256)fail();
   names.add(item.path);checked.push({path:item.path,bytes:Buffer.from(item.bytes),sha256:item.sha256});
  }
  if(!names.has('supabase/config.toml'))fail();
  checkedConfig(checked.find(f=>f.path==='supabase/config.toml').bytes);
  const cwd=mkdtempSync(join(parentReal,'b2-hermetic-'));
  mkdirSync(join(cwd,'supabase','migrations'),{recursive:true});
  mkdirSync(join(cwd,'tool'));
  mkdirSync(join(cwd,'home'),{mode:0o700});
  mkdirSync(join(cwd,'home','.supabase'),{mode:0o700});
  const metadataCreatedAt=Date.now();
  const metadata={enabled:false,device_id:randomUUID(),session_id:randomUUID(),session_last_active:new Date(metadataCreatedAt).toISOString(),schema_version:1};
  writeFileSync(join(cwd,metadataPath),JSON.stringify(metadata),{flag:'wx',mode:0o600});
  const executable=join(cwd,'tool',process.platform==='win32'?'supabase.exe':'supabase');
  writeFileSync(executable,binary,{flag:'wx',mode:0o500});
  for(const item of checked){const path=join(cwd,item.path);writeFileSync(path,item.bytes,{flag:'wx',mode:0o400});}
  const result=Object.freeze({cwd,binaryPath:executable,binarySha256,homePath:join(cwd,'home')});
  const expected=new Map(checked.map(f=>[f.path,f.sha256]));expected.set(`tool/${process.platform==='win32'?'supabase.exe':'supabase'}`,binarySha256);
  states.set(result,{cwd,expected,metadata,metadataCreatedAt});verifyHermeticMigrationWorkspace(result);return result;
 }catch{fail();}
}
export function verifyHermeticMigrationWorkspace(workspace){
 try{
  const state=states.get(workspace);if(!state || realpathSync(state.cwd)!==state.cwd)fail();
  for(const directory of ['supabase','supabase/migrations','tool','home','home/.supabase']){
    const stat=lstatSync(join(state.cwd,directory));if(!stat.isDirectory()||stat.isSymbolicLink())fail();
  }
  const actual=new Map();
  const walk=(root,prefix='')=>{
   for(const name of readdirSync(root)){
    const relative=prefix+name;const path=join(root,name);const stat=lstatSync(path);
    if(stat.isSymbolicLink())fail();
    if(stat.isDirectory()){
     if(!['supabase','supabase/migrations','tool','home','home/.supabase'].includes(relative))fail();walk(path,relative+'/');
    }else if(stat.isFile()){if(relative===metadataPath){checkedMetadata(path,state);actual.set(relative,'metadata');}else actual.set(relative,hash(regularBytes(path)));}else fail();
   }
  };
  walk(state.cwd);
  if(actual.size!==state.expected.size+1||actual.get(metadataPath)!=='metadata')fail();
  for(const [path,digest] of state.expected)if(actual.get(path)!==digest)fail();
  return true;
 }catch{fail();}
}

export function verifyHermeticMigrationManifest(workspace,manifest) {
  verifyHermeticMigrationWorkspace(workspace);
  const state=states.get(workspace),migrations=manifest?.resources?.migrations;
  if(!Array.isArray(migrations))fail();
  const versions=new Set();
  for(const item of migrations){
    const match=typeof item?.path==='string'&&item.path.match(/^supabase\/migrations\/(20[0-9]{12})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/);
    if(!match||item.version!==match[1]||versions.has(item.version)||!digest.test(item.sha256)
      ||state.expected.get(item.path)!==item.sha256)fail();
    versions.add(item.version);
  }
  return true;
}


// Authenticate the COMPLETE config+migration inventory against a concrete local
// Git commit. No caller-supplied success flag, replacement objects or lazy fetch.
export function verifyHermeticGitSource(workspace,{repositoryRoot,approvedSha}) {
 try{
  verifyHermeticMigrationWorkspace(workspace);
  if(!isAbsolute(repositoryRoot)||typeof approvedSha!=='string'||!/^[a-f0-9]{40}$/.test(approvedSha))fail();
  const environment={GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':devNull,GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'};
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT'])if(typeof process.env[key]==='string')environment[key]=process.env[key];
  const git=args=>execFileSync('git',['--no-replace-objects','--literal-pathspecs','-c','core.fsmonitor=false',...args],{
    cwd:repositoryRoot,env:environment,shell:false,windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  if(git(['rev-parse','--verify',`${approvedSha}^{commit}`]).trim()!==approvedSha)fail();
  const entries=git(['ls-tree','-r','-z','--full-tree',approvedSha,'--','supabase/config.toml','supabase/migrations']).split('\0').filter(Boolean);
  const expected=states.get(workspace).expected;const sourceFiles=new Map();
  for(const entry of entries){
    const match=entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
    if(!match||sourceFiles.has(match[3])||!expected.has(match[3]))fail();
    const bytes=regularBytes(join(workspace.cwd,match[3]));
    const oid=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    if(oid!==match[2])fail();sourceFiles.set(match[3],oid);
  }
  const wanted=[...expected.keys()].filter(path=>path.startsWith('supabase/'));
  if(sourceFiles.size!==wanted.length||wanted.some(path=>!sourceFiles.has(path)))fail();
  verifyHermeticMigrationWorkspace(workspace);return true;
 }catch{fail();}
}




export function readApprovedMigrationFiles({repositoryRoot,approvedSha}) {
 try {
  if(!isAbsolute(repositoryRoot)||typeof approvedSha!=='string'||!/^[a-f0-9]{40}$/.test(approvedSha))fail();
  const env={GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':devNull,GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'};
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT'])if(typeof process.env[key]==='string')env[key]=process.env[key];
  const git=args=>execFileSync('git',['--no-replace-objects','--literal-pathspecs','-c','core.fsmonitor=false',...args],{cwd:repositoryRoot,env,shell:false,windowsHide:true,timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  if(git(['rev-parse','--verify',`${approvedSha}^{commit}`]).toString('utf8').trim()!==approvedSha)fail();
  const entries=git(['ls-tree','-r','-z','--full-tree',approvedSha,'--','supabase/config.toml','supabase/migrations']).toString('utf8').split('\0').filter(Boolean);
  const files=[],paths=new Set();
  for(const entry of entries){
   const match=entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
   if(!match)fail();const path=match[3];
   if(paths.has(path)||!(path==='supabase/config.toml'||/^supabase\/migrations\/20[0-9]{12}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.test(path)))fail();
   const bytes=git(['cat-file','blob',match[2]]);
   if(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')!==match[2])fail();
   paths.add(path);files.push({path,bytes,sha256:hash(bytes)});
  }
  if(!paths.has('supabase/config.toml'))fail();checkedConfig(files.find(f=>f.path==='supabase/config.toml').bytes);
  return files;
 }catch{fail();}
}

// setup-cli's npm .bin entry is a locator only. Never execute/copy its JS shim.
export function resolveInstalledLinuxCliBinary({shimPath,binarySha256}){
 try{
  if(typeof shimPath!=='string'||!isAbsolute(shimPath)||!digest.test(binarySha256))fail();
  const shim=resolve(shimPath),npmRoot=dirname(dirname(shim));
  if(shim!==join(npmRoot,'.bin','supabase')||realpathSync(npmRoot)!==npmRoot)fail();
  for(const part of ['.bin','supabase','supabase/dist','@supabase','@supabase/cli-linux-x64','@supabase/cli-linux-x64/bin']){
   const p=join(npmRoot,part),stat=lstatSync(p);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(p)!==p)fail();
  }
  if(!lstatSync(shim).isSymbolicLink()||resolve(dirname(shim),readlinkSync(shim))!==join(npmRoot,'supabase','dist','supabase.js'))fail();
  const shimTarget=join(npmRoot,'supabase','dist','supabase.js');if(lstatSync(shimTarget).size>1024*1024)fail();regularBytes(shimTarget);
  for(const [relative,name]of [['supabase','supabase'],['@supabase/cli-linux-x64','@supabase/cli-linux-x64']]){
   const p=join(npmRoot,relative,'package.json');if(lstatSync(p).size>65536)fail();const pkg=JSON.parse(regularBytes(p).toString('utf8'));
   if(pkg.name!==name||pkg.version!=='2.120.0')fail();
  }
  const binary=join(npmRoot,'@supabase','cli-linux-x64','bin','supabase');const bytes=regularBytes(binary);
  if(bytes.length<64||hash(bytes)!==binarySha256||!bytes.subarray(0,7).equals(Buffer.from([127,69,76,70,2,1,1]))
   ||![2,3].includes(bytes.readUInt16LE(16))||bytes.readUInt16LE(18)!==62)fail();
  if(realpathSync(binary)!==binary)fail();return binary;
 }catch{fail();}
}
