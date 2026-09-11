import assert from "node:assert/strict";
import test from "node:test";
import {existsSync,readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20260911180713_superuser_a4_users_reports_provisioning.sql",import.meta.url),"utf8");
const edge=readFileSync(new URL("../supabase/functions/admin-user-moderation/index.ts",import.meta.url),"utf8");
const api=readFileSync(new URL("../apps/admin-web/src/lib/adminApi.ts",import.meta.url),"utf8");
const provider=readFileSync(new URL("../apps/admin-web/src/auth/AdminAuthProvider.tsx",import.meta.url),"utf8");
const app=readFileSync(new URL("../apps/admin-web/src/App.tsx",import.meta.url),"utf8");
const shell=readFileSync(new URL("../apps/admin-web/src/layout/AdminShell.tsx",import.meta.url),"utf8");

const section=(start,end)=>{const from=migration.indexOf(start),to=migration.indexOf(end,from+start.length);assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);return migration.slice(from,to)};

test("A4 preserves the closed A3 catalogs and refuses root provisioning",()=>{
  assert.match(migration,/admin_roles\) <> 6/);
  assert.match(migration,/admin_capabilities\) <> 47/);
  assert.match(migration,/admin_role_capabilities\) <> 142/);
  assert.match(migration,/admin_role_grant_rules\) <> 7/);
  assert.match(migration,/role_code='SUPER_ADMIN' and revoked_at is null\) <> 0/);
  assert.doesNotMatch(migration,/insert into private\.admin_(?:roles|capabilities|role_capabilities|role_grant_rules)/i);
  assert.doesNotMatch(migration,/admin_trusted_(?:provision|revoke)_super_admin\s*\(/i);
});

test("global provider uses get_my_admin_access and capability guards cover every route",()=>{
  assert.match(api,/rpc\("get_my_admin_access"\)/);
  assert.doesNotMatch(api,/rpc\("get_my_marketplace_admin_access"\)/);
  for(const field of ["roles","capabilities","authority_version"])assert.match(api,new RegExp(field));
  assert.match(provider,/hasCapability/);
  assert.match(app,/CapabilityRoute capability="users\.accounts\.read"/);
  assert.match(app,/CapabilityRoute capability="reports\.cases\.read"/);
  assert.match(app,/CapabilityRoute capability="admin\.roles\.read"/);
  for(const cap of ["marketplace.overview.read","marketplace.orders.read","marketplace.disputes.read","marketplace.sellers.read","marketplace.products.read","marketplace.creators.read","marketplace.promotions.read","marketplace.ads.read","marketplace.health.read","marketplace.audit.read"])assert.match(app,new RegExp(cap.replaceAll(".","\\.")));
  assert.match(shell,/hasCapability\(link\.capability\)/);
});

test("Users list/detail are bounded capability RPCs with explicit safe projections",()=>{
  for(const name of ["search_admin_users","get_admin_user_detail"])assert.match(migration,new RegExp(`create function public\\.${name}`));
  const users=section("create function public.search_admin_users","create function public.get_admin_user_detail");
  const detail=section("create function public.get_admin_user_detail","create function public.admin_prepare_user_moderation_action");
  assert.match(users,/admin_require_capability\('users\.accounts\.read'\)/);
  assert.match(users,/least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(detail,/admin_require_capability\('users\.accounts\.read'\)/);
  for(const secret of ["email","phone","push_token","wallet_address","dag_balance","raw_user_meta_data","raw_app_meta_data","encrypted_password"])assert.doesNotMatch(users,new RegExp(`'${secret}'`));
});

test("user moderation command is private, idempotent, target-safe, and service-finalized",()=>{
  const table=section("create table private.admin_user_moderation_actions","create index admin_user_moderation_target_requested_idx");
  assert.match(table,/action in\('suspend','restore'\)/);
  assert.match(table,/status in\('pending','succeeded','failed'\)/);
  assert.match(table,/unique\(idempotency_scope,idempotency_key\)/);
  assert.match(migration,/admin_user_self_target_forbidden/);
  assert.match(migration,/admin_user_admin_target_forbidden/);
  assert.match(migration,/deleted_at is not null/);
  assert.match(migration,/for update/);
  assert.match(migration,/admin_idempotency_conflict/);
  assert.match(migration,/admin_user_finalize_service_role_required/);
  assert.match(migration,/grant execute on function public\.admin_finalize_user_moderation_action[\s\S]*?to service_role/);
  assert.match(migration,/grant execute on function public\.admin_prepare_user_moderation_action[\s\S]*?to authenticated/);
});

test("Auth Admin calls are Edge-only and use supported ban/unban contracts",()=>{
  assert.match(edge,/auth\.admin\.updateUserById/);
  assert.match(edge,/ban_duration:action==='suspend'\?'876000h':'none'/);
  assert.match(edge,/admin_prepare_user_moderation_action/);
  assert.match(edge,/admin_finalize_user_moderation_action/);
  assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edge,/json\(\{[^\n}]*serviceKey/i);
  assert.doesNotMatch(migration,/update\s+auth\.users|insert\s+into\s+auth\.users|delete\s+from\s+auth\.users/i);
});

test("Reports remove is_admin authority while preserving reporter self-service",()=>{
  assert.match(migration,/drop policy if exists "Admins can manage all reports"/);
  assert.match(migration,/create policy reports_insert_own[\s\S]*?to authenticated[\s\S]*?reporter_user_id=auth\.uid\(\)/);
  assert.match(migration,/create policy reports_select_own[\s\S]*?to authenticated[\s\S]*?reporter_user_id=auth\.uid\(\)/);
  assert.match(migration,/grant select on table public\.reports to authenticated/);
  assert.match(migration,/grant insert\(reporter_user_id,reported_content_id,reported_content_type,reason,details\)[\s\S]*?to authenticated/);
  assert.doesNotMatch(migration,/grant (?:update|delete|all)[^\n]*reports to authenticated/i);
  for(const [name,cap] of [["search_admin_reports","reports.cases.read"],["get_admin_report_detail","reports.cases.read"],["admin_review_report","reports.cases.review"],["admin_dismiss_report","reports.cases.resolve"]]){
    const start=`create function public.${name}`;assert.match(migration,new RegExp(start.replaceAll(".","\\.")));const body=migration.slice(migration.indexOf(start),migration.indexOf("$$;",migration.indexOf(start))+3);assert.match(body,new RegExp(cap.replaceAll(".","\\.")));
  }
  assert.doesNotMatch(migration,/delete from public\.(?:videos|comments)/i);
});

test("role read RPCs reuse A3 mutations and expose no trusted operator reference",()=>{
  assert.match(migration,/create function public\.get_admin_role_catalog/);
  assert.match(migration,/create function public\.search_admin_role_assignments/);
  assert.match(migration,/admin_require_capability\('admin\.roles\.read'\)/);
  const search=section("create function public.search_admin_role_assignments","-- Least-privilege execution contracts.");
  assert.doesNotMatch(search,/grant_operator_reference|revoke_operator_reference/);
  assert.match(api,/rpc\("admin_assign_role"/);
  assert.match(api,/rpc\("admin_revoke_role"/);
  assert.doesNotMatch(api,/admin_(?:assign|revoke)_role_v2/);
});

test("legacy mobile admin surface and its direct mutations are absent",()=>{
  assert.equal(existsSync(new URL("../app/admin/index.tsx",import.meta.url)),false);
  assert.doesNotMatch(app,/user\?\.isAdmin|from\(['"]reports['"]\)\.update|delete\(\).*videos|delete\(\).*comments/);
});

test("A4 migration does not touch financial state or create parallel authority",()=>{
  for(const forbidden of ["ledger_entries","financial_transactions","ledger_accounts","wallet","escrow","is_suspended","is_super_admin"])assert.doesNotMatch(migration,new RegExp(`(?:insert into|update|delete from|create table)[^;]*\\b${forbidden}\\b`,"i"));
});
