import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({})); const db=admin();
  const {data:a}=await db.from('media_assets').select('*').eq('id',asset_id).eq('owner_id',user.id).maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.status==='deleted') return json({success:true,alreadyDeleted:true});
  const {data:schedule,error:scheduleError}=await db.rpc('schedule_media_asset_deletion',{
    p_asset_id:a.id,p_owner_id:user.id,
  });
  if(scheduleError) return json({error:'asset_usage_check_failed'},503);
  if(schedule==='asset_in_use') return json({error:'asset_in_use'},409);
  if(schedule==='not_found') return json({error:'not_found'},404);
  if(schedule==='deleted') return json({success:true,alreadyDeleted:true});
  if(schedule!=='scheduled') return json({error:'delete_schedule_failed'},503);
  try {
    await deleteObject(a.bucket_name,a.object_key);
    const {data:finalized,error:deletedError}=await db.rpc('finalize_media_asset_deletion',{
      p_asset_id:a.id,p_owner_id:user.id,
    });
    if(deletedError||finalized!==true) return json({error:'delete_state_failed'},503);
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
