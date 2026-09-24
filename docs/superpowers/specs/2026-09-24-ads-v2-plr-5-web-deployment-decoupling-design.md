# ADS-V2-PLR-5 Web Deployment Decoupling Design

## Status

Proposed for owner review. This document specifies deployment architecture only. It does not authorize implementation, Worker creation, route changes, DNS changes, or deployment.

## Objective

Create independent Cloudflare Worker deployment units for the existing Business and Admin React applications while preserving the existing Public Web Worker and all Ads V2 pre-launch locks.

The desired units are:

- Public: existing `nelyon-web`, unchanged and not deployed by PLR-5.
- Business: new `nelyon-business-web`, packaging only `apps/business-web`.
- Admin: new `nelyon-admin-web`, packaging only `apps/admin-web`.

The applications remain the existing applications. PLR-5 adds deployment adapters and release controls; it does not fork or duplicate application source.

## Verified Starting State

### Repository

- Required base: `origin/codex/ads-v2-plr-4-targeting-launch-scope`.
- Required base SHA: `52168ef28651e9440ecf97eed7bd6bb79899b43a`.
- `apps/web-frontdoor` builds Public and Business together, assembles Business under `dist/business`, and deploys `nelyon-web`.
- `apps/business-web` already emits URLs under `/business/` through Vite `base` and uses React Router basename `/business`.
- `apps/admin-web` uses root-relative Vite and React Router paths.
- No CI workflow calls the coupled frontdoor deploy command.
- `apps/web-frontdoor` remains the rollback fallback and is outside implementation scope except for read-only regression assertions.

### Cloudflare

- Account ID: `24a176456cf57435119db8caf3af61dd`.
- Zone: `nelyon.app`.
- Existing Worker: `nelyon-web` only.
- Existing Custom Domains:
  - `nelyon.app` -> `nelyon-web`
  - `www.nelyon.app` -> `nelyon-web`
- Existing Workers Routes: none.
- Current Public deployment ID: `16f1d8a1-dc66-46a3-b538-b570f00e19b4`.
- Current Public version ID: `692aab3c-c58a-47e7-9887-54ce2abf134c`.
- `nelyon-business-web` does not exist.
- `nelyon-admin-web` does not exist.
- The account has no `workers.dev` subdomain. Version URLs and branch previews therefore have no available host.
- No canonical Admin production route exists.

### Supabase and Ads

- Migration count: 288.
- Latest migration: `20260924024512_ads_v2_plr_4_targeting_launch_scope`.
- Campaigns: 0.
- Events: 0.
- Campaign activation: false.
- Automatic transitions: false.
- Funding, spend, and settlement: false.
- Global Ads V2 delivery: false.
- Enabled Ads V2 placements: 0.
- PLR-5 creates no migration and changes none of these values.

## Routing Contract

The production boundary is exact:

| Request | Owner after an authorized cutover |
| --- | --- |
| `https://nelyon.app/` | `nelyon-web` |
| `https://nelyon.app/business` | `nelyon-web` public informational page |
| `https://nelyon.app/business/` | `nelyon-business-web` |
| `https://nelyon.app/business/ads` | `nelyon-business-web` |
| `https://nelyon.app/business/ads/campaigns` | `nelyon-business-web` |
| `https://nelyon.app/businessx` | `nelyon-web` |
| `https://www.nelyon.app/*` | existing `nelyon-web` redirect behavior |

The only authorized Business route pattern is `nelyon.app/business/*`. The pattern `nelyon.app/business*` is forbidden.

Cloudflare Workers Routes execute before a Worker Custom Domain on the same hostname. Cloudflare selects the most specific matching Workers Route. Therefore the Business route can run in front of the existing `nelyon.app` Custom Domain without changing that Custom Domain, DNS, the apex route, or the Public Worker.

The Business Worker must also enforce the boundary in code. It returns 404 for any pathname that does not begin with `/business/`, even on an isolated host.

## Deployment Units

### Shared Static SPA Adapter

A small shared module under `shared/web-deployment/` provides the behavior common to the Business and Admin Workers:

- accepts only GET and HEAD;
- resolves an exact static asset first;
- falls back to `index.html` only when the request satisfies the exact SPA fallback contract below;
- never returns the SPA shell for an asset-like pathname, including missing JS, CSS, images, fonts, source maps, JSON, manifests, media, or files beneath `/assets/`;
- applies `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS;
- applies immutable caching only to hashed assets under `/assets/`;
- applies revalidation caching to HTML;
- does not introduce CSP because the existing applications require Supabase and existing media origins.

The adapter takes a mount path. Business uses `/business`; Admin uses the root mount.

### Exact SPA fallback contract

The fallback decision is deterministic:

1. Resolve the exact asset first. Any non-404 response is returned directly.
2. If the pathname is asset-like, return the exact 404 and never fetch `index.html`.
3. When `Sec-Fetch-Dest` is present, fallback is allowed only when its normalized value is `document`.
4. When `Sec-Fetch-Dest` is absent, `Accept: text/html` may authorize fallback only for a non-asset-like pathname.
5. When neither condition authorizes fallback, return the exact 404.

Asset-like means a pathname beneath `/assets/` or a pathname ending in a static/resource extension such as `.js`, `.mjs`, `.cjs`, `.css`, `.map`, `.json`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`, `.wasm`, `.xml`, `.txt`, `.webmanifest`, `.pdf`, `.mp4`, `.webm`, `.mp3`, `.m4a`, or `.ogg`. The check is case-insensitive.

Consequences:

- `Sec-Fetch-Dest: document` plus `/business/ads` may fall back;
- `Sec-Fetch-Dest: script` plus `Accept: text/html` may not fall back;
- no `Sec-Fetch-Dest` plus `Accept: text/html` and `/business/ads` may fall back;
- any missing `/business/assets/app.js` or `/business/logo.svg` returns 404 under every header combination.

### Business Worker

The Business entrypoint imports the shared adapter with mount path `/business`.

Incoming Business URLs are mapped to the existing Vite output:

- `/business/` -> `/index.html`
- `/business/assets/<hash>.<ext>` -> `/assets/<hash>.<ext>`
- `/business/ads` -> exact `/ads` lookup, then `/index.html` only when the exact SPA fallback contract authorizes it
- missing `/business/assets/*` -> 404
- paths outside `/business/` -> 404

The Vite base remains `/business/`, and the React Router basename remains `/business`.

A packaging step modifies only generated `dist` output:

- verifies generated script and stylesheet URLs begin with `/business/`;
- copies the canonical Nelyon icon from `assets/branding/nelyon/v1/nelyon-app-icon.png` into the generated artifact;
- rewrites the generated favicon URL from `/favicon.png` to `/business/favicon.png`;
- never modifies Public assets or committed Business UI source.

### Admin Worker

The Admin entrypoint imports the shared adapter with the root mount.

It packages only `apps/admin-web/dist`, preserves root BrowserRouter behavior, and exposes no production route in PLR-5. Its existing `AdminAuthProvider` and server-side capability checks remain unchanged.

## Wrangler Configuration

Each application receives explicit, pinned Wrangler configurations.

### Unbound configurations

The unbound configurations use:

- `workers_dev: false`
- `preview_urls: false`
- no `routes`
- no Custom Domain
- an assets binding to the existing application `dist`
- `run_worker_first: true`

They create or update the isolated Worker without making it publicly reachable.

### Preview configurations

Preview configurations use `workers_dev: true` and `preview_urls: true` with no production route. They are valid only when the account owns a `workers.dev` subdomain.

The current account does not own one. Execution must record this as a preview gate failure and must not create a subdomain, custom preview domain, wildcard DNS record, or certificate.

### Business route configuration

The Business route-only configuration names `nelyon-business-web` and contains exactly one route:

```json
{
  "pattern": "nelyon.app/business/*",
  "zone_name": "nelyon.app"
}
```

This configuration is used only by a separate route control-plane command after the exact tested Worker Version has been promoted. It must never be passed to `wrangler deploy` or any command that uploads a new Worker Version. It is not executed until all cutover gates pass.

Admin has no production route configuration in PLR-5.

## Explicit Commands

Root and application package scripts expose separate commands for:

- Business deployment build
- Business deployment tests
- Business isolated deployment
- Business preview upload
- Business exact-version promotion
- Business production route application
- Admin deployment build
- Admin deployment tests
- Admin isolated deployment
- Admin preview upload

No default `deploy`, `deploy:web`, or `deploy:all` script invokes multiple applications. The existing coupled `apps/web-frontdoor` command remains available as a legacy fallback and is not called by any PLR-5 script.

## Release Sequence

### Phase 1: Baseline capture

Capture and retain:

- Public version and deployment IDs;
- Worker inventory;
- Workers Routes;
- Custom Domains;
- public endpoint status, redirect, content type, and body hash;
- current Business endpoint behavior;
- Supabase migration and Ads safety state;
- financial counters and reconciliations.

### Phase 2: Local proof

Build and test Business and Admin independently. Before any remote Worker mutation, start each Worker locally with Wrangler using its real `ASSETS` binding and built `dist` directory.

The Business HTTP matrix must prove:

- `/business` -> 404;
- `/business/` -> Business shell;
- `/business/ads` -> Business shell;
- `/business/ads/campaigns` -> Business shell;
- a real built asset -> exact asset;
- a missing asset -> 404;
- `/businessx` -> 404;
- `/` -> 404.

The Admin HTTP matrix must prove:

- `/` -> Admin shell;
- `/advertising` -> Admin shell;
- `/advertising/health` -> Admin shell;
- a real built asset -> exact asset;
- a missing asset -> 404.

The local smoke also verifies response headers, the exact SPA fallback contract, authentication shell boot, and deep links. No unbound or preview Worker may be uploaded until both local Wrangler matrices pass.

### Phase 3: Isolated deployment

Deploy `nelyon-business-web` and `nelyon-admin-web` with their unbound configurations. Confirm that only the intended Worker version changes and that `nelyon-web` remains on version `692aab3c-c58a-47e7-9887-54ce2abf134c` unless unrelated legitimate activity is separately evidenced.

### Phase 4: Preview gate

Query the account `workers.dev` subdomain and preview capability. The current expected result is unavailable.

When unavailable:

- do not run the preview upload command;
- do not add the Business production route;
- report `READY FOR BUSINESS ROUTE CUTOVER — BLOCKED BY WORKERS.DEV PREVIEW UNAVAILABLE`;
- report `ADMIN_DEPLOYMENT_DECOUPLED — ROUTE UNBOUND`.

When a preview host exists in a later authorized execution:

1. build once;
2. upload a preview candidate with `wrangler versions upload`;
3. capture its exact Worker Version ID;
4. run the remote smoke matrix against that exact Version URL;
5. promote that same Version ID with `wrangler versions deploy --version-id ...`;
6. verify that the promoted deployment references the identical Version ID;
7. apply `nelyon.app/business/*` as a separate route control-plane operation.

There is no build, upload, or `wrangler deploy` between preview PASS and production promotion. If exact-version promotion or ID equality cannot be proven, execution stops before route cutover.

### Phase 5: Conditional Business cutover

Only after the remote preview passes and the exact tested Version ID is promoted at 100% may the separate route operation add `nelyon.app/business/*` to `nelyon-business-web`. Do not remove or modify either `nelyon-web` Custom Domain.

Immediately rerun the public parity and Business smoke matrices. If any required check fails, remove the new route immediately.

## Rollback

Rollback is a control-plane route deletion:

1. Find the Workers Route whose pattern is exactly `nelyon.app/business/*` and whose script is exactly `nelyon-business-web`.
2. Delete only that route.
3. Verify the route is absent.
4. Verify Business requests fall back to `nelyon-web`.
5. Verify the Public Worker version and DNS remain unchanged.

Rollback must not deploy `nelyon-web`, change DNS, remove the apex Custom Domain, or delete the Business Worker.

## Security

- No Cloudflare token, OAuth token, refresh token, DB password, service-role key, R2 secret, Stream secret, or Admin credential is committed.
- Build scripts accept only `VITE_SUPABASE_URL` and an existing public publishable/anon key.
- Generated Business and Admin bundles may contain no server-secret name, server-secret reference, database connection string, or actual secret value.
- Executable source and Wrangler configurations may contain no unauthorized server-secret reference or lookup. They may use only the existing public Supabase URL and publishable/anon configuration.
- Denylist literals are allowed only in these explicit documentation/test locations: the PLR-5 specification, the PLR-5 implementation plan, the PLR-5 runbook, and the PLR-5 repository boundary test. Each occurrence must be part of a denylist assertion or explanatory security text, never a lookup or configuration value.
- Actual secret values are forbidden in every tracked file and every generated bundle, including allowed documentation/test locations. Execution scans non-empty known sensitive environment values in memory without printing them.
- The allowlist is exact-path based and tested. A denylist literal in any other tracked file fails verification.
- Business remains same-origin at `https://nelyon.app/business/*` after a future cutover.
- Admin preview or unbound deployment does not bypass `AdminAuthProvider` or Supabase capability enforcement.
- No Public headers are changed.

## Tests

### Unit and configuration

- shared adapter exact-asset behavior;
- exact `Sec-Fetch-Dest` precedence and no-header `Accept: text/html` heuristic;
- unconditional 404 for missing asset-like paths;
- missing asset 404;
- Business path guard;
- `/business` rejected by the Business Worker;
- `/business/` and deep links accepted;
- `/businessx` rejected;
- Admin root and deep links accepted;
- cache and security headers;
- Worker names, asset directories, and route sets;
- only the Business route-only config contains `nelyon.app/business/*`;
- no Admin production route;
- explicit package scripts do not invoke Public or each other.

### Build and bundle

- Business independent build;
- Admin independent build;
- Business `/business/` asset base;
- Business packaging rewrite and canonical icon;
- no Public/Admin build during Business build;
- no Public/Business build during Admin build;
- tiered secret scan with an exact-path documentary allowlist and a global actual-value prohibition.

### Local Wrangler end-to-end

- Business Worker started by Wrangler with the real built `ASSETS` binding;
- Business `/business`, shell, deep-link, exact-asset, missing-asset, `/businessx`, and root matrix;
- Admin Worker started by Wrangler with the real built `ASSETS` binding;
- Admin root, deep-link, exact-asset, and missing-asset matrix;
- both matrices pass before any remote upload.

### Cloudflare and HTTP

- Worker inventory before and after;
- version isolation;
- route inventory;
- Public version guard;
- Public parity endpoints;
- Business preview smoke when a preview host exists;
- preview Worker Version ID captured;
- exact same Version ID promoted with the versions deployment mechanism;
- promoted Version ID equals tested Preview Version ID;
- production route applied separately after promotion;
- Business production smoke only after all gates pass;
- Admin preview login boundary when a preview host exists;
- rollback route removal.

### Regression

- PLR-1 through PLR-4 harnesses;
- B through J static server regression;
- Business and Admin application suites;
- Marketplace regression;
- finance reconciliations;
- `git diff --check`.

## Acceptance Criteria

Implementation is ready for audit when:

1. Business and Admin are independently buildable and deployable.
2. Both isolated Workers exist without unauthorized routes.
3. `nelyon-web` is not deployed or modified.
4. Public source and assets are unchanged.
5. No Supabase migration exists for PLR-5.
6. No Ads, finance, lifecycle, placement, or age state changes.
7. Admin remains route-unbound unless a canonical route is separately authorized.
8. The Business production route remains absent while remote preview is unavailable.
9. Local tests, both local Wrangler HTTP matrices, application tests, regression harnesses, financial reconciliation, and tiered secret scans pass.
10. Any future cutover promotes the exact remotely tested Version ID before applying the route, with Preview and promoted IDs recorded and equal.
11. The final report records every Cloudflare-side action and the exact reason for any deferred cutover.
