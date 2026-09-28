import { Outlet } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthProvider";

export function CapabilityRoute({capability,additionalCapabilities=[]}:{capability:string;additionalCapabilities?:string[]}){
  const {hasCapability}=useAdminAuth();
  if(![capability,...additionalCapabilities].every(hasCapability))return <main className="center-state"><div className="state-card"><span className="state-icon">!</span><h1>Acceso restringido</h1><p>Esta sección requiere una capability adicional.</p></div></main>;
  return <Outlet/>;
}
