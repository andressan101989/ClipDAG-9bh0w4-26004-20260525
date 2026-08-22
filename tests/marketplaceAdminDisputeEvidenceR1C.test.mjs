import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/20260822010000_marketplace_admin_dispute_evidence_r1c.sql");
const edge = await read("supabase/functions/get-media-url/index.ts");
const auth = await read("supabase/functions/_shared/mediaAuth.ts");
const api = await read("apps/admin-web/src/lib/adminApi.ts");
const page = await read("apps/admin-web/src/pages/MarketplaceDisputeDetailPage.tsx");

test("R1C extends the existing guarded Admin detail authority only", () => {
  assert.match(migration, /create or replace function public\.get_marketplace_admin_dispute_detail\(p_dispute_id uuid\)/i);
  assert.match(migration, /security definer set search_path=pg_catalog,public/i);
  assert.match(migration, /perform public\.marketplace_require_admin\(\)/i);
  assert.match(migration, /marketplace_dispute_items[\s\S]*marketplace_order_items/i);
  assert.match(migration, /oi\.order_id=d\.order_id/i);
  assert.match(migration, /'buyer_evidence_asset_ids'/i);
  assert.match(migration, /'seller_response'/i);
  assert.match(migration, /order by l\.position/gi);
  assert.doesNotMatch(migration, /create table|alter table|create policy|alter policy/i);
});

test("R1C preserves existing financial, review and resolver contracts", () => {
  for (const field of ["'payment'", "'allocation'", "'settlement'", "'settlement_legs'", "'reversal'", "'reversal_legs'", "'creator_allocations'", "'review_actions'", "'final_decision'", "'timeline'", "'admin_actions'"]) assert.match(migration, new RegExp(field));
  assert.doesNotMatch(migration, /create or replace function public\.(?:admin_resolve_marketplace_dispute|resolve_marketplace_dispute|resolve_marketplace_dispute_held_v1|reverse_marketplace_released_settlement|release_marketplace_order_after_dispute_resolution)/i);
  for (const action of ["manual_review", "refund_buyer", "release_seller", "reject_claim"]) assert.match(page, new RegExp(`value:\"${action}\"`));
  assert.match(page, /resolveDispute/);
});

test("private evidence signer grants only linked dispute evidence to Marketplace Admin", () => {
  assert.match(edge, /adminMayReadDisputeEvidence/);
  assert.match(edge, /entity_type','marketplace_dispute'/);
  assert.match(edge, /\.in\('slot',\['buyer_evidence','seller_evidence'\]\)/);
  assert.match(edge, /caller\.rpc\('get_my_marketplace_admin_access'\)/);
  assert.match(edge, /sellerMayReadBuyerDisputeEvidence/);
  assert.match(edge, /a\.owner_id!==user\.id/);
  assert.match(edge, /signGet\(a\.bucket_name,a\.object_key\)/);
  assert.match(edge, /300_000/);
  assert.doesNotMatch(edge, /service_role.*get_my_marketplace_admin_access/i);
  assert.match(auth, /authenticatedClient/);
});

test("get-media-url supports browser preflight without weakening its POST boundary", () => {
  assert.match(edge, /'Access-Control-Allow-Origin':'\*'/);
  assert.match(edge, /'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'/);
  assert.match(edge, /'Access-Control-Allow-Methods':'POST, OPTIONS'/);
  assert.match(edge, /req\.method==='OPTIONS'[\s\S]*status:204[\s\S]*headers:corsHeaders/);
  assert.match(edge, /req\.method!=='POST'[\s\S]*corsJson\(\{error:'method_not_allowed'\},405\)/);
  for (const status of [401,403,404]) assert.match(edge, new RegExp(`corsJson\\(\\{error:'[^']+'\\},${status}\\)`));
  assert.match(edge, /return corsJson\(\{success:true/);
  assert.doesNotMatch(edge, /mode:\s*["']no-cors|verify_jwt\s*=\s*false/);
});

test("Admin client validates the dossier and reuses get-media-url", () => {
  for (const token of ["affected_items", "buyer_evidence_asset_ids", "seller_response", "evidence_asset_ids"]) assert.match(api, new RegExp(token));
  assert.match(api, /ids\.length>6/);
  assert.match(api, /new Set\(ids\)\.size!==ids\.length/);
  assert.match(api, /supabase\.functions\.invoke\("get-media-url"/);
  assert.match(page, /PRODUCTO\(S\) RECLAMADO\(S\)/);
  assert.match(page, /PRUEBAS DEL COMPRADOR/);
  assert.match(page, /RESPUESTA DEL VENDEDOR/);
  assert.match(page, /Hechos financieros/);
  assert.match(page, /Creator Commerce/);
  assert.doesNotMatch(page, /object_key|bucket_name|asset ID|signed URL/i);
});
