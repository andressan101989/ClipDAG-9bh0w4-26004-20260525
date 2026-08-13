# MKT-B7B Creator Product Selection / Showcase Execution Log

## Scope and starting state

- Starting SHA: `b831a374c8f8ee3d077a275e54013ce828af45ea`.
- Branch: `codex/mkt-a4b-premium-integration`; local and origin matched; worktree was clean.
- Build: `22`.
- Remote baseline migration: `20260811021000`.
- Remote pre-implementation audit: B7A 36/36, B7F 27/27, B7R 32/32, payments, settlements, LIVE, Ads, and held escrow healthy.

## Current authority and client audit

- Public creator profile route: `app/creator/[id].tsx`; own profile/tools route: `app/(tabs)/profile.tsx`.
- Canonical product detail route: `app/product/[id].tsx`.
- The public creator profile declared a `products` tab type but rendered only Videos and Exclusive tabs.
- Marketplace cart lines were keyed only by `product_id + variant_id`, persisted in AsyncStorage, and merged repeated variants without attribution context.
- Normal checkout always called `create_marketplace_checkout_reservation`; B7A's creator-aware checkout RPC existed but had no Marketplace client integration.
- B7A's seller-approved `marketplace_live_affiliate_offers` and `marketplace_resolve_live_affiliate_offer` are the canonical entitlement/BPS source. Specific-creator offers take precedence over public offers.
- B7A's internal attribution authority derives seller, store, product, creator, and commission BPS server-side and freezes immutable order-item snapshots; B7F and B7R remain the only allocation and reversal authorities.
- Existing client privacy handling is fragmented: `is_private` and `blocked_users` exist, while the public profile itself does not centrally enforce them. The B7B public read authority therefore enforces both bidirectional blocking and private-profile follower access without changing unrelated profile behavior.

## Blockers and resolutions

### BLOCKER 1

BLOCKER NUMBER: 1
STAGE: Initial disposable migration compile
ERROR / SQLSTATE: `No such container: clipdag-marketplace-disposable`; apply wrapper `docker_failed_1`
SYMPTOM: The B7B migration could not be applied immediately after the disposable self-test.
ROOT CAUSE: The self-test intentionally destroys its temporary disposable container after validating schema restore and rollback behavior.
CLASSIFICATION: disposable runtime issue
SOLUTION: Recreate the canonical disposable database before applying B7B.
WHY THIS IS SAFEST: It uses the repository's isolated DBBOOT lifecycle and never targets linked production.
FILES/FUNCTIONS CHANGED: None.
PROOF: Clean create/apply cycle completed and the B7B harness passed all backend, concurrency, financial handoff, reversal, and cleanup assertions.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None after successful recreation and compile.
STATUS: RESOLVED

### BLOCKER 7

BLOCKER NUMBER: 7
STAGE: Read-only linked B7B pre-deploy audit bootstrap
ERROR / SQLSTATE: npm `EACCES`, followed inside the restricted execution sandbox by `LegacyPlatformAuthRequiredError`; audit reported `b7b_remote_secure_connection_failed`.
SYMPTOM: The new audit runner could not use the existing linked Supabase authentication from the restricted subprocess; no database write occurred.
ROOT CAUSE: The new command had not yet been authorized for the same external CLI/network access already granted to the established B7A audit runner. Reusing the warm cache fixed package materialization, but the restricted subprocess still could not access linked authentication.
CLASSIFICATION: disposable runtime issue
SOLUTION: Reuse the established warm B7A Supabase CLI cache, preserve sequential linked CLI execution, redact bootstrap diagnostics, and authorize only the scoped `audit:marketplace-b7b-remote` command for external linked access.
WHY THIS IS SAFEST: It grants only the read-only audit command the access it needs, uses the exact bootstrap already proven for B7A, emits no credentials, and does not alter remote state.
FILES/FUNCTIONS CHANGED: `scripts/audit-marketplace-b7b-remote.mjs`.
PROOF: `npm.cmd run audit:marketplace-b7b-remote -- --expect-pre-b7b` completed at migration `20260811021000`; B7B objects were absent as expected, all legacy reconciliations were healthy, held escrow was 71/71 BDAG, fixture users were zero, and failure hooks were absent.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: Normal transient network/credential availability remains external.
STATUS: RESOLVED

### BLOCKER 6

BLOCKER NUMBER: 6
STAGE: Persistent fixture audit after iterative concurrency failures
ERROR / SQLSTATE: Assertion `persistent_concurrency_fixtures`; observed `12`, expected `0`.
SYMPTOM: Two previously interrupted disposable concurrency runs left synthetic users even though the current run's `finally` cleanup completed.
ROOT CAUSE: Earlier harness failures occurred before the finalized committed-fixture cleanup path was validated, leaving prior-run residue in the reusable disposable container.
CLASSIFICATION: fixture defect
SOLUTION: Destroy and recreate the disposable DB from the canonical remote schema, reapply B7B, and rerun with the finalized `finally` cleanup.
WHY THIS IS SAFEST: A disposable rebuild removes only synthetic local data and proves the harness from a known clean baseline.
FILES/FUNCTIONS CHANGED: None.
PROOF: Final harness must assert zero `b7b-*` fixture users after all scenarios.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None; production was never targeted.
STATUS: RESOLVED

### BLOCKER 5

BLOCKER NUMBER: 5
STAGE: Committed two-connection concurrency fixture setup
ERROR / SQLSTATE: `22023 live_affiliate_invalid_offer`
SYMPTOM: Creating the first seller-approved offer failed only in the committed concurrency fixture.
ROOT CAUSE: Reusable proof helpers set JWT claims with transaction-local scope. In autocommit, that setting expired at the end of the claim statement before the following seller RPC.
CLASSIFICATION: fixture defect
SOLUTION: Set helper JWT claims at session scope; each helper explicitly resets role and subject before its operation.
WHY THIS IS SAFEST: It correctly models independent authenticated sessions without altering production authorization or relying on an open transaction.
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-showcase.mjs`.
PROOF: Committed two-client add/removal/revocation races plus explicit fixture cleanup.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None.
STATUS: RESOLVED

### BLOCKER 4

BLOCKER NUMBER: 4
STAGE: B7F reconciliation inside rollback-only B7B settlement fixture
ERROR / SQLSTATE: `allocation_after_settlement = 2`
SYMPTOM: Exact B7B allocation and settlement rows reconciled economically, but B7F's global timestamp counter reported both allocations.
ROOT CAUSE: The proof intentionally holds setup, payment, and settlement in one long transaction. B7F allocation timestamps use wall-clock time while settlement history uses transaction time, creating a disposable-only ordering artifact that cannot occur across committed production phases.
CLASSIFICATION: fixture defect
SOLUTION: Keep exact row/amount/leg assertions inside the rollback fixture and run the global 27-counter B7F reconciliation after rollback, matching the established B7F proof strategy.
WHY THIS IS SAFEST: It does not weaken or modify deployed B7F reconciliation and still proves both economics and a clean global database state.
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-showcase.mjs`.
PROOF: Exact 78/10/5/7 settlement assertions inside the fixture; B7F 27/27 zero after rollback.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None; artifact is confined to a deliberately uncommitted multi-phase fixture.
STATUS: RESOLVED

### BLOCKER 3

BLOCKER NUMBER: 3
STAGE: B7B reconciliation proof
ERROR / SQLSTATE: Assertion `reconcile_marketplace_creator_showcase_counter_count`; observed `22`, expected `21`.
SYMPTOM: All returned counters were query-derived and zero, but the harness count was stale.
ROOT CAUSE: The migration includes all requested counters plus a distinct selected-entitlement creator-scope invariant, producing 22 counters.
CLASSIFICATION: reconciliation issue
SOLUTION: Correct the proof expectation to 22 and continue asserting every named counter equals zero.
WHY THIS IS SAFEST: It preserves the additional integrity coverage rather than deleting a valid counter to match an arbitrary count.
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-showcase.mjs`.
PROOF: Disposable B7B reconciliation must report 22/22 zero.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None.
STATUS: RESOLVED

### BLOCKER 2

BLOCKER NUMBER: 2
STAGE: B7B disposable security proof
ERROR / SQLSTATE: Assertion `expected_error_missing` while exercising a raw table write through the PostgreSQL-owner proof connection.
SYMPTOM: Changing JWT claims to `authenticated` did not make an owner connection subject to table/function ACLs.
ROOT CAUSE: JWT claim emulation drives `auth.uid()` and RPC policy branches but does not execute PostgreSQL `SET ROLE authenticated`; the owner connection retains owner privileges.
CLASSIFICATION: fixture defect
SOLUTION: Use canonical `has_table_privilege` and `has_function_privilege` checks for raw ACL denial, while retaining JWT-based negative RPC tests for function-internal authorization.
WHY THIS IS SAFEST: PostgreSQL evaluates the exact deployed ACL for the target role without weakening objects or changing the disposable role topology.
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-showcase.mjs`.
PROOF: Focused security scenario and remote audit both require denied authenticated raw mutation/internal-helper execution.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None; RLS remains an additional boundary behind denied table ACLs.
STATUS: RESOLVED

## Remote deployment and post-deploy audit

### Implemented authority and client handoff

- Migration: `20260811022000_marketplace_creator_product_showcase.sql`; no historical B7A, B7F, or B7R migration was modified.
- Normalized showcase rows retain active/removed lifecycle history and the entitlement version selected at add time as audit metadata. New purchase attribution always resolves the current seller-approved public or creator-specific offer.
- `creator_showcase` was added to B7A's constrained source vocabulary. The buyer-safe wrapper accepts only showcase item, optional variant, and idempotency key; creator, product, seller, store, entitlement, and BPS are derived server-side.
- Authenticated creators can discover eligible products and idempotently add, remove, and reorder only their own showcase. Raw table writes remain denied. Public reads are paginated and enforce current product/offer eligibility plus profile privacy and bidirectional blocking.
- The public creator profile conditionally reuses the existing Marketplace product detail route. Attribution is created only on Add to Cart or Buy Now, never on passive showcase rendering.
- Cart persistence stores the opaque attribution ID plus non-authoritative display context. One variant remains one cart line: the same creator context merges quantities, while conflicting creator attribution is rejected and never silently overwrites creator credit.
- Checkout uses the existing reservation RPC for zero-attribution carts and B7A's creator-aware reservation RPC for mixed attributed/unattributed carts. The client never submits BPS, commission amount, seller net, platform fee, or creator payout.

### Local/disposable financial proof

- Clean DBBOOT create/verify/apply completed. The B7B proof passed eligible discovery, public/specific-offer isolation, add/remove/reorder, idempotency, offer replacement, removal/revocation lifecycle, security, and two-connection races.
- B7B reconciliation: 22/22 real query counters zero; persistent B7B fixtures: zero.
- Exact same-store B7B handoff: one order, two showcase attributions, two B7A item snapshots, two B7F allocations, and four settlement legs totaling seller 78, platform 10, creator X 5, creator Y 7, gross 100 BDAG.
- Exact B7R refund: buyer +100 BDAG with all four original economic legs reversed. Insufficient creator balance returned `money_moved=false` with no partial movement.
- B7A regression: 36/36 zero. B7F regression: 27/27 zero. B7R regression: 32/32 zero. Held refund, manual review, `release_seller`, LIVE affiliate/own-product, lifecycle, shipping, publication, fixture cleanup, promotions, analytics, runtime, Ads finance, Ads eligibility, Ads finalization, and Ads delivery/events passed unchanged.
- Node tests: 605 passed, 0 failed. Focused ESLint: 0 errors (13 pre-existing warnings in modified legacy profile screens). TypeScript: 187 existing unrelated baseline diagnostics, zero from B7B-modified files. iOS export passed. Build remains 22. No EAS.
- Production source audit found no fixture/test/debug/mock hooks, special identities, test GUCs, client commission authority, or hardcoded reconciliation success. `git diff --check` passed.

### Remote pre-deploy verification

- Read-only `--expect-pre-b7b` audit passed at latest migration `20260811021000` and confirmed the B7B migration/table/reconciliation were absent before deployment.
- B7A 36/36, B7F 27/27, B7R 32/32, payments, settlements, LIVE, and all Ads reconciliations were healthy. Held escrow expected/actual was 71/71 BDAG with zero difference. B7B fixture users and remote failure hooks were zero/absent.

### Deployment status

- Linked dry-run was exact: only `20260811022000_marketplace_creator_product_showcase.sql`; seeds and roles were empty.
- The migration deployed successfully. Final remote latest migration is `20260811022000`.
- Post-deploy B7B authority checks passed: showcase RLS enabled; authenticated raw mutation denied; scoped management and buyer wrapper grants present; internal B7A and B7F helpers remain private.
- Final remote B7B reconciliation: 22/22 zero. B7A: 36/36 zero. B7F: 27/27 zero. B7R: 32/32 zero.
- Remote payments, settlements, LIVE commissions, Ads delivery, eligibility clock, events, finalization, and finance remained healthy. Held escrow remained expected 71 / actual 71 BDAG with zero shortage, surplus, or difference.
- Remote B7B fixture users: zero. Fixture failure trigger/function: absent.
- MKT-B7B Creator Product Selection / Showcase is CLOSED. B7C Feed/Reels Product Tagging is unblocked but was not started.

## B7B-C Cart Attribution Freshness and Pagination Hardening

### Audit findings and corrections

- Cart freshness risk: the B7B cart treated a matching showcase item and creator as equivalent even when the opaque attribution ID changed. That could discard a newly issued token representing a newer seller-approved entitlement version. The merge rule now requires exact `attributionId` equality. A different token always returns `attribution_conflict`; the original line, quantity, and token remain unchanged. Normal unattributed repeats of an already-attributed line still merge while preserving the existing creator authority.
- Public pagination defect: the profile fetched the initial 24-item page but discarded `nextCursor`. It now stores the cursor, exposes a compact `Ver más` action only while another page exists, requests `fetchCreatorShowcase(creatorId, cursor)`, deduplicates by showcase item ID, restores stable sort order, and uses an in-flight ref to reject double loads. Focus refresh replaces the first page. A `visible=false` response clears products and the cursor, preventing stale private/blocked content.
- Capacity mismatch: management read and reorder supported at most 100 active items, while add could create more. Corrective migration `20260811023000_harden_marketplace_creator_showcase_capacity.sql` preserves the deployed add signature, authorization, fingerprint, command idempotency, offer resolution, and creator advisory lock, then rejects only a genuinely new 101st active item with `marketplace_creator_showcase_limit_reached`. Existing active-product calls and successful retries remain valid. Removed rows do not count; an unavailable but still-active selection continues to consume a slot until explicitly removed.
- Management now shows the active count out of 100 and maps the deterministic limit error to: “Tu escaparate admite hasta 100 productos. Elimina uno antes de agregar otro.”
- Reconciliation adds one real-query `active_showcase_over_limit` counter, bringing B7B to 23 counters. Historical deployed B7A/B7F/B7R/B7B migrations were not modified.

### Proof and regression evidence

- Focused client tests prove exact-token merging, same-creator/different-token conflict, different-creator conflict, unattributed-to-attributed conflict, creator-credit preservation, unchanged original token after conflicts, cursor storage/use, explicit load-more, overlap deduplication, double-load protection, focus replacement, privacy clearing, and limit UX.
- Disposable capacity proof: 100 active selections allowed; new 101st rejected; 100th idempotent retry succeeded; existing active product with a new key returned the existing row; removal reduced active count to 99; a new selection returned it to 100; all 100 reordered with positions 0–99 and no duplicates; one removed historical row did not consume capacity.
- B7B reconciliation: 23/23 zero. B7A: 36/36 zero. B7F: 27/27 zero. B7R: 32/32 zero. Persistent fixtures: zero.
- Exact financial handoff remained seller 78, platform 10, creator X 5, creator Y 7, gross 100 BDAG. B7R refunded buyer +100. Insufficient creator balance remained `money_moved=false` with no partial movement.
- Order lifecycle, shipping/LIVE, publication, fixture finalization, promotions, analytics, runtime, Ads finance, Ads eligibility, Ads finalization, and Ads delivery/events passed unchanged.
- Node tests: 607 passed, 0 failed. Focused ESLint: zero errors; one pre-existing unused helper warning in the legacy public profile. TypeScript: 187 unrelated baseline diagnostics, zero from B7B-C files. iOS export passed. Build remains 22. No EAS.
- Source safety audit: no fixture/test/debug/mock hooks, test GUCs, special fixture IDs, client commission/BPS authority, or hardcoded reconciliation success. `git diff --check` passed.

### Remote pre-deploy state

- Read-only audit passed at latest migration `20260811022000`; B7B-C was absent as expected. Existing B7B 22/22, B7A 36/36, B7F 27/27, B7R 32/32, payments, settlements, LIVE, Ads, and held escrow 71/71 BDAG were healthy. Fixtures and failure hooks were absent.

### B7B-C deployment status

- Linked dry-run was exact: only `20260811023000_harden_marketplace_creator_showcase_capacity.sql`; seeds and roles were empty.
- The corrective migration deployed successfully. Final remote latest migration is `20260811023000`.
- Final remote B7B reconciliation is 23/23 zero, including `active_showcase_over_limit=0`. B7A is 36/36 zero, B7F 27/27 zero, and B7R 32/32 zero.
- Payments, settlements, LIVE commissions, Ads delivery/eligibility/events/finalization/finance, and held escrow expected 71 / actual 71 BDAG remained healthy. B7B fixture users were zero; failure hooks were absent; RLS, grants, raw-write denial, and internal-helper privacy passed.
- MKT-B7B-C hardening and MKT-B7B are CLOSED. B7C is ready but was not started.
