const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'browsing-topics=()',
  'Strict-Transport-Security': 'max-age=31536000',
});

const ASSET_EXTENSION = /\.(?:js|mjs|cjs|css|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|wasm|xml|txt|webmanifest|pdf|mp4|webm|mp3|m4a|ogg)$/i;
const HASHED_ASSET = /^\/assets\/[^/]*[-.][A-Za-z0-9_-]{6,}\.[^/]+$/;

function isAssetLike(pathname) {
  return pathname === '/assets' || pathname.startsWith('/assets/') || ASSET_EXTENSION.test(pathname);
}

function allowsSpaFallback(request, pathname) {
  if (isAssetLike(pathname)) return false;

  const destination = request.headers.get('sec-fetch-dest');
  if (destination !== null) return destination.trim().toLowerCase() === 'document';

  return request.headers.get('accept')?.toLowerCase().includes('text/html') === true;
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function withHeaders(response, pathname, method) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

  if (HASHED_ASSET.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (headers.get('content-type')?.toLowerCase().includes('text/html')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  }

  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function plainResponse(status, method, headers = {}) {
  return withHeaders(new Response(null, { status, headers }), '/', method);
}

export function createStaticSpaWorker({ mountPath = '' } = {}) {
  if (typeof mountPath !== 'string'
    || (mountPath !== '' && (!mountPath.startsWith('/') || mountPath.endsWith('/')))) {
    throw new TypeError('mountPath must be empty or an absolute path without a trailing slash');
  }

  return {
    async fetch(request, env) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return plainResponse(405, request.method, { Allow: 'GET, HEAD' });
      }

      const url = new URL(request.url);
      if (mountPath && !url.pathname.startsWith(`${mountPath}/`)) {
        return plainResponse(404, request.method);
      }

      const strippedPath = mountPath ? url.pathname.slice(mountPath.length) : url.pathname;
      const exactPath = strippedPath === '/' ? '/index.html' : strippedPath;
      const exact = await env.ASSETS.fetch(assetRequest(request, exactPath));

      if (exact.status !== 404 || !allowsSpaFallback(request, strippedPath)) {
        return withHeaders(exact, exactPath, request.method);
      }

      const shell = await env.ASSETS.fetch(assetRequest(request, '/index.html'));
      return withHeaders(shell, '/index.html', request.method);
    },
  };
}
