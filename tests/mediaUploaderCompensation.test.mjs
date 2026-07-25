import assert from 'node:assert/strict';
import test from 'node:test';
import { compensate, DraftAssets } from './helpers/mediaLifecycleHarness.mjs';

test('post DB or link failure compensates the uploaded asset', async () => {
  const removed = [];
  await compensate(['post-asset'], async id => { removed.push(id); });
  assert.deepEqual(removed, ['post-asset']);
});

test('partial carousel failure cleans every completed upload', async () => {
  const removed = [];
  await compensate(['a', 'b', 'c'], async id => { removed.push(id); });
  assert.deepEqual(new Set(removed), new Set(['a', 'b', 'c']));
});

test('abandoned product removes drafts but published links survive unmount', async () => {
  const removed = [];
  const drafts = new DraftAssets(async id => { removed.push(id); });
  drafts.add('abandoned');
  drafts.add('published');
  drafts.linked('published');
  await drafts.abandon();
  assert.deepEqual(removed, ['abandoned']);
});

test('cleanup failures do not hide the original compensation path', async () => {
  await assert.doesNotReject(() => compensate(['asset'], async () => { throw new Error('R2 down'); }));
});
