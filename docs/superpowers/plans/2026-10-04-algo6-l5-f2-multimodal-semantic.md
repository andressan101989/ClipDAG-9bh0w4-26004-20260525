# ALGO-6-L5-F2 Multimodal Semantic Enrichment Implementation Plan

> **Executor:** Use `superpowers:executing-plans` with TDD and the persistent
> ledger. The owner selected uninterrupted inline execution.

**Goal:** Extend the one canonical video semantic profile with stale-safe visual
semantics and the existing Edge Function with bounded visual processing while
leaving production dormant and ranking unchanged.

**Architecture:** The database delegates source selection to the existing
Content Safety resolver, stores visual lifecycle in the existing semantic row,
and admits embeddings only after visual state is terminal. The worker imports
existing hardened Stream/R2 utilities and persists only validated neutral merged
semantics through service-only RPCs.

**Spec:** `docs/superpowers/specs/2026-10-04-algo6-l5-f2-multimodal-semantic-design.md`

## Global constraints

- Base is remote `0c329124bd52193539ef6e6cc7055ace4896da62`.
- Generate exactly one migration with `supabase migration new` and preserve its
  local version in production.
- Extend the same table, sync, reconciler, and Edge Function only.
- No ranking/client/policy/package/native changes, second table/queue/resolver,
  ANN index, user vector, Vectorize, backfill, or real production provider call.
- Production must stay generation 12, canary false, rollout zero, L2/L3/L4 false.

### Task 1: Static architecture contracts and migration surface

**Files:**
- Create `tests/algo6L5MultimodalSemantic.test.mjs`
- Create generated `supabase/migrations/*_algo6_l5_f2_multimodal_semantic.sql`

**Interfaces:** consumes the F1 table/functions and Content Safety resolver;
produces the one-table F2 SQL contract and 50-counter reconciliation shape.

- [ ] Write static tests for single-table alteration, delegated source wrapper,
  v2 input/sync, visual fields/RPCs/ACLs, terminal embedding gate, privacy guards,
  reconciler keys, no ranking change, and no parallel authority.
- [ ] Run RED because no F2 migration exists.
- [ ] Generate the exact migration version with Supabase CLI.
- [ ] Implement the minimal SQL surface and run static GREEN.

### Task 2: Disposable database lifecycle and concurrency

**Files:**
- Create `tests/algo6L5MultimodalSemanticLocal.integration.mjs`
- Modify the one F2 migration.

**Interfaces:** consumes Task 1 SQL; proves source fingerprints, sync/invalidation,
visual claim/complete/fail, stale safety, embedding gate, security, concurrency,
document bound, and 50/50 reconciliation.

- [ ] Write integration tests and run RED.
- [ ] Implement lifecycle behavior without external I/O.
- [ ] Run disposable GREEN including two-worker SKIP LOCKED and bounded plans.

### Task 3: Multimodal worker pipeline

**Files:**
- Create `tests/algo6L5MultimodalSemanticWorker.test.mjs`
- Create `supabase/functions/video-semantic-index/visualSemanticPipeline.mjs`
- Modify `supabase/functions/video-semantic-index/index.ts`
- Modify `supabase/functions/video-semantic-index/embeddingPipeline.mjs`

**Interfaces:** consumes visual RPC payloads and shared hardened media helpers;
produces strict visual prompt/schema/merge and finite `process_visual` behavior.

- [ ] Write tests for strict JSON, privacy prompt, merge, one-image/five-frame
  processing, shared helper injection/imports, auth, status, failures, and 18k
  embedding input; run RED.
- [ ] Implement pure injectable visual pipeline and thin Deno wiring; run GREEN.

### Task 4: Regression, review, dormant deployment, and Git closure

**Interfaces:** consumes Tasks 1-3; produces exact migration/function deployment,
production dormancy proof, one commit, normal push, and final report.

- [ ] Run F1/F2, ALGO, Content Safety, Feed/Ads, lint, TypeScript, diff-check, and
  full-suite comparison with no new named failure.
- [ ] Self-review the complete branch package because delegation is prohibited;
  repair Important/Critical findings with RED-to-GREEN tests.
- [ ] Recheck zero profiles/provider calls, deploy exact migration and same Edge
  Function, invoke only `status`, and prove migration/source parity.
- [ ] Verify 50/50 zero, ranking hash/policy/signals/finance unchanged, zero
  process invocations/provider calls, then commit/push and prove clean parity.
