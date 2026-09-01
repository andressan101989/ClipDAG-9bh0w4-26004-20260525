import assert from "node:assert/strict";
import pg from "pg";

const connectionString =
  process.env.LB4_F5_A_DATABASE_URL ??
  "postgresql://postgres:lb4-f5-a-disposable-only@127.0.0.1:55423/postgres";
const parsed = new URL(connectionString);
if (!/^(127\.0\.0\.1|localhost)$/i.test(parsed.hostname)) {
  throw new Error("live_battle_f5_a_concurrency_requires_local_database");
}

const { Client } = pg;
const admin = new Client({ connectionString });
const first = new Client({ connectionString });
const second = new Client({ connectionString });
const challenger = "f5ac1000-0000-4000-8000-000000000001";
const opponent = "f5ac1000-0000-4000-8000-000000000002";
const challengerSession = "f5ac2000-0000-4000-8000-000000000001";
const opponentSession = "f5ac2000-0000-4000-8000-000000000002";

try {
  await Promise.all([admin.connect(), first.connect(), second.connect()]);
  await admin.query("begin");
  await admin.query(`
    insert into public.gift_catalog (
      id, emoji, label, cost_coins, active, enabled, category,
      animation_type, duration_ms, priority, sort_order
    ) values ('rose', 'R', 'Rose', 5, true, true, 'basic', 'floating', 1800, 1, 9951)
    on conflict (id) do nothing
  `);
  await admin.query(`
    insert into public.live_battle_rule_sets (
      rule_version, rose_gift_id, rose_target_units, rose_multiplier,
      rose_duration_seconds, rose_activation_limit_per_side,
      glove_multiplier, glove_duration_seconds, glove_uses_per_side,
      glove_acquisition_mode
    ) values
      (1, null, 0, 1, 0, 0, 1, 0, 0, 'disabled'),
      (2, 'rose', 10, 2, 30, 1, 3, 15, 1, 'fixed_battle_grant')
    on conflict (rule_version) do nothing
  `);
  await admin.query(`
    insert into public.live_battle_current_rule_set (singleton, rule_set_id)
    select true, id from public.live_battle_rule_sets where rule_version = 2
    on conflict (singleton) do nothing
  `);
  await admin.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
     ) values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'f5ac-1@proof.local', 'proof', clock_timestamp(), clock_timestamp()),
       ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'f5ac-2@proof.local', 'proof', clock_timestamp(), clock_timestamp())`,
    [challenger, opponent],
  );
  await admin.query(
    `insert into public.user_profiles (id, username, display_name, is_admin)
     values ($1, 'lb4f5ac_1', 'LB4 F5-A concurrency 1', false),
            ($2, 'lb4f5ac_2', 'LB4 F5-A concurrency 2', false)`,
    [challenger, opponent],
  );
  await admin.query(
    `insert into public.live_sessions (
       id, host_id, title, status, viewer_count, started_at, ended_at,
       created_at, last_heartbeat_at, host_disconnected_at, end_reason
     ) values
       ($1, $2, 'F5-A concurrency 1', 'live', 0, clock_timestamp() - interval '1 minute',
        null, clock_timestamp() - interval '1 minute', clock_timestamp(), null, null),
       ($3, $4, 'F5-A concurrency 2', 'live', 0, clock_timestamp() - interval '1 minute',
        null, clock_timestamp() - interval '1 minute', clock_timestamp(), null, null)`,
    [challengerSession, challenger, opponentSession, opponent],
  );
  await admin.query("commit");

  const financialBefore = await admin.query(`
    select
      (select count(*)::int from public.live_gift_transactions) as gifts,
      (select count(*)::int from public.financial_transactions) as financial,
      (select count(*)::int from public.ledger_entries) as ledger
  `);

  await first.query("select set_config('request.jwt.claim.sub', $1, false)", [challenger]);
  const invite = await first.query(
    "select public.create_live_battle_invite($1,$2,$3) as value",
    [opponent, challengerSession, opponentSession],
  );
  const battleId = invite.rows[0].value.id;
  await admin.query(
    `with timing as (select clock_timestamp() as now_at)
     update public.live_battles
     set status='completed', accepted_at=timing.now_at - interval '310 seconds',
         countdown_started_at=timing.now_at - interval '303 seconds',
         scheduled_start_at=timing.now_at - interval '300 seconds',
         started_at=timing.now_at - interval '300 seconds', scheduled_end_at=timing.now_at,
         ended_at=timing.now_at, last_transition_reason='f5a_concurrency_completed',
         version=5, updated_at=timing.now_at
     from timing where id=$1`,
    [battleId],
  );
  await admin.query(
    `update public.live_battle_score_states
     set challenger_score=10, opponent_score=0, score_version=1,
         outcome='challenger', winner_user_id=$2,
         finalized_at=clock_timestamp(), updated_at=clock_timestamp()
     where battle_id=$1`,
    [battleId, challenger],
  );

  await Promise.all([
    first.query("select set_config('request.jwt.claim.sub', $1, false)", [challenger]),
    second.query("select set_config('request.jwt.claim.sub', $1, false)", [opponent]),
  ]);
  const [requestA, requestB] = await Promise.all([
    first.query(
      "select public.request_live_battle_rematch($1,$2) as value",
      [battleId, "f5ac3000-0000-4000-8000-000000000001"],
    ),
    second.query(
      "select public.request_live_battle_rematch($1,$2) as value",
      [battleId, "f5ac3000-0000-4000-8000-000000000002"],
    ),
  ]);
  const requestOne = requestA.rows[0].value;
  const requestTwo = requestB.rows[0].value;
  assert.equal(requestOne.id, requestTwo.id, "concurrent requests diverged");
  const requestCount = await admin.query(
    "select count(*)::int as count from public.live_battle_rematch_requests where series_id=$1",
    [requestOne.series_id],
  );
  assert.equal(requestCount.rows[0].count, 1, "concurrent requests duplicated");

  const responder = requestOne.requested_by_user_id === challenger ? opponent : challenger;
  await Promise.all([
    first.query("select set_config('request.jwt.claim.sub', $1, false)", [responder]),
    second.query("select set_config('request.jwt.claim.sub', $1, false)", [responder]),
  ]);
  const [acceptA, acceptB] = await Promise.all([
    first.query("select public.respond_live_battle_rematch($1,'accept') as value", [requestOne.id]),
    second.query("select public.respond_live_battle_rematch($1,'accept') as value", [requestOne.id]),
  ]);
  const nextA = acceptA.rows[0].value.battle;
  const nextB = acceptB.rows[0].value.battle;
  assert.equal(nextA.id, nextB.id, "concurrent accept returned different rounds");
  const nextCount = await admin.query(
    "select count(*)::int as count from public.live_battles where series_id=$1 and round_number=2",
    [requestOne.series_id],
  );
  assert.equal(nextCount.rows[0].count, 1, "concurrent accept duplicated round two");
  const projection = await admin.query(
    `select rematch_request_id, rematch_request_after_battle_id,
            rematch_request_status, rematch_request_expires_at,
            rematch_window_expires_at
     from public.live_battle_public_states
     where battle_id=$1`,
    [nextA.id],
  );
  assert.equal(projection.rowCount, 2, "round two projection orientations missing");
  for (const row of projection.rows) {
    assert.deepEqual(row, {
      rematch_request_id: null,
      rematch_request_after_battle_id: null,
      rematch_request_status: null,
      rematch_request_expires_at: null,
      rematch_window_expires_at: null,
    }, "round two projection leaked the accepted round one request");
  }
  const fresh = await admin.query(
    `select
       (select count(*)::int from public.live_battle_score_states
        where battle_id=$1 and challenger_score=0 and opponent_score=0 and outcome='pending') as score,
       (select count(*)::int from public.live_battle_power_states
        where battle_id=$1 and rose_progress_units=0 and glove_uses_consumed=0) as power`,
    [nextA.id],
  );
  assert.deepEqual(fresh.rows[0], { score: 1, power: 2 });

  await admin.query(
    `insert into public.live_battle_rematch_requests (
       series_id, after_battle_id, requested_by_user_id, status,
       idempotency_key, expires_at, responded_by_user_id, responded_at,
       created_at, updated_at
     )
     select $1, $2, $3, 'rejected', gen_random_uuid(),
       statement_timestamp() + interval '30 seconds', $4, statement_timestamp(),
       statement_timestamp(), statement_timestamp()
     from generate_series(1, 2000)`,
    [requestOne.series_id, battleId, challenger, opponent],
  );
  await admin.query("analyze public.live_battle_rematch_requests");
  await admin.query("set enable_seqscan=off");
  const plan = await admin.query(
    `explain (format json, costs true)
     select candidate.id, candidate.after_battle_id, candidate.status,
            candidate.requested_by_user_id, candidate.expires_at
     from public.live_battle_rematch_requests as candidate
     where candidate.series_id=$1 and candidate.after_battle_id=$2
     order by candidate.created_at desc, candidate.id desc
     limit 1`,
    [requestOne.series_id, battleId],
  );
  await admin.query("set enable_seqscan=on");
  assert.match(
    JSON.stringify(plan.rows[0]["QUERY PLAN"]),
    /live_battle_rematch_requests_series_battle_created_idx/,
    "current-Battle projection lookup cannot use its composite index",
  );

  const financialAfter = await admin.query(`
    select
      (select count(*)::int from public.live_gift_transactions) as gifts,
      (select count(*)::int from public.financial_transactions) as financial,
      (select count(*)::int from public.ledger_entries) as ledger
  `);
  assert.deepEqual(financialAfter.rows[0], financialBefore.rows[0]);
  process.stdout.write(
    `${JSON.stringify({
      request_connections: 2,
      request_rows: requestCount.rows[0].count,
      accept_connections: 2,
      round_two_rows: nextCount.rows[0].count,
      fresh_score_states: fresh.rows[0].score,
      fresh_power_states: fresh.rows[0].power,
      round_two_projection_anchored: true,
      indexed_history_rows: 2000,
      projection_index_used: true,
      financial_rows_unchanged: true,
    })}\n`,
  );
} finally {
  await Promise.allSettled(
    [admin, first, second].map(async (client) => {
      const closed = await Promise.race([
        client.end().then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!closed) client.connection?.stream?.destroy();
    }),
  );
}
