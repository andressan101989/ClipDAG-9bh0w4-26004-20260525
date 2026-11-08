import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const migrations = 'supabase/migrations';
const suffix = '_web_control_centers_b2_scheduled_publishing.sql';

test('B2 owner authority is forward-only with private worker storage', () => {
  const names = readdirSync(migrations).filter(name => name.endsWith(suffix));
  assert.equal(names.length, 1, 'exactly one B2 migration is required');
  const sql = readFileSync(`${migrations}/${names[0]}`, 'utf8').toLowerCase();
  for (const name of ['publication_schedules', 'publication_schedule_commands', 'publication_schedule_attempts', 'publication_schedule_materializations', 'schedule_my_publication_draft_v1', 'list_my_publication_schedules_v1', 'reschedule_my_publication_v1', 'cancel_my_publication_schedule_v1', 'retry_my_publication_schedule_v1']) {
    assert.ok(sql.includes(name), `missing ${name}`);
  }
  assert.match(sql, /force row level security/);
  assert.doesNotMatch(sql, /\brollback\s*;/);
  assert.match(sql, /commit\s*;/);
});

test('B2 owner PostgreSQL proof: time, replay, ownership, CAS, pagination, privacy and ACL/RLS', { timeout: 650_000 }, t => {
  const result = spawnSync(process.execPath, ['scripts/prove-web-control-centers-b2-owner-disposable.mjs'], {
    encoding: 'utf8', windowsHide: true, timeout: 600_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /B2_OWNER_DISPOSABLE_PASS/);
  assert.match(result.stdout, /"serverStopped":true,"directoryRemoved":true/);
  t.diagnostic(result.stdout.trim());
});

// Focused worker and final concurrent proofs remain independently executable.
test('B2 worker: service-only claims, materialization and shared B1 publication core', {timeout:650_000}, t => {
  const result=spawnSync(process.execPath,['scripts/prove-web-control-centers-b2-worker-disposable.mjs'],{encoding:'utf8',windowsHide:true,timeout:600_000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/B2_WORKER_DISPOSABLE_PASS/);
  assert.match(result.stdout,/"serverStopped":true,"directoryRemoved":true/);
  t.diagnostic(result.stdout.trim());
});
test('B2 concurrency: deterministic PostgreSQL sessions, fencing, recovery and real Content Safety', {timeout:650_000}, t => {
  const result=spawnSync(process.execPath,['scripts/prove-web-control-centers-b2-disposable.mjs'],{encoding:'utf8',windowsHide:true,timeout:600_000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/B2_CONCURRENCY_DISPOSABLE_PASS/);
  assert.match(result.stdout,/"serverStopped":true,"directoryRemoved":true/);
  t.diagnostic(result.stdout.trim());
});
