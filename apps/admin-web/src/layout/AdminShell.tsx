import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthProvider";

const titles: Record<string, string> = {
  "/marketplace": "Resumen de Marketplace",
  "/marketplace/orders": "Pedidos",
  "/marketplace/disputes": "Disputas",
  "/marketplace/sellers": "Vendedores",
  "/marketplace/products": "Productos",
  "/marketplace/creator-commerce": "Creator Commerce",
  "/marketplace/promotions": "Promociones",
  "/marketplace/ads": "Marketplace Ads",
  "/marketplace/health": "Salud",
  "/marketplace/activity": "Actividad",
};
export function AdminShell() {
  const { admin, logout } = useAdminAuth();
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => setNavigationOpen(false), [location.pathname]);
  const section = Object.keys(titles).find(
    (path) =>
      path !== "/marketplace" && location.pathname.startsWith(`${path}/`),
  );
  const title = section
    ? `Detalle · ${titles[section]}`
    : (titles[location.pathname] ?? "Marketplace");
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">OS</span>
          <div>
            <strong>OnSpace</strong>
            <small>Admin</small>
          </div>
        </div>
        <button
          aria-controls="marketplace-navigation"
          aria-expanded={navigationOpen}
          aria-label={navigationOpen ? "Cerrar navegación" : "Abrir navegación"}
          className="nav-toggle"
          onClick={() => setNavigationOpen((value) => !value)}
          type="button"
        >
          <span aria-hidden="true">{navigationOpen ? "×" : "☰"}</span>
          Menú
        </button>
        <p className="nav-section">MARKETPLACE</p>
        <nav aria-label="Marketplace" className={navigationOpen ? "is-open" : ""} id="marketplace-navigation">
          <NavLink end to="/marketplace">
            Resumen
          </NavLink>
          <NavLink to="/marketplace/orders">Pedidos</NavLink>
          <NavLink to="/marketplace/disputes">Disputas</NavLink>
          <NavLink to="/marketplace/sellers">Vendedores</NavLink>
          <NavLink to="/marketplace/products">Productos</NavLink>
          <NavLink to="/marketplace/creator-commerce">Creator Commerce</NavLink>
          <NavLink to="/marketplace/promotions">Promociones</NavLink>
          <NavLink to="/marketplace/ads">Ads</NavLink>
          <NavLink to="/marketplace/health">Salud</NavLink>
          <NavLink to="/marketplace/activity">Actividad</NavLink>
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          Operaciones internas
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Marketplace /</span>
            <h1>{title}</h1>
          </div>
          <div className="admin-identity">
            <div>
              <strong>
                {admin?.display_name || admin?.username || "Administrador"}
              </strong>
              <small>Acceso interno</small>
            </div>
            <button className="ghost" onClick={() => void logout()}>
              Salir
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
