import {useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from "react";
import {NavLink,Outlet,useLocation,useNavigate} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminBreadcrumbs} from "../components/AdminDashboard";
import {AdminIcon} from "../components/AdminIcon";
import {NelyonBrand} from "../components/NelyonBrand";
import {adminLinks,adminNavigationGroups,type AdminLink,type AdminNavigationGroup} from "./adminNavigation";

const GROUP_STORAGE_KEY="nelyon.admin.navigation.groups.v1";
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("")||"AD";

function readGroupState():Partial<Record<AdminNavigationGroup,boolean>>{
  try{
    const value=JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY)??"{}");
    return value&&typeof value==="object"?value:{};
  }catch{return {}}
}

export function AdminShell(){
  const {admin,hasCapability,logout,security,refreshing,error,retry}=useAdminAuth(),location=useLocation(),navigate=useNavigate();
  const [navigationOpen,setNavigationOpen]=useState(false),[query,setQuery]=useState(""),[activeResult,setActiveResult]=useState(0),[groupOverrides,setGroupOverrides]=useState<Partial<Record<AdminNavigationGroup,boolean>>>(readGroupState),searchRef=useRef<HTMLInputElement>(null);
  const authorized=useMemo(()=>adminLinks.filter((link)=>[link.capability,...(link.additionalCapabilities??[])].every(hasCapability)),[hasCapability]);
  const groups=useMemo(()=>adminNavigationGroups.filter((group)=>authorized.some((link)=>link.group===group.id)),[authorized]);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const results=normalizedQuery?authorized.filter((link)=>link.label.toLocaleLowerCase().includes(normalizedQuery)||link.sectionLabel.toLocaleLowerCase().includes(normalizedQuery)).slice(0,8):[];
  const match=[...authorized].sort((a,b)=>b.to.length-a.to.length).find((link)=>location.pathname===link.to||location.pathname.startsWith(`${link.to}/`));
  const activeGroup=match?.group,activeGroupDefinition=adminNavigationGroups.find((group)=>group.id===activeGroup);
  const authorizedChildren=(group:AdminNavigationGroup)=>authorized.filter((link)=>link.group===group);
  const isExpanded=(group:AdminNavigationGroup)=>groupOverrides[group]??activeGroup===group;
  const closeSearch=()=>{setQuery("");setActiveResult(0)};
  const selectResult=(link:AdminLink|undefined)=>{if(!link)return;navigate(link.to);closeSearch();searchRef.current?.focus()};
  const onSearchKeyDown=(event:ReactKeyboardEvent<HTMLInputElement>)=>{
    if(event.key==="ArrowDown"&&results.length){event.preventDefault();setActiveResult((index)=>(index+1)%results.length)}
    if(event.key==="ArrowUp"&&results.length){event.preventDefault();setActiveResult((index)=>(index-1+results.length)%results.length)}
    if(event.key==="Enter"&&results.length){event.preventDefault();selectResult(results[activeResult]??results[0])}
    if(event.key==="Escape"){event.preventDefault();closeSearch()}
  };
  useEffect(()=>{setNavigationOpen(false);closeSearch()},[location.pathname]);
  useEffect(()=>{setActiveResult(0)},[normalizedQuery]);
  useEffect(()=>{try{localStorage.setItem(GROUP_STORAGE_KEY,JSON.stringify(groupOverrides))}catch{return}},[groupOverrides]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();searchRef.current?.focus()}if(event.key==="Escape"){setNavigationOpen(false);closeSearch();searchRef.current?.blur()}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[]);
  const identity=admin?.display_name??admin?.username??"Admin",role=admin?.roles.join(" · ")??"";
  const breadcrumbItems=match&&activeGroupDefinition?[{label:activeGroupDefinition.label},{label:match.sectionLabel,current:true}]:[];
  return <div className="admin-layout" data-theme="nelyon-admin-light">
    <aside className={`sidebar ${navigationOpen?"is-open":""}`} aria-label="Admin sidebar">
      <NelyonBrand role={role}/>
      <nav id="admin-navigation" aria-label="Administración global">{groups.map((groupDefinition)=>{
        const group=groupDefinition.id,children=authorizedChildren(group),expanded=isExpanded(group),active=activeGroup===group,controls=`admin-group-${group}`;
        return <div className="sidebar-group" key={group}>
          <button aria-controls={controls} aria-expanded={expanded} className={`sidebar-group-toggle${active?" is-active":""}`} onClick={()=>setGroupOverrides((current)=>({...current,[group]:!expanded}))} type="button"><AdminIcon name={groupDefinition.icon}/><span>{groupDefinition.label}</span><span aria-hidden="true" className="sidebar-group-chevron">{expanded?"−":"+"}</span></button>
          {expanded&&<div className="sidebar-group-children" id={controls}>{children.map((child)=><NavLink end={child.end} to={child.to} key={child.to}>{child.sectionLabel}</NavLink>)}</div>}
        </div>;
      })}</nav>
      <div className="brand-card"><strong>Secure<br/>Scalable<br/>Creator Economy</strong><small>PEOPLE · CREATORS · OPPORTUNITIES</small></div>
    </aside>
    {navigationOpen&&<button aria-label="Cerrar navegación" className="nav-scrim" onClick={()=>setNavigationOpen(false)} type="button"/>}
    <div className="workspace">
      <header className="topbar">
        <button aria-controls="admin-navigation" aria-expanded={navigationOpen} aria-label={navigationOpen?"Cerrar navegación":"Abrir navegación"} className="nav-toggle" onClick={()=>setNavigationOpen((open)=>!open)} type="button"><AdminIcon name={navigationOpen?"close":"menu"}/></button>
        <div className="command-search"><AdminIcon name="search"/><input aria-activedescendant={results.length?`admin-command-result-${activeResult}`:undefined} aria-autocomplete="list" aria-controls="admin-command-results" aria-expanded={results.length>0} aria-label="Buscar módulos y secciones" autoComplete="off" onChange={(event)=>setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="Buscar módulos y secciones…" ref={searchRef} role="combobox" value={query}/><kbd>⌘ K</kbd>{results.length>0&&<div className="command-results" id="admin-command-results" role="listbox" aria-label="Rutas autorizadas">{results.map((link,index)=><button aria-selected={index===activeResult} id={`admin-command-result-${index}`} key={link.to} onClick={()=>selectResult(link)} onMouseMove={()=>setActiveResult(index)} role="option" type="button"><AdminIcon name={link.icon}/><span>{link.label}</span><small>{link.to}</small></button>)}</div>}</div>
        <div className="current-module"><span>{match?.label??"Admin Console"}</span></div>
        <div className="admin-identity"><span className="avatar">{initials(identity)}</span><div><strong>{identity}</strong><small>{role}</small></div><button aria-label="Cerrar sesión" className="icon-button" onClick={()=>void logout()} title="Cerrar sesión" type="button"><AdminIcon name="logout"/></button></div>
      </header>
      <main className="content">{breadcrumbItems.length>0&&<AdminBreadcrumbs items={breadcrumbItems}/>}
        {refreshing&&<p role="status">Actualizando acceso administrativo…</p>}
        {error&&<div role="status"><p>{error}</p><button onClick={()=>void retry()}>Reintentar acceso</button></div>}
        {security?.currentLevel==="aal1"&&location.pathname!=="/system/security"&&<p role="status"><NavLink to="/system/security">{security.nextLevel==="aal2"?"Verificar autenticador para operaciones sensibles":"Configurar autenticador para operaciones sensibles"}</NavLink></p>}
        <Outlet/>
      </main>
    </div>
  </div>
}
