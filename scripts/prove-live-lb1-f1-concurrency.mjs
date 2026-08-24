import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB1_F1_DATABASE_URL;
assert.equal(process.env.LB1_F1_ALLOW_DISPOSABLE, 'true', 'LB1_F1_ALLOW_DISPOSABLE=true is required');
assert.ok(connectionString, 'LB1_F1_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname), 'LB1-F1 proof refuses non-local databases');

const root = new URL('../', import.meta.url);
const baseMigration = await readFile(
  new URL('supabase/migrations/20260823223420_live_lb1_canonical_authority.sql', root),
  'utf8',
);
const fixMigration = await readFile(
  new URL('supabase/migrations/20260824014644_live_lb1_fix_agora_uid_lint.sql', root),
  'utf8',
);

const admin = new Client({ connectionString, ssl: false });
const peers = [];
const evidence = {
  database: { host: target.hostname, port: target.port, database: target.pathname.slice(1) },
  connections: [],
  barriers: [],
  equivalence: null,
  scenarios: {},
  cleanup: null,
};

const bootstrapSql = String.raw`
create extension if not exists pgcrypto;
do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists auth;
create table auth.users(id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable set search_path='' as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.user_profiles(
  id uuid primary key,
  username text,
  avatar_url text
);
create table public.live_sessions(
  id uuid primary key,
  host_id uuid not null,
  title text not null,
  status text not null default 'live',
  viewer_count integer not null default 0,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  last_heartbeat_at timestamptz not null default clock_timestamp(),
  host_disconnected_at timestamptz,
  end_reason text,
  created_at timestamptz not null default clock_timestamp()
);
create table public.live_participants(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id uuid not null,
  agora_uid integer,
  username text,
  role text not null,
  status text not null,
  mic_muted boolean not null default false,
  mic_locked boolean not null default false,
  camera_enabled boolean not null default true,
  floor_granted boolean not null default false,
  floor_started_at timestamptz,
  floor_duration_seconds integer,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(session_id,user_id)
);
create table public.live_control_events(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  target_user_id uuid,
  actor_user_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint live_control_events_event_type_check check(event_type in (
    'request_join','approve_join','reject_join','mute','unmute','lock_mic','unlock_mic',
    'grant_floor','revoke_floor','remove_cohost','timer_start','timer_stop','reaction'
  ))
);
create table public.live_messages(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  message text not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.live_gift_transactions(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  sender_user_id uuid not null,
  receiver_user_id uuid not null,
  gift_id text not null,
  amount_coins integer not null default 0
);
create table public.gift_catalog(id text primary key, active boolean not null default true, enabled boolean not null default true);

create or replace function public.set_live_participants_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger live_participants_set_updated_at before update on public.live_participants
for each row execute function public.set_live_participants_updated_at();

create or replace function public.emit_live_gift_control_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin return new; end $$;
create trigger live_gift_transactions_emit_control_event after insert on public.live_gift_transactions
for each row execute function public.emit_live_gift_control_event();

create or replace function public.start_live_session(p_session_id uuid,p_title text)
returns public.live_sessions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_row public.live_sessions%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated';end if;
 insert into public.live_sessions(id,host_id,title,status,viewer_count)
 values(p_session_id,v_actor,p_title,'live',0) returning * into v_row;return v_row;
end $$;
create or replace function public.heartbeat_live_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.live_sessions set last_heartbeat_at=clock_timestamp(),host_disconnected_at=null
where id=p_session_id and host_id=auth.uid() and status='live';return jsonb_build_object('ok',found);end $$;
create or replace function public.mark_live_session_disconnected(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.live_sessions set host_disconnected_at=clock_timestamp()
where id=p_session_id and host_id=auth.uid() and status='live';return jsonb_build_object('ok',found);end $$;
create or replace function public.end_live_session(p_session_id uuid,p_reason text default 'host_ended') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.live_sessions set status='ended',ended_at=clock_timestamp(),end_reason=p_reason
where id=p_session_id and host_id=auth.uid() and status='live';
return jsonb_build_object('ok',found);end $$;
create or replace function public.recover_host_live_sessions() returns table(closed_count integer,closed_ids uuid[])
language sql security definer set search_path=public,pg_temp as $$ select 0,'{}'::uuid[] $$;
create or replace function public.close_stale_live_sessions() returns table(closed_count integer,closed_ids uuid[])
language sql security definer set search_path=public,pg_temp as $$ select 0,'{}'::uuid[] $$;
create or replace function public.send_live_gift(uuid,text,text) returns integer
language sql security definer set search_path=public,pg_temp as $$ select 1 $$;
grant execute on all functions in schema public to authenticated,anon,service_role;
`;

const metadataSql = `
select p.provolatile,p.proisstrict,p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') settings,
 pg_get_userbyid(p.proowner) owner,
 has_function_privilege('public',p.oid,'EXECUTE') public_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 pg_get_functiondef(p.oid) functiondef
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname='live_agora_uid'
`;
const uuidSamples = [
  '10000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '123e4567-e89b-12d3-a456-426614174000',
];

async function snapshotFunction() {
  const metadata = (await admin.query(metadataSql)).rows[0];
  const values = {};
  for (const id of uuidSamples) {
    values[id] = Number((await admin.query('select private.live_agora_uid($1::uuid) value',[id])).rows[0].value);
  }
  values.NULL = (await admin.query('select private.live_agora_uid(null::uuid) value')).rows[0].value;
  return { metadata, values };
}

async function catalogFingerprint() {
  const result = await admin.query(`
    select jsonb_build_object(
      'tables',(select jsonb_agg(x order by x.table_name) from (
        select table_name,array_agg(column_name||':'||data_type order by ordinal_position) columns
        from information_schema.columns where table_schema='public' group by table_name
      )x),
      'policies',(select coalesce(jsonb_agg(x order by x.tablename,x.policyname),'[]'::jsonb) from (
        select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public'
      )x),
      'grants',(select coalesce(jsonb_agg(x order by x.table_name,x.grantee,x.privilege_type),'[]'::jsonb) from (
        select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public'
      )x),
      'public_functions',(select jsonb_agg(x order by x.proname,x.args) from (
        select p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) def
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      )x)
    ) value
  `);
  return result.rows[0].value;
}

async function peer(label) {
  const client = new Client({ connectionString, ssl: false });
  await client.connect();
  const pid = Number((await client.query('select pg_backend_pid() pid')).rows[0].pid);
  evidence.connections.push({ label, pid });
  peers.push(client);
  return client;
}

async function claim(client,userId) {
  await client.query('reset role');
  await client.query('set role authenticated');
  await client.query(`select set_config('request.jwt.claim.sub',$1,false)`,[userId]);
}

async function race(name,first,second) {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let ready = 0;
  let bothReady;
  const readyPromise = new Promise(resolve => { bothReady = resolve; });
  const runner = async task => {
    ready += 1;
    if (ready === 2) bothReady();
    await barrier;
    return task();
  };
  const a = runner(first);
  const b = runner(second);
  await readyPromise;
  const releasedAt = new Date().toISOString();
  evidence.barriers.push({ name, participants: 2, releasedAt });
  release();
  return Promise.allSettled([a,b]);
}

const value = result => result.value.rows[0]?.value;
const fulfilled = results => results.filter(result => result.status==='fulfilled');
const rejected = results => results.filter(result => result.status==='rejected');

async function addIdentity(id,label) {
  await admin.query('insert into auth.users(id,email)values($1,$2)',[id,`lb1f1-${label}@proof.local`]);
  await admin.query('insert into public.user_profiles(id,username)values($1,$2)',[id,`lb1f1_${label}`]);
}
async function addLive(id,host,title) {
  await admin.query(`insert into public.live_sessions(id,host_id,title,status,viewer_count)values($1,$2,$3,'live',0)`,[id,host,title]);
}

try {
  await admin.connect();
  await admin.query(bootstrapSql);
  await admin.query(baseMigration);
  const before = await snapshotFunction();
  const publicCatalogBefore = await catalogFingerprint();
  assert.match(before.metadata.functiondef,/v_index integer/);
  assert.equal(before.values[uuidSamples[0]],1758552870);

  await admin.query(fixMigration);
  const after = await snapshotFunction();
  const publicCatalogAfter = await catalogFingerprint();
  assert.deepEqual(after.values,before.values,'agora_uid_outputs_changed');
  assert.equal(after.values[uuidSamples[0]],1758552870);
  assert.equal(after.values.NULL,null);
  assert.equal(after.metadata.provolatile,'i');
  assert.equal(after.metadata.proisstrict,true);
  assert.equal(after.metadata.prosecdef,false);
  assert.equal(after.metadata.settings,'search_path=""');
  assert.equal(after.metadata.owner,before.metadata.owner);
  for(const key of ['public_execute','anon_execute','authenticated_execute','service_execute']) {
    assert.equal(after.metadata[key],false,key);
    assert.equal(after.metadata[key],before.metadata[key],`${key}_changed`);
  }
  assert.doesNotMatch(after.metadata.functiondef,/v_index integer/);
  assert.deepEqual(publicCatalogAfter,publicCatalogBefore,'public_catalog_changed');
  evidence.equivalence={before:before.values,after:after.values,metadata:{
    volatility:after.metadata.provolatile,strict:after.metadata.proisstrict,
    securityDefiner:after.metadata.prosecdef,settings:after.metadata.settings,
    owner:after.metadata.owner,acl:{public:after.metadata.public_execute,anon:after.metadata.anon_execute,
      authenticated:after.metadata.authenticated_execute,serviceRole:after.metadata.service_execute},
  }};

  const host=randomUUID(),viewer=randomUUID(),invited=randomUUID(),other=randomUUID();
  for (const [id, label] of [[host,'host'],[viewer,'viewer'],[invited,'invited'],[other,'other']]) {
    await addIdentity(id,label);
  }
  const first=await peer('connection-a'),second=await peer('connection-b');
  assert.notEqual(evidence.connections[0].pid,evidence.connections[1].pid,'connections_not_independent');

  const presenceSession=randomUUID();
  await addLive(presenceSession,host,'presence race');
  await Promise.all([claim(first,viewer),claim(second,viewer)]);
  const entry=await race('simultaneous_presence_enter',
    ()=>first.query('select to_jsonb(public.live_set_participant_presence($1,true)) value',[presenceSession]),
    ()=>second.query('select to_jsonb(public.live_set_participant_presence($1,true)) value',[presenceSession]));
  assert.equal(fulfilled(entry).length,2);
  let state=(await admin.query(`select s.viewer_count,
    count(distinct p.id)filter(where p.user_id=$2 and p.status='active')::int active_rows,
    count(e.*)filter(where e.event_type='presence_enter' and e.actor_user_id=$2)::int events
    from public.live_sessions s left join public.live_participants p on p.session_id=s.id
    left join public.live_control_events e on e.session_id=s.id where s.id=$1 group by s.viewer_count`,
    [presenceSession,viewer])).rows[0];
  assert.deepEqual({viewerCount:state.viewer_count,activeRows:state.active_rows,events:state.events},
    {viewerCount:1,activeRows:1,events:1});
  evidence.scenarios.simultaneousEntry={results:entry.map(x=>x.status),final:state};

  const leave=await race('simultaneous_presence_leave',
    ()=>first.query('select to_jsonb(public.live_set_participant_presence($1,false)) value',[presenceSession]),
    ()=>second.query('select to_jsonb(public.live_set_participant_presence($1,false)) value',[presenceSession]));
  assert.equal(fulfilled(leave).length,2);
  state=(await admin.query(`select s.viewer_count,
    count(distinct p.id)filter(where p.user_id=$2 and p.status='inactive')::int inactive_rows,
    count(e.*)filter(where e.event_type='presence_leave' and e.actor_user_id=$2)::int events
    from public.live_sessions s left join public.live_participants p on p.session_id=s.id
    left join public.live_control_events e on e.session_id=s.id where s.id=$1 group by s.viewer_count`,
    [presenceSession,viewer])).rows[0];
  assert.deepEqual({viewerCount:state.viewer_count,inactiveRows:state.inactive_rows,events:state.events},
    {viewerCount:0,inactiveRows:1,events:1});
  evidence.scenarios.simultaneousLeave={results:leave.map(x=>x.status),final:state};

  await first.query('select public.live_set_participant_presence($1,true)',[presenceSession]);
  const requests=await race('simultaneous_join_request',
    ()=>first.query('select to_jsonb(public.live_request_to_join($1)) value',[presenceSession]),
    ()=>second.query('select to_jsonb(public.live_request_to_join($1)) value',[presenceSession]));
  assert.equal(fulfilled(requests).length,2);
  state=(await admin.query(`select
    count(*)filter(where role='requested' and status='active')::int active_requests,
    (select count(*)::int from public.live_control_events where session_id=$1 and target_user_id=$2 and event_type='request_join') events
    from public.live_participants where session_id=$1 and user_id=$2`,[presenceSession,viewer])).rows[0];
  assert.deepEqual({activeRequests:state.active_requests,events:state.events},{activeRequests:1,events:1});
  evidence.scenarios.simultaneousRequest={results:requests.map(x=>x.status),final:state};

  const inviteSession=randomUUID();
  await addLive(inviteSession,host,'invite race');
  await Promise.all([claim(first,invited),claim(second,invited)]);
  await first.query('select public.live_set_participant_presence($1,true)',[inviteSession]);
  await Promise.all([claim(first,host),claim(second,host)]);
  const invitations=await race('simultaneous_host_invite',
    ()=>first.query('select to_jsonb(public.live_host_invite_participant($1,$2)) value',[inviteSession,invited]),
    ()=>second.query('select to_jsonb(public.live_host_invite_participant($1,$2)) value',[inviteSession,invited]));
  assert.equal(fulfilled(invitations).length,2);
  const inviteIds=fulfilled(invitations).map(value).map(row=>row.id);
  assert.equal(new Set(inviteIds).size,1);
  assert.equal(Number((await admin.query(`select count(*) n from public.live_control_events
    where session_id=$1 and target_user_id=$2 and event_type='host_invite'`,[inviteSession,invited])).rows[0].n),1);
  evidence.scenarios.simultaneousInvite={results:invitations.map(x=>x.status),inviteIds};

  await Promise.all([claim(first,invited),claim(second,invited)]);
  const accepts=await race('simultaneous_invite_accept',
    ()=>first.query('select to_jsonb(public.live_respond_to_host_invite($1,$2,true)) value',[inviteSession,inviteIds[0]]),
    ()=>second.query('select to_jsonb(public.live_respond_to_host_invite($1,$2,true)) value',[inviteSession,inviteIds[0]]));
  assert.equal(fulfilled(accepts).length,2);
  state=(await admin.query(`select
    count(*)filter(where role='cohost' and status='active')::int active_cohosts,
    (select count(*)::int from public.live_control_events where session_id=$1 and target_user_id=$2
      and event_type='host_invite_response' and payload->>'accepted'='true') responses
    from public.live_participants where session_id=$1 and user_id=$2`,[inviteSession,invited])).rows[0];
  assert.deepEqual({activeCohosts:state.active_cohosts,responses:state.responses},{activeCohosts:1,responses:1});
  evidence.scenarios.simultaneousAccept={results:accepts.map(x=>x.status),final:state};

  const endSession=randomUUID();
  await addLive(endSession,host,'end race');
  await Promise.all([claim(first,other),claim(second,other)]);
  await first.query('select public.live_set_participant_presence($1,true)',[endSession]);
  await claim(first,host);await claim(second,other);
  const endRace=await race('end_live_vs_transition',
    ()=>first.query(`select public.end_live_session($1,'host_ended') value`,[endSession]),
    ()=>second.query('select to_jsonb(public.live_request_to_join($1)) value',[endSession]));
  assert.equal(fulfilled(endRace).length+rejected(endRace).length,2);
  assert.equal((await admin.query('select status from public.live_sessions where id=$1',[endSession])).rows[0].status,'ended');
  const postEnd=await second.query('select to_jsonb(public.live_request_to_join($1)) value',[endSession]).then(
    ()=>({denied:false}),error=>({denied:true,code:error.code,message:error.message}));
  assert.equal(postEnd.denied,true);
  evidence.scenarios.endVsTransition={results:endRace.map(x=>x.status),postEnd};

  const controlSession=randomUUID();
  await addLive(controlSession,host,'control race');
  await Promise.all([claim(first,viewer),claim(second,viewer)]);
  await first.query('select public.live_set_participant_presence($1,true)',[controlSession]);
  await first.query('select public.live_request_to_join($1)',[controlSession]);
  await Promise.all([claim(first,host),claim(second,host)]);
  await first.query('select public.live_host_decide_join_request($1,$2,true)',[controlSession,viewer]);
  const removal=await race('control_vs_remove_cohost',
    ()=>first.query(`select to_jsonb(public.live_host_control_participant($1,$2,'mute',null)) value`,[controlSession,viewer]),
    ()=>second.query(`select to_jsonb(public.live_host_control_participant($1,$2,'remove_cohost',null)) value`,[controlSession,viewer]));
  state=(await admin.query('select role,status,mic_muted,mic_locked,camera_enabled from public.live_participants where session_id=$1 and user_id=$2',
    [controlSession,viewer])).rows[0];
  assert.deepEqual(state,{role:'removed',status:'active',mic_muted:true,mic_locked:true,camera_enabled:false});
  const afterRemoval=await first.query(`select public.live_host_control_participant($1,$2,'unmute',null)`,[controlSession,viewer]).then(
    ()=>({denied:false}),error=>({denied:true,code:error.code,message:error.message}));
  assert.equal(afterRemoval.denied,true);
  evidence.scenarios.controlVsRemoval={results:removal.map(x=>x.status),final:state,afterRemoval};

  const timerSession=randomUUID();
  await addLive(timerSession,host,'timer race');
  await claim(first,invited);
  await first.query('select public.live_set_participant_presence($1,true)',[timerSession]);
  await first.query('select public.live_request_to_join($1)',[timerSession]);
  await Promise.all([claim(first,host),claim(second,host)]);
  await first.query('select public.live_host_decide_join_request($1,$2,true)',[timerSession,invited]);
  const timer=await race('timer_vs_mic_lock',
    ()=>first.query(`select to_jsonb(public.live_host_control_participant($1,$2,'timer_start',60)) value`,[timerSession,invited]),
    ()=>second.query(`select to_jsonb(public.live_host_control_participant($1,$2,'lock_mic',null)) value`,[timerSession,invited]));
  assert.equal(fulfilled(timer).length,2);
  state=(await admin.query('select mic_locked,mic_muted,floor_granted,floor_duration_seconds from public.live_participants where session_id=$1 and user_id=$2',
    [timerSession,invited])).rows[0];
  assert.deepEqual(state,{mic_locked:true,mic_muted:true,floor_granted:true,floor_duration_seconds:60});
  const lockedUnmute=await first.query(`select public.live_host_control_participant($1,$2,'unmute',null)`,[timerSession,invited]).then(
    ()=>({denied:false}),error=>({denied:true,code:error.code,message:error.message}));
  assert.equal(lockedUnmute.denied,true);
  await first.query(`select public.live_host_control_participant($1,$2,'unlock_mic',null)`,[timerSession,invited]);
  await first.query(`select public.live_host_control_participant($1,$2,'unmute',null)`,[timerSession,invited]);
  await admin.query(`update public.live_participants set floor_started_at=clock_timestamp()-interval '61 seconds'
    where session_id=$1 and user_id=$2`,[timerSession,invited]);
  await claim(second,invited);
  await second.query('select public.live_enforce_participant_timer($1,$2)',[timerSession,invited]);
  state=(await admin.query('select mic_locked,mic_muted,floor_granted,floor_duration_seconds from public.live_participants where session_id=$1 and user_id=$2',
    [timerSession,invited])).rows[0];
  assert.deepEqual(state,{mic_locked:false,mic_muted:true,floor_granted:false,floor_duration_seconds:60});
  evidence.scenarios.timerVsLock={results:timer.map(x=>x.status),lockedUnmute,final:state};

  await admin.query(`truncate table public.live_control_events,public.live_messages,public.live_gift_transactions,
    public.live_participants,public.live_sessions,public.gift_catalog,public.user_profiles,auth.users restart identity cascade`);
  const cleanup=(await admin.query(`select
    (select count(*)::int from public.live_sessions) sessions,
    (select count(*)::int from public.live_participants) participants,
    (select count(*)::int from public.live_control_events) events,
    (select count(*)::int from auth.users) users`)).rows[0];
  assert.deepEqual(cleanup,{sessions:0,participants:0,events:0,users:0});
  evidence.cleanup=cleanup;
  console.log(JSON.stringify({ok:true,...evidence},null,2));
} finally {
  await Promise.all(peers.map(client=>client.end().catch(()=>{})));
  await admin.end().catch(()=>{});
}
