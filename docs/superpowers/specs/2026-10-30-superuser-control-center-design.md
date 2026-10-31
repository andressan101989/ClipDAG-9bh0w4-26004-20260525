# Superuser Control Center design

## Goal

Transform the existing Nelyon Admin Web portal into the desktop control center defined by the owner without replacing its route graph, capability authority, domain RPCs, financial authorities, or deployment workflows. The result must be truthful: every metric and action is backed by an existing canonical authority or a bounded new aggregate RPC; unavailable integrations are shown as unavailable and never simulated.

This design is already approved by the owner's `SUPERUSER-CONTROL-CENTER` specification. It is not a redesign of product behavior and it authorizes no financial transaction.

## Chosen approach

Three approaches were considered:

1. Rebuild the portal around a new component framework. Rejected because it would duplicate the 68-route portal and increase authorization and regression risk.
2. Apply a cosmetic theme over the current pages. Rejected because it would leave the demonstrated MFA, retry, pagination, session, Ads truth, and permission defects unresolved.
3. Extend the canonical portal with one desktop design layer, shared operational primitives, a bounded security migration, and existing domain APIs. Chosen because it satisfies the requested experience while preserving server authority.

## Canonical architecture retained

- Routing and authorization: `App -> AdminAuthProvider -> AdminRoute -> AdminShell -> CapabilityRoute -> page`.
- Role and capability authority: `private.admin_roles`, `private.admin_capabilities`, assignments, role mappings, and `private.admin_require_capability`.
- Domain data: existing Admin RPC and Edge authorities for Users, Creator Premium, Wallet, Marketplace, Ads, LIVE, Battles, Stories, Content Safety, Media, Audit, and System.
- Audit: the existing canonical administrative audit tables and functions.
- Finance: the existing Wallet BDAG, ledger, transaction, settlement, refund, and reconciliation authorities.
- Media and safety: MEDIA-C1, Creator Premium P3, Stories publish-first safety, and current signed-media authorities.
- Deployment: the protected Admin Web deployment and the canonical Supabase release workflow.

No second admin portal, analytics backend, audit stream, wallet, ledger, refund path, scanner, or release gate is introduced.

## Desktop information architecture

The existing route inventory is projected into capability-filtered groups:

- Vista general: executive overview, global statistics, recent activity, priority alerts.
- Usuarios y comunidad: users, creators, businesses, sellers, roles, reports.
- Contenido y seguridad: content, Stories, Premium, AI moderation, reported chat, media.
- LIVE y entretenimiento: LIVE sessions, Battles, gifts and score visibility.
- Marketplace: commerce summary, products, sellers, orders, disputes, payments and settlements.
- Publicidad: campaigns, review, analytics, billing, rollout and operational health.
- Finanzas: Wallet/ledger accounts, transactions, fees, Premium finance, reconciliation and anomalies.
- Sistema: health, jobs, audit, security and integration status.

Groups and links remain capability-derived. The current routes are reused; routes are added only for bounded cross-domain summaries or technical security enrollment that have no existing screen.

## Visual system

The portal uses a single desktop token set: white content surfaces, navy structure, electric-blue actions, accessible status colors, 1280 px minimum target, and comfortable layouts at 1440, 1920 and ultrawide widths. The existing mobile drawer remains as an accessibility fallback, but no mobile admin application is added.

Reusable primitives extend the current component set:

- page header and breadcrumbs;
- stat cards and accessible SVG/CSS chart panels with textual summaries;
- filter, search and date-range controls;
- cursor-aware data table and pagination controls;
- status, loading, empty, error and denied states;
- confirm dialog, detail drawer and section navigation;
- global error boundary.

No chart dependency is required. Charts receive server-derived series and expose equivalent labels and values to assistive technology.

## Executive and module dashboards

The executive dashboard requests only authorized, bounded data. A canonical overview aggregate supplies cross-domain counts and time-series that are not already returned by existing overview RPCs. Existing Marketplace, Finance, System, Ads, Premium and safety authorities remain the source for module details.

The dashboard distinguishes loading, denied, unavailable, empty and failed states. It never converts an absent response into zero, never labels failure as unauthorized, and never renders mock data. Time filters are passed to bounded server queries and stale client responses are fenced.

Module summaries link to the existing detail routes and show only actions supported by capability and server authority. External integrations such as Stripe and Banuba are represented as truthful non-actionable status when not active.

## Session, MFA and AAL2

Password login remains the first factor. The portal adds canonical Supabase TOTP enrollment, challenge, verification, factor management and recovery-safe UI. Read access remains available at AAL1 so an existing Super Admin is not locked out before enrollment.

A forward-only security policy maps sensitive write capabilities to AAL2. `private.admin_require_capability` keeps the existing capability check and additionally rejects mapped sensitive operations when the authenticated JWT is not AAL2. This centralizes enforcement for existing RPC callers without adding client-trusted authorization. Read capabilities and the MFA enrollment route remain accessible at AAL1.

The client refresh path keeps the authorized UI mounted while a token is refreshed, fences overlapping authorization generations, and never lets an older authorization response replace newer session state. A visible security status leads admins without a verified factor to enrollment; sensitive operations remain server-denied until AAL2.

Leaked-password protection is treated as an Auth project setting, not a SQL assertion. It is enabled only through the official project configuration and verified by readback; if the subscription or external configuration blocks it, the technical result is reported rather than simulated.

## Administrative command integrity

Every retryable privileged command receives one idempotency key per logical intent. The key survives an uncertain response and is replaced only when the operation is confirmed, cancelled, or its material inputs change. In-flight guards prevent double submission.

This is applied first to the demonstrated warning defect and then to equivalent role, moderation, LIVE and Battle commands. Existing server idempotency and audit functions remain authoritative.

Creator Premium refund authority is assigned only to `SUPER_ADMIN`, protected by AAL2 and the existing confirmation, canonical refund RPC, reconciliation and audit path. No refund is executed by implementation or test code.

## Pagination and request stability

All global lists that already return `next_cursor` retain and consume it. Shared hooks provide:

- server-side cursor pagination;
- reset on material filter changes;
- debounced search;
- generation fencing for stale responses;
- explicit loading, empty, error and retry states;
- bounded page sizes.

No page loads a full dataset into the browser. Existing cursor-capable Premium, Marketplace and Content Safety pages remain the reference implementation.

## Ads operational truth

Static prelaunch language is removed from operational pages. The UI derives launch, runtime, funding, spend, settlement, canary and rollout state from existing Ads authorities. Unknown or unavailable facts are shown explicitly. No campaign is started and no budget is consumed during implementation or QA.

## Database change

One forward-only focal migration may:

- add the versioned AAL2 capability policy and extend the canonical capability guard;
- map `creator_premium.refunds.write` only to `SUPER_ADMIN`;
- add a bounded read-only control-center overview RPC if existing aggregates cannot satisfy the requested dashboard;
- reassert owners, fixed search paths, ACL, RLS/FORCE RLS and canonical comments.

The migration must not modify balances, ledger entries, transactions, refund records, content, Ads runtime, or production rollout state.

## Testing and release

Each behavior is developed RED/GREEN. Tests cover navigation, accessibility, state truth, cursor pagination, stale-response fencing, idempotent retries, stable auth refresh, MFA enrollment/challenge, AAL2 server enforcement, least-privilege refunds, dashboard aggregates, Ads truth and regression of every existing module.

Disposable PostgreSQL proves ACL/RLS, AAL2, capability mappings and overview query bounds. Production verification is read-only until the protected release. Desktop browser QA covers 1280x720, 1440x900, 1920x1080 and ultrawide layouts.

Integration uses protected PRs and rebase merge. Release uses fresh plan-only, gate-proof, backup, snapshots, exact manifest, postcheck, a separate baseline PR, policy digest synchronization and a final `NO PRODUCTIVE CHANGES` plan. No financial operation is part of release verification.
