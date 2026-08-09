import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import test from'node:test';
import{marketplaceAnalyticsAppliedQuantity,marketplaceCheckoutAnalyticsTargets,parseMarketplaceAnalyticsSource}from'../services/marketplaceAnalyticsCore.mjs';

const migration=readFileSync('supabase/migrations/20260808170000_marketplace_commerce_analytics_foundation.sql','utf8');
const anonymous=readFileSync('supabase/migrations/20260808171000_marketplace_analytics_anonymous_sessions.sql','utf8');
const variants=readFileSync('supabase/migrations/20260808172000_marketplace_variant_analytics_projection.sql','utf8');
const corrective=readFileSync('supabase/migrations/20260809120000_harden_marketplace_analytics_semantics.sql','utf8');
const service=readFileSync('services/marketplaceAnalyticsService.ts','utf8');
const detail=readFileSync('app/product/[id].tsx','utf8');
const checkout=readFileSync('app/checkout.tsx','utf8');
const shop=readFileSync('app/(tabs)/shop.tsx','utf8');

test('source parser allows only controlled taxonomy and UUID context',()=>{
 const uuid='123e4567-e89b-42d3-a456-426614174000';
 assert.deepEqual(parseMarketplaceAnalyticsSource({type:'live',entityId:uuid,liveSessionId:uuid}),{type:'live',entityId:uuid,creatorId:null,liveSessionId:uuid});
 assert.deepEqual(parseMarketplaceAnalyticsSource({type:'paid_ad',entityId:'bad'}),{type:'unknown',entityId:null,creatorId:null,liveSessionId:null});
});
test('cart analytics uses applied rather than requested quantity',()=>{
 assert.equal(marketplaceAnalyticsAppliedQuantity({ok:true,status:'added'},2),2);
 assert.equal(marketplaceAnalyticsAppliedQuantity({ok:true,status:'quantity_adjusted',applied:3},5),3);
 assert.equal(marketplaceAnalyticsAppliedQuantity({ok:false},5),null);
});
test('checkout targets one observable journey per seller and no unavailable item',()=>{
 const items=[{availability:'available',sellerId:'a',productId:'p1'},{availability:'available',sellerId:'a',productId:'p2'},{availability:'available',sellerId:'b',productId:'p3'},{availability:'unavailable',sellerId:'c',productId:'p4'}];
 assert.deepEqual(marketplaceCheckoutAnalyticsTargets(items),[{sellerId:'a',productId:'p1'},{sellerId:'b',productId:'p3'}]);
});
test('client event RPC rejects purchase authority and bounds metadata',()=>{
 assert.match(migration,/p_event_name not in\('product_view','product_media_view','variant_selected','add_to_cart','checkout_started'\)/);
 assert.match(migration,/pg_column_size\(p_metadata\)>2048/);
 assert.match(migration,/marketplace_analytics_variant_invalid/);
});
test('raw events are append-only private and versioned',()=>{
 assert.match(migration,/event_version smallint not null default 1/);assert.match(migration,/enable row level security/);assert.match(migration,/revoke all on public\.marketplace_commerce_events from public,anon,authenticated/);assert.match(migration,/before update or delete/);
});
test('purchase observer is confirmed-transition server-only and exception safe',()=>{
 assert.match(migration,/old\.status='pending_payment' and new\.status='confirmed'/);assert.match(migration,/item\.line_total/);assert.match(migration,/exception when others then/);assert.match(migration,/return new/);assert.match(migration,/marketplace_commerce_purchase_item_unique/);
});
test('seller read model is owner scoped UTC and zero denominator safe',()=>{
 assert.match(migration,/seller_id=actor/);assert.match(migration,/at time zone 'UTC'/);assert.match(migration,/case when s\.views=0 then 0/);assert.match(migration,/gross_merchandise_bdag/);
});
test('variant performance uses seller scope and captured purchase values',()=>{
 assert.match(variants,/e\.seller_id=actor/);assert.match(variants,/sum\(e\.quantity\)/);assert.match(variants,/sum\(e\.gross_merchandise_bdag\)/);assert.match(variants,/group by e\.product_id,e\.variant_id/);
});
test('anonymous sessions are privacy safe and duplicate proof',()=>{
 assert.match(anonymous,/client_session_id,event_name,idempotency_key/);assert.match(anonymous,/grant execute.+to anon/s);assert.doesNotMatch(service,/device|advertising|walletconnect|phone|email/i);
 assert.match(corrective,/actor is null and p_client_session_id is null/);assert.match(corrective,/marketplace_analytics_session_required/);assert.match(corrective,/on conflict do nothing returning id into event_id/);assert.match(corrective,/client_session_id=p_client_session_id and event_name=p_event_name and idempotency_key=p_idempotency_key/);assert.doesNotMatch(corrective,/do update set/);
});
test('server metadata allowlists reject arbitrary keys and bound typed values',()=>{
 assert.match(corrective,/jsonb_object_keys\(p_metadata\).+not in\('media_kind','media_position'\)/s);assert.match(corrective,/not in\('item_count','store_count'\)/);assert.match(corrective,/p_metadata<>'\{\}'::jsonb/);assert.match(corrective,/media_position.+>20/s);assert.match(corrective,/item_count.+between 1 and 1000/s);assert.match(corrective,/marketplace_analytics_metadata_invalid/);
});
test('seller contracts distinguish orders, purchase items, and event activity rates',()=>{
 assert.match(corrective,/count\(distinct order_id\)filter\(where event_name='purchase_completed'\) orders/);assert.match(corrective,/purchase_items/);assert.match(corrective,/purchase_orders/);assert.match(corrective,/view_to_cart_event_rate/);assert.match(corrective,/view_to_purchase_event_rate/);assert.doesNotMatch(corrective,/'conversion_view_to_/);assert.match(corrective,/not user\/session cohort conversion/);
});
test('product detail records view once, intentional variant, and successful cart only',()=>{
 assert.match(detail,/viewRecordedRef\.current===detail\.product\.id/);assert.match(detail,/recordProductView/);assert.match(detail,/selectedValues\[optionId\]===valueId\)return/);assert.match(detail,/recordVariantSelected/);assert.match(detail,/if\(!result\.ok\)/);assert.match(detail,/recordAddToCart/);
});
test('media view records only an intentional gallery change',()=>{
 assert.match(detail,/index===mediaIndex/);assert.match(detail,/recordProductMediaView/);assert.match(detail,/media_kind:gallery\[index\]\.kind,media_position:index/);assert.match(detail,/onSelect=\{chooseMedia\}/);
});
test('checkout starts once without address metadata',()=>{
 assert.match(checkout,/analyticsRecordedRef\.current/);assert.match(checkout,/item_count:availableItems\.length,store_count:targets\.length/);assert.doesNotMatch(service,/postal_code|recipient_name|shipping_address/);
});
test('analytics client failures are catch-and-continue',()=>{
 assert.match(service,/catch\(error\)/);assert.match(service,/event_record_failed/);assert.match(service,/return false/);assert.match(detail,/void recordAddToCart/);assert.match(checkout,/void recordCheckoutStarted/);
});
test('only the currently provable shop navigation source is propagated',()=>{
 assert.match(shop,/params:\s*\{\s*id:\s*p\.id,\s*source:\s*'shop'/);assert.match(service,/MARKETPLACE_ANALYTICS_SOURCES|parseMarketplaceAnalyticsSource/);
});
