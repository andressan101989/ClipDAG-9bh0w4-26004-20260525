import type { APIRoute } from 'astro';
import { getPublishedUpdates } from '../lib/updates';
import { canonicalUrl, indexableStaticRoutes } from '../lib/seo';

export const prerender = true;

const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
})[character] as string);

export const GET: APIRoute = async () => {
  const updates = await getPublishedUpdates();
  const urls = [
    ...indexableStaticRoutes.map((route) => ({ loc: canonicalUrl(route), lastmod: null as string | null })),
    ...updates.items.map((entry) => ({
      loc: canonicalUrl(`/whats-new/${entry.id}`),
      lastmod: (entry.data.updatedAt ?? entry.data.publishedAt).toISOString(),
    })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
