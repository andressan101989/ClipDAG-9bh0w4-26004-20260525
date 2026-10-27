# Stories V2 Safety C1 Implementation Plan

**Goal:** Install and release an inactive, verifiable Story safety policy
candidate while closing evidence identity gaps and preserving fail-closed
publication.

**Global constraints:** one scanner, no P3 behavior change, no MEDIA-C1 change,
no financial change, no production inference, no Story publication, no policy
activation without exact owner approval.

## Task 1 — Candidate artifact and RED contract tests

Files:
- `docs/stories-v2-content-safety-policy-candidate-v1.json`
- `tests/storiesV2SafetyC1Database.test.mjs`

Write behavioral contract tests that fail until a new migration provides the
candidate digest, inactive control state, expanded author-text evidence,
current-fingerprint version, transcript-evaluation coverage, replay
preservation, and active-policy visibility fence. Run and record RED.

## Task 2 — Forward-only SQL implementation

Files:
- `supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql`

Implement only the functions described by the design. Preserve all historical
migrations. Run Task 1 GREEN and the existing Stories/Content Safety contract
suites.

## Task 3 — Disposable PostgreSQL proof

Files:
- `tests/storiesV2SafetyC1Local.integration.mjs`

Replay the checked-in B1 reduced baseline, B1, then C1 in disposable PostgreSQL.
Prove the inactive policy state, interactive text coverage, stale evidence
rejection, transcript-evaluation requirement, idempotent replay, owner-only
inspection, no third-party visibility, private ACL, rollback, and no `passed`
writer. Record limitations of the reduced fixture.

## Task 4 — Release governance transition

Files:
- `.github/nelyon-production-release-policy.json`
- `scripts/nelyon-production-release.mjs`
- `scripts/nelyon-production-snapshot-adapter.mjs`
- `tests/nelyonProductionReleaseGate.test.mjs`
- `tests/nelyonProductionSnapshotAdapter.test.mjs`

Add a distinct B1 fail-closed to C1 technical-prep fail-closed transition.
Require one exact migration, zero Edge Functions, unchanged config/P3/Finance,
the exact policy artifact digest, and inactive Story policy evidence. Preserve
the historical B1 transition and Advisor exceptions.

## Task 5 — Verification, review, PR, and protected release

Run focal SQL/Stories/Content Safety tests, PostgreSQL disposable tests, Release
Gate, Snapshot Adapter, ESLint/TypeScript where affected, and `git diff --check`.
Obtain independent code review. Create a protected PR, rebase-merge only after
checks pass, then run `plan_only`, `gate_proof`, backup/snapshot, HIGH release,
postcheck, separate baseline PR, and final `NO PRODUCTIVE CHANGES` plan.

If exact owner policy approval is still absent, production must end with
`activation=false`, `owner_approved_policy=false`, zero fabricated decisions,
and zero artificial Story publication.
