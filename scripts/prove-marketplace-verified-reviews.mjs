import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.MARKETPLACE_DATABASE_URL ?? "";
const parsed = (() => { try { return new URL(url); } catch { return null; } })();
if (!parsed || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.port !== "55422") throw new Error("MARKETPLACE_REVIEW_PROOF_REQUIRES_DISPOSABLE_DATABASE");
const { Client } = pg, db = new Client({ connectionString: url }), uid = () => randomUUID();
const ids = { seller: uid(), buyer1: uid(), buyer2: uid(), outsider: uid(), store: uid(), product: uid(), variant: uid(), logo: uid(), foreignLogo: uid(), videoLogo: uid() };
const report = {};
async function operator() { await db.query("reset role"); }
async function claims(role, sub = null) {
  await operator(); await db.query(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)", [role, sub ?? "", JSON.stringify({ role, sub })]);
}
async function expectCode(code, operation) { await db.query("savepoint expected_error"); try { await operation(); assert.fail(`expected_${code}`); } catch (error) { assert.equal(error.code, code); } finally { await db.query("rollback to savepoint expected_error"); await db.query("release savepoint expected_error"); } }
async function addUser(id, label) {
  await operator(); await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())", [id, `review-${label}-${uid()}@proof.local`]);
  await db.query("insert into public.user_profiles(id,username,display_name)values($1,$2,$3)", [id, `review_${label}_${uid().slice(0, 8)}`, `Review ${label}`]);
}
async function purchase(buyerId, number, delivered = true) {
  const checkout = uid(), order = uid(), item = uid();
  await operator();
  await db.query("insert into public.marketplace_checkout_sessions(id,reference,buyer_id,status,currency,subtotal,total,idempotency_key,request_fingerprint,expires_at)values($1,$2,$3,'paid','BDAG',10,10,$4,$5,now()+interval '15 minutes')", [checkout, `CHK-REVIEW-${uid()}`, buyerId, uid(), uid()]);
  await db.query("insert into public.marketplace_checkout_shipping_addresses(checkout_id,recipient_name,line1,city,region,postal_code,country)values($1,'Review Buyer','Proof Street','Proof City','NY','10001','US')", [checkout]);
  await db.query(delivered ? "insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,status,currency,subtotal,total,processing_at,shipped_at,delivered_at,reservation_expires_at)values($1,$2,$3,$4,$5,$6,'delivered','BDAG',10,10,now()-interval '3 days',now()-interval '2 days',now()-interval '1 day',now()+interval '15 minutes')" : "insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,status,currency,subtotal,total,reservation_expires_at)values($1,$2,$3,$4,$5,$6,'confirmed','BDAG',10,10,now()+interval '15 minutes')", [order, `ORD-REVIEW-${number}-${uid()}`, checkout, buyerId, ids.seller, ids.store]);
  await db.query("insert into public.marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,variant_title,sku,option_snapshot,unit_price,quantity,line_total)values($1,$2,$3,$4,$5,$6,$7,'Review product','Default',$8,'[]',10,1,10)", [item, order, checkout, ids.product, ids.variant, ids.seller, ids.store, `REV-${number}-${uid()}`]);
  return { order, item };
}
async function call(name, args) { return (await db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) value`, args)).rows[0].value; }

try {
  await db.connect(); await db.query("begin");
  for (const [id, label] of [[ids.seller, "seller"], [ids.buyer1, "buyer1"], [ids.buyer2, "buyer2"], [ids.outsider, "outsider"]]) await addUser(id, label);
  await operator();
  await db.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Verified seller',now())", [ids.seller]);
  await db.query("insert into public.marketplace_stores(id,seller_id,name,slug,description,status)values($1,$2,'Verified store',$3,'Real store','active')", [ids.store, ids.seller, `verified-${uid()}`]);
  await db.query("insert into public.products(id,seller_id,store_id,category_id,title,description,price,currency,category,stock,status,product_type,moderation_status,published_at,images)values($1,$2,$3,'10000000-0000-4000-8000-000000000002','Verified product','',10,'BDAG','digital',10,'active','digital','approved',now(),array[]::text[])", [ids.product, ids.seller, ids.store]);
  const sku = `REV-${uid()}`.toUpperCase();
  await db.query("insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',10,'active',true,'')", [ids.variant, ids.product, ids.store, ids.seller, sku]);
  await db.query("insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,status,ready_at,public_url)values($1,$2,'r2','image','store_logo','public','proof',$3,'image/png',1024,'ready',now(),$4),($5,$6,'r2','image','store_logo','public','proof',$7,'image/png',1024,'ready',now(),$8),($9,$2,'r2','video','store_logo','public','proof',$10,'video/mp4',1024,'ready',now(),$11)", [ids.logo, ids.seller, `logo/${uid()}`, `https://proof.invalid/${ids.logo}.png`, ids.foreignLogo, ids.outsider, `logo/${uid()}`, `https://proof.invalid/${ids.foreignLogo}.png`, ids.videoLogo, `logo/${uid()}`, `https://proof.invalid/${ids.videoLogo}.mp4`]);
  await claims("authenticated", ids.seller);
  await call("set_marketplace_store_media", [ids.store, ids.logo, null]);
  assert.equal((await db.query("select logo_asset_id from public.marketplace_stores where id=$1", [ids.store])).rows[0].logo_asset_id, ids.logo);
  await expectCode("42501", () => call("set_marketplace_store_media", [ids.store, ids.foreignLogo, null]));
  await expectCode("42501", () => call("set_marketplace_store_media", [ids.store, ids.videoLogo, null]));
  report.branding = { own_logo_bound: true, foreign_asset_denied: true, non_image_denied: true };
  const first = await purchase(ids.buyer1, 1), second = await purchase(ids.buyer2, 2), self = await purchase(ids.seller, 3), undelivered = await purchase(ids.buyer1, 4, false);

  await claims("anon"); await expectCode("42501", () => call("submit_my_marketplace_product_review", [first.item, 5, "great"]));
  await claims("authenticated", ids.outsider); await expectCode("42501", () => call("submit_my_marketplace_product_review", [first.item, 5, "not mine"]));
  await claims("authenticated", ids.seller); await expectCode("42501", () => call("submit_my_marketplace_product_review", [self.item, 5, "self"]));
  await claims("authenticated", ids.buyer1);
  for (const rating of [0, 6]) await expectCode("22023", () => call("submit_my_marketplace_product_review", [first.item, rating, "bad"]));
  await expectCode("22023", () => call("submit_my_marketplace_product_review", [undelivered.item, 5, "too early"]));
  await expectCode("42883", () => db.query("select public.submit_my_marketplace_product_review($1,1.5::numeric,'decimal')", [first.item]));
  await expectCode("22023", () => call("submit_my_marketplace_product_review", [first.item, 5, "x".repeat(1001)]));
  const productReceipt = await call("submit_my_marketplace_product_review", [first.item, 5, " Excelente "]);
  const sellerReceipt = await call("submit_my_marketplace_seller_review", [first.order, 4, "Entrega correcta"]);
  assert.equal(productReceipt.rating, 5); assert.equal(productReceipt.comment, "Excelente"); assert.equal(productReceipt.verified_purchase, true);
  assert.equal(sellerReceipt.rating, 4); assert.equal(sellerReceipt.verified_purchase, true);
  const updated = await call("submit_my_marketplace_product_review", [first.item, 4, "Actualizada"]);
  assert.equal(updated.id, productReceipt.id); assert.equal(updated.rating, 4);
  await claims("authenticated", ids.buyer2);
  await call("submit_my_marketplace_product_review", [second.item, 2, "Segunda"]);
  await call("submit_my_marketplace_seller_review", [second.order, 5, null]);

  await claims("anon");
  const reputation = await call("get_marketplace_product_reputation", [ids.product]);
  assert.equal(reputation.product_aggregate.review_count, 2); assert.equal(Number(reputation.product_aggregate.average_rating), 3); assert.equal(reputation.product_aggregate.distribution[2], 1); assert.equal(reputation.product_aggregate.distribution[4], 1);
  assert.equal(reputation.seller_aggregate.review_count, 2); assert.equal(Number(reputation.seller_aggregate.average_rating), 4.5);
  assert.equal(reputation.product_eligibility.eligible, false); assert.equal(reputation.product_eligibility.order_item_id, null);
  const page1 = await call("search_marketplace_product_reviews", [ids.product, null, null, 1]);
  assert.equal(page1.page_size, 1); assert.ok(page1.next_cursor); assert.deepEqual(Object.keys(page1.items[0]).sort(), ["comment", "created_at", "id", "rating", "reviewer", "updated_at", "verified_purchase"].sort());
  assert.deepEqual(Object.keys(page1.items[0].reviewer).sort(), ["avatar_url", "display_name", "username"].sort());
  const page2 = await call("search_marketplace_product_reviews", [ids.product, page1.next_cursor.created_at, page1.next_cursor.id, 1]);
  assert.equal(page2.page_size, 1); assert.equal(page2.next_cursor, null); assert.notEqual(page1.items[0].id, page2.items[0].id);
  for (const limit of [null, 0, 51]) await expectCode("22023", () => call("search_marketplace_product_reviews", [ids.product, null, null, limit]));
  await operator(); report.reconciliation = await call("reconcile_marketplace_reviews", []);
  assert.ok(Object.values(report.reconciliation).every((value) => Number(value) === 0));
  report.review_counts = { product: 2, seller: 2 }; report.pagination = "keyset 1+1; no duplicate; terminal null"; report.privacy = "public reviewer fields only";
  await db.query("rollback");
  const residue = await db.query("select(select count(*)from public.marketplace_product_reviews where product_id=$1)+(select count(*)from public.marketplace_seller_reviews where store_id=$2) n", [ids.product, ids.store]);
  assert.equal(Number(residue.rows[0].n), 0); report.fixture_residue = 0;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { try { await db.query("rollback"); } catch {} throw error; }
finally { await db.end(); }
