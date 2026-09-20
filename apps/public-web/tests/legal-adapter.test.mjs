import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicLegalDocument } from '../src/lib/legalAdapter.ts';
import { legalManifest } from '../../../shared/legal/manifest.ts';
import { publicRoutes } from '../src/lib/routeContract.mjs';

test('Astro adapter does not expose unapproved Privacy or Terms', () => {
  assert.equal(legalManifest.documents.privacy.status, 'pending_approval');
  assert.throws(() => getPublicLegalDocument('privacy', 'en'), /not_approved/);
  assert.throws(() => getPublicLegalDocument('terms', 'es'), /not_approved/);
});

test('legal web paths remain registered in the public routing contract', () => {
  assert.equal(publicRoutes.includes(legalManifest.routes.privacy.web), true);
  assert.equal(publicRoutes.includes(legalManifest.routes.terms.web), true);
});
