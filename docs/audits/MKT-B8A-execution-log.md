# MKT-B8A Web Admin Foundation + Marketplace Read-Only Ops

## Execution identity

- Branch: codex/mkt-a4b-premium-integration
- Starting SHA: 58b3d8729fffde6a8f697e5999f93bc2ec08b592
- Build: 22
- Starting remote migration: 20260811027000
- B8S prerequisite: read-only remote audit passed; protected user_profiles.is_admin, trigger, column grants, helper, fixtures, failure hooks, and inherited reconciliations were healthy.
- B8A migration: 20260811028000_marketplace_admin_web_foundation.sql

## Web architecture

B8A is an isolated Vite 7.1.3, React 19.1.1, TypeScript 5.9.2 application at apps/admin-web. Root Expo remains expo-router/entry; no admin route, page, or navigation was added under app/. No hosting deployment is part of B8A.

Browser configuration is limited to VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Production dependency audit reports zero vulnerabilities after pinning React Router DOM 7.18.2. No service role, database password, JWT secret, payment secret, private key, or bypass token exists in source or bundle.

## Authentication and authorization

Supabase Auth provides email/password login, persisted session restoration, token refresh, logout, and expired-session handling. Authentication is followed by get_my_marketplace_admin_access().

marketplace_require_admin() derives auth.uid(), delegates the canonical privilege decision to B8S-protected marketplace_actor_is_admin(), accepts no actor/admin ID, and has a fixed search_path=pg_catalog, public. The internal guard is not executable by anon or authenticated. Public B8A RPCs are executable by authenticated users but every payload path first passes the internal guard.

Disposable proof confirms:

- anonymous denied for all four B8A RPCs;
- ordinary authenticated user denied;
- JWT user/app metadata is_admin=true denied;
- B8S direct INSERT/UPDATE escalation remains denied;
- protected admin succeeds;
- no public admin setter or B8A mutation authority exists.

## Read-only RPC contracts

- get_my_marketplace_admin_access() returns safe display identity, admin=true, and marketplace:read.
- get_marketplace_admin_overview(p_range) accepts server-validated 7d, 30d, 90d, or all.
- search_marketplace_admin_orders(...) supports bounded query/status/range/store/source filters and keyset pagination by (created_at,id). Default 50; hard maximum 100.
- get_marketplace_admin_order_detail(p_order_id) returns one assembled order trace.

All functions are stable/read-only projections. The migration contains no Marketplace, ledger, financial transaction, settlement, allocation, dispute, or reversal mutation.

## Financial semantics

Overview and order detail read canonical facts:

- order/payment gross from marketplace_payments and marketplace_payment_allocations;
- creator GMV and generated commission from B7F item allocations;
- released creator commission from settlement legs;
- reversed creator commission from B7R reversal legs;
- order state, shipment, dispute, settlement, and reversal from their canonical tables.

No current BPS multiplication, seller-payout formula, client GMV authority, or browser financial arithmetic exists.

## Overview metrics

Commerce: orders, paid orders, paid GMV, units, pending fulfillment, shipped, delivered, refunded orders, reversed orders/gross.

Marketplace state: approved sellers, active stores, active published products, products requiring attention.

Creator commerce: attributed orders, item-level attributed GMV, generated/released/reversed/net commission.

Operations: open disputes and held payment allocations.

Disposable exact fixture result: 3 orders, 3 paid, 150 BDAG GMV, 4 units, 2 creator-attributed orders, 120 item-level creator GMV, generated 14, released 12, reversed 12, net 0.

## Order search and pagination

The list is assembled in one server RPC. It includes safe buyer/seller display names, store, canonical amount, payment/fulfillment/settlement state, dispute/reversal flags, and creator source surfaces. A (created_at desc,id desc) index supports the global cursor. The proof walks page size 1 through three orders with no duplicates or skips, validates filters, and rejects limit 101.

## Order detail and privacy

One RPC returns order, safe buyer/seller/store identity, immutable items, payment/allocation, shipping, creator snapshots and allocations, settlement/legs, dispute, reversal/legs, and timeline.

PII is minimized. List results contain display identity only. Detail includes the fulfillment address required for operational support but omits phone and all auth/email/token data. No wallet private material or secrets are returned.

Multi-creator proof produces one 100 BDAG order with Feed Creator X and Reel Creator Y lines: seller 78, platform 10, X 5, Y 7. Each item retains its source entity, item GMV, allocation, settlement leg, and reversal leg. A separate existing-LIVE-path order proves LIVE source identity and 2 BDAG creator allocation.

## Index audit

Existing unique/indexed joins already cover order payment allocation, payment, settlement, shipment, reversal, and creator item lookup. Added only:

- marketplace_orders_admin_created_idx(created_at desc,id desc) for global keyset order browsing;
- marketplace_order_disputes_order_created_idx(order_id,created_at desc) for bounded order dispute history lookup.

No N+1: overview one RPC, list one RPC, detail one RPC.

## Web experience

Routes are /login, /marketplace, /marketplace/orders, and /marketplace/orders/:orderId. The desktop-first responsive shell provides only Marketplace Overview and Orders, current admin identity, logout, loading, denied, empty, error, retry, filter, pagination, and trace states. It contains no B8B mutation controls.

## Blockers and resolutions

### B8A-01 — cursor emitted a terminal continuation

- STAGE: disposable pagination proof
- ERROR / SQLSTATE: assertion failure, terminal request returned zero rows
- SYMPTOM: a full final page emitted a cursor even when no later row existed.
- ROOT CAUSE: the first query fetched exactly p_limit, so it could not distinguish a full terminal page from a nonterminal page.
- CLASSIFICATION: pagination defect
- SOLUTION: fetch p_limit+1, return only the first p_limit, and emit a cursor only when the extra row proves continuation.
- WHY THIS IS SAFEST: deterministic keyset pagination remains bounded without a separate count or offset scan.
- FILES/FUNCTIONS CHANGED: B8A migration, search_marketplace_admin_orders.
- PROOF: page-size-one traversal returns every order once, with no duplicate, skipped, or empty continuation page.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: ordinary snapshot changes between independent read pages.
- STATUS: RESOLVED.

### B8A-02 — initial pinned Router release had production advisories

- STAGE: web dependency audit
- ERROR / SQLSTATE: npm production audit reported React Router advisories.
- SYMPTOM: initial react-router-dom 7.8.2 pin was within affected ranges.
- ROOT CAUSE: the security advisory postdated that pinned release.
- CLASSIFICATION: dependency security
- SOLUTION: pin react-router-dom 7.18.2 and regenerate the lockfile.
- WHY THIS IS SAFEST: patched production dependency without floating versions or framework changes.
- FILES/FUNCTIONS CHANGED: admin-web package metadata and lockfile.
- PROOF: npm audit --omit=dev reports zero vulnerabilities; web build and routing tests pass.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: normal future dependency maintenance.
- STATUS: RESOLVED.

### B8A-03 — B8S phase-local source assertion became stale

- STAGE: full root Node suite
- ERROR / SQLSTATE: one static assertion failed; no runtime SQL failure.
- SYMPTOM: the frozen B8S test still required apps/admin-web not to exist.
- ROOT CAUSE: that assertion guarded B8S scope before B8A was authorized, but encoded a phase-local absence rather than the durable mobile-boundary invariant.
- CLASSIFICATION: source-test compatibility
- SOLUTION: retain the B8S security checks and replace only the stale assertion with explicit denial of admin UI under Expo app/admin-web and app/marketplace-admin.
- WHY THIS IS SAFEST: B8S authority remains fully tested while B8A stays outside the mobile bundle.
- FILES/FUNCTIONS CHANGED: tests/marketplaceMktB8SAdminIdentityHardening.test.mjs.
- PROOF: root Node suite 673/673 and focused B8S/B8A tests pass.
- PRODUCTION ECONOMICS CHANGED: No.
- RESIDUAL RISK: None.
- STATUS: RESOLVED.

## Gate record

- Disposable B8A proof: passed; fixtures 0.
- Focused root static tests: 12/12.
- Web tests: 11/11.
- Web lint: 0 errors, 0 warnings.
- Web TypeScript/Vite build: passed.
- Pre-deploy remote audit: passed at migration 20260811027000, B8A absent, B8S and all inherited reconciliations healthy.
- Root Node suite: 673/673, 0 failed.
- TypeScript: exactly 187 pre-existing unrelated mobile diagnostics; zero B8A diagnostics and no baseline increase.
- iOS export: passed; Build 22; no EAS.
- Marketplace regressions: B3 passed; B7E healthy; B7D 18/18; B7C 28/28; B7B 23/23; B7A 36/36; B7F 27/27; B7R 32/32; disputes/refunds, order lifecycle, inventory/reservations, shipping, runtime, publication, and fixture finalization passed.
- Source/bundle safety: no browser service-role or private secret, protected raw-table write, admin mutation control, B8B authority, mobile admin route, historical migration change, financial formula change, or hosting configuration.
- Linked dry-run: exact migration 20260811028000_marketplace_admin_web_foundation.sql; seeds []; roles [].
- Deployment: exact B8A migration applied; no web hosting deployment.
- Post-deploy read-only audit: passed at 20260811028000; B8S healthy; four B8A RPCs/grants healthy; zero admin mutation functions; fixtures 0; failure hooks absent; escrow 71/71; all inherited reconciliations zero.

## Final status

MKT-B8A Web Admin Foundation + Marketplace Read-Only Ops is CLOSED. MKT-B8B is unblocked but has not been started.
