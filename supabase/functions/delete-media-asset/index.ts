import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({})); const db=admin();
  const {data:a}=await db.from('media_assets').select('*').eq('id',asset_id).eq('owner_id',user.id).maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.status==='deleted') return json({success:true,alreadyDeleted:true});
  await db.from('media_assets').update({status:'deleted',deleted_at:new Date().toISOString(),updated_at:new Date().toISOString(),error_code:null}).eq('id',a.id);
  try { await deleteObject(a.bucket_name,a.object_key); }
  catch { await db.from('media_assets').update({error_code:'delete_retry_required'}).eq('id',a.id); return json({success:false,error:'delete_retry_required'},503); }
  return json({success:true,alreadyDeleted:false});
});
