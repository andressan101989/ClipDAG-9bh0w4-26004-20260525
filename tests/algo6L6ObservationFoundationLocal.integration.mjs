import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L6_F2_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L6_F2_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L6_F2_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: 'b1000000-0000-4000-8000-000000000001',
  other: 'b1000000-0000-4000-8000-000000000002',
  creator: 'b1000000-0000-4000-8000-000000000003',
  session: 'b2000000-0000-4000-8000-000000000001',
  otherSession: 'b2000000-0000-4000-8000-000000000002',
  anonSession: 'b2000000-0000-4000-8000-000000000003',
  video: 'b3000000-0000-4000-8000-000000000001',
  secondVideo: 'b3000000-0000-4000-8000-000000000002',
  selfVideo: 'b3000000-0000-4000-8000-000000000003',
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
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', authenticator ? 'authenticator' : owner, '-d', db, '-At');
  return docker(args, { input: sql, allowFailure });
}

function actorCall(db, role, actor, sql, options = {}) {
  return psql(db, `begin;set local role ${role};` +
    `set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${actor ?? ''}';${sql};commit;`,
  { ...options, authenticator: true });
}

function lines(result) { return result.stdout.split(/\r?\n/).filter(Boolean); }
function lastLine(result) { return lines(result).at(-1) ?? ''; }

function applyThroughF4(db) {
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values('${ids.viewer}'),('${ids.other}'),('${ids.creator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','l6_viewer',false),('${ids.other}','l6_other',false),
      ('${ids.creator}','l6_creator',false);
    update private.algo_l1_policy set
      canary_enabled=false,canary_user_id='${ids.viewer}',
      canary_request_id='b4000000-0000-4000-8000-000000000001',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',canary_generation=2;`);
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
  psql(db, migration('_algo6_l5_f4_directed_canary.sql'));
  psql(db, `update private.algo_l1_policy set
    policy_version='nelyon-algo-l1-v1',enabled=true,canary_enabled=false,
    canary_target_layer='l5',canary_generation=14,production_rollout_bps=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,
    l5_semantic_enabled=false`);
}

function createDatabase({ applyF2 = true } = {}) {
  const db = `algo6_l6f2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyThroughF4(db);
  if (applyF2) psql(db, migration('_algo6_l6_observation_dataset_foundation.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function seed(db) {
  psql(db, `
    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.video}','${ids.creator}','https://example.test/l6-a.mp4','l6 a',clock_timestamp()-interval '3 minutes'),
      ('${ids.secondVideo}','${ids.creator}','https://example.test/l6-b.mp4','l6 b',clock_timestamp()-interval '2 minutes'),
      ('${ids.selfVideo}','${ids.viewer}','https://example.test/l6-self.mp4','l6 self',clock_timestamp()-interval '1 minute');
  `);
}

function rankRows(db, role, actor, session, limit = 10) {
  const result = actorCall(db, role, actor, `select concat_ws(chr(30),id,ranking_mode,policy_version,
    rank_score,cursor_score,cursor_created_at,cursor_id,effective_page_limit,
    coalesce(ranking_decision_id::text,'null'),coalesce(ranking_organic_position::text,'null'))
    from public.get_ranked_feed_l1_v1('${session}',${limit},null,null,null,null,null)`);
  return lines(result).map(line => {
    const [id,mode,policy,score,cursorScore,createdAt,cursorId,pageLimit,decisionId,position] = line.split('\x1e');
    return { id,mode,policy,score,cursorScore,createdAt,cursorId,pageLimit,
      decisionId: decisionId === 'null' ? null : decisionId,
      position: position === 'null' ? null : Number(position) };
  });
}

function impressionCall(db, role, actor, { decisionId, videoId, eventId, session = ids.session, surface = 1 }, options = {}) {
  return actorCall(db, role, actor, `select status||'|'||client_event_id||'|'||decision_id||'|'||organic_position||'|'||video_id
    from public.record_organic_ranking_impression_v1('${decisionId}','${videoId}','${eventId}','${session}',${surface})`, options);
}

function engagementCall(db, actor, impressionId, actionId, action, options = {}) {
  return actorCall(db, 'authenticated', actor, `select status||'|'||client_action_id||'|'||impression_client_event_id||'|'||action
    from public.record_organic_ranking_engagement_v1('${impressionId}','${actionId}','${action}')`, options);
}

function assertRejected(result, message) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message, 'i'));
}

function reconciler(db) {
  return JSON.parse(lastLine(actorCall(db, 'service_role', null, 'select public.reconcile_algo_l1_v1()')));
}

test('migration compiles, preserves ranking, records exact slates and fails soft',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase({ applyF2: false });
    try {
      seed(db);
      const base = actorCall(db, 'authenticated', ids.viewer, `select concat_ws(chr(30),id,ranking_mode,policy_version,
        rank_score,cursor_score,cursor_created_at,cursor_id,effective_page_limit)
        from public.get_ranked_feed_l1_v1('${ids.session}',10,null,null,null,null,null)`);
      const baseRows = lines(base);
      psql(db, migration('_algo6_l6_observation_dataset_foundation.sql'));
      const observed = rankRows(db, 'authenticated', ids.viewer, ids.session);
      assert.deepEqual(observed.map(row => [row.id,row.mode,row.policy,row.score,row.cursorScore,row.createdAt,row.cursorId,row.pageLimit]),
        baseRows.map(line => line.split('\x1e')));
      assert.equal(new Set(observed.map(row => row.decisionId)).size, 1);
      assert.ok(observed[0].decisionId);
      assert.deepEqual(observed.map(row => row.position), [1,2,3]);
      assert.equal(lastLine(psql(db, `select returned_count||'|'||candidate_count||'|'||count(i.*)
        from private.organic_ranking_decisions d left join private.organic_ranking_items i on i.decision_id=d.id
        where d.id='${observed[0].decisionId}' group by d.id`)), '3|3|3');
      assert.deepEqual(lines(psql(db, `select video_id||'|'||organic_position from private.organic_ranking_items
        where decision_id='${observed[0].decisionId}' order by organic_position`)),
      observed.map(row => `${row.id}|${row.position}`));

      psql(db, `create function private.l6_test_fail_decision() returns trigger language plpgsql as $$
        begin raise exception 'induced'; end;$$;
        create trigger l6_test_fail_decision before insert on private.organic_ranking_decisions
        for each row execute function private.l6_test_fail_decision();`);
      const failSoft = rankRows(db, 'authenticated', ids.viewer, ids.otherSession);
      assert.deepEqual(failSoft.map(row => row.id), observed.map(row => row.id));
      assert.ok(failSoft.every(row => row.decisionId === null && row.position === null));
      psql(db, `drop trigger l6_test_fail_decision on private.organic_ranking_decisions;
        drop function private.l6_test_fail_decision()`);

      psql(db, 'delete from public.videos');
      const decisionsBefore = Number(lastLine(psql(db, 'select count(*) from private.organic_ranking_decisions')));
      assert.deepEqual(rankRows(db, 'anon', null, ids.anonSession), []);
      assert.equal(Number(lastLine(psql(db, 'select count(*) from private.organic_ranking_decisions'))), decisionsBefore + 1);
      assert.equal(lastLine(psql(db, 'select returned_count from private.organic_ranking_decisions order by created_at desc limit 1')), '0');

      const rec = reconciler(db);
      assert.equal(Object.keys(rec).length, 65);
      assert.deepEqual(Object.entries(rec).filter(([, value]) => value !== 0), []);
    } finally { dropDatabase(db); }
  });

test('impression authority enforces identity, idempotency and exact video_view linkage',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      seed(db);
      const ranked = rankRows(db, 'authenticated', ids.viewer, ids.session);
      const target = ranked.find(row => row.id === ids.video);
      assert.ok(target?.decisionId);
      const eventId = randomUUID();
      assert.match(lastLine(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId, surface: 3,
      })), /^recorded\|/);
      assert.match(lastLine(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId, surface: 3,
      })), /^existing\|/);
      assertRejected(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId, surface: 4,
      }, { allowFailure: true }), 'organic_ranking_impression_event_conflict');
      assertRejected(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId: randomUUID(), session: ids.otherSession,
      }, { allowFailure: true }), 'organic_ranking_impression_not_authorized');
      assertRejected(impressionCall(db, 'authenticated', ids.other, {
        decisionId: target.decisionId, videoId: target.id, eventId: randomUUID(),
      }, { allowFailure: true }), 'organic_ranking_impression_not_authorized');
      assertRejected(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: randomUUID(), eventId: randomUUID(),
      }, { allowFailure: true }), 'organic_ranking_impression_item_missing');
      assertRejected(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId: randomUUID(), surface: 0,
      }, { allowFailure: true }), 'organic_ranking_impression_invalid');

      assert.equal(lastLine(actorCall(db, 'authenticated', ids.viewer, `select status
        from public.record_video_view_v1('${ids.video}','${eventId}','${ids.session}',1500,'swipe')`)), 'recorded');
      assert.equal(lastLine(psql(db, `select count(*) from private.organic_ranking_impressions i
        join public.video_views v on v.client_event_id=i.client_event_id where i.client_event_id='${eventId}'`)), '1');

      const noViewEvent = randomUUID();
      assert.match(lastLine(impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId: noViewEvent, surface: 7,
      })), /^recorded\|/);
      assert.equal(lastLine(psql(db, `select count(*) from private.organic_ranking_impressions i
        left join public.video_views v on v.client_event_id=i.client_event_id
        where i.client_event_id='${noViewEvent}' and v.id is null`)), '1');

      const anonRanked = rankRows(db, 'anon', null, ids.anonSession);
      const anon = anonRanked[0];
      assert.match(lastLine(impressionCall(db, 'anon', null, {
        decisionId: anon.decisionId, videoId: anon.id, eventId: randomUUID(), session: ids.anonSession,
      })), /^recorded\|/);

      for (const role of ['anon','authenticated']) {
        assertRejected(actorCall(db, role, role === 'anon' ? null : ids.viewer,
          'select count(*) from private.organic_ranking_impressions', { allowFailure: true }), 'permission denied');
      }
    } finally { dropDatabase(db); }
  });

test('engagement telemetry validates canonical state, window, viewer, self-action and idempotency',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      seed(db);
      const ranked = rankRows(db, 'authenticated', ids.viewer, ids.session);
      const target = ranked.find(row => row.id === ids.video);
      const self = ranked.find(row => row.id === ids.selfVideo);
      const eventId = randomUUID();
      impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: target.decisionId, videoId: target.id, eventId,
      });

      const stateSql = {
        like: `insert into public.likes(user_id,video_id) values('${ids.viewer}','${ids.video}')`,
        unlike: `delete from public.likes where user_id='${ids.viewer}' and video_id='${ids.video}'`,
        save: `insert into public.video_saves(user_id,video_id) values('${ids.viewer}','${ids.video}')`,
        unsave: `delete from public.video_saves where user_id='${ids.viewer}' and video_id='${ids.video}'`,
        follow: `insert into public.follows(follower_id,following_id) values('${ids.viewer}','${ids.creator}')`,
        unfollow: `delete from public.follows where follower_id='${ids.viewer}' and following_id='${ids.creator}'`,
      };
      for (const action of ['like','unlike','save','unsave','follow','unfollow']) {
        psql(db, stateSql[action]);
        const actionId = randomUUID();
        assert.match(lastLine(engagementCall(db, ids.viewer, eventId, actionId, action)), /^recorded\|/);
        assert.match(lastLine(engagementCall(db, ids.viewer, eventId, actionId, action)), /^existing\|/);
        assertRejected(engagementCall(db, ids.other, eventId, actionId, action, { allowFailure: true }),
          'organic_ranking_engagement_not_authorized');
        assertRejected(engagementCall(db, ids.viewer, eventId, actionId,
          action === 'like' ? 'save' : 'like', { allowFailure: true }),
        'organic_ranking_engagement_event_conflict');
      }
      assert.equal(lastLine(psql(db, 'select count(*) from private.organic_ranking_engagement_events')), '6');

      assertRejected(engagementCall(db, ids.viewer, eventId, randomUUID(), 'like', { allowFailure: true }),
        'organic_ranking_engagement_state_mismatch');
      assertRejected(engagementCall(db, ids.other, eventId, randomUUID(), 'unlike', { allowFailure: true }),
        'organic_ranking_engagement_not_authorized');

      const selfEvent = randomUUID();
      impressionCall(db, 'authenticated', ids.viewer, {
        decisionId: self.decisionId, videoId: self.id, eventId: selfEvent, surface: 2,
      });
      assert.match(lastLine(engagementCall(db, ids.viewer, selfEvent, randomUUID(), 'like')), /^ignored_self_action\|/);
      assert.equal(lastLine(psql(db, `select count(*) from private.organic_ranking_engagement_events
        where impression_client_event_id='${selfEvent}'`)), '0');

      psql(db, `update private.organic_ranking_impressions set created_at=clock_timestamp()-interval '25 hours'
        where client_event_id='${eventId}'`);
      assertRejected(engagementCall(db, ids.viewer, eventId, randomUUID(), 'unlike', { allowFailure: true }),
        'organic_ranking_engagement_outside_window');
    } finally { dropDatabase(db); }
  });

test('progress, retention, reconciler and 30k-video performance remain bounded',
  { skip: !enabled, timeout: 900000 }, t => {
    const db = createDatabase({ applyF2: false });
    try {
      psql(db, `
        insert into auth.users(id)
          select md5('l6-perf-user-'||g)::uuid from generate_series(1,300) g;
        insert into public.user_profiles(id,username,is_private)
          select md5('l6-perf-user-'||g)::uuid,'l6_perf_'||g,false from generate_series(1,300) g;
        insert into public.videos(id,user_id,video_url,caption,created_at)
          select md5('l6-perf-video-'||g)::uuid,
            md5('l6-perf-user-'||(((g-1)%300)+1))::uuid,
            'https://example.test/perf/'||g||'.mp4','perf '||g,
            clock_timestamp()-make_interval(secs=>g)
          from generate_series(1,30000) g;
      `);
      const benchmark = () => JSON.parse(lastLine(psql(db, `
        create temp table l6_bench(ms double precision);
        do $$declare i integer;started timestamp with time zone;begin
          for i in 1..100 loop
            started:=clock_timestamp();
            perform * from public.get_ranked_feed_l1_v1(
              md5('l6-bench-session-'||i)::uuid,10,null,null,null,null,null);
            insert into l6_bench values(extract(epoch from (clock_timestamp()-started))*1000);
          end loop;
        end$$;
        select json_build_object(
          'median',percentile_cont(0.5) within group(order by ms),
          'p95',percentile_cont(0.95) within group(order by ms)
        ) from l6_bench;`)));
      const base = benchmark();
      psql(db, migration('_algo6_l6_observation_dataset_foundation.sql'));
      const observed = benchmark();
      t.diagnostic(`ranking benchmark ms base median=${base.median.toFixed(3)} p95=${base.p95.toFixed(3)} `
        + `observed median=${observed.median.toFixed(3)} p95=${observed.p95.toFixed(3)} `
        + `delta median=${(observed.median - base.median).toFixed(3)} `
        + `p95=${(observed.p95 - base.p95).toFixed(3)}`);
      assert.ok(observed.median - base.median <= 20,
        `median delta ${observed.median - base.median}ms exceeds 20ms`);
      assert.ok(observed.p95 - base.p95 <= 50,
        `p95 delta ${observed.p95 - base.p95}ms exceeds 50ms`);
      assert.equal(lastLine(psql(db, 'select count(*) from private.organic_ranking_decisions')), '100');
      assert.equal(lastLine(psql(db, 'select count(*) from private.organic_ranking_items')), '1000');

      const progress = JSON.parse(lastLine(actorCall(db, 'service_role', null,
        'select public.get_algo6_l6_observation_progress_v1()')));
      assert.equal(progress.decisions_total, 100);
      assert.equal(progress.decision_items, 1000);
      assert.equal(progress.visible_impressions, 0);
      assert.equal(progress.view_link_coverage_ratio, 0);
      assertRejected(actorCall(db, 'anon', null,
        'select public.get_algo6_l6_observation_progress_v1()', { allowFailure: true }), 'permission denied');
      assertRejected(actorCall(db, 'authenticated', null,
        'select public.get_algo6_l6_observation_progress_v1()', { allowFailure: true }), 'permission denied');

      const oldDecision = lastLine(psql(db, `select id from private.organic_ranking_decisions order by created_at limit 1`));
      const recentDecision = lastLine(psql(db, `select id from private.organic_ranking_decisions order by created_at desc limit 1`));
      psql(db, `update private.organic_ranking_decisions set created_at=clock_timestamp()-interval '181 days'
        where id='${oldDecision}'`);
      const signalsBefore = lastLine(psql(db, `select concat_ws('|',(select count(*) from public.videos),
        (select count(*) from public.video_views),(select count(*) from public.likes),
        (select count(*) from public.video_saves),(select count(*) from public.follows))`));
      assert.equal(lastLine(psql(db, 'select private.prune_algo6_l6_observations_v1()')), '1');
      assert.equal(lastLine(psql(db, `select count(*) from private.organic_ranking_decisions where id='${oldDecision}'`)), '0');
      assert.equal(lastLine(psql(db, `select count(*) from private.organic_ranking_decisions where id='${recentDecision}'`)), '1');
      assert.equal(lastLine(psql(db, `select concat_ws('|',(select count(*) from public.videos),
        (select count(*) from public.video_views),(select count(*) from public.likes),
        (select count(*) from public.video_saves),(select count(*) from public.follows))`)), signalsBefore);

      let rec = reconciler(db);
      assert.equal(Object.keys(rec).length, 65);
      assert.deepEqual(Object.entries(rec).filter(([, value]) => value !== 0), []);
      psql(db, `update private.organic_ranking_decisions set returned_count=returned_count-1 where id='${recentDecision}'`);
      rec = reconciler(db);
      assert.equal(rec.l6_observation_orphan_present, 1);
      psql(db, `update private.organic_ranking_decisions d set returned_count=(
        select count(*) from private.organic_ranking_items i where i.decision_id=d.id
      ) where id='${recentDecision}'`);
      assert.deepEqual(Object.entries(reconciler(db)).filter(([, value]) => value !== 0), []);
      assert.equal(lastLine(psql(db, `select count(*) from cron.job
        where jobname='algo6_l6_observation_retention_v1' and schedule='17 3 * * *'`)), '1');
    } finally { dropDatabase(db); }
  });
