# ADS-V2-PLR-5 Web Deployment Runbook

## HARD BOUNDARIES

- `nelyon-web` is read-only and must never be deployed by this workflow.
- `apps/public-web` and `apps/web-frontdoor` are read-only.
- `FORBIDDEN: apps/web-frontdoor deploy`.
- No Supabase migration, DNS change, workers.dev creation, Admin production route, or substitute preview host.
- Business production routing is limited to `nelyon.app/business/*`; `/business` remains Public.

## BASELINE CAPTURE

Before remote mutation, record Worker inventory, Workers Routes, Custom Domains, the workers.dev subdomain state, and:

```powershell
npx --yes wrangler@4.135.0 whoami
npx --yes wrangler@4.135.0 deployments list --name nelyon-web --json
npx --yes wrangler@4.135.0 versions list --name nelyon-web --json
```

Record status, final URL, redirect, content type, and SHA-256 body hash for `/`, `/business`, `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, `/manifest.webmanifest`, www, `/business/`, `/business/ads`, `/business/ads/campaigns`, and `/businessx`.

## SECRET SCAN

Generated Business/Admin bundles may contain no server-secret name/reference or actual secret value. Executable source and Wrangler configs may contain no unauthorized server-secret lookup.

Documentary denylist literals are allowed only in the approved PLR-5 spec, plan, this runbook, and `tests/adsV2Plr5WebDeploymentDecoupling.test.mjs`. The denylist includes `SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_TOKEN`, `DATABASE_URL`, PostgreSQL connection schemes, `R2_SECRET`, and `STREAM_SECRET`. Actual secret values remain forbidden everywhere and are scanned in memory without printing them.

## LOCAL WRANGLER GATE

Build and prepare both apps:

```powershell
npm run business:web:build:deployment
npm run admin:web:build:deployment
```

Run:

```powershell
npm run test:web:deployment:local
```

The harness starts Business on `127.0.0.1:8788` and Admin on `127.0.0.1:8789` with their unbound Wrangler configs and real built ASSETS bindings.

Business must prove `/business` 404, `/business/` shell, Ads deep links shell, a real asset exact, a missing asset 404, `/businessx` 404, and `/` 404. Admin must prove root and Advertising deep links shell, a real asset exact, and a missing asset 404. Present non-document `Sec-Fetch-Dest` overrides `Accept`; missing asset-like paths never fall back.

No remote Worker command may run before this gate passes.

## UNBOUND DEPLOYMENT

Reconfirm that Worker names do not conflict, then run separately:

```powershell
npm run business:web:deploy:isolated
npm run admin:web:deploy:isolated
```

Verify both Workers have no route, Custom Domain, workers.dev target, or preview URL. Confirm each deploy changes only its intended Worker.

## PUBLIC VERSION GUARD

After each remote operation, recapture `nelyon-web` deployment/version IDs and require equality with the baseline. Any PLR-5-caused Public version change is a STOP condition.

## PREVIEW GATE

Query workers.dev availability again. If unavailable:

- do not upload a preview;
- do not create a preview substitute;
- do not promote a Business version;
- do not apply a Business route;
- report `READY FOR BUSINESS ROUTE CUTOVER — BLOCKED BY WORKERS.DEV PREVIEW UNAVAILABLE`;
- report `ADMIN_DEPLOYMENT_DECOUPLED — ROUTE UNBOUND`.

## EXACT VERSION PROMOTION

This section is conditional on a separately authorized execution with a real workers.dev Version URL.

Build once and upload once:

```powershell
npm run business:web:build:deployment
npm run business:web:upload:preview
```

Capture the emitted Version ID as `$previewVersionId`, record the artifact/manifest hashes, and smoke that exact Version URL. Do not rebuild or upload again.

Promote only that tested ID:

```powershell
npm run business:web:promote:version -- $previewVersionId
```

Read the active deployment as `$promotedVersionId` and require strict equality. If equality or exact static-asset promotion cannot be proven, STOP before route cutover. `wrangler deploy` is forbidden for production promotion.

Apply the route separately only after equality:

```powershell
npm run business:web:apply:production-route
```

Verify route application created no Worker Version and the active ID remains `$previewVersionId`.

## ROUTE ROLLBACK

On any post-cutover failure, find the Workers Route whose pattern is exactly `nelyon.app/business/*` and whose script is exactly `nelyon-business-web`. Delete only that route. Verify it is absent and traffic falls back to `nelyon-web`.

Rollback must not deploy Public, change DNS, remove a Custom Domain, or delete the Business Worker.

## PUBLIC PARITY

After every permitted production control-plane change, repeat the baseline HTTP matrix. `/business` must remain the Public informational page, `/business/*` must resolve as authorized, `/businessx` must not be captured, and www behavior must remain unchanged. Any mismatch triggers immediate route rollback.

## SUPABASE / ADS POSTCHECK

Read-only verification must show migration count 288 and latest `20260924024512_ads_v2_plr_4_targeting_launch_scope`; Campaigns 0; Events 0; activation and automatic transitions false; funding, spend, and settlement false; global delivery, geo matching, and language matching false; enabled placements 0; no age mutation; and all Ads/Marketplace reconciliations zero.

Expected global finance baseline is 921 financial transactions, 131 ledger accounts, and 1896 ledger entries, subject only to separately evidenced legitimate activity. PLR-5 money movement is zero.
