import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l6_observation_dataset_foundation.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const allMigrationSql = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('.sql'))
  .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'))
  .join('\n');
const observationServiceUrl = new URL('../services/organicRankingObservationService.ts', import.meta.url);
const observationService = existsSync(observationServiceUrl)
  ? readFileSync(observationServiceUrl, 'utf8')
  : '';
const rankingClient = readFileSync(new URL('../services/feedRankingService.ts', import.meta.url), 'utf8');
const feedContext = readFileSync(new URL('../contexts/FeedContext.tsx', import.meta.url), 'utf8');
const feedScreen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
const nativeCard = readFileSync(new URL('../components/feature/VideoCard.native.tsx', import.meta.url), 'utf8');
const webCard = readFileSync(new URL('../components/feature/VideoCard.tsx', import.meta.url), 'utf8');

const UUID_A = 'a1000000-0000-4000-8000-000000000001';
const UUID_B = 'a1000000-0000-4000-8000-000000000002';
const UUID_C = 'a1000000-0000-4000-8000-000000000003';

function rankedRow(overrides = {}) {
  return {
    id: UUID_A,
    creator_username: 'creator',
    creator_avatar: '',
    created_at: '2026-10-05T12:00:00.000Z',
    ranking_mode: 'chronological',
    policy_version: 'nelyon-algo-l1-v1',
    rank_score: '0.000000',
    feed_as_of: '2026-10-05T12:01:00.000Z',
    cursor_score: '0.000000',
    cursor_created_at: '2026-10-05T12:00:00.000Z',
    cursor_id: UUID_A,
    effective_page_limit: 10,
    ranking_decision_id: UUID_C,
    ranking_organic_position: 1,
    ...overrides,
  };
}

test('L6-F2 starts red until the single observation migration and service exist', () => {
  assert.equal(migrationNames.length, 1);
  assert.ok(existsSync(observationServiceUrl));
});

test('migration creates exactly four private immutable observation authorities', () => {
  const tables = [...migrationSql.matchAll(/create\s+table\s+private\.([a-z0-9_]+)/gi)]
    .map(match => match[1])
    .filter(name => name.startsWith('organic_ranking_'));
  assert.deepEqual(tables.sort(), [
    'organic_ranking_decisions',
    'organic_ranking_engagement_events',
    'organic_ranking_impressions',
    'organic_ranking_items',
  ]);
  for (const table of tables) {
    assert.match(migrationSql, new RegExp(`alter table private\\.${table} enable row level security`, 'i'));
    assert.match(migrationSql, new RegExp(`alter table private\\.${table} force row level security`, 'i'));
    assert.match(migrationSql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated, service_role`, 'i'));
  }
  assert.match(migrationSql, /primary key\s*\(decision_id,\s*organic_position\)/i);
  assert.match(migrationSql, /unique\s*\(decision_id,\s*video_id\)/i);
  assert.match(migrationSql, /unique\s*\(decision_id,\s*organic_position,\s*video_id\)/i);
  assert.match(migrationSql, /references private\.organic_ranking_decisions\s*\(id\)\s*on delete cascade/i);
  assert.match(migrationSql, /references private\.organic_ranking_items\s*\(decision_id,\s*organic_position,\s*video_id\)\s*on delete cascade/i);
  assert.match(migrationSql, /references private\.organic_ranking_impressions\s*\(client_event_id\)\s*on delete cascade/i);
});

test('decision helper is internal, atomic, bounded and fail-soft', () => {
  assert.match(migrationSql, /create or replace function private\.record_organic_ranking_decision_v1\(/i);
  assert.match(migrationSql, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(migrationSql, /returned_count[\s\S]*between 0 and 50/i);
  assert.match(migrationSql, /organic_position[\s\S]*row_number/i);
  assert.match(migrationSql, /get stacked diagnostics\s+v_error_state\s*=\s*returned_sqlstate[\s\S]*algo6_l6_observation_write_failed/i);
  assert.match(migrationSql, /exception\s+when others[\s\S]*return null/i);
  assert.match(migrationSql, /revoke all on function private\.record_organic_ranking_decision_v1\([^;]+\) from public, anon, authenticated, service_role/i);
});

test('same ranking RPC appends observation metadata after final page without a second ranker', () => {
  assert.match(migrationSql, /drop function public\.get_ranked_feed_l1_v1\(\s*uuid\s*,\s*integer\s*,\s*timestamp with time zone\s*,\s*numeric\s*,\s*timestamp with time zone\s*,\s*uuid\s*,\s*text\s*\)/i);
  assert.match(migrationSql, /create function public\.get_ranked_feed_l1_v1\(\s*p_client_session_id uuid,[\s\S]*p_policy_version text default null/i);
  assert.match(migrationSql, /ranking_decision_id uuid,\s*ranking_organic_position integer/i);
  assert.match(migrationSql, /observed_page[\s\S]*row_number\(\) over \(\s*order by[\s\S]*delivery_score desc[\s\S]*created_at desc[\s\S]*id desc/i);
  assert.match(migrationSql, /private\.record_organic_ranking_decision_v1\(/i);
  assert.doesNotMatch(allMigrationSql, /create\s+(?:or replace\s+)?function\s+public\.get_ranked_feed_l[26]/i);
  const rankingDefinition = migrationSql.slice(
    migrationSql.indexOf('create function public.get_ranked_feed_l1_v1'),
    migrationSql.indexOf('revoke all on function public.get_ranked_feed_l1_v1'),
  );
  assert.doesNotMatch(rankingDefinition, /from\s+private\.organic_ranking_/i);
  assert.match(rankingDefinition, /record_organic_ranking_decision_v1/i);
});

test('feature snapshot uses the exact v1 numeric allowlist and excludes sensitive payloads', () => {
  const expected = [
    'freshness_points', 'follow_points', 'like_points', 'comment_points', 'save_points',
    'completion_points', 'rewatch_points', 'exploration_points', 'same_session_points',
    'short_watch_points', 'completed_points', 'repeat_points', 'creator_affinity_points',
    'l3_quality_points', 'creator_burst_penalty', 'duplicate_penalty', 'l3_adjustment',
    'positive_creator_points', 'negative_creator_penalty', 'creator_session_repeat_penalty',
    'l4_context_adjustment', 'l5_semantic_positive_points',
    'l5_semantic_negative_penalty', 'l5_semantic_adjustment',
  ];
  const contractStart = migrationSql.indexOf('-- feature_snapshot_v1_begin');
  const snapshotStart = migrationSql.indexOf('jsonb_build_object(', contractStart);
  const snapshotEnd = migrationSql.indexOf('-- feature_snapshot_v1_end', snapshotStart);
  const snapshot = migrationSql.slice(snapshotStart, snapshotEnd);
  const keys = [...snapshot.matchAll(/'([a-z0-9_]+)'\s*,/gi)].map(match => match[1]);
  assert.deepEqual(keys, expected);
  assert.doesNotMatch(snapshot, /caption|username|email|location|embedding|semantic_text|moderation|financial|wallet|ledger/i);
});

test('impression and engagement RPCs enforce auth, membership, contracts and idempotency', () => {
  assert.match(migrationSql, /create or replace function public\.record_organic_ranking_impression_v1\([\s\S]*p_surface_position integer[\s\S]*security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(migrationSql, /organic-feed-viewability-75pct-v1/i);
  assert.match(migrationSql, /visible_percent_threshold[\s\S]*75/i);
  assert.match(migrationSql, /organic_ranking_impression_event_conflict/i);
  assert.match(migrationSql, /grant execute on function public\.record_organic_ranking_impression_v1\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*integer\s*\)\s*to anon, authenticated/i);
  assert.match(migrationSql, /create or replace function public\.record_organic_ranking_engagement_v1\([\s\S]*p_action text[\s\S]*security definer/i);
  assert.match(migrationSql, /p_action not in \('like','unlike','save','unsave','follow','unfollow'\)/i);
  assert.match(migrationSql, /organic-engagement-24h-v1/i);
  assert.match(migrationSql, /organic_ranking_engagement_outside_window/i);
  assert.match(migrationSql, /ignored_self_action/i);
  assert.match(migrationSql, /organic_ranking_engagement_event_conflict/i);
  assert.match(migrationSql, /grant execute on function public\.record_organic_ranking_engagement_v1\(\s*uuid\s*,\s*uuid\s*,\s*text\s*\)\s*to authenticated/i);
});

test('progress, retention and reconciler authorities are bounded and service-private', () => {
  assert.match(migrationSql, /create or replace function public\.get_algo6_l6_observation_progress_v1\(\)[\s\S]*returns jsonb[\s\S]*security definer/i);
  assert.match(migrationSql, /grant execute on function public\.get_algo6_l6_observation_progress_v1\(\)\s*to service_role/i);
  assert.match(migrationSql, /create or replace function private\.prune_algo6_l6_observations_v1\(\)/i);
  assert.match(migrationSql, /created_at\s*<\s*clock_timestamp\(\)\s*-\s*interval '180 days'/i);
  assert.match(migrationSql, /cron\.schedule\(\s*'algo6_l6_observation_retention_v1'\s*,\s*'17 3 \* \* \*'/i);
  const reconciler = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.reconcile_algo_l1_v1()'),
    migrationSql.indexOf('revoke all on function public.reconcile_algo_l1_v1()'),
  );
  const keys = [...reconciler.matchAll(/^\s+'([a-z0-9_]+)',\s*\(/gim)].map(match => match[1]);
  assert.equal(keys.length, 65);
  assert.equal(new Set(keys).size, 65);
  for (const key of [
    'l6_observation_decision_authority_missing',
    'l6_observation_impression_authority_missing',
    'l6_observation_engagement_authority_missing',
    'l6_observation_ranking_contract_missing',
    'l6_observation_browser_access_present',
    'l6_observation_orphan_present',
    'l6_observation_retention_missing',
    'l6_observation_forbidden_dependency_present',
  ]) assert.ok(keys.includes(key));
});

test('ranking client validates page-wide nullable observation metadata', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const page = await fetchRankedFeedPage({
    rpc: async () => ({ data: [rankedRow(), rankedRow({
      id: UUID_B,
      created_at: '2026-10-05T11:59:00.000Z',
      cursor_created_at: '2026-10-05T11:59:00.000Z',
      cursor_id: UUID_B,
      ranking_organic_position: 2,
    })], error: null }),
  }, { clientSessionId: UUID_A }, row => row.id);
  assert.deepEqual(page.observationItems, [
    { videoId: UUID_A, decisionId: UUID_C, organicPosition: 1 },
    { videoId: UUID_B, decisionId: UUID_C, organicPosition: 2 },
  ]);

  const nullable = await fetchRankedFeedPage({
    rpc: async () => ({ data: [rankedRow({ ranking_decision_id: null, ranking_organic_position: null })], error: null }),
  }, { clientSessionId: UUID_A }, row => row.id);
  assert.deepEqual(nullable.observationItems, []);

  for (const rows of [
    [rankedRow({ ranking_organic_position: null })],
    [rankedRow(), rankedRow({ id: UUID_B, cursor_id: UUID_B, ranking_decision_id: UUID_B, ranking_organic_position: 2 })],
    [rankedRow(), rankedRow({ id: UUID_B, cursor_id: UUID_B, ranking_organic_position: 3 })],
  ]) {
    await assert.rejects(fetchRankedFeedPage({ rpc: async () => ({ data: rows, error: null }) },
      { clientSessionId: UUID_A }, row => row.id), /Invalid ranked feed (?:row|response)/);
  }
});

test('observation client retries impressions with the same identity and keeps telemetry fail-soft', async () => {
  const {
    recordOrganicRankingEngagement,
    recordOrganicRankingImpression,
  } = await import('../services/organicRankingObservationService.ts');
  const calls = [];
  const impressionInput = {
    decisionId: UUID_C,
    videoId: UUID_A,
    clientEventId: UUID_B,
    clientSessionId: UUID_A,
    surfacePosition: 3,
  };
  const status = await recordOrganicRankingImpression({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return calls.length === 1
        ? { data: null, error: { message: 'transient' } }
        : { data: [{ status: 'inserted' }], error: null };
    },
  }, impressionInput);
  assert.equal(status, 'inserted');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].args.p_client_event_id, UUID_B);

  const engagementCalls = [];
  const engagementStatus = await recordOrganicRankingEngagement({
    rpc: async (name, args) => {
      engagementCalls.push({ name, args });
      return { data: [{ status: 'inserted' }], error: null };
    },
  }, {
    impressionClientEventId: UUID_B,
    clientActionId: UUID_C,
    action: 'save',
  });
  assert.equal(engagementStatus, 'inserted');
  assert.equal(engagementCalls.length, 1);
  assert.equal(engagementCalls[0].args.p_impression_client_event_id, UUID_B);

  assert.equal(await recordOrganicRankingImpression({ rpc: async () => { throw new Error('offline'); } }, impressionInput), null);
  assert.equal(await recordOrganicRankingEngagement({ rpc: async () => ({ data: null, error: { message: 'denied' } }) }, {
    impressionClientEventId: UUID_B,
    clientActionId: UUID_C,
    action: 'like',
  }), null);
});

test('client wiring reuses playback event identity and remains fail-soft', () => {
  assert.match(observationService, /record_organic_ranking_impression_v1/);
  assert.match(observationService, /record_organic_ranking_engagement_v1/);
  assert.match(observationService, /p_client_event_id:\s*input\.clientEventId/i);
  assert.match(observationService, /p_client_action_id:\s*input\.clientActionId/i);
  assert.match(feedContext, /organicObservationMapRef/);
  assert.match(feedContext, /recordOrganicViewStarted/);
  assert.match(feedContext, /recordOrganicEngagement/);
  assert.match(feedContext, /observationItems/);
  assert.match(nativeCard, /onViewStarted\?:\s*\(clientEventId:\s*string\)/);
  assert.match(webCard, /onViewStarted\?:\s*\(clientEventId:\s*string\)/);
  assert.match(nativeCard, /const clientEventId\s*=\s*playbackSessionRef\.current\?\.start\(\)/);
  assert.match(nativeCard, /onViewStartedRef\.current\?\.\(clientEventId\)/);
  assert.match(feedScreen, /onViewStarted=\{clientEventId\s*=>[\s\S]*index\s*\+\s*1/);
  assert.match(feedScreen, /const wasLiked\s*=\s*isLiked\(videoId\)[\s\S]*await toggleLike[\s\S]*recordOrganicEngagement/i);
  assert.match(feedScreen, /const wasSaved\s*=\s*isSaved\(videoId\)[\s\S]*await toggleSave[\s\S]*recordOrganicEngagement/i);
  assert.match(feedScreen, /const wasFollowing\s*=\s*isFollowing\(creatorId\)[\s\S]*await toggleFollow[\s\S]*recordOrganicEngagement/i);
  assert.doesNotMatch(feedScreen, /onViewStarted[\s\S]{0,300}(sponsored|advertising_v2)/i);
});

test('L6-F2 introduces no model, training, backfill, Ads or finance coupling', () => {
  const operationalMigration = migrationSql.slice(
    0,
    migrationSql.indexOf('create or replace function public.reconcile_algo_l1_v1()'),
  );
  assert.doesNotMatch(migrationSql, /insert\s+into\s+private\.organic_ranking_(?:decisions|items|impressions|engagement_events)\s+select/i);
  assert.doesNotMatch(migrationSql, /create\s+table[^;]*(model|feature_store|prediction|inference)/i);
  assert.doesNotMatch(operationalMigration, /advertising_|marketplace_|financial_transactions|ledger_entries|wallet|messages|chat|gps|latitude|longitude|device|network|content_safety_(?:alerts|reports|warnings)/i);
  assert.doesNotMatch(rankingClient + observationService + feedContext,
    /model_registry|feature_store|prediction_cache|learning_to_rank|xgboost|lightgbm|onnx|tensorflow|pytorch/i);
});
