import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthProvider";

export function AdminRoute(){
  const {loading,session,admin,denied,error,retry,logout}=useAdminAuth();
  if(loading)return <main className="center-state" aria-busy="true"><div className="spinner"/><p>Validando acceso administrativo…</p></main>;
  if(!session)return <Navigate to="/login" replace/>;
  if(!admin)return <main className="center-state"><div className="state-card"><span className="state-icon">!</span><h1>{denied?"Acceso restringido":"No se pudo validar el acceso"}</h1><p>{denied?"Tu sesión es válida, pero no tiene permisos de OnSpace Admin.":error}</p><div className="button-row"><button onClick={()=>void retry()}>Reintentar</button><button className="secondary" onClick={()=>void logout()}>Cerrar sesión</button></div></div></main>;
  return <Outlet/>;
}
