// SQL-real, reduced-schema contract proof. No remote URL or provider calls.
// PowerShell: $env:RUN_STORIES_C2_LOCAL='1'; node --test tests/storiesV2SafetyC2Local.integration.mjs
// Local psql: STORIES_C2_PG_BIN/PORT/USER (also accepts the B1 PG_* equivalents).
// Optional local Docker: STORIES_C2_PG_CONTAINER=<running postgres container>.
// A fresh database is built from the checked-in B1 baseline, B1, C1, then C2 and
// dropped even on failure. No existing database or baseline template is mutated.
// LIMITATIONS: B1 has structural scanner/MEDIA/P3 doubles. We inject synthetic
// evidence as postgres, never claim provider, full-schema, or PHYSICAL_PASS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const enabled = process.env.RUN_STORIES_C2_LOCAL === '1';
const db = `stories_c2_${randomUUID().replaceAll('-', '')}`;
const owner = '11111111-1111-4111-8111-111111111111';
const follower = '22222222-2222-4222-8222-222222222222';
const historical = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = value => `${quote(JSON.stringify(value))}::jsonb`;
const container = process.env.STORIES_C2_PG_CONTAINER;
const pgBin = process.env.STORIES_C2_PG_BIN || process.env.STORIES_B1_PG_BIN;
const port = process.env.STORIES_C2_PG_PORT || process.env.STORIES_B1_PG_PORT || '55432';
const user = process.env.STORIES_C2_PG_USER || process.env.STORIES_B1_PG_USER || 'postgres';
const psql = pgBin ? join(pgBin, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';

function run(sql, database = db, expectedFailure = false) {
  const env = { ...process.env, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' };
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[name];
  const psqlArgs = ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-p', container ? '5432' : port, '-U', user, '-d', database, '-At'];
  const command = container ? 'docker' : psql;
  const args = container ? ['--context', process.env.STORIES_C2_DOCKER_CONTEXT || 'default',
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
const scanId = id => run(`select scan_id from private.story_safety_state where story_id='${id}'`);

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

function createImage({ composition = { version: 1, elements: [] }, definitions = [], size = 10 } = {}) {
  const asset = randomUUID(), client = randomUUID();
  run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,
    bucket_name,object_key,mime_type,size_bytes,status) values('${asset}','${owner}',
    'r2','image','story_image','private','c2-disposable','stories/${asset}.jpg','image/jpeg',${size},'ready')`);
  const sql = `select public.create_story_with_media('${asset}',${jsonSql(composition)},'${client}',${jsonSql(definitions)})`;
  const id = asValue(owner, sql);
  return { id, asset, sql };
}

function createVideo() {
  const asset = randomUUID();
  assert.equal(run(`select public.reserve_stream_upload_asset('${asset}','${owner}',
    'video/mp4',100,'c2-proof.mp4','story_video')`), 'created');
  run(`update public.video_assets set status='ready',cloudflare_uid='c1-${asset}',duration_seconds=15,
    ready_at=now(),provider_metadata='{"require_signed_urls":true}' where id='${asset}'`);
  const id = asValue(owner, `select public.create_story_with_media('${asset}','{"version":1,"elements":[]}',
    '${randomUUID()}','[]')`);
  return { id, asset };
}

test('C2 disposable PostgreSQL publication, async evidence and human authority', { skip: !enabled }, async t => {
  assert.match(port,/^\d{1,5}$/);assert.match(user,/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  if(container) {
    assert.match(container,/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    const context=process.env.STORIES_C2_DOCKER_CONTEXT||'default';
    assert.ok(['default','desktop-linux'].includes(context));
    const inspect=spawnSync('docker',['context','inspect',context],{encoding:'utf8',timeout:15_000});
    assert.equal(inspect.status,0,inspect.stderr);
    assert.match(JSON.parse(inspect.stdout)[0].Endpoints.docker.Host,/^(?:npipe:\/\/|unix:\/\/)/);
  }
  let created = false;
  try {
    run(`create database ${db} template template0`, 'postgres'); created = true;
    run(read('./fixtures/stories_v2_interactive_b1_baseline.sql'));
    run(transcriptPrerequisites()); run(snapshotPrerequisite());
    run(read('../supabase/migrations/20261027042552_stories_v2_interactive_b1.sql'));
    run(`begin; ${read('./fixtures/stories_v2_interactive_b1_fixture.sql')} commit;`);
    run(read('../supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql'));
    // Audit table shape is a reduced-schema fixture. The exercised capability,
    // action writer, immutable action trigger and projections are canonical SQL.
    const a3 = read('../supabase/migrations/20260911162054_superuser_a3_canonical_authority_foundation.sql');
    const a5 = read('../supabase/migrations/20260911200240_superuser_a5_content_stories_chat_moderation.sql');
    const extract = (source, name) => source.match(new RegExp(`create function ${name.replaceAll('.', '\\.')}\\([^]*?\\$\\$;`))[0];
    run(`create table private.admin_action_audit(id uuid primary key default gen_random_uuid(),actor_id uuid,
      actor_kind text,actor_role_snapshot text[],actor_capability text,domain text,action text,target_type text,
      target_id uuid,target_ref text,reason text,outcome text,financial_effect boolean,contains_pii boolean,
      metadata jsonb,idempotency_scope text,idempotency_key uuid,request_fingerprint text,
      unique(idempotency_scope,idempotency_key));
      alter table private.content_safety_alerts add column status text not null default 'open';
      create view public.public_user_profiles with (security_invoker=true) as
        select id,username,display_name,avatar_url from public.user_profiles;
      ${a5.match(/create or replace function public\.marketplace_creator_content_visible\([^]*?\$\$;/)[0]}
      ${read('../supabase/migrations/20260811024000_marketplace_creator_content_product_tags.sql')
        .match(/create or replace function public\.marketplace_video_content_type\([^]*?\$\$;/)[0]}
      ${extract(a3,'private.admin_request_fingerprint').replace('create function','create or replace function')}
      ${extract(a5,'private.admin_execute_content_moderation')}
      ${extract(a5,'public.admin_moderate_story')}
      ${extract(a5,'public.search_admin_stories')}
      ${extract(a5,'public.get_admin_story_detail')}
      revoke all on function public.admin_moderate_story(uuid,text,text,uuid) from public,anon,service_role;
      grant execute on function public.admin_moderate_story(uuid,text,text,uuid) to authenticated;
      insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('33333333-3333-4333-8333-333333333333','MODERATOR','trusted_operator','local:story-c2','Disposable moderation proof')`);
    const before = safety(historical);
    if(process.env.STORIES_C2_SNAPSHOT_OUTPUT) {
      const {STORIES_SAFETY_C2_PRE_STATE_SQL}=await import('../scripts/nelyon-production-snapshot-adapter.mjs');
      writeFileSync(`${process.env.STORIES_C2_SNAPSHOT_OUTPUT}.pre.json`,JSON.stringify(query(`begin;
        create role supabase_read_only_user nologin bypassrls;
        grant pg_read_all_data to supabase_read_only_user;
        set local role supabase_read_only_user;
        ${STORIES_SAFETY_C2_PRE_STATE_SQL} rollback;`),null,2));
    }
    const files = readdirSync(new URL('../supabase/migrations/',import.meta.url))
      .filter(x => /_stories_v2_safety_c2_publish_first_async_review\.sql$/.test(x));
    if(files.length) run(read(`../supabase/migrations/${files[0]}`));
    if(process.env.STORIES_C2_SNAPSHOT_OUTPUT) {
      const {STORIES_SAFETY_C2_STATE_SQL}=await import('../scripts/nelyon-production-snapshot-adapter.mjs');
      writeFileSync(process.env.STORIES_C2_SNAPSHOT_OUTPUT,JSON.stringify(query(`begin;
        create role supabase_read_only_user nologin bypassrls;
        grant pg_read_all_data to supabase_read_only_user;
        set local role supabase_read_only_user;
        ${STORIES_SAFETY_C2_STATE_SQL} rollback;`),null,2));
    }
    if(process.env.STORIES_C2_CATALOG_OUTPUT) writeFileSync(process.env.STORIES_C2_CATALOG_OUTPUT, JSON.stringify(query(`
      select jsonb_build_object('helpers',(select jsonb_agg(jsonb_build_object(
        'identity',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
        'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,
        'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
          and p.prokind='f'),
      'triggers',(select jsonb_agg(jsonb_build_object('identity',t.tgname,'enabled',t.tgenabled,
        'table',n.nspname||'.'||c.relname,'definition',pg_get_triggerdef(t.oid),
        'definition_sha256',encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex'),
        'function_identity',t.tgfoid::regprocedure::text)) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal
          and t.tgname in('content_safety_story_alert_moderation_c2','story_initialize_safety'))) `),null,2));
    const image = createImage();
    await t.test('missing safety state always projects a non-null sanitized historical fallback',()=>{
      const missing=randomUUID();
      assert.deepEqual(query(`select private.story_runtime_status_c2_v1('${missing}')`),{
        publication_status:'unpublished',moderation_status:'unreviewed',scan_status:null,
      });
    });
    await t.test('private security boundaries preserve FORCE RLS and exact client execute permissions',()=>{
      assert.equal(run(`select relrowsecurity and relforcerowsecurity from pg_class where oid='private.story_safety_state'::regclass`),'t');
      for(const name of ['story_runtime_status_c2_v1(uuid)','story_publish_c2_v1(uuid,uuid)',
        'create_story_from_content_core_c2_v1(uuid,jsonb,uuid)','story_content_safety_control_c2_v1()',
        'story_content_safety_policy_c2_v1()']) {
        assert.equal(run(`select has_function_privilege('authenticated','private.${name}','execute')`),'f');
        assert.equal(run(`select has_function_privilege('service_role','private.${name}','execute')`),'f');
      }
      fails(as(follower,'select * from private.story_safety_state'),/permission denied/);
      assert.equal(run(`select has_function_privilege('anon','public.admin_moderate_story(uuid,text,text,uuid)','execute')`),'f');
    });
    await t.test('new canonical Story is immediately follower-visible with pending durable current scan', () => {
      assert.equal(asValue(follower, `select private.story_can_access('${image.id}',false)`), 't');
      assert.equal(safety(image.id).publication_status, 'published');
      assert.equal(safety(image.id).moderation_status, 'unreviewed');
      assert.equal(safety(image.id).state, 'pending');
      assert.equal(asValue(owner, image.sql), image.id);
      assert.equal(run(`select count(*) from private.content_safety_scans where target_id='${image.id}'`), '1');
    });
    await t.test('historical Story is unpublished without rewriting its existing evidence', () => {
      const after = safety(historical);
      assert.equal(after.publication_status, 'unpublished');
      for(const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key);
      assert.equal(asValue(follower, `select private.story_can_access('${historical}',false)`), 'f');
    });
    await t.test('failed durable enqueue rolls back the canonical Story transaction', () => {
      const asset = randomUUID();
      run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,status)
        values('${asset}','${owner}','r2','image','story_image','private','fixture','test.jpg','image/jpeg',10,'ready')`);
      fails(`begin; create or replace function private.story_enqueue_media_safety_v1(p_story_id uuid) returns uuid
        language sql security definer set search_path='' as 'select null::uuid';
        select set_config('request.jwt.claim.sub','${owner}',true);
        select public.create_story_with_media('${asset}','{"version":1,"elements":[]}', '${randomUUID()}','[]'); commit`, /story_safety_publication_fence_failed/);
      assert.equal(run(`select count(*) from public.media_asset_links where asset_id='${asset}'`),'0');
    });
    await t.test('C2 preserves the canonical per-owner creation velocity authority', () => {
      fails(`begin; create or replace function public.check_velocity_limit(p_user_id uuid,p_operation text,
        p_amount numeric,p_max_ops integer,p_max_amount numeric,p_window_hours integer default 1) returns boolean
        language sql security definer set search_path='' as 'select false';
        select set_config('request.jwt.claim.sub','${owner}',true);
        insert into public.stories(user_id,media_type,media_url)
          values('${owner}','photo','https://fixture.invalid/rate.jpg'); commit`, /story_rate_limited/);
    });
    await t.test('current multimodal scan state and failures never control publication', () => {
      const id=createImage().id, scan=scanId(id);
      const status=()=>query(`select private.story_runtime_status_c2_v1('${id}')`);
      assert.equal(status().scan_status,'queued');
      run(`update private.content_safety_scans set status='completed',text_status='analyzed' where id='${scan}'`);
      assert.equal(status().scan_status,'queued','text completion is not multimodal completion');
      run(`update private.content_safety_scans set status='processing' where id='${scan}'`);
      assert.equal(status().scan_status,'processing');
      run(`update private.content_safety_scans set visual_status='failed' where id='${scan}'`);
      assert.equal(status().scan_status,'failed');
      assert.equal(status().publication_status,'published');
      assert.equal(asValue(follower,`select private.story_can_access('${id}',false)`),'t');
      run(`update private.content_safety_scans set visual_status='pending',status='queued' where id='${scan}'`);
      assert.equal(status().scan_status,'queued');
      attachVisual(id,run(`select asset_id from public.media_asset_links where entity_id='${id}'`));
      assert.equal(status().scan_status,'completed');
      assert.equal(safety(id).state,'review');
      run(`update private.content_safety_scans set status='failed' where id='${scan}'`);
      assert.equal(status().scan_status,'failed','failed provider status overrides otherwise complete technical evidence');
      const video=createVideo(),videoScan=scanId(video.id);
      attachVisual(video.id,video.asset,true);
      assert.equal(query(`select private.story_runtime_status_c2_v1('${video.id}')`).scan_status,'queued');
      insertTranscript(video.id,{status:'completed',rules:'current'});
      run(`update private.content_safety_scans set audio_status='analyzed' where id='${videoScan}'`);
      assert.equal(query(`select private.story_runtime_status_c2_v1('${video.id}')`).scan_status,'completed');
      assert.equal(safety(video.id).publication_status,'published');
    });
    await t.test('alerts deduplicate and only current evidence marks an unreviewed Story alerted', () => {
      const fresh=createImage(), scan=scanId(fresh.id), alert=randomUUID();
      const insert=(id,scanId,fingerprint)=>`insert into private.content_safety_alerts(id,scan_id,target_type,target_id,owner_user_id,
        source_type,alert_fingerprint,evidence) values('${id}','${scanId}','story','${fresh.id}','${owner}',
        'text_rule','${fingerprint}','{}') on conflict(alert_fingerprint) do update set updated_at=clock_timestamp()`;
      run(insert(alert,randomUUID(),'stale-alert'));
      assert.equal(safety(fresh.id).moderation_status,'unreviewed');
      run(insert(randomUUID(),scan,'current-alert'));run(insert(randomUUID(),scan,'current-alert'));
      assert.equal(safety(fresh.id).moderation_status,'alerted');
      assert.equal(run(`select count(*) from private.content_safety_alerts where alert_fingerprint='current-alert'`),'1');
      const admin='33333333-3333-4333-8333-333333333333';
      asValue(admin,`select public.admin_moderate_story('${fresh.id}','keep','Human reviewed','${randomUUID()}')`);
      run(insert(randomUUID(),scan,'second-current-alert'));
      assert.equal(safety(fresh.id).moderation_status,'reviewed_keep');
      assert.equal(query(`select private.story_runtime_status_c2_v1('${fresh.id}')`).moderation_status,'alerted');
      run(`update private.content_safety_alerts set status='resolved' where target_id='${fresh.id}'`);
      assert.equal(query(`select private.story_runtime_status_c2_v1('${fresh.id}')`).moderation_status,'reviewed_keep');
      assert.equal(safety(fresh.id).publication_status,'published');
      const unreviewed=createImage(), ignored=randomUUID();
      run(`insert into private.content_safety_alerts(id,scan_id,target_type,target_id,owner_user_id,source_type,
        alert_fingerprint,evidence,status) values('${ignored}','${scanId(unreviewed.id)}','story','${unreviewed.id}',
        '${owner}','text_rule','dismissed-alert','{}','dismissed')`);
      assert.equal(safety(unreviewed.id).moderation_status,'unreviewed');
      run(`update private.content_safety_alerts set updated_at=clock_timestamp() where id='${ignored}'`);
      assert.equal(safety(unreviewed.id).moderation_status,'unreviewed');
    });
    await t.test('all canonical media/shared create overloads commit publication with their final current scan',()=>{
      const source=randomUUID();
      run(`insert into public.videos(id,user_id,video_url,caption) values('${source}','${owner}',
        'https://fixture.invalid/share.mp4','Shared fixture')`);
      for(const definitions of [false,true]) {
        const client=randomUUID();
        const element=randomUUID(), composition=definitions?{version:2,elements:[{id:element,type:'interactive',
          element_id:element,x:0.5,y:0.5,scale:1,rotation:0}]}:{version:1,elements:[]};
        const config=[{version:1,element_id:element,type:'poll',prompt:'Choose',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}];
        const command=`select public.create_story_from_content('${source}',${jsonSql(composition)},
          '${client}'${definitions?','+jsonSql(config):''})`;
        const id=asValue(owner,command);
        assert.equal(safety(id).publication_status,'published');
        assert.equal(asValue(follower,`select private.story_can_access('${id}',false)`),'t');
        assert.equal(asValue(owner,command),id);
        assert.equal(run(`select count(*) from private.content_safety_scans where target_type='story' and target_id='${id}'`),'1');
      }
      for(const single of [true,false]) {
        const asset=randomUUID();
        run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,
          object_key,mime_type,size_bytes,status) values('${asset}','${owner}','r2','image','story_image',
          'private','fixture','${asset}.jpg','image/jpeg',10,'ready')`);
        const id=asValue(owner,`select public.create_story_with_media('${asset}'${single?'':`,'{"version":1,"elements":[]}','${randomUUID()}'`})`);
        assert.equal(safety(id).publication_status,'published');
      }
    });
    await t.test('audience, expiry, overlay and fresh signed-grant RLS remain publication gated', () => {
      const fresh=createImage();
      run(`insert into public.blocked_users(blocker_id,blocked_id) values('${owner}','${follower}')`);
      assert.equal(asValue(follower,`select private.story_can_access('${fresh.id}',false)`),'f');
      run(`delete from public.blocked_users where blocker_id='${owner}' and blocked_id='${follower}'`);
      assert.equal(asValue(follower,`select count(*) from public.media_asset_links where entity_id='${fresh.id}'`),'1');
      run(`update public.stories set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${fresh.id}'`);
      assert.equal(asValue(follower,`select private.story_can_access('${fresh.id}',false)`),'f');
      run(`update private.content_safety_scans set status='completed' where id='${scanId(fresh.id)}'`);
      assert.equal(asValue(follower,`select private.story_can_access('${fresh.id}',false)`),'f');
    });
    await t.test('publish-first question responses remain private and absent from Story and admin payloads',()=>{
      const element=randomUUID(), fresh=createImage({composition:{version:2,elements:[{id:element,type:'interactive',
        element_id:element,x:0.5,y:0.5,scale:1,rotation:0}]},definitions:[{version:1,element_id:element,
        type:'question',prompt:'Private question'}]});
      asValue(follower,`select public.respond_to_story_element('${fresh.id}','${element}','${randomUUID()}',
        '{"text":"Secret private C2 response"}')`);
      const other='33333333-3333-4333-8333-333333333333';
      const state=asValue(other,`select public.get_story_interactive_state('${fresh.id}')`);
      assert.doesNotMatch(state,/Secret private C2 response|respondent_id/);
      assert.doesNotMatch(asValue(other,`select public.get_admin_story_detail('${fresh.id}')`),/Secret private C2 response|respondent_id/);
      assert.doesNotMatch(asValue(follower,`select to_jsonb(stories) from public.stories where id='${fresh.id}'`),/Secret private C2 response/);
      fails(as(other,`select public.get_story_interactive_results('${fresh.id}','${element}')`),/story_results_owner_only/);
      assert.match(asValue(owner,`select public.get_story_interactive_results('${fresh.id}','${element}')`),/Secret private C2 response/);
    });
    await t.test('stale and deleted scan completions cannot recreate publication or human moderation',()=>{
      const fresh=createImage(),oldScan=scanId(fresh.id),admin='33333333-3333-4333-8333-333333333333';
      run(`update public.media_assets set size_bytes=11 where id='${fresh.asset}';
        select private.story_enqueue_media_safety_v1('${fresh.id}')`);
      assert.notEqual(scanId(fresh.id),oldScan);
      fails(`update private.content_safety_scans set visual_status='analyzed' where id='${oldScan}'`,/story_safety_stale_evidence/);
      asValue(admin,`select public.admin_moderate_story('${fresh.id}','remove','Human removal','${randomUUID()}')`);
      run(`update private.content_safety_scans set status='completed',updated_at=clock_timestamp() where id='${oldScan}'`);
      assert.equal(safety(fresh.id).publication_status,'removed');
      assert.equal(safety(fresh.id).moderation_status,'reviewed_remove');
      const deleted=createImage(),deletedScan=scanId(deleted.id);
      asValue(owner,`select deleted_story_id from public.delete_story('${deleted.id}')`);
      fails(`update private.content_safety_scans set visual_status='analyzed' where id='${deletedScan}'`,/story_safety_target_missing/);
      assert.equal(run(`select count(*) from private.story_safety_state where story_id='${deleted.id}'`),'0');
      assert.equal(asValue(follower,`select private.story_can_access('${deleted.id}',false)`),'f');
    });
    await t.test('admin inspection resolves canonical private direct Stream Stories without permanent URLs',()=>{
      const video=createVideo(),admin='33333333-3333-4333-8333-333333333333';
      const detail=()=>JSON.parse(asValue(admin,`select public.get_admin_story_detail('${video.id}')`));
      const result=detail();
      assert.equal(result.source_status,'available');
      assert.equal(result.media_origin,'story_stream_asset');
      assert.equal(result.resolved_media_kind,'video');
      assert.equal(result.linked_video_asset_id,video.asset);
      assert.equal(result.video_asset_id,video.asset);
      assert.equal(result.media_asset_id,null);
      for(const key of ['media_url','preview_url','poster_url']) assert.equal(result[key],null);
      assert.doesNotMatch(JSON.stringify(result),/cloudflare_uid|require_signed_urls|c1-/);
      const list=JSON.parse(asValue(admin,`select public.search_admin_stories(null,null,null,null,null,100)`));
      const item=list.items.find(item=>item.id===video.id);
      assert.equal(item.source_status,'available');assert.equal(item.media_origin,'story_stream_asset');
      assert.equal(item.resolved_media_kind,'video');assert.equal(item.linked_video_asset_id,video.asset);
      run(`update public.video_assets set status='failed' where id='${video.asset}'`);
      assert.equal(detail().source_status,'unavailable');
      assert.equal(detail().video_asset_id,null);
    });
    await t.test('admin restrict/remove/keep are audited and idempotent without media deletion; scanner cannot undo them', () => {
      const admin = '33333333-3333-4333-8333-333333333333', key = randomUUID();
      const command = `select public.admin_moderate_story('${image.id}','restrict','Review required','${key}')`;
      fails(as(owner, command), /admin_capability_forbidden/);
      const receipt = JSON.parse(asValue(admin, command));
      assert.deepEqual(JSON.parse(asValue(admin, command)),receipt);
      fails(as(admin,command.replace('Review required','Changed reason')),/admin_idempotency_conflict/);
      assert.equal(safety(image.id).publication_status,'restricted');
      assert.equal(safety(image.id).moderation_status,'reviewed_restrict');
      const detail=JSON.parse(asValue(admin,`select public.get_admin_story_detail('${image.id}')`));
      assert.equal(detail.visibility,'hidden');
      const list=JSON.parse(asValue(admin,`select public.search_admin_stories(null,'hidden',null,null,null,100)`));
      assert.ok(list.items.some(item=>item.id===image.id));
      assert.equal(asValue(follower,`select private.story_can_access('${image.id}',false)`),'f');
      run(`update private.content_safety_scans set status='failed',visual_status='failed',updated_at=clock_timestamp() where id='${scanId(image.id)}'`);
      assert.equal(safety(image.id).publication_status,'restricted');
      assert.equal(safety(image.id).moderation_status,'reviewed_restrict');
      asValue(admin,`select public.admin_moderate_story('${image.id}','remove','Removed by review','${randomUUID()}')`);
      assert.equal(safety(image.id).publication_status,'removed');
      assert.equal(run(`select visibility_before from private.admin_content_moderation_actions
        where target_id='${image.id}' and action='remove'`),'hidden');
      assert.equal(asValue(owner,image.sql),image.id);
      assert.equal(safety(image.id).publication_status,'removed');
      assert.equal(run(`select deleted_at is null from public.media_assets where id='${image.asset}'`),'t');
      asValue(admin,`select public.admin_moderate_story('${image.id}','hide','Legacy hide','${randomUUID()}')`);
      asValue(admin,`select public.admin_moderate_story('${image.id}','keep','Reconsideration','${randomUUID()}')`);
      assert.equal(asValue(follower,`select private.story_can_access('${image.id}',false)`),'f');
      asValue(admin,`select public.admin_moderate_story('${image.id}','restore','Legacy restore','${randomUUID()}')`);
      assert.equal(asValue(follower,`select private.story_can_access('${image.id}',false)`),'t');
      assert.equal(run(`select count(*) from private.admin_action_audit where target_id='${image.id}'`),'5');
    });
  } finally {
    if(created) run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}'; drop database ${db}`, 'postgres');
    assert.equal(run(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0',
      'this proof leaves no disposable database; concurrent independent proofs may create their own');
  }
});

function attachVisual(id, asset, video = false) {
  const scan = scanId(id), analysis = randomUUID();
  run(`insert into private.content_safety_visual_analyses(id,source_scan_id,video_asset_id,
    media_asset_id,source_content_fingerprint,provider,model,prompt_version,sample_strategy,
    frame_count,frame_timestamps_ms,analysis_result,analysis_fingerprint,provider_call_count)
    select '${analysis}',id,${video ? `'${asset}'` : 'null'},${video ? 'null' : `'${asset}'`},
      content_fingerprint,visual_provider,visual_model,visual_prompt_version,'c2-synthetic',1,
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
