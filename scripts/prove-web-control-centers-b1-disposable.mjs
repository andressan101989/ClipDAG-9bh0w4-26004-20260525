// PostgreSQL 17 loopback-only proof for WEB-CONTROL-CENTERS-B1.
// No project URL or production credential is accepted. The disposable cluster
// is removed after the proof.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  WEB_CONTROL_CENTERS_B1_STATE_SQL,
  validateWebControlCentersB1StateTransition,
} from "./nelyon-production-snapshot-adapter.mjs";

const repo = resolve(import.meta.dirname, "..");
const scratch = resolve("D:/CodexTemp");
const pgBin = join(scratch, "postgres-17.11-disposable/pgsql/bin");
const migrationNames = readdirSync(join(repo, "supabase/migrations"))
  .filter((name) => name.endsWith("_web_control_centers_b1_publication_drafts.sql"));
assert.deepEqual(migrationNames, [
  "20261102065812_web_control_centers_b1_publication_drafts.sql",
]);
const migration = readFileSync(
  join(repo, "supabase/migrations", migrationNames[0]),
  "utf8",
);
const securityFixture = readFileSync(
  join(repo, "tests/fixtures/web-control-centers-b1-security.sql"),
  "utf8",
);
const releasePolicy = JSON.parse(readFileSync(
  join(repo, ".github/nelyon-production-release-policy.json"),
  "utf8",
));
const releaseTransition = releasePolicy.web_control_centers_b1_transition;
assert.ok(releaseTransition, "missing B1 release transition");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing predecessor ${signature}`);
  const tail = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(tail);
  assert.ok(opening, `missing body for ${signature}`);
  const delimiter = opening[1];
  const bodyStart = opening.index + opening[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  assert.ok(bodyEnd >= bodyStart, `unterminated ${signature}`);
  const semicolon = tail.indexOf(";", bodyEnd + delimiter.length);
  assert.ok(semicolon > bodyEnd, `missing terminator for ${signature}`);
  return tail.slice(0, semicolon + 1);
}

const publisherSource = readFileSync(
  join(repo, "supabase/migrations/20260726106000_serialize_media_asset_linking_and_deletion.sql"),
  "utf8",
);
const lifecycleSource = readFileSync(
  join(repo, "supabase/migrations/20261023141630_creator_premium_media_lifecycle_c1.sql"),
  "utf8",
);
const createCarousel = extractFunction(
  publisherSource,
  "create or replace function public.create_carousel_post(",
);
const createPhoto = extractFunction(
  publisherSource,
  "create or replace function public.create_photo_post_with_media(",
);
const scheduleDeletion = extractFunction(
  lifecycleSource,
  "create or replace function public.schedule_media_asset_deletion(",
);

const listener = createServer();
await new Promise((accept, reject) => {
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", accept);
});
const port = listener.address().port;
await new Promise((accept) => listener.close(accept));

const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (/^PG/i.test(key)) delete environment[key];
}
Object.assign(environment, {
  PGHOST: "127.0.0.1",
  PGHOSTADDR: "127.0.0.1",
  PGCONNECT_TIMEOUT: "3",
  PGSSLMODE: "disable",
});

let cluster;
let started = false;
let databaseCreated = false;
let stopped = false;
let removed = false;
let proofError;

function invoke(tool, args, input, allowFailure = false) {
  const result = spawnSync(join(pgBin, `${tool}.exe`), args, {
    input,
    encoding: "utf8",
    env: environment,
    windowsHide: true,
    timeout: 180_000,
    stdio: tool === "pg_ctl" ? "ignore" : "pipe",
  });
  if (!allowFailure) {
    assert.equal(
      result.status,
      0,
      `${tool}: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  }
  return result;
}

const connection = [
  "-X", "--no-password", "-qAt", "-h", "127.0.0.1", "-p", String(port),
  "-U", "postgres", "-d", "b1proof", "-v", "ON_ERROR_STOP=1",
];
const sql = (source, allowFailure = false) =>
  invoke("psql", connection, source, allowFailure);
const scalar = (source) => sql(source).stdout.trim();
const asUser = (userId, source, allowFailure = false) =>
  sql(`begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','${userId}',true);
${source}
commit;`, allowFailure);
const asUserScalar = (userId, source) =>
  asUser(userId, source).stdout.trim().split(/\r?\n/).filter((line) => line !== userId).at(-1);
const uuidArray = (ids) =>
  `array[${ids.map((id) => `'${id}'::uuid`).join(",")}]`;

function runPsql(source) {
  const child = spawn(join(pgBin, "psql.exe"), connection, {
    encoding: "utf8",
    env: environment,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(source);
  return new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", (status) => accept({ status, stdout, stderr }));
  });
}

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const restrictedOwner = "99999999-9999-4999-8999-999999999999";
const privateAssets = Array.from(
  { length: 5 },
  (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const publicAssets = Array.from(
  { length: 4 },
  (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const setup = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable security invoker
set search_path='' as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.videos(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 video_url text not null,thumbnail_url text,caption text,music text,media_urls text[]
);
create table public.media_assets(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 provider text not null,media_kind text not null,purpose text not null,visibility text not null,
 bucket_name text not null,object_key text not null,mime_type text not null,size_bytes bigint,
 original_filename text,etag text,width integer,height integer,duration_ms bigint,
 status text not null default 'pending',error_code text,cleanup_attempts integer not null default 0,
 last_cleanup_attempt_at timestamptz,next_cleanup_attempt_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 ready_at timestamptz,deleted_at timestamptz,public_url text,
 upload_authorization_expires_at timestamptz,lifecycle_contract_version integer,
 post_delete_verification_attempts integer not null default 0,
 provider_absence_verified_at timestamptz,provider_absence_recheck_after timestamptz,
 unique(bucket_name,object_key)
);
create table public.media_asset_links(
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.media_assets(id) on delete cascade,
 entity_type text not null,entity_id uuid not null,slot text not null,
 position integer not null default 0 check(position>=0),created_at timestamptz not null default now(),
 constraint media_asset_links_entity_type_check check(entity_type in(
  'user_profile','video_post','story','chat_message','shop_product','exclusive_content',
  'marketplace_store','marketplace_dispute','marketplace_return_shipment','creator_premium_content'
 )),
 unique(asset_id,entity_type,entity_id,slot,position)
);
create index media_asset_links_entity_idx on public.media_asset_links(entity_type,entity_id);
alter table public.media_assets enable row level security;
alter table public.media_asset_links enable row level security;
create policy media_assets_owner_read on public.media_assets for select to authenticated
 using(owner_id=(select auth.uid()));
create policy media_assets_public_read on public.media_assets for select to anon,authenticated
 using(visibility='public' and status='ready');
create policy media_asset_links_owner_read on public.media_asset_links for select to authenticated
 using(entity_type not in('story','creator_premium_content') and exists(select 1 from public.media_assets asset
  where asset.id=media_asset_links.asset_id and asset.owner_id=(select auth.uid())));
create policy media_asset_links_public_read on public.media_asset_links for select to anon,authenticated
 using(entity_type not in('story','creator_premium_content') and exists(select 1 from public.media_assets asset
  where asset.id=media_asset_links.asset_id and asset.visibility='public' and asset.status='ready'));
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on public.media_assets,public.media_asset_links,public.videos to anon,authenticated;
grant execute on function auth.uid() to public;
${createCarousel}
${createPhoto}
${scheduleDeletion}
insert into auth.users(id) values('${owner}'),('${otherOwner}'),('${restrictedOwner}');
insert into public.media_assets(
 id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
 status,ready_at,public_url
) values
('${privateAssets[0]}','${owner}','r2','image','post_image','private','private','draft/1','image/jpeg','ready',now(),null),
('${privateAssets[1]}','${owner}','r2','image','post_image','private','private','draft/2','image/jpeg','ready',now(),null),
('${privateAssets[2]}','${owner}','r2','image','post_image','private','private','draft/3','image/jpeg','ready',now(),null),
('${privateAssets[3]}','${owner}','r2','image','post_image','private','private','draft/4','image/jpeg','ready',now(),null),
('${privateAssets[4]}','${otherOwner}','r2','image','post_image','private','private','draft/5','image/jpeg','ready',now(),null),
('${publicAssets[0]}','${owner}','r2','image','post_image','public','public','post/1','image/jpeg','ready',now(),'https://media.example/post/1'),
('${publicAssets[1]}','${owner}','r2','image','post_image','public','public','post/2','image/jpeg','ready',now(),'https://media.example/post/2'),
('${publicAssets[2]}','${owner}','r2','image','post_image','public','public','post/3','image/jpeg','ready',now(),'https://media.example/post/3'),
('${publicAssets[3]}','${owner}','r2','image','post_image','public','public','post/4','image/jpeg','ready',now(),'https://media.example/post/4');
`;

try {
  assert.ok(existsSync(join(pgBin, "postgres.exe")), "PostgreSQL 17 binaries missing");
  cluster = mkdtempSync(join(scratch, "web-control-centers-b1-"));
  assert.equal(dirname(cluster), scratch);
  assert.ok(basename(cluster).startsWith("web-control-centers-b1-"));
  invoke("initdb", [
    "-D", cluster, "-U", "postgres", "-A", "trust", "--no-locale",
    "--encoding=UTF8", "--no-sync",
  ]);
  started = true;
  invoke("pg_ctl", [
    "-D", cluster, "-l", join(cluster, "server.log"),
    "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start",
  ]);
  invoke("createdb", [
    "-h", "127.0.0.1", "-p", String(port), "-U", "postgres",
    "-O", "postgres", "b1proof",
  ]);
  databaseCreated = true;
  sql(setup);
  const preSnapshotState = JSON.parse(scalar(WEB_CONTROL_CENTERS_B1_STATE_SQL));
  assert.equal(preSnapshotState.complete, true);
  assert.equal(preSnapshotState.installed, false);
  assert.deepEqual(preSnapshotState.helpers, []);
  assert.deepEqual(preSnapshotState.rpc_identities, []);
  sql(migration);
  sql(securityFixture);
  const postSnapshotState = JSON.parse(scalar(WEB_CONTROL_CENTERS_B1_STATE_SQL));
  assert.equal(postSnapshotState.complete, true);
  assert.equal(postSnapshotState.installed, true);
  assert.equal(postSnapshotState.helpers.length, 8);
  assert.equal(postSnapshotState.rpc_identities.length, 7);
  assert.equal(postSnapshotState.relations.length, 3);
  const snapshotContractValidated = validateWebControlCentersB1StateTransition(
    preSnapshotState,
    postSnapshotState,
    releaseTransition,
  );
  assert.equal(snapshotContractValidated, true);

  const created = JSON.parse(asUserScalar(owner, `
select public.create_my_publication_draft_v1(
 '50000000-0000-4000-8000-000000000001','photo','draft','Sin musica',
 '{"layout":"center"}'::jsonb,${uuidArray([privateAssets[0]])}
)::text;`));
  assert.equal(created.revision, 1);
  const createReplay = JSON.parse(asUserScalar(owner, `
select public.create_my_publication_draft_v1(
 '50000000-0000-4000-8000-000000000001','photo','draft','Sin musica',
 '{"layout":"center"}'::jsonb,${uuidArray([privateAssets[0]])}
)::text;`));
  assert.equal(createReplay.id, created.id);
  const createConflict = asUser(owner, `
select public.create_my_publication_draft_v1(
 '50000000-0000-4000-8000-000000000001','photo','changed','Sin musica',
 '{}'::jsonb,${uuidArray([privateAssets[0]])}
);`, true);
  assert.notEqual(createConflict.status, 0);
  assert.match(createConflict.stderr, /publication_draft_idempotency_conflict/);
  const unsafe = asUser(owner, `
select public.create_my_publication_draft_v1(
 '50000000-0000-4000-8000-000000000002','photo','unsafe','Sin musica',
 '{"uri":"file:///tmp/source.jpg"}'::jsonb,${uuidArray([privateAssets[1]])}
);`, true);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /draft_composition_unsafe/);

  const updated = JSON.parse(asUserScalar(owner, `
select public.update_my_publication_draft_v1(
 '${created.id}',1,'50000000-0000-4000-8000-000000000003','photo',
 'updated','Sin musica','{"layout":"lower"}'::jsonb,${uuidArray([privateAssets[1]])}
)::text;`));
  assert.equal(updated.revision, 2);
  const updateReplay = JSON.parse(asUserScalar(owner, `
select public.update_my_publication_draft_v1(
 '${created.id}',1,'50000000-0000-4000-8000-000000000003','photo',
 'updated','Sin musica','{"layout":"lower"}'::jsonb,${uuidArray([privateAssets[1]])}
)::text;`));
  assert.equal(updateReplay.revision, 2);
  assert.equal(scalar(`select status from public.media_assets where id='${privateAssets[0]}';`), "delete_pending");
  const retainedUpdate = JSON.parse(asUserScalar(owner, `
select public.update_my_publication_draft_v1(
 '${created.id}',2,'50000000-0000-4000-8000-000000000005','photo',
 'retained','Sin musica','{"layout":"upper"}'::jsonb,${uuidArray([privateAssets[1]])}
)::text;`));
  assert.equal(retainedUpdate.revision, 3);
  assert.equal(scalar(`select status from public.media_assets where id='${privateAssets[1]}';`), "ready");
  const privilegedLinkRewrite = sql(`
update public.media_asset_links set entity_type='video_post'
where entity_type='publication_draft' and entity_id='${created.id}';`, true);
  assert.notEqual(privilegedLinkRewrite.status, 0);
  assert.match(privilegedLinkRewrite.stderr, /publication_draft_media_link_immutable/);
  const createReplayAfterUpdate = JSON.parse(asUserScalar(owner, `
select public.create_my_publication_draft_v1(
 '50000000-0000-4000-8000-000000000001','photo','draft','Sin musica',
 '{"layout":"center"}'::jsonb,${uuidArray([privateAssets[0]])}
)::text;`));
  assert.equal(createReplayAfterUpdate.revision, 1);
  const stale = asUser(owner, `
select public.update_my_publication_draft_v1(
 '${created.id}',1,'50000000-0000-4000-8000-000000000004','photo',
 'stale','Sin musica','{}'::jsonb,${uuidArray([privateAssets[1]])}
);`, true);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /publication_draft_revision_conflict/);
  const crossOwner = asUser(otherOwner,
    `select public.get_my_publication_draft_v1('${created.id}');`, true);
  assert.notEqual(crossOwner.status, 0);
  assert.match(crossOwner.stderr, /publication_draft_not_found/);
  assert.equal(asUserScalar(owner,
    "select count(*) from public.media_asset_links where entity_type='publication_draft';"), "0");
  assert.notEqual(asUser(owner,
    "select count(*) from private.publication_drafts;", true).status, 0);

  const directCommand = "60000000-0000-4000-8000-000000000001";
  const directPost = asUserScalar(owner, `
select public.publish_my_media_post_v1(
 '${directCommand}','photo','direct','Sin musica',${uuidArray([publicAssets[0]])}
);`);
  assert.equal(asUserScalar(owner, `
select public.publish_my_media_post_v1(
 '${directCommand}','photo','direct','Sin musica',${uuidArray([publicAssets[0]])}
);`), directPost);
  const mismatch = asUser(owner, `
select public.publish_my_media_post_v1(
 '${directCommand}','photo','different','Sin musica',${uuidArray([publicAssets[0]])}
);`, true);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /publication_receipt_conflict/);

  const concurrentCommand = "60000000-0000-4000-8000-000000000002";
  const concurrentSql = `begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','${owner}',true);
select public.publish_my_media_post_v1(
 '${concurrentCommand}','photo','concurrent','Sin musica',${uuidArray([publicAssets[1]])}
);
commit;`;
  const concurrent = await Promise.all([runPsql(concurrentSql), runPsql(concurrentSql)]);
  for (const result of concurrent) assert.equal(result.status, 0, result.stderr);
  const concurrentPosts = concurrent.map((result) =>
    result.stdout.trim().split(/\r?\n/).filter((line) => line !== owner).at(-1));
  assert.equal(concurrentPosts[0], concurrentPosts[1]);
  assert.equal(scalar(`
select count(*) from private.publication_receipts
where owner_id='${owner}' and client_command_id='${concurrentCommand}';`), "1");

  sql(`
create function private.fail_b1_receipt_for_proof() returns trigger
language plpgsql security invoker set search_path=''
as $$begin raise exception 'proof_receipt_failure';end$$;
create trigger proof_fail_receipt before insert on private.publication_receipts
for each row execute function private.fail_b1_receipt_for_proof();`);
  const postCount = Number(scalar("select count(*) from public.videos;"));
  const rollback = asUser(owner, `
select public.publish_my_media_post_v1(
 '60000000-0000-4000-8000-000000000003','photo','rollback','Sin musica',
 ${uuidArray([publicAssets[2]])}
);`, true);
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stderr, /proof_receipt_failure/);
  assert.equal(Number(scalar("select count(*) from public.videos;")), postCount);
  sql(`drop trigger proof_fail_receipt on private.publication_receipts;
drop function private.fail_b1_receipt_for_proof();`);

  const publishDraft = JSON.parse(asUserScalar(owner, `
select public.create_my_publication_draft_v1(
 '70000000-0000-4000-8000-000000000001','photo','from draft','Sin musica',
 '{}'::jsonb,${uuidArray([privateAssets[2]])}
)::text;`));
  const draftPost = asUserScalar(owner, `
select public.publish_my_publication_draft_v1(
 '${publishDraft.id}',1,'70000000-0000-4000-8000-000000000002',
 ${uuidArray([publicAssets[2]])}
);`);
  assert.equal(scalar(`
select state||':'||revision from private.publication_drafts
where id='${publishDraft.id}';`), "published:2");
  assert.equal(scalar(`
select count(*) from public.media_asset_links
where entity_type='publication_draft' and entity_id='${publishDraft.id}';`), "0");
  assert.equal(scalar(`select status from public.media_assets where id='${privateAssets[2]}';`), "delete_pending");
  assert.equal(asUserScalar(owner, `
select public.publish_my_publication_draft_v1(
 '${publishDraft.id}',1,'70000000-0000-4000-8000-000000000002',
 ${uuidArray([publicAssets[2]])}
);`), draftPost);

  const deleteDraft = JSON.parse(asUserScalar(owner, `
select public.create_my_publication_draft_v1(
 '80000000-0000-4000-8000-000000000001','photo','delete','Sin musica',
 '{}'::jsonb,${uuidArray([privateAssets[3]])}
)::text;`));
  assert.equal(scalar(`
select public.schedule_media_asset_deletion('${privateAssets[3]}','${owner}');`), "asset_in_use");
  const deleted = JSON.parse(asUserScalar(owner, `
select public.delete_my_publication_draft_v1(
 '${deleteDraft.id}',1,'80000000-0000-4000-8000-000000000002'
)::text;`));
  assert.equal(deleted.state, "deleted");
  const deleteReplay = JSON.parse(asUserScalar(owner, `
select public.delete_my_publication_draft_v1(
 '${deleteDraft.id}',1,'80000000-0000-4000-8000-000000000002'
)::text;`));
  assert.equal(deleteReplay.revision, 2);
  assert.equal(scalar(`select status from public.media_assets where id='${privateAssets[3]}';`), "delete_pending");
  const crossAsset = asUser(owner, `
select public.create_my_publication_draft_v1(
 '80000000-0000-4000-8000-000000000003','photo','cross','Sin musica','{}'::jsonb,
 ${uuidArray([privateAssets[4]])}
);`, true);
  assert.notEqual(crossAsset.status, 0);
  assert.match(crossAsset.stderr, /publication_asset_not_ready_or_owned/);

  const legacyPost = asUserScalar(owner, `
select public.create_photo_post_with_media(
 'legacy','Sin musica','${publicAssets[3]}'
);`);
  assert.match(legacyPost, /^[0-9a-f-]{36}$/);

  sql(`delete from public.videos where id='${directPost}';
delete from public.media_asset_links
where entity_type='video_post' and entity_id='${directPost}';`);
  sql(`update public.media_assets set status='delete_pending'
where id='${publicAssets[0]}';`);
  const missingTarget = asUser(owner, `
select public.publish_my_media_post_v1(
 '${directCommand}','photo','direct','Sin musica',${uuidArray([publicAssets[0]])}
);`, true);
  assert.notEqual(missingTarget.status, 0);
  assert.match(missingTarget.stderr, /publication_receipt_target_missing/);

  assert.equal(scalar(`
select pg_catalog.string_agg(c.confdeltype::text,',' order by c.conname)
from pg_catalog.pg_constraint c
where c.conrelid in(
 'private.publication_drafts'::regclass,
 'private.publication_draft_commands'::regclass,
 'private.publication_receipts'::regclass
) and c.contype='f' and c.confrelid='auth.users'::regclass;`), "r,r,r");
  sql(`
insert into private.publication_drafts(
 owner_id,client_request_id,kind,caption,music,composition,request_fingerprint
) values(
 '${restrictedOwner}','90000000-0000-4000-8000-000000000001','photo','','Sin musica',
 '{}'::jsonb,repeat('0',64)
);`);
  const ownerDelete = sql(`delete from auth.users where id='${restrictedOwner}';`, true);
  assert.notEqual(ownerDelete.status, 0);
  assert.match(ownerDelete.stderr, /publication_drafts_owner_id_fkey/);
  const counts = JSON.parse(scalar(`
select pg_catalog.json_build_object(
 'drafts',(select count(*) from private.publication_drafts),
 'receipts',(select count(*) from private.publication_receipts),
 'commands',(select count(*) from private.publication_draft_commands),
 'posts',(select count(*) from public.videos),
 'draft_links',(select count(*) from public.media_asset_links where entity_type='publication_draft')
)::text;`));
  console.log(JSON.stringify({
    verdict: "WEB_CONTROL_CENTERS_B1_DISPOSABLE_PASS",
    postgres: scalar("show server_version;"),
    assertions: 26,
    snapshotPreState: snapshotContractValidated,
    snapshotPostState: snapshotContractValidated,
    createReplay: true,
    createReplayAfterMutation: true,
    mutationReplay: true,
    casConflict: true,
    crossOwnerDenied: true,
    compositionRejected: true,
    directReplay: true,
    concurrentPublishSerialized: true,
    rollbackAtomic: true,
    draftPublishAtomic: true,
    reservationCleanup: true,
    retainedReservationNotScheduled: true,
    draftLinkTransitionBlocked: true,
    deleteReplay: true,
    receiptTargetValidatedBeforeFreshAssetValidation: true,
    legacyPublisherCompatible: true,
    aclRlsFixture: true,
    ownerDeletionExplicitlyRestricted: true,
    financeMutations: 0,
    ...counts,
  }, null, 2));
} catch (error) {
  proofError = error;
} finally {
  const cleanupErrors = [];
  if (started) {
    if (databaseCreated) {
      try {
        invoke("dropdb", [
          "-h", "127.0.0.1", "-p", String(port), "-U", "postgres",
          "--if-exists", "--force", "b1proof",
        ], undefined, true);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      invoke("pg_ctl", [
        "-D", cluster, "-w", "-t", "30", "-m", "fast", "stop",
      ], undefined, true);
      stopped = invoke("pg_ctl", ["-D", cluster, "status"], undefined, true).status === 3;
      assert.ok(stopped, "disposable server did not stop");
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cluster && (stopped || !started)) {
    try {
      assert.equal(dirname(resolve(cluster)), scratch);
      assert.ok(basename(cluster).startsWith("web-control-centers-b1-"));
      rmSync(cluster, { recursive: true });
      removed = !existsSync(cluster);
      assert.ok(removed, "disposable cluster was not removed");
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  console.log(`CLEANUP ${JSON.stringify({
    cluster, port, serverStopped: stopped, directoryRemoved: removed,
  })}`);
  if (proofError || cleanupErrors.length) {
    throw new AggregateError(
      [...(proofError ? [proofError] : []), ...cleanupErrors],
      "B1 disposable proof or cleanup failed",
    );
  }
}
