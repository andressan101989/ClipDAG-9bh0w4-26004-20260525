// Real disposable PostgreSQL proof. Set NELYON_STRIPE_A2_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_STRIPE_A2_LOCAL === "1";
const container = process.env.NELYON_STRIPE_A2_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_STRIPE_A2_TEMPLATE ?? "plr9_production_clone2";
const owner = "11000000-0000-4000-8000-000000000003";
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationName = readdirSync(migrationDirectory).find((name) => name.endsWith("_stripe_a2_provider_integrity_financial_reversals.sql"));
assert.ok(migrationName);
const migration = readFileSync(new URL(migrationName, migrationDirectory), "utf8");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, { allowFailure = false } = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", db, "-At"], { input: sql, allowFailure });
}

function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", db, "-At"]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
}

function createDatabase(applyMigration = true) {
  const db = `stripea2_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", "supabase_admin", "-T", template, db]);
  if (applyMigration) {
    psql(db, migration);
    psql(db, `insert into public.marketplace_sellers(user_id,status,display_name,approved_at)
      values('${owner}','approved','Stripe A2 Fixture',now()) on conflict(user_id) do update set status='approved';`);
  }
  return db;
}

function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", "supabase_admin", "--force", "--if-exists", db], { allowFailure: true });
}

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function json(value) { return `${literal(JSON.stringify(value))}::jsonb`; }
function service(sql) { return `begin;set local role service_role;${sql};commit;`; }
function serviceCall(db, sql, { allowFailure = false } = {}) { return psql(db, service(sql), { allowFailure }); }
function parsed(result) { return JSON.parse(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("{")).at(-1)); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

function adapter(db, action, payload, options) {
  return serviceCall(db, `select public.manage_stripe_bdag_adapter(${literal(action)},${json(payload)})::text`, options);
}

function prepare(db, amount, key = randomUUID(), fingerprint = hash(`${owner}|${amount}|test`)) {
  const result = adapter(db, "prepare_checkout", {
    owner_id: owner, actor_id: owner, amount_usd_cents: amount,
    idempotency_key: key, request_fingerprint: fingerprint, livemode: false,
  });
  return { ...parsed(result), key, fingerprint };
}

function bind(db, topup, suffix = randomUUID().slice(0, 8)) {
  const session = `cs_test_${suffix}`;
  adapter(db, "bind_checkout", {
    topup_id: topup.topup_id, owner_id: owner, livemode: false,
    stripe_customer_id: "cus_test_owner", stripe_checkout_session_id: session,
    checkout_url: `https://checkout.stripe.com/c/pay/${suffix}`,
  });
  return { ...topup, session, paymentIntent: `pi_test_${suffix}` };
}

function ingest(db, { eventId, eventType, topup, amount, status, createdAt, session = null, paymentIntent = null }) {
  return adapter(db, "ingest_webhook", {
    stripe_event_id: eventId, event_type: eventType, livemode: false,
    payload_hash: hash(`${eventId}|${eventType}|${amount}|${status}`),
    topup_id: topup?.topup_id ?? null,
    stripe_checkout_session_id: session,
    stripe_payment_intent_id: paymentIntent,
    provider_object_id: eventType.startsWith("checkout.") ? session : `obj_${eventId}`,
    amount_usd_cents: amount, currency: "usd", provider_status: status,
    provider_created_at: createdAt,
  });
}

function succeed(db, topup, eventId, createdAt) {
  ingest(db, { eventId, eventType: "checkout.session.completed", topup,
    amount: topup.amount_usd_cents, status: "paid", createdAt,
    session: topup.session, paymentIntent: topup.paymentIntent });
  const credit = serviceCall(db, `select public.credit_stripe_bdag_topup(
    ${literal(topup.topup_id)}::uuid,${literal(topup.session)},${literal(topup.paymentIntent)},
    ${topup.amount_usd_cents},'usd',${literal(eventId)},false)::text`);
  adapter(db, "complete_webhook", { stripe_event_id: eventId, status: "processed" });
  return parsed(credit);
}

function adjust(db, topup, { eventId, eventType, amount, status, createdAt }) {
  ingest(db, { eventId, eventType, topup, amount, status, createdAt,
    paymentIntent: topup.paymentIntent });
  const result = serviceCall(db, `select public.apply_stripe_bdag_adjustment(${literal(eventId)})::text`);
  const payload = parsed(result);
  if (!payload.pending) adapter(db, "complete_webhook", { stripe_event_id: eventId, status: "processed" });
  return payload;
}

function failed(result, code) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(code));
}

test("Stripe A2 migration fails closed on unconverted legacy webhook evidence", { skip: !enabled, timeout: 60000 }, () => {
  const db = createDatabase(false);
  try {
    psql(db, `insert into private.stripe_webhook_events(stripe_event_id,event_type,livemode,payload_hash,status)
      values('evt_legacy_refund','charge.refunded',false,repeat('a',64),'processed')`);
    failed(psql(db, migration, { allowFailure: true }), "stripe_legacy_webhook_evidence_requires_review");
  } finally { dropDatabase(db); }
});

test("Stripe A2 credit, ordering, refund and dispute state machines are exact-once", { skip: !enabled, timeout: 180000 }, async () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('anon','public.manage_stripe_bdag_adapter(text,jsonb)','execute'),
      has_function_privilege('authenticated','public.manage_stripe_bdag_adapter(text,jsonb)','execute'),
      has_function_privilege('service_role','public.manage_stripe_bdag_adapter(text,jsonb)','execute'),
      has_function_privilege('service_role','public.credit_stripe_bdag_topup(uuid,text,text,bigint,text,text,boolean)','execute'),
      has_function_privilege('service_role','public.apply_stripe_bdag_adjustment(text)','execute'),
      has_function_privilege('service_role','public.reconcile_stripe_bdag_finance()','execute'))`).stdout, "f|f|t|t|t|t");
    assert.equal(psql(db, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'stripe_%' and c.relkind='r'").stdout, "3");

    const manipulatedRate = adapter(db, "prepare_checkout", {
      owner_id: owner, actor_id: owner, amount_usd_cents: 100, usd_to_bdag_rate: 99,
      idempotency_key: randomUUID(), request_fingerprint: hash("bad-rate"), livemode: false,
    }, { allowFailure: true });
    failed(manipulatedRate, "stripe_topup_rate_mismatch");
    const manipulatedAmount = adapter(db, "prepare_checkout", {
      owner_id: owner, actor_id: owner, amount_usd_cents: 100, bdag_amount: 99,
      idempotency_key: randomUUID(), request_fingerprint: hash("bad-amount"), livemode: false,
    }, { allowFailure: true });
    failed(manipulatedAmount, "stripe_topup_bdag_mismatch");

    const raceKey = randomUUID();
    const racePayload = {
      owner_id: owner, actor_id: owner, amount_usd_cents: 50,
      idempotency_key: raceKey, request_fingerprint: hash("race"), livemode: false,
    };
    const raceSql = service(`select public.manage_stripe_bdag_adapter('prepare_checkout',${json(racePayload)})::text`);
    const racers = await Promise.all([psqlAsync(db, raceSql), psqlAsync(db, raceSql)]);
    assert.equal(racers.filter((result) => result.status === 0).length, 2, JSON.stringify(racers));
    assert.equal(new Set(racers.map((result) => parsed(result).topup_id)).size, 1);
    assert.equal(psql(db, `select count(*) from private.stripe_bdag_topups where owner_id='${owner}' and idempotency_key='${raceKey}'`).stdout, "1");
    failed(adapter(db, "prepare_checkout", { ...racePayload, amount_usd_cents: 51 }, { allowFailure: true }), "idempotency_conflict");

    const credited = bind(db, prepare(db, 100), "credited");
    const firstCredit = succeed(db, credited, "evt_success_credited", "2026-09-30T05:00:00Z");
    assert.equal(firstCredit.idempotent, false);
    assert.equal(firstCredit.bdag_credited, 100);
    const replay = serviceCall(db, `select public.credit_stripe_bdag_topup(
      '${credited.topup_id}','${credited.session}','${credited.paymentIntent}',100,'usd','evt_success_credited',false)::text`);
    assert.equal(parsed(replay).idempotent, true);
    assert.equal(psql(db, `select count(*) from public.financial_transactions where reference_type='stripe_bdag_topup' and reference_id='${credited.topup_id}'`).stdout, "1");
    assert.equal(psql(db, `select count(*) from public.ledger_entries e join private.stripe_bdag_topups t on t.financial_transaction_id=e.txn_id where t.id='${credited.topup_id}'`).stdout, "1");

    const other = bind(db, prepare(db, 100), "other");
    ingest(db, { eventId: "evt_success_other", eventType: "checkout.session.completed", topup: other,
      amount: 100, status: "paid", createdAt: "2026-09-30T05:00:01Z", session: other.session, paymentIntent: other.paymentIntent });
    failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${credited.topup_id}','${credited.session}',
      '${credited.paymentIntent}',100,'usd','evt_success_other',false)`, { allowFailure: true }), "stripe_credit_event_binding_mismatch");
    failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${other.topup_id}','${other.session}',
      'pi_wrong',100,'usd','evt_success_other',false)`, { allowFailure: true }), "stripe_credit_event_binding_mismatch");
    failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${other.topup_id}','${other.session}',
      '${other.paymentIntent}',99,'usd','evt_success_other',false)`, { allowFailure: true }), "checkout_amount_mismatch");
    failed(adapter(db, "ingest_webhook", {
      stripe_event_id: "evt_success_other", event_type: "checkout.session.completed", livemode: false,
      payload_hash: hash("conflicting-payload"), topup_id: other.topup_id,
      stripe_checkout_session_id: other.session, stripe_payment_intent_id: other.paymentIntent,
      provider_object_id: other.session, amount_usd_cents: 100, currency: "usd",
      provider_status: "paid", provider_created_at: "2026-09-30T05:00:01Z",
    }, { allowFailure: true }), "webhook_event_conflict");
    failed(adapter(db, "prepare_checkout", {
      owner_id: owner, actor_id: owner, amount_usd_cents: 100,
      idempotency_key: randomUUID(), request_fingerprint: hash("live"), livemode: true,
    }, { allowFailure: true }), "stripe_mode_mismatch");

    for (const [kind, eventType] of [["failed", "checkout.session.async_payment_failed"], ["expired", "checkout.session.expired"]]) {
      const terminal = bind(db, prepare(db, 100), kind);
      ingest(db, { eventId: `evt_${kind}`, eventType, topup: terminal, amount: 100, status: kind,
        createdAt: `2026-09-30T05:01:0${kind === "failed" ? 1 : 2}Z`, session: terminal.session, paymentIntent: terminal.paymentIntent });
      ingest(db, { eventId: `evt_${kind}_late_success`, eventType: "checkout.session.completed", topup: terminal,
        amount: 100, status: "paid", createdAt: "2026-09-30T05:02:00Z", session: terminal.session, paymentIntent: terminal.paymentIntent });
      failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${terminal.topup_id}','${terminal.session}',
        '${terminal.paymentIntent}',100,'usd','evt_${kind}_late_success',false)`, { allowFailure: true }), "stripe_credit_state_invalid");
    }

    const disputedBeforeCredit = bind(db, prepare(db, 100), "dispute_before");
    const disputeBefore = adjust(db, disputedBeforeCredit, { eventId: "evt_dispute_before", eventType: "charge.dispute.created",
      amount: 100, status: "needs_response", createdAt: "2026-09-30T05:03:00Z" });
    assert.equal(disputeBefore.status, "not_required");
    ingest(db, { eventId: "evt_dispute_late_success", eventType: "checkout.session.completed", topup: disputedBeforeCredit,
      amount: 100, status: "paid", createdAt: "2026-09-30T05:04:00Z",
      session: disputedBeforeCredit.session, paymentIntent: disputedBeforeCredit.paymentIntent });
    failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${disputedBeforeCredit.topup_id}',
      '${disputedBeforeCredit.session}','${disputedBeforeCredit.paymentIntent}',100,'usd','evt_dispute_late_success',false)`,
      { allowFailure: true }), "stripe_credit_state_invalid");

    const refundedBeforeCredit = bind(db, prepare(db, 100), "refund_before");
    const refundBefore = adjust(db, refundedBeforeCredit, { eventId: "evt_refund_before", eventType: "charge.refunded",
      amount: 100, status: "succeeded", createdAt: "2026-09-30T05:04:10Z" });
    assert.equal(refundBefore.status, "not_required");
    ingest(db, { eventId: "evt_refund_late_success", eventType: "checkout.session.completed", topup: refundedBeforeCredit,
      amount: 100, status: "paid", createdAt: "2026-09-30T05:04:20Z",
      session: refundedBeforeCredit.session, paymentIntent: refundedBeforeCredit.paymentIntent });
    failed(serviceCall(db, `select public.credit_stripe_bdag_topup('${refundedBeforeCredit.topup_id}',
      '${refundedBeforeCredit.session}','${refundedBeforeCredit.paymentIntent}',100,'usd','evt_refund_late_success',false)`,
      { allowFailure: true }), "stripe_credit_state_invalid");

    let adjustment = adjust(db, credited, { eventId: "evt_refund_40", eventType: "charge.refunded",
      amount: 40, status: "succeeded", createdAt: "2026-09-30T05:05:00Z" });
    assert.equal(adjustment.status, "applied");
    const refundTxCount = psql(db, "select count(*) from public.financial_transactions where operation_type='stripe_bdag_refund_reversal'").stdout;
    assert.equal(parsed(serviceCall(db, "select public.apply_stripe_bdag_adjustment('evt_refund_40')::text")).idempotent, true);
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='stripe_bdag_refund_reversal'").stdout, refundTxCount);
    adjustment = adjust(db, credited, { eventId: "evt_refund_70", eventType: "charge.refunded",
      amount: 70, status: "succeeded", createdAt: "2026-09-30T05:06:00Z" });
    assert.equal(adjustment.status, "applied");
    adjustment = adjust(db, credited, { eventId: "evt_refund_70_duplicate", eventType: "charge.refunded",
      amount: 70, status: "succeeded", createdAt: "2026-09-30T05:06:30Z" });
    assert.equal(adjustment.money_moved, false);
    adjustment = adjust(db, credited, { eventId: "evt_refund_100", eventType: "charge.refunded",
      amount: 100, status: "succeeded", createdAt: "2026-09-30T05:07:00Z" });
    assert.equal(adjustment.topup_status, "refunded");
    adjustment = adjust(db, credited, { eventId: "evt_refund_stale", eventType: "charge.refunded",
      amount: 50, status: "succeeded", createdAt: "2026-09-30T05:05:30Z" });
    assert.equal(adjustment.status, "stale");

    const disputed = bind(db, prepare(db, 200), "disputed");
    succeed(db, disputed, "evt_success_disputed", "2026-09-30T05:08:00Z");
    adjustment = adjust(db, disputed, { eventId: "evt_dispute_opened", eventType: "charge.dispute.created",
      amount: 200, status: "needs_response", createdAt: "2026-09-30T05:08:30Z" });
    assert.equal(adjustment.money_moved, false);
    adjustment = adjust(db, disputed, { eventId: "evt_dispute_withdrawn", eventType: "charge.dispute.funds_withdrawn",
      amount: 200, status: "under_review", createdAt: "2026-09-30T05:09:00Z" });
    assert.equal(adjustment.status, "applied");
    adjustment = adjust(db, disputed, { eventId: "evt_dispute_reinstated", eventType: "charge.dispute.funds_reinstated",
      amount: 200, status: "won", createdAt: "2026-09-30T05:10:00Z" });
    assert.equal(adjustment.status, "applied");
    assert.equal(psql(db, `select status||'|'||dispute_status||'|'||reversed_bdag_amount from private.stripe_bdag_topups where id='${disputed.topup_id}'`).stdout, "credited|won|0.00000000");
    adjustment = adjust(db, disputed, { eventId: "evt_dispute_closed_after_reinstatement", eventType: "charge.dispute.closed",
      amount: 200, status: "won", createdAt: "2026-09-30T05:10:05Z" });
    assert.equal(adjustment.status, "stale");

    const disputeLost = bind(db, prepare(db, 50), "dispute_lost");
    succeed(db, disputeLost, "evt_success_dispute_lost", "2026-09-30T05:10:10Z");
    adjustment = adjust(db, disputeLost, { eventId: "evt_dispute_lost", eventType: "charge.dispute.closed",
      amount: 50, status: "lost", createdAt: "2026-09-30T05:10:20Z" });
    assert.equal(adjustment.status, "applied");
    assert.equal(psql(db, `select status||'|'||dispute_status from private.stripe_bdag_topups where id='${disputeLost.topup_id}'`).stdout, "requires_review|lost");
    adjustment = adjust(db, disputeLost, { eventId: "evt_dispute_reinstated_after_lost", eventType: "charge.dispute.funds_reinstated",
      amount: 50, status: "won", createdAt: "2026-09-30T05:10:30Z" });
    assert.equal(adjustment.status, "stale");
    assert.equal(psql(db, `select status||'|'||dispute_status from private.stripe_bdag_topups where id='${disputeLost.topup_id}'`).stdout, "requires_review|lost");

    const combined = bind(db, prepare(db, 100), "combined_adjustments");
    succeed(db, combined, "evt_success_combined", "2026-09-30T05:10:35Z");
    adjust(db, combined, { eventId: "evt_combined_refund", eventType: "charge.refunded",
      amount: 40, status: "succeeded", createdAt: "2026-09-30T05:10:40Z" });
    adjust(db, combined, { eventId: "evt_combined_dispute", eventType: "charge.dispute.closed",
      amount: 60, status: "lost", createdAt: "2026-09-30T05:10:45Z" });
    assert.equal(psql(db, `select refund_required_bdag||'|'||dispute_required_bdag||'|'||reversed_bdag_amount
      from private.stripe_bdag_topups where id='${combined.topup_id}'`).stdout, "40.00000000|60.00000000|100.00000000");

    const sameSecond = bind(db, prepare(db, 100), "same_second_ordering");
    succeed(db, sameSecond, "evt_success_same_second", "2026-09-30T05:10:50Z");
    adjust(db, sameSecond, { eventId: "evt_same_second_withdrawn", eventType: "charge.dispute.funds_withdrawn",
      amount: 100, status: "under_review", createdAt: "2026-09-30T05:10:55Z" });
    adjustment = adjust(db, sameSecond, { eventId: "evt_same_second_opened", eventType: "charge.dispute.created",
      amount: 100, status: "needs_response", createdAt: "2026-09-30T05:10:55Z" });
    assert.equal(adjustment.status, "stale");
    assert.equal(psql(db, `select dispute_status||'|'||reversed_bdag_amount from private.stripe_bdag_topups where id='${sameSecond.topup_id}'`).stdout, "funds_withdrawn|100.00000000");

    const insufficient = bind(db, prepare(db, 100), "insufficient");
    succeed(db, insufficient, "evt_success_insufficient", "2026-09-30T05:11:00Z");
    const account = psql(db, `select id from public.ledger_accounts where owner_id='${owner}' and account_type='user'`).stdout;
    const balance = Number(psql(db, `select balance from public.ledger_accounts where id='${account}'`).stdout);
    const spend = randomUUID();
    psql(db, `insert into public.financial_transactions(id,idempotency_key,operation_type,from_account_id,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
      values('${spend}','fixture-spend-${spend}','stripe_a2_fixture_spend','${account}',${balance-20},0,'BDAG','completed','stripe_a2_fixture','${spend}','${owner}');
      select public.ledger_debit('${spend}','${account}',${balance-20},'Stripe A2 fixture spend','{}'::jsonb);`);
    adjustment = adjust(db, insufficient, { eventId: "evt_refund_insufficient", eventType: "charge.refunded",
      amount: 100, status: "succeeded", createdAt: "2026-09-30T05:12:00Z" });
    assert.equal(adjustment.pending, true);
    assert.equal(psql(db, `select balance from public.ledger_accounts where id='${account}'`).stdout, "20.00000000");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where id in (select financial_transaction_id from private.stripe_webhook_events where stripe_event_id='evt_refund_insufficient')").stdout, "0");
    const health = parsed(serviceCall(db, "select public.reconcile_stripe_bdag_finance()::text"));
    assert.equal(health.pending_reversal_insufficient_funds, 1);
    assert.equal(health.economically_unreconciled_refund_or_dispute, 1);
    assert.ok(health.unresolved_webhook_event > 0);
    for (const [key, value] of Object.entries(health)) {
      if (!["pending_reversal_insufficient_funds", "economically_unreconciled_refund_or_dispute", "unresolved_webhook_event"].includes(key)) assert.equal(value, 0, key);
    }
  } finally { dropDatabase(db); }
});

test("Stripe reconciler reports every injected provider/ledger corruption class", { skip: !enabled, timeout: 120000 }, () => {
  const db = createDatabase();
  try {
    const ids = Array.from({ length: 8 }, () => prepare(db, 100));
    const [missingTx, mismatch, wrongBinding, duplicateA, duplicateB, snapshot, impossible, pending] = ids;
    psql(db, `
      update private.stripe_bdag_topups set status='credited' where id='${missingTx.topup_id}';
      insert into public.financial_transactions(id,idempotency_key,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
        values(gen_random_uuid(),'orphan-credit','deposit',100,0,'BDAG','completed','stripe_bdag_topup','${randomUUID()}','${owner}');
      insert into public.financial_transactions(id,idempotency_key,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
        values(gen_random_uuid(),'duplicate-credit','deposit',100,0,'BDAG','completed','stripe_bdag_topup','${mismatch.topup_id}','${owner}');
      with tx as (insert into public.financial_transactions(id,idempotency_key,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
        values(gen_random_uuid(),'mismatch-credit','deposit',99,0,'BDAG','completed','stripe_bdag_topup','${mismatch.topup_id}','${owner}') returning id)
        update private.stripe_bdag_topups set status='credited',financial_transaction_id=(select id from tx) where id='${mismatch.topup_id}';
      update private.stripe_bdag_topups set stripe_checkout_session_id='cs_correct' where id='${wrongBinding.topup_id}';
      insert into private.stripe_webhook_events(stripe_event_id,event_type,livemode,payload_hash,topup_id,provider_created_at,stripe_checkout_session_id)
        values('evt_wrong_binding','checkout.session.completed',false,repeat('a',64),'${wrongBinding.topup_id}',now(),'cs_wrong');
      alter table private.stripe_bdag_topups drop constraint stripe_bdag_topups_stripe_checkout_session_id_key;
      alter table private.stripe_bdag_topups drop constraint stripe_bdag_topups_stripe_payment_intent_id_key;
      update private.stripe_bdag_topups set stripe_checkout_session_id='cs_duplicate',stripe_payment_intent_id='pi_duplicate' where id in ('${duplicateA.topup_id}','${duplicateB.topup_id}');
      alter table private.stripe_webhook_events drop constraint stripe_webhook_events_test_mode_chk;
      insert into private.stripe_webhook_events(stripe_event_id,event_type,livemode,payload_hash,provider_created_at)
        values('evt_live_mismatch','charge.refunded',true,repeat('b',64),now());
      update private.stripe_bdag_topups set refund_required_bdag=1,reversed_bdag_amount=1 where id='${snapshot.topup_id}';
      alter table private.stripe_bdag_topups drop constraint stripe_bdag_topups_economic_snapshot_chk;
      update private.stripe_bdag_topups set usd_to_bdag_rate=99 where id='${snapshot.topup_id}';
      update private.stripe_bdag_topups set status='credited',refunded_usd_cents=1 where id='${impossible.topup_id}';
      update private.stripe_bdag_topups set status='requires_review',refund_required_bdag=10,reversal_pending_reason='insufficient_funds' where id='${pending.topup_id}';
      insert into public.financial_transactions(id,idempotency_key,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
        values(gen_random_uuid(),'orphan-adjustment','stripe_bdag_refund_reversal',1,0,'BDAG','completed','stripe_bdag_topup_adjustment','evt_orphan','${owner}');
      with tx as (insert into public.financial_transactions(id,idempotency_key,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,initiated_by)
        values(gen_random_uuid(),'missing-adjustment-ledger','stripe_bdag_refund_reversal',1,0,'BDAG','completed','stripe_bdag_topup_adjustment','evt_missing_adjustment_ledger','${owner}') returning id)
        insert into private.stripe_webhook_events(stripe_event_id,event_type,livemode,payload_hash,topup_id,provider_created_at,
          stripe_payment_intent_id,amount_usd_cents,currency,adjustment_kind,adjustment_status,adjustment_target_bdag,adjustment_delta_bdag,financial_transaction_id)
        select 'evt_missing_adjustment_ledger','charge.refunded',false,repeat('c',64),'${missingTx.topup_id}',now(),
          null,1,'usd','refund','applied',1,1,id from tx;
    `);
    const findings = parsed(serviceCall(db, "select public.reconcile_stripe_bdag_finance()::text"));
    for (const key of [
      "credited_without_financial_transaction", "stripe_transaction_without_topup",
      "topup_transaction_amount_mismatch", "missing_credit_ledger_entry",
      "adjustment_transaction_authority_mismatch", "missing_adjustment_ledger_entry",
      "webhook_linked_to_wrong_topup", "unresolved_webhook_event", "duplicate_payment_intent", "duplicate_checkout_session",
      "test_live_mismatch", "refund_reversal_amount_mismatch",
      "economically_unreconciled_refund_or_dispute", "pending_reversal_insufficient_funds",
      "snapshot_formula_mismatch", "impossible_credited_status", "orphan_adjustment_transaction",
    ]) assert.ok(findings[key] > 0, `${key}: ${JSON.stringify(findings)}`);
    assert.ok(findings.stripe_transaction_without_topup >= 2, JSON.stringify(findings));
  } finally { dropDatabase(db); }
});
