# Creator Premium B7 Physical QA C1 implementation plan

**Spec:** `docs/superpowers/specs/2026-10-17-creator-premium-b7-physical-qa-c1-design.md`

## Global constraints

- Work only on `codex/creator-premium-b7-physical-qa-c1` from the verified
  `origin/main` base.
- Use TDD for every behavioral change and record RED then GREEN evidence.
- Never reapply B7, deploy unchanged Edge Functions, activate Finance, approve
  Content Safety policy, mutate the three observed Premium rows manually, or expose
  private media/credentials.
- Use the canonical Premium service/editor, one new forward-only migration, the
  protected PR path, the canonical release workflow, and one Expo tunnel.

## Task 1 — Pure presentation and native picker contracts

**Files:**

- Create `services/creatorPremiumPresentation.mjs`
- Create `services/creatorPremiumPresentation.d.mts`
- Create `tests/creatorPremiumC1PhysicalQa.test.mjs`
- Modify Premium hub, offer, subscriptions, editor, and integration-state sources

**Steps:**

1. Write tests for exact two-decimal string formatting, carry rounding, grouping,
   null handling, lifecycle labels/copy/polling/retry/cancel permissions, full-card
   navigation, native Photos video filtering, Files fallback, cancellation, size and
   duration validation, and absence of numeric financial conversion.
2. Run the new test and observe failure because the helper and bindings do not exist.
3. Implement the pure presentation helper and native video asset normalizer.
4. Wire the existing screens to those contracts without changing financial values.
5. Run the focal test and existing Premium client suites.

## Task 2 — Forward-only pending-submission cancellation

**Files:**

- Create `supabase/migrations/20261017193000_creator_premium_c1_submission_cancellation.sql`
- Modify `services/creatorPremiumService.ts`
- Extend `tests/creatorPremiumC1PhysicalQa.test.mjs`
- Create or extend a disposable PostgreSQL integration test

**Steps:**

1. Add source-contract and disposable tests for auth, ownership, lifecycle rejection,
   idempotent draft replay, advisory/row locks, stale-scan invalidation, preserved
   media/commercial bindings, audit fields, ACL, owner, and empty search path.
2. Run them RED before creating the migration/client function.
3. Implement the minimum RPC and canonical service wrapper.
4. Run source-contract and disposable tests GREEN.

## Task 3 — Editor and hub lifecycle actions

**Files:**

- Modify `app/creator-monetization.tsx`
- Modify `app/creator-premium-editor.tsx`
- Modify `services/creatorPremiumIntegrationState.ts`
- Extend `tests/creatorPremiumC1PhysicalQa.test.mjs`

**Steps:**

1. Add failing tests for clickable cards, existing editor route, nested-action event
   isolation, exact action matrix, cancel confirmation, retry-only-on-supported-state,
   no endless polling, deleted history, and truthful policy/provider/legacy copy.
2. Implement the action matrix and one-flight cancellation using the new RPC.
3. Run focal and historical Premium suites GREEN.

## Task 4 — Verification and protected integration

1. Run TypeScript, lint/focal Metro export, Premium B5/B6/B7/C1 suites, Content Safety
   focal suites, Git integrity, Release Gate/Snapshot Adapter (because SQL changed),
   migration disposable tests, `git diff --check`, and duplicate/caller audits.
2. Review the complete branch against the spec; fix Critical/Important findings by
   RED→GREEN and ledger every ruling/deferred minor.
3. Commit focal changes, push the branch, create and attach the protected PR, inspect
   checks/diff, and rebase-merge through the permitted branch protection.

## Task 5 — Canonical release, production postcheck, and Expo replacement

1. Recompute final SHA/tree/policy/blob and prove the manifest contains exactly the
   C1 migration and zero Edge changes.
2. Verify backup, no concurrent release, Finance OFF, Content Safety fail-closed,
   legacy rows, snapshots, and fresh auto-deploy-OFF evidence as required.
3. Dispatch the canonical release and verify the new migration exactly once, RPC
   ACL/owner/definition, unchanged 34 Edge functions, 0 BDAG movement, and preserved
   content rows. Stop on any real gate failure.
4. Stop the old Expo process only when final-main code is ready, start exactly one
   SDK 54 dev-client tunnel from the final tree, verify Metro compile and remote URL,
   and keep it running for the owner’s iPhone retest.

## Review focus

- Cancellation racing with an in-flight scan must never publish cancelled content.
- UI must not confuse server state, policy absence, provider failure, or historical
  deletion, and must not expose unsupported commands.
- Formatting must never pass financial values through floating-point conversion.
- Video selection must default to native Photos while preserving explicit Files and
  every upload limit.
- The release must not include B7 or unchanged Edge functions.

