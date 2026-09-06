import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = (await readdir(migrationsUrl))
  .filter(name => name.endsWith('.sql'))
  .sort();
const history = (await Promise.all(migrationNames.map(async name => ({
  name,
  sql: await readFile(new URL(name, migrationsUrl), 'utf8'),
}))));

function latestFunctionBody(name) {
  const declaration = new RegExp(`(?:create|create or replace) function public\\.${name}\\(`, 'ig');
  let latest = null;
  for (const migration of history) {
    for (const match of migration.sql.matchAll(declaration)) {
      const end = migration.sql.indexOf('\n$$;', match.index);
      const alternateEnd = migration.sql.indexOf('\n$function$;', match.index);
      const bodyEnd = [end, alternateEnd].filter(value => value >= 0).sort((a, b) => a - b)[0];
      assert.notEqual(bodyEnd, undefined, `${name} terminates in ${migration.name}`);
      latest = migration.sql.slice(match.index, bodyEnd + 12);
    }
  }
  assert.ok(latest, `${name} exists`);
  return latest;
}

const split = gross => {
  const platform = Math.floor((gross * 3500 + 5000) / 10000);
  return { platform, creator: gross - platform };
};

const f8Name = '20260905230823_live_gift_platform_commission_35.sql';
const f8 = history.find(migration => migration.name === f8Name)?.sql;
assert.ok(f8, `${f8Name} exists`);
const proof = await readFile(new URL('../supabase/tests/live_gift_platform_commission_35.sql', import.meta.url), 'utf8');
const concurrency = await readFile(new URL('../scripts/prove-live-gift-commission-concurrency.mjs', import.meta.url), 'utf8');

const protectedLfHashes = new Map([
  ['package.json', '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0'],
  ['package-lock.json', '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4'],
  ['supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql', '3803e2fbcd23e7c63f5cff45e1ff5994b61011f3e3fdf89fa0166bd6efb3ab25'],
  ['supabase/migrations/20260830162244_live_battles_lb4_f4d_b_power_projection.sql', '60955601e14619f34e71c0ccc782a109530e76cbe63f14cacb1db6b34f660dd6'],
  ['supabase/migrations/20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql', 'f5cd23b73c943ce15c5dddbbf35ed9200e0ae8ef10af883d08ecd67c7a423d17'],
  ['supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql', '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45'],
  ['supabase/migrations/20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql', '64b94397de5a7f31449f6a025eb458a41b35f0e936b23eeb79ae379e0b7751bd'],
  ['supabase/migrations/20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql', '1da58dbf6ab85c5953c227d6cc2b2904bc4346a58ff5ca58054b010000bb5237'],
  ['supabase/migrations/20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql', 'dc1e075772ae152cd27cba7707efa263fe7ab3510e32a1bed2aa95278fae96f9'],
  ['supabase/migrations/20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql', '38e169c397438bedb9f80deb7fbd231aca30fe19c5a4d2af87e88a684d25f663'],
  ['supabase/migrations/20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql', '8adfe6b93e1164dd53242523a3e5b3096e71f5e1ab8869d49c7e2e628c629dbf'],
]);

const lfHash = content => createHash('sha256')
  .update(content.replace(/\r\n/g, '\n'))
  .digest('hex');

const sqlCode = body => body.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

test('C1 LIVE replay query is isolated from Battle within the actual WHERE clause', () => {
  const live = sqlCode(latestFunctionBody('send_live_gift'));
  const replay = live.match(/from public\.live_gift_transactions as gift (where [^;]+);/)[1];
  assert.ok(replay.includes('and gift.battle_id is null'), 'LIVE replay must exclude Battle');
  assert.ok(replay.includes('gift.sender_user_id = v_sender'));
  assert.ok(replay.includes('gift.idempotency_key = p_idempotency_key'));
});

test('C1 authenticated bounded key and lock precede replay, which precedes mutable authority', () => {
  const live = sqlCode(latestFunctionBody('send_live_gift'));
  const replay = live.indexOf('from public.live_gift_transactions as gift');
  const returned = live.indexOf('return;', replay);
  assert.ok(live.indexOf('auth.uid()') < replay);
  assert.ok(live.indexOf('pg_advisory_xact_lock(') < replay);
  assert.ok(returned < live.indexOf('from public.live_sessions as session'), 'replay before session lookup');
  assert.ok(returned < live.indexOf('from public.gift_catalog as catalog'), 'replay before catalog lookup');
  const keyLimit = live.indexOf('pg_catalog.length(p_idempotency_key) > 200');
  assert.ok(keyLimit >= 0 && keyLimit < live.indexOf('pg_advisory_xact_lock('));
});

test('C1 both RPCs verify canonical real journal after transfer and before gift insertion', () => {
  for (const name of ['send_live_gift', 'send_live_battle_gift']) {
    const body = sqlCode(latestFunctionBody(name));
    const verify = body.indexOf('perform private.verify_live_gift_journal(');
    assert.ok(verify > body.indexOf('public.atomic_ledger_transfer('), `${name}: verify after transfer`);
    assert.ok(verify < body.indexOf('insert into public.live_gift_transactions'), `${name}: verify before gift`);
    assert.equal(body.split('perform private.verify_live_gift_journal(').length - 1, 1);
  }
  const helper = sqlCode(f8.match(/create or replace function private\.verify_live_gift_journal\([\s\S]*?\n\$\$;/)?.[0] ?? '');
  assert.ok(helper.includes("account.owner_id is null and account.account_type = 'platform' and account.currency = 'bdag'"));
  assert.ok(helper.includes('from public.ledger_entries as entry'));
  assert.ok(helper.includes('from public.financial_transactions as financial'));
  assert.ok(helper.includes("entry.account_id = v_platform_account and entry.entry_type = 'credit' and entry.amount = p_fee"));
  assert.ok(helper.includes('v_signed_sum is distinct from 0'));
  assert.ok(helper.includes('entry.amount <= 0'));
  assert.ok(helper.includes("security invoker set search_path = ''"));
  assert.ok(!helper.includes('limit 1'));
  for (const required of [
    "where account.owner_id = p_sender and account.account_type = 'user' and account.currency = 'bdag'",
    "where account.owner_id = p_receiver and account.account_type = 'user' and account.currency = 'bdag'",
    'financial.from_account_id = v_sender_account', 'financial.to_account_id = v_creator_account',
    'financial.initiated_by = p_sender', 'financial.amount = p_gross and financial.fee_amount = p_fee',
    "financial.currency = 'bdag' and financial.status = 'completed'", "financial.operation_type = 'live_gift'",
    'financial.idempotency_key = p_idempotency_key', 'financial.reference_type = p_reference_type',
    'financial.reference_id = p_reference_id::text', "entry.metadata ->> 'fin_txn_id' = p_financial_id::text",
    'v_entries <> (case when p_fee > 0 then 3 else 2 end)', 'v_debits <> 1 or v_creator_credits <> 1',
    'v_platform_credits <> (case when p_fee > 0 then 1 else 0 end)', 'v_invalid_entries <> 0',
  ]) assert.ok(helper.includes(required), required);
  assert.match(f8, /revoke all on function private\.verify_live_gift_journal\(uuid, uuid, uuid, bigint, bigint, bigint, text, text, uuid\)\s+from public, anon, authenticated, service_role;/);
  assert.match(f8, /alter function private\.verify_live_gift_journal\(uuid, uuid, uuid, bigint, bigint, bigint, text, text, uuid\) owner to postgres;/);
  assert.deepEqual([...sqlCode(f8).matchAll(/create or replace function ([\w.]+)\(/g)].map(m=>m[1]), [
    'private.live_gift_commission_split','private.verify_live_gift_journal','public.send_live_gift','public.send_live_battle_gift',
  ]);
});

test('approved 3500 bps half-up examples are exact', () => {
  assert.deepEqual([1, 5, 10, 20, 100].map(gross => [gross, ...Object.values(split(gross))]), [
    [1, 0, 1],
    [5, 2, 3],
    [10, 4, 6],
    [20, 7, 13],
    [100, 35, 65],
  ]);
});

test('LIVE and Battle use one canonical commission helper', () => {
  for (const name of ['send_live_gift', 'send_live_battle_gift']) {
    const body = latestFunctionBody(name);
    assert.match(body, /private\.live_gift_commission_split\(/);
    assert.doesNotMatch(body, /cost_coins::numeric\s*\*\s*0\.10|gift_cost\s*\*\s*0\.10/i);
  }
});

test('migration implements bigint-safe 3500 bps half-up split once', () => {
  assert.match(f8, /function private\.live_gift_commission_split\(\s*p_gross_amount bigint/);
  assert.match(f8, /p_gross_amount::numeric\s*\*\s*3500\s*\+\s*5000/);
  assert.match(f8, /\/\s*10000/);
  assert.match(f8, /pg_catalog\.floor\([\s\S]*?\)::bigint/);
  assert.match(f8, /p_gross_amount\s*-\s*v_platform_fee/);
  assert.match(f8, /p_gross_amount <= 0/);
  assert.match(f8, /v_platform_fee < 0 or v_platform_fee > p_gross_amount/);
  assert.doesNotMatch(f8, /\b(?:real|double precision|float)\b/i);
});

test('all catalog-range amounts preserve the approved split invariants', () => {
  for (let gross = 1; gross <= 34_999; gross += 1) {
    const { platform, creator } = split(gross);
    assert.ok(platform >= 0 && platform <= gross);
    assert.ok(creator >= 0);
    assert.equal(platform + creator, gross);
    assert.equal(-gross + creator + platform, 0);
  }
});

test('public RPC signatures and the canonical atomic journal remain single-path', () => {
  const live = latestFunctionBody('send_live_gift');
  const battle = latestFunctionBody('send_live_battle_gift');
  assert.match(live, /p_session_id uuid,\s*p_gift_id text,\s*p_idempotency_key text/);
  assert.match(battle, /p_battle_id uuid,\s*p_target_user_id uuid,\s*p_gift_id text,\s*p_idempotency_key text/);
  for (const body of [live, battle]) {
    assert.equal((body.match(/public\.atomic_ledger_transfer\(/g) ?? []).length, 1);
    assert.equal((body.match(/private\.live_gift_commission_split\(/g) ?? []).length, 1);
    assert.match(body, /fee_collected/);
    assert.match(body, /live_gift_commission_v1_3500bps_half_up/);
    assert.doesNotMatch(body, /p_(?:price|cost|fee|commission|platform_account)/i);
    assert.doesNotMatch(sqlCode(body), /\b(?:ledger_debit|ledger_credit|transfer_bdag_internal|ensure_ledger_account)\s*\(/);
    assert.doesNotMatch(sqlCode(body), /\b(?:insert into|update|delete from) public\.(?:ledger_accounts|ledger_entries|financial_transactions)\b/);
  }
});

test('idempotency remains before money movement and Battle replay scores one gift', () => {
  const live = latestFunctionBody('send_live_gift');
  const battle = latestFunctionBody('send_live_battle_gift');
  assert.ok(live.indexOf('where gift.sender_user_id = v_sender') < live.indexOf('public.atomic_ledger_transfer('));
  assert.ok(battle.indexOf('where gift.sender_user_id = v_sender') < battle.indexOf('public.atomic_ledger_transfer('));
  assert.match(live, /if found then[\s\S]*?return query[\s\S]*?return;[\s\S]*?live_gift_commission_split/);
  assert.match(live, /pg_advisory_xact_lock\([\s\S]*?hashtextextended\([\s\S]*?'live_gift:'[\s\S]*?p_idempotency_key/);
  assert.match(live, /live_gift_idempotency_conflict/);
  assert.match(battle, /if found then[\s\S]*?record_live_battle_score_locked\([\s\S]*?return;[\s\S]*?live_gift_commission_split/);
  assert.match(battle, /format\('live_battle:%s:%s', p_battle_id, p_idempotency_key\)/);
});

test('Battle scoring stays gross and rose/power authority is not redefined', () => {
  const battle = latestFunctionBody('send_live_battle_gift');
  assert.match(battle, /v_gift\.cost_coins, v_fee, v_creator_amount/);
  assert.match(battle, /record_live_battle_score_locked\(\s*p_battle_id, v_transaction_id, v_server_now/);
  assert.doesNotMatch(battle, /record_live_battle_score_locked\([^)]*(?:v_fee|v_creator_amount)/s);
  assert.doesNotMatch(f8, /create(?: or replace)? function private\.(?:record_live_battle_score_locked|activate_live_battle_glove)/i);
  assert.doesNotMatch(f8, /update\s+public\.live_battle_(?:score|power|boost)/i);
});

test('security remains definer-only at the public boundary with least privilege', () => {
  assert.match(f8, /function private\.live_gift_commission_split[\s\S]*?security invoker[\s\S]*?set search_path = ''/i);
  for (const name of ['send_live_gift', 'send_live_battle_gift']) {
    const body = latestFunctionBody(name);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /auth\.uid\(\)/);
  }
  assert.match(f8, /revoke all on function private\.live_gift_commission_split\(bigint\)[\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(f8, /grant execute on function public\.send_live_gift\(uuid, text, text\)\s+to authenticated/);
  assert.match(f8, /grant execute on function public\.send_live_battle_gift\(uuid, uuid, text, text\)\s+to authenticated/);
  assert.doesNotMatch(f8, /grant execute[\s\S]*?to (?:public|anon|service_role)/i);
});

test('migration is forward-only policy activation without historical backfill', () => {
  assert.match(f8, /^begin;/);
  assert.match(f8, /commit;\s*$/);
  assert.doesNotMatch(f8, /\b(?:alter table|create table|drop table|truncate)\b/i);
  assert.doesNotMatch(f8, /update\s+public\.(?:live_gift_transactions|financial_transactions|ledger_accounts|ledger_entries)/i);
  assert.doesNotMatch(f8, /delete\s+from\s+public\.(?:live_gift_transactions|financial_transactions|ledger_accounts|ledger_entries)/i);
});

test('protected manifests and deployed migrations remain byte-identical after LF normalization', async () => {
  for (const [relativePath, expected] of protectedLfHashes) {
    const actual = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
    assert.equal(lfHash(actual), expected, relativePath);
  }
});

test('disposable SQL proof covers LIVE, Battle, zero-fee, failure and rollback', () => {
  assert.match(proof, /^begin;/);
  assert.match(proof, /rollback;\s*$/);
  for (const marker of [
    'f8_half_up_case_failed',
    'f8_active_catalog_split_invariant_failed',
    'f8_live_5_split_or_idempotency_invalid',
    'f8_battle_5_split_score_or_idempotency_invalid',
    'f8_zero_fee_journal_invalid',
    'f8_insufficient_balance_moved_value',
    'f8_function_acl_invalid',
    'f8_exact_operation_cardinality_invalid',
    'c1_cross_context_journal_invalid',
    'c1_closed_replay_moved_value',
    'c1_fail_closed_partial_state',
    'c1_x2_economy_score_roses_invalid',
    'c1_private_owner_search_path_invalid',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /platform_fee_coins = 2[\s\S]*creator_amount_coins = 3/);
  assert.match(proof, /base_points = 5 and multiplier = 1 and awarded_points = 5/);
  assert.match(proof, /rose_progress_units[\s\S]*<> 1/);
  assert.match(proof, /entry_type = 'debit' and amount = 5/);
  assert.match(proof, /entry_type = 'credit' and amount = 3/);
  assert.match(proof, /entry_type = 'credit' and amount = 2/);
  assert.doesNotMatch(proof, /commit;/);
});

test('real concurrency harness is local-only and verifies idempotency and balance locking', () => {
  assert.match(concurrency, /LB4_F8_A_ALLOW_DISPOSABLE/);
  assert.match(concurrency, /127\.0\.0\.1/);
  assert.match(concurrency, /Promise\.all\(\[[\s\S]*?first\.query\(liveSql/);
  assert.match(concurrency, /sameKeyLive/);
  assert.match(concurrency, /distinctLive/);
  assert.match(concurrency, /sameKeyBattle/);
  assert.match(concurrency, /balanceRace/);
  assert.match(concurrency, /uniqueGifts: 1, financial: 1, entries: 3/);
  assert.match(concurrency, /accepted: 1, rejected: 1, finalBalance: 0/);
  assert.doesNotMatch(concurrency, /https?:\/\//i);
});
