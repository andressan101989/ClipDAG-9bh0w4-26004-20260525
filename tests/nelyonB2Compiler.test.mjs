import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';
import { b2SyntheticRelationAclRecords } from './fixtures/nelyonB2DatabaseFunctionMatrix.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';
import * as gate from '../scripts/nelyon-production-release.mjs';
import { createReleaseAuthorityContext } from '../scripts/nelyon-release-authority-context.mjs';

const root = new URL('../', import.meta.url);
const MARKER = 'SYNTHETIC_COMPILER_PRIVATE_MARKER';
const AT = '2026-11-08T12:00:00.000Z';
// Candidate negative tests use the immutable historical public fixture.
const historicalCandidateBytes = readFileSync(new URL('./fixtures/nelyonB2CandidateDescriptor.json', import.meta.url));
const currentCandidateBytes = readFileSync(new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url));
const hash = gate.sha256Hex;
function fixture(at = AT, backupLifetimeHours = 22, approvalLifetimeHours = 23) {
  const descriptor = JSON.parse(currentCandidateBytes);
  const c = descriptor.contract;
  const policy = JSON.parse(readFileSync(new URL('.github/nelyon-production-release-policy.json', root)));
  const sources = {};
  function walk(path) {
    for (const entry of readdirSync(new URL(path, root), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx|js|mjs|json)$/.test(child)) sources[child] = readFileSync(new URL(child, root), 'utf8').replace(/\r\n/g, '\n');
    }
  }
  walk('supabase/functions');
  const graph = gate.buildFunctionGraph(sources);
  const configAfter = gate.parseFunctionConfig(readFileSync(new URL('supabase/config.toml', root), 'utf8'));
  const configBefore = structuredClone(configAfter); delete configBefore['process-scheduled-publications'];
  const changes = c.productive_changes.map(({ path, status }) => ({ path, status, fileType: 'file' }));
  const affectedFunctions = c.functions.map(f => f.name);
  const contracts = gate.buildFunctionContracts({ affectedFunctions, graph, configBefore, configAfter, changes });
  c.state = 'approved'; c.release_ready = true; c.cron_activation = true;
  c.reviewed_source_sha = 'a'.repeat(40); c.integration_base_sha = 'b'.repeat(40);
  c.function_inventory = { before: 34, after: 35 };
  for (const f of c.functions) {
    f.source_sha256 = contracts.find(item => item.name === f.name).source_sha256;
    f.config_sha256 = hash(gate.canonicalJson(configAfter[f.name]));
  }
  descriptor.public_contract_sha256 = hash(gate.canonicalJson(c));
  const expectedCanonicalJson = JSON.stringify({ definitionSha256: '1'.repeat(64), forceRls: true,
    identity: 'private.synthetic', owner: MARKER, rls: true });
  const authority = { schemaVersion: 1, authorityId: descriptor.private_authority.authority_id,
    publicContractSha256: descriptor.public_contract_sha256, phase: c.to_phase,
    issuedFor: { baselineSha: c.baseline_sha, reviewedSourceSha: c.reviewed_source_sha, integrationBaseSha: c.integration_base_sha },
    successorCatalog: { schemaVersion: 1, records: [{ kind: 'relation', identity: 'private.synthetic', expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: hash('[]\n'), baselineItems: [], records: [] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: '3'.repeat(64), evidenceSha256: '4'.repeat(64), status: 'COMPLETED', insertedAt: new Date(Date.parse(at) - 7200000).toISOString(), completedObservedAt: new Date(Date.parse(at) - 5400000).toISOString(), expiresAt: new Date(Date.parse(at) + backupLifetimeHours * 3600000).toISOString() },
    vaultEdgeParity: syntheticVaultEdgeParity(new Date(Date.parse(at) - 3_600_000).toISOString()),
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: [c.to_phase], authorizationSha256: '5'.repeat(64), approvedAt: new Date(Date.parse(at) - 3600000).toISOString(), expiresAt: new Date(Date.parse(at) + approvalLifetimeHours * 3600000).toISOString() } };
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  const authorityJson = JSON.stringify(authority);
  descriptor.private_authority.sha256 = hash(authorityJson);
  const descriptorBytes = JSON.stringify(descriptor);
  const expectedDescriptorSha256 = hash(descriptorBytes);
  const gitState = { baselineSha: c.baseline_sha, approvedSha: c.reviewed_source_sha, originMainSha: c.reviewed_source_sha, changes };
  const runtimeClosure = buildPrivateRuntimeClosure({ repositoryRoot: fileURLToPath(root), readFile: readFileSync });
  const input = { descriptorBytes, expectedDescriptorSha256, graph, configBefore, configAfter, changes, gitState, policy,
    runtimeClosure,
    ancestry: { baseline: true, reviewedSource: true, integrationBase: true },
    productiveFiles: changes.map(({ path, status }) => ({ path, status, type: 'file', bytes: Buffer.from(readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n')) })) };
  const context = () => createReleaseAuthorityContext({ descriptorBytes, expectedDescriptorSha256,
    phase: c.to_phase, transitionId: c.id, baselineSha: c.baseline_sha,
    reviewedSourceSha: c.reviewed_source_sha, integrationBaseSha: c.integration_base_sha,
    requestedAt: at, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) });
  const inventory = { schemaVersion: 1, complete: true, capturedAt: AT,
    names: [...affectedFunctions.filter(name => name !== 'process-scheduled-publications'), ...Array.from({ length: 27 }, (_, i) => `other-${i}`)].sort() };
  const request = { actor: policy.owner, triggeringActor: policy.owner, repository: policy.repository,
    workflowRef: `${policy.repository}/${policy.workflow_path}@refs/heads/main`, ref: 'refs/heads/main',
    approvedSha: gitState.approvedSha, mainSha: gitState.approvedSha, releaseId: 'nelyon-20261108-005',
    mode: 'plan_only', scopeConfirmation: 'PLAN_ONLY', runId: '123456789', runAttempt: 1 };
  const manifestInput = evidence => ({ ...evidence, request, policy, gitState,
    classified: gate.classifyChangedPaths(changes), affectedFunctions, functionContracts: contracts,
    migrations: [Object.fromEntries(Object.entries(c.productive_changes.at(-1)).filter(([key]) => key !== 'status'))].map(m => ({ ...m, version: '20261108061946' })),
    risk: { level: 'HIGH', findings: [] }, reproducibility: { findings: [] },
    runtimeClosure,
    compiler: { path: 'scripts/nelyon-production-release.mjs',
      sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-release.mjs').sha256,
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-snapshot-adapter.mjs').sha256 }, generatedAt: AT });
  return { input, descriptor, contracts, context, inventory, manifestInput };
}
const compile = input => {
  assert.equal(typeof gate.compileB2PublicEvidence, 'function', 'public-only B2 compiler boundary exists');
  return gate.compileB2PublicEvidence(input);
};

test('B2 compiler public plan binds exact descriptor without private input or fabricated receipt', () => {
  const f = fixture();
  let privateReads = 0;
  Object.defineProperty(f.input, 'authorityJson', { get() { privateReads++; throw new Error(MARKER); } });
  const evidence = compile(f.input);
  assert.equal(privateReads, 0);
  const manifest = gate.buildManifest(f.manifestInput(evidence));
  const binding = manifest.resources.web_control_centers_b2_transition;
  assert.equal(binding.descriptorSha256, hash(f.input.descriptorBytes));
  assert.equal(binding.publicContractSha256, f.descriptor.public_contract_sha256);
  assert.equal(binding.expectedPrivateAuthoritySha256, f.descriptor.private_authority.sha256);
  assert.equal(binding.privateAuthorityRequired, true);
  assert.equal(Object.hasOwn(binding, 'receipt'), false);
  assert.equal(JSON.stringify(manifest).includes('"verified":true'), false);
  assert.equal(manifest.delta.productive_change_count, 5);
  assert.deepEqual(manifest.resources.function_contracts, f.contracts);
  assert.equal(manifest.result, 'PLAN READY');
  assert.deepEqual(manifest.runtime_closure, f.input.runtimeClosure);
  const lowRisk = f.manifestInput(evidence); lowRisk.risk = { level: 'STANDARD', findings: [] };
  assert.throws(() => gate.buildManifest(lowRisk), { code: 'B2_DESCRIPTOR_INVALID' });
  for (const output of [evidence, manifest]) assert.doesNotMatch(JSON.stringify(output), new RegExp(`${MARKER}|successorCatalog|expectedCanonicalJson|accountId|accessKeyId|secretAccessKey`));
  const outputDirectory = mkdtempSync(join(tmpdir(), 'b2-compiler-'));
  gate.writeManifestBundle({ manifest, outputDirectory });
  for (const path of readdirSync(outputDirectory)) assert.doesNotMatch(readFileSync(join(outputDirectory, path), 'utf8'), new RegExp(MARKER));
});

test('B2 compiler blocks candidate, wrong paths, full transitive source/config drift and missing ancestry', () => {
  for (const mutate of [
    f => { f.input.descriptorBytes = historicalCandidateBytes; f.input.expectedDescriptorSha256 = hash(historicalCandidateBytes); },
    f => { f.input.expectedDescriptorSha256 = '0'.repeat(64); },
    f => { f.input.changes.pop(); },
    f => { f.input.productiveFiles[0].bytes = Buffer.from('changed'); },
    f => { f.input.graph.nodes['supabase/functions/ai-handoff/index.ts'].sourceSha256 = '0'.repeat(64); },
    f => { f.input.configAfter['ai-handoff'].entrypoint = 'other.ts'; },
    f => { f.input.configAfter['ai-handoff'].verify_jwt = true; },
    f => {
      f.input.configAfter['ai-handoff'].enabled = false;
      const descriptor = JSON.parse(f.input.descriptorBytes);
      descriptor.contract.functions[0].config_sha256 = hash(gate.canonicalJson(f.input.configAfter['ai-handoff']));
      descriptor.public_contract_sha256 = hash(gate.canonicalJson(descriptor.contract));
      f.input.descriptorBytes = JSON.stringify(descriptor);
      f.input.expectedDescriptorSha256 = hash(f.input.descriptorBytes);
    },
    f => { f.input.ancestry.reviewedSource = false; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => compile(f.input), { code: 'B2_DESCRIPTOR_INVALID' });
  }
});

test('B2 protected proof requires minted context exact binding and fresh pre inventory', () => {
  const f = fixture(); const manifest = gate.buildManifest(f.manifestInput(compile(f.input)));
  assert.equal(typeof gate.verifyB2ProtectedAuthority, 'function');
  const args = { manifest, authorityContext: f.context(), inventory: f.inventory, requestedAt: AT };
  const proof = gate.verifyB2ProtectedAuthority(args);
  assert.deepEqual(proof, { authorityReceipt: f.context().receipt });
  assert.doesNotMatch(JSON.stringify(proof), new RegExp(`${MARKER}|private.synthetic|completedAt|insertedAt|completedObservedAt|capturedAt`));
  for (const mutate of [
    a => { a.authorityContext = undefined; },
    a => { a.authorityContext = structuredClone(a.authorityContext); },
    a => { a.authorityContext = new Proxy(a.authorityContext, {}); },
    a => { a.manifest.resources.web_control_centers_b2_transition.descriptorSha256 = '0'.repeat(64); },
    a => { a.manifest.resources.web_control_centers_b2_transition.expectedPrivateAuthoritySha256 = '0'.repeat(64); },
    a => { a.inventory.capturedAt = '2026-11-08T11:54:00.000Z'; },
    a => { a.inventory.names.pop(); },
    a => { a.inventory.names[0] = 'process-scheduled-publications'; },
    a => { a.inventory.complete = false; },
    a => { a.manifest.resources.function_contracts[0].source_files[0].sha256 = '0'.repeat(64); },
    a => { a.manifest.delta.files.pop(); },
    a => { a.manifest.resources.migrations[0].sha256 = '0'.repeat(64); },
    a => { a.manifest.runtime_closure.closure_sha256 = '0'.repeat(64); },
    a => { a.manifest.runtime_closure.files[0].sha256 = '0'.repeat(64); },
    a => { a.manifest.compiler.sha256 = '0'.repeat(64); },
    a => { a.manifest.resources.function_contracts[0].private = MARKER; },
    a => { a.manifest.resources.web_control_centers_b2_transition.receipt = { private: MARKER }; },
  ]) {
    const a = { ...args, manifest: structuredClone(manifest), inventory: structuredClone(f.inventory) }; mutate(a);
    assert.throws(() => gate.verifyB2ProtectedAuthority(a), error => {
      assert.equal(error.code, 'B2_AUTHORITY_REQUIRED');
      assert.doesNotMatch(`${error}${error.stack}${JSON.stringify(error)}`, new RegExp(MARKER)); return true;
    });
  }
});

test('B2 revalidate and verify-gate reject missing or mismatched context before Git or external work', async () => {
  assert.equal(typeof gate.runCli, 'function', 'trusted in-memory CLI boundary is exported');
  const f = fixture(); const evidence = compile(f.input);
  const input = f.manifestInput(evidence); const manifest = gate.buildManifest(input);
  const dir = mkdtempSync(join(tmpdir(), 'b2-cli-'));
  const bundle = join(dir, 'bundle'); gate.writeManifestBundle({ manifest, outputDirectory: bundle });
  writeFileSync(join(dir, 'policy.json'), JSON.stringify(input.policy));
  writeFileSync(join(dir, 'request.json'), JSON.stringify(input.request));
  const common = ['--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
    '--bundle', bundle, '--compiler-sha256', input.compiler.sha256, '--output', join(dir, 'output.json')];
  for (const command of ['revalidate', 'verify-gate']) {
    const args = command === 'revalidate'
      ? [...common, '--remote-evidence', join(dir, 'does-not-exist.json')]
      : [...common, '--policy-sha256', hash(readFileSync(join(dir, 'policy.json'))),
        ...['environment', 'branch-policies', 'approvals', 'runs'].flatMap(name => [`--${name}`, join(dir, 'does-not-exist.json')])];
    for (const context of [undefined, {}, new Proxy(f.context(), {})]) {
      await assert.rejects(gate.runCli([command, ...args], context, f.inventory), { code: 'B2_AUTHORITY_REQUIRED' });
    }
    // A candidate CLI timestamp cannot renew a stale authenticated context.
    const stale = fixture('2026-01-01T12:00:00.000Z');
    gate.writeManifestBundle({ manifest: gate.buildManifest(stale.manifestInput(compile(stale.input))), outputDirectory: bundle });
    await assert.rejects(gate.runCli([command, ...args, '--requested-at', '2026-01-01T12:00:00.000Z'],
      stale.context(), { ...f.inventory, capturedAt: new Date().toISOString() }), { code: 'B2_AUTHORITY_REQUIRED' });
    gate.writeManifestBundle({ manifest, outputDirectory: bundle });
  }
});

test('B2 verify-gate emits only the closed receipt from marked protected authority', async () => {
  const f = fixture(new Date().toISOString()); const input = f.manifestInput(compile(f.input));
  input.compiler.sha256 = hash(readFileSync(new URL('scripts/nelyon-production-release.mjs', root)));
  input.compiler.snapshot_adapter_sha256 = hash(readFileSync(new URL('scripts/nelyon-production-snapshot-adapter.mjs', root)));
  const manifest = gate.buildManifest(input);
  const dir = mkdtempSync(join(tmpdir(), 'b2-gate-'));
  const bundle = join(dir, 'bundle'); gate.writeManifestBundle({ manifest, outputDirectory: bundle });
  const files = {
    policy: input.policy, request: input.request,
    environment: { id: input.policy.environment.id, name: input.policy.environment.name,
      can_admins_bypass: false, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      protection_rules: [{ type: 'branch_policy' }] },
    'branch-policies': { complete: true, pages: [{ items: [{ name: 'main' }] }] },
    approvals: { complete: true, sourceRunId: input.request.runId, sourceRunAttempt: 1, pages: [{ items: [] }] },
    runs: { complete: true, pages: [{ items: [] }] },
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
  const args = Object.keys(files).flatMap(name => [`--${name}`, join(dir, `${name}.json`)]);
  f.inventory.capturedAt = new Date().toISOString();
  const status = await gate.runCli(['verify-gate', ...args, '--bundle', bundle,
    '--policy-sha256', hash(readFileSync(join(dir, 'policy.json'))), '--compiler-sha256', input.compiler.sha256,
    '--auto-deploy-expected', 'OFF', '--output', join(dir, 'proof.json')], f.context(), f.inventory);
  assert.equal(status, 0);
  const output = readFileSync(join(dir, 'proof.json'), 'utf8');
  assert.deepEqual(JSON.parse(output).authorityReceipt, f.context().receipt);
  assert.doesNotMatch(output, new RegExp(`${MARKER}|expectedCanonicalJson|private.synthetic|provider|locator|capturedAt`));
});

test('B2 verify-gate uses the protected controller clock and output sinks', async () => {
  const protectedNow = '2026-01-01T12:00:00.000Z';
  const f = fixture(protectedNow); const input = f.manifestInput(compile(f.input));
  input.compiler.sha256 = hash(readFileSync(new URL('scripts/nelyon-production-release.mjs', root)));
  input.compiler.snapshot_adapter_sha256 = hash(readFileSync(new URL('scripts/nelyon-production-snapshot-adapter.mjs', root)));
  const manifest = gate.buildManifest(input);
  const dir = mkdtempSync(join(tmpdir(), 'b2-gate-clock-'));
  const bundle = join(dir, 'bundle'); gate.writeManifestBundle({ manifest, outputDirectory: bundle });
  const files = {
    policy: input.policy, request: input.request,
    environment: { id: input.policy.environment.id, name: input.policy.environment.name,
      can_admins_bypass: false, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      protection_rules: [{ type: 'branch_policy' }] },
    'branch-policies': { complete: true, pages: [{ items: [{ name: 'main' }] }] },
    approvals: { complete: true, sourceRunId: input.request.runId, sourceRunAttempt: 1, pages: [{ items: [] }] },
    runs: { complete: true, pages: [{ items: [] }] },
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
  const args = Object.keys(files).flatMap(name => [`--${name}`, join(dir, `${name}.json`)]);
  f.inventory.capturedAt = protectedNow;
  const stdout = [];
  const runtimeOptions = Object.freeze({
    now: () => protectedNow,
    stdout: Object.freeze({ write: value => { stdout.push(String(value)); } }),
    stderr: Object.freeze({ write: () => { throw new Error('unexpected stderr'); } }),
  });
  const status = await gate.runCli(['verify-gate', ...args, '--bundle', bundle,
    '--policy-sha256', hash(readFileSync(join(dir, 'policy.json'))), '--compiler-sha256', input.compiler.sha256,
    '--auto-deploy-expected', 'OFF', '--output', join(dir, 'proof.json')],
  f.context(), f.inventory, undefined, runtimeOptions);
  assert.equal(status, 0);
  assert.deepEqual(stdout, [`GATE VERIFIED ${readFileSync(join(bundle, 'manifest.sha256'), 'utf8').trim()}\n`]);
});

test('B2 revalidate Git subprocess receives no private provider environment', async () => {
  const f = fixture(); const input = f.manifestInput(compile(f.input));
  input.compiler.sha256 = hash(readFileSync(new URL('scripts/nelyon-production-release.mjs', root)));
  input.compiler.snapshot_adapter_sha256 = hash(readFileSync(new URL('scripts/nelyon-production-snapshot-adapter.mjs', root)));
  const manifest = gate.buildManifest(input);
  const dir = mkdtempSync(join(tmpdir(), 'b2-git-env-'));
  const bundle = join(dir, 'bundle'); gate.writeManifestBundle({ manifest, outputDirectory: bundle });
  for (const [name, value] of Object.entries({ policy: input.policy, request: input.request })) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  }
  const trace = join(dir, 'git-trace.json');
  const names = ['GIT_TRACE2_EVENT', 'GIT_TRACE2_ENV_VARS', 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY'];
  const prior = new Map(names.map(name => [name, process.env[name]]));
  process.env.GIT_TRACE2_EVENT = trace;
  process.env.GIT_TRACE2_ENV_VARS = 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY';
  process.env.NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY = MARKER;
  try {
    await assert.rejects(gate.runCli(['revalidate', '--policy', join(dir, 'policy.json'),
      '--request', join(dir, 'request.json'), '--bundle', bundle,
      '--compiler-sha256', input.compiler.sha256, '--remote-evidence', join(dir, 'missing.json'),
      '--output', join(dir, 'output.json')], f.context(), f.inventory, undefined,
    Object.freeze({ now: () => AT, stdout: Object.freeze({ write: () => true }),
      stderr: Object.freeze({ write: () => true }) })));
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  assert.equal(existsSync(trace), false, 'caller Git trace controls never reach the protected child process');
});

test('B2 plan never stages unexpected private fields in remote evidence output', async () => {
  const f = fixture(); const input = f.manifestInput(compile(f.input));
  const { policy, request, ...remote } = input;
  remote.privateAuthority = { owner: MARKER };
  const dir = mkdtempSync(join(tmpdir(), 'b2-remote-'));
  for (const [name, value] of Object.entries({ policy, request, remote,
    history: { complete: true, pages: [{ items: [] }] } })) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  const output = join(dir, 'retained-evidence.json');
  await assert.rejects(gate.runCli(['plan', '--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
    '--remote-evidence', join(dir, 'remote.json'), '--history', join(dir, 'history.json'),
    '--evidence-output', output, '--output', join(dir, 'bundle')]), { code: 'B2_DESCRIPTOR_INVALID' });
  assert.equal(existsSync(output), false);
  delete remote.privateAuthority;
  writeFileSync(join(dir, 'remote.json'), JSON.stringify(remote));
  assert.equal(await gate.runCli(['plan', '--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
    '--remote-evidence', join(dir, 'remote.json'), '--history', join(dir, 'history.json'),
    '--evidence-output', output, '--output', join(dir, 'bundle')]), 0);
  for (const path of [output, ...readdirSync(join(dir, 'bundle')).map(name => join(dir, 'bundle', name))]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(`${MARKER}|successorCatalog|expectedCanonicalJson|authorityReceipt`));
  }
});

test('B2 rejects nested private keys and objects before any artifact staging', async () => {
  const f = fixture(); const clean = f.manifestInput(compile(f.input));
  const mutations = [
    v => { v.migrations[0].privateAuthority = { owner: MARKER }; },
    v => { v.risk.privateAuthority = { owner: MARKER }; },
    v => { v.risk.findings.push({ severity: 'HIGH', code: 'DATABASE_MIGRATION', path: null, resource: 'database', message: 'production database migration', privateAuthority: { owner: MARKER } }); },
    v => { v.reproducibility.privateAuthority = { owner: MARKER }; },
    v => { v.reproducibility.findings.push({ severity: 'BLOCKING', code: 'FUNCTION_SOURCE_MISSING', path: null, resource: 'ai-handoff', message: { owner: MARKER } }); },
    v => { v.compiler.privateAuthority = { owner: MARKER }; },
    v => { v.classified.privateAuthority = { owner: MARKER }; },
    v => { v.classified.all[0].privateAuthority = { owner: MARKER }; },
    v => { v.gitState.privateAuthority = { owner: MARKER }; },
    v => { v.gitState.changes[0].privateAuthority = { owner: MARKER }; },
    v => { v.reproducibility.blockedFunctions = [MARKER]; },
    v => { v.risk.findings.push({ severity: 'HIGH', code: 'DATABASE_MIGRATION', path: MARKER, resource: 'database', message: 'production database migration' }); },
    v => { v.b2Release.configAfter['agora-token'].entrypoint = MARKER; },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(clean); mutate(input);
    assert.throws(() => gate.buildManifest(input), { code: 'B2_DESCRIPTOR_INVALID' });
    const { policy, request, ...remote } = input;
    const dir = mkdtempSync(join(tmpdir(), 'b2-nested-'));
    for (const [name, value] of Object.entries({ policy, request, remote, history: { complete: true, pages: [{ items: [] }] } })) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
    }
    await assert.rejects(gate.runCli(['plan', '--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
      '--remote-evidence', join(dir, 'remote.json'), '--history', join(dir, 'history.json'),
      '--evidence-output', join(dir, 'retained.json'), '--output', join(dir, 'bundle')]), { code: 'B2_DESCRIPTOR_INVALID' });
    assert.equal(existsSync(join(dir, 'retained.json')), false);
    assert.equal(existsSync(join(dir, 'bundle')), false);
  }
  const manifest = gate.buildManifest(clean);
  for (const mutate of [v => { v.resources.migrations[0].privateAuthority = MARKER; },
    v => { v.risk.privateAuthority = MARKER; }, v => { v.compiler.privateAuthority = MARKER; },
    v => { v.identity.privateAuthority = MARKER; }, v => { v.delta.files[0].privateAuthority = MARKER; },
    v => { v.privateAuthority = MARKER; }]) {
    const altered = structuredClone(manifest); mutate(altered);
    assert.throws(() => gate.verifyB2ProtectedAuthority({ manifest: altered, authorityContext: f.context(), inventory: f.inventory, requestedAt: AT }), { code: 'B2_AUTHORITY_REQUIRED' });
  }
});

test('B2 retained projections omit free diagnostic and remote locator values', async () => {
  const f = fixture(); const input = f.manifestInput(compile(f.input));
  input.gitState.remote = MARKER;
  input.risk.findings.push({ severity: 'HIGH', code: 'DATABASE_MIGRATION', path: f.descriptor.contract.productive_changes.at(-1).path, resource: 'database', message: MARKER });
  input.reproducibility.findings.push({ severity: 'BLOCKING', code: 'FLOATING_DEPENDENCY', path: 'supabase/functions/ai-handoff/index.ts', resource: 'ai-handoff', message: MARKER, specifier: MARKER });
  const manifest = gate.buildManifest(input);
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(MARKER));
  const { policy, request, ...remote } = input;
  const dir = mkdtempSync(join(tmpdir(), 'b2-values-'));
  for (const [name, value] of Object.entries({ policy, request, remote, history: { complete: true, pages: [{ items: [] }] } })) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  }
  assert.equal(await gate.runCli(['plan', '--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
    '--remote-evidence', join(dir, 'remote.json'), '--history', join(dir, 'history.json'),
    '--evidence-output', join(dir, 'retained.json'), '--output', join(dir, 'bundle')]), 0);
  for (const path of [join(dir, 'retained.json'), ...readdirSync(join(dir, 'bundle')).map(name => join(dir, 'bundle', name))]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(MARKER));
  }
});

test('B2 minted context must be valid at trusted operation time, including exclusive expiry', () => {
  const f = fixture(); const manifest = gate.buildManifest(f.manifestInput(compile(f.input)));
  const context = f.context();
  for (const requestedAt of ['2027-01-01T00:00:00.000Z', '2026-11-09T10:00:00.000Z',
    '2026-11-09T11:00:00.000Z', '2026-11-08T10:59:59.999Z', '2026-11-08T09:59:59.999Z',
    '2026-11-08', null, 0]) {
    assert.throws(() => gate.verifyB2ProtectedAuthority({ manifest, authorityContext: context,
      inventory: { ...f.inventory, capturedAt: requestedAt }, requestedAt }), { code: 'B2_AUTHORITY_REQUIRED' });
  }
  assert.deepEqual(gate.verifyB2ProtectedAuthority({ manifest, authorityContext: context,
    inventory: f.inventory, requestedAt: AT }), { authorityReceipt: context.receipt });
  const longBackup = fixture(AT, 48);
  assert.throws(() => longBackup.context(), { code: 'RELEASE_AUTHORITY_CONTEXT_INVALID' },
    'an independent authority cannot extend the insertion-based 24-hour limit');
  const shortApproval = fixture(AT, 22, 1);
  const approvalExpiry = '2026-11-08T13:00:00.000Z';
  assert.throws(() => gate.verifyB2ProtectedAuthority({
    manifest: gate.buildManifest(shortApproval.manifestInput(compile(shortApproval.input))),
    authorityContext: shortApproval.context(), inventory: { ...shortApproval.inventory, capturedAt: approvalExpiry },
    requestedAt: approvalExpiry,
  }), { code: 'B2_AUTHORITY_REQUIRED' });
});

test('B2 syntactically valid diagnostic locator paths never enter retained artifacts', async () => {
  const f = fixture(); const input = f.manifestInput(compile(f.input));
  input.risk.findings.push({ severity: 'HIGH', code: 'GATE_AUTHORITY_CHANGE',
    path: `scripts/${MARKER}.mjs`, resource: 'release-gate', message: 'release authority changed' });
  input.reproducibility.findings.push({ severity: 'BLOCKING', code: 'FLOATING_DEPENDENCY',
    path: `supabase/functions/ai-handoff/${MARKER}.ts`, resource: 'ai-handoff',
    message: 'dependency is not immutably pinned', specifier: `https://example.invalid/${MARKER}` });
  const manifest = gate.buildManifest(input);
  assert.equal(JSON.stringify(manifest).includes(MARKER), false, 'diagnostic locators are not public resource authority');
  assert.equal(manifest.risk.findings[0].path, null);
  assert.equal(manifest.blockers[0].path, null);
  const { policy, request, ...remote } = input;
  const dir = mkdtempSync(join(tmpdir(), 'b2-diagnostic-path-'));
  for (const [name, value] of Object.entries({ policy, request, remote, history: { complete: true, pages: [{ items: [] }] } })) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  }
  assert.equal(await gate.runCli(['plan', '--policy', join(dir, 'policy.json'), '--request', join(dir, 'request.json'),
    '--remote-evidence', join(dir, 'remote.json'), '--history', join(dir, 'history.json'),
    '--evidence-output', join(dir, 'retained.json'), '--output', join(dir, 'bundle')]), 0);
  for (const path of [join(dir, 'retained.json'), ...readdirSync(join(dir, 'bundle')).map(name => join(dir, 'bundle', name))]) {
    assert.equal(readFileSync(path, 'utf8').includes(MARKER), false, 'retained artifact excludes diagnostic locator values');
  }
});
