import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l2_directed_canary.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';

test('directed L2 canary uses one migration and no parallel authority', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationSql, /alter table private\.algo_l1_policy/i);
  assert.doesNotMatch(migrationSql, /create table/i);
  assert.doesNotMatch(migrationSql, /create (?:or replace )?function public\.(?:get_ranked_feed_l2|manage_algo_l2_canary|request_my_algo_l2_canary|reconcile_algo_l2)/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:unlogged\s+)?table\s+[^;]*(?:affinity|canary)/i);
});

test('one operational target defaults to l1 and remains outside the algorithm version guard', () => {
  assert.match(migrationSql, /add column canary_target_layer text not null default 'l1'/i);
  assert.match(migrationSql, /check\s*\(\s*canary_target_layer\s+in\s*\(\s*'l1'\s*,\s*'l2'\s*\)\s*\)/i);
  assert.match(migrationSql, /create or replace function private\.guard_algo_l1_policy_v1\(\)/i);
  assert.match(migrationSql, /- 'canary_target_layer'/i);
  assert.doesNotMatch(migrationSql, /- 'l2_affinity_[^']+'/i);
  assert.doesNotMatch(migrationSql, /update private\.algo_l1_policy\s+set\s+canary_generation\s*=\s*2/i);
});

test('fresh enrollment keeps the same no-argument authority and resets target to l1', () => {
  assert.match(migrationSql, /create or replace function public\.request_my_algo_l1_canary_v1\(\s*\)/i);
  assert.match(migrationSql, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migrationSql, /set canary_enabled = false,[\s\S]*canary_target_layer = 'l1',[\s\S]*canary_armed_at = null,[\s\S]*canary_expires_at = null/i);
  assert.doesNotMatch(migrationSql, /request_my_algo_l1_canary_v1\([^)]*(?:user_id|target)/i);
  assert.match(migrationSql, /grant execute on function public\.request_my_algo_l1_canary_v1\(\) to authenticated/i);
});

test('the same service-only controller supports arm, arm_l2 and disarm', () => {
  assert.match(migrationSql, /create or replace function public\.manage_algo_l1_canary_v1\(\s*p_action text,\s*p_request_id uuid default null,\s*p_ttl_minutes integer default null\s*\)/i);
  assert.match(migrationSql, /if v_action in \('arm', 'arm_l2'\)/i);
  assert.match(migrationSql, /v_target_layer := case when v_action = 'arm_l2' then 'l2' else 'l1' end/i);
  assert.match(migrationSql, /if v_action = 'arm_l2' and v_policy\.l2_affinity_enabled then/i);
  assert.match(migrationSql, /production_rollout_bps <> 0/i);
  assert.match(migrationSql, /p_ttl_minutes not between 5 and 60/i);
  assert.match(migrationSql, /canary_target_layer = v_target_layer,[\s\S]*canary_generation = canary_generation \+ 1/i);
  assert.match(migrationSql, /if v_action = 'disarm'/i);
  assert.match(migrationSql, /grant execute on function public\.manage_algo_l1_canary_v1\(text,uuid,integer\) to service_role/i);
  assert.doesNotMatch(migrationSql, /manage_algo_l1_canary_v1\([^)]*user_id/i);
});

test('the canonical ranking RPC gates exact L2 math through the directed target', () => {
  assert.match(migrationSql, /create or replace function public\.get_ranked_feed_l1_v1\(/i);
  assert.match(migrationSql, /v_directed_l2_canary boolean/i);
  assert.match(migrationSql, /v_l2_effective boolean/i);
  assert.match(migrationSql, /v_directed_l2_canary := v_directed_canary[\s\S]*canary_target_layer = 'l2'/i);
  assert.match(migrationSql, /v_l2_effective := v_viewer_id is not null[\s\S]*l2_affinity_enabled[\s\S]*v_directed_l2_canary/i);
  assert.match(migrationSql, /when v_l2_effective then 'behavioral_l2'/i);
  assert.match(migrationSql, /\|canary:' \|\| v_policy\.canary_generation[\s\S]*then ':l2'[\s\S]*:active[\s\S]*:inactive/i);
  assert.equal((migrationSql.match(/where v_l2_effective/gi) ?? []).length, 4);
  assert.match(migrationSql, /creator_affinity_points/i);
  assert.doesNotMatch(migrationSql, /random\(\)/i);
});

test('the one reconciler validates the target and directed L2 authority without treating it as global enablement', () => {
  assert.match(migrationSql, /create or replace function public\.reconcile_algo_l1_v1\(\)/i);
  for (const key of [
    'canary_target_invalid',
    'l2_directed_canary_authority_missing',
    'l2_directed_canary_state_invalid',
    'l2_affinity_unexpectedly_enabled',
  ]) assert.match(migrationSql, new RegExp(`'${key}'`, 'i'));
  assert.match(migrationSql, /canary_target_layer not in \('l1','l2'\)/i);
  assert.match(migrationSql, /has_function_privilege\('service_role', oid, 'execute'\)/i);
  assert.match(migrationSql, /not pg_catalog\.has_function_privilege\('authenticated', oid, 'execute'\)/i);
  assert.match(migrationSql, /set search_path = ''/i);
});
