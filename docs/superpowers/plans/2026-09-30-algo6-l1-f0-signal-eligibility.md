# ALGO-6-L1-F0 Signal + Eligibility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one secure, durable organic video-consumption authority and server-side video eligibility without introducing ranking.

**Architecture:** `public.video_views` is append-only and writable only through an idempotent `record_video_view_v1` RPC that derives actor, duration, completion and rewatch server-side. The existing `public.videos` authority remains chronological, gains canonical RLS eligibility and composite indexes, while the client uses stable keyset cursors and a lifecycle tracker that finalizes one exposure event. Creator/Profile pages query the same server authority directly; Ads remain an independent post-organic insertion layer.

**Tech Stack:** PostgreSQL 17/Supabase RLS and RPC, TypeScript/React Native/Expo, Supabase JS, Node test runner, disposable PostgreSQL Docker tests.

**Spec:** Owner-provided `ALGO-6-L1-F0 — SIGNAL + ELIGIBILITY FOUNDATION` specification in the current task thread.

## Global Constraints

- Create exactly one forward-only Supabase migration using `supabase migration new algo6_l1_f0_signal_eligibility_foundation`.
- Do not implement ranking, scoring, ML, embeddings, a recommendation service, or a second signal/content authority.
- Do not modify Ads V2, Stripe, finance, Marketplace, Stories, LIVE Battles, media relay, wallet, ledger, or rewards.
- Keep organic ordering exactly `created_at DESC, id DESC`; sponsored insertion remains downstream and unchanged.
- Preserve all existing production rows and historical `videos.views_count`; raw F0 events are the future behavioral authority.
- Do not expose raw viewer identities, accept actor/derived fields from clients, or collect sensitive/device-fingerprint data.

## Review Focus

- Concurrent replay of one `client_event_id` must create one row and one `views_count` increment.
- A replay after canonical media metadata changes must remain idempotent when its client payload and actor match.
- Anonymous, private-profile, blocked-direction and moderated-content boundaries must fail closed in both SELECT and RPC paths.
- App background, swipe and unmount races must finalize an exposure once and exclude background time.
- Keyset pagination must handle equal timestamps and intervening inserts without duplicates or OFFSET.

---

### Task 1: Database signal and eligibility authority

**Files:**
- Create: `tests/algo6L1F0SignalEligibility.test.mjs`
- Create: `tests/algo6L1F0SignalEligibilityLocal.integration.mjs`
- Create: `supabase/migrations/<generated>_algo6_l1_f0_signal_eligibility_foundation.sql`

**Interfaces:**
- Consumes: existing `public.videos`, profile/follow/block authorities, media/video asset link authorities, and `private.admin_content_is_visible(text, uuid)`.
- Produces: `private.video_can_view_owner(uuid)`, `public.record_video_view_v1(uuid,uuid,uuid,bigint,text)`, `public.get_my_video_analytics_v1(uuid)`, `public.reconcile_algo_signal_foundation_v1()`, and indexed append-only `public.video_views`.

- [ ] Write contract and disposable-local tests for schema constraints, ACL/RLS/FORCE RLS, eligibility matrix, idempotent replay/conflict, duration/completion/rewatch derivation, counter behavior, aggregate analytics, and reconciliation.
- [ ] Run the new tests and verify RED because the migration and RPCs do not exist.
- [ ] Generate the migration with the Supabase CLI and implement only the tested authority, policy, indexes and RPCs with fixed empty `search_path` and explicit grants.
- [ ] Run static and disposable-local database tests and verify GREEN.
- [ ] Commit Task 1.

### Task 2: Playback lifecycle and keyset primitives

**Files:**
- Create: `services/videoPlaybackSession.ts`
- Create: `services/feedKeyset.ts`
- Test: `tests/algo6L1F0SignalEligibility.test.mjs`

**Interfaces:**
- Consumes: injected UUID/clock and the RPC payload contract from Task 1.
- Produces: a one-shot playback exposure controller and `{createdAt,id}` descending keyset helpers for FeedContext/VideoCard.

- [ ] Add behavior tests for one emission on swipe/background/unmount races, background exclusion via exposure finalization, stable event ID across retry, a new ID per exposure, and equal-timestamp keyset filtering.
- [ ] Run the tests and verify RED because the modules do not exist.
- [ ] Implement the minimal pure modules with no persistence or ranking logic.
- [ ] Run the tests and verify GREEN.
- [ ] Commit Task 2.

### Task 3: Feed and VideoCard integration

**Files:**
- Modify: `contexts/FeedContext.tsx`
- Modify: `components/feature/VideoCard.native.tsx`
- Modify: `components/feature/VideoCard.tsx`
- Modify: `app/(tabs)/index.tsx`
- Test: `tests/algo6L1F0SignalEligibility.test.mjs`

**Interfaces:**
- Consumes: Task 1 RPCs and Task 2 playback/keyset primitives.
- Produces: chronological keyset candidate loading, RPC-only view recording, aggregate-only analytics, real lifecycle exit reasons, and runtime empty/error states without sample content.

- [ ] Add tests proving no OFFSET/range, no production `SAMPLE_VIDEOS`/`MOCK_COMMENTS`, RPC-only tracking, one local counter increment only for newly recorded events, and unchanged Ads insertion constants/contracts.
- [ ] Run tests and verify RED against the current runtime.
- [ ] Replace Feed offset state with stable cursor state, remove runtime mock merging, call the canonical RPCs, and wire VideoCard AppState/swipe/unmount finalization.
- [ ] Run focused client and Ads regression suites and verify GREEN except the documented pre-existing Story F assertion.
- [ ] Commit Task 3.

### Task 4: Canonical Creator/Profile/My Content loading

**Files:**
- Modify: `services/creatorService.ts`
- Modify: `app/(tabs)/profile.tsx`
- Modify: `app/my-content.tsx`
- Verify: `app/creator/[id].tsx`
- Test: `tests/algo6L1F0SignalEligibility.test.mjs`

**Interfaces:**
- Consumes: server-enforced `videos` RLS and creator composite index from Task 1.
- Produces: mapped creator video pages loaded from Supabase independently of the partial Feed window.

- [ ] Add tests proving own Profile and My Content fetch canonical creator videos and that the direct creator route keeps the same RLS-protected service.
- [ ] Run tests and verify RED because own surfaces still filter `FeedContext.videos`.
- [ ] Add one typed creator-video mapper/query and update own surfaces without redesigning UI or activating orphan creator follow/search methods.
- [ ] Run focused profile/creator tests and verify GREEN.
- [ ] Commit Task 4.

### Task 5: Full verification, production deployment, reconciliation and remote proof

**Files:**
- Modify only if a RED test exposes an F0 regression; every fix gets its own RED→GREEN proof.

**Interfaces:**
- Consumes: all Task 1–4 outputs.
- Produces: one deployed migration, zero production fixtures/mutations outside schema deployment, post-deploy reconciliation, clean pushed branch, and the required A–Q report.

- [ ] Run TypeScript/lint and all relevant Feed, VideoCard, creator/profile, Stories, Ads V2 feed, Marketplace tag, moderation and deployment suites; then run the repository-wide Node suite and classify every failure.
- [ ] Review the full branch for security, privacy, idempotency, pagination and scope drift; fix only Critical/Important findings via RED→GREEN.
- [ ] Compare pre-deploy production migration/schema/data/finance/Ads baselines, apply exactly the generated F0 migration, then run advisors, ACL/RLS/index proofs and `reconcile_algo_signal_foundation_v1()`.
- [ ] Verify production row/finance/Stripe/Ads/Marketplace invariance, `video_views = 0` absent legitimate new traffic, migration count `311`, and no Edge deployment.
- [ ] Run final `git status --short`, `git diff --check`, commit any verification-only adjustment, push normally, and prove local HEAD equals remote branch SHA.
