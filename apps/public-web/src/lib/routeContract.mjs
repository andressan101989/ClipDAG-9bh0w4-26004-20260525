import paths from '../../../../shared/web-routing/paths.json' with { type: 'json' };

// Routing authority for the future same-origin front door. The static Astro
// build does not itself deploy or configure a hosting rewrite layer.
const businessBasePath = paths.businessBasePath;
export const publicRoutes = Object.freeze([
  '/', '/features', '/business', '/ads', '/marketplace', '/creators',
  '/live', '/whats-new', '/download', '/support', '/contact', '/privacy', '/terms',
]);

export const legacyStaticRedirects = Object.freeze({
  '/login': '/business/login',
  '/invitations': '/business/invitations',
  '/store': '/business/store',
  '/media': '/business/media',
  '/products': '/business/products',
  '/products/shipping': '/business/products/shipping',
  '/orders': '/business/orders',
  '/finance': '/business/finance',
  '/finance/payouts': '/business/finance/payouts',
  '/analytics': '/business/analytics',
  '/team': '/business/team',
  '/settings': '/business/settings',
  '/ads/new': '/business/ads/new',
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function classifyRoute(pathname) {
  if (pathname === `${businessBasePath}/`) return { surface: 'redirect', destination: businessBasePath };
  if (publicRoutes.includes(pathname)) return { surface: 'public' };
  if (pathname.startsWith(`${businessBasePath}/`)) return { surface: 'business' };
  if (pathname.startsWith('/store/') && pathname.length > '/store/'.length) return { surface: 'reserved-public' };
  if (/^\/whats-new\/[^/]+$/.test(pathname)) return { surface: 'reserved-public' };
  const exactDestination = legacyStaticRedirects[pathname];
  if (exactDestination) return { surface: 'redirect', destination: exactDestination };
  const product = /^\/products\/([^/]+)$/.exec(pathname);
  if (product) return { surface: 'redirect', destination: `/business/products/${product[1]}` };
  const order = /^\/orders\/([^/]+)$/.exec(pathname);
  if (order) return { surface: 'redirect', destination: `/business/orders/${order[1]}` };
  const campaign = /^\/ads\/([^/]+)$/.exec(pathname);
  if (campaign && uuid.test(campaign[1])) return { surface: 'redirect', destination: `/business/ads/${campaign[1]}` };
  return { surface: 'not-found' };
}

export function legacyRedirectLocation(pathAndQuery) {
  if (typeof pathAndQuery !== 'string' || !pathAndQuery.startsWith('/') || pathAndQuery.startsWith('//')) return null;
  const url = new URL(pathAndQuery, 'https://nelyon.app');
  const route = classifyRoute(url.pathname);
  return route.surface === 'redirect' ? `${route.destination}${url.search}${url.hash}` : null;
}
