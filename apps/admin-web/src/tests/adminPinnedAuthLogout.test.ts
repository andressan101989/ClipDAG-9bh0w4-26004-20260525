import {expect,it,vi} from "vitest";
import {GoTrueClient} from "@supabase/auth-js";

it("characterizes pinned Auth persistence: a remote 503 keeps the session even for local signOut",async()=>{
  const key="task3-pinned-auth-proof",entries=new Map<string,string>();
  const fixture={access_token:"synthetic-access-token",refresh_token:"synthetic-refresh-token",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"synthetic-user",aud:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-10-30T00:00:00Z"}};
  entries.set(key,JSON.stringify(fixture));
  const client=new GoTrueClient({url:"https://auth-proof.invalid",storageKey:key,storage:{getItem:(name)=>entries.get(name)??null,setItem:(name,value)=>{entries.set(name,value)},removeItem:(name)=>{entries.delete(name)}},persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,fetch:async()=>new Response(JSON.stringify({message:"synthetic service failure"}),{status:503,headers:{"Content-Type":"application/json"}})});
  try{
    const before=await client.getSession();expect(before.data.session?.user.id).toBe("synthetic-user");
    for(const scope of ["global","local"] as const){const result=await client.signOut({scope});expect(result.error?.status).toBe(503);expect((await client.getSession()).data.session?.user.id).toBe("synthetic-user");expect(entries.has(key)).toBe(true)}
  }finally{await client.stopAutoRefresh()}
});
it("pinned Auth uses a fresh in-memory session store when browser local storage is unavailable",async()=>{
  for(const method of ["getItem","setItem","removeItem"] as const)vi.spyOn(Storage.prototype,method).mockImplementation(()=>{throw new DOMException("blocked","SecurityError")});
  vi.spyOn(globalThis,"localStorage","get").mockImplementation(()=>{throw new DOMException("blocked","SecurityError")});
  const fixture={access_token:"synthetic-access-token",refresh_token:"synthetic-refresh-token",token_type:"bearer",expires_in:3600,user:{id:"memory-user",aud:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-10-30T00:00:00Z"}};
  const options={url:"https://auth-memory-proof.invalid",storageKey:"task3-memory-auth-proof",persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,fetch:async()=>new Response(JSON.stringify(fixture),{status:200,headers:{"Content-Type":"application/json"}})};
  // The SDK caches its initial storage support probe; a page reload gets a fresh module.
  vi.resetModules();const {GoTrueClient:MemoryClient}=await import("@supabase/auth-js");const client=new MemoryClient(options);let afterReload:GoTrueClient|undefined;
  try{const result=await client.signInWithPassword({email:"operator@example.test",password:"synthetic-password"});expect(result.error).toBeNull();expect((await client.getSession()).data.session?.user.id).toBe("memory-user");vi.resetModules();const {GoTrueClient:ReloadedClient}=await import("@supabase/auth-js");afterReload=new ReloadedClient(options);expect((await afterReload.getSession()).data.session).toBeNull()}
  finally{await client.stopAutoRefresh();await afterReload?.stopAutoRefresh();vi.restoreAllMocks()}
});
