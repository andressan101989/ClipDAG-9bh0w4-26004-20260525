import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
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
  if(schedule==='exhausted') return json({error:'media_cleanup_attempts_exhausted'},409);
  if(schedule!=='scheduled') return json({error:'delete_schedule_failed'},503);
  return json({success:true,alreadyDeleted:false,status:'delete_pending'});
});
