# MKT-B7D Creator Commerce Analytics — Execution Log

## Baseline

- Branch: `codex/mkt-a4b-premium-integration`
- Starting SHA: `922720cc1af22a45a46ff5ba62198d290abea759`
- Build: 22
- Starting remote migration: `20260811024000`
- Disposable database self-test: passed
- Remote pre-change authority: B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, B7R 32/32, payments/settlements/LIVE/Ads healthy, held escrow 71/71, fixtures zero, failure hooks absent.

## Authority audit

### Existing B3 event authority

`marketplace_commerce_events` is the canonical append-only observational event stream. `record_marketplace_commerce_event(...)` validates product/variant shape, bounded source vocabulary, anonymous session identity, event idempotency, and allowlisted metadata. Product detail already records `product_view`; explicit cart actions record `add_to_cart`. B7D reuses these events and does not create a second creator-click table.

B7D ignores the client-supplied `source_creator_id`. It resolves creator identity only through canonical source entities: Showcase item (`creator` B3 source), Feed tag (`feed`), Reel tag (`clip`), affiliate LIVE pin (`live`), or a specific-creator entitlement (`affiliate`). Public direct-link opens without an exact server-resolvable creator remain excluded; financial conversions still use the immutable B7A creator snapshot.

### Canonical financial facts

- B7A `marketplace_order_item_creator_attributions`: immutable creator/product/source surface per purchased line.
- B7F `marketplace_order_item_creator_allocations`: immutable item GMV basis and actual generated commission.
- `marketplace_payments.paid_at`: successful-sale time.
- B7F creator settlement legs: actual released creator money and release time.
- B7R creator reversal legs: actual reversed creator money and reversal time.
- Order item snapshots: quantity, historical product title/image, and line total.

No historical commission is recomputed from BPS. No analytics table can mutate financial truth.

## Metric contract

- Product opens: valid B3 `product_view` events whose source entity resolves server-side to the creator and same product.
- Add to cart: valid B3 `add_to_cart` events under the same mapping. No user conversion rate is claimed.
- Attributed orders: distinct paid Marketplace orders with at least one B7A item snapshot for the creator.
- Units sold: order-item quantity for the creator's attributed lines only.
- Attributed GMV: B7F `commission_base_amount` for the creator's attributed lines only.
- Commission generated: B7F item `commission_amount`, dated by canonical payment time.
- Commission released: item allocation amount only after an exact completed creator settlement leg exists, dated by release time.
- Commission reversed: item allocation amount only after an exact B7R creator reversal leg exists, dated by reversal time.
- Net creator commission: released minus reversed.

Generated and paid are intentionally separate. A held creator allocation can be generated while released remains zero. Full B7R reversal preserves the sale/generated history and moves the same amount into reversed, producing zero net retained commission.

Supported server-derived UTC ranges are `7d`, `30d`, `90d`, and `all`. Seven-, thirty-, and ninety-day trends are daily; all-time trends are monthly. Top products are bounded to ten.

## Privacy and trust boundary

`get_my_marketplace_creator_commerce_analytics(text)` accepts only a range key and derives the creator from `auth.uid()`. Anonymous execution is revoked. The private fact projections are not selectable by `anon` or `authenticated`. B7A/B7F internal helpers remain private. Client code performs no commission, GMV, settlement, or reversal calculation.

## Proof evidence

The disposable B7D proof currently establishes:

- exact 100 BDAG cross-surface order: seller 78, platform 10, Creator X 5, Creator Y 7;
- Creator X and Y receive only their own line GMV and commission;
- same creator/two items remains one attributed order;
- mixed attributed/unattributed order excludes the normal line;
- 7d/30d/90d/all inclusion and three historical trend buckets;
- B3 Feed product open/cart mapping and mismatched-source poisoning exclusion;
- offer replacement does not rewrite historical generated commission;
- held generated commission is not reported as released;
- B7R produces exact reversed 5/7 and net zero while preserving attributed orders;
- insufficient creator balance yields `money_moved=false`, no reversal row, and no reversed analytics;
- anonymous denial and safe zero response for an authenticated user with no activity;
- B7D reconciliation 18/18 zero and persistent fixtures zero.

## Blockers

### BLOCKER 1

BLOCKER NUMBER: 1  
STAGE: Candidate RPC disposable execution  
ERROR / SQLSTATE: PostgreSQL grouping error  
SYMPTOM: The top-product current-image expression referenced `p.images` outside an aggregate.  
ROOT CAUSE: The product breakdown groups by product ID while the image fallback expression was initially scalar.  
CLASSIFICATION: migration defect  
SOLUTION: Aggregate the current primary image with `max(p.images[1])`, retaining the immutable order-item image fallback.  
WHY THIS IS SAFEST: It changes only presentation selection and cannot alter any metric or financial fact.  
FILES/FUNCTIONS CHANGED: `20260811025000_marketplace_creator_commerce_analytics.sql`; `get_my_marketplace_creator_commerce_analytics(text)`.  
PROOF: Fresh disposable rebuild applied the full migration; zero-activity RPC returned a valid payload.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None identified.  
STATUS: RESOLVED

### BLOCKER 2

BLOCKER NUMBER: 2  
STAGE: Top-of-funnel authority audit  
ERROR / SQLSTATE: N/A  
SYMPTOM: Public Showcase product navigation carried `showcaseItemId` for B7A but B3 parsed `source=creator_showcase` as `unknown` and did not receive it as `sourceId`.  
ROOT CAUSE: B7B's financial context vocabulary is more specific than the older B3 event vocabulary.  
CLASSIFICATION: source-attribution issue  
SOLUTION: At product detail, map Showcase to existing B3 `creator` and use the Showcase item as `sourceId`; Feed/Reels continue their existing `feed`/`clip` mapping. Server aggregation resolves the actual creator/product from that row.  
WHY THIS IS SAFEST: It reuses B3 without widening historical constraints, and no client creator identity is trusted.  
FILES/FUNCTIONS CHANGED: `app/product/[id].tsx`; B7D event fact projection.  
PROOF: Focused test asserts the mapping; disposable proof excludes a mismatched tag/product event.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: Public-offer direct-link opens cannot be assigned before B7A attribution when the source entity alone does not identify a creator; they are intentionally omitted.  
STATUS: RESOLVED WITH DOCUMENTED LIMITATION

### BLOCKER 3

BLOCKER NUMBER: 3  
STAGE: Product/surface released-commission design  
ERROR / SQLSTATE: N/A  
SYMPTOM: B7F settlement creates one creator leg per creator/order, not one leg per item.  
ROOT CAUSE: Settlement correctly aggregates multiple creator item allocations into a beneficiary leg.  
CLASSIFICATION: schema limitation  
SOLUTION: Use the exact B7F item commission amount for product/surface detail only when the exact completed creator/order settlement leg exists; use the same full-reversal gate for B7R. Reconciliation verifies item totals equal creator legs.  
WHY THIS IS SAFEST: It preserves canonical item attribution without inventing proportional estimates or recalculating BPS.  
FILES/FUNCTIONS CHANGED: B7D financial fact projection and reconciliation.  
PROOF: Same-creator multi-item and exact 5/7 release/reversal proofs; reconciliation totals zero.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: The projection relies on the existing full-settlement/full-reversal contract; reconciliation detects any future partial-leg divergence.  
STATUS: RESOLVED

### BLOCKER 4

BLOCKER NUMBER: 4  
STAGE: Remote pre-deploy audit bootstrap  
ERROR / SQLSTATE: `LegacyPlatformAuthRequiredError`  
SYMPTOM: The linked CLI could not read the existing Supabase auth cache inside the restricted process.  
ROOT CAUSE: Local credential-cache access was sandbox-restricted; database authority was not unavailable.  
CLASSIFICATION: runtime/tooling issue  
SOLUTION: Rerun the same read-only auditor with approved access to the existing local Supabase cache.  
WHY THIS IS SAFEST: No credentials are logged and no remote mutation occurs.  
FILES/FUNCTIONS CHANGED: None.  
PROOF: Pre-deploy audit passed at migration `20260811024000` with B7D absent and every reconciliation healthy.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None beyond normal linked CLI credential availability.  
STATUS: RESOLVED

## Remote pre-deploy audit

Passed read-only at migration `20260811024000`. B7D objects were absent; B7C/B7B/B7A/B7F/B7R and all legacy Marketplace reconciliations were healthy, held escrow was 71/71, fixture users were zero, and failure hooks were absent.

## Local validation

- B7D creator analytics proof: passed; 18/18 reconciliation counters zero, fixtures zero.
- Existing B3 analytics proof: passed.
- B7C: 28/28 zero; causal discard and pending-command exclusivity tests preserved.
- B7B: 23/23 zero.
- B7A: 36/36 zero.
- B7F: 27/27 zero.
- B7R: 32/32 zero.
- Held dispute refund, manual review, and `release_seller`: passed.
- Order lifecycle, shipping, publication, fixture finalization, promotions, runtime: passed.
- Ads finance, eligibility, finalization, delivery/events: passed.
- Node: 639 passed, 0 failed.
- Focused ESLint: 0 errors, 0 warnings.
- TypeScript: 187 existing unrelated diagnostics; zero diagnostics in B7D-modified files.
- iOS export: passed.
- Build: 22.
- Performance review: creator/time, settlement-beneficiary, reversal-beneficiary, and source/entity/time indexes are present. The summary RPC is one bounded server aggregate; top products are capped at ten and trend output is bounded by daily/monthly buckets.
- Source safety: no historical migration changes, no client BPS/commission/GMV authority, no ledger or settlement mutation, no production fixture/test hook.

## Deployment and final verification

Pending completion of local regression, exact linked dry-run, deployment, and post-deploy audit.
