import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

// Deliberately no URL/environment override: only the disposable container's loopback port.
const config = { host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres', ssl: false,
  password: readFileSync(join(tmpdir(), 'lb4-f9-local-auth'), 'utf8') };
const admin = new pg.Client(config), a = new pg.Client(config), b = new pg.Client(config);
const evidence = 'docs/validation/lb4-f9-a-c1/';
const action = process.argv[2];
const results = [];
async function claim(client, actor) {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? '']);
  await client.query('set role authenticated');
}
async function fixture(rule = null, sharedViewer = null) {
  const f = { users: [sharedViewer ?? randomUUID(), randomUUID(), randomUUID(), randomUUID()], sessions: [randomUUID(), randomUUID()], battle: randomUUID(), series: randomUUID() };
  for (const id of f.users) {
    await admin.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'fixture',now(),now()) on conflict do nothing", [id, `${id}@fixture.invalid`]);
    await admin.query('insert into public.user_profiles(id,username,display_name,is_admin) values($1,$2,$2,false) on conflict do nothing', [id, `f9_${id.replaceAll('-', '')}`]);
    await admin.query("insert into public.ledger_accounts(owner_id,account_type,balance,currency) select $1,'user',10000,'BDAG' where not exists(select 1 from public.ledger_accounts where owner_id=$1 and account_type='user' and currency='BDAG')", [id]);
  }
  await admin.query("insert into public.ledger_accounts(owner_id,account_type,balance,currency) select null,'platform',0,'BDAG' where not exists(select 1 from public.ledger_accounts where owner_id is null and account_type='platform' and currency='BDAG')");
  for (let i = 0; i < 2; i++) {
    await admin.query("insert into public.live_sessions(id,host_id,title,status,viewer_count,started_at,created_at,last_heartbeat_at) values($1,$2,'F9 fixture','live',0,now(),now(),now())", [f.sessions[i], f.users[i + 1]]);
    for (const viewer of [f.users[0], f.users[3]]) await admin.query("insert into public.live_participants(session_id,user_id,role,status) values($1,$2,'audience','active')", [f.sessions[i], viewer]);
  }
  await admin.query("insert into public.live_battle_series(id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,format,max_rounds,wins_required,status) values($1,$2,$3,$4,$5,'best_of_5',5,3,'active')", [f.series, f.users[1], f.users[2], ...f.sessions]);
  await admin.query(`with timing as (select clock_timestamp() now_at)
    insert into public.live_battles(id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,
      status,invite_expires_at,accepted_at,countdown_started_at,scheduled_start_at,started_at,scheduled_end_at,
      last_transition_reason,version,created_at,updated_at,series_id,round_number,battle_rule_set_id)
    select $1,$2,$3,$4,$5,'active',now_at-interval '50 seconds',now_at-interval '40 seconds',now_at-interval '35 seconds',
      now_at-interval '32 seconds',now_at-interval '32 seconds',now_at+interval '268 seconds',
      'countdown_elapsed',4,now_at-interval '1 minute',now_at,$6,1,r.id
    from timing,public.live_battle_rule_sets r where r.id=case when $7::int is null then private.current_live_battle_rule_set_id()
      else (select id from public.live_battle_rule_sets where rule_version=$7) end`, [f.battle, f.users[1], f.users[2], ...f.sessions, f.series, rule]);
  return f;
}
async function gift(client, f, giftId, key = randomUUID()) {
  const result = await client.query('select * from public.send_live_battle_gift($1,$2,$3,$4)', [f.battle, f.users[1], giftId, key]);
  return result.rows[0];
}
async function like(client, f, count, key = randomUUID(), side = 0) {
  const result = await client.query('select * from public.send_live_battle_likes($1,$2,$3,$4)', [f.sessions[side], f.battle, count, key]);
  return { accepted: result.rows[0].accepted_count, points: Number(result.rows[0].awarded_points) };
}
async function state(f) { return (await admin.query('select * from public.live_battle_score_states where battle_id=$1', [f.battle])).rows[0]; }
async function money() { return (await admin.query(`select (select count(*) from public.live_gift_transactions) gifts,
  (select count(*) from public.financial_transactions) financial,(select count(*) from public.ledger_entries) ledger,
  (select sum(balance) from public.ledger_accounts) balances,
  (select sum(rose_progress_units) from public.live_battle_power_states) roses,
  (select count(*) from public.live_battle_boost_events) boosts`)).rows[0]; }
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
async function audit(label) {
  const functions = (await admin.query(`select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public,
    coalesce((select tgrelid from pg_trigger where tgfoid=p.oid limit 1),0)::text relid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and (p.proname like '%live_battle%' or p.proname='live_emit_reaction') order by 1`)).rows;
  const lint = [];
  for (const f of functions) {
    const lang = (await admin.query('select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1::regprocedure', [f.signature])).rows[0].lanname;
    if (lang !== 'plpgsql') continue;
    const rows = (await admin.query('select * from public.plpgsql_check_function_tb($1::regprocedure, relid := $2::oid::regclass)', [f.signature, f.relid])).rows;
    for (const row of rows) lint.push({ signature: f.signature, ...row });
  }
  const tables = (await admin.query(`select relname,relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated,
    has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') service_role
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='live_battle_like_score_events'`)).rows;
  writeFileSync(evidence + label + '.json', JSON.stringify({ functions, tables, lint }, null, 2));
  return { functions, tables, lint };
}

async function journal(f) {
  return (await admin.query(`select count(*)::int rows,coalesce(sum(accepted_count),0)::int likes,
    coalesce(sum(awarded_points),0)::int points from public.live_battle_like_score_events where battle_id=$1`, [f.battle])).rows[0];
}
async function actor(f, index = 0) { await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [f.users[index]]); }
async function flood(f, count = 1000) { for (let i = 0; i < count; i++) assert.deepEqual(await like(admin, f, 1), { accepted: 0, points: 0 }); }
async function ended(f) { await admin.query("update public.live_battles set status='completed',ended_at=scheduled_end_at,version=version+1 where id=$1", [f.battle]); }
async function transaction(name, fn) {
  await admin.query('begin');
  try { await check(name, fn); } finally { await admin.query('rollback'); }
}
async function snapshot(f) {
  return { journal: await journal(f), score: await state(f), money: await money(),
    public: (await admin.query('select * from public.live_battle_public_states where battle_id=$1 order by session_id', [f.battle])).rows };
}
async function expired(f) {
  await admin.query("with t as (select clock_timestamp()-interval '1 second' deadline) update public.live_battles set countdown_started_at=t.deadline-interval '303 seconds',scheduled_start_at=t.deadline-interval '300 seconds',started_at=t.deadline-interval '300 seconds',scheduled_end_at=t.deadline from t where id=$1", [f.battle]);
}
async function projection(f) {
  const s = await state(f);
  const expected = (await admin.query(`select target_user_id,sum(awarded_points)::bigint points from (
    select target_user_id,awarded_points from public.live_battle_score_events where battle_id=$1
    union all select target_user_id,awarded_points from public.live_battle_like_score_events where battle_id=$1
    ) journals group by target_user_id`, [f.battle])).rows;
  for (const [i, side] of [[1, 'challenger'], [2, 'opponent']]) assert.equal(Number(s[side + '_score']), Number(expected.find(r => r.target_user_id === f.users[i])?.points ?? 0));
  const projections = (await admin.query('select challenger_score,opponent_score from public.live_battle_public_states where battle_id=$1', [f.battle])).rows;
  assert.equal(projections.length, 2);
  for (const p of projections) { assert.equal(String(p.challenger_score), String(s.challenger_score)); assert.equal(String(p.opponent_score), String(s.opponent_score)); }
}
try {
  await Promise.all([admin.connect(), a.connect(), b.connect()]);
  for (const c of [admin, a, b]) await c.query("set statement_timeout='15s'");
  await audit(action + '-security-lint');
  if (action === 'red') {
    await admin.query('begin');
    const f = await fixture(); await actor(f);
    for (let i = 0; i < 20; i++) await like(admin, f, 1);
    const before = await journal(f); await flood(f); const after = await journal(f);
    const closed = await fixture(); await actor(closed); await ended(closed); await flood(closed);
    const result = { base: 'adb741677a8d80f9bb9d54ba3a0572c22cd4964e', before, after,
      closed: await journal(closed), expectedAfter: { rows: 20, likes: 20, points: 100 }, expectedClosedRows: 0 };
    writeFileSync(evidence + 'red-postgres.json', JSON.stringify(result, null, 2));
    assert.equal(after.rows, 1020); assert.equal(result.closed.rows, 1000);
    console.log('RED reproduced: cap 20 -> 1020 rows; closed Battle 1000 zero rows');
  } else if (action === 'green') {
    await transaction('20 individual positives + 1000 unique over-cap requests: exactly 20 rows/20 likes/100 points', async () => {
      const f = await fixture(); await actor(f);
      for (let i = 0; i < 20; i++) assert.deepEqual(await like(admin, f, 1), { accepted: 1, points: 5 });
      assert.deepEqual(await journal(f), { rows: 20, likes: 20, points: 100 });
      const before = await snapshot(f); await flood(f); assert.deepEqual(await snapshot(f), before);
      assert.equal(Number(before.score.challenger_score), 100); await projection(f);
    });
    for (const scenario of ['closed', 'deadline', 'historical', 'host', 'nonparticipant', 'countdown']) {
      await transaction(`1000 unique ${scenario} attempts persist no rows, points or side effects`, async () => {
        const f = await fixture(scenario === 'historical' ? 2 : null); await actor(f);
        if (scenario === 'closed') await ended(f);
        if (scenario === 'deadline') await expired(f);
        if (scenario === 'host') await actor(f, 1);
        if (scenario === 'countdown') await admin.query("update public.live_battles set status='countdown',started_at=null,scheduled_end_at=null where id=$1", [f.battle]);
        if (scenario === 'nonparticipant') await admin.query("update public.live_participants set status='inactive' where user_id=$1", [f.users[0]]);
        const before = await snapshot(f);
        if (scenario === 'nonparticipant') {
          for (let i = 0; i < 1000; i++) {
            await admin.query('savepoint rejected');
            await assert.rejects(like(admin, f, 1), /live_participant_required/);
            await admin.query('rollback to rejected'); await admin.query('release rejected');
          }
        } else await flood(f);
        assert.deepEqual(await journal(f), { rows: 0, likes: 0, points: 0 }); assert.deepEqual(await snapshot(f), before);
      });
    }
    await transaction('partial 18+5 accepts 2 in one positive row; positive replay survives close; payload conflict', async () => {
      const f = await fixture(); await actor(f); await like(admin, f, 18); const key = randomUUID();
      const receipt = await like(admin, f, 5, key); assert.deepEqual(receipt, { accepted: 2, points: 10 });
      assert.deepEqual(await journal(f), { rows: 2, likes: 20, points: 100 });
      const row = (await admin.query('select requested_count,accepted_count,awarded_points from public.live_battle_like_score_events where battle_id=$1 and idempotency_key=$2', [f.battle, key])).rows[0];
      assert.equal(row.requested_count, 5); assert.equal(row.accepted_count, 2); assert.equal(Number(row.awarded_points), 10);
      const before = await snapshot(f); await flood(f); assert.deepEqual(await snapshot(f), before);
      await ended(f); await admin.query("update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1", [f.sessions[0]]);
      await admin.query("update public.live_participants set status='inactive' where user_id=$1", [f.users[0]]);
      const closed = await snapshot(f); assert.deepEqual(await like(admin, f, 5, key), receipt); assert.deepEqual(await snapshot(f), closed);
      for (const [count, side] of [[4, 0], [5, 1]]) {
        await admin.query('savepoint conflict'); await assert.rejects(like(admin, f, count, key, side), /live_battle_like_idempotency_conflict/);
        await admin.query('rollback to conflict'); await admin.query('release conflict');
      }
      assert.deepEqual(await snapshot(f), closed);
    });
    for (const [id, cost] of [['heart', 1], ['rose', 5]]) for (const multiplier of [1, 2, 3]) {
      await transaction(`${id} x${multiplier}: money/commission intact; likes stay +5 and winner uses combined journal`, async () => {
        const f = await fixture(); await actor(f);
        if (multiplier === 2) for (let i = 0; i < 10; i++) await gift(admin, f, 'rose');
        if (multiplier === 3) { await actor(f, 1); await admin.query('select * from public.activate_live_battle_glove($1,$2)', [f.battle, randomUUID()]); await actor(f); }
        const beforeGift = await money(); const g = await gift(admin, f, id);
        const score = (await admin.query('select base_points,multiplier,awarded_points from public.live_battle_score_events where gift_transaction_id=$1', [g.transaction_id])).rows[0];
        assert.equal(Number(score.base_points), cost * 10); assert.equal(score.multiplier, multiplier); assert.equal(Number(score.awarded_points), cost * 10 * multiplier);
        const financial = (await admin.query('select f.amount,f.fee_amount from public.financial_transactions f join public.live_gift_transactions g on g.financial_transaction_id=f.id where g.id=$1', [g.transaction_id])).rows[0];
        assert.equal(Number(financial.amount), cost); assert.equal(Number(financial.fee_amount), cost === 5 ? 2 : 0);
        const afterGift = await money(); assert.equal(Number(afterGift.financial) - Number(beforeGift.financial), 1); assert.equal(Number(afterGift.ledger) - Number(beforeGift.ledger), cost === 1 ? 2 : 3);
        assert.equal(Number(afterGift.roses) - Number(beforeGift.roses), id === 'rose' && multiplier !== 2 ? 1 : 0);
        const beforeLike = await money(); assert.deepEqual(await like(admin, f, 1), { accepted: 1, points: 5 }); assert.deepEqual(await money(), beforeLike);
        await ended(f); await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f.battle]);
        assert.equal((await state(f)).winner_user_id, f.users[1]); await projection(f);
      });
    }
    await transaction('positive constraints, ACL, RLS, owner/search_path and direct mutations', async () => {
      const f = await fixture(); await actor(f); await like(admin, f, 1);
      const auditResult = await audit('green-security-lint');
      for (const fn of auditResult.functions.filter(r => /send_live_battle_likes|validate_live_battle_like_event|reject_live_battle_like_mutation/.test(r.signature))) {
        assert.equal(fn.owner, 'postgres'); assert.deepEqual(fn.proconfig, ['search_path=""']); assert.equal(fn.anon, false); assert.equal(fn.service_role, false); assert.equal(fn.public, false);
        assert.equal(fn.authenticated, fn.signature.startsWith('send_live_battle_likes')); assert.equal(fn.prosecdef, !fn.signature.startsWith('private.reject_'));
      }
      assert.equal(auditResult.tables[0].relrowsecurity, true); assert.equal(auditResult.tables[0].authenticated, false);
      for (const role of ['anon', 'authenticated', 'service_role']) for (const statement of ['select * from public.live_battle_like_score_events', 'insert into public.live_battle_like_score_events default values', 'update public.live_battle_like_score_events set accepted_count=0', 'delete from public.live_battle_like_score_events', 'truncate public.live_battle_like_score_events']) {
        await admin.query('savepoint acl'); await admin.query('set local role ' + role); await assert.rejects(admin.query(statement), /permission denied/); await admin.query('rollback to acl'); await admin.query('release acl');
      }
      for (const role of ['anon', 'service_role']) { await admin.query('savepoint rpc'); await admin.query('set local role ' + role); await assert.rejects(like(admin, f, 1), /permission denied/); await admin.query('rollback to rpc'); await admin.query('release rpc'); }
      await admin.query('savepoint auth'); await admin.query("select set_config('request.jwt.claim.sub','',true)"); await assert.rejects(like(admin, f, 1), /live_auth_required/); await admin.query('rollback to auth'); await admin.query('release auth');
      await admin.query('savepoint immutable'); await assert.rejects(admin.query('update public.live_battle_like_score_events set accepted_count=0'), /live_battle_like_immutable/); await admin.query('rollback to immutable'); await admin.query('release immutable');
      // Disable the insert trigger only inside this rolled-back local savepoint to prove CHECK constraints independently.
      await admin.query('savepoint constraint_fixture'); await admin.query('alter table public.live_battle_like_score_events disable trigger live_battle_like_validate');
      for (const [requested, accepted, points, awarded] of [[0,1,5,5], [1,0,5,0], [1,2,5,10], [1,1,0,0], [1,1,5,0], [1,1,5,6]]) {
        await admin.query('savepoint bad');
        await assert.rejects(admin.query(`insert into public.live_battle_like_score_events(battle_id,actor_user_id,target_user_id,session_id,requested_count,accepted_count,like_points,awarded_points,rule_set_id,rule_version,idempotency_key)
          select battle_id,actor_user_id,target_user_id,session_id,$2,$3,$4,$5,rule_set_id,rule_version,$6 from public.live_battle_like_score_events where battle_id=$1 limit 1`, [f.battle, requested, accepted, points, awarded, randomUUID()]), /check constraint/);
        await admin.query('rollback to bad'); await admin.query('release bad');
      }
      await admin.query('rollback to constraint_fixture'); await admin.query('release constraint_fixture');
    });
    // Shared committed setup is required for independent PostgreSQL sessions. All
    // workers end with ROLLBACK; the entire container/volume is destroyed afterward.
    await check('real same-key concurrency returns one positive receipt; distinct keys stay bounded', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await claim(b, f.users[0]); const key = randomUUID();
      const receipts = await Promise.all([like(a, f, 1, key), like(b, f, 1, key)]); assert.deepEqual(receipts[0], receipts[1]);
      assert.deepEqual(await journal(f), { rows: 1, likes: 1, points: 5 });
      const replies = await Promise.all([like(a, f, 16), like(b, f, 16)]); assert.equal(replies.reduce((s,r) => s+r.accepted, 0), 19);
      const before = await snapshot(f); await Promise.all([like(a, f, 16), like(b, f, 16)]); assert.deepEqual(await snapshot(f), before);
      assert.deepEqual(await journal(f), { rows: 3, likes: 20, points: 100 }); await projection(f);
      await a.query('rollback'); await b.query('rollback'); await admin.query('rollback');
    });
    await check('concurrent gifts+likes reconcile deterministically; viewers have independent quotas', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await claim(b, f.users[3]);
      await Promise.all([gift(a, f, 'rose'), like(b, f, 20)]); assert.equal(Number((await state(f)).challenger_score), 150);
      await like(a, f, 20, randomUUID(), 1); assert.deepEqual(await journal(f), { rows: 2, likes: 40, points: 200 });
      await ended(f); await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f.battle]); const before = await snapshot(f);
      await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f.battle]); assert.deepEqual(await snapshot(f), before);
      assert.equal(before.score.winner_user_id, f.users[1]); await projection(f);
      await a.query('rollback'); await b.query('rollback'); await admin.query('rollback');
    });
    await check('waiting request checks deadline after canonical lock and leaves no receipt', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await admin.query('begin'); await expired(f);
      const waiting = like(a, f, 1); await admin.query('commit'); assert.deepEqual(await waiting, { accepted: 0, points: 0 });
      assert.deepEqual(await journal(f), { rows: 0, likes: 0, points: 0 });
      await admin.query('begin'); await admin.query('select id from public.live_battles where id=$1 for update', [f.battle]);
      const finalizing = like(a, f, 1); await ended(f); await admin.query('commit'); assert.deepEqual(await finalizing, { accepted: 0, points: 0 });
      assert.deepEqual(await journal(f), { rows: 0, likes: 0, points: 0 });
      await a.query('rollback'); await admin.query('rollback');
    });
    writeFileSync(evidence + 'green-postgres.json', JSON.stringify({ passed: results.length, failed: 0, skipped: 0, cases: results,
      maximumRowsPerViewerBattle: 20, maximumLikes: 20, maximumPoints: 100, zeroReceiptRows: 0, rollback: 'Every sequential case and all concurrent connections end with ROLLBACK; committed shared fixtures destroyed with container and volumes' }, null, 2));
  } else throw Error('Expected red or green');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { for (const c of [admin, a, b]) { await c.query('rollback').catch(() => {}); await c.end(); } }
