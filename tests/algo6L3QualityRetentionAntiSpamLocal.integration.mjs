import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L3_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L3_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L3_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: '61000000-0000-4000-8000-000000000001',
  admin: '61000000-0000-4000-8000-000000000002',
  highCreator: '61000000-0000-4000-8000-000000000003',
  lowCreator: '61000000-0000-4000-8000-000000000004',
  partialCreator: '61000000-0000-4000-8000-000000000005',
  repeatCreator: '61000000-0000-4000-8000-000000000006',
  anonCreator: '61000000-0000-4000-8000-000000000007',
  nullCreator: '61000000-0000-4000-8000-000000000008',
  burstCreator: '61000000-0000-4000-8000-000000000009',
  hiddenBurstCreator: '61000000-0000-4000-8000-000000000010',
  duplicateCreator: '61000000-0000-4000-8000-000000000011',
  otherDuplicateCreator: '61000000-0000-4000-8000-000000000012',
  reportCreator: '61000000-0000-4000-8000-000000000013',
  blockedCreator: '61000000-0000-4000-8000-000000000014',
  moderatedCreator: '61000000-0000-4000-8000-000000000015',
  highVideo: '62000000-0000-4000-8000-000000000001',
  lowVideo: '62000000-0000-4000-8000-000000000002',
  partialVideo: '62000000-0000-4000-8000-000000000003',
  repeatVideo: '62000000-0000-4000-8000-000000000004',
  anonVideo: '62000000-0000-4000-8000-000000000005',
  selfVideo: '62000000-0000-4000-8000-000000000006',
  nullVideo: '62000000-0000-4000-8000-000000000007',
  duplicateOriginal: '62000000-0000-4000-8000-000000000008',
  duplicateLater: '62000000-0000-4000-8000-000000000009',
  crossCreatorDuplicate: '62000000-0000-4000-8000-000000000010',
  reportVideo: '62000000-0000-4000-8000-000000000011',
  blockedVideo: '62000000-0000-4000-8000-000000000012',
  moderatedVideo: '62000000-0000-4000-8000-000000000013',
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

function createDatabase() {
  const db = `algo6_l3_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
    insert into auth.users(id) values('60000000-0000-4000-8000-000000000001');
    insert into public.user_profiles(id,username,is_private)
      values('60000000-0000-4000-8000-000000000001','l3_bootstrap',false);
    update private.algo_l1_policy set
      canary_enabled=false,
      canary_user_id='60000000-0000-4000-8000-000000000001',
      canary_request_id='60000000-0000-4000-8000-000000000002',
      canary_requested_at=clock_timestamp()-interval '2 hours',
      canary_armed_at=clock_timestamp()-interval '90 minutes',
      canary_expires_at=clock_timestamp()-interval '60 minutes',
      canary_generation=2;
  `);
  psql(db, migration('_algo6_l2_directed_canary.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function rankedSql(sessionId, {
  limit = 50, asOf, score = 999999, createdAt = '9999-12-31T23:59:59Z',
  id = 'ffffffff-ffff-ffff-ffff-ffffffffffff', policy,
  projection = "id||'|'||rank_score||'|'||ranking_mode||'|'||policy_version||'|'||created_at||'|'||feed_as_of||'|'||cursor_score",
} = {}) {
  const value = item => item == null ? 'null' : `'${item}'`;
  return `select ${projection} from public.get_ranked_feed_l1_v1(` +
    `'${sessionId}',${limit},${value(asOf)},${score == null ? 'null' : score},` +
    `${value(createdAt)},${value(id)},${value(policy)})`;
}

function scoreMap(result) {
  return new Map(rows(result).map(row => {
    const [id, score, mode] = row.split('|');
    return [id, { score: Number(score), mode }];
  }));
}

function seedFunctional(db, asOf) {
  const creators = Object.entries(ids).filter(([key]) => key.endsWith('Creator'));
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;

    insert into auth.users(id) values ('${ids.viewer}'),('${ids.admin}')
      ${creators.map(([, id]) => `,('${id}')`).join('')};
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','l3_viewer',false),('${ids.admin}','l3_admin',false)
      ${creators.map(([key, id]) => `,('${id}','l3_${key.toLowerCase()}',false)`).join('\n      ')};

    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.highVideo}','${ids.highCreator}','https://example.test/high.mp4','high','${asOf}'::timestamptz-interval '2 minutes'),
      ('${ids.lowVideo}','${ids.lowCreator}','https://example.test/low.mp4','low','${asOf}'::timestamptz-interval '3 minutes'),
      ('${ids.partialVideo}','${ids.partialCreator}','https://example.test/partial.mp4','partial','${asOf}'::timestamptz-interval '4 minutes'),
      ('${ids.repeatVideo}','${ids.repeatCreator}','https://example.test/repeat.mp4','repeat','${asOf}'::timestamptz-interval '5 minutes'),
      ('${ids.anonVideo}','${ids.anonCreator}','https://example.test/anon.mp4','anon','${asOf}'::timestamptz-interval '6 minutes'),
      ('${ids.selfVideo}','${ids.viewer}','https://example.test/self.mp4','self','${asOf}'::timestamptz-interval '7 minutes'),
      ('${ids.nullVideo}','${ids.nullCreator}','https://example.test/null.mp4','null','${asOf}'::timestamptz-interval '8 minutes'),
      ('${ids.duplicateOriginal}','${ids.duplicateCreator}','https://example.test/dup-original.mp4','dup original','${asOf}'::timestamptz-interval '20 minutes'),
      ('${ids.duplicateLater}','${ids.duplicateCreator}','https://example.test/dup-later.mp4','dup later','${asOf}'::timestamptz-interval '10 minutes'),
      ('${ids.crossCreatorDuplicate}','${ids.otherDuplicateCreator}','https://example.test/dup-cross.mp4','dup cross','${asOf}'::timestamptz-interval '9 minutes'),
      ('${ids.reportVideo}','${ids.reportCreator}','https://example.test/report.mp4','report','${asOf}'::timestamptz-interval '11 minutes'),
      ('${ids.blockedVideo}','${ids.blockedCreator}','https://example.test/blocked.mp4','blocked','${asOf}'::timestamptz-interval '12 minutes'),
      ('${ids.moderatedVideo}','${ids.moderatedCreator}','https://example.test/moderated.mp4','moderated','${asOf}'::timestamptz-interval '13 minutes');

    insert into public.videos(id,user_id,video_url,caption,created_at)
    select md5('burst-video-'||i)::uuid,'${ids.burstCreator}',
      'https://example.test/burst/'||i||'.mp4','burst '||i,
      '${asOf}'::timestamptz-make_interval(mins=>i)
    from generate_series(1,10) i;

    insert into public.videos(id,user_id,video_url,caption,created_at)
    select md5('hidden-burst-video-'||i)::uuid,'${ids.hiddenBurstCreator}',
      'https://example.test/hidden-burst/'||i||'.mp4','hidden burst '||i,
      '${asOf}'::timestamptz-make_interval(mins=>i)
    from generate_series(1,7) i;

    insert into auth.users(id)
    select md5('l3-audience-'||i)::uuid from generate_series(1,50) i;
    insert into public.user_profiles(id,username,is_private)
    select md5('l3-audience-'||i)::uuid,'l3_audience_'||i,false
    from generate_series(1,50) i;

    insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    )
    select '${ids.highVideo}'::uuid,md5('l3-audience-'||i)::uuid,md5('high-event-'||i)::uuid,
      md5('high-session-'||i)::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,20) i
    union all
    select '${ids.lowVideo}',md5('l3-audience-'||(20+i))::uuid,md5('low-event-'||i)::uuid,
      md5('low-session-'||i)::uuid,10000,100000,0.10,false,0,'swipe',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,20) i
    union all
    select '${ids.partialVideo}',md5('l3-audience-'||i)::uuid,md5('partial-event-'||i)::uuid,
      md5('partial-session-'||i)::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,3) i
    union all
    select '${ids.repeatVideo}',md5('l3-audience-1')::uuid,md5('repeat-event-'||i)::uuid,
      md5('repeat-session-'||i)::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,30) i
    union all
    select '${ids.anonVideo}',null,md5('anon-event-'||i)::uuid,
      md5('one-anon-session')::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,10) i
    union all
    select '${ids.selfVideo}','${ids.viewer}',md5('self-event-'||i)::uuid,
      md5('self-session-'||i)::uuid,100000,100000,1,true,0,'ended',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,20) i
    union all
    select '${ids.nullVideo}',md5('l3-audience-'||i)::uuid,md5('null-event-'||i)::uuid,
      md5('null-session-'||i)::uuid,1000,null,null,null,0,'background',
      '${asOf}'::timestamptz-make_interval(secs=>i)
    from generate_series(1,10) i;

    insert into private.content_safety_scans(
      target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      detector_version,text_status,audio_status,visual_status,reports_status,created_at
    ) values
      ('video','${ids.duplicateOriginal}','${ids.duplicateCreator}',repeat('a',64),'completed','content_created','l3-test','analyzed','not_configured','not_configured','analyzed','${asOf}'::timestamptz-interval '19 minutes'),
      ('video','${ids.duplicateLater}','${ids.duplicateCreator}',repeat('a',64),'completed','content_created','l3-test','analyzed','not_configured','not_configured','analyzed','${asOf}'::timestamptz-interval '9 minutes'),
      ('video','${ids.crossCreatorDuplicate}','${ids.otherDuplicateCreator}',repeat('a',64),'completed','content_created','l3-test','analyzed','not_configured','not_configured','analyzed','${asOf}'::timestamptz-interval '8 minutes'),
      ('video','${ids.reportVideo}','${ids.reportCreator}',repeat('b',64),'completed','content_created','l3-test','analyzed','not_configured','not_configured','analyzed','${asOf}'::timestamptz-interval '10 minutes');

    insert into private.admin_capabilities(
      capability_code,domain,effect,description,is_sensitive
    ) values('content.items.hide','content','workflow','Disposable L3 moderation fixture',true)
    on conflict(capability_code) do nothing;
  `);
}

test('L3 preserves dormant L1/L2 output and enforces retention and anti-spam contracts',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    const session = '65000000-0000-4000-8000-000000000001';
    try {
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      seedFunctional(db, asOf);

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l3-parity-v1',production_rollout_bps=10000,
        creator_page_cap=50;`);
      const before = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-parity-v1' })));
      assert.ok(before.length > 0);

      psql(db, migration('_algo6_l3_quality_retention_antispam.sql'));
      const dormant = lastLine(psql(db, `select
        policy_version||'|'||l3_quality_enabled||'|'||production_rollout_bps||'|'||
        canary_enabled||'|'||canary_generation from private.algo_l1_policy`));
      assert.equal(dormant, 'nelyon-algo-l3-parity-v1|false|10000|false|2');
      const after = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-parity-v1' })));
      assert.deepEqual(after, before, 'dormant L3 must preserve exact score/order/cursor/mode');

      assert.notEqual(psql(db,
        'update private.algo_l1_policy set l3_quality_weight=16',
        { allowFailure: true }).status, 0,
      'L3 algorithmic fields require policy-version discipline');

      psql(db, `update private.algo_l1_policy set
        policy_version='nelyon-algo-l3-test-v1',l3_quality_enabled=true,
        freshness_weight=0,follow_weight=0,like_weight=0,comment_weight=0,save_weight=0,
        completion_weight=0,rewatch_weight=0,exploration_weight=0,
        short_watch_penalty=0,recent_completed_penalty=0,repeat_view_penalty=0,
        same_session_penalty=0,creator_page_cap=50;`);

      const initial = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-test-v1' })));
      assert.equal(initial.get(ids.highVideo).mode, 'behavioral_l3');
      assert.equal(initial.get(ids.highVideo).score, 15, '20 strong distinct audiences reach +15');
      assert.equal(initial.get(ids.lowVideo).score, -15, '20 early exits reach -15');
      assert.equal(initial.get(ids.partialVideo).score, 2.25, '3 strong samples use 3/20 confidence');
      assert.equal(initial.get(ids.repeatVideo).score, 0, 'one repeated authenticated viewer is one sample');
      assert.equal(initial.get(ids.anonVideo).score, 0, 'one repeated anonymous session is one sample');
      assert.equal(initial.get(ids.selfVideo).score, 0, 'self views cannot improve quality');
      assert.equal(initial.get(ids.nullVideo).score, 0, 'null duration rows are not samples');
      assert.equal(initial.get(ids.duplicateOriginal).score, 0, 'earliest same-creator fingerprint is original');
      assert.equal(initial.get(ids.duplicateLater).score, -20, 'later exact same-creator duplicate is penalized');
      assert.equal(initial.get(ids.crossCreatorDuplicate).score, 0, 'cross-creator fingerprint is not penalized');
      assert.equal(initial.get(md5Uuid('burst-video-1')).score, -8, 'ten visible posts create an 8 point burst penalty');

      const hiddenBurstId = md5Uuid('hidden-burst-video-7');
      psql(db, `with action as (
        insert into private.admin_content_moderation_actions(
          actor_id,actor_role_snapshot,actor_capability,target_type,target_id,action,reason,
          idempotency_scope,idempotency_key,request_fingerprint,
          visibility_before,visibility_after,result
        ) values(
          '${ids.admin}','{}','content.items.hide','video','${hiddenBurstId}','hide','l3 test',
          'l3|moderation|${hiddenBurstId}',gen_random_uuid(),repeat('c',64),
          'visible','hidden','succeeded'
        ) returning id
      ) insert into private.admin_content_moderation_state(
        target_type,target_id,visibility,last_action_id
      ) select 'video','${hiddenBurstId}','hidden',id from action;`);
      const hiddenBurst = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-test-v1' })));
      assert.equal(hiddenBurst.get(md5Uuid('hidden-burst-video-1')).score, 0,
        'six visible posts remain inside the free burst allowance');
      assert.equal(hiddenBurst.has(hiddenBurstId), false, 'hidden moderation remains hard eligibility');

      const reportBefore = initial.get(ids.reportVideo).score;
      psql(db, `
        insert into public.reports(reporter_user_id,reported_content_id,reported_content_type,reason,details)
        select md5('l3-audience-'||i)::uuid,'${ids.reportVideo}','video','spam','brigade '||i
        from generate_series(1,5) i;
        insert into private.content_safety_alerts(
          scan_id,target_type,target_id,owner_user_id,source_type,category,severity,
          confidence,priority_score,alert_fingerprint,pending_report_count,reports_last_15m
        ) select id,'video','${ids.reportVideo}','${ids.reportCreator}','user_reports','spam','critical',
          0.99,100,repeat('d',64),500,500
        from private.content_safety_scans
        where target_type='video' and target_id='${ids.reportVideo}'
        order by created_at desc,id desc limit 1;
      `);
      const reportAfter = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-test-v1' })));
      assert.equal(reportAfter.get(ids.reportVideo).score, reportBefore,
        'raw reports and unreviewed alerts must not change ranking');

      psql(db, `insert into public.blocked_users(blocker_id,blocked_id)
        values('${ids.viewer}','${ids.blockedCreator}')`);
      const blocked = scoreMap(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { asOf, policy: 'nelyon-algo-l3-test-v1' })));
      assert.equal(blocked.has(ids.blockedVideo), false, 'existing block/privacy authority remains hard eligibility');

      const pageOne = rows(actorCall(db, 'authenticated', ids.viewer,
        rankedSql(session, { limit: 5, asOf, policy: 'nelyon-algo-l3-test-v1' })));
      const tail = pageOne.at(-1).split('|');
      const pageTwoSql = rankedSql(session, {
        limit: 5, asOf, policy: 'nelyon-algo-l3-test-v1', score: tail[7],
        createdAt: tail[4], id: tail[0],
      });
      const pageTwoBefore = rows(actorCall(db, 'authenticated', ids.viewer, pageTwoSql));
      psql(db, `insert into public.video_views(
        video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
        media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
      ) values('${ids.lowVideo}',md5('l3-audience-50')::uuid,gen_random_uuid(),gen_random_uuid(),
        100000,100000,1,true,0,'ended',clock_timestamp())`);
      const pageTwoAfter = rows(actorCall(db, 'authenticated', ids.viewer, pageTwoSql));
      assert.deepEqual(pageTwoAfter, pageTwoBefore, 'post-snapshot signal cannot alter page 2');

      const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      for (const [key, value] of Object.entries(reconciliation)) {
        if (key === 'l3_unexpectedly_enabled' || key === 'production_rollout_nonzero') continue;
        assert.equal(value, 0, `${key} must reconcile in the disposable L3 environment`);
      }
    } finally {
      dropDatabase(db);
    }
  });

function md5Uuid(value) {
  const result = spawnSync('node', ['-e', `const c=require('crypto');const h=c.createHash('md5').update(${JSON.stringify(value)}).digest('hex');console.log(h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20))`], { encoding: 'utf8' });
  return result.stdout.trim();
}

test('L3 plans remain bounded at 30k videos and 110k view rows using existing indexes',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      psql(db, migration('_algo6_l3_quality_retention_antispam.sql'));
      psql(db, `
        insert into private.age_eligibility_policy(
          singleton,minimum_age,policy_version,creator_exclusive_minimum_age
        ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
        insert into auth.users(id)
        select md5('perf-creator-'||i)::uuid from generate_series(1,30) i
        union
        select md5('perf-viewer-'||i)::uuid from generate_series(1,1000) i;
        insert into public.user_profiles(id,username,is_private)
        select md5('perf-creator-'||i)::uuid,'perf_creator_'||i,false
        from generate_series(1,30) i
        union all
        select md5('perf-viewer-'||i)::uuid,'perf_viewer_'||i,false
        from generate_series(1,1000) i;
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('perf-video-'||i)::uuid,
          md5('perf-creator-'||(((i-1)%30)+1))::uuid,
          'https://example.test/perf/'||i||'.mp4','perf '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select md5('perf-video-'||(((i-1)%30000)+1))::uuid,
          md5('perf-viewer-'||(((i-1)%1000)+1))::uuid,
          md5('perf-event-'||i)::uuid,md5('perf-session-'||i)::uuid,
          case when i%3=0 then 100000 else 10000 end,100000,
          case when i%3=0 then 1.0 else 0.1 end,
          i%3=0,0,case when i%3=0 then 'ended' else 'swipe' end,
          clock_timestamp()-make_interval(secs=>(i%200000))
        from generate_series(1,110000) i;
        insert into private.content_safety_scans(
          target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
          detector_version,text_status,audio_status,visual_status,reports_status
        )
        select 'video',md5('perf-video-'||i)::uuid,
          md5('perf-creator-'||(((i-1)%30)+1))::uuid,
          md5('perf-fingerprint-'||(((i-1)%60)+1))||md5('perf-fingerprint-b-'||(((i-1)%60)+1)),
          'completed','content_created','l3-perf','analyzed','not_configured','not_configured','analyzed'
        from generate_series(1,300) i;
        analyze public.videos;
        analyze public.video_views;
        analyze private.content_safety_scans;
      `);

      const plan = psql(db, `explain (analyze,buffers,costs off)
        with candidates as materialized (
          select v.id,v.user_id,v.created_at from public.videos v
          where v.created_at<=clock_timestamp()
          order by v.created_at desc,v.id desc limit 200
        ), candidate_ids as materialized (
          select array_agg(id) ids from candidates
        ), candidate_creators as materialized (
          select distinct user_id creator_id from candidates
        ), retention as (
          select vv.video_id,vv.created_at
          from public.video_views vv cross join candidate_ids ci
          where vv.video_id=any(ci.ids)
            and vv.created_at>=clock_timestamp()-interval '30 days'
        ), history as (
          select h.id
          from candidate_creators cc cross join lateral (
            select v.id from public.videos v
            where v.user_id=cc.creator_id and v.created_at>=clock_timestamp()-interval '90 days'
            order by v.created_at desc,v.id desc limit 100
          ) h
        ), fingerprints as (
          select h.id,s.content_fingerprint
          from history h left join lateral (
            select css.content_fingerprint from private.content_safety_scans css
            where css.target_type='video' and css.target_id=h.id
            order by css.created_at desc,css.id desc limit 1
          ) s on true
        )
        select (select count(*) from candidates),
          (select count(*) from retention),(select count(*) from fingerprints);`).stdout;
      assert.match(plan, /videos_created_id_desc_idx/i);
      assert.match(plan, /video_views_video_created_idx/i);
      assert.match(plan, /videos_user_created_id_desc_idx/i);
      assert.match(plan, /content_safety_scans_target_idx/i);
      assert.match(plan, /rows=200 loops=1/i, 'candidate pool must stay bounded at 200');
      assert.doesNotMatch(plan, /Seq Scan on video_views/i, 'L3 must not scan global view history');
    } finally {
      dropDatabase(db);
    }
  });
