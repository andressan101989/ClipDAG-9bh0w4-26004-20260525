import { authenticatedClient,authenticatedUser,admin } from '../_shared/mediaAuth.ts';
import { publicUrl,signGet } from '../_shared/r2.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const corsJson=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json'},
});

async function sellerMayReadBuyerDisputeEvidence(assetId:string,userId:string){
  const database=admin();
  const {data:links,error:linksError}=await database.from('media_asset_links')
    .select('entity_id')
    .eq('asset_id',assetId)
    .eq('entity_type','marketplace_dispute')
    .eq('slot','buyer_evidence');
  if(linksError||!links?.length)return false;
  const disputeIds=[...new Set(links.map(link=>link.entity_id))];
  const {data:dispute,error:disputeError}=await database.from('marketplace_order_disputes')
    .select('id')
    .in('id',disputeIds)
    .eq('seller_id',userId)
    .limit(1)
    .maybeSingle();
  return !disputeError&&Boolean(dispute);
}

async function adminMayReadDisputeEvidence(req:Request,assetId:string){
  const {data:link,error}=await admin().from('media_asset_links')
    .select('asset_id')
    .eq('asset_id',assetId)
    .eq('entity_type','marketplace_dispute')
    .in('slot',['buyer_evidence','seller_evidence'])
    .limit(1)
    .maybeSingle();
  if(error||!link)return false;
  const caller=authenticatedClient(req);
  if(!caller)return false;
  const {data:access,error:accessError}=await caller.rpc('get_my_marketplace_admin_access');
  return !accessError&&access?.admin===true;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=='POST') return corsJson({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return corsJson({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({}));
  const {data:a}=await admin().from('media_assets').select('*').eq('id',asset_id).eq('status','ready').maybeSingle();
  if(!a) return corsJson({error:'not_found'},404);
  if(a.visibility==='private'&&a.owner_id!==user.id
    &&!(await sellerMayReadBuyerDisputeEvidence(a.id,user.id))
    &&!(await adminMayReadDisputeEvidence(req,a.id))) return corsJson({error:'forbidden'},403);
  const url=a.visibility==='public'?publicUrl(a.object_key):await signGet(a.bucket_name,a.object_key);
  return corsJson({success:true,data:{assetId:a.id,url,expiresAt:a.visibility==='private'?new Date(Date.now()+300_000).toISOString():null}});
});
