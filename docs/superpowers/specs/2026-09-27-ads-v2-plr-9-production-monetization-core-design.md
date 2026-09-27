# ADS-V2-PLR-9 Production Monetization Core Design

## Status and authority

This document is the consolidated, implementation-ready design for ADS-V2-PLR-9. It incorporates the approved conversational design Sections 1–4 and every subsequent binding correction from the owner and ChatGPT.

The approved source is `origin/codex/ads-v2-plr-8-c1-reconciler-determinism` at `53995babf5ba42a1a8ae71938d242c42cb86adb9`. Implementation belongs on `codex/ads-v2-plr-9-production-monetization-core` and must start from that exact SHA in an isolated clean worktree.

This document authorizes no implementation by itself. The written design must be reviewed before an implementation plan is generated or code, migrations, production state, deployments, rates, billing windows, Spend, native artifacts, or EAS builds are changed.

## Mission

PLR-9 completes the Ads V2 monetization and control-plane architecture without performing physical production testing or real billing. It adds:

- one canonical versioned Ads pricing authority;
- transactional server-side classification of new billable Ads events;
- logical budget reservation and bounded Spend materialization;
- exact rate provenance for every charge;
- permanent prevention of historical back-billing;
- deterministic budget-exhaustion behavior;
- safe launch modes for delivery, billing, settlement recovery, and eventual production;
- bounded billing, lifecycle, settlement, and housekeeping jobs;
- one canonical objective-capability registry;
- Admin rate management and billing observability;
- Business objective, billing, Finance, and analytics truth;
- mode-aware financial reconciliation and production acceptance.

PLR-9 does not publish a real rate, open a billing window, arm a canary, enable Spend, activate or settle a Campaign, move money, modify Edge or native code, or create an EAS build.

## Verified starting state

The implementation precheck must prove all of the following before any code or migration is written:

- repository source SHA is `53995babf5ba42a1a8ae71938d242c42cb86adb9`;
- Supabase project is `aewwdlvbwpczqyvkwvvj`;
- migration count is 297 and latest migration is `20260927195846_ads_v2_plr_8_c1_reconciler_determinism`;
- `ads-v2-delivery` is ACTIVE, version 3, JWT verification enabled, SHA-256 `ab0ae93cce58778b46ad96656a79007d74d4a04bc51f028137087a86cb757b70`;
- the reusable Campaign `7a3489b6-2d5c-43bd-9a35-0bf0b37403d0`, `NELYON ADS CANARY`, is paused;
- its Finance is funded with budget/funded/spent/released equal to `0.01000000 / 0.01000000 / 0 / 0` BDAG;
- it retains exactly one impression, one click, zero destination opens, and zero billing charges;
- owner balance is `179.86430556` BDAG and shared Ads escrow is `0.01000000` BDAG;
- global financial counts are 926 transactions, 131 Ledger accounts, and 1906 Ledger entries unless exact unrelated legitimate activity is identified;
- launch state is fully DISARMED and every placement is disabled;
- Ads reconciliation and Marketplace Ads reconciliation are entirely zero;
- commerce conversion ingestion remains enabled and PLR-8-C1 reconciliation remains healthy.

Any discrepancy triggers the applicable STOP condition; implementation must not normalize unexplained production state.

## Existing authorities that remain canonical

PLR-9 extends existing architecture and must not duplicate it:

- owner Funding: `public.fund_my_advertising_campaign_budget_v2(...)`;
- internal Spend: `public.spend_advertising_campaign_budget_v2(uuid, uuid, numeric, uuid)`;
- internal Settlement: `public.settle_advertising_campaign_budget_v2(...)`;
- Finance projection: `private.advertising_campaign_finance_result(...)`;
- Ads financial reconciliation: `public.reconcile_advertising_finance()`;
- lifecycle reconciliation: `public.reconcile_advertising_campaign_lifecycle(...)`;
- Ads events: the existing canonical Ads V2 event table and impression/click authorities;
- conversions and attribution: the PLR-8/PLR-8-C1 authorities;
- immutable privileged audit: `private.admin_action_audit`;
- Admin authorization: existing capabilities and `admin_require_capability(...)`;
- Business Ads surfaces: existing `BusinessAdsV2Pages`, `adsManagerApi`, `adsOperationalTruth`, `adsMutationCoordinator`, and existing Ads components;
- Admin Ads surfaces: existing `AdminAdvertisingPages` and `adminAdvertisingApi`.

No new wallet, escrow, Ledger, Finance authority, Spend RPC, Settlement RPC, Ads event system, Admin app, Business app, or parallel audit store is permitted.

## Section 1 — Pricing, classification, reservation, and Spend

### Canonical event path

The only approved financial path is:

```text
canonical impression/click INSERT
→ AFTER INSERT server-side classifier
→ objective, launch mode, authorization window, and rate resolution
→ one immutable-provenance materialization
→ logical budget reservation
→ bounded materializer cron
→ public.spend_advertising_campaign_budget_v2(...)
→ canonical Finance / financial event / transaction / Ledger
→ materialization charged
```

The classifier runs `AFTER INSERT` and only for canonical `impression` and `click` events. It may classify, resolve a rate, insert exactly one materialization, and reserve budget logically. It must never call Spend, write financial transactions, write Ledger entries, update balances, or move money.

### Objective capability registry

`private.advertising_objective_capabilities` is the single server-side objective truth consumed by create, readiness, activation, delivery, billing, Business, and Admin projections.

| Objective | Setup | Delivery runtime | Billing runtime | Conversion runtime | Billable event |
| --- | --- | --- | --- | --- | --- |
| `awareness` | true | true | true | false | `impression` |
| `traffic` | true | true | true | false | `click` |
| `marketplace_sales` | true | true | true | true | `click` |
| `reach` | false | false | false | false | null |
| `engagement` | false | false | false | false | null |
| `video_views` | false | false | false | false | null |
| `profile_visits` | false | false | false | false | null |
| `messages` | false | false | false | false | null |
| `website_conversions` | false | false | false | false | null |
| `app_promotion` | false | false | false | false | null |

Historic Campaigns remain readable. Unsupported objectives cannot be newly configured, submitted, activated, delivered, or billed as supported. No existing objective enum value is removed.

### Billing rate versions

`private.advertising_billing_rate_versions` is the only pricing authority. Each row contains:

- UUID identity and immutable version identity;
- objective, canonical billable event type, and non-null placement code;
- `rate_bdag numeric(20,8)` and currency fixed to `BDAG`;
- scope `global` or `canary_campaign`;
- scope Campaign, null for `global` and required for `canary_campaign`;
- state `draft`, `published`, or `retired`;
- `effective_from` and nullable `effective_to` using half-open `[from,to)` semantics;
- creator/publisher identity and timestamps.

PLR-9 publishes no row. Drafts are editable only through the Admin RPC authority. Once published, objective, event, placement, rate, currency, scope, Campaign, and start time are immutable. Retirement only closes future applicability and preserves the historical interval. A changed price or scope requires a new version.

Published rates must be prospective: `effective_from` cannot precede publication time or `billing_cutover_at`. Rates cannot be backdated to make an existing event billable.

The database prevents overlapping `published` or `retired` effective ranges for the same objective/event/placement/scope/scope-Campaign key. The constraint uses a range exclusion rule with an explicit sentinel for a null global Campaign key; it does not rely on `UNIQUE` null semantics. Publication also serializes through the canonical publication RPC. Thus two rates cannot be simultaneously applicable, including global rows whose Campaign field is null.

In PLR-9, every published rate is placement-specific. The only runtime-ready placement is `social_feed`; nullable or wildcard placement pricing is not introduced.

### Billing authorization windows

`private.advertising_billing_authorization_windows` records prospective authorization independently from rates. A window includes mode, scope, optional exact Campaign, `opened_at`, optional `expires_at`, status `OPEN` or `CLOSED`, and `closed_at`.

- `CANARY_BILLING` has exactly one OPEN, time-bounded `canary_campaign` window for the exact canary Campaign.
- `PRODUCTION` has exactly one OPEN global window.
- all other modes have no OPEN billing window.

Rows are immutable except the O(1) transition from OPEN to CLOSED. Closing sets status and `closed_at`; it never depends on updating the materialization backlog.

Rate publish and retire operations lock the control plane and are rejected while any affected authorization window is OPEN. Operational rate changes therefore require a safe non-billing mode, preserving exact rate provenance for every authorized window.

### Billing cutover and permanent no-back-billing

The launch policy stores an immutable `billing_cutover_at` captured once from the database clock by the PLR-9 migration. It is the definitive no-back-billing boundary and cannot be advanced, cleared, or rewritten by later launch transitions.

- The classifier reacts only to new inserts.
- A newly inserted event whose `occurred_at` precedes cutover is terminally classified `not_billable_before_cutover`.
- The materializer selects only canonical post-cutover materializations; it never scans Ads events to discover pre-cutover work.
- Reconciliation treats every pre-cutover event as structurally non-billable even if no materialization exists.
- Rate publication and authorization windows cannot begin before cutover.

The migration performs no historical Ads-event backfill or unbounded historical scan. Existing PLR-6/7/8 evidence remains unmaterialized and permanently unchargeable. Safety depends on cutover constraints and function authority, not on populating rows for historical events.

### Event billing materializations

`private.advertising_event_billing_materializations` is an Ads billing audit and work projection, not a Ledger. It has one row at most per `billable_event_id` through a unique database constraint and records:

- event, Campaign, viewer, placement, objective, and event type derived server-side;
- authorization-window ID;
- exact billing-rate-version ID and immutable resolved amount where applicable;
- status and reason code;
- canonical financial-event ID after charge;
- created, updated, and finalized timestamps.

Allowed states are:

- `pending`;
- `charged`;
- `not_billable_before_cutover`;
- `not_billable_outside_authorization`;
- `not_billable_objective`;
- `not_billable_no_rate`;
- `budget_exhausted`.

All `not_billable_*`, `budget_exhausted`, and `charged` states are terminal. A later rate, mode, or window change can never revive them. The immutable stored rate-version ID and amount are the durable charge provenance; no redundant pricing authority is added to the Ledger.

### Rate resolution

The classifier derives every input from canonical rows. The client, Edge, Business, and Admin never choose a rate ID or individual charge amount.

- `CANARY_BILLING` resolves only a `canary_campaign` rate for the exact Campaign.
- `PRODUCTION` resolves only a `global` rate.
- global and canary rates never compete for one event.
- every other mode produces `not_billable_outside_authorization` for a newly inserted impression/click.
- an unsupported objective/event pair produces `not_billable_objective`.
- an authorized event with no applicable rate produces terminal `not_billable_no_rate`.
- multiple applicable rates are a hard invariant failure and fail closed.

### Active logical reservations

The single canonical active-reservation function sums only:

```text
materialization.status = pending
AND authorization_window.status = OPEN
AND the authorization window is temporally valid
```

Pending rows belonging to CLOSED or expired windows are immediately nonchargeable and cease reserving budget, even before bounded housekeeping updates their physical status.

Campaign availability for a new reservation is exactly:

```text
funded_bdag
- spent_bdag
- released_bdag
- active_pending_reserved_bdag
```

Charged materializations are not subtracted again because their amounts already appear in `spent_bdag`.

`active_pending_reserved_bdag` must never exceed `funded_bdag - spent_bdag - released_bdag`. A violation is not hidden with `GREATEST(...,0)`: it blocks billing readiness and new financial materialization, increments a reconciliation anomaly, and is exposed as an unsafe Admin state.

### Canary billing caps

The `CANARY_BILLING` window enforces both `max_spend_bdag` and `max_billable_events`. Its Spend cap uses only, for that same authorization window:

```text
active pending reserved amount
+ charged materialization amount
```

The cap does not add Campaign `Finance.spent_bdag`; that would double-count charges from the same window. Campaign Finance availability and canary-window caps are independent controls and both must pass.

### Classifier reservation outcomes

Within the event transaction and shared lock order, the classifier:

1. locks and revalidates the launch control plane and applicable window;
2. derives Campaign objective and canonical billable event;
3. verifies mode, Campaign/viewer/placement/time authorization;
4. resolves exactly one scope-correct rate;
5. locks Campaign Finance;
6. calculates active pending reservation and applicable canary caps;
7. inserts one `pending` materialization if the full amount is available;
8. otherwise inserts terminal `budget_exhausted` with amount zero.

No partial reservation or partial charge exists.

### Spend materializer

`public.reconcile_advertising_billable_events_v2(p_limit integer)` is the single bounded materializer. It is `SECURITY DEFINER`, has a locked search path, is revoked from PUBLIC/anon/authenticated, and is callable only by intended internal roles.

For each pending row it revalidates the same OPEN, temporally valid window, mode, rate provenance, Finance availability, and canary caps under the shared lock order. It calls only:

`public.spend_advertising_campaign_budget_v2(...)`

The existing Spend signature remains canonical. Its supplied amount must equal the materialization's server-resolved immutable amount and rate; arbitrary service-role amounts are rejected. The deterministic idempotency key is derived from the billable event/materialization identity using the repository's canonical UUID strategy.

After the canonical Spend returns, the materializer links the exact financial event and sets the materialization to `charged` in the same transaction. Unexpected exceptions propagate. The transaction rolls back completely: no advanced work state, partial Finance, orphan transaction, orphan Ledger, or swallowed cron failure.

The same bounded function also terminalizes a limited number of pending rows from CLOSED or expired windows as `not_billable_outside_authorization`. It is safe to run while Spend is disabled and never opens or extends authorization.

### Index contract

The schema adds only indexes that support the canonical access paths:

- unique materialization by billable event;
- unique single OPEN authorization window for the singleton control plane;
- pending-work ordering for bounded materialization/housekeeping;
- Campaign/status lookup for active reservations and settlement eligibility;
- objective/event/placement/scope/effective-range lookup for rate resolution;
- the rate exclusion constraint's GiST support.

Disposable representative data must demonstrate the intended plans with `EXPLAIN (ANALYZE, BUFFERS)`. Redundant indexes are omitted, and the post-migration Supabase performance advisor must report no new PLR-9 warning caused by the chosen access paths.

### Canonical Spend and Ledger

Every actual charge continues to flow exclusively through `public.spend_advertising_campaign_budget_v2(...)`. That function:

- participates in shared control-plane synchronization;
- requires a valid pending materialization and OPEN authorization window;
- checks the exact server-resolved rate and event;
- preserves its Finance row lock, idempotency, no-overspend, financial event, transaction, and balanced shared Ads escrow-to-Ads revenue Ledger path;
- records zero fee unless the existing canonical contract says otherwise;
- never accepts monetary authority from a browser, native client, or Edge request.

One event can have at most one materialization, one Spend financial event, one financial transaction, and one pair of balanced Ledger entries.

### Budget exhaustion

If remaining Campaign availability is less than the full authoritative rate, the event is classified `budget_exhausted`, amount zero, and is never partially charged. Canonical readiness and delivery return `campaign_budget_insufficient_for_next_billable_event`; the client performs no arithmetic.

Under automatic `PRODUCTION`, an active Campaign whose remaining available budget cannot fund its next canonical billing unit becomes eligible for completion. No negative balance and no recurring unbilled delivery are allowed.

## Section 2 — Launch modes, lifecycle, settlement, and synchronization

### Sole launch authority

`launch_mode` on the existing singleton launch/canary policy is the only operational mode authority. Allowed values are:

- `DISARMED`;
- `CANARY_DELIVERY`;
- `CANARY_BILLING`;
- `SETTLEMENT_ONLY`;
- `PRODUCTION`.

The existing `canary_enabled` column remains physical for compatibility because the source audit found historical migrations and existing integration tests that write it directly. Converting it to a generated column would create unnecessary destructive compatibility work. Instead, a strong table constraint makes contradiction impossible:

```text
launch_mode IN (CANARY_DELIVERY, CANARY_BILLING) ⇔ canary_enabled = TRUE
launch_mode IN (DISARMED, SETTLEMENT_ONLY, PRODUCTION) ⇔ canary_enabled = FALSE
```

Operational transitions occur only through the canonical internal launch-mode RPC, which writes both fields atomically. Direct operational writes are revoked. Tests that construct policy state must use the transition authority or update both fields consistently when explicitly testing constraints.

Canary Business, Ad Account, Campaign, viewer, placement, enabled/expires timestamps, `max_budget_bdag`, and `max_impressions` are required only in the two canary modes and null in every other mode. `max_spend_bdag` and `max_billable_events` are required only in `CANARY_BILLING` and null otherwise. `max_spend_bdag <= max_budget_bdag` and `max_billable_events >= 1` are database constraints.

### Legal mode matrix

| Property | DISARMED | CANARY_DELIVERY | CANARY_BILLING | SETTLEMENT_ONLY | PRODUCTION |
| --- | --- | --- | --- | --- | --- |
| `canary_enabled` | false | true | true | false | false |
| Funding | false | true | false | false | true |
| Spend | false | false | true | false | true |
| Settlement | false | false | false | true | true |
| Activation/Resume | false | true | true | false | true |
| Automatic lifecycle | false | false | false | false | true |
| Global V2 delivery | false | true | true | false | true |
| Placements | all false | exact canary placement only | exact canary placement only | all false | runtime-ready enabled placements only |
| Canary targets | all null | all required | all required | all null | all null |
| Delivery caps | null | budget and impression caps required | budget and impression caps required | null | null |
| Billing caps | null | null | max Spend and billable-event caps required | null | null |
| Billing window | none | none | one exact OPEN canary window | none | one OPEN global window |
| Rate scope | none | none | exact `canary_campaign` only | none | `global` only |
| Billing cron | no charges; bounded stale cleanup | no charges; bounded stale cleanup | bounded exact-window Spend | no charges; bounded stale cleanup | bounded global Spend |
| Lifecycle cron | no-op | no-op | no-op | no-op | automatic rules only |
| Settlement cron | no-op | no-op | no-op | eligible terminal funded Campaigns | eligible terminal funded Campaigns |

Only `social_feed` is runtime-ready in PLR-9. Clips, Stories, LIVE, Marketplace Home, Marketplace Search, and every other V2 placement remain disabled.

### Launch transition authority

An internal management RPC `public.set_advertising_launch_mode_v2(...)` is the sole transition path. It is not exposed through Business or the Admin Rates UI. It is `SECURITY DEFINER`, locked-search-path, denied to PUBLIC/anon/authenticated, and available only to the existing intended management authority.

The RPC locks the singleton launch policy first, validates the complete target matrix, closes any outgoing billing authorization window in O(1), creates the required incoming window when applicable, updates all policy switches and placements, clears or requires target/cap fields, forces deferred launch-envelope constraints, and commits one legal mode.

It never publishes a rate, funds a Campaign, activates a Campaign, spends, settles, or changes Campaign data.

### Production rate coverage

Entry into `PRODUCTION` requires exactly one applicable, non-overlapping, prospective, open-ended global rate for every combination of:

```text
objective where delivery_runtime_ready AND billing_runtime_ready
× enabled billable placement
× the objective's canonical billable event
```

Initial required coverage is:

- awareness / impression / social_feed;
- traffic / click / social_feed;
- marketplace_sales / click / social_feed.

If any capability is marked billing-ready without complete coverage, transition is rejected. The alternative is to mark that capability billing-not-ready before production entry. A production-ready Campaign must never deliver first and discover afterward that no rate exists.

Entry into `CANARY_BILLING` requires exactly one canary-scoped rate for the exact Campaign/objective/event/placement and full coverage of the requested bounded window.

### O(1) billing shutdown

Leaving a billing mode closes the current authorization window by updating its single control row. Spend and the materializer revalidate that the linked window remains OPEN and temporally valid. Therefore every pending row becomes immediately nonchargeable and non-reserving without a backlog-sized update.

Bounded housekeeping later terminalizes those rows. `PRODUCTION → DISARMED` and `CANARY_BILLING → DISARMED` are O(1) with respect to billing backlog, aside from minimal control-plane locks.

### Shared lock order and stale-mode prevention

Every operation gated by mutable launch policy synchronizes on the same singleton launch-policy row. This includes:

- `set_advertising_launch_mode_v2` and window close;
- the AFTER INSERT classifier;
- billing materializer and Spend validation;
- `fund_my_advertising_campaign_budget_v2`;
- `activate_my_advertising_campaign_v2`;
- `resume_my_advertising_campaign_v2`;
- `spend_advertising_campaign_budget_v2`;
- `settle_advertising_campaign_budget_v2`;
- every reconciler that invokes those authorities.

The common lock order is:

```text
launch-policy singleton
→ authorization window, when applicable
→ Campaign Finance
→ materialization
→ Ads financial event or settlement record
→ Ledger accounts in deterministic UUID order
→ financial transaction and Ledger entries
```

Existing functions are adjusted to follow this order without replacing their accounting logic. A gated operation either completes fully before a transition obtains the control-plane lock, or the transition wins and the later operation revalidates the new mode and rejects/no-ops. No operation authorized by an old mode can commit after a new mode is effective.

### Required concurrency races

Real tests use separate PostgreSQL sessions and prove only the two legal serial outcomes for:

- DISARM versus Funding;
- DISARM versus Activate;
- DISARM versus Resume;
- `SETTLEMENT_ONLY → DISARMED` versus Settlement;
- `CANARY_BILLING → DISARMED` versus Spend/materializer;
- `PRODUCTION → DISARMED` versus billable-event classification;
- materializer versus authorization-window close;
- parallel materializers and the same event;
- publish/retire versus mode entry and coverage checks.

No test may permit partial Spend, charged without Ledger, Ledger without charged, stale-mode commit, pending charge after close, or deadlock.

### Lifecycle behavior

`public.reconcile_advertising_campaign_lifecycle(...)` remains canonical and is gated by the shared control-plane lock.

- Only `PRODUCTION` with automatic transitions enabled may mutate lifecycle.
- scheduled Campaigns become active when their window begins and canonical readiness passes.
- scheduled Campaigns that reach the end of their window without activation become completed with `campaign_schedule_expired`.
- active Campaigns become completed on schedule exhaustion or budget exhaustion.
- paused Campaigns never auto-resume and never auto-complete; they remain owner-controlled.
- DISARMED, both canary modes, and SETTLEMENT_ONLY perform no automatic lifecycle mutation.

The reusable NELYON ADS CANARY therefore remains paused throughout PLR-9.

### Settlement behavior

`public.reconcile_advertising_campaign_settlements_v2(p_limit integer)` is a bounded internal reconciler. It operates only in `SETTLEMENT_ONLY` or `PRODUCTION`, selects only completed/cancelled Campaigns with funded Finance and no prior settlement, and calls only `public.settle_advertising_campaign_budget_v2(...)` using deterministic idempotency.

DISARMED, CANARY_DELIVERY, and CANARY_BILLING are no-ops. Settlement does not require Delivery or a billing window. Final canary retirement or emergency refunds can therefore use SETTLEMENT_ONLY without opening production.

When an operational settlement run is complete, an authorized operator may return SETTLEMENT_ONLY to DISARMED through the same single transactional launch-mode RPC. The settlement reconciler does not silently change launch mode.

The existing Settlement RPC already supports zero residual: it writes no release transaction or Ledger entries, marks Finance settled, and creates the settlement record. PLR-9 does not alter that behavior unless a real test proves an existing defect. No second settlement mechanism is created.

### Cron jobs

PLR-9 installs exactly one active job for each authority:

| Job | Schedule | Command behavior |
| --- | --- | --- |
| `reconcile-advertising-billable-events-v2` | every minute | bounded batch 100; Spend only in a valid billing mode/window; stale cleanup otherwise |
| `reconcile-advertising-campaign-lifecycle-v2` | every minute | bounded lifecycle reconciliation; mutations only in automatic PRODUCTION |
| `reconcile-advertising-campaign-settlements-v2` | every minute | bounded settlement only in SETTLEMENT_ONLY or PRODUCTION |

The existing PLR-8 purchase-conversion reconciliation job remains independent and unchanged. Jobs are idempotent, non-overlapping by canonical serialization, and fail visibly in `cron.job_run_details`; unexpected errors are never swallowed.

## Section 3 — Admin, Business, analytics, and observability

### Capabilities

PLR-9 adds:

- `advertising.billing.read` to SUPER_ADMIN, PLATFORM_ADMIN, and FINANCE_AUDITOR;
- `advertising.rates.manage` to SUPER_ADMIN only.

Capabilities are enforced inside every RPC/projection, not inferred solely from current role mapping.

| Persona | Operational billing health | Financial reconciliation detail | Full rate-lifecycle finance audit | Rate management |
| --- | --- | --- | --- | --- |
| PLATFORM_ADMIN | yes | no | no | no |
| FINANCE_AUDITOR | yes | yes | yes | no |
| SUPER_ADMIN | yes | yes | yes | yes |

### Operational versus financial observability

The operational billing-health RPC requires `advertising.billing.read` and may expose:

- launch mode and legal configuration status;
- rate versions, active/next rates, and coverage readiness;
- materialization counts by state;
- pending count and oldest active pending timestamp;
- budget-exhausted count;
- aggregate charged-event count;
- active authorization-window status;
- billing/lifecycle/settlement cron status;
- safe anomaly flags that do not expose Ledger detail.

Financial reconciliation detail additionally requires `finance.reconciliation.read` and includes escrow/revenue reconciliation, Ledger mismatch counters, orphan financial transactions, Ads financial-event mismatches, escrow-liability differences, and financial anomaly details. `advertising.billing.read` must not indirectly grant Finance audit access.

### Rate management RPCs and audit

Existing Admin authorization is reused. Server RPCs provide create draft, update draft, publish, and retire. Direct browser writes to rate tables are forbidden.

Each mutating RPC:

- calls `admin_require_capability('advertising.rates.manage')`;
- accepts `p_idempotency_key uuid`;
- uses the canonical stable idempotency scope, request fingerprint, advisory/row serialization, safe replay, and conflict behavior;
- writes exactly one immutable row to `private.admin_action_audit` for a new command;
- returns a server-created receipt;
- records actor ID, `human_admin`, role snapshot, capability, target type/ID, outcome, `contains_pii = false`, and allow-listed safe metadata.

Actions are exactly:

- `advertising.rate.draft.create`;
- `advertising.rate.draft.update`;
- `advertising.rate.publish`;
- `advertising.rate.retire`.

Publish and retire require a trimmed reason between 2 and 500 characters and set `financial_effect = true`. Draft create/update set `financial_effect = false`. Idempotent replay returns the prior receipt without a second audit row; a different request fingerprint with the same scope/key is rejected.

No `advertising_rate_audit`, billing Admin log, or parallel audit/search authority is created.

### Advertising audit visibility

`private.admin_audit_row_visible(domain, financial_effect)` is extended canonically for `domain = 'advertising'`:

- every advertising row requires `advertising.billing.read`;
- a row with `financial_effect = true` additionally requires `finance.audit.read`.

The existing `public.search_admin_finance_audit(...)` is extended to include the four canonical Ads rate-lifecycle actions even when draft actions have `financial_effect = false`. The endpoint still requires `finance.audit.read` and applies `private.admin_audit_row_visible(...)` to every returned row. This lets FINANCE_AUDITOR reconstruct create → update → publish → retire without receiving `admin.audit.read` or access to unrelated global Admin audit.

PLATFORM_ADMIN cannot call the Finance audit endpoint because it lacks `finance.audit.read`. SUPER_ADMIN can. No `search_admin_advertising_rate_audit` function is created.

### Admin Ads UI

The existing Admin Ads module gains:

- rate list and version detail;
- create/edit draft;
- publish with confirmation and reason;
- retire with confirmation and reason;
- immutable display for published/retired versions;
- operational billing health, rate coverage/readiness, backlog, active pending, budget exhaustion, charged counts, active windows, and cron health;
- Finance reconciliation detail only behind the additional Finance capability.

The Admin Rates UI has no launch-mode control and cannot publish a rate as part of a mode transition. Smoke tests create no rate and publish no rate.

### Business objective and billing truth

Business consumes server-backed objective capabilities. Supported objectives render normally; unsupported objectives are visibly unavailable under the existing design convention and cannot be configured as production-ready. Historical Campaigns remain readable.

`public.get_my_advertising_campaign_billing_v2(...)` returns canonical values and status, including:

- budget, funded, spent, released, and remaining BDAG;
- `active_pending_reserved_bdag` from the same shared database authority used by classification;
- available-to-reserve BDAG without clamping inconsistencies;
- billing basis (`per impression` or `per click`);
- applicable current rate status, scope, version, amount, and interval when owner-visible;
- objective capability state, billing readiness, delivery readiness, and canonical blocker codes.

Business labels active pending as “Pending billing reservation.” CLOSED/expired backlog is not represented as active reserved money. If rates are unavailable, Business says rate/billing is not available rather than showing fake zero pricing.

Business and Admin have no launch-mode controls. Neither browser computes a charge or sends an event charge amount.

### Server-side analytics

The campaign analytics projection computes:

```text
CTR = clicks / impressions
CPC = spent / clicks
CPM = spent / impressions * 1000
conversion_rate = attributed_conversions / clicks
ROAS = attributed_purchase_value / spent
```

Zero denominator returns null; Business renders “—”. The server returns a metric status as well as a value.

- awareness and traffic have `conversion_runtime_ready = false`; conversion rate and ROAS return null with `not_applicable`, never economic zero.
- marketplace_sales has conversion runtime ready; missing denominators return null with `no_data`/`unavailable_denominator`.
- CPC and CPM may remain descriptive cost metrics whenever authoritative Spend and a valid denominator exist, irrespective of the objective's billing unit.
- attributed purchase value remains labeled attributed purchase value/GMV, never profit, seller revenue, or net income.

The browser only formats canonical numbers and statuses. PLR-7B responsiveness and PLR-8 commerce UX remain unchanged, including 390 px, 430 px, and desktop behavior.

### Readiness versus reconciliation

Configuration readiness and invariant reconciliation are different outputs:

- `production_rate_coverage_ready = false` is legal while DISARMED with zero rates.
- `production_rate_coverage_gap` is nonzero only if the current launch mode is PRODUCTION and required coverage is missing.
- `canary_rate_scope_mismatch` is nonzero only when the current mode is CANARY_BILLING and the authorized exact canary rate contract is violated.

DISARMED, CANARY_DELIVERY, CANARY_BILLING, and SETTLEMENT_ONLY do not report a PRODUCTION invariant failure merely because global rates are absent. A legal DISARMED system with zero rates must reconcile cleanly while accurately reporting production readiness as incomplete.

## Section 4 — Migration, tests, deployment, rollback, and acceptance

### One forward-only migration

PLR-9 uses one normal timestamped forward-only migration, bringing production migration count from 297 to 298. The migration runs transactionally and contains:

1. objective capability registry and approved seed matrix;
2. launch-mode extension, compatibility-safe `canary_enabled` invariant, target/cap constraints, and billing cutover;
3. authorization windows and O(1) close authority;
4. rate versions, immutable lifecycle, range-overlap prevention, and Admin rate RPCs;
5. materialization schema, classifier, reservation helpers, rate resolver, materializer, and Spend hardening;
6. synchronized Funding/Activation/Resume/Spend/Settlement authorities and launch transition RPC;
7. lifecycle and settlement reconcilers;
8. Business billing/objective/analytics projections;
9. Admin operational/financial projections, capabilities, audit visibility, and Finance-audit extension;
10. mode-aware reconciliation extensions;
11. exactly three PLR-9 cron jobs and required grants/revokes/comments.

The migration does not rewrite prior migrations, backfill historical Ads events, seed a real rate, open a billing window, or move money.

### ACL and security contract

Every new privileged function is `SECURITY DEFINER` with an explicit locked search path and exact grants. Rate, materialization, window, and capability tables live in `private`, have RLS/ACL defense in depth, and have no anon/authenticated/browser write access.

Admin mutation authorization uses capabilities, never browser role strings or user metadata. Service-role access is not exposed to client bundles. Rate creation defines policy; no Admin request can select the charge for an individual Ads event.

### Reconciliation additions

`public.reconcile_advertising_finance()` preserves existing keys and adds zero-count checks for:

- materialization without its expected financial event;
- charged amount unequal to immutable rate amount;
- post-cutover Spend financial event without materialization;
- wrong or missing rate version;
- duplicate materialization or duplicate charged event;
- billable-event/Campaign mismatch;
- charge before cutover;
- charge outside rate effective interval;
- charge outside an authorized OPEN billing window/mode;
- active pending reserved greater than remaining Finance;
- budget equation and escrow/revenue equation violations;
- `production_rate_coverage_gap`, evaluated only in PRODUCTION;
- `canary_rate_scope_mismatch`, evaluated only in CANARY_BILLING.

Readiness projections separately report absent rates or incomplete future coverage in safe non-operational modes.

### Database test matrix

Disposable PostgreSQL integration tests prove:

#### Objective capabilities

- the exact approved matrix;
- historic unsupported objectives remain readable;
- unsupported objectives cannot be newly configured, activated, delivered, or billed;
- create/readiness/activation/delivery/billing share one registry.

#### Rates

- draft create/update, publish, retire, and immutable publication;
- global and exact canary scopes;
- objective/event validation, BDAG only, positive amount, and eight-decimal precision;
- prospective publication and no backdating;
- database-enforced non-overlap including null global Campaign keys;
- wrong canary Campaign rejection;
- no affected publish/retire while an authorization window is OPEN;
- full production coverage and exact canary coverage gates.

#### Admin audit and authorization

- every create/update/publish/retire produces exactly one `private.admin_action_audit` row;
- replay returns one receipt and one audit row; idempotency conflict is rejected;
- publish/retire reasons and financial-effect flags;
- Finance audit exposes all four lifecycle actions to FINANCE_AUDITOR without `admin.audit.read`;
- PLATFORM_ADMIN reads operational health but not Finance detail/audit or rate mutation;
- FINANCE_AUDITOR reads operational plus Finance detail/audit but cannot mutate rates;
- SUPER_ADMIN reads both and manages rates;
- unauthorized authenticated users are rejected.

#### Classification and materialization

- AFTER INSERT classification runs only for impression/click;
- awareness impression, traffic click, and marketplace_sales click classify correctly;
- wrong event/objective, no rate, pre-cutover, and outside authorization are terminal and never revived;
- exactly one materialization per event;
- global/canary scope resolution cannot compete;
- no historical event scan/backfill;
- deterministic retry and parallel classification/materialization yield one result;
- unexpected materializer failure propagates and rolls back.

#### Active pending and shutdown

- pending in an OPEN valid window reserves once;
- charged is represented in spent and not reserved again;
- CLOSED/expired pending remains physically pending before housekeeping but immediately reserves zero and cannot charge;
- available-to-reserve is released immediately after O(1) close;
- housekeeping later terminalizes it;
- active pending exceeding remaining Finance blocks readiness/materialization and produces an anomaly, without clamping.

#### Spend and Ledger

- exact authoritative rate amount only;
- no client/Edge/browser-selected amount;
- one transaction, two equal Ledger entries, zero fee, escrow debit, revenue credit;
- exact Finance spent increment and rate provenance;
- retries and parallel runs create one charge;
- every reconciliation check remains zero.

#### Budget exhaustion

- remaining greater than rate charges;
- remaining equal to rate charges and reaches zero;
- remaining below rate creates terminal `budget_exhausted`, amount zero, no partial charge, no negative balance;
- delivery blocker appears;
- automatic PRODUCTION completion works.

#### Launch modes and canary billing

- every legal matrix row passes deferred envelope checks;
- every illegal hybrid fails;
- CANARY_DELIVERY cannot Spend;
- exact CANARY_BILLING Campaign/viewer/placement/time/rate can Spend;
- wrong Campaign/viewer/placement, expired window, second event above max count, or amount above max Spend is blocked;
- canary cap uses only same-window active pending plus charged and does not double-count Finance spent;
- SETTLEMENT_ONLY exposes no Delivery/Funding/Activation/Spend.

#### Lifecycle and Settlement

- DISARMED/canary/SETTLEMENT_ONLY lifecycle no-op;
- PRODUCTION scheduled→active, scheduled-expired→completed with canonical reason, active budget/schedule exhaustion→completed;
- paused never auto-resumes/completes;
- cancelled/completed funded Campaign settles only in SETTLEMENT_ONLY/PRODUCTION;
- zero-residual settlement uses existing semantics;
- retry is idempotent and original funding source is preserved;
- settlement-disabled modes no-op.

#### Real concurrent races

Separate PostgreSQL sessions prove every race listed in the synchronization section. Harnesses must coordinate lock acquisition explicitly rather than simulating concurrency sequentially.

#### Cron

- one active job per canonical PLR-9 reconciler, correct schedule and batch;
- DISARMED no-charge/no-mutation behavior;
- mode-correct work;
- fail-visible `cron.job_run_details` behavior;
- corrected retry succeeds without duplication.

### Web tests and regression matrix

Business tests cover server-backed objective availability, rate unavailable/published states, budget/funded/spent/released/remaining/active pending, canonical blockers, billing basis, capability-aware analytics, null metric rendering, and preserved responsive layouts at 390 px, 430 px, and desktop.

Admin tests cover capability routing, rate CRUD lifecycle, immutable publication, reason/idempotency/audit receipts, operational-versus-Finance visibility, billing/cron health, backlog states, and unauthorized denial.

Regression runs include PLR-8-C1, PLR-8 commerce, PLR-7A click, PLR-7B Business, PLR-6B canary safety, Ads Finance/Lifecycle/Delivery, Marketplace conversion/reconciliation/checkout/refund, Ledger, Admin Ads, and Business Ads. Focused ESLint, modified-file TypeScript, Business production build, Admin production build, and `git diff --check` must pass with zero new diagnostics.

Supabase security and performance advisors run before and after. New PLR-9 Critical/Warning findings are fixed; historical unrelated findings are classified without being attributed to PLR-9.

### Duplicate and orphan audit

Before commit and again before deployment, source/schema searches must prove there is still exactly one canonical wallet, shared Ads escrow, Ads revenue account, Campaign Finance authority, Spend RPC, Settlement RPC, pricing authority, event materializer, lifecycle reconciler, settlement reconciler, Admin Ads module, and Business Ads module. Cron inventory must prove one active job per PLR-9 function. No orphan service, obsolete alternate caller, test-only production authority, or direct browser table mutation may remain.

### Implementation file boundary

Expected implementation areas are:

- one new file under `supabase/migrations/`;
- existing disposable Ads/PostgreSQL test harnesses;
- `apps/business-web/src/lib/adsManagerApi.ts`, `adsOperationalTruth.ts`, existing Ads pages/components, and their tests;
- `apps/admin-web/src/lib/adminAdvertisingApi.ts`, `adminObservabilityApi.ts` as required, existing Admin Ads/Finance pages/navigation, and their tests;
- package scripts only if a verified test/build need exists.

Forbidden implementation areas include `app/`, native delivery/runtime services, `ios/`, `android/`, native `app.json` configuration, and `supabase/functions/ads-v2-delivery`.

If any native-area change is required, implementation stops before editing or building and reports exactly:

`NATIVE CHANGE REQUIRED`

No EAS action follows without new owner/ChatGPT authorization. Every future authorized native artifact must be reported as `NUEVA BUILD — INSTALAR` with Build ID, Git SHA, version, build number, profile, and distribution.

### Commit and push boundary

Implementation may use one or two cohesive commits, with the preferred functional commit `feat(ads): complete production billing and spend control`. No amend, rebase, squash, force push, unrelated file, native file, generated build output, or test-only production authority is allowed. Local and remote branch SHAs must match before deployment.

### Deployment sequence

Deployment occurs only after all tests/builds, clean Git verification, production precheck, and exact remote SHA proof:

1. Revalidate the reusable canary, Finance, DISARMED policy, commerce state, and reconciliations.
2. Deploy only the single PLR-9 database migration.
3. Verify migration parity, ACLs, constraints, jobs, mode, zero rates/windows/reservations, no Spend, and zero reconciliation.
4. Build and upload a Business preview with `npm run business:web:upload:preview`.
5. Smoke the preview and promote that exact tested Version with `npm run business:web:promote:version -- <VERSION_ID>`.
6. Build and upload an Admin preview with `npm run admin:web:upload:preview`.
7. Smoke the preview and promote that exact tested Version with `npm --prefix apps/admin-web run promote:version -- <VERSION_ID>`.
8. Run the complete global postcheck.

There is no root `admin:web:promote:version` script, and PLR-9 must not invent one. `apps/admin-web` also has `apply:production-route`, but the normal promotion reuses the tested Version and does not change routes unless precheck proves a route defect and separate authority covers it. Direct `wrangler deploy` must not replace Version promotion.

No Edge, Public Web, native, EAS, rate, launch-mode, Campaign, Funding, Spend, or Settlement deployment/action is part of this sequence.

### Fail-closed and rollback strategy

- The database migration is forward-only and transactional; migration failure rolls back the complete schema change.
- The committed initial mode is DISARMED with zero rates and zero OPEN windows.
- A failed web preview is never promoted.
- A bad promoted web version is rolled back by promoting the exact previous Version.
- No destructive down migration is authored.
- A post-deploy database defect is corrected only by a forward corrective migration after the system is verified DISARMED.
- No manual Ledger/Finance compensation, evidence deletion, rate publication, billing-window opening, or production-mode transition is used as a repair.
- Unexpected production-state divergence stops later deployment steps; it is not normalized silently.

### Production acceptance

The final accepted state is exact:

- migration count 298 and local/remote parity;
- launch mode DISARMED;
- canary, Funding, Spend, Settlement, Activation, Automatic transitions, Global Delivery, and every placement false;
- zero published real rates;
- zero OPEN billing authorization windows;
- zero active pending reservations;
- no historical materialization or charge requirement for pre-cutover events;
- `production_rate_coverage_ready = false` is an accurate configuration state;
- `production_rate_coverage_gap = 0` and `canary_rate_scope_mismatch = 0` because DISARMED is legal;
- all existing and new Ads reconciliation counters zero;
- Marketplace Ads reconciliation 23/23 zero;
- NELYON ADS CANARY remains paused and Finance remains funded `0.01000000`, spent 0, released 0;
- its historical one impression, one click, zero destination opens, and zero billing charges remain unchanged;
- owner balance `179.86430556`, Ads escrow `0.01000000`, and no PLR-9 money movement;
- expected global counts remain 926 transactions, 131 accounts, and 1906 entries unless unrelated legitimate activity is proven;
- `ads-v2-delivery` remains version 3 with the same hash;
- native files changed: NO;
- new EAS build: NO.

### STOP conditions

Stop before destructive or deployment work if:

- source SHA or worktree cleanliness differs;
- reusable canary, Finance, balances, counts, conversion state, or reconciliations differ unexpectedly;
- implementation would require a parallel Ledger, escrow, Finance, Spend, Settlement, audit, Ads event, or web authority;
- charge amount cannot be entirely server-derived;
- published rates can overlap or back-billing cannot be structurally prevented;
- mode transitions cannot serialize every gated mutating RPC;
- O(1) billing shutdown cannot prevent later Spend;
- production mode weakens canary safety or lacks complete rate coverage;
- Settlement can return funds anywhere except the original source;
- Admin authorization cannot reuse canonical capabilities/audit;
- real concurrency tests cannot establish only legal outcomes;
- a new PLR-9 security/performance warning remains unresolved;
- any native/runtime/configuration change becomes necessary.

### Remaining-scope audit after implementation

The implementation report must inspect final source and production rather than repeat this design mechanically. It must classify each area as DONE, NOT YET IMPLEMENTED, or INTENTIONALLY OUT OF CURRENT PRODUCT SCOPE, including:

- Social Feed delivery and monetization;
- Clips, Stories, and LIVE placements;
- Marketplace Home/Search legacy relationship;
- all objective runtimes;
- custom age-range targeting;
- Stripe/BDAG funding relationship;
- production rollout controls;
- rate economics and publication;
- billing canary and physical testing;
- final cross-platform physical validation.

That audit determines the next macro. PLR-9-CANARY, rate economics, and physical tests must not begin during PLR-9 implementation.

## Final invariant

PLR-9 ends with the complete monetization/control-plane architecture deployed but inert: DISARMED, no real rate, no OPEN billing window, no Spend, no Settlement, no money movement, no native change, and no EAS build. Future billing becomes possible only through an explicit, fully covered, synchronized launch-mode transition approved in a later phase.
