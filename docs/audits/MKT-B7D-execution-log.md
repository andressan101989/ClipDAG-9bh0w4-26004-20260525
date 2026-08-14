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

### BLOCKER 5

BLOCKER NUMBER: 5
STAGE: Primary post-deploy B7D reconciliation
ERROR / SQLSTATE: Reconciliation counter `creator_settlement_leg_without_creator_allocation = 11`
SYMPTOM: Eleven historical creator settlement legs had no normalized B7F item-allocation rows.
ROOT CAUSE: These are legitimate pre-B7A/pre-B7F LIVE scalar settlement records created before normalized creator item allocations became mandatory.
CLASSIFICATION: reconciliation issue / historical compatibility
SOLUTION: Add `20260811025100_scope_marketplace_creator_analytics_history.sql`, scoping the mandatory normalized-settlement allocation counter to the B7A authority activation boundary while retaining all immutable historical settlement truth. The same corrective excludes legacy generic Feed/clip events unless their source ID is demonstrably a B7C content tag with the wrong type.
WHY THIS IS SAFEST: It does not synthesize retroactive allocations, rewrite settlements, or weaken current-era identity and amount checks.
FILES/FUNCTIONS CHANGED: Corrective migration; `reconcile_marketplace_creator_commerce_analytics()`; remote auditor parity check.
PROOF: Initial remote counter was 11; clean disposable validation was 18/18 zero; corrective remote audit was 18/18 zero with B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, and B7R 32/32.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: Pre-authority LIVE history remains scalar by design and is not given invented item-level allocation rows.
STATUS: RESOLVED

### BLOCKER 6

BLOCKER NUMBER: 6
STAGE: Corrective disposable validation
ERROR / SQLSTATE: Missing disposable seed prerequisites after a schema-only diagnostic restore
SYMPTOM: The first diagnostic runtime lacked product category fixtures and could not execute the full financial proof.
ROOT CAUSE: A schema-only linked restore is sufficient for reconciliation queries but not for fixture-heavy commerce proofs.
CLASSIFICATION: runtime/tooling issue
SOLUTION: Remove only the explicitly named disposable container, rebuild it through `db:marketplace-disposable -- create`, apply the corrective candidate, and rerun the canonical B7D proof.
WHY THIS IS SAFEST: It uses the repository bootstrap and affects no linked data.
FILES/FUNCTIONS CHANGED: None.
PROOF: Canonical disposable proof passed with exact 78/10/5/7 economics, reversal and insufficiency assertions, 18/18 zero, and fixture count zero.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None.
STATUS: RESOLVED

### BLOCKER 7

BLOCKER NUMBER: 7
STAGE: Post-deploy corrective commit
ERROR / SQLSTATE: N/A
SYMPTOM: The primary implementation already consumed the preferred three-commit budget before the remote-only historical reconciliation mismatch was observable.
ROOT CAUSE: The mismatch depended on legitimate remote pre-B7F history absent from disposable fixtures.
CLASSIFICATION: deployment/reconciliation issue
SOLUTION: Preserve immutable history and create one explicit fourth corrective commit; do not amend, rebase, squash, or hide the post-deploy correction.
WHY THIS IS SAFEST: The repository history truthfully records the exact migration deployed to resolve the discovered remote condition.
FILES/FUNCTIONS CHANGED: Corrective migration, remote auditor, and this execution log only.
PROOF: Exact corrective dry-run contained one migration; corrective deployment and final read-only audit passed.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: Commit count is four rather than the preferred maximum three; no unsafe Git history operation was used.
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

### Primary deployment

- Primary migration: `20260811025000_marketplace_creator_commerce_analytics.sql`.
- Linked dry-run contained exactly that migration, with no seeds or roles.
- Primary migration deployed successfully.
- The first remote B7D reconciliation then exposed 11 legitimate pre-B7F LIVE settlement legs without normalized item allocations; no financial row was rewritten.

### Historical reconciliation correction

- Corrective migration: `20260811025100_scope_marketplace_creator_analytics_history.sql`.
- The correction scopes mandatory normalized allocation materialization to the B7A authority era and preserves pre-B7F LIVE scalar financial truth.
- Corrective linked dry-run contained exactly that migration, with no seeds or roles.
- Corrective migration deployed successfully.

### Final remote verification

- Latest migration: `20260811025100`.
- B7D analytics reconciliation: 18/18 zero.
- B7C content tags: 28/28 zero.
- B7B Showcase: 23/23 zero.
- B7A creator commerce: 36/36 zero.
- B7F multi-creator allocations: 27/27 zero.
- B7R settlement reversals: 32/32 zero.
- Payments, settlements, LIVE, Ads delivery/events/eligibility/finalization/finance: healthy.
- Held escrow: expected 71 BDAG, actual 71 BDAG, difference zero.
- B7D fixture users: zero; failure hooks: absent.
- Authenticated self-read, anonymous denial, private fact projections, and B7A/B7F helper privacy: passed.
- Corrective local proof and full Node suite: 18/18 zero, fixtures zero, 639/639 tests passed.

## INDEPENDENT CLOSURE REVIEW / B7D-C1

An independent GitHub review found that the production implementation existed and was financially well-structured, but the original disposable proof did not substantiate every closure claim. Specifically:

1. Runtime source/surface coverage was incomplete.
2. Creator Showcase was not runtime-proven.
3. Existing LIVE affiliate commerce was not runtime-proven by B7D.
4. Canonical direct creator link commerce was not runtime-proven.
5. `surface_breakdown` lacked exact value assertions.
6. No paid fixture older than 90 days existed.
7. `90d` versus `all` was not actually distinguished.
8. Engagement inclusion/exclusion across time ranges was incomplete.
9. Trend bucket values were not asserted exactly.
10. Same-order/multiple-item trend deduplication was not explicitly proven.

### Closure-proof correction

The B7D-C1 disposable proof now uses only existing canonical production APIs and rolls back every fixture:

- Showcase: canonical B7B selection and buyer attribution wrapper; exact item snapshot, source entity, product breakdown, engagement, and surface values.
- Feed and Reel: canonical B7C tags and attribution wrappers; exact snapshots, Feed/Reel surface values, and B3 `feed`/`clip` engagement.
- Direct creator link: canonical B7A server-issued attribution from a specific-creator entitlement; exact financial and `affiliate` engagement mapping. A public offer that lacks pre-attribution canonical creator identity is explicitly excluded.
- LIVE: existing `start_live_session`, affiliate offer, product pin, and LIVE checkout authority only; exact LIVE snapshot, source entity, 100 BDAG item GMV, 12 BDAG creator allocation, and B3 LIVE engagement. No B7E behavior was added.
- Exact all-time Creator X surface values: LIVE 100/12, Feed 90/9, Showcase 40/4, direct link 30/3, Reel 20/2 for GMV/generated commission. Surface sums equal summary values and ordering is GMV-descending.
- Canonical engagement isolation: mismatched product, mismatched Feed/Reel surface, and non-identifying public affiliate events do not enter another creator's analytics. Observational events do not create financial attribution.
- Exact ranges: `7d` = 2 orders, 2 units, 70 GMV, 7 generated; `30d` = 4 orders, 5 units, 140 GMV, 14 generated; `90d` = 6 orders, 7 units, 180 GMV, 18 generated; `all` = 7 orders, 8 units, 280 GMV, 30 generated.
- Exact engagement ranges: product opens are 3/4/5/6 and add-to-cart events are 2/3/4/5 for 7d/30d/90d/all.
- A canonical LIVE sale aged 120 days contributes 100 GMV and 12 generated commission only to `all`, in its exact UTC monthly trend bucket.
- Daily and all-time monthly trend payloads are compared field-for-field: bucket, distinct orders, GMV, generated, released, reversed, and net commission.
- A two-item order for the same creator contributes 30 GMV and 3 commission but exactly one order to its trend bucket and summary.
- Release and reversal stay on their actual timestamps; the historical paid sale remains in its payment bucket. Insufficient reversal creates no reversal analytics.

### Validation

- B7D proof: all five surfaces, exact breakdown, ranges, event ranges, trends, reversal semantics, self-only security, 18/18 reconciliation, and zero persistent fixtures passed.
- B3 analytics: passed.
- B7C: 28/28 zero.
- B7B: 23/23 zero.
- B7A: 36/36 zero.
- B7F: 27/27 zero.
- B7R: 32/32 zero.
- Held refund, manual review, and `release_seller`: passed.
- Focused B7D-C1 tests: 9 passed, 0 failed.
- Full Node suite: 642 passed, 0 failed.
- Focused ESLint: zero errors and zero warnings.
- TypeScript: 187 unchanged unrelated baseline diagnostics; no B7D-C1 TypeScript files changed.
- iOS export: passed.
- Build: 22.
- Final read-only remote audit: latest migration `20260811025100`; B7D 18/18, B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, B7R 32/32; escrow 71/71; fixtures zero; failure hooks absent; authority/grants healthy.
- Production application code, production SQL, deployed migrations, financial semantics, and remote state were not changed by B7D-C1.

### PROCESS EXCEPTION ACCEPTED BY PROJECT OWNER

Four B7D commits already existed. The fourth was a legitimate transparent post-deploy correction for historical pre-B7F LIVE reconciliation and was intentionally not amended, rebased, squashed, or otherwise rewritten. The project owner explicitly authorized one additional proof/documentation corrective commit. This process exception does not weaken any technical, security, financial, migration, or deployment gate.

**MKT-B7D Creator Commerce Analytics is CLOSED. The previously exceeded commit-count gate is accepted as an explicit project-owner process exception. B7E LIVE Creator Commerce V2 is unblocked but has not been started.**
