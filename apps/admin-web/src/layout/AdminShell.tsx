import {useEffect,useMemo,useRef,useState} from "react";
import {NavLink,Outlet,useLocation,useNavigate} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminIcon} from "../components/AdminIcon";
import {adminLinks} from "./adminNavigation";

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("")||"AD";

export function AdminShell(){
  const {admin,hasCapability,logout}=useAdminAuth(),location=useLocation(),navigate=useNavigate();
  const [navigationOpen,setNavigationOpen]=useState(false),[query,setQuery]=useState(""),searchRef=useRef<HTMLInputElement>(null);
  const authorized=useMemo(()=>adminLinks.filter((link)=>hasCapability(link.capability)),[hasCapability]);
  const primary=authorized.filter((link)=>link.primary);
  const results=query.trim()?authorized.filter((link)=>link.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,8):[];
  const match=[...authorized].sort((a,b)=>b.to.length-a.to.length).find((link)=>location.pathname===link.to||location.pathname.startsWith(`${link.to}/`));
  useEffect(()=>{setNavigationOpen(false);setQuery("")},[location.pathname]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();searchRef.current?.focus()}if(event.key==="Escape"){setNavigationOpen(false);setQuery("");searchRef.current?.blur()}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[]);
  const identity=admin?.display_name??admin?.username??"Admin",role=admin?.roles.join(" · ")??"";
  return <div className="admin-layout">
    <aside className={`sidebar ${navigationOpen?"is-open":""}`} aria-label="Admin sidebar">
      <div className="brand"><span className="brand-mark"><i/></span><div><strong>ONSPACE</strong><small>Admin Console <em>{role}</em></small></div></div>
      <nav id="admin-navigation" aria-label="Administración global">{primary.map((link)=><NavLink end={link.end} to={link.to} key={link.to}><AdminIcon name={link.icon}/><span>{link.label}</span></NavLink>)}</nav>
      <div className="brand-card"><strong>Secure<br/>Scalable<br/>Creator Economy</strong><small>PEOPLE · CREATORS · OPPORTUNITIES</small></div>
    </aside>
    {navigationOpen&&<button aria-label="Cerrar navegación" className="nav-scrim" onClick={()=>setNavigationOpen(false)} type="button"/>}
    <div className="workspace">
      <header className="topbar">
        <button aria-controls="admin-navigation" aria-expanded={navigationOpen} aria-label={navigationOpen?"Cerrar navegación":"Abrir navegación"} className="nav-toggle" onClick={()=>setNavigationOpen((open)=>!open)} type="button"><AdminIcon name={navigationOpen?"close":"menu"}/></button>
        <div className="command-search"><AdminIcon name="search"/><input aria-label="Buscar módulos y secciones" autoComplete="off" onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar módulos y secciones…" ref={searchRef} value={query}/><kbd>⌘ K</kbd>{results.length>0&&<div className="command-results" role="listbox" aria-label="Rutas autorizadas">{results.map((link)=><button key={link.to} onClick={()=>navigate(link.to)} role="option" type="button"><AdminIcon name={link.icon}/><span>{link.label}</span><small>{link.to}</small></button>)}</div>}</div>
        <div className="current-module"><span>{match?.label??"Admin Console"}</span></div>
        <div className="admin-identity"><span className="avatar">{initials(identity)}</span><div><strong>{identity}</strong><small>{role}</small></div><button aria-label="Cerrar sesión" className="icon-button" onClick={()=>void logout()} title="Cerrar sesión" type="button"><AdminIcon name="logout"/></button></div>
      </header>
      <main className="content"><Outlet/></main>
    </div>
  </div>
}
