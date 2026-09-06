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
const evidence = 'docs/validation/lb4-f9-a/';
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
try {
  await Promise.all([admin.connect(), a.connect(), b.connect()]);
  for (const c of [admin, a, b]) await c.query("set statement_timeout='15s'");
  if (action === 'baseline') {
    await audit('security-lint-before');
    await admin.query('begin');
    try {
      const f = await fixture(); await claim(a, f.users[0]);
      // Authenticated connection cannot see uncommitted fixtures; use the same transaction for red.
      await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [f.users[0]]);
      const red = [];
      for (const [id, expected] of [['heart', 10], ['rose', 50]]) {
        const result = await gift(admin, f, id);
        const actual = Number((await admin.query('select base_points from public.live_battle_score_events where gift_transaction_id=$1', [result.transaction_id])).rows[0].base_points);
        red.push({ case: id, expected, actual, passed: actual === expected });
      }
      const likeExists = (await admin.query("select to_regprocedure('public.send_live_battle_likes(uuid,uuid,integer,text)') is not null present")).rows[0].present;
      for (const name of ['like score', 'viewer cap', 'like idempotency', 'combined reconciliation']) red.push({ case: name, expected: true, actual: likeExists, passed: likeExists });
      writeFileSync(evidence + 'red-postgres.json', JSON.stringify(red, null, 2));
      assert.equal(red.filter(r => !r.passed).length, 6);
      console.log('RED PostgreSQL: six expected failures reproduced');
    } finally { await admin.query('rollback'); }
    // A real pre-migration Battle proves pinning and no historical score rewrite.
    const pinned = await fixture(); await claim(a, pinned.users[0]); await gift(a, pinned, 'heart');
    writeFileSync(join(tmpdir(), 'lb4-f9-pinned-fixture.json'), JSON.stringify(pinned));
    writeFileSync(evidence + 'migration-before.json', JSON.stringify({ money: await money(), score: Number((await state(pinned)).challenger_score) }, null, 2));
  } else if (action === 'green') {
    await check('migration preserves existing Battle rule, money and score facts', async () => {
      const pinned = JSON.parse(readFileSync(join(tmpdir(), 'lb4-f9-pinned-fixture.json'), 'utf8'));
      const before = JSON.parse(readFileSync(evidence + 'migration-before.json', 'utf8'));
      const after = { money: await money(), score: Number((await state(pinned)).challenger_score) };
      assert.deepEqual(after, before); assert.equal(after.score, 1);
      await claim(a, pinned.users[0]); await gift(a, pinned, 'heart'); assert.equal(Number((await state(pinned)).challenger_score), 2);
      writeFileSync(evidence + 'migration-after.json', JSON.stringify(after, null, 2));
    });
    for (const [id, cost] of [['heart', 1], ['brillo_suave', 2], ['rose', 5], ['fire', 10]]) for (const multiplier of [1, 2, 3]) {
      await check(`${id} x${multiplier}: score/ledger/rose contract`, async () => {
        const f = await fixture(); await claim(a, f.users[0]);
        if (multiplier === 2) for (let i = 0; i < 10; i++) await gift(a, f, 'rose');
        if (multiplier === 3) { await claim(b, f.users[1]); await b.query('select * from public.activate_live_battle_glove($1,$2)', [f.battle, randomUUID()]); }
        const before = await money();
        const receipt = await gift(a, f, id);
        const score = (await admin.query('select base_points,multiplier,awarded_points from public.live_battle_score_events where gift_transaction_id=$1', [receipt.transaction_id])).rows[0];
        assert.equal(Number(score.base_points), cost * 10); assert.equal(score.multiplier, multiplier); assert.equal(Number(score.awarded_points), cost * 10 * multiplier);
        const after = await money(); assert.equal(Number(after.financial) - Number(before.financial), 1); assert.equal(Number(after.gifts) - Number(before.gifts), 1);
        assert.equal(Number(after.ledger) - Number(before.ledger), cost === 1 ? 2 : 3); assert.equal(after.balances, before.balances);
        assert.equal(Number(after.roses) - Number(before.roses), id === 'rose' && multiplier !== 2 ? 1 : 0);
        const split = (await admin.query('select * from private.live_gift_commission_split($1)', [cost])).rows[0];
        const financial = (await admin.query('select f.* from public.financial_transactions f join public.live_gift_transactions g on g.financial_transaction_id=f.id where g.id=$1', [receipt.transaction_id])).rows[0];
        assert.equal(Number(financial.amount), cost); assert.equal(Number(financial.fee_amount), Number(split.platform_fee_amount));
      });
    }
    await check('old pinned v2 gifts keep original points and free likes disabled', async () => {
      const f = await fixture(2); await claim(a, f.users[0]); const g = await gift(a, f, 'rose');
      assert.equal(Number((await admin.query('select awarded_points from public.live_battle_score_events where gift_transaction_id=$1', [g.transaction_id])).rows[0].awarded_points), 5);
      assert.deepEqual(await like(a, f, 20), { accepted: 0, points: 0 });
    });
    for (const count of [1, 10, 20]) await check(`${count} likes: exact free points, no money/rose/boost`, async () => {
      const f = await fixture(); await claim(a, f.users[0]); const before = await money();
      assert.deepEqual(await like(a, f, count), { accepted: count, points: count * 5 }); assert.deepEqual(await money(), before);
    });
    await check('20 cap, remainder, cross-side cap and independent viewers', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await like(a, f, 18);
      assert.deepEqual(await like(a, f, 5), { accepted: 2, points: 10 });
      assert.deepEqual(await like(a, f, 1, randomUUID(), 1), { accepted: 0, points: 0 });
      await claim(b, f.users[3]); assert.deepEqual(await like(b, f, 20, randomUUID(), 1), { accepted: 20, points: 100 });
      const s = await state(f); assert.equal(Number(s.challenger_score), 100); assert.equal(Number(s.opponent_score), 100);
      const other = await fixture(null, f.users[0]); assert.deepEqual(await like(a, other, 1), { accepted: 1, points: 5 });
    });
    await check('same-key concurrency and payload conflict fail closed', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await claim(b, f.users[0]); const key = randomUUID();
      const replies = await Promise.all([like(a, f, 10, key), like(b, f, 10, key)]); assert.deepEqual(replies[0], replies[1]);
      assert.equal(Number((await state(f)).challenger_score), 50);
      await assert.rejects(like(a, f, 9, key), /live_battle_like_idempotency_conflict/);
      await assert.rejects(like(a, f, 10, key, 1), /live_battle_like_idempotency_conflict/);
      assert.equal(Number((await admin.query('select count(*) from public.live_battle_like_score_events where battle_id=$1', [f.battle])).rows[0].count), 1);
    });
    await check('different-key concurrency never exceeds cap; gift+like totals reconstruct', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await claim(b, f.users[0]);
      const replies = await Promise.all([like(a, f, 16), like(b, f, 16)]); assert.equal(replies.reduce((sum, r) => sum + r.accepted, 0), 20);
      const f2 = await fixture(); await claim(a, f2.users[0]); await claim(b, f2.users[3]);
      await Promise.all([gift(a, f2, 'rose'), like(b, f2, 10)]);
      const before = await state(f2); assert.equal(Number(before.challenger_score), 100);
      await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f2.battle]);
      assert.deepEqual(await state(f2), before);
    });
    await check('host, unauthenticated, wrong session and invalid counts cannot score', async () => {
      const f = await fixture(); await claim(a, f.users[1]); assert.deepEqual(await like(a, f, 1), { accepted: 0, points: 0 });
      await claim(a, null); await assert.rejects(like(a, f, 1), /live_auth_required/);
      await claim(a, f.users[0]); for (const count of [0, -1, 65]) await assert.rejects(like(a, f, count), /live_battle_like_input_invalid/);
      await assert.rejects(a.query('select * from public.send_live_battle_likes($1,$2,1,$3)', [randomUUID(), f.battle, randomUUID()]), /live_battle_like_session_invalid/);
      assert.equal(Number((await state(f)).challenger_score), 0);
    });
    await check('both session targets are authoritative; membership is mandatory', async () => {
      const f = await fixture(); await claim(a, f.users[0]);
      assert.deepEqual(await like(a, f, 1, randomUUID(), 0), { accepted: 1, points: 5 });
      assert.deepEqual(await like(a, f, 1, randomUUID(), 1), { accepted: 1, points: 5 });
      const s = await state(f); assert.equal(Number(s.challenger_score), 5); assert.equal(Number(s.opponent_score), 5);
      await admin.query("update public.live_participants set status='inactive' where session_id=$1 and user_id=$2", [f.sessions[0], f.users[0]]);
      await assert.rejects(like(a, f, 1), /live_participant_required/);
    });
    await check('countdown and active-before-start give zero; ordinary LIVE remains visual', async () => {
      const f = await fixture(); await claim(a, f.users[0]);
      await admin.query("update public.live_battles set status='countdown',started_at=null,scheduled_end_at=null where id=$1", [f.battle]);
      assert.deepEqual(await like(a, f, 1), { accepted: 0, points: 0 });
      await admin.query("with t as (select clock_timestamp()+interval '10 seconds' start_at) update public.live_battles set status='active',countdown_started_at=t.start_at-interval '3 seconds',scheduled_start_at=t.start_at,started_at=t.start_at,scheduled_end_at=t.start_at+interval '300 seconds' from t where id=$1", [f.battle]);
      assert.deepEqual(await like(a, f, 1), { accepted: 0, points: 0 });
      const session = randomUUID();
      await admin.query("insert into public.live_sessions(id,host_id,title,status,started_at,last_heartbeat_at) values($1,$2,'normal fixture','live',now(),now())", [session, f.users[3]]);
      await admin.query("insert into public.live_participants(session_id,user_id,role,status) values($1,$2,'audience','active')", [session, f.users[0]]);
      const before = await money();
      const event = (await a.query('select * from public.live_emit_reaction($1,$2)', [session, '❤️'])).rows[0];
      assert.equal(event.event_type, 'reaction'); assert.deepEqual(await money(), before);
      assert.equal(Number((await state(f)).challenger_score), 0);
    });
    await check('x2 and x3 do not multiply likes or advance roses', async () => {
      for (const boost of [2, 3]) {
        const f = await fixture(); await claim(a, f.users[0]);
        if (boost === 2) for (let i = 0; i < 10; i++) await gift(a, f, 'rose');
        else { await claim(b, f.users[1]); await b.query('select * from public.activate_live_battle_glove($1,$2)', [f.battle, randomUUID()]); }
        const before = await money(); assert.deepEqual(await like(a, f, 1), { accepted: 1, points: 5 }); assert.deepEqual(await money(), before);
      }
    });
    await check('finalization includes likes; replay survives closure and new attempts score zero', async () => {
      const f = await fixture(); await claim(a, f.users[0]); const key = randomUUID(); const first = await like(a, f, 3, key, 1);
      await admin.query("update public.live_battles set status='completed',ended_at=scheduled_end_at,version=version+1 where id=$1", [f.battle]);
      await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f.battle]);
      assert.equal((await state(f)).winner_user_id, f.users[2]);
      await admin.query("update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1", [f.sessions[1]]);
      await admin.query("update public.live_participants set status='inactive' where session_id=$1 and user_id=$2", [f.sessions[1], f.users[0]]);
      assert.deepEqual(await like(a, f, 3, key, 1), first); assert.deepEqual(await like(a, f, 1), { accepted: 0, points: 0 });
      assert.equal(Number((await state(f)).opponent_score), 15);
    });
    await check('authoritative start and deadline checked after waiting for Battle lock', async () => {
      const f = await fixture(); await claim(a, f.users[0]);
      await admin.query('begin');
      await admin.query("with t as (select clock_timestamp()+interval '200 milliseconds' deadline) update public.live_battles set countdown_started_at=t.deadline-interval '303 seconds',scheduled_start_at=t.deadline-interval '300 seconds',started_at=t.deadline-interval '300 seconds',scheduled_end_at=t.deadline from t where id=$1", [f.battle]);
      const waiting = like(a, f, 1); await admin.query('select pg_sleep(0.3)'); await admin.query('commit');
      assert.deepEqual(await waiting, { accepted: 0, points: 0 });
      await admin.query('begin'); await admin.query('select id from public.live_battles where id=$1 for update', [f.battle]);
      const finalizing = like(a, f, 1);
      await admin.query("update public.live_battles set status='completed',ended_at=scheduled_end_at where id=$1", [f.battle]);
      await admin.query('select private.reconcile_live_battle_score_locked($1,clock_timestamp())', [f.battle]);
      await admin.query('commit'); assert.deepEqual(await finalizing, { accepted: 0, points: 0 });
    });
    await check('table mutations/reads and anon RPC are denied; immutable receipts', async () => {
      const f = await fixture(); await claim(a, f.users[0]); await like(a, f, 1);
      for (const sql of ['select * from public.live_battle_like_score_events', 'delete from public.live_battle_like_score_events', 'update public.live_battle_like_score_events set accepted_count=0', 'truncate public.live_battle_like_score_events', 'insert into public.live_battle_like_score_events default values']) await assert.rejects(a.query(sql), /permission denied/);
      await a.query('reset role'); await a.query('set role anon'); await assert.rejects(like(a, f, 1), /permission denied/);
      await assert.rejects(admin.query('update public.live_battle_like_score_events set accepted_count=0 where battle_id=$1', [f.battle]), /live_battle_like_immutable/);
    });
    const auditResult = await audit('security-lint-after');
    const introduced = auditResult.functions.filter(f => /send_live_battle_likes|validate_live_battle_like_event|reject_live_battle_like_mutation/.test(f.signature));
    assert.equal(introduced.length, 3);
    for (const f of introduced) { assert.equal(f.owner, 'postgres'); assert.deepEqual(f.proconfig, ['search_path=""']); assert.equal(f.anon, false); assert.equal(f.service_role, false); assert.equal(f.public, false); assert.equal(f.authenticated, f.signature.startsWith('send_live_battle_likes')); }
    assert.equal(auditResult.tables[0].relrowsecurity, true); assert.equal(auditResult.tables[0].authenticated, false);
    writeFileSync(evidence + 'green-postgres.json', JSON.stringify({ passed: results.length, failed: 0, cases: results, cleanup: 'Destroy clipdag-lb4-f9-proof after all local validation; no production connection accepted' }, null, 2));
  } else throw Error('Expected baseline or green');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await admin.query('rollback').catch(() => {});
  await Promise.all([admin.end(), a.end(), b.end()]);
}
