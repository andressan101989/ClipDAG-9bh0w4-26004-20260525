import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as audioPipeline from '../supabase/functions/content-safety-scan/audioPipeline.mjs';
import {
  VISUAL_PROMPT_VERSION,
  validateVisualSafetyResult,
} from '../supabase/functions/content-safety-scan/visualPipeline.mjs';
import {
  visualStructuredResponseValue,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs';
import * as tusContract from '../supabase/functions/create-stream-upload/premiumTusContract.mjs';
import {
  creatorPremiumLifecycleActions,
  visibleCreatorPremiumContents,
} from '../services/creatorPremiumPresentation.mjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const migration = read('supabase/migrations/20261019023431_creator_premium_f1_c4_final_recovery.sql');

const safeVisualResult = Object.freeze({
  schema_version: VISUAL_PROMPT_VERSION,
  review_required: false,
  findings: [],
  summary: 'No review signal.',
});

function messageToolEnvelope(finishReason = 'stop') {
  return {
    success: true,
    result: {
      choices: [{
        index: 0,
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [{
            id: 'call_visual_1',
            type: 'function',
            function: {
              name: 'report_visual_safety',
              arguments: JSON.stringify(safeVisualResult),
            },
          }],
        },
      }],
    },
  };
}

test('provisioning retries only the demonstrated pre-resource 429 with bounded backoff', () => {
  assert.equal(typeof tusContract.cloudflareTusProvisionRetryDelayMs, 'function');
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, null, 1), 5_000);
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, null, 2), 10_000);
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, null, 3), 20_000);
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, '7', 1), 7_000);
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, '999', 1), null);
  assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(429, null, 4), null);
  for (const status of [201, 401, 403, 408, 413, 425, 500, 502, 503]) {
    assert.equal(tusContract.cloudflareTusProvisionRetryDelayMs(status, null, 1), null, String(status));
  }
});

test('the production Gemma carrier is accepted only after the forced tool call validates strictly', () => {
  const parsed = visualStructuredResponseValue(messageToolEnvelope('stop'));
  assert.deepEqual(validateVisualSafetyResult(parsed, { sourceKind: 'eligible_stream_video' }), safeVisualResult);
  assert.throws(
    () => visualStructuredResponseValue(messageToolEnvelope('unknown')),
    error => error.code === 'visual_workers_ai_tool_finish_reason_invalid',
  );
});

test('audio download creation recovers an initial provider 404 and preserves typed failures', async () => {
  assert.equal(typeof audioPipeline.loadStreamAudioDescriptor, 'function');
  const calls = [];
  const audio = await audioPipeline.loadStreamAudioDescriptor({
    uid: '0123456789abcdef0123456789abcdef',
    streamFetchImpl: async (path, init) => {
      calls.push([path, init?.method]);
      if (calls.length === 1) throw Object.assign(new Error('not found'), { code: 'stream_not_found', httpStatus: 404 });
      return { result: { audio: { status: 'ready', url: 'https://customer-example.cloudflarestream.com/0123456789abcdef0123456789abcdef/downloads/audio.m4a' } } };
    },
  });
  assert.deepEqual(calls, [
    ['/0123456789abcdef0123456789abcdef/downloads', 'GET'],
    ['/0123456789abcdef0123456789abcdef/downloads/audio', 'POST'],
  ]);
  assert.equal(audio.status, 'ready');

  await assert.rejects(
    () => audioPipeline.loadStreamAudioDescriptor({
      uid: '0123456789abcdef0123456789abcdef',
      streamFetchImpl: async () => { throw Object.assign(new Error('rate limited'), { code: 'stream_provider_temporarily_unavailable', httpStatus: 503, transient: true }); },
    }),
    error => error.code === 'stream_audio_temporarily_unavailable' && error.retryable === true,
  );
});

test('creator deletion stays lifecycle-aware while deleted records never render', () => {
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'draft' }).canDelete, true);
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'pending_review' }).canDelete, true);
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'rejected' }).canDelete, true);
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'removed' }).canDelete, true);
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'published' }).canDelete, false);
  assert.deepEqual(
    visibleCreatorPremiumContents([
      { id: 'published', lifecycle_status: 'published' },
      { id: 'removed', lifecycle_status: 'removed' },
      { id: 'deleted', lifecycle_status: 'deleted' },
    ]).map(item => item.id),
    ['published', 'removed'],
  );
});

test('one forward migration extends the existing authorities without parallel systems', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /add column creator_deleted_at timestamptz/i);
  assert.match(migration, /create or replace function public\.delete_my_creator_premium_draft_v1\s*\(\s*p_content_id uuid\s*\)/i);
  assert.match(migration, /lifecycle_status in \('draft','pending_review','rejected','removed','deleted'\)/i);
  assert.match(migration, /creator_premium_content_retire_first/i);
  assert.match(migration, /create or replace function public\.delete_my_creator_premium_plan_draft_v1\s*\(/i);
  assert.match(migration, /creator_deleted_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /plan\.creator_deleted_at is null/i);
  assert.match(migration, /revoke all on function public\.delete_my_creator_premium_draft_v1\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.delete_my_creator_premium_draft_v1\(uuid\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /create table|drop table|truncate/i);
  assert.doesNotMatch(migration, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/i);
});

test('mobile uses the existing deletion RPCs and exposes delete after withdrawal', () => {
  const hub = read('app/creator-monetization.tsx');
  const editor = read('app/creator-premium-editor.tsx');
  const service = read('services/creatorPremiumService.ts');
  assert.match(service, /rpc\('delete_my_creator_premium_draft_v1'/);
  assert.match(service, /rpc\('delete_my_creator_premium_plan_draft_v1'/);
  assert.match(hub, /plan\.status === 'retired'[\s\S]*confirmPlanAction\(plan, 'delete'\)/);
  assert.match(editor, /lifecycleActions\.canDelete/);
  assert.match(editor, />Eliminar contenido</);
  assert.doesNotMatch(editor, />Eliminar borrador</);
});
