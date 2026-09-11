import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeProviderCode=(error:{code?:string|null}|null)=>{
  const candidate=String(error?.code||'auth_admin_error').toLowerCase().replace(/[^a-z0-9_.:-]/g,'_').slice(0,120);
  return candidate||'auth_admin_error';
};
const normalizedDate=(value:unknown)=>typeof value==='string'&&value.length?new Date(value).toISOString():null;

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
  if(prepared.status==='succeeded')return json({success:true,receipt:prepared});
  if(prepared.status==='failed')return json({error:'command_failed',receipt:{id:prepared.id,status:'failed',provider_error_code:prepared.provider_error_code}},409);
  if(prepared.status!=='pending')return json({error:'command_state_invalid'},409);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:beforeData,error:beforeError}=await service.auth.admin.getUserById(targetUserId as string);
  if(beforeError||!beforeData.user){
    const code=safeProviderCode(beforeError);
    await service.rpc('admin_finalize_user_moderation_action',{p_action_id:prepared.id,p_result:'failed',p_auth_banned_until_before:prepared.auth_banned_until_before,p_auth_banned_until_after:prepared.auth_banned_until_before,p_provider_error_code:code});
    return json({error:'auth_admin_failed',code},502);
  }
  const actualBefore=normalizedDate(beforeData.user.banned_until),expectedBefore=normalizedDate(prepared.auth_banned_until_before);
  if(actualBefore!==expectedBefore){
    await service.rpc('admin_finalize_user_moderation_action',{p_action_id:prepared.id,p_result:'failed',p_auth_banned_until_before:prepared.auth_banned_until_before,p_auth_banned_until_after:actualBefore,p_provider_error_code:'auth_state_changed'});
    return json({error:'auth_state_changed'},409);
  }
  const {data:updated,error:updateError}=await service.auth.admin.updateUserById(targetUserId as string,{ban_duration:action==='suspend'?'876000h':'none'});
  if(updateError||!updated.user){
    const code=safeProviderCode(updateError);
    await service.rpc('admin_finalize_user_moderation_action',{p_action_id:prepared.id,p_result:'failed',p_auth_banned_until_before:prepared.auth_banned_until_before,p_auth_banned_until_after:actualBefore,p_provider_error_code:code});
    return json({error:'auth_admin_failed',code},502);
  }
  const after=normalizedDate(updated.user.banned_until);
  const {data:receipt,error:finalizeError}=await service.rpc('admin_finalize_user_moderation_action',{
    p_action_id:prepared.id,p_result:'succeeded',p_auth_banned_until_before:prepared.auth_banned_until_before,
    p_auth_banned_until_after:after,p_provider_error_code:null,
  });
  if(finalizeError)return json({error:'finalize_unavailable'},503);
  return json({success:true,receipt});
});
