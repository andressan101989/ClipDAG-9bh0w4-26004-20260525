import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260916194148_business_membership_capability_foundation_bw_j1.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");
const api = await readFile(new URL("../apps/business-web/src/lib/businessApi.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../apps/business-web/src/auth/BusinessAuthProvider.tsx", import.meta.url), "utf8");
const storePage = await readFile(new URL("../apps/business-web/src/pages/BusinessStorePages.tsx", import.meta.url), "utf8");

test("J1 creates exactly the three private membership capability authorities", () => {
  const tables = [...migration.matchAll(/create table private\.([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(tables, [
    "business_capability_catalog",
    "business_memberships",
    "business_membership_capabilities",
  ]);
  assert.doesNotMatch(migration, /create table (?:public|private)\.(?:businesses|organizations|merchants)/i);
  assert.match(migration, /business_owner_id <> member_user_id/i);
  assert.match(migration, /unique \(business_owner_id, member_user_id\)/i);
});

test("J1 capability assignments use catalog and membership foreign keys", () => {
  assert.match(migration, /references private\.business_memberships\(id\) on delete cascade/i);
  assert.match(migration, /references private\.business_capability_catalog\(code\) on delete restrict/i);
  assert.match(migration, /references public\.marketplace_sellers\(user_id\)/i);
  assert.match(migration, /references public\.user_profiles\(id\)/i);
  const seeded = new Set([...migration.matchAll(/\('business\.[a-z_]+\.[a-z_]+'/g)].map((match) => match[0].slice(2, -1)));
  assert.equal(seeded.size, 24);
});

test("private authority is RLS protected and has no direct browser grants", () => {
  for (const table of ["business_capability_catalog", "business_memberships", "business_membership_capabilities"]) {
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated, service_role`, "i"));
  }
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all).*business_(?:memberships|capability)/i);
});

test("server helpers derive the actor from auth.uid and fail closed", () => {
  assert.match(migration, /private\.business_effective_capabilities/);
  assert.match(migration, /private\.business_actor_has_capability/);
  assert.match(migration, /private\.business_require_capability/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.doesNotMatch(migration, /p_actor_user_id/i);
  assert.match(migration, /s\.status = 'approved'/i);
  assert.match(migration, /m\.status = 'active'/i);
  assert.match(migration, /business_capability_required/i);
  assert.match(migration, /set search_path = ''/i);
});

test("business access uses one authenticated projection without membership mutation RPCs", () => {
  assert.match(migration, /function public\.get_my_business_access\(\)/i);
  assert.match(migration, /grant execute on function public\.get_my_business_access\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.get_my_business_access\(\) from public, anon/i);
  assert.doesNotMatch(migration, /function public\.(?:create|invite|grant|revoke)_business_(?:member|membership)/i);
  assert.match(api, /rpc\("get_my_business_access"\)/);
  assert.doesNotMatch(api, /\.from\("marketplace_(?:sellers|stores)"\)/);
});

test("canonical Store update requires store.manage without changing its signature", () => {
  assert.match(migration, /function public\.update_marketplace_store\(\s*p_store_id uuid,\s*p_name text,\s*p_slug text,\s*p_description text default null/i);
  assert.match(migration, /private\.business_require_capability\([\s\S]*'business\.store\.manage'/i);
  assert.match(migration, /v_store_status = 'suspended'/i);
  assert.match(migration, /store_slug_exists/i);
  assert.doesNotMatch(migration, /business_update_store|update_business_store/i);
});

test("Business Web centralizes multi-business selection and Store read/manage presentation", () => {
  assert.match(provider, /businesses: BusinessAccess\[\]/);
  assert.match(provider, /currentBusiness: BusinessAccess \| null/);
  assert.match(provider, /hasCapability/);
  assert.match(provider, /sessionStorage/);
  assert.match(storePage, /business\.store\.manage/);
  assert.match(storePage, /Vista de solo lectura/);
  assert.doesNotMatch(provider, /AdminAuthProvider|admin_actor_has_capability/);
});

test("J1 migration does not touch finance, Ads or wallet authorities", () => {
  assert.doesNotMatch(migration, /\b(?:ledger_accounts|ledger_entries|financial_transactions|app_wallets|marketplace_payments|withdrawal_requests|marketplace_ad_)\b/i);
});
