import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L5_F2_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L5_F2_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L5_F2_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const viewer = '7b000000-0000-4000-8000-000000000001';
const creator = '7b000000-0000-4000-8000-000000000002';
const session = '7b000000-0000-4000-8000-000000000003';

function migration(suffix) {
  const matches = readdirSync(migrationDirectory).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 192 * 1024 * 1024 });
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

function psqlAsync(db, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q',
      '-v', 'ON_ERROR_STOP=1', '-U', owner, '-d', db, '-At'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      : reject(new Error(`concurrent psql failed\n${stdout}\n${stderr}`)));
    child.stdin.end(sql);
  });
}

function rows(result) { return result.stdout.split(/\r?\n/).filter(Boolean); }
function lastLine(result) { return rows(result).at(-1) ?? ''; }

function actorCall(db, role, sql, { allowFailure = false } = {}) {
  return psql(db, `begin;set local role ${role};set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${viewer}';${sql};commit;`,
  { allowFailure, authenticator: true });
}

function applyAlgoThroughL4(db) {
  for (const suffix of [
    '_algo6_l1_f0_signal_eligibility_foundation.sql',
    '_algo6_l1_behavioral_ranking.sql',
    '_algo6_l1_controlled_canary.sql',
    '_algo6_l2_creator_affinity.sql',
  ]) psql(db, migration(suffix));
  psql(db, `
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age)
      values(true,13,'nelyon-age-v2',18) on conflict(singleton) do nothing;
    insert into auth.users(id) values('70000000-0000-4000-8000-000000000001');
    insert into public.user_profiles(id,username,is_private)
      values('70000000-0000-4000-8000-000000000001','l5f2_bootstrap',false);
    update private.algo_l1_policy set
      canary_enabled=false,canary_user_id='70000000-0000-4000-8000-000000000001',
      canary_request_id='70000000-0000-4000-8000-000000000002',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',canary_generation=2;
  `);
  for (const suffix of [
    '_algo6_l2_directed_canary.sql', '_algo6_l3_quality_retention_antispam.sql',
    '_algo6_l3_directed_canary.sql', '_algo6_l4_session_context.sql',
    '_algo6_l4_directed_canary.sql',
  ]) psql(db, migration(suffix));
  psql(db, `update private.algo_l1_policy set
    policy_version='nelyon-algo-l1-v1',canary_enabled=false,canary_target_layer='l4',
    canary_generation=12,production_rollout_bps=0,l2_affinity_enabled=false,
    l3_quality_enabled=false,l4_context_enabled=false`);
}

function createDatabase({ applyF2 = true } = {}) {
  const db = `algo6_l5f2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyAlgoThroughL4(db);
  psql(db, migration('_algo6_l5_semantic_embedding_foundation.sql'));
  if (applyF2) psql(db, migration('_algo6_l5_f2_multimodal_semantic.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function seedActors(db) {
  psql(db, `insert into auth.users(id) values('${viewer}'),('${creator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${viewer}','l5f2_viewer',false),('${creator}','l5f2_creator',false)`);
}

function insertVideo(db, key, caption = `Visual ${key}`) {
  psql(db, `insert into public.videos(id,user_id,video_url,caption,created_at)
    values(md5('${key}')::uuid,'${creator}','https://example.test/${key}.mp4',
      '${caption.replaceAll("'", "''")}',clock_timestamp())`);
  return lastLine(psql(db, `select md5('${key}')::uuid`));
}

function streamSource(db, videoId, key, { duration = 40 } = {}) {
  const assetId = lastLine(psql(db, `select md5('${key}-stream')::uuid`));
  psql(db, `insert into public.video_assets(
      id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,
      size_bytes,original_filename,max_duration_seconds,duration_seconds,hls_url,
      provider_metadata,ready_at
    ) values(
      '${assetId}','${creator}','cloudflare_stream','feed_video','public','ready',
      '${key.replaceAll('-', '')}abcdef123456','video/mp4',2048,'${key}.mp4',60,${duration},
      'https://customer-example.cloudflarestream.com/${key}/manifest/video.m3u8','{}',clock_timestamp()
    );
    insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position)
      values('${assetId}','${creator}','video_post','${videoId}','video',0)`);
  return assetId;
}

function imageSource(db, videoId, key) {
  const assetId = lastLine(psql(db, `select md5('${key}-image')::uuid`));
  psql(db, `insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,original_filename,status,ready_at,public_url
    ) values(
      '${assetId}','${creator}','r2','image','feed_media','public','public',
      'videos/${key}.jpg','image/jpeg',2048,'${key}.jpg','ready',clock_timestamp(),
      'https://public.example.test/videos/${key}.jpg'
    );
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
      values('${assetId}','video_post','${videoId}','media',0)`);
  return assetId;
}

function refresh(db, videoId) {
  return actorCall(db, 'service_role', `select public.refresh_video_semantic_profile_v1('${videoId}')::text`);
}

function profile(db, videoId) {
  return JSON.parse(lastLine(psql(db, `select to_jsonb(p)::text from private.video_semantic_profiles p
    where p.video_id='${videoId}'`)));
}

function claimVisual(db, limit = 2) {
  return rows(psql(db, `select row_to_json(j)::text from public.claim_video_semantic_visual_v1(${limit}) j`))
    .map(JSON.parse);
}

function claimEmbedding(db, limit = 8) {
  return rows(psql(db, `select row_to_json(j)::text from public.claim_video_semantic_profiles_v1(${limit}) j`))
    .map(JSON.parse);
}

function rankedSql(asOf) {
  return `select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb)::text
    from public.get_ranked_feed_l1_v1(
      '${session}',50,'${asOf}',999999,'9999-12-31T23:59:59Z',
      'ffffffff-ffff-ffff-ffff-ffffffffffff','nelyon-algo-l1-v1'
    ) r`;
}

test('F2 migration is dormant and visual lifecycle enriches v2 without changing ranking',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase({ applyF2: false });
    try {
      seedActors(db);
      const existing = insertVideo(db, 'f2-existing', 'Existing caption');
      psql(db, 'delete from private.video_semantic_profiles');
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      const before = lastLine(actorCall(db, 'anon', rankedSql(asOf)));
      psql(db, migration('_algo6_l5_f2_multimodal_semantic.sql'));
      assert.equal(lastLine(psql(db, 'select count(*) from private.video_semantic_profiles')), '0');
      assert.equal(lastLine(actorCall(db, 'anon', rankedSql(asOf))), before);

      refresh(db, existing);
      const noSource = profile(db, existing);
      assert.equal(noSource.semantic_input_version, 'video-semantic-v2');
      assert.equal(noSource.visual_semantic_status, 'not_configured');
      assert.deepEqual(JSON.parse(lastLine(psql(db,
        `select private.video_semantic_input_v2('${existing}')::text`))).components, ['caption']);

      const video = insertVideo(db, 'f2-stream', '  Cooking   dinner  ');
      streamSource(db, video, 'f2-stream');
      refresh(db, video);
      const pending = profile(db, video);
      assert.equal(pending.visual_semantic_status, 'pending');
      assert.match(pending.visual_source_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(claimEmbedding(db, 25).some(job => job.video_id === video), false,
        'embedding must wait while visual is pending');

      const visualJob = claimVisual(db, 5).find(job => job.video_id === video);
      assert.ok(visualJob);
      assert.equal(visualJob.visual_source_kind, 'eligible_stream_video');
      const canonical = 'summary:\ncooking food in a kitchen\n\ntopics:\ncooking, food\n\nobjects:\npan, vegetables\n\nactivities:\ncooking\n\nsetting:\nkitchen';
      const completed = JSON.parse(lastLine(psql(db, `select public.complete_video_semantic_visual_v1(
        '${video}','${visualJob.visual_source_fingerprint}','${canonical.replaceAll("'", "''")}',
        array[2000,10000,20000,30000,38000],5
      )::text`)));
      assert.equal(completed.status, 'ready');
      const ready = profile(db, video);
      assert.equal(ready.visual_semantic_status, 'ready');
      assert.equal(ready.visual_provider_call_count, 5);
      const v2 = JSON.parse(lastLine(psql(db, `select private.video_semantic_input_v2('${video}')::text`)));
      assert.deepEqual(v2.components, ['caption', 'visual']);
      assert.match(v2.input_text, /^caption:\nCooking dinner\n\nvisual:\nsummary:/);
      assert.ok(v2.input_text.length <= 18000);
      assert.ok(claimEmbedding(db, 25).some(job => job.video_id === video));

      psql(db, `update public.videos set caption='Changed caption',edited_at=clock_timestamp()
        where id='${video}'`);
      const captionChanged = profile(db, video);
      assert.equal(captionChanged.visual_semantic_status, 'ready');
      assert.equal(captionChanged.visual_source_fingerprint, ready.visual_source_fingerprint);
      assert.equal(captionChanged.visual_semantic_text, ready.visual_semantic_text);
      assert.notEqual(captionChanged.semantic_input_fingerprint, ready.semantic_input_fingerprint);
      assert.equal(captionChanged.embedding, null);
    } finally { dropDatabase(db); }
  });

test('visual source changes and failures are stale-safe while terminal state releases text embedding',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      const video = insertVideo(db, 'f2-stale', 'Mountain trail');
      const firstAsset = streamSource(db, video, 'f2-stale-a');
      refresh(db, video);
      const first = claimVisual(db, 5).find(job => job.video_id === video);
      assert.ok(first);

      const secondAsset = lastLine(psql(db, `select md5('f2-stale-b-stream')::uuid`));
      psql(db, `insert into public.video_assets(
          id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
          original_filename,max_duration_seconds,duration_seconds,hls_url,provider_metadata,ready_at
        ) values('${secondAsset}','${creator}','cloudflare_stream','feed_video','public','ready',
          'f2stalebabcdef123456','video/mp4',2048,'b.mp4',60,30,
          'https://customer-example.cloudflarestream.com/f2-stale-b/manifest/video.m3u8',
          '{}',clock_timestamp());
        update public.video_asset_links set asset_id='${secondAsset}'
          where asset_id='${firstAsset}' and entity_id='${video}'`);
      refresh(db, video);
      const changed = profile(db, video);
      assert.equal(changed.visual_semantic_status, 'pending');
      assert.notEqual(changed.visual_source_fingerprint, first.visual_source_fingerprint);
      assert.equal(changed.visual_semantic_text, null);
      const stale = JSON.parse(lastLine(psql(db, `select public.complete_video_semantic_visual_v1(
        '${video}','${first.visual_source_fingerprint}','summary:\\nold',array[1000],1
      )::text`)));
      assert.equal(stale.status, 'stale');
      assert.equal(profile(db, video).visual_semantic_text, null);

      const current = claimVisual(db, 5).find(job => job.video_id === video);
      assert.ok(current);
      const failed = JSON.parse(lastLine(psql(db, `select public.fail_video_semantic_visual_v1(
        '${video}','${current.visual_source_fingerprint}','provider_rejected',false,1
      )::text`)));
      assert.equal(failed.status, 'failed');
      const terminal = profile(db, video);
      assert.equal(terminal.visual_semantic_status, 'failed');
      assert.equal(terminal.visual_provider_call_count, 1);
      assert.ok(claimEmbedding(db, 25).some(job => job.video_id === video),
        'terminal visual failure must release text-only embedding');

      const image = insertVideo(db, 'f2-image', 'Beach sunset');
      imageSource(db, image, 'f2-image');
      refresh(db, image);
      const imageJob = claimVisual(db, 5).find(job => job.video_id === image);
      assert.ok(imageJob);
      assert.equal(imageJob.visual_source_kind, 'eligible_image');
      const imageReady = JSON.parse(lastLine(psql(db, `select public.complete_video_semantic_visual_v1(
        '${image}','${imageJob.visual_source_fingerprint}','summary:\\nbeach sunset',null,1
      )::text`)));
      assert.equal(imageReady.status, 'ready');
      assert.equal(profile(db, image).visual_provider_call_count, 1);
    } finally { dropDatabase(db); }
  });

test('visual queue is concurrent, service-only, index-bounded and reconciles exactly 50 zeros',
  { skip: !enabled, timeout: 300000 }, async () => {
    const db = createDatabase();
    try {
      seedActors(db);
      for (const key of ['f2-concurrent-a', 'f2-concurrent-b']) {
        const video = insertVideo(db, key, key);
        streamSource(db, video, key);
        refresh(db, video);
      }
      for (const limit of [0, 6]) {
        assert.notEqual(psql(db, `select * from public.claim_video_semantic_visual_v1(${limit})`,
          { allowFailure: true }).status, 0);
      }

      const firstPromise = psqlAsync(db,
        'begin;select video_id::text from public.claim_video_semantic_visual_v1(1);select pg_sleep(1.5);commit;');
      await new Promise(resolve => setTimeout(resolve, 250));
      const second = psql(db, 'select video_id::text from public.claim_video_semantic_visual_v1(1)');
      const firstId = rows(await firstPromise).find(line => /^[0-9a-f-]{36}$/.test(line));
      const secondId = rows(second).find(line => /^[0-9a-f-]{36}$/.test(line));
      assert.ok(firstId && secondId);
      assert.notEqual(firstId, secondId);

      for (const role of ['public', 'anon', 'authenticated']) {
        const actual = role === 'public' ? 'anon' : role;
        assert.notEqual(actorCall(db, actual,
          'select * from public.claim_video_semantic_visual_v1(1)',
          { allowFailure: true }).status, 0);
      }
      assert.notEqual(actorCall(db, 'service_role',
        'select count(*) from private.video_semantic_profiles',
        { allowFailure: true }).status, 0);
      const acl = lastLine(psql(db, `select concat_ws('|',
        has_function_privilege('service_role','public.claim_video_semantic_visual_v1(integer)','execute'),
        has_function_privilege('authenticated','public.claim_video_semantic_visual_v1(integer)','execute'),
        has_function_privilege('anon','public.claim_video_semantic_visual_v1(integer)','execute'),
        has_function_privilege('public','public.claim_video_semantic_visual_v1(integer)','execute'),
        has_function_privilege('service_role','public.complete_video_semantic_visual_v1(uuid,text,text,integer[],integer)','execute'),
        has_function_privilege('service_role','public.fail_video_semantic_visual_v1(uuid,text,text,boolean,integer)','execute')
      )`));
      assert.equal(acl, 't|f|f|f|t|t');

      psql(db, `
        alter table public.videos disable trigger user;
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('f2-perf-'||i)::uuid,'${creator}',
          'https://example.test/f2-perf/'||i||'.mp4','f2 performance '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        alter table public.videos enable trigger user;
        insert into private.video_semantic_profiles(
          video_id,source_content_fingerprint,semantic_input_version,semantic_input_fingerprint,
          caption_fingerprint,status,visual_semantic_status,visual_source_kind,
          visual_source_fingerprint,visual_source_video_asset_id,visual_sample_strategy,
          visual_available_at
        )
        select md5('f2-perf-'||i)::uuid,repeat('a',64),'video-semantic-v2',
          md5('f2-input-'||i)||md5('f2-input-'||i),repeat('b',64),'pending','pending',
          'eligible_stream_video',md5('f2-source-'||i)||md5('f2-source-'||i),
          md5('f2-asset-'||i)::uuid,'percentile_5_v1',clock_timestamp()
        from generate_series(1,30000) i;
        analyze private.video_semantic_profiles;
      `);
      const plan = psql(db, `explain (analyze,buffers,costs off)
        select video_id from private.video_semantic_profiles
        where visual_semantic_status='pending' and visual_attempt_count<5
          and visual_available_at<=clock_timestamp()
        order by visual_available_at,video_id for update skip locked limit 5`).stdout;
      assert.match(plan, /video_semantic_profiles_visual_pending_idx/i);
      assert.match(plan, /rows=5 loops=1/i);
      assert.doesNotMatch(plan, /Seq Scan on video_semantic_profiles/i);

      const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(Object.keys(reconciliation).length, 50);
      for (const [key, value] of Object.entries(reconciliation)) {
        assert.equal(value, 0, `${key} must reconcile in the disposable F2 environment`);
      }
      assert.equal(reconciliation.l5_visual_semantic_authority_missing, 0);
      assert.equal(reconciliation.l5_visual_semantic_sensitive_inference_present, 0);
    } finally { dropDatabase(db); }
  });
