import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const repo = process.cwd(),
  projectRef = "aewwdlvbwpczqyvkwvvj";
const expectFailure = process.argv.includes("--expect-42501");
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
const fail = (code) => {
  throw new Error(code);
};
if (cli.status !== 0) fail("marketplace_runtime_secure_connection_failed");
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
)
  fail("marketplace_runtime_secure_connection_failed");
const db = new Client(config);
let open = false;
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const safe = (error) =>
  error instanceof Error && /^[a-z0-9_:-]+$/i.test(error.message)
    ? error.message
    : typeof error?.code === "string"
      ? error.code
      : "sanitized_failure";
const counts = `select (select count(*)::int from auth.users)users,(select count(*)::int from public.products)products,(select count(*)::int from public.marketplace_product_variants)variants,(select count(*)::int from public.marketplace_inventory_levels)inventory`;

async function caller(role, subject, sql, params = []) {
  await db.query("savepoint caller_scope");
  await db.query(`set local role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true)",
    [role, subject ?? ""],
  );
  try {
    const result = await db.query(sql, params);
    await db.query("set local role postgres");
    await db.query("release savepoint caller_scope");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint caller_scope");
    throw error;
  }
}

try {
  await db
    .connect()
    .catch(() => fail("marketplace_runtime_secure_connection_failed"));
  await db.query("set role postgres");
  const before = (await db.query(counts)).rows[0];
  await db.query("begin");
  open = true;
  const buyer = randomUUID();
  await db.query(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
    [buyer, `runtime-${buyer}@onsynthetic.local`],
  );
  if (expectFailure) {
    let code = null;
    try {
      await caller(
        "authenticated",
        buyer,
        "select id from public.products limit 1",
      );
    } catch (error) {
      code = error.code;
    }
    const acl = (
      await db.query(
        "select has_function_privilege('authenticated','fixture_ops.is_fixture(text,uuid)','execute') can_execute,has_schema_privilege('authenticated','fixture_ops','usage') schema_usage",
      )
    ).rows[0];
    console.log(
      JSON.stringify(
        {
          permission_reproduction: {
            postgres_code: code,
            operation: "authenticated_product_read",
          },
          acl,
        },
        null,
        2,
      ),
    );
    assert(code === "42501", "expected_42501_not_reproduced");
  } else {
    const seller = randomUUID(),
      store = randomUUID(),
      active = randomUUID(),
      paused = randomUUID(),
      fixture = randomUUID();
    await db.query(
      `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())`,
      [seller, `runtime-seller-${seller}@onsynthetic.local`],
    );
    await db.query(
      `insert into public.user_profiles(id,username,display_name)values($1,$2,'Runtime Buyer'),($3,$4,'Runtime Seller')`,
      [
        buyer,
        `runtime_b_${buyer.replaceAll("-", "").slice(0, 18)}`,
        seller,
        `runtime_s_${seller.replaceAll("-", "").slice(0, 18)}`,
      ],
    );
    await db.query(
      "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Runtime Seller',now())",
      [seller],
    );
    await db.query(
      "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Runtime Store',$3,'active')",
      [store, seller, `runtime-${store}`],
    );
    await db.query(
      `insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at)values
      ($1,$2,'Runtime Active','Runtime proof',1,'BDAG','physical',2,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now()),
      ($4,$2,'Runtime Paused','Runtime proof',1,'BDAG','physical',2,'paused',$3,'10000000-0000-4000-8000-000000000002','physical','approved',null),
      ($5,$2,'Runtime Fixture','Runtime proof',1,'BDAG','physical',2,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now())`,
      [active, seller, store, paused, fixture],
    );
    await db.query(
      "insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)values('product',$1,'mkt-a4b','mkt-a4b-runtime-proof')",
      [fixture],
    );
    const anon = await caller(
      "anon",
      null,
      "select id from public.products where id=any($1::uuid[])",
      [[active, paused, fixture]],
    );
    const auth = await caller(
      "authenticated",
      buyer,
      "select id from public.products where id=any($1::uuid[])",
      [[active, paused, fixture]],
    );
    const owned = await caller(
      "authenticated",
      seller,
      "select id from public.products where id=any($1::uuid[])",
      [[active, paused, fixture]],
    );
    assert(
      anon.rows.length === 1 && anon.rows[0].id === active,
      "anon_visibility_invalid",
    );
    assert(
      auth.rows.length === 1 && auth.rows[0].id === active,
      "buyer_visibility_invalid",
    );
    assert(
      owned.rows.some((row) => row.id === paused),
      "seller_paused_hidden",
    );
    assert(
      !auth.rows.some((row) => row.id === fixture),
      "fixture_product_visible",
    );
    let registryCode = null;
    try {
      await caller(
        "authenticated",
        buyer,
        "select count(*) from fixture_ops.internal_test_fixture_registry",
      );
    } catch (error) {
      registryCode = error.code;
    }
    assert(registryCode === "42501", "fixture_registry_accessible");
    let schemaCode = null;
    try {
      await caller(
        "authenticated",
        buyer,
        "select fixture_ops.is_fixture('product',$1)",
        [fixture],
      );
    } catch (error) {
      schemaCode = error.code;
    }
    assert(schemaCode === "42501", "fixture_schema_direct_call_accessible");
    console.log(
      JSON.stringify(
        {
          product_reads: {
            anon_public: true,
            authenticated_public: true,
            seller_paused: true,
            fixture_hidden: true,
            postgres_42501: false,
          },
          private_fixture_data: {
            registry_denied: true,
            direct_schema_call_denied: true,
          },
          rollback: { global_counts_unchanged: true },
          project_ref: projectRef,
        },
        null,
        2,
      ),
    );
  }
  await db.query("rollback");
  open = false;
  const after = (await db.query(counts)).rows[0];
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    "runtime_rollback_counts_changed",
  );
} catch (error) {
  if (open) await db.query("rollback").catch(() => {});
  console.error(`MARKETPLACE_RUNTIME_PROOF_FAILED:${safe(error)}`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
