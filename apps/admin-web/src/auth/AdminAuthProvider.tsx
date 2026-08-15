import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAdminAccess, type AdminAccess } from "../lib/adminApi";
import { supabase } from "../lib/supabase";

/* eslint-disable react-refresh/only-export-components */

type AuthState={loading:boolean;session:Session|null;admin:AdminAccess|null;denied:boolean;error:string|null;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;retry:()=>Promise<void>};
const Context=createContext<AuthState|null>(null);

export function AdminAuthProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null),[admin,setAdmin]=useState<AdminAccess|null>(null),[loading,setLoading]=useState(true),[denied,setDenied]=useState(false),[error,setError]=useState<string|null>(null);
  const authorize=useCallback(async(next:Session|null)=>{setSession(next);setAdmin(null);setDenied(false);setError(null);if(!next){setLoading(false);return;}setLoading(true);try{setAdmin(await getAdminAccess());}catch(e){const message=e instanceof Error?e.message:"No se pudo validar el acceso";setDenied(/forbidden|denegado|admin/i.test(message));setError(message);}finally{setLoading(false);}},[]);
  useEffect(()=>{void supabase.auth.getSession().then(({data})=>authorize(data.session));const {data}=supabase.auth.onAuthStateChange((_event,next)=>{void authorize(next);});return()=>data.subscription.unsubscribe();},[authorize]);
  const login=useCallback(async(email:string,password:string)=>{setLoading(true);setError(null);const {data,error:authError}=await supabase.auth.signInWithPassword({email,password});if(authError){setLoading(false);throw authError;}await authorize(data.session);},[authorize]);
  const logout=useCallback(async()=>{await supabase.auth.signOut();await authorize(null);},[authorize]);
  const retry=useCallback(async()=>authorize(session),[authorize,session]);
  const value=useMemo(()=>({loading,session,admin,denied,error,login,logout,retry}),[loading,session,admin,denied,error,login,logout,retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdminAuth(){const value=useContext(Context);if(!value)throw new Error("AdminAuthProvider requerido");return value;}
