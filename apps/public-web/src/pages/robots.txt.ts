import type { APIRoute } from 'astro';
import { PUBLIC_ORIGIN } from '../lib/seo';

export const prerender = true;

const body = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /business/',
  'Disallow: /login$',
  'Disallow: /invitations$',
  'Disallow: /store$',
  'Disallow: /media$',
  'Disallow: /products$',
  'Disallow: /orders$',
  'Disallow: /finance$',
  'Disallow: /analytics$',
  'Disallow: /team$',
  'Disallow: /settings$',
  `Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`,
  '',
].join('\n');

export const GET: APIRoute = () => new Response(body, {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});
