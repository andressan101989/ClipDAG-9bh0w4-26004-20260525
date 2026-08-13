import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MARKETPLACE_DATABASE_URL;
if (!connectionString) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== "55422") {
  throw new Error("B7C_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}
const db = new Client({ connectionString, ssl: false });
const uid = () => randomUUID();
const money = (value) => Number(value);
let stage = "connect";

async function claim(client, role, sub = "", local = true) {
  await client.query("select set_config('request.jwt.claim.role',$1,$3),set_config('request.jwt.claim.sub',$2,$3)", [role, sub, local]);
}
async function expectError(client, action, message, code) {
  const savepoint = `b7c_expected_${uid().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  let caught;
  try { await action(); } catch (error) { caught = error; }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  assert(caught, `expected_error_missing:${message}`);
  if (message) assert.equal(caught.message, message);
  if (code) assert.equal(caught.code, code);
}
async function transactionScenario(name, action) {
  stage = name;
  await db.query("begin");
  try { const result = await action(); await db.query("rollback"); return result; }
  catch (error) { await db.query("rollback").catch(() => {}); error.message = `${name}:${error.message}`; throw error; }
}
async function insertUser(client, id, label, isAdmin = false, prefix = "b7c") {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`, [id, `${prefix}-${label}-${token}@proof.local`]);
  await client.query("insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)", [id, `${prefix}${label}${token}`, `B7C ${label}`, isAdmin]);
}
async function fixture(client, prefix = "b7c") {
  const f = { prefix, seller: uid(), buyer: uid(), admin: uid(), creatorX: uid(), creatorY: uid(), outsider: uid(), store: uid(), shippingProfile: uid(), products: [], variants: [], offers: [], videos: [] };
  await insertUser(client, f.seller, "seller", false, prefix);
  await insertUser(client, f.buyer, "buyer", false, prefix);
  await insertUser(client, f.admin, "admin", true, prefix);
  await insertUser(client, f.creatorX, "creatorx", false, prefix);
  await insertUser(client, f.creatorY, "creatory", false, prefix);
  await insertUser(client, f.outsider, "outsider", false, prefix);
  await client.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7C Seller',now())", [f.seller]);
  await client.query("insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7C Store',$3,'active')", [f.store, f.seller, `${prefix}-${uid()}`]);
  await client.query(`insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)
    values($1,$2,$3,'B7C Ground',1,2,'US','B7C returns')`, [f.shippingProfile, f.seller, f.store]);
  await client.query("insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)", [f.shippingProfile]);
  return f;
}
async function product(client, f, price, index, seller = f.seller) {
  const product = uid(), variant = uid(), sku = `B7C-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(`insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id)
    values($1,$2,$3,'Content tag proof',$4,'BDAG','physical',40,'active',$5,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$6)`, [product, seller, `B7C Item ${index}`, price, f.store, f.shippingProfile]);
  await client.query(`insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
    values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`, [variant, product, f.store, seller, sku, price]);
  await client.query("insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,40,0)", [variant]);
  f.products.push(product); f.variants.push(variant); return { product, variant, price };
}
async function offer(client, f, item, creator, bps, status = "active") {
  await claim(client, "authenticated", f.seller, false);
  const result = (await client.query("select public.upsert_my_live_affiliate_offer($1,$2,$3,$4,$5,null,null,$6)value", [item.product, creator ? "specific_creator" : "public_creator", creator ? f[creator] : null, bps, status, uid()])).rows[0].value;
  f.offers.push(result.id); return result;
}
async function video(client, f, creator, type, index) {
  await claim(client, "authenticated", creator, false);
  const id = uid();
  await client.query("insert into public.videos(id,user_id,video_url,thumbnail_url,caption,media_urls)values($1,$2,$3,$4,$5,$6)", [id, creator, type === "reel" ? `https://proof.local/videos/${index}.mp4` : `https://proof.local/images/${index}.jpg`, null, `B7C ${type}`, type === "feed" ? [`https://proof.local/images/${index}.jpg`, `https://proof.local/images/${index}-2.jpg`] : null]);
  f.videos.push(id); return id;
}
async function setTags(client, creator, type, content, products, key = uid()) {
  await claim(client, "authenticated", creator, false);
  return (await client.query("select public.set_my_marketplace_content_product_tags($1,$2,$3,$4)value", [type, content, products, key])).rows[0].value;
}
async function attribution(client, buyer, tag, variant, key = uid()) {
  await claim(client, "authenticated", buyer, false);
  return (await client.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value", [tag, variant, key])).rows[0].value;
}
async function reconcile(client, name, count) {
  await claim(client, "service_role", "", false);
  const value = (await client.query(`select public.${name}()value`)).rows[0].value;
  assert.equal(Object.keys(value).length, count, `${name}_counter_count`);
  for (const [key, result] of Object.entries(value)) assert.equal(Number(result), 0, `${name}:${key}`);
  return value;
}

async function proveAuthority() {
  return transactionScenario("authority", async () => {
    const f = await fixture(db); const items = [];
    for (let i = 0; i < 6; i++) { const item = await product(db, f, 10 + i, i); await offer(db, f, item, null, 800 + i * 10); items.push(item); }
    const feed = await video(db, f, f.creatorX, "feed", 1), reel = await video(db, f, f.creatorX, "reel", 2), foreign = await video(db, f, f.creatorY, "feed", 3);
    const key = uid(); const first = await setTags(db, f.creatorX, "feed", feed, items.slice(0, 5).map((x) => x.product), key);
    assert.equal(first.count, 5); assert.deepEqual(first.items.map((x) => x.sort_position), [0,1,2,3,4]);
    assert.deepEqual(await setTags(db, f.creatorX, "feed", feed, items.slice(0, 5).map((x) => x.product), key), first);
    await expectError(db, () => setTags(db, f.creatorX, "feed", feed, items.slice(1, 6).map((x) => x.product), key), "marketplace_creator_content_tag_idempotency_conflict", "23505");
    await expectError(db, () => setTags(db, f.creatorX, "feed", feed, items.map((x) => x.product)), "marketplace_creator_content_tag_limit_reached", "22023");
    await expectError(db, () => setTags(db, f.creatorX, "feed", feed, [items[0].product, items[0].product]), "marketplace_creator_content_tag_duplicate_product", "22023");
    await expectError(db, () => setTags(db, f.creatorX, "feed", foreign, [items[0].product]), "marketplace_creator_content_forbidden", "42501");
    await expectError(db, () => setTags(db, f.creatorX, "reel", feed, [items[0].product]), "marketplace_creator_content_type_mismatch", "23514");
    const reelSet = await setTags(db, f.creatorX, "reel", reel, [items[0].product]);
    const tag = reelSet.items[0].id;
    const attrKey = uid(), attr = await attribution(db, f.buyer, tag, items[0].variant, attrKey);
    assert.equal(attr.source_surface, "reel"); assert.equal(attr.creator_user_id, f.creatorX); assert.equal(attr.commission_bps, 800);
    assert.deepEqual(await attribution(db, f.buyer, tag, items[0].variant, attrKey), attr);
    await expectError(db, () => attribution(db, f.buyer, first.items[0].id, items[0].variant, attrKey), "marketplace_creator_content_attribution_idempotency_conflict", "23505");
    await offer(db, f, items[0], null, 900);
    const fresh = await attribution(db, f.buyer, tag, items[0].variant);
    assert.equal(fresh.commission_bps, 900); assert.equal(attr.commission_bps, 800);
    await claim(db, "anon", "", false);
    const publicFeed = (await db.query("select public.get_marketplace_content_product_tags('feed',$1)value", [feed])).rows[0].value;
    assert.equal(publicFeed.visible, true); assert.equal(publicFeed.items.length, 5); assert.equal("commission_bps" in publicFeed.items[0], false);
    await db.query("update public.user_profiles set is_private=true where id=$1", [f.creatorX]);
    const privateRead = (await db.query("select public.get_marketplace_content_product_tags('feed',$1)value", [feed])).rows[0].value;
    assert.equal(privateRead.visible, false); assert.equal(privateRead.items.length, 0);
    await claim(db, "authenticated", f.buyer, false);
    await db.query("insert into public.follows(follower_id,following_id)values($1,$2)", [f.buyer, f.creatorX]);
    assert.equal((await db.query("select public.get_marketplace_content_product_tags('feed',$1)value", [feed])).rows[0].value.visible, true);
    await db.query("insert into public.blocked_users(blocker_id,blocked_id)values($1,$2)", [f.creatorX, f.buyer]);
    assert.equal((await db.query("select public.get_marketplace_content_product_tags('feed',$1)value", [feed])).rows[0].value.visible, false);
    await claim(db, "authenticated", f.creatorX, false);
    await setTags(db, f.creatorX, "reel", reel, []);
    await claim(db, "authenticated", f.buyer, false);
    await expectError(db, () => attribution(db, f.buyer, tag, items[0].variant), "marketplace_creator_content_attribution_unavailable", "22023");
    await claim(db, "authenticated", f.creatorX, false);
    await db.query("delete from public.videos where id=$1", [reel]);
    const tombstone = (await db.query("select content_id,video_id,status from public.marketplace_creator_content_product_tags where id=$1", [tag])).rows[0];
    assert.equal(tombstone.content_id, reel); assert.equal(tombstone.video_id, null); assert.equal(tombstone.status, "removed");
    await reconcile(db, "reconcile_marketplace_creator_content_tags", 28);
    return { feed: true, reel: true, fiveAllowed: true, sixthRejected: true, privacy: true, offerReplacement: true, removal: true, deletionTombstone: true, backendRetrySameCommand: true, backendChangedSetConflict: true };
  });
}

const addressSql = `jsonb_build_object('recipient_name','B7C','line1','Proof Street','city','New York','region','NY','postal_code','10001','country','US')`;
async function fund(client, f, amount) {
  await claim(client, "service_role", f.admin, false);
  const platform = (await client.query("select public.ensure_marketplace_platform_account()id")).rows[0].id;
  const buyerAccount = (await client.query("select public.ensure_ledger_account($1)id", [f.buyer])).rows[0].id;
  const transaction = uid();
  await client.query(`insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b7c_proof',$5,$6,$7)`, [transaction, platform, buyerAccount, amount, f.store, `b7c-fund:${transaction}`, f.buyer]);
  await client.query("select public.ledger_debit($1,$2,$3,'B7C proof funding','{}'),public.ledger_credit($1,$4,$3,'B7C proof funding','{}')", [transaction, platform, amount, buyerAccount]);
  return { platform, buyerAccount };
}
async function createOrder(client, f) {
  const x = await product(client, f, 50, 21), y = await product(client, f, 50, 22);
  await offer(client, f, x, "creatorX", 1000); await offer(client, f, y, "creatorY", 1400);
  const feed = await video(client, f, f.creatorX, "feed", 21), reel = await video(client, f, f.creatorY, "reel", 22);
  const xSet = await setTags(client, f.creatorX, "feed", feed, [x.product]);
  const ySet = await setTags(client, f.creatorY, "reel", reel, [y.product]);
  const ax = await attribution(client, f.buyer, xSet.items[0].id, x.variant);
  const ay = await attribution(client, f.buyer, ySet.items[0].id, y.variant);
  const funded = await fund(client, f, 100);
  await claim(client, "authenticated", f.buyer, false);
  const receipt = (await client.query(`select public.create_marketplace_creator_checkout_reservation($1::jsonb,${addressSql},$2)value`, [JSON.stringify([{variant_id:x.variant,quantity:1,attribution_id:ax.id},{variant_id:y.variant,quantity:1,attribution_id:ay.id}]), uid()])).rows[0].value;
  assert.equal(receipt.orders.length, 1);
  const commerce = { checkout: receipt.checkout.id, order: receipt.orders[0].id, ...funded, ax, ay };
  await claim(client, "service_role", f.admin, false);
  await client.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [f.buyer, commerce.checkout, uid()]);
  commerce.allocation = (await client.query("select * from public.marketplace_payment_allocations where order_id=$1", [commerce.order])).rows[0];
  return commerce;
}
async function settle(client, f, c) {
  await claim(client, "authenticated", f.seller, false);
  await client.query("select public.seller_start_marketplace_order_processing($1,$2)", [c.order, uid()]);
  await client.query("select public.seller_ship_marketplace_order($1,'B7C','Ground',$2,null,null,$3)", [c.order, `B7C-${uid().slice(0,8)}`, uid()]);
  await claim(client, "service_role", f.admin, false);
  await client.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)", [f.buyer, c.order, uid()]);
  const settlement = (await client.query("select * from public.marketplace_order_settlements where order_id=$1", [c.order])).rows[0];
  const legs = (await client.query("select leg_type,beneficiary_user_id,amount from public.marketplace_settlement_legs where settlement_id=$1 order by leg_type,beneficiary_user_id", [settlement.id])).rows;
  return { settlement, legs };
}
async function financial(insufficient = false) {
  return transactionScenario(insufficient ? "insufficient" : "financial", async () => {
    const f = await fixture(db); const c = await createOrder(db, f);
    assert.equal(money(c.allocation.gross_amount),100); assert.equal(money(c.allocation.seller_net_amount),78); assert.equal(money(c.allocation.platform_fee_amount),10); assert.equal(money(c.allocation.creator_commission_amount),12);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_commerce_attributions where id=any($1::uuid[])and source_surface in('feed','reel')", [[c.ax.id,c.ay.id]])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_order_item_creator_attributions where order_id=$1 and source_surface in('feed','reel')", [c.order])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1", [c.order])).rows[0].n,2);
    const released = await settle(db,f,c); assert.equal(released.legs.length,4);
    const totals = new Map(); for(const leg of released.legs) totals.set(leg.leg_type,(totals.get(leg.leg_type)??0)+money(leg.amount));
    assert.deepEqual(totals,new Map([["creator_commission",12],["platform_fee",10],["seller_net",78]]));
    assert.deepEqual(new Map(released.legs.filter((x)=>x.leg_type==="creator_commission").map((x)=>[x.beneficiary_user_id,money(x.amount)])),new Map([[f.creatorX,5],[f.creatorY,7]]));
    await claim(db,"service_role",f.admin,false);
    const review=(await db.query("select public.open_marketplace_post_settlement_review($1,$2,'b7c_content_tags','proof',$3)value",[f.admin,c.order,uid()])).rows[0].value;
    if(insufficient){
      const account=(await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user'and currency='BDAG'",[f.creatorY])).rows[0].id,tx=uid();
      await db.query("insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed','marketplace_b7c_proof',$4,$5,$6)",[tx,account,c.platform,c.order,`b7c-drain:${tx}`,f.admin]);
      await db.query("select public.ledger_debit($1,$2,1,'B7C insufficient','{}'),public.ledger_credit($1,$3,1,'B7C insufficient','{}')",[tx,account,c.platform]);
      const before=(await db.query("select id,balance from public.ledger_accounts where owner_id=any($1::uuid[])or id=any($2::uuid[])order by id",[[f.seller,f.buyer,f.creatorX,f.creatorY],[c.platform,c.buyerAccount]])).rows;
      const result=(await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7c_full_refund','proof',$3,null)value",[f.admin,review.dispute_id,uid()])).rows[0].value;
      assert.equal(result.money_moved,false); assert.deepEqual((await db.query("select id,balance from public.ledger_accounts where owner_id=any($1::uuid[])or id=any($2::uuid[])order by id",[[f.seller,f.buyer,f.creatorX,f.creatorY],[c.platform,c.buyerAccount]])).rows,before);
      return {moneyMoved:false,noPartialMovement:true};
    }
    const beforeRows=(await db.query("select owner_id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'",[[f.seller,f.buyer,f.creatorX,f.creatorY]])).rows,before=new Map(beforeRows.map((x)=>[x.owner_id,money(x.balance)]));
    const platformBefore=money((await db.query("select balance from public.ledger_accounts where id=$1",[c.platform])).rows[0].balance);
    const result=(await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7c_full_refund','proof',$3,null)value",[f.admin,review.dispute_id,uid()])).rows[0].value; assert.equal(result.finalDecision.financial_result.money_moved,true);
    const afterRows=(await db.query("select owner_id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'",[[f.seller,f.buyer,f.creatorX,f.creatorY]])).rows,after=new Map(afterRows.map((x)=>[x.owner_id,money(x.balance)]));
    assert.equal(before.get(f.seller)-after.get(f.seller),78);assert.equal(platformBefore-money((await db.query("select balance from public.ledger_accounts where id=$1",[c.platform])).rows[0].balance),10);assert.equal(before.get(f.creatorX)-after.get(f.creatorX),5);assert.equal(before.get(f.creatorY)-after.get(f.creatorY),7);assert.equal(after.get(f.buyer)-before.get(f.buyer),100);
    return {orderCount:1,seller:78,platform:10,creatorX:5,creatorY:7,gross:100,buyerRefund:100};
  });
}

async function cleanup(f) {
  await db.query("set session_replication_role=replica");
  try {
    const users=[f.seller,f.buyer,f.admin,f.creatorX,f.creatorY,f.outsider];
    await db.query("delete from public.marketplace_creator_commerce_attributions where source_surface in('feed','reel')and source_entity_id in(select id from public.marketplace_creator_content_product_tags where creator_user_id=any($1::uuid[]))",[users]);
    await db.query("delete from public.marketplace_creator_content_tag_commands where actor_id=any($1::uuid[])",[users]);
    await db.query("delete from public.marketplace_creator_content_product_tags where creator_user_id=any($1::uuid[])",[users]);
    await db.query("delete from public.videos where id=any($1::uuid[])",[f.videos]);
    await db.query("delete from public.marketplace_live_affiliate_offer_commands where seller_id=$1",[f.seller]);
    await db.query("delete from public.marketplace_live_affiliate_offers where seller_id=$1",[f.seller]);
    await db.query("delete from public.marketplace_inventory_levels where variant_id=any($1::uuid[])",[f.variants]);
    await db.query("delete from public.marketplace_product_variants where id=any($1::uuid[])",[f.variants]);
    await db.query("delete from public.products where id=any($1::uuid[])",[f.products]);
    await db.query("delete from public.marketplace_shipping_profile_regions where profile_id=$1",[f.shippingProfile]);
    await db.query("delete from public.marketplace_shipping_profiles where id=$1",[f.shippingProfile]);
    await db.query("delete from public.marketplace_stores where id=$1",[f.store]);
    await db.query("delete from public.marketplace_sellers where user_id=$1",[f.seller]);
    await db.query("delete from public.user_profiles where id=any($1::uuid[])",[users]);
    await db.query("delete from auth.users where id=any($1::uuid[])",[users]);
  } finally { await db.query("set session_replication_role=origin"); }
}
async function concurrency() {
  stage="concurrency"; const f=await fixture(db,"b7cconcurrency");
  const items=[];for(let i=0;i<8;i++){const item=await product(db,f,20+i,i);await offer(db,f,item,"creatorX",i===0?1200:1000);items.push(item);}
  const a=new Client({connectionString,ssl:false}),b=new Client({connectionString,ssl:false});await Promise.all([a.connect(),b.connect()]);
  try{
    const noDeadlock=(race)=>{for(const result of race)if(result.status==="rejected")assert.notEqual(result.reason?.code,"40P01","b7c_concurrency_deadlock");};
    const activeProducts=async(content)=>(await db.query("select product_id,sort_position from public.marketplace_creator_content_product_tags where content_id=$1 and status='active'order by sort_position",[content])).rows;

    const sameContent=await video(db,f,f.creatorX,"feed",31);await Promise.all([claim(a,"authenticated",f.creatorX,false),claim(b,"authenticated",f.creatorX,false)]);
    const sameKey=uid();const same=await Promise.all([a.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[sameContent,[items[0].product],sameKey]),b.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[sameContent,[items[0].product],sameKey])]);
    assert.deepEqual(same[0].rows[0].value,same[1].rows[0].value);assert.equal((await activeProducts(sameContent)).length,1);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_content_tag_commands where content_id=$1",[sameContent])).rows[0].n,1);

    const competingContent=await video(db,f,f.creatorX,"feed",32);await Promise.all([claim(a,"authenticated",f.creatorX,false),claim(b,"authenticated",f.creatorX,false)]);
    const setA=[items[0].product,items[1].product],setB=[items[2].product,items[3].product];
    const competing=await Promise.allSettled([a.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[competingContent,setA,uid()]),b.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[competingContent,setB,uid()])]);noDeadlock(competing);assert(competing.every((x)=>x.status==="fulfilled"));
    const competingFinal=await activeProducts(competingContent);assert([JSON.stringify(setA),JSON.stringify(setB)].includes(JSON.stringify(competingFinal.map((x)=>x.product_id))));assert.deepEqual(competingFinal.map((x)=>x.sort_position),[0,1]);

    const removeContent=await video(db,f,f.creatorX,"feed",33);const removeSet=await setTags(db,f.creatorX,"feed",removeContent,[items[1].product]);const removeTag=removeSet.items[0].id;
    await Promise.all([claim(a,"authenticated",f.creatorX,false),claim(b,"authenticated",f.buyer,false)]);
    const removeRace=await Promise.allSettled([a.query("select public.set_my_marketplace_content_product_tags('feed',$1,'{}'::uuid[],$2)value",[removeContent,uid()]),b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[removeTag,items[1].variant,uid()])]);noDeadlock(removeRace);assert.equal(removeRace[0].status,"fulfilled");
    const removed=(await db.query("select status,removed_at from public.marketplace_creator_content_product_tags where id=$1",[removeTag])).rows[0];assert.equal(removed.status,"removed");
    const removeAttrs=(await db.query("select attributed_at from public.marketplace_creator_commerce_attributions where source_entity_id=$1",[removeTag])).rows;assert(removeAttrs.length<=1);if(removeAttrs.length)assert(new Date(removeAttrs[0].attributed_at)<=new Date(removed.removed_at));

    const offerContent=await video(db,f,f.creatorX,"feed",34);const offerSet=await setTags(db,f.creatorX,"feed",offerContent,[items[0].product]);const offerTag=offerSet.items[0].id;
    await Promise.all([claim(a,"authenticated",f.seller,false),claim(b,"authenticated",f.buyer,false)]);
    const replacement=await Promise.allSettled([a.query("select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,900,'active',null,null,$3)value",[items[0].product,f.creatorX,uid()]),b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[offerTag,items[0].variant,uid()])]);noDeadlock(replacement);assert(replacement.every((x)=>x.status==="fulfilled"));
    const replacementBps=replacement[1].value.rows[0].value.commission_bps;assert([1200,900].includes(replacementBps));
    await claim(b,"authenticated",f.buyer,false);const freshReplacement=(await b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[offerTag,items[0].variant,uid()])).rows[0].value;assert.equal(freshReplacement.commission_bps,900);

    await Promise.all([claim(a,"authenticated",f.seller,false),claim(b,"authenticated",f.buyer,false)]);
    const revocation=await Promise.allSettled([a.query("select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,900,'removed',null,null,$3)value",[items[0].product,f.creatorX,uid()]),b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[offerTag,items[0].variant,uid()])]);noDeadlock(revocation);assert.equal(revocation[0].status,"fulfilled");if(revocation[1].status==="fulfilled")assert.equal(revocation[1].value.rows[0].value.commission_bps,900);
    await claim(b,"authenticated",f.buyer,false);let postRevoke;try{await b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)",[offerTag,items[0].variant,uid()]);}catch(error){postRevoke=error;}assert.equal(postRevoke?.message,"marketplace_creator_content_tag_offer_ineligible");

    const deleteItem=items[4];const deleteContent=await video(db,f,f.creatorX,"reel",35);const deleteSet=await setTags(db,f.creatorX,"reel",deleteContent,[deleteItem.product]);const deleteTag=deleteSet.items[0].id;
    await Promise.all([claim(a,"authenticated",f.creatorX,false),claim(b,"authenticated",f.buyer,false)]);
    const deletion=await Promise.allSettled([a.query("delete from public.videos where id=$1",[deleteContent]),b.query("select public.create_marketplace_creator_content_attribution($1,$2,$3)value",[deleteTag,deleteItem.variant,uid()])]);noDeadlock(deletion);assert.equal(deletion[0].status,"fulfilled");
    const tombstone=(await db.query("select content_id,video_id,status,removed_at from public.marketplace_creator_content_product_tags where id=$1",[deleteTag])).rows[0];assert.equal(tombstone.content_id,deleteContent);assert.equal(tombstone.video_id,null);assert.equal(tombstone.status,"removed");
    const deleteAttrs=(await db.query("select attributed_at from public.marketplace_creator_commerce_attributions where source_entity_id=$1",[deleteTag])).rows;assert(deleteAttrs.length<=1);if(deleteAttrs.length)assert(new Date(deleteAttrs[0].attributed_at)<=new Date(tombstone.removed_at));

    const mutationContent=await video(db,f,f.creatorX,"feed",36);await Promise.all([claim(a,"authenticated",f.creatorX,false),claim(b,"authenticated",f.creatorX,false)]);
    const mutationA=[items[5].product,items[6].product,items[7].product],mutationB=[items[6].product];const mutations=await Promise.allSettled([a.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[mutationContent,mutationA,uid()]),b.query("select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",[mutationContent,mutationB,uid()])]);noDeadlock(mutations);assert(mutations.every((x)=>x.status==="fulfilled"));
    const mutationFinal=await activeProducts(mutationContent);assert([JSON.stringify(mutationA),JSON.stringify(mutationB)].includes(JSON.stringify(mutationFinal.map((x)=>x.product_id))));assert.deepEqual(mutationFinal.map((x)=>x.sort_position),mutationFinal.map((_,i)=>i));
    await reconcile(db,"reconcile_marketplace_creator_content_tags",28);
    return {sameRequestRace:true,competingTagSetRace:true,removeAttributionRace:true,offerReplacementAttributionRace:true,offerRevocationAttributionRace:true,contentDeleteAttributionRace:true,competingMutationRace:true,noDeadlocks:true,noPartialState:true};
  }finally{await Promise.all([a.end(),b.end()]);await cleanup(f);}
}

try{
  await db.connect();
  const authority=await proveAuthority(),handoff=await financial(false),insufficient=await financial(true),races=await concurrency();
  await reconcile(db,"reconcile_marketplace_creator_content_tags",28);await reconcile(db,"reconcile_marketplace_creator_showcase",23);await reconcile(db,"reconcile_marketplace_creator_commerce",36);await reconcile(db,"reconcile_marketplace_multi_creator_allocations",27);await reconcile(db,"reconcile_marketplace_settlement_reversals",32);
  const fixtures=(await db.query("select count(*)::int n from auth.users where email like 'b7c-%@proof.local'or email like'b7cconcurrency-%@proof.local'")).rows[0].n;assert.equal(fixtures,0);
  console.log(JSON.stringify({ok:true,scenarios:{A_to_AE_authority:authority,concurrency:races,cross_surface_financial_handoff:handoff,b7r_insufficient_balance:insufficient,reconciliation_28_of_28_zero:true,persistent_fixtures_zero:true}},null,2));
}catch(error){console.error(JSON.stringify({ok:false,stage,code:error.code??null,message:error.message},null,2));process.exitCode=1;}finally{await db.end().catch(()=>{});}
