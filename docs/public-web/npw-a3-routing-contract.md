# NPW-A3 same-origin routing contract

This is a code contract for a future deployment, not a deployed front door. The public Astro build is static; the private Business build is a separate Vite SPA. Both must ultimately be served from `https://nelyon.app` under the path rules below. No Cloudflare, DNS, Supabase or Stripe deployment is performed in NPW-A3.

## Precedence

1. `/business` and `/business/` belong to Public Astro. Canonical URL: `/business`.
2. `/business/*` belongs to the Business SPA. Serve `apps/business-web/dist/index.html` for approved private routes and its assets from `/business/assets/*`; React Router uses the `/business` basename. Do not serve Business on `/business` itself.
3. Public routes in `apps/public-web/src/lib/routeContract.mjs` belong to Astro, including `/` and `/ads`. Unknown public paths receive Public 404, never the Business SPA.
4. `/store/:slug` is reserved for a future public storefront. It is not a Business redirect.
5. `/whats-new/:slug` is reserved for future static product-update detail pages. No fake slug is published by this foundation.

The shared base-path value lives in `shared/web-routing/paths.json`. The public route classifier and Business Vite/React configuration consume it. The Stripe Edge source uses the explicit `/business/finance` callback contract but remains **undeployed** until a separately approved deployment.

## Legacy redirects

Exact legacy redirects live in `legacyStaticRedirects` in the route contract. Astro emits static redirect shells for these paths; the shells preserve query and fragment in a browser. The deployment front door should replace these with HTTP redirects that preserve the query string.

Dynamic redirects require constrained front-door rules, because a static build cannot generate unknown IDs:

- `/products/:productId` → `/business/products/:productId`
- `/orders/:orderId` → `/business/orders/:orderId`
- `/ads/:campaignId` → `/business/ads/:campaignId` **only when `campaignId` is a UUID**. Never redirect `/ads` or arbitrary `/ads/*` public paths.

The tested `classifyRoute()` and `legacyRedirectLocation()` functions specify expected routing and query behavior. Before production activation, the selected host must implement and smoke-test these rules, including direct refresh of deep Business routes. No catch-all public-to-Business rewrite is permitted.

## Authentication handoff

Business retains its existing Supabase client and `BusinessAuthProvider`. A signed-out private route redirects to `/business/login?returnTo=<encoded private path>`. The validator accepts only local private Business paths and rejects external schemes, protocol-relative URLs, encoded path tricks, backslashes and login loops. Invitation links are `/business/invitations?invitation=<id>`; server-side invitation RPCs still decide email, expiry and acceptance.

## Stripe callback source

`BUSINESS_WEB_PUBLIC_URL` remains an origin-like URL. The Edge source now constructs success and cancelled redirects at `/business/finance` using `URL`, so an existing value ending in `/business` does not create `/business/business/finance`. This source change is not deployed by NPW-A3; any externally configured Stripe callback therefore remains at its existing deployed path until a separate Edge deployment is approved.

## Local preview

Run `npm --prefix apps/public-web run dev` and open `http://127.0.0.1:8082/`, `/business`, and `/ads`.

Run `npm --prefix apps/business-web run dev` and open `http://127.0.0.1:8081/business/login` or `/business/home`. Business requires the existing public Vite Supabase URL/publishable key environment configuration to render; it must never use a service-role key. These are two local dev ports, **not** a same-origin production preview. The future hosting layer must supply the single-origin route dispatch above.
