import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const migration = await read(
  'supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
);
const proof = await read(
  'supabase/tests/live_battles_lb4_f5_a_rematch_series_authority.sql',
);
const concurrencyProof = await read(
  'scripts/prove-live-battle-rematch-concurrency.mjs',
);

function functionBody(name) {
  const body = migration.match(
    new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}`
      + `[\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0];
  assert.ok(body, `${name} must exist`);
  return body;
}

test('public projection exposes request identity and separate request/window expirations', () => {
  for (const field of [
    'rematch_request_id',
    'rematch_request_after_battle_id',
    'rematch_request_status',
    'rematch_request_expires_at',
    'rematch_window_expires_at',
  ]) {
    assert.match(migration, new RegExp(`add column ${field}\\b`, 'i'), field);
    assert.match(migration, new RegExp(`'${field}'\\s*,\\s*public_state\\.${field}\\b`, 'i'), field);
  }
});

test('projection request lookup is scoped to the projected canonical Battle', () => {
  const body = functionBody('private.sync_live_battle_series_projection_locked');
  assert.match(body,
    /candidate\.series_id = p_series_id[\s\S]*candidate\.after_battle_id = battle\.id/i);
  assert.match(body, /order by candidate\.created_at desc, candidate\.id desc/i);
  assert.doesNotMatch(body,
    /rematch_request_expires_at\s*=\s*coalesce\s*\(/i);
  assert.doesNotMatch(body,
    /rematch_window_expires_at\s*=\s*coalesce\s*\(/i);
});

test('round transition clears the prior request before strict projection checks', () => {
  const body = functionBody('private.clear_stale_live_battle_rematch_projection');
  assert.match(body, /new\.battle_id is distinct from old\.battle_id/i);
  for (const field of [
    'rematch_request_id',
    'rematch_request_after_battle_id',
    'rematch_request_status',
    'rematch_requested_by_user_id',
    'rematch_request_expires_at',
    'rematch_window_expires_at',
  ]) assert.match(body, new RegExp(`new\\.${field} := null`, 'i'));
  assert.match(migration,
    /create trigger live_battle_public_states_clear_stale_rematch\s+before update on public\.live_battle_public_states/i);
});

test('current-Battle request lookup has one purpose-built deterministic index', () => {
  assert.match(migration,
    /create index live_battle_rematch_requests_series_battle_created_idx\s+on public\.live_battle_rematch_requests\s*\(series_id, after_battle_id, created_at desc, id desc\)/i);
  assert.equal((migration.match(/live_battle_rematch_requests_series_battle_created_idx/gi) ?? []).length, 1);
});

test('rollback proof covers three rounds and rejects historical request leakage', () => {
  for (const marker of [
    'f5a_round_one_projection_without_request_invalid',
    'f5a_round_two_projection_leaked_round_one_request',
    'f5a_round_two_window_invalid',
    'f5a_round_two_request_anchor_invalid',
    'f5a_round_three_projection_leaked_historical_request',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /rollback;\s*$/i);
});

test('concurrency proof verifies projection anchoring and indexed lookup at volume', () => {
  assert.match(concurrencyProof, /round two projection leaked the accepted round one request/i);
  assert.match(concurrencyProof, /generate_series\(1, 2000\)/i);
  assert.match(concurrencyProof, /analyze public\.live_battle_rematch_requests/i);
  assert.match(concurrencyProof,
    /live_battle_rematch_requests_series_battle_created_idx/i);
  assert.match(concurrencyProof, /financial_rows_unchanged: true/i);
});
