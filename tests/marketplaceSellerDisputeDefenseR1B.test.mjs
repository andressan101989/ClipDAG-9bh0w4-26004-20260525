import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeMarketplaceOrderLifecyclePayload } from "../services/marketplaceFulfillmentParsers.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/20260821020000_marketplace_seller_dispute_defense_r1b.sql");
const edge = await read("supabase/functions/get-media-url/index.ts");
const service = await read("services/marketplaceFulfillmentService.ts");
const panel = await read("components/marketplace/MarketplaceSellerDisputePanel.tsx");
const sellerRoute = await read("app/seller/orders/[id].tsx");
const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

test("R1B adds one seller response authority without reusing review actions", () => {
  assert.match(migration, /create table public\.marketplace_dispute_seller_responses/);
  assert.match(migration, /unique\(dispute_id\)/);
  assert.match(migration, /unique\(seller_id,idempotency_key\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.marketplace_dispute_seller_responses from public,anon,authenticated/);
  assert.doesNotMatch(migration, /insert into public\.marketplace_dispute_review_actions/);
  assert.doesNotMatch(migration, /create table public\.marketplace_dispute_(?:evidence|chat|messages)/);
});

test("seller evidence reuses private dispute media and existing valid-link helper", () => {
  assert.match(migration, /slot='seller_evidence'/);
  assert.match(migration, /l\.slot in \('buyer_evidence','seller_evidence'\)/);
  assert.match(migration, /marketplace_dispute_seller_evidence_position_unique/);
  assert.match(migration, /status='ready'[\s\S]*visibility='private'[\s\S]*media_kind='image'[\s\S]*purpose='dispute_evidence'/);
  assert.match(panel, /uploadMediaFromUri\(\{/);
  assert.match(panel, /purpose: "dispute_evidence"/);
  assert.match(panel, /visibility: "private"/);
  assert.match(panel, /MAX_EVIDENCE_IMAGES = 6/);
  assert.doesNotMatch(panel, /public_url|AsyncStorage|base64/);
});

test("response RPC authorizes the exact seller and preserves pre-settlement scope", () => {
  assert.match(migration, /create function public\.respond_to_marketplace_dispute\([\s\S]*p_dispute_id uuid[\s\S]*p_seller_note text[\s\S]*p_evidence_asset_ids uuid\[\][\s\S]*p_idempotency_key uuid/);
  assert.match(migration, /security definer[\s\S]*set search_path=public/);
  assert.match(migration, /v_dispute\.seller_id<>auth\.uid\(\)/);
  assert.match(migration, /v_dispute\.status not in \('open','under_review'\)/);
  assert.match(migration, /marketplace_order_settlements where order_id=v_dispute\.order_id[\s\S]*marketplace_dispute_settlement_completed/);
  assert.match(migration, /v_note is null and v_evidence_count=0/);
  assert.match(migration, /v_evidence_count not between 0 and 6/);
  assert.match(migration, /owner_id=auth\.uid\(\)/);
});

test("response is one-shot and idempotent without changing dispute outcome or money", () => {
  assert.match(migration, /where seller_id=auth\.uid\(\) and idempotency_key=p_idempotency_key/);
  assert.match(migration, /marketplace_dispute_response_idempotency_conflict/);
  assert.match(migration, /marketplace_dispute_response_already_submitted/);
  assert.match(migration, /insert into public\.marketplace_dispute_seller_responses/);
  assert.doesNotMatch(migration, /update public\.marketplace_order_disputes|insert into public\.marketplace_dispute_decisions/);
  assert.doesNotMatch(migration, /ledger_debit|ledger_credit|atomic_ledger_transfer|insert into public\.marketplace_order_settlements|update public\.marketplace_payment/);
});

test("private signer allows only the dispute seller to read linked buyer evidence", () => {
  assert.match(edge, /asset\.owner_id!==user\.id|a\.owner_id!==user\.id/);
  assert.match(edge, /entity_type','marketplace_dispute'/);
  assert.match(edge, /slot','buyer_evidence'/);
  assert.match(edge, /marketplace_order_disputes/);
  assert.match(edge, /seller_id',userId/);
  assert.match(edge, /return corsJson\(\{error:'forbidden'\},403\)/);
  assert.match(edge, /a\.visibility==='public'\?publicUrl[\s\S]*signGet/);
  assert.doesNotMatch(edge, /seller_evidence.*seller_id|expiresAt.*86400/);
});

test("lifecycle returns immutable case data and seller response through the existing authority", () => {
  assert.match(migration, /create or replace function public\.fetch_my_marketplace_order_lifecycle\(p_order_id uuid\)/);
  for (const token of ["affected_item_ids", "buyer_evidence_asset_ids", "seller_response", "evidence_asset_ids"]) assert.match(migration, new RegExp(`'${token}'`));
  assert.match(migration, /case when auth\.uid\(\)=o\.seller_id/);
  assert.doesNotMatch(migration, /get_seller_dispute_detail|marketplace_seller_dispute_case/);
});

test("lifecycle parser validates UUID arrays, ordering bounds, and seller response", () => {
  const detail = { dispute: null };
  const payload = {
    shipping_amount: 0,
    shipping: null,
    shipping_snapshot: null,
    dispute: {
      id: uuid(1), status: "open", reason_code: "damaged", buyer_note: "Llegó roto",
      created_at: "2026-08-21T12:00:00.000Z", outcome: null,
      affected_item_ids: [uuid(2)], buyer_evidence_asset_ids: [uuid(3)],
      seller_response: { id: uuid(4), note: "El paquete salió intacto", created_at: "2026-08-21T13:00:00.000Z", evidence_asset_ids: [uuid(5)] },
    },
  };
  const parsed = mergeMarketplaceOrderLifecyclePayload(detail, payload);
  assert.deepEqual(parsed.dispute.affectedItemIds, [uuid(2)]);
  assert.deepEqual(parsed.dispute.buyerEvidenceAssetIds, [uuid(3)]);
  assert.deepEqual(parsed.dispute.sellerResponse.evidenceAssetIds, [uuid(5)]);
  assert.throws(() => mergeMarketplaceOrderLifecyclePayload(detail, { ...payload, dispute: { ...payload.dispute, affected_item_ids: [uuid(2), uuid(2)] } }), /affected_item_ids/);
  assert.throws(() => mergeMarketplaceOrderLifecyclePayload(detail, { ...payload, dispute: { ...payload.dispute, buyer_evidence_asset_ids: ["bad"] } }), /buyer_evidence_asset_ids/);
});

test("seller route reuses canonical order detail and provides the full defense flow", () => {
  assert.match(sellerRoute, /fetchSellerOrder/);
  assert.match(sellerRoute, /MarketplaceSellerDisputePanel order=\{data\}/);
  assert.match(panel, /dispute\.affectedItemIds\.includes\(item\.id\)/);
  assert.match(panel, /marketplaceDisputeReasonLabel/);
  assert.match(panel, /dispute\.buyerNote/);
  assert.match(panel, /getMediaUrl\(assetId\)/);
  assert.match(panel, /Explica tu versión de lo ocurrido/);
  assert.match(panel, /respondToMarketplaceDispute/);
  assert.match(panel, /RESPUESTA ENVIADA/);
});

test("client reconciliation keeps a stable key and never deletes ambiguous evidence", () => {
  assert.match(panel, /idempotencyKey = useRef\(randomUUID\(\)\)/);
  assert.match(service, /respond_to_marketplace_dispute/);
  assert.match(service, /fetchSellerOrder\(orderId\)/);
  assert.match(service, /sameOrderedValues\(response\.evidenceAssetIds, evidenceAssetIds\)/);
  assert.match(panel, /outcomeUnknown[\s\S]*if \(!outcomeUnknown && uploadedNow\.length > 0\)/);
  assert.doesNotMatch(panel, /refund|release funds|liberar fondos|aprobar devolución/i);
});

test("seller response notes use one surrounding-whitespace normalization contract", () => {
  const normalizeInput = (value) => value.trim();
  const normalizeReadback = (value) => value?.trim() || null;
  const notesMatch = (submitted, stored) =>
    normalizeReadback(stored) === (normalizeInput(submitted) || null);

  assert.equal(normalizeInput("Respuesta del vendedor\n"), "Respuesta del vendedor");
  assert.equal(normalizeInput("  Respuesta del vendedor  "), "Respuesta del vendedor");
  assert.equal(normalizeInput("Producto  correcto"), "Producto  correcto");
  assert.equal(notesMatch("Respuesta del vendedor", "Respuesta del vendedor\n"), true);
  assert.equal(notesMatch("Respuesta del vendedor", "  Respuesta del vendedor  "), true);
  assert.equal(notesMatch("Producto correcto", "Producto incorrecto"), false);

  assert.match(service, /const normalizedNote = note\.trim\(\);/);
  assert.match(service, /const expectedNote = normalizedNote \|\| null;/);
  assert.match(service, /p_seller_note: normalizedNote/);
  assert.match(service, /\(response\.note\?\.trim\(\) \|\| null\) === expectedNote/);
  assert.doesNotMatch(service, /p_seller_note: note,/);
  assert.match(service, /marketplace_dispute_response_idempotency_conflict/);
  assert.doesNotMatch(service, /replace\(\/\\s\+\/|toLowerCase\(\)/);
});
