// Internal approval checklist. It does not authorize or activate any document.
import { getLegalPresentationState, resolveLegalDocument, validateLegalManifest, type ContactId, type LegalId } from './core.ts';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
export const legalDecisionIds = [
  'legalEntity', 'tradeName', 'jurisdiction', 'address',
  'supportContact', 'privacyContact', 'legalContact', 'copyrightContact',
  'minimumAge', 'creatorExclusiveMinimumAge', 'guardianPolicy', 'ageEnforcement', 'governingLaw', 'disputeModel', 'arbitration',
  'liabilityApproval', 'contentLicenseApproval', 'bdagLegalCharacterization',
  'feesApproval', 'refundPolicyApproval', 'payoutTermsApproval',
  'retentionApproval', 'deletionPolicyApproval', 'internationalTransferReview', 'providerReview',
  'privacyEffectiveDate', 'termsEffectiveDate', 'approvedLocales',
  'privacyOwnerApproval', 'privacyLegalApproval', 'termsOwnerApproval', 'termsLegalApproval',
] as const;

export type LegalDecisionId = typeof legalDecisionIds[number];
export type LegalDecisionStatus = 'unresolved' | 'owner_approved' | 'owner_selected_pending_registration_verification'
  | 'owner_approved_pending_registration_verification' | 'owner_provided'
  | 'owner_policy_approved_legal_review_pending' | 'owner_policy_no_mandatory_arbitration_legal_review_pending'
  | 'owner_policy_defined_legal_review_pending' | 'owner_policy_defined_operational_channel_pending_legal_review'
  | 'approved';
export type LegalDecision = {
  status: LegalDecisionStatus;
  legalReview: 'pending' | 'approved';
  value: string | null;
  source: string | null;
  approvedAt: string | null;
};
const decisionStatuses: LegalDecisionStatus[] = ['unresolved', 'owner_approved', 'owner_selected_pending_registration_verification',
  'owner_approved_pending_registration_verification', 'owner_provided', 'owner_policy_approved_legal_review_pending',
  'owner_policy_no_mandatory_arbitration_legal_review_pending', 'owner_policy_defined_legal_review_pending',
  'owner_policy_defined_operational_channel_pending_legal_review', 'approved'];

const unresolved = (): LegalDecision => Object.freeze({ status: 'unresolved', legalReview: 'pending', value: null, source: null, approvedAt: null });
const owner = (status: Exclude<LegalDecisionStatus, 'unresolved' | 'approved'>, value: string, source = 'NPW-F-C4'): LegalDecision =>
  Object.freeze({ status, legalReview: 'pending', value, source: `Owner direction: ${source}`, approvedAt: null });
export const legalDecisions: Readonly<Record<LegalDecisionId, LegalDecision>> = Object.freeze(
  {
    ...Object.fromEntries(legalDecisionIds.map((id) => [id, unresolved()])),
    tradeName: owner('owner_approved', 'Nelyon'),
    legalEntity: owner('owner_selected_pending_registration_verification', 'Nelyon, Inc.'),
    jurisdiction: owner('owner_approved_pending_registration_verification', 'Florida, United States'),
    address: owner('owner_provided', '2055 SW 122nd Ave\nMiami, FL 33175\nUnited States'),
    minimumAge: owner('owner_approved', '13', 'NPW-F-C5-B2-C1'),
    creatorExclusiveMinimumAge: owner('owner_approved', '18', 'NPW-F-C5-B2-C1'),
    guardianPolicy: owner('owner_approved', 'No parental-consent exception for accounts under 13', 'NPW-F-C5-B2-C1'),
    governingLaw: owner('owner_policy_approved_legal_review_pending', 'Florida law and applicable United States federal law, subject to non-waivable rights'),
    disputeModel: owner('owner_policy_approved_legal_review_pending', 'Informal resolution for 30 days after valid notice; then competent state or federal courts in Miami-Dade County, subject to mandatory forums'),
    arbitration: owner('owner_policy_no_mandatory_arbitration_legal_review_pending', 'No mandatory arbitration, class-action waiver or jury-trial waiver'),
    contentLicenseApproval: owner('owner_policy_approved_legal_review_pending', 'User ownership retained; limited non-exclusive worldwide royalty-free operational license, with sublicensing only as needed for service providers'),
    bdagLegalCharacterization: owner('owner_policy_defined_legal_review_pending', 'BDAG ecosystem accounting unit; no investment return or universal fixed conversion value promised'),
    feesApproval: owner('owner_policy_defined_legal_review_pending', 'Proposed per-flow fee disclosure and authorization; actual flows require verification; no universal rate'),
    refundPolicyApproval: owner('owner_policy_defined_legal_review_pending', 'Refunds depend on applicable operation, state and policy; no universal guarantee'),
    payoutTermsApproval: owner('owner_policy_defined_legal_review_pending', 'Payouts depend on eligibility, validation, provider and transaction terms; no universal minimum or timing'),
    retentionApproval: owner('owner_policy_defined_legal_review_pending', 'Category-dependent reasonable necessity for service, safety, legal, transaction, fraud, dispute and audit purposes; no fixed period'),
    deletionPolicyApproval: owner('owner_policy_defined_operational_channel_pending_legal_review', 'Request channel not yet established; some records may remain where necessary or permitted'),
  } as Record<LegalDecisionId, LegalDecision>,
);

export function validateLegalDecisions(value: unknown): asserts value is Record<LegalDecisionId, LegalDecision> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('legal_decisions_invalid');
  const registry = value as Record<string, unknown>;
  const keys = Object.keys(registry);
  if (keys.length !== legalDecisionIds.length || legalDecisionIds.some((id) => !Object.hasOwn(registry, id))) throw new Error('legal_decisions_missing_or_duplicate');
  for (const id of legalDecisionIds) {
    const decision = registry[id] as LegalDecision | null;
    if (!decision || !decisionStatuses.includes(decision.status) || Object.keys(decision).sort().join(',') !== 'approvedAt,legalReview,source,status,value') throw new Error('legal_decision_invalid');
    const fields = [decision.value, decision.source, decision.approvedAt];
    if (decision.status === 'unresolved' && (decision.legalReview !== 'pending' || fields.some((field) => field !== null))) throw new Error('legal_decision_unresolved_value');
    if (decision.status !== 'unresolved' && decision.status !== 'approved' && (decision.legalReview !== 'pending' || decision.approvedAt !== null)) throw new Error('legal_decision_legal_review_pending');
    if (decision.status !== 'unresolved' && (typeof decision.value !== 'string' || !decision.value.trim() || typeof decision.source !== 'string' || !decision.source.trim())) throw new Error('legal_decision_value_missing');
    if (decision.status === 'approved' && (decision.legalReview !== 'approved' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(decision.approvedAt ?? ''))) throw new Error('legal_decision_approval_incomplete');
  }
}

validateLegalDecisions(legalDecisions);

const contactDecisionIds: Record<ContactId, LegalDecisionId> = {
  support: 'supportContact', privacy: 'privacyContact', legal: 'legalContact', copyright: 'copyrightContact',
};

// Every signoff binds the exact rendered text, identity, contacts, decisions and effective metadata.
export function legalApprovalIdentity(manifest: unknown, content: readonly unknown[], decisions: unknown, id: LegalId): string {
  validateLegalManifest(manifest);
  validateLegalDecisions(decisions);
  const meta = manifest.documents[id];
  if (meta.status !== 'approved') throw new Error('legal_not_approved');
  const documents = [...meta.availableLocales].sort().map((locale) => {
    const document = resolveLegalDocument(manifest, content, id, locale);
    return { locale, title: document.title, version: document.version, sections: document.sections };
  });
  const inputs = legalDecisionIds.filter((decision) => !decision.endsWith('OwnerApproval') && !decision.endsWith('LegalApproval'))
    .map((decision) => [decision, decisions[decision]]);
  const exactContent = JSON.stringify({
    id, brand: manifest.brand, legalEntity: manifest.legalEntity, jurisdiction: manifest.jurisdiction,
    address: manifest.address, contacts: manifest.contacts, version: meta.version,
    effectiveDate: meta.effectiveDate, lastUpdated: meta.lastUpdated, documents, inputs,
  });
  return `sha256:${bytesToHex(sha256(utf8ToBytes(exactContent)))}`;
}

export function getApprovedLegalContact(manifest: unknown, decisions: unknown, id: ContactId): string | null {
  validateLegalManifest(manifest);
  validateLegalDecisions(decisions);
  const contact = manifest.contacts[id];
  const decision = decisions[contactDecisionIds[id]];
  return contact.status === 'verified' && decision.status === 'approved' && decision.value === contact.value ? contact.value : null;
}

// A manifest status change alone cannot expose current legal text through the platform adapters.
export function getLegalActivationState(manifest: unknown, content: readonly unknown[], decisions: unknown, id: LegalId, locale: string) {
  const state = getLegalPresentationState(manifest, content, id, locale);
  if (state.state !== 'approved') return state;
  validateLegalDecisions(decisions);
  if (legalDecisionIds.some((decision) => decisions[decision].status !== 'approved')) return { state: 'pending' } as const;
  validateLegalManifest(manifest);
  for (const contactId of Object.keys(contactDecisionIds) as ContactId[]) {
    if (getApprovedLegalContact(manifest, decisions, contactId) === null) return { state: 'pending' } as const;
  }
  const identity = legalApprovalIdentity(manifest, content, decisions, id);
  const approvals = id === 'privacy' ? ['privacyOwnerApproval', 'privacyLegalApproval'] as const : ['termsOwnerApproval', 'termsLegalApproval'] as const;
  if (approvals.some((approval) => decisions[approval].value !== identity)) return { state: 'pending' } as const;
  return state;
}
