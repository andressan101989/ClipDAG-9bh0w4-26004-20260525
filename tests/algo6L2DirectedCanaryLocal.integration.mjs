import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L2_CANARY_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L2_CANARY_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L2_CANARY_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  tester: '61000000-0000-4000-8000-000000000001',
  other: '61000000-0000-4000-8000-000000000002',
  positiveCreator: '61000000-0000-4000-8000-000000000003',
  negativeCreator: '61000000-0000-4000-8000-000000000004',
  positiveVideo: '62000000-0000-4000-8000-000000000001',
  negativeVideo1: '62000000-0000-4000-8000-000000000002',
  negativeVideo2: '62000000-0000-4000-8000-000000000003',
  selfVideo: '62000000-0000-4000-8000-000000000004',
  historicalRequest: '63000000-0000-4000-8000-000000000001',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, { allowFailure = false, authenticator = false } = {}) {
  const args = ['exec', '-i'];
  if (authenticator) args.push('-e', 'PGPASSWORD=postgres');
  args.push(
    container, 'psql', ...(authenticator ? ['-h', '127.0.0.1', '-p', '5432'] : []),
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', authenticator ? 'authenticator' : owner,
    '-d', db, '-At',
  );
  return docker(args, { input: sql, allowFailure });
}

function actorCall(db, role, actor, sql, options = {}) {
  return psql(db,
    `begin;set local role ${role};` +
    `set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${actor ?? ''}';` +
    `${sql};commit;`,
    { ...options, authenticator: true },
  );
}

function rows(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function lastLine(result) {
  return rows(result).at(-1) ?? '';
}

function approximately(actual, expected, epsilon = 0.00001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} must be approximately ${expected}`);
}

function createDatabase({ applyDirectedCanary = true } = {}) {
  const db = `algo6_l2_canary_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  psql(db, migration('_algo6_l1_f0_signal_eligibility_foundation.sql'));
  psql(db, migration('_algo6_l1_behavioral_ranking.sql'));
  psql(db, migration('_algo6_l1_controlled_canary.sql'));
  psql(db, migration('_algo6_l2_creator_affinity.sql'));
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values
      ('${ids.tester}'),('${ids.other}'),('${ids.positiveCreator}'),('${ids.negativeCreator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.tester}','l2_canary_tester',false),
      ('${ids.other}','l2_canary_other',false),
      ('${ids.positiveCreator}','l2_positive',false),
      ('${ids.negativeCreator}','l2_negative',false);
    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.positiveVideo}','${ids.positiveCreator}','https://example.test/positive.mp4','positive',clock_timestamp()-interval '1 minute'),
      ('${ids.negativeVideo1}','${ids.negativeCreator}','https://example.test/negative-1.mp4','negative 1',clock_timestamp()-interval '2 minutes'),
      ('${ids.negativeVideo2}','${ids.negativeCreator}','https://example.test/negative-2.mp4','negative 2',clock_timestamp()-interval '3 minutes'),
      ('${ids.selfVideo}','${ids.tester}','https://example.test/self.mp4','self',clock_timestamp()-interval '4 minutes');
    update private.algo_l1_policy set
      canary_enabled=false,
      canary_user_id='${ids.tester}',
      canary_request_id='${ids.historicalRequest}',
      canary_requested_at=clock_timestamp()-interval '2 hours',
      canary_armed_at=clock_timestamp()-interval '90 minutes',
      canary_expires_at=clock_timestamp()-interval '60 minutes',
      canary_generation=2;
  `);
  if (applyDirectedCanary) {
    psql(db, migration('_algo6_l2_directed_canary.sql'));
  }
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 1, asOf = null, score = null, createdAt = null, id = null, policy = null,
  projection = "id||chr(30)||cursor_score||chr(30)||feed_as_of||chr(30)||policy_version||chr(30)||cursor_created_at||chr(30)||ranking_mode||chr(30)||rank_score",
} = {}) {
  const value = item => item == null ? 'null' : `'${item}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${value(asOf)},${score == null ? 'null' : score},` +
    `${value(createdAt)},${value(id)},${value(policy)})`;
}

function fields(row) {
  const [id, score, asOf, policy, createdAt, mode, rankScore] = row.split('\x1e');
  return { id, score, asOf, policy, createdAt, mode, rankScore: Number(rankScore) };
}

function continuationSql(sessionId, cursor, limit = 10) {
  return rankedSql(sessionId, {
    limit, asOf: cursor.asOf, score: cursor.score, createdAt: cursor.createdAt,
    id: cursor.id, policy: cursor.policy,
  });
}

function requestCanary(db, userId) {
  return lastLine(actorCall(db, 'authenticated', userId,
    "select status||'|'||request_id||'|'||requested_at from public.request_my_algo_l1_canary_v1()"));
}

function manageCanary(db, action, requestId, ttl = null, options = {}) {
  return actorCall(db, 'service_role', null,
    `select status||'|'||request_id||'|'||generation from public.manage_algo_l1_canary_v1(` +
    `'${action}','${requestId}',${ttl ?? 'null'})`, options);
}

function assertReconciled(db) {
  const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
  assert.deepEqual(Object.entries(reconciliation).filter(([, value]) => value !== 0), []);
}

test('dormant migration preserves normal authenticated and anonymous cursors',
  { skip: !enabled, timeout: 180000 }, () => {
    const db = createDatabase({ applyDirectedCanary: false });
    const otherSession = '60000000-0000-4000-8000-000000000001';
    const anonSession = '60000000-0000-4000-8000-000000000002';
    try {
      const otherBefore = fields(lastLine(actorCall(db, 'authenticated', ids.other,
        rankedSql(otherSession))));
      const anonBefore = fields(lastLine(actorCall(db, 'anon', null,
        rankedSql(anonSession))));

      psql(db, migration('_algo6_l2_directed_canary.sql'));

      assert.equal(actorCall(db, 'authenticated', ids.other,
        continuationSql(otherSession, otherBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'anon', null,
        continuationSql(anonSession, anonBefore), { allowFailure: true }).status, 0);
      assert.equal(lastLine(psql(db, `select
        policy_version||'|'||l2_affinity_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation
        from private.algo_l1_policy`)),
      'nelyon-algo-l1-v1|false|0|false|l1|2');
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });

test('migration is dormant, preserves history, resets fresh enrollment to l1 and keeps browser ACLs closed',
  { skip: !enabled, timeout: 180000 }, () => {
    const db = createDatabase();
    try {
      assert.equal(lastLine(psql(db, `select
        policy_version||'|'||l2_affinity_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation||'|'||canary_request_id
        from private.algo_l1_policy`)),
      `nelyon-algo-l1-v1|false|0|false|l1|2|${ids.historicalRequest}`);

      assert.notEqual(psql(db,
        'update private.algo_l1_policy set l2_affinity_like_weight=2.5',
        { allowFailure: true }).status, 0,
      'L2 algorithm configuration must still require a policy-version bump');
      psql(db, "update private.algo_l1_policy set canary_target_layer='l2'");
      assert.equal(lastLine(psql(db, 'select policy_version from private.algo_l1_policy')),
        'nelyon-algo-l1-v1', 'operational target changes do not bump algorithm policy');

      const pending = requestCanary(db, ids.tester);
      assert.match(pending, /^pending\|[0-9a-f-]{36}\|/i);
      assert.notEqual(pending.split('|')[1], ids.historicalRequest);
      assert.equal(lastLine(psql(db, `select
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation||'|'||
        coalesce(canary_armed_at::text,'null')||'|'||coalesce(canary_expires_at::text,'null')
        from private.algo_l1_policy`)), 'false|l1|2|null|null');

      assert.notEqual(actorCall(db, 'anon', null,
        'select * from public.request_my_algo_l1_canary_v1()', { allowFailure: true }).status, 0);
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        "select * from public.manage_algo_l1_canary_v1('arm_l2',null,30)",
        { allowFailure: true }).status, 0);
      assert.equal(lastLine(psql(db, `select
        has_function_privilege('authenticated','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('anon','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('service_role','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('authenticated','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')
      `)), 'true|false|true|false');
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });

test('existing arm remains behavioral_l1 and invalidates only tester cursors',
  { skip: !enabled, timeout: 180000 }, () => {
    const db = createDatabase();
    const testerSession = '64000000-0000-4000-8000-000000000001';
    const otherSession = '64000000-0000-4000-8000-000000000002';
    const anonSession = '64000000-0000-4000-8000-000000000003';
    try {
      const pending = requestCanary(db, ids.tester);
      const requestId = pending.split('|')[1];
      const testerBefore = fields(lastLine(actorCall(db, 'authenticated', ids.tester, rankedSql(testerSession))));
      const otherBefore = fields(lastLine(actorCall(db, 'authenticated', ids.other, rankedSql(otherSession))));
      const anonBefore = fields(lastLine(actorCall(db, 'anon', null, rankedSql(anonSession))));

      assert.match(lastLine(manageCanary(db, 'arm', requestId, 30)), /^active\|[0-9a-f-]{36}\|3$/i);
      assert.equal(lastLine(psql(db,
        "select canary_target_layer||'|'||l2_affinity_enabled||'|'||production_rollout_bps from private.algo_l1_policy")),
      'l1|false|0');
      assert.equal(fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession)))).mode, 'behavioral_l1');
      assert.equal(fields(lastLine(actorCall(db, 'authenticated', ids.other,
        rankedSql(otherSession)))).mode, 'chronological');
      assert.equal(fields(lastLine(actorCall(db, 'anon', null,
        rankedSql(anonSession)))).mode, 'chronological');

      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, testerBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'authenticated', ids.other,
        continuationSql(otherSession, otherBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'anon', null,
        continuationSql(anonSession, anonBefore), { allowFailure: true }).status, 0);

      const activeCursor = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|4$/i);
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, activeCursor), { allowFailure: true }).status, 0);
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });

test('arm_l2 isolates exact L2 scoring, cursor generations and automatic expiry while global L2 stays false',
  { skip: !enabled, timeout: 240000 }, () => {
    const db = createDatabase();
    const testerSession = '65000000-0000-4000-8000-000000000001';
    const otherSession = '65000000-0000-4000-8000-000000000002';
    const anonSession = '65000000-0000-4000-8000-000000000003';
    try {
      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l2-directed-test-v1',
        freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
        completion_weight=0,rewatch_weight=0,exploration_weight=0,
        short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
        same_session_penalty=0,creator_page_cap=50;`);
      const signalTime = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      psql(db, `
        insert into public.likes(video_id,user_id,created_at)
          values('${ids.positiveVideo}','${ids.tester}','${signalTime}');
        insert into public.comments(video_id,user_id,text,created_at)
          values('${ids.positiveVideo}','${ids.tester}','positive','${signalTime}');
        insert into public.video_saves(video_id,user_id,created_at)
          values('${ids.positiveVideo}','${ids.tester}','${signalTime}');
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        ) values
          ('${ids.positiveVideo}','${ids.tester}',gen_random_uuid(),gen_random_uuid(),20000,10000,2,true,1,'ended','${signalTime}'),
          ('${ids.negativeVideo1}','${ids.tester}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'swipe','${signalTime}'),
          ('${ids.negativeVideo2}','${ids.tester}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'background','${signalTime}'),
          ('${ids.selfVideo}','${ids.tester}',gen_random_uuid(),gen_random_uuid(),20000,10000,2,true,1,'ended','${signalTime}');
      `);

      const pending = requestCanary(db, ids.tester);
      const requestId = pending.split('|')[1];
      const testerBefore = fields(lastLine(actorCall(db, 'authenticated', ids.tester, rankedSql(testerSession))));
      const otherBefore = fields(lastLine(actorCall(db, 'authenticated', ids.other, rankedSql(otherSession))));
      const anonBefore = fields(lastLine(actorCall(db, 'anon', null, rankedSql(anonSession))));

      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l2-directed-test-deny',l2_affinity_enabled=true");
      assert.notEqual(manageCanary(db, 'arm_l2', requestId, 30, { allowFailure: true }).status, 0,
        'directed L2 must fail closed while global L2 is enabled');
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l2-directed-test-v1',l2_affinity_enabled=false");

      assert.match(lastLine(manageCanary(db, 'arm_l2', requestId, 30)), /^active\|[0-9a-f-]{36}\|3$/i);
      assert.equal(lastLine(psql(db, `select
        policy_version||'|'||l2_affinity_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation
        from private.algo_l1_policy`)),
      'nelyon-algo-l2-directed-test-v1|false|0|true|l2|3');
      assertReconciled(db);

      const testerRows = rows(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession, { limit: 20 })));
      const testerScores = new Map(testerRows.map(row => {
        const value = fields(row);
        return [value.id, value];
      }));
      assert.ok([...testerScores.values()].every(value => value.mode === 'behavioral_l2'));
      assert.match([...testerScores.values()][0].policy, /\|canary:3:l2:active$/);
      assert.equal(testerScores.get(ids.positiveVideo).rankScore, 8);
      approximately(testerScores.get(ids.negativeVideo1).rankScore, -3);
      approximately(testerScores.get(ids.negativeVideo2).rankScore, -3);
      assert.equal(testerScores.get(ids.selfVideo).rankScore, 0);
      assert.equal(fields(lastLine(actorCall(db, 'authenticated', ids.other,
        rankedSql(otherSession)))).mode, 'chronological');
      assert.equal(fields(lastLine(actorCall(db, 'anon', null,
        rankedSql(anonSession)))).mode, 'chronological');

      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, testerBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'authenticated', ids.other,
        continuationSql(otherSession, otherBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'anon', null,
        continuationSql(anonSession, anonBefore), { allowFailure: true }).status, 0);

      const activeCursor = fields(testerRows[0]);
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|4$/i);
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, activeCursor), { allowFailure: true }).status, 0);

      const renewed = requestCanary(db, ids.tester);
      const renewedRequest = renewed.split('|')[1];
      assert.equal(lastLine(psql(db, 'select canary_target_layer from private.algo_l1_policy')), 'l1');
      assert.match(lastLine(manageCanary(db, 'arm_l2', renewedRequest, 5)), /^active\|[0-9a-f-]{36}\|5$/i);
      const expiringCursor = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      psql(db, `update private.algo_l1_policy set
        canary_armed_at=clock_timestamp()-interval '6 minutes',
        canary_expires_at=clock_timestamp()-interval '1 minute'`);
      assert.equal(fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession)))).mode, 'chronological');
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, expiringCursor), { allowFailure: true }).status, 0);
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });
