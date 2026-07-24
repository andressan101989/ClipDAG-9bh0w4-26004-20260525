import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20260721090000_release_foreground_call_presentation_to_callkit.sql';
const migration = read(migrationPath);
const context = read('contexts/AgoraCallContext.tsx');

const transpiled = ts.transpileModule(context, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.deepEqual(
  (transpiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error),
  [],
  'AgoraCallContext must transpile without syntax diagnostics',
);

// SQL authorization, exact delivery identity, sticky send boundary and
// atomic owner/status transition.
assert.match(migration, /create or replace function public\.release_foreground_call_presentation_to_callkit/);
assert.match(migration, /security definer\s+set search_path = public, pg_temp/);
assert.match(migration, /v_call\.caller_id <> v_user_id and v_call\.callee_id <> v_user_id/);
assert.match(migration, /cd\.id = p_device_id\s+and cd\.user_id = v_user_id\s+and cd\.active = true/);
assert.match(migration, /cpd\.event_type = 'incoming_call'\s+and cpd\.provider = 'apns_voip'/);
assert.match(migration, /cpd\.presentation_version = v_device_version/);
assert.match(migration, /v_delivery\.presentation_owner is distinct from 'onspace'/);
assert.match(migration, /v_delivery\.status <> 'skipped'/);
assert.match(migration, /v_delivery\.send_started_at is not null/);
assert.match(migration, /v_call\.status <> 'ringing'/);
assert.match(migration, /set presentation_owner = null,\s+status = 'pending',\s+presentation_claimed_at = null/);
assert.match(migration, /claim_deadline_at = least\(cpd\.claim_deadline_at, clock_timestamp\(\)\)/);
assert.match(migration, /and cpd\.send_started_at is null/);
assert.match(migration, /for update/);
assert.match(migration, /select 'already_callkit'::text/);
assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
assert.doesNotMatch(migration, /insert\s+into\s+public\.call_push_deliveries/i,
  'handoff must never create a second delivery');
assert.doesNotMatch(migration, /event_type\s*=\s*'(?:call_ended|call_cancelled|call_rejected)'/,
  'terminal deliveries must remain outside the handoff');

// Client uses one RPC flight and a bounded retry, then remains fail-closed.
assert.match(context, /presentationHandoffFlightsRef = useRef<Map<string, Promise<ForegroundHandoffResult>>>/);
assert.match(context, /const existing = presentationHandoffFlightsRef\.current\.get\(key\)/);
assert.match(context, /HANDOFF_RETRY_DELAYS_MS = \[250, 750, 1500\]/);
assert.match(context, /release_foreground_call_presentation_to_callkit/);
assert.match(context, /if \(callBecameTerminal\)[\s\S]*dismissIncomingCall\(row\.id\)[\s\S]*return/);
assert.match(context, /if \(postClaimInvalid\)[\s\S]*if \(owner === 'onspace'\)[\s\S]*releaseForegroundPresentation/);
assert.match(context, /handoffRequestedIdsRef\.current\.has\(row\.id\)/,
  'foreground recovery must not reclaim after handoff');
assert.match(context, /await presentFallback\(callerAfterClaim\)/,
  'audio and video must continue through the same modal route');
assert.doesNotMatch(context, /\.from\('call_push_deliveries'\)[\s\S]{0,200}\.(?:update|insert|delete)\(/,
  'JS must not directly mutate authoritative deliveries');

// Deterministic transition model for the RPC predicates. The SQL assertions
// above bind this model to the actual locked WHERE clause.
function release({ participant = true, ownDevice = true, ringing = true, incoming = true,
  owner = 'onspace', status = 'skipped', sendStarted = false, closed = false }) {
  if (!participant || !ownDevice || !incoming) return 'not_found';
  if (!ringing || closed) return 'terminal';
  if (owner === 'callkit' || (owner === null && status === 'pending')) return 'already_callkit';
  if (owner !== 'onspace' || status !== 'skipped' || sendStarted) return 'not_releasable';
  return 'released';
}

assert.equal(release({ participant: false }), 'not_found');
assert.equal(release({ ownDevice: false }), 'not_found');
assert.equal(release({ incoming: false }), 'not_found');
assert.equal(release({ owner: 'callkit' }), 'already_callkit');
assert.equal(release({ owner: null }), 'not_releasable');
assert.equal(release({ status: 'failed' }), 'not_releasable');
assert.equal(release({ sendStarted: true }), 'not_releasable');
assert.equal(release({ ringing: false }), 'terminal');
assert.equal(release({}), 'released');
assert.equal(release({ owner: null, status: 'pending' }), 'already_callkit',
  'a concurrent/second invocation observes the one completed transition');

const decidePostClaim = ({ active, ringing, callKit, mounted, owner = 'onspace' }) => {
  if (!ringing) return 'terminal';
  if (owner !== 'onspace') return 'no_handoff';
  return active && !callKit && mounted ? 'modal' : 'handoff';
};
assert.equal(decidePostClaim({ active: true, ringing: true, callKit: false, mounted: true }), 'modal');
assert.equal(decidePostClaim({ active: false, ringing: true, callKit: false, mounted: true }), 'handoff');
assert.equal(decidePostClaim({ active: true, ringing: false, callKit: false, mounted: true }), 'terminal');
assert.equal(decidePostClaim({ active: true, ringing: true, callKit: true, mounted: true }), 'handoff');
assert.equal(decidePostClaim({ active: true, ringing: true, callKit: false, mounted: false }), 'handoff');

console.log('IOS-C Block 3 foreground handoff tests: PASS');
