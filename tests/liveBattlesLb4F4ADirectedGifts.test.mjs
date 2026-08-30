import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260829225002_live_battles_lb4_f4a_directed_gifts.sql';
const scoreOutcomeMigrationName = '20260830030845_live_battles_lb4_f4b_score_outcome.sql';
const powerEngineMigrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const powerProjectionMigrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const visualRealtimeMigrationName = '20260830190436_live_battles_lb4_f4d_c_visual_realtime.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const service = await read('services/liveGiftsService.ts');
const types = await read('types/liveGifts.ts');
const proof = await read('supabase/tests/live_battles_lb4_f4a_directed_gifts.sql');
const concurrencyProof = await read('scripts/prove-live-battle-gifts-concurrency.mjs');

function functionBody(name) {
  const start = migration.indexOf(`function public.${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} terminates`);
  return migration.slice(start, end + 4);
}

test('LB4-F4A adds exactly one post-stage migration and no Edge Function', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260829161856_live_battles_lb4_f3_f3_f1_f2_transition_plan.sql');
  assert.deepEqual(names, [
    migrationName, scoreOutcomeMigrationName, powerEngineMigrationName,
    powerProjectionMigrationName,
    visualRealtimeMigrationName,
  ]);
  assert.doesNotMatch(migration, /edge function|agora-token|supabase\.functions/i);
});

test('schema attribution preserves normal gifts and adds indexed Battle idempotency', () => {
  assert.match(migration, /add column battle_id uuid/);
  assert.match(migration, /foreign key \(battle_id\) references public\.live_battles\(id\) on delete restrict/);
  assert.match(migration, /live_gift_transactions_normal_idempotency_uidx[\s\S]*where battle_id is null/);
  assert.match(migration, /live_gift_transactions_battle_idempotency_uidx[\s\S]*sender_user_id, battle_id, idempotency_key[\s\S]*where battle_id is not null/);
  assert.match(migration, /live_gift_transactions_battle_receiver_created_idx[\s\S]*battle_id, receiver_user_id, created_at, id/);
  assert.match(migration, /live_gift_transactions_financial_transaction_uidx[\s\S]*financial_transaction_id/);
  assert.doesNotMatch(migration, /create table[\s\S]*(score|winner|wallet|ledger|escrow)/i);
});

test('RPC derives every financial value and identity server-side under the Battle lock', () => {
  const body = functionBody('send_live_battle_gift');
  assert.match(body, /security definer[\s\S]*set search_path = ''/i);
  assert.match(body, /v_sender uuid := \(select auth\.uid\(\)\)/);
  assert.match(body, /where b\.id = p_battle_id for update/);
  assert.ok(body.indexOf('for update') < body.indexOf('pg_catalog.clock_timestamp()'));
  assert.match(body, /status is distinct from 'active'/);
  assert.match(body, /v_server_now >= v_battle\.scheduled_end_at/);
  assert.match(body, /p_target_user_id = v_battle\.challenger_user_id[\s\S]*p_target_user_id = v_battle\.opponent_user_id/);
  assert.match(body, /s\.id = v_target_session_id and s\.host_id = p_target_user_id[\s\S]*s\.status = 'live' and s\.ended_at is null/);
  assert.match(body, /gc\.id = p_gift_id and gc\.active and gc\.enabled/);
  assert.match(body, /pg_catalog\.floor\(v_gift\.cost_coins::numeric \* 0\.10\)/);
  assert.equal((body.match(/public\.atomic_ledger_transfer\(/g) ?? []).length, 1);
  assert.doesNotMatch(body, /app_wallets|app_wallet_ledger_entries|\binsert into public\.ledger_entries\b|\bscore\b|\bwinner\b/i);
});

test('RPC idempotency returns the original gift and rejects contradictory payloads', () => {
  const body = functionBody('send_live_battle_gift');
  const battleLock = body.indexOf('for update');
  const existingRead = body.indexOf('from public.live_gift_transactions as g');
  const transfer = body.indexOf('public.atomic_ledger_transfer(');
  assert.ok(battleLock < existingRead && existingRead < transfer);
  assert.match(body, /receiver_user_id is distinct from p_target_user_id[\s\S]*gift_id is distinct from p_gift_id[\s\S]*live_battle_gift_idempotency_conflict/);
  assert.match(body, /pg_catalog\.format\('live_battle:%s:%s', p_battle_id, p_idempotency_key\)/);
});

test('ACL exposes only the directed-gift RPC to authenticated clients', () => {
  assert.match(migration, /alter function public\.send_live_battle_gift\(uuid, uuid, text, text\) owner to postgres/);
  assert.match(migration, /revoke all on function public\.send_live_battle_gift\(uuid, uuid, text, text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.send_live_battle_gift\(uuid, uuid, text, text\)[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.send_live_battle_gift[\s\S]*to (anon|service_role)/i);
});

test('one economic gift projects once into each LIVE without financial internals', () => {
  const trigger = functionBody('emit_live_gift_control_event');
  assert.match(migration, /live_control_events_session_gift_transaction_uidx[\s\S]*session_id, \(payload ->> 'transaction_id'\)/);
  assert.match(trigger, /values \(v_battle\.challenger_session_id\), \(v_battle\.opponent_session_id\)/);
  assert.match(trigger, /'battle_gift', true[\s\S]*'battle_target_user_id', new\.receiver_user_id/);
  assert.equal((trigger.match(/insert into public\.live_control_events/g) ?? []).length, 2);
  assert.doesNotMatch(trigger, /balance|ledger_entries|financial_transactions|idempotency_key|platform_fee/i);
});

test('client contract calls only the dedicated RPC with four identities', () => {
  assert.match(types, /export type SendLiveBattleGiftInput[\s\S]*battleId: string[\s\S]*targetUserId: string[\s\S]*giftId: string[\s\S]*idempotencyKey: string/);
  const start = service.indexOf('export async function sendLiveBattleGift');
  const body = service.slice(start);
  assert.match(body, /\.rpc\('send_live_battle_gift', \{[\s\S]*p_battle_id[\s\S]*p_target_user_id[\s\S]*p_gift_id[\s\S]*p_idempotency_key/);
  assert.doesNotMatch(body, /send_live_gift|amount_coins: input|price|fee|score|winner|sessionId/);
  assert.doesNotMatch(service, /FeedContext|financialApi|ledgerClient|bdag-ledger/);
});

test('physical rollback proof covers economic, authorization, deadline, event, and cleanup cases', () => {
  for (const marker of [
    'valid_challenger_gift_failed', 'valid_opponent_gift_failed',
    'external_target_not_rejected', 'self_gift_not_rejected',
    'inactive_gift_not_rejected', 'non_active_battle_not_rejected',
    'deadline_equality_not_rejected', 'deadline_elapsed_not_rejected',
    'insufficient_balance_not_rejected', 'idempotent_retry_changed_result',
    'idempotency_conflict_not_rejected', 'zero_fee_rounding_invalid',
    'normal_fee_rounding_invalid', 'economic_row_count_invalid',
    'symmetric_event_count_invalid', 'event_failure_did_not_rollback',
    'legacy_tables_changed', 'score_or_winner_created', 'fixture_cleanup_failed',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /begin;[\s\S]*rollback;[\s\S]*fixture_cleanup_failed/i);
});

test('two-connection proof is localhost-only and covers retry plus deadline serialization', () => {
  assert.match(concurrencyProof, /F4A proof refuses non-local databases/);
  assert.match(concurrencyProof, /Promise\.all\(\[[\s\S]*first\.query\(giftSql[\s\S]*second\.query\(giftSql/);
  assert.match(concurrencyProof, /select id from public\.live_battles where id=\$1 for update/);
  assert.match(concurrencyProof, /live_battle_gift_deadline_elapsed/);
  assert.match(concurrencyProof, /gifts: 1, financial: 1, entries: 2, events: 2/);
  assert.match(concurrencyProof, /persistentFixtures: 0/);
  assert.doesNotMatch(concurrencyProof, /supabase\.co|aewwdlvbwpczqyvkwvvj|service_role_key/i);
});
