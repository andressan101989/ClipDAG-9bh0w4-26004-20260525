# MKT-B8D-1 — Integral Marketplace Production Audit

## Baseline and scope

- Audit resumed/completed: 2026-08-15T14:39:34-04:00 (America/New_York).
- Repository: `andressan101989/ClipDAG-9bh0w4-26004-20260525`.
- Branch: `codex/mkt-a4b-premium-integration`.
- Frozen starting commit: `b6fa14c2e13ec505b26430fa67fc81002b10e9b2` (`fix: validate marketplace admin health payloads exactly`).
- iOS build number: 22.
- Local and remote migration tip: `20260811032000_marketplace_admin_intelligence_closure.sql`.
- Scope: read-only production/catalog audit plus local disposable proofs. No production behavior, migration, deployment, mobile build, Admin Web deployment, EAS operation, or B8D-2/3/4 work was performed.

## Executive conclusion

The audited frozen Marketplace has no demonstrated P0 or unresolved P1 finding. Canonical financial writers, server-derived identities, idempotency/locking controls, immutable commercial snapshots, and reconciliation authorities passed their existing disposable and remote proofs. B8D-1 therefore technically passes the integrity threshold, but it is not self-closed here. Per the phase rule, B8D-2 should remain blocked until independent review decides the P2 hardening scope.

The interrupted `public` schema finding was reproduced only in the disposable bootstrap. The effective production schema grants `USAGE`, not `CREATE`, to client roles. There is no exposed arbitrary SQL/DDL RPC and the Data API cannot submit raw DDL. The production default ACL is nevertheless overly broad for future objects, and one current table retains dormant non-DML privileges. This is a P2 least-privilege/future-exposure finding, not a reachable current P0/P1 privilege escalation.

## Complete Marketplace authority map

| Domain | Client entry / public RPC | Canonical internal writer and state | Economic transaction | Idempotency / concurrency | Boundary, reconciliation, proof |
|---|---|---|---|---|---|
| Buyer discovery | Shop/search/product/store screens; bounded public product reads | Published product/store projections only | None | Read-only | Publication/readiness policies; `prove:marketplace-publication`, runtime proof |
| Cart | Mobile local cart state | No authoritative database writer | None | Client persistence only; checkout revalidates | Cart never supplies authoritative price |
| Checkout | `create_marketplace_checkout_reservation` and creator/LIVE variants | Checkout session, order/items, inventory reservations; canonical product/variant/store/seller, price, promotion and creator snapshots | None until payment | Actor/idempotency advisory locking, request fingerprint, inventory row locks and uniqueness | Buyer ownership/RLS; order lifecycle, Creator/LIVE proofs |
| BDAG payment | `bdag-ledger` Edge action `marketplace_checkout_pay` | Service-only `pay_marketplace_checkout_with_bdag` / canonical internal authority; payment, allocation, ledger transaction and inventory movement | `marketplace_checkout_pay` exact gross debit/escrow credit | Same-key replay receipt, fingerprint conflict rejection, serialized payment/inventory | Payments reconciliation and analytics/order proofs |
| Inventory | Seller inventory RPCs; reservation through checkout | Variant inventory, reservations and movement rows | None | Row/version locks, unique movement/request authorities | Seller ownership; lifecycle/LIVE concurrency proofs |
| Orders | Buyer order reads; seller fulfillment RPCs | Frozen order and item snapshots; guarded state transitions | None directly | State predicates and canonical IDs; repeat transition is deterministic/rejected | Order lifecycle proof |
| Shipping/delivery | Seller start/ship; buyer delivery confirmation | Shipment/order state; internal delivery-and-release bridge | Settlement release only through canonical internal function | Order/shipment locks and completed-state idempotency | Shipping proof and settlement reconciliation |
| Escrow/payment allocations | Not writable from browser | Payment allocations and Marketplace escrow ledger | Exact gross held | One allocation per payment/order; transaction uniqueness | Payments/settlements reconciliation |
| Settlements | Delivery path invokes service-only settlement authority | `marketplace_create_order_settlement_b7f`, settlements and settlement legs | Seller + platform + creator legs equal gross | Order/allocation locks, unique settlement/leg constraints, canonical replay | Settlement, B7F and B7R proofs |
| Disputes | Buyer report; Admin Web `admin_resolve_marketplace_dispute` | `resolve_marketplace_dispute`, held-v1/release authority and final decision/review records | Held refund or release only through canonical functions | Required idempotency key/fingerprint, row locks; two-connection winner | B8B/dispute-refund proofs; admin audit 8/8 |
| Post-settlement reversal | Protected post-settlement review/admin resolution | `open_marketplace_post_settlement_review`, B7R `reverse_marketplace_released_settlement` | Exact reversal legs and buyer refund | Original transaction linkage, unique reversal, row/advisory locking | B7R 32/32 and B8B post-settlement proof |
| Promotions | Seller create/end/list; canonical effective-price read | `create_marketplace_product_promotion`, `end_marketplace_product_promotion`, `marketplace_effective_price` | Price snapshot only at checkout | Request fingerprint/idempotency and overlap/state rules | Promotion proof; immutable order-item promotion snapshots |
| Seller Center | Seller store/product/variant/inventory/shipping/promotion/ads RPCs | Domain-specific server-authoritative RPCs | No arbitrary ledger/balance writer | Seller ownership plus per-domain fingerprints/locks | Runtime/publication/shipping/promotion/Ads proofs |
| Creator attribution | Showcase, Feed, Reel, Direct Creator Link and LIVE checkout sources | Frozen item attribution and entitlement snapshots | Historical BPS/base only; no payout here | Unique item/creator attribution and request fingerprint | B7A 36/36 |
| Creator allocations | Payment/settlement internal path | B7F item creator allocations and settlement legs | Canonical generated/released commission | Item-level uniqueness, locked settlement | B7F 27/27; multi-creator proof |
| Showcase | Creator showcase RPCs | Showcase item/state and attribution source identity | None | Ownership, bounds, fingerprint | B7B 23/23 |
| Feed/Reel product tags | Creator content-tag RPCs | Content tag/state and source identity | None | Ownership, limits, fingerprint | B7C 28/28 |
| LIVE Shopping | Host product pin/unpin and LIVE reservation/payment paths | LIVE product/session snapshot, item attribution, B7F allocation | Canonical payment and creator commission path | Session/product locks; concurrent checkout and revocation/end-LIVE rejection | B7E and LIVE v2 proofs |
| Creator analytics | Mobile creator analytics and B8C admin reads | B7D facts, B7F settlement legs, B7R reversal legs | Read-only: generated from allocations; released from legs; reversed from reversal legs; net = released - reversed | Stable UTC window | B7D 18/18, B8C temporal proof |
| Marketplace Ads lifecycle | Seller draft/activate/pause/resume | Campaign state and eligibility clock | Funding only through canonical activation | Owner checks, fingerprints, locks | Ads eligibility/finalization/delivery proofs |
| Ads finance | No browser spend/release/finalize access | Service-only spend, unused-budget release and finalization authorities; financial events/finalizations | Exact escrow, revenue, spend, release | Transaction/event uniqueness, campaign locks, canonical finalization replay | Ads finance 23, eligibility 4, finalization 4, delivery 5, events 7—all zero |
| Admin B8A reads | Admin Web overview/orders/detail | Guarded read projections | None | Bounded cursor pagination | `marketplace_require_admin`; B8A proof |
| Admin B8B mutations | Disputes/sellers/products | Narrow wrappers reuse canonical functions; append-only admin action audit | No admin-supplied money | Server actor, UUID key/fingerprint, target locks/state transitions | B8B proof and reconciliation 8/8 |
| Admin B8C intelligence | Creator, promotions, Ads, Health, Activity | Guarded bounded read projections | None | Null-safe max-100 keyset cursors | B8C proof and deep web validation |
| Health/reconciliation | Admin Web Health; remote auditors | Stable reconciliation functions only | None; no repair authority | Read-only | Payments, settlements, creator, reversal, Ads and admin groups |

No competing high-impact economic writer was found. Browser/mobile flows either call a canonical server authority or read projections; financial internal functions retain narrow service/internal grants.

## Security, B8S, RLS and grants

- B8S was re-proved locally: ordinary users cannot insert `is_admin=true`, change `is_admin`, change another profile, or use forged `user_metadata`/`app_metadata`; safe profile creation/editing remains available.
- Admin authority remains `user_profiles.is_admin` -> `marketplace_actor_is_admin()` -> `marketplace_require_admin()`. B8A/B8B/B8C RPCs independently enforce the server guard; UI capability labels are not authorization.
- Buyer, seller, creator and campaign ownership comes from `auth.uid()` or server-resolved canonical ownership. Client identity parameters used by admin detail filters do not establish authority.
- Effective raw Marketplace table DML is denied to browser roles. One exception in privilege *types*, not current Data API DML reachability, is documented below for promotions (`REFERENCES`, `TRIGGER`, `TRUNCATE`).
- No exposed Marketplace function taking user-controlled SQL, DDL, object name, or executable fragment was found. No browser service-role key, database password, JWT secret, private key, Stripe secret, ledger credential, or payment secret was present in Admin Web source or the production bundle.
- Effective function history was audited at the final migration state. Historical replacements are harmless where later definitions/grants supersede them. One still-executable superseded admin creator-list read is recorded as P2.

## PUBLIC SCHEMA / DEFAULT PRIVILEGE AUDIT

### Exact current production state

Remote `public` ACL:

```text
pg_database_owner=UC/pg_database_owner
=U/pg_database_owner
postgres=U/pg_database_owner
anon=U/pg_database_owner
authenticated=U/pg_database_owner
service_role=U/pg_database_owner
```

`PUBLIC`, `postgres`, `anon`, `authenticated`, and `service_role` therefore have `USAGE`; only `pg_database_owner` has schema `CREATE`. Catalog `has_schema_privilege` confirmed `CREATE=false` for `anon`, `authenticated`, `authenticator`, and `service_role`.

The interrupted local result (`CREATE=true`) came from `scripts/create-marketplace-disposable-db.mjs`, which creates `public` and grants all on it to the disposable roles and PUBLIC. A harmless transaction-scoped local trigger proof demonstrated why that bootstrap is not a faithful schema-ACL model. It is not evidence of remote exploitability.

### Role attributes

| Role | LOGIN | SUPER | CREATEROLE | CREATEDB | BYPASSRLS | INHERIT |
|---|---:|---:|---:|---:|---:|---:|
| anon | false | false | false | false | false | true |
| authenticated | false | false | false | false | false | true |
| authenticator | true | false | false | false | false | false |
| service_role | false | false | false | false | true | true |
| postgres | true | false | true | true | true | true |

The authenticator carries `safeupdate`, an 8-second statement/lock timeout, and does not inherit. `anon` and `authenticated` have 3/8-second statement timeouts respectively.

### Search path and SECURITY DEFINER

- Session search path: `"$user", public`; postgres role config: `"$user", public, extensions`.
- Marketplace `SECURITY DEFINER` functions: 201, all owned by `postgres`.
- Fixed search path: 201/201; 174 use `public`, 26 use `pg_catalog, public`, and one uses an empty path.
- Effective unsafe-search-path count: 0, because the relevant client roles cannot create objects in `public` remotely.
- No exposed dynamic-SQL/DDL RPC was found. Sensitive Marketplace writers use fixed paths; production callers cannot inject object/function names.

### Data API and DDL reachability

PostgREST exposes tables/views and explicitly granted functions, not a raw SQL endpoint. Since client roles have no schema `CREATE` and no exposed function evaluates arbitrary SQL/DDL, an anon/authenticated Data API request cannot issue `CREATE` or install an object into the definer search path. No external attack was attempted.

### Default ACL and dormant grants

`pg_default_acl` is broad for objects created by both `postgres` and `supabase_admin` in `public`:

- tables: `anon`, `authenticated`, and `service_role` receive `arwdDxtm`;
- sequences: those roles receive `rwU`;
- functions: those roles receive `X`.

Current migrations generally revoke and re-grant intentionally, but a future object can be transiently or permanently exposed if its migration omits the revocation. Current `marketplace_product_promotions` retains `REFERENCES`, `TRIGGER`, and `TRUNCATE` for anon/authenticated. Direct local `TRUNCATE` was blocked by foreign-key/related-table privileges and Data API clients have no raw DDL statement path, but the grants are unnecessary.

### Exploitability and severity

Finding B8D-001 is **P2**. There is no demonstrated current anonymous/authenticated path to privileged execution or money/security control, so P0/P1 is not supported. The finding is still material least-privilege and future-object exposure debt and must not be dismissed merely because no remote exploit was attempted.

Recommended forward-only remediation (not implemented here): explicitly revoke schema CREATE defensively; alter default privileges for the actual object owners to revoke broad PUBLIC/anon/authenticated table, sequence and function privileges; retain explicit narrow grants; revoke dormant promotion `REFERENCES/TRIGGER/TRUNCATE`; make the disposable bootstrap mirror production ACLs; and add catalog regression tests proving effective grants after migrations.

## Buyer, checkout, payment, inventory, orders and shipping

- Checkout re-resolves canonical product/variant/seller/store data and freezes base price, discount, unit price, shipping, promotion and creator attribution. The cart is not authoritative.
- BDAG payment uses the canonical checkout total, exact debit/escrow credit, payment allocation and transaction types. Same-key replay returns the prior canonical receipt; changed fingerprints fail; concurrent payment cannot double debit.
- Inventory reservation, expiry, release and consumption are server-controlled. Local lifecycle and LIVE concurrency proofs showed no oversell, negative stock, duplicate consumption, or persistent failed-checkout reservation; cleanup restored exact inventory.
- Order `processing -> shipped -> delivered` state transitions and the legitimate refund path were proved. Buyer/seller cross-identity mutations and illegal/repeated transitions fail.
- Shipping remains bound to canonical order/store/seller identity. Delivery cannot release a second settlement.

## Escrow and settlement economics

Canonical settlement enforces the frozen invariant:

```text
gross = seller net + platform fee + creator commission leg(s)
```

No client submits the split. Payment allocation, settlement and ledger transaction reconciliation showed no imbalance, missing/duplicate leg, beneficiary/currency mismatch, premature release, or double release. Remote escrow was exact: expected held total 71 BDAG and actual balance 71 BDAG; difference, shortage and surplus were zero.

## Disputes, held refunds and post-settlement reversals

- `manual_review` is intermediate and moves no money; `reject_claim` does not move money.
- Held `refund_buyer` and `release_seller` reuse canonical locked authorities. Same-key retry is one effect; conflicting two-connection final decisions produce one winner.
- Post-settlement refunds use B7R, with exact buyer/seller/platform/creator reversal legs, original transaction linkage, no refund above original, no duplicate reversal and no duplicate buyer credit.
- The already-released `release_seller` receipt returns `money_moved=false` without creating another settlement; the hardened Admin Web validator accepts both canonical release families.

## Creator Commerce

- Showcase, Feed, Reel, Direct Creator Link and LIVE retain item-level creator, surface and source-entity identities.
- Multi-creator orders retain item-specific GMV; whole-order GMV is not duplicated. B7F allocation and settlement/reversal legs remain per item/creator.
- Attribution freezes creator identity, product/variant, entitlement, item GMV/base, `commission_bps` (constraint 1..3000) and generated amount. A later offer/config change did not alter the proof snapshot (1200 BPS remained historical while the later setting was 900).
- Generated commission comes from B7F allocation, released from settlement legs, reversed from B7R legs, and net remains released minus reversed.
- B8C temporal proofs passed: sales use `paid_at`, releases `released_at`, reversals `reversed_at`, engagement `occurred_at`, all bounded by a stable upper `v_end`; old-sale/new-release and old-sale/new-reversal are represented without attributed GMV leakage.

## Promotions

Scheduled, active, ended and cancelled states plus percentage, fixed-amount and promotional-price forms passed the canonical proof. `marketplace_effective_price` determines current price server-side. Checkout freezes `promotion_id`, `base_unit_price`, `discount_amount`, and `unit_price`; ending/changing a live promotion cannot rewrite a paid item snapshot. No admin promotion-price mutation exists in B8C.

## Marketplace Ads

- Campaign owner checks cover draft, funding/activation, pause/resume, eligibility, eligible clock, delivery, events, attribution and terminal states.
- Browser roles cannot call spend, unused-budget release, delivery finalization or expired finalization internal financial functions.
- Funding occurs once; spend/release derive canonical amounts; campaign equation, escrow liability and revenue reconcile; overspend and ineligible delivery fail; events/transactions/finalization are unique and idempotent.
- B8C is observational only and accepts no ad spend/release/finalization amount. It exposes canonical financial, eligibility, delivery, event and attribution projections.

## Admin Web and audit trail

All Marketplace routes—overview, orders, disputes, sellers, products, Creator Commerce, promotions, Ads, Health and Activity—sit under `apps/admin-web`, restore a Supabase session, and then require server-side admin access. B8A/B8B/B8C list RPCs use bounded keyset pagination with max 100 and null-safe limits. Deep runtime validators reject malformed UUID, timestamp, money, enum, array/object and nested receipt/Health contracts into controlled error/retry states.

B8B mutations are narrow and refetch canonical state. The action audit is server-written, append-only, tied to server-derived actor/action/target and idempotency-safe; browser INSERT/UPDATE/DELETE is denied. Health uses group-specific exact contracts, retains observational payment/escrow totals, and cannot hide nonzero failure counters. No arbitrary repair or ledger/balance endpoint exists.

## Concurrency and idempotency matrix

| Operation | Same key / same request | Same key / changed request | New key after completion | Simultaneous behavior / authority |
|---|---|---|---|---|
| Checkout reservation | Same canonical session/receipt | Fingerprint conflict | State/stock rules prevent duplicate semantic reservation | Actor/key advisory lock plus inventory row locks |
| BDAG payment | Prior canonical receipt | Conflict | Paid state prevents second debit | Payment/order locking and unique transaction/allocation |
| Inventory consumption | One movement | Conflict | Consumed state prevents repeat | Row locks/version and unique movement authority |
| Settlement release | Existing settlement receipt | Conflict/state rejection | Already released => no second money movement | Order/allocation locks plus unique settlement/legs |
| Dispute final decision | Same decision receipt | Conflict | Final-state rejection | Real two-connection test: one winner, other safely rejected |
| Post-settlement reversal | Same reversal receipt | Conflict | Existing reversal prevents duplicate | Original-leg linkage, unique reversal and locked authority |
| Seller/product moderation | Deterministic prior receipt | Fingerprint conflict | State validation/idempotent current state | Target locking and admin audit uniqueness |
| Ads funding | Existing fund receipt/event | Conflict | Funded state prevents second transfer | Campaign lock and transaction/event uniqueness |
| Ads spend | One canonical spend | Conflict | Allowed only for remaining canonical delivery; no caller amount | Campaign lock, event/transaction uniqueness, overspend guard |
| Ads release | Existing release/finalization | Conflict | Terminal liability already zero | Campaign lock and unique release event |
| Ads finalization | Existing finalization receipt | Conflict | Terminal idempotent result | Campaign lock, unique finalization and canonical cutoff |

The existing two-connection proofs were retained for creator attribution/settlement, dispute resolution and other race-sensitive lifecycle operations; sequential calls were not mislabeled as race proofs. No double-tap path was found that can duplicate a financial or inventory effect. UI submit locks reduce accidental repeats, while the server remains authoritative if two requests arrive.

## Reconciliation results

Remote read-only reconciliation at migration 32000:

- payments: all failure counters zero; observational confirmed-state breakdown `{confirmed:2, processing:0, shipped:2, delivered:21, refunded_fixture:233, invalid:0}`;
- settlements: all failures zero; escrow expected 71, actual 71, difference/shortage/surplus zero;
- Creator Commerce authority: 36/36 zero;
- Creator Showcase: 23/23 zero;
- Creator Content Tags: 28/28 zero;
- creator allocations: 27/27 zero;
- LIVE creator commissions: 9/9 zero;
- Creator Analytics: 18/18 zero;
- reversals: 32/32 zero;
- Ads finance: 23/23 zero;
- Ads eligibility: 4/4 zero;
- Ads finalization: 4/4 zero;
- Ads delivery: 5/5 zero;
- Ads events/attribution: 7/7 zero;
- B8B admin operations: 8/8 zero.

No separate final reconciliation function was found for inventory/shipping/publication; their canonical lifecycle proofs assert exact stock/reservation/state behavior and rollback/cleanup, while payment/settlement reconciliations cover their economic effects. The disposable final query returned the same applicable groups healthy with escrow zero/zero in the empty fixture database.

## Fixture and test hygiene

All proof scripts enforce the known localhost disposable target. After the complete suite: proof auth users 0, proof fixtures 0, fixture failure-hook functions 0, admin-operation failures 0. No fixture or test-only privileged function was created remotely. The disposable container was used only locally and is removed in the final source-safety gate.

## Migration and effective-authority audit

Remote/latest parity remained 32000. No migration was created, edited, replayed or pushed. Effective final definitions/grants were audited rather than treating superseded historical text as current authority. Two final-state hardening gaps are Findings B8D-001 and B8D-004; neither creates a financial writer.

## Query and performance audit

- B8A/B8B/B8C admin lists use keyset pagination, max 100, no N+1 request fan-out, and one list/detail projection per screen.
- Four authenticated RPCs allow explicit `p_limit=NULL` to bypass their intended bound: `expire_marketplace_checkout_reservations`, `fetch_marketplace_sponsored_products`, `fetch_marketplace_sponsored_products_v2`, and `fetch_my_marketplace_ad_campaigns` (B8D-002). Statement timeouts and official client bounds mitigate but do not satisfy the contract.
- Seller-owned product, promotion and shipping-profile list RPCs return an entire owned collection with no keyset bound (B8D-003). This is a scale/reliability risk, not current unauthorized access.
- Reconciliation is requested once per Health page load/retry, not per list row or browser loop.
- No speculative index recommendation is made without query-plan evidence.

## Mobile functional architecture inventory for B8D-2/3

| Flow | Route(s) | CTA/state/interaction inventory |
|---|---|---|
| Marketplace discovery/search | `app/(tabs)/shop.tsx` | Search/category/product navigation; load, empty, refresh/error; scrolling list |
| Product/store | `app/product/[id].tsx`, store routes | Add/cart/store navigation; loading/error/retry/back; scroll; canonical BDAG display |
| Cart | `app/cart.tsx` | Quantity/remove/checkout; hydration/empty/refresh; persistence before canonical checkout |
| Checkout/reservation | `app/checkout.tsx`, `app/checkout/reservation/[id].tsx` | Address/payment; keyboard-avoiding scroll; submit lock/idempotency; expiry/error/retry; canonical total |
| Buyer orders | `app/orders/index.tsx`, `app/orders/[id].tsx` | Order/detail/delivery/problem CTAs; loading/empty/error; settlement lock/idempotency; status and money |
| Seller Center | `app/seller/*` | Store, products/variants, inventory, shipping, promotions, analytics, orders and Ads; section loading/error/retry; forms/keyboard/FlatList |
| Creator Showcase/tags | creator-showcase and content-tag routes | Add/remove/reorder; keyboard/FlatList; loading/empty/error/refresh |
| Creator analytics | creator-commerce analytics route | Range/filter/refresh; loading/empty/error; generated/released/reversed/net money |
| LIVE Shopping | broadcast/watch routes | Pin/unpin/product/cart/checkout; safe-area handling, scroll overlays, cleanup/ref locks, end/revocation states |
| Seller Ads | seller Ads routes | Draft/activate/pause/resume; load/empty/error; create-busy/idempotency; canonical budget/status |

Physical tap, keyboard, safe-area and browser/device behavior was not claimed; those remain B8D-3. The inventory records expectations for later manual testing.

## Admin Web UX inventory for B8D-2

- Desktop routes, detail navigation, filters, keyset pagination, loading/empty/error/retry and malformed-payload states exist and are automated.
- At narrow widths the sidebar becomes a horizontal ten-link navigation without an explicit wrap/scroll affordance (P3).
- Below the table breakpoint, headers are hidden and rows become grids without strong per-value field labels, reducing scan clarity (P3).
- High-impact confirmation currently uses native `window.confirm`; reason validation and pending/error/idempotency are correct, but focus management and visual danger differentiation are limited (P3).
- BDAG values and timestamps are server-validated before formatting. Long-name truncation/wrapping and exact laptop/tablet behavior require B8D-2/3 visual review.

## Automated and remote evidence

- Admin Web: 55 tests passed, 0 failed; lint 0 errors/0 warnings; Vite production build succeeded (119 modules, 472.12 kB JS / 134.88 kB gzip).
- Focused B8S/B8A/B8B/B8C static tests: 51 passed, 0 failed.
- Full root Node suite: 702 passed, 0 failed.
- Mobile TypeScript baseline: exactly 187 pre-existing diagnostics; B8D-1 changed-file diagnostics: 0.
- All canonical disposable proof commands listed in `package.json` for fixtures, analytics/B3, order lifecycle, shipping, publication, promotions, runtime, B7A/B7B/B7C/B7D/B7E/B7F/B7R, disputes/refunds, Ads finance/eligibility/finalization/delivery/events, B8S/B8A/B8B/B8C passed.
- Read-only remote B8C audit passed at 32000. `scripts/audit-marketplace-b8d-integral.mjs` independently captured role attributes, schema/default ACLs, function security properties, current broad grants and null-limit candidates without INSERT/UPDATE/DELETE/TRUNCATE or write-RPC calls.
- No Supabase push, Admin Web deployment, EAS action, or mobile build/export was performed.

## Findings and severity

| ID | Severity | Evidence / actual behavior | Expected / impact | Recommended next action |
|---|---|---|---|---|
| B8D-001 | P2 | Remote client roles cannot CREATE, but `pg_default_acl` grants broad future table/sequence/function rights; promotions retains `REFERENCES/TRIGGER/TRUNCATE`. Disposable bootstrap also overgrants schema CREATE. | Least privilege should make exposure explicit; an omitted future revoke could expose an object through Data API. No current arbitrary SQL/DDL route or privileged execution was found. | Independent review, then narrow forward ACL/default-ACL hardening and catalog tests; align disposable bootstrap. |
| B8D-002 | P2 | Four authenticated functions accept explicit null limits and can execute `LIMIT NULL`. | All externally callable list/batch operations should reject/coalesce null and enforce a hard maximum. Could cause oversized scans/response or cleanup batch. | Forward `CREATE OR REPLACE` null-safe validation, preserve signatures/semantics, add 1/100/null/0/101 proofs. |
| B8D-003 | P2 | Seller product, promotion and shipping-profile list projections are owner-filtered but unbounded. | Large sellers should not require full-collection reads; latency/memory reliability risk. | Add backward-compatible bounded keyset v2 reads and migrate official clients. |
| B8D-004 | P2 | Superseded `search_marketplace_admin_creators` remains executable by authenticated admins; web uses corrected v2. Old read semantics gate release/reversal by sale time. | One canonical admin intelligence read contract should remain externally callable. Stale direct callers can receive incorrect temporal intelligence, but cannot mutate finance. | Revoke old authenticated execute or forward-redefine/deprecate it after compatibility review. |
| B8D-005 | P2 | Several mobile service mappers coerce UUID/date/enum/money fields with `String`/`Number` or casts rather than B8A-style deep contracts. | Malformed backend payload should fail controlled, not surface `undefined`, `NaN` or an invalid date. Server economics remain authoritative. | Add focused runtime validators and malformed JSON UI tests without changing RPC economics. |
| B8D-006 | P3 | Ten-link narrow Admin navigation has no explicit overflow/wrap affordance. | Discoverable narrow-window navigation. | B8D-2 responsive navigation design. |
| B8D-007 | P3 | Narrow tables hide headers and grid values lack consistent field labels. | Operational rows should retain context at tablet/narrow laptop widths. | B8D-2 responsive row/card labels. |
| B8D-008 | P3 | Native `window.confirm` is used for privileged confirmation. | Accessible focus-managed, visually differentiated high-impact confirmation. | B8D-2 confirmation-dialog polish; preserve current reason/idempotency contracts. |

P0: **0**. P1: **0**. P2: **5**. P3: **3**.

There is no integrity blocker under the phase's P0/P1 rule. The explicit process blocker is independent review of the P2 hardening decision before B8D-2. None of these findings was fixed in B8D-1.

## Recommended next action

Independently review this artifact. If accepted, authorize a focused forward-only hardening phase for the selected P2 items—starting with default ACL/current grant cleanup and null-safe bounds—then rerun catalog, disposable, reconciliation and client-runtime regressions. Do not start B8D-2 until that decision is recorded. B8D-3 physical/browser testing and B8D-4 freeze remain not started.

## MKT-B8D-1H — Production Hardening Closure

Baseline: branch `codex/mkt-a4b-premium-integration`, starting SHA `892dc8d376e57b2e97e143399b48e9aa4309695e`, Build 22, remote migration `20260811032000`. The correction is the single forward migration `20260811033000_marketplace_production_hardening.sql`; no historical migration was edited and no economic formula or financial writer changed.

### B8D-001 — default ACL and current privilege hardening

- Original finding: postgres and supabase_admin public-schema default ACLs broadly granted future objects to anon/authenticated, promotions retained dormant `REFERENCES/TRIGGER/TRUNCATE`, and the disposable bootstrap overgranted schema CREATE.
- Effective-owner audit: all 239 post-hardening Marketplace functions and all 60 Marketplace table/sequence/view objects are owned by postgres. Postgres cannot `SET ROLE supabase_admin`; supabase_admin owns zero Marketplace objects. Platform-managed supabase_admin defaults and service_role defaults were therefore preserved.
- Fix: schema CREATE is defensively revoked from PUBLIC, anon, authenticated, authenticator and service_role. Postgres public defaults revoke anon/authenticated/PUBLIC table and sequence access. Because PostgreSQL's built-in function default grants PUBLIC EXECUTE globally and a schema-local revoke cannot override it, the migration also performs the necessary global postgres function-default revoke. Explicit service_role defaults remain. Promotion `REFERENCES/TRIGGER/TRUNCATE` is revoked from anon/authenticated.
- Proof: rollback-created postgres table, sequence and function each gave anon/authenticated no initial privilege. Remote catalog reports anon/authenticated/authenticator/service_role `CREATE=false`, zero unexpected postgres default grants, zero broad Marketplace client DML/dormant privileges, and 204/204 Marketplace SECURITY DEFINER functions with fixed search paths (effective unsafe count zero). Disposable bootstrap now mirrors production CREATE denial. Residual risk: platform-managed supabase_admin defaults remain broad by design; they do not currently create Marketplace objects and were not changed without platform authority.

### B8D-002 — NULL-safe bounded contracts

- `expire_marketplace_checkout_reservations`: default 100; 1 and 100 accepted; NULL, 0 and 101 reject with SQLSTATE 22023.
- `fetch_marketplace_sponsored_products` and v2: existing clamp contract preserved—default/NULL 4, 1 and 8 accepted, 0 returns no candidates, values above 8 clamp to 8. Explicit NULL can no longer become `LIMIT NULL`.
- `fetch_my_marketplace_ad_campaigns`: existing clamp contract preserved—default/NULL 50, 1 and 100 accepted, 0 clamps to 1, 101 clamps to 100.
- Remote catalog reports both the targeted and general authenticated null-limit risk lists empty.

### B8D-003 — bounded seller-owned lists

Added `fetch_my_marketplace_products_v2`, `list_my_marketplace_promotions_v2`, and `fetch_my_marketplace_shipping_profiles_v2`. Each is owner-derived from `auth.uid()`, SECURITY DEFINER with `search_path=pg_catalog, public`, default 50, hard max 100, explicit NULL/0/101 rejection, paired-cursor validation, and no OFFSET.

Keysets are respectively `(updated_at DESC,id DESC)`, `(created_at DESC,id DESC)`, and `(created_at ASC,id ASC)`. Three matching indexes were added only for these query shapes. Official mobile callers use v2. To preserve already-shipped Build-22 compatibility, the old signatures remain but delegate to a bounded first page of at most 100; they can no longer perform an unbounded scan.

Disposable fixtures produced pages 2+1 in all three domains with no duplicates/skips, deterministic cursors, terminal null cursors, and zero cross-seller rows. Default/max/null/0/101 contracts passed and rollback fixture residue was zero.

### B8D-004 — superseded creator admin read

Repository search found no supported old client; Admin Web and the corrected proof use `search_marketplace_admin_creators_v2`. The inaccurate v1 function remains only for trusted service-side compatibility: anon execute false, authenticated execute false, service_role execute true. Correct v2 remains anon false/authenticated true and independently calls the frozen admin guard. Disposable ordinary authenticated access returned 42501; a protected admin v2 call succeeded.

### B8D-005 — mobile RPC runtime validation

Added the shared `marketplaceRuntimeValidation.ts` boundary and applied it to Marketplace Ads, promotions, products/variants/seller lists, shipping profiles/quotes, Creator analytics, checkout/order reservation, payment receipts, and buyer/seller fulfillment detail/list/lifecycle reads. Required UUIDs, finite nonnegative money, integer quantities/counts, timestamps, enums, booleans, arrays, objects, nullable fields and cursor envelopes now fail closed with controlled typed service errors instead of coercing malformed JSON into `undefined`, `NaN`, `Invalid Date`, fabricated status, or wrong BDAG display.

Realistic malformed-JSON tests cover string/boolean money, malformed UUID/timestamp/enum, fractional quantity, object/array substitution and malformed/oversized cursor envelopes. Existing screens retain their loading/error/retry boundaries; no visual redesign was introduced.

### Verification and deployment evidence

- Forward migration compiled twice on the disposable final-state schema. The focused hardening proof passed ACL/default-object creation, current grants, all four limit contracts, three multi-page seller lists, creator old/v2 access and fixture cleanup.
- B8S/B8A/B8B/B8C plus hardening focused tests: 61 passed, 0 failed. Admin Web: 55 passed, lint 0 warnings/errors, Vite build succeeded (119 modules). Full root Node suite: 712 passed, 0 failed.
- Mobile TypeScript remained exactly 187 pre-existing diagnostics; hardening changed-file diagnostics: 0. Build stayed 22. No EAS.
- All inherited disposable Marketplace proofs passed: checkout/payment, inventory/order lifecycle, shipping/publication, settlements, held disputes, post-settlement reversals, B7A/B7B/B7C/B7D/B7E/B7F/B7R, promotions, Ads finance/eligibility/finalization/delivery/events, B8S/B8A/B8B/B8C, runtime and fixture finalization. All reported zero failure counters and zero persistent fixtures.
- Predeploy remote audit was healthy at 32000. Linked dry-run contained exactly 33000, no seeds/roles/other migrations. The migration deployed once. Postdeploy catalog audit is healthy at 33000: default/client exposures zero, dormant promotion grants zero, null-limit risks zero, creator v1 policy correct, seller v2 grants/fixed paths correct, dynamic SQL exposure zero.
- Postdeploy inherited remote reconciliation is healthy: B8B 8/8 zero; Creator Commerce 36/36, Showcase 23/23, Content Tags 28/28, allocations 27/27, LIVE 9/9, Analytics 18/18 and reversals 32/32 zero; Ads finance 23/23, eligibility 4/4, finalization 4/4, delivery 5/5 and events 7/7 zero; payments/settlements failure counters zero with escrow expected 71 = actual 71. Fixtures 0; failure hooks absent.

### Residual scope

B8D-001 through B8D-005 are corrected with production effective-state proof. The accepted P3 findings remain open unchanged: B8D-006 narrow navigation overflow, B8D-007 narrow table labels, and B8D-008 accessible privileged confirmation polish. They are reserved for separately authorized B8D-2. B8D-2, B8D-3 and B8D-4 were not started.
