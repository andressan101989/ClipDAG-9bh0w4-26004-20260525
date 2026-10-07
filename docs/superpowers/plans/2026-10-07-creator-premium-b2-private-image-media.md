# Creator Premium B2 Private Image Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Creator Premium image content to the canonical R2 media authority with a public teaser, a private original, entitlement-gated short-lived access, safe replacement cleanup, and no financial or video changes.

**Architecture:** Extend `public.media_assets` and `public.media_asset_links` in one forward-only migration, preserving every existing media contract. Authorize Premium uploads through narrow authenticated RPCs, bind image pairs atomically, and route original access through the B1 entitlement resolver before the existing R2 signer. Client coordination reuses `mediaService`, adds one focused Premium image service, and only renders public teaser URLs in the profile grid.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions (Deno/TypeScript), React Native/Expo TypeScript, Node test runner, disposable PostgreSQL integration tests.

**Spec:** Owner-approved `CREATOR-PREMIUM-B2 PRIVATE IMAGE MEDIA INTEGRATION` task prompt dated 2026-10-07; `docs/roadmap/NELYON_MASTER_ROADMAP.md` remains the canonical product roadmap.

## Global Constraints

- Base and `origin/main` must remain `2556767a4870697775beda6b24e5f4a38470ce30`.
- Exactly one generated B2 migration; expected production count after deployment is 332.
- Reuse `public.media_assets`, `public.media_asset_links`, canonical R2 buckets, B1 entitlement, age, account, block, and cleanup authorities.
- No second media table, bucket, provider, entitlement system, age system, cleanup system, wallet, or ledger.
- B2 is image-only: no Stream/video changes, finance movement, purchases, subscriptions, refunds, public publishing, protected viewer, watermark, screenshot work, Premium DM, or B3.
- Only `create-media-upload` and `get-media-url` may be changed or deployed.
- Premium originals never expose an asset id, object key, bucket name, public URL, or persisted signed URL to consumers.
- Signed Premium grants have a maximum 300-second TTL and `private, no-store` / `no-cache` response headers.
- All edits are TDD-first; zero B2-caused regressions, changed-file TypeScript diagnostics, ESLint errors/warnings, or diff-check errors.

## Review Focus

- Concurrent replacements for the same content must serialize and leave exactly one teaser/original pair without orphaning the winning pair.
- Generic `asset_id` access must fail closed for Premium originals even for their owner and regardless of any generic owner RLS path.
- A Premium-context field on a non-Premium upload must be rejected instead of ignored, while every legacy upload contract remains byte-compatible.
- Cleanup failures after partial client upload/bind failure must remain visible in safe diagnostics without leaking signed URLs or storage identifiers.
- Catalog and owner projections must not become ambiguous after return-shape recreation and must preserve pagination order and all existing B1 fields.

---

### Task 1: RED contract tests and generated migration shell

**Files:**
- Create: `tests/creatorPremiumB2PrivateImageMedia.test.mjs`
- Create: `tests/creatorPremiumB2EdgeMedia.test.mjs`
- Create: `tests/creatorPremiumB2ClientMedia.test.mjs`
- Create: `tests/creatorPremiumB2Local.integration.mjs`
- Create: `supabase/migrations/<generated>_creator_premium_b2_private_image_media.sql`

**Interfaces:**
- Consumes: B1 RPCs and canonical media functions already present on main.
- Produces: executable expectations for the migration, Edge request/response contract, client cleanup/grant contract, and disposable database proof.

- [ ] Write focused tests that name every B2 security and behavior break from the owner specification.
- [ ] Run the focused static/client tests before implementation and record expected failures caused only by absent B2 code.
- [ ] Generate the migration with `npx supabase migration new creator_premium_b2_private_image_media`; do not edit historical migrations.

### Task 2: Canonical database media authority

**Files:**
- Modify: generated B2 migration only.
- Test: `tests/creatorPremiumB2PrivateImageMedia.test.mjs`
- Test: `tests/creatorPremiumB2Local.integration.mjs`

**Interfaces:**
- Consumes: `media_assets`, `media_asset_links`, B1 Premium domain, B1 age/account/entitlement helpers, and canonical cleanup functions.
- Produces: `authorize_my_creator_premium_image_upload_v1`, `set_my_creator_premium_image_media_v1`, `get_my_creator_premium_image_media_v1`, safe extended catalog/owner projections, guarded Premium links, RLS exclusions, and valid-link protection.

- [ ] Add only the two exact Premium image purposes and `creator_premium_content` entity value with narrow constraints/indexes.
- [ ] Add fixed-search-path trigger/RPC authority, deterministic locking, idempotent pair replacement, and canonical orphan scheduling.
- [ ] Recreate B1 projection functions only as required to add safe teaser/image-state fields.
- [ ] Preserve all legacy entity values, link flows, and no-direct-write security.
- [ ] Apply the full chain plus B2 to the disposable database and pass all 34 database/security cases.

### Task 3: Entitlement-aware Edge upload and original grants

**Files:**
- Modify: `supabase/functions/_shared/mediaPurposes.ts`
- Modify: `supabase/functions/create-media-upload/index.ts`
- Modify: `supabase/functions/get-media-url/index.ts`
- Test: `tests/creatorPremiumB2EdgeMedia.test.mjs`

**Interfaces:**
- Consumes: Task 2 upload authorization RPC, B1 entitlement wrapper, canonical media links/assets, existing R2 signing helpers.
- Produces: Premium upload context enforcement and the `premium_content_id -> entitlement -> canonical original -> signed GET` path.

- [ ] Register exact MIME/size/default-visibility rules and reject invalid visibility/context combinations.
- [ ] Authorize Premium upload before creating an asset and reject Premium context on non-Premium requests.
- [ ] Resolve Premium originals internally by content id, fail closed on zero/multiple/wrong links, and deny generic asset-id bypass.
- [ ] Return only `contentId`, `url`, `expiresAt` with maximum 300-second TTL and no-store/no-cache headers; never log signed URLs.
- [ ] Pass focused Edge tests and unchanged legacy media regressions.

### Task 4: Client upload, cleanup, grant, and teaser projection

**Files:**
- Modify: `services/mediaService.ts`
- Modify: `services/creatorPremiumService.ts`
- Create: `services/creatorPremiumMediaService.ts`
- Modify: `app/creator/[id].tsx`
- Test: `tests/creatorPremiumB2ClientMedia.test.mjs`

**Interfaces:**
- Consumes: Task 2 pair/state RPCs, Task 3 Edge contracts, canonical `uploadMediaFromUri` and `deleteMediaAsset`.
- Produces: `uploadCreatorPremiumImagePair`, `fetchMyCreatorPremiumImageMedia`, `getCreatorPremiumOriginalImageGrant`, B2 image capability flag, and teaser-only profile rendering.

- [ ] Extend media input with the two purposes and `premiumContentId`, sending it only for Premium purposes.
- [ ] Upload teaser then original, clean partial uploads, clean both on binding failure, and surface cleanup failures safely.
- [ ] Validate grants as HTTPS with future expiry and never persist/prefetch/share/download them.
- [ ] Project `teaser_url` and image-state fields in typed B1 clients; render teaser only in the profile grid with truthful unavailable actions.
- [ ] Pass client/profile tests with finance/media-complete flags still false.

### Task 5: Whole-branch verification, controlled deployment, and production proof

**Files:**
- Verify all B2 files; no new product scope.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: pushed B2 branch, exactly one deployed migration, exactly two changed/deployed Edge functions, read-only production evidence, and the final report.

- [ ] Run B2 focused suites, disposable database, existing media/B1/finance regressions, full root suite, TypeScript, changed-scope ESLint, and `git diff --check`.
- [ ] Review the whole branch for security/privacy/concurrency regressions and fix Important/Critical findings by RED→GREEN only.
- [ ] Commit coherently (maximum three preferred), push the B2 branch normally, and prove local/remote parity while main remains unchanged.
- [ ] Recheck production, run linked dry-run showing exactly one B2 migration, then deploy only that migration.
- [ ] Deploy only changed `create-media-upload` and `get-media-url` sources and prove source/version/hash parity; confirm all unrelated Edge functions have no drift.
- [ ] Prove migration count 332, zero Premium production rows/fixtures, unchanged finance counts/balance, and classify B2-new security/performance advisor findings.
