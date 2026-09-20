import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { legalManifest, legalDocuments } from '../shared/legal/manifest.ts';
import { canonicalDrafts, privacyDataMatrix, providerMatrix, financialFacts, legacyReconciliation, validateDraftRegistry } from '../shared/legal/drafts.ts';
import { validateLegalDocument, resolveLegalDocument } from '../shared/legal/core.ts';
import { getMobileLegalDocument } from '../shared/legal/mobile.ts';
import { getPublicLegalDocument } from '../apps/public-web/src/lib/legalAdapter.ts';

const fileExists = (ref) => {
  const match = ref.match(/^(.*):(\d+)$/);
  if (!match || !existsSync(match[1])) return false;
  return Boolean(readFileSync(match[1], 'utf8').split(/\r?\n/)[Number(match[2]) - 1]?.trim());
};

test('one canonical registry contains pending privacy and terms drafts but neither adapter can activate them', () => {
  assert.doesNotMatch(readFileSync('shared/legal/manifest.ts', 'utf8'), /from ['"]\.\/drafts\.ts['"]/);
  assert.doesNotMatch(readFileSync('shared/legal/content.ts', 'utf8'), /evidenceRefs|providerMatrix|legacyReconciliation|export const canonicalDrafts/);
  assert.deepEqual(legalDocuments.map((document) => document.id), ['privacy', 'terms']);
  assert.deepEqual(canonicalDrafts.map((entry) => entry.document), legalDocuments);
  for (const id of ['privacy', 'terms']) {
    const draft = canonicalDrafts.find((entry) => entry.document.id === id);
    assert.ok(draft);
    assert.equal(draft.document.locale, 'en');
    assert.doesNotThrow(() => validateLegalDocument(draft.document));
    assert.equal(legalManifest.documents[id].status, 'pending_approval');
    assert.equal(legalManifest.documents[id].version, null);
    assert.equal(legalManifest.documents[id].effectiveDate, null);
    assert.deepEqual(legalManifest.documents[id].availableLocales, []);
    assert.throws(() => getMobileLegalDocument(id, 'en'), /not_approved/);
    assert.throws(() => getPublicLegalDocument(id, 'en'), /not_approved/);
  }
});

test('a status flip cannot publish an explicitly unapproved draft version', () => {
  const flipped = structuredClone(legalManifest);
  flipped.legalEntity = 'TEST_ONLY Entity';
  flipped.jurisdiction = 'TEST_ONLY Jurisdiction';
  flipped.address = 'TEST_ONLY Address';
  flipped.documents.privacy = {
    status: 'approved', version: 'draft-c2-unapproved', effectiveDate: '2030-01-01',
    lastUpdated: '2030-01-01', availableLocales: ['en'],
  };
  assert.throws(() => resolveLegalDocument(flipped, legalDocuments, 'privacy', 'en'), /draft_unapproved/);
});

test('draft provenance covers each section, rejects gaps and does not enter renderer-neutral documents', () => {
  assert.doesNotThrow(() => validateDraftRegistry(canonicalDrafts));
  for (const entry of canonicalDrafts) {
    assert.deepEqual(entry.provenance.map((item) => item.sectionId), entry.document.sections.map((section) => section.id));
    for (const item of entry.provenance) {
      assert.ok(['verified_fact', 'owner_decision_required', 'legal_review_required', 'blocked_unknown'].includes(item.decisionState));
      assert.ok(item.evidenceRefs.length > 0 || item.decisionState !== 'verified_fact');
      assert.ok(item.evidenceRefs.every(fileExists));
    }
    assert.ok(entry.document.sections.every((section) => !('provenance' in section)));
  }
  const missing = structuredClone(canonicalDrafts);
  missing[0].provenance.pop();
  assert.throws(() => validateDraftRegistry(missing), /draft_provenance/);
});

test('privacy categories, providers and financial claims are evidence-linked and cautious', () => {
  assert.deepEqual(privacyDataMatrix.map((item) => item.category), [
    'account', 'profile', 'content', 'stories', 'messages', 'media', 'live', 'marketplace',
    'business', 'ads', 'payments', 'payouts', 'analytics', 'device_technical', 'push_notifications',
  ]);
  for (const item of [...privacyDataMatrix, ...providerMatrix, ...financialFacts]) {
    assert.ok(item.evidenceRefs.length > 0);
    assert.ok(item.evidenceRefs.every(fileExists));
  }
  assert.ok(privacyDataMatrix.every((item) => item.retention === null));
  const text = legalDocuments.flatMap((document) => document.sections.flatMap((section) => section.blocks.flatMap((block) => block.type === 'paragraph' ? [block.text] : block.type === 'list' ? block.items : []))).join(' ');
  assert.doesNotMatch(text, /@(?:clipdag\.io|onspace\.ai|nelyon\.app)|0\.01\s*\$?DAG|\$50|10%|85\s*\/\s*15|7[- ]day|seven[- ]day|2FA|24\/7|regular audits|30[- ]day|binding arbitration|13\+|all (?:user )?data (?:is |always )?deleted/i);
  assert.doesNotMatch(text, /guaranteed|end-to-end encrypted|not redeemable for cash|governed by the laws of/i);
  assert.ok(providerMatrix.some((item) => item.provider === 'Supabase'));
  assert.ok(providerMatrix.some((item) => item.provider === 'Cloudflare' && /Workers AI/.test(item.use) && /configuration/.test(item.caveat)));
  assert.ok(legalDocuments.find((item) => item.id === 'privacy').sections.some((section) => section.id === 'content-safety' && /transcription|visual analysis/.test(section.blocks[0].text)));
  assert.ok(financialFacts.some((item) => item.topic === 'ledger'));
});

test('each material legacy conflict has a recorded disposition without adopting legacy text', () => {
  const expected = ['onspace.ai contacts', 'clipdag.io contacts', 'age 13+', 'all-data deletion',
    'settings deletion promise', '0.01 DAG per like', '50 dollar withdrawal threshold', '10 percent commission',
    'seven-day payment', '85/15 gifts', '2FA', '24/7 monitoring', 'regular audits',
    '30-day notice', 'immediate changes', 'arbitration', 'jurisdiction'];
  assert.deepEqual(legacyReconciliation.map((item) => item.claim), expected);
  assert.ok(legacyReconciliation.every((item) => item.evidenceRefs.length > 0 && item.evidenceRefs.every(fileExists)));
  assert.ok(legacyReconciliation.every((item) => ['KEEP_FACTUAL', 'REWRITE_FACTUAL', 'REMOVE_UNSUPPORTED', 'OWNER_DECISION', 'LEGAL_REVIEW'].includes(item.classification)));
  assert.ok(legacyReconciliation.some((item) => item.claim === 'settings deletion promise' && /misleading|contradict/i.test(item.treatment)));
});
