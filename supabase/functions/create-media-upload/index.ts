import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { extensionForMime,validateMediaRequest } from '../_shared/mediaPurposes.ts';
import { R2_PRIVATE_BUCKET,R2_PUBLIC_BUCKET,signPut } from '../_shared/r2.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({}));
  const purpose=String(body.purpose??''),mime=String(body.mime_type??''),visibility=String(body.visibility??'');
  const size=Number(body.size_bytes);
  const validated=validateMediaRequest(purpose,mime,size,visibility);
  if('error' in validated) return json({error:validated.error},400);
  const db=admin();
  const minute=new Date(Date.now()-60_000).toISOString();
  const [recentResult,pendingResult,bytesResult] = await Promise.all([
    db.from('media_assets').select('*',{count:'exact',head:true}).eq('owner_id',user.id).gte('created_at',minute),
    db.from('media_assets').select('*',{count:'exact',head:true}).eq('owner_id',user.id).in('status',['pending','uploading']),
    db.from('media_assets').select('size_bytes').eq('owner_id',user.id).gte('created_at',minute),
  ]);
  if(recentResult.error||pendingResult.error||bytesResult.error) return json({error:'rate_limit_unavailable'},503);
  const recent=recentResult.count,pending=pendingResult.count,bytes=bytesResult.data;
  if((recent??0)>=20||(pending??0)>=10) return json({error:'rate_limited'},429);
  if((bytes??[]).reduce((n,r)=>n+Number(r.size_bytes??0),0)+size>500_000_000) return json({error:'byte_rate_limited'},429);
  const id=crypto.randomUUID(),now=new Date(),ext=extensionForMime(mime);
  const env=Deno.env.get('DENO_DEPLOYMENT_ID')?'production':'development';
  const key=`${env}/${purpose}/${user.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${id}.${ext}`;
  const bucket=visibility==='public'?R2_PUBLIC_BUCKET():R2_PRIVATE_BUCKET();
  const safeName=String(body.file_name??'upload').replace(/[\u0000-\u001f\\\/]/g,'_').slice(0,180);
  const {error}=await db.from('media_assets').insert({id,owner_id:user.id,provider:'r2',media_kind:validated.rule.kind,purpose,visibility,bucket_name:bucket,object_key:key,mime_type:mime,size_bytes:size,original_filename:safeName,status:'pending'});
  if(error) return json({error:'asset_create_failed'},500);
  let uploadUrl:string;
  try { uploadUrl=await signPut(bucket,key,mime); }
  catch {
    await db.from('media_assets').update({status:'failed',error_code:'presign_failed',updated_at:new Date().toISOString()}).eq('id',id);
    return json({error:'presign_failed'},503);
  }
  const {error:stateError}=await db.from('media_assets').update({status:'uploading',updated_at:new Date().toISOString()}).eq('id',id);
  if(stateError) {
    await db.from('media_assets').update({
      status:'delete_pending',error_code:'asset_state_failed',
      next_cleanup_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq('id',id);
    return json({error:'asset_state_failed'},503);
  }
  return json({success:true,data:{assetId:id,uploadUrl,method:'PUT',headers:{'Content-Type':mime},expiresAt:new Date(Date.now()+300_000).toISOString()}});
});
