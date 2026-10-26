# Creator Premium F5 — Autonomous Subscriptions and Watermark Removal Design

## Status

Approved for implementation by the owner on 2026-10-26. This document narrows the supplied F5 specification into the existing F4 architecture; it does not authorize production test charges or retroactive enrollment.

## Verified baseline

- Source: `origin/main` `8b869746ea4bbc08fb79d42fe06f316849a7bfb9`, tree `9705fa6934b8c56c3a5320ffb55ffd18466e8ec5`.
- Production: Finance `general`, purchases/subscriptions/refunds enabled, fee `2000` bps, 355 migrations, `bdag-ledger` v46.
- Manual renewal authority: `public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text)` with family locks, durable idempotency journal, canonical BDAG charge composition and exact 80/20 split.
- No Premium automatic-renewal mandate, worker or cron exists. The subscription projection intentionally returns `auto_renew=false`.
- The visible `NELYON` mark is a React Native overlay rendered by `PremiumWatermark`; Premium media is uploaded and played without that component modifying provider bytes.

## Chosen architecture

### Explicit mandate, not a second payment authority

Add one private mandate per subscriber/creator/plan family. Enabling it is an explicit, authenticated, server-side command routed through the existing `bdag-ledger` Edge function. The mandate pins the authorized plan id, plan version, exact BDAG price, billing days and current paid-through timestamp. Existing subscriptions receive no rows and therefore remain manual until the subscriber opts in.

The mandate state machine is `ENABLED -> PAUSED|REVOKED`; a user may explicitly consent again from either terminal state, which advances a generation and records a new immutable commercial snapshot. Silent price/version changes never update consent.

### One bounded database worker

One private `postgres`-owned worker runs from one exact `pg_cron` job every five minutes. It selects a bounded number of due mandate ids, acquires the existing subscription-family advisory lock before row locks, and revalidates mandate generation, due time, plan snapshot, Finance GENERAL/2000, actor/account eligibility and latest paid period.

The worker calls `public.subscribe_creator_premium_plan_v1(..., 'creator-premium-f3-v2')`. It never composes ledger entries itself. A deterministic UUID per mandate generation and due slot reuses the existing command journal. If a concurrent manual renewal wins, the worker adopts the verified new period without charging again.

### Durable outcomes and bounded retries

An append-only attempt table records sanitized outcomes. A failed charge is isolated in a PL/pgSQL exception block so financial writes roll back while the outer worker records the result. Insufficient balance and retryable technical failures never create debt or a paid period. Retries use bounded backoff and pause after three attempts. Permanent blockers—revocation, plan retirement, price/version drift, creator/account restriction, invalid financial binding or Finance not GENERAL—pause immediately and require explicit user action.

### Concurrency and cancellation

Automatic renewal, manual renewal and cancellation share the existing family advisory key. Cancellation atomically revokes the open mandate and preserves the already-paid period. A refund of the mandate's current period pauses the mandate; refunding an older period does not affect a newer paid period. All row locking follows family lock, then period, relationship and mandate where applicable.

If automatic renewal wins immediately before an exact-id cancellation of the expired relationship, cancellation never retargets a different relationship silently. It revokes the matching consent generation, preserves the newly paid period, and returns the explicit no-money effect `future_renewal_revoked_after_race`. Its immutable command replay cannot revoke a later re-consent generation.

### Projection and UI

The authenticated v2 subscriptions projection gains a strict `auto_renewal` object: state, consent timestamp, next charge, authorized price/version, retry count and safe last result. The legacy v1 shape remains unchanged. Client parsers retain exact-key validation.

The existing subscriptions screen gains an explicit toggle, server-confirmed ON/OFF state, next-charge copy, and insufficient-balance/re-consent messages. Manual renewal and cancellation remain available according to server truth. The offer screen explains that automatic renewal is optional; initial purchase does not silently opt in.

### Watermark

Remove the `PremiumWatermark` import/render and its pseudonymous marker generation from the Premium viewer, then delete the now-unreferenced component. Keep screen-capture protection, signed playback, entitlement checks, opaque covers and private media behavior unchanged. No provider media is downloaded, reencoded or altered.

## Security and ownership

- New private tables use RLS and FORCE RLS, owner `postgres`, no client table grants and no permissive policies.
- Public money-moving functions remain service-only; the new consent command is called only by `bdag-ledger` with the authenticated user id derived from JWT.
- Worker/claim functions are private, owner `postgres`, empty `search_path`, and revoked from `PUBLIC`, `anon`, `authenticated` and `service_role` unless a service-only entry point is explicitly required.
- Finance remains GENERAL at 2000 bps. P3 and MEDIA-C1 are untouched.

## Release governance

F5 introduces an attested finance phase `f5_autonomous` with the only allowed transition `f4_general -> f5_autonomous`. The protected manifest is exactly one forward-only migration plus `bdag-ledger`; its config is unchanged. Snapshot validation permits exactly one new active cron job with the reviewed name, schedule, database, username and command digest while rejecting removals, duplicates or other cron drift.

The release itself must leave the mandate and attempt tables empty, preserve the existing real subscription, and move zero BDAG. Expected post-release state is 356 migrations, 34 active Edge functions, a new `bdag-ledger` version, Finance GENERAL/2000, P3 and MEDIA-C1 unchanged.

## Rejected alternatives

- A second renewal Edge/scheduler: duplicates the existing database and finance authorities.
- Direct ledger construction in cron: would create a second payment authority.
- Automatic enrollment of existing subscriptions: lacks explicit consent.
- Pre-creating future periods: grants access before successful payment.
- Updating the mandate automatically after a price change: charges an unapproved amount.
- Reencoding historical media: unnecessary and destructive because the observed mark is an app overlay.

## Success criteria

All mandated disposable PostgreSQL, client, Edge, watermark, governance and regression tests pass; the protected release and baseline promotion complete; production has the exact F5 cron with zero mandates and zero release-time charges; final plan reports no productive changes.
