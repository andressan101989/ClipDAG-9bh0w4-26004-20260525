import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L5_F4_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L5_F4_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L5_F4_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  tester: 'a1000000-0000-4000-8000-000000000001',
  other: 'a1000000-0000-4000-8000-000000000002',
  creator: 'a1000000-0000-4000-8000-000000000003',
  secondCreator: 'a1000000-0000-4000-8000-000000000004',
  nonexistentUser: 'a1000000-0000-4000-8000-000000000099',
  historicalRequest: 'a2000000-0000-4000-8000-000000000001',
  session: 'a3000000-0000-4000-8000-000000000001',
  otherSession: 'a3000000-0000-4000-8000-000000000002',
  anonSession: 'a3000000-0000-4000-8000-000000000003',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, { allowFailure = false, authenticator = false } = {}) {
  const args = ['exec', '-i'];
  if (authenticator) args.push('-e', 'PGPASSWORD=postgres');
  args.push(container, 'psql', ...(authenticator ? ['-h', '127.0.0.1', '-p', '5432'] : []),
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', authenticator ? 'authenticator' : owner,
    '-d', db, '-At');
  return docker(args, { input: sql, allowFailure });
}

function actorCall(db, role, actor, sql, options = {}) {
  return psql(db, `begin;set local role ${role};set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${actor ?? ''}';${sql};commit;`,
  { ...options, authenticator: true });
}

function rows(result) { return result.stdout.split(/\r?\n/).filter(Boolean); }
function lastLine(result) { return rows(result).at(-1) ?? ''; }

function applyAlgoThroughF3(db) {
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age)
      values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values('${ids.tester}'),('${ids.other}'),('${ids.creator}'),('${ids.secondCreator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.tester}','l5f4_tester',false),('${ids.other}','l5f4_other',false),
      ('${ids.creator}','l5f4_creator',false),('${ids.secondCreator}','l5f4_second_creator',false);
    update private.algo_l1_policy set
      canary_enabled=false,canary_user_id='${ids.tester}',
      canary_request_id='${ids.historicalRequest}',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',canary_generation=2;
  `);
  for (const suffix of [
    '_algo6_l2_directed_canary.sql', '_algo6_l3_quality_retention_antispam.sql',
    '_algo6_l3_directed_canary.sql', '_algo6_l4_session_context.sql',
    '_algo6_l4_directed_canary.sql', '_algo6_l5_semantic_embedding_foundation.sql',
    '_algo6_l5_f2_multimodal_semantic.sql', '_algo6_l5_f3_semantic_affinity_ranking.sql',
  ]) psql(db, migration(suffix));
  psql(db, `update private.algo_l1_policy set
    policy_version='nelyon-algo-l1-v1',enabled=true,canary_enabled=false,
    canary_target_layer='l4',canary_generation=12,production_rollout_bps=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,
    l5_semantic_enabled=false`);
}

function createDatabase({ applyF4 = true } = {}) {
  const db = `algo6_l5f4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyAlgoThroughF3(db);
  if (applyF4) psql(db, migration('_algo6_l5_f4_directed_canary.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function requestCanary(db, userId = ids.tester) {
  return lastLine(actorCall(db, 'authenticated', userId,
    "select status||'|'||request_id||'|'||requested_at from public.request_my_algo_l1_canary_v1()"));
}

function manageCanary(db, action, requestId, ttl = null, options = {}) {
  return actorCall(db, 'service_role', null,
    `select status||'|'||request_id||'|'||generation from public.manage_algo_l1_canary_v1(` +
    `'${action}',${requestId == null ? 'null' : `'${requestId}'`},${ttl ?? 'null'})`, options);
}

function policyState(db) {
  return lastLine(psql(db, `select row_to_json(p)::text from (
    select enabled,policy_version,production_rollout_bps,l2_affinity_enabled,
      l3_quality_enabled,l4_context_enabled,l5_semantic_enabled,canary_enabled,
      canary_user_id,canary_request_id,canary_requested_at,canary_armed_at,
      canary_expires_at,canary_target_layer,canary_generation
    from private.algo_l1_policy
  ) p`));
}

let policyVersionCounter = 0;
function updatePolicy(db, assignments) {
  policyVersionCounter += 1;
  return psql(db, `update private.algo_l1_policy set ${assignments},
    policy_version='nelyon-algo-l5-f4-gate-${policyVersionCounter}'`);
}

function assertRejected(db, action, requestId, ttl, error) {
  const before = policyState(db);
  const result = manageCanary(db, action, requestId, ttl, { allowFailure: true });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, new RegExp(error, 'i'));
  assert.equal(policyState(db), before);
}

function reconcile(db) {
  return JSON.parse(lastLine(actorCall(db, 'service_role', null,
    'select public.reconcile_algo_l1_v1()')));
}

function assertReconciled(db) {
  const result = reconcile(db);
  assert.equal(Object.keys(result).length, 57);
  assert.deepEqual(Object.entries(result).filter(([, value]) => value !== 0), []);
}

function insertVideo(db, key, ownerId = ids.creator, ageSeconds = 120) {
  const id = lastLine(psql(db, `select md5('${key}')::uuid`));
  psql(db, `insert into public.videos(id,user_id,video_url,caption,created_at)
    values('${id}','${ownerId}','https://example.test/${key}.mp4','${key}',
      clock_timestamp()-make_interval(secs=>${ageSeconds}))`);
  return id;
}

function vectorLiteral(axis = 0) {
  const values = Array(1024).fill(0);
  values[axis] = 1;
  return `'[${values.join(',')}]'::extensions.vector(1024)`;
}

function markReady(db, video, axis = 0) {
  psql(db, `update private.video_semantic_profiles set
    status='ready',semantic_input_version='video-semantic-v2',
    provider='cloudflare_workers_ai',model='@cf/baai/bge-m3',embedding_dimensions=1024,
    embedding=${vectorLiteral(axis)},attempt_count=1,started_at=null,
    completed_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
    where video_id='${video}'`);
}

function rankedRows(db, role, actor, session, asOf = null, cursor = null) {
  const value = item => item == null ? 'null' : `'${item}'`;
  const sql = `select id||chr(30)||rank_score||chr(30)||ranking_mode||chr(30)||` +
    `cursor_score||chr(30)||cursor_created_at||chr(30)||feed_as_of||chr(30)||policy_version
    from public.get_ranked_feed_l1_v1('${session}',50,${value(asOf)},
      ${cursor?.score ?? 'null'},${value(cursor?.createdAt)},${value(cursor?.id)},${value(cursor?.policy)})`;
  return rows(actorCall(db, role, actor, sql)).map(line => {
    const [id, score, mode, cursorScore, createdAt, feedAsOf, policy] = line.split('\x1e');
    return { id, score: Number(score), mode, cursorScore, createdAt, feedAsOf, policy };
  });
}

test('F4 migration is dormant, ACL-stable and widens only the canonical target',
  { skip: !enabled, timeout: 360000 }, () => {
    const db = createDatabase({ applyF4: false });
    try {
      const policyBefore = policyState(db);
      const profilesBefore = lastLine(psql(db, 'select count(*) from private.video_semantic_profiles'));
      psql(db, migration('_algo6_l5_f4_directed_canary.sql'));
      assert.equal(policyState(db), policyBefore);
      assert.equal(lastLine(psql(db, 'select count(*) from private.video_semantic_profiles')), profilesBefore);
      for (const layer of ['l1', 'l2', 'l3', 'l4', 'l5']) {
        psql(db, `update private.algo_l1_policy set canary_target_layer='${layer}'`);
      }
      assert.notEqual(psql(db,
        "update private.algo_l1_policy set canary_target_layer='invalid'",
        { allowFailure: true }).status, 0);
      assert.equal(lastLine(psql(db, `select concat_ws('|',
        has_function_privilege('service_role','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute'),
        has_function_privilege('authenticated','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute'),
        has_function_privilege('anon','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute'),
        has_function_privilege('public','public.manage_algo_l1_canary_v1(text,uuid,integer)','execute'),
        has_function_privilege('authenticated','public.request_my_algo_l1_canary_v1()','execute'),
        has_function_privilege('service_role','public.request_my_algo_l1_canary_v1()','execute'),
        has_function_privilege('anon','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('authenticated','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('service_role','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('service_role','public.reconcile_algo_l1_v1()','execute'),
        has_function_privilege('authenticated','public.reconcile_algo_l1_v1()','execute'))`)),
      't|f|f|f|t|f|t|t|f|t|f');
      assert.equal(lastLine(psql(db, `select count(*) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'manage_algo_l1_canary_v1','request_my_algo_l1_canary_v1',
          'get_ranked_feed_l1_v1','reconcile_algo_l1_v1') and p.prosecdef
          and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]`)), '4');
      assert.equal(lastLine(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.proname ~* 'algo_l5.*canary|canary.*l5'`)), '0');
      assert.equal(lastLine(psql(db, `select count(*) from information_schema.tables
        where table_schema in ('public','private') and table_name ~* 'l5.*canary|canary.*l5'`)), '0');
      psql(db, "update private.algo_l1_policy set canary_target_layer='l4'");
      assertReconciled(db);
    } finally { dropDatabase(db); }
  });

test('arm_l5 fails closed, increments once, emits suffixes and preserves prior actions',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      insertVideo(db, 'l5f4-controller-candidate', ids.creator, 60);
      let requestId = requestCanary(db).split('|')[1];
      assertRejected(db, 'arm_l5', randomUUID(), 30, 'algo_l1_canary_request_not_pending');
      assertRejected(db, 'arm_l5', requestId, 4, 'algo_l1_canary_ttl_invalid');
      assertRejected(db, 'arm_l5', requestId, 61, 'algo_l1_canary_ttl_invalid');
      updatePolicy(db, 'l5_semantic_enabled=true');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l5_canary_global_enabled');
      updatePolicy(db, 'l5_semantic_enabled=false,l4_context_enabled=true');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l5_canary_l4_global_enabled');
      updatePolicy(db, 'l4_context_enabled=false,l3_quality_enabled=true');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l5_canary_l3_global_enabled');
      updatePolicy(db, 'l3_quality_enabled=false,l2_affinity_enabled=true');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l5_canary_l2_global_enabled');
      updatePolicy(db, 'l2_affinity_enabled=false,production_rollout_bps=1');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l1_canary_rollout_conflict');
      updatePolicy(db, "production_rollout_bps=0,canary_requested_at=clock_timestamp()-interval '31 minutes'");
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l1_canary_request_expired');
      updatePolicy(db, `canary_requested_at=clock_timestamp(),canary_user_id='${ids.nonexistentUser}'`);
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l1_canary_user_missing');
      updatePolicy(db, `canary_user_id='${ids.tester}'`);

      const armed = lastLine(manageCanary(db, 'arm_l5', requestId, 30));
      assert.match(armed, /^active\|[0-9a-f-]{36}\|13$/i);
      assert.equal(lastLine(psql(db, `select concat_ws('|',canary_enabled,canary_target_layer,
        canary_generation,extract(epoch from canary_expires_at-canary_armed_at)::integer,
        l2_affinity_enabled,l3_quality_enabled,l4_context_enabled,l5_semantic_enabled,
        production_rollout_bps) from private.algo_l1_policy`)),
      't|l5|13|1800|f|f|f|f|0');
      assertRejected(db, 'arm_l5', requestId, 30, 'algo_l1_canary_already_active');
      assertReconciled(db);

      updatePolicy(db, 'l4_context_enabled=true');
      assert.equal(reconcile(db).l5_directed_canary_state_invalid, 1,
        'post-ARM lower-layer drift must be visible to reconciliation');
      updatePolicy(db, 'l4_context_enabled=false');
      assertReconciled(db);

      const current = rankedRows(db, 'authenticated', ids.tester, ids.session)[0];
      assert.equal(current.mode, 'behavioral_l5');
      assert.match(current.policy, /\|canary:13:l5:active$/);
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|14$/i);
      const inactive = rankedRows(db, 'authenticated', ids.tester, ids.session)[0];
      assert.equal(inactive.mode, 'chronological');
      assert.match(inactive.policy, /\|canary:14:l5:inactive$/);

      requestId = requestCanary(db).split('|')[1];
      assert.match(lastLine(manageCanary(db, 'arm_l5', requestId, 5)),
        /^active\|[0-9a-f-]{36}\|15$/i);
      psql(db, `update private.algo_l1_policy set
        canary_armed_at=clock_timestamp()-interval '6 minutes',
        canary_expires_at=clock_timestamp()-interval '1 minute'`);
      const expired = rankedRows(db, 'authenticated', ids.tester, ids.session)[0];
      assert.equal(expired.mode, 'chronological');
      assert.match(expired.policy, /\|canary:15:l5:inactive$/);
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)),
        /^disarmed\|[0-9a-f-]{36}\|16$/i);

      const cases = [
        ['arm', 'l1', 'behavioral_l1'],
        ['arm_l2', 'l2', 'behavioral_l2'],
        ['arm_l3', 'l3', 'behavioral_l3'],
        ['arm_l4', 'l4', 'behavioral_l4'],
      ];
      for (const [action, target, mode] of cases) {
        requestId = requestCanary(db).split('|')[1];
        assert.match(lastLine(manageCanary(db, action, requestId, 5)), /^active\|[0-9a-f-]{36}\|\d+$/i);
        assert.equal(lastLine(psql(db, 'select canary_target_layer from private.algo_l1_policy')), target);
        assert.equal(rankedRows(db, 'authenticated', ids.tester, ids.session)[0].mode, mode);
        assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|[0-9a-f-]{36}\|\d+$/i);
      }
      assertReconciled(db);
    } finally { dropDatabase(db); }
  });

test('directed L5 is L1 plus semantic scoring only and respects the two-video minimum gate',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const historyA = insertVideo(db, 'l5f4-history-a', ids.creator, 600);
      const historyB = insertVideo(db, 'l5f4-history-b', ids.secondCreator, 590);
      const candidate = insertVideo(db, 'l5f4-candidate', ids.creator, 100);
      const noEmbedding = insertVideo(db, 'l5f4-candidate-no-embedding', ids.secondCreator, 90);
      for (const video of [historyA, historyB, candidate]) markReady(db, video);
      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l5-f4-isolation',production_rollout_bps=0,
        l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,
        l5_semantic_enabled=false,freshness_weight=0,follow_weight=0,like_weight=0,
        comment_weight=0,save_weight=0,completion_weight=0,rewatch_weight=0,
        exploration_weight=0,short_watch_penalty=0,recent_completed_penalty=0,
        repeat_view_penalty=0,same_session_penalty=0,creator_page_cap=50`);
      psql(db, `insert into public.video_saves(video_id,user_id,created_at)
        values('${historyA}','${ids.tester}',clock_timestamp()-interval '20 seconds')`);

      let requestId = requestCanary(db).split('|')[1];
      assert.match(lastLine(manageCanary(db, 'arm_l5', requestId, 30)), /^active\|/);
      let ranked = rankedRows(db, 'authenticated', ids.tester, ids.session);
      assert.equal(ranked.find(row => row.id === candidate)?.score, 0,
        'one positive semantic video must not open the minimum gate');
      assert.ok(ranked.some(row => row.id === noEmbedding), 'candidate without embedding remains deliverable');
      assert.equal(ranked.find(row => row.id === noEmbedding)?.score, 0);
      assert.match(lastLine(manageCanary(db, 'disarm', requestId)), /^disarmed\|/);

      psql(db, `insert into public.likes(video_id,user_id,created_at)
        values('${historyB}','${ids.tester}',clock_timestamp()-interval '10 seconds')`);
      requestId = requestCanary(db).split('|')[1];
      assert.match(lastLine(manageCanary(db, 'arm_l5', requestId, 30)), /^active\|/);
      ranked = rankedRows(db, 'authenticated', ids.tester, ids.session);
      const semanticCandidate = ranked.find(row => row.id === candidate);
      assert.ok(semanticCandidate);
      assert.equal(semanticCandidate.mode, 'behavioral_l5');
      assert.ok(Math.abs(semanticCandidate.score - 2.4) < 0.00001,
        `expected isolated partial-confidence L5 score 2.4, got ${semanticCandidate.score}`);
      assert.equal(rankedRows(db, 'authenticated', ids.other, ids.otherSession)[0].mode,
        'chronological');
      assert.equal(rankedRows(db, 'anon', null, ids.anonSession)[0].mode, 'chronological');
      assertReconciled(db);
    } finally { dropDatabase(db); }
  });
