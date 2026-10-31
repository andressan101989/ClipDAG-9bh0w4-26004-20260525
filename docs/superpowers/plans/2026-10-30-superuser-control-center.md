# Superuser Control Center implementation plan

> Execute only in `D:\CodexWorktrees\ClipDAG\superuser-control-center` on branch `codex/superuser-control-center`. Preserve the primary checkout, all other worktrees, stash entries and unrelated files.

## Task 1: Pin baseline and add RED contracts

- Record origin/main SHA/tree, Admin route count, migration/Edge inventory, policy digest, protected workflows and current production security facts.
- Add focused Admin Web tests for hierarchy, breadcrumbs, command search keyboard behavior, dashboard states and theme.
- Add RED tests for stable auth refresh, authorization generation fencing, MFA enrollment/challenge and AAL2 presentation.
- Add RED contracts for persistent command idempotency, cursor pagination, Ads operational truth, least-privilege Premium refunds and control-center aggregates.
- Run every new test against the predecessor and retain the expected failures.

## Task 2: Build the shared desktop presentation layer

- Extend the canonical navigation inventory into the approved eight capability-filtered groups.
- Add breadcrumbs, persisted group state, keyboard-complete module search and an error boundary.
- Add reusable page header, stats, accessible chart, filters, search, date range, table, pagination, detail drawer and section-navigation components.
- Convert the global theme to white/navy/electric blue while preserving status semantics, visible focus and the existing responsive fallback.
- Do not add duplicate pages or a second UI library.

## Task 3: Make authentication stable and MFA-ready

- Refactor `AdminAuthProvider` so token refresh does not clear current authority or unmount forms.
- Add authorization generation fencing and stable expiry/error behavior.
- Implement Supabase TOTP enrollment, challenge, verify, list and unenroll UI with accessible recovery states.
- Add a versioned AAL2 policy for sensitive capabilities and enforce it in the canonical server guard while retaining AAL1 access to login, shell and enrollment.
- Verify that the existing Super Admin can enroll before sensitive actions require AAL2.

## Task 4: Guarantee idempotent administrative retries

- Add a shared logical-intent coordinator that keeps one UUID across uncertain retries and prevents overlapping submission.
- Correct user warnings first, then role assignment/revocation and equivalent content, LIVE and Battle actions.
- Preserve existing server idempotency and audit functions; do not create another command ledger.
- Test lost-response retry, input change, explicit cancellation, confirmed completion and double-click cases.

## Task 5: Complete server-side pagination and request fencing

- Add reusable cursor and debounced-search hooks.
- Migrate Users, Content, Stories, Reports, reported Chat, LIVE, Battles, Media, Access, Finance account/transaction/audit and bounded Ads lists that currently discard cursors.
- Preserve filters across navigation, reset cursors on material changes and ignore stale responses.
- Prove page boundaries and no full-dataset browser loads.

## Task 6: Deliver truthful dashboards and operational surfaces

- Add a bounded canonical control-center overview RPC only for aggregates absent from existing APIs.
- Rebuild the executive dashboard with real KPIs, time ranges, accessible charts, recent activity, alerts and independently truthful states.
- Add contextual module summaries by linking existing routes and APIs, not by duplicating them.
- Replace Ads prelaunch constants with canonical launch/runtime/funding/spend/settlement/canary facts.
- Add truthful integration/Creator Studio/ALGO-6/security status surfaces only where current authorities support them; unavailable providers stay non-actionable.

## Task 7: Enable the minimum safe Premium refund role

- Map `creator_premium.refunds.write` only to `SUPER_ADMIN` in the focal migration.
- Require AAL2 for that capability.
- Preserve the canonical refund RPC, confirmation, idempotency, audit and reconciliation UI.
- Use disposable synthetic records only; never execute a productive refund or balance mutation.

## Task 8: GREEN verification and independent review

- Run Admin Web Vitest, TypeScript, ESLint, production build, deployment tests and static control-center contracts.
- Run disposable PostgreSQL proofs for capabilities, AAL2, ACL/RLS, aggregate bounds and rollback.
- Repair the two obsolete A8 regex guards and other directly affected historical guards without weakening financial assertions.
- Run regressions for Premium, Wallet, Marketplace, Ads, Stories, LIVE, Content Safety, Media and Release Gate.
- Separate PASS, FAIL, SKIP and physical NOT TESTED.
- Complete independent UI/accessibility, security/SQL, data/API and final scope reviews; resolve every Critical/Important finding.

## Task 9: Desktop browser QA

- Exercise login, MFA, refresh, logout, navigation, expandable groups, breadcrumbs, dashboard, charts, filters, search, tables, cursors, dialogs, confirmations and denied states in a real browser.
- Capture evidence at 1280x720, 1440x900, 1920x1080 and ultrawide.
- Confirm keyboard navigation and visible focus.
- Do not execute financial, Ads rollout or destructive administrative actions.

## Task 10: Protected integration and canonical release

- Commit coherent focal changes, push the feature branch, open a protected PR and wait for checks/review.
- Rebase-merge without force and verify origin/main SHA/tree.
- Run fresh plan-only and require only the exact SQL/Edge/config/Admin bundle manifest justified by this plan.
- Run gate-proof, backup, snapshot and protected release; stop on drift, unsafe ACL/RLS, unknown Advisor delta or financial mutation risk.
- Deploy the Admin bundle through its canonical protected workflow and apply only the approved migration/configuration.

## Task 11: Postcheck, baseline and hand-off

- Verify project health, exact migrations/Edge/Admin bundle, capability mappings, AAL2 enforcement, audit, Finance GENERAL, Premium 20%, LIVE 35%, P3, Stories V2, MEDIA-C1, LIVE Battles and Ads/Marketplace preservation.
- Prove zero release-attributable BDAG movements, refunds, Ads spend or content mutation.
- Promote the fresh production baseline through a separate protected PR, synchronize the exact committed policy digest and verify readback.
- Run final plan-only and require `NO PRODUCTIVE CHANGES`.
- Produce the required consolidated implementation report with physical QA and external configuration status stated truthfully.
