import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L1_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L1_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L1_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: '31000000-0000-4000-8000-000000000001',
  creatorA: '31000000-0000-4000-8000-000000000002',
  creatorB: '31000000-0000-4000-8000-000000000003',
  creatorC: '31000000-0000-4000-8000-000000000004',
  privateCreator: '31000000-0000-4000-8000-000000000005',
  blockedCreator: '31000000-0000-4000-8000-000000000006',
  admin: '31000000-0000-4000-8000-000000000007',
  videoA1: '32000000-0000-4000-8000-000000000001',
  videoA2: '32000000-0000-4000-8000-000000000002',
  videoA3: '32000000-0000-4000-8000-000000000003',
  videoA4: '32000000-0000-4000-8000-000000000004',
  videoB1: '32000000-0000-4000-8000-000000000011',
  videoB2: '32000000-0000-4000-8000-000000000012',
  videoC1: '32000000-0000-4000-8000-000000000021',
  videoC2: '32000000-0000-4000-8000-000000000022',
  privateVideo: '32000000-0000-4000-8000-000000000031',
  blockedVideo: '32000000-0000-4000-8000-000000000032',
  moderatedVideo: '32000000-0000-4000-8000-000000000033',
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
    `set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${actor ?? ''}';` +
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
  const f0Sql = migration('_algo6_l1_f0_signal_eligibility_foundation.sql');
  const l1Sql = migration('_algo6_l1_behavioral_ranking.sql');
  const db = `algo6_l1_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  psql(db, f0Sql);
  psql(db, l1Sql);
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 10,
  asOf = null,
  score = null,
  createdAt = null,
  id = null,
  policy = null,
  projection = "id||'|'||user_id||'|'||ranking_mode||'|'||policy_version||'|'||rank_score||'|'||feed_as_of",
} = {}) {
  const v = value => value == null ? 'null' : `'${value}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${v(asOf)},${score == null ? 'null' : score},` +
    `${v(createdAt)},${v(id)},${v(policy)})`;
}

function seed(db) {
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18)
    on conflict(singleton) do nothing;

    insert into auth.users(id)
    select id from (values
      ('${ids.viewer}'::uuid),('${ids.creatorA}'::uuid),('${ids.creatorB}'::uuid),
      ('${ids.creatorC}'::uuid),('${ids.privateCreator}'::uuid),('${ids.blockedCreator}'::uuid)
      ,('${ids.admin}'::uuid)
    ) x(id) on conflict do nothing;

    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','l1_viewer',false),
      ('${ids.creatorA}','l1_creator_a',false),
      ('${ids.creatorB}','l1_creator_b',false),
      ('${ids.creatorC}','l1_creator_c',false),
      ('${ids.privateCreator}','l1_private',true),
      ('${ids.blockedCreator}','l1_blocked',false);

    insert into public.follows(follower_id,following_id,created_at)
      values('${ids.viewer}','${ids.creatorA}',clock_timestamp() - interval '1 day');
    insert into public.blocked_users(blocker_id,blocked_id)
      values('${ids.viewer}','${ids.blockedCreator}');

    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.videoA1}','${ids.creatorA}','https://example.test/a1.mp4','a1',clock_timestamp() - interval '1 minute'),
      ('${ids.videoA2}','${ids.creatorA}','https://example.test/a2.mp4','a2',clock_timestamp() - interval '2 minutes'),
      ('${ids.videoA3}','${ids.creatorA}','https://example.test/a3.mp4','a3',clock_timestamp() - interval '3 minutes'),
      ('${ids.videoA4}','${ids.creatorA}','https://example.test/a4.mp4','a4',clock_timestamp() - interval '4 minutes'),
      ('${ids.videoB1}','${ids.creatorB}','https://example.test/b1.mp4','b1',clock_timestamp() - interval '5 minutes'),
      ('${ids.videoB2}','${ids.creatorB}','https://example.test/b2.mp4','b2',clock_timestamp() - interval '6 minutes'),
      ('${ids.videoC1}','${ids.creatorC}','https://example.test/c1.mp4','c1',clock_timestamp() - interval '7 minutes'),
      ('${ids.videoC2}','${ids.creatorC}','https://example.test/c2.mp4','c2',clock_timestamp() - interval '8 minutes'),
      ('${ids.privateVideo}','${ids.privateCreator}','https://example.test/private.mp4','private',clock_timestamp() - interval '9 minutes'),
      ('${ids.blockedVideo}','${ids.blockedCreator}','https://example.test/blocked.mp4','blocked',clock_timestamp() - interval '10 minutes'),
      ('${ids.moderatedVideo}','${ids.creatorB}','https://example.test/moderated.mp4','moderated',clock_timestamp() - interval '11 minutes');

    insert into private.admin_capabilities(
      capability_code,domain,effect,description,is_sensitive
    ) values(
      'content.items.hide','content','workflow','Disposable L1 moderation fixture',true
    ) on conflict(capability_code) do nothing;

    with action as (
      insert into private.admin_content_moderation_actions(
        actor_id,actor_role_snapshot,actor_capability,target_type,target_id,action,reason,
        idempotency_scope,idempotency_key,request_fingerprint,
        visibility_before,visibility_after,result
      ) values(
        '${ids.admin}','{}','content.items.hide','video','${ids.moderatedVideo}',
        'hide','l1 test','l1|moderation|${ids.moderatedVideo}',gen_random_uuid(),repeat('b',64),
        'visible','hidden','succeeded'
      ) returning id
    )
    insert into private.admin_content_moderation_state(
      target_type,target_id,visibility,last_action_id
    ) select 'video','${ids.moderatedVideo}','hidden',id from action;
  `);
}

test('L1 database ranks eligible organic candidates deterministically and securely', { skip: !enabled, timeout: 180000 }, () => {
  const db = createDatabase();
  const session = '33000000-0000-4000-8000-000000000001';
  try {
    seed(db);

    const policy = lastLine(psql(db, `
      select policy_version||'|'||enabled||'|'||production_rollout_bps||'|'||
        candidate_pool_size||'|'||max_page_size||'|'||freshness_horizon_hours||'|'||
        freshness_weight||'|'||follow_weight||'|'||like_weight||'|'||comment_weight||'|'||
        save_weight||'|'||completion_weight||'|'||rewatch_weight||'|'||exploration_weight||'|'||
        short_watch_ratio_threshold||'|'||short_watch_penalty||'|'||
        recent_completed_penalty||'|'||repeat_view_penalty||'|'||
        repeat_view_penalty_cap||'|'||same_session_penalty||'|'||
        minimum_watch_samples||'|'||creator_page_cap||'|'||cursor_ttl_minutes
      from private.algo_l1_policy
    `));
    assert.equal(policy, 'nelyon-algo-l1-v1|true|0|200|50|168|30.000000|20.000000|8.000000|10.000000|12.000000|12.000000|6.000000|5.000000|0.200000|35.000000|25.000000|5.000000|20.000000|100.000000|3|2|30');

    for (const role of ['anon', 'authenticated']) {
      assert.notEqual(actorCall(db, role, role === 'anon' ? null : ids.viewer,
        'select * from private.algo_l1_policy', { allowFailure: true }).status, 0);
      assert.notEqual(actorCall(db, role, role === 'anon' ? null : ids.viewer,
        'update private.algo_l1_policy set production_rollout_bps=10000', { allowFailure: true }).status, 0);
    }

    const chronological = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||ranking_mode||'|'||rank_score" })));
    assert.ok(chronological.length >= 8);
    assert.ok(chronological.every(row => row.includes('|chronological|0.000000')));
    assert.equal(chronological[0].split('|')[0], ids.videoA1);
    for (const hidden of [ids.privateVideo, ids.blockedVideo, ids.moderatedVideo]) {
      assert.ok(chronological.every(row => !row.startsWith(hidden)), hidden);
    }

    psql(db, `update private.algo_l1_policy set
      production_rollout_bps=10000,
      freshness_weight=0, follow_weight=20,
      like_weight=0, comment_weight=0, save_weight=0,
      completion_weight=0, rewatch_weight=0, exploration_weight=0,
      short_watch_penalty=0, recent_completed_penalty=0,
      repeat_view_penalty=0, same_session_penalty=0;`);
    const followed = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    const scoreMap = new Map(followed.map(row => {
      const [id, score] = row.split('|');
      return [id, Number(score)];
    }));
    assert.equal(scoreMap.get(ids.videoA1) - scoreMap.get(ids.videoB1), 20);

    psql(db, `update private.algo_l1_policy set
      follow_weight=0, freshness_weight=30, exploration_weight=0;`);
    const fresh = rows(actorCall(db, 'anon', null,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    const freshMap = new Map(fresh.map(row => {
      const [id, score] = row.split('|');
      return [id, Number(score)];
    }));
    assert.ok(freshMap.get(ids.videoA1) > freshMap.get(ids.videoB1));

    psql(db, `
      update private.algo_l1_policy set
        freshness_weight=0, like_weight=8, comment_weight=10, save_weight=12,
        exploration_weight=0;
      insert into auth.users(id)
      select ('34000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
      from generate_series(1,10) i on conflict do nothing;
      insert into public.user_profiles(id,username,is_private)
      select ('34000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
             'signal_'||i,false
      from generate_series(1,10) i;
      insert into public.likes(video_id,user_id,created_at)
      select '${ids.videoB1}',id,clock_timestamp() - interval '1 minute'
      from public.user_profiles where username like 'signal_%';
      insert into public.comments(video_id,user_id,text,created_at)
      select '${ids.videoB2}',id,'signal',clock_timestamp() - interval '1 minute'
      from public.user_profiles where username like 'signal_%';
      insert into public.video_saves(video_id,user_id,created_at)
      select '${ids.videoC1}',id,clock_timestamp() - interval '1 minute'
      from public.user_profiles where username like 'signal_%';
    `);
    const engagement = rows(actorCall(db, 'anon', null,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    const engagementMap = new Map(engagement.map(row => {
      const [id, score] = row.split('|');
      return [id, Number(score)];
    }));
    assert.equal(engagementMap.get(ids.videoB1), 4.156590);
    assert.equal(engagementMap.get(ids.videoB2), 5.195737);
    assert.equal(engagementMap.get(ids.videoC1), 6.234884);

    psql(db, `
      update private.algo_l1_policy set
        like_weight=0,comment_weight=0,save_weight=0,
        completion_weight=12,rewatch_weight=6;
      insert into public.video_views(
        video_id,client_event_id,client_session_id,watch_duration_ms,media_duration_ms,
        completion_ratio,completed,rewatch_count,exit_reason,created_at
      )
      select '${ids.videoB1}',gen_random_uuid(),gen_random_uuid(),10000,10000,
             1.000000,true,0,'ended',clock_timestamp() - interval '1 minute'
      from generate_series(1,3);
      insert into public.video_views(
        video_id,client_event_id,client_session_id,watch_duration_ms,media_duration_ms,
        completion_ratio,completed,rewatch_count,exit_reason,created_at
      )
      values('${ids.videoB2}',gen_random_uuid(),gen_random_uuid(),20000,10000,
             2.000000,true,1,'ended',clock_timestamp() - interval '1 minute');
    `);
    const quality = rows(actorCall(db, 'anon', null,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    const qualityMap = new Map(quality.map(row => {
      const [id, score] = row.split('|');
      return [id, Number(score)];
    }));
    assert.equal(qualityMap.get(ids.videoB1), 12);
    assert.equal(qualityMap.get(ids.videoB2), 0, 'one sample must not establish watch quality');

    psql(db, `
      insert into public.video_views(
        video_id,client_event_id,client_session_id,watch_duration_ms,media_duration_ms,
        completion_ratio,completed,rewatch_count,exit_reason,created_at
      )
      select '${ids.videoB2}',gen_random_uuid(),gen_random_uuid(),20000,10000,
             2.000000,true,1,'ended',clock_timestamp() - interval '1 minute'
      from generate_series(1,2);
    `);
    const rewatch = rows(actorCall(db, 'anon', null,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    const rewatchMap = new Map(rewatch.map(row => {
      const [id, score] = row.split('|');
      return [id, Number(score)];
    }));
    assert.equal(rewatchMap.get(ids.videoB2), 18);

    psql(db, `
      update private.algo_l1_policy set
        completion_weight=0,rewatch_weight=0,same_session_penalty=100,
        short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0;
      insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      ) values(
        '${ids.videoA1}','${ids.viewer}',gen_random_uuid(),'${session}',5000,
        10000,0.500000,false,0,'unknown',clock_timestamp() - interval '1 minute'
      );
    `);
    const sameSession = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    assert.equal(Number(sameSession.find(row => row.startsWith(ids.videoA1)).split('|')[1]), -100);

    psql(db, `
      update private.algo_l1_policy set
        same_session_penalty=0,short_watch_penalty=35,
        recent_completed_penalty=0,repeat_view_penalty=0;
      insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      ) values(
        '${ids.videoA2}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,
        10000,0.100000,false,0,'swipe',clock_timestamp() - interval '1 minute'
      );
    `);
    const shortWatch = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    assert.equal(Number(shortWatch.find(row => row.startsWith(ids.videoA2)).split('|')[1]), -35);

    psql(db, `
      update private.algo_l1_policy set
        short_watch_penalty=0,recent_completed_penalty=25;
      insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      ) values(
        '${ids.videoA3}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),10000,
        10000,1.000000,true,0,'ended',clock_timestamp() - interval '1 minute'
      );
    `);
    const completed = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    assert.equal(Number(completed.find(row => row.startsWith(ids.videoA3)).split('|')[1]), -25);

    psql(db, `
      update private.algo_l1_policy set
        recent_completed_penalty=0,repeat_view_penalty=5,repeat_view_penalty_cap=20;
      insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        rewatch_count,exit_reason,created_at
      )
      select '${ids.videoA4}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,
             0,'unknown',clock_timestamp() - interval '1 minute'
      from generate_series(1,7);
    `);
    const repeat = rows(actorCall(db, 'authenticated', ids.viewer,
      rankedSql(session, { projection: "id||'|'||rank_score", limit: 20 })));
    assert.equal(Number(repeat.find(row => row.startsWith(ids.videoA4)).split('|')[1]), -20);

    psql(db, `update private.algo_l1_policy set
      repeat_view_penalty=0, exploration_weight=5, creator_page_cap=2;`);
    const anonFirst = rows(actorCall(db, 'anon', null,
      rankedSql('33000000-0000-4000-8000-000000000002', {
        projection: "id||'|'||rank_score||'|'||feed_as_of||'|'||policy_version",
        limit: 6,
      })));
    assert.equal(anonFirst.length, 6);
    const creatorCounts = new Map();
    const diverse = rows(actorCall(db, 'anon', null,
      rankedSql('33000000-0000-4000-8000-000000000002', {
        projection: "user_id",
        limit: 6,
      })));
    for (const creator of diverse) creatorCounts.set(creator, (creatorCounts.get(creator) ?? 0) + 1);
    assert.ok([...creatorCounts.values()].every(count => count <= 2));

    const pageOne = rows(actorCall(db, 'anon', null,
      rankedSql('33000000-0000-4000-8000-000000000003', {
        projection: "id||'|'||rank_score||'|'||feed_as_of||'|'||policy_version||'|'||cursor_created_at",
        limit: 3,
      })));
    const [cursorId, cursorScore, asOf, policyVersion, cursorCreatedAt] = pageOne.at(-1).split('|');
    const pageTwoSql = rankedSql('33000000-0000-4000-8000-000000000003', {
      asOf,
      score: cursorScore,
      createdAt: cursorCreatedAt,
      id: cursorId,
      policy: policyVersion,
      projection: "id||'|'||rank_score||'|'||feed_as_of",
      limit: 3,
    });
    const pageTwoA = rows(actorCall(db, 'anon', null, pageTwoSql));
    const pageTwoB = rows(actorCall(db, 'anon', null, pageTwoSql));
    assert.deepEqual(pageTwoA, pageTwoB);
    assert.ok(pageTwoA.every(row => row.endsWith(`|${asOf}`)));
    assert.equal(new Set([...pageOne.map(row => row.split('|')[0]), ...pageTwoA.map(row => row.split('|')[0])]).size,
      pageOne.length + pageTwoA.length);

    assert.notEqual(actorCall(db, 'anon', null, rankedSql(session, {
      asOf: new Date(Date.now() + 60_000).toISOString(),
      score: 0,
      createdAt: new Date().toISOString(),
      id: ids.videoA1,
      policy: 'nelyon-algo-l1-v1',
    }), { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'anon', null, rankedSql(session, {
      asOf: new Date(Date.now() - 31 * 60_000).toISOString(),
      score: 0,
      createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      id: ids.videoA1,
      policy: 'nelyon-algo-l1-v1',
    }), { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'anon', null, rankedSql(session, {
      asOf,
      score: 0,
      createdAt: cursorCreatedAt,
      id: cursorId,
      policy: 'wrong-policy',
    }), { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'anon', null,
      rankedSql(session, { limit: 0 }), { allowFailure: true }).status, 0);

    psql(db, `update public.user_profiles set is_private=true
      where id in ('${ids.creatorB}','${ids.creatorC}','${ids.blockedCreator}');`);
    const singleCreator = rows(actorCall(db, 'anon', null,
      rankedSql('33000000-0000-4000-8000-000000000004', {
        projection: 'user_id',
        limit: 4,
    }))); 
    assert.equal(singleCreator.length, 4, 'fill pass must keep a small catalog useful');
    assert.deepEqual(singleCreator, Array(4).fill(ids.creatorA));

    psql(db, `update private.algo_l1_policy set production_rollout_bps=0;`);
    assert.notEqual(actorCall(db, 'anon', null,
      'select public.reconcile_algo_l1_v1()', { allowFailure: true }).status, 0);
    assert.equal(lastLine(actorCall(db, 'service_role', null,
      `select bool_and(value::text='0') from jsonb_each(public.reconcile_algo_l1_v1())`)), 't');
  } finally {
    dropDatabase(db);
  }
});

test('L1 query plan stays bounded and index-backed at representative synthetic volume', { skip: !enabled, timeout: 180000 }, () => {
  const db = createDatabase();
  const session = '33000000-0000-4000-8000-000000000099';
  try {
    psql(db, `
      insert into private.age_eligibility_policy(
        singleton,minimum_age,policy_version,creator_exclusive_minimum_age
      ) values(true,13,'nelyon-age-v2',18)
      on conflict(singleton) do nothing;

      insert into auth.users(id)
      select ('35000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
      from generate_series(1,25) i
      union all
      select ('36000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
      from generate_series(1,100) i;

      insert into public.user_profiles(id,username,is_private)
      select ('35000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
             'perf_creator_'||i,false
      from generate_series(1,25) i
      union all
      select ('36000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
             'perf_viewer_'||i,false
      from generate_series(1,100) i;

      insert into public.videos(id,user_id,video_url,caption,created_at)
      select ('37000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
             ('35000000-0000-4000-8000-'||lpad((((i-1)%25)+1)::text,12,'0'))::uuid,
             'https://example.test/perf/'||i||'.mp4','perf '||i,
             clock_timestamp() - make_interval(secs => i)
      from generate_series(1,3000) i;

      insert into public.likes(video_id,user_id,created_at)
      select ('37000000-0000-4000-8000-'||lpad(v::text,12,'0'))::uuid,
             ('36000000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,
             clock_timestamp() - interval '1 hour'
      from generate_series(1,3000) v cross join generate_series(1,5) u;

      insert into public.comments(video_id,user_id,text,created_at)
      select ('37000000-0000-4000-8000-'||lpad((((i-1)%3000)+1)::text,12,'0'))::uuid,
             ('36000000-0000-4000-8000-'||lpad((((i-1)%100)+1)::text,12,'0'))::uuid,
             'performance signal',clock_timestamp() - interval '1 hour'
      from generate_series(1,12000) i;

      insert into public.video_saves(video_id,user_id,created_at)
      select ('37000000-0000-4000-8000-'||lpad(v::text,12,'0'))::uuid,
             ('36000000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,
             clock_timestamp() - interval '1 hour'
      from generate_series(1,3000) v cross join generate_series(1,3) u;

      insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      )
      select ('37000000-0000-4000-8000-'||lpad((((i-1)%3000)+1)::text,12,'0'))::uuid,
             ('36000000-0000-4000-8000-'||lpad((((i-1)%100)+1)::text,12,'0'))::uuid,
             gen_random_uuid(),gen_random_uuid(),5000,10000,0.500000,false,0,'swipe',
             clock_timestamp() - make_interval(secs => i%3600)
      from generate_series(1,30000) i;

      analyze public.videos;
      analyze public.likes;
      analyze public.comments;
      analyze public.video_saves;
      analyze public.video_views;
      update private.algo_l1_policy set production_rollout_bps=10000;
    `);

    const candidatePlan = psql(db, `
      explain(analyze,buffers,costs off)
      select v.id
      from public.videos v
      join public.user_profiles up on up.id=v.user_id
      where v.created_at <= '2100-01-01T00:00:00Z'::timestamptz
        and private.admin_content_is_visible('video',v.id)
        and private.video_can_view_owner(v.user_id)
      order by v.created_at desc,v.id desc
      limit 200;
    `).stdout;
    assert.match(candidatePlan, /videos_created_id_desc_idx/i);
    assert.match(candidatePlan, /limit/i);

    const behaviorPlan = psql(db, `
      explain(analyze,buffers,costs off)
      with candidates as materialized(
        select id from public.videos
        order by created_at desc,id desc limit 200
      )
      select c.id,aggregate.raw_views
      from candidates c
      cross join lateral(
        select count(*) as raw_views
        from public.video_views vv
        where vv.video_id=c.id
          and vv.created_at <= '2100-01-01T00:00:00Z'::timestamptz
      ) aggregate;
    `).stdout;
    assert.match(behaviorPlan, /video_views_video_created_idx/i);

    const functionPlan = actorCall(db, 'anon', null, `
      explain(analyze,buffers,costs off)
      select * from public.get_ranked_feed_l1_v1(
        '${session}',20,null,null,null,null,null
      )
    `).stdout;
    assert.match(functionPlan, /function scan on get_ranked_feed_l1_v1/i);
    assert.match(functionPlan, /actual time=[^\n]*rows=20/i);
    assert.doesNotMatch(functionPlan, /never executed/i);
  } finally {
    dropDatabase(db);
  }
});
