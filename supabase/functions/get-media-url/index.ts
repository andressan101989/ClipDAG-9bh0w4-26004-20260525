import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { publicUrl,signGet } from '../_shared/r2.ts';
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({}));
  const {data:a}=await admin().from('media_assets').select('*').eq('id',asset_id).eq('status','ready').maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.visibility==='private'&&a.owner_id!==user.id) return json({error:'forbidden'},403);
  const url=a.visibility==='public'?publicUrl(a.object_key):await signGet(a.bucket_name,a.object_key);
  return json({success:true,data:{assetId:a.id,url,expiresAt:a.visibility==='private'?new Date(Date.now()+300_000).toISOString():null}});
});
