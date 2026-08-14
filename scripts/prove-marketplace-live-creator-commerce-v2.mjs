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
  throw new Error("B7E_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}

const db = new Client({ connectionString, ssl: false });
const uid = () => randomUUID();
const money = (value) => Number(value);
const addressSql = `jsonb_build_object(
  'recipient_name','B7E','line1','Proof Street','city','New York',
  'region','NY','postal_code','10001','country','US')`;
let stage = "connect";

async function claim(client, role, sub = "", local = true) {
  await client.query(
    "select set_config('request.jwt.claim.role',$1,$3),set_config('request.jwt.claim.sub',$2,$3)",
    [role, sub, local],
  );
}

async function expectedError(client, action, message) {
  const savepoint = `b7e_${uid().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  assert.equal(caught?.message, message, `expected_${message}`);
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

async function insertUser(client, id, label, admin = false, prefix = "b7e") {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(
    `insert into auth.users(
       id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated',
       'authenticated',$2,'proof',now(),now(),now())`,
    [id, `${prefix}-${label}-${token}@proof.local`],
  );
  await client.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `${prefix}${label}${token}`, `B7E ${label}`, admin],
  );
}

async function fixture(client, prefix = "b7e") {
  const f = {
    prefix,
    seller: uid(),
    buyer: uid(),
    buyerTwo: uid(),
    admin: uid(),
    creator: uid(),
    creatorTwo: uid(),
    outsider: uid(),
    store: uid(),
    shipping: uid(),
    products: [],
    variants: [],
    sessions: [],
  };
  await insertUser(client, f.seller, "seller", false, prefix);
  await insertUser(client, f.buyer, "buyer", false, prefix);
  await insertUser(client, f.buyerTwo, "buyertwo", false, prefix);
  await insertUser(client, f.admin, "admin", true, prefix);
  await insertUser(client, f.creator, "creator", false, prefix);
  await insertUser(client, f.creatorTwo, "creatortwo", false, prefix);
  await insertUser(client, f.outsider, "outsider", false, prefix);
  await client.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7E Seller',now())",
    [f.seller],
  );
  await client.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7E Store',$3,'active')",
    [f.store, f.seller, `${prefix}-${uid()}`],
  );
  await client.query(
    `insert into public.marketplace_shipping_profiles(
       id,seller_id,store_id,name,processing_days_min,processing_days_max,
       ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7E Ground',1,2,'US','B7E proof')`,
    [f.shipping, f.seller, f.store],
  );
  await client.query(
    "insert into public.marketplace_shipping_profile_regions(profile_id,country_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',0,1,2)",
    [f.shipping],
  );
  return f;
}

async function product(client, f, price, label, stock = 40) {
  const item = { product: uid(), variant: uid(), price, label };
  const sku = `B7E-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(
    `insert into public.products(
       id,seller_id,title,description,price,currency,category,stock,status,store_id,
       category_id,product_type,moderation_status,published_at,shipping_profile_id,images)
     values($1,$2,$3,'LIVE V2 proof',$4,'BDAG','physical',$7,'active',$5,
       '10000000-0000-4000-8000-000000000002','physical','approved',now(),$6,$8)`,
    [
      item.product,
      f.seller,
      `B7E ${label}`,
      price,
      f.store,
      f.shipping,
      stock,
      [`https://proof.local/${label}.jpg`],
    ],
  );
  await client.query(
    `insert into public.marketplace_product_variants(
       id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',$6,'active',true,'')`,
    [item.variant, item.product, f.store, f.seller, sku, price],
  );
  await client.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,$2,0)",
    [item.variant, stock],
  );
  f.products.push(item.product);
  f.variants.push(item.variant);
  return item;
}

async function offer(
  client,
  f,
  item,
  bps,
  status = "active",
  creator = f.creator,
) {
  await claim(client, "authenticated", f.seller, false);
  return (
    await client.query(
      "select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,$3,$4,null,null,$5)value",
      [item.product, creator, bps, status, uid()],
    )
  ).rows[0].value;
}

async function startLive(client, f, host, title) {
  const session = uid();
  await claim(client, "authenticated", host, false);
  await client.query("select * from public.start_live_session($1,$2)", [
    session,
    title,
  ]);
  f.sessions.push(session);
  return session;
}

async function pin(client, host, session, item, key = uid()) {
  await claim(client, "authenticated", host, false);
  return (
    await client.query(
      "select public.pin_live_session_product($1,$2,$3,$4)value",
      [session, item.product, item.variant, key],
    )
  ).rows[0].value;
}

async function liveAttribution(client, buyer, pinId, variantId, key = uid()) {
  await claim(client, "authenticated", buyer, false);
  return (
    await client.query(
      "select public.create_marketplace_creator_live_attribution($1,$2,$3)value",
      [pinId, variantId, key],
    )
  ).rows[0].value;
}

async function fund(client, f, buyer, amount) {
  await claim(client, "service_role", f.admin, false);
  const platform = (
    await client.query("select public.ensure_marketplace_platform_account()id")
  ).rows[0].id;
  const buyerAccount = (
    await client.query("select public.ensure_ledger_account($1)id", [buyer])
  ).rows[0].id;
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,
       status,reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed',
       'marketplace_b7e_proof',$5,$6,$7)`,
    [
      transaction,
      platform,
      buyerAccount,
      amount,
      f.store,
      `b7e-fund:${transaction}`,
      buyer,
    ],
  );
  await client.query(
    "select public.ledger_debit($1,$2,$3,'B7E proof funding','{}'),public.ledger_credit($1,$4,$3,'B7E proof funding','{}')",
    [transaction, platform, amount, buyerAccount],
  );
  return { platform, buyerAccount };
}

async function creatorCheckout(client, f, buyer, lines) {
  await claim(client, "authenticated", buyer, false);
  const receipt = (
    await client.query(
      `select public.create_marketplace_creator_checkout_reservation(
         $1::jsonb,${addressSql},$2)value`,
      [
        JSON.stringify(
          lines.map((line) => ({
            variant_id: line.item.variant,
            quantity: line.quantity ?? 1,
            ...(line.attribution
              ? { attribution_id: line.attribution.id }
              : {}),
          })),
        ),
        uid(),
      ],
    )
  ).rows[0].value;
  assert.equal(receipt.orders.length, 1, "b7e_same_store_order");
  return {
    checkout: receipt.checkout.id,
    order: receipt.orders[0].id,
  };
}

async function pay(client, f, buyer, checkout) {
  await claim(client, "service_role", f.admin, false);
  await client.query(
    "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
    [buyer, checkout, uid()],
  );
}

async function settle(client, f, order, buyer = f.buyer) {
  await claim(client, "authenticated", f.seller, false);
  await client.query(
    "select public.seller_start_marketplace_order_processing($1,$2)",
    [order, uid()],
  );
  await client.query(
    "select public.seller_ship_marketplace_order($1,'B7E','Ground',$2,null,null,$3)",
    [order, `B7E-${uid().slice(0, 8)}`, uid()],
  );
  await claim(client, "service_role", f.admin, false);
  await client.query(
    "select public.confirm_marketplace_order_delivery_and_release($1,$2,$3)",
    [buyer, order, uid()],
  );
  const settlement = (
    await client.query(
      "select * from public.marketplace_order_settlements where order_id=$1",
      [order],
    )
  ).rows[0];
  const legs = (
    await client.query(
      "select leg_type,beneficiary_user_id,amount from public.marketplace_settlement_legs where settlement_id=$1 order by leg_type,beneficiary_user_id",
      [settlement.id],
    )
  ).rows;
  return { settlement, legs };
}

async function analytics(client, creator) {
  await claim(client, "authenticated", creator, false);
  return (
    await client.query(
      "select public.get_my_marketplace_creator_commerce_analytics('all')value",
    )
  ).rows[0].value;
}

async function recordLiveEvent(client, buyer, event, item, pinId, session) {
  await claim(client, "authenticated", buyer, false);
  return (
    await client.query(
      `select public.record_marketplace_commerce_event(
        $1,$2,$3,$4,'live',$5,null,$6,$7,'{}',$8)id`,
      [
        event,
        item.product,
        item.variant,
        uid(),
        pinId,
        session,
        event === "add_to_cart" ? 1 : null,
        `b7e-event:${uid()}`,
      ],
    )
  ).rows[0].id;
}

async function feedAttribution(client, f, item, creator) {
  const contentId = uid();
  await claim(client, "authenticated", creator, false);
  await client.query(
    "insert into public.videos(id,user_id,video_url,caption,media_urls)values($1,$2,$3,'B7E mixed surface',$4)",
    [
      contentId,
      creator,
      `https://proof.local/${contentId}.jpg`,
      [`https://proof.local/${contentId}.jpg`],
    ],
  );
  const tags = (
    await client.query(
      "select public.set_my_marketplace_content_product_tags('feed',$1,$2,$3)value",
      [contentId, [item.product], uid()],
    )
  ).rows[0].value;
  await claim(client, "authenticated", f.buyer, false);
  const attribution = (
    await client.query(
      "select public.create_marketplace_creator_content_attribution($1,$2,$3)value",
      [tags.items[0].id, item.variant, uid()],
    )
  ).rows[0].value;
  return { contentId, tagId: tags.items[0].id, attribution };
}

async function authorityScenario() {
  return transactionScenario("authority", async () => {
    const f = await fixture(db);
    const affiliate = await product(db, f, 50, "Affiliate");
    const replacement = await product(db, f, 30, "Replacement");
    const own = await product(db, f, 25, "Own");
    await offer(db, f, affiliate, 1200);
    await offer(db, f, replacement, 800);
    const session = await startLive(db, f, f.creator, "B7E affiliate LIVE");
    const affiliatePin = await pin(db, f.creator, session, affiliate);
    assert.equal(affiliatePin.commerce_mode, "affiliate_product");
    assert.equal(affiliatePin.creator_commission_bps, 1200);

    const visible = (
      await db.query("select public.fetch_live_session_products($1)value", [
        session,
      ])
    ).rows[0].value;
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, affiliatePin.id);

    await recordLiveEvent(
      db,
      f.buyer,
      "product_view",
      affiliate,
      affiliatePin.id,
      session,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_creator_commerce_attributions where source_entity_id=$1",
          [affiliatePin.id],
        )
      ).rows[0].n,
      0,
      "passive_view_created_financial_attribution",
    );

    const key = uid();
    const first = await liveAttribution(
      db,
      f.buyer,
      affiliatePin.id,
      affiliate.variant,
      key,
    );
    const retry = await liveAttribution(
      db,
      f.buyer,
      affiliatePin.id,
      affiliate.variant,
      key,
    );
    assert.deepEqual(retry, first);
    assert.equal(first.source_surface, "live");
    assert.equal(first.source_entity_id, affiliatePin.id);
    assert.equal(first.creator_user_id, f.creator);
    assert.equal(first.product_id, affiliate.product);
    assert.equal(first.commission_bps, 1200);

    await claim(db, "authenticated", f.outsider, false);
    await expectedError(
      db,
      () =>
        db.query(
          "select public.unpin_live_session_product($1,$2,$3)",
          [session, affiliatePin.id, uid()],
        ),
      "live_commerce_host_not_eligible",
    );
    await claim(db, "authenticated", f.buyer, false);
    await expectedError(
      db,
      () =>
        db.query(
          "select public.feature_live_session_product($1,$2,$3)",
          [session, affiliatePin.id, uid()],
        ),
      "live_commerce_host_not_eligible",
    );

    await offer(db, f, affiliate, 1200, "removed");
    await expectedError(
      db,
      () => liveAttribution(db, f.buyer, affiliatePin.id, affiliate.variant),
      "marketplace_creator_entitlement_ineligible",
    );
    const historical = (
      await db.query(
        "select commission_bps from public.marketplace_creator_commerce_attributions where id=$1",
        [first.id],
      )
    ).rows[0];
    assert.equal(historical.commission_bps, 1200);

    await offer(db, f, affiliate, 900);
    await expectedError(
      db,
      () => liveAttribution(db, f.buyer, affiliatePin.id, affiliate.variant),
      "marketplace_creator_entitlement_ineligible",
    );
    await claim(db, "authenticated", f.creator, false);
    await db.query(
      "select public.unpin_live_session_product($1,$2,$3)",
      [session, affiliatePin.id, uid()],
    );
    const repin = await pin(db, f.creator, session, affiliate);
    const changed = await liveAttribution(
      db,
      f.buyer,
      repin.id,
      affiliate.variant,
    );
    assert.equal(changed.commission_bps, 900);
    assert.equal(first.commission_bps, 1200);

    await claim(db, "authenticated", f.creator, false);
    await db.query(
      "select public.unpin_live_session_product($1,$2,$3)",
      [session, repin.id, uid()],
    );
    await expectedError(
      db,
      () => liveAttribution(db, f.buyer, repin.id, affiliate.variant),
      "marketplace_creator_live_source_unavailable",
    );

    const ownSession = await startLive(db, f, f.seller, "B7E own LIVE");
    const ownPin = await pin(db, f.seller, ownSession, own);
    assert.equal(ownPin.commerce_mode, "own_product");
    assert.equal(ownPin.creator_commission_bps, 0);
    const ownReceipt = await liveAttribution(
      db,
      f.buyer,
      ownPin.id,
      own.variant,
    );
    assert.equal(ownReceipt.id, null);
    assert.equal(ownReceipt.creator_user_id, null);
    assert.equal(ownReceipt.commerce_mode, "own_product");
    await claim(db, "authenticated", f.buyer, false);
    const ownCheckout = (
      await db.query(
        `select public.create_live_marketplace_checkout_reservation(
           $1,$2,$3,1,${addressSql},$4)value`,
        [ownSession, ownPin.id, own.variant, uid()],
      )
    ).rows[0].value;
    assert.equal(ownCheckout.orders.length, 1);
    const ownOrder = ownCheckout.orders[0].id;
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_live_order_sources where order_id=$1 and live_session_product_id=$2",
          [ownOrder, ownPin.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_order_item_creator_attributions where order_id=$1",
          [ownOrder],
        )
      ).rows[0].n,
      0,
      "own_product_checkout_invented_affiliate_attribution",
    );

    await claim(db, "authenticated", f.seller, false);
    await db.query("select public.end_live_session($1,'host_ended')", [
      ownSession,
    ]);
    await expectedError(
      db,
      () => liveAttribution(db, f.buyer, ownPin.id, own.variant),
      "marketplace_creator_live_source_unavailable",
    );
    await expectedError(
      db,
      () => pin(db, f.seller, ownSession, replacement),
      "live_commerce_host_not_eligible",
    );

    const badEvent = await recordLiveEvent(
      db,
      f.buyer,
      "product_view",
      replacement,
      affiliatePin.id,
      session,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.marketplace_creator_commerce_event_facts where id=$1",
          [badEvent],
        )
      ).rows[0].n,
      0,
      "mismatched_live_event_poisoned_creator_analytics",
    );

    const invalidationPin = await pin(db, f.creator, session, replacement);
    await claim(db, "service_role", f.admin, false);
    await db.query(
      "update public.products set status='deleted',deleted_at=now(),updated_at=now() where id=$1",
      [replacement.product],
    );
    await expectedError(
      db,
      () =>
        liveAttribution(
          db,
          f.buyer,
          invalidationPin.id,
          replacement.variant,
        ),
      "marketplace_creator_entitlement_product_ineligible",
    );

    return {
      hostOnlyMutation: true,
      viewerMutationDenied: true,
      ownProductNoAffiliate: true,
      ownProductCheckout: true,
      passiveViewNonFinancial: true,
      explicitAttribution: true,
      revokedOfferRejected: true,
      offerChangeRequiresRepin: true,
      oldBpsFrozen: 1200,
      newBps: 900,
      unpinRejectedFreshAttribution: true,
      endedLiveRejected: true,
      invalidatedProductRejected: true,
      eventPoisoningExcluded: true,
    };
  });
}

async function financialScenario(insufficient = false) {
  return transactionScenario(
    insufficient ? "financial_insufficient" : "financial_reversal",
    async () => {
      const f = await fixture(db, insufficient ? "b7einsufficient" : "b7efinance");
      const liveItem = await product(db, f, 50, "LiveSale");
      const ordinary = await product(db, f, 50, "Ordinary");
      await offer(db, f, liveItem, 1000);
      const session = await startLive(db, f, f.creator, "B7E financial LIVE");
      const livePin = await pin(db, f.creator, session, liveItem);
      await recordLiveEvent(
        db,
        f.buyer,
        "product_view",
        liveItem,
        livePin.id,
        session,
      );
      await recordLiveEvent(
        db,
        f.buyer,
        "add_to_cart",
        liveItem,
        livePin.id,
        session,
      );
      const attribution = await liveAttribution(
        db,
        f.buyer,
        livePin.id,
        liveItem.variant,
      );
      const funded = await fund(db, f, f.buyer, 200);
      const commerce = await creatorCheckout(db, f, f.buyer, [
        { item: liveItem, attribution },
        { item: ordinary },
      ]);
      await pay(db, f, f.buyer, commerce.checkout);

      const allocation = (
        await db.query(
          "select * from public.marketplace_payment_allocations where order_id=$1",
          [commerce.order],
        )
      ).rows[0];
      assert.equal(money(allocation.gross_amount), 100);
      assert.equal(money(allocation.platform_fee_amount), 10);
      assert.equal(money(allocation.creator_commission_amount), 5);
      assert.equal(money(allocation.seller_net_amount), 85);
      const snapshots = (
        await db.query(
          `select s.source_surface,s.source_entity_id,s.creator_user_id,s.product_id,
             i.quantity,a.commission_base_amount,a.commission_amount
           from public.marketplace_order_item_creator_attributions s
           join public.marketplace_order_items i on i.id=s.order_item_id
           join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id
           where s.order_id=$1`,
          [commerce.order],
        )
      ).rows;
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].source_surface, "live");
      assert.equal(snapshots[0].source_entity_id, livePin.id);
      assert.equal(snapshots[0].creator_user_id, f.creator);
      assert.equal(snapshots[0].product_id, liveItem.product);
      assert.equal(money(snapshots[0].commission_base_amount), 50);
      assert.equal(money(snapshots[0].commission_amount), 5);

      const beforeRelease = await analytics(db, f.creator);
      const beforeLive = beforeRelease.surface_breakdown.find(
        (row) => row.source_surface === "live",
      );
      assert(beforeLive);
      assert.equal(money(beforeLive.product_opens), 1);
      assert.equal(money(beforeLive.add_to_cart), 1);
      assert.equal(money(beforeLive.orders), 1);
      assert.equal(money(beforeLive.units_sold), 1);
      assert.equal(money(beforeLive.attributed_gmv), 50);
      assert.equal(money(beforeLive.commission_generated), 5);
      assert.equal(money(beforeLive.commission_released), 0);

      const released = await settle(db, f, commerce.order);
      const totals = new Map();
      for (const leg of released.legs) {
        totals.set(
          leg.leg_type,
          (totals.get(leg.leg_type) ?? 0) + money(leg.amount),
        );
      }
      assert.deepEqual(
        totals,
        new Map([
          ["creator_commission", 5],
          ["platform_fee", 10],
          ["seller_net", 85],
        ]),
      );
      const afterRelease = await analytics(db, f.creator);
      const releasedLive = afterRelease.surface_breakdown.find(
        (row) => row.source_surface === "live",
      );
      assert.equal(money(releasedLive.commission_released), 5);
      assert.equal(money(releasedLive.commission_net), 5);

      await claim(db, "service_role", f.admin, false);
      const review = (
        await db.query(
          "select public.open_marketplace_post_settlement_review($1,$2,'b7e_live_v2','proof',$3)value",
          [f.admin, commerce.order, uid()],
        )
      ).rows[0].value;

      if (insufficient) {
        const creatorAccount = (
          await db.query(
            "select id from public.ledger_accounts where owner_id=$1 and account_type='user'and currency='BDAG'",
            [f.creator],
          )
        ).rows[0].id;
        const transaction = uid();
        await db.query(
          `insert into public.financial_transactions(
             id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,
             status,reference_type,reference_id,idempotency_key,initiated_by)
           values($1,$2,$3,'marketplace_test_drain',1,0,'BDAG','completed',
             'marketplace_b7e_proof',$4,$5,$6)`,
          [
            transaction,
            creatorAccount,
            funded.platform,
            commerce.order,
            `b7e-drain:${transaction}`,
            f.admin,
          ],
        );
        await db.query(
          "select public.ledger_debit($1,$2,1,'B7E insufficient','{}'),public.ledger_credit($1,$3,1,'B7E insufficient','{}')",
          [transaction, creatorAccount, funded.platform],
        );
        const balances = async () =>
          (
            await db.query(
              "select id,balance from public.ledger_accounts where owner_id=any($1::uuid[])or id=any($2::uuid[])order by id",
              [
                [f.seller, f.buyer, f.creator],
                [funded.platform, funded.buyerAccount],
              ],
            )
          ).rows;
        const before = await balances();
        const result = (
          await db.query(
            "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7e_full_refund','proof',$3,null)value",
            [f.admin, review.dispute_id, uid()],
          )
        ).rows[0].value;
        assert.equal(result.money_moved, false);
        assert.deepEqual(await balances(), before);
        const after = await analytics(db, f.creator);
        assert.equal(money(after.summary.commission_reversed), 0);
        return {
          moneyMoved: false,
          noPartialMovement: true,
          fakeReversalAnalytics: false,
        };
      }

      const beforeRows = (
        await db.query(
          "select owner_id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'",
          [[f.seller, f.buyer, f.creator]],
        )
      ).rows;
      const before = new Map(
        beforeRows.map((row) => [row.owner_id, money(row.balance)]),
      );
      const platformBefore = money(
        (
          await db.query("select balance from public.ledger_accounts where id=$1", [
            funded.platform,
          ])
        ).rows[0].balance,
      );
      const result = (
        await db.query(
          "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','b7e_full_refund','proof',$3,null)value",
          [f.admin, review.dispute_id, uid()],
        )
      ).rows[0].value;
      assert.equal(result.finalDecision.financial_result.money_moved, true);
      const afterRows = (
        await db.query(
          "select owner_id,balance from public.ledger_accounts where owner_id=any($1::uuid[])and account_type='user'and currency='BDAG'",
          [[f.seller, f.buyer, f.creator]],
        )
      ).rows;
      const after = new Map(
        afterRows.map((row) => [row.owner_id, money(row.balance)]),
      );
      assert.equal(before.get(f.seller) - after.get(f.seller), 85);
      assert.equal(before.get(f.creator) - after.get(f.creator), 5);
      assert.equal(after.get(f.buyer) - before.get(f.buyer), 100);
      assert.equal(
        platformBefore -
          money(
            (
              await db.query(
                "select balance from public.ledger_accounts where id=$1",
                [funded.platform],
              )
            ).rows[0].balance,
          ),
        10,
      );
      const reversed = await analytics(db, f.creator);
      const reversedLive = reversed.surface_breakdown.find(
        (row) => row.source_surface === "live",
      );
      assert.equal(money(reversedLive.commission_generated), 5);
      assert.equal(money(reversedLive.commission_released), 5);
      assert.equal(money(reversedLive.commission_reversed), 5);
      assert.equal(money(reversedLive.commission_net), 0);
      return {
        gross: 100,
        seller: 85,
        platform: 10,
        creator: 5,
        buyerRefund: 100,
        liveItemGmv: 50,
        ordinaryItemExcluded: true,
        b7dLiveAnalytics: true,
      };
    },
  );
}

async function multiSurfaceScenario() {
  return transactionScenario("multi_surface_order", async () => {
    const f = await fixture(db, "b7emultisurface");
    const liveA = await product(db, f, 20, "LiveA");
    const liveB = await product(db, f, 30, "LiveB");
    const feed = await product(db, f, 50, "FeedCreatorTwo");
    const ordinary = await product(db, f, 50, "OrdinaryMixed");
    await offer(db, f, liveA, 1000);
    await offer(db, f, liveB, 1000);
    await offer(db, f, feed, 1400, "active", f.creatorTwo);
    const session = await startLive(db, f, f.creator, "B7E multi-item LIVE");
    const pinA = await pin(db, f.creator, session, liveA);
    const pinB = await pin(db, f.creator, session, liveB);
    const attrA = await liveAttribution(db, f.buyer, pinA.id, liveA.variant);
    const attrB = await liveAttribution(db, f.buyer, pinB.id, liveB.variant);
    const feedContext = await feedAttribution(db, f, feed, f.creatorTwo);
    await fund(db, f, f.buyer, 200);
    const commerce = await creatorCheckout(db, f, f.buyer, [
      { item: liveA, attribution: attrA },
      { item: liveB, attribution: attrB },
      { item: feed, attribution: feedContext.attribution },
      { item: ordinary },
    ]);
    await pay(db, f, f.buyer, commerce.checkout);
    const allocation = (
      await db.query(
        "select * from public.marketplace_payment_allocations where order_id=$1",
        [commerce.order],
      )
    ).rows[0];
    assert.equal(money(allocation.gross_amount), 150);
    assert.equal(money(allocation.platform_fee_amount), 15);
    assert.equal(money(allocation.creator_commission_amount), 12);
    assert.equal(money(allocation.seller_net_amount), 123);

    const snapshots = (
      await db.query(
        `select s.creator_user_id,s.source_surface,s.source_entity_id,s.product_id,
           a.commission_base_amount,a.commission_amount
         from public.marketplace_order_item_creator_attributions s
         join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id
         where s.order_id=$1 order by s.creator_user_id,s.product_id`,
        [commerce.order],
      )
    ).rows;
    assert.equal(snapshots.length, 3);
    const creatorRows = snapshots.filter(
      (row) => row.creator_user_id === f.creator,
    );
    assert.equal(creatorRows.length, 2);
    assert(creatorRows.every((row) => row.source_surface === "live"));
    assert.deepEqual(
      new Set(creatorRows.map((row) => row.source_entity_id)),
      new Set([pinA.id, pinB.id]),
    );
    assert.equal(
      creatorRows.reduce(
        (sum, row) => sum + money(row.commission_base_amount),
        0,
      ),
      50,
    );
    assert.equal(
      creatorRows.reduce(
        (sum, row) => sum + money(row.commission_amount),
        0,
      ),
      5,
    );
    const creatorTwoRow = snapshots.find(
      (row) => row.creator_user_id === f.creatorTwo,
    );
    assert.equal(creatorTwoRow.source_surface, "feed");
    assert.equal(creatorTwoRow.source_entity_id, feedContext.tagId);
    assert.equal(money(creatorTwoRow.commission_base_amount), 50);
    assert.equal(money(creatorTwoRow.commission_amount), 7);

    const creatorAnalytics = await analytics(db, f.creator);
    const liveSurface = creatorAnalytics.surface_breakdown.find(
      (row) => row.source_surface === "live",
    );
    assert.equal(money(liveSurface.orders), 1);
    assert.equal(money(liveSurface.units_sold), 2);
    assert.equal(money(liveSurface.attributed_gmv), 50);
    assert.equal(money(liveSurface.commission_generated), 5);
    const otherAnalytics = await analytics(db, f.creatorTwo);
    assert.equal(money(otherAnalytics.summary.attributed_orders), 1);
    assert.equal(money(otherAnalytics.summary.attributed_gmv), 50);
    assert.equal(money(otherAnalytics.summary.commission_generated), 7);

    const released = await settle(db, f, commerce.order);
    const creatorLegs = released.legs.filter(
      (leg) => leg.leg_type === "creator_commission",
    );
    assert.deepEqual(
      new Map(
        creatorLegs.map((leg) => [
          leg.beneficiary_user_id,
          money(leg.amount),
        ]),
      ),
      new Map([
        [f.creator, 5],
        [f.creatorTwo, 7],
      ]),
    );
    return {
      oneOrder: true,
      liveCreatorItems: 2,
      liveCreatorOrders: 1,
      liveCreatorGmv: 50,
      liveCreatorCommission: 5,
      feedCreatorGmv: 50,
      feedCreatorCommission: 7,
      ordinaryItemExcluded: true,
      gross: 150,
      seller: 123,
      platform: 15,
      totalCreatorCommission: 12,
    };
  });
}

async function reconcile(client, name, count) {
  await claim(client, "service_role", "", false);
  const value = (
    await client.query(`select public.${name}()value`)
  ).rows[0].value;
  assert.equal(Object.keys(value).length, count, `${name}_counter_count`);
  for (const [key, result] of Object.entries(value)) {
    assert.equal(Number(result), 0, `${name}:${key}`);
  }
}

async function cleanupCommittedFixture(f) {
  const users = [
    f.seller,
    f.buyer,
    f.buyerTwo,
    f.admin,
    f.creator,
    f.creatorTwo,
    f.outsider,
  ];
  await db.query("set session_replication_role=replica");
  try {
    const checkouts = (
      await db.query(
        "select id from public.marketplace_checkout_sessions where buyer_id=any($1::uuid[])",
        [users],
      )
    ).rows.map((row) => row.id);
    const orders = checkouts.length
      ? (
          await db.query(
            "select id from public.marketplace_orders where checkout_id=any($1::uuid[])",
            [checkouts],
          )
        ).rows.map((row) => row.id)
      : [];
    if (orders.length) {
      await db.query(
        "delete from public.marketplace_order_item_creator_allocations where order_id=any($1::uuid[])",
        [orders],
      );
      await db.query(
        "delete from public.marketplace_order_item_creator_attributions where order_id=any($1::uuid[])",
        [orders],
      );
      await db.query(
        "delete from public.marketplace_order_items where order_id=any($1::uuid[])",
        [orders],
      );
      await db.query(
        "delete from public.marketplace_orders where id=any($1::uuid[])",
        [orders],
      );
    }
    if (checkouts.length) {
      await db.query(
        "delete from public.marketplace_order_shipping_snapshots where checkout_id=any($1::uuid[])",
        [checkouts],
      );
      await db.query(
        "delete from public.marketplace_inventory_reservations where checkout_id=any($1::uuid[])",
        [checkouts],
      );
      await db.query(
        "delete from public.marketplace_creator_checkout_commands where buyer_id=any($1::uuid[])",
        [users],
      );
      await db.query(
        "delete from public.marketplace_checkout_sessions where id=any($1::uuid[])",
        [checkouts],
      );
    }
    await db.query(
      "delete from public.marketplace_creator_commerce_attributions where source_surface='live'and source_entity_id in(select id from public.live_session_products where session_id=any($1::uuid[]))",
      [f.sessions],
    );
    await db.query(
      "delete from public.live_commerce_commands where session_id=any($1::uuid[])",
      [f.sessions],
    );
    await db.query(
      "delete from public.live_session_products where session_id=any($1::uuid[])",
      [f.sessions],
    );
    await db.query(
      "delete from public.live_sessions where id=any($1::uuid[])",
      [f.sessions],
    );
    await db.query(
      "delete from public.marketplace_live_affiliate_offer_commands where seller_id=$1",
      [f.seller],
    );
    await db.query(
      "delete from public.marketplace_live_affiliate_offers where seller_id=$1",
      [f.seller],
    );
    await db.query(
      "delete from public.marketplace_inventory_levels where variant_id=any($1::uuid[])",
      [f.variants],
    );
    await db.query(
      "delete from public.marketplace_product_variants where id=any($1::uuid[])",
      [f.variants],
    );
    await db.query(
      "delete from public.products where id=any($1::uuid[])",
      [f.products],
    );
    await db.query(
      "delete from public.marketplace_shipping_profile_regions where profile_id=$1",
      [f.shipping],
    );
    await db.query(
      "delete from public.marketplace_shipping_profiles where id=$1",
      [f.shipping],
    );
    await db.query("delete from public.marketplace_stores where id=$1", [f.store]);
    await db.query("delete from public.marketplace_sellers where user_id=$1", [
      f.seller,
    ]);
    await db.query("delete from public.user_profiles where id=any($1::uuid[])", [
      users,
    ]);
    await db.query("delete from auth.users where id=any($1::uuid[])", [users]);
  } finally {
    await db.query("set session_replication_role=origin");
  }
}

async function concurrencyScenario() {
  stage = "two_connection_concurrency";
  const f = await fixture(db, "b7econcurrency");
  const pinItem = await product(db, f, 20, "PinRace");
  const featureItem = await product(db, f, 21, "FeatureRace");
  const stockItem = await product(db, f, 30, "FinalStock", 1);
  const revokeItem = await product(db, f, 40, "RevokeRace");
  const endItem = await product(db, f, 22, "EndRace");
  await offer(db, f, pinItem, 1000);
  await offer(db, f, featureItem, 1000);
  await offer(db, f, stockItem, 1000);
  await offer(db, f, revokeItem, 1200);
  await offer(db, f, endItem, 1000);
  const session = await startLive(db, f, f.creator, "B7E concurrency LIVE");
  const first = new Client({ connectionString, ssl: false });
  const second = new Client({ connectionString, ssl: false });
  await Promise.all([first.connect(), second.connect()]);
  const noDeadlock = (results, label) => {
    for (const result of results) {
      if (result.status === "rejected") {
        assert.notEqual(result.reason?.code, "40P01", `${label}_deadlock`);
      }
    }
  };
  try {
    await Promise.all([
      claim(first, "authenticated", f.creator, false),
      claim(second, "authenticated", f.creator, false),
    ]);
    const pinRace = await Promise.allSettled([
      first.query(
        "select public.pin_live_session_product($1,$2,$3,$4)value",
        [session, pinItem.product, pinItem.variant, uid()],
      ),
      second.query(
        "select public.pin_live_session_product($1,$2,$3,$4)value",
        [session, pinItem.product, pinItem.variant, uid()],
      ),
    ]);
    noDeadlock(pinRace, "pin_race");
    assert(pinRace.every((result) => result.status === "fulfilled"));
    assert.equal(
      pinRace[0].value.rows[0].value.id,
      pinRace[1].value.rows[0].value.id,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.live_session_products where session_id=$1 and product_id=$2 and status='active'",
          [session, pinItem.product],
        )
      ).rows[0].n,
      1,
    );

    const featurePin = await pin(db, f.creator, session, featureItem);
    const pinId = pinRace[0].value.rows[0].value.id;
    await Promise.all([
      claim(first, "authenticated", f.creator, false),
      claim(second, "authenticated", f.creator, false),
    ]);
    const highlightRace = await Promise.allSettled([
      first.query(
        "select public.feature_live_session_product($1,$2,$3)value",
        [session, pinId, uid()],
      ),
      second.query(
        "select public.feature_live_session_product($1,$2,$3)value",
        [session, featurePin.id, uid()],
      ),
    ]);
    noDeadlock(highlightRace, "highlight_race");
    assert(
      highlightRace.every((result) => result.status === "fulfilled"),
      JSON.stringify(
        highlightRace.map((result) =>
          result.status === "fulfilled"
            ? "fulfilled"
            : { code: result.reason?.code, message: result.reason?.message },
        ),
      ),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.live_session_products where session_id=$1 and status='active'and is_featured",
          [session],
        )
      ).rows[0].n,
      1,
    );

    const stockPin = await pin(db, f.creator, session, stockItem);
    const stockAttrOne = await liveAttribution(
      db,
      f.buyer,
      stockPin.id,
      stockItem.variant,
    );
    const stockAttrTwo = await liveAttribution(
      db,
      f.buyerTwo,
      stockPin.id,
      stockItem.variant,
    );
    await Promise.all([
      claim(first, "authenticated", f.buyer, false),
      claim(second, "authenticated", f.buyerTwo, false),
    ]);
    const inventoryRace = await Promise.allSettled([
      first.query(
        `select public.create_marketplace_creator_checkout_reservation(
          $1::jsonb,${addressSql},$2)value`,
        [
          JSON.stringify([
            {
              variant_id: stockItem.variant,
              quantity: 1,
              attribution_id: stockAttrOne.id,
            },
          ]),
          uid(),
        ],
      ),
      second.query(
        `select public.create_marketplace_creator_checkout_reservation(
          $1::jsonb,${addressSql},$2)value`,
        [
          JSON.stringify([
            {
              variant_id: stockItem.variant,
              quantity: 1,
              attribution_id: stockAttrTwo.id,
            },
          ]),
          uid(),
        ],
      ),
    ]);
    noDeadlock(inventoryRace, "inventory_race");
    assert.equal(
      inventoryRace.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      inventoryRace.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select reserved from public.marketplace_inventory_levels where variant_id=$1",
          [stockItem.variant],
        )
      ).rows[0].reserved,
      1,
    );

    const revokePin = await pin(db, f.creator, session, revokeItem);
    await Promise.all([
      claim(first, "authenticated", f.seller, false),
      claim(second, "authenticated", f.buyer, false),
    ]);
    const revokeRace = await Promise.allSettled([
      first.query(
        "select public.upsert_my_live_affiliate_offer($1,'specific_creator',$2,1200,'removed',null,null,$3)value",
        [revokeItem.product, f.creator, uid()],
      ),
      second.query(
        "select public.create_marketplace_creator_live_attribution($1,$2,$3)value",
        [revokePin.id, revokeItem.variant, uid()],
      ),
    ]);
    noDeadlock(revokeRace, "revoke_race");
    assert.equal(revokeRace[0].status, "fulfilled");
    if (revokeRace[1].status === "fulfilled") {
      assert.equal(revokeRace[1].value.rows[0].value.commission_bps, 1200);
    }
    await claim(second, "authenticated", f.buyer, false);
    let postRevoke;
    try {
      await second.query(
        "select public.create_marketplace_creator_live_attribution($1,$2,$3)",
        [revokePin.id, revokeItem.variant, uid()],
      );
    } catch (error) {
      postRevoke = error;
    }
    assert.equal(postRevoke?.message, "marketplace_creator_entitlement_ineligible");

    const removePin = await pin(db, f.creator, session, endItem);
    await Promise.all([
      claim(first, "authenticated", f.creator, false),
      claim(second, "authenticated", f.buyer, false),
    ]);
    const removeRace = await Promise.allSettled([
      first.query(
        "select public.unpin_live_session_product($1,$2,$3)value",
        [session, removePin.id, uid()],
      ),
      second.query(
        "select public.create_marketplace_creator_live_attribution($1,$2,$3)value",
        [removePin.id, endItem.variant, uid()],
      ),
    ]);
    noDeadlock(removeRace, "remove_attribution_race");
    assert.equal(removeRace[0].status, "fulfilled");
    if (removeRace[1].status === "fulfilled") {
      assert.equal(removeRace[1].value.rows[0].value.source_surface, "live");
    }
    assert.equal(
      (
        await db.query(
          "select status from public.live_session_products where id=$1",
          [removePin.id],
        )
      ).rows[0].status,
      "removed",
    );

    await offer(db, f, endItem, 1000);
    const endPin = await pin(db, f.creator, session, endItem);
    await Promise.all([
      claim(first, "authenticated", f.creator, false),
      claim(second, "authenticated", f.creator, false),
    ]);
    const endRace = await Promise.allSettled([
      first.query("select public.end_live_session($1,'host_ended')", [session]),
      second.query(
        "select public.feature_live_session_product($1,$2,$3)value",
        [session, endPin.id, uid()],
      ),
    ]);
    noDeadlock(endRace, "end_live_race");
    assert.equal(endRace[0].status, "fulfilled");
    assert.equal(
      (
        await db.query("select status from public.live_sessions where id=$1", [
          session,
        ])
      ).rows[0].status,
      "ended",
    );
    await claim(second, "authenticated", f.creator, false);
    let postEnd;
    try {
      await second.query(
        "select public.feature_live_session_product($1,$2,$3)",
        [session, endPin.id, uid()],
      );
    } catch (error) {
      postEnd = error;
    }
    assert.equal(postEnd?.message, "live_commerce_host_not_eligible");

    return {
      pinRace: true,
      singleHighlightRace: true,
      inventoryFinalStockRace: true,
      offerRevocationAttributionRace: true,
      unpinAttributionRace: true,
      endLiveMutationRace: true,
      noOversell: true,
      noDeadlocks: true,
      noPartialState: true,
    };
  } finally {
    await Promise.all([
      first.end().catch(() => {}),
      second.end().catch(() => {}),
    ]);
    await cleanupCommittedFixture(f);
  }
}

try {
  await db.connect();
  const authority = await authorityScenario();
  const financial = await financialScenario(false);
  const insufficient = await financialScenario(true);
  const multiSurface = await multiSurfaceScenario();
  const concurrency = await concurrencyScenario();
  await reconcile(db, "reconcile_marketplace_creator_commerce_analytics", 18);
  await reconcile(db, "reconcile_marketplace_creator_content_tags", 28);
  await reconcile(db, "reconcile_marketplace_creator_showcase", 23);
  await reconcile(db, "reconcile_marketplace_creator_commerce", 36);
  await reconcile(db, "reconcile_marketplace_multi_creator_allocations", 27);
  await reconcile(db, "reconcile_marketplace_settlement_reversals", 32);
  const fixtures = (
    await db.query(
      "select count(*)::int n from auth.users where email like 'b7e-%@proof.local'or email like'b7efinance-%@proof.local'or email like'b7einsufficient-%@proof.local'",
    )
  ).rows[0].n;
  assert.equal(fixtures, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: {
          architecture: {
            existingShelfReused: true,
            hostOnlyAuthority: true,
            capacity: 20,
            singleHighlight: true,
            realtimeSessionSubscription: true,
            canonicalInventoryReservation: true,
            giftsEconomySeparate: true,
          },
          authority,
          financial,
          insufficient,
          multiSurface,
          concurrency,
          reconciliation: {
            b7d18: true,
            b7c28: true,
            b7b23: true,
            b7a36: true,
            b7f27: true,
            b7r32: true,
          },
          persistentFixtures: 0,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      { ok: false, stage, code: error.code ?? null, message: error.message },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
