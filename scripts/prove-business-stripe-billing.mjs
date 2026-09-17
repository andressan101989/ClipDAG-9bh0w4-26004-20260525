import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const { Client } = pg;
const fail = (code) => { throw new Error(code); };
const assert = (value, code) => { if (!value) fail(code); };
const cli = spawnSync(process.env.ComSpec, [
  "/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run",
], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
if (cli.status !== 0) fail("stripe_billing_secure_connection_failed");
const captured = `${cli.stdout ?? ""}${cli.stderr ?? ""}`;
const value = (name) => captured.match(
  new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`),
)?.[1];
const db = new Client({
  host: value("PGHOST"), port: Number(value("PGPORT")), user: value("PGUSER"),
  password: value("PGPASSWORD"), database: value("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
});
const migration = fs.readFileSync(
  "supabase/migrations/20260917161738_business_stripe_billing_bw_g.sql", "utf8",
);
const counts = async () => (await db.query(`select
  (select count(*)::int from public.financial_transactions) financial_transactions,
  (select count(*)::int from public.ledger_entries) ledger_entries,
  (select count(*)::int from public.ledger_accounts) ledger_accounts,
  (select count(*)::int from public.app_wallets) app_wallets`)).rows[0];
const expected = async (run, token) => {
  await db.query("savepoint expected_failure");
  try {
    await run();
    fail(`expected_${token}`);
  } catch (error) {
    await db.query("rollback to savepoint expected_failure");
    assert(String(error.message).includes(token), `wrong_error_${token}_${error.message}`);
  }
  await db.query("release savepoint expected_failure");
};
const adapter = async (action, payload) => (await db.query(
  "select public.manage_stripe_bdag_adapter($1,$2::jsonb) result", [action, payload],
)).rows[0].result;
const createTopup = async (ownerId, cents, suffix = "") => {
  const key = randomUUID();
  const prepared = await adapter("prepare_checkout", {
    owner_id: ownerId, actor_id: ownerId, amount_usd_cents: cents,
    usd_to_bdag_rate: 100, bdag_amount: cents,
    idempotency_key: key, request_fingerprint: `bw-g-${suffix}-${ownerId}-${cents}`,
    livemode: false,
  });
  const session = `cs_test_${randomUUID().replaceAll("-", "")}`;
  await adapter("bind_checkout", {
    topup_id: prepared.topup_id, owner_id: ownerId, livemode: false,
    stripe_customer_id: `cus_test_${ownerId.replaceAll("-", "")}`,
    stripe_checkout_session_id: session,
    checkout_url: `https://checkout.stripe.test/${session}`,
  });
  return { ...prepared, key, session };
};

let began = false;
try {
  await db.connect();
  await db.query("begin");
  began = true;
  await db.query("set local role postgres");
  const baseline = await counts();
  if (process.env.BW_G_SKIP_MIGRATION !== "1") await db.query(migration);

  const tableCount = Number((await db.query(
    "select count(*) from information_schema.tables where table_schema='private' and table_name like 'stripe_%'",
  )).rows[0].count);
  assert(tableCount === 3, "private_stripe_table_count");

  const ownerId = (await db.query(`select s.user_id
    from public.marketplace_sellers s join public.user_profiles u on u.id=s.user_id
    where s.status='approved' order by s.created_at limit 1`)).rows[0]?.user_id;
  assert(ownerId, "approved_owner_required");

  await db.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$2,true)",
    [JSON.stringify({ role: "authenticated", sub: ownerId }), ownerId],
  );
  await db.query("set local role authenticated");
  const overview = (await db.query(
    "select public.get_my_business_billing_overview($1,20) result", [ownerId],
  )).rows[0].result;
  assert(overview.business_owner_id === ownerId, "owner_finance_read");
  await db.query("reset role");
  await db.query("set local role postgres");

  const memberId = (await db.query(`select u.id from public.user_profiles u
    where u.id<>$1 order by u.created_at limit 1`, [ownerId])).rows[0]?.id;
  const otherOwnerId = (await db.query(`select s.user_id from public.marketplace_sellers s
    where s.status='approved' and s.user_id<>$1 order by s.created_at limit 1`, [ownerId])).rows[0]?.user_id;
  assert(memberId && otherOwnerId, "member_and_cross_business_fixture_required");
  const membershipId = randomUUID();
  await db.query(`insert into private.business_memberships
    (id,business_owner_id,member_user_id,status,created_by)
    values ($1,$2,$3,'active',$2)`, [membershipId, ownerId, memberId]);
  await db.query(`insert into private.business_membership_capabilities
    (membership_id,capability_code,granted_by) values ($1,'business.finance.read',$2)`,
    [membershipId, ownerId]);
  await db.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$2,true)",
    [JSON.stringify({ role: "authenticated", sub: memberId }), memberId],
  );
  await db.query("set local role authenticated");
  const memberOverview = (await db.query(
    "select public.get_my_business_billing_overview($1,20) result", [ownerId],
  )).rows[0].result;
  assert(memberOverview.business_owner_id === ownerId, "member_finance_read");
  await expected(() => db.query(
    "select public.get_my_business_billing_overview($1,20)", [otherOwnerId],
  ), "business_capability_required");
  await db.query("reset role");
  await db.query("set local role postgres");
  await db.query("delete from private.business_membership_capabilities where membership_id=$1", [membershipId]);
  await db.query("set local role authenticated");
  await expected(() => db.query(
    "select public.get_my_business_billing_overview($1,20)", [ownerId],
  ), "business_capability_required");
  await db.query("reset role");
  await db.query("set local role postgres");

  const main = await createTopup(ownerId, 100, "main");
  const same = await adapter("prepare_checkout", {
    owner_id: ownerId, actor_id: ownerId, amount_usd_cents: 100,
    usd_to_bdag_rate: 100, bdag_amount: 100,
    idempotency_key: main.key, request_fingerprint: `bw-g-main-${ownerId}-100`,
    livemode: false,
  });
  assert(same.topup_id === main.topup_id, "checkout_idempotency");
  await expected(() => adapter("prepare_checkout", {
    owner_id: ownerId, actor_id: ownerId, amount_usd_cents: 101,
    usd_to_bdag_rate: 100, bdag_amount: 101,
    idempotency_key: main.key, request_fingerprint: `bw-g-conflict-${ownerId}`,
    livemode: false,
  }), "idempotency_conflict");

  const eventId = `evt_test_${randomUUID().replaceAll("-", "")}`;
  await adapter("ingest_webhook", {
    stripe_event_id: eventId, event_type: "checkout.session.completed", livemode: false,
    payload_hash: "a".repeat(64), topup_id: main.topup_id,
    stripe_checkout_session_id: main.session,
    stripe_payment_intent_id: "pi_test_main",
  });
  const beforeCredit = await counts();
  const first = (await db.query(
    "select public.credit_stripe_bdag_topup($1,$2,$3,$4,$5,$6,$7) result",
    [main.topup_id, main.session, "pi_test_main", 100, "usd", eventId, false],
  )).rows[0].result;
  assert(first.idempotent === false && Number(first.bdag_credited) === 100, "first_credit");
  const afterFirst = await counts();
  assert(afterFirst.financial_transactions === beforeCredit.financial_transactions + 1, "one_financial_transaction");
  assert(afterFirst.ledger_entries === beforeCredit.ledger_entries + 1, "one_ledger_credit");
  assert(afterFirst.ledger_accounts === beforeCredit.ledger_accounts, "no_new_ledger_account_type");
  assert(afterFirst.app_wallets === beforeCredit.app_wallets, "no_app_wallet");
  const second = (await db.query(
    "select public.credit_stripe_bdag_topup($1,$2,$3,$4,$5,$6,$7) result",
    [main.topup_id, main.session, "pi_test_main", 100, "usd", eventId, false],
  )).rows[0].result;
  assert(second.idempotent === true, "duplicate_credit_idempotent");
  const afterReplay = await counts();
  assert(afterReplay.financial_transactions === afterFirst.financial_transactions, "no_duplicate_transaction");
  assert(afterReplay.ledger_entries === afterFirst.ledger_entries, "no_duplicate_ledger_entry");

  const mismatch = await createTopup(ownerId, 1000, "mismatch");
  const mismatchEvent = `evt_test_${randomUUID().replaceAll("-", "")}`;
  await adapter("ingest_webhook", {
    stripe_event_id: mismatchEvent, event_type: "checkout.session.completed", livemode: false,
    payload_hash: "b".repeat(64), topup_id: mismatch.topup_id,
    stripe_checkout_session_id: mismatch.session, stripe_payment_intent_id: "pi_test_mismatch",
  });
  await expected(() => db.query(
    "select public.credit_stripe_bdag_topup($1,$2,$3,$4,$5,$6,$7)",
    [mismatch.topup_id, mismatch.session, "pi_test_mismatch", 999, "usd", mismatchEvent, false],
  ), "checkout_amount_mismatch");
  await expected(() => db.query(
    "select public.credit_stripe_bdag_topup($1,$2,$3,$4,$5,$6,$7)",
    [mismatch.topup_id, mismatch.session, null, 1000, "usd", mismatchEvent, false],
  ), "payment_intent_required");

  const failed = await createTopup(ownerId, 50, "failed");
  await adapter("ingest_webhook", {
    stripe_event_id: `evt_test_${randomUUID().replaceAll("-", "")}`,
    event_type: "checkout.session.async_payment_failed", livemode: false,
    payload_hash: "c".repeat(64), topup_id: failed.topup_id,
    stripe_checkout_session_id: failed.session,
  });
  const failedStatus = (await db.query(
    "select status from private.stripe_bdag_topups where id=$1", [failed.topup_id],
  )).rows[0].status;
  assert(failedStatus === "failed", "failed_status");

  const refundEvent = `evt_test_${randomUUID().replaceAll("-", "")}`;
  await adapter("ingest_webhook", {
    stripe_event_id: refundEvent, event_type: "charge.refunded", livemode: false,
    payload_hash: "d".repeat(64), stripe_payment_intent_id: "pi_test_main",
  });
  const reviewStatus = (await db.query(
    "select status from private.stripe_bdag_topups where id=$1", [main.topup_id],
  )).rows[0].status;
  assert(reviewStatus === "requires_review", "refund_requires_review");
  const afterReview = await counts();
  assert(afterReview.ledger_entries === afterReplay.ledger_entries, "refund_no_ledger_debit");

  const acl = (await db.query(`select
    has_function_privilege('authenticated','public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean)','execute') authenticated_credit,
    has_function_privilege('service_role','public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean)','execute') service_credit,
    has_table_privilege('authenticated','private.stripe_bdag_topups','select') authenticated_table`)).rows[0];
  assert(!acl.authenticated_credit && acl.service_credit && !acl.authenticated_table, "stripe_acl");

  await db.query("rollback");
  began = false;
  await db.query("set role postgres");
  const final = await counts();
  assert(JSON.stringify(final) === JSON.stringify(baseline), "rollback_restored_finance_baseline");
  console.log(JSON.stringify({
    success: true, migration_preflight: "PASS", owner_read: "PASS",
    member_read_and_cross_business: "PASS",
    checkout_idempotency: "PASS", exact_once_credit: "PASS",
    mismatch_denials: "PASS", refund_review_no_debit: "PASS",
    service_role_acl: "PASS", rollback: "PASS", baseline,
  }, null, 2));
} finally {
  if (began) await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}
