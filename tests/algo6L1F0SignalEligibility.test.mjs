import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

function readF0Migration() {
  const names = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l1_f0_signal_eligibility_foundation.sql'));
  assert.equal(names.length, 1, 'exactly one generated F0 migration must exist');
  return readFileSync(new URL(names[0], migrationDirectory), 'utf8').replace(/\r\n/g, '\n');
}

test('F0 migration defines one append-only raw view authority and canonical RPC boundaries', () => {
  const sql = readF0Migration();

  assert.match(sql, /create table public\.video_views\s*\(/i);
  assert.match(sql, /alter table public\.video_views enable row level security/i);
  assert.match(sql, /alter table public\.video_views force row level security/i);
  assert.match(sql, /revoke all (?:privileges )?on table public\.video_views[\s\S]*from public,\s*anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,100}video_views[\s\S]{0,100}(?:anon|authenticated)/i);

  assert.match(sql, /create or replace function public\.record_video_view_v1\s*\(\s*p_video_id uuid,\s*p_client_event_id uuid,\s*p_client_session_id uuid,\s*p_watch_duration_ms bigint,\s*p_exit_reason text\s*\)/i);
  assert.match(sql, /v_actor uuid\s*:=\s*\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /p_(?:viewer|creator|completed|completion_ratio|rewatch_count|views_count)/i);
  assert.match(sql, /security definer[\s\S]{0,80}set search_path\s*(?:=|to)\s*''/i);
  assert.match(sql, /grant execute on function public\.record_video_view_v1\(uuid,uuid,uuid,bigint,text\)\s+to anon,\s*authenticated/i);

  assert.match(sql, /create or replace function public\.get_my_video_analytics_v1\(p_video_id uuid\)/i);
  assert.match(sql, /grant execute on function public\.get_my_video_analytics_v1\(uuid\)\s+to authenticated/i);
  assert.match(sql, /create or replace function public\.reconcile_algo_signal_foundation_v1\(\)/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_signal_foundation_v1\(\)\s+to service_role/i);
});

test('F0 migration makes chronological eligibility and query indexes canonical without ranking', () => {
  const sql = readF0Migration();

  assert.match(sql, /create or replace function private\.video_can_view_owner\(p_owner_id uuid\)/i);
  assert.match(sql, /private\.admin_content_is_visible\('video',\s*id\)[\s\S]{0,180}private\.video_can_view_owner\(user_id\)/i);
  assert.match(sql, /videos_created_id_desc_idx[\s\S]{0,100}\(created_at desc,\s*id desc\)/i);
  assert.match(sql, /videos_user_created_id_desc_idx[\s\S]{0,120}\(user_id,\s*created_at desc,\s*id desc\)/i);
  assert.match(sql, /video_views_viewer_created_idx[\s\S]{0,120}\(viewer_id,\s*created_at desc\)/i);
  assert.match(sql, /video_views_video_created_idx[\s\S]{0,120}\(video_id,\s*created_at desc\)/i);
  assert.doesNotMatch(sql, /\b(score|ranking|recommendation|embedding|pgvector)\b/i);
});

test('playback exposure emits once, excludes background time and keeps its event ID for retry', async () => {
  const { createVideoPlaybackSession } = await import('../services/videoPlaybackSession.ts');
  let now = 1_000;
  let sequence = 0;
  const session = createVideoPlaybackSession({
    now: () => now,
    createEventId: () => `event-${++sequence}`,
  });

  assert.equal(session.start(), 'event-1');
  now = 3_500;
  const backgroundEvent = session.finish('background');
  assert.deepEqual(backgroundEvent, {
    clientEventId: 'event-1',
    watchDurationMs: 2_500,
    exitReason: 'background',
  });
  assert.equal(session.finish('unmount'), null, 'duplicate lifecycle finish must not emit');
  assert.equal(backgroundEvent?.clientEventId, 'event-1', 'the same payload can be retried');

  now = 8_000;
  assert.equal(session.start(), 'event-2', 'resume starts a new exposure after background');
  now = 9_250;
  assert.deepEqual(session.finish('swipe'), {
    clientEventId: 'event-2',
    watchDurationMs: 1_250,
    exitReason: 'swipe',
  });
});

test('playback start is idempotent while active and clamps a backwards clock to zero', async () => {
  const { createVideoPlaybackSession } = await import('../services/videoPlaybackSession.ts');
  let now = 5_000;
  let sequence = 0;
  const session = createVideoPlaybackSession({
    now: () => now,
    createEventId: () => `event-${++sequence}`,
  });

  assert.equal(session.start(), 'event-1');
  assert.equal(session.start(), 'event-1');
  now = 4_000;
  assert.equal(session.finish('unknown')?.watchDurationMs, 0);
});

test('Feed pagination cursor preserves the server snapshot and stable tie breakers', () => {
  const service = readFileSync(new URL('../services/feedRankingService.ts', import.meta.url), 'utf8');

  for (const field of [
    'p_as_of: cursor?.asOf',
    'p_before_score: cursor?.score',
    'p_before_created_at: cursor?.createdAt',
    'p_before_id: cursor?.id',
    'p_policy_version: cursor?.policyVersion',
  ]) {
    assert.ok(service.includes(field), `rank cursor must preserve ${field}`);
  }
  assert.doesNotMatch(service, /\boffset\b|\.range\s*\(/i);
});

test('Feed runtime uses ranked server delivery and RPC-only behavioral access', () => {
  const feed = readFileSync(new URL('../contexts/FeedContext.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(feed, /\bSAMPLE_VIDEOS\b|\bMOCK_COMMENTS\b/);
  assert.doesNotMatch(feed, /\.range\s*\(|\bdbOffset\b/);
  assert.match(feed, /fetchRankedFeedPage\(supabase/);
  assert.match(feed, /setRankCursor\(page\.cursor\)/);
  assert.doesNotMatch(feed, /services\/feedKeyset/);
  assert.doesNotMatch(feed, /if \(!initialLoaded\) \{\s*loadVideos/);
  assert.match(feed, /setVideos\(\[\]\);[\s\S]{0,600}loadVideos\(null, generation\)/);
  assert.match(feed, /deliveryGenerationRef/);
  assert.match(feed, /generation !== deliveryGenerationRef\.current/);
  assert.match(feed, /currentViewerId !== viewerId/);
  assert.match(feed, /\.rpc\('record_video_view_v1'/);
  assert.match(feed, /\.rpc\('get_my_video_analytics_v1'/);
  assert.doesNotMatch(feed, /\.from\('video_views'\)/);
  assert.doesNotMatch(feed, /p_(?:viewer|completed|completion_ratio|rewatch_count|views_count)/);
  assert.match(feed, /result\.status === 'recorded'/);
});

test('native VideoCard finalizes one canonical exposure on swipe, background or unmount', () => {
  const nativeCard = readFileSync(new URL('../components/feature/VideoCard.native.tsx', import.meta.url), 'utf8');
  const webCard = readFileSync(new URL('../components/feature/VideoCard.tsx', import.meta.url), 'utf8');
  const feedScreen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');

  assert.match(nativeCard, /createVideoPlaybackSession/);
  assert.match(nativeCard, /AppState\.addEventListener\('change'/);
  assert.match(nativeCard, /finishExposure\('background'\)/);
  assert.match(nativeCard, /finishExposure\('swipe'\)/);
  assert.match(nativeCard, /finishExposureRef\.current\('unmount'\)/);
  assert.match(nativeCard, /activeViewCallbackRef/);
  assert.match(nativeCard, /onViewTracked\?: \(event: FinalizedVideoView\) => void/);
  assert.match(webCard, /onViewTracked\?: \(event: FinalizedVideoView\) => void/);
  assert.match(feedScreen, /trackView\(videoId, event\)/);
});

test('Profile and My Content load canonical creator rows instead of the Feed window', () => {
  const creatorService = readFileSync(new URL('../services/creatorService.ts', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../app/(tabs)/profile.tsx', import.meta.url), 'utf8');
  const myContent = readFileSync(new URL('../app/my-content.tsx', import.meta.url), 'utf8');

  assert.match(creatorService, /export async function fetchCreatorVideoFeed/);
  assert.match(creatorService, /export async function fetchSavedVideoFeed/);
  assert.match(creatorService, /\.eq\('user_id', userId\)/);
  assert.match(creatorService, /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)/);
  assert.match(profile, /fetchCreatorVideoFeed/);
  assert.match(profile, /setProfileVideos/);
  assert.doesNotMatch(profile, /const \{\s*videos\s*,/);
  assert.match(myContent, /fetchCreatorVideoFeed/);
  assert.match(myContent, /fetchSavedVideoFeed/);
  assert.match(myContent, /setOwnVideos/);
  assert.doesNotMatch(myContent, /videos\.filter\(v => v\.userId === user\?\.id\)/);
});
