import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { legalManifest, legalDocuments } from '../shared/legal/manifest.ts';
import {
  validateLegalManifest, validateLegalDocument, resolveLegalDocument,
  resolveLegalContact, fingerprintLegalDocument,
} from '../shared/legal/core.ts';
import { getMobileLegalDocument } from '../shared/legal/mobile.ts';

const approvedManifest = structuredClone(legalManifest);
approvedManifest.legalEntity = 'TEST_ONLY Legal Entity';
approvedManifest.jurisdiction = 'TEST_ONLY Jurisdiction';
approvedManifest.address = 'TEST_ONLY Address';
approvedManifest.contacts.privacy = { status: 'verified', value: 'privacy@example.test' };
approvedManifest.documents.privacy.status = 'approved';
approvedManifest.documents.privacy.version = 'test-v1';
approvedManifest.documents.privacy.effectiveDate = '2030-01-02';
approvedManifest.documents.privacy.lastUpdated = '2030-01-02';
approvedManifest.documents.privacy.availableLocales = ['en'];

// TEST_ONLY: deliberately isolated from the production manifest/content registry.
const fixture = {
  id: 'privacy', locale: 'en', version: 'test-v1',
  title: 'Test policy',
  sections: [{ id: 'overview', title: 'Overview', blocks: [
    { type: 'paragraph', text: 'Test-only content.' },
    { type: 'contact', contactId: 'privacy' },
  ] }],
};

test('initial authority has no approved content or invented identity/contact', () => {
  assert.equal(legalManifest.brand, 'Nelyon');
  assert.equal(legalManifest.legalEntity, null);
  assert.equal(legalManifest.jurisdiction, null);
  assert.equal(legalManifest.address, null);
  assert.deepEqual(legalDocuments.map((document) => document.id), ['privacy', 'terms']);
  for (const id of ['privacy', 'terms']) {
    assert.equal(legalManifest.documents[id].status, 'pending_approval');
    assert.equal(legalManifest.documents[id].version, null);
    assert.equal(legalManifest.documents[id].effectiveDate, null);
    assert.equal(legalManifest.documents[id].lastUpdated, null);
    assert.deepEqual(legalManifest.documents[id].availableLocales, []);
  }
  for (const contact of Object.values(legalManifest.contacts)) {
    assert.equal(contact.status, 'unverified');
    assert.equal(contact.value, null);
  }
  assert.throws(() => resolveLegalDocument(legalManifest, legalDocuments, 'privacy', 'en'), /not_approved/);
  assert.throws(() => getMobileLegalDocument('terms', 'es'), /not_approved/);
});

test('manifest validation rejects unknown states, locales and invalid dates', () => {
  assert.doesNotThrow(() => validateLegalManifest(legalManifest));
  const badStatus = structuredClone(legalManifest);
  badStatus.documents.privacy.status = 'active';
  assert.throws(() => validateLegalManifest(badStatus), /status/);
  const badLocale = structuredClone(approvedManifest);
  badLocale.documents.privacy.availableLocales = ['xx'];
  assert.throws(() => validateLegalManifest(badLocale), /locale/);
  const badDate = structuredClone(approvedManifest);
  badDate.documents.privacy.effectiveDate = '2030-02-30';
  assert.throws(() => validateLegalManifest(badDate), /date/);
  const missingId = structuredClone(legalManifest);
  delete missingId.documents.terms;
  assert.throws(() => validateLegalManifest(missingId), /terms/);
  for (const field of ['legalEntity', 'jurisdiction', 'address']) {
    const missingIdentity = structuredClone(approvedManifest);
    missingIdentity[field] = null;
    assert.throws(() => validateLegalManifest(missingIdentity), /approved_identity_missing/);
  }
  const malformedContact = structuredClone(approvedManifest);
  malformedContact.contacts.privacy.value = 'privacy?inject@example.test';
  assert.throws(() => validateLegalManifest(malformedContact), /contact_value_invalid/);
  const emptyLegacyReview = structuredClone(legalManifest);
  emptyLegacyReview.legacyHub.reviewRequired = [];
  assert.throws(() => validateLegalManifest(emptyLegacyReview), /legacy_hub_invalid/);
});

test('document validation rejects duplicate anchors, unsafe HTML and wrong identity', () => {
  assert.doesNotThrow(() => validateLegalDocument(fixture));
  assert.throws(() => validateLegalDocument({ ...fixture, id: 'unknown' }), /id/);
  assert.throws(() => validateLegalDocument({ ...fixture, sections: [fixture.sections[0], fixture.sections[0]] }), /duplicate_section/);
  assert.throws(() => validateLegalDocument({ ...fixture, sections: [{ id: 'x', title: 'X', blocks: [{ type: 'paragraph', text: '<script>alert(1)</script>' }] }] }), /unsafe_html/);
  assert.throws(() => validateLegalDocument({ ...fixture, sections: [{ id: 'x', title: 'X', blocks: [{ type: 'paragraph', text: 'Contact privacy@nelyon.app' }] }] }), /inline_contact/);
  assert.throws(() => validateLegalDocument({ ...fixture, sections: [{ id: 'x', title: 'X', blocks: [{ type: 'paragraph', text: 'OnSpace policy' }] }] }), /legacy_brand/);
  assert.throws(() => validateLegalDocument({ ...fixture, unexpected: true }), /unexpected/);
});

test('approval, locale and contacts fail closed', () => {
  assert.throws(() => resolveLegalDocument(legalManifest, [fixture], 'privacy', 'en'), /not_approved/);
  assert.equal(resolveLegalDocument(approvedManifest, [fixture], 'privacy', 'en').sections[0].id, 'overview');
  assert.equal(resolveLegalDocument(approvedManifest, [fixture], 'privacy', 'en').sections[0].blocks.length, 2);
  assert.throws(() => resolveLegalDocument(approvedManifest, [fixture], 'privacy', 'es'), /locale_unavailable/);
  assert.throws(() => resolveLegalDocument(approvedManifest, [fixture, fixture], 'privacy', 'en'), /content_missing_or_duplicate/);
  assert.equal(resolveLegalContact(legalManifest, 'privacy'), null);
  assert.equal(resolveLegalContact(approvedManifest, 'privacy'), 'privacy@example.test');
  assert.equal(resolveLegalDocument(approvedManifest, [fixture], 'privacy', 'en').sections[0].blocks[1].value, 'privacy@example.test');
  const unverifiedContact = structuredClone(approvedManifest);
  unverifiedContact.contacts.privacy = { status: 'unverified', value: null };
  assert.equal(resolveLegalContact(unverifiedContact, 'privacy'), null);
  assert.throws(() => resolveLegalDocument(unverifiedContact, [fixture], 'privacy', 'en'), /contact_unverified/);
  const legacyContact = structuredClone(approvedManifest);
  legacyContact.contacts.privacy.value = 'privacy@onspace.ai';
  assert.throws(() => validateLegalManifest(legacyContact), /legacy_contact/);
  const retired = structuredClone(approvedManifest);
  retired.documents.privacy.status = 'retired';
  assert.throws(() => resolveLegalDocument(retired, [fixture], 'privacy', 'en'), /not_approved/);
});

test('fingerprint is deterministic and changes with content or metadata', () => {
  const first = fingerprintLegalDocument(fixture);
  assert.equal(first, fingerprintLegalDocument(structuredClone(fixture)));
  assert.notEqual(first, fingerprintLegalDocument({ ...fixture, title: 'Changed' }));
  assert.notEqual(first, fingerprintLegalDocument({ ...fixture, version: 'test-v2' }));
  const differentEffectiveDate = structuredClone(approvedManifest);
  differentEffectiveDate.documents.privacy.effectiveDate = '2030-01-03';
  differentEffectiveDate.documents.privacy.lastUpdated = '2030-01-03';
  assert.equal(first, resolveLegalDocument(differentEffectiveDate, [fixture], 'privacy', 'en').fingerprint);
});

test('route map keeps one mobile and web destination per document', () => {
  assert.deepEqual(legalManifest.routes.privacy, { mobile: '/privacy-policy', web: '/privacy' });
  assert.deepEqual(legalManifest.routes.terms, { mobile: '/terms-of-service', web: '/terms' });
  assert.equal(legalManifest.legacyHub.route, '/legal');
  assert.deepEqual(legalManifest.legacyHub.reviewRequired, ['community', 'copyright', 'monetization', 'cookies']);
  for (const route of [legalManifest.routes.privacy.mobile, legalManifest.routes.terms.mobile, legalManifest.legacyHub.route]) {
    assert.equal(existsSync(`app${route}.tsx`), true, `existing mobile route ${route}`);
  }
});
