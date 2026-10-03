# ALGO-6-L2 Creator Affinity V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic viewer-to-creator affinity to the existing organic Feed ranking authority while leaving L2 disabled and all production users chronological.

**Architecture:** Extend the existing private policy and canonical ranking RPC. The RPC aggregates bounded viewer history for candidate creators in set-based CTEs, clamps per-video and creator contributions, and adds the result to the unchanged L1 score only when L2 is enabled. The existing reconciler and thin client are extended without adding a parallel authority.

**Tech Stack:** PostgreSQL 17/Supabase RPC and RLS, TypeScript, Node test runner, disposable PostgreSQL integration tests.

**Spec:** `docs/superpowers/specs/2026-10-02-algo6-l2-creator-affinity-design.md`

## Global Constraints

- Create exactly one migration with `supabase migration new algo6_l2_creator_affinity`; committed and production versions must match.
- Preserve one `private.algo_l1_policy`, one `public.get_ranked_feed_l1_v1`, one Feed ranking service, one playback authority, and one eligibility authority.
- Production remains `policy_version=nelyon-algo-l1-v1`, `l2_affinity_enabled=false`, rollout zero, canary disabled, generation 2.
- Do not retune L1 scoring, cursor, candidate pool, diversity, eligibility, Ads insertion, finance, Stripe, Marketplace, Stories, LIVE, or native builds.
- No affinity table, cache, materialized view, second RPC, Edge Function, client scorer, AI, ML, embeddings, or L3 behavior.

## Review Focus

- Repeated comments or playback loops on one video must not bypass per-video caps.
- A signal newer than `feed_as_of` must not change a continuation page.
- One accidental short watch must not create creator-level negative affinity.
- Self activity, anonymous sessions, and signals for non-candidate creators must contribute zero.
- Enabling or changing any L2 policy field without a policy-version change must fail closed.

---

### Task 1: L2 static contract and dormant policy extension

**Files:**
- Create: `tests/algo6L2CreatorAffinity.test.mjs`
- Create: `supabase/migrations/<generated>_algo6_l2_creator_affinity.sql`

**Interfaces:**
- Consumes: current `private.algo_l1_policy`, guard, ranking RPC, and reconciler.
- Produces: constrained dormant L2 columns and static single-authority guarantees.

- [x] Write the static test for one migration, policy defaults/constraints, guard coverage, no affinity tables/RPCs, unchanged ACL/security, reconciler keys, and forbidden Ads/finance/follow affinity inputs.
- [x] Run it and verify RED because the L2 migration does not exist.
- [x] Generate the migration with the Supabase CLI.
- [x] Add only the policy extension and minimal security-preserving DDL needed for the test.
- [x] Run the static test and verify the policy contract becomes GREEN.

### Task 2: Set-based creator affinity in the canonical ranking RPC

**Files:**
- Modify: `supabase/migrations/<generated>_algo6_l2_creator_affinity.sql`
- Create: `tests/algo6L2CreatorAffinityLocal.integration.mjs`

**Interfaces:**
- Consumes: candidate creator IDs and canonical viewer likes/comments/saves/video_views.
- Produces: bounded `creator_affinity_points` and `behavioral_l2` mode inside the existing RPC.

- [x] Write disposable tests for L1-disabled parity and numeric positive/negative/decay/cap/self/anon/follow/non-candidate behavior.
- [x] Run them and verify RED because affinity is not implemented.
- [x] Add set-based signal, per-video, negative-gate, and creator aggregate CTEs; add affinity to the unchanged L1 score only when enabled.
- [x] Extend the existing reconciler with the four L2 checks and preserve ACL/search path.
- [x] Run static and disposable tests and verify GREEN.

### Task 3: Snapshot, performance, and thin-client contract

**Files:**
- Modify: `tests/algo6L2CreatorAffinityLocal.integration.mjs`
- Modify: `tests/algo6L2CreatorAffinity.test.mjs`
- Modify: `services/feedRankingService.ts`

**Interfaces:**
- Consumes: existing cursor contract and RPC response.
- Produces: stable L2 continuation behavior, representative EXPLAIN proof, and `behavioral_l2` client acceptance.

- [x] Add failing tests for post-snapshot signal exclusion, candidate boundary, representative indexed viewer-history plans, and the new response mode.
- [x] Run and verify RED.
- [x] Add only the TypeScript mode literal and any SQL/index change proven necessary by EXPLAIN.
- [x] Run L2 tests plus L1/F0/Canary regressions and changed-file lint; verify GREEN or classify unrelated debt.

### Task 4: Review, commit, push, deploy, and verify dormant production

**Files:**
- Modify only for Critical/Important review findings, each with a failing test first.

**Interfaces:**
- Consumes: the complete L2 branch.
- Produces: one committed/deployed migration, repository-production version parity, zero reconciliation findings, and a clean remote branch.

- [x] Review the whole branch for formula correctness, L1 parity, snapshot safety, SQL privilege boundaries, duplicate authorities, Ads/finance isolation, and query bounds.
- [x] Run all required static/integration/regression/performance checks and advisors.
- [ ] Commit and push the final migration before deployment; verify the remote filename and content hash.
- [ ] Deploy exactly that committed migration and verify migration 314, dormant policy, chronological anonymous dry-run, zero reconciliation findings, data/finance invariance, and advisor deltas.
- [ ] Run final Git verification and prove local HEAD equals remote SHA.
