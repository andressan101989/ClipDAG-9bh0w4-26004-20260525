import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAdminAccess, type AdminAccess } from "../lib/adminApi";
import { supabase } from "../lib/supabase";
import {adminLogoutFence,logoutFenceKey} from "./adminLogoutFence";

/* eslint-disable react-refresh/only-export-components */

type Assurance="aal1"|"aal2"|null;
type SecurityState={currentLevel:Assurance;nextLevel:Assurance;error:string|null};
type AuthState={loading:boolean;session:Session|null;admin:AdminAccess|null;denied:boolean;error:string|null;refreshing?:boolean;security?:SecurityState;hasCapability:(capability:string)=>boolean;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;retry:()=>Promise<void>};
const Context=createContext<AuthState|null>(null);
const unknownSecurity:SecurityState={currentLevel:null,nextLevel:null,error:null};
const expired=(session:Session)=>session.expires_at!==undefined&&session.expires_at*1000<=Date.now();
const forbidden=(message:string)=>/forbidden|denegado|admin_role_set_invalid|admin_actor_inactive|admin_auth_required/.test(message);
const authenticationFailure=(error:unknown)=>!!error&&typeof error==="object"&&"code" in error&&["42501","28000","PGRST301","PGRST302","PGRST303"].includes(String(error.code));

export function AdminAuthProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null),[admin,setAdmin]=useState<AdminAccess|null>(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[denied,setDenied]=useState(false),[error,setError]=useState<string|null>(null),[security,setSecurity]=useState<SecurityState>(unknownSecurity);
  const generation=useRef(0),intent=useRef(0),logoutBlocked=useRef(false),sessionRef=useRef<Session|null>(null),adminRef=useRef<AdminAccess|null>(null);
  const invalidate=useCallback(()=>{generation.current++;intent.current++},[]);
  const authorize=useCallback(async(next:Session|null)=>{
    const version=++generation.current;
    const blocked=logoutBlocked.current||adminLogoutFence.isBlocked();
    if(blocked){logoutBlocked.current=true;next=null}
    const sameUser=!!next&&sessionRef.current?.user.id===next.user.id;
    const preserve=sameUser&&!!adminRef.current&&next!==null&&!expired(next);
    sessionRef.current=next;setSession(next);setDenied(false);setError(blocked?"El acceso local está bloqueado. Inicia sesión de nuevo con tu contraseña.":null);
    if(!preserve){adminRef.current=null;setAdmin(null);setSecurity(unknownSecurity)}
    setLoading(!!next&&!preserve);setRefreshing(!!next&&preserve);
    if(!next)return;
    // Auth callbacks hold the Supabase auth lock. Run API work after releasing it.
    await new Promise<void>((resolve)=>setTimeout(resolve,0));
    if(version!==generation.current)return;
    try{
      const access=await getAdminAccess();
      if(version!==generation.current)return;
      if(expired(next))throw new Error("Sesión expirada. Inicia sesión de nuevo.");
      adminRef.current=access;setAdmin(access);
      try{
        const result=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if(version!==generation.current)return;
        if(result.error)throw result.error;
        setSecurity({currentLevel:result.data.currentLevel,nextLevel:result.data.nextLevel,error:null});
      }catch{if(version===generation.current)setSecurity({...unknownSecurity,error:"No se pudo verificar el nivel de seguridad."})}
    }catch(e){
      if(version!==generation.current)return;
      const message=e instanceof Error?e.message:"No se pudo validar el acceso";
      const isDenied=authenticationFailure(e)||forbidden(message);
      if(isDenied||!preserve||expired(next)){adminRef.current=null;setAdmin(null);setSecurity(unknownSecurity)}
      setDenied(isDenied);setError(message);
    }finally{if(version===generation.current){setLoading(false);setRefreshing(false)}}
  },[]);
  useEffect(()=>{
    const initial=generation.current;
    if(adminLogoutFence.isBlocked()){logoutBlocked.current=true;void Promise.resolve(supabase.auth.stopAutoRefresh()).catch(()=>undefined)}
    void supabase.auth.getSession().then(({data,error:sessionError})=>{
      if(generation.current!==initial)return;
      if(sessionError){setError("No se pudo recuperar la sesión. Reintenta el acceso.");setLoading(false);return}
      void authorize(data.session);
    }).catch(()=>{if(generation.current===initial){setError("No se pudo recuperar la sesión. Reintenta el acceso.");setLoading(false)}});
    const {data}=supabase.auth.onAuthStateChange((event,next)=>{void authorize(event==="SIGNED_OUT"?null:next)});
    return()=>{invalidate();data.subscription.unsubscribe()};
  },[authorize,invalidate]);
  useEffect(()=>{
    const onStorage=(event:StorageEvent)=>{if(event.key===logoutFenceKey&&(event.newValue==="blocked"||event.newValue?.startsWith("blocked:"))){adminLogoutFence.observeLogout();logoutBlocked.current=true;intent.current++;void authorize(null);void Promise.resolve(supabase.auth.stopAutoRefresh()).catch(()=>undefined)}};
    window.addEventListener("storage",onStorage);return()=>window.removeEventListener("storage",onStorage);
  },[authorize]);
  useEffect(()=>{
    if(!session?.expires_at)return;
    const timer=setTimeout(()=>{generation.current++;adminRef.current=null;setAdmin(null);setSecurity(unknownSecurity);setLoading(false);setRefreshing(false);setError("Sesión expirada. Inicia sesión de nuevo.")},Math.max(0,session.expires_at*1000-Date.now()));
    return()=>clearTimeout(timer);
  },[session]);
  const login=useCallback(async(email:string,password:string)=>{
    const attempt=++intent.current;setLoading(true);setError(null);
    try{
      const {data,error:authError}=await supabase.auth.signInWithPassword({email,password});
      if(attempt!==intent.current)return;
      if(authError)throw authError;
      if(!data.session)throw new Error("No se pudo iniciar sesión.");
      logoutBlocked.current=false;adminLogoutFence.clearAfterPasswordLogin();
      await authorize(data.session);
      if(attempt===intent.current)await supabase.auth.startAutoRefresh();
    }catch(e){if(attempt===intent.current)setLoading(false);throw e}
  },[authorize]);
  const logout=useCallback(async()=>{
    intent.current++;logoutBlocked.current=true;const durable=adminLogoutFence.block();void authorize(null);
    try{await supabase.auth.stopAutoRefresh()}catch{/* Keep the fence even if refresh cleanup fails. */}
    try{const {error:signOutError}=await supabase.auth.signOut();if(signOutError)throw signOutError}
    catch{if(logoutBlocked.current)setError(durable?"Acceso local bloqueado. No se pudo confirmar el cierre remoto; vuelve a ingresar con tu contraseña.":"No se pudo asegurar el cierre tras recargar. El acceso permanece bloqueado en esta página; reintenta cerrar sesión antes de recargar.")}
  },[authorize]);
  const retry=useCallback(async()=>{
    if(logoutBlocked.current||adminLogoutFence.isBlocked()){await authorize(null);return}
    const version=generation.current;
    try{const {data,error:sessionError}=await supabase.auth.getSession();if(version!==generation.current)return;if(sessionError)throw sessionError;await authorize(data.session)}
    catch(e){if(version!==generation.current)return;if(authenticationFailure(e))await authorize(null);else setError("No se pudo recuperar la sesión.")}
  },[authorize]);
  const hasCapability=useCallback((capability:string)=>admin?.capabilities.includes(capability)===true,[admin]);
  const value=useMemo(()=>({loading,refreshing,session,admin,denied,error,security,hasCapability,login,logout,retry}),[loading,refreshing,session,admin,denied,error,security,hasCapability,login,logout,retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdminAuth(){const value=useContext(Context);if(!value)throw new Error("AdminAuthProvider requerido");return value;}
