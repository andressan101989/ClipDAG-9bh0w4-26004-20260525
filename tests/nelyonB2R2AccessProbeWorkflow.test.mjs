import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const workflowText = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
const workflow = YAML.parse(workflowText);
const jobs = workflow.jobs;

function step(job, name) {
  const matches = job.steps.filter(candidate => candidate.name === name);
  assert.equal(matches.length, 1, `exactly one ${name} step`);
  return matches[0];
}

test('manual R2 access mode activates only the protected read-only probe job', () => {
  const modes = workflow.on.workflow_dispatch.inputs.mode.options;
  assert.equal(modes.includes('r2_access_probe'), true);
  assert.match(workflow['run-name'], /Nelyon R2 runtime access probe/u);
  const probe = jobs['r2-runtime-access-probe'];
  assert.equal(probe.if, "${{ inputs.mode == 'r2_access_probe' }}");
  assert.equal(probe.environment, 'production');
  assert.equal(probe['runs-on'], 'ubuntu-24.04');
  assert.deepEqual(probe.permissions, { contents: 'read' });
  assert.deepEqual(probe.concurrency, { group: 'nelyon-supabase-production', 'cancel-in-progress': false });
  assert.match(jobs.plan.if, /inputs\.mode != 'r2_access_probe'/u);
  assert.deepEqual(jobs['private-authority-check'].needs, 'plan');
  assert.deepEqual(jobs.deploy.needs, ['plan', 'private-authority-check']);
  assert.deepEqual(jobs['snapshot-diagnostic'].needs, ['plan', 'private-authority-check']);
  assert.equal(jobs['authority-observation'].if, "${{ inputs.mode == 'authority_observe' }}");
  assert.equal(jobs['authority-issue'].if, "${{ inputs.mode == 'authority_issue' }}");
});

test('probe validates exact owner/main/scope identity and maps secrets only to one terminal HEAD step', () => {
  const probe = jobs['r2-runtime-access-probe'];
  const identity = step(probe, 'Validate exact read-only R2 runtime probe invocation');
  const identityText = `${identity.run}\n${JSON.stringify(identity.env)}`;
  for (const evidence of [
    'R2_RUNTIME_ACCESS_READ_ONLY',
    'refs/heads/main',
    'andressan101989',
    'GITHUB_TRIGGERING_ACTOR',
    'OBSERVED_WORKFLOW_REF',
    'GITHUB_RUN_ATTEMPT',
    'INPUT_APPROVED_SHA',
    'INPUT_RELEASE_ID',
    'INPUT_PREFLIGHT_ONLY',
    'INPUT_RECOVERY_SOURCE_RUN_ID',
    'INPUT_AUTHORITY_OBSERVATION_RUN_ID',
    'INPUT_AUTHORITY_OBSERVATION_SHA256',
    'INPUT_AUTHORITY_INTEGRATION_BASE_SHA',
  ]) assert.match(identityText, new RegExp(evidence, 'u'));

  const execution = step(probe, 'Verify protected R2 runtime access');
  assert.match(execution.run, /nelyon-private-authority-cli\.mjs r2-access-probe/u);
  assert.match(execution.run, /--approved-sha/u);
  assert.match(execution.run, /--approved-tree/u);
  assert.match(execution.run, /--verification-output/u);
  const secretNames = [
    'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID',
    'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY',
  ];
  for (const name of secretNames) {
    assert.match(String(execution.env[name]), /^\$\{\{ secrets\./u);
    const occurrences = probe.steps.filter(candidate => Object.hasOwn(candidate.env ?? {}, name));
    assert.deepEqual(occurrences, [execution]);
  }
  const probeText = JSON.stringify(probe);
  assert.doesNotMatch(probeText,
    /SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|NELYON_PRIVATE_AUTHORITY_SHA256|NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256/u);
  assert.doesNotMatch(execution.run, /\b(?:PUT|DELETE|GET)\b|authority-issue|authority-proof|release HIGH/iu);
});

test('probe installs before secrets, uploads only the sanitized one-day receipt, and always cleans scratch', () => {
  const probe = jobs['r2-runtime-access-probe'];
  const installIndex = probe.steps.findIndex(candidate => candidate.name === 'Install exact R2 signer without scripts');
  const executeIndex = probe.steps.findIndex(candidate => candidate.name === 'Verify protected R2 runtime access');
  const uploadIndex = probe.steps.findIndex(candidate => candidate.name === 'Upload sanitized R2 runtime access receipt');
  const cleanupIndex = probe.steps.findIndex(candidate => candidate.name === 'Clean R2 runtime access scratch');
  assert.ok(installIndex >= 0 && executeIndex > installIndex && uploadIndex > executeIndex && cleanupIndex > uploadIndex);
  assert.match(probe.steps[installIndex].run, /npm ci --ignore-scripts/u);
  const upload = probe.steps[uploadIndex];
  assert.equal(upload.with['retention-days'], 1);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.match(upload.with.path, /r2-runtime-access\.json/u);
  assert.doesNotMatch(upload.with.path, /authority|secret|credential/iu);
  assert.equal(probe.steps[cleanupIndex].if, '${{ always() }}');
});
