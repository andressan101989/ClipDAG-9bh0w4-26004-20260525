import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
  assert.equal((adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL.match(/as "table"/g) ?? []).length, 3);
  assert.doesNotMatch(adapter.WEB_CONTROL_CENTERS_B1_STATE_SQL, /\btable_name\b/);
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

test('B1 Advisor fingerprints match the provider function shape without a fabricated metadata type', async () => {
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  const transition = policy.web_control_centers_b1_transition;
  const rpcExceptions = new Map(transition.security_advisor.introduced_exceptions
    .filter(item => Array.isArray(item.object.argument_types))
    .map(item => [item.object.name, item]));
  assert.equal(rpcExceptions.size, 7);
  for (const rpc of transition.rpc_attestations) {
    const name = rpc.identity.slice(rpc.identity.indexOf('.') + 1, rpc.identity.indexOf('('));
    const lint = {
      name: 'authenticated_security_definer_function_executable',
      level: 'WARN',
      facing: 'EXTERNAL',
      categories: ['SECURITY'],
      metadata: {
        schema: 'public',
        name,
        arguments: rpc.identity_arguments,
        language: 'plpgsql',
        security_definer: true,
      },
    };
    const normalized = adapter.normalizeSecurityAdvisors({ lints: [lint] }).items[0];
    assert.equal(normalized.fingerprint, rpc.advisor_fingerprint);
    assert.equal(normalized.fingerprint, rpcExceptions.get(name).advisor_fingerprint);
    const fabricated = adapter.normalizeSecurityAdvisors({
      lints: [{ ...lint, metadata: { ...lint.metadata, type: 'function' } }],
    }).items[0];
    assert.notEqual(fabricated.fingerprint, normalized.fingerprint);
  }
});

test('B1 recovery selector accepts only the exact zero-resource source and one migration append', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  const controlled = structuredClone(policy);
  const source = controlled.postcheck_recovery.approved_sources
    .find(item => item.run_id === '41416609819');
  assert.ok(source);
  assert.equal(compiler.validateRecoverySource(source), true);
  const baselineItem = { version: '20261101181907', name: 'superuser_qa_perf_c1' };
  const b1Item = { version: '20261102065812', name: 'web_control_centers_b1_publication_drafts' };
  controlled.baseline.migration_count = 1;
  controlled.baseline.latest_migration = `${baselineItem.version}_${baselineItem.name}`;
  controlled.baseline.evidence_digests.migrations = compiler.sha256Hex(
    compiler.canonicalJson([`${baselineItem.version}_${baselineItem.name}`]),
  );
  source.expected_migration_count = 2;
  const items = [baselineItem, b1Item];
  const migrations = {
    complete: true,
    count: items.length,
    items,
    latest: b1Item,
    sha256: compiler.sha256Hex(compiler.canonicalJson(items)),
  };
  const request = {
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: '41416609819',
  };
  const manifest = {
    identity: { mode: 'postcheck_recovery' },
    resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] },
  };
  const requirement = adapter.webControlCentersB1StateRequirement(
    controlled, manifest, 'recovery', { request, migrations },
  );
  assert.equal(requirement.required, true);
  assert.equal(requirement.installed, true);
  assert.equal(requirement.recovery.run_id, '41416609819');
  for (const mutate of [
    value => { value.request.recoverySourceRunId = '41416609818'; },
    value => { value.request.scopeConfirmation = 'RELEASE_HIGH_RISK'; },
    value => { value.manifest.resources.migrations.push({ path: 'forbidden.sql' }); },
    value => { value.migrations.items.push(structuredClone(b1Item)); value.migrations.count += 1;
      value.migrations.latest = structuredClone(b1Item);
      value.migrations.sha256 = compiler.sha256Hex(compiler.canonicalJson(value.migrations.items)); },
  ]) {
    const hostile = { request: structuredClone(request), manifest: structuredClone(manifest),
      migrations: structuredClone(migrations) };
    mutate(hostile);
    assert.throws(() => adapter.webControlCentersB1StateRequirement(
      controlled, hostile.manifest, 'recovery', {
        request: hostile.request,
        migrations: hostile.migrations,
      },
    ), /WEB_CONTROL_CENTERS_B1_POSTCHECK_FAILED|INVALID_REMOTE_INVENTORY/);
  }
});
