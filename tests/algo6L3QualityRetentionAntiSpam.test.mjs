import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const rankingClient = readFileSync(
  new URL('../services/feedRankingService.ts', import.meta.url),
  'utf8',
);

function readL3Migration() {
  const matches = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l3_quality_retention_antispam.sql'));
  assert.equal(matches.length, 1, 'exactly one generated L3 migration must exist');
  return {
    filename: matches[0],
    sql: readFileSync(new URL(matches[0], migrationDirectory), 'utf8'),
  };
}

function functionBody(sql, qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} must be replaced by L3`);
  const nextRevoke = sql.toLowerCase().indexOf('\nrevoke all on function', start);
  assert.ok(nextRevoke > start, `${qualifiedName} must preserve explicit ACL handling`);
  return sql.slice(start, nextRevoke);
}

test('L3 extends the existing policy with dormant bounded algorithmic fields', () => {
  const { filename, sql } = readL3Migration();
  assert.match(filename, /^\d{14}_algo6_l3_quality_retention_antispam\.sql$/);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);

  for (const [column, value] of [
    ['l3_quality_enabled', 'false'],
    ['l3_retention_horizon_days', '30'],
    ['l3_quality_min_samples', '3'],
    ['l3_quality_full_confidence_samples', '20'],
    ['l3_long_watch_ratio_threshold', '0.50'],
    ['l3_quality_weight', '15'],
    ['l3_creator_burst_horizon_hours', '24'],
    ['l3_creator_burst_free_posts', '6'],
    ['l3_creator_burst_penalty_per_post', '2'],
    ['l3_creator_burst_penalty_cap', '12'],
    ['l3_duplicate_horizon_days', '90'],
    ['l3_duplicate_penalty', '20'],
    ['l3_creator_history_cap', '100'],
  ]) {
    assert.match(
      sql,
      new RegExp(`add column ${column}[\\s\\S]{0,100}?default\\s+${value.replace('.', '\\.')}`, 'i'),
      `${column} must have its approved dormant default`,
    );
  }

  assert.match(sql, /l3_retention_horizon_days\s+between\s+1\s+and\s+365/i);
  assert.match(sql, /l3_quality_min_samples\s+between\s+1\s+and\s+100/i);
  assert.match(sql, /l3_quality_full_confidence_samples\s+between\s+l3_quality_min_samples\s+and\s+1000/i);
  assert.match(sql, /l3_long_watch_ratio_threshold\s+between\s+0\s+and\s+1/i);
  assert.match(sql, /l3_creator_burst_horizon_hours\s+between\s+1\s+and\s+720/i);
  assert.match(sql, /l3_creator_history_cap\s+between\s+1\s+and\s+1000/i);
  assert.match(sql, /least\([\s\S]*l3_quality_weight[\s\S]*l3_duplicate_penalty[\s\S]*\)\s*>=\s*0/i);

  assert.doesNotMatch(sql, /create table\s+(?:public|private)\.[^\s(]*(?:quality|retention|spam|rank|score|cache)/i);
  assert.doesNotMatch(sql, /create\s+(?:materialized\s+)?view\s+(?:public|private)\./i);
  assert.doesNotMatch(sql, /create\s+(?:unique\s+)?index/i, 'L3 must use proven existing indexes');
  assert.doesNotMatch(sql, /update\s+private\.algo_l1_policy/i, 'dormant columns must not reset policy/canary history');
  assert.doesNotMatch(
    sql,
    /(?:update|insert\s+into|delete\s+from)\s+public\.(?:videos|video_views|likes|comments|video_saves|follows)/i,
  );
});

test('L3 retention is candidate-bounded, snapshot-safe, deduplicated and self-view resistant', () => {
  const { sql } = readL3Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.equal((sql.match(/create or replace function public\.get_ranked_feed_l1_v1/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /create or replace function public\.get_ranked_feed_l3/i);
  assert.match(ranking, /security definer[\s\S]{0,100}set search_path\s*=\s*''/i);
  assert.match(ranking, /candidates as materialized/i);
  assert.match(ranking, /candidate_creators as materialized/i);
  assert.match(ranking, /l3_retention_ranked as/i);
  assert.match(ranking, /l3_retention_features as/i);
  assert.match(ranking, /vv\.created_at\s*<=\s*v_as_of/i);
  assert.match(ranking, /make_interval\(days\s*=>\s*v_policy\.l3_retention_horizon_days\)/i);
  assert.match(ranking, /vv\.media_duration_ms\s+is\s+not\s+null/i);
  assert.match(ranking, /vv\.media_duration_ms\s*>\s*0/i);
  assert.match(ranking, /vv\.completion_ratio\s+is\s+not\s+null/i);
  assert.match(ranking, /row_number\(\)\s+over\s*\([\s\S]*partition by[\s\S]*vv\.video_id[\s\S]*viewer_id[\s\S]*client_session_id/i);
  assert.match(ranking, /order by\s+vv\.created_at\s+desc\s*,\s*vv\.id\s+desc/i);
  assert.match(ranking, /vv\.viewer_id\s+is\s+null\s+or\s+vv\.viewer_id\s*<>\s*c\.user_id/i);
  assert.match(ranking, /least\(1::numeric\s*,\s*greatest\(0::numeric\s*,\s*vv\.completion_ratio/i);
  assert.match(ranking, /l3_quality_min_samples/i);
  assert.match(ranking, /l3_quality_full_confidence_samples/i);
  assert.match(ranking, /0\.60::numeric[\s\S]*completion_rate[\s\S]*0\.40::numeric[\s\S]*long_watch_rate[\s\S]*early_exit_rate/i);
  assert.match(ranking, /l3_quality_weight/i);
});

test('L3 anti-spam reuses visibility and fingerprint authorities with bounded creator history', () => {
  const { sql } = readL3Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(ranking, /l3_creator_burst_features as/i);
  assert.match(ranking, /private\.admin_content_is_visible\('video'\s*,\s*v\.id\)/i);
  assert.match(ranking, /make_interval\(hours\s*=>\s*v_policy\.l3_creator_burst_horizon_hours\)/i);
  assert.match(ranking, /l3_creator_burst_free_posts/i);
  assert.match(ranking, /l3_creator_burst_penalty_per_post/i);
  assert.match(ranking, /l3_creator_burst_penalty_cap/i);

  assert.match(ranking, /l3_creator_history as materialized/i);
  assert.match(ranking, /make_interval\(days\s*=>\s*v_policy\.l3_duplicate_horizon_days\)/i);
  assert.match(ranking, /limit\s+v_policy\.l3_creator_history_cap/i);
  assert.match(ranking, /private\.content_safety_scans/i);
  assert.match(ranking, /content_fingerprint/i);
  assert.match(ranking, /css\.created_at\s*<=\s*v_as_of/i);
  assert.match(ranking, /partition by[\s\S]*user_id[\s\S]*content_fingerprint/i);
  assert.match(ranking, /order by[\s\S]*created_at\s+asc[\s\S]*id\s+asc/i);
  assert.match(ranking, /l3_duplicate_penalty/i);

  assert.doesNotMatch(ranking, /public\.reports/i, 'raw reports must never score the Feed');
  assert.doesNotMatch(ranking, /content_safety_alerts/i, 'unreviewed safety alerts must never score the Feed');
  assert.doesNotMatch(ranking, /(?:severity|detector_confidence|reports_status)/i);
});

test('L3 adds only a bounded adjustment and preserves the one canonical mode hierarchy', () => {
  const { sql } = readL3Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');

  assert.match(ranking, /v_l3_effective\s*:=\s*v_behavioral\s+and\s+v_policy\.l3_quality_enabled/i);
  assert.match(ranking, /when\s+v_l3_effective\s+then\s+'behavioral_l3'/i);
  assert.match(ranking, /when\s+v_l2_effective\s+then\s+'behavioral_l2'/i);
  assert.match(ranking, /l3_quality_points/i);
  assert.match(ranking, /creator_burst_penalty/i);
  assert.match(ranking, /duplicate_penalty/i);
  assert.match(ranking, /l3_quality_points[\s\S]*-\s*creator_burst_penalty[\s\S]*-\s*duplicate_penalty/i);
  assert.match(ranking, /creator_affinity_points[\s\S]*\+\s*l3_adjustment/i);
  assert.match(ranking, /case\s+when\s+v_policy\.l3_quality_enabled[\s\S]*else\s+0::numeric[\s\S]*end\s+as\s+l3_adjustment/i);
  assert.match(ranking, /candidate_pool_size/i);
  assert.match(ranking, /creator_page_cap/i);
});

test('the existing reconciler owns L3 checks and detects forbidden score authorities', () => {
  const { sql } = readL3Migration();
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');

  for (const key of [
    'l3_policy_invalid',
    'l3_unexpectedly_enabled',
    'l3_retention_authority_missing',
    'l3_duplicate_fingerprint_authority_missing',
    'l3_materialization_present',
    'l3_raw_report_signal_present',
  ]) {
    assert.ok(reconciler.includes(`'${key}'`), `${key} must be reconciled by the existing authority`);
  }
  assert.match(reconciler, /public\.reports/i);
  assert.match(reconciler, /content_safety_alerts/i);
  assert.match(sql, /grant execute on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_l1_v1\(\) to service_role/i);
});

test('thin Feed client accepts behavioral_l3 without calculating ranking', () => {
  assert.match(
    rankingClient,
    /RankedFeedMode\s*=\s*'chronological'\s*\|\s*'behavioral_l1'\s*\|\s*'behavioral_l2'\s*\|\s*'behavioral_l3'/,
  );
  assert.match(rankingClient, /row\.ranking_mode\s*===\s*'behavioral_l3'/);
  assert.match(rankingClient, /client\.rpc\('get_ranked_feed_l1_v1'/);
  assert.doesNotMatch(
    rankingClient,
    /quality_(?:weight|score|points)|creatorBurst|duplicatePenalty|l3_quality|public\.videos|\.from\(['"]videos['"]\)/i,
  );
});

test('thin Feed client validates behavioral_l3 from the canonical RPC', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const row = {
    id: '62000000-0000-4000-8000-000000000001',
    creator_username: 'creator',
    creator_avatar: 'https://example.test/avatar.jpg',
    created_at: '2026-10-03T16:00:00.000Z',
    ranking_mode: 'behavioral_l3',
    policy_version: 'nelyon-algo-l3-test-v1',
    rank_score: '15.000000',
    feed_as_of: '2026-10-03T16:01:00.000Z',
    cursor_score: '15.000000',
    cursor_created_at: '2026-10-03T16:00:00.000Z',
    cursor_id: '62000000-0000-4000-8000-000000000001',
    effective_page_limit: 10,
  };
  const client = {
    async rpc(name) {
      assert.equal(name, 'get_ranked_feed_l1_v1');
      return { data: [row], error: null };
    },
  };
  const page = await fetchRankedFeedPage(client, {
    clientSessionId: '65000000-0000-4000-8000-000000000001',
  }, value => value.id);
  assert.equal(page.rankingMode, 'behavioral_l3');
  assert.deepEqual(page.videos, [row.id]);
});
