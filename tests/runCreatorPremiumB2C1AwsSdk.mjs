import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const packageRoot = (process.env.PATH ?? '')
  .split(path.delimiter)
  .filter(Boolean)
  .map(entry => path.resolve(entry, '..'))
  .find(root =>
    existsSync(path.join(root, '@aws-sdk/client-s3/package.json'))
    && existsSync(path.join(root, '@aws-sdk/s3-request-presigner/package.json')),
  );

assert.ok(
  packageRoot,
  'Pinned AWS SDK packages are unavailable; invoke this runner through the documented npx --package command',
);

const targets = process.argv.slice(2);
if (targets.length === 0) {
  targets.push('tests/creatorPremiumB2C1NoStoreHardening.test.mjs');
}

const result = spawnSync(process.execPath, ['--test', ...targets], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CREATOR_PREMIUM_C1_AWS_SDK_ROOT: packageRoot,
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
