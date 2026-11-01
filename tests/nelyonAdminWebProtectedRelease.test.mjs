import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildAdminPreviewLifecycleRequest,
  buildAdminCachePurgeRequest,
  buildAdminRouteProbePath,
  buildAdminSourceManifest,
  canonicalJson,
  identifyUploadedVersion,
  parseActiveDeployment,
  verifyProductionHttpMatrix,
  verifyAdminRouteProbe,
  verifyAdminPreviewLifecycleState,
  verifyRecoveredRouteInventory,
  verifyRemoteBuildArtifacts,
  verifyRouteInventory,
  verifyUploadedVersionIdentity,
} from '../scripts/nelyon-admin-production-release.mjs';

function fixtureReleaseManifest({ mode = 'release', files = [], recoverySourceRunId = null } = {}) {
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
    ...(recoverySourceRunId ? {
      recovery: {
        kind: 'admin_cloudflare_forward_completion',
        source_run_id: recoverySourceRunId,
      },
    } : {}),
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

test('Admin recovery always rebuilds the exact source SHA with a source-run-bound unique tag', () => {
  const sourceRunId = '987654321';
  const manifest = buildAdminSourceManifest({
    approvedSha: 'a'.repeat(40),
    releaseManifest: fixtureReleaseManifest({
      mode: 'admin_recovery',
      recoverySourceRunId: sourceRunId,
    }),
  });
  assert.equal(manifest.enabled, true);
  assert.equal(manifest.release.mode, 'admin_recovery');
  assert.equal(manifest.release.recovery_source_run_id, sourceRunId);
  assert.equal(manifest.release.changed_admin_paths.length, 0);
  assert.equal(manifest.worker.version_tag, `nelyon-admin-recovery-${sourceRunId}-123-1`);
  assert.equal(manifest.worker.preview_alias, `admin-recovery-${sourceRunId}-123-1`);

  for (const recovery of [undefined, { kind: 'wrong', source_run_id: sourceRunId }, {
    kind: 'admin_cloudflare_forward_completion', source_run_id: '0',
  }]) {
    const releaseManifest = fixtureReleaseManifest({ mode: 'admin_recovery' });
    if (recovery !== undefined) releaseManifest.recovery = recovery;
    assert.throws(() => buildAdminSourceManifest({
      approvedSha: 'a'.repeat(40), releaseManifest,
    }), /admin_recovery_identity_invalid/);
  }
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
    'shared/web-media/package.json',
    'shared/adsOperationalTruth.ts',
    'shared/adsErrorPresentation.ts',
    'assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png',
  ]) assert.equal(paths.has(path), true, path);
});

test('every repository input imported by the Admin bundle activates its protected deployment', () => {
  for (const path of [
    'shared/web-media/src/BrowserVideoPreview.tsx',
    'shared/adsOperationalTruth.ts',
    'shared/adsErrorPresentation.ts',
    'assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png',
  ]) {
    const manifest = buildAdminSourceManifest({
      approvedSha: 'a'.repeat(40),
      releaseManifest: fixtureReleaseManifest({ files: [path] }),
    });
    assert.equal(manifest.enabled, true, path);
    assert.deepEqual(manifest.release.changed_admin_paths, [path], path);
  }
});

test('release authority files are hash-attested without triggering an unrelated Admin deployment', () => {
  for (const path of [
    '.github/workflows/nelyon-production-release.yml',
    'scripts/nelyon-admin-production-release.mjs',
  ]) {
    const manifest = buildAdminSourceManifest({
      approvedSha: 'a'.repeat(40),
      releaseManifest: fixtureReleaseManifest({ files: [path] }),
    });
    assert.equal(manifest.enabled, false, path);
    assert.deepEqual(manifest.release.changed_admin_paths, [], path);
    assert.equal(manifest.source.files.some((item) => item.path === path), true, path);
  }
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

test('temporary Admin workers.dev and Version URL lifecycle is exact and fail-closed', () => {
  assert.deepEqual(buildAdminPreviewLifecycleRequest({ enabled: true, previewsEnabled: true }), {
    method: 'POST',
    path: '/accounts/24a176456cf57435119db8caf3af61dd/workers/scripts/nelyon-admin-web/subdomain',
    json: { enabled: true, previews_enabled: true },
  });
  assert.deepEqual(buildAdminPreviewLifecycleRequest({ enabled: false, previewsEnabled: false }), {
    method: 'POST',
    path: '/accounts/24a176456cf57435119db8caf3af61dd/workers/scripts/nelyon-admin-web/subdomain',
    json: { enabled: false, previews_enabled: false },
  });
  assert.throws(() => buildAdminPreviewLifecycleRequest({
    enabled: true, previewsEnabled: false,
  }), /admin_preview_lifecycle_invalid/);
  assert.deepEqual(verifyAdminPreviewLifecycleState(
    { enabled: false, previews_enabled: false },
    { enabled: false, previewsEnabled: false },
  ), { enabled: false, previews_enabled: false });
  for (const hostile of [
    { enabled: true, previews_enabled: false },
    { enabled: false, previews_enabled: true },
    { enabled: false },
    { enabled: 'false', previews_enabled: false },
  ]) assert.throws(() => verifyAdminPreviewLifecycleState(hostile, {
    enabled: false, previewsEnabled: false,
  }), /admin_preview_lifecycle_mismatch/);
});

test('route inventory requires both exact Admin patterns and rejects conflicting ownership', () => {
  const routes = [
    { id: 'one', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' },
    { id: 'two', pattern: 'nelyon.app/admin/*', script: 'nelyon-admin-web' },
  ];
  assert.deepEqual(verifyRouteInventory(routes), routes);
  assert.throws(() => verifyRouteInventory([{ ...routes[0], script: 'another-worker' }, routes[1]]), /admin_route_owner_mismatch/);
  assert.throws(() => verifyRouteInventory([routes[0]]), /admin_route_inventory_mismatch/);
  assert.throws(() => verifyRouteInventory([
    ...routes,
    { id: 'three', pattern: 'nelyon.app/*', script: 'nelyon-admin-web' },
  ]), /admin_route_scope_drift/);
});

test('route recovery proves the exact prior Admin scope and rejects added routes', () => {
  const before = {
    zone_id: 'zone-1',
    routes: [{ id: 'before', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }],
  };
  const after = {
    zone_id: 'zone-1',
    routes: [{ id: 'after', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }],
  };
  assert.equal(verifyRecoveredRouteInventory({ before, after }), true);
  assert.throws(() => verifyRecoveredRouteInventory({
    before,
    after: {
      ...after,
      routes: [...after.routes, { id: 'extra', pattern: 'nelyon.app/rogue', script: 'nelyon-admin-web' }],
    },
  }), /admin_route_scope_drift/);
  assert.throws(() => verifyRecoveredRouteInventory({ before, after: { ...after, routes: [] } }), /admin_route_recovery_mismatch/);
  assert.throws(() => verifyRecoveredRouteInventory({ before, after: { ...after, zone_id: 'zone-2' } }), /admin_route_recovery_mismatch/);
});

test('Admin cache invalidation is restricted to the exact production Admin prefix', () => {
  const zoneId = 'a'.repeat(32);
  assert.deepEqual(buildAdminCachePurgeRequest(zoneId), {
    path: `/zones/${zoneId}/purge_cache`,
    method: 'POST',
    json: { prefixes: ['nelyon.app/admin'] },
  });
  for (const invalid of ['', 'zone-1', '../escape', 'b'.repeat(33)]) {
    assert.throws(() => buildAdminCachePurgeRequest(invalid), /admin_cloudflare_zone_invalid/);
  }
});

test('Admin route propagation probe uses one candidate-bound cache key per bounded attempt', () => {
  const versionId = '557fc06c-8267-4362-928d-d21048279966';
  const buildManifest = {
    dist_sha256: 'd'.repeat(64),
    files: [{ path: 'index.html', bytes: 5, sha256: 'c'.repeat(64) }],
  };
  const candidate = { version_id: versionId, build_sha256: buildManifest.dist_sha256 };
  const headers = {
    'cache-control': 'no-store, no-transform',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-robots-tag': 'noindex, nofollow',
  };
  const probe = {
    attempt: 7,
    url_path: `/admin/__nelyon_release_probe__/${versionId}/7`,
    status: 200,
    content_type: 'text/html; charset=utf-8',
    headers,
    body_sha256: 'c'.repeat(64),
    bytes: 5,
  };

  assert.equal(buildAdminRouteProbePath(versionId, 7), probe.url_path);
  assert.notEqual(buildAdminRouteProbePath(versionId, 1), buildAdminRouteProbePath(versionId, 2));
  assert.equal(verifyAdminRouteProbe({ candidate, buildManifest, probe }), true);
  for (const [invalidVersion, invalidAttempt] of [
    ['../candidate', 1],
    [versionId, 0],
    [versionId, 61],
    [versionId, 1.5],
  ]) {
    assert.throws(() => buildAdminRouteProbePath(invalidVersion, invalidAttempt), /admin_route_probe_invalid/);
  }
  for (const mutated of [
    { ...probe, url_path: '/admin/' },
    { ...probe, status: 404 },
    { ...probe, content_type: 'application/json' },
    { ...probe, body_sha256: 'e'.repeat(64) },
    { ...probe, bytes: 4 },
    { ...probe, headers: { ...headers, 'cache-control': 'no-store' } },
    { ...probe, headers: { ...headers, 'x-frame-options': null } },
  ]) {
    assert.throws(
      () => verifyAdminRouteProbe({ candidate, buildManifest, probe: mutated }),
      /admin_route_probe_mismatch/,
    );
  }
  assert.throws(
    () => verifyAdminRouteProbe({
      candidate: { ...candidate, build_sha256: 'e'.repeat(64) },
      buildManifest,
      probe,
    }),
    /admin_route_probe_mismatch/,
  );
  const releaseScript = readFileSync(new URL('../scripts/nelyon-admin-production-release.mjs', import.meta.url), 'utf8');
  assert.match(releaseScript, /const ADMIN_HTTP_TIMEOUT_MS = 15_000;/);
  assert.match(releaseScript, /signal: AbortSignal\.timeout\(ADMIN_HTTP_TIMEOUT_MS\)/,
    'every HTTP evidence request must have a hard transport timeout');
  assert.match(releaseScript, /error_code: 'admin_route_probe_transport_failed'/,
    'transport failures must leave only a fixed sanitized diagnostic code');
});

test('production HTTP matrix proves redirect, SPA documents, security headers, and a real 404 asset', () => {
  const headers = {
    'cache-control': 'no-store, no-transform',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-robots-tag': 'noindex, nofollow',
  };
  const matrix = {
    '/admin': { status: 308, location: 'https://nelyon.app/admin/', headers },
    '/admin/': { status: 200, content_type: 'text/html; charset=utf-8', headers },
    '/admin/system': { status: 200, content_type: 'text/html; charset=utf-8', headers },
    '/admin/__nelyon_missing_asset__.js': { status: 404, content_type: 'text/plain; charset=UTF-8', headers },
  };
  assert.equal(verifyProductionHttpMatrix(matrix), true);
  assert.throws(() => verifyProductionHttpMatrix({ ...matrix, '/admin/system': { ...matrix['/admin/system'], status: 404 } }), /admin_http_matrix_mismatch/);
  assert.throws(() => verifyProductionHttpMatrix({
    ...matrix,
    '/admin': { ...matrix['/admin'], location: 'https://attacker.example/admin/' },
  }), /admin_http_matrix_mismatch/);
  assert.throws(() => verifyProductionHttpMatrix({
    ...matrix,
    '/admin/': { ...matrix['/admin/'], headers: { ...headers, 'x-frame-options': null } },
  }), /admin_http_matrix_mismatch/);
  assert.throws(() => verifyProductionHttpMatrix({
    ...matrix,
    '/admin/': { ...matrix['/admin/'], headers: { ...headers, 'cache-control': 'no-store' } },
  }), /admin_http_matrix_mismatch/);
  assert.throws(() => verifyProductionHttpMatrix({
    ...matrix,
    '/admin/system': { ...matrix['/admin/system'], headers: { ...headers, 'content-security-policy': "default-src 'self'" } },
  }), /admin_http_matrix_mismatch/);
});

test('remote smoke verifies index and every immutable build artifact byte-for-byte', () => {
  const securityHeaders = {
    'cache-control': 'no-store, no-transform',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-robots-tag': 'noindex, nofollow',
  };
  const buildManifest = {
    dist_sha256: 'd'.repeat(64),
    files: [
      { path: 'assets/app-123456.js', bytes: 4, sha256: 'a'.repeat(64) },
      { path: 'assets/app-123456.css', bytes: 3, sha256: 'b'.repeat(64) },
      { path: 'index.html', bytes: 5, sha256: 'c'.repeat(64) },
    ],
  };
  const artifacts = [
    { path: 'assets/app-123456.js', url_path: '/admin/assets/app-123456.js', status: 200, bytes: 4, body_sha256: 'a'.repeat(64), headers: securityHeaders },
    { path: 'assets/app-123456.css', url_path: '/admin/assets/app-123456.css', status: 200, bytes: 3, body_sha256: 'b'.repeat(64), headers: securityHeaders },
    { path: 'index.html', url_path: '/admin/', status: 200, bytes: 5, body_sha256: 'c'.repeat(64), content_type: 'text/html; charset=utf-8', headers: securityHeaders },
  ];
  assert.equal(verifyRemoteBuildArtifacts({ buildManifest, artifacts }), true);
  assert.throws(() => verifyRemoteBuildArtifacts({
    buildManifest,
    artifacts: artifacts.map((item) => item.path === 'assets/app-123456.js'
      ? { ...item, body_sha256: 'e'.repeat(64) }
      : item),
  }), /admin_remote_build_mismatch/);
  assert.throws(() => verifyRemoteBuildArtifacts({ buildManifest, artifacts: artifacts.slice(1) }), /admin_remote_build_mismatch/);
  assert.throws(() => verifyRemoteBuildArtifacts({
    buildManifest,
    artifacts: [...artifacts, { path: 'rogue.js', url_path: '/admin/rogue.js', status: 200, bytes: 1, body_sha256: 'f'.repeat(64) }],
  }), /admin_remote_build_mismatch/);
  assert.throws(() => verifyRemoteBuildArtifacts({
    buildManifest,
    artifacts: artifacts.map((item) => item.path === 'assets/app-123456.css'
      ? { ...item, headers: { ...securityHeaders, 'x-frame-options': null } }
      : item),
  }), /admin_remote_build_mismatch/);
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
  assert.match(workflow, /Purge exact Admin production cache prefix/);
  assert.match(workflow, /Verify exact Admin production version, routes, and HTTP matrix/);
  assert.match(workflow, /Recover previous Admin production version and routes/);
  assert.doesNotMatch(workflow, /wrangler@4\.135\.0 deploy(?:\s|\\)/);
  assert.ok(
    workflow.indexOf('- name: Upload one immutable Admin version')
      > workflow.indexOf('- name: Require postcheck before release success'),
    'Admin upload must remain after the canonical Supabase postcheck',
  );
  const finalizeSection = workflow.slice(
    workflow.indexOf('- name: Verify exact Admin production version, routes, and HTTP matrix'),
    workflow.indexOf('- name: Recover previous Admin production version and routes'),
  );
  const purgeSection = workflow.slice(
    workflow.indexOf('- name: Purge exact Admin production cache prefix'),
    workflow.indexOf('- name: Verify exact Admin production version, routes, and HTTP matrix'),
  );
  const recoverySection = workflow.slice(
    workflow.indexOf('- name: Recover previous Admin production version and routes'),
    workflow.indexOf('- name: Require complete protected release success'),
  );
  const previewSection = workflow.slice(
    workflow.indexOf('- name: Attest and smoke the exact uploaded Admin version'),
    workflow.indexOf('- name: Promote the exact smoked Admin version'),
  );
  const promotedSmokeSection = workflow.slice(
    workflow.indexOf('- name: Verify promoted Admin version on temporary workers.dev'),
    workflow.indexOf('- name: Apply exact Admin production routes'),
  );
  const routesSection = workflow.slice(
    workflow.indexOf('- name: Apply exact Admin production routes'),
    workflow.indexOf('- name: Wait for exact Admin production route activation'),
  );
  const routeActivationSection = workflow.slice(
    workflow.indexOf('- name: Wait for exact Admin production route activation'),
    workflow.indexOf('- name: Purge exact Admin production cache prefix'),
  );
  const previewEnableSection = workflow.slice(
    workflow.indexOf('- name: Enable exact temporary Admin workers.dev and Version URLs'),
    workflow.indexOf('- name: Upload one immutable Admin version'),
  );
  const previewPrestateSection = workflow.slice(
    workflow.indexOf('- name: Capture Admin workers.dev and Version URL pre-state'),
    workflow.indexOf('- name: Enable exact temporary Admin workers.dev and Version URLs'),
  );
  const previewCleanupSection = workflow.slice(
    workflow.indexOf('- name: Close and verify temporary Admin URLs'),
    workflow.indexOf('- name: Require complete protected release success'),
  );
  assert.ok(workflow.indexOf('- name: Capture Admin workers.dev and Version URL pre-state')
    < workflow.indexOf('- name: Enable exact temporary Admin workers.dev and Version URLs'));
  assert.match(previewPrestateSection, /capture-preview-lifecycle[\s\S]*admin-web-preview-before\.json/);
  assert.ok(workflow.indexOf('- name: Enable exact temporary Admin workers.dev and Version URLs')
    < workflow.indexOf('- name: Upload one immutable Admin version'),
  'temporary URLs must be enabled before the immutable candidate is uploaded');
  assert.match(previewEnableSection,
    /preview-lifecycle[\s\S]*--enabled true[\s\S]*--previews-enabled true/);
  assert.match(previewCleanupSection, /if:\s*>-\s*always\(\)/,
    'temporary URL cleanup must run on every post-enable outcome');
  assert.match(previewCleanupSection, /steps\.admin_temp_urls_prestate\.outcome == 'success'/,
    'cleanup must remain runnable after an ambiguous or failed enable');
  assert.doesNotMatch(previewCleanupSection, /admin_temp_urls_enable\.outcome/,
    'cleanup must not depend on the enable result');
  assert.match(previewCleanupSection,
    /preview-lifecycle[\s\S]*--enabled false[\s\S]*--previews-enabled false/);
  assert.match(previewCleanupSection, /for attempt in \$\(seq 1 5\)/,
    'temporary URL closure must use bounded recovery for transient control-plane failures');
  assert.match(previewCleanupSection, /admin-web-preview-closed\.json/);
  assert.match(workflow, /steps\.admin_temp_urls_cleanup\.outcome == 'success'/,
    'release success must require verified temporary URL closure');
  assert.match(previewSection, /nelyon-admin-production-release\.mjs smoke[\s\S]*--build admin-evidence\/admin-web-build\.json/);
  assert.ok(workflow.indexOf('- name: Verify promoted Admin version on temporary workers.dev')
    > workflow.indexOf('- name: Promote the exact smoked Admin version'),
  'active workers.dev verification must run only after exact promotion');
  assert.ok(workflow.indexOf('- name: Apply exact Admin production routes')
    > workflow.indexOf('- name: Verify promoted Admin version on temporary workers.dev'),
  'workers.dev must be verified before the route config closes temporary URLs');
  assert.match(promotedSmokeSection, /id: admin_promoted_smoke/);
  assert.match(promotedSmokeSection, /https:\/\/nelyon-admin-web\.nelyon\.workers\.dev/);
  assert.match(promotedSmokeSection, /nelyon-admin-production-release\.mjs smoke[\s\S]*--candidate admin-evidence\/admin-web-candidate\.json[\s\S]*--build admin-evidence\/admin-web-build\.json/);
  assert.match(promotedSmokeSection, /for attempt in \$\(seq 1 24\)/);
  assert.match(promotedSmokeSection, /admin-web-promoted-http-attempt-\$\{attempt\}\.json/);
  assert.match(promotedSmokeSection, /sleep 5/);
  assert.match(promotedSmokeSection, /test "\$\{SMOKE_OK\}" = 'true'/,
    'the promoted active Worker smoke must fail closed after bounded retries');
  assert.match(routesSection, /steps\.admin_promoted_smoke\.outcome == 'success'/);
  assert.ok(workflow.indexOf('- name: Wait for exact Admin production route activation')
    > workflow.indexOf('- name: Apply exact Admin production routes'),
  'production propagation must be proven after the exact routes are applied');
  assert.ok(workflow.indexOf('- name: Purge exact Admin production cache prefix')
    > workflow.indexOf('- name: Wait for exact Admin production route activation'),
  'cache invalidation must run only after the candidate route is serving exact bytes');
  assert.match(routeActivationSection, /id: admin_route_activation/);
  assert.match(routeActivationSection, /steps\.admin_routes\.outcome == 'success'/);
  assert.match(routeActivationSection, /nelyon-admin-production-release\.mjs route-probe/);
  assert.match(routeActivationSection, /--base-url https:\/\/nelyon\.app/);
  assert.match(routeActivationSection, /--candidate admin-evidence\/admin-web-candidate\.json/);
  assert.match(routeActivationSection, /--build admin-evidence\/admin-web-build\.json/);
  assert.match(routeActivationSection, /--attempt "\$\{attempt\}"/);
  assert.match(routeActivationSection, /for attempt in \$\(seq 1 60\)/);
  assert.match(routeActivationSection, /admin-web-route-probe-attempt-\$\{attempt\}\.json/);
  assert.match(routeActivationSection, /sleep 5/);
  assert.match(routeActivationSection, /test "\$\{ROUTE_ACTIVE\}" = 'true'/,
    'route propagation must fail closed after bounded unique-path attempts');
  assert.match(purgeSection, /nelyon-admin-production-release\.mjs purge-admin-cache[\s\S]*admin-web-cache-purge\.json/);
  assert.match(purgeSection, /id: admin_cache_purge/);
  assert.match(purgeSection, /steps\.admin_route_activation\.outcome == 'success'/);
  assert.match(workflow, /steps\.admin_cache_purge\.outcome == 'success'/);
  assert.match(workflow, /admin-evidence\/admin-web-promoted-http\.json/);
  assert.match(workflow, /admin-evidence\/admin-web-route-probe\.json/);
  assert.match(workflow, /admin-evidence\/admin-web-route-probe-attempt-\*\.json/,
    'rejected probes must remain available as sanitized recovery evidence');
  assert.match(recoverySection, /restore-routes[\s\S]*purge-admin-cache[\s\S]*admin-web-recovery-cache-purge\.json/,
    'rollback must evict candidate Admin cache entries after restoring the previous deployment');
  assert.doesNotMatch(workflow, /purge_everything/);
  assert.match(finalizeSection, /nelyon-admin-production-release\.mjs smoke[\s\S]*--build admin-evidence\/admin-web-build\.json/);
  assert.match(finalizeSection, /for attempt in \$\(seq 1 12\)/,
    'production smoke must tolerate bounded Cloudflare route/version propagation');
  assert.match(finalizeSection, /admin-web-production-http-attempt-\$\{attempt\}\.json/);
  assert.match(finalizeSection, /sleep 5/);
  assert.match(finalizeSection, /test "\$\{SMOKE_OK\}" = 'true'/,
    'all bounded smoke attempts must still fail closed when production never converges');
  assert.ok(finalizeSection.indexOf('nelyon-admin-production-release.mjs smoke')
    < finalizeSection.indexOf('deployments status'), 'active version must be recaptured after the production smoke');
  assert.ok(finalizeSection.indexOf('nelyon-admin-production-release.mjs smoke')
    < finalizeSection.indexOf('capture-routes'), 'route state must be recaptured after the production smoke');

  const gateProofSection = workflow.slice(
    workflow.indexOf('- name: Verify gate proof without deployment secrets'),
    workflow.indexOf('- name: Verify postcheck recovery gate without deployment commands'),
  );
  assert.doesNotMatch(gateProofSection, /CLOUDFLARE_API_TOKEN|versions upload|versions deploy|triggers deploy/);
});

test('canonical Admin recovery is forward-only, source-bound, and never invokes a Supabase mutation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- admin_recovery/);
  assert.match(workflow, /ADMIN_RECOVERY_EXACT_SOURCE/);
  assert.match(workflow, /verify-admin-recovery-source/);
  assert.match(workflow, /postcheck-admin-recovery/);
  assert.match(workflow, /nelyon-admin-recovery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  const apply = workflow.slice(
    workflow.indexOf('- name: Apply exact manifest migrations'),
    workflow.indexOf('- name: Deploy each exact manifest function'),
  );
  const functions = workflow.slice(
    workflow.indexOf('- name: Deploy each exact manifest function'),
    workflow.indexOf('- name: Capture immutable read-only production post-snapshot'),
  );
  assert.match(apply, /needs\.plan\.outputs\.mode == 'release'/);
  assert.match(functions, /needs\.plan\.outputs\.mode == 'release'/);
  assert.doesNotMatch(apply, /admin_recovery/);
  assert.doesNotMatch(functions, /admin_recovery/);
  assert.match(workflow, /admin_recovery[\s\S]*Capture Admin recovery read-only production post-state/);
  assert.match(workflow, /Recover previous Admin production version and routes[\s\S]*mode == 'admin_recovery'/);
});

test('Admin recovery accepts only a verified one-hop postcheck recovery and downloads both evidence levels', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  const metadata = workflow.slice(
    workflow.indexOf('- name: Fetch exact Admin recovery source metadata'),
    workflow.indexOf('- name: Set up pinned Supabase CLI for an authorized release only'),
  );
  assert.match(metadata, /run\.conclusion === 'success'[\s\S]*\? 'postcheck_recovery'[\s\S]*source_kind=\$\{sourceKind\}/);
  assert.match(metadata, /nelyon-postcheck-recovery-\$\{process\.env\.SOURCE_RUN_ID\}-\$\{attempt\}/);
  assert.match(metadata, /verify-admin-recovery-postcheck-chain/);
  assert.match(metadata, /postcheck-recovery-chain\.json/);
  assert.match(metadata, /original_source_run_id/);
  assert.match(metadata, /Download exact original Admin recovery source release artifact/);
  assert.match(metadata, /Download exact original Admin recovery source gate artifact/);
  assert.match(metadata, /Download exact original Admin recovery source Admin artifact/);
  assert.match(metadata, /--postcheck-recovery-chain admin-recovery-evidence\/postcheck-recovery-chain\.json/);
  assert.ok(metadata.indexOf('verify-admin-recovery-postcheck-chain')
    < metadata.indexOf('original_source_run_id'), 'chain must be verified before original source outputs are trusted');
  assert.ok(metadata.indexOf('original_source_run_id')
    < metadata.indexOf('Download exact original Admin recovery source release artifact'));
  assert.doesNotMatch(metadata, /supabase\s+(?:db\s+push|migration|functions\s+deploy)/);
});

test('reproducible npm install and build never receive the Cloudflare production token', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../apps/admin-web/package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(readFileSync(new URL('../apps/admin-web/package-lock.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.devDependencies?.wrangler, '4.135.0');
  assert.equal(packageLock.packages?.['node_modules/wrangler']?.version, '4.135.0');
  assert.match(packageLock.packages?.['node_modules/wrangler']?.integrity ?? '', /^sha512-/);
  assert.match(workflow, /NELYON_WRANGLER: apps\/admin-web\/node_modules\/\.bin\/wrangler/);
  assert.doesNotMatch(workflow, /npx\s+--yes\s+wrangler/);
  const deployStart = workflow.indexOf('  deploy:');
  const deploySteps = workflow.indexOf('    steps:', deployStart);
  assert.doesNotMatch(workflow.slice(deployStart, deploySteps), /CLOUDFLARE_API_TOKEN/);
  const buildStart = workflow.search(/- name: Build Admin reproducibly\r?\n/);
  const prestateStart = workflow.search(/- name: Capture Cloudflare pre-state\r?\n/);
  assert.ok(buildStart >= 0, 'dedicated tokenless build step is required');
  assert.ok(prestateStart > buildStart, 'Cloudflare pre-state must be a later dedicated step');
  const buildSection = workflow.slice(buildStart, prestateStart);
  assert.match(buildSection, /npm ci --prefix apps\/admin-web/);
  assert.match(buildSection, /npm --prefix apps\/admin-web run build:deployment/);
  assert.doesNotMatch(buildSection, /CLOUDFLARE_API_TOKEN|wrangler|capture-routes|deployments status|versions list/);
  const prestateEnd = workflow.indexOf('- name: Verify exact remote migration dry-run before mutation', prestateStart);
  const prestateSection = workflow.slice(prestateStart, prestateEnd);
  assert.match(prestateSection, /CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(prestateSection, /npm ci|build:deployment/);
});

test('isolated Admin build resolves linked and shared sources without root Expo dependencies', () => {
  const tsconfig = JSON.parse(readFileSync(new URL('../apps/admin-web/tsconfig.app.json', import.meta.url), 'utf8'));
  const viteConfig = readFileSync(new URL('../apps/admin-web/vite.config.ts', import.meta.url), 'utf8');

  assert.equal(tsconfig.compilerOptions?.preserveSymlinks, true);
  assert.match(viteConfig, /tsconfigRaw:\s*JSON\.stringify\(/);
  assert.match(viteConfig, /jsx:\s*["']react-jsx["']/);
  assert.doesNotMatch(viteConfig, /tsconfigRaw:\s*\{\s*compilerOptions/);
});

test('Admin recovery refuses Cloudflare drift before the first upload mutation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url), 'utf8');
  const verifyStart = workflow.indexOf('- name: Verify Admin recovery Cloudflare pre-state');
  const uploadStart = workflow.indexOf('- name: Upload one immutable Admin version');
  assert.ok(verifyStart > 0 && uploadStart > verifyStart);
  const verification = workflow.slice(verifyStart, uploadStart);
  assert.match(verification, /verify-admin-recovery-cloudflare-prestate/);
  assert.match(verification, /verified-source\.json/);
  assert.match(verification, /admin-web-previous\.json/);
  assert.match(verification, /admin-web-before-routes\.json/);
  const upload = workflow.slice(uploadStart, workflow.indexOf('- name: Attest and smoke the exact uploaded Admin version'));
  assert.match(upload, /steps\.admin_recovery_cloudflare_prestate\.outcome == 'success'/);
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
