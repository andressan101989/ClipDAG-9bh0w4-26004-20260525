import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const readOptional = path => {
  const url = new URL(path, root);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
};

async function loadCoordinator() {
  try {
    return await import(new URL(
      '../services/personalizationRuntimeCoordinator.ts',
      import.meta.url,
    ));
  } catch (error) {
    assert.fail(`C3 runtime coordinator must be importable: ${error?.message ?? error}`);
  }
}

test('new authenticated account cannot claim a Feed load until personalization is ready', async () => {
  const { PersonalizationFeedLoadCoordinator } = await loadCoordinator();
  const coordinator = new PersonalizationFeedLoadCoordinator();

  assert.equal(coordinator.claim({
    viewerId: '00000000-0000-4000-8000-000000000001',
    feedReady: false,
    personalizationRevision: null,
  }), false);
  assert.equal(coordinator.claim({
    viewerId: '00000000-0000-4000-8000-000000000001',
    feedReady: true,
    personalizationRevision: '2026-10-06T20:00:00.000Z',
  }), true);
  assert.equal(coordinator.claim({
    viewerId: '00000000-0000-4000-8000-000000000001',
    feedReady: true,
    personalizationRevision: '2026-10-06T20:00:00.000Z',
  }), false);
});

test('same revision does not reload while a new committed revision refreshes exactly once', async () => {
  const { PersonalizationFeedLoadCoordinator } = await loadCoordinator();
  const coordinator = new PersonalizationFeedLoadCoordinator();
  const viewerId = '00000000-0000-4000-8000-000000000002';

  assert.equal(coordinator.claim({ viewerId, feedReady: true, personalizationRevision: 'revision-a' }), true);
  assert.equal(coordinator.claim({ viewerId, feedReady: false, personalizationRevision: null }), false);
  assert.equal(coordinator.claim({ viewerId, feedReady: true, personalizationRevision: 'revision-a' }), false);
  assert.equal(coordinator.claim({ viewerId, feedReady: true, personalizationRevision: 'revision-b' }), true);
  assert.equal(coordinator.claim({ viewerId, feedReady: true, personalizationRevision: 'revision-b' }), false);
});

test('switching users blocks the new user and never reuses the previous load identity', async () => {
  const {
    PersonalizationFeedLoadCoordinator,
    getEffectivePersonalizationRuntime,
  } = await loadCoordinator();
  const coordinator = new PersonalizationFeedLoadCoordinator();

  assert.equal(coordinator.claim({ viewerId: 'user-a', feedReady: true, personalizationRevision: 'a-1' }), true);
  assert.deepEqual(getEffectivePersonalizationRuntime({
    authenticatedUserId: 'user-b',
    runtimeUserId: 'user-a',
    feedReady: true,
    personalizationRevision: 'a-1',
  }), { feedReady: false, personalizationRevision: null });
  assert.equal(coordinator.claim({ viewerId: 'user-b', feedReady: false, personalizationRevision: null }), false);
  assert.equal(coordinator.claim({ viewerId: 'user-b', feedReady: true, personalizationRevision: 'b-1' }), true);
  assert.equal(coordinator.claim({ viewerId: 'user-b', feedReady: true, personalizationRevision: 'b-1' }), false);
});

test('switching away and back resets only the cleared Feed load identity', async () => {
  const { PersonalizationFeedLoadCoordinator } = await loadCoordinator();
  const coordinator = new PersonalizationFeedLoadCoordinator();

  assert.equal(coordinator.claim({ viewerId: 'user-a', feedReady: true, personalizationRevision: 'a-1' }), true);
  coordinator.reset();
  assert.equal(coordinator.claim({ viewerId: 'user-b', feedReady: false, personalizationRevision: null }), false);
  assert.equal(coordinator.claim({ viewerId: 'user-b', feedReady: true, personalizationRevision: 'b-1' }), true);
  coordinator.reset();
  assert.equal(coordinator.claim({ viewerId: 'user-a', feedReady: true, personalizationRevision: 'a-1' }), true);
});

test('fail-open readiness without a revision produces at most one Feed load', async () => {
  const { PersonalizationFeedLoadCoordinator } = await loadCoordinator();
  const coordinator = new PersonalizationFeedLoadCoordinator();
  const state = { viewerId: 'user-fail-open', feedReady: true, personalizationRevision: null };

  assert.equal(coordinator.claim(state), true);
  assert.equal(coordinator.claim(state), false);
  assert.equal(coordinator.claim({ ...state, feedReady: false }), false);
  assert.equal(coordinator.claim(state), false);
});

test('runtime revision uses server preferences timestamp with completion fallback', async () => {
  const { getPersonalizationRevision } = await loadCoordinator();

  assert.equal(getPersonalizationRevision({
    preferencesUpdatedAt: 'preferences-revision',
    onboardingCompletedAt: 'completion-revision',
  }), 'preferences-revision');
  assert.equal(getPersonalizationRevision({
    preferencesUpdatedAt: null,
    onboardingCompletedAt: 'completion-revision',
  }), 'completion-revision');
  assert.equal(getPersonalizationRevision({
    preferencesUpdatedAt: null,
    onboardingCompletedAt: null,
  }), null);
});

test('one runtime context wires the gate, FeedProvider, and onboarding revalidation', () => {
  const runtime = readOptional('contexts/PersonalizationRuntimeContext.tsx');
  const gate = read('components/feature/PersonalizationGate.tsx');
  const feed = read('contexts/FeedContext.tsx');
  const onboarding = read('app/onboarding/personalization.tsx');

  assert.match(runtime, /createContext<\s*PersonalizationRuntimeContextValue/);
  assert.equal((runtime.match(/createContext</g) ?? []).length, 1);
  assert.match(gate, /<PersonalizationRuntimeContext\.Provider/);
  assert.match(gate, /feedReady/);
  assert.match(gate, /personalizationRevision/);
  assert.match(gate, /invalidatePersonalization/);
  assert.match(gate, /revalidatePersonalization/);
  assert.match(feed, /usePersonalizationRuntime\(\)/);
  assert.match(feed, /PersonalizationFeedLoadCoordinator/);
  assert.match(feed, /feedEligibilityRef/);
  assert.match(feed, /feedLoadCoordinatorRef\.current!\.reset\(\)/);
  assert.match(onboarding, /usePersonalizationRuntime\(\)/);
  assert.match(onboarding, /invalidatePersonalization\(\)/);
  assert.match(onboarding, /await revalidatePersonalization\(/);
});

test('C3 preserves the C2 persistent-tree and blocking-overlay contract', () => {
  const gate = read('components/feature/PersonalizationGate.tsx');
  const layout = read('app/_layout.tsx');

  assert.match(gate, /\{children\}/);
  assert.match(gate, /StyleSheet\.absoluteFillObject/);
  assert.match(gate, /pointerEvents=["']auto["']/);
  assert.doesNotMatch(gate, /setTimeout|setInterval/);
  assert.equal((layout.match(/<PersonalizationGate>/g) ?? []).length, 1);
  assert.equal((layout.match(/<FeedProvider>/g) ?? []).length, 1);
  assert.equal((layout.match(/<Stack\s/g) ?? []).length, 1);
  assert.match(layout, /contentStyle:\s*\{\s*backgroundColor:\s*Colors\.bg\s*\}/);
});

test('C3 adds no second Feed or server personalization authority', () => {
  const files = [
    read('contexts/FeedContext.tsx'),
    read('components/feature/PersonalizationGate.tsx'),
    read('app/onboarding/personalization.tsx'),
    readOptional('contexts/PersonalizationRuntimeContext.tsx'),
    readOptional('services/personalizationRuntimeCoordinator.ts'),
  ].join('\n');

  assert.doesNotMatch(files, /PersonalizedFeedProvider|ColdStartFeedProvider|FeedV2Provider/);
  assert.equal((read('app/_layout.tsx').match(/<FeedProvider>/g) ?? []).length, 1);
  assert.equal((files.match(/get_ranked_feed_l1_v1/g) ?? []).length, 0,
    'runtime coordination must reuse feedRankingService rather than call the ranking RPC directly');
});
