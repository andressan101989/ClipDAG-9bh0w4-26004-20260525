import paths from '../../../../shared/web-routing/paths.json';

// Destinations only. Public Astro never inspects the Business session or capabilities.
export const publicCtas = Object.freeze({
  home: '/',
  features: '/features',
  business: paths.businessBasePath,
  ads: '/ads',
  marketplace: '/marketplace',
  creators: '/creators',
  live: '/live',
  whatsNew: '/whats-new',
  download: '/download',
  support: '/support',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
  businessHome: `${paths.businessBasePath}/home`,
  businessLogin: `${paths.businessBasePath}/login`,
  businessAds: `${paths.businessBasePath}/ads`,
});

// No official store or testing URL is verified in this repository. Do not infer
// one from the app scheme or platform package identifiers.
export const storeLinks: Readonly<{ ios: string | null; android: string | null; testflight: string | null; androidTesting: string | null }> = Object.freeze({
  ios: null,
  android: null,
  testflight: null,
  androidTesting: null,
});
