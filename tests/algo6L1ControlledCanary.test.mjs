import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l1_controlled_canary.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const feedContext = readFileSync(new URL('../contexts/FeedContext.tsx', import.meta.url), 'utf8');
const devServiceUrl = new URL('../services/algoL1CanaryDev.ts', import.meta.url);

test('controlled canary has one forward-only migration and no parallel ranking authority', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationSql, /alter table private\.algo_l1_policy/i);
  assert.doesNotMatch(migrationSql, /create table (?:private\.)?algo_(?:l1_)?canary/i);
  assert.doesNotMatch(migrationSql, /create (?:or replace )?function public\.(?!get_ranked_feed_l1_v1|request_my_algo_l1_canary_v1|manage_algo_l1_canary_v1|reconcile_algo_l1_v1)[a-z0-9_]*ranked_feed/i);
});

test('policy extension defaults to disarmed zero-rollout state and preserves one algorithm version', () => {
  for (const column of [
    'canary_enabled', 'canary_user_id', 'canary_request_id', 'canary_requested_at',
    'canary_armed_at', 'canary_expires_at', 'canary_generation',
  ]) assert.match(migrationSql, new RegExp(`add column ${column}`, 'i'));
  assert.match(migrationSql, /canary_enabled[^;]*default false/i);
  assert.match(migrationSql, /canary_generation[^;]*default 0/i);
  assert.match(migrationSql, /production_rollout_bps\s*=\s*0/i);
  assert.match(migrationSql, /canary_enabled\s*=\s*false/i);
  assert.match(migrationSql, /canary_user_id\s*=\s*null/i);
  assert.match(migrationSql, /canary_request_id\s*=\s*null/i);
  assert.doesNotMatch(migrationSql, /algo_l1_policy_v2|algo_canary_ranking_policy/i);
});

test('enrollment derives the authenticated actor and creates pending state without activation', () => {
  assert.match(migrationSql, /create or replace function public\.request_my_algo_l1_canary_v1\(\s*\)/i);
  assert.match(migrationSql, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migrationSql, /gen_random_uuid\(\)/i);
  assert.match(migrationSql, /interval '30 minutes'/i);
  assert.match(migrationSql, /canary_enabled\s*=\s*false[\s\S]*canary_user_id\s*=\s*v_user_id[\s\S]*canary_request_id\s*=\s*v_request_id/i);
  assert.match(migrationSql, /grant execute on function public\.request_my_algo_l1_canary_v1\(\) to authenticated/i);
  assert.match(migrationSql, /revoke all on function public\.request_my_algo_l1_canary_v1\(\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migrationSql, /request_my_algo_l1_canary_v1\([^)]*user_id/i);
});

test('service-only ARM and DISARM enforce request identity, TTL, rollout zero and generation changes', () => {
  assert.match(migrationSql, /create or replace function public\.manage_algo_l1_canary_v1\(\s*p_action text,\s*p_request_id uuid default null,\s*p_ttl_minutes integer default null\s*\)/i);
  assert.match(migrationSql, /p_ttl_minutes not between 5 and 60/i);
  assert.match(migrationSql, /production_rollout_bps\s*<>\s*0/i);
  assert.match(migrationSql, /canary_request_id is distinct from p_request_id/i);
  assert.match(migrationSql, /if v_action = 'disarm'[\s\S]*canary_request_id is distinct from p_request_id[\s\S]*not v_policy\.canary_enabled/i);
  assert.match(migrationSql, /from auth\.users/i);
  assert.match(migrationSql, /canary_generation\s*=\s*canary_generation\s*\+\s*1/i);
  assert.match(migrationSql, /grant execute on function public\.manage_algo_l1_canary_v1\(text,uuid,integer\) to service_role/i);
  assert.match(migrationSql, /revoke all on function public\.manage_algo_l1_canary_v1\(text,uuid,integer\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migrationSql, /manage_algo_l1_canary_v1\([^)]*user_id/i);
});

test('the one ranking RPC gates directed canary and versions only the selected tester cursor', () => {
  assert.match(migrationSql, /create or replace function public\.get_ranked_feed_l1_v1\(/i);
  assert.match(migrationSql, /v_viewer_id is not null[\s\S]*v_viewer_id = v_policy\.canary_user_id/i);
  assert.match(migrationSql, /v_now < v_policy\.canary_expires_at/i);
  assert.match(migrationSql, /v_as_of >= v_policy\.canary_armed_at[\s\S]*v_as_of < v_policy\.canary_expires_at/i);
  assert.match(migrationSql, /\|canary:' \|\| v_policy\.canary_generation[\s\S]*:active[\s\S]*:inactive/i);
  assert.match(migrationSql, /p_policy_version is distinct from v_effective_policy_version/i);
  assert.match(migrationSql, /v_directed_canary[\s\S]*or[\s\S]*v_rollout_bucket < v_policy\.production_rollout_bps/i);
  assert.doesNotMatch(migrationSql, /random\(\)/i);
});

test('policy guard exempts only operational canary fields and reconciliation covers canary safety', () => {
  assert.match(migrationSql, /create or replace function private\.guard_algo_l1_policy_v1\(\)/i);
  for (const field of [
    'canary_enabled', 'canary_user_id', 'canary_request_id', 'canary_requested_at',
    'canary_armed_at', 'canary_expires_at', 'canary_generation',
  ]) assert.match(migrationSql, new RegExp(`'${field}'`, 'i'));
  for (const key of [
    'canary_state_invalid', 'canary_acl_invalid', 'canary_request_acl_invalid',
    'canary_expired_but_effective', 'canary_rollout_conflict', 'canary_generation_invalid',
  ]) assert.match(migrationSql, new RegExp(`'${key}'`, 'i'));
});

test('development controller enrolls once per identity session and emits PII-safe diagnostics', async () => {
  assert.equal(existsSync(devServiceUrl), true, 'development-only canary helper must exist');
  const {
    maybeRequestAlgoL1CanaryEnrollment,
    logAlgoL1CanaryFirstPage,
  } = await import(devServiceUrl.href);
  const requestId = '41000000-0000-4000-8000-000000000001';
  const viewerA = '41000000-0000-4000-8000-000000000002';
  const viewerB = '41000000-0000-4000-8000-000000000003';
  const state = { enrollmentKey: null };
  const calls = [];
  const logs = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{ status: 'pending', request_id: requestId, requested_at: '2026-09-30T22:30:00.000Z' }],
        error: null,
      };
    },
  };

  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: false, enrollFlag: '1', viewerId: viewerA, clientSessionId: 'session-a', state, log: value => logs.push(value) });
  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: true, enrollFlag: '0', viewerId: viewerA, clientSessionId: 'session-a', state, log: value => logs.push(value) });
  assert.equal(calls.length, 0, 'production or disabled builds must never enroll');

  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: true, enrollFlag: '1', viewerId: viewerA, clientSessionId: 'session-a', state, log: value => logs.push(value) });
  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: true, enrollFlag: '1', viewerId: viewerA, clientSessionId: 'session-a', state, log: value => logs.push(value) });
  assert.equal(calls.length, 1, 'one identity session must enroll only once');
  assert.deepEqual(calls[0], { name: 'request_my_algo_l1_canary_v1', args: {} });

  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: true, enrollFlag: '1', viewerId: null, clientSessionId: 'session-logout', state, log: value => logs.push(value) });
  await maybeRequestAlgoL1CanaryEnrollment({ client, isDev: true, enrollFlag: '1', viewerId: viewerB, clientSessionId: 'session-b', state, log: value => logs.push(value) });
  assert.equal(calls.length, 2, 'auth identity change must allow the new session to enroll once');
  assert.ok(logs.every(value => !value.includes(viewerA) && !value.includes(viewerB)));
  assert.ok(logs.some(value => value === `[ALGO-L1-CANARY] enrollment=pending request=${requestId}`));

  logAlgoL1CanaryFirstPage({ isDev: false, enrollFlag: '1', rankingMode: 'behavioral_l1', policyVersion: 'nelyon-algo-l1-v1|canary:1:active', rowCount: 6, log: value => logs.push(value) });
  const beforeDiagnostic = logs.length;
  logAlgoL1CanaryFirstPage({ isDev: true, enrollFlag: '1', rankingMode: 'behavioral_l1', policyVersion: 'nelyon-algo-l1-v1|canary:1:active', rowCount: 6, log: value => logs.push(value) });
  assert.equal(logs.length, beforeDiagnostic + 1);
  assert.equal(logs.at(-1), '[ALGO-L1-CANARY] mode=behavioral_l1 policy=nelyon-algo-l1-v1|canary:1:active rows=6');
});

test('FeedContext wires enrollment and first-page diagnostics only behind DEV plus the public flag', () => {
  assert.match(feedContext, /EXPO_PUBLIC_ALGO_L1_CANARY_ENROLL/);
  assert.match(feedContext, /__DEV__/);
  assert.match(feedContext, /maybeRequestAlgoL1CanaryEnrollment/);
  assert.match(feedContext, /logAlgoL1CanaryFirstPage/);
  assert.doesNotMatch(feedContext, /\.from\(['"]algo_l1_policy['"]\)/i);
  assert.doesNotMatch(feedContext, /canary_user_id/);
});
