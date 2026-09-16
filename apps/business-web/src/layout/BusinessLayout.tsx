import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BrandMark, StatusBadge } from "../components/BusinessUI";

type BusinessNavItem = {
  label: string;
  symbol: string;
  path?: string;
  enabled?: boolean;
};

const navigation: readonly BusinessNavItem[] = [
  { label: "Inicio", path: "/", symbol: "⌂", enabled: true },
  { label: "Tienda", path: "/store", symbol: "◇", enabled: true },
  { label: "Productos", symbol: "▦" },
  { label: "Pedidos", symbol: "▤" },
  { label: "Publicidad", symbol: "◎" },
  { label: "Media", symbol: "▧" },
  { label: "Finanzas", symbol: "$" },
  { label: "Analítica", symbol: "↗" },
  { label: "Equipo", symbol: "♙" },
  { label: "Configuración", path: "/settings", symbol: "⚙", enabled: true },
];

export function BusinessLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { store, user, logout } = useBusinessAuth();
  const location = useLocation();

  const pageName =
    navigation.find((item) => item.path === location.pathname)?.label ?? "Business";

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
            item.enabled && item.path ? (
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
            <strong>{store?.name}</strong>
            {store && <StatusBadge status={store.status} />}
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
