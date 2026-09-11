import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20260911200240_superuser_a5_content_stories_chat_moderation.sql",import.meta.url),"utf8");
const app=readFileSync(new URL("../apps/admin-web/src/App.tsx",import.meta.url),"utf8");
const shell=readFileSync(new URL("../apps/admin-web/src/layout/AdminShell.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../apps/admin-web/src/lib/adminApi.ts",import.meta.url),"utf8");
const reportService=readFileSync(new URL("../services/reportService.ts",import.meta.url),"utf8");

const body=(name)=>{const start=migration.search(new RegExp(`create(?: or replace)? function ${name.replaceAll(".","\\.")}\\b`,"i"));assert.notEqual(start,-1,`missing ${name}`);const end=migration.indexOf("$$;",start);assert.notEqual(end,-1,`unterminated ${name}`);return migration.slice(start,end+3)};

test("A5 preserves canonical catalogs and creates no root or financial authority",()=>{
  for(const [object,count] of [["admin_roles",6],["admin_capabilities",47],["admin_role_capabilities",142],["admin_role_grant_rules",7]])assert.match(migration,new RegExp(`${object}\\)<>${count}`));
  assert.match(migration,/role_code='SUPER_ADMIN' and revoked_at is null/);
  assert.doesNotMatch(migration,/insert into private\.admin_(?:roles|capabilities|role_capabilities|role_grant_rules|user_roles)/i);
  assert.doesNotMatch(migration,/admin_trusted_(?:provision|revoke)_super_admin\s*\(/i);
  for(const target of ["ledger_entries","financial_transactions","ledger_accounts","wallet","escrow"])assert.doesNotMatch(migration,new RegExp(`(?:insert into|update|delete from|create table)[^;]*\\b${target}\\b`,"i"));
});

test("moderation state and command history are private, RLS-protected, and non-client-writable",()=>{
  assert.match(migration,/create table private\.admin_content_moderation_actions/);
  assert.match(migration,/create table private\.admin_content_moderation_state/);
  assert.match(migration,/target_type in\('video','comment','story','chat_message'\)/);
  assert.match(migration,/unique\(idempotency_scope,idempotency_key\)/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all privileges on table private\.admin_content_moderation_actions[\s\S]*?public,anon,authenticated,service_role/);
  assert.match(migration,/admin_content_moderation_action_immutable/);
});

test("normal reads use one visibility overlay and lifecycle deletes clean state only",()=>{
  for(const target of ["video","comment","story"])assert.match(migration,new RegExp(`admin_content_is_visible\\('${target}',`));
  for(const trigger of ["videos_cleanup_admin_moderation_state","comments_cleanup_admin_moderation_state","stories_cleanup_admin_moderation_state"])assert.match(migration,new RegExp(trigger));
  const cleanup=body("private.admin_cleanup_content_moderation_state");
  assert.match(cleanup,/delete from private\.admin_content_moderation_state/);
  assert.doesNotMatch(cleanup,/admin_content_moderation_actions|admin_action_audit|media_assets|media_asset_links/);
});

test("content and Story mutations are reversible, exact-capability, atomic, and audited",()=>{
  const content=body("public.admin_moderate_content"),story=body("public.admin_moderate_story"),core=body("private.admin_execute_content_moderation");
  assert.match(content,/content\.items\.hide/);assert.match(content,/content\.items\.restore/);
  assert.match(story,/stories\.items\.moderate/);
  assert.match(core,/admin_request_fingerprint/);assert.match(core,/admin_idempotency_conflict/);
  assert.match(core,/insert into private\.admin_content_moderation_actions/);
  assert.match(core,/insert into private\.admin_content_moderation_state/);
  assert.match(core,/insert into private\.admin_action_audit/);
  assert.doesNotMatch(core,/delete from public\.(?:videos|comments|stories)|delete_story\s*\(/i);
});

test("hidden Stories cannot be viewed, reacted to, replied to, or expose shared hidden video",()=>{
  for(const name of ["public.mark_story_viewed","public.set_story_reaction","public.reply_to_story","public.get_story_reactions","public.get_story_viewers","public.get_story_shared_content"])assert.match(body(name),/admin_content_is_visible\('story'/);
  assert.match(body("public.get_story_shared_content"),/admin_content_is_visible\('video'/);
  assert.match(body("public.marketplace_creator_content_visible"),/admin_content_is_visible\('video'/);
  assert.doesNotMatch(migration,/create or replace function public\.delete_story/i);
  assert.doesNotMatch(migration,/delete from public\.media_assets|delete from public\.media_asset_links/i);
});

test("reports remain canonical and Story/Chat direct insertion is denied",()=>{
  assert.match(migration,/reported_content_type in\('video','comment','user','story','message'\)/);
  assert.match(migration,/reported_content_type in\('video','comment','user'\)/);
  assert.match(body("public.report_story"),/admin_content_is_visible\('story'/);
  const chat=body("public.report_chat_message");
  assert.match(chat,/chat_can_read_message/);assert.match(chat,/chat_message_self_report_forbidden/);
  assert.doesNotMatch(migration,/create table public\.(?:chat_reports|story_reports|abuse_reports_v2)/i);
  assert.match(reportService,/rpcName: 'report_story' \| 'report_chat_message'/);
});

test("report detail intersects domain capabilities and Chat context is case-bounded",()=>{
  const detail=body("public.get_admin_report_detail");
  for(const capability of ["reports.cases.read","users.accounts.read","content.items.read","stories.items.read","chat.abuse_reports.read"])assert.match(detail,new RegExp(capability.replaceAll(".","\\.")));
  assert.equal((detail.match(/limit 3/g)||[]).length,2);
  assert.match(detail,/target\.conversation_id=m\.conversation_id/);
  for(const forbidden of ["media_url'","object_key","bucket","signed_url","audio_waveform","raw_user_meta_data"])assert.doesNotMatch(detail,new RegExp(forbidden));
  assert.match(detail,/'has_media'/);assert.match(detail,/'audio_duration_ms'/);
});

test("reported Chat moderation accepts no message id and preserves row, receipts, and media",()=>{
  const chat=body("public.admin_moderate_reported_chat_message");
  assert.match(chat,/chat\.abuse_reports\.moderate/);
  assert.match(chat,/reported_content_type<>'message'/);
  assert.match(chat,/update public\.messages set deleted_at/);
  assert.doesNotMatch(chat,/p_message_id|delete from public\.messages|chat_message_receipts|media_assets|media_asset_links/);
  assert.match(chat,/insert into private\.admin_content_moderation_actions/);
  assert.match(chat,/insert into private\.admin_action_audit/);
});

test("Admin Web exposes only capability-routed A5 modules",()=>{
  for(const [route,cap] of [["/content","content.items.read"],["/stories","stories.items.read"],["/chat/reports","chat.abuse_reports.read"]]){assert.match(app,new RegExp(route.replaceAll("/","\\/")));assert.match(app,new RegExp(cap.replaceAll(".","\\.")));assert.match(shell,new RegExp(cap.replaceAll(".","\\.")));}
  assert.match(api,/rpc\("admin_moderate_content"/);assert.match(api,/rpc\("admin_moderate_story"/);assert.match(api,/rpc\("admin_moderate_reported_chat_message"/);
  assert.doesNotMatch(app,/browse conversations|global message search/i);
});
