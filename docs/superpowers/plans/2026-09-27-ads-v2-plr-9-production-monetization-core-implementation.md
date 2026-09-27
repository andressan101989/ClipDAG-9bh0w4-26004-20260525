# ADS-V2-PLR-9 Production Monetization Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task as the authorized one-shot macro. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved PLR-9 production monetization and control-plane architecture as one macro while leaving production DISARMED, publishing no real rate, opening no billing window, moving no money, and changing no native or Edge code.

**Architecture:** Extend the existing Ads V2 database authorities rather than creating parallel finance or event paths. A single transactional migration introduces objective capabilities, versioned rates, authorization windows, event materializations, launch modes, synchronized gated mutations, bounded reconcilers, exact reconciliation, and Admin/Business projections. Existing Business and Admin Ads modules consume those projections. Database deployment precedes exact-version Business and Admin preview promotion; no Edge, native, Public Web, or EAS action is allowed.

**Tech Stack:** PostgreSQL/Supabase migrations, PL/pgSQL, `pg_cron`, Node.js `node:test`, disposable Docker PostgreSQL, separate PostgreSQL sessions (`psql`) for concurrency, React/TypeScript/Vite, existing Business/Admin API and UI systems, Cloudflare Workers Versions promotion, ESLint, Supabase security/performance advisors.

**Spec:** `docs/superpowers/specs/2026-09-27-ads-v2-plr-9-production-monetization-core-design.md`

## Global Constraints

- Begin implementation only after the owner/ChatGPT authorizes the one-shot PLR-9 macro.
- Start from branch `codex/ads-v2-plr-9-production-monetization-core` at exact approved planning SHA `40ae659471ae7b19c053a92730cdd0b601709069` and keep the approved spec unchanged.
- Use one generated forward-only migration. Create it with `npx supabase migration new ads_v2_plr_9_production_monetization_core`; never invent its timestamp and never edit a historical migration.
- Preserve the single existing wallet, shared Ads escrow, Ads revenue account, Campaign Finance row, Funding authority, Spend authority, Settlement authority, financial-event path, Ledger, Ads event table, and Admin audit table.
- Do not create a second pricing authority, materializer, launch authority, Finance authority, Spend/Settlement RPC, lifecycle authority, Admin Ads module, Business Ads module, cron job, audit table, or browser-side monetary authority.
- Use TDD for every behavioral slice: add or tighten the failing assertion, run it and observe the expected failure, make the minimum production change, then rerun the focused test before moving on.
- Run database integration tests only in disposable PostgreSQL. Run race tests in genuinely separate database sessions with explicit lock coordination.
- The classifier is `AFTER INSERT`, handles only canonical `impression` and `click`, and may only classify, resolve, materialize, and reserve logically. It must never call Spend, write Ledger/transactions, or move money.
- Every real charge remains exclusively inside `public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid)`, invoked server-side by the bounded materializer with an amount resolved by the database.
- No production rate is inserted or published. No billing authorization window is opened. No Campaign is funded, activated, resumed, cancelled, or settled. No launch mode other than the final `DISARMED` state is entered in production.
- No source under `app/`, native runtime services, `ios/`, `android/`, native `app.json` configuration, or `supabase/functions/ads-v2-delivery` may change. If any such change becomes necessary, STOP with `NATIVE CHANGE REQUIRED`; do not build EAS.
- No Edge, Public Web, Admin route-rebinding, OTA, TestFlight, Store, Android, or EAS deployment is allowed.
- Use at most two cohesive implementation commits. Do not amend, rebase, squash, force-push, or include unrelated changes.
- A failed migration rolls back transactionally. A failed preview is not promoted. A promoted Web regression is rolled back by promoting the previously recorded Version. Database defects require a new forward corrective migration, never a destructive down migration or manual Finance/Ledger compensation.

## Fixed Implementation Boundary

### Existing authorities to reuse

- `public.fund_my_advertising_campaign_budget_v2(uuid,uuid)` — preserve owner Funding accounting and idempotency; synchronize its launch-mode gate.
- `public.create_my_advertising_campaign_draft(uuid,text,text,uuid)` — preserve Campaign creation/idempotency while replacing its hard-coded objective allowlist with the canonical capability registry.
- `public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid)` — preserve the signature and canonical escrow → Ads revenue accounting; harden it to accept only a pending canonical materialization and its immutable server-resolved amount.
- `public.settle_advertising_campaign_budget_v2(uuid,uuid)` — preserve canonical release/zero-residual semantics and synchronize its launch-mode gate.
- `private.advertising_campaign_finance_result(...)` and `public.get_my_advertising_campaign_finance(uuid)` — preserve current Finance truth.
- `private.advertising_campaign_operational_readiness_at(uuid,timestamptz)`, `public.get_my_advertising_campaign_activation_readiness(uuid)`, and `private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)` — extend them with capability/rate/budget blockers; do not duplicate readiness.
- `public.activate_my_advertising_campaign_v2(uuid,uuid)` and `public.resume_my_advertising_campaign_v2(uuid,uuid)` — preserve lifecycle semantics and synchronize their mode gate.
- `public.reconcile_advertising_campaign_lifecycle(integer,timestamptz)` — keep the canonical lifecycle reconciler and make it mode-aware.
- `private.advertising_assert_canary_launch_envelope()` and its five existing DEFERRABLE INITIALLY DEFERRED constraint triggers — replace the function body and keep the single trigger set.
- `public.get_my_advertising_event_summary(uuid)` — extend the existing summary; do not add a second analytics aggregate.
- `public.reconcile_advertising_finance()` — append PLR-9 checks without removing or renaming historical keys.
- `private.admin_action_audit`, `private.admin_request_fingerprint(...)`, `private.admin_audit_row_visible(text,boolean)`, `public.search_admin_finance_audit(...)`, and `admin_require_capability(...)` — reuse the canonical Admin capability/audit/idempotency patterns.
- Existing Business surfaces: `BusinessAdsV2Pages`, `adsManagerApi`, `adsOperationalTruth`, `adsMutationCoordinator`, and `OperationalTruthPanels`.
- Existing Admin surfaces: `AdminAdvertisingPages`, `adminAdvertisingApi`, `adminObservabilityApi`, `CapabilityRoute`, `AdminShell`, and the existing Admin navigation.

### New database authorities and fixed names

- Private tables:
  - `private.advertising_objective_capabilities`
  - `private.advertising_billing_rate_versions`
  - `private.advertising_billing_authorization_windows`
  - `private.advertising_event_billing_materializations`
- Private helpers/triggers:
  - `private.advertising_active_pending_reserved_bdag(uuid,timestamptz)`
  - `private.advertising_campaign_billing_state_at(uuid,timestamptz)`
  - `private.resolve_advertising_billing_rate_v2(uuid,text,text,timestamptz,text)`
  - `private.advertising_canary_spend_allowed(uuid,timestamptz)`
  - `private.advertising_rate_coverage_at(text,uuid,text,timestamptz,timestamptz)`
  - `private.classify_advertising_billable_event_v2()` as the one `AFTER INSERT` trigger function on the canonical Ads event table
- Internal public RPCs:
  - `public.set_advertising_launch_mode_v2(p_launch_mode text, p_idempotency_key uuid, p_business_account_id uuid default null, p_ad_account_id uuid default null, p_campaign_id uuid default null, p_viewer_user_id uuid default null, p_placement_code text default null, p_expires_at timestamptz default null, p_max_budget_bdag numeric default null, p_max_impressions integer default null, p_max_spend_bdag numeric default null, p_max_billable_events integer default null)`
  - `public.reconcile_advertising_billable_events_v2(integer)`
  - `public.reconcile_advertising_campaign_settlements_v2(integer)`
- Business projections:
  - `public.get_my_advertising_objective_capabilities_v2()`
  - `public.get_my_advertising_campaign_billing_v2(uuid)`
- Admin rate/health RPCs:
  - `public.search_admin_advertising_billing_rates(text,text,timestamptz,uuid,integer)`
  - `public.admin_create_advertising_billing_rate_draft_v2(text,text,text,text,uuid,numeric,timestamptz,uuid)`
  - `public.admin_update_advertising_billing_rate_draft_v2(uuid,text,text,text,text,uuid,numeric,timestamptz,timestamptz,uuid)`
  - `public.admin_publish_advertising_billing_rate_v2(uuid,text,uuid)`
  - `public.admin_retire_advertising_billing_rate_v2(uuid,text,uuid)`
  - `public.get_admin_advertising_billing_health()`
  - existing `public.get_admin_advertising_finance_health()` is replaced in place to require both Ads billing-read and Finance-reconciliation capabilities.

### Exact ACL strategy

| Authority | SQL EXECUTE grant | Mandatory body authorization |
| --- | --- | --- |
| private tables/helpers/trigger functions | none to PUBLIC, `anon`, `authenticated`, or `service_role` | owner/definer only; no browser access |
| `set_advertising_launch_mode_v2`, billing/lifecycle/settlement reconcilers | `service_role` only | `auth.role() = 'service_role'` or database `session_user` in the established `postgres`/`supabase_admin` internal set; locked `search_path` |
| existing Spend/Settlement internal RPCs | preserve `service_role` EXECUTE only | same established internal-role check; no browser role |
| Funding/Activate/Resume | preserve `authenticated` grants (and the existing Funding `service_role` grant) | canonical owner checks plus the shared launch-policy lock/mode revalidation |
| Business objective/billing/event projections | `authenticated` only | `auth.uid()` owns/controls the requested Campaign/Ad Account through existing Ads ownership rules |
| Admin operational reads | `authenticated` only | `admin_require_capability('advertising.billing.read')` |
| Admin Finance detail | `authenticated` only | both `advertising.billing.read` and `finance.reconciliation.read` |
| Admin rate mutations | `authenticated` only | `admin_require_capability('advertising.rates.manage')`; only SUPER_ADMIN receives that capability |
| Admin Finance audit search | preserve `authenticated` entry point | `finance.audit.read` plus row-level `private.admin_audit_row_visible(...)`; Ads rows also require `advertising.billing.read` |

Every created/replaced SECURITY DEFINER function sets an explicit locked `search_path`. Every new public function begins with `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, followed only by the grants listed above. Browser bundles never receive `service_role`, and neither Admin nor Business can write private tables directly.

## Fixed Lock and Idempotency Contract

All mode-gated mutations and reconcilers use this order:

```text
launch-policy singleton
→ authorization window, when applicable
→ Campaign Finance
→ materialization
→ Ads financial event or settlement record
→ Ledger accounts in deterministic UUID order
→ financial transaction and Ledger entries
```

- `set_advertising_launch_mode_v2`, classifier, materializer, Funding, Activate, Resume, Spend, Settlement, lifecycle reconciler, and settlement reconciler all acquire the same singleton launch-policy row before evaluating mutable mode switches.
- An old-mode operation either commits fully before a transition takes the singleton lock, or the transition commits first and the operation revalidates/rejects. No stale-mode commit is legal.
- `public.set_advertising_launch_mode_v2` accepts one `p_idempotency_key uuid`; the singleton stores the last transition key and request fingerprint. Exact replay returns the current receipt; same key/different payload raises conflict.
- Rate mutation RPCs use the existing `private.admin_action_audit` uniqueness on `(idempotency_scope,idempotency_key)`, a stable scope per action, `private.admin_request_fingerprint(...)`, advisory/row serialization, exact replay, and conflicting-payload rejection.
- Materializer Spend idempotency is `md5('ads-v2-billing-spend:' || materialization_id::text)::uuid`; the canonical unique billable-event and Spend constraints remain final protection.
- Settlement reconciliation derives `md5('ads-v2-settlement:' || campaign_id::text)::uuid` and calls only the existing Settlement RPC.

## Expected Implementation Files

Create:

- `supabase/migrations/<generated>_ads_v2_plr_9_production_monetization_core.sql`
- `tests/adsV2Plr9ProductionMonetizationCore.test.mjs`
- `tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs`
- `apps/admin-web/src/tests/adminAdvertisingBilling.test.tsx`

Planned modifications (omit one only if the RED test proves no production change is needed there; adding any unlisted production file requires STOP/review):

- `apps/business-web/src/lib/adsManagerApi.ts`
- `apps/business-web/src/lib/adsOperationalTruth.ts`
- `shared/adsOperationalTruth.ts`
- `apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx`
- `apps/business-web/src/components/ads/OperationalTruthPanels.tsx`
- `apps/business-web/src/tests/adsManagerApi.test.ts`
- `apps/business-web/src/tests/adsOperationalTruth.test.ts`
- `apps/business-web/src/tests/AdsManagerV2.test.tsx`
- `apps/business-web/src/tests/businessPresentation.test.tsx`
- `apps/admin-web/src/lib/adminAdvertisingApi.ts`
- `apps/admin-web/src/lib/adminObservabilityApi.ts`
- `apps/admin-web/src/pages/AdminAdvertisingPages.tsx`
- `apps/admin-web/src/auth/CapabilityRoute.tsx`
- `apps/admin-web/src/layout/adminNavigation.ts`
- `apps/admin-web/src/layout/AdminShell.tsx`
- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/tests/adminAdvertisingV2.test.tsx`
- `apps/admin-web/src/tests/adminSuperpanelNavigation.test.tsx`
- `apps/admin-web/src/tests/adminFinanceConsole.test.tsx`

Do not add package scripts unless a verified build/test defect makes one necessary. In particular, do not add a root Admin promotion alias.

## Requirement-to-Task Traceability

| Required slice | Execution task(s) |
| --- | --- |
| A. Objective capability registry | 2, 10, 12–13 |
| B. Launch mode/control plane | 2, 5, 7, 11 |
| C. Billing cutover | 2, 6, 10 |
| D. Authorization windows | 3, 5–8, 11 |
| E. Rate authority/versioning | 3–4 |
| F. Admin rate RPCs + canonical audit | 4, 14–15 |
| G. Event materialization | 6, 8 |
| H. Active pending reservation authority | 6, 10 |
| I. AFTER INSERT classifier | 6, 11 |
| J. Spend hardening | 7 |
| K. Billing materializer | 8 |
| L. Budget exhaustion | 6, 8–10 |
| M. Lifecycle synchronization | 7, 9, 11 |
| N. Settlement reconciler | 7, 9, 11 |
| O. Three PLR-9 cron jobs | 9–10 |
| P. Business billing/objective projections | 10, 12 |
| Q. Server-side analytics | 10, 12–13 |
| R. Admin operational health | 10, 14–15 |
| S. Admin financial reconciliation | 4, 10, 14–15 |
| T. Reconciliation extensions | 10 |
| U. Business Web UI | 12–13 |
| V. Admin Web UI | 14–15 |
| W. Tests/concurrency/advisors | 1, 3–16 |
| X. Deployment/postcheck | 17–20 |

## Review Focus

- Structural no-back-billing at `billing_cutover_at`, without a historical backfill dependency.
- One materialization per billable event and terminal non-billable outcomes.
- Active pending reservations count only OPEN, temporally valid windows and never double-count charged Spend.
- O(1) billing shutdown and the materializer-versus-close race.
- Full production rate coverage and exact canary-only rate scope.
- A single launch-mode authority with non-contradictory `canary_enabled` and target/cap nullability.
- Shared synchronization across every switch-gated mutating RPC.
- Exact Spend rate provenance while retaining the existing accounting primitive.
- Admin operational/Finance visibility separation and canonical Admin audit.
- Server-side, capability-aware analytics and no browser monetary arithmetic.
- Inert production acceptance: DISARMED, zero rates/windows/reservations, no Spend, no money movement, no native/Edge/EAS change.

---

### Task 1: Re-run the implementation preflight and create RED contract tests

**Files:**

- Create: `tests/adsV2Plr9ProductionMonetizationCore.test.mjs`
- Create: `tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs`

- [ ] **Step 1: Prove the exact source and clean boundary**

Run from the isolated PLR-9 worktree:

```powershell
git fetch origin --prune
git branch --show-current
git rev-parse HEAD
git rev-parse origin/codex/ads-v2-plr-9-production-monetization-core
git status --short --untracked-files=all
git diff --check
git stash list
git log --oneline -20
```

Require the approved implementation-start SHA, equal local/remote SHAs, and a clean worktree. STOP rather than reset, stash, discard, or clean unknown changes.

- [ ] **Step 2: Freeze the production precheck as read-only evidence**

Using supported Supabase read-only tooling, record migration count/latest migration, reusable canary Campaign/Finance/events, all policy switches/placements, rate/window/materialization absence, balances/counts, commerce cursor/counts, both reconciliations, and current cron inventory. Require the approved PLR-9 starting state. Do not write or normalize anything.

- [ ] **Step 3: Audit duplicates and exact latest definitions**

Run searches that enumerate every definition/caller of Funding, Spend, Settlement, readiness, delivery preflight, lifecycle reconcile, canary envelope, Admin audit, Ads event summary, Business/Admin Ads modules, rate/materializer/cron candidates, wallet/Ledger/escrow/revenue authorities, and browser Supabase calls. Record the latest defining migration for each existing authority. Require no unexpected active duplicate.

- [ ] **Step 4: Write the static RED suite**

Make `tests/adsV2Plr9ProductionMonetizationCore.test.mjs` assert the generated migration and Web source contracts: exact table/function/trigger/job names; one AFTER INSERT classifier; no classifier call to Spend/Ledger; exact ACL revokes/grants; five-mode matrix; capability seeds; rate exclusion constraint; cutover; terminal statuses; active-pending predicate; canonical Spend/Settlement reuse; Admin audit action names; mode-aware reconciliation; no historical event backfill; no rate seed; no Edge/native/EAS/deploy edits.

- [ ] **Step 5: Write the disposable PostgreSQL RED harness**

Follow the existing `tests/adsV2Plr8FullFunnelCommerceLocal.integration.mjs`, `tests/adsV2Plr8C1ReconcilerDeterminism.test.mjs`, `tests/adsV2Plr6BC2CanaryPolicyEnvelopeLocal.integration.mjs`, and `tests/adsV2Plr3CampaignLifecycleLocal.integration.mjs` conventions. Use the established `nelyon-ads-v2-d-compile` Docker PostgreSQL container, a newly created disposable database, `psql -X -q -v ON_ERROR_STOP=1`, and an explicit environment opt-in. Never target production.

- [ ] **Step 6: Run RED and confirm the intended failures**

```powershell
node --test tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

Expected: FAIL only because the PLR-9 migration/projections do not yet exist. Any baseline or harness failure is a STOP condition, not a reason to weaken the tests.

### Task 2: Generate the single migration and add objective/cutover foundations

**Files:**

- Create: `supabase/migrations/<generated>_ads_v2_plr_9_production_monetization_core.sql`
- Modify: `tests/adsV2Plr9ProductionMonetizationCore.test.mjs`
- Modify: `tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs`

- [ ] **Step 1: Generate, do not hand-name, the migration**

```powershell
npx supabase migration new ads_v2_plr_9_production_monetization_core
```

Verify exactly one new migration and capture its generated version. Wrap the complete migration in one transaction-compatible forward-only script; do not use non-transactional DDL.

- [ ] **Step 2: Add the objective capability registry**

Create `private.advertising_objective_capabilities` with `objective` primary key, capability version/status, `setup_enabled`, `delivery_runtime_ready`, `billing_runtime_ready`, `conversion_runtime_ready`, nullable canonical `billable_event_type`, and timestamps. Add CHECKs linking billing readiness to exactly `impression` or `click`.

Seed exactly:

| objective | setup | delivery | billing | conversion | event |
| --- | --- | --- | --- | --- | --- |
| awareness | true | true | true | false | impression |
| traffic | true | true | true | false | click |
| marketplace_sales | true | true | true | true | click |
| reach, engagement, video_views, profile_visits, messages, website_conversions, app_promotion | false | false | false | false | null |

Historical Campaign rows remain readable. New create/readiness/activation/delivery/billing paths must later consume this table.

- [ ] **Step 3: Extend the singleton launch policy**

Alter the existing canary-policy singleton in place with `launch_mode`, immutable `billing_cutover_at`, canary billing caps, and last-transition idempotency/fingerprint/receipt fields. Capture `billing_cutover_at` exactly once from the database clock during migration. Keep physical `canary_enabled` for compatibility.

Add CHECK constraints for:

- the five allowed modes;
- exact `launch_mode` ⇔ `canary_enabled` equivalence;
- all canary target/window/delivery caps required only in canary modes and null otherwise;
- billing caps required only in `CANARY_BILLING`, null otherwise, `max_spend_bdag <= max_budget_bdag`, and `max_billable_events >= 1`;
- `billing_cutover_at` non-null and non-rewritable by the canonical transition function.

Initialize the existing row to `DISARMED`, preserving canonical disabled cap compatibility without opening any switch or window.

- [ ] **Step 4: CREATE OR REPLACE Campaign draft creation**

Preserve `public.create_my_advertising_campaign_draft(uuid,text,text,uuid)` and its authenticated ACL, ownership, age gate, and idempotency behavior. Replace only the hard-coded objective allowlist with a lookup requiring `setup_enabled = true` in `private.advertising_objective_capabilities`. Existing unsupported historical Campaign rows stay readable; new unsupported objectives fail with the canonical objective-unavailable error.

- [ ] **Step 5: Add objective/cutover tests and turn them GREEN**

Prove all ten objectives, historical readability, unsupported new setup rejection, immutable cutover, exact starting DISARMED mode, and contradictory canary/mode or target/cap shapes rejected by constraints.

```powershell
node --test --test-name-pattern="objective|cutover|launch policy shape" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="objective|cutover|launch policy shape" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 3: Implement authorization windows, versioned rates, and immutable rate lifecycle

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED rate/window tests**

Cover valid global/canary drafts, non-BDAG/zero/negative/>8-decimal rejection, invalid objective-event pairs, missing/wrong canary Campaign scope, prospective-only publication, published immutability, retirement, nullable-scope overlap, placement-specific coverage, OPEN-window publish/retire rejection, and one OPEN control-plane window.

- [ ] **Step 2: Create authorization windows**

Create `private.advertising_billing_authorization_windows` with UUID identity, mode (`CANARY_BILLING` or `PRODUCTION`), scope (`canary_campaign` or `global`), optional exact Campaign, `opened_at`, optional `expires_at`, `status` (`OPEN`,`CLOSED`), `closed_at`, canary Spend/event caps, transition idempotency reference, and timestamps. Constraints enforce mode/scope/Campaign/cap/time shapes. A partial unique index permits only one OPEN window for the singleton control plane.

Only the launch transition RPC may insert or close a window. Closing is a single-row O(1) update. No backlog update is part of close.

- [ ] **Step 3: Create versioned rate storage**

Create `private.advertising_billing_rate_versions` with UUID identity, objective FK, canonical event, required placement FK/code, `rate_bdag numeric(20,8)`, `currency = 'BDAG'`, scope, optional scope Campaign, state (`draft`,`published`,`retired`), effective interval, Admin actor columns, and lifecycle timestamps.

Use `btree_gist` only after verifying/ensuring the extension in the migration. Add a GiST exclusion constraint over objective, event, placement, scope, `coalesce(scope_campaign_id, '00000000-0000-0000-0000-000000000000')`, and `tstzrange(effective_from,effective_to,'[)')` for published/retired rows. This is the structural overlap authority, including null global Campaign scope. Trigger/function guards make published pricing/scope/start fields immutable; retirement may only close future applicability.

- [ ] **Step 4: Add rate resolution and coverage helpers**

Implement `private.resolve_advertising_billing_rate_v2(...)` and `private.advertising_rate_coverage_at(...)`. Resolution derives objective/event/placement/time from canonical event/Campaign rows. `CANARY_BILLING` considers only exact `canary_campaign`; `PRODUCTION` considers only `global`; other modes resolve none. Zero matches gives no rate, more than one is an invariant error.

Coverage requires exactly one open-ended prospective global rate for each billing-ready + delivery-ready objective × enabled runtime-ready placement × canonical event before PRODUCTION. CANARY_BILLING requires one exact canary rate covering the entire requested window.

- [ ] **Step 5: Run the focused rate/window suite**

```powershell
node --test --test-name-pattern="rate|window|coverage|overlap" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="rate|window|coverage|overlap" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

Require all structural and concurrency-safe overlap cases GREEN before building Admin RPCs.

### Task 4: Implement canonical Admin rate RPCs, capabilities, and audit visibility

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED Admin capability/audit tests**

Prove role matrix, exact replay, conflict rejection, one audit row per new command, publish/retire reason requirement, actor snapshot, safe metadata, receipt, no PII, immutable publication, and full rate lifecycle visibility to FINANCE_AUDITOR without `admin.audit.read`.

- [ ] **Step 2: Add capabilities and assignments**

Insert `advertising.billing.read` and `advertising.rates.manage` through the existing capability tables. Assign billing read to SUPER_ADMIN, PLATFORM_ADMIN, FINANCE_AUDITOR; assign rate management only to SUPER_ADMIN. Do not grant launch-mode control.

- [ ] **Step 3: Implement the four rate mutation RPCs**

Create the exact rate RPCs named in the fixed boundary. Each is SECURITY DEFINER/locked-path, requires `advertising.rates.manage`, takes `p_idempotency_key`, computes a stable request fingerprint, serializes with the launch-policy/rate row, replays the existing receipt safely, rejects same-key/different-payload, and inserts exactly one `private.admin_action_audit` record for a new command.

Use actions/scopes:

- `advertising.rate.draft.create`
- `advertising.rate.draft.update`
- `advertising.rate.publish`
- `advertising.rate.retire`

Draft actions set `financial_effect = false`; publish/retire set `financial_effect = true`. All use `actor_kind = 'human_admin'`, current actor/role snapshot, capability, target identity, outcome, `contains_pii = false`, bounded safe metadata, and server receipt. Publish/retire require nonblank bounded `reason`, take the launch-policy lock, reject affected OPEN windows, and preserve historical provenance.

- [ ] **Step 4: Extend canonical audit visibility/search**

CREATE OR REPLACE `private.admin_audit_row_visible(text,boolean)` with the `advertising` domain rule: Ads billing-read is always required, and financial-effect rows additionally require Finance audit capability. CREATE OR REPLACE `public.search_admin_finance_audit(...)` to include exactly the four Ads rate actions even where draft actions have `financial_effect = false`, retain its `finance.audit.read` entry requirement, and apply `admin_audit_row_visible` row-by-row. Do not create an Ads-specific audit table/search RPC.

- [ ] **Step 5: Add the rate read projection and ACLs**

Create `public.search_admin_advertising_billing_rates(...)`, capability-gated by `advertising.billing.read`. It exposes safe version/configuration metadata only, never secrets or private user data.

- [ ] **Step 6: Run focused Admin SQL tests**

```powershell
node --test --test-name-pattern="admin|audit|capability|rate lifecycle" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="admin|audit|capability|rate lifecycle" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 5: Implement the sole launch transition authority and five-mode envelope

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED legal/illegal mode tests**

Cover every row of the approved matrix, target/cap nullability, enabled placements, window/rate scope, full production coverage, exact canary coverage, illegal hybrids, direct contradictions, replay/conflict, and O(1) window close.

- [ ] **Step 2: CREATE OR REPLACE the envelope assertion**

Replace `private.advertising_assert_canary_launch_envelope()` in place and preserve the existing five deferred constraint triggers. Enforce:

- `DISARMED`: every switch/placement false, no target/window/cap;
- `CANARY_DELIVERY`: canary/Funding/Activation/global/exact placement true, Spend/Settlement/Automatic false, exact targets + delivery caps, no billing window/rate;
- `CANARY_BILLING`: canary/Spend/Activation/global/exact placement true, Funding/Settlement/Automatic false, exact targets + delivery/billing caps, one matching OPEN window and exact canary rate;
- `SETTLEMENT_ONLY`: only Settlement true, all delivery/placements/targets/windows false/null;
- `PRODUCTION`: canary false, Funding/Spend/Settlement/Activation/Automatic/global true, only runtime-ready placements, no canary targets/caps, one OPEN global window, complete global rate coverage.

- [ ] **Step 3: Create `set_advertising_launch_mode_v2`**

Use the fixed signature listed above. `enabled_at`/window `opened_at` always come from one server `clock_timestamp()` captured by the RPC; the caller may supply only the future `p_expires_at` needed by a canary. PRODUCTION has no expiry. The RPC:

1. locks the singleton launch policy;
2. verifies replay/fingerprint;
3. locks/closes an outgoing billing window in O(1);
4. validates exact Campaign/Finance/rate coverage for the requested mode;
5. creates the incoming authorization window only for CANARY_BILLING/PRODUCTION;
6. writes both `launch_mode` and compatible `canary_enabled` plus every existing policy switch/placement in one transaction;
7. clears or requires all target/cap fields;
8. forces deferred constraints immediate;
9. returns a receipt without performing Funding, Activation, Spend, Settlement, or Campaign mutation.

Grant service_role only; permit established database internal users in the function body. No Business/Admin route calls it.

- [ ] **Step 4: Run the mode suite**

```powershell
node --test --test-name-pattern="DISARMED|CANARY_DELIVERY|CANARY_BILLING|SETTLEMENT_ONLY|PRODUCTION|transition" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="launch mode|transition|coverage" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 6: Add materialization, active reservations, and AFTER INSERT classification

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED classifier/reservation tests**

Cover post-cutover impression/click classification, pre-cutover exclusion without backfill, unsupported event/objective, no rate, outside authorization, exact rate provenance, one row per event, terminal immutability, closed/expired pending release, reservation bounds, canary Spend/event caps, and absence of any Finance/Ledger mutation during INSERT.

- [ ] **Step 2: Create the materialization audit table**

Create `private.advertising_event_billing_materializations` with UUID identity; UNIQUE canonical `billable_event_id`; Campaign/viewer/placement/objective/event snapshots; optional authorization-window and rate-version IDs; status; immutable `amount_bdag`; optional canonical Spend financial-event ID; reason; timestamps. Add state-shape CHECKs and a transition guard:

- `pending` has an OPEN-linked window, exact rate, positive amount, no financial event;
- `charged` has the same immutable rate/amount/window and one financial event;
- `budget_exhausted` has amount zero and no financial event;
- `not_billable_no_rate`, `not_billable_outside_authorization`, `not_billable_before_cutover`, and `not_billable_objective` are terminal and have no financial event;
- no terminal state can return to pending or charged.

- [ ] **Step 3: Create the active reservation/billing-state helpers**

`private.advertising_active_pending_reserved_bdag(campaign,at)` sums only pending rows joined to an OPEN and temporally valid authorization window. CLOSED/expired pending rows immediately reserve zero even before housekeeping.

`private.advertising_campaign_billing_state_at(...)` returns funded/spent/released, active pending, raw available amount, anomaly flag, current objective/event/rate readiness, and next-unit sufficiency. Do not mask negative availability with `GREATEST`. If active pending exceeds `funded - spent - released`, mark unsafe, block new classification/materialization, and surface reconciliation/Admin evidence.

- [ ] **Step 4: Create the one classifier trigger**

Implement `private.classify_advertising_billable_event_v2()` and attach exactly one AFTER INSERT trigger to the canonical Ads event table with `WHEN (NEW.event_type IN ('impression','click'))` where supported. The function locks launch policy first, derives every input server-side, enforces cutover and current mode/window, resolves only the mode-specific scope, checks Finance availability and canary-window caps, and inserts exactly one terminal or pending materialization.

For remaining < full rate, insert terminal `budget_exhausted` with zero. Never partial-charge. For legal nonbilling states insert the approved terminal classification. Never invoke Spend or write Finance/Ledger/transactions.

- [ ] **Step 5: Run the focused classifier suite**

```powershell
node --test --test-name-pattern="classifier|materialization|reservation|cutover|budget exhausted" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="classifier|materialization|reservation|cutover|budget exhausted" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 7: Synchronize gated authorities and harden canonical Spend

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED gated-operation and Spend tests**

Prove stale-mode rejection for Funding/Activate/Resume/Spend/Settlement, arbitrary service-role amount rejection, missing/wrong materialization rejection, window/rate/Campaign/event mismatch, CANARY_DELIVERY Spend rejection, exact CANARY_BILLING allowance/caps, PRODUCTION global-only allowance, and preserved Funding/Settlement accounting behavior.

- [ ] **Step 2: CREATE OR REPLACE Funding, Activate, and Resume**

Preserve signatures, ownership, idempotency, and existing mutation bodies. Move the launch-policy lock to the first mutable authorization step, then revalidate mode/switch before Campaign/Finance mutation. Funding is legal only where the matrix enables Funding; Activate/Resume only where Activation is enabled. Keep authenticated ACLs and existing owner authority.

- [ ] **Step 3: CREATE OR REPLACE canonical Spend**

Preserve the existing signature and all escrow → Ads revenue transaction/Ledger/Finance logic. Before Finance mutation:

1. lock launch policy;
2. require CANARY_BILLING or PRODUCTION with Spend enabled;
3. lock/revalidate the linked OPEN, temporally valid window;
4. lock Finance then materialization in the fixed order;
5. require `pending`, exact Campaign/event/objective/placement/rate/window, and `p_amount_bdag = immutable materialization.amount_bdag`;
6. in CANARY_BILLING call `private.advertising_canary_spend_allowed(...)`, using window-local `pending + charged` caps without adding Finance.spent again;
7. revalidate active pending/Finance availability and existing no-overspend rules.

Keep service_role EXECUTE only and allow the established postgres/supabase_admin execution context for pg_cron materialization without granting browser access.

- [ ] **Step 4: CREATE OR REPLACE canonical Settlement gate**

Preserve all existing semantics, especially zero residual. Add the singleton launch lock before Finance and require SETTLEMENT_ONLY or PRODUCTION with Settlement enabled. Do not duplicate or rewrite release/Ledger operations.

- [ ] **Step 5: Run focused authority tests**

```powershell
node --test --test-name-pattern="Funding|Activate|Resume|Spend|Settlement|ACL" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="Funding|Activate|Resume|Spend|Settlement|Ledger" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 8: Implement the bounded billing materializer and budget delivery gate

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED materializer/Ledger tests**

Cover exact impression/click/objective pairs, no-rate/nonbilling terminal states, retry, parallel invocations, amount provenance, one transaction/two Ledger entries, full rollback on injected error, closed-window cleanup, no charge while disabled, and remaining >/=/< rate behavior.

- [ ] **Step 2: Create `reconcile_advertising_billable_events_v2(integer)`**

Bound `p_limit` to the repository convention and default cron batch 100. Lock launch policy, select pending rows deterministically with `FOR UPDATE SKIP LOCKED`, follow the common lock order, and for each row:

- terminalize CLOSED/expired-window pending rows as `not_billable_outside_authorization` in a bounded batch;
- no-op on charging outside CANARY_BILLING/PRODUCTION;
- revalidate current OPEN window, rate provenance/effective interval, Finance availability, active-pending invariant, and canary caps;
- call only canonical Spend with the immutable amount and deterministic key;
- link the returned canonical financial event and mark `charged` in the same transaction.

Do not catch/swallow unexpected exceptions. Let cron see FAILED and leave no cursor/progress/partial accounting state.

- [ ] **Step 3: Extend readiness and delivery in place**

CREATE OR REPLACE the canonical operational-readiness and delivery-preflight functions. Both consume the objective registry and billing-state/rate authority. In production billing modes, no rate or insufficient next-unit budget returns `campaign_budget_insufficient_for_next_billable_event`/canonical no-rate blocker and prevents new delivery. CANARY_DELIVERY preserves no-Spend validation semantics. Only `social_feed` remains runtime-ready.

- [ ] **Step 4: Prove accounting and delivery behavior**

```powershell
node --test --test-name-pattern="materializer|Ledger|budget|delivery|readiness" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="materializer|Ledger|budget|delivery|readiness" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

Require reconciliation zero after each charged fixture and no transaction/Ledger row for budget exhausted.

### Task 9: Make lifecycle and settlement mode-aware and install exactly three crons

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED lifecycle/settlement/cron tests**

Cover all mode no-ops, scheduled activation, scheduled expiry, active budget/schedule completion, paused immutability, terminal settlement, zero residual, idempotent retry, disabled no-op, bounded batches, fail-visible errors, exact job inventory, and preserved PLR-8 conversion cron.

- [ ] **Step 2: CREATE OR REPLACE lifecycle reconciliation**

Keep `public.reconcile_advertising_campaign_lifecycle(integer,timestamptz)` as the single authority. Lock launch policy first and mutate only under PRODUCTION + Automatic. Implement:

- scheduled → active only when window begins and canonical readiness passes;
- scheduled → completed with `campaign_schedule_expired` if the window ends before activation;
- active → completed on schedule exhaustion or budget exhaustion;
- paused never auto-resumes or auto-completes;
- every other mode no-ops.

- [ ] **Step 3: Create bounded settlement reconciliation**

Create `public.reconcile_advertising_campaign_settlements_v2(integer)`. Under the shared launch lock, no-op except SETTLEMENT_ONLY/PRODUCTION. Select only completed/cancelled Campaigns with funded Finance and no settlement, then call only canonical Settlement with the deterministic Campaign key. Do not change launch mode. Preserve zero-residual behavior.

- [ ] **Step 4: Install exactly three PLR-9 jobs**

Using the existing `cron.unschedule`/`cron.schedule` pattern, replace by canonical name and install one active job each at `* * * * *`, batch 100:

- `reconcile-advertising-billable-events-v2`
- `reconcile-advertising-campaign-lifecycle-v2`
- `reconcile-advertising-campaign-settlements-v2`

Do not alter `reconcile-advertising-marketplace-purchase-conversions-v2`. Ensure unexpected errors propagate to `cron.job_run_details`.

- [ ] **Step 5: Run focused lifecycle/cron tests**

```powershell
node --test --test-name-pattern="lifecycle|settlement|cron" tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test --test-name-pattern="lifecycle|settlement|cron" tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

### Task 10: Add Business/Admin projections, server analytics, and reconciliation

**Files:**

- Modify: generated PLR-9 migration
- Modify: both PLR-9 test files

- [ ] **Step 1: Add RED projection/reconciliation tests**

Cover owner/capability ACLs, active-pending definition, negative-availability anomaly, capability-aware analytics, operational-versus-Finance detail, mode-aware coverage counters, every new billing anomaly, and preservation of all old reconciliation keys.

- [ ] **Step 2: Create Business objective/billing projections**

Create `get_my_advertising_objective_capabilities_v2()` and `get_my_advertising_campaign_billing_v2(uuid)`. Return server-derived billing basis/rate status/version/scope/interval, Budget/Funded/Spent/Released, active pending, raw remaining availability and anomaly status, next-unit readiness/blockers, and no launch control. `pending_reserved_bdag` must call the single active-reservation helper.

- [ ] **Step 3: CREATE OR REPLACE event summary analytics**

Preserve existing counts/value. Add server-side CTR, CPC, CPM, conversion rate, and ROAS values plus status fields. Zero denominators return null/no-data. For objectives with `conversion_runtime_ready = false`, conversion rate and ROAS return null/`not_applicable`; marketplace_sales calculates only with valid denominators. Never label attributed GMV as profit/net revenue.

- [ ] **Step 4: Create operational and financial Admin projections**

`get_admin_advertising_billing_health()` requires Ads billing-read and returns mode, rates/coverage readiness, windows, materialization/backlog/active-pending/budget-exhausted/charged counts, oldest pending, anomaly flags, and three cron health summaries without Finance/Ledger detail.

CREATE OR REPLACE `get_admin_advertising_finance_health()` to require both Ads billing-read and Finance reconciliation-read, then return escrow/revenue/Ledger/transaction/reconciliation detail. PLATFORM_ADMIN must be denied this detail; FINANCE_AUDITOR and SUPER_ADMIN may read it.

- [ ] **Step 5: Extend Finance reconciliation in place**

Append stable PLR-9 keys for orphan/mismatched materializations and financial events, amount/rate/version/effective-window mismatch, duplicate charge/materialization, Campaign mismatch, pre-cutover charge, outside-authorization charge, active-pending overflow, budget/escrow/revenue equations, `production_rate_coverage_gap`, and `canary_rate_scope_mismatch`.

The two coverage mismatch counters are mode-aware invariant checks: production gap is nonzero only while PRODUCTION is illegally under-covered; canary mismatch only while CANARY_BILLING violates exact rate scope. In DISARMED with zero rates both are zero, while separate readiness reports `production_rate_coverage_ready = false`.

- [ ] **Step 6: Run the complete static and disposable database suites**

```powershell
node --test tests/adsV2Plr9ProductionMonetizationCore.test.mjs
$env:NELYON_PLR9_LOCAL='1'; node --test tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

Do not proceed to Web code until both are GREEN.

### Task 11: Prove real serialization races and query plans

**Files:**

- Modify: `tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs`
- Modify: generated PLR-9 migration only if a test exposes a defect

- [ ] **Step 1: Add a separate-session race harness**

Open two independent `psql` connections per race. Coordinate with advisory locks/barriers and observable transaction states so overlap is real, not sequential simulation. Set bounded `lock_timeout`/`statement_timeout` and fail on deadlock or a third outcome.

- [ ] **Step 2: Prove every mandatory race**

Run and assert only the two serial outcomes for:

1. DISARM vs Funding;
2. DISARM vs Activate;
3. DISARM vs Resume;
4. SETTLEMENT_ONLY → DISARMED vs Settlement;
5. CANARY_BILLING → DISARMED vs Spend/materializer;
6. PRODUCTION → DISARMED vs event classification;
7. materializer vs authorization-window close;
8. parallel materializers for one event;
9. publish/retire vs mode entry/coverage validation.

Require no stale-mode commit, deadlock, partial Spend, charged-without-Ledger, Ledger-without-charged, or pending charge after close.

- [ ] **Step 3: Run EXPLAIN on representative disposable data**

Use `EXPLAIN (ANALYZE, BUFFERS)` for rate resolution, active-pending, pending materializer batch, coverage, settlement batch, and lifecycle batch. Add only minimum indexes justified by the observed plans. Re-run explains after any index change and record the decision in test output.

- [ ] **Step 4: Run the full DB test twice**

```powershell
$env:NELYON_PLR9_LOCAL='1'; node --test tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; node --test tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
```

Two clean runs are required to expose state leakage and non-idempotent cron/schema setup.

### Task 12: Wire Business objective/billing/analytics projections

**Files:**

- Modify: `apps/business-web/src/lib/adsManagerApi.ts`
- Modify: `apps/business-web/src/lib/adsOperationalTruth.ts`
- Modify: `shared/adsOperationalTruth.ts`
- Modify: `apps/business-web/src/tests/adsManagerApi.test.ts`
- Modify: `apps/business-web/src/tests/adsOperationalTruth.test.ts`

- [ ] **Step 1: Write RED Business model/API tests**

Require server-backed objective capabilities; billing projection types; exact owner RPC names; no rate/charge arithmetic in the browser; metric value/status mapping; null → `—`; not-applicable distinction; active pending only; and no launch-mode mutation API.

- [ ] **Step 2: Extend the existing API module**

Replace hard-coded objective availability with `get_my_advertising_objective_capabilities_v2`. Add `get_my_advertising_campaign_billing_v2` and extend event-summary types for server metric values/statuses. Preserve `adsMutationCoordinator` and existing Campaign/Finance/readiness refetch behavior. Never send charge amount, rate ID, launch mode, or private IDs.

- [ ] **Step 3: Extend shared presentation truth**

Map canonical objective/billing/metric status codes to readable presentation inside the existing shared/Business truth modules. Remove any authoritative CPC/CPM/ROAS/CVR calculation from TypeScript. Keep pure display formatting only.

- [ ] **Step 4: Run focused Business library tests**

```powershell
npm --prefix apps/business-web test -- src/tests/adsManagerApi.test.ts src/tests/adsOperationalTruth.test.ts
```

### Task 13: Present Business billing and capability truth without UI regression

**Files:**

- Modify: `apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx`
- Modify: `apps/business-web/src/components/ads/OperationalTruthPanels.tsx`
- Modify: `apps/business-web/src/tests/AdsManagerV2.test.tsx`
- Modify: `apps/business-web/src/tests/businessPresentation.test.tsx`

- [ ] **Step 1: Write RED page/component tests**

Cover supported/unsupported objective states, historical unsupported Campaign readability, rate unavailable/published basis, Budget/Funded/Spent/Released/Remaining/Pending reservation, blocker/anomaly states, Spend/CTR/CPC/CPM/CVR/ROAS, null/`not_applicable` rendering, and no launch controls.

- [ ] **Step 2: Update the existing Campaign/create/analytics surfaces**

Consume only canonical projections. Show unsupported objectives as unavailable under the current design convention; preserve marketplace_sales commerce UX. Show rate/billing unavailable truthfully instead of fake zero. Label attributed Marketplace value as purchase value/GMV, not profit. Preserve existing Funding/Activation/Pause/Resume behavior and mutation refetch semantics.

- [ ] **Step 3: Preserve responsive behavior**

Use the existing cards/grid/button/checklist system. Add tests at 390 px, 430 px, and desktop for no horizontal page overflow, wrapping, readable labels, and contained cards. Do not redesign or add Figma work.

- [ ] **Step 4: Run focused Business UI tests**

```powershell
npm --prefix apps/business-web test -- src/tests/AdsManagerV2.test.tsx src/tests/businessPresentation.test.tsx
```

### Task 14: Wire Admin billing APIs and exact capability routing

**Files:**

- Modify: `apps/admin-web/src/lib/adminAdvertisingApi.ts`
- Modify: `apps/admin-web/src/lib/adminObservabilityApi.ts`
- Modify: `apps/admin-web/src/auth/CapabilityRoute.tsx`
- Modify: `apps/admin-web/src/layout/adminNavigation.ts`
- Modify: `apps/admin-web/src/layout/AdminShell.tsx`
- Modify: `apps/admin-web/src/App.tsx`
- Create: `apps/admin-web/src/tests/adminAdvertisingBilling.test.tsx`
- Modify: `apps/admin-web/src/tests/adminSuperpanelNavigation.test.tsx`
- Modify: `apps/admin-web/src/tests/adminFinanceConsole.test.tsx`

- [ ] **Step 1: Write RED API/routing tests**

Cover exact RPC arguments, idempotency/reason/expected-updated-at, safe receipt handling, no private table writes, capability matrix, operational page access, dual-capability Finance page access, and absence of launch controls.

- [ ] **Step 2: Extend existing Admin API modules**

Add typed calls for rate search/create/update/publish/retire, operational health, and Finance detail. Reuse existing Supabase client/error mapping. Browser requests define rate policy only; no per-event charge endpoint exists.

- [ ] **Step 3: Make dual capability structural**

Extend `CapabilityRoute` with `additionalCapabilities?: string[]` and require all. Extend existing navigation link metadata and `AdminShell` filtering with the same all-capabilities rule. Configure:

- `/advertising/billing`: `advertising.billing.read`;
- `/advertising/finance-health`: `finance.reconciliation.read` plus `advertising.billing.read`;
- rate mutations/buttons: `advertising.rates.manage` in addition to the page read capability.

Do not infer access from role names.

- [ ] **Step 4: Run focused Admin API/access tests**

```powershell
npm --prefix apps/admin-web test -- src/tests/adminAdvertisingBilling.test.tsx src/tests/adminSuperpanelNavigation.test.tsx src/tests/adminFinanceConsole.test.tsx
```

### Task 15: Extend the existing Admin Ads UI for rates and health

**Files:**

- Modify: `apps/admin-web/src/pages/AdminAdvertisingPages.tsx`
- Modify: `apps/admin-web/src/tests/adminAdvertisingV2.test.tsx`
- Modify: `apps/admin-web/src/tests/adminAdvertisingBilling.test.tsx`

- [ ] **Step 1: Write RED Admin Ads UI tests**

Cover rate list/detail, draft create/edit, publish/retire confirmations and reasons, immutable published view, safe replay receipt, operational billing health, coverage readiness, OPEN windows, backlog/active pending/budget exhausted/charged counts, oldest pending/anomaly/cron health, and Finance detail separation.

- [ ] **Step 2: Add rate/health surfaces inside the existing Ads module**

Reuse Admin page primitives, capability hooks, form validation, error presentation, and responsive layout. Published/retired rows are read-only. Publish/retire require explicit confirmation and bounded reason. Smoke/default state creates or publishes no rate. Do not add launch-mode controls or a second Admin module.

- [ ] **Step 3: Run focused Admin Ads tests**

```powershell
npm --prefix apps/admin-web test -- src/tests/adminAdvertisingV2.test.tsx src/tests/adminAdvertisingBilling.test.tsx
```

### Task 16: Run the complete local gate, advisors, and duplicate audit

**Files:**

- Modify only files already listed if a genuine failure requires a fix

- [ ] **Step 1: Run PLR-9 and historical database regressions**

Run the two PLR-9 suites and this pinned static regression set:

```powershell
node --test tests/adsV2Plr9ProductionMonetizationCore.test.mjs tests/adsV2Plr8C1ReconcilerDeterminism.test.mjs tests/adsV2Plr8FullFunnelCommerce.test.mjs tests/adsV2Plr7AClickInteractionRuntime.test.mjs tests/adsV2Plr6BC2CanaryPolicyEnvelope.test.mjs tests/adsV2Plr6BC1FundingRecovery.test.mjs tests/adsV2Plr6ACanarySafetyEnvelope.test.mjs tests/adsV2Plr3CampaignLifecycle.test.mjs tests/adsV2HFinancialGeneralization.test.mjs tests/adsV2GEventsConversionsAttribution.test.mjs tests/adsV2DeliveryEdgeContract.test.mjs tests/adsV2FeedRuntime.test.mjs tests/adsV2IBusinessWebSafety.test.mjs tests/adsV2B8ResilienceAccessibility.test.mjs
node --test tests/marketplaceAdsFinance.test.mjs tests/marketplaceAdsEligibility.test.mjs tests/marketplaceMktA3CPayment.test.mjs tests/marketplaceMktA3D2Reconciliation.test.mjs tests/marketplaceMktA3D2Settlement.test.mjs tests/marketplaceHeldDisputeRefund.test.mjs tests/marketplaceRefundReconciliationR2B4F3.test.mjs tests/marketplaceCheckoutOrderImageSnapshot.test.mjs tests/superuserA8FinanceAuditSystemHealth.test.mjs
```

Then run the pinned disposable Ads integrations with their existing opt-in flags:

```powershell
$env:NELYON_PLR9_LOCAL='1'; node --test tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs; Remove-Item Env:NELYON_PLR9_LOCAL
$env:NELYON_PLR8_LOCAL='1'; node --test tests/adsV2Plr8FullFunnelCommerceLocal.integration.mjs; Remove-Item Env:NELYON_PLR8_LOCAL
$env:NELYON_PLR7A_LOCAL='1'; node --test tests/adsV2Plr7AClickInteractionRuntimeLocal.integration.mjs; Remove-Item Env:NELYON_PLR7A_LOCAL
$env:NELYON_PLR6BC2_LOCAL='1'; node --test tests/adsV2Plr6BC2CanaryPolicyEnvelopeLocal.integration.mjs; Remove-Item Env:NELYON_PLR6BC2_LOCAL
$env:NELYON_PLR6BC1_LOCAL='1'; node --test tests/adsV2Plr6BC1FundingRecoveryLocal.integration.mjs; Remove-Item Env:NELYON_PLR6BC1_LOCAL
$env:NELYON_PLR6A_LOCAL='1'; node --test tests/adsV2Plr6ACanaryFinanceLocal.integration.mjs; Remove-Item Env:NELYON_PLR6A_LOCAL
$env:NELYON_PLR3_LOCAL='1'; node --test tests/adsV2Plr3CampaignLifecycleLocal.integration.mjs; Remove-Item Env:NELYON_PLR3_LOCAL
```

Do not point any harness at production. If a pinned file is renamed on the exact implementation start SHA, STOP and update this plan/report rather than silently dropping coverage.

- [ ] **Step 2: Run all Business/Admin gates**

```powershell
npm run business:web:test
npm run business:web:lint
npm run business:web:build
npm run business:web:test:deployment
npm run admin:web:test
npm run admin:web:lint
npm run admin:web:build
npm run admin:web:test:deployment
```

Run repository TypeScript checks for the modified workspaces and require zero new modified-file diagnostics.

- [ ] **Step 3: Run static cleanliness/security checks**

```powershell
git diff --check
git status --short --untracked-files=all
```

Search built bundles/source for `SUPABASE_SERVICE_ROLE_KEY`, private credentials, direct private-table mutations, individual charge amounts from browser/Edge, duplicate authorities, forbidden native/Edge changes, and generated build output. Any hit must be explained or fixed before commit.

- [ ] **Step 4: Run Supabase advisors against the migration result**

Run security and performance advisors after applying the migration to disposable/branch validation and again after production deployment. Fix new PLR-9 Critical/Warning findings attributable to this migration; separately report historical unrelated findings. Do not claim old project findings were created by PLR-9.

- [ ] **Step 5: Repeat duplicate/orphan proof**

Use `rg` plus schema inspection to prove one wallet/Ledger/escrow/revenue/Finance/Spend/Settlement/rate/materializer/launch/lifecycle/settlement-cron/Admin Ads/Business Ads/audit authority and one active job per canonical name. Verify no orphan caller or test-only production function.

### Task 17: Self-review, commit, push, and freeze the exact deployment SHA

**Files:** all implementation files listed above; no others

- [ ] **Step 1: Review against spec and this plan**

Check every Section 1–4 invariant, later binding correction, file boundary, ACL, STOP condition, placeholder/TODO, unresolved choice, duplicate, and deployment command. Confirm native/Edge/Public source untouched.

- [ ] **Step 2: Create no more than two cohesive commits**

Preferred first commit:

```powershell
git add -- <generated-migration> tests/adsV2Plr9ProductionMonetizationCore.test.mjs tests/adsV2Plr9ProductionMonetizationCoreLocal.integration.mjs
git commit -m "feat(ads): complete production billing and spend control"
```

Preferred second commit:

```powershell
git add -- apps/business-web apps/admin-web shared/adsOperationalTruth.ts
git commit -m "feat(ads): expose billing truth in business and admin"
```

If the cohesive diff is safer as one commit, use only the first message and include all allowed files. Never stage unrelated files.

- [ ] **Step 3: Push and verify exact SHA**

```powershell
git push origin codex/ads-v2-plr-9-production-monetization-core
git rev-parse HEAD
git rev-parse origin/codex/ads-v2-plr-9-production-monetization-core
git status --short --untracked-files=all
git diff --check
```

Require equal local/remote SHA and clean status. That exact SHA is the only deployable source.

### Task 18: Perform final production precheck and deploy the one migration

**Files:** no source changes

- [ ] **Step 1: Re-read production immediately before deployment**

Require migration count 297/latest PLR-8-C1; NELYON ADS CANARY paused/funded 0.01/spent 0/released 0 with 1 impression/1 click/0 historical billing; all launch switches/placements false; user 179.86430556; escrow 0.01; expected counts or fully explained unrelated deltas; commerce conversion state safe; Ads and Marketplace reconciliations zero. STOP on unexplained divergence.

- [ ] **Step 2: Prove the exact pending migration**

Use the linked project `aewwdlvbwpczqyvkwvvj` and supported Supabase CLI/authentication:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Require exactly the generated PLR-9 migration pending and no historical mismatch. If the local CLI version does not accept `--linked`, use its documented linked-project default after verifying `.temp/project-ref`; do not guess flags or repair history.

- [ ] **Step 3: Deploy only the migration**

```powershell
npx supabase db push --linked
```

Do not use `--include-all`, migration repair, raw manual partial SQL, or any Edge deploy. A migration failure must roll back; STOP and create a forward corrective migration only after root-cause review.

- [ ] **Step 4: Run DB acceptance before any Web promotion**

Require migration count 298/parity; DISARMED matrix; zero published rates/OPEN windows/active pending; three exact active PLR-9 crons plus unchanged conversion cron; exact ACLs/constraints/triggers; no Spend/transactions/Ledger change; reusable canary unchanged; all old/new Ads reconciliation keys and Marketplace 23/23 zero; operational readiness false but mode-aware coverage invariant counters zero.

### Task 19: Deploy exact Business and Admin preview Versions, then promote those Versions

**Files:** no source changes

- [ ] **Step 1: Upload and smoke Business preview**

```powershell
npm run business:web:upload:preview
```

Record Version ID/SHA/preview URL. Smoke `/business/`, Campaign workspace, objective truth, billing panel, analytics, and 390/430/desktop layouts without mutating Campaign/Finance/rates/mode. If smoke fails, do not promote.

- [ ] **Step 2: Promote the exact tested Business Version**

```powershell
npm run business:web:promote:version -- <BUSINESS_VERSION_ID>
```

Verify active production deployment references the same Version ID and exact Git SHA. If regression appears, promote the previously recorded Version; do not rebuild as rollback.

- [ ] **Step 3: Upload and smoke Admin preview**

```powershell
npm run admin:web:upload:preview
```

Record Version ID/SHA/preview URL. Smoke Ads billing/rates, operational health, Finance visibility/capability boundaries, and responsive rendering. Do not create/publish/retire a rate during smoke. If smoke fails, do not promote.

- [ ] **Step 4: Promote the exact tested Admin Version**

```powershell
npm --prefix apps/admin-web run promote:version -- <ADMIN_VERSION_ID>
```

Verify exact Version ID and SHA. Do not invent a root alias, run direct `wrangler deploy`, or use `apply:production-route` unless a separately authorized route defect is proven.

### Task 20: Run global acceptance and produce the remaining-scope audit

**Files:** no source changes unless a defect triggers STOP and a separately reviewed forward correction

- [ ] **Step 1: Re-run global DB/Finance acceptance**

Verify migration parity; Edge `ads-v2-delivery` remains v3/hash unchanged; launch mode DISARMED; canary/Funding/Spend/Settlement/Activation/Automatic/global delivery/all placements false; zero rates/windows/active pending; reusable canary paused/funded 0.01/spent 0/released 0 with historical 1 impression/1 click/0 billing; balances/counts unchanged absent explained unrelated activity; all reconciliation keys zero; all crons healthy/no-op under DISARMED.

- [ ] **Step 2: Verify production Web truth**

Business and Admin production deployments must report the promoted Version IDs and exact Git SHA. Smoke read-only capability/objective/billing/analytics/health pages. Prove PLATFORM_ADMIN sees operational billing but not Finance detail or mutations; FINANCE_AUDITOR sees operational + Finance + full rate lifecycle audit but cannot mutate; SUPER_ADMIN can see/manage while no real mutation is performed.

- [ ] **Step 3: Prove prohibited actions remained absent**

Confirm DB schema only via the one migration; no Edge/Public/native/EAS deployment; no rate; no launch window; no Funding/Activation/Spend/Settlement; no Campaign/event mutation; money moved = 0 BDAG; no source changes after the deployment SHA.

- [ ] **Step 4: Perform a real remaining-scope audit**

Classify final verified reality as DONE, NOT YET IMPLEMENTED, or INTENTIONALLY OUT OF CURRENT PRODUCT SCOPE for Social Feed, Clips, Stories, LIVE, Marketplace Home/Search legacy relationship, every objective runtime, custom age targeting, Stripe/BDAG relationship, production rollout controls, rate economics/publication, billing canary, and physical testing. Do not copy the design baseline mechanically and do not start any remaining macro.

- [ ] **Step 5: Deliver the PLR-9 final report and stop**

Report exact Git/migration/deployment IDs, architecture, ACLs, tables/RPCs/crons, tests/concurrency/advisors, Business/Admin behavior, production acceptance, zero money movement, native/EAS NO/NO, and remaining scope. Conclude only with the status required by the implementation authorization, then STOP.

## Implementation STOP Conditions

STOP without widening scope if any of the following occurs:

- source/remote SHA differs, worktree contains unknown changes, or the approved spec changes unexpectedly;
- reusable canary, Finance, balances, event evidence, launch policies, conversion cursor/state, or reconciliation differs unexpectedly;
- an exact ACL cannot be pinned safely or a privileged RPC would need browser/service-role leakage;
- the one migration cannot remain fully transactional or would require rewriting migration history;
- a second wallet, escrow, revenue account, Ledger, Campaign Finance, Spend, Settlement, event, audit, launch, pricing, or materialization authority would be required;
- rate applicability can overlap, null scope remains ambiguous, or publication could backdate into existing events;
- no-back-billing depends on a historical backfill rather than immutable cutover/function constraints;
- active pending double-counts charged Spend, includes CLOSED/expired windows, hides negative availability, or can exceed remaining Finance without a fail-closed anomaly;
- the classifier would move money, call Spend, or process anything other than new impression/click inserts;
- server-side rate/objective/mode/window resolution cannot fully determine the amount;
- mode transitions cannot serialize every gated mutating RPC with the shared lock order;
- real separate-session races cannot establish only the two legal serial outcomes, or any deadlock/partial accounting/stale-mode commit is observed;
- CANARY_BILLING caps mix Finance.spent into the window-local pending+charged cap;
- PRODUCTION can open without complete global coverage, or safe DISARMED zero-rate state produces a reconciliation failure;
- Settlement could return funds anywhere except the original source, or zero-residual settlement semantics would need replacement without a proven defect;
- lifecycle could mutate paused Campaigns or act outside automatic PRODUCTION;
- unexpected errors would be swallowed instead of producing cron FAILED;
- Admin authorization cannot reuse canonical capabilities/audit, or FINANCE_AUDITOR would need global `admin.audit.read`;
- Business/Admin would calculate authoritative charge amounts or expose launch controls;
- PLR-7B responsive truth or PLR-8 commerce/full-funnel behavior regresses;
- a new Supabase security/performance Critical/Warning caused by PLR-9 cannot be corrected in scope;
- production deployment would include more than the single migration or exact committed Business/Admin Versions;
- any native/Edge/Public change becomes necessary (`NATIVE CHANGE REQUIRED`), or any EAS build would be required;
- any real rate/window/mode/Spend/Settlement/Campaign/event/money mutation would be needed to make acceptance pass.

## Deployment and Final-State Invariant

Deployment order is strictly:

```text
exact pushed Git SHA
→ production precheck
→ one DB migration
→ DB postcheck
→ Business preview smoke
→ promote same Business Version
→ Admin preview smoke
→ promote same Admin Version
→ global postcheck
→ STOP
```

PLR-9 must end with migration count 298; `launch_mode = DISARMED`; every switch/placement false; zero published real rates; zero OPEN windows; zero active pending reservations; mode-aware reconciliation zero while production readiness may be false; reusable canary paused/funded 0.01/spent 0/released 0 with its historical impression/click unbilled; zero money moved; Edge unchanged; native files unchanged; and no EAS build.
