import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const rankingClient = readFileSync(new URL('../services/feedRankingService.ts', import.meta.url), 'utf8');

function readL2Migration() {
  const names = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l2_creator_affinity.sql'));
  assert.equal(names.length, 1, 'exactly one generated L2 migration must exist');
  return {
    name: names[0],
    sql: readFileSync(new URL(names[0], migrationDirectory), 'utf8').replace(/\r\n/g, '\n'),
  };
}

function functionBody(sql, name) {
  const start = sql.toLowerCase().indexOf(`create or replace function ${name.toLowerCase()}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = sql.toLowerCase().indexOf('\ncreate or replace function ', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test('L2 extends the one policy with constrained dormant creator-affinity configuration', () => {
  const { sql } = readL2Migration();

  assert.match(sql, /alter table private\.algo_l1_policy/i);
  for (const [column, value] of [
    ['l2_affinity_enabled', 'false'],
    ['l2_affinity_horizon_days', '90'],
    ['l2_affinity_like_weight', '2.0'],
    ['l2_affinity_comment_weight', '3.0'],
    ['l2_affinity_save_weight', '4.0'],
    ['l2_affinity_completed_weight', '2.0'],
    ['l2_affinity_long_watch_weight', '1.0'],
    ['l2_affinity_rewatch_weight', '1.0'],
    ['l2_affinity_short_watch_penalty', '1.5'],
    ['l2_affinity_long_watch_ratio_threshold', '0.50'],
    ['l2_affinity_negative_min_distinct_videos', '2'],
    ['l2_affinity_per_video_positive_cap', '8.0'],
    ['l2_affinity_per_video_negative_cap', '2.0'],
    ['l2_affinity_creator_positive_cap', '18.0'],
    ['l2_affinity_creator_negative_cap', '12.0'],
  ]) {
    assert.match(
      sql,
      new RegExp(`add column ${column}[\\s\\S]{0,100}?default\\s+${value.replace('.', '\\.')}`, 'i'),
      `${column} must default to ${value}`,
    );
  }

  assert.match(sql, /l2_affinity_horizon_days\s+between\s+1\s+and\s+365/i);
  assert.match(sql, /l2_affinity_long_watch_ratio_threshold\s+between\s+0\s+and\s+1/i);
  assert.match(sql, /l2_affinity_negative_min_distinct_videos\s*>=\s*1/i);
  assert.match(sql, /least\([\s\S]*l2_affinity_like_weight[\s\S]*l2_affinity_creator_negative_cap[\s\S]*\)\s*>=\s*0/i);

  assert.doesNotMatch(sql, /create table\s+(?:public|private)\.[^\s(]*(?:affinity|interest|rank|score|cache)/i);
  assert.doesNotMatch(sql, /create\s+(?:materialized\s+)?view\s+(?:public|private)\./i);
  assert.doesNotMatch(sql, /update\s+private\.algo_l1_policy/i,
    'L2 migration must preserve historical canary state without a policy DML reset');
  assert.doesNotMatch(
    sql,
    /(?:update|insert\s+into|delete\s+from)\s+public\.(?:videos|video_views|likes|comments|video_saves|follows)/i,
  );
});

test('L2 affinity is set-based inside the one ranking RPC and the existing reconciler', () => {
  const { sql } = readL2Migration();
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');

  assert.equal((sql.match(/create or replace function public\.get_ranked_feed_l1_v1/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /create or replace function public\.(?:get_ranked_feed_l2|.*affinity.*feed)/i);
  assert.match(ranking, /security definer[\s\S]{0,100}set search_path\s*=\s*''/i);
  assert.match(ranking, /candidate_creators as materialized/i);
  assert.match(ranking, /affinity_like_signals as/i);
  assert.match(ranking, /affinity_comment_signals as/i);
  assert.match(ranking, /affinity_save_signals as/i);
  assert.match(ranking, /affinity_view_signals as/i);
  assert.match(ranking, /affinity_video_scores as/i);
  assert.match(ranking, /affinity_creator_scores as/i);
  assert.match(ranking, /l\.user_id\s*=\s*v_viewer_id/i);
  assert.match(ranking, /cmt\.user_id\s*=\s*v_viewer_id/i);
  assert.match(ranking, /s\.user_id\s*=\s*v_viewer_id/i);
  assert.match(ranking, /vv\.viewer_id\s*=\s*v_viewer_id/i);
  assert.match(ranking, /created_at\s*<=\s*v_as_of/i);
  assert.match(ranking, /make_interval\(days\s*=>\s*v_policy\.l2_affinity_horizon_days\)/i);
  assert.match(ranking, /count\(distinct\s+avs\.video_id\)/i);
  assert.match(ranking, /distinct_short_watch_videos[\s\S]{0,120}>=\s*v_policy\.l2_affinity_negative_min_distinct_videos/i);
  assert.match(ranking, /l2_affinity_per_video_positive_cap/i);
  assert.match(ranking, /l2_affinity_per_video_negative_cap/i);
  assert.match(ranking, /l2_affinity_creator_positive_cap/i);
  assert.match(ranking, /l2_affinity_creator_negative_cap/i);
  assert.match(ranking, /c\.user_id\s*=\s*v_viewer_id[\s\S]{0,80}0::numeric/i);
  assert.match(ranking, /'behavioral_l2'/i);
  assert.match(ranking, /creator_affinity_points/i);

  const affinityStart = ranking.toLowerCase().indexOf('candidate_creators as materialized');
  const affinityEnd = ranking.toLowerCase().indexOf('like_features as', affinityStart);
  assert.ok(affinityStart > 0 && affinityEnd > affinityStart);
  const affinityBlock = ranking.slice(affinityStart, affinityEnd);
  assert.doesNotMatch(affinityBlock, /public\.follows/i, 'follow must remain only the L1 direct boost');
  assert.doesNotMatch(affinityBlock, /advertising|campaign|billing|financial_transactions|ledger_entries|wallet|stripe/i);
  assert.doesNotMatch(affinityBlock, /join\s+lateral|\brandom\s*\(/i);

  for (const key of [
    'l2_affinity_policy_invalid',
    'l2_affinity_unexpectedly_enabled',
    'l2_affinity_authority_missing',
    'l2_affinity_materialization_present',
  ]) {
    assert.ok(reconciler.includes(`'${key}'`), `${key} must be reconciled by the existing authority`);
  }
  assert.match(sql, /grant execute on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_l1_v1\(\) to service_role/i);
});

test('thin Feed client accepts behavioral_l2 without calculating affinity', () => {
  assert.match(rankingClient, /RankedFeedMode\s*=\s*'chronological'\s*\|\s*'behavioral_l1'\s*\|\s*'behavioral_l2'/);
  assert.match(rankingClient, /row\.ranking_mode\s*===\s*'behavioral_l2'/);
  assert.match(rankingClient, /client\.rpc\('get_ranked_feed_l1_v1'/);
  assert.doesNotMatch(
    rankingClient,
    /affinity_(?:weight|score|points)|creatorAffinity|l2_affinity|public\.videos|\.from\(['"]videos['"]\)/i,
  );
});

test('thin Feed client validates and returns behavioral_l2 from the canonical RPC', async () => {
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const row = {
    id: '52000000-0000-4000-8000-000000000002',
    creator_username: 'creator',
    creator_avatar: 'https://example.test/avatar.jpg',
    created_at: '2026-10-03T01:00:00.000Z',
    ranking_mode: 'behavioral_l2',
    policy_version: 'nelyon-algo-l2-v1',
    rank_score: '18.000000',
    feed_as_of: '2026-10-03T01:01:00.000Z',
    cursor_score: '18.000000',
    cursor_created_at: '2026-10-03T01:00:00.000Z',
    cursor_id: '52000000-0000-4000-8000-000000000002',
    effective_page_limit: 10,
    ranking_decision_id: null,
    ranking_organic_position: null,
  };
  const client = {
    async rpc(name) {
      assert.equal(name, 'get_ranked_feed_l1_v1');
      return { data: [row], error: null };
    },
  };
  const page = await fetchRankedFeedPage(client, {
    clientSessionId: '55000000-0000-4000-8000-000000000001',
  }, value => value.id);
  assert.equal(page.rankingMode, 'behavioral_l2');
  assert.deepEqual(page.videos, [row.id]);
});
