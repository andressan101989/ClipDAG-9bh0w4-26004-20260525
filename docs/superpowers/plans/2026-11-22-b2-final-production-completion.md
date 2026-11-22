# WEB-CONTROL-CENTERS-B2-FINAL Production Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> and superpowers:test-driven-development task-by-task. Steps use checkbox
> syntax for tracking.

**Goal:** Correct the protected release gaps, bind the exact integrated B2
bytes, obtain the required post-observation owner approval, and deploy B2 with
canonical postcheck and baseline closure.

**Architecture:** The existing PostgreSQL scheduler and Edge worker remain the
only publication authorities. The release workflow gains protected observation
and issuance paths; the ordinary release path remains a read-only consumer of a
digest-addressed private authority object. Eight Edge source closures are
deployed and reconciled with per-function provider receipts.

**Tech Stack:** Node.js 24.21.0, GitHub Actions, Supabase Management API,
PostgreSQL 17, pg_cron, pg_net, Vault, Deno Edge Functions and Cloudflare R2.

**Spec:** `docs/superpowers/specs/2026-11-22-b2-final-production-completion-design.md`

## Global Constraints

- Start from integrated SHA `109395035d13ba3db8d338dc3b2524191defe873`.
- Use committed Git-LF bytes for productive source identities.
- Never log/export secrets or private authority/provider response bodies.
- No release mutation before fresh backup, parity and specific owner approval.
- No direct/manual production deployment outside the canonical workflow.
- Preserve all unrelated worktrees, Finance, Wallet, ledger and existing
  product authorities.
- Any changed byte requires fresh review and downstream identity recomputation.

## Review Focus

- Partial Edge batches must never be recoverable as success.
- The parity result must be point-in-time, non-oracular and fully redacted.
- Owner approval must be authenticated, post-observation, digest-bound,
  one-use and non-replayable.
- The issuer may only create the digest-derived object and must prove readback.
- Descriptor, closure and protected pins must bind the same final integrated
  identity without circular authority dependencies.

---

### Task 1: Make the eight-function manifest and recovery proof exact

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `scripts/nelyon-b2-explicit-connection.mjs`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs`
- Modify: `scripts/nelyon-b2-recovery-provenance.mjs` only if required
- Modify: existing B2 manifest/source/recovery tests and fixtures

- [ ] Add RED tests for Git-LF source/config reproduction, seven replacements
      plus one enrollment, ordered exact receipts, timeout on the fourth slug,
      intermediate inventory refresh and missing/reordered receipt rejection.
- [ ] Change source hashing to consume committed Git-LF bytes and verify the
      upload tree is byte-identical.
- [ ] Record per-slug completion only after authenticated provider readback;
      reconcile completed prefix and indeterminate slug on failure.
- [ ] Require the exact eight-row proof in normal postcheck and historical
      recovery while retaining source/package identity separation.
- [ ] Run focused manifest, source parity, deployment and recovery tests GREEN.

### Task 2: Add a protected read-only backup and Vault/Edge observation path

**Files:**
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs`
- Modify: `scripts/nelyon-private-authority-cli.mjs`
- Modify: `.github/workflows/nelyon-production-release.yml`
- Modify: existing authority/workflow/snapshot tests

- [ ] Add RED tests for backup eligibility, parity match/mismatch, missing or
      duplicate bindings, malformed digests, provider rotation, permission
      denial, expiration and success/failure redaction canaries.
- [ ] Implement a terminal read-only observation mode using the pinned project,
      Edge secret name and fixed bound-parameter SQL for the Vault-side one-time
      tag; reread Edge metadata before accepting equality.
- [ ] Emit only allowlisted observation metadata and the canonical
      pre-issuance digest; never retain digests, nonce, tags or provider bodies.
- [ ] Prove the path cannot invoke migration, Edge deployment, cron, finance or
      issuer operations.
- [ ] Run focused snapshot, authority CLI and workflow tests GREEN.

### Task 3: Add authenticated one-use approval and immutable authority issuance

**Files:**
- Modify: `scripts/nelyon-private-authority-provider.mjs`
- Modify: `scripts/nelyon-private-authority-runtime.mjs`
- Modify: `scripts/nelyon-private-authority-cli.mjs`
- Modify: `.github/workflows/nelyon-production-release.yml`
- Modify: existing authority/provider/runtime/workflow tests

- [ ] Add RED tests for missing/replayed approval, changed evidence after
      approval, create-only digest path, duplicate/timeout readback and output
      redaction.
- [ ] Add a purpose-specific protected approval contract bound to the exact
      pre-issuance digest and verified owner identity after observation.
- [ ] Assemble and validate the existing strict private envelope in memory.
- [ ] Add a separate create-only R2 publisher with exact conditional PUT and
      mandatory exact readback; preserve the ordinary read-only provider.
- [ ] Make issuance a terminal mutually exclusive workflow path whose public
      outputs contain only allowlisted receipts.
- [ ] Run authority parser/provider/runtime/CLI/workflow suites GREEN.

### Task 4: Integrate reviewed bytes and generate protected release metadata

**Files:**
- Modify only the descriptor, policy/closure fixtures, workflow and runbook
  artifacts demanded by current-byte tests.

- [ ] Run exact Node 24.21.0 suites, PostgreSQL disposable/pg_cron, B2 worker,
      concurrency/fencing, security, MEDIA-C1, source parity, recovery,
      descriptor, closure, ESLint, TypeScript and `git diff --check`.
- [ ] Obtain independent specification-compliance and code-quality reviews and
      resolve every Critical/Important finding with new RED/GREEN evidence.
- [ ] Commit/push only reviewed files, open a protected PR, satisfy checks and
      integrate without bypass; capture final SHA/tree and content equivalence.
- [ ] Compile the final eight-function source/config rows and public descriptor
      from the integrated Git-LF bytes; integrate authorization metadata through
      a second protected PR only if the canonical contract requires it.

### Task 5: Observe production and obtain the mandatory specific approval

**Files:** No repository edits unless Task 4 proves protected metadata is needed.

- [ ] Confirm no concurrent release, project health, migration/Edge/cron
      prestate and no unknown drift.
- [ ] Execute exactly one protected read-only observation for the freshest
      eligible physical backup and Vault/Edge parity.
- [ ] Present only the minimal canonical evidence and exact pre-issuance digest
      to the owner; stop issuance until an explicit approval is received after
      this observation.
- [ ] On approval, verify actor, digest, freshness and one-use status; otherwise
      preserve all progress and report the single external action required.

### Task 6: Issue authority, prove gates and release B2

**Files:** Protected metadata only if the canonical workflow requires a PR.

- [ ] Issue/read back the content-addressed private authority; update protected
      pins through reviewed Git integration and rebind final identities.
- [ ] Run fresh `plan_only` and `gate_proof`; verify exact SHA, one migration,
      eight functions, one cron and no unrelated resources.
- [ ] Run release HIGH once through the canonical workflow and monitor to a
      terminal result; use only canonical recovery if partial mutation occurs.
- [ ] Verify migration exactly once, 35 active functions, all eight exact
      deployment receipts, one active one-minute cron, postcheck, security and
      zero financial/artificial-publication effects.
- [ ] Promote the fresh baseline via protected PR, synchronize policy digest,
      and run a final plan proving `NO PRODUCTIVE CHANGES`.
- [ ] Refresh Expo/Metro from the final integrated SHA for owner physical QA;
      never claim physical PASS without the owner's observation.
