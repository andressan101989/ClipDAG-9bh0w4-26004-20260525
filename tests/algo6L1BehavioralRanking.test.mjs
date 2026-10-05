import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

function readL1Migration() {
  const names = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l1_behavioral_ranking.sql'));
  assert.equal(names.length, 1, 'exactly one generated L1 migration must exist');
  return readFileSync(new URL(names[0], migrationDirectory), 'utf8').replace(/\r\n/g, '\n');
}

function functionBody(sql, name) {
  const start = sql.toLowerCase().indexOf(`create or replace function ${name.toLowerCase()}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = sql.toLowerCase().indexOf('\ncreate or replace function ', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test('L1 migration creates one private constrained zero-rollout policy', () => {
  const sql = readL1Migration();

  assert.match(sql, /create table private\.algo_l1_policy\s*\(/i);
  assert.match(sql, /alter table private\.algo_l1_policy enable row level security/i);
  assert.match(sql, /alter table private\.algo_l1_policy force row level security/i);
  assert.match(sql, /revoke all (?:privileges )?on table private\.algo_l1_policy[\s\S]*from public,\s*anon,\s*authenticated,\s*service_role/i);
  assert.doesNotMatch(sql, /create policy[\s\S]{0,100}algo_l1_policy/i);

  for (const literal of [
    "'nelyon-algo-l1-v1'", 'true', '0', '200', '50', '168',
    '30', '20', '8', '10', '12', '6', '5', '0.20', '35', '25',
    '5', '20', '100', '3', '2', '30',
  ]) {
    assert.ok(sql.includes(literal), `policy seed must contain ${literal}`);
  }

  assert.match(sql, /create or replace function private\.guard_algo_l1_policy_v1\(\)/i);
  assert.match(sql, /create trigger algo_l1_policy_version_guard/i);
  assert.match(sql, /algo_l1_policy_version_required/i);
  assert.match(sql, /new\.updated_at\s*:=\s*clock_timestamp\(\)/i);
  assert.match(sql, /t\.tgenabled\s*=\s*'O'/i);
  assert.match(sql, /t\.tgtype\s*=\s*19/i);
  assert.match(sql, /t\.tgfoid\s*=\s*to_regprocedure\('private\.guard_algo_l1_policy_v1\(\)'\)/i);
});

test('L1 ranking RPC owns candidates, scoring, diversity and snapshot pagination', () => {
  const sql = readL1Migration();
  const fn = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(fn, /p_client_session_id uuid/i);
  assert.match(fn, /p_limit integer default 10/i);
  assert.match(fn, /p_as_of timestamp with time zone default null/i);
  assert.match(fn, /p_before_score numeric default null/i);
  assert.match(fn, /p_before_created_at timestamp with time zone default null/i);
  assert.match(fn, /p_before_id uuid default null/i);
  assert.match(fn, /p_policy_version text default null/i);
  assert.doesNotMatch(fn, /p_(?:viewer|user_id|weight|eligible|age)/i);
  assert.match(fn, /v_viewer_id uuid\s*:=\s*\(select auth\.uid\(\)\)/i);
  assert.match(fn, /security definer[\s\S]{0,100}set search_path\s*(?:=|to)\s*''/i);
  assert.match(fn, /private\.admin_content_is_visible\('video',[\s\S]{0,100}private\.video_can_view_owner/i);
  assert.match(fn, /order by\s+v\.created_at desc,\s*v\.id desc[\s\S]{0,100}limit v_candidate_pool/i);
  assert.match(fn, /candidate_ids as materialized/i);
  assert.match(fn, /l\.video_id\s*=\s*any\(ci\.ids\)/i);
  assert.match(fn, /cmt\.video_id\s*=\s*any\(ci\.ids\)/i);
  assert.match(fn, /s\.video_id\s*=\s*any\(ci\.ids\)/i);
  assert.match(fn, /vv\.video_id\s*=\s*any\(ci\.ids\)/i);
  assert.doesNotMatch(fn, /join lateral/i);
  assert.match(fn, /select f\.id[\s\S]{0,120}f\.follower_id\s*=\s*v_viewer_id/i);
  assert.match(fn, /from \([\s\S]*?union all[\s\S]*?\) raw_actions\s+limit 3\s+\) actions/i);
  assert.match(fn, /not v_cold_start[\s\S]{0,100}short_watch_penalty/i);
  assert.match(fn, /not v_cold_start[\s\S]{0,100}recent_completed_penalty/i);
  assert.match(fn, /not v_cold_start[\s\S]{0,160}repeat_view_penalty_cap/i);
  assert.match(fn, /row_number\(\) over\s*\(\s*partition by s\.user_id/i);
  assert.match(fn, /as creator_rank/i);
  assert.match(fn, /as diversity_tier/i);
  assert.match(fn, /as delivery_score/i);
  assert.match(fn, /\(d\.delivery_score, d\.created_at, d\.id\)[\s\S]{0,80}< \(p_before_score, p_before_created_at, p_before_id\)/i);
  assert.match(fn, /order by pr\.delivery_score desc,\s*pr\.created_at desc,\s*pr\.id desc/i);
  assert.match(fn, /pr\.rank_score,[\s\S]{0,80}pr\.delivery_score/i);
  assert.doesNotMatch(fn, /\brandom\s*\(/i);
  assert.doesNotMatch(fn, /\boffset\b/i);
  assert.doesNotMatch(fn, /advertising|campaign|billing|spend|shares_count\s*[*+\/-]/i);
  assert.match(sql, /grant execute on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\)\s+to anon,\s*authenticated/i);
});

test('L1 migration adds only signal query indexes and a service-only reconciler', () => {
  const sql = readL1Migration();

  for (const index of [
    'likes_video_created_idx',
    'comments_video_created_idx',
    'video_saves_video_created_idx',
    'video_views_session_video_created_idx',
  ]) {
    assert.match(sql, new RegExp(`create index ${index}`, 'i'));
  }
  assert.match(sql, /create or replace function public\.reconcile_algo_l1_v1\(\)/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_l1_v1\(\) to service_role/i);
  assert.doesNotMatch(sql, /create table (?:public|private)\.(?:ranked|ranking_scores|feed_cache|user_feed)/i);
});

function rankedRow(overrides = {}) {
  return {
    id: '32000000-0000-4000-8000-000000000001',
    user_id: '31000000-0000-4000-8000-000000000001',
    video_url: 'https://example.test/video.mp4',
    thumbnail_url: 'https://example.test/thumb.jpg',
    media_urls: null,
    caption: 'L1 row',
    music: 'Original',
    likes_count: 2,
    comments_count: 3,
    shares_count: 0,
    views_count: 4,
    saves_count: 1,
    created_at: '2026-09-30T20:00:00.000Z',
    edited_at: null,
    creator_username: 'creator',
    creator_avatar: 'https://example.test/avatar.jpg',
    ranking_mode: 'behavioral_l1',
    policy_version: 'nelyon-algo-l1-v1',
    rank_score: '42.125000',
    feed_as_of: '2026-09-30T21:00:00.000Z',
    cursor_score: '42.125000',
    cursor_created_at: '2026-09-30T20:00:00.000Z',
    cursor_id: '32000000-0000-4000-8000-000000000001',
    effective_page_limit: 10,
    ranking_decision_id: null,
    ranking_organic_position: null,
    ...overrides,
  };
}

test('ranking client calls the one RPC, validates rows, maps videos and preserves cursor', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [rankedRow()], error: null };
    },
  };
  const mapped = [];
  const mapRow = (row, username, avatar) => {
    mapped.push({ row, username, avatar });
    return { id: row.id, username, avatar };
  };

  const page = await fetchRankedFeedPage(client, {
    clientSessionId: '33000000-0000-4000-8000-000000000001',
    limit: 10,
    cursor: null,
  }, mapRow);

  assert.deepEqual(calls, [{
    name: 'get_ranked_feed_l1_v1',
    args: {
      p_client_session_id: '33000000-0000-4000-8000-000000000001',
      p_limit: 10,
      p_as_of: null,
      p_before_score: null,
      p_before_created_at: null,
      p_before_id: null,
      p_policy_version: null,
    },
  }]);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].username, 'creator');
  assert.equal(mapped[0].avatar, 'https://example.test/avatar.jpg');
  assert.deepEqual(page.videos, [{
    id: '32000000-0000-4000-8000-000000000001',
    username: 'creator',
    avatar: 'https://example.test/avatar.jpg',
  }]);
  assert.deepEqual(page.cursor, {
    asOf: '2026-09-30T21:00:00.000Z',
    score: '42.125000',
    createdAt: '2026-09-30T20:00:00.000Z',
    id: '32000000-0000-4000-8000-000000000001',
    policyVersion: 'nelyon-algo-l1-v1',
  });
  assert.equal(page.rankingMode, 'behavioral_l1');
  assert.equal(page.hasMore, false);
});

test('ranking client forwards the full cursor and returns an honest empty page', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  let args;
  const client = {
    async rpc(_name, input) {
      args = input;
      return { data: [], error: null };
    },
  };
  const cursor = {
    asOf: '2026-09-30T21:00:00.000Z',
    score: '-1.250000',
    createdAt: '2026-09-30T19:00:00.000Z',
    id: '32000000-0000-4000-8000-000000000002',
    policyVersion: 'nelyon-algo-l1-v1',
  };
  const page = await fetchRankedFeedPage(client, {
    clientSessionId: '33000000-0000-4000-8000-000000000001',
    limit: 10,
    cursor,
  }, () => assert.fail('empty rows must not invoke the mapper'));

  assert.deepEqual(args, {
    p_client_session_id: '33000000-0000-4000-8000-000000000001',
    p_limit: 10,
    p_as_of: cursor.asOf,
    p_before_score: cursor.score,
    p_before_created_at: cursor.createdAt,
    p_before_id: cursor.id,
    p_policy_version: cursor.policyVersion,
  });
  assert.deepEqual(page, {
    videos: [], cursor: null, hasMore: false, rankingMode: null, policyVersion: null,
    observationItems: [],
  });
});

test('ranking client rejects RPC failures and malformed response rows', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const options = {
    clientSessionId: '33000000-0000-4000-8000-000000000001',
    limit: 10,
    cursor: null,
  };

  await assert.rejects(
    fetchRankedFeedPage({ rpc: async () => ({ data: null, error: { message: 'offline' } }) }, options, row => row),
    /offline/,
  );
  await assert.rejects(
    fetchRankedFeedPage({ rpc: async () => ({ data: [rankedRow({ feed_as_of: null })], error: null }) }, options, row => row),
    /invalid ranked feed row/i,
  );
});

test('ranking client clamps oversized pages to the server contract', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  let args;
  const data = Array.from({ length: 50 }, (_, index) => rankedRow({
    id: `32000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    cursor_id: `32000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    effective_page_limit: 50,
  }));
  const page = await fetchRankedFeedPage({
    async rpc(_name, input) {
      args = input;
      return { data, error: null };
    },
  }, {
    clientSessionId: '33000000-0000-4000-8000-000000000001',
    limit: 100,
    cursor: null,
  }, row => row);

  assert.equal(args.p_limit, 50);
  assert.equal(page.videos.length, 50);
  assert.equal(page.hasMore, true);
});

test('ranking client uses the server effective page limit for continuation', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const data = Array.from({ length: 20 }, (_, index) => rankedRow({
    id: `32000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    cursor_id: `32000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    effective_page_limit: 20,
  }));
  const page = await fetchRankedFeedPage({
    rpc: async () => ({ data, error: null }),
  }, {
    clientSessionId: '33000000-0000-4000-8000-000000000001',
    limit: 50,
    cursor: null,
  }, row => row);

  assert.equal(page.videos.length, 20);
  assert.equal(page.hasMore, true);
});

test('FeedContext consumes only the ranked organic authority for Feed pages', () => {
  const feed = readFileSync(new URL('../contexts/FeedContext.tsx', import.meta.url), 'utf8');
  const loadStart = feed.indexOf('const loadVideos = useCallback');
  const loadEnd = feed.indexOf('// ── Load blocked users', loadStart);
  assert.ok(loadStart > 0 && loadEnd > loadStart);
  const loadBody = feed.slice(loadStart, loadEnd);

  assert.match(feed, /fetchRankedFeedPage/);
  assert.match(feed, /type RankedFeedCursor/);
  assert.doesNotMatch(feed, /services\/feedKeyset/);
  assert.match(loadBody, /fetchRankedFeedPage\(\{[\s\S]{0,180}supabase\.rpc\(name, args\)/);
  assert.doesNotMatch(loadBody, /\.from\('videos'\)/);
  assert.doesNotMatch(loadBody, /\.order\(|\.range\(|\.or\(/);
  assert.match(loadBody, /clientSessionId/);
  assert.match(loadBody, /setRankCursor\(page\.cursor\)/);
  assert.match(loadBody, /setHasMoreRanked\(page\.hasMore\)/);
  assert.match(feed, /setRankCursor\(null\);[\s\S]{0,250}loadVideos\(null/);
  assert.match(feed, /const refreshFeed = useCallback\(async \(\) => \{[\s\S]{0,180}deliveryGenerationRef\.current\s*=\s*generation[\s\S]{0,250}loadVideos\(null, generation\)/);
  assert.match(feed, /if \(!isLoadingRef\.current && hasMoreRanked && rankCursor\)/);
  assert.doesNotMatch(feed, /\bSAMPLE_VIDEOS\b|\bMOCK_COMMENTS\b/);
});
