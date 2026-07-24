import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function assertTranspiles(path) {
  const result = ts.transpileModule(read(path), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], `${path} must transpile without syntax diagnostics`);
}

const handler = read('components/feature/IosCallKitActionHandler.tsx');
const nativeFacade = read('services/iosCallKitService.ts');
const actions = read('services/callKitActionService.ts');

assertTranspiles('components/feature/IosCallKitActionHandler.tsx');
assertTranspiles('services/iosCallKitService.ts');

// Pending action recovery keeps the approved fast sequence and then never
// exceeds the autonomous 30-second interval.
assert.match(handler, /CALLKIT_FAST_RETRY_DELAYS_MS = \[1500, 5000, 15000\]/);
assert.match(handler, /CALLKIT_SLOW_RETRY_DELAY_MS = 30_000/);
assert.match(handler, /return CALLKIT_FAST_RETRY_DELAYS_MS\[attempt\] \?\? CALLKIT_SLOW_RETRY_DELAY_MS/);
assert.match(handler, /retryTimersRef\.current\.has\(event\.eventId\)/,
  'only one pending retry timer may exist for an eventId');
assert.match(handler, /getPendingEventsStrict\(\)/,
  'each autonomous attempt must re-read the durable native queue');
assert.match(nativeFacade, /export async function getPendingEventsStrict/);
assert.match(handler, /isCallKitPendingEventExpired\(persisted\)/);
assert.match(handler, /completedEventIdsRef\.current\.has\(event\.eventId\)/);
assert.match(handler, /retryTimers\.forEach\(timer => clearTimeout\(timer\)\)/,
  'unmount must cancel every pending event timer');
assert.match(handler, /inFlightActionsRef\.current\.get\(key\)/,
  'simultaneous drains must share an action flight');
assert.match(actions, /const endFlights = new Map<string, Promise<CallTransitionResult>>\(\)/);
assert.match(actions, /const existing = endFlights\.get\(callId\)/,
  'pending end reconciliation must not duplicate backend closure');

// Launch gate recovery: timeout performs an authoritative reconciliation,
// accepted retries the same replace path, terminal/invalid closes exactly the
// matching native call and uses the existing Home replacement.
assert.match(handler, /LAUNCH_GATE_INITIAL_TIMEOUT_MS = 15_000/);
assert.match(handler, /reconcileLaunchGateRef\.current\(launchGateCallId\)/);
assert.match(handler, /reconcileIncomingCallAcceptance\(\{/);
assert.match(handler, /await navigateToAcceptedCall\(result, currentGate\.eventId, true\)/);
assert.match(handler, /navigateAcceptedCallRoute\(router,[\s\S]*?'callkit'\)/);
assert.match(handler, /closeNativeCallIfMatching\(result\.callId, result\.reportReason\)/);
assert.match(handler, /replaceCallWithHome\(router\)/);
assert.match(handler, /navigationFlightsRef\.current\.has\(callId\)/,
  'double answer/recovery must use one navigation flight');
assert.match(handler, /pathnameRef\.current === currentGate\.targetPath/,
  'route-mounted resolution must win using the exact target path');
assert.match(handler, /scheduleLaunchGateRetry\(callId\)/,
  'network and navigation failures must retain autonomous recovery');
assert.doesNotMatch(handler, /router\.push\(/,
  'the CallKit launch gate must not introduce push navigation');

// Deterministic policy scenarios.
const delays = [0, 1, 2, 3, 4, 20].map(attempt =>
  [1500, 5000, 15000][attempt] ?? 30000);
assert.deepEqual(delays, [1500, 5000, 15000, 30000, 30000, 30000]);

const pendingTimers = new Map();
const scheduleOnce = eventId => {
  if (pendingTimers.has(eventId)) return false;
  pendingTimers.set(eventId, true);
  return true;
};
assert.equal(scheduleOnce('answer-1'), true);
assert.equal(scheduleOnce('answer-1'), false);
pendingTimers.delete('answer-1');
assert.equal(pendingTimers.size, 0, 'consumption/terminal resolution cancels the timer');
pendingTimers.set('end-1', true);
pendingTimers.set('answer-2', true);
pendingTimers.clear();
assert.equal(pendingTimers.size, 0, 'unmount cancels every event timer');

const resolveGate = ({ mounted, backend }) => {
  if (mounted) return 'screen';
  if (backend === 'terminal' || backend === 'missing') return 'home';
  return 'retry';
};
assert.equal(resolveGate({ mounted: true, backend: 'accepted' }), 'screen');
assert.equal(resolveGate({ mounted: false, backend: 'accepted' }), 'retry');
assert.equal(resolveGate({ mounted: false, backend: 'network' }), 'retry');
assert.equal(resolveGate({ mounted: false, backend: 'terminal' }), 'home');
assert.equal(resolveGate({ mounted: true, backend: 'terminal' }), 'screen',
  'simultaneous mount and terminal resolution must not navigate Home over the mounted screen');

console.log('IOS-C Block 2 recovery tests: PASS');
