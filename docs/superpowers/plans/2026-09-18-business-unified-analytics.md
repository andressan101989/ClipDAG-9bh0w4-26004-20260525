# BW-I Unified Business Analytics Implementation Plan

**Goal:** Deliver capability-scoped, server-aggregated unified business analytics at `/analytics` without introducing a parallel analytics or financial authority.

**Architecture:** Add one read-only Supabase RPC that owns UTC windows, aggregates canonical commerce data, and conditionally emits Ads, Finance, and Payouts sections after independent BW-J1 capability checks. A typed Business Web client and page render the response without client-side monetary aggregation.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, React 19, TypeScript, Supabase JS, Vitest/Testing Library, existing Nelyon Business CSS.

**Design spec:** `docs/superpowers/specs/2026-09-18-business-unified-analytics-design.md`

## Global constraints

- [ ] Keep `business.analytics.read` separate from Ads, Finance, and Payout capabilities.
- [ ] Preserve exact money as server-produced decimal strings; format only for display.
- [ ] Use one migration at most, no new tables, and no financial/history DML.
- [ ] Use the existing active-business context and prevent stale request writes.
- [ ] Produce one coherent final commit and a fast-forward push; no intermediate commits.

### Task 1: Define the typed Analytics client contract

**Files:**
- Create: `apps/business-web/src/lib/businessAnalyticsApi.ts`
- Create: `apps/business-web/src/tests/businessAnalyticsApi.test.ts`

- [ ] Write failing parser tests for `7d`/`30d`/`90d`, exact money strings, zero-filled series, optional unauthorized sections, and malformed payload rejection.
- [ ] Run `npm test -- businessAnalyticsApi.test.ts` in `apps/business-web` and confirm the expected missing-module/failing tests.
- [ ] Implement range/types/parser and `getBusinessAnalytics` wrapper using the existing Supabase client.
- [ ] Re-run the focused tests and confirm PASS.

### Task 2: Build the Analytics page behavior test-first

**Files:**
- Create: `apps/business-web/src/pages/analytics/BusinessAnalyticsPage.tsx`
- Create: `apps/business-web/src/components/BusinessAnalyticsTrend.tsx`
- Create: `apps/business-web/src/tests/BusinessAnalytics.test.tsx`
- Modify: `apps/business-web/src/styles/business.css`

- [ ] Write failing UI tests for KPIs, 7D/30D/90D changes, previous-zero neutral comparison, valid empty state, products/sources, section authorization, 25 global products with 20 displayed rows, loading/error retry, business switch clearing, and stale response suppression.
- [ ] Run the focused UI test and capture the expected failure.
- [ ] Implement KPI cards, accessible trend visualization, tables, optional sections, loading/empty/error states, and request identity protection.
- [ ] Re-run the focused UI test and confirm PASS.

### Task 3: Wire navigation and route authorization

**Files:**
- Modify: `apps/business-web/src/App.tsx`
- Modify: `apps/business-web/src/layout/BusinessLayout.tsx`
- Modify: `apps/business-web/src/tests/BusinessApp.test.tsx`

- [ ] Add failing app tests proving Analytics navigation/route require `business.analytics.read` and no optional capability grants route access by themselves.
- [ ] Run the focused app test and confirm failure.
- [ ] Add `/analytics`, reuse `BusinessRoute`, and enable the existing sidebar entry only for `business.analytics.read`.
- [ ] Re-run the focused app test and confirm PASS.

### Task 4: Add the minimal server-side read projection

**Files:**
- Create: `supabase/migrations/<timestamp>_business_unified_analytics_bw_i.sql`

- [ ] Use `npx supabase migration new business_unified_analytics_bw_i` to create the migration.
- [ ] Write transaction/rollback verification cases first for analytics-only, analytics+Ads, analytics+Finance, analytics+Payouts, full access, no analytics capability, revoked membership, cross-business request, manipulated business ID, UTC range sizing, previous-zero comparisons, and 25-global/20-row totals.
- [ ] Confirm the RPC is absent before applying the migration.
- [ ] Implement `get_my_business_analytics(uuid,text)` with exact capability gates, safe `SECURITY DEFINER`, `search_path=''`, fully-qualified references, exact decimal strings, and no financial mutations.
- [ ] Apply the migration to the authorized Supabase project.
- [ ] Run the rollback verification matrix and confirm all cases PASS.
- [ ] Recheck migration count/latest and security/performance advisors for new findings.

### Task 5: Regression and duplicate/orphan audit

**Files:**
- Modify tests only if a real regression requires an in-scope correction.

- [ ] Run the full Business Web suite, lint, and build.
- [ ] Run relevant Ads, Seller Center, BW-G, BW-H, Marketplace analytics, and Admin tests/builds.
- [ ] Run `rg` audits for duplicate analytics services/RPCs, client monetary aggregation, orphan imports/routes, and unauthorized optional payloads.
- [ ] Run `git diff --check`, inspect `git diff --stat`, and review every changed file.

### Task 6: Commit, push, and production-safe postcheck

- [ ] Read and apply verification-before-completion and finishing-a-development-branch guidance.
- [ ] Re-run mandatory precommit Git checks and confirm the remote base has not moved.
- [ ] Confirm production finance/withdrawal/ledger counts were not changed by BW-I and no chain/Stripe/Treasury action occurred.
- [ ] Create one commit: `feat(business): add unified analytics`.
- [ ] Push fast-forward to `origin/codex/superuser-ui-presentation-a2-a4` without force.
- [ ] Confirm local HEAD equals upstream and the worktree is clean.
- [ ] Deliver the required `BUSINESS-WEB-BW-I — FINAL REPORT` and stop before BW-J2.
