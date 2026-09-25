import { createStaticSpaWorker } from '../../../shared/web-deployment/staticSpaWorker.mjs';

const spa = createStaticSpaWorker({ mountPath: '/admin' });

function adminHeaders(response, method) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/admin') {
      url.pathname = '/admin/';
      return adminHeaders(new Response(null, { status: 308, headers: { Location: url.toString() } }), request.method);
    }
    return adminHeaders(await spa.fetch(request, env), request.method);
  },
};
