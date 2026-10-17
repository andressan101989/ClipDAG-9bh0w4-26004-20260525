# Creator Premium Final A2 Security Postcheck Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove or correct the eleven new B7 RPC security findings, bind only demonstrated-safe exceptions, and recover release `39066492485` through the canonical workflow without repeating B7 or redeploying Edge Functions.

**Architecture:** Extend the existing policy, release helper, Snapshot Adapter, workflow, and disposable PostgreSQL harness. Fresh production evidence will attest exact RPC catalog properties and Premium invariants; `postcheck_recovery` will bind the retained original artifacts and run a structurally read-only verification path.

**Tech Stack:** Node.js ESM and `node:test`, GitHub Actions, Supabase Management API read-only endpoints, PostgreSQL/PLpgSQL, Docker disposable PostgreSQL, canonical JSON and SHA-256.

**Spec:** `docs/superpowers/specs/2026-10-17-creator-premium-final-a2-security-postcheck-recovery-design.md`

## Global Constraints

- Production project is exactly `aewwdlvbwpczqyvkwvvj`; repository is exactly `andressan101989/ClipDAG-9bh0w4-26004-20260525`; branch is `main`.
- Source release is run `39066492485`, attempt `1`, release ID `nelyon-b7-autonomous-20261017T202315Z`, source SHA `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb`.
- Gate artifact is ID `12113681896`, name `nelyon-gate-evidence-39066492485-1`, digest `sha256:6413dc245e07f96266501b784313c26d241868bcefe420ae13db9aad0b16960f`.
- Release artifact is ID `12113447451`, name `nelyon-release-39066492485-1`, digest `sha256:c468111c29831e708a6f9545e3276604bc84b879a0a2a01994f1178da3b87099`.
- Original manifest digest is `95700e7ad2221bf113b58da0719f41feed40f76389caeba59e3457d603998045`; pre/post evidence digests are `5866d0a628eb390ed47b21b17c0910387274a213a0d70702fd8253cc143aee38` and `0625cc7c5509b1c48b442fca8cab715bbbcd759ea1dc154044cc574a76cf6ad6`.
- The retained artifact does not contain the original production snapshot bodies. Verify its observation record and recorded digests, then use fresh current evidence; never claim unavailable bytes were replayed.
- Preserve the historical 554-finding cron/security digest `65ea13c1598717b143bbf7f1779f729bf2b3cad05938dc4d42ae0af67a6a694a`; do not promote all 565 current findings.
- B7 migration blob remains `43f014260e0ecfa6f0634e61e1646594bcf13e1d`; never edit or reapply it.
- Never redeploy an Edge Function unless an independently verified divergence requires a separately authorized manifest. The expected path for A2 contains no Edge deployment.
- Finance remains `false / false / false / 0`; no productive finance test, purchase, refund, or BDAG movement is permitted.
- Content Safety remains zero approved and zero active rules; no fabricated scan or publication PASS is permitted.
- Preserve two legacy contents, including one `pending_review` and one `deleted`.
- Use only the existing workflow, release helper, Snapshot Adapter, policy, tests, and runbook. Do not create a parallel authority.
- Keep the primary workspace, stashes, and historical worktrees untouched. Work only in the attached isolated worktree.
- Every code change follows red-green-refactor, every task ends with a focal commit, and no success is claimed without fresh verification output.

## Review Focus

- A source artifact from a different run or attempt must fail even when its name and manifest digest match; Task 5 adds a cross-run provenance test.
- A protected RPC with the same advisor fingerprint but a changed owner, ACL, `search_path`, or definition must fail; Task 3 adds field-by-field attestation drift tests.
- A current advisor set with one approved exception missing or one unknown addition must fail instead of advancing the baseline; Tasks 3 and 4 add exact-set tests.
- Recovery must be unable to reach migration and function commands even if a crafted request carries productive resources; Tasks 5 and 6 add dispatcher and workflow-source tests.
- Legitimate concurrent non-release finance activity must reconcile, while any source-release-attributed movement must fail; Task 5 reuses raw-row finance classification tests for recovery.

## File Responsibility Map

- `tests/creatorPremiumB7Local.integration.mjs`: executable negative and positive authorization proof for the eleven new RPC findings; emits the deterministic test-evidence digest.
- `scripts/nelyon-production-snapshot-adapter.mjs`: fixed Supabase read-only collection, normalization, RPC catalog attestation, Premium-state evidence, and remote snapshot validation.
- `tests/nelyonProductionSnapshotAdapter.test.mjs`: transport, SQL allowlist, normalization, attestation-drift, Advisor-delta, and Premium-state tests.
- `.github/nelyon-production-release-policy.json`: historical Advisor baseline, eleven exact exception authorities, and approved original release source identity.
- `scripts/nelyon-production-release.mjs`: policy/request validation, source-artifact provenance, recovery orchestration, finance verification, and CLI commands.
- `tests/nelyonProductionReleaseGate.test.mjs`: policy, artifact, recovery, CLI-dispatch, workflow-source, and fail-closed regression tests.
- `.github/workflows/nelyon-production-release.yml`: the sole GitHub orchestration path; recovery is a read-only branch inside its existing plan/deploy jobs.
- `docs/runbooks/nelyon-production-release.md`: operator dispatch, evidence, failure, and final handoff procedure.
- The single migration path printed by `npx supabase@2.121.0 migration new harden_creator_premium_b7_rpc_authority`: conditional forward-only repair, created only if Task 1 demonstrates a vulnerability and recorded before editing.

---

### Task 1: Prove the eleven RPC authorization boundaries

**Files:**
- Modify: `tests/creatorPremiumB7Local.integration.mjs:1-578`
- Read only: `supabase/migrations/20261010053524_creator_premium_b7_full_functional_commercial_completion.sql`

**Interfaces:**
- Consumes: existing `docker`, `dockerAsync`, `psql`, `asRole`, `asRoleAsync`, `expectFailure`, and B7 fixture helpers.
- Produces: deterministic `A2_RPC_SECURITY_CASES`, a canonical `A2_RPC_SECURITY_EVIDENCE` object, and its SHA-256 diagnostic for Task 4. Each RPC result is either `SAFE` or `VULNERABILITY_REAL`; no ambiguous result is eligible for policy inclusion.

- [ ] **Step 1: Verify the unchanged harness baseline**

Run: `node --test tests/creatorPremiumB7Local.integration.mjs`

Expected: structural tests PASS and disposable tests SKIP unless `RUN_CREATOR_PREMIUM_B7_LOCAL=1`; no failure.

- [ ] **Step 2: Add the fail-first security matrix test**

Add test `B7 disposable database denies unauthorized access to all eleven A2 RPCs` and the constant `A2_RPC_SECURITY_CASES`. The matrix must name the exact eleven full signatures and require these assertions:

- all eleven deny `anon` at the ACL boundary;
- the six admin RPCs deny authenticated users and administrators lacking the exact capability;
- admin read/search/detail/refund-candidate RPCs return only with `creator_premium.review.read` or `creator_premium.refunds.write` as declared by B7;
- personal list/summary/commerce/reopen/report RPCs require `auth.uid()` and never expose another user's private rows or private media locator;
- invalid status, action, reason, UUID, half-cursor, date range, and null target inputs return the current explicit B7 error;
- failed calls leave content lifecycle, reports, audit rows, finance counters, ledger rows, and balances unchanged;
- admin review replay succeeds only for the same fingerprint and conflicts for a changed payload;
- refund wrappers are denied while Finance is OFF with no ledger movement, then their disposable positive controls prove exact capability and idempotent concurrency after the fixture deliberately enables Finance;
- report concurrency yields one pending report and no duplicate row;
- reopen locks the target, rejects cross-owner/non-rejected/financial-history rows, and never creates a scan or PASS;
- restore queues a fresh Content Safety scan but does not manufacture `verification_status='passed'`.

The deterministic evidence object must include schema version `1`, B7 blob, all eleven exact signatures and fingerprints, ordered case IDs, `result: "PASS"`, and no random fixture IDs or timestamps. Hash canonical UTF-8 JSON with a trailing newline and emit one `t.diagnostic` line named `A2_RPC_SECURITY_EVIDENCE_SHA256` only after every assertion succeeds.

- [ ] **Step 3: Run the structural test and verify it fails before executable assertions exist**

Run: `node --test --test-name-pattern="eleven A2 RPCs|contains executable" tests/creatorPremiumB7Local.integration.mjs`

Expected: FAIL because the new matrix/case IDs are not yet exercised by the disposable test.

- [ ] **Step 4: Implement the minimum disposable fixtures and assertions**

Reuse the existing B7 database and roles. Add only the missing role-without-capability, foreign-owner, invalid-argument, no-side-effect, and concurrency probes. Do not create a second database harness and do not change the B7 migration.

- [ ] **Step 5: Run the complete disposable suite**

PowerShell:

```powershell
$env:RUN_CREATOR_PREMIUM_B7_LOCAL='1'
node --test tests/creatorPremiumB7Local.integration.mjs
Remove-Item Env:RUN_CREATOR_PREMIUM_B7_LOCAL
```

Expected: every B7 test PASS, zero unexpected SKIP, and exactly one `A2_RPC_SECURITY_EVIDENCE_SHA256` diagnostic.

- [ ] **Step 6: Classify the RPCs**

Record the eleven results in the implementation notes. If every row is `SAFE`, continue to Task 3 and mark Task 2 not required. If any row permits unauthorized access or side effects, classify only that row as `VULNERABILITY_REAL` and execute Task 2 before any policy exception work.

- [ ] **Step 7: Commit the executable security evidence**

```powershell
git add tests/creatorPremiumB7Local.integration.mjs
git commit -m "test: prove B7 RPC authorization boundaries"
```

### Task 2: Correct any demonstrated vulnerability forward-only

**Files:**
- Create only if required: the one exact migration path returned by the Task 2 CLI command; do not pre-create or rename it.
- Modify: `tests/creatorPremiumB7Local.integration.mjs`

**Interfaces:**
- Consumes: the exact `VULNERABILITY_REAL` row and failing case from Task 1.
- Produces: one focal forward-only migration and a passing regression for that row. If Task 1 finds no vulnerability, this task produces the explicit result `NO_CORRECTIVE_MIGRATION` and no file change.

- [ ] **Step 1: Gate the task on evidence**

Proceed only when Task 1 has a reproducible unauthorized result. Do not create a speculative migration for an Advisor warning alone.

- [ ] **Step 2: Preserve the failing regression**

Run the exact failing test name from Task 1 and retain its expected denial and no-side-effect assertions.

Expected: FAIL against unchanged B7.

- [ ] **Step 3: Create one migration with the official CLI**

Run: `npx supabase@2.121.0 migration new harden_creator_premium_b7_rpc_authority`; capture the emitted file path and use that exact path consistently in the test and manifest.

- [ ] **Step 4: Implement the minimum forward-only repair**

Implement only the demonstrated repair: narrow ACL, add exact ownership/capability/input/lifecycle enforcement, or replace the vulnerable body with `CREATE OR REPLACE FUNCTION`. Preserve signature and callers unless the proof shows the signature itself is unsafe. Never edit B7, broaden grants, disable RLS, drop data, or enable Finance/Content Safety.

- [ ] **Step 5: Re-run the exact negative and positive controls**

Run the Task 1 disposable command.

Expected: the formerly failing case denies with no side effect, its authorized positive control passes, and the complete suite passes.

- [ ] **Step 6: Commit the correction separately**

```powershell
git add supabase/migrations tests/creatorPremiumB7Local.integration.mjs
git commit -m "fix: harden Creator Premium RPC authority"
```

The later production release manifest may contain only this corrective migration. It must not contain B7 or any Edge Function.

### Task 3: Add exact read-only RPC and Premium-state attestation

**Files:**
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs:1-720`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs:1-1010`

**Interfaces:**
- Produces: `RPC_SECURITY_ATTESTATION_SQL`, `PREMIUM_POSTCHECK_STATE_SQL`, `normalizeRpcSecurityAttestations(rows)`, `validateRpcSecurityAttestations(snapshot, exceptions)`, and evidence sections `rpc_security` and `premium_state`.
- `rpc_security.items[]`: `{schema,name,identity_arguments,argument_types,security_definer,owner,search_path,acl,execute,definition_sha256}` in complete identity order.
- `premium_state`: `{complete,content_safety:{approved_rule_count,active_rule_count,fabricated_pass_count},legacy:{content_count,pending_review_count,deleted_count},relation_security:{items,sha256},sha256}`. `relation_security.items` covers every private Creator Premium relation with exact owner, RLS, FORCE RLS, and ACL state.

- [ ] **Step 1: Write fail-first adapter tests**

Add tests proving:

- both SQL constants pass `assertReadOnlySql` and contain one fixed statement;
- the RPC query is parameterized by exact complete identities and reads only `pg_proc`, `pg_namespace`, roles/ACL expansion, `pg_get_function_identity_arguments`, and `pg_get_functiondef`;
- normalization hashes LF-normalized definition bytes and never emits the full definition;
- overloads remain distinct and deterministic;
- effective execute is exactly `{public:false,anon:false,authenticated:true,service_role:false}` for each approved row;
- missing, duplicate, extra, changed-owner, changed-ACL, changed-search-path, invoker/definer, signature, and definition cases fail;
- Premium state accepts exactly `0` approved, `0` active, `0` fabricated passes, and legacy `2 / 1 / 1`, and rejects every divergence;
- relation-security normalization rejects a missing/extra private Creator Premium relation, owner change, RLS/FORCE RLS change, or ACL change;
- capture makes only the documented GETs and four fixed read-only SQL requests, with credentials redacted from receipts.

- [ ] **Step 2: Run the new adapter tests to verify red**

Run: `node --test --test-name-pattern="RPC security|Premium postcheck|fixed documented" tests/nelyonProductionSnapshotAdapter.test.mjs`

Expected: FAIL because the exports and evidence sections do not exist.

- [ ] **Step 3: Implement the two fixed queries and normalization**

`RPC_SECURITY_ATTESTATION_SQL` returns complete catalog identity, owner, `prosecdef`, canonical `proconfig`, explicit ACL expansion, effective execute booleans, and `pg_get_functiondef`; JavaScript normalizes and hashes the definition before output.

`PREMIUM_POSTCHECK_STATE_SQL` returns counts from `private.content_safety_rules`, `private.creator_premium_contents`, a count of content marked passed without a matching completed valid Content Safety scan, and catalog security state for all private Creator Premium relations. It returns no row bodies or private media locators.

- [ ] **Step 4: Extend capture and validation**

Allow phase `recovery` in addition to `pre` and `post`. Bind both new query digests in `adapter.queries`, include their normalized evidence, validate exact keys, and keep every request on `/database/query/read-only`.

- [ ] **Step 5: Run adapter tests**

Run: `node --test tests/nelyonProductionSnapshotAdapter.test.mjs`

Expected: all adapter tests PASS.

- [ ] **Step 6: Commit adapter evidence support**

```powershell
git add scripts/nelyon-production-snapshot-adapter.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
git commit -m "feat: attest protected RPC security state"
```

### Task 4: Bind exact findings, exceptions, and source release in policy

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs:1-220`
- Modify: `scripts/nelyon-production-release.mjs:1-220`

**Interfaces:**
- Produces: policy schema version `2`, mode `postcheck_recovery`, confirmation `POSTCHECK_RECOVERY_READ_ONLY`, `security_advisor`, and `postcheck_recovery.approved_sources`.
- Produces: `validateSecurityAdvisorPolicy(policy.security_advisor)` and `validateRecoverySource(source)` called by `validatePolicy`.
- Consumes: exact PASS evidence digest from Task 1 and exact definition hashes/ACLs from fresh Task 3 attestation.

- [ ] **Step 1: Write fail-first policy tests**

Assert that policy validation requires:

- baseline count `554` and cron/security digest `65ea13c1598717b143bbf7f1779f729bf2b3cad05938dc4d42ae0af67a6a694a`;
- exactly the eleven full new fingerprints from the specification and never the two preexisting fingerprints;
- one unique complete RPC identity per exception;
- exact Advisor type `authenticated_security_definer_function_executable`, level `WARN`, owner, definer flag, search path, ACL/effective grants, definition hash, functional reason, controls, Task 1 evidence hash, B7 migration/blob/source SHA, and `technical_approval: "verified"`;
- no wildcard, prefix, duplicate, global type allowlist, missing evidence, or unverified approval;
- one approved source containing the exact run/attempt/release/SHA, full artifact IDs/names/digests, manifest digest, pre/post evidence digests, expected B7 migration, and twelve current Edge attestations;
- mode and confirmation arrays include recovery without changing the other contracts.

- [ ] **Step 2: Run the policy tests to verify red**

Run: `node --test --test-name-pattern="policy accepts|Security Advisor exceptions|recovery source" tests/nelyonProductionReleaseGate.test.mjs`

Expected: FAIL on schema version and absent structures.

- [ ] **Step 3: Implement strict validators**

Use exact-key checks and sorted arrays. `validateRecoverySource(source)` must reject incomplete SHA-256, source status other than failed postcheck after successful mutation/capture steps, non-unique function names, any function outside the twelve-item original manifest, and any productive-resource expansion.

- [ ] **Step 4: Populate policy only from verified evidence**

Insert the eleven records only after Task 1 PASS. Populate their current exact catalog attestations from Task 3 evidence. Populate the approved source with GitHub artifact metadata and the fresh current twelve-function version/source/`verify_jwt` attestations. Do not update the historical 554 baseline digest or silently advance release history.

- [ ] **Step 5: Run focused and complete gate tests**

Run:

```powershell
node --test --test-name-pattern="policy|Security Advisor|recovery source" tests/nelyonProductionReleaseGate.test.mjs
node --test tests/nelyonProductionReleaseGate.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit policy authority**

```powershell
git add .github/nelyon-production-release-policy.json scripts/nelyon-production-release.mjs tests/nelyonProductionReleaseGate.test.mjs
git commit -m "feat: bind audited B7 security exceptions"
```

### Task 5: Implement artifact-bound read-only recovery verification

**Files:**
- Modify: `tests/nelyonProductionReleaseGate.test.mjs:900-1935`
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs:383-720`
- Modify: `scripts/nelyon-production-release.mjs:1160-2230`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs:405-720`

**Interfaces:**
- Produces: `verifyRecoveryArtifactProvenance({source,run,artifacts,releaseBundle,gateEvidence})`.
- Produces: `verifyPostcheckRecovery({policy,recoveryRequest,sourceManifest,sourceObservation,currentEvidence,adapterSourceSha256})`.
- Produces CLI commands `verify-recovery-source` and `postcheck-recovery`.
- Consumes: Task 3 attestation validators and Task 4 approved-source policy.

- [ ] **Step 1: Write fail-first provenance tests**

Fixtures must include the exact source request, manifest digest, artifact metadata, and `release-observation.json`. Assert rejection for wrong run, attempt, repository, head SHA, release ID, artifact ID/name/digest, missing file, altered manifest byte, altered observation digest, source step other than migrations/functions/post-snapshot success plus postcheck failure, and unavailable full digest represented by a prefix.

- [ ] **Step 2: Write fail-first recovery-state tests**

Assert success only when:

- current migrations contain B7 exactly once and have count 337, or the exact approved corrective migration state from Task 2;
- all twelve functions equal policy-pinned live versions, source digests, ACTIVE state, and `verify_jwt`;
- no unlisted function changed relative to the approved current inventory;
- subtracting exactly the eleven exceptions from current Advisors reconstructs the historical cron/security digest and leaves no unknown/missing finding;
- every fresh RPC attestation equals its exception record;
- Finance policy, raw-row reconciliation, zero source-attributed movement, Premium state, RLS/FORCE RLS/ACL relation security, project health, cron, and backup checks pass.

Add the five Review Focus cases, including a crafted recovery request carrying productive resources and legitimate concurrent finance rows.

- [ ] **Step 3: Run the recovery tests to verify red**

Run: `node --test --test-name-pattern="recovery|exception attestation|source artifact" tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs`

Expected: FAIL because both exported verifiers and CLI commands are absent.

- [ ] **Step 4: Implement exact provenance verification**

Read only fixed filenames from ordinary directories; reject symlinks, traversal, unexpected archive entries, and duplicate files using the existing bundle safety conventions. Verify metadata before parsing content, then bind the original request, manifest, observation, and evidence digests.

- [ ] **Step 5: Implement current-state recovery verification**

Reuse `verifyFinancePostcheckFromRaw` and adapter validators. Recovery produces canonical sanitized JSON:

`{schema_version:1,result:"POSTCHECK_RECOVERY_SUCCESS",source_run_id,source_release_id,source_sha,current_sha,manifest_sha256,source_artifact_digests,current_evidence_sha256,security_advisor,functions,migrations,finance,premium_state}`.

It must not update policy, release history, or baseline authority.

- [ ] **Step 6: Prove the dispatcher is non-mutating**

The CLI path accepts only policy, current request, verified source directories, current snapshot, and output. Tests must demonstrate it never invokes Git, Supabase CLI, subprocess deployment, or a caller-supplied command.

- [ ] **Step 7: Run both full unit suites**

Run: `node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs`

Expected: all tests PASS.

- [ ] **Step 8: Commit recovery verification**

```powershell
git add scripts/nelyon-production-release.mjs scripts/nelyon-production-snapshot-adapter.mjs tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
git commit -m "feat: verify B7 postcheck recovery read only"
```

### Task 6: Route recovery through the canonical workflow

**Files:**
- Modify: `.github/workflows/nelyon-production-release.yml`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs:1942-2095`
- Modify: `docs/runbooks/nelyon-production-release.md`

**Interfaces:**
- Consumes: `verify-recovery-source`, adapter phase `recovery`, and `postcheck-recovery` from Task 5.
- Produces: one `workflow_dispatch` recovery route and sanitized artifact name `nelyon-postcheck-recovery-${{ github.run_id }}-${{ github.run_attempt }}`.

- [ ] **Step 1: Write fail-first workflow-source tests**

Assert:

- mode options include `postcheck_recovery` and confirmation requires `POSTCHECK_RECOVERY_READ_ONLY`;
- optional input `recovery_source_run_id` is required by runtime validation only for recovery and equals `39066492485` for this approved source;
- jobs retain `actions: read`, `contents: read`, fixed concurrency, main-only identity, and `environment: production`;
- the pinned `actions/download-artifact` invocation downloads both exact artifact names from the source run using `run-id` and `github-token`;
- artifact verification occurs before fresh snapshot capture;
- recovery invokes only adapter `capture --phase recovery` and helper `postcheck-recovery`;
- every migration dry-run/apply, `supabase db push`, setup CLI, function deploy loop, and ordinary release postcheck remains guarded by `mode == 'release'`;
- recovery output upload is sanitized and retained for 90 days.

- [ ] **Step 2: Run workflow tests to verify red**

Run: `node --test --test-name-pattern="workflow.*recovery|postcheck_recovery|no.*mutation" tests/nelyonProductionReleaseGate.test.mjs`

Expected: FAIL because the mode and steps are absent.

- [ ] **Step 3: Add the recovery route**

Keep the current plan/deploy jobs. Plan generates the current request and non-productive governance manifest. Deploy revalidates main and policy after the Environment boundary, downloads current-plan plus exact source artifacts, verifies provenance, captures fresh recovery evidence, runs recovery postcheck, and uploads its result. No generic shell input or additional workflow is permitted.

- [ ] **Step 4: Update the runbook**

Document source eligibility, exact dispatch values, absent historical snapshot bodies, artifact validation, expected read-only calls, stop conditions, output interpretation, optional corrective-migration branch, and final physical-QA handoff. State explicitly that recovery success does not mean `PHYSICAL_PASS`.

- [ ] **Step 5: Run workflow, helper, and adapter tests**

Run: `node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs`

Expected: all tests PASS and workflow static assertions find no recovery mutation path.

- [ ] **Step 6: Commit workflow and operations documentation**

```powershell
git add .github/workflows/nelyon-production-release.yml tests/nelyonProductionReleaseGate.test.mjs docs/runbooks/nelyon-production-release.md
git commit -m "ci: add canonical B7 postcheck recovery"
```

### Task 7: Verify, integrate, and execute recovery

**Files:**
- Modify only if verification finds a defect: the owning file from Tasks 1-6.
- Evidence only: GitHub run artifacts and fresh Supabase read-only snapshots.

**Interfaces:**
- Consumes: completed branch and exact recovery workflow.
- Produces: protected PR/merge, recovery run, independent postcheck evidence, and final A2 verdict.

- [ ] **Step 1: Run the complete local verification set**

```powershell
node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
$env:RUN_CREATOR_PREMIUM_B7_LOCAL='1'
node --test tests/creatorPremiumB7Local.integration.mjs
Remove-Item Env:RUN_CREATOR_PREMIUM_B7_LOCAL
git diff --check origin/main...HEAD
git status --short
rg -n "postcheck_recovery|RPC_SECURITY_ATTESTATION_SQL|PREMIUM_POSTCHECK_STATE_SQL" .github scripts tests docs
```

Expected: all unit and disposable tests PASS, no unexpected SKIP, diff check clean, only scoped files changed, and search results point to the one canonical workflow/helper/adapter plus their tests and documentation rather than duplicate implementations.

- [ ] **Step 2: Perform the conditional corrective release if Task 2 produced a migration**

Create and verify a manifest containing only that new migration, use the protected canonical release route, confirm the migration appears once, and re-run the fresh read-only evidence. Do not include B7 or Edge Functions. If Task 2 was `NO_CORRECTIVE_MIGRATION`, skip this step without creating a run.

- [ ] **Step 3: Reconcile with current main**

Run `git fetch origin`, compare `origin/main`, inspect only the delta since `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb`, and rebase only when it can be done without overwriting unrelated work. Re-run affected tests after any reconciliation.

- [ ] **Step 4: Push and open one protected PR**

Push `codex/creator-premium-final-a2-spec`, open a PR titled `Secure B7 Advisor exceptions and recover postcheck`, attach it to the task, and inspect the complete GitHub diff and checks. No direct main push, force push, auto-merge bypass, or unrelated file is allowed.

- [ ] **Step 5: Merge through the permitted linear-history method**

Use rebase-and-merge only after required checks pass. Verify final remote main SHA/tree, B7 blob, workflow blob, policy blob, and absence of another active release.

- [ ] **Step 6: Coordinate the reviewed policy digest**

Compute SHA-256 over exact merged policy bytes and update only Environment variable `NELYON_RELEASE_POLICY_SHA256` through the official GitHub Environment control plane. Read it back as a digest/name confirmation without exposing any secret value.

- [ ] **Step 7: Dispatch canonical recovery**

Use final main SHA, a unique release ID, mode `postcheck_recovery`, confirmation `POSTCHECK_RECOVERY_READ_ONLY`, and source run `39066492485`. Respect the official `production` Environment behavior. Do not rerun the source release and do not dispatch ordinary `release` unless Task 2 required its separate corrective migration.

- [ ] **Step 8: Verify the recovery result and artifact**

Require workflow success, exact source artifact digests, current Advisor baseline plus eleven attested exceptions, B7 exactly once, twelve unchanged expected Edge Functions, Finance OFF and reconciled, Content Safety fail-closed, legacy `2 / 1 / 1`, healthy project, and no concurrent/unexpected deployment.

- [ ] **Step 9: Capture independent fresh production evidence**

Run the reviewed Snapshot Adapter read-only against final main after workflow completion. Compare its evidence digest and normalized sections with the recovery artifact. Any unknown finding, attestation drift, Finance/Content Safety change, or function/migration mismatch changes the verdict to `REQUIRES_CORRECTION` or `EXTERNAL_ACTION_REQUIRED`.

- [ ] **Step 10: Deliver the consolidated result**

Report initial/final SHA and tree, exact RPC classifications, exception fingerprints and attestations, negative tests, corrective migration if any, PR/merge, recovery run/artifacts, migration and Edge state, Finance, Content Safety, legacy, QA backend, errors corrected, blockers, and next physical QA step. Use `PREMIUM_B7_READY_FOR_PHYSICAL_QA` only if every acceptance condition passes; never report `PHYSICAL_PASS`.
