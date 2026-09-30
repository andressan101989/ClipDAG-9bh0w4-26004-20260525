import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L1_CANARY_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L1_CANARY_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L1_CANARY_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  tester: '41000000-0000-4000-8000-000000000001',
  other: '41000000-0000-4000-8000-000000000002',
  creator: '41000000-0000-4000-8000-000000000003',
  video1: '42000000-0000-4000-8000-000000000001',
  video2: '42000000-0000-4000-8000-000000000002',
  video3: '42000000-0000-4000-8000-000000000003',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, { allowFailure = false, authenticator = false } = {}) {
  const args = ['exec', '-i'];
  if (authenticator) args.push('-e', 'PGPASSWORD=postgres');
  args.push(
    container,
    'psql',
    ...(authenticator ? ['-h', '127.0.0.1', '-p', '5432'] : []),
    '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', authenticator ? 'authenticator' : owner,
    '-d', db,
    '-At',
  );
  return docker(args, { input: sql, allowFailure });
}

function actorSql(role, actor, sql) {
  return `begin;set local role ${role};` +
    `select set_config('request.jwt.claim.role','${role}',true);` +
    `select set_config('request.jwt.claim.sub','${actor ?? ''}',true);` +
    `${sql};commit;`;
}

function actorCall(db, role, actor, sql, options = {}) {
  return psql(db, actorSql(role, actor, sql), { ...options, authenticator: true });
}

function rows(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function lastLine(result) {
  return rows(result).at(-1) ?? '';
}

function createDatabase() {
  const db = `algo6_canary_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  psql(db, migration('_algo6_l1_f0_signal_eligibility_foundation.sql'));
  psql(db, migration('_algo6_l1_behavioral_ranking.sql'));
  psql(db, migration('_algo6_l1_controlled_canary.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 1,
  asOf = null,
  score = null,
  createdAt = null,
  id = null,
  policy = null,
  projection = "id||chr(30)||cursor_score||chr(30)||feed_as_of||chr(30)||policy_version||chr(30)||cursor_created_at||chr(30)||ranking_mode",
} = {}) {
  const value = item => item == null ? 'null' : `'${item}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${value(asOf)},${score == null ? 'null' : score},` +
    `${value(createdAt)},${value(id)},${value(policy)})`;
}

function cursorFrom(row) {
  const [id, score, asOf, policy, createdAt] = row.split('\x1e');
  return { id, score, asOf, policy, createdAt };
}

function rankedFields(row) {
  const [id, score, asOf, policy, createdAt, mode] = row.split('\x1e');
  return { id, score, asOf, policy, createdAt, mode };
}

function requestCanary(db, userId) {
  return lastLine(actorCall(db, 'authenticated', userId,
    "select status||'|'||request_id||'|'||requested_at from public.request_my_algo_l1_canary_v1()"));
}

function manageCanary(db, action, requestId = null, ttl = null, options = {}) {
  const request = requestId == null ? 'null' : `'${requestId}'`;
  return actorCall(db, 'service_role', null,
    `select status||'|'||coalesce(request_id::text,'null')||'|'||generation ` +
    `from public.manage_algo_l1_canary_v1('${action}',${request},${ttl ?? 'null'})`, options);
}

function seed(db) {
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18)
    on conflict(singleton) do nothing;

    insert into auth.users(id) values
      ('${ids.tester}'),('${ids.other}'),('${ids.creator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.tester}','canary_tester',false),
      ('${ids.other}','canary_other',false),
      ('${ids.creator}','canary_creator',false);
    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.video1}','${ids.creator}','https://example.test/1.mp4','one',clock_timestamp()-interval '1 minute'),
      ('${ids.video2}','${ids.creator}','https://example.test/2.mp4','two',clock_timestamp()-interval '2 minutes'),
      ('${ids.video3}','${ids.creator}','https://example.test/3.mp4','three',clock_timestamp()-interval '3 minutes');
  `);
}

test('directed L1 canary enrollment, isolation, expiry, cursor safety and ACLs', { skip: !enabled, timeout: 180000 }, () => {
  const db = createDatabase();
  const testerSession = '43000000-0000-4000-8000-000000000001';
  const otherSession = '43000000-0000-4000-8000-000000000002';
  const anonSession = '43000000-0000-4000-8000-000000000003';
  try {
    seed(db);

    assert.equal(lastLine(psql(db, `
      select policy_version||'|'||production_rollout_bps||'|'||canary_enabled||'|'||
        coalesce(canary_user_id::text,'null')||'|'||coalesce(canary_request_id::text,'null')||'|'||canary_generation
      from private.algo_l1_policy
    `)), 'nelyon-algo-l1-v1|0|false|null|null|0');

    assert.equal(lastLine(psql(db, `
      select
        has_function_privilege('authenticated','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('anon','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('service_role','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('authenticated','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('anon','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')
    `)), 'true|false|true|false|false');
    assert.notEqual(actorCall(db, 'anon', null,
      'select * from public.request_my_algo_l1_canary_v1()', { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      "select * from public.manage_algo_l1_canary_v1('disarm',null,null)", { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'anon', null,
      "select * from public.manage_algo_l1_canary_v1('disarm',null,null)", { allowFailure: true }).status, 0);

    assert.notEqual(psql(db, 'update private.algo_l1_policy set freshness_weight=29',
      { allowFailure: true }).status, 0, 'weight change without version bump must be denied');
    psql(db, 'update private.algo_l1_policy set canary_generation=1');
    psql(db, 'update private.algo_l1_policy set canary_generation=0');
    assert.equal(lastLine(psql(db, 'select policy_version from private.algo_l1_policy')),
      'nelyon-algo-l1-v1');

    const preArmTester = cursorFrom(lastLine(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession))));
    const preArmOther = cursorFrom(lastLine(actorCall(db, 'authenticated', ids.other,
      rankedSql(otherSession))));
    assert.equal(preArmTester.policy, 'nelyon-algo-l1-v1');
    assert.equal(preArmOther.policy, 'nelyon-algo-l1-v1');

    const firstPending = requestCanary(db, ids.tester);
    const [, firstRequest] = firstPending.split('|');
    assert.match(firstPending, /^pending\|[0-9a-f-]{36}\|/i);
    assert.equal(requestCanary(db, ids.tester).split('|')[1], firstRequest,
      'same user retry must return the existing pending request');
    assert.notEqual(actorCall(db, 'authenticated', ids.other,
      'select * from public.request_my_algo_l1_canary_v1()', { allowFailure: true }).status, 0,
    'another user cannot replace a fresh pending request');
    assert.equal(lastLine(psql(db,
      'select canary_enabled::text from private.algo_l1_policy')), 'false');

    psql(db, "update private.algo_l1_policy set canary_requested_at=clock_timestamp()-interval '31 minutes'");
    assert.notEqual(manageCanary(db, 'arm', firstRequest, 30, { allowFailure: true }).status, 0,
      'expired request must not arm');
    const renewed = requestCanary(db, ids.tester);
    const [, requestId] = renewed.split('|');
    assert.notEqual(requestId, firstRequest, 'expired request must be replaced explicitly');

    assert.notEqual(manageCanary(db, 'arm', randomUUID(), 30, { allowFailure: true }).status, 0);
    assert.notEqual(manageCanary(db, 'arm', requestId, 4, { allowFailure: true }).status, 0);
    assert.notEqual(manageCanary(db, 'arm', requestId, 61, { allowFailure: true }).status, 0);
    psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l1-rollout-test',production_rollout_bps=1");
    assert.notEqual(manageCanary(db, 'arm', requestId, 30, { allowFailure: true }).status, 0,
      'directed canary must fail closed while general rollout is nonzero');
    psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l1-v1',production_rollout_bps=0");

    assert.match(lastLine(manageCanary(db, 'arm', requestId, 30)), /^active\|[0-9a-f-]{36}\|1$/i);
    assert.notEqual(manageCanary(db, 'arm', requestId, 30, { allowFailure: true }).status, 0,
      'an active canary cannot be replaced');
    assert.equal(lastLine(psql(db,
      "select policy_version||'|'||production_rollout_bps||'|'||canary_enabled from private.algo_l1_policy")),
    'nelyon-algo-l1-v1|0|true');

    const testerFirst = lastLine(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession)));
    const otherFirst = lastLine(actorCall(db, 'authenticated', ids.other,
      rankedSql(otherSession)));
    const anonFirst = lastLine(actorCall(db, 'anon', null, rankedSql(anonSession)));
    assert.equal(rankedFields(testerFirst).policy, 'nelyon-algo-l1-v1|canary:1:active');
    assert.equal(rankedFields(testerFirst).mode, 'behavioral_l1');
    assert.equal(rankedFields(otherFirst).policy, 'nelyon-algo-l1-v1');
    assert.equal(rankedFields(otherFirst).mode, 'chronological');
    assert.equal(rankedFields(anonFirst).policy, 'nelyon-algo-l1-v1');
    assert.equal(rankedFields(anonFirst).mode, 'chronological');

    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession, preArmTester), { allowFailure: true }).status, 0,
    'pre-arm tester cursor must not cross into the canary generation');
    assert.equal(actorCall(db, 'authenticated', ids.other,
      rankedSql(otherSession, preArmOther), { allowFailure: true }).status, 0,
    'normal user cursor must remain valid when another user is armed');

    const activeCursor = cursorFrom(testerFirst);
    assert.notEqual(manageCanary(db, 'disarm', null, null, { allowFailure: true }).status, 0,
      'DISARM must require the active request ID');
    assert.notEqual(manageCanary(db, 'disarm', randomUUID(), null, { allowFailure: true }).status, 0,
      'a stale service operation cannot disarm a newer canary');
    assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|2$/i);
    assert.notEqual(manageCanary(db, 'disarm', requestId, null, { allowFailure: true }).status, 0,
      'repeated DISARM must be rejected');
    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession, activeCursor), { allowFailure: true }).status, 0,
    'active canary cursor must fail after disarm');
    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession, preArmTester), { allowFailure: true }).status, 0,
    'pre-arm tester cursor must remain invalid after disarm');
    const postDisarm = rankedFields(lastLine(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession))));
    assert.equal(postDisarm.policy, 'nelyon-algo-l1-v1|canary:2:inactive');
    assert.equal(postDisarm.mode, 'chronological');

    const expiryPending = requestCanary(db, ids.tester);
    const expiryRequest = expiryPending.split('|')[1];
    assert.match(lastLine(manageCanary(db, 'arm', expiryRequest, 5)), /\|3$/);
    const expiryCursor = cursorFrom(lastLine(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession))));
    psql(db, `update private.algo_l1_policy set
      canary_requested_at=clock_timestamp()-interval '20 minutes',
      canary_armed_at=clock_timestamp()-interval '10 minutes',
      canary_expires_at=clock_timestamp()-interval '1 minute'`);
    const expiredFirst = rankedFields(lastLine(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession))));
    assert.equal(expiredFirst.policy, 'nelyon-algo-l1-v1|canary:3:inactive');
    assert.equal(expiredFirst.mode, 'chronological',
      'expired canary must fall back without operator action');
    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession, expiryCursor), { allowFailure: true }).status, 0,
    'expired canary cursor must not continue');
    assert.notEqual(actorCall(db, 'authenticated', ids.tester,
      rankedSql(testerSession, preArmTester), { allowFailure: true }).status, 0,
    'pre-arm tester cursor must remain invalid after expiry');
    assert.match(lastLine(manageCanary(db, 'disarm', expiryRequest)), /\|4$/);

    assert.equal(lastLine(actorCall(db, 'service_role', null,
      "select bool_and(value::text='0') from jsonb_each(public.reconcile_algo_l1_v1())")), 't');
  } finally {
    dropDatabase(db);
  }
});
