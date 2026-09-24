# ADS-V2-PLR-5 Web Deployment Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Business and Admin SPAs independently buildable and deployable as `nelyon-business-web` and `nelyon-admin-web` while leaving `nelyon-web`, Public source, DNS, Supabase, and every Ads V2 safety switch unchanged.

**Architecture:** Add one tested static-SPA Worker adapter shared by the existing Business and Admin apps. Package each existing Vite output behind an application-specific Worker and explicit Wrangler configuration. Pass local Wrangler HTTP smoke with real ASSETS bindings before creating unbound Workers. A Business route may be added only after a remotely hosted Preview Version passes every gate, that exact Version ID is promoted with the versions deployment mechanism, and ID equality is proven; because the current Cloudflare account has no `workers.dev` subdomain, the expected execution outcome is to leave the Business route absent and report the preview blocker.

**Tech Stack:** Node.js built-in test runner, Vite 7, React Router 7, Cloudflare Workers Static Assets, Wrangler 4.135.0, PowerShell, existing Supabase read-only audit tooling.

**Spec:** `docs/superpowers/specs/2026-09-24-ads-v2-plr-5-web-deployment-decoupling-design.md`

## Global Constraints

- Begin implementation only after the owner approves this plan.
- Use the existing worktree `C:\Users\andre\Nelyon-ads-v2-plr-5` on `codex/ads-v2-plr-5-web-deployment-decoupling`.
- Do not modify or deploy `apps/public-web` or `apps/web-frontdoor`.
- Do not add a Supabase migration.
- Do not create a Cloudflare `workers.dev` subdomain, preview custom domain, DNS record, certificate, Admin production route, or Public Worker.
- Never run `apps/web-frontdoor`'s `deploy` command.
- Do not add a deploy-all script.
- Keep `nelyon.app/business` on `nelyon-web`; only `nelyon.app/business/*` is eligible for a later cutover.
- Do not enable Campaign activation, automatic lifecycle transitions, finance, global delivery, geo/language matching, or placements.
- Do not create production Ads fixtures or move money.
- Use TDD: add the failing test, run it and observe the expected failure, implement the smallest change, then rerun the focused test.
- Commit only after all local and production safety checks pass. Push without force.

## Review Focus

- The exact `/business` versus `/business/*` boundary.
- Document-only SPA fallback and missing-asset 404 behavior.
- The absence of Public or cross-application build/deploy calls.
- The unbound default for both new Workers.
- Local Wrangler end-to-end proof with the real built ASSETS bindings.
- Exact Preview Version promotion without rebuild or re-upload.
- The fail-closed preview gate and the absence of a Business production route while preview hosting is unavailable.
- The route-only rollback contract.
- Secret scanning and unchanged Supabase/Ads/finance state.

---

### Task 1: Build the shared static SPA Worker adapter with tests

**Files:**

- Create: `shared/web-deployment/staticSpaWorker.mjs`
- Create: `shared/web-deployment/staticSpaWorker.test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Create tests for this public interface:

```js
import { createStaticSpaWorker } from './staticSpaWorker.mjs';

const worker = createStaticSpaWorker({ mountPath: '/business' });
const response = await worker.fetch(request, { ASSETS: assetBinding });
```

Cover all of these cases:

1. only `GET` and `HEAD` are accepted; other methods return `405` with `Allow: GET, HEAD`;
2. `/business` is outside the `/business/` mount and returns `404`;
3. `/business/` maps to `/index.html`;
4. `/business/assets/app-abc123.js` maps to `/assets/app-abc123.js`;
5. after an exact 404, `Sec-Fetch-Dest: document` permits `/business/ads` to fall back to `/index.html`;
6. when `Sec-Fetch-Dest` is present with `script`, `style`, `image`, `font`, `empty`, or any value other than `document`, `Accept: text/html` does not override it and the exact 404 is returned;
7. when `Sec-Fetch-Dest` is absent, `Accept: text/html` permits fallback for `/business/ads`;
8. when `Sec-Fetch-Dest` is absent and `Accept` does not include `text/html`, the exact 404 is returned;
9. asset-like paths never fall back under any header combination, including `Sec-Fetch-Dest: document` and no-destination `Accept: text/html`;
10. asset-like coverage includes `/assets/` and `.js`, `.mjs`, `.cjs`, `.css`, `.map`, `.json`, images, fonts, WASM, XML/text/manifests, documents, audio, and video extensions, case-insensitively;
11. `/businessx` and `/` return `404` for a `/business` worker;
12. root mount accepts `/`, `/advertising`, and exact assets;
13. query strings survive rewritten asset requests;
14. responses receive `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: browsing-topics=()`, and HSTS;
15. hashed `/assets/` responses receive `public, max-age=31536000, immutable`;
16. HTML receives `public, max-age=0, must-revalidate, no-transform`;
17. HEAD requests return the asset status and headers without a response body.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
node --test shared/web-deployment/staticSpaWorker.test.mjs
```

Expected: FAIL because `shared/web-deployment/staticSpaWorker.mjs` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Export only:

```js
export function createStaticSpaWorker({ mountPath = '' })
```

Implementation contract:

- normalize the root mount to `''` and reject mount paths ending in `/`;
- for a non-root mount, require `pathname.startsWith(`${mountPath}/`)`;
- strip the mount before calling `env.ASSETS.fetch`;
- preserve method, headers, body semantics, and query string when rebuilding the request;
- fetch the exact asset first;
- classify a pathname as asset-like when it is beneath `/assets/` or ends, case-insensitively, in `.js`, `.mjs`, `.cjs`, `.css`, `.map`, `.json`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`, `.wasm`, `.xml`, `.txt`, `.webmanifest`, `.pdf`, `.mp4`, `.webm`, `.mp3`, `.m4a`, or `.ogg`;
- never fetch `/index.html` for an asset-like pathname;
- when `Sec-Fetch-Dest` is present, allow fallback only when its normalized value is `document`;
- when `Sec-Fetch-Dest` is absent, allow `Accept: text/html` as a fallback heuristic only for a non-asset-like pathname;
- fetch `/index.html` only after an exact `404` and only when those rules authorize fallback;
- apply the shared headers to every response;
- use immutable caching only when the rewritten path matches a content-hashed file under `/assets/`;
- use HTML revalidation for responses whose content type includes `text/html`.

- [ ] **Step 4: Rerun the focused test**

Run:

```powershell
node --test shared/web-deployment/staticSpaWorker.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Confirm the existing frontdoor remains untouched**

Run:

```powershell
git diff -- apps/web-frontdoor apps/public-web
```

Expected: no output.

### Task 2: Package the existing Business SPA as an isolated Worker

**Files:**

- Create: `apps/business-web/deployment/worker.mjs`
- Create: `apps/business-web/deployment/prepare.mjs`
- Create: `apps/business-web/deployment/wrangler.unbound.jsonc`
- Create: `apps/business-web/deployment/wrangler.preview.jsonc`
- Create: `apps/business-web/deployment/wrangler.route.jsonc`
- Create: `apps/business-web/deployment/tests/worker.test.mjs`
- Create: `apps/business-web/deployment/tests/prepare.test.mjs`
- Create: `apps/business-web/deployment/tests/config.test.mjs`
- Modify: `apps/business-web/package.json`

- [ ] **Step 1: Write failing Business Worker boundary tests**

Import the Business Worker and prove:

- `/business` returns `404`;
- `/business/` returns the Business shell;
- `/business/ads`, `/business/ads/campaigns`, and `/business/ads/campaigns/example-id` use SPA fallback for document navigation;
- `/businessx`, `/`, and `/advertising` return `404`;
- an existing `/business/assets/app-abc123.js` is served exactly;
- a missing asset remains `404` for `Sec-Fetch-Dest: document`, for another present destination, and for absent destination plus `Accept: text/html`;
- a non-asset deep link with a present non-document `Sec-Fetch-Dest` remains `404` even when `Accept` includes `text/html`;
- a non-asset deep link with no `Sec-Fetch-Dest` and `Accept: text/html` falls back to the shell;
- POST returns `405`;
- the Worker uses the shared adapter rather than duplicating fallback logic.

- [ ] **Step 2: Run the Business Worker test and verify failure**

Run:

```powershell
node --test apps/business-web/deployment/tests/worker.test.mjs
```

Expected: FAIL because the Business deployment entrypoint does not exist.

- [ ] **Step 3: Add the Business entrypoint**

Use this complete entrypoint shape:

```js
import { createStaticSpaWorker } from '../../../shared/web-deployment/staticSpaWorker.mjs';

export default createStaticSpaWorker({ mountPath: '/business' });
```

- [ ] **Step 4: Rerun the Business Worker test**

Run:

```powershell
node --test apps/business-web/deployment/tests/worker.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing packaging tests**

Test `prepareBusinessDeployment({ distDir, iconSource })` with a temporary directory. Assert that it:

- rejects a missing `dist/index.html`;
- rejects generated script or stylesheet URLs outside `/business/`;
- copies `assets/branding/nelyon/v1/nelyon-app-icon.png` to `dist/favicon.png`;
- changes the generated favicon reference from `/favicon.png` to `/business/favicon.png`;
- does not modify files outside the supplied `distDir`;
- is idempotent on a second invocation.

- [ ] **Step 6: Run the packaging test and verify failure**

Run:

```powershell
node --test apps/business-web/deployment/tests/prepare.test.mjs
```

Expected: FAIL because `prepare.mjs` does not exist.

- [ ] **Step 7: Implement the generated-artifact preparation step**

Export:

```js
export async function prepareBusinessDeployment({
  distDir = new URL('../dist/', import.meta.url),
  iconSource = new URL('../../../assets/branding/nelyon/v1/nelyon-app-icon.png', import.meta.url),
} = {})
```

When executed directly, call the function with defaults. Use resolved absolute paths and verify that every write remains inside the resolved Business `dist` directory. Do not modify `apps/business-web/index.html` or Public files.

- [ ] **Step 8: Rerun the packaging test**

Run:

```powershell
node --test apps/business-web/deployment/tests/prepare.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Write failing Wrangler configuration tests**

Parse the three JSONC files by stripping comments with the same small test helper. Assert:

- every config name is `nelyon-business-web`;
- every config uses `main: "./worker.mjs"` and assets directory `../dist`;
- every config binds `ASSETS`, sets `run_worker_first: true`, `html_handling: "none"`, and `not_found_handling: "none"`;
- unbound: `workers_dev: false`, `preview_urls: false`, no `routes`;
- preview: `workers_dev: true`, `preview_urls: true`, no `routes`;
- route-only: `workers_dev: false`, `preview_urls: false`, and the only route is `{ "pattern": "nelyon.app/business/*", "zone_name": "nelyon.app" }`;
- no config contains the forbidden broad pattern `nelyon.app/business*` without the slash before `*`;
- no config contains a Custom Domain.
- no package script passes the route-only config to `wrangler deploy` or `wrangler versions upload`.

- [ ] **Step 10: Run the configuration test and verify failure**

Run:

```powershell
node --test apps/business-web/deployment/tests/config.test.mjs
```

Expected: FAIL because the Wrangler files do not exist.

- [ ] **Step 11: Add the three Business Wrangler configurations**

Use `compatibility_date: "2026-09-24"`, account ID `24a176456cf57435119db8caf3af61dd`, and the exact properties tested above. Keep the production route in `wrangler.route.jsonc` only. The route file exists for a later separate `wrangler triggers deploy` control-plane operation; it must never upload or deploy Worker code.

- [ ] **Step 12: Add explicit Business package scripts**

Add these scripts without changing the existing `dev`, `test`, `lint`, or `build` entries:

```json
{
  "build:deployment": "npm run build && node deployment/prepare.mjs",
  "test:deployment": "node --test deployment/tests/*.test.mjs",
  "deploy:isolated": "npm run build:deployment && npx --yes wrangler@4.135.0 deploy --config deployment/wrangler.unbound.jsonc",
  "upload:preview": "npm run build:deployment && npx --yes wrangler@4.135.0 versions upload --config deployment/wrangler.preview.jsonc",
  "promote:version": "npx --yes wrangler@4.135.0 versions deploy --name nelyon-business-web --percentage 100 --yes --config deployment/wrangler.preview.jsonc --version-id",
  "apply:production-route": "npx --yes wrangler@4.135.0 triggers deploy --config deployment/wrangler.route.jsonc"
}
```

`promote:version` receives the already tested Version ID after `--`; it performs no build or upload. `apply:production-route` is a distinct later command and may run only after the active deployment is verified to reference the same Version ID.

- [ ] **Step 13: Run Business deployment tests and build**

Run:

```powershell
npm --prefix apps/business-web run test:deployment
npm --prefix apps/business-web run build:deployment
```

Expected: both PASS; generated `dist/index.html` references `/business/assets/` and `/business/favicon.png`.

### Task 3: Package the existing Admin SPA as an isolated, route-unbound Worker

**Files:**

- Create: `apps/admin-web/deployment/worker.mjs`
- Create: `apps/admin-web/deployment/wrangler.unbound.jsonc`
- Create: `apps/admin-web/deployment/wrangler.preview.jsonc`
- Create: `apps/admin-web/deployment/tests/worker.test.mjs`
- Create: `apps/admin-web/deployment/tests/config.test.mjs`
- Modify: `apps/admin-web/package.json`

- [ ] **Step 1: Write failing Admin Worker tests**

Prove that the root-mounted Worker:

- serves `/` from `/index.html`;
- falls `/advertising`, `/advertising/health`, and another Admin deep link back to `/index.html` for document navigation;
- serves exact assets;
- preserves missing-asset `404` under every `Sec-Fetch-Dest`/`Accept` combination;
- gives a present non-document `Sec-Fetch-Dest` precedence over `Accept: text/html`;
- permits the no-`Sec-Fetch-Dest` `Accept: text/html` heuristic only for non-asset-like paths;
- rejects non-GET/HEAD methods;
- applies the shared security and cache headers.

- [ ] **Step 2: Run the Admin Worker test and verify failure**

Run:

```powershell
node --test apps/admin-web/deployment/tests/worker.test.mjs
```

Expected: FAIL because the Admin deployment entrypoint does not exist.

- [ ] **Step 3: Add the Admin entrypoint**

Use:

```js
import { createStaticSpaWorker } from '../../../shared/web-deployment/staticSpaWorker.mjs';

export default createStaticSpaWorker({ mountPath: '' });
```

- [ ] **Step 4: Rerun the Admin Worker test**

Expected command and result:

```powershell
node --test apps/admin-web/deployment/tests/worker.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write and run failing Admin config tests**

Assert:

- Worker name `nelyon-admin-web`;
- `main: "./worker.mjs"`;
- assets directory `../dist` and binding `ASSETS`;
- unbound config disables workers.dev and preview URLs and has no route;
- preview config enables workers.dev and preview URLs and has no route;
- neither config mentions `nelyon.app`, `admin.nelyon.app`, `/admin`, or a Custom Domain;
- there is no `wrangler.production.jsonc` for Admin.

Run:

```powershell
node --test apps/admin-web/deployment/tests/config.test.mjs
```

Expected: FAIL until both configs exist, then PASS.

- [ ] **Step 6: Add Admin package scripts**

Add:

```json
{
  "build:deployment": "npm run build",
  "test:deployment": "node --test deployment/tests/*.test.mjs",
  "deploy:isolated": "npm run build:deployment && npx --yes wrangler@4.135.0 deploy --config deployment/wrangler.unbound.jsonc",
  "upload:preview": "npm run build:deployment && npx --yes wrangler@4.135.0 versions upload --config deployment/wrangler.preview.jsonc"
}
```

Do not add an Admin production deploy script.

- [ ] **Step 7: Run Admin deployment tests and build**

Run:

```powershell
npm --prefix apps/admin-web run test:deployment
npm --prefix apps/admin-web run build:deployment
```

Expected: PASS.

### Task 4: Add repository-level isolation guards and the deployment runbook

**Files:**

- Create: `tests/adsV2Plr5WebDeploymentDecoupling.test.mjs`
- Create: `docs/runbooks/ads-v2-plr-5-web-deployment.md`
- Modify: `package.json`

- [ ] **Step 1: Write the failing repository boundary test**

The test must parse root and application package files plus all new Wrangler configs and assert:

- Business scripts never reference `public-web`, `admin-web`, `web-frontdoor`, or `nelyon-web`;
- Admin scripts never reference `public-web`, `business-web`, `web-frontdoor`, or `nelyon-web`;
- root PLR-5 scripts call exactly one application script;
- no `deploy:all` or equivalent combined script is added;
- `apps/web-frontdoor/package.json`, `apps/web-frontdoor/wrangler.jsonc`, and `apps/web-frontdoor/src/worker.mjs` match their base-branch blobs;
- `apps/public-web` has no diff from the base SHA;
- the only production route added in repository configuration is `nelyon.app/business/*` in the Business route-only config;
- no production script uses `wrangler deploy`; promotion uses `wrangler versions deploy` and route application uses a separate `wrangler triggers deploy` operation;
- Admin has no production route;
- no Supabase migration name contains `plr_5` and migration count in Git remains 288;
- generated Business/Admin bundles contain no denylisted server-secret name/reference and no actual secret value;
- executable source and Wrangler configs contain no unauthorized server-secret reference or lookup;
- denylist literals are allowed only in the PLR-5 specification, plan, runbook, and this repository boundary test, and each allowed occurrence is documentary/test data rather than executable configuration;
- any denylist literal in another tracked path fails;
- actual secret values are forbidden in every tracked file and bundle, including allowlisted documents/tests.

- [ ] **Step 2: Run the repository boundary test and verify failure**

Run:

```powershell
node --test tests/adsV2Plr5WebDeploymentDecoupling.test.mjs
```

Expected: FAIL until the root scripts and runbook are present.

- [ ] **Step 3: Add explicit root scripts**

Add:

```json
{
  "business:web:build:deployment": "npm --prefix apps/business-web run build:deployment",
  "business:web:test:deployment": "npm --prefix apps/business-web run test:deployment",
  "business:web:deploy:isolated": "npm --prefix apps/business-web run deploy:isolated",
  "business:web:upload:preview": "npm --prefix apps/business-web run upload:preview",
  "business:web:promote:version": "npm --prefix apps/business-web run promote:version --",
  "business:web:apply:production-route": "npm --prefix apps/business-web run apply:production-route",
  "admin:web:build:deployment": "npm --prefix apps/admin-web run build:deployment",
  "admin:web:test:deployment": "npm --prefix apps/admin-web run test:deployment",
  "admin:web:deploy:isolated": "npm --prefix apps/admin-web run deploy:isolated",
  "admin:web:upload:preview": "npm --prefix apps/admin-web run upload:preview",
  "test:web:deployment:local": "node scripts/smoke-local-web-deployments.mjs",
  "test:ads-v2-plr-5": "node --test tests/adsV2Plr5WebDeploymentDecoupling.test.mjs"
}
```

- [ ] **Step 4: Write the operational runbook**

Document exact commands and gates for:

1. current Worker/version/route/custom-domain capture;
2. Public HTTP parity capture;
3. independent local build and test;
4. tiered secret scan with an exact-path allowlist for documentary denylist literals and a global prohibition on actual secret values;
5. local Wrangler HTTP smoke with each real built `ASSETS` binding;
6. unbound Business/Admin deployment;
7. verification that `nelyon-web` is unchanged;
8. workers.dev preview capability check;
9. mandatory stop when preview hosting is absent;
10. conditional one-time preview upload and capture of its exact Version ID;
11. remote smoke against that exact Version URL;
12. promotion of the same tested Version ID with `wrangler versions deploy` and an equality check;
13. separate route control-plane operation only after version equality is proven;
14. immediate rollback by deleting only the exact `nelyon.app/business/*` route owned by `nelyon-business-web`;
15. Supabase and Ads safety postchecks.

The runbook must label `apps/web-frontdoor`'s deploy command as a legacy coupled fallback that is forbidden for the Ads release workflow.

- [ ] **Step 5: Rerun the boundary test**

Run:

```powershell
npm run test:ads-v2-plr-5
```

Expected: PASS.

### Task 5: Run complete local build, app, routing, and secret verification

**Files:**

- Verify only; modify the smallest scoped file if a concrete failure exposes a defect.

- [ ] **Step 1: Run all new deployment tests**

```powershell
node --test shared/web-deployment/staticSpaWorker.test.mjs
npm run business:web:test:deployment
npm run admin:web:test:deployment
npm run test:web:deployment:local
npm run test:ads-v2-plr-5
```

Expected: all PASS.

- [ ] **Step 2: Run both application suites and builds independently**

```powershell
npm run business:web:test
npm run business:web:lint
npm run business:web:build:deployment
npm run admin:web:test
npm run admin:web:lint
npm run admin:web:build:deployment
```

Expected: all PASS. Confirm command output never invokes `apps/public-web`, `apps/web-frontdoor`, or the other application.

- [ ] **Step 3: Verify generated Business paths**

Run:

```powershell
rg -n 'src="/business/|href="/business/' apps/business-web/dist/index.html
rg -n 'src="/assets/|href="/assets/|href="/favicon\.png"' apps/business-web/dist/index.html
```

Expected: the first command finds Business-prefixed assets; the second finds no unprefixed deployment-critical asset or favicon.

- [ ] **Step 4: Run the tiered secret scan with an explicit allowlist**

The repository boundary test must scan these exact denylist names/references:

```text
SUPABASE_SERVICE_ROLE_KEY
service_role
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_TOKEN
DATABASE_URL
postgresql://
postgres://
R2_SECRET
STREAM_SECRET
```

Apply four distinct rules:

1. **Generated bundles:** `apps/business-web/dist` and `apps/admin-web/dist` must contain zero denylist names/references and zero actual secret values.
2. **Executable source and Wrangler configs:** every `.js`, `.mjs`, `.ts`, `.tsx`, `.json`, and `.jsonc` file in the PLR-5 implementation must contain zero unauthorized server-secret reference or lookup. The one exception is the repository boundary test file containing the denylist array as test data.
3. **Docs/tests allowlist:** denylist literals are permitted only in these exact tracked paths:
   - `docs/superpowers/specs/2026-09-24-ads-v2-plr-5-web-deployment-decoupling-design.md`;
   - `docs/superpowers/plans/2026-09-24-ads-v2-plr-5-web-deployment-decoupling.md`;
   - `docs/runbooks/ads-v2-plr-5-web-deployment.md`;
   - `tests/adsV2Plr5WebDeploymentDecoupling.test.mjs`.
4. **Actual values:** collect non-empty values for known sensitive environment variables in memory, never print them, and fail if any exact value occurs in any tracked file or generated bundle. Allowlisted documents/tests do not permit actual values.

Expected: all four tiers PASS. Any denylist literal outside the exact allowlist or any actual value anywhere fails verification.

- [ ] **Step 5: Run existing frontdoor regression tests without building or deploying it**

```powershell
npm --prefix apps/web-frontdoor test
```

Expected: PASS.

- [ ] **Step 6: Run Ads and Marketplace regression suites**

```powershell
node --test tests/adsV2BAdvertiserIdentityFoundation.test.mjs tests/adsV2CGeneralCampaignAuthority.test.mjs tests/adsV2DCreativeModerationFoundation.test.mjs tests/adsV2DReviewActorAuthFk.test.mjs tests/adsV2EAudienceTargetingPrivacy.test.mjs tests/adsV2FGenericDeliveryPlacementRegistry.test.mjs tests/adsV2FC1OwnerPreviewPrivacy.test.mjs tests/adsV2GEventsConversionsAttribution.test.mjs tests/adsV2HFinancialGeneralization.test.mjs tests/adsV2IBusinessManagerReadProjection.test.mjs tests/adsV2IBusinessWebSafety.test.mjs tests/adsV2IC1AdvertiserMediaAccess.test.mjs tests/adsV2JAdminAnalyticsProductionClosure.test.mjs tests/adsV2Plr1AgeEligibilityReadiness.test.mjs tests/adsV2Plr2FinanceRetryHardening.test.mjs tests/adsV2Plr3CampaignLifecycle.test.mjs tests/adsV2Plr4TargetingLaunchScope.test.mjs
npm run prove:marketplace-ads
npm run prove:marketplace-ads-finance
```

Expected: all PASS.

- [ ] **Step 7: Review the complete implementation diff**

```powershell
git status --short
git diff --stat
git diff --check
git diff -- apps/public-web apps/web-frontdoor supabase
```

Expected: `git diff --check` passes; the final command has no output.

### Task 6: Pass local Wrangler end-to-end smoke with real ASSETS bindings

**Files:**

- Create: `scripts/smoke-local-web-deployments.mjs`
- Modify: `package.json` only for the `test:web:deployment:local` script already specified in Task 4.

- [ ] **Step 1: Implement a deterministic local smoke harness**

The script must:

1. require existing Business and Admin `dist` outputs and fail with a build instruction if either is missing;
2. discover one real hashed asset URL from each built `index.html`;
3. spawn Business Wrangler locally on `127.0.0.1:8788` with:

```powershell
npx --yes wrangler@4.135.0 dev --local --ip 127.0.0.1 --port 8788 --config apps/business-web/deployment/wrangler.unbound.jsonc
```

4. spawn Admin Wrangler locally on `127.0.0.1:8789` with:

```powershell
npx --yes wrangler@4.135.0 dev --local --ip 127.0.0.1 --port 8789 --config apps/admin-web/deployment/wrangler.unbound.jsonc
```

5. wait for each server to become ready with a bounded timeout;
6. run the complete HTTP matrices below using real network requests and `Sec-Fetch-Dest: document` for SPA documents;
7. compare each real asset response body byte-for-byte with its file in `dist`;
8. terminate both Wrangler child processes in `finally`, including failure paths;
9. return nonzero on any mismatch.

- [ ] **Step 2: Run the Business HTTP matrix**

Required results:

| Request | Expected |
| --- | --- |
| `/business` | 404 |
| `/business/` | 200, Business shell |
| `/business/ads` | 200, Business shell |
| `/business/ads/campaigns` | 200, Business shell |
| discovered real `/business/assets/...` URL | 200, exact built asset bytes |
| `/business/assets/does-not-exist.js` | 404, never HTML |
| `/businessx` | 404 |
| `/` | 404 |

For `/business/ads`, add two fallback-precedence assertions:

- `Sec-Fetch-Dest: script` plus `Accept: text/html` -> 404;
- absent `Sec-Fetch-Dest` plus `Accept: text/html` -> shell.

- [ ] **Step 3: Run the Admin HTTP matrix**

Required results:

| Request | Expected |
| --- | --- |
| `/` | 200, Admin shell |
| `/advertising` | 200, Admin shell |
| `/advertising/health` | 200, Admin shell |
| discovered real `/assets/...` URL | 200, exact built asset bytes |
| `/assets/does-not-exist.js` | 404, never HTML |

For `/advertising`, add the same present-non-document precedence and absent-destination HTML heuristic assertions.

- [ ] **Step 4: Execute the local gate before any remote Worker command**

Run:

```powershell
npm run business:web:build:deployment
npm run admin:web:build:deployment
npm run test:web:deployment:local
```

Expected: PASS for both HTTP matrices. No `wrangler deploy`, `wrangler versions upload`, route operation, or other remote mutation may run before this command passes.

- [ ] **Step 5: Record local evidence**

Record the two local base URLs, discovered asset paths, status matrix, shell markers, exact-asset byte equality, missing-asset content types, and process exit cleanup in the execution artifact. Do not commit generated `dist` files or runtime logs.

### Task 7: Recapture production baselines before any Cloudflare mutation

**Files:**

- Create at execution time: `.artifacts/ads-v2-plr-5/pre-deploy-cloudflare.json`
- Create at execution time: `.artifacts/ads-v2-plr-5/pre-deploy-public-http.json`
- Create at execution time: `.artifacts/ads-v2-plr-5/pre-deploy-supabase.json`
- Do not commit `.artifacts/`.

- [ ] **Step 1: Capture Cloudflare identity and Public Worker version**

Run:

```powershell
npx --yes wrangler@4.135.0 whoami
npx --yes wrangler@4.135.0 deployments list --name nelyon-web
npx --yes wrangler@4.135.0 versions list --name nelyon-web
```

Expected current Public deployment/version pair:

```text
deployment: 16f1d8a1-dc66-46a3-b538-b570f00e19b4
version:    692aab3c-c58a-47e7-9887-54ce2abf134c
```

If it differs, record the actual pair and establish that it is unrelated legitimate activity before continuing. Do not deploy Public.

- [ ] **Step 2: Capture Worker, route, Custom Domain, and preview-host inventories**

Use the authenticated Cloudflare account API already verified in precheck to record:

- all Worker script names;
- all routes for zone `b9d23a8ec0f5b57e2db8f0165e068188`;
- Custom Domains for `nelyon.app` and `www.nelyon.app`;
- account `workers.dev` subdomain state.

Expected before deployment: only `nelyon-web`, zero Workers Routes, apex/www Custom Domains owned by `nelyon-web`, and no workers.dev subdomain.

- [ ] **Step 3: Capture Public parity and current Business behavior**

Record final URL, status, location, content type, and SHA-256 body hash for:

```text
https://nelyon.app/
https://nelyon.app/business
https://nelyon.app/privacy
https://nelyon.app/terms
https://nelyon.app/robots.txt
https://nelyon.app/sitemap.xml
https://nelyon.app/site.webmanifest
https://nelyon.app/manifest.webmanifest
https://www.nelyon.app/
https://nelyon.app/business/
https://nelyon.app/business/ads
https://nelyon.app/business/ads/campaigns
https://nelyon.app/businessx
```

Expected notable current behavior: `/business` is Public, `/business/` redirects to `/business`, `/business/ads` serves the Business SPA for document navigation, `/businessx` is not a Business route, and www redirects to apex.

- [ ] **Step 4: Capture Supabase and finance safety state read-only**

Using the existing Supabase audit mechanism, record:

- migrations 288, latest `20260924024512_ads_v2_plr_4_targeting_launch_scope`;
- Campaigns 0 and Events 0;
- activation and automatic transitions false;
- funding, spend, settlement false;
- global delivery, geo matching, language matching false;
- enabled placements 0;
- financial transactions 921, ledger accounts 131, ledger entries 1896;
- all V2 and Marketplace finance/event reconciliation counters zero.

Any unexpected migration is a STOP condition.

### Task 8: Create the two new Workers as unbound deployment units

**Files:**

- No repository edits expected.

- [ ] **Step 1: Reconfirm no existing conflicting Worker names**

Verify that `nelyon-business-web` and `nelyon-admin-web` are absent. If either exists and is not demonstrably the same intended deployment, STOP.

- [ ] **Step 2: Deploy Business with the unbound configuration**

Run only after owner implementation approval:

```powershell
npm run business:web:deploy:isolated
```

Expected: `nelyon-business-web` is created or updated with no route, no Custom Domain, workers.dev disabled, and preview URLs disabled.

- [ ] **Step 3: Verify Business deployment isolation**

Run:

```powershell
npx --yes wrangler@4.135.0 deployments list --name nelyon-business-web
npx --yes wrangler@4.135.0 deployments list --name nelyon-web
```

Expected: Business has a new deployment; Public remains on the captured pre-deploy version.

- [ ] **Step 4: Deploy Admin with the unbound configuration**

Run:

```powershell
npm run admin:web:deploy:isolated
```

Expected: `nelyon-admin-web` is created or updated with no route, no Custom Domain, workers.dev disabled, and preview URLs disabled.

- [ ] **Step 5: Verify Admin deployment isolation**

Run deployment lists for all three Workers. Expected: Admin changed only during the Admin deploy; Business and Public versions remain unchanged.

- [ ] **Step 6: Record Cloudflare mutations**

The expected change log is:

```text
Workers created: nelyon-business-web, nelyon-admin-web
Workers updated: none beyond their initial versions
Routes added: none
Routes removed: none
Custom Domains changed: none
DNS changed: no
Public Worker deployed: no
```

### Task 9: Enforce the remote preview gate and defer route cutover when unavailable

**Files:**

- No repository edits expected.

- [ ] **Step 1: Query workers.dev availability again**

Expected current result: Cloudflare API error 10007, no workers.dev subdomain.

- [ ] **Step 2: Apply the fail-closed decision**

When the subdomain remains unavailable:

- do not run either `upload:preview` command;
- do not create a custom preview domain;
- do not add DNS or a wildcard certificate;
- do not run `business:web:promote:version`;
- do not run `business:web:apply:production-route`;
- do not add `nelyon.app/business/*`;
- do not invent an Admin route.

Record:

```text
READY FOR BUSINESS ROUTE CUTOVER — BLOCKED BY WORKERS.DEV PREVIEW UNAVAILABLE
ADMIN_DEPLOYMENT_DECOUPLED — ROUTE UNBOUND
```

- [ ] **Step 3: Upload the candidate once and capture the exact Preview Version ID**

This step is conditional on a separately authorized future execution with a working preview host. Build once, then run exactly one upload:

```powershell
npm run business:web:build:deployment
npm run business:web:upload:preview
```

Capture the Version ID emitted by `wrangler versions upload` as `$previewVersionId`. Confirm it with:

```powershell
npx --yes wrangler@4.135.0 versions view $previewVersionId --name nelyon-business-web --json
```

Record the Version URL, Version ID, build artifact hash, and asset manifest hash. Do not rebuild or upload another candidate after this point.

- [ ] **Step 4: Smoke the exact Version URL**

Run the full remote Business matrix against the Version URL associated with `$previewVersionId`. Record every response and the tested Version ID. A branch alias or workers.dev latest URL is insufficient unless Cloudflare proves it resolves to that exact Version ID.

Expected: all preview smoke checks PASS against `$previewVersionId`. Otherwise STOP; do not promote or add a route.

- [ ] **Step 5: Promote the exact tested Version ID**

Without rebuilding or uploading, run:

```powershell
npm run business:web:promote:version -- $previewVersionId
```

This invokes Cloudflare's supported `wrangler versions deploy --version-id ... --percentage 100 --yes` mechanism. It must not invoke `wrangler deploy`.

Read the active deployment:

```powershell
$deployment = npx --yes wrangler@4.135.0 deployments list --name nelyon-business-web --json | ConvertFrom-Json
```

Extract the active 100% Version ID as `$promotedVersionId` and require:

```powershell
if ($promotedVersionId -ne $previewVersionId) { throw 'preview_promoted_version_mismatch' }
```

Record both IDs. If the versions deployment mechanism, static assets, or account configuration cannot guarantee exact-ID promotion, STOP before route cutover.

- [ ] **Step 6: Apply the Business route as a separate control-plane operation**

Only after Version ID equality is proven, run:

```powershell
npm run business:web:apply:production-route
```

This invokes only `wrangler triggers deploy` with `wrangler.route.jsonc`. Verify no new Worker Version was created and the active Version remains `$previewVersionId`.

- [ ] **Step 7: Smoke and roll back the route independently**

Immediately verify the exact route matrix and Public parity. On any failure, delete only the route whose pattern is `nelyon.app/business/*` and script is `nelyon-business-web`; verify fallback to `nelyon-web`. Route rollback must not rebuild, redeploy, or change the promoted Worker Version. These conditional steps remain documentation only while preview hosting is unavailable.

### Task 10: Perform postchecks, final verification, commit, and push

**Files:**

- Create at execution time: `.artifacts/ads-v2-plr-5/post-deploy-cloudflare.json`
- Create at execution time: `.artifacts/ads-v2-plr-5/post-deploy-public-http.json`
- Create at execution time: `.artifacts/ads-v2-plr-5/post-deploy-supabase.json`
- Do not commit `.artifacts/`.

- [ ] **Step 1: Verify Public freeze after isolated deployments**

Recapture `nelyon-web` deployments/versions and the full Public endpoint parity set. Expected: deployment/version identical and Public body hashes/statuses/redirects unchanged.

- [ ] **Step 2: Verify Cloudflare route state**

Expected for the current preview-blocked execution:

- `nelyon-business-web` exists and is unbound;
- `nelyon-admin-web` exists and is unbound;
- Workers Routes remain empty;
- apex and www Custom Domains remain on `nelyon-web`;
- DNS is unchanged.

- [ ] **Step 3: Verify Supabase and Ads safety state again**

Expected exact state:

- migration count 288 and same latest migration;
- Campaigns 0, Events 0;
- activation false, automatic transitions false;
- finance all false;
- global delivery false;
- enabled placements 0;
- financial counters unchanged unless unrelated legitimate activity is evidenced;
- all reconciliation failure counters zero;
- money moved by PLR-5: 0.

- [ ] **Step 4: Run final verification suite**

```powershell
node --test shared/web-deployment/staticSpaWorker.test.mjs
npm run business:web:test:deployment
npm run admin:web:test:deployment
npm run test:ads-v2-plr-5
npm run business:web:test
npm run business:web:lint
npm run admin:web:test
npm run admin:web:lint
npm --prefix apps/web-frontdoor test
git diff --check
```

Expected: all PASS.

- [ ] **Step 5: Review every changed file and confirm scope**

```powershell
git status --short
git diff --name-only
git diff
```

Expected changed files are limited to the shared deployment adapter/tests, Business/Admin deployment files and package scripts, the local Wrangler smoke script, root package scripts, PLR-5 static test, the approved spec, the implementation plan, and the runbook. No Public, frontdoor, Supabase, or application UI file is changed.

- [ ] **Step 6: Commit the reviewed implementation**

```powershell
git add docs/superpowers/specs/2026-09-24-ads-v2-plr-5-web-deployment-decoupling-design.md docs/superpowers/plans/2026-09-24-ads-v2-plr-5-web-deployment-decoupling.md docs/runbooks/ads-v2-plr-5-web-deployment.md shared/web-deployment apps/business-web/deployment apps/admin-web/deployment scripts/smoke-local-web-deployments.mjs apps/business-web/package.json apps/admin-web/package.json package.json tests/adsV2Plr5WebDeploymentDecoupling.test.mjs
git commit -m "feat(web): decouple business and admin deployments"
```

- [ ] **Step 7: Push without force and verify remote equality**

```powershell
git push -u origin codex/ads-v2-plr-5-web-deployment-decoupling
git fetch origin
git rev-parse HEAD
git rev-parse origin/codex/ads-v2-plr-5-web-deployment-decoupling
git status --short
```

Expected: local SHA equals remote SHA and the worktree is clean.

- [ ] **Step 8: Produce the exact required PLR-5 final report**

Use the report structure from the owner specification. Record actual Worker deployment/version IDs and every Cloudflare-side action. If a future cutover occurs, record Preview Version ID, promoted Version ID, their equality result, and confirmation that route application created no Worker Version. With the verified current preview constraint, report no production cutover, no route, Public unchanged, Admin route unbound, Supabase unchanged, Ads locked, and zero money movement.

## Recommended Execution Method

Use **Native execution** in one later implementation session with `superpowers:executing-plans`. The work shares one deployment contract and becomes sequential at Cloudflare and production gates; one implementer reduces the risk of conflicting package/config edits and accidental control-plane mutation. Keep this plan paused until the owner approves implementation.
