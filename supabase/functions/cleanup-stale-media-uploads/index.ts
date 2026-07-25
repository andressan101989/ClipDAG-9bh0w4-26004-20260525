import { admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const supplied=req.headers.get('X-Cleanup-Secret');
  const expected=Deno.env.get('CALL_DISPATCH_SECRET');
  if(!expected||supplied!==expected) return json({error:'forbidden'},403);
  const db=admin();
  const {data,error}=await db.rpc('cleanup_stale_media_upload_records');
  if(error) return json({error:'cleanup_failed'},500);
  let deleted=0;
  for(const row of data??[]) { try { await deleteObject(row.bucket_name,row.object_key); deleted++; } catch { /* next cycle */ } }
  const {data:retryRows}=await db.from('media_assets').select('id,bucket_name,object_key').eq('status','deleted').eq('error_code','delete_retry_required').limit(50);
  for(const row of retryRows??[]) { try { await deleteObject(row.bucket_name,row.object_key); await db.from('media_assets').update({error_code:null}).eq('id',row.id); deleted++; } catch { /* retry later */ } }
  return json({success:true,stale:(data??[]).length,objectsDeleted:deleted});
});
