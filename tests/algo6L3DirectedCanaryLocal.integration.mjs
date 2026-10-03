import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L3_CANARY_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L3_CANARY_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L3_CANARY_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  tester: '71000000-0000-4000-8000-000000000001',
  other: '71000000-0000-4000-8000-000000000002',
  creator: '71000000-0000-4000-8000-000000000003',
  video: '72000000-0000-4000-8000-000000000001',
  historicalRequest: '73000000-0000-4000-8000-000000000001',
  nonexistentUser: '71000000-0000-4000-8000-000000000099',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', input, maxBuffer: 128 * 1024 * 1024,
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

function createDatabase({ applyF2 = true } = {}) {
  const db = `algo6_l3_canary_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values
      ('${ids.tester}'),('${ids.other}'),('${ids.creator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.tester}','l3_canary_tester',false),
      ('${ids.other}','l3_canary_other',false),
      ('${ids.creator}','l3_canary_creator',false);
    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.video}','${ids.creator}','https://example.test/l3-canary.mp4','l3 canary',clock_timestamp()-interval '2 minutes');
    update private.algo_l1_policy set
      canary_enabled=false,
      canary_user_id='${ids.tester}',
      canary_request_id='${ids.historicalRequest}',
      canary_requested_at=clock_timestamp()-interval '2 hours',
      canary_armed_at=clock_timestamp()-interval '90 minutes',
      canary_expires_at=clock_timestamp()-interval '60 minutes',
      canary_generation=2;
  `);
  psql(db, migration('_algo6_l2_directed_canary.sql'));
  psql(db, migration('_algo6_l3_quality_retention_antispam.sql'));
  psql(db, `update private.algo_l1_policy set
    canary_enabled=false,
    canary_target_layer='l2',
    canary_generation=8,
    production_rollout_bps=0,
    l2_affinity_enabled=false,
    l3_quality_enabled=false`);
  if (applyF2) psql(db, migration('_algo6_l3_directed_canary.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 20, asOf = null, score = null, createdAt = null, id = null, policy = null,
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

function continuationSql(sessionId, cursor, limit = 20) {
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

test('F2 migration is dormant, widens only the target and preserves enrollment plus ACL contracts',
  { skip: !enabled, timeout: 180000 }, () => {
    const db = createDatabase({ applyF2: false });
    const testerSession = '74000000-0000-4000-8000-000000000011';
    const otherSession = '74000000-0000-4000-8000-000000000012';
    const anonSession = '74000000-0000-4000-8000-000000000013';
    try {
      const before = lastLine(psql(db, `select
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation||'|'||canary_request_id
        from private.algo_l1_policy`));
      const testerBefore = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      const otherBefore = fields(lastLine(actorCall(db, 'authenticated', ids.other,
        rankedSql(otherSession))));
      const anonBefore = fields(lastLine(actorCall(db, 'anon', null,
        rankedSql(anonSession))));
      psql(db, migration('_algo6_l3_directed_canary.sql'));
      assert.equal(lastLine(psql(db, `select
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation||'|'||canary_request_id
        from private.algo_l1_policy`)), before);
      assert.equal(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, testerBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'authenticated', ids.other,
        continuationSql(otherSession, otherBefore), { allowFailure: true }).status, 0);
      assert.equal(actorCall(db, 'anon', null,
        continuationSql(anonSession, anonBefore), { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set canary_target_layer='l1'");
      psql(db, "update private.algo_l1_policy set canary_target_layer='l2'");
      psql(db, "update private.algo_l1_policy set canary_target_layer='l3'");
      assert.notEqual(psql(db,
        "update private.algo_l1_policy set canary_target_layer='l4'",
        { allowFailure: true }).status, 0);

      const pending = requestCanary(db, ids.tester);
      assert.match(pending, /^pending\|[0-9a-f-]{36}\|/i);
      assert.equal(lastLine(psql(db, `select
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation||'|'||
        coalesce(canary_armed_at::text,'null')||'|'||coalesce(canary_expires_at::text,'null')
        from private.algo_l1_policy`)), 'false|l1|8|null|null');
      assert.equal(lastLine(psql(db, `select
        count(*) filter(where proname='request_my_algo_l1_canary_v1')||'|'||
        count(*) filter(where proname like '%algo_l3%canary%')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private')`)), '1|0');

      assert.equal(lastLine(psql(db, `select
        has_function_privilege('service_role','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('authenticated','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('anon','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('public','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute')||'|'||
        has_function_privilege('authenticated','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('service_role','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('anon','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('public','public.request_my_algo_l1_canary_v1()','execute')||'|'||
        has_function_privilege('anon','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute')||'|'||
        has_function_privilege('authenticated','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute')||'|'||
        has_function_privilege('service_role','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute')||'|'||
        has_function_privilege('public','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute')||'|'||
        has_function_privilege('service_role','public.reconcile_algo_l1_v1()','execute')||'|'||
        has_function_privilege('authenticated','public.reconcile_algo_l1_v1()','execute')||'|'||
        has_function_privilege('anon','public.reconcile_algo_l1_v1()','execute')||'|'||
        has_function_privilege('public','public.reconcile_algo_l1_v1()','execute')
      `)), 'true|false|false|false|true|false|false|false|true|true|false|false|true|false|false|false');
      assert.equal(lastLine(psql(db, `select count(*) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname in (
            'manage_algo_l1_canary_v1','request_my_algo_l1_canary_v1',
            'get_ranked_feed_l1_v1','reconcile_algo_l1_v1'
          )
          and p.prosecdef
          and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]`)), '4');
      assert.equal(lastLine(psql(db, `select
        has_table_privilege('anon','private.algo_l1_policy','select,insert,update,delete')||'|'||
        has_table_privilege('authenticated','private.algo_l1_policy','select,insert,update,delete')`)),
      'false|false');
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });

test('arm_l3 fails closed, isolates L1 plus L3 delivery, invalidates cursors and expires safely',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    const testerSession = '74000000-0000-4000-8000-000000000001';
    const otherSession = '74000000-0000-4000-8000-000000000002';
    const anonSession = '74000000-0000-4000-8000-000000000003';
    try {
      const signalTime = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      psql(db, `
        update private.algo_l1_policy set
          policy_version='nelyon-algo-l3-directed-test-v1',
          freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
          completion_weight=0,rewatch_weight=0,exploration_weight=0,
          short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
          same_session_penalty=0,creator_page_cap=50;
        insert into auth.users(id)
          select md5('l3-canary-audience-'||i)::uuid from generate_series(1,20) i;
        insert into public.user_profiles(id,username,is_private)
          select md5('l3-canary-audience-'||i)::uuid,'l3_canary_audience_'||i,false
          from generate_series(1,20) i;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        ) select '${ids.video}',md5('l3-canary-audience-'||i)::uuid,
          md5('l3-canary-event-'||i)::uuid,md5('l3-canary-session-'||i)::uuid,
          100000,100000,1,true,0,'ended','${signalTime}'
          from generate_series(1,20) i;
        insert into public.video_saves(video_id,user_id,created_at)
          values('${ids.video}','${ids.tester}','${signalTime}');
      `);

      const pending = requestCanary(db, ids.tester);
      const requestId = pending.split('|')[1];

      assert.notEqual(manageCanary(db, 'arm_l3', randomUUID(), 30, { allowFailure: true }).status, 0);
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 4, { allowFailure: true }).status, 0);
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 61, { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-disabled',enabled=false");
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-enabled',enabled=true");
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-rollout-on',production_rollout_bps=1");
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-rollout-off',production_rollout_bps=0");
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-l3-on',l3_quality_enabled=true");
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-l2-on',l3_quality_enabled=false,l2_affinity_enabled=true");
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, "update private.algo_l1_policy set policy_version='nelyon-algo-l3-directed-test-v2',l2_affinity_enabled=false");
      psql(db, "update private.algo_l1_policy set canary_requested_at=clock_timestamp()-interval '31 minutes'");
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, `update private.algo_l1_policy set canary_requested_at=clock_timestamp(),canary_user_id='${ids.nonexistentUser}'`);
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      psql(db, `update private.algo_l1_policy set canary_user_id='${ids.tester}'`);

      const testerBefore = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      const otherBefore = fields(lastLine(actorCall(db, 'authenticated', ids.other,
        rankedSql(otherSession))));
      const anonBefore = fields(lastLine(actorCall(db, 'anon', null,
        rankedSql(anonSession))));

      assert.match(lastLine(manageCanary(db, 'arm_l3', requestId, 30)), /^active\|[0-9a-f-]{36}\|9$/i);
      assert.notEqual(manageCanary(db, 'arm_l3', requestId, 30, { allowFailure: true }).status, 0);
      assert.equal(lastLine(psql(db, `select
        l2_affinity_enabled||'|'||l3_quality_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_target_layer||'|'||canary_generation
        from private.algo_l1_policy`)), 'false|false|0|true|l3|9');
      assert.equal(lastLine(psql(db, `select extract(epoch from canary_expires_at-canary_armed_at)::integer
        from private.algo_l1_policy`)), '1800');
      assertReconciled(db);

      const tester = rows(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))).map(fields).find(row => row.id === ids.video);
      assert.ok(tester, 'directed L3 fixture video must be present in the candidate page');
      assert.equal(tester.mode, 'behavioral_l3');
      assert.match(tester.policy, /\|canary:9:l3:active$/);
      assert.equal(tester.rankScore, 15,
        'directed L3 includes +15 quality but excludes the tester save worth +4 in L2');
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

      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|10$/i);
      assert.equal(lastLine(psql(db,
        "select canary_enabled||'|'||canary_target_layer||'|'||canary_generation from private.algo_l1_policy")),
      'false|l3|10');
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, tester), { allowFailure: true }).status, 0);
      const inactive = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      assert.equal(inactive.mode, 'chronological');
      assert.match(inactive.policy, /\|canary:10:l3:inactive$/);

      const renewed = requestCanary(db, ids.tester);
      const renewedRequest = renewed.split('|')[1];
      assert.equal(lastLine(psql(db,
        "select canary_target_layer||'|'||canary_generation from private.algo_l1_policy")), 'l1|10');
      assert.match(lastLine(manageCanary(db, 'arm_l3', renewedRequest, 5)), /^active\|[0-9a-f-]{36}\|11$/i);
      const expiring = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      psql(db, `update private.algo_l1_policy set
        canary_armed_at=clock_timestamp()-interval '6 minutes',
        canary_expires_at=clock_timestamp()-interval '1 minute'`);
      const expired = fields(lastLine(actorCall(db, 'authenticated', ids.tester,
        rankedSql(testerSession))));
      assert.equal(expired.mode, 'chronological');
      assert.match(expired.policy, /\|canary:11:l3:inactive$/);
      assert.notEqual(actorCall(db, 'authenticated', ids.tester,
        continuationSql(testerSession, expiring), { allowFailure: true }).status, 0);
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });

test('existing arm and arm_l2 remain backward compatible',
  { skip: !enabled, timeout: 240000 }, () => {
    const db = createDatabase();
    const session = '75000000-0000-4000-8000-000000000001';
    try {
      let pending = requestCanary(db, ids.tester);
      let requestId = pending.split('|')[1];
      assert.match(lastLine(manageCanary(db, 'arm', requestId, 30)), /^active\|[0-9a-f-]{36}\|9$/i);
      let row = fields(lastLine(actorCall(db, 'authenticated', ids.tester, rankedSql(session))));
      assert.equal(row.mode, 'behavioral_l1');
      assert.match(row.policy, /\|canary:9:active$/);
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|10$/i);

      pending = requestCanary(db, ids.tester);
      requestId = pending.split('|')[1];
      assert.match(lastLine(manageCanary(db, 'arm_l2', requestId, 30)), /^active\|[0-9a-f-]{36}\|11$/i);
      row = fields(lastLine(actorCall(db, 'authenticated', ids.tester, rankedSql(session))));
      assert.equal(row.mode, 'behavioral_l2');
      assert.match(row.policy, /\|canary:11:l2:active$/);
      assertReconciled(db);
    } finally {
      dropDatabase(db);
    }
  });
