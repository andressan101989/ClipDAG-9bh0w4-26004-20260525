# WEB-CONTROL-CENTERS-B1 Implementation Plan

> **For Codex:** Execute this plan in order with test-driven development. Do not
> start B2, a calendar, scheduler, or Creator Studio Web UI.

**Goal:** Repair canonical Creator Studio publication and deliver private,
cross-device drafts, idempotent photo/carousel receipts, and MEDIA-C1-safe media
reservations.

**Architecture:** One private draft authority and immutable receipt authority;
canonical media links as reservations; existing image purposes uploaded with
private visibility; existing
photo/carousel/Stream publishers; exact client confirmation; no parallel Feed,
media, or cleanup systems.

**Tech stack:** PostgreSQL 17/Supabase, PL/pgSQL, Supabase Edge/Deno TypeScript,
Expo/React Native TypeScript, Node test runner, disposable PostgreSQL proof,
canonical Nelyon production release workflow.

---

## Task 1: Freeze the exact contract with failing tests

**Files:**

- Create: `tests/webControlCentersB1Publication.test.mjs`
- Create: `tests/webControlCentersB1Drafts.test.mjs`
- Create: `tests/webControlCentersB1Client.test.mjs`
- Create: `tests/fixtures/web-control-centers-b1-security.sql`

1. Add source/contract tests for private draft purposes, strict persisted URL
   validation, required canonical UUIDs, stable client command IDs, no local URI
   path from Studio, private relation/RPC/ACL contracts, receipt immutability,
   CAS, link-policy exclusion, and exact publisher delegation.
2. Run only these tests and capture the expected RED failures.
3. Do not weaken existing media or release assertions.

## Task 2: Add the forward-only database authority

**Files:**

- Create with pinned CLI, then edit:
  `supabase/migrations/<timestamp>_web_control_centers_b1_publication_drafts.sql`
- Create: `scripts/prove-web-control-centers-b1-disposable.mjs`

1. Add private draft, mutation-command, and publication-receipt tables,
   constraints, indexes, ENABLE/FORCE RLS, deny-by-default grants, and immutable
   guards.
2. Extend canonical media-link entity type and add a draft-specific ownership,
   shape, purpose, visibility, and READY guard.
3. Replace link read policies so `publication_draft` is never projected.
4. Add versioned create/get/list/update/delete/direct-publish/draft-publish RPCs
   with pinned empty search paths, JWT-derived owner, bounded inputs, CAS,
   mutation-command replay, deterministic locks, fingerprints, publication
   receipt replay with owned-target validation, and publisher delegation.
5. Grant only the intended authenticated RPCs; revoke every other principal.
6. Build the PostgreSQL 17 disposable proof from real predecessor contracts.
7. Run RED/GREEN for create replay/conflict, cross-owner denial, CAS races,
   ordered media validation, receipt replay/mismatch, concurrent publish,
   rollback, reservation/cleanup race, deletion, ACL/RLS, and old publisher
   compatibility.

## Task 3: Reuse and harden the existing private media upload contract

**Files:**

- Modify: `services/mediaService.ts`
- Modify: relevant media tests

1. Prove and preserve that private `post_image`/`carousel_image` uploads use the
   private bucket, finalize READY without `public_url`, and remain owner-only.
2. Refactor create/upload so native URI and browser Blob transports share the
   same canonical create/PUT/finalize contract.
3. Add a strict persisted HTTPS validator; local/blob/data values remain valid
   only as upload sources, never final entity URLs.
4. Prove owner signed access remains bounded and purpose/visibility/MIME/size
   failures are closed.

## Task 4: Implement the cloud draft client facade

**Files:**

- Create: `services/publicationDraftService.ts`
- Modify: `modules/creator/drafts/DraftManager.ts`
- Modify: `modules/creator/drafts/index.ts`
- Add focused tests

1. Add typed create/get/list/update/delete/publish RPC wrappers with UUID,
   revision, cursor, state, and composition validation.
2. Add helpers to upload photo/carousel draft sources privately and materialize
   a private source through canonical public R2 upload when publishing.
3. Convert `DraftManager` into a local cache/facade over the cloud authority;
   surface cache and sync failures and never report `draft_saved` before the
   durable RPC succeeds.
4. Persist only safe editor facts and canonical asset IDs. Never cache signed,
   local, blob/data, provider-key, or public delivery URLs as cloud authority.
5. Preserve local recovery data while treating server revision as canonical.
6. Test cross-device restore, stale CAS, mutation replay, deletion,
   offline/cache failure,
   private signed-source materialization, and stable publish command reuse.

## Task 5: Repair photo/carousel client publication

**Files:**

- Modify: `contexts/FeedContext.tsx`
- Modify: `app/(tabs)/upload.tsx`
- Modify: focused media tests

1. Change asset-backed photo/carousel publication to
   `publish_my_media_post_v1` with a stable command UUID retained through retry.
2. Require a valid canonical post UUID before optimistic insertion or success.
3. Propagate controlled failures instead of returning `undefined`.
4. Reject non-HTTPS persisted URLs before RPC/insert.
5. Preserve carousel ordering, bounded upload concurrency, ambiguous-response
   reconciliation, product-tag behavior, and cleanup boundaries.
6. Ensure the raw legacy path is unreachable from Creator Studio and cannot
   persist a local/blob/data URL.

## Task 6: Repair Creator Studio publication seam

**Files:**

- Modify: `components/feature/studio/VideosTab.tsx`
- Modify: `components/feature/studio/EffectsTab.tsx`
- Modify: `hooks/video/useVideoEditor.ts`
- Add focused tests

1. Separate export result from publish result; queued export is not success.
2. Route Studio videos through `uploadAndPublishStreamVideo` and require the
   canonical post ID.
3. Route Studio photos through canonical R2 upload and idempotent photo RPC.
4. Fix recording media type and enforce a single in-flight operation.
5. Preserve clips, effects, caption, media source, and stable command on every
   failure/confirmation-pending state; clear only after confirmed publication.
6. Expose explicit uploading/processing/publishing/failed/retry UI states
   without redesigning the Studio.

## Task 7: Add B1 release-governance authority

**Files:**

- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs`

1. Add an explicit successor transition from the current 365-migration
   baseline to B1; never rewrite historical hashes.
2. Attest exact migration bytes, Edge dependency closure, relation catalog,
   RPC definitions, ACL, owner, search path, FORCE RLS, policies, unchanged
   purpose registry, empty finance delta, and preservation of prior authorities.
3. Add negative tests for migration/RPC/ACL/policy/receipt tampering,
   extra Edge functions, and unknown Advisor findings.
4. Keep the expected manifest to one migration and the compiler-derived Edge
   closure; fail closed on any extra productive resource.

## Task 8: Full verification and independent review

1. Run focused B1 tests and disposable PostgreSQL proof.
2. Run media, Stream, Creator recovery, MEDIA-C1, Stories, Premium, LIVE,
   Finance, Marketplace, Ads, release-gate, snapshot-adapter, TypeScript,
   ESLint, and build regressions proportionate to the touched graph.
3. Run `git diff --check`, inspect the exact file list, and confirm no unrelated
   changes.
4. Request independent code/security review. Resolve every Critical/Important
   finding and rerun affected tests.

## Task 9: Protected integration and canonical release

1. Commit focal changes and push only the B1 branch.
2. Open a protected PR, verify exact files/SHA/checks/conflicts/review, and
   rebase-and-merge without bypassing main protection.
3. From fresh integrated `origin/main`, run `plan_only` and verify exactly one
   B1 migration, normally zero Edge functions, and no unrelated resource.
4. Run fresh `gate_proof`, physical backup, pre-snapshot, HIGH release,
   post-snapshot, and postcheck.
5. Verify 366 migrations if no concurrent release, exact Edge inventory,
   private draft authority, receipts, reservations, MEDIA-C1, RLS/ACL, and zero
   financial/publication attribution.
6. Promote the verified baseline in a separate protected PR, sync/read back the
   exact policy digest, and require final `NO PRODUCTIVE CHANGES`.
7. Report mobile source verification separately; do not claim an installable
   bundle or physical QA unless that artifact was actually built and tested.

## Completion evidence

- exact initial/integrated/final SHA and PRs;
- migration and Edge digests;
- focused and regression PASS/FAIL/SKIP counts;
- disposable concurrency/rollback evidence;
- canonical release and postcheck run IDs;
- baseline PR/digest and final no-change plan;
- explicit confirmation of zero BDAG movement and zero artificial production
  publication.
