import { legalManifest, legalDocuments } from './manifest.ts';
import { resolveLegalDocument, type LegalId } from './core.ts';

// Prepared for a later mobile route migration. Current routes do not import it.
export function getMobileLegalDocument(id: LegalId, locale: string) {
  return resolveLegalDocument(legalManifest, legalDocuments, id, locale);
}
