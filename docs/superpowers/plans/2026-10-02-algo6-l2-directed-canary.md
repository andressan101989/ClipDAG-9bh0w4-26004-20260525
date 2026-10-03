# ALGO-6-L2 Directed Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the one existing controlled canary so one enrolled authenticated tester can later receive L2 without enabling global L2 or rollout.

**Architecture:** Add one operational target column to the existing policy, extend the existing enrollment/controller/ranking/reconciler functions, and preserve all canonical signatures and ACLs. Directed L2 changes only the activation gate; the deployed state remains disarmed and global L2 stays false.

**Tech Stack:** PostgreSQL 17/Supabase functions and ACLs, Node test runner, disposable PostgreSQL integration tests, Expo Development Client tunnel.

**Spec:** `docs/superpowers/specs/2026-10-02-algo6-l2-directed-canary-design.md`

## Global Constraints

- Create exactly one migration with `supabase migration new algo6_l2_directed_canary`; repository and production versions must match.
- Preserve one policy, ranking RPC, Feed service, enrollment RPC, controller RPC, playback authority, and eligibility authority.
- Production stays `policy_version=nelyon-algo-l1-v1`, global L2 false, rollout zero, canary disabled, target l1, generation 2 before human enrollment.
- Do not ARM, call `arm_l2`, change global policy/version/rollout, alter the L2 formula, touch Ads/finance/native code, build EAS, or start L3.
- Start Metro only after the exact committed migration is deployed and verified; enrollment may originate only from the authenticated physical client.

## Review Focus

- A fresh pending enrollment must reset a historical L2 target to l1 without changing generation.
- A directed L2 arm must not enable global L2, change policy version, or affect another authenticated/anonymous user.
- Pre-arm, post-disarm, and expired tester cursors must fail while normal and anonymous cursors remain valid.
- The effective L2 gate must reuse the exact current affinity formula rather than fork or retune it.
- Controller/enrollment ACLs and empty search paths must remain unchanged after function replacement.

---

### Task 1: Static contract and migration skeleton

**Files:**
- Create: `tests/algo6L2DirectedCanary.test.mjs`
- Create: `supabase/migrations/<generated>_algo6_l2_directed_canary.sql`

**Interfaces:**
- Consumes: current policy, guard, enrollment/controller/ranking/reconciler definitions.
- Produces: one operational target column and static single-authority/security guarantees.

- [x] Write the static test for one migration, target constraint/default, operational guard exemption, unchanged signatures/ACLs, no parallel objects, and reconciler keys.
- [x] Run it and verify RED because the migration does not exist.
- [x] Generate the migration with the Supabase CLI.
- [x] Add the minimal column, constraint, guard, and function replacements required by the static contract.
- [x] Run the static test and verify GREEN.

### Task 2: Disposable directed-canary behavior

**Files:**
- Create: `tests/algo6L2DirectedCanaryLocal.integration.mjs`
- Modify: `supabase/migrations/<generated>_algo6_l2_directed_canary.sql`

**Interfaces:**
- Consumes: canonical enrollment/controller/ranking and L2 affinity formula.
- Produces: L1/L2 target isolation, cursor safety, expiry, reset, and reconciliation evidence.

- [x] Write disposable tests for dormant migration, L1 arm, `arm_l2`, isolation, exact formula reuse, cursor cases, expiry, enrollment reset, and browser denial.
- [x] Run and verify RED against the migration skeleton.
- [x] Implement the effective L2 gate, layer-aware versioning, controller actions, and reconciler checks in the same functions.
- [x] Run static and disposable tests and verify GREEN.

### Task 3: Regression, review, commit, push, and exact deployment

**Files:**
- Modify only for Critical/Important findings, each with a failing test first.

**Interfaces:**
- Consumes: complete migration and tests.
- Produces: committed remote branch and one deployed migration with dormant production invariants.

- [x] Run L2, L1 canary, L1 ranking, F0, Feed/Ads regressions, changed-file lint, `git diff --check`, and relevant advisors.
- [x] Review the whole branch for security, formula drift, cursor isolation, duplicate authorities, and scope leaks.
- [ ] Commit and push; verify remote SHA and normalized migration hash before deployment.
- [ ] Deploy only the committed migration and verify migration 315, parity, policy state, reconciler zeroes, data/finance invariance, and advisor deltas.

### Task 4: Metro enrollment readiness and final gate

**Files:**
- No versioned file changes.

**Interfaces:**
- Consumes: final deployed branch SHA and existing Build 29.
- Produces: persistent development-client tunnel with enrollment enabled and no ARM.

- [ ] Start Metro from the final SHA with `EXPO_PUBLIC_ALGO_L1_CANARY_ENROLL=1` on a safe free port.
- [ ] Verify Metro/ngrok processes, public HTTP 200 manifest, Nelyon Build 29, and bundle identifier.
- [ ] If the physical client legitimately enrolls, verify pending target l1; otherwise return the exact deep link.
- [ ] Confirm no ARM/global L2/rollout/finance/Git changes and keep Metro alive.
