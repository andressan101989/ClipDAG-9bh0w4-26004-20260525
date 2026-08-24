import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB2_DATABASE_URL;
assert.equal(process.env.LB2_ALLOW_DISPOSABLE, 'true', 'LB2_ALLOW_DISPOSABLE=true is required');
assert.ok(connectionString, 'LB2_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname), 'LB2 proof refuses non-local databases');

const migration = await readFile(new URL(
  '../supabase/migrations/20260824025639_live_battles_lb2_state_machine.sql',
  import.meta.url,
), 'utf8');
const correction = await readFile(new URL(
  '../supabase/migrations/20260824034049_live_battles_lb2_f1_session_liveness.sql',
  import.meta.url,
), 'utf8');
const admin = new Client({ connectionString, ssl: false });
const peers = [];
const evidence = {
  database: { host: target.hostname, port: target.port, database: target.pathname.slice(1) },
  connections: [],
  barriers: [],
  negative: {},
  positive: {},
  concurrency: {},
  cleanup: null,
};

const bootstrap = String.raw`
do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end
$$;
create schema auth;
create schema private;
create table auth.users(id uuid primary key,email text unique);
create or replace function auth.uid() returns uuid language sql stable set search_path=''
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.live_sessions(
  id uuid primary key,
  host_id uuid not null references auth.users(id),
  title text not null,
  status text not null check(status in('live','ended')),
  viewer_count integer not null default 0,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz
);
create unique index live_sessions_one_live_per_host_uidx on public.live_sessions(host_id) where status='live';
create or replace function public.end_live_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='live_auth_required'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found then raise exception using errcode='P0002',message='live_session_not_found'; end if;
  if v_session.host_id <> v_actor then raise exception using errcode='42501',message='live_host_required'; end if;
  if v_session.status='ended' and v_session.ended_at is not null then return; end if;
  update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=p_session_id;
end;
$$;
revoke all on function public.end_live_session(uuid) from public,anon,authenticated,service_role;
grant execute on function public.end_live_session(uuid) to authenticated;
create publication supabase_realtime;
`;

async function peer(label) {
  const client = new Client({ connectionString, ssl: false });
  await client.connect();
  const pid = Number((await client.query('select pg_backend_pid() pid')).rows[0].pid);
  evidence.connections.push({ label, pid });
  peers.push(client);
  return client;
}

async function claim(client, userId, role = 'authenticated') {
  await client.query('reset role');
  await client.query(`set role ${role}`);
  await client.query(`select set_config('request.jwt.claim.sub',$1,false)`, [userId ?? '']);
}

async function race(name, first, second) {
  let release;
  let ready = 0;
  let bothReady;
  const barrier = new Promise(resolve => { release = resolve; });
  const readyPromise = new Promise(resolve => { bothReady = resolve; });
  const run = async task => {
    ready += 1;
    if (ready === 2) bothReady();
    await barrier;
    return task();
  };
  const a = run(first);
  const b = run(second);
  await readyPromise;
  evidence.barriers.push({ name, participants: 2, releasedAt: new Date().toISOString() });
  release();
  return Promise.allSettled([a, b]);
}

const fulfilled = results => results.filter(result => result.status === 'fulfilled');
const rejected = results => results.filter(result => result.status === 'rejected');
const value = result => result.value.rows[0].value;

async function denied(promise) {
  return promise.then(
    () => ({ denied: false }),
    error => ({ denied: true, code: error.code, message: error.message }),
  );
}

async function host(label, status = 'live') {
  const userId = await user(label);
  const sessionId = randomUUID();
  await admin.query(`insert into public.live_sessions(id,host_id,title,status,viewer_count,ended_at)
    values($1,$2,$3,$4,0,case when $4='ended' then clock_timestamp() else null end)`,
  [sessionId, userId, label, status]);
  return { userId, sessionId };
}

async function user(label) {
  const userId = randomUUID();
  await admin.query('insert into auth.users(id,email) values($1,$2)', [userId, `${label}-${userId}@proof.local`]);
  return userId;
}

async function pair(label) {
  return { challenger: await host(`${label}-challenger`), opponent: await host(`${label}-opponent`) };
}

async function createInvite(client, battlePair) {
  await claim(client, battlePair.challenger.userId);
  return (await client.query(`select public.create_live_battle_invite($1,$2,$3) value`, [
    battlePair.opponent.userId,
    battlePair.challenger.sessionId,
    battlePair.opponent.sessionId,
  ])).rows[0].value;
}

async function respond(client, actorId, battleId, accept) {
  await claim(client, actorId);
  return (await client.query('select public.respond_live_battle_invite($1,$2) value', [battleId, accept])).rows[0].value;
}

async function state(battleId) {
  return (await admin.query('select * from public.live_battles where id=$1', [battleId])).rows[0];
}

async function eventCount(battleId) {
  return Number((await admin.query('select count(*) n from public.live_battle_events where battle_id=$1', [battleId])).rows[0].n);
}

async function cancellationEvent(battleId) {
  return (await admin.query(`select actor_user_id,from_status,to_status,reason,version
    from public.live_battle_events
    where battle_id=$1 and to_status='cancelled'
    order by version`, [battleId])).rows;
}

async function endSession(client, actorId, sessionId) {
  await claim(client, actorId);
  await client.query('select public.end_live_session($1)', [sessionId]);
}

async function acceptedBattle(client, label) {
  const battlePair = await pair(label);
  const battle = await createInvite(client, battlePair);
  await respond(client, battlePair.opponent.userId, battle.id, true);
  return { battlePair, battleId: battle.id };
}

async function countdownBattle(client, label) {
  const accepted = await acceptedBattle(client, label);
  await claim(client, accepted.battlePair.challenger.userId);
  await client.query('select public.start_live_battle($1)', [accepted.battleId]);
  return accepted;
}

async function makeCountdownElapsed(battleId) {
  await admin.query(`with synthetic_clock as (select clock_timestamp()-interval '4 seconds' as countdown_at)
    update public.live_battles set
    countdown_started_at=synthetic_clock.countdown_at,
    scheduled_start_at=synthetic_clock.countdown_at+interval '3 seconds',
    updated_at=clock_timestamp()
    from synthetic_clock
    where id=$1`, [battleId]);
}

async function makeActiveElapsed(battleId) {
  await admin.query(`with synthetic_clock as (select clock_timestamp()-interval '304 seconds' as countdown_at)
    update public.live_battles set
    countdown_started_at=synthetic_clock.countdown_at,
    scheduled_start_at=synthetic_clock.countdown_at+interval '3 seconds',
    started_at=synthetic_clock.countdown_at+interval '3 seconds',
    scheduled_end_at=synthetic_clock.countdown_at+interval '303 seconds',
    updated_at=clock_timestamp()
    from synthetic_clock
    where id=$1`, [battleId]);
}

try {
  await admin.connect();
  await admin.query(bootstrap);
  await admin.query(migration);
  await admin.query(correction);
  const first = await peer('connection-a');
  const second = await peer('connection-b');
  assert.notEqual(evidence.connections[0].pid, evidence.connections[1].pid);

  const acl = (await admin.query(`select p.proname,pg_get_function_identity_arguments(p.oid) args,
    has_function_privilege('public',p.oid,'execute') public_execute,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_execute,
    p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.proname like '%live_battle%'
    order by n.nspname,p.proname,args`)).rows;
  for (const fn of acl) {
    assert.equal(fn.public_execute, false, `${fn.proname}_public_execute`);
    assert.equal(fn.anon_execute, false, `${fn.proname}_anon_execute`);
    assert.equal(fn.service_execute, false, `${fn.proname}_service_execute`);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
    if (['create_live_battle_invite', 'respond_live_battle_invite', 'start_live_battle',
      'cancel_live_battle', 'complete_live_battle', 'get_live_battle_state'].includes(fn.proname)) {
      assert.equal(fn.authenticated_execute, true, `${fn.proname}_authenticated_execute`);
      assert.equal(fn.prosecdef, true, `${fn.proname}_security_definer`);
    } else {
      assert.equal(fn.authenticated_execute, false, `${fn.proname}_helper_execute`);
    }
  }

  const negativePair = await pair('negative');
  const negativeBattle = await createInvite(first, negativePair);
  await claim(second, null, 'anon');
  evidence.negative.anonRead = await denied(second.query('select * from public.live_battles'));
  evidence.negative.anonRpc = await denied(second.query(
    'select public.get_live_battle_state($1)', [negativeBattle.id],
  ));
  await claim(second, negativePair.challenger.userId);
  evidence.negative.directInsert = await denied(second.query(`insert into public.live_battles(
    challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,status,invite_expires_at,last_transition_reason)
    values($1,$2,$3,$4,'pending',clock_timestamp()+interval '30 seconds','forged')`, [
    negativePair.challenger.userId, negativePair.opponent.userId,
    negativePair.challenger.sessionId, negativePair.opponent.sessionId,
  ]));
  evidence.negative.directUpdate = await denied(second.query(
    `update public.live_battles set status='active' where id=$1`, [negativeBattle.id],
  ));
  evidence.negative.directDelete = await denied(second.query(
    'delete from public.live_battles where id=$1', [negativeBattle.id],
  ));
  const third = await host('negative-third');
  await claim(second, third.userId);
  assert.equal((await second.query('select count(*) n from public.live_battles where id=$1', [negativeBattle.id])).rows[0].n, '0');
  evidence.negative.thirdPartyRead = true;
  evidence.negative.thirdPartyRpc = await denied(second.query(
    'select public.get_live_battle_state($1)', [negativeBattle.id],
  ));
  evidence.negative.thirdPartyRespond = await denied(second.query(
    'select public.respond_live_battle_invite($1,true)', [negativeBattle.id],
  ));
  await claim(second, negativePair.challenger.userId);
  evidence.negative.challengerRespond = await denied(second.query(
    'select public.respond_live_battle_invite($1,true)', [negativeBattle.id],
  ));
  evidence.negative.selfInvite = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$3)', [
      negativePair.challenger.userId,
      negativePair.challenger.sessionId,
      negativePair.opponent.sessionId,
    ],
  ));
  evidence.negative.sameSession = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$2)', [
      negativePair.opponent.userId, negativePair.challenger.sessionId,
    ],
  ));
  const nonHost = await host('negative-non-host');
  await claim(second, nonHost.userId);
  evidence.negative.nonHostInvite = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$3)', [
      negativePair.opponent.userId,
      negativePair.challenger.sessionId,
      negativePair.opponent.sessionId,
    ],
  ));
  const endedPair = await pair('negative-ended');
  await admin.query(`update public.live_sessions set status='ended',ended_at=clock_timestamp()
    where id=$1`, [endedPair.opponent.sessionId]);
  await claim(second, endedPair.challenger.userId);
  evidence.negative.endedSession = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$3)', [
      endedPair.opponent.userId, endedPair.challenger.sessionId, endedPair.opponent.sessionId,
    ],
  ));

  const challengerEndedAtPair = await pair('negative-challenger-ended-at');
  await admin.query(`update public.live_sessions set ended_at=clock_timestamp() where id=$1`,
    [challengerEndedAtPair.challenger.sessionId]);
  await claim(second, challengerEndedAtPair.challenger.userId);
  evidence.negative.challengerEndedAtInvite = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$3)', [
      challengerEndedAtPair.opponent.userId,
      challengerEndedAtPair.challenger.sessionId,
      challengerEndedAtPair.opponent.sessionId,
    ],
  ));
  assert.equal(evidence.negative.challengerEndedAtInvite.message, 'live_battle_session_not_live');

  const opponentEndedAtPair = await pair('negative-opponent-ended-at');
  await admin.query(`update public.live_sessions set ended_at=clock_timestamp() where id=$1`,
    [opponentEndedAtPair.opponent.sessionId]);
  await claim(second, opponentEndedAtPair.challenger.userId);
  evidence.negative.opponentEndedAtInvite = await denied(second.query(
    'select public.create_live_battle_invite($1,$2,$3)', [
      opponentEndedAtPair.opponent.userId,
      opponentEndedAtPair.challenger.sessionId,
      opponentEndedAtPair.opponent.sessionId,
    ],
  ));
  assert.equal(evidence.negative.opponentEndedAtInvite.message, 'live_battle_session_not_live');

  const acceptEndedChallenger = await pair('negative-accept-ended-challenger');
  const acceptEndedChallengerInvite = await createInvite(first, acceptEndedChallenger);
  await admin.query(`update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1`,
    [acceptEndedChallenger.challenger.sessionId]);
  await claim(second, acceptEndedChallenger.opponent.userId);
  evidence.negative.acceptEndedChallenger = await denied(second.query(
    'select public.respond_live_battle_invite($1,true)', [acceptEndedChallengerInvite.id],
  ));
  assert.equal(evidence.negative.acceptEndedChallenger.message, 'live_battle_session_not_live');

  const acceptEndedOpponent = await pair('negative-accept-ended-opponent');
  const acceptEndedOpponentInvite = await createInvite(first, acceptEndedOpponent);
  await admin.query(`update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1`,
    [acceptEndedOpponent.opponent.sessionId]);
  await claim(second, acceptEndedOpponent.opponent.userId);
  evidence.negative.acceptEndedOpponent = await denied(second.query(
    'select public.respond_live_battle_invite($1,true)', [acceptEndedOpponentInvite.id],
  ));
  assert.equal(evidence.negative.acceptEndedOpponent.message, 'live_battle_session_not_live');

  const startEnded = await acceptedBattle(first, 'negative-start-ended');
  await admin.query(`update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1`,
    [startEnded.battlePair.opponent.sessionId]);
  await claim(second, startEnded.battlePair.challenger.userId);
  evidence.negative.startEnded = await denied(second.query(
    'select public.start_live_battle($1)', [startEnded.battleId],
  ));
  assert.equal(evidence.negative.startEnded.message, 'live_battle_session_not_live');

  const startHostChanged = await acceptedBattle(first, 'negative-start-host-changed');
  const replacementHost = await user('negative-replacement-host');
  await admin.query(`update public.live_sessions set host_id=$1 where id=$2`,
    [replacementHost, startHostChanged.battlePair.opponent.sessionId]);
  await claim(second, startHostChanged.battlePair.challenger.userId);
  evidence.negative.startHostChanged = await denied(second.query(
    'select public.start_live_battle($1)', [startHostChanged.battleId],
  ));
  assert.equal(evidence.negative.startHostChanged.message, 'live_battle_host_authority_changed');

  const privateTransitionPair = await pair('negative-private-transition');
  const privateTransitionBattle = await countdownBattle(first, 'negative-private-transition-battle');
  await claim(second, privateTransitionPair.challenger.userId);
  evidence.negative.serverCancellationDirect = await denied(second.query(
    `select private.live_battle_transition($1,'countdown','cancelled',null,
      'session_not_live_before_start',clock_timestamp())`, [privateTransitionBattle.battleId],
  ));

  const rejectPair = await pair('positive-reject');
  const rejectedInvite = await createInvite(first, rejectPair);
  const rejectedState = await respond(first, rejectPair.opponent.userId, rejectedInvite.id, false);
  assert.equal(rejectedState.status, 'rejected');
  assert.equal(rejectedState.version, 2);
  assert.equal(await eventCount(rejectedInvite.id), 2);
  evidence.positive.rejected = { status: rejectedState.status, version: rejectedState.version };

  const cancelPair = await pair('positive-cancel');
  const cancelledInvite = await createInvite(first, cancelPair);
  await claim(first, cancelPair.challenger.userId);
  const cancelledState = (await first.query('select public.cancel_live_battle($1) value', [cancelledInvite.id])).rows[0].value;
  assert.equal(cancelledState.status, 'cancelled');
  assert.equal((await first.query('select public.cancel_live_battle($1) value', [cancelledInvite.id])).rows[0].value.version, 2);
  assert.equal(await eventCount(cancelledInvite.id), 2);
  evidence.positive.cancelled = { status: cancelledState.status, version: cancelledState.version };

  const expiredPair = await pair('positive-expired');
  const expiredInvite = await createInvite(first, expiredPair);
  await admin.query(`update public.live_battles set created_at=clock_timestamp()-interval '31 seconds',
    invite_expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp() where id=$1`, [expiredInvite.id]);
  await claim(first, expiredPair.opponent.userId);
  const expiredState = (await first.query('select public.get_live_battle_state($1) value', [expiredInvite.id])).rows[0].value;
  assert.equal(expiredState.status, 'expired');
  assert.equal(expiredState.version, 2);
  assert.equal(await eventCount(expiredInvite.id), 2);
  evidence.positive.expired = { status: expiredState.status, version: expiredState.version };

  const invitePair = await pair('concurrent-invite');
  await Promise.all([claim(first, invitePair.challenger.userId), claim(second, invitePair.challenger.userId)]);
  let results = await race('same_pair_invites',
    () => first.query('select public.create_live_battle_invite($1,$2,$3) value', [invitePair.opponent.userId, invitePair.challenger.sessionId, invitePair.opponent.sessionId]),
    () => second.query('select public.create_live_battle_invite($1,$2,$3) value', [invitePair.opponent.userId, invitePair.challenger.sessionId, invitePair.opponent.sessionId]));
  assert.equal(fulfilled(results).length, 2);
  const inviteIds = fulfilled(results).map(value).map(row => row.id);
  assert.equal(new Set(inviteIds).size, 1);
  assert.equal(await eventCount(inviteIds[0]), 1);
  evidence.concurrency.samePairInvites = { results: results.map(x => x.status), battleId: inviteIds[0], events: 1 };

  const responsePair = await pair('concurrent-response');
  const responseInvite = await createInvite(first, responsePair);
  await Promise.all([claim(first, responsePair.opponent.userId), claim(second, responsePair.opponent.userId)]);
  results = await race('accept_vs_reject',
    () => first.query('select public.respond_live_battle_invite($1,true) value', [responseInvite.id]),
    () => second.query('select public.respond_live_battle_invite($1,false) value', [responseInvite.id]));
  let final = await state(responseInvite.id);
  assert.ok(['accepted', 'rejected'].includes(final.status));
  assert.equal(final.version, '2');
  assert.equal(await eventCount(responseInvite.id), 2);
  evidence.concurrency.acceptVsReject = { results: results.map(x => x.status), status: final.status, version: Number(final.version) };

  const acceptPair = await pair('concurrent-accept');
  const acceptInvite = await createInvite(first, acceptPair);
  await Promise.all([claim(first, acceptPair.opponent.userId), claim(second, acceptPair.opponent.userId)]);
  results = await race('double_accept',
    () => first.query('select public.respond_live_battle_invite($1,true) value', [acceptInvite.id]),
    () => second.query('select public.respond_live_battle_invite($1,true) value', [acceptInvite.id]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(acceptInvite.id);
  assert.equal(final.status, 'accepted');
  assert.equal(final.version, '2');
  assert.equal(await eventCount(acceptInvite.id), 2);
  evidence.concurrency.doubleAccept = { results: results.map(x => x.status), status: final.status, version: 2 };

  const busyOpponent = await host('concurrent-busy-opponent');
  const busyChallengerA = await host('concurrent-busy-a');
  const busyChallengerB = await host('concurrent-busy-b');
  const busyA = await createInvite(first, { challenger: busyChallengerA, opponent: busyOpponent });
  const busyB = await createInvite(first, { challenger: busyChallengerB, opponent: busyOpponent });
  await Promise.all([claim(first, busyOpponent.userId), claim(second, busyOpponent.userId)]);
  results = await race('one_user_accepts_two_battles',
    () => first.query('select public.respond_live_battle_invite($1,true) value', [busyA.id]),
    () => second.query('select public.respond_live_battle_invite($1,true) value', [busyB.id]));
  assert.equal(fulfilled(results).length, 1);
  assert.equal(rejected(results).length, 1);
  assert.equal(Number((await admin.query(`select count(*) n from public.live_battles where status='accepted'
    and $1 in(challenger_user_id,opponent_user_id)`, [busyOpponent.userId])).rows[0].n), 1);
  evidence.concurrency.participantBusy = { results: results.map(x => x.status), acceptedBattles: 1 };

  const startCancel = await acceptedBattle(first, 'concurrent-start-cancel');
  await claim(first, startCancel.battlePair.challenger.userId);
  await claim(second, startCancel.battlePair.opponent.userId);
  results = await race('start_vs_cancel',
    () => first.query('select public.start_live_battle($1) value', [startCancel.battleId]),
    () => second.query('select public.cancel_live_battle($1) value', [startCancel.battleId]));
  final = await state(startCancel.battleId);
  assert.equal(final.status, 'cancelled');
  assert.equal(await eventCount(startCancel.battleId), Number(final.version));
  evidence.concurrency.startVsCancel = { results: results.map(x => x.status), status: final.status, version: Number(final.version) };

  const endThenReconcile = await countdownBattle(first, 'concurrent-end-then-reconcile');
  await makeCountdownElapsed(endThenReconcile.battleId);
  await endSession(first, endThenReconcile.battlePair.challenger.userId,
    endThenReconcile.battlePair.challenger.sessionId);
  await claim(second, endThenReconcile.battlePair.opponent.userId);
  const endThenResult = (await second.query(
    'select public.get_live_battle_state($1) value', [endThenReconcile.battleId],
  )).rows[0].value;
  assert.equal(endThenResult.status, 'cancelled');
  assert.equal(endThenResult.version, 4);
  assert.equal(endThenResult.last_transition_reason, 'session_not_live_before_start');
  assert.equal(endThenResult.last_transition_actor_id, null);
  let cancellations = await cancellationEvent(endThenReconcile.battleId);
  const canonicalServerCancellationCount = Number((await admin.query(`select count(*) n
    from public.live_battle_events
    where battle_id=$1 and actor_user_id is null
      and from_status='countdown' and to_status='cancelled'
      and reason='session_not_live_before_start'`, [endThenReconcile.battleId])).rows[0].n);
  assert.equal(canonicalServerCancellationCount, 1);
  assert.deepEqual(cancellations.map(row => ({
    actor: row.actor_user_id,
    from: row.from_status,
    to: row.to_status,
    reason: row.reason,
    version: Number(row.version),
  })), [{ actor: null, from: 'countdown', to: 'cancelled', reason: 'session_not_live_before_start', version: 4 }]);
  evidence.concurrency.endThenReconcile = {
    case: 'end_then_reconcile',
    endConnection: evidence.connections[0].pid,
    reconcileConnection: evidence.connections[1].pid,
    status: endThenResult.status,
    version: endThenResult.version,
    reason: endThenResult.last_transition_reason,
    actor: endThenResult.last_transition_actor_id,
    cancellationEvents: canonicalServerCancellationCount,
  };

  const bothEnd = await countdownBattle(first, 'concurrent-both-end');
  await makeCountdownElapsed(bothEnd.battleId);
  await Promise.all([
    claim(first, bothEnd.battlePair.challenger.userId),
    claim(second, bothEnd.battlePair.opponent.userId),
  ]);
  results = await race('both_sessions_end_during_countdown',
    () => first.query('select public.end_live_session($1)', [bothEnd.battlePair.challenger.sessionId]),
    () => second.query('select public.end_live_session($1)', [bothEnd.battlePair.opponent.sessionId]));
  assert.equal(fulfilled(results).length, 2);
  await claim(first, bothEnd.battlePair.challenger.userId);
  const bothEndResult = (await first.query(
    'select public.get_live_battle_state($1) value', [bothEnd.battleId],
  )).rows[0].value;
  assert.equal(bothEndResult.status, 'cancelled');
  assert.equal(bothEndResult.version, 4);
  cancellations = await cancellationEvent(bothEnd.battleId);
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0].actor_user_id, null);
  assert.equal(cancellations[0].reason, 'session_not_live_before_start');
  evidence.concurrency.bothSessionsEnd = {
    results: results.map(x => x.status), status: bothEndResult.status,
    version: bothEndResult.version, cancellationEvents: cancellations.length,
  };

  const doubleAfterEnd = await countdownBattle(first, 'concurrent-double-after-end');
  await makeCountdownElapsed(doubleAfterEnd.battleId);
  await endSession(first, doubleAfterEnd.battlePair.challenger.userId,
    doubleAfterEnd.battlePair.challenger.sessionId);
  await Promise.all([
    claim(first, doubleAfterEnd.battlePair.challenger.userId),
    claim(second, doubleAfterEnd.battlePair.opponent.userId),
  ]);
  results = await race('double_reconcile_after_session_end',
    () => first.query('select public.get_live_battle_state($1) value', [doubleAfterEnd.battleId]),
    () => second.query('select public.get_live_battle_state($1) value', [doubleAfterEnd.battleId]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(doubleAfterEnd.battleId);
  assert.equal(final.status, 'cancelled');
  assert.equal(final.version, '4');
  cancellations = await cancellationEvent(doubleAfterEnd.battleId);
  assert.equal(cancellations.length, 1);
  evidence.concurrency.doubleReconcileAfterEnd = {
    results: results.map(x => x.status), status: final.status,
    version: Number(final.version), cancellationEvents: cancellations.length,
  };

  const reconcileCancel = await countdownBattle(first, 'concurrent-reconcile-cancel');
  await makeCountdownElapsed(reconcileCancel.battleId);
  await endSession(first, reconcileCancel.battlePair.opponent.userId,
    reconcileCancel.battlePair.opponent.sessionId);
  await Promise.all([
    claim(first, reconcileCancel.battlePair.challenger.userId),
    claim(second, reconcileCancel.battlePair.opponent.userId),
  ]);
  results = await race('reconcile_vs_participant_cancel',
    () => first.query('select public.get_live_battle_state($1) value', [reconcileCancel.battleId]),
    () => second.query('select public.cancel_live_battle($1) value', [reconcileCancel.battleId]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(reconcileCancel.battleId);
  assert.equal(final.status, 'cancelled');
  assert.equal(final.version, '4');
  cancellations = await cancellationEvent(reconcileCancel.battleId);
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0].reason, 'session_not_live_before_start');
  assert.equal(cancellations[0].actor_user_id, null);
  evidence.concurrency.reconcileVsParticipantCancel = {
    results: results.map(x => x.status), status: final.status,
    version: Number(final.version), reason: cancellations[0].reason,
    actor: cancellations[0].actor_user_id, cancellationEvents: cancellations.length,
  };

  const changedHostCountdown = await countdownBattle(first, 'negative-countdown-host-changed');
  await makeCountdownElapsed(changedHostCountdown.battleId);
  const countdownReplacementHost = await user('negative-countdown-replacement-host');
  await admin.query('update public.live_sessions set host_id=$1 where id=$2', [
    countdownReplacementHost, changedHostCountdown.battlePair.opponent.sessionId,
  ]);
  await claim(first, changedHostCountdown.battlePair.challenger.userId);
  const changedHostCountdownResult = (await first.query(
    'select public.get_live_battle_state($1) value', [changedHostCountdown.battleId],
  )).rows[0].value;
  assert.equal(changedHostCountdownResult.status, 'cancelled');
  assert.equal(changedHostCountdownResult.last_transition_reason, 'session_not_live_before_start');
  assert.equal(changedHostCountdownResult.last_transition_actor_id, null);
  evidence.negative.countdownHostChanged = {
    denied: true,
    status: changedHostCountdownResult.status,
    reason: changedHostCountdownResult.last_transition_reason,
  };

  const countdown = await countdownBattle(first, 'concurrent-countdown');
  await makeCountdownElapsed(countdown.battleId);
  await claim(first, countdown.battlePair.challenger.userId);
  await claim(second, countdown.battlePair.opponent.userId);
  results = await race('valid_countdown_reconciliation',
    () => first.query('select public.get_live_battle_state($1) value', [countdown.battleId]),
    () => second.query('select public.get_live_battle_state($1) value', [countdown.battleId]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(countdown.battleId);
  assert.equal(final.status, 'active');
  assert.equal(final.version, '4');
  assert.equal(await eventCount(countdown.battleId), 4);
  evidence.concurrency.countdownReconciliation = { results: results.map(x => x.status), status: final.status, version: 4 };

  await makeActiveElapsed(countdown.battleId);
  results = await race('double_completion',
    () => first.query('select public.complete_live_battle($1) value', [countdown.battleId]),
    () => second.query('select public.complete_live_battle($1) value', [countdown.battleId]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(countdown.battleId);
  assert.equal(final.status, 'completed');
  assert.equal(final.version, '5');
  assert.equal(await eventCount(countdown.battleId), 5);
  evidence.concurrency.doubleCompletion = { results: results.map(x => x.status), status: final.status, version: 5 };

  const cancelComplete = await countdownBattle(first, 'concurrent-cancel-complete');
  await makeCountdownElapsed(cancelComplete.battleId);
  await claim(first, cancelComplete.battlePair.challenger.userId);
  await first.query('select public.get_live_battle_state($1)', [cancelComplete.battleId]);
  await makeActiveElapsed(cancelComplete.battleId);
  await claim(second, cancelComplete.battlePair.opponent.userId);
  results = await race('cancel_vs_completion',
    () => first.query('select public.cancel_live_battle($1) value', [cancelComplete.battleId]),
    () => second.query('select public.complete_live_battle($1) value', [cancelComplete.battleId]));
  final = await state(cancelComplete.battleId);
  assert.ok(['cancelled', 'completed'].includes(final.status));
  assert.equal(await eventCount(cancelComplete.battleId), Number(final.version));
  evidence.concurrency.cancelVsCompletion = { results: results.map(x => x.status), status: final.status, version: Number(final.version) };

  const expireAccept = await pair('concurrent-expire-accept');
  const expiring = await createInvite(first, expireAccept);
  await admin.query(`update public.live_battles set created_at=clock_timestamp()-interval '31 seconds',
    invite_expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp() where id=$1`, [expiring.id]);
  await Promise.all([claim(first, expireAccept.opponent.userId), claim(second, expireAccept.opponent.userId)]);
  results = await race('expiry_vs_acceptance',
    () => first.query('select public.respond_live_battle_invite($1,true) value', [expiring.id]),
    () => second.query('select public.get_live_battle_state($1) value', [expiring.id]));
  assert.equal(fulfilled(results).length, 2);
  final = await state(expiring.id);
  assert.equal(final.status, 'expired');
  assert.equal(final.version, '2');
  assert.equal(await eventCount(expiring.id), 2);
  evidence.concurrency.expiryVsAcceptance = { results: results.map(x => x.status), status: final.status, version: 2 };

  const early = await countdownBattle(first, 'negative-early-complete');
  await makeCountdownElapsed(early.battleId);
  await claim(first, early.battlePair.challenger.userId);
  await first.query('select public.get_live_battle_state($1)', [early.battleId]);
  evidence.negative.earlyComplete = await denied(first.query('select public.complete_live_battle($1)', [early.battleId]));
  await claim(first, rejectPair.challenger.userId);
  evidence.negative.terminalRestart = await denied(first.query('select public.start_live_battle($1)', [rejectedInvite.id]));

  const publication = await admin.query(`select count(*) n from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='live_battles'`);
  assert.equal(publication.rows[0].n, '1');
  const liveIntegrity = (await admin.query(`select
    count(*) filter(where status='live')::int live_sessions,
    count(*) filter(where viewer_count<>0)::int changed_viewers
    from public.live_sessions`)).rows[0];
  assert.equal(liveIntegrity.changed_viewers, 0);
  evidence.positive.realtimePublication = true;
  evidence.positive.liveSessionsIntact = liveIntegrity;

  for (const item of Object.values(evidence.negative)) {
    if (typeof item === 'object' && item && 'denied' in item) assert.equal(item.denied, true);
  }

  await admin.query(`truncate table public.live_battle_events,public.live_battles,
    public.live_sessions,auth.users restart identity cascade`);
  const cleanup = (await admin.query(`select
    (select count(*)::int from public.live_battles) battles,
    (select count(*)::int from public.live_battle_events) events,
    (select count(*)::int from public.live_sessions) sessions,
    (select count(*)::int from auth.users) users`)).rows[0];
  assert.deepEqual(cleanup, { battles: 0, events: 0, sessions: 0, users: 0 });
  evidence.cleanup = cleanup;
  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
} finally {
  await Promise.all(peers.map(client => client.end().catch(() => undefined)));
  await admin.end().catch(() => undefined);
}
