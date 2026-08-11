# MKT-B7F Execution Log

## Scope

MKT-B7F generalizes the deployed single-creator Marketplace commission authority to immutable item-level creator allocations while preserving all existing economics. This log contains aggregate engineering evidence only; it must not contain credentials, access tokens, PII, or production row values.

## Starting state

- Branch: `codex/mkt-a4b-premium-integration`
- Local and origin SHA: `4ea5a8e3dbda425affae7ffd0a1a82c38496a7a0`
- Worktree: clean
- Build: 22
- Docker: healthy
- Disposable schema self-test: passed

## Current creator economy audit

- The deployed creator model is scalar at the payment-allocation and settlement levels: `creator_user_id` plus `creator_commission_amount` represent at most one creator per order.
- `marketplace_apply_live_commission()` runs as a `BEFORE INSERT` trigger on `marketplace_payment_allocations`.
- For `affiliate_product`, the exact deployed formula is `round(marketplace_orders.subtotal * live_session_products.creator_commission_bps / 10000.0, 8)`.
- The commission base is merchandise subtotal. Shipping is excluded.
- Valid deployed commission basis points are 1 through 3000 for affiliate offers; own-product LIVE pins use zero commission.
- Creator commission is funded from seller net: `seller_net_amount = gross_amount - platform_fee_amount - creator_commission_amount`. Gross and platform fee do not change.
- The scalar value freezes at payment-allocation insertion. Settlement later moves the frozen amounts and performs no current-price, current-offer, or percentage lookup.
- The deployed LIVE buy-now function creates one item, one order, and one scalar creator source. B7F preserves that exact caller and timing while adding its normalized item snapshot in the existing `AFTER INSERT` purchase trigger.
- Existing settlement functions created one creator leg. B7F generalizes only that distribution, grouping normalized item allocations by `creator_user_id`.

## B7F compatibility design

- New source of truth: `public.marketplace_order_item_creator_allocations`.
- Cardinality: zero or one economic creator per item; unlimited distinct creators per order.
- Economic snapshot: server-derived item `line_total`, requested basis points, rounded commission, order/payment/allocation/seller/store identities, request key, and SHA-256 fingerprint.
- Freeze window: paid payment plus held payment allocation, before any settlement or refund.
- Parent scalar compatibility:
  - zero creators: null identity, zero amount;
  - one distinct creator: that identity and aggregate amount;
  - multiple creators: null identity and aggregate amount.
- The platform fee and gross remain frozen. Creator commission is deducted only from seller net.
- If all order items have the same creator and basis points, any 8-decimal per-item rounding residual is assigned to the greatest order-item UUID. The aggregate therefore equals the deployed order-level formula exactly.
- Settlement creates one `creator_commission` leg per distinct creator. Legacy held rows created before B7F retain the deployed scalar fallback.
- The internal settlement helper is executable only by its owner, not by `service_role`, authenticated, anon, or public. Public settlement and dispute signatures remain unchanged.
- RLS is enabled. Client roles have no raw table access; service role has read-only table access and invokes the canonical SECURITY DEFINER authority.

## Local financial proof

- A-W scenarios: passed.
- Two-creator example: seller 78, platform 10, creator X 5, creator Y 7, gross 100.
- Same creator across two items: 4 plus 6 aggregates to one creator leg of 10.
- Mixed attribution: the unattributed item receives no allocation.
- Legacy equivalence: exact, including a deliberate one-satoshi rounding residual case.
- Two independent connection races: same request converged; conflicting overlapping requests produced one winner and no duplicate item.
- B7R integration: four original legs reversed, buyer received exactly 100, all refund states resolved, and all 32 B7R counters were zero.
- B7R insufficient creator balance: canonical intermediate review, `money_moved=false`, and zero partial movement.
- B7F reconciliation: 27 real-query counters, all zero.
- Persistent disposable fixtures: zero.

## Regression and build evidence

- B7R reversal proof: passed, including atomic injection, concurrency, security, and 32 zero counters.
- Order lifecycle and scheduled settlement: passed.
- Held refund and `release_seller`: passed.
- Shipping and LIVE attribution: passed.
- Promotions: passed.
- Ads finance, eligibility, finalization, and delivery/events: passed.
- Analytics, runtime, fixture finalization, and publication: passed.
- Node tests: 597 passed, 0 failed.
- Focused ESLint for every modified MJS file: zero diagnostics.
- TypeScript: existing unrelated repository diagnostics remain; no diagnostic references a B7F-modified file.
- iOS export: passed, 3,387 modules.
- Build: 22.
- EAS: not invoked.

## Remote pre-deploy audit

- Latest migration: `20260810180000`.
- B7F migration/table/reconciliation: absent as expected.
- B7F proof fixture users: zero.
- Fixture failure function/trigger: absent.
- Payment reconciliation: healthy; invalid and financial-integrity counters zero.
- Settlement reconciliation: healthy; expected and actual held escrow both 71, difference/shortage/surplus zero.
- B7R reversal reconciliation: all 32 counters zero.
- LIVE commission reconciliation: all 9 counters zero.
- Ads delivery, eligibility, events, finalization, and finance reconciliations: all counters zero.

## Blockers and resolutions

### Blocker 1

- **BLOCKER NUMBER:** 1
- **STAGE:** Remote precheck / `npm.cmd run audit:marketplace-b7r-remote`
- **ERROR / SQLSTATE:** `LegacyPlatformAuthRequiredError: Access token not provided`
- **SYMPTOM:** The read-only audit could not bootstrap a secure linked connection from the current shell.
- **ROOT CAUSE:** Neither an active Supabase CLI login nor `SUPABASE_ACCESS_TOKEN` is available to the process.
- **CLASSIFICATION:** security/privilege issue
- **SOLUTION:** Retried the read-only audit with approved access to the local authenticated Supabase CLI cache.
- **WHY THIS IS SAFEST:** It avoids inventing credentials or weakening authentication while allowing read-only schema analysis and disposable development to proceed.
- **FILES/FUNCTIONS CHANGED:** This execution log only.
- **PROOF:** Both `audit:marketplace-b7r-remote` and `audit:marketplace-b7f-remote -- --expect-pre-b7f` completed successfully with exact migration parity and healthy reconciliations.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None beyond continued reliance on the authenticated CLI cache for deploy operations.
- **STATUS:** RESOLVED

### Blocker 2

- **BLOCKER NUMBER:** 2
- **STAGE:** First disposable migration apply
- **ERROR / SQLSTATE:** Windows `Access is denied` reading the Docker client configuration; runner reported `docker_failed_1`.
- **SYMPTOM:** The SQL candidate could not be handed to the disposable container.
- **ROOT CAUSE:** The restricted process lacked access to Docker's local client configuration.
- **CLASSIFICATION:** disposable runtime issue
- **SOLUTION:** Used the approved disposable runner with Docker access and repeated the apply.
- **WHY THIS IS SAFEST:** It preserved the existing runner's schema-only and transactional guarantees instead of bypassing them.
- **FILES/FUNCTIONS CHANGED:** None.
- **PROOF:** Fresh create, verify, and apply completed cleanly multiple times.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

### Blocker 3

- **BLOCKER NUMBER:** 3
- **STAGE:** First valid canonical allocation request
- **ERROR / SQLSTATE:** SQLSTATE `42702`, `column reference "e" is ambiguous`; initially normalized to `marketplace_creator_allocation_invalid_input` by the draft exception handler.
- **SYMPTOM:** A syntactically valid one-item allocation was rejected.
- **ROOT CAUSE:** A PL/pgSQL JSON loop variable and SQL JSON table alias shared the name `e`.
- **CLASSIFICATION:** migration defect
- **SOLUTION:** Renamed the loop variable to `v_element` and retained unambiguous SQL aliases.
- **WHY THIS IS SAFEST:** It corrects namespace resolution without changing validation, arithmetic, locking, or persistence.
- **FILES/FUNCTIONS CHANGED:** B7F migration; `apply_marketplace_order_item_creator_allocations`.
- **PROOF:** All A-W requests passed, including valid, invalid, retry, conflict, and concurrency cases.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

### Blocker 4

- **BLOCKER NUMBER:** 4
- **STAGE:** Held/refund fixture setup on the disposable schema
- **ERROR / SQLSTATE:** SQLSTATE `42703`, missing `email_confirmed_at`.
- **SYMPTOM:** The legacy proof's user fixture matched linked Supabase auth but not the disposable auth shim.
- **ROOT CAUSE:** The two safe test environments expose different confirmation column names.
- **CLASSIFICATION:** disposable runtime issue
- **SOLUTION:** The proof detects `email_confirmed_at`; otherwise it uses `confirmed_at`.
- **WHY THIS IS SAFEST:** Only fixture construction changes; production authority and auth semantics are untouched.
- **FILES/FUNCTIONS CHANGED:** `scripts/prove-marketplace-held-dispute-refund.mjs`.
- **PROOF:** The held refund, manual review, release seller, security, race, rollback, and reconciliation suite passed locally.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

### Blocker 5

- **BLOCKER NUMBER:** 5
- **STAGE:** Released-dispute regression after B7R
- **ERROR / SQLSTATE:** `marketplace_reversal_requires_post_settlement_review`.
- **SYMPTOM:** A stale proof expected an ordinary pre-settlement buyer dispute to become a post-settlement manual-review refund request after raw fixture reopening.
- **ROOT CAUSE:** Deployed B7R intentionally requires the canonical admin post-settlement review authority.
- **CLASSIFICATION:** fixture defect
- **SOLUTION:** Updated the regression to assert the B7R rejection and absence of a financial decision.
- **WHY THIS IS SAFEST:** It preserves B7R's security boundary rather than weakening post-settlement authority to satisfy an obsolete assertion.
- **FILES/FUNCTIONS CHANGED:** `scripts/prove-marketplace-held-dispute-refund.mjs`.
- **PROOF:** Held refund and `release_seller` remain green; released buyer-dispute misuse is rejected; B7R admin-review reversal passes independently.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

### Blocker 6

- **BLOCKER NUMBER:** 6
- **STAGE:** Regression runner connection selection
- **ERROR / SQLSTATE:** Remote SQLSTATE `428C9`, `cannot insert a non-DEFAULT value into column "confirmed_at"`.
- **SYMPTOM:** The first regression shell omitted `MARKETPLACE_DATABASE_URL`, so a legacy proof used its linked fallback and immediately failed on the first fixture insert.
- **ROOT CAUSE:** The disposable URL was shell-local and was not exported into the new regression process.
- **CLASSIFICATION:** fixture defect
- **SOLUTION:** Explicitly set the localhost:55422 URL for every disposable regression and made the held-refund proof honor and validate it.
- **WHY THIS IS SAFEST:** The failed transaction rolled back before creating a fixture root; subsequent proof execution was guaranteed disposable-only.
- **FILES/FUNCTIONS CHANGED:** `scripts/prove-marketplace-held-dispute-refund.mjs`.
- **PROOF:** The entire applicable proof suite passed sequentially on localhost:55422.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None; remote pre-deploy audit confirmed zero B7F fixture users.
- **STATUS:** RESOLVED

### Blocker 7

- **BLOCKER NUMBER:** 7
- **STAGE:** B7R integration snapshot assertion
- **ERROR / SQLSTATE:** SQLSTATE `42703`, `column "transaction_id" does not exist`.
- **SYMPTOM:** The new proof queried a non-existent ledger-entry column.
- **ROOT CAUSE:** The deployed column is `ledger_entries.txn_id`.
- **CLASSIFICATION:** fixture defect
- **SOLUTION:** Corrected the proof query to use the deployed column name.
- **WHY THIS IS SAFEST:** It changes only observation of the financial write set.
- **FILES/FUNCTIONS CHANGED:** `scripts/prove-marketplace-multi-creator-allocation.mjs`.
- **PROOF:** B7R success and insufficient-balance scenarios both passed with exact transaction, entry, state, and balance assertions.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

### Blocker 8

- **BLOCKER NUMBER:** 8
- **STAGE:** B7F proof refund fixture
- **ERROR / SQLSTATE:** `marketplace_dispute_order_state_conflict`.
- **SYMPTOM:** The fixture attempted to report a problem while the order was only confirmed.
- **ROOT CAUSE:** Buyer dispute creation correctly requires the current shipped/eligible lifecycle state.
- **CLASSIFICATION:** fixture defect
- **SOLUTION:** Advanced the synthetic order through the real processing and shipping authorities before reporting the problem.
- **WHY THIS IS SAFEST:** It exercises the real state machine without weakening its guard.
- **FILES/FUNCTIONS CHANGED:** `scripts/prove-marketplace-multi-creator-allocation.mjs`.
- **PROOF:** Post-refund allocation rejection and the full held-refund regression passed.
- **PRODUCTION ECONOMICS CHANGED:** No.
- **RESIDUAL RISK:** None.
- **STATUS:** RESOLVED

## Deployment record

- Production-authority commit: `a349064` (`feat: add marketplace multi-creator allocation authority`).
- Proof/documentation commit: `bcc1367` (`test: prove and document marketplace multi-creator allocations`).
- Dry-run result: exactly `20260811010000_marketplace_multi_creator_allocation_authority.sql`; no seeds, roles, historical, or unrelated migrations.
- Deployment result: the exact B7F migration applied successfully.
- Remote latest migration: `20260811010000`.
- Remote B7F table and reconciliation function: present.
- Remote authority audit: RLS enabled; authenticated authority denied; client raw mutation denied; internal settlement helper private.
- Remote B7F proof fixture users: zero.
- Remote fixture failure function/trigger: absent.
- Remote B7F reconciliation: 27 of 27 counters zero.
- Remote B7R reconciliation: 32 of 32 counters zero.
- Remote payment reconciliation: healthy, all integrity counters zero.
- Remote settlement reconciliation: healthy; held escrow expected 71, actual 71, difference/shortage/surplus zero.
- Remote LIVE commission reconciliation: 9 of 9 counters zero.
- Remote Ads delivery, eligibility, events, finalization, and finance reconciliations: all counters zero.

## Residual risks

- B7F V1 intentionally supports at most one creator per order item. Splitting one item among multiple creators remains outside scope.
- Allocation is an immutable one-shot freeze for an order. Administrative reallocation is intentionally not provided.
- Historical held single-creator allocations created before B7F settle through the preserved scalar compatibility fallback; new LIVE and canonical B7F allocations use normalized rows.
- No B7A attribution/UI/source expansion was started.

## Final status

All implementation, financial proof, regression, export, dry-run, deployment, privilege, parity, reconciliation, cleanup, and source-safety gates passed. No hard blocker remains.
