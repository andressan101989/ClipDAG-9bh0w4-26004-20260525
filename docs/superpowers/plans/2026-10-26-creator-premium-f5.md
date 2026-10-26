# Creator Premium F5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consented, bounded automatic BDAG subscription renewal and remove the Nelyon Premium playback overlay without changing the canonical wallet, ledger, entitlement or media pipelines.

**Architecture:** A private opt-in mandate and attempt journal feed one bounded `pg_cron` worker, which invokes the existing subscription RPC and its family lock/idempotency/ledger path. Strict client projection and UI expose server truth; the watermark change removes only the app overlay. Release governance attests the exact finance transition and exact cron delta.

**Tech Stack:** PostgreSQL 15/PLpgSQL, Supabase RLS and pg_cron, Deno Edge Functions, React Native/Expo SDK 54, TypeScript, Node test runner, Docker disposable PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-26-creator-premium-f5-design.md`

## Global Constraints

- Existing production subscriptions are never enrolled retroactively.
- No production test charge, refund, balance edit, debt, negative balance or future paid period without a successful charge.
- Reuse `subscribe_creator_premium_plan_v1`, `post_creator_premium_charge_v1`, the canonical ledger, entitlements and reconciliation.
- Fee remains exactly `2000` bps; Finance remains GENERAL; P3 and MEDIA-C1 remain unchanged.
- One migration, one existing Edge function (`bdag-ledger`), one exact pg_cron job; no parallel financial authority.
- All SQL is forward-only, owner/search_path/ACL/RLS hardened, atomic, idempotent and concurrency tested.
- Remove only the Nelyon UI overlay; do not modify provider media.

## Review Focus

- A due mandate racing manual renewal must produce one paid period and one debit; covered by Task 1 concurrent real-Postgres test.
- Cancellation racing cron must prevent future charge while retaining paid access; covered by Task 1 concurrent test.
- A price/version change must pause for re-consent instead of charging; covered by Task 1 plan-snapshot test.
- Failure after a charge attempt must preserve a durable safe outcome without partial ledger state; covered by Task 1 failure/replay tests.
- Legacy v1 clients must continue parsing the old projection while v2 validates the new exact shape; covered by Task 2 contract tests.

---

### Task 1: Canonical mandate, worker and PostgreSQL contract

**Files:**
- Create: `supabase/migrations/<CLI timestamp>_creator_premium_f5_autonomous_subscriptions.sql`
- Create: `tests/creatorPremiumF5AutonomousSubscriptions.test.mjs`
- Create: `tests/creatorPremiumF5Local.integration.mjs`
- Modify: `tests/creatorPremiumF2Local.integration.mjs` only if an existing assertion must reflect the compatible F5 contract

**Interfaces:**
- Consumes: `public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text)`, canonical family advisory key, F4 finance policy and refund/cancel authorities.
- Produces: `public.set_creator_premium_auto_renewal_v1(uuid,uuid,boolean,numeric,integer,text) -> jsonb`, `private.process_creator_premium_auto_renewals_f5_v1(integer) -> jsonb`, strict v2 projection and one exact cron job.

- [ ] Write structural and disposable PostgreSQL tests for opt-in/absence/revocation, no retroactive rows, exact price snapshot, due renewal, insufficient funds, bounded retries, double cron, cron+manual, cron+cancel, cron+refund, replay, plan/price change, actor/content restrictions, entitlement, 80/20 ledger, Finance OFF/GENERAL, RLS/ACL and exact cron.
- [ ] Run the new tests against F4 and record RED failures caused by missing F5 contracts.
- [ ] Create the migration using `npx.cmd supabase migration new creator_premium_f5_autonomous_subscriptions`.
- [ ] Implement private mandate/attempt tables, constraints, guards, deterministic due-slot key, consent RPC, worker, projection, cancellation/refund coordination, ACL/RLS and cron.
- [ ] Run F5 disposable tests and focused F2/F3/F4 finance regression until GREEN.
- [ ] Commit the SQL/test unit.

### Task 2: Edge gateway, strict client contract and subscription UI

**Files:**
- Modify: `supabase/functions/bdag-ledger/index.ts`
- Modify: `services/financial/ledgerClient.ts`
- Modify: `services/creatorPremiumFinanceContracts.mjs`
- Modify: `services/creatorPremiumFinanceContracts.d.mts`
- Modify: `services/creatorPremiumService.ts`
- Modify: `services/creatorPremiumIntegrationState.ts` only for new safe domain messages
- Modify: `app/my-subscriptions.tsx`
- Modify: `app/creator-premium-offer/[contentId].tsx`
- Modify/Create: focused F5 and F2 client contract tests

**Interfaces:**
- Consumes: Task 1 consent RPC and v2 projection.
- Produces: `setCreatorPremiumAutoRenewal({subscriptionId,enabled,expectedPriceBdag,expectedPlanVersion,idempotencyKey})`, exact `auto_renewal` projection types and opt-in/revoke UI.

- [ ] Write failing client/Edge contract tests for strict payloads, forbidden client financial fields, exact projection, stale response protection, explicit confirmation, ON/OFF state and safe error mapping.
- [ ] Run focused tests and record RED.
- [ ] Add the single bdag-ledger action and typed client wrapper; never accept buyer, fee, creator or amount authority from the client beyond expected-value concurrency checks.
- [ ] Add separate v1/v2 strict parsers and types, preserving the v1 contract.
- [ ] Implement server-confirmed toggle, next charge, manual renewal, cancellation and failure copy without redesign.
- [ ] Run client, Edge, TypeScript and ESLint focal checks until GREEN.
- [ ] Commit the client/Edge unit.

### Task 3: Remove the Nelyon Premium overlay

**Files:**
- Modify: `app/creator-premium-viewer/[contentId].tsx`
- Delete: `components/premium/PremiumWatermark.tsx`
- Modify: `tests/creatorPremiumB6ProtectedMedia.test.mjs`
- Modify: `tests/creatorPremiumB6ClientUx.test.mjs`

**Interfaces:**
- Consumes: existing protected image/video viewer.
- Produces: identical private playback and screen protection without the Nelyon text overlay.

- [ ] Change tests to exercise viewer behavior without the overlay while retaining capture prevention, opaque covers, signed playback and entitlement gates; run and record RED.
- [ ] Remove the overlay import/render/marker generation and delete the now-unreferenced component.
- [ ] Run B6 and Premium viewer regressions until GREEN.
- [ ] Commit the watermark unit.

### Task 4: Attest F5 and its exact cron delta

**Files:**
- Modify: `.github/nelyon-production-release-policy.json`
- Modify: `scripts/nelyon-production-release.mjs`
- Modify: `scripts/nelyon-production-snapshot-adapter.mjs`
- Modify: `tests/nelyonProductionReleaseGate.test.mjs`
- Modify: `tests/nelyonProductionSnapshotAdapter.test.mjs`

**Interfaces:**
- Consumes: exact Task 1 migration bytes, function definitions, cron command and Task 2 Edge digest.
- Produces: only `f4_general -> f5_autonomous`, exact HIGH manifest, exact one-job cron transition and postcheck preserving existing commercial facts with zero release-window money movement.

- [ ] Add failing governance tests for the F5 transition, migration/function/guard/cron tampering, extra cron/Edge, missing table ACL/RLS, retroactive rows and unexpected financial movement.
- [ ] Run release-gate and snapshot tests and record RED.
- [ ] Update the shared finance catalog, compiler, policy and adapter without weakening any existing validator.
- [ ] Run all governance tests and mutation cases until GREEN.
- [ ] Commit the governance unit.

### Task 5: Branch verification, protected integration and release

**Files:**
- Modify: baseline/policy attestations only through the repository's protected post-merge and post-release procedures.

**Interfaces:**
- Consumes: Tasks 1–4 commits and exact reviewed source digests.
- Produces: merged feature PR, verified HIGH release, baseline PR and final `NO PRODUCTIVE CHANGES` plan.

- [ ] Run all F5, F2/F3/F4, B4/B6, P3, MEDIA-C1, Auth, Admin, release-gate, snapshot, TypeScript, ESLint and `git diff --check` checks; record PASS/FAIL/SKIP honestly.
- [ ] Obtain independent whole-branch finance/security review; resolve every Critical/Important finding with a fresh RED/GREEN loop.
- [ ] Create and protected-rebase-merge the feature PR; verify remote SHA/tree and exact diff.
- [ ] Create and protected-rebase-merge the post-merge attestation update; synchronize only the authorized policy digest.
- [ ] Run fresh plan-only and gate-proof; require exactly one migration and `bdag-ledger`, HIGH, no unrelated changes.
- [ ] Verify backup, snapshot, Security Advisor, no concurrent release, Finance GENERAL/2000, P3 and MEDIA-C1; run the canonical HIGH release.
- [ ] Postcheck 356 migrations, 34 active Edge functions, exact cron, empty mandate/attempt tables, historical subscription preserved and zero release-time BDAG movement.
- [ ] Promote the production baseline through a separate protected PR, synchronize its policy digest, and require final `NO PRODUCTIVE CHANGES`.
- [ ] Deliver the complete F5 closure report, explicitly distinguishing automated tests, production postchecks and physical QA.
