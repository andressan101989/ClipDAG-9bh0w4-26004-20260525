import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
  CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS,
  creatorPremiumLifecycleActions,
  normalizeCreatorPremiumVideoPickerAsset,
} from '../services/creatorPremiumPresentation.mjs';
import {
  buildSignedStreamFrameUrl,
  sampleVideoFrameTimestamps,
} from '../supabase/functions/content-safety-scan/visualPipeline.mjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const editor = read('app/creator-premium-editor.tsx');
const hub = read('app/creator-monetization.tsx');
const service = read('services/creatorPremiumService.ts');
const stream = read('services/streamService.ts');
const premiumStream = read('services/creatorPremiumStreamService.ts');
const createStream = read('supabase/functions/create-stream-upload/index.ts');
const migrationName = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .find(name => name.endsWith('_creator_premium_qa_final_f1.sql'));
const migration = migrationName ? read(`supabase/migrations/${migrationName}`) : '';

const video = (durationMs) => ({
  uri: 'file:///premium.mp4', mimeType: 'video/mp4', fileName: 'premium.mp4',
  sizeBytes: 50_000_000, durationMs,
});

test('Premium video accepts 179/180 seconds and rejects 181 without raising the 200 MB limit', () => {
  assert.equal(CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS, 180_000);
  assert.equal(normalizeCreatorPremiumVideoPickerAsset(video(179_000)).sizeBytes, 50_000_000);
  assert.equal(normalizeCreatorPremiumVideoPickerAsset(video(180_000)).sizeBytes, 50_000_000);
  assert.throws(() => normalizeCreatorPremiumVideoPickerAsset(video(180_001)), /creator_premium_video_duration_invalid/);
  assert.throws(() => normalizeCreatorPremiumVideoPickerAsset({ ...video(1_000), sizeBytes: 200_000_001 }), /creator_premium_video_size_invalid/);
});

test('visual and semantic coverage spans a full 180-second Premium video', () => {
  const timestamps = sampleVideoFrameTimestamps(180);
  assert.equal(timestamps.length, 5);
  assert.ok(timestamps[0] >= 0 && timestamps[0] <= 10_000);
  assert.ok(timestamps.at(-1) >= 170_000 && timestamps.at(-1) < 180_000);
  assert.throws(() => sampleVideoFrameTimestamps(180.001), /invalid_stream_duration/);
  const signed = 'https://customer-example.cloudflarestream.com/a.b.c/thumbnails/thumbnail.jpg';
  assert.match(buildSignedStreamFrameUrl(signed, 179_999), /time=179\.999s/);
});

test('Premium Stream uses one resumable TUS contract while Feed keeps basic POST', () => {
  assert.match(createStream, /direct_user=true/);
  assert.match(createStream, /Tus-Resumable/);
  assert.match(createStream, /Upload-Length/);
  assert.match(createStream, /stream-media-id/i);
  assert.match(createStream, /protocol:\s*'tus'/);
  assert.match(createStream, /maxDurationSeconds:\s*CREATOR_PREMIUM_STREAM_MAX_DURATION_SECONDS/);
  assert.match(createStream, /\/direct_upload/);
  assert.match(stream, /uploadCreatorPremiumVideoWithTus/);
  assert.match(stream, /retryDelays:\s*\[0,\s*1_000,\s*3_000,\s*5_000\]/);
  assert.match(stream, /chunkSize:\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(stream, /onProgress/);
  assert.match(stream, /abort\(false\)/);
  assert.match(premiumStream, /uploadCreatorPremiumVideoWithTus/);
  assert.doesNotMatch(premiumStream, /postVideoToStreamUploadUrl/);
});

test('iOS Photos selection avoids export/transcoding and catches permission, iCloud and cancellation paths', () => {
  const body = editor.slice(editor.indexOf('const pickVideoFromPhotos'), editor.indexOf('const pickVideoFromFiles'));
  assert.match(body, /requestMediaLibraryPermissionsAsync/);
  assert.doesNotMatch(body, /Promise\.resolve\(\{\s*granted:\s*true/);
  assert.match(body, /VideoExportPreset\.Passthrough/);
  assert.match(body, /UIImagePickerPreferredAssetRepresentationMode\.Current/);
  assert.match(body, /selectCreatorPremiumVideoFromPhotos/);
});

test('editor selects owned active plans and submits mappings atomically on the server', () => {
  assert.match(editor, /eligiblePlans\s*=\s*useMemo\(\(\)\s*=>\s*plans\.filter\(plan\s*=>\s*plan\.status\s*===\s*'active'/);
  assert.match(editor, /publishMyCreatorPremiumContentWithPlans/);
  assert.doesNotMatch(editor, /const\s+draftPlans\s*=\s*useMemo/);
  assert.match(service, /submit_my_creator_premium_content_with_plans_v1/);
  assert.match(migration, /create function public\.submit_my_creator_premium_content_with_plans_v1/i);
  assert.match(migration, /public\.idempotency_keys/i);
  assert.match(migration, /clone_my_creator_premium_plan_version_v1/i);
  assert.match(migration, /set_my_creator_premium_plan_contents_v1/i);
  assert.match(migration, /submit_my_creator_premium_content_for_review_v1/i);
  assert.match(migration, /activate_my_creator_premium_plan_v1/i);
});

test('owner lifecycle exposes safe published withdrawal and dependency-free draft plan deletion', () => {
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'published' }).canRetire, true);
  assert.equal(creatorPremiumLifecycleActions({ lifecycle_status: 'deleted' }).canRetire, false);
  assert.match(service, /retireMyCreatorPremiumContent/);
  assert.match(service, /deleteMyCreatorPremiumPlanDraft/);
  assert.match(editor, /Retirar publicación/);
  assert.match(hub, /Eliminar borrador/);
  assert.match(migration, /create function public\.retire_my_creator_premium_content_v1/i);
  assert.match(migration, /creator_premium_content_has_financial_history/i);
  assert.match(migration, /lifecycle_status\s*=\s*'removed'/i);
  assert.match(migration, /create function public\.delete_my_creator_premium_plan_draft_v1/i);
  assert.match(migration, /creator_premium_plan_has_dependencies/i);
  assert.match(migration, /revoke all on function public\.(?:retire_my_creator_premium_content_v1|delete_my_creator_premium_plan_draft_v1)[\s\S]*from public, anon, authenticated, service_role/i);
});

test('F1 SQL keeps generic video at 60, Premium at 180, and never mutates Finance', () => {
  assert.match(migration, /purpose\s*=\s*'creator_premium_video'[\s\S]*max_duration_seconds\s+between\s+1\s+and\s+180/i);
  assert.match(migration, /purpose\s*<>\s*'creator_premium_video'[\s\S]*max_duration_seconds\s+between\s+1\s+and\s+60/i);
  assert.match(migration, /case\s+when\s+p_purpose\s*=\s*'creator_premium_video'\s+then\s+180\s+else\s+60\s+end/i);
  assert.match(migration, /content_safety_audio_source[\s\S]*p_target_type\s*=\s*'creator_premium'[\s\S]*duration_seconds\s*<=\s*180/i);
  assert.match(migration, /content_safety_visual_source[\s\S]*p_target_type\s*=\s*'creator_premium'[\s\S]*duration_seconds\s*<=\s*180/i);
  assert.match(migration, /claim_content_safety_audio_scans[\s\S]*when\s+scan\.target_type\s*=\s*'creator_premium'\s+then\s+180[\s\S]*else\s+60/i);
  assert.match(migration, /claim_content_safety_visual_scans[\s\S]*when\s+scan\.target_type\s*=\s*'creator_premium'\s+then\s+180[\s\S]*else\s+60/i);
  assert.doesNotMatch(migration, /purchase_enabled\s*=|subscription_enabled\s*=|refunds_enabled\s*=|platform_fee_bps\s*=/i);
  assert.doesNotMatch(migration, /truncate\s+table|drop\s+table/i);
});
