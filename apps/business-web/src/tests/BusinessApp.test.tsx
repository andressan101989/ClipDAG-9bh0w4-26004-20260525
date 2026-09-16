import type { Session, User } from "@supabase/supabase-js";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { BusinessAuthProvider } from "../auth/BusinessAuthProvider";
import type {
  BusinessGateway,
  BusinessIdentity,
  MarketplaceSeller,
  MarketplaceStore,
} from "../lib/businessApi";
import type { BusinessSupabaseClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

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
  beforeEach(() => vi.clearAllMocks());

  it("routes a missing session to the Nelyon login", async () => {
    renderBusiness(null);
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
  });

  it("restores a valid session and resolves the active owner context", async () => {
    const { gateway } = renderBusiness({ user, seller: approvedSeller, store: activeStore });
    expect(await screen.findByText("Hola, Nelyon Shop")).toBeInTheDocument();
    expect(gateway.loadIdentity).toHaveBeenCalledTimes(1);
  });

  it("logs out and returns to login", async () => {
    const { client } = renderBusiness({ user, seller: approvedSeller, store: activeStore });
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns to login when Supabase reports an expired or cleared session", async () => {
    const { emitAuth } = renderBusiness({ user, seller: approvedSeller, store: activeStore });
    await screen.findByText("Hola, Nelyon Shop");
    act(() => emitAuth(null));
    expect(await screen.findByText("Accede con tu cuenta de Nelyon")).toBeInTheDocument();
  });

  it("shows seller onboarding when no seller exists", async () => {
    renderBusiness({ user, seller: null, store: null });
    expect(await screen.findByText("Activa tu presencia comercial")).toBeInTheDocument();
  });

  it("submits the owner-only canonical seller application", async () => {
    const { gateway } = renderBusiness({ user, seller: null, store: null });
    fireEvent.change(await screen.findByLabelText("Nombre visible"), { target: { value: "Mi negocio" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(gateway.applySeller).toHaveBeenCalledWith({ displayName: "Mi negocio", applicationNote: "" }, expect.anything()));
  });

  it("blocks pending sellers on the review screen", async () => {
    renderBusiness({ user, seller: seller("pending"), store: null });
    expect(await screen.findByText("Tu solicitud está en revisión")).toBeInTheDocument();
    expect(screen.queryByText("Tu tienda")).not.toBeInTheDocument();
  });

  it("allows a rejected seller to use only the existing update/reapply flow", async () => {
    const { gateway } = renderBusiness({ user, seller: seller("rejected"), store: null });
    expect(await screen.findByText("Actualiza tu solicitud")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar y reenviar" }));
    await waitFor(() => expect(gateway.updateSeller).toHaveBeenCalled());
  });

  it("blocks a suspended seller", async () => {
    renderBusiness({ user, seller: seller("suspended"), store: null });
    expect(await screen.findByText("Tu acceso como seller está suspendido")).toBeInTheDocument();
    expect(screen.getByText("Revisión necesaria")).toBeInTheDocument();
  });

  it("routes approved sellers without a Store to Store Setup", async () => {
    renderBusiness({ user, seller: approvedSeller, store: null });
    expect(await screen.findByText("Da forma a tu espacio comercial")).toBeInTheDocument();
  });

  it("creates a Store through the gateway without a seller id", async () => {
    const { gateway } = renderBusiness({ user, seller: approvedSeller, store: null });
    fireEvent.change(await screen.findByLabelText("Nombre de la tienda"), { target: { value: "Tienda Azul" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await waitFor(() => expect(gateway.createStore).toHaveBeenCalledWith({ name: "Tienda Azul", slug: "tienda-azul", description: "" }, expect.anything()));
  });

  it("routes a draft Store to its editable profile", async () => {
    renderBusiness({ user, seller: approvedSeller, store: store("draft") });
    expect(await screen.findByText("Completa el perfil de tu tienda")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nelyon Shop")).toBeInTheDocument();
  });

  it("renders the active Business dashboard and canonical Store identity", async () => {
    renderBusiness({ user, seller: approvedSeller, store: activeStore });
    expect(await screen.findByText("Tu espacio de negocio está listo. Aquí encontrarás el estado real de la fundación Business.")).toBeInTheDocument();
    expect(screen.getAllByText("Nelyon Shop").length).toBeGreaterThan(1);
  });

  it("blocks a suspended Store", async () => {
    renderBusiness({ user, seller: approvedSeller, store: store("suspended") });
    expect(await screen.findByText("Tu tienda está suspendida")).toBeInTheDocument();
    expect(screen.queryByText("Configuración inicial")).not.toBeInTheDocument();
  });

  it("shows loading and friendly error states", async () => {
    let release: ((value: BusinessIdentity) => void) | undefined;
    const pending = new Promise<BusinessIdentity>((resolve) => { release = resolve; });
    const active = harness({ user, seller: approvedSeller, store: activeStore });
    active.gateway.loadIdentity = vi.fn(() => pending);
    const view = render(
      <MemoryRouter><BusinessAuthProvider client={active.client} gateway={active.gateway}><App /></BusinessAuthProvider></MemoryRouter>,
    );
    expect(await screen.findByText("Cargando tu espacio…")).toBeInTheDocument();
    await act(async () => release?.({ user, seller: approvedSeller, store: activeStore }));
    await screen.findByText("Hola, Nelyon Shop");
    view.unmount();

    renderBusiness({ user, seller: approvedSeller, store: activeStore }, "/", { loadError: new Error("context_failed") });
    expect(await screen.findByText("Error al cargar Business")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("keeps future navigation visibly disabled", async () => {
    renderBusiness({ user, seller: approvedSeller, store: activeStore });
    await screen.findByText("Hola, Nelyon Shop");
    expect(screen.getByRole("button", { name: /Productos/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Equipo/ })).toBeDisabled();
  });
});
