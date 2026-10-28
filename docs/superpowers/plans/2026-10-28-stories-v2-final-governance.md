# Stories V2 Final Governance Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonicalize Security Advisor evidence, deliver Stories Safety C2 through the protected release workflow, and finish with a verified production baseline and no pending productive changes.

**Architecture:** One snapshot-adapter projection accepts raw and grouped Advisor payloads and derives stable semantic identities. Baseline generation reuses the phase-effective exception resolver and the observed migration inventory, while release compilation and productive Stories code remain unchanged.

**Tech Stack:** Node.js ESM, `node:test`, Git/GitHub protected PRs, Supabase Management API, PostgreSQL read-only evidence, GitHub Actions release workflow.

**Spec:** `docs/superpowers/specs/2026-10-28-stories-v2-final-governance-design.md`

## Global Constraints

- Preserve every Security Advisor finding and severity; never suppress drift to make a gate pass.
- Preserve historical fingerprints and phase-bound predecessor attestations.
- Do not modify C2 SQL or Edge source unless a new verified defect requires it.
- Exact productive manifest: `20261027191918_stories_v2_safety_c2_publish_first_async_review.sql` plus `get-stream-playback`, `verify_jwt=true`, and nothing else.
- Preserve Finance GENERAL, Premium fee 2000 bps, LIVE Gifts 35%, Content Safety P3, MEDIA-C1, and LIVE Battles C1.
- No synthetic Stories, production inference, financial movement, direct push to `main`, force push, reset, clean, or prune.
- All repository changes use protected PRs and rebase merge.

## Review Focus

- Raw and grouped Advisor payloads representing the same 594 findings must produce byte-identical normalized inventories.
- A missing or tampered provider `cache_key` must not change identity; semantic object or severity changes must.
- Malformed group counts and duplicate semantic identities must fail closed rather than lose findings.
- Current Finance successor RPCs must replace only their exact historical predecessors and retain exact owner/search-path/ACL/definition evidence.
- A post-release owner baseline must recognize C2 from the observed migration inventory before the policy baseline is promoted.

---

### Task 1: Canonical Advisor normalization and phase-aware baseline

**Files:**
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs`
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs`

**Interfaces:**
- Consumes: raw `{ lints: [...] }` and grouped `{ lints: [{ count, findings, ... }] }` Advisor envelopes.
- Produces: `normalizeSecurityAdvisors(body)` with one stable inventory and `buildProductionBaselineDigests()` with installed-phase exceptions.

- [ ] **Step 1: Add failing tests for raw/grouped parity and malformed grouped inputs**

Assert equal count, item list, inventory digest and fingerprints; assert count mismatch and duplicate semantic identity throw `INVALID_REMOTE_INVENTORY`.

- [ ] **Step 2: Run the focused adapter tests and record RED evidence**

Run: `node --test --test-name-pattern="Security Advisor|baseline.*phase|Stories Safety C2" tests/nelyonProductionSnapshotAdapter.test.mjs`

- [ ] **Step 3: Implement canonical flattening and semantic cache identity**

Derive the legacy-compatible cache identity from lint name and stable metadata; never trust the supplied `cache_key` as authority.

- [ ] **Step 4: Add failing tests for phase-effective exceptions and observed C2 installation**

Assert the two F2 predecessor fingerprints cannot suppress current successor findings and that a complete post-C2 migration inventory selects C2 helper attestations.

- [ ] **Step 5: Use `advisorExceptionsForPhase()` from baseline construction and make observed migration state authoritative**

Preserve exact historical removed findings and RPC attestation validation.

- [ ] **Step 6: Run focused and full governance suites**

Run: `node --test tests/nelyonProductionSnapshotAdapter.test.mjs tests/nelyonProductionReleaseGate.test.mjs`

- [ ] **Step 7: Commit the implementation and tests**

Commit message: `fix: canonicalize production advisor evidence`

### Task 2: Fresh pre-release baseline and protected governance integration

**Prerequisite:** Task 1 has been independently reviewed, merged by protected
rebase, and `origin/main` identifies the immutable adapter bytes used for this
capture. Task 2 runs from a new branch at that integrated SHA.

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`
- Create: `docs/superpowers/specs/2026-10-28-stories-v2-final-governance-design.md`
- Create: `docs/superpowers/plans/2026-10-28-stories-v2-final-governance.md`

**Interfaces:**
- Consumes: fresh read-only owner-control-plane snapshot normalized by Task 1.
- Produces: seven exact baseline section digests and protected policy bytes for the current pre-C2 production state.

- [ ] **Step 1: Run a fresh official `plan_only` from the integrated governance SHA**

Require a new request and manifest bound to the merged adapter. Do not reuse run
`40575648640` or its old adapter digest.

- [ ] **Step 2: Capture fresh read-only migrations, functions, cron/security, RPC, Finance, health, and backup evidence**

Require ACTIVE_HEALTHY, 359 migrations, 34 ACTIVE Edge Functions, C1 latest, Finance GENERAL, and zero unknown reconciliation deltas.

- [ ] **Step 3: Generate and verify all seven baseline digests with the corrected adapter**

Reject any unknown difference instead of editing expected values manually.
Retain `baseline.sha=e4c7199da157446f455822ea96e812784354b1db`,
`migration_count=359`, and C1 as `latest_migration`, so the C2 productive delta
remains visible.

- [ ] **Step 4: Update only the owner-reviewed evidence fields and exact assertions**

Keep the C2 manifest, transition, Finance, P3, MEDIA-C1 and LIVE Battles contracts unchanged.

- [ ] **Step 5: Run release-governance tests, `git diff --check`, and independent review**

Expected: zero Critical or Important findings.

- [ ] **Step 6: Commit, push, create a separate protected baseline PR, verify checks, and rebase merge**

- [ ] **Step 7: Recalculate Git-LF policy SHA-256 on integrated `origin/main`, update only `NELYON_RELEASE_POLICY_SHA256`, and verify readback**

### Task 3: Protected C2 production release and postcheck

**Files:**
- No repository changes unless recovery evidence proves a new defect.

**Interfaces:**
- Consumes: integrated governance SHA and exact C2 productive manifest.
- Produces: applied C2 migration, deployed `get-stream-playback`, and verified productive postcheck.

- [ ] **Step 1: Run fresh `plan_only` and verify exact SHA, manifest and policy digest**

- [ ] **Step 2: Run fresh `gate_proof` and require `GATE_VERIFIED`, backup, snapshot, no drift, and no concurrent release**

- [ ] **Step 3: Run release HIGH through the canonical workflow**

- [ ] **Step 4: Verify 360 migrations, 34/34 Edge ACTIVE, exact Edge digest/config, publish-first state, durable async moderation, alert/admin contracts, and preserved cross-system invariants**

### Task 4: Final production baseline and closure evidence

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs` only where exact final baseline evidence requires it.

**Interfaces:**
- Consumes: successful C2 postcheck and fresh owner-control-plane production snapshot.
- Produces: separately merged final baseline and final `NO PRODUCTIVE CHANGES` plan.

- [ ] **Step 1: Capture fresh post-release owner evidence and regenerate all seven digests**

- [ ] **Step 2: Create, review, merge the separate baseline PR, then synchronize and read back the final policy digest**

- [ ] **Step 3: Run final `plan_only` and require `NO PRODUCTIVE CHANGES`**

- [ ] **Step 4: Prepare the two-device plus Super Admin physical QA matrix without fabricating PASS**

- [ ] **Step 5: Deliver the final consolidated report with only verified claims**
