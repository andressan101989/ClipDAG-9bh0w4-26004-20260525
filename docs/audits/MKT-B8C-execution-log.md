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

## MKT-B8C-C1 closure

### Independent review findings and correction

Starting SHA: `b1818d4ff193d6d8692e0957c3f3ef15c659a54a`. Branch: `codex/mkt-a4b-premium-integration`. Build: `22`. Remote migration before correction: `20260811031000_marketplace_admin_intelligence_ops.sql`.

Independent review identified three projection/validation gaps, without finding a new financial authority: B8C creator release/reversal metrics were incorrectly gated by the sale payment clock; the creator item trace omitted the immutable attribution `commission_bps`; and several browser payload contracts treated required nested fields as optional. It also required a complete audit of Health counter classification.

Forward migration `20260811032000_marketplace_admin_intelligence_closure.sql` replaces only the affected read projections and Health classifier. It does not edit the deployed `20260811031000` migration or any earlier migration.

The corrected creator overview, creator v2 search, and creator detail each take one stable `v_end := clock_timestamp()` and derive the frozen B7D sets independently:

- sales: `paid_at >= v_start AND paid_at < v_end`;
- releases: positive creator release with `released_at >= v_start AND released_at < v_end`;
- reversals: positive creator reversal with `reversed_at >= v_start AND reversed_at < v_end`;
- engagement: `occurred_at >= v_start AND occurred_at < v_end`;
- `all`: no lower bound, while retaining the `< v_end` upper bound.

Orders, units, attributed GMV, and generated commission come only from sales. Released commission comes only from releases; reversed commission comes only from reversals; net remains released minus reversed; observational opens/cart events come only from engagement. Surface projections use the same four sets and item facts, never whole-order GMV.

The deployed creator-list signature is preserved and a narrow `search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)` is added for the corrected membership/cursor contract. Membership is the union of sales, releases, reversals, and engagement. Its keyset is `activity_at + creator_id`, avoiding the misleading old `last_sale` label. It defaults to 50, caps at 100, explicitly rejects NULL/0/101, has no OFFSET, emits no false terminal cursor, and the web uses only v2.

Creator detail now joins `marketplace_order_item_creator_attributions` by the canonical order/item/creator identity and returns `a.commission_bps AS historical_bps`. The browser validates it as an integer in the frozen 1..3000 constraint and renders it read-only. It never reads current offer BPS and performs no BPS calculation.

### Runtime temporal and historical proof

The disposable proof constructs paid Marketplace orders through canonical B7A attribution, B7F allocation, settlement, B7R reversal, and B3 event functions. Controlled timestamps prove:

- sale paid 40 days ago, released in the last day: 7d GMV/generated `0/0`, released `3`;
- another sale paid 40 days ago and released/reversed in the last day: 7d GMV/generated `0/0`, release `3`, reversal `3`;
- combined release-only creator at 7d: GMV/generated `0/0`, released `6`, reversed `3`, net `3`;
- sale paid now and held: GMV `30`, generated `3.6`, released `0`;
- B3 product view/cart at current `occurred_at`: `1/1`; a future-dated event is excluded;
- 7d and 30d exclude the 40-day sales; 90d includes two orders/60 GMV/6 generated; all additionally includes a 120-day order for three orders/90 GMV/9 generated;
- direct-link surface values match the corresponding summary clocks;
- admin and frozen B7D self analytics match for the same creator and 7d range;
- a creator with no 7d sale but a 7d release/reversal remains in the v2 list;
- two one-row keyset pages contain no duplicate or skipped creator and the terminal page has no cursor.

Attribution at 1000 BPS remains 1000 after the seller replaces the offer with 900 BPS. A multi-creator order proves separate immutable 1200 and 900 BPS snapshots on separate attributed items; the earlier creator rows remain 1000. No B8C endpoint can mutate `commission_bps`.

### Runtime payload validation

`adminIntelligenceApi.ts` now has distinct exact validators for creator overview/list/detail summaries, the five canonical creator surfaces, item trace and historical BPS; promotion type/state/status, canonical effective-price output, and historical snapshot money; complete Ads campaign identity/lifecycle/eligibility, seller/store/product, financial events, finalization, delivery, event counts, and attribution; Health group shape/nested counter types/attention entities; and Activity cursor/UUID fields. Required fields no longer use permissive `key in row` behavior. Optional helpers remain limited to SQL-nullable values.

Sixteen B8C web tests include fourteen malformed contract cases: missing creator count, invalid surface, malformed BPS/item identity/timestamps/cursor, missing or invalid promotion contracts and snapshot money, missing Ads eligibility/invalid status, malformed Ads delivery/finalization/events, malformed Health counters/attention, and malformed Activity cursor/UUID. All produce controlled errors; pages retain retry behavior and cannot silently fabricate zero, `NaN`, `Invalid Date`, or `undefined BDAG`.

### Health classifier audit

Every reconciliation included by `get_marketplace_admin_health()` was audited. All selected leaves are failure counters except two documented observational shapes: payment `confirmed_state_breakdown`, and settlement `escrow_expected_held_total` / `escrow_actual_balance`. Their canonical `confirmed_state_mismatches`, invalid-detail array, and `escrow_difference`/shortage/surplus counters remain authoritative failures. The group-aware classifier ignores only those observations. Proof shows nonzero payment state totals remain healthy, equal nonzero expected/actual escrow remains healthy, an unequal pair with a nonzero canonical difference is unhealthy, a real controlled Ads reconciliation mismatch surfaces unhealthy, rollback restores healthy, and B8B remains 8/8 zero. No repair or write endpoint exists.

### Gates, deployment, and status evidence

- B8C disposable proof: passed; canonical lifecycle temporal assertions, B7D equality, BPS immutability/multi-creator trace, Health mismatch/rollback, authorization, pagination, promotions, Ads non-authority, activity immutability, B8B 8/8, and fixture residue `0`.
- Admin Web: `50/50`; ESLint zero warnings/errors; TypeScript/Vite build passed with 119 modules.
- Focused B8S/B8A/B8B/B8C: `50/50`.
- Root Node: `701 passed / 0 failed`.
- Mobile TypeScript: exactly `187` pre-existing diagnostics; C1 changed-file diagnostics `0`.
- Canonical regressions: B3; B7A 36/36; B7B 23/23; B7C 28/28; B7D 18/18; B7E; B7F 27/27; B7R 32/32; disputes/refunds; orders; shipping; publication; promotions; Ads finance/eligibility/finalization/delivery/attribution; fixture finalization; runtime—all passed.
- Remote predeploy: read-only pass at `20260811031000`; C1 absent; B8S/B8A/B8B/B8C healthy; fixtures `0`; all reconciliations zero.
- Linked dry-run: exactly `20260811032000_marketplace_admin_intelligence_closure.sql`; seeds `[]`; roles `[]`.
- Deployment: exactly that migration; no web hosting deployment.
- Remote postdeploy: read-only pass at `20260811032000`; corrected definitions and grants present; Ads internal finance still denied; audit immutable; fixtures `0`; failure hooks absent; B8B 8/8, Creator Commerce, Ads, payments, settlements, and all inherited reconciliations healthy; escrow `71/71`.
- Commits: `584af70` range/Health authority; `dbcb169` strict web payloads; final proof/auditor/log commit containing this section.
- Final SHA: final proof/auditor/log commit reported in the external final report.
- Build `22`; no EAS; no merge; no historical migration edit; no new financial authority; B8D NOT STARTED.

## MKT-B8C-C2 — Health Runtime Contract Closure

Starting SHA: `b569cc4b2c0d623ffdfd00d68e8b42d2381285d2`. Build: `22`. Remote migration before and after C2: `20260811032000_marketplace_admin_intelligence_closure.sql`.

C1's server-side Health classifier was audited and found correct. Its treatment of payment `confirmed_state_breakdown` and settlement expected/actual escrow totals as observations, with canonical mismatch/difference counters retaining failure authority, is unchanged. The remaining defect was solely the browser contract: its generic recursive validator accepted JSON strings, booleans, and nulls where canonical numeric counters were required, and did not require the complete unique group set. C2 creates no SQL migration and performs no Supabase deployment.

### Actual reconciliation schemas audited

`get_marketplace_admin_health()` always returns exactly these 15 groups. The exact top-level counter keys are codified in the web `healthCounterKeys` contract and validated with these types:

- `payments` — 11 keys: eight nonnegative integer failure counts; nonnegative numeric `escrow_shortfall`; required `confirmed_state_breakdown` object with exactly six nonnegative integer states (`confirmed`, `processing`, `shipped`, `delivered`, `refunded_fixture`, `invalid`); required `invalid_confirmed_state_details` array whose objects contain UUID `order_id`, string checkout/order states, and nullable string payment/allocation states.
- `settlements` — 30 keys: 25 nonnegative integer failure counts plus numeric `escrow_expected_held_total`, `escrow_actual_balance`, signed `escrow_difference`, and numeric shortage/surplus. The numeric values are not hardcoded.
- `creator_commerce`, `creator_showcase`, `creator_content_tags`, `creator_allocations`, `live_creator_commissions`, `creator_analytics`, and `reversals` — exact maps of respectively 36, 23, 28, 27, 9, 18, and 32 nonnegative integer failure counters.
- `ads_finance` — 23 exact keys: numeric finance/directional differences; three signed integer transaction/event-count differences; nullable numeric `escrow_liability_difference` where the canonical escrow row is absent; all remaining entry/orphan/mismatch counters are nonnegative integers.
- `ads_eligibility`, `ads_finalization`, `ads_delivery`, `ads_events`, and `admin_operations` — exact maps of respectively 4, 4, 5, 7, and 8 nonnegative integer failure counters.
- Health attention remains an array of objects with string reason/entity/message, UUID entity ID, and `warning|critical` severity.

No reconciliation payload contains a free-form boolean/string/null counter. Arrays and objects are accepted only at their specific canonical fields. `check_count` and `failing_check_count` must be nonnegative integers; `check_count` must equal the exact top-level counter-key count; group `healthy` must equal `failing_check_count === 0`; root `healthy` must equal every group being healthy. Missing, unknown, and duplicate groups are rejected.

### Realistic JSON and page-flow proof

The web suite uses only JSON-representable malformed inputs. It proves rejection of numeric failure counters encoded as `"0"` or boolean `false`; array/object substitutions in both directions; missing, duplicate, and unknown groups; negative check/failure counts; inconsistent group and root health classifications; malformed attention data; and incomplete counter maps. It proves acceptance of legitimate nonzero payment state observations and equal nonzero settlement expected/actual totals with zero difference. A canonical nonzero mismatch with a matching unhealthy classification is valid data, not a malformed payload.

A mocked Health page call passes a realistic string-for-number payload through `validateHealth`; the page renders the controlled ErrorState and retry action, without a healthy badge, crash, `NaN`, or fabricated state. A separately validated canonical unhealthy payload renders `Requiere atención` and the exact failure count.

### Gates and unchanged authority

- Admin Web: `55 passed / 0 failed`; ESLint zero warnings/errors; TypeScript/Vite production build passed, 119 modules.
- Focused B8S/B8A/B8B/B8C: `51 passed / 0 failed`.
- Root Node: `702 passed / 0 failed`.
- Root TypeScript: exactly `187` pre-existing diagnostics; C2 changed-file diagnostics `0`.
- Disposable B8C intelligence proof: passed, including accepted server classifier semantics, controlled mismatch/rollback, B8B 8/8, and fixtures `0`.
- Disposable B8B operations proof: passed, B8B 8/8 zero, concurrency intact, fixtures `0`.
- Remote read-only B8C-C1 audit: healthy at unchanged migration `20260811032000`; B8S/B8A/B8B/B8C healthy; Creator and Ads reconciliations healthy; payments/settlements healthy; Ads financial functions denied; fixtures `0`; failure hooks absent.
- No migration; no Supabase push; no financial or repair authority; no historical migration edit; Build `22`; no EAS; no merge; B8D NOT STARTED.
- Final C2 SHA: the single C2 commit containing this section, reported in the external final report.
