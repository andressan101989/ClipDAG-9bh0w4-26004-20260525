import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MARKETPLACE_DATABASE_URL;
if (!connectionString) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(connectionString);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "55422"
) {
  throw new Error("B7F_PROOF_REQUIRES_DISPOSABLE_DATABASE");
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

async function expectDbError(client, action, message, sqlstate) {
  const savepoint = `b7f_expected_${uid().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  assert(caught, `expected_error_missing:${message}`);
  assert.equal(caught.message, message, `unexpected_error:${caught.message}`);
  if (sqlstate) assert.equal(caught.code, sqlstate);
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

async function insertUser(client, id, label, isAdmin = false) {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
    [id, `b7f-${label}-${token}@proof.local`],
  );
  await client.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b7f${label}${token}`, `B7F ${label}`, isAdmin],
  );
}

async function createCommerceFixture(client) {
  const fixture = {
    seller: uid(),
    buyer: uid(),
    admin: uid(),
    creatorX: uid(),
    creatorY: uid(),
    store: uid(),
    shippingProfile: uid(),
    products: [],
    variants: [],
  };
  await insertUser(client, fixture.seller, "seller");
  await insertUser(client, fixture.buyer, "buyer");
  await insertUser(client, fixture.admin, "admin", true);
  await insertUser(client, fixture.creatorX, "creatorx");
  await insertUser(client, fixture.creatorY, "creatory");
  await client.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7F Seller',now())",
    [fixture.seller],
  );
  await client.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7F Store',$3,'active')",
    [fixture.store, fixture.seller, `b7f-${uid()}`],
  );
  await client.query(
    `insert into public.marketplace_shipping_profiles(
       id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7F Ground',1,2,'US','B7F returns')`,
    [fixture.shippingProfile, fixture.seller, fixture.store],
  );
  await client.query(
    `insert into public.marketplace_shipping_profile_regions(
       profile_id,country_code,shipping_price,transit_days_min,transit_days_max)
     values($1,'US',0,1,2)`,
    [fixture.shippingProfile],
  );
  return fixture;
}

async function addVariant(client, fixture, price, index) {
  const product = uid();
  const variant = uid();
  const sku = `B7F-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(
    `insert into public.products(
       id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,
       product_type,moderation_status,published_at,shipping_profile_id)
     values($1,$2,$3,'Multi-creator financial proof',$4,'BDAG','physical',30,'active',$5,
       '10000000-0000-4000-8000-000000000002','physical','approved',now(),$6)`,
    [product, fixture.seller, `B7F Item ${index}`, price, fixture.store, fixture.shippingProfile],
  );
  await client.query(
    `insert into public.marketplace_product_variants(
       id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,
    [variant, product, fixture.store, fixture.seller, sku, price],
  );
  await client.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,30,0)",
    [variant],
  );
  fixture.products.push(product);
  fixture.variants.push(variant);
  return { product, variant, price };
}

async function fundBuyer(client, fixture, amount) {
  await claim(client, "service_role", fixture.admin);
  const platform = (
    await client.query("select public.ensure_marketplace_platform_account() id")
  ).rows[0].id;
  const buyerAccount = (
    await client.query("select public.ensure_ledger_account($1) id", [fixture.buyer])
  ).rows[0].id;
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
       reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b7f_proof',$5,$6,$7)`,
    [transaction, platform, buyerAccount, amount, fixture.store, `b7f-fund:${transaction}`, fixture.buyer],
  );
  await client.query(
    "select public.ledger_debit($1,$2,$3,'B7F proof funding','{}'),public.ledger_credit($1,$4,$3,'B7F proof funding','{}')",
    [transaction, platform, amount, buyerAccount],
  );
  return { platform, buyerAccount, transaction };
}

async function createPaidOrder(client, fixture, prices) {
  const variants = [];
  for (const [index, price] of prices.entries()) {
    variants.push(await addVariant(client, fixture, price, index));
  }
  const total = prices.reduce((sum, value) => sum + value, 0);
  const funding = await fundBuyer(client, fixture, total);
  await claim(client, "authenticated", fixture.buyer);
  const reservation = (
    await client.query(
      `select public.create_marketplace_checkout_reservation(
        $1::jsonb,jsonb_build_object('recipient_name','B7F','line1','Proof','city','New York',
          'region','NY','postal_code','10001','country','US'),$2) value`,
      [
        JSON.stringify(
          variants.map(({ variant }) => ({ variant_id: variant, quantity: 1 })),
        ),
        uid(),
      ],
    )
  ).rows[0].value;
  const order = reservation.orders[0].id;
  const checkout = reservation.checkout.id;
  await claim(client, "service_role", fixture.admin);
  await client.query(
    "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
    [fixture.buyer, checkout, uid()],
  );
  const items = (
    await client.query(
      "select id,variant_id,line_total from public.marketplace_order_items where order_id=$1 order by variant_id",
      [order],
    )
  ).rows;
  const itemByVariant = new Map(items.map((item) => [item.variant_id, item]));
  return {
    order,
    checkout,
    items: variants.map(({ variant }) => itemByVariant.get(variant)),
    total,
    ...funding,
  };
}

async function applyAllocations(client, fixture, commerce, specifications, key = uid()) {
  await claim(client, "service_role", fixture.admin);
  const allocations = specifications.map(({ itemIndex, creator, bps }) => ({
    order_item_id: commerce.items[itemIndex].id,
    creator_user_id: fixture[creator],
    commission_bps: bps,
  }));
  const receipt = (
    await client.query(
      "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value",
      [commerce.order, JSON.stringify(allocations), key],
    )
  ).rows[0].value;
  return { receipt, allocations, key };
}

async function shipOrder(client, fixture, commerce) {
  await claim(client, "authenticated", fixture.seller);
  await client.query(
    "select public.seller_start_marketplace_order_processing($1,$2)",
    [commerce.order, uid()],
  );
  await client.query(
    "select public.seller_ship_marketplace_order($1,'B7F','Ground',$2,null,null,$3)",
    [commerce.order, `B7F-${uid().slice(0, 8)}`, uid()],
  );
}

async function settleOrder(client, fixture, commerce) {
  await shipOrder(client, fixture, commerce);
  await claim(client, "service_role", fixture.admin);
  const receipt = (
    await client.query(
      "select public.confirm_marketplace_order_delivery_and_release($1,$2,$3) value",
      [fixture.buyer, commerce.order, uid()],
    )
  ).rows[0].value;
  const settlement = (
    await client.query(
      "select * from public.marketplace_order_settlements where order_id=$1",
      [commerce.order],
    )
  ).rows[0];
  const legs = (
    await client.query(
      "select leg_type,beneficiary_user_id,amount,financial_transaction_id from public.marketplace_settlement_legs where settlement_id=$1 order by leg_type,beneficiary_user_id",
      [settlement.id],
    )
  ).rows;
  return { receipt, settlement, legs };
}

function assertParent(receipt, expected) {
  assert.equal(money(receipt.gross_amount), expected.gross);
  assert.equal(money(receipt.platform_fee_amount), expected.platform);
  assert.equal(money(receipt.creator_commission_amount), expected.creator);
  assert.equal(money(receipt.seller_net_amount), expected.seller);
}

function legTotals(legs) {
  return legs.reduce((totals, leg) => {
    totals[leg.leg_type] = (totals[leg.leg_type] ?? 0) + money(leg.amount);
    return totals;
  }, {});
}

async function proveEconomicScenarios() {
  const zeroCreator = await transactionScenario("A_zero_creator", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [100]);
    const released = await settleOrder(db, fixture, commerce);
    const totals = legTotals(released.legs);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1",
          [commerce.order],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(money(released.settlement.creator_commission_amount), 0);
    assert.equal(released.settlement.creator_user_id, null);
    assert.equal(totals.seller_net, 90);
    assert.equal(totals.platform_fee, 10);
    assert.equal(totals.creator_commission ?? 0, 0);
    return true;
  });

  const oneCreator = await transactionScenario("B_one_creator", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [100]);
    const applied = await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1200 },
    ]);
    assertParent(applied.receipt, { gross: 100, platform: 10, creator: 12, seller: 78 });
    assert.equal(applied.receipt.creator_user_id, fixture.creatorX);
    assert.equal(applied.receipt.allocations.length, 1);
    assert.equal(money(applied.receipt.allocations[0].commission_base_amount), 100);
    assert.equal(money(applied.receipt.allocations[0].commission_amount), 12);
    const released = await settleOrder(db, fixture, commerce);
    const totals = legTotals(released.legs);
    assert.deepEqual(totals, { creator_commission: 12, platform_fee: 10, seller_net: 78 });
    assert.equal(
      released.legs.find((leg) => leg.leg_type === "creator_commission")
        .beneficiary_user_id,
      fixture.creatorX,
    );
    return true;
  });

  const twoCreators = await transactionScenario("C_two_creators", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [50, 50]);
    const applied = await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 1, creator: "creatorY", bps: 1400 },
    ]);
    assertParent(applied.receipt, { gross: 100, platform: 10, creator: 12, seller: 78 });
    assert.equal(applied.receipt.creator_user_id, null);
    assert.deepEqual(
      applied.receipt.allocations.map((row) => money(row.commission_amount)).sort((a, b) => a - b),
      [5, 7],
    );
    const released = await settleOrder(db, fixture, commerce);
    const totals = legTotals(released.legs);
    assert.deepEqual(totals, { creator_commission: 12, platform_fee: 10, seller_net: 78 });
    const creators = released.legs.filter((leg) => leg.leg_type === "creator_commission");
    assert.equal(creators.length, 2);
    assert.deepEqual(
      new Map(creators.map((leg) => [leg.beneficiary_user_id, money(leg.amount)])),
      new Map([
        [fixture.creatorX, 5],
        [fixture.creatorY, 7],
      ]),
    );
    return { fixture, commerce, released };
  });

  const sameCreator = await transactionScenario("D_same_creator_multiple_items", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [40, 60]);
    const applied = await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 1, creator: "creatorX", bps: 1000 },
    ]);
    assertParent(applied.receipt, { gross: 100, platform: 10, creator: 10, seller: 80 });
    assert.equal(applied.receipt.creator_user_id, fixture.creatorX);
    assert.deepEqual(
      applied.receipt.allocations.map((row) => money(row.commission_amount)).sort((a, b) => a - b),
      [4, 6],
    );
    const released = await settleOrder(db, fixture, commerce);
    const creators = released.legs.filter((leg) => leg.leg_type === "creator_commission");
    assert.equal(creators.length, 1);
    assert.equal(creators[0].beneficiary_user_id, fixture.creatorX);
    assert.equal(money(creators[0].amount), 10);
    return true;
  });

  const mixed = await transactionScenario("E_mixed_attribution", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [40, 30, 30]);
    const applied = await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 2, creator: "creatorY", bps: 2000 },
    ]);
    assertParent(applied.receipt, { gross: 100, platform: 10, creator: 10, seller: 80 });
    assert.equal(applied.receipt.allocations.length, 2);
    assert(
      !applied.receipt.allocations.some(
        (row) => row.order_item_id === commerce.items[1].id,
      ),
    );
    const released = await settleOrder(db, fixture, commerce);
    assert.deepEqual(legTotals(released.legs), {
      creator_commission: 10,
      platform_fee: 10,
      seller_net: 80,
    });
    return true;
  });

  const legacyEquivalence = await transactionScenario(
    "F_legacy_single_creator_equivalence",
    async () => {
      const fixture = await createCommerceFixture(db);
      const commerce = await createPaidOrder(db, fixture, [0.00000015, 0.00000015, 0.00000015]);
      const before = (
        await db.query(
          "select gross_amount,platform_fee_amount,seller_net_amount from public.marketplace_payment_allocations where order_id=$1",
          [commerce.order],
        )
      ).rows[0];
      const expectedCreator = money(
        (
          await db.query("select round(sum(line_total)*1000/10000.0,8) n from public.marketplace_order_items where order_id=$1", [commerce.order])
        ).rows[0].n,
      );
      const applied = await applyAllocations(
        db,
        fixture,
        commerce,
        commerce.items.map((_, itemIndex) => ({ itemIndex, creator: "creatorX", bps: 1000 })),
      );
      assert.equal(expectedCreator, 0.00000005);
      assert.equal(money(applied.receipt.creator_commission_amount), expectedCreator);
      assert.equal(
        applied.receipt.allocations.reduce((sum, row) => sum + money(row.commission_amount), 0),
        expectedCreator,
      );
      assert.equal(money(applied.receipt.gross_amount), money(before.gross_amount));
      assert.equal(money(applied.receipt.platform_fee_amount), money(before.platform_fee_amount));
      assert.equal(
        money(applied.receipt.seller_net_amount) + expectedCreator,
        money(before.seller_net_amount),
      );
      const released = await settleOrder(db, fixture, commerce);
      assert.equal(money(released.settlement.creator_commission_amount), expectedCreator);
      assert.equal(
        released.legs
          .filter((leg) => leg.leg_type === "creator_commission")
          .reduce((sum, leg) => sum + money(leg.amount), 0),
        expectedCreator,
      );
      return { exact: true, residual: true };
    },
  );

  return { zeroCreator, oneCreator, twoCreators: Boolean(twoCreators), sameCreator, mixed, legacyEquivalence };
}

async function proveIdentityAndSecurity() {
  return transactionScenario("G_to_N_identity_security", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [50, 50]);
    const key = uid();
    const first = await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 1, creator: "creatorY", bps: 1400 },
    ], key);
    const rowCount = first.receipt.allocations.length;
    const retry = (
      await db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value",
        [commerce.order, JSON.stringify(first.allocations), key],
      )
    ).rows[0].value;
    assert.deepEqual(retry, first.receipt);
    assert.equal(retry.allocations.length, rowCount);
    const changedBps = structuredClone(first.allocations);
    changedBps[0].commission_bps = 1100;
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [commerce.order, JSON.stringify(changedBps), key],
      ),
      "marketplace_creator_allocation_idempotency_conflict",
      "23505",
    );
    const changedCreator = structuredClone(first.allocations);
    changedCreator[0].creator_user_id = fixture.creatorY;
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [commerce.order, JSON.stringify(changedCreator), key],
      ),
      "marketplace_creator_allocation_idempotency_conflict",
      "23505",
    );
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [commerce.order, JSON.stringify(first.allocations), uid()],
      ),
      "marketplace_creator_allocation_already_frozen",
      "23505",
    );

    const duplicateFixture = await createCommerceFixture(db);
    const duplicateOrder = await createPaidOrder(db, duplicateFixture, [100]);
    const duplicate = [
      { order_item_id: duplicateOrder.items[0].id, creator_user_id: duplicateFixture.creatorX, commission_bps: 1000 },
      { order_item_id: duplicateOrder.items[0].id, creator_user_id: duplicateFixture.creatorY, commission_bps: 1000 },
    ];
    await claim(db, "service_role", duplicateFixture.admin);
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [duplicateOrder.order, JSON.stringify(duplicate), uid()],
      ),
      "marketplace_creator_allocation_duplicate_item",
      "23505",
    );

    const otherOrder = await createPaidOrder(db, duplicateFixture, [100]);
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [otherOrder.order, JSON.stringify([{
          order_item_id: otherOrder.items[0].id,
          creator_user_id: duplicateFixture.creatorX,
          commission_bps: 1000,
        }]), key],
      ),
      "marketplace_creator_allocation_idempotency_conflict",
      "23505",
    );
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [duplicateOrder.order, JSON.stringify([{
          order_item_id: otherOrder.items[0].id,
          creator_user_id: duplicateFixture.creatorX,
          commission_bps: 1000,
        }]), uid()],
      ),
      "marketplace_creator_allocation_item_mismatch",
      "23514",
    );

    const settlementFixture = await createCommerceFixture(db);
    const settledOrder = await createPaidOrder(db, settlementFixture, [100]);
    await settleOrder(db, settlementFixture, settledOrder);
    await claim(db, "service_role", settlementFixture.admin);
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [settledOrder.order, JSON.stringify([{
          order_item_id: settledOrder.items[0].id,
          creator_user_id: settlementFixture.creatorX,
          commission_bps: 1000,
        }]), uid()],
      ),
      "marketplace_creator_allocation_after_settlement",
      "22023",
    );

    const refundFixture = await createCommerceFixture(db);
    const refundedOrder = await createPaidOrder(db, refundFixture, [100]);
    await shipOrder(db, refundFixture, refundedOrder);
    await claim(db, "authenticated", refundFixture.buyer);
    await db.query(
      "select public.report_marketplace_order_problem($1,'other','B7F refund freeze',$2)",
      [refundedOrder.order, uid()],
    );
    const dispute = (
      await db.query("select id from public.marketplace_order_disputes where order_id=$1", [refundedOrder.order])
    ).rows[0].id;
    await claim(db, "service_role", refundFixture.admin);
    await db.query(
      "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7f_held_refund','proof',$3,null)",
      [refundFixture.admin, dispute, uid()],
    );
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [refundedOrder.order, JSON.stringify([{
          order_item_id: refundedOrder.items[0].id,
          creator_user_id: refundFixture.creatorX,
          commission_bps: 1000,
        }]), uid()],
      ),
      "marketplace_creator_allocation_after_refund",
      "22023",
    );

    const securityFixture = await createCommerceFixture(db);
    const securityOrder = await createPaidOrder(db, securityFixture, [100]);
    const securityInput = [{
      order_item_id: securityOrder.items[0].id,
      creator_user_id: securityFixture.creatorX,
      commission_bps: 1000,
    }];
    await claim(db, "authenticated", securityFixture.admin);
    await expectDbError(
      db,
      () => db.query(
        "select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3)",
        [securityOrder.order, JSON.stringify(securityInput), uid()],
      ),
      "marketplace_creator_allocation_service_role_required",
      "42501",
    );
    await claim(db, "service_role", securityFixture.admin);
    await expectDbError(
      db,
      async () => {
        await db.query("set local role authenticated");
        await db.query(
          `insert into public.marketplace_order_item_creator_allocations(
            id,checkout_id,order_id,order_item_id,payment_id,payment_allocation_id,seller_id,store_id,
            creator_user_id,commission_bps,commission_base_amount,commission_amount,idempotency_key,request_fingerprint)
           select $1,o.checkout_id,o.id,i.id,p.id,a.id,o.seller_id,o.store_id,$2,1000,i.line_total,
             round(i.line_total*.1,8),$3,$4 from public.marketplace_orders o
             join public.marketplace_order_items i on i.order_id=o.id
             join public.marketplace_payments p on p.checkout_id=o.checkout_id
             join public.marketplace_payment_allocations a on a.order_id=o.id where o.id=$5`,
          [uid(), securityFixture.creatorX, uid(), "a".repeat(64), securityOrder.order],
        );
      },
      "permission denied for table marketplace_order_item_creator_allocations",
      "42501",
    );
    return {
      idempotentRetry: true,
      idempotencyConflict: true,
      duplicateItem: true,
      crossOrder: true,
      afterSettlement: true,
      afterRefund: true,
      authenticatedDenied: true,
      rawWriteDenied: true,
    };
  });
}

async function createCommittedAllocationFixture(prices) {
  await db.query("begin");
  try {
    const fixture = await createCommerceFixture(db);
    const variants = [];
    for (const [index, price] of prices.entries()) {
      variants.push(await addVariant(db, fixture, price, index));
    }
    const checkout = uid();
    const order = uid();
    const payment = uid();
    const allocation = uid();
    const capture = uid();
    const total = prices.reduce((sum, value) => sum + value, 0);
    const platformFee = Number((total * 0.1).toFixed(8));
    await db.query(
      `insert into public.marketplace_checkout_sessions(
        id,reference,buyer_id,status,subtotal,total,idempotency_key,request_fingerprint,expires_at)
       values($1,$2,$3,'paid',$4,$4,$5,$6,now()+interval '1 hour')`,
      [checkout, `B7F-RACE-${uid()}`, fixture.buyer, total, uid(), "c".repeat(64)],
    );
    await db.query(
      `insert into public.marketplace_orders(
        id,order_number,checkout_id,buyer_id,seller_id,store_id,status,subtotal,total,reservation_expires_at,confirmed_at)
       values($1,$2,$3,$4,$5,$6,'confirmed',$7,$7,now()+interval '1 hour',now())`,
      [order, `B7F-RACE-${uid()}`, checkout, fixture.buyer, fixture.seller, fixture.store, total],
    );
    await db.query("set local session_replication_role=replica");
    const items = [];
    for (const [index, variant] of variants.entries()) {
      const item = uid();
      items.push(item);
      await db.query(
        `insert into public.marketplace_order_items(
          id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,
          variant_title,sku,option_snapshot,unit_price,quantity,line_total)
         values($1,$2,$3,$4,$5,$6,$7,$8,'Default',$9,'[]',$10,1,$10)`,
        [item, order, checkout, variant.product, variant.variant, fixture.seller,
          fixture.store, `B7F Race ${index}`, `RACE-${uid()}`, variant.price],
      );
    }
    await db.query("set local session_replication_role=origin");
    await claim(db, "service_role", fixture.admin);
    const buyerAccount = (
      await db.query("select public.ensure_ledger_account($1) id", [fixture.buyer])
    ).rows[0].id;
    const escrow = (
      await db.query("select public.ensure_marketplace_escrow_account() id")
    ).rows[0].id;
    await db.query(
      `insert into public.financial_transactions(
        id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
        reference_type,reference_id,idempotency_key,initiated_by)
       values($1,$2,$3,'marketplace_payment_capture',$4,0,'BDAG','completed',
        'marketplace_checkout',$5,$6,$7)`,
      [capture, buyerAccount, escrow, total, checkout, `b7f-race:${capture}`, fixture.buyer],
    );
    await db.query(
      `insert into public.marketplace_payments(
        id,checkout_id,buyer_id,gross_amount,escrow_amount,fee_bps,financial_transaction_id,
        idempotency_key,request_fingerprint,paid_at)
       values($1,$2,$3,$4,$4,1000,$5,$6,$7,now())`,
      [payment, checkout, fixture.buyer, total, capture, uid(), "d".repeat(64)],
    );
    await db.query(
      `insert into public.marketplace_payment_allocations(
        id,payment_id,checkout_id,order_id,seller_id,store_id,gross_amount,
        platform_fee_amount,seller_net_amount,fee_bps)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,1000)`,
      [allocation, payment, checkout, order, fixture.seller, fixture.store,
        total, platformFee, total - platformFee],
    );
    await db.query("commit");
    return { fixture, checkout, order, payment, allocation, capture, buyerAccount, items, total };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function cleanupCommittedAllocationFixtures(setups) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role=replica");
    for (const setup of setups) {
      const users = [setup.fixture.seller, setup.fixture.buyer, setup.fixture.admin,
        setup.fixture.creatorX, setup.fixture.creatorY];
      await db.query("delete from public.marketplace_order_item_creator_allocations where order_id=$1", [setup.order]);
      await db.query("delete from public.marketplace_payment_allocations where id=$1", [setup.allocation]);
      await db.query("delete from public.marketplace_payments where id=$1", [setup.payment]);
      await db.query("delete from public.financial_transactions where id=$1", [setup.capture]);
      await db.query("delete from public.marketplace_order_items where order_id=$1", [setup.order]);
      await db.query("delete from public.marketplace_orders where id=$1", [setup.order]);
      await db.query("delete from public.marketplace_checkout_sessions where id=$1", [setup.checkout]);
      await db.query("delete from public.marketplace_inventory_levels where variant_id=any($1::uuid[])", [setup.fixture.variants]);
      await db.query("delete from public.marketplace_product_variants where id=any($1::uuid[])", [setup.fixture.variants]);
      await db.query("delete from public.products where id=any($1::uuid[])", [setup.fixture.products]);
      await db.query("delete from public.marketplace_shipping_profile_regions where profile_id=$1", [setup.fixture.shippingProfile]);
      await db.query("delete from public.marketplace_shipping_profiles where id=$1", [setup.fixture.shippingProfile]);
      await db.query("delete from public.marketplace_stores where id=$1", [setup.fixture.store]);
      await db.query("delete from public.marketplace_sellers where user_id=$1", [setup.fixture.seller]);
      await db.query("delete from public.ledger_accounts where owner_id=any($1::uuid[])", [users]);
      await db.query("delete from public.user_profiles where id=any($1::uuid[])", [users]);
      await db.query("delete from auth.users where id=any($1::uuid[])", [users]);
    }
    await db.query("set local session_replication_role=origin");
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function proveConcurrency() {
  stage = "O_P_two_connection_concurrency";
  const before = (
    await db.query("select count(*)::int n from public.user_profiles where username like 'b7f%'")
  ).rows[0].n;
  const same = await createCommittedAllocationFixture([100]);
  const overlap = await createCommittedAllocationFixture([50, 50]);
  const first = new Client({ connectionString, ssl: false });
  const second = new Client({ connectionString, ssl: false });
  try {
    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([
      claim(first, "service_role", same.fixture.admin, false),
      claim(second, "service_role", same.fixture.admin, false),
    ]);
    const sameKey = uid();
    const sameRequest = JSON.stringify([{
      order_item_id: same.items[0],
      creator_user_id: same.fixture.creatorX,
      commission_bps: 1000,
    }]);
    const sameResults = await Promise.allSettled([
      first.query("select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value", [same.order, sameRequest, sameKey]),
      second.query("select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value", [same.order, sameRequest, sameKey]),
    ]);
    assert(sameResults.every((result) => result.status === "fulfilled"), JSON.stringify(sameResults));
    assert.deepEqual(sameResults[0].value.rows[0].value, sameResults[1].value.rows[0].value);
    assert.equal(
      (await db.query("select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1", [same.order])).rows[0].n,
      1,
    );

    const allItems = JSON.stringify(overlap.items.map((item, index) => ({
      order_item_id: item,
      creator_user_id: index === 0 ? overlap.fixture.creatorX : overlap.fixture.creatorY,
      commission_bps: index === 0 ? 1000 : 1400,
    })));
    const overlappingItem = JSON.stringify([{
      order_item_id: overlap.items[1],
      creator_user_id: overlap.fixture.creatorX,
      commission_bps: 1000,
    }]);
    const conflictResults = await Promise.allSettled([
      first.query("select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value", [overlap.order, allItems, uid()]),
      second.query("select public.apply_marketplace_order_item_creator_allocations($1,$2::jsonb,$3) value", [overlap.order, overlappingItem, uid()]),
    ]);
    assert.equal(conflictResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(conflictResults.filter((result) => result.status === "rejected").length, 1);
    const aggregate = (
      await db.query(
        `select count(*)::int rows,count(distinct order_item_id)::int distinct_items,
          round(sum(commission_amount),8) total,
          (select creator_commission_amount from public.marketplace_payment_allocations where id=$1) parent
         from public.marketplace_order_item_creator_allocations where order_id=$2`,
        [overlap.allocation, overlap.order],
      )
    ).rows[0];
    assert.equal(aggregate.rows, aggregate.distinct_items);
    assert.equal(money(aggregate.total), money(aggregate.parent));
  } finally {
    await Promise.all([first.end().catch(() => {}), second.end().catch(() => {})]);
    await cleanupCommittedAllocationFixtures([same, overlap]);
  }
  const after = (
    await db.query("select count(*)::int n from public.user_profiles where username like 'b7f%'")
  ).rows[0].n;
  assert.equal(after, before);
  return { sameRequest: true, conflictingItem: true, overlappingSets: true, persistentFixtures: 0 };
}

async function openPostSettlementReview(client, fixture, commerce) {
  await claim(client, "service_role", fixture.admin);
  const review = (
    await client.query(
      "select public.open_marketplace_post_settlement_review($1,$2,'b7f_multi_creator','proof',$3) value",
      [fixture.admin, commerce.order, uid()],
    )
  ).rows[0].value;
  return review;
}

async function financialCounts(client, order, settlement) {
  return (
    await client.query(
      `select
        (select count(*)::int from public.marketplace_settlement_reversals where order_id=$1) reversals,
        (select count(*)::int from public.marketplace_settlement_reversal_legs where settlement_id=$2) reversal_legs,
        (select count(*)::int from public.financial_transactions where reference_type='marketplace_settlement_reversal'
          and reference_id in(select id::text from public.marketplace_settlement_reversals where order_id=$1)) reversal_transactions,
        (select count(*)::int from public.ledger_entries where txn_id in(
          select id from public.financial_transactions where reference_type='marketplace_settlement_reversal'
            and reference_id in(select id::text from public.marketplace_settlement_reversals where order_id=$1))) reversal_entries,
        (select status from public.marketplace_payments where checkout_id=(select checkout_id from public.marketplace_orders where id=$1)) payment_status,
        (select status from public.marketplace_payment_allocations where order_id=$1) allocation_status,
        (select status from public.marketplace_orders where id=$1) order_status`,
      [order, settlement],
    )
  ).rows[0];
}

async function proveB7RIntegration() {
  const reversal = await transactionScenario("U_b7r_multi_creator_reversal", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [50, 50]);
    await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 1, creator: "creatorY", bps: 1400 },
    ]);
    const released = await settleOrder(db, fixture, commerce);
    assert.equal(released.legs.length, 4);
    const beneficiaryAccounts = {
      seller: (await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'", [fixture.seller])).rows[0].id,
      creatorX: (await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'", [fixture.creatorX])).rows[0].id,
      creatorY: (await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'", [fixture.creatorY])).rows[0].id,
      platform: commerce.platform,
    };
    const beneficiaryBefore = new Map((await db.query(
      "select id,balance from public.ledger_accounts where id=any($1::uuid[])",
      [Object.values(beneficiaryAccounts)],
    )).rows.map((row) => [row.id, money(row.balance)]));
    const review = await openPostSettlementReview(db, fixture, commerce);
    const buyerAccount = (
      await db.query("select id,balance from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'", [fixture.buyer])
    ).rows[0];
    const beforeBuyer = money(buyerAccount.balance);
    const result = (
      await db.query(
        "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7f_full_refund','proof',$3,null) value",
        [fixture.admin, review.dispute_id, uid()],
      )
    ).rows[0].value;
    assert.equal(result.kind, "final_resolution");
    assert.equal(result.finalDecision.financial_result.money_moved, true);
    assert.equal(money(result.finalDecision.financial_result.gross_refund_amount), 100);
    const afterBuyer = money(
      (await db.query("select balance from public.ledger_accounts where id=$1", [buyerAccount.id])).rows[0].balance,
    );
    assert.equal(afterBuyer - beforeBuyer, 100);
    const beneficiaryAfter = new Map((await db.query(
      "select id,balance from public.ledger_accounts where id=any($1::uuid[])",
      [Object.values(beneficiaryAccounts)],
    )).rows.map((row) => [row.id, money(row.balance)]));
    assert.equal(beneficiaryBefore.get(beneficiaryAccounts.seller) - beneficiaryAfter.get(beneficiaryAccounts.seller), 78);
    assert.equal(beneficiaryBefore.get(beneficiaryAccounts.platform) - beneficiaryAfter.get(beneficiaryAccounts.platform), 10);
    assert.equal(beneficiaryBefore.get(beneficiaryAccounts.creatorX) - beneficiaryAfter.get(beneficiaryAccounts.creatorX), 5);
    assert.equal(beneficiaryBefore.get(beneficiaryAccounts.creatorY) - beneficiaryAfter.get(beneficiaryAccounts.creatorY), 7);
    const state = await financialCounts(db, commerce.order, released.settlement.id);
    assert.equal(state.reversals, 1);
    assert.equal(state.reversal_legs, 4);
    assert.equal(state.payment_status, "refunded");
    assert.equal(state.allocation_status, "refunded");
    assert.equal(state.order_status, "refunded");
    const disputeState = (
      await db.query("select status from public.marketplace_order_disputes where id=$1", [review.dispute_id])
    ).rows[0].status;
    assert.equal(disputeState, "resolved");
    const recon = (
      await db.query("select public.reconcile_marketplace_settlement_reversals() value")
    ).rows[0].value;
    for (const [name, value] of Object.entries(recon)) assert.equal(Number(value), 0, `b7r:${name}`);
    return { fourLegs: true, buyerRefund: 100, reconciliation: "zero" };
  });

  const insufficient = await transactionScenario("V_b7r_insufficient_creator_balance", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [50, 50]);
    await applyAllocations(db, fixture, commerce, [
      { itemIndex: 0, creator: "creatorX", bps: 1000 },
      { itemIndex: 1, creator: "creatorY", bps: 1400 },
    ]);
    const released = await settleOrder(db, fixture, commerce);
    const review = await openPostSettlementReview(db, fixture, commerce);
    const creatorYAccount = (
      await db.query("select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'", [fixture.creatorY])
    ).rows[0].id;
    const platform = (
      await db.query("select public.ensure_marketplace_platform_account() id")
    ).rows[0].id;
    const drain = uid();
    await db.query(
      `insert into public.financial_transactions(
        id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
        reference_type,reference_id,idempotency_key,initiated_by)
       values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed','marketplace_b7f_proof',$4,$5,$6)`,
      [drain, creatorYAccount, platform, commerce.order, `b7f-drain:${drain}`, fixture.admin],
    );
    await db.query(
      "select public.ledger_debit($1,$2,1,'B7F insufficient proof','{}'),public.ledger_credit($1,$3,1,'B7F insufficient proof','{}')",
      [drain, creatorYAccount, platform],
    );
    const before = await financialCounts(db, commerce.order, released.settlement.id);
    const balancesBefore = (
      await db.query(
        `select owner_id,balance from public.ledger_accounts where id in(public.ensure_marketplace_escrow_account(),$5)
          or owner_id in($1,$2,$3,$4) order by owner_id nulls first`,
        [fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY, platform],
      )
    ).rows;
    const result = (
      await db.query(
        "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7f_full_refund','proof',$3,null) value",
        [fixture.admin, review.dispute_id, uid()],
      )
    ).rows[0].value;
    assert.equal(result.kind, "intermediate_review");
    assert.equal(result.money_moved, false);
    const after = await financialCounts(db, commerce.order, released.settlement.id);
    const balancesAfter = (
      await db.query(
        `select owner_id,balance from public.ledger_accounts where id in(public.ensure_marketplace_escrow_account(),$5)
          or owner_id in($1,$2,$3,$4) order by owner_id nulls first`,
        [fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY, platform],
      )
    ).rows;
    assert.deepEqual(after, before);
    assert.deepEqual(balancesAfter, balancesBefore);
    assert.equal(after.reversals, 0);
    assert.equal(after.reversal_legs, 0);
    return { moneyMoved: false, noPartialMovement: true };
  });
  return { reversal, insufficient };
}

async function proveHeldAndReleaseSellerRegressions() {
  const heldRefund = await transactionScenario("held_refund_regression", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [100]);
    await shipOrder(db, fixture, commerce);
    await claim(db, "authenticated", fixture.buyer);
    await db.query("select public.report_marketplace_order_problem($1,'other','B7F held',$2)", [commerce.order, uid()]);
    const dispute = (await db.query("select id from public.marketplace_order_disputes where order_id=$1", [commerce.order])).rows[0].id;
    await claim(db, "service_role", fixture.admin);
    const result = (
      await db.query("select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7f_held','proof',$3,null) value", [fixture.admin, dispute, uid()])
    ).rows[0].value;
    assert.equal(result.finalDecision.financial_result.money_moved, true);
    assert.equal((await db.query("select count(*)::int n from public.marketplace_order_settlements where order_id=$1", [commerce.order])).rows[0].n, 0);
    return true;
  });
  const releaseSeller = await transactionScenario("release_seller_regression", async () => {
    const fixture = await createCommerceFixture(db);
    const commerce = await createPaidOrder(db, fixture, [100]);
    await shipOrder(db, fixture, commerce);
    await claim(db, "authenticated", fixture.buyer);
    await db.query("select public.report_marketplace_order_problem($1,'other','B7F release',$2)", [commerce.order, uid()]);
    const dispute = (await db.query("select id from public.marketplace_order_disputes where order_id=$1", [commerce.order])).rows[0].id;
    await claim(db, "service_role", fixture.admin);
    const key = uid();
    await db.query("select public.resolve_marketplace_dispute($1,$2,'release_seller','b7f_release','proof',$3,null)", [fixture.admin, dispute, key]);
    const before = (await db.query("select count(*)::int n from public.financial_transactions where reference_type='marketplace_order' and reference_id=$1 and operation_type like 'marketplace_%_settlement'", [commerce.order])).rows[0].n;
    await db.query("select public.resolve_marketplace_dispute($1,$2,'release_seller','b7f_release','proof',$3,null)", [fixture.admin, dispute, key]);
    const after = (await db.query("select count(*)::int n from public.financial_transactions where reference_type='marketplace_order' and reference_id=$1 and operation_type like 'marketplace_%_settlement'", [commerce.order])).rows[0].n;
    assert.equal(after, before);
    return true;
  });
  return { heldRefund, releaseSeller };
}

async function proveLiveCompatibility() {
  return transactionScenario("W_live_single_creator_compatibility", async () => {
    const fixture = await createCommerceFixture(db);
    const variant = await addVariant(db, fixture, 100, 0);
    const session = uid();
    await claim(db, "authenticated", fixture.creatorX);
    await db.query("select * from public.start_live_session($1,'B7F LIVE proof')", [session]);
    await claim(db, "authenticated", fixture.seller);
    const offer = (
      await db.query(
        "select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,1200,'active') value",
        [variant.product, fixture.creatorX],
      )
    ).rows[0].value;
    assert.equal(offer.commission_bps, 1200);
    await claim(db, "authenticated", fixture.creatorX);
    const pin = (
      await db.query(
        "select public.pin_live_session_product($1,$2,$3,$4) value",
        [session, variant.product, variant.variant, uid()],
      )
    ).rows[0].value;
    assert.equal(pin.commerce_mode, "affiliate_product");
    assert.equal(pin.creator_commission_bps, 1200);
    await fundBuyer(db, fixture, 100);
    await claim(db, "authenticated", fixture.buyer);
    const reservation = (
      await db.query(
        `select public.create_live_marketplace_checkout_reservation(
          $1,$2,$3,1,jsonb_build_object('recipient_name','B7F','line1','Proof','city','New York',
            'region','NY','postal_code','10001','country','US'),$4) value`,
        [session, pin.id, variant.variant, uid()],
      )
    ).rows[0].value;
    const checkout = reservation.checkout.id;
    const order = reservation.orders[0].id;
    await claim(db, "service_role", fixture.admin);
    await db.query("select public.pay_marketplace_checkout_with_bdag($1,$2,$3)", [fixture.buyer, checkout, uid()]);
    const parent = (
      await db.query("select * from public.marketplace_payment_allocations where order_id=$1", [order])
    ).rows[0];
    const normalized = (
      await db.query("select * from public.marketplace_order_item_creator_allocations where order_id=$1", [order])
    ).rows;
    assert.equal(money(parent.gross_amount), 100);
    assert.equal(money(parent.platform_fee_amount), 10);
    assert.equal(money(parent.creator_commission_amount), 12);
    assert.equal(money(parent.seller_net_amount), 78);
    assert.equal(parent.creator_user_id, fixture.creatorX);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].creator_user_id, fixture.creatorX);
    assert.equal(normalized[0].commission_bps, 1200);
    assert.equal(money(normalized[0].commission_base_amount), 100);
    assert.equal(money(normalized[0].commission_amount), 12);
    const source = (
      await db.query("select * from public.marketplace_live_commission_sources where order_id=$1", [order])
    ).rows[0];
    assert.equal(money(source.creator_commission_amount), 12);
    const released = await settleOrder(db, fixture, { order, checkout });
    assert.deepEqual(legTotals(released.legs), {
      creator_commission: 12,
      platform_fee: 10,
      seller_net: 78,
    });
    assert.equal(released.settlement.creator_user_id, fixture.creatorX);
    const recon = (
      await db.query("select public.reconcile_marketplace_live_commissions() value")
    ).rows[0].value;
    for (const [name, value] of Object.entries(recon)) assert.equal(Number(value), 0, `live:${name}`);
    return { formula: "round(subtotal*1200/10000,8)", amount: 12, timing: "payment_allocation_insert" };
  });
}

async function main() {
  await db.connect();
  await db.query("set role postgres");
  const economics = await proveEconomicScenarios();
  const identity = await proveIdentityAndSecurity();
  const concurrency = await proveConcurrency();
  const b7r = await proveB7RIntegration();
  const regressions = await proveHeldAndReleaseSellerRegressions();
  const live = await proveLiveCompatibility();
  const reconciliation = (
    await db.query("select public.reconcile_marketplace_multi_creator_allocations() value")
  ).rows[0].value;
  for (const [name, value] of Object.entries(reconciliation)) {
    assert.equal(Number(value), 0, `final_reconciliation:${name}`);
  }
  console.log(JSON.stringify({
    ok: true,
    scenarios: {
      A_zero_creator: economics.zeroCreator,
      B_one_creator: economics.oneCreator,
      C_two_creators_separate_items: economics.twoCreators,
      D_same_creator_multiple_items: economics.sameCreator,
      E_mixed_attributed_unattributed: economics.mixed,
      F_legacy_single_creator_equivalence: economics.legacyEquivalence,
      G_idempotent_retry: identity.idempotentRetry,
      H_conflicting_idempotency: identity.idempotencyConflict,
      I_duplicate_item_allocation: identity.duplicateItem,
      J_cross_order_item_rejection: identity.crossOrder,
      K_after_settlement_rejection: identity.afterSettlement,
      L_after_refund_rejection: identity.afterRefund,
      M_unauthorized_execution: identity.authenticatedDenied,
      N_raw_table_write_rejection: identity.rawWriteDenied,
      O_two_connection_same_request: concurrency.sameRequest,
      P_two_connection_conflicting_item: concurrency.conflictingItem,
      Q_exact_parent_aggregate: true,
      R_exact_settlement_creator_legs: true,
      S_reconciliation_all_zero: true,
      T_persistent_fixtures_zero: concurrency.persistentFixtures === 0,
      U_b7r_multi_creator_reversal: b7r.reversal,
      V_b7r_insufficient_creator_balance: b7r.insufficient,
      W_live_single_creator_compatibility: live,
      held_refund_regression: regressions.heldRefund,
      release_seller_regression: regressions.releaseSeller,
    },
    reconciliation,
    persistent_fixtures: 0,
  }, null, 2));
}

main()
  .catch(async (error) => {
    await db.query("rollback").catch(() => {});
    console.error(`MARKETPLACE_MULTI_CREATOR_PROOF_FAILED:${stage}:${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
