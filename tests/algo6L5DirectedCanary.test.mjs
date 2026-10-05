import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l5_f4_directed_canary.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const allMigrationSql = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('.sql'))
  .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'))
  .join('\n');

test('F4 extends the existing authorities in exactly one forward-only migration', () => {
  assert.equal(migrationNames.length, 1);
  assert.doesNotMatch(migrationSql, /create\s+(?:unlogged\s+)?table/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:materialized\s+)?view/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(migrationSql,
    /create\s+(?:or replace\s+)?function\s+(?:public|private)\.(?:get_ranked_feed_l5|manage_algo_l5_canary|request_my_algo_l5_canary|reconcile_algo_l5)/i);
  assert.doesNotMatch(allMigrationSql,
    /create\s+(?:or replace\s+)?function\s+(?:public|private)\.(?:get_ranked_feed_l5|manage_algo_l5_canary|request_my_algo_l5_canary|reconcile_algo_l5)/i);
  assert.doesNotMatch(migrationSql,
    /(?:select|perform)\s+(?:public\.)?(?:refresh_video_semantic_profile_v1|claim_video_semantic|complete_video_semantic|fail_video_semantic)/i);
  assert.doesNotMatch(migrationSql,
    /insert\s+into\s+private\.video_semantic_profiles|update\s+private\.video_semantic_profiles/i);
});

test('canonical target constraint is widened through l5 without rewriting policy state', () => {
  const beforeController = migrationSql.split(
    'create or replace function public.manage_algo_l1_canary_v1',
  )[0];
  assert.match(migrationSql,
    /drop constraint algo_l1_policy_canary_target_layer_check[\s\S]*add constraint algo_l1_policy_canary_target_layer_check[\s\S]*canary_target_layer\s+in\s*\(\s*'l1'\s*,\s*'l2'\s*,\s*'l3'\s*,\s*'l4'\s*,\s*'l5'\s*\)/i);
  assert.doesNotMatch(beforeController, /update\s+private\.algo_l1_policy/i);
  assert.doesNotMatch(migrationSql, /alter\s+column\s+canary_target_layer\s+drop\s+not\s+null/i);
  assert.doesNotMatch(migrationSql, /l5_semantic_enabled\s*=\s*true/i);
  assert.doesNotMatch(migrationSql, /production_rollout_bps\s*=\s*[1-9]/i);
});

test('the same service-only controller implements arm_l5 with all fail-closed gates', () => {
  assert.match(migrationSql,
    /create or replace function public\.manage_algo_l1_canary_v1\(\s*p_action text,\s*p_request_id uuid default null,\s*p_ttl_minutes integer default null\s*\)/i);
  assert.match(migrationSql,
    /v_action in \('arm', 'arm_l2', 'arm_l3', 'arm_l4', 'arm_l5'\)/i);
  assert.match(migrationSql,
    /when v_action = 'arm_l5' then 'l5'/i);
  for (const [field, error] of [
    ['l5_semantic_enabled', 'algo_l5_canary_global_enabled'],
    ['l4_context_enabled', 'algo_l5_canary_l4_global_enabled'],
    ['l3_quality_enabled', 'algo_l5_canary_l3_global_enabled'],
    ['l2_affinity_enabled', 'algo_l5_canary_l2_global_enabled'],
  ]) {
    assert.match(migrationSql,
      new RegExp(`if v_action = 'arm_l5' and v_policy\\.${field} then[\\s\\S]*${error}`, 'i'));
  }
  assert.match(migrationSql, /p_ttl_minutes not between 5 and 60/i);
  assert.match(migrationSql, /canary_requested_at <= v_now - interval '30 minutes'/i);
  assert.match(migrationSql,
    /canary_target_layer = v_target_layer,[\s\S]*canary_generation = canary_generation \+ 1/i);
  assert.match(migrationSql, /if v_action = 'disarm'/i);
  assert.match(migrationSql,
    /grant execute on function public\.manage_algo_l1_canary_v1\(text,uuid,integer\) to service_role/i);
  assert.doesNotMatch(migrationSql, /manage_algo_l1_canary_v1\([^)]*user_id/i);
  assert.doesNotMatch(migrationSql,
    /create or replace function public\.request_my_algo_l1_canary_v1/i);
});

test('directed L5 is isolated to L1 plus L5 and has highest mode precedence', () => {
  assert.match(migrationSql, /v_directed_l5_canary boolean/i);
  assert.match(migrationSql,
    /v_directed_l5_canary := v_directed_canary[\s\S]*canary_target_layer = 'l5'/i);
  assert.match(migrationSql,
    /v_l5_effective := v_behavioral[\s\S]*v_viewer_id is not null[\s\S]*l5_semantic_enabled[\s\S]*v_directed_l5_canary/i);

  for (const [layer, ownDirected] of [
    ['l2', 'v_directed_l2_canary'],
    ['l3', 'v_directed_l3_canary'],
    ['l4', 'v_directed_l4_canary'],
  ]) {
    const gate = migrationSql.match(new RegExp(`v_${layer}_effective\\s*:=([\\s\\S]*?);`, 'i'))?.[1] ?? '';
    assert.match(gate, new RegExp(ownDirected, 'i'));
    assert.doesNotMatch(gate, /v_directed_l5_canary/i);
  }

  assert.match(migrationSql,
    /when not v_behavioral then 'chronological'[\s\S]*when v_l5_effective then 'behavioral_l5'[\s\S]*when v_l4_effective then 'behavioral_l4'[\s\S]*when v_l3_effective then 'behavioral_l3'[\s\S]*when v_l2_effective then 'behavioral_l2'[\s\S]*else 'behavioral_l1'/i);
  assert.match(migrationSql,
    /canary_target_layer = 'l4' then ':l4'[\s\S]*canary_target_layer = 'l5' then ':l5'[\s\S]*:active[\s\S]*:inactive/i);
});

test('F4 preserves F3 semantic math and never materializes user interests', () => {
  for (const marker of [
    'l5_positive_history', 'l5_negative_history', 'extensions.avg',
    'l5_candidate_semantics', '<=>', 'l5_semantic_adjustment',
  ]) assert.match(migrationSql, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(migrationSql,
    /create\s+(?:unlogged\s+)?table[\s\S]*?(user_interest_vectors|user_semantic_profiles|viewer_embeddings|semantic_centroids|semantic_interest_cache|user_embedding_cache)/i);
  assert.doesNotMatch(migrationSql, /hnsw|ivfflat|vectorize/i);
});

test('the canonical reconciler owns exactly the two F4 directed L5 checks', () => {
  assert.match(migrationSql, /create or replace function public\.reconcile_algo_l1_v1\(\)/i);
  const reconciler = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.reconcile_algo_l1_v1()'),
    migrationSql.indexOf('revoke all on function public.reconcile_algo_l1_v1()'),
  );
  const keys = [...reconciler.matchAll(/^\s+'([a-z0-9_]+)',\s*\(/gim)].map(match => match[1]);
  assert.equal(keys.length, 57);
  assert.equal(new Set(keys).size, 57);
  assert.match(migrationSql, /canary_target_layer not in \('l1','l2','l3','l4','l5'\)/i);
  assert.match(migrationSql, /'l5_directed_canary_authority_missing'/i);
  assert.match(migrationSql, /'l5_directed_canary_state_invalid'/i);
  assert.match(migrationSql,
    /l5_directed_canary_state_invalid[\s\S]*canary_target_layer = 'l5'[\s\S]*not enabled[\s\S]*production_rollout_bps <> 0[\s\S]*l5_semantic_enabled[\s\S]*l4_context_enabled[\s\S]*l3_quality_enabled[\s\S]*l2_affinity_enabled/i);
  const authority = migrationSql.slice(migrationSql.indexOf("'l5_directed_canary_authority_missing'"));
  for (const marker of [
    'v_directed_l5_canary', 'v_l5_effective', 'arm_l5',
    'algo_l5_canary_global_enabled', 'behavioral_l5',
  ]) assert.match(authority, new RegExp(marker, 'i'));
  assert.match(migrationSql, /set search_path = ''/i);
});
