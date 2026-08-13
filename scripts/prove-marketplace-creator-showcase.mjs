import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MARKETPLACE_DATABASE_URL;
if (!connectionString) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== "55422") {
  throw new Error("B7B_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}

const db = new Client({ connectionString, ssl: false });
const uid = () => randomUUID();
const money = (value) => Number(value);
let stage = "connect";

async function claim(client, role, sub = "", local = true) {
  await client.query(
    "select set_config('request.jwt.claim.role',$1,$3),set_config('request.jwt.claim.sub',$2,$3)",
    [role, sub, local],
  );
}

async function expectError(client, action, message, code) {
  const savepoint = `b7b_expected_${uid().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  let caught;
  try { await action(); } catch (error) { caught = error; }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  assert(caught, `expected_error_missing:${message}`);
  if (message) assert.equal(caught.message, message, `unexpected_error:${caught.message}`);
  if (code) assert.equal(caught.code, code);
  return caught;
}

async function transactionScenario(name, action) {
  stage = name;
  await db.query("begin");
  try {
    const result = await action();
    await db.query("rollback");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    error.message = `${name}:${error.message}`;
    throw error;
  }
}

async function insertUser(client, id, label, isAdmin = false, prefix = "b7b") {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
    [id, `${prefix}-${label}-${token}@proof.local`],
  );
  await client.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `${prefix}${label}${token}`, `${prefix.toUpperCase()} ${label}`, isAdmin],
  );
}

async function createFixture(client, prefix = "b7b") {
  const fixture = {
    prefix, seller: uid(), buyer: uid(), buyer2: uid(), admin: uid(), creatorX: uid(), creatorY: uid(),
    store: uid(), shippingProfile: uid(), products: [], variants: [], offers: [],
  };
  await insertUser(client, fixture.seller, "seller", false, prefix);
  await insertUser(client, fixture.buyer, "buyer", false, prefix);
  await insertUser(client, fixture.buyer2, "buyer2", false, prefix);
  await insertUser(client, fixture.admin, "admin", true, prefix);
  await insertUser(client, fixture.creatorX, "creatorx", false, prefix);
  await insertUser(client, fixture.creatorY, "creatory", false, prefix);
  await client.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7B Seller',now())", [fixture.seller]);
  await client.query("insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7B Store',$3,'active')", [fixture.store, fixture.seller, `${prefix}-${uid()}`]);
  await client.query(
    `insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7B Ground',1,2,'US','B7B returns')`,
    [fixture.shippingProfile, fixture.seller, fixture.store],
  );
  await client.query("insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)", [fixture.shippingProfile]);
  return fixture;
}

async function addProduct(client, fixture, price, index) {
  const product = uid();
  const variant = uid();
  const sku = `B7B-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(
    `insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id)
     values($1,$2,$3,'Creator showcase proof',$4,'BDAG','physical',40,'active',$5,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$6)`,
    [product, fixture.seller, `B7B Item ${index}`, price, fixture.store, fixture.shippingProfile],
  );
  await client.query(
    `insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,
    [variant, product, fixture.store, fixture.seller, sku, price],
  );
  await client.query("insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,40,0)", [variant]);
  fixture.products.push(product); fixture.variants.push(variant);
  return { product, variant, price };
}

async function createOffer(client, fixture, item, creator, bps, options = {}) {
  await claim(client, "authenticated", fixture.seller, false);
  const scope = creator ? "specific_creator" : "public_creator";
  const creatorId = creator ? fixture[creator] : null;
  const result = (await client.query(
    `select public.upsert_my_live_affiliate_offer($1,$2,$3,$4,$5,$6,$7,$8) value`,
    [item.product, scope, creatorId, bps, options.status ?? "active", options.startsAt ?? null, options.endsAt ?? null, options.key ?? uid()],
  )).rows[0].value;
  fixture.offers.push(result.id);
  return result;
}

async function addShowcase(client, creator, product, key = uid()) {
  await claim(client, "authenticated", creator, false);
  return (await client.query("select public.add_my_marketplace_creator_showcase_product($1,$2) value", [product, key])).rows[0].value;
}

async function showcaseAttribution(client, buyer, item, variant, key = uid()) {
  await claim(client, "authenticated", buyer, false);
  return (await client.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3) value", [item, variant, key])).rows[0].value;
}

async function fundBuyer(client, fixture, amount, buyer = fixture.buyer) {
  await claim(client, "service_role", fixture.admin, false);
  const platform = (await client.query("select public.ensure_marketplace_platform_account() id")).rows[0].id;
  const buyerAccount = (await client.query("select public.ensure_ledger_account($1) id", [buyer])).rows[0].id;
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b7b_proof',$5,$6,$7)`,
    [transaction, platform, buyerAccount, amount, fixture.store, `b7b-fund:${transaction}`, buyer],
  );
  await client.query("select public.ledger_debit($1,$2,$3,'B7B proof funding','{}'),public.ledger_credit($1,$4,$3,'B7B proof funding','{}')", [transaction, platform, amount, buyerAccount]);
  return { platform, buyerAccount };
}

const addressSql = `jsonb_build_object('recipient_name','B7B','line1','Proof Street','city','New York','region','NY','postal_code','10001','country','US')`;
async function reserve(client, fixture, items, buyer = fixture.buyer, key = uid()) {
  await claim(client, "authenticated", buyer, false);
  const payload = items.map((item) => ({ variant_id: item.variant, quantity: item.quantity ?? 1, ...(item.attribution ? { attribution_id: item.attribution } : {}) }));
  const receipt = (await client.query(`select public.create_marketplace_creator_checkout_reservation($1::jsonb,${addressSql},$2)value`, [JSON.stringify(payload), key])).rows[0].value;
  assert.equal(receipt.orders.length, 1, "same_store_order_split");
  return { checkout: receipt.checkout.id, order: receipt.orders[0].id, buyer, receipt };
}

async function pay(client, fixture, commerce) {
  await claim(client, "service_role", fixture.admin, false);
  await client.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [commerce.buyer, commerce.checkout, uid()]);
  return (await client.query("select * from public.marketplace_payment_allocations where order_id=$1", [commerce.order])).rows[0];
}

async function shipAndSettle(client, fixture, commerce) {
  await claim(client, "authenticated", fixture.seller, false);
  await client.query("select public.seller_start_marketplace_order_processing($1,$2)", [commerce.order, uid()]);
  await client.query("select public.seller_ship_marketplace_order($1,'B7B','Ground',$2,null,null,$3)", [commerce.order, `B7B-${uid().slice(0, 8)}`, uid()]);
  await claim(client, "service_role", fixture.admin, false);
  await client.query("select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)", [commerce.buyer, commerce.order, uid()]);
  const settlement = (await client.query("select * from public.marketplace_order_settlements where order_id=$1", [commerce.order])).rows[0];
  const legs = (await client.query("select leg_type,beneficiary_user_id,amount,financial_transaction_id from public.marketplace_settlement_legs where settlement_id=$1 order by leg_type,beneficiary_user_id", [settlement.id])).rows;
  return { settlement, legs };
}

const totals = (legs) => legs.reduce((result, leg) => ({ ...result, [leg.leg_type]: (result[leg.leg_type] ?? 0) + money(leg.amount) }), {});
async function assertReconciliation(client, name, count) {
  await claim(client, "service_role", "", false);
  const value = (await client.query(`select public.${name}() value`)).rows[0].value;
  assert.equal(Object.keys(value).length, count, `${name}_counter_count`);
  for (const [key, result] of Object.entries(value)) assert.equal(Number(result), 0, `${name}:${key}`);
  return value;
}

async function proveAuthorityLifecycle() {
  return transactionScenario("A_to_Y_showcase_authority", async () => {
    const fixture = await createFixture(db);
    const publicItem = await addProduct(db, fixture, 30, 1);
    const specificItem = await addProduct(db, fixture, 40, 2);
    const expiredItem = await addProduct(db, fixture, 20, 3);
    const publicOffer = await createOffer(db, fixture, publicItem, null, 800);
    await createOffer(db, fixture, specificItem, "creatorX", 1200);
    await createOffer(db, fixture, expiredItem, null, 900, { startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-08-02T00:00:00Z" });

    await claim(db, "authenticated", fixture.creatorX);
    const xEligible = (await db.query("select public.get_my_marketplace_creator_eligible_products(null,20,null,null)value")).rows[0].value.items;
    assert.deepEqual(new Set(xEligible.map((item) => item.product_id)), new Set([publicItem.product, specificItem.product]));
    await claim(db, "authenticated", fixture.creatorY);
    const yEligible = (await db.query("select public.get_my_marketplace_creator_eligible_products(null,20,null,null)value")).rows[0].value.items;
    assert.deepEqual(yEligible.map((item) => item.product_id), [publicItem.product]);

    const addKey = uid();
    const first = await addShowcase(db, fixture.creatorX, publicItem.product, addKey);
    const retry = await addShowcase(db, fixture.creatorX, publicItem.product, addKey);
    assert.deepEqual(retry, first);
    await claim(db, "authenticated", fixture.creatorX);
    await expectError(db, () => db.query("select public.add_my_marketplace_creator_showcase_product($1,$2)", [specificItem.product, addKey]), "marketplace_creator_showcase_idempotency_conflict", "23505");
    const second = await addShowcase(db, fixture.creatorX, specificItem.product);
    await claim(db, "authenticated", fixture.creatorX);
    await db.query("select public.reorder_my_marketplace_creator_showcase($1::uuid[],$2)", [[second.id, first.id], uid()]);
    const ordered = (await db.query("select id,sort_position from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active' order by sort_position", [fixture.creatorX])).rows;
    assert.deepEqual(ordered.map((row) => row.id), [second.id, first.id]);

    await claim(db, "authenticated", fixture.creatorY);
    await expectError(db, () => db.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)", [first.id, uid()]), "marketplace_creator_showcase_forbidden", "42501");
    assert.equal((await db.query("select has_table_privilege('authenticated','public.marketplace_creator_showcase_items','INSERT,UPDATE,DELETE') allowed")).rows[0].allowed, false);
    await claim(db, "anon", "");
    await expectError(db, () => db.query("select public.add_my_marketplace_creator_showcase_product($1,$2)", [publicItem.product, uid()]), "marketplace_auth_required", "42501");

    await claim(db, "authenticated", fixture.seller);
    await expectError(db, () => db.query("select public.add_my_marketplace_creator_showcase_product($1,$2)", [publicItem.product, uid()]), "marketplace_creator_showcase_product_ineligible", "22023");

    await claim(db, "authenticated", fixture.buyer);
    const publicPage = (await db.query("select public.get_marketplace_creator_showcase($1,24,null,null)value", [fixture.creatorX])).rows[0].value;
    assert.equal(publicPage.items.length, 2);
    const attributionKey = uid();
    const attribution = await showcaseAttribution(db, fixture.buyer, first.id, publicItem.variant, attributionKey);
    assert.equal(attribution.entitlement_id, publicOffer.id);
    assert.equal(attribution.commission_bps, 800);
    assert.equal(attribution.source_surface, "creator_showcase");
    assert.equal(attribution.source_entity_id, first.id);
    await claim(db, "authenticated", fixture.buyer);
    await expectError(db, () => db.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3)", [first.id, specificItem.variant, uid()]), "marketplace_creator_attribution_variant_mismatch", "23514");
    assert.equal((await db.query("select has_function_privilege('authenticated','public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed, false);

    await claim(db, "authenticated", fixture.creatorX);
    await db.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)", [first.id, uid()]);
    const retryAfterRemoval = await showcaseAttribution(db, fixture.buyer, first.id, publicItem.variant, attributionKey);
    assert.equal(retryAfterRemoval.id, attribution.id);
    await claim(db, "authenticated", fixture.buyer);
    await expectError(db, () => db.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3)", [first.id, publicItem.variant, uid()]), "marketplace_creator_showcase_attribution_unavailable", "22023");
    const afterRemoval = (await db.query("select public.get_marketplace_creator_showcase($1,24,null,null)value", [fixture.creatorX])).rows[0].value;
    assert.deepEqual(afterRemoval.items.map((item) => item.showcase_item_id), [second.id]);
    await assertReconciliation(db, "reconcile_marketplace_creator_showcase", 23);
    return { publicVisible: true, specificPrivate: true, addRemoveReorder: true, idempotent: true, security: true };
  });
}

async function proveShowcaseCapacity() {
  return transactionScenario("B7BC_showcase_capacity", async () => {
    const fixture = await createFixture(db, "b7bc");
    const items = [];
    for (let index = 0; index < 101; index += 1) {
      const item = await addProduct(db, fixture, 10 + index / 100, 1000 + index);
      await createOffer(db, fixture, item, null, 1000);
      items.push(item);
    }

    const receipts = [];
    let hundredthKey;
    for (let index = 0; index < 100; index += 1) {
      const key = uid();
      if (index === 99) hundredthKey = key;
      receipts.push(await addShowcase(db, fixture.creatorX, items[index].product, key));
    }
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active'", [fixture.creatorX])).rows[0].n, 100);

    const hundredthRetry = await addShowcase(db, fixture.creatorX, items[99].product, hundredthKey);
    assert.equal(hundredthRetry.id, receipts[99].id, "hundredth_idempotent_retry_changed");
    const existingWithNewKey = await addShowcase(db, fixture.creatorX, items[99].product, uid());
    assert.equal(existingWithNewKey.id, receipts[99].id, "existing_active_add_changed");

    await claim(db, "authenticated", fixture.creatorX, false);
    await expectError(
      db,
      () => db.query("select public.add_my_marketplace_creator_showcase_product($1,$2)", [items[100].product, uid()]),
      "marketplace_creator_showcase_limit_reached",
      "22023",
    );

    await db.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)", [receipts[0].id, uid()]);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active'", [fixture.creatorX])).rows[0].n, 99);
    const replacement = await addShowcase(db, fixture.creatorX, items[100].product);
    assert(replacement.id);

    const activeIds = (await db.query("select id from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active' order by sort_position,id", [fixture.creatorX])).rows.map((row) => row.id);
    assert.equal(activeIds.length, 100);
    await claim(db, "authenticated", fixture.creatorX, false);
    await db.query("select public.reorder_my_marketplace_creator_showcase($1::uuid[],$2)", [activeIds.toReversed(), uid()]);
    const ordering = (await db.query("select count(*)::int total,count(distinct sort_position)::int positions,min(sort_position)::int minimum,max(sort_position)::int maximum from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active'", [fixture.creatorX])).rows[0];
    assert.deepEqual(ordering, { total: 100, positions: 100, minimum: 0, maximum: 99 });
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='removed'", [fixture.creatorX])).rows[0].n, 1);
    const reconciliation = await assertReconciliation(db, "reconcile_marketplace_creator_showcase", 23);
    assert.equal(reconciliation.active_showcase_over_limit, 0);
    return { allowed: 100, rejected: 101, retry: true, existing: true, removeFreesSlot: true, reordered: 100 };
  });
}

async function proveOfferReplacementAndHistoricalFreeze() {
  return transactionScenario("M_to_S_offer_lifecycle", async () => {
    const fixture = await createFixture(db);
    const item = await addProduct(db, fixture, 100, 1);
    await createOffer(db, fixture, item, "creatorX", 1200);
    const showcase = await addShowcase(db, fixture.creatorX, item.product);
    const oldAttr = await showcaseAttribution(db, fixture.buyer, showcase.id, item.variant);
    await fundBuyer(db, fixture, 100);
    const order = await reserve(db, fixture, [{ ...item, attribution: oldAttr.id }]);
    const allocation = await pay(db, fixture, order);
    assert.equal(money(allocation.creator_commission_amount), 12);
    const offer900 = await createOffer(db, fixture, item, "creatorX", 900);
    const fresh = await showcaseAttribution(db, fixture.buyer2, showcase.id, item.variant);
    assert.equal(fresh.entitlement_id, offer900.id);
    assert.equal(fresh.commission_bps, 900);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where id=$1 and status='active'", [showcase.id])).rows[0].n, 1);
    assert.equal((await db.query("select commission_bps from public.marketplace_order_item_creator_attributions where order_id=$1", [order.order])).rows[0].commission_bps, 1200);
    await claim(db, "authenticated", fixture.seller);
    await db.query("select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,900,'removed',null,null,$3)", [item.product, fixture.creatorX, uid()]);
    await claim(db, "authenticated", fixture.buyer2);
    await expectError(db, () => db.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3)", [showcase.id, item.variant, uid()]), "marketplace_creator_showcase_offer_ineligible", "22023");
    assert.equal(money((await db.query("select creator_commission_amount from public.marketplace_payment_allocations where order_id=$1", [order.order])).rows[0].creator_commission_amount), 12);
    return { oldBps: 1200, replacementBps: 900, historicalAmount: 12, selectionPreserved: true };
  });
}

async function createShowcaseOrder(client, fixture) {
  const itemX = await addProduct(client, fixture, 50, 1);
  const itemY = await addProduct(client, fixture, 50, 2);
  await createOffer(client, fixture, itemX, "creatorX", 1000);
  await createOffer(client, fixture, itemY, "creatorY", 1400);
  const showcaseX = await addShowcase(client, fixture.creatorX, itemX.product);
  const showcaseY = await addShowcase(client, fixture.creatorY, itemY.product);
  const attrX = await showcaseAttribution(client, fixture.buyer, showcaseX.id, itemX.variant);
  const attrY = await showcaseAttribution(client, fixture.buyer, showcaseY.id, itemY.variant);
  const funding = await fundBuyer(client, fixture, 100);
  const commerce = await reserve(client, fixture, [{ ...itemX, attribution: attrX.id }, { ...itemY, attribution: attrY.id }]);
  const allocation = await pay(client, fixture, commerce);
  return { ...commerce, ...funding, allocation, showcaseX, showcaseY, attrX, attrY };
}

async function openReview(client, fixture, commerce) {
  await claim(client, "service_role", fixture.admin, false);
  return (await client.query("select public.open_marketplace_post_settlement_review($1,$2,'b7b_creator_showcase','proof',$3)value", [fixture.admin, commerce.order, uid()])).rows[0].value;
}

async function proveFinancialHandoff(insufficient = false) {
  return transactionScenario(insufficient ? "B7R_insufficient" : "B7B_financial_handoff", async () => {
    const fixture = await createFixture(db);
    const commerce = await createShowcaseOrder(db, fixture);
    assert.equal(money(commerce.allocation.gross_amount), 100);
    assert.equal(money(commerce.allocation.seller_net_amount), 78);
    assert.equal(money(commerce.allocation.platform_fee_amount), 10);
    assert.equal(money(commerce.allocation.creator_commission_amount), 12);
    assert.equal(commerce.allocation.creator_user_id, null);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_commerce_attributions where id=any($1::uuid[])and source_surface='creator_showcase'", [[commerce.attrX.id, commerce.attrY.id]])).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_order_item_creator_attributions where order_id=$1 and source_surface='creator_showcase'", [commerce.order])).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1", [commerce.order])).rows[0].n, 2);
    const released = await shipAndSettle(db, fixture, commerce);
    assert.equal(released.legs.length, 4);
    assert.deepEqual(totals(released.legs), { creator_commission: 12, platform_fee: 10, seller_net: 78 });
    const creatorLegs = released.legs.filter((leg) => leg.leg_type === "creator_commission");
    assert.deepEqual(new Map(creatorLegs.map((leg) => [leg.beneficiary_user_id, money(leg.amount)])), new Map([[fixture.creatorX, 5], [fixture.creatorY, 7]]));
    await assertReconciliation(db, "reconcile_marketplace_creator_showcase", 23);
    await assertReconciliation(db, "reconcile_marketplace_creator_commerce", 36);
    const review = await openReview(db, fixture, commerce);
    if (insufficient) {
      const creatorYAccount = (await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user'and currency='BDAG'", [fixture.creatorY])).rows[0].id;
      const drain = uid();
      await db.query("insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed','marketplace_b7b_proof',$4,$5,$6)", [drain, creatorYAccount, commerce.platform, commerce.order, `b7b-drain:${drain}`, fixture.admin]);
      await db.query("select public.ledger_debit($1,$2,1,'B7B insufficient proof','{}'),public.ledger_credit($1,$3,1,'B7B insufficient proof','{}')", [drain, creatorYAccount, commerce.platform]);
      const before = (await db.query("select id,balance from public.ledger_accounts where owner_id=any($1::uuid[])or id=any($2::uuid[])order by id", [[fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY], [commerce.platform, commerce.buyerAccount]])).rows;
      const result = (await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7b_full_refund','proof',$3,null)value", [fixture.admin, review.dispute_id, uid()])).rows[0].value;
      assert.equal(result.kind, "intermediate_review"); assert.equal(result.money_moved, false);
      const after = (await db.query("select id,balance from public.ledger_accounts where owner_id=any($1::uuid[])or id=any($2::uuid[])order by id", [[fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY], [commerce.platform, commerce.buyerAccount]])).rows;
      assert.deepEqual(after, before);
      assert.equal((await db.query("select count(*)::int n from public.marketplace_settlement_reversals where order_id=$1", [commerce.order])).rows[0].n, 0);
      return { moneyMoved: false, noPartialMovement: true };
    }
    const accountRows = (await db.query("select owner_id,id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'", [[fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY]])).rows;
    const before = new Map(accountRows.map((row) => [row.owner_id, money(row.balance)]));
    const platformBefore = money((await db.query("select balance from public.ledger_accounts where id=$1", [commerce.platform])).rows[0].balance);
    const result = (await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7b_full_refund','proof',$3,null)value", [fixture.admin, review.dispute_id, uid()])).rows[0].value;
    assert.equal(result.kind, "final_resolution"); assert.equal(result.finalDecision.financial_result.money_moved, true);
    const afterRows = (await db.query("select owner_id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'", [[fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY]])).rows;
    const after = new Map(afterRows.map((row) => [row.owner_id, money(row.balance)]));
    assert.equal(before.get(fixture.seller) - after.get(fixture.seller), 78);
    assert.equal(platformBefore - money((await db.query("select balance from public.ledger_accounts where id=$1", [commerce.platform])).rows[0].balance), 10);
    assert.equal(before.get(fixture.creatorX) - after.get(fixture.creatorX), 5);
    assert.equal(before.get(fixture.creatorY) - after.get(fixture.creatorY), 7);
    assert.equal(after.get(fixture.buyer) - before.get(fixture.buyer), 100);
    await assertReconciliation(db, "reconcile_marketplace_settlement_reversals", 32);
    await assertReconciliation(db, "reconcile_marketplace_creator_showcase", 23);
    return { orderCount: 1, settlementLegs: 4, seller: 78, platform: 10, creatorX: 5, creatorY: 7, gross: 100, buyerRefund: 100 };
  });
}

async function cleanupConcurrencyFixture(fixture) {
  await db.query("set session_replication_role=replica");
  try {
    const users = [fixture.seller, fixture.buyer, fixture.buyer2, fixture.admin, fixture.creatorX, fixture.creatorY];
    await db.query("delete from public.marketplace_creator_commerce_attributions where creator_user_id=any($1::uuid[])", [users]);
    await db.query("delete from public.marketplace_creator_showcase_commands where actor_id=any($1::uuid[])", [users]);
    await db.query("delete from public.marketplace_creator_showcase_items where creator_user_id=any($1::uuid[])", [users]);
    await db.query("delete from public.marketplace_live_affiliate_offer_commands where seller_id=$1", [fixture.seller]);
    await db.query("delete from public.marketplace_live_affiliate_offers where seller_id=$1", [fixture.seller]);
    await db.query("delete from public.marketplace_inventory_levels where variant_id=any($1::uuid[])", [fixture.variants]);
    await db.query("delete from public.marketplace_product_variants where id=any($1::uuid[])", [fixture.variants]);
    await db.query("delete from public.products where id=any($1::uuid[])", [fixture.products]);
    await db.query("delete from public.marketplace_shipping_profile_regions where profile_id=$1", [fixture.shippingProfile]);
    await db.query("delete from public.marketplace_shipping_profiles where id=$1", [fixture.shippingProfile]);
    await db.query("delete from public.marketplace_stores where id=$1", [fixture.store]);
    await db.query("delete from public.marketplace_sellers where user_id=$1", [fixture.seller]);
    await db.query("delete from public.user_profiles where id=any($1::uuid[])", [users]);
    await db.query("delete from auth.users where id=any($1::uuid[])", [users]);
  } finally { await db.query("set session_replication_role=origin"); }
}

async function proveConcurrency() {
  stage = "T_to_W_concurrency";
  const fixture = await createFixture(db, "b7bconcurrency");
  const itemA = await addProduct(db, fixture, 20, 1);
  const itemB = await addProduct(db, fixture, 25, 2);
  const itemC = await addProduct(db, fixture, 30, 3);
  stage = "T_to_W_offer_A";
  await createOffer(db, fixture, itemA, "creatorX", 800);
  stage = "T_to_W_offer_B";
  await createOffer(db, fixture, itemB, "creatorX", 900);
  stage = "T_to_W_offer_C";
  await createOffer(db, fixture, itemC, "creatorX", 1000);
  const a = new Client({ connectionString, ssl: false });
  const b = new Client({ connectionString, ssl: false });
  try {
    await Promise.all([a.connect(), b.connect()]);
    await Promise.all([claim(a, "authenticated", fixture.creatorX, false), claim(b, "authenticated", fixture.creatorX, false)]);
    const sameKey = uid();
    const same = await Promise.all([
      a.query("select public.add_my_marketplace_creator_showcase_product($1,$2)value", [itemA.product, sameKey]),
      b.query("select public.add_my_marketplace_creator_showcase_product($1,$2)value", [itemA.product, sameKey]),
    ]);
    assert.equal(same[0].rows[0].value.id, same[1].rows[0].value.id);
    const competing = await Promise.all([
      a.query("select public.add_my_marketplace_creator_showcase_product($1,$2)value", [itemB.product, uid()]),
      b.query("select public.add_my_marketplace_creator_showcase_product($1,$2)value", [itemB.product, uid()]),
    ]);
    assert.equal(competing[0].rows[0].value.id, competing[1].rows[0].value.id);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where creator_user_id=$1 and product_id=$2 and status='active'", [fixture.creatorX, itemB.product])).rows[0].n, 1);

    await Promise.all([claim(a, "authenticated", fixture.creatorX, false), claim(b, "authenticated", fixture.creatorX, false)]);
    const addRemoveRace = await Promise.allSettled([
      a.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)value", [same[0].rows[0].value.id, uid()]),
      b.query("select public.add_my_marketplace_creator_showcase_product($1,$2)value", [itemA.product, uid()]),
    ]);
    assert(addRemoveRace.some((result) => result.status === "fulfilled"));
    assert((await db.query("select count(*)::int n from public.marketplace_creator_showcase_items where creator_user_id=$1 and product_id=$2 and status='active'", [fixture.creatorX, itemA.product])).rows[0].n <= 1);
    await addShowcase(db, fixture.creatorX, itemA.product);
    const activeBeforeReorder = (await db.query("select id from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active' order by sort_position,id", [fixture.creatorX])).rows.map((row) => row.id);
    const reorderRemoveRace = await Promise.allSettled([
      a.query("select public.reorder_my_marketplace_creator_showcase($1::uuid[],$2)value", [activeBeforeReorder.toReversed(), uid()]),
      b.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)value", [competing[0].rows[0].value.id, uid()]),
    ]);
    assert(reorderRemoveRace.some((result) => result.status === "fulfilled"));
    assert.equal((await db.query("select count(*)::int n from(select sort_position from public.marketplace_creator_showcase_items where creator_user_id=$1 and status='active'group by sort_position having count(*)>1)x", [fixture.creatorX])).rows[0].n, 0);

    const removable = await addShowcase(db, fixture.creatorX, itemC.product);
    await Promise.all([claim(a, "authenticated", fixture.creatorX, false), claim(b, "authenticated", fixture.buyer, false)]);
    const removalRace = await Promise.allSettled([
      a.query("select public.remove_my_marketplace_creator_showcase_product($1,$2)value", [removable.id, uid()]),
      b.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3)value", [removable.id, itemC.variant, uid()]),
    ]);
    assert(removalRace.some((result) => result.status === "fulfilled"));
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_commerce_attributions x join public.marketplace_creator_showcase_items s on s.id=x.source_entity_id where s.id=$1 and s.removed_at is not null and x.attributed_at>=s.removed_at", [removable.id])).rows[0].n, 0);

    stage = "T_to_W_revocation_product";
    const revocationItem = await addProduct(db, fixture, 35, 4);
    stage = "T_to_W_revocation_offer";
    await createOffer(db, fixture, revocationItem, "creatorX", 1100);
    const revocationShowcase = await addShowcase(db, fixture.creatorX, revocationItem.product);
    await Promise.all([claim(a, "authenticated", fixture.seller, false), claim(b, "authenticated", fixture.buyer, false)]);
    const revocationRace = await Promise.allSettled([
      a.query("select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,1100,'removed',null,null,$3)value", [revocationItem.product, fixture.creatorX, uid()]),
      b.query("select public.create_marketplace_creator_showcase_attribution($1,$2,$3)value", [revocationShowcase.id, revocationItem.variant, uid()]),
    ]);
    assert(revocationRace.some((result) => result.status === "fulfilled"));
    assert.equal((await db.query("select count(*)::int n from public.marketplace_creator_commerce_attributions x join public.marketplace_live_affiliate_offers o on o.id=x.entitlement_id where x.source_entity_id=$1 and o.status<>'active'and x.entitlement_updated_at_attribution is not distinct from o.updated_at", [revocationShowcase.id])).rows[0].n, 0);
    return { sameRequestRace: true, conflictingAddRace: true, addRemoveRace: true, reorderRemoveRace: true, removeAttributionRace: true, revocationAttributionRace: true };
  } finally {
    await Promise.all([a.end().catch(() => {}), b.end().catch(() => {})]);
    await cleanupConcurrencyFixture(fixture);
    const remaining = (await db.query("select count(*)::int n from auth.users where email like 'b7bconcurrency-%@proof.local'")).rows[0].n;
    assert.equal(remaining, 0, "persistent_concurrency_fixtures");
  }
}

try {
  await db.connect();
  const authority = await proveAuthorityLifecycle();
  const capacity = await proveShowcaseCapacity();
  const lifecycle = await proveOfferReplacementAndHistoricalFreeze();
  const financial = await proveFinancialHandoff(false);
  const insufficient = await proveFinancialHandoff(true);
  const concurrency = await proveConcurrency();
  await assertReconciliation(db, "reconcile_marketplace_creator_showcase", 23);
  await assertReconciliation(db, "reconcile_marketplace_creator_commerce", 36);
  await assertReconciliation(db, "reconcile_marketplace_multi_creator_allocations", 27);
  await assertReconciliation(db, "reconcile_marketplace_settlement_reversals", 32);
  const fixtures = (await db.query("select count(*)::int n from auth.users where email like 'b7b-%@proof.local' or email like 'b7bconcurrency-%@proof.local'")).rows[0].n;
  assert.equal(fixtures, 0, "persistent_fixtures");
  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      A_public_offer_visible: authority.publicVisible,
      B_specific_offer_private: authority.specificPrivate,
      C_to_L_management_security: authority.addRemoveReorder,
      M_to_S_offer_and_removal_lifecycle: lifecycle,
      T_to_W_two_connection_races: concurrency,
      B7BC_capacity: capacity,
      X_reconciliation_23_of_23_zero: true,
      Y_persistent_fixtures_zero: fixtures === 0,
      Z_to_AK_client_assertions: "node_test",
      financial_handoff: financial,
      b7r_insufficient_balance: insufficient,
    },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, stage, code: error.code ?? null, message: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
