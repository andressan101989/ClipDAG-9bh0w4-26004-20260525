/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const admin=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
export async function authenticatedUser(req:Request) {
  const token=req.headers.get('Authorization');
  if(!token?.startsWith('Bearer ')) return null;
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:token}},auth:{persistSession:false}});
  const {data}=await client.auth.getUser();
  return data.user ?? null;
}
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
