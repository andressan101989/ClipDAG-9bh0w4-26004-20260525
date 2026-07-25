import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHeadError, headWithRetry } from './helpers/mediaLifecycleHarness.mjs';

test('HEAD 404 is terminal object_missing without retries', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  await assert.rejects(() => headWithRetry(async () => { attempts += 1; throw error; }));
  assert.equal(attempts, 1);
  assert.equal(classifyHeadError(error), 'missing');
});

for (const error of [
  Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
  Object.assign(new Error('unavailable'), { $metadata: { httpStatusCode: 503 } }),
]) {
  test(`HEAD ${error.name} remains retryable`, async () => {
    let attempts = 0;
    await assert.rejects(() => headWithRetry(async () => { attempts += 1; throw error; }));
    assert.equal(attempts, 3);
    assert.equal(classifyHeadError(error), 'transient');
  });
}

test('a valid HEAD succeeds after a transient failure', async () => {
  let attempts = 0;
  const head = await headWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('rate'), { $metadata: { httpStatusCode: 429 } });
    return { ContentLength: 5, ContentType: 'image/png' };
  });
  assert.equal(attempts, 2);
  assert.equal(head.ContentType, 'image/png');
});
