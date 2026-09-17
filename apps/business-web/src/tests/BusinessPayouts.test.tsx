import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessPayoutsPage } from "../pages/finance/BusinessPayoutsPage";
import type { BusinessPayout } from "../lib/businessPayoutsApi";

const auth = vi.hoisted(() => ({ ownerId: "owner-1", accessType: "owner" as "owner" | "member" }));
const api = vi.hoisted(() => ({ config: vi.fn(), quote: vi.fn(), request: vi.fn(), search: vi.fn() }));

vi.mock("../auth/BusinessAuthProvider", () => ({
  useBusinessAuth: () => ({ currentBusiness: { businessOwnerId: auth.ownerId }, accessType: auth.accessType }),
}));
vi.mock("../lib/businessPayoutsApi", () => ({
  getWithdrawalConfig: api.config,
  getWithdrawalQuote: api.quote,
  requestBusinessPayout: api.request,
  searchBusinessPayouts: api.search,
}));

const config = {
  minimumBdag: 100, maximumBdag: 1_000_000, feeBps: 100, bdagPerUsd: 100,
  maxActivePerUser: 10, requiredConfirmations: 2,
  rails: [
    { token: "USDT" as const, chainId: "1", network: "Ethereum", decimals: 6 },
    { token: "USDC" as const, chainId: "1", network: "Ethereum", decimals: 6 },
    { token: "USDC" as const, chainId: "8453", network: "Base", decimals: 6 },
  ],
};
const quote = { grossBdag: 100, feeBdag: 1, netBdag: 99, estimatedStablecoinAmount: .99, feeBps: 100, minimumBdag: 100, token: "USDT", chainId: "1", network: "Ethereum" };
const payout: BusinessPayout = {
  id: "payout-1", status: "broadcasting" as const, bdagAmount: 100, feeBdag: 1, netBdag: 99,
  stablecoinAmount: .99, tokenType: "USDT", chainId: "1", maskedDestination: "0x1234…ABCD",
  txHash: `0x${"a".repeat(64)}`, confirmations: 1, requiredConfirmations: 2,
  createdAt: "2026-09-17T00:00:00Z", broadcastAt: "2026-09-17T00:01:00Z",
  confirmedAt: null, completedAt: null, failedAt: null, failureReason: null,
};
const page = (items = [payout], nextCursor: null | { createdAt: string; id: string } = null) => ({
  businessOwnerId: auth.ownerId, bdagBalance: 250, items, nextCursor,
  summary: { pendingCount: 0, broadcastingCount: 1, completedCount: 0, failedCount: 0, totalCompletedBdag: 0 },
});

describe("Business Payouts", () => {
  beforeEach(() => {
    vi.clearAllMocks(); auth.ownerId = "owner-1"; auth.accessType = "owner";
    api.config.mockResolvedValue(config); api.quote.mockResolvedValue(quote); api.request.mockResolvedValue({ id: "payout-2", status: "broadcasted" }); api.search.mockResolvedValue(page());
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows canonical balance, masked history and the owner-only form", async () => {
    render(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    expect(await screen.findByText(/250[,.]00 BDAG/)).toBeInTheDocument();
    expect(screen.getByText("0x1234…ABCD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar retiro" })).toBeDisabled();
    expect(screen.queryByText(/fin_txn|ledger_account|settlement_fin/i)).not.toBeInTheDocument();
  });

  it("keeps members read-only even with payout visibility", async () => {
    auth.accessType = "member";
    render(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    expect(await screen.findByText(/Solo el propietario puede retirar fondos/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar retiro" })).not.toBeInTheDocument();
  });

  it("uses the server quote and sends an owner request only after confirmation", async () => {
    render(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    await screen.findByText(/250[,.]00 BDAG/);
    fireEvent.change(screen.getByLabelText("Monto BDAG"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Dirección de destino"), { target: { value: `0x${"1".repeat(40)}` } });
    expect(await screen.findByText("0.99 USDT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar retiro" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("100", `0x${"1".repeat(40)}`, expect.objectContaining({ token: "USDT", chainId: "1" })));
    expect(window.confirm).toHaveBeenCalled();
  });

  it("appends cursor pages without duplicates", async () => {
    api.search
      .mockResolvedValueOnce(page([payout], { createdAt: payout.createdAt, id: payout.id }))
      .mockResolvedValueOnce(page([payout, { ...payout, id: "payout-2", status: "completed" as const }], null));
    render(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("0x1234…ABCD")).toHaveLength(2);
  });

  it("clears state when the selected business changes", async () => {
    const view = render(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    await screen.findByText(/250[,.]00 BDAG/);
    auth.ownerId = "owner-2";
    api.search.mockResolvedValue(page([], null));
    view.rerender(<MemoryRouter><BusinessPayoutsPage /></MemoryRouter>);
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("owner-2", expect.anything()));
    expect(screen.queryByText("0x1234…ABCD")).not.toBeInTheDocument();
  });
});
