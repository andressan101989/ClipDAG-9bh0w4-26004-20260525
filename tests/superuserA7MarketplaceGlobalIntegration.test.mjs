import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260911215332_superuser_a7_marketplace_global_integration.sql");
const edge = read("supabase/functions/get-media-url/index.ts");
const mobileAuth = read("contexts/AuthContext.tsx");
const adminAuth = read("apps/admin-web/src/auth/AdminAuthProvider.tsx");
const adminApi = read("apps/admin-web/src/lib/adminApi.ts");
const chatService = read("services/chatService.ts");
const chatMigration = read("supabase/migrations/20260907043715_chat_v2_e_groups.sql");
const a3 = read("supabase/migrations/20260911162054_superuser_a3_canonical_authority_foundation.sql");

test("get-media-url authorizes only linked dispute evidence with the exact canonical capability", () => {
  const linkCheck = edge.indexOf("entity_type','marketplace_dispute'");
  const capabilityCheck = edge.indexOf("caller.rpc('admin_actor_has_capability'");
  assert.ok(linkCheck >= 0 && capabilityCheck > linkCheck);
  assert.match(edge, /\.in\('slot',\['buyer_evidence','seller_evidence'\]\)/);
  assert.match(edge, /p_capability:'marketplace\.disputes\.read'/);
  assert.match(edge, /return !accessError&&access===true/);
  assert.doesNotMatch(edge, /get_my_marketplace_admin_access|marketplace_actor_is_admin|user_profiles\.is_admin/);
});

test("all non-admin get-media-url authorization paths remain intact", () => {
  for (const token of [
    "sellerMayReadBuyerDisputeEvidence",
    "returnParticipantMayReadLabel",
    "visibleStoryForAsset",
    "chat_authorize_media_access",
    "a.owner_id!==user.id",
  ]) assert.match(edge, new RegExp(token.replaceAll(".", "\\.")));
  assert.match(edge, /signGet\(a\.bucket_name,a\.object_key\)/);
});

test("mobile authentication has no global-admin bootstrap or field", () => {
  assert.doesNotMatch(mobileAuth, /\bisAdmin\b|\bis_admin\b/);
  assert.doesNotMatch(mobileAuth, /get_my_(?:marketplace_)?admin_access/);
  assert.match(mobileAuth, /get_my_user_profile_private/);
  assert.match(mobileAuth, /\.from\('ledger_accounts'\)/);
});

test("admin-web remains on the single global authority", () => {
  assert.match(adminApi, /rpc\("get_my_admin_access"\)/);
  assert.doesNotMatch(adminApi + adminAuth, /get_my_marketplace_admin_access|MarketplaceAdminProvider|MarketplaceAuthContext/);
  assert.match(adminAuth, /hasCapability/);
});

test("A7 removes the legacy column and adapters without CASCADE", () => {
  assert.match(migration, /drop function public\.get_my_marketplace_admin_access\(\)/i);
  assert.match(migration, /drop function public\.marketplace_actor_is_admin\(\)/i);
  assert.match(migration, /drop function public\.marketplace_require_admin\(\)/i);
  assert.match(migration, /alter table public\.user_profiles[\s\S]*drop column is_admin/i);
  assert.doesNotMatch(migration, /\bcascade\b/i);
});

test("profile self-provisioning and server-owned fields stay protected", () => {
  assert.match(migration, /create policy user_profiles_insert_self[\s\S]*\(select auth\.uid\(\)\) = id[\s\S]*dag_balance = 0[\s\S]*followers_count = 0[\s\S]*following_count = 0/i);
  const protect = migration.slice(migration.indexOf("create or replace function public.protect_user_profile_server_fields"), migration.indexOf("drop function public.get_my_marketplace_admin_access"));
  for (const field of ["dag_balance", "followers_count", "following_count", "new.id", "new.created_at"]) assert.match(protect, new RegExp(field.replace(".", "\\.")));
  assert.doesNotMatch(protect, /is_admin/);
});

test("A7 changes no authority catalogs, assignments, audit, or finance", () => {
  for (const [object, count] of [["admin_roles", 6], ["admin_capabilities", 47], ["admin_role_capabilities", 142], ["admin_role_grant_rules", 7]]) {
    assert.match(migration, new RegExp(`${object}\\) <> ${count}`));
  }
  assert.doesNotMatch(migration, /insert into private\.admin_(?:roles|capabilities|role_capabilities|role_grant_rules|user_roles|action_audit)/i);
  assert.doesNotMatch(migration, /admin_trusted_(?:provision|revoke)_super_admin\s*\(/i);
  for (const target of ["ledger_accounts", "financial_transactions", "ledger_entries", "wallet", "escrow", "refund", "settlement"]) {
    assert.doesNotMatch(migration, new RegExp(`(?:insert into|update|delete from|alter table)\\s+(?:public\\.)?${target}\\b`, "i"));
  }
});

test("legacy admin correspondence is asserted without creating an assignment", () => {
  assert.match(migration, /where is_admin is true/);
  assert.match(migration, /aur\.role_code='MARKETPLACE_ADMIN'/);
  assert.match(migration, /a7_legacy_admin_not_canonicalized/);
  assert.doesNotMatch(migration, /insert into private\.admin_user_roles/i);
});

test("Chat-local group-admin semantics are preserved", () => {
  assert.match(chatService, /chat_set_group_admin/);
  assert.match(chatService, /p_is_admin:\s*isAdmin/);
  assert.match(chatMigration, /chat_set_group_admin\(p_conversation_id uuid,p_user_id uuid,p_is_admin boolean\)/);
  assert.match(chatMigration, /case when p_is_admin then 'admin' else 'member' end/);
});

test("Marketplace mutations retain exact capabilities and PLATFORM_ADMIN cannot resolve disputes", () => {
  for (const capability of ["marketplace.sellers.moderate", "marketplace.products.moderate", "marketplace.disputes.resolve"]) assert.match(a3, new RegExp(capability.replaceAll(".", "\\.")));
  assert.match(a3, /'PLATFORM_ADMIN'[\s\S]*except[\s\S]*'marketplace\.disputes\.resolve'/i);
  assert.match(a3, /'MARKETPLACE_ADMIN'[\s\S]*marketplace\.disputes\.resolve/i);
});
