# Creator Premium Content Safety P2 Implementation Plan

> **Execution mode:** Native inline execution with `superpowers:executing-plans`.
> The owner's P2 prompt is the approved design and execution authorization.

**Goal:** Close every technically demonstrable P1 evidence gate, prove the
private-media path, and activate the general policy only if all seven gates pass.

**Architecture:** Add one context-evidence stage to the canonical
`content-safety-scan` worker, backed by private SQL evidence and service-only
claim/complete/fail RPCs. Deploy it disabled, verify it live, then create a
separate forward-only activation revision only if the evidence is complete.

**Spec:** `docs/superpowers/specs/2026-10-18-creator-premium-content-safety-p2-design.md`

## Global constraints

- No +18 Premium, new provider, scanner, queue authority, financial authority,
  public media exposure, or unsafe publication.
- No live inference until official Cloudflare quota/headroom is observed.
- Existing QA media only; no new paid uploads.
- P1 stays disabled until all seven gates are demonstrated.
- Production changes use only `.github/workflows/nelyon-production-release.yml`.

### Task 1: Baseline and seven-gate evidence contract

**Files:**
- Create: `docs/creator-premium-content-safety-p2-evidence-v1.json`
- Create: `tests/creatorPremiumContentSafetyP2.test.mjs`

- [ ] Record the verified P1 baseline and exact seven blockers.
- [ ] Add RED tests for the strict contextual schema, coverage, age/consent
      limits, discrete uncertainty, and activation fail-close.
- [ ] Add the minimal evidence contract and make the tests GREEN.
- [ ] Commit the task.

### Task 2: Context classifier and bounded provider probe

**Files:**
- Create: `supabase/functions/content-safety-scan/policyContext.mjs`
- Modify: `supabase/functions/content-safety-scan/index.ts`
- Modify: `tests/creatorPremiumContentSafetyP2.test.mjs`

- [ ] Add RED contract tests for contextual text/transcript, negation,
      quotation, education, ambiguity, severe categories, malformed responses,
      refusal, truncation, and bounded telemetry.
- [ ] Implement one forced strict function call and its validator.
- [ ] Add a fixed synthetic service-role probe; never include private media.
- [ ] Integrate one bounded context claim into the existing worker.
- [ ] Run focal tests to GREEN and commit.

### Task 3: Private evidence persistence and candidate decision

**Files:**
- Create: `supabase/migrations/20261018170000_creator_premium_content_safety_p2_evidence_runtime.sql`
- Create: `tests/creatorPremiumContentSafetyP2Local.integration.mjs`
- Modify: `tests/creatorPremiumContentSafetyP2.test.mjs`

- [ ] Add RED SQL contract/disposable tests for the private evidence table,
      service-only RPCs, exact bindings, leases, retry limit, idempotency,
      RLS/ACL, and candidate allow/review/block decisions.
- [ ] Implement the smallest forward-only evidence runtime. Do not activate P1.
- [ ] Run PostgreSQL disposable and focal regression suites to GREEN.
- [ ] Commit the task.

### Task 4: Protected technical release and live evidence

- [ ] Run Premium, Content Safety, Stream, Release Gate, Snapshot Adapter,
      TypeScript/lint focal, and `git diff --check`.
- [ ] Self-review the whole branch; resolve every Critical/Important issue with
      RED-to-GREEN evidence.
- [ ] Push the requested branch, open a protected PR, verify checks, and merge.
- [ ] Run canonical `plan_only`, `gate_proof`, and release for exactly the P2
      evidence migration and `content-safety-scan`.
- [ ] Verify quota evidence, run no more than five bounded inference calls,
      execute the synthetic context probe, and reuse existing authorized QA
      scans for the private E2E.
- [ ] Record demonstrated versus blocked gates. Keep P1 disabled if any gate
      remains open.

### Task 5: Conditional activation revision

**Files (only if all seven gates pass):**
- Create: `docs/creator-premium-content-safety-policy-general-p1-v2.json`
- Create: `supabase/migrations/20261018190000_creator_premium_content_safety_p2_activation.sql`
- Modify: P2 tests and disposable integration coverage.

- [ ] Add RED tests for exact activation evidence, zero blockers, decision
      bindings, ALLOW-only auto-publication, REVIEW/BLOCK privacy, and reversible
      forward-only disable semantics.
- [ ] Implement the activation revision and make tests GREEN.
- [ ] Protected PR/merge and canonical migration-only release.
- [ ] Verify production policy, rules, private decisions, advisor delta,
      Finance OFF, reconciliation, legacy data, and zero unsafe publication.

### Task 6: Final verification and report

- [ ] Run fresh local and production verification; no cached PASS claims.
- [ ] Verify final SHA/tree, migrations, Edge versions/digests, snapshots,
      Security Advisor, RLS/ACL, Finance `false/false/false/0`, and 10/10 zero
      reconciliation anomalies.
- [ ] Report each gate as DEMONSTRATED or BLOCKED, real versus simulated tests,
      inference count/cost, production state, and the exact physical-QA step.

