import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMarketplaceCartItem } from "../services/marketplaceCart.ts";
import { marketplaceContentTypeForMedia } from "../services/marketplaceCreatorContentTagCore.mjs";
import {
  attemptCreatorContentTagClear,
  attemptCreatorContentTagAuthoritativeDiscard,
  attemptCreatorContentTagSave,
  createPendingCreatorContentTagSave,
} from "../services/marketplaceCreatorContentTagPublishRetry.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260811024000_marketplace_creator_content_product_tags.sql");
const service = read("services/marketplaceCreatorContentTagService.ts");
const upload = read("app/(tabs)/upload.tsx");
const feed = read("app/(tabs)/index.tsx");
const nativeCard = read("components/feature/VideoCard.native.tsx");
const webCard = read("components/feature/VideoCard.tsx");
const selector = read("components/marketplace/CreatorContentProductSelector.tsx");
const sheet = read("components/marketplace/CreatorContentProductSheet.tsx");
const product = read("app/product/[id].tsx");
const checkout = read("app/checkout.tsx");

const base = { productId:"product-a",variantId:"variant-a",sellerId:"seller-a",storeId:"store-a",title:"Product A",sellerUsername:"seller",sku:"A",imageUrl:null,options:[],currency:"BDAG",unitPrice:10,compareAtPrice:null,quantity:1,availableQuantitySnapshot:10,productUpdatedAt:null };

test("B7C schema has one relational content authority, five-tag cap, immutability, and RLS", () => {
  assert.match(sql,/create table public\.marketplace_creator_content_product_tags/);
  assert.match(sql,/content_id uuid not null/);
  assert.match(sql,/video_id uuid references public\.videos\(id\)/);
  assert.match(sql,/marketplace_lock_video_content_delete/);
  assert.match(sql,/content_type text not null check\(content_type in\('feed','reel'\)\)/);
  assert.match(sql,/v_count>5[\s\S]*marketplace_creator_content_tag_limit_reached/);
  assert.match(sql,/marketplace_creator_content_product_tags_guard/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.marketplace_creator_content_product_tags[\s\S]*public,anon,authenticated/);
});

test("B7C widens only source vocabulary and server-derives current offer authority", () => {
  assert.match(sql,/source_surface in\('live','direct_creator_link','creator_showcase','feed','reel'\)/);
  assert.match(sql,/marketplace_resolve_live_affiliate_offer\(v_tag\.product_id,v_tag\.creator_user_id\)/);
  assert.match(sql,/marketplace_create_creator_commerce_attribution_internal\(v_offer\.offer_id/);
  assert.doesNotMatch(service,/p_commission_bps|p_commission_amount|seller_net|platform_fee/);
  assert.doesNotMatch(sql,/p_commission_bps|p_commission_amount/);
});

test("content classifier mirrors unified Feed/Reel media semantics", () => {
  assert.equal(marketplaceContentTypeForMedia("https://x/images/a.jpg"),"feed");
  assert.equal(marketplaceContentTypeForMedia("https://x/videos/a.mp4"),"reel");
  assert.equal(marketplaceContentTypeForMedia("https://videodelivery.net/id/manifest/video.m3u8"),"reel");
  assert.equal(marketplaceContentTypeForMedia("https://x/videos/a.mp4",["a.jpg","b.jpg"]),"feed");
});

test("publish flow exposes one compact selector and saves tags after durable content creation", () => {
  assert.match(upload,/CreatorContentProductSelector/);
  assert.match(upload,/fetchMyCreatorShowcase|selectedProducts/);
  assert.match(selector,/fetchMyCreatorShowcase\(\)/);
  assert.match(selector,/fetchMyCreatorEligibleProducts/);
  assert.match(selector,/selected\.length < 5/);
  assert.match(upload,/saveSelectedProductTags\(published\.postId, 'reel'\)/);
  assert.match(upload,/saveSelectedProductTags\(postId, 'feed'\)/);
  assert.match(upload,/Contenido publicado, productos pendientes/);
  assert.match(upload,/Reintentar productos/);
  assert.match(upload,/Continuar sin productos/);
});

test("publish tag retry preserves the logical command and never republishes media", async () => {
  const product = { productId:"product-a", title:"Product A" };
  const pending = createPendingCreatorContentTagSave({
    contentId:"content-1", contentType:"reel", productIds:["product-a"],
    selectedProducts:[product], idempotencyKey:"stable-key", clearIdempotencyKey:"stable-clear-key",
  });
  let saveCalls = 0, publishCalls = 0;
  const failed = await attemptCreatorContentTagSave(pending, async (command) => {
    saveCalls += 1;
    assert.equal(command.contentId,"content-1");
    assert.equal(command.contentType,"reel");
    assert.deepEqual(command.productIds,["product-a"]);
    assert.equal(command.idempotencyKey,"stable-key");
    throw new Error("transport uncertainty");
  });
  assert.equal(failed.ok,false); assert.equal(failed.pending,pending);
  assert.deepEqual(failed.pending.selectedProducts,[product]);
  const succeeded = await attemptCreatorContentTagSave(failed.pending, async (command) => {
    saveCalls += 1;
    assert.equal(command.contentId,"content-1");
    assert.equal(command.contentType,"reel");
    assert.deepEqual(command.productIds,["product-a"]);
    assert.equal(command.idempotencyKey,"stable-key");
  });
  assert.equal(succeeded.ok,true); assert.equal(succeeded.pending,null);
  assert.equal(saveCalls,2); assert.equal(publishCalls,0);
});

function createTagCommandModel() {
  const commands = new Map();
  const inflight = new Map();
  const server = { products: [] };
  let applications = 0;
  const apply = async (command, beforeCommit) => {
    const fingerprint = `${command.contentType}|${command.contentId}|${command.productIds.join(",")}`;
    const prior = commands.get(command.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("idempotency conflict");
      return prior.result;
    }
    const running = inflight.get(command.idempotencyKey);
    if (running) return running;
    const operation = (async () => {
      await beforeCommit?.();
      server.products = [...command.productIds];
      applications += 1;
      const result = { products: [...server.products] };
      commands.set(command.idempotencyKey, { fingerprint, result });
      return result;
    })();
    inflight.set(command.idempotencyKey, operation);
    try { return await operation; } finally { inflight.delete(command.idempotencyKey); }
  };
  return { apply, commands, server, get applications() { return applications; } };
}

function createPendingFixture() {
  return createPendingCreatorContentTagSave({
    contentId:"content-remote", contentType:"feed", productIds:["p1"],
    selectedProducts:[{ productId:"p1" }], idempotencyKey:"save-key", clearIdempotencyKey:"clear-key",
  });
}

test("authoritative discard fences an in-flight original save before clear", async () => {
  const pending = createPendingFixture();
  const model = createTagCommandModel();
  let releaseOriginal;
  const originalMayCommit = new Promise((resolve) => { releaseOriginal = resolve; });
  let originalStarted;
  const started = new Promise((resolve) => { originalStarted = resolve; });
  let originalServerOperation;
  const uncertainSave = await attemptCreatorContentTagSave(pending, async (command) => {
    originalServerOperation = model.apply(command, async () => { originalStarted(); await originalMayCommit; });
    throw new Error("transport uncertainty while save remains in flight");
  });
  assert.equal(uncertainSave.ok,false);
  await started;
  let discardSettled = false;
  const discardPromise = attemptCreatorContentTagAuthoritativeDiscard(uncertainSave.pending,model.apply)
    .then((result) => { discardSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(discardSettled,false,"clear cannot overtake the in-flight save fence");
  releaseOriginal();
  await originalServerOperation;
  const discarded = await discardPromise;
  assert.equal(discarded.ok,true); assert.equal(discarded.pending,null);
  assert.deepEqual(model.server.products,[]);
  assert.deepEqual([...model.commands.keys()],["save-key","clear-key"]);
});

test("authoritative discard clears a committed save whose response was lost", async () => {
  const pending = createPendingFixture();
  const model = createTagCommandModel();
  const uncertainSave = await attemptCreatorContentTagSave(pending,async (command) => {
    await model.apply(command);
    throw new Error("response lost after save commit");
  });
  assert.equal(uncertainSave.ok,false); assert.deepEqual(model.server.products,["p1"]);
  const discarded = await attemptCreatorContentTagAuthoritativeDiscard(uncertainSave.pending,model.apply);
  assert.equal(discarded.ok,true); assert.deepEqual(model.server.products,[]);
});

test("authoritative discard settles a save that never reached the server before clearing", async () => {
  const pending = createPendingFixture();
  const model = createTagCommandModel();
  const uncertainSave = await attemptCreatorContentTagSave(pending,async () => {
    throw new Error("request failed before server receipt");
  });
  assert.equal(model.commands.size,0);
  const discarded = await attemptCreatorContentTagAuthoritativeDiscard(uncertainSave.pending,model.apply);
  assert.equal(discarded.ok,true); assert.deepEqual(model.server.products,[]);
  assert.deepEqual([...model.commands.keys()],["save-key","clear-key"]);
});

test("lost fence response prevents clear and a stable-key retry finishes empty", async () => {
  const pending = createPendingFixture();
  const model = createTagCommandModel();
  let loseFenceResponse = true;
  const first = await attemptCreatorContentTagAuthoritativeDiscard(pending,async (command) => {
    const result = await model.apply(command);
    if (command.idempotencyKey === "save-key" && loseFenceResponse) {
      loseFenceResponse = false;
      throw new Error("fence response lost");
    }
    return result;
  });
  assert.equal(first.ok,false); assert.equal(first.stage,"save_fence"); assert.equal(first.pending,pending);
  assert.deepEqual(model.server.products,["p1"]); assert.equal(model.commands.has("clear-key"),false);
  const retried = await attemptCreatorContentTagAuthoritativeDiscard(first.pending,model.apply);
  assert.equal(retried.ok,true); assert.deepEqual(model.server.products,[]);
});

test("lost clear response retries both stable keys without reapplying the old save", async () => {
  const pending = createPendingFixture();
  assert.notEqual(pending.idempotencyKey,pending.clearIdempotencyKey);
  const model = createTagCommandModel();
  let publisherCalls = 0;
  let loseClearResponse = true;
  const uncertainClear = await attemptCreatorContentTagAuthoritativeDiscard(pending,async (command) => {
    const result = await model.apply(command);
    if (command.idempotencyKey === "clear-key" && loseClearResponse) {
      loseClearResponse = false;
      throw new Error("clear response lost after commit");
    }
    return result;
  });
  assert.equal(uncertainClear.ok,false); assert.equal(uncertainClear.stage,"clear");
  assert.equal(uncertainClear.pending,pending); assert.deepEqual(model.server.products,[]);
  const confirmedClear = await attemptCreatorContentTagAuthoritativeDiscard(uncertainClear.pending,async (command) => {
    assert.equal(command.contentId,"content-remote"); assert.equal(command.contentType,"feed");
    if (command.idempotencyKey === "save-key") assert.deepEqual(command.productIds,["p1"]);
    else { assert.deepEqual(command.productIds,[]); assert.equal(command.idempotencyKey,"clear-key"); }
    return model.apply(command);
  });
  assert.equal(confirmedClear.ok,true); assert.equal(confirmedClear.pending,null);
  assert.deepEqual(model.server.products,[]); assert.equal(model.applications,2); assert.equal(publisherCalls,0);
});

test("failed discard fence retains pending state and skips clear", async () => {
  const pending = createPendingFixture();
  const calls=[];
  const failed = await attemptCreatorContentTagAuthoritativeDiscard(pending,async (command) => {
    calls.push(command); throw new Error("offline");
  });
  assert.equal(failed.ok,false); assert.equal(failed.stage,"save_fence"); assert.equal(failed.pending,pending);
  assert.equal(calls.length,1); assert.equal(calls[0].idempotencyKey,"save-key");
  assert.deepEqual(calls[0].productIds,["p1"]);
  assert.match(upload,/No pudimos confirmar el estado de los productos/);
});

test("explicit discard authoritatively clears a transport-uncertain save with a distinct stable key", async () => {
  const pending = createPendingCreatorContentTagSave({
    contentId:"content-remote", contentType:"feed", productIds:["p1"],
    selectedProducts:[{ productId:"p1" }], idempotencyKey:"save-key", clearIdempotencyKey:"clear-key",
  });
  assert.notEqual(pending.idempotencyKey,pending.clearIdempotencyKey);
  const commands = new Map(), server = { products:[] }, lost = new Set(["save-key","clear-key"]);
  let publisherCalls = 0;
  const apply = async (command) => {
    const fingerprint = `${command.contentType}|${command.contentId}|${command.productIds.join(",")}`;
    const prior = commands.get(command.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint) throw new Error("idempotency conflict");
    if (!prior) {
      server.products = [...command.productIds];
      commands.set(command.idempotencyKey,{ fingerprint, result:{ products:[...server.products] } });
    }
    if (lost.delete(command.idempotencyKey)) throw new Error("response lost after commit");
    return commands.get(command.idempotencyKey).result;
  };
  const uncertainSave = await attemptCreatorContentTagSave(pending,apply);
  assert.equal(uncertainSave.ok,false); assert.deepEqual(server.products,["p1"]);
  const uncertainClear = await attemptCreatorContentTagClear(uncertainSave.pending,apply);
  assert.equal(uncertainClear.ok,false); assert.equal(uncertainClear.pending,pending); assert.deepEqual(server.products,[]);
  const confirmedClear = await attemptCreatorContentTagClear(uncertainClear.pending,async (command) => {
    assert.equal(command.contentId,"content-remote"); assert.equal(command.contentType,"feed");
    assert.deepEqual(command.productIds,[]); assert.equal(command.idempotencyKey,"clear-key");
    return apply(command);
  });
  assert.equal(confirmedClear.ok,true); assert.equal(confirmedClear.pending,null);
  assert.deepEqual(server.products,[]); assert.equal(publisherCalls,0);
});

test("failed authoritative clear retains pending state and cannot claim completion", async () => {
  const pending = createPendingCreatorContentTagSave({
    contentId:"content-1", contentType:"reel", productIds:["p1"], selectedProducts:[],
    idempotencyKey:"save-key", clearIdempotencyKey:"clear-key",
  });
  const failed = await attemptCreatorContentTagClear(pending,async () => { throw new Error("offline"); });
  assert.equal(failed.ok,false); assert.equal(failed.pending,pending);
  assert.match(upload,/No pudimos confirmar que los productos se eliminaron/);
  assert.match(upload,/if \(result\.ok\)[\s\S]*El contenido continuará sin productos/);
});

test("upload retry is shared by Stream, photo, and carousel and suppresses contradictory success", () => {
  assert.match(upload,/saveSelectedProductTags\(published\.postId, 'reel'\)/);
  assert.match(upload,/postId \? await saveSelectedProductTags\(postId, 'feed'\)/);
  assert.match(upload,/const tagsSaved = await saveSelectedProductTags\(postId, 'feed'\)/);
  assert.equal((upload.match(/if \(!tagsSaved\) return;/g)??[]).length,3);
  assert.match(upload,/executeProductTagSave\(pendingProductTagSave\)/);
  assert.match(upload,/setPendingProductTagSave\(result\.pending\)/);
  assert.match(upload,/attemptCreatorContentTagAuthoritativeDiscard\(pendingProductTagSave/);
  assert.match(upload,/productIds: command\.productIds/);
});

test("Feed batches summaries and native/web cards expose an unobtrusive shopping action", () => {
  assert.match(feed,/for \(let index = 0; index < ids\.length; index \+= 50\)/);
  assert.match(feed,/fetchMarketplaceContentProductTagSummaries\(batch\)/);
  assert.match(feed,/productTagCount=\{productTagCounts\[item\.id\] \?\? 0\}/);
  assert.match(nativeCard,/shopping-outline/);
  assert.match(webCard,/shopping-outline/);
  assert.match(sheet,/fetchMarketplaceContentProductTags/);
});

test("product sheet reuses the canonical product route with non-authoritative content context", () => {
  assert.match(sheet,/pathname: "\/product\/\[id\]"/);
  assert.match(sheet,/contentProductTagId: item\.tagId/);
  assert.match(sheet,/source: item\.contentType/);
  assert.doesNotMatch(sheet,/commissionBps|commissionAmount|commission_amount/);
});

test("product detail creates B7C attribution only inside explicit Add/Buy handler", () => {
  assert.match(product,/createCreatorContentAttribution\(contentProductTagId, selectedVariant\.id, key\)/);
  assert.match(product,/const handleAddToCart = async \(continueToCheckout = false\)/);
  assert.match(product,/handleAddToCart\(true\)/);
  assert.doesNotMatch(product,/useEffect\([\s\S]{0,400}createCreatorContentAttribution/);
  assert.match(product,/showcaseItemId && contentProductTagId[\s\S]*Invalid creator context/);
});

test("Feed/Reel attributed cart lines preserve exact opaque-token semantics", () => {
  const content = { ...base, attributionId:"attr-feed",contentProductTagId:"tag-feed",sourceSurface:"feed",creatorUserId:"creator-x",creatorDisplayName:"creator" };
  const first = addMarketplaceCartItem([],content);
  assert.equal(first.result.ok,true);
  const merged = addMarketplaceCartItem(first.items,{...content,quantity:2});
  assert.equal(merged.result.ok,true); assert.equal(merged.items[0].quantity,3); assert.equal(merged.items[0].attributionId,"attr-feed");
  const conflict = addMarketplaceCartItem(first.items,{...content,attributionId:"attr-new"});
  assert.deepEqual(conflict.result,{ok:false,code:"attribution_conflict"}); assert.equal(conflict.items[0].attributionId,"attr-feed");
  const normalRepeat = addMarketplaceCartItem(first.items,{...base,quantity:2});
  assert.equal(normalRepeat.result.ok,true); assert.equal(normalRepeat.items[0].attributionId,"attr-feed"); assert.equal(normalRepeat.items[0].contentProductTagId,"tag-feed");
});

test("ambiguous or incomplete client creator context is rejected", () => {
  const ambiguous = addMarketplaceCartItem([],{...base,attributionId:"a",showcaseItemId:"s",contentProductTagId:"t",sourceSurface:"feed",creatorUserId:"c"});
  assert.deepEqual(ambiguous.result,{ok:false,code:"invalid_item"});
  const missingSurface = addMarketplaceCartItem([],{...base,attributionId:"a",contentProductTagId:"t",creatorUserId:"c"});
  assert.deepEqual(missingSurface.result,{ok:false,code:"invalid_item"});
});

test("normal Marketplace and B7B Showcase paths remain structurally unchanged", () => {
  const normal = addMarketplaceCartItem([],base);
  assert.equal(normal.result.ok,true); assert.equal(normal.items[0].attributionId,undefined);
  const showcase = addMarketplaceCartItem([],{...base,attributionId:"a",showcaseItemId:"s",creatorUserId:"c"});
  assert.equal(showcase.result.ok,true); assert.equal(showcase.items[0].showcaseItemId,"s");
  assert.match(product,/createCreatorShowcaseAttribution\(showcaseItemId, selectedVariant\.id, key\)/);
});

test("checkout remains surface-agnostic and selects creator-aware reservation by opaque attribution", () => {
  assert.match(checkout,/some\(item=>Boolean\(item\.attributionId\)\)/);
  assert.match(checkout,/hasCreatorAttribution\?createCreatorCheckoutReservation:createCheckoutReservation/);
  assert.doesNotMatch(checkout,/contentProductTagId|showcaseItemId/);
});

test("migration contains real reconciliation queries and no production proof instrumentation", () => {
  assert.equal((sql.match(/'[^']+',\(select count/g)??[]).length,28);
  assert.match(sql,/reconcile_marketplace_creator_content_tags/);
  assert.doesNotMatch(sql,/fixture_ops|test_fail|debug|mock|test guc|failure trigger|special test/i);
  assert.doesNotMatch(sql,/'[^']+',\s*0\b/);
});
