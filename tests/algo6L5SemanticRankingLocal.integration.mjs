import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L5_F3_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L5_F3_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L5_F3_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: '91000000-0000-4000-8000-000000000001',
  creator: '91000000-0000-4000-8000-000000000002',
  otherCreator: '91000000-0000-4000-8000-000000000003',
  session: '91000000-0000-4000-8000-000000000010',
  anonSession: '91000000-0000-4000-8000-000000000011',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
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

function applyAlgoThroughL5F2(db) {
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age)
      values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values('90000000-0000-4000-8000-000000000001');
    insert into public.user_profiles(id,username,is_private)
      values('90000000-0000-4000-8000-000000000001','l5f3_bootstrap',false);
    update private.algo_l1_policy set
      canary_enabled=false,canary_user_id='90000000-0000-4000-8000-000000000001',
      canary_request_id='90000000-0000-4000-8000-000000000002',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',canary_generation=2;
  `);
  for (const suffix of [
    '_algo6_l2_directed_canary.sql', '_algo6_l3_quality_retention_antispam.sql',
    '_algo6_l3_directed_canary.sql', '_algo6_l4_session_context.sql',
    '_algo6_l4_directed_canary.sql', '_algo6_l5_semantic_embedding_foundation.sql',
    '_algo6_l5_f2_multimodal_semantic.sql',
  ]) psql(db, migration(suffix));
  psql(db, `update private.algo_l1_policy set
    policy_version='nelyon-algo-l1-v1',canary_enabled=false,canary_target_layer='l4',
    canary_generation=12,production_rollout_bps=0,l2_affinity_enabled=false,
    l3_quality_enabled=false,l4_context_enabled=false`);
}

function createDatabase({ applyF3 = true } = {}) {
  const db = `algo6_l5f3_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyAlgoThroughL5F2(db);
  if (applyF3) psql(db, migration('_algo6_l5_f3_semantic_affinity_ranking.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function seedActors(db) {
  psql(db, `insert into auth.users(id) values('${ids.viewer}'),('${ids.creator}'),('${ids.otherCreator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','l5f3_viewer',false),
      ('${ids.creator}','l5f3_creator',false),
      ('${ids.otherCreator}','l5f3_other_creator',false)`);
}

function insertVideo(db, key, userId = ids.creator, ageSeconds = 120) {
  const id = lastLine(psql(db, `select md5('${key}')::uuid`));
  psql(db, `insert into public.videos(id,user_id,video_url,caption,created_at)
    values('${id}','${userId}','https://example.test/${key}.mp4','${key}',
      clock_timestamp()-make_interval(secs=>${ageSeconds}))`);
  return id;
}

function vectorLiteral(axis = 0, value = 1) {
  const values = Array(1024).fill(0);
  if (axis >= 0) values[axis] = value;
  return `'[${values.join(',')}]'::extensions.vector(1024)`;
}

function markReady(db, video, axis = 0, value = 1) {
  psql(db, `update private.video_semantic_profiles set
    status='ready',embedding=${vectorLiteral(axis, value)},attempt_count=1,
    started_at=null,completed_at=clock_timestamp(),last_error_code=null,
    updated_at=clock_timestamp()
    where video_id='${video}'`);
}

let policyVersionCounter = 0;

function updatePolicy(db, assignments, options = {}) {
  policyVersionCounter += 1;
  return psql(db, `update private.algo_l1_policy set ${assignments},
    policy_version='nelyon-algo-l5-f3-test-${policyVersionCounter}'`, options);
}

function setL5(db, enabledValue, extra = '') {
  updatePolicy(db, `production_rollout_bps=10000,exploration_weight=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,
    l5_semantic_enabled=${enabledValue ? 'true' : 'false'}${extra}`);
}

function captureAsOf(db) { return lastLine(psql(db, 'select clock_timestamp()')); }

function currentPolicy(db) {
  return lastLine(psql(db, 'select policy_version from private.algo_l1_policy where singleton'));
}

function rankedSql(session, asOf, limit = 50, cursor = null, policyVersion = 'nelyon-algo-l1-v1') {
  const score = cursor?.score ?? '999999';
  const createdAt = cursor?.createdAt ?? '9999-12-31T23:59:59Z';
  const id = cursor?.id ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const policy = cursor?.policy ?? policyVersion;
  return `select id||chr(30)||rank_score||chr(30)||ranking_mode||chr(30)||` +
    `cursor_score||chr(30)||cursor_created_at||chr(30)||cursor_id||chr(30)||feed_as_of||chr(30)||policy_version
    from public.get_ranked_feed_l1_v1('${session}',${limit},'${asOf}',${score},
      '${createdAt}','${id}','${policy}')`;
}

function rankedRows(db, role, actor, session, asOf, limit = 50, cursor = null) {
  return rows(actorCall(db, role, actor, rankedSql(session, asOf, limit, cursor, currentPolicy(db)))).map(line => {
    const [id, score, mode, cursorScore, createdAt, cursorId, feedAsOf, policy] = line.split('\x1e');
    return { id, score: Number(score), mode, cursorScore, createdAt, cursorId, feedAsOf, policy };
  });
}

function scoreMap(result) { return new Map(result.map(row => [row.id, row.score])); }

function l5Delta(db, candidate, asOf) {
  setL5(db, false);
  const before = scoreMap(rankedRows(db, 'authenticated', ids.viewer, ids.session, asOf));
  setL5(db, true);
  const afterRows = rankedRows(db, 'authenticated', ids.viewer, ids.session, asOf);
  const after = scoreMap(afterRows);
  assert.ok(before.has(candidate) && after.has(candidate), 'candidate must remain deliverable');
  return { delta: Number((after.get(candidate) - before.get(candidate)).toFixed(6)), rows: afterRows };
}

function clearViewerSignals(db) {
  psql(db, `delete from public.likes where user_id='${ids.viewer}';
    delete from public.video_saves where user_id='${ids.viewer}';
    delete from public.comments where user_id='${ids.viewer}';
    delete from public.video_views where viewer_id='${ids.viewer}'`);
}

function addView(db, video, key, { watch = 1000, media = 10000, exit = 'swipe', created = "clock_timestamp()-interval '10 seconds'" } = {}) {
  const session = lastLine(psql(db, `select md5('${key}-session')::uuid`));
  const event = lastLine(psql(db, `select md5('${key}-event')::uuid`));
  if (media == null) {
    psql(db, `insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,
      watch_duration_ms,media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
      values('${video}','${ids.viewer}','${event}','${session}',${watch},null,null,null,0,'${exit}',${created})`);
  } else {
    const ratio = (watch / media).toFixed(6);
    const completed = watch >= media;
    const rewatches = Math.max(Math.floor(watch / media) - 1, 0);
    psql(db, `insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,
      watch_duration_ms,media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
      values('${video}','${ids.viewer}','${event}','${session}',${watch},${media},${ratio},${completed},${rewatches},'${exit}',${created})`);
  }
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${message}: expected ${expected}, got ${actual}`);
}

test('F3 migration is dormant, constraint-safe, ACL-stable and exact-disabled-parity',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase({ applyF3: false });
    try {
      seedActors(db);
      insertVideo(db, 'dormant-a');
      insertVideo(db, 'dormant-b', ids.otherCreator);
      updatePolicy(db, 'production_rollout_bps=10000');
      const asOf = captureAsOf(db);
      const baselinePolicy = currentPolicy(db);
      const beforeAuth = actorCall(db, 'authenticated', ids.viewer,
        rankedSql(ids.session, asOf, 50, null, baselinePolicy)).stdout;
      const beforeAnon = actorCall(db, 'anon', null,
        rankedSql(ids.anonSession, asOf, 50, null, baselinePolicy)).stdout;
      const profilesBefore = lastLine(psql(db, 'select count(*) from private.video_semantic_profiles'));

      psql(db, migration('_algo6_l5_f3_semantic_affinity_ranking.sql'));
      assert.equal(lastLine(psql(db, 'select count(*) from private.video_semantic_profiles')), profilesBefore);
      assert.equal(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(ids.session, asOf, 50, null, baselinePolicy)).stdout, beforeAuth);
      assert.equal(actorCall(db, 'anon', null,
        rankedSql(ids.anonSession, asOf, 50, null, baselinePolicy)).stdout, beforeAnon);

      const policy = JSON.parse(lastLine(psql(db, `select jsonb_build_object(
        'enabled',l5_semantic_enabled,'horizon',l5_semantic_horizon_days,'history',l5_semantic_history_cap,
        'watch',l5_semantic_positive_watch_ratio_threshold,'pmin',l5_semantic_positive_min_distinct_videos,
        'nmin',l5_semantic_negative_min_distinct_videos,'full',l5_semantic_full_confidence_videos,
        'pfloor',l5_semantic_positive_similarity_floor,'nfloor',l5_semantic_negative_similarity_floor,
        'pcap',l5_semantic_positive_cap,'ncap',l5_semantic_negative_cap)::text
        from private.algo_l1_policy`)));
      assert.deepEqual(policy, { enabled: false, horizon: 30, history: 50, watch: 0.65,
        pmin: 2, nmin: 2, full: 10, pfloor: 0.35, nfloor: 0.45, pcap: 12, ncap: 8 });

      for (const [index, update] of [
        'l5_semantic_horizon_days=0', 'l5_semantic_horizon_days=366',
        'l5_semantic_history_cap=0', 'l5_semantic_history_cap=201',
        'l5_semantic_positive_watch_ratio_threshold=-0.1', 'l5_semantic_positive_watch_ratio_threshold=1.1',
        'l5_semantic_positive_min_distinct_videos=0', 'l5_semantic_negative_min_distinct_videos=51',
        'l5_semantic_full_confidence_videos=1', 'l5_semantic_full_confidence_videos=201',
        'l5_semantic_positive_similarity_floor=-1.1', 'l5_semantic_positive_similarity_floor=1',
        'l5_semantic_negative_similarity_floor=-1.1', 'l5_semantic_negative_similarity_floor=1',
        'l5_semantic_positive_cap=-1', 'l5_semantic_positive_cap=101',
        'l5_semantic_negative_cap=-1', 'l5_semantic_negative_cap=101',
      ].entries()) assert.notEqual(psql(db, `update private.algo_l1_policy set ${update},
        policy_version='nelyon-algo-l5-f3-constraint-${index}'`, { allowFailure: true }).status, 0, update);

      assert.equal(lastLine(psql(db, `select concat_ws('|',
        has_function_privilege('anon','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('authenticated','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('service_role','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'),
        has_function_privilege('public','public.get_ranked_feed_l1_v1(uuid,integer,timestamptz,numeric,timestamptz,uuid,text)','execute'))`)),
      't|t|f|f');
      assert.equal(lastLine(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='get_ranked_feed_l1_v1'`)), '1');
      updatePolicy(db, 'production_rollout_bps=0,l5_semantic_enabled=false');
      const reconciler = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(Object.keys(reconciler).length, 55);
      assert.deepEqual(Object.entries(reconciler).filter(([, value]) => value !== 0), []);

      psql(db, 'create materialized view private.semantic_centroids as select 1::integer as marker');
      let drifted = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(drifted.l5_semantic_user_vector_materialization_present, 1,
        'materialized user-centroid authority must fail reconciliation');
      psql(db, 'drop materialized view private.semantic_centroids');

      psql(db, `do $audit$
        declare definition text;
        begin
          select pg_get_functiondef(p.oid) into definition
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='get_ranked_feed_l1_v1';
          execute replace(
            definition,
            E'begin\\n  if p_client_session_id',
            E'begin\\n  perform 1 from private.content_safety_visual_analyses where false;\\n  if p_client_session_id'
          );
        end
      $audit$`);
      drifted = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(drifted.l5_semantic_ranking_sensitive_dependency_present, 1,
        'visual-safety output dependency must fail reconciliation');
    } finally { dropDatabase(db); }
  });

test('positive centroid gates, signals, distinctness, self exclusion and mode precedence are exact',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      const historyA = insertVideo(db, 'positive-history-a', ids.creator, 600);
      const historyB = insertVideo(db, 'positive-history-b', ids.otherCreator, 590);
      const selfHistory = insertVideo(db, 'positive-self-history', ids.viewer, 580);
      const candidateNear = insertVideo(db, 'positive-candidate-near', ids.creator, 100);
      const candidateFar = insertVideo(db, 'positive-candidate-far', ids.otherCreator, 90);
      const selfCandidate = insertVideo(db, 'positive-self-candidate', ids.viewer, 80);
      for (const video of [historyA, historyB, selfHistory, candidateNear, selfCandidate]) markReady(db, video, 0);
      markReady(db, candidateFar, 1);

      psql(db, `insert into public.likes(video_id,user_id,created_at)
          values('${historyA}','${ids.viewer}',clock_timestamp()-interval '30 seconds');
        insert into public.video_saves(video_id,user_id,created_at)
          values('${historyB}','${ids.viewer}',clock_timestamp()-interval '20 seconds')`);
      let asOf = captureAsOf(db);
      let result = l5Delta(db, candidateNear, asOf);
      assertNear(result.delta, 2.4, 'two positive videos open the partial-confidence gate');
      assert.equal(result.rows[0].mode, 'behavioral_l5');
      assertNear(l5Delta(db, candidateFar, asOf).delta, 0, 'orthogonal candidate has no boost');
      assertNear(l5Delta(db, selfCandidate, asOf).delta, 0, 'viewer-owned candidate has no L5 adjustment');
      assert.notEqual(rankedRows(db, 'anon', null, ids.anonSession, asOf)[0].mode, 'behavioral_l5');

      updatePolicy(db, 'l2_affinity_enabled=true,l3_quality_enabled=true,l4_context_enabled=true');
      assert.equal(rankedRows(db, 'authenticated', ids.viewer, ids.session, asOf)[0].mode, 'behavioral_l5');
      updatePolicy(db, 'l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false');

      psql(db, `delete from public.video_saves where user_id='${ids.viewer}'`);
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidateNear, asOf).delta, 0, 'one positive video does not open default gate');

      const cases = [
        ['like', () => psql(db, `insert into public.likes(video_id,user_id) values('${historyA}','${ids.viewer}')`)],
        ['save', () => psql(db, `insert into public.video_saves(video_id,user_id) values('${historyA}','${ids.viewer}')`)],
        ['completed', () => addView(db, historyA, 'positive-completed', { watch: 10000, media: 10000, exit: 'ended' })],
        ['long-watch', () => addView(db, historyA, 'positive-long', { watch: 7000, media: 10000, exit: 'background' })],
        ['rewatch', () => addView(db, historyA, 'positive-rewatch', { watch: 21000, media: 10000, exit: 'ended' })],
      ];
      updatePolicy(db,
        'l5_semantic_positive_min_distinct_videos=1,l5_semantic_full_confidence_videos=1');
      for (const [name, insert] of cases) {
        clearViewerSignals(db); insert(); asOf = captureAsOf(db);
        assertNear(l5Delta(db, candidateNear, asOf).delta, 12, `${name} qualifies as positive`);
      }

      clearViewerSignals(db);
      psql(db, `insert into public.comments(video_id,user_id,text) values('${historyA}','${ids.viewer}','argument')`);
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidateNear, asOf).delta, 0, 'comment alone is not semantic-positive');
      clearViewerSignals(db);
      addView(db, historyA, 'raw-exposure', { media: null, watch: 1000, exit: 'background' });
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidateNear, asOf).delta, 0, 'raw exposure alone is not semantic-positive');

      clearViewerSignals(db);
      updatePolicy(db,
        'l5_semantic_positive_min_distinct_videos=2,l5_semantic_full_confidence_videos=10');
      addView(db, historyA, 'repeat-a', { watch: 10000, media: 10000, exit: 'ended' });
      addView(db, historyA, 'repeat-b', { watch: 10000, media: 10000, exit: 'ended' });
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidateNear, asOf).delta, 0, 'many actions on one video remain one distinct history video');

      clearViewerSignals(db);
      updatePolicy(db,
        'l5_semantic_positive_min_distinct_videos=1,l5_semantic_full_confidence_videos=1');
      psql(db, `insert into public.likes(video_id,user_id) values('${selfHistory}','${ids.viewer}')`);
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidateNear, asOf).delta, 0, 'viewer-owned history is excluded');
    } finally { dropDatabase(db); }
  });

test('negative centroid, conflict precedence, as-of guards and unusable profiles fail closed',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      const negativeA = insertVideo(db, 'negative-history-a', ids.creator, 600);
      const negativeB = insertVideo(db, 'negative-history-b', ids.otherCreator, 590);
      const candidate = insertVideo(db, 'negative-candidate', ids.creator, 100);
      for (const video of [negativeA, negativeB, candidate]) markReady(db, video, 0);
      addView(db, negativeA, 'negative-a', { watch: 1000, media: 10000, exit: 'swipe' });
      let asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidate, asOf).delta, 0, 'one negative video does not open gate');
      addView(db, negativeB, 'negative-b', { watch: 1000, media: 10000, exit: 'background' });
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidate, asOf).delta, -1.6, 'two negative videos apply partial-confidence penalty');

      addView(db, negativeB, 'negative-b-latest-neutral',
        { watch: 4000, media: 10000, exit: 'background' });
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidate, asOf).delta, 0,
        'a later valid neutral retention event supersedes an older short watch');

      psql(db, `insert into public.likes(video_id,user_id) values('${negativeB}','${ids.viewer}')`);
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidate, asOf).delta, 0, 'positive signal removes the same video from negative centroid');

      clearViewerSignals(db);
      addView(db, negativeA, 'negative-valid-one', { watch: 1000, media: 10000, exit: 'swipe' });
      addView(db, negativeB, 'negative-null', { watch: 1000, media: null, exit: 'background' });
      asOf = captureAsOf(db);
      assertNear(l5Delta(db, candidate, asOf).delta, 0, 'null retention metadata cannot open negative gate');

      clearViewerSignals(db);
      addView(db, negativeA, 'asof-negative-one', { watch: 1000, media: 10000, exit: 'swipe' });
      asOf = captureAsOf(db);
      addView(db, negativeB, 'asof-negative-late', { watch: 1000, media: 10000, exit: 'swipe', created: 'clock_timestamp()' });
      assertNear(l5Delta(db, candidate, asOf).delta, 0, 'interaction after as_of is ignored');

      clearViewerSignals(db);
      psql(db, `insert into public.likes(video_id,user_id) values('${negativeA}','${ids.viewer}');
        insert into public.video_saves(video_id,user_id) values('${negativeB}','${ids.viewer}')`);
      asOf = captureAsOf(db);
      psql(db, `update private.video_semantic_profiles set
        embedding=${vectorLiteral(-1)},status='ready',completed_at=clock_timestamp(),updated_at=clock_timestamp()
        where video_id='${candidate}'`);
      const withoutSemantic = l5Delta(db, candidate, asOf);
      assertNear(withoutSemantic.delta, 0, 'zero-norm or post-as_of candidate profile has zero adjustment');
      assert.ok(withoutSemantic.rows.some(row => row.id === candidate), 'candidate without usable embedding remains delivered');

      markReady(db, candidate, 0);
      asOf = captureAsOf(db);
      const stableA = rankedRows(db, 'authenticated', ids.viewer, ids.session, asOf, 2);
      const stableB = rankedRows(db, 'authenticated', ids.viewer, ids.session, asOf, 2);
      assert.deepEqual(stableB, stableA, 'unchanged semantic state keeps ordering and cursor deterministic');
    } finally { dropDatabase(db); }
  });

test('30k semantic profiles stay PK-joined to the 200-candidate pool without ANN or materialization',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      psql(db, `
        alter table public.videos disable trigger user;
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('l5f3-perf-'||i)::uuid,'${ids.creator}',
          'https://example.test/l5f3/'||i||'.mp4','l5f3 performance '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        alter table public.videos enable trigger user;
        insert into private.video_semantic_profiles(
          video_id,source_content_fingerprint,semantic_input_version,
          semantic_input_fingerprint,caption_fingerprint,status
        )
        select id,repeat('a',64),'video-semantic-v2',repeat('b',64),repeat('c',64),'pending'
        from public.videos where caption like 'l5f3 performance %';
        analyze public.videos;
        analyze private.video_semantic_profiles;
      `);
      assert.equal(lastLine(psql(db, `select count(*) from public.videos where caption like 'l5f3 performance %'`)), '30000');
      assert.equal(lastLine(psql(db, `select count(*) from private.video_semantic_profiles p
        join public.videos v on v.id=p.video_id where v.caption like 'l5f3 performance %'`)), '30000');
      const plan = psql(db, `explain (analyze,buffers,costs off)
        with candidates as materialized (
          select v.id from public.videos v order by v.created_at desc,v.id desc limit 200
        )
        select c.id,p.embedding from candidates c
        left join private.video_semantic_profiles p on p.video_id=c.id
          and p.status='ready' and p.semantic_input_version='video-semantic-v2'
          and p.provider='cloudflare_workers_ai' and p.model='@cf/baai/bge-m3'
          and p.embedding_dimensions=1024 and p.embedding is not null`).stdout;
      assert.match(plan, /video_semantic_profiles_pkey/i);
      assert.doesNotMatch(plan, /Seq Scan on video_semantic_profiles/i);
      assert.equal(lastLine(psql(db, `select count(*) from pg_indexes
        where schemaname in ('public','private') and indexdef ~* 'hnsw|ivfflat'`)), '0');
      assert.equal(lastLine(psql(db, `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and c.relkind in ('r','m') and c.relname = any(array[
          'user_interest_vectors','user_semantic_profiles','viewer_embeddings','semantic_centroids',
          'semantic_interest_cache','user_embedding_cache'])`)), '0');
    } finally { dropDatabase(db); }
  });
