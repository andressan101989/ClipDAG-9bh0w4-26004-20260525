import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L6_F4_LOCAL === '1';
const performanceEnabled = enabled && process.env.NELYON_ALGO6_L6_F4_PERF === '1';
const container = process.env.NELYON_ALGO6_L6_F4_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L6_F4_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  viewer: 'c1000000-0000-4000-8000-000000000001',
  other: 'c1000000-0000-4000-8000-000000000002',
  creator: 'c1000000-0000-4000-8000-000000000003',
  session: 'c2000000-0000-4000-8000-000000000001',
  otherSession: 'c2000000-0000-4000-8000-000000000002',
  video: 'c3000000-0000-4000-8000-000000000001',
  secondVideo: 'c3000000-0000-4000-8000-000000000002',
  selfVideo: 'c3000000-0000-4000-8000-000000000003',
};

const snapshot = {
  freshness_points: 1, follow_points: 0, like_points: 0, comment_points: 0,
  save_points: 0, completion_points: 0, rewatch_points: 0, exploration_points: 0,
  same_session_points: 0, short_watch_points: 0, completed_points: 0, repeat_points: 0,
  creator_affinity_points: 0, l3_quality_points: 0, creator_burst_penalty: 0,
  duplicate_penalty: 0, l3_adjustment: 0, positive_creator_points: 0,
  negative_creator_penalty: 0, creator_session_repeat_penalty: 0,
  l4_context_adjustment: 0, l5_semantic_positive_points: null,
  l5_semantic_negative_penalty: null, l5_semantic_adjustment: null,
};

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
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

function actorCall(db, role, sql, { allowFailure = false, statementTimeout = null } = {}) {
  const timeoutSql = statementTimeout ? `set local statement_timeout='${statementTimeout}';` : '';
  return psql(db, `begin;set local role ${role};set local "request.jwt.claim.role"='${role}';${timeoutSql}${sql};commit;`,
    { allowFailure, authenticator: true });
}

function lines(result) { return result.stdout.split(/\r?\n/).filter(Boolean); }
function lastLine(result) { return lines(result).at(-1) ?? ''; }
function assertRejected(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(pattern, 'i'));
}

function applyThroughL5F4(db) {
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
      ('${ids.viewer}','l6f4_viewer',false),('${ids.other}','l6f4_other',false),
      ('${ids.creator}','l6f4_creator',false);
    update private.algo_l1_policy set
      canary_enabled=false,canary_user_id='${ids.viewer}',
      canary_request_id='c4000000-0000-4000-8000-000000000001',
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

function createDatabase() {
  const db = `algo6_l6f4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyThroughL5F4(db);
  psql(db, migration('_algo6_l6_observation_dataset_foundation.sql'));
  psql(db, migration('_algo6_l6_training_readiness_monitoring.sql'));
  psql(db, `insert into public.videos(id,user_id,video_url,caption,created_at) values
    ('${ids.video}','${ids.creator}','https://example.test/l6f4-a.mp4','l6f4 a',clock_timestamp()-interval '3 days'),
    ('${ids.secondVideo}','${ids.creator}','https://example.test/l6f4-b.mp4','l6f4 b',clock_timestamp()-interval '2 days'),
    ('${ids.selfVideo}','${ids.viewer}','https://example.test/l6f4-self.mp4','l6f4 self',clock_timestamp()-interval '1 day');`);
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function seedObservation(db, {
  viewer = ids.viewer,
  session = ids.session,
  video = ids.video,
  creator = ids.creator,
  created = "clock_timestamp()-interval '25 hours'",
  snapshotValue = snapshot,
} = {}) {
  const decision = randomUUID();
  const event = randomUUID();
  psql(db, `insert into private.organic_ranking_decisions(
      id,viewer_user_id,client_session_id,feed_as_of,ranking_mode,policy_version,
      base_policy_version,canary_generation,canary_target_layer,directed_canary,
      production_rollout_bps,candidate_count,returned_count,requested_limit,
      effective_page_limit,observation_schema_version,feature_contract_version,created_at
    ) values(
      '${decision}',${viewer ? `'${viewer}'` : 'null'},'${session}',${created},'chronological',
      'nelyon-algo-l1-v1','nelyon-algo-l1-v1',14,'l5',false,0,1,1,10,10,
      'organic-ranking-observation-v1','organic-ranking-features-l1-l5-v1',${created}
    );
    insert into private.organic_ranking_items(
      decision_id,organic_position,video_id,creator_id,is_self_authored,
      rank_score,delivery_score,feature_snapshot
    ) values(
      '${decision}',1,'${video}','${creator}',${viewer === creator},1,1,
      '${JSON.stringify(snapshotValue)}'::jsonb
    );
    insert into private.organic_ranking_impressions(
      client_event_id,decision_id,organic_position,video_id,viewer_user_id,
      client_session_id,surface_position,viewability_contract_version,
      visible_percent_threshold,created_at
    ) values(
      '${event}','${decision}',1,'${video}',${viewer ? `'${viewer}'` : 'null'},
      '${session}',1,'organic-feed-viewability-75pct-v1',75,${created}
    );`);
  return { decision, event, viewer, session, video, creator };
}

function insertView(db, observation, {
  video = observation.video,
  viewer = observation.viewer,
  session = observation.session,
  watch = 500,
  media = 1000,
  ratio = '0.500000',
  completed = false,
  rewatch = 0,
  exit = 'swipe',
} = {}) {
  psql(db, `insert into public.video_views(
      video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
      media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
    ) values(
      '${video}',${viewer ? `'${viewer}'` : 'null'},'${observation.event}','${session}',${watch},
      ${media ?? 'null'},${ratio ?? 'null'},${completed === null ? 'null' : completed},${rewatch},'${exit}',
      clock_timestamp()-interval '24 hours'
    );`);
}

function readiness(db, options = {}) {
  return JSON.parse(lastLine(actorCall(db, 'service_role',
    'select public.get_algo6_l6_training_readiness_v1()', options)));
}

function reconciler(db) {
  return JSON.parse(lastLine(actorCall(db, 'service_role', 'select public.reconcile_algo_l1_v1()')));
}

test('readiness migration compiles, returns a healthy empty NOT_READY contract, and enforces ACL',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const result = readiness(db);
      assert.equal(result.contract_version, 'algo6-l6-training-readiness-v1');
      assert.equal(result.overall_status, 'NOT_READY');
      assert.equal(result.training_entry_ready, false);
      assert.equal(result.global_gates.unique_visible_organic_impressions.current, 0);
      assert.equal(result.data_quality.visible_impressions_total, 0);
      assert.equal(result.data_quality.structural_failure_count, 0);
      assertRejected(actorCall(db, 'anon',
        'select public.get_algo6_l6_training_readiness_v1()', { allowFailure: true }), 'permission denied');
      assertRejected(actorCall(db, 'authenticated',
        'select public.get_algo6_l6_training_readiness_v1()', { allowFailure: true }), 'permission denied');
      for (const table of ['organic_ranking_decisions','organic_ranking_items',
        'organic_ranking_impressions','organic_ranking_engagement_events']) {
        assertRejected(actorCall(db, 'authenticated', `select count(*) from private.${table}`,
          { allowFailure: true }), 'permission denied');
      }
    } finally { dropDatabase(db); }
  });

test('maturity, censored views, exact identity and valid-retention semantics are conservative',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const mature = seedObservation(db);
      const immature = seedObservation(db, { video: ids.secondVideo, created: "clock_timestamp()-interval '23 hours'" });
      let result = readiness(db);
      assert.equal(result.data_quality.mature_impressions, 1);
      assert.equal(result.data_quality.immature_impressions, 1);
      assert.equal(result.data_quality.unlinked_mature_impressions, 1);
      assert.equal(result.global_gates.valid_retention_samples.current, 0);
      insertView(db, mature, { watch: 1500, media: 1000, ratio: '1.500000', completed: true, rewatch: 0 });
      result = readiness(db);
      assert.equal(result.data_quality.finalized_view_links, 1);
      assert.equal(result.global_gates.valid_retention_samples.current, 1);
      assert.equal(result.head_monitoring.long_watch.positive_source_count, 1);
      assert.equal(result.data_quality.unlinked_mature_impressions, 0);

      psql(db, `update public.video_views set media_duration_ms=null,completion_ratio=null,completed=null,rewatch_count=0
        where client_event_id='${mature.event}'`);
      assert.equal(readiness(db).global_gates.valid_retention_samples.current, 0);
      psql(db, `update public.video_views set media_duration_ms=1000,completion_ratio=1.5,completed=true
        where client_event_id='${mature.event}'`);

      const wrongVideo = seedObservation(db, { video: ids.secondVideo });
      insertView(db, wrongVideo, { video: ids.video });
      const wrongSession = seedObservation(db, { video: ids.secondVideo });
      insertView(db, wrongSession, { session: ids.otherSession });
      const wrongViewer = seedObservation(db, { video: ids.secondVideo });
      insertView(db, wrongViewer, { viewer: ids.other });
      result = readiness(db);
      assert.equal(result.data_quality.wrong_video_joins, 1);
      assert.equal(result.data_quality.wrong_session_joins, 1);
      assert.equal(result.data_quality.wrong_viewer_joins, 1);
      assert.equal(result.overall_status, 'STRUCTURAL_FAILURE');
      assert.equal(result.training_entry_ready, false);
      assert.equal(result.global_gates.valid_retention_samples.current, 1);
      assert.ok(immature.event);
    } finally { dropDatabase(db); }
  });

test('the inclusive 24-hour maturity boundary uses a frozen database timestamp',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const anchor = lastLine(psql(db, 'select clock_timestamp()'));
      const boundary = seedObservation(db, {
        created: `'${anchor}'::timestamptz-interval '24 hours'`,
      });
      seedObservation(db, {
        video: ids.secondVideo,
        created: `'${anchor}'::timestamptz-interval '23 hours 59 minutes'`,
      });
      assert.equal(lastLine(psql(db, `select created_at='${anchor}'::timestamptz-interval '24 hours'
        from private.organic_ranking_impressions where client_event_id='${boundary.event}'`)), 't');
      const result = readiness(db);
      assert.equal(result.data_quality.mature_impressions, 1);
      assert.equal(result.data_quality.immature_impressions, 1);
    } finally { dropDatabase(db); }
  });

test('identity, snapshot, contract, timestamp and decision-shape corruption are structural',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const good = seedObservation(db);
      let result = readiness(db);
      assert.equal(result.data_quality.malformed_feature_snapshots, 0);
      assert.equal(result.data_quality.unknown_feature_keys, 0);

      psql(db, `update private.organic_ranking_items set feature_snapshot=feature_snapshot||'{"extra_key":1}'::jsonb
        where decision_id='${good.decision}'`);
      result = readiness(db);
      assert.equal(result.data_quality.unknown_feature_keys, 1);
      assert.equal(result.data_quality.malformed_feature_snapshots, 1);
      psql(db, `update private.organic_ranking_items set feature_snapshot=feature_snapshot-'extra_key'-'save_points'
        where decision_id='${good.decision}'`);
      assert.equal(readiness(db).data_quality.malformed_feature_snapshots, 1);
      psql(db, `update private.organic_ranking_items set feature_snapshot=feature_snapshot||'{"save_points":"bad"}'::jsonb
        where decision_id='${good.decision}'`);
      assert.equal(readiness(db).data_quality.malformed_feature_snapshots, 1);

      psql(db, `alter table private.organic_ranking_decisions drop constraint organic_ranking_decisions_observation_schema_version_check;
        update private.organic_ranking_decisions set observation_schema_version='bad-v0' where id='${good.decision}';`);
      result = readiness(db);
      assert.equal(result.data_quality.invalid_observation_contract_versions, 1);
      psql(db, `alter table private.organic_ranking_decisions drop constraint organic_ranking_decisions_feature_contract_version_check;
        update private.organic_ranking_decisions set feature_contract_version='bad-v0' where id='${good.decision}';
        update private.organic_ranking_impressions set created_at=clock_timestamp()+interval '1 hour'
        where client_event_id='${good.event}';
        update private.organic_ranking_decisions set returned_count=0 where id='${good.decision}';`);
      result = readiness(db);
      assert.equal(result.data_quality.invalid_feature_contract_versions, 1);
      assert.ok(result.data_quality.future_dated_observation_rows >= 1);
      assert.equal(result.data_quality.decision_item_count_mismatches, 1);
      assert.equal(result.overall_status, 'STRUCTURAL_FAILURE');

      psql(db, `alter table private.organic_ranking_engagement_events
          drop constraint organic_ranking_engagement_even_impression_client_event_id_fkey;
        alter table private.organic_ranking_impressions drop constraint organic_ranking_impressions_pkey;
        insert into private.organic_ranking_impressions select * from private.organic_ranking_impressions
          where client_event_id='${good.event}';`);
      result = readiness(db);
      assert.equal(result.data_quality.visible_impressions_total,
        result.data_quality.unique_impression_client_event_ids + 1);
      assert.equal(result.data_quality.duplicate_impression_identities, 1);
      assert.equal(result.overall_status, 'STRUCTURAL_FAILURE');
    } finally { dropDatabase(db); }
  });

test('mature external engagement positives, reversals, self rows and attribution windows remain distinct',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      const external = seedObservation(db);
      const self = seedObservation(db, { viewer: ids.viewer, video: ids.selfVideo, creator: ids.viewer });
      const add = (observation, action, created) => psql(db, `insert into private.organic_ranking_engagement_events(
          client_action_id,impression_client_event_id,decision_id,video_id,creator_id,
          viewer_user_id,client_session_id,action,attribution_contract_version,created_at
        ) values(
          '${randomUUID()}','${observation.event}','${observation.decision}','${observation.video}',
          '${observation.creator}','${observation.viewer}','${observation.session}','${action}',
          'organic-engagement-24h-v1',${created}
        )`);
      add(external, 'like', "clock_timestamp()-interval '24 hours'");
      add(external, 'save', "clock_timestamp()-interval '24 hours'");
      add(external, 'follow', "clock_timestamp()-interval '24 hours'");
      add(external, 'unlike', "clock_timestamp()-interval '24 hours'");
      add(external, 'unsave', "clock_timestamp()-interval '24 hours'");
      add(external, 'unfollow', "clock_timestamp()-interval '24 hours'");
      add(self, 'like', "clock_timestamp()-interval '24 hours'");
      add(external, 'save', "clock_timestamp()+interval '2 hours'");
      const result = readiness(db);
      assert.equal(result.head_monitoring.like.external_mature_positive_count, 1);
      assert.equal(result.head_monitoring.save.external_mature_positive_count, 1);
      assert.equal(result.head_monitoring.follow.external_mature_event_count, 1);
      assert.equal(result.head_monitoring.reversals.unlike, 1);
      assert.equal(result.head_monitoring.reversals.unsave, 1);
      assert.equal(result.head_monitoring.reversals.unfollow, 1);
      assert.equal(result.data_quality.self_authored_engagement_rows, 1);
      assert.equal(result.data_quality.engagement_events_outside_attribution_window, 1);
      assert.equal(result.overall_status, 'STRUCTURAL_FAILURE');
    } finally { dropDatabase(db); }
  });

test('production-shaped 28/28 fixture reports exact quality while every training gate stays NOT_READY',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      for (let index = 0; index < 28; index += 1) {
        const observation = seedObservation(db, {
          video: index % 2 === 0 ? ids.video : ids.secondVideo,
          created: "clock_timestamp()-interval '25 hours'",
        });
        insertView(db, observation, index % 4 === 0
          ? { watch: 1000, media: 1000, ratio: '1.000000', completed: true }
          : {});
      }
      const result = readiness(db);
      assert.equal(result.data_quality.visible_impressions_total, 28);
      assert.equal(result.data_quality.unique_impression_client_event_ids, 28);
      assert.equal(result.data_quality.finalized_view_links, 28);
      assert.equal(result.data_quality.view_link_coverage_ratio, 1);
      assert.equal(result.data_quality.structural_failure_count, 0);
      assert.equal(result.overall_status, 'NOT_READY');
      assert.equal(result.training_entry_ready, false);
      for (const gate of Object.values(result.global_gates)) assert.equal(gate.status, 'NOT_READY');
      for (const name of ['long_watch','completion','early_exit','rewatch','like','save']) {
        assert.match(result.head_monitoring[name].label_contract_status,
          /PROVISIONAL_LABEL_CONTRACT|PENDING_FINAL_LABEL_CONTRACT/);
      }
      assert.equal(result.temporal_split.validation_sparse_support.status, 'NOT_EVALUABLE');
      assert.equal(result.temporal_split.untouched_test_sparse_support.status, 'NOT_EVALUABLE');
    } finally { dropDatabase(db); }
  });

test('reconciler grows from 65 to 68 and flags authority, contract and forbidden dependency corruption',
  { skip: !enabled, timeout: 420000 }, () => {
    const db = createDatabase();
    try {
      let rec = reconciler(db);
      assert.equal(Object.keys(rec).length, 68);
      assert.deepEqual(Object.entries(rec).filter(([, value]) => value !== 0), []);

      const missing = JSON.parse(lastLine(psql(db, `begin;
        drop function public.get_algo6_l6_training_readiness_v1();
        select public.reconcile_algo_l1_v1();rollback;`)));
      assert.equal(missing.l6_training_readiness_authority_missing, 1);

      const malformed = JSON.parse(lastLine(psql(db, `begin;
        create or replace function public.get_algo6_l6_training_readiness_v1()
        returns jsonb language sql security definer set search_path=''
        as $$select '{}'::jsonb$$;
        revoke all on function public.get_algo6_l6_training_readiness_v1()
          from public,anon,authenticated,service_role;
        grant execute on function public.get_algo6_l6_training_readiness_v1() to service_role;
        select public.reconcile_algo_l1_v1();rollback;`)));
      assert.equal(malformed.l6_training_readiness_contract_invalid, 1);

      const forbidden = JSON.parse(lastLine(psql(db, `begin;
        create or replace function public.get_algo6_l6_training_readiness_v1()
        returns jsonb language sql security definer set search_path=''
        as $$select jsonb_build_object(
          'contract_version','algo6-l6-training-readiness-v1',
          'financial_probe',(select count(*) from public.financial_transactions)
        )$$;
        revoke all on function public.get_algo6_l6_training_readiness_v1()
          from public,anon,authenticated,service_role;
        grant execute on function public.get_algo6_l6_training_readiness_v1() to service_role;
        select public.reconcile_algo_l1_v1();rollback;`)));
      assert.equal(forbidden.l6_training_readiness_forbidden_dependency_present, 1);
      rec = reconciler(db);
      assert.deepEqual(Object.entries(rec).filter(([, value]) => value !== 0), []);
    } finally { dropDatabase(db); }
  });

test('gate-scale readiness stays set-based and blocked by unresolved label contracts',
  { skip: !performanceEnabled, timeout: 900000 }, t => {
    const db = createDatabase();
    try {
      const snapshotJson = JSON.stringify(snapshot).replaceAll("'", "''");
      psql(db, `
        create temporary table l6_perf_users as
          select g, pg_catalog.md5('l6f4-user-'||g::text)::uuid as id
          from pg_catalog.generate_series(1,2000) g;
        insert into auth.users(id) select id from l6_perf_users;
        insert into public.user_profiles(id,username,is_private)
          select id,'l6f4_perf_user_'||g::text,false from l6_perf_users;

        create temporary table l6_perf_videos as
          select g,
            pg_catalog.md5('l6f4-video-'||g::text)::uuid as id,
            pg_catalog.md5('l6f4-user-'||((((g-1)%200)+1))::text)::uuid as creator_id
          from pg_catalog.generate_series(1,2000) g;
        insert into public.videos(id,user_id,video_url,caption,created_at)
          select id,creator_id,'https://example.test/perf/'||g::text||'.mp4','perf',
            clock_timestamp()-interval '120 days'
          from l6_perf_videos;

        insert into private.organic_ranking_decisions(
          id,viewer_user_id,client_session_id,feed_as_of,ranking_mode,policy_version,
          base_policy_version,canary_generation,canary_target_layer,directed_canary,
          production_rollout_bps,candidate_count,returned_count,requested_limit,
          effective_page_limit,observation_schema_version,feature_contract_version,created_at
        )
        select
          pg_catalog.md5('l6f4-decision-'||g::text)::uuid,
          pg_catalog.md5('l6f4-user-'||((((g-1)%2000)+1))::text)::uuid,
          pg_catalog.md5('l6f4-session-'||g::text)::uuid,
          clock_timestamp()-interval '100 days'+(((g-1)%90)::text||' days')::interval,
          'chronological','nelyon-algo-l1-v1','nelyon-algo-l1-v1',14,'l5',false,
          0,5,5,10,10,'organic-ranking-observation-v1',
          'organic-ranking-features-l1-l5-v1',
          clock_timestamp()-interval '100 days'+(((g-1)%90)::text||' days')::interval
        from pg_catalog.generate_series(1,50000) g;

        insert into private.organic_ranking_items(
          decision_id,organic_position,video_id,creator_id,is_self_authored,
          rank_score,delivery_score,feature_snapshot
        )
        select
          pg_catalog.md5('l6f4-decision-'||d::text)::uuid,
          p,
          video.id,
          video.creator_id,
          video.creator_id = pg_catalog.md5('l6f4-user-'||((((d-1)%2000)+1))::text)::uuid,
          (100-p)::numeric,(100-p)::numeric,'${snapshotJson}'::jsonb
        from pg_catalog.generate_series(1,50000) d
        cross join pg_catalog.generate_series(1,5) p
        join l6_perf_videos video
          on video.g = ((((d-1)*5+p-1)%2000)+1);

        insert into private.organic_ranking_impressions(
          client_event_id,decision_id,organic_position,video_id,viewer_user_id,
          client_session_id,surface_position,viewability_contract_version,
          visible_percent_threshold,created_at
        )
        select
          pg_catalog.md5('l6f4-event-'||d.id::text||'-'||item.organic_position::text)::uuid,
          d.id,item.organic_position,item.video_id,d.viewer_user_id,d.client_session_id,
          item.organic_position,'organic-feed-viewability-75pct-v1',75,d.created_at
        from private.organic_ranking_decisions d
        join private.organic_ranking_items item on item.decision_id=d.id;

        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        )
        select i.video_id,i.viewer_user_id,i.client_event_id,i.client_session_id,
          600,1000,0.600000,false,0,'swipe',i.created_at+interval '5 minutes'
        from private.organic_ranking_impressions i
        order by i.client_event_id
        limit 100000;

        analyze private.organic_ranking_decisions;
        analyze private.organic_ranking_items;
        analyze private.organic_ranking_impressions;
        analyze private.organic_ranking_engagement_events;
        analyze public.video_views;
      `);

      const result = readiness(db, { statementTimeout: '120s' });
      assert.equal(result.data_quality.visible_impressions_total, 250000);
      assert.equal(result.data_quality.unique_impression_client_event_ids, 250000);
      assert.equal(result.global_gates.valid_retention_samples.current, 100000);
      assert.equal(result.global_gates.authenticated_viewers.current, 2000);
      assert.equal(result.global_gates.distinct_videos.current, 2000);
      assert.equal(result.global_gates.distinct_creators.current, 200);
      assert.ok(result.global_gates.continuous_observation_days.current >= 84);
      for (const gate of Object.values(result.global_gates)) assert.equal(gate.status, 'PASS');
      assert.equal(result.data_quality.structural_failure_count, 0);
      assert.equal(result.overall_status, 'NOT_READY');
      assert.equal(result.training_entry_ready, false);
      assert.ok(result.blocking_reasons.includes('unresolved_label_contracts'));

      const readinessPlan = JSON.parse(actorCall(db, 'service_role',
        'explain (analyze,buffers,format json) select public.get_algo6_l6_training_readiness_v1()',
        { statementTimeout: '120s' }).stdout);
      const joinPlan = JSON.parse(psql(db, `explain (analyze,buffers,format json)
        select count(v.client_event_id),count(item.video_id),
          sum(coalesce(v.watch_duration_ms,0))
        from private.organic_ranking_impressions i
        left join public.video_views v on v.client_event_id=i.client_event_id
        left join private.organic_ranking_items item
          on item.decision_id=i.decision_id
         and item.organic_position=i.organic_position
         and item.video_id=i.video_id`).stdout);
      const flatten = plan => {
        const nodes = [];
        const visit = node => {
          nodes.push(node);
          for (const child of node.Plans ?? []) visit(child);
        };
        visit(plan[0].Plan);
        return nodes;
      };
      const joinNodes = flatten(joinPlan);
      const joinTypes = [...new Set(joinNodes.map(node => node['Node Type']))].join(',');
      const maxLoops = Math.max(...joinNodes.map(node => Number(node['Actual Loops'] ?? 0)));
      const joinRows = Number(joinPlan[0].Plan['Actual Rows']);
      const readinessExecutionMs = Number(readinessPlan[0]['Execution Time']);
      const readinessPlanningMs = Number(readinessPlan[0]['Planning Time']);
      const joinExecutionMs = Number(joinPlan[0]['Execution Time']);
      const joinPlanningMs = Number(joinPlan[0]['Planning Time']);
      const sharedHitBlocks = joinNodes.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] ?? 0), 0);
      const sharedReadBlocks = joinNodes.reduce((sum, node) => sum + Number(node['Shared Read Blocks'] ?? 0), 0);
      t.diagnostic(`readiness performance impressions=250000 valid_views=100000 `
        + `rpc_planning_ms=${readinessPlanningMs.toFixed(3)} rpc_execution_ms=${readinessExecutionMs.toFixed(3)} `
        + `join_planning_ms=${joinPlanningMs.toFixed(3)} join_execution_ms=${joinExecutionMs.toFixed(3)} `
        + `shared_hit_blocks=${sharedHitBlocks} shared_read_blocks=${sharedReadBlocks} `
        + `join_rows=${joinRows} max_loops=${maxLoops} node_types=${joinTypes}`);
      assert.ok(readinessExecutionMs < 120000, `readiness runtime ${readinessExecutionMs}ms is unreasonable`);
      assert.ok(joinExecutionMs < 30000, `representative joins ${joinExecutionMs}ms are unreasonable`);
      assert.ok(maxLoops <= 8, `representative plan has N+1-like loop count ${maxLoops}`);
      assert.equal(joinRows, 1);
      assert.ok(joinTypes.includes('Hash Join') || joinTypes.includes('Merge Join'));
    } finally { dropDatabase(db); }
  });
