# Stories V2 Interactive B1 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task, superpowers:test-driven-development in every implementation task, and superpowers:verification-before-completion before completion claims.

**Goal:** Add secure interactive Stories, trustworthy media safety, stable editor/viewer geometry, resilient Realtime, and release-ready governance without duplicating existing authorities.

**Architecture:** Extend `StoriesContext`, the current editor/viewers, private R2/Stream media, moderation, the existing velocity/idempotency authorities, and one Realtime invalidation channel. One forward-only migration owns the interaction schema/RPCs. New direct Story video uses private Stream for provider-backed duration/visual/audio evidence. Missing normative policy stays fail-closed and blocks merge/release.

**Tech Stack:** PostgreSQL/Supabase, RLS/FORCE RLS, Deno Edge Functions, React Native/Expo, Supabase Realtime, Node tests, disposable PostgreSQL, canonical Nelyon release gate/snapshot adapter.

## Global constraints

- Work only in `D:\CodexWorktrees\ClipDAG\stories-v2-interactive-b1` from verified `origin/main`; preserve every other checkout/stash.
- No reset, clean, prune, force push, direct main push, manual production SQL, direct Edge deploy, or uncontrolled production mutation.
- Do not invent/enable Stories normative rules or reuse Creator Premium P3 by assumption. Missing policy blocks merge/release.
- Keep Finance GENERAL, Creator Premium F5, LIVE Battles C1, P3, and MEDIA-C1 unchanged.
- No second Story provider/editor/uploader/scanner/Realtime/analytics/rate-limit/idempotency authority.
- Exact qualification, fixed empty `search_path`, least privilege, RLS/FORCE RLS, owner/capability checks, and fail-closed behavior are mandatory.
- Every behavior change begins RED; never weaken historical guards.

### Task 1: Trustworthy baseline and shared client contract

**Files:** create `tests/storiesV2InteractiveB1Contract.test.mjs` and `components/feature/storyInteractiveTypes.ts`; update only the obsolete guards in `storiesV2FViewerPlaybackIntegrity`, `storiesV2I1OriginalNavigationEditorValidation`, and `storiesV2IShareEditorIntegrity` plus Git-cwd portability where genuinely needed.

- [ ] Reproduce 255 historical tests with exactly three semantic stale guards and no sandbox infrastructure failures.
- [ ] RED-test five discriminated types, versioning, normalized placement, bounded content, private quiz-answer exclusion, unknown-key/URL rejection, and legacy compatibility.
- [ ] Replace stale guards with stronger immutable/current-contract assertions; preserve ad-aware viewed logic, one editor/provider, discriminated feed access, and immutable package checkpoint.
- [ ] Implement the smallest strict parser/normalizer and run focused + complete Stories tests, ESLint, isolated strict TypeScript, and diff check.
- [ ] Commit and obtain independent task review.

### Task 2: Canonical database interaction, analytics, safety-state, and rate-limit authorities

**Files:** generate one migration with `supabase migration new stories_v2_interactive_b1`; create `storiesV2InteractiveB1Database.test.mjs`, `storiesV2InteractiveB1Local.integration.mjs`, a SQL fixture, and a proof runner only if needed.

- [ ] RED-test poll A/B and 3+, duplicate/replay, slider bounds/update, quiz secrecy, question privacy/moderation, positioned reaction, expiry/delete/blocks, aggregates, analytics idempotency, replay-before-rate-limit, concurrency, rollback, RLS/ACL/search path.
- [ ] Add private definition/response/analytics/safety/rate-policy tables and sanitized public revision rows with strict constraints/digests/indexes/RLS/FORCE RLS/grants.
- [ ] Add one response RPC, viewer state, creator results, question moderation, analytics, and private helpers. Reuse `check_velocity_limit` and `idempotency_keys`.
- [ ] Extend Story creation/visibility/deletion atomically; third-party reads require current `passed`; admin moderation stays authoritative; historical rows are not auto-passed.
- [ ] Prove real SQL/concurrency/privacy in disposable PostgreSQL and commit.

### Task 3: Trustworthy Story image/video safety and duration

**Files:** modify the still-unreleased Task 2 migration plus `_shared/mediaPurposes.ts`, narrowly generalized private Stream security, `create-media-upload`, `create-stream-upload`, `stream-webhook`, `get-stream-playback`, `content-safety-scan` (and audio pipeline only if necessary), `services/mediaService.ts`, `app/(tabs)/index.tsx`, and focused safety/duration/media tests.

- [ ] RED-test callable R2 Story-video intents, client duration trust, Premium-only signing, and incomplete direct Story modalities.
- [ ] Reject new R2 `story_video` intents server-side while preserving non-publishable legacy finalization.
- [ ] Extend existing private Stream for Story video with owner/purpose, signed playback, READY, trusted `0<duration<=15s`, generation/fence, and existing delete lifecycle.
- [ ] Extend existing scanner/resolvers for private R2 Story images and private Stream video frames/audio; never expose media/secrets.
- [ ] Fail closed on absent policy/rules, stale evidence, incomplete modality, or provider error; never equate 200/completed with passed.
- [ ] Switch the app video caller to canonical Stream while photos stay R2; run all media/Content Safety regressions and compute the compiler dependency graph; commit.

### Task 4: Interactive editor and shared geometry

**Files:** modify `storyComposition.tsx`, `StoryEditor.tsx`, and feed caller; create `StoryInteractiveEditorSheet.tsx`, `StoryInteractiveElement.tsx`, and editor/geometry/accessibility tests.

- [ ] RED-test add/edit/remove/reorder, shared full-media normalized geometry, safe areas/compact/iPad/split, drag/scale/rotation/z-order, keyboard, 44px targets/roles, and v1 compatibility.
- [ ] Add backward-compatible v2 placement references and one pure projection/clamp contract.
- [ ] Extend the single editor with bounded configuration and a common transform/layer model; add accessible transform alternatives.
- [ ] Run visual/editor/geometry/accessibility regressions and commit.

### Task 5: Viewer interactions, stable identity, Realtime, and analytics

**Files:** modify `StoriesContext.tsx`, native/web viewers, `StoryInteractions.tsx`, `StoriesBar.tsx`; create creator question-results sheet and viewer/Realtime/analytics tests.

- [ ] RED-test ID anchoring, deterministic `(created_at,id)` ordering, insert/delete races, media-ready views, gesture capture, result privacy, Realtime error/timeout/closed recovery/coalescing/backoff/fallback, and sanitized payloads.
- [ ] Extend—not replace—StoriesContext with bounded RPCs and one channel consuming sanitized revisions.
- [ ] Anchor both viewers by Story ID; render an accessible interactive layer with effective pause/gesture arbitration and no duplicate reaction record.
- [ ] Add creator-only keyset results/questions and canonical idempotent analytics.
- [ ] Run viewer/Realtime/reply/reaction/playback regressions and commit.

### Task 6: Integration, verification, governance, and protected release

**Files:** change release policy/compiler/adapter/tests only when exact findings require it; add operational/physical-QA docs.

- [ ] Run B1 disposable SQL plus all Stories/media/Content Safety/admin/release/snapshot regressions; report PASS/FAIL/SKIP truthfully.
- [ ] Run focal ESLint/TypeScript/build/Edge bundle/diff checks and audit callers/duplicates/three legacy tombstones without deletion.
- [ ] Obtain independent code/SQL/security/media/release reviews and resolve every Critical/Important through RED/GREEN.
- [ ] Create the protected functional PR and verify exact diff/checks/conflicts/review, but do not merge an unreleasable client/backend contract.
- [ ] If no owner-approved Stories normative policy exists, stop before merge/release with `STORIES_INTERACTIVE_PARTIAL_BLOCKED`.
- [ ] Once policy exists: rebase-merge, create separate exact-byte governance attestation if required, synchronize only the exact policy digest, run plan/gate/backup/snapshot, release the compiler-derived manifest, postcheck, baseline PR, and final `NO PRODUCTIVE CHANGES` plan.
- [ ] Prepare physical QA for iOS/Android, phone/tablet/split, photo/video, every interaction, slow/offline/reconnect, background, accessibility, expiry/deletion, and two users; never fabricate PHYSICAL_PASS.

## Completion criteria

One strict interaction authority handles all five types; media safety and duration are provider/server backed; incomplete evidence fails closed; editor/viewers share geometry and stable identity; Realtime/analytics are truthful; historical Stories/unrelated systems remain intact; integration/release happens only after the normative policy gate; ROADMAP 4 remains open until physical QA.
