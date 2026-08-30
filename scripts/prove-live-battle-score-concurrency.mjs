import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB4_F4B_DATABASE_URL;
assert.equal(process.env.LB4_F4B_ALLOW_DISPOSABLE, 'true', 'LB4_F4B_ALLOW_DISPOSABLE=true is required');
assert.ok(connectionString, 'LB4_F4B_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname), 'F4B proof refuses non-local databases');

const admin = new Client({ connectionString, ssl: false });
const first = new Client({ connectionString, ssl: false });
const second = new Client({ connectionString, ssl: false });
const closer = new Client({ connectionString, ssl: false });
const sender = 'f4b40000-0000-4000-8000-000000000001';
const hosts = Array.from({ length: 8 }, (_, index) =>
  `f4b40000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`);
const sessions = hosts.map((_, index) =>
  `f4b50000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`);
const battles = Array.from({ length: 4 }, (_, index) =>
  `f4b60000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const allUsers = [sender, ...hosts];
const evidence = {};

async function claim(client) {
  await client.query("set statement_timeout = '8s'");
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [sender]);
}

async function setup() {
  const existing = await admin.query('select count(*)::int n from auth.users where id=any($1::uuid[])', [allUsers]);
  assert.equal(existing.rows[0].n, 0, 'disposable concurrency fixtures must start empty');
  for (const [index, id] of allUsers.entries()) {
    await admin.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',clock_timestamp(),clock_timestamp())`,
    [id, `lb4-f4b-concurrency-${index}@proof.local`]);
    await admin.query('insert into public.user_profiles(id,username,display_name,is_admin) values($1,$2,$3,false)',
      [id, `lb4_f4b_concurrency_${index}`, `LB4 F4B concurrency ${index}`]);
  }
  for (let index = 0; index < sessions.length; index += 1) {
    await admin.query(`insert into public.live_sessions(id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at)
      values($1,$2,$3,'live',0,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp())`,
    [sessions[index], hosts[index], `LB4 F4B concurrency ${index}`]);
  }
  await admin.query("insert into public.gift_catalog(id,emoji,label,cost_coins,active,enabled) values('lb4_f4b_concurrent','C','Concurrency proof',9,true,true)");
  await admin.query("insert into public.ledger_accounts(owner_id,account_type,balance,currency) values($1,'user',500,'BDAG')", [sender]);
}

async function addBattle(id, pairIndex, endDelayMs) {
  const challengerIndex = pairIndex * 2;
  const opponentIndex = challengerIndex + 1;
  const endDelay = `${endDelayMs} milliseconds`;
  await admin.query(`with authoritative as (select clock_timestamp() as now)
    insert into public.live_battles(
      id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,
      status,invite_expires_at,accepted_at,countdown_started_at,scheduled_start_at,
      started_at,scheduled_end_at,ended_at,last_transition_actor_id,
      last_transition_reason,version,created_at,updated_at)
    select $1,$2,$3,$4,$5,'active',now-interval '350 seconds',now-interval '310 seconds',
      now+$6::interval-interval '303 seconds',now+$6::interval-interval '300 seconds',
      now+$6::interval-interval '300 seconds',now+$6::interval,null,null,
      'countdown_elapsed',4,now-interval '400 seconds',now
    from authoritative`,
  [id, hosts[challengerIndex], hosts[opponentIndex],
    sessions[challengerIndex], sessions[opponentIndex], endDelay]);
}

await Promise.all([admin.connect(), first.connect(), second.connect(), closer.connect()]);
try {
  await setup();
  await addBattle(battles[0], 0, 300_000);
  await addBattle(battles[1], 1, 300_000);
  await addBattle(battles[2], 2, 900);
  await addBattle(battles[3], 3, 900);
  await Promise.all([claim(first), claim(second)]);
  await closer.query("set statement_timeout = '8s'");

  const giftSql = 'select * from public.send_live_battle_gift($1,$2,$3,$4)';

  const same = await Promise.all([
    first.query(giftSql, [battles[0], hosts[0], 'lb4_f4b_concurrent', 'same-key']),
    second.query(giftSql, [battles[0], hosts[0], 'lb4_f4b_concurrent', 'same-key']),
  ]);
  assert.equal(same[0].rows[0].transaction_id, same[1].rows[0].transaction_id);
  const sameCounts = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
    (select score_version::int from public.live_battle_score_states where battle_id=$1) score_version,
    (select count(*)::int from public.financial_transactions
      where reference_type='live_battle' and reference_id=$1::text) financial`, [battles[0]]);
  assert.deepEqual(sameCounts.rows[0], { gifts: 1, score_events: 1, score_version: 1, financial: 1 });
  evidence.sameKey = { ...sameCounts.rows[0], sameTransaction: true, noDeadlock: true };

  const parallel = await Promise.all([
    first.query(giftSql, [battles[1], hosts[2], 'lb4_f4b_concurrent', 'parallel-challenger']),
    second.query(giftSql, [battles[1], hosts[3], 'lb4_f4b_concurrent', 'parallel-opponent']),
    closer.query('select * from private.reconcile_live_battle_score_locked($1,clock_timestamp())', [battles[1]]),
  ]);
  assert.equal(parallel.length, 3);
  const parallelState = await admin.query(`select challenger_score::int,opponent_score::int,
    score_version::int,outcome from public.live_battle_score_states where battle_id=$1`, [battles[1]]);
  assert.deepEqual(parallelState.rows[0], {
    challenger_score: 9, opponent_score: 9, score_version: 2, outcome: 'pending',
  });
  const parallelMoney = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
    (select count(*)::int from public.financial_transactions
      where reference_type='live_battle' and reference_id=$1::text) financial`, [battles[1]]);
  assert.deepEqual(parallelMoney.rows[0], { gifts: 2, score_events: 2, financial: 2 });
  evidence.parallelSidesAndReconcile = {
    ...parallelState.rows[0], ...parallelMoney.rows[0], noDeadlock: true,
  };

  await closer.query('begin');
  await closer.query('select id from public.live_battles where id=$1 for update', [battles[2]]);
  const closingGift = first.query(
    giftSql, [battles[2], hosts[4], 'lb4_f4b_concurrent', 'gift-vs-close'],
  );
  await new Promise(resolve => setTimeout(resolve, 1_200));
  await closer.query(`select private.live_battle_transition(
    $1,'active','completed',null,'battle_duration_elapsed',clock_timestamp())`, [battles[2]]);
  await closer.query('commit');
  const closeRace = await Promise.allSettled([closingGift]);
  assert.equal(closeRace[0].status, 'rejected');
  assert.match(closeRace[0].reason.message, /live_battle_gift_not_active/);
  const finalState = await admin.query(`select b.status,s.challenger_score::int,s.opponent_score::int,
    s.score_version::int,s.outcome,s.winner_user_id from public.live_battles b
    join public.live_battle_score_states s on s.battle_id=b.id where b.id=$1`, [battles[2]]);
  assert.deepEqual(finalState.rows[0], {
    status: 'completed', challenger_score: 0, opponent_score: 0,
    score_version: 0, outcome: 'tie', winner_user_id: null,
  });
  evidence.giftVsClose = {
    rejected: true, error: 'live_battle_gift_not_active', ...finalState.rows[0], noDeadlock: true,
  };

  await admin.query('begin');
  await admin.query('select id from public.live_battles where id=$1 for update', [battles[3]]);
  const deadlineGift = second.query(
    giftSql, [battles[3], hosts[6], 'lb4_f4b_concurrent', 'deadline-lock'],
  );
  await new Promise(resolve => setTimeout(resolve, 1_200));
  await admin.query('commit');
  const deadline = await Promise.allSettled([deadlineGift]);
  assert.equal(deadline[0].status, 'rejected');
  assert.match(deadline[0].reason.message, /live_battle_gift_deadline_elapsed/);
  const deadlineCounts = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
    (select count(*)::int from public.financial_transactions
      where reference_type='live_battle' and reference_id=$1::text) financial`, [battles[3]]);
  assert.deepEqual(deadlineCounts.rows[0], { gifts: 0, score_events: 0, financial: 0 });
  evidence.deadlineLock = {
    rejected: true, error: 'live_battle_gift_deadline_elapsed',
    ...deadlineCounts.rows[0], noDeadlock: true,
  };

  const duplicateFacts = await admin.query(`select count(*)::int n from (
    select gift_transaction_id from public.live_battle_score_events
    group by gift_transaction_id having count(*) > 1
  ) duplicate`);
  assert.equal(duplicateFacts.rows[0].n, 0);
  evidence.global = { duplicateScoreFacts: 0, moneyMultiplier: 1, deterministic: true };
} finally {
  await Promise.all([
    first.end().catch(() => undefined), second.end().catch(() => undefined),
    closer.end().catch(() => undefined), admin.end().catch(() => undefined),
  ]);
}

console.log(JSON.stringify(evidence, null, 2));
