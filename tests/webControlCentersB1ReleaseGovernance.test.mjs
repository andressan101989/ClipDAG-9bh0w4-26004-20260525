import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const reviewedSourceSha = '94006f2e87edb960cbf457ab4313198aadf05c8c';
const policy = JSON.parse(readFileSync(path.join(root, '.github', 'nelyon-production-release-policy.json'), 'utf8'));

async function load(relative) {
  return import(`${pathToFileURL(path.join(root, relative)).href}?b1=${Date.now()}-${Math.random()}`);
}

function postState(transition) {
  return {
    schema_version: 1,
    complete: true,
    installed: true,
    relations: structuredClone(transition.catalog.relations),
    helpers: structuredClone(transition.catalog.helpers),
    rpc_identities: transition.rpc_attestations.map(item => item.identity),
    media_asset_links: structuredClone(transition.catalog.media_asset_links),
  };
}

test('B1 policy and compiler pin one exact migration with no Edge or config change', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const transition = policy.web_control_centers_b1_transition;
  assert.ok(transition, 'B1 transition missing');
  assert.deepEqual(compiler.WEB_CONTROL_CENTERS_B1_RELEASE_TRANSITION, transition);
  assert.equal(transition.migrations.length, 1);
  assert.equal(transition.migrations[0].path,
    'supabase/migrations/20261102065812_web_control_centers_b1_publication_drafts.sql');
  assert.deepEqual(transition.functions, []);
  assert.equal(transition.config_changed, false);
  assert.deepEqual(transition.productive_paths, [transition.migrations[0].path]);
  assert.match(transition.reviewed_source_sha, /^[0-9a-f]{40}$/);
  assert.equal(transition.reviewed_source_sha, reviewedSourceSha);
});

test('B1 policy rejects migration, RPC, ACL, RLS, policy, helper, Edge, config and finance drift', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const mutations = [
    value => { value.migrations[0].sha256 = '1'.repeat(64); },
    value => { value.rpc_attestations[0].definition_sha256 = '1'.repeat(64); },
    value => { value.rpc_attestations[0].acl = []; },
    value => { value.catalog.relations[0].force_rls = false; },
    value => { value.catalog.relations[0].acl.authenticated = true; },
    value => { value.catalog.media_asset_links.policies[0].qual = 'true'; },
    value => { value.catalog.helpers[0].definition_sha256 = '1'.repeat(64); },
    value => { value.functions = ['content-safety-scan']; },
    value => { value.config_changed = true; },
    value => { value.finance_policy.platform_fee_bps = 0; },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(policy);
    mutate(hostile.web_control_centers_b1_transition);
    assert.throws(() => compiler.validatePolicy(hostile),
      error => error?.code === 'INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION');
  }
});
test('B1 compiler accepts exact reviewed source provenance and rejects altered Git bytes', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const transition = policy.web_control_centers_b1_transition;
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const input = {
    cwd: root,
    policy,
    mode: 'plan_only',
    approvedSha: reviewedSourceSha,
    changes: [{ path: transition.migrations[0].path, status: 'A' }],
    migrations: [{ version: transition.migrations[0].version, path: transition.migrations[0].path }],
    affectedFunctions: [],
    runGit,
  };
  const result = compiler.attestWebControlCentersB1Transition(input);
  assert.equal(result.attestation.reviewed_source_sha, reviewedSourceSha);
  assert.equal(result.attestation.reviewed_bytes_verified, true);
  assert.equal(result.migrations[0].blob, transition.migrations[0].blob);
  assert.throws(() => compiler.attestWebControlCentersB1Transition({
    ...input,
    runGit: args => args[0] === 'show' ? Buffer.from('altered migration bytes\n') : runGit(args),
  }), error => error?.code === 'INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION');
});

test('B1 post-state validator binds relations, helpers, RPC identities and media link policy', async () => {
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  assert.equal(adapter.assertReadOnlySql(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL), true);
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL, /expected_functions\(identity\)/);
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL, /join expected_functions expected/);
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL, /where p\.prokind='f'/);
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL, /pg_catalog\.pg_get_functiondef\(p\.oid\)/);
  const transition = policy.web_control_centers_b1_transition;
  const state = postState(transition);
  assert.equal(adapter.validateWebControlCentersB1InstalledState(state, transition), true);
  for (const mutate of [
    value => { value.relations[0].force_rls = false; },
    value => { value.relations[0].acl.authenticated = true; },
    value => { value.helpers[0].definition_sha256 = '0'.repeat(64); },
    value => { value.helpers[0].search_path = ['search_path=public']; },
    value => { value.rpc_identities.pop(); },
    value => { value.media_asset_links.entity_type_constraint = 'CHECK (true)'; },
    value => { value.media_asset_links.policies[0].qual = 'true'; },
    value => { value.media_asset_links.indexes[0].unique = false; },
    value => { value.media_asset_links.triggers[0].definition_sha256 = '0'.repeat(64); },
  ]) {
    const hostile = structuredClone(state);
    mutate(hostile);
    assert.throws(
      () => adapter.validateWebControlCentersB1InstalledState(hostile, transition),
      error => error?.code === 'WEB_CONTROL_CENTERS_B1_POSTCHECK_FAILED',
    );
  }
});

test('B1 state transition requires an absent predecessor and exact installed successor', async () => {
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  const transition = policy.web_control_centers_b1_transition;
  const pre = {
    schema_version: 1, complete: true, installed: false,
    relations: [], helpers: [], rpc_identities: [],
    media_asset_links: structuredClone(transition.predecessor_media_asset_links),
  };
  assert.equal(adapter.validateWebControlCentersB1StateTransition(pre, postState(transition), transition), true);
  const hostile = structuredClone(pre);
  hostile.rpc_identities = ['public.publish_my_media_post_v1(uuid,text,text,text,uuid[])'];
  assert.throws(() => adapter.validateWebControlCentersB1StateTransition(hostile, postState(transition), transition),
    error => error?.code === 'WEB_CONTROL_CENTERS_B1_POSTCHECK_FAILED');
});

test('B1 Advisor exceptions are exact, unique and cover seven authenticated RPCs plus three private tables', () => {
  const transition = policy.web_control_centers_b1_transition;
  const additions = transition.security_advisor.introduced_exceptions;
  assert.equal(additions.length, 10);
  assert.equal(new Set(additions.map(item => item.advisor_fingerprint)).size, additions.length);
  assert.equal(additions.filter(item => Array.isArray(item.object.argument_types)).length, 7);
  assert.equal(additions.filter(item => item.advisor_type === 'table').length, 3);
  for (const item of additions) {
    assert.equal(item.origin.migration, '20261102065812_web_control_centers_b1_publication_drafts');
    assert.equal(item.origin.migration_blob, transition.migrations[0].blob);
    assert.equal(item.origin.source_sha, transition.reviewed_source_sha);
  }
});
