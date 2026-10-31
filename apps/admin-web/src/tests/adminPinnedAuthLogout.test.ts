import {expect,it} from "vitest";
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
