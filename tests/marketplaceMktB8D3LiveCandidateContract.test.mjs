import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("services/liveCommerceService.ts", "utf8");
const manager = readFileSync(
  "components/live/shop/LiveHostShopManager.tsx",
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
const nativeRequire = createRequire(import.meta.url);
const require = (specifier) => {
  if (specifier === "@/template")
    return { getSupabaseClient: () => ({ rpc: async () => ({}) }) };
  if (specifier === "./marketplaceOrderService")
    return {
      normalizeShippingAddress: (value) => value,
      parseMarketplaceCheckoutReservation: (value) => value,
    };
  return nativeRequire(specifier);
};
vm.runInNewContext(javascript, {
  module,
  exports: module.exports,
  require,
  console,
  Error,
  Number,
  Date,
  Array,
  Object,
  RegExp,
  String,
  Math,
  Set,
  Map,
});
const live = module.exports;

const id = (suffix) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const candidate = (overrides = {}) => ({
  product_id: id(1),
  store_id: id(2),
  store_name: "The best America",
  seller_name: "andres101089",
  title: "Camisa de vestir",
  image_url: null,
  min_price: 25,
  max_price: 25,
  active_variant_count: 1,
  available_quantity: 31,
  pin_id: null,
  is_pinned: false,
  is_featured: false,
  commerce_mode: "own_product",
  creator_commission_bps: 0,
  candidate_availability: "available",
  readiness_reason_code: "ready",
  pin_offer_valid: true,
  pinned_creator_commission_bps: null,
  current_offer_commission_bps: null,
  current_offer_id: null,
  pinned_offer_id: null,
  requires_repin: false,
  updated_at: "2026-08-16T12:00:00.000Z",
  ...overrides,
});

test("shipping_incomplete is a strict canonical readiness reason", () => {
  assert.equal(
    live.readinessReasonFromErrorCode(
      "live_product_readiness_shipping_incomplete",
    ),
    "shipping_incomplete",
  );
  assert.equal(
    live.readinessReasonFromErrorCode(
      "marketplace_product_not_ready_shipping_incomplete",
    ),
    "shipping_incomplete",
  );
});

test("ready and shipping-incomplete candidates parse in the same page", () => {
  const page = live.parseLiveProductCandidatePage({
    items: [
      candidate(),
      candidate({
        product_id: id(3),
        title: "Camisa",
        candidate_availability: "product_unavailable",
        readiness_reason_code: "shipping_incomplete",
        available_quantity: 30,
      }),
    ],
    next_cursor: null,
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].title, "Camisa de vestir");
  assert.equal(page.items[0].candidateAvailability, "available");
  assert.equal(page.items[1].readinessReasonCode, "shipping_incomplete");
  assert.equal(page.items[1].candidateAvailability, "product_unavailable");
});

test("unknown future readiness reasons still fail closed", () => {
  assert.throws(
    () =>
      live.parseLiveProductCandidatePage({
        items: [candidate({ readiness_reason_code: "future_unknown" })],
        next_cursor: null,
      }),
    (error) => error?.code === "live_commerce_unknown",
  );
});

test("shipping-incomplete products receive precise Spanish guidance", () => {
  assert.match(
    manager,
    /shipping_incomplete:\s*[\s\S]{0,100}Configura un método de envío para poder vender este producto en LIVE\./,
  );
});

test("candidate availability continues to gate Add without hiding rows", () => {
  assert.match(
    manager,
    /canAdd = !item\.isPinned && item\.candidateAvailability === "available"/,
  );
  assert.match(manager, /disabled=\{busy \|\| \(!item\.isPinned && !canAdd\)\}/);
});

test("load errors no longer claim the active store is unavailable", () => {
  assert.match(manager, /: "No pudimos cargar los productos"/);
  assert.match(manager, /title=\{error\.title\}/);
});

test("host eligibility retains store eligibility semantics", () => {
  assert.match(
    manager,
    /error\.code === "live_commerce_host_not_eligible"[\s\S]{0,80}\? "Tienda no disponible"/,
  );
  assert.match(
    manager,
    /Activa tu tienda y completa la aprobación de vendedor/,
  );
});

test("pin unpin and feature commands remain wired", () => {
  for (const command of ["pinLiveProduct", "unpinLiveProduct", "featureLiveProduct"])
    assert.match(manager, new RegExp(`await ${command}\\(`));
});

test("the authoritative 20-product pin limit remains unchanged", () => {
  assert.match(manager, /const PAGE_SIZE = 20/);
  assert.match(manager, /\{pinnedCount\}\/20 productos activos/);
  assert.match(manager, /Llegaste al límite de 20 productos en este LIVE\./);
});

test("the correction does not touch LIVE broadcast presentation", () => {
  assert.doesNotMatch(source, /camera|Agora|bottom controls/i);
});
