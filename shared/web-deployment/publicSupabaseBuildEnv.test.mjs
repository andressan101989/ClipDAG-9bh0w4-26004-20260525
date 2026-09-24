import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_PUBLIC_SUPABASE_PROJECT_REF,
  resolvePublicSupabaseBuildEnv,
} from './publicSupabaseBuildEnv.mjs';
import { runNpmBuild } from './buildPublicSupabaseSpa.mjs';

const canonicalUrl = `https://${EXPECTED_PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`;
const publicKey = 'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
const allowedKeySha256 = new Set([createHash('sha256').update(publicKey).digest('hex')]);

test('normalizes one canonical public config for both Vite clients', async () => {
  const result = await resolvePublicSupabaseBuildEnv({
    environment: {
      EXPO_PUBLIC_SUPABASE_URL: canonicalUrl,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: publicKey,
    },
    loadFallbackFile: false,
    allowedKeySha256,
  });

  assert.equal(result.projectRef, EXPECTED_PUBLIC_SUPABASE_PROJECT_REF);
  assert.equal(result.source, 'environment:expo_public');
  assert.equal(result.buildEnvironment.VITE_SUPABASE_URL, canonicalUrl);
  assert.equal(result.buildEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY, publicKey);
  assert.equal(result.buildEnvironment.VITE_SUPABASE_ANON_KEY, publicKey);
  assert.match(result.keySha256, /^[a-f0-9]{64}$/);
});

test('rejects malformed, unbound, and wrong-project public keys', async () => {
  const legacyWithoutRef = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
    Buffer.from('unsigned-test-signature').toString('base64url'),
  ].join('.');
  for (const key of [
    'sb_publishable_..........',
    legacyWithoutRef,
    'sb_publishable_1234567890abcdefghijklmnopqrstu',
  ]) {
    await assert.rejects(
      resolvePublicSupabaseBuildEnv({
        environment: {
          VITE_SUPABASE_URL: canonicalUrl,
          VITE_SUPABASE_PUBLISHABLE_KEY: key,
        },
        loadFallbackFile: false,
        allowedKeySha256,
      }),
      { message: /public_supabase_key_(invalid|project_mismatch)/ },
    );
  }
});

test('rejects missing URL and key with stable fail-fast codes', async () => {
  await assert.rejects(
    resolvePublicSupabaseBuildEnv({ environment: {}, loadFallbackFile: false }),
    { message: 'public_supabase_url_required' },
  );
  await assert.rejects(
    resolvePublicSupabaseBuildEnv({
      environment: { VITE_SUPABASE_URL: canonicalUrl },
      loadFallbackFile: false,
    }),
    { message: 'public_supabase_key_required' },
  );
});

test('rejects a public config for another Supabase project', async () => {
  await assert.rejects(
    resolvePublicSupabaseBuildEnv({
      environment: {
        VITE_SUPABASE_URL: 'https://differentprojectref.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
      },
      loadFallbackFile: false,
    }),
    { message: 'public_supabase_project_mismatch' },
  );
});

test('rejects a server key form', async () => {
  await assert.rejects(
    resolvePublicSupabaseBuildEnv({
      environment: {
        VITE_SUPABASE_URL: canonicalUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden_server_key',
      },
      loadFallbackFile: false,
    }),
    { message: 'public_supabase_server_key_forbidden' },
  );
});

test('loads the existing root public env convention without exposing values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nelyon-public-env-'));
  const source = join(directory, '.env');
  try {
    await writeFile(source, [
      `EXPO_PUBLIC_SUPABASE_URL=${canonicalUrl}`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY=${publicKey}`,
      '',
    ].join('\n'));
    const result = await resolvePublicSupabaseBuildEnv({
      environment: { NELYON_PUBLIC_ENV_FILE: source },
      loadFallbackFile: true,
      allowedKeySha256,
    });
    assert.equal(result.source, 'file:explicit');
    assert.equal(result.buildEnvironment.VITE_SUPABASE_ANON_KEY, publicKey);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI precheck fails before invoking the build when config is absent or wrong', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nelyon-public-build-'));
  const marker = join(directory, 'build-ran.txt');
  const script = fileURLToPath(new URL('./buildPublicSupabaseSpa.mjs', import.meta.url));
  const packageJson = {
    private: true,
    scripts: { build: `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"` },
  };
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify(packageJson));
    const cleanEnvironment = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
    };
    const missing = spawnSync(process.execPath, [script], {
      cwd: directory,
      env: cleanEnvironment,
      encoding: 'utf8',
    });
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}${missing.stderr}`, /public_supabase_url_required/);
    await assert.rejects(readFile(marker));

    const wrong = spawnSync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...cleanEnvironment,
        VITE_SUPABASE_URL: 'https://differentprojectref.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
      },
      encoding: 'utf8',
    });
    assert.notEqual(wrong.status, 0);
    assert.match(`${wrong.stdout}${wrong.stderr}`, /public_supabase_project_mismatch/);
    await assert.rejects(readFile(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('build runner invokes the npm entrypoint through Node', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nelyon-public-build-valid-'));
  const marker = join(directory, 'build-ran.txt');
  const fakeNpm = join(directory, 'fake-npm.mjs');
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true }));
    await writeFile(fakeNpm, [
      "import { writeFileSync } from 'node:fs';",
      "if (process.argv.slice(2).join(' ') !== 'run build') process.exit(2);",
      "writeFileSync(process.env.TEST_BUILD_MARKER, 'ran');",
      '',
    ].join('\n'));
    const status = runNpmBuild({
      npmEntrypoint: fakeNpm,
      cwd: directory,
      environment: {
        PATH: process.env.PATH,
        Path: process.env.Path,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEST_BUILD_MARKER: marker,
      },
    });
    assert.equal(status, 0);
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
