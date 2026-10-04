import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l4_directed_canary.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const allMigrationSql = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('.sql'))
  .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'))
  .join('\n');

test('directed L4 extends the canonical canary in exactly one migration', () => {
  assert.equal(migrationNames.length, 1);
  assert.doesNotMatch(migrationSql, /create\s+(?:unlogged\s+)?table/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:materialized\s+)?view/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(migrationSql,
    /create\s+(?:or replace\s+)?function\s+(?:public|private)\.(?:get_ranked_feed_l4|manage_algo_l4_canary|request_my_algo_l4_canary|reconcile_algo_l4)/i);
  assert.doesNotMatch(allMigrationSql,
    /create\s+(?:or replace\s+)?function\s+(?:public|private)\.(?:get_ranked_feed_l4|manage_algo_l4_canary|request_my_algo_l4_canary|reconcile_algo_l4)/i);
});

test('the existing target constraint is widened to l1 l2 l3 l4 without rewriting state', () => {
  const schemaSection = migrationSql.split(
    'create or replace function public.manage_algo_l1_canary_v1',
  )[0];
  assert.match(migrationSql,
    /drop constraint algo_l1_policy_canary_target_layer_check[\s\S]*add constraint algo_l1_policy_canary_target_layer_check[\s\S]*canary_target_layer\s+in\s*\(\s*'l1'\s*,\s*'l2'\s*,\s*'l3'\s*,\s*'l4'\s*\)/i);
  assert.doesNotMatch(schemaSection, /update\s+private\.algo_l1_policy/i);
  assert.doesNotMatch(migrationSql, /alter\s+column\s+canary_target_layer\s+drop\s+not\s+null/i);
});

test('enrollment remains the same no-argument authenticated authority', () => {
  assert.doesNotMatch(migrationSql,
    /create or replace function public\.request_my_algo_l1_canary_v1/i);
  assert.doesNotMatch(allMigrationSql, /request_my_algo_l4_canary/i);
});

test('the same service-only controller adds fail-closed arm_l4 semantics', () => {
  assert.match(migrationSql,
    /create or replace function public\.manage_algo_l1_canary_v1\(\s*p_action text,\s*p_request_id uuid default null,\s*p_ttl_minutes integer default null\s*\)/i);
  assert.match(migrationSql, /if v_action in \('arm', 'arm_l2', 'arm_l3', 'arm_l4'\)/i);
  assert.match(migrationSql,
    /v_target_layer := case[\s\S]*when v_action = 'arm_l2' then 'l2'[\s\S]*when v_action = 'arm_l3' then 'l3'[\s\S]*when v_action = 'arm_l4' then 'l4'[\s\S]*else 'l1'/i);
  assert.match(migrationSql,
    /if v_action = 'arm_l4' and v_policy\.l4_context_enabled then[\s\S]*algo_l4_canary_global_enabled/i);
  assert.match(migrationSql,
    /if v_action = 'arm_l4' and v_policy\.l3_quality_enabled then[\s\S]*algo_l4_canary_l3_global_enabled/i);
  assert.match(migrationSql,
    /if v_action = 'arm_l4' and v_policy\.l2_affinity_enabled then[\s\S]*algo_l4_canary_l2_global_enabled/i);
  assert.match(migrationSql, /p_ttl_minutes not between 5 and 60/i);
  assert.match(migrationSql, /canary_requested_at <= v_now - interval '30 minutes'/i);
  assert.match(migrationSql,
    /canary_target_layer = v_target_layer,[\s\S]*canary_generation = canary_generation \+ 1/i);
  assert.match(migrationSql, /if v_action = 'disarm'/i);
  assert.match(migrationSql,
    /grant execute on function public\.manage_algo_l1_canary_v1\(text,uuid,integer\) to service_role/i);
  assert.doesNotMatch(migrationSql, /manage_algo_l1_canary_v1\([^)]*user_id/i);
});

test('directed L4 activates L1 plus L4 and never implies L2 or L3', () => {
  assert.match(migrationSql, /create or replace function public\.get_ranked_feed_l1_v1\(/i);
  assert.match(migrationSql, /v_directed_l4_canary boolean/i);
  assert.match(migrationSql,
    /v_directed_l4_canary := v_directed_canary[\s\S]*canary_target_layer = 'l4'/i);
  assert.match(migrationSql,
    /v_l4_effective := v_behavioral[\s\S]*l4_context_enabled[\s\S]*v_directed_l4_canary/i);

  const l2Gate = migrationSql.match(/v_l2_effective\s*:=([\s\S]*?);/i)?.[1] ?? '';
  assert.match(l2Gate, /l2_affinity_enabled/i);
  assert.match(l2Gate, /v_directed_l2_canary/i);
  assert.doesNotMatch(l2Gate, /v_directed_l4_canary/i);

  const l3Gate = migrationSql.match(/v_l3_effective\s*:=([\s\S]*?);/i)?.[1] ?? '';
  assert.match(l3Gate, /l3_quality_enabled/i);
  assert.match(l3Gate, /v_directed_l3_canary/i);
  assert.doesNotMatch(l3Gate, /v_directed_l4_canary/i);

  assert.match(migrationSql,
    /when not v_behavioral then 'chronological'[\s\S]*when v_l4_effective then 'behavioral_l4'[\s\S]*when v_l3_effective then 'behavioral_l3'[\s\S]*when v_l2_effective then 'behavioral_l2'[\s\S]*else 'behavioral_l1'/i);
  assert.match(migrationSql,
    /canary_target_layer = 'l3' then ':l3'[\s\S]*canary_target_layer = 'l4' then ':l4'[\s\S]*:active[\s\S]*:inactive/i);
});

test('the canonical reconciler owns both directed L4 safety checks', () => {
  assert.match(migrationSql, /create or replace function public\.reconcile_algo_l1_v1\(\)/i);
  for (const key of [
    'canary_target_invalid',
    'l4_directed_canary_authority_missing',
    'l4_directed_canary_state_invalid',
    'l4_session_authority_missing',
    'l4_sensitive_context_dependency_present',
  ]) assert.match(migrationSql, new RegExp(`'${key}'`, 'i'));
  assert.match(migrationSql, /canary_target_layer not in \('l1','l2','l3','l4'\)/i);
  assert.match(migrationSql,
    /l4_directed_canary_state_invalid[\s\S]*canary_target_layer = 'l4'[\s\S]*not enabled[\s\S]*production_rollout_bps <> 0[\s\S]*l4_context_enabled[\s\S]*l3_quality_enabled[\s\S]*l2_affinity_enabled/i);
  assert.match(migrationSql, /set search_path = ''/i);
});
