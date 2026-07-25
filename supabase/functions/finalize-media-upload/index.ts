import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { headObject,publicUrl } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({})); const db=admin();
  const {data:a}=await db.from('media_assets').select('*').eq('id',asset_id).eq('owner_id',user.id).maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.status==='ready') return json({success:true,data:{assetId:a.id,provider:'r2',mediaKind:a.media_kind,purpose:a.purpose,visibility:a.visibility,status:'ready',...(a.visibility==='public'?{url:publicUrl(a.object_key)}:{})}});
  if(!['pending','uploading'].includes(a.status)) return json({error:'invalid_status'},409);
  try {
    const head=await headObject(a.bucket_name,a.object_key);
    if(Number(head.ContentLength)!==Number(a.size_bytes)||head.ContentType!==a.mime_type) {
      await db.from('media_assets').update({status:'failed',error_code:'object_mismatch',updated_at:new Date().toISOString()}).eq('id',a.id);
      return json({error:'object_mismatch'},409);
    }
    await db.from('media_assets').update({status:'ready',etag:String(head.ETag??'').replaceAll('\"',''),ready_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',a.id);
    return json({success:true,data:{assetId:a.id,provider:'r2',mediaKind:a.media_kind,purpose:a.purpose,visibility:a.visibility,status:'ready',...(a.visibility==='public'?{url:publicUrl(a.object_key)}:{})}});
  } catch {
    await db.from('media_assets').update({status:'failed',error_code:'object_missing',updated_at:new Date().toISOString()}).eq('id',a.id);
    return json({error:'object_missing'},409);
  }
});
