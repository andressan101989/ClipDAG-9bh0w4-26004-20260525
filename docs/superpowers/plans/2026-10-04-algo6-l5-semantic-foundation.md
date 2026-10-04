# ALGO-6-L5-F1 Semantic Embedding Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the single canonical pgvector-backed semantic profile and bounded service-only embedding lifecycle for organic videos while leaving production dormant and Feed ranking byte/logically unchanged.

**Architecture:** One private row per video stores semantic provenance, queue state, and the canonical 1024-dimensional vector. Deterministic caption plus optional current canonical transcript input is synchronized by database triggers without external I/O. Four service-only RPCs provide bounded claim/complete/fail/refresh operations to one authenticated Edge Function using Cloudflare Workers AI. No L5 consumer is added.

**Tech Stack:** PostgreSQL 17/Supabase migrations and RLS, pgvector 0.8.x, Supabase Edge Functions/Deno, Cloudflare Workers AI `@cf/baai/bge-m3`, Node test runner, disposable PostgreSQL integration tests.

**Spec:** `docs/superpowers/specs/2026-10-04-algo6-l5-semantic-foundation-design.md`

## Global constraints

- Base and remote must remain `87bff234fba4fb019c7aad35d0f29836a26113dc` until the final L5 commit.
- Generate exactly one migration with `supabase migration new algo6_l5_semantic_embedding_foundation`; its local version must be the production ledger version.
- Do not alter ranking, policy, Feed/client/native/package files, L1-L4, or canary infrastructure.
- Do not create another semantic/queue/vector authority, PGMQ, Vectorize, user vectors, ANN indexes, or a browser endpoint.
- Do not backfill, refresh, claim, process, or embed the seven current production videos.
- Production remains generation 12, canary false, rollout zero, L2/L3/L4 false, signals and finance unchanged.

## Baseline evidence

- [x] Create an isolated physical worktree at `C:\l5f1` from the exact remote base.
- [x] Install physical local dependencies with `npm ci` without changing package manifests.
- [x] Run the fresh base full suite: 3325 tests, 3268 pass, 57 preexisting failures.
- [x] Confirm production has 319 migrations, 43/43 zero reconciliation, no semantic authority, and pgvector available but not installed.
- [x] Confirm official Cloudflare availability for `@cf/baai/bge-m3` and no provider call during audit.

---

### Task 1: Static architecture contract and generated migration

**Files:**
- Create: `tests/algo6L5SemanticFoundation.test.mjs`
- Create: `supabase/migrations/<generated>_algo6_l5_semantic_embedding_foundation.sql`

**Interfaces:**
- Consumes: current Content Safety fingerprint/snapshot authority and current 43-counter reconciler.
- Produces: one migration with vector/table/input/sync/RPC/trigger/security/reconciler contracts and static exclusion guards.

- [ ] Write tests for the exact single table, vector extension/schema/dimension, constants, constraints, deterministic input, transcript filters, trigger scope, four canonical RPCs, ACL/search path, five reconciler keys, no ranking change, and every forbidden authority/source.
- [ ] Run the static test and capture RED because the L5 migration does not exist.
- [ ] Inspect Supabase CLI migration help, then generate the migration through the CLI.
- [ ] Implement the smallest migration surface that satisfies the static contract.
- [ ] Run the static test and keep it GREEN while later tasks evolve the same migration.

### Task 2: Disposable database behavior and bounded performance

**Files:**
- Create: `tests/algo6L5SemanticFoundationLocal.integration.mjs`
- Modify: `supabase/migrations/<generated>_algo6_l5_semantic_embedding_foundation.sql`

**Interfaces:**
- Consumes: disposable schema matching `public.videos`, Content Safety scans/transcripts, canonical hash/snapshot helpers, and pgvector.
- Produces: deterministic semantic input, lifecycle transitions, trigger invalidation, concurrency-safe claims, stale protection, security, reconciliation, and bounded query-plan evidence.

- [ ] Write disposable tests for caption-only, current/no-speech/stale transcript behavior, fingerprints, one-row invariant, update/arrival triggers, claim limits/concurrency, 1024 completion, wrong dimensions, stale completion, retry accounting, ACLs, ranking parity, 30k-video bounded claim, and 48/48 reconciliation.
- [ ] Run the disposable suite and capture RED before database implementation is complete.
- [ ] Implement input/sync, profile table, indexes, triggers, refresh/claim/complete/fail, ACLs, and reconciler in the single migration.
- [ ] Run the integration suite and inspect EXPLAIN until all L5 database behavior is GREEN without unbounded claim scans.

### Task 3: Service-only semantic worker

**Files:**
- Create: `tests/algo6L5SemanticWorker.test.mjs`
- Create: `supabase/functions/video-semantic-index/embeddingPipeline.mjs`
- Create: `supabase/functions/video-semantic-index/index.ts`

**Interfaces:**
- Consumes: service credential, canonical claim/complete/fail RPCs, existing Cloudflare account/token configuration.
- Produces: service-only `status`/finite `process` modes and strictly validated BGE-M3 dense embeddings.

- [ ] Write worker tests for exact credential authorization, zero-side-effect status/unauthorized/no-claim paths, default/max batch bounds, provider payload, valid 1024 arrays, count/dimension/type/nonfinite/size failures, and retryable/nonretryable fail RPC routing.
- [ ] Run the worker suite and capture RED because the module does not exist.
- [ ] Implement the pure injectable pipeline and thin Deno entry point without logging secrets.
- [ ] Run worker tests GREEN and lint/type-check the new worker surface.

### Task 4: Regression, review, dormant deployment, and Git closure

**Files:**
- Verify only all files listed above plus the two approved design/plan documents.

**Interfaces:**
- Consumes: completed local migration/function and existing linked Supabase project.
- Produces: exact migration/Edge deployment, dormant production evidence, one normal commit/push, and final audit report.

- [ ] Run semantic static/disposable/worker, Content Safety audio/visual, all ALGO-6, Feed, Ads, performance, lint, TypeScript, and diff-check verification.
- [ ] Run the branch full suite and compare exact failing names with the 57-failure base baseline; accept no new failures.
- [ ] Self-review the complete diff for scope, security, secrets, stale writes, duplicate authority, and production dormancy (fresh-context subagent review is unavailable because delegation is prohibited for this task).
- [ ] Verify production predeploy state again, deploy the exact generated migration version, and verify local/remote migration history plus canonical SQL parity.
- [ ] Deploy `video-semantic-index` with JWT verification, invoke only authenticated `status`, and never invoke `process`.
- [ ] Verify vector schema/version, zero preexisting-video profiles, 48/48 reconciliation, unchanged ranking/policy/signals/finance, and no provider calls/backfill.
- [ ] Commit exactly `feat(algo): add semantic embedding foundation`, push normally, fetch, and prove local/remote SHA equality with a clean worktree.
