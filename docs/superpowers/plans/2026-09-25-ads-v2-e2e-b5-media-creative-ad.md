# Ads V2 E2E-B5 Implementation Plan

**Goal:** Make Business Media, Creative creation/versioning, and Ad assembly safe and customer-facing while adding server-side Creative Version idempotency.

## 1. Lock the database contract with tests

- Add a focused static migration test for the idempotency column, deterministic backfill, NOT NULL/unique enforcement, v1 key propagation, replay/conflict behavior, old-signature removal, and ACL hardening.
- Add or extend disposable PostgreSQL coverage for exact replay, conflict, different-key versioning, concurrency, ownership, media purpose/readiness, and grants.
- Run the new tests first and record the expected failures.

## 2. Add the single forward migration

- Create `ads_v2_e2e_b5_creative_version_idempotency` with the Supabase CLI.
- Backfill historical version keys from row IDs, make the key required, and enforce uniqueness per Creative.
- Preserve `create_my_advertising_creative` semantics while copying the logical create key into version 1.
- Replace the eight-argument Creative Version RPC with the required-key signature and exact replay/conflict behavior under the Creative row lock.
- Revoke the unsafe signature and expose only the authenticated hardened signature.

## 3. Lock the Business client behavior with tests

- Add pure Creative UX tests for validation, CTA labels, media eligibility, semantic equality, latest-version selection, and pinned historical versions.
- Add component tests for the media picker, composer, preview, empty/processing states, version editing, Ad assembly, and no raw IDs.
- Add API tests proving explicit Creative Version idempotency keys.
- Add workspace tests proving no first-row selection, no review submission, B1 coordination, and B2/B4 state preservation.
- Run each focused test before implementation and record the expected failures.

## 4. Implement customer-facing Media and Creative UX

- Reuse `BusinessMediaPicker`, the existing uploader, and `search_my_business_media`.
- Limit selectable Creative media to ready `business_library` assets and keep server validation authoritative.
- Add a Creative composer with derived format, copy limits, labeled CTA choices, accessible errors, and image/video preview.
- Support create and immutable edit flows through B1 scopes `creative:create:<adAccountId>` and `creative:version:<creativeId>`.
- Disable semantic no-change saves and reconcile uncertain version writes against the canonical Creative workspace.

## 5. Implement safe Ad assembly

- Present explicit Creative and Destination choices without UUID fields.
- Offer only each Creative's latest safe version for new Ads while resolving an existing Ad against its exact pinned historical version.
- Preserve B2 explicit selection for multiple Ads and set the returned Ad as the selected URL state.
- Create through `create_my_advertising_ad_draft` and B1 scope `ad:create:<adSetId>`.
- Keep review read-only in B5 and expose no review submission action.

## 6. Verify, apply, and deploy

- Run focused tests, the complete Business suite, lint, deployment tests/build, Ads/PLR regressions, Marketplace regressions, and `git diff --check`.
- Apply the single migration only after local/disposable proof, then reconcile repository filename to the production migration version.
- Verify production rows, switches, finance counters, Edge versions, reconciliations, and Supabase advisors read-only.
- Build Business once, upload one preview version, smoke it without writes, promote that exact version, and confirm Public/Admin stayed unchanged.
- Request code review, address verified findings, commit, push, and verify local/remote SHA equality with a clean worktree.
