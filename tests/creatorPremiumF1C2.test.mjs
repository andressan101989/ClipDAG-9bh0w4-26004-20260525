import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as presentation from '../services/creatorPremiumPresentation.mjs';
import { resolveGallerySelection } from './helpers/streamClientHarness.mjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const editor = read('app/creator-premium-editor.tsx');
const hub = read('app/creator-monetization.tsx');
const gallery = read('components/feature/IosVideoGalleryPicker.tsx');
const galleryService = read('services/iosVideoGalleryService.ts');

test('Premium iOS video uses the canonical MediaLibrary picker instead of the PhotoKit export path', () => {
  assert.match(editor, /IosVideoGalleryPicker/);
  assert.match(editor, /Platform\.OS\s*===\s*['"]ios['"][\s\S]*setIosVideoGalleryVisible\(true\)/);
  assert.match(editor, /maxDurationMs=\{CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS\}/);
  assert.match(editor, /onFiles=\{[\s\S]*pickVideoFromFiles/);
  assert.doesNotMatch(editor, /VideoExportPreset\.Passthrough/);
  assert.doesNotMatch(editor, /selectCreatorPremiumVideoFromPhotos/);
});

test('the shared gallery materializes iCloud assets and keeps Feed 60s separate from Premium 180s', () => {
  assert.match(gallery, /maxDurationMs\?:\s*number/);
  assert.match(gallery, /maxDurationMs\s*=\s*IOS_VIDEO_MAX_DURATION_MS/);
  assert.match(gallery, /resolveIosVideoAsset\(asset,\s*\{[\s\S]*maxDurationMs/);
  assert.match(galleryService, /shouldDownloadFromNetwork:\s*false/);
  assert.match(galleryService, /shouldDownloadFromNetwork:\s*true/);
  assert.match(galleryService, /maxDurationMs\s*=\s*IOS_VIDEO_MAX_DURATION_MS/);
  assert.match(galleryService, /durationMs\s*>\s*maxDurationMs/);
  assert.match(galleryService, /report\(['"]materialize['"]/);
  assert.match(galleryService, /elapsedMs/);
  assert.match(galleryService, /materializeTimeoutMs/);
  assert.match(galleryService, /signal\?:\s*AbortSignal/);
  assert.match(galleryService, /selection_cancelled/);
  assert.match(galleryService, /materialize_timeout/);
  assert.match(gallery, /selectionAbortRef/);
  assert.match(gallery, /Cancelar preparación/);
  assert.doesNotMatch(galleryService, /console\.(?:info|warn)\([^\n]*(?:asset\.id|localUri|filename)/);
});

test('materialization cancellation and timeout finish with stable recoverable codes', async () => {
  const dependencies = {
    asset: { id: 'private', filename: 'premium.mov', duration: 1 },
    getInfo: async (_id, options) => options.shouldDownloadFromNetwork
      ? new Promise(() => {})
      : { filename: 'premium.mov', duration: 1, isNetworkAsset: true },
    fileFactory: () => ({ exists: true, size: 1 }),
    copy: () => ({ uri: 'file:///cache/premium.mov', size: 1 }),
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => resolveGallerySelection({ ...dependencies, signal: controller.signal }),
    error => error.code === 'selection_cancelled',
  );
  await assert.rejects(
    () => resolveGallerySelection({ ...dependencies, materializeTimeoutMs: 5 }),
    error => error.code === 'materialize_timeout',
  );
});

test('Premium owns and releases only its materialized cache file after replace, upload, or unmount', () => {
  assert.match(editor, /ownedCacheUri\?:\s*string/);
  assert.match(editor, /deleteOwnedIosVideoCache/);
  assert.match(editor, /replacePrivateFile/);
  assert.match(editor, /cleanupOwnedVideoCache/);
  assert.match(editor, /uploadAbort\.current\?\.abort\(\)[\s\S]*cleanupOwnedVideoCache\(\)/);
  assert.match(editor, /setProcessing\(['"]ready['"]\)[\s\S]*cleanupOwnedVideoCache\(\)/);
});

test('creator Hub never renders deleted content while preserving non-deleted lifecycle states', () => {
  assert.equal(typeof presentation.visibleCreatorPremiumContents, 'function');
  const rows = [
    { id: 'draft', lifecycle_status: 'draft' },
    { id: 'published', lifecycle_status: 'published' },
    { id: 'retired', lifecycle_status: 'removed' },
    { id: 'deleted', lifecycle_status: 'deleted' },
  ];
  assert.deepEqual(
    presentation.visibleCreatorPremiumContents(rows).map(row => row.id),
    ['draft', 'published', 'retired'],
  );
  assert.match(hub, /const\s+visibleContents\s*=\s*useMemo/);
  assert.match(hub, /visibleCreatorPremiumContents\(contents\)/);
  assert.match(hub, /visibleContents\.length\s*===\s*0/);
  assert.match(hub, /visibleContents\.map\(item\s*=>/);
});

test('plan deletion remains the dependency-safe canonical RPC followed by a server refresh', () => {
  const action = hub.slice(hub.indexOf('const runPlanAction'), hub.indexOf('const confirmPlanAction'));
  assert.match(action, /deleteMyCreatorPremiumPlan/);
  assert.match(action, /await\s+load\(true\)/);
  assert.doesNotMatch(action, /setPlans\([^\n]*filter/);
  assert.match(hub, /plan\.status\s*===\s*['"]active['"][\s\S]*Retirar/);
  assert.match(hub, /plan\.status\s*===\s*['"]draft['"][\s\S]*Eliminar plan/);
  assert.match(hub, /plan\.status\s*===\s*['"]retired['"][\s\S]*confirmPlanAction\(plan, 'delete'\)/);
});
