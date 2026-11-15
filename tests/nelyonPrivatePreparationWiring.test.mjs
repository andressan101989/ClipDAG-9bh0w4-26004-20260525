import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';
import { preparePrivatePlan } from '../scripts/nelyon-private-preparation.mjs';

const BLOCKED = Object.freeze({ schemaVersion: 1, result: 'BLOCKED', releaseReady: false });
const MARKER = 'SYNTHETIC_RETIRED_PRIVATE_PREPARATION_MARKER';
const source = readFileSync(new URL('../scripts/nelyon-private-preparation.mjs', import.meta.url), 'utf8');
const legacyInput = mode => ({
  authorityJson: MARKER,
  expectedSha256: 'a'.repeat(64),
  requestJson: JSON.stringify({ mode }),
  preSnapshotJson: JSON.stringify({ marker: MARKER }),
  cwd: MARKER,
  adapterSourceSha256: 'b'.repeat(64),
  generatedAt: '2026-01-01T00:00:00.000Z',
});

test('even the formerly valid local plan shape is an inert compatibility block', () => {
  const first = preparePrivatePlan(legacyInput('plan_only'));
  const second = preparePrivatePlan(legacyInput('plan_only'));
  assert.deepEqual(first, BLOCKED);
  assert.equal(first, second, 'the facade must return one immutable tombstone');
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(Object.keys(first), ['schemaVersion', 'result', 'releaseReady']);
});

const blockedModes = [
  'plan_only', 'release', 'gate_proof', 'postcheck', 'postcheck_recovery', 'admin_recovery',
  'authority-proof', 'revalidate', 'verify-gate', 'pre-snapshot', 'verify-pre-snapshot',
  'post-snapshot', 'verify-recovery-source', 'recovery-snapshot',
  'verify-admin-recovery-source', 'verify-admin-recovery-postcheck-chain',
  'postcheck-admin-recovery', 'verify-admin-recovery-cloudflare-prestate',
];
for (const mode of blockedModes) {
  test(`${mode} cannot use the retired facade`, () => {
    assert.deepEqual(preparePrivatePlan(legacyInput(mode)), BLOCKED);
  });
}

test('the retired facade observes no caller getter or Proxy trap', () => {
  let getterReads = 0;
  const getterInput = {};
  Object.defineProperty(getterInput, 'authorityJson', {
    enumerable: true,
    get() { getterReads++; throw new Error(MARKER); },
  });
  let traps = 0;
  const proxy = new Proxy({}, {
    get() { traps++; throw new Error(MARKER); },
    getOwnPropertyDescriptor() { traps++; throw new Error(MARKER); },
    getPrototypeOf() { traps++; throw new Error(MARKER); },
    ownKeys() { traps++; throw new Error(MARKER); },
  });
  assert.deepEqual(preparePrivatePlan(getterInput), BLOCKED);
  assert.deepEqual(preparePrivatePlan(proxy), BLOCKED);
  assert.equal(getterReads, 0);
  assert.equal(traps, 0);
});

test('private markers cannot enter return value or process output', () => {
  const output = [];
  const stdout = mock.method(process.stdout, 'write', chunk => { output.push(String(chunk)); return true; });
  const stderr = mock.method(process.stderr, 'write', chunk => { output.push(String(chunk)); return true; });
  let result;
  try {
    result = preparePrivatePlan({ ...legacyInput('plan_only'), providerLocator: MARKER,
      credential: MARKER, stack: MARKER });
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
  }
  assert.deepEqual(result, BLOCKED);
  assert.equal(JSON.stringify(result).includes(MARKER), false);
  assert.deepEqual(output, []);
});

test('retired facade has no authority, compiler, adapter, provider, environment or CLI seam', () => {
  assert.doesNotMatch(source, /PREPARATION_CHECKED|PLAN READY|NO PRODUCTIVE CHANGES/);
  assert.doesNotMatch(source, /parsePrivateAuthority|parsePrivatePreparationJson|createReleaseAuthorityContext/);
  assert.doesNotMatch(source, /nelyon-(?:private-authority|release-authority-context|private-authority-runtime|private-authority-provider|production-release|production-snapshot-adapter)/);
  assert.doesNotMatch(source, /node:(?:fs|child_process|http|https|net|tls)|process\.env|import\.meta|authorityReceipt|AuthorityVerification/);
  assert.doesNotMatch(source, /authorityJson|expectedSha256|requestJson|preSnapshotJson|adapterSourceSha256|generatedAt/);
});
