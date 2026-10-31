// App-owned logout intent only. Supabase owns all credentials and session storage.
export const logoutFenceKey="nelyon.admin.logout-intent.v1";
export const logoutCookieName="nelyon_admin_logout_intent_v1";
const marker=(value:string|null)=>value==="blocked"||value?.startsWith("blocked:")===true;
type StoredMarker={readable:boolean;value:string|null};
function localMarker():StoredMarker{try{return{readable:true,value:localStorage.getItem(logoutFenceKey)}}catch{return{readable:false,value:null}}}
function cookieMarker():StoredMarker{
  try{const item=document.cookie.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${logoutCookieName}=`));return{readable:true,value:item?decodeURIComponent(item.slice(logoutCookieName.length+1)):null}}
  catch{return{readable:false,value:null}}
}
function cookieAttributes(){return `Path=/admin; SameSite=Strict${location.protocol==="https:"?"; Secure":""}`}

export function createAdminLogoutFence(){
  let memoryBlocked=false,explicitLogin=false,ignoredLocal:string|null=null,ignoredCookie:string|null=null;
  const observeLogout=()=>{memoryBlocked=true;explicitLogin=false;ignoredLocal=null;ignoredCookie=null};
  return {
    observeLogout,
    isBlocked(){
      if(memoryBlocked)return true;
      const local=localMarker(),cookie=cookieMarker();
      if(marker(local.value)&&local.value!==ignoredLocal||marker(cookie.value)&&cookie.value!==ignoredCookie)return true;
      // Storage failure is not logout evidence. Require explicit authentication
      // before accepting an unknown session, then allow the SDK's memory session.
      return !explicitLogin&&(!local.readable||!cookie.readable);
    },
    block(){
      observeLogout();const value=`blocked:${crypto.randomUUID()}`;
      try{localStorage.setItem(logoutFenceKey,value)}catch{/* Verify readback before relying on persistence. */}
      if(marker(localMarker().value))return true;
      try{document.cookie=`${logoutCookieName}=${encodeURIComponent(value)}; Max-Age=31536000; ${cookieAttributes()}`}catch{/* Some browsers disable every persistent channel. */}
      return marker(cookieMarker().value);
    },
    clearAfterPasswordLogin(){
      try{localStorage.removeItem(logoutFenceKey)}catch{/* A fresh password login can operate in memory. */}
      try{document.cookie=`${logoutCookieName}=; Max-Age=0; ${cookieAttributes()}`}catch{/* No credentials are written or deleted here. */}
      memoryBlocked=false;explicitLogin=true;
      // A retained, read-only old marker still blocks a later page reload. It
      // must not lock out this explicitly authenticated in-memory session. New
      // logout markers have unique values and are therefore never ignored.
      ignoredLocal=localMarker().value;ignoredCookie=cookieMarker().value;
    },
  };
}

// Module lifetime, independent of React provider remounts.
export const adminLogoutFence=createAdminLogoutFence();
