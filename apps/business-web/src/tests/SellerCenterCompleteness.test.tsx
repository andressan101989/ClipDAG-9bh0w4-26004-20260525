import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessOrdersPage } from "../pages/orders/BusinessOrdersPage";
import { BusinessProductDetailPage } from "../pages/products/BusinessProductDetailPage";
import { BusinessShippingPage } from "../pages/products/BusinessShippingPage";

const auth = vi.hoisted(() => ({
  ownerId: "owner-a",
  accessType: "owner" as "owner" | "member",
  capabilities: new Set<string>(),
}));

const api = vi.hoisted(() => ({
  searchOrders: vi.fn(),
  searchReturns: vi.fn(),
  searchDisputes: vi.fn(),
  searchShippingProfiles: vi.fn(),
  refundReturnWithoutShipment: vi.fn(),
  confirmReturnReceived: vi.fn(),
  respondReturn: vi.fn(),
  sendReturnLabel: vi.fn(),
  respondDispute: vi.fn(),
  upsertShippingProfile: vi.fn(),
  getProduct: vi.fn(),
  variantAction: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({ supabase: {} }));

vi.mock("../auth/BusinessAuthProvider", () => {
  let cachedOwner = "";
  let currentBusiness: Record<string, unknown>;
  return {
    useBusinessAuth: () => {
      if (cachedOwner !== auth.ownerId) {
        cachedOwner = auth.ownerId;
        currentBusiness = {
          businessOwnerId: auth.ownerId,
          accessType: auth.accessType,
          membershipId: auth.accessType === "owner" ? null : "membership-id",
          capabilities: [...auth.capabilities],
          seller: { userId: auth.ownerId, status: "approved", displayName: "Business" },
          store: { id: "store-id", sellerId: auth.ownerId, name: "Store", slug: "store", status: "active" },
        };
      }
      return { currentBusiness, accessType: auth.accessType, hasCapability: (code: string) => auth.capabilities.has(code) };
    },
  };
});

vi.mock("../lib/sellerCenterApi", async (original) => ({
  ...(await original<typeof import("../lib/sellerCenterApi")>()),
  searchOrders: api.searchOrders,
  searchReturns: api.searchReturns,
  searchDisputes: api.searchDisputes,
  searchShippingProfiles: api.searchShippingProfiles,
  refundReturnWithoutShipment: api.refundReturnWithoutShipment,
  confirmReturnReceived: api.confirmReturnReceived,
  respondReturn: api.respondReturn,
  sendReturnLabel: api.sendReturnLabel,
  respondDispute: api.respondDispute,
  upsertShippingProfile: api.upsertShippingProfile,
  getProduct: api.getProduct,
  variantAction: api.variantAction,
}));

vi.mock("../lib/businessMediaApi", () => ({ uploadBusinessOperationalMedia: vi.fn() }));
vi.mock("../components/BusinessMedia", () => ({ BusinessMediaPicker: () => null }));

const nextCursor = { createdAt: "2026-09-16T12:00:00Z", id: "cursor-id" };
const order = (id: string) => ({ id, order_number: `ORDER-${id}`, status: "confirmed", currency: "BDAG", total: 12, created_at: "2026-09-16T00:00:00Z", items: [] });
const returnItem = (id: string, shipment: Record<string, unknown> | null = null) => ({ id, order_id: `order-${id}`, order_number: `RETURN-${id}`, status: "approved", created_at: "2026-09-16T00:00:00Z", buyer_note: "Nota", shipment, refund_status: shipment?.status === "received" ? "refunded" : null, refunded_at: shipment?.status === "received" ? "2026-09-17T00:00:00Z" : null, resolution_mode: shipment?.status === "received" ? "return_received" : null });
const dispute = (id: string) => ({ id, order_id: `order-${id}`, order_number: `DISPUTE-${id}`, status: "open", created_at: "2026-09-16T00:00:00Z", reason_code: "not_received", buyer_note: "Nota" });
const region = (id: string, country: string) => ({ id, status: "active", country_code: country, region_code: null, shipping_price: 4, free_shipping_threshold: null, transit_days_min: 2, transit_days_max: 5 });
const profile = (id: string, regions = [region(`region-${id}`, "US")]) => ({ id, name: `Profile ${id}`, store_id: "store-id", configuration_status: "ready", ships_from_country: "US", processing_days_min: 1, processing_days_max: 3, return_policy_summary: "Returns", regions, created_at: "2026-09-16T00:00:00Z" });

function renderOrders(path = "/orders") {
  return render(<MemoryRouter initialEntries={[path]}><BusinessOrdersPage /></MemoryRouter>);
}

function productDetail(variants: Array<Record<string, unknown>>) {
  return {
    product: { id: "product-id", title: "Producto", status: "draft", price: 10, category_id: "category-id", stock: 0, product_type: "physical", readiness_reason: null, shipping_profile_id: null },
    media: [],
    options: [],
    categories: [{ id: "category-id", name: "General" }],
    variants,
  };
}

describe("Seller Center C5/C6 completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.ownerId = "owner-a";
    auth.accessType = "owner";
    auth.capabilities = new Set(["business.orders.read", "business.returns.manage", "business.disputes.read", "business.catalog.manage"]);
    api.searchOrders.mockResolvedValue({ items: [], nextCursor: null });
    api.searchReturns.mockResolvedValue({ items: [], nextCursor: null });
    api.searchDisputes.mockResolvedValue({ items: [], nextCursor: null });
    api.searchShippingProfiles.mockResolvedValue({ items: [], nextCursor: null });
    api.refundReturnWithoutShipment.mockResolvedValue(undefined);
    api.confirmReturnReceived.mockResolvedValue(undefined);
    api.upsertShippingProfile.mockResolvedValue("profile-id");
    api.variantAction.mockResolvedValue(undefined);
  });

  it("paginates and deduplicates orders, then resets for a status filter", async () => {
    api.searchOrders
      .mockResolvedValueOnce({ items: [order("1")], nextCursor })
      .mockResolvedValueOnce({ items: [order("1"), order("2")], nextCursor: null })
      .mockResolvedValueOnce({ items: [order("3")], nextCursor: null });
    renderOrders();
    expect(await screen.findByText("ORDER-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("ORDER-2")).toBeInTheDocument();
    expect(screen.getAllByText("ORDER-1")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar pedidos por estado"), { target: { value: "confirmed" } });
    expect(await screen.findByText("ORDER-3")).toBeInTheDocument();
    expect(screen.queryByText("ORDER-1")).not.toBeInTheDocument();
    expect(api.searchOrders).toHaveBeenLastCalledWith("owner-a", { status: "confirmed", cursor: undefined });
  });

  it("resets paged orders when the selected business changes", async () => {
    api.searchOrders.mockResolvedValueOnce({ items: [order("A")], nextCursor: null }).mockResolvedValueOnce({ items: [order("B")], nextCursor: null });
    const view = renderOrders();
    expect(await screen.findByText("ORDER-A")).toBeInTheDocument();
    auth.ownerId = "owner-b";
    view.rerender(<MemoryRouter initialEntries={["/orders"]}><BusinessOrdersPage /></MemoryRouter>);
    expect(await screen.findByText("ORDER-B")).toBeInTheDocument();
    expect(screen.queryByText("ORDER-A")).not.toBeInTheDocument();
  });

  it("paginates returns and renders shipment, label and refund state", async () => {
    api.searchReturns
      .mockResolvedValueOnce({ items: [returnItem("1", { status: "received", label_sent_at: "2026-09-16T01:00:00Z", tracking_number: "TRACK-1", received_at: "2026-09-17T00:00:00Z" })], nextCursor })
      .mockResolvedValueOnce({ items: [returnItem("2")], nextCursor: null });
    renderOrders("/orders?view=returns");
    expect(await screen.findByText("TRACK-1")).toBeInTheDocument();
    expect(screen.getByText("Enviada")).toBeInTheDocument();
    expect(screen.getByText("return_received")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("RETURN-2")).toBeInTheDocument();
    expect(api.searchReturns).toHaveBeenLastCalledWith("owner-a", nextCursor);
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("paginates disputes without duplicates", async () => {
    api.searchDisputes.mockResolvedValueOnce({ items: [dispute("1")], nextCursor }).mockResolvedValueOnce({ items: [dispute("1"), dispute("2")], nextCursor: null });
    renderOrders("/orders?view=disputes");
    expect(await screen.findByText("DISPUTE-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("DISPUTE-2")).toBeInTheDocument();
    expect(screen.getAllByText("DISPUTE-1")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("offers direct keep-item refunds to owners for requested or approved returns without shipment", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.searchReturns.mockResolvedValue({ items: [
      { ...returnItem("requested"), status: "requested" },
      returnItem("approved"),
      { ...returnItem("requested-shipment", { status: "awaiting_buyer_shipment" }), status: "requested" },
      returnItem("approved-shipment", { status: "shipped", tracking_number: "TRACK-2" }),
    ], nextCursor: null });
    renderOrders("/orders?view=returns");
    const keepItemButtons = await screen.findAllByRole("button", { name: "Reembolsar y permitir que conserve el producto" });
    expect(keepItemButtons).toHaveLength(2);
    fireEvent.click(keepItemButtons[0]);
    await waitFor(() => expect(api.refundReturnWithoutShipment).toHaveBeenCalledWith("requested", expect.any(String)));
    expect(api.respondReturn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recibido y reembolsar" }));
    await waitFor(() => expect(api.confirmReturnReceived).toHaveBeenCalledWith("approved-shipment", expect.any(String)));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it("never presents requested or approved keep-item actions to a member", async () => {
    auth.accessType = "member";
    api.searchReturns.mockResolvedValue({ items: [{ ...returnItem("requested"), status: "requested" }, returnItem("approved")], nextCursor: null });
    renderOrders("/orders?view=returns");
    await screen.findByText("RETURN-requested");
    expect(screen.queryByRole("button", { name: "Reembolsar y permitir que conserve el producto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar recibido y reembolsar" })).not.toBeInTheDocument();
  });

  it("offers a return label only for approved returns without any shipment", async () => {
    api.searchReturns.mockResolvedValue({ items: [
      returnItem("no-shipment"),
      returnItem("awaiting", { status: "awaiting_buyer_shipment", label_sent_at: "2026-09-16T01:00:00Z" }),
      returnItem("shipped", { status: "shipped" }),
      { ...returnItem("refunded"), status: "refunded", refund_status: "refunded" },
    ], nextCursor: null });
    renderOrders("/orders?view=returns");
    expect(await screen.findAllByRole("button", { name: "Subir y enviar etiqueta" })).toHaveLength(1);
    expect(screen.getByText("RETURN-awaiting")).toBeInTheDocument();
    expect(screen.getByText("RETURN-shipped")).toBeInTheDocument();
    expect(screen.getByText("RETURN-refunded")).toBeInTheDocument();
  });

  it("reaches all paged shipping profiles without duplicates", async () => {
    const first = Array.from({ length: 30 }, (_, index) => profile(String(index + 1)));
    const second = [profile("30"), ...Array.from({ length: 23 }, (_, index) => profile(String(index + 31)))];
    api.searchShippingProfiles.mockResolvedValueOnce({ items: first, nextCursor }).mockResolvedValueOnce({ items: second, nextCursor: null });
    render(<MemoryRouter><BusinessShippingPage /></MemoryRouter>);
    expect(await screen.findByText("Profile 30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("Profile 53")).toBeInTheDocument();
    expect(screen.getAllByText("Profile 30")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("preserves all existing shipping regions on a name-only edit and supports add/remove", async () => {
    const regions = [region("r1", "US"), region("r2", "CA"), region("r3", "MX")];
    api.searchShippingProfiles.mockResolvedValue({ items: [profile("multi", regions)], nextCursor: null });
    render(<MemoryRouter><BusinessShippingPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("País región 3")).toHaveValue("MX");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Renamed profile" } });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar perfil" }).closest("form")!);
    await waitFor(() => expect(api.upsertShippingProfile).toHaveBeenCalled());
    let payload = api.upsertShippingProfile.mock.calls[0][0];
    expect(payload.p_regions).toHaveLength(3);
    expect(payload.p_regions.map((item: { id: string }) => item.id)).toEqual(["r1", "r2", "r3"]);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar región" }));
    expect(screen.getByLabelText("País región 4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar región" })[1]);
    fireEvent.submit(screen.getByRole("button", { name: "Guardar perfil" }).closest("form")!);
    await waitFor(() => expect(api.upsertShippingProfile).toHaveBeenCalledTimes(2));
    payload = api.upsertShippingProfile.mock.calls[1][0];
    expect(payload.p_regions).toHaveLength(3);
    expect(payload.p_regions.map((item: { id: string | null }) => item.id)).toEqual(["r1", "r3", null]);
  });

  it("uses every non-archived variant for default replacement and excludes archived variants", async () => {
    api.getProduct.mockResolvedValue(productDetail([
      { id: "default", sku: "SKU-1", title: "Uno", price: 10, compareAtPrice: null, status: "active", isDefault: true, imageAssetId: null, barcode: null, onHand: 1, reserved: 0, available: 1, lowStockThreshold: 0 },
      { id: "inactive-replacement", sku: "SKU-2", title: "Dos", price: 10, compareAtPrice: null, status: "inactive", isDefault: false, imageAssetId: null, barcode: null, onHand: 1, reserved: 0, available: 1, lowStockThreshold: 0 },
      { id: "active-replacement", sku: "SKU-3", title: "Tres", price: 10, compareAtPrice: null, status: "active", isDefault: false, imageAssetId: null, barcode: null, onHand: 1, reserved: 0, available: 1, lowStockThreshold: 0 },
      { id: "archived", sku: "SKU-4", title: "Archivada", price: 10, compareAtPrice: null, status: "archived", isDefault: false, imageAssetId: null, barcode: null, onHand: 1, reserved: 0, available: 1, lowStockThreshold: 0 },
    ]));
    api.searchShippingProfiles.mockResolvedValue({ items: [], nextCursor: null });
    const productView = render(<MemoryRouter initialEntries={["/products/product-id"]}><Routes><Route path="/products/:productId" element={<BusinessProductDetailPage />} /></Routes></MemoryRouter>);
    const archiveButtons = await screen.findAllByRole("button", { name: "Archivar" });
    expect(archiveButtons[0]).toBeEnabled();
    fireEvent.click(archiveButtons[2]);
    await waitFor(() => expect(api.variantAction).toHaveBeenCalledWith("archive", "active-replacement", null));
    api.variantAction.mockClear();
    fireEvent.click(archiveButtons[0]);
    const replacement = screen.getByLabelText("Selecciona la nueva variante predeterminada");
    expect(screen.getByRole("option", { name: "Dos — inactive" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tres — active" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Archivada/ })).not.toBeInTheDocument();
    fireEvent.change(replacement, { target: { value: "inactive-replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar archivo" }));
    await waitFor(() => expect(api.variantAction).toHaveBeenCalledWith("archive", "default", "inactive-replacement"));

    productView.unmount();
    vi.clearAllMocks();
    api.getProduct.mockResolvedValue(productDetail([
      { id: "only", sku: "SKU-ONLY", title: "Única", price: 10, compareAtPrice: null, status: "active", isDefault: true, imageAssetId: null, barcode: null, onHand: 1, reserved: 0, available: 1, lowStockThreshold: 0 },
      { id: "archived", sku: "SKU-OLD", title: "Archivada", price: 10, compareAtPrice: null, status: "archived", isDefault: false, imageAssetId: null, barcode: null, onHand: 0, reserved: 0, available: 0, lowStockThreshold: 0 },
    ]));
    api.searchShippingProfiles.mockResolvedValue({ items: [], nextCursor: null });
    render(<MemoryRouter initialEntries={["/products/product-id"]}><Routes><Route path="/products/:productId" element={<BusinessProductDetailPage />} /></Routes></MemoryRouter>);
    expect((await screen.findAllByRole("button", { name: "Archivar" })).at(-1)).toBeDisabled();
  });
});
