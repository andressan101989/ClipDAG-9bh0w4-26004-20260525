import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAdminAccess, type AdminAccess } from "../lib/adminApi";
import { supabase } from "../lib/supabase";

/* eslint-disable react-refresh/only-export-components */

type Assurance="aal1"|"aal2"|null;
type SecurityState={currentLevel:Assurance;nextLevel:Assurance;error:string|null};
type AuthState={loading:boolean;session:Session|null;admin:AdminAccess|null;denied:boolean;error:string|null;refreshing?:boolean;security?:SecurityState;hasCapability:(capability:string)=>boolean;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;retry:()=>Promise<void>};
const Context=createContext<AuthState|null>(null);
const unknownSecurity:SecurityState={currentLevel:null,nextLevel:null,error:null};
const expired=(session:Session)=>session.expires_at!==undefined&&session.expires_at*1000<=Date.now();
const forbidden=(message:string)=>/forbidden|denegado|admin_role_set_invalid|admin_actor_inactive|admin_auth_required/.test(message);

export function AdminAuthProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null),[admin,setAdmin]=useState<AdminAccess|null>(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[denied,setDenied]=useState(false),[error,setError]=useState<string|null>(null),[security,setSecurity]=useState<SecurityState>(unknownSecurity);
  const generation=useRef(0),sessionRef=useRef<Session|null>(null),adminRef=useRef<AdminAccess|null>(null);
  const invalidate=useCallback(()=>{generation.current++},[]);
  const authorize=useCallback(async(next:Session|null)=>{
    const version=++generation.current;
    const sameUser=!!next&&sessionRef.current?.user.id===next.user.id;
    const preserve=sameUser&&!!adminRef.current&&!expired(next);
    sessionRef.current=next;setSession(next);setDenied(false);setError(null);
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
      const code=e&&typeof e==="object"&&"code" in e?e.code:null;
      const isDenied=code==="42501"||code==="28000"||forbidden(message);
      if(isDenied||!preserve||expired(next)){adminRef.current=null;setAdmin(null);setSecurity(unknownSecurity)}
      setDenied(isDenied);setError(message);
    }finally{if(version===generation.current){setLoading(false);setRefreshing(false)}}
  },[]);
  useEffect(()=>{
    const initial=generation.current;
    void supabase.auth.getSession().then(({data,error:sessionError})=>{
      if(generation.current!==initial)return;
      if(sessionError){setError("No se pudo recuperar la sesión. Reintenta el acceso.");setLoading(false);return}
      void authorize(data.session);
    }).catch(()=>{if(generation.current===initial){setError("No se pudo recuperar la sesión. Reintenta el acceso.");setLoading(false)}});
    const {data}=supabase.auth.onAuthStateChange((event,next)=>{void authorize(event==="SIGNED_OUT"?null:next)});
    return()=>{invalidate();data.subscription.unsubscribe()};
  },[authorize,invalidate]);
  useEffect(()=>{
    if(!session?.expires_at)return;
    const timer=setTimeout(()=>{generation.current++;adminRef.current=null;setAdmin(null);setSecurity(unknownSecurity);setLoading(false);setRefreshing(false);setError("Sesión expirada. Inicia sesión de nuevo.")},Math.max(0,session.expires_at*1000-Date.now()));
    return()=>clearTimeout(timer);
  },[session]);
  const login=useCallback(async(email:string,password:string)=>{
    const initial=generation.current;setLoading(true);setError(null);
    const {data,error:authError}=await supabase.auth.signInWithPassword({email,password});
    if(authError){if(generation.current===initial)setLoading(false);throw authError}
    if(generation.current===initial)await authorize(data.session);
  },[authorize]);
  const logout=useCallback(async()=>{void authorize(null);const {error:signOutError}=await supabase.auth.signOut();if(signOutError)setError("No se pudo cerrar la sesión remota. Reintenta cerrar sesión.")},[authorize]);
  const retry=useCallback(async()=>{const version=generation.current;const {data,error:sessionError}=await supabase.auth.getSession();if(version!==generation.current)return;if(sessionError){setError("No se pudo recuperar la sesión.");return}await authorize(data.session)},[authorize]);
  const hasCapability=useCallback((capability:string)=>admin?.capabilities.includes(capability)===true,[admin]);
  const value=useMemo(()=>({loading,refreshing,session,admin,denied,error,security,hasCapability,login,logout,retry}),[loading,refreshing,session,admin,denied,error,security,hasCapability,login,logout,retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdminAuth(){const value=useContext(Context);if(!value)throw new Error("AdminAuthProvider requerido");return value;}
