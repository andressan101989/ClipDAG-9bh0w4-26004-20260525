# Superuser QA Performance C1 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the demonstrated Admin SQLSTATE 57014 timeouts while preserving the canonical Admin, Marketplace, finance, and security authorities.

**Architecture:** Keep the existing RPCs and UI routes. Optimize `get_admin_system_health()` with one bounded probe over the existing `runid` primary key, publish exact 24-hour totals only when that probe proves the window complete, and otherwise return an explicit unavailable state. Constrain Marketplace health planning locally (not globally), and cancel/limit overlapping dashboard reads at the existing Supabase client boundary. Never mutate Supabase-managed `pg_cron` relations. Every database change is forward-only and retains current capability checks, grants, and financial reconciliation logic.

**Tech Stack:** PostgreSQL/Supabase migrations, React 19, TypeScript, Supabase JS, Vitest, Node test runner, Docker disposable PostgreSQL, canonical Nelyon release workflows.

---

### Task 1: Capture executable regressions before implementation

**Files:**
- Create: `tests/superuserQaPerfC1.test.mjs`
- Modify: `apps/admin-web/src/tests/adminExecutiveDashboard.test.tsx`
- Create: `scripts/prove-superuser-qa-perf-c1-disposable.mjs`

1. Add a database contract test that requires one stable 24-hour cutoff, one bounded `runid DESC` cron probe, a fail-closed incomplete-window result, unchanged capability/grant boundaries, and function-local Marketplace planner settings.
2. Add a dashboard behavior test proving a superseded range request receives an abort signal and queued work does not create an unbounded fan-out.
3. Add a disposable PostgreSQL proof with representative cron history and Marketplace reconciliation fixtures; assert exact payload parity plus bounded plans/timings.
4. Run the new tests and record the expected RED failures against `a028a397`.

### Task 2: Generate and implement the forward-only database correction

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_superuser_qa_perf_c1.sql`

1. Generate one transactional, retry-safe migration-history unit with `supabase migration new`.
2. Attest that `cron.job_run_details` remains owned by `supabase_admin`, is the expected managed relation, and has not acquired a C1 release index. Do not run DDL against the extension-owned table.
3. Replace `get_admin_system_health()` while preserving its capability guard, security-definer ownership, and grants. Read at most the latest 50,000 rows through the exact valid `runid` primary key; publish exact 24-hour totals only when the probe is unsaturated (and therefore covers every retained row), otherwise return null metrics plus `history_probe_limit_reached`.
4. Set `join_collapse_limit=1` and `from_collapse_limit=1` only on `get_marketplace_admin_health()` so its fifteen canonical reconciliators retain exact semantics while avoiding demonstrated planner explosion.
5. Add pre/postconditions for function identities, grants, search paths, planner settings, managed cron ownership/non-mutation, and unchanged finance policy.

### Task 3: Bound and cancel dashboard reads

**Files:**
- Modify: `apps/admin-web/src/lib/adminControlCenterApi.ts`
- Modify: `apps/admin-web/src/pages/AdminOverviewPage.tsx`
- Modify: `apps/admin-web/src/tests/adminExecutiveDashboard.test.tsx`
- Modify if required: `apps/admin-web/src/tests/adminControlCenterApi.test.ts`

1. Extend the existing overview read to accept an `AbortSignal` and pass it through Supabase JS.
2. Add a small bounded scheduler at the existing overview service boundary; do not add a second analytics service or retry loop.
3. Abort obsolete range/module reads during effect cleanup and treat cancellation as silent cleanup, preserving per-source error/retry behavior.
4. Keep filters, state fencing, permissions, and projections unchanged.

### Task 4: Prove correctness and performance in isolation

**Files:**
- Modify as needed only within the three C1 test/proof files above.

1. Run the database contract test and Admin Vitest focal tests to GREEN.
2. Run the disposable PostgreSQL proof with a non-superuser migration role and a `supabase_admin`-owned cron relation. Capture bounded-window truth, incomplete-window null behavior, catalog non-mutation, Marketplace result parity, and execution-time evidence.
3. Run Admin TypeScript, ESLint, production build, deployment tests, existing Admin suites, Marketplace reconciliation regressions, and release-gate tests.
4. Run `git diff --check`; confirm no finance amounts, balances, commissions, P3, MEDIA-C1, Stories, LIVE, or unrelated files changed.

### Task 5: Independent review and protected Git integration

**Files:**
- Update only governance attestations required by the canonical compiler after exact manifest generation.

1. Request independent code/security/performance review and resolve demonstrated findings.
2. Commit focal changes, push the initial `codex/superuser-qa-perf-c1` branch or the corrective `codex/superuser-qa-perf-c1-r1` branch after a safe failed release, and create a protected PR to `main`.
3. Verify exact diff, checks, reviews, conflicts, head SHA, and protected rebase merge.
4. Verify final `origin/main` SHA and tree.

### Task 6: Canonical release, postcheck, and baseline

1. Run fresh `plan_only`; require exactly the one C1 migration plus the changed Admin bundle.
2. Run fresh `gate_proof`, verify backup/snapshot/baseline/policy digest, and confirm no concurrent release.
3. Execute the HIGH release; do not repeat resources or perform financial mutations. Run `41346031770` stopped with SQLSTATE `42501` while attempting the now-removed managed cron index, before recording C1 or promoting Admin. That run is not reusable and requires fresh plan/gate/release runs after the corrective PR.
4. Reproduce the two affected Admin reads and query bounded logs to prove no new 57014 events; compare production timings before/after.
5. Verify RLS/ACL/search paths/capabilities, Finance GENERAL, Wallet/ledger, Premium 20%, LIVE 35%, Stories, P3, and MEDIA-C1.
6. Promote the production baseline via a separate protected PR, synchronize the policy digest, and require final `NO PRODUCTIVE CHANGES`.
