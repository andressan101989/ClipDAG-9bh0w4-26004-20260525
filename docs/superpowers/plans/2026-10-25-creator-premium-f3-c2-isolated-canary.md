# Creator Premium F3-C2 Isolated Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the canonical F3 monetary lifecycle with 3,000 synthetic BDAG and harden digest, closure and provenance governance without changing production.

**Architecture:** Extend only the existing F3 policy, authorization and financial-fact validators through one forward-only migration. Keep production structurally OFF; an isolated fixture registers synthetic approval evidence and authorization while all new integrity controls remain enabled.

**Tech Stack:** PostgreSQL 17, Supabase SQL migrations, Node.js `node:test`, Docker disposable Postgres, GitHub protected PR.

**Spec:** `docs/superpowers/specs/2026-10-25-creator-premium-f3-c2-isolated-canary-design.md`

## Global Constraints

- Base exactly `origin/main`; branch `codex/creator-premium-f3-c2-isolated-canary`.
- No production migration, flag activation, balance/account/data mutation, real receipt/subscription/refund, Edge deploy, Stripe, IAP/Play Billing, UI, P3 or MEDIA-C1 change.
- Purchase and subscription are each `1500.00000000 BDAG`; fee is exactly `2000` bps; synthetic funding is exactly `3000.00000000 BDAG`.
- Reuse all existing B4/B4-C1/F2/F3 ledger, receipt, period, entitlement and reconciliation authorities.
- Migration application alone must preserve Finance OFF and create no approval, authorization, receipt, period, transaction or ledger entry.
- No `session_replication_role=replica` in new F3-C2 integrity scenarios; disable only the named F3 foundation INSERT trigger and remove only the named foundation OFF check in the disposable clone.
- No merge or deploy in this phase. Push/open a protected PR only after independent review.

## Review Focus

- A self-supplied SHA or service-role JWT must not become approval authority; tests must reject absent/mismatched attestation and client/service access.
- Canonical bytes must remain stable across numeric scale and timezone spelling while every immutable field mutation changes the digest.
- Close/refund/charge races must preserve policy-then-authorization lock order and never permit a post-close charge or double reversal.
- Reconciliation must reject cross-authorization facts and copied-reference extra transactions while preserving valid historical rights.
- Applying the migration to an OFF database must remain OFF with zero economic side effects.

---

### Task 1: Establish RED governance and lifecycle contracts

**Files:**
- Create: `tests/creatorPremiumF3C2Governance.test.mjs`
- Create: `tests/creatorPremiumF3C2Local.integration.mjs`

**Interfaces:**
- Consumes: F3 migration contract and existing disposable Docker helpers.
- Produces: failing behavioral contracts for the C2 migration and full synthetic lifecycle.

- [x] Add static/runtime contracts for one C2 migration, unchanged foundation OFF state, canonical configuration/approval digests, immutable attestation ACL/RLS and exact lifecycle helper grants.
- [x] Add disposable fixtures with synthetic buyer/creator/platform accounts, eligible content/offer/plan, 3,000 buyer balance and truthful synthetic attestation.
- [x] Add RED assertions for purchase, subscription, 80/20 split, cancellation, close, two refunds, final OFF, final balances and reconciliation before/after each operation.
- [x] Add RED negative and two-session tests for digest mutation, replay, double charge/refund, identity/account/price mismatch, expiry, cap, reopening, rollback and close races.
- [x] Run both focused files and record failures caused by missing C2 migration/functions.

### Task 2: Implement the forward-only governance migration

**Files:**
- Create via Supabase CLI: `supabase/migrations/<generated>_creator_premium_f3_c2_isolated_canary_governance.sql`
- Modify tests from Task 1 only when a demonstrated contract correction is required.

**Interfaces:**
- Consumes: RED tests and F3 functions/tables.
- Produces: canonical digest helpers, immutable attestation evidence, one-way closure/finalizer, refund-only closed admission and F3 provenance reconciliation.

- [x] Add fixed-order length-prefixed configuration and approval payload/digest helpers with hardcoded golden vectors.
- [x] Add an empty private immutable owner-attestation table, exact composite binding, RLS/FORCE RLS, postgres ownership and zero client/service grants.
- [x] Add authorization insert integrity verification while retaining the named foundation INSERT blocker.
- [x] Replace the immutable guard only enough to permit exact `OPEN -> CLOSED` plus immutable closure metadata; reject reopen/delete/economic mutation.
- [x] Add owner-only policy-first close/finalize helpers with no `PUBLIC`/client/service execution.
- [x] Permit bound refunds in CLOSED refund-only mode; keep all charges OPEN-only and deadlines/counts/fences intact.
- [x] Strengthen authorization/fact/transaction/ledger provenance and reconciliation without adding another monetary authority.
- [x] Run focused tests until GREEN and confirm migration application alone stays OFF/empty.

### Task 3: Full isolated canary, regression, review and protected PR

**Files:**
- Modify: release/snapshot contract tests only if exact migration governance requires it.
- Add: evidence/report artifacts only under the git-ignored SDD workspace.

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: verified branch commit and protected PR, unmerged and undeployed.

- [x] Run PostgreSQL disposable full-chain lifecycle and concurrency suite; assert 3,000/600/2,400 results, 4 transactions, 12 balanced entries and zero residual inconsistent rights.
- [x] Run F3, F2 finance, Creator Premium, release-gate and snapshot regressions plus TypeScript/ESLint focal and `git diff --check`.
- [x] Verify production read-only remains 352 migrations, Finance OFF/fee 0, zero authorizations/real operations/movements, P3 active and MEDIA-C1 preserved.
- [x] Obtain independent spec/security/code review and resolve all Critical/Important findings.
- [ ] Commit focal files, push the named branch and open/attach a protected PR without merge or deployment.
