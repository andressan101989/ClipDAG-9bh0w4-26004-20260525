import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildAdminSourceManifest,
  canonicalJson,
  identifyUploadedVersion,
  parseActiveDeployment,
  verifyProductionHttpMatrix,
  verifyRouteInventory,
  verifyUploadedVersionIdentity,
} from '../scripts/nelyon-admin-production-release.mjs';

function fixtureReleaseManifest({ mode = 'release', files = [] } = {}) {
  return {
    identity: {
      approved_sha: 'a'.repeat(40),
      mode,
      release_id: 'nelyon-20261031-admin',
      run_id: '123',
      run_attempt: 1,
    },
    delta: {
      files: files.map((path) => ({ path, status: 'M', file_type: 'source' })),
      productive_change_count: 0,
    },
  };
}

test('Admin source manifest is exact, immutable, and enabled only by Admin deployment inputs', () => {
  const files = new Map([
    ['apps/admin-web/package.json', Buffer.from('{"name":"admin"}\n')],
    ['apps/admin-web/deployment/wrangler.preview.jsonc', Buffer.from('{"name":"nelyon-admin-web"}\n')],
    ['shared/web-deployment/buildPublicSupabaseSpa.mjs', Buffer.from('export {};\n')],
  ]);
  const readTrackedFiles = () => [...files].map(([path, bytes]) => ({ path, bytes }));
  const manifest = buildAdminSourceManifest({
    approvedSha: 'a'.repeat(40),
    releaseManifest: fixtureReleaseManifest({ files: ['apps/admin-web/src/App.tsx'] }),
    readTrackedFiles,
  });

  assert.equal(manifest.enabled, true);
  assert.equal(manifest.worker.name, 'nelyon-admin-web');
  assert.equal(manifest.worker.wrangler_version, '4.135.0');
  assert.deepEqual(manifest.worker.routes, ['nelyon.app/admin', 'nelyon.app/admin/*']);
  assert.equal(manifest.release.approved_sha, 'a'.repeat(40));
  assert.equal(manifest.source.files.length, 3);
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(canonicalJson(JSON.parse(canonicalJson(manifest))), canonicalJson(manifest));

  const unrelated = buildAdminSourceManifest({
    approvedSha: 'a'.repeat(40),
    releaseManifest: fixtureReleaseManifest({ files: ['docs/readme.md'] }),
    readTrackedFiles,
  });
  assert.equal(unrelated.enabled, false);
});

test('Admin source manifest rejects SHA mismatch and untracked or unsafe source entries', () => {
  assert.throws(() => buildAdminSourceManifest({
    approvedSha: 'b'.repeat(40),
    releaseManifest: fixtureReleaseManifest({ files: ['apps/admin-web/src/App.tsx'] }),
    readTrackedFiles: () => [],
  }), /admin_approved_sha_mismatch/);
  assert.throws(() => buildAdminSourceManifest({
    approvedSha: 'a'.repeat(40),
    releaseManifest: fixtureReleaseManifest({ files: ['apps/admin-web/src/App.tsx'] }),
    readTrackedFiles: () => [{ path: '../escape', bytes: Buffer.from('x') }],
  }), /admin_source_path_invalid/);
});

test('repository Admin manifest covers the workflow, orchestrator, lockfile, Worker, and shared builder', () => {
  const manifest = buildAdminSourceManifest({
    approvedSha: 'a'.repeat(40),
    releaseManifest: fixtureReleaseManifest({ files: ['apps/admin-web/src/App.tsx'] }),
  });
  const paths = new Set(manifest.source.files.map((item) => item.path));
  for (const path of [
    '.github/workflows/nelyon-production-release.yml',
    'scripts/nelyon-admin-production-release.mjs',
    'apps/admin-web/package-lock.json',
    'apps/admin-web/deployment/worker.mjs',
    'apps/admin-web/deployment/wrangler.preview.jsonc',
    'apps/admin-web/deployment/wrangler.route.jsonc',
    'shared/web-deployment/buildPublicSupabaseSpa.mjs',
  ]) assert.equal(paths.has(path), true, path);
});

test('uploaded version is selected by unique immutable tag and exact new UUID', () => {
  const prior = [{ id: '11111111-1111-4111-8111-111111111111', annotations: { 'workers/tag': 'old' } }];
  const candidate = {
    id: '22222222-2222-4222-8222-222222222222',
    annotations: {
      'workers/tag': 'nelyon-admin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'workers/message': 'nelyon release 123 attempt 1',
    },
  };
  assert.deepEqual(identifyUploadedVersion({
    before: prior,
    after: [...prior, candidate],
    expectedTag: candidate.annotations['workers/tag'],
  }), candidate);
  assert.throws(() => identifyUploadedVersion({
    before: prior,
    after: [...prior, candidate, { ...candidate, id: '33333333-3333-4333-8333-333333333333' }],
    expectedTag: candidate.annotations['workers/tag'],
  }), /admin_uploaded_version_not_unique/);
});

test('uploaded version identity binds the Cloudflare version to the exact reproducible build', () => {
  const versionId = '22222222-2222-4222-8222-222222222222';
  const versionTag = 'nelyon-admin-123-1';
  const buildSha256 = 'b'.repeat(64);
  assert.equal(verifyUploadedVersionIdentity({
    versionView: {
      id: versionId,
      annotations: { 'workers/tag': versionTag, 'workers/message': `b:${buildSha256}` },
    },
    versionId,
    versionTag,
    buildSha256,
  }), true);
  assert.throws(() => verifyUploadedVersionIdentity({
    versionView: {
      id: versionId,
      annotations: { 'workers/tag': versionTag, 'workers/message': `b:${'c'.repeat(64)}` },
    },
    versionId,
    versionTag,
    buildSha256,
  }), /admin_uploaded_build_identity_mismatch/);
});

test('active deployment must be one exact version at 100 percent', () => {
  const version = '22222222-2222-4222-8222-222222222222';
  assert.equal(parseActiveDeployment({
    versions: [{ version_id: version, percentage: 100 }],
  }), version);
  assert.throws(() => parseActiveDeployment({
    versions: [{ version_id: version, percentage: 50 }, { version_id: '33333333-3333-4333-8333-333333333333', percentage: 50 }],
  }), /admin_active_deployment_not_atomic/);
});

test('route inventory requires both exact Admin patterns and rejects conflicting ownership', () => {
  const routes = [
    { id: 'one', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' },
    { id: 'two', pattern: 'nelyon.app/admin/*', script: 'nelyon-admin-web' },
  ];
  assert.deepEqual(verifyRouteInventory(routes), routes);
  assert.throws(() => verifyRouteInventory([{ ...routes[0], script: 'another-worker' }, routes[1]]), /admin_route_owner_mismatch/);
  assert.throws(() => verifyRouteInventory([routes[0]]), /admin_route_inventory_mismatch/);
});

test('production HTTP matrix proves redirect, SPA documents, security headers, and a real 404 asset', () => {
  const matrix = {
    '/admin': { status: 308, location: 'https://nelyon.app/admin/', headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
    '/admin/': { status: 200, content_type: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
    '/admin/system': { status: 200, content_type: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
    '/admin/__nelyon_missing_asset__.js': { status: 404, content_type: 'text/plain; charset=UTF-8', headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
  };
  assert.equal(verifyProductionHttpMatrix(matrix), true);
  assert.throws(() => verifyProductionHttpMatrix({ ...matrix, '/admin/system': { ...matrix['/admin/system'], status: 404 } }), /admin_http_matrix_mismatch/);
  assert.throws(() => verifyProductionHttpMatrix({
    ...matrix,
    '/admin': { ...matrix['/admin'], location: 'https://attacker.example/admin/' },
  }), /admin_http_matrix_mismatch/);
});

test('canonical workflow exposes Admin plan but mutates Cloudflare only after HIGH gate and Supabase postcheck', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Create immutable Admin Web manifest/);
  assert.match(workflow, /Verify immutable Admin Web manifest/);
  assert.match(workflow, /admin_enabled/);
  assert.match(workflow, /admin_enabled != 'true' \|\| needs\.plan\.outputs\.risk == 'HIGH'/);
  assert.match(workflow, /needs\.plan\.outputs\.mode == 'release'/);
  assert.match(workflow, /steps\.postcheck\.outcome == 'success'/);
  assert.match(workflow, /versions upload/);
  assert.match(workflow, /--message "b:\$\{BUILD_DIGEST\}"/);
  assert.match(workflow, /--build-manifest admin-evidence\/admin-web-build\.json/);
  assert.match(workflow, /versions deploy/);
  assert.match(workflow, /triggers deploy/);
  assert.match(workflow, /Verify exact Admin production version, routes, and HTTP matrix/);
  assert.match(workflow, /Recover previous Admin production version and routes/);
  assert.doesNotMatch(workflow, /wrangler@4\.135\.0 deploy(?:\s|\\)/);
  assert.ok(
    workflow.indexOf('- name: Upload one immutable Admin version')
      > workflow.indexOf('- name: Require postcheck before release success'),
    'Admin upload must remain after the canonical Supabase postcheck',
  );

  const gateProofSection = workflow.slice(
    workflow.indexOf('- name: Verify gate proof without deployment secrets'),
    workflow.indexOf('- name: Verify postcheck recovery gate without deployment commands'),
  );
  assert.doesNotMatch(gateProofSection, /CLOUDFLARE_API_TOKEN|versions upload|versions deploy|triggers deploy/);
});

test('workflow pins exact routes, version tag, immutable upload, exact promotion, and recovery evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  const orchestrator = readFileSync(new URL('../scripts/nelyon-admin-production-release.mjs', import.meta.url), 'utf8');
  const contract = `${workflow}\n${orchestrator}`;
  for (const value of [
    'nelyon.app/admin',
    'nelyon.app/admin/*',
    'CLOUDFLARE_API_TOKEN',
    'admin-web-manifest.json',
    'admin-web-build.json',
    'admin-web-before-deployment.json',
    'admin-web-candidate.json',
    'admin-web-production-http.json',
    'admin-web-recovery.json',
  ]) assert.match(contract, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
