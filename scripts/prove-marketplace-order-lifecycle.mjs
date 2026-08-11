import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const repo = process.cwd();
const projectRef = "aewwdlvbwpczqyvkwvvj";
const fail = code => { throw new Error(code); };
const assert = (condition, code) => { if (!condition) fail(code); };
const reconciliationIsZero = (value, excluded=[]) => Object.entries(value??{}).every(([key,item]) => excluded.includes(key) || typeof item !== "number" || item === 0);
const safeError = error => JSON.stringify({code:error?.code,message:error?.message,detail:error?.detail,hint:error?.hint,where:error?.where,schema:error?.schema,table:error?.table,constraint:error?.constraint});
function linkedConfiguration() {
  if(process.env.MARKETPLACE_DATABASE_URL)return {connectionString:process.env.MARKETPLACE_DATABASE_URL,ssl:false};
  const cli = spawnSync(process.env.ComSpec,["/d","/s","/c","npx.cmd supabase db dump --linked --schema public --dry-run"],{cwd:repo,encoding:"utf8",windowsHide:true});
  if (cli.status !== 0) fail("order_lifecycle_secure_connection_failed");
  const captured=`${cli.stdout??""}${cli.stderr??""}`;
  const value=name=>captured.match(new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`))?.[1];
  const config={host:value("PGHOST"),port:Number(value("PGPORT")),user:value("PGUSER"),password:value("PGPASSWORD"),database:value("PGDATABASE"),ssl:{rejectUnauthorized:false}};
  if(!config.host||!config.port||!config.user||!config.password||!config.database)fail("order_lifecycle_secure_connection_failed");
  return config;
}
const countsSql=`select (select count(*)::int from auth.users)users,(select count(*)::int from products)products,
 (select count(*)::int from marketplace_product_variants)variants,(select count(*)::int from marketplace_inventory_levels)inventory,
 (select count(*)::int from marketplace_checkout_sessions)checkouts,(select count(*)::int from marketplace_orders)orders,
 (select count(*)::int from marketplace_order_items)order_items,(select count(*)::int from marketplace_inventory_reservations)reservations,
 (select count(*)::int from marketplace_payments)payments,(select count(*)::int from marketplace_payment_allocations)allocations,
 (select count(*)::int from marketplace_order_shipments)shipments,(select count(*)::int from marketplace_order_disputes)disputes,
 (select count(*)::int from marketplace_order_settlements)settlements,(select count(*)::int from financial_transactions)transactions,
 (select count(*)::int from ledger_entries)ledger_entries`;
const db=new Client(linkedConfiguration());
let open=false;
let stage="connect";
const ids={seller:randomUUID(),buyer:randomUUID(),store:randomUUID(),profile:randomUUID(),product:randomUUID(),variant:randomUUID(),fund:randomUUID()};
async function claims(role,subject=null){await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true)",[role,subject??'']);}
async function checkout(label){
  stage=`${label.toLowerCase()}_reservation`;
  await claims('authenticated',ids.buyer);
  const key=randomUUID();
  const result=(await db.query(`select public.create_marketplace_checkout_reservation(
   jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),
   jsonb_build_object('recipient_name','Proof Buyer','line1','Proof Street','city','Proof City','region','NY','postal_code','10001','country','US'),$2) value`,[ids.variant,key])).rows[0].value;
  const checkoutId=result.checkout.id,orderId=result.orders[0].id;
  stage=`${label.toLowerCase()}_payment`;
  await claims('service_role');
  await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",[ids.buyer,checkoutId,randomUUID()]);
  stage=`${label.toLowerCase()}_processing`;
  await claims('authenticated',ids.seller);
  await db.query("select public.seller_start_marketplace_order_processing($1,$2)",[orderId,randomUUID()]);
  stage=`${label.toLowerCase()}_shipment`;
  const shipKey=randomUUID();
  const first=(await db.query("select public.seller_ship_marketplace_order($1,'Proof Carrier','Ground',$2,null,null,$3) value",[orderId,`TRACK-${label}`,shipKey])).rows[0].value;
  const second=(await db.query("select public.seller_ship_marketplace_order($1,'Proof Carrier','Ground',$2,null,null,$3) value",[orderId,`TRACK-${label}`,shipKey])).rows[0].value;
  assert(JSON.stringify(first)===JSON.stringify(second),'shipment_retry_not_idempotent');
  return{checkoutId,orderId};
}
try{
 await db.connect();
 stage="baseline";
 await db.query('set role postgres');
 assert((await db.query("select current_database() is not null ok")).rows[0].ok,'secure_connection_failed');
 const before=(await db.query(countsSql)).rows[0];
 await db.query('begin');open=true;await db.query('set role postgres');await claims('service_role');stage="synthetic_roots";
 for(const [id,email]of[[ids.seller,`lifecycle-seller-${randomUUID()}@onsynthetic.local`],[ids.buyer,`lifecycle-buyer-${randomUUID()}@onsynthetic.local`]])await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",[id,email]);
 await db.query("insert into user_profiles(id,username,display_name)values($1,$2,'Lifecycle Seller'),($3,$4,'Lifecycle Buyer')",[ids.seller,`life_s_${randomUUID().replaceAll('-','').slice(0,18)}`,ids.buyer,`life_b_${randomUUID().replaceAll('-','').slice(0,18)}`]);
 await db.query("insert into marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Lifecycle Seller',now())",[ids.seller]);
 await db.query("insert into marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Lifecycle Store',$3,'active')",[ids.store,ids.seller,`lifecycle-${randomUUID()}`]);
 await db.query("insert into marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)values($1,$2,$3,'US Ground',1,3,'US','Returns within 14 days.')",[ids.profile,ids.seller,ids.store]);
 await db.query("insert into marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0.25,2,7)",[ids.profile]);
 await db.query("insert into products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id)values($1,$2,'Lifecycle Proof','Rollback only',1,'BDAG','physical',5,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$4)",[ids.product,ids.seller,ids.store,ids.profile]);
 const sku=`LIFECYCLE-${randomUUID().toUpperCase()}`;
 await db.query("insert into marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',1,'active',true,'')",[ids.variant,ids.product,ids.store,ids.seller,sku]);
 await db.query("insert into marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,5,0)",[ids.variant]);
 stage="funding";const buyerAccount=(await db.query("select public.ensure_ledger_account($1)id",[ids.buyer])).rows[0].id;
 const platform=(await db.query("select id from ledger_accounts where owner_id is null and account_type='platform' and currency='BDAG' for update")).rows[0].id;
 await db.query("insert into financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values($1,$2,$3,'marketplace_test_funding',10,0,'BDAG','completed','marketplace_test_fixture',$4,$5,$6)",[ids.fund,platform,buyerAccount,ids.product,`lifecycle-fund-${ids.fund}`,ids.buyer]);
 await db.query("select ledger_debit($1,$2,10,'Lifecycle rollback funding',jsonb_build_object('fin_txn_id',$1::uuid)),ledger_credit($1,$3,10,'Lifecycle rollback funding',jsonb_build_object('fin_txn_id',$1::uuid))",[ids.fund,platform,buyerAccount]);
 stage="direct_checkout";const direct=await checkout('DIRECT');
 await claims('service_role');
 await db.query("select confirm_marketplace_order_delivery_and_release($1,$2,$3)",[ids.buyer,direct.orderId,randomUUID()]);
 assert((await db.query("select count(*)::int n from marketplace_order_settlements where order_id=$1",[direct.orderId])).rows[0].n===1,'receipt_settlement_missing');
 stage="automatic_checkout";const auto=await checkout('AUTO');
 await db.query("update marketplace_order_shipments set shipped_at=now()-interval '30 days' where order_id=$1",[auto.orderId]);
 await claims('service_role');const autoFirst=(await db.query("select run_scheduled_marketplace_settlement() value")).rows[0].value;const txBeforeRetry=(await db.query("select count(*)::int n from financial_transactions where reference_id=$1",[auto.orderId])).rows[0].n;const autoSecond=(await db.query("select run_scheduled_marketplace_settlement() value")).rows[0].value;const txAfterRetry=(await db.query("select count(*)::int n from financial_transactions where reference_id=$1",[auto.orderId])).rows[0].n;
 assert(autoFirst.processed===1&&autoSecond.processed===0&&txBeforeRetry===txAfterRetry,'scheduler_retry_failed');
 stage="dispute_checkout";const disputed=await checkout('DISPUTE');
 await db.query("update marketplace_order_shipments set shipped_at=now()-interval '30 days' where order_id=$1",[disputed.orderId]);
 await claims('authenticated',ids.buyer);const disputeKey=randomUUID();await db.query("select report_marketplace_order_problem($1,'not_received','Rollback proof',$2)",[disputed.orderId,disputeKey]);await db.query("select report_marketplace_order_problem($1,'not_received','Rollback proof',$2)",[disputed.orderId,disputeKey]);
 await claims('service_role');const blocked=(await db.query("select run_scheduled_marketplace_settlement() value")).rows[0].value;assert(blocked.processed===0,'dispute_did_not_block_settlement');assert((await db.query("select status from marketplace_payment_allocations where order_id=$1",[disputed.orderId])).rows[0].status==='held','dispute_allocation_released');
 const inside={direct_settlements:1,auto_processed:autoFirst.processed,auto_retry_processed:autoSecond.processed,dispute_blocked:true,shipment_retry:true,shipping_frozen:(await db.query("select shipping_amount from marketplace_orders where id=$1",[direct.orderId])).rows[0].shipping_amount};
 await db.query('rollback');open=false;
 const after=(await db.query(countsSql)).rows[0];assert(JSON.stringify(before)===JSON.stringify(after),'rollback_counts_changed');
 const reconciled=(await db.query("select reconcile_marketplace_payments() payments,reconcile_marketplace_settlements() settlements,reconcile_marketplace_live_commissions() commissions")).rows[0];
 assert(reconciliationIsZero(reconciled.payments),'payment_reconciliation_nonzero');assert(reconciliationIsZero(reconciled.settlements,['escrow_actual_balance','escrow_expected_held_total']),'settlement_reconciliation_nonzero');assert(reconciliationIsZero(reconciled.commissions),'commission_reconciliation_nonzero');
 const cron=(await db.query("select count(*)::int n from cron.job where jobname='settle-eligible-marketplace-orders' and schedule='17 * * * *' and active")).rows[0].n;assert(cron===1,'settlement_cron_not_active');
 console.log(JSON.stringify({project_ref:projectRef,direct:{settled:inside.direct_settlements===1},automatic:{processed:inside.auto_processed,retry_processed:inside.auto_retry_processed,cron_active:true},dispute:{blocked:inside.dispute_blocked},shipment:{idempotent:inside.shipment_retry},shipping:{frozen_amount:Number(inside.shipping_frozen)},rollback:{global_counts_unchanged:true},reconciliation:{payments:0,settlements:0,commissions:0}},null,2));
}catch(error){if(open)await db.query('rollback').catch(()=>{});console.error(`MARKETPLACE_ORDER_LIFECYCLE_PROOF_FAILED:${stage}:${safeError(error)}`);process.exitCode=1;}finally{await db.end().catch(()=>{});}
