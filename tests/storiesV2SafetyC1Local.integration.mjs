// SQL-real, reduced-schema contract proof. No remote URL or provider calls.
// PowerShell: $env:RUN_STORIES_C1_LOCAL='1'; node --test tests/storiesV2SafetyC1Local.integration.mjs
// Local psql: STORIES_C1_PG_BIN/PORT/USER (also accepts the B1 PG_* equivalents).
// Optional local Docker: STORIES_C1_PG_CONTAINER=<running postgres container>.
// A fresh database is built from the checked-in B1 baseline, B1, then C1 and
// dropped even on failure. No existing database or baseline template is mutated.
// LIMITATIONS: B1 has structural scanner/MEDIA/P3 doubles. We inject synthetic
// evidence as postgres, never claim provider, full-schema, or PHYSICAL_PASS.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const enabled = process.env.RUN_STORIES_C1_LOCAL === '1';
const db = `stories_c1_${randomUUID().replaceAll('-', '')}`;
const owner = '11111111-1111-4111-8111-111111111111';
const follower = '22222222-2222-4222-8222-222222222222';
const historical = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pinnedPolicyDigest = 'c294071c22de46ad66fb73b578b190912b3f21a1e1dfa5e0b15387896a34e9f1';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = value => `${quote(JSON.stringify(value))}::jsonb`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const container = process.env.STORIES_C1_PG_CONTAINER;
const pgBin = process.env.STORIES_C1_PG_BIN || process.env.STORIES_B1_PG_BIN;
const port = process.env.STORIES_C1_PG_PORT || process.env.STORIES_B1_PG_PORT || '55432';
const user = process.env.STORIES_C1_PG_USER || process.env.STORIES_B1_PG_USER || 'postgres';
const psql = pgBin ? join(pgBin, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';

function run(sql, database = db, expectedFailure = false) {
  const env = { ...process.env, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' };
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[name];
  const psqlArgs = ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-p', container ? '5432' : port, '-U', user, '-d', database, '-At'];
  const command = container ? 'docker' : psql;
  const args = container ? ['--context', process.env.STORIES_C1_DOCKER_CONTEXT || 'default',
    'exec', '-i', container, 'psql', ...psqlArgs] : psqlArgs;
  const result = spawnSync(command, args, {
    input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
    env,
  });
  if (!expectedFailure) assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr}`);
  return expectedFailure ? result : result.stdout.trim();
}
const query = sql => JSON.parse(run(sql).split('\n').at(-1));
const as = (actor, sql) => `begin; set local role authenticated;
  select set_config('request.jwt.claim.sub','${actor}',true); ${sql}; commit;`;
const asValue = (actor, sql) => run(as(actor, sql)).split('\n').at(-1);
function fails(sql, pattern) {
  const result = run(sql, db, true);
  assert.notEqual(result.status, 0, 'expected PostgreSQL to reject the operation');
  assert.match(result.stderr, pattern);
}
const safety = id => query(`select to_jsonb(s) from private.story_safety_state s where story_id='${id}'`);
const candidate = id => query(`select private.story_content_safety_candidate_c1_v1('${id}')`);
const scanId = id => run(`select scan_id from private.story_safety_state where story_id='${id}'`);
const touch = id => run(`update private.content_safety_scans set updated_at=clock_timestamp() where id='${id}'`);

// These exact production definitions supply the narrow prerequisites omitted
// from B1's reduced baseline. The rules table is only the helper's input shape;
// no scanner, verdict writer, provider, or C1 function is substituted.
function transcriptPrerequisites() {
  const source = read('../supabase/migrations/20260915130911_admin_content_safety_audio_stt_ai_v1.sql');
  const helper = source.match(/create function private\.content_safety_transcript_ruleset_fingerprint\(\)[\s\S]*?\$\$;/);
  assert.ok(helper, 'checked-in canonical transcript ruleset helper is required');
  return `alter table private.content_safety_audio_transcripts add column rule_eval_ruleset_fingerprint text;
    create table private.content_safety_rules(id uuid primary key,version integer not null,
      detector_type text not null,pattern text not null,approval_state text not null,
      enabled boolean not null,scopes text[] not null);
    ${helper[0]}
    revoke all on function private.content_safety_transcript_ruleset_fingerprint() from public,anon,authenticated,service_role;`;
}

// The B1 fixture's snapshot double returns null for every video. Restore the
// checked-in canonical snapshot authority so shared-source changes are real
// table mutations, not a mocked content_version supplied by this test.
function snapshotPrerequisite() {
  const source = read('../supabase/migrations/20260914144028_admin_content_safety_alert_pipeline_v1.sql');
  const helper = source.match(/create function private\.content_safety_target_snapshot\(p_target_type text,p_target_id uuid\)[\s\S]*?\$\$;/);
  assert.ok(helper, 'checked-in canonical target snapshot helper is required');
  return helper[0].replace('create function', 'create or replace function');
}

const catalog = () => query(`select coalesce(jsonb_object_agg(signature,definition),'{}') from (
  select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,
    pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.prokind='f') functions`);

function createImage({ composition = { version: 1, elements: [] }, definitions = [], size = 10 } = {}) {
  const asset = randomUUID(), client = randomUUID();
  run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,
    bucket_name,object_key,mime_type,size_bytes,status) values('${asset}','${owner}',
    'r2','image','story_image','private','c1-disposable','stories/${asset}.jpg','image/jpeg',${size},'ready')`);
  const sql = `select public.create_story_with_media('${asset}',${jsonSql(composition)},'${client}',${jsonSql(definitions)})`;
  const id = asValue(owner, sql);
  return { id, asset, sql };
}

function createVideo() {
  const asset = randomUUID();
  assert.equal(run(`select public.reserve_stream_upload_asset('${asset}','${owner}',
    'video/mp4',100,'c1-proof.mp4','story_video')`), 'created');
  run(`update public.video_assets set status='ready',cloudflare_uid='c1-${asset}',duration_seconds=15,
    ready_at=now(),provider_metadata='{"require_signed_urls":true}' where id='${asset}'`);
  const id = asValue(owner, `select public.create_story_with_media('${asset}','{"version":1,"elements":[]}',
    '${randomUUID()}','[]')`);
  return { id, asset };
}

function attachVisual(id, asset, video = false) {
  const scan = scanId(id), analysis = randomUUID();
  run(`insert into private.content_safety_visual_analyses(id,source_scan_id,video_asset_id,
    media_asset_id,source_content_fingerprint,provider,model,prompt_version,sample_strategy,
    frame_count,frame_timestamps_ms,analysis_result,analysis_fingerprint,provider_call_count)
    select '${analysis}',id,${video ? `'${asset}'` : 'null'},${video ? 'null' : `'${asset}'`},
      content_fingerprint,visual_provider,visual_model,visual_prompt_version,'c1-synthetic',1,
      array[0],'{}',repeat('b',64),1 from private.content_safety_scans where id='${scan}';
    update private.content_safety_scans set visual_status='analyzed',visual_analysis_id='${analysis}',
      visual_frame_cursor=1,visual_provider_call_count=1,visual_attempt_count=1,
      visual_partial_result='{"fixture":"complete"}' where id='${scan}'`);
  return analysis;
}

function insertTranscript(id, { status = 'pending', rules = null, fingerprint, model } = {}) {
  const transcript = randomUUID(), scan = scanId(id);
  run(`insert into private.content_safety_audio_transcripts(id,source_scan_id,source_asset_id,
    source_content_fingerprint,provider,model,transcript_text,word_count,segments,no_speech,
    transcript_fingerprint,rule_eval_status,rule_eval_ruleset_fingerprint)
    select '${transcript}',id,audio_source_asset_id,${fingerprint ? quote(fingerprint) : 'content_fingerprint'},
      audio_provider,${model ? quote(model) : 'audio_model'},'Disposable transcript',2,'[]',false,
      repeat('c',64),'${status}',${rules === 'current' ? 'private.content_safety_transcript_ruleset_fingerprint()' : rules === null ? 'null' : quote(rules)}
    from private.content_safety_scans where id='${scan}'`);
  return transcript;
}

test('C1 disposable PostgreSQL fail-closed behavior and isolation', { skip: !enabled }, async t => {
  assert.match(port, /^\d{1,5}$/);
  assert.match(user, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
  if (container) {
    assert.match(container, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    const context = process.env.STORIES_C1_DOCKER_CONTEXT || 'default';
    assert.ok(['default', 'desktop-linux'].includes(context), 'only local Docker contexts accepted');
    const inspect = spawnSync('docker', ['context', 'inspect', context], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(inspect.status, 0, inspect.stderr);
    const endpoint = JSON.parse(inspect.stdout)[0].Endpoints.docker.Host;
    assert.match(endpoint, /^(?:npipe:\/\/|unix:\/\/)/, 'Docker endpoint must be a local socket');
  }
  const databasesBefore = run('select datname from pg_database order by datname', 'postgres');
  let created = false;
  try {
    run(`create database ${db} template template0;`, 'postgres');
    created = true;
    run(read('./fixtures/stories_v2_interactive_b1_baseline.sql'));
    run(transcriptPrerequisites());
    run(snapshotPrerequisite());
    run(read('../supabase/migrations/20261027042552_stories_v2_interactive_b1.sql'));
    run(`begin; ${read('./fixtures/stories_v2_interactive_b1_fixture.sql')} commit;`);
    const historicalState = safety(historical);
    const historicalScans = query('select coalesce(jsonb_agg(to_jsonb(s) order by id),\'[]\') from private.content_safety_scans s');
    const b1Fingerprint = run(`select private.story_current_fingerprint('${historical}')`);
    const before = catalog();
    run(read('../supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql'));

    await t.test('installation does not update historical safety or scan rows', () => {
      assert.deepEqual(safety(historical), historicalState);
      assert.deepEqual(query('select coalesce(jsonb_agg(to_jsonb(s) order by id),\'[]\') from private.content_safety_scans s'), historicalScans);
      assert.notEqual(run(`select private.story_current_fingerprint('${historical}')`), b1Fingerprint,
        'the C1 evidence version must invalidate historical fingerprints without rewriting their rows');
      assert.equal(candidate(historical).decision, 'pending');
      assert.equal(candidate(historical).activation_effect, false);
    });

    await t.test('installed policy matches the exact artifact bytes and cannot activate', () => {
      const bytes = readFileSync(new URL('../docs/stories-v2-content-safety-policy-candidate-v1.json', import.meta.url));
      assert.equal(sha256(bytes), pinnedPolicyDigest);
      const { artifact_sha256: digest, ...policy } = query('select private.story_content_safety_policy_c1_v1()');
      assert.equal(digest, pinnedPolicyDigest);
      assert.deepEqual(policy, JSON.parse(bytes.toString('utf8')));
      assert.deepEqual(query('select private.story_content_safety_control_c1_v1()'), {
        policy_artifact_sha256: pinnedPolicyDigest, activation: false, owner_approved_policy: false,
        auto_publish_enabled: false, mode: 'fail_closed_review', automatic_allow_authorized: false,
        automatic_block_authorized: false,
      });
    });

    await t.test('C1 changes only its enumerated private authorities; MEDIA and P3 surfaces stay byte-identical', () => {
      const after = catalog();
      const replaced = new Set(['story_current_fingerprint', 'content_safety_target_snapshot',
        'content_safety_visual_source', 'enqueue_content_safety_scan', 'story_enqueue_media_safety_v1',
        'story_sync_safety_from_scan_v1', 'story_can_access']);
      for (const [signature, definition] of Object.entries(before)) {
        const name = signature.slice(0, signature.indexOf('('));
        if (!replaced.has(name.replace(/^private\./, ''))) assert.equal(after[signature], definition, signature);
      }
      assert.deepEqual(Object.keys(after).filter(signature => !Object.hasOwn(before, signature))
        .map(signature => signature.slice(0, signature.indexOf('('))).sort(), [
        'private.story_author_text_bundle_c1_v1', 'private.story_content_safety_candidate_c1_v1',
        'private.story_content_safety_control_c1_v1', 'private.story_content_safety_policy_c1_v1',
        'private.story_refresh_safety_from_transcript_c1_v1',
      ]);
      for (const target of ['video', 'exclusive_content']) {
        assert.equal(run(`select private.content_safety_target_snapshot('${target}','${historical}') is not distinct from
          private.content_safety_target_snapshot_b1_core('${target}','${historical}')`), 't');
        assert.equal(run(`select private.content_safety_visual_source('${target}','${historical}') =
          private.content_safety_visual_source_b1_core('${target}','${historical}')`), 't');
      }
    });

    let image;
    await t.test('scanner text is deterministic and contains composition, prompts and labels without private identifiers', () => {
      const quiz = '00000000-0000-4000-8000-000000000010';
      const poll = '00000000-0000-4000-8000-000000000020';
      const position = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
      const definitions = [
        { version: 1, element_id: poll, type: 'poll', prompt: 'Pick a season',
          options: [{ id: 'poll_hidden_id', label: 'Spring' }, { id: 'other_hidden_id', label: 'Summer' }] },
        { version: 1, element_id: quiz, type: 'quiz', prompt: 'Which color?',
          options: [{ id: 'answer_private_alpha', label: 'Blue' }, { id: 'answer_private_beta', label: 'Gold' }], correct_option_id: 'answer_private_beta' },
        { version: 1, element_id: '00000000-0000-4000-8000-000000000030', type: 'reaction',
          prompt: 'React here', emoji: '🔥' },
      ];
      const composition = { version: 2, elements: [
        { id: randomUUID(), type: 'text', text: 'Author composition', color: '#FFFFFF', align: 'center', size: 'medium', ...position },
        { id: randomUUID(), type: 'sticker', value: '🎉', ...position },
        { id: poll, type: 'interactive', element_id: poll, ...position },
        { id: quiz, type: 'interactive', element_id: quiz, ...position },
        { id: '00000000-0000-4000-8000-000000000030', type: 'interactive',
          element_id: '00000000-0000-4000-8000-000000000030', ...position },
      ] };
      image = createImage({ composition, definitions });
      const expected = 'Author composition\n🎉\nWhich color?\nBlue\nGold\nPick a season\nSpring\nSummer\nReact here\n🔥';
      assert.equal(query(`select to_jsonb(private.story_author_text_bundle_c1_v1('${image.id}'))`), expected);
      const snapshot = query(`select private.content_safety_target_snapshot('story','${image.id}')`);
      assert.equal(snapshot.text, expected);
      assert.equal(snapshot.text_value, expected);
      assert.equal(snapshot.summary, expected);
      assert.doesNotMatch(snapshot.text, /answer_private|poll_hidden_id|other_hidden_id|correct_option_id/);
      const fingerprint = snapshot.content_version;
      const changedAnswer = query(`begin; update private.story_interactive_elements set private_answer='answer_private_alpha'
        where story_id='${image.id}' and element_id='${quiz}';
        select jsonb_build_object('text',private.story_author_text_bundle_c1_v1('${image.id}'),
          'fingerprint',private.story_current_fingerprint('${image.id}')); rollback;`);
      assert.equal(changedAnswer.text, expected);
      assert.notEqual(changedAnswer.fingerprint, fingerprint, 'private definition identity still participates in the evidence identity');
      assert.equal(query(`select to_jsonb(private.story_author_text_bundle_c1_v1('${image.id}'))`), expected);
      assert.equal(run(`select private.story_current_fingerprint('${image.id}')`), fingerprint);
      assert.notEqual(run(`begin; update private.story_interactive_elements set public_config=jsonb_set(public_config,
        '{prompt}','"Changed prompt"') where story_id='${image.id}' and element_id='${poll}';
        select private.story_current_fingerprint('${image.id}'); rollback;`).split('\n').at(-1), fingerprint);
    });

    await t.test('image visual eligibility stops exactly above 10 MiB and tracks changed media identity', () => {
      const fingerprint = run(`select private.story_current_fingerprint('${image.id}')`);
      for (const [size, kind] of [[10485760, 'eligible_image'], [10485761, 'not_configured'], [0, 'not_configured']]) {
        run(`update public.media_assets set size_bytes=${size} where id='${image.asset}'`);
        assert.equal(query(`select private.content_safety_visual_source('story','${image.id}')`).kind, kind);
      }
      assert.notEqual(run(`select private.story_current_fingerprint('${image.id}')`), fingerprint);
      run(`update public.media_assets set size_bytes=10 where id='${image.asset}'`);
      assert.equal(run(`select private.story_current_fingerprint('${image.id}')`), fingerprint);
    });

    await t.test('shared fingerprints bind the current source owner and content version', () => {
      const source = randomUUID(), shared = randomUUID();
      run(`insert into public.videos(id,user_id,video_url,caption) values('${source}','${owner}',
        'https://fixture.invalid/source.mp4','Original source');
        insert into public.stories(id,user_id,media_type,media_url,story_kind,shared_video_id,shared_content_type)
        values('${shared}','${owner}','video',null,'shared','${source}','reel')`);
      const fingerprint = run(`select private.story_current_fingerprint('${shared}')`);
      // Hand-specified empty/shared preimage: exact version, source identity,
      // no definitions or media links. The digest is computed independently in
      // Node; the current-fingerprint helper supplies none of the expectation.
      const preimage = run(`select jsonb_build_object('version','stories-safety-evidence-c1-v1',
        'story','${shared}'::uuid,'owner','${owner}'::uuid,'kind','shared','source','${source}'::uuid,
        'legacy',null,'type','video','composition','{"version":1,"elements":[]}'::jsonb,'author_text','',
        'shared_source',jsonb_build_object('owner',snapshot->>'owner_user_id','content_version',snapshot->>'content_version'),
        'definitions',null,'r2',null,'stream',null)::text
        from (select private.content_safety_target_snapshot_b1_core('video','${source}') snapshot) source`);
      assert.equal(fingerprint, sha256(preimage));
      run(`update public.videos set caption='Changed source',edited_at=clock_timestamp() where id='${source}'`);
      const changed = run(`select private.story_current_fingerprint('${shared}')`);
      assert.notEqual(changed, fingerprint);
      run(`update public.videos set user_id='${follower}' where id='${source}'`);
      assert.notEqual(run(`select private.story_current_fingerprint('${shared}')`), changed);
      assert.equal(candidate(shared).decision, 'pending');
      assert.equal(candidate(shared).activation_effect, false);
    });

    await t.test('an analyzed visual flag needs the canonical current analysis identity', () => {
      const scan = scanId(image.id);
      run(`update private.content_safety_scans set visual_status='analyzed' where id='${scan}'`);
      assert.equal(safety(image.id).state, 'pending');
      assert.equal(safety(image.id).visual_complete, false);
      const analysis = attachVisual(image.id, image.asset);
      assert.equal(safety(image.id).state, 'review');
      assert.equal(safety(image.id).visual_complete, true);
      for (const mutation of [
        `prompt_version='wrong-prompt'`, `source_content_fingerprint=repeat('0',64)`,
        `analysis_fingerprint='malformed'`, `media_asset_id='${randomUUID()}'`,
      ]) {
        const result = run(`begin; update private.content_safety_visual_analyses set ${mutation} where id='${analysis}';
          update private.content_safety_scans set updated_at=clock_timestamp() where id='${scan}';
          select visual_complete from private.story_safety_state where story_id='${image.id}'; rollback;`);
        assert.equal(result.split('\n').at(-1), 'f', mutation);
      }
      assert.deepEqual({ decision: candidate(image.id).decision, effect: candidate(image.id).activation_effect },
        { decision: 'review', effect: false });
      assert.equal(safety(image.id).policy_digest, null);
      assert.equal(run(`begin; update private.content_safety_scans set text_status='failed' where id='${scan}';
        select state from private.story_safety_state where story_id='${image.id}'; rollback;`), 'pending');
    });

    await t.test('same-identity creation and enqueue replay preserve all evidence; explicit retry resets work', () => {
      const scan = scanId(image.id), stateBefore = safety(image.id);
      const scanBefore = query(`select to_jsonb(s) from private.content_safety_scans s where id='${scan}'`);
      assert.equal(asValue(owner, image.sql), image.id);
      assert.equal(run(`select private.story_enqueue_media_safety_v1('${image.id}')`), scan);
      assert.equal(run(`select private.enqueue_content_safety_scan('story','${image.id}','content_updated')`), scan);
      assert.deepEqual(safety(image.id), stateBefore);
      assert.deepEqual(query(`select to_jsonb(s) from private.content_safety_scans s where id='${scan}'`), scanBefore);
      assert.equal(run(`select private.enqueue_content_safety_scan('story','${image.id}','retry')`), scan);
      const retried = query(`select to_jsonb(s) from private.content_safety_scans s where id='${scan}'`);
      assert.equal(retried.requested_reason, 'retry');
      assert.equal(retried.visual_status, 'pending');
      assert.equal(retried.visual_analysis_id, null);
      assert.equal(retried.visual_provider_call_count, 0);
      assert.equal(safety(image.id).state, 'pending');
    });

    await t.test('a new report signal requeues the current Story scan instead of being treated as a create replay', () => {
      const scan = scanId(image.id);
      run(`update private.content_safety_scans set requested_reason='content_updated',
        text_status='analyzed',reports_status='analyzed',updated_at=clock_timestamp()-interval '1 minute'
        where id='${scan}'`);
      const before = query(`select jsonb_build_object('requested_reason',requested_reason,
        'updated_at',updated_at) from private.content_safety_scans where id='${scan}'`);
      assert.equal(run(`select private.enqueue_content_safety_scan('story','${image.id}','report_signal')`), scan);
      const after = query(`select jsonb_build_object('requested_reason',requested_reason,
        'updated_at',updated_at) from private.content_safety_scans where id='${scan}'`);
      assert.equal(after.requested_reason, 'report_signal');
      assert.ok(Date.parse(after.updated_at) > Date.parse(before.updated_at));
    });

    await t.test('audio needs a unique current transcript and completed current rules; transcript writes refresh safety', () => {
      const video = createVideo(), scan = scanId(video.id);
      attachVisual(video.id, video.asset, true);
      run(`update private.content_safety_scans set audio_status='analyzed' where id='${scan}'`);
      assert.equal(safety(video.id).audio_complete, false);
      const transcript = insertTranscript(video.id);
      for (const status of ['pending', 'processing', 'failed']) {
        run(`update private.content_safety_audio_transcripts set rule_eval_status='${status}',
          rule_eval_ruleset_fingerprint=private.content_safety_transcript_ruleset_fingerprint() where id='${transcript}'`);
        assert.equal(safety(video.id).state, 'pending');
        assert.equal(safety(video.id).audio_complete, false);
      }
      run(`update private.content_safety_audio_transcripts set rule_eval_status='completed',
        rule_eval_ruleset_fingerprint=repeat('0',64) where id='${transcript}'`);
      assert.equal(safety(video.id).audio_complete, false);
      run(`update private.content_safety_audio_transcripts set
        rule_eval_ruleset_fingerprint=private.content_safety_transcript_ruleset_fingerprint() where id='${transcript}'`);
      assert.equal(safety(video.id).state, 'review', 'no scan touch: the transcript trigger must refresh safety');
      assert.equal(safety(video.id).audio_complete, true);
      run(`update private.content_safety_audio_transcripts set no_speech=true where id='${transcript}'`);
      assert.equal(safety(video.id).audio_complete, false, 'no-speech cannot contradict a populated transcript');
      run(`update private.content_safety_audio_transcripts set transcript_text='',word_count=0 where id='${transcript}'`);
      assert.equal(safety(video.id).audio_complete, true, 'explicit consistent no-speech is complete evidence');
      run(`update private.content_safety_audio_transcripts set no_speech=false where id='${transcript}'`);
      assert.equal(safety(video.id).audio_complete, false, 'empty speech without explicit no-speech is incomplete');
      run(`update private.content_safety_audio_transcripts set transcript_text='Disposable transcript',word_count=2 where id='${transcript}'`);
      assert.equal(safety(video.id).audio_complete, true, 'a populated speech transcript is complete evidence');
      assert.equal(candidate(video.id).decision, 'review');
      assert.equal(candidate(video.id).activation_effect, false);
      for (const mutation of [`source_content_fingerprint=repeat('0',64)`,
        `source_asset_id='${randomUUID()}'`, `provider='wrong-provider'`, `model='wrong-model'`]) {
        assert.equal(run(`begin; update private.content_safety_audio_transcripts set ${mutation} where id='${transcript}';
          select audio_complete from private.story_safety_state where story_id='${video.id}'; rollback;`).split('\n').at(-1), 'f', mutation);
      }
      // B1's structural transcript fixture permits a second model. Production
      // has stricter provider/model constraints; this adversarial reduced-schema
      // row exercises C1's explicit ambiguity fence, not provider acceptance.
      const ambiguous = insertTranscript(video.id, { status: 'completed', rules: 'current', model: 'fixture-ambiguous-model' });
      assert.equal(safety(video.id).audio_complete, false);
      run(`delete from private.content_safety_audio_transcripts where id='${ambiguous}'`);
      assert.equal(safety(video.id).audio_complete, true, 'DELETE also refreshes evidence');
      run(`delete from private.content_safety_audio_transcripts where id='${transcript}'`);
      assert.equal(safety(video.id).state, 'pending');
      assert.equal(safety(video.id).audio_complete, false);
      insertTranscript(video.id, { status: 'completed', rules: 'current' });
      assert.equal(safety(video.id).state, 'review', 'INSERT also refreshes evidence');
      const completedState = safety(video.id);
      const completedScan = query(`select to_jsonb(s) from private.content_safety_scans s where id='${scan}'`);
      const completedTranscripts = query(`select jsonb_agg(to_jsonb(t) order by id)
        from private.content_safety_audio_transcripts t where source_scan_id='${scan}'`);
      assert.equal(run(`select private.story_enqueue_media_safety_v1('${video.id}')`), scan);
      assert.equal(run(`select private.enqueue_content_safety_scan('story','${video.id}','content_created')`), scan);
      assert.deepEqual(safety(video.id), completedState);
      assert.deepEqual(query(`select to_jsonb(s) from private.content_safety_scans s where id='${scan}'`), completedScan);
      assert.deepEqual(query(`select jsonb_agg(to_jsonb(t) order by id)
        from private.content_safety_audio_transcripts t where source_scan_id='${scan}'`), completedTranscripts);
      assert.equal(run(`select private.enqueue_content_safety_scan('story','${video.id}','retry')`), scan);
      assert.equal(run(`select audio_status||':'||visual_status from private.content_safety_scans where id='${scan}'`), 'pending:pending');
      const oldScan = scanId(video.id), oldGeneration = safety(video.id).generation;
      run(`update public.video_assets set cloudflare_uid='c1-replaced-${video.asset}' where id='${video.asset}'`);
      assert.equal(candidate(video.id).decision, 'pending');
      run(`select private.story_enqueue_media_safety_v1('${video.id}')`);
      assert.notEqual(scanId(video.id), oldScan);
      assert.equal(safety(video.id).generation, oldGeneration + 1);
      assert.equal(safety(video.id).state, 'pending');
      assert.equal(safety(video.id).audio_complete, false);
      const beforeStaleTouch = safety(video.id);
      touch(oldScan);
      assert.deepEqual(safety(video.id), beforeStaleTouch, 'an old scan cannot overwrite the current generation');
    });

    await t.test('owner may inspect but followers remain denied even with fabricated passed and policy rows', () => {
      for (const digest of [pinnedPolicyDigest, '0'.repeat(64)]) {
        run(`update private.story_safety_state set state='passed',policy_digest='${digest}',
          evidence_fingerprint=private.story_current_fingerprint(story_id),evidence_generation=generation,
          visual_complete=true,audio_complete=true,text_complete=true,decided_at=clock_timestamp()
          where story_id='${image.id}'`);
        assert.equal(asValue(owner, `select private.story_can_access('${image.id}',false)`), 't');
        assert.equal(asValue(owner, `select count(*) from public.stories where id='${image.id}'`), '1');
        assert.equal(JSON.parse(asValue(owner, `select public.get_story_interactive_state('${image.id}')`)).story_id, image.id);
        assert.equal(asValue(follower, `select private.story_can_access('${image.id}',false)`), 'f');
        assert.equal(asValue(follower, `select count(*) from public.stories where id='${image.id}'`), '0');
        fails(as(follower, `select public.get_story_interactive_state('${image.id}')`), /story_not_visible/);
        assert.equal(candidate(image.id).activation_effect, false);
        assert.ok(['review', 'pending'].includes(candidate(image.id).decision));
      }
      run(`update private.story_safety_state set state='pending',policy_digest=null where story_id='${image.id}'`);
    });

    await t.test('every C1 private helper has locked ACL, postgres owner and empty search_path', () => {
      const names = ['story_content_safety_policy_c1_v1', 'story_content_safety_control_c1_v1',
        'story_content_safety_candidate_c1_v1', 'story_author_text_bundle_c1_v1',
        'story_refresh_safety_from_transcript_c1_v1', 'story_current_fingerprint', 'story_can_access',
        'content_safety_target_snapshot', 'content_safety_visual_source', 'enqueue_content_safety_scan',
        'story_enqueue_media_safety_v1', 'story_sync_safety_from_scan_v1'];
      const rows = query(`select jsonb_agg(jsonb_build_object('name',p.proname,
        'identity',n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')',
        'owner',r.rolname,'definer',p.prosecdef,'config',p.proconfig,'oid',p.oid,
        'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by p.proname)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
        where n.nspname='private' and p.proname=any(array[${names.map(quote).join(',')}])`);
      assert.equal(rows.length, names.length);
      for (const row of rows) {
        assert.equal(row.owner, 'postgres', row.name);
        assert.equal(row.definer, true, row.name);
        assert.deepEqual(row.config, ['search_path=""'], row.name);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const expected = row.name === 'story_can_access' && role === 'authenticated' ? 't' : 'f';
          assert.equal(run(`select has_function_privilege('${role}',${row.oid},'EXECUTE')`), expected,
            `${role}: ${row.name}`);
        }
        assert.equal(run(`select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,
          acldefault('f',p.proowner))) a where p.oid=${row.oid} and a.grantee=0 and a.privilege_type='EXECUTE'`), '0');
      }
      const expectedHelpers = JSON.parse(read('../.github/nelyon-production-release-policy.json'))
        .stories_safety_c1_transition.helper_attestations
        .map(({ identity, definition_sha256 }) => ({ identity, definition_sha256 }))
        .sort((left, right) => left.identity.localeCompare(right.identity));
      const installedHelpers = rows
        .map(({ identity, definition_sha256 }) => ({ identity, definition_sha256 }))
        .sort((left, right) => left.identity.localeCompare(right.identity));
      assert.deepEqual(installedHelpers, expectedHelpers,
        'release governance must attest the exact PostgreSQL helper definitions installed by C1');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        fails(`begin; set local role ${role}; select private.story_content_safety_policy_c1_v1(); rollback;`, /permission denied/);
      }
    });

    await t.test('failed and rolled-back transactions leave no Story/evidence writes or activation', () => {
      const beforeRows = run('select count(*) from public.stories');
      const beforeStates = run('select count(*) from private.story_safety_state');
      const beforeScans = run('select count(*) from private.content_safety_scans');
      const id = randomUUID();
      run(`begin; insert into public.stories(id,user_id,media_type,media_url) values('${id}','${owner}',
        'photo','https://fixture.invalid/c1-rollback.jpg'); select private.story_enqueue_media_safety_v1('${id}'); rollback;`);
      assert.equal(run('select count(*) from public.stories'), beforeRows);
      assert.equal(run('select count(*) from private.story_safety_state'), beforeStates);
      assert.equal(run('select count(*) from private.content_safety_scans'), beforeScans);
      fails(`begin; insert into public.stories(id,user_id,media_type,media_url) values('${id}','${owner}',
        'photo','https://fixture.invalid/c1-failure.jpg'); select private.story_enqueue_media_safety_v1('${id}'); select 1/0; commit;`, /division by zero/);
      assert.equal(run('select count(*) from public.stories'), beforeRows);
      assert.equal(run('select count(*) from private.story_safety_state'), beforeStates);
      assert.equal(run('select count(*) from private.content_safety_scans'), beforeScans);
      assert.equal(run(`select count(*) from private.story_safety_state where state='passed' and story_id<>'${historical}'`), '0');
      assert.equal(query('select private.story_content_safety_control_c1_v1()').activation, false);
    });
  } finally {
    if (created) run(`drop database ${db} with(force);`, 'postgres');
    assert.equal(run(`select count(*) from pg_database where datname='${db}'`, 'postgres'), '0');
    assert.equal(run('select datname from pg_database order by datname', 'postgres'), databasesBefore,
      'the disposable proof must not retain a database or alter the database inventory');
  }
});
