import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { supportTopics } from '../src/data/support.ts';
import { legalManifest, legalDocuments } from '../../../shared/legal/manifest.ts';
import { getLegalPresentationState } from '../../../shared/legal/core.ts';
import { legalDecisions, legalDecisionIds, validateLegalDecisions, getLegalActivationState, legalApprovalIdentity, getApprovedLegalContact } from '../../../shared/legal/decisions.ts';
import { getMobileLegalPageState } from '../../../shared/legal/mobile.ts';

const repoRoot = new URL('../../../', import.meta.url);
const source = (path) => readFileSync(new URL(path, repoRoot), 'utf8');
const present = (path) => existsSync(new URL(path, repoRoot));

test('Support and Contact use dedicated pages and factual internal navigation', () => {
  for (const route of ['support', 'contact', 'privacy', 'terms']) {
    assert.ok(present(`apps/public-web/src/pages/${route}.astro`));
  }
  const shell = source('apps/public-web/src/pages/[...path].astro');
  assert.match(shell, /!dedicatedRoutes\.includes/);
  assert.ok(supportTopics.length >= 5);
  for (const topic of supportTopics) {
    assert.ok(topic.questions.length > 0);
    for (const link of topic.links) assert.ok(['features', 'business', 'ads', 'marketplace', 'creators', 'live', 'download', 'privacy', 'terms', 'contact'].includes(link.cta));
  }
  const contact = source('apps/public-web/src/pages/contact.astro');
  assert.match(contact, /getApprovedLegalContact/);
  assert.doesNotMatch(contact, /<form\b|@(?:clipdag|onspace|nelyon)\./i);
});

test('pending legal content is not presentable but an approved fixture resolves from the same authority', () => {
  for (const id of ['privacy', 'terms']) {
    assert.deepEqual(getLegalPresentationState(legalManifest, legalDocuments, id, 'en'), { state: 'pending' });
    assert.deepEqual(getMobileLegalPageState(id, 'en'), { state: 'pending' });
  }
  const fixture = structuredClone(legalManifest);
  fixture.legalEntity = 'TEST_ONLY Entity'; fixture.jurisdiction = 'TEST_ONLY Jurisdiction'; fixture.address = 'TEST_ONLY Address';
  const document = structuredClone(legalDocuments[0]);
  document.version = 'TEST_ONLY-approved-v1';
  fixture.documents.privacy = { status: 'approved', version: document.version, effectiveDate: '2030-01-01', lastUpdated: '2030-01-01', availableLocales: ['en'] };
  const result = getLegalPresentationState(fixture, [document, legalDocuments[1]], 'privacy', 'en');
  assert.equal(result.state, 'approved');
  assert.equal(result.document.toc.length, document.sections.length);
  assert.deepEqual(getLegalActivationState(fixture, [document, legalDocuments[1]], legalDecisions, 'privacy', 'en'), { state: 'pending' });
  const approvedDecisions = structuredClone(legalDecisions);
  for (const decision of Object.values(approvedDecisions)) Object.assign(decision, { status: 'approved', legalReview: 'approved', value: 'TEST_ONLY approved', source: 'TEST_ONLY owner and legal review', approvedAt: '2030-01-01T00:00:00Z' });
  const noContactIdentity = legalApprovalIdentity(fixture, [document, legalDocuments[1]], approvedDecisions, 'privacy');
  approvedDecisions.privacyOwnerApproval.value = noContactIdentity;
  approvedDecisions.privacyLegalApproval.value = noContactIdentity;
  assert.deepEqual(getLegalActivationState(fixture, [document, legalDocuments[1]], approvedDecisions, 'privacy', 'en'), { state: 'pending' });
  for (const contactId of ['support', 'privacy', 'legal', 'copyright']) {
    const email = `${contactId}@example.test`;
    fixture.contacts[contactId] = { status: 'verified', value: email };
    approvedDecisions[`${contactId}Contact`].value = email;
  }
  const missingAgeProof = structuredClone(approvedDecisions);
  missingAgeProof.ageEnforcement = structuredClone(legalDecisions.ageEnforcement);
  assert.deepEqual(getLegalActivationState(fixture, [document, legalDocuments[1]], missingAgeProof, 'privacy', 'en'), { state: 'pending' });
  const identity = legalApprovalIdentity(fixture, [document, legalDocuments[1]], approvedDecisions, 'privacy');
  assert.match(identity, /^sha256:[0-9a-f]{64}$/);
  approvedDecisions.privacyOwnerApproval.value = identity;
  approvedDecisions.privacyLegalApproval.value = identity;
  assert.equal(getLegalActivationState(fixture, [document, legalDocuments[1]], approvedDecisions, 'privacy', 'en').state, 'approved');
  const changedDocument = structuredClone(document);
  changedDocument.sections[0].blocks[0].text += ' TEST_ONLY mutation';
  assert.deepEqual(getLegalActivationState(fixture, [changedDocument, legalDocuments[1]], approvedDecisions, 'privacy', 'en'), { state: 'pending' });
  const changedDate = structuredClone(fixture);
  changedDate.documents.privacy.lastUpdated = '2030-01-02';
  assert.deepEqual(getLegalActivationState(changedDate, [document, legalDocuments[1]], approvedDecisions, 'privacy', 'en'), { state: 'pending' });
  const changedIdentity = structuredClone(fixture);
  changedIdentity.legalEntity = 'TEST_ONLY Different Entity';
  assert.deepEqual(getLegalActivationState(changedIdentity, [document, legalDocuments[1]], approvedDecisions, 'privacy', 'en'), { state: 'pending' });
  const changedContact = structuredClone(fixture);
  changedContact.contacts.support = { status: 'verified', value: 'changed@example.test' };
  assert.deepEqual(getLegalActivationState(changedContact, [document, legalDocuments[1]], approvedDecisions, 'privacy', 'en'), { state: 'pending' });
  fixture.documents.privacy.status = 'retired';
  assert.deepEqual(getLegalPresentationState(fixture, [document, legalDocuments[1]], 'privacy', 'en'), { state: 'retired' });
  const mobile = source('components/legal/CanonicalLegalDocument.tsx');
  assert.match(mobile, /getMobileLegalPageState/);
  for (const path of ['app/privacy-policy.tsx', 'app/terms-of-service.tsx', 'app/legal.tsx']) assert.doesNotMatch(source(path), /CanonicalLegalDocument/);
});

test('one decision registry distinguishes owner policy from legal approval and cannot accidentally activate', () => {
  assert.doesNotThrow(() => validateLegalDecisions(legalDecisions));
  assert.ok(legalDecisionIds.includes('creatorExclusiveMinimumAge'));
  assert.equal(legalDecisions.minimumAge.value, '13');
  assert.equal(legalDecisions.creatorExclusiveMinimumAge.value, '18');
  assert.ok(Object.values(legalDecisions).every((decision) => decision.status !== 'approved' && decision.legalReview === 'pending' && decision.approvedAt === null));
  const invalid = structuredClone(legalDecisions);
  invalid.legalEntity.status = 'approved';
  assert.throws(() => validateLegalDecisions(invalid), /approval_incomplete/);
  assert.equal(legalManifest.documents.privacy.status, 'pending_approval');
  assert.equal(legalManifest.documents.terms.status, 'pending_approval');
});

test('a verified contact still requires a matching owner/legal decision', () => {
  const fixture = structuredClone(legalManifest);
  fixture.contacts.support = { status: 'verified', value: 'TEST_ONLY@example.test' };
  assert.equal(getApprovedLegalContact(fixture, legalDecisions, 'support'), null);
  const decisions = structuredClone(legalDecisions);
  decisions.supportContact = { status: 'approved', legalReview: 'approved', value: 'wrong@example.test', source: 'TEST_ONLY', approvedAt: '2030-01-01T00:00:00Z' };
  assert.equal(getApprovedLegalContact(fixture, decisions, 'support'), null);
  decisions.supportContact.value = 'TEST_ONLY@example.test';
  assert.equal(getApprovedLegalContact(fixture, decisions, 'support'), 'TEST_ONLY@example.test');
});
