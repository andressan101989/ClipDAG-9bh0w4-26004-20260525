import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({})); const db=admin();
  const {data:a}=await db.from('media_assets').select('*').eq('id',asset_id).eq('owner_id',user.id).maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.status==='deleted') return json({success:true,alreadyDeleted:true});
  const now=new Date().toISOString();
  const {error:pendingError}=await db.from('media_assets').update({
    status:'delete_pending',error_code:null,next_cleanup_attempt_at:now,updated_at:now,
  }).eq('id',a.id).eq('owner_id',user.id);
  if(pendingError) return json({error:'delete_schedule_failed'},503);
  try {
    await deleteObject(a.bucket_name,a.object_key);
    const {error:deletedError}=await db.from('media_assets').update({
      status:'deleted',deleted_at:new Date().toISOString(),error_code:null,
      cleanup_attempts:Number(a.cleanup_attempts??0)+1,last_cleanup_attempt_at:new Date().toISOString(),
      next_cleanup_attempt_at:null,updated_at:new Date().toISOString(),
    }).eq('id',a.id).eq('status','delete_pending');
    if(deletedError) return json({error:'delete_state_failed'},503);
  } catch {
    await db.from('media_assets').update({
      status:'delete_pending',error_code:'delete_retry_required',
      cleanup_attempts:Number(a.cleanup_attempts??0)+1,
      last_cleanup_attempt_at:new Date().toISOString(),
      next_cleanup_attempt_at:new Date(Date.now()+30_000).toISOString(),
      updated_at:new Date().toISOString(),
    }).eq('id',a.id);
    return json({success:false,error:'delete_retry_required'},503);
  }
  return json({success:true,alreadyDeleted:false});
});
