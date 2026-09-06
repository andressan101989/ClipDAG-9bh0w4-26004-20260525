import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB4_F8_A_DATABASE_URL;
assert.equal(process.env.LB4_F8_A_ALLOW_DISPOSABLE, 'true', 'LB4_F8_A_ALLOW_DISPOSABLE=true is required');
assert.ok(connectionString, 'LB4_F8_A_DATABASE_URL is required');
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname), 'F8-A proof refuses non-local databases');

const admin = new Client({ connectionString, ssl: false });
const first = new Client({ connectionString, ssl: false });
const second = new Client({ connectionString, ssl: false });
const users = [1, 2, 3].map(n => `f8b10000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const sessions = [2, 3].map(n => `f8b20000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const series = 'f8b30000-0000-4000-8000-000000000001';
const battle = 'f8b40000-0000-4000-8000-000000000001';
const fixturePrefix = 'f8-concurrency-';
const evidence = {};

async function claim(client) {
  await client.query("set statement_timeout = '5s'");
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [users[0]]);
}

async function setup() {
  await admin.query('begin');
  try {
    for (const [index, id] of users.entries()) {
      await admin.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',clock_timestamp(),clock_timestamp())`,
      [id, `lb4-f8-concurrency-${index}@proof.local`]);
      await admin.query('insert into public.user_profiles(id,username,display_name,is_admin) values($1,$2,$3,false)',
        [id, `lb4_f8_concurrency_${index}`, `LB4 F8 concurrency ${index}`]);
    }
    for (let index = 0; index < sessions.length; index += 1) {
      await admin.query(`insert into public.live_sessions(id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at)
        values($1,$2,$3,'live',0,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp())`,
      [sessions[index], users[index + 1], `LB4 F8 concurrency ${index}`]);
    }
    await admin.query("insert into public.ledger_accounts(owner_id,account_type,balance,currency) values($1,'user',100,'BDAG'),($2,'user',0,'BDAG'),($3,'user',0,'BDAG')",
      users);
    await admin.query(`insert into public.ledger_accounts(id,owner_id,account_type,balance,currency)
      values('f8b50000-0000-4000-8000-000000000001',null,'platform',0,'BDAG') on conflict do nothing`);
    await admin.query(`update public.ledger_accounts set balance=0
      where id='f8b50000-0000-4000-8000-000000000001'
        and owner_id is null and account_type='platform'`);
    await admin.query(`insert into public.live_battle_series(
      id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,
      format,max_rounds,wins_required,status
    ) values($1,$2,$3,$4,$5,'best_of_5',5,3,'active')`,
    [series, users[1], users[2], sessions[0], sessions[1]]);
    await admin.query(`with timing as (select clock_timestamp() now_at)
      insert into public.live_battles(
        id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,
        status,invite_expires_at,accepted_at,countdown_started_at,scheduled_start_at,
        started_at,scheduled_end_at,ended_at,last_transition_actor_id,
        last_transition_reason,version,created_at,updated_at,series_id,round_number,battle_rule_set_id
      ) select $1,$2,$3,$4,$5,'active',now_at-interval '50 seconds',
        now_at-interval '40 seconds',now_at-interval '35 seconds',now_at-interval '32 seconds',
        now_at-interval '32 seconds',now_at+interval '4 minutes 28 seconds',null,null,
        'countdown_elapsed',4,now_at-interval '1 minute',now_at,$6,1,rules.id
      from timing join public.live_battle_rule_sets rules on rules.rule_version=2`,
    [battle, users[1], users[2], sessions[0], sessions[1], series]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function snapshot() {
  const result = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions
      where sender_user_id=$1 and idempotency_key like $2) gifts,
    (select count(*)::int from public.financial_transactions
      where initiated_by=$1 and idempotency_key like $2) financial,
    (select count(*)::int from public.ledger_entries entry
      join public.financial_transactions financial
        on entry.metadata->>'fin_txn_id'=financial.id::text
      where financial.initiated_by=$1 and financial.idempotency_key like $2) entries,
    (select balance::int from public.ledger_accounts where owner_id=$1 and account_type='user') sender,
    (select balance::int from public.ledger_accounts where owner_id=$3 and account_type='user') creator,
    (select balance::int from public.ledger_accounts where owner_id is null and account_type='platform') platform`,
  [users[0], `${fixturePrefix}%`, users[1]]);
  return result.rows[0];
}

async function cleanup() {
  await admin.query('begin');
  try {
    // The disposable schema intentionally preserves append-only production
    // guards. Disable trigger execution only inside this cleanup transaction so
    // fixture rows can be removed without weakening the schema under test.
    await admin.query("set local session_replication_role = 'replica'");
    const financial = await admin.query(`select id from public.financial_transactions
      where initiated_by=$1 and idempotency_key like $2`, [users[0], `%${fixturePrefix}%`]);
    const financialIds = financial.rows.map(row => row.id);
    await admin.query("delete from public.live_control_events where session_id=any($1::uuid[]) or payload->>'battle_id'=$2", [sessions, battle]);
    await admin.query('delete from public.live_battle_score_events where battle_id=$1', [battle]);
    await admin.query('delete from public.live_battle_boost_events where battle_id=$1', [battle]);
    await admin.query('delete from public.live_battle_power_states where battle_id=$1', [battle]);
    await admin.query('delete from public.live_battle_score_states where battle_id=$1', [battle]);
    await admin.query('delete from public.live_gift_transactions where sender_user_id=$1 and idempotency_key like $2', [users[0], `${fixturePrefix}%`]);
    if (financialIds.length) {
      await admin.query("delete from public.ledger_entries where metadata->>'fin_txn_id'=any($1::text[])", [financialIds]);
      await admin.query('delete from public.financial_transactions where id=any($1::uuid[])', [financialIds]);
    }
    await admin.query('delete from public.idempotency_keys where user_id=$1 and idempotency_key like $2', [users[0], `%${fixturePrefix}%`]);
    await admin.query('delete from public.live_battle_public_states where session_id=any($1::uuid[])', [sessions]);
    await admin.query('delete from public.live_battle_events where battle_id=$1', [battle]);
    await admin.query('delete from public.live_battles where id=$1', [battle]);
    await admin.query('delete from public.live_battle_series where id=$1', [series]);
    await admin.query('delete from public.live_sessions where id=any($1::uuid[])', [sessions]);
    await admin.query("delete from public.ledger_accounts where owner_id=any($1::uuid[]) and account_type='user'", [users]);
    await admin.query(`update public.ledger_accounts set balance=0
      where id='f8b50000-0000-4000-8000-000000000001'
        and owner_id is null and account_type='platform'`);
    await admin.query('delete from public.user_profiles where id=any($1::uuid[])', [users]);
    await admin.query('delete from auth.users where id=any($1::uuid[])', [users]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

await Promise.all([admin.connect(), first.connect(), second.connect()]);
let setupComplete = false;
try {
  await cleanup();
  await setup();
  setupComplete = true;
  await Promise.all([claim(first), claim(second)]);

  const liveSql = 'select * from public.send_live_gift($1,$2,$3)';
  const sameKey = await Promise.all([
    first.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}live-same`]),
    second.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}live-same`]),
  ]);
  assert.equal(sameKey[0].rows[0].transaction_id, sameKey[1].rows[0].transaction_id);
  let state = await snapshot();
  assert.deepEqual(state, { gifts: 1, financial: 1, entries: 3, sender: 95, creator: 3, platform: 2 });
  evidence.sameKeyLive = { results: 2, uniqueGifts: 1, financial: 1, entries: 3, signedSum: 0 };

  const distinct = await Promise.all([
    first.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}live-distinct-a`]),
    second.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}live-distinct-b`]),
  ]);
  assert.notEqual(distinct[0].rows[0].transaction_id, distinct[1].rows[0].transaction_id);
  state = await snapshot();
  assert.deepEqual(state, { gifts: 3, financial: 3, entries: 9, sender: 85, creator: 9, platform: 6 });
  evidence.distinctLive = { requests: 2, uniqueGifts: 2, balanced: true, noNegativeBalance: true };

  const battleSql = 'select * from public.send_live_battle_gift($1,$2,$3,$4)';
  const sameBattle = await Promise.all([
    first.query(battleSql, [battle, users[1], 'rose', `${fixturePrefix}battle-same`]),
    second.query(battleSql, [battle, users[1], 'rose', `${fixturePrefix}battle-same`]),
  ]);
  assert.equal(sameBattle[0].rows[0].transaction_id, sameBattle[1].rows[0].transaction_id);
  const battleEvidence = await admin.query(`select
    (select count(*)::int from public.live_gift_transactions where battle_id=$1) gifts,
    (select count(*)::int from public.live_battle_score_events where battle_id=$1) score_events,
    (select challenger_score::int from public.live_battle_score_states where battle_id=$1) score,
    (select rose_progress_units::int from public.live_battle_power_states where battle_id=$1 and side='challenger') roses`, [battle]);
  assert.deepEqual(battleEvidence.rows[0], { gifts: 1, score_events: 1, score: 5, roses: 1 });
  evidence.sameKeyBattle = { results: 2, ...battleEvidence.rows[0], creatorNet: 3, platformFee: 2 };

  await admin.query("update public.ledger_accounts set balance=5 where owner_id=$1 and account_type='user'", [users[0]]);
  const limited = await Promise.allSettled([
    first.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}limited-a`]),
    second.query(liveSql, [sessions[0], 'rose', `${fixturePrefix}limited-b`]),
  ]);
  assert.equal(limited.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(limited.filter(result => result.status === 'rejected').length, 1);
  assert.match(limited.find(result => result.status === 'rejected').reason.message, /insufficient balance or account frozen/);
  const limitedState = await admin.query(`select
    (select balance::int from public.ledger_accounts where owner_id=$1 and account_type='user') sender,
    (select count(*)::int from public.live_gift_transactions where idempotency_key in ($2,$3)) gifts,
    (select count(*)::int from public.financial_transactions where idempotency_key in ($2,$3)) financial`,
  [users[0], `${fixturePrefix}limited-a`, `${fixturePrefix}limited-b`]);
  assert.deepEqual(limitedState.rows[0], { sender: 0, gifts: 1, financial: 1 });
  evidence.balanceRace = { accepted: 1, rejected: 1, finalBalance: 0, gifts: 1, financial: 1 };
} finally {
  if (setupComplete) await cleanup();
  await Promise.all([
    first.end().catch(() => undefined),
    second.end().catch(() => undefined),
    admin.end().catch(() => undefined),
  ]);
}

console.log(JSON.stringify(evidence, null, 2));
