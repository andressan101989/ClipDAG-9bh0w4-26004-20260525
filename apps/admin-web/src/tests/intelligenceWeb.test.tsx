import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateAdDetail,
  validateAdsPage,
  validateActivityPage,
  validateCreatorDetail,
  validateCreatorOverview,
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
  const original =
    await importOriginal<typeof import("../lib/adminIntelligenceApi")>();
  return { ...original, searchAds: vi.fn(), getHealth: vi.fn() };
});
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("B8C deep runtime validation", () => {
  it("rejects malformed creator financial and item-level payloads", () => {
    expect(() =>
      validateCreatorOverview({
        range: "30d",
        generated_at: "bad",
        summary: {},
        surface_breakdown: [],
      }),
    ).toThrow("inválida");
    expect(() =>
      validateCreatorDetail({
        range: "30d",
        creator: { id: id(1), username: null, display_name: null },
        summary: {
          orders: 1,
          units: 1,
          product_opens: 0,
          add_to_cart: 0,
          attributed_gmv: "10",
          commission_generated: "1",
          commission_released: "1",
          commission_reversed: "0",
          commission_net: "1",
        },
        surface_breakdown: [],
        top_products: [],
        item_trace: [{ order_item_id: "bad" }],
      }),
    ).toThrow("inválida");
  });
  it("rejects malformed promotion snapshots", () => {
    expect(() =>
      validatePromotionPage({
        promotions: [{ id: "bad" }],
        page_size: 1,
        next_cursor: null,
      }),
    ).toThrow("inválida");
    expect(() =>
      validatePromotionDetail({
        promotion: { id: id(1) },
        seller: {},
        store: {},
        product: {},
        historical_usage: [
          {
            order_id: id(1),
            order_item_id: id(2),
            quantity: 1,
            base_unit_price: "NaN",
            discount_amount: "1",
            unit_price: "9",
            line_total: "9",
          },
        ],
      }),
    ).toThrow("inválida");
  });
  it("rejects malformed Ads money, finalization and nested events", () => {
    expect(() =>
      validateAdsPage({
        campaigns: [{ id: "bad" }],
        page_size: 1,
        next_cursor: null,
      }),
    ).toThrow("inválida");
    expect(() =>
      validateAdDetail({
        campaign: {
          id: id(1),
          seller_id: id(2),
          store_id: id(3),
          product_id: id(4),
          status: "active",
          starts_at: "2026-01-01T00:00:00Z",
          ends_at: "2026-02-01T00:00:00Z",
        },
        financial: {
          total_budget: "100",
          spent: "NaN",
          released: "0",
          remaining_reserved: "100",
        },
        financial_events: [],
        finalization: null,
        events: {},
        attribution: { orders: 0, units: 0, gmv: "0" },
      }),
    ).toThrow("inválida");
  });
  it("rejects malformed health counters and audit cursors", () => {
    expect(() =>
      validateHealth({
        checked_at: "bad",
        healthy: true,
        groups: [],
        attention: [],
      }),
    ).toThrow("inválida");
    expect(() =>
      validateActivityPage({
        activity: [],
        page_size: 0,
        next_cursor: { created_at: "bad", id: id(1) },
      }),
    ).toThrow("inválida");
  });
});

describe("B8C controlled page errors", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders Ads data without financial mutation controls", async () => {
    const api = await import("../lib/adminIntelligenceApi");
    vi.mocked(api.searchAds).mockResolvedValue({
      items: [
        {
          id: id(1),
          name: "Campaña",
          seller_id: id(2),
          seller_name: "Seller",
          store_id: id(3),
          store_name: "Store",
          product_id: id(4),
          product_title: "Producto",
          status: "active",
          eligibility_state: true,
          eligibility_reason: "eligible",
          starts_at: "2026-08-01T00:00:00Z",
          ends_at: "2026-08-20T00:00:00Z",
          total_budget: "100",
          spent: "20",
          released: "0",
          remaining_reserved: "80",
          funded_at: "2026-08-01T00:00:00Z",
          completed_at: null,
          attention: false,
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      nextCursor: null,
      pageSize: 1,
    });
    render(
      <MemoryRouter>
        <MarketplaceAdsPage />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText("Campaña")).length).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        /liberar presupuesto|gastar presupuesto|finalizar campaña/i,
      ),
    ).not.toBeInTheDocument();
  });
  it("shows a controlled health error instead of crashing", async () => {
    const api = await import("../lib/adminIntelligenceApi");
    vi.mocked(api.getHealth).mockRejectedValue(
      new Error("Respuesta de inteligencia inválida: groups"),
    );
    render(<MarketplaceHealthPage />);
    expect(
      await screen.findByText("Respuesta de inteligencia inválida: groups"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reintentar/i }),
    ).toBeInTheDocument();
  });
});
