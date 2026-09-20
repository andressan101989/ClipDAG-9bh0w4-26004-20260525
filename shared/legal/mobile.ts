import { legalManifest, legalDocuments } from './manifest.ts';
import { type LegalId } from './core.ts';
import { legalDecisions, getLegalActivationState } from './decisions.ts';

// Prepared for a later mobile route migration. Current routes do not import it.
export function getMobileLegalDocument(id: LegalId, locale: string) {
  const state = getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
  if (state.state !== 'approved') throw new Error('legal_not_approved');
  return state.document;
}

// Future mobile routes can use this state without exposing pending draft text.
export function getMobileLegalPageState(id: LegalId, locale: string) {
  return getLegalActivationState(legalManifest, legalDocuments, legalDecisions, id, locale);
}
