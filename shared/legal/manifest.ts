import type { LegalDocument, LegalManifest } from './core.ts';

// This is the sole future technical authority. No legal text is approved yet.
export const legalManifest: LegalManifest = {
  brand: 'Nelyon',
  legalEntity: null,
  jurisdiction: null,
  address: null,
  contacts: {
    support: { status: 'unverified', value: null },
    privacy: { status: 'unverified', value: null },
    legal: { status: 'unverified', value: null },
    copyright: { status: 'unverified', value: null },
  },
  documents: {
    privacy: { status: 'pending_approval', version: null, effectiveDate: null, lastUpdated: null, availableLocales: [] },
    terms: { status: 'pending_approval', version: null, effectiveDate: null, lastUpdated: null, availableLocales: [] },
  },
  routes: {
    privacy: { mobile: '/privacy-policy', web: '/privacy' },
    terms: { mobile: '/terms-of-service', web: '/terms' },
  },
  legacyHub: { route: '/legal', reviewRequired: ['community', 'copyright', 'monetization', 'cookies'] },
};

// Approved documents will be added only after owner/legal approval.
export const legalDocuments: readonly LegalDocument[] = [];
