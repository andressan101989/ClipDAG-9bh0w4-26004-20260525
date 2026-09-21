import { legalManifest, legalDocuments } from './manifest.ts';
import { type LegalId } from './core.ts';
import { legalDecisions, getLegalActivationState } from './decisions.ts';

// The mobile routes use this adapter; approval is required before a final document resolves.
export function getMobileLegalDocument(id: LegalId, locale: string) {
  const state = getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
  if (state.state !== 'approved') throw new Error('legal_not_approved');
  return state.document;
}

// Pending and retired states expose no draft text to mobile routes.
export function getMobileLegalPageState(id: LegalId, locale: string) {
  return getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
}
