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
  const {data:access,error:accessError}=await caller.rpc('admin_actor_has_capability',{
    p_capability:'marketplace.disputes.read',
  });
  return !accessError&&access===true;
}

type AdminContext={surface:'story'|'reported_message'|'marketplace_dispute';entity_id:string};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function callerHasCapability(req:Request,capability:string){
  const caller=authenticatedClient(req);if(!caller)return false;
  const {data,error}=await caller.rpc('admin_actor_has_capability',{p_capability:capability});
  return !error&&data===true;
}
async function adminContextAllows(req:Request,asset:{id:string;purpose:string;media_kind:string},context:AdminContext){
  if(context.surface==='story'){
    if(!await callerHasCapability(req,'stories.items.read'))return false;
    const kindMatches=(asset.purpose==='story_image'&&asset.media_kind==='image')||(asset.purpose==='story_video'&&asset.media_kind==='video');
    if(!kindMatches)return false;
    const {data,error}=await admin().from('media_asset_links').select('asset_id').eq('asset_id',asset.id).eq('entity_type','story').eq('entity_id',context.entity_id).eq('slot','media').eq('position',0).limit(1).maybeSingle();
    return !error&&Boolean(data);
  }
  if(context.surface==='reported_message'){
    if(!await callerHasCapability(req,'chat.abuse_reports.read'))return false;
    const {data:report,error:reportError}=await admin().from('reports').select('reported_content_id').eq('id',context.entity_id).eq('reported_content_type','message').limit(1).maybeSingle();
    if(reportError||!report)return false;
    const {data:message,error:messageError}=await admin().from('messages').select('media_asset_id').eq('id',report.reported_content_id).eq('media_asset_id',asset.id).limit(1).maybeSingle();
    return !messageError&&Boolean(message)&&(asset.purpose==='chat_image'||asset.purpose==='chat_video'||asset.purpose==='voice_note');
  }
  if(context.surface==='marketplace_dispute'){
    if(!await callerHasCapability(req,'marketplace.disputes.read'))return false;
    const {data,error}=await admin().from('media_asset_links').select('asset_id').eq('asset_id',asset.id).eq('entity_type','marketplace_dispute').eq('entity_id',context.entity_id).in('slot',['buyer_evidence','seller_evidence']).limit(1).maybeSingle();
    return !error&&Boolean(data);
  }
  return false;
}

async function returnParticipantMayReadLabel(assetId:string,userId:string){
  const database=admin();
  const {data:links,error:linksError}=await database.from('media_asset_links')
    .select('entity_id')
    .eq('asset_id',assetId)
    .eq('entity_type','marketplace_return_shipment')
    .eq('slot','return_label');
  if(linksError||!links?.length)return false;
  const shipmentIds=[...new Set(links.map(link=>link.entity_id))];
  const {data:shipment,error:shipmentError}=await database.from('marketplace_return_shipments')
    .select('id')
    .in('id',shipmentIds)
    .eq('return_label_asset_id',assetId)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .limit(1)
    .maybeSingle();
  return !shipmentError&&Boolean(shipment);
}

async function visibleStoryForAsset(req:Request,assetId:string){
  const {data:links,error:linksError}=await admin().from('media_asset_links')
    .select('entity_id')
    .eq('asset_id',assetId)
    .eq('entity_type','story')
    .eq('slot','media')
    .eq('position',0)
    .limit(2);
  if(linksError||links?.length!==1)return null;
  const caller=authenticatedClient(req);
  if(!caller)return null;
  const {data:story,error:storyError}=await caller.from('stories')
    .select('id,expires_at')
    .eq('id',links[0].entity_id)
    .gt('expires_at',new Date().toISOString())
    .maybeSingle();
  return storyError||!story?null:story;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=='POST') return corsJson({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return corsJson({error:'unauthorized'},401);
  const {asset_id,admin_context}=await req.json().catch(()=>({}));
  if(typeof asset_id!=='string'||!uuidPattern.test(asset_id))return corsJson({error:'invalid_request'},400);
  const {data:a}=await admin().from('media_assets').select('*').eq('id',asset_id).eq('status','ready').maybeSingle();
  if(!a) return corsJson({error:'not_found'},404);
  if(admin_context!==undefined){
    if(!admin_context||typeof admin_context!=='object'||!['story','reported_message','marketplace_dispute'].includes(admin_context.surface)||typeof admin_context.entity_id!=='string'||!uuidPattern.test(admin_context.entity_id))return corsJson({error:'invalid_admin_context'},400);
    if(!await adminContextAllows(req,a,admin_context as AdminContext))return corsJson({error:'forbidden'},403);
    try{
      const url=a.visibility==='public'?publicUrl(a.object_key):await signGet(a.bucket_name,a.object_key,300);
      return corsJson({success:true,data:{assetId:a.id,url,expiresAt:a.visibility==='private'?new Date(Date.now()+300_000).toISOString():null}});
    }catch{return corsJson({error:'signed_access_unavailable'},503);}
  }
  const storyKindMatches=(a.purpose==='story_image'&&a.media_kind==='image')
    ||(a.purpose==='story_video'&&a.media_kind==='video');
  if(a.purpose==='story_image'||a.purpose==='story_video'){
    if(a.visibility!=='private'||!storyKindMatches)return corsJson({error:'forbidden'},403);
    const story=await visibleStoryForAsset(req,a.id);
    if(!story)return corsJson({error:'forbidden'},403);
    const remainingSeconds=Math.floor((Date.parse(story.expires_at)-Date.now())/1000);
    if(!Number.isSafeInteger(remainingSeconds)||remainingSeconds<=0)return corsJson({error:'forbidden'},403);
    const signedTtlSeconds=Math.min(300,remainingSeconds);
    let signedUrl:string;
    try{signedUrl=await signGet(a.bucket_name,a.object_key,signedTtlSeconds);}
    catch{return corsJson({error:'signed_access_unavailable'},503);}
    return corsJson({success:true,data:{
      assetId:a.id,url:signedUrl,expiresAt:new Date(Date.now()+signedTtlSeconds*1000).toISOString(),
    }});
  }
  if(a.purpose==='chat_image'||a.purpose==='chat_video'||a.purpose==='voice_note'){
    const caller=authenticatedClient(req);
    if(!caller)return corsJson({error:'unauthorized'},401);
    let signedUrl:string;
    try{signedUrl=await signGet(a.bucket_name,a.object_key);}
    catch{return corsJson({error:'signed_access_unavailable'},503);}
    const {data:access,error:accessError}=await caller.rpc('chat_authorize_media_access',{p_asset_id:a.id});
    if(accessError){
      const code=String(accessError.message??'');
      if(code.includes('chat_media_already_consumed'))return corsJson({error:'already_consumed'},409);
      if(code.includes('chat_media_not_found')||code.includes('chat_media_unavailable'))return corsJson({error:'not_found'},404);
      return corsJson({error:'forbidden'},403);
    }
    const grant=Array.isArray(access)?access[0]:access;
    if(!grant?.bucket_name||!grant?.object_key)return corsJson({error:'forbidden'},403);
    if(grant.bucket_name!==a.bucket_name||grant.object_key!==a.object_key)return corsJson({error:'forbidden'},403);
    return corsJson({success:true,data:{
      assetId:a.id,url:signedUrl,expiresAt:new Date(Date.now()+300_000).toISOString(),
      consumptionPolicy:grant.consumption_policy,consumedAt:grant.consumed_at??null,
    }});
  }
  if(a.visibility==='private'&&a.owner_id!==user.id
    &&!(await sellerMayReadBuyerDisputeEvidence(a.id,user.id))
    &&!(await returnParticipantMayReadLabel(a.id,user.id))
    &&!(await adminMayReadDisputeEvidence(req,a.id))) return corsJson({error:'forbidden'},403);
  const url=a.visibility==='public'?publicUrl(a.object_key):await signGet(a.bucket_name,a.object_key);
  return corsJson({success:true,data:{assetId:a.id,url,expiresAt:a.visibility==='private'?new Date(Date.now()+300_000).toISOString():null}});
});
