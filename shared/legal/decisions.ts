// Internal approval checklist. It does not authorize or activate any document.
import { getLegalPresentationState, resolveLegalDocument, validateLegalManifest, type ContactId, type LegalId } from './core.ts';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
export const legalDecisionIds = [
  'legalEntity', 'tradeName', 'jurisdiction', 'address',
  'supportContact', 'privacyContact', 'legalContact', 'copyrightContact',
  'minimumAge', 'guardianPolicy', 'governingLaw', 'disputeModel', 'arbitration',
  'liabilityApproval', 'contentLicenseApproval', 'bdagLegalCharacterization',
  'feesApproval', 'refundPolicyApproval', 'payoutTermsApproval',
  'retentionApproval', 'deletionPolicyApproval', 'internationalTransferReview', 'providerReview',
  'privacyEffectiveDate', 'termsEffectiveDate', 'approvedLocales',
  'privacyOwnerApproval', 'privacyLegalApproval', 'termsOwnerApproval', 'termsLegalApproval',
] as const;

export type LegalDecisionId = typeof legalDecisionIds[number];
export type LegalDecision = {
  status: 'unresolved' | 'approved';
  value: string | null;
  source: string | null;
  approvedAt: string | null;
};

const unresolved = (): LegalDecision => Object.freeze({ status: 'unresolved', value: null, source: null, approvedAt: null });
export const legalDecisions: Readonly<Record<LegalDecisionId, LegalDecision>> = Object.freeze(
  Object.fromEntries(legalDecisionIds.map((id) => [id, unresolved()])) as Record<LegalDecisionId, LegalDecision>,
);

export function validateLegalDecisions(value: unknown): asserts value is Record<LegalDecisionId, LegalDecision> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('legal_decisions_invalid');
  const registry = value as Record<string, unknown>;
  const keys = Object.keys(registry);
  if (keys.length !== legalDecisionIds.length || legalDecisionIds.some((id) => !Object.hasOwn(registry, id))) throw new Error('legal_decisions_missing_or_duplicate');
  for (const id of legalDecisionIds) {
    const decision = registry[id] as LegalDecision | null;
    if (!decision || !['unresolved', 'approved'].includes(decision.status) || Object.keys(decision).sort().join(',') !== 'approvedAt,source,status,value') throw new Error('legal_decision_invalid');
    const fields = [decision.value, decision.source, decision.approvedAt];
    if (decision.status === 'unresolved' && fields.some((field) => field !== null)) throw new Error('legal_decision_unresolved_value');
    if (decision.status === 'approved' && (fields.some((field) => typeof field !== 'string' || !field.trim()) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(decision.approvedAt!))) throw new Error('legal_decision_approval_incomplete');
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
    if (manifest.contacts[contactId].status === 'verified' && getApprovedLegalContact(manifest, decisions, contactId) === null) return { state: 'pending' } as const;
  }
  const identity = legalApprovalIdentity(manifest, content, decisions, id);
  const approvals = id === 'privacy' ? ['privacyOwnerApproval', 'privacyLegalApproval'] as const : ['termsOwnerApproval', 'termsLegalApproval'] as const;
  if (approvals.some((approval) => decisions[approval].value !== identity)) return { state: 'pending' } as const;
  return state;
}
