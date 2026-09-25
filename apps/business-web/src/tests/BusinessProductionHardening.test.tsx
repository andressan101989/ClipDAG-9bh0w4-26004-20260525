import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessMediaPicker } from "../components/BusinessMedia";
import { BusinessMediaPage } from "../pages/BusinessMediaPage";
import { BusinessOrderDetailPage } from "../pages/orders/BusinessOrderDetailPage";
import { BusinessProductDetailPage } from "../pages/products/BusinessProductDetailPage";
import { BusinessProductsPage } from "../pages/products/BusinessProductsPage";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const auth = vi.hoisted(() => ({ ownerId: "owner-a" }));
const api = vi.hoisted(() => ({
  media: vi.fn(),
  upload: vi.fn(),
  products: vi.fn(),
  product: vi.fn(),
  shipping: vi.fn(),
  order: vi.fn(),
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
          accessType: "owner",
          capabilities: [
            "business.media.read",
            "business.catalog.read",
            "business.orders.read",
          ],
          seller: { userId: auth.ownerId, displayName: `Business ${auth.ownerId}` },
          store: { id: `store-${auth.ownerId}`, sellerId: auth.ownerId, name: `Store ${auth.ownerId}` },
        };
      }
      return {
        currentBusiness,
        accessType: "owner",
        hasCapability: (code: string) => (currentBusiness.capabilities as string[]).includes(code),
      };
    },
  };
});
vi.mock("../lib/businessMediaApi", async (original) => ({
  ...(await original<typeof import("../lib/businessMediaApi")>()),
  searchBusinessMedia: api.media,
  searchAllBusinessMedia: async (...args: unknown[]) => (await api.media(...args)).items,
  uploadBusinessMedia: api.upload,
}));
vi.mock("../lib/sellerCenterApi", async (original) => ({
  ...(await original<typeof import("../lib/sellerCenterApi")>()),
  searchProducts: api.products,
  getProduct: api.product,
  searchShippingProfiles: api.shipping,
  getOrder: api.order,
}));

const mediaItem = (assetId: string) => ({
  assetId,
  assetSource: "media_asset" as const,
  provider: "r2" as const,
  mediaKind: "image" as const,
  mimeType: "image/png",
  status: "ready",
  purpose: "business_library",
  visibility: "public" as const,
  sizeBytes: 10,
  createdAt: "2026-09-18T00:00:00Z",
  readyAt: "2026-09-18T00:00:00Z",
  previewUrl: `https://example.test/${assetId}.png`,
  playbackUrl: null,
  thumbnailUrl: null,
  usage: ["library" as const],
  usageCount: 0,
  progress: null,
  errorCode: null,
});

const productSummary = (id: string) => ({
  id,
  title: `Product ${id}`,
  status: "active",
  price: 10,
  currency: "BDAG",
  variantCount: 1,
  readinessReason: null,
  updatedAt: "2026-09-18T00:00:00Z",
  thumbnailUrl: null,
  availableStock: 2,
});

const productDetail = (title: string) => ({
  product: { id: "product-1", title, status: "active", price: 10, category_id: "category-1", stock: 2, product_type: "physical", readiness_reason: null, shipping_profile_id: null },
  media: [],
  options: [],
  variants: [],
  categories: [{ id: "category-1", name: "General" }],
});

describe("Business Web production stale-response hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.ownerId = "owner-a";
    api.shipping.mockResolvedValue({ items: [], nextCursor: null });
    api.upload.mockResolvedValue({ assetId: "uploaded-1", kind: "image" });
  });

  it("does not let old-business Media results overwrite the active business", async () => {
    const a = deferred<{ items: ReturnType<typeof mediaItem>[]; nextCursor: null }>();
    const b = deferred<{ items: ReturnType<typeof mediaItem>[]; nextCursor: null }>();
    api.media.mockImplementation((ownerId: string) => ownerId === "owner-a" ? a.promise : b.promise);
    const view = render(<MemoryRouter><BusinessMediaPage /></MemoryRouter>);
    auth.ownerId = "owner-b";
    view.rerender(<MemoryRouter><BusinessMediaPage /></MemoryRouter>);
    await act(async () => b.resolve({ items: [mediaItem("B")], nextCursor: null }));
    expect(await screen.findByText("Biblioteca")).toBeInTheDocument();
    await act(async () => a.resolve({ items: [mediaItem("A")], nextCursor: null }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.test/B.png");
  });

  it("keeps the Media picker scoped when the business changes while open", async () => {
    const a = deferred<{ items: ReturnType<typeof mediaItem>[]; nextCursor: null }>();
    const b = deferred<{ items: ReturnType<typeof mediaItem>[]; nextCursor: null }>();
    api.media.mockImplementation((ownerId: string) => ownerId === "owner-a" ? a.promise : b.promise);
    const props = { open: true, selectedId: null, title: "Elegir media", onSelect: vi.fn(), onClose: vi.fn() };
    const view = render(<BusinessMediaPicker {...props} />);
    auth.ownerId = "owner-b";
    view.rerender(<BusinessMediaPicker {...props} />);
    await act(async () => b.resolve({ items: [mediaItem("B")], nextCursor: null }));
    await act(async () => a.resolve({ items: [mediaItem("A")], nextCursor: null }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.test/B.png");
  });

  it("focuses and closes the Media picker from the keyboard", async () => {
    api.media.mockResolvedValue({ items: [], nextCursor: null });
    const onClose = vi.fn();
    render(<BusinessMediaPicker open selectedId={null} title="Elegir media" onSelect={vi.fn()} onClose={onClose} />);
    await screen.findByText("No hay imágenes listas en la biblioteca.");
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reuses the canonical Business Media uploader when upload is enabled", async () => {
    api.media.mockResolvedValue({ items: [], nextCursor: null });
    const { container } = render(<BusinessMediaPicker open allowUpload businessOwnerId="owner-a" selectedId={null} title="Elegir media" onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(["image"], "creative.png", { type: "image/png" })] } });
    await act(async () => { await Promise.resolve(); });
    expect(api.upload).toHaveBeenCalledWith("owner-a", expect.objectContaining({ name: "creative.png", type: "image/png" }), expect.any(Function));
  });

  it("refetches the canonical library after finalize and exposes the ready asset", async () => {
    api.media
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [mediaItem("ready-upload")], nextCursor: null });
    const onSelect = vi.fn();
    const { container } = render(<BusinessMediaPicker open allowUpload businessOwnerId="owner-a" selectedId={null} title="Choose media" locale="en" onSelect={onSelect} onClose={vi.fn()} />);
    await screen.findByText("No media in your Business Library yet.");
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "creative.png", { type: "image/png" })] } });
    const ready = await screen.findByRole("button", { name: /Image · Ready/i });
    expect(api.media).toHaveBeenCalledTimes(2);
    expect(ready).toBeEnabled();
    fireEvent.click(ready);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ assetId: "ready-upload", status: "ready" }));
  });

  it("guards one upload intent against duplicate input events", async () => {
    api.media.mockResolvedValue({ items: [], nextCursor: null });
    let finishUpload!: (value: { assetId: string; kind: "image" }) => void;
    api.upload.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    const { container } = render(<BusinessMediaPicker open allowUpload businessOwnerId="owner-a" selectedId={null} title="Choose media" locale="en" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("No media in your Business Library yet.");
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(["image"], "creative.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(api.upload).toHaveBeenCalledTimes(1);
    await act(async () => { finishUpload({ assetId: "ready-upload", kind: "image" }); });
  });

  it("reconciles after an upload failure without exposing R2 internals or retrying automatically", async () => {
    api.media.mockResolvedValue({ items: [], nextCursor: null });
    api.upload.mockRejectedValue(new Error("upload_failed_403 X-Amz-Signature=secret bucket/key"));
    const { container } = render(<BusinessMediaPicker open allowUpload businessOwnerId="owner-a" selectedId={null} title="Choose media" locale="en" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("No media in your Business Library yet.");
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "creative.png", { type: "image/png" })] } });
    expect(await screen.findByText("Upload failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/X-Amz|bucket\/key|upload_failed/i)).not.toBeInTheDocument();
    expect(api.media).toHaveBeenCalledTimes(2);
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Upload media" })).toBeEnabled();
  });

  it("does not let old-business product pages overwrite the active catalog", async () => {
    const a = deferred<{ items: ReturnType<typeof productSummary>[]; categories: { id: string; name: string }[]; nextCursor: null }>();
    const b = deferred<{ items: ReturnType<typeof productSummary>[]; categories: { id: string; name: string }[]; nextCursor: null }>();
    api.products.mockImplementation((ownerId: string) => ownerId === "owner-a" ? a.promise : b.promise);
    const view = render(<MemoryRouter><BusinessProductsPage /></MemoryRouter>);
    auth.ownerId = "owner-b";
    view.rerender(<MemoryRouter><BusinessProductsPage /></MemoryRouter>);
    await act(async () => b.resolve({ items: [productSummary("B")], categories: [{ id: "category-b", name: "B" }], nextCursor: null }));
    expect(await screen.findByText("Product B")).toBeInTheDocument();
    await act(async () => a.resolve({ items: [productSummary("A")], categories: [{ id: "category-a", name: "A" }], nextCursor: null }));
    expect(screen.queryByText("Product A")).not.toBeInTheDocument();
    expect(screen.getByText("Product B")).toBeInTheDocument();
  });

  it("keeps product detail scoped to the active business", async () => {
    const a = deferred<ReturnType<typeof productDetail>>();
    const b = deferred<ReturnType<typeof productDetail>>();
    api.product.mockImplementation((ownerId: string) => ownerId === "owner-a" ? a.promise : b.promise);
    const route = () => <MemoryRouter initialEntries={["/products/product-1"]}><Routes><Route path="/products/:productId" element={<BusinessProductDetailPage />} /></Routes></MemoryRouter>;
    const view = render(route());
    auth.ownerId = "owner-b";
    view.rerender(route());
    await act(async () => b.resolve(productDetail("Product B detail")));
    expect(await screen.findByRole("heading", { name: "Product B detail" })).toBeInTheDocument();
    await act(async () => a.resolve(productDetail("Product A detail")));
    expect(screen.queryByRole("heading", { name: "Product A detail" })).not.toBeInTheDocument();
  });

  it("keeps order detail scoped to the active business", async () => {
    const a = deferred<Record<string, unknown>>();
    const b = deferred<Record<string, unknown>>();
    api.order.mockImplementation((ownerId: string) => ownerId === "owner-a" ? a.promise : b.promise);
    const order = (number: string) => ({ id: "order-1", order_number: number, status: "confirmed", total: 10, currency: "BDAG", created_at: "2026-09-18T00:00:00Z", items: [], shipping_address: null });
    const route = () => <MemoryRouter initialEntries={["/orders/order-1"]}><Routes><Route path="/orders/:orderId" element={<BusinessOrderDetailPage />} /></Routes></MemoryRouter>;
    const view = render(route());
    auth.ownerId = "owner-b";
    view.rerender(route());
    await act(async () => b.resolve(order("ORDER-B")));
    expect(await screen.findByRole("heading", { name: "ORDER-B" })).toBeInTheDocument();
    await act(async () => a.resolve(order("ORDER-A")));
    expect(screen.queryByRole("heading", { name: "ORDER-A" })).not.toBeInTheDocument();
  });
});
