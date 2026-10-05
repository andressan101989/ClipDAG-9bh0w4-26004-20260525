# ALGO-6 L6-F4 Training Readiness Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one service-role-only, aggregate L6 training-readiness authority and one deterministic operator report without changing observation capture, Feed ranking, or creating any model/training infrastructure.

**Architecture:** A single SQL `SECURITY DEFINER` RPC derives readiness from the four existing private observation tables and `public.video_views` through set-based fact CTEs. It returns a versioned JSONB contract, treats identity/contract corruption as structural failure, and keeps training entry false while any final label contract is unresolved. A thin Node operator script calls that RPC and formats every gate; no state is copied or persisted.

**Tech Stack:** PostgreSQL/Supabase migrations and ACLs, Node.js ESM, `node:test`, disposable Supabase Postgres via Docker, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-10-05-algo6-l6-f4-training-readiness-monitoring-design.md`

## Global Constraints

- Start from `58126613c86d3250fe98529fa48e3c387f08b15d` on `codex/algo6-l6-f4-training-readiness-monitoring` in `C:\l6f4`.
- Generate exactly one migration with `supabase migration new algo6_l6_training_readiness_monitoring`; never invent its timestamp.
- Do not modify `20261005165310_algo6_l6_observation_dataset_foundation.sql` or any historical migration.
- New tables, views, materialized views, cron jobs, triggers, event identities, model objects, feature stores, prediction caches, and training datasets: zero.
- Client files, playback files, observation client service, and `get_ranked_feed_l1_v1`: unchanged.
- The readiness RPC is zero-argument, aggregate-only, service-role-only, and never enters an online request path.
- The 250,000 gate is `count(distinct client_event_id)` over visible organic impressions; report total and distinct, and make divergence a structural failure.
- Mature means `created_at <= generated_at - interval '24 hours'`.
- No provisional or pending label contract may contribute to `training_entry_ready=true`.
- Exact global constants: unique visible impressions `250000`, valid retention `100000`, authenticated viewers `2000`, visible videos `2000`, visible creators `200`, continuous UTC days `84`.
- Exact head-support constants: long-watch `10000/10000`, completion `10000/10000`, future early-exit `10000/10000`, rewatch `5000`, external save `5000`, external like `5000`, sparse validation `500`, sparse untouched test `500`.
- Unclosed heads report exactly `PROVISIONAL_LABEL_CONTRACT` or `PENDING_FINAL_LABEL_CONTRACT`; unevaluable temporal support reports `NOT_EVALUABLE`.
- No Ads, Marketplace, financial, wallet, ledger, chat/message, sensitive, moderation-preference, location, device, or network dependency.
- Add no index without captured `EXPLAIN (ANALYZE, BUFFERS)` evidence proving a need.
- Do not train, create, deploy, or invoke a model. Do not start L6-F5.

## Review Focus

- A deliberately corrupted fixture with `count(*) != count(distinct client_event_id)` must return `STRUCTURAL_FAILURE` even though production currently enforces a primary key; Task 1 tests this only in a disposable transaction by temporarily dropping/recreating the relevant disposable constraints, then rolling back or destroying the database.
- Exactly-24-hour impressions must be mature while newer impressions remain immature; Task 1 pins the inclusive boundary using one frozen database timestamp.
- A matching `client_event_id` with wrong video, session, or viewer identity must be structural and excluded from valid retention; Task 1 covers all three mismatches.
- Gate-scale numeric support must still produce `training_entry_ready=false` while label contracts remain provisional; Task 1 and Task 3 both assert this.
- Feature snapshots with an extra key, a missing key, or a nonnumeric/non-null value must be malformed, while numeric and null allowlisted values remain valid; Task 1 covers every class.

---

### Task 1: Canonical readiness RPC and reconciler extension

**Files:**
- Create: `tests/algo6L6TrainingReadiness.test.mjs`
- Create: `tests/algo6L6TrainingReadinessLocal.integration.mjs`
- Create: `supabase/migrations/<CLI-generated>_algo6_l6_training_readiness_monitoring.sql`
- Read only: `supabase/migrations/20261005165310_algo6_l6_observation_dataset_foundation.sql`

**Interfaces:**
- Consumes: F2 observation tables, `public.video_views.client_event_id`, `private.algo_l1_policy`, and the existing `public.reconcile_algo_l1_v1()` definition.
- Produces: `public.get_algo6_l6_training_readiness_v1() -> jsonb` and reconciler counters `l6_training_readiness_authority_missing`, `l6_training_readiness_contract_invalid`, and `l6_training_readiness_forbidden_dependency_present`.

- [ ] **Step 1: Re-run exact prechecks before creating files**

Run:

```powershell
git fetch origin --prune
git branch --show-current
git rev-parse HEAD
git rev-parse origin/codex/algo6-l6-f2-observation-dataset-foundation
git status --short
git diff --check
```

Expected: branch `codex/algo6-l6-f4-training-readiness-monitoring`; branch history starts at `58126613c86d3250fe98529fa48e3c387f08b15d`; only approved spec/plan commits may precede implementation; worktree otherwise clean.

Run a read-only production audit confirming migration 324, F2 latest, policy generation 14/canary false/rollout zero/global flags false, reconciler 65/65 zero, exactly one retention cron, and no readiness-equivalent function or relation.

- [ ] **Step 2: Write static RED tests**

Create `tests/algo6L6TrainingReadiness.test.mjs` with named tests that assert:

1. exactly one migration ends in `_algo6_l6_training_readiness_monitoring.sql`;
2. no new `create table`, `create view`, `create materialized view`, trigger, cron schedule, ranker replacement, or client-file change is introduced;
3. the zero-argument RPC returns JSONB, is `SECURITY DEFINER`, has `search_path=''`, has no dynamic SQL, and uses fully qualified relations;
4. exact contract/version strings and every numeric gate are present;
5. total and `count(distinct client_event_id)` are both reported and divergence feeds structural failure;
6. maturity and valid-retention predicates match the spec, including permitting completion ratios over 1;
7. all provisional/pending heads force `training_entry_ready=false`;
8. early exit reports an exit-reason distribution without inventing a threshold;
9. ACL revokes `PUBLIC`, `anon`, `authenticated`, and grants only `service_role`;
10. exactly three new reconciler keys exist and the prior 65 keys are preserved;
11. forbidden dependency terms and online-ranker calls are absent;
12. the F2 migration hash/content remains unchanged.

- [ ] **Step 3: Write disposable integration RED tests**

Create `tests/algo6L6TrainingReadinessLocal.integration.mjs`, following the existing F2 disposable container helpers and setting `skip` unless `NELYON_ALGO6_L6_F4_LOCAL=1`.

The tests must create a database from the same disposable template, apply the ALGO migrations through F2, then attempt to apply the missing F4 migration. Fixtures and assertions cover all 27 cases required by the user, including:

- empty healthy dataset -> `NOT_READY`, not error;
- exact role ACL and raw-table denial;
- immature/mature boundary;
- exact finalized-view linkage and retention requirements;
- censored impression behavior;
- total/distinct identity divergence;
- wrong video/session/viewer joins;
- self engagement, reversals, and outside-window events;
- snapshot missing/extra/bad-value corruption;
- invalid contract versions and future timestamps;
- production-shaped 28/28 fixture;
- tiny fixtures remain not ready;
- numerically sufficient fixtures remain blocked by provisional labels;
- valid reconciler 68/68 zero and deliberate authority/contract/dependency breakage;
- database teardown in `finally`.

- [ ] **Step 4: Run RED and verify the failure reason**

Run:

```powershell
node --test tests/algo6L6TrainingReadiness.test.mjs
$env:NELYON_ALGO6_L6_F4_LOCAL='1'
node --test tests/algo6L6TrainingReadinessLocal.integration.mjs
Remove-Item Env:NELYON_ALGO6_L6_F4_LOCAL
```

Expected: static test fails because the F4 migration does not exist; disposable test fails for the same missing migration/RPC, not due to syntax, Docker, or fixture errors.

- [ ] **Step 5: Generate the migration with the CLI**

First discover the installed CLI syntax:

```powershell
npx supabase migration new --help
npx supabase migration new algo6_l6_training_readiness_monitoring
```

Expected: exactly one new timestamped migration with the requested suffix.

- [ ] **Step 6: Implement the set-based readiness RPC**

In the generated migration, create `public.get_algo6_l6_training_readiness_v1()` with the exact contract from the spec.

Use a single frozen `generated_at` and materialized/set-based CTEs for:

- canonical item/decision quality;
- impression facts joined once to item and exact view identity;
- mature UTC-day islands;
- engagement facts joined once to impression/item;
- feature allowlist/type validation;
- policy context;
- deterministic blocking reasons.

Do not use dynamic SQL, DML, per-row function calls, or observation tables as output rows. Return only one aggregate JSONB value.

- [ ] **Step 7: Apply exact readiness ACL**

Revoke execute from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only `service_role`. Preserve `SECURITY DEFINER` and `SET search_path=''`.

- [ ] **Step 8: Replace the canonical reconciler without changing its existing 65 keys**

Copy the effective F2 `public.reconcile_algo_l1_v1()` definition into the forward migration and append exactly the three new counters defined in the spec. Do not duplicate any F2 observation check. Preserve service-role-only ACL and empty search path.

- [ ] **Step 9: Run GREEN static and disposable integration tests**

Run the commands from Step 4 again.

Expected: all named tests pass; valid fixture returns 68 zero counters; every corruption fixture sets the corresponding readiness/reconciler failure and is rolled back or destroyed.

- [ ] **Step 10: Verify migration scope**

Run:

```powershell
git diff --check
git diff --stat
git diff -- supabase/migrations tests/algo6L6TrainingReadiness.test.mjs tests/algo6L6TrainingReadinessLocal.integration.mjs
```

Expected: one generated migration and two tests only; zero historical migration edits and zero application/client files.

### Task 2: Deterministic operator report

**Files:**
- Create: `scripts/report-algo6-l6-training-readiness.mjs`
- Create: `tests/algo6L6TrainingReadinessReport.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public.get_algo6_l6_training_readiness_v1()` JSONB response and server-side environment variables for Supabase URL/service secret.
- Produces: `formatTrainingReadinessReport(readiness) -> string`, `exitCodeForReadiness(readiness) -> number`, CLI command `npm run report:algo6-l6-readiness`.

- [ ] **Step 1: Write RED report tests**

Test pure formatter fixtures for `NOT_READY`, `NOT_EVALUABLE`, provisional labels, and `STRUCTURAL_FAILURE`. Assert every gate prints `CURRENT`, `REQUIRED`, and `STATUS`; secrets never appear; not-ready exits zero; malformed/structural responses exit nonzero; importing the module performs no network call.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test tests/algo6L6TrainingReadinessReport.test.mjs
```

Expected: fail because the report module/exports are absent.

- [ ] **Step 3: Implement the minimal report module**

Use `@supabase/supabase-js` already present in the repository. Read the URL and service secret only from process environment, construct a non-persisting server client, invoke only `get_algo6_l6_training_readiness_v1`, validate the aggregate response shape, and print the deterministic report. Never print credentials or raw identities.

Add to `package.json`:

```json
"report:algo6-l6-readiness": "node scripts/report-algo6-l6-training-readiness.mjs"
```

Do not change dependencies or `package-lock.json`.

- [ ] **Step 4: Run GREEN and security scans**

Run:

```powershell
node --test tests/algo6L6TrainingReadinessReport.test.mjs
rg -n "console\.(log|error).*key|service_role.*console|writeFile|insert\(|update\(|delete\(" scripts/report-algo6-l6-training-readiness.mjs
```

Expected: tests pass and the scan finds no credential output, file write, or DML path.

- [ ] **Step 5: Verify package scope**

Run `git diff -- package.json package-lock.json scripts tests/algo6L6TrainingReadinessReport.test.mjs`.

Expected: one package script only; `package-lock.json` unchanged.

### Task 3: Gate-scale performance and full regression proof

**Files:**
- Modify only if the RED proof requires it: `tests/algo6L6TrainingReadinessLocal.integration.mjs`
- Modify the generated migration only if evidence identifies a correctness or measured performance defect.

**Interfaces:**
- Consumes: completed Task 1 readiness RPC.
- Produces: captured diagnostics for approximately 250,000 impressions, 100,000 valid views, and query-plan evidence.

- [ ] **Step 1: Add the performance fixture before any optimization**

Under `NELYON_ALGO6_L6_F4_PERF=1`, generate set-based disposable rows approximating:

- 50,000 decisions;
- 250,000 items and visible impressions;
- at least 100,000 exact finalized views;
- at least 2,000 authenticated viewers and videos;
- at least 200 creators;
- 84+ mature UTC days.

All identities and snapshots must satisfy the F2 contract. The fixture may exceed numeric gates but must still assert `training_entry_ready=false` because label contracts are provisional.

- [ ] **Step 2: Capture initial EXPLAIN evidence**

Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the readiness call and representative identity/date joins used inside it. Record execution time, planning time, shared buffers, scan/join types, loop counts, and rows. Assert there is no per-impression correlated/N+1 loop and no accidental quadratic join multiplication.

- [ ] **Step 3: Decide indexes from evidence**

If existing primary/unique/time indexes produce bounded aggregate plans, add no index. If a material bottleneck is demonstrated, first add a failing performance-plan assertion, then add only the smallest matching index to the migration and capture before/after evidence. Record the ruling either way.

- [ ] **Step 4: Run performance proof**

```powershell
$env:NELYON_ALGO6_L6_F4_LOCAL='1'
$env:NELYON_ALGO6_L6_F4_PERF='1'
node --test tests/algo6L6TrainingReadinessLocal.integration.mjs
Remove-Item Env:NELYON_ALGO6_L6_F4_LOCAL
Remove-Item Env:NELYON_ALGO6_L6_F4_PERF
```

Expected: fixture and plan assertions pass; diagnostics are retained for the final report.

- [ ] **Step 5: Prove the Feed hot path is untouched**

Run repository searches proving `get_ranked_feed_l1_v1`, impression/view writers, client render, and like/save/follow paths never call the readiness function. Compare the ranker migration/function hash against the F2 base.

- [ ] **Step 6: Run focused and full regression families**

Run at minimum:

```powershell
node --test tests/algo6L6TrainingReadiness.test.mjs tests/algo6L6TrainingReadinessReport.test.mjs
$env:NELYON_ALGO6_L6_F4_LOCAL='1'
node --test tests/algo6L6TrainingReadinessLocal.integration.mjs tests/algo6L6ObservationFoundationLocal.integration.mjs
Remove-Item Env:NELYON_ALGO6_L6_F4_LOCAL
node --test tests/algo6*.test.mjs
node --test tests/*feed*.test.mjs tests/*Feed*.test.mjs tests/*playback*.test.mjs tests/*Playback*.test.mjs tests/*view*tracking*.test.mjs
npx eslint scripts/report-algo6-l6-training-readiness.mjs tests/algo6L6TrainingReadiness*.mjs
npx tsc --noEmit --pretty false
git diff --check
```

Also run the repository's full root `node --test` suite where operationally feasible. Record exact pass/failure names and compare TypeScript diagnostics with a clean base run; accept no new failure name or new TypeScript diagnostic.

- [ ] **Step 7: Review the complete implementation diff**

Confirm no historical migration, client, ranker, package lock, Ads, Marketplace, finance, or unrelated file changed. Confirm migration defines no table/view/materialized view/cron/model/training object.

### Task 4: Production preflight and single-migration deployment

**Files:** None unless a failing preflight stops deployment.

**Interfaces:**
- Consumes: locally verified migration and tests.
- Produces: production migration 325 and callable service-only readiness authority.

- [ ] **Step 1: Re-read production immediately before deployment**

Require:

- project `ACTIVE_HEALTHY`;
- migrations 324, latest F2;
- reconciler 65/65 zero;
- policy generation 14, canary false, rollout zero, L2/L3/L4/L5 false;
- observation counts not below 2 decisions, 14 items, 28 impressions, 8 engagements;
- total and unique impressions equal; current view-link coverage has not regressed;
- exactly one retention cron;
- no readiness-equivalent object.

Any mismatch invokes the user's STOP conditions.

- [ ] **Step 2: Discover CLI deployment syntax and dry-run**

```powershell
npx supabase db push --help
npx supabase db push --linked --dry-run
```

Expected: exactly one pending F4 migration; no seed, role, historical migration, or unrelated change.

- [ ] **Step 3: Deploy exactly the F4 migration**

Run the verified linked push command once. Do not retry blindly after an uncertain result; inspect remote migration history first.

- [ ] **Step 4: Run immediate postdeploy checks**

Require migration 325/latest F4, readiness RPC exact ACL/security, reconciler 68/68 zero, observation counts preserved, cron count one, policy unchanged, and readiness `overall_status=NOT_READY`, `training_entry_ready=false`.

- [ ] **Step 5: Run the operator report against production**

Supply server credentials only through process environment and run `npm run report:algo6-l6-readiness`. Confirm it prints all gates and exits zero for healthy not-ready state without printing credentials.

### Task 5: Git closure and final audit

**Files:** All approved implementation files from Tasks 1-2 and the already approved spec/plan documents.

**Interfaces:**
- Consumes: verified production and test evidence.
- Produces: pushed branch `codex/algo6-l6-f4-training-readiness-monitoring` with local/remote SHA equality.

- [ ] **Step 1: Final source audit**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
git diff --stat
git diff
```

Verify the implementation scope line by line.

- [ ] **Step 2: Commit the implementation**

Stage only the generated migration, F4 tests, operator script, and package script. Commit:

```powershell
git commit -m "feat(algo): add l6 training readiness monitoring"
```

- [ ] **Step 3: Perform whole-branch self-review and fix only Critical/Important findings with RED->GREEN tests**

Because this run is not authorized to delegate to subagents, perform a separate author self-review from base `58126613c86d3250fe98529fa48e3c387f08b15d` through HEAD against the spec and plan, with special attention to the five Review Focus cases. Record that the review was self-authored, plus all rulings and deferred minors, explicitly.

- [ ] **Step 4: Re-run final verification after review fixes**

Freshly rerun the F4 static/report/integration tests, ALGO regressions, changed-scope ESLint, TypeScript comparison, full suite where feasible, production readiness/reconciler checks, and `git diff --check`.

- [ ] **Step 5: Push normally and verify parity**

```powershell
git push -u origin codex/algo6-l6-f4-training-readiness-monitoring
git fetch origin
git rev-parse HEAD
git rev-parse origin/codex/algo6-l6-f4-training-readiness-monitoring
git status --short
```

Expected: local and remote SHA identical; worktree clean; no force push.

- [ ] **Step 6: Produce the required final report and stop**

Report every section and exact metric required by the user, including current/required/status for all gates, performance evidence, production postdeploy state, and explicit ML status. End with exactly one approved verdict and do not begin L6-F5.
