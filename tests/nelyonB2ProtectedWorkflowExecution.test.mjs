import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';
import { integratedFixture } from './fixtures/nelyonB2IntegratedFixture.mjs';
import * as release from '../scripts/nelyon-production-release.mjs';
import { createPrivateAuthorityProductionHost, runPrivateAuthorityCli } from '../scripts/nelyon-private-authority-cli.mjs';
import { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime } from '../scripts/nelyon-private-authority-runtime.mjs';
const ROOT=process.cwd(), AT='2026-11-08T12:00:00.000Z';
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=release.canonicalJson;
const childEnvironment={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_DISABLE_COMPILE_CACHE:'1'};
const assertPrivateOutputAbsent=result=>{assert.doesNotMatch((result.stdout??'')+(result.stderr??''),/SYNTHETIC_(PRIVATE|TOKEN)_MARKER/);};

// Break caught: a public proof receipt is not process-portable authorization.
// All controller/helper code is real; only remote R2 and inventory transport is synthetic.
for (const mode of ['gate_proof', 'release']) test(`${mode}: protected execution preserves authority and accepts authenticated workflow outputs`,async t=>{
  const f=integratedFixture(t,{mode});
  const previousSupabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (mode === 'release') process.env.SUPABASE_ACCESS_TOKEN = 'SYNTHETIC_TOKEN_MARKER';
  t.after(() => {
    if (previousSupabaseAccessToken === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = previousSupabaseAccessToken;
  });
  const runner=path.join(f.cwd,'runner');fs.mkdirSync(runner);
  const put=(name,value)=>{const p=path.join(runner,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof value==='string'?value:json(value));return p;};
  const policy=put('policy.json',f.policy),request=put('request.json',f.request);
  const bundle=path.join(runner,'bundle');
  put('bundle/manifest.json',f.manifest);put('bundle/manifest.sha256',hash(json(f.manifest))+'\n');put('bundle/summary.md','synthetic');
  const remoteEvidence=put('remote.json',f.evidence);
  const env={NELYON_PRIVATE_AUTHORITY_PROVIDER:'r2',NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID:'a'.repeat(32),NELYON_PRIVATE_AUTHORITY_R2_BUCKET:'synthetic-bucket',NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID:'synthetic-access',NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY:'SYNTHETIC_PRIVATE_MARKER',NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256:hash(f.descriptorBytes),NELYON_PRIVATE_AUTHORITY_SHA256:hash(f.authorityBytes),NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256:f.manifest.runtime_closure.closure_sha256,NELYON_RELEASE_POLICY_SHA256:hash(json(f.policy)),SUPABASE_ACCESS_TOKEN:'SYNTHETIC_TOKEN_MARKER',RUNNER_TEMP:runner};
  const names=JSON.parse(f.descriptorBytes).contract.functions.map(f=>f.name).filter(n=>n!=='process-scheduled-publications');
  while(names.length<34)names.push('synthetic-unrelated-'+names.length);
  assert.equal(names.length,34);
  let rows=names.map(name=>({name})),inventoryCalls=0, diagnosticCapture=false, healthCalls=0;
  const fetchImpl=async(input,init)=>{
    if(input instanceof Request && new URL(input.url).hostname==='a'.repeat(32)+'.r2.cloudflarestorage.com'){
      assert.ok(['HEAD','GET'].includes(input.method));
      return new Response(input.method==='HEAD'?null:f.authorityBytes,{status:200,headers:{'content-length':String(f.authorityBytes.length),'content-encoding':'identity'}});
    }
    if (diagnosticCapture && input instanceof URL && input.pathname === '/v1/projects/aewwdlvbwpczqyvkwvvj/health') {
      assert.equal(input.origin, 'https://api.supabase.com'); assert.equal(init.method, 'GET'); healthCalls++;
      return new Response(JSON.stringify({ message: 'SYNTHETIC_PRIVATE_MARKER' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(input,'https://api.supabase.com/v1/projects/aewwdlvbwpczqyvkwvvj/functions');assert.equal(init.method,'GET');
    assert.equal(init.headers.authorization,'Bearer SYNTHETIC_TOKEN_MARKER');inventoryCalls++;
    return new Response(JSON.stringify(rows),{status:200});
  };
  const integratedSource=release.verifyB2IntegratedSource(f);
  const publicInputs={descriptorBytes:f.descriptorBytes,manifestBytes:Buffer.from(json(f.manifest)),manifestDigestBytes:Buffer.from(hash(json(f.manifest))+'\n'),policyBytes:Buffer.from(json(f.policy)),requestBytes:Buffer.from(json(f.request))};
  const bootstrapCapability=await bootstrapPrivateAuthorityRuntime({environment:env,manifestClosure:f.manifest.runtime_closure,repositoryRoot:f.cwd,readFile:fs.readFileSync,nodeVersion:'24.21.0'});
  const controllerFor=(environment,at=AT)=>createPrivateAuthorityRuntime({bootstrapCapability,environment,fetchImpl,now:()=>at,integratedSource,host:createPrivateAuthorityProductionHost({publicInputs,environment,fetchImpl,repositoryRoot:f.cwd,integratedSource})});
  const controller=controllerFor(env);
  const invocation=(action,extra={},label=action)=>({action,inputs:{policy,request,bundle,...extra},verificationOutput:path.join(runner,label+'-receipt.json')});
  const proof=invocation('authority-proof');await controller.execute(proof);assert.equal(inventoryCalls,0);
  const expected=JSON.parse(fs.readFileSync(proof.verificationOutput));
  const directOutput=path.join(runner,'direct.json');
  const child=spawnSync(process.execPath,[path.join(f.cwd,'scripts/nelyon-production-release.mjs'),'revalidate','--policy',policy,'--request',request,'--bundle',bundle,'--compiler-sha256',f.manifest.compiler.sha256,'--remote-evidence',remoteEvidence,'--output',directOutput],{cwd:f.cwd,encoding:'utf8',env:childEnvironment});
  assertPrivateOutputAbsent(child);assert.notEqual(child.status,0);assert.match(child.stderr,/B2 protected authority required/);assert.equal(fs.existsSync(directOutput),false);
  const previous=process.cwd();process.chdir(f.cwd);
  try {
    let offlineController;
    if(mode==='release') {
      const offlineEnv={...env};delete offlineEnv.SUPABASE_ACCESS_TOKEN;
      offlineController=controllerFor(offlineEnv);
      const count=inventoryCalls;
      const preflight=invocation('preflight-release',{compilerSha256:f.manifest.compiler.sha256,remoteEvidence,stageOutput:path.join(runner,'preflight.json')});
      await offlineController.execute(preflight);
      assert.equal(JSON.parse(fs.readFileSync(preflight.inputs.stageOutput)).result,'RELEASE_PREFLIGHT_VERIFIED');
      assert.equal(inventoryCalls,count,'preflight must not read Supabase or need its PAT');
    }
    const revalidate=invocation('revalidate',{compilerSha256:f.manifest.compiler.sha256,remoteEvidence,stageOutput:path.join(runner,'revalidated.json')});
    const gate=invocation('verify-gate',{policySha256:hash(json(f.policy)),compilerSha256:f.manifest.compiler.sha256,environmentEvidence:put('environment.json',{id:f.policy.environment.id,name:'production',can_admins_bypass:false,protection_rules:[],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}}),branchPolicies:put('branches.json',{complete:true,pages:[{items:[{name:f.policy.default_branch}]}]}),approvals:put('approvals.json',{complete:true,sourceRunId:f.request.runId,sourceRunAttempt:f.request.runAttempt,pages:[{items:[]}]}),runs:put('runs.json',{complete:true,pages:[{items:[]}]}),autoDeployExpected:'OFF',stageOutput:path.join(runner,'gate.json')});
    if(mode==='release') {
      const count=inventoryCalls;
      const authorize=invocation('authorize-refresh',{...gate.inputs,stageOutput:path.join(runner,'refresh-authorization.json')});
      await offlineController.execute(authorize);
      const permission=JSON.parse(fs.readFileSync(authorize.inputs.stageOutput));
      assert.equal(permission.result,'READ_ONLY_REFRESH_AUTHORIZED');
      assert.equal(permission.supabase_access,'read_only_inventory');
      assert.equal(inventoryCalls,count,'authorization must not read Supabase or need its PAT');
      assert.notEqual(permission.result,'GATE_VERIFIED','read-only authorization must not substitute for deployment gate');
      for (const [label, candidate, stage] of [
        ['unexpected-pat',controller,authorize],
        ['expired-authority',controllerFor(Object.fromEntries(Object.entries(env).filter(([key])=>key!=='SUPABASE_ACCESS_TOKEN')),'2030-01-01T00:00:00.000Z'),authorize],
        ['wrong-policy',offlineController,{...authorize,inputs:{...authorize.inputs,policySha256:'0'.repeat(64)}}],
        ['auto-deploy-enabled',offlineController,{...authorize,inputs:{...authorize.inputs,autoDeployExpected:'ON'}}],
      ]) await t.test('read-only authorization rejects '+label+' before inventory',async()=>{
        const output=path.join(runner,'rejected-'+label+'.json');
        await assert.rejects(candidate.execute({...stage,inputs:{...stage.inputs,stageOutput:output},verificationOutput:path.join(runner,'rejected-'+label+'-receipt.json')}));
        assert.equal(fs.existsSync(output),false);
        assert.equal(inventoryCalls,count);
      });
      const branches=fs.readFileSync(gate.inputs.branchPolicies);
      fs.writeFileSync(gate.inputs.branchPolicies,json({complete:true,pages:[{items:[{name:'unapproved-branch'}]}]}));
      try { await assert.rejects(offlineController.execute({...authorize,inputs:{...authorize.inputs,stageOutput:path.join(runner,'rejected-branch.json')},verificationOutput:path.join(runner,'rejected-branch-receipt.json')})); }
      finally { fs.writeFileSync(gate.inputs.branchPolicies,branches); }
      assert.equal(inventoryCalls,count);

    }
    if(mode==='release')assert.equal(process.env.SUPABASE_ACCESS_TOKEN,'SYNTHETIC_TOKEN_MARKER','launch test with synthetic token, never a real credential');
    await controller.execute(revalidate);
    assert.equal(JSON.parse(fs.readFileSync(revalidate.inputs.stageOutput)).result,'REVALIDATED');
    assert.deepEqual(JSON.parse(fs.readFileSync(revalidate.verificationOutput)),expected);
    await controller.execute(gate);
    assert.equal(JSON.parse(fs.readFileSync(gate.inputs.stageOutput)).result,'GATE_VERIFIED');
    assert.deepEqual(JSON.parse(fs.readFileSync(gate.verificationOutput)),expected);
    const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/nelyon-production-release.yml'),'utf8').replaceAll('\r\n','\n').replace(/^      - &b2_diagnostic_step_[0-9]+\n        name:/gm, '      - name:');
    if (mode === 'release') await t.test('diagnostic YAML capture follows real revalidation and gate and fails closed at fake health read', async () => {
      const resolved = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/nelyon-production-release.yml'), 'utf8'), { maxAliasCount: 1000 });
      const capture = resolved.jobs['snapshot-diagnostic'].steps.find(s => s.id === 'b2_pre_snapshot_authority');
      assert.ok(capture); assert.match(capture.run, /nelyon-private-authority-cli\.mjs pre-snapshot/);
      const command = capture.run.slice(capture.run.indexOf('node scripts/nelyon-private-authority-cli.mjs ') + 'node scripts/nelyon-private-authority-cli.mjs '.length).replace(/\\\n\s*/g, ' ');
      const snapshotOutput = path.join(runner, 'diagnostic-snapshot.json'), verificationOutput = path.join(runner, 'diagnostic-proof.json');
      const replacements = { '$NELYON_POLICY': policy, 'release-artifact/request.json': request, 'release-artifact/bundle': bundle };
      const argv = [...command.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map(m => replacements[m[1] ?? m[2] ?? m[3]] ?? (m[1] ?? m[2] ?? m[3]));
      argv[argv.indexOf('--snapshot-output') + 1] = snapshotOutput;
      argv[argv.indexOf('--verification-output') + 1] = verificationOutput;
      const output = [], sink = { write: value => { output.push(String(value)); return true; } };
      diagnosticCapture = true;
      try { assert.notEqual(await runPrivateAuthorityCli(argv, { execute: parsed => controller.execute(parsed), stdout: sink, stderr: sink }), 0); }
      finally { diagnosticCapture = false; }
      assert.equal(healthCalls, 1, 'real adapter reached the read-only health request after authenticated gate');
      assert.equal(fs.existsSync(snapshotOutput), false); assert.equal(fs.existsSync(verificationOutput), false);
      assert.doesNotMatch(output.join(''), /SYNTHETIC_(PRIVATE|TOKEN)_MARKER/);
      t.diagnostic('Negative capture boundary only; this does not claim a successful complete snapshot end-to-end.');
    });
    if(mode==='release')for(const route of [
      ['initial','Revalidate protected release manifest after authorization','Resolve protected private authority before revalidation'],
      ['migration','Resolve protected private authority before migrations'],
      ['functions','Revalidate protected release before functions','B2 protected functions'],
    ])await t.test('workflow '+route[0]+' executes authenticated revalidation',async()=>{
      const blocks=workflow.split(/(?=^      - name: )/m);
      const block=blocks.find(b=>b.startsWith('      - name: '+route[1]+'\n'))??blocks.find(b=>b.startsWith('      - name: '+route[2]+'\n'));
      assert.ok(block,'required protected stage exists');
      const lines=block.split('\n');
      const start=lines.findIndex(line=>line.includes('node scripts/nelyon-private-authority-cli.mjs '));
      assert.ok(start>=0,'stage executes protected runtime, not a bare helper');
      const command=[lines[start].split('node scripts/nelyon-private-authority-cli.mjs ')[1]];
      for(let i=start;lines[i].trimEnd().endsWith('\\');i++)command.push(lines[i+1]);
      const text=command.join('\n').replace(/\\\n\s*/g,' ').replace(/ \|\|.*$/,'');
      const stageOutput=path.join(runner,'yaml-'+route[0]+'-stage.json');
      const verificationOutput=path.join(runner,'yaml-'+route[0]+'-receipt.json');
      const tokens=[...text.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map(m=>m[1]??m[2]??m[3]);
      const substitutions={'$NELYON_POLICY':policy,'release-artifact/request.json':request,'release-artifact/bundle':bundle,'release-artifact/remote-evidence.json':remoteEvidence,'${{ needs.plan.outputs.compiler_sha256 }}':f.manifest.compiler.sha256};
      const argv=tokens.map(token=>substitutions[token]??token);
      for(const [flag,value]of [['--stage-output',stageOutput],['--verification-output',verificationOutput]]){
        const index=argv.indexOf(flag);if(index>=0)argv[index+1]=value;
      }
      const output=[];const sink={write:chunk=>{output.push(String(chunk));return true;}};
      assert.equal(await runPrivateAuthorityCli(argv,{execute:parsed=>controller.execute(parsed),stdout:sink,stderr:sink}),0,output.join(''));
      assert.doesNotMatch(output.join(''),/SYNTHETIC_(PRIVATE|TOKEN)_MARKER/);
      assert.equal(fs.existsSync(stageOutput),true,'proof alone does not produce REVALIDATED stage evidence');
      assert.equal(JSON.parse(fs.readFileSync(stageOutput)).result,'REVALIDATED');
      assert.deepEqual(JSON.parse(fs.readFileSync(verificationOutput)),expected);
    });
    const comparator=workflow.match(/          const \{ readFileSync \} = require\('node:fs'\);\n          const expected = .*\n          const verification = .*release-gate-verification.json.*\n          if .*\n/)[0].split('\n').map(x=>x.replace(/^          /,'')).join('\n');
    put('nelyon-private-authority-public/expected-receipt.json',expected);put('nelyon-private-authority-public/release-gate-verification.json',JSON.parse(fs.readFileSync(gate.verificationOutput)));
    const runComparator=source=>spawnSync(process.execPath,['--input-type=commonjs','-e',source],{cwd:f.cwd,encoding:'utf8',env:{...childEnvironment,RUNNER_TEMP:runner}});
    await t.test('actual workflow gate comparator accepts authentic receipt',()=>{
      const actual=runComparator(comparator);assertPrivateOutputAbsent(actual);assert.equal(actual.status,0,actual.stderr);
    });
    for(const value of [{...expected,approvalSha256:'0'.repeat(64)}, {}, {receipt:expected}]){
      put('nelyon-private-authority-public/release-gate-verification.json',value);const rejected=runComparator(comparator);assertPrivateOutputAbsent(rejected);assert.notEqual(rejected.status,0);
    }
    for(const variant of ['missing-token','after','incomplete']){
      const environment={...env};if(variant==='missing-token')delete environment.SUPABASE_ACCESS_TOKEN;
      rows=variant==='after'?[...names,'process-scheduled-publications'].map(name=>({name})):variant==='incomplete'?names.slice(1).map(name=>({name})):names.map(name=>({name}));
      for(const source of [revalidate,gate]){
        const label=variant+'-'+source.action;
        const bad=invocation(source.action,{...source.inputs,stageOutput:path.join(runner,label+'.json')},label);
        const callsBefore=inventoryCalls;
        await assert.rejects(controllerFor(environment).execute(bad),{code:'PRIVATE_AUTHORITY_STAGE_BLOCKED'});
        if(variant==='missing-token')assert.equal(inventoryCalls,callsBefore);
        assert.equal(fs.existsSync(bad.inputs.stageOutput),false);assert.equal(fs.existsSync(bad.verificationOutput),false);
      }
    }
    assert.ok(inventoryCalls>=3);
    t.diagnostic('Raw helper remains fail-closed; actual YAML consumers must accept authenticated results.');
    for(const p of [proof.verificationOutput,revalidate.verificationOutput,gate.verificationOutput,revalidate.inputs.stageOutput,gate.inputs.stageOutput])assert.doesNotMatch(fs.readFileSync(p,'utf8'),/SYNTHETIC_(PRIVATE|TOKEN)_MARKER/);
  } finally {process.chdir(previous);}
});
