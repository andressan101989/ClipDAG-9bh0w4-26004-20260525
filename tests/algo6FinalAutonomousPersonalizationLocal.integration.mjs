import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_FINAL_LOCAL === '1';
const performanceEnabled = enabled && process.env.NELYON_ALGO6_FINAL_PERF === '1';
const readinessScaleEnabled = enabled && process.env.NELYON_ALGO6_FINAL_READINESS_SCALE === '1';
const container = process.env.NELYON_ALGO6_FINAL_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_FINAL_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const ids = {
  viewer: 'f1000000-0000-4000-8000-000000000001',
  minor: 'f1000000-0000-4000-8000-000000000002',
  creator: 'f1000000-0000-4000-8000-000000000003',
  viewerB: 'f1000000-0000-4000-8000-000000000004',
  candidate: 'f3000000-0000-4000-8000-000000000001',
  candidateFood: 'f3000000-0000-4000-8000-000000000002',
};

function migration(suffix) {
  const names = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(names.length, 1, `expected exactly one migration ending ${suffix}`);
  return readFileSync(new URL(names[0], migrationDirectory), 'utf8');
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

function actorCall(db, role, actor, sql, options = {}) {
  return psql(db, `begin;set local role ${role};set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${actor ?? ''}';${sql};commit;`,
  { ...options, authenticator: true });
}

function lastLine(result) { return result.stdout.split(/\r?\n/).filter(Boolean).at(-1) ?? ''; }
function json(result) { return JSON.parse(lastLine(result)); }
function rejected(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(pattern, 'i'));
}

function applyAlgoBaseline(db) {
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    update private.algo_l1_policy set canary_enabled=false,canary_generation=2;`);
  for (const suffix of [
    '_algo6_l2_directed_canary.sql','_algo6_l3_quality_retention_antispam.sql',
    '_algo6_l3_directed_canary.sql','_algo6_l4_session_context.sql',
    '_algo6_l4_directed_canary.sql','_algo6_l5_semantic_embedding_foundation.sql',
    '_algo6_l5_f2_multimodal_semantic.sql','_algo6_l5_f3_semantic_affinity_ranking.sql',
  ]) psql(db, migration(suffix));
  psql(db, `update private.algo_l1_policy set policy_version='nelyon-algo-l1-v1',enabled=true,
    canary_enabled=false,canary_target_layer='l4',canary_generation=12,production_rollout_bps=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,l5_semantic_enabled=false`);
  psql(db, migration('_algo6_l5_f4_directed_canary.sql'));
  psql(db, `update private.algo_l1_policy set policy_version='nelyon-algo-l1-v1',enabled=true,
    canary_enabled=false,canary_target_layer='l5',canary_generation=14,production_rollout_bps=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,l5_semantic_enabled=false`);
}

function createDatabase({ macro = true } = {}) {
  const db = `algo6_final_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyAlgoBaseline(db);
  psql(db, `insert into private.advertising_targeting_policy(singleton,policy_version)
    values(true,'nelyon-ads-targeting-v2') on conflict(singleton) do nothing;`);
  psql(db, migration('_ads_v2_plr_10_multisurface_age_targeting.sql'));
  psql(db, migration('_algo6_l6_observation_dataset_foundation.sql'));
  psql(db, migration('_algo6_l6_training_readiness_monitoring.sql'));
  if (macro) {
    for (const suffix of [
      '_algo6_personalization_foundation.sql','_algo6_personalization_ranker_v2.sql',
      '_algo6_l6_training_model_pipeline.sql','_ads_v2_personalization_targeting_v4.sql',
    ]) psql(db, migration(suffix));
  }
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function seedActors(db) {
  psql(db, `set session_replication_role=replica;
    insert into auth.users(id) values('${ids.viewer}'),('${ids.minor}'),('${ids.creator}'),('${ids.viewerB}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.viewer}','final_viewer',false),('${ids.minor}','final_minor',false),
      ('${ids.creator}','final_creator',false),('${ids.viewerB}','final_viewer_b',false);
    insert into private.user_age_eligibility(
      user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
    ) values
      ('${ids.viewer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus','1990-01-01'),
      ('${ids.minor}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_13_17','2012-01-01'),
      ('${ids.creator}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus','1991-01-01'),
      ('${ids.viewerB}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus','1992-01-01');
    insert into public.videos(id,user_id,video_url,caption,created_at) values
      ('${ids.candidate}','${ids.creator}','https://example.test/final.mp4','cars candidate',clock_timestamp()-interval '1 hour'),
      ('${ids.candidateFood}','${ids.creator}','https://example.test/food.mp4','food candidate',clock_timestamp()-interval '1 hour');
    set session_replication_role=origin;`);
}

const selection = `array['cars_motorsport','cars_motorsport_general','technology','technology_general',
  'music','reggaeton']::text[]`;
const foodSelection = `array['food','food_general','travel','travel_general',
  'fitness_wellness','fitness_wellness_general']::text[]`;
const v2FeatureKeys = [
  'freshness_points','follow_points','like_points','comment_points','save_points',
  'completion_points','rewatch_points','exploration_points','same_session_points',
  'short_watch_points','completed_points','repeat_points','creator_affinity_points',
  'l3_quality_points','creator_burst_penalty','duplicate_penalty','l3_adjustment',
  'positive_creator_points','negative_creator_penalty','creator_session_repeat_penalty',
  'l4_context_adjustment','l5_semantic_positive_points','l5_semantic_negative_penalty',
  'l5_semantic_adjustment','explicit_interest_similarity','explicit_interest_points',
  'preferred_language_points','content_region_points','explicit_seed_weight','behavioral_confidence',
];
const v2FeatureSnapshot = JSON.stringify(Object.fromEntries(v2FeatureKeys.map(key => [key, 0])));

function vectorLiteral(axis = 0, value = 1) {
  const values = Array(1024).fill(0);
  values[axis] = value;
  return `'[${values.join(',')}]'::extensions.vector(1024)`;
}

function markSemanticFixtureReady(db) {
  psql(db, `select private.sync_video_semantic_profile_v1('${ids.candidate}');
    select private.sync_video_semantic_profile_v1('${ids.candidateFood}');
    update private.personalization_interest_taxonomy set
      embedding=${vectorLiteral(0)},embedding_status='ready',embedding_attempt_count=1,
      embedding_started_at=null,embedding_completed_at=clock_timestamp(),embedding_last_error_code=null,
      embedding_provider_call_count=1,updated_at=clock_timestamp()
    where slug='cars_motorsport';
    update private.personalization_interest_taxonomy set
      embedding=${vectorLiteral(1)},embedding_status='ready',embedding_attempt_count=1,
      embedding_started_at=null,embedding_completed_at=clock_timestamp(),embedding_last_error_code=null,
      embedding_provider_call_count=1,updated_at=clock_timestamp()
    where slug='food';
    update private.video_semantic_profiles set
      semantic_input_version='video-semantic-v2',status='ready',embedding=${vectorLiteral(0)},detected_language='es',
      attempt_count=1,started_at=null,completed_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
    where video_id='${ids.candidate}';
    update private.video_semantic_profiles set
      semantic_input_version='video-semantic-v2',status='ready',embedding=${vectorLiteral(1)},detected_language='en',
      attempt_count=1,started_at=null,completed_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
    where video_id='${ids.candidateFood}';`);
}

test('final macro compiles and preserves one secured, adaptive authority end to end',
  { skip: !enabled, timeout: 600000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      assert.equal(lastLine(psql(db, `select count(*) from private.personalization_interest_taxonomy where level=1`)), '16');
      assert.ok(Number(lastLine(psql(db, `select count(*) from private.personalization_interest_taxonomy where level=2`))) >= 70);
      assert.equal(lastLine(psql(db, `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='private' and c.relkind='r' and c.relname in(
          'user_personalization_profiles','user_personalization_interests','personalization_interest_taxonomy',
          'algo6_model_versions','advertising_interest_targets')`)), '5');

      const taxonomyJob = json(actorCall(db, 'service_role', null,
        'select row_to_json(job)::text from public.claim_personalization_taxonomy_embedding_jobs_v1(1) job'));
      const firstCompletion = json(psql(db,
        `select public.complete_personalization_taxonomy_embedding_job_v1(
          '${taxonomyJob.interest_id}','${taxonomyJob.embedding_fingerprint}',${vectorLiteral(2)})`));
      const repeatedCompletion = json(psql(db,
        `select public.complete_personalization_taxonomy_embedding_job_v1(
          '${taxonomyJob.interest_id}','${taxonomyJob.embedding_fingerprint}',${vectorLiteral(2)})`));
      assert.equal(firstCompletion.stored, true);
      assert.equal(repeatedCompletion.idempotent, true);
      assert.equal(lastLine(psql(db, `select embedding_provider_call_count from
        private.personalization_interest_taxonomy where id='${taxonomyJob.interest_id}'`)), '1');

      rejected(actorCall(db, 'anon', null, 'select public.get_my_personalization_onboarding_v1()',
        { allowFailure: true }), 'permission denied');
      rejected(actorCall(db, 'authenticated', ids.viewer,
        `select public.save_my_personalization_preferences_v1('es','{}','GLOBAL',array['cars_motorsport'],true,false)`,
        { allowFailure: true }), 'parent_interest_count');
      const saved = json(actorCall(db, 'authenticated', ids.viewer,
        `select public.save_my_personalization_preferences_v1('es',array['en'],'US',${selection},true,true)`));
      assert.equal(saved.saved, true);
      assert.equal(json(actorCall(db, 'authenticated', ids.viewer,
        'select public.get_my_personalization_onboarding_v1()')).completed, false);
      actorCall(db, 'authenticated', ids.viewer,
        `select public.follow_user('${ids.viewer}','${ids.creator}')`);
      assert.equal(json(actorCall(db, 'authenticated', ids.viewer,
        'select public.complete_my_personalization_onboarding_v1()')).completed, true);
      // An intentional edit resets the behavior epoch after required onboarding follows.
      actorCall(db, 'authenticated', ids.viewer,
        `select public.save_my_personalization_preferences_v1('es',array['en'],'US',${selection},true,true)`);

      actorCall(db, 'authenticated', ids.viewerB,
        `select public.save_my_personalization_preferences_v1('en',array['es'],'BR',${foodSelection},true,true)`);
      actorCall(db, 'authenticated', ids.viewerB,
        `select public.follow_user('${ids.viewerB}','${ids.creator}')`);
      actorCall(db, 'authenticated', ids.viewerB,
        'select public.complete_my_personalization_onboarding_v1()');
      actorCall(db, 'authenticated', ids.viewerB,
        `select public.save_my_personalization_preferences_v1('en',array['es'],'BR',${foodSelection},true,true)`);

      markSemanticFixtureReady(db);
      psql(db, `update private.algo_l1_policy set policy_version='nelyon-algo-final-cold-start-test',
        production_rollout_bps=10000,exploration_weight=0,freshness_weight=0,
        l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,l5_semantic_enabled=false
        where singleton;`);
      const coldSessionA = 'f4000000-0000-4000-8000-000000000001';
      const coldSessionB = 'f4000000-0000-4000-8000-000000000002';
      actorCall(db, 'authenticated', ids.viewer,
        `select * from public.get_ranked_feed_l1_v1('${coldSessionA}',10,null,null,null,null,null)`);
      actorCall(db, 'authenticated', ids.viewerB,
        `select * from public.get_ranked_feed_l1_v1('${coldSessionB}',10,null,null,null,null,null)`);
      const coldA = json(psql(db, `select jsonb_object_agg(video_id::text,jsonb_build_object(
          'position',organic_position,'interest',feature_snapshot->'explicit_interest_points',
          'language',feature_snapshot->'preferred_language_points'))
        from private.organic_ranking_items where decision_id=(select id from private.organic_ranking_decisions
          where client_session_id='${coldSessionA}' order by created_at desc limit 1)`));
      const coldB = json(psql(db, `select jsonb_object_agg(video_id::text,jsonb_build_object(
          'position',organic_position,'interest',feature_snapshot->'explicit_interest_points',
          'language',feature_snapshot->'preferred_language_points'))
        from private.organic_ranking_items where decision_id=(select id from private.organic_ranking_decisions
          where client_session_id='${coldSessionB}' order by created_at desc limit 1)`));
      assert.ok(coldA[ids.candidate].position < coldA[ids.candidateFood].position,
        'cars seed must rank the semantically matching car candidate first');
      assert.ok(coldB[ids.candidateFood].position < coldB[ids.candidate].position,
        'food seed must rank the semantically matching food candidate first');
      assert.ok(Number(coldA[ids.candidate].interest) > Number(coldA[ids.candidateFood].interest));
      assert.ok(Number(coldB[ids.candidateFood].interest) > Number(coldB[ids.candidate].interest));
      assert.equal(Number(coldA[ids.candidate].language), 6);
      assert.equal(Number(coldB[ids.candidateFood].language), 6);

      for (const [signalCount, expected] of [[0,1],[5,.75],[10,.5],[15,.25],[20,0]]) {
        psql(db, `delete from public.video_views where viewer_id='${ids.viewer}';
          insert into public.videos(id,user_id,video_url,caption,created_at)
          select md5('decay-video-'||i)::uuid,'${ids.creator}',
            'https://example.test/decay/'||i||'.mp4','decay '||i,clock_timestamp()-make_interval(secs=>i+100)
          from generate_series(1,${signalCount}) i on conflict(id) do nothing;
          insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,
            watch_duration_ms,media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
          select md5('decay-video-'||i)::uuid,'${ids.viewer}',md5('decay-event-${signalCount}-'||i)::uuid,
            md5('decay-session-${signalCount}-'||i)::uuid,800,1000,.8,false,0,'swipe',clock_timestamp()
          from generate_series(1,${signalCount}) i;`);
        actorCall(db, 'authenticated', ids.viewer,
          `select * from public.get_ranked_feed_l1_v1('${randomUUID()}',10,null,null,null,null,null)`);
        const weight = Number(lastLine(psql(db, `select item.feature_snapshot->>'explicit_seed_weight'
          from private.organic_ranking_items item
          join private.organic_ranking_decisions decision on decision.id=item.decision_id
          order by decision.created_at desc,item.organic_position limit 1`)));
        assert.equal(weight, expected, `seed weight for ${signalCount} signals`);
      }

      psql(db, `update private.video_semantic_profiles set
          semantic_input_version='video-semantic-v2',status='ready',embedding=${vectorLiteral(1)},detected_language='en',
          attempt_count=1,started_at=null,completed_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
        where video_id in(select md5('decay-video-'||i)::uuid from generate_series(1,20)i);
        update private.algo_l1_policy set policy_version='nelyon-algo-final-adaptation-test',
          production_rollout_bps=10000,exploration_weight=0,freshness_weight=0,l5_semantic_enabled=true
        where singleton;`);
      const adaptedSession = 'f4000000-0000-4000-8000-000000000003';
      actorCall(db, 'authenticated', ids.viewer,
        `select * from public.get_ranked_feed_l1_v1('${adaptedSession}',50,null,null,null,null,null)`);
      const adapted = json(psql(db, `select jsonb_object_agg(video_id::text,jsonb_build_object(
          'rank_score',rank_score,'seed_weight',feature_snapshot->'explicit_seed_weight',
          'semantic',feature_snapshot->'l5_semantic_adjustment'))
        from private.organic_ranking_items where decision_id=(select id from private.organic_ranking_decisions
          where client_session_id='${adaptedSession}' order by created_at desc limit 1)`));
      assert.equal(Number(adapted[ids.candidate].seed_weight), 0);
      assert.equal(Number(adapted[ids.candidateFood].seed_weight), 0);
      assert.ok(Number(adapted[ids.candidateFood].semantic) > Number(adapted[ids.candidate].semantic),
        'twenty cooking signals must move the behavioral semantic centroid to food');
      assert.ok(Number(adapted[ids.candidateFood].rank_score) > Number(adapted[ids.candidate].rank_score),
        'behavioral adaptation must outrank the original cars seed without a profile mutation job');

      const keys = lastLine(psql(db, `select count(*) from jsonb_object_keys((select item.feature_snapshot
        from private.organic_ranking_items item join private.organic_ranking_decisions decision on decision.id=item.decision_id
        order by decision.created_at desc,item.organic_position limit 1))`));
      assert.equal(keys, '30');
      assert.equal(lastLine(psql(db, `select feature_contract_version from private.organic_ranking_decisions
        order by created_at desc limit 1`)), 'organic-ranking-features-personalization-v2');

      const matureDecision = randomUUID();
      const matureEvent = randomUUID();
      const matureSession = randomUUID();
      const likeAction = randomUUID();
      const unlikeAction = randomUUID();
      psql(db, `insert into private.organic_ranking_decisions(
          id,viewer_user_id,client_session_id,feed_as_of,ranking_mode,policy_version,base_policy_version,
          canary_generation,canary_target_layer,directed_canary,production_rollout_bps,candidate_count,
          returned_count,requested_limit,effective_page_limit,observation_schema_version,
          feature_contract_version,created_at
        ) select '${matureDecision}','${ids.viewer}','${matureSession}',clock_timestamp()-interval '25 hours',
          'behavioral_l1','nelyon-algo-l1-v1','nelyon-algo-l1-v1',14,'l5',false,0,1,1,10,10,
          'organic-ranking-observation-v1','organic-ranking-features-personalization-v2',
          clock_timestamp()-interval '25 hours';
        insert into private.organic_ranking_items(
          decision_id,organic_position,video_id,creator_id,is_self_authored,rank_score,delivery_score,feature_snapshot
        ) select '${matureDecision}',1,'${ids.candidate}','${ids.creator}',false,1,1,item.feature_snapshot
          from private.organic_ranking_items item join private.organic_ranking_decisions decision on decision.id=item.decision_id
          order by decision.created_at desc,item.organic_position limit 1;
        insert into private.organic_ranking_impressions(
          client_event_id,decision_id,organic_position,video_id,viewer_user_id,client_session_id,
          surface_position,viewability_contract_version,visible_percent_threshold,created_at
        ) values('${matureEvent}','${matureDecision}',1,'${ids.candidate}','${ids.viewer}','${matureSession}',1,
          'organic-feed-viewability-75pct-v1',75,clock_timestamp()-interval '25 hours');
        insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
        values('${ids.candidate}','${ids.viewer}','${matureEvent}','${matureSession}',100,1000,.1,false,0,'swipe',
          clock_timestamp()-interval '24 hours 50 minutes');
        insert into private.organic_ranking_engagement_events(client_action_id,impression_client_event_id,
          decision_id,video_id,creator_id,viewer_user_id,client_session_id,action,attribution_contract_version,created_at)
        values
          ('${likeAction}','${matureEvent}','${matureDecision}','${ids.candidate}','${ids.creator}','${ids.viewer}',
            '${matureSession}','like','organic-engagement-24h-v1',clock_timestamp()-interval '24 hours 45 minutes'),
          ('${unlikeAction}','${matureEvent}','${matureDecision}','${ids.candidate}','${ids.creator}','${ids.viewer}',
            '${matureSession}','unlike','organic-engagement-24h-v1',clock_timestamp()-interval '24 hours 40 minutes');`);
      const samplePage = json(actorCall(db, 'service_role', null,
        'select public.get_algo6_l6_training_samples_v1(null,null,100)'));
      const matureSample = samplePage.rows.find(row => row.labels.early_exit === true);
      assert.ok(matureSample);
      assert.equal(matureSample.labels.long_watch, false);
      assert.equal(matureSample.labels.completion, false);
      assert.equal(matureSample.labels.rewatch, false);
      assert.equal(matureSample.labels.like, false, 'LIKE followed by UNLIKE closes as not positive');

      const readiness = json(actorCall(db, 'service_role', null,
        'select public.get_algo6_l6_training_readiness_v2()'));
      assert.equal(readiness.training_entry_ready, false);
      assert.equal(readiness.overall_status, 'NOT_READY');
      rejected(actorCall(db, 'authenticated', ids.viewer,
        'select public.get_algo6_l6_training_readiness_v2()', { allowFailure: true }), 'permission denied');

      const adultTraits = json(psql(db, `select private.resolve_safe_personalization_traits_v1('${ids.viewer}')`));
      assert.equal(adultTraits.eligible, true);
      assert.ok(adultTraits.explicit_interest_slugs.includes('cars_motorsport'));
      actorCall(db, 'authenticated', ids.minor,
        `select public.save_my_personalization_preferences_v1('es','{}','US',${selection},true,true)`);
      actorCall(db, 'authenticated', ids.minor,
        `select public.follow_user('${ids.minor}','${ids.creator}')`);
      actorCall(db, 'authenticated', ids.minor,
        'select public.complete_my_personalization_onboarding_v1()');
      const minorTraits = json(psql(db, `select private.resolve_safe_personalization_traits_v1('${ids.minor}')`));
      assert.equal(minorTraits.eligible, false);
      assert.deepEqual(minorTraits.explicit_interest_slugs, []);
      assert.equal(json(psql(db, `select private.ads_normalize_audience_definition(
        '{"age_scope":"adults_only","interests":[{"mode":"include","slug":"technology","source":"explicit"}]}'::jsonb)`))
        .targeting_policy_version, 'nelyon-ads-targeting-v4');
      rejected(psql(db, `select private.ads_normalize_audience_definition(
        '{"age_scope":"adults_only","interests":[{"mode":"include","slug":"political_ideology","source":"either"}]}'::jsonb)`,
      { allowFailure: true }), 'unknown_interest');

      psql(db, `update private.algo_l1_policy set policy_version='nelyon-algo-l1-v1',
        canary_enabled=false,canary_target_layer='l5',production_rollout_bps=0,
        l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false,l5_semantic_enabled=false,
        l6_ml_enabled=false,l6_active_model_id=null,l6_canary_model_id=null where singleton;`);

      const reconcile = json(actorCall(db, 'service_role', null, 'select public.reconcile_algo_l1_v1()'));
      assert.equal(Object.keys(reconcile).length, 74);
      assert.deepEqual(Object.entries(reconcile).filter(([, value]) => value !== 0), []);
      assert.equal(lastLine(psql(db, `select concat_ws('|',policy_version,canary_enabled,production_rollout_bps,
        l2_affinity_enabled,l3_quality_enabled,l4_context_enabled,l5_semantic_enabled,l6_ml_enabled,
        coalesce(l6_active_model_id::text,'null')) from private.algo_l1_policy where singleton`)),
      'nelyon-algo-l1-v1|f|0|f|f|f|f|f|null');

      const modelOne = randomUUID();
      const modelTwo = randomUUID();
      const payload = JSON.stringify({ heads: Object.fromEntries(
        ['long_watch','completion','early_exit','rewatch','save','like'].map(head =>
          [head,{ intercept: 0, coefficients: {}, calibration_coefficient: 1, calibration_intercept: 0 }]),
      ) });
      psql(db, `insert into private.algo6_model_versions(id,model_version,status,feature_contract_version,
          label_contract_version,training_window_start,training_window_end,training_sample_count,
          head_metrics,model_payload)
        values
          ('${modelOne}','algo6-l6-test-one','candidate','organic-ranking-features-personalization-v2',
            'algo6-l6-label-contract-v1',clock_timestamp()-interval '12 weeks',clock_timestamp()-interval '1 day',250000,
            '{"promotion_eligible":true}'::jsonb,'${payload}'::jsonb),
          ('${modelTwo}','algo6-l6-test-two','candidate','organic-ranking-features-personalization-v2',
            'algo6-l6-label-contract-v1',clock_timestamp()-interval '12 weeks',clock_timestamp()-interval '1 day',250000,
            '{"promotion_eligible":true}'::jsonb,'${payload}'::jsonb);`);
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('candidate_to_canary','${modelOne}',null)`);
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('canary_to_active','${modelOne}',null)`);
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('candidate_to_canary','${modelTwo}',null)`);
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('canary_to_active','${modelTwo}',null)`);
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('rollback','${modelTwo}','${modelOne}')`);
      assert.equal(lastLine(psql(db, `select count(*)||'|'||min(model_version) from private.algo6_model_versions where status='active'`)),
        '1|algo6-l6-test-one');
      actorCall(db, 'service_role', null,
        `select public.manage_algo6_model_v1('active_to_retired','${modelOne}',null)`);
      assert.equal(lastLine(psql(db, `select count(*) from private.algo6_model_versions where status='active'`)), '0');
    } finally {
      dropDatabase(db);
    }
  });

test('readiness V2 becomes READY only after every global, head, split, and integrity gate passes',
  { skip: !readinessScaleEnabled, timeout: 600000 }, () => {
    const db = createDatabase();
    try {
      psql(db, `set session_replication_role=replica;
        insert into auth.users(id)
          select md5('scale-viewer-'||i)::uuid from generate_series(1,2000)i
          union all select md5('scale-creator-'||i)::uuid from generate_series(1,200)i;
        insert into public.user_profiles(id,username,is_private)
          select md5('scale-viewer-'||i)::uuid,'scale_viewer_'||i,false from generate_series(1,2000)i
          union all select md5('scale-creator-'||i)::uuid,'scale_creator_'||i,false from generate_series(1,200)i;
        insert into public.videos(id,user_id,video_url,caption,created_at)
          select md5('scale-video-'||i)::uuid,md5('scale-creator-'||(((i-1)%200)+1))::uuid,
            'https://example.test/scale/'||i||'.mp4','scale video '||i,
            clock_timestamp()-interval '100 days' from generate_series(1,2000)i;
        set session_replication_role=origin;`);

      psql(db, `begin;set local synchronous_commit=off;
        insert into private.organic_ranking_decisions(
          id,viewer_user_id,client_session_id,feed_as_of,ranking_mode,policy_version,base_policy_version,
          canary_generation,canary_target_layer,directed_canary,production_rollout_bps,candidate_count,
          returned_count,requested_limit,effective_page_limit,observation_schema_version,
          feature_contract_version,created_at
        ) select md5('scale-decision-'||i)::uuid,md5('scale-viewer-'||(((i-1)%2000)+1))::uuid,
          md5('scale-session-'||i)::uuid,
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +((i-1)%84)*interval '1 day',
          'behavioral_l1','nelyon-algo-l1-v1','nelyon-algo-l1-v1',14,'l5',false,0,50,50,50,50,
          'organic-ranking-observation-v1','organic-ranking-features-personalization-v2',
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +((i-1)%84)*interval '1 day'
        from generate_series(1,5000)i;

        insert into private.organic_ranking_items(
          decision_id,organic_position,video_id,creator_id,is_self_authored,
          rank_score,delivery_score,feature_snapshot
        ) select md5('scale-decision-'||(((n-1)/50)+1))::uuid,((n-1)%50)+1,
          md5('scale-video-'||(((n-1)%2000)+1))::uuid,
          md5('scale-creator-'||((((n-1)%2000)%200)+1))::uuid,false,0,0,
          '${v2FeatureSnapshot}'::jsonb
        from generate_series(1,250000)n;

        insert into private.organic_ranking_impressions(
          client_event_id,decision_id,organic_position,video_id,viewer_user_id,client_session_id,
          surface_position,viewability_contract_version,visible_percent_threshold,created_at
        ) select md5('scale-event-'||n)::uuid,md5('scale-decision-'||(((n-1)/50)+1))::uuid,
          ((n-1)%50)+1,md5('scale-video-'||(((n-1)%2000)+1))::uuid,
          md5('scale-viewer-'||(((((n-1)/50))%2000)+1))::uuid,
          md5('scale-session-'||(((n-1)/50)+1))::uuid,((n-1)%50)+1,
          'organic-feed-viewability-75pct-v1',75,
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +(((((n-1)/50)+1)-1)%84)*interval '1 day'
        from generate_series(1,250000)n;

        insert into public.video_views(
          video_id,viewer_id,client_event_id,client_session_id,watch_duration_ms,
          media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at
        ) select md5('scale-video-'||(((n-1)%2000)+1))::uuid,
          md5('scale-viewer-'||(((((n-1)/50))%2000)+1))::uuid,
          md5('scale-event-'||n)::uuid,md5('scale-session-'||(((n-1)/50)+1))::uuid,
          case when n%10=0 then 2000 when n%2=0 then 1000 else 100 end,1000,
          case when n%10=0 then 2.0 when n%2=0 then 1.0 else .1 end,n%2=0,
          case when n%10=0 then 1 else 0 end,case when n%2=0 then 'ended' else 'swipe' end,
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +(((((n-1)/50)+1)-1)%84)*interval '1 day'+interval '10 minutes'
        from generate_series(1,100000)n;

        insert into private.organic_ranking_engagement_events(
          client_action_id,impression_client_event_id,decision_id,video_id,creator_id,
          viewer_user_id,client_session_id,action,attribution_contract_version,created_at
        ) select md5('scale-like-'||n)::uuid,md5('scale-event-'||n)::uuid,
          md5('scale-decision-'||(((n-1)/50)+1))::uuid,md5('scale-video-'||(((n-1)%2000)+1))::uuid,
          md5('scale-creator-'||((((n-1)%2000)%200)+1))::uuid,
          md5('scale-viewer-'||(((((n-1)/50))%2000)+1))::uuid,
          md5('scale-session-'||(((n-1)/50)+1))::uuid,'like','organic-engagement-24h-v1',
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +(((((n-1)/50)+1)-1)%84)*interval '1 day'+interval '1 hour'
        from generate_series(20,250000,20)n;

        insert into private.organic_ranking_engagement_events(
          client_action_id,impression_client_event_id,decision_id,video_id,creator_id,
          viewer_user_id,client_session_id,action,attribution_contract_version,created_at
        ) select md5('scale-save-'||n)::uuid,md5('scale-event-'||n)::uuid,
          md5('scale-decision-'||(((n-1)/50)+1))::uuid,md5('scale-video-'||(((n-1)%2000)+1))::uuid,
          md5('scale-creator-'||((((n-1)%2000)%200)+1))::uuid,
          md5('scale-viewer-'||(((((n-1)/50))%2000)+1))::uuid,
          md5('scale-session-'||(((n-1)/50)+1))::uuid,'save','organic-engagement-24h-v1',
          date_trunc('day',clock_timestamp()-interval '1 day')-interval '83 days'
            +(((((n-1)/50)+1)-1)%84)*interval '1 day'+interval '1 hour'
        from generate_series(20,250000,20)n;
        commit;
        analyze private.organic_ranking_decisions;analyze private.organic_ranking_items;
        analyze private.organic_ranking_impressions;analyze private.organic_ranking_engagement_events;
        analyze public.video_views;`);

      const started = performance.now();
      const readiness = json(actorCall(db, 'service_role', null,
        'select public.get_algo6_l6_training_readiness_v2()'));
      console.log(`READINESS_SCALE_MS ${Math.round(performance.now() - started)}`);
      assert.equal(readiness.overall_status, 'READY');
      assert.equal(readiness.training_entry_ready, true);
      assert.equal(readiness.data_quality.structural_failure_count, 0);
      for (const gate of Object.values(readiness.global_gates)) assert.equal(gate.status, 'PASS');
      assert.ok(readiness.head_monitoring.long_watch.positive_count >= 10000);
      assert.ok(readiness.head_monitoring.long_watch.negative_count >= 10000);
      assert.ok(readiness.head_monitoring.completion.positive_count >= 10000);
      assert.ok(readiness.head_monitoring.completion.negative_count >= 10000);
      assert.ok(readiness.head_monitoring.early_exit.positive_count >= 10000);
      assert.ok(readiness.head_monitoring.early_exit.negative_count >= 10000);
      assert.ok(readiness.head_monitoring.rewatch.positive_count >= 5000);
      assert.ok(readiness.head_monitoring.like.positive_count >= 5000);
      assert.ok(readiness.head_monitoring.save.positive_count >= 5000);
      assert.ok(readiness.temporal_split.validation_sparse_support.rewatch >= 500);
      assert.ok(readiness.temporal_split.validation_sparse_support.like >= 500);
      assert.ok(readiness.temporal_split.validation_sparse_support.save >= 500);
      assert.ok(readiness.temporal_split.untouched_test_sparse_support.rewatch >= 500);
      assert.ok(readiness.temporal_split.untouched_test_sparse_support.like >= 500);
      assert.ok(readiness.temporal_split.untouched_test_sparse_support.save >= 500);
    } finally {
      dropDatabase(db);
    }
  });

function percentile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * probability) - 1)];
}

function explainRank(db, viewer, session) {
  const result = actorCall(db, viewer ? 'authenticated' : 'anon', viewer,
    `explain(analyze,buffers,costs off) select * from public.get_ranked_feed_l1_v1('${session}',10,null,null,null,null,null)`);
  const match = result.stdout.match(/Execution Time:\s*([0-9.]+)\s*ms/i);
  assert.ok(match, result.stdout);
  return { milliseconds: Number(match[1]), plan: result.stdout };
}

function seedPerformance(db, macro) {
  const viewer = 'f9000000-0000-4000-8000-000000000001';
  const creator = 'f9000000-0000-4000-8000-000000000002';
  psql(db, `set session_replication_role=replica;
    insert into auth.users(id) values('${viewer}'),('${creator}');
    insert into public.user_profiles(id,username,is_private) values('${viewer}','perf_viewer',false),('${creator}','perf_creator',false);
    insert into private.user_age_eligibility(user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      values('${viewer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus','1990-01-01'),
      ('${creator}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus','1990-01-01');
    alter table public.videos disable trigger user;
    insert into public.videos(id,user_id,video_url,caption,created_at)
      select md5('final-perf-'||i)::uuid,'${creator}','https://example.test/perf/'||i||'.mp4',
        'performance '||i,clock_timestamp()-make_interval(secs=>i) from generate_series(1,30000)i;
    alter table public.videos enable trigger user;
    analyze public.videos;
    set session_replication_role=origin;`);
  if (macro) {
    actorCall(db, 'authenticated', viewer,
      `select public.save_my_personalization_preferences_v1('es','{}','GLOBAL',${selection},true,false)`);
    actorCall(db, 'authenticated', viewer, `select public.follow_user('${viewer}','${creator}')`);
    actorCall(db, 'authenticated', viewer, 'select public.complete_my_personalization_onboarding_v1()');
    actorCall(db, 'authenticated', viewer,
      `select public.save_my_personalization_preferences_v1('es','{}','GLOBAL',${selection},true,false)`);
  }
  return { viewer, creator };
}

test('30k candidate inventory keeps personalization and local L6 inference bounded',
  { skip: !performanceEnabled, timeout: 600000 }, () => {
    const baseDb = createDatabase({ macro: false });
    const macroDb = createDatabase();
    try {
      const base = seedPerformance(baseDb, false);
      const macro = seedPerformance(macroDb, true);
      const sample = (db, viewer, prefix) => Array.from({ length: 25 }, (_, index) =>
        explainRank(db, viewer, `${prefix.slice(0, 8)}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`));
      const baseRuns = sample(baseDb, base.viewer, 'fa000000');
      const coldRuns = sample(macroDb, macro.viewer, 'fb000000');
      psql(macroDb, `insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,
          watch_duration_ms,media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
        select md5('final-perf-'||i)::uuid,'${macro.viewer}',md5('perf-10-event-'||i)::uuid,
          md5('perf-10-session-'||i)::uuid,800,1000,.8,false,0,'swipe',clock_timestamp()
        from generate_series(1,10)i;`);
      const tenSignalRuns = sample(macroDb, macro.viewer, 'fc000000');
      psql(macroDb, `insert into public.video_views(video_id,viewer_id,client_event_id,client_session_id,
          watch_duration_ms,media_duration_ms,completion_ratio,completed,rewatch_count,exit_reason,created_at)
        select md5('final-perf-'||i)::uuid,'${macro.viewer}',md5('perf-20-event-'||i)::uuid,
          md5('perf-20-session-'||i)::uuid,800,1000,.8,false,0,'swipe',clock_timestamp()
        from generate_series(11,20)i;
        update private.algo_l1_policy set l5_semantic_enabled=true,
          policy_version='nelyon-algo-final-perf-l5' where singleton;`);
      const twentySignalRuns = sample(macroDb, macro.viewer, 'fd000000');
      const perfModel = randomUUID();
      const perfPayload = JSON.stringify({ heads: Object.fromEntries(
        ['long_watch','completion','early_exit','rewatch','save','like'].map(head =>
          [head,{ intercept: 0, coefficients: {}, calibration_coefficient: 1, calibration_intercept: 0 }]),
      ) });
      psql(macroDb, `insert into private.algo6_model_versions(id,model_version,status,feature_contract_version,
          label_contract_version,training_window_start,training_window_end,training_sample_count,head_metrics,model_payload)
        values('${perfModel}','algo6-l6-performance-fixture','active','organic-ranking-features-personalization-v2',
          'algo6-l6-label-contract-v1',clock_timestamp()-interval '12 weeks',clock_timestamp()-interval '1 day',250000,
          '{"promotion_eligible":true}'::jsonb,'${perfPayload}'::jsonb);
        update private.algo_l1_policy set l6_ml_enabled=true,l6_active_model_id='${perfModel}',
          policy_version='nelyon-algo-final-perf-l6' where singleton;`);
      const l6Runs = sample(macroDb, macro.viewer, 'fe000000');
      const summary = runs => ({ median: percentile(runs.map(run => run.milliseconds), .5),
        p95: percentile(runs.map(run => run.milliseconds), .95) });
      const plan = coldRuns[0].plan;
      assert.doesNotMatch(plan, /Seq Scan on organic_ranking_(?:decisions|items|impressions)/i);
      assert.match(plan, /Limit|Function Scan/i);
      const result = {
        base: summary(baseRuns), cold: summary(coldRuns),
        tenSignals: summary(tenSignalRuns), twentySignalsL5: summary(twentySignalRuns),
        syntheticL6: summary(l6Runs),
      };
      console.log(`PERF ${JSON.stringify(result)}`);
      assert.ok(result.cold.median - result.base.median < 20, JSON.stringify(result));
      assert.ok(result.cold.p95 - result.base.p95 < 50, JSON.stringify(result));
      assert.ok(result.syntheticL6.p95 - result.base.p95 < 75, JSON.stringify(result));
    } finally {
      dropDatabase(baseDb);
      dropDatabase(macroDb);
    }
  });
