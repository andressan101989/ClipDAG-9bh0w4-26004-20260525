import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const finalizeSource = readFileSync('supabase/functions/finalize-media-upload/index.ts', 'utf8');
const mediaSource = readFileSync('services/mediaService.ts', 'utf8');
const voiceSource = readFileSync('services/chatVoiceService.ts', 'utf8');

function loadMismatchHelpers() {
  const sourceFile = ts.createSourceFile(
    'finalize-media-upload.ts',
    finalizeSource,
    ts.ScriptTarget.ES2022,
    true,
  );
  const declarations = sourceFile.statements.filter(
    node => ts.isFunctionDeclaration(node) &&
      ['classifyObjectMismatch', 'objectMismatchDiagnostic'].includes(node.name?.text),
  );
  assert.equal(declarations.length, 2);
  const source = declarations
    .map(node => node.getText(sourceFile).replace(/^export\s+/, ''))
    .join('\n');
  const output = ts.transpileModule(
    `${source}\nmodule.exports={classifyObjectMismatch,objectMismatchDiagnostic};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

const { classifyObjectMismatch, objectMismatchDiagnostic } = loadMismatchHelpers();

test('equal size and content type classify as no mismatch', () => {
  assert.equal(classifyObjectMismatch(128, 128, 'audio/mp4', 'audio/mp4'), null);
});

test('size mismatch is classified exactly', () => {
  assert.equal(
    classifyObjectMismatch(128, 129, 'audio/mp4', 'audio/mp4'),
    'object_size_mismatch',
  );
});

test('content-type mismatch is classified exactly', () => {
  assert.equal(
    classifyObjectMismatch(128, 128, 'audio/mp4', 'application/octet-stream'),
    'object_content_type_mismatch',
  );
});

test('combined mismatch is classified exactly', () => {
  assert.equal(
    classifyObjectMismatch(128, 129, 'audio/mp4', 'application/octet-stream'),
    'object_size_and_content_type_mismatch',
  );
});

test('every mismatch remains an object_mismatch failure', () => {
  for (const input of [
    [128, 129, 'audio/mp4', 'audio/mp4'],
    [128, 128, 'audio/mp4', 'application/octet-stream'],
    [128, 129, 'audio/mp4', 'application/octet-stream'],
  ]) {
    const diagnostic = objectMismatchDiagnostic(...input);
    assert.equal(diagnostic?.error, 'object_mismatch');
    assert.ok(diagnostic?.mismatch_code);
  }
  assert.match(finalizeSource, /return json\(mismatchDiagnostic, 409\)/);
});

test('mismatch still transitions through delete_pending and deletes the object', () => {
  const mismatchStart = finalizeSource.indexOf('if (mismatchDiagnostic)');
  const mismatchReturn = 'return json(mismatchDiagnostic, 409);';
  const mismatchBlock = finalizeSource.slice(
    mismatchStart,
    finalizeSource.indexOf(mismatchReturn, mismatchStart) + mismatchReturn.length,
  );
  assert.match(mismatchBlock, /status: "delete_pending"/);
  assert.match(mismatchBlock, /await deleteObject\(a\.bucket_name, a\.object_key\)/);
  assert.match(mismatchBlock, /status: "deleted"/);
  assert.match(mismatchBlock, /object_mismatch_delete_retry/);
});

test('mismatch cannot mark an asset ready', () => {
  const mismatchStart = finalizeSource.indexOf('if (mismatchDiagnostic)');
  const mismatchReturn = 'return json(mismatchDiagnostic, 409);';
  const mismatchBlock = finalizeSource.slice(
    mismatchStart,
    finalizeSource.indexOf(mismatchReturn, mismatchStart) + mismatchReturn.length,
  );
  assert.doesNotMatch(mismatchBlock, /status: "ready"/);
});

test('diagnostic details contain all expected and actual values', () => {
  const diagnostic = objectMismatchDiagnostic(128, 129, 'audio/mp4', 'application/octet-stream');
  assert.match(diagnostic.details, /expected_size=128/);
  assert.match(diagnostic.details, /actual_size=129/);
  assert.match(diagnostic.details, /expected_type=audio\/mp4/);
  assert.match(diagnostic.details, /actual_type=application\/octet-stream/);
});

test('diagnostic payload exposes no storage or identity secrets', () => {
  const diagnostic = JSON.stringify(
    objectMismatchDiagnostic(128, 129, 'audio/mp4', 'application/octet-stream'),
  );
  for (const forbidden of [
    'bucket_name', 'object_key', 'uploadUrl', 'signed URL', 'Authorization',
    'JWT', 'owner_id', 'service key', 'credential', 'account id',
  ]) assert.doesNotMatch(diagnostic, new RegExp(forbidden, 'i'));
});

test('strict equality remains the acceptance policy', () => {
  assert.match(finalizeSource, /actualSize !== expectedSize/);
  assert.match(finalizeSource, /actualContentType !== expectedContentType/);
  assert.doesNotMatch(finalizeSource, /toLowerCase\(\)|split\([^)]*;|tolerance/i);
});

test('granular mismatch code is persisted without changing response error', () => {
  assert.match(finalizeSource, /error_code: mismatchDiagnostic\.mismatch_code/);
  assert.match(finalizeSource, /error: "object_mismatch"/);
});

test('MediaService preserves MEDIA_FINALIZE and logs bounded mismatch fields', () => {
  const finalizeClient = mediaSource.slice(
    mediaSource.indexOf('export async function finalizeMediaUpload'),
    mediaSource.indexOf('export async function uploadMediaFromUri'),
  );
  assert.match(finalizeClient, /asMediaClientError\(error, "MEDIA_FINALIZE"/);
  assert.match(finalizeClient, /mediaError\.code === "object_mismatch"/);
  for (const field of ['operationId', 'stage', 'code', 'details', 'httpStatus'])
    assert.match(finalizeClient, new RegExp(`${field}: mediaError\\.`));
  assert.match(finalizeClient, /throw mediaError/);
});

test('MediaService mismatch log contains no upload or authorization secrets', () => {
  const logBlock = mediaSource.slice(
    mediaSource.indexOf('console.warn("[MediaService] finalize mismatch"'),
    mediaSource.indexOf('throw mediaError'),
  );
  for (const forbidden of [
    'uploadUrl', 'Authorization', 'JWT', 'bucket', 'object_key', 'owner_id', 'credential',
  ]) assert.doesNotMatch(logBlock, new RegExp(forbidden, 'i'));
});

test('F1 voice contract remains audio/mp4, m4a, stable copy, and 48 samples', () => {
  assert.match(voiceSource, /mimeType:\s*'audio\/mp4'/);
  assert.match(voiceSource, /`\$\{operationId\}\.m4a`/);
  assert.match(voiceSource, /prepareStableChatVoiceDraft/);
  assert.match(voiceSource, /copyToStableFile/);
  assert.match(voiceSource, /CHAT_VOICE_WAVEFORM_SAMPLES = 48/);
});
