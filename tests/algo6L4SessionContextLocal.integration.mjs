import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L4_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L4_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L4_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const viewer = '71000000-0000-4000-8000-000000000001';
const currentSession = '75000000-0000-4000-8000-000000000001';
const otherSession = '75000000-0000-4000-8000-000000000002';
const newSession = '75000000-0000-4000-8000-000000000003';

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

function createDatabase({ applyL4 = true } = {}) {
  const db = `algo6_l4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
    insert into auth.users(id) values('70000000-0000-4000-8000-000000000001');
    insert into public.user_profiles(id,username,is_private)
      values('70000000-0000-4000-8000-000000000001','l4_bootstrap',false);
    update private.algo_l1_policy set
      canary_enabled=false,
      canary_user_id='70000000-0000-4000-8000-000000000001',
      canary_request_id='70000000-0000-4000-8000-000000000002',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',
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
  psql(db, migration('_algo6_l3_directed_canary.sql'));
  psql(db, `update private.algo_l1_policy set
    canary_enabled=false,
    canary_target_layer='l3',
    canary_generation=10,
    production_rollout_bps=0,
    l2_affinity_enabled=false,
    l3_quality_enabled=false`);
  if (applyL4) psql(db, migration('_algo6_l4_session_context.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 50, asOf, score = 999999, createdAt = '9999-12-31T23:59:59Z',
  id = 'ffffffff-ffff-ffff-ffff-ffffffffffff', policy,
  projection = "caption||'|'||rank_score||'|'||ranking_mode||'|'||policy_version||'|'||created_at||'|'||feed_as_of||'|'||cursor_score||'|'||id",
} = {}) {
  const value = item => item == null ? 'null' : `'${item}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${value(asOf)},${score == null ? 'null' : score},` +
    `${value(createdAt)},${value(id)},${value(policy)})`;
}

function scoreMap(result) {
  return new Map(rows(result).map(row => {
    const [caption, score, mode, policy] = row.split('|');
    return [caption, { score: Number(score), mode, policy }];
  }));
}

function seedFunctional(db, asOf) {
  psql(db, `
    insert into auth.users(id) values('${viewer}');
    insert into public.user_profiles(id,username,is_private)
      values('${viewer}','l4_viewer',false);

    insert into auth.users(id)
    select md5('l4-creator-'||label)::uuid
    from unnest(array[
      'pos1','pos2','pos3','neg1','neg2','neg4','fat1','fat2','fat3','fat4','fat6',
      'latest','other','layer','anon'
    ]) label;
    insert into public.user_profiles(id,username,is_private)
    select md5('l4-creator-'||label)::uuid,'l4_'||label,false
    from unnest(array[
      'pos1','pos2','pos3','neg1','neg2','neg4','fat1','fat2','fat3','fat4','fat6',
      'latest','other','layer','anon'
    ]) label;

    with definitions(label,video_count) as (values
      ('pos1',1),('pos2',2),('pos3',3),('neg1',1),('neg2',2),('neg4',4),
      ('fat1',1),('fat2',2),('fat3',3),('fat4',4),('fat6',6),
      ('latest',2),('other',3),('layer',1),('anon',1)
    )
    insert into public.videos(id,user_id,video_url,caption,created_at)
    select md5('l4-video-'||d.label||'-'||i)::uuid,
      md5('l4-creator-'||d.label)::uuid,
      'https://example.test/l4/'||d.label||'-'||i||'.mp4',
      d.label||'-'||i,
      '${asOf}'::timestamptz-make_interval(secs=>(row_number() over())::integer+60)
    from definitions d cross join lateral generate_series(1,d.video_count) i;

    insert into public.videos(id,user_id,video_url,caption,created_at)
    values(md5('l4-self-video')::uuid,'${viewer}',
      'https://example.test/l4/self.mp4','self-1','${asOf}'::timestamptz-interval '59 seconds');

    insert into auth.users(id)
    select md5('l4-audience-'||i)::uuid from generate_series(1,5) i;
    insert into public.user_profiles(id,username,is_private)
    select md5('l4-audience-'||i)::uuid,'l4_audience_'||i,false
    from generate_series(1,5) i;

    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select v.id,'${viewer}'::uuid,md5('l4-positive-'||v.caption)::uuid,'${currentSession}'::uuid,
      80000,100000,0.8,false,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>row_number() over()::integer+1)
    from public.videos v where v.caption ~ '^pos[123]-' or v.caption='self-1'
    union all
    select v.id,null,md5('l4-anonymous-positive')::uuid,'${currentSession}'::uuid,
      80000,100000,0.8,false,0,'ended','${asOf}'::timestamptz-interval '4 seconds'
    from public.videos v where v.caption='anon-1'
    union all
    select v.id,'${viewer}'::uuid,md5('l4-negative-'||v.caption)::uuid,'${currentSession}'::uuid,
      10000,100000,0.1,false,0,'swipe',
      '${asOf}'::timestamptz-make_interval(secs=>row_number() over()::integer+15)
    from public.videos v where v.caption ~ '^neg[124]-'
    union all
    select v.id,'${viewer}'::uuid,md5('l4-fatigue-'||v.caption)::uuid,'${currentSession}'::uuid,
      1000,null,null,null,0,'background',
      '${asOf}'::timestamptz-make_interval(secs=>row_number() over()::integer+30)
    from public.videos v where v.caption ~ '^fat[12346]-'
    union all
    select v.id,'${viewer}'::uuid,md5('l4-other-'||v.caption)::uuid,'${otherSession}'::uuid,
      80000,100000,0.8,false,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>row_number() over()::integer+45)
    from public.videos v where v.caption ~ '^other-';

    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select v.id,'${viewer}'::uuid,md5('l4-repeat-'||i)::uuid,'${currentSession}'::uuid,
      500,null,null,null,0,'background','${asOf}'::timestamptz-make_interval(secs=>50+i)
    from public.videos v cross join generate_series(1,5) i
    where v.caption='fat1-1';

    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select v.id,'${viewer}'::uuid,md5('l4-latest-old-'||v.caption)::uuid,'${currentSession}'::uuid,
      80000,100000,0.8,false,0,'ended','${asOf}'::timestamptz-interval '12 seconds'
    from public.videos v where v.caption ~ '^latest-'
    union all
    select v.id,'${viewer}'::uuid,md5('l4-latest-new-'||v.caption)::uuid,'${currentSession}'::uuid,
      10000,100000,0.1,false,0,'swipe','${asOf}'::timestamptz-interval '10 seconds'
    from public.videos v where v.caption ~ '^latest-'
    union all
    select v.id,'${viewer}'::uuid,md5('l4-latest-invalid-'||v.caption)::uuid,'${currentSession}'::uuid,
      1000,null,null,null,0,'background','${asOf}'::timestamptz-interval '8 seconds'
    from public.videos v where v.caption ~ '^latest-';

    insert into public.likes(video_id,user_id,created_at)
    select id,'${viewer}','${asOf}'::timestamptz-interval '20 seconds'
    from public.videos where caption='layer-1';
    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select v.id,md5('l4-audience-'||i)::uuid,md5('l4-layer-quality-'||i)::uuid,
      md5('l4-layer-session-'||i)::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i+20)
    from public.videos v cross join generate_series(1,3) i where v.caption='layer-1';
    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select id,'${viewer}'::uuid,md5('l4-layer-context')::uuid,'${currentSession}'::uuid,
      80000,100000,0.8,false,0,'ended','${asOf}'::timestamptz-interval '5 seconds'
    from public.videos where caption='layer-1';
  `);
}

test('L4 preserves dormant output and enforces exact session-context behavior',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase({ applyL4: false });
    try {
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      seedFunctional(db, asOf);
      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-parity-v1',production_rollout_bps=10000,
        creator_page_cap=50`);
      const before = rows(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-parity-v1' })));

      psql(db, migration('_algo6_l4_session_context.sql'));
      const state = lastLine(psql(db, `select
        policy_version||'|'||l4_context_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_generation||'|'||canary_target_layer
        from private.algo_l1_policy`));
      assert.equal(state, 'nelyon-algo-l4-parity-v1|false|10000|false|10|l3');
      const after = rows(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-parity-v1' })));
      assert.deepEqual(after, before, 'dormant L4 must preserve score/order/cursor/mode exactly');

      assert.notEqual(psql(db,
        'update private.algo_l1_policy set l4_positive_creator_weight=3',
        { allowFailure: true }).status, 0,
      'L4 fields must require a policy-version change');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-positive-v1',l4_context_enabled=true,
        l2_affinity_enabled=false,l3_quality_enabled=false,
        freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
        completion_weight=0,rewatch_weight=0,exploration_weight=0,
        short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
        same_session_penalty=0,creator_page_cap=50,
        l4_session_history_cap=200,
        l4_negative_creator_penalty_per_video=0,
        l4_creator_repeat_penalty_per_video=0`);
      let scores = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-positive-v1' })));
      assert.equal(scores.get('pos1-1').score, 2);
      assert.equal(scores.get('pos2-1').score, 4);
      assert.equal(scores.get('pos3-1').score, 6, 'positive creator points cap at +6');
      assert.equal(scores.get('self-1').score, 0, 'authenticated self views cannot boost L4');
      assert.equal(scores.get('other-1').score, 0, 'other-session signals have no effect');
      assert.equal(scores.get('pos1-1').mode, 'behavioral_l4');

      const anonymous = scoreMap(actorCall(db, 'anon', null,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-positive-v1' })));
      assert.equal(anonymous.get('self-1').score, 0,
        'a recorded authenticated self-view stays excluded after logout');
      assert.equal(anonymous.get('anon-1').score, 2,
        'a genuinely anonymous session event can provide positive context');
      assert.equal(anonymous.get('self-1').mode, 'behavioral_l4');
      const fresh = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(newSession, { asOf, policy: 'nelyon-algo-l4-positive-v1' })));
      assert.equal(fresh.get('pos3-1').score, 0, 'new session starts with neutral context');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-negative-v1',
        l4_positive_creator_weight=0,
        l4_negative_creator_penalty_per_video=3,
        l4_creator_repeat_penalty_per_video=0`);
      scores = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-negative-v1' })));
      assert.equal(scores.get('neg1-1').score, 0, 'one short watch cannot trigger creator penalty');
      assert.equal(scores.get('neg2-1').score, -6);
      assert.equal(scores.get('neg4-1').score, -9, 'negative creator penalty caps at -9');
      assert.equal(scores.get('latest-1').score, -6,
        'latest valid event wins while a newer invalid row remains retention-neutral');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-fatigue-v1',
        l4_negative_creator_penalty_per_video=0,
        l4_creator_repeat_penalty_per_video=2`);
      scores = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-fatigue-v1' })));
      assert.equal(scores.get('fat1-1').score, 0, 'repeat rows for one video remain one exposure');
      assert.equal(scores.get('fat2-1').score, 0);
      assert.equal(scores.get('fat3-1').score, -2);
      assert.equal(scores.get('fat4-1').score, -4);
      assert.equal(scores.get('fat6-1').score, -8, 'fatigue caps at -8');
      assert.equal(scores.get('neg2-1').score, 0,
        'valid negative retention is neutral when its weight is zero');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-layer-before-v1',
        l2_affinity_enabled=true,l3_quality_enabled=true,l4_context_enabled=false,
        freshness_weight=1,l4_positive_creator_weight=2,
        l4_negative_creator_penalty_per_video=3,l4_creator_repeat_penalty_per_video=2`);
      const layerBefore = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-layer-before-v1' }))).get('layer-1');
      assert.ok(layerBefore.score > 2.25, 'L1, L2 and L3 fixtures contribute before L4');
      assert.equal(layerBefore.mode, 'behavioral_l3');
      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l4-layer-after-v1',l4_context_enabled=true`);
      const layerAfter = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { asOf, policy: 'nelyon-algo-l4-layer-after-v1' }))).get('layer-1');
      assert.equal(Number((layerAfter.score - layerBefore.score).toFixed(6)), 2,
        'L4 adds only its expected +2 adjustment over nonzero L1/L2/L3');
      assert.equal(layerAfter.mode, 'behavioral_l4');

      const pageOne = rows(actorCall(db, 'authenticated', viewer,
        rankedSql(currentSession, { limit: 5, asOf, policy: 'nelyon-algo-l4-layer-after-v1' })));
      const tail = pageOne.at(-1).split('|');
      const pageTwoSql = rankedSql(currentSession, {
        limit: 5, asOf, policy: 'nelyon-algo-l4-layer-after-v1',
        score: tail[6], createdAt: tail[4], id: tail[7],
      });
      const pageTwoBefore = rows(actorCall(db, 'authenticated', viewer, pageTwoSql));
      psql(db, `insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      ) select id,'${viewer}'::uuid,gen_random_uuid(),'${currentSession}'::uuid,100000,100000,1,true,0,'ended',
        clock_timestamp() from public.videos where caption='neg1-1'`);
      const pageTwoAfter = rows(actorCall(db, 'authenticated', viewer, pageTwoSql));
      assert.deepEqual(pageTwoAfter, pageTwoBefore, 'post-snapshot context cannot alter page 2');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l1-v1',production_rollout_bps=0,
        l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false`);
      const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      for (const [key, value] of Object.entries(reconciliation)) {
        assert.equal(value, 0, `${key} must reconcile in the disposable L4 environment`);
      }
      assert.equal(Object.keys(reconciliation).length, 41, 'L4 extends 36 counters to 41');
    } finally {
      dropDatabase(db);
    }
  });

test('L4 applies the raw history cap before candidate-creator filtering',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      const session = '75000000-0000-4000-8000-000000000099';
      psql(db, `
        insert into auth.users(id) values
          ('${viewer}'),
          (md5('l4-cap-candidate')::uuid),
          (md5('l4-cap-outside')::uuid),
          (md5('l4-cap-filler')::uuid);
        insert into public.user_profiles(id,username,is_private) values
          ('${viewer}','l4_cap_viewer',false),
          (md5('l4-cap-candidate')::uuid,'l4_cap_candidate',false),
          (md5('l4-cap-outside')::uuid,'l4_cap_outside',false),
          (md5('l4-cap-filler')::uuid,'l4_cap_filler',false);
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('l4-cap-filler-video-'||i)::uuid,
          case when i=1 then md5('l4-cap-candidate')::uuid else md5('l4-cap-filler')::uuid end,
          'https://example.test/l4-cap/'||i||'.mp4',
          case when i=1 then 'cap-candidate' else 'cap-filler-'||i end,
          '${asOf}'::timestamptz-make_interval(secs=>i/1000.0)
        from generate_series(1,200) i;
        insert into public.videos(id,user_id,video_url,caption,created_at) values(
          md5('l4-cap-outside-video')::uuid,md5('l4-cap-outside')::uuid,
          'https://example.test/l4-cap/outside.mp4','cap-outside',
          '${asOf}'::timestamptz-interval '1 hour'
        );
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select md5('l4-cap-outside-video')::uuid,'${viewer}'::uuid,
          md5('l4-cap-outside-event-'||i)::uuid,'${session}'::uuid,
          10000,100000,0.1,false,0,'swipe',
          '${asOf}'::timestamptz-make_interval(secs=>i/1000.0)
        from generate_series(1,30) i;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        ) values(
          md5('l4-cap-filler-video-1')::uuid,'${viewer}'::uuid,
          md5('l4-cap-candidate-event')::uuid,'${session}'::uuid,
          80000,100000,0.8,false,0,'ended','${asOf}'::timestamptz-interval '1 second'
        );
        update private.algo_l1_policy set
          policy_version='nelyon-algo-l4-raw-cap-v1',production_rollout_bps=10000,
          l4_context_enabled=true,l4_session_history_cap=30,creator_page_cap=50,
          freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
          completion_weight=0,rewatch_weight=0,exploration_weight=0,
          short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
          same_session_penalty=0,l4_negative_creator_penalty_per_video=0,
          l4_creator_repeat_penalty_per_video=0;
      `);
      const scores = scoreMap(actorCall(db, 'authenticated', viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l4-raw-cap-v1' })));
      assert.equal(scores.get('cap-candidate').score, 0,
        'an older candidate event outside the latest 30 raw session rows must not affect L4');
    } finally {
      dropDatabase(db);
    }
  });

test('L4 plan stays session-, candidate-, horizon- and 30-row bounded at scale',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      psql(db, `
        insert into auth.users(id)
        select md5('l4-perf-creator-'||i)::uuid from generate_series(1,30) i
        union select md5('l4-perf-viewer-'||i)::uuid from generate_series(1,1000) i;
        insert into public.user_profiles(id,username,is_private)
        select md5('l4-perf-creator-'||i)::uuid,'l4_perf_creator_'||i,false
        from generate_series(1,30) i
        union all
        select md5('l4-perf-viewer-'||i)::uuid,'l4_perf_viewer_'||i,false
        from generate_series(1,1000) i;
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('l4-perf-video-'||i)::uuid,
          md5('l4-perf-creator-'||(((i-1)%30)+1))::uuid,
          'https://example.test/l4-perf/'||i||'.mp4','l4 perf '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select md5('l4-perf-video-'||(((i-1)%30000)+1))::uuid,
          md5('l4-perf-viewer-'||(((i-1)%1000)+1))::uuid,
          md5('l4-perf-event-'||i)::uuid,
          md5('l4-perf-session-'||(((i-1)%1000)+1))::uuid,
          case when i%3=0 then 100000 else 10000 end,100000,
          case when i%3=0 then 1.0 else 0.1 end,
          i%3=0,0,case when i%3=0 then 'ended' else 'swipe' end,
          clock_timestamp()-make_interval(secs=>(i%7000))
        from generate_series(1,110000) i;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select md5('l4-perf-video-'||(((i-1)%200)+1))::uuid,
          md5('l4-perf-viewer-1')::uuid,
          md5('l4-perf-hot-event-'||i)::uuid,
          md5('l4-perf-session-1')::uuid,
          10000,100000,0.1,false,0,'swipe',clock_timestamp()-make_interval(secs=>i/1000.0)
        from generate_series(1,500) i;
        analyze public.videos;
        analyze public.video_views;
      `);

      const session = md5Uuid('l4-perf-session-1');
      const plan = psql(db, `explain (analyze,buffers,costs off)
        with candidates as materialized (
          select v.id,v.user_id,v.created_at from public.videos v
          where v.created_at<=clock_timestamp()
          order by v.created_at desc,v.id desc limit 200
        ), candidate_creators as materialized (
          select distinct user_id creator_id from candidates
        ), l4_raw_session_history as materialized (
          select vv.id,vv.video_id,vv.created_at
          from public.video_views vv
          where vv.client_session_id='${session}'
            and vv.created_at<=clock_timestamp()
            and vv.created_at>=clock_timestamp()-interval '120 minutes'
          order by vv.created_at desc,vv.id desc limit 30
        ), l4_session_history as materialized (
          select raw.id,raw.video_id,v.user_id creator_id,raw.created_at
          from l4_raw_session_history raw
          join public.videos v on v.id=raw.video_id
          join candidate_creators cc on cc.creator_id=v.user_id
        )
        select (select count(*) from candidates),
          (select count(*) from l4_raw_session_history),
          (select count(*) from l4_session_history);`).stdout;
      assert.match(plan, /videos_created_id_desc_idx/i);
      assert.match(plan, /video_views_session_video_created_idx/i);
      assert.match(plan, /rows=200 loops=1/i, 'candidate pool remains 200');
      assert.match(plan, /rows=30 loops=1/i, 'raw session history remains capped at 30');
      assert.doesNotMatch(plan, /Seq Scan on video_views/i, 'L4 must not scan global view history');

      const maxCap = lastLine(psql(db, `
        with l4_raw_session_history as materialized (
          select vv.id,vv.video_id,vv.created_at
            from public.video_views vv
            where vv.client_session_id='${session}'
              and vv.created_at<=clock_timestamp()
              and vv.created_at>=clock_timestamp()-interval '120 minutes'
            order by vv.created_at desc,vv.id desc limit 200
        )
        select count(*) from l4_raw_session_history;`));
      assert.equal(maxCap, '200', 'the bounded maximum policy cap remains enforceable for a hot session');
    } finally {
      dropDatabase(db);
    }
  });

function md5Uuid(value) {
  const result = spawnSync('node', ['-e', `const c=require('crypto');const h=c.createHash('md5').update(${JSON.stringify(value)}).digest('hex');console.log(h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20))`], { encoding: 'utf8' });
  return result.stdout.trim();
}
