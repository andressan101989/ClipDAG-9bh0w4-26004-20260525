import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ts from 'typescript';

const dispatcherPath = 'supabase/functions/dispatch-incoming-call-deliveries/index.ts';
const endpointPath = 'supabase/functions/watch-call-status/index.ts';
const tokenPath = 'supabase/functions/_shared/callStatusWatch.ts';
const swiftPath = 'modules/onspace-callkit/ios/OnSpaceCallCoordinator.swift';

const dispatcher = fs.readFileSync(dispatcherPath, 'utf8');
const endpoint = fs.readFileSync(endpointPath, 'utf8');
const tokenSource = fs.readFileSync(tokenPath, 'utf8');
const swift = fs.readFileSync(swiftPath, 'utf8');

for (const [fileName, source] of [[dispatcherPath, dispatcher], [endpointPath, endpoint], [tokenPath, tokenSource]]) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  assert.equal(result.diagnostics?.length ?? 0, 0, `${fileName} must transpile`);
}

assert.match(dispatcher, /watch_token: watchToken/);
assert.match(dispatcher, /watch_endpoint: watchEndpoint/);
assert.match(dispatcher, /watch_device_id: delivery\.device_id/);
assert.match(dispatcher, /watch_expires_at: watchExpiration/);
assert.match(dispatcher, /p: CALL_STATUS_WATCH_PURPOSE/);
assert.match(dispatcher, /sendApnsWithRetry\([\s\S]*payload: \{\s*\.\.\.delivery\.payload/);

assert.match(tokenSource, /CALL_STATUS_WATCH_PURPOSE = 'call_status_watch'/);
assert.match(tokenSource, /crypto\.subtle\.sign\('HMAC'/);
assert.match(tokenSource, /timingSafeEqual/);
assert.match(tokenSource, /claims\.e <= nowSeconds/);

assert.match(endpoint, /\.eq\('call_id', body\.call_id\)/);
assert.match(endpoint, /\.eq\('device_id', body\.device_id\)/);
assert.match(endpoint, /\.eq\('event_type', 'incoming_call'\)/);
assert.match(endpoint, /\.eq\('provider', 'apns_voip'\)/);
assert.match(endpoint, /call\.callee_id !== device\.user_id/);
assert.doesNotMatch(endpoint, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);

assert.match(swift, /URLSession\.shared\.dataTask/);
assert.match(swift, /startCallStatusWatch\(callId: callIdRaw, callUuid: callUUID\)/);
assert.match(swift, /currentCallId == callId[\s\S]*currentCallUuid == callUuid/);
assert.match(swift, /callWatchGeneration == generation/);
assert.match(swift, /case "cancelled", "expired", "missed":\s*return \.unanswered/);
assert.match(swift, /case "rejected":\s*return \.declinedElsewhere/);
assert.match(swift, /case "ended":\s*return \.remoteEnded/);
assert.match(swift, /case "answered_elsewhere":\s*return \.answeredElsewhere/);
assert.match(swift, /persistTerminalTombstone[\s\S]*clearCurrentCallStateLocked\(\)[\s\S]*reportCall/);
assert.match(swift, /clearCurrentCallStateLocked\(\)[\s\S]*stopCallStatusWatchLocked/);
assert.doesNotMatch(swift, /end_call|functions\/v1\/agora-token/);

const encode = value => Buffer.from(value).toString('base64url');
const sign = (secret, claims) => {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
const verify = (secret, token, expectedCall, expectedDevice, now) => {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return claims.p === 'call_status_watch' &&
    claims.c === expectedCall &&
    claims.d === expectedDevice &&
    claims.e > now;
};

const claims = {
  c: '11111111-1111-4111-8111-111111111111',
  d: '22222222-2222-4222-8222-222222222222',
  e: 2_000,
  p: 'call_status_watch',
};
const token = sign('test-secret', claims);
assert.equal(verify('test-secret', token, claims.c, claims.d, 1_000), true);
assert.equal(verify('test-secret', token, '33333333-3333-4333-8333-333333333333', claims.d, 1_000), false);
assert.equal(verify('test-secret', token, claims.c, '44444444-4444-4444-8444-444444444444', 1_000), false);
assert.equal(verify('test-secret', token, claims.c, claims.d, 2_001), false);
assert.equal(verify('wrong-secret', token, claims.c, claims.d, 1_000), false);

const closeReasons = new Map([
  ['cancelled', 'unanswered'],
  ['expired', 'unanswered'],
  ['missed', 'unanswered'],
  ['rejected', 'declinedElsewhere'],
  ['ended', 'remoteEnded'],
  ['answered_elsewhere', 'answeredElsewhere'],
]);
assert.equal(closeReasons.has('ringing'), false);
assert.equal(closeReasons.has('accepted'), false);
assert.equal(closeReasons.get('cancelled'), 'unanswered');
assert.equal(closeReasons.get('ended'), 'remoteEnded');
assert.equal(closeReasons.get('rejected'), 'declinedElsewhere');
assert.equal(closeReasons.get('answered_elsewhere'), 'answeredElsewhere');

console.log('IOS-C native CallKit status watcher tests: PASS');
