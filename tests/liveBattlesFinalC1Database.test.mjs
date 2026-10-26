import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(directory).sort();
const latest = name => {
  let body;
  for (const file of migrations) {
    const sql = readFileSync(new URL(file, directory), 'utf8');
    const escaped = name.replaceAll('.', '\\.');
    const match = sql.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
    if (match) body = match[0];
  }
  assert.ok(body, name);
  return body;
};

test('terminal rejection and expiry rebuild series through the existing wrapper', () => {
  const sql = latest('private.sync_live_battle_public_states');
  assert.match(sql, /new.status in \('rejected', 'expired'\)/);
  assert.match(sql, /private\.rebuild_live_battle_series_locked/);
});
test('invite locks Battle before series and returns HTTP conflict for both busy branches', () => {
  const sql = latest('public.create_live_battle_invite');
  assert.ok(sql.indexOf('into v_existing') < sql.indexOf('into v_series'));
  assert.match(sql, /errcode = 'PT409', message = 'live_battle_pair_busy'/);
  assert.match(sql, /errcode = 'PT409', message = 'live_battle_series_pair_busy'/);
});
test('nonblocking rebuild has durable bounded deterministic retry for stale active series', () => {
  assert.match(latest('private.rebuild_live_battle_series_locked'), /for update skip locked/);
  const sql = latest('private.reconcile_due_live_battle_series');
  assert.match(sql, /series.status = 'active'/);
  assert.match(sql, /not exists[\s\S]*battle.status in \('pending', 'accepted', 'countdown', 'active'\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /p_limit > 500/);
  assert.match(sql, /order by[\s\S]*series.id/);
});
test('normal gift admission locks session and checks closure and enabled catalog after replay', () => {
  const sql = latest('public.send_live_gift');
  assert.match(sql, /for share/);
  assert.match(sql, /v_ended_at is not null/);
  assert.match(sql, /catalog.active = true and catalog.enabled = true/);
  assert.ok(sql.indexOf('if found then') < sql.indexOf('for share'));
});
test('normal gift locks sender and pre-read host before session and rejects route drift', () => {
  const sql = latest('public.send_live_gift');
  const users = sql.indexOf('private.live_battle_lock_users');
  assert.ok(users > sql.indexOf('if found then') && users < sql.indexOf('for share'));
  assert.match(sql, /v_receiver is distinct from v_route_receiver/);
  assert.match(sql, /live_gift_route_changed/);
});
test('Battle admission locks participants and sessions before Battle then computes deadline', () => {
  const sql = latest('public.send_live_battle_gift');
  const users = sql.indexOf('private.live_battle_lock_users');
  const sessions = sql.indexOf('private.live_battle_lock_sessions');
  const battle = sql.indexOf('for update;', sql.indexOf('select battle.* into v_battle'));
  assert.ok(users > 0 && users < sessions && sessions < battle);
  assert.match(sql, /participant.id in \(v_sender, v_route.challenger_user_id, v_route.opponent_user_id\)[\s\S]*order by participant.id[\s\S]*for no key update;/);
  assert.ok(battle < sql.indexOf('v_server_now := pg_catalog.clock_timestamp()'));
  assert.ok(sql.indexOf('if found then') < sql.indexOf("v_battle.status is distinct from 'active'"));
  assert.match(sql, /catalog.active and catalog.enabled/);
  assert.match(sql, /private.verify_live_gift_journal/);
  assert.match(sql, /private.record_live_battle_score_locked/);
});
test('one forward migration retains confirmed receipts and strict winner authority', () => {
  const files = migrations.filter(file => /live_battles_final_c1/.test(file));
  assert.equal(files.length, 1);
  const sql = readFileSync(new URL(files[0], directory), 'utf8');
  assert.match(sql, /before update or delete on public.live_gift_transactions/);
  assert.equal((sql.match(/on delete restrict/g) ?? []).length, 3);
  assert.match(sql, /live_battle_score_winner_identity/);
  assert.match(sql, /live_battle_public_winner_identity/);
  assert.match(sql, /live_battles_final_c1_repair_scope_drift/);
  assert.match(sql, /live_battles_final_c1_unresolved_gift_finance/);
  assert.match(sql, /v_count <> 1/);
  assert.doesNotMatch(sql, /create (?:unique )?index/i);
  assert.doesNotMatch(sql, /create or replace function private.live_battle_transition\(/);
});
test('likes locks session before Battle and preserves replay before mutable admission', () => {
  const sql = latest('public.send_live_battle_likes');
  assert.ok(sql.indexOf('into v_session') < sql.indexOf('into v_battle'));
  assert.ok(sql.indexOf('if v_existing.id is not null') < sql.indexOf('live_participant_required'));
  assert.match(sql,/v_session.ended_at is null/);
  assert.match(sql,/v_now := pg_catalog.clock_timestamp\(\)/);
});
