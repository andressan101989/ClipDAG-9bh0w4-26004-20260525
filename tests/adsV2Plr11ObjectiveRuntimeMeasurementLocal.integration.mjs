// Real disposable PostgreSQL proof. Set NELYON_PLR11_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR11_LOCAL === "1";
const container = process.env.NELYON_PLR11_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR11_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const otherViewer = "10000000-0000-4000-8000-000000000003";
const campaign = "40000000-0000-4000-8000-000000000001";
const adSet = "50000000-0000-4000-8000-000000000001";
const destination = "60000000-0000-4000-8000-000000000001";
const creativeVersion = "71000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const audience = "82000000-0000-4000-8000-000000000001";
const placement = "84000000-0000-4000-8000-000000000001";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const names = readdirSync(migrationDirectory);
const migration = (suffix) => {
  const matching = names.filter((name) => name.endsWith(suffix));
  assert.equal(matching.length, 1, suffix);
  return readFileSync(new URL(matching[0], migrationDirectory), "utf8");
};
const plr10 = migration("_ads_v2_plr_10_multisurface_age_targeting.sql");
const plr10c1 = migration("_ads_v2_plr_10_c1_multisurface_render_payload.sql");
const plr11 = migration("_ads_v2_plr_11_objective_runtime_measurement.sql");
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], { input: sql, ...options });
}
function authSql(actor, sql) {
  return `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
}
function createDatabase() {
  const db = `plr11_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);`);
  psql(db, plr10);
  psql(db, plr10c1);
  psql(db, plr11);
  psql(db, fixture);
  psql(db, `select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());
    set session_replication_role=replica;
    insert into auth.users(id) values('${viewer}'),('${otherViewer}');
    insert into public.user_profiles(id) values('${viewer}'),('${otherViewer}');
    set session_replication_role=origin;`);
  return db;
}
function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}
function impressionSql(id, key, viewerId, occurredAt = "clock_timestamp()") {
  return `insert into private.advertising_events(
    id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,context_fingerprint,occurred_at
  ) values('${id}','${key}','impression','${ad}','${campaign}','${adSet}','${creativeVersion}','${destination}',
    '${audience}','${placement}','social_feed','${viewerId}',repeat('e',64),${occurredAt});`;
}

test("PLR-11 objective matrix, URL authority and ACL compile in disposable PostgreSQL", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, "select string_agg(objective||':'||setup_enabled||':'||delivery_runtime_ready||':'||billing_runtime_ready||':'||conversion_runtime_ready||':'||coalesce(billable_event_type,'-')||':'||coalesce(primary_metric,'-'),',' order by objective) from private.advertising_objective_capabilities;").stdout,
      "app_promotion:true:true:true:false:click:app_store_opens,awareness:true:true:true:false:impression:impressions,engagement:true:true:true:false:click:qualified_interactions,marketplace_sales:true:true:true:true:click:attributed_conversions,messages:true:true:true:true:click:message_starts,profile_visits:true:true:true:true:click:profile_visits,reach:true:true:true:false:impression:unique_reach,traffic:true:true:true:false:click:clicks,video_views:true:true:true:false:impression:video_views,website_conversions:false:false:false:false:-:-");
    assert.equal(psql(db, "select private.advertising_app_store_url_valid('https://apps.apple.com/us/app/example/id1')||'|'||private.advertising_app_store_url_valid('https://play.google.com/store/apps/details?id=x')||'|'||private.advertising_app_store_url_valid('https://apps.apple.com.evil.test/app')||'|'||private.advertising_app_store_url_valid('https://apps.apple.com@evil.test/app')||'|'||private.advertising_app_store_url_valid('https://apps.apple.com:8443/app');").stdout, "true|true|false|false|false");
    assert.equal(psql(db, `select
      private.advertising_objective_destination_valid('profile_visits','nelyon_profile',null,'${owner}',null,null,null)||'|'||
      private.advertising_objective_destination_valid('profile_visits','external_url','https://example.com',null,null,null,null)||'|'||
      private.advertising_objective_destination_valid('messages','nelyon_message',null,'${owner}',null,null,null)||'|'||
      private.advertising_objective_destination_valid('messages','nelyon_profile',null,'${owner}',null,null,null)||'|'||
      private.advertising_objective_destination_valid('app_promotion','external_url','https://apps.apple.com/us/app/x',null,null,null,null)||'|'||
      private.advertising_objective_destination_valid('app_promotion','external_url','https://example.com',null,null,null,null)||'|'||
      private.advertising_objective_destination_valid('website_conversions','external_url','https://example.com',null,null,null,null);`).stdout,
      "true|false|true|false|true|false|false");
    assert.equal(psql(db, "select has_function_privilege('authenticated','public.record_advertising_message_start_conversion_v2(uuid,uuid)','execute')||'|'||has_function_privilege('anon','public.record_advertising_message_start_conversion_v2(uuid,uuid)','execute')||'|'||has_function_privilege('service_role','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute')||'|'||has_function_privilege('authenticated','public.record_advertising_interaction_v2(uuid,text,uuid,uuid)','execute');").stdout, "true|false|true|false");
  } finally { dropDatabase(db); }
});

test("profile destination-open creates one viewer-bound conversion and click attribution", { skip: !enabled }, () => {
  const db = createDatabase();
  const impression = "c1000000-0000-4000-8000-000000000001";
  try {
    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='profile_visits' where id='${campaign}';
      update private.advertising_destinations set destination_type='nelyon_profile',external_url=null,target_user_id='${owner}' where id='${destination}';
      ${impressionSql(impression, "c1000000-0000-4000-8000-000000000011", viewer)}
      set session_replication_role=origin;`);
    psql(db, `set role service_role;select public.record_advertising_interaction_v2('${impression}','click','c1000000-0000-4000-8000-000000000012','${viewer}');reset role;
      set role service_role;select public.record_advertising_interaction_v2('${impression}','destination_open','c1000000-0000-4000-8000-000000000013','${viewer}');reset role;
      set role service_role;select public.record_advertising_interaction_v2('${impression}','destination_open','c1000000-0000-4000-8000-000000000013','${viewer}');reset role;`);
    psql(db, `set role service_role;select public.record_advertising_interaction_v2('${impression}','destination_open','c1000000-0000-4000-8000-000000000014','${viewer}');reset role;`);
    assert.equal(psql(db, "select count(*)||'|'||min(conversion_type)||'|'||min(viewer_user_id::text)||'|'||min(source_type)||'|'||min(source_reference_id::text) from private.advertising_conversions;").stdout, `1|profile_visit|${viewer}|advertising_impression|${impression}`);
    assert.equal(psql(db, "select count(*)||'|'||min(touch_event_type) from private.advertising_attributions;").stdout, "1|click");
  } finally { dropDatabase(db); }
});

test("messages require the first successful outbound message and never store Chat content in Ads", { skip: !enabled }, () => {
  const db = createDatabase();
  const impression = "c2000000-0000-4000-8000-000000000001";
  const message = "c2000000-0000-4000-8000-000000000021";
  try {
    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='messages' where id='${campaign}';
      update private.advertising_destinations set destination_type='nelyon_message',external_url=null,target_user_id='${owner}' where id='${destination}';
      ${impressionSql(impression, "c2000000-0000-4000-8000-000000000011", viewer)}
      set session_replication_role=origin;`);
    assert.equal(psql(db, "select count(*) from private.advertising_conversions where conversion_type='message_start';").stdout, "0");
    psql(db, `set role service_role;
      select public.record_advertising_interaction_v2('${impression}','click','c2000000-0000-4000-8000-000000000012','${viewer}');
      select public.record_advertising_interaction_v2('${impression}','destination_open','c2000000-0000-4000-8000-000000000013','${viewer}');
      reset role;`);
    psql(db, `set session_replication_role=replica;
      insert into public.messages(id,sender_id,recipient_id,text,conversation_id,client_message_id,message_type,created_at)
      values('${message}','${viewer}','${owner}','private fixture content','c2000000-0000-4000-8000-000000000031','c2000000-0000-4000-8000-000000000041','text',clock_timestamp());
      set session_replication_role=origin;`);
    psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${message}','${impression}');
      select public.record_advertising_message_start_conversion_v2('${message}','${impression}');`));
    assert.equal(psql(db, "select count(*)||'|'||min(conversion_type)||'|'||min(source_type)||'|'||min(source_reference_id::text) from private.advertising_conversions where conversion_type='message_start';").stdout, `1|message_start|advertising_impression|${impression}`);
    assert.equal(psql(db, "select count(*) from information_schema.columns where table_schema='private' and table_name in ('advertising_conversions','advertising_attributions') and column_name in ('text','content','message_content');").stdout, "0");
    assert.notEqual(psql(db, authSql(owner, `select public.record_advertising_message_start_conversion_v2('${message}','${impression}');`), { allowFailure: true }).status, 0);
  } finally { dropDatabase(db); }
});

test("canonical event summary reports distinct authenticated reach and objective results", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='reach' where id='${campaign}';
      ${impressionSql("c3000000-0000-4000-8000-000000000001", "c3000000-0000-4000-8000-000000000011", viewer)}
      ${impressionSql("c3000000-0000-4000-8000-000000000002", "c3000000-0000-4000-8000-000000000012", viewer)}
      ${impressionSql("c3000000-0000-4000-8000-000000000003", "c3000000-0000-4000-8000-000000000013", otherViewer)}
      set session_replication_role=origin;`);
    const summary = JSON.parse(psql(db, authSql(owner, `select public.get_my_advertising_event_summary('${campaign}')::text;`)).stdout.split("\n").at(-1));
    assert.equal(summary.impressions, 3);
    assert.equal(summary.unique_reach, 2);
    assert.equal(summary.objective_results, 2);
    assert.equal(summary.primary_metric, "unique_reach");
  } finally { dropDatabase(db); }
});
