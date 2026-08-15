# MKT-B8C Execution Log — Marketplace Intelligence & Advanced Operations

## Baseline

- Starting SHA: `6415f89117740417707b1d982e7553d003ad3adc`
- Branch: `codex/mkt-a4b-premium-integration`
- Build: `22`
- Starting remote migration: `20260811030000_marketplace_admin_operations_closure.sql`
- B8S, B8A, B8B, B8B-C1 and B8B-C2 were audited as closed/frozen prerequisites. The precheck was clean and local/origin were identical.

## Architecture audit

B8C extends only `apps/admin-web`. No Expo route or mobile navigation is involved. All projections derive authorization through `marketplace_require_admin()` and therefore the protected B8S `user_profiles.is_admin` boundary. No browser service-role credential is used.

Creator Commerce reuses `marketplace_creator_commerce_analytics_facts` and `marketplace_creator_commerce_event_facts`. The former already joins immutable B7A attribution snapshots, exact B7F item allocations, creator settlement legs and B7R reversal legs. B8C retains item GMV and defines net commission as released minus reversed. Surface identity remains `creator_showcase`, `feed`, `reel`, `direct_creator_link`, or `live`.

Promotions reuse `marketplace_product_promotions`, `marketplace_effective_price(...)`, and immutable `marketplace_order_items` snapshot columns `promotion_id`, `base_unit_price`, `discount_amount`, and `unit_price`. No promotion mutation was introduced.

Marketplace Ads reuse campaigns, financial events, finalizations, delivery materializations, events, touches, and order attribution. Internal spend, unused-budget release, delivery finalization and expiry finalization remain service-role-only. B8C adds no Ads mutation RPC and accepts no Ads amount.

B8B `marketplace_admin_action_audit` remains immutable. B8C exposes a bounded read projection only.

## Server contract

Migration: `20260811031000_marketplace_admin_intelligence_ops.sql`.

Capabilities added: `marketplace:creator-commerce`, `marketplace:promotions`, `marketplace:ads`, `marketplace:health`, and `marketplace:audit`.

RPCs:

- `get_marketplace_admin_creator_commerce_overview(text)`
- `search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)`
- `get_marketplace_admin_creator_detail(uuid,text)`
- `search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer)`
- `get_marketplace_admin_promotion_detail(uuid)`
- `search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer)`
- `get_marketplace_admin_ad_detail(uuid)`
- `get_marketplace_admin_health()`
- `search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)`

Every list defaults to 50, caps at 100, explicitly rejects NULL/0/101, uses a composite keyset cursor, and reads one bounded server projection. Full terminal pages do not emit a false cursor. Existing indexes lead with seller or target and could not satisfy global admin ordering, so three narrow keyset indexes were added: promotion `(created_at DESC,id DESC)`, Ads campaign `(created_at DESC,id DESC)`, and admin activity `(created_at DESC,id DESC)`. Creator/time and Ads event/attribution indexes were already sufficient and were not duplicated.

Health is read-only and returns real reconciliation payloads for payments, settlements, creator commerce/showcase/content tags/allocation/LIVE commissions/analytics/reversal, Ads finance/eligibility/finalization/delivery/events, and B8B operations. Deterministic attention flags cover expired-unfinalized and active-ineligible Marketplace Ads. There is no repair endpoint.

Final proof review found that the initial creator-list projection ranked the largest individual attributed line instead of aggregate GMV per surface. Commit `4ca70f1` corrected the not-yet-deployed migration with a `surface_totals` aggregation before ranking. This was a real projection defect, not a financial-authority change. The same review added the existing Showcase, content-tag, and LIVE commission reconciliations to the health projection.

## Web implementation

Routes added under the existing admin shell:

- `/marketplace/creator-commerce` and `/:creatorId`
- `/marketplace/promotions` and `/:promotionId`
- `/marketplace/ads` and `/:campaignId`
- `/marketplace/health`
- `/marketplace/activity`

All new RPC payloads pass explicit deep runtime validation for UUIDs, timestamps, money, integers, booleans, nullable fields, arrays, nested objects, and cursors. Malformed payloads reach the existing controlled error/retry state. There are no browser financial calculations or mutation controls.

## Local proof

`prove:marketplace-admin-intelligence-ops` passed against localhost port 55422 with:

- anonymous, ordinary authenticated, and forged-metadata users denied;
- protected B8S admin allowed;
- all five B8C capabilities returned;
- 7d/30d/90d/all and invalid range behavior checked;
- item-level Creator Commerce authority and released-minus-reversed semantic verified from deployed function definitions;
- canonical promotion effective price 18 BDAG from a 20 BDAG item with a 10% promotion;
- Ads budget 100, spent 0, released 0, remaining reserve 100;
- authenticated grants for Ads spend/release/finalize all false;
- healthy reconciliation baseline, controlled mismatch surfaced, rollback healthy;
- B8B activity visible and immutable;
- all list NULL/0/101 limits rejected and 1/100 accepted;
- B8B reconciliation 8/8 zero;
- fixture residue zero.

Evidence is deliberately split rather than duplicated: the B8C-specific proof creates runtime admin, promotion, Ads, health-mismatch, and activity fixtures and inspects the deployed Creator projection definition. The canonical B7D/B7F regressions provide the runtime multi-creator, five-surface, historical allocation, release, and reversal fixtures; the canonical Ads finance/eligibility/finalization/delivery/attribution proofs provide the full Ads lifecycle fixtures. The B8C proof output labels these Creator checks as projection assertions and canonical surfaces audited, not as newly constructed B8C sales. A final evidence review corrected the earlier machine-readable labels so they do not imply a fixture that the B8C-specific script did not itself create.

## Security and financial non-authority

No service-role key, DB password, JWT secret, private key, or payment secret is present in the web. B8C has no actor/admin parameter, raw ledger call, creator allocation mutation, promotion snapshot mutation, Ads financial mutation, or authenticated raw financial-table write. Historical migrations were not edited. B8D was not started.

## Gates and deployment

- Admin Web: 40/40 tests; ESLint 0 warnings/errors; Vite/TypeScript production build succeeded (119 modules).
- Focused B8S/B8A/B8B/B8C: 45/45.
- Root Node suite: 696 passed, 0 failed.
- Mobile TypeScript: exactly the frozen 187 unrelated diagnostics; zero B8C changed-file diagnostics.
- Canonical regressions passed for B3, B7A (36/36), B7B (23/23), B7C (28/28), B7D (18/18), B7E, B7F (27/27), B7R (32/32), dispute/refund, order lifecycle, shipping, publication, promotions, Ads finance/eligibility/finalization/delivery/attribution, fixtures, and runtime.
- Remote predeploy audit: passed read-only at `20260811030000`; B8C absent, B8S/B8A/B8B healthy, fixtures 0, failure hooks absent, inherited reconciliations zero.
- Linked dry-run: exactly `20260811031000_marketplace_admin_intelligence_ops.sql`; seeds `[]`; roles `[]`.
- Deployment: exactly that migration applied; no web hosting deployment.
- Remote postdeploy: passed read-only at `20260811031000`; all nine B8C RPCs present, guarded, and correctly granted; Ads internal finance denied; audit immutable; fixtures 0; failure hooks absent.
- Final remote reconciliations: B8B 8/8 zero; Creator Commerce 36/36, analytics 18/18, Showcase 23/23, content tags 28/28, B7F 27/27, B7R 32/32; all Ads and inherited payment/settlement counters zero; escrow expected/actual 71/71.
- Commits: `ca6b6ff` authority, `5efcd31` web, `4ca70f1` aggregate-surface/health correction, and the final proof/documentation commit containing this log.
- Final SHA: the final proof/documentation commit containing this log (reported in the external final report).
- Build: 22. No EAS. No merge. No historical migration edit.
- B8D: NOT STARTED.
