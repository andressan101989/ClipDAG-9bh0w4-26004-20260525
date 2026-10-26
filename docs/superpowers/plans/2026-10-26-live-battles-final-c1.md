# LIVE Battles Final C1 implementation plan

> Execute in the isolated `codex/live-battles-final-c1` worktree. Preserve all unrelated worktrees, stash, and primary-checkout files.

## Task 1: Pin the baseline and add RED contracts

- Record origin/main, tree, production migration/Edge counts, stale-series aggregate, gifts aggregate, and canonical function signatures.
- Add focused Node contract tests for lifecycle SQL, gift SQL, winner binding, timer anchoring, pair-busy mapping, and the exact release manifest.
- Add a disposable PostgreSQL C1 proof and multi-connection harness covering terminal transitions, completion/invite, gift/close, replay, immutable receipts, ledger/score invariants, ACL/RLS, rollback, and idempotence.
- Run the new tests against the predecessor and retain the expected failures.

## Task 2: Implement one forward-only C1 migration

- Replace the existing series trigger wrapper, invite RPC, and due-series reconciler without changing signatures or public grants.
- Replace both gift RPCs while preserving their ledger, fee, score, and replay contracts.
- Add confirmed-receipt immutability and restrictive retention foreign keys.
- Add strict score/projection winner validation.
- Revalidate and canonically reconcile exactly the eligible stale series; fail closed on scope or finance drift.
- Reassert owners, search paths, ACL, RLS, comments, and invariant checks.

## Task 3: Apply the minimal client correction

- Feed the existing server clock anchor to `LiveBattleHostControls` and remove wall-clock fallback.
- Enforce exact winner/champion identity in the public projection parser for either local side.
- Normalize pair-busy domain handling and safe presentation.
- Do not change Agora, relay, gift visuals, or design.

## Task 4: Repair obsolete test guards without weakening them

- Replace ten whole-`package.json` historical hashes with a shared dependency-contract guard.
- Preserve exact lockfile and deployed-migration hashes.
- Prove script-only package changes do not invalidate dependency integrity and dependency changes do.

## Task 5: GREEN verification and independent review

- Run C1 Node tests, disposable PostgreSQL proofs, concurrency harnesses, all LIVE Battles suites, Agora/Relay/Spectator regressions, ESLint, focal TypeScript, release-gate tests, snapshot-adapter tests, and `git diff --check`.
- Classify every result PASS/FAIL/SKIP; physical device coverage stays NOT TESTED.
- Run independent scope, SQL/finance/security, and client/release reviews. Resolve all Critical/Important findings before integration.

## Task 6: Protected integration and canonical release

- Commit focal changes, push the feature branch, open a protected PR, wait for checks/review, and rebase-merge without force.
- Verify final origin/main SHA/tree.
- Run fresh plan-only and require exactly one migration and zero Edge/config deltas.
- Run gate-proof; require backup, snapshots, policy digest, security, Finance/P3/MEDIA-C1, and concurrency gates.
- Release only the C1 migration through the canonical HIGH workflow.

## Task 7: Postcheck and baseline

- Verify 357 migrations (absent legitimate concurrency), 34 ACTIVE Edge functions, no Edge version changes, the orphan repaired, no new inconsistent series, preserved historical Battle/gift counts, balanced ledger, 35% LIVE fee, and zero release-attributable BDAG movements.
- Verify RLS/ACL/owners/search paths, receipt immutability, cron behavior, project health, and Security Advisor delta.
- Promote the verified baseline through a separate protected PR and synchronize the exact committed policy digest.
- Run a final plan-only and require `NO PRODUCTIVE CHANGES`.

## Task 8: Hand-off

- Produce the required consolidated report and a three-device physical QA matrix for Host A, Host B, and spectator.
- Verdict cannot exceed `LIVE_BATTLES_READY_FOR_PHYSICAL_QA` until real-device evidence exists. Banuba remains a visual-only future extension.
