import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const previousName = '20260829054911_live_battles_lb4_f3_f3_stale_lifecycle.sql';
const migrationName = '20260829142317_live_battles_lb4_f3_f3_f1_accepted_lifecycle.sql';
const cancellationAuthorityMigrationName = '20260829150940_live_battles_lb4_f3_f3_f1_f1_cancellation_authority.sql';
const sqlProofName = 'live_battles_lb4_f3_f3_f1_accepted_lifecycle.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const sqlProof = await read(`supabase/tests/${sqlProofName}`);

function functionBody(schema, name) {
  const start = migration.indexOf(`function ${schema}.${name}(`);
  assert.notEqual(start, -1, `${schema}.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${schema}.${name} terminates`);
  return migration.slice(start, end + 4);
}

test('LB4-F3-F3-F1 adds one forward migration without changing LB4-F3-F3', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > previousName);
  assert.deepEqual(names, [migrationName, cancellationAuthorityMigrationName]);
  const previous = (await read(`supabase/migrations/${previousName}`)).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(previous).digest('hex'),
    '073857375cde4a7fb641d565a033809fc32b1431f319dc510e5070d9ecdf32d9');
});

test('accepted cancellation authority is closed to two exact system reasons', () => {
  const body = functionBody('private', 'live_battle_transition');
  assert.match(body, /p_expected_status = 'accepted' and p_next_status in \('countdown', 'cancelled'\)/);
  assert.match(body, /p_expected_status = 'accepted' and p_actor_user_id is null[\s\S]*p_reason in \('accepted_start_timeout', 'session_not_live_after_accept'\)/);
  assert.match(body, /p_next_status in \('rejected', 'cancelled'\) then p_now/);
  assert.equal((body.match(/accepted_start_timeout/g) ?? []).length, 1);
  assert.equal((body.match(/session_not_live_after_accept/g) ?? []).length, 1);
  assert.match(body, /insert into public\.live_battle_events[\s\S]*p_reason, v_next_version, p_now/);
});

test('locked reconciliation checks session liveness before the exact 30 second deadline', () => {
  const body = functionBody('private', 'live_battle_reconcile_locked');
  const accepted = body.indexOf("v_battle.status = 'accepted'");
  const liveness = body.indexOf('private.live_battle_session_pair_is_live', accepted);
  const sessionReason = body.indexOf("'session_not_live_after_accept'", accepted);
  const deadline = body.indexOf("v_battle.accepted_at + interval '30 seconds' <= p_now", accepted);
  const timeoutReason = body.indexOf("'accepted_start_timeout'", accepted);
  assert.ok(accepted < liveness && liveness < sessionReason && sessionReason < deadline && deadline < timeoutReason);
  assert.match(body, /else\s+return v_battle;\s+end if;\s+elsif v_battle\.status = 'countdown'/);
  assert.doesNotMatch(body, /clock_timestamp|statement_timestamp|now\(\)/i);
});

test('bounded cron reconciler includes accepted and preserves one clock and SKIP LOCKED', () => {
  const body = functionBody('private', 'reconcile_due_live_battles');
  assert.equal((body.match(/pg_catalog\.clock_timestamp\(\)/g) ?? []).length, 1);
  assert.match(body, /status = 'accepted'[\s\S]*accepted_at \+ interval '30 seconds' <= v_server_now[\s\S]*not private\.live_battle_session_pair_is_live/);
  assert.match(body, /when 'accepted' then b\.accepted_at \+ interval '30 seconds'/);
  assert.match(body, /order by[\s\S]*b\.id[\s\S]*for update skip locked[\s\S]*limit p_limit/i);
  assert.match(body, /p_limit is null or p_limit < 1 or p_limit > 500/);
  assert.doesNotMatch(body, /\b(update|insert|delete|merge|truncate)\s+(public\.)?live_battle/i);
});

test('pair busy reconciles accepted before deciding and still blocks current accepted', () => {
  const body = functionBody('public', 'create_live_battle_invite');
  const open = body.indexOf("b.status in ('pending', 'accepted', 'countdown', 'active')");
  const reconcile = body.indexOf('v_existing := private.live_battle_reconcile_locked');
  const busy = body.indexOf("v_existing.status in ('accepted', 'countdown', 'active')");
  assert.ok(open < reconcile && reconcile < busy);
  assert.match(body, /if found then\s+v_existing := private\.live_battle_reconcile_locked/);
});

test('participant busy locks only blocking statuses and fails closed above one hundred', () => {
  const body = functionBody('public', 'respond_live_battle_invite');
  const loopStart = body.indexOf('for v_conflict in');
  const loopEnd = body.indexOf('end loop;', loopStart);
  const loop = body.slice(loopStart, loopEnd);
  assert.match(loop, /b\.status in \('accepted', 'countdown', 'active'\)/);
  assert.doesNotMatch(loop, /'pending'/);
  assert.match(loop, /order by b\.id[\s\S]*for update[\s\S]*limit 101/i);
  assert.doesNotMatch(loop, /skip locked/i);
  assert.match(loop, /v_conflict_count > 100[\s\S]*errcode = '54000'[\s\S]*live_battle_conflict_scan_limit_exceeded/);
  assert.match(body, /if exists \([\s\S]*status in \('accepted', 'countdown', 'active'\)[\s\S]*live_battle_participant_busy/);
});

test('accepted deadline index is partial and the existing cron contract is only verified', () => {
  assert.match(migration, /create index live_battles_accepted_deadline_idx\s+on public\.live_battles \(accepted_at\)\s+where status = 'accepted'/);
  assert.doesNotMatch(migration, /cron\.schedule|cron\.unschedule/);
  assert.equal((migration.match(/jobname = 'reconcile-due-live-battles'/g) ?? []).length, 2);
  assert.match(migration, /schedule = '\* \* \* \* \*'[\s\S]*command = 'select private\.reconcile_due_live_battles\(100\);'[\s\S]*active[\s\S]*username = 'postgres'/);
});

test('owners and private ACL remain exact without UI Agora or economic changes', () => {
  for (const signature of [
    'private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)',
    'private.live_battle_reconcile_locked(uuid, timestamptz)',
    'private.reconcile_due_live_battles(integer)',
  ]) {
    assert.match(migration, new RegExp(`alter function ${signature.replace(/[().]/g, '\\$&')}\\s+owner to postgres`, 'i'));
    assert.match(migration, new RegExp(`revoke all on function ${signature.replace(/[().]/g, '\\$&')}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
  }
  assert.doesNotMatch(migration, /grant execute on function private\./i);
  assert.doesNotMatch(migration, /agora|media relay|send_live_gift|wallet|ledger|financial_transactions|marketplace|commerce|score|winner|loser/i);
  assert.doesNotMatch(migration, /create table|create policy|drop policy|alter publication/i);
});

test('physical proof covers deadlines, busy decisions, pending lock exclusion and cleanup', () => {
  for (const marker of [
    'accepted_29_seconds_changed',
    'accepted_30_seconds_not_cancelled',
    'accepted_timeout_reason_actor_or_version_invalid',
    'accepted_timeout_repeat_not_idempotent',
    'accepted_ended_session_not_cancelled',
    'accepted_live_pair_changed',
    'accepted_current_missing_pair_busy',
    'accepted_due_pair_not_replaced',
    'accepted_ended_pair_not_replaced',
    'accepted_current_missing_participant_busy',
    'accepted_due_participant_not_reconciled',
    'accepted_ended_participant_not_reconciled',
    'countdown_or_active_missing_participant_busy',
    'pending_rows_blocked_acceptance',
    'accepted_index_missing_or_invalid',
    'private_reconciler_acl_invalid',
    'battle_cron_not_singular',
    'accepted_projection_regressed',
    'lb4_f3_f3_f1_fixture_cleanup_failed',
  ]) assert.match(sqlProof, new RegExp(marker));
  assert.match(sqlProof, /rollback;[\s\S]*fixture_cleanup_failed/i);
});
