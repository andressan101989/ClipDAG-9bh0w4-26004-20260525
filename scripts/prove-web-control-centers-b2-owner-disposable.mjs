// Focused Task 1A proof. Task 1C owns the complete worker/concurrency proof.
// Only loopback PostgreSQL is accepted. Reuse B1's controlled baseline and real
// predecessor definitions without executing its proof or changing its files.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const scratch = 'D:/CodexTemp/web-control-centers-b2/task1a';
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
const cluster = mkdtempSync(join(scratch, 'owner-proof-'));
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
const connection = ['-X', '--no-password', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'b2owner', '-v', 'ON_ERROR_STOP=1'];
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
  invoke('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'b2owner']);
  sql(setup);
  sql(read('supabase/migrations/20261102065812_web_control_centers_b1_publication_drafts.sql'));
  sql(read('supabase/migrations/20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery.sql'));
  const b1Definition = scalar("select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|',p.oid,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,pg_catalog.pg_get_function_arguments(p.oid),pg_catalog.pg_get_function_result(p.oid)),'' order by p.oid)) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')");
  const b1Oids = scalar("select pg_catalog.string_agg(p.oid::text,',') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')");
  const migration = read('supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql');
  sql(migration);
  const draft = createDraft();
  const local = scalar("select to_char(clock_timestamp() at time zone 'UTC' + interval '1 day','YYYY-MM-DD HH24:MI:SS.US')");
  const createCommand = command();
  const createCall = schedule(draft.id, createCommand, `'${local}'::timestamp`);
  const created = JSON.parse(userScalar(createCall)); // RED: missing owner function.
  eq([created.state, created.revision, created.generation, created.draft_revision], ['scheduled', 1, 1, 1]);
  eq(JSON.parse(userScalar(createCall, owner, 'Asia/Tokyo')), created, 'stable exact replay across session zones');
  sql(read('tests/fixtures/web-control-centers-b2-security.sql')); checks++;
  eq(scalar(`select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|',p.oid,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,pg_catalog.pg_get_function_arguments(p.oid),pg_catalog.pg_get_function_result(p.oid)),'' order by p.oid)) from pg_catalog.pg_proc p where p.oid in (${b1Oids})`), b1Definition, 'B1 signatures, defaults, OIDs, owner, grants, volatility and security settings unchanged');
  const initialCounts = scalar("select count(*)||':'||(select count(*) from public.media_asset_links where entity_type='publication_draft')||':'||(select count(*) from public.videos) from public.media_assets");
  eq(initialCounts, '9:1:0', 'scheduling preserves source reservation and creates no media/posts');
  eq(Object.keys(created).sort(), ['id','draft_id','draft_revision','state','revision','generation','scheduled_for','timezone_name','local_scheduled_at','utc_offset_minutes','attempt_count','max_attempts','next_attempt_at','retryable','last_error_code','post_id','created_at','updated_at'].sort());
  denied(schedule(draft.id, createCommand, `'${local}'::timestamp + interval '1 hour'`), 'publication_schedule_command_conflict');
  denied(schedule(draft.id), 'publication_schedule_exists');
  denied(schedule(draft.id), 'publication_draft_not_found', otherOwner);
  denied(createCall, 'publication_auth_required', '');
  denied(`select public.schedule_my_publication_draft_v1(null,1,'${command()}',${due},'UTC')`, 'publication_schedule_input_invalid');
  denied(`select public.schedule_my_publication_draft_v1('${draft.id}',null,'${command()}',${due},'UTC')`, 'publication_schedule_input_invalid');
  denied(`select public.cancel_my_publication_schedule_v1('${created.id}',1,'${createCommand}')`, 'publication_schedule_command_conflict');
  const nextDraft = createDraft(privateAssets[1]);
  // Freeze only the clock dependency in this disposable database. Every call
  // uses a fresh command and rolls back, so this exercises eligibility, never
  // recorded replay. Restore the exact installed definition and private policy.
  const commandDefinition = scalar("select pg_catalog.pg_get_functiondef('private.execute_publication_schedule_command_v1(text,uuid,bigint,uuid,timestamp,text,integer)'::regprocedure)");
  const clockAssignment = 'v_now := pg_catalog.clock_timestamp();';
  assert.equal(commandDefinition.split(clockAssignment).length, 2, 'one clock dependency is required for the disposable fixture');
  try {
    for (const scenario of [
      { name: 'spring horizon accepts inside UTC bound', now: '2027-03-14 06:30:00+00', requested: '2028-03-13 06:00:00', lead: '2 minutes', accepted: true },
      { name: 'fall horizon rejects outside UTC bound', now: '2027-11-07 05:30:00+00', requested: '2028-11-06 06:00:00', lead: '2 minutes', accepted: false },
      { name: 'configured calendar-day lead uses UTC', now: '2027-03-13 12:00:00+00', requested: '2027-03-14 11:30:00', lead: '1 day', accepted: false },
    ]) {
      sql(commandDefinition.replace(clockAssignment, `v_now := '${scenario.now}'::timestamptz;`));
      sql(`update private.publication_schedule_policy set min_lead=interval '${scenario.lead}'`);
      const outcomes = [];
      for (const sessionZone of ['UTC', 'America/New_York']) {
        const freshCall = schedule(nextDraft.id, command(), `'${scenario.requested}'::timestamp`);
        const result = sql(`begin; set local timezone='${sessionZone}'; set local role authenticated;
          select pg_catalog.set_config('request.jwt.claim.sub','${owner}',true);
          ${freshCall}; rollback;`, true);
        if (result.status !== 0) assert.match(result.stderr, /publication_schedule_time_bounds/);
        outcomes.push(result.status === 0);
      }
      eq(outcomes, [scenario.accepted, scenario.accepted], `${scenario.name}: fresh UTC and New York eligibility must agree`);
    }
  } finally {
    sql(commandDefinition);
    sql("update private.publication_schedule_policy set min_lead=interval '2 minutes'");
  }
  denied(schedule(nextDraft.id, command(), due, 'UTC', 'null', 2), 'publication_draft_conflict');
  denied(schedule(nextDraft.id, command(), "clock_timestamp() at time zone 'UTC' + interval '1 minute'"), 'publication_schedule_time_bounds');
  denied(schedule(nextDraft.id, command(), "clock_timestamp() at time zone 'UTC' + interval '366 days'"), 'publication_schedule_time_bounds');
  for (const [localTime, zone, offset, expected] of [
    ['2027-01-15 12:00','America/New_York',null,'2027-01-15 17:00:00+00'],
    ['2027-11-07 01:30','America/New_York',-240,'2027-11-07 05:30:00+00'],
    ['2027-11-07 01:30','America/New_York',-300,'2027-11-07 06:30:00+00'],
    ['2027-04-04 01:45','Australia/Lord_Howe',630,'2027-04-03 15:15:00+00'],
    ['2027-01-15 12:00','Asia/Kathmandu',345,'2027-01-15 06:15:00+00'],
  ]) eq(scalar(`set timezone='UTC'; select private.resolve_publication_schedule_time_v1('${localTime}','${zone}',${offset ?? 'null'})`), expected);
  for (const [time, zone, offset] of [
    ['2027-03-14 02:30','America/New_York','null'], ['2027-11-07 01:30','America/New_York','null'],
    ['2027-11-07 01:30','America/New_York','-360'], ['2027-01-15 12:00','Invalid/Zone','null'],
    ['infinity','UTC','null'], ['2027-01-15 12:00','UTC','841'],
  ]) {
    const result = sql(`select private.resolve_publication_schedule_time_v1('${time}','${zone}',${offset})`, true);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /publication_schedule_time_invalid/); checks++;
  }
  sql(`update public.media_assets set status='delete_pending' where id='${privateAssets[1]}'`);
  denied(schedule(nextDraft.id), 'publication_asset_not_ready_or_owned');
  sql(`update public.media_assets set status='ready' where id='${privateAssets[1]}'`);
  const mutate = (op, revision, cmd = command(), time = due) => `select public.${op}('${created.id}',${revision},'${cmd}'${op === 'reschedule_my_publication_v1' ? `,${time},'UTC',null` : ''})`;
  denied(mutate('reschedule_my_publication_v1', 2), 'publication_schedule_conflict');
  denied(mutate('cancel_my_publication_schedule_v1', 1), 'publication_schedule_not_found', otherOwner);
  sql(`update private.publication_schedules set state='materializing',claim_token=gen_random_uuid(),claim_expires_at=now()+interval '2 minutes' where id='${created.id}'`);
  const rescheduleCommand = command();
  const rescheduleCall = mutate('reschedule_my_publication_v1', 1, rescheduleCommand, `'${local}'::timestamp + interval '1 hour'`);
  const rescheduled = JSON.parse(userScalar(rescheduleCall));
  eq([rescheduled.revision, rescheduled.generation], [2, 2]);
  eq(scalar(`select claim_token is null and claim_expires_at is null from private.publication_schedules where id='${created.id}'`), 't');
  eq(JSON.parse(userScalar(createCall)), created, 'create replay returns original result after mutation');
  eq(JSON.parse(userScalar(rescheduleCall)), rescheduled);
  denied(mutate('retry_my_publication_schedule_v1', 2), 'publication_schedule_retry_forbidden');
  sql(`update private.publication_schedules set state='retryable_failed',retryable=true,attempt_count=2,last_error_code='provider_timeout',claim_token=gen_random_uuid(),claim_expires_at=now() where id='${created.id}'`);
  const retryCommand = command();
  const retryCall = mutate('retry_my_publication_schedule_v1', 2, retryCommand);
  const retried = JSON.parse(userScalar(retryCall));
  eq([retried.state,retried.revision,retried.generation,retried.attempt_count,retried.retryable], ['scheduled',3,2,2,false]);
  eq(scalar(`select claim_token is null and claim_expires_at is null from private.publication_schedules where id='${created.id}'`), 't');
  eq(JSON.parse(userScalar(retryCall)), retried);
  sql(`update private.publication_schedules set state='retryable_failed',retryable=true,attempt_count=max_attempts where id='${created.id}'`);
  denied(mutate('retry_my_publication_schedule_v1', 3), 'publication_schedule_retry_forbidden');
  denied(mutate('reschedule_my_publication_v1', 3), 'publication_schedule_retry_forbidden');
  sql(`update private.publication_schedules set attempt_count=2,retryable=false where id='${created.id}'`);
  denied(mutate('retry_my_publication_schedule_v1', 3), 'publication_schedule_retry_forbidden');
  denied(mutate('reschedule_my_publication_v1', 3), 'publication_schedule_retry_forbidden');
  sql(`update private.publication_schedules set state='claimed',claim_token=gen_random_uuid(),claim_expires_at=now()+interval '2 minutes' where id='${created.id}'`);
  const cancelCall = mutate('cancel_my_publication_schedule_v1', 3);
  const cancelled = JSON.parse(userScalar(cancelCall));
  eq([cancelled.state,cancelled.revision,cancelled.generation,cancelled.attempt_count], ['cancelled',4,3,2]);
  eq(scalar(`select claim_token is null and claim_expires_at is null from private.publication_schedules where id='${created.id}'`), 't');
  eq(JSON.parse(userScalar(cancelCall)), cancelled);
  denied(mutate('cancel_my_publication_schedule_v1', 4), 'publication_schedule_conflict');
  denied(mutate('reschedule_my_publication_v1', 4), 'publication_schedule_conflict');
  eq(scalar("select count(*)||':'||(select count(*) from public.media_asset_links where entity_type='publication_draft')||':'||(select count(*) from public.videos) from public.media_assets"), '9:2:0');
  const replacement = JSON.parse(userScalar(schedule(draft.id)));
  assert.notEqual(replacement.id, created.id); checks++;
  sql(`update public.media_assets set purpose='carousel_image' where id in ('${privateAssets[2]}','${privateAssets[3]}')`);
  const carousel = createDraft([privateAssets[2], privateAssets[3]], 'carousel');
  const carouselSchedule = JSON.parse(userScalar(schedule(carousel.id)));
  eq(carouselSchedule.state, 'scheduled');
  const otherDraft = createDraft(privateAssets[4], 'photo', otherOwner);
  const otherSchedule = JSON.parse(userScalar(schedule(otherDraft.id), otherOwner));
  // Bulk rows exercise limits/tied timestamps; commands above exercise actual RPC writes.
  sql(`insert into private.publication_schedules(owner_id,draft_id,draft_revision,publish_command_id,request_fingerprint,state,scheduled_for,timezone_name,local_scheduled_at,max_attempts,next_attempt_at,created_at)
    select '${owner}','${draft.id}',1,gen_random_uuid(),repeat('a',64),'cancelled',now()+interval '1 day','UTC',now() at time zone 'UTC',5,now()+interval '1 day','2025-01-01' from generate_series(1,55)`);
  const list = (limit = 20, cursor = null) => JSON.parse(userScalar(`select coalesce(jsonb_agg(item),'[]'::jsonb) from public.list_my_publication_schedules_v1(${limit},${cursor ? `'${cursor.created_at}'` : 'null'},${cursor ? `'${cursor.id}'` : 'null'}) item`));
  eq(list(0).length, 1);
  eq(list(999).length, 50);
  let page = list(); const items = [...page];
  while (page.length) { page = list(20, page.at(-1)); items.push(...page); }
  eq(items.length, 58); eq(new Set(items.map(item => item.id)).size, 58);
  eq(items.some(item => item.id === otherSchedule.id), false);
  eq(items.some(item => Object.hasOwn(item, 'claim_token') || Object.hasOwn(item, 'owner_id') || Object.hasOwn(item, 'publish_command_id')), false);
  const tied = items.filter(item => item.created_at.startsWith('2025-01-01')).map(item => item.id);
  eq(tied, [...tied].sort().reverse());
  denied("select * from public.list_my_publication_schedules_v1(20,now(),null)", 'publication_schedule_cursor_invalid');
  denied(`select * from public.list_my_publication_schedules_v1(20,null,'${created.id}')`, 'publication_schedule_cursor_invalid');
  denied('select * from public.list_my_publication_schedules_v1()', 'publication_auth_required', '');
  const direct = sql('set role authenticated; select * from private.publication_schedules', true);
  assert.notEqual(direct.status, 0); assert.match(direct.stderr, /permission denied/); checks++;
  eq(sql('set role anon; select count(*) from public.media_asset_links where entity_type=\'publication_draft\'').stdout.trim(), '0');
  const editedSchedule = JSON.parse(userScalar(schedule(nextDraft.id)));
  userScalar(`select public.update_my_publication_draft_v1('${nextDraft.id}',1,'${command()}','photo','edited','Sin musica','{}',array['${privateAssets[1]}'::uuid])`);
  denied(`select public.reschedule_my_publication_v1('${editedSchedule.id}',1,'${command()}',${due},'UTC')`, 'publication_draft_conflict');
  sql(`update private.publication_schedules set state='retryable_failed',retryable=true where id='${editedSchedule.id}'`);
  denied(`select public.retry_my_publication_schedule_v1('${editedSchedule.id}',1,'${command()}')`, 'publication_draft_conflict');
  sql(`update private.publication_schedules set state='terminal_failed',retryable=false where id='${editedSchedule.id}'`);
  sql(`update public.media_assets set status='delete_pending' where id='${privateAssets[1]}'`);
  eq(JSON.parse(userScalar(`select public.cancel_my_publication_schedule_v1('${editedSchedule.id}',1,'${command()}')`)).state, 'cancelled', 'cancel remains possible before publication, including terminal failure after draft edit and source loss');
  // An actual canonical B1 commit wins against later cancellation. Task 1B
  // will reconcile schedule status and unify publisher lock acquisition.
  const post = userScalar(`select public.publish_my_publication_draft_v1('${draft.id}',1,'${command()}',array['${publicAssets[0]}'::uuid])`);
  assert.match(post, /^[0-9a-f-]{36}$/); checks++;
  denied(`select public.cancel_my_publication_schedule_v1('${replacement.id}',1,'${command()}')`, 'publication_schedule_conflict');
  eq(scalar(`select count(*) from public.videos where id='${post}'`), '1', 'cancel never removes the published post');
  const immutable = sql("update private.publication_schedule_commands set operation='cancel'", true);
  assert.notEqual(immutable.status, 0); assert.match(immutable.stderr, /publication_schedule_audit_immutable/); checks++;
  sql(`insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event) values ('${created.id}',1,gen_random_uuid(),'claimed')`);
  const immutableAttempt = sql('delete from private.publication_schedule_attempts', true);
  assert.notEqual(immutableAttempt.status, 0); assert.match(immutableAttempt.stderr, /publication_schedule_audit_immutable/); checks++;
  eq(scalar('select count(*) from private.publication_schedule_materializations'), '0');
  console.log(JSON.stringify({ verdict: 'B2_OWNER_DISPOSABLE_PASS', checks, postgres: scalar('show server_version') }));
} catch (error) { failure = error; console.error(error); }
finally {
  if (started) {
    invoke('pg_ctl', ['-D', cluster, '-w', '-t', '30', '-m', 'fast', 'stop'], undefined, true);
    stopped = invoke('pg_ctl', ['-D', cluster, 'status'], undefined, true).status === 3;
  }
  assert.ok(stopped || !started, 'disposable PostgreSQL did not stop');
  assert.equal(dirname(resolve(cluster)), resolve(scratch));
  assert.ok(basename(cluster).startsWith('owner-proof-'));
  rmSync(cluster, { recursive: true });
  console.log(`CLEANUP ${JSON.stringify({ serverStopped: stopped, directoryRemoved: !existsSync(cluster) })}`);
}
if (failure) throw failure;
