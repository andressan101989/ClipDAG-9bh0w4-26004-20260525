import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_L5_LOCAL === '1';
const container = process.env.NELYON_ALGO6_L5_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_L5_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const viewer = '7a000000-0000-4000-8000-000000000001';
const creator = '7a000000-0000-4000-8000-000000000002';
const session = '7a000000-0000-4000-8000-000000000003';

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

function psqlAsync(db, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', owner, '-d', db, '-At',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`concurrent psql failed\n${stdout}\n${stderr}`));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(sql);
  });
}

function actorCall(db, role, sql, { allowFailure = false } = {}) {
  return psql(db,
    `begin;set local role ${role};set local "request.jwt.claim.role"='${role}';` +
    `set local "request.jwt.claim.sub"='${viewer}';${sql};commit;`,
    { allowFailure, authenticator: true },
  );
}

function rows(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function lastLine(result) {
  return rows(result).at(-1) ?? '';
}

function applyAlgoThroughL4(db) {
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
      values('70000000-0000-4000-8000-000000000001','l5_bootstrap',false);
    update private.algo_l1_policy set
      canary_enabled=false,
      canary_user_id='70000000-0000-4000-8000-000000000001',
      canary_request_id='70000000-0000-4000-8000-000000000002',
      canary_requested_at=clock_timestamp()-interval '3 hours',
      canary_armed_at=clock_timestamp()-interval '2 hours',
      canary_expires_at=clock_timestamp()-interval '1 hour',
      canary_generation=2;
  `);
  for (const suffix of [
    '_algo6_l2_directed_canary.sql',
    '_algo6_l3_quality_retention_antispam.sql',
    '_algo6_l3_directed_canary.sql',
    '_algo6_l4_session_context.sql',
    '_algo6_l4_directed_canary.sql',
  ]) psql(db, migration(suffix));
  psql(db, `update private.algo_l1_policy set
    policy_version='nelyon-algo-l1-v1',canary_enabled=false,
    canary_target_layer='l4',canary_generation=12,production_rollout_bps=0,
    l2_affinity_enabled=false,l3_quality_enabled=false,l4_context_enabled=false`);
}

function createDatabase({ applyL5 = true } = {}) {
  const db = `algo6_l5_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  applyAlgoThroughL4(db);
  if (applyL5) psql(db, migration('_algo6_l5_semantic_embedding_foundation.sql'));
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function vectorLiteral(length, value = '0.001') {
  return `'[${Array.from({ length }, () => value).join(',')}]'::extensions.vector`;
}

function rankedSql(asOf) {
  return `select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb)::text
    from public.get_ranked_feed_l1_v1(
      '${session}',50,'${asOf}',999999,'9999-12-31T23:59:59Z',
      'ffffffff-ffff-ffff-ffff-ffffffffffff','nelyon-algo-l1-v1'
    ) r`;
}

function seedActors(db) {
  psql(db, `
    insert into auth.users(id) values('${viewer}'),('${creator}');
    insert into public.user_profiles(id,username,is_private) values
      ('${viewer}','l5_viewer',false),('${creator}','l5_creator',false);
  `);
}

function insertVideo(db, key, caption, createdAt = '2026-10-04T17:00:00Z') {
  psql(db, `insert into public.videos(id,user_id,video_url,caption,created_at)
    values(md5('${key}')::uuid,'${creator}','https://example.test/${key}.mp4',${caption},'${createdAt}')`);
  return lastLine(psql(db, `select md5('${key}')::uuid`));
}

function insertAsset(db, key) {
  psql(db, `insert into public.video_assets(
    id,owner_id,purpose,status,mime_type,size_bytes,max_duration_seconds
  ) values(md5('${key}')::uuid,'${creator}','feed_video','pending','video/mp4',1024,60)`);
  return lastLine(psql(db, `select md5('${key}')::uuid`));
}

function scanFor(db, videoId) {
  const [id, fingerprint] = lastLine(psql(db, `select id||'|'||content_fingerprint
    from private.content_safety_scans where target_type='video' and target_id='${videoId}'
    order by created_at desc,id desc limit 1`)).split('|');
  assert.ok(id && fingerprint, 'video Content Safety scan must exist');
  return { id, fingerprint };
}

function profile(db, videoId) {
  return JSON.parse(lastLine(psql(db, `select to_jsonb(p)::text
    from private.video_semantic_profiles p where video_id='${videoId}'`)));
}

function serviceRefresh(db, videoId) {
  return actorCall(db, 'service_role',
    `select public.refresh_video_semantic_profile_v1('${videoId}')::text`);
}

function claim(db, limit = 8) {
  return psql(db, `select row_to_json(j)::text
    from public.claim_video_semantic_profiles_v1(${limit}) j`);
}

test('L5 input, sync and triggers are deterministic while dormant ranking stays identical',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase({ applyL5: false });
    try {
      seedActors(db);
      const existing = insertVideo(db, 'l5-existing', `E'  Café  \\n   Música  '`);
      const asOf = lastLine(psql(db, "select clock_timestamp()-interval '1 second'"));
      const before = lastLine(actorCall(db, 'anon', rankedSql(asOf)));

      psql(db, migration('_algo6_l5_semantic_embedding_foundation.sql'));
      assert.equal(lastLine(psql(db, 'select count(*) from private.video_semantic_profiles')), '0',
        'migration must not backfill preexisting videos');
      const after = lastLine(actorCall(db, 'anon', rankedSql(asOf)));
      assert.equal(after, before, 'L5-F1 migration must preserve exact dormant Feed output');

      serviceRefresh(db, existing);
      const input = JSON.parse(lastLine(psql(db,
        `select private.video_semantic_input_v1('${existing}')::text`)));
      assert.equal(input.eligible, true);
      assert.equal(input.input_text, 'caption:\nCafé Música');
      assert.deepEqual(input.components, ['caption']);
      assert.equal(input.semantic_input_version, 'video-semantic-v1');
      assert.match(input.source_content_fingerprint, /^[0-9a-f]{64}$/);
      assert.match(input.caption_fingerprint, /^[0-9a-f]{64}$/);
      assert.match(input.semantic_input_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(
        lastLine(psql(db, `select (private.video_semantic_input_v1('${existing}')->>'semantic_input_fingerprint')`)),
        input.semantic_input_fingerprint,
        'same content must produce a stable semantic fingerprint',
      );
      assert.equal(profile(db, existing).status, 'pending');

      const noSpeech = insertVideo(db, 'l5-no-speech', `'Solo caption'`);
      const noSpeechAsset = insertAsset(db, 'l5-no-speech-asset');
      const noSpeechScan = scanFor(db, noSpeech);
      const noSpeechBefore = profile(db, noSpeech).semantic_input_fingerprint;
      psql(db, `insert into private.content_safety_audio_transcripts(
        source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
        detected_language,transcript_text,word_count,no_speech,transcript_fingerprint
      ) values(
        '${noSpeechScan.id}','${noSpeechAsset}','${noSpeechScan.fingerprint}',
        'cloudflare_workers_ai','@cf/openai/whisper-large-v3-turbo','es','',0,true,
        private.content_safety_sha256('no-speech')
      )`);
      const noSpeechInput = JSON.parse(lastLine(psql(db,
        `select private.video_semantic_input_v1('${noSpeech}')::text`)));
      assert.deepEqual(noSpeechInput.components, ['caption']);
      assert.equal(noSpeechInput.source_transcript_id, null);
      assert.equal(profile(db, noSpeech).semantic_input_fingerprint, noSpeechBefore,
        'no-speech arrival must not change effective input');

      const stale = insertVideo(db, 'l5-stale-transcript', `'Caption actual'`);
      const staleAsset = insertAsset(db, 'l5-stale-transcript-asset');
      const staleScan = scanFor(db, stale);
      psql(db, `insert into private.content_safety_audio_transcripts(
        source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
        detected_language,transcript_text,word_count,no_speech,transcript_fingerprint
      ) values(
        '${staleScan.id}','${staleAsset}','${'f'.repeat(64)}',
        'cloudflare_workers_ai','@cf/openai/whisper-large-v3-turbo','es','texto viejo',2,false,
        private.content_safety_sha256('texto viejo')
      )`);
      assert.deepEqual(
        JSON.parse(lastLine(psql(db, `select private.video_semantic_input_v1('${stale}')::text`))).components,
        ['caption'],
      );

      const transcript = insertVideo(db, 'l5-valid-transcript', `'Caption base'`);
      const transcriptAsset = insertAsset(db, 'l5-valid-transcript-asset');
      const transcriptScan = scanFor(db, transcript);
      const claimed = JSON.parse(rows(claim(db, 25)).find(row => JSON.parse(row).video_id === transcript));
      psql(db, `select public.complete_video_semantic_profile_v1(
        '${transcript}','${claimed.semantic_input_fingerprint}',${vectorLiteral(1024)}
      )`);
      assert.equal(profile(db, transcript).status, 'ready');
      psql(db, `insert into private.content_safety_audio_transcripts(
        source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
        detected_language,transcript_text,word_count,no_speech,transcript_fingerprint
      ) values(
        '${transcriptScan.id}','${transcriptAsset}','${transcriptScan.fingerprint}',
        'cloudflare_workers_ai','@cf/openai/whisper-large-v3-turbo','pt','  fala   útil  ',2,false,
        private.content_safety_sha256('fala útil')
      )`);
      const transcriptInput = JSON.parse(lastLine(psql(db,
        `select private.video_semantic_input_v1('${transcript}')::text`)));
      assert.deepEqual(transcriptInput.components, ['caption', 'transcript']);
      assert.equal(transcriptInput.input_text, 'caption:\nCaption base\n\ntranscript:\nfala útil');
      assert.equal(transcriptInput.detected_language, 'pt');
      assert.equal(profile(db, transcript).status, 'pending');
      assert.equal(profile(db, transcript).embedding, null);

      const updated = insertVideo(db, 'l5-update', `'Original caption'`);
      const updateJob = JSON.parse(rows(claim(db, 25)).find(row => JSON.parse(row).video_id === updated));
      psql(db, `select public.complete_video_semantic_profile_v1(
        '${updated}','${updateJob.semantic_input_fingerprint}',${vectorLiteral(1024)}
      )`);
      const ready = profile(db, updated);
      assert.equal(ready.status, 'ready');
      psql(db, `update public.videos set views_count=views_count+1 where id='${updated}'`);
      assert.equal(profile(db, updated).semantic_input_fingerprint, ready.semantic_input_fingerprint);
      assert.equal(profile(db, updated).status, 'ready', 'engagement-only update must preserve ready vector');
      psql(db, `update public.videos set caption='Changed caption',edited_at=clock_timestamp() where id='${updated}'`);
      const invalidated = profile(db, updated);
      assert.equal(invalidated.status, 'pending');
      assert.equal(invalidated.embedding, null);
      assert.equal(invalidated.attempt_count, 0);
      assert.notEqual(invalidated.semantic_input_fingerprint, ready.semantic_input_fingerprint);
      assert.equal(lastLine(psql(db, `select count(*) from private.video_semantic_profiles where video_id='${updated}'`)), '1');
    } finally {
      dropDatabase(db);
    }
  });

test('L5 claim, complete, stale protection, retry bounds and ACLs fail closed',
  { skip: !enabled, timeout: 300000 }, async () => {
    const db = createDatabase();
    try {
      seedActors(db);
      const ids = [];
      for (let index = 1; index <= 9; index += 1) {
        ids.push(insertVideo(db, `l5-queue-${index}`, `'Queue ${index}'`,
          `2026-10-04T17:00:${String(index).padStart(2, '0')}Z`));
      }

      for (const limit of [0, 26]) {
        assert.notEqual(psql(db, `select * from public.claim_video_semantic_profiles_v1(${limit})`,
          { allowFailure: true }).status, 0);
      }
      assert.equal(rows(claim(db, 1)).length, 1);

      const txSql = `begin;select video_id::text from public.claim_video_semantic_profiles_v1(1);select pg_sleep(1.5);commit;`;
      const first = psqlAsync(db, txSql);
      await new Promise(resolve => setTimeout(resolve, 250));
      const second = psql(db, `select video_id::text from public.claim_video_semantic_profiles_v1(1)`);
      const firstId = rows(await first).find(line => /^[0-9a-f-]{36}$/.test(line));
      const secondId = rows(second).find(line => /^[0-9a-f-]{36}$/.test(line));
      assert.ok(firstId && secondId);
      assert.notEqual(firstId, secondId, 'SKIP LOCKED must prevent duplicate concurrent claim');

      const dimensionJob = JSON.parse(rows(claim(db, 1))[0]);
      for (const length of [1023, 1025]) {
        assert.notEqual(psql(db, `select public.complete_video_semantic_profile_v1(
          '${dimensionJob.video_id}','${dimensionJob.semantic_input_fingerprint}',${vectorLiteral(length)}
        )`, { allowFailure: true }).status, 0, `${length} dimensions must be rejected`);
      }
      psql(db, `select public.complete_video_semantic_profile_v1(
        '${dimensionJob.video_id}','${dimensionJob.semantic_input_fingerprint}',${vectorLiteral(1024)}
      )`);
      assert.equal(profile(db, dimensionJob.video_id).status, 'ready');
      assert.equal(profile(db, dimensionJob.video_id).provider_call_count, 1);

      const staleJob = JSON.parse(rows(claim(db, 1))[0]);
      psql(db, `update public.videos set caption=caption||' changed',edited_at=clock_timestamp()
        where id='${staleJob.video_id}'`);
      const staleResult = JSON.parse(lastLine(psql(db, `select public.complete_video_semantic_profile_v1(
        '${staleJob.video_id}','${staleJob.semantic_input_fingerprint}',${vectorLiteral(1024)}
      )::text`)));
      assert.equal(staleResult.status, 'stale');
      assert.equal(profile(db, staleJob.video_id).embedding, null);

      const retryVideo = ids.at(-1);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        psql(db, `update private.video_semantic_profiles set available_at=clock_timestamp()
          where video_id='${retryVideo}'`);
        const job = rows(claim(db, 25)).map(JSON.parse).find(item => item.video_id === retryVideo);
        assert.ok(job, `retry video must be claimed for attempt ${attempt}`);
        psql(db, `select public.fail_video_semantic_profile_v1(
          '${retryVideo}','${job.semantic_input_fingerprint}','provider_timeout',true,true
        )`);
      }
      const exhausted = profile(db, retryVideo);
      assert.equal(exhausted.status, 'failed');
      assert.equal(exhausted.attempt_count, 5);
      assert.equal(exhausted.provider_call_count, 5);

      const nonretry = insertVideo(db, 'l5-nonretry', `'Nonretryable'`);
      const nonretryJob = rows(claim(db, 25)).map(JSON.parse).find(item => item.video_id === nonretry);
      psql(db, `select public.fail_video_semantic_profile_v1(
        '${nonretry}','${nonretryJob.semantic_input_fingerprint}','invalid_embedding_response',false,false
      )`);
      assert.equal(profile(db, nonretry).status, 'failed');
      assert.equal(profile(db, nonretry).provider_call_count, 0);

      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.notEqual(actorCall(db, role,
          'select count(*) from private.video_semantic_profiles', { allowFailure: true }).status, 0,
        `${role} must have no direct table read`);
      }
      for (const role of ['anon', 'authenticated']) {
        assert.notEqual(actorCall(db, role,
          `select public.refresh_video_semantic_profile_v1('${ids[0]}')`,
          { allowFailure: true }).status, 0,
        `${role} must not execute semantic refresh`);
      }
      assert.equal(actorCall(db, 'service_role',
        `select public.refresh_video_semantic_profile_v1('${ids[0]}')`).status, 0);
      assert.equal(lastLine(psql(db, `select
        has_table_privilege('service_role','private.video_semantic_profiles','select')||'|'||
        has_function_privilege('service_role','private.video_semantic_input_v1(uuid)','execute')`)),
      'false|false');
    } finally {
      dropDatabase(db);
    }
  });

test('L5 queue remains index-bounded at 30k videos and reconciles exactly 48 zeros',
  { skip: !enabled, timeout: 300000 }, () => {
    const db = createDatabase();
    try {
      seedActors(db);
      psql(db, `
        alter table public.videos disable trigger user;
        insert into public.videos(id,user_id,video_url,caption,created_at)
        select md5('l5-perf-video-'||i)::uuid,'${creator}',
          'https://example.test/l5-perf/'||i||'.mp4','semantic performance '||i,
          clock_timestamp()-make_interval(secs=>i)
        from generate_series(1,30000) i;
        alter table public.videos enable trigger user;
        select private.sync_video_semantic_profile_v1(id)
        from public.videos where caption like 'semantic performance %'
        order by id limit 200;
        analyze private.video_semantic_profiles;
      `);
      assert.equal(lastLine(psql(db, `select count(*) from public.videos
        where caption like 'semantic performance %'`)), '30000');
      assert.equal(lastLine(psql(db, 'select count(*) from private.video_semantic_profiles')), '200');
      const plan = psql(db, `explain (analyze,buffers,costs off)
        select video_id from private.video_semantic_profiles
        where status='pending' and attempt_count<5 and available_at<=clock_timestamp()
        order by available_at,video_id for update skip locked limit 25`).stdout;
      assert.match(plan, /video_semantic_profiles_pending_idx/i);
      assert.match(plan, /rows=25 loops=1/i);
      assert.doesNotMatch(plan, /Seq Scan on video_semantic_profiles/i);
      assert.equal(rows(claim(db, 25)).length, 25);

      const authorityShape = lastLine(psql(db, `select concat_ws('|',
        (pg_catalog.to_regclass('private.video_semantic_profiles') is not null)::text,
        (select c.relrowsecurity::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname='video_semantic_profiles'),
        (select tn.nspname from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid=a.attrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          join pg_catalog.pg_type t on t.oid=a.atttypid
          join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace
          where n.nspname='private' and c.relname='video_semantic_profiles' and a.attname='embedding'),
        (select t.typname from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid=a.attrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          join pg_catalog.pg_type t on t.oid=a.atttypid
          where n.nspname='private' and c.relname='video_semantic_profiles' and a.attname='embedding'),
        (select a.atttypmod::text from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid=a.attrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname='video_semantic_profiles' and a.attname='embedding'),
        (select pg_catalog.format_type(a.atttypid,a.atttypmod) from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid=a.attrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname='video_semantic_profiles' and a.attname='embedding'),
        (select exists(select 1 from pg_catalog.pg_index i
          join pg_catalog.pg_class c on c.oid=i.indrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname='video_semantic_profiles' and i.indisprimary))::text,
        pg_catalog.has_table_privilege('public','private.video_semantic_profiles','select,insert,update,delete')::text,
        pg_catalog.has_table_privilege('anon','private.video_semantic_profiles','select,insert,update,delete')::text,
        pg_catalog.has_table_privilege('authenticated','private.video_semantic_profiles','select,insert,update,delete')::text,
        pg_catalog.has_table_privilege('service_role','private.video_semantic_profiles','select,insert,update,delete')::text
      )`));
      assert.equal(authorityShape,
        'true|true|extensions|vector|1024|vector(1024)|true|false|false|false|false');

      const reconciliation = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(Object.keys(reconciliation).length, 48);
      for (const [key, value] of Object.entries(reconciliation)) {
        assert.equal(value, 0, `${key} must reconcile in the disposable L5 environment`);
      }
      psql(db, `alter table private.video_semantic_profiles
        drop constraint video_semantic_profiles_model_check`);
      const damaged = JSON.parse(lastLine(psql(db, 'select public.reconcile_algo_l1_v1()')));
      assert.equal(damaged.l5_semantic_profile_authority_missing, 1,
        'the profile counter must detect a missing provider/model provenance constraint');
    } finally {
      dropDatabase(db);
    }
  });
