import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20260911205948_superuser_a6_live_battles_media.sql",import.meta.url),"utf8");
const app=readFileSync(new URL("../apps/admin-web/src/App.tsx",import.meta.url),"utf8");
const shell=readFileSync(new URL("../apps/admin-web/src/layout/AdminShell.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../apps/admin-web/src/lib/adminApi.ts",import.meta.url),"utf8");
const agora=readFileSync(new URL("../supabase/functions/agora-token/index.ts",import.meta.url),"utf8");
const broadcast=readFileSync(new URL("../app/live/broadcast/[streamId].tsx",import.meta.url),"utf8");
const watch=readFileSync(new URL("../app/live/watch/[streamId].tsx",import.meta.url),"utf8");

const body=(name)=>{const start=migration.search(new RegExp(`create(?: or replace)? function ${name.replaceAll(".","\\.")}\\b`,"i"));assert.notEqual(start,-1,`missing ${name}`);const end=migration.indexOf("$$;",start);assert.notEqual(end,-1,`unterminated ${name}`);return migration.slice(start,end+3)};

test("A6 preserves authority and finance catalogs",()=>{
  for(const [object,count] of [["admin_roles",6],["admin_capabilities",47],["admin_role_capabilities",142],["admin_role_grant_rules",7]])assert.match(migration,new RegExp(`${object}\\)<>${count}`));
  assert.match(migration,/role_code='SUPER_ADMIN' and revoked_at is null/);
  assert.doesNotMatch(migration,/insert into private\.admin_(?:roles|capabilities|role_capabilities|role_grant_rules|user_roles)/i);
  assert.doesNotMatch(migration,/admin_trusted_(?:provision|revoke)_super_admin\s*\(/i);
  for(const target of ["ledger_entries","financial_transactions","ledger_accounts","wallet","escrow","live_gift_transactions","live_battle_score_events"])assert.doesNotMatch(migration,new RegExp(`(?:insert into|update|delete from|create table)\\s+(?:public\\.)?${target}\\b`,"i"));
});

test("LIVE readers are bounded, capability-protected, and exclude Agora credentials",()=>{
  const search=body("public.search_admin_live_sessions"),detail=body("public.get_admin_live_session_detail");
  assert.match(search,/live\.sessions\.read/);assert.match(detail,/live\.sessions\.read/);
  assert.match(search,/least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(detail,/limit 100/);
  for(const secret of ["agora_uid","agora_token","certificate","push_token","wallet_address","ledger_account"])assert.doesNotMatch(search+detail,new RegExp(secret,"i"));
});

test("host and admin participant control reuse one private mutator",()=>{
  const core=body("private.live_apply_participant_control"),host=body("public.live_host_control_participant"),admin=body("public.admin_moderate_live_participant");
  assert.match(host,/private\.live_apply_participant_control/);assert.match(admin,/private\.live_apply_participant_control/);
  assert.match(core,/update public\.live_participants/);assert.match(core,/insert into public\.live_control_events/);
  assert.match(core,/p_action not in\('mute','lock_mic','remove_cohost'\)/);
  for(const denied of ["unmute","unlock_mic","grant_floor","timer_start","timer_stop"])assert.doesNotMatch(admin,new RegExp(`p_action[^;]*${denied}`,"i"));
  assert.match(core,/target_user_id.*host_id|v_participant\.user_id=v_session\.host_id/s);
});

test("LIVE termination uses one end core and cancels open Battles canonically first",()=>{
  const core=body("private.live_end_session"),host=body("public.end_live_session"),admin=body("public.admin_terminate_live_session"),battle=body("private.admin_cancel_live_battle_core");
  assert.match(host,/private\.live_end_session/);assert.match(admin,/private\.live_end_session/);
  assert.match(admin,/status in\('pending','accepted','countdown','active'\)/);
  assert.ok(admin.indexOf("private.admin_cancel_live_battle_core")<admin.indexOf("private.live_end_session"));
  assert.match(admin,/v_b_idempotency_key:=md5\(p_idempotency_key::text\|\|':battle:'/);
  assert.match(core,/status='ended'/);assert.match(core,/end_reason=p_end_reason/);assert.match(admin,/admin_terminated/);
  assert.match(battle,/private\.live_battle_transition/);
  assert.match(admin,/insert into private\.admin_action_audit/);
});

test("Battle cancellation extends and reuses the canonical transition engine",()=>{
  const transition=body("private.live_battle_transition"),core=body("private.admin_cancel_live_battle_core"),admin=body("public.admin_cancel_live_battle");
  assert.match(transition,/admin_cancelled/);assert.match(transition,/admin_live_terminated/);
  assert.match(transition,/insert into public\.live_battle_events/);assert.match(transition,/private\.reconcile_live_battle_score_locked/);
  assert.match(core,/private\.live_battle_reconcile_locked/);assert.match(core,/private\.live_battle_transition/);
  assert.doesNotMatch(core+admin,/update public\.live_battles set status/i);
  assert.match(admin,/battles\.sessions\.moderate/);assert.match(admin,/financial_effect[\s\S]*false/);
});

test("Battle readers are bounded and omit financial internals",()=>{
  const search=body("public.search_admin_live_battles"),detail=body("public.get_admin_live_battle_detail");
  assert.match(search,/battles\.sessions\.read/);assert.match(detail,/battles\.sessions\.read/);
  assert.match(search,/least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);assert.match(detail,/limit 100/);
  for(const secret of ["ledger_account","wallet_address","financial_transaction","payment_metadata"])assert.doesNotMatch(search+detail,new RegExp(secret,"i"));
});

test("administratively hidden Chat media remains valid evidence",()=>{
  const valid=body("public.media_asset_has_valid_links"),cleanup=body("public.admin_schedule_media_cleanup");
  assert.match(valid,/l\.entity_type='chat_message'/);assert.match(valid,/m\.deleted_at is null or exists/);
  assert.match(valid,/private\.admin_content_moderation_actions/);assert.match(valid,/ma\.target_type='chat_message'/);assert.match(valid,/ma\.action='hide'/);
  assert.match(cleanup,/media_asset_has_valid_links/);assert.match(cleanup,/asset_in_use/);
  assert.doesNotMatch(migration,/create table .*evidence|create table .*media_hold/i);
});

test("Media reads expose operational metadata only and cleanup reuses the existing lifecycle",()=>{
  const search=body("public.search_admin_media_assets"),detail=body("public.get_admin_media_asset_detail"),cleanup=body("public.admin_schedule_media_cleanup");
  assert.match(search,/media\.assets\.read/);assert.match(detail,/media\.assets\.read/);
  assert.match(search,/least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(search,/visibility='public' and status='ready' and public_url~\*'\^https:\/\/'/);
  for(const secret of ["bucket_name","object_key","etag","original_filename","signed_url","r2_"])assert.doesNotMatch(search+detail,new RegExp(`['\"]${secret}['\"]`,"i"));
  assert.match(cleanup,/public\.schedule_media_asset_deletion/);
  assert.doesNotMatch(cleanup,/delete from public\.media_assets|delete from public\.media_asset_links|fetch\s*\(/i);
});

test("all A6 admin commands use server-side capabilities, fingerprinted idempotency, and global audit",()=>{
  for(const [name,capability] of [["public.admin_moderate_live_participant","live.sessions.moderate"],["public.admin_terminate_live_session","live.sessions.terminate"],["public.admin_cancel_live_battle","battles.sessions.moderate"],["public.admin_schedule_media_cleanup","media.assets.moderate"]]){
    const fn=body(name);assert.match(fn,new RegExp(capability.replaceAll(".","\\.")));assert.match(fn,/private\.admin_request_fingerprint/);assert.match(fn,/pg_advisory_xact_lock/);assert.match(fn,/admin_idempotency_conflict/);assert.match(fn,/insert into private\.admin_action_audit/);
  }
});

test("private A6 cores have no runtime execute surface",()=>{
  for(const signature of ["private.live_apply_participant_control","private.live_end_session","private.admin_cancel_live_battle_core","private.live_battle_transition"])assert.match(migration,new RegExp(`revoke all on function ${signature.replaceAll(".","\\.")}[\\s\\S]*?public,anon,authenticated,service_role`));
});

test("existing runtime observes ended sessions and Agora rejects them",()=>{
  assert.match(agora,/liveSession\.status !== 'live' \|\| liveSession\.ended_at !== null/);
  assert.match(broadcast,/sData\?\.status === 'ended'/);
  assert.match(watch,/sData\.status === 'ended'/);
});

test("admin-web exposes only the six capability-guarded A6 routes and safe actions",()=>{
  for(const [route,capability] of [["/live","live.sessions.read"],["/battles","battles.sessions.read"],["/media","media.assets.read"]]){assert.match(app,new RegExp(route));assert.match(app,new RegExp(capability.replaceAll(".","\\.")));assert.match(shell,new RegExp(capability.replaceAll(".","\\.")));}
  for(const rpc of ["search_admin_live_sessions","get_admin_live_session_detail","admin_moderate_live_participant","admin_terminate_live_session","search_admin_live_battles","get_admin_live_battle_detail","admin_cancel_live_battle","search_admin_media_assets","get_admin_media_asset_detail","admin_schedule_media_cleanup"])assert.match(api,new RegExp(rpc));
  assert.doesNotMatch(app+shell,/force winner|edit score|refund gifts|view private file|force physical delete/i);
});
