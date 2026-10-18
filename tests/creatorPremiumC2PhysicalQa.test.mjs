import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  prepareCreatorPremiumVideoPickerAsset,
} from '../services/creatorPremiumPresentation.mjs';
import {
  creatorPremiumSubmissionBlockerMessage,
} from '../services/creatorPremiumIntegrationState.ts';
import {
  VisualProbeError,
  visualStructuredResponseValue,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const editor = read('app/creator-premium-editor.tsx');
const visualMigration = read('supabase/migrations/20260916054820_admin_content_safety_visual_asset_dedup_c1b.sql');

test('iOS video assets use the native local file size and never fetch a file URI', () => {
  const seen = [];
  const prepared = prepareCreatorPremiumVideoPickerAsset({
    uri: 'file:///private/var/mobile/video.mov',
    mimeType: 'video/quicktime',
    fileName: 'video.mov',
    sizeBytes: null,
    durationMs: 12_000,
  }, {
    sizeForUri: uri => {
      seen.push(uri);
      return 42_000;
    },
  });

  assert.deepEqual(prepared, {
    uri: 'file:///private/var/mobile/video.mov',
    mimeType: 'video/quicktime',
    fileName: 'video.mov',
    sizeBytes: 42_000,
  });
  assert.deepEqual(seen, ['file:///private/var/mobile/video.mov']);

  const videoFileBody = editor.slice(editor.indexOf('async function videoFile'), editor.indexOf('function videoPickerError'));
  assert.match(videoFileBody, /sizeForUri:\s*uri\s*=>\s*new\s+File\(uri\)\.size/);
  assert.doesNotMatch(videoFileBody, /fetch\(asset\.uri\)/);
  assert.match(editor, /preferredAssetRepresentationMode\s*:\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Current/);
  assert.match(editor, /videoExportPreset\s*:\s*ImagePicker\.VideoExportPreset\.Passthrough/);
  assert.match(editor, /copyToCacheDirectory\s*:\s*true/);
});

test('unavailable iCloud/local video data fails with an actionable stable code', () => {
  assert.throws(
    () => prepareCreatorPremiumVideoPickerAsset({
      uri: 'file:///not-downloaded.mov',
      mimeType: 'video/quicktime',
      fileName: 'not-downloaded.mov',
      sizeBytes: null,
      durationMs: 1000,
    }, { sizeForUri: () => { throw new Error('native file unavailable'); } }),
    /creator_premium_video_asset_unreadable/,
  );
  assert.match(editor, /creator_premium_video_asset_unreadable/);
  assert.match(editor, /Descarga el video por completo/i);
});

test('plan preflight distinguishes an unmapped plan from a mapped draft or retired plan', () => {
  assert.match(
    creatorPremiumSubmissionBlockerMessage('creator_premium_active_plan_required', {
      mapped_plan_count: 1,
      active_plan_count: 0,
    }),
    /borrador o fue retirado/i,
  );
  assert.match(
    creatorPremiumSubmissionBlockerMessage('creator_premium_active_plan_required', {
      mapped_plan_count: 0,
      active_plan_count: 0,
    }),
    /asocia.+plan.+actívalo/i,
  );
  assert.doesNotMatch(
    creatorPremiumSubmissionBlockerMessage('creator_premium_active_plan_required', {
      mapped_plan_count: 1,
      active_plan_count: 0,
    }),
    /seguridad aprobada/i,
  );
  assert.match(editor, /creatorPremiumSubmissionBlockerMessage\(preflight\.submission_blocker,\s*preflight\)/);
});

test('nonconforming Workers AI structured output stays fail-closed but is bounded-retryable', () => {
  for (const response of ['not-json', 'result: {"objects":[]}']) {
    assert.throws(
      () => visualStructuredResponseValue({ success: true, result: { response } }),
      error => error instanceof VisualProbeError
        && error.providerCalled === true
        && error.retryable === true,
    );
  }
  assert.match(visualMigration, /v_retry\s*:=\s*coalesce\(p_retryable,false\)\s+and\s+v_scan\.visual_attempt_count\s*<\s*5\s+and\s+v_calls\s*<\s*5/i);
  assert.match(visualMigration, /visual_status\s*=\s*case\s+when\s+v_retry\s+then\s+'pending'\s+else\s+'failed'\s+end/i);
});

test('C2 changes preserve fail-closed policy and finance boundaries', () => {
  const integration = read('services/creatorPremiumIntegrationState.ts');
  const scanner = read('supabase/functions/content-safety-scan/index.ts');
  assert.match(integration, /content_safety_policy_not_configured/);
  assert.match(scanner, /fail_content_safety_visual_scan/);
  assert.doesNotMatch(`${editor}\n${integration}`, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/);
});
