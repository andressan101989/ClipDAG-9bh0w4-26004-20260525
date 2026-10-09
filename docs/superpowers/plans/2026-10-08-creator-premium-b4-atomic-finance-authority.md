# Creator Premium B4 Atomic Finance Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-authoritative, exactly bound, atomic Creator Premium purchase, initial subscription, cancellation, and full-refund authority while all production finance switches remain disabled.

**Architecture:** Keep `ledger_accounts`, `financial_transactions`, and `ledger_entries` as the only balance/ledger authority. Add immutable Premium financial snapshots and service-role RPCs that resolve policy, price, accounts, and split in PostgreSQL, use the canonical debit/credit primitives, and harden the existing B1 entitlement resolver against exact transaction and ledger legs.

**Tech Stack:** PostgreSQL/Supabase migrations, PL/pgSQL security-definer RPCs, Supabase Edge Functions on Deno, TypeScript/React Native services, Node `node:test`, disposable PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-08-creator-premium-b4-atomic-finance-authority-design.md`

## Global Constraints

- Base and unchanged `origin/main`: `e651aae40cc266e1bf98be4ffff7941973b4b759`.
- Work only on `codex/creator-premium-b4-atomic-finance-authority`; no merge, rebase, squash, amend, or force push.
- Generate exactly one migration with `npx supabase migration new creator_premium_b4_atomic_finance_authority`.
- Reuse only canonical ledger tables/primitives, B1 Premium tables/entitlement, canonical age/account/block authorities, `bdag-ledger`, and `ledgerClient`.
- Do not modify `atomic_ledger_transfer`, Marketplace, Ads, withdrawal/deposit, Stream, R2, bdag-economy, roadmap, UI, or main.
- Production policy remains purchase/subscription/refunds false and fee bps zero; no production Premium fixtures or real BDAG movement.
- No client-supplied financial identity or amount may affect posting.
- Refunds are full and atomic; no negative balances, debt, escrow, partial reversal, or automatic renewal.
- New money-moving RPCs are service-role-only with empty search paths and explicit ACLs.

## Review Focus

- Same idempotency key with a different product must fail before any money mutation; a different key must not double-charge an existing active fact.
- All charge and refund entries must share `financial_transactions.id` as `ledger_entries.txn_id`, bind exact reference and leg metadata, and contain no extra entry.
- Zero-fee charges/refunds must have exactly two entries and never call zero-amount debit/credit.
- Refund source insufficiency at either creator or platform must roll back every prior mutation in that call.
- Entitlement must fail independently for any tampered operation, reference, account, amount, fee, initiator, status, missing/wrong/extra leg, refunded fact, or reversed original transaction.
- `bdag-ledger` must derive actor identity from JWT, reject all client financial fields, and never expose refund actions.

---

### Task 1: B4 Database Contract and Immutable Financial Model

**Files:**
- Create: `tests/creatorPremiumB4AtomicFinance.test.mjs`
- Create via CLI: `supabase/migrations/<generated>_creator_premium_b4_atomic_finance_authority.sql`

**Interfaces:**
- Consumes: B1 Premium tables/helpers/entitlement and canonical ledger tables/primitives.
- Produces: disabled finance policy, plan period snapshot, immutable offer/plan/mapping guards, receipt/period snapshot columns, Premium financial transaction constraints/indexes, age/platform/split/binding helpers.

- [ ] **Step 1: Write static RED tests** for exactly one generated migration, zero parallel wallet/ledger/escrow, disabled singleton policy, all snapshot fields/equations/precision, plan days, immutable guards, Premium-only transaction integrity, explicit ACLs, and unchanged generic ledger primitives.

- [ ] **Step 2: Run RED** with `node --test tests/creatorPremiumB4AtomicFinance.test.mjs` and record the expected missing-migration failures.

- [ ] **Step 3: Generate exactly one migration** with `npx supabase migration new creator_premium_b4_atomic_finance_authority`.

- [ ] **Step 4: Implement schema hardening**: finance policy, plan billing days, receipt/period/cancellation snapshots and refund fields, equations/state checks, active-purchase uniqueness, Premium transaction partial indexes/constraints, RLS/ACLs.

- [ ] **Step 5: Implement immutable guards** for offers, plans, and plan mappings, allowing only draft mutation and valid lifecycle transitions.

- [ ] **Step 6: Implement private helpers** for parameterized 18+ eligibility, exact platform account resolution, split calculation, deterministic account locking, charge/refund composition, reason validation, and exact purchase/period binding.

- [ ] **Step 7: Replace the entitlement resolver** so paid access delegates to exact binding validators while preserving owner, lifecycle, age, block, and account semantics.

- [ ] **Step 8: Run static GREEN** with `node --test tests/creatorPremiumB4AtomicFinance.test.mjs`.

- [ ] **Step 9: Commit** as `feat(premium): add canonical finance integrity`.

---

### Task 2: Atomic Commands and Disposable Financial Proof

**Files:**
- Modify: the single generated B4 migration
- Create: `tests/creatorPremiumB4Local.integration.mjs`
- Create: `tests/creatorPremiumB4LedgerBinding.test.mjs`

**Interfaces:**
- Consumes: Task 1 schema/helpers.
- Produces: purchase, initial subscription, cancellation, purchase refund, and period refund service-role RPCs plus executable evidence of atomicity and exact binding.

- [ ] **Step 1: Write disposable RED tests** for the macro's purchase, zero-fee, failure, idempotency, race, subscription, duplicate, cancellation, immutability, tamper, refund, insufficient-source, and forced-rollback cases.

- [ ] **Step 2: Run RED**: static binding tests fail on missing command bodies; disposable execution fails at missing RPCs.

- [ ] **Step 3: Implement purchase RPC** with internal-authority defense, advisory/row/account locks, server-derived offer/split/accounts, same-key replay/conflict, already-owned no-charge return, one exact canonical charge, and active receipt insertion in one transaction.

- [ ] **Step 4: Implement initial subscription and cancellation RPCs** with mapped-content validation, exact period window/snapshot, relationship duplicate rules, renewal-not-implemented behavior, cancellation replay, and no cancellation money movement.

- [ ] **Step 5: Implement purchase and period refund RPCs** with exact original binding, full three-leg/two-leg reversal, original transaction reversal, fact/subscription state transition, refund replay, and stable insufficient-source failure.

- [ ] **Step 6: Lock down ACLs**: revoke PUBLIC/anon/authenticated/service_role first, then grant only service_role to public command RPCs; private helpers remain postgres-only.

- [ ] **Step 7: Run disposable GREEN** using the discovered Docker/WSL disposable database harness. Prove balances, aggregate conservation, row counts, exact entries, concurrency, tamper denial, and rollback.

- [ ] **Step 8: Run binding/static GREEN** with `node --test tests/creatorPremiumB4AtomicFinance.test.mjs tests/creatorPremiumB4LedgerBinding.test.mjs`.

- [ ] **Step 9: Commit** as `feat(premium): add atomic purchase subscription and refunds`.

---

### Task 3: Canonical Edge Gateway and Client Contract

**Files:**
- Modify: `supabase/functions/bdag-ledger/index.ts`
- Modify: `services/financial/ledgerClient.ts`
- Modify only as needed: `services/creatorPremiumService.ts`
- Create: `tests/creatorPremiumB4ClientFinance.test.mjs`

**Interfaces:**
- Consumes: Task 2 service-role RPCs.
- Produces: three authenticated B4 Edge actions, stable disabled legacy behavior, canonical client helpers with UUID idempotency and no monetary fields, unchanged false finance flag.

- [ ] **Step 1: Write RED Edge/client tests** for JWT-derived actor, UUID validation, payload allowlists, rejection of amount/price/fee/net/bps/creator/account/transaction fields, exact RPC names/arguments, legacy purchase/subscribe disabled behavior, safe error mapping, and no refund Edge route.

- [ ] **Step 2: Run RED** with `node --test tests/creatorPremiumB4ClientFinance.test.mjs`.

- [ ] **Step 3: Extend `bdag-ledger`** with `creator_premium_purchase`, `creator_premium_subscribe`, and `creator_premium_cancel_subscription`; validate exact UUID-only payloads and call the Task 2 RPCs using `user.id`. Replace legacy purchase/subscribe calls with a stable disabled error. Preserve unrelated actions.

- [ ] **Step 4: Extend canonical `ledgerClient`** with Premium purchase/subscribe/cancel helpers that generate UUID idempotency keys and send no financial fields. Do not create another finance client.

- [ ] **Step 5: Preserve feature flags**: `CREATOR_PREMIUM_FINANCE_AVAILABLE=false`; no UI enabling.

- [ ] **Step 6: Run GREEN** for the new suite and existing bdag-ledger/client finance tests.

- [ ] **Step 7: Commit** as `feat(premium): add canonical finance gateway`.

---

### Task 4: Regression, Deployment, and Production Closure

**Files:** No new architecture; only verified corrections found by tests/review.

**Interfaces:**
- Consumes: complete B4 branch and exactly one pending migration.
- Produces: deployed disabled backend authority, `bdag-ledger` source parity, remote branch parity, unchanged production balances, and mandatory evidence report.

- [ ] **Step 1: Run focused Premium suites** for B1/B2/B2-C1/B3/B4, including the disposable B4 database proof.

- [ ] **Step 2: Run existing finance regressions** covering ledger, wallet, withdrawal/deposit/transfer, LIVE gifts, Marketplace, and Ads. No B4-caused failure is allowed.

- [ ] **Step 3: Run global and static verification**: `node --test "tests/*.test.mjs"`, TypeScript baseline comparison with zero B4-file diagnostics, ESLint with zero errors/warnings on changed TS/TSX, and `git diff --check`.

- [ ] **Step 4: Perform a whole-branch security review** against the Review Focus. Because delegation is not authorized for this run, use a separate self-review pass and record that limitation; every Important/Critical correction requires a new failing regression test before the fix.

- [ ] **Step 5: Commit final tests/corrections** as `test(premium): prove atomic finance invariants` if needed.

- [ ] **Step 6: Push the B4 branch normally** and require local/remote parity while `origin/main` remains the approved base.

- [ ] **Step 7: Inspect CLI help and linked dry-run**; require exactly the one generated B4 migration pending. Recheck zero Premium production rows, platform account uniqueness, Edge baseline, and finance baseline immediately before deployment.

- [ ] **Step 8: Deploy exactly the B4 migration**. Require migration count 334, latest B4, policy false/false/false/0, no Premium production facts, and unchanged finance counts/balances/platform balance.

- [ ] **Step 9: Deploy only `bdag-ledger`** if and because its source changed. Verify version/hash and deployed source parity. Manually deploy no other Edge function and never deploy bdag-economy.

- [ ] **Step 10: Run postchecks and advisors**: RPC ACLs, exact disabled policy, zero production money movement/fixtures, Edge parity/drift, security/performance advisors, clean worktree, remote branch parity, unchanged main.

- [ ] **Step 11: Emit the exact mandatory `# CREATOR-PREMIUM-B4 REPORT`** and stop without integrating main, enabling finance, or starting B5.
