import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_e2e_b5_creative_version_idempotency.sql"));

test("B5 has exactly one Creative Version idempotency migration", () => {
  assert.equal(migrations.length, 1);
});

test("B5 makes Creative Version replay durable and removes the unsafe overload", () => {
  const sql = readFileSync(new URL(`../supabase/migrations/${migrations[0]}`, import.meta.url), "utf8");
  assert.match(sql, /alter table private\.advertising_creative_versions[\s\S]*add column creation_idempotency_key uuid/i);
  assert.match(sql, /when version\.version_number = 1 then creative\.creation_idempotency_key[\s\S]*else version\.id/i);
  assert.match(sql, /alter column creation_idempotency_key set not null/i);
  assert.match(sql, /unique\s*\(\s*creative_id\s*,\s*creation_idempotency_key\s*\)/i);
  assert.match(sql, /create(?: or replace)? function public\.create_my_advertising_creative_version\([\s\S]*p_idempotency_key uuid/i);
  assert.match(sql, /where version\.creative_id = p_creative_id[\s\S]*version\.creation_idempotency_key = p_idempotency_key/i);
  assert.match(sql, /select version\.\* into v_existing[\s\S]*return private\.ads_creative_result\(p_creative_id\);[\s\S]*v_fingerprint := private\.ads_validate_creative_payload/i);
  assert.match(sql, /content_fingerprint is distinct from v_fingerprint[\s\S]*created_by is distinct from v_actor/i);
  assert.match(sql, /advertising_creative_version_idempotency_conflict/i);
  assert.match(sql, /insert into private\.advertising_creative_versions\([\s\S]*creation_idempotency_key/i);
  assert.match(sql, /v_creative\.id, 1[\s\S]*p_idempotency_key/i);
  assert.match(sql, /create or replace function private\.ads_ad_result\(p_ad_id uuid\)[\s\S]*'creation_idempotency_key', ad\.creation_idempotency_key/i);
  assert.match(sql, /create or replace function public\.get_my_advertising_creative_workspace\(\)[\s\S]*'ads'[\s\S]*'creation_idempotency_key', ad\.creation_idempotency_key/i);
  assert.match(sql, /drop function (?:if exists )?public\.create_my_advertising_creative_version\(\s*uuid,\s*text,\s*uuid,\s*uuid,\s*text,\s*text,\s*text,\s*text\s*\)/i);
  assert.match(sql, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on function public\.create_my_advertising_creative_version\([\s\S]*uuid\s*\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.create_my_advertising_creative_version\([\s\S]*uuid\s*\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /activation_enabled\s*=\s*true|funding_enabled\s*=\s*true|spend_enabled\s*=\s*true|global_v2_delivery_enabled\s*=\s*true/i);
});

test("B5 Business client owns the version idempotency key while B6 review submission uses B1 coordination", () => {
  const api = readFileSync(new URL("../apps/business-web/src/lib/adsManagerApi.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", import.meta.url), "utf8");
  assert.match(api, /createAdvertisingCreativeVersion\([^)]*idempotencyKey: string/);
  assert.match(api, /create_my_advertising_creative_version[\s\S]*p_idempotency_key: idempotencyKey/);
  assert.match(workspace, /operation:\s*"creative:version"/);
  assert.match(workspace, /createAdvertisingCreativeVersion\([^,]+,\s*key\)/);
  assert.match(workspace, /reconcile:\s*\(\{ idempotencyKey \}\)\s*=>[\s\S]*findAdOperationResult\([^,]+,\s*idempotencyKey,\s*payload\)/);
  assert.match(workspace, /operation:\s*"review:submit"/);
  assert.match(workspace, /scope:\s*ad\.id/);
  assert.match(workspace, /submitAdvertisingAdForReview\(ad\.id,\s*key\)/);
  assert.doesNotMatch(workspace, /versions\s*\[\s*0\s*\]/);
});
