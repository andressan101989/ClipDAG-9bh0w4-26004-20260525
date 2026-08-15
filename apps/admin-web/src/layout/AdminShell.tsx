import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthProvider";

const titles:Record<string,string>={"/marketplace":"Resumen de Marketplace","/marketplace/orders":"Pedidos"};
export function AdminShell(){const {admin,logout}=useAdminAuth();const location=useLocation();const title=location.pathname.startsWith("/marketplace/orders/")?"Detalle del pedido":titles[location.pathname]??"Marketplace";return <div className="admin-layout">
  <aside className="sidebar"><div className="brand"><span className="brand-mark">OS</span><div><strong>OnSpace</strong><small>Admin</small></div></div><p className="nav-section">MARKETPLACE</p><nav aria-label="Marketplace"><NavLink end to="/marketplace">Resumen</NavLink><NavLink to="/marketplace/orders">Pedidos</NavLink></nav><div className="sidebar-foot"><span className="status-dot"/>Solo lectura</div></aside>
  <div className="workspace"><header className="topbar"><div><span className="breadcrumb">Marketplace /</span><h1>{title}</h1></div><div className="admin-identity"><div><strong>{admin?.display_name||admin?.username||"Administrador"}</strong><small>Acceso interno</small></div><button className="ghost" onClick={()=>void logout()}>Salir</button></div></header><main className="content"><Outlet/></main></div>
</div>}
