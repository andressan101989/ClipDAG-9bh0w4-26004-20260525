# Creator Premium B7 — Full Functional & Commercial Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current authorized workspace. Do not create a branch, clone, or worktree.

**Goal:** Complete Creator Premium moderation, publication, safe commercial discovery, policy-gated purchase/subscription, real subscription management, audited full refunds, creator earnings/analytics, safety reporting, and B6 integration without deploying or activating production finance.

**Architecture:** Extend the existing private Premium domain and admin capability/audit system in one forward-only migration. Keep B4 as the sole money authority and B6 as the sole private viewer. Add only safe read projections and audited command wrappers, adapt the two existing private-media grant functions for admin review, and connect the existing Admin Web/mobile surfaces. All production switches remain off.

**Tech Stack:** PostgreSQL 17 / Supabase migrations and RPCs, Supabase Edge Functions (Deno), Expo 54 / React Native 0.81 / Expo Router, React/TypeScript Admin Web, canonical BDAG ledger, Node test runner, ESLint.

**Spec:** [Creator Premium B7 Design](../specs/2026-10-10-creator-premium-b7-full-functional-commercial-completion-design.md)

## Global Constraints

- Work only in `C:\creator-premium-b1-main-integration` on `codex/creator-premium-b5-creator-management-ux` from `bb152b138a477e4c9047863fb19d64d63fe9158c`.
- Create no branch, worktree, clone, duplicate dependency tree, rebase, merge, reset, clean, force push, production fixture, or deployment.
- Preserve the historical stash and C2 release gate.
- Generate at most one migration with the Supabase CLI; never invent its timestamp.
- Keep `CREATOR_PREMIUM_FINANCE_AVAILABLE = false` and database policy `false / false / false / 0`.
- Add no second Premium tables, ledger, wallet, balance, escrow, entitlement, media provider, review center, report center, or payment gateway.
- Never put private locators or signed grants in SQL projections, navigation, persistence, logs, analytics, reports, or audit metadata.
- Use exact decimal strings at every client boundary; the server owns all prices, fees, account identities, transactions, refunds, and reversals.
- Do not implement renewal, partial refunds, StoreKit, Play Billing, or explicit-content monetization.
- Admin Web static build is required verification; no EAS/native build is authorized.
- Commit only coherent, verified task groups and push only if the feature branch has no automatic preview/production trigger.

## Task 1: Establish B7 RED Contracts and Generate the Single Migration

**Files:** Create `tests/creatorPremiumB7Management.test.mjs`, `tests/creatorPremiumB7Commerce.test.mjs`, `tests/creatorPremiumB7Admin.test.mjs`, `tests/creatorPremiumB7ClientUx.test.mjs`, and `tests/creatorPremiumB7Local.integration.mjs`; generate one B7 migration.

- [ ] Revalidate branch, starting SHA, remotes, clean status, stash, worktrees, disk, C2 workflows, and production read-only baseline.
- [ ] Record current B1–B6 focused baseline and current global historical failures in the same environment where practical.
- [ ] Write RED static tests for one migration, lifecycle/state constraints, submission/review timestamps, no creator publish RPC, exact capabilities/grants, definer search paths, bounded pagination, locks, idempotent audit, safe projections, reporting, refund wrapper, and no new domain tables.
- [ ] Write RED disposable integration cases for review transitions, admin permissions, publication blockers, decision replay/conflict/concurrency, safe reports, canonical commerce data, subscription projection, creator summary, policy-disabled money, isolated B4 charge/refund/reversal/rollback, and B6 entitlement effects.
- [ ] Write RED Edge/Admin/mobile source tests before corresponding code.
- [ ] Run each new suite and record expected missing-contract failures.
- [ ] Run `npx supabase migration new creator_premium_b7_full_functional_commercial_completion` once and verify it is the only new migration.

## Task 2: Implement Canonical Review, Publication, Reporting, and Safe Projections

**Files:** Modify only the generated migration and `services/creatorPremiumService.ts` as required by these contracts.

- [ ] Add `rejected` and bounded current-review metadata to the existing content table; replace, rather than overlap, lifecycle/state constraints.
- [ ] Add indexes only for demonstrated B7 query/foreign-key paths.
- [ ] Insert `creator_premium.review.read`, `creator_premium.review.moderate`, and sensitive `creator_premium.refunds.write`; assign only review capabilities to existing content-admin roles, assign refund write to no role.
- [ ] Replace B5 submission to record `submitted_at`; add an owner-only rejected-to-draft reopen command.
- [ ] Add a private publication blocker that requires B5 media readiness plus active commercial authorities.
- [ ] Add safe keyset admin queue/detail functions and one idempotent decision command for approve/reject/quarantine/remove/restore.
- [ ] Write every decision to existing immutable admin audit with a bound fingerprint; serialize content decisions with advisory and row locks.
- [ ] Extend `reports` vocabulary and existing admin report search/detail safely; add owner-safe Premium report command with bounded enumerated reasons, no private locators, and duplicate-open prevention.
- [ ] Add one safe consumer commerce detail projection and one real subscriber relationship/period projection.
- [ ] Add one exact creator commercial summary derived only from canonical B4 facts and lifecycle rows.
- [ ] Add audited admin purchase/period refund wrappers; narrowly extend B4 internal authority for the exact unassigned write capability while retaining direct RPC revokes and B4 policy/binding checks.
- [ ] Revoke defaults and grant only authenticated management/read commands; keep underlying refunds service-role-only and private helpers private.
- [ ] Run B7 static SQL tests GREEN, full migration-chain syntax/static tests, and disposable integration where available.
- [ ] Self-review SQL for search path, qualification, ACL, deterministic locks, decimal precision, private-data exposure, and no second authority.
- [ ] Commit as `feat(premium): add canonical review and publication` after verified GREEN.

## Task 3: Add Ephemeral Admin Review Grants and Admin Web Moderation

**Files:** Modify `supabase/functions/get-media-url/index.ts`, `supabase/functions/get-stream-playback/index.ts`, `apps/admin-web/src/App.tsx`, `apps/admin-web/src/layout/adminNavigation.ts`, `apps/admin-web/src/lib/adminApi.ts`, and create one focused Admin Premium page module; update report detail routing only as needed.

- [ ] Write/confirm RED tests that admin grants require verified JWT plus `creator_premium.review.read`, content identity, canonical link/purpose/privacy/readiness, 300-second no-store response, and no provider fallback/private locator.
- [ ] Add `admin_review` only to existing Premium content grant inputs; preserve normal B6 entitlement behavior byte-for-contract.
- [ ] Implement strict Admin API response validation for queue, detail, decisions, policy, refund receipts, and temporary grants.
- [ ] Add one capability-routed Premium queue/detail with filters, keyset load, public teaser, creator/media/commercial/report facts, audit history, and lifecycle-valid actions.
- [ ] Keep temporary image/video grants in component memory only; clear on content change/unmount and never render provider identifiers.
- [ ] Add separately gated refund controls requiring `creator_premium.refunds.write` and server `refunds_enabled`; never call B4 refund RPCs directly from the browser.
- [ ] Extend the existing report detail for `creator_premium` and link to the same review detail.
- [ ] Run B7 Admin/Edge tests, existing media-grant tests, admin capability/report regressions, TypeScript/ESLint for changed Admin/Edge files, and the Admin Web static build.
- [ ] Commit as `feat(premium): add audited admin moderation` after verified GREEN.

## Task 4: Connect Consumer Offers, Purchases, Plans, and Real Subscriptions

**Files:** Modify `services/creatorPremiumService.ts`, `services/financial/ledgerClient.ts`, `app/creator/[id].tsx`, `app/my-subscriptions.tsx`, and `app/_layout.tsx`; create `app/creator-premium-offer/[contentId].tsx`.

- [ ] Write/confirm RED client tests for canonical decimal prices, active offer/plan versions, no client amount/account/fee, stable UUID replay, double-click barrier, policy plus product gates, insufficient/already-owned errors, and B6 entitlement refresh.
- [ ] Extend only Premium ledger helpers with optional validated caller idempotency UUIDs; preserve every unrelated ledger action.
- [ ] Implement the content-ID-only commerce route and exact safe projection parsing.
- [ ] Route locked catalog cards to the offer route and entitled cards to B6; never request originals from discovery or offer UI.
- [ ] Render active purchase/plan choices and exact `Cada N días` terms; keep buttons disabled while either finance gate is false and explain availability honestly.
- [ ] Keep one in-memory UUID per ambiguous operation attempt and suppress concurrent taps; after a confirmed server result re-fetch entitlement/library.
- [ ] Rewrite subscriptions to use the real relationship/period projection, real cancellation, exact paid-through and access state, pagination/refresh/error/empty states, and no fake perks/DM quota/subscriber counts/monthly totals.
- [ ] Leave renewal disabled with explicit no-auto-renew copy.
- [ ] Run B7 commerce/client suites plus B1/B4 ledger gateway and B6 catalog/viewer regressions.
- [ ] Commit as `feat(premium): connect consumer commerce and subscriptions` after verified GREEN.

## Task 5: Add Real Creator Earnings, Analytics, and Rejection Recovery

**Files:** Modify `services/creatorPremiumService.ts` and `app/creator-monetization.tsx`; update the editor only if the canonical rejected-reopen route needs a focused entry.

- [ ] Write/confirm RED tests for exact-string amounts, true zero state, completed/refunded/reversed counts, direct purchase per-content metrics, subscription grant counts without fabricated allocation, no view/conversion fiction, and no client arithmetic.
- [ ] Add `Ingresos` to the existing Creator Premium Hub backed by the server summary; render gross, fee, net, reversals/refunds, counts, bounded transactions, and per-content verified facts.
- [ ] Add the `Rechazado` creator lifecycle state, safe current reason, explicit reopen-to-draft flow, and resubmission through existing B5 authority.
- [ ] Preserve Content/Plans workflows and finance-disabled messaging.
- [ ] Run B7 management/client suites and B5 creator-management regression.
- [ ] Commit as `feat(premium): add audited refunds and creator analytics` only if the task has distinct verified code; otherwise include it in the preceding coherent commit.

## Task 6: Verify End-to-End Authority, Regressions, and Delivery Safety

**Files:** Tests and validation evidence only unless a verified in-scope defect requires a focused fix.

- [ ] Run all B7 suites and disposable integration, recording pass/skip/fail separately.
- [ ] Prove admin deny/allow, creator no-self-publish, publication readiness, reject/quarantine/remove/restore, idempotency, concurrency, immutable audit, safe media grants, and report privacy.
- [ ] Prove finance-disabled purchase/subscription/refund, then isolated enabled B4 purchase/subscription/refund/reversal/fee/balance/rollback with no production effects.
- [ ] Prove cancellation/expiry/refund/moderation/suspension change B1 entitlement and B6 hides protected media.
- [ ] Run B1–B6 focused regressions, ledger/economy tests, media/Stream/security tests, and C2 release-gate tests.
- [ ] Run TypeScript; require zero diagnostics in changed files. Run ESLint with zero errors/warnings for all changed source/test files.
- [ ] Run Admin Web static build. Do not run an EAS/native build.
- [ ] Run `git diff --check` and inspect the complete branch diff for private data, fake finance, duplicate authorities, orphan callers, migrations, and C2 drift.
- [ ] Run the global root suite in the same environment and compare with the known 40 historical failures; require zero B7-caused failures.
- [ ] Recheck production read-only: 336 migrations/latest B5, 34 Edge functions, Premium rows/transactions zero, finance `false/false/false/0`, canonical finance balances unchanged except documented unrelated traffic.
- [ ] Recheck workflows/integrations. If push could deploy or create preview resources, keep commits local and report the block. Otherwise normal fast-forward push only to the existing feature branch.
- [ ] Run final whole-branch self-review because delegation is not authorized in this task; document that independent ChatGPT review remains the next gate.
- [ ] Verify local/remote SHA, origin/main unchanged, clean worktree, historical stash preserved, and zero new clones/worktrees.

## Required Final Evidence

Report exact files, generated migration, RED/GREEN commands, disposable-test
status, B1–B6/global baselines, TypeScript/ESLint/Admin build/diff results,
production read-only before/after, no deployment/build/BDAG movement, commits and
SHA, store-policy blockers, unassigned refund capability, renewal limitation,
physical mobile tests PENDING, and the appropriate B7 verdict without claiming
production readiness.
