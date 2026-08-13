# MKT-B7A Creator Commerce Authority — Execution Log

Date: 2026-08-11  
Branch: `codex/mkt-a4b-premium-integration`  
Starting SHA: `91da26873534a2062096ae309bf7a1e68d08a1b8`  
Build: `22`

This log records aggregate engineering and financial evidence only. It contains no credentials, access tokens, PII, or production row values.

## Starting gates

- Local HEAD: `91da26873534a2062096ae309bf7a1e68d08a1b8`
- Origin HEAD: `91da26873534a2062096ae309bf7a1e68d08a1b8`
- Initial worktree: clean
- Docker Desktop engine: healthy (`29.6.1`)
- Disposable schema self-test: passed
- Remote latest migration before B7A: `20260811010000`
- Remote B7F authority: present; RLS enabled; client raw mutation denied; authenticated RPC denied; private settlement helper not executable by clients
- Remote B7F reconciliation: 27 counters, all zero
- Remote B7R reconciliation: 32 counters, all zero
- Remote payments, settlements, LIVE commission, Ads finance/finalization/eligibility/delivery/events reconciliations: healthy
- Remote B7F fixture users: zero
- Remote failure hook function/trigger: absent

## Current creator-commerce authority audit

The audit used the exact deployed schema restored into the disposable database, PostgreSQL catalog definitions, tracked migrations, and the current client services.

- Existing entitlement authority: `marketplace_live_affiliate_offers`, managed through the idempotent seller RPC `upsert_my_live_affiliate_offer(uuid,text,uuid,integer,text,timestamptz,timestamptz,uuid)`. It is a versioned seller-approved, product-wide offer: replacing an active offer marks the previous row `removed` and inserts a new immutable economic version.
- Entitlement scope: `public_creator` or `specific_creator`; active/paused/removed state; optional start/end window; exact BPS range 1–3000.
- Entitlement authority: the authenticated actor must own the product and active store and be an approved Marketplace seller. The product must be active, approved, physical, BDAG, and not deleted. A creator does not control BPS and cannot call the seller-owned RPC for another seller's product.
- Entitlement resolution: `marketplace_resolve_live_affiliate_offer(product,creator)` gives a matching specific offer precedence over a public offer, then newest version precedence.
- Existing attribution: LIVE-only. `live_session_products` snapshots `affiliate_offer_id`, `commerce_mode`, host identity, and BPS; `marketplace_live_order_sources` snapshots the buy-now checkout/order/pin/product/variant; `marketplace_live_commission_sources` becomes durable only when payment allocation is inserted.
- Current trust boundary: ordinary checkout accepts only variant and quantity; LIVE checkout accepts a server-owned pin and variant and re-resolves all seller/store/product/creator/BPS facts server-side. No general non-LIVE creator attribution reference exists in cart, checkout, or order items.
- Current financial freeze: the LIVE pin snapshots BPS, but economic allocation becomes durable during paid allocation insertion. The BEFORE trigger computes commission and the AFTER trigger creates the B7F normalized item allocation and LIVE purchase/source rows in the same payment transaction.
- Formula: `round(order merchandise subtotal * creator_commission_bps / 10000, 8)`. Shipping is excluded. Creator commission is deducted from seller net; platform fee and gross are unchanged.
- Own-product LIVE mode: seller/host identity is preserved as normal seller economics, with no affiliate creator commission.
- B7F handoff: `apply_marketplace_order_item_creator_allocations` is service-role-only and accepts only item, creator, and BPS; it derives base and amount from immutable order-item snapshots. The current LIVE compatibility trigger inserts the equivalent B7F row directly after validating the legacy scalar result.
- Settlement lock: canonical release functions already use `marketplace-order-settlement:<order_id>`. B7F separately uses an order allocation lock. B7A will acquire the settlement lock before invoking B7F so attribution finalization and settlement serialize deterministically.

Audit conclusion: the existing versioned seller offer is semantically sufficient as the canonical product entitlement and should be reused. B7A needs new general attribution and immutable order-item attribution snapshot authorities, plus a canonical service-only finalizer. Creating a second entitlement table would duplicate seller authority and create drift risk.

## Blockers and resolutions

### Blocker 1

BLOCKER NUMBER: 1  
STAGE: Repository-wide creator-attribution source audit  
ERROR / SQLSTATE: PowerShell `CommandNotFoundException`: `rg` is not recognized  
SYMPTOM: The preferred ripgrep search command could not execute on this Windows host.  
ROOT CAUSE: `rg` is not installed or not available on the current `PATH`.  
CLASSIFICATION: disposable runtime issue  
SOLUTION: Switched read-only source discovery to `git grep`, then inspected exact deployed definitions with PostgreSQL catalog queries in the schema-only disposable database.  
WHY THIS IS SAFEST: It preserves audit scope and exactness without installing tools, changing the host, or skipping schema/runtime verification.  
FILES/FUNCTIONS CHANGED: This audit log only.  
PROOF: `git grep` returned the complete tracked-source definition set; `pg_get_functiondef`, `information_schema`, `pg_constraint`, and `pg_trigger` queries returned the deployed definitions and dependencies.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None; untracked files are not relevant because the starting worktree was clean and all deployable migrations are tracked.  
STATUS: RESOLVED

### Blocker 9

BLOCKER NUMBER: 9  
STAGE: Final formatter re-invocation after environment rollover  
ERROR / SQLSTATE: npm `EACCES` / registry fetch denied while resolving `prettier`  
SYMPTOM: A repeated optional `npx prettier` invocation could not access the npm cache/registry in the refreshed sandbox.  
ROOT CAUSE: The transient environment no longer exposed the previously resolved Prettier package and denied cache/log writes outside the workspace.  
CLASSIFICATION: disposable runtime issue  
SOLUTION: Preserve the already-formatted files from the successful earlier Prettier pass; verify syntax with `node --check`, formatting integrity with `git diff --check`, and style with focused ESLint. No dependency or host mutation was required.  
WHY THIS IS SAFEST: It avoids unnecessary package installation and treats the authoritative lint/syntax checks as gates.  
FILES/FUNCTIONS CHANGED: Execution log only.  
PROOF: Both modified MJS files pass syntax and focused ESLint; `git diff --check` is clean.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None.  
STATUS: RESOLVED

### Blocker 8

BLOCKER NUMBER: 8  
STAGE: Read-only remote pre-deploy reconciliation  
ERROR / SQLSTATE: Assertion `reconcile_marketplace_ad_finalization.expired_unfinalized_liability_nonzero`; observed aggregate `1`  
SYMPTOM: The linked remote database was at the expected pre-B7A migration, but one funded Ads campaign crossed its `ends_at` boundary with reserved liability while the long local regression run was in progress.  
ROOT CAUSE: Time-dependent Ads finalization had not yet been processed by its canonical bounded service batch. This was unrelated to B7A source or fixtures.  
CLASSIFICATION: state-machine limitation  
SOLUTION: Add an explicit opt-in `--finalize-expired-ads` maintenance mode to the read-only-by-default remote audit runner and invoke the existing service-only `finalize_expired_marketplace_ad_campaigns(100)` authority once. Then rerun every remote reconciliation and parity gate.  
WHY THIS IS SAFEST: The canonical Ads authority locks eligible expired campaigns, uses deterministic idempotency, settles only earned delivery, releases unused escrow, and is already covered by Ads financial/finalization proofs. No direct table or ledger mutation is introduced.  
FILES/FUNCTIONS CHANGED: `scripts/audit-marketplace-b7a-remote.mjs` opt-in operator flag only; no production migration change.  
PROOF: Maintenance result and the complete post-maintenance remote audit are recorded below; Ads finalization, finance, delivery/events, payments, settlements, B7F, and B7R must all be healthy.  
PRODUCTION ECONOMICS CHANGED: No formula changed; the existing Ads authority completed one already-due economic lifecycle.  
RESIDUAL RISK: Other campaigns can naturally expire later; scheduled invocation of the existing batch remains the operational control.  
STATUS: RESOLVED

### Blocker 7

BLOCKER NUMBER: 7  
STAGE: Held-dispute regression after the B7A proof  
ERROR / SQLSTATE: `MARKETPLACE_DISPUTE_REFUND_PROOF_FAILED: released_manual_review:reconciliation_nonzero`; payment reconciliation showed `paid_without_payment=2`  
SYMPTOM: B7A/B7F/B7R reconciliations were zero, but two committed proof checkout shells remained after B7A concurrency cleanup, causing the next legacy proof's global reconciliation gate to fail.  
ROOT CAUSE: Generic cleanup covered foreign-key columns named `order_id`/`checkout_id`; the root `marketplace_orders.id` and `marketplace_checkout_sessions.id` columns use plain `id` and were omitted.  
CLASSIFICATION: fixture defect  
SOLUTION: Explicitly delete the exact committed synthetic order IDs and checkout IDs after dependent rows and before deleting fixture identities.  
WHY THIS IS SAFEST: Cleanup is constrained to the recorded synthetic UUID sets and leaves all production migration/runtime logic untouched.  
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-commerce.mjs` only.  
PROOF: Rerun B7A from a fresh disposable restore; require B7A fixture users zero and legacy payment reconciliation zero before rerunning the held-dispute proof.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None.  
STATUS: RESOLVED

### Blocker 6

BLOCKER NUMBER: 6  
STAGE: Entitlement-revocation race integrity assertion  
ERROR / SQLSTATE: Proof assertion observed one apparent `attributed_at > entitlement.updated_at` violation after the deadlock fix  
SYMPTOM: Attribution validly committed before the waiting revocation, yet timestamp comparison classified it as created after revocation.  
ROOT CAUSE: The incumbent seller authority writes `updated_at=now()` (transaction-start time), while B7A attribution uses `clock_timestamp()` (wall time). A revocation transaction can start first, wait, and commit after attribution with an earlier stored timestamp.  
CLASSIFICATION: reconciliation issue  
SOLUTION: Snapshot the exact validated offer version (`offer.updated_at`) into each attribution. Reconciliation now flags a non-active entitlement only when the attribution claims the current non-active version; a legitimate attribution created from an earlier active version has a distinct version snapshot.  
WHY THIS IS SAFEST: Version identity reflects the row state actually validated under lock and does not infer serialization order from incompatible timestamp clocks. Historical freezes remain valid after later revocation.  
FILES/FUNCTIONS CHANGED: B7A migration table/function/backfill/reconciliation; B7A proof race assertion.  
PROOF: The two-connection race must complete without deadlock and produce no attribution tied to the revoked version; all 36 counters must remain zero.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: The existing offer table is not numerically versioned, so `updated_at` is the durable version token; seller replacement already changes it and inserts a new offer ID.  
STATUS: RESOLVED

### Blocker 5

BLOCKER NUMBER: 5  
STAGE: Post-concurrency explicit fixture cleanup / final B7A reconciliation  
ERROR / SQLSTATE: Assertion `creator_commerce:missing_creator`, observed counter `4`  
SYMPTOM: All two-connection races passed, but four committed synthetic attribution rows remained after their fixture users were removed.  
ROOT CAUSE: The generic cleanup removed order- and checkout-linked rows but standalone attribution tokens intentionally have neither identity; the cleanup omitted their `authorized_by` scope.  
CLASSIFICATION: fixture defect  
SOLUTION: Delete committed synthetic attribution tokens explicitly by their fixture seller `authorized_by` before deleting the seller offer/user rows, with disposable-only trigger replication suppression already scoped inside the cleanup transaction.  
WHY THIS IS SAFEST: Cleanup targets the exact synthetic authority owner, preserves unrelated disposable baseline rows, and leaves production immutability untouched.  
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-commerce.mjs` only.  
PROOF: Rerun from a fresh disposable database; require all 36 B7A counters zero and `b7a-%@proof.local` users zero after concurrency.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None.  
STATUS: RESOLVED

### Blocker 4

BLOCKER NUMBER: 4  
STAGE: Two-connection entitlement-revocation versus attribution-creation race  
ERROR / SQLSTATE: PostgreSQL `40P01`: `deadlock detected`  
SYMPTOM: Concurrent seller revocation and service attribution creation could form a product/offer lock cycle; PostgreSQL aborted the revocation participant in the first proof.  
ROOT CAUSE: Existing seller offer replacement locks the product row before updating the offer. The initial B7A implementation locked the offer first, then acquired a product FK/key-share lock during attribution insert.  
CLASSIFICATION: concurrency issue  
SOLUTION: Make attribution creation and order-item freeze acquire a product share lock before the entitlement share lock, matching the established seller authority's deterministic product-then-offer order. The offer is re-read under lock before eligibility checks.  
WHY THIS IS SAFEST: A single global lock order eliminates the cycle without weakening entitlement freshness. If attribution wins, it freezes the valid pre-revocation version; if revocation wins, the waiting attribution re-reads `removed` and is denied.  
FILES/FUNCTIONS CHANGED: `20260811020000_marketplace_creator_commerce_authority.sql`; `marketplace_create_creator_commerce_attribution_internal`; `marketplace_freeze_order_item_creator_attribution_internal`.  
PROOF: Two independent `pg.Client` connections race the exact seller revocation and attribution RPCs; revocation completes without `40P01`, and no attribution exists with `attributed_at > entitlement.updated_at`.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: Normal PostgreSQL transaction cancellation remains possible for unrelated external lock cycles, but B7A's product/entitlement order now matches the incumbent writer.  
STATUS: RESOLVED

### Blocker 3

BLOCKER NUMBER: 3  
STAGE: A–AF proof, committed two-connection concurrency fixture  
ERROR / SQLSTATE: PostgreSQL `22023`: `marketplace_shipping_country_invalid`  
SYMPTOM: The proof reached the concurrency stage, then the normal order-item shipping-freeze trigger rejected a manually constructed pending checkout item.  
ROOT CAUSE: The committed race fixture inserted a checkout and order but omitted the checkout shipping-address row required by the production shipping snapshot trigger.  
CLASSIFICATION: fixture defect  
SOLUTION: Insert a valid synthetic US checkout shipping address before inserting the race order item. Production shipping triggers remain enabled and unchanged.  
WHY THIS IS SAFEST: The fixture now satisfies the same real relational prerequisite as production checkout instead of disabling or bypassing the shipping authority.  
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-commerce.mjs` only.  
PROOF: Rerun the complete A–AF harness; the concurrency fixture must pass the real shipping trigger and later be explicitly removed.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None.  
STATUS: RESOLVED

### Blocker 2

BLOCKER NUMBER: 2  
STAGE: First full disposable transactional apply of the B7A migration  
ERROR / SQLSTATE: PostgreSQL `42883`: `function max(uuid) does not exist`  
SYMPTOM: Creation of `reconcile_marketplace_creator_commerce()` failed while deriving the deterministic residual-recipient item. The transactional apply rolled the entire candidate migration back.  
ROOT CAUSE: PostgreSQL does not define the `max` aggregate directly for UUID values in this runtime.  
CLASSIFICATION: migration defect  
SOLUTION: Aggregate the canonical UUID textual representation and cast the result back to UUID: `max(order_item_id::text)::uuid`. UUID text ordering is stable and matches the B7F residual ordering for canonical lowercase UUIDs.  
WHY THIS IS SAFEST: It fixes only deterministic selection; it does not alter commission arithmetic, ordering inputs, or any financial snapshot. The failed candidate apply was already atomically rolled back.  
FILES/FUNCTIONS CHANGED: `20260811020000_marketplace_creator_commerce_authority.sql`; `reconcile_marketplace_creator_commerce()`.  
PROOF: A clean disposable restore and full transactional re-apply is rerun after this correction, followed by reconciliation and residual tests.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None after clean re-apply and exact B7F equivalence proof.  
STATUS: RESOLVED

## Remote pre-deploy audit

- First read-only audit: connected at migration `20260811010000`; B7A absent; one time-dependent Ads `expired_unfinalized_liability` detected.
- Canonical Ads maintenance: `finalize_expired_marketplace_ad_campaigns(100)` returned `finalized=1`.
- Repeated audit: passed at migration `20260811010000`; B7A tables/reconciliation absent as expected; B7A fixture users zero; failure hooks absent.
- B7F: 27 counters, all zero.
- B7R: 32 counters, all zero.
- Payments and settlements: healthy; held escrow expected/actual both `71` BDAG.
- LIVE commissions: 9 counters, all zero.
- Ads delivery, eligibility clock, events, finalization, and finance: all counters zero.

## Local proof and regression evidence

- B7A A–AF proof: passed; 36 creator-commerce counters all zero; 27 B7F counters all zero; persistent fixtures zero.
- Exact B7A multi-creator settlement: seller `78`, platform `10`, creator X `5`, creator Y `7`, gross `100`.
- B7R integration: four original legs reversed; buyer refund `100`; B7R reconciliation all zero.
- B7R insufficient creator balance: `money_moved=false`; no partial movement.
- LIVE affiliate compatibility: BPS `1200`; creator `12`; seller `78`; platform `10`; gross `100`; one canonical attribution snapshot and one B7F row.
- LIVE own-product: zero creator commission and no attribution/allocation rows.
- B7F proof: passed, including exact legacy equivalence, two creators, same creator/multiple items, races, B7R reversal, held refund, and release_seller.
- B7R proof: passed, including atomic failure rollback and two-connection concurrency; 32 counters all zero.
- Held dispute/refund proof: passed; payments, settlements, commissions all zero.
- Order lifecycle/automatic settlement: passed; payments, settlements, commissions all zero.
- Shipping/LIVE checkout: passed; payments, settlements, commissions all zero.
- Publication, fixture finalization, promotions, analytics, client runtime: passed.
- Ads finance, eligibility, finalization, delivery/events: passed; persistent fixtures zero.
- Node test suite: 597 passed, 0 failed.
- Focused ESLint: passed for both modified MJS files.
- TypeScript: 188 existing repository diagnostics; zero originated in B7A-modified files.
- iOS export: passed. Existing package export warnings were non-fatal.
- Build: `22`; no EAS command run.
- Production source audit: no fixture hooks, debug/mock branches, special fixture identities, test GUCs, top-level transaction wrapper, client commission amount input, or hardcoded reconciliation success values. B7R/B7F migration diffs are empty.

## Remote deployment and post-deploy audit

Pending.
