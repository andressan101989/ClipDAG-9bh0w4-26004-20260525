import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260923121021_ads_v2_i_c1_advertiser_media_access.sql", import.meta.url), "utf8");
const searchMigration = readFileSync(new URL("../supabase/migrations/20260923060826_ads_v2_i_business_manager_read_projection.sql", import.meta.url), "utf8");
const sharedAuth = readFileSync(new URL("../supabase/functions/_shared/businessMediaAuth.ts", import.meta.url), "utf8");
const imageUpload = readFileSync(new URL("../supabase/functions/create-media-upload/index.ts", import.meta.url), "utf8");
const videoUpload = readFileSync(new URL("../supabase/functions/create-stream-upload/index.ts", import.meta.url), "utf8");
const picker = readFileSync(new URL("../apps/business-web/src/components/BusinessMedia.tsx", import.meta.url), "utf8");
const adsWorkspace = readFileSync(new URL("../apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", import.meta.url), "utf8");
const creativePanels = readFileSync(new URL("../apps/business-web/src/components/ads/CreativeAdPanels.tsx", import.meta.url), "utf8");
const creativeMigration = readFileSync(new URL("../supabase/migrations/20260922174702_ads_v2_d_creative_moderation_foundation.sql", import.meta.url), "utf8");

test("repository migration history uses the production Ads V2 I version", () => {
  assert.equal(existsSync(new URL("../supabase/migrations/20260923060732_ads_v2_i_business_manager_read_projection.sql", import.meta.url)), false);
  assert.match(searchMigration, /create or replace function private\.advertising_campaign_result/);
});

test("canonical media search preserves Marketplace capabilities and adds only self active advertiser ownership", () => {
  assert.match(migration, /private\.business_actor_has_capability\(p_business_owner_id, 'business\.media\.read'\)/);
  assert.match(migration, /private\.business_actor_has_capability\(p_business_owner_id, 'business\.media\.manage'\)/);
  assert.match(migration, /p_actor_user_id = p_business_owner_id/);
  assert.match(migration, /from private\.business_accounts as business[\s\S]*business\.owner_user_id = p_actor_user_id[\s\S]*business\.status = 'active'/);
  assert.match(migration, /a\.owner_id = p_business_owner_id[\s\S]*a\.provider = 'r2'[\s\S]*a\.visibility = 'public'/);
  assert.match(migration, /v\.owner_id = p_business_owner_id[\s\S]*v\.provider = 'cloudflare_stream'[\s\S]*v\.purpose = 'business_library'[\s\S]*v\.visibility = 'public'/);
});

test("media authorization stays RPC-only and authenticated search-only", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.business_media_actor_has_advertiser_owner_scope\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.business_media_actor_has_advertiser_owner_scope\(uuid, uuid\) to service_role/);
  assert.match(migration, /revoke all on function public\.search_my_business_media[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.search_my_business_media[\s\S]*to authenticated/);
});

test("existing image and video upload authorities accept only the verified advertiser self-owner exception", () => {
  assert.match(sharedAuth, /actorUserId !== businessOwnerId\) return false/);
  assert.match(sharedAuth, /business_media_actor_has_advertiser_owner_scope/);
  assert.match(imageUpload, /legacyAllowed\|\|advertiserOwnerAllowed/);
  assert.match(imageUpload, /purpose==='business_library'&&visibility==='public'/);
  assert.match(videoUpload, /legacyAllowed\|\|advertiserOwnerAllowed/);
  assert.match(videoUpload, /purpose!=='business_library'/);
});

test("Ads Manager reuses the canonical picker and uploader without a parallel storage path", () => {
  assert.match(picker, /uploadBusinessMedia\(ownerId, file, setUploadProgress\)/);
  assert.match(adsWorkspace, /<CreativePanel/);
  assert.match(creativePanels, /<BusinessMediaPicker[\s\S]*allowUpload=\{owner\}/);
  assert.doesNotMatch(adsWorkspace, /Media Library is still Marketplace Business capability-scoped/);
  assert.doesNotMatch(migration, /create table|create bucket|storage\.buckets/i);
});

test("creative payload ownership remains actor-owned and unchanged", () => {
  assert.match(creativeMigration, /from public\.media_assets[\s\S]*owner_id = p_actor[\s\S]*purpose = 'business_library'/);
  assert.match(creativeMigration, /from public\.video_assets[\s\S]*owner_id = p_actor[\s\S]*purpose = 'business_library'/);
  assert.doesNotMatch(migration, /ads_validate_creative_payload/);
});

test("C1 does not alter finance, delivery, age, or Ads operational authorities", () => {
  assert.doesNotMatch(migration, /advertising_finance_policy|advertising_delivery_policy|user_age_eligibility|advertising_campaigns|advertising_ads/);
});
