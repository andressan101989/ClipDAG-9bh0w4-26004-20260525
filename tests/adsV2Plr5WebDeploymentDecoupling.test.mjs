import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const BASE_SHA = '52168ef28651e9440ecf97eed7bd6bb79899b43a';
const DENYLIST = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_TOKEN',
  'DATABASE_URL',
  'postgresql://',
  'postgres://',
  'R2_SECRET',
  'STREAM_SECRET',
];
const DOCUMENTARY_ALLOWLIST = new Set([
  'docs/superpowers/specs/2026-09-24-ads-v2-plr-5-web-deployment-decoupling-design.md',
  'docs/superpowers/plans/2026-09-24-ads-v2-plr-5-web-deployment-decoupling.md',
  'docs/runbooks/ads-v2-plr-5-web-deployment.md',
  'tests/adsV2Plr5WebDeploymentDecoupling.test.mjs',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.json', '.jsonc', '.md']);

const readJson = async (path) => JSON.parse(await readFile(join(ROOT, path), 'utf8'));

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

async function filesUnder(path) {
  const absolute = join(ROOT, path);
  const entries = await readdir(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', '.superpowers'].includes(entry.name)) continue;
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(relative(ROOT, child)));
    else result.push(relative(ROOT, child).replaceAll('\\', '/'));
  }
  return result;
}

async function bundleFiles(path) {
  const absolute = join(ROOT, path);
  const result = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) result.push(...await bundleFiles(relative(ROOT, child)));
    else result.push(relative(ROOT, child).replaceAll('\\', '/'));
  }
  return result;
}

test('keeps Business and Admin build/deploy scripts isolated', async () => {
  const root = await readJson('package.json');
  const business = await readJson('apps/business-web/package.json');
  const admin = await readJson('apps/admin-web/package.json');

  assert.doesNotMatch(JSON.stringify(business.scripts), /public-web|admin-web|web-frontdoor|nelyon-web/);
  assert.doesNotMatch(JSON.stringify(admin.scripts), /public-web|business-web|web-frontdoor|nelyon-web/);

  for (const [name, command] of Object.entries(root.scripts)) {
    if (!name.includes(':web:') && name !== 'test:ads-v2-plr-5') continue;
    const appReferences = ['apps/business-web', 'apps/admin-web', 'apps/public-web', 'apps/web-frontdoor']
      .filter((value) => command.includes(value));
    assert.ok(appReferences.length <= 1, `${name} invokes multiple web apps: ${appReferences.join(', ')}`);
    assert.doesNotMatch(name, /deploy:all|deploy-all/);
  }

  assert.match(root.scripts['business:web:deploy:isolated'] ?? '', /apps\/business-web/);
  assert.match(root.scripts['admin:web:deploy:isolated'] ?? '', /apps\/admin-web/);
  assert.match(root.scripts['test:web:deployment:local'] ?? '', /smoke-local-web-deployments/);
});

test('leaves Public and frontdoor byte-identical to the approved base', () => {
  for (const path of [
    'apps/public-web',
    'apps/web-frontdoor/package.json',
    'apps/web-frontdoor/wrangler.jsonc',
    'apps/web-frontdoor/src/worker.mjs',
  ]) {
    const result = git(['diff', '--quiet', BASE_SHA, '--', path]);
    assert.equal(result.status, 0, `${path} differs from ${BASE_SHA}`);
  }
});

test('contains exactly one production route and keeps Admin route-unbound', async () => {
  const configs = [
    ...await filesUnder('apps/business-web/deployment'),
    ...await filesUnder('apps/admin-web/deployment'),
  ].filter((path) => path.endsWith('.jsonc'));
  const routeOwners = [];
  for (const path of configs) {
    const content = await readFile(join(ROOT, path), 'utf8');
    if (content.includes('nelyon.app/business/*')) routeOwners.push(path);
    assert.equal(content.includes('nelyon.app/business*"'), false, `broad Business route in ${path}`);
  }
  assert.deepEqual(routeOwners, ['apps/business-web/deployment/wrangler.route.jsonc']);
  await assert.rejects(access(join(ROOT, 'apps/admin-web/deployment/wrangler.production.jsonc')));
});

test('creates no PLR-5 migration and retains the 288-migration history', async () => {
  const migrations = (await readdir(join(ROOT, 'supabase/migrations'))).filter((name) => name.endsWith('.sql'));
  assert.equal(migrations.length, 288);
  assert.equal(migrations.some((name) => /plr[_-]?5/i.test(name)), false);
});

test('allows denylist literals only in exact documentary paths', async () => {
  const optionalFiles = [];
  try {
    await access(join(ROOT, 'scripts/smoke-local-web-deployments.mjs'));
    optionalFiles.push('scripts/smoke-local-web-deployments.mjs');
  } catch {}
  const implementationFiles = [
    ...await filesUnder('shared/web-deployment'),
    ...await filesUnder('apps/business-web/deployment'),
    ...await filesUnder('apps/admin-web/deployment'),
    'apps/business-web/package.json',
    'apps/admin-web/package.json',
    'package.json',
    ...optionalFiles,
    ...DOCUMENTARY_ALLOWLIST,
  ];

  for (const path of new Set(implementationFiles)) {
    if (!SOURCE_EXTENSIONS.has(extname(path))) continue;
    const content = await readFile(join(ROOT, path), 'utf8');
    const matches = DENYLIST.filter((literal) => content.includes(literal));
    if (matches.length > 0) {
      assert.equal(DOCUMENTARY_ALLOWLIST.has(path), true, `${path} contains denylist literals: ${matches.join(', ')}`);
    }
  }
});

test('generated bundles contain no server-secret references', async () => {
  for (const directory of ['apps/business-web/dist', 'apps/admin-web/dist']) {
    for (const path of await bundleFiles(directory)) {
      const content = await readFile(join(ROOT, path));
      const text = content.toString('utf8');
      for (const literal of DENYLIST) assert.equal(text.includes(literal), false, `${path} contains ${literal}`);
    }
  }
});

test('actual sensitive environment values occur in no tracked file or bundle', async () => {
  const sensitiveNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_TOKEN',
    'DATABASE_URL',
    'R2_SECRET',
    'STREAM_SECRET',
    'POSTGRES_PASSWORD',
    'SUPABASE_DB_PASSWORD',
  ];
  const values = sensitiveNames.map((name) => process.env[name]).filter((value) => value && value.length >= 8);
  if (values.length === 0) return;

  const tracked = git(['ls-files', '-z']);
  assert.equal(tracked.status, 0);
  const trackedPaths = tracked.stdout.split('\0').filter(Boolean);
  const extra = [
    ...await bundleFiles('apps/business-web/dist'),
    ...await bundleFiles('apps/admin-web/dist'),
    ...DOCUMENTARY_ALLOWLIST,
  ];
  for (const path of new Set([...trackedPaths, ...extra])) {
    let content;
    try { content = await readFile(join(ROOT, path)); } catch { continue; }
    const text = content.toString('utf8');
    for (const value of values) assert.equal(text.includes(value), false, `${path} contains a sensitive environment value`);
  }
});

test('provides the approved operational runbook', async () => {
  const runbook = await readFile(join(ROOT, 'docs/runbooks/ads-v2-plr-5-web-deployment.md'), 'utf8');
  for (const required of [
    'LOCAL WRANGLER GATE',
    'EXACT VERSION PROMOTION',
    'ROUTE ROLLBACK',
    'PUBLIC VERSION GUARD',
    'SUPABASE / ADS POSTCHECK',
    'FORBIDDEN: apps/web-frontdoor deploy',
  ]) assert.match(runbook, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
