import type { APIRoute } from 'astro';
import appIcon from '../../../../assets/branding/nelyon/v1/nelyon-app-icon.png';
import { PUBLIC_ORIGIN } from '../lib/seo';

export const prerender = true;

export const GET: APIRoute = () => new Response(JSON.stringify({
  name: 'Nelyon',
  short_name: 'Nelyon',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0d1528',
  theme_color: '#0c1f4f',
  icons: [{ src: new URL(appIcon.src, `${PUBLIC_ORIGIN}/`).toString(), type: 'image/png', sizes: '1024x1024' }],
}), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } });
