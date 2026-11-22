# WEB-CONTROL-CENTERS-B2-R2 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prepare a fail-closed local B2 candidate with the canonical automatic
cron wake, complete tests and no remote or production mutation.

**Architecture:** PostgreSQL schedules one wake and reads the established Vault
dispatch credentials; pg_net invokes the existing Edge worker. The existing
database scheduler remains authoritative, while the descriptor remains a
non-releasable candidate until later protected authority recovery.

**Tech Stack:** PostgreSQL 17, pg_cron, pg_net, Supabase Vault/Edge Functions,
TypeScript/Deno, Node test runner, release-governance JSON.

**Spec:** `docs/superpowers/specs/2026-11-21-b2-r2-release-readiness-design.md`

## Global Constraints

- Base is `f92f8cbc6b2cdffc2e7688a95545d4b69bdbf56c`; original candidate is
  `758d076ab2d79102e7b5d06b932a8d86f0be7baa`.
- Local commits only: no push, PR, merge, release or production mutation.
- No credentials in source, no new secret, no service-role credential in SQL.
- Preserve the original worktree and all seven untracked WIP paths.
- Reuse one scheduler, worker, publisher, draft and media authority.
- Run canonical tests under Node 24.21.0 or report the exact runtime blocker.

## Review Focus

- Publishable-only HTTP calls must remain unauthorized.
- A missing Vault entry/extension or duplicate cron row must fail closed.
- A pre-existing canonical job must be restored in place without duplication.
- Candidate metadata must never claim integrated identity or private authority.
- Concurrent wakes must preserve exactly-once observable publication.

---

### Task 1: Pin cron and endpoint behavior with RED tests

**Files:**
- Modify: `tests/webControlCentersB2ScheduledPublishing.test.mjs`
- Modify: `tests/webControlCentersB2Worker.test.mjs`
- Modify: `tests/nelyonB2ReleaseDescriptor.test.mjs`

- [ ] Add behavior tests for exact cron identity, schedule, command, missing
      infrastructure/secrets, duplicate rejection and safe reapply.
- [ ] Add endpoint tests for service-role compatibility, correct dispatch
      credential, and rejection of publishable-only/wrong-secret requests.
- [ ] Add descriptor tests for candidate cron=true and approved cron=false
      rejection while preserving the historical fixture.
- [ ] Run focused tests and record the expected RED failures.

### Task 2: Implement the minimal canonical wake

**Files:**
- Modify: `supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql`
- Modify: `supabase/functions/process-scheduled-publications/index.ts`

- [ ] Add the fully qualified wake function and one-minute idempotent pg_cron
      registration without literal credentials.
- [ ] Extend only the existing Edge entrypoint with the established dispatch
      secret contract.
- [ ] Run focused worker/source tests GREEN.
- [ ] Run the disposable PostgreSQL proof and cron/security scenarios.

### Task 3: Renew public candidate metadata without fabricating authority

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `.github/nelyon-web-control-centers-b2-release-descriptor.json`
- Modify only as required by current-byte tests: B2 fixtures and governance tests

- [ ] Make approved descriptors require cron=true while retaining historical
      candidate compatibility.
- [ ] Recompute productive blob/SHA-256/length and public contract digest.
- [ ] Set current descriptor candidate/release_ready=false with all protected
      future facts null.
- [ ] Run descriptor, manifest, closure and release-gate tests GREEN.

### Task 4: Full local verification and independent review

**Files:**
- Modify only for defects reproduced by a failing test.

- [ ] Run all B2 tests, B1 regressions, SQL disposable, security, worker,
      concurrency, fencing, retry, cancellation, MEDIA-C1 and Content Safety.
- [ ] Run TypeScript, focal ESLint, source parity, runtime closure, manifest,
      authority-pin and release-preflight tests under Node 24.21.0.
- [ ] Run `git diff --check`, secret scan, exact file inventory and prove no
      remote/production mutation.
- [ ] Obtain an independent whole-branch review and resolve every
      Critical/Important finding with RED/GREEN evidence.
- [ ] Commit only the local R2 candidate and report remaining integration,
      auto-deploy, backup and authority prerequisites.
