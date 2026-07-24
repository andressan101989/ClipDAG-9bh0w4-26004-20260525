import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260722090000_authoritative_call_liveness.sql', 'utf8');
const hook = fs.readFileSync('hooks/useCallLiveness.ts', 'utf8');
const audio = fs.readFileSync('app/call/[userId].tsx', 'utf8');
const video = fs.readFileSync('app/video-call/[userId].tsx', 'utf8');

assert.match(migration, /handoff_completed_at is null[\s\S]*interval '3 minutes'/);
assert.match(migration, /handoff_completed_at is not null and c\.media_connected_at is null[\s\S]*interval '3 minutes'/);
assert.match(migration, /coalesce\(c\.last_heartbeat_at, c\.media_connected_at\)[\s\S]*interval '10 minutes'/);
assert.match(migration, /call_liveness_cleanup_enabled boolean not null default false/);
assert.match(migration, /cfg\.call_liveness_cleanup_enabled = true/);
assert.match(migration, /set handoff_completed_at = coalesce\(c\.handoff_completed_at, clock_timestamp\(\)\),[\s\S]*media_connected_at/);
assert.match(migration, /c\.media_connected_at is not null/);
assert.match(migration, /where c\.id = p_call_id and c\.status = 'accepted'/g);
assert.match(migration, /for update of c skip locked/g);
assert.match(migration, /where c\.id = candidates\.id and c\.status = 'accepted'/);
assert.match(migration, /invalidate_incoming_call_presentations/);
assert.match(migration, /enqueue_call_terminal_deliveries/);
assert.doesNotMatch(migration, /set status = 'accepted'/);

assert.match(hook, /callStatus !== 'accepted'/);
assert.match(hook, /!joined/);
assert.match(hook, /!connected/);
assert.match(hook, /const HEARTBEAT_INTERVAL_MS = 30_000/);
assert.match(hook, /clearInterval\(timer\)/);
assert.match(hook, /appStateSubscription\.remove\(\)/);
assert.match(hook, /heartbeatFlightRef\.current/);
assert.match(audio, /useCallLiveness\(/);
assert.match(video, /useCallLiveness\(/);

const MINUTE = 60_000;
function shouldExpire(call, now) {
  if (call.status === 'ringing') return call.expiresAt < now;
  if (call.status !== 'accepted') return false;
  if (!call.handoffAt) return call.acceptedAt < now - 3 * MINUTE;
  if (!call.connectedAt) return call.handoffAt < now - 3 * MINUTE;
  return (call.heartbeatAt ?? call.connectedAt) < now - 10 * MINUTE;
}

const now = 20 * MINUTE;
assert.equal(shouldExpire({ status: 'accepted', acceptedAt: now - 4 * MINUTE }, now), true);
assert.equal(shouldExpire({ status: 'accepted', acceptedAt: 0, handoffAt: now - 4 * MINUTE }, now), true);
assert.equal(shouldExpire({ status: 'accepted', acceptedAt: 0, handoffAt: 1, connectedAt: 2, heartbeatAt: now - MINUTE }, now), false);
assert.equal(shouldExpire({ status: 'accepted', acceptedAt: 0, handoffAt: 1, connectedAt: 2, heartbeatAt: now - 11 * MINUTE }, now), true);
assert.equal(shouldExpire({ status: 'ended', acceptedAt: 0 }, now), false);

const connectedForHours = { status: 'accepted', acceptedAt: 0, handoffAt: 1, connectedAt: 2, heartbeatAt: 2 };
for (let minute = 1; minute <= 12 * 60; minute += 1) {
  const tick = minute * MINUTE;
  connectedForHours.heartbeatAt = tick;
  assert.equal(shouldExpire(connectedForHours, tick), false);
}

const calls = [{ id: 'stale', status: 'accepted', acceptedAt: 0 }];
function cleanupOnce() {
  const row = calls.find(call => call.status === 'accepted' && shouldExpire(call, now));
  if (!row) return 0;
  row.status = 'ended';
  return 1;
}
assert.equal(cleanupOnce(), 1);
assert.equal(cleanupOnce(), 0);
assert.equal(calls.some(call => call.status === 'ringing' || call.status === 'accepted'), false);

console.log('IOS-C authoritative call liveness tests: PASS');
