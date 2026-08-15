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
  it("rejects malformed Health counter types", () => {
    expect(() => validateHealth({ checked_at: at, healthy: true,
      groups: [{ name: "payments", check_count: 1, failing_check_count: 0, healthy: true, counters: { mismatch: Symbol("bad") } }], attention: [] })).toThrow("inválida");
  });
  it("rejects malformed Health attention severity and entity", () => {
    expect(() => validateHealth({ checked_at: at, healthy: true, groups: [], attention: [
      { reason_code: "x", entity_type: "product", entity_id: "bad", severity: "fraud", message: "x" },
    ] })).toThrow("inválida");
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
  it("shows a controlled health error instead of crashing", async () => {
    const api = await import("../lib/adminIntelligenceApi");
    vi.mocked(api.getHealth).mockRejectedValue(new Error("Respuesta de inteligencia inválida: groups"));
    render(<MarketplaceHealthPage />);
    expect(await screen.findByText("Respuesta de inteligencia inválida: groups")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});
