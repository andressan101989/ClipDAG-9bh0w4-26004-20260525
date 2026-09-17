import { render, screen } from "@testing-library/react";
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

const overview = {
  businessOwnerId: "owner-1", bdagBalance: 250,
  stripe: {
    available: true, mode: "test" as const, currency: "usd" as const,
    minimumUsdCents: 50, maximumUsdCents: 99999999, bdagPerUsd: 100,
    topups: [{ id: "local-topup", status: "credited" as const, amountUsdCents: 1000, bdagAmount: 1000, createdAt: "2026-09-17T00:00:00Z", creditedAt: "2026-09-17T00:01:00Z" }],
  },
};

describe("Business Finance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.accessType = "owner";
    billing.overview.mockResolvedValue(overview);
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

  it("treats success and cancel redirects as read-only UX", async () => {
    const success = render(<MemoryRouter initialEntries={["/finance?stripe=success"]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Saldo actualizado.")).toBeInTheDocument();
    expect(billing.checkout).not.toHaveBeenCalled();
    success.unmount();
    render(<MemoryRouter initialEntries={["/finance?stripe=cancelled"]}><BusinessFinancePage /></MemoryRouter>);
    expect(await screen.findByText("Pago cancelado.")).toBeInTheDocument();
    expect(screen.getByText("No se agregó saldo.")).toBeInTheDocument();
    expect(billing.checkout).not.toHaveBeenCalled();
  });
});
