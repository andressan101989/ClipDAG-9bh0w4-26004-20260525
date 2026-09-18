import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAnalyticsPage } from "../pages/analytics/BusinessAnalyticsPage";
import type { BusinessAnalytics } from "../lib/businessAnalyticsApi";

const auth = vi.hoisted(() => ({ ownerId: "owner-a", name: "Tienda A" }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../auth/BusinessAuthProvider", () => ({
  useBusinessAuth: () => ({
    currentBusiness: { businessOwnerId: auth.ownerId, seller: { displayName: auth.name }, store: { name: auth.name } },
  }),
}));
vi.mock("../lib/businessAnalyticsApi", async (original) => ({
  ...(await original<typeof import("../lib/businessAnalyticsApi")>()),
  getBusinessAnalytics: api.get,
}));

function analytics(overrides: Partial<BusinessAnalytics> = {}): BusinessAnalytics {
  const base: BusinessAnalytics = {
    businessOwnerId: auth.ownerId,
    range: "30d",
    timezone: "UTC",
    generatedAt: "2026-09-18T12:00:00Z",
    window: { currentStart: "2026-08-20T00:00:00Z", currentEnd: "2026-09-19T00:00:00Z", previousStart: "2026-07-21T00:00:00Z", previousEnd: "2026-08-20T00:00:00Z" },
    commerce: {
      current: { gmvBdag: "125.5", orders: 5, units: 8, productViews: 40, cartAdds: 7, refundedBdag: "10" },
      previous: { gmvBdag: "100", orders: 4, units: 4, productViews: 0, cartAdds: 2, refundedBdag: "0" },
      comparisons: { gmvPercent: "25.5", ordersPercent: "25", unitsPercent: "100", productViewsPercent: null },
      daily: [
        { day: "2026-09-17", gmvBdag: "0", orders: 0, units: 0, productViews: 0 },
        { day: "2026-09-18", gmvBdag: "125.5", orders: 5, units: 8, productViews: 40 },
      ],
      products: { items: [{ productId: "product-1", title: "Producto Uno", imageUrl: null, views: 20, units: 4, orders: 3, gmvBdag: "75.5" }], totalCount: 25 },
      variants: { items: [{ variantId: "variant-1", productId: "product-1", label: "SKU UNO", views: 10, units: 2, orders: 2, gmvBdag: "50" }], totalCount: 1 },
      sources: [{ source: "shop", views: 30, cartAdds: 5, orders: 4, units: 6, gmvBdag: "100" }],
    },
    ads: { authorized: false, data: null },
    finance: { authorized: false, data: null },
    payouts: { authorized: false, data: null },
  };
  return { ...base, ...overrides };
}

describe("Business Analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.ownerId = "owner-a"; auth.name = "Tienda A";
    api.get.mockResolvedValue(analytics());
  });

  it("renders canonical KPIs, neutral previous-zero comparison, products and sources", async () => {
    render(<BusinessAnalyticsPage />);
    expect(await screen.findByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByText("Tienda A")).toBeInTheDocument();
    expect(screen.getByText("Producto Uno")).toBeInTheDocument();
    expect(screen.getByText("Tienda", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("Sin base comparable")).toBeInTheDocument();
    expect(screen.getByText("25 productos en el período")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Tendencia diaria de GMV/i })).toBeInTheDocument();
  });

  it("requests each supported range without using browser date boundaries", async () => {
    render(<BusinessAnalyticsPage />);
    await screen.findByText("Producto Uno");
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("owner-a", "7d"));
    fireEvent.click(screen.getByRole("button", { name: "90D" }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("owner-a", "90d"));
  });

  it("renders authorized optional sections and omits unauthorized sections instead of showing zero", async () => {
    api.get.mockResolvedValue(analytics({
      ads: { authorized: true, data: { activeCampaigns: 2, impressions: 100, clicks: 10, spentBdag: "20", attributedOrders: 3, attributedGmvBdag: "80", roas: "4" } },
      finance: { authorized: true, data: { bdagBalance: "250", settledOrders: 4, sellerNetBdag: "120" } },
      payouts: { authorized: true, data: { pendingCount: 1, broadcastingCount: 2, completedCount: 3, completedBdag: "99" } },
    }));
    render(<BusinessAnalyticsPage />);
    expect(await screen.findByRole("heading", { name: "Publicidad" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Resumen financiero" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retiros" })).toBeInTheDocument();
    expect(screen.queryByText(/Sin permiso/i)).not.toBeInTheDocument();
  });

  it("shows a valid empty state rather than an error", async () => {
    const empty = analytics();
    empty.commerce.current = { gmvBdag: "0", orders: 0, units: 0, productViews: 0, cartAdds: 0, refundedBdag: "0" };
    empty.commerce.products = { items: [], totalCount: 0 };
    empty.commerce.variants = { items: [], totalCount: 0 };
    empty.commerce.sources = [];
    api.get.mockResolvedValue(empty);
    render(<BusinessAnalyticsPage />);
    expect(await screen.findByText("Aún no hay actividad en este período.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears old business data and ignores a stale response", async () => {
    let resolveA!: (value: BusinessAnalytics) => void;
    const pendingA = new Promise<BusinessAnalytics>((resolve) => { resolveA = resolve; });
    api.get.mockReturnValueOnce(pendingA).mockResolvedValueOnce(analytics({ businessOwnerId: "owner-b", commerce: { ...analytics().commerce, products: { items: [{ ...analytics().commerce.products.items[0], title: "Producto B" }], totalCount: 1 } } }));
    const view = render(<BusinessAnalyticsPage />);
    auth.ownerId = "owner-b"; auth.name = "Tienda B";
    view.rerender(<BusinessAnalyticsPage />);
    expect(await screen.findByText("Producto B")).toBeInTheDocument();
    resolveA(analytics({ commerce: { ...analytics().commerce, products: { items: [{ ...analytics().commerce.products.items[0], title: "Producto A tardío" }], totalCount: 1 } } }));
    await waitFor(() => expect(screen.queryByText("Producto A tardío")).not.toBeInTheDocument());
    expect(screen.getByText("Producto B")).toBeInTheDocument();
  });

  it("offers retry after an error", async () => {
    api.get.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(analytics());
    render(<BusinessAnalyticsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Producto Uno")).toBeInTheDocument();
  });
});
