import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.env.LB4_F5_A_C3_DATABASE_URL;
assert.equal(
  process.env.LB4_F5_A_C3_ALLOW_DISPOSABLE,
  'true',
  'LB4_F5_A_C3_ALLOW_DISPOSABLE=true is required',
);
assert.ok(connectionString, 'LB4_F5_A_C3_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(target.hostname),
  'C3 proof refuses non-local databases',
);
const fixturePrefix = process.env.LB4_F5_A_C3_FIXTURE_PREFIX ?? 'c3c';
assert.match(
  fixturePrefix,
  /^[0-9a-f]{3}$/,
  'LB4_F5_A_C3_FIXTURE_PREFIX must be three lowercase hexadecimal characters',
);

const { Client } = pg;
const admin = new Client({ connectionString, ssl: false });
const first = new Client({ connectionString, ssl: false });
const second = new Client({ connectionString, ssl: false });
const blocker = new Client({ connectionString, ssl: false });
const senderClient = new Client({ connectionString, ssl: false });
const clients = [admin, first, second, blocker, senderClient];

const user = (n) => `${fixturePrefix}10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = (n) => `${fixturePrefix}20000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sender = user(30);
const evidence = {};

async function configure(client) {
  await client.query("set lock_timeout = '3s'");
  await client.query("set statement_timeout = '8s'");
}

async function claim(client, actor) {
  await client.query('reset role');
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}

async function setup() {
  const ids = [...Array.from({ length: 14 }, (_, index) => user(index + 1)), sender];
  const existing = await admin.query(
    'select count(*)::int n from auth.users where id=any($1::uuid[])',
    [ids],
  );
  assert.equal(existing.rows[0].n, 0, 'C3 fixtures must start empty');
  for (const [index, id] of ids.entries()) {
    await admin.query(
      `insert into auth.users(
         id,instance_id,aud,role,email,encrypted_password,created_at,updated_at
       ) values(
         $1,'00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated',$2,'proof',clock_timestamp(),clock_timestamp()
       )`,
      [id, `lb4-${fixturePrefix}-concurrency-${index}@proof.local`],
    );
    await admin.query(
      `insert into public.user_profiles(id,username,display_name,is_admin)
       values($1,$2,$3,false)`,
      [id, `lb4_${fixturePrefix}_concurrency_${index}`, `LB4 C3 concurrency ${index}`],
    );
  }
  for (let index = 1; index <= 14; index += 1) {
    await admin.query(
      `insert into public.live_sessions(
         id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at
       ) values(
         $1,$2,$3,'live',0,clock_timestamp()-interval '1 minute',
         clock_timestamp()-interval '1 minute',clock_timestamp()
       )`,
      [session(index), user(index), `LB4 C3 concurrency ${index}`],
    );
  }
  await admin.query(
    `insert into public.gift_catalog(id,emoji,label,cost_coins,active,enabled)
     values('lb4_c3_concurrent','C3','C3 concurrency',9,true,true)
     on conflict (id) do nothing`,
  );
  await admin.query(
    `insert into public.ledger_accounts(owner_id,account_type,balance,currency)
     values($1,'user',500,'BDAG')`,
    [sender],
  );
}

async function createActiveCase(index) {
  const challenger = user((index * 2) - 1);
  const opponent = user(index * 2);
  await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [challenger]);
  const invite = await admin.query(
    'select public.create_live_battle_invite($1,$2,$3) value',
    [opponent, session((index * 2) - 1), session(index * 2)],
  );
  const battleId = invite.rows[0].value.id;
  const seriesId = invite.rows[0].value.series_id;
  await admin.query(
    `with timing as (select clock_timestamp() now_at)
     update public.live_battles
     set status='active', accepted_at=timing.now_at-interval '4 seconds',
         countdown_started_at=timing.now_at-interval '3 seconds',
         scheduled_start_at=timing.now_at, started_at=timing.now_at,
         scheduled_end_at=timing.now_at+interval '300 seconds',
         last_transition_actor_id=null,last_transition_reason='countdown_elapsed',
         version=4,updated_at=timing.now_at
     from timing where id=$1`,
    [battleId],
  );
  return { challenger, opponent, battleId, seriesId };
}

async function counts(battleId, seriesId) {
  const result = await admin.query(
    `select
       (select status from public.live_battles where id=$1) battle_status,
       (select count(*)::int from public.live_battle_events
          where battle_id=$1 and to_status in ('completed','cancelled')) terminal_events,
       (select outcome from public.live_battle_score_states where battle_id=$1) outcome,
       (select count(*)::int from public.live_battle_score_states
          where battle_id=$1 and finalized_at is not null) finalized_scores,
       (select status from public.live_battle_series where id=$2) series_status,
       (select count(*)::int from public.live_battle_rematch_requests
          where series_id=$2 and status='pending') pending_requests,
       (select count(*)::int from public.live_battles
          where series_id=$2 and round_number=2) round_two_rows,
       (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
       (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
       (select count(*)::int from public.financial_transactions
          where reference_type='live_battle' and reference_id=$1::text) financial`,
    [battleId, seriesId],
  );
  return result.rows[0];
}

function assertNoDeadlock(results) {
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.notEqual(result.reason?.code, '40P01', result.reason?.message);
      assert.doesNotMatch(result.reason?.message ?? '', /deadlock detected/i);
    }
  }
}

await Promise.all(clients.map((client) => client.connect()));
try {
  await Promise.all(clients.map(configure));
  await setup();

  // A. Both participants leave at the same time.
  const dual = await createActiveCase(1);
  await Promise.all([claim(first, dual.challenger), claim(second, dual.opponent)]);
  const dualResults = await Promise.allSettled([
    first.query('select public.leave_live_battle_series($1) value', [dual.seriesId]),
    second.query('select public.leave_live_battle_series($1) value', [dual.seriesId]),
  ]);
  assertNoDeadlock(dualResults);
  assert.equal(dualResults.filter((r) => r.status === 'fulfilled').length, 2);
  const dualCounts = await counts(dual.battleId, dual.seriesId);
  assert.deepEqual(dualCounts, {
    battle_status: 'cancelled', terminal_events: 1, outcome: 'cancelled',
    finalized_scores: 1, series_status: 'cancelled', pending_requests: 0,
    round_two_rows: 0, gifts: 0, score_events: 0, financial: 0,
  });
  evidence.dualLeave = { connections: 2, ...dualCounts, deadlocks: 0 };

  // B. leave against the existing public cancel authority.
  const cancelRace = await createActiveCase(2);
  await Promise.all([
    claim(first, cancelRace.challenger),
    claim(second, cancelRace.opponent),
  ]);
  const cancelResults = await Promise.allSettled([
    first.query('select public.leave_live_battle_series($1) value', [cancelRace.seriesId]),
    second.query('select public.cancel_live_battle($1) value', [cancelRace.battleId]),
  ]);
  assertNoDeadlock(cancelResults);
  assert.equal(cancelResults.filter((r) => r.status === 'fulfilled').length, 2);
  const cancelCounts = await counts(cancelRace.battleId, cancelRace.seriesId);
  assert.equal(cancelCounts.terminal_events, 1);
  assert.equal(cancelCounts.finalized_scores, 1);
  assert.equal(cancelCounts.series_status, 'cancelled');
  evidence.leaveVsCancel = { ...cancelCounts, deadlocks: 0 };

  // C. An elapsed Battle completes normally even when leave races completion.
  const timeRace = await createActiveCase(3);
  await claim(senderClient, sender);
  await senderClient.query(
    'select * from public.send_live_battle_gift($1,$2,$3,$4)',
    [timeRace.battleId, timeRace.challenger, 'lb4_c3_concurrent', 'c3-time-winner'],
  );
  await admin.query(
    `with timing as (select clock_timestamp()-interval '1 millisecond' end_at)
     update public.live_battles
     set accepted_at=timing.end_at-interval '304 seconds',
         countdown_started_at=timing.end_at-interval '303 seconds',
         scheduled_start_at=timing.end_at-interval '300 seconds',
         started_at=timing.end_at-interval '300 seconds',
         scheduled_end_at=timing.end_at,updated_at=timing.end_at
     from timing where id=$1`,
    [timeRace.battleId],
  );
  await Promise.all([
    claim(first, timeRace.challenger),
    claim(second, timeRace.opponent),
  ]);
  const timeResults = await Promise.allSettled([
    first.query('select public.leave_live_battle_series($1) value', [timeRace.seriesId]),
    second.query('select public.complete_live_battle($1) value', [timeRace.battleId]),
  ]);
  assertNoDeadlock(timeResults);
  const timeCounts = await counts(timeRace.battleId, timeRace.seriesId);
  assert.equal(timeCounts.battle_status, 'completed');
  assert.equal(timeCounts.outcome, 'challenger');
  assert.equal(timeCounts.series_status, 'completed');
  assert.equal(timeCounts.terminal_events, 1);
  assert.equal(timeCounts.gifts, 1);
  assert.equal(timeCounts.score_events, 1);
  assert.equal(timeCounts.financial, 1);
  evidence.leaveVsElapsed = { ...timeCounts, winnerPreserved: true, deadlocks: 0 };

  // D1. Gift queued first finishes atomically; leave then cancels the round.
  const giftFirst = await createActiveCase(4);
  await Promise.all([
    claim(first, giftFirst.challenger),
    claim(senderClient, sender),
  ]);
  await blocker.query('begin');
  await blocker.query('select id from public.live_battles where id=$1 for update', [giftFirst.battleId]);
  const queuedGift = senderClient.query(
    'select * from public.send_live_battle_gift($1,$2,$3,$4)',
    [giftFirst.battleId, giftFirst.challenger, 'lb4_c3_concurrent', 'c3-gift-first'],
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const queuedLeave = first.query(
    'select public.leave_live_battle_series($1) value', [giftFirst.seriesId],
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  await blocker.query('commit');
  const giftFirstResults = await Promise.allSettled([queuedGift, queuedLeave]);
  assertNoDeadlock(giftFirstResults);
  assert.equal(giftFirstResults.filter((r) => r.status === 'fulfilled').length, 2);
  const giftFirstCounts = await counts(giftFirst.battleId, giftFirst.seriesId);
  assert.equal(giftFirstCounts.gifts, 1);
  assert.equal(giftFirstCounts.score_events, 1);
  assert.equal(giftFirstCounts.financial, 1);
  assert.equal(giftFirstCounts.series_status, 'cancelled');
  evidence.giftFirst = { ...giftFirstCounts, transferPartial: false, deadlocks: 0 };

  // D2. Leave queued first cancels before gift can move any money.
  const leaveFirst = await createActiveCase(5);
  await Promise.all([
    claim(first, leaveFirst.challenger),
    claim(senderClient, sender),
  ]);
  await blocker.query('begin');
  await blocker.query('select id from public.live_battle_series where id=$1 for update', [leaveFirst.seriesId]);
  const firstLeave = first.query(
    'select public.leave_live_battle_series($1) value', [leaveFirst.seriesId],
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const lateGift = senderClient.query(
    'select * from public.send_live_battle_gift($1,$2,$3,$4)',
    [leaveFirst.battleId, leaveFirst.challenger, 'lb4_c3_concurrent', 'c3-leave-first'],
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  await blocker.query('commit');
  const leaveFirstResults = await Promise.allSettled([firstLeave, lateGift]);
  assertNoDeadlock(leaveFirstResults);
  assert.equal(leaveFirstResults[0].status, 'fulfilled');
  assert.equal(leaveFirstResults[1].status, 'rejected');
  assert.match(leaveFirstResults[1].reason.message, /live_battle_gift_not_active/);
  const leaveFirstCounts = await counts(leaveFirst.battleId, leaveFirst.seriesId);
  assert.equal(leaveFirstCounts.gifts, 0);
  assert.equal(leaveFirstCounts.score_events, 0);
  assert.equal(leaveFirstCounts.financial, 0);
  evidence.leaveFirst = {
    ...leaveFirstCounts,
    giftError: 'live_battle_gift_not_active', transferPartial: false, deadlocks: 0,
  };

  // E. Accepting a rematch and leaving serialize on canonical user/session locks.
  const rematch = await createActiveCase(6);
  await admin.query(
    `with timing as (select clock_timestamp() now_at)
     update public.live_battles
     set status='completed', accepted_at=timing.now_at-interval '304 seconds',
         countdown_started_at=timing.now_at-interval '303 seconds',
         scheduled_start_at=timing.now_at-interval '300 seconds',
         started_at=timing.now_at-interval '300 seconds',
         scheduled_end_at=timing.now_at, ended_at=timing.now_at,
         last_transition_reason='battle_duration_elapsed',version=5,updated_at=timing.now_at
     from timing where id=$1`,
    [rematch.battleId],
  );
  await admin.query(
    `update public.live_battle_score_states
     set challenger_score=1,opponent_score=0,score_version=1,
         outcome='challenger',winner_user_id=$2,
         finalized_at=clock_timestamp(),updated_at=clock_timestamp()
     where battle_id=$1`,
    [rematch.battleId, rematch.challenger],
  );
  await claim(first, rematch.challenger);
  const request = await first.query(
    'select public.request_live_battle_rematch($1,$2) value',
    [rematch.battleId, `${fixturePrefix}30000-0000-4000-8000-000000000006`],
  );
  const requestId = request.rows[0].value.id;
  await Promise.all([
    claim(first, rematch.challenger),
    claim(second, rematch.opponent),
  ]);
  const rematchResults = await Promise.allSettled([
    first.query('select public.leave_live_battle_series($1) value', [rematch.seriesId]),
    second.query("select public.respond_live_battle_rematch($1,'accept') value", [requestId]),
  ]);
  assertNoDeadlock(rematchResults);
  const rematchCounts = await counts(rematch.battleId, rematch.seriesId);
  assert.ok(['completed', 'cancelled'].includes(rematchCounts.series_status));
  assert.equal(rematchCounts.pending_requests, 0);
  assert.ok(rematchCounts.round_two_rows <= 1);
  const openRounds = await admin.query(
    `select count(*)::int n from public.live_battles
     where series_id=$1 and status in ('pending','accepted','countdown','active')`,
    [rematch.seriesId],
  );
  assert.equal(openRounds.rows[0].n, 0);
  evidence.acceptVsLeave = {
    ...rematchCounts,
    fulfilled: rematchResults.filter((r) => r.status === 'fulfilled').length,
    rejected: rematchResults.filter((r) => r.status === 'rejected').length,
    openRounds: 0,
    deadlocks: 0,
  };

  const duplicateTerminal = await admin.query(
    `select count(*)::int n from (
       select battle_id from public.live_battle_events
       where to_status in ('completed','cancelled')
       group by battle_id having count(*) > 1
     ) duplicate`,
  );
  assert.equal(duplicateTerminal.rows[0].n, 0);
  const orphanScores = await admin.query(
    `select count(*)::int n
     from public.live_battle_score_events event
     left join public.live_gift_transactions gift on gift.id=event.gift_transaction_id
     where gift.id is null`,
  );
  assert.equal(orphanScores.rows[0].n, 0);
  evidence.global = {
    connections: clients.length,
    deadlocks: 0,
    duplicateTerminalTransitions: 0,
    scoreWithoutGift: 0,
  };
} finally {
  await Promise.allSettled(
    clients.map(async (client) => {
      const closed = await Promise.race([
        client.end().then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!closed) client.connection?.stream?.destroy();
    }),
  );
}

console.log(JSON.stringify(evidence, null, 2));
