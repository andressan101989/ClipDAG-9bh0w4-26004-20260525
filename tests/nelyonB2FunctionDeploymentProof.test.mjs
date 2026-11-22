import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  beginB2FunctionDeploymentAttempt,
  createB2FunctionDeploymentNotStarted,
  createB2FunctionDeploymentAttempt,
  markB2FunctionDeploymentIntent,
  reconcileB2FunctionDeploymentTransition,
  resumeB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentProof,
} from '../scripts/nelyon-b2-function-deployment-proof.mjs';
import { executeB2FunctionDeploymentBatch } from '../scripts/nelyon-b2-explicit-connection.mjs';
import { verifyB2FunctionDeploymentPostcheck } from '../scripts/nelyon-production-snapshot-adapter.mjs';
import { writeFunctionProofCheckpoint } from '../scripts/nelyon-private-authority-cli.mjs';

const AT = '2026-11-22T16:00:00.000Z';
const names = [
  'ai-handoff',
  'cleanup-stale-media-uploads',
  'content-safety-scan',
  'create-media-upload',
  'finalize-media-upload',
  'get-media-url',
  'process-scheduled-publications',
  'video-semantic-index',
];
const verifyJwt = [false, false, true, true, true, true, false, true];
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = names.map((name, index) => ({
  name,
  verify_jwt: verifyJwt[index],
  source_sha256: digest(`git-source:${name}`),
  config_sha256: digest(`git-config:${name}`),
}));
const manifestSha256 = digest(`${JSON.stringify(manifest)}\n`);
const beforeRows = names.filter(name => name !== 'process-scheduled-publications').map(name => ({
  name,
  status: 'ACTIVE',
  verify_jwt: verifyJwt[names.indexOf(name)],
  version: names.indexOf(name) + 10,
  ezbr_sha256: digest(`before:${name}`),
}));

function deployedRows(completedCount) {
  const rows = beforeRows.map(row => ({ ...row }));
  for (const name of names.slice(0, completedCount)) {
    const index = rows.findIndex(row => row.name === name);
    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        version: rows[index].version + 1,
        ezbr_sha256: digest(`after:${rows[index].name}`),
      };
    }
  }
  if (completedCount >= 7) {
    rows.splice(6, 0, {
      name: names[6],
      status: 'ACTIVE',
      verify_jwt: false,
      version: 1,
      ezbr_sha256: digest(`after:${names[6]}`),
    });
  }
  return rows;
}

function recordTransition(options) {
  const proof = options.proof.in_flight === null
    ? markB2FunctionDeploymentIntent({
      proof: options.proof,
      manifest: options.manifest,
      manifestSha256: options.manifestSha256,
      beforeRows: options.beforeRows,
      functionName: options.functionName,
      capturedAt: new Date(Date.parse(options.capturedAt) - 1).toISOString(),
    })
    : options.proof;
  return reconcileB2FunctionDeploymentTransition({ ...options, proof });
}

test('records exactly seven replacements and one enrollment after ordered provider readback', () => {
  let proof = createB2FunctionDeploymentAttempt({
    manifest,
    manifestSha256,
    beforeRows,
    capturedAt: AT,
  });

  for (let index = 0; index < names.length; index += 1) {
    proof = recordTransition({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index + 1) * 1000)).toISOString(),
    });
  }

  const verified = verifyB2FunctionDeploymentProof({
    proof,
    manifest,
    manifestSha256,
    postRows: deployedRows(8),
  });
  assert.equal(verified.result, 'FUNCTIONS_EXECUTED');
  assert.deepEqual(verified.receipts.map(row => row.name), names);
  assert.deepEqual(verified.receipts.map(row => row.operation), [
    'REPLACED', 'REPLACED', 'REPLACED', 'REPLACED',
    'REPLACED', 'REPLACED', 'ENROLLED', 'REPLACED',
  ]);
  assert.equal(verified.receipts.every(row => row.provider_readback === true), true);
  assert.equal(verified.receipts.every(row => 'provider_package_sha256' in row.after), true);
  assert.equal(verified.receipts.every(row => !('source_sha256' in row.after)), true);
});

test('binds the proof digest to all eight Git source and config identities', () => {
  const altered = structuredClone(manifest);
  altered[4].source_sha256 = digest('different Git-LF source bytes');
  assert.throws(() => createB2FunctionDeploymentAttempt({
    manifest: altered,
    manifestSha256,
    beforeRows,
    capturedAt: AT,
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('accepts only canonical RFC3339-millisecond timestamps', () => {
  for (const capturedAt of [
    '2026-11-22T16:00:00Z',
    '2026-11-22T11:00:00.000-05:00',
    '2026-11-22T16:00:00.0000Z',
    '2026-11-22T16:00:00.001+00:00',
  ]) {
    assert.throws(() => createB2FunctionDeploymentNotStarted({
      manifest,
      manifestSha256,
      capturedAt,
    }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
  }
  assert.equal(createB2FunctionDeploymentNotStarted({
    manifest,
    manifestSha256,
    capturedAt: AT,
  }).captured_at, AT);
});

test('requires process-scheduled-publications as the sole initial enrollment', () => {
  const wrongBefore = beforeRows.filter(row => row.name !== names[0]);
  wrongBefore.push({
    name: 'process-scheduled-publications',
    status: 'ACTIVE',
    verify_jwt: false,
    version: 1,
    ezbr_sha256: digest('unexpected-existing-scheduler'),
  });
  assert.throws(() => createB2FunctionDeploymentAttempt({
    manifest,
    manifestSha256,
    beforeRows: wrongBefore,
    capturedAt: AT,
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('persists NOT_STARTED before inventory and can begin from the exact seven-row inventory', () => {
  const notStarted = createB2FunctionDeploymentNotStarted({
    manifest,
    manifestSha256,
    capturedAt: AT,
  });
  assert.equal(notStarted.result, 'NOT_STARTED');
  assert.deepEqual(notStarted.before, []);
  const started = beginB2FunctionDeploymentAttempt({
    proof: notStarted,
    manifest,
    manifestSha256,
    beforeRows,
    capturedAt: new Date(Date.parse(AT) + 1000).toISOString(),
  });
  assert.equal(started.result, 'INCOMPLETE');
  assert.deepEqual(started.before, beforeRows.map(row => ({
    name: row.name,
    provider_package_sha256: row.ezbr_sha256,
    status: row.status,
    verify_jwt: row.verify_jwt,
    version: row.version,
  })));
});

test('validates changed in-flight evidence with the same transition predicate as live readback', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  proof = markB2FunctionDeploymentIntent({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    functionName: names[0],
    capturedAt: new Date(Date.parse(AT) + 1000).toISOString(),
  });
  proof = reconcileB2FunctionDeploymentTransition({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(1),
    functionName: names[0],
    commandSucceeded: false,
    capturedAt: new Date(Date.parse(AT) + 2000).toISOString(),
  });
  const altered = structuredClone(proof);
  altered.in_flight.observed.verify_jwt = !manifest[0].verify_jwt;
  assert.throws(() => verifyB2FunctionDeploymentAttempt({
    proof: altered,
    manifest,
    manifestSha256,
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('retains only the completed prefix and marks the fourth slug indeterminate after timeout', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  for (let index = 0; index < 3; index += 1) {
    proof = recordTransition({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index + 1) * 1000)).toISOString(),
    });
  }
  proof = recordTransition({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(4),
    functionName: names[3],
    commandSucceeded: false,
    capturedAt: new Date(Date.parse(AT) + 4000).toISOString(),
  });

  assert.deepEqual(proof.receipts.map(row => row.name), names.slice(0, 3));
  assert.equal(proof.in_flight.name, names[3]);
  assert.equal(proof.in_flight.disposition, 'CHANGED_AFTER_FAILED_COMMAND');
  assert.equal(proof.in_flight.observed.provider_package_sha256, digest(`after:${names[3]}`));
  assert.throws(() => verifyB2FunctionDeploymentProof({
    proof,
    manifest,
    manifestSha256,
    postRows: deployedRows(4),
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('rejects non-monotonic provider readback timestamps', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  proof = recordTransition({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(1),
    functionName: names[0],
    commandSucceeded: true,
    capturedAt: new Date(Date.parse(AT) + 1000).toISOString(),
  });
  assert.throws(() => recordTransition({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(2),
    functionName: names[1],
    commandSucceeded: true,
    capturedAt: new Date(Date.parse(AT) + 500).toISOString(),
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('rejects missing, substituted and reordered deployment receipts', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  for (let index = 0; index < names.length; index += 1) {
    proof = recordTransition({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index + 1) * 1000)).toISOString(),
    });
  }

  for (const mutate of [
    candidate => candidate.receipts.pop(),
    candidate => { candidate.receipts[2].name = 'substituted-function'; },
    candidate => { [candidate.receipts[2], candidate.receipts[3]] = [candidate.receipts[3], candidate.receipts[2]]; },
  ]) {
    const candidate = structuredClone(proof);
    mutate(candidate);
    assert.throws(() => verifyB2FunctionDeploymentProof({
      proof: candidate,
      manifest,
      manifestSha256,
      postRows: deployedRows(8),
    }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
  }
});

test('protected batch refreshes provider inventory after every slug and persists the fourth timeout', async () => {
  let currentRows = deployedRows(0);
  let calls = 0;
  let reads = 0;
  let clock = Date.parse(AT);
  const persisted = [];

  await assert.rejects(executeB2FunctionDeploymentBatch({
    manifest,
    manifestSha256,
    beforeRows,
    now: () => new Date(clock += 1000).toISOString(),
    verifyFunction: functionName => ({
      result: 'FUNCTION_CONTRACT_VERIFIED',
      functions: [{ name: functionName }],
    }),
    deploy: async functionName => {
      calls += 1;
      currentRows = deployedRows(calls);
      return { exitCode: calls === 4 ? 1 : 0, functionName };
    },
    readRows: async () => {
      reads += 1;
      return currentRows;
    },
    recordAttempt: async proof => { persisted.push(structuredClone(proof)); },
    revalidate: ({ completedNames }) => {
      assert.deepEqual(completedNames, names.slice(0, calls === 4 ? 3 : calls));
    },
  }), { code: 'B2_FUNCTION_DEPLOYMENT_FAILED' });

  assert.equal(calls, 4);
  assert.equal(reads, 4);
  const final = persisted.at(-1);
  assert.deepEqual(final.receipts.map(row => row.name), names.slice(0, 3));
  assert.equal(final.in_flight.name, names[3]);
  assert.equal(final.in_flight.disposition, 'CHANGED_AFTER_FAILED_COMMAND');
  assert.equal(final.in_flight.observed.provider_package_sha256, digest(`after:${names[3]}`));
});

test('checkpoints dispatch intent before command and preserves it when provider readback fails', async () => {
  let reads = 0;
  const persisted = [];
  await assert.rejects(executeB2FunctionDeploymentBatch({
    manifest,
    manifestSha256,
    now: (() => {
      let clock = Date.parse(AT);
      return () => new Date(clock += 1000).toISOString();
    })(),
    verifyFunction: functionName => ({
      result: 'FUNCTION_CONTRACT_VERIFIED',
      functions: [{ name: functionName }],
    }),
    deploy: async () => ({ exitCode: 0 }),
    readRows: async () => {
      reads += 1;
      if (reads === 1) return beforeRows;
      throw new Error('synthetic readback failure');
    },
    recordAttempt: async proof => { persisted.push(structuredClone(proof)); },
    revalidate: () => {},
  }), { code: 'B2_FUNCTION_DEPLOYMENT_FAILED' });

  assert.equal(persisted[0].result, 'NOT_STARTED');
  assert.equal(persisted[1].result, 'INCOMPLETE');
  const final = persisted.at(-1);
  assert.equal(final.in_flight.name, names[0]);
  assert.equal(final.in_flight.disposition, 'DISPATCH_INTENT');
  assert.equal(final.in_flight.observed, null);
});

test('preserves a NOT_STARTED checkpoint when initial provider inventory fails', async () => {
  const persisted = [];
  await assert.rejects(executeB2FunctionDeploymentBatch({
    manifest,
    manifestSha256,
    now: () => AT,
    verifyFunction: () => assert.fail('must not verify a function before inventory'),
    deploy: () => assert.fail('must not deploy before inventory'),
    readRows: async () => { throw new Error('synthetic initial inventory failure'); },
    recordAttempt: async proof => { persisted.push(structuredClone(proof)); },
    revalidate: () => {},
  }), { code: 'B2_FUNCTION_DEPLOYMENT_FAILED' });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].result, 'NOT_STARTED');
  assert.deepEqual(persisted[0].receipts, []);
  assert.equal(persisted[0].in_flight, null);
});

test('resumes from the original partial proof without redeploying the indeterminate changed slug', async () => {
  let partial = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  for (let index = 0; index < 3; index += 1) {
    partial = recordTransition({
      proof: partial,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index + 1) * 1000)).toISOString(),
    });
  }
  partial = recordTransition({
    proof: partial,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(4),
    functionName: names[3],
    commandSucceeded: false,
    capturedAt: new Date(Date.parse(AT) + 4000).toISOString(),
  });

  let currentRows = deployedRows(4);
  let completed = 4;
  const deployed = [];
  let clock = Date.parse(AT) + 5000;
  const proof = await executeB2FunctionDeploymentBatch({
    manifest,
    manifestSha256,
    beforeRows,
    initialProof: partial,
    now: () => new Date(clock += 1000).toISOString(),
    verifyFunction: functionName => ({
      result: 'FUNCTION_CONTRACT_VERIFIED',
      functions: [{ name: functionName }],
    }),
    deploy: async functionName => {
      deployed.push(functionName);
      completed += 1;
      currentRows = deployedRows(completed);
      return { exitCode: 0 };
    },
    readRows: async () => currentRows,
    recordAttempt: async () => {},
    revalidate: () => {},
  });

  assert.deepEqual(deployed, names.slice(4));
  assert.equal(proof.result, 'FUNCTIONS_EXECUTED');
  assert.deepEqual(proof.receipts.map(row => row.name), names);
});

test('promotes a changed final in-flight slug to FUNCTIONS_EXECUTED', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  for (let index = 0; index < names.length - 1; index += 1) {
    proof = markB2FunctionDeploymentIntent({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      functionName: names[index],
      capturedAt: new Date(Date.parse(AT) + ((index * 2 + 1) * 1000)).toISOString(),
    });
    proof = reconcileB2FunctionDeploymentTransition({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index * 2 + 2) * 1000)).toISOString(),
    });
  }
  proof = markB2FunctionDeploymentIntent({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    functionName: names.at(-1),
    capturedAt: new Date(Date.parse(AT) + 15000).toISOString(),
  });
  proof = recordTransition({
    proof,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(8),
    functionName: names.at(-1),
    commandSucceeded: false,
    capturedAt: new Date(Date.parse(AT) + 16000).toISOString(),
  });
  const resumed = resumeB2FunctionDeploymentAttempt({
    proof,
    manifest,
    manifestSha256,
    currentRows: deployedRows(8),
    capturedAt: new Date(Date.parse(AT) + 17000).toISOString(),
  });
  assert.equal(resumed.result, 'FUNCTIONS_EXECUTED');
  assert.equal(resumed.receipts.length, 8);
  assert.equal(resumed.in_flight, null);
});

test('advances proof timestamps monotonically when the protected wall clock is frozen', async () => {
  let currentRows = beforeRows;
  const checkpoints = [];
  const result = await executeB2FunctionDeploymentBatch({
    manifest,
    manifestSha256,
    now: () => AT,
    verifyFunction: name => ({ result: 'FUNCTION_CONTRACT_VERIFIED', functions: [{ name }] }),
    deploy: async name => {
      currentRows = deployedRows(names.indexOf(name) + 1);
      return { exitCode: 0 };
    },
    readRows: async () => currentRows,
    recordAttempt: async proof => { checkpoints.push(structuredClone(proof)); },
    revalidate: () => {},
  });

  const timestamps = checkpoints.flatMap(proof => [
    proof.captured_at,
    ...proof.receipts.map(receipt => receipt.captured_at),
    ...(proof.in_flight ? [proof.in_flight.captured_at] : []),
  ]).map(value => Date.parse(value));
  assert.equal(result.result, 'FUNCTIONS_EXECUTED');
  assert.equal(result.receipts.length, 8);
  assert.ok(timestamps.every(Number.isFinite));
  assert.ok(new Set(timestamps).size > 1, 'proof clock must not reuse the frozen wall-clock millisecond');
  for (let index = 1; index < result.receipts.length; index += 1) {
    assert.ok(Date.parse(result.receipts[index].captured_at) > Date.parse(result.receipts[index - 1].captured_at));
  }
});

test('normal postcheck consumes the exact ordered eight-row provider proof', () => {
  let proof = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  for (let index = 0; index < names.length; index += 1) {
    proof = recordTransition({
      proof,
      manifest,
      manifestSha256,
      beforeRows,
      afterRows: deployedRows(index + 1),
      functionName: names[index],
      commandSucceeded: true,
      capturedAt: new Date(Date.parse(AT) + ((index + 1) * 1000)).toISOString(),
    });
  }
  const releaseManifest = {
    resources: {
      web_control_centers_b2_transition: { contract: { functions: manifest } },
    },
  };
  assert.deepEqual(verifyB2FunctionDeploymentPostcheck({
    manifest: releaseManifest,
    functionDeploymentProof: proof,
    postRows: deployedRows(8),
  }), { result: 'FUNCTION_DEPLOYMENT_PROOF_VERIFIED', count: 8 });

  const reordered = structuredClone(proof);
  [reordered.receipts[1], reordered.receipts[2]] = [reordered.receipts[2], reordered.receipts[1]];
  assert.throws(() => verifyB2FunctionDeploymentPostcheck({
    manifest: releaseManifest,
    functionDeploymentProof: reordered,
    postRows: deployedRows(8),
  }), { code: 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID' });
});

test('atomically replaces the same-directory deployment checkpoint without leftover temp files', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'b2-function-proof-'));
  t.after(() => rmSync(directory, { recursive: true, force: false }));
  const target = path.join(directory, 'function-deployment-proof.json');
  const initial = createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt: AT });
  const updated = recordTransition({
    proof: initial,
    manifest,
    manifestSha256,
    beforeRows,
    afterRows: deployedRows(1),
    functionName: names[0],
    commandSucceeded: true,
    capturedAt: new Date(Date.parse(AT) + 1000).toISOString(),
  });
  writeFunctionProofCheckpoint(target, initial);
  writeFunctionProofCheckpoint(target, updated);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), updated);
  assert.deepEqual(readdirSync(directory), ['function-deployment-proof.json']);
});
