# MKT-B7E LIVE Creator Commerce V2 Execution Log

## Execution identity

- Branch: `codex/mkt-a4b-premium-integration`
- Starting SHA: `932bb54819b75a06a95c1755c6e2955a97030c2e`
- Build: 22
- Starting remote migration: `20260811025100`
- Planned B7E migration: `20260811026000_marketplace_live_creator_commerce_v2.sql`
- Scope: LIVE shopping orchestration and shared creator-attributed cart handoff. B8 was not started.

## Architecture audit

The repository already contained a substantial, production-grade LIVE commerce baseline. B7E preserves and reuses it:

- `live_sessions` and the existing Agora host/viewer lifecycle remain the LIVE authority.
- `live_session_products` is the durable shelf and immutable historical LIVE source identity.
- A session supports at most 20 active products, enforced server-side by `pin_live_session_product(...)`.
- `status`, `is_featured`, `position`, `pinned_at`, and `unpinned_at` represent shelf lifecycle and one highlighted product.
- Own-product pins derive from host seller ownership and carry `commerce_mode='own_product'`, `creator_commission_bps=0`, and no affiliate offer.
- Affiliate pins resolve the canonical current seller-approved `marketplace_live_affiliate_offers` row and freeze its offer ID/BPS in the pin.
- Host commands use `auth.uid()`, `live_commerce_host_context(...)`, idempotency commands, request fingerprints, and session advisory locks.
- `fetch_my_live_product_candidates(...)` is cursor-paginated and returns own and eligible affiliate candidates without an unbounded catalog query.
- `fetch_live_session_products(...)` returns one bounded, joined shelf payload; there is no product/offer N+1.
- Broadcast and watch screens use one session-level Realtime subscription plus a bounded five-second recovery poll and remove both on cleanup.
- `create_live_marketplace_checkout_reservation(...)` remains the in-LIVE single-item quick-buy path and delegates inventory to canonical Marketplace reservation authority.
- `marketplace_live_order_sources`, B7A `source_surface='live'`, B7F allocation, settlement, B7R, B3, and B7D remain canonical downstream truth.
- Gifts remain on their separate LIVE gift/BDAG authority. B7E does not join gifts to Marketplace GMV or settlement.

## B7E V2 contract

B7E adds a buyer-safe shared-cart handoff rather than another checkout or financial system:

1. Viewer deliberately opens a LIVE product or product detail. B3 may record observational engagement using the exact pin ID.
2. Passive display, shelf open, quick view, or product-detail render creates no B7A attribution.
3. Explicit Add to Cart / Buy Now calls `create_marketplace_creator_live_attribution(pin, variant, key)`.
4. The server derives the session, host/creator, seller, store, product, and pinned entitlement. The client cannot submit BPS or commission.
5. Own-product pins return no creator attribution and use ordinary Marketplace checkout.
6. Affiliate pins delegate to `marketplace_create_creator_commerce_attribution_internal(...)` and return its opaque B7A token.
7. The existing exact-token cart and `create_marketplace_creator_checkout_reservation(...)` handle LIVE, Feed/Reel, Showcase, and ordinary items together.

The server validates that the pin is active, the LIVE is active, the variant belongs to the exact product/seller/store, the buyer is not the seller/host for affiliate credit, and the current pinned entitlement remains eligible. A removed pin, ended LIVE, revoked/replaced offer, product invalidation, or stale variant cannot create a new token.

## Host and viewer UX

- Host: existing compact LIVE commerce button, paginated/searchable product sheet, own/affiliate status, current commission opportunity, pin/unpin, highlight, unavailable/repin feedback, 20-item counter, loading/error/empty/retry states.
- Viewer: existing bag count, compact featured rail, bounded product sheet, quick view, variant/quantity/shipping/review/payment flow, and retry states.
- B7E adds a narrow “Ver detalles o agregar al carrito” action from quick view. It routes to the canonical product detail with `source='live'`, the exact pin ID, and LIVE session ID. Back navigation naturally returns to LIVE.
- Product detail accepts exactly one of Showcase, Feed/Reel tag, or LIVE pin context and preserves the existing opaque-token conflict rule.
- B3 records a deliberate quick-view product open and direct checkout start; canonical product detail records LIVE product view/add-to-cart through the existing event API.
- No client BPS, commission, GMV, seller, store, or creator authority was added.

## Concurrency and lifecycle

The existing pin authority serializes by host idempotency key and `live-pin:<session>`. Highlight uses `live-feature:<session>`. Unpin locks the pin row. Checkout and the new attribution wrapper hold shared locks on session/pin state and delegate offer/product locking to established B7A order.

Disposable two-connection proof covers:

- duplicate simultaneous pin commands converge to one active row;
- competing highlights end with exactly one highlighted product;
- two buyers racing for final stock produce one reservation and one rejection, with no oversell;
- offer revocation versus attribution yields either a valid pre-revocation snapshot or rejection, and all post-revocation requests reject;
- unpin versus attribution yields either a valid earlier snapshot or rejection, and all later requests reject;
- end-LIVE versus commerce mutation ends safely and later host mutations reject;
- no deadlocks and no partial state.

## Blockers

### BLOCKER 1

- BLOCKER NUMBER: B7E-01
- STAGE: Authority/UI audit
- ERROR / SQLSTATE: Not applicable
- SYMPTOM: Existing in-LIVE checkout was safe but single-item. There was no buyer-safe LIVE attribution wrapper for the shared product-detail/cart checkout, so a LIVE-attributed item could not participate in the required mixed cart without trusting service-role-only inputs.
- ROOT CAUSE: Original LIVE commerce predated B7A/B7B/B7C opaque-token cart orchestration and snapshots LIVE identity only after the dedicated reservation path.
- CLASSIFICATION: B7A compatibility issue / client integration issue
- SOLUTION: Add `create_marketplace_creator_live_attribution(uuid,uuid,uuid)`, server-derive all authority, delegate affiliate attribution to B7A, return no token for own products, and extend the existing cart/product-detail context.
- WHY THIS IS SAFEST: It reuses B7A/B7F and ordinary checkout rather than adding financial or reservation authority.
- FILES/FUNCTIONS CHANGED: B7E migration; `create_marketplace_creator_live_attribution`; LIVE service; product detail; cart model; LIVE quick view.
- PROOF: Disposable mixed LIVE + ordinary order has one LIVE item snapshot, item GMV 50, commission 5, and ordinary item excluded. Multi-surface proof combines two LIVE items for one creator, a Feed item for another creator, and an ordinary item in one order.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: A token already created before unpin/end may still be checked out later under B7A immutable-token semantics; new tokens cannot be created afterward. This is intentional historical authorization behavior.
- STATUS: RESOLVED

### BLOCKER 2

- BLOCKER NUMBER: B7E-02
- STAGE: Two-connection highlight proof
- ERROR / SQLSTATE: `23505`, partial unique index `live_pin_one_featured`
- SYMPTOM: Switching the featured product could fail even under the existing session advisory lock.
- ROOT CAUSE: One multi-row UPDATE set the target row true and old row false. PostgreSQL could check the target row before the old featured row was cleared, transiently violating the one-featured partial unique index.
- CLASSIFICATION: concurrency issue
- SOLUTION: Preserve all existing host, idempotency, readiness, and advisory-lock semantics but perform two ordered updates: clear the old featured pin, then set the target.
- WHY THIS IS SAFEST: It changes only mutation ordering and preserves the unique database invariant and all business checks.
- FILES/FUNCTIONS CHANGED: B7E migration; `feature_live_session_product(uuid,uuid,uuid)`.
- PROOF: Repeated two-connection competing highlights both settle without `23505` or deadlock and leave exactly one featured row.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: None beyond normal client retry on transport failure; command idempotency remains intact.
- STATUS: RESOLVED

## Proof status

Local B7E proof currently demonstrates:

- own product: zero affiliate attribution/commission;
- affiliate product: exact pin, creator, seller/store/product, 1200 and 900 offer versions;
- passive view: B3 only, zero financial attribution;
- revoked offer, repin, unpin, product/source mismatch, and ended LIVE safety;
- host/outsider/viewer mutation boundary;
- exact mixed order: gross 100, seller 85, platform 10, creator 5;
- settlement and B7R: buyer +100, creator reversal 5, net creator commission 0;
- insufficient creator balance: `money_moved=false`, no partial movement, no false B7D reversal;
- one order with two LIVE items for Creator X, one Feed item for Creator Y, and one ordinary item: exact item isolation and one-order analytics;
- B7D LIVE opens/add-to-cart/orders/units/GMV/generated/released/reversed/net;
- all required two-connection races;
- B7D 18, B7C 28, B7B 23, B7A 36, B7F 27, and B7R 32 reconciliation counters zero;
- persistent disposable B7E fixtures zero.

Final regressions, deployment evidence, remote parity, commits, and closure status will be appended after all gates complete.

### BLOCKER 3

- BLOCKER NUMBER: B7E-03
- STAGE: Linked read-only audit
- ERROR / SQLSTATE: Local Supabase CLI cache access restriction followed by unavailable linked credentials inside the filesystem sandbox
- SYMPTOM: The first read-only pre-deploy audit could not initialize its temporary CLI cache/auth session.
- ROOT CAUSE: The known Windows npm/Supabase credential-cache boundary, not remote authority or schema health.
- CLASSIFICATION: runtime/tooling issue
- SOLUTION: Reused the established linked-auth bootstrap/cache path and ran the same read-only auditor with the authorized linked CLI boundary.
- WHY THIS IS SAFEST: It changed no repository or remote data and used the project-supported authentication path.
- FILES/FUNCTIONS CHANGED: `scripts/audit-marketplace-b7e-remote.mjs` cache bootstrap only.
- PROOF: Pre-deploy audit returned `ok=true`, migration `20260811025100`, B7E absent, and every inherited reconciliation healthy. Post-deploy audit returned `ok=true` at `20260811026000`.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: None.
- STATUS: RESOLVED

## Final proof and regression evidence

- Dedicated disposable B7E proof: passed. It reports own-product checkout with zero creator attribution, affiliate LIVE attribution, passive-view non-financial behavior, revoked/replaced offer handling, invalidated product rejection, unpin/end safety, event poisoning exclusion, exact settlement/reversal/insufficient-balance behavior, mixed-surface item isolation, all two-connection races, and zero fixture residue.
- Exact financial proof: gross `100`, seller `85`, platform `10`, creator `5`; full B7R buyer refund `100`. Insufficient creator balance returns `money_moved=false` with no partial movement.
- Multi-surface proof: one order contains two LIVE-attributed items for Creator X, one Feed-attributed item for Creator Y, and one ordinary item. Creator X has one order, item GMV `50`, commission `5`; Creator Y has item GMV `50`, commission `7`; ordinary economics are excluded. Total gross `150`, seller `123`, platform `15`, creator allocations `12`.
- B7D LIVE analytics: exact LIVE opens, add-to-cart, one-order deduplication, units, item GMV, generated/released/reversed/net commission, product breakdown, surface breakdown, and trend passed.
- Reconciliations: B7D `18/18`, B7C `28/28`, B7B `23/23`, B7A `36/36`, B7F `27/27`, B7R `32/32`, and existing LIVE commission reconciliation all zero.
- Canonical sequential regressions passed: B3 analytics, B7A, B7B, B7C, B7D, B7F, B7R, held dispute/refund/release-seller, order lifecycle, shipping including LIVE reservation, publication, fixture finalization, promotions, runtime reads, Ads finance, Ads eligibility, Ads finalization, and Ads delivery/events.
- Gifts/LIVE core: no gift, Agora, token, host/viewer lifecycle, co-host, chat, reaction, camera, or broadcast authority changed. The full Node suite includes existing LIVE Agora, reservation, commerce UI/state, host/viewer, and gift-isolation source contracts; it passed `651/651`. No physical camera/device claim is made from Node tests.
- Focused ESLint: zero errors and zero warnings across all modified JS/MJS/TS/TSX files.
- TypeScript: exactly the documented `187` unrelated baseline diagnostics; zero diagnostics originated in B7E-modified files.
- iOS export: succeeded for Build 22. Existing dependency export warnings were unchanged. No EAS command was run.
- Source safety: no historical migration diff; no B7A/B7F/B7R formula change; no client BPS, commission, creator, seller, store, GMV, ledger, settlement, gift, or B8 authority.

## Migration and remote evidence

- Pre-deploy read-only audit: passed at `20260811025100`; B7E correctly absent and inherited Marketplace/LIVE/Ads state healthy.
- Linked dry-run: exactly `20260811026000_marketplace_live_creator_commerce_v2.sql`; seeds `[]`; roles `[]`; no historical migration.
- Deployment: exactly the B7E migration applied successfully.
- Post-deploy read-only audit: passed at `20260811026000`.
- Post-deploy authority: authenticated buyer wrapper granted; anon denied; B7A internal helper private; raw pin and raw attribution mutation denied; host pin/unpin/feature RPC grants intact.
- Post-deploy integrity: ordered feature transition present; failure functions/triggers absent; B7E fixture users zero; all inherited reconciliations zero; held escrow exact `71/71`.

## Commits and closure

- `c2e6342` — `feat: harden live creator commerce authority`
- `ebc8c2a` — `feat: add live creator shopping experience`
- Final proof/test/documentation commit: recorded by Git after this log is staged.

MKT-B7E LIVE Creator Commerce V2 is CLOSED and B8 is unblocked. B8 has not been started.
