# Nelyon Production Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one fail-closed, manually approved GitHub Actions authority for Supabase production releases, cut over from automatic production deployment, and prove the gate without deploying a function or migration.

**Architecture:** A single `workflow_dispatch` workflow delegates deterministic policy, Git, manifest, approval, baseline, and finance validation to one standard-library Node.js module. The unprivileged `plan` job emits a canonical manifest and SHA-256; the `deploy` job is protected by the `production` Environment and revalidates the exact run, attempt, Environment, approval, main SHA, policy digest, baseline, current auto-deploy-off evidence, and manifest before any release command can exist.

**Tech Stack:** GitHub Actions on `ubuntu-24.04`; Node.js `24.21.0`; Node built-ins (`node:test`, `crypto`, `fs`, `path`, `child_process`); Git; Supabase CLI `2.120.0`; GitHub REST API `2026-03-10`; actionlint `1.7.12` for temporary local YAML validation.

**Spec:** `docs/superpowers/specs/2026-10-09-nelyon-production-release-gate-design.md`

## Global Constraints

- Work only in `C:\creator-premium-b1-main-integration` on `codex/creator-premium-b5-creator-management-ux`; do not create a branch, clone, worktree, or copied workspace.
- Do not modify `app/**`, `apps/**`, `services/**`, `supabase/migrations/**`, `supabase/functions/**`, or the roadmap.
- Create only the approved workflow, policy, helper, test, runbook, this plan, and the already committed specification.
- Do not add an npm dependency, reinstall `node_modules`, or create a lockfile.
- Do not run `supabase db push`, `supabase migration up`, or `supabase functions deploy` during implementation, baseline verification, `plan_only`, or `gate_proof`.
- Do not expose or print GitHub, Supabase, database, or service-role secret values. `service_role` is not part of this gate.
- Do not push any gate commit to `main` until authenticated evidence proves Supabase `Deploy to production` is OFF.
- Do not execute `mode=release` during C2. Only `plan_only` and `gate_proof` are authorized proofs.
- Authorized owner, actor, and reviewer are exactly `andressan101989`; `prevent_self_review` is deliberately `false`.
- The initial candidate baseline SHA is `d02dda37e34493bc73b9f3b34fcd4874ef212911`; a matching Git SHA alone never makes it verified.
- The project ref is exactly `aewwdlvbwpczqyvkwvvj`; initial production evidence is 336 migrations, latest `20261009021414_creator_premium_b5_creator_management_ux`, and 34 active functions.
- Premium Finance must remain `false / false / false / 0`; no C2 step may invoke a financial RPC or move BDAG.
- The existing floating `https://esm.sh/@supabase/supabase-js@2` dependency blocks release of every affected function; this plan does not rewrite imports.
- Use `git diff --check` and focused tests after every implementation task. Stop on a critical failure instead of weakening a check.
- Use no force push, destructive reset, prune, automatic migration rollback, bulk function deploy, or Supabase `--prune` behavior.

## Mandatory Security Observations

1. **Approval binding:** approval evidence must belong to the current GitHub workflow `run_id`, `run_attempt`, `production` Environment ID/name, release ID, approved SHA, and manifest digest. Approval from another run or earlier attempt is invalid.
2. **Current auto-deploy evidence:** until Supabase exposes a reliable API for the toggle, every release requires evidence no older than 15 minutes plus an exact owner approval comment confirming that evidence for that release.
3. **Baseline authority:** `candidate -> verified` is a separate, read-only, owner-reviewed control-plane transition recorded in Git and independently anchored by the Environment policy digest. The workflow cannot edit or promote its own policy.
4. **Concurrent finance:** count changes are evidence, not failure by themselves. Transactions created during the release window are allowed only when they are not release-attributed and pass canonical ledger/reconciliation invariants; any release-attributed financial write or failed invariant denies success.

## File Map

- `.github/nelyon-production-release-policy.json`: immutable-input policy, managed function allowlist, tool/action pins, baseline evidence, cutover evidence, and last successful release record.
- `scripts/nelyon-production-release.mjs`: importable pure validators plus the `plan`, `revalidate`, `verify-gate`, and `postcheck` CLI commands; it performs no network request itself.
- `tests/nelyonProductionReleaseGate.test.mjs`: all pure, temporary-repository, CLI, workflow-contract, security, and no-mutation tests.
- `.github/workflows/nelyon-production-release.yml`: manual orchestration only; fetches read-only GitHub/Supabase evidence and passes JSON to the helper.
- `docs/runbooks/nelyon-production-release.md`: owner actions, baseline verification, cutover, evidence capture, dispatch, approval comment, release denial, recovery, and rollback guidance.
- `docs/superpowers/plans/2026-10-09-nelyon-production-release-gate.md`: this reviewed execution plan.

## Pinned Toolchain

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`), with `fetch-depth: 0` and `persist-credentials: false`.
- `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (`v7.1.0`), with Node `24.21.0` and no dependency cache.
- `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` (`v7.0.2`).
- `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333` (`v8.0.2`).
- `supabase/setup-cli@45a513f8c64c0bc8e0e3dfe572b5c95be85f6359` (`v3.0.1`) with Supabase CLI `2.120.0`.
- Local YAML validator: actionlint `1.7.12` Windows AMD64 ZIP, SHA-256 `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`, downloaded only to a validated temporary directory and removed after use.

## Review Focus

- GitHub APIs may paginate Environment branch policies, approval history, workflow runs, or artifacts; tests in Tasks 4 and 5 require complete pagination and deny truncated evidence.
- A manifest artifact may contain a duplicate name or path traversal entry; Task 4 rejects multiple expected files, absolute paths, `..`, symlinks, and unexpected payloads.
- Clock skew or a future-dated Supabase-toggle attestation must not become “fresh”; Task 5 permits at most 60 seconds of future skew and requires an age from 0 through 900 seconds.
- Git name-status data may include tabs, Unicode, renames, copies, or NULs; Task 2 tests byte-safe parsing and denies unsupported statuses without lossy normalization.
- Legitimate finance traffic can occur exactly at a snapshot boundary; Task 7 uses database timestamps plus `(created_at, id)` watermarks, assigns each row to exactly one interval, and validates invariants instead of static counters.

---

### Task 1: Commit the approved plan and establish policy/request primitives

**Files:**
- Create: `.github/nelyon-production-release-policy.json`
- Create: `scripts/nelyon-production-release.mjs`
- Create: `tests/nelyonProductionReleaseGate.test.mjs`
- Commit: `docs/superpowers/plans/2026-10-09-nelyon-production-release-gate.md`

**Interfaces:**
- Consumes: the approved specification and constants in Global Constraints.
- Produces: `GateDeniedError`, `loadPolicy(path)`, `validatePolicy(policy)`, `validateRequest(request, policy)`, `canonicalJson(value)`, and `sha256Hex(bytes)`.

- [ ] **Step 1: Commit this approved plan before implementation**

Run:

```powershell
git add docs/superpowers/plans/2026-10-09-nelyon-production-release-gate.md
git diff --cached --check
git commit -m "docs(ci): plan controlled production release gate"
```

Expected: one documentation file committed; no workflow, policy, helper, or production change yet.

- [ ] **Step 2: Add failing policy and request-validation tests**

Add tests named:

```js
test("policy accepts the exact repository owner project modes and managed functions", () => {});
test("candidate baseline denies release but permits plan_only and gate_proof", () => {});
test("malformed stale foreign and non-main SHA requests are denied", () => {});
test("actor repository workflow ref mode and confirmation must match exactly", () => {});
test("a rerun by a different triggering actor is denied", () => {});
test("canonical JSON is recursively stable and SHA-256 hashes exact UTF-8 bytes", () => {});
```

Assertions must include the 17 exact managed function names from
`supabase/config.toml`, forbidden `bdag-economy`, authorized owner, project
ref, three modes, four confirmation strings, and candidate baseline SHA.

- [ ] **Step 3: Run the Task 1 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="policy|candidate baseline|malformed stale|actor repository|rerun|canonical JSON" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the policy and exported interfaces do not exist.

- [ ] **Step 4: Implement the minimal policy and pure primitives**

Create policy schema version `1` and implement:

```js
export class GateDeniedError extends Error {
  constructor(code, message, details = {});
}
export function loadPolicy(filePath);
export function validatePolicy(policy);
export function validateRequest(request, policy);
export function canonicalJson(value);
export function sha256Hex(bytes);
```

The initial policy must use `baseline.state="candidate"` and
`cutover.state="pending"`; it must contain no secret value. `canonicalJson`
sorts object keys recursively, preserves array order, emits UTF-8 JSON plus
one trailing newline, and rejects unsupported JS values.

- [ ] **Step 5: Run Task 1 tests and full syntax checks**

Run:

```powershell
node --check scripts/nelyon-production-release.mjs
node --test --test-name-pattern="policy|candidate baseline|malformed stale|actor repository|rerun|canonical JSON" tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: all selected tests PASS and `git diff --check` is silent.

- [ ] **Step 6: Commit Task 1**

```powershell
git add .github/nelyon-production-release-policy.json scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "test(ci): establish release gate policy contracts"
```

### Task 2: Implement byte-safe Git delta and migration enforcement

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: validated policy/request and a supplied `runGit(args, options)` adapter.
- Produces: `parseNameStatusZ(buffer)`, `resolveGitState(input)`, `classifyChangedPaths(changes)`, and `validateMigrationDelta(input)`.

- [ ] **Step 1: Add failing Git and migration tests**

Add tests named:

```js
test("NUL name-status parsing preserves spaces tabs and Unicode", () => {});
test("unsupported rename copy deletion symlink submodule and unknown supabase paths deny", () => {});
test("approved SHA must equal fetched origin main and descend from baseline", () => {});
test("only strictly newer added timestamped migrations are releasable", () => {});
test("modified deleted renamed duplicate and out-of-order migrations deny", () => {});
test("remote pending migrations must equal the manifest set exactly", () => {});
```

Use temporary Git repositories for ancestry and stale-main tests; do not
modify the real repository.

- [ ] **Step 2: Run Task 2 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="NUL name-status|unsupported rename|approved SHA|strictly newer|modified deleted|remote pending" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the Git and migration functions are absent.

- [ ] **Step 3: Implement the Git and migration interfaces**

Implement:

```js
export function parseNameStatusZ(buffer);
export function resolveGitState({ cwd, baselineSha, approvedSha, expectedRepository, runGit });
export function classifyChangedPaths(changes);
export function validateMigrationDelta({ changes, baselineLatestMigration, remoteMigrations, dryRunPending });
```

Use `git diff --name-status -z --find-renames=0 --find-copies=0`. Deny every
status except supported regular-file additions/modifications, and deny a
productive path whose filesystem type is not an ordinary file or directory.

- [ ] **Step 4: Run Task 2 tests and regression subset**

Run:

```powershell
node --test --test-name-pattern="NUL name-status|unsupported rename|approved SHA|strictly newer|modified deleted|remote pending|candidate baseline" tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): enforce exact release git delta"
```

### Task 3: Resolve function configuration, shared consumers, and reproducibility

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: classified productive paths and baseline/approved file readers.
- Produces: `parseFunctionConfig(toml)`, `parseModuleSpecifiers(source, path)`, `buildFunctionGraph(files)`, `resolveAffectedFunctions(input)`, `analyzeFunctionReproducibility(input)`, and `classifyRisk(input)`.

- [ ] **Step 1: Add failing function-graph and risk tests**

Add tests named:

```js
test("only exact config.toml function declarations are managed", () => {});
test("bdag-economy and undeclared functions are denied", () => {});
test("direct and multi-hop shared imports propagate to all consumers", () => {});
test("literal dynamic imports resolve while nonliteral imports deny", () => {});
test("unresolved escaping and ambiguous imports deny", () => {});
test("floating supabase-js blocks every affected function", () => {});
test("verify_jwt changes and false values are high risk", () => {});
test("finance webhook BDAG media auth moderation and gate authority are high risk", () => {});
```

- [ ] **Step 2: Run Task 3 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="config.toml|bdag-economy|multi-hop|dynamic imports|unresolved escaping|floating supabase|verify_jwt|finance webhook" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the graph/parser exports are absent.

- [ ] **Step 3: Implement exact config and import-graph analysis**

Implement the declared interfaces using only Node built-ins. Parse only the
TOML subset actually needed for `[functions.<name>]`, `verify_jwt`, and
deploy-relevant scalar keys; duplicate sections/keys or unsupported ambiguous
syntax deny. Parse static `import`, `export ... from`, and literal
`import()`; resolve relative extensions using an exact allowlist and reject
non-literal dynamic imports.

- [ ] **Step 4: Implement reproducibility and risk classification**

External `npm:`, `jsr:`, and HTTP(S) specifiers must include an immutable
version under the policy rules. Treat `https://esm.sh/@supabase/supabase-js@2`
as floating and blocking. Return structured findings with `severity`, `code`,
`path`, `resource`, and `message`; never downgrade an unknown finding.

- [ ] **Step 5: Run Task 3 tests and all helper tests**

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: all current tests PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): resolve exact Supabase release scope"
```

### Task 4: Build the canonical manifest, artifact envelope, and replay checks

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 findings.
- Produces: `buildManifest(input)`, `writeManifestBundle(input)`, `verifyManifestBundle(input)`, `validateReleaseHistory(input)`, and CLI command `plan`.

- [ ] **Step 1: Add failing manifest and artifact-security tests**

Add tests named:

```js
test("manifest contains exact identity delta resources risks and blockers", () => {});
test("governance-only delta reports NO PRODUCTIVE CHANGES", () => {});
test("one-byte manifest or digest alteration denies", () => {});
test("artifact provenance binds run attempt release SHA and compiler digest", () => {});
test("duplicate traversal absolute symlink and unexpected artifact entries deny", () => {});
test("release history pagination detects every retained replay", () => {});
test("a completed release ID stored in policy denies after artifact expiry", () => {});
```

- [ ] **Step 2: Run Task 4 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="manifest contains|governance-only|one-byte|artifact provenance|duplicate traversal|history pagination|artifact expiry" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because manifest interfaces are absent.

- [ ] **Step 3: Implement manifest and safe bundle interfaces**

Implement:

```js
export function buildManifest(input);
export function writeManifestBundle({ manifest, outputDirectory });
export function verifyManifestBundle({ directory, expected });
export function validateReleaseHistory({ releaseId, pages, policy });
```

The directory must contain exactly `manifest.json`, `manifest.sha256`, and
`summary.md`. Verify ordinary files, exact names, no links, exact digest, and
byte-for-byte regenerated manifest equality. Paginated GitHub responses must
carry an explicit `complete=true`; missing pages deny.

- [ ] **Step 4: Add the non-networking `plan` CLI command**

Implement:

```text
node scripts/nelyon-production-release.mjs plan
  --policy <path>
  --request <json-path>
  --remote-evidence <json-path>
  --history <json-path>
  --output <directory>
```

Exit `0` for an allowed plan or `NO PRODUCTIVE CHANGES`, exit `2` for a
policy denial, and exit `1` for an operational error. Emit no secret or raw
token and write machine outputs only inside the literal output directory.

- [ ] **Step 5: Run Task 4 tests and CLI smoke**

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
node scripts/nelyon-production-release.mjs --help
git diff --check
```

Expected: tests PASS; help lists only `plan`, `revalidate`, `verify-gate`, and
`postcheck`; no mutating CLI command exists.

- [ ] **Step 6: Commit Task 4**

```powershell
git add scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): produce immutable production manifests"
```

### Task 5: Bind Environment approval and current Supabase-toggle evidence

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: verified manifest bundle plus GitHub Environment, branch-policy, approval-history, and active-run JSON.
- Produces: `buildApprovalToken(input)`, `verifyEnvironmentSnapshot(input)`, `verifyApprovalHistory(input)`, `verifyAutoDeployEvidence(input)`, `verifyConcurrency(input)`, and CLI command `verify-gate`.

- [ ] **Step 1: Add failing approval-binding tests for observation 1**

Add tests named:

```js
test("approval token binds run attempt environment release SHA and digest", () => {});
test("approval from another run attempt environment or manifest denies", () => {});
test("historical approval cannot validate a rerun", () => {});
test("missing wrong duplicate rejected or bypass approval denies", () => {});
test("approval pagination must be complete", () => {});
test("environment requires only owner reviewer self-review off main-only and no admin bypass", () => {});
```

The exact owner comment contract is:

```text
NELYON-APPROVE run=<run_id> attempt=<run_attempt> env=<environment_id> release=<release_id> sha=<approved_sha> manifest=<sha256> auto_deploy_evidence=<evidence_id> auto_deploy_sha256=<evidence_sha256>
```

- [ ] **Step 2: Add failing fresh-toggle tests for observation 2**

Add tests named:

```js
test("release requires owner confirmation of current auto-deploy-off evidence", () => {});
test("toggle evidence older than 900 seconds denies", () => {});
test("future evidence beyond 60 seconds clock skew denies", () => {});
test("mismatched evidence ID digest project branch or approval comment denies", () => {});
test("plan_only and gate_proof never require Supabase deployment secrets", () => {});
```

- [ ] **Step 3: Run Task 5 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="approval token|another run|historical approval|missing wrong|approval pagination|environment requires|current auto|older than|future evidence|mismatched evidence|never require" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the gate-evidence interfaces are absent.

- [ ] **Step 4: Implement Environment, approval, and toggle verification**

Implement:

```js
export function buildApprovalToken(input);
export function verifyEnvironmentSnapshot({ environment, branchPolicies, expected });
export function verifyApprovalHistory({ approvals, expectedToken, owner, environmentId, complete });
export function verifyAutoDeployEvidence({ evidence, approval, now, maxAgeSeconds = 900, maxFutureSkewSeconds = 60 });
export function verifyConcurrency({ runs, currentRunId, complete });
```

Require the approval endpoint for the current `run_id`, exact comment token,
current `run_attempt`, exact Environment ID/name, owner login, `approved`
state, manifest digest, SHA, release ID, and evidence identity. An admin
bypass has no matching approval and therefore denies.

- [ ] **Step 5: Implement `verify-gate` and run Task 5 tests**

`verify-gate` consumes JSON files fetched by the workflow, never fetches the
network, and writes a canonical `gate-proof.json`. It must reject incomplete
pagination and must not read Supabase secrets in `gate_proof` mode.

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): bind owner approval to exact release attempt"
```

### Task 6: Make baseline verification a separate non-self-authorizing transition

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: canonical read-only production evidence and the candidate policy.
- Produces: `buildBaselineEvidence(input)`, `verifyBaselineEvidence(input)`, and `proposeVerifiedBaseline(input)`; none writes the policy file automatically.

- [ ] **Step 1: Add failing baseline tests for observation 3**

Add tests named:

```js
test("candidate to verified requires exact migrations functions config finance cron and health evidence", () => {});
test("Git SHA equality alone cannot verify baseline", () => {});
test("workflow actor and workflow runtime cannot promote baseline", () => {});
test("verified baseline requires owner reviewer and a separate policy commit", () => {});
test("environment policy digest must match exact reviewed policy bytes", () => {});
test("baseline advancement records prior release ID manifest and evidence digests", () => {});
test("partial paginated or source-ambiguous evidence keeps affected resources blocked", () => {});
```

- [ ] **Step 2: Run Task 6 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="candidate to verified|SHA equality|cannot promote|separate policy|policy digest|baseline advancement|source-ambiguous" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because baseline transition functions are absent.

- [ ] **Step 3: Implement pure baseline evidence and transition proposal**

Implement:

```js
export function buildBaselineEvidence(snapshot);
export function verifyBaselineEvidence({ candidate, evidence, expected });
export function proposeVerifiedBaseline({ policy, evidence, owner, source = "owner-control-plane" });
```

`proposeVerifiedBaseline` returns proposed JSON bytes and digest but never
writes. It requires source `owner-control-plane`, owner `andressan101989`,
complete read-only evidence, and no workflow runtime marker. Store separate
digests for migration inventory, managed/unmanaged function inventory,
function-source parity, config/`verify_jwt`, cron/security, and finance.

- [ ] **Step 4: Run Task 6 tests and all helper tests**

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: PASS. Policy remains `candidate`; tests prove no helper command can
promote it.

- [ ] **Step 5: Commit Task 6**

```powershell
git add .github/nelyon-production-release-policy.json scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): require external production baseline authority"
```

### Task 7: Attribute finance changes without blocking legitimate concurrent traffic

**Files:**
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: sanitized read-only pre/post finance snapshots produced by explicit SQL in the workflow/runbook.
- Produces: `validateFinanceSnapshot(snapshot)`, `classifyFinanceWindow(input)`, and `verifyFinancePostcheck(input)`.

- [ ] **Step 1: Add failing finance-concurrency tests for observation 4**

Add tests named:

```js
test("unchanged counters are not required when legitimate concurrent transactions reconcile", () => {});
test("database timestamp and created_at id watermarks assign boundary rows once", () => {});
test("every new financial transaction requires balanced matching ledger entries", () => {});
test("release-attributed financial transaction or ledger metadata denies", () => {});
test("changed historical immutable rows frozen policy or platform fee denies", () => {});
test("failed canonical reconciliation denies even when changes appear legitimate", () => {});
test("snapshot count growth is reported separately from integrity verdict", () => {});
```

- [ ] **Step 2: Run Task 7 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="unchanged counters|watermarks|balanced matching|release-attributed|historical immutable|canonical reconciliation|count growth" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the finance interfaces are absent.

- [ ] **Step 3: Implement finance snapshot and attribution interfaces**

Implement:

```js
export function validateFinanceSnapshot(snapshot);
export function classifyFinanceWindow({ before, after, transactions, ledgerEntries, releaseIdentity });
export function verifyFinancePostcheck({ before, after, window, reconciliationResults, expectedPolicy });
```

Snapshots use database `clock_timestamp()` plus the maximum `(created_at,id)`
watermark. The postcheck accepts count/balance movement caused by rows in the
window only when each transaction has valid canonical status/currency,
balanced debit/credit legs tied to its accounts/amount, no C2 release ID/run
ID in transaction or ledger metadata, and all applicable existing
reconciliation functions return zero mismatches. Historical rows at or below
the pre-watermark must retain their digest. Premium policy values remain
exactly `false,false,false,0`.

- [ ] **Step 4: Run Task 7 tests and full helper suite**

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: PASS, including a fixture where transaction/entry counts increase
legitimately without causing a false deployment failure.

- [ ] **Step 5: Commit Task 7**

```powershell
git add scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): reconcile concurrent finance activity safely"
```

### Task 8: Implement the manual workflow and its static security contract

**Files:**
- Create: `.github/workflows/nelyon-production-release.yml`
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: all Tasks 1–7 interfaces.
- Produces: complete `plan`, `revalidate`, `verify-gate`, and `postcheck` CLI commands plus the two-job GitHub workflow.

- [ ] **Step 1: Add failing workflow contract tests**

Add tests named:

```js
test("workflow trigger is exclusively workflow_dispatch with four required inputs", () => {});
test("workflow uses exact immutable action pins Node and Supabase CLI versions", () => {});
test("plan has no production environment secrets or mutating commands", () => {});
test("deploy needs plan uses production and fixed noncancelling concurrency", () => {});
test("plan_only cannot schedule deploy and gate_proof contains no Supabase mutation", () => {});
test("release path revalidates before secrets and before every mutation", () => {});
test("workflow has no contents write force prune bulk deploy or secret logging", () => {});
test("postcheck failure cannot mark success or baseline advancement", () => {});
```

- [ ] **Step 2: Run Task 8 tests and prove RED**

Run:

```powershell
node --test --test-name-pattern="workflow trigger|immutable action|plan has no|deploy needs|plan_only cannot|release path|contents write|postcheck failure" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Implement the `plan` job**

Use `ubuntu-24.04`, the exact pinned checkout/setup/upload actions, global
`permissions: contents: read`, job-only `actions: read` and
`deployments: read`, `fetch-depth: 0`, and `persist-credentials: false`.
Fetch paginated GitHub history read-only, invoke `plan`, append `summary.md`
to `$GITHUB_STEP_SUMMARY`, upload one 90-day artifact, and expose only mode,
digest, risk, productive-change count, blocked state, and approval token data.

- [ ] **Step 4: Implement the protected `deploy` job**

Set:

```yaml
needs: plan
environment: production
concurrency:
  group: nelyon-supabase-production
  cancel-in-progress: false
```

Run for `gate_proof` or an eligible `release`, download only the current run
artifact, re-fetch main, regenerate the manifest, fetch complete Environment,
branch-policy, approval-history, active-run, and cutover-evidence JSON, then
invoke `verify-gate`. For `gate_proof`, write proof and exit before setup-cli
or secret references. For `release`, check required secrets without printing
them, set up pinned CLI, run `supabase ... --help` preflight, obtain read-only
pre-snapshots, run exact dry-run validation, perform only manifest commands,
and require `postcheck` before success.

- [ ] **Step 5: Implement `revalidate` and `postcheck` CLI commands**

Both commands accept only explicit JSON/file arguments. `revalidate` repeats
Git/main/manifest/policy checks. `postcheck` consumes remote evidence and
finance snapshots, emits canonical result/digest, and exits `2` on any failed
invariant. Neither command updates Git or the policy.

- [ ] **Step 6: Run tests and validate YAML with pinned temporary actionlint**

Run all Node tests, then download the exact actionlint ZIP to a fresh
`New-Item -ItemType Directory` temporary path, verify SHA-256 before
extraction, run:

```text
actionlint.exe .github/workflows/nelyon-production-release.yml
```

Delete only that validated temporary directory afterward.

Expected: Node suite PASS; actionlint exits `0`; `git diff --check` is silent.

- [ ] **Step 7: Commit Task 8**

```powershell
git add .github/workflows/nelyon-production-release.yml scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat(ci): establish controlled production release gate"
```

### Task 9: Write the operator runbook and no-mutation evidence procedure

**Files:**
- Create: `docs/runbooks/nelyon-production-release.md`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`

**Interfaces:**
- Consumes: final workflow inputs, policy fields, approval-token format, baseline and finance snapshot contracts.
- Produces: exact human procedure for GitHub configuration, baseline review, cutover, proofs, releases, denial, and recovery.

- [ ] **Step 1: Add failing runbook coverage tests**

Add one test that requires exact sections and literals for:

- single-owner limitations;
- `plan_only`, `gate_proof`, and forbidden C2 `release` execution;
- Environment reviewer/self-review/main branch/no-bypass settings;
- two secret names without values;
- policy digest variable;
- 15-minute per-release auto-deploy evidence renewal;
- exact approval comment token;
- candidate-to-verified baseline procedure;
- concurrent finance attribution and reconciliation;
- forward-only DB correction and Edge rollback;
- stop conditions and zero-mutation postchecks.

- [ ] **Step 2: Run the runbook test and prove RED**

Run:

```powershell
node --test --test-name-pattern="runbook" tests/nelyonProductionReleaseGate.test.mjs
```

Expected: FAIL because the runbook is absent.

- [ ] **Step 3: Write the runbook**

Use commands and UI labels exactly as implemented. State that every future
release requires the owner to visually verify Supabase `Deploy to production`
is OFF, capture a redacted evidence digest/timestamp, update Environment
evidence variables, and paste the exact generated approval token. Clearly
separate configuration variables from secret values and never include an
example secret.

- [ ] **Step 4: Run documentation/security checks**

Run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD" .github scripts tests docs/runbooks/nelyon-production-release.md
git diff --check
```

Expected: tests PASS; matches are only denylist/security text, policy secret
names, or workflow secret references—never values.

- [ ] **Step 5: Commit Task 9**

```powershell
git add docs/runbooks/nelyon-production-release.md tests/nelyonProductionReleaseGate.test.mjs
git commit -m "docs(ci): add production release gate runbook"
```

### Task 10: Verify and record the production baseline read-only

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `docs/runbooks/nelyon-production-release.md` only if the observed evidence format requires clarification

**Interfaces:**
- Consumes: Task 6 baseline functions and authenticated read-only Supabase/GitHub evidence.
- Produces: owner-reviewed verified baseline proposal and policy digest, or a documented STOP with policy left `candidate`.

- [ ] **Step 1: Capture complete read-only baseline evidence**

Using authenticated read-only tools, capture canonical JSON for project
health; exact migration inventory; remote function name/version/status/
`verify_jwt`; source bytes where reliably exposed; declared function config;
cron/security inventory; Premium Finance policy; zero Premium financial
transactions; and the finance/BDAG integrity snapshot. Do not query or print
secret values.

- [ ] **Step 2: Compare local managed functions to remote evidence**

Require all 17 declared functions to have unambiguous remote identity and
record the other remote functions as unmanaged. Record `bdag-economy` as
forbidden/local-only. Mark any source-ambiguous function unreproducible; do
not declare source parity from version number alone.

- [ ] **Step 3: Generate and manually review the verified-policy proposal**

Invoke the pure baseline proposal interface outside GitHub Actions. Review
the exact policy diff, evidence digests, counts, latest migration, managed
function inventory, finance policy, and verifier identity. If any mandatory
evidence is incomplete, keep `baseline.state="candidate"` and STOP before
cutover.

- [ ] **Step 4: Apply the reviewed policy bytes and test**

Only after the owner-reviewed evidence passes, replace the candidate policy
with the exact proposed bytes using `apply_patch`, then run:

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
```

Expected: PASS; `baseline.state="verified"`; release remains denied because
`cutover.state` is still `pending`.

- [ ] **Step 5: Commit verified baseline evidence**

```powershell
git add .github/nelyon-production-release-policy.json docs/runbooks/nelyon-production-release.md
git commit -m "chore(ci): verify production release baseline"
```

### Task 11: Perform complete local verification and independent review

**Files:**
- Review only: all seven authorized artifacts
- Modify only the owning file of a verified defect

**Interfaces:**
- Consumes: Tasks 1–10.
- Produces: a clean, reviewed local branch eligible for external cutover.

- [ ] **Step 1: Run the full focused suite**

Run:

```powershell
node --check scripts/nelyon-production-release.mjs
node --test tests/nelyonProductionReleaseGate.test.mjs
git diff --check
git status --short
```

Expected: all tests PASS; diff check silent; only authorized files differ
from `origin/main`.

- [ ] **Step 2: Re-run pinned actionlint in a validated temporary directory**

Expected: actionlint `1.7.12` exits `0`; the temporary directory is removed;
nothing new is tracked.

- [ ] **Step 3: Audit workflow permissions, triggers, and secret flow manually**

Prove no automatic trigger, `contents: write`, secret in `plan`, mutation in
`gate_proof`, bulk function deploy, `--prune`, force operation, or baseline
self-update exists. Verify every action and CLI version equals Pinned
Toolchain.

- [ ] **Step 4: Review all four mandatory observations against tests**

Map observation 1 to Task 5 approval tests, observation 2 to freshness/comment
tests and runbook, observation 3 to Task 6/10 transition tests, and
observation 4 to Task 7 concurrent-finance fixtures. Any missing evidence is
a defect, not a waiver.

- [ ] **Step 5: Perform fresh code review and repair only verified defects**

Use the required review workflow during execution. For each finding, reproduce
it with a failing test, implement the minimum correction, rerun the full suite,
and commit with a focused `fix(ci): ...` message.

- [ ] **Step 6: Record the final local implementation identity**

Record `git log --oneline origin/main..HEAD`, the tree SHA, policy SHA-256,
test output, actionlint version/checksum, worktree count, stash list, and disk
space. Do not push yet.

### Task 12: Configure GitHub `production` safely

**Files:**
- No repository file changes unless a verified policy/runbook defect is found

**Interfaces:**
- Consumes: committed local policy digest and owner-authenticated GitHub UI/API.
- Produces: verified Environment configuration without running a workflow.

- [ ] **Step 1: Authenticate the owner interactively if required**

Use the GitHub browser/dashboard or an already authorized credential. Do not
request or print a token. Stop if the authenticated login is not
`andressan101989`.

- [ ] **Step 2: Create/update Environment `production`**

Configure exactly one required reviewer `andressan101989`,
`prevent_self_review=false`, selected deployment branch `main` only, and
administrative bypass disabled. Do not run any workflow.

- [ ] **Step 3: Configure non-secret Environment variables**

Set project ref `aewwdlvbwpczqyvkwvvj`, gate armed state, exact committed
`NELYON_RELEASE_POLICY_SHA256`, and placeholder-free cutover evidence fields.
Do not set `cutover=verified` yet.

- [ ] **Step 4: Configure minimum secrets through protected owner UI**

Create only `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` when the owner
has their values. Codex must never read or echo them. If the owner defers
secrets, `gate_proof` may continue but `release` must remain DENY.

- [ ] **Step 5: Verify Environment through read-only REST evidence**

Fetch Environment and branch-policy JSON and run the helper validator.
Expected: exact reviewer, self-review OFF, exact main policy, no bypass, exact
policy digest. STOP on any mismatch.

### Task 13: Disable automatic Supabase production deployment and record cutover evidence

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `docs/runbooks/nelyon-production-release.md` only to record the redacted evidence identifier if the documented format requires it

**Interfaces:**
- Consumes: owner-authenticated Supabase dashboard, verified baseline, verified Environment.
- Produces: current redacted auto-deploy-off evidence and `cutover.state="verified"` policy bytes.

- [ ] **Step 1: Revalidate production before the toggle**

Repeat read-only project health, migration, function, cron/security, Premium
Finance, and finance/BDAG integrity snapshots. Compare with Task 10 using the
concurrency-aware finance verifier.

- [ ] **Step 2: Disable only `Deploy to production`**

In Supabase GitHub Integration for project `aewwdlvbwpczqyvkwvvj`, leave the
GitHub connection and production branch intact and switch only production
auto-deploy OFF. If the UI or authenticated evidence cannot prove the exact
toggle, STOP before any push.

- [ ] **Step 3: Capture redacted cutover evidence**

Record project ref, production branch, observed OFF state, owner identity,
UTC timestamp, and a SHA-256 of the redacted evidence. Record no OAuth token,
secret, or unrelated dashboard data.

- [ ] **Step 4: Update and review policy cutover fields**

Apply the exact evidence ID/timestamp/digest, set `cutover.state="verified"`,
run all tests, calculate the new policy SHA-256, and update the Environment
policy-digest/evidence variables to match. This is an owner control-plane
change; the workflow does not perform it.

- [ ] **Step 5: Commit cutover evidence before push**

```powershell
git add .github/nelyon-production-release-policy.json docs/runbooks/nelyon-production-release.md
git diff --cached --check
git commit -m "chore(ci): record Supabase production cutover"
```

- [ ] **Step 6: Verify auto-deploy remains OFF and origin/main is unchanged**

Expected: authenticated evidence still OFF; `origin/main` still equals
`d02dda37e34493bc73b9f3b34fcd4874ef212911`; all local commits descend from
that SHA. STOP otherwise.

### Task 14: Publish the approved gate and protect `main`

**Files:**
- No additional repository changes

**Interfaces:**
- Consumes: verified OFF evidence, clean tested commits, unchanged origin/main.
- Produces: exact gate commits on main with no automatic Supabase deployment.

- [ ] **Step 1: Final pre-push verification**

Run full tests, actionlint, `git diff --check`, authorized-file allowlist,
`git merge-base --is-ancestor origin/main HEAD`, worktree count, stash list,
and authenticated toggle verification. Confirm no unknown file or commit.

- [ ] **Step 2: Push by normal fast-forward only**

Push the current HEAD directly to `origin/main` only while main remains at the
authorized base and branch protection still permits this cutover window. Do
not force, merge, reset, or push another ref.

- [ ] **Step 3: Verify exact remote SHA and absence of automatic deployment**

Fetch origin, require `origin/main == local HEAD`, then inspect Supabase branch
deployment logs/status and Edge Function versions. Any automatic deployment
or migration is an immediate STOP and incident report.

- [ ] **Step 4: Enable single-owner-compatible main protection**

Require pull requests with zero approving code reviews, conversation
resolution, linear history, admin enforcement when operable, and block force
pushes/deletion. Do not add CODEOWNERS or a rule that requires an unavailable
second identity.

- [ ] **Step 5: Verify protection and future operability**

Read back the branch/ruleset configuration. Confirm direct push is blocked,
owner-created PRs can still merge without a second review, and Environment
remains main-only. Do not publish another commit.

### Task 15: Prove `plan_only` and `gate_proof` without production mutation

**Files:**
- No repository changes

**Interfaces:**
- Consumes: workflow on main, protected Environment, owner UI, verified zero-change production snapshots.
- Produces: auditable workflow run IDs, artifact digests, approval evidence, and post-proof zero-mutation evidence.

- [ ] **Step 1: Capture pre-proof Supabase and finance snapshots**

Record migrations, functions/versions, cron/security, project health, Premium
Finance, and concurrency-aware finance/BDAG state.

- [ ] **Step 2: Dispatch `plan_only`**

Use final main SHA, a unique release ID, `scope_confirmation=PLAN_ONLY`, and
`mode=plan_only`. Expected: PLAN passes, manifest records governance changes
but zero Supabase productive resources, result `NO PRODUCTIVE CHANGES`, and no
Environment/deploy job.

- [ ] **Step 3: Verify `plan_only` caused no mutation**

Compare post-run snapshots with pre-run evidence using the finance window
verifier. Legitimate concurrent transactions may exist only if reconciled and
not release-attributed; migrations/functions/cron/policy remain unchanged.

- [ ] **Step 4: Refresh current auto-deploy-off evidence for `gate_proof`**

Visually verify the toggle remains OFF, create a new redacted evidence
ID/timestamp/digest, and update only the Environment evidence variables. No
Supabase secret is needed by this mode.

- [ ] **Step 5: Dispatch `gate_proof` and observe the approval wait**

Use final main SHA, a new unique release ID,
`scope_confirmation=GATE_PROOF_NO_MUTATION`, and `mode=gate_proof`. Confirm
PLAN completes and the protected job remains pending until owner review.

- [ ] **Step 6: Approve with the exact generated comment token**

The owner opens Review deployments, selects `production`, pastes the exact
token binding run ID, run attempt, Environment ID, release ID, SHA, manifest
digest, and current auto-deploy evidence, then approves. Do not bypass.

- [ ] **Step 7: Verify protected continuation and proof artifact**

Expected: approval-history verification finds exactly the current bound
approval, the job continues only afterward, no Supabase CLI mutation step is
reached, and `gate-proof.json` records the correct identities/digests.

- [ ] **Step 8: Perform final zero-mutation postcheck**

Require unchanged migrations, Edge versions/source evidence, cron/security,
and Premium Finance. Accept only reconciled legitimate concurrent financial
activity; require zero C2-attributed finance/BDAG rows. Confirm auto-deploy is
still OFF.

### Task 16: Final audit and closure report

**Files:**
- No repository change unless a report is explicitly authorized later

**Interfaces:**
- Consumes: Git, GitHub, workflow, approval, Supabase, finance, and workspace evidence from all tasks.
- Produces: the required 33-point C2 final report.

- [ ] **Step 1: Verify repository/workspace integrity**

Record local branch/HEAD, remote main SHA, clean status, worktree count 125,
zero new clones/worktrees, unchanged stash, roadmap hash/parity, and B5
integrity.

- [ ] **Step 2: Verify GitHub final controls**

Record workflow trigger, Environment ID/configuration, reviewer, self-review,
branch restriction, bypass, main protection, secret names without values,
policy digest, plan-only run, gate-proof run, and approval identity.

- [ ] **Step 3: Verify Supabase and finance final state**

Record project health, auto-deploy OFF evidence, unchanged migrations,
unchanged Edge versions, cron/security, Premium Finance values, finance window
classification, zero C2-attributed financial rows, and zero C2 BDAG movement.

- [ ] **Step 4: Confirm prohibited operations remain zero**

Confirm no functional `release`, migration apply, Edge deploy, financial RPC,
B6 work, app/UI/Figma change, force push, clone, branch, or worktree creation.

- [ ] **Step 5: Deliver verdict from evidence only**

Use `DEPLOY-GATE-C2 FINAL PASS — RELEASE GATE ACTIVE` only if every critical
evidence item exists. Use `DEPLOY-GATE-C2 PARTIAL — WAITING FOR REQUIRED HUMAN
ACTION` for an outstanding owner UI/approval step, or `STOP — VERIFIED SAFETY
BLOCKER` for a failed safety condition.
