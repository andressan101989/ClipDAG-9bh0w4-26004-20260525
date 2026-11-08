// Integrated Task 1C: real independent PostgreSQL 17 sessions and explicit barriers.
// Only loopback PostgreSQL is accepted. Reuse B1's controlled baseline and real
// predecessor definitions without executing its proof or changing its files.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const scratch = 'D:/CodexTemp/web-control-centers-b2/task1c';
const pgBin = 'D:/CodexTemp/postgres-17.11-disposable/pgsql/bin';
mkdirSync(scratch, { recursive: true });
const environment = { ...process.env, TEMP: scratch, TMP: scratch, npm_config_cache: join(scratch, 'npm-cache') };
for (const key of Object.keys(environment)) if (/^PG/i.test(key)) delete environment[key];
Object.assign(environment, { PGHOST: '127.0.0.1', PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '3', PGSSLMODE: 'disable', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000' });
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
const cluster = mkdtempSync(join(scratch, 'concurrency-proof-'));
assert.match(resolve(cluster),/^D:/i);
assert.equal(dirname(resolve(cluster)),resolve(scratch));
assert.ok(basename(cluster).startsWith('concurrency-proof-'));
const proofStarted=Date.now();
let started = false;
let stopped = false;
let failure;
let checks = 0;
function invoke(tool, args, input, allowFailure = false) {
  const result = spawnSync(join(pgBin, `${tool}.exe`), args, {
    input, encoding: 'utf8', windowsHide: true, env: environment, timeout: tool === 'initdb' ? 180_000 : 30_000,
    stdio: tool === 'pg_ctl' ? 'ignore' : 'pipe',
  });
  if (!allowFailure) assert.equal(result.status, 0, `${tool}: ${result.error?.message ?? ''}\n${result.stderr ?? ''}`);
  return result;
}
const connection = ['-X', '--no-password', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'b2concurrency', '-v', 'ON_ERROR_STOP=1'];
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
const sessions = new Set();
class Session {
  constructor(name) {
    this.name=name; this.out=''; this.err=''; this.closed=false;
    this.child=spawn(join(pgBin,'psql.exe'),connection,{windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});
    sessions.add(this);
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data',x=>{this.out+=x;this.check?.();});
    this.child.stderr.on('data',x=>{this.err+=x;});
    this.done=new Promise(resolve=>this.child.once('close',code=>{this.closed=true;this.code=code;this.check?.();resolve(code);}));
    this.child.on('error',e=>{this.err+=e.message;});
  }
  async run(source) {
    assert.ok(!this.check,'one in-flight query per connection');
    const start=this.out.length, errorStart=this.err.length, marker='BARRIER_'+(++serial);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.check=null;reject(new Error(this.name+' barrier timeout '+this.err));},20000);
      this.check=()=>{
        const output=this.out.slice(start), index=output.indexOf(marker);
        if(index>=0||this.closed){
          clearTimeout(timer);this.check=null;
          resolve({status:index>=0?0:this.code,stdout:index>=0?output.slice(0,index).trim():output.trim(),stderr:this.err.slice(errorStart)});
        }
      };
      this.child.stdin.write(source+';\nselect '+"'"+marker+"'"+';\n');
      this.check();
    });
  }
  async begin(role='postgres',actor='') {
    const r=await this.run('begin; set local application_name='+"'"+this.name+"'"+'; set local role '+role+'; set local request.jwt.claim.sub='+"'"+actor+"'"+'; select pg_backend_pid()');
    ok(r);this.pid=Number(r.stdout);return this;
  }
  async close(commit=false) {
    if(!this.closed){if(!this.check)ok(await this.run(commit?'commit':'rollback'));this.child.stdin.end();}
    await this.done;sessions.delete(this);
  }
}
const ok=r=>{assert.equal(r.status,0,r.stderr);return r.stdout;};
const rejected=(r,error)=>{assert.notEqual(r.status,0,'expected '+error+'; got '+r.stdout);assert.match(r.stderr,new RegExp(error));checks++;};
const connect=async(name,role='postgres',actor='')=>new Session(name).begin(role,actor);
async function blocked(waiter,holder) {
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    if(scalar('select '+holder.pid+'=any(pg_blocking_pids('+waiter.pid+'))')==='t'){
      checks++;console.log('LOCK_BARRIER '+waiter.name+' -> '+holder.name);return;
    }
    assert.ok(!waiter.closed,waiter.err);await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('No observed lock barrier: '+waiter.name+' -> '+holder.name);
}
// A's operation completes but remains uncommitted. B starts in an independent
// backend; pg_blocking_pids proves overlap before A is allowed to commit.
async function race(label,aSql,bSql,{aRole='authenticated',bRole='authenticated',aActor=owner,bActor=owner,bError}={}) {
  const publishes=statement=>/public\.publish_(?:publication_schedule|my_publication_draft)_v1/.test(statement);
  const postsBefore=publishes(aSql)||publishes(bSql)?Number(scalar('select count(*) from public.videos')):null;
  const a=await connect(label+'-A',aRole,aActor),b=await connect(label+'-B',bRole,bActor);
  try {
    const first=await a.run(aSql);ok(first);
    const pending=b.run(bSql);await blocked(b,a);await a.close(true);
    const second=await pending;if(bError)rejected(second,bError);else ok(second);
    await b.close(!bError);if(postsBefore!==null)eq(Number(scalar('select count(*) from public.videos')),postsBefore+(publishes(aSql)||(!bError&&publishes(bSql))?1:0),'exact post count across '+label);console.log('RACE_PASS '+label);return [first.stdout,second.stdout];
  }finally{await a.close();await b.close();}
}
try {
  invoke('initdb', ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
  started = true;
  // Disposable behavior proof only: fsync is disabled to avoid host-wide disk
  // stalls on cleanup. This does not claim power-loss durability verification.
  invoke('pg_ctl', ['-D', cluster, '-l', join(cluster, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, '-w', '-t', '30', 'start']);
  invoke('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'b2concurrency']);
  eq(scalar('show server_version_num').slice(0,2),'17','PostgreSQL 17 required');
  sql(setup);
  sql(read('supabase/migrations/20261102065812_web_control_centers_b1_publication_drafts.sql'));
  sql(read('supabase/migrations/20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery.sql'));
  sql("update public.media_assets set size_bytes=123,etag=repeat('a',32) where visibility='private'");
  const c1=read('supabase/migrations/20261023141630_creator_premium_media_lifecycle_c1.sql');
  sql(extractFunction(c1,'create or replace function private.guard_ready_media_asset_identity()'));
  sql(extractFunction(c1,'create or replace function private.guard_media_asset_link_lifecycle_v1()'));
  sql('create trigger proof_identity before update on public.media_assets for each row execute function private.guard_ready_media_asset_identity(); create trigger media_asset_links_guard_lifecycle_c1 before insert or update on public.media_asset_links for each row execute function private.guard_media_asset_link_lifecycle_v1()');
  const b1Oids=scalar("select string_agg(p.oid::text,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'");
  const b1Catalog=scalar("select md5(string_agg(concat_ws('|',p.oid,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid)),'' order by p.oid)) from pg_proc p where p.oid in ("+b1Oids+")");
  sql(read('supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql'));
  const service=source=>sql(`begin;set local role service_role;${source};commit;`);
  const sj=source=>JSON.parse(service(source).stdout.trim());
  const fence=c=>`'${c.schedule_id}',${c.generation},'${c.claim_token}'`;
  const prep=c=>`select public.prepare_publication_schedule_v1(${fence(c)})`;
  const digest=createHash('sha256').update(Buffer.alloc(123,0x61)).digest('hex');
  const conf=(c,p=0,etag='a'.repeat(32))=>`select public.confirm_publication_schedule_item_v1(${fence(c)},${p},123,'${etag}','${digest}','${digest}')`;
  const pub=c=>`select public.publish_publication_schedule_v1(${fence(c)})`;
  const fail=(c,code='provider_timeout')=>`select public.fail_publication_schedule_v1(${fence(c)},'${code}',true)`;
  const claims=(limit=10)=>`select coalesce(jsonb_agg(x),'[]'::jsonb) from public.claim_publication_schedules_v1(${limit}) x`;
  const cancel=(s,rev=s.revision)=>`select public.cancel_my_publication_schedule_v1('${s.id}',${rev},'${command()}')`;
  const reschedule=(s,rev=s.revision)=>`select public.reschedule_my_publication_v1('${s.id}',${rev},'${command()}',${due},'UTC',null)`;
  const dueNow=s=>sql(`update private.publication_schedules set scheduled_for=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where id='${s.id}'`);
  const gate=d=>`select pg_advisory_xact_lock(hashtextextended('publication-draft-gate:${d}',0))`;
  const freshSource=(purpose='post_image',id=command())=>{
    sql(`insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,etag,status,ready_at) values('${id}','${owner}','r2','image','${purpose}','private','private','draft/${id}','image/jpeg',123,repeat('a',32),'ready',now())`);
    return id;
  };
  const freshDraft=(source=freshSource(),kind='photo')=>({...createDraft(source,kind),source});
  const newSchedule=(d=freshDraft())=>({...JSON.parse(userScalar(schedule(d.id))),source:d.source});
  const claimOne=s=>{dueNow(s);const cs=sj(claims());eq(cs.length,1,'isolated due fixture');eq(cs[0].schedule_id,s.id);return cs[0];};
  const ready=s=>{const c=claimOne(s);const p=sj(prep(c));for(const i of p.items)sj(conf(c,i.position));return {c,p};};
  const assertNoPost=s=>eq(scalar(`select count(*) from private.publication_receipts where draft_id='${s.draft_id}'`),'0','no partial receipt');
  const assertCanonical=(s,query=scalar)=>eq(query(`
    select count(*) from private.publication_receipts r
    join public.videos v on v.id=r.post_id and v.user_id=r.owner_id
    join private.publication_drafts d on d.id=r.draft_id and d.owner_id=r.owner_id
      and d.published_post_id=v.id
    cross join lateral (
      select array_agg(l.asset_id order by l.position) as assets,
        array_agg(l.position order by l.position) as positions,count(*) as link_count
      from public.media_asset_links l
      where l.entity_type='video_post' and l.entity_id=v.id and l.slot='media'
    ) links
    where r.owner_id='${owner}' and r.operation='draft' and d.id='${s.draft_id}'
      and (select count(*) from private.publication_receipts receipt
        where receipt.owner_id=r.owner_id and receipt.draft_id=d.id and receipt.operation='draft')=1
      and d.state='published' and d.published_at is not null and d.deleted_at is null
      and not exists(select 1 from public.media_asset_links l
        where l.entity_type='publication_draft' and l.entity_id=d.id)
      and links.assets=r.ordered_asset_ids
      and links.link_count=cardinality(r.ordered_asset_ids)
      and links.positions=array(select generate_series(0,cardinality(r.ordered_asset_ids)-1))
  `),'1','one canonical post, draft and receipt target');
  sql("update private.publication_schedule_policy set public_bucket='public', public_base_url='https://media.example',object_environment='development'");
  // Real two-item publication exercises the canonical assertion itself. Each
  // mutation and any local constraint/trigger bypass is rolled back before the
  // JS assertion runs, so even an expected assertion failure leaves no damage.
  const canonicalCarousel=newSchedule(freshDraft([freshSource('carousel_image'),freshSource('carousel_image')],'carousel'));
  const canonicalReady=ready(canonicalCarousel),canonicalPost=sj(pub(canonicalReady.c));
  const canonicalTargets=canonicalReady.p.items.map(i=>i.target_asset_id);
  assertCanonical(canonicalCarousel);
  eq(JSON.parse(scalar(`select to_json(ordered_asset_ids) from private.publication_receipts where draft_id='${canonicalCarousel.draft_id}'`)),canonicalTargets,'real ordered two-item receipt');
  const postLinks=`entity_type='video_post' and entity_id='${canonicalPost.post_id}' and slot='media'`;
  const dropStateCheck=`do $$declare c record;begin for c in select conname from pg_constraint where conrelid='private.publication_drafts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%published_at%' loop execute format('alter table private.publication_drafts drop constraint %I',c.conname);end loop;end$$;`;
  const corruptions=[
    ['missing-link',`delete from public.media_asset_links where ${postLinks} and position=1`],
    ['extra-link',`insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${publicAssets[0]}','video_post','${canonicalPost.post_id}','media',2)`],
    ['wrong-ordered-links',`update public.media_asset_links set position=1-position where ${postLinks}`],
    ['wrong-asset',`update public.media_asset_links set asset_id='${publicAssets[0]}' where ${postLinks} and position=1`],
    ['position-gap',`update public.media_asset_links set position=3 where ${postLinks} and position=1`],
    ['wrong-slot',`update public.media_asset_links set slot='thumbnail' where ${postLinks} and position=1`],
    ['unreleased-draft-link',`alter table public.media_asset_links disable trigger user;insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${canonicalCarousel.source[0]}','publication_draft','${canonicalCarousel.draft_id}','media',0)`],
    ['draft-not-published',`${dropStateCheck}update private.publication_drafts set state='draft' where id='${canonicalCarousel.draft_id}'`],
    ['missing-published-at',`${dropStateCheck}update private.publication_drafts set published_at=null where id='${canonicalCarousel.draft_id}'`],
    ['deleted-published-draft',`${dropStateCheck}update private.publication_drafts set deleted_at=now() where id='${canonicalCarousel.draft_id}'`],
    ['wrong-post-reference',`update private.publication_drafts set published_post_id='${command()}' where id='${canonicalCarousel.draft_id}'`],
    ['wrong-draft-owner',`update private.publication_drafts set owner_id='${otherOwner}' where id='${canonicalCarousel.draft_id}'`],
    ['wrong-post-owner',`update public.videos set user_id='${otherOwner}' where id='${canonicalPost.post_id}'`],
  ];
  const corruptionResults=[];
  for(const [name,damage] of corruptions){
    let rejected=false;
    try{assertCanonical(canonicalCarousel,query=>scalar(`begin;alter table private.publication_drafts disable trigger user;${damage};${query};rollback`));}
    catch(error){
      // Only the canonical helper's assertion is an expected rejection; SQL or
      // fixture errors must fail the proof rather than masquerade as coverage.
      assert.equal(error.code,'ERR_ASSERTION');assert.ok(error.message.startsWith('one canonical post, draft and receipt target'),error.message);
      rejected=true;
    }
    corruptionResults.push({name,rejected});
    console.log('CANONICAL_CORRUPTION '+JSON.stringify({name,rejected}));
    assertCanonical(canonicalCarousel);
  }
  eq(corruptionResults,corruptions.map(([name])=>({name,rejected:true})),'canonical proof must reject every transactionally rolled-back corruption');
  console.log('CANONICAL_EXACT_PASS '+corruptionResults.length+' rolled-back corruptions');
  // 1. Identical command payloads must use a frozen wall time, not now().
  const d1=freshDraft(),cmd1=command();
  const at=scalar("select (now() at time zone 'UTC'+interval '1 day')::timestamp");
  const same=schedule(d1.id,cmd1,`'${at}'::timestamp`);
  const sameResults=await race('same-command-create',same,same);
  eq(JSON.parse(sameResults[0]),JSON.parse(sameResults[1]),'both callers receive exact recorded result');
  eq(scalar(`select count(*) from private.publication_schedule_commands where command_id='${cmd1}'`),'1');
  const d2=freshDraft();
  await race('distinct-command-create',schedule(d2.id),schedule(d2.id),{bError:'publication_schedule_exists'});
  eq(scalar(`select count(*) from private.publication_schedules where draft_id='${d2.id}'`),'1');
  const edit=d=>`select public.update_my_publication_draft_v1('${d.id}',1,'${command()}','photo','edited','Sin musica','{}',array['${d.source}'::uuid])`;
  const del=d=>`select public.delete_my_publication_draft_v1('${d.id}',1,'${command()}')`;
  const manual=(d,id=command())=>`select public.publish_my_publication_draft_v1('${d.id}',1,'${id}',array['${publicAssets[0]}'::uuid])`;
  for(const [name,write] of [['edit',edit],['delete',del],['manual',manual]]){
    const d=freshDraft();
    await race(`absent-schedule-${name}-wins`,write(d),schedule(d.id),{bError:'publication_draft_conflict'});
    eq(scalar(`select count(*) from private.publication_schedules where draft_id='${d.id}'`),'0','losing creation writes nothing');
    const dFirst=freshDraft();
    const results=await race(`absent-schedule-create-before-${name}`,schedule(dFirst.id),write(dFirst));
    const s=JSON.parse(results[0]);
    eq(scalar(`select count(*) from private.publication_schedules where draft_id='${dFirst.id}'`),'1');
    if(name==='manual'){eq(scalar(`select state from private.publication_schedules where id='${s.id}'`),'cancelled');assertCanonical(s);}
    else{
      const c=claimOne(s);const terminal=sj(fail(c));eq(terminal.state,'terminal_failed');eq(terminal.last_error_code,'draft_changed');assertNoPost(s);
    }
  }

  // 3. A retains all first-batch row locks; B must actively SKIP them.
  const batch=[];for(let i=0;i<11;i++){const s=newSchedule();dueNow(s);batch.push(s);}
  const ca=await connect('claim-A','service_role'),cb=await connect('claim-B','service_role');
  try{
    const a=JSON.parse(ok(await ca.run(claims(999))));
    const b=JSON.parse(ok(await cb.run(claims(999))));
    eq(a.length,10);eq(b.length,1);eq(new Set([...a,...b].map(x=>x.schedule_id)).size,11);
    eq([...a,...b].every(x=>x.attempt_count===1),true);
    // A's uncommitted rows are still invisible to the observer, proving the overlap.
    eq(scalar(`select count(*) from private.publication_schedules where id in(${batch.map(x=>`'${x.id}'`).join(',')}) and state='scheduled'`),'11');
    await ca.close(true);await cb.close(true);
    for(const c of [...a,...b])sj(fail(c,'content_blocked'));
    console.log('RACE_PASS concurrent-claimers-skip-locked');
  }finally{await ca.close();await cb.close();}

  const rejectFence=c=>{
    for(const call of [prep(c),conf(c),fail(c),pub(c)])rejected(sql(`begin;set local role service_role;${call};commit;`,true),'publication_schedule_fence_invalid');
  };
  for(const [name,mutate] of [['cancel',cancel],['reschedule',reschedule]]){
    const s=newSchedule();dueNow(s);
    const a=await connect(`claim-before-${name}`,'service_role'),b=await connect(`${name}-after-claim`,'authenticated',owner);
    try{
      const [c]=JSON.parse(ok(await a.run(claims())));
      const result=b.run(mutate(s,c.revision));await blocked(b,a);await a.close(true);ok(await result);await b.close(true);
      rejectFence(c);eq(scalar(`select generation from private.publication_schedules where id='${s.id}'`),'2');
    }finally{await a.close();await b.close();}
    const reverse=newSchedule();dueNow(reverse);
    const x=await connect(`${name}-first`,'authenticated',owner),y=await connect(`claim-after-${name}`,'service_role');
    try{
      ok(await x.run(mutate(reverse)));eq(JSON.parse(ok(await y.run(claims()))),[],'claim skips locked owner mutation');
      await x.close(true);await y.close(true);eq(sj(claims()),[],'no eligible old generation remains');
    }finally{await x.close();await y.close();}
    console.log('RACE_PASS claim-vs-'+name+'-both-orders');
  }

  // 5. Ordered carousel targets and immutable provider facts survive overlap.
  const carousel=newSchedule(freshDraft([freshSource('carousel_image'),freshSource('carousel_image')],'carousel'));
  const pc=claimOne(carousel);
  const prepared=await race('concurrent-prepare',prep(pc),prep(pc),{aRole:'service_role',bRole:'service_role'});
  eq(JSON.parse(prepared[0]),JSON.parse(prepared[1]));
  eq(JSON.parse(prepared[0]).items.map(x=>x.position),[0,1]);
  eq(scalar(`select count(*) from private.publication_schedule_materializations where schedule_id='${carousel.id}'`),'2');
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${carousel.id}' and event='prepared'`),'1');
  const confirmed=await race('same-fact-confirm',conf(pc),conf(pc),{aRole:'service_role',bRole:'service_role'});
  eq(JSON.parse(confirmed[0]),JSON.parse(confirmed[1]));
  await race('conflicting-fact-confirm',conf(pc,1),conf(pc,1,'b'.repeat(32)),{aRole:'service_role',bRole:'service_role',bError:'publication_schedule_provider_mismatch'});
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${carousel.id}' and event='item_finalized'`),'2');
  eq(scalar(`select bool_and(provider_etag=repeat('a',32)) from private.publication_schedule_materializations where schedule_id='${carousel.id}'`),'t');
  sj(fail(pc,'content_blocked'));

  // 6. Cancellation and canonical publication each win a forced ordering.
  const cancelWinner=newSchedule(),cw=ready(cancelWinner);
  await race('cancel-before-publish',cancel(cancelWinner,cw.c.revision),pub(cw.c),{bRole:'service_role',bError:'publication_schedule_fence_invalid'});
  assertNoPost(cancelWinner);eq(scalar(`select state from private.publication_drafts where id='${cancelWinner.draft_id}'`),'draft');
  eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id='${cancelWinner.draft_id}'`),'1');
  const publishWinner=newSchedule(),pw=ready(publishWinner);
  const won=await race('publish-before-cancel',pub(pw.c),cancel(publishWinner,pw.c.revision),{aRole:'service_role',bError:'publication_schedule_conflict'});
  assertCanonical(publishWinner);eq(sj(pub(pw.c)),JSON.parse(won[0]),'simulated lost response replays committed post');
  eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id='${publishWinner.draft_id}'`),'0');

  // 7. Both B1/manual and B2/scheduled share the canonical receipt transaction.
  const manualWinner=newSchedule(),mw=ready(manualWinner),manualId=command();
  const manualCall=manual({id:manualWinner.draft_id},manualId);
  const mr=await race('manual-before-scheduled',manualCall,pub(mw.c),{bRole:'service_role',bError:'publication_schedule_fence_invalid'});
  eq(userScalar(manualCall),mr[0],'manual winner receipt replay');assertCanonical(manualWinner);
  const scheduledWinner=newSchedule(),sw=ready(scheduledWinner);
  const sr=await race('scheduled-before-manual',pub(sw.c),manual({id:scheduledWinner.draft_id}),{aRole:'service_role',bError:'publication_draft_revision_conflict'});
  assertCanonical(scheduledWinner);eq(sj(pub(sw.c)),JSON.parse(sr[0]));

  // 8a. Failure and publication cannot both commit on one fence.
  const failureWinner=newSchedule(),fw=ready(failureWinner);
  await race('failure-before-publish',fail(fw.c),pub(fw.c),{aRole:'service_role',bRole:'service_role',bError:'publication_schedule_fence_invalid'});
  assertNoPost(failureWinner);
  // Keep this retry out of subsequent isolated due fixtures.
  sql(`update private.publication_schedules set next_attempt_at=now()+interval '1 day' where id='${failureWinner.id}'`);
  const publicationWinner=newSchedule(),fp=ready(publicationWinner);
  await race('publish-before-failure',pub(fp.c),fail(fp.c),{aRole:'service_role',bRole:'service_role',bError:'publication_schedule_fence_invalid'});
  assertCanonical(publicationWinner);

  // 8b. Advance only a disposable clock at a verified in-flight lock barrier.
  // No sleeps, production clock parameter, or on-disk SQL rewriting is used.
  sql(`create table private.proof_clock(value timestamptz); insert into private.proof_clock values(clock_timestamp());
    create function private.proof_now() returns timestamptz language sql volatile as $clock$ select value from private.proof_clock $clock$`);
  for(const [name,call,signature] of [
    ['prepare',prep,'public.prepare_publication_schedule_v1(uuid,bigint,uuid)'],
    ['confirm',conf,'public.confirm_publication_schedule_item_v1(uuid,bigint,uuid,integer,bigint,text,text,text)'],
    ['fail',fail,'public.fail_publication_schedule_v1(uuid,bigint,uuid,text,boolean)'],
    ['publish',pub,'public.publish_publication_schedule_v1(uuid,bigint,uuid)'],
  ]){
    const s=newSchedule(),c=claimOne(s);
    if(name!=='prepare')sj(prep(c));if(name==='publish')sj(conf(c));
    const definition=scalar(`select pg_get_functiondef('${signature}'::regprocedure)`);
    sql('update private.proof_clock set value=clock_timestamp()');
    sql(definition.replaceAll('pg_catalog.clock_timestamp()','private.proof_now()'));
    const holder=await connect(`expiry-${name}-holder`),worker=await connect(`expiry-${name}-worker`,'service_role');
    const before=scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${s.id}'`);
    const postsBefore=scalar('select count(*) from public.videos');
    try{
      if(name==='publish'){
        sql(`create function private.proof_publication_barrier() returns trigger language plpgsql as $barrier$ begin perform pg_advisory_xact_lock(937513); return new; end $barrier$;
          create trigger proof_publication_barrier after insert on public.videos for each row execute function private.proof_publication_barrier()`);
        ok(await holder.run('select pg_advisory_xact_lock(937513)'));
      }else ok(await holder.run(`select id from public.media_assets where id='${s.source}' for update`));
      const pending=worker.run(call(c));await blocked(worker,holder);
      sql("update private.proof_clock set value=clock_timestamp()+interval '3 minutes'");
      await holder.close(true);rejected(await pending,'publication_schedule_fence_invalid');await worker.close();
      eq(scalar('select count(*) from public.videos'),postsBefore,'lease overrun rolls back any inserted post');
      eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${s.id}'`),before,'lease overrun rolls back all audit writes');
      assertNoPost(s);
      if(name==='prepare')eq(scalar(`select count(*) from private.publication_schedule_materializations where schedule_id='${s.id}'`),'0');
      if(name==='confirm')eq(scalar(`select count(*) from private.publication_schedule_materializations where schedule_id='${s.id}' and finalized_at is not null`),'0');
    }finally{
      await holder.close();await worker.close();sql(definition);
      if(name==='publish')sql('drop trigger proof_publication_barrier on public.videos;drop function private.proof_publication_barrier()');
    }
    sql(`update private.publication_schedules set claim_expires_at=clock_timestamp()-interval '1 second' where id='${s.id}'`);
    eq(sj('select public.reconcile_publication_schedules_v1(10)').recovered,1);
    rejectFence(c);const fresh=claimOne(s);eq(fresh.attempt_count,2);assert.notEqual(fresh.claim_token,c.claim_token);checks++;
    sj(prep(fresh));sj(fail(fresh,'content_blocked'));
    console.log('RACE_PASS lease-crossing-'+name);
  }
  sql('drop function private.proof_now();drop table private.proof_clock');

  // 9. Concurrent wakes/failure reports/owner retries retain one attempt budget.
  const retries=newSchedule();let previousBackoff=0;
  for(let attempt=1;attempt<=5;attempt++){
    dueNow(retries);
    const a=await connect(`retry-${attempt}-A`,'service_role'),b=await connect(`retry-${attempt}-B`,'service_role');
    let c;
    try{
      [c]=JSON.parse(ok(await a.run(claims())));eq(c.attempt_count,attempt);
      eq(JSON.parse(ok(await b.run(claims()))),[],'other concurrent wake cannot steal locked retry');
      await a.close(true);await b.close(true);
    }finally{await a.close();await b.close();}
    const results=await race(`concurrent-failure-${attempt}`,fail(c),fail(c),{aRole:'service_role',bRole:'service_role',bError:'publication_schedule_fence_invalid'});
    const f=JSON.parse(results[0]);eq(f.retryable,attempt<5);
    const backoff=Number(scalar(`select extract(epoch from next_attempt_at-updated_at) from private.publication_schedules where id='${retries.id}'`));
    eq(backoff,[30,60,120,240,480][attempt-1]);assert.ok(backoff>previousBackoff&&backoff<=900);checks++;previousBackoff=backoff;
    if(attempt<5){
      const revision=scalar(`select revision from private.publication_schedules where id='${retries.id}'`);
      const retry=()=>`select public.retry_my_publication_schedule_v1('${retries.id}',${revision},'${command()}')`;
      await race(`concurrent-owner-retry-${attempt}`,retry(),retry(),{bError:'publication_schedule_conflict'});
      rejectFence(c);
    }
  }
  dueNow(retries);eq(sj(claims()),[]);eq(scalar(`select attempt_count||':'||state from private.publication_schedules where id='${retries.id}'`),'5:terminal_failed');
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${retries.id}' and event='claimed'`),'5');
  for(const code of ['ownership_invalid','fingerprint_mismatch','integrity_failed']){
    const s=newSchedule(),c=claimOne(s);
    const results=await race('terminal-'+code,fail(c,code),fail(c),{aRole:'service_role',bRole:'service_role',bError:'publication_schedule_fence_invalid'});
    const f=JSON.parse(results[0]);eq([f.state,f.retryable,f.last_error_code],['terminal_failed',false,code]);
  }

  // 10. Claimed drafts can change only behind the same gate; stale bytes fail.
  for(const [name,write] of [['edit',edit],['delete',del]]){
    const s=newSchedule(),r=ready(s);
    await race(`claimed-draft-${name}`,write({id:s.draft_id,source:s.source}),pub(r.c),{bRole:'service_role',bError:'publication_schedule_draft_changed'});
    const result=sj(fail(r.c));eq([result.state,result.last_error_code],['terminal_failed','draft_changed']);assertNoPost(s);
  }
  const lostSource=newSchedule(),ls=ready(lostSource);
  await race('source-deletion-before-publish',`update public.media_assets set status='deleted' where id='${lostSource.source}'`,pub(ls.c),{aRole:'postgres',bRole:'service_role',bError:'publication_schedule_identity_conflict'});
  eq(sj(fail(ls.c)).last_error_code,'source_invalid');assertNoPost(lostSource);
  const tampered=newSchedule(),tc=claimOne(tampered),tp=sj(prep(tc));
  await race('target-edit-before-confirm',`update public.media_assets set object_key='tampered-target' where id='${tp.items[0].target_asset_id}'`,conf(tc),{aRole:'postgres',bRole:'service_role',bError:'publication_schedule_identity_conflict'});
  eq(sj(fail(tc)).retryable,false,'server observes corruption despite caller transient label');assertNoPost(tampered);
  const immutableSource=newSchedule(),ic=claimOne(immutableSource);sj(prep(ic));
  rejected(sql(`update public.media_assets set object_key='forged-source' where id='${immutableSource.source}'`,true),'media_asset_ready_identity_immutable');
  eq(scalar(`select object_key from public.media_assets where id='${immutableSource.source}'`),`draft/${immutableSource.source}`);
  sj(fail(ic,'content_blocked'));

  // 11a. Provider guard outlives generation invalidation; real C1 owns cleanup.
  // Keep unrelated historical fixtures outside this test's release window.
  sql("update private.publication_schedule_materializations set provider_write_until=now()+interval '1 day'");
  const guardFixtures=[];
  for(const name of ['cancel','reschedule','published']){
    const s=newSchedule(),c=claimOne(s),p=sj(prep(c));
    eq(scalar(`select provider_write_until=claim_expires_at+interval '3 minutes' from private.publication_schedule_materializations m join private.publication_schedules s on s.id=m.schedule_id where s.id='${s.id}'`),'t');
    if(name==='published'){sj(conf(c));sj(pub(c));}
    else userScalar(name==='cancel'?cancel(s,c.revision):reschedule(s,c.revision));
    guardFixtures.push({name,s,c,p});
  }
  eq(sj('select public.reconcile_publication_schedules_v1(10)'),{recovered:0,released:0});
  for(const {s} of guardFixtures)eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_schedule' and entity_id='${s.id}'`),'1');
  for(const {s,p} of guardFixtures){
    sql(`update private.publication_schedule_materializations set provider_write_until=clock_timestamp()-interval '1 second' where schedule_id='${s.id}'; update public.media_assets set upload_authorization_expires_at=clock_timestamp()-interval '1 second' where id='${p.items[0].target_asset_id}'`);
  }
  eq(sj('select public.reconcile_publication_schedules_v1(10)'),{recovered:0,released:3});
  for(const {name,s,p} of guardFixtures){
    eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_schedule' and entity_id='${s.id}'`),'0');
    eq(scalar(`select status from public.media_assets where id='${p.items[0].target_asset_id}'`),name==='published'?'ready':'delete_pending');
    if(name==='published')assertCanonical(s);
    else{
      eq(scalar(`select status from public.media_assets where id='${s.source}'`),'ready','cleanup never deletes private draft sources');
      eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id='${s.draft_id}' and asset_id='${s.source}'`),'1');
    }
  }
  console.log('RACE_PASS guarded-generation-release-and-published-target-protection');
  // 11b. The literal S1/S4-X, S2/S3-Y topology is unreachable: frozen B1
  // permits only one publication_draft link per private asset. Keep that index
  // intact and prove both rejected edges. The equivalent reachable stress case
  // uses four distinct sources, alternating draft gates, and an independent
  // holder of S3/S4 sources after each reconciler acquired its first full set.
  const uniqueX=freshSource(),uniqueY=freshSource();freshDraft(uniqueX);freshDraft(uniqueY);
  for(const source of [uniqueX,uniqueY])denied(`select public.create_my_publication_draft_v1('${command()}','photo','duplicate shared source','Sin musica','{}',array['${source}'::uuid])`,'publication_draft_media_asset_uidx');
  eq(scalar("select indisunique and indisvalid from pg_index where indexrelid='public.publication_draft_media_asset_uidx'::regclass"),'t');
  for(const mode of ['recover','release']){
    const four=[],targets=[];
    for(let i=0;i<4;i++){
      const source=freshSource('post_image',`${mode==='recover'?'fffffff1':'fffffff2'}-ffff-4fff-bfff-${String(i+1).padStart(12,'0')}`);
      const id=`${mode==='recover'?'81000000':'82000000'}-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
      sql(`alter table private.publication_schedules alter column id set default '${id}'::uuid`);
      try{four.push(newSchedule(freshDraft(source)));}
      finally{sql('alter table private.publication_schedules alter column id set default gen_random_uuid()');}
      const c=claimOne(four[i]),p=sj(prep(c));targets.push(p.items[0].target_asset_id);
      assert.ok(targets[i]<source,'target acquired before contended source');checks++;
      if(mode==='release')userScalar(cancel(four[i],c.revision));
    }
    const ids=four.map(s=>`'${s.id}'`).join(',');
    if(mode==='recover')sql(`update private.publication_schedules set claim_expires_at=clock_timestamp()-interval '1 second' where id in(${ids})`);
    else sql(`update private.publication_schedule_materializations set provider_write_until=clock_timestamp()-interval '1 second' where schedule_id in(${ids});update public.media_assets set upload_authorization_expires_at=clock_timestamp()-interval '1 second' where id in(${targets.map(x=>`'${x}'`).join(',')})`);
    const before=four.map(s=>scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${s.id}'`));
    const triggerTable=mode==='recover'?'private.publication_schedule_attempts':'private.publication_schedule_materializations';
    const condition=mode==='recover'?"new.event='retryable_failed'":"new.released_at is not null and old.released_at is null";
    sql(`create function private.proof_batch_barrier() returns trigger language plpgsql as $barrier$
      begin
        if ${condition} then
          if new.schedule_id='${four[0].id}' then perform pg_advisory_xact_lock(937521); end if;
          if new.schedule_id='${four[1].id}' then perform pg_advisory_xact_lock(937522); end if;
        end if;
        return new;
      end $barrier$;
      create trigger proof_batch_barrier after ${mode==='recover'?'insert':'update'} on ${triggerTable} for each row execute function private.proof_batch_barrier()`);
    const controller=await connect(mode+'-controller'),a=await connect(mode+'-reconciler-A'),b=await connect(mode+'-reconciler-B');
    try{
      ok(await controller.run(`select pg_advisory_lock(937521);select pg_advisory_lock(937522);select id from public.media_assets where id in('${four[2].source}','${four[3].source}') order by id for update`));
      ok(await a.run(`${gate(four[0].draft_id)};${gate(four[2].draft_id)};set local role service_role`));
      ok(await b.run(`${gate(four[1].draft_id)};${gate(four[3].draft_id)};set local role service_role`));
      const pa=a.run('select public.reconcile_publication_schedules_v1(10)'),pb=b.run('select public.reconcile_publication_schedules_v1(10)');
      await blocked(a,controller);await blocked(b,controller);
      // Release only the rendezvous. Keep source row locks held until both
      // reconciliations finish, making all candidate contention deterministic.
      ok(await controller.run('select pg_advisory_unlock(937521);select pg_advisory_unlock(937522)'));
      const [ra,rb]=await Promise.all([pa,pb]);
      const expected=mode==='recover'?{recovered:1,released:0}:{recovered:0,released:1};
      eq(JSON.parse(ok(ra)),expected);eq(JSON.parse(ok(rb)),expected);
      for(let i=2;i<4;i++){
        eq(scalar(`select state from private.publication_schedules where id='${four[i].id}'`),mode==='recover'?'materializing':'cancelled');
        eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${four[i].id}'`),before[i]);
        eq(scalar(`select released_at is null from private.publication_schedule_materializations where schedule_id='${four[i].id}'`),'t');
        eq(scalar(`select status from public.media_assets where id='${targets[i]}'`),'pending');
        eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_schedule' and entity_id='${four[i].id}' and asset_id='${targets[i]}'`),'1','skipped reservation remains intact');
        eq(scalar(`begin;select id from public.media_assets where id='${targets[i]}' for update nowait;rollback`),targets[i],'partial target lock released on candidate rollback');
      }
      await a.close(true);await b.close(true);await controller.close(true);
      eq(sj('select public.reconcile_publication_schedules_v1(10)'),mode==='recover'?{recovered:2,released:0}:{recovered:0,released:2});
      if(mode==='recover')sql(`update private.publication_schedules set next_attempt_at=now()+interval '1 day' where id in(${ids})`);
      eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id in(${four.map(s=>`'${s.draft_id}'`).join(',')})`),'4');
      eq(scalar(`select bool_and(status='ready') from public.media_assets where id in(${four.map(s=>`'${s.source}'`).join(',')})`),'t');
      console.log('RACE_PASS alternating-batches-complete-set-contention-'+mode);
    }finally{
      await controller.close();await a.close();await b.close();
      sql(`drop trigger proof_batch_barrier on ${triggerTable};drop function private.proof_batch_barrier()`);
    }
  }
  // Real shared sources across historical schedules necessarily share one
  // draft gate. A second reconciler must skip both schedules atomically.
  const sameDraft=freshDraft(),historical=[];
  for(let i=0;i<2;i++){
    const s=newSchedule(sameDraft),c=claimOne(s),p=sj(prep(c));userScalar(cancel(s,c.revision));historical.push(s);
    sql(`update private.publication_schedule_materializations set provider_write_until=clock_timestamp()-interval '1 second' where schedule_id='${s.id}';update public.media_assets set upload_authorization_expires_at=clock_timestamp()-interval '1 second' where id='${p.items[0].target_asset_id}'`);
  }
  const hg=await connect('historical-gate-holder'),hr=await connect('historical-reconciler','service_role');
  try{
    ok(await hg.run(gate(sameDraft.id)));eq(JSON.parse(ok(await hr.run('select public.reconcile_publication_schedules_v1(10)'))),{recovered:0,released:0});
    ok(await hg.run('set local role service_role'));eq(JSON.parse(ok(await hg.run('select public.reconcile_publication_schedules_v1(10)'))),{recovered:0,released:2});
    await hg.close(true);await hr.close(true);
    eq(scalar(`select count(*) from public.media_asset_links where entity_type='publication_draft' and entity_id='${sameDraft.id}'`),'1');
    console.log('RACE_PASS shared-historical-source-same-draft-gate-exclusion');
  }finally{await hg.close();await hr.close();}

  // 12. Repeated exact fenced calls and rollback use the same B1 receipt path.
  const repeat=newSchedule(),rr=ready(repeat);
  const repeated=await race('concurrent-exact-publish',pub(rr.c),pub(rr.c),{aRole:'service_role',bRole:'service_role'});
  eq(JSON.parse(repeated[0]),JSON.parse(repeated[1]));assertCanonical(repeat);
  eq(scalar(`select count(*) from private.publication_schedule_attempts where schedule_id='${repeat.id}' and event='published'`),'1');
  const rollback=newSchedule(),rb=ready(rollback),ra=await connect('rollback-publish-A','service_role'),rbSession=await connect('rollback-publish-B','service_role');
  try{
    const discarded=JSON.parse(ok(await ra.run(pub(rb.c))));
    const pending=rbSession.run(pub(rb.c));await blocked(rbSession,ra);await ra.close(false);
    const committed=JSON.parse(ok(await pending));assert.notEqual(committed.post_id,discarded.post_id);checks++;
    assertNoPost(rollback);await rbSession.close(true);
    eq(scalar(`select count(*) from public.videos where id='${discarded.post_id}'`),'0');
    assertCanonical(rollback);eq(sj(pub(rb.c)),committed);
    console.log('RACE_PASS rollback-then-recover-publication');
  }finally{await ra.close();await rbSession.close();}

  // 15. Install the real video trigger -> latest Stories dispatcher -> P3
  // enqueue core -> latest Stories snapshot dispatcher -> B7 owner snapshot.
  // F4 video moderation is asynchronous detection/triage, not a P3 premium
  // synchronous allow/block gate. Empty provider activation markers keep this
  // controlled local fixture offline while real initializer triggers still run.
  const safety=read('supabase/migrations/20260914144028_admin_content_safety_alert_pipeline_v1.sql');
  const b7=read('supabase/migrations/20261010053524_creator_premium_b7_full_functional_commercial_completion.sql');
  const p3=read('supabase/migrations/20261019201914_creator_premium_content_safety_p3_contextual_violence_policy_v2.sql');
  const stories=read('supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql');
  const audio=read('supabase/migrations/20260915130911_admin_content_safety_audio_stt_ai_v1.sql');
  const visual=read('supabase/migrations/20260915162432_admin_content_safety_visual_ai_v1.sql');
  sql(safety.match(/create table private\.content_safety_scans \([\s\S]*?\n\);/)[0]);
  sql(`alter table public.videos add column views_count bigint not null default 0,add column edited_at timestamptz,add column created_at timestamptz not null default clock_timestamp();
    create table private.content_safety_audio_transcripts(id uuid primary key);
    create table private.content_safety_visual_analyses(id uuid primary key)`);
  sql(extractFunction(safety,'create function private.content_safety_sha256('));
  sql(extractFunction(b7,'create or replace function private.content_safety_target_snapshot('));
  sql('alter function private.content_safety_target_snapshot(text,uuid) rename to content_safety_target_snapshot_b1_core');
  sql(extractFunction(stories,'create or replace function private.content_safety_target_snapshot('));
  sql(extractFunction(p3,'create or replace function private.enqueue_content_safety_scan('));
  sql('alter function private.enqueue_content_safety_scan(text,uuid,text) rename to enqueue_content_safety_scan_b1_core');
  sql(extractFunction(stories,'create or replace function private.enqueue_content_safety_scan('));
  sql(extractFunction(safety,'create function private.content_safety_content_trigger('));
  sql(extractFunction(audio,'create function private.initialize_content_safety_audio_for_new_scan('));
  sql(extractFunction(visual,'create function private.initialize_content_safety_visual_for_new_scan('));
  for(const [source,name] of [[safety,'videos_enqueue_content_safety'],[audio,'content_safety_audio_initialize_new_scan'],[visual,'content_safety_visual_initialize_new_scan']]){
    const definition=new RegExp(`create trigger ${name}[\\s\\S]*?;`).exec(source);assert.ok(definition);sql(definition[0]);
  }
  for(const signature of ['private.content_safety_sha256(text)','private.content_safety_target_snapshot(text,uuid)','private.content_safety_target_snapshot_b1_core(text,uuid)','private.enqueue_content_safety_scan(text,uuid,text)','private.enqueue_content_safety_scan_b1_core(text,uuid,text)','private.content_safety_content_trigger()','private.initialize_content_safety_audio_for_new_scan()','private.initialize_content_safety_visual_for_new_scan()'])sql(`revoke all on function ${signature} from public,anon,authenticated,service_role`);
  for(const actor of ['',otherOwner]){
    const s=newSchedule(),r=ready(s);
    const session=await connect(actor?'safety-forged-sub':'safety-null-sub','service_role',actor);
    try{
      eq(ok(await session.run('select coalesce(auth.uid()::text,\'NULL\')')),actor||'NULL');
      ok(await session.run(`set local request.jwt.claim.role='authenticated';set local request.jwt.claims='{"sub":"${otherOwner}","role":"authenticated"}'`));
      const post=JSON.parse(ok(await session.run(pub(r.c))));await session.close(true);
      eq(JSON.parse(scalar(`select jsonb_build_array(v.user_id,scan.owner_user_id,scan.target_type,scan.status,scan.requested_reason) from public.videos v join private.content_safety_scans scan on scan.target_id=v.id where v.id='${post.post_id}'`)),[owner,owner,'video','queued','content_created'],'real trigger uses persisted explicit post owner, never forged/null auth');
      eq(scalar(`select count(*) from private.content_safety_scans where target_id='${post.post_id}'`),'1');
      assertCanonical(s);
    }finally{await session.close();}
  }
  // A failure *inside the real scan enqueue* must roll back the canonical post,
  // receipt and schedule. This disposable CHECK injects a storage rejection;
  // it is not presented as a normative P3 decision for public Feed content.
  const rejectedSafety=newSchedule(),rs=ready(rejectedSafety),postCount=scalar('select count(*) from public.videos');
  sql(`alter table private.content_safety_scans add constraint proof_reject_safety_owner check(owner_user_id<>'${owner}') not valid`);
  try{
    rejected(sql(`begin;set local role service_role;${pub(rs.c)};commit`,true),'proof_reject_safety_owner');
    assertNoPost(rejectedSafety);eq(scalar('select count(*) from public.videos'),postCount);
    eq(scalar(`select state from private.publication_schedules where id='${rejectedSafety.id}'`),'materializing');
    eq(scalar(`select state from private.publication_drafts where id='${rejectedSafety.draft_id}'`),'draft');
  }finally{sql('alter table private.content_safety_scans drop constraint proof_reject_safety_owner');}
  const safetyPost=sj(pub(rs.c));assertCanonical(rejectedSafety);
  eq(scalar(`select owner_user_id from private.content_safety_scans where target_id='${safetyPost.post_id}'`),owner);
  // Exercise the actual P3 decision-contract validator without repurposing its
  // premium policy as a new public Feed gate. No P3 source or policy is edited.
  sql(extractFunction(p3,'create function private.creator_premium_content_safety_context_result_valid_p3_v1('));
  sql(extractFunction(p3,'create function private.creator_premium_content_safety_policy_p1_v2('));
  const context={schema_version:'creator-premium-context-p3-v1',policy_id:'nelyon.creator_premium.general.p1.v2',certainty_basis:'discrete_contract',coverage:{text:'complete',visual:'complete',transcript:'not_applicable'},uncertainty:'unambiguous',age_uncertainty:'not_relevant',consent_uncertainty:'not_relevant',weapon_state:'not_observed',law_enforcement_state:'not_observed',violence_state:'none_observed'};
  const p3Valid=value=>scalar(`select private.creator_premium_content_safety_context_result_valid_p3_v1('${JSON.stringify(value)}'::jsonb,'not_applicable')`);
  const allow={...context,decision:'allow',categories:['education'],rationale_codes:['educational_context']};
  const review={...context,decision:'review',uncertainty:'ambiguous',categories:['contradictory_signals'],rationale_codes:['ambiguous_context']};
  const block={...context,decision:'block',violence_state:'graphic_or_severe',categories:['graphic_murder'],rationale_codes:['severe_explicit_context']};
  eq([p3Valid(allow),p3Valid(review),p3Valid(block)],['t','t','t'],'actual P3 allow/review/block contracts preserved');
  eq(p3Valid({...block,decision:'allow'}),'f');eq(p3Valid({...review,decision:'allow'}),'f');
  eq(p3Valid({...allow,coverage:{...allow.coverage,visual:'incomplete'}}),'f');
  eq(scalar("select private.creator_premium_content_safety_policy_p1_v2()#>>'{scope,public_feed_policy_changed}'"),'false');
  sql('revoke all on function private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text),private.creator_premium_content_safety_policy_p1_v2() from public,anon,authenticated,service_role');
  console.log('CONTENT_SAFETY_PASS explicit-owner-null-and-forged-auth real-trigger-chain P3-contracts');

  // 13/14. Execute security boundaries under real roles; JWT text grants none.
  sql(read('tests/fixtures/web-control-centers-b2-security.sql'));checks++;
  const security=newSchedule(),sec=claimOne(security);
  const serviceCalls=[claims(),prep(sec),conf(sec),pub(sec),fail(sec),'select public.reconcile_publication_schedules_v1(10)'];
  for(const role of ['anon','authenticated']){
    for(const call of serviceCalls)rejected(sql(`set session authorization ${role};set request.jwt.claim.sub='${owner}';set request.jwt.claim.role='service_role';set request.jwt.claims='{"sub":"${owner}","role":"service_role"}';${call}`,true),'permission denied');
    rejected(sql(`set session authorization ${role};set role service_role;${claims()}`,true),'permission denied');
  }
  for(const call of serviceCalls)rejected(sql(`set request.jwt.claim.role='service_role';set request.jwt.claims='{"role":"service_role"}';${call}`,true),'publication_service_required');
  for(const role of ['anon','authenticated','service_role']){
    for(const table of ['publication_schedule_policy','publication_schedules','publication_schedule_commands','publication_schedule_attempts','publication_schedule_materializations'])rejected(sql(`set session authorization ${role};select * from private.${table}`,true),'permission denied');
    for(const call of [`select private.create_media_post_as_actor_v1('${owner}','photo','','',array['${publicAssets[0]}'::uuid])`,`select private.publish_publication_draft_as_actor_v1('${owner}','${security.draft_id}',1,'${command()}',array['${publicAssets[0]}'::uuid])`])rejected(sql(`set session authorization ${role};${call}`,true),'permission denied');
  }
  denied(schedule(security.draft_id),'publication_draft_not_found',otherOwner);
  for(const call of [cancel(security,sec.revision),reschedule(security,sec.revision),`select public.retry_my_publication_schedule_v1('${security.id}',${sec.revision},'${command()}')`])denied(call,'publication_schedule_not_found',otherOwner);
  eq(JSON.parse(userScalar("select coalesce(jsonb_agg(x),'[]'::jsonb) from public.list_my_publication_schedules_v1() x",otherOwner)),[]);
  rejected(sql(`set session authorization anon;${schedule(security.draft_id)}`,true),'permission denied');
  denied(schedule(security.draft_id),'publication_auth_required','');
  // The trusted service session_user branch is also operational without JWT.
  const trusted=sql(`set session authorization service_role;${prep(sec)}`);
  eq(JSON.parse(trusted.stdout.trim()).schedule_id,security.id);sj(fail(sec,'content_blocked'));
  eq(scalar(`select count(*) from pg_proc p where p.proname in ('claim_publication_schedules_v1','prepare_publication_schedule_v1','confirm_publication_schedule_item_v1','publish_publication_schedule_v1','fail_publication_schedule_v1','reconcile_publication_schedules_v1') and p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres' and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')`),'6');
  eq(scalar(`select bool_and(pg_get_userbyid(relowner)='postgres' and relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('publication_schedule_policy','publication_schedules','publication_schedule_commands','publication_schedule_attempts','publication_schedule_materializations')`),'t');
  eq(scalar("select bool_and(not has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=\"\"']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like '%publication%' or p.proname='create_media_post_as_actor_v1')"),'t','all private B1/B2 authority helpers remain private and pinned');
  const projections=JSON.parse(userScalar("select jsonb_agg(x) from public.list_my_publication_schedules_v1(50) x"));
  const fields=['id','draft_id','draft_revision','state','revision','generation','scheduled_for','timezone_name','local_scheduled_at','utc_offset_minutes','attempt_count','max_attempts','next_attempt_at','retryable','last_error_code','post_id','created_at','updated_at'].sort();
  for(const item of projections)eq(Object.keys(item).sort(),fields,'owner projection has no claim/source/target/provider fields');
  for(const table of ['publication_schedule_commands','publication_schedule_attempts']){
    const count=scalar(`select count(*) from private.${table}`);
    rejected(sql(`update private.${table} set created_at=created_at`,true),'publication_schedule_audit_immutable');
    rejected(sql(`delete from private.${table}`,true),'publication_schedule_audit_immutable');
    eq(scalar(`select count(*) from private.${table}`),count);
  }
  eq(scalar(`select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|',p.oid,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,pg_catalog.pg_get_function_arguments(p.oid),pg_catalog.pg_get_function_result(p.oid)),'' order by p.oid)) from pg_catalog.pg_proc p where p.oid in (${b1Oids})`),b1Catalog,'exact B1 signatures/defaults/owners/OIDs/grants/security preserved');
  eq(scalar("select indisunique and indisvalid from pg_index where indexrelid='public.publication_draft_media_asset_uidx'::regclass"),'t','frozen B1 uniqueness was never disabled');
  eq(scalar("select count(*) from pg_stat_activity where datname=current_database() and application_name like '%reconciler%'"),'0','all independent race sessions closed');
  console.log('SECURITY_CATALOG_PASS real-roles forged-claims denied private-tables immutable-audits B1-parity');

  console.log(JSON.stringify({verdict:'B2_CONCURRENCY_DISPOSABLE_PASS',checks,postgres:scalar('show server_version'),elapsedSeconds:Math.round((Date.now()-proofStarted)/1000)}));
} catch(error){failure=error;console.error(error);}
finally {
  for(const session of sessions) { session.child.stdin.end('rollback;\n'); session.child.kill(); await session.done; }
  if(started){invoke('pg_ctl',['-D',cluster,'-w','-t','30','-m','fast','stop'],undefined,true);stopped=invoke('pg_ctl',['-D',cluster,'status'],undefined,true).status===3;}
  assert.ok(stopped||!started,'disposable server did not stop');
  assert.equal(dirname(resolve(cluster)),resolve(scratch));assert.ok(basename(cluster).startsWith('concurrency-proof-'));
  rmSync(cluster,{recursive:true,maxRetries:10,retryDelay:100});
  console.log(`CLEANUP ${JSON.stringify({serverStopped:stopped,directoryRemoved:!existsSync(cluster)})}`);
}
if(failure)throw failure;
