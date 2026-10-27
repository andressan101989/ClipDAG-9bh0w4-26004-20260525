import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261027042552_stories_v2_interactive_b1.sql');
const mediaPurposes = read('../supabase/functions/_shared/mediaPurposes.ts');
const streamSecurity = read('../supabase/functions/_shared/premiumStreamSecurity.ts');
const createMedia = read('../supabase/functions/create-media-upload/index.ts');
const createStream = read('../supabase/functions/create-stream-upload/index.ts');
const webhook = read('../supabase/functions/stream-webhook/index.ts');
const playback = read('../supabase/functions/get-stream-playback/index.ts');
const cleanup = read('../supabase/functions/cleanup-stale-media-uploads/index.ts');
const scanner = read('../supabase/functions/content-safety-scan/index.ts');
const streamService = read('../services/streamService.ts');
const feed = read('../app/(tabs)/index.tsx');

test('new R2 allocations reject story_video while retaining private story_image', () => {
  // The legacy rule remains readable so already-issued uploads can finalize
  // and enter MEDIA-C1 cleanup; only new reservations are rejected.
  assert.match(mediaPurposes, /story_video\s*:\s*\{/);
  assert.match(mediaPurposes, /story_image\s*:\s*\{[\s\S]*defaultVisibility:\s*"private"/);
  assert.match(createMedia, /story_video_requires_stream/);
});

test('Story video uses the canonical private Stream contract with a provider-trusted 15 second ceiling', () => {
  assert.match(streamSecurity, /STORY_STREAM_PURPOSE\s*=\s*['"]story_video['"]/);
  assert.match(streamSecurity, /STORY_STREAM_MAX_DURATION_SECONDS\s*=\s*15/);
  assert.match(streamSecurity, /duration[^\n]*>\s*0/);
  assert.match(createStream, /story_video/);
  assert.match(createStream, /maxDurationSeconds:\s*15/);
  assert.match(streamService, /createStoryStreamUpload/);
  assert.match(streamService, /uploadStoryVideoWithTus/);
  assert.match(streamService, /waitForStoryStreamReady/);
  assert.match(feed, /uploadStoryVideoWithTus/);
  assert.doesNotMatch(feed, /purpose:\s*isVideo\s*\?\s*['"]story_video['"]/);
});

test('Story Stream is private, CAS-fenced, signed, and never exposed by raw viewer asset id', () => {
  assert.match(webhook, /story_video/);
  assert.match(webhook, /reconcilePrivateStreamVideo/);
  assert.match(playback, /story_id/);
  assert.match(playback, /select\(['"]id,user_id,media_type,expires_at['"]\)/);
  assert.match(playback, /maximumExpiresAtSeconds/);
  assert.match(playback, /createPrivateStreamPlaybackGrant/);
  assert.match(playback, /story_video/);
  assert.match(playback, /entity_type[^\n]*story/);
  assert.match(cleanup, /story_video/);
  assert.match(migration, /video_asset_links_story_shape_check/);
  assert.match(migration, /purpose='creator_premium_video' and max_duration_seconds between 1 and 180/);
  assert.match(migration, /purpose='story_video' and max_duration_seconds=15/);
  assert.match(migration, /story_video[^\n]*private/);
  assert.match(migration, /duration_seconds\s*>\s*0/);
  assert.match(migration, /duration_seconds\s*<=\s*15/);
});

test('Story media is hydrated after binding and multimodal evidence remains fail closed', () => {
  assert.match(migration, /story_enqueue_media_safety_v1/);
  assert.match(migration, /private\.enqueue_content_safety_scan\('story'/);
  assert.match(migration, /create(?: or replace)? function private\.content_safety_audio_source/);
  assert.match(migration, /create(?: or replace)? function private\.content_safety_visual_source/);
  assert.match(migration, /scan\.target_type in\s*\(\s*'video'\s*,\s*'creator_premium'\s*,\s*'story'\s*\)/);
  assert.match(migration, /content_safety_content_version_changed|story_safety_stale_evidence/);
  assert.match(migration, /missing_owner_approved_story_policy/);
  assert.doesNotMatch(migration, /update private\.story_safety_state[\s\S]{0,120}state\s*=\s*'passed'/i);
  assert.match(migration, /story_b1_take_worker_lane_v1\('audio'\)/);
  assert.match(migration, /story_b1_take_worker_lane_v1\('visual'\)/);
  assert.doesNotMatch(migration, /mod\s*\(\s*pg_catalog\.txid_current\(\)\s*,\s*2\s*\)/i);
  assert.match(scanner, /target_type[^\n]*story|targetType[^\n]*story/);
});

test('Story worker lanes and Stream cleanup use durable bounded fairness', () => {
  assert.match(migration, /create table private\.story_b1_worker_lane_state/);
  assert.match(migration, /select state\.next_lane[\s\S]{0,200}for update/i);
  assert.match(migration, /story_b1_take_worker_lane_v1\('stream_cleanup'\)/);
  assert.match(migration, /v_story_budget/);
  assert.match(migration, /v_core_budget/);
  assert.match(migration, /v_total\s*<\s*v_limit/);
  assert.doesNotMatch(migration, /sustained Story backlog cannot\s*\n\s*-- starve/i);
});

test('Story Content Safety signs private sources and refuses incomplete modalities', () => {
  assert.match(scanner, /createPrivateStreamAudioDownloadGrant/);
  assert.match(scanner, /story_video/);
  assert.match(scanner, /incomplete[^\n]*(?:modality|evidence)|(?:modality|evidence)[^\n]*incomplete/i);
  assert.match(scanner, /content_fingerprint/);
});
