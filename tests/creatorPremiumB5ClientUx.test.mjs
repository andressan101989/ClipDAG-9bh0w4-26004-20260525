import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const service = read('services/creatorPremiumService.ts');
const stream = read('services/creatorPremiumStreamService.ts');
const hub = read('app/creator-monetization.tsx');
const editorPath = path.join(root, 'app/creator-premium-editor.tsx');
const editor = existsSync(editorPath) ? readFileSync(editorPath, 'utf8') : '';
const upload = read('app/(tabs)/upload.tsx');
const profile = read('app/creator/[id].tsx');

test('canonical Creator Premium client owns every B5 management RPC', () => {
  for (const exported of [
    'setMyCreatorPremiumOffer',
    'createMyCreatorPremiumPlanDraft',
    'updateMyCreatorPremiumPlanDraft',
    'setMyCreatorPremiumPlanContents',
    'cloneMyCreatorPremiumPlanVersion',
    'activateMyCreatorPremiumPlan',
    'retireMyCreatorPremiumPlan',
    'fetchMyCreatorPremiumPlans',
    'submitMyCreatorPremiumContentForReview',
    'deleteMyCreatorPremiumDraft',
    'fetchMyCreatorPremiumContent',
  ]) assert.match(service, new RegExp(`export\\s+async\\s+function\\s+${exported}\\b`));
  for (const rpc of [
    'set_my_creator_premium_offer_v1',
    'create_my_creator_premium_plan_draft_v1',
    'update_my_creator_premium_plan_draft_v1',
    'set_my_creator_premium_plan_contents_v1',
    'clone_my_creator_premium_plan_version_v1',
    'activate_my_creator_premium_plan_v1',
    'retire_my_creator_premium_plan_v1',
    'get_my_creator_premium_plans_v1',
    'submit_my_creator_premium_content_for_review_v1',
    'delete_my_creator_premium_draft_v1',
    'get_my_creator_premium_content_v1',
  ]) assert.match(service, new RegExp(`['"]${rpc}['"]`));
  assert.match(service, /CREATOR_PREMIUM_FINANCE_AVAILABLE:\s*boolean\s*=\s*false/);
});

test('commercial price input remains an exact canonical decimal string through PostgREST', () => {
  assert.match(service, /normalizeCreatorPremiumPriceBdag/);
  assert.match(service, /priceBdag:\s*string/g);
  assert.match(service, /p_price_bdag:\s*normalizeCreatorPremiumPriceBdag\(input\.priceBdag\)/g);
  assert.doesNotMatch(hub, /const\s+price\s*=\s*Number\(planPrice/);
  assert.doesNotMatch(editor, /const\s+amount\s*=\s*Number\(price/);
  assert.match(hub, /normalizeCreatorPremiumPriceBdag\(planPrice\)/);
  assert.match(editor, /normalizeCreatorPremiumPriceBdag\(price\)/);
});

test('video upload result stays safe while B5 replacement remains server-authoritative', () => {
  const resultShape = stream.match(/export interface CreatorPremiumVideoMediaResult\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(resultShape);
  assert.doesNotMatch(resultShape, /cloudflareUid|videoAssetId|oldVideoAssetId/);
  assert.doesNotMatch(stream, /cloudflareUid|oldVideoAssetId/);
  assert.doesNotMatch(stream, /return\s*\{[^}]*cloudflareUid/s);
  assert.doesNotMatch(stream, /return\s*\{[^}]*videoAssetId/s);
});

test('canonical Hub replaces legacy Premium DM and fake earnings UI', () => {
  assert.match(hub, /Contenido Premium/);
  assert.match(hub, /Ventas y suscripciones aún no están habilitadas/);
  assert.match(hub, /Contenido/);
  assert.match(hub, /Planes/);
  assert.match(hub, /fetchMyCreatorPremiumContents/);
  assert.match(hub, /fetchMyCreatorPremiumPlans/);
  assert.match(hub, /creator-premium-editor/);
  assert.doesNotMatch(hub, /Premium DM|totalEarnings|Ganancias totales|subscribers_count|10%|0\.9|0\.1/);
  assert.doesNotMatch(hub, /economyService|subscriptionService|useWallet/);
  assert.match(hub, /planGroups/);
  for (const label of ['Borradores', 'Activos', 'Retirados']) assert.match(hub, new RegExp(label));
});

test('plan create and clone commands keep one UUID across an uncertain retry', () => {
  assert.match(hub, /planCreateAttempt\s*=\s*useRef/);
  assert.match(hub, /planCloneAttempts\s*=\s*useRef/);
  assert.match(hub, /planCreateAttempt\.current\?\.signature\s*!==\s*signature/);
  assert.match(hub, /planCloneAttempts\.current\.get\(plan\.id\)/);
  const action = hub.slice(hub.indexOf('const runPlanAction'), hub.indexOf('const confirmPlanAction'));
  assert.match(action, /const\s+refreshed\s*=\s*await\s+load\(true\);[\s\S]*if\s*\(\s*!refreshed\s*\)\s*throw[\s\S]*planCloneAttempts\.current\.delete\(plan\.id\)/);
  const save = hub.slice(hub.indexOf('const savePlan'), hub.indexOf('const runPlanAction'));
  assert.match(save, /const\s+refreshed\s*=\s*await\s+load\(true\);[\s\S]*if\s*\(\s*!refreshed\s*\)\s*throw[\s\S]*planCreateAttempt\.current\s*=\s*null/);
});

test('cloned drafts expose unavailable selected mappings so the creator can remove them', () => {
  assert.match(hub, /selectedContentIds\.includes\(item\.id\)/);
  assert.match(hub, /mappingUnavailable/);
  assert.match(hub, /No disponible[^\n]*quítalo/i);
  assert.match(hub, /toggleContent\(item\.id\)/);
});

test('Hub and editor use keyset continuation and exact owner detail beyond the first 100 rows', () => {
  assert.match(hub, /contentNextCursor/);
  assert.match(hub, /planNextCursor/);
  assert.match(hub, /loadMoreContents/);
  assert.match(hub, /loadMorePlans/);
  assert.match(hub, /cursor:\s*contentNextCursor/);
  assert.match(hub, /cursor:\s*planNextCursor/);
  assert.match(editor, /fetchMyCreatorPremiumContent\(targetId\)/);
  assert.match(editor, /planNextCursor/);
  assert.match(editor, /loadMorePlans/);
});

test('editor supports truthful draft, media, commercial, and automatic verification workflows', () => {
  assert.equal(existsSync(editorPath), true, 'creator Premium editor route must exist');
  for (const label of [
    'Detalles', 'Tipo', 'Acceso', 'Vista previa pública', 'Contenido privado',
    'Precio', 'Planes', 'Estado', 'Guardar borrador', 'Subir/Reemplazar medios',
    'Publicar contenido Premium', 'Eliminar borrador',
  ]) assert.match(editor, new RegExp(label.replace('/', '\\/'), 'i'));
  assert.match(editor, /uploadCreatorPremiumImagePair/);
  assert.match(editor, /uploadCreatorPremiumVideoMedia/);
  assert.match(editor, /creator_premium_teaser_image|teaser/i);
  assert.match(editor, /pending_review/);
  assert.match(editor, /verification_status/);
  assert.match(editor, /AbortController/);
  assert.match(editor, /processing/);
  assert.doesNotMatch(editor, /Publicar ahora/i);
  assert.doesNotMatch(editor, /getCreatorPremiumVideoPlaybackGrant|getCreatorPremiumOriginalImageGrant/);
  assert.doesNotMatch(editor, /AsyncStorage|from\s+['"]expo-media-library['"]|MediaLibrary\.(?:save|createAsset)|\bShare\b|FileSystem\.download|downloadAsync/);
  assert.match(editor, /copyToCacheDirectory\s*:\s*false/);
  assert.doesNotMatch(editor, /copyToCacheDirectory\s*:\s*true/);
});

test('existing creator and upload entry points lead to the one Premium domain', () => {
  assert.match(profile, /creator-monetization/);
  assert.match(upload, /creator-premium-editor/);
  assert.doesNotMatch(upload, /import[^;]*createExclusiveContent|createExclusiveContent\s*\(/s);
  assert.match(upload, /EXCLUSIVE_CONTENT_REGISTRATION_DISABLED/);
  assert.doesNotMatch(upload, /ExclusiveToggle/);
});

test('B5 active callers never use legacy Premium finance or subscription mutations', () => {
  const active = `${hub}\n${editor}\n${service}\n${upload}`;
  for (const forbidden of [
    'createExclusiveContent', 'purchaseContent', 'subscribeToPlan',
    'cancelUnpublishedExclusiveContent', 'services/subscriptionService',
  ]) assert.doesNotMatch(active, new RegExp(forbidden));
});
