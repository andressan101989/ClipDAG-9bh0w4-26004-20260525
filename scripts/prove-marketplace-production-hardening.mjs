import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.MARKETPLACE_DATABASE_URL ?? "";
const parsed = (() => { try { return new URL(url); } catch { return null; } })();
if (!parsed || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.port !== "55422") {
  throw new Error("B8D1H_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}

const { Client } = pg;
const db = new Client({ connectionString: url });
const uid = () => randomUUID();
const ids = {
  seller: uid(), other: uid(), admin: uid(), store: uid(), otherStore: uid(),
  products: [uid(), uid(), uid()], otherProduct: uid(),
  promotions: [uid(), uid(), uid()], profiles: [uid(), uid(), uid()],
};
const report = {};

async function claims(role, sub = null) {
  await db.query("reset role");
  await db.query(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)", [role, sub ?? "", JSON.stringify({ role, sub })]);
}
async function operator() { await db.query("reset role"); }
async function expectCode(code, operation) {
  await db.query("savepoint expected_error");
  try { await operation(); assert.fail(`expected_${code}`); }
  catch (error) { assert.equal(error.code, code); }
  finally { await db.query("rollback to savepoint expected_error"); await db.query("release savepoint expected_error"); }
}
async function value(sql, params = []) { return (await db.query(sql, params)).rows[0]?.value; }
async function addUser(id, label, admin = false) {
  await operator();
  await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())", [id, `b8d1h-${label}-${uid()}@proof.local`]);
  await db.query("insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)", [id, `b8d1h_${label}_${uid().slice(0, 8)}`, `B8D1H ${label}`, admin]);
}
async function page(name, args) { return value(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`, args); }
function assertTwoPages(first, second, expectedIds) {
  assert.equal(first.page_size, 2); assert.ok(first.next_cursor);
  assert.equal(second.page_size, 1); assert.equal(second.next_cursor, null);
  const actual = [...first.items, ...second.items].map((entry) => entry.id);
  assert.equal(new Set(actual).size, 3); assert.deepEqual(new Set(actual), new Set(expectedIds));
}

try {
  await db.connect(); await db.query("begin"); await operator();

  report.schema_acl = (await db.query("select r,has_schema_privilege(r,'public','CREATE') can_create from unnest(array['anon','authenticated'])r order by r")).rows;
  assert.deepEqual(report.schema_acl.map((x) => x.can_create), [false, false]);
  report.promotion_privileges = (await db.query("select r,has_table_privilege(r,'public.marketplace_product_promotions','REFERENCES') references_privilege,has_table_privilege(r,'public.marketplace_product_promotions','TRIGGER') trigger_privilege,has_table_privilege(r,'public.marketplace_product_promotions','TRUNCATE') truncate_privilege from unnest(array['anon','authenticated'])r order by r")).rows;
  assert.ok(report.promotion_privileges.every((x) => !x.references_privilege && !x.trigger_privilege && !x.truncate_privilege));

  await db.query("create table public.b8d1h_default_table(id bigint);create sequence public.b8d1h_default_sequence;create function public.b8d1h_default_function()returns integer language sql as 'select 1'");
  report.default_acl_objects = (await db.query(`select role_name,
    has_table_privilege(role_name,'public.b8d1h_default_table','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') table_access,
    has_sequence_privilege(role_name,'public.b8d1h_default_sequence','USAGE,SELECT,UPDATE') sequence_access,
    has_function_privilege(role_name,'public.b8d1h_default_function()','EXECUTE') function_access
    from unnest(array['anon','authenticated']) role_name order by role_name`)).rows;
  assert.ok(report.default_acl_objects.every((x) => !x.table_access && !x.sequence_access && !x.function_access));

  const source = Object.fromEntries((await db.query("select proname,prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any($1)", [["expire_marketplace_checkout_reservations","fetch_marketplace_sponsored_products","fetch_marketplace_sponsored_products_v2","fetch_my_marketplace_ad_campaigns"]])).rows.map((x) => [x.proname, x.prosrc]));
  assert.match(source.expire_marketplace_checkout_reservations, /p_limit is null/i);
  for (const fn of ["fetch_marketplace_sponsored_products", "fetch_marketplace_sponsored_products_v2", "fetch_my_marketplace_ad_campaigns"]) assert.match(source[fn], /coalesce\(p_limit/i);
  await claims("authenticated", ids.seller);
  for (const limit of [undefined, 1, 100]) await value(limit === undefined ? "select public.expire_marketplace_checkout_reservations() value" : "select public.expire_marketplace_checkout_reservations($1) value", limit === undefined ? [] : [limit]);
  for (const limit of [null, 0, 101]) await expectCode("22023", () => value("select public.expire_marketplace_checkout_reservations($1) value", [limit]));
  for (const fn of ["fetch_marketplace_sponsored_products", "fetch_marketplace_sponsored_products_v2"]) {
    for (const limit of [undefined, 1, 8, null, 0, 9]) {
      const result = await db.query(limit === undefined ? `select * from public.${fn}('marketplace_home')` : `select * from public.${fn}('marketplace_home',null,$1)`, limit === undefined ? [] : [limit]);
      assert.ok(result.rowCount <= (limit === 0 ? 0 : limit == null ? 4 : Math.min(limit, 8)));
    }
  }
  for (const limit of [undefined, 1, 100, null, 0, 101]) {
    const result = await db.query(limit === undefined ? "select * from public.fetch_my_marketplace_ad_campaigns()" : "select * from public.fetch_my_marketplace_ad_campaigns(null,$1)", limit === undefined ? [] : [limit]);
    assert.ok(result.rowCount <= (limit == null ? 50 : Math.min(Math.max(limit, 1), 100)));
  }
  report.limit_contracts = { expiration: "default=100;1/100 accepted;NULL/0/101=22023", sponsored_v1: "default/NULL=4;1/8 accepted;0=0;9=8", sponsored_v2: "default/NULL=4;1/8 accepted;0=0;9=8", seller_ads: "default/NULL=50;1/100 accepted;0=1;101=100" };

  await addUser(ids.seller, "seller"); await addUser(ids.other, "other"); await addUser(ids.admin, "admin", true);
  await operator();
  await db.query("insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Seller',now()),($2,'approved','Other',now())", [ids.seller, ids.other]);
  await db.query("insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Store',$3,'active'),($4,$5,'Other store',$6,'active')", [ids.store, ids.seller, `b8d1h-${uid()}`, ids.otherStore, ids.other, `b8d1h-${uid()}`]);
  for (let i = 0; i < 3; i++) await db.query("insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,images,created_at,updated_at)values($1,$2,$3,'proof',10,'BDAG','physical',5,'active',$4,'10000000-0000-4000-8000-000000000002','physical','approved',now(),array[]::text[],now()-($5||' minutes')::interval,now()-($5||' minutes')::interval)", [ids.products[i], ids.seller, `Product ${i}`, ids.store, i]);
  await db.query("insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,images)values($1,$2,'Other product','proof',10,'BDAG','physical',5,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),array[]::text[])", [ids.otherProduct, ids.other, ids.otherStore]);
  for (let i = 0; i < 3; i++) await db.query("insert into public.marketplace_product_promotions(id,seller_id,store_id,product_id,promotion_type,percentage_off,starts_at,ends_at,status,created_by,idempotency_key,created_at,updated_at)values($1,$2,$3,$4,'percentage',10,now()-interval '1 day',now()+interval '1 day','enabled',$2,$5,now()-($6||' minutes')::interval,now()-($6||' minutes')::interval)", [ids.promotions[i], ids.seller, ids.store, ids.products[i], uid(), i]);
  for (let i = 0; i < 3; i++) await db.query("insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,configuration_status,created_at,updated_at)values($1,$2,$3,$4,1,2,'US','Returns','explicit_ready',now()+($5||' minutes')::interval,now()+($5||' minutes')::interval)", [ids.profiles[i], ids.seller, ids.store, `Profile ${i}`, i]);

  await claims("authenticated", ids.seller);
  const product1 = await page("fetch_my_marketplace_products_v2", [null, null, 2]);
  const product2 = await page("fetch_my_marketplace_products_v2", [product1.next_cursor.updated_at, product1.next_cursor.product_id, 2]);
  assertTwoPages(product1, product2, ids.products);
  const promotion1 = await page("list_my_marketplace_promotions_v2", [null, null, 2]);
  const promotion2 = await page("list_my_marketplace_promotions_v2", [promotion1.next_cursor.created_at, promotion1.next_cursor.promotion_id, 2]);
  assertTwoPages(promotion1, promotion2, ids.promotions);
  const shipping1 = await page("fetch_my_marketplace_shipping_profiles_v2", [ids.store, null, null, 2]);
  const shipping2 = await page("fetch_my_marketplace_shipping_profiles_v2", [ids.store, shipping1.next_cursor.created_at, shipping1.next_cursor.profile_id, 2]);
  assertTwoPages(shipping1, shipping2, ids.profiles);
  for (const [fn, args] of [["fetch_my_marketplace_products_v2", [null, null]], ["list_my_marketplace_promotions_v2", [null, null]], ["fetch_my_marketplace_shipping_profiles_v2", [ids.store, null, null]]]) {
    await page(fn, [...args, 1]); await page(fn, [...args, 100]);
    for (const limit of [null, 0, 101]) await expectCode("22023", () => page(fn, [...args, limit]));
  }
  report.seller_pagination = { products: [product1.page_size, product2.page_size], promotions: [promotion1.page_size, promotion2.page_size], shipping_profiles: [shipping1.page_size, shipping2.page_size], ownership_excluded: true, terminal_cursor_null: true };

  await operator();
  const creatorGrants = (await db.query(`select
    has_function_privilege('anon','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_anon,
    has_function_privilege('authenticated','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_authenticated,
    has_function_privilege('service_role','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_service,
    has_function_privilege('anon','public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)','EXECUTE') v2_anon,
    has_function_privilege('authenticated','public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)','EXECUTE') v2_authenticated`)).rows[0];
  assert.deepEqual(creatorGrants, { old_anon: false, old_authenticated: false, old_service: true, v2_anon: false, v2_authenticated: true });
  await claims("authenticated", ids.other); await expectCode("42501", () => page("search_marketplace_admin_creators_v2", [null, "30d", null, null, 1]));
  await claims("authenticated", ids.admin); const adminPage = await page("search_marketplace_admin_creators_v2", [null, "30d", null, null, 1]); assert.equal(adminPage.page_size, 0);
  report.creator_contract = { ...creatorGrants, ordinary_denied: true, protected_admin_allowed: true };

  await operator(); await db.query("rollback");
  report.fixture_residue = Number((await db.query("select count(*) value from public.user_profiles where username like 'b8d1h_%'")).rows[0].value);
  assert.equal(report.fixture_residue, 0);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally { await db.end().catch(() => {}); }
