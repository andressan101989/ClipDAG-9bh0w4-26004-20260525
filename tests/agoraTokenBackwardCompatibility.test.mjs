import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(
  new URL('../supabase/functions/agora-token/index.ts', import.meta.url),
  'utf8',
);

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const syntaxErrors = (transpiled.diagnostics ?? [])
  .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
assert.deepEqual(syntaxErrors, [], 'agora-token must transpile without syntax diagnostics');

// Contract selection is exclusive: mixed new/legacy payloads cannot fall
// through to legacy authorization, even when one supplied value is invalid.
assert.match(source, /suppliedResourceCount !== 1/);
assert.match(source, /error: 'invalid request payload'/);
assert.match(source, /status: 400/);
assert.match(source, /kind: 'new_call'/);
assert.match(source, /kind: 'new_group'/);
assert.match(source, /kind: 'legacy_call'/);
assert.match(source, /observedContract: RequestContract\['kind'\] \| 'legacy_group'/);

// Legacy 1:1 resolution is exact and then shares the authoritative call path.
assert.match(source, /contract\.kind === 'new_call' \|\| contract\.kind === 'legacy_call'/);
assert.match(source, /\.eq\('channel_name', contract\.channelName\)/);
assert.doesNotMatch(source, /ilike\('channel_name'/);
assert.doesNotMatch(source, /like\('channel_name'/);
assert.match(source, /\.maybeSingle<AuthorizedCall>\(\)/);
assert.match(source, /const isCaller = call\.caller_id === user\.id/);
assert.match(source, /const isCallee = call\.callee_id === user\.id/);
assert.match(source, /call\.status === 'accepted' \|\| \(isCaller && call\.status === 'ringing'\)/);
assert.match(source, /new Date\(call\.expires_at\)\.getTime\(\) <= Date\.now\(\)/);

// Client-controlled legacy hints are accepted for wire compatibility only.
// They never feed token identity or privileges.
assert.doesNotMatch(source, /body\.uid/);
assert.doesNotMatch(source, /body\.role/);
assert.match(source, /const numericUid = userIdToAgoraUid\(user\.id\)/);
assert.match(source, /channelName: authorizedChannel/);
assert.match(source, /uid:\s+numericUid/);
assert.match(source, /isPublisher: true/);

// Legacy unauthorized lookups do not disclose whether another user's channel
// exists; the successful response remains byte-for-byte contract compatible.
assert.match(source, /contract\.kind === 'legacy_call' \? 404 : 403/);
assert.match(source, /JSON\.stringify\(\{ token, appId: AGORA_APP_ID, channel: authorizedChannel, uid: numericUid \}\)/);
assert.match(source, /console\.info\('agora-token authorized', \{/);
assert.doesNotMatch(source, /console\.(?:log|info|error)\([^\n]*(?:body|req\.headers|AGORA_APP_CERTIFICATE|SUPABASE_SERVICE_ROLE_KEY|authorizedChannel|numericUid)[^\n]*\)/i);

// Distributed group clients used roomId as channelName and joined active link
// rooms as publisher. The fallback runs only after an exact 1:1 miss.
assert.match(source, /\| \{ kind: 'new_group'; groupRoomId: string \}/);
assert.match(source, /\.eq\('id', contract\.groupRoomId\)/);
assert.match(source, /\.eq\('id', contract\.channelName\)/);
assert.match(source, /\.select\('id, host_id, status'\)/);
assert.match(source, /legacyGroup\.status !== 'active'/);
assert.match(source, /observedParticipantKind = legacyGroup\.host_id === user\.id \? 'host' : 'guest'/);
assert.match(source, /authorizedChannel = legacyGroup\.id/);
assert.match(source, /observedContract = 'legacy_group'/);
assert.doesNotMatch(source, /legacy group contract unsupported/);
assert.match(source, /contract: observedContract/);
assert.match(source, /participant: observedParticipantKind/);
const exactCallLookup = source.indexOf(".eq('channel_name', contract.channelName)");
const exactLegacyGroupLookup = source.indexOf(".eq('id', contract.channelName)");
assert.ok(exactCallLookup >= 0 && exactLegacyGroupLookup > exactCallLookup,
  'legacy 1:1 exact lookup must precede the legacy group exact fallback');
assert.match(source, /if \(!legacyGroup\)[\s\S]*status: 404/);
assert.match(source, /if \(legacyGroup\.status !== 'active'\)[\s\S]*status: 409/);

console.log('IOS-C agora-token backward compatibility tests: PASS');
