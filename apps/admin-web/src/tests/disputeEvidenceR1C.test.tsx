import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDisputeEvidenceUrl, validateDisputeDetail } from "../lib/adminApi";
import { supabase } from "../lib/supabase";
import { MarketplaceDisputeDetailPage } from "../pages/MarketplaceDisputeDetailPage";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
const id = (suffix: string) => `20000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const detail = {
  dispute: { id: id("1"), status: "open", reason_code: "damaged", buyer_note: "Llegó roto", created_at: "2026-08-21T12:00:00Z", resolved_at: null },
  order: { id: id("2"), order_number: "ORD-R1C", status: "shipped", currency: "BDAG", total: "25.00000000", created_at: "2026-08-21T11:00:00Z" },
  buyer: { id: id("3"), username: "buyer", display_name: "Compradora" }, seller: { id: id("4"), display_name: "Vendedor", status: "approved" }, store: { id: id("5"), name: "Tienda", slug: "tienda", status: "active" },
  affected_items: [{ id: id("6"), product_id: id("7"), variant_id: id("8"), product_title: "Zapatos", variant_title: "Negro / 42", sku: "ZAP-42", options: [{ name: "Color", value: "Negro" }], image_url: "https://example.test/product.jpg", unit_price: "25.00000000", quantity: 1, line_total: "25.00000000", currency: "BDAG" }],
  buyer_evidence_asset_ids: [id("9")], seller_response: { id: id("10"), note: "El producto salió íntegro", created_at: "2026-08-21T13:00:00Z", evidence_asset_ids: [id("11")] },
  payment: null, allocation: null, shipment: null, settlement: null, settlement_legs: [], reversal: null, reversal_legs: [], creator_attributions: [], creator_allocations: [], review_actions: [], final_decision: null, timeline: [], admin_actions: [],
};

describe("Marketplace Admin dispute evidence R1C", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: structuredClone(detail), error: null } as never);
    vi.mocked(supabase.functions.invoke).mockImplementation(async (_name, input) => ({ data: { success: true, data: { assetId: (input?.body as { asset_id: string }).asset_id, url: `https://signed.test/${(input?.body as { asset_id: string }).asset_id}` } }, error: null } as never));
  });
  it("validates immutable items and bounded unique evidence arrays", () => {
    const parsed = validateDisputeDetail(structuredClone(detail));
    expect(parsed.affected_items?.[0].product_title).toBe("Zapatos");
    const duplicate = structuredClone(detail); duplicate.buyer_evidence_asset_ids = [id("9"), id("9")];
    expect(() => validateDisputeDetail(duplicate)).toThrow("buyer_evidence_asset_ids");
    const malformed = structuredClone(detail); malformed.seller_response.evidence_asset_ids = ["bad"];
    expect(() => validateDisputeDetail(malformed)).toThrow("seller_response.evidence_asset_ids");
  });
  it("uses the existing private-media Edge helper without persisting its signed URL", async () => {
    await expect(getDisputeEvidenceUrl(id("9"))).resolves.toContain("https://signed.test/");
    expect(supabase.functions.invoke).toHaveBeenCalledWith("get-media-url", { body: { asset_id: id("9") } });
  });
  it("renders both case files, keeps financial facts and opens an image preview", async () => {
    render(<MemoryRouter initialEntries={[`/marketplace/disputes/${id("1")}`]}><Routes><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Zapatos")).toBeInTheDocument();
    expect(screen.getByText("Llegó roto")).toBeInTheDocument();
    expect(screen.getByText("El producto salió íntegro")).toBeInTheDocument();
    expect(screen.getByText("Hechos financieros")).toBeInTheDocument();
    expect(screen.getByText("Creator Commerce")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText("Evidencia del comprador 1")).toBeInTheDocument());
    await userEvent.click(screen.getByAltText("Evidencia del comprador 1"));
    expect(screen.getByRole("dialog", { name: "Vista ampliada de evidencia del comprador" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Reembolsar al comprador" })).toHaveValue("refund_buyer");
    expect(screen.getByRole("option", { name: "Resolver a favor del vendedor y liberar ahora" })).toHaveValue("release_seller");
    expect(screen.getByRole("option", { name: "Rechazar reclamo y mantener liberación normal" })).toHaveValue("reject_claim");
  });
  it("renders neutral empty states", async () => {
    const empty = { ...structuredClone(detail), buyer_evidence_asset_ids: [], seller_response: null };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: empty, error: null } as never);
    render(<MemoryRouter initialEntries={[`/marketplace/disputes/${id("1")}`]}><Routes><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("El vendedor aún no ha presentado una respuesta.")).toBeInTheDocument();
    expect(screen.getByText("Sin evidencia fotográfica adjunta.")).toBeInTheDocument();
  });
  it("keeps the decision read-only while offering only pending release after reject_claim", async () => {
    const resolved = { ...structuredClone(detail), dispute: { ...detail.dispute, status: "rejected", resolved_at: "2026-08-21T15:00:00Z" }, allocation: { id: id("14"), status: "held", gross_amount: "25.00000000", platform_fee_amount: "2.50000000", seller_net_amount: "22.50000000", creator_commission_amount: "0.00000000", released_at: null, refunded_at: null }, final_decision: { id: id("12"), resolver_id: id("13"), outcome: "reject_claim", reason_code: "evidence_reviewed", note: null, financial_result: { money_moved: false, settlement_eligible: true }, decided_at: "2026-08-21T15:00:00Z" } };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: resolved, error: null } as never);
    render(<MemoryRouter initialEntries={[`/marketplace/disputes/${id("1")}`]}><Routes><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Este expediente es de solo lectura.")).toBeInTheDocument();
    expect(screen.queryByText("Resolver disputa")).not.toBeInTheDocument();
    expect(screen.getByText("Fondos pendientes")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Liberar fondos pendientes al vendedor" })).toHaveValue("release_seller");
  });
  it("does not offer follow-up release after funds are released or a refund decision", async () => {
    const base = { ...structuredClone(detail), dispute: { ...detail.dispute, status: "rejected", resolved_at: "2026-08-21T15:00:00Z" }, allocation: { id: id("14"), status: "released", gross_amount: "25.00000000", platform_fee_amount: "2.50000000", seller_net_amount: "22.50000000", creator_commission_amount: "0.00000000", released_at: "2026-08-21T15:00:00Z", refunded_at: null }, settlement: { id: id("15"), status: "completed", gross_amount: "25.00000000", seller_net_amount: "22.50000000", platform_fee_amount: "2.50000000", creator_commission_amount: "0.00000000", released_at: "2026-08-21T15:00:00Z" }, final_decision: { id: id("12"), resolver_id: id("13"), outcome: "reject_claim", reason_code: "evidence_reviewed", note: null, financial_result: { money_moved: false, settlement_eligible: true }, decided_at: "2026-08-21T15:00:00Z" } };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: base, error: null } as never);
    const { unmount } = render(<MemoryRouter initialEntries={[`/marketplace/disputes/${id("1")}`]}><Routes><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Este expediente es de solo lectura.")).toBeInTheDocument();
    expect(screen.queryByText("Fondos pendientes")).not.toBeInTheDocument();
    unmount();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ...base, settlement: null, allocation: { ...base.allocation, status: "held", released_at: null }, final_decision: { ...base.final_decision, outcome: "refund_buyer", financial_result: { money_moved: true } } }, error: null } as never);
    render(<MemoryRouter initialEntries={[`/marketplace/disputes/${id("1")}`]}><Routes><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Este expediente es de solo lectura.")).toBeInTheDocument();
    expect(screen.queryByText("Fondos pendientes")).not.toBeInTheDocument();
  });
});
