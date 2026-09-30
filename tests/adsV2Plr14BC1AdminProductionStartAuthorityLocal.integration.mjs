// Real disposable PostgreSQL proof. Set NELYON_PLR14BC1_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR14BC1_LOCAL === "1";
const container = process.env.NELYON_PLR14BC1_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR14BC1_TEMPLATE ?? "plr9_production_clone2";
const databaseOwner = "supabase_admin";
const superAdmin = "11000000-0000-4000-8000-000000000001";
const platformAdmin = "11000000-0000-4000-8000-000000000002";
const ordinaryUser = "11000000-0000-4000-8000-000000000003";
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationNames = readdirSync(migrationDirectory);
const canonicalCodes = [
  "social_feed",
  "clips",
  "stories",
  "live",
  "marketplace_home",
  "marketplace_search",
];

function migration(suffix) {
  const matching = migrationNames.filter((name) => name.endsWith(suffix));
  assert.equal(matching.length, 1, suffix);
  return readFileSync(new URL(matching[0], migrationDirectory), "utf8");
}

const prerequisites = [
  "_ads_v2_plr_10_multisurface_age_targeting.sql",
  "_ads_v2_plr_10_c1_multisurface_render_payload.sql",
  "_ads_v2_plr_11_objective_runtime_measurement.sql",
  "_ads_v2_plr_11_c1_measurement_integrity.sql",
  "_ads_v2_plr_12_production_pricing_v1.sql",
];
const rolloutMigration = migration("_ads_v2_plr_14a_production_rollout_controls.sql");
const safeUpdateMigration = migration("_ads_v2_plr_14a_c1_postgrest_safeupdate.sql");
const authorityMigration = migration("_ads_v2_plr_14b_c1_admin_production_start_authority.sql");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
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

function psqlAsyncAsAuthenticator(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", [
      "exec", "-i", "-e", "PGPASSWORD=postgres", container,
      "psql", "-h", "127.0.0.1", "-p", "5432", "-X", "-q",
      "-v", "ON_ERROR_STOP=1", "-U", "authenticator", "-d", db, "-At",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
}

function createDatabase() {
  const db = `plr14bc1_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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
  psql(db, safeUpdateMigration);
  psql(db, authorityMigration);
  return db;
}

function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", databaseOwner, "--force", "--if-exists", db], { allowFailure: true });
}

function actorSql(actor, role, sql) {
  return `begin;set local role ${role};` +
    `select set_config('request.jwt.claim.role','${role}',true);` +
    `select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
}

function browserCall(db, actor, role, sql, { allowFailure = false } = {}) {
  return psql(db, actorSql(actor, role, sql), { allowFailure, authenticator: true });
}

function rolloutPayload() {
  return JSON.stringify(canonicalCodes.map((code) => ({ code, rollout_bps: 100, kill_switch: false })));
}

function configure(db) {
  return browserCall(
    db,
    superAdmin,
    "authenticated",
    `select public.set_admin_advertising_production_rollout_v1(1,false,'${rolloutPayload()}'::jsonb,'${randomUUID()}');`,
  );
}

test(
  "the authenticated admin bridge is narrow, idempotent and preserves the canonical state machine",
  { skip: !enabled, timeout: 120000 },
  async () => {
    const db = createDatabase();
    try {
      assert.equal(
        psql(
          db,
          "select concat_ws('|'," +
            "has_function_privilege('anon','public.set_admin_advertising_launch_mode_v1(text,uuid)','execute')," +
            "has_function_privilege('authenticated','public.set_admin_advertising_launch_mode_v1(text,uuid)','execute')," +
            "has_function_privilege('service_role','public.set_admin_advertising_launch_mode_v1(text,uuid)','execute')," +
            "has_function_privilege('authenticated','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute')," +
            "has_function_privilege('service_role','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute'));",
        ).stdout,
        "f|t|f|f|t",
      );
      assert.equal(
        psql(
          db,
          "select count(*) from information_schema.parameters where specific_schema='public' and specific_name like 'set_admin_advertising_launch_mode_v1%' and parameter_name ilike '%actor%';",
        ).stdout,
        "0",
      );

      configure(db);
      const beforeTransactions = psql(db, "select count(*) from public.financial_transactions;").stdout;
      const direct = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_advertising_launch_mode_v2('PRODUCTION','${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.notEqual(direct.status, 0);
      assert.match(direct.stderr, /permission denied/i);

      for (const [actor, role] of [
        [ordinaryUser, "anon"],
        [ordinaryUser, "authenticated"],
        [platformAdmin, "authenticated"],
      ]) {
        const denied = browserCall(
          db,
          actor,
          role,
          `select public.set_admin_advertising_launch_mode_v1('PRODUCTION','${randomUUID()}');`,
          { allowFailure: true },
        );
        assert.notEqual(denied.status, 0);
      }

      const invalid = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('CANARY_BILLING','${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /advertising_admin_launch_mode_forbidden/);
      const malformed = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1(null,'${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.notEqual(malformed.status, 0);
      assert.match(malformed.stderr, /advertising_admin_launch_mode_forbidden/);

      const key = randomUUID();
      const launchSql = `select public.set_admin_advertising_launch_mode_v1('PRODUCTION','${key}')::text;`;
      const first = browserCall(db, superAdmin, "authenticated", launchSql, { allowFailure: true });
      assert.equal(first.status, 0, first.stderr);
      const replay = browserCall(db, superAdmin, "authenticated", launchSql, { allowFailure: true });
      assert.equal(replay.status, 0, replay.stderr);
      assert.match(replay.stdout, /"idempotent": true/);
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
      assert.equal(
        psql(
          db,
          `select count(*)||'|'||min(actor_id::text)||'|'||min(actor_kind)||'|'||min(actor_capability) from private.admin_action_audit where idempotency_scope='v1|admin|advertising|launch_mode.transition' and idempotency_key='${key}';`,
        ).stdout,
        `1|${superAdmin}|human_admin|advertising.rollout.manage`,
      );

      const conflict = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('DISARMED','${key}');`,
        { allowFailure: true },
      );
      assert.notEqual(conflict.status, 0);
      assert.match(conflict.stderr, /admin_idempotency_conflict/);

      const disarmBeforeRace = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('DISARMED','${randomUUID()}');`,
        { allowFailure: true },
      );
      assert.equal(disarmBeforeRace.status, 0, disarmBeforeRace.stderr);
      const raceKeys = [randomUUID(), randomUUID()];
      const raceCalls = raceKeys.map((raceKey) => actorSql(
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('PRODUCTION','${raceKey}')::text`,
      ));
      const differentKeyRacers = await Promise.all(raceCalls.map((call) => psqlAsyncAsAuthenticator(db, call)));
      assert.equal(differentKeyRacers.filter((result) => result.status === 0).length, 1);
      assert.equal(differentKeyRacers.filter((result) => result.status !== 0).length, 1);
      assert.match(differentKeyRacers.find((result) => result.status !== 0).stderr, /advertising_admin_launch_transition_invalid/);
      assert.equal(
        psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout,
        "1",
      );

      const raceKey = raceKeys[differentKeyRacers.findIndex((result) => result.status === 0)];
      const raceSql = actorSql(
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('PRODUCTION','${raceKey}')::text`,
      );
      const racers = await Promise.all([
        psqlAsyncAsAuthenticator(db, raceSql),
        psqlAsyncAsAuthenticator(db, raceSql),
      ]);
      assert.equal(racers.filter((result) => result.status === 0).length, 2);
      assert.equal(
        psql(db, `select count(*) from private.admin_action_audit where idempotency_scope='v1|admin|advertising|launch_mode.transition' and idempotency_key='${raceKey}';`).stdout,
        "1",
      );
      assert.equal(
        psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout,
        "1",
      );

      const disarm = browserCall(
        db,
        superAdmin,
        "authenticated",
        `select public.set_admin_advertising_launch_mode_v1('DISARMED','${randomUUID()}');`,
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
      assert.equal(psql(db, "select count(*) from public.financial_transactions;").stdout, beforeTransactions);
    } finally {
      dropDatabase(db);
    }
  },
);
