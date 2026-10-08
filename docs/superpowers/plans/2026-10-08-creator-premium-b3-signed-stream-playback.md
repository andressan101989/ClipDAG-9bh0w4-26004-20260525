# Creator Premium B3 Signed Stream Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical private Creator Premium video upload, binding, reconciliation, and 300-second entitlement-gated Cloudflare Stream playback without exposing provider identifiers or changing public Feed/Business behavior.

**Architecture:** Extend the existing `video_assets` and `video_asset_links` domain with one Premium purpose and entity type. Keep public Stream reconciliation untouched, route Premium assets through a focused helper that proves `requireSignedURLs=true` and signs RS256 tokens locally, and orchestrate creator upload/bind plus consumer grants through narrow Edge/RPC/client contracts.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions on Deno, Cloudflare Stream direct uploads and signing keys, Web Crypto RS256, TypeScript/React Native services, Node `node:test`, disposable PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-08-creator-premium-b3-signed-stream-playback-design.md`

## Global Constraints

- Base and unchanged `origin/main`: `e28399c38ab70b764668a2debe422fe7a0332122`.
- Work only on `codex/creator-premium-b3-signed-stream-playback`; never merge, rebase, amend, squash, or force-push.
- Generate exactly one migration with `npx supabase migration new creator_premium_b3_signed_stream_playback`; never invent its timestamp.
- Reuse only `public.video_assets`, `public.video_asset_links`, Cloudflare Stream, the B1 entitlement resolver, B2 `creator_premium_teaser_image`, and canonical deletion functions.
- Preserve Feed/Business public semantics, limits of 200,000,000 bytes and 60 seconds, and MIME types `video/mp4`, `video/quicktime`, `video/webm`.
- Premium assets are `creator_premium_video`, `cloudflare_stream`, private, `requireSignedURLs=true`, and never persist HLS, DASH, or provider thumbnail URLs.
- Local RS256 tokens have `kid`, `sub`, `nbf` with at most 30 seconds skew, and `exp` at most 300 seconds; no download/share claims and no provider API call per playback.
- Never expose Cloudflare UID, consumer video asset ID, raw token, key ID, private JWK, PEM, API token, or permanent playback URL.
- Do not reuse the consumed temporary Cloudflare token. Use only existing Supabase secret names `STREAM_SIGNING_KEY_ID` and `STREAM_SIGNING_KEY_JWK_B64` at runtime.
- First bind and same-pair replay only; different-pair replacement fails with `creator_premium_video_media_already_bound`.
- Do not change finance, Stream deletion, image Edge functions, public publishing, the viewer, the roadmap, or B4.
- Do not mutate the two pre-existing stale `business_library` uploads.

## Review Focus

- Duplicate or ambiguous Premium links must fail closed before signing; Task 2 tests zero, one, and multiple links.
- Provider `requireSignedURLs` values that are missing, false, or non-boolean must never produce ready Premium state; Tasks 1 and 2 test each form.
- Clock skew and delayed responses must not create grants beyond 300 seconds or accept expired client grants; Tasks 2 and 3 pin both boundaries.
- Late webhook events must not downgrade a ready Premium asset or introduce permanent URLs; Task 2 tests ready-state idempotency and URL nulling.
- Partial upload/bind cleanup failures must remain observable without leaking private identifiers; Task 3 tests teaser-only, video-created, and bind-failure cleanup diagnostics.

---

### Task 1: Canonical Premium Video Database Authority

**Files:**
- Create: `tests/creatorPremiumB3SignedStreamDatabase.test.mjs`
- Create: `tests/creatorPremiumB3Local.integration.mjs`
- Create via CLI: `supabase/migrations/<generated>_creator_premium_b3_signed_stream_playback.sql`

**Interfaces:**
- Consumes: B1 age/account/entitlement functions, B2 teaser/link/catalog functions, existing `reserve_stream_upload_asset(...)`, `video_assets`, and `video_asset_links`.
- Produces: `authorize_my_creator_premium_video_upload_v1(uuid)`, `set_my_creator_premium_video_media_v1(uuid,uuid,uuid)`, `get_my_creator_premium_video_media_v1(uuid)`, Premium purpose/entity constraints, protected projections, and service-role reservation support.

- [ ] **Step 1: Write static RED tests for the migration contract**

  Add named assertions proving exactly one generated B3 migration, `creator_premium_video`, preserved `feed_video`/`business_library`, preserved legacy `exclusive_content`, private Premium visibility, null permanent URL invariants, signed-provider metadata proof, Premium link shape/uniqueness/guard, RLS exclusions, explicit RPC ACLs, fixed search paths, no finance, and no parallel table/provider/teaser system.

- [ ] **Step 2: Write disposable RED tests for behavioral security**

  In `creatorPremiumB3Local.integration.mjs`, clone the existing B2 disposable harness and add fixtures/assertions for all 27 database cases from the macro: wrong visibility/URLs/signed marker/slot/position/purpose/readiness/creator/kind/lifecycle, one-asset reuse, replay, replacement denial, safe owner/catalog projections, generic RLS hiding, and B2 image/teaser regression. Include missing/false/non-boolean signed-provider markers.

- [ ] **Step 3: Run RED tests and record expected failures**

  Run: `node --test tests/creatorPremiumB3SignedStreamDatabase.test.mjs tests/creatorPremiumB3Local.integration.mjs`

  Expected: static tests fail because no B3 migration exists; the disposable test is skipped unless enabled.

- [ ] **Step 4: Generate the migration with the repository CLI**

  Run: `npx supabase migration new creator_premium_b3_signed_stream_playback`

  Expected: exactly one new fourteen-digit migration file.

- [ ] **Step 5: Implement Premium video constraints and reservation**

  In the generated migration, forward-only rebuild existing purpose, ready-invariant, and entity-type checks; add Premium-only shape and partial unique indexes; replace the six-argument `reserve_stream_upload_asset` so visibility is private only for `creator_premium_video`; retain the five-argument feed wrapper and existing service-role-only grants.

- [ ] **Step 6: Implement the narrow Premium video-link guard**

  Create `private.guard_creator_premium_video_link_v1()` with `SECURITY DEFINER SET search_path=''`, fully qualified relations, asset/content ownership and lifecycle checks, signed marker proof, and rejection of Premium assets linked to any noncanonical entity. Revoke all ordinary execution and attach it only to `video_asset_links` inserts/updates.

- [ ] **Step 7: Extend B2 teaser authorization without weakening image originals**

  Replace `public.authorize_my_creator_premium_image_upload_v1` and `private.guard_creator_premium_media_link_v1` so `teaser` accepts image or video drafts, while R2 `original` and image-pair binding remain image-only.

- [ ] **Step 8: Implement authenticated owner RPCs and safe projections**

  Add the upload authorization, first-bind/idempotent video pair, and owner media-state functions with caller-derived identity, canonical age/account checks, deterministic advisory/content locks, exact return columns, revokes from all roles, and authenticated-only grants. Recreate existing owner and catalog functions with `video_attached`/`video_media_ready` and require a valid teaser plus protected ready Stream link for catalog video rows.

- [ ] **Step 9: Tighten Premium-only RLS visibility**

  Recreate `video_assets_select_own` excluding `creator_premium_video` and `video_asset_links_select_own` excluding `creator_premium_content`, preserving all other policy behavior.

- [ ] **Step 10: Run static GREEN tests**

  Run: `node --test tests/creatorPremiumB3SignedStreamDatabase.test.mjs`

  Expected: all B3 database contract tests pass.

- [ ] **Step 11: Run the disposable database proof**

  Run with the discovered Docker/WSL fixture values: `$env:NELYON_PREMIUM_B3_LOCAL='1'; node --test tests/creatorPremiumB3Local.integration.mjs`

  Expected: migration compiles and every behavioral case passes against a disposable database; production remains untouched.

- [ ] **Step 12: Commit the database authority**

  Run:
  `git add docs/superpowers/plans/2026-10-08-creator-premium-b3-signed-stream-playback.md tests/creatorPremiumB3SignedStreamDatabase.test.mjs tests/creatorPremiumB3Local.integration.mjs supabase/migrations/*_creator_premium_b3_signed_stream_playback.sql`

  Commit: `feat(premium): add private Stream video authority`

---

### Task 2: Protected Stream Upload, Reconciliation, and Playback

**Files:**
- Create: `supabase/functions/_shared/premiumStreamSecurity.ts`
- Modify: `supabase/functions/create-stream-upload/index.ts`
- Modify: `supabase/functions/get-stream-playback/index.ts`
- Modify: `supabase/functions/stream-webhook/index.ts`
- Create: `tests/creatorPremiumB3EdgeStream.test.mjs`
- Create: `tests/creatorPremiumB3SigningCrypto.test.mjs`

**Interfaces:**
- Consumes: Task 1 RPCs/schema; existing `streamFetch`, validators, public `reconcileStreamVideo`, `authenticatedClient`, `admin`, and runtime secret names.
- Produces: `reconcilePremiumStreamVideo(result, expectedUid, maxDurationSeconds?)`, `createPremiumStreamPlaybackGrant({cloudflareUid, customerCode, nowSeconds?})`, Premium direct-upload authorization, purpose-aware webhook reconciliation, safe owner processing descriptors, and entitlement playback grants.

- [ ] **Step 1: Write RED Edge contract tests**

  Build VM harnesses following B2 Edge tests. Assert Premium context validation, authorization RPC calls, private reservation, `requireSignedURLs=true`, provider metadata, Feed/Business `false`, Premium reconciliation success/failure/null URLs, purpose-aware webhook behavior, ready-state idempotency, exclusive request shapes, entitlement/link/asset fail-closed cases, safe processing output, no-store headers, exact safe grant fields, and no logging of tokens/URLs.

- [ ] **Step 2: Write RED cryptographic tests with a disposable RSA key**

  Assert RS256, header `kid`, claims `sub`/`kid`, `nbf` within 30 seconds, `exp <= now+300`, successful verification with the matching public key, failure with a wrong key or expired claims, three token-as-UID URL shapes, and absence of download/share claims.

- [ ] **Step 3: Run RED tests and record expected failures**

  Run: `node --test tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB3SigningCrypto.test.mjs`

  Expected: fail because the Premium helper and request paths do not exist.

- [ ] **Step 4: Implement `premiumStreamSecurity.ts`**

  Export constants for the purpose, 300-second TTL, and 30-second skew; implement Premium reconciliation using existing scalar validators; decode `STREAM_SIGNING_KEY_JWK_B64`, validate/import an RSA private JWK through Web Crypto, sign compact JWTs without logging, and construct the three `customer-<CODE>.cloudflarestream.com/<TOKEN>/...` URLs. Do not modify `_shared/stream.ts` unless a test proves an unavoidable shared dependency.

- [ ] **Step 5: Extend `create-stream-upload` purpose routing**

  Require exactly one Premium context for `creator_premium_video`, reject Business mixing and context on Feed/Business, call `authorize_my_creator_premium_video_upload_v1` through the caller session, reserve under the authenticated user, and set provider `requireSignedURLs` by purpose. Add `premium_content_id` only to Premium provider metadata.

- [ ] **Step 6: Route webhook reconciliation by stored purpose**

  Use `reconcilePremiumStreamVideo` only for `creator_premium_video`; preserve the public reconciler byte-semantically for Feed/Business. Keep ready Premium URLs null on repeated/late callbacks and fail closed if provider protection disappears.

- [ ] **Step 7: Add mutually exclusive playback authorities**

  In `get-stream-playback`, keep owner `asset_id` lookup and provider polling but return `playbackMode='premium_entitlement_required'` with null URLs for Premium. Add the `premium_content_id` route: caller-session B1 entitlement, admin resolution with `limit(2)`, strict private ready asset validation, one local token, exact safe response fields, and `private, no-store`/`no-cache` headers.

- [ ] **Step 8: Run Edge and crypto GREEN tests**

  Run: `node --test tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB3SigningCrypto.test.mjs`

  Expected: all B3 Edge and cryptographic tests pass.

- [ ] **Step 9: Run existing Stream webhook/backend regressions**

  Run: `node --test tests/streamBackendFoundation.test.mjs tests/creatorPremiumB2EdgeMedia.test.mjs tests/creatorPremiumB2C1NoStoreHardening.test.mjs`

  Expected: no new failure and public Feed/Business assertions remain green.

- [ ] **Step 10: Commit protected Stream authority**

  Run: `git add supabase/functions/_shared/premiumStreamSecurity.ts supabase/functions/create-stream-upload/index.ts supabase/functions/get-stream-playback/index.ts supabase/functions/stream-webhook/index.ts tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB3SigningCrypto.test.mjs`

  Commit: `feat(premium): add signed entitlement playback`

---

### Task 3: Creator Premium Stream Client and Full Verification

**Files:**
- Create: `services/creatorPremiumStreamService.ts`
- Modify: `services/streamService.ts`
- Modify: `services/creatorPremiumService.ts`
- Create: `tests/creatorPremiumB3ClientStream.test.mjs`
- Modify only if required by a proven B3 assertion: existing focused B1/B2/Stream tests

**Interfaces:**
- Consumes: Task 1 RPCs, Task 2 Edge contracts, B2 `uploadMediaFromUri`/`deleteMediaAsset`, and existing direct POST/delete helpers.
- Produces: `uploadCreatorPremiumVideoMedia(...)`, `fetchMyCreatorPremiumVideoMedia(contentId)`, `getCreatorPremiumVideoPlaybackGrant(contentId)`, Premium processing helpers in `streamService`, safe owner video fields, and `CREATOR_PREMIUM_VIDEO_MEDIA_AVAILABLE=true` while complete media/finance flags remain false.

- [ ] **Step 1: Write RED client orchestration tests**

  Test exact teaser purpose/visibility/context, exact Premium Stream request, direct POST, Premium-safe polling, bind arguments, same-pair-only behavior, teaser cleanup when Stream creation fails, both canonical cleanup calls after processing/bind failures, surfaced cleanup diagnostics without private IDs, and no original request from the profile.

- [ ] **Step 2: Write RED grant and persistence tests**

  Assert the client sends only `premium_content_id`; validates matching `contentId`, HTTPS HLS manifest/DASH/thumbnail forms, future expiration and the 300-second-plus-small-skew ceiling; and contains no AsyncStorage, FileSystem, MediaLibrary, Share, background download, global prefetch, or persistent URL cache.

- [ ] **Step 3: Run RED client tests and record expected failures**

  Run: `node --test tests/creatorPremiumB3ClientStream.test.mjs`

  Expected: fail because the service and Premium Stream client helpers do not exist.

- [ ] **Step 4: Extend `streamService.ts` with Premium-safe primitives**

  Add exact-purpose upload creation and processing descriptor validation without weakening existing feed functions. Premium ready state requires duration but permits null playback URLs only when `playbackMode='premium_entitlement_required'`; expose a dedicated Premium polling helper rather than changing public ready semantics.

- [ ] **Step 5: Implement `creatorPremiumStreamService.ts`**

  Define safe input/state/grant types and the three public functions. Orchestrate teaser upload, Premium direct upload, processing poll, first bind, and canonical cleanup. Keep all provider/private identifiers internal to the operation and remove them from returned diagnostics.

- [ ] **Step 6: Extend canonical Premium owner types and capability flags**

  Add `video_attached` and `video_media_ready` to `CreatorPremiumOwnerItem`, set `CREATOR_PREMIUM_VIDEO_MEDIA_AVAILABLE=true`, and keep `CREATOR_PREMIUM_MEDIA_AVAILABLE=false` plus `CREATOR_PREMIUM_FINANCE_AVAILABLE=false`.

- [ ] **Step 7: Run client GREEN tests**

  Run: `node --test tests/creatorPremiumB3ClientStream.test.mjs tests/streamClientIntegration.test.mjs tests/creatorPremiumB2ClientMedia.test.mjs`

  Expected: B3 client tests pass with no existing Stream/B2 regression.

- [ ] **Step 8: Run all focused B1/B2/B2-C1/B3 suites**

  Run: `node --test tests/creatorPremiumB1CanonicalFoundation.test.mjs tests/creatorPremiumB1ClientHardening.test.mjs tests/creatorPremiumB2PrivateImageMedia.test.mjs tests/creatorPremiumB2EdgeMedia.test.mjs tests/creatorPremiumB2ClientMedia.test.mjs tests/creatorPremiumB2C1NoStoreHardening.test.mjs tests/creatorPremiumB3SignedStreamDatabase.test.mjs tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB3SigningCrypto.test.mjs tests/creatorPremiumB3ClientStream.test.mjs`

  Expected: all focused tests pass.

- [ ] **Step 9: Run Stream and finance regressions**

  Discover the exact current test files with `rg`; run all Stream upload/playback/webhook/delete, Feed, Business, Ads video, ledger, and finance hardening suites. Expected: zero new B3-caused failures.

- [ ] **Step 10: Run global, TypeScript, ESLint, and diff verification**

  Run `node --test "tests/*.test.mjs"`; compare with the accepted 3395/3359/36 historical baseline plus new B3 tests. Run `npx tsc --noEmit --pretty false` and prove zero diagnostics in B3-changed files. Run repository ESLint on every changed TS/TSX file with zero errors/warnings. Run `git diff --check` with PASS.

- [ ] **Step 11: Commit the client and test proof**

  Run: `git add services/creatorPremiumStreamService.ts services/streamService.ts services/creatorPremiumService.ts tests/creatorPremiumB3ClientStream.test.mjs`

  Add any deliberately extended focused tests explicitly, then commit: `feat(premium): wire creator Premium video client`

---

### Task 4: Controlled Push, Migration, Edge Deployment, and Postcheck

**Files:**
- No source creation. Operates only on the verified commits from Tasks 1–3.

**Interfaces:**
- Consumes: complete verified branch, one pending B3 migration, installed signing secret names, and current production baselines.
- Produces: remote branch parity, migration count 333, changed Edge source parity, and the required B3 evidence report. It never updates `main`.

- [ ] **Step 1: Request whole-branch code review and resolve only verified B3 findings**

  Use `superpowers:requesting-code-review`; inspect every finding against the macro and add a failing regression test before any correction.

- [ ] **Step 2: Re-run final verification after review**

  Repeat all focused, regression, global, TypeScript, ESLint, disposable DB, and diff checks from Tasks 1–3. No success claim may use earlier output.

- [ ] **Step 3: Push the B3 branch normally and verify parity**

  Run `git push -u origin codex/creator-premium-b3-signed-stream-playback`, fetch, and require local SHA equals the remote B3 SHA while `origin/main` remains the approved base. Force push is forbidden.

- [ ] **Step 4: Re-read production and linked dry-run state**

  Reconfirm migration count 332/latest B2, zero Premium content/video rows, four existing video assets, two existing links, the two stale Business uploads unchanged, finance 928/1918/1215.12, both signing secret names present, and the supplied automatic-redeploy Edge hashes. Inspect CLI help, then run linked `db push --dry-run` and require exactly one pending B3 migration.

- [ ] **Step 5: Deploy only the B3 migration**

  Run the supported linked Supabase command once. Require migration count 333 and latest equal the generated B3 migration. Do not create production fixtures.

- [ ] **Step 6: Deploy only changed Stream Edge bundles**

  Inspect `npx supabase functions deploy --help`, then deploy only `create-stream-upload`, `get-stream-playback`, and `stream-webhook` whose source/dependency bundles changed. Do not deploy `delete-stream-video`, image functions, finance, content safety, or unrelated Stream functions.

- [ ] **Step 7: Run production read-only postchecks and advisors**

  Verify zero Premium rows/assets/links, the original four Stream assets and two stale Business rows unchanged, finance unchanged, secret names present without retrieving values, changed Edge source parity, unrelated Edge hashes unchanged, and security/performance advisors classified only for B3-new findings.

- [ ] **Step 8: Verify final Git state and produce the mandatory report**

  Require branch local/remote parity, clean worktree, `git diff --check` PASS, unchanged `origin/main`, no force push, no main integration, no B4, and then emit the exact `# CREATOR-PREMIUM-B3 REPORT` structure and one allowed final verdict.
