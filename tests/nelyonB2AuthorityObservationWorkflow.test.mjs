import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { privateRuntimeClosureMemberPaths } from '../scripts/nelyon-private-runtime-closure.mjs';

const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8')
  .replace(/\r\n?/gu, '\n');

function job(name, next) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const end = next ? workflow.indexOf(`\n  ${next}:\n`, start + 1) : workflow.length;
  assert.notEqual(start, -1, `${name} job missing`);
  assert.ok(end > start, `${name} job boundary missing`);
  return workflow.slice(start, end);
}

function bootstrapMembers(source, plane) {
  const begin = source.indexOf(`// NELYON_AUTHORITY_${plane}_RUNTIME_BOOTSTRAP_BEGIN`);
  const end = source.indexOf(`// NELYON_AUTHORITY_${plane}_RUNTIME_BOOTSTRAP_END`, begin + 1);
  assert.ok(begin >= 0 && end > begin, `${plane} runtime bootstrap markers missing`);
  const bootstrap = source.slice(begin, end);
  const match = bootstrap.match(/const members = Object\.freeze\(\[([\s\S]*?)\n\s*\]\);/u);
  assert.ok(match, 'observer runtime member list missing');
  return match[1].trim().split(/\r?\n/u).map(line => {
    const item = line.match(/^\s*'([^']+)',\s*$/u);
    assert.ok(item, `unexpected observer runtime member syntax: ${line}`);
    return item[1];
  });
}

test('authority observation is a separate terminal workflow mode and skips the normal plan plane', () => {
  assert.match(workflow, /\n\s+- authority_observe\n/u);
  assert.match(workflow, /run-name:.*authority_observe/u);
  const plan = job('plan', 'private-authority-check');
  assert.match(plan, /inputs\.mode != 'authority_observe'[\s\S]*inputs\.mode != 'authority_issue'/u);
  const observer = job('authority-observation', 'authority-issue');
  assert.match(observer, /if:\s*\$\{\{ inputs\.mode == 'authority_observe' \}\}/u);
  assert.doesNotMatch(observer, /needs:\s*\[?plan/u);
});

test('authority issuance is an isolated terminal owner-dispatch path with protected concurrency and no deployment plane', () => {
  assert.match(workflow, /\n\s+- authority_issue\n/u);
  assert.match(workflow, /run-name:.*authority_issue.*inputs\.release_id/u);
  const issuer = job('authority-issue', 'plan');
  assert.match(issuer, /name:\s*Issue immutable B2 private authority/u);
  assert.match(issuer, /if:\s*\$\{\{ inputs\.mode == 'authority_issue' \}\}/u);
  assert.match(issuer, /environment:\s*production/u);
  assert.match(issuer, /group:\s*nelyon-supabase-production/u);
  assert.match(issuer, /cancel-in-progress:\s*false/u);
  assert.match(issuer, /contents:\s*read/u);
  assert.match(issuer, /actions:\s*read/u);
  assert.doesNotMatch(issuer, /contents:\s*write|deployments:\s*write|id-token:\s*write/u);
  assert.doesNotMatch(issuer, /supabase\s+(?:db push|migration|functions deploy)|wrangler\s+(?:deploy|versions?)|eas update/u);
  assert.doesNotMatch(issuer, /needs:\s*\[?plan/u);
});

test('authority issuer verifies closure before scoped credentials and retains only a one-day sanitized receipt', () => {
  const issuer = job('authority-issue', 'plan');
  const closureStart = issuer.indexOf('- name: Verify protected private runtime closure before issuance');
  const issueStart = issuer.indexOf('- name: Issue exact immutable B2 private authority');
  assert.ok(closureStart > 0 && issueStart > closureStart);
  const closure = issuer.slice(closureStart, issueStart);
  assert.match(closure, /NELYON_AUTHORITY_ISSUE_RUNTIME_BOOTSTRAP_BEGIN/u);
  assert.match(closure, /scripts\/nelyon-private-authority-issuer\.mjs/u);
  assert.deepEqual(bootstrapMembers(closure, 'ISSUE'), privateRuntimeClosureMemberPaths());
  assert.doesNotMatch(closure, /GITHUB_TOKEN|R2_ACCESS_KEY|R2_SECRET_ACCESS/u);
  const credentialScope = issuer.slice(issueStart);
  for (const name of ['GITHUB_TOKEN', 'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID',
    'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY']) assert.match(credentialScope, new RegExp(`${name}:`, 'u'));
  assert.match(credentialScope, /authority-issue[\s\S]*--observation-run[\s\S]*--observation-sha256[\s\S]*--release-id/u);
  assert.match(issuer, /INPUT_AUTHORITY_INTEGRATION_BASE_SHA[\s\S]*109395035d13ba3db8d338dc3b2524191defe873/u);
  assert.match(credentialScope, /NELYON_B2_DOCKER_BIN:\s*\/usr\/bin\/docker/u);
  assert.match(credentialScope, /realpathSync\(docker\) !== docker[\s\S]*stat\.uid !== 0[\s\S]*stat\.mode & 0o022/u);
  assert.match(issuer, /name:\s*nelyon-b2-authority-issuance-\$\{\{ github\.run_id \}\}/u);
  assert.match(issuer, /retention-days:\s*1/u);
  assert.match(issuer, /rm -rf "\$RUNNER_TEMP\/nelyon-b2-authority-issue"/u);
  assert.match(issuer, /if:\s*\$\{\{ always\(\) \}\}/u);
});

test('authority observation has the protected read-only environment and one scoped Supabase token', () => {
  const observer = job('authority-observation', 'authority-issue');
  assert.match(observer, /environment:\s*production/u);
  assert.match(observer, /group:\s*nelyon-supabase-production/u);
  assert.match(observer, /cancel-in-progress:\s*false/u);
  assert.match(observer, /contents:\s*read/u);
  assert.doesNotMatch(observer, /(?:actions|deployments|id-token|packages|pull-requests|statuses):/u);
  assert.doesNotMatch(observer, /contents:\s*write/u);
  assert.equal((observer.match(/SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/gu) ?? []).length, 1);
  for (const forbidden of [
    'CLOUDFLARE_', 'R2_', 'AWS_', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SERVICE_ROLE',
    'NELYON_PRIVATE_AUTHORITY_R2_', 'NELYON_PRIVATE_AUTHORITY_RECEIPT',
    'NELYON_PRIVATE_AUTHORITY_SIGNING', 'FINANCE_', 'WALLET_', 'LEDGER_',
    'supabase migration', 'supabase functions deploy', 'wrangler\\s+(?:deploy|versions?)', 'eas update',
    '\\bauthority-issue\\b', '\\bauthority-publish\\b',
  ]) assert.doesNotMatch(observer, new RegExp(forbidden, 'iu'));
});

test('authority observation verifies the independent protected runtime closure before receiving the Supabase token', () => {
  const observer = job('authority-observation', 'authority-issue');
  const closureStart = observer.indexOf('- name: Verify protected private runtime closure before observation');
  const captureStart = observer.indexOf('- name: Capture one sanitized B2 authority observation');
  const tokenStart = observer.indexOf('SUPABASE_ACCESS_TOKEN:');
  assert.ok(closureStart > 0, 'protected closure step missing');
  assert.ok(captureStart > closureStart, 'capture must follow the protected closure proof');
  assert.ok(tokenStart > captureStart, 'Supabase token must be scoped only after the protected closure proof');
  const closureStep = observer.slice(closureStart, captureStart);
  assert.match(closureStep, /NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256:\s*\$\{\{ vars\.NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256 \}\}/u);
  assert.match(closureStep, /NELYON_AUTHORITY_OBSERVE_RUNTIME_BOOTSTRAP_BEGIN/u);
  assert.match(closureStep, /scripts\/nelyon-b2-function-deployment-proof\.mjs/u);
  assert.match(closureStep, /scripts\/nelyon-production-snapshot-adapter\.mjs/u);
  assert.match(closureStep, /timingSafeEqual/u);
  assert.doesNotMatch(closureStep, /SUPABASE_ACCESS_TOKEN/u);
  assert.deepEqual(bootstrapMembers(closureStep, 'OBSERVE'), privateRuntimeClosureMemberPaths());
  assert.equal((observer.match(/NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256:\s*\$\{\{ vars\.NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256 \}\}/gu) ?? []).length, 1);
});

test('authority observation validates exact invocation before capture and retains only sanitized evidence', () => {
  const observer = job('authority-observation', 'authority-issue');
  assert.match(observer, /node-version:\s*'24\.21\.0'/u);
  assert.match(observer, /AUTHORITY_OBSERVE_READ_ONLY/u);
  assert.match(observer, /GITHUB_ACTOR/u);
  assert.match(observer, /GITHUB_TRIGGERING_ACTOR/u);
  assert.match(observer, /refs\/heads\/main/u);
  assert.match(observer, /authority-observe[\s\S]*--policy[\s\S]*--approved-sha[\s\S]*--approved-tree[\s\S]*--verification-output/u);
  assert.match(observer, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/u);
  assert.match(observer, /retention-days:\s*1/u);
  assert.match(observer, /if-no-files-found:\s*error/u);
  assert.match(observer, /if:\s*\$\{\{ always\(\) \}\}/u);
  assert.match(observer, /rm -rf "\$RUNNER_TEMP\/nelyon-b2-authority-observation"/u);
  assert.match(observer, /AUTHORITY_OBSERVATION_RESULTS/u);
});
