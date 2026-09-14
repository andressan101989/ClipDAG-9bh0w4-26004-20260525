import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20260914114527_admin_user_warning_enforcement_v1.sql",import.meta.url),"utf8");
const edge=readFileSync(new URL("../supabase/functions/admin-user-moderation/index.ts",import.meta.url),"utf8");
const api=readFileSync(new URL("../apps/admin-web/src/lib/adminApi.ts",import.meta.url),"utf8");
const users=readFileSync(new URL("../apps/admin-web/src/pages/AdminUsersPages.tsx",import.meta.url),"utf8");
const notifications=readFileSync(new URL("../contexts/NotificationsContext.tsx",import.meta.url),"utf8");

test("creates one private warning authority and no parallel suspension authority",()=>{
  assert.match(migration,/create table private\.admin_user_warnings/i);
  assert.equal((migration.match(/create table/gi)||[]).length,1);
  assert.doesNotMatch(migration,/create table\s+(?:private\.)?admin_(?:suspensions|strikes|enforcement)/i);
  assert.match(migration,/revoke all privileges on table private\.admin_user_warnings\s+from public,anon,authenticated,service_role/i);
});

test("serializes each target, blocks warning four, and requires suspension authority before warning three",()=>{
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('admin-user-moderation-target:'/i);
  assert.match(migration,/if v_active_count>=3 then[\s\S]*admin_user_warning_limit_reached/i);
  assert.match(migration,/v_warning_level:=v_active_count\+1/i);
  assert.match(migration,/v_suspension_required:=v_warning_level=3 and v_account_status='active'/i);
  assert.match(migration,/admin_actor_has_capability\('users\.accounts\.suspend'\)[\s\S]*admin_user_warning_suspend_capability_required/i);
});

test("keeps warning notification and audit idempotent without exposing internal notes",()=>{
  assert.match(migration,/unique\(idempotency_scope,idempotency_key\)/i);
  assert.match(migration,/notifications_admin_warning_reference_uidx/i);
  assert.match(migration,/'Advertencia '\|\|v_warning_level::text\|\|'\/3: '\|\|v_reason/i);
  const notificationInsert=migration.match(/insert into public\.notifications[\s\S]*?returning id into v_notification_id;/i)?.[0]??"";
  assert.doesNotMatch(notificationInsert,/internal_note/i);
  assert.match(migration,/'user\.warning\.issue'/i);
  assert.match(migration,/'user\.warning\.revoke'/i);
  assert.match(migration,/'succeeded',false,true/i);
});

test("restore starts a new cycle while history is retained and revocation never restores",()=>{
  assert.match(migration,/action='restore' and status='succeeded'/i);
  assert.match(migration,/historical_warning_count/i);
  assert.match(migration,/status='revoked'/i);
  const revoke=migration.match(/create function public\.admin_revoke_user_warning[\s\S]*?\$\$;/i)?.[0]??"";
  assert.doesNotMatch(revoke,/admin_prepare_user_moderation_action/i);
});

test("existing Edge function owns warning orchestration and canonical Auth mutation",()=>{
  assert.match(edge,/action!==\'issue_warning\'/);
  assert.match(edge,/admin_issue_user_warning/);
  assert.match(edge,/admin_prepare_user_moderation_action/);
  assert.match(edge,/admin_finalize_user_moderation_action/);
  assert.match(edge,/reconcileUserModeration/);
  assert.match(edge,/service\.auth\.admin\.updateUserById/);
  assert.doesNotMatch(api,/SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test("admin and mobile surfaces expose discipline without raw JSON",()=>{
  for(const source of[api,users])assert.doesNotMatch(source,/<pre>|JSON\.stringify/);
  assert.match(users,/Advertencias del ciclo actual/);
  assert.match(users,/Emitir advertencia 3\/3 y suspender/);
  assert.match(users,/Revocar advertencia/);
  assert.match(users,/Suspender cuenta/);
  assert.match(users,/Restaurar cuenta/);
  assert.match(notifications,/admin_warning/);
});

test("warning migration contains no financial or Auth data mutation",()=>{
  assert.doesNotMatch(migration,/\b(?:ledger|wallet|escrow|settlement|refund)\b/i);
  assert.doesNotMatch(migration,/(?:insert into|update|delete from)\s+auth\.users/i);
});
