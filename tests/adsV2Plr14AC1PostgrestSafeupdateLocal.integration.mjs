// Real disposable PostgreSQL proof. Set NELYON_PLR14AC1_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR14AC1_LOCAL === "1";
const container = process.env.NELYON_PLR14AC1_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR14AC1_TEMPLATE ?? "plr9_production_clone2";
const databaseOwner = "supabase_admin";
const superAdmin = "11000000-0000-4000-8000-000000000001";
const platformAdmin = "11000000-0000-4000-8000-000000000002";
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const names = readdirSync(migrationDirectory);
const canonicalCodes = [
  "social_feed",
  "clips",
  "stories",
  "live",
  "marketplace_home",
  "marketplace_search",
];

function migration(suffix, { optional = false } = {}) {
  const matching = names.filter((name) => name.endsWith(suffix));
  assert.equal(matching.length, optional ? Math.min(matching.length, 1) : 1, suffix);
  return matching.length === 0
    ? null
    : readFileSync(new URL(matching[0], migrationDirectory), "utf8");
}

const prerequisites = [
  "_ads_v2_plr_10_multisurface_age_targeting.sql",
  "_ads_v2_plr_10_c1_multisurface_render_payload.sql",
  "_ads_v2_plr_11_objective_runtime_measurement.sql",
  "_ads_v2_plr_11_c1_measurement_integrity.sql",
  "_ads_v2_plr_12_production_pricing_v1.sql",
];
const rolloutMigration = migration("_ads_v2_plr_14a_production_rollout_controls.sql");
const correctionMigration = migration(
  "_ads_v2_plr_14a_c1_postgrest_safeupdate.sql",
  { optional: true },
);

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psql(db, sql, { allowFailure = false, authenticator = false } = {}) {
  const args = ["exec", "-i"];
  if (authenticator) args.push("-e", "PGPASSWORD=postgres");
  args.push(
    container,
    "psql",
    ...(authenticator ? ["-h", "127.0.0.1", "-p", "5432"] : []),
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    authenticator ? "authenticator" : databaseOwner,
    "-d",
    db,
    "-At",
  );
  return docker(args, { input: sql, allowFailure });
}

function createDatabase() {
  const db = `plr14ac1_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", databaseOwner, "-T", template, db]);
  psql(
    db,
    "insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');" +
      "insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);",
  );
  for (const suffix of prerequisites) psql(db, migration(suffix));
  psql(
    db,
    "set session_replication_role=replica;" +
      "update private.advertising_billing_rate_versions set effective_from=clock_timestamp()-interval '1 minute',published_at=clock_timestamp()-interval '1 minute';" +
      "set session_replication_role=origin;",
  );
  psql(db, rolloutMigration);
  if (correctionMigration) psql(db, correctionMigration);
  return db;
}

function dropDatabase(db) {
  docker(
    ["exec", container, "dropdb", "-U", databaseOwner, "--force", "--if-exists", db],
    { allowFailure: true },
  );
}

function actorSql(actor, role, sql) {
  return `begin;set local role ${role};` +
    `select set_config('request.jwt.claim.role','${role}',true);` +
    `select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
}

function authenticatedCall(db, actor, sql, { allowFailure = false } = {}) {
  return psql(db, actorSql(actor, "authenticated", sql), {
    allowFailure,
    authenticator: true,
  });
}

function rolloutPayload(overrides = {}) {
  return JSON.stringify(
    canonicalCodes.map((code) => ({
      code,
      rollout_bps: overrides[code] ?? 100,
      kill_switch: false,
    })),
  );
}

function configure(db, {
  actor = superAdmin,
  version = 1,
  payload = rolloutPayload(),
  key = randomUUID(),
  allowFailure = false,
} = {}) {
  return authenticatedCall(
    db,
    actor,
    `select public.set_admin_advertising_production_rollout_v1(` +
      `${version},false,'${payload}'::jsonb,'${key}');`,
    { allowFailure },
  );
}

test(
  "authenticated SUPER_ADMIN can save rollout and launch/disarm with authenticator safeupdate enabled",
  { skip: !enabled, timeout: 120000 },
  () => {
    const db = createDatabase();
    try {
      const beforeTransactions = psql(db, "select count(*) from public.financial_transactions;").stdout;
      const key = randomUUID();
      const saved = configure(db, { key, allowFailure: true });
      assert.equal(saved.status, 0, saved.stderr);
      assert.equal(
        psql(
          db,
          "select production_rollout_config_version||'|'||" +
            "(select count(*) from private.advertising_placement_catalog where production_rollout_bps=100)||'|'||" +
            "(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled) " +
            "from private.advertising_delivery_policy where singleton;",
        ).stdout,
        "2|6|0",
      );
      assert.equal(configure(db, { key, allowFailure: true }).status, 0);
      assert.equal(
        psql(
          db,
          "select count(*) from private.admin_action_audit " +
            "where action='advertising.production_rollout.configure';",
        ).stdout,
        "1",
      );
      assert.notEqual(
        configure(db, {
          key,
          payload: rolloutPayload({ social_feed: 200 }),
          allowFailure: true,
        }).status,
        0,
      );
      assert.notEqual(configure(db, { version: 1, allowFailure: true }).status, 0);
      assert.notEqual(configure(db, { actor: platformAdmin, version: 2, allowFailure: true }).status, 0);

      const launch = authenticatedCall(
        db,
        superAdmin,
        `select public.set_advertising_launch_mode_v2('PRODUCTION','${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.equal(launch.status, 0, launch.stderr);
      assert.equal(
        psql(
          db,
          "select launch_mode||'|'||" +
            "(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||" +
            "(select count(*) from private.advertising_billing_authorization_windows where status='OPEN' and mode='PRODUCTION') " +
            "from private.advertising_canary_policy where singleton;",
        ).stdout,
        "PRODUCTION|6|1",
      );

      const disarm = authenticatedCall(
        db,
        superAdmin,
        `select public.set_advertising_launch_mode_v2('DISARMED','${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.equal(disarm.status, 0, disarm.stderr);
      assert.equal(
        psql(
          db,
          "select launch_mode||'|'||" +
            "(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)||'|'||" +
            "(select count(*) from private.advertising_placement_catalog where production_rollout_bps=100)||'|'||" +
            "(select count(*) from private.advertising_billing_authorization_windows where status='OPEN') " +
            "from private.advertising_canary_policy where singleton;",
        ).stdout,
        "DISARMED|0|6|0",
      );
      assert.equal(
        psql(db, "select count(*) from public.financial_transactions;").stdout,
        beforeTransactions,
      );

      const anon = psql(
        db,
        actorSql("00000000-0000-0000-0000-000000000000", "anon", "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid())"),
        { allowFailure: true, authenticator: true },
      );
      assert.notEqual(anon.status, 0);
    } finally {
      dropDatabase(db);
    }
  },
);
