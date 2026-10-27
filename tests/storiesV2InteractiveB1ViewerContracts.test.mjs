import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const client = () => read('services/storyInteractiveClient.ts');
const context = () => read('contexts/StoriesContext.tsx');
const nativeViewer = () => read('components/feature/StoryViewer.native.tsx');
const webViewer = () => read('components/feature/StoryViewer.tsx');
const layer = () => read('components/feature/StoryInteractiveLayer.tsx');
const results = () => read('components/feature/StoryInteractiveResultsSheet.tsx');
const migration = () => read('supabase/migrations/20261027042552_stories_v2_interactive_b1.sql');
const callers = () => [
  read('app/(tabs)/index.tsx'),
  read('app/(tabs)/profile.tsx'),
  read('app/creator/[id].tsx'),
];

test('one typed client owns all five interactive and analytics RPC calls', () => {
  const source = client();
  for (const rpc of [
    'get_story_interactive_state',
    'respond_to_story_element',
    'get_story_interactive_results',
    'moderate_story_question',
    'record_story_event',
  ]) assert.equal((source.match(new RegExp(`rpc\\('${rpc}'`, 'g')) ?? []).length, 1, rpc);
  assert.match(source, /parseStoryInteractiveDefinition/);
  assert.match(source, /STORY_INTERACTIVE_INVALID_RESPONSE/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE/);
});

test('provider orders deterministically and uses one fenced realtime channel for stories plus revisions', () => {
  const source = context();
  assert.match(source, /\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)\s*\.order\('id',\s*\{\s*ascending:\s*false\s*\}\)/s);
  assert.equal((source.match(/\.channel\(`stories-v2:/g) ?? []).length, 1);
  assert.match(source, /table:\s*'stories'/);
  assert.match(source, /table:\s*'story_interactive_revisions'/);
  assert.match(source, /CHANNEL_ERROR|TIMED_OUT|CLOSED/);
  assert.match(source, /realtimeGenerationRef/);
  assert.match(source, /realtimeRevision/);
  assert.match(source, /realtimeRetryAttemptRef\s*=\s*useRef\(0\)/);
  assert.match(source, /realtimeRetryActorRef/);
  assert.doesNotMatch(source, /let retryAttempt\s*=\s*0/);
  const subscribed = source.slice(source.indexOf("status === 'SUBSCRIBED'"), source.indexOf("status === 'SUBSCRIBED'") + 300);
  assert.match(subscribed, /realtimeRetryAttemptRef\.current\s*=\s*0/);
});

test('both viewers anchor by story id and record organic impressions only after media readiness', () => {
  for (const source of [nativeViewer(), webViewer()]) {
    assert.match(source, /resolveStoryAnchor/);
    assert.match(source, /setCurrentStoryId/);
    assert.match(source, /mediaReady[\s\S]{0,500}recordStoryEvent|recordStoryEvent[\s\S]{0,500}mediaReady/);
    assert.doesNotMatch(source, /visible\s*&&\s*currentStoryId\s*&&\s*!isAdvertisingStory\s*&&\s*onMarkViewed/);
    assert.match(source, /StoryInteractiveLayer/);
    assert.match(source, /interactionFocused/);
    assert.match(source, /!storyId\s*\|\|\s*!onRecordStoryEvent\s*\|\|\s*isAdvertisingStory\s*\|\|\s*isOwnStory/);
    assert.doesNotMatch(source, /onMarkViewed/);
  }
  for (const source of callers()) assert.doesNotMatch(source, /onMarkViewed=|markStoryViewed,/);
});

test('analytics retries are owned by cancellable timer refs and stop on close or unmount', () => {
  for (const source of [nativeViewer(), webViewer()]) {
    assert.match(source, /analyticsRetryTimersRef\s*=\s*useRef\(new Map/);
    assert.match(source, /clearAnalyticsRetryTimers/);
    assert.match(source, /analyticsActiveRef\.current\s*=\s*false/);
    assert.match(source, /return \(\) => \{[\s\S]{0,250}clearAnalyticsRetryTimers\(\)/);
    assert.doesNotMatch(source, /if \(!retry\) setTimeout\(/);
  }
});

test('owner analytics is a locked stable no-op before rate limits, receipts, views, or events', () => {
  const source = migration();
  const fn = source.slice(source.indexOf('create function public.record_story_event'), source.indexOf('revoke all on function public.record_story_event'));
  const owner = fn.indexOf("'owner_ignored'");
  assert.ok(owner > fn.indexOf('pg_advisory_xact_lock'));
  assert.ok(owner > fn.indexOf('for share'));
  for (const mutation of ['story_consume_velocity', 'insert into private.story_analytics_events', 'mark_story_viewed', 'insert into public.idempotency_keys']) {
    assert.ok(owner < fn.indexOf(mutation), `${mutation} must occur after the owner no-op`);
  }
  assert.match(client(), /data\.status !== 'recorded'\s*&&\s*data\.status !== 'owner_ignored'/);
});

test('positioned reactions use the canonical element response RPC and never the legacy reaction rail authority', () => {
  const source = layer();
  assert.match(source, /definition\.type === 'reaction'/);
  assert.match(source, /onRespond/);
  assert.doesNotMatch(source, /setStoryReaction|story_reactions|onSetReaction/);
});

test('owner results are paginated and question moderation remains owner/private', () => {
  const source = results();
  assert.match(source, /nextCursor/);
  assert.match(source, /hasMore/);
  assert.match(source, /onModerate/);
  assert.match(source, /moderationState/);
  assert.doesNotMatch(source, /console\.log\([^)]*(respondent|payload)/i);
});

test('viewer emits completion, forward, back, exit and replay through the analytics authority', () => {
  for (const source of [nativeViewer(), webViewer()]) {
    for (const event of ['completion', 'forward', 'back', 'exit', 'replay']) {
      assert.match(source, new RegExp(`recordViewerEvent\\('${event}'`), event);
    }
  }
});
