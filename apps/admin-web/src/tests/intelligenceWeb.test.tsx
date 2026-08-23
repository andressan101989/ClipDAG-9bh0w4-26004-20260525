import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateAdDetail,
  validateAdsPage,
  validateActivityPage,
  validateCreatorDetail,
  validateCreatorOverview,
  validateCreatorPage,
  healthCounterKeys,
  validateHealth,
  validatePromotionDetail,
  validatePromotionPage,
} from "../lib/adminIntelligenceApi";
import {
  MarketplaceAdsPage,
  MarketplaceHealthPage,
} from "../pages/MarketplaceIntelligencePages";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn(), auth: {} } }));
vi.mock("../lib/adminIntelligenceApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/adminIntelligenceApi")>();
  return { ...original, searchAds: vi.fn(), getHealth: vi.fn() };
});
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-08-01T00:00:00Z";
const creatorMoney = {
  attributed_gmv: "10",
  commission_generated: "1",
  commission_released: "1",
  commission_reversed: "0",
  commission_net: "1",
};
const validItem = {
  creator_user_id: id(1), source_entity_id: id(2), product_id: id(3),
  order_id: id(4), order_item_id: id(5), source_surface: "feed",
  product_title: "Producto", quantity: 1, historical_bps: 1200,
  ...creatorMoney, paid_at: at, released_at: at, reversed_at: null as string | null,
};
const validCreatorDetail = () => ({
  range: "30d", generated_at: at, timezone: "UTC",
  creator: { id: id(1), username: null, display_name: null },
  summary: { orders: 1, units: 1, product_opens: 1, add_to_cart: 1, ...creatorMoney },
  surface_breakdown: [], top_products: [], item_trace: [{ ...validItem }],
});
const validAdDetail = () => ({
  campaign: {
    id: id(1), seller_id: id(2), store_id: id(3), product_id: id(4),
    name: null, status: "active", starts_at: at, ends_at: "2026-09-01T00:00:00Z",
    funded_at: at, paused_at: null, completed_at: null, eligibility_state: true,
    eligibility_reason: "eligible", eligible_elapsed_seconds: 10,
    eligibility_checkpoint_at: at, created_at: at, updated_at: at,
  },
  seller: { id: id(2), username: null, display_name: null },
  store: { id: id(3), name: "Store", status: "active" },
  product: { id: id(4), title: "Product", status: "active", moderation_status: "approved" },
  financial: { total_budget: "100", spent: "20", released: "0", remaining_reserved: "80" },
  financial_events: [] as unknown[], finalization: null as unknown,
  delivery: { materializations: 1, eligible_elapsed_seconds: 10 },
  events: { impression: 1 }, attribution: { orders: 0, units: 0, gmv: "0" },
});
type HealthGroupName = keyof typeof healthCounterKeys;
const validHealthCounters = (name: HealthGroupName) => {
  const counters = Object.fromEntries(
    healthCounterKeys[name].map((key) => [key, 0]),
  ) as Record<string, unknown>;
  if (name === "payments") {
    counters.confirmed_state_breakdown = {
      confirmed: 0, processing: 0, shipped: 0, delivered: 0,
      refunded_fixture: 0, refunded_dispute: 0, refunded_return: 0, invalid: 0,
    };
    counters.invalid_confirmed_state_details = [];
  } else if (name === "settlements") {
    counters.refunded_settlement_breakdown = {
      refunded_after_return: 0,
      refunded_after_dispute: 0,
    };
  }
  return counters;
};
const validHealth = () => ({
  checked_at: at,
  healthy: true,
  groups: (Object.keys(healthCounterKeys) as HealthGroupName[]).map((name) => ({
    name,
    check_count: healthCounterKeys[name].length,
    failing_check_count: 0,
    healthy: true,
    counters: validHealthCounters(name),
  })),
  attention: [] as unknown[],
});
const healthGroup = (
  payload: ReturnType<typeof validHealth>,
  name: HealthGroupName,
) => payload.groups.find((group) => group.name === name)!;

describe("B8C-C1 exact runtime validation", () => {
  it("rejects Creator overview missing a required count", () => {
    expect(() => validateCreatorOverview({ range: "30d", generated_at: at, timezone: "UTC",
      summary: { active_creators: 1, units: 1, product_opens: 0, add_to_cart: 0, ...creatorMoney }, surface_breakdown: [] })).toThrow("inválida");
  });
  it("rejects an invalid Creator surface", () => {
    expect(() => validateCreatorOverview({ range: "30d", generated_at: at, timezone: "UTC",
      summary: { active_creators: 1, attributed_orders: 1, units: 1, product_opens: 0, add_to_cart: 0, ...creatorMoney },
      surface_breakdown: [{ source_surface: "story", orders: 0, units: 0, product_opens: 1, add_to_cart: 0, ...creatorMoney }] })).toThrow("inválida");
  });
  it("rejects malformed historical BPS and missing order UUID", () => {
    const badBps = validCreatorDetail(); badBps.item_trace[0].historical_bps = 3001;
    expect(() => validateCreatorDetail(badBps)).toThrow("inválida");
    const missingOrder = validCreatorDetail(); delete (missingOrder.item_trace[0] as Partial<typeof validItem>).order_id;
    expect(() => validateCreatorDetail(missingOrder)).toThrow("inválida");
  });
  it("rejects malformed Creator release and reversal timestamps", () => {
    const release = validCreatorDetail(); release.item_trace[0].released_at = "bad";
    expect(() => validateCreatorDetail(release)).toThrow("inválida");
    const reversal = validCreatorDetail(); reversal.item_trace[0].reversed_at = "bad";
    expect(() => validateCreatorDetail(reversal)).toThrow("inválida");
  });
  it("rejects malformed Creator activity cursor and UUID", () => {
    expect(() => validateCreatorPage({ range: "7d", creators: [], page_size: 0,
      next_cursor: { activity_at: "bad", creator_id: "bad" } })).toThrow("inválida");
  });
  it("rejects Promotions missing value or using invalid enums", () => {
    expect(() => validatePromotionPage({ promotions: [{ id: id(1), seller_id: id(2), store_id: id(3), product_id: id(4), variant_id: null,
      seller_name: "S", store_name: "T", product_title: "P", variant_title: null,
      promotion_type: "percentage", state: "invented", starts_at: at, ends_at: at,
      created_at: at, historical_orders: 0, historical_units: 0, current_price: null }], page_size: 1, next_cursor: null })).toThrow("inválida");
  });
  it("rejects malformed Promotion snapshot money", () => {
    expect(() => validatePromotionDetail({
      promotion: { id: id(1), seller_id: id(2), store_id: id(3), product_id: id(4), created_by: id(2), variant_id: null,
        promotion_type: "percentage", percentage_off: "10", status: "enabled", starts_at: at, ends_at: at, created_at: at },
      seller: { id: id(2), username: null, display_name: null }, store: { id: id(3), name: "S", slug: "s", status: "active" },
      product: { id: id(4), title: "P", status: "active", moderation_status: "approved" }, variant: null, current_price: null,
      historical_usage: [{ order_id: id(1), order_item_id: id(2), quantity: 1, base_unit_price: "NaN", discount_amount: "1", unit_price: "9", line_total: "9" }],
    })).toThrow("inválida");
  });
  it("rejects Ads missing eligibility boolean or invalid status", () => {
    const missing = validAdDetail(); delete (missing.campaign as Partial<typeof missing.campaign>).eligibility_state;
    expect(() => validateAdDetail(missing)).toThrow("inválida");
    const status = validAdDetail(); status.campaign.status = "unknown";
    expect(() => validateAdDetail(status)).toThrow("inválida");
  });
  it("rejects malformed Ads delivery", () => {
    const value = validAdDetail(); value.delivery.materializations = 1.5;
    expect(() => validateAdDetail(value)).toThrow("inválida");
  });
  it("rejects malformed Ads finalization money and timestamp", () => {
    const value = validAdDetail(); value.finalization = { campaign_id: id(1), eligible_elapsed_seconds: 1, delivery_target_seconds: 2,
      final_target_bdag: "NaN", spent_before_bdag: "0", final_spend_delta_bdag: "0", released_bdag: "0", finalized_at: "bad" };
    expect(() => validateAdDetail(value)).toThrow("inválida");
  });
  it("rejects malformed Ads financial and delivery events", () => {
    expect(() => validateAdsPage({ campaigns: [{ id: "bad" }], page_size: 1, next_cursor: null })).toThrow("inválida");
    const value = validAdDetail(); value.financial_events = [{ id: id(5), event_type: "refund", amount: "1", financial_transaction_id: id(6), created_at: at }];
    expect(() => validateAdDetail(value)).toThrow("inválida");
  });
  it("rejects realistic string and boolean values for numeric Health counters", () => {
    const stringCounter = validHealth();
    healthGroup(stringCounter, "payments").counters.paid_without_payment = "0";
    expect(() => validateHealth(stringCounter)).toThrow("inválida");
    const booleanCounter = validHealth();
    healthGroup(booleanCounter, "creator_commerce").counters.missing_creator = false;
    expect(() => validateHealth(booleanCounter)).toThrow("inválida");
  });
  it("rejects required Health array and object shape substitutions", () => {
    const arrayAsObject = validHealth();
    healthGroup(arrayAsObject, "payments").counters.invalid_confirmed_state_details = {};
    expect(() => validateHealth(arrayAsObject)).toThrow("inválida");
    const objectAsArray = validHealth();
    healthGroup(objectAsArray, "payments").counters.confirmed_state_breakdown = [];
    expect(() => validateHealth(objectAsArray)).toThrow("inválida");
  });
  it("requires the complete unique canonical Health group set", () => {
    const missing = validHealth();
    missing.groups.pop();
    expect(() => validateHealth(missing)).toThrow("inválida");
    const duplicate = validHealth();
    duplicate.groups[14] = { ...duplicate.groups[0] };
    expect(() => validateHealth(duplicate)).toThrow("inválida");
    const unknown = validHealth();
    (unknown.groups[0] as { name: string }).name = "future_group";
    expect(() => validateHealth(unknown)).toThrow("inválida");
  });
  it("rejects negative Health counts and inconsistent classifications", () => {
    const negativeChecks = validHealth();
    (healthGroup(negativeChecks, "payments") as { check_count: number }).check_count = -1;
    expect(() => validateHealth(negativeChecks)).toThrow("inválida");
    const negativeFailures = validHealth();
    (healthGroup(negativeFailures, "payments") as { failing_check_count: number }).failing_check_count = -1;
    expect(() => validateHealth(negativeFailures)).toThrow("inválida");
    const groupMismatch = validHealth();
    healthGroup(groupMismatch, "payments").healthy = false;
    expect(() => validateHealth(groupMismatch)).toThrow("inválida");
    const rootMismatch = validHealth();
    rootMismatch.healthy = false;
    expect(() => validateHealth(rootMismatch)).toThrow("inválida");
  });
  it("accepts legitimate nonzero observations and canonical unhealthy failures", () => {
    const observations = validHealth();
    healthGroup(observations, "payments").counters.confirmed_state_breakdown = {
      confirmed: 2, processing: 1, shipped: 3, delivered: 21,
      refunded_fixture: 233, refunded_dispute: 2, refunded_return: 3, invalid: 0,
    };
    const settlement = healthGroup(observations, "settlements").counters;
    settlement.escrow_expected_held_total = 71;
    settlement.escrow_actual_balance = 71;
    settlement.escrow_difference = 0;
    settlement.refunded_settlement_breakdown = {
      refunded_after_return: 3,
      refunded_after_dispute: 0,
    };
    expect(() => validateHealth(observations)).not.toThrow();

    const unhealthy = validHealth(), payment = healthGroup(unhealthy, "payments");
    payment.counters.confirmed_state_mismatches = 1;
    payment.counters.confirmed_state_breakdown = {
      confirmed: 2, processing: 0, shipped: 0, delivered: 0,
      refunded_fixture: 0, refunded_dispute: 0, refunded_return: 0, invalid: 1,
    };
    payment.counters.invalid_confirmed_state_details = [{
      order_id: id(9), checkout_status: "paid", order_status: "invalid",
      payment_status: "paid", allocation_status: "held",
    }];
    payment.failing_check_count = 2;
    payment.healthy = false;
    unhealthy.healthy = false;
    expect(() => validateHealth(unhealthy)).not.toThrow();
  });
  it("rejects malformed Health attention severity and entity", () => {
    const malformed = validHealth();
    malformed.attention = [
      { reason_code: "x", entity_type: "product", entity_id: "bad", severity: "fraud", message: "x" },
    ];
    expect(() => validateHealth(malformed)).toThrow("inválida");
  });
  it("rejects malformed Activity cursor and UUID", () => {
    expect(() => validateActivityPage({ activity: [], page_size: 0,
      next_cursor: { created_at: "bad", id: id(1) } })).toThrow("inválida");
  });
});

describe("B8C controlled page errors", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders Ads data without financial mutation controls", async () => {
    const api = await import("../lib/adminIntelligenceApi");
    vi.mocked(api.searchAds).mockResolvedValue({ items: [{
      id: id(1), name: "Campaña", seller_id: id(2), seller_name: "Seller", store_id: id(3), store_name: "Store",
      product_id: id(4), product_title: "Producto", status: "active", eligibility_state: true,
      eligibility_reason: "eligible", starts_at: at, ends_at: "2026-08-20T00:00:00Z", total_budget: "100",
      spent: "20", released: "0", remaining_reserved: "80", funded_at: at, completed_at: null,
      attention: false, created_at: at,
    }], nextCursor: null, pageSize: 1 });
    render(<MemoryRouter><MarketplaceAdsPage /></MemoryRouter>);
    expect((await screen.findAllByText("Campaña")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/liberar presupuesto|gastar presupuesto|finalizar campaña/i)).not.toBeInTheDocument();
  });
  it("shows a controlled health error for realistic malformed JSON with retry", async () => {
    const api = await import("../lib/adminIntelligenceApi");
    const malformed = validHealth();
    healthGroup(malformed, "payments").counters.paid_without_payment = "0";
    vi.mocked(api.getHealth).mockImplementation(async () => validateHealth(malformed));
    render(<MarketplaceHealthPage />);
    expect(await screen.findByText(/Respuesta de inteligencia inválida/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    expect(screen.queryByText("Saludable")).not.toBeInTheDocument();
  });
  it("renders a valid canonical unhealthy Health response as attention", async () => {
    const api = await import("../lib/adminIntelligenceApi"),
      unhealthy = validHealth(),
      payment = healthGroup(unhealthy, "payments");
    payment.counters.confirmed_state_mismatches = 1;
    payment.counters.invalid_confirmed_state_details = [{
      order_id: id(9), checkout_status: "paid", order_status: "invalid",
      payment_status: "paid", allocation_status: "held",
    }];
    payment.failing_check_count = 2;
    payment.healthy = false;
    unhealthy.healthy = false;
    vi.mocked(api.getHealth).mockResolvedValue(validateHealth(unhealthy));
    render(<MarketplaceHealthPage />);
    expect(await screen.findByText("Requiere atención")).toBeInTheDocument();
    expect(screen.getByText("2 fallas")).toBeInTheDocument();
  });
});
