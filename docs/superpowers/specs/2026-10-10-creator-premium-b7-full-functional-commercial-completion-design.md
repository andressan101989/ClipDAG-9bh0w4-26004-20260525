# Creator Premium B7 — Full Functional & Commercial Completion Design

Date: 2026-10-10
Status: Owner-authorized implementation design
Working branch: `codex/creator-premium-b5-creator-management-ux`
Starting branch SHA: `bb152b138a477e4c9047863fb19d64d63fe9158c`
Canonical main SHA: `65ef157a1ff666b397b059e9aad048201c62068a`

## Intent

B7 closes the remaining Creator Premium code paths without activating
production commerce. It connects the B5 creator workflow to a human moderation
authority, exposes canonical offers and plans to consumers, connects the
already-existing B4 financial commands behind fail-closed product and database
policy gates, exposes real subscriptions, adds tightly authorized refund
administration, and derives creator earnings and analytics from canonical B4
facts. B6 remains the only protected consumer viewer.

The production state remains immutable during B7 development:

- `purchase_enabled = false`
- `subscription_enabled = false`
- `refunds_enabled = false`
- `platform_fee_bps = 0`
- no Premium financial transactions or real Premium content fixtures
- no database migration or Edge Function deployment
- no EAS build or update

The code is activation-ready, not production-activated. Store-policy approval,
an owner-selected fee, explicit finance-switch activation, and physical mobile
validation remain separate future decisions.

## Scope Rulings

1. B7 uses at most one forward-only migration and creates no second Premium,
   finance, entitlement, media, report, or moderation domain.
2. Human review is a narrow extension of the current Admin Web capability and
   immutable `private.admin_action_audit` authorities.
3. Creator self-publication remains impossible. Creators may submit and reopen
   rejected work; only an authorized admin may publish.
4. Consumer prices are read from immutable active offers/plans. The client
   never supplies a price, fee, creator, account, or transaction identity.
5. B4 purchase, initial subscription, cancellation, and full-refund functions
   remain the financial authority. B7 adds no renewal engine, partial refund,
   debt, negative balance, escrow, or payment provider.
6. Refund execution is exposed only through audited admin wrappers protected by
   a new explicit WRITE capability. That capability is inserted but assigned to
   no role by B7; activation requires a later owner-approved role grant.
7. The static Admin Web build required by the acceptance suite is allowed. The
   macro's "NO BUILD" prohibition is interpreted as no EAS/native production
   build, consistent with its explicit requirement to run the Admin Web build.
8. No approved B7 Figma node exists in repository evidence. B7 reuses current
   Nelyon tokens and existing admin/mobile layouts.

## Existing Authorities Reused

### Premium domain

- `private.creator_premium_contents`
- `private.creator_premium_offer_versions`
- `private.creator_premium_plans`
- `private.creator_premium_plan_contents`
- `private.creator_premium_purchase_receipts`
- `private.creator_premium_subscriptions`
- `private.creator_premium_subscription_periods`

### Money and entitlement

- `public.ledger_accounts`
- `public.financial_transactions`
- `public.ledger_entries`
- B4 purchase/subscription/cancellation/refund RPCs
- `private.resolve_creator_premium_entitlement_v1`
- B6 entitlement revalidation and protected viewer

### Admin and safety

- `private.admin_capabilities`
- `private.admin_role_capabilities`
- `private.admin_action_audit`
- `public.admin_actor_has_capability`
- `public.admin_require_capability`
- `public.reports`
- existing Admin Web shell, capability routes, and report center

### Media

- B2 R2 teaser/original links and `get-media-url`
- B3 Cloudflare Stream links and `get-stream-playback`
- no public original URL and no permanent Premium Stream playback URL

## Canonical Lifecycle

The content lifecycle becomes:

```text
draft
  -> pending_review
  -> published

pending_review
  -> rejected

rejected
  -> draft          (creator explicitly reopens for correction)
  -> pending_review (authorized admin restore/re-review)

published
  -> quarantined
  -> removed

quarantined
  -> removed
  -> pending_review

removed
  -> pending_review
```

`deleted` remains the B5 terminal draft-discard state. No B7 creator RPC can
write `published`, `quarantined`, or `removed`.

The canonical content row gains current-review metadata only:

- `submitted_at`
- `reviewed_at`
- `reviewed_by`
- `review_reason`

Full decision history remains in immutable `private.admin_action_audit`; B7 does
not add a parallel moderation-history table. Constraints bind each lifecycle
state to the appropriate timestamps and bounded reason. Production has zero
Premium rows, so no data backfill is necessary.

Submission records `submitted_at`. A rejected creator can call one explicit
reopen RPC, which revalidates ownership, age, account state, locks the row,
returns it to `draft`, and clears only current-review metadata. The audit trail
is never erased.

## Publication Readiness

Admin approval is not a blind status update. Inside the same locked transaction
it rechecks:

- creator age eligibility and operational state;
- public teaser and canonical private original readiness;
- signed-provider proof for video and absence of permanent playback URLs;
- one immutable active BDAG offer for purchase access;
- at least one active creator-owned mapped plan for subscription access;
- exact content/creator ownership of all commercial records;
- non-deleted, non-restricted current state.

B5 submission may use a draft plan so the creator can prepare the review set.
B7 publication requires the mapped plan version to be active. This preserves
the intended sequence: submit content, activate a plan containing pending
content, then approve content.

## Admin Moderation Authority

B7 adds two content-specific capabilities:

- `creator_premium.review.read`
- `creator_premium.review.moderate`

They are granted to existing `SUPER_ADMIN`, `PLATFORM_ADMIN`, and `MODERATOR`
roles because those roles already hold corresponding generic content review
authority. B7 does not broaden Support or finance roles.

Admin RPCs are authenticated `SECURITY DEFINER`, have `SET search_path = ''`,
derive the actor from `auth.uid()`, require exact capabilities, use transaction
advisory plus row locks, cap pagination, and revoke default execution.

The review surface uses:

- a keyset-paginated safe queue projection;
- a safe detail projection containing public teaser, media readiness, creator,
  active commercial facts, report counts, and admin history;
- one idempotent decision RPC accepting `approve`, `reject`, `quarantine`,
  `remove`, or `restore`;
- immutable action-audit rows with request fingerprints and no private media
  locators.

Admin restore routes restricted content to `pending_review`; it does not
silently republish. A separate approve action must revalidate all conditions.
Concurrent decisions serialize on the same content lock. A repeated key with
the same fingerprint returns the original result; a changed command conflicts.

## Administrative Media Inspection

Admin detail never contains an R2 object key, bucket, Cloudflare UID, permanent
private URL, or signed URL. Two existing Edge Functions gain one narrow context:

```json
{ "premium_content_id": "uuid", "admin_review": true }
```

The caller JWT must be valid and `admin_actor_has_capability` must confirm
`creator_premium.review.read`. The function then resolves the canonical content
link server-side and issues the same bounded 300-second private grant used by
B2/B3. Grants are held only in Admin Web component memory, use no-store headers,
and are cleared on unmount/content change. Normal B6 entitlement paths remain
unchanged. No new Edge Function is created or deployed in B7.

## Reports and Safety

`public.reports.reported_content_type` is extended with
`creator_premium`. A narrow authenticated reporting RPC:

- derives reporter identity from the JWT;
- accepts only a published Premium `content_id`;
- rejects creator self-reporting and inaccessible/restricted subjects;
- validates an enumerated safety reason and bounded plain-text details;
- inserts no signed URL, object key, asset ID, provider ID, or original bytes;
- prevents duplicate open reports by the same reporter and content.

Existing admin report search/detail projections learn the new type. The detail
shows safe metadata and public teaser only, requires both report-read and
Premium-review-read capabilities, and links to the canonical Premium review
surface. No second report center or unverified private-media scanner is added.
The existing Content Safety/report operational domain remains the authority;
B7 does not pretend that the current scanner supports a new private target type.

## Consumer Commerce Projection

One authenticated content-detail RPC extends, rather than duplicates, the
catalog authority. Input is only `content_id`. Output contains:

- safe published metadata and public teaser;
- current entitlement state;
- immutable active purchase offer price/currency/version when applicable;
- active applicable plans with exact price strings, version, and period days;
- current relationship status and paid-through time when applicable;
- server policy booleans;
- server-derived operation availability.

The projection repeats all B1 account, age, block, published-state, media, and
creator-operational checks. It never exposes private media or financial account
identifiers.

A new mobile offer route receives only `contentId`. The creator-profile grid
navigates locked content there; entitled content continues to B6. The route
shows exact server prices, period days, access type, policy status, and honest
disabled actions. It has stable per-attempt UUIDs and a busy barrier, but calls
the ledger only when both the compile-time product gate and server policy allow
the operation.

`CREATOR_PREMIUM_FINANCE_AVAILABLE` remains `false`, so current builds cannot
invoke purchase or subscription even if server data is malformed. Server policy
is the second independent gate.

## Financial Client Idempotency

`services/financial/ledgerClient.ts` remains the sole generic client. Its three
Premium commands gain an optional caller-generated UUID idempotency key. The
client validates it and sends no amount, price, fee, creator ID, account ID, or
transaction ID. UI stores an attempt UUID only in component memory so ambiguous
network retries reuse the same command identity. Other ledger actions preserve
their current behavior.

## Subscriptions

A bounded authenticated projection lists the current user's canonical
relationships and paid periods. It returns safe creator/plan metadata, exact
gross price strings, billing-period days, relationship status, cancellation
time, paid-through time, period access state, and a derived `access_active`.

`app/my-subscriptions.tsx` is rewritten to remove fake monthly billing, DM
quotas, perks, subscriber counts, and synthetic totals. It shows real rows,
supports refresh/pagination/retry, and allows B4 cancellation. Cancellation
moves no money and preserves access until the paid period ends.

B7 does not implement renewal. B4 explicitly returns a stable
renewal-not-implemented response for expired relationships; no safe recurring
or manual-renewal authority exists. The UI truthfully shows expiry and leaves
renewal unavailable.

## Refund Administration

B7 adds `creator_premium.refunds.write` as a sensitive WRITE capability. It is
not inserted into any role-capability mapping. This avoids silently granting a
new financial power to existing admins.

Two audited admin wrappers accept only the canonical receipt/period UUID,
reason code, and UUID idempotency key. They:

1. derive and validate the admin actor/capability;
2. lock the command identity and target;
3. bind a SHA-256 request fingerprint;
4. call the existing B4 full-refund RPC in the same transaction;
5. write an immutable financial-effect admin audit row;
6. return a bounded receipt without balances/account IDs.

The B4 internal finance-authority helper is extended narrowly to recognize a
Postgres-owned definer call only when an authenticated actor currently has the
exact `creator_premium.refunds.write` capability. Direct `anon`/`authenticated`
execution on B4 refund functions remains revoked. The underlying B4 policy,
binding, sufficient-source, ledger, reversal, idempotency, and entitlement
revocation logic remains unchanged.

The Admin Web renders refund controls only when the actor holds the write
capability and `refunds_enabled` is true. Production therefore has three closed
gates: no role assignment, database policy false, and no deployment.

## Creator Earnings and Analytics

One authenticated creator summary RPC derives all values from canonical facts:

- purchase receipts and subscription periods;
- original and reversal `financial_transactions`;
- bound ledger state validated by B4 helpers;
- relationship and content lifecycle rows.

Amounts are returned as exact decimal strings. The UI performs no accounting.
The response includes gross, platform fee, creator net, refunds/reversals, net
retained, completed purchase/period counts, active/revoked subscription counts,
content lifecycle counts, bounded recent transactions, and direct-purchase
performance per content.

Subscription revenue is not fabricated per content because one plan period may
grant several contents. Per-content subscription metrics are limited to
verifiable active grant counts. Views, conversion rates, and uninstru­mented
engagement are explicitly absent. Empty production data yields a true zero/empty
state. No Premium balance or analytics table is created.

## Mobile and Admin UI

### Mobile

- `app/creator-premium-offer/[contentId].tsx` presents the safe commerce detail,
  report action, and disabled-or-operational purchase/subscription controls.
- `app/my-subscriptions.tsx` becomes a real canonical subscription manager.
- `app/creator-monetization.tsx` gains an `Ingresos` tab backed by the canonical
  summary and adds rejected/reopen states.
- `app/creator/[id].tsx` sends locked cards to the offer route and entitled cards
  directly to B6.
- `_layout.tsx` registers the offer route.

### Admin Web

- one Creator Premium queue/detail surface is added to the existing shell;
- capability routes and navigation use the existing architecture;
- decision buttons are state- and capability-specific;
- review grants remain ephemeral;
- refund controls are separately capability/policy-gated;
- reports link to the same Premium detail, not a second reviewer.

All surfaces use existing Nelyon tokens, accessible states, loading, empty,
error, retry, responsive layout, and confirmation for sensitive actions.

## Security and Database Contracts

- All new public RPCs revoke `PUBLIC`, `anon`, `authenticated`, and
  `service_role` first, then grant only the required role.
- Private helpers have no Data API execution grant.
- Every new definer has `SET search_path = ''` and fully qualified references.
- Private tables retain RLS plus FORCE RLS and no client table privileges.
- Mutation RPCs use deterministic transaction advisory locks plus row locks.
- Admin decisions and refunds use immutable idempotency fingerprints.
- Pagination is keyset-based and capped at 100.
- Decimal finance data is numeric in Postgres and text at the client boundary.
- No private URL appears in database projections, navigation, logs, reports,
  analytics, persisted state, or audit metadata.

## Store-Policy Activation Blockers

Creator Premium sells digital content consumed inside the app. Current official
store rules require a separate activation design:

- Apple App Review Guideline 3.1.1 generally requires In-App Purchase for
  unlocking in-app digital content, subject to region/program exceptions.
- Google Play Payments policy generally requires Play Billing for digital goods
  and content in Play-distributed apps, subject to current regional programs and
  exceptions.
- BDAG/token treatment, restoration, refunds, price parity, regional links,
  reporting, fees, and server verification require legal/store review.

Sources audited on 2026-10-10:

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/
- https://support.google.com/googleplay/android-developer/answer/9858738
- https://support.google.com/googleplay/android-developer/answer/10281818

B7 does not add StoreKit, Play Billing, an alternative billing program, or an
external-purchase CTA. Those require explicit owner authorization. The finance
UI remains fail-closed until those decisions and the server policy are resolved.

## Verification Strategy

Development is TDD-first:

1. static migration/security contracts fail before SQL exists;
2. disposable PostgreSQL tests prove lifecycle, locks, permissions,
   idempotency, reporting, projections, B4 finance gating, atomic charges and
   refunds with rollback;
3. Edge contract tests prove normal B6 behavior and new admin-review grants;
4. Admin Web tests prove capability, safe projection, action, refund, and
   private-media handling;
5. mobile tests prove canonical prices, two finance gates, stable retry keys,
   real subscriptions/earnings, reporting, and B6 handoff;
6. B1–B6, ledger/economy, media/Stream/security, C2, TypeScript, ESLint,
   Admin Web static build, diff-check, and global-suite comparison run before
   completion.

Physical Android/iOS commerce and protected-viewer validation remains PENDING
until a later integral build. No static test may be reported as physical PASS.

## Explicitly Not Implemented

- production finance activation or fee selection
- automatic or manual subscription renewal
- partial refunds
- StoreKit / Google Play Billing / alternative billing
- sexual-explicit monetization
- creator self-publication
- public original media or public Stream playback
- second moderation, report, analytics, finance, or entitlement system
- production migration, Edge deployment, EAS build/update, or main integration
