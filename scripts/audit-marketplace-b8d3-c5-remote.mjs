import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const cache = join(tmpdir(), "onspace-b8d3-c5-audit-cache");
mkdirSync(cache, { recursive: true });
let captured = "";
if (!process.env.PGHOST || !process.env.PGPASSWORD) {
  const cli = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run"], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, npm_config_cache: cache, DO_NOT_TRACK: "1" },
  });
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0) throw new Error("b8d3_c5_remote_secure_connection_failed");
}
const env = (name) => process.env[name] ?? captured.match(new RegExp("(?:export |set \\\"?)" + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1];
const db = new Client({ host: env("PGHOST"), port: Number(env("PGPORT")), user: env("PGUSER"), password: env("PGPASSWORD"), database: env("PGDATABASE"), ssl: { rejectUnauthorized: false } });
const attempt = async (query, params = []) => {
  const savepoint = `c5_${randomUUID().replaceAll("-", "")}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    const result = await db.query(query, params);
    await db.query(`release savepoint ${savepoint}`);
    return { ok: true, result };
  } catch (error) {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    return { ok: false, code: error.code, message: error.message };
  }
};
const claims = async (role, sub = "") => {
  await db.query("reset role");
  await db.query(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)", [role, sub, JSON.stringify({ role, sub })]);
};

try {
  await db.connect();
  await db.query("set role postgres");
  const admin = (await db.query("select id from public.user_profiles where is_admin=true order by id limit 1")).rows[0];
  const ordinary = (await db.query("select id from public.user_profiles where not is_admin order by id limit 1")).rows[0];
  assert(admin && ordinary, "audit_identities_missing");
  const signatures = {
    wrapper: "public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)",
    resolver: "public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)",
    lookup: "public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)",
  };
  const contract = (await db.query(`select
    (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
    pg_get_function_identity_arguments($1::regprocedure) wrapper_args,
    pg_get_function_identity_arguments($2::regprocedure) resolver_args,
    pg_get_function_identity_arguments($3::regprocedure) lookup_args,
    pg_get_functiondef($1::regprocedure) wrapper_def,
    pg_get_functiondef($2::regprocedure) resolver_def,
    pg_get_functiondef($3::regprocedure) lookup_def,
    not has_function_privilege('anon',$1::regprocedure,'execute') anon_wrapper_denied,
    has_function_privilege('authenticated',$1::regprocedure,'execute') authenticated_wrapper_granted,
    not has_function_privilege('authenticated',$2::regprocedure,'execute') authenticated_core_denied,
    not has_function_privilege('anon',$3::regprocedure,'execute') anon_lookup_denied`, [signatures.wrapper, signatures.resolver, signatures.lookup])).rows[0];
  assert.equal(contract.latest_migration, "20260816010000");
  assert.match(contract.wrapper_def, /marketplace_require_admin\(\)/);
  assert.match(contract.wrapper_def, /request\.jwt\.claims/);
  assert.match(contract.wrapper_def, /marketplace_admin_actor_mismatch/);
  assert.match(contract.resolver_def, /marketplace_dispute_resolution_auth_required/);
  assert.match(contract.lookup_def, /actor_id\s*=\s*v_actor/);
  assert.equal(contract.anon_wrapper_denied, true);
  assert.equal(contract.authenticated_wrapper_granted, true);
  assert.equal(contract.authenticated_core_denied, true);
  assert.equal(contract.anon_lookup_denied, true);

  const qaBefore = (await db.query(`select d.id,d.status,p.status payment_status,a.status allocation_status,s.status settlement_status,
    (select count(*)::int from public.marketplace_dispute_decisions x where x.dispute_id=d.id) decision_count
    from public.marketplace_order_disputes d join public.marketplace_orders o on o.id=d.order_id
    left join public.marketplace_payments p on p.checkout_id=o.checkout_id
    left join public.marketplace_payment_allocations a on a.order_id=o.id
    left join public.marketplace_order_settlements s on s.order_id=o.id
    where d.status in('open','under_review') order by d.created_at desc limit 1`)).rows[0] ?? null;

  await db.query("begin");
  const target = randomUUID(), key = randomUUID();
  await claims("anon");
  const anon = await attempt("select public.admin_resolve_marketplace_dispute($1,'manual_review','audit_probe',null,$2)", [target, key]);
  await claims("authenticated", ordinary.id);
  const nonAdmin = await attempt("select public.admin_resolve_marketplace_dispute($1,'manual_review','audit_probe',null,$2)", [target, key]);
  await claims("authenticated", admin.id);
  const adminProbe = await attempt("select public.admin_resolve_marketplace_dispute($1,'manual_review','audit_probe',null,$2)", [target, key]);
  const restored = (await db.query("select auth.uid()= $1::uuid uid_preserved,auth.jwt()->>'role' jwt_role", [admin.id])).rows[0];
  const missingLookup = (await db.query("select public.get_my_marketplace_admin_dispute_resolution_result($1,$2)value", [target, key])).rows[0].value;
  const qaDetail = qaBefore ? (await db.query("select public.get_marketplace_admin_dispute_detail($1)value", [qaBefore.id])).rows[0].value : null;
  await db.query("rollback");

  assert.equal(anon.ok, false);
  assert.equal(anon.code, "42501");
  assert.equal(nonAdmin.ok, false);
  assert.equal(nonAdmin.code, "42501");
  assert.match(nonAdmin.message, /marketplace_admin_forbidden/);
  assert.equal(adminProbe.ok, false);
  assert.equal(adminProbe.code, "P0002");
  assert.doesNotMatch(adminProbe.message, /resolution_auth_required/);
  assert.deepEqual(restored, { uid_preserved: true, jwt_role: "authenticated" });
  assert.equal(missingLookup, null);
  if (qaDetail) {
    assert.equal(qaDetail.dispute.status, qaBefore.status);
    assert.equal(qaDetail.payment.status, qaBefore.payment_status);
    assert.equal(Object.hasOwn(qaDetail.payment, "escrow_amount"), false);
    assert.equal(Object.hasOwn(qaDetail.payment, "fee_bps"), false);
  }

  const qaAfter = (await db.query(`select d.id,d.status,p.status payment_status,a.status allocation_status,s.status settlement_status,
    (select count(*)::int from public.marketplace_dispute_decisions x where x.dispute_id=d.id) decision_count
    from public.marketplace_order_disputes d join public.marketplace_orders o on o.id=d.order_id
    left join public.marketplace_payments p on p.checkout_id=o.checkout_id
    left join public.marketplace_payment_allocations a on a.order_id=o.id
    left join public.marketplace_order_settlements s on s.order_id=o.id
    where d.status in('open','under_review') order by d.created_at desc limit 1`)).rows[0] ?? null;
  assert.deepEqual(qaAfter, qaBefore);
  console.log(JSON.stringify({ ok: true, latest_migration: contract.latest_migration, signatures: { wrapper: contract.wrapper_args, resolver: contract.resolver_args, lookup: contract.lookup_args }, grants: { anonDenied: true, nonAdminDenied: true, authenticatedCoreDenied: true, adminReachedCanonicalResolver: true }, trustedContext: { actorDerived: true, subjectPreserved: true, claimsRestored: true, browserCannotSupplyActorOrMoney: true }, qaDispute: qaAfter ? { present: true, status: qaAfter.status, payment_status: qaAfter.payment_status, allocation_status: qaAfter.allocation_status, settlement_status: qaAfter.settlement_status, decision_count: qaAfter.decision_count, unchanged: true } : { present: false }, mutated: false }, null, 2));
} finally {
  await db.end().catch(() => {});
}
