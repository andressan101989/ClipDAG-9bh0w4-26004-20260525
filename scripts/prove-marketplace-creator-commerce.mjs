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
  throw new Error("B7A_PROOF_REQUIRES_DISPOSABLE_DATABASE");
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

async function expectDbError(client, action, message, code) {
  const savepoint = `b7a_expected_${uid().replaceAll("-", "")}`;
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

async function insertUser(client, id, label, isAdmin = false) {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,
       'proof',now(),now(),now())`,
    [id, `b7a-${label}-${token}@proof.local`],
  );
  await client.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b7a${label}${token}`, `B7A ${label}`, isAdmin],
  );
}

async function createFixture(client) {
  const fixture = {
    seller: uid(),
    buyer: uid(),
    buyer2: uid(),
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
  await insertUser(client, fixture.buyer2, "buyer2");
  await insertUser(client, fixture.admin, "admin", true);
  await insertUser(client, fixture.creatorX, "creatorx");
  await insertUser(client, fixture.creatorY, "creatory");
  await client.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7A Seller',now())",
    [fixture.seller],
  );
  await client.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7A Store',$3,'active')",
    [fixture.store, fixture.seller, `b7a-${uid()}`],
  );
  await client.query(
    `insert into public.marketplace_shipping_profiles(
      id,seller_id,store_id,name,processing_days_min,processing_days_max,
      ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7A Ground',1,2,'US','B7A returns')`,
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
  const sku = `B7A-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(
    `insert into public.products(
      id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,
      product_type,moderation_status,published_at,shipping_profile_id)
     values($1,$2,$3,'Creator commerce proof',$4,'BDAG','physical',40,'active',$5,
       '10000000-0000-4000-8000-000000000002','physical','approved',now(),$6)`,
    [
      product,
      fixture.seller,
      `B7A Item ${index}`,
      price,
      fixture.store,
      fixture.shippingProfile,
    ],
  );
  await client.query(
    `insert into public.marketplace_product_variants(
      id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,
    [variant, product, fixture.store, fixture.seller, sku, price],
  );
  await client.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,40,0)",
    [variant],
  );
  fixture.products.push(product);
  fixture.variants.push(variant);
  return { product, variant, price };
}

async function createOffer(client, fixture, item, creator, bps, options = {}) {
  await claim(client, "authenticated", fixture.seller);
  return (
    await client.query(
      `select public.upsert_my_live_affiliate_offer(
        $1,'specific_creator',$2,$3,$4,$5,$6,$7) value`,
      [
        item.product,
        fixture[creator],
        bps,
        options.status ?? "active",
        options.startsAt ?? null,
        options.endsAt ?? null,
        options.key ?? uid(),
      ],
    )
  ).rows[0].value;
}

async function createAttribution(
  client,
  fixture,
  offer,
  creator,
  variant,
  key = uid(),
) {
  await claim(client, "service_role", fixture.admin);
  const value = (
    await client.query(
      `select public.create_marketplace_creator_commerce_attribution(
        $1,$2,$3,'direct_creator_link',$1,$4) value`,
      [offer.id, fixture[creator], variant, key],
    )
  ).rows[0].value;
  return { value, key };
}

async function fundBuyer(client, fixture, amount, buyer = fixture.buyer) {
  await claim(client, "service_role", fixture.admin);
  const platform = (
    await client.query("select public.ensure_marketplace_platform_account() id")
  ).rows[0].id;
  const buyerAccount = (
    await client.query("select public.ensure_ledger_account($1) id", [buyer])
  ).rows[0].id;
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed',
       'marketplace_b7a_proof',$5,$6,$7)`,
    [
      transaction,
      platform,
      buyerAccount,
      amount,
      fixture.store,
      `b7a-fund:${transaction}`,
      buyer,
    ],
  );
  await client.query(
    "select public.ledger_debit($1,$2,$3,'B7A proof funding','{}'),public.ledger_credit($1,$4,$3,'B7A proof funding','{}')",
    [transaction, platform, amount, buyerAccount],
  );
  return { platform, buyerAccount, transaction };
}

const addressSql = `jsonb_build_object('recipient_name','B7A','line1','Proof Street',
  'city','New York','region','NY','postal_code','10001','country','US')`;

async function reserveCreatorOrder(
  client,
  fixture,
  items,
  buyer = fixture.buyer,
  key = uid(),
) {
  await claim(client, "authenticated", buyer);
  const payload = items.map((item) => ({
    variant_id: item.variant,
    quantity: item.quantity ?? 1,
    ...(item.attribution ? { attribution_id: item.attribution } : {}),
  }));
  const reservation = (
    await client.query(
      `select public.create_marketplace_creator_checkout_reservation($1::jsonb,${addressSql},$2) value`,
      [JSON.stringify(payload), key],
    )
  ).rows[0].value;
  const orders = reservation.orders;
  assert.equal(orders.length, 1, "same_store_checkout_split");
  const order = orders[0].id;
  const orderItems = (
    await client.query(
      "select id,product_id,variant_id,line_total from public.marketplace_order_items where order_id=$1 order by variant_id",
      [order],
    )
  ).rows;
  return {
    reservation,
    checkout: reservation.checkout.id,
    order,
    items: orderItems,
    key,
    buyer,
  };
}

async function payOrder(client, fixture, commerce) {
  await claim(client, "service_role", fixture.admin);
  await client.query(
    "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
    [commerce.buyer, commerce.checkout, uid()],
  );
  return (
    await client.query(
      "select * from public.marketplace_payment_allocations where order_id=$1",
      [commerce.order],
    )
  ).rows[0];
}

async function createAttributedOrder(
  client,
  fixture,
  specifications,
  buyer = fixture.buyer,
) {
  const items = [];
  for (const [index, specification] of specifications.entries()) {
    const item = await addVariant(client, fixture, specification.price, index);
    if (specification.creator) {
      const offer = await createOffer(
        client,
        fixture,
        item,
        specification.creator,
        specification.bps,
      );
      const attribution = await createAttribution(
        client,
        fixture,
        offer,
        specification.creator,
        item.variant,
      );
      items.push({ ...item, offer, attribution: attribution.value.id });
    } else items.push(item);
  }
  const total = specifications.reduce((sum, item) => sum + item.price, 0);
  const funding = await fundBuyer(client, fixture, total, buyer);
  const commerce = await reserveCreatorOrder(client, fixture, items, buyer);
  const allocation = await payOrder(client, fixture, commerce);
  const snapshots = (
    await client.query(
      "select * from public.marketplace_order_item_creator_attributions where order_id=$1 order by order_item_id",
      [commerce.order],
    )
  ).rows;
  const b7f = (
    await client.query(
      "select * from public.marketplace_order_item_creator_allocations where order_id=$1 order by order_item_id",
      [commerce.order],
    )
  ).rows;
  return {
    ...commerce,
    sourceItems: items,
    allocation,
    snapshots,
    b7f,
    ...funding,
  };
}

async function shipAndSettle(client, fixture, commerce) {
  await claim(client, "authenticated", fixture.seller);
  await client.query(
    "select public.seller_start_marketplace_order_processing($1,$2)",
    [commerce.order, uid()],
  );
  await client.query(
    "select public.seller_ship_marketplace_order($1,'B7A','Ground',$2,null,null,$3)",
    [commerce.order, `B7A-${uid().slice(0, 8)}`, uid()],
  );
  await claim(client, "service_role", fixture.admin);
  await client.query(
    "select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)",
    [commerce.buyer, commerce.order, uid()],
  );
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
  return { settlement, legs };
}

function legTotals(legs) {
  return legs.reduce((result, leg) => {
    result[leg.leg_type] = (result[leg.leg_type] ?? 0) + money(leg.amount);
    return result;
  }, {});
}

async function proveAuthorityAndSecurity() {
  return transactionScenario("A_to_O_authority_security", async () => {
    const fixture = await createFixture(db);
    const itemA = await addVariant(db, fixture, 100, 0);
    const itemB = await addVariant(db, fixture, 50, 1);
    const offer = await createOffer(db, fixture, itemA, "creatorX", 1200);
    assert.equal(offer.commission_bps, 1200);
    assert.equal(offer.creator_id, fixture.creatorX);

    await claim(db, "authenticated", fixture.creatorX);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.upsert_my_live_affiliate_offer(
          $1,'specific_creator',$2,1200,'active',null,null,$3)`,
          [itemA.product, fixture.creatorX, uid()],
        ),
      "live_affiliate_product_unavailable",
    );

    await claim(db, "service_role", fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [offer.id, fixture.creatorX, itemB.variant, uid()],
        ),
      "marketplace_creator_attribution_variant_mismatch",
      "23514",
    );

    const activeKey = uid();
    const active = await createAttribution(
      db,
      fixture,
      offer,
      "creatorX",
      itemA.variant,
      activeKey,
    );
    const retry = await createAttribution(
      db,
      fixture,
      offer,
      "creatorX",
      itemA.variant,
      activeKey,
    );
    assert.deepEqual(retry.value, active.value);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [offer.id, fixture.creatorY, itemA.variant, activeKey],
        ),
      "marketplace_creator_attribution_idempotency_conflict",
      "23505",
    );

    const expiredOffer = await createOffer(
      db,
      fixture,
      itemB,
      "creatorX",
      900,
      {
        startsAt: "2026-08-01T00:00:00Z",
        endsAt: "2026-08-02T00:00:00Z",
      },
    );
    await claim(db, "service_role", fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [expiredOffer.id, fixture.creatorX, itemB.variant, uid()],
        ),
      "marketplace_creator_entitlement_ineligible",
      "22023",
    );

    const revokeItem = await addVariant(db, fixture, 25, 2);
    const revocable = await createOffer(
      db,
      fixture,
      revokeItem,
      "creatorX",
      1000,
    );
    await createOffer(db, fixture, revokeItem, "creatorX", 1000, {
      status: "removed",
    });
    await claim(db, "service_role", fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [revocable.id, fixture.creatorX, revokeItem.variant, uid()],
        ),
      "marketplace_creator_entitlement_ineligible",
      "22023",
    );

    const publicOffer = await claim(db, "authenticated", fixture.seller).then(
      async () =>
        (
          await db.query(
            `select public.upsert_my_live_affiliate_offer(
          $1,'public_creator',null,1000,'active',null,null,$2) value`,
            [itemB.product, uid()],
          )
        ).rows[0].value,
    );
    await claim(db, "service_role", fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [publicOffer.id, fixture.seller, itemB.variant, uid()],
        ),
      "marketplace_creator_attribution_creator_invalid",
      "23514",
    );

    await claim(db, "authenticated", fixture.buyer);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
          [offer.id, fixture.creatorX, itemA.variant, uid()],
        ),
      "marketplace_creator_attribution_service_role_required",
      "42501",
    );
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.finalize_marketplace_creator_commerce_for_order($1,$2)`,
          [uid(), uid()],
        ),
      "marketplace_creator_finalizer_service_role_required",
      "42501",
    );

    await fundBuyer(db, fixture, 100);
    await claim(db, "authenticated", fixture.buyer);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_checkout_reservation(
          $1::jsonb,${addressSql},$2)`,
          [
            JSON.stringify([
              {
                variant_id: itemA.variant,
                quantity: 1,
                attribution_id: active.value.id,
                commission_bps: 1,
                commission_amount: 99,
              },
            ]),
            uid(),
          ],
        ),
      "marketplace_creator_checkout_invalid_items",
      "22023",
    );

    const checkoutKey = uid();
    const checkoutItems = [{ ...itemA, attribution: active.value.id }];
    const checkout = await reserveCreatorOrder(
      db,
      fixture,
      checkoutItems,
      fixture.buyer,
      checkoutKey,
    );
    const checkoutRetry = await reserveCreatorOrder(
      db,
      fixture,
      checkoutItems,
      fixture.buyer,
      checkoutKey,
    );
    assert.equal(checkoutRetry.checkout, checkout.checkout);
    const offerY = await createOffer(db, fixture, itemA, "creatorY", 1200);
    const attributionY = await createAttribution(
      db,
      fixture,
      offerY,
      "creatorY",
      itemA.variant,
    );
    await claim(db, "authenticated", fixture.buyer);
    await expectDbError(
      db,
      () =>
        db.query(
          `select public.create_marketplace_creator_checkout_reservation(
          $1::jsonb,${addressSql},$2)`,
          [
            JSON.stringify([
              {
                variant_id: itemA.variant,
                quantity: 1,
                attribution_id: attributionY.value.id,
              },
            ]),
            checkoutKey,
          ],
        ),
      "marketplace_creator_checkout_idempotency_conflict",
      "23505",
    );

    assert.equal(
      (
        await db.query(
          "select to_regprocedure('public.create_marketplace_creator_commerce_attribution(uuid,uuid,uuid,integer,text,uuid,uuid)') is null absent",
        )
      ).rows[0].absent,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('authenticated','public.marketplace_creator_commerce_attributions','INSERT,UPDATE,DELETE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await expectDbError(
      db,
      async () => {
        await db.query("set local role authenticated");
        await db.query(
          "insert into public.marketplace_creator_commerce_attributions(id)values($1)",
          [uid()],
        );
      },
      "permission denied for table marketplace_creator_commerce_attributions",
      "42501",
    );
    await claim(db, "service_role", fixture.admin);
    return {
      entitlementCreation: true,
      selfGrantDenied: true,
      productVariantMismatchDenied: true,
      activeAttribution: true,
      expiredDenied: true,
      revokedDenied: true,
      selfAttributionDenied: true,
      arbitraryBpsAndAmountDenied: true,
      idempotentRetry: true,
      idempotencyConflict: true,
      checkoutIdempotency: true,
      security: true,
    };
  });
}

async function proveEconomicsAndFreeze() {
  const zero = await transactionScenario("P_zero_creator", async () => {
    const fixture = await createFixture(db);
    const item = await addVariant(db, fixture, 100, 0);
    await fundBuyer(db, fixture, 100);
    const commerce = await reserveCreatorOrder(db, fixture, [item]);
    const allocation = await payOrder(db, fixture, commerce);
    assert.equal(money(allocation.gross_amount), 100);
    assert.equal(money(allocation.platform_fee_amount), 10);
    assert.equal(money(allocation.seller_net_amount), 90);
    assert.equal(money(allocation.creator_commission_amount), 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_attributions where order_id=$1",
          [commerce.order],
        )
      ).rows[0].n,
      0,
    );
    return true;
  });

  const one = await transactionScenario("Q_one_creator", async () => {
    const fixture = await createFixture(db);
    const commerce = await createAttributedOrder(db, fixture, [
      { price: 100, creator: "creatorX", bps: 1200 },
    ]);
    assert.equal(commerce.snapshots.length, 1);
    assert.equal(commerce.b7f.length, 1);
    assert.equal(commerce.snapshots[0].creator_user_id, fixture.creatorX);
    assert.equal(commerce.snapshots[0].commission_bps, 1200);
    assert.equal(money(commerce.b7f[0].commission_base_amount), 100);
    assert.equal(money(commerce.b7f[0].commission_amount), 12);
    assert.equal(money(commerce.allocation.creator_commission_amount), 12);
    assert.equal(money(commerce.allocation.seller_net_amount), 78);
    assert.equal(money(commerce.allocation.platform_fee_amount), 10);
    assert.equal(money(commerce.allocation.gross_amount), 100);
    assert.equal(commerce.allocation.creator_user_id, fixture.creatorX);
    return true;
  });

  const two = await transactionScenario("R_two_creators", async () => {
    const fixture = await createFixture(db);
    const commerce = await createAttributedOrder(db, fixture, [
      { price: 50, creator: "creatorX", bps: 1000 },
      { price: 50, creator: "creatorY", bps: 1400 },
    ]);
    assert.equal(commerce.snapshots.length, 2);
    assert.equal(commerce.b7f.length, 2);
    assert.deepEqual(
      commerce.b7f
        .map((row) => money(row.commission_amount))
        .sort((a, b) => a - b),
      [5, 7],
    );
    assert.equal(money(commerce.allocation.gross_amount), 100);
    assert.equal(money(commerce.allocation.platform_fee_amount), 10);
    assert.equal(money(commerce.allocation.creator_commission_amount), 12);
    assert.equal(money(commerce.allocation.seller_net_amount), 78);
    assert.equal(commerce.allocation.creator_user_id, null);
    const released = await shipAndSettle(db, fixture, commerce);
    assert.deepEqual(legTotals(released.legs), {
      creator_commission: 12,
      platform_fee: 10,
      seller_net: 78,
    });
    const creators = released.legs.filter(
      (leg) => leg.leg_type === "creator_commission",
    );
    assert.equal(creators.length, 2);
    assert.deepEqual(
      new Map(
        creators.map((leg) => [leg.beneficiary_user_id, money(leg.amount)]),
      ),
      new Map([
        [fixture.creatorX, 5],
        [fixture.creatorY, 7],
      ]),
    );
    return true;
  });

  const same = await transactionScenario(
    "S_same_creator_multiple_items",
    async () => {
      const fixture = await createFixture(db);
      const commerce = await createAttributedOrder(db, fixture, [
        { price: 40, creator: "creatorX", bps: 1000 },
        { price: 60, creator: "creatorX", bps: 1000 },
      ]);
      assert.deepEqual(
        commerce.b7f
          .map((row) => money(row.commission_amount))
          .sort((a, b) => a - b),
        [4, 6],
      );
      assert.equal(money(commerce.allocation.creator_commission_amount), 10);
      assert.equal(commerce.allocation.creator_user_id, fixture.creatorX);
      const released = await shipAndSettle(db, fixture, commerce);
      const creators = released.legs.filter(
        (leg) => leg.leg_type === "creator_commission",
      );
      assert.equal(creators.length, 1);
      assert.equal(creators[0].beneficiary_user_id, fixture.creatorX);
      assert.equal(money(creators[0].amount), 10);
      return true;
    },
  );

  const mixed = await transactionScenario("T_mixed_attribution", async () => {
    const fixture = await createFixture(db);
    const commerce = await createAttributedOrder(db, fixture, [
      { price: 40, creator: "creatorX", bps: 1000 },
      { price: 30 },
      { price: 30, creator: "creatorY", bps: 2000 },
    ]);
    assert.equal(commerce.snapshots.length, 2);
    assert.equal(commerce.b7f.length, 2);
    assert.deepEqual(
      commerce.b7f
        .map((row) => money(row.commission_amount))
        .sort((a, b) => a - b),
      [4, 6],
    );
    assert.equal(money(commerce.allocation.creator_commission_amount), 10);
    assert.equal(money(commerce.allocation.seller_net_amount), 80);
    return true;
  });

  const frozen = await transactionScenario(
    "U_bps_change_after_freeze",
    async () => {
      const fixture = await createFixture(db);
      const item = await addVariant(db, fixture, 100, 0);
      const offer1200 = await createOffer(db, fixture, item, "creatorX", 1200);
      const attribution1200 = await createAttribution(
        db,
        fixture,
        offer1200,
        "creatorX",
        item.variant,
      );
      await fundBuyer(db, fixture, 200);
      const first = await reserveCreatorOrder(db, fixture, [
        {
          ...item,
          attribution: attribution1200.value.id,
        },
      ]);
      const offer900 = await createOffer(db, fixture, item, "creatorX", 900);
      const firstAllocation = await payOrder(db, fixture, first);
      assert.equal(money(firstAllocation.creator_commission_amount), 12);
      const frozenSnapshot = (
        await db.query(
          "select commission_bps from public.marketplace_order_item_creator_attributions where order_id=$1",
          [first.order],
        )
      ).rows[0];
      assert.equal(frozenSnapshot.commission_bps, 1200);

      const attribution900 = await createAttribution(
        db,
        fixture,
        offer900,
        "creatorX",
        item.variant,
      );
      const second = await reserveCreatorOrder(db, fixture, [
        {
          ...item,
          attribution: attribution900.value.id,
        },
      ]);
      const secondAllocation = await payOrder(db, fixture, second);
      assert.equal(money(secondAllocation.creator_commission_amount), 9);
      return { historicalBps: 1200, newBps: 900 };
    },
  );
  return { zero, one, two, same, mixed, frozen };
}

async function openPostSettlementReview(client, fixture, commerce) {
  await claim(client, "service_role", fixture.admin);
  return (
    await client.query(
      `select public.open_marketplace_post_settlement_review(
        $1,$2,'b7a_creator_commerce','proof',$3) value`,
      [fixture.admin, commerce.order, uid()],
    )
  ).rows[0].value;
}

async function financialCounts(client, order, settlement) {
  return (
    await client.query(
      `select
        (select count(*)::int from public.marketplace_settlement_reversals where order_id=$1) reversals,
        (select count(*)::int from public.marketplace_settlement_reversal_legs where settlement_id=$2) reversal_legs,
        (select count(*)::int from public.financial_transactions where reference_type='marketplace_settlement_reversal'
          and reference_id in(select id::text from public.marketplace_settlement_reversals where order_id=$1)) reversal_transactions,
        (select status from public.marketplace_payments where checkout_id=
          (select checkout_id from public.marketplace_orders where id=$1)) payment_status,
        (select status from public.marketplace_payment_allocations where order_id=$1) allocation_status,
        (select status from public.marketplace_orders where id=$1) order_status`,
      [order, settlement],
    )
  ).rows[0];
}

async function proveSettlementAndB7R() {
  const reversal = await transactionScenario(
    "V_to_X_b7a_b7f_settlement_b7r",
    async () => {
      const fixture = await createFixture(db);
      const commerce = await createAttributedOrder(db, fixture, [
        { price: 50, creator: "creatorX", bps: 1000 },
        { price: 50, creator: "creatorY", bps: 1400 },
      ]);
      const released = await shipAndSettle(db, fixture, commerce);
      assert.equal(released.legs.length, 4);
      assert.deepEqual(legTotals(released.legs), {
        creator_commission: 12,
        platform_fee: 10,
        seller_net: 78,
      });
      const frozenRow = (
        await db.query(
          "select order_item_id,attribution_id from public.marketplace_order_item_creator_attributions where order_id=$1 order by order_item_id limit 1",
          [commerce.order],
        )
      ).rows[0];
      await expectDbError(
        db,
        () =>
          db.query(
            "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3)",
            [frozenRow.order_item_id, frozenRow.attribution_id, uid()],
          ),
        "marketplace_creator_attribution_freeze_ineligible",
        "22023",
      );
      const accounts = {
        seller: (
          await db.query(
            "select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'",
            [fixture.seller],
          )
        ).rows[0].id,
        creatorX: (
          await db.query(
            "select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'",
            [fixture.creatorX],
          )
        ).rows[0].id,
        creatorY: (
          await db.query(
            "select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'",
            [fixture.creatorY],
          )
        ).rows[0].id,
        platform: commerce.platform,
      };
      const before = new Map(
        (
          await db.query(
            "select id,balance from public.ledger_accounts where id=any($1::uuid[])",
            [Object.values(accounts)],
          )
        ).rows.map((row) => [row.id, money(row.balance)]),
      );
      const buyerBefore = money(
        (
          await db.query(
            "select balance from public.ledger_accounts where id=$1",
            [commerce.buyerAccount],
          )
        ).rows[0].balance,
      );
      const review = await openPostSettlementReview(db, fixture, commerce);
      const resolution = (
        await db.query(
          `select public.resolve_marketplace_dispute(
          $1,$2,'refund_buyer','b7a_full_refund','proof',$3,null) value`,
          [fixture.admin, review.dispute_id, uid()],
        )
      ).rows[0].value;
      assert.equal(resolution.kind, "final_resolution");
      assert.equal(resolution.finalDecision.financial_result.money_moved, true);
      assert.equal(
        money(resolution.finalDecision.financial_result.gross_refund_amount),
        100,
      );
      const after = new Map(
        (
          await db.query(
            "select id,balance from public.ledger_accounts where id=any($1::uuid[])",
            [Object.values(accounts)],
          )
        ).rows.map((row) => [row.id, money(row.balance)]),
      );
      assert.equal(
        before.get(accounts.seller) - after.get(accounts.seller),
        78,
      );
      assert.equal(
        before.get(accounts.platform) - after.get(accounts.platform),
        10,
      );
      assert.equal(
        before.get(accounts.creatorX) - after.get(accounts.creatorX),
        5,
      );
      assert.equal(
        before.get(accounts.creatorY) - after.get(accounts.creatorY),
        7,
      );
      const buyerAfter = money(
        (
          await db.query(
            "select balance from public.ledger_accounts where id=$1",
            [commerce.buyerAccount],
          )
        ).rows[0].balance,
      );
      assert.equal(buyerAfter - buyerBefore, 100);
      const state = await financialCounts(
        db,
        commerce.order,
        released.settlement.id,
      );
      assert.deepEqual(state, {
        reversals: 1,
        reversal_legs: 4,
        reversal_transactions: 5,
        payment_status: "refunded",
        allocation_status: "refunded",
        order_status: "refunded",
      });
      const b7r = (
        await db.query(
          "select public.reconcile_marketplace_settlement_reversals() value",
        )
      ).rows[0].value;
      for (const [name, value] of Object.entries(b7r)) {
        assert.equal(Number(value), 0, `b7r:${name}`);
      }
      return { legs: 4, buyerRefund: 100, reconciliation: "zero" };
    },
  );

  const insufficient = await transactionScenario(
    "Y_b7r_insufficient_creator",
    async () => {
      const fixture = await createFixture(db);
      const commerce = await createAttributedOrder(db, fixture, [
        { price: 50, creator: "creatorX", bps: 1000 },
        { price: 50, creator: "creatorY", bps: 1400 },
      ]);
      const released = await shipAndSettle(db, fixture, commerce);
      const review = await openPostSettlementReview(db, fixture, commerce);
      const creatorYAccount = (
        await db.query(
          "select id from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG'",
          [fixture.creatorY],
        )
      ).rows[0].id;
      const drain = uid();
      await db.query(
        `insert into public.financial_transactions(
        id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
        reference_type,reference_id,idempotency_key,initiated_by)
       values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed',
         'marketplace_b7a_proof',$4,$5,$6)`,
        [
          drain,
          creatorYAccount,
          commerce.platform,
          commerce.order,
          `b7a-drain:${drain}`,
          fixture.admin,
        ],
      );
      await db.query(
        "select public.ledger_debit($1,$2,1,'B7A insufficient proof','{}'),public.ledger_credit($1,$3,1,'B7A insufficient proof','{}')",
        [drain, creatorYAccount, commerce.platform],
      );
      const before = await financialCounts(
        db,
        commerce.order,
        released.settlement.id,
      );
      const balancesBefore = (
        await db.query(
          `select id,balance from public.ledger_accounts
       where owner_id=any($1::uuid[]) or id in($2,$3) order by id`,
          [
            [fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY],
            commerce.platform,
            commerce.buyerAccount,
          ],
        )
      ).rows;
      const result = (
        await db.query(
          `select public.resolve_marketplace_dispute(
          $1,$2,'refund_buyer','b7a_full_refund','proof',$3,null) value`,
          [fixture.admin, review.dispute_id, uid()],
        )
      ).rows[0].value;
      assert.equal(result.kind, "intermediate_review");
      assert.equal(result.money_moved, false);
      assert.deepEqual(
        await financialCounts(db, commerce.order, released.settlement.id),
        before,
      );
      const balancesAfter = (
        await db.query(
          `select id,balance from public.ledger_accounts
       where owner_id=any($1::uuid[]) or id in($2,$3) order by id`,
          [
            [fixture.seller, fixture.buyer, fixture.creatorX, fixture.creatorY],
            commerce.platform,
            commerce.buyerAccount,
          ],
        )
      ).rows;
      assert.deepEqual(balancesAfter, balancesBefore);
      assert.equal(before.reversals, 0);
      assert.equal(before.reversal_legs, 0);
      return { moneyMoved: false, noPartialMovement: true };
    },
  );
  return { reversal, insufficient };
}

async function proveLiveCompatibility() {
  return transactionScenario("Z_AA_live_compatibility", async () => {
    const fixture = await createFixture(db);
    const affiliateItem = await addVariant(db, fixture, 100, 0);
    const session = uid();
    await claim(db, "authenticated", fixture.creatorX);
    await db.query(
      "select * from public.start_live_session($1,'B7A LIVE proof')",
      [session],
    );
    const offer = await createOffer(
      db,
      fixture,
      affiliateItem,
      "creatorX",
      1200,
    );
    await claim(db, "authenticated", fixture.creatorX);
    const pin = (
      await db.query(
        "select public.pin_live_session_product($1,$2,$3,$4) value",
        [session, affiliateItem.product, affiliateItem.variant, uid()],
      )
    ).rows[0].value;
    await fundBuyer(db, fixture, 200);
    await claim(db, "authenticated", fixture.buyer);
    const reservation = (
      await db.query(
        `select public.create_live_marketplace_checkout_reservation(
          $1,$2,$3,1,${addressSql},$4) value`,
        [session, pin.id, affiliateItem.variant, uid()],
      )
    ).rows[0].value;
    const order = reservation.orders[0].id;
    await claim(db, "service_role", fixture.admin);
    await db.query(
      "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
      [fixture.buyer, reservation.checkout.id, uid()],
    );
    const allocation = (
      await db.query(
        "select * from public.marketplace_payment_allocations where order_id=$1",
        [order],
      )
    ).rows[0];
    assert.equal(money(allocation.gross_amount), 100);
    assert.equal(money(allocation.platform_fee_amount), 10);
    assert.equal(money(allocation.creator_commission_amount), 12);
    assert.equal(money(allocation.seller_net_amount), 78);
    assert.equal(allocation.creator_user_id, fixture.creatorX);
    const canonical = (
      await db.query(
        `select a.source_surface,a.source_entity_id,a.entitlement_id,a.creator_user_id,
          a.commission_bps,s.order_item_id,b.commission_amount
         from public.marketplace_creator_commerce_attributions a
         join public.marketplace_order_item_creator_attributions s on s.attribution_id=a.id
         join public.marketplace_order_item_creator_allocations b on b.order_item_id=s.order_item_id
         where s.order_id=$1`,
        [order],
      )
    ).rows[0];
    assert.equal(canonical.source_surface, "live");
    assert.equal(canonical.source_entity_id, pin.id);
    assert.equal(canonical.entitlement_id, offer.id);
    assert.equal(canonical.creator_user_id, fixture.creatorX);
    assert.equal(canonical.commission_bps, 1200);
    assert.equal(money(canonical.commission_amount), 12);

    const ownItem = await addVariant(db, fixture, 100, 1);
    const ownSession = uid();
    await claim(db, "authenticated", fixture.seller);
    await db.query(
      "select * from public.start_live_session($1,'B7A own product')",
      [ownSession],
    );
    const ownPin = (
      await db.query(
        "select public.pin_live_session_product($1,$2,$3,$4) value",
        [ownSession, ownItem.product, ownItem.variant, uid()],
      )
    ).rows[0].value;
    assert.equal(ownPin.commerce_mode, "own_product");
    await claim(db, "authenticated", fixture.buyer);
    const ownReservation = (
      await db.query(
        `select public.create_live_marketplace_checkout_reservation(
          $1,$2,$3,1,${addressSql},$4) value`,
        [ownSession, ownPin.id, ownItem.variant, uid()],
      )
    ).rows[0].value;
    const ownOrder = ownReservation.orders[0].id;
    await claim(db, "service_role", fixture.admin);
    await db.query(
      "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
      [fixture.buyer, ownReservation.checkout.id, uid()],
    );
    const ownAllocation = (
      await db.query(
        "select * from public.marketplace_payment_allocations where order_id=$1",
        [ownOrder],
      )
    ).rows[0];
    assert.equal(money(ownAllocation.creator_commission_amount), 0);
    assert.equal(ownAllocation.creator_user_id, null);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_attributions where order_id=$1",
          [ownOrder],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1",
          [ownOrder],
        )
      ).rows[0].n,
      0,
    );
    const liveRecon = (
      await db.query(
        "select public.reconcile_marketplace_live_commissions() value",
      )
    ).rows[0].value;
    for (const [name, value] of Object.entries(liveRecon)) {
      assert.equal(Number(value), 0, `live:${name}`);
    }
    return { affiliateExact: true, ownProductZero: true };
  });
}

async function insertPendingManualOrder(client, fixture, item, buyer) {
  const checkout = uid();
  const order = uid();
  const orderItem = uid();
  await client.query(
    `insert into public.marketplace_checkout_sessions(
      id,reference,buyer_id,status,subtotal,total,idempotency_key,request_fingerprint,expires_at)
     values($1,$2,$3,'pending_payment',$4,$4,$5,$6,now()+interval '1 hour')`,
    [checkout, `B7A-RACE-${uid()}`, buyer, item.price, uid(), "c".repeat(64)],
  );
  await client.query(
    `insert into public.marketplace_checkout_shipping_addresses(
      checkout_id,recipient_name,line1,city,region,postal_code,country)
     values($1,'B7A','Proof Street','New York','NY','10001','US')`,
    [checkout],
  );
  await client.query(
    `insert into public.marketplace_orders(
      id,order_number,checkout_id,buyer_id,seller_id,store_id,status,subtotal,total,
      reservation_expires_at)
     values($1,$2,$3,$4,$5,$6,'pending_payment',$7,$7,now()+interval '1 hour')`,
    [
      order,
      `B7A-RACE-${uid()}`,
      checkout,
      buyer,
      fixture.seller,
      fixture.store,
      item.price,
    ],
  );
  await client.query(
    `insert into public.marketplace_order_items(
      id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,
      variant_title,sku,option_snapshot,unit_price,quantity,line_total)
     values($1,$2,$3,$4,$5,$6,$7,'B7A Race','Default',$8,'[]',$9,1,$9)`,
    [
      orderItem,
      order,
      checkout,
      item.product,
      item.variant,
      fixture.seller,
      fixture.store,
      `B7A-RACE-${uid()}`,
      item.price,
    ],
  );
  return { checkout, order, item: orderItem, buyer };
}

async function createCommittedConcurrencyFixture() {
  await db.query("begin");
  try {
    const fixture = await createFixture(db);
    const raceItem = await addVariant(db, fixture, 25, 0);
    const revokeItem = await addVariant(db, fixture, 30, 1);
    const offerX = await createOffer(db, fixture, raceItem, "creatorX", 1000);
    const offerY = await createOffer(db, fixture, raceItem, "creatorY", 1100);
    const attrX = await createAttribution(
      db,
      fixture,
      offerX,
      "creatorX",
      raceItem.variant,
    );
    const attrY = await createAttribution(
      db,
      fixture,
      offerY,
      "creatorY",
      raceItem.variant,
    );
    const firstOrder = await insertPendingManualOrder(
      db,
      fixture,
      raceItem,
      fixture.buyer,
    );
    const secondOrder = await insertPendingManualOrder(
      db,
      fixture,
      raceItem,
      fixture.buyer2,
    );
    const thirdOrder = await insertPendingManualOrder(
      db,
      fixture,
      raceItem,
      fixture.creatorY,
    );
    const revocable = await createOffer(
      db,
      fixture,
      revokeItem,
      "creatorX",
      900,
    );
    const platform = (
      await db.query("select public.ensure_marketplace_platform_account() id")
    ).rows[0].id;
    const escrow = (
      await db.query("select public.ensure_marketplace_escrow_account() id")
    ).rows[0].id;
    const accountBaseline = (
      await db.query(
        "select id,balance from public.ledger_accounts where id=any($1::uuid[])",
        [[platform, escrow]],
      )
    ).rows;
    const settledRace = await createAttributedOrder(
      db,
      fixture,
      [
        { price: 50, creator: "creatorX", bps: 1000 },
        { price: 50, creator: "creatorY", bps: 1400 },
      ],
      fixture.admin,
    );
    await claim(db, "authenticated", fixture.seller);
    await db.query(
      "select public.seller_start_marketplace_order_processing($1,$2)",
      [settledRace.order, uid()],
    );
    await db.query(
      "select public.seller_ship_marketplace_order($1,'B7A','Ground',$2,null,null,$3)",
      [settledRace.order, `B7A-${uid().slice(0, 8)}`, uid()],
    );
    const finalizerKey = (
      await db.query(
        "select idempotency_key from public.marketplace_order_item_creator_allocations where order_id=$1 limit 1",
        [settledRace.order],
      )
    ).rows[0].idempotency_key;
    await db.query("commit");
    return {
      fixture,
      raceItem,
      revokeItem,
      offerX,
      offerY,
      attrX,
      attrY,
      firstOrder,
      secondOrder,
      thirdOrder,
      revocable,
      settledRace,
      finalizerKey,
      platform,
      escrow,
      accountBaseline,
    };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
}

async function cleanupCommittedFixture(setup) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role=replica");
    const orderIds = [
      setup.firstOrder.order,
      setup.secondOrder.order,
      setup.thirdOrder.order,
      setup.settledRace.order,
    ];
    const checkoutIds = [
      setup.firstOrder.checkout,
      setup.secondOrder.checkout,
      setup.thirdOrder.checkout,
      setup.settledRace.checkout,
    ];
    const txRows = (
      await db.query(
        `select id from public.financial_transactions
         where initiated_by=any($1::uuid[]) or reference_id=any($2::text[])
           or reference_id=any($3::text[])`,
        [
          [
            setup.fixture.seller,
            setup.fixture.buyer,
            setup.fixture.buyer2,
            setup.fixture.admin,
            setup.fixture.creatorX,
            setup.fixture.creatorY,
          ],
          orderIds,
          checkoutIds,
        ],
      )
    ).rows.map((row) => row.id);
    if (txRows.length) {
      await db.query(
        "delete from public.ledger_entries where txn_id=any($1::uuid[])",
        [txRows],
      );
      await db.query(
        "delete from public.financial_transactions where id=any($1::uuid[])",
        [txRows],
      );
    }
    const tables = (
      await db.query(
        `select distinct c.table_name,c.column_name
         from information_schema.columns c
         join information_schema.tables t on t.table_schema=c.table_schema
           and t.table_name=c.table_name and t.table_type='BASE TABLE'
         where c.table_schema='public' and c.column_name in('order_id','checkout_id')
         order by c.table_name,c.column_name`,
      )
    ).rows;
    for (const row of tables) {
      const values = row.column_name === "order_id" ? orderIds : checkoutIds;
      await db.query(
        `delete from public.${row.table_name} where ${row.column_name}=any($1::uuid[])`,
        [values],
      );
    }
    await db.query(
      "delete from public.marketplace_orders where id=any($1::uuid[])",
      [orderIds],
    );
    await db.query(
      "delete from public.marketplace_checkout_sessions where id=any($1::uuid[])",
      [checkoutIds],
    );
    await db.query(
      "delete from public.marketplace_creator_commerce_attributions where authorized_by=$1",
      [setup.fixture.seller],
    );
    await db.query(
      "delete from public.marketplace_live_affiliate_offer_commands where seller_id=$1",
      [setup.fixture.seller],
    );
    await db.query(
      "delete from public.marketplace_live_affiliate_offers where product_id=any($1::uuid[])",
      [setup.fixture.products],
    );
    await db.query(
      "delete from public.marketplace_inventory_levels where variant_id=any($1::uuid[])",
      [setup.fixture.variants],
    );
    await db.query(
      "delete from public.marketplace_product_variants where id=any($1::uuid[])",
      [setup.fixture.variants],
    );
    await db.query("delete from public.products where id=any($1::uuid[])", [
      setup.fixture.products,
    ]);
    await db.query(
      "delete from public.marketplace_shipping_profile_regions where profile_id=$1",
      [setup.fixture.shippingProfile],
    );
    await db.query(
      "delete from public.marketplace_shipping_profiles where id=$1",
      [setup.fixture.shippingProfile],
    );
    await db.query("delete from public.marketplace_stores where id=$1", [
      setup.fixture.store,
    ]);
    await db.query("delete from public.marketplace_sellers where user_id=$1", [
      setup.fixture.seller,
    ]);
    const users = [
      setup.fixture.seller,
      setup.fixture.buyer,
      setup.fixture.buyer2,
      setup.fixture.admin,
      setup.fixture.creatorX,
      setup.fixture.creatorY,
    ];
    await db.query(
      "delete from public.ledger_accounts where owner_id=any($1::uuid[])",
      [users],
    );
    for (const account of setup.accountBaseline) {
      await db.query(
        "update public.ledger_accounts set balance=$2 where id=$1",
        [account.id, account.balance],
      );
    }
    await db.query(
      "delete from public.user_profiles where id=any($1::uuid[])",
      [users],
    );
    await db.query("delete from auth.users where id=any($1::uuid[])", [users]);
    await db.query("set local session_replication_role=origin");
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
}

async function proveConcurrency() {
  stage = "AB_AC_concurrency";
  const before = (
    await db.query(
      "select count(*)::int n from public.user_profiles where username like 'b7a%'",
    )
  ).rows[0].n;
  const setup = await createCommittedConcurrencyFixture();
  const first = new Client({ connectionString, ssl: false });
  const second = new Client({ connectionString, ssl: false });
  try {
    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([
      first.query("set role postgres"),
      second.query("set role postgres"),
    ]);
    await Promise.all([
      claim(first, "service_role", setup.fixture.admin, false),
      claim(second, "service_role", setup.fixture.admin, false),
    ]);
    const sameKey = uid();
    const sameResults = await Promise.allSettled([
      first.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3) value",
        [setup.secondOrder.item, setup.attrX.value.id, sameKey],
      ),
      second.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3) value",
        [setup.secondOrder.item, setup.attrX.value.id, sameKey],
      ),
    ]);
    assert(sameResults.every((result) => result.status === "fulfilled"));
    assert.equal(
      sameResults[0].value.rows[0].value,
      sameResults[1].value.rows[0].value,
    );

    const conflictResults = await Promise.allSettled([
      first.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3)",
        [setup.firstOrder.item, setup.attrX.value.id, uid()],
      ),
      second.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3)",
        [setup.firstOrder.item, setup.attrY.value.id, uid()],
      ),
    ]);
    assert.equal(
      conflictResults.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      conflictResults.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_attributions where order_item_id=$1",
          [setup.firstOrder.item],
        )
      ).rows[0].n,
      1,
    );

    const sameCreatorDifferentKeys = await Promise.allSettled([
      first.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3)",
        [setup.thirdOrder.item, setup.attrX.value.id, uid()],
      ),
      second.query(
        "select public.freeze_marketplace_order_item_creator_attribution($1,$2,$3)",
        [setup.thirdOrder.item, setup.attrX.value.id, uid()],
      ),
    ]);
    assert(
      sameCreatorDifferentKeys.every((result) => result.status === "fulfilled"),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_attributions where order_item_id=$1",
          [setup.thirdOrder.item],
        )
      ).rows[0].n,
      1,
    );

    await claim(second, "authenticated", setup.fixture.seller, false);
    const revokeResults = await Promise.allSettled([
      first.query(
        `select public.create_marketplace_creator_commerce_attribution(
          $1,$2,$3,'direct_creator_link',$1,$4)`,
        [
          setup.revocable.id,
          setup.fixture.creatorX,
          setup.revokeItem.variant,
          uid(),
        ],
      ),
      second.query(
        `select public.upsert_my_live_affiliate_offer(
          $1,'specific_creator',$2,900,'removed',null,null,$3)`,
        [setup.revokeItem.product, setup.fixture.creatorX, uid()],
      ),
    ]);
    assert.equal(
      revokeResults[1].status,
      "fulfilled",
      revokeResults[1].status === "rejected"
        ? revokeResults[1].reason.message
        : "",
    );
    assert(["fulfilled", "rejected"].includes(revokeResults[0].status));
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.marketplace_creator_commerce_attributions a
       join public.marketplace_live_affiliate_offers e on e.id=a.entitlement_id
       where a.entitlement_id=$1 and e.status<>'active'
         and a.entitlement_updated_at_attribution is not distinct from e.updated_at`,
          [setup.revocable.id],
        )
      ).rows[0].n,
      0,
    );

    await claim(second, "service_role", setup.fixture.admin, false);
    const settlementRace = await Promise.allSettled([
      first.query(
        "select public.finalize_marketplace_creator_commerce_for_order($1,$2)",
        [setup.settledRace.order, setup.finalizerKey],
      ),
      second.query(
        "select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)",
        [setup.fixture.admin, setup.settledRace.order, uid()],
      ),
    ]);
    assert(
      settlementRace.every((result) => result.status === "fulfilled"),
      JSON.stringify(settlementRace),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_settlements where order_id=$1",
          [setup.settledRace.order],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_allocations where order_id=$1",
          [setup.settledRace.order],
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await Promise.all([
      first.end().catch(() => {}),
      second.end().catch(() => {}),
    ]);
    await cleanupCommittedFixture(setup);
  }
  const after = (
    await db.query(
      "select count(*)::int n from public.user_profiles where username like 'b7a%'",
    )
  ).rows[0].n;
  assert.equal(after, before);
  return {
    sameRequestRace: true,
    conflictingCreatorRace: true,
    sameCreatorDifferentKeysRace: true,
    revocationRace: true,
    settlementFinalizerRace: true,
    persistentFixtures: 0,
  };
}

async function main() {
  await db.connect();
  await db.query("set role postgres");
  const authority = await proveAuthorityAndSecurity();
  const economics = await proveEconomicsAndFreeze();
  const settlement = await proveSettlementAndB7R();
  const live = await proveLiveCompatibility();
  const concurrency = await proveConcurrency();
  const reconciliation = (
    await db.query(
      "select public.reconcile_marketplace_creator_commerce() value",
    )
  ).rows[0].value;
  assert.equal(Object.keys(reconciliation).length, 36);
  for (const [name, value] of Object.entries(reconciliation)) {
    assert.equal(Number(value), 0, `creator_commerce:${name}`);
  }
  const b7f = (
    await db.query(
      "select public.reconcile_marketplace_multi_creator_allocations() value",
    )
  ).rows[0].value;
  for (const [name, value] of Object.entries(b7f)) {
    assert.equal(Number(value), 0, `b7f:${name}`);
  }
  const fixtures = (
    await db.query(
      "select count(*)::int n from auth.users where email like 'b7a-%@proof.local'",
    )
  ).rows[0].n;
  assert.equal(fixtures, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: {
          A_seller_entitlement: authority.entitlementCreation,
          B_unauthorized_self_grant: authority.selfGrantDenied,
          C_product_store_mismatch: authority.productVariantMismatchDenied,
          D_variant_mismatch: authority.productVariantMismatchDenied,
          E_active_attribution: authority.activeAttribution,
          F_expired_denied: authority.expiredDenied,
          G_revoked_denied: authority.revokedDenied,
          H_historical_freeze_preserved: economics.frozen,
          I_client_amount_denied: authority.arbitraryBpsAndAmountDenied,
          J_arbitrary_bps_denied: authority.arbitraryBpsAndAmountDenied,
          K_source_snapshot: true,
          L_idempotent_retry: authority.idempotentRetry,
          M_idempotency_conflict: authority.idempotencyConflict,
          N_conflicting_creator_race: concurrency.conflictingCreatorRace,
          O_duplicate_item_denied: concurrency.conflictingCreatorRace,
          P_zero_creator: economics.zero,
          Q_one_creator_equivalence: economics.one,
          R_two_creators: economics.two,
          S_same_creator_multiple_items: economics.same,
          T_mixed_attribution: economics.mixed,
          U_bps_change_after_freeze: economics.frozen,
          V_b7a_to_b7f_handoff: true,
          W_settlement_exact: true,
          X_b7r_reversal: settlement.reversal,
          Y_b7r_insufficient: settlement.insufficient,
          Z_live_affiliate: live.affiliateExact,
          AA_live_own_product: live.ownProductZero,
          AB_settlement_race: concurrency.settlementFinalizerRace,
          AC_two_connection_attribution: concurrency.sameRequestRace,
          AD_security_rls: authority.security,
          AE_reconciliation_zero: true,
          AF_persistent_fixtures_zero: concurrency.persistentFixtures === 0,
        },
        creator_commerce_reconciliation: reconciliation,
        b7f_reconciliation: b7f,
        persistent_fixtures: fixtures,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        stage,
        message: error.message,
        code: error.code,
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
  });
