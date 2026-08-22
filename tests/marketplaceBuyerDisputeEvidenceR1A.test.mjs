import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/20260821010000_marketplace_buyer_dispute_evidence_r1a.sql");
const panel = await read("components/marketplace/MarketplaceDisputePanel.tsx");
const buyer = await read("app/orders/[id].tsx");
const settlement = await read("services/marketplaceSettlementService.ts");
const media = await read("services/mediaService.ts");
const purposes = await read("supabase/functions/_shared/mediaPurposes.ts");

test("R1A reuses the canonical dispute and media authorities", () => {
  assert.match(migration, /create table public\.marketplace_dispute_items/);
  assert.match(migration, /references public\.marketplace_order_items\(id\)/);
  assert.match(migration, /entity_type='marketplace_dispute'/);
  assert.match(migration, /slot='buyer_evidence'/);
  assert.match(migration, /insert into public\.media_asset_links/);
  assert.doesNotMatch(migration, /create table public\.marketplace_dispute_(?:evidence|uploads)/);
  assert.doesNotMatch(migration, /create function public\.report_marketplace_order_problem_v2/);
});

test("the canonical RPC has one unambiguous evolved signature and hardened privileges", () => {
  assert.match(migration, /drop function public\.report_marketplace_order_problem\(uuid,text,text,uuid\)/);
  assert.match(migration, /create function public\.report_marketplace_order_problem\([\s\S]*p_order_item_ids uuid\[\][\s\S]*p_evidence_asset_ids uuid\[\]/);
  assert.match(migration, /security definer[\s\S]*set search_path = public/);
  assert.match(migration, /revoke all on function public\.report_marketplace_order_problem\(uuid,text,text,uuid,uuid\[\],uuid\[\]\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.report_marketplace_order_problem\(uuid,text,text,uuid,uuid\[\],uuid\[\]\)[\s\S]*to authenticated, service_role/);
});

test("mandatory evidence and note rules are enforced atomically", () => {
  assert.match(migration, /p_reason_code in \('damaged','incorrect_item','missing_items'\) and v_evidence_count<1/);
  assert.match(migration, /p_reason_code='other' and char_length\(btrim\(coalesce\(p_buyer_note,''\)\)\)<3/);
  assert.match(migration, /v_evidence_count not between 0 and 6/);
  assert.match(migration, /status='ready'[\s\S]*visibility='private'[\s\S]*media_kind='image'[\s\S]*purpose='dispute_evidence'/);
  assert.match(migration, /owner_id=auth\.uid\(\)/);
});

test("foreign items and unsafe assets are rejected before dispute insertion", () => {
  const itemValidation = migration.indexOf("marketplace_order_items where order_id=v_order.id");
  const assetValidation = migration.indexOf("from public.media_assets");
  const disputeInsert = migration.indexOf("insert into public.marketplace_order_disputes");
  assert.ok(itemValidation > 0 && itemValidation < disputeInsert);
  assert.ok(assetValidation > 0 && assetValidation < disputeInsert);
  assert.match(migration, /marketplace_dispute_invalid_input/);
});

test("settlement and one-active-dispute protections remain", () => {
  assert.match(migration, /exists\(select 1 from public\.marketplace_order_settlements where order_id=v_order\.id\)[\s\S]*marketplace_dispute_settlement_completed/);
  assert.match(migration, /status in \('open','under_review'\)/);
  assert.match(migration, /marketplace_dispute_idempotency_conflict/);
  assert.match(migration, /where buyer_id=auth\.uid\(\) and idempotency_key=p_idempotency_key/);
  assert.match(migration, /primary key \(dispute_id, order_item_id\)/);
  assert.match(migration, /marketplace_dispute_evidence_position_unique/);
});

test("R1A performs no financial mutation", () => {
  assert.doesNotMatch(migration, /ledger_debit|ledger_credit|atomic_ledger_transfer|update public\.marketplace_payment_allocations|insert into public\.marketplace_order_settlements/);
  assert.doesNotMatch(migration, /refund|seller_net|platform_fee|creator_commission|affiliate_commission/);
});

test("buyer selects immutable purchased items and client enforces evidence policy", () => {
  assert.match(buyer, /items=\{data\.items\}/);
  assert.match(panel, /selectedItemIds\.length === 0/);
  assert.match(panel, /"damaged"[\s\S]*"incorrect_item"[\s\S]*"missing_items"/);
  assert.match(panel, /evidenceRequired\.has\(reason\) && photos\.length === 0/);
  assert.match(panel, /reason === "other" && note\.trim\(\)\.length < 3/);
  assert.match(panel, /MAX_EVIDENCE_IMAGES = 6/);
  assert.match(panel, /item\.id/);
  assert.match(panel, /item\.imageUrl/);
});

test("evidence uses canonical private image upload and submits asset IDs", () => {
  assert.match(panel, /uploadMediaFromUri\(\{/);
  assert.match(panel, /purpose: "dispute_evidence"/);
  assert.match(panel, /visibility: "private"/);
  assert.match(panel, /materializeMarketplacePhotoAsset/);
  assert.match(panel, /evidenceAssetIds/);
  assert.doesNotMatch(panel, /public_url|base64/);
  assert.match(media, /\| "dispute_evidence"/);
  assert.match(media, /IMAGE_PURPOSES[\s\S]*"dispute_evidence"/);
  assert.match(purposes, /dispute_evidence:\s*\{\s*kind: "image",[\s\S]*defaultVisibility: "private"/);
});

test("service sends canonical item and asset IDs without a new transport", () => {
  assert.match(settlement, /p_order_item_ids: orderItemIds/);
  assert.match(settlement, /p_evidence_asset_ids: evidenceAssetIds/);
  assert.match(settlement, /"report_marketplace_order_problem"/);
  assert.doesNotMatch(settlement, /report_marketplace_order_problem_v2/);
});

test("linked evidence remains visible to existing media cleanup authority", () => {
  assert.match(migration, /create or replace function public\.media_asset_has_valid_links/);
  assert.match(migration, /l\.entity_type='marketplace_dispute' and l\.slot='buyer_evidence'/);
  assert.match(migration, /exists\([\s\S]*marketplace_order_disputes d where d\.id=l\.entity_id/);
});
