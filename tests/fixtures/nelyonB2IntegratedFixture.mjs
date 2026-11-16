import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as release from '../../scripts/nelyon-production-release.mjs';
import { privateRuntimeClosureMemberPaths } from '../../scripts/nelyon-private-runtime-closure.mjs';
import { b2DatabaseFunctionMatrix, b2SyntheticRelationAclRecords } from './nelyonB2DatabaseFunctionMatrix.mjs';
const ROOT=process.cwd(), AT='2026-11-08T12:00:00.000Z';
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=release.canonicalJson;
const sourceGit=args=>execFileSync('git',args,{cwd:ROOT,stdio:'pipe',maxBuffer:32*1024*1024});

export function integratedFixture(t, { mode = 'plan_only' } = {}) {
  const tempRoot=fs.realpathSync(tmpdir());
  assert.ok(fs.statSync(tempRoot).isDirectory());
  const cwd=fs.mkdtempSync(path.join(tempRoot,'b2-integrated-git-'));
  t.after(()=>{ assert.equal(fs.realpathSync(cwd),cwd); const relative=path.relative(tempRoot,cwd);
    assert.ok(relative.startsWith('b2-integrated-git-')&&!relative.includes(path.sep));
    fs.rmSync(cwd,{recursive:true,force:false});assert.equal(fs.existsSync(cwd),false); });
  const git=args=>execFileSync('git',['-c','core.autocrlf=false','-c','core.hooksPath=NUL',...args],{cwd,stdio:'pipe',maxBuffer:32*1024*1024,
    env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'}});
  const write=(p,b)=>{fs.mkdirSync(path.dirname(path.join(cwd,p)),{recursive:true});fs.writeFileSync(path.join(cwd,p),b);};
  git(['init','--quiet']);git(['remote','add','origin','https://github.com/andressan101989/ClipDAG-9bh0w4-26004-20260525.git']);
  const d=JSON.parse(fs.readFileSync('.github/nelyon-web-control-centers-b2-release-descriptor.json'));
  const originalBaseline=d.contract.baseline_sha;
  const files={};
  for(const p of sourceGit(['ls-tree','-r','--name-only','HEAD','--','supabase/functions']).toString().trim().split('\n')){
    if(p.startsWith('supabase/functions/process-scheduled-publications/'))continue;
    const b=sourceGit(['show','HEAD:'+p]);files[p]=b.toString();write(p,b);
  }
  for(const p of privateRuntimeClosureMemberPaths())write(p,Buffer.from(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
  for(const p of d.contract.productive_changes.slice(0,2))write(p.path,sourceGit(['show',originalBaseline+':'+p.path]));
  git(['add','.']);git(['commit','--quiet','-m','synthetic baseline']);const baseline=git(['rev-parse','HEAD']).toString().trim();
  for(const p of d.contract.productive_changes){const b=sourceGit(['show','HEAD:'+p.path]);write(p.path,b);if(p.path.includes('/functions/'))files[p.path]=b.toString();}
  git(['add','.']);git(['commit','--quiet','-m','synthetic reviewed source']);const reviewed=git(['rev-parse','HEAD']).toString().trim();
  const c=d.contract;c.state='approved';c.release_ready=true;c.baseline_sha=baseline;c.integration_base_sha=baseline;c.reviewed_source_sha=reviewed;c.function_inventory={before:34,after:35};
  const configAfter=release.parseFunctionConfig(fs.readFileSync(path.join(cwd,'supabase/config.toml'),'utf8'));
  const configBefore=release.parseFunctionConfig(git(['show',baseline+':supabase/config.toml']).toString());
  const contracts=release.buildFunctionContracts({affectedFunctions:c.functions.map(f=>f.name),graph:release.buildFunctionGraph(files),configBefore,configAfter,changes:c.productive_changes});
  for(const f of c.functions){f.source_sha256=contracts.find(x=>x.name===f.name).source_sha256;f.config_sha256=hash(json(configAfter[f.name]));}
  d.public_contract_sha256=hash(json(c));
  const matrix=b2DatabaseFunctionMatrix();const relations=['publication_schedule_attempts','publication_schedule_commands','publication_schedule_materializations','publication_schedule_policy','publication_schedules'].map(n=>{
    const p={identity:'private.'+n,definitionSha256:hash(n),owner:'postgres',rls:true,forceRls:true};const expectedCanonicalJson=json(p).trimEnd();return {kind:'relation',identity:p.identity,expectedCanonicalJson,expectedSha256:hash(expectedCanonicalJson)};
  });
  const records=[...matrix.records,...relations,...b2SyntheticRelationAclRecords(relations)].sort((a,b)=>`${a.kind}\0${a.identity}`<`${b.kind}\0${b.identity}`?-1:1);
  const authority={schemaVersion:1,authorityId:d.private_authority.authority_id,publicContractSha256:d.public_contract_sha256,phase:c.to_phase,issuedFor:{baselineSha:baseline,reviewedSourceSha:reviewed,integrationBaseSha:baseline},successorCatalog:{schemaVersion:1,records},securityAdvisor:{schemaVersion:2,baselineSha256:hash('[]\n'),baselineItems:[],records:[]},backup:{schemaVersion:2,provider:'supabase',kind:'physical',projectRefSha256:'1'.repeat(64),evidenceSha256:'2'.repeat(64),status:'COMPLETED',insertedAt:'2026-11-08T10:00:00.000Z',completedObservedAt:'2026-11-08T10:30:00.000Z',expiresAt:'2026-11-09T10:00:00.000Z'},approval:{schemaVersion:1,decision:'APPROVED',scope:[c.to_phase],authorizationSha256:'3'.repeat(64),approvedAt:'2026-11-08T11:00:00.000Z',expiresAt:'2026-11-09T11:00:00.000Z'}};
  const authorityBytes=Buffer.from(JSON.stringify(authority));d.private_authority.sha256=hash(authorityBytes);const descriptorBytes=Buffer.from(JSON.stringify(d)+'\n');write('.github/nelyon-web-control-centers-b2-release-descriptor.json',descriptorBytes);
  git(['add','.']);git(['commit','--quiet','-m','synthetic integrated descriptor']);const approved=git(['rev-parse','HEAD']).toString().trim();git(['update-ref','refs/remotes/origin/main',approved]);
  const policy=JSON.parse(fs.readFileSync('.github/nelyon-production-release-policy.json'));policy.baseline.sha=baseline;
  const request={actor:policy.owner,triggeringActor:policy.owner,repository:policy.repository,workflowRef:`${policy.repository}/${policy.workflow_path}@refs/heads/main`,ref:'refs/heads/main',approvedSha:approved,mainSha:approved,runId:'123456789',runAttempt:1,releaseId:'synthetic-integrated',mode,scopeConfirmation:policy.scope_confirmations[mode === 'release' ? 'release_high_risk' : mode]};
  const evidence=release.compileLocalEvidence({cwd,policy,request,generatedAt:AT});
  const manifest=release.buildManifest({...evidence,policy,request});
  return {cwd,git,write,descriptorBytes,request,manifest,policy,authorityBytes,contracts,configAfter,matrix,evidence};
}
