import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAdsPage } from "../pages/ads/BusinessAdsPage";
import { BusinessAdCreatePage } from "../pages/ads/BusinessAdCreatePage";
import { BusinessAdDetailPage } from "../pages/ads/BusinessAdDetailPage";

const auth = vi.hoisted(() => ({
  ownerId: "owner-a",
  accessType: "owner" as "owner" | "member",
  capabilities: new Set<string>(),
}));
const api = vi.hoisted(() => ({
  search: vi.fn(), products: vi.fn(), config: vi.fn(), create: vi.fn(), detail: vi.fn(), activate: vi.fn(), pause: vi.fn(), resume: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../auth/BusinessAuthProvider", () => ({
  useBusinessAuth: () => ({
    currentBusiness: { businessOwnerId: auth.ownerId },
    accessType: auth.accessType,
    hasCapability: (code: string) => auth.capabilities.has(code),
  }),
}));
vi.mock("../lib/adsManagerApi", async (original) => ({
  ...(await original<typeof import("../lib/adsManagerApi")>()),
  searchAdCampaigns: api.search,
  searchEligibleAdProducts: api.products,
  fetchAdConfig: api.config,
  createAdCampaignDraft: api.create,
  getAdCampaign: api.detail,
  activateAdCampaign: api.activate,
  pauseAdCampaign: api.pause,
  resumeAdCampaign: api.resume,
}));

const cursor = { createdAt: "2026-09-16T00:00:00Z", id: "cursor-id" };
const summary = { activeCampaigns: 1, totalBudgetBdag: 100, spentBdag: 99.97569444, impressions: 100, clicks: 5, orders: 1, attributedGmvBdag: 25 };
const campaign = (id: string, status = "completed") => ({
  id, productId: "product-1", productTitle: "Camisa", productImageUrl: null, name: `Campaña ${id}`, status,
  startsAt: "2026-09-16T00:00:00Z", endsAt: "2026-09-17T00:00:00Z", totalBudgetBdag: 100,
  spentBdag: 99.97569444, releasedBdag: 0.02430556, remainingReservedBdag: 0, eligibleElapsedSeconds: 3600,
  eligibilityState: false, eligibilityReason: "terminal", impressions: 100, clicks: 5, productViews: 12, cartAdds: 4,
  orders: 1, attributedGmvBdag: 25, finalizedAt: "2026-09-17T00:00:00Z", createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z",
});
const detail = (status = "completed") => ({
  ...campaign("campaign-1", status), fundedAt: "2026-09-16T00:00:00Z", pausedAt: status === "paused" ? "2026-09-16T12:00:00Z" : null,
  completedAt: status === "completed" ? "2026-09-17T00:00:00Z" : null,
  product: { id: "product-1", title: "Camisa", imageUrl: null, price: 25, currency: "BDAG" },
  deliverySurfaces: [{ surface: "marketplace_home", impressions: 100, clicks: 5, productViews: 0, cartAdds: 0, purchases: 0 }],
  attribution: [{ orderNumber: "ORDER-1", attributedGmvBdag: 25, attributedAt: "2026-09-16T12:00:00Z" }],
  finalization: status === "completed" ? { finalized_at: "2026-09-17T00:00:00Z" } : null,
});

function renderList() { return render(<MemoryRouter><BusinessAdsPage /></MemoryRouter>); }
function renderCreate() { return render(<MemoryRouter initialEntries={["/ads/new"]}><Routes><Route path="/ads/new" element={<BusinessAdCreatePage />} /><Route path="/ads/:campaignId" element={<div>Campaign destination</div>} /></Routes></MemoryRouter>); }
function renderDetail() { return render(<MemoryRouter initialEntries={["/ads/campaign-1"]}><Routes><Route path="/ads/:campaignId" element={<BusinessAdDetailPage />} /></Routes></MemoryRouter>); }

describe("Business Ads Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.ownerId = "owner-a";
    auth.accessType = "owner";
    auth.capabilities = new Set(["business.ads.read", "business.ads.manage"]);
    api.search.mockResolvedValue({ items: [], nextCursor: null, summary });
    api.products.mockResolvedValue({ items: [{ id: "product-1", title: "Camisa", thumbnailUrl: null, price: 25, currency: "BDAG", createdAt: "2026-09-01T00:00:00Z" }], nextCursor: null });
    api.config.mockResolvedValue({ minimumBudgetBdag: 10, maximumBudgetBdag: 1000000, minimumDurationSeconds: 3600, maximumDurationSeconds: 2592000 });
    api.create.mockResolvedValue({ id: "campaign-1" });
    api.detail.mockResolvedValue(detail());
    api.activate.mockResolvedValue({}); api.pause.mockResolvedValue({}); api.resume.mockResolvedValue({});
  });

  it("paginates without duplicates and resets when the selected business changes", async () => {
    api.search
      .mockResolvedValueOnce({ items: [campaign("1")], nextCursor: cursor, summary })
      .mockResolvedValueOnce({ items: [campaign("1"), campaign("2")], nextCursor: null, summary })
      .mockResolvedValueOnce({ items: [campaign("3")], nextCursor: null, summary });
    const view = renderList();
    expect(await screen.findByText("Campaña 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("Campaña 2")).toBeInTheDocument();
    expect(screen.getAllByText("Campaña 1")).toHaveLength(1);
    auth.ownerId = "owner-b";
    view.rerender(<MemoryRouter><BusinessAdsPage /></MemoryRouter>);
    expect(await screen.findByText("Campaña 3")).toBeInTheDocument();
    expect(screen.queryByText("Campaña 1")).not.toBeInTheDocument();
    expect(api.search).toHaveBeenLastCalledWith("owner-b", { status: undefined, cursor: undefined });
  });

  it("shows read-only reporting without create for ads.read", async () => {
    auth.capabilities = new Set(["business.ads.read"]);
    api.search.mockResolvedValue({ items: [campaign("read")], nextCursor: null, summary });
    renderList();
    expect(await screen.findByText("Vista de solo lectura. Puedes consultar campañas y rendimiento.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear campaña" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/99[,.]98 BDAG/).length).toBeGreaterThan(0);
  });

  it("creates only a canonical draft from eligible products and live config", async () => {
    renderCreate();
    expect(await screen.findByText("Camisa")).toBeInTheDocument();
    expect(screen.getByText(/10[,.]00 BDAG/)).toBeInTheDocument();
    expect(screen.getByText(/1[.,]?000[.,]?000[,.]00 BDAG/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Nombre de campaña/), { target: { value: "Lanzamiento" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear campaña draft" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ productId: "product-1", name: "Lanzamiento", budgetBdag: 10 })));
    expect(await screen.findByText("Campaign destination")).toBeInTheDocument();
  });

  it("makes owner activation explicit and confirmed", async () => {
    api.detail.mockResolvedValue(detail("draft"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Activar y financiar" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith("campaign-1"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Ads escrow"));
  });

  it("never exposes activation to a member with ads.manage", async () => {
    auth.accessType = "member";
    api.detail.mockResolvedValue(detail("draft"));
    renderDetail();
    expect(await screen.findByText("La activación y financiación requieren al propietario.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar y financiar" })).not.toBeInTheDocument();
  });

  it("allows manage pause/resume without exposing spend, release or finalization actions", async () => {
    api.detail.mockResolvedValueOnce(detail("active")).mockResolvedValueOnce(detail("active"));
    const view = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Pausar" }));
    await waitFor(() => expect(api.pause).toHaveBeenCalledWith("campaign-1"));
    view.unmount();
    api.detail.mockResolvedValue(detail("paused"));
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Reanudar" }));
    await waitFor(() => expect(api.resume).toHaveBeenCalledWith("campaign-1"));
    expect(screen.queryByRole("button", { name: /gastar|liberar|finalizar/i })).not.toBeInTheDocument();
  });

  it("renders canonical delivery, attribution and zero-safe CTR", async () => {
    const value = detail(); value.impressions = 0; value.clicks = 0;
    api.detail.mockResolvedValue(value);
    renderDetail();
    expect(await screen.findByText("marketplace_home")).toBeInTheDocument();
    expect(screen.getByText("ORDER-1")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText(/99[,.]98 BDAG/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0[,.]02 BDAG/).length).toBeGreaterThan(0);
  });
});
