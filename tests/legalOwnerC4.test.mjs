import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDecisions, validateLegalDecisions, getLegalActivationState } from '../shared/legal/decisions.ts';
import { legalManifest, legalDocuments } from '../shared/legal/manifest.ts';

const text = (id) => legalDocuments.find((document) => document.id === id).sections
  .flatMap((section) => section.blocks.map((block) => block.text ?? '')).join(' ');

test('owner allows 13+ accounts and reserves creator exclusive content for 18+ while legal activation stays blocked', () => {
  assert.equal(legalDecisions.minimumAge.value, '13');
  assert.equal(legalDecisions.creatorExclusiveMinimumAge.value, '18');
  assert.equal(legalDecisions.minimumAge.status, 'owner_approved');
  assert.equal(legalDecisions.minimumAge.legalReview, 'pending');
  assert.equal(legalDecisions.guardianPolicy.value, 'No parental-consent exception for accounts under 13');
  assert.equal(legalDecisions.ageEnforcement.status, 'unresolved');
  assert.match(text('terms'), /minimum eligibility age at 13/i);
  assert.match(text('terms'), /creator-exclusive content requires 18/i);
  assert.doesNotMatch(text('privacy'), /operational age enforcement remains pending activation/i);
  assert.deepEqual(getLegalActivationState(legalManifest, legalDocuments, legalDecisions, 'terms', 'en'), { state: 'pending' });
});

test('owner-provided identity remains unverified and all official contacts remain unavailable', () => {
  assert.doesNotThrow(() => validateLegalDecisions(legalDecisions));
  assert.equal(legalDecisions.legalEntity.value, 'Nelyon, Inc.');
  assert.equal(legalDecisions.legalEntity.status, 'owner_selected_pending_registration_verification');
  assert.equal(legalDecisions.jurisdiction.value, 'Florida, United States');
  assert.equal(legalDecisions.address.value, '2055 SW 122nd Ave\nMiami, FL 33175\nUnited States');
  assert.equal(legalManifest.legalEntity, null);
  assert.equal(legalManifest.jurisdiction, null);
  assert.equal(legalManifest.address, null);
  for (const contact of Object.values(legalManifest.contacts)) assert.deepEqual(contact, { status: 'unverified', value: null });
  for (const id of ['supportContact', 'privacyContact', 'legalContact', 'copyrightContact']) assert.equal(legalDecisions[id].value, null);
  const bad = structuredClone(legalDecisions);
  bad.legalEntity.legalReview = 'approved';
  assert.throws(() => validateLegalDecisions(bad), /legal_review/);
});

test('owner policy draft records constrained dispute, content and financial terms without legal signoff', () => {
  const terms = text('terms');
  const privacy = text('privacy');
  assert.match(terms, /Miami-Dade County/i);
  assert.match(terms, /30 days/i);
  assert.match(terms, /no mandatory arbitration/i);
  assert.match(terms, /no class-action waiver and no jury-trial waiver/i);
  assert.match(terms, /retain ownership/i);
  assert.match(terms, /non-exclusive/i);
  assert.match(terms, /sublicensing only insofar as needed/i);
  assert.match(terms, /does not transfer ownership/i);
  assert.match(terms, /BDAG is a unit within the Nelyon ecosystem/i);
  assert.match(privacy, /reasonably necessary/i);
  assert.doesNotMatch(`${terms} ${privacy}`, /@(?:nelyon\.app|onspace\.ai|clipdag\.io)|0\.01\s*\$?DAG|\$50|10%|85\s*\/\s*15|seven[- ]day|7[- ]day|guaranteed investment return/i);
  assert.match(terms, /no investment return is promised/i);
  assert.match(terms, /no universal fixed conversion value is promised/i);
  assert.match(terms, /per-flow verification remains necessary/i);
  for (const id of ['governingLaw', 'disputeModel', 'arbitration', 'contentLicenseApproval', 'bdagLegalCharacterization', 'feesApproval', 'refundPolicyApproval', 'payoutTermsApproval', 'retentionApproval', 'deletionPolicyApproval']) {
    assert.equal(legalDecisions[id].legalReview, 'pending');
    assert.notEqual(legalDecisions[id].status, 'approved');
  }
  for (const id of ['privacyOwnerApproval', 'privacyLegalApproval', 'termsOwnerApproval', 'termsLegalApproval']) assert.equal(legalDecisions[id].status, 'unresolved');
});
