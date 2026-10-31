import {useLayoutEffect,useRef} from "react";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {adminCommandMaterial,createAdminCommandCoordinator} from "./adminCommandRetry";

/** Rerenders/token refresh preserve intent; material edits and actor changes retire it. */
export function useAdminCommandIntent(drafts:Record<string,unknown>){
  const {session}=useAdminAuth();
  const actor=session?.user.id??"";
  const ref=useRef<ReturnType<typeof createAdminCommandCoordinator>|null>(null);
  if(!ref.current)ref.current=createAdminCommandCoordinator();
  const coordinator=ref.current,material=adminCommandMaterial(drafts);
  useLayoutEffect(()=>{coordinator.observe(actor,JSON.parse(material) as Record<string,unknown>)},[coordinator,actor,material]);
  return coordinator;
}
