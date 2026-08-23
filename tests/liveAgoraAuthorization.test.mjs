import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(path, 'utf8');
const edge = read('supabase/functions/agora-token/index.ts');
const nativeHook = read('hooks/useAgoraEngine.native.ts');
const webHook = read('hooks/useAgoraEngine.ts');
const nativeService = read('services/agoraService.native.ts');
const webService = read('services/agoraService.ts');
const broadcast = read('app/live/broadcast/[streamId].tsx');
const watch = read('app/live/watch/[streamId].tsx');

for (const [name, source] of [
  ['agora-token', edge],
  ['native hook', nativeHook],
  ['web hook', webHook],
  ['native service', nativeService],
  ['web service', webService],
]) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], `${name} must transpile without syntax errors`);
}

// LIVE callers use an explicit resource contract; stream IDs never fall
// through to group_call_rooms.
assert.match(broadcast, /liveSessionId: live \? streamId : undefined/);
assert.match(broadcast, /liveRequestedRole: 'host'/);
assert.match(watch, /liveSessionId: session\?\.status === 'live' \? streamId : undefined/);
assert.match(watch, /liveRequestedRole: 'viewer'/);
assert.match(nativeHook, /liveSessionId,\s*requestedRole: config\.liveRequestedRole/);
assert.match(nativeHook, /liveSessionId, requestedRole: 'cohost'/);
assert.match(nativeHook, /else if \(config\.liveSessionId && config\.liveRequestedRole\)/);

// Exactly one resource is accepted and client hints never control identity or
// privileges.
assert.match(edge, /suppliedResourceCount !== 1/);
assert.match(edge, /kind: 'live'/);
assert.match(edge, /requestedRole: 'host' \| 'viewer' \| 'cohost'/);
assert.match(edge, /const numericUid = userIdToAgoraUid\(user\.id\)/);
assert.doesNotMatch(edge, /body\.uid/);
assert.doesNotMatch(edge, /body\.role/);

// Host authorization and channel derivation are server-side.
assert.match(edge, /\.from\('live_sessions'\)/);
assert.match(edge, /\.eq\('id', contract\.liveSessionId\)/);
assert.match(edge, /liveSession\.status !== 'live' \|\| liveSession\.ended_at !== null/);
assert.match(edge, /liveSession\.host_id !== user\.id/);
assert.match(edge, /authorizedChannel = liveSession\.id/);

// Viewers get JOIN only. Publisher privileges are added conditionally.
assert.match(edge, /contract\.requestedRole === 'viewer'[\s\S]*isPublisher = false/);
assert.match(edge, /const privileges[\s\S]*PRIV_JOIN_CHANNEL/);
assert.match(edge, /if \(params\.isPublisher\)[\s\S]*PRIV_PUB_AUDIO[\s\S]*PRIV_PUB_VIDEO[\s\S]*PRIV_PUB_DATA/);
assert.doesNotMatch(
  edge.match(/contract\.requestedRole === 'viewer'[\s\S]*?} else \{/)?.[0] ?? '',
  /PRIV_PUB_AUDIO|PRIV_PUB_VIDEO|PRIV_PUB_DATA/,
);

// Only an active, host-approved cohost is promoted. floor_granted remains a
// runtime speaking control, matching the existing participant model.
assert.match(edge, /\.from\('live_participants'\)/);
assert.match(edge, /\.eq\('session_id', liveSession\.id\)/);
assert.match(edge, /\.eq\('user_id', user\.id\)/);
assert.match(edge, /participant\.role !== 'cohost'/);
assert.match(edge, /participant\.status !== 'active'/);
assert.match(edge, /observedParticipantKind = 'cohost'/);

// Existing 1:1 and group contracts keep publisher behavior.
assert.match(edge, /let isPublisher = true/);
assert.match(edge, /contract\.kind === 'new_call' \|\| contract\.kind === 'legacy_call'/);
assert.match(edge, /contract\.kind === 'new_group'/);

// HTTP failures are sanitized and parsed once by both clients.
for (const service of [nativeService, webService]) {
  assert.match(service, /context\.json\(\)/);
  assert.doesNotMatch(service, /context\.text\(\)/);
  assert.match(service, /token_http_\$\{status \?\? 500\}/);
  assert.match(service, /token_live_session_missing/);
  assert.match(service, /token_live_not_joinable/);
  assert.match(service, /token_cohost_not_authorized/);
}
assert.match(edge, /jsonError\('internal error', 500\)/);
assert.doesNotMatch(edge, /JSON\.stringify\(\{ error: String\(err\) \}\)/);
assert.doesNotMatch(
  edge,
  /console\.(?:log|info|error)\([^\n]*(?:req\.headers|AGORA_APP_CERTIFICATE|SUPABASE_SERVICE_ROLE_KEY|authorizedChannel|numericUid)[^\n]*\)/,
);

// Canonical presence begins only after Agora reports a real join. The client
// cannot provide a viewer delta or participant authority fields.
assert.match(watch, /if \(!joined \|\| leftRef\.current \|\| presenceRegisteredRef\.current \|\| !streamId\) return/);
assert.match(watch, /setLiveParticipantPresence\(streamId, true\)/);
assert.match(watch, /setLiveParticipantPresence\(streamId, false\)/);
assert.doesNotMatch(watch, /increment_live_viewer_count|p_delta/);

console.log('LIVE Agora authorization tests: PASS');
