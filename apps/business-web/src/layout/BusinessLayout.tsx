import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BrandMark, StatusBadge } from "../components/BusinessUI";

type BusinessNavItem = {
  label: string;
  symbol: string;
  path?: string;
  enabled?: boolean;
  capabilities?: readonly `business.${string}.${string}`[];
};

const navigation: readonly BusinessNavItem[] = [
  { label: "Inicio", path: "/", symbol: "⌂", enabled: true, capabilities: ["business.home.read"] },
  { label: "Tienda", path: "/store", symbol: "◇", enabled: true, capabilities: ["business.store.read", "business.store.manage"] },
  { label: "Productos", path: "/products", symbol: "▦", enabled: true, capabilities: ["business.catalog.read", "business.catalog.manage"] },
  { label: "Pedidos", path: "/orders", symbol: "▤", enabled: true, capabilities: ["business.orders.read", "business.orders.fulfill", "business.returns.read", "business.returns.manage", "business.disputes.read", "business.disputes.respond"] },
  { label: "Publicidad", path: "/ads", symbol: "◎", enabled: true, capabilities: ["business.ads.read", "business.ads.manage"] },
  { label: "Media", path: "/media", symbol: "▧", enabled: true, capabilities: ["business.media.read", "business.media.manage"] },
  { label: "Finanzas", path: "/finance", symbol: "$", enabled: true, capabilities: ["business.finance.read", "business.payouts.read", "business.payouts.manage"] },
  { label: "Analítica", path: "/analytics", symbol: "↗", enabled: true, capabilities: ["business.analytics.read"] },
  { label: "Equipo", symbol: "♙" },
  { label: "Configuración", path: "/settings", symbol: "⚙", enabled: true, capabilities: ["business.settings.manage"] },
];

export function BusinessLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { store, user, logout, businesses, currentBusiness, accessType, hasCapability, selectBusiness } = useBusinessAuth();
  const location = useLocation();

  const pageName =
    navigation.find((item) => item.path === location.pathname)?.label
      ?? (location.pathname.startsWith("/ads") ? "Publicidad" : location.pathname.startsWith("/finance") ? "Finanzas" : "Business");

  return (
    <div className="business-shell">
      <aside className={`business-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <BrandMark />
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Cerrar navegación"
            onClick={() => setMenuOpen(false)}
          >×</button>
        </div>
        <nav aria-label="Navegación Business">
          {navigation.map((item) =>
            item.enabled && item.path && item.capabilities?.some((capability) => hasCapability(capability)) ? (
              <NavLink
                end={item.path === "/"}
                key={item.label}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => isActive ? "nav-item is-active" : "nav-item"}
              >
                <span aria-hidden="true">{item.symbol}</span>
                <span>{item.label}</span>
              </NavLink>
            ) : (
              <button className="nav-item future-nav" type="button" disabled key={item.label}>
                <span aria-hidden="true">{item.symbol}</span>
                <span>{item.label}</span>
                <small>Próximamente</small>
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-store">
          <div className="store-avatar" aria-hidden="true">
            {store?.name.slice(0, 1).toUpperCase() ?? "N"}
          </div>
          <div>
            <strong>{store?.name ?? currentBusiness?.seller.displayName}</strong>
            {store && <StatusBadge status={store.status} />}
            {accessType && <small>{accessType === "owner" ? "Propietario" : "Miembro"}</small>}
          </div>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="business-main">
        <header className="business-topbar">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label="Abrir navegación"
            onClick={() => setMenuOpen(true)}
          >☰</button>
          <div>
            <p>Espacio empresarial</p>
            <strong>{pageName}</strong>
          </div>
          <div className="topbar-account">
            {businesses.length > 1 && (
              <select
                aria-label="Negocio actual"
                value={currentBusiness?.businessOwnerId ?? ""}
                onChange={(event) => selectBusiness(event.target.value)}
              >
                {businesses.map((business) => (
                  <option key={business.businessOwnerId} value={business.businessOwnerId}>
                    {business.store?.name ?? business.seller.displayName}
                  </option>
                ))}
              </select>
            )}
            <span>{user?.email}</span>
            <button className="text-button" type="button" onClick={() => void logout()}>
              Cerrar sesión
            </button>
          </div>
        </header>
        <div className="business-content"><Outlet /></div>
      </div>
    </div>
  );
}
