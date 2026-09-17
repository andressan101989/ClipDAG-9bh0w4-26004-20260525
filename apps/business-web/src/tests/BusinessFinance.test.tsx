import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessFinancePage } from "../pages/finance/BusinessFinancePage";

const auth = vi.hoisted(() => ({ accessType: "owner" as "owner" | "member" }));
const billing = vi.hoisted(() => ({
  overview: vi.fn(), checkout: vi.fn(),
}));
vi.mock("../auth/BusinessAuthProvider", () => ({
  useBusinessAuth: () => ({ currentBusiness: { businessOwnerId: "owner-1" }, accessType: auth.accessType }),
}));
vi.mock("../lib/businessBillingApi", () => ({
  getBusinessBillingOverview: billing.overview,
  createStripeBdagCheckout: billing.checkout,
  usdInputToCents: (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null,
}));

const oldTopupId = "11111111-1111-4111-8111-111111111111";
const targetTopupId = "22222222-2222-4222-8222-222222222222";
const unknownTopupId = "33333333-3333-4333-8333-333333333333";

const overview = (targetStatus: "created" | "checkout_open" | "paid" | "credited" | "failed" | "expired" | "requires_review" | null = "credited") => ({
  businessOwnerId: "owner-1", bdagBalance: 250,
  stripe: {
    available: true, mode: "test" as const, currency: "usd" as const,
    minimumUsdCents: 50, maximumUsdCents: 99999999, bdagPerUsd: 100,
    topups: [
      ...(targetStatus ? [{
        id: targetTopupId, status: targetStatus, amountUsdCents: 2000, bdagAmount: 2000,
        createdAt: "2026-09-17T01:00:00Z", creditedAt: targetStatus === "credited" ? "2026-09-17T01:01:00Z" : null,
      }] : []),
      { id: oldTopupId, status: "credited" as const, amountUsdCents: 1000, bdagAmount: 1000, createdAt: "2026-09-17T00:00:00Z", creditedAt: "2026-09-17T00:01:00Z" },
    ],
  },
});

describe("Business Finance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.accessType = "owner";
    billing.overview.mockResolvedValue(overview());
  });

  it("shows canonical balance/history and owner-only hosted Checkout", async () => {
    render(<MemoryRouter initialEntries={["/finance"]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText(/250[,.]00 BDAG/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar con Stripe" })).toBeEnabled();
    expect(screen.getAllByText(/1000[,.]00 BDAG/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/payment_intent|customer_id|financial_transaction/i)).not.toBeInTheDocument();
  });

  it("keeps finance.read members strictly read-only", async () => {
    auth.accessType = "member";
    render(<MemoryRouter initialEntries={["/finance"]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText(/Solo el propietario puede añadir saldo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar con Stripe" })).not.toBeInTheDocument();
  });

  it.each(["created", "checkout_open"] as const)("does not use an old credited topup to confirm a new %s target", async (status) => {
    billing.overview.mockResolvedValue(overview(status));
    render(<MemoryRouter initialEntries={[`/finance?stripe=success&topup=${targetTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Confirmación pendiente.")).toBeInTheDocument();
    expect(screen.queryByText("Saldo actualizado.")).not.toBeInTheDocument();
  });

  it("confirms only the correlated credited topup", async () => {
    render(<MemoryRouter initialEntries={[`/finance?stripe=success&topup=${targetTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Saldo actualizado.")).toBeInTheDocument();
    expect(billing.checkout).not.toHaveBeenCalled();
  });

  it("keeps a paid correlated topup pending", async () => {
    billing.overview.mockResolvedValue(overview("paid"));
    render(<MemoryRouter initialEntries={[`/finance?stripe=success&topup=${targetTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Confirmación pendiente.")).toBeInTheDocument();
    expect(screen.queryByText("Saldo actualizado.")).not.toBeInTheDocument();
  });

  it.each([
    ["failed", "El pago no pudo confirmarse."],
    ["expired", "La sesión de pago expiró."],
    ["requires_review", "El pago requiere revisión."],
  ] as const)("renders %s without claiming the balance changed", async (status, message) => {
    billing.overview.mockResolvedValue(overview(status));
    render(<MemoryRouter initialEntries={[`/finance?stripe=success&topup=${targetTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("Saldo actualizado.")).not.toBeInTheDocument();
  });

  it.each([
    "/finance?stripe=success",
    `/finance?stripe=success&topup=${unknownTopupId}`,
    "/finance?stripe=success&topup=not-a-uuid",
  ])("uses neutral verification when correlation is unavailable: %s", async (entry) => {
    billing.overview.mockResolvedValue(overview(null));
    render(<MemoryRouter initialEntries={[entry]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Estamos verificando el estado del pago.")).toBeInTheDocument();
    expect(screen.queryByText("Saldo actualizado.")).not.toBeInTheDocument();
  });

  it("keeps cancel redirect read-only", async () => {
    render(<MemoryRouter initialEntries={[`/finance?stripe=cancelled&topup=${targetTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Pago cancelado.")).toBeInTheDocument();
    expect(screen.getByText("No se agregó saldo.")).toBeInTheDocument();
    expect(billing.checkout).not.toHaveBeenCalled();
  });

  it("bounds polling to six target-specific refreshes when the target remains missing", async () => {
    vi.useFakeTimers();
    try {
      billing.overview.mockResolvedValue(overview(null));
      render(<MemoryRouter initialEntries={[`/finance?stripe=success&topup=${unknownTopupId}`]}><BusinessFinancePage /></MemoryRouter>);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
      expect(billing.overview).toHaveBeenCalledTimes(7);
      expect(screen.getByText("Estamos verificando el estado del pago.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
