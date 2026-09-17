import type { Session, User } from "@supabase/supabase-js";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { BusinessAuthProvider } from "../auth/BusinessAuthProvider";
import type {
  BusinessGateway,
  BusinessIdentity,
  BusinessAccess,
  MarketplaceSeller,
  MarketplaceStore,
} from "../lib/businessApi";
import type { BusinessSupabaseClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
const mediaMocks = vi.hoisted(() => ({
  search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  upload: vi.fn(),
  operational: vi.fn(),
  setStore: vi.fn(),
}));
vi.mock("../lib/businessMediaApi", () => ({
  searchBusinessMedia: mediaMocks.search,
  uploadBusinessMedia: mediaMocks.upload,
  uploadBusinessOperationalMedia: mediaMocks.operational,
  setBusinessStoreMedia: mediaMocks.setStore,
}));
const sellerCenterMocks = vi.hoisted(() => ({
  products: vi.fn().mockResolvedValue({ items: [], categories: [{ id: "category-1", name: "General" }], nextCursor: null }),
  orders: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  returns: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  disputes: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock("../lib/sellerCenterApi", async (original) => ({
  ...(await original<typeof import("../lib/sellerCenterApi")>()),
  searchProducts: sellerCenterMocks.products,
  searchOrders: sellerCenterMocks.orders,
  searchReturns: sellerCenterMocks.returns,
  searchDisputes: sellerCenterMocks.disputes,
}));
const adsMocks = vi.hoisted(() => ({
  search: vi.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    summary: { activeCampaigns: 0, totalBudgetBdag: 0, spentBdag: 0, impressions: 0, clicks: 0, orders: 0, attributedGmvBdag: 0 },
  }),
}));
vi.mock("../lib/adsManagerApi", async (original) => ({
  ...(await original<typeof import("../lib/adsManagerApi")>()),
  searchAdCampaigns: adsMocks.search,
}));

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@nelyon.test" } as User;
const session = { user, access_token: "test", refresh_token: "test" } as Session;
const approvedSeller: MarketplaceSeller = {
  userId: user.id,
  status: "approved",
  displayName: "Nelyon Shop",
  applicationNote: null,
  suspensionReason: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const activeStore: MarketplaceStore = {
  id: "22222222-2222-4222-8222-222222222222",
  sellerId: user.id,
  name: "Nelyon Shop",
  slug: "nelyon-shop",
  description: "Store",
  logoAssetId: null,
  bannerAssetId: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const ownerCapabilities = [
  "business.home.read",
  "business.store.read",
  "business.store.manage",
  "business.media.read",
  "business.media.manage",
  "business.settings.manage",
] as const;

function identity(ownedSeller: MarketplaceSeller | null, currentStore: MarketplaceStore | null): BusinessIdentity {
  const businesses: BusinessAccess[] = ownedSeller?.status === "approved" ? [{
    businessOwnerId: ownedSeller.userId,
    accessType: "owner",
    membershipId: null,
    capabilities: [...ownerCapabilities],
    seller: { userId: ownedSeller.userId, status: ownedSeller.status, displayName: ownedSeller.displayName },
    store: currentStore,
  }] : [];
  return { user, ownedSeller, businesses };
}

function memberAccess(ownerId: string, capabilities: BusinessAccess["capabilities"], name = "Partner Store"): BusinessAccess {
  return {
    businessOwnerId: ownerId,
    accessType: "member",
    membershipId: `membership-${ownerId}`,
    capabilities,
    seller: { userId: ownerId, status: "approved", displayName: name },
    store: { ...activeStore, id: `store-${ownerId}`, sellerId: ownerId, name, slug: name.toLowerCase().replaceAll(" ", "-") },
  };
}

function memberIdentity(...businesses: BusinessAccess[]): BusinessIdentity {
  return { user, ownedSeller: null, businesses };
}

function seller(status: MarketplaceSeller["status"]): MarketplaceSeller {
  return { ...approvedSeller, status, suspensionReason: status === "suspended" ? "Revisión necesaria" : null };
}

function store(status: MarketplaceStore["status"]): MarketplaceStore {
  return { ...activeStore, status };
}

function harness(identity: BusinessIdentity | null, options?: { loadError?: Error }) {
  let authCallback: ((event: string, next: Session | null) => void) | null = null;
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: identity ? session : null }, error: null }),
      onAuthStateChange: vi.fn((callback) => {
        authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as BusinessSupabaseClient;
  const gateway: BusinessGateway = {
    loadIdentity: vi.fn().mockImplementation(async () => {
      if (options?.loadError) throw options.loadError;
      if (!identity) throw new Error("identity_not_expected");
      return identity;
    }),
    applySeller: vi.fn().mockResolvedValue(undefined),
    updateSeller: vi.fn().mockResolvedValue(undefined),
    createStore: vi.fn().mockResolvedValue(activeStore.id),
    updateStore: vi.fn().mockResolvedValue(undefined),
  };
  return { client, gateway, emitAuth: (next: Session | null) => authCallback?.("SIGNED_IN", next) };
}

function renderBusiness(identity: BusinessIdentity | null, initialPath = "/", options?: { loadError?: Error }) {
  const testHarness = harness(identity, options);
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BusinessAuthProvider client={testHarness.client} gateway={testHarness.gateway}>
        <App />
      </BusinessAuthProvider>
    </MemoryRouter>,
  );
  return testHarness;
}

describe("Business Web owner lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaMocks.search.mockResolvedValue({ items: [], nextCursor: null });
    adsMocks.search.mockResolvedValue({
      items: [],
      nextCursor: null,
      summary: { activeCampaigns: 0, totalBudgetBdag: 0, spentBdag: 0, impressions: 0, clicks: 0, orders: 0, attributedGmvBdag: 0 },
    });
    window.sessionStorage.clear();
  });

  it("routes a missing session to the Nelyon login", async () => {
    renderBusiness(null);
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
  });

  it("restores a valid session and resolves the active owner context", async () => {
    const { gateway } = renderBusiness(identity(approvedSeller, activeStore));
    expect(await screen.findByText("Hola, Nelyon Shop")).toBeInTheDocument();
    expect(gateway.loadIdentity).toHaveBeenCalledTimes(1);
  });

  it("logs out and returns to login", async () => {
    const { client } = renderBusiness(identity(approvedSeller, activeStore));
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns to login when Supabase reports an expired or cleared session", async () => {
    const { emitAuth } = renderBusiness(identity(approvedSeller, activeStore));
    await screen.findByText("Hola, Nelyon Shop");
    act(() => emitAuth(null));
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
  });

  it("shows seller onboarding when no seller exists", async () => {
    renderBusiness(identity(null, null));
    expect(await screen.findByText("Activa tu presencia comercial")).toBeInTheDocument();
  });

  it("submits the owner-only canonical seller application", async () => {
    const { gateway } = renderBusiness(identity(null, null));
    fireEvent.change(await screen.findByLabelText("Nombre visible"), { target: { value: "Mi negocio" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(gateway.applySeller).toHaveBeenCalledWith({ displayName: "Mi negocio", applicationNote: "" }, expect.anything()));
  });

  it("blocks pending sellers on the review screen", async () => {
    renderBusiness(identity(seller("pending"), null));
    expect(await screen.findByText("Tu solicitud está en revisión")).toBeInTheDocument();
    expect(screen.queryByText("Tu tienda")).not.toBeInTheDocument();
  });

  it("allows a rejected seller to use only the existing update/reapply flow", async () => {
    const { gateway } = renderBusiness(identity(seller("rejected"), null));
    expect(await screen.findByText("Actualiza tu solicitud")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar y reenviar" }));
    await waitFor(() => expect(gateway.updateSeller).toHaveBeenCalled());
  });

  it("blocks a suspended seller", async () => {
    renderBusiness(identity(seller("suspended"), null));
    expect(await screen.findByText("Tu acceso como seller está suspendido")).toBeInTheDocument();
    expect(screen.getByText("Revisión necesaria")).toBeInTheDocument();
  });

  it("routes approved sellers without a Store to Store Setup", async () => {
    renderBusiness(identity(approvedSeller, null));
    expect(await screen.findByText("Da forma a tu espacio comercial")).toBeInTheDocument();
  });

  it("creates a Store through the gateway without a seller id", async () => {
    const { gateway } = renderBusiness(identity(approvedSeller, null));
    fireEvent.change(await screen.findByLabelText("Nombre de la tienda"), { target: { value: "Tienda Azul" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await waitFor(() => expect(gateway.createStore).toHaveBeenCalledWith({ name: "Tienda Azul", slug: "tienda-azul", description: "" }, expect.anything()));
  });

  it("routes a draft Store to its editable profile", async () => {
    renderBusiness(identity(approvedSeller, store("draft")));
    expect(await screen.findByText("Completa el perfil de tu tienda")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nelyon Shop")).toBeInTheDocument();
  });

  it("renders the active Business dashboard and canonical Store identity", async () => {
    renderBusiness(identity(approvedSeller, activeStore));
    expect(await screen.findByText("Tu espacio de negocio está listo. Aquí encontrarás el estado real de la fundación Business.")).toBeInTheDocument();
    expect(screen.getAllByText("Nelyon Shop").length).toBeGreaterThan(1);
  });

  it("blocks a suspended Store", async () => {
    renderBusiness(identity(approvedSeller, store("suspended")));
    expect(await screen.findByText("Tu tienda está suspendida")).toBeInTheDocument();
    expect(screen.queryByText("Configuración inicial")).not.toBeInTheDocument();
  });

  it("shows loading and friendly error states", async () => {
    let release: ((value: BusinessIdentity) => void) | undefined;
    const pending = new Promise<BusinessIdentity>((resolve) => { release = resolve; });
    const active = harness(identity(approvedSeller, activeStore));
    active.gateway.loadIdentity = vi.fn(() => pending);
    const view = render(
      <MemoryRouter><BusinessAuthProvider client={active.client} gateway={active.gateway}><App /></BusinessAuthProvider></MemoryRouter>,
    );
    expect(await screen.findByText("Cargando tu espacio…")).toBeInTheDocument();
    await act(async () => release?.(identity(approvedSeller, activeStore)));
    await screen.findByText("Hola, Nelyon Shop");
    view.unmount();

    renderBusiness(identity(approvedSeller, activeStore), "/", { loadError: new Error("context_failed") });
    expect(await screen.findByText("Error al cargar Business")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("keeps future navigation visibly disabled", async () => {
    renderBusiness(identity(approvedSeller, activeStore));
    await screen.findByText("Hola, Nelyon Shop");
    expect(screen.getByRole("button", { name: /Productos/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Equipo/ })).toBeDisabled();
  });

  it("enables Products only for a business with catalog capability", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-products", ["business.catalog.read"])), "/products");
    expect(await screen.findByRole("heading", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Productos/ })).toHaveAttribute("href", "/products");
    expect(sellerCenterMocks.products).toHaveBeenCalledWith("owner-products", expect.anything());
  });

  it("enables the Orders tabs from domain-scoped read capabilities", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-orders", ["business.orders.read", "business.returns.read"])), "/orders");
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devoluciones" })).toBeInTheDocument();
    expect(sellerCenterMocks.orders).toHaveBeenCalledWith("owner-orders", expect.objectContaining({ status: undefined, cursor: undefined }));
  });

  it("opens capability-scoped Ads reporting without create for ads.read", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-ads", ["business.ads.read"])), "/ads");
    expect(await screen.findByRole("heading", { name: "Publicidad" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Publicidad/ })).toHaveAttribute("href", "/ads");
    expect(screen.queryByRole("link", { name: "Crear campaña" })).not.toBeInTheDocument();
    expect(adsMocks.search).toHaveBeenCalledWith("owner-ads", { status: undefined, cursor: undefined });
  });

  it("auto-selects a single member business and labels the actor as member", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.home.read", "business.store.read"])));
    expect(await screen.findByText("Negocio compartido")).toBeInTheDocument();
    expect(screen.getAllByText("Miembro").length).toBeGreaterThan(0);
  });

  it("requires selection when multiple authorized businesses are returned", async () => {
    renderBusiness(memberIdentity(
      memberAccess("owner-b", ["business.home.read"], "Business B"),
      memberAccess("owner-c", ["business.home.read"], "Business C"),
    ));
    expect(await screen.findByText("Selecciona un negocio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Business C/ }));
    expect(await screen.findByText("Hola, Business C")).toBeInTheDocument();
  });

  it("keeps a persisted selection only while it remains authorized", async () => {
    window.sessionStorage.setItem("nelyon.business.selected-owner", "owner-c");
    renderBusiness(memberIdentity(
      memberAccess("owner-b", ["business.home.read"], "Business B"),
      memberAccess("owner-c", ["business.home.read"], "Business C"),
    ));
    expect(await screen.findByText("Hola, Business C")).toBeInTheDocument();
  });

  it("clears a revoked persisted selection and fails back to authorized selection", async () => {
    window.sessionStorage.setItem("nelyon.business.selected-owner", "revoked-owner");
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.home.read"], "Business B")));
    expect(await screen.findByText("Hola, Business B")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("nelyon.business.selected-owner")).toBe("owner-b");
  });

  it("fails closed for an active membership with zero capabilities", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", [])));
    expect(await screen.findByText("Tu acceso no tiene permisos asignados")).toBeInTheDocument();
  });

  it("lets a multi-business member leave a zero-capability selection", async () => {
    window.sessionStorage.setItem("nelyon.business.selected-owner", "owner-b");
    renderBusiness(memberIdentity(
      memberAccess("owner-b", [], "Business B"),
      memberAccess("owner-c", ["business.home.read"], "Business C"),
    ));
    expect(await screen.findByText("Tu acceso no tiene permisos asignados")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cambiar de negocio"), { target: { value: "owner-c" } });
    expect(await screen.findByText("Hola, Business C")).toBeInTheDocument();
  });

  it("renders Store read-only without store.manage", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.store.read"])) , "/store");
    expect(await screen.findByText(/Vista de solo lectura/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre de la tienda")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
  });

  it("enables Store editing only with store.manage", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.store.manage"])) , "/store");
    expect(await screen.findByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    expect(screen.getByLabelText("Nombre de la tienda")).toBeEnabled();
  });

  it("opens a server-scoped read-only Media library for media.read", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.media.read"])), "/media");
    expect(await screen.findByText("Biblioteca multimedia")).toBeInTheDocument();
    expect(screen.getByText(/Vista de solo lectura/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subir archivo" })).not.toBeInTheDocument();
    await waitFor(() => expect(mediaMocks.search).toHaveBeenCalledWith("owner-b", expect.objectContaining({ limit: 24 })));
  });

  it("enables canonical upload UI only for media.manage", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.media.manage"])), "/media");
    expect(await screen.findByRole("button", { name: "Subir archivo" })).toBeEnabled();
    expect(screen.getByRole("link", { name: /Media/ })).toHaveClass("is-active");
  });

  it("offers a friendly retry when the library projection fails", async () => {
    mediaMocks.search.mockRejectedValueOnce(new Error("library_unavailable")).mockResolvedValueOnce({ items: [], nextCursor: null });
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.media.read"])), "/media");
    expect(await screen.findByRole("alert")).toHaveTextContent("library_unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(mediaMocks.search).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No hay media disponible para este negocio.")).toBeInTheDocument();
  });

  it("keeps Media unavailable without media capability", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.home.read"])), "/media");
    expect(await screen.findByText("Negocio compartido")).toBeInTheDocument();
    expect(screen.queryByText("Biblioteca multimedia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Media/ })).toBeDisabled();
  });

  it("shows the Store media picker only with store.manage and media access", async () => {
    renderBusiness(memberIdentity(memberAccess("owner-b", ["business.store.manage", "business.media.read"])), "/store");
    fireEvent.click(await screen.findAllByRole("button", { name: "Elegir de Media" }).then((buttons) => buttons[0]));
    expect(await screen.findByRole("dialog", { name: "Elegir logo" })).toBeInTheDocument();
    expect(mediaMocks.search).toHaveBeenCalledWith("owner-b", expect.objectContaining({ kind: "image", status: "ready" }));
  });
});
