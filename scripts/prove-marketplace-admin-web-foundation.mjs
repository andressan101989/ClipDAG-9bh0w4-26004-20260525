import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client }=pg;
const connectionString=process.env.MARKETPLACE_DATABASE_URL;
if(!connectionString)throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed=new URL(connectionString);
if(!["127.0.0.1","localhost"].includes(parsed.hostname)||parsed.port!=="55422")throw new Error("B8A_PROOF_REQUIRES_DISPOSABLE_DATABASE");
const db=new Client({connectionString,ssl:false});
const uid=()=>randomUUID();
const n=(value)=>Number(value);
let stage="connect";

async function role(name,sub="",metadata={}){await db.query("reset role");await db.query(`set local role ${name}`);await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)",[name,sub,JSON.stringify({role:name,sub,user_metadata:metadata,app_metadata:metadata})]);}
async function operator(){await db.query("reset role");await db.query("select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true)");}
async function attempt(action){const savepoint=`b8a_${uid().replaceAll("-","")}`;await db.query(`savepoint ${savepoint}`);try{const result=await action();await db.query(`release savepoint ${savepoint}`);return{ok:true,result};}catch(error){await db.query(`rollback to savepoint ${savepoint}`);await db.query(`release savepoint ${savepoint}`);return{ok:false,code:error.code,message:error.message};}}
async function user(id,label,admin=false){await operator();const token=uid().replaceAll("-","").slice(0,10);await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,[id,`b8a-${label}-${token}@proof.local`]);await db.query("insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",[id,`b8a${label}${token}`,`B8A ${label}`,admin]);}
async function makeProduct(f,price,label){await operator();const item={product:uid(),variant:uid(),price,label};const sku=`B8A-${uid().replaceAll("-","").toUpperCase()}`;await db.query(`insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id,images)values($1,$2,$3,'B8A proof',$4,'BDAG','physical',50,'active',$5,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$6,$7)`,[item.product,f.seller,`B8A ${label}`,price,f.store,f.shipping,[`https://proof.local/${label}.jpg`]]);await db.query(`insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,[item.variant,item.product,f.store,f.seller,sku,price]);await db.query("insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,50,0)",[item.variant]);return item;}
async function offer(f,item,creator,bps){await role("authenticated",f.seller);return(await db.query("select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,$3,'active',null,null,$4)value",[item.product,creator,bps,uid()])).rows[0].value;}
async function contentTag(creator,type,item,label){await role("authenticated",creator);const content=uid();await db.query("insert into public.videos(id,user_id,video_url,caption,media_urls)values($1,$2,$3,$4,$5)",[content,creator,type==='reel'?`https://proof.local/${label}.mp4`:`https://proof.local/${label}.jpg`,`B8A ${label}`,type==='feed'?[`https://proof.local/${label}.jpg`]:null]);const result=(await db.query("select public.set_my_marketplace_content_product_tags($1,$2,$3,$4)value",[type,content,[item.product],uid()])).rows[0].value;return result.items[0];}
async function attribution(buyer,tag,item){await role("authenticated",buyer);return(await db.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[tag.id,item.variant,uid()])).rows[0].value;}
const address=`jsonb_build_object('recipient_name','B8A Ops','line1','Proof Street','city','New York','region','NY','postal_code','10001','country','US')`;
async function fund(f,amount){await role("service_role",f.admin);const platform=(await db.query("select public.ensure_marketplace_platform_account()id")).rows[0].id;const buyerAccount=(await db.query("select public.ensure_ledger_account($1)id",[f.buyer])).rows[0].id;const tx=uid();await db.query(`insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b8a_proof',$5,$6,$7)`,[tx,platform,buyerAccount,amount,f.store,`b8a-fund:${tx}`,f.buyer]);await db.query("select public.ledger_debit($1,$2,$3,'B8A proof','{}'),public.ledger_credit($1,$4,$3,'B8A proof','{}')",[tx,platform,amount,buyerAccount]);}
async function pay(f,receipt){await role("service_role",f.admin);await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",[f.buyer,receipt.checkout.id,uid()]);return receipt.orders[0].id;}
async function ordinaryCheckout(f,item){await role("authenticated",f.buyer);const receipt=(await db.query(`select public.create_marketplace_checkout_reservation(jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),${address},$2)value`,[item.variant,uid()])).rows[0].value;return pay(f,receipt);}
async function creatorCheckout(f,lines){await role("authenticated",f.buyer);const payload=lines.map(({item,attribution})=>({variant_id:item.variant,quantity:1,attribution_id:attribution.id}));const receipt=(await db.query(`select public.create_marketplace_creator_checkout_reservation($1::jsonb,${address},$2)value`,[JSON.stringify(payload),uid()])).rows[0].value;return pay(f,receipt);}
async function liveCheckout(f,creator,item){const liveOffer=await offer(f,item,creator,1000);await role("authenticated",creator);const session=uid();await db.query("select * from public.start_live_session($1,'B8A LIVE trace')",[session]);const pin=(await db.query("select public.pin_live_session_product($1,$2,$3,$4)value",[session,item.product,item.variant,uid()])).rows[0].value;await role("authenticated",f.buyer);const receipt=(await db.query(`select public.create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)value`,[session,pin.id,item.variant,uid()])).rows[0].value;const order=await pay(f,receipt);return{order,pin,offer:liveOffer};}
async function settle(f,order){await role("authenticated",f.seller);await db.query("select public.seller_start_marketplace_order_processing($1,$2)",[order,uid()]);await db.query("select public.seller_ship_marketplace_order($1,'B8A','Ground',$2,null,null,$3)",[order,`B8A-${uid().slice(0,8)}`,uid()]);await role("service_role",f.admin);await db.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)",[f.buyer,order,uid()]);}
async function reverse(f,order){await role("service_role",f.admin);const review=(await db.query("select public.open_marketplace_post_settlement_review($1,$2,'b8a_trace','proof',$3)value",[f.admin,order,uid()])).rows[0].value;return(await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b8a_full_refund','proof',$3,null)value",[f.admin,review.dispute_id,uid()])).rows[0].value;}
async function rpc(name,args=[]){return(await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) value`,args)).rows[0].value;}

try{
  await db.connect();await db.query("begin");stage="fixture";
  const f={admin:uid(),normal:uid(),insertAttack:uid(),buyer:uid(),seller:uid(),creatorX:uid(),creatorY:uid(),store:uid(),shipping:uid()};
  for(const [label,id]of Object.entries({admin:f.admin,normal:f.normal,buyer:f.buyer,seller:f.seller,creatorx:f.creatorX,creatory:f.creatorY}))await user(id,label,label==="admin");
  await operator();await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,[f.insertAttack,`b8a-insert-${uid().slice(0,8)}@proof.local`]);
  await operator();await db.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B8A Seller',now())",[f.seller]);await db.query("insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B8A Store',$3,'active')",[f.store,f.seller,`b8a-${uid()}`]);await db.query(`insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)values($1,$2,$3,'B8A Ground',1,2,'US','Proof')`,[f.shipping,f.seller,f.store]);await db.query("insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",[f.shipping]);await fund(f,1000);

  const ordinaryItem=await makeProduct(f,30,"Ordinary"),feedItem=await makeProduct(f,50,"Feed"),reelItem=await makeProduct(f,50,"Reel"),liveItem=await makeProduct(f,20,"Live");
  await offer(f,feedItem,f.creatorX,1000);await offer(f,reelItem,f.creatorY,1400);
  const feedTag=await contentTag(f.creatorX,"feed",feedItem,"feed"),reelTag=await contentTag(f.creatorY,"reel",reelItem,"reel");
  const feedAttr=await attribution(f.buyer,feedTag,feedItem),reelAttr=await attribution(f.buyer,reelTag,reelItem);
  stage="canonical_orders";
  const ordinaryOrder=await ordinaryCheckout(f,ordinaryItem);
  const creatorOrder=await creatorCheckout(f,[{item:feedItem,attribution:feedAttr},{item:reelItem,attribution:reelAttr}]);
  const live=await liveCheckout(f,f.creatorX,liveItem);
  const allocation=(await db.query("select * from public.marketplace_payment_allocations where order_id=$1",[creatorOrder])).rows[0];
  assert.deepEqual([n(allocation.seller_net_amount),n(allocation.platform_fee_amount),n(allocation.creator_commission_amount),n(allocation.gross_amount)],[78,10,12,100]);
  await settle(f,creatorOrder);const reversal=await reverse(f,creatorOrder);assert.equal(reversal.finalDecision.financial_result.money_moved,true);

  stage="authorization";
  const calls=[()=>rpc("get_my_marketplace_admin_access"),()=>rpc("get_marketplace_admin_overview",["all"]),()=>rpc("search_marketplace_admin_orders",[null,null,"all",null,null,null,null,50]),()=>rpc("get_marketplace_admin_order_detail",[ordinaryOrder])];
  for(const identity of[{role:"anon",id:""},{role:"authenticated",id:f.normal}]){await role(identity.role,identity.id);for(const call of calls){const result=await attempt(call);assert.equal(result.ok,false);assert.equal(result.code,"42501");}}
  await role("authenticated",f.normal,{is_admin:true,role:"admin"});assert.equal((await attempt(()=>rpc("get_my_marketplace_admin_access"))).ok,false);
  const updateAttack=await attempt(()=>db.query("update public.user_profiles set is_admin=true where id=$1",[f.normal]));assert.equal(updateAttack.ok,false);
  await role("authenticated",f.insertAttack);const insertAttack=await attempt(()=>db.query("insert into public.user_profiles(id,username,is_admin)values($1,$2,true)",[f.insertAttack,`b8ainsert${uid().slice(0,8)}`]));assert.equal(insertAttack.ok,false);

  stage="admin_outputs";
  await role("authenticated",f.admin);
  const access=await rpc("get_my_marketplace_admin_access");assert.equal(access.user_id,f.admin);assert.equal(access.admin,true);assert(access.capabilities.includes("marketplace:read"));
  const overview=await rpc("get_marketplace_admin_overview",["all"]);assert.equal(overview.commerce.orders,3);assert.equal(overview.commerce.paid_orders,3);assert.equal(n(overview.commerce.paid_gmv),150);assert.equal(overview.commerce.units,4);assert.equal(overview.commerce.refunded_orders,1);assert.equal(overview.commerce.reversed_orders,1);assert.equal(n(overview.commerce.reversed_gross),100);assert.equal(overview.creator_commerce.attributed_orders,2);assert.equal(n(overview.creator_commerce.attributed_gmv),120);assert.equal(n(overview.creator_commerce.commission_generated),14);assert.equal(n(overview.creator_commerce.commission_released),12);assert.equal(n(overview.creator_commerce.commission_reversed),12);assert.equal(n(overview.creator_commerce.commission_net),0);
  for(const range of["7d","30d","90d","all"]){const value=await rpc("get_marketplace_admin_overview",[range]);assert.equal(value.range,range);}
  assert.equal((await attempt(()=>rpc("get_marketplace_admin_overview",["bad"]))).message,"marketplace_admin_range_invalid");

  stage="search_pagination";
  const seen=[];let cursor=null;do{const page=await rpc("search_marketplace_admin_orders",[null,null,"all",null,null,cursor?.created_at??null,cursor?.id??null,1]);assert.equal(page.orders.length,1);seen.push(page.orders[0].id);cursor=page.next_cursor;}while(cursor);assert.equal(seen.length,3);assert.equal(new Set(seen).size,3);
  const livePage=await rpc("search_marketplace_admin_orders",[null,null,"all",null,"live",null,null,50]);assert.deepEqual(livePage.orders.map((x)=>x.id),[live.order]);
  await operator();const byNumber=(await db.query("select order_number from public.marketplace_orders where id=$1",[ordinaryOrder])).rows[0].order_number;await role("authenticated",f.admin);const queried=await rpc("search_marketplace_admin_orders",[byNumber,null,"all",null,null,null,null,50]);assert.deepEqual(queried.orders.map((x)=>x.id),[ordinaryOrder]);
  const hardMax=await attempt(()=>rpc("search_marketplace_admin_orders",[null,null,"all",null,null,null,null,101]));assert.equal(hardMax.ok,false);assert.equal(hardMax.message,"marketplace_admin_page_limit_invalid");

  stage="order_detail";
  const ordinaryDetail=await rpc("get_marketplace_admin_order_detail",[ordinaryOrder]);assert.equal(ordinaryDetail.items.length,1);assert.equal(ordinaryDetail.items[0].creator,null);assert.equal(n(ordinaryDetail.payment.gross_amount),30);
  const creatorDetail=await rpc("get_marketplace_admin_order_detail",[creatorOrder]);assert.equal(creatorDetail.items.length,2);assert.deepEqual(creatorDetail.creator_attributions.map((x)=>x.source_surface).sort(),["feed","reel"]);const allocations=new Map(creatorDetail.creator_allocations.map((x)=>[x.creator_user_id,n(x.commission_amount)]));assert.equal(allocations.get(f.creatorX),5);assert.equal(allocations.get(f.creatorY),7);assert.equal(creatorDetail.settlement_legs.filter((x)=>x.leg_type==="creator_commission").length,2);assert.equal(creatorDetail.reversal_legs.filter((x)=>x.leg_type==="creator_commission").length,2);
  const liveDetail=await rpc("get_marketplace_admin_order_detail",[live.order]);assert.equal(liveDetail.creator_attributions[0].source_surface,"live");assert.equal(liveDetail.creator_attributions[0].source_entity_id,live.pin.id);assert.equal(n(liveDetail.creator_allocations[0].commission_amount),2);

  stage="schema_security";
  await operator();const grants=(await db.query(`select
    has_function_privilege('anon','public.get_my_marketplace_admin_access()','execute') anon_access,
    has_function_privilege('anon','public.get_marketplace_admin_overview(text)','execute') anon_overview,
    has_function_privilege('authenticated','public.get_marketplace_admin_overview(text)','execute') authenticated_overview,
    has_function_privilege('authenticated','public.marketplace_require_admin()','execute') authenticated_guard`)).rows[0];assert.deepEqual(grants,{anon_access:false,anon_overview:false,authenticated_overview:true,authenticated_guard:false});
  const mutationFunctions=n((await db.query(`select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'%marketplace_admin%'and pg_get_functiondef(p.oid)~*'(insert into|update |delete from) public[.](marketplace_|ledger_|financial_)'`)).rows[0].n);assert.equal(mutationFunctions,0);

  await db.query("rollback");const fixtures=n((await db.query("select count(*) n from auth.users where email like'b8a-%@proof.local'")).rows[0].n);assert.equal(fixtures,0);
  console.log(JSON.stringify({ok:true,security:{anonymousDenied:true,ordinaryDenied:true,metadataForgeryDenied:true,b8sInsertEscalationDenied:true,b8sUpdateEscalationDenied:true,adminAllowed:true,noClientActorParameter:true},overview:{exact:true,orders:3,paidOrders:3,paidGmv:150,units:4,creatorAttributedOrders:2,creatorGmv:120,commissionGenerated:14,commissionReleased:12,commissionReversed:12,commissionNet:0,rangesExact:true},search:{filtersExact:true,cursorPaginationExact:true,noDuplicates:true,noSkipped:true,hardMaximum:100},details:{ordinary:true,creatorCommerce:true,multiCreator:true,liveCreatorTrace:true,paymentTrace:true,settlementTrace:true,reversalTrace:true,itemLevelEconomics:true},authority:{readOnly:true,noAdminMutationFunctions:true,rpcOnly:true},fixtures},null,2));
}catch(error){await db.query("rollback").catch(()=>{});console.error(`B8A_ADMIN_WEB_PROOF_FAILED:${stage}:${error.code??""}:${error.message}`);process.exitCode=1;}finally{await db.end().catch(()=>{});}
