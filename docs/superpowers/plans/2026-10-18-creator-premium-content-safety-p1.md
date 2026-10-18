# Creator Premium Content Safety P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version the approved general Creator Premium policy, integrate a fail-closed canonical decision engine, and deploy it with operational activation pending unresolved evidence gates.

**Architecture:** Preserve the existing Content Safety scanner and Creator Premium lifecycle. Add a Git policy artifact plus private SQL policy/decision functions in one forward-only migration, and replace only the existing finalizer implementation so it consumes the canonical decision. No Edge Function changes are required.

**Tech Stack:** PostgreSQL 15/17 PL/pgSQL, Supabase migrations, Node.js test runner, canonical Nelyon release workflow.

**Spec:** `docs/superpowers/specs/2026-10-18-creator-premium-content-safety-p1-design.md`

## Global Constraints

- Explicit adult Premium remains disabled and out of scope.
- Policy approval does not imply operational activation or publication authority.
- No new provider, scanner, queue, cron, public RPC, financial authority, or client architecture.
- Finance remains `purchase=false`, `subscription=false`, `refunds=false`, `platform_fee_bps=0`.
- Production changes use only `.github/workflows/nelyon-production-release.yml`.
- No external inference probes without verified quota/headroom.

## Review Focus

- A disabled policy must never yield `allow` or publish.
- A text phrase signal must route to review, never become a context-free block.
- Missing video transcript coverage must fail closed.
- Explicit-adult scope must remain false regardless of other settings.
- A stale scan or fingerprint must never be reclassified by the P1 decision function.

---

### Task 1: Version the owner-approved policy

**Files:**
- Create: `docs/creator-premium-content-safety-policy-general-v1.json`
- Create: `tests/creatorPremiumContentSafetyP1.test.mjs`

**Interfaces:**
- Produces: immutable policy identity, decision matrices, activation blockers, and SHA-256 consumed by Task 2.

- [ ] Write tests for exact allow/review/block matrices, explicit-adult exclusion, normative approval, and operational activation pending.
- [ ] Run the tests and verify they fail because the artifact is absent.
- [ ] Add the minimal canonical policy artifact.
- [ ] Run the tests and verify they pass.
- [ ] Commit the task.

### Task 2: Add the private decision engine and finalizer integration

**Files:**
- Create: `supabase/migrations/20261018120000_creator_premium_content_safety_p1_policy_gate.sql`
- Modify: `tests/creatorPremiumContentSafetyP1.test.mjs`

**Interfaces:**
- Consumes: policy SHA-256 and matrices from Task 1.
- Produces: `private.creator_premium_content_safety_policy_p1_v1()` and `private.creator_premium_content_safety_decision_p1_v1(uuid)`; replaces `private.finalize_creator_premium_safety_scan_v1(uuid)`.

- [ ] Add failing contract tests for private ACLs, exact decisions, disabled-policy fail-close, phrase-review behavior, severe block behavior, and preserved finalizer fences.
- [ ] Run the tests and verify the intended failures.
- [ ] Implement the smallest forward-only migration satisfying the tests.
- [ ] Run focal tests and verify green.
- [ ] Extend the disposable Premium harness with P1 installation and negative-state assertions.
- [ ] Run the disposable PostgreSQL harness and verify green.
- [ ] Commit the task.

### Task 3: Regression, review, and protected integration

**Files:**
- Modify only files proven necessary by failing regression or release tests.

**Interfaces:**
- Consumes: Task 1 policy artifact and Task 2 migration.
- Produces: reviewed branch merged through a protected PR.

- [ ] Run Premium, Content Safety, Stream, Release Gate, Snapshot Adapter, lint focal, and `git diff --check`.
- [ ] Generate the whole-branch review package and obtain a fresh code review.
- [ ] Resolve every Critical/Important finding with RED→GREEN evidence.
- [ ] Push the focal branch, open the protected PR, verify the diff/checks, and rebase-merge.
- [ ] Verify final `origin/main` SHA/tree and policy/migration blobs.

### Task 4: Canonical release and production postcheck

**Files:**
- No additional source changes unless a reproducible gate defect is found.

**Interfaces:**
- Consumes: exact merged SHA and migration manifest.
- Produces: plan/gate/release artifacts and a production postcheck report.

- [ ] Run `plan_only` and verify exactly one migration and zero Edge Functions.
- [ ] Run `gate_proof`; verify backup, snapshots, Finance OFF, auto-deploy OFF, and no concurrent release.
- [ ] Run the authorized release through the production Environment.
- [ ] Verify migration count, policy runtime, rule counts, Security Advisor, Finance, legacy data, and zero unsafe publication.
- [ ] Report real versus simulated evidence and the exact physical-QA action.

