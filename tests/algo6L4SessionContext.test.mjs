import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const rankingClient = readFileSync(
  new URL('../services/feedRankingService.ts', import.meta.url),
  'utf8',
);

function readL4Migration() {
  const matches = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l4_session_context.sql'));
  assert.equal(matches.length, 1, 'exactly one generated L4 migration must exist');
  return {
    filename: matches[0],
    sql: readFileSync(new URL(matches[0], migrationDirectory), 'utf8'),
  };
}

function functionBody(sql, qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} must be replaced by L4`);
  const nextRevoke = sql.toLowerCase().indexOf('\nrevoke all on function', start);
  assert.ok(nextRevoke > start, `${qualifiedName} must preserve explicit ACL handling`);
  return sql.slice(start, nextRevoke);
}

test('L4 extends the singleton policy with dormant bounded algorithmic fields', () => {
  const { filename, sql } = readL4Migration();
  assert.match(filename, /^\d{14}_algo6_l4_session_context\.sql$/);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);

  for (const [column, value] of [
    ['l4_context_enabled', 'false'],
    ['l4_session_horizon_minutes', '120'],
    ['l4_session_history_cap', '30'],
    ['l4_positive_watch_ratio_threshold', '0.50'],
    ['l4_positive_creator_weight', '2'],
    ['l4_positive_creator_cap', '6'],
    ['l4_negative_min_distinct_videos', '2'],
    ['l4_negative_creator_penalty_per_video', '3'],
    ['l4_negative_creator_penalty_cap', '9'],
    ['l4_creator_repeat_free_videos', '2'],
    ['l4_creator_repeat_penalty_per_video', '2'],
    ['l4_creator_repeat_penalty_cap', '8'],
  ]) {
    assert.match(
      sql,
      new RegExp(`add column ${column}[\\s\\S]{0,100}?default\\s+${value.replace('.', '\\.')}`, 'i'),
      `${column} must have its approved dormant default`,
    );
  }

  assert.match(sql, /l4_session_horizon_minutes\s+between\s+1\s+and\s+1440/i);
  assert.match(sql, /l4_session_history_cap\s+between\s+1\s+and\s+200/i);
  assert.match(sql, /l4_positive_watch_ratio_threshold\s+between\s+0\s+and\s+1/i);
  assert.match(sql, /l4_negative_min_distinct_videos\s+between\s+1\s+and\s+50/i);
  assert.match(sql, /l4_creator_repeat_free_videos\s+between\s+0\s+and\s+50/i);
  assert.match(sql, /least\([\s\S]*l4_positive_creator_weight[\s\S]*l4_creator_repeat_penalty_cap[\s\S]*\)\s*>=\s*0/i);
  assert.match(sql, /greatest\([\s\S]*l4_positive_creator_weight[\s\S]*l4_creator_repeat_penalty_cap[\s\S]*\)\s*<=\s*100/i);

  assert.doesNotMatch(sql, /create table\s+(?:public|private)\.[^\s(]*(?:context|session|rank|score|cache)/i);
  assert.doesNotMatch(sql, /create\s+(?:materialized\s+)?view\s+(?:public|private)\./i);
  assert.doesNotMatch(sql, /create\s+(?:unique\s+)?index/i, 'L4 must reuse the proven session index');
  assert.doesNotMatch(sql, /update\s+private\.algo_l1_policy/i, 'dormant columns must preserve policy and canary state');
  assert.doesNotMatch(
    sql,
    /(?:update|insert\s+into|delete\s+from)\s+public\.(?:videos|video_views|likes|comments|video_saves|follows)/i,
  );
});

test('L4 session history is current-session, snapshot, horizon, raw-cap and candidate bounded', () => {
  const { sql } = readL4Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  const rawHistory = ranking.slice(
    ranking.indexOf('l4_raw_session_history as materialized'),
    ranking.indexOf('l4_session_history as materialized'),
  );
  const candidateHistory = ranking.slice(
    ranking.indexOf('l4_session_history as materialized'),
    ranking.indexOf('l4_exposure_ranked as'),
  );

  assert.equal((sql.match(/create or replace function public\.get_ranked_feed_l1_v1/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /create or replace function public\.get_ranked_feed_l4/i);
  assert.match(ranking, /security definer[\s\S]{0,100}set search_path\s*=\s*''/i);
  assert.match(ranking, /candidates as materialized/i);
  assert.match(ranking, /candidate_creators as materialized/i);
  assert.match(rawHistory, /vv\.client_session_id\s*=\s*p_client_session_id/i);
  assert.match(rawHistory, /vv\.created_at\s*<=\s*v_as_of/i);
  assert.match(rawHistory, /make_interval\(mins\s*=>\s*v_policy\.l4_session_horizon_minutes\)/i);
  assert.match(rawHistory, /order by\s+vv\.created_at\s+desc\s*,\s*vv\.id\s+desc/i);
  assert.match(rawHistory, /limit\s+v_policy\.l4_session_history_cap/i);
  assert.doesNotMatch(rawHistory, /candidate_creators|public\.videos/i,
    'the raw cap must be applied before candidate-creator filtering');
  assert.match(candidateHistory, /from\s+l4_raw_session_history/i);
  assert.match(candidateHistory, /join\s+candidate_creators/i);
  assert.match(candidateHistory, /join\s+public\.videos/i);
});

test('L4 deduplicates exposure and valid retention independently', () => {
  const { sql } = readL4Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(ranking, /l4_latest_exposure as/i);
  assert.match(ranking, /partition by\s+l4sh\.video_id/i);
  assert.match(ranking, /where\s+exposure_rank\s*=\s*1/i);
  assert.match(ranking, /l4_valid_retention_ranked as/i);
  assert.match(ranking, /media_duration_ms\s+is\s+not\s+null/i);
  assert.match(ranking, /media_duration_ms\s*>\s*0/i);
  assert.match(ranking, /completion_ratio\s+is\s+not\s+null/i);
  assert.match(ranking, /least\(\s*1::numeric\s*,\s*greatest\(0::numeric\s*,\s*l4sh\.completion_ratio/i);
  assert.match(ranking, /where\s+retention_rank\s*=\s*1/i);
  assert.match(ranking, /count\(distinct\s+l4le\.video_id\)/i);
  assert.match(ranking, /l4lvr\.viewer_id\s+is\s+null\s+or\s+l4lvr\.viewer_id\s*<>\s*cc\.creator_id/i,
    'an authenticated self-view must remain excluded after an auth transition');
});

test('L4 implements bounded positive, gated negative and distinct-video fatigue formulas', () => {
  const { sql } = readL4Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(ranking, /positive_distinct_videos/i);
  assert.match(ranking, /bounded_completion_ratio\s*>=\s*v_policy\.l4_positive_watch_ratio_threshold/i);
  assert.match(ranking, /v_policy\.l4_positive_creator_cap[\s\S]*positive_distinct_videos[\s\S]*v_policy\.l4_positive_creator_weight/i);
  assert.match(ranking, /c\.user_id\s*=\s*v_viewer_id[\s\S]*then\s+0::numeric/i);
  assert.match(ranking, /negative_distinct_videos/i);
  assert.match(ranking, /bounded_completion_ratio\s*<\s*v_policy\.short_watch_ratio_threshold/i);
  assert.match(ranking, /exit_reason\s+in\s*\('swipe'\s*,\s*'background'\s*,\s*'unmount'\)/i);
  assert.match(ranking, /negative_distinct_videos[\s\S]*>=\s*v_policy\.l4_negative_min_distinct_videos/i);
  assert.match(ranking, /v_policy\.l4_negative_creator_penalty_cap[\s\S]*negative_distinct_videos[\s\S]*v_policy\.l4_negative_creator_penalty_per_video/i);
  assert.match(ranking, /session_distinct_videos_seen/i);
  assert.match(ranking, /session_distinct_videos_seen[\s\S]*-\s*v_policy\.l4_creator_repeat_free_videos/i);
  assert.match(ranking, /v_policy\.l4_creator_repeat_penalty_cap[\s\S]*v_policy\.l4_creator_repeat_penalty_per_video/i);
  assert.match(ranking, /positive_creator_points[\s\S]*-\s*negative_creator_penalty[\s\S]*-\s*creator_session_repeat_penalty/i);
});

test('L4 is additive, dormant by default, and has highest behavioral mode precedence', () => {
  const { sql } = readL4Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(ranking, /v_l4_effective\s*:=\s*v_behavioral\s+and\s+v_policy\.l4_context_enabled/i);
  assert.match(ranking, /when\s+v_l4_effective\s+then\s+'behavioral_l4'[\s\S]*when\s+v_l3_effective\s+then\s+'behavioral_l3'[\s\S]*when\s+v_l2_effective\s+then\s+'behavioral_l2'/i);
  assert.match(ranking, /case\s+when\s+v_l4_effective[\s\S]*else\s+0::numeric[\s\S]*end\s+as\s+l4_context_adjustment/i);
  assert.match(ranking, /creator_affinity_points[\s\S]*\+\s*l3_adjustment[\s\S]*\+\s*l4_context_adjustment/i);
  assert.match(ranking, /candidate_pool_size/i);
  assert.match(ranking, /creator_page_cap/i);
});

test('L4 ranking excludes sensitive, advertising, marketplace and raw-report context', () => {
  const { sql } = readL4Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  for (const forbidden of [
    /user_profiles\.location/i,
    /advertising_geo_targets/i,
    /advertising_language_targets/i,
    /marketplace_(?:checkout|shipping|address|destination)/i,
    /call_devices/i,
    /device_model/i,
    /network_(?:type|state)/i,
    /gps/i,
    /ip_address/i,
    /context_fingerprint/i,
    /public\.reports/i,
  ]) assert.doesNotMatch(ranking, forbidden);
});

test('the canonical reconciler owns all L4 safety and dormancy checks', () => {
  const { sql } = readL4Migration();
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');

  for (const key of [
    'l4_policy_invalid',
    'l4_unexpectedly_enabled',
    'l4_session_authority_missing',
    'l4_materialization_present',
    'l4_sensitive_context_dependency_present',
  ]) assert.ok(reconciler.includes(`'${key}'`), `${key} must be reconciled`);

  assert.match(reconciler, /advertising_geo_targets/i);
  assert.match(reconciler, /advertising_language_targets/i);
  assert.match(reconciler, /call_devices/i);
  assert.match(reconciler, /gps|latitude|longitude/i);
  assert.match(reconciler, /public\.reports/i);
  assert.match(sql, /grant execute on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_l1_v1\(\) to service_role/i);
});

test('thin Feed client accepts behavioral_l4 without calculating context', () => {
  assert.match(
    rankingClient,
    /RankedFeedMode\s*=\s*\|?\s*'chronological'\s*\|\s*'behavioral_l1'\s*\|\s*'behavioral_l2'\s*\|\s*'behavioral_l3'\s*\|\s*'behavioral_l4'/,
  );
  assert.match(rankingClient, /row\.ranking_mode\s*===\s*'behavioral_l4'/);
  assert.match(rankingClient, /client\.rpc\('get_ranked_feed_l1_v1'/);
  assert.doesNotMatch(
    rankingClient,
    /l4_|sessionContext|creatorFatigue|positiveCreator|negativeCreator|\.from\(['"]video_views['"]\)/i,
  );
});

test('thin Feed client validates behavioral_l4 from the canonical RPC', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const row = {
    id: '72000000-0000-4000-8000-000000000001',
    creator_username: 'creator',
    creator_avatar: 'https://example.test/avatar.jpg',
    created_at: '2026-10-04T03:00:00.000Z',
    ranking_mode: 'behavioral_l4',
    policy_version: 'nelyon-algo-l4-test-v1',
    rank_score: '6.000000',
    feed_as_of: '2026-10-04T03:01:00.000Z',
    cursor_score: '6.000000',
    cursor_created_at: '2026-10-04T03:00:00.000Z',
    cursor_id: '72000000-0000-4000-8000-000000000001',
    effective_page_limit: 10,
  };
  const client = {
    async rpc(name) {
      assert.equal(name, 'get_ranked_feed_l1_v1');
      return { data: [row], error: null };
    },
  };
  const page = await fetchRankedFeedPage(client, {
    clientSessionId: '75000000-0000-4000-8000-000000000001',
  }, value => value.id);
  assert.equal(page.rankingMode, 'behavioral_l4');
  assert.deepEqual(page.videos, [row.id]);
});
