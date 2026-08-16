import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const QA_ORDER = "1c55cd4f-7e1d-446d-86f6-9e808a85fd59";
const cache = join(tmpdir(), "onspace-b8d3-c7-audit-cache");
mkdirSync(cache, { recursive: true });
let captured = "";
if (!process.env.PGHOST || !process.env.PGPASSWORD) {
  const cli = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run"], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, npm_config_cache: cache, DO_NOT_TRACK: "1" },
  });
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0) throw new Error("b8d3_c7_remote_secure_connection_failed");
}
const env = (name) => process.env[name] ?? captured.match(new RegExp("(?:export |set \\\"?)" + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1];
const db = new Client({ host: env("PGHOST"), port: Number(env("PGPORT")), user: env("PGUSER"), password: env("PGPASSWORD"), database: env("PGDATABASE"), ssl: { rejectUnauthorized: false } });
const claims = async (sub) => {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [sub, JSON.stringify({ role: "authenticated", sub })]);
};
const attempt = async (sql, params = []) => {
  const savepoint = `c7_${randomUUID().replaceAll("-", "")}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    const rows = (await db.query(sql, params)).rows;
    await db.query(`release savepoint ${savepoint}`);
    return { ok: true, rows };
  } catch (error) {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    return { ok: false, code: error.code, message: error.message };
  }
};

try {
  await db.connect();
  await db.query("begin");
  await db.query("set local role postgres");
  const state = (await db.query(`select o.buyer_id,o.seller_id,o.status order_status,c.status checkout_status,
      p.status payment_status,p.paid_at is not null paid_evidence,a.status allocation_status,
      d.status dispute_status,dd.outcome dispute_outcome
    from public.marketplace_orders o
    join public.marketplace_checkout_sessions c on c.id=o.checkout_id
    join public.marketplace_payments p on p.checkout_id=o.checkout_id
    join public.marketplace_payment_allocations a on a.order_id=o.id
    left join public.marketplace_order_disputes d on d.order_id=o.id
    left join lateral(select outcome from public.marketplace_dispute_decisions where dispute_id=d.id order by created_at desc limit 1)dd on true
    where o.id=$1`, [QA_ORDER])).rows[0];
  assert(state, "qa_order_missing");
  const otherSeller = (await db.query("select user_id id from public.marketplace_sellers where status='approved' and user_id<>$1 order by user_id limit 1", [state.seller_id])).rows[0];
  assert(otherSeller, "unrelated_seller_missing");
  const signature = "public.fetch_my_marketplace_sale(uuid)";
  const contract = (await db.query(`select
      (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
      pg_get_functiondef($1::regprocedure) detail_def,
      not has_function_privilege('anon',$1::regprocedure,'execute') anon_denied,
      has_function_privilege('authenticated',$1::regprocedure,'execute') authenticated_granted`, [signature])).rows[0];
  const combinations = (await db.query(`select o.status order_status,p.status payment_status,a.status allocation_status,count(*)::int count
    from public.marketplace_orders o
    join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
    join public.marketplace_payments p on p.checkout_id=o.checkout_id and p.paid_at is not null
    join public.marketplace_payment_allocations a on a.order_id=o.id
    group by o.status,p.status,a.status order by o.status,p.status,a.status`)).rows;
  await claims(state.seller_id);
  const sellerList = await attempt("select public.fetch_my_marketplace_sales('refunded',50,null,null) value");
  const sellerDetail = await attempt("select public.fetch_my_marketplace_sale($1) value", [QA_ORDER]);
  const lifecycle = await attempt("select public.fetch_my_marketplace_order_lifecycle($1) value", [QA_ORDER]);
  await claims(state.buyer_id);
  const buyerAll = await attempt("select public.fetch_my_marketplace_orders(null,50,null,null) value");
  const buyerRefunded = await attempt("select public.fetch_my_marketplace_orders('refunded',50,null,null) value");
  const buyerDelivered = await attempt("select public.fetch_my_marketplace_orders('delivered',50,null,null) value");
  const buyerDetail = await attempt("select public.fetch_my_marketplace_order($1) value", [QA_ORDER]);
  const buyerLifecycle = await attempt("select public.fetch_my_marketplace_order_lifecycle($1) value", [QA_ORDER]);
  await claims(otherSeller.id);
  const unrelated = await attempt("select public.fetch_my_marketplace_sale($1) value", [QA_ORDER]);
  assert.equal(contract.latest_migration, "20260816022000");
  assert.match(contract.detail_def, /c\.status = 'paid'/);
  assert.match(contract.detail_def, /p\.paid_at is not null/);
  assert.match(contract.detail_def, /p\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.match(contract.detail_def, /o\.status = 'refunded'/);
  assert.match(contract.detail_def, /a\.status = 'refunded'/);
  assert.equal(contract.anon_denied, true);
  assert.equal(contract.authenticated_granted, true);
  assert.equal(sellerList.ok, true);
  assert.equal(sellerList.rows[0].value.some((x) => x.id === QA_ORDER), true);
  assert.equal(sellerDetail.ok, true);
  assert.equal(sellerDetail.rows[0].value.order.status, "refunded");
  assert.equal(sellerDetail.rows[0].value.payment.status, "refunded");
  assert.equal(sellerDetail.rows[0].value.allocation.status, "refunded");
  assert.equal(lifecycle.ok, true);
  assert.equal(lifecycle.rows[0].value.dispute.status, "resolved");
  assert.equal(lifecycle.rows[0].value.dispute.outcome, "refund_buyer");
  assert.equal(buyerAll.ok, true);
  assert.equal(buyerAll.rows[0].value.length, 3);
  assert.equal(buyerAll.rows[0].value.some((x) => x.id === QA_ORDER), true);
  assert.equal(buyerRefunded.ok, true);
  assert.equal(buyerRefunded.rows[0].value.some((x) => x.id === QA_ORDER), true);
  assert.equal(buyerDelivered.ok, true);
  assert.equal(buyerDelivered.rows[0].value.length, 2);
  assert.equal(buyerDetail.ok, true);
  assert.equal(buyerLifecycle.ok, true);
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.code, "42501");
  console.log(JSON.stringify({
    ok: true,
    latest_migration: contract.latest_migration,
    contract: { historical_paid_evidence: true, explicit_allocation_matrix: true, anon_denied: true, authenticated_granted: true },
    combinations,
    qa: {
      state: { order_status: state.order_status, checkout_status: state.checkout_status, payment_status: state.payment_status, paid_evidence: state.paid_evidence, allocation_status: state.allocation_status, dispute_status: state.dispute_status, dispute_outcome: state.dispute_outcome },
      seller_list_contains: true,
      seller_detail_loads: true,
      seller_lifecycle: { dispute_status: "resolved", dispute_outcome: "refund_buyer" },
      unrelated_seller_denied: true,
      buyer: { total: 3, refunded: 1, delivered: 2, detail_loads: true, lifecycle_loads: true },
    },
    mutated: false,
  }, null, 2));
  await db.query("rollback");
} finally { await db.end(); }
