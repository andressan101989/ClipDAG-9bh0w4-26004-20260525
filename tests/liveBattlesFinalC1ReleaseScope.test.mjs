import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { classifyChangedPaths, parseNameStatusZ } from '../scripts/nelyon-production-release.mjs';

test('C1 candidate has exactly one productive migration and no unsupported release paths', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const baseline = 'a36973d1138d856aa5f3f0d732971de1eba06745';
  const changes = parseNameStatusZ(execFileSync('git', ['diff', '--name-status', '-z', '--no-renames', baseline], { cwd }));
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' })
    .split('\0').filter(Boolean).map(path => ({ status: 'A', path }));
  const result = classifyChangedPaths([...changes, ...untracked]);
  assert.deepEqual(result.productive.map(change => change.path), [
    'supabase/migrations/20261026120000_live_battles_final_c1.sql',
  ]);
  assert.equal(result.migrations.length, 1);
  assert.equal(result.functions.length, 0);
  assert.equal(result.config.length, 0);
  assert.equal(result.shared.length, 0);
  assert.ok(result.other.some(change => change.path === 'tests/fixtures/live_battles_final_c1_fixture.sql'));
});
