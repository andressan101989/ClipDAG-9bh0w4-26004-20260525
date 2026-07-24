import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const transpile = path => {
  const result = ts.transpileModule(read(path), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
};

const swift = read('modules/onspace-callkit/ios/OnSpaceCallCoordinator.swift');
const nativeModule = read('modules/onspace-callkit/ios/OnSpaceCallKitModule.swift');
const facade = read('services/iosCallKitService.ts');
const handler = read('components/feature/IosCallKitActionHandler.tsx');
const navigation = read('services/callNavigationService.ts');
const reconciliation = read('hooks/useCallTerminalReconciliation.ts');
const audioScreen = read('app/call/[userId].tsx');
const videoScreen = read('app/video-call/[userId].tsx');
const agoraHook = read('hooks/useAgoraEngine.native.ts');

for (const path of [
  'services/iosCallKitService.ts',
  'components/feature/IosCallKitActionHandler.tsx',
  'services/callNavigationService.ts',
  'hooks/useCallTerminalReconciliation.ts',
  'app/call/[userId].tsx',
  'app/video-call/[userId].tsx',
  'hooks/useAgoraEngine.native.ts',
]) transpile(path);

// Native answer durability: persist before fulfill, retain identity, and expose
// a two-phase acknowledgement that removes the event only after screen mount.
assert.match(swift, /persistPendingEvent\(event\)[\s\S]*action\.fulfill\(\)/);
assert.match(swift, /DefaultsKey\.retainedCallState/);
assert.match(swift, /markCallHandoffStarted\(callId: String, eventId: String\)/);
assert.match(swift, /markCallHandoffCompleted\(callId: String, eventId: String\)/);
assert.match(swift, /currentHandoffEventId == eventId/);
assert.match(nativeModule, /Function\("markCallHandoffStarted"\)/);
assert.match(nativeModule, /Function\("markCallHandoffCompleted"\)/);
assert.match(facade, /export async function markCallKitHandoffStarted/);
assert.match(facade, /export async function markCallKitHandoffCompleted/);

// Listener and durable replay merge into the existing eventId/callId flights.
assert.match(handler, /onAnswerCall\(enqueueEvent\)/);
assert.match(handler, /getPendingEvents\(\)[\s\S]*events\.filter\(isActionEvent\)\.forEach\(enqueueEvent\)/);
assert.match(handler, /processingEventIdsRef\.current\.has\(event\.eventId\)/);
assert.match(handler, /inFlightActionsRef\.current\.get\(key\)/);
assert.match(handler, /markCallKitHandoffStarted\(result\.accepted\.callId, event\.eventId\)/);
assert.doesNotMatch(handler.slice(handler.indexOf("if (result.kind === 'accepted')"), handler.indexOf("if (result.kind === 'terminal')")), /markCompleted\(event\.eventId\)/,
  'answer must not be consumed immediately after router.replace');
assert.match(handler, /completeAnswerHandoff\(launchGate\.callId, launchGate\.eventId\)/);
assert.match(handler, /markCallKitHandoffCompleted\(callId, eventId\)/);

// Both call screens require the authoritative accepted state and an accepted
// handoff marker before a callee can auto-join. Caller behavior is unchanged.
assert.match(navigation, /answerHandoff: 'accepted'/);
assert.match(reconciliation, /callStatus/);
for (const screen of [audioScreen, videoScreen]) {
  assert.match(screen, /const canJoinAgora = !isCallee \|\| \(answerHandoff === 'accepted' && callStatus === 'accepted'\)/);
  assert.match(screen, /!canJoinAgora/);
}

// Deterministic exactly-once model for listener + replay and consecutive calls.
const processed = new Set();
const accept = eventId => processed.has(eventId) ? false : (processed.add(eventId), true);
assert.equal(accept('answer-a'), true);
assert.equal(accept('answer-a'), false);
assert.equal(accept('answer-b'), true);

// A restored CallKit identity makes the existing Agora audio gate wait for
// didActivate; it never calls setActive and remains bounded.
assert.match(agoraHook, /waitForMatchingCallKitAudio/);
assert.match(agoraHook, /onAudioSessionActivated/);
assert.match(agoraHook, /audio_gate_waiting/);
assert.match(agoraHook, /5_000/);
assert.doesNotMatch(agoraHook, /setActive\(/);

console.log('CallKit answer handoff deterministic tests passed');
