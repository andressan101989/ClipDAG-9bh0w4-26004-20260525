# Creator Premium F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Complete canonical Creator Premium purchases, manual subscription renewal, cancellation, entitlement/history, earnings, refunds, administration, and reconciliation while production Finance remains OFF.

**Architecture:** Extend B4/B4-C1 and B7. Keep `bdag-ledger` as the only client mutation gateway and the existing ledger/receipts/periods as the only financial authority. Add one forward-only migration for renewal, multiperiod refund semantics, immutable lifecycle evidence, safe projections and read-only reconciliation; then harden the existing mobile/admin callers.

**Spec:** `docs/superpowers/specs/2026-10-24-creator-premium-f2-design.md`

**Non-negotiable constraints:** No flag activation, non-zero fee, real BDAG operation, Stripe, escrow invention, production financial fixture, second commerce system, private-media exposure, P3/MEDIA-C1 change, direct main push, or release without fresh HIGH-risk gates.

## Task 1: Establish RED contracts

**Files:**

- Add: `tests/creatorPremiumF2CompleteMonetization.test.mjs`
- Add: `tests/creatorPremiumF2Local.integration.mjs`
- Modify only as contracts legitimately change: B4/B7 client and governance tests

- [ ] Assert one generated F2 migration and zero Finance activation.
- [ ] Add RED contracts for non-overlapping manual renewal, exact replay, concurrency, relationship lifecycle evidence, multiperiod refund isolation, buyer history, admin read-only supervision, reconciliation, ACL/RLS and direct-credit refund failure.
- [ ] Add RED client contracts for strict receipts, target binding, authoritative read-back, same-key ambiguous retry, dynamic policy and removal of simulated earnings.
- [ ] Run focal tests and record the expected failures before implementation.

## Task 2: Extend the canonical financial authority

**Files:**

- Add via Supabase CLI: `supabase/migrations/<timestamp>_creator_premium_f2_complete_monetization.sql`
- Modify: release governance/snapshot tests only as required by the exact RPC set

- [ ] Replace the global subscriber+plan relationship uniqueness with one partial uniqueness rule for open relationships; each paid period keeps its own immutable relationship row.
- [ ] Replace the implementation behind `subscribe_creator_premium_plan_v1` to support initial charge and explicit non-overlapping renewal under the same locks/idempotency/fee binding.
- [ ] Preserve current plan/price/policy snapshots in each new period.
- [ ] Preserve every cancellation/idempotency record by terminalizing the old relationship and inserting a new relationship on renewal.
- [ ] Fix period refund so only the selected one-period relationship is revoked; later renewed access remains untouched.
- [ ] Preserve full-transaction rollback when refund source balance is insufficient.
- [ ] Add authenticated buyer financial-history projection, creator truthful summary additions, admin read-only commerce projection, and read-only reconciliation.
- [ ] Revoke `PUBLIC`/`anon` and grant only the required authenticated/admin/service role boundaries.
- [ ] Keep all Finance flags false and `platform_fee_bps=0`.

## Task 3: Harden the existing ledger client

**Files:**

- Modify: `services/financial/ledgerClient.ts`
- Add if useful: one pure receipt-contract module under `services/financial/`

- [ ] Define exact purchase, subscription/renewal and cancellation receipt types.
- [ ] Strictly validate UUIDs, decimal strings, booleans, states, target IDs and replay/money semantics.
- [ ] Reject malformed/partial/contradictory responses fail-closed.
- [ ] Keep amounts, fee, creator and accounts absent from client requests.
- [ ] Return safe domain codes without logging receipt/private financial payloads.

## Task 4: Complete authenticated mobile commerce

**Files:**

- Modify: `services/creatorPremiumService.ts`
- Modify: `services/creatorPremiumIntegrationState.ts`
- Modify: `app/creator-premium-offer/[contentId].tsx`
- Modify: `app/my-subscriptions.tsx`
- Modify: `app/my-premium-library.tsx`
- Modify: `app/creator-monetization.tsx`
- Modify: `app/creator/[id].tsx` and `app/creator-premium-viewer/[contentId].tsx` only for proven obsolete finance copy
- Modify: `app/(tabs)/profile.tsx`

- [ ] Remove the permanent local finance gate; use server policy/operations while preserving transactional server enforcement.
- [ ] Require strict receipt + authoritative read-back before success.
- [ ] Reuse the same idempotency key for ambiguous retry; prevent double submit.
- [ ] Add manual renew when eligible; keep auto-renew explicitly unavailable.
- [ ] Present purchase/subscription/refund history and exact decimal strings.
- [ ] Show range/policy/true direct-credit semantics in creator income.
- [ ] Remove likes-derived `$DAG` earnings and all activation copy that can contradict policy.

## Task 5: Complete read-only administration

**Files:**

- Modify existing Admin Creator Premium page/service/types/routes only; do not create a second Finance app.
- Modify SQL migration from Task 2 and focal Admin tests.

- [ ] Add Premium receipt/subscription/period/refund/reconciliation filters and bounded pagination under financial read capability.
- [ ] Keep refund buttons behind the separate unassigned write capability and `refunds_enabled`.
- [ ] Show safe stable domain failures; never show SQL, accounts, private media, or tokens.
- [ ] Prove unauthorized/anon users are denied and read-only admins cannot mutate.

## Task 6: Disable misleading legacy paths

**Files:**

- Modify only callers/routes proven reachable.
- Keep forbidden Edge policy unchanged unless an explicit defense-in-depth source change is necessary.

- [ ] Prove `bdag-economy` remains undeployed/forbidden and legacy `purchase`/`subscribe` return 410.
- [ ] Prevent legacy earnings and subscribe stubs from being reachable as Premium authority.
- [ ] Do not delete compatibility code unless tests prove it unused and safe.

## Task 7: Disposable financial verification

- [ ] Compile the full migration chain in PostgreSQL 17.
- [ ] Prove Finance OFF causes zero transactions/entries/receipts/periods.
- [ ] In a rollback-isolated test only, enable each flag and prove purchase, renewal, cancel, refund, replay, concurrency, insufficient balance and exact fee splits.
- [ ] Prove receipts/entitlements/periods remain consistent and the ledger balances to zero.
- [ ] Prove RLS/FORCE RLS/ACL, caller ownership, Content Safety eligibility and private-media access.
- [ ] Run mobile/Admin unit/static tests, TypeScript, ESLint, Release Gate, Snapshot Adapter, F1 and MEDIA-C1 regressions.
- [ ] Request independent finance/security/code review and correct every verified finding.

## Task 8: Protected integration and gated release

- [ ] Review exact diff, migration, Edge dependency graph, secrets and generated artifacts.
- [ ] Commit focal changes, push the F2 branch, open protected PR, obtain checks/review, and rebase-merge.
- [ ] Verify final `origin/main` SHA/tree.
- [ ] Run canonical `plan_only` and verify one migration plus the exact dependency closure for the changed `bdag-ledger` Edge source; do not deploy unrelated functions.
- [ ] Stop for fresh official auto-deploy-OFF evidence and completed physical backup before any HIGH release.
- [ ] Run `gate_proof`, `RELEASE_HIGH_RISK`, snapshots and read-only postcheck only if every gate passes.
- [ ] Verify Finance OFF/fee zero, P3, MEDIA-C1, zero real transactions, ACL/RLS, Advisor delta and source parity.
- [ ] Promote baseline by a separate protected PR if required and obtain final `NO PRODUCTIVE CHANGES` plan.

## Task 9: Final report

- [ ] Report architecture reused, exact implemented delta, SQL/RPC/Edge/UI/Admin files, RED/GREEN evidence, PR/SHA/tree, release gates/runs, Finance OFF, P3/MEDIA-C1, zero real money, residual direct-credit refund limitation, and next separately authorized activation step.
- [ ] Use `F2_IMPLEMENTED_FINANCE_OFF` only after complete implementation, protected integration and verified postcheck. Otherwise report the exact partial/correction verdict.
