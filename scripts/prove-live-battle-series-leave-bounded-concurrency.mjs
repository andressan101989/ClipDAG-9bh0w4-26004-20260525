import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const connectionString = process.env.LB4_F5_A_C3_C1_DATABASE_URL;
assert.equal(
  process.env.LB4_F5_A_C3_C1_ALLOW_DISPOSABLE,
  'true',
  'LB4_F5_A_C3_C1_ALLOW_DISPOSABLE=true is required',
);
assert.ok(connectionString, 'LB4_F5_A_C3_C1_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(target.hostname),
  'C3-C1 proof refuses non-local databases',
);

const iterations = Number(process.env.LB4_F5_A_C3_C1_ITERATIONS ?? '20');
assert.ok(Number.isInteger(iterations) && iterations >= 20 && iterations <= 50);
const { Client } = pg;
const makeClient = (applicationName) => new Client({
  connectionString,
  ssl: false,
  application_name: applicationName,
  query_timeout: 1_500,
});
const admin = makeClient('c3c1-admin');
const first = makeClient('c3c1-first');
const second = makeClient('c3c1-second');
const blocker = makeClient('c3c1-blocker');
const observer = makeClient('c3c1-observer');
const senderClient = makeClient('c3c1-sender');
const clients = [admin, first, second, blocker, observer, senderClient];
const platformAccountId = 'c3c1c1c1-0000-4000-8000-000000000001';

const evidence = {
  iterationsPerRace: iterations,
  raceResults: {},
  tableLockMatrix: [],
  nonParticipant: null,
  legacyRuleSetGap: null,
  rejectionWhitelist: {},
  infrastructureErrors: { deadlocks: 0, unexpectedBusy: 0, queryCanceled: 0, timeouts: 0 },
};

const lockClosure = [
  ['auth.users', 'ROW SHARE'],
  ['public.live_sessions', 'ROW SHARE'],
  ['public.live_battles', 'ROW EXCLUSIVE'],
  ['public.live_battle_score_states', 'ROW EXCLUSIVE'],
  ['public.live_battle_series', 'ROW EXCLUSIVE'],
  ['public.live_battle_rematch_requests', 'ROW EXCLUSIVE'],
  ['public.live_battle_public_states', 'ROW EXCLUSIVE'],
  ['public.live_battle_events', 'ROW EXCLUSIVE'],
  ['public.live_battle_rule_sets', 'ROW SHARE'],
  ['public.live_battle_power_states', 'ROW EXCLUSIVE'],
  ['public.live_battle_boost_events', 'ACCESS SHARE'],
  ['public.live_gift_transactions', 'ACCESS SHARE'],
  ['public.live_battle_score_events', 'ACCESS SHARE'],
];

const blockerModeByRequestedMode = new Map([
  ['ACCESS SHARE', 'ACCESS EXCLUSIVE'],
  ['ROW SHARE', 'EXCLUSIVE'],
  ['ROW EXCLUSIVE', 'SHARE'],
]);

const rejectionWhitelist = {
  dualLeave: new Set(),
  leaveVsCancel: new Set(['55000|live_battle_state_changed']),
  leaveVsCompletion: new Set(['55000|live_battle_state_changed']),
  giftFirst: new Set(),
  leaveFirst: new Set(['P0001|live_battle_gift_not_active']),
  acceptVsLeave: new Set([
    '55000|live_battle_rematch_request_not_pending',
    '55000|live_battle_rematch_series_not_open',
  ]),
  betweenRoundsVsDue: new Set(),
};
evidence.rejectionWhitelist = Object.fromEntries(
  Object.entries(rejectionWhitelist).map(([name, values]) => [name, [...values]]),
);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const token = () => randomUUID().replaceAll('-', '');

async function configure(client) {
  await client.query("set lock_timeout = '2s'");
  await client.query("set statement_timeout = '3s'");
}

async function claim(client, actor) {
  await client.query('reset role');
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}

async function operator(client) {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub','',false)");
}

async function addUser(id, label) {
  const unique = token();
  await admin.query(
    `insert into auth.users(
       id,instance_id,aud,role,email,encrypted_password,created_at,updated_at
     ) values(
       $1,'00000000-0000-0000-0000-000000000000',
       'authenticated','authenticated',$2,'proof',clock_timestamp(),clock_timestamp()
     )`,
    [id, `c3c1-${label}-${unique}@proof.local`],
  );
  await admin.query(
    `insert into public.user_profiles(id,username,display_name,is_admin)
     values($1,$2,$3,false)`,
    [id, `c3c1_${unique.slice(0, 20)}`, `C3-C1 ${label}`],
  );
}

async function addSession(id, host, label) {
  await admin.query(
    `insert into public.live_sessions(
       id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at
     ) values(
       $1,$2,$3,'live',0,clock_timestamp()-interval '1 minute',
       clock_timestamp()-interval '1 minute',clock_timestamp()
     )`,
    [id, host, `C3-C1 ${label}`],
  );
}

async function createActiveCase(label, endDelayMs = 300_000) {
  const challenger = randomUUID();
  const opponent = randomUUID();
  const sender = randomUUID();
  const challengerSession = randomUUID();
  const opponentSession = randomUUID();
  await addUser(challenger, `${label}-challenger`);
  await addUser(opponent, `${label}-opponent`);
  await addUser(sender, `${label}-sender`);
  await addSession(challengerSession, challenger, `${label}-challenger`);
  await addSession(opponentSession, opponent, `${label}-opponent`);
  await admin.query(
    `insert into public.ledger_accounts(owner_id,account_type,balance,currency)
     values($1,'user',500,'BDAG')`,
    [sender],
  );
  await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [challenger]);
  const invite = await admin.query(
    'select public.create_live_battle_invite($1,$2,$3) value',
    [opponent, challengerSession, opponentSession],
  );
  const battleId = invite.rows[0].value.id;
  const seriesId = invite.rows[0].value.series_id;
  await admin.query(
    `with timing as (
       select clock_timestamp() now_at,
              clock_timestamp()
                + (($2::integer - 300000) * interval '1 millisecond') start_at
     )
     update public.live_battles
     set status='active', accepted_at=timing.start_at-interval '4 seconds',
         countdown_started_at=timing.start_at-interval '3 seconds',
         scheduled_start_at=timing.start_at, started_at=timing.start_at,
         scheduled_end_at=timing.start_at+interval '5 minutes',
         last_transition_actor_id=null,last_transition_reason='countdown_elapsed',
         version=4,updated_at=timing.now_at
     from timing where id=$1`,
    [battleId, endDelayMs],
  );
  return {
    challenger, opponent, sender, challengerSession, opponentSession,
    battleId, seriesId, label,
  };
}

async function stateSnapshot(value) {
  const result = await admin.query(
    `select jsonb_build_object(
       'battle',(select to_jsonb(b) from public.live_battles b where b.id=$1),
       'score',(select to_jsonb(s) from public.live_battle_score_states s where s.battle_id=$1),
       'series',(select to_jsonb(s) from public.live_battle_series s where s.id=$2),
       'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
         from public.live_battle_events e where e.battle_id=$1),
       'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb)
         from public.live_battle_rematch_requests r where r.series_id=$2),
       'projection',(select coalesce(jsonb_agg(to_jsonb(p) order by p.session_id),'[]'::jsonb)
         from public.live_battle_public_states p where p.battle_id=$1),
       'gifts',(select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at,g.id),'[]'::jsonb)
         from public.live_gift_transactions g where g.battle_id=$1),
       'score_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
         from public.live_battle_score_events e where e.battle_id=$1),
       'financial',(select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at,f.id),'[]'::jsonb)
         from public.financial_transactions f where f.reference_type='live_battle' and f.reference_id=$1::text),
       'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb)
         from public.live_sessions s where s.id in ($3::uuid,$4::uuid)),
       'ledger',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
         from public.ledger_entries e
         where e.metadata->>'fin_txn_id' in (
           select f.id::text from public.financial_transactions f
           where f.reference_type='live_battle' and f.reference_id=$1::text)),
       'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)
         from public.ledger_accounts a
         where a.owner_id in ($5::uuid,$6::uuid,$7::uuid)
            or (a.owner_id is null and a.account_type='platform'))
     ) value`,
    [value.battleId, value.seriesId, value.challengerSession,
      value.opponentSession, value.sender, value.challenger, value.opponent],
  );
  return result.rows[0].value;
}

async function economySnapshot(value) {
  const result = await admin.query(
    `with gifts as (
       select * from public.live_gift_transactions where battle_id=$1
     ), transactions as (
       select f.* from public.financial_transactions f
       join gifts g on g.financial_transaction_id=f.id
     ), entries as (
       select e.* from public.ledger_entries e
       join transactions t on e.metadata->>'fin_txn_id'=t.id::text
     ), involved_accounts as (
       select from_account_id id from transactions
       union select to_account_id from transactions
       union select account_id from entries
       union select id from public.ledger_accounts
         where owner_id in ($2::uuid,$3::uuid)
       union select $4::uuid
     )
     select jsonb_build_object(
       'gifts',(select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at,g.id),'[]'::jsonb) from gifts g),
       'score_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
         from public.live_battle_score_events e where e.battle_id=$1),
       'financial',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]'::jsonb) from transactions t),
       'ledger',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb) from entries e),
       'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)
         from public.ledger_accounts a where a.id in (select id from involved_accounts))
     ) value`,
    [value.battleId, value.sender, value.challenger, platformAccountId],
  );
  return result.rows[0].value;
}

async function summary(value) {
  const result = await admin.query(
    `select
       (select status from public.live_battles where id=$1) battle_status,
       (select count(*)::int from public.live_battle_events
          where battle_id=$1 and to_status in ('completed','cancelled')) terminal_events,
       (select outcome from public.live_battle_score_states where battle_id=$1) outcome,
       (select winner_user_id from public.live_battle_score_states where battle_id=$1) winner,
       (select status from public.live_battle_series where id=$2) series_status,
       (select count(*)::int from public.live_battle_rematch_requests
          where series_id=$2 and status='pending') pending_requests,
       (select count(*)::int from public.live_battles
          where series_id=$2 and round_number=2) round_two_rows,
       (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
       (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
       (select count(*)::int from public.financial_transactions
          where reference_type='live_battle' and reference_id=$1::text) financial`,
    [value.battleId, value.seriesId],
  );
  return result.rows[0];
}

function inspectInfrastructure(results, { allowBusy = false } = {}) {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const code = result.reason?.code;
    const message = result.reason?.message ?? '';
    if (code === '40P01' || /deadlock detected/i.test(message)) {
      evidence.infrastructureErrors.deadlocks += 1;
      assert.fail(message);
    }
    if (code === '55P03' || /lock timeout/i.test(message)) {
      if (!allowBusy) {
        evidence.infrastructureErrors.unexpectedBusy += 1;
        assert.fail(message);
      }
    }
    if (code === '57014') {
      evidence.infrastructureErrors.queryCanceled += 1;
      assert.fail(message);
    }
    if (/statement timeout/i.test(message)) {
      evidence.infrastructureErrors.timeouts += 1;
      assert.fail(message);
    }
  }
}

async function waitForQueryActive(applicationName, queryFragment, timeoutMs = 400) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const active = await admin.query(
      `select pid, query_start, wait_event_type, wait_event
       from pg_catalog.pg_stat_activity
       where application_name=$1 and state='active'
         and query like ('%' || $2 || '%')
       order by query_start desc limit 1`,
      [applicationName, queryFragment],
    );
    if (active.rowCount === 1) return active.rows[0];
    await delay(5);
  }
  assert.fail(`${queryFragment} never became observably active`);
}

async function waitForLeaveActive(timeoutMs = 400) {
  return waitForQueryActive('c3c1-first', 'leave_live_battle_series', timeoutMs);
}

async function observeOverlap(firstApp, firstFragment, secondApp, secondFragment) {
  const [left, right] = await Promise.all([
    waitForQueryActive(firstApp, firstFragment, 650),
    waitForQueryActive(secondApp, secondFragment, 650),
  ]);
  assert.notEqual(left.pid, right.pid);
  return {
    firstPid: left.pid,
    secondPid: right.pid,
    firstQueryStart: left.query_start,
    secondQueryStart: right.query_start,
  };
}

function inspectScenarioResults(scenario, results) {
  const whitelist = rejectionWhitelist[scenario];
  assert.ok(whitelist, `missing whitelist for ${scenario}`);
  let fulfilled = 0;
  let domainRejected = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilled += 1;
      continue;
    }
    const exact = `${result.reason?.code ?? ''}|${result.reason?.message ?? ''}`;
    assert.ok(whitelist.has(exact), `${scenario} unexpected rejection ${exact}`);
    domainRejected += 1;
  }
  inspectInfrastructure(results);
  return { fulfilled, domainRejected };
}

async function releaseBarrier() {
  await blocker.query('commit');
  const released = await blocker.query('select pg_catalog.clock_timestamp() released_at');
  return released.rows[0].released_at;
}

async function lockBattleBarrier(value) {
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query(
    'select id from public.live_battles where id=$1 for update',
    [value.battleId],
  );
}

function recordOverlap(stat, overlap, blockerReleaseAt) {
  stat.overlapsObserved += 1;
  if (stat.samples.length < 2) stat.samples.push({ ...overlap, blockerReleaseAt });
}

async function tryIndependentScopeLocks(value) {
  const deadline = performance.now() + 500;
  let successes = 0;
  while (performance.now() < deadline && successes === 0) {
    await operator(observer);
    await observer.query('begin');
    try {
      await observer.query(
        `select id from auth.users where id in ($1::uuid,$2::uuid)
         order by id for update nowait`,
        [value.challenger, value.opponent],
      );
      await observer.query(
        `select id from public.live_sessions where id in ($1::uuid,$2::uuid)
         order by id for update nowait`,
        [value.challengerSession, value.opponentSession],
      );
      successes += 1;
      await observer.query('rollback');
    } catch (error) {
      await observer.query('rollback');
      assert.equal(error.code, '55P03');
      await delay(2);
    }
  }
  return successes;
}

async function sendGift(value, key) {
  await claim(senderClient, value.sender);
  return senderClient.query(
    'select * from public.send_live_battle_gift($1,$2,$3,$4)',
    [value.battleId, value.challenger, 'lb4_c3_c1_concurrent', key],
  );
}

async function prepareCompletedRound(value, requestKey, expiresInMs = 30_000) {
  await admin.query(
    `with timing as (select clock_timestamp() now_at)
     update public.live_battles
     set status='completed',accepted_at=timing.now_at-interval '304 seconds',
         countdown_started_at=timing.now_at-interval '303 seconds',
         scheduled_start_at=timing.now_at-interval '300 seconds',
         started_at=timing.now_at-interval '300 seconds',scheduled_end_at=timing.now_at,
         ended_at=timing.now_at,last_transition_reason='battle_duration_elapsed',
         version=5,updated_at=timing.now_at
     from timing where id=$1`,
    [value.battleId],
  );
  await admin.query(
    `update public.live_battle_score_states
     set challenger_score=1,opponent_score=0,score_version=1,
         outcome='challenger',winner_user_id=$2,
         finalized_at=clock_timestamp(),updated_at=clock_timestamp()
     where battle_id=$1`,
    [value.battleId, value.challenger],
  );
  await claim(first, value.challenger);
  const request = await first.query(
    'select public.request_live_battle_rematch($1,$2) value',
    [value.battleId, requestKey],
  );
  if (expiresInMs <= 0) {
    await admin.query(
      `update public.live_battle_rematch_requests
       set expires_at=clock_timestamp()-interval '1 millisecond',updated_at=clock_timestamp()
       where id=$1`,
      [request.rows[0].value.id],
    );
    await admin.query(
      `update public.live_battle_series
       set rematch_window_expires_at=clock_timestamp()-interval '1 millisecond',updated_at=clock_timestamp()
       where id=$1`,
      [value.seriesId],
    );
  }
  return request.rows[0].value.id;
}

async function makeElapsed(value) {
  await admin.query(
    `with timing as (select clock_timestamp()-interval '1 millisecond' end_at)
     update public.live_battles
     set accepted_at=timing.end_at-interval '304 seconds',
         countdown_started_at=timing.end_at-interval '303 seconds',
         scheduled_start_at=timing.end_at-interval '300 seconds',
         started_at=timing.end_at-interval '300 seconds',
         scheduled_end_at=timing.end_at,updated_at=timing.end_at
     from timing where id=$1`,
    [value.battleId],
  );
}

function ownerBalance(snapshot, ownerId) {
  const account = snapshot.accounts.find(
    (row) => row.owner_id === ownerId && row.account_type === 'user',
  );
  return Number(account?.balance ?? 0);
}

function accountBalance(snapshot, accountId) {
  return Number(snapshot.accounts.find((row) => row.id === accountId)?.balance ?? 0);
}

async function waitForReleasedPartialLocks(pid, timeoutMs = 500) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const sampled = await observer.query(
      `select activity.wait_event,
              count(lock.*) filter (
                where lock.granted and lock.relation is not null
              )::int granted_closure_locks,
              coalesce(jsonb_agg(jsonb_build_object(
                'relation',namespace.nspname||'.'||relation.relname,
                'mode',lock.mode,'type',lock.locktype
              )) filter (
                where lock.granted and lock.relation is not null
              ),'[]'::jsonb) granted_locks
       from pg_catalog.pg_stat_activity activity
       left join pg_catalog.pg_locks lock on lock.pid=activity.pid
       left join pg_catalog.pg_class relation on relation.oid=lock.relation
       left join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
       where activity.pid=$1
         and (lock.relation is null or
           namespace.nspname||'.'||relation.relname=any($2::text[]))
       group by activity.wait_event`,
      [pid, lockClosure.map(([relation]) => relation)],
    );
    if (sampled.rowCount === 1 && sampled.rows[0].wait_event === 'PgSleep') {
      assert.equal(
        sampled.rows[0].granted_closure_locks,
        0,
        `partial locks retained: ${JSON.stringify(sampled.rows[0].granted_locks)}`,
      );
      return true;
    }
    await delay(2);
  }
  assert.fail(`failed to sample released subtransaction locks for pid ${pid}`);
}

async function runBudgetExhaustion() {
  const value = await createActiveCase('budget');
  const before = await stateSnapshot(value);
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query('select id from public.live_battles where id=$1 for update', [value.battleId]);
  await claim(first, value.challenger);
  const started = performance.now();
  const leavePromise = first.query(
    'select public.leave_live_battle_series($1) value', [value.seriesId],
  );
  await waitForLeaveActive();
  const independentLockSuccesses = await tryIndependentScopeLocks(value);
  const settled = await Promise.allSettled([leavePromise]);
  const elapsedMs = performance.now() - started;
  inspectInfrastructure(settled, { allowBusy: true });
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[0].reason.code, '55P03');
  assert.equal(settled[0].reason.message, 'live_battle_series_leave_busy');
  assert.ok(elapsedMs >= 650 && elapsedMs < 1_500, `busy elapsed ${elapsedMs}`);
  assert.ok(independentLockSuccesses >= 1);
  assert.deepEqual(await stateSnapshot(value), before);
  await blocker.query('rollback');
  const retry = await first.query(
    'select public.leave_live_battle_series($1) value', [value.seriesId],
  );
  assert.equal(retry.rows[0].value.status, 'cancelled');
  evidence.budgetExhaustion = {
    elapsedMs: Math.round(elapsedMs), independentLockSuccesses,
    sqlstate: settled[0].reason.code, message: settled[0].reason.message,
    retryStatus: retry.rows[0].value.status,
  };
}

async function runTableLockMatrix() {
  for (const [relation, requestedMode] of lockClosure) {
    const blockerMode = blockerModeByRequestedMode.get(requestedMode);
    assert.ok(blockerMode, `missing blocker mode for ${requestedMode}`);
    const value = await createActiveCase(`table-${relation.replaceAll('.', '-')}`);
    const before = await stateSnapshot(value);
    await operator(blocker);
    await operator(observer);
    await blocker.query('begin');
    await blocker.query(`lock table ${relation} in ${blockerMode} mode`);
    await claim(first, value.challenger);
    const started = performance.now();
    const leavePromise = first.query(
      'select public.leave_live_battle_series($1) value', [value.seriesId],
    );
    const active = await waitForLeaveActive(650);
    await waitForReleasedPartialLocks(active.pid);
    const settled = await Promise.allSettled([leavePromise]);
    const elapsedMs = performance.now() - started;
    assert.equal(settled[0].status, 'rejected');
    assert.equal(settled[0].reason.code, '55P03');
    assert.equal(settled[0].reason.message, 'live_battle_series_leave_busy');
    assert.notEqual(settled[0].reason.code, '57014');
    assert.doesNotMatch(settled[0].reason.message, /deadlock|query canceled/i);
    assert.ok(elapsedMs >= 650 && elapsedMs < 1_500, `${relation} busy ${elapsedMs}`);
    await blocker.query('rollback');
    assert.deepEqual(await stateSnapshot(value), before);
    const retry = await first.query(
      'select public.leave_live_battle_series($1) value', [value.seriesId],
    );
    assert.equal(retry.rows[0].value.status, 'cancelled');
    evidence.tableLockMatrix.push({
      relation, requestedMode, blockerMode,
      sqlstate: settled[0].reason.code,
      message: settled[0].reason.message,
      elapsedMs: Math.round(elapsedMs), partialLocksReleased: true,
      invariantSnapshot: true, retryStatus: retry.rows[0].value.status,
    });
  }
}

async function runLegacyRuleSetGapProbe() {
  const value = await createActiveCase('legacy-rule-set-gap');
  const before = await stateSnapshot(value);
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query('lock table public.live_battle_rule_sets in exclusive mode');
  await claim(first, value.challenger);
  const started = performance.now();
  const leavePromise = first.query(
    'select public.leave_live_battle_series($1) value', [value.seriesId],
  );
  const active = await waitForLeaveActive(650);
  await delay(825);
  const escaped = await observer.query(
    `select activity.state,activity.wait_event_type,activity.wait_event,
            lock.mode,lock.granted
     from pg_catalog.pg_stat_activity activity
     join pg_catalog.pg_locks lock on lock.pid=activity.pid
     join pg_catalog.pg_class relation on relation.oid=lock.relation
     join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
     where activity.pid=$1 and namespace.nspname='public'
       and relation.relname='live_battle_rule_sets'
       and lock.mode='RowShareLock' and not lock.granted`,
    [active.pid],
  );
  const observedAtMs = performance.now() - started;
  assert.equal(escaped.rowCount, 1);
  assert.equal(escaped.rows[0].state, 'active');
  assert.equal(escaped.rows[0].wait_event_type, 'Lock');
  assert.equal(escaped.rows[0].mode, 'RowShareLock');
  assert.equal(escaped.rows[0].granted, false);
  assert.ok(observedAtMs > 750 && observedAtMs < 1_500);
  await blocker.query('rollback');
  const settled = await Promise.allSettled([leavePromise]);
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[0].reason.code, '55P03');
  assert.equal(settled[0].reason.message, 'live_battle_series_leave_busy');
  assert.deepEqual(await stateSnapshot(value), before);
  evidence.legacyRuleSetGap = {
    requestedImplicitMode: escaped.rows[0].mode,
    blockerMode: 'EXCLUSIVE',
    observedAtMs: Math.round(observedAtMs),
    activePast750ms: true,
    sqlstateAfterRelease: settled[0].reason.code,
    messageAfterRelease: settled[0].reason.message,
    invariantSnapshot: true,
  };
}

async function runEarlyNonParticipantRejection() {
  const value = await createActiveCase('non-participant');
  const before = await stateSnapshot(value);
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query(
    'select id from public.live_battles where id=$1 for update',
    [value.battleId],
  );

  await claim(first, value.sender);
  const started = performance.now();
  const settled = await Promise.allSettled([
    first.query(
      'select public.leave_live_battle_series($1) value',
      [value.seriesId],
    ),
  ]);
  const elapsedMs = performance.now() - started;
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[0].reason.code, '42501');
  assert.equal(settled[0].reason.message, 'live_battle_series_not_participant');
  assert.notEqual(settled[0].reason.message, 'live_battle_series_leave_busy');
  assert.ok(elapsedMs < 500, `non-participant rejection elapsed ${elapsedMs}`);
  assert.deepEqual(await stateSnapshot(value), before);

  await blocker.query('rollback');
  await claim(first, value.challenger);
  const retry = await first.query(
    'select public.leave_live_battle_series($1) value',
    [value.seriesId],
  );
  assert.equal(retry.rows[0].value.status, 'cancelled');
  evidence.nonParticipant = {
    blockedHostRow: `public.live_battles:${value.battleId}`,
    sqlstate: settled[0].reason.code,
    message: settled[0].reason.message,
    elapsedMs: Math.round(elapsedMs),
    invariantSnapshot: true,
    legitimateRetryStatus: retry.rows[0].value.status,
  };
}

async function runDeadlineCrossing() {
  const value = await createActiveCase('deadline-cross');
  const gift = await sendGift(value, `deadline-${token()}`);
  const giftId = gift.rows[0].transaction_id;
  const beforeBlock = await economySnapshot(value);
  const scheduled = await admin.query(
    `with timing as (
       select pg_catalog.clock_timestamp() + interval '500 milliseconds' end_at
     )
     update public.live_battles
     set accepted_at=timing.end_at-interval '304 seconds',
         countdown_started_at=timing.end_at-interval '303 seconds',
         scheduled_start_at=timing.end_at-interval '300 seconds',
         started_at=timing.end_at-interval '300 seconds',
         scheduled_end_at=timing.end_at,
         updated_at=pg_catalog.clock_timestamp()
     from timing where id=$1 returning scheduled_end_at`,
    [value.battleId],
  );
  const scheduledEndAt = scheduled.rows[0].scheduled_end_at;
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query('select id from public.live_battles where id=$1 for update', [value.battleId]);
  await claim(first, value.challenger);
  const leavePromise = first.query(
    'select public.leave_live_battle_series($1) value', [value.seriesId],
  );
  const active = await waitForLeaveActive(650);
  const queryStart = active.query_start;
  await blocker.query(
    `select pg_catalog.pg_sleep_until($1::timestamptz + interval '50 milliseconds')`,
    [scheduledEndAt],
  );
  const blockerReleaseAt = await releaseBarrier();
  const leave = await leavePromise;
  const budgetEndsAt = new Date(new Date(queryStart).getTime() + 750);
  assert.ok(new Date(queryStart) < new Date(scheduledEndAt));
  assert.ok(new Date(scheduledEndAt) < new Date(blockerReleaseAt));
  assert.ok(new Date(blockerReleaseAt) < budgetEndsAt);
  assert.equal(leave.rows[0].value.status, 'completed');
  const final = await summary(value);
  assert.equal(final.battle_status, 'completed');
  assert.equal(final.outcome, 'challenger');
  assert.equal(final.winner, value.challenger);
  assert.equal(final.series_status, 'completed');
  assert.equal(final.terminal_events, 1);
  assert.deepEqual(await economySnapshot(value), beforeBlock);
  evidence.deadlineCrossing = {
    queryStart, scheduledEndAt, blockerReleaseAt, budgetEndsAt,
    inequalities: {
      queryStartBeforeScheduledEnd: true,
      scheduledEndBeforeBlockerRelease: true,
      blockerReleaseWithin750ms: true,
    },
    giftId, battleStatus: final.battle_status,
    scoreOutcome: final.outcome, winnerPreserved: final.winner === value.challenger,
    terminalEvents: final.terminal_events,
  };
}

async function runRepeatedRaces() {
  const stats = Object.fromEntries([
    'dualLeave','leaveVsCancel','leaveVsCompletion','giftFirst',
    'leaveFirst','acceptVsLeave','betweenRoundsVsDue',
  ].map((name) => [name, {
    iterations: 0, fulfilled: 0, domainRejected: 0,
    overlapsObserved: 0, samples: [],
  }]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const dual = await createActiveCase(`dual-${iteration}`);
    await Promise.all([claim(first, dual.challenger), claim(second, dual.opponent)]);
    await lockBattleBarrier(dual);
    const dualPromises = [
      first.query('select public.leave_live_battle_series($1)', [dual.seriesId]),
      second.query('select public.leave_live_battle_series($1)', [dual.seriesId]),
    ];
    const dualOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-second', 'leave_live_battle_series',
    );
    const dualRelease = await releaseBarrier();
    const dualResults = await Promise.allSettled(dualPromises);
    const dualCounts = inspectScenarioResults('dualLeave', dualResults);
    assert.equal(dualCounts.fulfilled, 2);
    const dualFinal = await summary(dual);
    assert.equal(dualFinal.terminal_events, 1);
    assert.equal(dualFinal.series_status, 'cancelled');
    stats.dualLeave.iterations += 1;
    stats.dualLeave.fulfilled += dualCounts.fulfilled;
    stats.dualLeave.domainRejected += dualCounts.domainRejected;
    recordOverlap(stats.dualLeave, dualOverlap, dualRelease);

    const cancel = await createActiveCase(`cancel-${iteration}`);
    await Promise.all([claim(first, cancel.challenger), claim(second, cancel.opponent)]);
    await lockBattleBarrier(cancel);
    const cancelPromises = [
      first.query('select public.leave_live_battle_series($1)', [cancel.seriesId]),
      second.query('select public.cancel_live_battle($1)', [cancel.battleId]),
    ];
    const cancelOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-second', 'cancel_live_battle',
    );
    const cancelRelease = await releaseBarrier();
    const cancelResults = await Promise.allSettled(cancelPromises);
    const cancelCounts = inspectScenarioResults('leaveVsCancel', cancelResults);
    assert.equal((await summary(cancel)).terminal_events, 1);
    stats.leaveVsCancel.iterations += 1;
    stats.leaveVsCancel.fulfilled += cancelCounts.fulfilled;
    stats.leaveVsCancel.domainRejected += cancelCounts.domainRejected;
    recordOverlap(stats.leaveVsCancel, cancelOverlap, cancelRelease);

    const completion = await createActiveCase(`completion-${iteration}`);
    await makeElapsed(completion);
    await Promise.all([claim(first, completion.challenger), claim(second, completion.opponent)]);
    await lockBattleBarrier(completion);
    const completionPromises = [
      first.query('select public.leave_live_battle_series($1)', [completion.seriesId]),
      second.query('select public.complete_live_battle($1)', [completion.battleId]),
    ];
    const completionOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-second', 'complete_live_battle',
    );
    const completionRelease = await releaseBarrier();
    const completionResults = await Promise.allSettled(completionPromises);
    const completionCounts = inspectScenarioResults('leaveVsCompletion', completionResults);
    const completionFinal = await summary(completion);
    assert.equal(completionFinal.battle_status, 'completed');
    assert.equal(completionFinal.terminal_events, 1);
    stats.leaveVsCompletion.iterations += 1;
    stats.leaveVsCompletion.fulfilled += completionCounts.fulfilled;
    stats.leaveVsCompletion.domainRejected += completionCounts.domainRejected;
    recordOverlap(stats.leaveVsCompletion, completionOverlap, completionRelease);

    const giftFirst = await createActiveCase(`gift-first-${iteration}`);
    const giftBefore = await economySnapshot(giftFirst);
    await Promise.all([claim(first, giftFirst.challenger), claim(senderClient, giftFirst.sender)]);
    const giftFirstGate = 2_000_000 + iteration;
    await operator(observer);
    await observer.query('select pg_catalog.pg_advisory_lock($1)', [giftFirstGate]);
    await lockBattleBarrier(giftFirst);
    const giftKey = `gift-first-${iteration}-${token()}`;
    const queuedGift = senderClient.query(
      'select * from public.send_live_battle_gift($1,$2,$3,$4)',
      [giftFirst.battleId, giftFirst.challenger, 'lb4_c3_c1_concurrent', giftKey],
    );
    await waitForQueryActive('c3c1-sender', 'send_live_battle_gift');
    const queuedLeave = first.query(
      `with barrier as materialized (
         select pg_catalog.pg_advisory_xact_lock($2) gate
       )
       select public.leave_live_battle_series($1) from barrier`,
      [giftFirst.seriesId, giftFirstGate],
    );
    const giftOverlap = await observeOverlap(
      'c3c1-sender', 'send_live_battle_gift',
      'c3c1-first', 'leave_live_battle_series',
    );
    const giftRelease = await releaseBarrier();
    await queuedGift;
    await observer.query('select pg_catalog.pg_advisory_unlock($1)', [giftFirstGate]);
    const giftResults = await Promise.allSettled([queuedGift, queuedLeave]);
    const giftCounts = inspectScenarioResults('giftFirst', giftResults);
    assert.equal(giftCounts.fulfilled, 2);
    const giftResult = giftResults[0].value;
    const economyAfterGift = await economySnapshot(giftFirst);
    assert.deepEqual(await economySnapshot(giftFirst), economyAfterGift);
    assert.equal(economyAfterGift.gifts.length, giftBefore.gifts.length + 1);
    assert.equal(economyAfterGift.score_events.length, giftBefore.score_events.length + 1);
    assert.equal(economyAfterGift.financial.length, giftBefore.financial.length + 1);
    assert.equal(economyAfterGift.ledger.length, giftBefore.ledger.length + 3);
    const createdGift = economyAfterGift.gifts.find(
      (row) => !giftBefore.gifts.some((before) => before.id === row.id),
    );
    const createdFinancial = economyAfterGift.financial.find(
      (row) => !giftBefore.financial.some((before) => before.id === row.id),
    );
    const createdScore = economyAfterGift.score_events.find(
      (row) => !giftBefore.score_events.some((before) => before.id === row.id),
    );
    assert.equal(createdGift.id, giftResult.rows[0].transaction_id);
    const createdLedger = economyAfterGift.ledger.filter(
      (row) => row.metadata?.fin_txn_id === createdFinancial.id,
    );
    assert.equal(createdGift.idempotency_key, giftKey);
    assert.equal(createdGift.financial_transaction_id, createdFinancial.id);
    assert.equal(createdScore.gift_transaction_id, createdGift.id);
    assert.equal(createdScore.battle_id, giftFirst.battleId);
    assert.equal(createdScore.target_user_id, giftFirst.challenger);
    assert.equal(Number(createdScore.base_points), Number(createdGift.amount_coins));
    assert.equal(Number(createdScore.multiplier), 1);
    assert.equal(Number(createdScore.awarded_points), Number(createdGift.amount_coins));
    assert.equal(createdFinancial.operation_type, 'live_gift');
    assert.equal(createdFinancial.reference_type, 'live_battle');
    assert.equal(createdFinancial.reference_id, giftFirst.battleId);
    assert.equal(
      createdFinancial.idempotency_key,
      `live_battle:${giftFirst.battleId}:${giftKey}`,
    );
    assert.equal(createdFinancial.status, 'completed');
    assert.equal(createdFinancial.currency, 'BDAG');
    assert.equal(Number(createdFinancial.amount), Number(createdGift.amount_coins));
    assert.equal(Number(createdFinancial.fee_amount), Number(createdGift.platform_fee_coins));
    assert.equal(createdLedger.length, 3);
    assert.equal(new Set(createdLedger.map((row) => row.txn_id)).size, 1);
    const senderAccount = economyAfterGift.accounts.find(
      (row) => row.owner_id === giftFirst.sender && row.account_type === 'user',
    );
    const creatorAccount = economyAfterGift.accounts.find(
      (row) => row.owner_id === giftFirst.challenger && row.account_type === 'user',
    );
    const debit = createdLedger.find((row) => row.entry_type === 'debit');
    const creatorCredit = createdLedger.find(
      (row) => row.entry_type === 'credit' && row.account_id === creatorAccount.id,
    );
    const platformCredit = createdLedger.find(
      (row) => row.entry_type === 'credit' && row.account_id === platformAccountId,
    );
    assert.equal(createdFinancial.from_account_id, senderAccount.id);
    assert.equal(createdFinancial.to_account_id, creatorAccount.id);
    assert.equal(debit.account_id, senderAccount.id);
    assert.equal(Number(debit.amount), Number(createdGift.amount_coins));
    assert.equal(Number(creatorCredit.amount), Number(createdGift.creator_amount_coins));
    assert.equal(Number(platformCredit.amount), Number(createdGift.platform_fee_coins));
    assert.equal(
      Number(creatorCredit.amount) + Number(platformCredit.amount) - Number(debit.amount),
      0,
    );
    assert.equal(
      ownerBalance(economyAfterGift, giftFirst.sender) - ownerBalance(giftBefore, giftFirst.sender),
      -Number(createdGift.amount_coins),
    );
    assert.equal(
      ownerBalance(economyAfterGift, giftFirst.challenger) - ownerBalance(giftBefore, giftFirst.challenger),
      Number(createdGift.creator_amount_coins),
    );
    assert.equal(
      accountBalance(economyAfterGift, platformAccountId)
        - accountBalance(giftBefore, platformAccountId),
      Number(createdGift.platform_fee_coins),
    );
    stats.giftFirst.iterations += 1;
    stats.giftFirst.fulfilled += giftCounts.fulfilled;
    stats.giftFirst.domainRejected += giftCounts.domainRejected;
    recordOverlap(stats.giftFirst, giftOverlap, giftRelease);

    const leaveFirst = await createActiveCase(`leave-first-${iteration}`);
    const leaveBaseline = await economySnapshot(leaveFirst);
    await Promise.all([claim(first, leaveFirst.challenger), claim(senderClient, leaveFirst.sender)]);
    const giftGate = 1_000_000 + iteration;
    await operator(observer);
    await observer.query('select pg_catalog.pg_advisory_lock($1)', [giftGate]);
    await lockBattleBarrier(leaveFirst);
    const lateGift = senderClient.query(
      `with barrier as materialized (
         select pg_catalog.pg_advisory_xact_lock($5) gate
       )
       select gift.* from barrier
       cross join lateral public.send_live_battle_gift($1,$2,$3,$4) gift`,
      [leaveFirst.battleId, leaveFirst.challenger, 'lb4_c3_c1_concurrent',
        `leave-first-${iteration}-${token()}`, giftGate],
    );
    await waitForQueryActive('c3c1-sender', 'send_live_battle_gift', 650);
    const firstLeave = first.query(
      'select public.leave_live_battle_series($1)', [leaveFirst.seriesId],
    );
    const leaveFirstOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-sender', 'send_live_battle_gift',
    );
    const leaveFirstRelease = await releaseBarrier();
    const leaveCompleted = await firstLeave;
    await observer.query('select pg_catalog.pg_advisory_unlock($1)', [giftGate]);
    const leaveFirstResults = await Promise.allSettled([firstLeave, lateGift]);
    const leaveFirstCounts = inspectScenarioResults('leaveFirst', leaveFirstResults);
    assert.ok(leaveCompleted.rows[0]);
    assert.equal(leaveFirstResults[0].status, 'fulfilled');
    assert.equal(leaveFirstResults[1].status, 'rejected');
    assert.deepEqual(await economySnapshot(leaveFirst), leaveBaseline);
    stats.leaveFirst.iterations += 1;
    stats.leaveFirst.fulfilled += leaveFirstCounts.fulfilled;
    stats.leaveFirst.domainRejected += leaveFirstCounts.domainRejected;
    recordOverlap(stats.leaveFirst, leaveFirstOverlap, leaveFirstRelease);

    const accept = await createActiveCase(`accept-${iteration}`);
    const requestId = await prepareCompletedRound(accept, randomUUID());
    await Promise.all([claim(first, accept.challenger), claim(second, accept.opponent)]);
    await lockBattleBarrier(accept);
    const acceptPromises = [
      first.query('select public.leave_live_battle_series($1)', [accept.seriesId]),
      second.query("select public.respond_live_battle_rematch($1,'accept')", [requestId]),
    ];
    const acceptOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-second', 'respond_live_battle_rematch',
    );
    const acceptRelease = await releaseBarrier();
    const acceptResults = await Promise.allSettled(acceptPromises);
    const acceptCounts = inspectScenarioResults('acceptVsLeave', acceptResults);
    const acceptFinal = await summary(accept);
    assert.equal(acceptFinal.pending_requests, 0);
    assert.ok(acceptFinal.round_two_rows <= 1);
    const open = await admin.query(
      `select count(*)::int n from public.live_battles
       where series_id=$1 and status in ('pending','accepted','countdown','active')`,
      [accept.seriesId],
    );
    assert.equal(open.rows[0].n, 0);
    stats.acceptVsLeave.iterations += 1;
    stats.acceptVsLeave.fulfilled += acceptCounts.fulfilled;
    stats.acceptVsLeave.domainRejected += acceptCounts.domainRejected;
    recordOverlap(stats.acceptVsLeave, acceptOverlap, acceptRelease);

    const due = await createActiveCase(`due-${iteration}`);
    await prepareCompletedRound(due, randomUUID(), -1);
    await claim(first, due.challenger);
    await operator(second);
    await operator(blocker);
    await blocker.query('begin');
    await blocker.query('lock table public.live_battle_series in access exclusive mode');
    const duePromises = [
      first.query('select public.leave_live_battle_series($1)', [due.seriesId]),
      second.query('select private.reconcile_due_live_battle_series(100)'),
    ];
    const dueOverlap = await observeOverlap(
      'c3c1-first', 'leave_live_battle_series',
      'c3c1-second', 'reconcile_due_live_battle_series',
    );
    const dueRelease = await releaseBarrier();
    const dueResults = await Promise.allSettled(duePromises);
    const dueCounts = inspectScenarioResults('betweenRoundsVsDue', dueResults);
    assert.equal((await summary(due)).series_status, 'completed');
    assert.equal((await summary(due)).pending_requests, 0);
    stats.betweenRoundsVsDue.iterations += 1;
    stats.betweenRoundsVsDue.fulfilled += dueCounts.fulfilled;
    stats.betweenRoundsVsDue.domainRejected += dueCounts.domainRejected;
    recordOverlap(stats.betweenRoundsVsDue, dueOverlap, dueRelease);
  }
  for (const [scenario, stat] of Object.entries(stats)) {
    assert.equal(stat.iterations, iterations, `${scenario} iterations`);
    assert.equal(stat.overlapsObserved, iterations, `${scenario} observable overlaps`);
  }
  evidence.raceResults = stats;
}

await Promise.all(clients.map((client) => client.connect()));
try {
  await Promise.all(clients.map(configure));
  await admin.query(
    `insert into public.ledger_accounts(id,owner_id,account_type,balance,currency)
     values($1,null,'platform',0,'BDAG')
     on conflict (id) do nothing`,
    [platformAccountId],
  );
  await admin.query(
    `insert into public.gift_catalog(id,emoji,label,cost_coins,active,enabled)
     values('lb4_c3_c1_concurrent','C1','C3-C1 concurrency',10,true,true)
     on conflict (id) do update set cost_coins=excluded.cost_coins`,
  );
  if (process.env.LB4_F5_A_C3_C1_PROBE_LEGACY_RULE_SET_GAP === 'true') {
    await runLegacyRuleSetGapProbe();
  } else {
    await runBudgetExhaustion();
    await runTableLockMatrix();
    await runEarlyNonParticipantRejection();
    await runDeadlineCrossing();
    await runRepeatedRaces();
  }
  const duplicateTerminal = await admin.query(
    `select count(*)::int n from (
       select battle_id from public.live_battle_events
       where to_status in ('completed','cancelled')
       group by battle_id having count(*) > 1
     ) duplicate`,
  );
  const orphanScores = await admin.query(
    `select count(*)::int n from public.live_battle_score_events event
     left join public.live_gift_transactions gift on gift.id=event.gift_transaction_id
     where gift.id is null`,
  );
  assert.equal(duplicateTerminal.rows[0].n, 0);
  assert.equal(orphanScores.rows[0].n, 0);
  evidence.global = {
    connections: clients.length,
    duplicateTerminalTransitions: duplicateTerminal.rows[0].n,
    scoreWithoutGift: orphanScores.rows[0].n,
    infrastructureErrors: evidence.infrastructureErrors,
  };
} catch (error) {
  console.error('LB4_C3_C1_C1_HARNESS_FAILURE', error);
  throw error;
} finally {
  await Promise.allSettled(clients.map(async (client) => {
    const closed = await Promise.race([
      client.end().then(() => true),
      delay(1_000).then(() => false),
    ]);
    if (!closed) client.connection?.stream?.destroy();
  }));
}

console.log(JSON.stringify(evidence, null, 2));
