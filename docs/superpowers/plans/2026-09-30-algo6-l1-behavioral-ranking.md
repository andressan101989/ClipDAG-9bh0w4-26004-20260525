# ALGO-6-L1 Behavioral Ranking V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Feed's direct chronological candidate query with one secure server-side behavioral L1 authority while production remains at zero-percent rollout.

**Architecture:** A private singleton policy configures one set-based PostgreSQL RPC that performs eligibility, bounded candidate generation, behavioral scoring, diversity and stable snapshot pagination. A thin client validates and maps RPC rows; FeedContext owns only delivery state and leaves sponsored insertion downstream.

**Tech Stack:** PostgreSQL 17/Supabase RLS and RPC, TypeScript/React Native, Supabase JS, Node test runner, disposable PostgreSQL integration tests.

**Spec:** `docs/superpowers/specs/2026-09-30-algo6-l1-behavioral-ranking-design.md`

## Global Constraints

- Create exactly one forward-only migration with `supabase migration new algo6_l1_behavioral_ranking`.
- Production policy is enabled with `production_rollout_bps=0`; never activate real users.
- Keep one organic Feed authority, one L1 policy, one ranking RPC, one raw playback authority and one eligibility authority.
- No L2 affinity, topics, ML, AI, embeddings, vectors, permanent score/feed tables or recommendation Edge Function.
- Do not modify Ads V2, Ads finance, Stripe, ledger, Marketplace finance, Stories ranking, LIVE ranking or native builds.
- Eligibility precedes scoring; Ads insertion follows organic ranking and never enters the score.
- Use raw likes/comments/saves/video_views, never aggregate views/shares or Ads events as behavioral authority.

## Review Focus

- A malformed, mixed or expired cursor must fail closed without exposing a row outside eligibility.
- Stable replay with identical viewer/session/as-of/policy/data must preserve score order and exploration.
- A single-creator catalog must fill a page even though pass one applies a creator cap.
- Anonymous rows must use only their supplied session UUID and never merge behavioral identity across sessions.
- Concurrent auth-generation changes must not let stale ranked rows overwrite the new viewer's Feed.

---

### Task 1: Policy, ranking authority and reconciliation

**Files:**
- Create: `tests/algo6L1BehavioralRanking.test.mjs`
- Create: `tests/algo6L1BehavioralRankingLocal.integration.mjs`
- Create: `supabase/migrations/<generated>_algo6_l1_behavioral_ranking.sql`

**Interfaces:**
- Consumes: F0 `public.video_views`, `private.video_can_view_owner(uuid)`, moderation authority and raw social tables.
- Produces: `private.algo_l1_policy`, `public.get_ranked_feed_l1_v1(...)`, `public.reconcile_algo_l1_v1()`.

- [ ] Write static and disposable tests covering policy domains, exact scoring, eligibility-before-score, cold start, deterministic hashes/rollout, diversity, cursor validation, ACLs and reconciliation.
- [ ] Run both tests and verify RED because the migration and functions do not exist.
- [ ] Generate the single migration with the Supabase CLI and implement the minimum SQL authority and justified indexes.
- [ ] Run the tests and verify GREEN, including 0-bps chronological and 10,000-bps behavioral modes.
- [ ] Commit Task 1.

### Task 2: Thin ranking client and cursor contract

**Files:**
- Create: `services/feedRankingService.ts`
- Test: `tests/algo6L1BehavioralRanking.test.mjs`

**Interfaces:**
- Consumes: Task 1 RPC rows and `mapVideoRow`.
- Produces: `fetchRankedFeedPage(client, request)`, `RankedFeedCursor`, and a validated `RankedFeedPage`.

- [ ] Add tests for exact RPC arguments, row validation/mapping, cursor construction, empty results and malformed response failure.
- [ ] Run the focused test and verify RED because the client does not exist.
- [ ] Implement the client without scoring, fallback candidate queries or Ads behavior.
- [ ] Run the focused test and verify GREEN.
- [ ] Commit Task 2.

### Task 3: FeedContext integration and orphaned keyset removal

**Files:**
- Modify: `contexts/FeedContext.tsx`
- Delete: `services/feedKeyset.ts`
- Modify: `tests/algo6L1F0SignalEligibility.test.mjs`
- Test: `tests/algo6L1BehavioralRanking.test.mjs`

**Interfaces:**
- Consumes: Task 2 ranked pages.
- Produces: one RPC-backed organic Feed flow with refresh/auth snapshot reset and generation fencing.

- [ ] Add tests proving candidate loading uses only the ranking client/RPC, continuations preserve cursor, refresh/auth changes reset it, direct exact-ID resolution remains RLS-bound, and failures fabricate no content.
- [ ] Run the tests and verify RED against the direct `.from('videos')` candidate loader.
- [ ] Replace only candidate loading, preserve interaction/deep-link behavior, and remove the now-orphaned F0 client keyset helper.
- [ ] Run F0, L1, Feed, Profile, Stories and Ads social regressions and verify no L1 regression.
- [ ] Commit Task 3.

### Task 4: Representative performance and full regression proof

**Files:**
- Modify only the L1 integration test if additional representative fixtures or EXPLAIN assertions are required.

**Interfaces:**
- Consumes: completed database/client authority.
- Produces: synthetic-volume EXPLAIN proof and classified repository-wide test output.

- [ ] Load thousands of synthetic candidates/signals only into disposable PostgreSQL and assert bounded candidate/index/set-based plan properties.
- [ ] Run lint, targeted TypeScript filtering, F0/L1/Ads/Stories/Marketplace/moderation suites and the entire Node test suite.
- [ ] Classify every failure as L1 regression or preexisting debt; fix only L1 regressions through RED→GREEN.
- [ ] Commit any test-only verification adjustment.

### Task 5: Review, deploy, reconcile and publish branch

**Files:**
- Modify only if final review finds an L1 Critical/Important issue, using a failing test first.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one deployed migration, zero rollout, zero reconciliation findings and matching local/remote branch SHAs.

- [ ] Self-review the complete branch for SQL security, cursor leakage, determinism, diversity, numeric bounds, Ads independence and duplicate authorities.
- [ ] Recheck production migration/data/finance/Edge baselines and deploy exactly the L1 migration.
- [ ] Verify project health, migration 312, policy/RPC/ACL/index catalog, zero rollout, chronological production dry-run, advisors and zero reconciliation findings.
- [ ] Verify data/finance/Stripe/Ads/Marketplace invariance and no production fixtures or Edge deployment.
- [ ] Run final Git checks, commit any verified fix, push normally and prove local HEAD equals remote SHA.
