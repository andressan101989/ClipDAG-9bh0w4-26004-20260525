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
});
const admin = makeClient('c3c1-admin');
const first = makeClient('c3c1-first');
const second = makeClient('c3c1-second');
const blocker = makeClient('c3c1-blocker');
const observer = makeClient('c3c1-observer');
const senderClient = makeClient('c3c1-sender');
const clients = [admin, first, second, blocker, observer, senderClient];

const evidence = {
  iterationsPerRace: iterations,
  raceResults: {},
  infrastructureErrors: { deadlocks: 0, unexpectedBusy: 0, queryCanceled: 0, timeouts: 0 },
};

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

async function installDisposableLeavePause() {
  await admin.query(`
    create or replace function private.c3c1_disposable_pause_cancel()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if pg_catalog.current_setting('c3c1.pause_leave', true) = 'on' then
        perform pg_catalog.pg_sleep(0.075);
      end if;
      return new;
    end;
    $$;
    drop trigger if exists c3c1_disposable_pause_cancel on public.live_battles;
    create trigger c3c1_disposable_pause_cancel
      before update of status on public.live_battles
      for each row
      when (old.status is distinct from new.status and new.status = 'cancelled')
      execute function private.c3c1_disposable_pause_cancel()
  `);
}

async function removeDisposableLeavePause() {
  await admin.query(`
    drop trigger if exists c3c1_disposable_pause_cancel on public.live_battles;
    drop function if exists private.c3c1_disposable_pause_cancel()
  `);
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
         from public.financial_transactions f where f.reference_type='live_battle' and f.reference_id=$1::text)
     ) value`,
    [value.battleId, value.seriesId],
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
            or account_type in ('platform','treasury')
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
    [value.battleId, value.sender, value.challenger],
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
      `select count(*)::int n from pg_catalog.pg_stat_activity
       where application_name=$1 and state='active'
         and query like ('%' || $2 || '%')`,
      [applicationName, queryFragment],
    );
    if (active.rows[0].n > 0) return;
    await delay(5);
  }
  assert.fail(`${queryFragment} never became observably active`);
}

async function waitForLeaveActive(timeoutMs = 400) {
  await waitForQueryActive('c3c1-first', 'leave_live_battle_series', timeoutMs);
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
  assert.ok(now);
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

function platformBalance(snapshot) {
  return snapshot.accounts
    .filter((row) => ['platform', 'treasury'].includes(row.account_type))
    .reduce((sum, row) => sum + Number(row.balance), 0);
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

async function runDeadlineCrossing() {
  const value = await createActiveCase('deadline-cross', 450);
  const gift = await sendGift(value, `deadline-${token()}`);
  const giftId = gift.rows[0].transaction_id;
  const beforeBlock = await economySnapshot(value);
  await operator(blocker);
  await blocker.query('begin');
  await blocker.query('select id from public.live_battles where id=$1 for update', [value.battleId]);
  await claim(first, value.challenger);
  const started = performance.now();
  const leavePromise = first.query(
    'select public.leave_live_battle_series($1) value', [value.seriesId],
  );
  await waitForLeaveActive();
  const waitMs = 520 - (performance.now() - started);
  if (waitMs > 0) await delay(waitMs);
  await blocker.query('commit');
  const leave = await leavePromise;
  const elapsedMs = performance.now() - started;
  assert.equal(leave.rows[0].value.status, 'completed');
  const final = await summary(value);
  assert.equal(final.battle_status, 'completed');
  assert.equal(final.outcome, 'challenger');
  assert.equal(final.winner, value.challenger);
  assert.equal(final.series_status, 'completed');
  assert.equal(final.terminal_events, 1);
  assert.deepEqual(await economySnapshot(value), beforeBlock);
  evidence.deadlineCrossing = {
    elapsedMs: Math.round(elapsedMs), giftId, battleStatus: final.battle_status,
    scoreOutcome: final.outcome, winnerPreserved: final.winner === value.challenger,
    terminalEvents: final.terminal_events,
  };
}

async function runRepeatedRaces() {
  const stats = Object.fromEntries([
    'dualLeave','leaveVsCancel','leaveVsCompletion','giftFirst',
    'leaveFirst','acceptVsLeave','betweenRoundsVsDue',
  ].map((name) => [name, { iterations: 0, fulfilled: 0, domainRejected: 0 }]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const dual = await createActiveCase(`dual-${iteration}`);
    await Promise.all([claim(first, dual.challenger), claim(second, dual.opponent)]);
    const dualResults = await Promise.allSettled([
      first.query('select public.leave_live_battle_series($1)', [dual.seriesId]),
      second.query('select public.leave_live_battle_series($1)', [dual.seriesId]),
    ]);
    inspectInfrastructure(dualResults);
    assert.equal(dualResults.filter((item) => item.status === 'fulfilled').length, 2);
    const dualFinal = await summary(dual);
    assert.equal(dualFinal.terminal_events, 1);
    assert.equal(dualFinal.series_status, 'cancelled');
    stats.dualLeave.iterations += 1;
    stats.dualLeave.fulfilled += 2;

    const cancel = await createActiveCase(`cancel-${iteration}`);
    await Promise.all([claim(first, cancel.challenger), claim(second, cancel.opponent)]);
    const cancelResults = await Promise.allSettled([
      first.query('select public.leave_live_battle_series($1)', [cancel.seriesId]),
      second.query('select public.cancel_live_battle($1)', [cancel.battleId]),
    ]);
    inspectInfrastructure(cancelResults);
    assert.equal(cancelResults.filter((item) => item.status === 'fulfilled').length, 2);
    assert.equal((await summary(cancel)).terminal_events, 1);
    stats.leaveVsCancel.iterations += 1;
    stats.leaveVsCancel.fulfilled += 2;

    const completion = await createActiveCase(`completion-${iteration}`);
    await makeElapsed(completion);
    await Promise.all([claim(first, completion.challenger), claim(second, completion.opponent)]);
    const completionResults = await Promise.allSettled([
      first.query('select public.leave_live_battle_series($1)', [completion.seriesId]),
      second.query('select public.complete_live_battle($1)', [completion.battleId]),
    ]);
    inspectInfrastructure(completionResults);
    const completionFinal = await summary(completion);
    assert.equal(completionFinal.battle_status, 'completed');
    assert.equal(completionFinal.terminal_events, 1);
    stats.leaveVsCompletion.iterations += 1;
    stats.leaveVsCompletion.fulfilled += completionResults.filter((item) => item.status === 'fulfilled').length;
    stats.leaveVsCompletion.domainRejected += completionResults.filter((item) => item.status === 'rejected').length;

    const giftFirst = await createActiveCase(`gift-first-${iteration}`);
    const giftBefore = await economySnapshot(giftFirst);
    await Promise.all([claim(first, giftFirst.challenger), claim(senderClient, giftFirst.sender)]);
    await operator(blocker);
    await blocker.query('begin');
    await blocker.query('select id from public.live_battles where id=$1 for update', [giftFirst.battleId]);
    const giftKey = `gift-first-${iteration}-${token()}`;
    const queuedGift = senderClient.query(
      'select * from public.send_live_battle_gift($1,$2,$3,$4)',
      [giftFirst.battleId, giftFirst.challenger, 'lb4_c3_c1_concurrent', giftKey],
    );
    await waitForQueryActive('c3c1-sender', 'send_live_battle_gift');
    const queuedLeave = first.query(
      'select public.leave_live_battle_series($1)', [giftFirst.seriesId],
    );
    await waitForLeaveActive();
    await blocker.query('commit');
    const giftResult = await queuedGift;
    const economyAfterGift = await economySnapshot(giftFirst);
    const leaveResult = await Promise.allSettled([queuedLeave]);
    inspectInfrastructure(leaveResult);
    assert.equal(leaveResult[0].status, 'fulfilled');
    assert.deepEqual(await economySnapshot(giftFirst), economyAfterGift);
    assert.equal(economyAfterGift.gifts.length, giftBefore.gifts.length + 1);
    assert.equal(economyAfterGift.score_events.length, giftBefore.score_events.length + 1);
    assert.equal(economyAfterGift.financial.length, giftBefore.financial.length + 1);
    assert.ok(economyAfterGift.ledger.length >= giftBefore.ledger.length + 2);
    assert.equal(economyAfterGift.gifts.at(-1).id, giftResult.rows[0].transaction_id);
    const createdGift = economyAfterGift.gifts.at(-1);
    const createdFinancial = economyAfterGift.financial.at(-1);
    const createdLedger = economyAfterGift.ledger.filter(
      (row) => row.metadata?.fin_txn_id === createdFinancial.id,
    );
    assert.equal(createdGift.idempotency_key, giftKey);
    assert.equal(createdGift.financial_transaction_id, createdFinancial.id);
    assert.ok(createdLedger.length >= 2);
    assert.equal(
      ownerBalance(economyAfterGift, giftFirst.sender) - ownerBalance(giftBefore, giftFirst.sender),
      -Number(createdGift.amount_coins),
    );
    assert.equal(
      ownerBalance(economyAfterGift, giftFirst.challenger) - ownerBalance(giftBefore, giftFirst.challenger),
      Number(createdGift.creator_amount_coins),
    );
    assert.equal(
      platformBalance(economyAfterGift) - platformBalance(giftBefore),
      Number(createdGift.platform_fee_coins),
    );
    stats.giftFirst.iterations += 1;
    stats.giftFirst.fulfilled += 2;

    const leaveFirst = await createActiveCase(`leave-first-${iteration}`);
    const leaveBaseline = await economySnapshot(leaveFirst);
    await Promise.all([claim(first, leaveFirst.challenger), claim(senderClient, leaveFirst.sender)]);
    await first.query("select set_config('c3c1.pause_leave','on',false)");
    const firstLeave = first.query(
      'select public.leave_live_battle_series($1)', [leaveFirst.seriesId],
    );
    await waitForLeaveActive();
    await delay(10);
    const lateGift = senderClient.query(
      'select * from public.send_live_battle_gift($1,$2,$3,$4)',
      [leaveFirst.battleId, leaveFirst.challenger, 'lb4_c3_c1_concurrent', `leave-first-${iteration}-${token()}`],
    );
    const leaveFirstResults = await Promise.allSettled([firstLeave, lateGift]);
    await first.query("select set_config('c3c1.pause_leave','off',false)");
    inspectInfrastructure(leaveFirstResults);
    assert.equal(leaveFirstResults[0].status, 'fulfilled');
    assert.equal(leaveFirstResults[1].status, 'rejected');
    assert.match(leaveFirstResults[1].reason.message, /live_battle_gift_not_active/);
    assert.deepEqual(await economySnapshot(leaveFirst), leaveBaseline);
    stats.leaveFirst.iterations += 1;
    stats.leaveFirst.fulfilled += 1;
    stats.leaveFirst.domainRejected += 1;

    const accept = await createActiveCase(`accept-${iteration}`);
    const requestId = await prepareCompletedRound(accept, randomUUID());
    await Promise.all([claim(first, accept.challenger), claim(second, accept.opponent)]);
    const acceptResults = await Promise.allSettled([
      first.query('select public.leave_live_battle_series($1)', [accept.seriesId]),
      second.query("select public.respond_live_battle_rematch($1,'accept')", [requestId]),
    ]);
    inspectInfrastructure(acceptResults);
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
    stats.acceptVsLeave.fulfilled += acceptResults.filter((item) => item.status === 'fulfilled').length;
    stats.acceptVsLeave.domainRejected += acceptResults.filter((item) => item.status === 'rejected').length;

    const due = await createActiveCase(`due-${iteration}`);
    await prepareCompletedRound(due, randomUUID(), -1);
    await claim(first, due.challenger);
    await operator(second);
    const dueResults = await Promise.allSettled([
      first.query('select public.leave_live_battle_series($1)', [due.seriesId]),
      second.query('select private.reconcile_due_live_battle_series(100)'),
    ]);
    inspectInfrastructure(dueResults);
    assert.equal((await summary(due)).series_status, 'completed');
    assert.equal((await summary(due)).pending_requests, 0);
    stats.betweenRoundsVsDue.iterations += 1;
    stats.betweenRoundsVsDue.fulfilled += dueResults.filter((item) => item.status === 'fulfilled').length;
    stats.betweenRoundsVsDue.domainRejected += dueResults.filter((item) => item.status === 'rejected').length;
  }
  evidence.raceResults = stats;
}

await Promise.all(clients.map((client) => client.connect()));
try {
  await Promise.all(clients.map(configure));
  await installDisposableLeavePause();
  await admin.query(
    `insert into public.gift_catalog(id,emoji,label,cost_coins,active,enabled)
     values('lb4_c3_c1_concurrent','C1','C3-C1 concurrency',9,true,true)
     on conflict (id) do nothing`,
  );
  await runBudgetExhaustion();
  await runDeadlineCrossing();
  await runRepeatedRaces();
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
} finally {
  await removeDisposableLeavePause().catch(() => undefined);
  await Promise.allSettled(clients.map(async (client) => {
    const closed = await Promise.race([
      client.end().then(() => true),
      delay(1_000).then(() => false),
    ]);
    if (!closed) client.connection?.stream?.destroy();
  }));
}

console.log(JSON.stringify(evidence, null, 2));
