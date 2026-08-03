import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const repo = process.cwd();
const fixtureSuite = "mkt-a4b";
const projectRef = "aewwdlvbwpczqyvkwvvj";
const proofPrefix = "mkt-a4b-proof-";
const zeroCounters = [
  "products_active",
  "stores_active",
  "sessions_live",
  "pins_active",
  "offers_active",
  "fixture_user_spendable",
  "fixture_attributable_escrow",
  "active_reservations",
  "unresolved_allocations",
  "net_platform_impact",
];

function fail(code) {
  throw new Error(code);
}
function assert(condition, code) {
  if (!condition) fail(code);
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sanitizeError(error) {
  const code = error instanceof Error ? error.message : "unknown_failure";
  if (/^[a-z0-9_:-]+$/i.test(code)) return code;
  const databaseCode =
    typeof error?.code === "string" ? error.code : "database_error";
  const constraint =
    typeof error?.constraint === "string" &&
    /^[a-z0-9_]+$/i.test(error.constraint)
      ? `:${error.constraint}`
      : "";
  const routine =
    typeof error?.routine === "string" && /^[a-z0-9_]+$/i.test(error.routine)
      ? `:${error.routine}`
      : "";
  return `${databaseCode}${constraint}${routine}`;
}

function linkedConfiguration() {
  const cli = spawnSync(
    process.env.ComSpec,
    [
      "/d",
      "/s",
      "/c",
      "npx.cmd supabase db dump --linked --schema public --dry-run",
    ],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  if (cli.status !== 0) fail("fixture_proof_secure_connection_failed");
  const captured = `${cli.stdout ?? ""}${cli.stderr ?? ""}`;
  const value = (name) =>
    captured.match(
      new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`),
    )?.[1];
  const config = {
    host: value("PGHOST"),
    port: Number(value("PGPORT")),
    user: value("PGUSER"),
    password: value("PGPASSWORD"),
    database: value("PGDATABASE"),
    ssl: { rejectUnauthorized: false },
  };
  if (
    !config.host ||
    !config.port ||
    !config.user ||
    !config.password ||
    !config.database
  ) {
    fail("fixture_proof_secure_connection_failed");
  }
  return config;
}

const countsSql = `select
 (select count(*)::int from auth.users) users,
 (select count(*)::int from public.products) products,
 (select count(*)::int from public.marketplace_product_variants) variants,
 (select count(*)::int from public.marketplace_inventory_levels) inventory,
 (select count(*)::int from public.marketplace_checkout_sessions) checkouts,
 (select count(*)::int from public.marketplace_orders) orders,
 (select count(*)::int from public.marketplace_order_items) order_items,
 (select count(*)::int from public.marketplace_inventory_reservations) reservations,
 (select count(*)::int from public.marketplace_payments) payments,
 (select count(*)::int from public.marketplace_payment_allocations) allocations,
 (select count(*)::int from public.financial_transactions) transactions,
 (select count(*)::int from public.ledger_entries) ledger_entries,
 (select count(*)::int from fixture_ops.fixture_runs where fixture_run_id like 'mkt-a4b-proof-%') proof_runs`;

function identifiers() {
  return Object.fromEntries(
    [
      "buyer",
      "fixtureSeller",
      "realSeller",
      "fixtureStore",
      "realStore",
      "fixtureProduct",
      "realProduct",
      "fixtureVariant",
      "realVariant",
      "checkout",
      "fixtureOrder",
      "realOrder",
      "fixtureItem",
      "realItem",
      "fixtureReservation",
      "realReservation",
    ].map((key) => [key, randomUUID()]),
  );
}

async function createFixture(db, runId, mixed) {
  const id = identifiers();
  await db.query(
    "select public.marketplace_fixture_lifecycle($1,$2,'begin',$3)",
    [fixtureSuite, runId, projectRef],
  );
  for (const [userId, email] of [
    [id.buyer, `mkt-a4b-buyer-${runId}@example.invalid`],
    [id.fixtureSeller, `mkt-a4b-seller-${runId}@example.invalid`],
    [id.realSeller, `protected-${randomUUID()}@onsynthetic.local`],
  ]) {
    await db.query(
      `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
      [userId, email],
    );
  }
  await db.query(
    `insert into public.user_profiles(id,username,display_name) values
    ($1,$2,'Fixture Buyer'),($3,$4,'Fixture Seller'),($5,$6,'Protected Seller')`,
    [
      id.buyer,
      `proof_b_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      id.fixtureSeller,
      `proof_s_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      id.realSeller,
      `protected_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    ],
  );
  await db.query(
    `insert into public.marketplace_sellers(user_id,status,display_name,approved_at) values
    ($1,'approved','Fixture Seller',now()),($2,'approved','Protected Seller',now())`,
    [id.fixtureSeller, id.realSeller],
  );
  await db.query(
    `insert into public.marketplace_stores(id,seller_id,name,slug,status) values
    ($1,$2,'Fixture Store',$3,'active'),($4,$5,'Protected Store',$6,'active')`,
    [
      id.fixtureStore,
      id.fixtureSeller,
      `proof-fixture-${randomUUID()}`,
      id.realStore,
      id.realSeller,
      `proof-protected-${randomUUID()}`,
    ],
  );
  await db.query(
    `insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at) values
    ($1,$2,'Fixture Proof','Rollback fixture',1,'BDAG','physical',2,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now()),
    ($4,$5,'Protected Proof','Rollback protected',1,'BDAG','physical',2,'active',$6,'10000000-0000-4000-8000-000000000002','physical','approved',now())`,
    [
      id.fixtureProduct,
      id.fixtureSeller,
      id.fixtureStore,
      id.realProduct,
      id.realSeller,
      id.realStore,
    ],
  );
  const fixtureSku = `PROOF-F-${randomUUID().toUpperCase()}`;
  const realSku = `PROOF-R-${randomUUID().toUpperCase()}`;
  await db.query(
    `insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key) values
    ($1,$2,$3,$4,$5,$5,'Default',1,'active',true,''),($6,$7,$8,$9,$10,$10,'Default',1,'active',true,'')`,
    [
      id.fixtureVariant,
      id.fixtureProduct,
      id.fixtureStore,
      id.fixtureSeller,
      fixtureSku,
      id.realVariant,
      id.realProduct,
      id.realStore,
      id.realSeller,
      realSku,
    ],
  );
  await db.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved) values($1,2,1),($2,2,$3)",
    [id.fixtureVariant, id.realVariant, mixed ? 1 : 0],
  );
  await db.query(
    `insert into public.marketplace_checkout_sessions(id,reference,buyer_id,status,currency,subtotal,total,idempotency_key,request_fingerprint,expires_at)
    values($1,$2,$3,'pending_payment','BDAG',$4,$4,$5,$6,now()+interval '15 minutes')`,
    [
      id.checkout,
      `CHK-${randomUUID().toUpperCase()}`,
      id.buyer,
      mixed ? 2 : 1,
      randomUUID(),
      randomUUID(),
    ],
  );
  const addOrder = (orderId, sellerId, storeId) =>
    db.query(
      `insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,status,currency,subtotal,total,reservation_expires_at)
    values($1,$2,$3,$4,$5,$6,'pending_payment','BDAG',1,1,now()+interval '15 minutes')`,
      [
        orderId,
        `ORD-${randomUUID().toUpperCase()}`,
        id.checkout,
        id.buyer,
        sellerId,
        storeId,
      ],
    );
  await addOrder(id.fixtureOrder, id.fixtureSeller, id.fixtureStore);
  if (mixed) await addOrder(id.realOrder, id.realSeller, id.realStore);
  const addItem = (
    itemId,
    orderId,
    productId,
    variantId,
    sellerId,
    storeId,
    title,
    sku,
  ) =>
    db.query(
      `insert into public.marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,variant_title,sku,option_snapshot,unit_price,quantity,line_total)
    values($1,$2,$3,$4,$5,$6,$7,$8,'Default',$9,'[]',1,1,1)`,
      [
        itemId,
        orderId,
        id.checkout,
        productId,
        variantId,
        sellerId,
        storeId,
        title,
        sku,
      ],
    );
  await addItem(
    id.fixtureItem,
    id.fixtureOrder,
    id.fixtureProduct,
    id.fixtureVariant,
    id.fixtureSeller,
    id.fixtureStore,
    "Fixture Proof",
    fixtureSku,
  );
  if (mixed)
    await addItem(
      id.realItem,
      id.realOrder,
      id.realProduct,
      id.realVariant,
      id.realSeller,
      id.realStore,
      "Protected Proof",
      realSku,
    );
  const reserve = (reservationId, orderId, itemId, variantId) =>
    db.query(
      `insert into public.marketplace_inventory_reservations(id,checkout_id,order_id,order_item_id,buyer_id,variant_id,quantity,status,expires_at)
    values($1,$2,$3,$4,$5,$6,1,'active',now()+interval '15 minutes')`,
      [reservationId, id.checkout, orderId, itemId, id.buyer, variantId],
    );
  await reserve(
    id.fixtureReservation,
    id.fixtureOrder,
    id.fixtureItem,
    id.fixtureVariant,
  );
  if (mixed)
    await reserve(
      id.realReservation,
      id.realOrder,
      id.realItem,
      id.realVariant,
    );
  await db.query(
    "select public.marketplace_fixture_lifecycle($1,$2,'register',$3)",
    [fixtureSuite, runId, projectRef],
  );
  return { ...id, runId };
}

async function snapshot(db, id) {
  return (
    await db.query(
      `select jsonb_build_object(
    'checkout',(select to_jsonb(x) from public.marketplace_checkout_sessions x where id=$1),
    'fixture_order',(select to_jsonb(x) from public.marketplace_orders x where id=$2),
    'real_order',(select to_jsonb(x) from public.marketplace_orders x where id=$3),
    'fixture_item',(select to_jsonb(x) from public.marketplace_order_items x where id=$4),
    'real_item',(select to_jsonb(x) from public.marketplace_order_items x where id=$5),
    'fixture_reservation',(select to_jsonb(x) from public.marketplace_inventory_reservations x where id=$6),
    'real_reservation',(select to_jsonb(x) from public.marketplace_inventory_reservations x where id=$7),
    'fixture_inventory',(select to_jsonb(x) from public.marketplace_inventory_levels x where variant_id=$8),
    'real_inventory',(select to_jsonb(x) from public.marketplace_inventory_levels x where variant_id=$9),
    'transactions',(select count(*)::int from public.financial_transactions),
    'ledger_entries',(select count(*)::int from public.ledger_entries),
    'cleanup',(select count(*)::int from fixture_ops.fixture_financial_cleanup),
    'run',(select to_jsonb(x)-'fixture_run_id' from fixture_ops.fixture_runs x where fixture_suite=$10 and fixture_run_id=$11)) value`,
      [
        id.checkout,
        id.fixtureOrder,
        id.realOrder,
        id.fixtureItem,
        id.realItem,
        id.fixtureReservation,
        id.realReservation,
        id.fixtureVariant,
        id.realVariant,
        fixtureSuite,
        id.runId,
      ],
    )
  ).rows[0].value;
}

async function rollbackCase(db, work, transactionState) {
  await db.query("begin");
  transactionState.open = true;
  try {
    await db.query(
      "select set_config('request.jwt.claim.role','service_role',true)",
    );
    return await work();
  } finally {
    await db.query("rollback");
    transactionState.open = false;
  }
}

function assertReconciliation(result, excluded = []) {
  for (const [key, value] of Object.entries(result ?? {})) {
    if (!excluded.includes(key) && typeof value === "number")
      assert(value === 0, `reconciliation_nonzero:${key}`);
  }
}

const helperUrl = pathToFileURL(
  path.join(repo, "scripts", "marketplace-fixture-lifecycle.mjs"),
).href;
const { requireFixtureFinalization } = await import(helperUrl);
const transactionState = { open: false };
let db;

try {
  db = new Client(linkedConfiguration());
  await db
    .connect()
    .catch(() => fail("fixture_proof_secure_connection_failed"));
  await db.query("set role postgres");
  const globalBefore = (await db.query(countsSql)).rows[0];
  const exposureBefore = (
    await db.query("select fixture_ops.fixture_financial_exposure() value")
  ).rows[0].value;

  await rollbackCase(
    db,
    async () => {
      const runId = `${proofPrefix}${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
      const id = await createFixture(db, runId, true);
      const before = await snapshot(db, id);
      const failure = (
        await db.query(
          "select public.finalize_marketplace_fixture_run($1,$2,$3) value",
          [fixtureSuite, runId, projectRef],
        )
      ).rows[0].value;
      const after = await snapshot(db, id);
      assert(
        failure.status === "cleanup_failed",
        "mixed_checkout_status_invalid",
      );
      assert(
        failure.failure_code === "fixture_cleanup_mixed_checkout_forbidden",
        "mixed_checkout_failure_code_invalid",
      );
      assert(
        failure.quarantined === false &&
          failure.financial_neutralized === false,
        "mixed_checkout_result_invalid",
      );
      for (const key of [
        "checkout",
        "fixture_order",
        "real_order",
        "fixture_item",
        "real_item",
        "fixture_reservation",
        "real_reservation",
        "fixture_inventory",
        "real_inventory",
        "transactions",
        "ledger_entries",
        "cleanup",
      ]) {
        assert(same(before[key], after[key]), `mixed_checkout_mutated:${key}`);
      }
      assert(
        after.run.status === "cleanup_failed" &&
          after.run.cleaned_at === null &&
          after.run.finalization_result === null,
        "cleanup_failed_not_persisted",
      );
      assert(
        after.run.failure_code === "fixture_cleanup_mixed_checkout_forbidden",
        "cleanup_failed_code_invalid",
      );
      let contractError;
      try {
        await requireFixtureFinalization(async () => failure, {
          fixtureSuite,
          fixtureRunId: runId,
        });
      } catch (error) {
        contractError = error instanceof Error ? error.message : "unknown";
      }
      assert(
        contractError === "remote_fixture_run_not_quarantined",
        "javascript_contract_rejection_invalid",
      );
    },
    transactionState,
  );

  let retryDeltas;
  await rollbackCase(
    db,
    async () => {
      const runId = `${proofPrefix}${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
      const id = await createFixture(db, runId, false);
      const first = (
        await db.query(
          "select public.finalize_marketplace_fixture_run($1,$2,$3) value",
          [fixtureSuite, runId, projectRef],
        )
      ).rows[0].value;
      assert(
        first.status === "quarantined" &&
          first.quarantined === true &&
          first.financial_neutralized === true &&
          first.failure_code == null,
        "fixture_only_result_invalid",
      );
      for (const key of zeroCounters)
        assert(Number(first[key]) === 0, `fixture_only_counter_nonzero:${key}`);
      await requireFixtureFinalization(async () => first, {
        fixtureSuite,
        fixtureRunId: runId,
      });
      const state = await snapshot(db, id);
      assert(
        state.fixture_order.status === "cancelled",
        "fixture_order_not_cancelled",
      );
      assert(
        state.fixture_reservation.status !== "active",
        "fixture_reservation_not_released",
      );
      assert(
        Number(state.fixture_inventory.reserved) === 0 &&
          Number(state.fixture_inventory.on_hand) === 2,
        "fixture_inventory_release_invalid",
      );
      const publicState = (
        await db.query(
          "select (select status from public.products where id=$1) product_status,(select status from public.marketplace_stores where id=$2) store_status,(select status from public.marketplace_checkout_sessions where id=$3) checkout_status",
          [id.fixtureProduct, id.fixtureStore, id.checkout],
        )
      ).rows[0];
      assert(
        publicState.product_status !== "active",
        "fixture_product_not_quarantined",
      );
      assert(
        publicState.store_status === "suspended",
        "fixture_store_not_suspended",
      );
      assert(
        publicState.checkout_status === "cancelled",
        "fixture_checkout_not_cancelled",
      );
      const retry = (
        await db.query(
          "select public.finalize_marketplace_fixture_run($1,$2,$3) value",
          [fixtureSuite, runId, projectRef],
        )
      ).rows[0].value;
      const retriedState = await snapshot(db, id);
      assert(same(first, retry), "retry_result_changed");
      for (const key of [
        "checkout",
        "fixture_order",
        "fixture_reservation",
        "fixture_inventory",
      ])
        assert(same(state[key], retriedState[key]), `retry_mutated:${key}`);
      retryDeltas = {
        transactions: retriedState.transactions - state.transactions,
        ledger: retriedState.ledger_entries - state.ledger_entries,
        cleanup: retriedState.cleanup - state.cleanup,
      };
      assert(retryDeltas.transactions === 0, "retry_added_transactions");
      assert(retryDeltas.ledger === 0, "retry_added_ledger_entries");
      assert(retryDeltas.cleanup === 0, "retry_added_cleanup_rows");
    },
    transactionState,
  );

  const globalAfter = (await db.query(countsSql)).rows[0];
  const exposureAfter = (
    await db.query("select fixture_ops.fixture_financial_exposure() value")
  ).rows[0].value;
  assert(same(globalBefore, globalAfter), "rollback_global_counts_changed");
  assert(
    globalAfter.proof_runs === globalBefore.proof_runs,
    "proof_rows_remain",
  );
  assert(
    Number(exposureBefore.fixture_user_spendable) === 0 &&
      Number(exposureAfter.fixture_user_spendable) === 0,
    "historical_fixture_spendable_nonzero",
  );
  assert(
    Number(exposureBefore.fixture_attributable_escrow) === 0 &&
      Number(exposureAfter.fixture_attributable_escrow) === 0,
    "historical_fixture_escrow_nonzero",
  );
  assert(
    Number(exposureBefore.net_platform_impact) === 0 &&
      Number(exposureAfter.net_platform_impact) === 0,
    "historical_fixture_platform_impact_nonzero",
  );
  const proofEntities = (
    await db.query(`select
    (select count(*)::int from auth.users where email like 'mkt-a4b-%-mkt-a4b-proof-%@example.invalid') users,
    (select count(*)::int from public.products where description='Rollback fixture') products`)
  ).rows[0];
  assert(
    proofEntities.users === 0 && proofEntities.products === 0,
    "proof_entities_remain",
  );
  const recon = (
    await db.query(
      "select public.reconcile_marketplace_payments() payments,public.reconcile_marketplace_settlements() settlements,public.reconcile_marketplace_live_commissions() commissions",
    )
  ).rows[0];
  assertReconciliation(recon.payments);
  assertReconciliation(recon.settlements, [
    "escrow_actual_balance",
    "escrow_expected_held_total",
  ]);
  assertReconciliation(recon.commissions);

  console.log(
    JSON.stringify(
      {
        mixed_checkout: {
          status: "cleanup_failed",
          failure_code: "fixture_cleanup_mixed_checkout_forbidden",
          javascript_error: "remote_fixture_run_not_quarantined",
          rows_unchanged: true,
        },
        fixture_only: {
          status: "quarantined",
          all_public_counters_zero: true,
          all_financial_counters_zero: true,
          reservation_released: true,
        },
        retry: {
          identical_result: true,
          additional_transactions: retryDeltas.transactions,
          additional_ledger_entries: retryDeltas.ledger,
          additional_cleanup_rows: retryDeltas.cleanup,
        },
        rollback: {
          global_counts_unchanged: true,
          proof_rows_remaining:
            globalAfter.proof_runs - globalBefore.proof_runs,
        },
        reconciliation: { payments: 0, settlements: 0, commissions: 0 },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (transactionState.open && db) await db.query("rollback").catch(() => {});
  console.error(`FIXTURE_PROOF_FAILED:${sanitizeError(error)}`);
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
}
