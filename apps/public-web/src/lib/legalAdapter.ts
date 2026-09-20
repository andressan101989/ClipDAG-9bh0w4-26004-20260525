import { legalManifest, legalDocuments } from '../../../../shared/legal/manifest.ts';
import { resolveLegalDocument, type LegalId } from '../../../../shared/legal/core.ts';

// Prepared for a later Astro route migration. Existing shells do not import it.
export function getPublicLegalDocument(id: LegalId, locale: string) {
  return resolveLegalDocument(legalManifest, legalDocuments, id, locale);
}
