import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB4_F4A_DATABASE_URL;
assert.equal(process.env.LB4_F4A_ALLOW_DISPOSABLE, 'true', 'LB4_F4A_ALLOW_DISPOSABLE=true is required');
assert.ok(connectionString, 'LB4_F4A_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname), 'F4A proof refuses non-local databases');

const admin = new Client({ connectionString, ssl: false });
const first = new Client({ connectionString, ssl: false });
const second = new Client({ connectionString, ssl: false });
const sender = 'f4d00000-0000-4000-8000-000000000001';
const hosts = [2, 3, 4, 5].map(n => `f4d00000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const sessions = [2, 3, 4, 5].map(n => `f4e00000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const battles = [1, 2].map(n => `f4f00000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const allUsers = [sender, ...hosts];
const evidence = { sameKey: null, deadlineRace: null, cleanup: null };

async function claim(client) {
  await client.query("set statement_timeout = '5s'");
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [sender]);
}

async function cleanup() {
  await admin.query('begin');
  try {
    await admin.query("delete from public.live_control_events where payload->>'battle_id'=any($1::text[])", [battles]);
    const fin = await admin.query('select financial_transaction_id from public.live_gift_transactions where battle_id=any($1::uuid[])', [battles]);
    const financialIds = fin.rows.map(row => row.financial_transaction_id).filter(Boolean);
    await admin.query('delete from public.live_gift_transactions where battle_id=any($1::uuid[])', [battles]);
    if (financialIds.length) {
      await admin.query("delete from public.ledger_entries where metadata->>'fin_txn_id'=any($1::text[])", [financialIds]);
      await admin.query('delete from public.financial_transactions where id=any($1::uuid[])', [financialIds]);
    }
    await admin.query("delete from public.idempotency_keys where user_id=$1 and idempotency_key like 'live_battle:%'", [sender]);
    await admin.query('delete from public.live_battles where id=any($1::uuid[])', [battles]);
    await admin.query('delete from public.live_sessions where id=any($1::uuid[])', [sessions]);
    await admin.query("delete from public.ledger_accounts where owner_id=any($1::uuid[]) and account_type='user'", [allUsers]);
    await admin.query("delete from public.gift_catalog where id='lb4_f4a_concurrent'");
    await admin.query('delete from public.user_profiles where id=any($1::uuid[])', [allUsers]);
    await admin.query('delete from auth.users where id=any($1::uuid[])', [allUsers]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function setup() {
  const existing = await admin.query('select count(*)::int n from auth.users where id=any($1::uuid[])', [allUsers]);
  assert.equal(existing.rows[0].n, 0, 'disposable concurrency fixtures must start empty');
  await admin.query('begin');
  try {
    for (const [index, id] of allUsers.entries()) {
      await admin.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',clock_timestamp(),clock_timestamp())`,
      [id, `lb4-f4a-concurrency-${index}@proof.local`]);
      await admin.query('insert into public.user_profiles(id,username,display_name,is_admin) values($1,$2,$3,false)',
        [id, `lb4_f4a_concurrency_${index}`, `LB4 F4A concurrency ${index}`]);
    }
    for (let index = 0; index < sessions.length; index += 1) {
      await admin.query(`insert into public.live_sessions(id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at)
        values($1,$2,$3,'live',0,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp())`,
      [sessions[index], hosts[index], `LB4 F4A concurrency ${index}`]);
    }
    await admin.query("insert into public.gift_catalog(id,emoji,label,cost_coins,active,enabled) values('lb4_f4a_concurrent','C','Concurrency proof',9,true,true)");
    await admin.query("insert into public.ledger_accounts(owner_id,account_type,balance,currency) values($1,'user',100,'BDAG')", [sender]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function addBattle(id, challengerIndex, opponentIndex, endDelayMs) {
  const endDelay = `${endDelayMs} milliseconds`;
  await admin.query(`with authoritative as (select clock_timestamp() as now)
    insert into public.live_battles(
      id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,
      status,invite_expires_at,accepted_at,countdown_started_at,scheduled_start_at,
      started_at,scheduled_end_at,ended_at,last_transition_actor_id,
      last_transition_reason,version,created_at,updated_at)
    select $1,$2,$3,$4,$5,'active',
      now-interval '350 seconds',
      now-interval '310 seconds',
      now+$6::interval-interval '303 seconds',
      now+$6::interval-interval '300 seconds',
      now+$6::interval-interval '300 seconds',
      now+$6::interval,null,null,'countdown_elapsed',4,
      now-interval '400 seconds',now
    from authoritative`,
  [id, hosts[challengerIndex], hosts[opponentIndex],
    sessions[challengerIndex], sessions[opponentIndex], endDelay]);
}

await Promise.all([admin.connect(), first.connect(), second.connect()]);
let setupComplete = false;
try {
  await setup();
  setupComplete = true;
  await addBattle(battles[0], 0, 1, 300_000);
  await addBattle(battles[1], 2, 3, 1_000);
  await Promise.all([claim(first), claim(second)]);

  const giftSql = `select * from public.send_live_battle_gift($1,$2,$3,$4)`;
  const same = await Promise.all([
    first.query(giftSql, [battles[0], hosts[0], 'lb4_f4a_concurrent', 'same-key']),
    second.query(giftSql, [battles[0], hosts[0], 'lb4_f4a_concurrent', 'same-key']),
  ]);
  const firstId = same[0].rows[0].transaction_id;
  const secondId = same[1].rows[0].transaction_id;
  assert.equal(firstId, secondId, 'concurrent retries must return one gift');

  const sameCounts = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.financial_transactions
      where reference_type='live_battle' and reference_id=$1::text) financial,
    (select count(*)::int from public.ledger_entries
      where metadata->>'fin_txn_id'=(select financial_transaction_id::text
        from public.live_gift_transactions where battle_id=$1)) entries,
    (select count(*)::int from public.live_control_events
      where payload->>'transaction_id'=$2::text) events`, [battles[0], firstId]);
  assert.deepEqual(sameCounts.rows[0], { gifts: 1, financial: 1, entries: 2, events: 2 });
  evidence.sameKey = {
    transactionId: firstId,
    results: same.length,
    ...sameCounts.rows[0],
    noDeadlock: true,
  };

  await admin.query('begin');
  await admin.query('select id from public.live_battles where id=$1 for update', [battles[1]]);
  const deadlineAttempt = first.query(
    giftSql, [battles[1], hosts[2], 'lb4_f4a_concurrent', 'deadline-race'],
  );
  await new Promise(resolve => setTimeout(resolve, 1_400));
  await admin.query('commit');

  const deadline = await Promise.allSettled([deadlineAttempt]);
  assert.equal(deadline[0].status, 'rejected', 'gift waiting past deadline must reject');
  assert.match(deadline[0].reason.message, /live_battle_gift_deadline_elapsed/);
  const deadlineCounts = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.financial_transactions
      where reference_type='live_battle' and reference_id=$1::text) financial`, [battles[1]]);
  assert.deepEqual(deadlineCounts.rows[0], { gifts: 0, financial: 0 });
  evidence.deadlineRace = {
    rejected: true,
    message: 'live_battle_gift_deadline_elapsed',
    ...deadlineCounts.rows[0],
    battleLockSerialized: true,
    noDeadlock: true,
  };
} finally {
  if (setupComplete) {
    await cleanup();
    const residue = await admin.query(`select
      (select count(*)::int from auth.users where id=any($1::uuid[])) users,
      (select count(*)::int from public.live_sessions where id=any($2::uuid[])) sessions,
      (select count(*)::int from public.live_battles where id=any($3::uuid[])) battles,
      (select count(*)::int from public.live_gift_transactions where battle_id=any($3::uuid[])) gifts,
      (select count(*)::int from public.gift_catalog where id='lb4_f4a_concurrent') catalog`,
    [allUsers, sessions, battles]);
    assert.deepEqual(residue.rows[0], { users: 0, sessions: 0, battles: 0, gifts: 0, catalog: 0 });
    evidence.cleanup = { ...residue.rows[0], persistentFixtures: 0 };
  }
  await Promise.all([
    first.end().catch(() => undefined),
    second.end().catch(() => undefined),
    admin.end().catch(() => undefined),
  ]);
}

console.log(JSON.stringify(evidence, null, 2));
