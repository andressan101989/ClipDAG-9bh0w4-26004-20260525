import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MARKETPLACE_DATABASE_URL;
if (!connectionString) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(connectionString);
if (![
  "127.0.0.1",
  "localhost",
].includes(parsed.hostname) || parsed.port !== "55422") throw new Error("B7D_PROOF_REQUIRES_DISPOSABLE_DATABASE");

const db = new Client({ connectionString, ssl: false });
const uid = () => randomUUID();
const number = (value) => Number(value);
const rounded = (value) => Number(number(value).toFixed(8));
let stage = "connect";

async function claim(role, sub = "") {
  await db.query(
    "select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)",
    [role, sub],
  );
}

async function user(id, label, admin = false) {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await db.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
    [id, `b7d-${label}-${token}@proof.local`],
  );
  await db.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b7d${label}${token}`, `B7D ${label}`, admin],
  );
}

async function fixture() {
  const f = {
    seller: uid(), buyer: uid(), admin: uid(), creatorX: uid(), creatorY: uid(), outsider: uid(),
    store: uid(), shipping: uid(), products: [], variants: [],
  };
  await user(f.seller, "seller");
  await user(f.buyer, "buyer");
  await user(f.admin, "admin", true);
  await user(f.creatorX, "creatorx");
  await user(f.creatorY, "creatory");
  await user(f.outsider, "outsider");
  await db.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7D Seller',now())",
    [f.seller],
  );
  await db.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7D Store',$3,'active')",
    [f.store, f.seller, `b7d-${uid()}`],
  );
  await db.query(
    `insert into public.marketplace_shipping_profiles(
       id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7D Ground',1,2,'US','B7D proof')`,
    [f.shipping, f.seller, f.store],
  );
  await db.query(
    "insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",
    [f.shipping],
  );
  return f;
}

async function product(f, price, label) {
  const item = { product: uid(), variant: uid(), price, label };
  const sku = `B7D-${uid().replaceAll("-", "").toUpperCase()}`;
  await db.query(
    `insert into public.products(
       id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,
       product_type,moderation_status,published_at,shipping_profile_id,images)
     values($1,$2,$3,'Analytics proof',$4,'BDAG','physical',50,'active',$5,
       '10000000-0000-4000-8000-000000000002','physical','approved',now(),$6,$7)`,
    [item.product, f.seller, `B7D ${label}`, price, f.store, f.shipping, [`https://proof.local/${label}.jpg`]],
  );
  await db.query(
    `insert into public.marketplace_product_variants(
       id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,
    [item.variant, item.product, f.store, f.seller, sku, price],
  );
  await db.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,50,0)",
    [item.variant],
  );
  f.products.push(item.product);
  f.variants.push(item.variant);
  return item;
}

async function offer(f, item, creator, bps) {
  await claim("authenticated", f.seller);
  return (await db.query(
    "select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,$3,'active',null,null,$4)value",
    [item.product, creator, bps, uid()],
  )).rows[0].value;
}

async function publicOffer(f, item, bps) {
  await claim("authenticated", f.seller);
  return (await db.query(
    "select public.upsert_my_live_affiliate_offer($1,'public_creator',null,$2,'active',null,null,$3)value",
    [item.product, bps, uid()],
  )).rows[0].value;
}

async function content(creator, type, label) {
  await claim("authenticated", creator);
  const id = uid();
  await db.query(
    "insert into public.videos(id,user_id,video_url,caption,media_urls)values($1,$2,$3,$4,$5)",
    [
      id,
      creator,
      type === "reel" ? `https://proof.local/${label}.mp4` : `https://proof.local/${label}.jpg`,
      `B7D ${label}`,
      type === "feed" ? [`https://proof.local/${label}.jpg`] : null,
    ],
  );
  return id;
}

async function tags(creator, type, contentId, products) {
  await claim("authenticated", creator);
  return (await db.query(
    "select public.set_my_marketplace_content_product_tags($1,$2,$3,$4)value",
    [type, contentId, products, uid()],
  )).rows[0].value;
}

async function contentAttribution(buyer, tag, variant, key = uid()) {
  await claim("authenticated", buyer);
  return (await db.query(
    "select public.create_marketplace_creator_content_attribution($1,$2,$3)value",
    [tag, variant, key],
  )).rows[0].value;
}

async function showcaseAttribution(f, creator, item) {
  await claim("authenticated", creator);
  const showcase = (await db.query(
    "select public.add_my_marketplace_creator_showcase_product($1,$2)value",
    [item.product, uid()],
  )).rows[0].value;
  await claim("authenticated", f.buyer);
  const attribution = (await db.query(
    "select public.create_marketplace_creator_showcase_attribution($1,$2,$3)value",
    [showcase.id, item.variant, uid()],
  )).rows[0].value;
  return { showcase, attribution };
}

async function directAttribution(f, creator, item, entitlement) {
  await claim("service_role", f.admin);
  return (await db.query(
    `select public.create_marketplace_creator_commerce_attribution(
       $1,$2,$3,'direct_creator_link',$1,$4)value`,
    [entitlement.id, creator, item.variant, uid()],
  )).rows[0].value;
}

async function fund(f, amount) {
  await claim("service_role", f.admin);
  const platform = (await db.query("select public.ensure_marketplace_platform_account()id")).rows[0].id;
  const buyerAccount = (await db.query("select public.ensure_ledger_account($1)id", [f.buyer])).rows[0].id;
  const transaction = uid();
  await db.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
       reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed',
       'marketplace_b7d_proof',$5,$6,$7)`,
    [transaction, platform, buyerAccount, amount, f.store, `b7d-fund:${transaction}`, f.buyer],
  );
  await db.query(
    "select public.ledger_debit($1,$2,$3,'B7D proof funding','{}'),public.ledger_credit($1,$4,$3,'B7D proof funding','{}')",
    [transaction, platform, amount, buyerAccount],
  );
  return { platform, buyerAccount };
}

const address = `jsonb_build_object('recipient_name','B7D','line1','Proof Street','city','New York',
  'region','NY','postal_code','10001','country','US')`;

async function paymentForOrder(order) {
  return (await db.query(
    "select p.* from public.marketplace_payments p join public.marketplace_orders o on o.checkout_id=p.checkout_id where o.id=$1",
    [order],
  )).rows[0];
}

async function checkout(f, lines) {
  await claim("authenticated", f.buyer);
  const payload = lines.map((line) => ({
    variant_id: line.item.variant,
    quantity: line.quantity ?? 1,
    ...(line.attribution ? { attribution_id: line.attribution.id } : {}),
  }));
  const receipt = (await db.query(
    `select public.create_marketplace_creator_checkout_reservation($1::jsonb,${address},$2)value`,
    [JSON.stringify(payload), uid()],
  )).rows[0].value;
  assert.equal(receipt.orders.length, 1, "same_store_order_split");
  const order = receipt.orders[0].id;
  await claim("service_role", f.admin);
  await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [f.buyer, receipt.checkout.id, uid()]);
  return { order, checkout: receipt.checkout.id, payment: await paymentForOrder(order) };
}

async function liveCheckout(f, creator, item, entitlement) {
  const session = uid();
  await claim("authenticated", creator);
  await db.query("select * from public.start_live_session($1,'B7D LIVE analytics proof')", [session]);
  const pin = (await db.query(
    "select public.pin_live_session_product($1,$2,$3,$4)value",
    [session, item.product, item.variant, uid()],
  )).rows[0].value;
  await claim("authenticated", f.buyer);
  const receipt = (await db.query(
    `select public.create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)value`,
    [session, pin.id, item.variant, uid()],
  )).rows[0].value;
  const order = receipt.orders[0].id;
  await claim("service_role", f.admin);
  await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [f.buyer, receipt.checkout.id, uid()]);
  const snapshot = await creatorSnapshot(order, creator);
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].entitlement_id, entitlement.id);
  return { order, checkout: receipt.checkout.id, payment: await paymentForOrder(order), pin, session };
}

async function settle(f, order) {
  await claim("authenticated", f.seller);
  await db.query("select public.seller_start_marketplace_order_processing($1,$2)", [order, uid()]);
  await db.query(
    "select public.seller_ship_marketplace_order($1,'B7D','Ground',$2,null,null,$3)",
    [order, `B7D-${uid().slice(0, 8)}`, uid()],
  );
  await claim("service_role", f.admin);
  await db.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)", [f.buyer, order, uid()]);
  return (await db.query("select * from public.marketplace_order_settlements where order_id=$1", [order])).rows[0];
}

async function analytics(creator, range = "all") {
  await claim("authenticated", creator);
  return (await db.query(
    "select public.get_my_marketplace_creator_commerce_analytics($1)value",
    [range],
  )).rows[0].value;
}

async function reverse(f, order) {
  await claim("service_role", f.admin);
  const review = (await db.query(
    "select public.open_marketplace_post_settlement_review($1,$2,'b7d_analytics','proof',$3)value",
    [f.admin, order, uid()],
  )).rows[0].value;
  return (await db.query(
    "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7d_full_refund','proof',$3,null)value",
    [f.admin, review.dispute_id, uid()],
  )).rows[0].value;
}

async function creatorSnapshot(order, creator) {
  return (await db.query(
    `select s.source_surface,s.source_entity_id,s.entitlement_id,s.creator_user_id,s.product_id,
      i.quantity,a.commission_base_amount attributed_gmv,a.commission_amount commission_generated
     from public.marketplace_order_item_creator_attributions s
     join public.marketplace_order_items i on i.id=s.order_item_id
     join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id
     where s.order_id=$1 and s.creator_user_id=$2 order by s.order_item_id`,
    [order, creator],
  )).rows;
}

async function assertSnapshot(order, creator, expected) {
  const rows = await creatorSnapshot(order, creator);
  assert.equal(rows.length, expected.length);
  for (const wanted of expected) {
    const actual = rows.find((row) => row.product_id === wanted.product);
    assert(actual, `snapshot_product_missing_${wanted.product}`);
    assert.equal(actual.source_surface, wanted.surface);
    assert.equal(actual.source_entity_id, wanted.sourceId);
    assert.equal(actual.creator_user_id, creator);
    assert.equal(actual.product_id, wanted.product);
    assert.equal(number(actual.quantity), wanted.units);
    assert.equal(number(actual.attributed_gmv), wanted.gmv);
    assert.equal(number(actual.commission_generated), wanted.generated);
  }
  return rows;
}

async function agePayment(payment, days) {
  await db.query("set local session_replication_role=replica");
  const paidAt = (await db.query(
    "update public.marketplace_payments set paid_at=clock_timestamp()-make_interval(days=>$2::int) where id=$1 returning paid_at",
    [payment.id, days],
  )).rows[0].paid_at;
  await db.query("set local session_replication_role=origin");
  return paidAt;
}

async function recordEvent(f, eventName, item, sourceType, sourceId, days, quantity = null) {
  await claim("authenticated", f.buyer);
  const id = (await db.query(
    `select public.record_marketplace_commerce_event(
       $1,$2,$3,$4,$5,$6,null,null,$7,'{}',$8)id`,
    [eventName, item.product, item.variant, uid(), sourceType, sourceId, quantity, `b7d-event-${uid()}`],
  )).rows[0].id;
  await db.query("set local session_replication_role=replica");
  const occurredAt = (await db.query(
    "update public.marketplace_commerce_events set occurred_at=clock_timestamp()-make_interval(days=>$2::int) where id=$1 returning occurred_at",
    [id, days],
  )).rows[0].occurred_at;
  await db.query("set local session_replication_role=origin");
  return { id, occurredAt };
}

async function deleteEvents(ids) {
  await db.query("set local session_replication_role=replica");
  await db.query("delete from public.marketplace_commerce_events where id=any($1::uuid[])", [ids]);
  await db.query("set local session_replication_role=origin");
}

function surfaceMap(payload) {
  return new Map(payload.surface_breakdown.map((row) => [row.source_surface, row]));
}

function assertSurfaceBreakdown(payload, expected) {
  const actual = surfaceMap(payload);
  assert.deepEqual([...actual.keys()].sort(), Object.keys(expected).sort());
  for (const [surface, values] of Object.entries(expected)) {
    const row = actual.get(surface);
    assert(row, `missing_surface_${surface}`);
    for (const [field, value] of Object.entries(values)) assert.equal(number(row[field]), value, `${surface}_${field}`);
  }
  const financialFields = ["attributed_gmv", "commission_generated", "commission_released", "commission_reversed", "commission_net"];
  for (const field of financialFields) {
    assert.equal(rounded([...actual.values()].reduce((sum, row) => sum + number(row[field]), 0)), number(payload.summary[field]), `surface_sum_${field}`);
  }
  assert.equal([...actual.values()].reduce((sum, row) => sum + number(row.units_sold), 0), number(payload.summary.units_sold));
  assert.equal([...actual.values()].reduce((sum, row) => sum + number(row.orders), 0), number(payload.summary.attributed_orders));
  const expectedOrder = Object.entries(expected)
    .sort((left, right) => right[1].attributed_gmv - left[1].attributed_gmv || left[0].localeCompare(right[0]))
    .map(([surface]) => surface);
  assert.deepEqual(payload.surface_breakdown.map((row) => row.source_surface), expectedOrder);
}

function assertSummary(payload, expected) {
  for (const [field, value] of Object.entries(expected)) assert.equal(number(payload.summary[field]), value, `${payload.range}_${field}`);
}

const rangeDays = { "7d": 7, "30d": 30, "90d": 90 };
function bucketFor(timestamp, range) {
  const iso = new Date(timestamp).toISOString();
  return range === "all" ? iso.slice(0, 7) : iso.slice(0, 10);
}

function expectedTrend(payload, entries) {
  const end = new Date(payload.generated_at).getTime();
  const start = payload.range === "all" ? Number.NEGATIVE_INFINITY : end - rangeDays[payload.range] * 86_400_000;
  const buckets = new Map();
  for (const entry of entries) {
    const when = new Date(entry.at).getTime();
    if (when < start || when >= end) continue;
    const key = bucketFor(entry.at, payload.range);
    if (!buckets.has(key)) buckets.set(key, { bucket: key, orderIds: new Set(), attributed_gmv: 0, commission_generated: 0, commission_released: 0, commission_reversed: 0 });
    const bucket = buckets.get(key);
    if (entry.order) bucket.orderIds.add(entry.order);
    bucket.attributed_gmv += entry.gmv ?? 0;
    bucket.commission_generated += entry.generated ?? 0;
    bucket.commission_released += entry.released ?? 0;
    bucket.commission_reversed += entry.reversed ?? 0;
  }
  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((entry) => ({
    bucket: entry.bucket,
    orders: entry.orderIds.size,
    attributed_gmv: rounded(entry.attributed_gmv),
    commission_generated: rounded(entry.commission_generated),
    commission_released: rounded(entry.commission_released),
    commission_reversed: rounded(entry.commission_reversed),
    commission_net: rounded(entry.commission_released - entry.commission_reversed),
  }));
}

function assertExactTrend(payload, entries) {
  const actual = payload.trend.map((entry) => ({
    bucket: entry.bucket,
    orders: number(entry.orders),
    attributed_gmv: number(entry.attributed_gmv),
    commission_generated: number(entry.commission_generated),
    commission_released: number(entry.commission_released),
    commission_reversed: number(entry.commission_reversed),
    commission_net: number(entry.commission_net),
  }));
  assert.deepEqual(actual, expectedTrend(payload, entries), `${payload.range}_exact_trend`);
}

try {
  await db.connect();
  await db.query("begin");
  stage = "fixture";
  const f = await fixture();
  await fund(f, 1000);

  const feedItem = await product(f, 50, "Feed");
  const yReelItem = await product(f, 50, "YReel");
  const xReelItem = await product(f, 20, "XReel");
  const showcaseItem = await product(f, 40, "Showcase");
  const directItem = await product(f, 30, "Direct");
  const liveItem = await product(f, 100, "Live");
  const multiA = await product(f, 10, "MultiA");
  const multiB = await product(f, 20, "MultiB");
  const normal = await product(f, 20, "Normal");
  const publicLinkItem = await product(f, 25, "PublicLink");

  await offer(f, feedItem, f.creatorX, 1000);
  await offer(f, yReelItem, f.creatorY, 1400);
  await offer(f, xReelItem, f.creatorX, 1000);
  await offer(f, showcaseItem, f.creatorX, 1000);
  const directOffer = await offer(f, directItem, f.creatorX, 1000);
  const liveOffer = await offer(f, liveItem, f.creatorX, 1200);
  await offer(f, multiA, f.creatorX, 1000);
  await offer(f, multiB, f.creatorX, 1000);
  const nonCanonicalPublicOffer = await publicOffer(f, publicLinkItem, 500);

  const feedContent = await content(f.creatorX, "feed", "feed");
  const yReelContent = await content(f.creatorY, "reel", "y-reel");
  const xReelContent = await content(f.creatorX, "reel", "x-reel");
  const multiContent = await content(f.creatorX, "feed", "multi");
  const feedTags = await tags(f.creatorX, "feed", feedContent, [feedItem.product]);
  const yReelTags = await tags(f.creatorY, "reel", yReelContent, [yReelItem.product]);
  const xReelTags = await tags(f.creatorX, "reel", xReelContent, [xReelItem.product]);
  const multiTags = await tags(f.creatorX, "feed", multiContent, [multiA.product, multiB.product]);

  const feedAttribution = await contentAttribution(f.buyer, feedTags.items[0].id, feedItem.variant);
  const yReelAttribution = await contentAttribution(f.buyer, yReelTags.items[0].id, yReelItem.variant);
  const xReelAttribution = await contentAttribution(f.buyer, xReelTags.items[0].id, xReelItem.variant);
  const multiAttributionA = await contentAttribution(f.buyer, multiTags.items[0].id, multiA.variant);
  const multiAttributionB = await contentAttribution(f.buyer, multiTags.items[1].id, multiB.variant);
  const showcase = await showcaseAttribution(f, f.creatorX, showcaseItem);
  const direct = await directAttribution(f, f.creatorX, directItem, directOffer);

  stage = "canonical_surface_sales";
  const cross = await checkout(f, [
    { item: feedItem, attribution: feedAttribution },
    { item: yReelItem, attribution: yReelAttribution },
  ]);
  const xReel = await checkout(f, [{ item: xReelItem, attribution: xReelAttribution }]);
  const multiple = await checkout(f, [
    { item: multiA, attribution: multiAttributionA },
    { item: multiB, attribution: multiAttributionB },
  ]);
  const showcaseOrder = await checkout(f, [{ item: showcaseItem, attribution: showcase.attribution }]);
  const mixed = await checkout(f, [
    { item: multiA, attribution: await contentAttribution(f.buyer, multiTags.items[0].id, multiA.variant) },
    { item: normal },
  ]);
  const directOrder = await checkout(f, [{ item: directItem, attribution: direct }]);
  const liveOrder = await liveCheckout(f, f.creatorX, liveItem, liveOffer);

  const crossAllocation = (await db.query(
    "select * from public.marketplace_payment_allocations where order_id=$1",
    [cross.order],
  )).rows[0];
  assert.equal(number(crossAllocation.gross_amount), 100);
  assert.equal(number(crossAllocation.seller_net_amount), 78);
  assert.equal(number(crossAllocation.platform_fee_amount), 10);
  assert.equal(number(crossAllocation.creator_commission_amount), 12);

  await assertSnapshot(cross.order, f.creatorX, [{
    surface: "feed", sourceId: feedTags.items[0].id, product: feedItem.product, units: 1, gmv: 50, generated: 5,
  }]);
  await assertSnapshot(cross.order, f.creatorY, [{
    surface: "reel", sourceId: yReelTags.items[0].id, product: yReelItem.product, units: 1, gmv: 50, generated: 7,
  }]);
  await assertSnapshot(xReel.order, f.creatorX, [{
    surface: "reel", sourceId: xReelTags.items[0].id, product: xReelItem.product, units: 1, gmv: 20, generated: 2,
  }]);
  await assertSnapshot(showcaseOrder.order, f.creatorX, [{
    surface: "creator_showcase", sourceId: showcase.showcase.id, product: showcaseItem.product, units: 1, gmv: 40, generated: 4,
  }]);
  await assertSnapshot(directOrder.order, f.creatorX, [{
    surface: "direct_creator_link", sourceId: directOffer.id, product: directItem.product, units: 1, gmv: 30, generated: 3,
  }]);
  await assertSnapshot(liveOrder.order, f.creatorX, [{
    surface: "live", sourceId: liveOrder.pin.id, product: liveItem.product, units: 1, gmv: 100, generated: 12,
  }]);
  await assertSnapshot(multiple.order, f.creatorX, [
    { surface: "feed", sourceId: multiTags.items[0].id, product: multiA.product, units: 1, gmv: 10, generated: 1 },
    { surface: "feed", sourceId: multiTags.items[1].id, product: multiB.product, units: 1, gmv: 20, generated: 2 },
  ]);
  await assertSnapshot(mixed.order, f.creatorX, [
    { surface: "feed", sourceId: multiTags.items[0].id, product: multiA.product, units: 1, gmv: 10, generated: 1 },
  ]);

  const paidAt = {
    cross: await agePayment(cross.payment, 1),
    xReel: await agePayment(xReel.payment, 2),
    showcase: await agePayment(showcaseOrder.payment, 15),
    multiple: await agePayment(multiple.payment, 20),
    direct: await agePayment(directOrder.payment, 45),
    mixed: await agePayment(mixed.payment, 60),
    live: await agePayment(liveOrder.payment, 120),
  };

  stage = "top_funnel_surfaces_and_ranges";
  const canonicalEvents = [];
  const addPair = async (item, sourceType, sourceId, days) => {
    canonicalEvents.push(await recordEvent(f, "product_view", item, sourceType, sourceId, days));
    canonicalEvents.push(await recordEvent(f, "add_to_cart", item, sourceType, sourceId, days, 1));
  };
  await addPair(showcaseItem, "creator", showcase.showcase.id, 1);
  await addPair(directItem, "affiliate", directOffer.id, 2);
  await addPair(feedItem, "feed", feedTags.items[0].id, 15);
  await addPair(xReelItem, "clip", xReelTags.items[0].id, 45);
  await addPair(liveItem, "live", liveOrder.pin.id, 120);
  await addPair(yReelItem, "clip", yReelTags.items[0].id, 1);

  const beforeObservation = await analytics(f.creatorX, "all");
  await recordEvent(f, "product_view", showcaseItem, "creator", showcase.showcase.id, 1);
  const afterObservation = await analytics(f.creatorX, "all");
  for (const field of ["attributed_orders", "units_sold", "attributed_gmv", "commission_generated"])
    assert.equal(number(afterObservation.summary[field]), number(beforeObservation.summary[field]), `event_only_${field}`);
  assert.equal(afterObservation.summary.product_opens, beforeObservation.summary.product_opens + 1);

  const poison = await recordEvent(f, "product_view", yReelItem, "feed", feedTags.items[0].id, 1);
  const surfaceMismatch = await recordEvent(f, "product_view", feedItem, "clip", feedTags.items[0].id, 1);
  await recordEvent(f, "product_view", publicLinkItem, "affiliate", nonCanonicalPublicOffer.id, 1);
  const isolated = await analytics(f.creatorX, "all");
  assert.equal(isolated.summary.product_opens, afterObservation.summary.product_opens);
  assert.equal(isolated.summary.attributed_orders, afterObservation.summary.attributed_orders);
  await deleteEvents([poison.id, surfaceMismatch.id]);

  stage = "offer_history_release_reversal";
  const replacementOffer = await offer(f, feedItem, f.creatorX, 900);
  const replacement = await contentAttribution(f.buyer, feedTags.items[0].id, feedItem.variant);
  assert.equal(replacement.entitlement_id, replacementOffer.id);
  assert.equal(replacement.commission_bps, 900);
  const crossSettlement = await settle(f, cross.order);
  const crossLegs = (await db.query(
    "select leg_type,beneficiary_user_id,amount from public.marketplace_settlement_legs where settlement_id=$1",
    [crossSettlement.id],
  )).rows;
  assert.equal(number(crossLegs.find((leg) => leg.leg_type === "creator_commission" && leg.beneficiary_user_id === f.creatorX).amount), 5);
  assert.equal(number(crossLegs.find((leg) => leg.leg_type === "creator_commission" && leg.beneficiary_user_id === f.creatorY).amount), 7);
  const reversed = await reverse(f, cross.order);
  assert.equal(reversed.finalDecision.financial_result.money_moved, true);
  assert.equal(number(reversed.finalDecision.financial_result.gross_refund_amount), 100);
  const reversalRow = (await db.query(
    "select created_at from public.marketplace_settlement_reversals where order_id=$1",
    [cross.order],
  )).rows[0];

  const multipleSettlement = await settle(f, multiple.order);
  await claim("service_role", f.admin);
  const creatorAccount = (await db.query(
    "select id from public.ledger_accounts where owner_id=$1 and account_type='user'and currency='BDAG'",
    [f.creatorX],
  )).rows[0].id;
  const platform = (await db.query("select public.ensure_marketplace_platform_account()id")).rows[0].id;
  const drain = uid();
  await db.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
       reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed',
       'marketplace_b7d_proof',$4,$5,$6)`,
    [drain, creatorAccount, platform, multiple.order, `b7d-drain:${drain}`, f.admin],
  );
  await db.query(
    "select public.ledger_debit($1,$2,1,'B7D insufficient','{}'),public.ledger_credit($1,$3,1,'B7D insufficient','{}')",
    [drain, creatorAccount, platform],
  );
  const review = (await db.query(
    "select public.open_marketplace_post_settlement_review($1,$2,'b7d_insufficient','proof',$3)value",
    [f.admin, multiple.order, uid()],
  )).rows[0].value;
  const insufficient = (await db.query(
    "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7d_insufficient','proof',$3,null)value",
    [f.admin, review.dispute_id, uid()],
  )).rows[0].value;
  assert.equal(insufficient.money_moved, false);
  assert.equal((await db.query(
    "select count(*)::int n from public.marketplace_settlement_reversals where order_id=$1",
    [multiple.order],
  )).rows[0].n, 0);
  assert.equal((await db.query(
    "select commission_released from public.marketplace_creator_commerce_analytics_facts where order_id=$1",
    [mixed.order],
  )).rows.every((row) => number(row.commission_released) === 0), true);

  stage = "exact_analytics_payload";
  const xRanges = {
    "7d": await analytics(f.creatorX, "7d"),
    "30d": await analytics(f.creatorX, "30d"),
    "90d": await analytics(f.creatorX, "90d"),
    all: await analytics(f.creatorX, "all"),
  };
  const expectedRanges = {
    "7d": { product_opens: 3, add_to_cart: 2, attributed_orders: 2, units_sold: 2, attributed_gmv: 70, commission_generated: 7, commission_released: 8, commission_reversed: 5, commission_net: 3 },
    "30d": { product_opens: 4, add_to_cart: 3, attributed_orders: 4, units_sold: 5, attributed_gmv: 140, commission_generated: 14, commission_released: 8, commission_reversed: 5, commission_net: 3 },
    "90d": { product_opens: 5, add_to_cart: 4, attributed_orders: 6, units_sold: 7, attributed_gmv: 180, commission_generated: 18, commission_released: 8, commission_reversed: 5, commission_net: 3 },
    all: { product_opens: 6, add_to_cart: 5, attributed_orders: 7, units_sold: 8, attributed_gmv: 280, commission_generated: 30, commission_released: 8, commission_reversed: 5, commission_net: 3 },
  };
  for (const [range, expected] of Object.entries(expectedRanges)) assertSummary(xRanges[range], expected);
  assert(xRanges.all.summary.attributed_orders > xRanges["90d"].summary.attributed_orders, "all_not_broader_than_90d");

  const expectedSurfaces = {
    live: { product_opens: 1, add_to_cart: 1, orders: 1, units_sold: 1, attributed_gmv: 100, commission_generated: 12, commission_released: 0, commission_reversed: 0, commission_net: 0 },
    feed: { product_opens: 1, add_to_cart: 1, orders: 3, units_sold: 4, attributed_gmv: 90, commission_generated: 9, commission_released: 8, commission_reversed: 5, commission_net: 3 },
    creator_showcase: { product_opens: 2, add_to_cart: 1, orders: 1, units_sold: 1, attributed_gmv: 40, commission_generated: 4, commission_released: 0, commission_reversed: 0, commission_net: 0 },
    direct_creator_link: { product_opens: 1, add_to_cart: 1, orders: 1, units_sold: 1, attributed_gmv: 30, commission_generated: 3, commission_released: 0, commission_reversed: 0, commission_net: 0 },
    reel: { product_opens: 1, add_to_cart: 1, orders: 1, units_sold: 1, attributed_gmv: 20, commission_generated: 2, commission_released: 0, commission_reversed: 0, commission_net: 0 },
  };
  assertSurfaceBreakdown(xRanges.all, expectedSurfaces);
  const showcaseProduct = xRanges.all.top_products.find((row) => row.product_id === showcaseItem.product);
  assert(showcaseProduct, "showcase_product_missing");
  for (const [field, value] of Object.entries({ orders: 1, units_sold: 1, attributed_gmv: 40, commission_generated: 4, product_opens: 2, add_to_cart: 1 }))
    assert.equal(number(showcaseProduct[field]), value, `showcase_product_${field}`);

  const yAll = await analytics(f.creatorY, "all");
  assertSummary(yAll, { product_opens: 1, add_to_cart: 1, attributed_orders: 1, units_sold: 1, attributed_gmv: 50, commission_generated: 7, commission_released: 7, commission_reversed: 7, commission_net: 0 });
  assertSurfaceBreakdown(yAll, {
    reel: { product_opens: 1, add_to_cart: 1, orders: 1, units_sold: 1, attributed_gmv: 50, commission_generated: 7, commission_released: 7, commission_reversed: 7, commission_net: 0 },
  });

  const trendEntries = [
    { at: paidAt.cross, order: cross.order, gmv: 50, generated: 5 },
    { at: paidAt.xReel, order: xReel.order, gmv: 20, generated: 2 },
    { at: paidAt.showcase, order: showcaseOrder.order, gmv: 40, generated: 4 },
    { at: paidAt.multiple, order: multiple.order, gmv: 10, generated: 1 },
    { at: paidAt.multiple, order: multiple.order, gmv: 20, generated: 2 },
    { at: paidAt.direct, order: directOrder.order, gmv: 30, generated: 3 },
    { at: paidAt.mixed, order: mixed.order, gmv: 10, generated: 1 },
    { at: paidAt.live, order: liveOrder.order, gmv: 100, generated: 12 },
    { at: crossSettlement.released_at, released: 5 },
    { at: multipleSettlement.released_at, released: 3 },
    { at: reversalRow.created_at, reversed: 5 },
  ];
  for (const payload of Object.values(xRanges)) assertExactTrend(payload, trendEntries);
  const duplicateBucket = xRanges["30d"].trend.find((row) => row.bucket === bucketFor(paidAt.multiple, "30d"));
  assert(duplicateBucket, "same_creator_multi_item_bucket_missing");
  assert.equal(number(duplicateBucket.orders), 1, "same_order_counted_twice_in_trend");
  assert.equal(number(duplicateBucket.attributed_gmv), 30);
  assert.equal(number(duplicateBucket.commission_generated), 3);
  const oldMonth = bucketFor(paidAt.live, "all");
  const oldBucket = xRanges.all.trend.find((row) => row.bucket === oldMonth);
  assert(oldBucket, "older_than_90_days_month_missing");
  assert.equal(number(oldBucket.orders), 1);
  assert.equal(number(oldBucket.attributed_gmv), 100);
  assert.equal(number(oldBucket.commission_generated), 12);

  assert.equal(number(xRanges.all.summary.commission_generated), 30, "offer_history_recomputed");
  assert.equal(number(xRanges.all.summary.commission_reversed), 5);
  assert.equal(number(xRanges.all.summary.commission_net), 3);

  stage = "security_reconciliation_cleanup";
  await claim("anon");
  await db.query("savepoint b7d_anon");
  let denied = false;
  try {
    await db.query("select public.get_my_marketplace_creator_commerce_analytics('30d')");
  } catch (error) {
    denied = error.code === "42501";
  }
  await db.query("rollback to savepoint b7d_anon");
  await db.query("release savepoint b7d_anon");
  assert.equal(denied, true);
  const zero = await analytics(f.outsider);
  assert.equal(zero.summary.attributed_orders, 0);
  assert.equal(number(zero.summary.commission_net), 0);

  await claim("service_role", f.admin);
  const reconciliation = (await db.query(
    "select public.reconcile_marketplace_creator_commerce_analytics()value",
  )).rows[0].value;
  assert.equal(Object.keys(reconciliation).length, 18);
  for (const [key, value] of Object.entries(reconciliation)) assert.equal(number(value), 0, key);

  await db.query("rollback");
  const fixtures = (await db.query(
    "select count(*)::int n from auth.users where email like'b7d-%@proof.local'",
  )).rows[0].n;
  assert.equal(fixtures, 0);

  console.log(JSON.stringify({
    ok: true,
    surfaces: {
      creator_showcase: { financial: true, engagement: true, sourceEntityExact: true },
      feed: { financial: true, engagement: true, sourceEntityExact: true },
      reel: { financial: true, engagement: true, sourceEntityExact: true },
      direct_creator_link: { financial: true, specificCreatorEngagement: true, publicOfferPassiveExcluded: true },
      live: { financial: true, engagement: true, existingLiveArchitectureOnly: true },
    },
    surfaceBreakdown: { exact: true, sumsToSummary: true, sortedByGmv: true },
    topFunnel: { isolated: true, poisonExcluded: true, eventOnlyNoFinancialAttribution: true },
    ranges: {
      "7d": expectedRanges["7d"], "30d": expectedRanges["30d"], "90d": expectedRanges["90d"], all: expectedRanges.all,
      olderThan90Days: { includedOnlyInAll: true, attributedGmv: 100, commissionGenerated: 12 },
      eventRangesExact: true,
    },
    trend: { exactDaily: true, exactAllTimeMonthly: true, duplicateOrderProtected: true, releaseAndReversalTimestamps: true },
    metrics: { multiCreator: true, sameCreatorMultipleItems: true, mixedOrder: true, offerHistory: true, heldGeneratedNotReleased: true },
    financial: { seller: 78, platform: 10, creatorX: 5, creatorY: 7, gross: 100, reversal: { creatorX: 5, creatorY: 7, buyer: 100 }, insufficient: { moneyMoved: false, noReversalLegs: true } },
    security: { selfOnly: true, anonDenied: true, creatorIdentityServerDerived: true },
    reconciliation: { count: 18, allZero: true },
    fixtures: 0,
  }, null, 2));
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(`B7D_CREATOR_ANALYTICS_PROOF_FAILED:${stage}:${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
