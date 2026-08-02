import crypto from "node:crypto";
const PROJECT = "aewwdlvbwpczqyvkwvvj",
  url = `https://${PROJECT}.supabase.co`,
  service = process.env.MKT_A4A_SERVICE_KEY,
  anon = process.env.MKT_A4A_ANON_KEY;
if (process.env.SUPABASE_PROJECT_REF !== PROJECT || !service || !anon)
  throw new Error("linked_project_credentials_required");
const uuid = () => crypto.randomUUID(),
  stamp = Date.now().toString(36),
  password = `A4b-${uuid()}!aA1`,
  assert = (name, value) => {
    if (!value) throw new Error(`assertion_failed:${name}`);
  },
  eq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-8,
  redact = (v) => `${String(v).slice(0, 8)}…`;
async function request(
  path,
  { token = service, method = "GET", body, headers = {} } = {},
) {
  const response = await fetch(url + path, {
      method,
      headers: {
        apikey: token === service ? service : anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok)
    throw Object.assign(new Error(`remote_${response.status}`), {
      status: response.status,
      data,
    });
  return data;
}
const rpc = (name, body = {}, token = service) =>
    request(`/rest/v1/rpc/${name}`, { method: "POST", body, token }),
  insert = (table, body) =>
    request(`/rest/v1/${table}`, {
      method: "POST",
      body,
      headers: { Prefer: "return=representation" },
    }),
  select = (table, q) => request(`/rest/v1/${table}?${q}`),
  edge = (token, body) =>
    request("/functions/v1/bdag-ledger", { method: "POST", token, body });
const denied = async (work) => {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
};
async function user(role) {
  const email = `mkt-a4b-${role}-${stamp}@example.invalid`,
    created = await request("/auth/v1/admin/users", {
      method: "POST",
      body: { email, password, email_confirm: true },
    }),
    login = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      token: anon,
      body: { email, password },
    });
  return { id: created.id, email, token: login.access_token };
}
async function account(userId) {
  return rpc("ensure_ledger_account", { p_user_id: userId });
}
async function balance(id) {
  return Number(
    (await select("ledger_accounts", `select=balance&id=eq.${id}`))[0].balance,
  );
}
async function fund(userId, amount, reference) {
  const destination = await account(userId),
    platform = (
      await select(
        "ledger_accounts",
        "select=id&owner_id=is.null&account_type=eq.platform&currency=eq.BDAG&limit=1",
      )
    )[0].id,
    tx = uuid();
  await insert("financial_transactions", {
    id: tx,
    from_account_id: platform,
    to_account_id: destination,
    operation_type: "marketplace_test_funding",
    amount,
    fee_amount: 0,
    currency: "BDAG",
    status: "completed",
    reference_type: "marketplace_test_fixture",
    reference_id: reference,
    idempotency_key: `a4b-${tx}`,
    initiated_by: userId,
  });
  await rpc("ledger_debit", {
    p_txn_id: tx,
    p_account_id: platform,
    p_amount: amount,
    p_description: "Dedicated MKT-A4B fixture funding",
    p_metadata: { fixture: "mkt-a4b" },
  });
  await rpc("ledger_credit", {
    p_txn_id: tx,
    p_account_id: destination,
    p_amount: amount,
    p_description: "Dedicated MKT-A4B fixture funding",
    p_metadata: { fixture: "mkt-a4b" },
  });
  return destination;
}
async function snapshot(accounts) {
  return {
    buyer: await balance(accounts.buyer),
    escrow: await balance(accounts.escrow),
    sellerA: await balance(accounts.sellerA),
    hostB: await balance(accounts.hostB),
    platform: await balance(accounts.platform),
  };
}
async function buy({ pin, variant, token, session }) {
  const address = {
      recipient_name: "A4B Test Buyer",
      line1: "Dedicated fixture address",
      line2: null,
      city: "Test City",
      region: "Test Region",
      postal_code: "00000",
      country: "US",
      phone: null,
    },
    reservation = await rpc(
      "create_live_marketplace_checkout_reservation",
      {
        p_session_id: session,
        p_live_session_product_id: pin,
        p_variant_id: variant,
        p_quantity: 1,
        p_shipping_address: address,
        p_idempotency_key: uuid(),
      },
      token,
    ),
    checkout = reservation.checkout.id,
    order = reservation.orders[0].id,
    key = uuid(),
    receipt = await edge(token, {
      action: "marketplace_checkout_pay",
      checkout_id: checkout,
      idempotency_key: key,
    }),
    retry = await edge(token, {
      action: "marketplace_checkout_pay",
      checkout_id: checkout,
      idempotency_key: key,
    });
  assert(
    "payment_retry_same",
    JSON.stringify(receipt) === JSON.stringify(retry),
  );
  return { checkout, order, receipt };
}

const fixtureAddress = {
  recipient_name: "A4B Test Buyer",
  line1: "Dedicated fixture address",
  line2: null,
  city: "Test City",
  region: "Test Region",
  postal_code: "00000",
  country: "US",
  phone: null,
};
async function reserve({ pin, variant, token, session, key = uuid() }) {
  const reservation = await rpc(
    "create_live_marketplace_checkout_reservation",
    {
      p_session_id: session,
      p_live_session_product_id: pin,
      p_variant_id: variant,
      p_quantity: 1,
      p_shipping_address: fixtureAddress,
      p_idempotency_key: key,
    },
    token,
  );
  return {
    checkout: reservation.checkout.id,
    order: reservation.orders[0].id,
    reservation,
  };
}
async function payReservation({ checkout, order, token }) {
  const key = uuid();
  const receipt = await edge(token, {
    action: "marketplace_checkout_pay",
    checkout_id: checkout,
    idempotency_key: key,
  });
  const retry = await edge(token, {
    action: "marketplace_checkout_pay",
    checkout_id: checkout,
    idempotency_key: key,
  });
  assert("payment_retry_same", JSON.stringify(receipt) === JSON.stringify(retry));
  return { checkout, order, receipt };
}
async function buyOnce({ pin, variant, token, session }) {
  const pending = await reserve({ pin, variant, token, session });
  await edge(token, {
    action: "marketplace_checkout_pay",
    checkout_id: pending.checkout,
    idempotency_key: uuid(),
  });
  return pending;
}

const sellerA = await user("seller-a"),
  hostB = await user("host-b"),
  buyerC = await user("buyer-c"),
  ids = {
    storeA: uuid(),
    storeB: uuid(),
    productA: uuid(),
    productB: uuid(),
    productC: uuid(),
    productD: uuid(),
    variantA: uuid(),
    variantB: uuid(),
    variantC: uuid(),
    variantD: uuid(),
    session: uuid(),
  };
await request("/rest/v1/user_profiles?on_conflict=id", {
  method: "POST",
  body: [sellerA, hostB, buyerC].map((u, i) => ({
    id: u.id,
    email: u.email,
    username: `a4b_${i}_${stamp}`,
    display_name: ["Seller A", "Creator B", "Buyer C"][i],
  })),
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
});
for (const u of [sellerA, hostB])
  await insert("marketplace_sellers", {
    user_id: u.id,
    status: "approved",
    display_name: u === sellerA ? "Seller A" : "Creator B",
    approved_at: new Date().toISOString(),
  });
await insert("marketplace_stores", [
  {
    id: ids.storeA,
    seller_id: sellerA.id,
    name: "A4B Seller Store",
    slug: `a4b-seller-${stamp}`,
    status: "active",
  },
  {
    id: ids.storeB,
    seller_id: hostB.id,
    name: "A4B Creator Store",
    slug: `a4b-creator-${stamp}`,
    status: "active",
  },
]);
const products = [
  {
    id: ids.productA,
    seller_id: sellerA.id,
    store_id: ids.storeA,
    title: "Affiliate LIVE Product",
    description: "Dedicated fixture",
    price: 1,
    currency: "BDAG",
    category: "physical",
    stock: 5,
    status: "active",
    category_id: "10000000-0000-4000-8000-000000000002",
    product_type: "physical",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
  },
  {
    id: ids.productB,
    seller_id: hostB.id,
    store_id: ids.storeB,
    title: "Own LIVE Product",
    description: "Dedicated fixture",
    price: 1,
    currency: "BDAG",
    category: "physical",
    stock: 5,
    status: "active",
    category_id: "10000000-0000-4000-8000-000000000002",
    product_type: "physical",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
  },
  {
    id: ids.productC,
    seller_id: sellerA.id,
    store_id: ids.storeA,
    title: "Removed Affiliate Product",
    description: "Dedicated revocation fixture",
    price: 1,
    currency: "BDAG",
    category: "physical",
    stock: 2,
    status: "active",
    category_id: "10000000-0000-4000-8000-000000000002",
    product_type: "physical",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
  },
  {
    id: ids.productD,
    seller_id: sellerA.id,
    store_id: ids.storeA,
    title: "Expiring Affiliate Product",
    description: "Dedicated expiration fixture",
    price: 1,
    currency: "BDAG",
    category: "physical",
    stock: 2,
    status: "active",
    category_id: "10000000-0000-4000-8000-000000000002",
    product_type: "physical",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
  },
];
await insert("products", products);
const skuA = `A4B-A-${stamp}`.toUpperCase(),
  skuB = `A4B-B-${stamp}`.toUpperCase(),
  skuC = `A4B-C-${stamp}`.toUpperCase(),
  skuD = `A4B-D-${stamp}`.toUpperCase();
await insert("marketplace_product_variants", [
  {
    id: ids.variantA,
    product_id: ids.productA,
    store_id: ids.storeA,
    seller_id: sellerA.id,
    sku: skuA,
    sku_normalized: skuA,
    title: "Default",
    price: 1,
    status: "active",
    is_default: true,
    combination_key: "",
  },
  {
    id: ids.variantB,
    product_id: ids.productB,
    store_id: ids.storeB,
    seller_id: hostB.id,
    sku: skuB,
    sku_normalized: skuB,
    title: "Default",
    price: 1,
    status: "active",
    is_default: true,
    combination_key: "",
  },
  {
    id: ids.variantC,
    product_id: ids.productC,
    store_id: ids.storeA,
    seller_id: sellerA.id,
    sku: skuC,
    sku_normalized: skuC,
    title: "Default",
    price: 1,
    status: "active",
    is_default: true,
    combination_key: "",
  },
  {
    id: ids.variantD,
    product_id: ids.productD,
    store_id: ids.storeA,
    seller_id: sellerA.id,
    sku: skuD,
    sku_normalized: skuD,
    title: "Default",
    price: 1,
    status: "active",
    is_default: true,
    combination_key: "",
  },
]);
await insert("marketplace_inventory_levels", [
  { variant_id: ids.variantA, on_hand: 5, reserved: 0 },
  { variant_id: ids.variantB, on_hand: 60, reserved: 0 },
  { variant_id: ids.variantC, on_hand: 2, reserved: 0 },
  { variant_id: ids.variantD, on_hand: 2, reserved: 0 },
]);
await rpc(
  "start_live_session",
  { p_session_id: ids.session, p_title: "A4B Affiliate Proof" },
  hostB.token,
);
const offerKey = uuid();
const offerArgs = {
  p_product_id: ids.productA,
  p_offer_scope: "specific_creator",
  p_creator_id: hostB.id,
  p_commission_bps: 500,
  p_status: "active",
  p_starts_at: null,
  p_ends_at: null,
  p_idempotency_key: offerKey,
};
const offer = await rpc(
    "upsert_my_live_affiliate_offer",
    offerArgs,
    sellerA.token,
  ),
  ownPin = await rpc(
    "pin_live_session_product",
    {
      p_session_id: ids.session,
      p_product_id: ids.productB,
      p_featured_variant_id: ids.variantB,
      p_idempotency_key: uuid(),
    },
    hostB.token,
  ),
  affiliatePin = await rpc(
    "pin_live_session_product",
    {
      p_session_id: ids.session,
      p_product_id: ids.productA,
      p_featured_variant_id: ids.variantA,
      p_idempotency_key: uuid(),
    },
    hostB.token,
  );
assert(
  "own_pin",
  ownPin.commerce_mode === "own_product" && ownPin.creator_commission_bps === 0,
);
assert(
  "affiliate_pin",
  affiliatePin.commerce_mode === "affiliate_product" &&
    affiliatePin.creator_commission_bps === 500,
);
const offerRetry = await rpc(
  "upsert_my_live_affiliate_offer",
  offerArgs,
  sellerA.token,
);
assert("offer_same_key", offerRetry.id === offer.id);
assert(
  "offer_conflicting_key",
  await denied(() =>
    rpc(
      "upsert_my_live_affiliate_offer",
      { ...offerArgs, p_status: "paused" },
      sellerA.token,
    ),
  ),
);
const security = {
  viewerPin: await denied(() =>
    rpc(
      "pin_live_session_product",
      {
        p_session_id: ids.session,
        p_product_id: ids.productA,
        p_featured_variant_id: null,
        p_idempotency_key: uuid(),
      },
      buyerC.token,
    ),
  ),
  anonymousPin: await denied(() =>
    rpc(
      "pin_live_session_product",
      {
        p_session_id: ids.session,
        p_product_id: ids.productA,
        p_featured_variant_id: null,
        p_idempotency_key: uuid(),
      },
      anon,
    ),
  ),
  directOfferInsert: await denied(() =>
    request("/rest/v1/marketplace_live_affiliate_offers", {
      method: "POST",
      token: buyerC.token,
      body: {},
    }),
  ),
  directPinInsert: await denied(() =>
    request("/rest/v1/live_session_products", {
      method: "POST",
      token: buyerC.token,
      body: {},
    }),
  ),
  directPinUpdate: await denied(() =>
    request(`/rest/v1/live_session_products?id=eq.${ownPin.id}`, {
      method: "PATCH",
      token: buyerC.token,
      body: { position: 9 },
    }),
  ),
  directPinDelete: await denied(() =>
    request(`/rest/v1/live_session_products?id=eq.${ownPin.id}`, {
      method: "DELETE",
      token: buyerC.token,
    }),
  ),
};
assert("command_security", Object.values(security).every(Boolean));
const accounts = {
  buyer: await fund(buyerC.id, 6, ids.productA),
  sellerA: await account(sellerA.id),
  hostB: await account(hostB.id),
  platform: (
    await select(
      "ledger_accounts",
      "select=id&owner_id=is.null&account_type=eq.platform&currency=eq.BDAG&limit=1",
    )
  )[0].id,
  escrow: (
    await select(
      "ledger_accounts",
      "select=id&owner_id=is.null&account_type=eq.marketplace_escrow&currency=eq.BDAG&limit=1",
    )
  )[0].id,
};
const beforeOwn = await snapshot(accounts),
  own = await buy({
    pin: ownPin.id,
    variant: ids.variantB,
    token: buyerC.token,
    session: ids.session,
  }),
  afterOwn = await snapshot(accounts),
  ownAllocation = (
    await select(
      "marketplace_payment_allocations",
      `select=*&order_id=eq.${own.order}`,
    )
  )[0];
assert(
  "own_split",
  eq(ownAllocation.gross_amount, 1) &&
    eq(ownAllocation.seller_net_amount, 0.9) &&
    eq(ownAllocation.platform_fee_amount, 0.1) &&
    eq(ownAllocation.creator_commission_amount, 0) &&
    ownAllocation.creator_user_id === null,
);
assert(
  "own_payment_balances",
  eq(beforeOwn.buyer - afterOwn.buyer, 1) &&
    eq(afterOwn.escrow - beforeOwn.escrow, 1) &&
    eq(afterOwn.hostB, beforeOwn.hostB) &&
    eq(afterOwn.platform, beforeOwn.platform),
);
const beforeAffiliate = await snapshot(accounts),
  pendingAffiliate = await reserve({
    pin: affiliatePin.id,
    variant: ids.variantA,
    token: buyerC.token,
    session: ids.session,
  });
const pausedOffer = await rpc(
  "upsert_my_live_affiliate_offer",
  { ...offerArgs, p_status: "paused", p_idempotency_key: uuid() },
  sellerA.token,
);
assert("offer_paused", pausedOffer.status === "paused");
const pausedShelf = await rpc(
  "fetch_live_session_products",
  { p_session_id: ids.session },
  buyerC.token,
);
assert(
  "paused_offer_unavailable",
  pausedShelf.find((item) => item.id === affiliatePin.id)?.availability ===
    "affiliate_offer_unavailable",
);
assert(
  "paused_offer_new_reservation_denied",
  await denied(() =>
    reserve({
      pin: affiliatePin.id,
      variant: ids.variantA,
      token: buyerC.token,
      session: ids.session,
    }),
  ),
);
const affiliate = await payReservation({
    ...pendingAffiliate,
    token: buyerC.token,
  }),
  afterAffiliate = await snapshot(accounts),
  allocation = (
    await select(
      "marketplace_payment_allocations",
      `select=*&order_id=eq.${affiliate.order}`,
    )
  )[0],
  source = (
    await select(
      "marketplace_live_commission_sources",
      `select=*&order_id=eq.${affiliate.order}`,
    )
  )[0],
  purchase = (
    await select(
      "live_commerce_purchase_events",
      `select=*&order_id=eq.${affiliate.order}`,
    )
  )[0];
assert(
  "affiliate_split",
  eq(allocation.gross_amount, 1) &&
    eq(allocation.seller_net_amount, 0.85) &&
    eq(allocation.creator_commission_amount, 0.05) &&
    eq(allocation.platform_fee_amount, 0.1) &&
    allocation.creator_user_id === hostB.id,
);
assert(
  "affiliate_source",
  source.host_id === hostB.id &&
    source.seller_id === sellerA.id &&
    source.affiliate_offer_id === offer.id &&
    source.creator_commission_bps === 500 &&
    eq(source.creator_commission_amount, 0.05),
);
assert(
  "purchase_event",
  purchase.host_id === hostB.id &&
    purchase.order_id === affiliate.order &&
    eq(purchase.creator_commission_amount, 0.05),
);
assert(
  "affiliate_payment_balances",
  eq(beforeAffiliate.buyer - afterAffiliate.buyer, 1) &&
    eq(afterAffiliate.escrow - beforeAffiliate.escrow, 1) &&
    eq(afterAffiliate.sellerA, beforeAffiliate.sellerA) &&
    eq(afterAffiliate.hostB, beforeAffiliate.hostB) &&
    eq(afterAffiliate.platform, beforeAffiliate.platform),
);
security.directSourceRead = await denied(() =>
  request("/rest/v1/marketplace_live_commission_sources?select=*", {
    token: buyerC.token,
  }),
);
security.directSourceWrite = await denied(() =>
  request("/rest/v1/marketplace_live_commission_sources", {
    method: "POST",
    token: buyerC.token,
    body: {},
  }),
);
security.viewerPurchaseFeed =
  (
    await request(
      `/rest/v1/live_commerce_host_purchase_events?select=*&session_id=eq.${ids.session}`,
      { token: buyerC.token },
    )
  ).length === 0;
security.hostInternalFeed = await denied(() =>
  request(
    `/rest/v1/live_commerce_purchase_events?select=*&session_id=eq.${ids.session}`,
    { token: hostB.token },
  ),
);
security.directCommandRead = await denied(() =>
  request("/rest/v1/marketplace_live_affiliate_offer_commands?select=*", {
    token: buyerC.token,
  }),
);
const safeEvents = await request(
  `/rest/v1/live_commerce_host_purchase_events?select=*&session_id=eq.${ids.session}`,
  { token: hostB.token },
);
assert("safe_event_count", safeEvents.length === 2);
for (const event of safeEvents)
  for (const forbidden of [
    "buyer_id",
    "checkout_id",
    "order_id",
    "order_item_id",
    "payment_id",
    "allocation_id",
    "financial_transaction_id",
    "account_id",
    "phone",
    "email",
  ]) assert("safe_event_forbidden_fields", !(forbidden in event));
assert(
  "financial_source_security",
  security.directSourceRead &&
    security.directSourceWrite &&
    security.viewerPurchaseFeed &&
    security.hostInternalFeed &&
    security.directCommandRead,
);
const statsHeld = await rpc(
  "fetch_my_live_shop_stats",
  { p_session_id: ids.session },
  hostB.token,
);
assert(
  "stats_before_delivery",
  statsHeld.orders_count === 2 &&
    eq(statsHeld.gross_sales, 2) &&
    eq(statsHeld.creator_commission_held, 0.05) &&
    eq(statsHeld.creator_commission_released, 0),
);
await rpc(
  "seller_start_marketplace_order_processing",
  { p_order_id: affiliate.order, p_idempotency_key: uuid() },
  sellerA.token,
);
await rpc(
  "seller_ship_marketplace_order",
  {
    p_order_id: affiliate.order,
    p_carrier_name: "A4B Carrier",
    p_service_level: "Test",
    p_tracking_number: `A4B-${stamp}`,
    p_tracking_url: null,
    p_seller_note: "Dedicated fixture",
    p_idempotency_key: uuid(),
  },
  sellerA.token,
);
const beforeDelivery = await snapshot(accounts),
  deliveryKey = uuid(),
  delivery = await edge(buyerC.token, {
    action: "marketplace_order_confirm_delivery",
    order_id: affiliate.order,
    idempotency_key: deliveryKey,
  }),
  afterDelivery = await snapshot(accounts),
  deliveryRetry = await edge(buyerC.token, {
    action: "marketplace_order_confirm_delivery",
    order_id: affiliate.order,
    idempotency_key: deliveryKey,
  }),
  afterRetry = await snapshot(accounts);
assert(
  "delivery_split",
  eq(beforeDelivery.escrow - afterDelivery.escrow, 1) &&
    eq(afterDelivery.sellerA - beforeDelivery.sellerA, 0.85) &&
    eq(afterDelivery.hostB - beforeDelivery.hostB, 0.05) &&
    eq(afterDelivery.platform - beforeDelivery.platform, 0.1),
);
assert(
  "delivery_retry",
  delivery.data?.settlement?.id === deliveryRetry.data?.settlement?.id ||
    delivery.settlement?.id === deliveryRetry.settlement?.id,
);
assert(
  "delivery_retry_balances",
  JSON.stringify(afterDelivery) === JSON.stringify(afterRetry),
);
const legs = await select(
  "marketplace_settlement_legs",
  `select=leg_type,amount&settlement_id=eq.${delivery.data?.settlement?.id ?? delivery.settlement?.id}`,
);
assert(
  "three_legs",
  legs.length === 3 && new Set(legs.map((x) => x.leg_type)).size === 3,
);
const paymentReconciliation = await rpc("reconcile_marketplace_payments"),
  settlementReconciliation = await rpc("reconcile_marketplace_settlements"),
  commissionReconciliation = await rpc(
    "reconcile_marketplace_live_commissions",
  );
for (const [k, v] of Object.entries(commissionReconciliation))
  assert(`commission_reconciliation_${k}`, Number(v) === 0);
assert(
  "payment_reconciliation",
  paymentReconciliation.escrow_shortfall === 0 &&
    paymentReconciliation.confirmed_state_mismatches === 0,
);
assert(
  "settlement_reconciliation",
  settlementReconciliation.escrow_difference === 0 &&
    settlementReconciliation.escrow_shortage === 0 &&
    settlementReconciliation.escrow_surplus === 0,
);
const statsReleased = await rpc(
  "fetch_my_live_shop_stats",
  { p_session_id: ids.session },
  hostB.token,
);
assert(
  "stats_after_delivery",
  statsReleased.orders_count === 2 &&
    eq(statsReleased.creator_commission_held, 0) &&
    eq(statsReleased.creator_commission_released, 0.05),
);
const revocationArgs = (productId, status, endsAt = null) => ({
  p_product_id: productId,
  p_offer_scope: "specific_creator",
  p_creator_id: hostB.id,
  p_commission_bps: 500,
  p_status: status,
  p_starts_at: null,
  p_ends_at: endsAt,
  p_idempotency_key: uuid(),
});
await rpc(
  "upsert_my_live_affiliate_offer",
  revocationArgs(ids.productC, "active"),
  sellerA.token,
);
const removedPin = await rpc(
  "pin_live_session_product",
  {
    p_session_id: ids.session,
    p_product_id: ids.productC,
    p_featured_variant_id: ids.variantC,
    p_idempotency_key: uuid(),
  },
  hostB.token,
);
await rpc(
  "upsert_my_live_affiliate_offer",
  revocationArgs(ids.productC, "removed"),
  sellerA.token,
);
assert(
  "removed_offer_new_reservation_denied",
  await denied(() =>
    reserve({
      pin: removedPin.id,
      variant: ids.variantC,
      token: buyerC.token,
      session: ids.session,
    }),
  ),
);
const expiresAt = new Date(Date.now() + 4_000).toISOString();
await rpc(
  "upsert_my_live_affiliate_offer",
  revocationArgs(ids.productD, "active", expiresAt),
  sellerA.token,
);
const expiredPin = await rpc(
  "pin_live_session_product",
  {
    p_session_id: ids.session,
    p_product_id: ids.productD,
    p_featured_variant_id: ids.variantD,
    p_idempotency_key: uuid(),
  },
  hostB.token,
);
await new Promise((resolve) => setTimeout(resolve, 4_500));
assert(
  "expired_offer_new_reservation_denied",
  await denied(() =>
    reserve({
      pin: expiredPin.id,
      variant: ids.variantD,
      token: buyerC.token,
      session: ids.session,
    }),
  ),
);
const revocationShelf = await rpc(
  "fetch_live_session_products",
  { p_session_id: ids.session },
  buyerC.token,
);
assert(
  "removed_and_expired_shelf_states",
  revocationShelf.find((item) => item.id === removedPin.id)?.availability ===
    "affiliate_offer_unavailable" &&
    revocationShelf.find((item) => item.id === expiredPin.id)?.availability ===
      "affiliate_offer_unavailable" &&
    revocationShelf.find((item) => item.id === ownPin.id)?.availability ===
      "available",
);
const statsBuyers = await Promise.all(
  Array.from({ length: 13 }, (_, index) => user(`stats-${index}`)),
);
await request("/rest/v1/user_profiles?on_conflict=id", {
  method: "POST",
  body: statsBuyers.map((buyer, index) => ({
    id: buyer.id,
    email: buyer.email,
    username: `a4b_stats_${index}_${stamp}`,
    display_name: `Stats Buyer ${index + 1}`,
  })),
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
});
for (const buyer of statsBuyers) await fund(buyer.id, 4, buyer.id);
for (let index = 0; index < 49; index += 1) {
  const statsBuyer = statsBuyers[index % statsBuyers.length];
  await buyOnce({
    pin: ownPin.id,
    variant: ids.variantB,
    token: statsBuyer.token,
    session: ids.session,
  });
}
const statsBeyondPage = await rpc(
    "fetch_my_live_shop_stats",
    { p_session_id: ids.session },
    hostB.token,
  ),
  notificationPage = await rpc(
    "fetch_my_live_purchase_events",
    { p_session_id: ids.session, p_limit: 50 },
    hostB.token,
  );
assert(
  "stats_beyond_notification_page",
  notificationPage.length === 50 &&
    statsBeyondPage.orders_count === 51 &&
    statsBeyondPage.units_sold === 51 &&
    eq(statsBeyondPage.gross_sales, 51) &&
    eq(statsBeyondPage.creator_commission_held, 0) &&
    eq(statsBeyondPage.creator_commission_released, 0.05),
);
console.log(
  JSON.stringify(
    {
      project: PROJECT,
      ids: {
        sellerA: redact(sellerA.id),
        hostB: redact(hostB.id),
        buyerC: redact(buyerC.id),
        session: redact(ids.session),
        offer: redact(offer.id),
        ownOrder: redact(own.order),
        affiliateOrder: redact(affiliate.order),
      },
      security,
      own: {
        before: beforeOwn,
        after: afterOwn,
        allocation: ownAllocation,
        purchaseEvent: true,
      },
      affiliate: {
        beforePayment: beforeAffiliate,
        afterPayment: afterAffiliate,
        allocation,
        source: {
          mode: source.commerce_mode,
          bps: source.creator_commission_bps,
          amount: source.creator_commission_amount,
        },
        beforeDelivery,
        afterDelivery,
        legs,
        safeEventCount: safeEvents.length,
        statsHeld,
        statsReleased,
        statsBeyondPage,
        notificationPageCount: notificationPage.length,
      },
      reconciliation: {
        paymentReconciliation,
        settlementReconciliation,
        commissionReconciliation,
      },
    },
    null,
    2,
  ),
);
