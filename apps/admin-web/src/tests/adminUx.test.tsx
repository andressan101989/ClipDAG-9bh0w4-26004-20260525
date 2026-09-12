import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { AdminShell } from "../layout/AdminShell";
import { adminLinks } from "../layout/adminNavigation";

vi.mock("../auth/AdminAuthProvider", () => ({ useAdminAuth: vi.fn() }));

beforeEach(() => {
  vi.mocked(useAdminAuth).mockReturnValue({
    loading: false,
    session: { user: { id: "10000000-0000-4000-8000-000000000001" } } as never,
    admin: {
      user_id: "10000000-0000-4000-8000-000000000001",
      username: "ops",
      display_name: "Marketplace Ops",
      avatar_url: null,
      admin: true,
      roles: ["MARKETPLACE_ADMIN"],
      capabilities: ["admin.shell.access","marketplace.overview.read","marketplace.orders.read","marketplace.disputes.read","marketplace.sellers.read","marketplace.products.read","marketplace.creators.read","marketplace.promotions.read","marketplace.ads.read","marketplace.health.read","marketplace.audit.read"],
      authority_version: "a1b2c3d4",
    },
    denied: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
    hasCapability: (capability) => capability.startsWith("marketplace.") || capability === "admin.shell.access",
  });
});

describe("UI-FINAL responsive Admin navigation", () => {
  it("keeps every Marketplace route reachable through capability-aware search", async () => {
    render(
      <MemoryRouter initialEntries={["/marketplace"]}>
        <Routes>
          <Route element={<AdminShell />}>
            <Route path="/marketplace" element={<p>Resumen visible</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const toggle = screen.getByRole("button", { name: "Abrir navegación" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const navigation = screen.getByRole("navigation", { name: "Administración global" });
    expect(within(navigation).getByRole("link", { name: "Marketplace" })).toHaveAttribute("href", "/marketplace");
    const search = screen.getByRole("textbox", { name: "Buscar módulos y secciones" });
    await userEvent.type(search, "Orders");
    const results = screen.getByRole("listbox", { name: "Rutas autorizadas" });
    const routes = [
      ["Marketplace", "/marketplace"],
      ["Marketplace · Orders", "/marketplace/orders"],
      ["Marketplace · Disputes", "/marketplace/disputes"],
      ["Marketplace · Sellers", "/marketplace/sellers"],
      ["Marketplace · Products", "/marketplace/products"],
      ["Marketplace · Creator Commerce", "/marketplace/creator-commerce"],
      ["Marketplace · Promotions", "/marketplace/promotions"],
      ["Marketplace · Ads", "/marketplace/ads"],
      ["Marketplace · Health", "/marketplace/health"],
      ["Marketplace · Activity", "/marketplace/activity"],
    ];
    expect(within(results).getByText("Marketplace · Orders")).toBeInTheDocument();
    expect(within(results).getByText("/marketplace/orders")).toBeInTheDocument();
    routes.forEach(([name, href]) => expect(adminLinks).toEqual(expect.arrayContaining([expect.objectContaining({label:name,to:href})])));
  });
});
