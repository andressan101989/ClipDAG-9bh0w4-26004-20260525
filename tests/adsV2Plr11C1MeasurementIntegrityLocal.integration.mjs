// Real disposable PostgreSQL proof. Set NELYON_PLR11_C1_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR11_C1_LOCAL === "1";
const container = process.env.NELYON_PLR11_C1_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR11_C1_TEMPLATE ?? "plr9_production_clone2";
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
function migration(suffix) {
  const matching = names.filter((name) => name.endsWith(suffix));
  assert.equal(matching.length, 1, suffix);
  return readFileSync(new URL(matching[0], migrationDirectory), "utf8");
}
const migrations = [
  migration("_ads_v2_plr_10_multisurface_age_targeting.sql"),
  migration("_ads_v2_plr_10_c1_multisurface_render_payload.sql"),
  migration("_ads_v2_plr_11_objective_runtime_measurement.sql"),
  migration("_ads_v2_plr_11_c1_measurement_integrity.sql"),
];
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], { input: sql, ...options });
}
function psqlAsync(db, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      : reject(new Error(`parallel psql failed (${code})\n${stdout}\n${stderr}`)));
    child.stdin.end(sql);
  });
}
function authSql(actor, sql) {
  return `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
}
function createDatabase() {
  const db = `plr11c1_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);`);
  for (const sql of migrations) psql(db, sql);
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
function impressionSql(id, key, viewerId = viewer, occurredAt = "clock_timestamp()-interval '1 minute'") {
  return `insert into private.advertising_events(
    id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,context_fingerprint,occurred_at
  ) values('${id}','${key}','impression','${ad}','${campaign}','${adSet}','${creativeVersion}','${destination}',
    '${audience}','${placement}','social_feed','${viewerId}',repeat('e',64),${occurredAt});`;
}
function videoCreativeSql() {
  return `insert into public.video_assets(
      id,owner_id,purpose,status,cloudflare_uid,mime_type,size_bytes,hls_url,duration_seconds,ready_at
    ) values(
      '73000000-0000-4000-8000-000000000001','${owner}','feed_video','ready',
      'plr11-c1-disposable-video','video/mp4',1024,
      'https://video.test/plr11-c1.m3u8',1,clock_timestamp()
    );
    update private.advertising_creative_versions
    set format='video',media_asset_id=null,video_asset_id='73000000-0000-4000-8000-000000000001'
    where id='${creativeVersion}';`;
}

test("server enforces one qualified video_view per impression, validates video creative and never bills it", { skip: !enabled }, () => {
  const db = createDatabase();
  const impression = "d1000000-0000-4000-8000-000000000001";
  const imageImpression = "d1000000-0000-4000-8000-000000000002";
  try {
    psql(db, `set session_replication_role=replica;
      ${videoCreativeSql()}
      ${impressionSql(impression, "d1000000-0000-4000-8000-000000000011")}
      set session_replication_role=origin;`);
    const same = psql(db, `set role service_role;
      select (public.record_advertising_interaction_v2('${impression}','video_view','d1000000-0000-4000-8000-000000000021','${viewer}')->>'id');
      select (public.record_advertising_interaction_v2('${impression}','video_view','d1000000-0000-4000-8000-000000000021','${viewer}')->>'id');
      select (public.record_advertising_interaction_v2('${impression}','video_view','d1000000-0000-4000-8000-000000000022','${viewer}')->>'id');reset role;`).stdout.split("\n");
    assert.equal(new Set(same).size, 1);
    assert.equal(psql(db, `select count(*) from private.advertising_events where parent_impression_event_id='${impression}' and event_type='video_view';`).stdout, "1");
    assert.equal(psql(db, `select count(*) from private.advertising_event_billing_materializations where billable_event_id in(select id from private.advertising_events where parent_impression_event_id='${impression}' and event_type='video_view');`).stdout, "0");
    assert.notEqual(psql(db, `set role service_role;select public.record_advertising_interaction_v2('${impression}','video_view','d1000000-0000-4000-8000-000000000023','${otherViewer}');`, { allowFailure: true }).status, 0);

    psql(db, `set session_replication_role=replica;
      update private.advertising_creative_versions
      set format='image',media_asset_id='72000000-0000-4000-8000-000000000001',video_asset_id=null
      where id='${creativeVersion}';
      ${impressionSql(imageImpression, "d1000000-0000-4000-8000-000000000012")}
      set session_replication_role=origin;`);
    const invalid = psql(db, `set role service_role;select public.record_advertising_interaction_v2('${imageImpression}','video_view','d1000000-0000-4000-8000-000000000024','${viewer}');`, { allowFailure: true });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /advertising_video_view_creative_invalid/);
  } finally { dropDatabase(db); }
});

test("different-key concurrent video submissions in separate PostgreSQL sessions converge on one row", { skip: !enabled }, async () => {
  const db = createDatabase();
  const impression = "d2000000-0000-4000-8000-000000000001";
  try {
    psql(db, `set session_replication_role=replica;
      ${videoCreativeSql()}
      ${impressionSql(impression, "d2000000-0000-4000-8000-000000000011")}
      set session_replication_role=origin;
      create function public.plr11c1_delay_video_insert() returns trigger language plpgsql as $$begin perform pg_sleep(0.2);return new;end$$;
      create trigger plr11c1_delay_video_insert before insert on private.advertising_events for each row when(new.event_type='video_view') execute function public.plr11c1_delay_video_insert();`);
    const call = (key) => psqlAsync(db, `set role service_role;select (public.record_advertising_interaction_v2('${impression}','video_view','${key}','${viewer}')->>'id');reset role;`);
    const [a, b] = await Promise.all([
      call("d2000000-0000-4000-8000-000000000021"),
      call("d2000000-0000-4000-8000-000000000022"),
    ]);
    assert.equal(a.stdout, b.stdout);
    assert.equal(psql(db, `select count(*) from private.advertising_events where parent_impression_event_id='${impression}' and event_type='video_view';`).stdout, "1");
  } finally { dropDatabase(db); }
});

test("all five canonical outbound Chat types create one message_start without destination-open ordering", { skip: !enabled }, () => {
  const db = createDatabase();
  const types = ["text", "image", "video", "one_time_image", "voice"];
  try {
    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='messages' where id='${campaign}';
      update private.advertising_destinations set destination_type='nelyon_message',external_url=null,target_user_id='${owner}' where id='${destination}';
      set session_replication_role=origin;`);
    assert.equal(psql(db, "select count(*) from private.advertising_conversions where conversion_type='message_start';").stdout, "0", "opening Chat alone");
    types.forEach((messageType, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      const impression = `d3000000-0000-4000-8000-0000000000${suffix}`;
      const message = `d3100000-0000-4000-8000-0000000000${suffix}`;
      const conversation = `d3200000-0000-4000-8000-0000000000${suffix}`;
      const clientKey = `d3300000-0000-4000-8000-0000000000${suffix}`;
      psql(db, `set session_replication_role=replica;
        ${impressionSql(impression, `d3400000-0000-4000-8000-0000000000${suffix}`)}
        set session_replication_role=origin;
        set role service_role;
        select public.record_advertising_interaction_v2(
          '${impression}','click','d3500000-0000-4000-8000-0000000000${suffix}','${viewer}'
        );
        reset role;
        set session_replication_role=replica;
        insert into public.messages(
          id,sender_id,recipient_id,text,conversation_id,client_message_id,message_type,media_type,
          media_asset_id,consumption_policy,audio_duration_ms,audio_waveform,created_at
        ) values(
          '${message}','${viewer}','${owner}','sensitive-${messageType}','${conversation}','${clientKey}',
          '${messageType}','${messageType}',
          case when '${messageType}' in('image','video','one_time_image','voice') then '72000000-0000-4000-8000-000000000001'::uuid end,
          case when '${messageType}'='one_time_image' then 'one_time' else 'standard' end,
          case when '${messageType}'='voice' then 1200 end,
          case when '${messageType}'='voice' then array[${Array(48).fill(50).join(",")}]::smallint[] end,
          clock_timestamp()
        );
        set session_replication_role=origin;`);
      psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${message}','${impression}');
        select public.record_advertising_message_start_conversion_v2('${message}','${impression}');`));
    });
    assert.equal(psql(db, "select count(*) from private.advertising_conversions where conversion_type='message_start';").stdout, "5");
    assert.equal(psql(db, "select count(*) from private.advertising_attributions attribution join private.advertising_conversions conversion on conversion.id=attribution.conversion_id where conversion.conversion_type='message_start';").stdout, "5");
    assert.equal(psql(db, "select count(*) from private.advertising_attributions attribution join private.advertising_conversions conversion on conversion.id=attribution.conversion_id where conversion.conversion_type='message_start' and attribution.touch_event_type='click';").stdout, "5");
    assert.equal(psql(db, "select count(*) from information_schema.columns where table_schema='private' and table_name in('advertising_conversions','advertising_attributions') and column_name in('text','content','message_content');").stdout, "0");
    assert.equal(psql(db, "select count(*) from private.advertising_events where event_type='destination_open';").stdout, "0");
  } finally { dropDatabase(db); }
});

test("message conversion rejects wrong evidence, preserves first-outbound semantics and survives delayed destination-open", { skip: !enabled }, () => {
  const db = createDatabase();
  const impression = "d4000000-0000-4000-8000-000000000001";
  const first = "d4100000-0000-4000-8000-000000000001";
  const second = "d4100000-0000-4000-8000-000000000002";
  const wrongSender = "d4100000-0000-4000-8000-000000000003";
  const wrongRecipient = "d4100000-0000-4000-8000-000000000004";
  try {
    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='messages' where id='${campaign}';
      update private.advertising_destinations set destination_type='nelyon_message',external_url=null,target_user_id='${owner}' where id='${destination}';
      ${impressionSql(impression, "d4200000-0000-4000-8000-000000000001")}
      insert into public.messages(id,sender_id,recipient_id,text,conversation_id,client_message_id,message_type,created_at) values
        ('${first}','${viewer}','${owner}','first','d4300000-0000-4000-8000-000000000001','d4400000-0000-4000-8000-000000000001','text',clock_timestamp()),
        ('${second}','${viewer}','${owner}','second','d4300000-0000-4000-8000-000000000001','d4400000-0000-4000-8000-000000000002','image',clock_timestamp()+interval '1 millisecond'),
        ('${wrongSender}','${otherViewer}','${owner}','wrong sender','d4300000-0000-4000-8000-000000000001','d4400000-0000-4000-8000-000000000003','text',clock_timestamp()),
        ('${wrongRecipient}','${viewer}','${otherViewer}','wrong recipient','d4300000-0000-4000-8000-000000000001','d4400000-0000-4000-8000-000000000004','text',clock_timestamp());
      set session_replication_role=origin;`);
    assert.notEqual(psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${second}','${impression}');`), { allowFailure: true }).status, 0);
    assert.notEqual(psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${wrongSender}','${impression}');`), { allowFailure: true }).status, 0);
    assert.notEqual(psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${wrongRecipient}','${impression}');`), { allowFailure: true }).status, 0);
    assert.notEqual(psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${first}','d4000000-0000-4000-8000-000000000099');`), { allowFailure: true }).status, 0);
    psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${first}','${impression}');`));
    psql(db, `set role service_role;select public.record_advertising_interaction_v2('${impression}','destination_open','d4500000-0000-4000-8000-000000000001','${viewer}');reset role;`);
    psql(db, authSql(viewer, `select public.record_advertising_message_start_conversion_v2('${first}','${impression}');`));
    assert.equal(psql(db, "select count(*) from private.advertising_conversions where conversion_type='message_start';").stdout, "1");
  } finally { dropDatabase(db); }
});
