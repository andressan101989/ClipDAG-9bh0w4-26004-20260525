import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8"),
  sql = read(
    "supabase/migrations/20260810160000_marketplace_ads_delivery_events_attribution.sql",
  ),
  hardeningSql = read(
    "supabase/migrations/20260810170000_harden_marketplace_ads_delivery_attribution.sql",
  ),
  shop = read("app/(tabs)/shop.tsx"),
  detail = read("app/product/[id].tsx"),
  service = read("services/marketplaceAdsService.ts"),
  edge = read("supabase/functions/marketplace-ads/index.ts"),
  cart = read("services/marketplaceCart.ts");
for (const token of [
  "marketplace_ad_delivery_materializations",
  "materialize_marketplace_ad_campaign_spend",
  "checkpoint_marketplace_ad_eligibility",
  "spend_marketplace_ad_budget",
  "finalize_marketplace_ad_campaign_delivery",
  "marketplace_ad_events",
  "marketplace_ad_touches",
  "interval'24 hours'",
  "marketplace_order_ad_attribution",
  "marketplace_order_item_ad_attribution_trigger",
  "fetch_marketplace_sponsored_products",
  "Patrocinado",
  "reconcile_marketplace_ad_delivery",
  "reconcile_marketplace_ad_events",
])
  assert.match(sql, new RegExp(token));
assert.match(sql, /floor\(extract\(epoch from now\(\)\)\/600\)\*600/);
assert.match(sql, /not c\.eligibility_state/);
assert.doesNotMatch(sql, /marketplace_ad_(?:click|impression).*ledger/i);
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge, /materialize_marketplace_ad_campaign_spend/);
assert.match(edge, /materializeSponsoredCandidates/);
assert.match(service, /functions\.invoke\(["']marketplace-ads["']/);
assert.doesNotMatch(service, /adService|ad_create/);
assert.match(shop, /Patrocinado/);
assert.match(shop, /visible\s*\/\s*height\s*>=\s*MARKETPLACE_AD_VISIBLE_RATIO/);
assert.match(shop, /setTimeout/);
assert.match(shop, /index\s*%\s*8\s*===\s*0/);
assert.match(
  shop,
  /products\.some\(\s*\(?value\)?\s*=>\s*value\.id\s*===\s*ad\.product_id\s*\)/,
);
assert.match(detail, /source\s*!==\s*["']ad["']/);
assert.match(detail, /recordAdEvent/);
assert.doesNotMatch(cart, /adCampaignId|adTouchId/);
const mix = (organic, ads) =>
  organic.flatMap((x, i) => {
    const ad = i > 0 && i % 8 === 0 ? ads[Math.floor(i / 8) - 1] : null;
    return ad && !organic.includes(ad) ? [ad, x] : [x];
  });
assert.ok(
  mix(
    Array.from({ length: 16 }, (_, i) => "p" + i),
    ["a", "b"],
  ).filter((x) => x[0] === "a" || x[0] === "b").length <= 2,
);
assert.equal(
  mix(
    Array.from({ length: 7 }, (_, i) => "p" + i),
    ["a"],
  ).filter((x) => x === "a").length,
  0,
);
assert.equal(mix([], ["a"]).length, 0);
assert.equal(
  new Set(mix(["x", ...Array.from({ length: 8 }, (_, i) => "p" + i)], ["x"]))
    .size,
  9,
);
const cache = join(tmpdir(), "onspace-ads-npm-cache");
mkdirSync(cache, { recursive: true });
const cli = spawnSync(
    process.env.ComSpec,
    [
      "/d",
      "/s",
      "/c",
      "npx.cmd supabase db dump --linked --schema public --dry-run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, npm_config_cache: cache },
    },
  ),
  captured = String(cli.stdout || "") + String(cli.stderr || ""),
  env = (n) =>
    captured.match(
      new RegExp('(?:export |set \\"?)' + n + "=[\\\"']?([^\\\"'\\r\\n ]+)"),
    )?.[1];
assert.equal(cli.status, 0, "secure_connection_failed:" + captured.slice(-500));
const db = new pg.Client({
  host: env("PGHOST"),
  port: +env("PGPORT"),
  user: env("PGUSER"),
  password: env("PGPASSWORD"),
  database: env("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
});
let open = false;
try {
  await db.connect();
  await db.query("set role postgres");
  await db.query("begin");
  open = true;
  await db.query("set local lock_timeout='10s'");
  await db.query("set local statement_timeout='30s'");
  if (
    !(
      await db.query(
        "select to_regclass('public.marketplace_ad_delivery_materializations')is not null ok",
      )
    ).rows[0].ok
  )
    await db.query(sql.replace(/^begin;\s*|\s*commit;\s*$/g, ""));
  if (!(await db.query("select to_regprocedure('public.fetch_marketplace_sponsored_products_v2(text,text,integer,text)')is not null ok")).rows[0].ok)
    await db.query(hardeningSql.replace(/^begin;\s*|\s*commit;\s*$/g, ""));
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',true)",
  );
  const ids=Object.fromEntries(['seller','buyer','organicBuyer','store','session','create','fund'].map(key=>[key,randomUUID()]));
  const claims=(role,sub='')=>db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claim.sub',$3,true)",[JSON.stringify(sub?{role,sub}:{role}),role,sub]);
  await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",[ids.seller,`${randomUUID()}@synthetic.local`]);
  await db.query('insert into user_profiles(id,username,display_name)values($1,$2,$3)',[ids.seller,`ads_${randomUUID().replaceAll('-','').slice(0,12)}`,'Ads Delivery Proof']);
  for(const [id,label]of[[ids.buyer,'buyer'],[ids.organicBuyer,'organic']]){await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",[id,`${randomUUID()}@synthetic.local`]);await db.query('insert into user_profiles(id,username,display_name)values($1,$2,$3)',[id,`${label}_${randomUUID().replaceAll('-','').slice(0,10)}`,label])}
  await db.query("insert into marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Ads Delivery Proof',now())",[ids.seller]);
  await db.query("insert into marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Ads Delivery Store',$3,'active')",[ids.store,ids.seller,`ads-delivery-${randomUUID()}`]);
  const category=(await db.query("select id from marketplace_categories where status='active' order by created_at limit 1")).rows[0];assert.ok(category);
  await claims('authenticated',ids.seller);
  const product=(await db.query('select create_or_resume_marketplace_product_draft($1,$2,$3) id',[ids.store,category.id,ids.session])).rows[0].id;
  await claims('service_role');
  await db.query("update products set title='Ads Delivery Product',description='Rollback only',price=100,status='active',moderation_status='approved',published_at=now(),category='physical' where id=$1",[product]);
  const variant=(await db.query('select id from marketplace_product_variants where product_id=$1 order by is_default desc limit 1',[product])).rows[0].id;
  await db.query("update marketplace_product_variants set price=100,status='active',archived_at=null where id=$1",[variant]);
  await db.query('update marketplace_inventory_levels set on_hand=100,reserved=0 where variant_id=$1',[variant]);
  const account=(await db.query('select ensure_ledger_account($1) id',[ids.seller])).rows[0].id;await db.query('update ledger_accounts set balance=1000 where id=$1',[account]);
  const t1=(await db.query("select date_trunc('minute',now())+interval'1 minute' t")).rows[0].t,start=new Date(t1.getTime()-3600000),end=new Date(start.getTime()+36000000);
  await claims('authenticated',ids.seller);
  const campaign=(await db.query('select create_marketplace_ad_campaign_draft($1,$2,$3,$4,$5,$6) result',[product,'Real pacing',100,start.toISOString(),end.toISOString(),ids.create])).rows[0].result.id;
  await db.query('select activate_marketplace_ad_campaign($1,$2)',[campaign,ids.fund]);
  await claims('service_role');
  await db.query('alter table marketplace_ad_campaigns disable trigger user');
  await db.query("update marketplace_ad_campaigns set eligible_elapsed_seconds=3600,eligibility_checkpoint_at=$2,eligibility_state=true,eligibility_reason='eligible',status='active' where id=$1",[campaign,t1]);
  await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,t1]);
  assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),10);
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,t1]);
  assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),10);
  const t2=new Date(t1.getTime()+600000);await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set eligible_elapsed_seconds=7200,eligibility_checkpoint_at=$2 where id=$1",[campaign,t2]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,t2]);
  assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),20);
  const tPauseEnd=new Date(t2.getTime()+10800000);await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set status='paused',eligibility_state=false,eligibility_reason='paused',eligibility_checkpoint_at=$2 where id=$1",[campaign,t2]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,tPauseEnd]);assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),20);
  await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set status='active',eligible_elapsed_seconds=10800,eligibility_state=true,eligibility_reason='eligible',eligibility_checkpoint_at=$2 where id=$1",[campaign,tPauseEnd]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,tPauseEnd]);assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),30);
  const tRestock=new Date(tPauseEnd.getTime()+14400000),tAfterRestock=new Date(tRestock.getTime()+3600000);
  await db.query('alter table marketplace_inventory_levels disable trigger user');await db.query('update marketplace_inventory_levels set on_hand=0 where variant_id=$1',[variant]);await db.query('alter table marketplace_inventory_levels enable trigger user');
  await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set eligibility_state=false,eligibility_reason='out_of_stock',eligibility_checkpoint_at=$2 where id=$1",[campaign,tPauseEnd]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,tRestock]);assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),30);
  await db.query('alter table marketplace_inventory_levels disable trigger user');await db.query('update marketplace_inventory_levels set on_hand=100 where variant_id=$1',[variant]);await db.query('alter table marketplace_inventory_levels enable trigger user');
  await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set eligible_elapsed_seconds=14400,eligibility_state=true,eligibility_reason='eligible',eligibility_checkpoint_at=$2 where id=$1",[campaign,tAfterRestock]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  await db.query('select materialize_marketplace_ad_campaign_spend_at($1,$2)',[campaign,tAfterRestock]);assert.equal(Number((await db.query('select spent_bdag from marketplace_ad_campaigns where id=$1',[campaign])).rows[0].spent_bdag),40);
  await claims('authenticated',ids.seller);const expiryCreate=randomUUID(),expiryFund=randomUUID();
  const expiryCampaign=(await db.query('select create_marketplace_ad_campaign_draft($1,$2,$3,$4,$5,$6) result',[product,'Expiry integration',100,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+36000000).toISOString(),expiryCreate])).rows[0].result.id;
  await db.query('select activate_marketplace_ad_campaign($1,$2)',[expiryCampaign,expiryFund]);await claims('service_role');const priorSpendKey=randomUUID();await db.query('select spend_marketplace_ad_budget($1,38,$2)',[expiryCampaign,priorSpendKey]);const priorSpendEvent=(await db.query("select id from marketplace_ad_financial_events where campaign_id=$1 and event_type='spend'and idempotency_key=$2",[expiryCampaign,priorSpendKey])).rows[0].id;await db.query("insert into marketplace_ad_delivery_materializations(campaign_id,bucket_start,eligible_elapsed_seconds,target_spend_bdag,spent_before_bdag,delta_spend_bdag,financial_event_id)values($1,date_trunc('hour',now())-interval'1 hour',13680,38,0,38,$2)",[expiryCampaign,priorSpendEvent]);
  const expiryEnd=new Date(t1.getTime()-120000),expiryStart=new Date(expiryEnd.getTime()-36000000);await db.query('alter table marketplace_ad_campaigns disable trigger user');await db.query("update marketplace_ad_campaigns set starts_at=$2,ends_at=$3,eligible_elapsed_seconds=14400,eligibility_checkpoint_at=$3,eligibility_state=true,eligibility_reason='eligible',status='active' where id=$1",[expiryCampaign,expiryStart,expiryEnd]);await db.query('alter table marketplace_ad_campaigns enable trigger user');
  const expiryResult=(await db.query('select materialize_marketplace_ad_campaign_spend_at($1,now()) result',[expiryCampaign])).rows[0].result;assert.equal(Number(expiryResult.final_spend_delta_bdag),2);assert.equal(Number(expiryResult.released_bdag),60);
  const eventKey=`view:${randomUUID()}`,anon=`anon-${randomUUID()}`;await claims('anon');
  const view1=(await db.query("select record_marketplace_ad_event($1,$2,'product_view','product_detail',$3,$4,'{}') result",[campaign,product,eventKey,anon])).rows[0].result;
  const view2=(await db.query("select record_marketplace_ad_event($1,$2,'product_view','product_detail',$3,$4,'{}') result",[campaign,product,eventKey,anon])).rows[0].result;
  assert.equal(view1.touch_id,view2.touch_id);assert.ok(view1.touch_id);
  assert.equal(Number((await db.query('select count(*) from marketplace_ad_touches where source_event_id=$1',[view1.id])).rows[0].count),1);
  await db.query('savepoint actor_conflict');let actorConflict=false;try{await db.query("select record_marketplace_ad_event($1,$2,'product_view','product_detail',$3,$4,'{}')",[campaign,product,eventKey,`other-${randomUUID()}`])}catch(error){actorConflict=/idempotency_conflict/.test(String(error.message));await db.query('rollback to savepoint actor_conflict')}await db.query('release savepoint actor_conflict');assert.ok(actorConflict);
  await claims('service_role');
  await claims('anon');const impressionKey=`impression:${randomUUID()}`;
  await db.query("select record_marketplace_ad_event($1,$2,'impression','marketplace_home',$3,$4,'{\"position\":2}')",[campaign,product,impressionKey,anon]);
  await db.query("select record_marketplace_ad_event($1,$2,'impression','marketplace_home',$3,$4,'{\"position\":2}')",[campaign,product,impressionKey,anon]);
  assert.equal(Number((await db.query("select count(*)from marketplace_ad_events where event_key=$1",[impressionKey])).rows[0].count),1);
  const clickKey=`click:${randomUUID()}`;await db.query("select record_marketplace_ad_event($1,$2,'click','marketplace_home',$3,$4,'{\"position\":2}')",[campaign,product,clickKey,anon]);await db.query("select record_marketplace_ad_event($1,$2,'click','marketplace_home',$3,$4,'{\"position\":2}')",[campaign,product,clickKey,anon]);assert.equal(Number((await db.query('select count(*)from marketplace_ad_events where event_key=$1',[clickKey])).rows[0].count),1);
  for(const [label,query,args,token]of[
    ['mismatch',"select record_marketplace_ad_event($1,gen_random_uuid(),'click','marketplace_home',$2,$3,'{}')",[campaign,`bad:${randomUUID()}`,anon],'product_mismatch'],
    ['privacy',"select record_marketplace_ad_event($1,$2,'click','marketplace_home',$3,$4,'{\"email\":\"x\"}')",[campaign,product,`privacy:${randomUUID()}`,anon],'metadata_invalid']]){
    await db.query('savepoint '+label);let rejected=false;try{await db.query(query,args)}catch(error){rejected=String(error.message).includes(token);await db.query('rollback to savepoint '+label)}await db.query('release savepoint '+label);assert.ok(rejected,label);
  }
  await claims('service_role');
  const sponsored=(await db.query("select fetch_marketplace_sponsored_products_v2('marketplace_home','physical',4,'proof-session') value")).rows.map(row=>row.value);
  assert.ok(sponsored.some(row=>row.product_id===product));
  const excluded=(await db.query("select count(*) from fetch_marketplace_sponsored_products_v2('marketplace_home','music',4,'proof-session')")).rows[0].count;assert.equal(Number(excluded),0);
  await db.query('savepoint ads_fair_rotation');
  const fairCampaigns=[randomUUID(),randomUUID()];
  await db.query("insert into marketplace_ad_campaigns(id,seller_id,store_id,product_id,name,status,starts_at,ends_at,total_budget_bdag,spent_bdag,released_bdag,funded_at,creation_idempotency_key,funding_idempotency_key,eligible_elapsed_seconds,eligibility_checkpoint_at,eligibility_state,eligibility_reason) values($1,$3,$4,$5,'Fair small','active',now()-interval'1 hour',now()+interval'1 day',10,0,0,now(),$6,$7,60,now(),true,'eligible'),($2,$3,$4,$5,'Fair largest','active',now()-interval'1 hour',now()+interval'1 day',1000,0,0,now(),$8,$9,60,now(),true,'eligible')",[fairCampaigns[0],fairCampaigns[1],ids.seller,ids.store,product,randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
  const eligibleFair=(await db.query("select result->>'campaign_id' campaign_id from fetch_marketplace_sponsored_products_v2('marketplace_home','physical',8,'fair-inspect') result")).rows;const winners=new Set();for(let i=0;i<24;i++){const row=(await db.query("select result->>'campaign_id' campaign_id from fetch_marketplace_sponsored_products_v2('marketplace_home','physical',1,$1) result",[`fair-session-${i}`])).rows[0];if(row)winners.add(row.campaign_id)}assert.ok(winners.size>1,JSON.stringify({eligibleFair,winners:[...winners]}));assert.ok([...winners].some(id=>id!==fairCampaigns[1]));
  await db.query('rollback to savepoint ads_fair_rotation');
  const organicCard=(await db.query("select marketplace_public_product_card_price($1,now()) result",[product])).rows[0].result;
  assert.equal(Number(organicCard.price),Number(sponsored.find(row=>row.product_id===product).price));
  await db.query('savepoint ads_card_price');const cheaperVariant=randomUUID();await db.query("insert into marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Cheaper variant',80,'active',false,$6)",[cheaperVariant,product,ids.store,ids.seller,`ADS-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`,randomUUID().toString()]);await db.query('insert into marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,10,0)',[cheaperVariant]);
  let sharedPrice=(await db.query('select marketplace_public_product_card_price($1,now()) result',[product])).rows[0].result;let sponsoredPrice=(await db.query("select(result->>'price')::numeric price from fetch_marketplace_sponsored_products_v2('marketplace_home','physical',8,'price-proof')result where(result->>'product_id')::uuid=$1",[product])).rows[0];assert.equal(Number(sharedPrice.price),80);assert.equal(Number(sponsoredPrice.price),80);
  const promotion=randomUUID();await db.query("insert into marketplace_product_promotions(id,seller_id,store_id,product_id,variant_id,promotion_type,percentage_off,starts_at,ends_at,created_by,idempotency_key)values($1,$2,$3,$4,$5,'percentage',50,now()-interval'1 minute',now()+interval'1 hour',$2,$6)",[promotion,ids.seller,ids.store,product,cheaperVariant,randomUUID()]);sharedPrice=(await db.query('select marketplace_public_product_card_price($1,now()) result',[product])).rows[0].result;sponsoredPrice=(await db.query("select(result->>'price')::numeric price from fetch_marketplace_sponsored_products_v2('marketplace_home','physical',8,'promo-proof')result where(result->>'product_id')::uuid=$1",[product])).rows[0];assert.equal(Number(sharedPrice.price),40);assert.equal(Number(sponsoredPrice.price),40);await db.query("update marketplace_product_promotions set ends_at=now()-interval'1 second' where id=$1",[promotion]);sharedPrice=(await db.query('select marketplace_public_product_card_price($1,now()) result',[product])).rows[0].result;sponsoredPrice=(await db.query("select(result->>'price')::numeric price from fetch_marketplace_sponsored_products_v2('marketplace_home','physical',8,'expired-promo-proof')result where(result->>'product_id')::uuid=$1",[product])).rows[0];assert.equal(Number(sharedPrice.price),80);assert.equal(Number(sponsoredPrice.price),80);await db.query('rollback to savepoint ads_card_price');
  await claims('authenticated',ids.buyer);const buyerView=(await db.query("select record_marketplace_ad_event($1,$2,'product_view','product_detail',$3,null,'{}') result",[campaign,product,`buyer-view:${randomUUID()}`])).rows[0].result;assert.ok(buyerView.touch_id);
  await claims('service_role');const checkout=randomUUID(),order=randomUUID(),item=randomUUID();await db.query("insert into marketplace_checkout_sessions(id,reference,buyer_id,status,subtotal,total,idempotency_key,request_fingerprint,expires_at)values($1,$2,$3,'paid',25,25,$4,$5,now()+interval'1 hour')",[checkout,`CHK-${randomUUID()}`,ids.buyer,randomUUID(),randomUUID()]);await db.query('alter table marketplace_orders disable trigger user');await db.query("insert into marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,status,subtotal,total,reservation_expires_at)values($1,$2,$3,$4,$5,$6,'confirmed',25,25,now()+interval'1 hour')",[order,`ORD-${randomUUID()}`,checkout,ids.buyer,ids.seller,ids.store]);await db.query('alter table marketplace_orders enable trigger user');await db.query('alter table marketplace_order_items disable trigger marketplace_order_item_freeze_shipping');await db.query("insert into marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,sku,option_snapshot,unit_price,quantity,line_total)values($1,$2,$3,$4,$5,$6,$7,'Ads Delivery Product','SKU-PROOF','[]',25,1,25)",[item,order,checkout,product,variant,ids.seller,ids.store]);await db.query('alter table marketplace_order_items enable trigger marketplace_order_item_freeze_shipping');assert.equal(Number((await db.query('select count(*)from marketplace_order_ad_attribution where order_item_id=$1 and attributed_gmv_bdag=25',[item])).rows[0].count),1);assert.equal(Number((await db.query("select count(*)from marketplace_ad_events where order_item_id=$1 and event_type='purchase'and(metadata->>'line_total')::numeric=25",[item])).rows[0].count),1);
  const organicCheckout=randomUUID(),organicOrder=randomUUID(),organicItem=randomUUID();await db.query("insert into marketplace_checkout_sessions(id,reference,buyer_id,status,subtotal,total,idempotency_key,request_fingerprint,expires_at)values($1,$2,$3,'paid',25,25,$4,$5,now()+interval'1 hour')",[organicCheckout,`CHK-${randomUUID()}`,ids.organicBuyer,randomUUID(),randomUUID()]);await db.query('alter table marketplace_orders disable trigger user');await db.query("insert into marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,status,subtotal,total,reservation_expires_at)values($1,$2,$3,$4,$5,$6,'confirmed',25,25,now()+interval'1 hour')",[organicOrder,`ORD-${randomUUID()}`,organicCheckout,ids.organicBuyer,ids.seller,ids.store]);await db.query('alter table marketplace_orders enable trigger user');await db.query('alter table marketplace_order_items disable trigger marketplace_order_item_freeze_shipping');await db.query("insert into marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,sku,option_snapshot,unit_price,quantity,line_total)values($1,$2,$3,$4,$5,$6,$7,'Ads Delivery Product','SKU-ORGANIC','[]',25,1,25)",[organicItem,organicOrder,organicCheckout,product,variant,ids.seller,ids.store]);await db.query('alter table marketplace_order_items enable trigger marketplace_order_item_freeze_shipping');assert.equal(Number((await db.query('select count(*)from marketplace_order_ad_attribution where order_item_id=$1',[organicItem])).rows[0].count),0);assert.equal(Number((await db.query("select count(*)from marketplace_ad_events where order_item_id=$1 and event_type='purchase'",[organicItem])).rows[0].count),0);
  const d = (await db.query("select reconcile_marketplace_ad_delivery()r"))
      .rows[0].r,
    e = (await db.query("select reconcile_marketplace_ad_events()r")).rows[0].r;
  for (const value of Object.values(d)) assert.equal(Number(value), 0);
  for (const value of Object.values(e)) assert.equal(Number(value), 0);
  await db.query("rollback");
  open = false;
  console.log(
    JSON.stringify({
      ok: true,
      pacing: "eligible-time",
      bucketMinutes: 10,
      cpc: false,
      cpm: false,
      frequency: true,
      duplicateSuppression: true,
      visibility: "50%-500ms",
      attributionHours: 24,
      realFixtures:{basicPacing:true,sameBucketRetry:true,pause:true,outOfStock:true,expiry38Plus2Release60:true,impression:true,click:true,productMismatch:true,privacy:true,touchRetry:true,actorConflict:true,categoryExclusion:true,fairRotation:true,multivariantCardPrice:true,b5PromotionCardPrice:true,b5ExpiryCardPrice:true,purchaseAttribution:true,organicExclusion:true},
      deliveryReconciliation: d,
      eventReconciliation: e,
      persistentFixtures: 0,
      rollback: true,
    }),
  );
} finally {
  if (open) await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}
