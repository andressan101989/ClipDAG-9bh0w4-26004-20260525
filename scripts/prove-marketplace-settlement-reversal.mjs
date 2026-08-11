import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const url = process.env.MARKETPLACE_DATABASE_URL;
if (!url) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(url);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "55422"
) {
  throw new Error("B7R_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}

const db = new Client({ connectionString: url, ssl: false });
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
  const savepoint = `expected_${uid().replaceAll("-", "")}`;
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
  assert.equal(
    caught.message,
    message,
    `unexpected_error_message:${caught.message}`,
  );
  if (sqlstate)
    assert.equal(caught.code, sqlstate, `unexpected_sqlstate:${caught.code}`);
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

async function insertUser(client, id, label, admin = false) {
  const token = uid().replaceAll("-", "").slice(0, 12);
  await client.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
    [id, `b7r-${label}-${token}@proof.local`],
  );
  await client.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b7r${label}${token}`, `B7R ${label}`, admin],
  );
}

async function createCommerceFixture(client) {
  const fixture = {
    seller: uid(),
    buyer: uid(),
    admin: uid(),
    nonAdmin: uid(),
    creatorX: uid(),
    creatorY: uid(),
    store: uid(),
    shippingProfile: uid(),
    product: uid(),
    variant: uid(),
  };
  await insertUser(client, fixture.seller, "seller");
  await insertUser(client, fixture.buyer, "buyer");
  await insertUser(client, fixture.admin, "admin", true);
  await insertUser(client, fixture.nonAdmin, "support");
  await insertUser(client, fixture.creatorX, "creatorx");
  await insertUser(client, fixture.creatorY, "creatory");
  await client.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B7R Seller',now())",
    [fixture.seller],
  );
  await client.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B7R Store',$3,'active')",
    [fixture.store, fixture.seller, `b7r-${uid()}`],
  );
  await client.query(
    `insert into public.marketplace_shipping_profiles(
       id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary)
     values($1,$2,$3,'B7R Ground',1,2,'US','B7R returns')`,
    [fixture.shippingProfile, fixture.seller, fixture.store],
  );
  await client.query(
    `insert into public.marketplace_shipping_profile_regions(
       profile_id,country_code,shipping_price,transit_days_min,transit_days_max)
     values($1,'US',0,1,2)`,
    [fixture.shippingProfile],
  );
  await client.query(
    `insert into public.products(
       id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,
       product_type,moderation_status,published_at,shipping_profile_id)
     values($1,$2,'B7R Proof','Settlement reversal proof',100,'BDAG','physical',20,'active',$3,
       '10000000-0000-4000-8000-000000000002','physical','approved',now(),$4)`,
    [fixture.product, fixture.seller, fixture.store, fixture.shippingProfile],
  );
  const sku = `B7R-${uid().replaceAll("-", "").toUpperCase()}`;
  await client.query(
    `insert into public.marketplace_product_variants(
       id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
     values($1,$2,$3,$4,$5,$5,'Default',100,'active',true,'')`,
    [fixture.variant, fixture.product, fixture.store, fixture.seller, sku],
  );
  await client.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,20,0)",
    [fixture.variant],
  );
  return fixture;
}

async function fundBuyer(client, fixture, amount = 110) {
  await claim(client, "service_role", fixture.admin);
  const platform = (
    await client.query("select public.ensure_marketplace_platform_account() id")
  ).rows[0].id;
  const buyerAccount = (
    await client.query("select public.ensure_ledger_account($1) id", [
      fixture.buyer,
    ])
  ).rows[0].id;
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
       reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_test_funding',$4,0,'BDAG','completed','marketplace_b7r_proof',$5,$6,$7)`,
    [
      transaction,
      platform,
      buyerAccount,
      amount,
      fixture.product,
      `b7r-fund:${transaction}`,
      fixture.buyer,
    ],
  );
  await client.query(
    "select public.ledger_debit($1,$2,$3,'B7R proof funding','{}'),public.ledger_credit($1,$4,$3,'B7R proof funding','{}')",
    [transaction, platform, amount, buyerAccount],
  );
  return { platform, buyerAccount, transaction };
}

async function createPaidShippedOrder(client, fixture) {
  const funding = await fundBuyer(client, fixture);
  await claim(client, "authenticated", fixture.buyer);
  const reservation = (
    await client.query(
      `select public.create_marketplace_checkout_reservation(
         jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),
         jsonb_build_object('recipient_name','B7R','line1','Proof','city','New York','region','NY',
           'postal_code','10001','country','US'),$2) value`,
      [fixture.variant, uid()],
    )
  ).rows[0].value;
  const order = reservation.orders[0].id;
  const checkout = reservation.checkout.id;
  await claim(client, "service_role", fixture.admin);
  await client.query(
    "select public.pay_marketplace_checkout_with_bdag($1,$2,$3)",
    [fixture.buyer, checkout, uid()],
  );
  await claim(client, "authenticated", fixture.seller);
  await client.query(
    "select public.seller_start_marketplace_order_processing($1,$2)",
    [order, uid()],
  );
  await client.query(
    "select public.seller_ship_marketplace_order($1,'B7R','Ground',$2,null,null,$3)",
    [order, `B7R-${uid().slice(0, 8)}`, uid()],
  );
  return { order, checkout, ...funding };
}

function splitTotals(legs) {
  return legs.reduce(
    (totals, leg) => {
      totals[leg.type] += leg.amount;
      return totals;
    },
    { seller_net: 0, platform_fee: 0, creator_commission: 0 },
  );
}

async function releaseWithFrozenLegs(client, fixture, commerce, legs) {
  await claim(client, "service_role", fixture.admin);
  const rows = (
    await client.query(
      `select to_jsonb(o) o,to_jsonb(p) p,to_jsonb(a) a
       from public.marketplace_orders o
       join public.marketplace_payments p on p.checkout_id=o.checkout_id
       join public.marketplace_payment_allocations a on a.order_id=o.id where o.id=$1`,
      [commerce.order],
    )
  ).rows[0];
  const totals = splitTotals(legs);
  assert.equal(
    totals.seller_net + totals.platform_fee + totals.creator_commission,
    100,
    "fixture_leg_total",
  );
  const escrow = (
    await client.query("select public.ensure_marketplace_escrow_account() id")
  ).rows[0].id;
  const accounts = {
    seller: (
      await client.query("select public.ensure_ledger_account($1) id", [
        fixture.seller,
      ])
    ).rows[0].id,
    platform: commerce.platform,
    creatorX: (
      await client.query("select public.ensure_ledger_account($1) id", [
        fixture.creatorX,
      ])
    ).rows[0].id,
    creatorY: (
      await client.query("select public.ensure_ledger_account($1) id", [
        fixture.creatorY,
      ])
    ).rows[0].id,
  };
  const settlement = uid();
  await client.query(
    `insert into public.marketplace_order_settlements(
       id,payment_id,allocation_id,checkout_id,order_id,buyer_id,seller_id,store_id,currency,
       gross_amount,seller_net_amount,creator_user_id,creator_commission_amount,platform_fee_amount,
       status,confirmed_by,idempotency_key,request_fingerprint,confirmed_at,released_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,'BDAG',100,$9,$10,$11,$12,'completed',$13,$14,$15,now(),now())`,
    [
      settlement,
      rows.p.id,
      rows.a.id,
      commerce.checkout,
      commerce.order,
      fixture.buyer,
      fixture.seller,
      fixture.store,
      totals.seller_net,
      totals.creator_commission > 0 ? fixture.creatorX : null,
      totals.creator_commission,
      totals.platform_fee,
      fixture.admin,
      uid(),
      "a".repeat(64),
    ],
  );
  const originalLegs = [];
  for (const [index, leg] of legs.entries()) {
    const destination = accounts[leg.account];
    const beneficiary =
      leg.type === "platform_fee"
        ? null
        : leg.account === "seller"
          ? fixture.seller
          : fixture[leg.account];
    const transaction = uid();
    const operation = {
      seller_net: "marketplace_seller_settlement",
      platform_fee: "marketplace_platform_fee_settlement",
      creator_commission: "marketplace_creator_commission_settlement",
    }[leg.type];
    await client.query(
      `insert into public.financial_transactions(
         id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
         reference_type,reference_id,idempotency_key,initiated_by)
       values($1,$2,$3,$4,$5,0,'BDAG','completed','marketplace_order',$6,$7,$8)`,
      [
        transaction,
        escrow,
        destination,
        operation,
        leg.amount,
        commerce.order,
        `${settlement}:${leg.key}`,
        fixture.buyer,
      ],
    );
    await client.query(
      "select public.ledger_debit($1,$2,$3,'B7R settlement','{}'),public.ledger_credit($1,$4,$3,'B7R settlement','{}')",
      [transaction, escrow, leg.amount, destination],
    );
    const legId = uid();
    await client.query(
      `insert into public.marketplace_settlement_legs(
         id,settlement_id,leg_key,leg_type,beneficiary_user_id,destination_account_id,
         amount,financial_transaction_id,status)
       values($1,$2,$3,$4,$5,$6,$7,$8,'completed')`,
      [
        legId,
        settlement,
        `${index}:${leg.key}`,
        leg.type,
        beneficiary,
        destination,
        leg.amount,
        transaction,
      ],
    );
    originalLegs.push({
      ...leg,
      id: legId,
      transaction,
      destination,
      beneficiary,
    });
  }
  await client.query(
    "select set_config('app.marketplace_settlement','on',true)",
  );
  await client.query(
    "update public.marketplace_payment_allocations set status='released',released_at=now() where id=$1",
    [rows.a.id],
  );
  await client.query(
    `update public.marketplace_orders set status='delivered',delivered_at=now(),
       fulfillment_updated_at=now(),fulfillment_version=fulfillment_version+1 where id=$1`,
    [commerce.order],
  );
  await client.query(
    "update public.marketplace_order_shipments set status='delivered',delivered_at=now() where order_id=$1",
    [commerce.order],
  );
  return {
    settlement,
    payment: rows.p.id,
    allocation: rows.a.id,
    escrow,
    accounts,
    originalLegs,
  };
}

async function createReleasedFixture(client, legs) {
  const fixture = await createCommerceFixture(client);
  const commerce = await createPaidShippedOrder(client, fixture);
  const release = await releaseWithFrozenLegs(client, fixture, commerce, legs);
  return { fixture, commerce, release };
}

async function openReview(
  client,
  setup,
  key = uid(),
  reason = "post_settlement_quality",
  note = "B7R proof",
) {
  await claim(client, "service_role", setup.fixture.admin);
  const review = (
    await client.query(
      "select public.open_marketplace_post_settlement_review($1,$2,$3,$4,$5) value",
      [setup.fixture.admin, setup.commerce.order, reason, note, key],
    )
  ).rows[0].value;
  return { key, review, dispute: review.dispute_id };
}

async function balances(client, ids) {
  const result = await client.query(
    "select id,balance from public.ledger_accounts where id=any($1::uuid[]) order by id",
    [ids],
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.id, money(row.balance)]),
  );
}

async function financialSnapshot(client, setup) {
  const ids = [
    setup.release.escrow,
    setup.commerce.buyerAccount,
    ...Object.values(setup.release.accounts),
  ];
  const state = (
    await client.query(
      `select p.status payment_status,p.refunded_at payment_refunded_at,
         a.status allocation_status,a.refunded_at allocation_refunded_at,
         o.status order_status,d.status dispute_status,d.resolved_at dispute_resolved_at,
         (select count(*)::int from public.marketplace_settlement_reversals r where r.settlement_id=$1) reversal_count,
         (select count(*)::int from public.marketplace_settlement_reversal_legs l where l.settlement_id=$1) reversal_leg_count,
         (select count(*)::int from public.financial_transactions f where f.reference_type='marketplace_settlement_reversal' and f.reference_id in(select r.id::text from public.marketplace_settlement_reversals r where r.settlement_id=$1)) reversal_tx_count,
         (select count(*)::int from public.ledger_entries e join public.financial_transactions f on f.id=e.txn_id where f.reference_type='marketplace_settlement_reversal' and f.reference_id in(select r.id::text from public.marketplace_settlement_reversals r where r.settlement_id=$1)) reversal_entry_count
       from public.marketplace_payments p
       join public.marketplace_payment_allocations a on a.payment_id=p.id
       join public.marketplace_orders o on o.id=a.order_id
       join public.marketplace_order_disputes d on d.order_id=o.id
       where p.id=$2 and d.id=$3`,
      [setup.release.settlement, setup.release.payment, setup.review.dispute],
    )
  ).rows[0];
  return { state, balances: await balances(client, [...new Set(ids)]) };
}

const organicLegs = [
  { key: "seller", type: "seller_net", account: "seller", amount: 90 },
  { key: "platform", type: "platform_fee", account: "platform", amount: 10 },
];
const singleCreatorLegs = [
  { key: "seller", type: "seller_net", account: "seller", amount: 85 },
  { key: "platform", type: "platform_fee", account: "platform", amount: 10 },
  {
    key: "creator-x",
    type: "creator_commission",
    account: "creatorX",
    amount: 5,
  },
];
const multiCreatorLegs = [
  { key: "seller", type: "seller_net", account: "seller", amount: 78 },
  { key: "platform", type: "platform_fee", account: "platform", amount: 10 },
  {
    key: "creator-x",
    type: "creator_commission",
    account: "creatorX",
    amount: 5,
  },
  {
    key: "creator-y",
    type: "creator_commission",
    account: "creatorY",
    amount: 7,
  },
];
const repeatedCreatorLegs = [
  { key: "seller", type: "seller_net", account: "seller", amount: 80 },
  { key: "platform", type: "platform_fee", account: "platform", amount: 10 },
  {
    key: "creator-x-a",
    type: "creator_commission",
    account: "creatorX",
    amount: 4,
  },
  {
    key: "creator-x-b",
    type: "creator_commission",
    account: "creatorX",
    amount: 6,
  },
];

async function proveAdminReviewEntry() {
  return transactionScenario("A_admin_review_entry", async () => {
    const setup = await createReleasedFixture(db, organicLegs);
    await claim(db, "authenticated", setup.fixture.buyer);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.report_marketplace_order_problem($1,'other','late problem',$2)",
          [setup.commerce.order, uid()],
        ),
      "marketplace_dispute_settlement_completed",
      "22023",
    );
    await claim(db, "authenticated", setup.fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.open_marketplace_post_settlement_review($1,$2,'quality','note',$3)",
          [setup.fixture.admin, setup.commerce.order, uid()],
        ),
      "marketplace_post_settlement_review_service_role_required",
      "42501",
    );
    await claim(db, "service_role", setup.fixture.nonAdmin);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.open_marketplace_post_settlement_review($1,$2,'quality','note',$3)",
          [setup.fixture.nonAdmin, setup.commerce.order, uid()],
        ),
      "marketplace_post_settlement_review_resolver_forbidden",
      "42501",
    );
    const before = await db.query(
      "select(select count(*)::int from public.financial_transactions)n,(select count(*)::int from public.ledger_entries)e",
    );
    const key = uid();
    const opened = await openReview(db, setup, key);
    assert.equal(opened.review.money_moved, false);
    assert.equal(opened.review.status, "under_review");
    const retry = await openReview(db, setup, key);
    assert.equal(retry.review.review_id, opened.review.review_id);
    assert.equal(retry.dispute, opened.dispute);
    await claim(db, "service_role", setup.fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.open_marketplace_post_settlement_review($1,$2,'changed_reason','note',$3)",
          [setup.fixture.admin, setup.commerce.order, key],
        ),
      "marketplace_post_settlement_review_idempotency_conflict",
      "23505",
    );
    const after = await db.query(
      "select(select count(*)::int from public.financial_transactions)n,(select count(*)::int from public.ledger_entries)e",
    );
    assert.deepEqual(after.rows[0], before.rows[0], "review_open_moved_money");
    return {
      buyerProtection: true,
      reviewIdempotency: true,
      reviewSecurity: true,
      noMoneyMovement: true,
    };
  });
}

async function resolveAndAssert(setup, expectedLegs) {
  setup.review = await openReview(db, setup);
  const ids = [
    setup.release.escrow,
    setup.commerce.buyerAccount,
    ...Object.values(setup.release.accounts),
  ];
  const before = await balances(db, [...new Set(ids)]);
  const resolutionKey = uid();
  const receipt = (
    await db.query(
      "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','approved_full_refund','B7R proof',$3,null) value",
      [setup.fixture.admin, setup.review.dispute, resolutionKey],
    )
  ).rows[0].value;
  assert.equal(receipt.kind, "final_resolution");
  assert.equal(receipt.finalDecision.outcome, "refund_buyer");
  assert.equal(receipt.finalDecision.financial_result.money_moved, true);
  assert.equal(
    money(receipt.finalDecision.financial_result.gross_refund_amount),
    100,
  );
  const reversalId = receipt.finalDecision.financial_result.reversal_id;
  const refundId =
    receipt.finalDecision.financial_result.buyer_refund_transaction_id;
  const after = await balances(db, [...new Set(ids)]);
  const rows = (
    await db.query(
      `select r.*,p.status payment_status,a.status allocation_status,o.status order_status,d.status dispute_status,
         (select count(*)::int from public.marketplace_settlement_reversal_legs l where l.reversal_id=r.id) leg_count,
         (select count(*)::int from public.financial_transactions f where f.reference_type='marketplace_settlement_reversal' and f.reference_id=r.id::text) tx_count
       from public.marketplace_settlement_reversals r
       join public.marketplace_payments p on p.id=r.payment_id
       join public.marketplace_payment_allocations a on a.id=r.allocation_id
       join public.marketplace_orders o on o.id=r.order_id
       join public.marketplace_order_disputes d on d.id=r.dispute_id where r.id=$1`,
      [reversalId],
    )
  ).rows[0];
  assert.equal(rows.leg_count, expectedLegs.length);
  assert.equal(rows.tx_count, expectedLegs.length + 1);
  assert.equal(rows.payment_status, "refunded");
  assert.equal(rows.allocation_status, "refunded");
  assert.equal(rows.order_status, "refunded");
  assert.equal(rows.dispute_status, "resolved");
  assert.equal(rows.buyer_refund_transaction_id, refundId);
  assert.equal(
    after[setup.commerce.buyerAccount] - before[setup.commerce.buyerAccount],
    100,
  );
  assert.equal(after[setup.release.escrow], before[setup.release.escrow]);
  for (const [account, amount] of Object.entries(
    expectedLegs.reduce((sum, leg) => {
      sum[leg.account] = (sum[leg.account] ?? 0) + leg.amount;
      return sum;
    }, {}),
  )) {
    assert.equal(
      before[setup.release.accounts[account]] -
        after[setup.release.accounts[account]],
      amount,
    );
  }
  const snapshots = (
    await db.query(
      `select l.leg_type,l.reversal_amount,l.original_amount,l.original_settlement_leg_id,
         f.operation_type,f.amount transaction_amount,f.from_account_id,f.to_account_id
       from public.marketplace_settlement_reversal_legs l
       join public.financial_transactions f on f.id=l.reversal_financial_transaction_id
       where l.reversal_id=$1 order by l.original_settlement_leg_id`,
      [reversalId],
    )
  ).rows;
  assert.deepEqual(
    snapshots.map((row) => money(row.reversal_amount)).sort((a, b) => a - b),
    expectedLegs.map((leg) => leg.amount).sort((a, b) => a - b),
  );
  for (const row of snapshots) {
    assert.equal(money(row.reversal_amount), money(row.original_amount));
    assert.equal(money(row.transaction_amount), money(row.reversal_amount));
    assert.equal(
      row.operation_type,
      {
        seller_net: "marketplace_seller_settlement_reversal",
        platform_fee: "marketplace_platform_fee_reversal",
        creator_commission: "marketplace_creator_commission_reversal",
      }[row.leg_type],
    );
  }
  const recon = (
    await db.query(
      "select public.reconcile_marketplace_settlement_reversals() value",
    )
  ).rows[0].value;
  for (const [name, value] of Object.entries(recon))
    assert.equal(Number(value), 0, `reconciliation:${name}`);
  return { receipt, resolutionKey, reversalId, refundId, snapshots, recon };
}

async function proveSuccessfulReversals() {
  const organic = await transactionScenario("B_organic_reversal", async () => {
    const setup = await createReleasedFixture(db, organicLegs);
    return resolveAndAssert(setup, organicLegs);
  });
  const single = await transactionScenario("C_single_creator", async () => {
    const setup = await createReleasedFixture(db, singleCreatorLegs);
    const result = await resolveAndAssert(setup, singleCreatorLegs);
    assert.equal(
      result.snapshots.filter((row) => row.leg_type === "creator_commission")
        .length,
      1,
    );
    return result;
  });
  const multi = await transactionScenario("D_multi_creator", async () => {
    const setup = await createReleasedFixture(db, multiCreatorLegs);
    const result = await resolveAndAssert(setup, multiCreatorLegs);
    assert.equal(result.snapshots.length, 4);
    assert.equal(
      result.snapshots.filter((row) => row.leg_type === "creator_commission")
        .length,
      2,
    );
    return result;
  });
  const repeated = await transactionScenario(
    "E_same_creator_multiple_legs",
    async () => {
      const setup = await createReleasedFixture(db, repeatedCreatorLegs);
      const result = await resolveAndAssert(setup, repeatedCreatorLegs);
      const creator = result.snapshots.filter(
        (row) => row.leg_type === "creator_commission",
      );
      assert.equal(creator.length, 2);
      assert.deepEqual(
        creator.map((row) => money(row.reversal_amount)).sort((a, b) => a - b),
        [4, 6],
      );
      return result;
    },
  );
  return { organic, single, multi, repeated };
}

async function drainAccount(client, fixture, from, to, amount) {
  const transaction = uid();
  await client.query(
    `insert into public.financial_transactions(
       id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
       reference_type,reference_id,idempotency_key,initiated_by)
     values($1,$2,$3,'marketplace_b7r_fixture_drain',$4,0,'BDAG','completed','marketplace_b7r_proof',$5,$6,$7)`,
    [
      transaction,
      from,
      to,
      amount,
      fixture.product,
      `b7r-drain:${transaction}`,
      fixture.admin,
    ],
  );
  await client.query(
    "select public.ledger_debit($1,$2,$3,'B7R balance preflight proof','{}'),public.ledger_credit($1,$4,$3,'B7R balance preflight proof','{}')",
    [transaction, from, amount, to],
  );
}

async function proveInsufficientBalances() {
  const direct = await transactionScenario(
    "F_insufficient_direct",
    async () => {
      const setup = await createReleasedFixture(db, repeatedCreatorLegs);
      setup.review = await openReview(db, setup);
      await drainAccount(
        db,
        setup.fixture,
        setup.release.accounts.creatorX,
        setup.release.accounts.platform,
        1,
      );
      const before = await financialSnapshot(db, setup);
      const result = (
        await db.query(
          "select public.reverse_marketplace_released_settlement($1,$2,'approved_full_refund','direct proof',$3) value",
          [setup.fixture.admin, setup.review.dispute, uid()],
        )
      ).rows[0].value;
      assert.equal(result.money_moved, false);
      assert.equal(result.reason, "insufficient_beneficiary_balance");
      const after = await financialSnapshot(db, setup);
      assert.deepEqual(after, before, "insufficient_direct_changed_state");
      return { aggregateRequired: 10, available: 9, moneyMoved: false };
    },
  );
  const wrapper = await transactionScenario(
    "G_insufficient_wrapper",
    async () => {
      const setup = await createReleasedFixture(db, repeatedCreatorLegs);
      setup.review = await openReview(db, setup);
      await drainAccount(
        db,
        setup.fixture,
        setup.release.accounts.creatorX,
        setup.release.accounts.platform,
        1,
      );
      const before = await financialSnapshot(db, setup);
      const key = uid();
      const result = (
        await db.query(
          "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','approved_full_refund','wrapper proof',$3,null) value",
          [setup.fixture.admin, setup.review.dispute, key],
        )
      ).rows[0].value;
      assert.equal(result.money_moved, false);
      assert.equal(result.kind, "intermediate_review");
      const after = await financialSnapshot(db, setup);
      assert.deepEqual(after.balances, before.balances);
      assert.equal(after.state.reversal_count, 0);
      assert.equal(after.state.reversal_leg_count, 0);
      assert.equal(after.state.reversal_tx_count, 0);
      assert.equal(after.state.reversal_entry_count, 0);
      assert.equal(after.state.payment_status, "paid");
      assert.equal(after.state.allocation_status, "released");
      assert.equal(after.state.order_status, "delivered");
      assert.equal(after.state.dispute_status, "under_review");
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.marketplace_dispute_review_actions where actor_id=$1 and idempotency_key=$2",
            [setup.fixture.admin, key],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.marketplace_dispute_decisions where dispute_id=$1",
            [setup.review.dispute],
          )
        ).rows[0].n,
        0,
      );
      return { moneyMoved: false, canonicalReview: true };
    },
  );
  return { direct, wrapper };
}

async function proveAtomicFailure() {
  return transactionScenario("H_atomic_failure", async () => {
    const setup = await createReleasedFixture(db, multiCreatorLegs);
    setup.review = await openReview(db, setup);
    await db.query(`create or replace function fixture_ops.fail_b7r_after_first_leg()
      returns trigger language plpgsql as $$begin
        if new.settlement_id::text=current_setting('fixture_ops.b7r_target_settlement',true) then
          raise exception using errcode='P0001',message='b7r_atomic_failure_injected';
        end if;
        return new;
      end$$`);
    await db.query(`create trigger fixture_b7r_fail_after_first_leg
      after insert on public.marketplace_settlement_reversal_legs
      for each row execute function fixture_ops.fail_b7r_after_first_leg()`);
    await db.query(
      "select set_config('fixture_ops.b7r_target_settlement',$1,true)",
      [setup.release.settlement],
    );
    const before = await financialSnapshot(db, setup);
    try {
      await expectDbError(
        db,
        () =>
          db.query(
            "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','approved_full_refund','atomic proof',$3,null)",
            [setup.fixture.admin, setup.review.dispute, uid()],
          ),
        "b7r_atomic_failure_injected",
        "P0001",
      );
      const after = await financialSnapshot(db, setup);
      assert.deepEqual(after, before, "atomic_failure_did_not_roll_back");
    } finally {
      await db.query(
        "drop trigger if exists fixture_b7r_fail_after_first_leg on public.marketplace_settlement_reversal_legs",
      );
      await db.query(
        "drop function if exists fixture_ops.fail_b7r_after_first_leg()",
      );
    }
    const removed = (
      await db.query(
        `select to_regprocedure('fixture_ops.fail_b7r_after_first_leg()') is null function_removed,
          not exists(select 1 from pg_trigger where tgname='fixture_b7r_fail_after_first_leg') trigger_removed`,
      )
    ).rows[0];
    assert.equal(removed.function_removed, true);
    assert.equal(removed.trigger_removed, true);
    return {
      injectedAfterFirstLeg: true,
      completeRollback: true,
      triggerRemoved: true,
      functionRemoved: true,
    };
  });
}

async function proveIdempotency() {
  return transactionScenario("I_idempotency", async () => {
    const setup = await createReleasedFixture(db, organicLegs);
    const first = await resolveAndAssert(setup, organicLegs);
    const counts = (
      await db.query(
        "select(select count(*)::int from public.financial_transactions)n,(select count(*)::int from public.ledger_entries)e",
      )
    ).rows[0];
    const retry = (
      await db.query(
        "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','approved_full_refund','B7R proof',$3,null) value",
        [setup.fixture.admin, setup.review.dispute, first.resolutionKey],
      )
    ).rows[0].value;
    assert.equal(
      retry.finalDecision.financial_result.reversal_id,
      first.reversalId,
    );
    assert.equal(
      retry.finalDecision.financial_result.buyer_refund_transaction_id,
      first.refundId,
    );
    const after = (
      await db.query(
        "select(select count(*)::int from public.financial_transactions)n,(select count(*)::int from public.ledger_entries)e",
      )
    ).rows[0];
    assert.deepEqual(after, counts);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','changed_reason','B7R proof',$3,null)",
          [setup.fixture.admin, setup.review.dispute, first.resolutionKey],
        ),
      "marketplace_reversal_idempotency_conflict",
      "23505",
    );
    return {
      sameReversal: true,
      sameRefundTransaction: true,
      unchangedCounts: true,
      conflict: true,
    };
  });
}

async function tableCounts(client) {
  const tables = (
    await client.query(
      "select schemaname,tablename from pg_tables where schemaname in('public','auth') order by schemaname,tablename",
    )
  ).rows;
  const result = {};
  for (const { schemaname, tablename } of tables) {
    result[`${schemaname}.${tablename}`] = Number(
      (
        await client.query(
          `select count(*)::int n from \"${schemaname}\".\"${tablename}\"`,
        )
      ).rows[0].n,
    );
  }
  return result;
}

async function cleanupCommittedFixture(client, setup, sharedBalances) {
  const users = Object.values(setup.fixture).filter((value) =>
    [
      setup.fixture.seller,
      setup.fixture.buyer,
      setup.fixture.admin,
      setup.fixture.nonAdmin,
      setup.fixture.creatorX,
      setup.fixture.creatorY,
    ].includes(value),
  );
  const accountRows = await client.query(
    "select id from public.ledger_accounts where owner_id=any($1::uuid[])",
    [users],
  );
  const userAccounts = accountRows.rows.map((row) => row.id);
  const transactionRows = await client.query(
    "select id from public.financial_transactions where initiated_by=any($1::uuid[])",
    [users],
  );
  const transactionIds = transactionRows.rows.map((row) => row.id);
  await client.query("begin");
  try {
    await client.query("set local session_replication_role='replica'");
    await client.query(
      "delete from public.ledger_entries where txn_id=any($1::uuid[])",
      [transactionIds],
    );
    await client.query(
      "delete from public.financial_transactions where id=any($1::uuid[])",
      [transactionIds],
    );
    await client.query(
      "delete from public.marketplace_settlement_reversal_legs where settlement_id=$1",
      [setup.release.settlement],
    );
    await client.query(
      "delete from public.marketplace_settlement_reversals where settlement_id=$1",
      [setup.release.settlement],
    );
    await client.query(
      "delete from public.marketplace_dispute_decisions where order_id=$1",
      [setup.commerce.order],
    );
    await client.query(
      "delete from public.marketplace_dispute_review_actions where order_id=$1",
      [setup.commerce.order],
    );
    await client.query(
      "delete from public.marketplace_order_disputes where order_id=$1",
      [setup.commerce.order],
    );
    await client.query(
      "delete from public.marketplace_settlement_legs where settlement_id=$1",
      [setup.release.settlement],
    );
    await client.query(
      "delete from public.marketplace_order_settlements where id=$1",
      [setup.release.settlement],
    );
    await client.query(
      "delete from public.marketplace_commerce_events where order_id=$1 or product_id=$2 or variant_id=$3 or actor_user_id=any($4::uuid[])",
      [
        setup.commerce.order,
        setup.fixture.product,
        setup.fixture.variant,
        users,
      ],
    );
    await client.query(
      "delete from public.marketplace_inventory_movements where variant_id=$1",
      [setup.fixture.variant],
    );
    await client.query(
      "delete from public.marketplace_inventory_reservation_events where checkout_id=$1 or variant_id=$2",
      [setup.commerce.checkout, setup.fixture.variant],
    );
    for (const table of [
      "marketplace_order_events",
      "marketplace_order_shipments",
      "marketplace_order_shipping_snapshots",
      "marketplace_order_items",
      "marketplace_inventory_reservations",
      "marketplace_payment_allocations",
    ]) {
      await client.query(`delete from public.${table} where order_id=$1`, [
        setup.commerce.order,
      ]);
    }
    await client.query(
      "delete from public.marketplace_payments where checkout_id=$1",
      [setup.commerce.checkout],
    );
    await client.query(
      "delete from public.marketplace_checkout_shipping_addresses where checkout_id=$1",
      [setup.commerce.checkout],
    );
    await client.query("delete from public.marketplace_orders where id=$1", [
      setup.commerce.order,
    ]);
    await client.query(
      "delete from public.marketplace_checkout_sessions where id=$1",
      [setup.commerce.checkout],
    );
    await client.query(
      "delete from public.marketplace_inventory_levels where variant_id=$1",
      [setup.fixture.variant],
    );
    await client.query(
      "delete from public.marketplace_product_variants where id=$1",
      [setup.fixture.variant],
    );
    await client.query("delete from public.products where id=$1", [
      setup.fixture.product,
    ]);
    await client.query(
      "delete from public.marketplace_shipping_profile_regions where profile_id=$1",
      [setup.fixture.shippingProfile],
    );
    await client.query(
      "delete from public.marketplace_shipping_profiles where id=$1",
      [setup.fixture.shippingProfile],
    );
    await client.query("delete from public.marketplace_stores where id=$1", [
      setup.fixture.store,
    ]);
    await client.query(
      "delete from public.marketplace_sellers where user_id=$1",
      [setup.fixture.seller],
    );
    await client.query(
      "delete from public.ledger_accounts where id=any($1::uuid[])",
      [userAccounts],
    );
    await client.query(
      "update public.ledger_accounts set balance=$2 where id=$1",
      [setup.commerce.platform, sharedBalances.platform],
    );
    await client.query(
      "update public.ledger_accounts set balance=$2 where id=$1",
      [setup.release.escrow, sharedBalances.escrow],
    );
    await client.query(
      "delete from public.user_profiles where id=any($1::uuid[])",
      [users],
    );
    await client.query("delete from auth.users where id=any($1::uuid[])", [
      users,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function proveConcurrency() {
  stage = "J_two_connection_concurrency";
  const beforeCounts = await tableCounts(db);
  const shared = (
    await db.query(
      `select
        (select balance from public.ledger_accounts where id=public.ensure_marketplace_platform_account()) platform,
        (select balance from public.ledger_accounts where id=public.ensure_marketplace_escrow_account()) escrow`,
    )
  ).rows[0];
  let setup;
  await db.query("begin");
  try {
    setup = await createReleasedFixture(db, multiCreatorLegs);
    setup.review = await openReview(db, setup);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  const first = new Client({ connectionString: url, ssl: false });
  const second = new Client({ connectionString: url, ssl: false });
  try {
    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([
      claim(first, "service_role", setup.fixture.admin, false),
      claim(second, "service_role", setup.fixture.admin, false),
    ]);
    const key = uid();
    const params = [setup.fixture.admin, setup.review.dispute, key];
    const results = await Promise.allSettled([
      first.query(
        "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','concurrent_full_refund','race',$3,null) value",
        params,
      ),
      second.query(
        "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','concurrent_full_refund','race',$3,null) value",
        params,
      ),
    ]);
    assert(
      results.every((result) => result.status === "fulfilled"),
      JSON.stringify(results),
    );
    const reversalIds = results.map(
      (result) =>
        result.value.rows[0].value.finalDecision.financial_result.reversal_id,
    );
    assert.equal(new Set(reversalIds).size, 1);
    const economic = (
      await db.query(
        `select count(*)::int reversals,
          (select count(*)::int from public.marketplace_settlement_reversal_legs where settlement_id=$1) legs,
          (select count(*)::int from public.financial_transactions where reference_type='marketplace_settlement_reversal' and operation_type='marketplace_post_settlement_refund' and reference_id=$2) refunds`,
        [setup.release.settlement, reversalIds[0]],
      )
    ).rows[0];
    assert.equal(economic.reversals, 1);
    assert.equal(economic.legs, 4);
    assert.equal(economic.refunds, 1);
  } finally {
    await Promise.all([
      first.end().catch(() => {}),
      second.end().catch(() => {}),
    ]);
    await cleanupCommittedFixture(db, setup, shared);
  }
  const afterCounts = await tableCounts(db);
  const changed = Object.keys(beforeCounts).filter(
    (name) => beforeCounts[name] !== afterCounts[name],
  );
  assert.deepEqual(
    changed,
    [],
    `concurrency_cleanup_count_mismatch:${changed.join(",")}`,
  );
  return {
    oneReversal: true,
    oneRefund: true,
    completeLegSet: true,
    persistentFixtures: 0,
  };
}

async function proveHeldAndReleaseRegressions() {
  const held = await transactionScenario(
    "K_held_refund_regression",
    async () => {
      const fixture = await createCommerceFixture(db);
      const commerce = await createPaidShippedOrder(db, fixture);
      await claim(db, "authenticated", fixture.buyer);
      const reportKey = uid();
      await db.query(
        "select public.report_marketplace_order_problem($1,'other','held proof',$2)",
        [commerce.order, reportKey],
      );
      const dispute = (
        await db.query(
          "select id from public.marketplace_order_disputes where order_id=$1",
          [commerce.order],
        )
      ).rows[0].id;
      await claim(db, "service_role", fixture.admin);
      const receipt = (
        await db.query(
          "select public.resolve_marketplace_dispute($1,$2,'refund_buyer','held_full_refund','held regression',$3,null) value",
          [fixture.admin, dispute, uid()],
        )
      ).rows[0].value;
      assert.equal(receipt.kind, "final_resolution");
      assert.equal(receipt.finalDecision.financial_result.money_moved, true);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.marketplace_settlement_reversals where order_id=$1",
            [commerce.order],
          )
        ).rows[0].n,
        0,
      );
      return true;
    },
  );
  const releaseSeller = await transactionScenario(
    "L_release_seller_regression",
    async () => {
      const fixture = await createCommerceFixture(db);
      const commerce = await createPaidShippedOrder(db, fixture);
      await claim(db, "authenticated", fixture.buyer);
      await db.query(
        "select public.report_marketplace_order_problem($1,'other','release proof',$2)",
        [commerce.order, uid()],
      );
      const dispute = (
        await db.query(
          "select id from public.marketplace_order_disputes where order_id=$1",
          [commerce.order],
        )
      ).rows[0].id;
      await claim(db, "service_role", fixture.admin);
      const key = uid();
      await db.query(
        "select public.resolve_marketplace_dispute($1,$2,'release_seller','support_release','release regression',$3,null)",
        [fixture.admin, dispute, key],
      );
      const before = (
        await db.query(
          `select count(*)::int n from public.financial_transactions
         where reference_type='marketplace_order' and reference_id=$1
           and operation_type in('marketplace_seller_settlement','marketplace_platform_fee_settlement','marketplace_creator_commission_settlement')`,
          [commerce.order],
        )
      ).rows[0].n;
      await db.query(
        "select public.resolve_marketplace_dispute($1,$2,'release_seller','support_release','release regression',$3,null)",
        [fixture.admin, dispute, key],
      );
      const after = (
        await db.query(
          `select count(*)::int n from public.financial_transactions
         where reference_type='marketplace_order' and reference_id=$1
           and operation_type in('marketplace_seller_settlement','marketplace_platform_fee_settlement','marketplace_creator_commission_settlement')`,
          [commerce.order],
        )
      ).rows[0].n;
      assert.equal(after, before);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.marketplace_settlement_reversals where order_id=$1",
            [commerce.order],
          )
        ).rows[0].n,
        0,
      );
      return true;
    },
  );
  return { held, releaseSeller };
}

async function proveSecurityAndGuards() {
  return transactionScenario("N_security", async () => {
    const setup = await createReleasedFixture(db, organicLegs);
    setup.review = await openReview(db, setup);
    await claim(db, "authenticated", setup.fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          "select public.reverse_marketplace_released_settlement($1,$2,'security_proof','note',$3)",
          [setup.fixture.admin, setup.review.dispute, uid()],
        ),
      "marketplace_reversal_service_role_required",
      "42501",
    );
    await claim(db, "service_role", setup.fixture.admin);
    await expectDbError(
      db,
      async () => {
        await db.query("set local role authenticated");
        await db.query(
          `insert into public.marketplace_settlement_reversals(
             id,settlement_id,payment_id,allocation_id,checkout_id,order_id,dispute_id,buyer_id,resolver_id,
             gross_amount,currency,reason_code,buyer_refund_transaction_id,idempotency_key,request_fingerprint)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'BDAG','raw_write',$10,$11,$12)`,
          [
            uid(),
            setup.release.settlement,
            setup.release.payment,
            setup.release.allocation,
            setup.commerce.checkout,
            setup.commerce.order,
            setup.review.dispute,
            setup.fixture.buyer,
            setup.fixture.admin,
            uid(),
            uid(),
            "b".repeat(64),
          ],
        );
      },
      "permission denied for table marketplace_settlement_reversals",
      "42501",
    );
    await claim(db, "service_role", setup.fixture.admin);
    await expectDbError(
      db,
      () =>
        db.query(
          "update public.marketplace_payments set status='refunded',refunded_at=now() where id=$1",
          [setup.release.payment],
        ),
      "marketplace_payment_snapshot_immutable",
      "42501",
    );
    await expectDbError(
      db,
      () =>
        db.query(
          "update public.marketplace_payment_allocations set status='refunded',refunded_at=now() where id=$1",
          [setup.release.allocation],
        ),
      "marketplace_payment_snapshot_immutable",
      "42501",
    );
    return {
      authenticatedDenied: true,
      rawWriteDenied: true,
      paymentGuard: true,
      allocationGuard: true,
    };
  });
}

async function main() {
  await db.connect();
  await db.query("set role postgres");
  const admin = await proveAdminReviewEntry();
  const successful = await proveSuccessfulReversals();
  const insufficient = await proveInsufficientBalances();
  const atomic = await proveAtomicFailure();
  const idempotency = await proveIdempotency();
  const concurrency = await proveConcurrency();
  const regressions = await proveHeldAndReleaseRegressions();
  const security = await proveSecurityAndGuards();
  const recon = (
    await db.query(
      "select public.reconcile_marketplace_settlement_reversals() value",
    )
  ).rows[0].value;
  for (const [name, value] of Object.entries(recon))
    assert.equal(Number(value), 0, `final_reconciliation:${name}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: {
          admin_review_entry: admin,
          organic: true,
          single_creator: true,
          multi_creator: true,
          same_creator_multiple_legs: true,
          insufficient_balance_direct: insufficient.direct,
          insufficient_balance_wrapper: insufficient.wrapper,
          atomic_failure: atomic,
          idempotency,
          two_connection_concurrency: concurrency,
          held_refund_regression: regressions.held,
          release_seller_regression: regressions.releaseSeller,
          buyer_report_regression: admin.buyerProtection,
          security,
        },
        reconciliation: successful.organic.recon,
        persistent_fixtures: 0,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    await db.query("rollback").catch(() => {});
    console.error(
      `MARKETPLACE_SETTLEMENT_REVERSAL_PROOF_FAILED:${stage}:${error.message}`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.end());
