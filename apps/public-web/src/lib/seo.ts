import { publicRoutes } from './routeContract.mjs';

export const PUBLIC_ORIGIN = 'https://nelyon.app';

export type PublicSeoEntry = {
  title: string;
  description: string;
  indexable: boolean;
  lang: 'en' | 'es';
};

export const publicSeo: Readonly<Record<string, PublicSeoEntry>> = Object.freeze({
  '/': { title: 'Nelyon — Connect. Create. Go LIVE. Grow.', description: 'Nelyon brings social discovery, creators, LIVE, commerce and business tools together in one connected ecosystem.', indexable: true, lang: 'en' },
  '/features': { title: 'Features', description: 'Explore how social discovery, creators, LIVE, Marketplace and Business connect in Nelyon.', indexable: true, lang: 'en' },
  '/business': { title: 'Nelyon Business', description: 'Explore the Nelyon workspace for products, orders, Ads, media, Analytics, Finance and Team.', indexable: true, lang: 'en' },
  '/ads': { title: 'Nelyon Ads', description: 'Discover Nelyon Ads placements across Marketplace and Social Feed, managed from Nelyon Business.', indexable: true, lang: 'en' },
  '/marketplace': { title: 'Marketplace', description: 'Discover products, stores and creator-connected commerce within the Nelyon ecosystem.', indexable: true, lang: 'en' },
  '/creators': { title: 'Creators', description: 'Explore creator profiles, content, community and connected LIVE and commerce experiences on Nelyon.', indexable: true, lang: 'en' },
  '/live': { title: 'Nelyon LIVE', description: 'Explore Nelyon LIVE experiences, real-time interaction and creator Battles.', indexable: true, lang: 'en' },
  '/whats-new': { title: 'What’s New', description: 'Explore Nelyon product previews and updates, with a clear availability status for every story.', indexable: true, lang: 'en' },
  '/download': { title: 'Download Nelyon', description: 'Find verified Nelyon app availability and explore the connected experience and Business workspace.', indexable: true, lang: 'en' },
  '/support': { title: 'Nelyon Support Center', description: 'Find factual guidance for Nelyon accounts, content, LIVE, Marketplace, Business and app availability.', indexable: true, lang: 'en' },
  '/contact': { title: 'Contact Nelyon', description: 'Check verified Nelyon contact channels and find public guidance while launch details are being finalized.', indexable: true, lang: 'en' },
  '/privacy': { title: 'Nelyon Privacy Policy', description: 'Check the publication status of the canonical Nelyon Privacy Policy.', indexable: false, lang: 'en' },
  '/terms': { title: 'Nelyon Terms of Service', description: 'Check the publication status of the canonical Nelyon Terms of Service.', indexable: false, lang: 'en' },
});

for (const route of publicRoutes as string[]) {
  if (!publicSeo[route]) throw new Error(`Missing SEO metadata for public route: ${route}`);
}

export const indexableStaticRoutes = Object.freeze(
  (publicRoutes as string[]).filter((route) => publicSeo[route]?.indexable),
);

export const normalizePublicPath = (pathname: string): string => {
  const normalized = pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return normalized === '/index' ? '/' : normalized;
};

export const canonicalUrl = (pathname: string): string =>
  new URL(normalizePublicPath(pathname), `${PUBLIC_ORIGIN}/`).toString();

type SeoOverrides = {
  title?: string;
  description?: string;
  indexable?: boolean;
  canonical?: boolean;
  lang?: 'en' | 'es';
  image?: string;
  type?: 'website' | 'article';
};

export function resolveSeo(pathname: string, overrides: SeoOverrides = {}) {
  const path = normalizePublicPath(pathname);
  const registered = publicSeo[path];
  const title = overrides.title ?? registered?.title;
  const description = overrides.description ?? registered?.description;
  if (!title || !description) throw new Error(`SEO title and description required for ${path}`);
  const canonical = overrides.canonical === false ? null : canonicalUrl(path);
  return {
    path,
    title,
    documentTitle: path === '/' || title.includes('Nelyon') ? title : `${title} · Nelyon`,
    description,
    canonical,
    indexable: overrides.indexable ?? registered?.indexable ?? false,
    lang: overrides.lang ?? registered?.lang ?? 'en',
    image: overrides.image ? new URL(overrides.image, `${PUBLIC_ORIGIN}/`).toString() : null,
    type: overrides.type ?? 'website',
  } as const;
}

export function buildHomeStructuredData(canonical: string, logo: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${canonical}#organization`, name: 'Nelyon', url: canonical, logo },
      { '@type': 'WebSite', '@id': `${canonical}#website`, name: 'Nelyon', url: canonical, publisher: { '@id': `${canonical}#organization` } },
    ],
  };
}

export function buildArticleStructuredData(input: {
  headline: string;
  description: string;
  canonical: string;
  publishedAt: Date;
  updatedAt?: Date;
  image?: string | null;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    datePublished: input.publishedAt.toISOString(),
    ...(input.updatedAt ? { dateModified: input.updatedAt.toISOString() } : {}),
    mainEntityOfPage: input.canonical,
    publisher: { '@type': 'Organization', name: 'Nelyon' },
    ...(input.image ? { image: input.image } : {}),
  };
}
