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
  assert.match(sql,/marketplace_creator_showcase_items/);assert.match(sql,/marketplace_creator_content_product_tags/);assert.match(sql,/live_session_products/);assert.match(sql,/marketplace_live_affiliate_offers/);assert.doesNotMatch(sql,/e\.source_creator_id/);assert.match(product,/source: showcaseItemId \? "creator" : source/);assert.match(product,/sourceId: sourceId \?\? showcaseItemId \?\? contentProductTagId/);
});

test("service delegates one typed range to one private RPC without financial calculations",()=>{
  assert.match(service,/"7d" \| "30d" \| "90d" \| "all"/);assert.match(service,/get_my_marketplace_creator_commerce_analytics/);assert.match(service,/p_range: range/);assert.doesNotMatch(service,/creatorUserId|creator_user_id|commission_bps|\*\s*commission|\/\s*10000/);
});

test("creator analytics experience provides private KPIs, ranges, breakdowns and native states",()=>{
  for(const text of ["Ventas atribuidas","Pedidos","Unidades","Comisión neta","Comisión generada","Comisión liberada","Comisión revertida","Por superficie","Productos principales","Aún no tienes ventas atribuidas","Reintentar"])assert.match(screen,new RegExp(text));
  assert.match(screen,/7D/);assert.match(screen,/30D/);assert.match(screen,/90D/);assert.match(screen,/Todo/);assert.match(screen,/RefreshControl/);assert.match(showcase,/creator-commerce-analytics/);assert.match(showcase,/chart-line/);
});

test("proof covers item-level multi-creator, mixed, history, reversal, insufficiency and privacy",()=>{
  for(const marker of ["multiCreator","sameCreatorMultipleItems","mixedOrder","timeRanges","trend","topFunnel","offerHistory","heldGeneratedNotReleased","moneyMoved:false","poisonExcluded","count:18"])assert.match(proof,new RegExp(marker));
  assert.match(proof,/seller:78/);assert.match(proof,/platform:10/);assert.match(proof,/creatorX:5/);assert.match(proof,/creatorY:7/);assert.match(proof,/gross:100/);
});
