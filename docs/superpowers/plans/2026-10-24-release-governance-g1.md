# Release Governance G1 Implementation Plan

**Goal:** Remove recurring dashboard screenshot evidence while preserving a fail-closed, explicit owner declaration and every other production release control.

**Architecture:** The protected GitHub Environment provides `SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF`. The canonical release helper validates the exact declaration and emits a truthful `UNAVAILABLE` provider-observation record in gate proof. The workflow no longer decodes or packages time-bound screenshot evidence.

## Task 1: Lock the contract with RED tests

- Replace screenshot freshness/digest tests with declaration tests for exact `OFF`, missing, `ON`, unknown, and truthful unobserved state.
- Add workflow assertions that the protected declaration is passed to every gated mode and that screenshot variables/files are absent from the current workflow.
- Preserve regression tests for SHA, manifest, policy digest, backup, concurrency, Finance OFF, and postcheck failure.
- Add a Snapshot Adapter assertion that it neither consumes nor claims the auto-deploy setting.
- Run the focal suites and record the expected RED failures.

## Task 2: Implement the minimal canonical change

- Add the exact auto-deploy declaration contract to the release policy and remove the 900-second evidence settings.
- Replace runtime screenshot validation with exact declaration validation in the release helper.
- Record expected/declared/observed/independent-verification/risk fields in gate proof.
- Remove current-run screenshot handling from the workflow while keeping immutable historical recovery compatibility.

## Task 3: Update operations documentation

- Replace per-release screenshot instructions with the persistent Environment variable.
- State plainly that the provider setting is not independently observable through a documented API.
- Document fail-closed behavior for missing, `ON`, or unknown declaration values and the compensating controls.
- Preserve the historical cutover evidence only as history.

## Task 4: Verify and independently review

- Run Release Gate and Snapshot Adapter tests, targeted lint/syntax checks, and `git diff --check`.
- Review the diff for removed controls, hidden bypasses, current/historical evidence ambiguity, and F2/Finance changes.
- Obtain independent review and correct all material findings.

## Task 5: Protected integration and postcheck

- Commit and push the focal branch, open a protected PR, wait for required checks, and rebase-merge.
- Register only `SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF` in the protected production Environment.
- Synchronize the protected policy digest only as required for the merged G1 policy bytes.
- Re-read both variables, verify exact values, and run a non-mutating final gate/plan check as appropriate.
- Confirm Finance remains OFF, no Supabase mutation occurred, and F2 release remains pending.
