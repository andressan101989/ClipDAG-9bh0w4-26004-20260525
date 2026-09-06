import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sha256Lf = text => createHash('sha256')
  .update(text.replaceAll('\r\n', '\n'), 'utf8').digest('hex');
const migrationName =
  '20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const proof = await read(
  'supabase/tests/live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql',
);
const harness = await read(
  'scripts/prove-live-battle-series-leave-bounded-concurrency.mjs',
);
const protectedFiles = {
  f5a: await read('supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql'),
  c3: await read('supabase/migrations/20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql'),
  c3c1: await read('supabase/migrations/20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql'),
  c3c1c1: await read('supabase/migrations/20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql'),
  package: await read('package.json'),
  lock: await read('package-lock.json'),
};
const migrationNames = (await readdir(new URL('../supabase/migrations', import.meta.url)))
  .filter(name => name.endsWith('.sql')).sort();
const helper = migration.match(
  /create or replace function private\.live_battle_series_try_lock_scope_strict[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const leave = migration.match(
  /create or replace function public\.leave_live_battle_series[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

const lockClosure = [
  ['auth.users', 'row share'],
  ['public.live_sessions', 'row share'],
  ['public.live_battles', 'row exclusive'],
  ['public.live_battle_score_states', 'row exclusive'],
  ['public.live_battle_series', 'row exclusive'],
  ['public.live_battle_rematch_requests', 'row exclusive'],
  ['public.live_battle_public_states', 'row exclusive'],
  ['public.live_battle_events', 'row exclusive'],
  ['public.live_battle_rule_sets', 'row share'],
  ['public.live_battle_power_states', 'row exclusive'],
  ['public.live_battle_boost_events', 'access share'],
  ['public.live_gift_transactions', 'access share'],
  ['public.live_battle_score_events', 'access share'],
];

test('C3-C1-C1-C1 remains in the append-only chain before F6-A and F8-A', () => {
  assert.deepEqual(migrationNames.slice(-8), [
    '20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
    '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
    '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
    '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
    migrationName,
    '20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql',
    '20260905230823_live_gift_platform_commission_35.sql',
    '20260906053652_live_battle_gift_like_scoring.sql',
  ]);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+(table|trigger|type|schema)\b/i);
});

test('rule set prelock is ROW SHARE and the obsolete boundary is rejected', () => {
  assert.match(helper,
    /lock table public\.live_battle_rule_sets in row share mode nowait/i);
  assert.match(helper, /live_battle_rule_sets[\s\S]*for key share nowait/i);
  assert.doesNotMatch(helper,
    /lock table public\.live_battle_rule_sets in access share mode nowait/i);
});

test('all thirteen prelocks remain mode-specific, NOWAIT and globally ordered', () => {
  let previous = -1;
  for (const [relation, mode] of lockClosure) {
    const position = helper.toLowerCase().indexOf(
      `lock table ${relation} in ${mode} mode nowait`,
    );
    assert.ok(position > previous, `${relation} ${mode}`);
    previous = position;
  }
  assert.equal((helper.match(/lock table [^;]+ nowait/gi) ?? []).length, 13);
});

test('participant authorization follows table prelocks and precedes every row lock', () => {
  const lastTableLock = helper.toLowerCase().lastIndexOf('lock table ');
  const snapshot = helper.toLowerCase().indexOf('select series.* into v_series_snapshot');
  const authorization = helper.toLowerCase().indexOf(
    'if v_actor is null or v_actor not in',
  );
  const firstRowLock = helper.toLowerCase().indexOf('perform actor.id');
  assert.ok(lastTableLock < snapshot && snapshot < authorization && authorization < firstRowLock);
  assert.match(helper, /v_actor uuid := auth\.uid\(\)/i);
  assert.match(helper,
    /errcode = '42501', message = 'live_battle_series_not_participant'/i);
});

test('security identities, narrow retry capture and ACL remain unchanged', () => {
  assert.match(helper, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(leave, /security definer[\s\S]*set search_path = ''/i);
  assert.match(leave, /interval '750 milliseconds'/i);
  assert.match(leave, /v_max_attempts constant integer := 128/i);
  assert.equal((leave.match(/when lock_not_available/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /lock_timeout|statement_timeout/i);
  assert.match(migration,
    /revoke all on function private\.live_battle_series_try_lock_scope_strict\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration,
    /revoke all on function public\.leave_live_battle_series\(uuid\)[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('proof checks ROW SHARE, early authorization, real ACL and rolls back', () => {
  assert.match(proof, /live_battle_rule_sets in row share mode nowait/);
  assert.match(proof, /c3_c1_c1_c1_rule_set_lock_boundary_invalid/);
  assert.match(proof, /c3_c1_c1_c1_early_authorization_invalid/);
  assert.match(proof, /pg_catalog\.has_function_privilege/g);
  assert.match(proof, /pg_catalog\.aclexplode/);
  assert.match(proof, /rollback;\s*$/i);
});

test('harness uses minimum incompatible blockers for every lock frontier', () => {
  assert.match(harness, /\['ACCESS SHARE', 'ACCESS EXCLUSIVE'\]/);
  assert.match(harness, /\['ROW SHARE', 'EXCLUSIVE'\]/);
  assert.match(harness, /\['ROW EXCLUSIVE', 'SHARE'\]/);
  assert.match(harness, /lock table \$\{relation\} in \$\{blockerMode\} mode/);
  assert.match(harness, /\['public\.live_battle_rule_sets', 'ROW SHARE'\]/);
  assert.match(harness, /relation, requestedMode, blockerMode/);
  assert.match(harness, /partialLocksReleased: true/);
  assert.match(harness, /reason\.code, '55P03'/);
  assert.match(harness, /reason\.message, 'live_battle_series_leave_busy'/);
  assert.match(harness, /async function runLegacyRuleSetGapProbe/);
  assert.match(harness, /lock\.mode='RowShareLock' and not lock\.granted/);
  assert.match(harness, /observedAtMs > 750 && observedAtMs < 1_500/);
});

test('non-participant is rejected before a blocked host Battle row', () => {
  assert.match(harness, /async function runEarlyNonParticipantRejection/);
  assert.match(harness,
    /select id from public\.live_battles where id=\$1 for update/);
  assert.match(harness, /claim\(first, value\.sender\)/);
  assert.match(harness, /reason\.code, '42501'/);
  assert.match(harness,
    /reason\.message, 'live_battle_series_not_participant'/);
  assert.match(harness, /elapsedMs < 500/);
  assert.match(harness, /assert\.deepEqual\(await stateSnapshot\(value\), before\)/);
  assert.match(harness, /legitimateRetryStatus/);
});

test('protected migrations and manifests remain byte-logically canonical', () => {
  const expected = {
    f5a: '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45',
    c3: '64b94397de5a7f31449f6a025eb458a41b35f0e936b23eeb79ae379e0b7751bd',
    c3c1: '1da58dbf6ab85c5953c227d6cc2b2904bc4346a58ff5ca58054b010000bb5237',
    c3c1c1: 'dc1e075772ae152cd27cba7707efa263fe7ab3510e32a1bed2aa95278fae96f9',
    package: '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0',
    lock: '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4',
  };
  for (const [name, text] of Object.entries(protectedFiles)) {
    assert.equal(sha256Lf(text), expected[name], name);
  }
});

test('correction remains outside product, Realtime and financial authority', () => {
  assert.doesNotMatch(migration,
    /agora|media relay|marketplace|creator recovery|edge function|gift_catalog|atomic_ledger_transfer|financial_transactions|ledger_entries/i);
  assert.doesNotMatch(migration, /alter publication|\brealtime\.|supabase\/functions/i);
});
