import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const sql=read("supabase/migrations/20260811025000_marketplace_creator_commerce_analytics.sql"),service=read("services/marketplaceCreatorAnalyticsService.ts"),screen=read("app/creator-commerce-analytics.tsx"),showcase=read("app/creator-showcase.tsx"),product=read("app/product/[id].tsx"),proof=read("scripts/prove-marketplace-creator-analytics.mjs");

test("B7D is read-only analytics over canonical creator commerce facts",()=>{
  assert.match(sql,/marketplace_creator_commerce_analytics_facts/);assert.match(sql,/marketplace_order_item_creator_attributions/);assert.match(sql,/marketplace_order_item_creator_allocations/);assert.match(sql,/marketplace_settlement_legs/);assert.match(sql,/marketplace_settlement_reversal_legs/);
  assert.doesNotMatch(sql,/insert into public\.(marketplace_order_item_creator|marketplace_settlement|financial_transactions|ledger)/i);assert.doesNotMatch(sql,/commission_base_amount\s*\*|commission_bps\s*\//i);
});

test("creator analytics RPC is self-only, server-ranged, and distinguishes generated, released and reversed",()=>{
  assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/p_range not in\('7d','30d','90d','all'\)/);assert.doesNotMatch(sql,/p_creator_user_id/);assert.match(sql,/commission_generated/);assert.match(sql,/commission_released/);assert.match(sql,/commission_reversed/);assert.match(sql,/commission_net/);assert.match(sql,/revoke all on function public\.get_my_marketplace_creator_commerce_analytics\(text\) from public,anon/);
});

test("top funnel creator identity is resolved from canonical source entities",()=>{
  assert.match(sql,/marketplace_creator_showcase_items/);assert.match(sql,/marketplace_creator_content_product_tags/);assert.match(sql,/live_session_products/);assert.match(sql,/marketplace_live_affiliate_offers/);assert.doesNotMatch(sql,/e\.source_creator_id/);assert.match(product,/source: showcaseItemId \? "creator" : source/);assert.match(product,/sourceId:\s*sourceId\s*\?\?\s*showcaseItemId\s*\?\?\s*contentProductTagId/);
});

test("service delegates one typed range to one private RPC without financial calculations",()=>{
  assert.match(service,/"7d" \| "30d" \| "90d" \| "all"/);assert.match(service,/get_my_marketplace_creator_commerce_analytics/);assert.match(service,/p_range: range/);assert.doesNotMatch(service,/creatorUserId|creator_user_id|commission_bps|\*\s*commission|\/\s*10000/);
});

test("creator analytics experience provides private KPIs, ranges, breakdowns and native states",()=>{
  for(const text of ["Ventas atribuidas","Pedidos","Unidades","Comisión neta","Comisión generada","Comisión liberada","Comisión revertida","Por superficie","Productos principales","Aún no tienes ventas atribuidas","Reintentar"])assert.match(screen,new RegExp(text));
  assert.match(screen,/7D/);assert.match(screen,/30D/);assert.match(screen,/90D/);assert.match(screen,/Todo/);assert.match(screen,/RefreshControl/);assert.match(showcase,/creator-commerce-analytics/);assert.match(showcase,/chart-line/);
});

test("runtime proof exercises every canonical financial surface through its real authority",()=>{
  assert.match(proof,/add_my_marketplace_creator_showcase_product/);
  assert.match(proof,/create_marketplace_creator_showcase_attribution/);
  assert.match(proof,/create_marketplace_creator_content_attribution/);
  assert.match(proof,/create_marketplace_creator_commerce_attribution[\s\S]*direct_creator_link/);
  assert.match(proof,/start_live_session/);
  assert.match(proof,/pin_live_session_product/);
  assert.match(proof,/create_live_marketplace_checkout_reservation/);
  for(const surface of ["creator_showcase","feed","reel","direct_creator_link","live"]){
    assert.match(proof,new RegExp(`surface: "${surface}"`));
    assert.match(proof,new RegExp(`${surface}: \\{ financial: true`));
  }
  assert.match(proof,/assertSnapshot\(showcaseOrder\.order/);
  assert.match(proof,/assertSnapshot\(liveOrder\.order/);
  assert.match(proof,/assertSnapshot\(directOrder\.order/);
});

test("runtime proof asserts exact surface economics and server-resolved engagement isolation",()=>{
  assert.match(proof,/function assertSurfaceBreakdown/);
  for(const field of ["orders","units_sold","attributed_gmv","commission_generated","commission_released","commission_reversed","commission_net","product_opens","add_to_cart"])
    assert.match(proof,new RegExp(field));
  assert.match(proof,/surface_sum_/);
  assert.match(proof,/sortedByGmv: true/);
  assert.match(proof,/sourceType, sourceId/);
  assert.match(proof,/publicOfferPassiveExcluded: true/);
  assert.match(proof,/event_only_/);
  assert.match(proof,/surfaceMismatch/);
  assert.match(proof,/poisonExcluded: true/);
});

test("runtime proof distinguishes every range and compares exact daily and monthly trend values",()=>{
  assert.match(proof,/agePayment\(liveOrder\.payment, 120\)/);
  assert.match(proof,/olderThan90Days/);
  assert.match(proof,/all_not_broader_than_90d/);
  assert.match(proof,/eventRangesExact: true/);
  assert.match(proof,/function assertExactTrend/);
  for(const field of ["bucket","orders","attributed_gmv","commission_generated","commission_released","commission_reversed","commission_net"])
    assert.match(proof,new RegExp(`entry\\.${field}|${field}:`));
  assert.match(proof,/bucketFor\(paidAt\.live, "all"\)/);
  assert.match(proof,/same_order_counted_twice_in_trend/);
  assert.match(proof,/duplicateOrderProtected: true/);
});

test("proof retains multi-creator, mixed, history, reversal, insufficiency, privacy and reconciliation",()=>{
  for(const marker of ["multiCreator","sameCreatorMultipleItems","mixedOrder","offerHistory","heldGeneratedNotReleased","moneyMoved: false","poisonExcluded","count: 18"])
    assert.match(proof,new RegExp(marker));
  assert.match(proof,/seller: 78/);assert.match(proof,/platform: 10/);assert.match(proof,/creatorX: 5/);assert.match(proof,/creatorY: 7/);assert.match(proof,/gross: 100/);
  assert.match(proof,/gross_refund_amount\), 100/);
  assert.match(proof,/Object\.keys\(reconciliation\)\.length, 18/);
  assert.match(proof,/assert\.equal\(fixtures, 0\)/);
});
