import assert from 'node:assert/strict';
import test from 'node:test';
import { CleanupQueue, findOrphans } from './helpers/mediaLifecycleHarness.mjs';

test('failed deletion remains queued and succeeds on the next cron cycle', async () => {
  const queue = new CleanupQueue();
  queue.add({ id: 'asset-1' });
  let calls = 0;
  await queue.cycle(async () => { calls += 1; throw new Error('temporary'); });
  assert.equal(queue.rows.get('asset-1').status, 'delete_pending');
  await queue.cycle(async () => { calls += 1; });
  assert.equal(queue.rows.get('asset-1').status, 'deleted');
  assert.equal(calls, 2);
});

test('repeated failures are audited and never forgotten', async () => {
  const queue = new CleanupQueue();
  queue.add({ id: 'asset-2' });
  for (let cycle = 0; cycle < 7; cycle += 1) await queue.cycle(async () => { throw new Error('down'); });
  assert.equal(queue.rows.get('asset-2').status, 'delete_pending');
  assert.equal(queue.rows.get('asset-2').cleanupAttempts, 7);
});

test('only ready unlinked assets older than 24 hours are orphan cleanup candidates', () => {
  const now = Date.now();
  const assets = [
    { id: 'old-unlinked', status: 'ready', createdAt: now - 25 * 60 * 60 * 1000 },
    { id: 'old-linked', status: 'ready', createdAt: now - 30 * 60 * 60 * 1000 },
    { id: 'new-unlinked', status: 'ready', createdAt: now - 60 * 1000 },
  ];
  assert.deepEqual(findOrphans(assets, new Set(['old-linked']), now).map(item => item.id), ['old-unlinked']);
});
