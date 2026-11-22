import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as release from '../scripts/nelyon-production-release.mjs';
import * as parity from '../scripts/nelyon-b2-source-parity.mjs';
import { createReleaseAuthorityContext } from '../scripts/nelyon-release-authority-context.mjs';
import { createPrivateAuthorityProductionHost } from '../scripts/nelyon-private-authority-cli.mjs';
import { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime } from '../scripts/nelyon-private-authority-runtime.mjs';
import { integratedFixture as fixture } from './fixtures/nelyonB2IntegratedFixture.mjs';

const AT='2026-11-08T12:00:00.000Z';
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=release.canonicalJson;

test('integrated Git source proves authority, database preflight and post parity without equating reviewed and final SHA',async t=>{
  const f=fixture(t);
  assert.notEqual(f.request.approvedSha,JSON.parse(f.descriptorBytes).contract.reviewed_source_sha);
  const integratedSource=release.verifyB2IntegratedSource(f);
  const d=JSON.parse(f.descriptorBytes),c=d.contract;
  const ctx=createReleaseAuthorityContext({descriptorBytes:f.descriptorBytes,expectedDescriptorSha256:hash(f.descriptorBytes),phase:c.to_phase,transitionId:c.id,baselineSha:c.baseline_sha,reviewedSourceSha:c.reviewed_source_sha,integrationBaseSha:c.integration_base_sha,requestedAt:AT,authorityJson:f.authorityBytes.toString(),expectedPrivateAuthoritySha256:hash(f.authorityBytes)});
  const migration=c.productive_changes.at(-1),migrationBytes=fs.readFileSync(path.join(f.cwd,migration.path));
  assert.equal(parity.verifyB2DatabaseSourcePreflight({authorityContext:ctx,manifest:f.manifest,descriptorBytes:f.descriptorBytes,migrationBytes,integratedSource}),true);
  const filePaths=new Set([migration.path,...f.contracts.flatMap(x=>x.source_files.map(f=>f.path))]);
  const reviewedTree=parity.createTrustedB2ReviewedTree({approvedSha:f.request.approvedSha,files:[...filePaths].map(p=>({path:p,bytes:fs.readFileSync(path.join(f.cwd,p))})),functionConfigs:c.functions.map(x=>({name:x.name,config:f.configAfter[x.name]}))});
  const deployedFunctionInventory=parity.createTrustedB2DeployedFunctionInventory({capturedAt:AT,functions:c.functions.map(x=>({name:x.name,deployedSha256:'a'.repeat(64)}))});
  assert.equal(parity.compileB2SourceParity({authorityContext:ctx,manifest:f.manifest,descriptorBytes:f.descriptorBytes,reviewedTree,deployedFunctionInventory,capturedAt:AT,integratedSource}).databaseFunctions.length,31);
  const env={NELYON_PRIVATE_AUTHORITY_PROVIDER:'r2',NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID:'a'.repeat(32),NELYON_PRIVATE_AUTHORITY_R2_BUCKET:'synthetic-bucket',NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID:'synthetic',NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY:'synthetic',NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256:hash(f.descriptorBytes),NELYON_PRIVATE_AUTHORITY_SHA256:hash(f.authorityBytes),NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256:f.manifest.runtime_closure.closure_sha256,NELYON_RELEASE_POLICY_SHA256:hash(json(f.policy)),RUNNER_TEMP:f.cwd};
  const bootstrapCapability=await bootstrapPrivateAuthorityRuntime({environment:env,manifestClosure:f.manifest.runtime_closure,repositoryRoot:f.cwd,readFile:fs.readFileSync,nodeVersion:'24.21.0'});
  const manifestBytes=Buffer.from(json(f.manifest));const publicInputs={descriptorBytes:f.descriptorBytes,manifestBytes,manifestDigestBytes:Buffer.from(hash(manifestBytes)+'\n'),policyBytes:Buffer.from(json(f.policy)),requestBytes:Buffer.from(json(f.request))};
  let calls=0;const fetchImpl=async req=>{calls++;return new Response(req.method==='HEAD'?null:f.authorityBytes,{status:200,headers:{'content-length':String(f.authorityBytes.length),'content-encoding':'identity'}});};
  const host=createPrivateAuthorityProductionHost({publicInputs,environment:env,fetchImpl,repositoryRoot:f.cwd,integratedSource});
  for (const capability of [undefined, Object.freeze({}), structuredClone(integratedSource)]) {
    const blocked=createPrivateAuthorityRuntime({bootstrapCapability,environment:env,fetchImpl,now:()=>AT,host,
      ...(capability === undefined ? {} : { integratedSource:capability })});
    await assert.rejects(blocked.execute({action:'authority-proof',inputs:{policy:'policy.json',request:'request.json',bundle:'bundle'},
      verificationOutput:path.join(f.cwd,'blocked.json')}), {code:'RELEASE_AUTHORITY_CONTEXT_INVALID'});
    assert.equal(calls,0,'unproven integration must not contact the authority provider');
  }
  const runtime=createPrivateAuthorityRuntime({bootstrapCapability,environment:env,fetchImpl,now:()=>AT,host,integratedSource});
  assert.equal((await runtime.execute({action:'authority-proof',inputs:{policy:'policy.json',request:'request.json',bundle:'bundle'},verificationOutput:path.join(f.cwd,'verified.json')})).result,'VERIFIED');assert.equal(calls,2);

  await t.test('capability is bound to the exact manifest, descriptor and request',()=>{
    const altered=structuredClone(f.manifest);altered.identity.release_id='different';
    for(const input of [{manifest:altered,descriptorBytes:f.descriptorBytes},
      {manifest:f.manifest,descriptorBytes:Buffer.concat([f.descriptorBytes,Buffer.from(' ')])},
      {manifest:f.manifest,descriptorBytes:f.descriptorBytes,request:{...f.request,runAttempt:2}}]){
      assert.throws(()=>release.assertB2IntegratedSource(integratedSource,input),{code:'B2_DESCRIPTOR_INVALID'});
    }
    assert.throws(()=>parity.verifyB2DatabaseSourcePreflight({authorityContext:ctx,manifest:altered,descriptorBytes:f.descriptorBytes,migrationBytes,integratedSource}));
    assert.throws(()=>parity.compileB2SourceParity({authorityContext:ctx,manifest:altered,descriptorBytes:f.descriptorBytes,reviewedTree,deployedFunctionInventory,capturedAt:AT,integratedSource}));
    const accessor=structuredClone(f.manifest);Object.defineProperty(accessor,'identity',{enumerable:true,get(){throw new Error('must not run');}});
    assert.throws(()=>release.assertB2IntegratedSource(integratedSource,{manifest:accessor,descriptorBytes:f.descriptorBytes}),{code:'B2_DESCRIPTOR_INVALID'});
  });
  await t.test('real Git HEAD and independently recompiled manifest cannot be asserted by a candidate',()=>{
    const altered=structuredClone(f.manifest);altered.resources.function_contracts[0].source_sha256='0'.repeat(64);
    assert.throws(()=>release.verifyB2IntegratedSource({...f,manifest:altered}),{code:'B2_DESCRIPTOR_INVALID'});
    assert.throws(()=>release.verifyB2IntegratedSource({...f,request:{...f.request,approvedSha:c.reviewed_source_sha}}),{code:'B2_DESCRIPTOR_INVALID'});
    for (const mutate of [m=>m.delta.files.pop(),m=>m.delta.productive_change_count--,
      m=>m.resources.functions.pop(),m=>m.resources.config_changed=false]) {
      const candidate=structuredClone(f.manifest);mutate(candidate);
      assert.throws(()=>release.verifyB2IntegratedSource({...f,manifest:candidate}),{code:'B2_DESCRIPTOR_INVALID'});
    }
  });
  await t.test('working-tree and staged productive/config drift are rejected',()=>{
    for(const file of [migration.path,'supabase/config.toml']){
      const original=fs.readFileSync(path.join(f.cwd,file));
      try {f.write(file,Buffer.concat([original,Buffer.from('\n-- synthetic drift\n')]));f.git(['add','--',file]);
        assert.throws(()=>release.verifyB2IntegratedSource(f),{code:'B2_DESCRIPTOR_INVALID'});
      } finally {f.write(file,original);f.git(['add','--',file]);}
    }
  });
  await t.test('unrelated reviewed ancestry and extra productive committed delta are rejected',()=>{
    const originalHead=f.request.approvedSha;
    function commitCandidate(descriptorBytes=f.descriptorBytes){
      f.write('.github/nelyon-web-control-centers-b2-release-descriptor.json',descriptorBytes);f.git(['add','.']);f.git(['commit','--quiet','-m','synthetic invalid candidate']);
      const approvedSha=f.git(['rev-parse','HEAD']).toString().trim();f.git(['update-ref','refs/remotes/origin/main',approvedSha]);
      const manifest=structuredClone(f.manifest);manifest.identity.approved_sha=approvedSha;manifest.baseline.origin_main_sha=approvedSha;
      const descriptor=JSON.parse(descriptorBytes);manifest.resources.web_control_centers_b2_transition.contract=descriptor.contract;
      manifest.resources.web_control_centers_b2_transition.descriptorSha256=hash(descriptorBytes);
      manifest.resources.web_control_centers_b2_transition.publicContractSha256=descriptor.public_contract_sha256;
      return {...f,descriptorBytes,manifest,request:{...f.request,approvedSha,mainSha:approvedSha}};
    }
    try {
      const orphan=f.git(['commit-tree',f.git(['rev-parse','HEAD^{tree}']).toString().trim(),'-m','unrelated synthetic tree']).toString().trim();
      const descriptor=JSON.parse(f.descriptorBytes);descriptor.contract.reviewed_source_sha=orphan;descriptor.public_contract_sha256=hash(json(descriptor.contract));
      assert.throws(()=>release.verifyB2IntegratedSource(commitCandidate(Buffer.from(JSON.stringify(descriptor)+'\n'))),{code:'B2_DESCRIPTOR_INVALID'});
    } finally {f.git(['reset','--hard',originalHead]);f.git(['update-ref','refs/remotes/origin/main',originalHead]);}
    try {
      f.write('supabase/migrations/20261108061947_synthetic_unapproved.sql','select 1;\n');
      assert.throws(()=>release.verifyB2IntegratedSource(commitCandidate()),{code:'B2_DESCRIPTOR_INVALID'});
    } finally {f.git(['reset','--hard',originalHead]);f.git(['update-ref','refs/remotes/origin/main',originalHead]);}
  });
});

test('optional integrated source inspection rejects proxies without executing traps',()=>{
  let calls=0;
  const input=new Proxy({}, {getOwnPropertyDescriptor(){calls++;throw new Error('must not execute');}});
  assert.throws(()=>parity.verifyB2DatabaseSourcePreflight(input));
  assert.throws(()=>parity.compileB2SourceParity(input));
  assert.equal(calls,0);
});
