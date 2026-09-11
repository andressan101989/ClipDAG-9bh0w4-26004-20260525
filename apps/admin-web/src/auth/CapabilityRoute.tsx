import { Outlet } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthProvider";

export function CapabilityRoute({capability}:{capability:string}){
  const {hasCapability}=useAdminAuth();
  if(!hasCapability(capability))return <main className="center-state"><div className="state-card"><span className="state-icon">!</span><h1>Acceso restringido</h1><p>Esta sección requiere una capability adicional.</p></div></main>;
  return <Outlet/>;
}
