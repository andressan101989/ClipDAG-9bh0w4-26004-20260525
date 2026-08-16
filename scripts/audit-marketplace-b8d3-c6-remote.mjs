import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const QA_ORDER = "1c55cd4f-7e1d-446d-86f6-9e808a85fd59";
const cache = join(tmpdir(), "onspace-b8d3-c6-audit-cache");
mkdirSync(cache, { recursive: true });
let captured = "";
if (!process.env.PGHOST || !process.env.PGPASSWORD) {
  const cli = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run"], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, npm_config_cache: cache, DO_NOT_TRACK: "1" },
  });
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0) throw new Error("b8d3_c6_remote_secure_connection_failed");
}
const env = (name) => process.env[name] ?? captured.match(new RegExp("(?:export |set \\\"?)" + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1];
const db = new Client({ host: env("PGHOST"), port: Number(env("PGPORT")), user: env("PGUSER"), password: env("PGPASSWORD"), database: env("PGDATABASE"), ssl: { rejectUnauthorized: false } });
const claims = async (sub) => {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [sub, JSON.stringify({ role: "authenticated", sub })]);
};
const attempt = async (sql, params = []) => {
  const savepoint = `c6_${randomUUID().replaceAll("-", "")}`;
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
  const state = (await db.query(`select o.buyer_id,o.seller_id,o.status order_status,c.status checkout_status,p.status payment_status,p.paid_at is not null paid_evidence,
    d.status dispute_status,dd.outcome dispute_outcome
    from public.marketplace_orders o
    join public.marketplace_checkout_sessions c on c.id=o.checkout_id
    join public.marketplace_payments p on p.checkout_id=o.checkout_id
    left join public.marketplace_order_disputes d on d.order_id=o.id
    left join lateral(select outcome from public.marketplace_dispute_decisions where dispute_id=d.id order by created_at desc limit 1)dd on true
    where o.id=$1`, [QA_ORDER])).rows[0];
  assert(state, "qa_order_missing");
  const other = (await db.query("select id from public.user_profiles where id<>$1 order by id limit 1", [state.buyer_id])).rows[0];
  assert(other, "other_identity_missing");
  const signatures = [
    "public.fetch_my_marketplace_orders(text,integer,timestamp with time zone,uuid)",
    "public.fetch_my_marketplace_order(uuid)",
    "public.fetch_my_marketplace_order_lifecycle(uuid)",
    "public.marketplace_order_detail_response(uuid,text)",
  ];
  const contract = (await db.query(`select
    (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
    pg_get_functiondef($1::regprocedure) list_def,
    pg_get_functiondef($2::regprocedure) detail_def,
    pg_get_functiondef($3::regprocedure) lifecycle_def,
    pg_get_functiondef($4::regprocedure) response_def,
    not has_function_privilege('anon',$1::regprocedure,'execute') anon_list_denied,
    has_function_privilege('authenticated',$1::regprocedure,'execute') auth_list_granted,
    not has_function_privilege('anon',$2::regprocedure,'execute') anon_detail_denied,
    has_function_privilege('authenticated',$2::regprocedure,'execute') auth_detail_granted`, signatures)).rows[0];
  await claims(state.buyer_id);
  const all = await attempt("select public.fetch_my_marketplace_orders(null,50,null,null) value");
  const refunded = await attempt("select public.fetch_my_marketplace_orders('refunded',50,null,null) value");
  const detail = await attempt("select public.fetch_my_marketplace_order($1) value", [QA_ORDER]);
  const lifecycle = await attempt("select public.fetch_my_marketplace_order_lifecycle($1) value", [QA_ORDER]);
  await claims(state.seller_id);
  const sellerList = await attempt("select public.fetch_my_marketplace_sales('refunded',50,null,null) value");
  const sellerDetail = await attempt("select public.fetch_my_marketplace_sale($1) value", [QA_ORDER]);
  await claims(other.id);
  const otherList = await attempt("select public.fetch_my_marketplace_orders(null,50,null,null) value");
  const otherDetail = await attempt("select public.fetch_my_marketplace_order($1) value", [QA_ORDER]);
  assert.equal(contract.latest_migration, "20260816021000");
  assert.match(contract.list_def, /c\.status = 'paid'/);
  assert.doesNotMatch(contract.list_def, /c\.paid_at/);
  assert.match(contract.list_def, /p\.paid_at is not null/);
  assert.match(contract.list_def, /p\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.match(contract.detail_def, /p\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.equal(contract.anon_list_denied, true);
  assert.equal(contract.auth_list_granted, true);
  assert.equal(contract.anon_detail_denied, true);
  assert.equal(contract.auth_detail_granted, true);
  assert.equal(all.ok, true);
  assert.equal(all.rows[0].value.some((x) => x.id === QA_ORDER && x.status === "refunded" && x.payment_status === "refunded"), true);
  assert.ok(all.rows[0].value.some((x) => x.status === "delivered"));
  assert.equal(refunded.ok, true);
  assert.equal(refunded.rows[0].value.some((x) => x.id === QA_ORDER), true);
  assert.equal(detail.ok, true);
  assert.equal(detail.rows[0].value.payment.status, "refunded");
  assert.equal(lifecycle.ok, true);
  assert.equal(lifecycle.rows[0].value.dispute.status, "resolved");
  assert.equal(lifecycle.rows[0].value.dispute.outcome, "refund_buyer");
  assert.equal(sellerList.ok, true);
  assert.equal(sellerList.rows[0].value.some((x) => x.id === QA_ORDER), true);
  assert.equal(otherList.ok, true);
  assert.equal(otherList.rows[0].value.some((x) => x.id === QA_ORDER), false);
  assert.equal(otherDetail.ok, false);
  assert.equal(otherDetail.code, "42501");
  console.log(JSON.stringify({
    ok: true,
    latest_migration: contract.latest_migration,
    state: { order_status: state.order_status, checkout_status: state.checkout_status, payment_status: state.payment_status, paid_evidence: state.paid_evidence, dispute_status: state.dispute_status, dispute_outcome: state.dispute_outcome },
    contract: { historical_paid_evidence: true, allowed_payment_states: ["paid", "partially_refunded", "refunded"], anon_denied: true, authenticated_granted: true },
    qa: { all_contains_refund: true, delivered_count: all.rows[0].value.filter((x) => x.status === "delivered").length, refunded_filter_contains_order: true, detail_loads: true, lifecycle_loads: true, dispute_status: "resolved", dispute_outcome: "refund_buyer", seller_refunded_list_contains: true, seller_detail: sellerDetail.ok ? "loads" : { code: sellerDetail.code, message: sellerDetail.message }, other_user_list_excludes: true, other_user_detail_denied: true },
    mutated: false,
  }, null, 2));
  await db.query("rollback");
} finally { await db.end(); }
