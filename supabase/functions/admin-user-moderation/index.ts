import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {reconcileUserModeration} from './reconciliation.mjs';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const authorization=req.headers.get('Authorization');
  if(!authorization)return json({error:'unauthorized'},401);
  const url=Deno.env.get('SUPABASE_URL'),anonKey=Deno.env.get('SUPABASE_ANON_KEY'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anonKey||!serviceKey)return json({error:'service_unavailable'},503);
  const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
  const targetUserId=body?.target_user_id,action=body?.action,reason=body?.reason,idempotencyKey=body?.idempotency_key;
  if(!uuid(targetUserId)||!uuid(idempotencyKey)||(action!=='suspend'&&action!=='restore')||typeof reason!=='string'||reason.trim().length<2||reason.trim().length>500){
    return json({error:'invalid_request'},400);
  }
  const caller=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:identityError}=await caller.auth.getUser();
  if(identityError||!identity.user)return json({error:'unauthorized'},401);
  const {data:prepared,error:prepareError}=await caller.rpc('admin_prepare_user_moderation_action',{
    p_target_user_id:targetUserId,p_action:action,p_reason:reason.trim(),p_idempotency_key:idempotencyKey,
  });
  if(prepareError){const forbidden=prepareError.code==='42501'||prepareError.code==='28000';return json({error:forbidden?'forbidden':prepareError.code==='23505'?'idempotency_conflict':'prepare_failed'},forbidden?403:prepareError.code==='23505'?409:400);}
  if(!prepared||prepared.target_user_id!==targetUserId||prepared.action!==action||!uuid(prepared.id))return json({error:'command_mismatch'},409);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await reconcileUserModeration({
    prepared,action,
    readAuthState:async()=>{
      const {data,error}=await service.auth.admin.getUserById(targetUserId as string);
      if(error||!data.user)throw error||{code:'auth_user_not_found'};
      return data.user.banned_until;
    },
    updateAuthState:async()=>{
      const {data,error}=await service.auth.admin.updateUserById(targetUserId as string,{ban_duration:action==='suspend'?'876000h':'none'});
      if(error||!data.user)throw error||{code:'auth_admin_response_invalid'};
      return data.user.banned_until;
    },
    finalize:async({result,bannedUntilAfter,providerErrorCode}:{result:'succeeded'|'failed';bannedUntilAfter:string|null;providerErrorCode:string|null})=>{
      const {data,error}=await service.rpc('admin_finalize_user_moderation_action',{
        p_action_id:prepared.id,p_result:result,p_auth_banned_until_before:prepared.auth_banned_until_before,
        p_auth_banned_until_after:bannedUntilAfter,p_provider_error_code:providerErrorCode,
      });
      if(error)throw error;
      return data;
    },
  });
  if(result.kind==='succeeded')return json({success:true,receipt:result.receipt});
  if(result.kind==='retryable')return json({error:result.error,retryable:true},503);
  const status=result.error==='auth_state_changed'||result.error==='command_failed'||result.error==='command_state_invalid'?409:502;
  return json({error:result.error,code:result.providerErrorCode,receipt:result.receipt},status);
});
