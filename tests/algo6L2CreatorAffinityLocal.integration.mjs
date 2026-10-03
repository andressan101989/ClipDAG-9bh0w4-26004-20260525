import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L2_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L2_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L2_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: '51000000-0000-4000-8000-000000000001',
  likeCreator: '51000000-0000-4000-8000-000000000002',
  commentCreator: '51000000-0000-4000-8000-000000000003',
  saveCreator: '51000000-0000-4000-8000-000000000004',
  longCreator: '51000000-0000-4000-8000-000000000005',
  completedCreator: '51000000-0000-4000-8000-000000000006',
  rewatchCreator: '51000000-0000-4000-8000-000000000007',
  capCreator: '51000000-0000-4000-8000-000000000008',
  oneShortCreator: '51000000-0000-4000-8000-000000000009',
  twoShortCreator: '51000000-0000-4000-8000-000000000010',
  negativeCapCreator: '51000000-0000-4000-8000-000000000011',
  unknownCreator: '51000000-0000-4000-8000-000000000012',
  halfCreator: '51000000-0000-4000-8000-000000000013',
  futureCreator: '51000000-0000-4000-8000-000000000014',
  oldCreator: '51000000-0000-4000-8000-000000000015',
  outsideCreator: '51000000-0000-4000-8000-000000000016',
  parityCreator: '51000000-0000-4000-8000-000000000017',
  likeVideo: '52000000-0000-4000-8000-000000000002',
  commentVideo: '52000000-0000-4000-8000-000000000003',
  saveVideo: '52000000-0000-4000-8000-000000000004',
  longVideo: '52000000-0000-4000-8000-000000000005',
  completedVideo: '52000000-0000-4000-8000-000000000006',
  rewatchVideo: '52000000-0000-4000-8000-000000000007',
  capVideo1: '52000000-0000-4000-8000-000000000008',
  capVideo2: '52000000-0000-4000-8000-000000000009',
  capVideo3: '52000000-0000-4000-8000-000000000010',
  oneShortVideo: '52000000-0000-4000-8000-000000000011',
  twoShortVideo1: '52000000-0000-4000-8000-000000000012',
  twoShortVideo2: '52000000-0000-4000-8000-000000000013',
  unknownVideo1: '52000000-0000-4000-8000-000000000014',
  unknownVideo2: '52000000-0000-4000-8000-000000000015',
  halfVideo: '52000000-0000-4000-8000-000000000016',
  futureVideo: '52000000-0000-4000-8000-000000000017',
  oldVideo: '52000000-0000-4000-8000-000000000018',
  selfVideo: '52000000-0000-4000-8000-000000000019',
  outsideVideo: '52000000-0000-4000-8000-000000000020',
  parityVideo: '52000000-0000-4000-8000-000000000021',
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
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

function createDatabase() {
  const db = `algo6_l2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
  limit = 250, asOf = null, score = null, createdAt = null, id = null, policy = null,
  projection = "id||'|'||rank_score||'|'||ranking_mode||'|'||policy_version||'|'||feed_as_of",
} = {}) {
  const value = item => item == null ? 'null' : `'${item}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${value(asOf)},${score == null ? 'null' : score},` +
    `${value(createdAt)},${value(id)},${value(policy)})`;
}

function snapshotSql(sessionId, asOf, policy, options = {}) {
  return rankedSql(sessionId, {
    ...options,
    asOf,
    score: options.score ?? 999999,
    createdAt: options.createdAt ?? '9999-12-31T23:59:59Z',
    id: options.id ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    policy,
  });
}

function scoreMap(result) {
  return new Map(rows(result).map(row => {
    const [id, score, mode] = row.split('|');
    return [id, { score: Number(score), mode }];
  }));
}

function approximately(actual, expected, epsilon = 0.00001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} must be approximately ${expected}`);
}

function seedBase(db) {
  const creatorEntries = Object.entries(ids).filter(([key]) => key.endsWith('Creator'));
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;

    insert into auth.users(id) values
      ('${ids.viewer}')${creatorEntries.map(([, id]) => `,('${id}')`).join('')};
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','l2_viewer',false)
      ${creatorEntries.map(([key, id]) => `,('${id}','l2_${key.toLowerCase()}',false)`).join('\n      ')};

    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.likeVideo}','${ids.likeCreator}','https://example.test/like.mp4','like',clock_timestamp()-interval '1 minute'),
      ('${ids.commentVideo}','${ids.commentCreator}','https://example.test/comment.mp4','comment',clock_timestamp()-interval '61 seconds'),
      ('${ids.saveVideo}','${ids.saveCreator}','https://example.test/save.mp4','save',clock_timestamp()-interval '62 seconds'),
      ('${ids.longVideo}','${ids.longCreator}','https://example.test/long.mp4','long',clock_timestamp()-interval '63 seconds'),
      ('${ids.completedVideo}','${ids.completedCreator}','https://example.test/completed.mp4','completed',clock_timestamp()-interval '64 seconds'),
      ('${ids.rewatchVideo}','${ids.rewatchCreator}','https://example.test/rewatch.mp4','rewatch',clock_timestamp()-interval '65 seconds'),
      ('${ids.capVideo1}','${ids.capCreator}','https://example.test/cap1.mp4','cap1',clock_timestamp()-interval '66 seconds'),
      ('${ids.capVideo2}','${ids.capCreator}','https://example.test/cap2.mp4','cap2',clock_timestamp()-interval '67 seconds'),
      ('${ids.capVideo3}','${ids.capCreator}','https://example.test/cap3.mp4','cap3',clock_timestamp()-interval '68 seconds'),
      ('${ids.oneShortVideo}','${ids.oneShortCreator}','https://example.test/one-short.mp4','one-short',clock_timestamp()-interval '69 seconds'),
      ('${ids.twoShortVideo1}','${ids.twoShortCreator}','https://example.test/two-short-1.mp4','two-short-1',clock_timestamp()-interval '70 seconds'),
      ('${ids.twoShortVideo2}','${ids.twoShortCreator}','https://example.test/two-short-2.mp4','two-short-2',clock_timestamp()-interval '71 seconds'),
      ('${ids.unknownVideo1}','${ids.unknownCreator}','https://example.test/unknown-1.mp4','unknown-1',clock_timestamp()-interval '72 seconds'),
      ('${ids.unknownVideo2}','${ids.unknownCreator}','https://example.test/unknown-2.mp4','unknown-2',clock_timestamp()-interval '73 seconds'),
      ('${ids.halfVideo}','${ids.halfCreator}','https://example.test/half.mp4','half',clock_timestamp()-interval '74 seconds'),
      ('${ids.futureVideo}','${ids.futureCreator}','https://example.test/future.mp4','future',clock_timestamp()-interval '75 seconds'),
      ('${ids.oldVideo}','${ids.oldCreator}','https://example.test/old.mp4','old',clock_timestamp()-interval '76 seconds'),
      ('${ids.selfVideo}','${ids.viewer}','https://example.test/self.mp4','self',clock_timestamp()-interval '77 seconds'),
      ('${ids.outsideVideo}','${ids.outsideCreator}','https://example.test/outside.mp4','outside',clock_timestamp()-interval '2 days'),
      ('${ids.parityVideo}','${ids.parityCreator}','https://example.test/parity.mp4','parity',clock_timestamp()-interval '78 seconds');

    insert into public.videos(id,user_id,video_url,caption,created_at)
    select ('54000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
           '${ids.negativeCapCreator}',
           'https://example.test/negative-cap/'||i||'.mp4','negative cap '||i,
           clock_timestamp()-interval '2 minutes'-make_interval(secs=>i)
    from generate_series(1,7) i;
  `);
}

test('L2 preserves L1 exactly when dormant and computes bounded creator affinity when enabled',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    const session = '55000000-0000-4000-8000-000000000001';
    const historicalRequest = '55000000-0000-4000-8000-000000000002';
    try {
      seedBase(db);
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));

      psql(db, `update private.algo_l1_policy set
        canary_enabled=true,
        canary_user_id='${ids.viewer}',
        canary_request_id='${historicalRequest}',
        canary_requested_at='${asOf}'::timestamptz-interval '2 minutes',
        canary_armed_at='${asOf}'::timestamptz-interval '1 minute',
        canary_expires_at='${asOf}'::timestamptz+interval '20 minutes',
        canary_generation=2;`);

      const parityPolicy = 'nelyon-algo-l1-v1|canary:2:active';
      const beforeL2 = rows(actorCall(db, 'authenticated', ids.viewer,
        snapshotSql(session, asOf, parityPolicy, { limit: 50 })));
      assert.ok(beforeL2.length > 0);

      psql(db, 'update private.algo_l1_policy set canary_enabled=false');
      psql(db, migration('_algo6_l2_creator_affinity.sql'));
      assert.equal(lastLine(psql(db, `select
        policy_version||'|'||l2_affinity_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_generation||'|'||canary_request_id
        from private.algo_l1_policy`)),
      `nelyon-algo-l1-v1|false|0|false|2|${historicalRequest}`,
      'L2 migration must preserve dormant L1 behavior and historical canary state');

      psql(db, 'update private.algo_l1_policy set canary_enabled=true');
      const afterL2 = rows(actorCall(db, 'authenticated', ids.viewer,
        snapshotSql(session, asOf, parityPolicy, { limit: 50 })));
      assert.deepEqual(afterL2, beforeL2,
        'L2 disabled must preserve exact L1 mode, score, order, pagination, diversity and eligibility');
      psql(db, 'update private.algo_l1_policy set canary_enabled=false');

      assert.notEqual(psql(db,
        'update private.algo_l1_policy set l2_affinity_like_weight=2.5',
        { allowFailure: true }).status, 0,
      'L2 algorithmic configuration requires a policy version bump');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l2-test-v1',
        production_rollout_bps=10000,
        l2_affinity_enabled=true,
        freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
        completion_weight=0,rewatch_weight=0,exploration_weight=0,
        short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
        same_session_penalty=0,creator_page_cap=50;`);

      psql(db, `
        insert into public.likes(video_id,user_id,created_at) values
          ('${ids.likeVideo}','${ids.viewer}','${asOf}'),
          ('${ids.halfVideo}','${ids.viewer}','${asOf}'::timestamptz-interval '45 days'),
          ('${ids.futureVideo}','${ids.viewer}','${asOf}'::timestamptz+interval '1 second'),
          ('${ids.oldVideo}','${ids.viewer}','${asOf}'::timestamptz-interval '91 days'),
          ('${ids.selfVideo}','${ids.viewer}','${asOf}'),
          ('${ids.outsideVideo}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo1}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo2}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo3}','${ids.viewer}','${asOf}');
        insert into public.comments(video_id,user_id,text,created_at) values
          ('${ids.commentVideo}','${ids.viewer}','comment','${asOf}'),
          ('${ids.selfVideo}','${ids.viewer}','self','${asOf}'),
          ('${ids.capVideo1}','${ids.viewer}','cap1','${asOf}'),
          ('${ids.capVideo2}','${ids.viewer}','cap2','${asOf}'),
          ('${ids.capVideo3}','${ids.viewer}','cap3','${asOf}');
        insert into public.video_saves(video_id,user_id,created_at) values
          ('${ids.saveVideo}','${ids.viewer}','${asOf}'),
          ('${ids.selfVideo}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo1}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo2}','${ids.viewer}','${asOf}'),
          ('${ids.capVideo3}','${ids.viewer}','${asOf}');

        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        ) values
          ('${ids.longVideo}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),5000,10000,0.5,false,0,'swipe','${asOf}'),
          ('${ids.completedVideo}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),10000,10000,1,true,0,'ended','${asOf}'),
          ('${ids.rewatchVideo}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),20000,10000,2,true,1,'ended','${asOf}'),
          ('${ids.oneShortVideo}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'swipe','${asOf}'),
          ('${ids.twoShortVideo1}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'swipe','${asOf}'),
          ('${ids.twoShortVideo2}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'background','${asOf}'),
          ('${ids.unknownVideo1}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'unknown','${asOf}'),
          ('${ids.unknownVideo2}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'unknown','${asOf}'),
          ('${ids.selfVideo}','${ids.viewer}',gen_random_uuid(),gen_random_uuid(),20000,10000,2,true,1,'ended','${asOf}');

        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select ('54000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          '${ids.viewer}',gen_random_uuid(),gen_random_uuid(),1000,10000,0.1,false,0,'swipe','${asOf}'
        from generate_series(1,7) i;
      `);

      const scores = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        snapshotSql(session, asOf, 'nelyon-algo-l2-test-v1|canary:2:inactive')));
      for (const entry of scores.values()) assert.equal(entry.mode, 'behavioral_l2');
      approximately(scores.get(ids.likeVideo).score, 2);
      approximately(scores.get(ids.commentVideo).score, 3);
      approximately(scores.get(ids.saveVideo).score, 4);
      approximately(scores.get(ids.longVideo).score, 1);
      approximately(scores.get(ids.completedVideo).score, 3);
      approximately(scores.get(ids.rewatchVideo).score, 4);
      approximately(scores.get(ids.capVideo1).score, 18);
      approximately(scores.get(ids.halfVideo).score, 1);
      approximately(scores.get(ids.futureVideo).score, 0);
      approximately(scores.get(ids.oldVideo).score, 0);
      approximately(scores.get(ids.oneShortVideo).score, 0);
      approximately(scores.get(ids.twoShortVideo1).score, -3);
      approximately(scores.get(ids.twoShortVideo2).score, -3);
      approximately(scores.get(ids.unknownVideo1).score, 0);
      approximately(scores.get(ids.selfVideo).score, 0);

      const anonymous = scoreMap(actorCall(db, 'anon', null,
        snapshotSql(session, asOf, 'nelyon-algo-l2-test-v1')));
      assert.ok([...anonymous.values()].every(value => value.mode === 'behavioral_l1'));
      approximately(anonymous.get(ids.likeVideo).score, 0);

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l2-test-v2',follow_weight=20;`);
      psql(db, `insert into public.follows(follower_id,following_id,created_at)
        values('${ids.viewer}','${ids.likeCreator}','${asOf}')`);
      const followed = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        snapshotSql(session, asOf, 'nelyon-algo-l2-test-v2|canary:2:inactive')));
      approximately(followed.get(ids.likeVideo).score, 22,
        0.00001, 'follow must contribute exactly once through L1');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l2-test-v3',follow_weight=0,
        l2_affinity_short_watch_penalty=3;`);
      const negative = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        snapshotSql(session, asOf, 'nelyon-algo-l2-test-v3|canary:2:inactive')));
      approximately(negative.get(ids.oneShortVideo).score, 0);
      approximately(negative.get(ids.twoShortVideo1).score, -4);
      approximately(negative.get(ids.twoShortVideo2).score, -4);
      approximately(negative.get('54000000-0000-4000-8000-000000000001').score, -12);

      const firstPage = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, {
          limit: 1,
          policy: null,
          projection: "id||chr(30)||cursor_score||chr(30)||feed_as_of||chr(30)||policy_version||chr(30)||cursor_created_at",
        })));
      const [firstId, cursorScore, pageAsOf, cursorPolicy, cursorCreatedAt] = firstPage[0].split('\x1e');
      assert.ok(firstId);
      const baselinePage2 = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, {
          limit: 50, asOf: pageAsOf, score: cursorScore, createdAt: cursorCreatedAt,
          id: firstId, policy: cursorPolicy,
        })));
      psql(db, `insert into public.comments(video_id,user_id,text,created_at)
        values('${ids.futureVideo}','${ids.viewer}','after snapshot',clock_timestamp())`);
      const stablePage2 = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, {
          limit: 50, asOf: pageAsOf, score: cursorScore, createdAt: cursorCreatedAt,
          id: firstId, policy: cursorPolicy,
        })));
      assert.deepEqual(stablePage2, baselinePage2,
        'signals after feed_as_of must not change page-2 affinity or cursor output');
      const refreshed = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { limit: 250 })));
      assert.ok(refreshed.get(ids.futureVideo).score > 0,
        'a refreshed snapshot may observe the newly committed signal');

      psql(db, `
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select ('53000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          '${ids.parityCreator}','https://example.test/filler/'||i||'.mp4','filler '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        insert into auth.users(id)
        select md5('l2-noise-user-'||i)::uuid from generate_series(1,100) i;
        insert into public.user_profiles(id,username,is_private)
        select md5('l2-noise-user-'||i)::uuid,'l2_noise_'||i,false from generate_series(1,100) i;
        insert into public.likes(video_id,user_id,created_at)
        select ('53000000-0000-4000-8000-'||lpad(v::text,12,'0'))::uuid,
          md5('l2-noise-user-'||u)::uuid,clock_timestamp()-interval '1 hour'
        from generate_series(1,200) v cross join generate_series(1,100) u;
        insert into public.comments(video_id,user_id,text,created_at)
        select ('53000000-0000-4000-8000-'||lpad((((i-1)%200)+1)::text,12,'0'))::uuid,
          md5('l2-noise-user-'||(((i-1)%100)+1))::uuid,'noise',clock_timestamp()-interval '1 hour'
        from generate_series(1,30000) i;
        insert into public.video_saves(video_id,user_id,created_at)
        select ('53000000-0000-4000-8000-'||lpad(v::text,12,'0'))::uuid,
          md5('l2-noise-user-'||u)::uuid,clock_timestamp()-interval '1 hour'
        from generate_series(1,200) v cross join generate_series(1,100) u;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select ('53000000-0000-4000-8000-'||lpad((((i-1)%200)+1)::text,12,'0'))::uuid,
          md5('l2-noise-user-'||(((i-1)%100)+1))::uuid,gen_random_uuid(),gen_random_uuid(),
          5000,10000,0.5,false,0,'swipe',clock_timestamp()-interval '1 hour'
        from generate_series(1,40000) i;
        analyze public.videos; analyze public.likes; analyze public.comments;
        analyze public.video_saves; analyze public.video_views;
      `);

      assert.equal(Number(lastLine(psql(db, `select count(*) from (
        select id from public.videos order by created_at desc,id desc limit 200
      ) bounded where id='${ids.outsideVideo}'`))), 0,
      'signals for creators outside the bounded candidate pool cannot affect the page');

      const candidatePlan = psql(db, `explain(analyze,buffers,costs off)
        select v.id from public.videos v
        join public.user_profiles up on up.id=v.user_id
        where v.created_at<=clock_timestamp()
          and private.admin_content_is_visible('video',v.id)
          and private.video_can_view_owner(v.user_id)
        order by v.created_at desc,v.id desc limit 200;`).stdout;
      assert.match(candidatePlan, /videos_created_id_desc_idx/i);
      assert.match(candidatePlan, /Limit/i);

      const affinityPlan = psql(db, `explain(analyze,buffers,costs off)
        with candidates as materialized(
          select id,user_id from public.videos order by created_at desc,id desc limit 200
        ), candidate_creators as materialized(
          select distinct user_id as creator_id from candidates
        ), signals as(
          select l.video_id,l.created_at from public.likes l
          join public.videos v on v.id=l.video_id
          join candidate_creators cc on cc.creator_id=v.user_id
          where l.user_id='${ids.viewer}' and l.created_at>=clock_timestamp()-interval '90 days'
          union all
          select c.video_id,c.created_at from public.comments c
          join public.videos v on v.id=c.video_id
          join candidate_creators cc on cc.creator_id=v.user_id
          where c.user_id='${ids.viewer}' and c.created_at>=clock_timestamp()-interval '90 days'
          union all
          select s.video_id,s.created_at from public.video_saves s
          join public.videos v on v.id=s.video_id
          join candidate_creators cc on cc.creator_id=v.user_id
          where s.user_id='${ids.viewer}' and s.created_at>=clock_timestamp()-interval '90 days'
          union all
          select vv.video_id,vv.created_at from public.video_views vv
          join public.videos v on v.id=vv.video_id
          join candidate_creators cc on cc.creator_id=v.user_id
          where vv.viewer_id='${ids.viewer}' and vv.created_at>=clock_timestamp()-interval '90 days'
        ) select video_id,count(*) from signals group by video_id;`).stdout;
      assert.match(affinityPlan, /likes_user_id_idx/i);
      assert.match(affinityPlan, /comments_user_id_idx/i);
      assert.match(affinityPlan, /video_saves_user_id_idx/i);
      assert.match(affinityPlan, /video_views_viewer_created_idx/i);

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l1-v1',production_rollout_bps=0,
        l2_affinity_enabled=false,follow_weight=20,l2_affinity_short_watch_penalty=1.5;`);
      const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.deepEqual(Object.entries(reconciliation).filter(([, value]) => value !== 0), []);
    } finally {
      dropDatabase(db);
    }
  });
