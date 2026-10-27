// SQL-real, reduced-schema proof only; never accepts a remote URL.
// RUN_STORIES_B1_LOCAL=1; STORIES_B1_PG_BIN=<bin>; STORIES_B1_PG_PORT=<local port>.
// Builds and drops its checked-in baseline unless STORIES_B1_PG_TEMPLATE is supplied.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const enabled = process.env.RUN_STORIES_B1_LOCAL === '1';
const owner = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const story = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const element = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const db = `stories_b1_${randomUUID().replaceAll('-','')}`;
const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter(n => n.endsWith('_stories_v2_interactive_b1.sql'));
const bin = process.env.STORIES_B1_PG_BIN;
const psql = bin ? join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';
const args = database => ['-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',process.env.STORIES_B1_PG_PORT || '55432','-U',process.env.STORIES_B1_PG_USER || 'postgres','-d',database,'-At'];
function run(sql, database=db, failure=false) {
  const r=spawnSync(psql,args(database),{input:sql,encoding:'utf8',maxBuffer:16*1024*1024});
  if (!failure) assert.equal(r.status,0,`${r.error || ''}\n${r.stderr}`);
  return failure ? r : r.stdout.trim();
}
const as = (actor,sql) => `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true); ${sql}; commit;`;
const json = (actor,sql) => JSON.parse(run(as(actor,sql)).split('\n').at(-1));
const respond = (actor,n,payload,key=randomUUID()) => json(actor,`select public.respond_to_story_element('${story}','${element(n)}','${key}',${literal(JSON.stringify(payload))}::jsonb)`);
const state = actor => json(actor,`select public.get_story_interactive_state('${story}')`);
const item = (actor,n) => state(actor).elements.find(e=>e.element_id===element(n));
const fail = (actor,sql,pattern) => { const r=run(as(actor,sql),db,true); assert.notEqual(r.status,0); assert.match(r.stderr,pattern); };
const parallel = sql => new Promise((resolve,reject)=>{
  const child=spawn(psql,args(db),{stdio:['pipe','pipe','pipe']}); let out='',err='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
  child.on('close',code=>code===0?resolve(out):reject(new Error(err)));child.stdin.end(sql);
});

test('B1 disposable PostgreSQL behavior and isolation', {skip:!enabled}, async t=>{
  const ownTemplate=!process.env.STORIES_B1_PG_TEMPLATE;
  const template=process.env.STORIES_B1_PG_TEMPLATE || `${db}_baseline`;
  assert.match(template || '',/^[a-z][a-z0-9_]+$/,'explicit local baseline template required');
  assert.equal(migrations.length,1,'exactly one B1 migration required');
  let created=false;
  if(ownTemplate) run(`create database ${template};`,'postgres');
  try {
    if(ownTemplate) run(readFileSync(new URL('./fixtures/stories_v2_interactive_b1_baseline.sql',import.meta.url),'utf8'),template);
    run(`create database ${db} template ${template};`,'postgres');
    created=true;
    run(readFileSync(new URL(migrations[0],dir),'utf8'));
    run(`begin; ${readFileSync(new URL('./fixtures/stories_v2_interactive_b1_fixture.sql',import.meta.url),'utf8')} commit;`);
    await t.test('quiz answer and aggregates are secret before response',()=>{
      assert.equal(item(viewer,4).correct_option_id,undefined);
      assert.equal(item(viewer,1).aggregate,undefined);
      assert.equal(item(owner,1).aggregate.total,0);
    });
    await t.test('A/B, multi-poll, immutable choice and idempotent replay/conflict',()=>{
      const key=randomUUID(), first=respond(viewer,1,{option_id:'a'},key);
      assert.deepEqual(respond(viewer,1,{option_id:'a'},key),first);
      assert.equal(item(viewer,1).aggregate.total,1);
      fail(viewer,`select public.respond_to_story_element('${story}','${element(1)}','${key}','{"option_id":"b"}')`,/idempotency_conflict/);
      fail(viewer,`select public.respond_to_story_element('${story}','${element(1)}','${randomUUID()}','{"option_id":"b"}')`,/response_immutable/);
      respond(viewer,2,{option_id:'c'});
      assert.equal(item(viewer,2).aggregate.options.c,1);
    });
    await t.test('slider bounds and update preserve one participation',()=>{
      for(const value of [-0.01,1.01]) fail(viewer,`select public.respond_to_story_element('${story}','${element(3)}','${randomUUID()}','{"value":${value}}')`,/invalid_story_response/);
      respond(viewer,3,{value:0}); respond(viewer,3,{value:1});
      assert.deepEqual(item(viewer,3).aggregate,{total:1,average:1});
    });
    await t.test('quiz reveals correct answer only to respondent',()=>{
      respond(viewer,4,{option_id:'a'});
      assert.equal(item(viewer,4).correct_option_id,'b');
      assert.equal(item(other,4).correct_option_id,undefined);
    });
    await t.test('quiz may omit the correct answer without publishing a null pseudo-answer',()=>{
      const config={version:1,element_id:element(7),type:'quiz',prompt:'Open quiz',options:[{id:'a',label:'A'},{id:'b',label:'B'}]};
      assert.equal(run(`select private.story_valid_definition(${literal(JSON.stringify(config))}::jsonb,null)`),'t');
      run(`begin; insert into private.story_interactive_elements(story_id,element_id,kind,public_config) values('${story}','${element(7)}','quiz',${literal(JSON.stringify(config))});
        update public.stories set story_composition=jsonb_set(story_composition,'{elements}',(story_composition->'elements')||'{"id":"${element(7)}","type":"interactive","element_id":"${element(7)}","x":0.5,"y":0.5,"scale":1,"rotation":0}') where id='${story}';
        update private.story_safety_state set evidence_fingerprint=private.story_current_fingerprint(story_id) where story_id='${story}'; commit;`);
      respond(viewer,7,{option_id:'a'});
      assert.equal(Object.hasOwn(item(viewer,7),'correct_option_id'),false);
      assert.equal(Object.hasOwn(item(owner,7),'correct_option_id'),false);
    });
    await t.test('question is private and pending; creator may hide but cannot approve text policy',()=>{
      respond(viewer,5,{text:'Private fixture question'});
      assert.equal(item(viewer,5).response.moderation_state,'pending');
      assert.doesNotMatch(JSON.stringify(state(other)),/Private fixture question/);
      const results=json(owner,`select public.get_story_interactive_results('${story}','${element(5)}',20,null,null)`);
      assert.equal(results.responses[0].payload.text,'Private fixture question');
      assert.equal(results.has_more,false);
      assert.equal(results.next_cursor,null);
      fail(other,`select public.get_story_interactive_results('${story}','${element(5)}',20,null,null)`,/owner_only/);
      fail(owner,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','passed')`,/invalid_question_action/);
      json(owner,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','hide')`);
      assert.equal(item(viewer,5).response.moderation_state,'hidden');
    });
    await t.test('positioned reaction never writes legacy reaction rail',()=>{
      respond(viewer,6,{emoji:'❤️'});
      assert.equal(run(`select count(*) from public.story_reactions where story_id='${story}'`),'0');
      assert.equal(item(viewer,6).response.payload.emoji,'❤️');
    });
    await t.test('strict definition and composition constraints reject extra/private keys and dangling references',()=>{
      assert.equal(run(`select private.story_definition_digest('{"a":1,"b":2}',null)=private.story_definition_digest('{"b":2,"a":1}',null)`),'t');
      assert.equal(run(`select private.story_definition_digest('{"a":1}',null)<>private.story_definition_digest('{"a":1}','')`),'t');
      for(const bad of [
        {id:element(1),type:null,x:0.5,y:0.5,scale:1,rotation:0,value:'🔥'},
        {id:element(1),type:'text',x:0.5,y:0.5,scale:1,rotation:0,text:'plain',color:null,align:'left',size:'small'},
      ]) assert.notEqual(run(`select private.story_validate_composition(${literal(JSON.stringify({version:1,elements:[bad]}))})`,db,true).status,0);
      const invalid=run(`update private.story_interactive_elements set public_config=public_config||'{"correct_option_id":"a"}' where story_id='${story}' and element_id='${element(1)}'`,db,true);
      assert.notEqual(invalid.status,0);
      const dangling=run(`update public.stories set story_composition='{"version":2,"elements":[]}' where id='${story}'`,db,true);
      assert.notEqual(dangling.status,0);
      assert.match(dangling.stderr,/story_definition_reference_mismatch/);
      fail(viewer,`select public.respond_to_story_element('${story}','${element(3)}','${randomUUID()}','{"value":0.5,"url":"https://invalid.test"}')`,/invalid_story_response/);
      const before=run(`select count(*) from private.story_interactive_responses where story_id='${story}'`);
      const rollback=run(as(other,`select public.respond_to_story_element('${story}','${element(6)}','${randomUUID()}','{"emoji":"❤️"}'); select 1/0`),db,true);
      assert.notEqual(rollback.status,0);
      assert.equal(run(`select count(*) from private.story_interactive_responses where story_id='${story}'`),before);
    });
    await t.test('analytics is idempotent and impression uses canonical views',()=>{
      const key=randomUUID(), sql=`select public.record_story_event('${story}','impression','${key}')`;
      assert.deepEqual(json(viewer,sql),json(viewer,sql));
      assert.equal(run(`select count(*) from private.story_analytics_events where story_id='${story}'`),'1');
      assert.equal(run(`select count(*) from public.story_views where story_id='${story}'`),'1');
    });
    await t.test('report retry reuses its canonical identity and consumes one velocity unit',()=>{
      const first=run(as(viewer,`select public.report_story('${story}','fixture reason','fixture details')`));
      const again=run(as(viewer,`select public.report_story('${story}','fixture reason','fixture details')`));
      assert.equal(first,again);
      assert.equal(run(`select count(*) from public.reports where reporter_user_id='${viewer}' and reported_content_id='${story}'`),'1');
      assert.equal(run(`select sum(count) from public.velocity_counters where user_id='${viewer}' and operation_type='story_report'`),'1');
    });
    await t.test('Chat-backed reply retry preserves one message and one rate unit',()=>{
      const key=randomUUID(), sql=`select row_to_json(m) from public.reply_to_story('${story}','${key}','Private reply') m`;
      const first=json(viewer,sql); assert.deepEqual(json(viewer,sql),first);
      assert.equal(run(`select count(*) from public.messages where sender_id='${viewer}' and client_message_id='${key}'`),'1');
      assert.equal(run(`select sum(count) from public.velocity_counters where user_id='${viewer}' and operation_type='story_reply'`),'1');
    });
    await t.test('response table constraints reject invalid payloads even through privileged SQL',()=>{
      const invalid=run(`begin; insert into private.story_interactive_responses(story_id,element_id,respondent_id,payload) values('${story}','${element(3)}','${other}','{"value":2}'); rollback;`,db,true);
      assert.notEqual(invalid.status,0);
      assert.match(invalid.stderr,/check constraint/);
    });
    await t.test('replay resolves before velocity; rollback leaves no writes',()=>{
      const key=randomUUID(); respond(viewer,3,{value:0.5},key);
      run(`update private.story_operation_policy set max_operations=1 where operation='interaction'`);
      respond(viewer,3,{value:0.5},key);
      const before=run(`select revision from public.story_interactive_revisions where story_id='${story}' and element_id='${element(3)}'`);
      fail(viewer,`select public.respond_to_story_element('${story}','${element(3)}','${randomUUID()}','{"value":0.4}')`,/story_rate_limited/);
      assert.equal(run(`select revision from public.story_interactive_revisions where story_id='${story}' and element_id='${element(3)}'`),before);
      run(`update private.story_operation_policy set max_operations=120 where operation='interaction'`);
    });
    await t.test('concurrent replay makes one response and one velocity unit',async()=>{
      const key=randomUUID(), sql=as(other,`select public.respond_to_story_element('${story}','${element(1)}','${key}','{"option_id":"b"}')`);
      const replies=await Promise.all([parallel(sql),parallel(sql)]);
      assert.equal(replies[0],replies[1]);
      assert.equal(run(`select count(*) from private.story_interactive_responses where respondent_id='${other}'`),'1');
      assert.equal(run(`select sum(count) from public.velocity_counters where user_id='${other}' and operation_type='story_interaction'`),'1');
    });
    await t.test('creator question pagination returns a complete keyset without duplicates',()=>{
      respond(other,5,{text:'Second private question'});
      const first=json(owner,`select public.get_story_interactive_results('${story}','${element(5)}',1,null,null)`);
      assert.equal(first.has_more,true);
      assert.equal(first.responses.length,1);
      assert.ok(first.next_cursor.created_at);
      const second=json(owner,`select public.get_story_interactive_results('${story}','${element(5)}',1,${literal(first.next_cursor.created_at)},'${first.next_cursor.respondent_id}')`);
      assert.equal(second.has_more,false);
      assert.equal(second.next_cursor,null);
      assert.equal(second.responses.length,1);
      assert.notEqual(first.responses[0].respondent_id,second.responses[0].respondent_id);
    });
    await t.test('canonical moderator can inspect and block; creator cannot undo a block',()=>{
      fail(other,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','hide')`,/admin_.*(?:capability|forbidden|denied|required)/);
      run(`insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason) values('${other}','MODERATOR','trusted_operator','local:story-b1','Disposable canonical moderation proof')`);
      const inspection=json(other,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','inspect')`);
      assert.equal(inspection.payload.text,'Private fixture question');
      json(other,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','block')`);
      json(owner,`select public.moderate_story_question('${story}','${element(5)}','${viewer}','hide')`);
      assert.equal(item(viewer,5).response.moderation_state,'blocked');
    });
    await t.test('creation installs definitions and pending safety atomically with replay and rollback',()=>{
      const asset=randomUUID(), client=randomUUID(), eid=randomUUID();
      const composition={version:2,elements:[{id:eid,type:'interactive',element_id:eid,x:0.5,y:0.5,scale:1,rotation:0}]};
      const definitions=[{version:1,element_id:eid,type:'poll',prompt:'New poll',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}];
      run(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,status) values('${asset}','${owner}','r2','image','story_image','private','local-test','stories/${asset}.jpg','image/jpeg',10,'ready')`);
      const sql=`select public.create_story_with_media('${asset}',${literal(JSON.stringify(composition))},'${client}',${literal(JSON.stringify(definitions))})`;
      const first=run(as(owner,sql)); assert.equal(run(as(owner,sql)),first);
      const sid=first.split('\n').at(-1).trim();
      assert.equal(run(`select state from private.story_safety_state where story_id='${sid}'`),'pending');
      fail(viewer,`select public.get_story_interactive_state('${sid}')`,/story_not_visible/);
      const before=run('select count(*) from public.stories');
      fail(owner,`select public.create_story_with_media('${asset}',${literal(JSON.stringify(composition))},'${client}','[]')`,/idempotency_conflict/);
      assert.equal(run('select count(*) from public.stories'),before);
    });
    await t.test('RLS, ACL, fixed paths and sanitized revisions',()=>{
      fail(viewer,'select * from private.story_interactive_responses',/permission denied/);
      assert.equal(run(`select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('story_interactive_elements','story_interactive_responses','story_safety_state','story_analytics_events','story_operation_policy') and c.relrowsecurity and c.relforcerowsecurity`),'5');
      assert.equal(run(`select has_function_privilege('anon','public.respond_to_story_element(uuid,uuid,uuid,jsonb)','execute')`),'f');
      for(const signature of ['story_mark_viewed_core(uuid)','story_shared_content_core(uuid)','story_set_reaction_core(uuid,text)','story_reply_core(uuid,uuid,text)','story_report_core(uuid,text,text)']) {
        assert.equal(run(`select has_function_privilege('authenticated','private.${signature}','execute')`),'f');
        assert.equal(run(`select has_function_privilege('anon','private.${signature}','execute')`),'f');
        assert.equal(run(`select has_function_privilege('service_role','private.${signature}','execute')`),'f');
        assert.equal(run(`select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid='private.${signature}'::regprocedure`),'t');
      }
      assert.equal(run(`select proconfig::text from pg_catalog.pg_proc where oid='public.respond_to_story_element(uuid,uuid,uuid,jsonb)'::regprocedure`),'{"search_path=\\"\\""}');
      const revisions=run(as(viewer,`select row_to_json(r) from public.story_interactive_revisions r limit 1`));
      assert.doesNotMatch(revisions,/respondent|payload|answer|total/);
    });
    await t.test('blocks, safety, moderation, expiry and deletion fail closed',()=>{
      run(`insert into public.blocked_users(blocker_id,blocked_id) values('${owner}','${viewer}')`);
      fail(viewer,`select public.get_story_interactive_state('${story}')`,/story_not_visible/);
      run(`delete from public.blocked_users where blocker_id='${owner}' and blocked_id='${viewer}'; update private.story_safety_state set state='pending' where story_id='${story}'`);
      fail(viewer,`select public.get_story_interactive_state('${story}')`,/story_not_visible/);
      assert.equal(state(owner).elements.length,7);
      run(`update private.story_safety_state set state='passed' where story_id='${story}'; update public.stories set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${story}'`);
      fail(viewer,`select public.respond_to_story_element('${story}','${element(3)}','${randomUUID()}','{"value":0.4}')`,/story_not_visible/);
      fail(other,`select public.get_story_interactive_state('${story}')`,/story_not_visible/);
      assert.equal(item(owner,3).aggregate.total,1);
      run(as(owner,`select public.delete_story('${story}')`));
      for(const table of ['story_interactive_elements','story_interactive_responses','story_safety_state','story_analytics_events']) assert.equal(run(`select count(*) from private.${table} where story_id='${story}'`),'0');
      fail(viewer,`select public.get_story_interactive_state('${story}')`,/story_not_visible/);
    });
  } finally {
    if(created) run(`drop database ${db} with (force);`,'postgres');
    if(ownTemplate) run(`drop database ${template} with (force);`,'postgres');
  }
});
