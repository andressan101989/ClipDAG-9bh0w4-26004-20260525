import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260914171809_admin_content_safety_preview_rescan_corrective_v1.sql"),"utf8");
const page=readFileSync(join(root,"apps","admin-web","src","pages","AdminContentSafetyPages.tsx"),"utf8");
const api=readFileSync(join(root,"apps","admin-web","src","lib","adminSafetyApi.ts"),"utf8");

const target=(index,type="video")=>({target_type:type,target_id:index.toString(16).padStart(32,"0").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5")});
const key=({target_type,target_id})=>`${target_type}|${target_id}`;

function runCursorHarness(targets,{batchSize=500,stopAfter=Infinity}={}){
  const ordered=[...targets].sort((a,b)=>key(a).localeCompare(key(b)));
  let cursor=null,state="pending",queued=[],batches=[];
  while(state!=="complete"&&batches.length<stopAfter){
    const remaining=ordered.filter(item=>cursor===null||key(item)>cursor);
    const batch=remaining.slice(0,batchSize);
    queued.push(...batch);
    if(batch.length) cursor=key(batch.at(-1));
    state=remaining.length>batch.length?"running":"complete";
    batches.push(batch.length);
  }
  return {state,cursor,queued,batches};
}

test("canonical preview is server-bound to rule id, version, normalized definition and audit receipt",()=>{
  assert.match(migration,/content_safety_rule_definition_fingerprint/);
  for(const field of ["p_rule_id","p_rule_version","p_detector_type","p_pattern","p_scopes","p_locale"]){assert.match(migration,new RegExp(field),field)}
  assert.match(migration,/'normalized_pattern',private\.normalize_content_safety_text\(p_pattern\)/);
  assert.match(migration,/create function public\.preview_admin_content_safety_rule\(p_rule_id uuid,p_limit integer default 20\)/);
  assert.match(migration,/from private\.content_safety_rules where id=p_rule_id/);
  assert.match(migration,/'rule_id',p_rule_id,'rule_version',p_rule_version,'definition_fingerprint'/);
  assert.match(migration,/'content_safety\.rule\.preview'/);
  assert.match(migration,/require_content_safety_rule_preview/);
  assert.match(migration,/a\.metadata->>'rule_version'=p_rule\.version::text/);
  assert.match(migration,/a\.metadata->>'definition_fingerprint'=v_expected/);
  assert.match(api,/preview_admin_content_safety_rule/);
  assert.match(api,/p_rule_id:input\.id/);
});

test("preview remains bounded and uses the one F4 text matching authority",()=>{
  assert.match(migration,/private\.normalize_content_safety_text/);
  assert.match(migration,/private\.content_safety_text_matches/);
  assert.match(migration,/p_limit<1 or p_limit>20/);
  assert.match(migration,/left\(private\.normalize_content_safety_text\(text_value\),240\)/);
  assert.match(migration,/'ordinary_private_messages_included',false/);
  assert.doesNotMatch(migration,/create table .*preview/i);
});

test("React invalidates preview for dirty edits and canonical version changes",()=>{
  assert.match(page,/useEffect\(\(\)=>\{/);
  assert.match(page,/setPreview\(null\)/);
  assert.match(page,/\[rule\.id,rule\.version,rule\.updated_at,/);
  assert.match(page,/String\(preview\.rule_id\)===String\(rule\.id\)/);
  assert.match(page,/Number\(preview\.rule_version\)===Number\(rule\.version\)/);
  assert.match(page,/String\(preview\.definition_fingerprint\)===String\(rule\.definition_fingerprint\)/);
  assert.match(page,/!dirty/);
});

test("cursor harness completes a small rescan in one bounded batch",()=>{
  const result=runCursorHarness(Array.from({length:437},(_,index)=>target(index+1)));
  assert.deepEqual(result.batches,[437]);
  assert.equal(result.state,"complete");
  assert.equal(new Set(result.queued.map(key)).size,437);
});

test("cursor harness progresses 1201 targets as 500, 500, 201 without duplicates or omissions",()=>{
  const candidates=Array.from({length:1201},(_,index)=>target(index+1,index<601?"comment":"video"));
  const result=runCursorHarness(candidates);
  assert.deepEqual(result.batches,[500,500,201]);
  assert.equal(result.state,"complete");
  assert.equal(result.queued.length,1201);
  assert.equal(new Set(result.queued.map(key)).size,1201);
  assert.deepEqual(new Set(result.queued.map(key)),new Set(candidates.map(key)));
});

test("a stopped rescan resumes strictly after its composite cursor",()=>{
  const candidates=Array.from({length:1201},(_,index)=>target(index+1));
  const first=runCursorHarness(candidates,{stopAfter:1});
  assert.deepEqual(first.batches,[500]);
  const tail=candidates.filter(item=>key(item)>first.cursor);
  const rest=runCursorHarness(tail);
  assert.deepEqual(rest.batches,[500,201]);
  const all=[...first.queued,...rest.queued];
  assert.equal(all.length,1201);
  assert.equal(new Set(all.map(key)).size,1201);
});

test("migration binds progress to rule version and cancels disable, retire or stale continuation",()=>{
  for(const field of ["rescan_state","rescan_rule_version","rescan_cursor_target_type","rescan_cursor_target_id","rescan_eligible_count","rescan_queued_count","rescan_started_at","rescan_completed_at"]){assert.match(migration,new RegExp(field),field)}
  assert.match(migration,/v_rule\.version<>p_rule_version or v_rule\.rescan_rule_version<>p_rule_version/);
  assert.match(migration,/rescan_state='cancelled'/);
  assert.match(migration,/rescan_cursor_target_type=null,rescan_cursor_target_id=null/);
  assert.match(migration,/rescan_state=case when v_has_more then 'running' else 'complete' end/);
});

test("rescan reuses the existing queue, scanner wake and single cron authority",()=>{
  assert.match(migration,/private\.enqueue_content_safety_scan\(v_target\.target_type,v_target\.target_id,'backfill'\)/);
  assert.match(migration,/private\.continue_content_safety_rule_rescans\(1,500\)/);
  assert.match(migration,/net\.http_post/);
  assert.doesNotMatch(migration,/create table .*content_safety/i);
  assert.doesNotMatch(migration,/cron\.schedule|create extension/i);
  assert.doesNotMatch(migration,/create function public\.(?:admin_issue_user_warning|admin_prepare_user_moderation_action|admin_moderate_content)/i);
});

test("rescan privacy authority includes only valid reported messages, never ordinary private DMs",()=>{
  const targetSql=migration.slice(migration.indexOf("create function private.content_safety_rule_targets"),migration.indexOf("drop function private.content_safety_rule_rescan"));
  assert.match(targetSql,/'reported_message'=any\(p_scopes\)/);
  assert.match(targetSql,/exists\([\s\S]*public\.reports[\s\S]*reported_content_type='message'/);
  assert.equal((targetSql.match(/public\.messages/g)||[]).length,1);
});

test("corrective contains no automatic enforcement or financial mutation",()=>{
  for(const forbidden of ["admin_issue_user_warning","admin_prepare_user_moderation_action","admin_finalize_user_moderation_action","admin_moderate_content","admin_moderate_story","financial_transactions","ledger_accounts","ledger_entries","wallet","escrow"]){assert.doesNotMatch(migration,new RegExp(forbidden,"i"),forbidden)}
});
