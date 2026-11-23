import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const workflowUrl = new URL('../.github/workflows/nelyon-b2-oci-authority-validation.yml', import.meta.url);
const source = fs.readFileSync(workflowUrl, 'utf8');
const workflow = YAML.parse(source, { maxAliasCount: 100 });
const jobs = workflow.jobs;

const expectedPaths = [
  '.github/workflows/nelyon-b2-oci-authority-validation.yml',
  'scripts/nelyon-b2-authority-preparation.mjs',
  'scripts/prove-web-control-centers-b2-disposable.mjs',
  'scripts/prove-web-control-centers-b2-pg-cron-disposable.mjs',
  'tests/nelyonB2AuthorityEvidenceProof.test.mjs',
  'tests/nelyonB2AuthorityPreparation.test.mjs',
  'tests/nelyonB2OciAuthorityValidationWorkflow.test.mjs',
];

const step = (job, name) => {
  const found = job.steps.find(candidate => candidate.name === name);
  assert.ok(found, `missing step: ${name}`);
  return found;
};

test('workflow is PR-only, scoped to the corrective, and read-only', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.deepEqual(workflow.on.pull_request.paths, expectedPaths);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(jobs), ['docker-oci-index-proof', 'docker-image-config-pg-cron-proof']);

  const serialized = JSON.stringify(workflow);
  for (const forbidden of [
    /pull_request_target/u,
    /workflow_dispatch/u,
    /\bpush\b/u,
    /\bschedule\b/u,
    /environment/u,
    /secrets\./u,
    /upload-artifact/u,
    /supabase/u,
    /wrangler/u,
    /authority[_ -]?issue/iu,
    /\bdeploy(?:ment)?\b/iu,
    /\bR2\b/u,
  ]) assert.doesNotMatch(serialized, forbidden);
});

test('each job is independent, pinned to the exact PR head, and uses minimal permissions', () => {
  for (const job of Object.values(jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.deepEqual(job.permissions, { contents: 'read' });
    assert.equal(job.needs, undefined);
    assert.equal(job.environment, undefined);

    const checkout = job.steps.find(candidate => String(candidate.uses ?? '').startsWith('actions/checkout@'));
    const setupNode = job.steps.find(candidate => String(candidate.uses ?? '').startsWith('actions/setup-node@'));
    assert.equal(checkout.uses, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    assert.deepEqual(checkout.with, {
      ref: '${{ github.event.pull_request.head.sha }}',
      'persist-credentials': false,
    });
    assert.equal(setupNode.uses, 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1');
    assert.deepEqual(setupNode.with, { 'node-version': '24.21.0' });
    for (const action of job.steps.filter(candidate => candidate.uses)) {
      assert.match(action.uses, /^[^@]+@[a-f0-9]{40}$/u);
    }

    const head = step(job, 'Verify exact PR head');
    assert.equal(head.shell, 'bash');
    assert.equal(head.env.EXPECTED_SHA, '${{ github.event.pull_request.head.sha }}');
    assert.match(head.run, /git rev-parse HEAD/u);
    assert.match(head.run, /EXPECTED_SHA/u);

    const docker = step(job, 'Verify Docker engine');
    assert.match(docker.run, /mode="\$\(stat -c '%a' \/usr\/bin\/docker\)"/u);
    assert.match(docker.run, /8#\$mode & 8#022/u);
  }
});

test('OCI index proof runs the canonical real-Docker catalog proof and negative contracts', () => {
  const job = jobs['docker-oci-index-proof'];
  const proof = step(job, 'Run real Docker OCI index proof');
  assert.deepEqual(proof.env, {
    CI: 'true',
    NO_COLOR: '1',
    NELYON_B2_DOCKER_BIN: '/usr/bin/docker',
    NELYON_B2_REVIEWED_PROOF: '1',
  });
  assert.match(proof.run, /set -euo pipefail/u);
  assert.match(proof.run, /node scripts\/prove-web-control-centers-b2-disposable\.mjs --authority-evidence/u);
  assert.match(proof.run, /B2_POSTGRES_CATALOG_CAPABILITY/u);
  assert.match(proof.run, /grep -Fq/u);
  assert.match(proof.run, /\btee\b/u);
  assert.match(proof.run, /\btrap\b/u);

  const negative = step(job, 'Run fail-closed identity regressions');
  assert.equal(negative.run, 'node --test tests/nelyonB2AuthorityPreparation.test.mjs tests/nelyonB2AuthorityEvidenceProof.test.mjs');
});
test('image config proof runs the canonical real-Docker pg_cron proof and negative contracts', () => {
  const job = jobs['docker-image-config-pg-cron-proof'];
  const proof = step(job, 'Run real Docker image config and pg_cron proof');
  assert.deepEqual(proof.env, {
    CI: 'true',
    NO_COLOR: '1',
    NELYON_B2_DOCKER_BIN: '/usr/bin/docker',
    NELYON_B2_REVIEWED_PROOF: '1',
  });
  assert.match(proof.run, /set -euo pipefail/u);
  assert.match(proof.run, /node scripts\/prove-web-control-centers-b2-pg-cron-disposable\.mjs --authority-evidence/u);
  assert.match(proof.run, /B2_REAL_PG_CRON_CAPABILITY/u);
  assert.match(proof.run, /grep -Fq/u);
  assert.match(proof.run, /\btee\b/u);
  assert.match(proof.run, /\btrap\b/u);

  const negative = step(job, 'Run fail-closed identity regressions');
  assert.equal(negative.run, 'node --test tests/nelyonB2AuthorityPreparation.test.mjs tests/nelyonB2AuthorityEvidenceProof.test.mjs');
});
