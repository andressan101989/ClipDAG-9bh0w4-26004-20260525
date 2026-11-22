import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeB2ReviewedProofEnvironment } from '../scripts/nelyon-b2-authority-preparation.mjs';

const catalogProof = readFileSync(new URL('../scripts/prove-web-control-centers-b2-disposable.mjs', import.meta.url), 'utf8');
const cronProof = readFileSync(new URL('../scripts/prove-web-control-centers-b2-pg-cron-disposable.mjs', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../scripts/nelyon-b2-authority-preparation.mjs', import.meta.url), 'utf8');
const trustedDockerBin = process.platform === 'win32'
  ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
  : '/usr/bin/docker';
const reviewedImageIndexDigest = 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
const reviewedAmd64ManifestDigest = 'sha256:b021e96054128399f84f24e39d29c21ee7c7169515e5d9e4e99ff15d5043d1d8';
const reviewedImageId = 'sha256:2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a';
const reviewedImage = `public.ecr.aws/supabase/postgres@${reviewedImageIndexDigest}`;

test('reviewed OCI index, amd64 manifest and image config remain distinct immutable identities', () => {
  assert.notEqual(reviewedImageIndexDigest, reviewedAmd64ManifestDigest);
  assert.notEqual(reviewedAmd64ManifestDigest, reviewedImageId);
  assert.notEqual(reviewedImageIndexDigest, reviewedImageId);
  assert.match(reviewedImage, new RegExp(`${reviewedImageIndexDigest}$`, 'u'));
  assert.match(reviewedAmd64ManifestDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(reviewedImageId, /^sha256:[0-9a-f]{64}$/u);
});

test('PG17 catalog evidence is branded as a component and excludes every synthetic cron row', () => {
  assert.match(catalogProof, /kind:\s*'nelyon-b2-postgres-catalog-evidence-v1'/);
  assert.match(catalogProof, /mintEligibility:\s*'CATALOG_COMPONENT_ONLY'/);
  assert.match(catalogProof, /syntheticCronAuthorityExcluded:\s*true/);
  assert.match(catalogProof, /pgCronExtension:\s*false/);
  assert.match(catalogProof, /catalogRows:\s*catalogRows\.filter\(row\s*=>\s*row\.kind\s*!==\s*'cron_job'\)/);
  assert.match(catalogProof, /functionSecurityRows,\s*relationAclRows:/,
    'authority evidence must expose the normalized security projection');
  assert.match(catalogProof, /identity:\s*`\$\{row\.schema\}\.\$\{row\.name\}\(\$\{row\.argument_types\.join\(','\)\.replaceAll\(' ',\s*''\)\}\)`/,
    'function security identities must be derived from the exact PostgreSQL argument-type identity');
  for (const field of ['owner', 'securityDefiner', 'searchPath', 'definitionSha256', 'acl', 'execute']) {
    assert.match(catalogProof, new RegExp(`${field}:\\s*`), `normalized function security must retain ${field}`);
  }
  assert.match(catalogProof, /definitionSha256:\s*sha256\(row\.definition\)/,
    'raw definitions must be replaced by a deterministic digest');
  assert.doesNotMatch(catalogProof, /functionSecurityRows:\s*functionRows/,
    'raw function definitions and unrelated fields must not enter the capability');
  assert.match(catalogProof, /capabilitySha256:\s*sha256\(canonicalJson\(core\)\)/);
  assert.match(catalogProof, /20260916045152_canonical_media_ready_identity_immutability_v1\.sql/,
    'the proof setup must load the migration that owns the production trigger bytes');
  assert.match(catalogProof, /extractTrigger\(canonicalMediaIdentity,\s*'media_assets_guard_ready_identity'\)/,
    'the proof setup must install the exact production trigger definition');
  assert.match(catalogProof, /public\.media_assets\.media_assets_guard_ready_identity/,
    'the emitted catalog must require the production trigger identity');
  assert.doesNotMatch(catalogProof, /create\s+trigger\s+proof_identity\b/i,
    'a proof-only trigger identity must never enter authority evidence');
  assert.doesNotMatch(catalogProof, /mintEligibility:\s*'PRODUCTION_(?:AUTHORITY|CRON)_READY'/);
});

test('real pg_cron evidence binds the exact extension, hosted role, image and database normalization', () => {
  assert.match(cronProof, /kind:\s*'nelyon-b2-real-pg-cron-evidence-v1'/);
  assert.match(cronProof, /mintEligibility:\s*'PRODUCTION_CRON_COMPONENT'/);
  assert.match(cronProof, /pgCronVersion:\s*'1\.6\.4'/);
  assert.match(cronProof, /roleSuperuser:\s*false/);
  assert.match(cronProof, /roleBypassRls:\s*true/);
  assert.match(cronProof, /imageId,\s*pgCron:/);
  assert.match(cronProof, /contract:\s*'supabase-hosted-primary-database-v1'/);
  assert.match(cronProof, /observed:\s*'postgres'/);
  assert.match(cronProof, /normalized:\s*'postgres'/);
  assert.match(cronProof, /identity:\s*'process-scheduled-publications-b2'/);
  assert.match(cronProof, /commandSha256:\s*sha256\('select public\.wake_scheduled_publications_b2_v1\(\)'\)/);
  assert.match(cronProof, /capabilitySha256:\s*sha256\(canonicalJson\(core\)\)/);
  assert.match(cronProof, /expectedImageIndexDigest\s*=\s*'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'/);
  assert.match(cronProof, /expectedImageId\s*=\s*'sha256:2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a'/);
  assert.match(cronProof, /image\s*=\s*`public\.ecr\.aws\/supabase\/postgres@\$\{expectedImageIndexDigest\}`/);
  assert.match(cronProof, /assert\.equal\(imageId,\s*expectedImageId/,
    'the image must match one reviewed content digest, not merely a digest-shaped value');
  assert.match(cronProof,
    /pullPolicy\s*=\s*process\.env\.NELYON_B2_REVIEWED_PROOF\s*===\s*'1'\s*\?\s*'always'\s*:\s*'never'/u,
    'a clean reviewed runner fetches the immutable index while direct local proof cannot fall back to a tag');
  assert.match(cronProof, /`--pull=\$\{pullPolicy\}`/u);
  assert.match(cronProof, /'--platform',\s*'linux\/amd64'/u);
  assert.match(cronProof, /assert\.equal\(imageMetadata\.Os,\s*'linux'/u);
  assert.match(cronProof, /assert\.equal\(imageMetadata\.Architecture,\s*'amd64'/u);
  assert.match(cronProof, /imageMetadata\.RepoDigests\.includes\(image\)/u);
  assert.match(cronProof, /run\(dockerBin,\s*args/u,
    'the proof must execute the exact validated Docker binary, never a PATH lookup');
  assert.doesNotMatch(cronProof, /run\(['"]docker['"]/u);
  assert.doesNotMatch(cronProof, /supabase\/postgres:(?!@)/u,
    'no mutable Supabase PostgreSQL tag may enter the proof boundary');
});

test('catalog proof authority mode is portable and bound to the same reviewed image digest', () => {
  assert.doesNotMatch(catalogProof, /D:\/CodexTemp|postgres-17\.11-disposable/u);
  assert.match(catalogProof, /process\.platform\s*===\s*'win32'\s*\?\s*`\$\{tool\}\.exe`\s*:\s*tool/u,
    'local fallback selects the executable suffix by platform instead of hardcoding Windows');
  assert.match(catalogProof, /expectedImageIndexDigest\s*=\s*'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'/);
  assert.match(catalogProof, /expectedImageId\s*=\s*'sha256:2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a'/);
  assert.match(catalogProof, /image\s*=\s*`public\.ecr\.aws\/supabase\/postgres@\$\{expectedImageIndexDigest\}`/);
  assert.match(catalogProof, /assert\.equal\(imageId,\s*expectedImageId/,
    'catalog evidence must bind the exact reviewed runtime bytes');
  assert.match(catalogProof, /dockerMode\s*=\s*process\.argv\.includes\('--authority-evidence'\)/u);
  assert.match(catalogProof,
    /pullPolicy\s*=\s*process\.env\.NELYON_B2_REVIEWED_PROOF\s*===\s*'1'\s*\?\s*'always'\s*:\s*'never'/u,
    'reviewed catalog proof fetches the immutable index while direct local proof remains cache-only');
  assert.match(catalogProof, /`--pull=\$\{pullPolicy\}`/u);
  assert.match(catalogProof, /'--platform',\s*'linux\/amd64'/u);
  assert.match(catalogProof, /assert\.equal\(imageMetadata\.Os,\s*'linux'/u);
  assert.match(catalogProof, /assert\.equal\(imageMetadata\.Architecture,\s*'amd64'/u);
  assert.match(catalogProof, /imageMetadata\.RepoDigests\.includes\(image\)/u);
  assert.doesNotMatch(catalogProof, /(?:host|spawn)\(['"]docker['"]/u,
    'catalog proof must not execute a Docker shim found through PATH');
  assert.doesNotMatch(catalogProof, /supabase\/postgres:(?!@)/u,
    'catalog proof cannot fall back to a mutable image tag');
});

test('reviewed proof child environment rejects preload and package-manager hooks', () => {
  const sanitized = sanitizeB2ReviewedProofEnvironment({
    PATH: '/trusted/bin', HOME: '/trusted/home', TMPDIR: '/tmp', LANG: 'C.UTF-8',
    NELYON_B2_DOCKER_BIN: trustedDockerBin,
    NODE_OPTIONS: '--import=/tmp/hostile.mjs', npm_config_node_options: '--require=/tmp/hostile.cjs',
    NODE_PATH: '/tmp/hostile-node-path', ENV: '/tmp/hostile-env',
    NPM_CONFIG_USERCONFIG: '/tmp/hostile-npmrc', npm_execpath: '/tmp/hostile-npm',
    npm_node_execpath: '/tmp/hostile-node', npm_package_json: '/tmp/hostile-package',
    INIT_CWD: '/tmp/hostile', BASH_ENV: '/tmp/hostile', GITHUB_PATH: '/tmp/hostile-github-path',
    DOCKER_CONTEXT: 'hostile', DOCKER_HOST: 'tcp://hostile.invalid:2375',
    HTTP_PROXY: 'http://hostile.invalid', HTTPS_PROXY: 'http://hostile.invalid',
    ALL_PROXY: 'socks://hostile.invalid', NO_PROXY: '*', FTP_PROXY: 'http://hostile.invalid',
    RSYNC_PROXY: 'hostile.invalid:873', http_proxy: 'http://hostile.invalid',
    SUPABASE_ACCESS_TOKEN: 'secret', CLOUDFLARE_API_TOKEN: 'secret',
  });
  assert.deepEqual({ ...sanitized }, {
    HOME: '/trusted/home', LANG: 'C.UTF-8', PATH: '/trusted/bin', TMPDIR: '/tmp',
    CI: 'true', NO_COLOR: '1', NELYON_B2_DOCKER_BIN: trustedDockerBin, NELYON_B2_REVIEWED_PROOF: '1',
  });
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ENV', 'npm_config_node_options', 'NPM_CONFIG_USERCONFIG',
    'npm_execpath', 'npm_node_execpath', 'npm_package_json', 'INIT_CWD', 'BASH_ENV', 'GITHUB_PATH',
    'DOCKER_CONTEXT', 'DOCKER_HOST', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'FTP_PROXY',
    'RSYNC_PROXY', 'http_proxy',
    'SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN']) assert.equal(Object.hasOwn(sanitized, key), false);
  assert.throws(() => sanitizeB2ReviewedProofEnvironment({
    PATH: '/tmp/hostile-shim', NELYON_B2_DOCKER_BIN: process.platform === 'win32'
      ? 'C:\\tmp\\docker.exe' : '/tmp/docker',
  }), 'a caller-selected Docker executable must fail closed');
  assert.throws(() => sanitizeB2ReviewedProofEnvironment(new Proxy({}, { ownKeys() { throw new Error('hostile'); } })));
  assert.throws(() => sanitizeB2ReviewedProofEnvironment(Object.defineProperty({}, 'PATH', {
    enumerable: true, get() { throw new Error('hostile accessor'); },
  })));
  assert.doesNotMatch(preparation, /env:\s*\{\s*\.\.\.process\.env/u);
});

test('neither component alone claims complete private-authority mint eligibility', () => {
  for (const proof of [catalogProof, cronProof]) {
    assert.doesNotMatch(proof, /mintEligibility:\s*'(?:AUTHORITY_READY|PRODUCTION_AUTHORITY|MINT_READY)'/);
  }
});

test('only the fixed reviewed child-process boundary can mint opaque evidence capabilities', () => {
  assert.doesNotMatch(preparation, /export function attestB2(?:PostgresCatalog|RealPgCron)Evidence/u);
  assert.match(preparation, /export function runB2ReviewedAuthorityEvidenceProofs\(\)/u);
  assert.match(preparation, /execFileSync\(process\.execPath, \[runner, '--authority-evidence'\]/u);
  assert.match(preparation, /NELYON_B2_DOCKER_BIN/u);
  assert.match(preparation, /path: 'scripts\/prove-web-control-centers-b2-disposable\.mjs'/u);
  assert.match(preparation, /path: 'scripts\/prove-web-control-centers-b2-pg-cron-disposable\.mjs'/u);
  assert.match(preparation, /postgresCatalogEvidenceValues\.set\(catalogEvidence, catalogValue\)/u);
  assert.match(preparation, /pgCronEvidenceValues\.set\(pgCronEvidence, cronValue\)/u);
});
