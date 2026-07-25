import { admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const supplied=req.headers.get('X-Cleanup-Secret');
  const expected=Deno.env.get('MEDIA_CLEANUP_SECRET');
  if(!expected||supplied!==expected) return json({error:'forbidden'},403);
  const db=admin();
  const {data,error}=await db.rpc('cleanup_stale_media_upload_records',{p_limit:50});
  if(error) return json({error:'cleanup_failed'},500);
  let deleted=0;
  for(const row of data??[]) {
    try {
      await deleteObject(row.bucket_name,row.object_key);
      await db.from('media_assets').update({
        status:'deleted',error_code:null,deleted_at:new Date().toISOString(),
        next_cleanup_attempt_at:null,updated_at:new Date().toISOString(),
      }).eq('id',row.id).eq('status','delete_pending');
      deleted++;
    } catch {
      await db.from('media_assets').update({error_code:'delete_retry_required',updated_at:new Date().toISOString()})
        .eq('id',row.id).eq('status','delete_pending');
    }
  }
  return json({success:true,stale:(data??[]).length,objectsDeleted:deleted});
});
