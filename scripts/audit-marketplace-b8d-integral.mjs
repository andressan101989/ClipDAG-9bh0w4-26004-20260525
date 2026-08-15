import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const mode = process.argv[2] ?? "--expect-pre-hardening";
assert.ok(["--expect-pre-hardening", "--require-hardening"].includes(mode), "usage: --expect-pre-hardening|--require-hardening");
const expectedMigration = mode === "--require-hardening" ? "20260811033000" : "20260811032000";
const cache = join(tmpdir(), "onspace-b8b-npm-cache");
mkdirSync(cache, { recursive: true });

let captured = "";
if (
  !process.env.PGHOST ||
  !process.env.PGPORT ||
  !process.env.PGUSER ||
  !process.env.PGPASSWORD
) {
  const cli = spawnSync(
    process.env.ComSpec,
    [
      "/d",
      "/s",
      "/c",
      "npx.cmd supabase db dump --linked --schema public --dry-run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, npm_config_cache: cache, DO_NOT_TRACK: "1" },
    },
  );
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0) {
    throw new Error(
      "b8d_remote_secure_connection_failed:" +
        captured
          .replace(/(PGPASSWORD[="']+)[^"'\r\n ]+/gi, "$1[redacted]")
          .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
          .slice(-800),
    );
  }
}

const env = (name) =>
  process.env[name] ??
  captured.match(
    new RegExp('(?:export |set \\"?)' + name + '=[\\"\']?([^\\"\'\\r\\n ]+)'),
  )?.[1];

const db = new Client({
  host: env("PGHOST"),
  port: Number(env("PGPORT")),
  user: env("PGUSER"),
  password: env("PGPASSWORD"),
  database: env("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
});

try {
  await db.connect();
  await db.query("set role postgres");
  await db.query(
    "select set_config('request.jwt.claims',$1,false), set_config('request.jwt.claim.role','service_role',false)",
    [JSON.stringify({ role: "service_role" })],
  );

  const latest = (
    await db.query(
      "select version from supabase_migrations.schema_migrations order by version desc limit 1",
    )
  ).rows[0]?.version;
  assert.equal(latest, expectedMigration, "b8d_remote_migration_mismatch");

  const roles = (
    await db.query(`
      select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb,
             rolbypassrls, rolinherit, coalesce(rolconfig, '{}'::text[]) config
      from pg_roles
      where rolname = any($1::text[])
      order by rolname
    `, [["anon", "authenticated", "authenticator", "service_role", "postgres", "supabase_admin"]])
  ).rows;

  const roleMemberships = (
    await db.query(`
      select granted.rolname role, member.rolname member
      from pg_auth_members membership
      join pg_roles granted on granted.oid = membership.roleid
      join pg_roles member on member.oid = membership.member
      where granted.rolname = 'supabase_admin' or member.rolname = 'postgres'
      order by granted.rolname, member.rolname
    `)
  ).rows;
  const postgresCanSetSupabaseAdmin = (
    await db.query("select pg_has_role('postgres','supabase_admin','SET') value")
  ).rows[0]?.value;

  const schemaPrivileges = (
    await db.query(`
      select role_name,
             has_schema_privilege(role_name, 'public', 'USAGE') usage,
             has_schema_privilege(role_name, 'public', 'CREATE') can_create
      from unnest($1::text[]) role_name
      order by role_name
    `, [["anon", "authenticated", "authenticator", "service_role"]])
  ).rows;

  const schemaAcl = (
    await db.query(
      "select coalesce(nspacl, '{}'::aclitem[])::text[] acl from pg_namespace where nspname = 'public'",
    )
  ).rows[0]?.acl;
  const sessionSearchPath = (
    await db.query("select current_setting('search_path') value")
  ).rows[0]?.value;

  const defaultAcl = (
    await db.query(`
      select defaclrole::regrole::text owner, coalesce(n.nspname, '*') schema,
             defaclobjtype object_type, defaclacl::text[] acl
      from pg_default_acl d
      left join pg_namespace n on n.oid = d.defaclnamespace
      where coalesce(n.nspname, '*') in ('public', '*')
      order by owner, schema, object_type
    `)
  ).rows;

  const securityDefiner = (
    await db.query(`
      select count(*)::int total,
             count(*) filter (
               where exists (
                 select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
                 where setting like 'search_path=%'
               )
             )::int fixed_search_path,
             count(*) filter (
               where exists (
                 select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
                 where setting in ('search_path=public', 'search_path=pg_catalog, public')
               )
             )::int public_in_path,
             count(*) filter (
               where exists (
                 select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
                 where setting = 'search_path=""'
               )
             )::int empty_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%marketplace%'
        and p.prosecdef
    `)
  ).rows[0];

  const exposedDynamicSql = (
    await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        and (p.prosrc ~* '(^|[^a-z])execute([^a-z]|$)'
          or p.proname ~* '(exec|sql|query|ddl)')
      order by p.proname
    `)
  ).rows;

  const securityDefinerOwners = (
    await db.query(`
      select p.proowner::regrole::text owner, count(*)::int functions
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%marketplace%'
        and p.prosecdef
      group by p.proowner
      order by owner
    `)
  ).rows;

  const marketplaceObjectOwners = (
    await db.query(`
      select object_type, owner, count(*)::int objects
      from (
        select 'table_or_sequence' object_type, c.relowner::regrole::text owner
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname like 'marketplace_%'
          and c.relkind in ('r','p','S','v','m')
        union all
        select 'function', p.proowner::regrole::text
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname like '%marketplace%'
      ) objects
      group by object_type, owner
      order by object_type, owner
    `)
  ).rows;

  const securityDefinerSearchPaths = (
    await db.query(`
      select coalesce((
               select setting
               from unnest(coalesce(p.proconfig, '{}'::text[])) setting
               where setting like 'search_path=%'
               limit 1
             ), '<missing>') search_path,
             count(*)::int functions
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%marketplace%'
        and p.prosecdef
      group by search_path
      order by search_path
    `)
  ).rows;

  const broadTablePrivileges = (
    await db.query(`
      select table_name, grantee, array_agg(privilege_type order by privilege_type) privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name like 'marketplace_%'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
      group by table_name, grantee
      order by table_name, grantee
    `)
  ).rows;

  const limitRisks = (
    await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and p.prosrc ilike '%p_limit%'
        and p.prosrc not ilike '%p_limit is null%'
        and p.prosrc not ilike '%coalesce(p_limit%'
        and (p.prosrc ilike '%limit p_limit%'
          or p.prosrc ilike '%greatest(p_limit%')
      order by p.proname
    `)
  ).rows;

  const targetedLimitRisks = (
    await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) arguments
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[])
        and p.prosrc ilike '%p_limit%'
        and p.prosrc not ilike '%p_limit is null%'
        and p.prosrc not ilike '%coalesce(p_limit%'
      order by p.proname
    `, [["expire_marketplace_checkout_reservations", "fetch_marketplace_sponsored_products", "fetch_marketplace_sponsored_products_v2", "fetch_my_marketplace_ad_campaigns"]])
  ).rows;

  const unexpectedPostgresDefaults = (
    await db.query(`
      select d.defaclobjtype object_type, coalesce(grantee.rolname,'PUBLIC') grantee,
             privilege_type
      from pg_default_acl d
      left join pg_namespace n on n.oid=d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) x
      left join pg_roles grantee on grantee.oid=x.grantee
      where d.defaclrole='postgres'::regrole
        and coalesce(n.nspname,'public')='public'
        and coalesce(grantee.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated')
      order by object_type,grantee,privilege_type
    `)
  ).rows;

  const promotionDormantPrivileges = (
    await db.query(`select role_name,
      has_table_privilege(role_name,'public.marketplace_product_promotions','REFERENCES') can_reference,
      has_table_privilege(role_name,'public.marketplace_product_promotions','TRIGGER') can_trigger,
      has_table_privilege(role_name,'public.marketplace_product_promotions','TRUNCATE') can_truncate
      from unnest(array['anon','authenticated']) role_name order by role_name`)
  ).rows;

  const creatorSearchGrants = (
    await db.query(`select
      has_function_privilege('anon','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_anon,
      has_function_privilege('authenticated','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_authenticated,
      has_function_privilege('service_role','public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)','EXECUTE') old_service,
      has_function_privilege('anon','public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)','EXECUTE') v2_anon,
      has_function_privilege('authenticated','public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)','EXECUTE') v2_authenticated`)
  ).rows[0];

  const sellerListContracts = (
    await db.query(`select p.proname,pg_get_function_identity_arguments(p.oid) arguments,
      p.prosecdef,coalesce(p.proconfig,'{}'::text[]) config,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`, [["fetch_my_marketplace_products_v2","list_my_marketplace_promotions_v2","fetch_my_marketplace_shipping_profiles_v2"]])
  ).rows;

  securityDefiner.client_writable_public = schemaPrivileges.some(
    (entry) =>
      ["anon", "authenticated", "authenticator"].includes(entry.role_name) &&
      entry.can_create,
  );
  securityDefiner.effective_unsafe_search_path =
    securityDefiner.client_writable_public ? securityDefiner.public_in_path : 0;

  assert.ok(schemaPrivileges.every((entry) => entry.can_create === false), "b8d_schema_create_exposure");
  assert.equal(exposedDynamicSql.length, 0, "b8d_exposed_dynamic_sql");
  assert.equal(securityDefiner.effective_unsafe_search_path, 0, "b8d_security_definer_search_path");
  if (mode === "--require-hardening") {
    assert.equal(unexpectedPostgresDefaults.length, 0, "b8d_default_acl_exposure");
    assert.ok(promotionDormantPrivileges.every((entry) => !entry.can_reference && !entry.can_trigger && !entry.can_truncate), "b8d_promotion_dormant_privilege");
    assert.equal(targetedLimitRisks.length, 0, "b8d_target_limit_risk");
    assert.deepEqual(creatorSearchGrants, { old_anon: false, old_authenticated: false, old_service: true, v2_anon: false, v2_authenticated: true }, "b8d_creator_contract");
    assert.equal(sellerListContracts.length, 3, "b8d_seller_list_contracts_missing");
    assert.ok(sellerListContracts.every((entry) => entry.prosecdef && entry.authenticated_execute && entry.config.some((setting) => setting.startsWith("search_path="))), "b8d_seller_list_contract_unsafe");
    assert.equal(broadTablePrivileges.length, 0, "b8d_broad_table_privilege");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        latest,
        roles,
        role_memberships: roleMemberships,
        postgres_can_set_supabase_admin: postgresCanSetSupabaseAdmin,
        schema_privileges: schemaPrivileges,
        schema_acl: schemaAcl,
        session_search_path: sessionSearchPath,
        default_acl: defaultAcl,
        marketplace_security_definer: securityDefiner,
        marketplace_security_definer_owners: securityDefinerOwners,
        marketplace_object_owners: marketplaceObjectOwners,
        marketplace_security_definer_search_paths: securityDefinerSearchPaths,
        exposed_dynamic_sql: exposedDynamicSql,
        broad_marketplace_table_privileges: broadTablePrivileges,
        null_limit_risks: limitRisks,
        targeted_null_limit_risks: targetedLimitRisks,
        unexpected_postgres_default_privileges: unexpectedPostgresDefaults,
        promotion_dormant_privileges: promotionDormantPrivileges,
        creator_search_grants: creatorSearchGrants,
        seller_list_contracts: sellerListContracts,
        mode,
        read_only: true,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end().catch(() => {});
}
