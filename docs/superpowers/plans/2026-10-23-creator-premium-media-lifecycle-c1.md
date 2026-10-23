# Creator Premium Media Lifecycle C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox notation (`- [ ]`) for tracking.

**Goal:** Remove demonstrated media deletion races, make provider cleanup evidence truthful, add read-only Cloudflare reconciliation, and leave Creator Premium ready for the final F1 audit without touching historical unknown resources.

**Architecture:** Extend the canonical `media_assets` and `video_assets` lifecycle. Database row locks serialize link/delete; existing attempt counters fence asynchronous workers; Edge functions use strict compare-and-set; provider DELETE is followed by an independent absence read; immutable system audit receipts record only sanitized evidence. A separate read-only inventory tool classifies drift and never deletes.

**Tech Stack:** PostgreSQL 17 / Supabase migrations and Edge Functions (Deno/TypeScript), Cloudflare R2 S3 API, Cloudflare Stream API, Node.js tests/scripts, canonical Nelyon release workflow.

**Spec:** `docs/superpowers/specs/2026-10-23-creator-premium-media-lifecycle-c1-design.md`

**Global constraints:** No bulk cleanup, no manual provider deletion, no legacy-row deletion, no provider writes in reconciliation, no Finance or Content Safety changes, no billable upload probes, no secret/private-media output, and no production mutation outside the canonical protected release.

**Review focus:** Lock order, stale-worker fences, terminal-state monotonicity, R2 late-PUT windows, zero-row CAS handling, provider absence semantics, audit redaction, ACL/RLS, historical compatibility, and exact release scope.

## Task 1: Establish focal RED contracts

**Files:**

- Modify: `tests/creatorPremiumB3EdgeStream.test.mjs`
- Modify: `tests/creatorPremiumB5VideoCleanup.test.mjs`
- Add: `tests/creatorPremiumMediaLifecycleC1.test.mjs`
- Add: `tests/helpers/mediaProviderLifecycleHarness.mjs`

- [ ] Add a real shared-client contract proving the current Stream helper rejects an empty successful DELETE.
- [ ] Add webhook/playback stale-snapshot tests that require eligible source status, exact UID, and zero-row handling.
- [ ] Add allocation-versus-delete and finalizer-versus-delete tests.
- [ ] Add cleanup tests for provider success plus DB error/zero rows, stale attempts, `404`, retry failure, and truthful counters.
- [ ] Add R2 late-PUT and failed-row eligibility contracts.
- [ ] Run the focused tests and record the expected failures before implementation.

Command:

```powershell
node --test tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB5VideoCleanup.test.mjs tests/creatorPremiumMediaLifecycleC1.test.mjs
```

Expected: FAIL on missing CAS/fence/expiry/absence contracts and empty Stream DELETE handling.

## Task 2: Add the forward-only lifecycle authority

**Files:**

- Create via Supabase CLI: `supabase/migrations/<timestamp>_creator_premium_media_lifecycle_c1.sql`
- Modify: `tests/creatorPremiumMediaLifecycleC1.test.mjs`
- Add: `tests/creatorPremiumMediaLifecycleC1Local.integration.mjs`

- [ ] Confirm the installed Supabase CLI version/help, then create exactly one migration with `supabase migration new`.
- [ ] Persist R2 upload authorization expiry and C1 lifecycle contract markers without retroactively enrolling unknown historical rows.
- [ ] Extend terminal guards so `delete_pending`/`deleted` cannot be resurrected.
- [ ] Preserve canonical schedulers; add only a service-role boundary for the private Stream scheduler.
- [ ] Harden cleanup candidate selection for failed/unlinked R2 assets and recheck links under row locks.
- [ ] Use existing attempt counters as completion/retry fences.
- [ ] Add fenced completion/failure functions that atomically recheck links/identity, write a sanitized system-workflow audit receipt, and update lifecycle state.
- [ ] Revoke `PUBLIC`/`anon`/`authenticated`; grant only `service_role` to maintenance functions.
- [ ] Prove bind-first/delete-first, stale claim, idempotency, ownership, ACL, RLS, and Finance OFF with two disposable PostgreSQL sessions.

Expected: RED concurrency fixtures become GREEN; client roles remain denied.

## Task 3: Harden R2 issuance, finalize, and deletion

**Files:**

- Modify: `supabase/functions/create-media-upload/index.ts`
- Modify: `supabase/functions/finalize-media-upload/index.ts`
- Modify: `supabase/functions/delete-media-asset/index.ts`
- Modify: `supabase/functions/cleanup-stale-media-uploads/index.ts`
- Modify: `supabase/functions/_shared/r2.ts`
- Modify: focal tests from Task 1

- [ ] Persist the exact signed PUT expiry before returning the URL.
- [ ] Make finalize state changes compare-and-set and inspect selected rows; zero rows are stale, never ready success.
- [ ] Route mismatch/missing cleanup through the canonical scheduler rather than direct terminal writes.
- [ ] Make owner deletion schedule-only; the fenced cleanup worker owns provider mutation.
- [ ] Add independent origin `HEAD` absence verification and distinguish present/absent/retryable error.
- [ ] Finalize or fail only through fenced RPCs; increment counters only after confirmed database completion.
- [ ] Keep C1 tombstones eligible for the prescribed post-expiry recheck; never sweep legacy unknown rows.
- [ ] Re-run focused tests until GREEN.

## Task 4: Harden Stream allocation, callbacks, playback, and deletion

**Files:**

- Modify: `supabase/functions/_shared/stream.ts`
- Modify: `supabase/functions/create-stream-upload/index.ts`
- Modify: `supabase/functions/stream-webhook/index.ts`
- Modify: `supabase/functions/get-stream-playback/index.ts`
- Modify: `supabase/functions/delete-stream-video/index.ts`
- Modify: `supabase/functions/cleanup-stale-media-uploads/index.ts`
- Modify: focal tests from Task 1

- [ ] Add a dedicated bounded DELETE helper accepting empty successful responses and authoritative `404`.
- [ ] Add metadata-based absence verification with strict error classification.
- [ ] Persist allocation results only from an eligible reservation state; compensate/schedule a late UID without returning upload authority.
- [ ] Add status/UID CAS to webhook and playback writes and preserve original readiness timestamps.
- [ ] Make owner deletion call the canonical locking scheduler and leave provider work to cleanup.
- [ ] Fence Stream completion/retry by `delete_attempts`, recheck physical absence, and count only committed completions.
- [ ] Re-run focused tests until GREEN.

## Task 5: Add read-only provider reconciliation and retention evidence

**Files:**

- Add: `scripts/audit-creator-premium-media-inventory.mjs`
- Add: `tests/creatorPremiumMediaInventory.test.mjs`
- Add: `docs/creator-premium-media-retention-v1.md`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs` only if the strict read-only snapshot contract requires the new counters
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs` if adapter changes

- [ ] Implement paginated, read-only R2 and Stream inventory adapters with explicit scope checks.
- [ ] Compare exact provider/database identities and classify A–G without outputting keys or UIDs.
- [ ] Reject partial pages, wrong account/bucket/project, unknown objects, and missing retention evidence as indeterminate.
- [ ] Emit aggregate JSON suitable for a release artifact; never delete or download.
- [ ] Document retention without inventing legal time periods and explicitly preserve the eleven legacy rows.
- [ ] Add deterministic fixtures for every category, pagination, permissions, redaction, and zero-mutation behavior.

## Task 6: Full verification and independent review

**Files:** all changed files.

- [ ] Run focused RED/GREEN suites.
- [ ] Run the dedicated disposable PostgreSQL integration with concurrent sessions.
- [ ] Run Creator Premium, Stream, R2, Content Safety, Admin, Auth, cleanup, ownership, Finance, Release Gate, and Snapshot Adapter regressions.
- [ ] Run focal ESLint/TypeScript and `git diff --check`.
- [ ] Run the read-only provider inventory only if official read-only scopes are independently confirmed; otherwise record the exact blocked permission and do not infer inventory.
- [ ] Request an independent code/security review; fix all verified findings and repeat affected tests.

Core commands:

```powershell
node --test tests/creatorPremiumMediaLifecycleC1.test.mjs tests/creatorPremiumMediaInventory.test.mjs
node --test tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB5VideoCleanup.test.mjs tests/mediaConcurrencyHardening.test.mjs tests/mediaCleanupRetryBehavior.test.mjs
node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
git diff --check
```

Expected: all applicable tests PASS; any provider inventory without proven read-only scope is an explicit SKIP/BLOCK, never PASS.

## Task 7: Protected integration and canonical release

- [ ] Review the exact diff, migration, derived Edge dependency scope, and absence of secrets/artifacts.
- [ ] Commit focal changes and push `codex/creator-premium-media-lifecycle-c1` without force.
- [ ] Open a protected PR, obtain independent review/checks, and rebase-merge only through repository controls.
- [ ] Verify final `origin/main` SHA and tree.
- [ ] Dispatch canonical `plan_only` for the exact merged SHA and inspect the generated manifest.
- [ ] Obtain fresh physical backup and owner-dashboard auto-deploy-OFF evidence.
- [ ] Run `gate_proof`, then high-risk `release`, deploying only the one migration and transitively changed Edge functions.
- [ ] Run read-only postcheck: migrations, versions/digests, cron, RLS/ACL, Advisor delta, P3, Finance OFF, audit receipts, and no unknown release concurrency.
- [ ] Do not execute destructive reconciliation during release.

## Task 8: Final C1 report

- [ ] Report proven causes, files/diff, RED/GREEN evidence, SQL/Edge versions, PR/SHA/tree, release artifacts, read-only inventories, classifications, receipts, retention, Security Advisor, Finance/P3, costs, residual risks, and the `Que rica se ve mi cosita` case.
- [ ] Use `MEDIA_C1_READY_FOR_FINAL_AUDIT` only if concurrency risks are closed and physical absence has independent provider evidence. Otherwise use the exact partial/correction verdict and one minimal next action.
