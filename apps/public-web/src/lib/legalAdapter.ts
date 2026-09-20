import { legalManifest, legalDocuments } from '../../../../shared/legal/manifest.ts';
import { type LegalId } from '../../../../shared/legal/core.ts';
import { legalDecisions, getLegalActivationState } from '../../../../shared/legal/decisions.ts';

// Prepared for a later Astro route migration. Existing shells do not import it.
export function getPublicLegalDocument(id: LegalId, locale: string) {
  const state = getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
  if (state.state !== 'approved') throw new Error('legal_not_approved');
  return state.document;
}

export function getPublicLegalPageState(id: LegalId, locale: string) {
  return getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
}
