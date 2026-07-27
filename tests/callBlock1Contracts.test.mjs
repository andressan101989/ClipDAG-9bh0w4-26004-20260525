import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function assertTranspiles(path) {
  const result = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], `${path} must transpile without syntax diagnostics`);
}

const sender = read('supabase/functions/send-call-notification/index.ts');
assertTranspiles('supabase/functions/send-call-notification/index.ts');
assert.match(sender, /select\('id, expo_push_token, platform'\)/);
assert.match(sender, /eventType !== 'incoming_call' \|\| device\.platform !== 'ios'/);

const notificationHandler = read('components/feature/PushNotificationHandler.tsx');
const iosGuard = notificationHandler.indexOf("if (Platform.OS === 'ios') return;");
const historicalPresentation = notificationHandler.indexOf('await handleIncomingCallTap(callId)', iosGuard);
assert.ok(iosGuard >= 0 && historicalPresentation > iosGuard,
  'iOS incoming notification responses must stop before legacy modal presentation');

const tokenFunction = read('supabase/functions/agora-token/index.ts');
assertTranspiles('supabase/functions/agora-token/index.ts');
assert.match(tokenFunction, /const body = rawBody as AgoraTokenRequest/);
assert.match(tokenFunction, /kind: 'legacy_call'/);
assert.match(tokenFunction, /\.eq\('channel_name', contract\.channelName\)/);
assert.match(tokenFunction, /\.from\('calls'\)/);
assert.match(tokenFunction, /const isCaller = call\.caller_id === user\.id/);
assert.match(tokenFunction, /const isCallee = call\.callee_id === user\.id/);
assert.match(tokenFunction, /call\.status === 'accepted' \|\| \(isCaller && call\.status === 'ringing'\)/);
assert.match(tokenFunction, /channelName: authorizedChannel/);
assert.match(tokenFunction, /uid:\s+numericUid/);
assert.match(tokenFunction, /let isPublisher = true/);
assert.match(tokenFunction, /isPublisher,\s*\n\s*expireSec/);
assert.doesNotMatch(tokenFunction, /const \{ channelName, uid, role \} = await req\.json/);
assert.doesNotMatch(tokenFunction, /body\.uid|body\.role/);
assert.doesNotMatch(tokenFunction, /Token generated/);

const agoraHook = read('hooks/useAgoraEngine.native.ts');
assert.match(agoraHook, /const isCurrentConnection = \(\) =>/);
assert.match(agoraHook, /const duringConnection = isCurrentConnection\(\)/);
assert.match(agoraHook, /classification === 'connection_fatal'/);
assert.match(agoraHook, /ACTIVE_CONNECTION_FATAL_ERROR_CODES = new Set\(\[110\]\)/);
assert.match(agoraHook, /if \(!duringJoin && !duringConnection\) return/);

console.log('IOS-C Block 1 contract tests: PASS');
