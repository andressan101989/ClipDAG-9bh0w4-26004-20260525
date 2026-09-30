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
