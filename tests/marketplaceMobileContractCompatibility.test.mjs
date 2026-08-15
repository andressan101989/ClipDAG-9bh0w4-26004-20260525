import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const compile = (path, stubs = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"),
    javascript = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    module = { exports: {} };
  const localRequire = (name) =>
    name in stubs ? stubs[name] : nativeRequire(name);
  vm.runInNewContext(javascript, {
    module,
    exports: module.exports,
    require: localRequire,
    Error,
    Number,
    Date,
    Array,
    Object,
    RegExp,
    Map,
    Set,
    Response: globalThis.Response,
    __DEV__: false,
  });
  return module.exports;
};
const validators = compile("../services/marketplaceRuntimeValidation.ts"),
  template = { getSupabaseClient: () => ({}) };
const products = compile("../services/marketplaceService.ts", {
  "@/template": template,
  "@/services/mediaService": { extractRpcUuid: () => "" },
  "@/services/marketplaceRuntimeValidation": validators,
});
const drafts = compile("../services/marketplaceProductDraftService.ts", {
  "@/template": template,
  "./marketplaceRuntimeValidation": validators,
  "./marketplaceProductEditorFlagsCore.mjs": {
    parseMarketplaceProductEditorFlags: (state) => ({
      titleConfigured: state.title_configured,
      priceConfigured: state.price_configured,
      categoryConfigured: state.category_configured,
    }),
  },
});
const settlements = compile("../services/marketplaceSettlementService.ts", {
  "@/template": template,
  "./marketplaceRuntimeValidation": validators,
});
const analytics = compile("../services/marketplaceAnalyticsService.ts", {
  "expo-crypto": { randomUUID: () => "99000000-0000-4000-8000-000000000001" },
  "@/template": template,
  "./marketplaceRuntimeValidation": validators,
  "./marketplaceAnalyticsCore.mjs": {
    marketplaceAnalyticsAppliedQuantity: () => 1,
    marketplaceCheckoutAnalyticsTargets: () => [],
    parseMarketplaceAnalyticsSource: (x) => x,
  },
});
const showcase = compile("../services/marketplaceCreatorShowcaseService.ts", {
  "@/template": template,
  "./marketplaceRuntimeValidation": validators,
});
const contentTags = compile(
  "../services/marketplaceCreatorContentTagService.ts",
  {
    "@/template": template,
    "./marketplaceRuntimeValidation": validators,
    "./marketplaceCreatorContentTagCore.mjs": {
      marketplaceContentTypeForMedia: () => "feed",
    },
  },
);
const cursor = compile("../services/marketplaceCursorCollection.ts");
const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`,
  at = "2026-08-15T12:00:00.000Z";
const product = (type = "physical", description = "") => ({
  id: id(1),
  seller_id: id(2),
  store_id: id(3),
  category_id: id(4),
  title: "Producto",
  description,
  price: 12.5,
  currency: "BDAG",
  category: type === "digital" ? "digital" : "physical",
  images: [],
  stock: 3,
  status: "active",
  tags: [],
  total_sales: 0,
  brand: null,
  compare_at_price: null,
  product_type: type,
  moderation_status: "approved",
  published_at: null,
  deleted_at: null,
  created_at: at,
  updated_at: at,
  variant_price_max: 12.5,
  active_variant_count: 1,
  shipping_profile_id: null,
});
const variant = {
  id: id(5),
  product_id: id(1),
  sku: null,
  title: null,
  price: 12.5,
  base_price: 12.5,
  promotion_id: null,
  promotion_type: null,
  discount_percentage: null,
  promotion_ends_at: null,
  compare_at_price: null,
  status: "active",
  is_default: true,
  image_asset_id: null,
  image_url: null,
  available_quantity: 3,
  option_value_ids: [],
};

test("canonical physical/digital products and empty descriptions are accepted", () => {
  assert.equal(
    products.parseMarketplaceProduct(product("physical", "")).product_type,
    "physical",
  );
  assert.equal(
    products.parseMarketplaceProduct(product("digital", "")).product_type,
    "digital",
  );
  assert.equal(
    products.parseMarketplaceProduct(product("digital", "")).description,
    "",
  );
  assert.throws(
    () => products.parseMarketplaceProduct(product("service", "")),
    /marketplace_payload_invalid/,
  );
  assert.throws(
    () => products.parseMarketplaceProduct({ ...product(), title: "" }),
    /marketplace_payload_invalid/,
  );
});

test("seller private inventory is deeply validated", () => {
  const payload = {
    product: product(),
    detail: {
      options: [
        {
          id: id(6),
          name: "Color",
          position: 0,
          values: [{ id: id(7), value: "Azul", position: 0 }],
        },
      ],
      variants: [variant],
    },
    inventory: [
      {
        variant_id: id(5),
        on_hand: 3,
        reserved: 0,
        available_quantity: 3,
        low_stock_threshold: 0,
        version: 1,
      },
    ],
    movements: [
      {
        id: id(8),
        variant_id: id(5),
        movement_type: "seller_set",
        delta: 3,
        resulting_on_hand: 3,
        reason: "Inicial",
        created_at: at,
      },
    ],
    media_assets: [{ id: id(9), url: "https://example.test/a.jpg" }],
  };
  assert.equal(
    products.parseSellerProductInventory(payload).inventory[0].on_hand,
    3,
  );
  assert.throws(
    () =>
      products.parseSellerProductInventory({
        ...payload,
        inventory: [{ ...payload.inventory[0], variant_id: "bad" }],
      }),
    /marketplace_payload_invalid/,
  );
  assert.throws(
    () =>
      products.parseSellerProductInventory({
        ...payload,
        detail: { ...payload.detail, options: {} },
      }),
    /marketplace_payload_invalid/,
  );
});

test("product drafts preserve digital type and canonical empty text without coercion", () => {
  const payload = {
    product: {
      id: id(1),
      store_id: id(3),
      category_id: id(4),
      title: "Borrador",
      description: "",
      price: 1,
      brand: null,
      compare_at_price: null,
      stock: 0,
      tags: [],
      shipping_profile_id: null,
      product_type: "digital",
      status: "paused",
      editor_saved_at: at,
      published_at: null,
      editor_state: {
        title_configured: true,
        price_configured: true,
        category_configured: true,
      },
    },
    media: [],
  };
  const parsed = drafts.parseMarketplaceProductDraft(payload);
  assert.equal(parsed.productType, "digital");
  assert.equal(parsed.description, "");
  assert.equal(parsed.brand, "");
  assert.throws(
    () =>
      drafts.parseMarketplaceProductDraft({
        ...payload,
        product: { ...payload.product, product_type: "future" },
      }),
    /marketplace_payload_invalid/,
  );
  assert.throws(
    () =>
      drafts.parseMarketplaceProductDraft({
        ...payload,
        product: { ...payload.product, price: "1" },
      }),
    /marketplace_payload_invalid/,
  );
  assert.throws(
    () =>
      drafts.parseMarketplaceProductDraft({
        ...payload,
        product: { ...payload.product, editor_saved_at: "bad" },
      }),
    /marketplace_payload_invalid/,
  );
  assert.throws(
    () =>
      drafts.parseMarketplaceProductDraft({
        ...payload,
        media: [
          {
            asset_id: id(9),
            url: "x",
            media_kind: "audio",
            duration_ms: null,
            position: 0,
            is_cover: false,
          },
        ],
      }),
    /marketplace_payload_invalid/,
  );
});

test("valid settlement and dispute financial receipts are accepted", () => {
  const receipt = {
    settlement: {
      id: id(10),
      status: "completed",
      order_id: id(11),
      currency: "BDAG",
      gross_amount: 20,
      confirmed_at: at,
      released_at: at,
    },
    order: { id: id(11), status: "delivered", delivered_at: at },
    shipment: { status: "delivered", delivered_at: at },
    allocation: { status: "released", released_at: at },
  };
  assert.equal(
    settlements.parseMarketplaceSettlementReceipt(receipt).settlement
      .grossAmount,
    20,
  );
  const support = {
    dispute: {
      id: id(12),
      status: "open",
      reason_code: "damaged",
      created_at: at,
    },
    order: { id: id(11), status: "delivered" },
    payment: { status: "paid", gross_amount: 20 },
    allocation: {
      status: "released",
      gross_amount: 20,
      seller_net_amount: 17,
      creator_commission_amount: 1,
      platform_fee_amount: 2,
    },
  };
  assert.equal(
    settlements.parseSupportMarketplaceDispute(support).allocation
      .sellerNetAmount,
    17,
  );
  const decision = {
    kind: "final_resolution",
    finalDecision: {
      id: id(13),
      dispute_id: id(12),
      order_id: id(11),
      outcome: "reject_claim",
      reason_code: "claim_rejected",
      financial_result: { money_moved: false, settlement_eligible: true },
      decided_at: at,
    },
    dispute: { status: "rejected", resolved_at: at },
    order: { status: "delivered" },
    payment: { status: "paid", gross_amount: 20 },
    allocation: {
      status: "released",
      gross_amount: 20,
      seller_net_amount: 17,
      creator_commission_amount: 1,
      platform_fee_amount: 2,
    },
  };
  assert.equal(
    settlements.parseMarketplaceDisputeResolution(decision).finalDecision
      .outcome,
    "reject_claim",
  );
  assert.throws(
    () =>
      settlements.parseMarketplaceSettlementReceipt({
        ...receipt,
        settlement: { ...receipt.settlement, id: "bad" },
      }),
    /marketplace_settlement_unknown/,
  );
  assert.throws(
    () =>
      settlements.parseMarketplaceSettlementReceipt({
        ...receipt,
        settlement: { ...receipt.settlement, gross_amount: "20" },
      }),
    /marketplace_settlement_unknown/,
  );
  assert.throws(
    () =>
      settlements.parseSupportMarketplaceDispute({
        ...support,
        dispute: { ...support.dispute, created_at: "bad" },
      }),
    /marketplace_dispute_resolution_unknown/,
  );
  assert.throws(
    () =>
      settlements.parseMarketplaceDisputeResolution({
        ...decision,
        finalDecision: {
          ...decision.finalDecision,
          financial_result: { money_moved: "false", settlement_eligible: true },
        },
      }),
    /marketplace_dispute_resolution_unknown/,
  );
  assert.throws(
    () =>
      settlements.parseMarketplaceDisputeResolution({
        ...decision,
        allocation: undefined,
      }),
    /marketplace_dispute_resolution_unknown/,
  );
});

test("cursor accumulation reaches rows beyond 100, dedupes, resets, and stops terminally", () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
    })),
    second = Array.from({ length: 21 }, (_, index) => ({
      id: String(index + 100),
    }));
  let state = cursor.mergeMarketplaceCursorPage(
    { items: [], nextCursor: null },
    { items: first, nextCursor: { page: 2 } },
    true,
  );
  assert.equal(state.items.length, 100);
  state = cursor.mergeMarketplaceCursorPage(state, {
    items: second,
    nextCursor: null,
  });
  assert.equal(state.items.length, 120);
  assert.equal(new Set(state.items.map((x) => x.id)).size, 120);
  assert.ok(state.items.some((x) => x.id === "101"));
  assert.equal(state.nextCursor, null);
  const refreshed = cursor.mergeMarketplaceCursorPage(
    state,
    { items: first.slice(0, 50), nextCursor: { page: 2 } },
    true,
  );
  assert.equal(refreshed.items.length, 50);
  assert.equal(refreshed.nextCursor.page, 2);
});

test("promotion row 101 and shipping-profile row 101 are reachable through the shared continuation contract", () => {
  for (const domain of ["promotion", "shipping"]) {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `${domain}-${i + 1}`,
      })),
      page2 = [{ id: `${domain}-101` }];
    const state = cursor.mergeMarketplaceCursorPage(
      cursor.mergeMarketplaceCursorPage(
        { items: [], nextCursor: null },
        { items: page1, nextCursor: { after: 100 } },
        true,
      ),
      { items: page2, nextCursor: null },
    );
    assert.ok(state.items.some((x) => x.id === `${domain}-101`));
    assert.equal(state.nextCursor, null);
  }
});

test("seller analytics and creator product projections reject coercive required values", () => {
  const seller = {
    date_from: at,
    date_to: "2026-08-16T12:00:00.000Z",
    timezone: "UTC",
    summary: {
      product_views: 1,
      unique_viewer_sessions: 1,
      add_to_cart_events: 0,
      checkout_started: 0,
      orders: 0,
      purchase_items: 0,
      units_sold: 0,
      gross_merchandise_bdag: 0,
      view_to_cart_event_rate: 0,
      view_to_purchase_event_rate: 0,
    },
    products: [],
    daily: [
      {
        event_day: "2026-08-15",
        views: 1,
        add_to_cart: 0,
        orders: 0,
        purchase_items: 0,
        units_sold: 0,
        gmv_bdag: 0,
      },
    ],
    sources: [
      {
        source_type: "direct",
        views: 1,
        add_to_cart: 0,
        orders: 0,
        purchase_items: 0,
        units_sold: 0,
        gmv_bdag: 0,
      },
    ],
  };
  assert.equal(
    analytics.parseMarketplaceSellerAnalytics(seller).summary.product_views,
    1,
  );
  assert.throws(
    () =>
      analytics.parseMarketplaceSellerAnalytics({
        ...seller,
        summary: { ...seller.summary, product_views: "1" },
      }),
    /marketplace_payload_invalid/,
  );
  const creatorProduct = {
    showcase_item_id: null,
    creator_user_id: null,
    product_id: id(1),
    seller_id: id(2),
    store_id: id(3),
    title: "Producto",
    store_name: "Tienda",
    seller_name: null,
    image_url: null,
    min_price: 1,
    max_price: 2,
    available_quantity: 4,
    commission_bps: 1000,
    offer_scope: "public_creator",
    selected: false,
    sort_position: 0,
    updated_at: at,
  };
  assert.equal(
    showcase.parseCreatorShowcaseProduct(creatorProduct).availableQuantity,
    4,
  );
  assert.throws(
    () =>
      showcase.parseCreatorShowcaseProduct({
        ...creatorProduct,
        min_price: "1",
      }),
    /marketplace_payload_invalid/,
  );
  const tag = {
    tag_id: id(4),
    content_type: "reel",
    product_id: id(1),
    title: "Producto",
    store_id: id(3),
    store_name: "Tienda",
    image_url: null,
    min_price: 1,
    max_price: 2,
    available_quantity: 4,
    sort_position: 0,
  };
  assert.equal(
    contentTags.parseCreatorContentTagProduct(tag).contentType,
    "reel",
  );
  assert.throws(
    () =>
      contentTags.parseCreatorContentTagProduct({
        ...tag,
        content_type: "story",
      }),
    /marketplace_payload_invalid/,
  );
});
