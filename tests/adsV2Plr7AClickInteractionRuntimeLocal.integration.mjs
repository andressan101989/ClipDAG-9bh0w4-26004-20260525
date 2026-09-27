// Disposable PostgreSQL proof only. NELYON_PLR7A_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR7A_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr7a_click_${process.pid}`;
const viewerA = "10000000-0000-4000-8000-000000000001";
const viewerB = "10000000-0000-4000-8000-000000000002";
const parentA = "20000000-0000-4000-8000-000000000001";
const parentB = "20000000-0000-4000-8000-000000000002";
const expiredParent = "20000000-0000-4000-8000-000000000003";
const clickKey = "30000000-0000-4000-8000-000000000001";
const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_7a_secure_click_interaction_runtime.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();

const bootstrap = `
  create schema auth;
  create schema private;
  create table private.advertising_event_policy(
    singleton boolean primary key,
    interaction_max_delay_hours integer not null
  );
  insert into private.advertising_event_policy values(true,24);
  create table private.advertising_events(
    id uuid primary key default gen_random_uuid(),
    event_key uuid not null unique,
    event_type text not null,
    ad_id uuid not null,
    campaign_id uuid not null,
    ad_set_id uuid not null,
    creative_version_id uuid not null,
    destination_id uuid not null,
    audience_version_id uuid not null,
    placement_selection_version_id uuid not null,
    placement_code text not null,
    viewer_user_id uuid,
    parent_impression_event_id uuid references private.advertising_events(id),
    context_fingerprint text not null,
    occurred_at timestamptz not null default clock_timestamp(),
    created_at timestamptz not null default clock_timestamp()
  );
  create function public.record_advertising_interaction_v2(uuid,text,uuid)
  returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
  revoke all on function public.record_advertising_interaction_v2(uuid,text,uuid) from public,anon,authenticated;
  grant execute on function public.record_advertising_interaction_v2(uuid,text,uuid) to service_role;
  insert into private.advertising_events(
    id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
    context_fingerprint,occurred_at
  ) values
    ('${parentA}','40000000-0000-4000-8000-000000000001','impression',
     '50000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',
     '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',
     '54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001',
     '56000000-0000-4000-8000-000000000001','social_feed','${viewerA}',repeat('a',64),clock_timestamp()),
    ('${parentB}','40000000-0000-4000-8000-000000000002','impression',
     '50000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002',
     '52000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002',
     '54000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000002',
     '56000000-0000-4000-8000-000000000002','social_feed','${viewerA}',repeat('b',64),clock_timestamp()),
    ('${expiredParent}','40000000-0000-4000-8000-000000000003','impression',
     '50000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000003',
     '52000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003',
     '54000000-0000-4000-8000-000000000003','55000000-0000-4000-8000-000000000003',
     '56000000-0000-4000-8000-000000000003','social_feed','${viewerA}',repeat('c',64),clock_timestamp()-interval '25 hours');
`;

test("PLR-7A binds canonical click interactions to the authenticated parent viewer", { skip: !enabled, timeout: 120_000 }, () => {
  assert.equal(migrationNames.length, 1, "one PLR-7A migration is required");
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(migration);

    const created = JSON.parse(run(`select public.record_advertising_interaction_v2('${parentA}','click','${clickKey}','${viewerA}')`));
    assert.equal(created.event_type, "click");
    assert.equal(created.parent_impression_event_id, parentA);
    assert.equal(created.viewer_user_id, viewerA);
    assert.equal(created.ad_id, "50000000-0000-4000-8000-000000000001");
    assert.equal(created.campaign_id, "51000000-0000-4000-8000-000000000001");
    assert.equal(created.ad_set_id, "52000000-0000-4000-8000-000000000001");
    assert.equal(created.creative_version_id, "53000000-0000-4000-8000-000000000001");
    assert.equal(created.destination_id, "54000000-0000-4000-8000-000000000001");
    assert.equal(created.audience_version_id, "55000000-0000-4000-8000-000000000001");
    assert.equal(created.placement_selection_version_id, "56000000-0000-4000-8000-000000000001");
    assert.equal(created.placement_code, "social_feed");
    assert.equal(created.context_fingerprint, "a".repeat(64));

    const same = JSON.parse(run(`select public.record_advertising_interaction_v2('${parentA}','click','${clickKey}','${viewerA}')`));
    assert.equal(same.id, created.id, "same key and payload is idempotent");
    assert.equal(run(`select count(*) from private.advertising_events where event_key='${clickKey}'`), "1");

    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${parentB}','click','${clickKey}','${viewerA}')`),
      /advertising_event_idempotency_conflict/,
      "same key cannot move to another parent",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${parentA}','destination_open','${clickKey}','${viewerA}')`),
      /advertising_event_idempotency_conflict/,
      "same key cannot change event type",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${created.id}','click',gen_random_uuid(),'${viewerA}')`),
      /advertising_parent_impression_required/,
      "an interaction cannot parent another interaction",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('20000000-0000-4000-8000-000000000099','click',gen_random_uuid(),'${viewerA}')`),
      /advertising_parent_impression_required/,
      "unknown parent is rejected",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${parentA}','click',gen_random_uuid(),'${viewerB}')`),
      /advertising_interaction_viewer_mismatch/,
      "viewer B cannot use viewer A's impression",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${parentA}','click',gen_random_uuid(),null)`),
      /advertising_viewer_required/,
      "null viewer is rejected",
    );
    assert.throws(
      () => run(`select public.record_advertising_interaction_v2('${expiredParent}','click',gen_random_uuid(),'${viewerA}')`),
      /advertising_interaction_window_expired/,
      "expired interaction window is rejected",
    );

    assert.equal(run("select to_regprocedure('public.record_advertising_interaction_v2(uuid,text,uuid)') is null"), "t");
    assert.equal(run("select to_regprocedure('public.record_advertising_interaction_v2(uuid,text,uuid,uuid)') is not null"), "t");
    assert.equal(run("select has_function_privilege('public','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('anon','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('service_role','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute')"), "t");
    assert.equal(
      run("select prosecdef||':'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='public.record_advertising_interaction_v2(uuid,text,uuid,uuid)'::regprocedure"),
      "true:search_path=\"\"",
    );
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
