import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { isUuid } from '../_shared/stream.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  if(!isUuid(body.asset_id)) return json({error:'invalid_asset_id'},400);
  const db=admin();
  const {data,error}=await db.from('video_assets').select('*').eq('id',body.asset_id).eq('owner_id',user.id).maybeSingle();
  if(error) return json({error:'asset_lookup_failed'},500);
  if(!data) return json({error:'asset_not_found'},404);
  if(data.status==='deleted') return json({success:true,data:{assetId:data.id,status:'deleted'}});
  const {data:schedule,error:scheduleError}=await db.rpc(
    'schedule_video_asset_deletion_v1',
    {p_asset_id:data.id,p_owner_id:user.id},
  );
  if(scheduleError) return json({error:'asset_state_failed'},503);
  if(schedule==='asset_in_use') return json({error:'asset_in_use'},409);
  if(schedule==='not_found') return json({error:'asset_not_found'},404);
  if(schedule==='deleted') return json({success:true,data:{assetId:data.id,status:'deleted'}});
  if(schedule==='exhausted') return json({error:'stream_cleanup_attempts_exhausted'},409);
  if(schedule!=='scheduled') return json({error:'delete_schedule_failed'},503);
  return json({success:true,data:{assetId:data.id,status:'delete_pending'}});
});
