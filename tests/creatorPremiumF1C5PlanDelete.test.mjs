import assert from 'node:assert/strict';
import test from 'node:test';

import * as presentation from '../services/creatorPremiumPresentation.mjs';
import { creatorPremiumErrorMessage } from '../services/creatorPremiumIntegrationState.ts';

const plans = Object.freeze([
  Object.freeze({ id: 'course-v1', status: 'active', mapped_content_ids: ['content-1'] }),
  Object.freeze({ id: 'vip-v2', status: 'active', mapped_content_ids: [] }),
  Object.freeze({ id: 'retired-v1', status: 'retired', mapped_content_ids: ['content-1'] }),
]);

test('an editor refresh preserves only the current active plan choices before submit', () => {
  assert.equal(typeof presentation.resolveCreatorPremiumPlanSelection, 'function');
  assert.deepEqual(
    presentation.resolveCreatorPremiumPlanSelection({
      plans,
      contentId: 'content-1',
      selectedPlanIds: ['vip-v2', 'retired-v1', 'missing-plan'],
      preserveSelection: true,
    }),
    ['vip-v2'],
  );
});

test('a preflight snapshot keeps multiple active choices while dropping stale plan ids', () => {
  assert.deepEqual(
    presentation.resolveCreatorPremiumPlanSelection({
      plans,
      contentId: 'content-1',
      selectedPlanIds: ['vip-v2', 'course-v1', 'retired-v1', 'missing-plan', 'vip-v2'],
      preserveSelection: true,
    }),
    ['course-v1', 'vip-v2'],
  );
});

test('a canonical reload replaces local choices with active server mappings', () => {
  assert.equal(typeof presentation.resolveCreatorPremiumPlanSelection, 'function');
  assert.deepEqual(
    presentation.resolveCreatorPremiumPlanSelection({
      plans,
      contentId: 'content-1',
      selectedPlanIds: ['vip-v2'],
      preserveSelection: false,
    }),
    ['course-v1'],
  );
});

test('removed content keeps an actionable delete surface in the editor', () => {
  assert.equal(typeof presentation.creatorPremiumEditorActionVisibility, 'function');
  const actions = presentation.creatorPremiumLifecycleActions({ lifecycle_status: 'removed' });
  assert.deepEqual(
    presentation.creatorPremiumEditorActionVisibility(actions, { hasContentId: true }),
    {
      showActionBar: true,
      showDelete: true,
      showRetire: false,
    },
  );
});

test('published content exposes retirement but never direct deletion', () => {
  assert.equal(typeof presentation.creatorPremiumEditorActionVisibility, 'function');
  const actions = presentation.creatorPremiumLifecycleActions({ lifecycle_status: 'published' });
  assert.deepEqual(
    presentation.creatorPremiumEditorActionVisibility(actions, { hasContentId: true }),
    {
      showActionBar: true,
      showDelete: false,
      showRetire: true,
    },
  );
});

test('submit plan-version conflicts use actionable copy without exposing SQL diagnostics', () => {
  assert.equal(
    creatorPremiumErrorMessage({
      code: '55000',
      message: 'creator_premium_plan_content_unavailable',
    }),
    'El plan contiene una publicación que ya no está disponible. Actualiza los planes y vuelve a intentarlo.',
  );
  assert.equal(
    creatorPremiumErrorMessage({
      code: '40001',
      message: 'creator_premium_plan_selection_stale',
    }),
    'La selección de planes cambió mientras publicabas. Actualiza los planes y vuelve a intentarlo.',
  );
});
