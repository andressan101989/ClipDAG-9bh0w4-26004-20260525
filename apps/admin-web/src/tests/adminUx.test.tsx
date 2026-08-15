import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { AdminShell } from "../layout/AdminShell";

vi.mock("../auth/AdminAuthProvider", () => ({ useAdminAuth: vi.fn() }));

beforeEach(() => {
  vi.mocked(useAdminAuth).mockReturnValue({
    loading: false,
    session: { user: { id: "10000000-0000-4000-8000-000000000001" } } as never,
    admin: {
      user_id: "10000000-0000-4000-8000-000000000001",
      username: "ops",
      display_name: "Marketplace Ops",
      admin: true,
      capabilities: ["marketplace:read"],
    },
    denied: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  });
});

describe("B8D-006 responsive Admin navigation", () => {
  it("keeps every Marketplace route reachable through the compact menu", async () => {
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
    const navigation = screen.getByRole("navigation", { name: "Marketplace" });
    const routes = [
      ["Resumen", "/marketplace"],
      ["Pedidos", "/marketplace/orders"],
      ["Disputas", "/marketplace/disputes"],
      ["Vendedores", "/marketplace/sellers"],
      ["Productos", "/marketplace/products"],
      ["Creator Commerce", "/marketplace/creator-commerce"],
      ["Promociones", "/marketplace/promotions"],
      ["Ads", "/marketplace/ads"],
      ["Salud", "/marketplace/health"],
      ["Actividad", "/marketplace/activity"],
    ];
    routes.forEach(([name, href]) =>
      expect(within(navigation).getByRole("link", { name })).toHaveAttribute("href", href),
    );
  });
});
