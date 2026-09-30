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
  assert.match(fn, /row_number\(\) over\s*\(\s*partition by ac\.user_id/i);
  assert.match(fn, /as creator_rank/i);
  assert.match(fn, /(?:\w+\.)?rank_score desc,\s*(?:\w+\.)?created_at desc,\s*(?:\w+\.)?id desc/i);
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
