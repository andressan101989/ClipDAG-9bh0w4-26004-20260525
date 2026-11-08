// Focused Task 1B real PostgreSQL protocol proof. Task 1C owns simultaneous races.
// Only loopback PostgreSQL is accepted. Reuse B1's controlled baseline and real
// predecessor definitions without executing its proof or changing its files.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const scratch = 'D:/CodexTemp/web-control-centers-b2/task1b';
const pgBin = 'D:/CodexTemp/postgres-17.11-disposable/pgsql/bin';
mkdirSync(scratch, { recursive: true });
const environment = { ...process.env, TEMP: scratch, TMP: scratch, npm_config_cache: join(scratch, 'npm-cache') };
for (const key of Object.keys(environment)) if (/^PG/i.test(key)) delete environment[key];
Object.assign(environment, { PGHOST: '127.0.0.1', PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '3', PGSSLMODE: 'disable' });
const read = name => readFileSync(join(repo, name), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const restrictedOwner = '99999999-9999-4999-8999-999999999999';
const privateAssets = Array.from({ length: 5 }, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const publicAssets = Array.from({ length: 4 }, (_, i) => `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const tail = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(tail);
  assert.ok(opening);
  const end = tail.indexOf(opening[1], opening.index + opening[0].length);
  assert.ok(end >= 0);
  return tail.slice(0, tail.indexOf(';', end + opening[1].length) + 1);
}
const publishers = read('supabase/migrations/20260726106000_serialize_media_asset_linking_and_deletion.sql');
const replacements = {
  owner, otherOwner, restrictedOwner,
  createCarousel: extractFunction(publishers, 'create or replace function public.create_carousel_post('),
  createPhoto: extractFunction(publishers, 'create or replace function public.create_photo_post_with_media('),
  scheduleDeletion: extractFunction(read('supabase/migrations/20261023141630_creator_premium_media_lifecycle_c1.sql'), 'create or replace function public.schedule_media_asset_deletion('),
};
privateAssets.forEach((id, i) => { replacements[`privateAssets[${i}]`] = id; });
publicAssets.forEach((id, i) => { replacements[`publicAssets[${i}]`] = id; });
const baseline = /const setup = `([\s\S]*?)`;/.exec(read('scripts/prove-web-control-centers-b1-disposable.mjs'));
assert.ok(baseline, 'B1 controlled baseline must remain available');
const setup = baseline[1].replace(/\$\{([^}]+)\}/g, (_, name) => {
  assert.ok(Object.hasOwn(replacements, name), `unrecognized baseline variable ${name}`);
  return replacements[name];
});
const listener = createServer();
await new Promise((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
const port = listener.address().port;
await new Promise(accept => listener.close(accept));
const cluster = mkdtempSync(join(scratch, 'worker-proof-'));
let started = false;
let stopped = false;
let failure;
let checks = 0;
function invoke(tool, args, input, allowFailure = false) {
  const result = spawnSync(join(pgBin, `${tool}.exe`), args, {
    input, encoding: 'utf8', windowsHide: true, env: environment, timeout: 30_000,
    stdio: tool === 'pg_ctl' ? 'ignore' : 'pipe',
  });
  if (!allowFailure) assert.equal(result.status, 0, `${tool}: ${result.error?.message ?? ''}\n${result.stderr ?? ''}`);
  return result;
}
const connection = ['-X', '--no-password', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'b2worker', '-v', 'ON_ERROR_STOP=1'];
const sql = (source, allowFailure = false) => invoke('psql', connection, source, allowFailure);
const scalar = source => sql(source).stdout.trim();
const asUser = (source, actor = owner, allowFailure = false, zone = 'UTC') => sql(`begin; set local role authenticated; set local timezone='${zone}'; select pg_catalog.set_config('request.jwt.claim.sub','${actor}',true); ${source}; commit;`, allowFailure);
const userScalar = (source, actor = owner, zone = 'UTC') => asUser(source, actor, false, zone).stdout.trim().split(/\r?\n/).filter(line => line !== actor).at(-1);
const eq = (got, want, message) => { assert.deepEqual(got, want, message); checks++; };
const denied = (source, message, actor = owner) => {
  const result = asUser(source, actor, true);
  assert.notEqual(result.status, 0, `expected rejection: ${source}`);
  assert.match(result.stderr, new RegExp(message)); checks++;
};
let serial = 0;
const command = () => `71000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
const due = "(pg_catalog.clock_timestamp() at time zone 'UTC' + interval '1 day')::timestamp";
const schedule = (draft, cmd = command(), local = due, zone = 'UTC', offset = 'null', revision = 1) =>
  `select public.schedule_my_publication_draft_v1('${draft}',${revision},'${cmd}',${local},'${zone}',${offset})`;
const createDraft = (asset = privateAssets[0], kind = 'photo', actor = owner) => JSON.parse(userScalar(
  `select public.create_my_publication_draft_v1('${command()}','${kind}','schedule test','Sin musica','{}',array[${(Array.isArray(asset) ? asset : [asset]).map(id => `'${id}'::uuid`).join(',')}])`, actor));
try {
  invoke('initdb', ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
  started = true;
  // Disposable behavior proof only: fsync is disabled to avoid host-wide disk
  // stalls on cleanup. This does not claim power-loss durability verification.
  invoke('pg_ctl', ['-D', cluster, '-l', join(cluster, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, '-w', '-t', '30', 'start']);
  invoke('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'b2worker']);
  sql(setup);
  sql(read('supabase/migrations/20261102065812_web_control_centers_b1_publication_drafts.sql'));
  sql(read('supabase/migrations/20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery.sql'));
  sql("update public.media_assets set size_bytes=123,etag=repeat('a',32) where visibility='private'");
  const c1=read('supabase/migrations/20261023141630_creator_premium_media_lifecycle_c1.sql');
  sql(extractFunction(c1,'create or replace function private.guard_ready_media_asset_identity()'));
  sql(extractFunction(c1,'create or replace function private.guard_media_asset_link_lifecycle_v1()'));
  sql('create trigger proof_identity before update on public.media_assets for each row execute function private.guard_ready_media_asset_identity(); create trigger media_asset_links_guard_lifecycle_c1 before insert or update on public.media_asset_links for each row execute function private.guard_media_asset_link_lifecycle_v1()');
  sql(read('supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql'));
  const service = (source, allowFailure=false) => sql(`begin; set local role service_role; ${source}; commit;`, allowFailure);
  const serviceJson = source => JSON.parse(service(source).stdout.trim());
  const claim = () => serviceJson("select coalesce(jsonb_agg(x),'[]'::jsonb) from public.claim_publication_schedules_v1(10) x");
  const fence = c => `'${c.schedule_id}',${c.generation},'${c.claim_token}'`;
  const prepare = c => serviceJson(`select public.prepare_publication_schedule_v1(${fence(c)})`);
  const sourceSha256=createHash('sha256').update(Buffer.alloc(123,0x61)).digest('hex');
  const otherSha256=createHash('sha256').update(Buffer.alloc(123,0x62)).digest('hex');
  const confirm = (c,p=0,size=123,etag='a'.repeat(32)) => serviceJson(`select public.confirm_publication_schedule_item_v1(${fence(c)},${p},${size},'${etag}','${sourceSha256}','${sourceSha256}')`);
  const publish = c => serviceJson(`select public.publish_publication_schedule_v1(${fence(c)})`);
  const rejectService = (source,error) => { const r=service(source,true); assert.notEqual(r.status,0); assert.match(r.stderr,new RegExp(error)); checks++; };
  const makeDue = id => sql(`update private.publication_schedules set scheduled_for=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where id='${id}'`);
  const newSchedule = () => JSON.parse(userScalar(schedule(createDraft().id)));
  const scheduled = newSchedule();
  eq(claim(), [], 'future schedules cannot be claimed');
  eq(scalar('select count(*) from public.media_assets'), '9', 'no early targets');
  sql("update private.publication_schedule_policy set public_bucket='public', public_base_url='https://media.example',object_environment='development'");
  makeDue(scheduled.id);
  const [c] = claim(); eq(c.schedule_id, scheduled.id); eq(c.attempt_count,1); eq(claim(),[], 'sequential claimer does not duplicate');
  const items=prepare(c); eq(items.items.length,1); eq(prepare(c),items,'deterministic prepare replay');
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${c.schedule_id}' and event='prepared'`),'1','prepare audit appended exactly once despite response replay');
  sql("update private.publication_schedule_policy set public_base_url='https://changed.example'");
  eq(prepare(c),items,'policy changes cannot redirect already-reserved targets');
  sql("update private.publication_schedule_policy set public_base_url='https://media.example'");
  eq(items.items[0].source_bucket,'private'); eq(items.items[0].target_bucket,'public');
  assert.match(items.items[0].target_key,/^development\/post_image\//); checks++;
  rejectService(`select public.publish_publication_schedule_v1(${fence(c)})`,'publication_schedule_not_finalized');
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(c)},0,123,'${'b'.repeat(32)}','${sourceSha256}','${otherSha256}')`,'publication_schedule_content_mismatch');
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(c)},0,123,'${'a'.repeat(32)}',null,'${sourceSha256}')`,'publication_schedule_content_mismatch');
  eq(scalar(`select status from public.media_assets where id='${items.items[0].target_asset_id}'`),'pending','rejected content proof never makes target READY');
  eq(scalar("select to_regprocedure('public.confirm_publication_schedule_item_v1(uuid,bigint,uuid,integer,bigint,text)') is null"),'t','no legacy confirmation overload can bypass content proof');
  const finalized=confirm(c); eq(finalized.finalized,true); eq(confirm(c),finalized,'exact confirmation replay');
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(c)},0,124,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,'publication_schedule_provider_mismatch');
  eq(scalar(`select source_sha256||':'||target_sha256 from private.publication_schedule_materializations where schedule_id='${c.schedule_id}' and position=0`),sourceSha256+':'+sourceSha256,'content provenance persisted against reserved mapping');
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(c)},0,123,'${'a'.repeat(32)}','${otherSha256}','${otherSha256}')`,'publication_schedule_content_mismatch');
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(c)},0,123,'${'a'.repeat(32)}','not-a-checksum','not-a-checksum')`,'publication_schedule_content_mismatch');
  const published=publish(c); eq(published.state,'published'); eq(publish(c),published,'lost publish response replay');
  eq(scalar(`select count(*) from private.publication_receipts where post_id='${published.post_id}'`),'1');
  eq(scalar(`select count(*) from public.media_asset_links where entity_type='video_post' and entity_id='${published.post_id}'`),'1');
  eq(scalar(`select state from private.publication_drafts where id='${scheduled.draft_id}'`),'published');
  // Create a fresh private source for each scenario; never resurrect lifecycle rows.
  let sourceSerial=100;
  const freshSchedule=(sourceEtag='a'.repeat(32))=>{
    const id=`30000000-0000-4000-8000-${String(++sourceSerial).padStart(12,'0')}`;
    sql(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,etag,status,ready_at) values('${id}','${owner}','r2','image','post_image','private','private','draft/${id}','image/jpeg',123,'${sourceEtag}','ready',now())`);
    return JSON.parse(userScalar(schedule(createDraft(id).id)));
  };
  const multipart=freshSchedule('a'.repeat(32)+'-2'); makeDue(multipart.id); const [mp]=claim(); const mpi=prepare(mp);
  eq(mpi.items[0].source_etag,'a'.repeat(32)+'-2');
  eq(confirm(mp,0,123,'b'.repeat(32)).finalized,true,'multipart ETag difference accepted only with equal full-content SHA-256');
  userScalar(`select public.cancel_my_publication_schedule_v1('${multipart.id}',${mp.revision},'${command()}')`);
  const stale=freshSchedule(); makeDue(stale.id); const [old]=claim(); const oldItems=prepare(old);
  userScalar(`select public.cancel_my_publication_schedule_v1('${stale.id}',${old.revision},'${command()}')`);
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(old)},0,123,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,'publication_schedule_fence_invalid');
  rejectService(`select public.publish_publication_schedule_v1(${fence(old)})`,'publication_schedule_fence_invalid');
  const reconcile=()=>serviceJson('select public.reconcile_publication_schedules_v1(10)');
  reconcile();
  eq(scalar(`select count(*) from public.media_asset_links where asset_id='${oldItems.items[0].target_asset_id}'`),'1','guard retains stale reservation');
  sql(`update private.publication_schedule_materializations set provider_write_until=now()-interval '1 second' where schedule_id='${stale.id}'; update public.media_assets set upload_authorization_expires_at=now()-interval '1 second' where id='${oldItems.items[0].target_asset_id}'`);
  reconcile();
  eq(scalar(`select status from public.media_assets where id='${oldItems.items[0].target_asset_id}'`),'delete_pending');
  eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id='${stale.draft_id}'`),'1','stale cleanup preserves private source');
  const expired=freshSchedule(); makeDue(expired.id); const [e1]=claim(); const eItems=prepare(e1);
  sql(`update private.publication_schedules set claim_expires_at=now()-interval '1 second' where id='${expired.id}'`);
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(e1)},0,123,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,'publication_schedule_fence_invalid');
  reconcile(); eq(scalar(`select last_error_code from private.publication_schedules where id='${expired.id}'`),'lease_expired');
  eq(claim(),[],'backoff enforced'); makeDue(expired.id); const [e2]=claim(); assert.notEqual(e2.claim_token,e1.claim_token); checks++;
  eq(prepare(e2).items.map(x=>x.target_asset_id),eItems.items.map(x=>x.target_asset_id),'reclaim reuses deterministic targets');
  rejectService(`select public.publish_publication_schedule_v1(${fence(e1)})`,'publication_schedule_fence_invalid');
  const fail = (c,code,retry=true) => serviceJson(`select public.fail_publication_schedule_v1(${fence(c)},'${code}',${retry})`);
  rejectService(`select public.fail_publication_schedule_v1(${fence(e2)},'raw provider secret',true)`,'publication_schedule_error_invalid');
  const failed=fail(e2,'source_missing',true); eq([failed.state,failed.retryable],['terminal_failed',false],'terminal codes cannot be made retryable');
  const changed=freshSchedule(); makeDue(changed.id); const [cc]=claim(); const ci=prepare(cc);
  sql(`update public.media_assets set object_key='tampered' where id='${ci.items[0].target_asset_id}'`);
  rejectService(`select public.confirm_publication_schedule_item_v1(${fence(cc)},0,123,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,'publication_schedule_identity_conflict');
  eq(fail(cc,'provider_timeout',true).retryable,false,'target identity failure cannot be relabeled transient');
  const transient=freshSchedule(); makeDue(transient.id);
  for(let attempt=1;attempt<=5;attempt++){
    const [t]=claim(); eq(t.attempt_count,attempt); const f=fail(t,'provider_timeout');
    eq(f.retryable,attempt<5); eq(f.state,attempt<5?'retryable_failed':'terminal_failed');
    eq(scalar(`select extract(epoch from next_attempt_at-updated_at)::integer from private.publication_schedules where id='${t.schedule_id}'`),String(30*2**(attempt-1)));
    makeDue(transient.id);
  }
  eq(claim(),[],'attempt budget cannot be exceeded');
  const manual=freshSchedule(); makeDue(manual.id); const [mc]=claim(); const mi=prepare(mc);
  const commandId=command(); const manualCall=`select public.publish_my_publication_draft_v1('${manual.draft_id}',1,'${commandId}',array['${publicAssets[0]}'::uuid])`;
  const manualPost=userScalar(manualCall); eq(userScalar(manualCall),manualPost,'manual receipt replay');
  eq(scalar(`select state from private.publication_schedules where id='${manual.id}'`),'cancelled','manual commit invalidates worker');
  rejectService(`select public.publish_publication_schedule_v1(${fence(mc)})`,'publication_schedule_fence_invalid');
  eq(scalar(`select count(*) from public.media_asset_links where asset_id='${mi.items[0].target_asset_id}'`),'1','manual cancellation also respects guard');
  const acl=scalar(`select bool_and(p.prosecdef and p.proconfig=array['search_path=""'] and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) from pg_proc p where p.proname in ('claim_publication_schedules_v1','prepare_publication_schedule_v1','confirm_publication_schedule_item_v1','publish_publication_schedule_v1','fail_publication_schedule_v1','reconcile_publication_schedules_v1')`);
  eq(acl,'t');
  denied('select * from public.claim_publication_schedules_v1(10)','permission denied');
  const nonservice=sql('select * from public.claim_publication_schedules_v1(10)',true); assert.match(nonservice.stderr,/publication_service_required/); checks++;
  eq(scalar("select bool_and(not has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%_actor_v1'"),'t','explicit actor cores private');
  eq(scalar('select count(*) from public.videos'),'2','one scheduled and one manual canonical post');
  // Public B1 wrappers retain actual insertion behavior, including column defaults.
  sql("alter table public.videos alter column media_urls set default '{}'::text[]");
  const photoDefault=asUser(`select public.create_photo_post_with_media('direct','', '${publicAssets[1]}')`).stdout.trim().split(/\r?\n/).at(-1);
  eq(scalar(`select media_urls::text||':'||music from public.videos where id='${photoDefault}'`),'{}:Sin musica','photo wrapper preserves omitted-column default');
  const oddBoundsDraft=createDraft(privateAssets[1]);
  for(const lower of [2,0,-1]){
    denied(`select public.publish_my_publication_draft_v1('${oddBoundsDraft.id}',1,'${command()}','[${lower}:${lower}]={${publicAssets[1]}}'::uuid[])`,'asset_not_ready_or_owned');
  }
  eq(scalar(`select state from private.publication_drafts where id='${oddBoundsDraft.id}'`),'draft','non-1-based photo array rejection preserves draft');
  eq(scalar(`select count(*) from private.publication_receipts where draft_id='${oddBoundsDraft.id}'`),'0','non-1-based photo array cannot leave receipt');
  const ordinaryPhotoCommand=command();
  const ordinaryPhoto=`select public.publish_my_publication_draft_v1('${oddBoundsDraft.id}',1,'${ordinaryPhotoCommand}',array['${publicAssets[1]}'::uuid])`;
  const ordinaryPhotoPost=userScalar(ordinaryPhoto); eq(userScalar(ordinaryPhoto),ordinaryPhotoPost,'normal photo receipt still replays');
  eq(scalar(`select position from public.media_asset_links where entity_type='video_post' and entity_id='${ordinaryPhotoPost}'`),'0','photo canonical link remains zero-based');
  const carouselIds=[];
  for(let i=0;i<2;i++){
    const id=`30000000-0000-4000-8000-${String(++sourceSerial).padStart(12,'0')}`; carouselIds.push(id);
    sql(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,etag,status,ready_at) values('${id}','${owner}','r2','image','carousel_image','private','private','draft/${id}','image/png',123,repeat('a',32),'ready',now())`);
  }
  const carousel=JSON.parse(userScalar(schedule(createDraft(carouselIds,'carousel').id))); makeDue(carousel.id);
  let [car]=claim(); const carItems=prepare(car); eq(carItems.items.map(x=>x.position),[0,1]);
  confirm(car,1); rejectService(`select public.publish_publication_schedule_v1(${fence(car)})`,'publication_schedule_not_finalized');
  // Owner retry must continue the same frozen carousel, not allocate a second
  // public target set after a provider failure with one position already READY.
  const firstCarClaim=car;
  const partialItems=prepare(car).items;
  eq(partialItems.map(x=>x.finalized),[false,true]);
  const materializationFacts=()=>JSON.parse(scalar(`select jsonb_agg(to_jsonb(m)-'provider_write_until' order by position) from private.publication_schedule_materializations m where schedule_id='${carousel.id}'`));
  const scheduleLinks=()=>JSON.parse(scalar(`select jsonb_agg(to_jsonb(l) order by position) from public.media_asset_links l where entity_type='publication_schedule' and entity_id='${carousel.id}'`));
  const mediaCounts=()=>scalar(`select (select count(*) from public.media_assets)||':'||(select count(*) from public.media_asset_links)||':'||(select count(*) from private.publication_schedule_materializations)`);
  const guardDeadlines=()=>JSON.parse(scalar(`select jsonb_agg(jsonb_build_object('provider',m.provider_write_until,'upload',a.upload_authorization_expires_at) order by m.position) from private.publication_schedule_materializations m join public.media_assets a on a.id=m.target_asset_id where m.schedule_id='${carousel.id}'`));
  const frozenFacts=materializationFacts(),reservedLinks=scheduleLinks(),reservedCounts=mediaCounts(),firstGuards=guardDeadlines();
  const publishCommand=scalar(`select publish_command_id from private.publication_schedules where id='${carousel.id}'`);
  eq(fail(car,'provider_timeout').state,'retryable_failed');
  const failedRevision=Number(scalar(`select revision from private.publication_schedules where id='${carousel.id}'`));
  const ownerRetryCall=`select public.retry_my_publication_schedule_v1('${carousel.id}',${failedRevision},'${command()}')`;
  const ownerRetry=JSON.parse(userScalar(ownerRetryCall));
  eq([ownerRetry.state,ownerRetry.revision,ownerRetry.attempt_count,ownerRetry.retryable,ownerRetry.last_error_code],['scheduled',failedRevision+1,1,false,null]);
  eq(scalar(`select claim_token is null and claim_expires_at is null from private.publication_schedules where id='${carousel.id}'`),'t','owner retry leaves no usable claim');
  const rejectOldCarouselClaim=()=>{
    for(const call of [
      `select public.prepare_publication_schedule_v1(${fence(firstCarClaim)})`,
      `select public.confirm_publication_schedule_item_v1(${fence(firstCarClaim)},0,123,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,
      `select public.fail_publication_schedule_v1(${fence(firstCarClaim)},'provider_timeout',true)`,
      `select public.publish_publication_schedule_v1(${fence(firstCarClaim)})`,
    ]) rejectService(call,'publication_schedule_fence_invalid');
  };
  rejectOldCarouselClaim();
  const retryClaims=claim(); eq(retryClaims.length,1); [car]=retryClaims;
  eq(car.schedule_id,carousel.id);
  assert.notEqual(car.claim_token,firstCarClaim.claim_token,'owner retry requires a fresh claim token'); checks++;
  eq(car.attempt_count,2,'owner retry preserves consumed attempt budget');
  const resumedItems=prepare(car).items;
  eq(resumedItems.map(x=>[x.target_asset_id,x.target_bucket,x.target_key]),partialItems.map(x=>[x.target_asset_id,x.target_bucket,x.target_key]),'owner retry must reuse the same public targets');
  eq([ownerRetry.generation,car.generation],[firstCarClaim.generation,firstCarClaim.generation],'owner retry retains the materialization generation');
  eq(resumedItems,partialItems,'source locators and finalized positions survive owner retry');
  eq(materializationFacts(),frozenFacts,'mapping identities, fingerprints, finalization time and content facts are unchanged');
  eq(scheduleLinks(),reservedLinks,'existing reservations are retained without replacement');
  eq(mediaCounts(),reservedCounts,'owner retry cannot add assets, materializations or links');
  guardDeadlines().forEach((guard,i)=>{
    assert.ok(Date.parse(guard.provider)>=Date.parse(firstGuards[i].provider),'provider guard cannot shorten'); checks++;
    assert.ok(Date.parse(guard.upload)>=Date.parse(firstGuards[i].upload),'upload guard cannot shorten'); checks++;
  });
  eq(scalar(`select publish_command_id from private.publication_schedules where id='${carousel.id}'`),publishCommand,'publication command identity is stable');
  eq(JSON.parse(userScalar(ownerRetryCall)),ownerRetry,'owner retry receipt replays after the fresh claim');
  rejectOldCarouselClaim();
  eq(resumedItems.filter(x=>!x.finalized).map(x=>x.position),[0],'only unfinished carousel position needs copying');
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${carousel.id}' and event='claimed'`),'2','both attempts remain accounted');
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${carousel.id}' and event='item_finalized'`),'1','completed position is not finalized twice');
  confirm(car,0); const carPost=publish(car); eq(publish(car),carPost);
  eq(JSON.parse(scalar(`select to_json(array_agg(asset_id order by position)) from public.media_asset_links where entity_type='video_post' and entity_id='${carPost.post_id}'`)),carItems.items.map(x=>x.target_asset_id),'canonical carousel order');
  eq(scalar(`select cardinality(media_urls) from public.videos where id='${carPost.post_id}'`),'2');
  const directCar=userScalar(`select public.create_carousel_post('direct carousel','',array[${carItems.items.map(x=>`'${x.target_asset_id}'::uuid`).join(',')}])`);
  eq(scalar(`select cardinality(media_urls) from public.videos where id='${directCar}'`),'2','direct carousel remains operational');
  denied(`select public.create_carousel_post('','',array['${carItems.items[0].target_asset_id}'::uuid,'${carItems.items[0].target_asset_id}'::uuid])`,'duplicate_asset');
  denied(`select public.create_photo_post_with_media('','','${publicAssets[0]}')`,'not_authenticated','');
  // A normal BEFORE INSERT safety rejection still aborts canonical scheduled publication.
  sql("create function private.proof_block_post() returns trigger language plpgsql as $proof$ begin raise exception 'content_safety_fixture_block'; end; $proof$; create trigger proof_safety before insert on public.videos for each row execute function private.proof_block_post()");
  const blocked=freshSchedule(); makeDue(blocked.id); const [bc]=claim(); prepare(bc); confirm(bc);
  rejectService(`select public.publish_publication_schedule_v1(${fence(bc)})`,'content_safety_fixture_block');
  eq(scalar(`select count(*) from private.publication_receipts where draft_id='${blocked.draft_id}'`),'0','safety failure rolls back receipt');
  eq(scalar(`select state from private.publication_drafts where id='${blocked.draft_id}'`),'draft','safety failure rolls back draft');
  sql('drop trigger proof_safety on public.videos; drop function private.proof_block_post()');
  fail(bc,'content_blocked',true);
  // Every worker endpoint rejects even privileged non-service execution, not just ACL access.
  for(const call of [
    'select * from public.claim_publication_schedules_v1(1)',
    `select public.prepare_publication_schedule_v1(${fence(bc)})`,
    `select public.confirm_publication_schedule_item_v1(${fence(bc)},0,123,'${'a'.repeat(32)}','${sourceSha256}','${sourceSha256}')`,
    `select public.publish_publication_schedule_v1(${fence(bc)})`,
    `select public.fail_publication_schedule_v1(${fence(bc)},'provider_timeout',true)`,
    'select public.reconcile_publication_schedules_v1(1)',
  ]) { const result=sql(call,true); assert.notEqual(result.status,0); assert.match(result.stderr,/publication_service_required/); checks++; }
  // Config never accepts URL credentials, signed query strings, fragments or non-HTTPS.
  for(const url of ['http://media.example','https://user:password@media.example','https://media.example?token=secret','https://media.example/#fragment']){
    const result=sql(`update private.publication_schedule_policy set public_base_url='${url}'`,true);
    assert.notEqual(result.status,0); assert.match(result.stderr,/check constraint/); checks++;
  }
  const edited=freshSchedule(); makeDue(edited.id); const [ec]=claim(); const ei=prepare(ec);
  const sourceId=scalar(`select source_asset_id from private.publication_schedule_materializations where schedule_id='${edited.id}'`);
  userScalar(`select public.update_my_publication_draft_v1('${edited.draft_id}',1,'${command()}','photo','changed','Sin musica','{}',array['${sourceId}'::uuid])`);
  sql(`update private.publication_schedules set claim_expires_at=now()-interval '1 second' where id='${edited.id}'`);
  reconcile();
  eq(scalar(`select state||':'||last_error_code from private.publication_schedules where id='${edited.id}'`),'terminal_failed:draft_changed','expired claim detects frozen revision loss');
  // Let authoritative time cross the lease after initial fence validation, as
  // a blocked row lock can. Inject only a disposable delay and restore the body.
  const slow=freshSchedule(); makeDue(slow.id); const [sc]=claim();
  const claimDefinition=scalar("select pg_get_functiondef('private.require_publication_claim_v1(uuid,bigint,uuid,boolean,boolean)'::regprocedure)");
  sql(claimDefinition.replace('  return v_schedule;',"  perform pg_catalog.pg_sleep(0.2); return v_schedule;"));
  try {
    const late=service(`update private.publication_schedules set claim_expires_at=clock_timestamp()+interval '0.1 seconds' where id='${slow.id}'; select public.prepare_publication_schedule_v1(${fence(sc)})`,true);
    // service_role intentionally has no direct table authority: set the fixture deadline as postgres instead.
    assert.match(late.stderr,/permission denied/); checks++;
    const crossing=sql(`begin; update private.publication_schedules set claim_expires_at=clock_timestamp()+interval '0.1 seconds' where id='${slow.id}'; set local role service_role; select public.prepare_publication_schedule_v1(${fence(sc)}); commit;`,true);
    assert.notEqual(crossing.status,0,'prepare must reject a lease that expires while acquiring locks');
    assert.match(crossing.stderr,/publication_schedule_fence_invalid/); checks++;
  } finally { sql(claimDefinition); }
  // A held source sorts after its reserved target. Reconcile must skip the
  // complete schedule without retaining its earlier target lock or any writes.
  // The full alternating S1/S4-X, S2/S3-Y interleaving belongs to Task 1C.
  const contendedSource='ffffffff-ffff-4fff-bfff-ffffffffffff';
  sql(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,etag,status,ready_at) values('${contendedSource}','${owner}','r2','image','post_image','private','private','draft/contended','image/jpeg',123,repeat('a',32),'ready',now())`);
  const contended=JSON.parse(userScalar(schedule(createDraft(contendedSource).id))); makeDue(contended.id);
  const [ct]=claim(); const contendedItems=prepare(ct); const contendedTarget=contendedItems.items[0].target_asset_id;
  assert.ok(contendedTarget<contendedSource,'target lock precedes blocked source in sorted set'); checks++;
  sql(`update private.publication_schedules set claim_expires_at=clock_timestamp()-interval '1 second' where id='${contended.id}'`);
  const attemptsBefore=scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${contended.id}'`);
  const holder=spawn(join(pgBin,'psql.exe'),connection,{encoding:'utf8',windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});
  let heldOutput='',heldError='';
  holder.stdout.setEncoding('utf8'); holder.stderr.setEncoding('utf8');
  holder.stderr.on('data',chunk=>{heldError+=chunk;});
  const holderDone=new Promise((accept,reject)=>{holder.once('error',reject);holder.once('close',code=>accept(code));});
  const holderReady=new Promise((accept,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('source lock barrier timed out: '+heldError)),5000);
    holder.stdout.on('data',chunk=>{heldOutput+=chunk;if(heldOutput.includes('B2_SOURCE_LOCK_READY')){clearTimeout(timeout);accept();}});
    holder.once('error',error=>{clearTimeout(timeout);reject(error);});
    holder.once('close',code=>{clearTimeout(timeout);if(!heldOutput.includes('B2_SOURCE_LOCK_READY'))reject(new Error('lock holder exited: '+code+' '+heldError));});
  });
  try {
    holder.stdin.write(`begin; set local statement_timeout='5s'; set local lock_timeout='2s'; select id from public.media_assets where id='${contendedSource}' for update; select 'B2_SOURCE_LOCK_READY';` + String.fromCharCode(10));
    await holderReady;
    const skipped=service("set local lock_timeout='400ms'; set local statement_timeout='3s'; select public.reconcile_publication_schedules_v1(10)",true);
    assert.equal(skipped.status,0,'reconciliation must skip a contended complete asset set: '+skipped.stderr); checks++;
    eq(JSON.parse(skipped.stdout.trim()),{recovered:0,released:0});
    eq(scalar(`select state from private.publication_schedules where id='${contended.id}'`),'materializing');
    eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${contended.id}'`),attemptsBefore,'skipped schedule has no partial recovery event');
    eq(scalar(`begin; select id from public.media_assets where id='${contendedTarget}' for update nowait; rollback;`),contendedTarget,'skipped call leaves its target lock available');
  } finally {
    holder.stdin.end('rollback;' + String.fromCharCode(10));
    const holderExit=await holderDone; if(holderExit!==0)console.error('SOURCE_HOLDER_ERROR',holderExit,heldError);
    eq(holderExit,0,'source lock holder closes cleanly: '+heldError);
  }
  eq(reconcile().recovered,1,'uncontended next wake recovers the skipped schedule');
  eq(scalar(`select last_error_code from private.publication_schedules where id='${contended.id}'`),'lease_expired');
  const directCommand=command();
  const directCall=`select public.publish_my_media_post_v1('${directCommand}','photo','B1 receipt','',array['${publicAssets[2]}'::uuid])`;
  const directPost=userScalar(directCall); eq(userScalar(directCall),directPost,'direct B1 receipt replay through shared insertion core');
  denied(`select public.publish_my_media_post_v1('${directCommand}','photo','changed','',array['${publicAssets[2]}'::uuid])`,'publication_receipt_conflict');
  const many=[]; for(let i=0;i<11;i++){const q=freshSchedule(); makeDue(q.id);many.push(q);}
  const firstBatch=serviceJson("select jsonb_agg(x) from public.claim_publication_schedules_v1(999) x"); eq(firstBatch.length,10,'bounded claim batch');
  const secondBatch=claim(); eq(secondBatch.length,1); eq(new Set([...firstBatch,...secondBatch].map(x=>x.schedule_id)).size,11);
  eq(claim(),[]);
  const cap=freshSchedule(); makeDue(cap.id); const [zeroLimit]=serviceJson("select jsonb_agg(x) from public.claim_publication_schedules_v1(0) x"); eq(zeroLimit.schedule_id,cap.id,'zero limit clamps to one');
  sql("update private.publication_schedule_policy set public_bucket=null");
  rejectService(`select public.prepare_publication_schedule_v1(${fence(zeroLimit)})`,'publication_schedule_configuration_missing');
  eq(scalar(`select count(*) from private.publication_schedule_materializations where schedule_id='${cap.id}'`),'0','missing config cannot reserve targets');
  console.log(JSON.stringify({verdict:'B2_WORKER_DISPOSABLE_PASS',checks,postgres:scalar('show server_version')}));
} catch (error) { failure = error; console.error(error); }
finally {
  if (started) {
    invoke('pg_ctl', ['-D', cluster, '-w', '-t', '30', '-m', 'fast', 'stop'], undefined, true);
    stopped = invoke('pg_ctl', ['-D', cluster, 'status'], undefined, true).status === 3;
  }
  assert.ok(stopped || !started, 'disposable PostgreSQL did not stop');
  assert.equal(dirname(resolve(cluster)), resolve(scratch));
  assert.ok(basename(cluster).startsWith('worker-proof-'));
  rmSync(cluster, { recursive: true });
  console.log(`CLEANUP ${JSON.stringify({ serverStopped: stopped, directoryRemoved: !existsSync(cluster) })}`);
}
if (failure) throw failure;
