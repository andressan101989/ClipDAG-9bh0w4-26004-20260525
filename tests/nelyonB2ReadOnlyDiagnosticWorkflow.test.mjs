import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
// Existing transitive dependency in package-lock; no new install or dependency.
import YAML from 'yaml';
import { buildPrivateRuntimeClosure, verifyPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';

const text = fs.readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
const workflow = YAML.parse(text, { maxAliasCount: 1000 });
const diagnostic = () => { assert.ok(workflow.jobs['snapshot-diagnostic'], 'terminal diagnostic job must exist'); return workflow.jobs['snapshot-diagnostic']; };
const step = (job, id) => { const value = job.steps.find(s => s.id === id); assert.ok(value, `missing ${id}`); return value; };
function admitted(expression, { selector = true, mode = 'release', failed = false, outcomes = {}, proof = 'success', blocked = 'false', result = 'PLAN READY', count = '1', risk = 'HIGH', ref = 'refs/heads/main' } = {}) {
  // This is NOT a generic Actions interpreter or service certification.
  // This workflow subset uses boolean operators and equality only; toJSON makes
  // the selector type explicit rather than relying on JS vs Actions coercion.
  const needs = { plan: { outputs: { mode, blocked, result, productive_change_count: count, risk, admin_enabled: 'false', b2_recovery_pending: 'false' } }, 'private-authority-check': { result: proof, outputs: { receipt: '{}' } } };
  const steps = new Proxy({}, { get: (_, key) => ({ outcome: outcomes[key] ?? 'success' }) });
  const expressionText = String(expression).replace(/^\$\{\{\s*|\s*\}\}$/g, '').replaceAll('needs.private-authority-check', "needs['private-authority-check']");
  if (failed && !/always\(\)/.test(expressionText)) return false;
  return Boolean(Function('inputs', 'needs', 'steps', 'github', 'toJSON', 'fromJSON', 'always', `return (${expressionText});`)({ preflight_only: selector }, needs, steps, { ref }, JSON.stringify, JSON.parse, () => true));
}
function nodeBody(run) {
  const match = run.match(/node --input-type=commonjs <<'NODE'\n([\s\S]*?)\nNODE(?:\n|$)/);
  assert.ok(match, 'actual node heredoc must exist'); return match[1];
}

test('typed opt-in preserves release default and separates terminal job structurally', () => {
  assert.equal(workflow['run-name'], "${{ inputs.mode == 'authority_issue' && inputs.release_id || format('{0} | {1} | {2}', inputs.mode == 'authority_observe' && 'Nelyon B2 authority observation' || (toJSON(inputs.preflight_only) == 'true' && 'Nelyon read-only B2 diagnostic' || 'Nelyon production release'), inputs.mode, inputs.release_id) }}");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.preflight_only, { description: 'Read-only B2 snapshot diagnostic; never deploy', required: false, type: 'boolean', default: false });
  const d = diagnostic(); assert.deepEqual(d.needs, ['plan', 'private-authority-check']);
  assert.equal(d.environment, 'production'); assert.deepEqual(d.concurrency, workflow.jobs.deploy.concurrency);
  assert.deepEqual(d.permissions, { contents: 'read', actions: 'read', deployments: 'read' });
  for (const selector of [true, false, null, 'true', 'false', 0, 1, {}, []]) {
    assert.equal(admitted(d.if, { selector }), selector === true);
    assert.equal(admitted(workflow.jobs.deploy.if, { selector }), selector === false);
  }
  for (const mode of ['plan_only', 'gate_proof', 'admin_recovery', 'postcheck_recovery']) assert.equal(admitted(d.if, { mode }), false);
  for (const variant of [{ proof: 'failure' }, { proof: 'skipped' }, { blocked: 'true' }, { count: '0' }, { result: 'DENY' }, { risk: 'STANDARD' }, { ref: 'refs/heads/other' }]) assert.equal(admitted(d.if, variant), false);
  assert.equal(Object.keys(workflow.jobs).at(-1), 'snapshot-diagnostic');
  for (const job of Object.values(workflow.jobs)) {
    const ids = job.steps.filter(s => s.id).map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, 'step IDs must be unique within each job');
  }
  for (const [name, job] of Object.entries(workflow.jobs)) if (name !== 'snapshot-diagnostic') assert.ok(![].concat(job.needs ?? []).includes('snapshot-diagnostic'));
});

test('public selector validation rejects incompatible and non-B2 requests before secrets', () => {
  const v = step(workflow.jobs.plan, 'validate_preflight_selection');
  assert.equal(v.env.PREFLIGHT_ONLY, '${{ toJSON(inputs.preflight_only) }}');
  assert.doesNotMatch(JSON.stringify(v), /secrets\./);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-diag-selector-'));
  try {
    fs.mkdirSync(path.join(dir, 'release-artifact/bundle'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'release-input'));
    const request = { mode: 'release' };
    const manifest = { identity: { mode: 'release' }, resources: { web_control_centers_b2_transition: {} }, result: 'PLAN READY', blockers: [], risk: { level: 'HIGH' }, delta: { productive_change_count: 1 } };
    const run = (selector, r = request, m = manifest) => {
      fs.writeFileSync(path.join(dir, 'release-input/request.json'), JSON.stringify(r));
      fs.writeFileSync(path.join(dir, 'release-artifact/bundle/manifest.json'), JSON.stringify(m));
      return spawnSync(process.execPath, ['--input-type=commonjs', '-e', nodeBody(v.run)], { cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PREFLIGHT_ONLY: JSON.stringify(selector), WORKFLOW_REF_NAME: 'refs/heads/main' }, encoding: 'utf8' });
    };
    assert.equal(run(true).status, 0); assert.equal(run(false, { mode: 'gate_proof' }, {}).status, 0);
    for (const value of [null, 'true', 'false', {}, 1]) assert.notEqual(run(value).status, 0);
    for (const mode of ['gate_proof', 'admin_recovery', 'postcheck_recovery']) assert.notEqual(run(true, { mode }).status, 0);
    assert.notEqual(run(true, { ...request, recoverySourceRunId: '1' }).status, 0);
    assert.notEqual(run(true, request, { ...manifest, resources: {} }).status, 0);
    assert.notEqual(run(true, request, { ...manifest, blockers: [{}] }).status, 0);
    for (const count of [null, '1', -1, 0]) assert.notEqual(run(true, request, { ...manifest, delta: { productive_change_count: count } }).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actual diagnostic receipt scripts reject tampering and cleanup removes only fixed scratch', () => {
  const d = diagnostic();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'b2-diag-output-')));
  const root = path.join(dir, 'nelyon-private-authority-public');
  const untouched = path.join(dir, 'unrelated.txt');
  fs.mkdirSync(root); fs.writeFileSync(untouched, 'preserve');
  const expected = { schemaVersion: 1, verified: true, approvalSha256: 'a'.repeat(64) };
  fs.writeFileSync(path.join(root, 'expected-receipt.json'), JSON.stringify(expected));
  const execute = id => spawnSync(process.execPath, ['--input-type=commonjs', '-e', nodeBody(step(d, id).run)], {
    cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, RUNNER_TEMP: dir }, encoding: 'utf8',
  });
  try {
    for (const [id, filename] of [['pre_snapshot', 'pre-snapshot-authority.json'], ['verify_pre_snapshot', 'pre-snapshot-verification-authority.json']]) {
      fs.writeFileSync(path.join(root, filename), JSON.stringify({ receipt: expected }));
      assert.equal(execute(id).status, 0);
      fs.writeFileSync(path.join(root, filename), JSON.stringify({ receipt: { ...expected, approvalSha256: 'b'.repeat(64) } }));
      const rejected = execute(id); assert.notEqual(rejected.status, 0);
      assert.doesNotMatch(rejected.stdout + rejected.stderr, /b{64}/);
    }
    fs.writeFileSync(path.join(root, 'production-pre.json'), 'SYNTHETIC_PRIVATE_MARKER');
    const cleaned = execute('diagnostic_output_cleanup');
    assert.equal(cleaned.status, 0, cleaned.stderr); assert.equal(fs.existsSync(root), false);
    assert.equal(fs.readFileSync(untouched, 'utf8'), 'preserve');
    assert.doesNotMatch(cleaned.stdout + cleaned.stderr, /SYNTHETIC_PRIVATE_MARKER/);
    assert.equal(execute('diagnostic_output_cleanup').status, 0, 'cleanup is idempotent for missing output');
    const outside = path.join(dir, 'untouched-directory');
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'preserve');
    fs.symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      assert.notEqual(execute('diagnostic_output_cleanup').status, 0, 'symlink/junction output namespace must be rejected');
      assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'preserve');
    } finally { fs.unlinkSync(root); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('aliases preserve full protected prefix and prohibit mutations and raw artifact promotion', () => {
  const d = diagnostic();
  const original = workflow.jobs.deploy.steps;
  const custom = new Set(['pre_snapshot', 'verify_pre_snapshot', 'diagnostic_output_cleanup', 'diagnostic_terminal']);
  for (const s of d.steps) if (!custom.has(s.id)) assert.ok(original.some(o => JSON.stringify(o) === JSON.stringify(s)), `step is not an exact alias: ${s.name}`);
  const source = JSON.stringify(d.steps);
  assert.doesNotMatch(source, /upload-artifact|supabase\s+(?:db|functions)|wrangler|dry-run|build:deployment|versions (?:upload|deploy)|triggers deploy/);
  assert.doesNotMatch(d.steps.map(s => s.run ?? '').join('\n'), /^\s*cp[^\n]*production-pre\.json/m);
  const ids = d.steps.map(s => s.id);
  for (const id of ['b2_release_revalidation', 'b2_release_revalidation_cleanup', 'b2_release_revalidation_receipt', 'b2_release_gate_authority', 'b2_release_gate_authority_cleanup', 'b2_pre_snapshot_authority', 'b2_pre_snapshot_authority_cleanup', 'pre_snapshot', 'b2_verify_pre_snapshot_authority', 'b2_verify_pre_snapshot_authority_cleanup', 'verify_pre_snapshot', 'diagnostic_output_cleanup', 'diagnostic_terminal']) assert.ok(ids.includes(id), id);
  assert.ok(ids.indexOf('b2_release_gate_authority_cleanup') < ids.indexOf('b2_pre_snapshot_authority'));
  assert.equal(ids.at(-1), 'diagnostic_terminal');
  assert.doesNotMatch(JSON.stringify(workflow.jobs['private-authority-check']), /SUPABASE_ACCESS_TOKEN/);
});

test('failed closure gate capture or cleanup never produces diagnostic success or admits deploy', () => {
  const d = diagnostic(), terminal = step(d, 'diagnostic_terminal');
  assert.equal(terminal.if, 'always()', 'terminal must fail explicitly, not silently skip');
  const dependencies = ['b2_release_preflight', 'b2_release_preflight_cleanup', 'b2_release_preflight_receipt', 'b2_release_refresh_authorization', 'b2_release_refresh_authorization_cleanup', 'b2_release_refresh_authorization_receipt', 'b2_release_revalidation', 'b2_release_revalidation_cleanup', 'b2_release_revalidation_receipt', 'b2_release_gate_authority', 'b2_release_gate_authority_cleanup', 'b2_release_gate_acceptance', 'b2_pre_snapshot_authority', 'b2_pre_snapshot_authority_cleanup', 'pre_snapshot', 'b2_verify_pre_snapshot_authority', 'b2_verify_pre_snapshot_authority_cleanup', 'verify_pre_snapshot', 'b2_final_authority_cleanup', 'diagnostic_output_cleanup'];
  const sourceIds = [...terminal.env.DIAGNOSTIC_RESULTS.matchAll(/steps\.([a-z0-9_]+)\.outcome/g)].map(m => m[1]);
  assert.deepEqual(sourceIds, dependencies);
  const run = outcomes => spawnSync(process.execPath, ['--input-type=commonjs', '-e', nodeBody(terminal.run)], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DIAGNOSTIC_RESULTS: dependencies.map(id => outcomes[id] ?? 'success').join('|') }, encoding: 'utf8',
  });
  for (const id of dependencies) {
    for (const state of ['failure', 'skipped', 'cancelled']) {
      assert.equal(admitted(terminal.if, { outcomes: { [id]: state } }), true, id);
      const result = run({ [id]: state }); assert.equal(result.status, 2, id);
      assert.doesNotMatch(result.stdout + result.stderr, /READ_ONLY_DIAGNOSTIC_VERIFIED/);
      assert.equal(admitted(workflow.jobs.deploy.if, { selector: true, outcomes: { [id]: state } }), false);
    }
  }
  assert.equal(run({}).status, 0); assert.equal(admitted(terminal.if, { failed: true }), true);
  assert.equal(admitted(step(d, 'diagnostic_output_cleanup').if, { failed: true }), true);
  assert.match(terminal.run, /READ_ONLY_DIAGNOSTIC_VERIFIED/); assert.match(terminal.run, /releaseReady.*false/);
});

test('snapshot cannot run if complete gate acceptance or revalidation acceptance is missing', () => {
  const d = diagnostic();
  const gate = step(d, 'b2_release_gate_acceptance');
  const capture = step(d, 'b2_pre_snapshot_authority');
  assert.ok(d.steps.indexOf(gate) < d.steps.indexOf(capture));
  assert.match(gate.run, /release-gate-verification.json/);
  for (const id of ['b2_release_gate_acceptance', 'b2_release_revalidation_receipt']) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) assert.equal(admitted(capture.if, { outcomes: { [id]: outcome } }), false);
  }
});

test('every diagnostic action is explicit and tampered pins fail the actual protected closure verifier', () => {
  const d = diagnostic(), root = process.cwd();
  const manifestClosure = buildPrivateRuntimeClosure({ repositoryRoot: root, readFile: fs.readFileSync });
  const base = { manifestClosure, protectedClosureSha256: manifestClosure.closure_sha256, repositoryRoot: root, nodeVersion: '24.21.0' };
  verifyPrivateRuntimeClosure({ ...base, readFile: fs.readFileSync });
  const split = text.indexOf('\n  snapshot-diagnostic:');
  const tail = text.slice(split);
  for (const action of d.steps.filter(s => s.uses)) {
    assert.match(action.uses, /@[a-f0-9]{40}$/);
    assert.ok(tail.includes('uses: ' + action.uses), 'actions remain explicit for the existing pin parser');
    const altered = text.slice(0, split) + tail.replace('uses: ' + action.uses, 'uses: ' + action.uses.replace(/@[a-f0-9]{40}$/, '@' + '0'.repeat(40)));
    const readFile = p => path.resolve(p) === path.join(root, '.github/workflows/nelyon-production-release.yml') ? Buffer.from(altered) : fs.readFileSync(p);
    assert.throws(() => verifyPrivateRuntimeClosure({ ...base, readFile }), { code: 'PRIVATE_RUNTIME_CLOSURE_INVALID' });
  }
});

test('diagnostic shares offline preflight and refresh permit before PAT without migration commands',()=>{
 const d=diagnostic(),ids=d.steps.map(s=>s.id);
 const order=['b2_release_preflight','b2_release_preflight_cleanup','b2_release_preflight_receipt','b2_release_refresh_authorization','b2_release_refresh_authorization_cleanup','b2_release_refresh_authorization_receipt','b2_release_revalidation'];
 for(let i=0;i<order.length;i++){assert.ok(ids.includes(order[i]),order[i]);if(i)assert.ok(ids.indexOf(order[i-1])<ids.indexOf(order[i]));}
 for(const id of order.slice(0,-1))assert.doesNotMatch(JSON.stringify(step(d,id)),/SUPABASE_ACCESS_TOKEN/);
 assert.equal(step(d,'b2_release_revalidation').env.SUPABASE_ACCESS_TOKEN,'${{ secrets.SUPABASE_ACCESS_TOKEN }}');
 for(const outcome of ['failure','skipped','cancelled']){
  assert.equal(admitted(step(d,'b2_release_refresh_authorization').if,{outcomes:{b2_release_preflight_receipt:outcome}}),false);
  assert.equal(admitted(step(d,'b2_release_revalidation').if,{outcomes:{b2_release_refresh_authorization_receipt:outcome}}),false);
 }
 assert.doesNotMatch(d.steps.map(s=>s.run??'').join('\n'),/dryrun-migrations|apply-migrations|resolveInstalledLinuxCliBinary|\/cli\/login-role/);
});
