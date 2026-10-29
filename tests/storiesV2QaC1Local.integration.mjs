// SQL-real reduced-schema proof, using B1 structural media/scanner fixtures.
// No provider/production calls or physical-device result. Opt in explicitly:
// RUN_STORIES_QA_C1_LOCAL=1; STORIES_QA_C1_PG_BIN=<local PostgreSQL bin>.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const enabled = process.env.RUN_STORIES_QA_C1_LOCAL === '1';
const db = `stories_qa_c1_${randomUUID().replaceAll('-', '')}`;
const owner = '11111111-1111-4111-8111-111111111111';
const follower = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const container = process.env.STORIES_QA_C1_PG_CONTAINER;
const context = process.env.STORIES_QA_C1_DOCKER_CONTEXT || 'default';
const port = process.env.STORIES_QA_C1_PG_PORT || '55432';
const user = process.env.STORIES_QA_C1_PG_USER || 'postgres';
const bin = process.env.STORIES_QA_C1_PG_BIN;
const psql = bin ? join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';
function invocation(database,{dockerContainer=container,dockerContext=context}={}) {
  const env = { ...process.env, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8', PGHOSTADDR:'127.0.0.1' };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[key];
  const args = ['-X','-q','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1',
    '-p',dockerContainer ? '5432' : port,'-U',user,'-d',database,'-At'];
  return { command: dockerContainer ? 'docker' : psql,
    args: dockerContainer ? ['--context',dockerContext,'exec','-i','-e','PGHOSTADDR=127.0.0.1',
      '-e','PGSERVICE=','-e','PGSERVICEFILE=','-e','PGOPTIONS=','-e','PGCONNECT_TIMEOUT=5','-e','PGCLIENTENCODING=UTF8',
      dockerContainer,'psql',...args] : args, env };
}
function run(sql, database = db, failure = false) {
  const { command, args, env } = invocation(database);
  const result = spawnSync(command,args,{input:sql,encoding:'utf8',env,timeout:60_000,maxBuffer:16*1024*1024});
  if (!failure) assert.equal(result.status,0,`${result.error || ''}\n${result.stderr}`);
  return failure ? result : result.stdout.replaceAll('\r\n','\n').trim();
}
function concurrent(sql) {
  const { command, args, env } = invocation(db);
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{env});let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),60_000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    child.on('error',reject);child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
    child.stdin.end(sql);
  });
}
const query = sql => JSON.parse(run(sql).split('\n').at(-1));
const as = (actor,sql,end='commit') => `begin; set local role authenticated;
  select set_config('request.jwt.claim.sub',${quote(actor)},true); ${sql}; ${end};`;
const value = (actor,sql) => run(as(actor,sql)).split('\n').at(-1);
function fails(sql, pattern = /story_question_answer_denied/) {
  const result=run(`\\set VERBOSITY verbose\n${sql}`,db,true);assert.notEqual(result.status,0,'operation must be rejected');
  assert.match(result.stderr,pattern);if(pattern.source==='story_idempotency_conflict') assert.match(result.stderr,/23505/);
  return result.stderr;
}
function extract(source,name) {
  const match=source.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.','\\.')}\\([^]*?\\$\\$;`));
  assert.ok(match,`canonical prerequisite ${name}`);return match[0].replace(/^create function/,'create or replace function');
}
function setup() {
  run(read('./fixtures/stories_v2_interactive_b1_baseline.sql'));
  run(`alter table private.content_safety_audio_transcripts add column rule_eval_ruleset_fingerprint text;
    create table private.content_safety_rules(id uuid primary key,version integer not null,
      detector_type text not null,pattern text not null,approval_state text not null,enabled boolean not null,scopes text[] not null);
    ${extract(read('../supabase/migrations/20260915130911_admin_content_safety_audio_stt_ai_v1.sql'),'private.content_safety_transcript_ruleset_fingerprint')}
    revoke all on function private.content_safety_transcript_ruleset_fingerprint() from public,anon,authenticated,service_role;`);
  run(extract(read('../supabase/migrations/20260914144028_admin_content_safety_alert_pipeline_v1.sql'),'private.content_safety_target_snapshot'));
  run(read('../supabase/migrations/20261027042552_stories_v2_interactive_b1.sql'));
  run(`begin; ${read('./fixtures/stories_v2_interactive_b1_fixture.sql')} commit;`);
  run(read('../supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql'));
  const a3=read('../supabase/migrations/20260911162054_superuser_a3_canonical_authority_foundation.sql');
  const a5=read('../supabase/migrations/20260911200240_superuser_a5_content_stories_chat_moderation.sql');
  run(`create table private.admin_action_audit(id uuid primary key default gen_random_uuid(),actor_id uuid,
    actor_kind text,actor_role_snapshot text[],actor_capability text,domain text,action text,target_type text,
    target_id uuid,target_ref text,reason text,outcome text,financial_effect boolean,contains_pii boolean,
    metadata jsonb,idempotency_scope text,idempotency_key uuid,request_fingerprint text,unique(idempotency_scope,idempotency_key));
    alter table private.content_safety_alerts add column status text not null default 'open';
    create view public.public_user_profiles with(security_invoker=true) as select id,username,display_name,avatar_url from public.user_profiles;
    ${extract(a5,'public.marketplace_creator_content_visible')}
    ${extract(read('../supabase/migrations/20260811024000_marketplace_creator_content_product_tags.sql'),'public.marketplace_video_content_type')}
    ${extract(a3,'private.admin_request_fingerprint')}
    ${extract(a5,'private.admin_execute_content_moderation')}
    ${extract(a5,'public.admin_moderate_story')}
    ${extract(a5,'public.search_admin_stories')}
    ${extract(a5,'public.get_admin_story_detail')}
    revoke all on function public.admin_moderate_story(uuid,text,text,uuid) from public,anon,service_role;
    grant execute on function public.admin_moderate_story(uuid,text,text,uuid) to authenticated;
    insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('${other}','MODERATOR','trusted_operator','local:qa-c1','Disposable proof');`);
  run(read('../supabase/migrations/20261027191918_stories_v2_safety_c2_publish_first_async_review.sql'));
}
function asset(video=false) {
  const id=randomUUID();
  if(video) {
    assert.equal(run(`select public.reserve_stream_upload_asset('${id}','${owner}','video/mp4',100,'qa-proof.mp4','story_video')`),'created');
    run(`update public.video_assets set status='ready',cloudflare_uid='qa-${id}',duration_seconds=15,
      ready_at=now(),provider_metadata='{"require_signed_urls":true}' where id='${id}'`);
  } else run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,status)
      values('${id}','${owner}','r2','image','story_image','private','qa-disposable','${id}.jpg','image/jpeg',10,'ready')`);
  return id;
}
const card = () => ({id:randomUUID(),type:'question_answer',x:0.5,y:0.5,scale:1,rotation:0,question:'Submitted private question',answer:'Creator answer'});
const composition = c => ({version:2,elements:[c]});
function counts() {
  return query(`select jsonb_build_object('stories',(select count(*) from public.stories),
    'links',(select count(*) from public.media_asset_links)+(select count(*) from public.video_asset_links),
    'receipts',(select count(*) from private.story_question_answer_links),'scans',(select count(*) from private.content_safety_scans),
    'safety',(select count(*) from private.story_safety_state),'definitions',(select count(*) from private.story_interactive_elements),
    'revisions',(select count(*) from public.story_interactive_revisions),'velocity',(select coalesce(sum(count),0) from public.velocity_counters),
    'messages',(select count(*) from public.messages),'idempotency',(select count(*) from public.idempotency_keys))`);
}
function rowState() {
  const tables=['public.stories','public.media_asset_links','public.video_asset_links','private.story_question_answer_links',
    'private.story_interactive_elements','public.story_interactive_revisions','private.content_safety_scans','private.story_safety_state',
    'public.velocity_counters','public.messages','public.chat_conversations','public.idempotency_keys'];
  return query(`select jsonb_build_object(${tables.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from ${table} r)`).join(',')})`);
}
async function observe(predicate) {
  for(let attempt=0;attempt<30;attempt++) {
    if(run(predicate)==='t') return;await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.fail('concurrent session did not reach the observed lock boundary');
}
const immutableEvidence = () => query(`select jsonb_build_object('functions',(select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid))
  from pg_proc p where p.oid in('private.story_publish_c2_v1(uuid,uuid)'::regprocedure,
    'private.story_current_fingerprint(uuid)'::regprocedure,'private.story_enqueue_media_safety_v1(uuid)'::regprocedure,
    'private.create_story_with_media_core(uuid,jsonb,uuid)'::regprocedure,'private.story_install_definitions(uuid,jsonb)'::regprocedure,
    'private.story_content_safety_control_c2_v1()'::regprocedure,'private.story_content_safety_policy_c2_v1()'::regprocedure)),
  'policy',private.story_content_safety_policy_c2_v1(),'control',private.story_content_safety_control_c2_v1(),
  'triggers',(select jsonb_object_agg(tgname,jsonb_build_array(pg_get_triggerdef(oid),tgenabled,tgfoid::regprocedure::text))
    from pg_trigger where tgname in('story_initialize_safety','content_safety_story_alert_moderation_c2')))`);
// Preserve every installed shared function/policy/ACL, including reduced-fixture
// MEDIA/P3/Chat controls. Finance/LIVE full authorities are outside this baseline.
const preservedCatalog = () => query(`select jsonb_build_object('functions',(select jsonb_object_agg(p.oid::regprocedure::text,
  jsonb_build_array(pg_get_functiondef(p.oid),p.proacl::text,pg_get_userbyid(p.proowner)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'
    and p.proname not in('story_validate_composition','story_author_text_bundle_c1_v1','create_story_with_media','create_story_from_content',
      'story_question_answer_source_qa_c1_v1','prepare_story_question_answer','create_story_question_answer_with_media','story_check_question_answer_link_qa_c1_v1')),
  'relations',(select jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_array(c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind in('r','v') and c.relname<>'story_question_answer_links'),
  'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p))`);

test('QA runner pins sync/async libpq loopback despite hostile ambient connection settings',()=>{
  const keys=['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    Object.assign(process.env,{PGHOSTADDR:'192.0.2.1',PGSERVICE:'remote',PGSERVICEFILE:'remote.ini',PGOPTIONS:'-c search_path=hostile'});
    const local=invocation('disposable',{dockerContainer:null});
    assert.equal(local.env.PGHOSTADDR,'127.0.0.1');assert.deepEqual(keys.slice(1).filter(k=>k in local.env),[]);
    assert.equal(local.args[local.args.indexOf('-h')+1],'127.0.0.1');
    const docker=invocation('disposable',{dockerContainer:'local_fixture'});
    for(const setting of ['PGHOSTADDR=127.0.0.1','PGSERVICE=','PGSERVICEFILE=','PGOPTIONS=']) assert.ok(docker.args.includes(setting));
    assert.equal(docker.args[docker.args.indexOf('-h')+1],'127.0.0.1');
  } finally {for(const key of keys) {if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}}
});

test('QA C1 disposable PostgreSQL authority', {skip:!enabled}, async t => {
  assert.match(port,/^\d{1,5}$/);assert.match(user,/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  if(container) {
    assert.match(container,/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);assert.ok(['default','desktop-linux'].includes(context));
    const inspect=spawnSync('docker',['context','inspect',context],{encoding:'utf8',timeout:15_000});
    assert.equal(inspect.status,0,inspect.stderr);assert.match(JSON.parse(inspect.stdout)[0].Endpoints.docker.Host,/^(?:npipe:\/\/|unix:\/\/)/);
  }
  let created=false,primaryFailure;
  try {
    assert.deepEqual(queryServer(),['127.0.0.1',Number(container?'5432':port)],'effective connection is loopback before CREATE DATABASE');
    run(`create database ${db} template template0`,'postgres');created=true;setup();
    const unchanged=immutableEvidence(),sharedCatalog=preservedCatalog();
    const beforeMigration=query(`select jsonb_build_array((select count(*) from public.stories),(select count(*) from public.messages),
      (select count(*) from private.content_safety_scans),(select count(*) from private.story_interactive_responses))`);
    const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>/_stories_v2_qa_c1_question_answer_authority\.sql$/.test(x));
    assert.equal(files.length,1,'exactly one forward QA authority migration is required');
    run(read(`../supabase/migrations/${files[0]}`));
    assert.deepEqual(immutableEvidence(),unchanged,'canonical C2/core/enqueue/fingerprint/policy remain unchanged');
    assert.deepEqual(preservedCatalog(),sharedCatalog,'all installed shared authorities, ACL and policies remain unchanged');
    assert.deepEqual(query(`select jsonb_build_array((select count(*) from public.stories),(select count(*) from public.messages),
      (select count(*) from private.content_safety_scans),(select count(*) from private.story_interactive_responses))`),beforeMigration,'migration creates no content/evidence');
    assert.equal(run('select count(*) from private.story_question_answer_links'),'0');
    const element=randomUUID(),sourceAsset=asset();
    const source=value(owner,`select public.create_story_with_media('${sourceAsset}',${json({version:2,elements:[{id:randomUUID(),type:'interactive',element_id:element,x:0.5,y:0.5,scale:1,rotation:0} ]})},'${randomUUID()}',${json([{version:1,element_id:element,type:'question',prompt:'Sticker prompt is not the submitted question'}])})`);
    value(follower,`select public.respond_to_story_element('${source}','${element}','${randomUUID()}','{"text":"Submitted private question"}')`);
    const preflight=`select public.prepare_story_question_answer('${source}','${element}','${follower}')`;
    const request=(media=asset(),c=card(),client=randomUUID(),defs=[],tuple=[source,element,follower],publicComposition=composition(c))=>({media,c,client,defs,
      sql:`select public.create_story_question_answer_with_media(${tuple.map(quote).join(',')},'${media}',${json(publicComposition)},'${client}',${json(defs)})`});

    await t.test('owner preflight returns only submitted question and recipient without writes',()=>{
      const before=counts();assert.deepEqual(JSON.parse(value(owner,preflight)),{question:'Submitted private question',respondent_id:follower});
      assert.deepEqual(counts(),before);
      run(`begin; delete from public.follows where follower_id='${follower}' and following_id='${owner}';
        select set_config('request.jwt.claim.sub','${owner}',true); ${preflight}; rollback;`);
    });
    await t.test('image and signed Stream publication uses real C2 pending review and sanitized projection',()=>{
      for(const video of [false,true]) {
        const r=request(asset(video));const id=value(owner,r.sql);
        assert.equal(run(`select publication_status||'/'||moderation_status||'/'||state from private.story_safety_state where story_id='${id}'`),'published/unreviewed/pending');
        assert.equal(run(`select count(*) from private.story_question_answer_links where story_id='${id}'`),'1');
        assert.equal(run(`select count(*) from private.content_safety_scans where target_id='${id}'`),'1');
        assert.equal(run(`select count(*) from public.story_interactive_revisions where story_id='${id}'`),'0');
        const projection=JSON.parse(value(follower,`select story_composition from public.stories where id='${id}'`));
        assert.deepEqual(Object.keys(projection.elements[0]).sort(),['answer','id','question','rotation','scale','type','x','y']);
        for(const privateId of [source,element,follower]) assert.ok(!JSON.stringify(projection).includes(privateId));
        const publicPayloads=[value(follower,`select to_jsonb(s) from public.stories s where id='${id}'`),
          value(follower,`select public.get_story_interactive_state('${id}')`),
          value(follower,`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.story_interactive_revisions r where story_id='${id}'`)];
        for(const payload of publicPayloads) {
          for(const privateId of [source,element,follower]) assert.ok(!payload.includes(privateId),payload);
          assert.doesNotMatch(payload,/respondent_id|source_story_id|source_element_id|request_hash|moderation_state|story_question_answer_links/);
          assert.doesNotMatch(payload,/stories_b1_viewer|private-respondent-avatar/);
        }
        run(`update private.content_safety_scans set status='failed' where target_id='${id}'`);
        assert.equal(value(owner,r.sql),id,'failed asynchronous scan is not a new denial');
      }
    });
    await t.test('wrong actor, moderator, anon and wrong tuple are denied without writes',()=>{
      const before=counts();for(const actor of [follower,other,'']) {fails(as(actor,preflight));fails(as(actor,request().sql));}
      fails(`set role anon; ${preflight}`,/permission denied/);
      fails(`set role anon; ${request().sql}`,/permission denied/);
      for(const tuple of [[randomUUID(),element,follower],[source,randomUUID(),follower],[source,element,other]]) {
        const error=fails(as(owner,request(asset(),card(),randomUUID(),[],tuple).sql));
        for(const privateId of tuple) assert.ok(!error.includes(privateId));
      }
      fails(as(owner,`select public.prepare_story_question_answer(null,'${element}','${follower}')`));assert.deepEqual(counts(),before);
      const media=asset();for(const index of [0,1,2,3,5]) {
        const args=[quote(source),quote(element),quote(follower),quote(media),json(composition(card())),quote(randomUUID()),"'[]'::jsonb"];
        args[index]='null';fails(as(owner,`select public.create_story_question_answer_with_media(${args.join(',')})`));
      }
    });
    await t.test('response moderation, lifecycle, missing safety and bilateral blocks are freshly denied',()=>{
      const mutations=[
        `update private.story_interactive_responses set moderation_state='hidden' where story_id='${source}'`,
        `update private.story_interactive_responses set moderation_state='blocked' where story_id='${source}'`,
        `update public.stories set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${source}'`,
        `delete from public.stories where id='${source}'`,
        `delete from private.story_safety_state where story_id='${source}'`,
        `update private.story_safety_state set publication_status='unpublished' where story_id='${source}'`,
        `update private.story_safety_state set published_at=null where story_id='${source}'`,
        `update private.story_safety_state set publication_status='restricted' where story_id='${source}'`,
        `update private.story_safety_state set publication_status='removed' where story_id='${source}'`,
        `update private.story_safety_state set moderation_status='reviewed_restrict' where story_id='${source}'`,
        `update private.story_safety_state set moderation_status='reviewed_remove' where story_id='${source}'`,
        `insert into public.blocked_users(blocker_id,blocked_id) values('${owner}','${follower}')`,
        `insert into public.blocked_users(blocker_id,blocked_id) values('${follower}','${owner}')`,
      ];
      for(const mutation of mutations) {const r=request();const before=counts();fails(`begin; ${mutation}; select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`);assert.deepEqual(counts(),before);}
      const r=request();fails(`begin; select set_config('request.jwt.claim.sub','${owner}',true); ${preflight};
        update private.story_interactive_responses set moderation_state='hidden' where story_id='${source}'; ${r.sql}; commit;`);
      fails(as(owner,`select public.prepare_story_question_answer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${element}','${follower}')`));
      fails(`begin;insert into private.story_interactive_responses(story_id,element_id,respondent_id,payload,moderation_state)
        values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000005','${follower}','{"text":"Historical question"}','pending');
        select set_config('request.jwt.claim.sub','${owner}',true);
        select public.prepare_story_question_answer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000005','${follower}');commit;`);
      const hidden=request();fails(`begin; select set_config('request.jwt.claim.sub','${other}',true);
        select public.admin_moderate_story('${source}','hide','Disposable hidden source','${randomUUID()}');
        select set_config('request.jwt.claim.sub','${owner}',true); ${preflight}; ${hidden.sql}; commit;`);
      const self=request(asset(),card(),randomUUID(),[],[source,element,owner]);
      fails(`begin; insert into private.story_interactive_responses(story_id,element_id,respondent_id,payload,moderation_state)
        values('${source}','${element}','${owner}','{"text":"Submitted private question"}','pending');
        select set_config('request.jwt.claim.sub','${owner}',true); ${self.sql}; commit;`);
      fails(as(owner,`select public.prepare_story_question_answer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001','${follower}')`));
      const poll=randomUUID(),pollAsset=asset();
      const pollStory=value(owner,`select public.create_story_with_media('${pollAsset}',${json({version:2,elements:[{id:randomUUID(),type:'interactive',element_id:poll,x:0.5,y:0.5,scale:1,rotation:0}]})},'${randomUUID()}',
        ${json([{version:1,element_id:poll,type:'poll',prompt:'Poll',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}])})`);
      value(follower,`select public.respond_to_story_element('${pollStory}','${poll}','${randomUUID()}','{"option_id":"a"}')`);
      fails(as(owner,request(asset(),card(),randomUUID(),[],[pollStory,poll,follower]).sql));
      const corrupt=request();fails(`begin; update private.story_interactive_responses set payload='{"text":"Bad\\nquestion"}' where story_id='${source}';
        select set_config('request.jwt.claim.sub','${owner}',true); ${corrupt.sql}; commit;`);
      // Canonical B1 accepts whitespace around submitted text; QA uses its
      // authoritative trimmed question without publishing the original padding.
      assert.deepEqual(query(`begin; update private.story_interactive_responses set payload=${json({text:'\u00a0Submitted private question\ufeff'})} where story_id='${source}';
        select set_config('request.jwt.claim.sub','${owner}',true); ${preflight}; rollback;`),{question:'Submitted private question',respondent_id:follower});
    });
    await t.test('static QA coexists with ordinary overlays and independently installed interactive definitions',()=>{
      const poll=randomUUID(),c=card();
      const ordinary={id:randomUUID(),type:'text',x:0.5,y:0.1,scale:1,rotation:0,text:'Overlay',color:'#FFFFFF',align:'center',size:'medium'};
      const sticker={id:randomUUID(),type:'sticker',x:0.5,y:0.8,scale:1,rotation:0,value:'🔥'};
      const placement={id:randomUUID(),type:'interactive',element_id:poll,x:0.5,y:0.9,scale:1,rotation:0};
      const definitions=[{version:1,element_id:poll,type:'poll',prompt:'Choose',options:[{id:'a',label:'First'},{id:'b',label:'Second'}]}];
      const r=request(asset(),c,randomUUID(),definitions,undefined,{version:2,elements:[ordinary,c,sticker,placement]});
      const id=value(owner,r.sql);
      assert.equal(run(`select count(*) from private.story_interactive_elements where story_id='${id}'`),'1');
      assert.equal(run(`select count(*) from public.story_interactive_revisions where story_id='${id}'`),'1');
      assert.equal(run(`select private.story_author_text_bundle_c1_v1('${id}')`),'Overlay\nSubmitted private question\nCreator answer\n🔥\nChoose\nFirst\nSecond');
      assert.equal(value(owner,r.sql),id);
      const changedDefinitions=[{...definitions[0],prompt:'Changed valid prompt'}];
      fails(as(owner,request(r.media,c,r.client,changedDefinitions,undefined,{version:2,elements:[ordinary,c,sticker,placement]}).sql),/story_idempotency_conflict/);
      fails(as(owner,request(r.media,c,r.client,definitions,undefined,{version:2,elements:[c,ordinary,sticker,placement]}).sql),/story_idempotency_conflict/);
      const failedSource=request();run(`begin; update private.content_safety_scans set status='failed' where target_id='${source}';
        update private.story_safety_state set moderation_status='alerted' where story_id='${source}';
        select set_config('request.jwt.claim.sub','${owner}',true); ${failedSource.sql}; set constraints all immediate; rollback;`);
    });
    await t.test('strict public card text, geometry, private keys and code-point boundaries',()=>{
      for(const bad of [null,1,true,{},[],'',' ',' x','x ','\u00a0x','x\ufeff','<x>','x\n','\tx','x\u0085','😀'.repeat(501)]) {
        for(const field of ['question','answer']) {const c=card();c[field]=bad;fails(`select private.story_validate_composition(${json(composition(c))})`,/invalid_story/);}
      }
      for(const field of ['question','answer']) {const c=card();c[field]='😀'.repeat(500);assert.deepEqual(query(`select private.story_validate_composition(${json(composition(c))})`),composition(c));}
      for(const patch of [{source_story_id:source},{respondent_id:follower},{avatar:'x'},{unknown:true},{x:-0.1},{x:1.1},{y:-0.1},{y:1.1},{scale:0.49},{scale:4.1},{rotation:-181},{rotation:181},{id:'bad'}]) {
        fails(`select private.story_validate_composition(${json(composition({...card(),...patch}))})`,/invalid_story/);
      }
      for(const field of ['question','answer']) {const c=card();delete c[field];fails(`select private.story_validate_composition(${json(composition(c))})`,/invalid_story/);}
      const c=card();fails(`select private.story_validate_composition(${json({version:1,elements:[c]})})`,/invalid_story/);
      fails(`select private.story_validate_composition(${json({version:2,elements:[c,{...c,id:c.id.toUpperCase()}]})})`,/duplicate_story/);
      for(const id of [source,element,follower]) fails(as(owner,request(asset(),{...card(),id}).sql));
      fails(as(owner,request(asset(),{...card(),question:'Sticker prompt is not the submitted question'}).sql));
      const media=asset();
      fails(as(owner,request(media,card(),randomUUID(),[],undefined,{version:2,elements:[]}).sql),/invalid_story_question_answer/);
      fails(as(owner,request(media,c,randomUUID(),[],undefined,{version:2,elements:[c,card()]}).sql),/invalid_story_question_answer/);
      const text=()=>({id:randomUUID(),type:'text',x:0.5,y:0.5,scale:1,rotation:0,text:'Text',color:'#FFFFFF',align:'left',size:'small'});
      const sticker=()=>({id:randomUUID(),type:'sticker',x:0.5,y:0.5,scale:1,rotation:0,value:'🔥'});
      assert.ok(query(`select private.story_validate_composition(${json({version:2,elements:[c,...Array.from({length:10},text)]})})`));
      fails(`select private.story_validate_composition(${json({version:2,elements:[c,...Array.from({length:11},text)]})})`,/story_composition_limit_exceeded/);
      assert.ok(query(`select private.story_validate_composition(${json({version:2,elements:[c,...Array.from({length:24},sticker)]})})`));
      fails(`select private.story_validate_composition(${json({version:2,elements:[c,...Array.from({length:25},sticker)]})})`,/story_composition_limit_exceeded/);
      fails(`select private.story_validate_composition(${json({version:2,elements:Array.from({length:33},sticker)})})`,/invalid_story_composition/);
      assert.ok(query(`select private.story_validate_composition(${json({version:2,elements:[c,...Array.from({length:7},text),...Array.from({length:24},sticker)]})})`));
      fails(`select private.story_validate_composition(${json({version:2,elements:[c],extra:'private'})})`,/invalid_story_composition/);
      for(const bad of [null,{},[],{version:2,elements:null},{version:2,elements:{}},{version:2,elements:[null]}]) fails(`select private.story_validate_composition(${json(bad)})`,/invalid_story/);
      for(const field of ['id','type','x','y','scale','rotation']) {const invalid=card();delete invalid[field];fails(`select private.story_validate_composition(${json(composition(invalid))})`,/invalid_story/);}
      for(const field of ['x','y','scale','rotation']) fails(`select private.story_validate_composition(${json(composition({...c,[field]:'1'}))})`,/invalid_story/);
      assert.ok(query(`select private.story_validate_composition(${json(composition({...c,x:0,y:1,scale:0.5,rotation:-180,answer:'https://example.invalid/answer'}))})`));
      assert.ok(query(`select private.story_validate_composition(${json(composition({...c,x:1,y:0,scale:4,rotation:180,answer:'e\u0301'.repeat(250)}))})`));
      const oversized={version:2,elements:[c,...Array.from({length:31},()=>({id:randomUUID(),type:'interactive',element_id:randomUUID(),x:0.5,y:0.5,scale:1,rotation:0,extra:'x'.repeat(1200)}))]};
      fails(`select private.story_validate_composition(${json(oversized)})`,/invalid_story_composition/);
    });
    await t.test('ordinary API creation and legacy replay cannot bypass private provenance',()=>{
      const media=asset(),c=card(),client=randomUUID(),shared=randomUUID();
      run(`insert into public.videos(id,user_id,video_url,caption) values('${shared}','${owner}','https://fixture.invalid/shared.mp4','Shared')`);
      for(const name of ['create_story_with_media','create_story_from_content']) for(const defs of [false,true]) {
        fails(as(owner,`select public.${name}('${name.includes('media')?media:shared}',${json(composition(c))},'${client}'${defs?",'[]'":''})`),/story_question_answer_requires_authority/);
      }
      const r=request(),id=value(owner,r.sql);
      fails(as(owner,`select public.create_story_with_media('${r.media}',${json(composition(r.c))},'${r.client}','[]')`),/story_question_answer_requires_authority/);
      const before=counts();fails(`begin; select set_config('request.jwt.claim.sub','${owner}',true);
        select private.create_story_with_media_core('${media}',${json(composition(c))},'${client}'); set constraints all immediate; commit;`,/story_question_answer_provenance_required/);
      assert.deepEqual(counts(),before);assert.ok(id);
      const ordinaryAsset=asset(),ordinary=value(owner,`select public.create_story_with_media('${ordinaryAsset}','{"version":1,"elements":[]}','${randomUUID()}','[]')`);
      fails(`begin; update public.stories set story_composition=${json(composition(card()))} where id='${ordinary}';set constraints all immediate;commit;`,/story_question_answer_provenance_required/);
    });
    await t.test('all four replaced ordinary overloads retain non-QA publication and exact replay',()=>{
      const shared=randomUUID();run(`insert into public.videos(id,user_id,video_url,caption) values('${shared}','${owner}','https://fixture.invalid/nonqa.mp4','Non-QA shared')`);
      for(const name of ['create_story_with_media','create_story_from_content']) for(const definitions of [false,true]) {
        const input=name==='create_story_with_media'?asset():shared,client=randomUUID();
        const command=`select public.${name}('${input}','{"version":1,"elements":[]}','${client}'${definitions?",'[]'":''})`;
        const before=rowState();
        const published=query(`begin;select set_config('request.jwt.claim.sub','${owner}',true);${command};${command};set constraints all immediate;
          select jsonb_build_object('stories',(select count(*) from public.stories where client_story_id='${client}'),
            'scans',(select count(*) from private.content_safety_scans where target_id in(select id from public.stories where client_story_id='${client}')),
            'publication',(select publication_status from private.story_safety_state where story_id in(select id from public.stories where client_story_id='${client}')));rollback;`);
        assert.deepEqual(published,{stories:1,scans:1,publication:'published'});assert.deepEqual(rowState(),before);
      }
    });
    await t.test('QA publication retains canonical private media ownership, readiness and signed-video admission',()=>{
      const image=asset(),video=asset(true);
      for(const [media,mutation] of [[image,`update public.media_assets set owner_id='${follower}' where id='${image}'`],
        [image,`update public.media_assets set status='uploading' where id='${image}'`],
        [image,`update public.media_assets set purpose='avatar' where id='${image}'`],
        [video,`update public.video_assets set status='uploading',provider_metadata='{"require_signed_urls":false}' where id='${video}'`]]) {
        const r=request(media),before=rowState();fails(`begin;${mutation};select set_config('request.jwt.claim.sub','${owner}',true);${r.sql};commit;`,/story_asset_not_ready_or_owned/);
        assert.deepEqual(rowState(),before);
      }
      // The existing READY invariant rejects unsigned video before the RPC can
      // receive such a row. Exercise that authority without disabling it.
      const before=rowState();fails(`begin;update public.video_assets set provider_metadata='{"require_signed_urls":false}' where id='${video}';commit;`,/video_assets_ready_invariants_check/);
      assert.deepEqual(rowState(),before);
    });
    await t.test('exact replay is write-free and every changed request conflicts',()=>{
      const r=request(),id=value(owner,r.sql),before=counts();
      const beforeRows=rowState();
      const receipt=run(`select to_jsonb(l) from private.story_question_answer_links l where story_id='${id}'`);
      const safety=run(`select to_jsonb(s) from private.story_safety_state s where story_id='${id}'`);
      assert.equal(value(owner,r.sql),id);assert.deepEqual(counts(),before);
      assert.deepEqual(rowState(),beforeRows);
      assert.equal(run(`select to_jsonb(l) from private.story_question_answer_links l where story_id='${id}'`),receipt);
      assert.equal(run(`select to_jsonb(s) from private.story_safety_state s where story_id='${id}'`),safety);
      for(const changed of [request(r.media,{...r.c,question:'Changed question'},r.client),request(r.media,{...r.c,answer:'Changed'},r.client),request(r.media,{...r.c,x:0.6},r.client),request(asset(),r.c,r.client),request(r.media,r.c,r.client,[{}])]) {
        fails(as(owner,changed.sql),/story_idempotency_conflict/);
      }
      fails(`begin; update public.stories set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${id}';
        select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`);
      value(other,`select public.respond_to_story_element('${source}','${element}','${randomUUID()}','{"text":"Submitted private question"}')`);
      fails(as(owner,request(r.media,r.c,r.client,[],[source,element,other]).sql),/story_idempotency_conflict/);
      const nextElement=randomUUID(),nextAsset=asset();
      const nextSource=value(owner,`select public.create_story_with_media('${nextAsset}',${json({version:2,elements:[{id:randomUUID(),type:'interactive',element_id:nextElement,x:0.5,y:0.5,scale:1,rotation:0}]})},'${randomUUID()}',
        ${json([{version:1,element_id:nextElement,type:'question',prompt:'Second source'}])})`);
      value(follower,`select public.respond_to_story_element('${nextSource}','${nextElement}','${randomUUID()}','{"text":"Submitted private question"}')`);
      fails(as(owner,request(r.media,r.c,r.client,[],[nextSource,nextElement,follower]).sql),/story_idempotency_conflict/);
      fails(as(owner,request(r.media,r.c,randomUUID(),[],[source,nextElement,follower]).sql));
      for(const mutation of [`delete from private.story_question_answer_links where story_id='${id}'`,
        `update private.story_question_answer_links set request_hash=repeat('f',64) where story_id='${id}'`,
        `update public.stories set story_composition=${json(composition({...r.c,answer:'Tampered destination'}))} where id='${id}'`]) {
        fails(`begin; ${mutation}; select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`,/story_idempotency_conflict/);
      }
      const ordinaryMedia=asset(),ordinaryClient=randomUUID();
      value(owner,`select public.create_story_with_media('${ordinaryMedia}','{"version":1,"elements":[]}','${ordinaryClient}','[]')`);
      fails(as(owner,request(ordinaryMedia,card(),ordinaryClient).sql),/story_idempotency_conflict/);
      const invalidations=[
        `update private.story_interactive_responses set moderation_state='hidden' where story_id='${source}'`,
        `update private.story_interactive_responses set moderation_state='blocked' where story_id='${source}'`,
        `update private.story_safety_state set publication_status='restricted' where story_id='${source}'`,
        `update private.story_safety_state set publication_status='removed' where story_id='${source}'`,
        `update public.stories set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${source}'`,
        `delete from public.stories where id='${source}'`,
        `insert into public.blocked_users(blocker_id,blocked_id) values('${owner}','${follower}')`,
        `insert into public.blocked_users(blocker_id,blocked_id) values('${follower}','${owner}')`,
        ...['unpublished','restricted','removed'].map(state=>`update private.story_safety_state set publication_status='${state}' where story_id='${id}'`),
      ];
      for(const mutation of invalidations) {const before=counts();fails(`begin; ${mutation}; select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`);assert.deepEqual(counts(),before);}
      for(const target of [source,id]) {const before=counts();fails(`begin; select set_config('request.jwt.claim.sub','${other}',true);
        select public.admin_moderate_story('${target}','hide','Disposable hidden replay','${randomUUID()}');
        select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`);assert.deepEqual(counts(),before);}
    });
    await t.test('real simultaneous sessions serialize identical and conflicting client identities',async()=>{
      for(const different of [false,true]) {
        const r=request();const second=different?request(r.media,{...r.c,answer:'Racing answer'},r.client):r;
        const before=counts();const firstName=`qa_first_${randomUUID()}`,secondName=`qa_second_${randomUUID()}`;
        const first=concurrent(as(owner,`set local application_name=${quote(firstName)};
          select pg_advisory_xact_lock(hashtextextended('story-create:${owner}:${r.client}',0)); select pg_sleep(3); ${r.sql}`));
        await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(firstName)} and wait_event='PgSleep')`);
        const contender=concurrent(as(owner,`set local application_name=${quote(secondName)}; ${second.sql}`));
        await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(secondName)} and wait_event='advisory')`);
        const results=await Promise.all([first,contender]);
        assert.equal(results.filter(x=>x.status===0).length,different?1:2,JSON.stringify(results));
        if(different) assert.match(results.find(x=>x.status!==0).stderr,/story_idempotency_conflict/);
        assert.equal(run(`select count(*) from public.stories where user_id='${owner}' and client_story_id='${r.client}'`),'1');
        assert.equal(run(`select count(*) from private.content_safety_scans where target_id in(select id from public.stories where client_story_id='${r.client}')`),'1');
        const after=counts();for(const key of ['stories','links','receipts','scans','safety','velocity']) assert.equal(after[key],before[key]+1,key);
        for(const key of ['definitions','revisions','messages','idempotency']) assert.equal(after[key],before[key],key);
        if(!different) assert.equal(results[0].stdout.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g).at(-1),results[1].stdout.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g).at(-1));
      }
    });
    await t.test('ordinary creation shares the QA client lock and cannot win an existing QA identity',async()=>{
      const r=request(),ordinaryAsset=asset(),firstName=`qa_ordinary_first_${randomUUID()}`,secondName=`qa_ordinary_second_${randomUUID()}`;
      const first=concurrent(as(owner,`set local application_name=${quote(firstName)};
        select pg_advisory_xact_lock(hashtextextended('story-create:${owner}:${r.client}',0));select pg_sleep(3);${r.sql}`));
      await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(firstName)} and wait_event='PgSleep')`);
      const second=concurrent(as(owner,`set local application_name=${quote(secondName)};
        select public.create_story_with_media('${ordinaryAsset}','{"version":1,"elements":[]}','${r.client}','[]')`));
      await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(secondName)} and wait_event='advisory')`);
      const results=await Promise.all([first,second]);assert.equal(results[0].status,0,results[0].stderr);
      assert.notEqual(results[1].status,0);assert.match(results[1].stderr,/story_idempotency_conflict/);
      assert.equal(run(`select count(*) from public.media_asset_links where asset_id='${ordinaryAsset}'`),'0');
      assert.equal(run(`select count(*) from private.story_question_answer_links where story_id in(select id from public.stories where client_story_id='${r.client}')`),'1');
    });
    await t.test('publication waits for response moderation and revalidates after its row lock',async()=>{
      const r=request(),firstName=`qa_moderation_${randomUUID()}`,secondName=`qa_moderated_publish_${randomUUID()}`,before=counts();
      try {
        const first=concurrent(as(owner,`set local application_name=${quote(firstName)};
          select public.moderate_story_question('${source}','${element}','${follower}','hide');select pg_sleep(3)`));
        await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(firstName)} and wait_event='PgSleep')`);
        const second=concurrent(as(owner,`set local application_name=${quote(secondName)};${r.sql}`));
        await observe(`select exists(select 1 from pg_stat_activity where application_name=${quote(secondName)} and wait_event_type='Lock')`);
        const results=await Promise.all([first,second]);assert.equal(results[0].status,0,results[0].stderr);
        assert.notEqual(results[1].status,0);assert.match(results[1].stderr,/story_question_answer_denied/);
        const after=counts();for(const key of ['stories','links','receipts','scans','safety','velocity','messages']) assert.equal(after[key],before[key],key);
      } finally {run(`update private.story_interactive_responses set moderation_state='pending' where story_id='${source}' and element_id='${element}' and respondent_id='${follower}'`);}
    });
    await t.test('outer rollback and failures after writes restore all relational state and velocity',()=>{
      const poll=randomUUID(),c=card();const r=request(asset(),c,randomUUID(),[{version:1,element_id:poll,type:'question',prompt:'Rollback definition'}],undefined,
        {version:2,elements:[c,{id:randomUUID(),type:'interactive',element_id:poll,x:0.5,y:0.5,scale:1,rotation:0}]});
      const before=rowState();run(as(owner,`${r.sql};set constraints all immediate`,'rollback'));assert.deepEqual(rowState(),before);
      fails(`begin; create or replace function private.story_enqueue_media_safety_v1(p_story_id uuid) returns uuid
        language sql security definer set search_path='' as 'select null::uuid';
        select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`,/story_safety_publication_fence_failed/);
      assert.deepEqual(rowState(),before);assert.deepEqual(immutableEvidence(),unchanged);
      fails(`begin; create function pg_temp.reject_scan() returns trigger language plpgsql as $$begin raise exception 'qa_disposable_scan_failure';end$$;
        create trigger qa_disposable_scan_failure before insert on private.content_safety_scans for each row execute function pg_temp.reject_scan();
        select set_config('request.jwt.claim.sub','${owner}',true); ${r.sql}; commit;`,/qa_disposable_scan_failure/);
      assert.deepEqual(rowState(),before);assert.equal(run("select count(*) from pg_trigger where tgname='qa_disposable_scan_failure'"),'0');
    });
    await t.test('public safety text is deterministic and stale text or geometry cannot pass C2 fence',()=>{
      const r=request(),id=value(owner,r.sql);
      assert.equal(run(`select private.story_author_text_bundle_c1_v1('${id}')`),'Submitted private question\nCreator answer');
      const snapshot=query(`select private.content_safety_target_snapshot('story','${id}')`);
      assert.equal(snapshot.text,'Submitted private question\nCreator answer');assert.equal(snapshot.text_value,snapshot.text);
      assert.equal(snapshot.summary,snapshot.text);
      for(const privateId of [source,element,follower]) assert.ok(!JSON.stringify(snapshot).includes(privateId));
      assert.doesNotMatch(JSON.stringify(snapshot),/respondent_id|source_story_id|source_element_id|request_hash|stories_b1_viewer/);
      const publicText=run(`select private.story_author_text_bundle_c1_v1('${id}')`);
      assert.equal(run(`begin;update private.story_question_answer_links set request_hash=repeat('f',64) where story_id='${id}';
        select private.story_author_text_bundle_c1_v1('${id}');rollback;`),publicText,'private receipts never become safety text');
      const fingerprint=run(`select private.story_current_fingerprint('${id}')`);
      for(const patch of [{answer:'Changed answer'},{x:0.6},{question:'Changed question'}]) {
        const changed=composition({...r.c,...patch});const result=run(`begin; update public.stories set story_composition=${json(changed)} where id='${id}';
          select private.story_current_fingerprint('${id}'); rollback;`).split('\n').at(-1);
        assert.notEqual(result,fingerprint);
        fails(`begin; update public.stories set story_composition=${json(changed)} where id='${id}'; select set_config('request.jwt.claim.sub','${owner}',true);
          select private.story_publish_c2_v1('${id}',(select scan_id from private.story_safety_state where story_id='${id}')); commit;`,/story_safety_publication_fence_failed/);
      }
      const longCard={...card(),answer:'a'.repeat(500)};const long=request(asset(),longCard);
      const longSnapshot=query(`begin;select set_config('request.jwt.claim.sub','${owner}',true);${long.sql};
        select private.content_safety_target_snapshot('story',(select id from public.stories where client_story_id='${long.client}'));rollback;`);
      assert.equal(longSnapshot.text,'Submitted private question\n'+'a'.repeat(500));
      assert.equal(longSnapshot.summary,'Submitted private question\n'+'a'.repeat(273));
    });
    await t.test('private relation and functions have effective ACL, RLS, ownership and catalog contracts',()=>{
      assert.deepEqual(query(`select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity,
        'policies',(select count(*) from pg_policy where polrelid=c.oid),'realtime',(select count(*) from pg_publication_tables where schemaname='private' and tablename=c.relname))
        from pg_class c where oid='private.story_question_answer_links'::regclass`),{owner:'postgres',rls:true,force:true,policies:0,realtime:0});
      for(const role of ['anon','authenticated','service_role']) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal(run(`select has_table_privilege('${role}','private.story_question_answer_links','${privilege}')`),'f');
        fails(`set role ${role}; select * from private.story_question_answer_links`,/permission denied/);
        for(const command of ['insert into private.story_question_answer_links default values',
          "update private.story_question_answer_links set request_hash=repeat('f',64)",'delete from private.story_question_answer_links']) {
          fails(`set role ${role};${command}`,/permission denied/);
        }
      }
      assert.equal(run(`select count(*) from aclexplode((select relacl from pg_class where oid='private.story_question_answer_links'::regclass)) a
        where grantee<>(select oid from pg_roles where rolname='postgres')`),'0','no inherited PUBLIC/client/service relation ACL');
      assert.deepEqual(query(`select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum)
        from pg_attribute where attrelid='private.story_question_answer_links'::regclass and attnum>0 and not attisdropped`),
        [['story_id','uuid',true],['source_story_id','uuid',true],['source_element_id','uuid',true],['respondent_id','uuid',true],['request_hash','text',true],['created_at','timestamp with time zone',true]]);
      assert.deepEqual(query(`select jsonb_agg(jsonb_build_array(a.attname,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='private.story_question_answer_links'::regclass`),
        [['created_at','clock_timestamp()']]);
      const constraints=query(`select jsonb_agg(jsonb_build_object('type',contype,'definition',pg_get_constraintdef(oid)) order by contype,conname)
        from pg_constraint where conrelid='private.story_question_answer_links'::regclass`);
      assert.deepEqual(constraints.map(x=>x.type),['c','f','f','p']);
      assert.ok(constraints.some(x=>x.definition==='FOREIGN KEY (source_story_id, source_element_id, respondent_id) REFERENCES private.story_interactive_responses(story_id, element_id, respondent_id) ON DELETE CASCADE'));
      assert.ok(constraints.some(x=>x.definition==='FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE'));
      assert.match(constraints.find(x=>x.type==='c').definition,/request_hash.*\^\[a-f0-9\]\{64\}\$/);
      assert.deepEqual(query(`select jsonb_agg(jsonb_build_object('unique',i.indisunique,'keys',(select jsonb_agg(a.attname order by k.n)
        from unnest(i.indkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)) order by i.indisunique)
        from pg_index i where indrelid='private.story_question_answer_links'::regclass`),
        [{unique:false,keys:['source_story_id','source_element_id','respondent_id']},{unique:true,keys:['story_id']}]);
      const functions=[
        ['private.story_validate_composition(jsonb)','i',false,false],['private.story_author_text_bundle_c1_v1(uuid)','s',true,false],
        ['private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)','s',true,false],['public.prepare_story_question_answer(uuid,uuid,uuid)','s',true,true],
        ['public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)','v',true,true],
        ['private.story_check_question_answer_link_qa_c1_v1()','v',true,false],
        ['public.create_story_with_media(uuid,jsonb,uuid)','v',true,true],['public.create_story_with_media(uuid,jsonb,uuid,jsonb)','v',true,true],
        ['public.create_story_from_content(uuid,jsonb,uuid)','v',true,true],['public.create_story_from_content(uuid,jsonb,uuid,jsonb)','v',true,true],
      ];
      for(const [signature,volatility,definer,client] of functions) {
        assert.deepEqual(query(`select jsonb_build_object('owner',pg_get_userbyid(proowner),'volatility',provolatile,'definer',prosecdef,'config',proconfig,
          'public',(select count(*) from aclexplode(coalesce(proacl,acldefault('f',proowner))) where grantee=0 and privilege_type='EXECUTE')) from pg_proc where oid='${signature}'::regprocedure`),
          {owner:'postgres',volatility,definer,config:['search_path=""'],public:0});
        for(const role of ['anon','authenticated','service_role']) assert.equal(run(`select has_function_privilege('${role}','${signature}','EXECUTE')`),role==='authenticated'&&client?'t':'f');
      }
      assert.deepEqual(query(`select jsonb_build_object('deferrable',tgdeferrable,'deferred',tginitdeferred,'enabled',tgenabled) from pg_trigger where tgname='story_question_answer_link_required'`),{deferrable:true,deferred:true,enabled:'O'});
      assert.deepEqual(query(`select jsonb_build_object('table',tgrelid::regclass::text,'function',tgfoid::regprocedure::text,'events',tgtype)
        from pg_trigger where tgname='story_question_answer_link_required'`),
        {table:'stories',function:'private.story_check_question_answer_link_qa_c1_v1()',events:21});
    });
    await t.test('canonical source deletion cascades provenance while preserving independent public answer',()=>{
      const r=request(),id=value(owner,r.sql);value(owner,`select deleted_story_id from public.delete_story('${source}')`);
      assert.equal(run(`select count(*) from private.story_question_answer_links where story_id='${id}'`),'0');
      assert.equal(value(follower,`select count(*) from public.stories where id='${id}'`),'1');
      fails(as(owner,r.sql));
      value(owner,`select deleted_story_id from public.delete_story('${id}')`);
      assert.equal(run(`select count(*) from public.stories where id='${id}'`),'0');
    });
  } catch(error) {primaryFailure=error;throw error;
  } finally {
    try {
      if(created) run(`drop database ${db} with(force)`,'postgres');
      assert.equal(run(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0');
    } catch(cleanupError) {
      if(primaryFailure) throw new AggregateError([primaryFailure,cleanupError],'QA proof and disposable cleanup both failed');
      throw cleanupError;
    }
  }
});

function queryServer() {return JSON.parse(run('select jsonb_build_array(host(inet_server_addr()),inet_server_port())','postgres'));}
