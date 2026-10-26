import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Creates and drops only its own randomly named database on a loopback server.
// Canonical functions execute unchanged; minimal table shape is deliberately
// not advertised as a production schema restore or full-schema E2E proof.
const url = new URL(process.env.LIVE_BATTLES_C1_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55426/postgres');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'loopback database required');
assert.equal(url.search, '', 'connection query overrides are forbidden');
const red = process.argv.includes('--red');
const database = `live_battles_c1_proof_${randomUUID().replaceAll('-', '')}`;
const root = new URL('../', import.meta.url);
const migrationDir = new URL('supabase/migrations/', root);
const files = readdirSync(migrationDir).sort();
const candidate = files.filter(f => /live_battles_final_c1/.test(f));
assert.equal(candidate.length, 1);
const sources = files.filter(f => f < candidate[0]).map(f => readFileSync(new URL(f, migrationDir), 'utf8').replaceAll('\r', ''));
function canonical(name) {
  const escaped = name.replaceAll('.', '\\.');
  let result;
  for (const source of sources) {
    const match = source.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\bas (\\$[a-z_]*\\$)[\\s\\S]*?\\1;`, 'i'));
    if (match) result = match[0];
  }
  assert.ok(result, `canonical function ${name}`);
  return result;
}
function table(name) {
  for (const source of sources) {
    const match = source.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
    if (match) return match[0];
  }
  throw new Error(`missing canonical table ${name}`);
}
const admin = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
const clients = [];
let created = false;
let failures = 0;
async function connect() {
  const target = new URL(url); target.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 5000 });
  await client.connect(); clients.push(client);
  await client.query("set statement_timeout='8s'; set lock_timeout='6s'");
  return client;
}
async function run(name, body) {
  try { await body(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { await Promise.all(clients.map(client=>client.query('rollback; reset role'))); }
}
async function rejected(promise, message, code) {
  await assert.rejects(promise, e => (!message || e.message.includes(message)) && (!code || e.code === code));
}
async function auth(client, id) { await client.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function waiting(observer, client) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    const { rows } = await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [client.processID]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('second connection did not wait on a lock');
}

try {
  await admin.connect();
  await admin.query(`create database ${database}`); created = true;
  const db = await connect();
  await db.query(readFileSync(new URL('tests/fixtures/live_battles_final_c1_fixture.sql', root), 'utf8'));
  for (const name of ['live_battles', 'live_battle_events', 'live_battle_series', 'live_battle_rematch_requests', 'live_gift_transactions']) await db.query(table(name));
  await db.query(`
    alter table public.live_battles add column series_id uuid references public.live_battle_series,
      add column round_number integer default 1, add column battle_rule_set_id uuid;
    alter table public.live_gift_transactions add column battle_id uuid references public.live_battles on delete restrict,
      add column financial_transaction_id uuid references public.financial_transactions on delete restrict;
    create unique index proof_open_pair on public.live_battle_series(least(challenger_user_id,opponent_user_id),greatest(challenger_user_id,opponent_user_id)) where status in ('active','awaiting_rematch','rematch_pending');
    create unique index proof_battle_gift_key on public.live_gift_transactions(sender_user_id,battle_id,idempotency_key) where battle_id is not null;
    create unique index proof_gift_finance on public.live_gift_transactions(financial_transaction_id);
  `);
  for (const name of ['live_battle_score_states', 'live_battle_score_events']) await db.query(table(name));
  await db.query('alter table public.live_battle_score_events drop constraint live_battle_score_events_f4b_rule_check');
  const functions = [
    'public.ensure_ledger_account', 'public.ledger_debit', 'public.ledger_credit', 'public.atomic_ledger_transfer',
    'private.live_gift_commission_split', 'private.verify_live_gift_journal',
    'private.live_battle_lock_users', 'private.live_battle_lock_sessions', 'private.live_battle_session_pair_is_live',
    'private.live_battle_to_json', 'private.live_battle_series_champion', 'private.sync_live_battle_series_projection_locked',
    'private.rebuild_live_battle_series_locked', 'private.reconcile_live_battle_series_locked',
    'private.reconcile_due_live_battle_series', 'private.live_battle_series_score_finalized_trigger',
    'private.sync_live_battle_public_states', 'private.resolve_live_battle_effective_boost_locked',
    'private.advance_live_battle_rose_mission_locked', 'private.live_battle_score_event_contract_is_valid',
    'private.record_live_battle_score_locked', 'private.reconcile_live_battle_score_locked',
    'private.live_battle_transition', 'private.live_battle_reconcile_locked',
    'public.create_live_battle_invite', 'public.send_live_gift', 'public.send_live_battle_gift',
  ];
  for (const name of functions) await db.query(canonical(name));
  // Match deployed security hardening of the unchanged financial functions.
  for (const signature of ['ensure_ledger_account(uuid)', 'ledger_debit(uuid,uuid,numeric,text,jsonb)', 'ledger_credit(uuid,uuid,numeric,text,jsonb)', 'atomic_ledger_transfer(uuid,uuid,numeric,numeric,text,text,text,uuid,text)']) {
    await db.query(`alter function public.${signature} set search_path=public,pg_catalog`);
  }
  await db.query(`
    create trigger live_battles_sync_series_public_states after insert or update or delete on public.live_battles for each row execute function private.sync_live_battle_public_states();
    create trigger live_battle_score_states_rebuild_series after insert or update on public.live_battle_score_states for each row execute function private.live_battle_series_score_finalized_trigger();
    alter table public.live_gift_transactions enable row level security;
    alter table public.live_battle_score_states enable row level security;
    alter table public.live_battle_public_states enable row level security;
    revoke all on public.live_gift_transactions, public.live_battle_score_states, public.live_battle_public_states from public,anon,authenticated,service_role;
    grant select on public.live_gift_transactions, public.live_battle_public_states to authenticated;
    revoke all on all functions in schema private from public,anon,authenticated,service_role;
    revoke all on function public.send_live_gift(uuid,text,text),public.send_live_battle_gift(uuid,uuid,text,text),public.create_live_battle_invite(uuid,uuid,uuid) from public,anon,authenticated,service_role;
    grant execute on function public.send_live_gift(uuid,text,text),public.send_live_battle_gift(uuid,uuid,text,text),public.create_live_battle_invite(uuid,uuid,uuid) to authenticated;
    create policy gift_participant on public.live_gift_transactions for select to authenticated using(auth.uid() in(sender_user_id,receiver_user_id));
    insert into public.gift_catalog values('proof','*',100,true,true),('tiny','.',1,true,true);
    insert into public.ledger_accounts(account_type,balance) values('platform',0);
    insert into public.live_battle_rule_sets(id) values('00000000-0000-4000-8000-000000000001');
    insert into public.live_battle_current_rule_set values(true,'00000000-0000-4000-8000-000000000001');
  `);
  async function pair(status = 'pending', client = db, senderFirst = false) {
    const ids = Array.from({length: 7}, randomUUID);
    if(senderFirst){ const ordered=ids.slice(0,3).sort(); [ids[0],ids[1],ids[2]]=[ordered[1],ordered[2],ordered[0]]; }
    const [host, opponent, sender, first, second, series, battle] = ids;
    await client.query('insert into auth.users(id) select unnest($1::uuid[])', [[host, opponent, sender]]);
    await client.query('insert into public.live_sessions(id,host_id) values($1,$2),($3,$4)', [first,host,second,opponent]);
    await client.query("insert into public.ledger_accounts(owner_id,account_type,balance) values($1,'user',10000),($2,'user',0),($3,'user',0)",[sender,host,opponent]);
    if(status==='fresh') return {host,opponent,sender,first,second,series,battle};
    await client.query(`insert into public.live_battle_series(id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,format,max_rounds,wins_required)
      values($1,$2,$3,$4,$5,'best_of_5',5,3)`, [series,host,opponent,first,second]);
    await client.query(`insert into public.live_battles(id,challenger_user_id,opponent_user_id,challenger_session_id,opponent_session_id,invite_expires_at,last_transition_reason,series_id,battle_rule_set_id)
      values($1,$2,$3,$4,$5,now()+interval '30 seconds','invite_created',$6,'00000000-0000-4000-8000-000000000001')`,[battle,host,opponent,first,second,series]);
    await client.query('insert into public.live_battle_score_states(battle_id) values($1)',[battle]);
    await client.query(`insert into public.live_battle_public_states(session_id,battle_id,opponent_session_id,local_host_user_id,opponent_host_user_id)
      values($1,$2,$3,$4,$5),($3,$2,$1,$5,$4)`,[first,battle,second,host,opponent]);
    await client.query("insert into public.live_battle_power_states(battle_id,side) values($1,'challenger'),($1,'opponent')",[battle]);
    if (status === 'active') {
      for (const [from,to,actor,reason] of [['pending','accepted',opponent,'invite_accepted'],['accepted','countdown',host,'countdown_started'],['countdown','active',null,'countdown_elapsed']]) {
        await client.query('select private.live_battle_transition($1,$2,$3,$4,$5,clock_timestamp())',[battle,from,to,actor,reason]);
      }
    }
    return {host,opponent,sender,first,second,series,battle};
  }
  async function transition(p, status, client=db) {
    return client.query("select private.live_battle_transition($1,'pending',$2,$3,$4,clock_timestamp()+interval '31 seconds')", [p.battle,status,status==='rejected'?p.opponent:null,status==='rejected'?'invite_rejected':'invite_expired']);
  }
  async function state(p) { return (await db.query('select * from public.live_battle_series where id=$1',[p.series])).rows[0]; }
  async function gift(p, key, battle=false, client=db, giftId='proof') {
    await auth(client,p.sender);
    return battle ? client.query('select * from public.send_live_battle_gift($1,$2,$3,$4)',[p.battle,p.host,giftId,key]) : client.query('select * from public.send_live_gift($1,$2,$3)',[p.first,giftId,key]);
  }
  const orphan = await pair(); await transition(orphan,'expired');
  const migration = readFileSync(new URL(candidate[0],migrationDir),'utf8');
  if (!red) {
    // Exact candidate bytes: zero/two candidates and unresolved linked finance
    // must roll back all DDL; the single clean production shape must succeed.
    await db.query("update public.live_battle_series set status='cancelled',completed_at=clock_timestamp() where id=$1",[orphan.series]);
    await rejected(db.query(migration),'repair_scope_drift'); await db.query('rollback');
    await db.query("update public.live_battle_series set status='active',completed_at=null where id=$1",[orphan.series]);
    const extra = await pair(); await transition(extra,'expired');
    await rejected(db.query(migration),'repair_scope_drift'); await db.query('rollback');
    await db.query("update public.live_battle_series set status='cancelled',completed_at=clock_timestamp() where id=$1",[extra.series]);
    const badFinance = randomUUID();
    await db.query("insert into public.financial_transactions(id,operation_type,status,reference_type,reference_id) values($1,'live_gift','pending','live_battle',$2)",[badFinance,orphan.battle]);
    await rejected(db.query(migration),'unresolved_gift_finance'); await db.query('rollback');
    await db.query('delete from public.financial_transactions where id=$1',[badFinance]);
    const outsideReceipt=(await gift(extra,'cross-route-repair')).rows[0];
    await db.query("update public.financial_transactions set reference_type='live_battle',reference_id=$2 where id=(select financial_transaction_id from public.live_gift_transactions where id=$1)",[outsideReceipt.transaction_id,orphan.battle]);
    await rejected(db.query(migration),'unresolved_gift_finance'); await db.query('rollback');
    assert.equal((await db.query("select to_regprocedure('private.prevent_confirmed_live_gift_mutation()') is null as rolled_back")).rows[0].rolled_back,true);
    await db.query("update public.financial_transactions set reference_type='live_session',reference_id=$2 where id=(select financial_transaction_id from public.live_gift_transactions where id=$1)",[outsideReceipt.transaction_id,extra.first]);
    console.log('PASS exact migration rejects receipt reached by scoped finance despite outside receipt route; DDL rolls back');
    await db.query(migration);
    assert.equal((await state(orphan)).status,'cancelled');
    console.log('PASS exact migration scope drift, finance drift, atomic rollback, one canonical repair');
  }
  for (const terminal of ['expired','rejected']) await run(`pending to ${terminal} closes series`,async()=>{
    const p=await pair(); await transition(p,terminal); assert.equal((await state(p)).status,'cancelled');
  });
  await run('normal session ended_at and disabled gift reject new admission; replay survives closure',async()=>{
    const p=await pair(); const receipt=(await gift(p,'normal')).rows[0];
    assert.equal(receipt.creator_amount_coins,65);
    await db.query('update public.live_sessions set ended_at=clock_timestamp() where id=$1',[p.first]);
    await rejected(gift(p,'closed'),'live session is not active');
    assert.equal((await gift(p,'normal')).rows[0].transaction_id,receipt.transaction_id);
    await db.query('update public.live_sessions set ended_at=null where id=$1',[p.first]);
    await db.query("update public.gift_catalog set enabled=false where id='proof'");
    try { await rejected(gift(p,'disabled'),'gift not found or inactive'); }
    finally { await db.query("update public.gift_catalog set enabled=true where id='proof'"); }
    assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,'1');
  });
  await run('Battle replay and duplicate preserve one debit, 35% split, score and balanced journal',async()=>{
    const p=await pair('active'); const a=await connect(); const b=await connect();
    const results=await Promise.all([gift(p,'duplicate',true,a),gift(p,'duplicate',true,b)]);
    assert.equal(results[0].rows[0].transaction_id,results[1].rows[0].transaction_id);
    const totals=(await db.query('select challenger_score,score_version from public.live_battle_score_states where battle_id=$1',[p.battle])).rows[0];
    assert.deepEqual(totals,{challenger_score:'10000',score_version:'1'});
    const entries=(await db.query("select entry_type,amount::integer from public.ledger_entries where metadata->>'fin_txn_id'=(select financial_transaction_id::text from public.live_gift_transactions where id=$1) order by entry_type,amount",[results[0].rows[0].transaction_id])).rows;
    assert.deepEqual(entries,[{entry_type:'credit',amount:35},{entry_type:'credit',amount:65},{entry_type:'debit',amount:100}]);
    await db.query("update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1",[p.first]);
    await db.query("update public.gift_catalog set enabled=false where id='proof'");
    try { assert.equal((await gift(p,'duplicate',true)).rows[0].transaction_id,results[0].rows[0].transaction_id); await rejected(gift(p,'new',true),'target_session_not_live'); }
    finally { await db.query("update public.gift_catalog set enabled=true where id='proof'"); }
  });
  await run('confirmed receipts reject every UPDATE and DELETE, retain all three parents',async()=>{
    const p=await pair(); const id=(await gift(p,'immutable')).rows[0].transaction_id;
    for(const sql of ['update public.live_gift_transactions set emoji=emoji where id=$1','update public.live_gift_transactions set financial_transaction_id=null where id=$1','delete from public.live_gift_transactions where id=$1']) await rejected(db.query(sql,[id]),'live_gift_confirmed_immutable','55000');
    const fks=(await db.query("select conname,confdeltype from pg_constraint where conrelid='public.live_gift_transactions'::regclass and contype='f' and conname in('live_gift_transactions_session_id_fkey','live_gift_transactions_sender_user_id_fkey','live_gift_transactions_receiver_user_id_fkey')")).rows;
    assert.equal(fks.length,3); assert.ok(fks.every(fk=>fk.confdeltype==='r'));
    await rejected(db.query('delete from auth.users where id=$1',[p.sender]),null,'23503');
  });
  await run('disabled Battle gifts, zero-fee tiny gift and failed credit preserve financial atomicity',async()=>{
    const p=await pair('active');
    await db.query("update public.gift_catalog set enabled=false where id='proof'");
    try { await rejected(gift(p,'disabled-battle',true),'live_battle_gift_unavailable'); }
    finally { await db.query("update public.gift_catalog set enabled=true where id='proof'"); }
    const tiny=(await gift(p,'tiny',true,db,'tiny')).rows[0]; assert.equal(tiny.creator_amount_coins,1);
    assert.equal((await db.query('select platform_fee_coins from public.live_gift_transactions where id=$1',[tiny.transaction_id])).rows[0].platform_fee_coins,0);
    const before=(await db.query('select balance from public.ledger_accounts where owner_id=$1',[p.sender])).rows[0].balance;
    const count=(await db.query('select count(*) from public.financial_transactions')).rows[0].count;
    await db.query('update public.ledger_accounts set frozen=true where owner_id=$1',[p.host]);
    await rejected(gift(p,'credit-failure',true),'frozen');
    assert.equal((await db.query('select balance from public.ledger_accounts where owner_id=$1',[p.sender])).rows[0].balance,before);
    assert.equal((await db.query('select count(*) from public.financial_transactions')).rows[0].count,count);
  });
  await run('winner binding rejects wrong side and null winner in score and either projection',async()=>{
    const p=await pair('active');
    await rejected(db.query("update public.live_battle_score_states set challenger_score=1,outcome='challenger',winner_user_id=$2,finalized_at=clock_timestamp() where battle_id=$1",[p.battle,p.opponent]),null,'23514');
    for(const winner of [p.opponent,null]) await rejected(db.query("update public.live_battle_public_states set challenger_score=1,outcome='challenger',winner_user_id=$2 where battle_id=$1",[p.battle,winner]),'winner_identity_invalid','23514');
    await rejected(db.query("update public.live_battle_public_states set outcome='challenger',winner_user_id=$2 where battle_id=$1",[p.battle,p.host]),'live_battle_public_states_result_check','23514');
    await db.query("update public.live_battle_public_states set challenger_score=1,outcome='challenger',winner_user_id=$2 where battle_id=$1",[p.battle,p.host]);
    assert.equal((await db.query("select count(*) from public.live_battle_public_states where battle_id=$1 and winner_user_id=$2",[p.battle,p.host])).rows[0].count,'2');
  });
  await run('ACL, RLS, private helper ACL and rollback preserve finance',async()=>{
    const p=await pair(); const before=(await db.query('select count(*) from public.financial_transactions')).rows[0].count;
    await db.query('begin'); await gift(p,'rollback'); await db.query('rollback');
    assert.equal((await db.query('select count(*) from public.financial_transactions')).rows[0].count,before);
    await db.query('set role anon'); await rejected(db.query('select * from public.send_live_gift($1,$2,$3)',[p.first,'proof','anon']),null,'42501'); await db.query('reset role');
    await auth(db,p.sender); await db.query('set role authenticated');
    await rejected(db.query('delete from public.live_gift_transactions'),null,'42501');
    await rejected(db.query('select private.reconcile_due_live_battle_series(100)'),null,'42501');
    await db.query('reset role');
    await gift(p,'rls-visible');
    await auth(db,p.opponent); await db.query('set role authenticated');
    assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,'0');
    await auth(db,p.sender);
    assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,'1');
    await db.query('reset role');
    const rls=(await db.query("select bool_and(relrowsecurity) as ok from pg_class where oid in('public.live_gift_transactions'::regclass,'public.live_battle_score_states'::regclass,'public.live_battle_public_states'::regclass)")).rows[0]; assert.equal(rls.ok,true);
    const rpc=(await db.query("select bool_and(pg_get_userbyid(proowner)='postgres' and proconfig @> array['search_path=\"\"']) as ok from pg_proc where oid in('public.send_live_gift(uuid,text,text)'::regprocedure,'public.send_live_battle_gift(uuid,uuid,text,text)'::regprocedure,'public.create_live_battle_invite(uuid,uuid,uuid)'::regprocedure)")).rows[0]; assert.equal(rpc.ok,true);
  });
  await run('participant admission allows FK key-share but still blocks deletion and identity changes',async()=>{
    const p=await pair('fresh'); const admission=await connect(); const other=await connect();
    await admission.query('begin'); await admission.query('select private.live_battle_lock_users($1,$2)',[p.host,p.opponent]);
    try {
      await other.query('select id from auth.users where id=$1 for key share nowait',[p.host]);
      await rejected(other.query('select id from auth.users where id=$1 for update nowait',[p.host]),null,'55P03');
      await other.query("set lock_timeout='100ms'");
      await rejected(other.query('delete from auth.users where id=$1',[p.host]),null,'55P03');
      await rejected(other.query('update auth.users set id=$2 where id=$1',[p.host,randomUUID()]),null,'55P03');
    } finally { await admission.query('rollback'); await other.query("set lock_timeout='6s'"); }
  });
  await run('skipped terminal rebuild retries durably and double reconciliation is idempotent',async()=>{
    const p=await pair(); const locker=await connect();
    await locker.query('begin'); await locker.query('select 1 from public.live_battle_series where id=$1 for update',[p.series]);
    try { await transition(p,'expired'); assert.equal((await state(p)).status,'active'); }
    finally { await locker.query('commit'); }
    await db.query('select private.reconcile_due_live_battle_series(500)');
    const first=await state(p); assert.equal(first.status,'cancelled');
    await db.query('select private.reconcile_due_live_battle_series(500)');
    assert.equal((await state(p)).version,first.version);
  });
  for(const directed of [false,true]) for(const closeFirst of [false,true]) await run(`${directed?'Battle':'normal'} gift versus close: ${closeFirst?'closure':'admission'} wins`,async()=>{
    const p=await pair(directed?'active':'pending'); const a=await connect(); const b=await connect();
    await a.query('begin');
    let pending;
    try {
      if(closeFirst){
        await a.query("update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1",[p.first]);
        pending=gift(p,'race',directed,b).then(value=>({value}),error=>({error}));
      }else{
        await gift(p,'race',directed,a);
        pending=b.query("update public.live_sessions set status='ended',ended_at=clock_timestamp() where id=$1",[p.first]).then(value=>({value}),error=>({error}));
      }
      await waiting(db,b); await a.query('commit'); const result=await pending;
      if(closeFirst) assert.match(result.error?.message??'',/not active|not_live/); else assert.ok(result.value);
      assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,closeFirst?'0':'1');
    }finally{await a.query('rollback'); if(pending) await pending;}
  });
  await run('Battle deadline is evaluated after session lock wait',async()=>{
    const p=await pair('active'); const a=await connect(); const b=await connect();
    await a.query('begin'); await a.query('select 1 from public.live_sessions where id=$1 for update',[p.first]);
    const pending=gift(p,'deadline',true,b).then(value=>({value}),error=>({error}));
    try {
      await waiting(db,b);
      await a.query("update public.live_battles set accepted_at=now()-interval '303 seconds',countdown_started_at=now()-interval '303 seconds',scheduled_start_at=now()-interval '300 seconds',started_at=now()-interval '300 seconds',scheduled_end_at=now() where id=$1",[p.battle]);
      await a.query('commit'); assert.match((await pending).error?.message??'',/deadline_elapsed/);
    }finally{await a.query('rollback');await pending;}
  });
  await run('normal pre-read route drift fails closed after participant lock wait',async()=>{
    const p=await pair(); const a=await connect(); const b=await connect();
    await a.query('begin');
    await a.query('select private.live_battle_lock_users($1,$2)',[p.sender,p.host]);
    const pending=gift(p,'route-drift',false,b).then(value=>({value}),error=>({error}));
    try {
      await waiting(db,b);
      await a.query('update public.live_sessions set host_id=$2 where id=$1',[p.first,p.opponent]);
      await a.query('commit'); assert.equal((await pending).error?.message,'live_gift_route_changed');
      assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,'0');
    } finally { await a.query('rollback'); await pending; }
  });
  await run('normal and directed gifts share complete user lock order including sender',async()=>{
    const p=await pair('active',db,true); const normal=await connect(); const directed=await connect();
    await normal.query('begin');
    // Pause normal admission after its first canonical user lock; sender sorts
    // before both hosts. Directed admission must wait before locking either host.
    await normal.query('select id from auth.users where id=$1 for update',[p.sender]);
    const pending=gift(p,'mixed-directed',true,directed).then(value=>({value}),error=>({error}));
    try {
      await waiting(db,directed); await gift(p,'mixed-normal',false,normal);
      await normal.query('commit'); assert.ok((await pending).value);
      assert.equal((await db.query('select count(*) from public.live_gift_transactions where sender_user_id=$1',[p.sender])).rows[0].count,'2');
    } finally { await normal.query('rollback'); await pending; }
  });
  for(const inviteFirst of [false,true]) await run(`normal gift versus invite: ${inviteFirst?'invite':'gift'} locks first`,async()=>{
    const p=await pair(); const a=await connect(); const b=await connect();
    await a.query('begin'); let pending;
    try {
      if(inviteFirst){
        await auth(a,p.host);
        await a.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]);
        pending=gift(p,'invite-race',false,b).then(value=>({value}),error=>({error}));
      }else{
        await gift(p,'invite-race',false,a); await auth(b,p.host);
        pending=b.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]).then(value=>({value}),error=>({error}));
      }
      await waiting(db,b); await a.query('commit'); assert.ok((await pending).value);
    } finally { await a.query('rollback'); if(pending) await pending; }
  });
  await run('completion holding Battle permits invite to wait without holding series',async()=>{
    const p=await pair('active'); const completion=await connect(); const invite=await connect();
    await completion.query('begin'); await completion.query('select 1 from public.live_battles where id=$1 for update',[p.battle]);
    await auth(invite,p.host);
    const pending=invite.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]).then(value=>({value}),error=>({error}));
    try{
      await waiting(db,invite);
      // NOWAIT proves the invite has not taken the series before waiting on Battle.
      await completion.query('select 1 from public.live_battle_series where id=$1 for update nowait',[p.series]);
      await completion.query("select private.live_battle_transition($1,'active','completed',null,'battle_duration_elapsed',clock_timestamp()+interval '301 seconds')",[p.battle]);
      await completion.query('commit'); const result=await pending;
      assert.equal(result.error?.code,'PT409'); assert.equal(result.error?.message,'live_battle_series_pair_busy');
    }finally{await completion.query('rollback');await pending;}
  });
  for(const contender of ['invite','directed gift']) await run(`non-tie completion versus ${contender} permits winner FK and preserves one score/charge`,async()=>{
    const p=await pair('active'); await gift(p,'winner-proof',true);
    const completion=await connect(); const admission=await connect();
    await completion.query('begin'); await completion.query('select 1 from public.live_battles where id=$1 for update',[p.battle]);
    await auth(admission,contender==='invite'?p.host:p.sender);
    const pending=(contender==='invite'
      ? admission.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second])
      : admission.query('select * from public.send_live_battle_gift($1,$2,$3,$4)',[p.battle,p.host,'proof','losing-admission'])
    ).then(value=>({value}),error=>({error}));
    try {
      await waiting(db,admission);
      await completion.query("select private.live_battle_transition($1,'active','completed',null,'battle_duration_elapsed',clock_timestamp()+interval '301 seconds')",[p.battle]);
      await completion.query('commit'); const result=await pending;
      assert.equal(result.error?.message,contender==='invite'?'live_battle_series_pair_busy':'live_battle_gift_not_active');
      assert.notEqual(result.error?.code,'40P01');
      assert.deepEqual((await db.query('select outcome,winner_user_id,score_version from public.live_battle_score_states where battle_id=$1',[p.battle])).rows[0],{outcome:'challenger',winner_user_id:p.host,score_version:'1'});
      assert.equal((await db.query('select count(*) from public.live_gift_transactions where battle_id=$1',[p.battle])).rows[0].count,'1');
    } finally { await completion.query('rollback'); await pending; }
  });
  await run('fresh invite refreshes timestamp after admission lock wait',async()=>{
    const p=await pair('fresh'); const locker=await connect(); const invite=await connect();
    const definition=(await db.query("select pg_get_functiondef('public.create_live_battle_invite(uuid,uuid,uuid)'::regprocedure) as sql")).rows[0].sql;
    // Controlled old statement-time initializer simulates >30 seconds elapsed
    // without slowing the proof. Every other production statement stays exact.
    assert.equal((definition.match(/v_now timestamptz := pg_catalog.statement_timestamp\(\);/g)??[]).length,1);
    await db.query(definition.replace('v_now timestamptz := pg_catalog.statement_timestamp();',"v_now timestamptz := pg_catalog.statement_timestamp() - interval '31 seconds';"));
    await locker.query('begin'); await locker.query('select private.live_battle_lock_users($1,$2)',[p.host,p.opponent]);
    await auth(invite,p.host);
    const pending=invite.query('select public.create_live_battle_invite($1,$2,$3) as battle',[p.opponent,p.first,p.second]).then(value=>({value}),error=>({error}));
    try {
      await waiting(db,invite); await locker.query('commit'); const result=await pending;
      assert.ok(result.value,result.error?.message);
      const id=result.value.rows[0].battle.id;
      assert.equal((await db.query("select invite_expires_at > clock_timestamp()+interval '28 seconds' as fresh from public.live_battles where id=$1",[id])).rows[0].fresh,true);
    } finally { await locker.query('rollback'); await pending; await db.query(definition); }
  });
  await run('invite replay locks first and later completion waits then finalizes once',async()=>{
    const p=await pair(); const invite=await connect(); const completion=await connect();
    await invite.query('begin'); await auth(invite,p.host);
    await invite.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]);
    for(const [from,to,actor,reason] of [['pending','accepted',p.opponent,'invite_accepted'],['accepted','countdown',p.host,'countdown_started'],['countdown','active',null,'countdown_elapsed']]) {
      await invite.query('select private.live_battle_transition($1,$2,$3,$4,$5,clock_timestamp())',[p.battle,from,to,actor,reason]);
    }
    const pending=completion.query("select private.live_battle_transition($1,'active','completed',null,'battle_duration_elapsed',clock_timestamp()+interval '301 seconds')",[p.battle]).then(value=>({value}),error=>({error}));
    try { await waiting(db,completion); await invite.query('commit'); assert.ok((await pending).value); assert.equal((await state(p)).rounds_completed,1); }
    finally { await invite.query('rollback'); await pending; }
  });
  await run('open Battle and valid rematch both return stable PT409 busy; due rematch closes',async()=>{
    const p=await pair('active'); await auth(db,p.host);
    await rejected(db.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]),'live_battle_pair_busy','PT409');
    await db.query("select private.live_battle_transition($1,'active','completed',null,'battle_duration_elapsed',clock_timestamp())",[p.battle]);
    assert.equal((await state(p)).status,'awaiting_rematch');
    await db.query("insert into public.live_battle_rematch_requests(series_id,after_battle_id,requested_by_user_id,idempotency_key,expires_at) values($1,$2,$3,$4,clock_timestamp()+interval '30 seconds')",[p.series,p.battle,p.host,randomUUID()]);
    await db.query('select private.reconcile_live_battle_series_locked($1,clock_timestamp())',[p.series]);
    assert.equal((await state(p)).status,'rematch_pending');
    await rejected(db.query('select public.create_live_battle_invite($1,$2,$3)',[p.opponent,p.first,p.second]),'live_battle_series_pair_busy','PT409');
    await db.query("select private.reconcile_live_battle_series_locked($1,clock_timestamp()+interval '31 seconds')",[p.series]);
    assert.equal((await state(p)).status,'completed');
    assert.equal((await db.query('select status from public.live_battle_rematch_requests where series_id=$1',[p.series])).rows[0].status,'expired');
  });
  if(failures) throw new Error(`${failures} contractual/concurrency proofs failed`);
  console.log('PASS disposable PostgreSQL C1 contractual/concurrency proof (not full-schema E2E)');
} finally {
  await Promise.allSettled(clients.map(client=>client.end()));
  if(created) await admin.query(`drop database ${database}`);
  await admin.end();
}
