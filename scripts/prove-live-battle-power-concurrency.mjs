import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.LB4_F4D_A_DATABASE_URL;
assert.equal(process.env.LB4_F4D_A_ALLOW_DISPOSABLE, 'true');
assert.ok(connectionString);
const target = new URL(connectionString);
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(target.hostname),
  'F4D-A proof refuses non-local databases',
);

const admin = new Client({ connectionString, ssl: false });
const first = new Client({ connectionString, ssl: false });
const second = new Client({ connectionString, ssl: false });
const sender = 'd4db1000-0000-4000-8000-000000000001';
const challenger = 'd4db1000-0000-4000-8000-000000000002';
const opponent = 'd4db1000-0000-4000-8000-000000000003';
const users = [sender, challenger, opponent];
const sessions = [
  'd4db2000-0000-4000-8000-000000000002',
  'd4db2000-0000-4000-8000-000000000003',
];
const battle = 'd4db3000-0000-4000-8000-000000000001';
const bind = String.fromCharCode(36);

async function claim(client, userId) {
  await client.query("set statement_timeout = '8s'");
  await client.query('set role authenticated');
  const sql = "select set_config('request.jwt.claim.sub'," + bind + '1,false)';
  await client.query(sql, [userId]);
}

async function setup() {
  const found = await admin.query(
    'select count(*)::int n from auth.users where id=any(' + bind + '1::uuid[])',
    [users],
  );
  assert.equal(found.rows[0].n, 0, 'disposable fixtures must start empty');
  for (const [index, id] of users.entries()) {
    await admin.query(
      'insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) ' +
      "values(" + bind + "1,'00000000-0000-0000-0000-000000000000'," +
      "'authenticated','authenticated'," + bind + "2,'proof',clock_timestamp(),clock_timestamp())",
      [id, 'lb4-f4d-a-concurrency-' + index + '@proof.local'],
    );
    await admin.query(
      'insert into public.user_profiles(id,username,display_name,is_admin) ' +
      'values(' + bind + '1,' + bind + '2,' + bind + '3,false)',
      [id, 'lb4_f4d_a_concurrency_' + index, 'LB4 F4D A ' + index],
    );
    await admin.query(
      "insert into public.ledger_accounts(owner_id,account_type,balance,currency) " +
      "values(" + bind + "1,'user'," + bind + "2,'BDAG')",
      [id, id === sender ? 1000 : 0],
    );
  }
  for (let index = 0; index < sessions.length; index += 1) {
    await admin.query(
      'insert into public.live_sessions(' +
      'id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at) ' +
      "values(" + bind + "1," + bind + "2," + bind + "3,'live',0," +
      "clock_timestamp()-interval '1 minute'," +
      "clock_timestamp()-interval '1 minute',clock_timestamp())",
      [sessions[index], users[index + 1], 'F4D-A concurrency ' + index],
    );
  }
  const values = [battle, challenger, opponent, sessions[0], sessions[1]];
  await admin.query(
    'with authoritative as (select clock_timestamp() as now_at) ' +
    'insert into public.live_battles(' +
    'id,challenger_user_id,opponent_user_id,challenger_session_id,' +
    'opponent_session_id,status,invite_expires_at,accepted_at,' +
    'countdown_started_at,scheduled_start_at,started_at,scheduled_end_at,' +
    'last_transition_reason,version,created_at,updated_at) select ' +
    bind + '1,' + bind + '2,' + bind + '3,' + bind + '4,' + bind + "5,'active'," +
    "now_at-interval '50 seconds',now_at-interval '40 seconds'," +
    "now_at-interval '35 seconds',now_at-interval '32 seconds'," +
    "now_at-interval '32 seconds',now_at+interval '4 minutes 28 seconds'," +
    "'countdown_elapsed',4,now_at-interval '1 minute',now_at from authoritative",
    values,
  );
}

await Promise.all([admin.connect(), first.connect(), second.connect()]);
try {
  await setup();
  await Promise.all([claim(first, sender), claim(second, sender)]);
  const giftSql = 'select * from public.send_live_battle_gift(' +
    bind + '1,' + bind + '2,' + bind + '3,' + bind + '4)';
  for (let n = 1; n <= 8; n += 1) {
    await first.query(giftSql, [battle, challenger, 'rose', 'rose-' + n]);
  }
  const crossed = await Promise.all([
    first.query(giftSql, [battle, challenger, 'rose', 'rose-9']),
    second.query(giftSql, [battle, challenger, 'rose', 'rose-10']),
  ]);
  assert.equal(crossed.length, 2);
  const mission = await admin.query(
    "select state.rose_progress_units,state.rose_activations_used," +
    "(select count(*)::int from public.live_battle_boost_events boost " +
    "where boost.battle_id=state.battle_id and boost.kind='rose_x2') boosts " +
    "from public.live_battle_power_states state where state.battle_id=" +
    bind + "1 and state.side='challenger'",
    [battle],
  );
  assert.deepEqual(mission.rows[0], {
    rose_progress_units: 10,
    rose_activations_used: 1,
    boosts: 1,
  });
  const counts = await admin.query(
    'select (select count(*)::int from public.live_gift_transactions where battle_id=' +
    bind + '1) gifts,(select count(*)::int from public.live_battle_score_events ' +
    'where battle_id=' + bind + '1) scores,(select count(*)::int from ' +
    "public.financial_transactions where reference_type='live_battle' and " +
    'reference_id=' + bind + '1::text) financial',
    [battle],
  );
  assert.deepEqual(counts.rows[0], { gifts: 10, scores: 10, financial: 10 });

  await Promise.all([claim(first, challenger), claim(second, challenger)]);
  const gloveSql = 'select * from public.activate_live_battle_glove(' +
    bind + '1,' + bind + '2)';
  const gloves = await Promise.all([
    first.query(gloveSql, [battle, 'same-glove-key']),
    second.query(gloveSql, [battle, 'same-glove-key']),
  ]);
  assert.equal(gloves[0].rows[0].boost_id, gloves[1].rows[0].boost_id);
  const gloveState = await admin.query(
    'select glove_uses_available,glove_uses_consumed,' +
    '(select count(*)::int from public.live_battle_boost_events where battle_id=' +
    bind + "1 and kind='glove_x3') boosts from public.live_battle_power_states " +
    'where battle_id=' + bind + "1 and side='challenger'",
    [battle],
  );
  assert.deepEqual(gloveState.rows[0], {
    glove_uses_available: 0,
    glove_uses_consumed: 1,
    boosts: 1,
  });
  const effective = await admin.query(
    'select (private.resolve_live_battle_effective_boost_locked(' +
    bind + "1,'challenger',clock_timestamp())).multiplier multiplier",
    [battle],
  );
  assert.equal(effective.rows[0].multiplier, 3);
  console.log(JSON.stringify({
    parallelRoses: { ...mission.rows[0], noDeadlock: true },
    economy: counts.rows[0],
    gloveRetry: { ...gloveState.rows[0], sameBoost: true, noDeadlock: true },
    effectiveMultiplier: 3,
  }, null, 2));
} finally {
  await Promise.all([
    first.end().catch(() => undefined),
    second.end().catch(() => undefined),
    admin.end().catch(() => undefined),
  ]);
}
