import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import * as presentation from '../services/creatorPremiumPresentation.mjs';
import {
  VisualProbeError,
  visualStructuredResponseValue,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs';
import { validateVisualSafetyResult } from '../supabase/functions/content-safety-scan/visualPipeline.mjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const editor = read('app/creator-premium-editor.tsx');
const scanner = read('supabase/functions/content-safety-scan/index.ts');

const safeVisualResult = Object.freeze({
  schema_version: 'visual-safety-v1',
  review_required: false,
  findings: [],
  summary: 'No safety signal.',
});

test('PhotoKit 3164 is contained as a recoverable result instead of an unhandled rejection', async () => {
  assert.equal(typeof presentation.selectCreatorPremiumVideoFromPhotos, 'function');
  const result = await presentation.selectCreatorPremiumVideoFromPhotos({
    requestPermission: async () => ({ granted: true, accessPrivileges: 'limited' }),
    launchPicker: async () => {
      throw new Error("The operation couldn't be completed. (PHPhotosErrorDomain error 3164.)");
    },
    prepareAsset: async () => assert.fail('asset preparation must not run after a native picker rejection'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'creator_premium_video_photos_export_failed');
  assert.match(result.message, /Photos/i);
  assert.match(result.message, /iCloud|descarg/i);
  assert.doesNotMatch(result.message, /3164/);
});

test('video picker orchestration handles permission, cancellation and a local selected asset', async () => {
  let launches = 0;
  assert.deepEqual(await presentation.selectCreatorPremiumVideoFromPhotos({
    requestPermission: async () => ({ granted: false }),
    launchPicker: async () => { launches += 1; },
    prepareAsset: async () => assert.fail('permission denial must stop before preparation'),
  }), { status: 'permission_required' });
  assert.equal(launches, 0);

  assert.deepEqual(await presentation.selectCreatorPremiumVideoFromPhotos({
    requestPermission: async () => ({ granted: true }),
    launchPicker: async () => ({ canceled: true, assets: [] }),
    prepareAsset: async () => assert.fail('cancellation must stop before preparation'),
  }), { status: 'cancelled' });

  const selected = { uri: 'file:///private/video.mp4', mimeType: 'video/mp4' };
  const localFile = { ...selected, fileName: 'video.mp4', sizeBytes: 4096 };
  assert.deepEqual(await presentation.selectCreatorPremiumVideoFromPhotos({
    requestPermission: async () => ({ granted: true, accessPrivileges: 'all' }),
    launchPicker: async () => ({ canceled: false, assets: [selected] }),
    prepareAsset: async asset => {
      assert.equal(asset, selected);
      return localFile;
    },
  }), { status: 'selected', file: localFile });
});

test('iOS picker avoids Expo passthrough export and every picker promise is caught', () => {
  assert.match(editor, /videoExportPreset\s*:\s*ImagePicker\.VideoExportPreset\.HighestQuality/);
  assert.match(editor, /preferredAssetRepresentationMode\s*:\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Automatic/);
  assert.doesNotMatch(editor, /preferredAssetRepresentationMode\s*:\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Current/);
  assert.match(editor, /Platform\.OS\s*===\s*'ios'[\s\S]*granted:\s*true/);
  assert.match(editor, /selectCreatorPremiumVideoFromPhotos\s*\(/);
  const imagePickerBody = editor.slice(editor.indexOf('const pickImage'), editor.indexOf('const pickVideoFromPhotos'));
  assert.match(imagePickerBody, /try\s*\{/);
  assert.match(imagePickerBody, /catch\s*\(reason\)/);
});

test('Workers AI accepts only deterministic wrappers before strict schema validation', () => {
  const fenced = visualStructuredResponseValue({
    success: true,
    result: { response: `\`\`\`json\n${JSON.stringify(safeVisualResult)}\n\`\`\`` },
  });
  assert.deepEqual(validateVisualSafetyResult(fenced, { sourceKind: 'eligible_image' }), safeVisualResult);

  const thoughtWrapped = visualStructuredResponseValue({
    success: true,
    result: { response: `<think>internal reasoning omitted</think>\n${JSON.stringify(safeVisualResult)}` },
  });
  assert.deepEqual(validateVisualSafetyResult(thoughtWrapped, { sourceKind: 'eligible_image' }), safeVisualResult);

  for (const response of [
    `result: ${JSON.stringify(safeVisualResult)}`,
    `\`\`\`json\n${JSON.stringify(safeVisualResult)}\n\`\`\` trailing`,
    '<think>unterminated',
    '{"schema_version":"visual-safety-v1"',
  ]) {
    assert.throws(
      () => visualStructuredResponseValue({ success: true, result: { response } }),
      error => error instanceof VisualProbeError
        && error.providerCalled === true
        && error.retryable === true,
    );
  }
});

test('Workers AI fails closed on ambiguous response carriers or multiple choices', () => {
  const encoded = JSON.stringify(safeVisualResult);
  for (const payload of [
    {
      success: true,
      result: {
        response: encoded,
        choices: [{ message: { content: encoded } }],
      },
    },
    {
      success: true,
      result: {
        choices: [
          { message: { content: encoded } },
          { message: { content: encoded } },
        ],
      },
    },
    {
      success: true,
      result: {
        choices: [{ message: { content: encoded }, text: encoded }],
      },
    },
  ]) {
    assert.throws(
      () => visualStructuredResponseValue(payload),
      error => error instanceof VisualProbeError
        && error.code === 'visual_workers_ai_structured_output_ambiguous'
        && error.providerCalled === true
        && error.retryable === true,
    );
  }
});

test('visual failure telemetry is bounded and never logs provider payloads', () => {
  assert.match(scanner, /visual_processing_failed/);
  assert.match(scanner, /code:\s*issue\.code/);
  assert.match(scanner, /retryable:\s*issue\.retryable/);
  assert.match(scanner, /provider_called:/);
  assert.match(scanner, /r2_visual_fetch_rejected/);
  assert.doesNotMatch(scanner, /new VisualPipelineError\([^\n]*String\(\(error as Error\)\?\.message/);
  assert.doesNotMatch(scanner, /console\.(?:warn|error|log)\([^\n]*(?:payload|bytes|object_key|cloudflare_uid)/i);
});

test('C3 producer correction promotes a pending retry while preserving failed-producer admin recovery', () => {
  const migrationNames = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(name => name.endsWith('_creator_premium_c3_visual_retry_producer.sql'));
  assert.equal(migrationNames.length, 1);
  const migration = read(`supabase/migrations/${migrationNames[0]}`);
  assert.match(migration, /create or replace function private\.content_safety_visual_producer_scan_id/i);
  assert.match(migration, /case\s+when\s+scan\.visual_status\s*=\s*'pending'\s+and\s+scan\.visual_analysis_id\s+is\s+null\s+then\s+0\s+else\s+1\s+end/i);
  assert.match(migration, /scan\.visual_provider\s*=\s*'cloudflare_workers_ai'/i);
  assert.match(migration, /scan\.visual_model\s*=\s*'@cf\/google\/gemma-4-26b-a4b-it'/i);
  assert.match(migration, /scan\.visual_prompt_version\s*=\s*'visual-safety-v1'/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate|drop\s+table)\b/i);

  const dedup = read('supabase/migrations/20260916054820_admin_content_safety_visual_asset_dedup_c1b.sql');
  const adminRetry = dedup.slice(
    dedup.indexOf('create or replace function public.admin_retry_content_safety_visual'),
    dedup.indexOf('revoke all on function private.content_safety_visual_analysis_id_for_asset'),
  );
  assert.match(adminRetry, /content_safety_visual_producer_scan_id/);
  assert.match(adminRetry, /visual_status\s*<>\s*'failed'/);
});

test('C3 preserves fail-closed policy and finance boundaries', () => {
  const integration = read('services/creatorPremiumIntegrationState.ts');
  assert.match(integration, /content_safety_policy_not_configured/);
  assert.match(scanner, /fail_content_safety_visual_scan/);
  assert.doesNotMatch(`${editor}\n${integration}\n${scanner}`, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/);
});
