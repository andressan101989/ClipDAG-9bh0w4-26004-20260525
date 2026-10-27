import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../components/feature/storyViewerRuntime.ts', import.meta.url);

async function loadRuntime() {
  const source = readFileSync(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('story ordering is deterministic by createdAt then id, both descending', async () => {
  const runtime = await loadRuntime();
  const stories = [
    { id: 'a', createdAt: '2026-10-27T01:00:00.000Z' },
    { id: 'c', createdAt: '2026-10-27T01:00:00.000Z' },
    { id: 'b', createdAt: '2026-10-27T02:00:00.000Z' },
  ];
  assert.deepEqual(runtime.sortStoriesDeterministically(stories).map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(stories.map(item => item.id), ['a', 'c', 'b'], 'sorting must not mutate provider state');
});

test('story identity stays anchored across realtime insertions ahead of it', async () => {
  const runtime = await loadRuntime();
  const before = [{ id: 'b' }, { id: 'a' }];
  assert.deepEqual(runtime.resolveStoryAnchor(before, 'a', 1), { id: 'a', index: 1 });
  const after = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  assert.deepEqual(runtime.resolveStoryAnchor(after, 'a', 1), { id: 'a', index: 2 });
  assert.deepEqual(runtime.resolveStoryAnchor(after, 'missing', 1), { id: 'b', index: 1 });
  assert.equal(runtime.resolveStoryAnchor([], 'a', 0), null);
});

test('navigation resolves from the anchored id and never from a stale array index', async () => {
  const runtime = await loadRuntime();
  const stories = [{ id: 'new' }, { id: 'current' }, { id: 'old' }];
  assert.equal(runtime.storyNavigationTarget(stories, 'current', 'next'), 'old');
  assert.equal(runtime.storyNavigationTarget(stories, 'current', 'previous'), 'new');
  assert.equal(runtime.storyNavigationTarget(stories, 'missing', 'next'), null);
});

test('realtime recovery is bounded exponential backoff and recognizes terminal channel states', async () => {
  const runtime = await loadRuntime();
  assert.equal(runtime.isRealtimeRecoveryStatus('SUBSCRIBED'), false);
  for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    assert.equal(runtime.isRealtimeRecoveryStatus(status), true);
  }
  assert.equal(runtime.realtimeRetryDelay(0, 0.5), 1000);
  assert.equal(runtime.realtimeRetryDelay(3, 0.5), 8000);
  assert.equal(runtime.realtimeRetryDelay(20, 0.5), 30000);
});

test('interactive payload identity is canonical and slider values are bounded', async () => {
  const runtime = await loadRuntime();
  assert.equal(
    runtime.storyInteractionPayloadKey('story', 'element', { value: 0.5, option_id: 'a' }),
    runtime.storyInteractionPayloadKey('story', 'element', { option_id: 'a', value: 0.5 }),
  );
  assert.equal(runtime.normalizeStorySliderValue(-1), 0);
  assert.equal(runtime.normalizeStorySliderValue(0.42), 0.42);
  assert.equal(runtime.normalizeStorySliderValue(4), 1);
});

test('viewer navigation is suppressed while an interactive responder owns the gesture', async () => {
  const runtime = await loadRuntime();
  assert.equal(runtime.shouldNavigateStory({ interactionFocused: true, holdTriggered: false }), false);
  assert.equal(runtime.shouldNavigateStory({ interactionFocused: false, holdTriggered: true }), false);
  assert.equal(runtime.shouldNavigateStory({ interactionFocused: false, holdTriggered: false }), true);
});
