import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const hookPath = 'hooks/useCallTerminalReconciliation.ts';
const audioPath = 'app/call/[userId].tsx';
const videoPath = 'app/video-call/[userId].tsx';
const source = fs.readFileSync(hookPath, 'utf8');

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
  fileName: hookPath,
});
assert.equal(transpiled.diagnostics?.length ?? 0, 0, 'hook must transpile');

assert.match(source, /const FALLBACK_POLL_INTERVAL_MS = 2_000/);
assert.match(source, /setInterval\(\(\) => \{\s*void reconcile\('fallback_poll'\)/);
assert.match(source, /if \(inFlightRef\.current\) return inFlightRef\.current/);
assert.match(source, /stopFallbackPoll\(terminal \?\? 'invalid'\)/);
assert.match(source, /stopFallbackPoll\(\);\s*appStateSub\.remove\(\)/);
assert.doesNotMatch(source, /\.rpc\(|endCall\(|cancelCall\(/);

for (const screenPath of [audioPath, videoPath]) {
  const screen = fs.readFileSync(screenPath, 'utf8');
  assert.match(screen, /useCallTerminalReconciliation\(callRecordId\)/);
}

const terminalStatuses = new Set([
  'ended', 'cancelled', 'rejected', 'expired', 'missed', 'invalid',
]);

function createModel() {
  let terminal = null;
  let timerActive = true;
  let terminalWrites = 0;
  let queryInFlight = null;

  const accept = status => {
    if (status === 'ringing' || status === 'accepted' || terminal) return;
    const normalized = terminalStatuses.has(status) ? status : 'invalid';
    terminal = normalized;
    terminalWrites += 1;
    timerActive = false;
  };

  const reconcile = statusFactory => {
    if (terminal) return Promise.resolve();
    if (queryInFlight) return queryInFlight;
    queryInFlight = Promise.resolve().then(statusFactory).then(accept).finally(() => {
      queryInFlight = null;
    });
    return queryInFlight;
  };

  return {
    acceptRealtime: accept,
    poll: reconcile,
    unmount: () => { timerActive = false; },
    state: () => ({ terminal, timerActive, terminalWrites }),
  };
}

{
  const model = createModel();
  await model.poll(() => 'accepted');
  assert.deepEqual(model.state(), { terminal: null, timerActive: true, terminalWrites: 0 });
}

{
  const model = createModel();
  model.acceptRealtime('ended');
  assert.deepEqual(model.state(), { terminal: 'ended', timerActive: false, terminalWrites: 1 });
}

{
  const model = createModel();
  await model.poll(() => 'ended');
  assert.deepEqual(model.state(), { terminal: 'ended', timerActive: false, terminalWrites: 1 });
}

{
  const model = createModel();
  const poll = model.poll(() => 'ended');
  model.acceptRealtime('ended');
  await poll;
  assert.deepEqual(model.state(), { terminal: 'ended', timerActive: false, terminalWrites: 1 });
}

{
  const model = createModel();
  model.unmount();
  assert.equal(model.state().timerActive, false);
}

console.log('IOS-C mounted call terminal reconciliation tests: PASS');
