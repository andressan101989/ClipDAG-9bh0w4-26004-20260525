import {useEffect,useState} from "react";
import {NavLink,Outlet,useLocation} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";

const links=[
  {to:"/users",label:"Usuarios",capability:"users.accounts.read",group:"PLATAFORMA"},
  {to:"/reports",label:"Reportes",capability:"reports.cases.read",group:"PLATAFORMA"},
  {to:"/content",label:"Contenido",capability:"content.items.read",group:"PLATAFORMA"},
  {to:"/stories",label:"Stories",capability:"stories.items.read",group:"PLATAFORMA"},
  {to:"/chat/reports",label:"Chat reportado",capability:"chat.abuse_reports.read",group:"PLATAFORMA"},
  {to:"/live",label:"LIVE",capability:"live.sessions.read",group:"OPERACIONES"},
  {to:"/battles",label:"Battles",capability:"battles.sessions.read",group:"OPERACIONES"},
  {to:"/media",label:"Media",capability:"media.assets.read",group:"OPERACIONES"},
  {to:"/access",label:"Acceso",capability:"admin.roles.read",group:"PLATAFORMA"},
  {to:"/marketplace",label:"Resumen",capability:"marketplace.overview.read",group:"MARKETPLACE",end:true},
  {to:"/marketplace/orders",label:"Pedidos",capability:"marketplace.orders.read",group:"MARKETPLACE"},
  {to:"/marketplace/disputes",label:"Disputas",capability:"marketplace.disputes.read",group:"MARKETPLACE"},
  {to:"/marketplace/sellers",label:"Vendedores",capability:"marketplace.sellers.read",group:"MARKETPLACE"},
  {to:"/marketplace/products",label:"Productos",capability:"marketplace.products.read",group:"MARKETPLACE"},
  {to:"/marketplace/creator-commerce",label:"Creator Commerce",capability:"marketplace.creators.read",group:"MARKETPLACE"},
  {to:"/marketplace/promotions",label:"Promociones",capability:"marketplace.promotions.read",group:"MARKETPLACE"},
  {to:"/marketplace/ads",label:"Ads",capability:"marketplace.ads.read",group:"MARKETPLACE"},
  {to:"/marketplace/health",label:"Salud",capability:"marketplace.health.read",group:"MARKETPLACE"},
  {to:"/marketplace/activity",label:"Actividad",capability:"marketplace.audit.read",group:"MARKETPLACE"},
] as const;

export function AdminShell(){const {admin,hasCapability,logout}=useAdminAuth(),location=useLocation();const [navigationOpen,setNavigationOpen]=useState(false);useEffect(()=>setNavigationOpen(false),[location.pathname]);const match=[...links].sort((a,b)=>b.to.length-a.to.length).find((link)=>location.pathname===link.to||location.pathname.startsWith(`${link.to}/`));const title=match?.label??"Administración";return <div className="admin-layout"><aside className="sidebar"><div className="brand"><span className="brand-mark">OS</span><div><strong>OnSpace</strong><small>Admin</small></div></div><button aria-controls="admin-navigation" aria-expanded={navigationOpen} aria-label={navigationOpen?"Cerrar navegación":"Abrir navegación"} className="nav-toggle" onClick={()=>setNavigationOpen((value)=>!value)} type="button"><span aria-hidden="true">{navigationOpen?"×":"☰"}</span>Menú</button><div id="admin-navigation" className="nav-groups">{["PLATAFORMA","OPERACIONES","MARKETPLACE"].map((group)=>{const visible=links.filter((link)=>link.group===group&&hasCapability(link.capability));if(!visible.length)return null;return <div key={group}><p className="nav-section">{group}</p><nav className={navigationOpen?"is-open":""} aria-label={group==="MARKETPLACE"?"Marketplace":"Administración global"}>{visible.map((link)=><NavLink end={"end" in link&&link.end} to={link.to} key={link.to}>{link.label}</NavLink>)}</nav></div>})}</div><div className="sidebar-foot"><span className="status-dot"/>Operaciones internas · Autoridad v{admin?.authority_version.slice(0,8)??"—"}</div></aside><div className="workspace"><header className="topbar"><div><p className="eyebrow">ONSPACE ADMIN</p><h1>{title}</h1></div><div className="admin-identity"><div><strong>{admin?.display_name??admin?.username??"Admin"}</strong><small>{admin?.roles.join(" · ")}</small></div><button className="secondary" onClick={()=>void logout()}>Cerrar sesión</button></div></header><main className="content"><Outlet/></main></div></div>}
