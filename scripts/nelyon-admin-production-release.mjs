#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_PUBLIC_SUPABASE_PROJECT_REF,
  resolvePublicSupabaseBuildEnv,
} from '../shared/web-deployment/publicSupabaseBuildEnv.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_NAME = 'nelyon-admin-web';
const CLOUDFLARE_ACCOUNT_ID = '24a176456cf57435119db8caf3af61dd';
const WRANGLER_VERSION = '4.135.0';
const PRODUCTION_ORIGIN = 'https://nelyon.app';
const ADMIN_ROUTES = ['nelyon.app/admin', 'nelyon.app/admin/*'];
const ADMIN_CACHE_PREFIX = 'nelyon.app/admin';
const ADMIN_HTTP_TIMEOUT_MS = 15_000;
const ADMIN_PREFIXES = ['apps/admin-web/', 'shared/web-deployment/', 'shared/web-media/'];
const ADMIN_IDENTITY_PATHS = [
  '.github/workflows/nelyon-production-release.yml',
  'scripts/nelyon-admin-production-release.mjs',
];
const ADMIN_EXTERNAL_BUILD_PATHS = [
  'shared/adsOperationalTruth.ts',
  'shared/adsErrorPresentation.ts',
  'assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png',
];

function fail(code, details = '') {
  throw new Error(details ? `${code}:${details}` : code);
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('admin_canonical_json_non_finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new TypeError('admin_canonical_json_unsupported');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail('admin_source_path_invalid');
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) fail('admin_source_path_invalid');
  return value;
}

function git(args, cwd = REPOSITORY_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) fail('admin_git_failed', Buffer.from(result.stderr ?? '').toString('utf8').trim());
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

function defaultTrackedFiles() {
  const pathspecs = [
    ...ADMIN_PREFIXES.map((item) => item.replace(/\/$/, '')),
    ...ADMIN_IDENTITY_PATHS,
    ...ADMIN_EXTERNAL_BUILD_PATHS,
  ];
  const names = git(['ls-files', '-z', '--', ...pathspecs]).toString('utf8').split('\0').filter(Boolean).sort();
  if (names.length === 0) fail('admin_source_inventory_empty');
  for (const required of [
    '.github/workflows/nelyon-production-release.yml',
    'scripts/nelyon-admin-production-release.mjs',
    'apps/admin-web/package.json',
    'apps/admin-web/package-lock.json',
    'apps/admin-web/deployment/worker.mjs',
    'apps/admin-web/deployment/wrangler.preview.jsonc',
    'apps/admin-web/deployment/wrangler.route.jsonc',
    'shared/web-deployment/buildPublicSupabaseSpa.mjs',
  ]) {
    if (!names.includes(required)) fail('admin_source_inventory_incomplete', required);
  }
  return names.map((path) => {
    safeRepositoryPath(path);
    const absolute = resolve(REPOSITORY_ROOT, ...path.split('/'));
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('admin_source_type_invalid', path);
    return { path, bytes: readFileSync(absolute) };
  });
}

function isAdminChange(path) {
  return ADMIN_PREFIXES.some((prefix) => path.startsWith(prefix)) || ADMIN_EXTERNAL_BUILD_PATHS.includes(path);
}

export function buildAdminSourceManifest({ approvedSha, releaseManifest, readTrackedFiles = defaultTrackedFiles }) {
  if (!SHA_PATTERN.test(approvedSha ?? '') || releaseManifest?.identity?.approved_sha !== approvedSha) {
    fail('admin_approved_sha_mismatch');
  }
  const changedPaths = (releaseManifest?.delta?.files ?? []).map((item) => safeRepositoryPath(item?.path));
  const sourceFiles = readTrackedFiles().map(({ path, bytes }) => {
    safeRepositoryPath(path);
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail('admin_source_bytes_invalid', path);
    const body = Buffer.from(bytes);
    return { path, bytes: body.length, sha256: sha256(body) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (sourceFiles.length === 0) fail('admin_source_inventory_empty');
  if (new Set(sourceFiles.map((item) => item.path)).size !== sourceFiles.length) fail('admin_source_inventory_duplicate');
  const sourceDigest = sha256(Buffer.from(canonicalJson(sourceFiles), 'utf8'));
  const releaseManifestDigest = sha256(Buffer.from(canonicalJson(releaseManifest), 'utf8'));
  const runId = String(releaseManifest.identity?.run_id ?? '');
  const runAttempt = Number(releaseManifest.identity?.run_attempt);
  if (!/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    fail('admin_release_identity_invalid');
  }
  const recoveryMode = releaseManifest.identity?.mode === 'admin_recovery';
  const recoverySourceRunId = String(releaseManifest.recovery?.source_run_id ?? '');
  if (recoveryMode && (releaseManifest.recovery?.kind !== 'admin_cloudflare_forward_completion'
    || !/^[1-9][0-9]*$/.test(recoverySourceRunId))) {
    fail('admin_recovery_identity_invalid');
  }
  const versionTag = recoveryMode
    ? `nelyon-admin-recovery-${recoverySourceRunId}-${runId}-${runAttempt}`
    : `nelyon-admin-${runId}-${runAttempt}`;
  const previewAlias = recoveryMode
    ? `admin-recovery-${recoverySourceRunId}-${runId}-${runAttempt}`
    : `admin-${runId}-${runAttempt}`;
  return {
    schema_version: 1,
    enabled: recoveryMode || changedPaths.some(isAdminChange),
    release: {
      approved_sha: approvedSha,
      mode: releaseManifest.identity.mode,
      release_id: releaseManifest.identity.release_id,
      run_id: runId,
      run_attempt: runAttempt,
      manifest_sha256: releaseManifestDigest,
      changed_admin_paths: changedPaths.filter(isAdminChange).sort(),
      ...(recoveryMode ? { recovery_source_run_id: recoverySourceRunId } : {}),
    },
    source: { files: sourceFiles, sha256: sourceDigest },
    build: {
      package_lock: 'apps/admin-web/package-lock.json',
      install: 'npm ci --prefix apps/admin-web',
      command: 'npm --prefix apps/admin-web run build:deployment',
      project_ref: EXPECTED_PUBLIC_SUPABASE_PROJECT_REF,
      output: 'apps/admin-web/dist',
    },
    worker: {
      name: WORKER_NAME,
      wrangler_version: WRANGLER_VERSION,
      upload_config: 'apps/admin-web/deployment/wrangler.preview.jsonc',
      route_config: 'apps/admin-web/deployment/wrangler.route.jsonc',
      version_tag: versionTag,
      preview_alias: previewAlias,
      routes: [...ADMIN_ROUTES],
      production_origin: PRODUCTION_ORIGIN,
    },
    contract: {
      upload: 'immutable_version_only',
      preview_smoke: 'exact_uploaded_version',
      promotion: 'exact_smoked_version_100_percent',
      route_application: 'after_active_version_equality',
      recovery: 'restore_exact_previous_version_and_route_state',
      direct_wrangler_deploy: false,
    },
  };
}

function readJson(path, code = 'admin_json_invalid') {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(code, path);
  }
}

function writeCanonical(path, value, { exclusive = true } = {}) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w' });
}

function writeDigest(path, value, { exclusive = true } = {}) {
  const digest = sha256(Buffer.from(canonicalJson(value), 'utf8'));
  writeFileSync(path, `${digest}\n`, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w' });
  return digest;
}

function verifyPlan({ approvedSha, releaseManifestPath, manifestPath, digestPath }) {
  const releaseManifest = readJson(releaseManifestPath);
  const expected = buildAdminSourceManifest({ approvedSha, releaseManifest });
  const bytes = readFileSync(manifestPath, 'utf8');
  const claimed = readFileSync(digestPath, 'utf8').trim();
  const expectedBytes = `${canonicalJson(expected)}\n`;
  if (!SHA256_PATTERN.test(claimed) || claimed !== sha256(Buffer.from(canonicalJson(expected), 'utf8'))
    || bytes !== expectedBytes) fail('admin_manifest_mismatch');
  return expected;
}

function walkFiles(directory, root = directory, result = []) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) fail('admin_build_symlink_forbidden');
  if (stat.isFile()) {
    const path = relative(root, directory).split(sep).join('/');
    const body = readFileSync(directory);
    result.push({ path, bytes: body.length, sha256: sha256(body) });
    return result;
  }
  if (!stat.isDirectory()) fail('admin_build_type_invalid');
  for (const name of readdirSync(directory).sort()) walkFiles(join(directory, name), root, result);
  return result;
}

async function buildArtifactManifest({ approvedSha, sourceManifestPath, outputDirectory }) {
  const source = readJson(sourceManifestPath);
  if (source.release?.approved_sha !== approvedSha || source.enabled !== true) fail('admin_build_manifest_identity_mismatch');
  const dist = resolve(outputDirectory);
  if (!existsSync(join(dist, 'index.html'))) fail('admin_build_index_missing');
  const files = walkFiles(dist).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length < 2) fail('admin_build_inventory_incomplete');
  const publicConfig = await resolvePublicSupabaseBuildEnv({ loadFallbackFile: false });
  return {
    schema_version: 1,
    approved_sha: approvedSha,
    source_manifest_sha256: sha256(Buffer.from(canonicalJson(source), 'utf8')),
    public_config: {
      project_ref: publicConfig.projectRef,
      key_sha256: publicConfig.keySha256,
    },
    output: 'apps/admin-web/dist',
    files,
    dist_sha256: sha256(Buffer.from(canonicalJson(files), 'utf8')),
  };
}

function nestedStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => nestedStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => nestedStrings(item, result));
  return result;
}

function versionRecords(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['versions', 'result', 'items']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

export function identifyUploadedVersion({ before, after, expectedTag }) {
  if (typeof expectedTag !== 'string' || expectedTag.length === 0) fail('admin_version_tag_invalid');
  const beforeIds = new Set(versionRecords(before).map((item) => item?.id ?? item?.version_id).filter(Boolean));
  const matches = versionRecords(after).filter((item) => {
    const id = item?.id ?? item?.version_id;
    return UUID_PATTERN.test(id ?? '') && !beforeIds.has(id) && nestedStrings(item).includes(expectedTag);
  });
  if (matches.length !== 1) fail('admin_uploaded_version_not_unique');
  return matches[0];
}

export function verifyUploadedVersionIdentity({ versionView, versionId, versionTag, buildSha256 }) {
  if (!UUID_PATTERN.test(versionId ?? '') || typeof versionTag !== 'string' || versionTag.length === 0
    || !nestedStrings(versionView).includes(versionTag) || !nestedStrings(versionView).includes(versionId)) {
    fail('admin_uploaded_version_identity_mismatch');
  }
  if (!SHA256_PATTERN.test(buildSha256 ?? '')
    || !nestedStrings(versionView).includes(`b:${buildSha256}`)) {
    fail('admin_uploaded_build_identity_mismatch');
  }
  return true;
}

function deploymentVersions(value) {
  if (Array.isArray(value)) {
    if (value.length !== 1) fail('admin_active_deployment_not_atomic');
    return deploymentVersions(value[0]);
  }
  return value?.versions ?? value?.deployment?.versions ?? [];
}

export function parseActiveDeployment(value) {
  const versions = deploymentVersions(value);
  if (!Array.isArray(versions) || versions.length !== 1) fail('admin_active_deployment_not_atomic');
  const item = versions[0];
  const id = item?.version_id ?? item?.id;
  const percentage = Number(item?.percentage ?? item?.traffic_percentage);
  if (!UUID_PATTERN.test(id ?? '') || percentage !== 100) fail('admin_active_deployment_not_atomic');
  return id;
}

function desiredRouteRecords(routes) {
  if (!Array.isArray(routes)) fail('admin_route_inventory_invalid');
  return routes.filter((route) => ADMIN_ROUTES.includes(route?.pattern));
}

export function verifyRouteInventory(routes) {
  const desired = desiredRouteRecords(routes);
  if (desired.length !== ADMIN_ROUTES.length
    || ADMIN_ROUTES.some((pattern) => desired.filter((route) => route.pattern === pattern).length !== 1)) {
    fail('admin_route_inventory_mismatch');
  }
  if (desired.some((route) => route.script !== WORKER_NAME)) fail('admin_route_owner_mismatch');
  if (routes.some((route) => route?.script === WORKER_NAME && !ADMIN_ROUTES.includes(route?.pattern))) {
    fail('admin_route_scope_drift');
  }
  return ADMIN_ROUTES.map((pattern) => desired.find((route) => route.pattern === pattern));
}

function verifyPreRouteInventory(routes) {
  const desired = desiredRouteRecords(routes);
  if (desired.some((route) => route.script !== WORKER_NAME)) fail('admin_route_owner_mismatch');
  if (desired.some((route) => desired.filter((candidate) => candidate.pattern === route.pattern).length !== 1)) {
    fail('admin_route_inventory_mismatch');
  }
  const extraOwned = routes.filter((route) => route?.script === WORKER_NAME && !ADMIN_ROUTES.includes(route?.pattern));
  if (extraOwned.length > 0) fail('admin_route_scope_drift');
  return desired;
}

export function verifyRecoveredRouteInventory({ before, after }) {
  if (typeof before?.zone_id !== 'string' || before.zone_id.length === 0 || before.zone_id !== after?.zone_id) {
    fail('admin_route_recovery_mismatch');
  }
  verifyPreRouteInventory(before.routes);
  verifyPreRouteInventory(after.routes);
  const select = (inventory) => inventory.routes
    .filter((route) => ADMIN_ROUTES.includes(route.pattern))
    .map((route) => `${route.pattern}:${route.script}`)
    .sort();
  if (canonicalJson(select(before)) !== canonicalJson(select(after))) fail('admin_route_recovery_mismatch');
  return true;
}

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function hasAdminSecurityHeaders(entry) {
  const headers = normalizedHeaders(entry?.headers);
  const cacheControl = new Set((headers['cache-control'] ?? '')
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean));
  return cacheControl.has('no-store')
    && cacheControl.has('no-transform')
    && /(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/i.test(headers['content-security-policy'] ?? '')
    && /^deny$/i.test(headers['x-frame-options'] ?? '')
    && /noindex/i.test(headers['x-robots-tag'] ?? '');
}

export function verifyProductionHttpMatrix(matrix, { expectedOrigin = PRODUCTION_ORIGIN } = {}) {
  let origin;
  try {
    const parsed = new URL(expectedOrigin);
    if (parsed.protocol !== 'https:' || parsed.origin !== parsed.href.replace(/\/$/, '')) fail('admin_http_origin_invalid');
    origin = parsed.origin;
  } catch {
    fail('admin_http_origin_invalid');
  }
  const redirect = matrix?.['/admin'];
  const shell = matrix?.['/admin/'];
  const deep = matrix?.['/admin/system'];
  const missing = matrix?.['/admin/__nelyon_missing_asset__.js'];
  const redirectLocation = redirect?.location ?? normalizedHeaders(redirect?.headers).location;
  const valid = redirect?.status === 308
    && (redirectLocation === '/admin/' || redirectLocation === `${origin}/admin/`)
    && shell?.status === 200 && /^text\/html\b/i.test(shell?.content_type ?? '')
    && deep?.status === 200 && /^text\/html\b/i.test(deep?.content_type ?? '')
    && missing?.status === 404
    && [redirect, shell, deep, missing].every(hasAdminSecurityHeaders);
  if (!valid) fail('admin_http_matrix_mismatch');
  return true;
}

function adminArtifactUrlPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\') || path.includes('\0')
    || path.startsWith('/') || posix.normalize(path) !== path || path === '..' || path.startsWith('../')) {
    fail('admin_remote_build_mismatch');
  }
  if (path === 'index.html') return '/admin/';
  return `/admin/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

export function verifyRemoteBuildArtifacts({ buildManifest, artifacts }) {
  const expected = buildManifest?.files;
  if (!SHA256_PATTERN.test(buildManifest?.dist_sha256 ?? '') || !Array.isArray(expected)
    || expected.length === 0 || !Array.isArray(artifacts) || artifacts.length !== expected.length) {
    fail('admin_remote_build_mismatch');
  }
  if (new Set(expected.map((item) => item?.path)).size !== expected.length
    || new Set(artifacts.map((item) => item?.path)).size !== artifacts.length) {
    fail('admin_remote_build_mismatch');
  }
  for (const file of expected) {
    const remote = artifacts.find((item) => item?.path === file?.path);
    const expectedUrlPath = adminArtifactUrlPath(file?.path);
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !SHA256_PATTERN.test(file?.sha256 ?? '')
      || !remote || remote.url_path !== expectedUrlPath || remote.status !== 200
      || remote.bytes !== file.bytes || remote.body_sha256 !== file.sha256
      || !hasAdminSecurityHeaders(remote)
      || (file.path === 'index.html' && !/^text\/html\b/i.test(remote.content_type ?? ''))) {
      fail('admin_remote_build_mismatch', file?.path ?? 'unknown');
    }
  }
  return true;
}

export function buildAdminRouteProbePath(versionId, attempt) {
  if (!UUID_PATTERN.test(versionId ?? '') || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 60) {
    fail('admin_route_probe_invalid');
  }
  return `/admin/__nelyon_release_probe__/${versionId}/${attempt}`;
}

export function verifyAdminRouteProbe({ candidate, buildManifest, probe }) {
  const versionId = candidate?.version_id;
  const attempt = probe?.attempt;
  if (!UUID_PATTERN.test(versionId ?? '')
    || !SHA256_PATTERN.test(buildManifest?.dist_sha256 ?? '')
    || candidate?.build_sha256 !== buildManifest.dist_sha256
    || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 60) {
    fail('admin_route_probe_mismatch');
  }
  const indexes = Array.isArray(buildManifest?.files)
    ? buildManifest.files.filter((file) => file?.path === 'index.html')
    : [];
  const index = indexes[0];
  const expectedPath = buildAdminRouteProbePath(versionId, attempt);
  if (indexes.length !== 1 || !Number.isSafeInteger(index?.bytes) || index.bytes < 0
    || !SHA256_PATTERN.test(index?.sha256 ?? '')
    || probe?.url_path !== expectedPath
    || probe?.status !== 200
    || !/^text\/html\b/i.test(probe?.content_type ?? '')
    || probe?.body_sha256 !== index.sha256
    || probe?.bytes !== index.bytes
    || !hasAdminSecurityHeaders(probe)) {
    fail('admin_route_probe_mismatch');
  }
  return true;
}

async function fetchHttpEvidence(url, headers) {
  const response = await fetch(url, {
    redirect: 'manual',
    headers,
    signal: AbortSignal.timeout(ADMIN_HTTP_TIMEOUT_MS),
  });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get('location'),
    content_type: response.headers.get('content-type'),
    headers: {
      'cache-control': response.headers.get('cache-control'),
      'content-security-policy': response.headers.get('content-security-policy'),
      'cf-cache-status': response.headers.get('cf-cache-status'),
      'cf-ray': response.headers.get('cf-ray'),
      age: response.headers.get('age'),
      etag: response.headers.get('etag'),
      'server-timing': response.headers.get('server-timing'),
      'x-frame-options': response.headers.get('x-frame-options'),
      'x-robots-tag': response.headers.get('x-robots-tag'),
    },
    body_sha256: sha256(body),
    bytes: body.length,
  };
}

async function captureHttpMatrix(baseUrl, buildManifest) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') fail('admin_smoke_url_invalid');
  const matrix = {};
  for (const path of ['/admin', '/admin/', '/admin/system', '/admin/__nelyon_missing_asset__.js']) {
    matrix[path] = await fetchHttpEvidence(new URL(path, base), { Accept: path.endsWith('.js') ? '*/*' : 'text/html' });
  }
  verifyProductionHttpMatrix(matrix, { expectedOrigin: base.origin });
  const artifacts = [];
  for (const file of buildManifest?.files ?? []) {
    const urlPath = adminArtifactUrlPath(file?.path);
    const evidence = file.path === 'index.html'
      ? matrix['/admin/']
      : await fetchHttpEvidence(new URL(urlPath, base), { Accept: '*/*' });
    artifacts.push({ path: file.path, url_path: urlPath, ...evidence });
  }
  verifyRemoteBuildArtifacts({ buildManifest, artifacts });
  return { matrix, artifacts };
}

async function captureRouteProbe(baseUrl, candidate, buildManifest, attempt) {
  let base;
  try {
    base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.origin !== base.href.replace(/\/$/, '')) fail('admin_route_probe_url_invalid');
  } catch {
    fail('admin_route_probe_url_invalid');
  }
  const urlPath = buildAdminRouteProbePath(candidate?.version_id, attempt);
  const evidence = {
    attempt,
    url_path: urlPath,
    ...await fetchHttpEvidence(new URL(urlPath, base), { Accept: 'text/html' }),
  };
  return {
    schema_version: 1,
    version_id: candidate.version_id,
    build_sha256: buildManifest.dist_sha256,
    ...evidence,
  };
}

async function cloudflareRequest(path, { method = 'GET', json = null } = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (typeof token !== 'string' || token.length < 20) fail('admin_cloudflare_token_required');
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(json === null ? {} : { body: canonicalJson(json) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail('admin_cloudflare_api_failed', `${method}:${path}:HTTP_${response.status}`);
  return body.result;
}

export function buildAdminPreviewLifecycleRequest({ enabled, previewsEnabled }) {
  if (typeof enabled !== 'boolean' || typeof previewsEnabled !== 'boolean'
    || enabled !== previewsEnabled) {
    fail('admin_preview_lifecycle_invalid');
  }
  return {
    path: `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/subdomain`,
    method: 'POST',
    json: { enabled, previews_enabled: previewsEnabled },
  };
}

export function verifyAdminPreviewLifecycleState(state, { enabled, previewsEnabled }) {
  if (typeof enabled !== 'boolean' || typeof previewsEnabled !== 'boolean'
    || state === null || typeof state !== 'object' || Array.isArray(state)
    || typeof state.enabled !== 'boolean' || typeof state.previews_enabled !== 'boolean'
    || state.enabled !== enabled || state.previews_enabled !== previewsEnabled) {
    fail('admin_preview_lifecycle_mismatch');
  }
  return { enabled: state.enabled, previews_enabled: state.previews_enabled };
}

async function captureAdminPreviewLifecycle() {
  const result = await cloudflareRequest(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/subdomain`,
  );
  if (result === null || typeof result !== 'object' || Array.isArray(result)
    || typeof result.enabled !== 'boolean' || typeof result.previews_enabled !== 'boolean') {
    fail('admin_preview_lifecycle_mismatch');
  }
  return { enabled: result.enabled, previews_enabled: result.previews_enabled };
}

async function setAdminPreviewLifecycle({ enabled, previewsEnabled }) {
  if (enabled) {
    const before = await captureAdminPreviewLifecycle();
    verifyAdminPreviewLifecycleState(before, { enabled: false, previewsEnabled: false });
  }
  const request = buildAdminPreviewLifecycleRequest({ enabled, previewsEnabled });
  await cloudflareRequest(request.path, { method: request.method, json: request.json });
  const observed = await captureAdminPreviewLifecycle();
  verifyAdminPreviewLifecycleState(observed, { enabled, previewsEnabled });
  return {
    schema_version: 1,
    result: enabled || previewsEnabled
      ? 'ADMIN_PREVIEW_LIFECYCLE_ENABLED'
      : 'ADMIN_PREVIEW_LIFECYCLE_CLOSED',
    worker_name: WORKER_NAME,
    ...observed,
  };
}

async function findZone() {
  const zones = await cloudflareRequest('/zones?name=nelyon.app&status=active&per_page=50');
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0]?.name !== 'nelyon.app') fail('admin_cloudflare_zone_invalid');
  return zones[0].id;
}

export function buildAdminCachePurgeRequest(zoneId) {
  if (!/^[0-9a-f]{32}$/.test(zoneId ?? '')) fail('admin_cloudflare_zone_invalid');
  return {
    path: `/zones/${zoneId}/purge_cache`,
    method: 'POST',
    json: { prefixes: [ADMIN_CACHE_PREFIX] },
  };
}

async function purgeAdminCache() {
  const zoneId = await findZone();
  const request = buildAdminCachePurgeRequest(zoneId);
  const result = await cloudflareRequest(request.path, { method: request.method, json: request.json });
  if (result?.id !== zoneId) fail('admin_cache_purge_response_invalid');
  return {
    schema_version: 1,
    result: 'ADMIN_CACHE_PURGE_VERIFIED',
    zone_id: zoneId,
    prefixes: request.json.prefixes,
  };
}

async function captureRoutes() {
  const zoneId = await findZone();
  const routes = await cloudflareRequest(`/zones/${encodeURIComponent(zoneId)}/workers/routes`);
  if (!Array.isArray(routes)) fail('admin_route_inventory_invalid');
  return {
    zone_id: zoneId,
    routes: routes.map((route) => ({ id: route.id, pattern: route.pattern, script: route.script ?? null }))
      .sort((left, right) => `${left.pattern}:${left.id}`.localeCompare(`${right.pattern}:${right.id}`)),
  };
}

async function restoreRoutes(before) {
  const current = await captureRoutes();
  verifyPreRouteInventory(before.routes);
  verifyPreRouteInventory(current.routes);
  if (before.zone_id !== current.zone_id) fail('admin_route_recovery_mismatch');
  const beforeKeys = new Set(before.routes.filter((route) => ADMIN_ROUTES.includes(route.pattern)).map((route) => `${route.pattern}:${route.script}`));
  const added = current.routes.filter((route) => route.script === WORKER_NAME
    && ADMIN_ROUTES.includes(route.pattern)
    && !beforeKeys.has(`${route.pattern}:${route.script}`));
  for (const route of added) await cloudflareRequest(`/zones/${encodeURIComponent(current.zone_id)}/workers/routes/${encodeURIComponent(route.id)}`, { method: 'DELETE' });
  const restored = await captureRoutes();
  verifyRecoveredRouteInventory({ before, after: restored });
  return restored;
}

function findPreviewUrl({ uploadLog, version, previewAlias }) {
  const candidates = new Set();
  const collect = (text) => {
    for (const match of String(text ?? '').matchAll(/https:\/\/[^\s<>'"`]+/g)) {
      try {
        const url = new URL(match[0].replace(/[),.;]+$/, ''));
        if (url.protocol === 'https:' && url.hostname.includes(previewAlias)) candidates.add(url.origin);
      } catch { /* ignored */ }
    }
  };
  collect(uploadLog);
  nestedStrings(version).forEach(collect);
  if (candidates.size !== 1) fail('admin_exact_preview_url_unavailable');
  return [...candidates][0];
}

function argsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) fail('admin_argument_invalid', value);
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) fail('admin_argument_missing', key);
    result[key] = next;
    index += 1;
  }
  return result;
}

function requireArg(values, name) {
  const value = values[name];
  if (typeof value !== 'string' || value.length === 0) fail('admin_argument_required', name);
  return value;
}

function requireEnabledManifest(path) {
  const manifest = readJson(path);
  if (manifest.enabled !== true) fail('admin_release_not_enabled');
  return manifest;
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const values = argsMap(rest);
  if (command === 'plan') {
    const approvedSha = requireArg(values, 'approved-sha');
    const manifest = buildAdminSourceManifest({ approvedSha, releaseManifest: readJson(requireArg(values, 'release-manifest')) });
    writeCanonical(requireArg(values, 'output'), manifest);
    const digest = writeDigest(requireArg(values, 'digest-output'), manifest);
    process.stdout.write(`ADMIN PLAN ${manifest.enabled ? 'ENABLED' : 'NOT_REQUIRED'} ${digest}\n`);
    return;
  }
  if (command === 'verify-plan') {
    const manifest = verifyPlan({
      approvedSha: requireArg(values, 'approved-sha'),
      releaseManifestPath: requireArg(values, 'release-manifest'),
      manifestPath: requireArg(values, 'manifest'),
      digestPath: requireArg(values, 'digest'),
    });
    process.stdout.write(`ADMIN PLAN VERIFIED ${manifest.source.sha256}\n`);
    return;
  }
  if (command === 'build-env') {
    const payload = readJson(requireArg(values, 'api-keys'));
    const records = Array.isArray(payload) ? payload : payload?.result ?? payload?.api_keys ?? [];
    const candidates = records.map((item) => item?.api_key ?? item?.key ?? item?.value).filter(Boolean);
    let selected = null;
    for (const key of candidates) {
      try {
        selected = await resolvePublicSupabaseBuildEnv({
          environment: { VITE_SUPABASE_URL: `https://${EXPECTED_PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`, VITE_SUPABASE_ANON_KEY: key },
          loadFallbackFile: false,
        });
        break;
      } catch { /* inspect next public key without exposing it */ }
    }
    if (!selected) fail('admin_public_supabase_key_unavailable');
    const githubEnv = requireArg(values, 'github-env');
    appendFileSync(githubEnv, `VITE_SUPABASE_URL=https://${EXPECTED_PUBLIC_SUPABASE_PROJECT_REF}.supabase.co\n`);
    appendFileSync(githubEnv, `VITE_SUPABASE_PUBLISHABLE_KEY=${selected.buildEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY}\n`);
    appendFileSync(githubEnv, `VITE_SUPABASE_ANON_KEY=${selected.buildEnvironment.VITE_SUPABASE_ANON_KEY}\n`);
    process.stdout.write(`ADMIN PUBLIC BUILD ENV VERIFIED ${selected.keySha256}\n`);
    return;
  }
  if (command === 'build-manifest') {
    const manifest = await buildArtifactManifest({
      approvedSha: requireArg(values, 'approved-sha'),
      sourceManifestPath: requireArg(values, 'source-manifest'),
      outputDirectory: requireArg(values, 'dist'),
    });
    writeCanonical(requireArg(values, 'output'), manifest);
    process.stdout.write(`ADMIN BUILD VERIFIED ${manifest.dist_sha256}\n`);
    return;
  }
  if (command === 'compare-builds') {
    const first = readJson(requireArg(values, 'first'));
    const second = readJson(requireArg(values, 'second'));
    if (first.dist_sha256 !== second.dist_sha256 || canonicalJson(first.files) !== canonicalJson(second.files)) fail('admin_build_not_reproducible');
    writeCanonical(requireArg(values, 'output'), second);
    process.stdout.write(`ADMIN BUILD REPRODUCIBLE ${second.dist_sha256}\n`);
    return;
  }
  if (command === 'active-version') {
    const id = parseActiveDeployment(readJson(requireArg(values, 'deployment')));
    const expected = values['expected-version'];
    if (expected && id !== expected) fail('admin_active_version_mismatch');
    writeCanonical(requireArg(values, 'output'), { version_id: id, percentage: 100 });
    process.stdout.write(`${id}\n`);
    return;
  }
  if (command === 'identify-upload') {
    const source = requireEnabledManifest(requireArg(values, 'source-manifest'));
    const candidate = identifyUploadedVersion({
      before: readJson(requireArg(values, 'before')),
      after: readJson(requireArg(values, 'after')),
      expectedTag: source.worker.version_tag,
    });
    const versionId = candidate.id ?? candidate.version_id;
    if (!values['version-view']) {
      writeCanonical(requireArg(values, 'output'), { version_id: versionId, version_tag: source.worker.version_tag });
      process.stdout.write(`ADMIN CANDIDATE ID VERIFIED ${versionId}\n`);
      return;
    }
    const versionView = readJson(requireArg(values, 'version-view'));
    const build = readJson(requireArg(values, 'build-manifest'));
    verifyUploadedVersionIdentity({
      versionView,
      versionId,
      versionTag: source.worker.version_tag,
      buildSha256: build.dist_sha256,
    });
    const previewUrl = findPreviewUrl({
      uploadLog: readFileSync(requireArg(values, 'upload-log'), 'utf8'),
      version: versionView,
      previewAlias: source.worker.preview_alias,
    });
    const output = {
      version_id: versionId,
      version_tag: source.worker.version_tag,
      build_sha256: build.dist_sha256,
      preview_url: previewUrl,
    };
    writeCanonical(requireArg(values, 'output'), output);
    process.stdout.write(`ADMIN CANDIDATE VERIFIED ${versionId}\n`);
    return;
  }
  if (command === 'capture-routes') {
    const inventory = await captureRoutes();
    if (values.phase === 'pre') verifyPreRouteInventory(inventory.routes);
    else if (values.phase === 'post') verifyRouteInventory(inventory.routes);
    else fail('admin_route_phase_invalid');
    writeCanonical(requireArg(values, 'output'), inventory);
    process.stdout.write(`ADMIN ROUTES ${values.phase.toUpperCase()} VERIFIED\n`);
    return;
  }
  if (command === 'restore-routes') {
    const before = readJson(requireArg(values, 'before'));
    const restored = await restoreRoutes(before);
    writeCanonical(requireArg(values, 'output'), restored);
    process.stdout.write('ADMIN ROUTES RECOVERED\n');
    return;
  }
  if (command === 'purge-admin-cache') {
    const evidence = await purgeAdminCache();
    writeCanonical(requireArg(values, 'output'), evidence);
    process.stdout.write('ADMIN CACHE PURGE VERIFIED\n');
    return;
  }
  if (command === 'preview-lifecycle') {
    const parseBoolean = (name) => {
      const raw = requireArg(values, name);
      if (!['true', 'false'].includes(raw)) fail('admin_preview_lifecycle_invalid', name);
      return raw === 'true';
    };
    const evidence = await setAdminPreviewLifecycle({
      enabled: parseBoolean('enabled'),
      previewsEnabled: parseBoolean('previews-enabled'),
    });
    writeCanonical(requireArg(values, 'output'), evidence);
    process.stdout.write(`${evidence.result}\n`);
    return;
  }
  if (command === 'capture-preview-lifecycle') {
    const evidence = await captureAdminPreviewLifecycle();
    writeCanonical(requireArg(values, 'output'), {
      schema_version: 1,
      result: 'ADMIN_PREVIEW_LIFECYCLE_CAPTURED',
      worker_name: WORKER_NAME,
      ...evidence,
    });
    process.stdout.write('ADMIN PREVIEW LIFECYCLE CAPTURED\n');
    return;
  }
  if (command === 'route-probe') {
    const candidate = readJson(requireArg(values, 'candidate'));
    const build = readJson(requireArg(values, 'build'));
    const attempt = Number(requireArg(values, 'attempt'));
    const outputPath = requireArg(values, 'output');
    let evidence;
    try {
      evidence = await captureRouteProbe(requireArg(values, 'base-url'), candidate, build, attempt);
    } catch (error) {
      const safeVersionId = UUID_PATTERN.test(candidate?.version_id ?? '') ? candidate.version_id : null;
      const safeBuildSha = SHA256_PATTERN.test(build?.dist_sha256 ?? '') ? build.dist_sha256 : null;
      const safeAttempt = Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= 60 ? attempt : null;
      writeCanonical(outputPath, {
        schema_version: 1,
        result: 'ADMIN_ROUTE_PROBE_REJECTED',
        version_id: safeVersionId,
        build_sha256: safeBuildSha,
        attempt: safeAttempt,
        url_path: safeVersionId && safeAttempt ? buildAdminRouteProbePath(safeVersionId, safeAttempt) : null,
        error_code: 'admin_route_probe_transport_failed',
      });
      throw error;
    }
    try {
      verifyAdminRouteProbe({ candidate, buildManifest: build, probe: evidence });
      writeCanonical(outputPath, { ...evidence, result: 'ADMIN_ROUTE_PROBE_VERIFIED' });
    } catch (error) {
      const errorCode = String(error?.message ?? '').split(':', 1)[0];
      writeCanonical(outputPath, {
        ...evidence,
        result: 'ADMIN_ROUTE_PROBE_REJECTED',
        error_code: errorCode === 'admin_route_probe_mismatch' ? errorCode : 'admin_route_probe_failed',
      });
      throw error;
    }
    process.stdout.write(`ADMIN ROUTE PROBE VERIFIED ${candidate.version_id} ATTEMPT ${attempt}\n`);
    return;
  }
  if (command === 'smoke') {
    const build = readJson(requireArg(values, 'build'));
    const { matrix, artifacts } = await captureHttpMatrix(requireArg(values, 'base-url'), build);
    const candidatePath = values.candidate;
    const candidate = candidatePath ? readJson(candidatePath) : null;
    if (candidate && candidate.build_sha256 !== build.dist_sha256) fail('admin_remote_build_identity_mismatch');
    const output = {
      ...(candidate ? { version_id: candidate.version_id } : {}),
      build_sha256: build.dist_sha256,
      matrix,
      artifacts,
    };
    writeCanonical(requireArg(values, 'output'), output);
    process.stdout.write('ADMIN HTTP MATRIX VERIFIED\n');
    return;
  }
  if (command === 'finalize') {
    const source = requireEnabledManifest(requireArg(values, 'source-manifest'));
    const candidate = readJson(requireArg(values, 'candidate'));
    const build = readJson(requireArg(values, 'build'));
    if (!SHA256_PATTERN.test(build.dist_sha256 ?? '') || candidate.build_sha256 !== build.dist_sha256) {
      fail('admin_promoted_build_identity_mismatch');
    }
    const active = parseActiveDeployment(readJson(requireArg(values, 'deployment')));
    if (active !== candidate.version_id) fail('admin_active_version_mismatch');
    const routes = readJson(requireArg(values, 'routes'));
    verifyRouteInventory(routes.routes);
    const http = readJson(requireArg(values, 'http'));
    if (http.build_sha256 !== build.dist_sha256) fail('admin_remote_build_identity_mismatch');
    verifyProductionHttpMatrix(http.matrix ?? http);
    verifyRemoteBuildArtifacts({ buildManifest: build, artifacts: http.artifacts });
    const evidence = {
      schema_version: 1,
      result: 'ADMIN_RELEASE_VERIFIED',
      approved_sha: source.release.approved_sha,
      version_id: candidate.version_id,
      version_tag: source.worker.version_tag,
      build_sha256: build.dist_sha256,
      routes: ADMIN_ROUTES,
      active_percentage: 100,
    };
    writeCanonical(requireArg(values, 'output'), evidence);
    process.stdout.write(`ADMIN RELEASE VERIFIED ${candidate.version_id}\n`);
    return;
  }
  if (command === 'verify-recovery') {
    const expected = readJson(requireArg(values, 'previous')).version_id;
    const active = parseActiveDeployment(readJson(requireArg(values, 'deployment')));
    if (active !== expected) fail('admin_recovery_version_mismatch');
    const before = readJson(requireArg(values, 'before-routes'));
    const after = readJson(requireArg(values, 'after-routes'));
    verifyRecoveredRouteInventory({ before, after });
    writeCanonical(requireArg(values, 'output'), { schema_version: 1, result: 'ADMIN_RECOVERY_VERIFIED', version_id: active, routes_restored: true });
    process.stdout.write(`ADMIN RECOVERY VERIFIED ${active}\n`);
    return;
  }
  fail('admin_command_invalid', command ?? '');
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
