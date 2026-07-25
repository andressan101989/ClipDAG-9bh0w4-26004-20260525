import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const screenPaths = ['app/call/[userId].tsx', 'app/video-call/[userId].tsx'];
const terminalStatuses = ['rejected', 'cancelled', 'expired', 'missed', 'ended'];

function presentationState({
  isCallee = false,
  phase = 'ringing',
  callStatus = 'ringing',
  terminalStatus = null,
  terminalRequested = false,
  appState = 'active',
  remoteUidCount = 0,
  answerHandoff = null,
} = {}) {
  const canJoin =
    callStatus === 'accepted' && (!isCallee || answerHandoff === 'accepted');
  const ringback =
    !isCallee &&
    phase === 'ringing' &&
    callStatus === 'ringing' &&
    !terminalStatus &&
    !terminalRequested &&
    remoteUidCount === 0 &&
    appState === 'active';
  return { canJoin, ringback };
}

test('audio and video use the same authoritative acceptance gate', () => {
  for (const screenPath of screenPaths) {
    const source = fs.readFileSync(screenPath, 'utf8');
    assert.match(
      source,
      /callStatus === 'accepted' && \(!isCallee \|\| answerHandoff === 'accepted'\)/
    );
    assert.match(source, /callStatus === 'ringing'/);
    assert.match(source, /remoteUids\.length === 0/);
    assert.match(source, /stopAllCallSoundsForCall\(callRecordId\)\.then\(/);
    assert.doesNotMatch(source, /const canJoinAgora = !isCallee \|\|/);
  }
});

test('caller rings while backend is ringing and cannot join', () => {
  assert.deepEqual(presentationState(), { canJoin: false, ringback: true });
});

test('accepted stops ringback and authorizes one join flight', () => {
  assert.deepEqual(
    presentationState({ phase: 'connecting', callStatus: 'accepted' }),
    { canJoin: true, ringback: false }
  );
  let joins = 0;
  let joinFlight = false;
  const requestJoin = () => {
    if (joinFlight) return;
    joinFlight = true;
    joins += 1;
  };
  requestJoin();
  requestJoin();
  assert.equal(joins, 1);
});

test('callee never rings back and joins only after accepted handoff', () => {
  assert.equal(presentationState({ isCallee: true }).ringback, false);
  assert.equal(
    presentationState({
      isCallee: true,
      phase: 'connecting',
      callStatus: 'accepted',
    }).canJoin,
    false
  );
  assert.equal(
    presentationState({
      isCallee: true,
      phase: 'connecting',
      callStatus: 'accepted',
      answerHandoff: 'accepted',
    }).canJoin,
    true
  );
});

test('terminal states and requests stop ringback without joining', () => {
  for (const terminalStatus of terminalStatuses) {
    assert.deepEqual(presentationState({ terminalStatus }), {
      canJoin: false,
      ringback: false,
    });
  }
  assert.deepEqual(presentationState({ terminalRequested: true }), {
    canJoin: false,
    ringback: false,
  });
});

test('background stops ringback and active restarts it while ringing', () => {
  assert.equal(presentationState({ appState: 'background' }).ringback, false);
  assert.equal(presentationState({ appState: 'inactive' }).ringback, false);
  assert.equal(presentationState({ appState: 'active' }).ringback, true);
});

test('remote media prevents ringback during the conversation', () => {
  assert.equal(presentationState({ remoteUidCount: 1 }).ringback, false);
});
