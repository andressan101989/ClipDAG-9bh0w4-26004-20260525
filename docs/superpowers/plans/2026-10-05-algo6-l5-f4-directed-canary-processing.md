# ALGO-6 L5-F4 Directed Canary Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dormant directed L5 canary authority, create and process exactly two approved semantic profiles, and prepare enrollment-on Metro without opening the app or arming the canary.

**Architecture:** Replace the existing controller, ranking RPC, and reconciler in one forward-only migration while preserving every existing signature and lower-layer behavior. Reuse the canonical semantic refresh RPC and existing `video-semantic-index` Edge Function for a strictly checked two-ID cohort.

**Tech Stack:** PostgreSQL/Supabase, pgvector, Node.js test runner, Supabase Edge Functions, Expo dev client.

**Spec:** `docs/superpowers/specs/2026-10-05-algo6-l5-f4-directed-canary-processing-design.md`

## Global Constraints

- Base SHA is `3246d8859cbc08a3841d28c8ba30ec600fe6e83b`.
- Exactly one migration; production moves 322 to 323.
- Global L2/L3/L4/L5 remain false; rollout remains zero; no ARM or enrollment by Codex.
- Semantic production targets are exactly `207303cc-cc79-453b-9cd7-7f7819ecac70` and `9e93ce83-0cbd-49cd-bfc7-4816e7a00b7f`.
- No Edge code, client UI, package, native, F3 formula, user-vector, ANN, or finance change.

## Review Focus

- `arm_l5` must reject each global-layer conflict independently before mutating state.
- Directed L5 must not transitively activate L2, L3, or L4 scoring.
- Expired/disarmed L5 targets must produce the inactive policy suffix.
- Production workers must never be able to claim a third profile during this block.
- Metro dependency resolution must remain inside `C:\l5f4` and enrollment must be on without app launch.

---

### Task 1: Directed L5 migration under TDD

**Files:**
- Create: `tests/algo6L5DirectedCanary.test.mjs`
- Create: `tests/algo6L5DirectedCanaryLocal.integration.mjs`
- Create: `supabase/migrations/<generated>_algo6_l5_f4_directed_canary.sql`

**Interfaces:**
- Consumes: existing policy constraint, controller, ranking RPC, and reconciler.
- Produces: `arm_l5`, target `l5`, directed L5 ranking activation, and 57 counters.

- [ ] Write static and disposable tests for target, controller gates, isolation, suffix, compatibility, semantic gate, and reconciler.
- [ ] Run both test files and verify RED because the F4 migration is absent.
- [ ] Generate the migration with the Supabase CLI and implement the minimal in-place replacements.
- [ ] Run focused and regression tests to GREEN, including disposable integration.

### Task 2: Deploy and create the controlled cohort

**Files:**
- No additional production files.

**Interfaces:**
- Consumes: the F4 migration and canonical semantic RPC/worker.
- Produces: exactly two ready semantic profiles and no other semantic rows.

- [ ] Verify migration parity, production dormancy, and provider counters immediately before deployment.
- [ ] Deploy the exact migration once and require 57/57 reconciler zero.
- [ ] Refresh each approved ID exactly once under `service_role`, checking the complete cohort after each call.
- [ ] Run bounded `process_visual` only for Video A, then bounded `process` for exactly both rows.
- [ ] Verify exact IDs, final lifecycle, vector contract, provider counts, signals, and finance.

### Task 3: Review, Git closure, and enrollment environment

**Files:**
- Modify only the approved migration/tests/docs from Tasks 1-2.

**Interfaces:**
- Consumes: green branch and exact production cohort.
- Produces: pushed clean branch and enrollment-on Metro/tunnel awaiting the owner.

- [ ] Run full focused regressions, base/branch comparison, lint, TypeScript, and `git diff --check`.
- [ ] Obtain whole-branch code review and resolve all Critical/Important findings under TDD.
- [ ] Commit and push `codex/algo6-l5-f4-directed-canary-processing`; verify local/remote parity.
- [ ] Prepare physical local dependencies and safe `.env`, start enrollment-on Metro, validate manifest/bundle, and leave processes running.
- [ ] Stop before app opening, enrollment, human save action, ARM, or DISARM.
