import { legacyRedirectLocation } from '../../public-web/src/lib/routeContract.mjs';

const APEX_HOST = 'nelyon.app';
const WWW_HOST = 'www.nelyon.app';
const BUSINESS_PREFIX = '/business/';
const BUSINESS_SHELL = '/business/index.html';

const commonHeaders = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'browsing-topics=()',
  'Strict-Transport-Security': 'max-age=31536000',
});

function withHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(commonHeaders)) headers.set(name, value);

  if (pathname.startsWith('/_astro/') || pathname.startsWith('/business/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (headers.get('content-type')?.includes('text/html')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function redirect(location) {
  return withHeaders(new Response(null, {
    status: 308,
    headers: { Location: location },
  }), new URL(location).pathname);
}

function isDocumentNavigation(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return request.headers.get('sec-fetch-dest') === 'document'
    || request.headers.get('accept')?.includes('text/html');
}

async function serveBusiness(request, env, url) {
  const exact = await env.ASSETS.fetch(request);
  if (exact.status !== 404 || !isDocumentNavigation(request)) {
    return withHeaders(exact, url.pathname);
  }

  const shellUrl = new URL(BUSINESS_SHELL, url);
  const shellRequest = new Request(shellUrl, request);
  const shell = await env.ASSETS.fetch(shellRequest);
  return withHeaders(shell, BUSINESS_SHELL);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === WWW_HOST) {
      url.hostname = APEX_HOST;
      url.protocol = 'https:';
      return redirect(url.toString());
    }

    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
      return redirect(url.toString());
    }

    const legacyDestination = legacyRedirectLocation(`${url.pathname}${url.search}`);
    if (legacyDestination) {
      return redirect(new URL(legacyDestination, `https://${APEX_HOST}`).toString());
    }

    if (url.pathname.startsWith(BUSINESS_PREFIX)) {
      return serveBusiness(request, env, url);
    }

    return withHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
};
