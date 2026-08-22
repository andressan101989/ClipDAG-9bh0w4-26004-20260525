import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const {Client}=pg,connectionString=process.env.MARKETPLACE_DATABASE_URL;
if(!connectionString)throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed=new URL(connectionString);
if(!["127.0.0.1","localhost"].includes(parsed.hostname)||parsed.port!=="55422")throw new Error("B8B_PROOF_REQUIRES_DISPOSABLE_DATABASE");
let db=new Client({connectionString,ssl:false});const uid=()=>randomUUID(),num=(value)=>Number(value);let stage="connect";
async function role(name,sub="",metadata={}){await db.query("reset role");await db.query(`set local role ${name}`);await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)",[name,sub,JSON.stringify({role:name,sub,user_metadata:metadata,app_metadata:metadata})]);}
async function operator(){await db.query("reset role");await db.query("select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true)");}
async function attempt(action){const savepoint=`b8b_${uid().replaceAll("-","")}`;await db.query(`savepoint ${savepoint}`);try{const result=await action();await db.query(`release savepoint ${savepoint}`);return{ok:true,result}}catch(error){await db.query(`rollback to savepoint ${savepoint}`);await db.query(`release savepoint ${savepoint}`);return{ok:false,code:error.code,message:error.message}}}
async function user(id,label,admin=false){await operator();const token=uid().replaceAll("-","").slice(0,10);await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,[id,`b8b-${label}-${token}@proof.local`]);await db.query("insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",[id,`b8b${label}${token}`,`B8B ${label}`,admin]);}
async function rpc(name,args=[]){return(await db.query(`select public.${name}(${args.map((_,index)=>`$${index+1}`).join(",")})value`,args)).rows[0].value;}
const settlementObservationKeys=new Set(["escrow_expected_held_total","escrow_actual_balance"]);
function assertSettlementReconciliationZero(value,label){for(const[key,nested]of Object.entries(value)){if(settlementObservationKeys.has(key))continue;assert.equal(num(nested),0,`${label}:${key}:${nested}`)}assert.equal(num(value.escrow_difference),0,`${label}:escrow_difference`)}
async function settlementActorState(order){return(await db.query(`select s.release_actor_role,s.release_actor_id,s.confirmed_by,o.status order_status,sh.status shipment_status,o.delivered_at order_delivered_at,sh.delivered_at shipment_delivered_at,(select count(*)::int from public.marketplace_settlement_legs l join public.financial_transactions f on f.id=l.financial_transaction_id where l.settlement_id=s.id and l.amount>0 and f.initiated_by=s.release_actor_id) actor_transactions,(select count(*)::int from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.amount>0) positive_legs from public.marketplace_order_settlements s join public.marketplace_orders o on o.id=s.order_id left join public.marketplace_order_shipments sh on sh.order_id=o.id where s.order_id=$1`,[order])).rows[0]}
async function assertCorruptionDetected(label,table,mutation,args,key){await db.query(`savepoint ${label}`);try{await db.query(`alter table public.${table} disable trigger user`);await db.query(mutation,args);const value=await rpc("reconcile_marketplace_settlements");assert(num(value[key])>0,`${label}:${key}_not_detected`)}finally{await db.query(`rollback to savepoint ${label}`)}}
async function createProduct(f,label,moderation="approved",status="active",price=10){await operator();const product=uid(),variant=uid(),sku=`B8B-${uid().replaceAll("-","").toUpperCase()}`;await db.query(`insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id,images)values($1,$2,$3,'B8B rollback proof',$4,'BDAG','physical',20,$5,$6,'10000000-0000-4000-8000-000000000002','physical',$7,case when $5='active'then now()else null end,$8,$9)`,[product,f.seller,`B8B ${label}`,price,status,f.store,moderation,f.shipping,[`https://proof.local/${label}.jpg`]]);await db.query(`insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,[variant,product,f.store,f.seller,sku,price]);await db.query("insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,20,0)",[variant]);return{product,variant,price}}
async function fund(f,amount){await role("service_role",f.admin);const platform=(await db.query("select public.ensure_marketplace_platform_account()id")).rows[0].id,buyer=(await db.query("select public.ensure_ledger_account($1)id",[f.buyer])).rows[0].id,tx=uid();await db.query(`insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b8b_proof',$5,$6,$7)`,[tx,platform,buyer,amount,f.store,`b8b-fund:${tx}`,f.buyer]);await db.query("select public.ledger_debit($1,$2,$3,'B8B proof','{}'),public.ledger_credit($1,$4,$3,'B8B proof','{}')",[tx,platform,amount,buyer]);return buyer}
async function disputedCheckout(f,item,label){await role("authenticated",f.buyer);const reservation=(await db.query("select public.create_marketplace_checkout_reservation($1::jsonb,$2::jsonb,$3)value",[JSON.stringify([{variant_id:item.variant,quantity:1}]),JSON.stringify({recipient_name:"B8B Proof",line1:"Proof Street",city:"New York",region:"NY",postal_code:"10001",country:"US"}),uid()])).rows[0].value;await role("service_role",f.admin);await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",[f.buyer,reservation.checkout.id,uid()]);const order=reservation.orders[0].id;await role("authenticated",f.seller);await db.query("select public.seller_start_marketplace_order_processing($1,$2)",[order,uid()]);await db.query("select public.seller_ship_marketplace_order($1,'B8B','Ground',$2,null,null,$3)",[order,`B8B-${label}`,uid()]);await role("authenticated",f.buyer);await rpc("report_marketplace_order_problem",[order,"not_received","B8B operations proof",uid()]);await operator();const dispute=(await db.query("select id from public.marketplace_order_disputes where order_id=$1",[order])).rows[0].id;return{order,dispute}}
async function settledPostSettlementDispute(f,item,label){await role("authenticated",f.buyer);const reservation=(await db.query("select public.create_marketplace_checkout_reservation($1::jsonb,$2::jsonb,$3)value",[JSON.stringify([{variant_id:item.variant,quantity:1}]),JSON.stringify({recipient_name:"B8B Proof",line1:"Proof Street",city:"New York",region:"NY",postal_code:"10001",country:"US"}),uid()])).rows[0].value;await role("service_role",f.admin);await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",[f.buyer,reservation.checkout.id,uid()]);const order=reservation.orders[0].id;await role("authenticated",f.seller);await db.query("select public.seller_start_marketplace_order_processing($1,$2)",[order,uid()]);await db.query("select public.seller_ship_marketplace_order($1,'B8B','Ground',$2,null,null,$3)",[order,`B8B-${label}`,uid()]);await role("service_role",f.admin);await db.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)",[f.buyer,order,uid()]);const review=await rpc("open_marketplace_post_settlement_review",[f.admin,order,"post_settlement_release_check","B8B already-released receipt proof",uid()]);const settlement=(await db.query("select id from public.marketplace_order_settlements where order_id=$1",[order])).rows[0].id;return{order,dispute:review.dispute_id,settlement}}

try{
 await db.connect();await db.query("begin");const f={admin:uid(),normal:uid(),buyer:uid(),seller:uid(),pendingSeller:uid(),rejectedSeller:uid(),reasonSeller:uid(),overSeller:uid(),selfSeller:uid(),store:uid(),shipping:uid()};stage="fixtures";
 for(const[label,id]of Object.entries({admin:f.admin,normal:f.normal,buyer:f.buyer,seller:f.seller,pending:f.pendingSeller,rejected:f.rejectedSeller,reasonSeller:f.reasonSeller,overSeller:f.overSeller,self:f.selfSeller}))await user(id,label,label==="admin");
 await operator();await db.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B8B Seller',now()),($2,'pending','B8B Pending',null),($3,'pending','B8B Reject',null),($4,'pending','B8B Self',null),($5,'pending','B8B Reason Boundary',null),($6,'pending','B8B Reason Over',null)",[f.seller,f.pendingSeller,f.rejectedSeller,f.admin,f.reasonSeller,f.overSeller]);await db.query("insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B8B Store',$3,'active')",[f.store,f.seller,`b8b-${uid()}`]);await db.query(`insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)values($1,$2,$3,'B8B Ground',1,2,'US','Proof')`,[f.shipping,f.seller,f.store]);await db.query("insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",[f.shipping]);const paidProduct=await createProduct(f,"Paid"),pendingProduct=await createProduct(f,"Pending","pending","paused"),rejectProduct=await createProduct(f,"Reject","pending","active"),reasonProduct=await createProduct(f,"ReasonBoundary","pending","paused"),overProduct=await createProduct(f,"ReasonOver","pending","paused");const buyerAccount=await fund(f,100);

 stage="security";const readCalls=[()=>rpc("search_marketplace_admin_disputes",[null,null,null,null,50]),()=>rpc("search_marketplace_admin_sellers",[null,null,null,null,50]),()=>rpc("search_marketplace_admin_products",[null,null,null,null,null,null,null,50])],writeCalls=[()=>rpc("admin_moderate_marketplace_seller",[f.pendingSeller,"approve",null,uid()]),()=>rpc("admin_moderate_marketplace_product",[pendingProduct.product,"approve",null,uid()])];for(const identity of[{name:"anon",sub:""},{name:"authenticated",sub:f.normal},{name:"authenticated",sub:f.normal,metadata:{is_admin:true,role:"admin"}}]){await role(identity.name,identity.sub,identity.metadata);for(const call of[...readCalls,...writeCalls]){const result=await attempt(call);assert.equal(result.ok,false);assert.equal(result.code,"42501")}}
 const escalation=await attempt(()=>db.query("update public.user_profiles set is_admin=true where id=$1",[f.normal]));assert.equal(escalation.ok,false);

 stage="capabilities";await role("authenticated",f.admin);const access=await rpc("get_my_marketplace_admin_access");for(const capability of["marketplace:read","marketplace:disputes","marketplace:sellers","marketplace:products"])assert(access.capabilities.includes(capability));
 stage="null_safe_limits";
 const limitCases=[
  {name:"search_marketplace_admin_disputes",args:(limit)=>[null,null,null,null,limit]},
  {name:"search_marketplace_admin_sellers",args:(limit)=>[null,null,null,null,limit]},
 {name:"search_marketplace_admin_products",args:(limit)=>[null,null,null,null,null,null,null,limit]},
 ];
 for(const item of limitCases){
  const omitted=await rpc(item.name),explicitDefault=await rpc(item.name,item.args(50));assert.deepEqual(omitted,explicitDefault);
  for(const boundary of[1,100]){const result=await rpc(item.name,item.args(boundary));assert(result.page_size<=boundary)}
  for(const invalidLimit of[null,0,101]){const result=await attempt(()=>rpc(item.name,item.args(invalidLimit)));assert.equal(result.ok,false);assert.equal(result.code,"22023")}
 }
 stage="seller";const approveKey=uid(),approved=await rpc("admin_moderate_marketplace_seller",[f.pendingSeller,"approve",null,approveKey]),approvedRetry=await rpc("admin_moderate_marketplace_seller",[f.pendingSeller,"approve",null,approveKey]);assert.deepEqual(approvedRetry,approved);assert.equal(approved.status,"approved");await rpc("admin_moderate_marketplace_seller",[f.rejectedSeller,"reject","application_incomplete",uid()]);const suspendKey=uid(),suspended=await rpc("admin_moderate_marketplace_seller",[f.seller,"suspend","risk_review",suspendKey]);assert.equal(suspended.status,"suspended");assert.equal(suspended.store_status,"active");const publicAfterSuspend=await operator().then(()=>db.query("select count(*)::int n from public.products p where p.id=$1 and p.status='active'and p.moderation_status='approved'and exists(select 1 from public.marketplace_sellers s where s.user_id=p.seller_id and s.status='approved')",[paidProduct.product]));assert.equal(publicAfterSuspend.rows[0].n,0);await role("authenticated",f.admin);const restored=await rpc("admin_moderate_marketplace_seller",[f.seller,"restore",null,uid()]);assert.equal(restored.status,"approved");assert.equal(restored.store_status,"active");const selfModeration=await attempt(()=>rpc("admin_moderate_marketplace_seller",[f.admin,"approve",null,uid()]));assert.equal(selfModeration.ok,false);

 stage="product";const productKey=uid(),productApproved=await rpc("admin_moderate_marketplace_product",[pendingProduct.product,"approve",null,productKey]),productRetry=await rpc("admin_moderate_marketplace_product",[pendingProduct.product,"approve",null,productKey]);assert.deepEqual(productRetry,productApproved);assert.equal(productApproved.moderation_status,"approved");const rejected=await rpc("admin_moderate_marketplace_product",[rejectProduct.product,"reject","prohibited_claim",uid()]);assert.equal(rejected.moderation_status,"rejected");assert.equal(rejected.publication_status,"paused");const historicalSnapshot=(await operator().then(()=>db.query("select price,stock from public.products where id=$1",[rejectProduct.product]))).rows[0];assert.equal(num(historicalSnapshot.price),rejectProduct.price);assert.equal(historicalSnapshot.stock,20);

 stage="reason_contract";const reason500="s".repeat(500),reason501="x".repeat(501),reason100="d".repeat(100),reason101="z".repeat(101);await role("authenticated",f.admin);
 const sellerBoundary=await rpc("admin_moderate_marketplace_seller",[f.reasonSeller,"reject",reason500,uid()]);assert.equal(sellerBoundary.status,"rejected");const sellerOver=await attempt(()=>rpc("admin_moderate_marketplace_seller",[f.overSeller,"reject",reason501,uid()]));assert.equal(sellerOver.ok,false);assert.equal(sellerOver.code,"22023");
 const productBoundary=await rpc("admin_moderate_marketplace_product",[reasonProduct.product,"reject",reason500,uid()]);assert.equal(productBoundary.moderation_status,"rejected");const productOver=await attempt(()=>rpc("admin_moderate_marketplace_product",[overProduct.product,"reject",reason501,uid()]));assert.equal(productOver.ok,false);assert.equal(productOver.code,"22023");
 await operator();let overState=(await db.query("select (select status from public.marketplace_sellers where user_id=$1)seller_status,(select moderation_status from public.products where id=$2)product_status,(select count(*)::int from public.marketplace_admin_action_audit where target_id in($1,$2))audit_rows",[f.overSeller,overProduct.product])).rows[0];assert.deepEqual(overState,{seller_status:"pending",product_status:"pending",audit_rows:0});
 const disputeBoundaryFixture=await disputedCheckout(f,paidProduct,"REASON100");await role("authenticated",f.admin);const disputeBoundary=await rpc("admin_resolve_marketplace_dispute",[disputeBoundaryFixture.dispute,"manual_review",reason100,"Boundary accepted",uid()]);assert.equal(disputeBoundary.kind,"intermediate_review");
 const disputeOverFixture=await disputedCheckout(f,paidProduct,"REASON101");await operator();const financialBeforeReasonRejection=num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n);await role("authenticated",f.admin);const disputeOver=await attempt(()=>rpc("admin_resolve_marketplace_dispute",[disputeOverFixture.dispute,"manual_review",reason101,"Must reject",uid()]));assert.equal(disputeOver.ok,false);assert.equal(disputeOver.code,"22023");await operator();overState=(await db.query("select d.status,(select count(*)::int from public.marketplace_dispute_review_actions where dispute_id=d.id)review_rows,(select count(*)::int from public.marketplace_dispute_decisions where dispute_id=d.id)decision_rows,(select count(*)::int from public.marketplace_admin_action_audit where target_type='dispute'and target_id=d.id)audit_rows from public.marketplace_order_disputes d where d.id=$1",[disputeOverFixture.dispute])).rows[0];assert.deepEqual(overState,{status:"open",review_rows:0,decision_rows:0,audit_rows:0});assert.equal(num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n),financialBeforeReasonRejection);

 stage="dispute_refund";const refundFixture=await disputedCheckout(f,paidProduct,"REFUND"),refundKey=uid();
 await role("anon");const anonResolution=await attempt(()=>rpc("admin_resolve_marketplace_dispute",[refundFixture.dispute,"refund_buyer","support_refund","Denied",refundKey]));assert.equal(anonResolution.ok,false);assert.equal(anonResolution.code,"42501");
 await role("authenticated",f.normal);const ordinaryResolution=await attempt(()=>rpc("admin_resolve_marketplace_dispute",[refundFixture.dispute,"refund_buyer","support_refund","Denied",refundKey]));assert.equal(ordinaryResolution.ok,false);assert.equal(ordinaryResolution.code,"42501");
 await db.query("reset role");await db.query("set local role service_role");await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[f.admin,JSON.stringify({role:"authenticated",sub:f.admin})]);const directCore=await attempt(()=>rpc("resolve_marketplace_dispute",[f.admin,refundFixture.dispute,"refund_buyer","support_refund","Direct core denied",refundKey,null]));assert.equal(directCore.ok,false);assert.equal(directCore.code,"42501");assert.match(directCore.message,/marketplace_dispute_resolution_auth_required/);
 const before=num((await operator().then(()=>db.query("select balance from public.ledger_accounts where id=$1",[buyerAccount]))).rows[0].balance);await role("authenticated",f.admin);const refund=await rpc("admin_resolve_marketplace_dispute",[refundFixture.dispute,"refund_buyer","support_refund","Canonical full refund",refundKey]),refundRetry=await rpc("admin_resolve_marketplace_dispute",[refundFixture.dispute,"refund_buyer","support_refund","Canonical full refund",refundKey]);assert.deepEqual(refundRetry,refund);assert.equal(refund.finalDecision.outcome,"refund_buyer");const canonicalLookup=await rpc("get_my_marketplace_admin_dispute_resolution_result",[refundFixture.dispute,refundKey]);assert.equal(canonicalLookup.committed,true);assert.equal(canonicalLookup.action,"dispute_refund_buyer");assert.equal(canonicalLookup.target_id,refundFixture.dispute);assert.equal(canonicalLookup.idempotency_key,refundKey);await operator();const after=num((await db.query("select balance from public.ledger_accounts where id=$1",[buyerAccount])).rows[0].balance),transfers=num((await db.query("select count(*) n from public.financial_transactions where operation_type='marketplace_dispute_refund'and reference_id=$1",[refundFixture.order])).rows[0].n);assert.equal(after-before,num(refund.payment.gross_amount));assert.equal(transfers,1);
 stage="review_release";const releaseFixture=await disputedCheckout(f,paidProduct,"RELEASE");await operator();const reviewTransactions=num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n);await role("authenticated",f.admin);const review=await rpc("admin_resolve_marketplace_dispute",[releaseFixture.dispute,"manual_review","needs_review","Investigate",uid()]);assert.equal(review.finalDecision,null);assert.equal(review.dispute.status,"under_review");await operator();assert.equal(num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n),reviewTransactions);await role("authenticated",f.admin);const release=await rpc("admin_resolve_marketplace_dispute",[releaseFixture.dispute,"release_seller","release_approved","Release canonical allocation",uid()]);assert.equal(release.finalDecision.outcome,"release_seller");const conflict=await attempt(()=>rpc("admin_resolve_marketplace_dispute",[releaseFixture.dispute,"refund_buyer","late_conflict","Conflicting final",uid()]));assert.equal(conflict.ok,false);assert.match(conflict.message,/conflicting_decision/);await operator();const activeAdminSettlementState=await settlementActorState(releaseFixture.order);assert.equal(activeAdminSettlementState.release_actor_role,"admin");assert.equal(activeAdminSettlementState.release_actor_id,f.admin);assert.equal(activeAdminSettlementState.confirmed_by,null);assert.equal(activeAdminSettlementState.order_status,"shipped");assert.equal(activeAdminSettlementState.shipment_status,"shipped");assert.equal(activeAdminSettlementState.actor_transactions,activeAdminSettlementState.positive_legs);
 stage="post_settlement_release";const postSettlementFixture=await settledPostSettlementDispute(f,paidProduct,"ALREADYRELEASED");await operator();const postSettlementBefore=(await db.query("select(select count(*)::int from public.marketplace_order_settlements where order_id=$1)settlements,(select count(*)::int from public.financial_transactions where reference_id=$1::text)financial_movements",[postSettlementFixture.order])).rows[0];assert.equal(postSettlementBefore.settlements,1);await role("authenticated",f.admin);const postSettlementRelease=await rpc("admin_resolve_marketplace_dispute",[postSettlementFixture.dispute,"release_seller","already_released_confirmed","Confirm existing canonical release",uid()]);assert.equal(postSettlementRelease.finalDecision.outcome,"release_seller");assert.equal(postSettlementRelease.finalDecision.financial_result.money_moved,true);const alreadyReleased=postSettlementRelease.finalDecision.financial_result.settlement;assert.equal(alreadyReleased.settlement.id,postSettlementFixture.settlement);assert.equal(alreadyReleased.money_moved,false);assert.equal(alreadyReleased.already_released,true);assert.equal("allocation"in alreadyReleased,false);assert.equal("actor_role"in alreadyReleased,false);await operator();const postSettlementAfter=(await db.query("select(select count(*)::int from public.marketplace_order_settlements where order_id=$1)settlements,(select count(*)::int from public.financial_transactions where reference_id=$1::text)financial_movements,(select count(*)::int from public.marketplace_dispute_decisions where dispute_id=$2)decisions,(select count(*)::int from public.marketplace_admin_action_audit where target_type='dispute'and target_id=$2)audit_rows",[postSettlementFixture.order,postSettlementFixture.dispute])).rows[0];assert.equal(postSettlementAfter.settlements,1);assert.equal(postSettlementAfter.financial_movements,postSettlementBefore.financial_movements);assert.equal(postSettlementAfter.decisions,1);assert.equal(postSettlementAfter.audit_rows,1);const buyerSettlementState=await settlementActorState(postSettlementFixture.order);assert.equal(buyerSettlementState.release_actor_role,"buyer");assert.equal(buyerSettlementState.release_actor_id,f.buyer);assert.equal(buyerSettlementState.confirmed_by,f.buyer);assert.equal(buyerSettlementState.order_status,"delivered");assert.equal(buyerSettlementState.shipment_status,"delivered");assert.equal(new Date(buyerSettlementState.order_delivered_at).toISOString(),new Date(buyerSettlementState.shipment_delivered_at).toISOString());assert.equal(buyerSettlementState.actor_transactions,buyerSettlementState.positive_legs);
 stage="reject";const rejectFixture=await disputedCheckout(f,paidProduct,"REJECT");await operator();const ledgerBefore=num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n);await role("authenticated",f.admin);const claimRejected=await rpc("admin_resolve_marketplace_dispute",[rejectFixture.dispute,"reject_claim","claim_unsubstantiated","No financial movement",uid()]);assert.equal(claimRejected.finalDecision.financial_result.money_moved,false);await operator();assert.equal(num((await db.query("select count(*) n from public.financial_transactions")).rows[0].n),ledgerBefore);
 stage="post_reject_release";const rejectedBefore=(await db.query("select d.status,dec.id decision_id,dec.outcome,(select count(*)::int from public.marketplace_dispute_decisions where dispute_id=d.id) decisions,(select count(*)::int from public.marketplace_order_settlements where order_id=d.order_id) settlements from public.marketplace_order_disputes d join public.marketplace_dispute_decisions dec on dec.dispute_id=d.id where d.id=$1",[rejectFixture.dispute])).rows[0];assert.equal(rejectedBefore.status,"rejected");assert.equal(rejectedBefore.outcome,"reject_claim");assert.equal(rejectedBefore.decisions,1);assert.equal(rejectedBefore.settlements,0);const postRejectKey=uid();await role("authenticated",f.admin);const postRejectRelease=await rpc("admin_resolve_marketplace_dispute",[rejectFixture.dispute,"release_seller","release_pending","Release after rejected claim",postRejectKey]);const postRejectRetry=await rpc("admin_resolve_marketplace_dispute",[rejectFixture.dispute,"release_seller","release_pending","Release after rejected claim",postRejectKey]);assert.deepEqual(postRejectRetry,postRejectRelease);assert.equal(postRejectRelease.kind,"post_reject_release");assert.equal(postRejectRelease.money_moved,true);assert.equal(postRejectRelease.already_released,false);assert.equal(postRejectRelease.prior_decision_id,rejectedBefore.decision_id);assert.equal(postRejectRelease.prior_outcome,"reject_claim");const postRejectLookup=await rpc("get_my_marketplace_admin_dispute_resolution_result",[rejectFixture.dispute,postRejectKey]);assert.equal(postRejectLookup.committed,true);assert.equal(postRejectLookup.result_kind,"post_reject_release");assert.equal(postRejectLookup.canonical_id,postRejectRelease.settlement.id);assert.equal(postRejectLookup.money_moved,true);const postRejectAlready=await rpc("admin_resolve_marketplace_dispute",[rejectFixture.dispute,"release_seller","release_after_schedule","Confirm existing release",uid()]);assert.equal(postRejectAlready.settlement.id,postRejectRelease.settlement.id);assert.equal(postRejectAlready.money_moved,false);assert.equal(postRejectAlready.already_released,true);await operator();const postRejectState=(await db.query("select d.status,dec.id decision_id,dec.outcome,(select count(*)::int from public.marketplace_dispute_decisions where dispute_id=d.id) decisions,(select count(*)::int from public.marketplace_order_settlements where order_id=d.order_id) settlements,a.status allocation_status,(select count(*)::int from public.marketplace_settlement_legs l join public.marketplace_order_settlements s on s.id=l.settlement_id where s.order_id=d.order_id and l.leg_type='seller_net') seller_legs,(select count(*)::int from public.marketplace_settlement_legs l join public.marketplace_order_settlements s on s.id=l.settlement_id where s.order_id=d.order_id and l.leg_type='platform_fee') platform_legs,(select count(*)::int from public.marketplace_settlement_legs l join public.marketplace_order_settlements s on s.id=l.settlement_id where s.order_id=d.order_id and l.leg_type='creator_commission') creator_legs from public.marketplace_order_disputes d join public.marketplace_dispute_decisions dec on dec.dispute_id=d.id join public.marketplace_payment_allocations a on a.order_id=d.order_id where d.id=$1",[rejectFixture.dispute])).rows[0];assert.equal(postRejectState.status,"rejected");assert.equal(postRejectState.decision_id,rejectedBefore.decision_id);assert.equal(postRejectState.outcome,"reject_claim");assert.equal(postRejectState.decisions,1);assert.equal(postRejectState.settlements,1);assert.equal(postRejectState.allocation_status,"released");assert.equal(postRejectState.seller_legs,1);assert.equal(postRejectState.platform_legs,1);assert.equal(postRejectState.creator_legs,0);const postRejectAdminSettlementState=await settlementActorState(rejectFixture.order);assert.equal(postRejectAdminSettlementState.release_actor_role,"admin");assert.equal(postRejectAdminSettlementState.release_actor_id,f.admin);assert.equal(postRejectAdminSettlementState.confirmed_by,null);assert.equal(postRejectAdminSettlementState.order_status,"shipped");assert.equal(postRejectAdminSettlementState.shipment_status,"shipped");assert.equal(postRejectAdminSettlementState.actor_transactions,postRejectAdminSettlementState.positive_legs);

 stage="settlement_reconciliation";const settlementRecon=await rpc("reconcile_marketplace_settlements");assertSettlementReconciliationZero(settlementRecon,"buyer_and_admin_releases");await assertCorruptionDetected("bad_buyer_delivery","marketplace_orders","update public.marketplace_orders set status='shipped',delivered_at=null where id=$1",[postSettlementFixture.order],"released_order_not_delivered");await assertCorruptionDetected("bad_buyer_actor","financial_transactions","update public.financial_transactions set initiated_by=$1 where reference_type='marketplace_order'and reference_id=$2::text and initiated_by=$3",[f.admin,postSettlementFixture.order,f.buyer],"transaction_reference_mismatch");await assertCorruptionDetected("bad_admin_actor","financial_transactions","update public.financial_transactions set initiated_by=$1 where reference_type='marketplace_order'and reference_id=$2::text and initiated_by=$3",[f.buyer,releaseFixture.order,f.admin],"transaction_reference_mismatch");await assertCorruptionDetected("bad_admin_reference","financial_transactions","update public.financial_transactions set reference_id=$1 where reference_type='marketplace_order'and reference_id=$2::text",[uid(),rejectFixture.order],"transaction_reference_mismatch");assertSettlementReconciliationZero(await rpc("reconcile_marketplace_settlements"),"corruption_rollback");

 stage="audit";const audits=(await db.query("select actor_id,action,target_type,target_id,idempotency_key,metadata from public.marketplace_admin_action_audit order by created_at,id")).rows;assert(audits.length>=9);assert(audits.every((row)=>row.actor_id===f.admin));assert.equal(audits.filter((row)=>row.idempotency_key===refundKey).length,1);assert.equal(audits.some((row)=>JSON.stringify(row).match(/password|token|private_key/i)),false);await role("authenticated",f.admin);for(const call of[()=>db.query("insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,metadata)values($1,'seller_approve','seller',$2,$3,'{}')",[f.admin,f.seller,uid()]),()=>db.query("update public.marketplace_admin_action_audit set reason_code='forged'"),()=>db.query("delete from public.marketplace_admin_action_audit")])assert.equal((await attempt(call)).ok,false);
 await operator();const recon=await rpc("reconcile_marketplace_admin_operations");assert.equal(Object.keys(recon).length,8);assert(Object.values(recon).every((value)=>num(value)===0),JSON.stringify(recon));const grants=(await db.query(`select has_table_privilege('authenticated','public.marketplace_admin_action_audit','insert') audit_insert,has_table_privilege('authenticated','public.marketplace_admin_action_audit','update') audit_update,has_table_privilege('authenticated','public.marketplace_admin_action_audit','delete') audit_delete,has_function_privilege('anon','public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)','execute') anon_mutate`)).rows[0];assert.deepEqual(grants,{audit_insert:false,audit_update:false,audit_delete:false,anon_mutate:false});
 await db.query("rollback");const fixtures=num((await db.query("select count(*) n from auth.users where email like'b8b-%@proof.local'")).rows[0].n);assert.equal(fixtures,0);
 console.log(JSON.stringify({ok:true,security:{anonymousDenied:true,ordinaryDenied:true,metadataForgeryDenied:true,b8sEscalationDenied:true,adminAllowed:true,noClientActor:true,disputeAnonDenied:true,disputeNonAdminDenied:true,directCoreAuthContextDenied:true,serverDerivedResolver:true,canonicalResolutionReadBack:true},capabilities:access.capabilities,limits:{disputes:{default50:true,one:true,hundred:true,nullRejected22023:true,zeroRejected22023:true,oneHundredOneRejected22023:true},sellers:{default50:true,one:true,hundred:true,nullRejected22023:true,zeroRejected22023:true,oneHundredOneRejected22023:true},products:{default50:true,one:true,hundred:true,nullRejected22023:true,zeroRejected22023:true,oneHundredOneRejected22023:true}},reasonContract:{dispute100Accepted:true,dispute101Rejected:true,seller500Accepted:true,seller501Rejected:true,product500Accepted:true,product501Rejected:true,overLimitStateUnchanged:true,overLimitAuditRows:0,overLimitFinancialMovement:false},disputes:{heldRefundCanonical:true,releaseSellerCanonical:true,postSettlementReleaseCanonical:true,alreadyReleasedReceipt:true,postSettlementDecisionCount:postSettlementAfter.decisions,postSettlementSettlementCount:postSettlementAfter.settlements,postSettlementFinancialMovementCount:postSettlementAfter.financial_movements-postSettlementBefore.financial_movements,postSettlementAuditRows:postSettlementAfter.audit_rows,rejectClaimNoMoney:true,postRejectReleaseCanonical:true,postRejectDecisionUnchanged:true,postRejectSettlementCount:postRejectState.settlements,postRejectSellerLeg:postRejectState.seller_legs,postRejectPlatformLeg:postRejectState.platform_legs,postRejectCreatorLeg:postRejectState.creator_legs,postRejectSameKeyIdempotent:true,postRejectDifferentKeyNoMovement:true,postRejectReconciliationCommitted:true,manualReviewNoMoney:true,sameKeyIdempotent:true,sequentialConflictRejected:true,duplicateLedgerMovement:false,postSettlementAuthorityInherited:true,creatorAllocationsFrozen:true,multiCreatorAuthorityInherited:true},settlementReconciliation:{buyerReleaseAllZero:true,activeAdminReleaseAllZero:true,postRejectAdminReleaseAllZero:true,buyerStrictnessDetected:true,buyerWrongActorDetected:true,adminWrongActorDetected:true,invalidReferenceDetected:true,count:Object.keys(settlementRecon).length,allZero:true},sellers:{approve:true,reject:true,suspend:true,restore:true,selfModerationDenied:true,publicEligibilityProtected:true,idempotent:true},stores:{directMutation:false,sellerStatusPropagation:true},products:{approve:true,reject:true,publicEligibilityProtected:true,catalogEconomicsUnchanged:true,idempotent:true},audit:{serverWritten:true,appendOnly:true,immutable:true,actorDerived:true,idempotencySafe:true,noSecrets:true},reconciliation:{count:8,allZero:true},fixtures},null,2));
}catch(error){await db.query("rollback").catch(()=>{});console.error(`B8B_ADMIN_OPERATIONS_PROOF_FAILED:${stage}:${error.code??""}:${error.message}`);process.exitCode=1}finally{await db.end().catch(()=>{})}

async function setAuthenticatedAdmin(client, actorId) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(
    "select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [actorId, JSON.stringify({ role: "authenticated", sub: actorId })],
  );
}

async function runFinalDecision(client, actorId, disputeId, outcome, reason) {
  await setAuthenticatedAdmin(client, actorId);
  try {
    const result = await client.query(
      "select public.admin_resolve_marketplace_dispute($1,$2,$3,$4,$5)value",
      [disputeId, outcome, reason, "Simultaneous B8B final-decision proof", uid()],
    );
    await client.query("commit");
    return result.rows[0].value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function proveSimultaneousConflictingFinalOutcomes() {
  const raceUrl = connectionString;
  let first;
  let second;
  let verify;
  try {
    db = new Client({ connectionString: raceUrl, ssl: false });
    await db.connect();
    await db.query("begin");
    const f = {
      admin: uid(),
      secondAdmin: uid(),
      buyer: uid(),
      seller: uid(),
      store: uid(),
      shipping: uid(),
    };
    await user(f.admin, "raceadmina", true);
    await user(f.secondAdmin, "raceadminb", true);
    await user(f.buyer, "racebuyer");
    await user(f.seller, "raceseller");
    await operator();
    await db.query(
      "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B8B Race Seller',now())",
      [f.seller],
    );
    await db.query(
      "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B8B Race Store',$3,'active')",
      [f.store, f.seller, `b8b-race-${uid()}`],
    );
    await db.query(
      "insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)values($1,$2,$3,'B8B Race Ground',1,2,'US','Proof')",
      [f.shipping, f.seller, f.store],
    );
    await db.query(
      "insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",
      [f.shipping],
    );
    const product = await createProduct(f, "Race");
    await fund(f, 100);
    const fixture = await disputedCheckout(f, product, "RACE");
    await db.query("commit");
    await db.end();

    first = new Client({ connectionString: raceUrl, ssl: false });
    second = new Client({ connectionString: raceUrl, ssl: false });
    await Promise.all([first.connect(), second.connect()]);
    const results = await Promise.allSettled([
      runFinalDecision(first, f.admin, fixture.dispute, "refund_buyer", "simultaneous_refund"),
      runFinalDecision(second, f.secondAdmin, fixture.dispute, "release_seller", "simultaneous_release"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /conflicting_decision/);

    verify = new Client({ connectionString: raceUrl, ssl: false });
    await verify.connect();
    const finalState = (
      await verify.query(
        "select (select count(*)::int from public.marketplace_dispute_decisions where dispute_id=$1::uuid) decisions,(select count(*)::int from public.marketplace_admin_action_audit where target_type='dispute'and target_id=$1::uuid) audits,(select count(*)::int from public.financial_transactions where reference_id::text=$2::text and operation_type='marketplace_dispute_refund')+(select count(*)::int from public.marketplace_order_settlements where order_id=$2::uuid) financial_operations",
        [fixture.dispute, fixture.order],
      )
    ).rows[0];
    assert.equal(finalState.decisions, 1);
    assert.equal(finalState.audits, 1);
    assert.equal(finalState.financial_operations, 1);
    const reconciliation = (await verify.query("select public.reconcile_marketplace_admin_operations() value")).rows[0].value;
    assert(Object.values(reconciliation).every((value) => num(value) === 0));
    await verify.query("truncate table auth.users cascade");
    await verify.query(
      "select public.ensure_marketplace_platform_account(),public.ensure_marketplace_escrow_account()",
    );
    await verify.query(
      "update public.ledger_accounts set balance=balance+100000 where owner_id is null and account_type='platform'and currency='BDAG'",
    );
    const fixtures = num(
      (await verify.query("select count(*) n from auth.users where email like 'b8b-%@proof.local'")).rows[0].n,
    );
    assert.equal(fixtures, 0);
    console.log(
      JSON.stringify(
        {
          simultaneousConflictingFinalOutcomes: true,
          conflictingFinalOutcomeProtected: true,
          exactlyOneWinner: true,
          exactlyOneCanonicalDecision: true,
          exactlyOneAuditRow: true,
          noPartialFinancialState: true,
          reconciliation: { count: 8, allZero: true },
          fixtures,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([
      first?.end().catch(() => {}),
      second?.end().catch(() => {}),
      verify?.end().catch(() => {}),
      db?.end().catch(() => {}),
    ]);
  }
}

if (!process.exitCode) {
  try {
    await proveSimultaneousConflictingFinalOutcomes();
  } catch (error) {
    console.error(`B8B_ADMIN_OPERATIONS_PROOF_FAILED:simultaneous_conflict:${error.code ?? ""}:${error.message}`);
    process.exitCode = 1;
  }
}
