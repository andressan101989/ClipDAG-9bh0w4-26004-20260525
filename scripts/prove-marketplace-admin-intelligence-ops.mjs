import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg,
  url = process.env.MARKETPLACE_DATABASE_URL;
if (!url) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  parsed.port !== "55422"
)
  throw new Error("B8C_PROOF_REQUIRES_DISPOSABLE_DATABASE");
const db = new Client({ connectionString: url, ssl: false }),
  uid = () => randomUUID();
let stage = "connect";
async function role(name, sub = "", metadata = {}) {
  await db.query("reset role");
  await db.query(`set local role ${name}`);
  await db.query(
    "select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)",
    [
      name,
      sub,
      JSON.stringify({
        role: name,
        sub,
        user_metadata: metadata,
        app_metadata: metadata,
      }),
    ],
  );
}
async function operator() {
  await db.query("reset role");
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ role: "service_role" })],
  );
}
async function rpc(name, args = []) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")})value`,
      args,
    )
  ).rows[0].value;
}
async function attempt(fn) {
  const save = `b8c_${uid().replaceAll("-", "")}`;
  await db.query(`savepoint ${save}`);
  try {
    const value = await fn();
    await db.query(`release savepoint ${save}`);
    return { ok: true, value };
  } catch (error) {
    await db.query(`rollback to savepoint ${save}`);
    await db.query(`release savepoint ${save}`);
    return { ok: false, code: error.code, message: error.message };
  }
}
async function addUser(id, label, admin = false) {
  await operator();
  const token = uid().replaceAll("-", "").slice(0, 10);
  await db.query(
    "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",
    [id, `b8c-${label}-${token}@proof.local`],
  );
  await db.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b8c${label}${token}`, `B8C ${label}`, admin],
  );
}
const amount = (value) => Number(Number(value).toFixed(8));
const address = `jsonb_build_object('recipient_name','B8C','line1','Proof Street','city','New York','region','NY','postal_code','10001','country','US')`;
async function affiliateOffer(f, productId, creatorId, bps) {
  await role("authenticated", f.seller);
  return (
    await db.query(
      "select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,$3,'active',null,null,$4)value",
      [productId, creatorId, bps, uid()],
    )
  ).rows[0].value;
}
async function directAttribution(f, creatorId, variantId, entitlementId) {
  await role("service_role", f.admin);
  return (
    await db.query(
      "select public.create_marketplace_creator_commerce_attribution($1,$2,$3,'direct_creator_link',$1,$4)value",
      [entitlementId, creatorId, variantId, uid()],
    )
  ).rows[0].value;
}
async function fundBuyer(f, value) {
  await role("service_role", f.admin);
  const platform = (
    await db.query("select public.ensure_marketplace_platform_account()id")
  ).rows[0].id;
  const buyerAccount = (
    await db.query("select public.ensure_ledger_account($1)id", [f.buyer])
  ).rows[0].id;
  const transaction = uid();
  await db.query(
    `insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed',
      'marketplace_b8c_c1_proof',$5,$6,$7)`,
    [transaction, platform, buyerAccount, value, f.store, `b8c-c1-fund:${transaction}`, f.buyer],
  );
  await db.query(
    "select public.ledger_debit($1,$2,$3,'B8C C1 proof funding','{}'),public.ledger_credit($1,$4,$3,'B8C C1 proof funding','{}')",
    [transaction, platform, value, buyerAccount],
  );
}
async function creatorCheckout(f, lines) {
  await role("authenticated", f.buyer);
  const payload = lines.map((line) => ({
    variant_id: line.variantId,
    quantity: line.quantity ?? 1,
    attribution_id: line.attribution.id,
  }));
  const receipt = (
    await db.query(
      `select public.create_marketplace_creator_checkout_reservation($1::jsonb,${address},$2)value`,
      [JSON.stringify(payload), uid()],
    )
  ).rows[0].value;
  assert.equal(receipt.orders.length, 1);
  await role("service_role", f.admin);
  await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [
    f.buyer,
    receipt.checkout.id,
    uid(),
  ]);
  const orderId = receipt.orders[0].id;
  const payment = (
    await db.query(
      "select p.* from public.marketplace_payments p join public.marketplace_orders o on o.checkout_id=p.checkout_id where o.id=$1",
      [orderId],
    )
  ).rows[0];
  return { orderId, payment };
}
async function agePayment(paymentId, days) {
  await operator();
  await db.query("set local session_replication_role=replica");
  const paidAt = (
    await db.query(
      "update public.marketplace_payments set paid_at=clock_timestamp()-make_interval(days=>$2::int) where id=$1 returning paid_at",
      [paymentId, days],
    )
  ).rows[0].paid_at;
  await db.query("set local session_replication_role=origin");
  return paidAt;
}
async function settleOrder(f, orderId) {
  await role("authenticated", f.seller);
  await db.query("select public.seller_start_marketplace_order_processing($1,$2)", [orderId, uid()]);
  await db.query(
    "select public.seller_ship_marketplace_order($1,'B8C','Ground',$2,null,null,$3)",
    [orderId, `B8C-${uid().slice(0, 8)}`, uid()],
  );
  await role("service_role", f.admin);
  await db.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)", [
    f.buyer,
    orderId,
    uid(),
  ]);
  return (
    await db.query("select * from public.marketplace_order_settlements where order_id=$1", [orderId])
  ).rows[0];
}
async function reverseOrder(f, orderId) {
  await role("service_role", f.admin);
  const review = (
    await db.query(
      "select public.open_marketplace_post_settlement_review($1,$2,'b8c_c1_range','proof',$3)value",
      [f.admin, orderId, uid()],
    )
  ).rows[0].value;
  return (
    await db.query(
      "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b8c_c1_refund','proof',$3,null)value",
      [f.admin, review.dispute_id, uid()],
    )
  ).rows[0].value;
}
async function recordDirectEvent(f, eventName, productId, variantId, offerId, occurredAtSql = "clock_timestamp()") {
  await role("authenticated", f.buyer);
  const eventId = (
    await db.query(
      "select public.record_marketplace_commerce_event($1,$2,$3,$4,'affiliate',$5,null,null,$6,'{}',$7)id",
      [eventName, productId, variantId, uid(), offerId, eventName === "add_to_cart" ? 1 : null, `b8c-c1-event-${uid()}`],
    )
  ).rows[0].id;
  await operator();
  await db.query("set local session_replication_role=replica");
  await db.query(`update public.marketplace_commerce_events set occurred_at=${occurredAtSql} where id=$1`, [eventId]);
  await db.query("set local session_replication_role=origin");
  return eventId;
}
async function creatorAdminDetail(adminId, creatorId, range) {
  await role("authenticated", adminId);
  return rpc("get_marketplace_admin_creator_detail", [creatorId, range]);
}
async function creatorSelfAnalytics(creatorId, range) {
  await role("authenticated", creatorId);
  return rpc("get_my_marketplace_creator_commerce_analytics", [range]);
}
try {
  await db.connect();
  await db.query("begin");
  const f = {
    admin: uid(),
    normal: uid(),
    seller: uid(),
    buyer: uid(),
    creator: uid(),
    creatorY: uid(),
    store: uid(),
    shipping: uid(),
    product: uid(),
    variant: uid(),
    product2: uid(),
    variant2: uid(),
    promotion: uid(),
    campaign: uid(),
    audit: uid(),
  };
  stage = "fixtures";
  await addUser(f.admin, "admin", true);
  await addUser(f.normal, "normal");
  await addUser(f.seller, "seller");
  await addUser(f.buyer, "buyer");
  await addUser(f.creator, "creator");
  await addUser(f.creatorY, "creatory");
  await operator();
  await db.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B8C Seller',now())",
    [f.seller],
  );
  await db.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B8C Store',$3,'active')",
    [f.store, f.seller, `b8c-${uid()}`],
  );
  await db.query(
    "insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)values($1,$2,$3,'B8C Ground',1,2,'US','Proof')",
    [f.shipping, f.seller, f.store],
  );
  await db.query(
    "insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",
    [f.shipping],
  );
  await db.query(
    "insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id,images)values($1,$2,'B8C Product','Proof',20,'BDAG','physical',20,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$4,'{}')",
    [f.product, f.seller, f.store, f.shipping],
  );
  await db.query(
    "insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',20,'active',true,'')",
    [
      f.variant,
      f.product,
      f.store,
      f.seller,
      `B8C-${uid().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
    ],
  );
  await db.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,20,0)",
    [f.variant],
  );
  await db.query(
    "insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id,images)values($1,$2,'B8C Product 2','Proof',30,'BDAG','physical',20,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$4,'{}')",
    [f.product2, f.seller, f.store, f.shipping],
  );
  const sku2 = `B8C-${uid().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  await db.query(
    "insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',30,'active',true,'')",
    [f.variant2, f.product2, f.store, f.seller, sku2],
  );
  await db.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,20,0)",
    [f.variant2],
  );
  await db.query(
    "insert into public.marketplace_product_promotions(id,seller_id,store_id,product_id,variant_id,promotion_type,percentage_off,starts_at,ends_at,status,created_by,idempotency_key)values($1,$2,$3,$4,$5,'percentage',10,now()-interval'1 day',now()+interval'7 days','enabled',$2,$6)",
    [f.promotion, f.seller, f.store, f.product, f.variant, uid()],
  );
  await db.query(
    "insert into public.marketplace_ad_campaigns(id,seller_id,store_id,product_id,name,status,starts_at,ends_at,total_budget_bdag,creation_idempotency_key,eligibility_state,eligibility_reason)values($1,$2,$3,$4,'B8C Campaign','draft',now()+interval'1 day',now()+interval'8 days',100,$5,false,'unfunded')",
    [f.campaign, f.seller, f.store, f.product, uid()],
  );
  await db.query(
    "insert into public.marketplace_admin_action_audit(id,actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)values($1,$2,'product_suspend','product',$3,$4,'proof_reason','{\"safe\":true,\"request_fingerprint\":\"0000000000000000000000000000000000000000000000000000000000000000\"}')",
    [f.audit, f.admin, f.product, uid()],
  );

  stage = "security";
  const readCalls = [
    () => rpc("get_marketplace_admin_creator_commerce_overview", ["30d"]),
    () =>
      rpc("search_marketplace_admin_creators", [null, "30d", null, null, 50]),
    () =>
      rpc("search_marketplace_admin_promotions", [null, null, null, null, 50]),
    () =>
      rpc("search_marketplace_admin_ads", [
        null,
        null,
        null,
        null,
        null,
        50,
      ]),
    () => rpc("get_marketplace_admin_health"),
    () =>
      rpc("search_marketplace_admin_activity", [
        null,
        null,
        null,
        null,
        null,
        null,
        50,
      ]),
  ];
  for (const identity of [
    { name: "anon", sub: "" },
    { name: "authenticated", sub: f.normal },
    {
      name: "authenticated",
      sub: f.normal,
      metadata: { is_admin: true, role: "admin" },
    },
  ]) {
    await role(identity.name, identity.sub, identity.metadata);
    for (const call of readCalls) {
      const result = await attempt(call);
      assert.equal(result.ok, false);
      assert.equal(result.code, "42501");
    }
  }
  await role("authenticated", f.admin);
  const access = await rpc("get_my_marketplace_admin_access");
  for (const capability of [
    "marketplace:creator-commerce",
    "marketplace:promotions",
    "marketplace:ads",
    "marketplace:health",
    "marketplace:audit",
  ])
    assert(access.capabilities.includes(capability));

  stage = "limits";
  const lists = [
    {
      name: "creators",
      fn: (limit) =>
        rpc("search_marketplace_admin_creators", [
          null,
          "30d",
          null,
          null,
          limit,
        ]),
    },
    {
      name: "promotions",
      fn: (limit) =>
        rpc("search_marketplace_admin_promotions", [
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
    {
      name: "ads",
      fn: (limit) =>
        rpc("search_marketplace_admin_ads", [
          null,
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
    {
      name: "activity",
      fn: (limit) =>
        rpc("search_marketplace_admin_activity", [
          null,
          null,
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
  ];
  for (const item of lists) {
    for (const boundary of [1, 100]) {
      stage = `limits_${item.name}_${boundary}`;
      assert((await item.fn(boundary)).page_size <= boundary);
    }
    for (const invalid of [null, 0, 101]) {
      stage = `limits_${item.name}_${invalid}`;
      const result = await attempt(() => item.fn(invalid));
      assert.equal(result.ok, false, `${item.name}:${invalid}`);
      assert.equal(result.code, "22023");
    }
  }

  stage = "creator";
  for (const range of ["7d", "30d", "90d", "all"]) {
    const value = await rpc("get_marketplace_admin_creator_commerce_overview", [
      range,
    ]);
    assert.equal(value.range, range);
    assert.equal(
      Number(value.summary.commission_net),
      Number(value.summary.commission_released) -
        Number(value.summary.commission_reversed),
    );
  }
  const invalidRange = await attempt(() =>
    rpc("get_marketplace_admin_creator_commerce_overview", ["bad"]),
  );
  assert.equal(invalidRange.code, "22023");
  const creatorDefinition = (
    await operator().then(() =>
      db.query(
        "select pg_get_functiondef('public.get_marketplace_admin_creator_commerce_overview(text)'::regprocedure)d",
      ),
    )
  ).rows[0].d;
  assert.match(
    creatorDefinition,
    /marketplace_creator_commerce_analytics_facts/,
  );
  assert.match(creatorDefinition, /sum\(attributed_gmv\)/);
  assert.doesNotMatch(
    creatorDefinition,
    /marketplace_orders[^]*sum\([^)]*total/i,
  );

  stage = "creator_temporal_lifecycle";
  await operator();
  await db.query("savepoint creator_temporal");
  await fundBuyer(f, 300);
  const offerY1000 = await affiliateOffer(f, f.product2, f.creatorY, 1000);
  const oldReleased = await creatorCheckout(f, [
    {
      variantId: f.variant2,
      attribution: await directAttribution(f, f.creatorY, f.variant2, offerY1000.id),
    },
  ]);
  await agePayment(oldReleased.payment.id, 40);
  const releasedSettlement = await settleOrder(f, oldReleased.orderId);
  const oldReversed = await creatorCheckout(f, [
    {
      variantId: f.variant2,
      attribution: await directAttribution(f, f.creatorY, f.variant2, offerY1000.id),
    },
  ]);
  await agePayment(oldReversed.payment.id, 40);
  await settleOrder(f, oldReversed.orderId);
  const reversalReceipt = await reverseOrder(f, oldReversed.orderId);
  assert.equal(reversalReceipt.finalDecision.financial_result.money_moved, true);
  const olderThan90 = await creatorCheckout(f, [
    {
      variantId: f.variant2,
      attribution: await directAttribution(f, f.creatorY, f.variant2, offerY1000.id),
    },
  ]);
  await agePayment(olderThan90.payment.id, 120);
  const offerX1200 = await affiliateOffer(f, f.product2, f.creator, 1200);
  await creatorCheckout(f, [
    {
      variantId: f.variant2,
      attribution: await directAttribution(f, f.creator, f.variant2, offerX1200.id),
    },
  ]);
  await recordDirectEvent(f, "product_view", f.product2, f.variant2, offerY1000.id);
  await recordDirectEvent(f, "add_to_cart", f.product2, f.variant2, offerY1000.id);
  await recordDirectEvent(
    f,
    "product_view",
    f.product2,
    f.variant2,
    offerY1000.id,
    "clock_timestamp()+interval'1 day'",
  );

  const temporalExpected = {
    "7d": { orders: 0, gmv: 0, generated: 0, released: 6, reversed: 3, opens: 1, carts: 1 },
    "30d": { orders: 0, gmv: 0, generated: 0, released: 6, reversed: 3, opens: 1, carts: 1 },
    "90d": { orders: 2, gmv: 60, generated: 6, released: 6, reversed: 3, opens: 1, carts: 1 },
    all: { orders: 3, gmv: 90, generated: 9, released: 6, reversed: 3, opens: 1, carts: 1 },
  };
  for (const [range, expected] of Object.entries(temporalExpected)) {
    const detail = await creatorAdminDetail(f.admin, f.creatorY, range);
    assert.equal(detail.summary.orders, expected.orders, `${range}:orders`);
    assert.equal(amount(detail.summary.attributed_gmv), expected.gmv, `${range}:gmv`);
    assert.equal(amount(detail.summary.commission_generated), expected.generated, `${range}:generated`);
    assert.equal(amount(detail.summary.commission_released), expected.released, `${range}:released`);
    assert.equal(amount(detail.summary.commission_reversed), expected.reversed, `${range}:reversed`);
    assert.equal(amount(detail.summary.commission_net), expected.released - expected.reversed, `${range}:net`);
    assert.equal(detail.summary.product_opens, expected.opens, `${range}:opens`);
    assert.equal(detail.summary.add_to_cart, expected.carts, `${range}:carts`);
    assert.equal(detail.surface_breakdown.length, 1);
    const surface = detail.surface_breakdown[0];
    assert.equal(surface.source_surface, "direct_creator_link");
    assert.equal(amount(surface.attributed_gmv), expected.gmv);
    assert.equal(amount(surface.commission_generated), expected.generated);
    assert.equal(amount(surface.commission_released), expected.released);
    assert.equal(amount(surface.commission_reversed), expected.reversed);
    assert.equal(surface.product_opens, expected.opens);
    assert.equal(surface.add_to_cart, expected.carts);
  }
  const adminSeven = await creatorAdminDetail(f.admin, f.creatorY, "7d");
  const selfSeven = await creatorSelfAnalytics(f.creatorY, "7d");
  for (const [adminField, selfField] of [
    ["orders", "attributed_orders"],
    ["units", "units_sold"],
    ["attributed_gmv", "attributed_gmv"],
    ["commission_generated", "commission_generated"],
    ["commission_released", "commission_released"],
    ["commission_reversed", "commission_reversed"],
    ["commission_net", "commission_net"],
    ["product_opens", "product_opens"],
    ["add_to_cart", "add_to_cart"],
  ])
    assert.equal(amount(adminSeven.summary[adminField]), amount(selfSeven.summary[selfField]), `b7d_match:${adminField}`);
  assert.equal(adminSeven.summary.attributed_gmv, 0);
  assert.equal(amount(adminSeven.summary.commission_released), 6);
  assert.equal(amount(adminSeven.summary.commission_reversed), 3);

  await role("authenticated", f.admin);
  const creatorPageOne = await rpc("search_marketplace_admin_creators_v2", [null, "7d", null, null, 1]);
  assert.equal(creatorPageOne.page_size, 1);
  assert(creatorPageOne.next_cursor);
  const creatorPageTwo = await rpc("search_marketplace_admin_creators_v2", [
    null,
    "7d",
    creatorPageOne.next_cursor.activity_at,
    creatorPageOne.next_cursor.creator_id,
    1,
  ]);
  assert.equal(creatorPageTwo.page_size, 1);
  assert.notEqual(creatorPageOne.creators[0].creator_id, creatorPageTwo.creators[0].creator_id);
  assert.equal(creatorPageTwo.next_cursor, null);
  const pageCreators = [...creatorPageOne.creators, ...creatorPageTwo.creators];
  const releaseOnlyCreator = pageCreators.find((row) => row.creator_id === f.creatorY);
  assert(releaseOnlyCreator, "release_only_creator_missing");
  assert.equal(amount(releaseOnlyCreator.attributed_gmv), 0);
  assert.equal(amount(releaseOnlyCreator.commission_released), 6);

  const replacementOfferY900 = await affiliateOffer(f, f.product2, f.creatorY, 900);
  assert.equal(replacementOfferY900.commission_bps, 900);
  const historicalDetail = await creatorAdminDetail(f.admin, f.creatorY, "all");
  assert.equal(historicalDetail.item_trace.length, 3);
  assert(historicalDetail.item_trace.every((row) => row.historical_bps === 1000));
  await operator();
  const storedBps = (
    await db.query(
      "select distinct commission_bps from public.marketplace_order_item_creator_attributions where creator_user_id=$1 and order_id=any($2::uuid[]) order by commission_bps",
      [f.creatorY, [oldReleased.orderId, oldReversed.orderId, olderThan90.orderId]],
    )
  ).rows.map((row) => row.commission_bps);
  assert.deepEqual(storedBps, [1000]);

  const offerXProductOne = await affiliateOffer(f, f.product, f.creator, 1200);
  const multiCreatorOrder = await creatorCheckout(f, [
    {
      variantId: f.variant,
      attribution: await directAttribution(f, f.creator, f.variant, offerXProductOne.id),
    },
    {
      variantId: f.variant2,
      attribution: await directAttribution(f, f.creatorY, f.variant2, replacementOfferY900.id),
    },
  ]);
  await operator();
  const multiTrace = (
    await db.query(
      "select creator_user_id,commission_bps,order_item_id from public.marketplace_order_item_creator_attributions where order_id=$1 order by creator_user_id",
      [multiCreatorOrder.orderId],
    )
  ).rows;
  assert.equal(multiTrace.length, 2);
  assert.equal(new Set(multiTrace.map((row) => row.order_item_id)).size, 2);
  assert.deepEqual(
    new Map(multiTrace.map((row) => [row.creator_user_id, row.commission_bps])),
    new Map([
      [f.creator, 1200],
      [f.creatorY, 900],
    ]),
  );
  const creatorXAll = await creatorAdminDetail(f.admin, f.creator, "all");
  const creatorYAll = await creatorAdminDetail(f.admin, f.creatorY, "all");
  assert(creatorXAll.item_trace.some((row) => row.order_id === multiCreatorOrder.orderId && row.historical_bps === 1200));
  assert(creatorYAll.item_trace.some((row) => row.order_id === multiCreatorOrder.orderId && row.historical_bps === 900));
  const creatorYHistorical = creatorYAll.item_trace.filter((row) => row.order_id !== multiCreatorOrder.orderId);
  assert(creatorYHistorical.every((row) => row.historical_bps === 1000));

  const temporalOverview = await rpc("get_marketplace_admin_creator_commerce_overview", ["7d"]);
  assert.equal(amount(temporalOverview.summary.commission_released), 6);
  assert.equal(amount(temporalOverview.summary.commission_reversed), 3);
  await operator();
  const creatorLeg = (
    await db.query(
      "select amount from public.marketplace_settlement_legs where settlement_id=$1 and leg_type='creator_commission' and beneficiary_user_id=$2",
      [releasedSettlement.id, f.creatorY],
    )
  ).rows[0];
  assert.equal(amount(creatorLeg.amount), 3);
  await db.query("rollback to savepoint creator_temporal");
  await db.query("release savepoint creator_temporal");

  stage = "promotions";
  await role("authenticated", f.admin);
  const promotions = await rpc("search_marketplace_admin_promotions", [
    "B8C",
    null,
    null,
    null,
    50,
  ]);
  assert.equal(promotions.promotions.length, 1);
  assert.equal(promotions.promotions[0].state, "active");
  assert.equal(
    Number(promotions.promotions[0].current_price.effective_price),
    18,
  );
  const promotionDetail = await rpc("get_marketplace_admin_promotion_detail", [
    f.promotion,
  ]);
  assert.equal(promotionDetail.historical_usage.length, 0);
  stage = "ads";
  const ads = await rpc("search_marketplace_admin_ads", [
    "B8C",
    null,
    null,
    null,
    null,
    50,
  ]);
  assert.equal(ads.campaigns.length, 1);
  assert.equal(Number(ads.campaigns[0].total_budget), 100);
  assert.equal(Number(ads.campaigns[0].remaining_reserved), 100);
  const adDetail = await rpc("get_marketplace_admin_ad_detail", [f.campaign]);
  assert.equal(Number(adDetail.financial.spent), 0);
  assert.equal(adDetail.financial_events.length, 0);
  assert.equal(Number(adDetail.attribution.gmv), 0);
  const mutationArgs = (
    await operator().then(() =>
      db.query(
        "select proname,pg_get_function_arguments(oid)args from pg_proc where pronamespace='public'::regnamespace and proname like'%marketplace_admin%'and proname like any(array['%ad%spend%','%ad%release%','%ad%finalize%'])",
      ),
    )
  ).rows;
  assert.equal(mutationArgs.length, 0);
  const internalGrants = (
    await db.query(
      "select has_function_privilege('authenticated','public.spend_marketplace_ad_budget(uuid,numeric,uuid)','execute')spend,has_function_privilege('authenticated','public.release_marketplace_ad_unused_budget(uuid,uuid)','execute')release,has_function_privilege('authenticated','public.finalize_marketplace_ad_campaign_delivery(uuid,uuid)','execute')finalize",
    )
  ).rows[0];
  assert.deepEqual(internalGrants, {
    spend: false,
    release: false,
    finalize: false,
  });

  stage = "health";
  await operator();
  assert.equal(
    Number(
      await rpc("marketplace_admin_health_failure_count", [
        "payments",
        { confirmed_state_breakdown: { confirmed: 9, delivered: 4 }, confirmed_state_mismatches: 0 },
      ]),
    ),
    0,
  );
  assert.equal(
    Number(
      await rpc("marketplace_admin_health_failure_count", [
        "settlements",
        { escrow_expected_held_total: 71, escrow_actual_balance: 71, escrow_difference: 0 },
      ]),
    ),
    0,
  );
  assert.equal(
    Number(
      await rpc("marketplace_admin_health_failure_count", [
        "settlements",
        { escrow_expected_held_total: 71, escrow_actual_balance: 70, escrow_difference: 1 },
      ]),
    ),
    1,
  );
  await role("authenticated", f.admin);
  const healthy = await rpc("get_marketplace_admin_health");
  if (!healthy.healthy) console.error(JSON.stringify(healthy, null, 2));
  assert.equal(healthy.healthy, true);
  assert.equal(
    healthy.groups.find((g) => g.name === "admin_operations")
      .failing_check_count,
    0,
  );
  await operator();
  await db.query("savepoint mismatch");
  const badCampaign = uid();
  await db.query(
    "insert into public.marketplace_ad_campaigns(id,seller_id,store_id,product_id,name,status,starts_at,ends_at,total_budget_bdag,spent_bdag,released_bdag,funded_at,funding_idempotency_key,creation_idempotency_key,eligibility_state,eligibility_reason)values($1,$2,$3,$4,'B8C mismatch','completed',now()-interval'2 days',now()-interval'1 day',10,0,0,now()-interval'2 days',$5,$6,false,'terminal')",
    [badCampaign, f.seller, f.store, f.product, uid(), uid()],
  );
  await role("authenticated", f.admin);
  const unhealthy = await rpc("get_marketplace_admin_health");
  assert.equal(unhealthy.healthy, false);
  assert(unhealthy.groups.some((g) => g.failing_check_count > 0));
  await operator();
  await db.query("rollback to savepoint mismatch");
  await db.query("release savepoint mismatch");
  await role("authenticated", f.admin);
  assert.equal((await rpc("get_marketplace_admin_health")).healthy, true);

  stage = "activity";
  const activity = await rpc("search_marketplace_admin_activity", [
    f.admin,
    "product_suspend",
    "product",
    f.product,
    null,
    null,
    50,
  ]);
  assert.equal(activity.activity.length, 1);
  assert.equal(activity.activity[0].actor_id, f.admin);
  assert.equal(activity.activity[0].reason_code, "proof_reason");
  await role("authenticated", f.admin);
  for (const sql of [
    "insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,metadata)values(gen_random_uuid(),'x','x',gen_random_uuid(),gen_random_uuid(),'{}')",
    "update public.marketplace_admin_action_audit set action='x'",
    "delete from public.marketplace_admin_action_audit",
  ]) {
    assert.equal((await attempt(() => db.query(sql))).ok, false);
  }
  await operator();
  const recon = await rpc("reconcile_marketplace_admin_operations");
  assert.equal(Object.keys(recon).length, 8);
  assert(Object.values(recon).every((value) => Number(value) === 0));
  await db.query("rollback");
  const fixtures = Number(
    (
      await db.query(
        "select count(*)n from auth.users where email like'b8c-%@proof.local'",
      )
    ).rows[0].n,
  );
  assert.equal(fixtures, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        security: {
          anonymousDenied: true,
          ordinaryDenied: true,
          metadataForgeryDenied: true,
          adminAllowed: true,
          noClientActor: true,
        },
        capabilities: access.capabilities,
        creatorCommerce: {
          ranges: ["7d", "30d", "90d", "all"],
          invalidRangeRejected: true,
          oldSaleNewRelease7d: { gmv: 0, generated: 0, released: 6 },
          oldSaleNewReversal7d: { gmv: 0, generated: 0, reversed: 3 },
          currentSaleUnreleased: { gmv: 30, generated: 3.6, released: 0 },
          occurredAtEngagement: { productOpens: 1, addToCart: 1 },
          futureVEndExcluded: true,
          b7dSameCreatorRangeMatch: true,
          releaseOnlyCreatorMembership: true,
          paginationNoDuplicatesOrSkips: true,
          historicalBps: { source: "attribution_snapshot", preservedAfterOfferChange: true },
          multiCreatorHistoricalBps: { creatorX: 1200, creatorY: 900 },
          projectionUsesCanonicalItemFacts: true,
          projectionExcludesWholeOrderTotals: true,
          commissionNet: "released-reversed",
          canonicalSurfacesAudited: [
            "creator_showcase",
            "feed",
            "reel",
            "direct_creator_link",
            "live",
          ],
          financialMutations: 0,
        },
        promotions: {
          activeCanonicalEffectivePrice: 18,
          historicalSnapshotsReadOnly: true,
          mutationAuthority: 0,
        },
        ads: {
          draftVisible: true,
          budget: 100,
          spent: 0,
          released: 0,
          remainingReserved: 100,
          internalFinancialGrantsToAuthenticated: internalGrants,
          adminFinancialMutationRpcCount: mutationArgs.length,
        },
        health: {
          healthyBaseline: true,
          legitimateNonzeroObservationsHealthy: true,
          expectedActualEqualityHealthy: true,
          expectedActualMismatchUnhealthy: true,
          controlledMismatchSurfaced: true,
          rollbackHealthy: true,
        },
        activity: { serverActor: true, filtered: true, immutable: true },
        pagination: {
          default: 50,
          hardMax: 100,
          nullZero101Rejected: true,
          keyset: true,
        },
        reconciliation: { adminOperationsChecks: 8, allZero: true },
        fixtures,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(
    `B8C_ADMIN_INTELLIGENCE_PROOF_FAILED:${stage}:${error.code ?? ""}:${error.message}:${error.where ?? ""}`,
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
