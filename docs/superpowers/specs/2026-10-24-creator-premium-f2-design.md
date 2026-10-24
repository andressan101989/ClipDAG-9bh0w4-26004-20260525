# Creator Premium F2 — Canonical BDAG Monetization Design

## Scope and invariants

F2 completes the Creator Premium commerce experience by extending the existing B1/B4/B4-C1/B7 authorities. It does not add a second wallet, ledger, escrow, checkout, entitlement system, subscription scheduler, or refund path. Production finance remains disabled (`purchase_enabled=false`, `subscription_enabled=false`, `refunds_enabled=false`, `platform_fee_bps=0`) throughout implementation and release.

Every monetary command remains server-side, atomic, idempotent, balanced, auditable, and bound to immutable price/fee/account snapshots. The client supplies only a target UUID and UUID idempotency key. Private media remains accessible only through the existing entitlement and signed-playback authorities. Content Safety P3/v2 and MEDIA-C1 are unchanged.

## Demonstrated baseline and gaps

B4 already provides atomic purchase, initial subscription, cancellation, full refund/reversal, exact fee splitting, ledger binding, immutable receipts/periods, and Finance policy gates. B7 already provides commerce, library, subscription, earnings and administrative refund projections.

The missing F2 behaviors are:

1. a subscription relationship cannot add a later paid period; the canonical subscribe RPC raises `creator_premium_subscription_renewal_not_implemented`;
2. the mobile client has a permanent local `false` finance gate in addition to the authoritative server policy;
3. ledger responses are accepted as generic objects instead of strictly validated receipts bound to the requested target;
4. a failed read-back can still lead the UI to announce success, and retry intent is not durably retained in memory;
5. buyer receipt/period history and read-only Premium administrative supervision are incomplete;
6. the profile shows a simulated earnings value derived from likes;
7. subscription-period refunds currently revoke the whole relationship, which is incorrect once multiple periods exist;
8. no exact Premium reconciliation projection reports receipt/period/transaction/entry mismatches;
9. legacy Premium handlers remain forbidden/undeployed but must stay demonstrably blocked;
10. the direct-credit model cannot promise that every future refund is fundable. F2 must report a failed refund safely when creator/platform source balances are insufficient; it must not invent escrow or pending settlement.

## Canonical command model

The deployed `bdag-ledger` remains the single client-facing mutation gateway. Existing actions remain unchanged:

- `creator_premium_purchase` → `purchase_creator_premium_content_v1`;
- `creator_premium_subscribe` → `subscribe_creator_premium_plan_v1` for both initial purchase and explicit manual renewal;
- `creator_premium_cancel_subscription` → `cancel_creator_premium_subscription_v1`.

There is no automatic renewal and no new cron. A manual renewal is eligible only when the plan family has no valid active paid period for that subscriber. It uses a new UUID idempotency key, the currently selected active plan version, that version's price snapshot, the current Finance policy snapshot, and a new immutable period/transaction. A replay with the same key returns the same period with `money_moved=false` and `replayed=true`. Reusing a historical B4 key against another plan is a stable idempotency conflict. An overlapping period (including across versions of one `plan_key` family), retired plan, self-subscription, restriction, invalid content mapping, stale target, or Finance OFF is rejected before money moves.

Each paid period/renewal receives a new immutable subscription relationship row. The current global uniqueness on `(subscriber_id, plan_id)` becomes a partial uniqueness rule for open relationships only. The server additionally serializes the subscriber+creator+`plan_key` family with the same version-family lock used by plan activation. An active or cancelled relationship whose paid period has ended is terminalized as `expired`; a new relationship and period are then inserted. This avoids reactivation ABA races and cross-version double charges, preserves every start/cancel/refund idempotency key, and makes each relationship row the lifecycle evidence for exactly one paid period. A retired plan cannot renew; migration to a new plan version requires an explicit new selection after the prior family period ends and is not automatic.

## Refund and access semantics

Purchase refunds revoke only the purchase receipt entitlement. Subscription refunds revoke only the selected immutable period and its one-period relationship. A later renewed relationship is a distinct row and remains untouched. Refund commands remain total-period/full-receipt because partial refunds are not represented safely by B4 and are not invented in F2.

Refunds remain governed by `refunds_enabled` plus the write capability. The direct-credit model debits creator and platform source accounts during reversal. Insufficient source balance produces a stable failure with no partial movement, no entitlement revocation, and no false administrative success. Guaranteed refunds/pending settlement require a separately authorized escrow/reserve design.

Creator withdrawal retires the individual offer and closes new acquisition. It does not revoke a verified purchase receipt. An active subscription period retains access only when that period began before the withdrawal timestamp; later plan-version subscriptions cannot acquire the withdrawn item. Safety removals, quarantine and deletion remain unavailable. The buyer library includes only these verified acquired-right cases.

## Read models

Authenticated buyer projections expose only the caller's immutable purchase receipts, subscription periods, refund state, exact decimal strings, and safe content/plan labels. They never expose accounts, private media locators, ledger metadata, or another user's records.

Creator earnings continue to derive from validated financial facts. F2 adds explicit policy state, range/cursor semantics, and truthful labels. The creator's general BDAG ledger balance may be shown only as a separately labelled account balance; it is not called Premium available earnings. Pending Premium payout is `not_applicable` under the direct-credit model, never a fabricated amount.

Administrative Premium supervision is read-only under an existing financial read capability and returns sanitized receipt/subscription/period/refund/reconciliation summaries. Refund mutation remains separately protected by `creator_premium.refunds.write` and Finance policy. Read access does not imply refund authority.

The reconciliation RPC is read-only and reports counts of invalid financial bindings, missing transactions/entries, unbalanced Creator Premium facts, entitlement mismatches, duplicate active grants, and policy state. It never repairs data.

## Client safety

The client removes the permanent local Finance availability boolean and renders the authoritative `policy`, `operations`, and blockers returned by Supabase. This does not enable finance: production remains blocked twice, by the read projection and by B4 inside the transaction.

Purchase, subscription/renewal, and cancellation parse strict receipts. Commerce, subscription pages and financial history are also exact-schema projections. UUIDs, exact decimal strings, booleans, state, timestamps, cursors, operation/blocker invariants and requested target bindings are mandatory. Unknown, partial, or contradictory responses fail closed. After a successful command the UI requires authoritative read-back. If read-back is ambiguous, it keeps the same in-memory idempotency key for retry and says the operation is awaiting verification; it does not announce success or issue a fresh charge.

All simulated earnings copy is removed. Finance OFF copy is driven by server policy. The existing Figma/component language is retained; no new visual system is introduced.

## Security and release

New/modified RPCs use `SECURITY DEFINER`, `search_path=''`, explicit `auth.uid()` or service-role/internal authority checks, least-privilege grants, locks, deterministic ordering, bounded pagination, exact numeric text, and no private locator output. Private tables remain RLS + FORCE RLS and revoked from client roles.

The release governance allowlist/hashes and negative evidence are updated for every changed authenticated `SECURITY DEFINER` RPC. The one forward-only migration is HIGH risk. Canonical release is `plan_only → gate_proof → fresh OFF + completed backup → RELEASE_HIGH_RISK → postcheck`; no production release occurs without those gates. Finance flags and fee remain OFF/zero before and after release.
