import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l6_training_readiness_monitoring.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const f2Url = new URL(
  '../supabase/migrations/20261005165310_algo6_l6_observation_dataset_foundation.sql',
  import.meta.url,
);
const f2Sql = readFileSync(f2Url, 'utf8');
const readinessStart = migrationSql.toLowerCase()
  .indexOf('create or replace function public.get_algo6_l6_training_readiness_v1()');
const readinessEnd = migrationSql.toLowerCase()
  .indexOf('revoke all on function public.get_algo6_l6_training_readiness_v1()', readinessStart);
const readinessSql = readinessStart >= 0 && readinessEnd > readinessStart
  ? migrationSql.slice(readinessStart, readinessEnd)
  : '';

test('L6-F4 starts red until exactly one CLI-named readiness migration exists', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_algo6_l6_training_readiness_monitoring\.sql$/);
});

test('migration adds one aggregate readiness RPC and no persistence or online-path objects', () => {
  assert.match(migrationSql,
    /create or replace function public\.get_algo6_l6_training_readiness_v1\(\)\s*returns jsonb/i);
  assert.doesNotMatch(migrationSql,
    /create\s+(?:unlogged\s+)?table|create\s+(?:materialized\s+)?view|create\s+trigger|cron\.schedule|create\s+index/i);
  assert.doesNotMatch(migrationSql,
    /create\s+(?:or replace\s+)?function\s+public\.get_ranked_feed_l1_v1|record_organic_ranking_(?:impression|engagement)_v1\s*\(/i);
  assert.doesNotMatch(migrationSql,
    /model_registry|training_dataset|feature_store|prediction_cache|inference_service|user_(?:feature_)?vector/i);
});

test('readiness RPC is zero-argument JSONB SECURITY DEFINER with an empty search path', () => {
  assert.match(readinessSql, /returns jsonb[\s\S]*language sql[\s\S]*security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.doesNotMatch(readinessSql, /\bexecute\b|format\s*\(|query\s+execute/i);
  for (const relation of [
    'private.organic_ranking_decisions',
    'private.organic_ranking_items',
    'private.organic_ranking_impressions',
    'private.organic_ranking_engagement_events',
    'public.video_views',
    'private.algo_l1_policy',
  ]) assert.match(readinessSql, new RegExp(relation.replaceAll('.', '\\.'), 'i'));
});

test('readiness contract and approved numeric gates are versioned exactly', () => {
  for (const value of [
    'algo6-l6-training-readiness-v1',
    'organic-ranking-observation-v1',
    'organic-ranking-features-l1-l5-v1',
    'PROPOSED_TEMPORAL_SPLIT_V1',
  ]) assert.match(readinessSql, new RegExp(value, 'i'));
  for (const value of [250000, 100000, 2000, 200, 84, 10000, 5000, 500]) {
    assert.match(readinessSql, new RegExp(`\\b${value}\\b`));
  }
  for (const key of [
    'contract_version', 'generated_at', 'observation_schema_version',
    'feature_contract_version', 'overall_status', 'training_entry_ready',
    'blocking_reasons', 'global_gates', 'data_quality', 'observation_continuity',
    'head_monitoring', 'temporal_split', 'current_policy_state',
  ]) assert.match(readinessSql, new RegExp(`'${key}'`, 'i'));
});

test('unique visible impression gate reports total and distinct and divergence is structural', () => {
  assert.match(readinessSql, /count\s*\(\s*\*\s*\)[\s\S]*visible_impressions_total/i);
  assert.match(readinessSql, /count\s*\(\s*distinct\s+[^)]*client_event_id\s*\)[\s\S]*unique_visible_impressions/i);
  assert.match(readinessSql, /duplicate_impression_identities/i);
  assert.match(readinessSql, /STRUCTURAL_FAILURE/i);
  assert.match(readinessSql, /unique_visible_organic_impressions/i);
});

test('maturity and exact valid-retention linkage preserve censored and rewatch semantics', () => {
  assert.match(readinessSql, /created_at\s*<=\s*[^\n;]*generated_at[^\n;]*interval\s*'24 hours'/i);
  assert.match(readinessSql, /v\.client_event_id\s*=\s*i\.client_event_id/i);
  assert.match(readinessSql, /v\.video_id\s*=\s*i\.video_id/i);
  assert.match(readinessSql, /v\.client_session_id\s*=\s*i\.client_session_id/i);
  assert.match(readinessSql, /v\.viewer_id\s+is\s+not\s+distinct\s+from\s+i\.viewer_user_id/i);
  assert.match(readinessSql, /media_duration_ms\s*>\s*0/i);
  assert.match(readinessSql, /completion_ratio\s+is\s+not\s+null/i);
  assert.doesNotMatch(readinessSql, /completion_ratio\s*<=\s*1(?:\.0+)?/i);
  assert.match(readinessSql, /unlinked_mature_impressions/i);
});

test('unapproved labels stay provisional and can never make training entry ready', () => {
  assert.match(readinessSql, /PROVISIONAL_LABEL_CONTRACT/i);
  assert.match(readinessSql, /PENDING_FINAL_LABEL_CONTRACT/i);
  assert.match(readinessSql, /NOT_EVALUABLE/i);
  assert.match(readinessSql, /unresolved_label_contracts/i);
  assert.match(readinessSql, /training_entry_ready[\s\S]*false/i);
  assert.match(readinessSql, /long_watch/i);
  assert.match(readinessSql, /completion/i);
  assert.match(readinessSql, /rewatch/i);
  assert.match(readinessSql, /external_mature_like/i);
  assert.match(readinessSql, /external_mature_save/i);
});

test('early-exit is distribution-only and reversals remain separate raw observations', () => {
  assert.match(readinessSql, /exit_reason_distribution/i);
  for (const reason of ['swipe', 'background', 'unmount', 'unknown', 'ended']) {
    assert.match(readinessSql, new RegExp(`'${reason}'`, 'i'));
  }
  for (const action of ['unlike', 'unsave', 'unfollow']) {
    assert.match(readinessSql, new RegExp(`'${action}'`, 'i'));
  }
  assert.doesNotMatch(readinessSql, /early_exit[^\n]{0,80}(?:completion_ratio|watch_duration_ms)\s*[<>]=?\s*0?\./i);
});

test('readiness RPC ACL is service-role only', () => {
  assert.match(migrationSql,
    /revoke all on function public\.get_algo6_l6_training_readiness_v1\(\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migrationSql,
    /grant execute on function public\.get_algo6_l6_training_readiness_v1\(\)\s+to service_role/i);
});

test('reconciler preserves the exact 65-key F2 base and appends exactly three readiness checks', () => {
  const oldStart = f2Sql.indexOf('create or replace function public.reconcile_algo_l1_v1()');
  const oldEnd = f2Sql.indexOf('revoke all on function public.reconcile_algo_l1_v1()', oldStart);
  const oldKeys = [...f2Sql.slice(oldStart, oldEnd).matchAll(/^\s+'([a-z0-9_]+)',\s*\(/gim)]
    .map(match => match[1]);
  assert.equal(oldKeys.length, 65);
  assert.match(migrationSql,
    /alter function public\.reconcile_algo_l1_v1\(\) set schema private[\s\S]*alter function private\.reconcile_algo_l1_v1\(\) rename to reconcile_algo_l1_f2_v1/i);
  assert.match(migrationSql,
    /revoke all on function private\.reconcile_algo_l1_f2_v1\(\)\s+from public, anon, authenticated, service_role/i);
  const newStart = migrationSql.toLowerCase().indexOf('create or replace function public.reconcile_algo_l1_v1()');
  const newEnd = migrationSql.toLowerCase().indexOf('revoke all on function public.reconcile_algo_l1_v1()', newStart);
  const newKeys = [...migrationSql.slice(newStart, newEnd).matchAll(/^\s+'([a-z0-9_]+)',\s*\(/gim)]
    .map(match => match[1]);
  assert.equal(newKeys.length, 3);
  assert.equal(new Set([...oldKeys, ...newKeys]).size, 68);
  assert.match(migrationSql.slice(newStart, newEnd), /private\.reconcile_algo_l1_f2_v1\(\)/i);
  assert.deepEqual(newKeys.sort(), [
    'l6_training_readiness_authority_missing',
    'l6_training_readiness_contract_invalid',
    'l6_training_readiness_forbidden_dependency_present',
  ]);
});

test('readiness authority excludes forbidden product domains and online-ranker calls', () => {
  assert.doesNotMatch(readinessSql,
    /advertising_|marketplace_|financial_transactions|ledger_entries|ledger_accounts|wallet|escrow|stripe|creator_earnings|public\.messages|private_chat|content_safety_(?:alerts|reports|warnings)|gps|latitude|longitude|device_fingerprint|network_type/i);
  assert.doesNotMatch(readinessSql,
    /get_ranked_feed_l1_v1|record_organic_ranking_impression_v1|record_organic_ranking_engagement_v1|record_video_view_v1/i);
});

test('historical F2 migration remains byte-identical', () => {
  assert.equal(
    createHash('sha256').update(f2Sql).digest('hex').toUpperCase(),
    '88BD0EDBF7CA168219D9046DB5CF1B7EF393CD3EA07AEFC95BAA5C14BB8160DB',
  );
});
