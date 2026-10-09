# Creator Premium B4 — Atomic Finance Authority Design

Date: 2026-10-08
Status: Owner-approved implementation specification
Base: `origin/main` at `e651aae40cc266e1bf98be4ffff7941973b4b759`

## Intent

Creator Premium B4 adds backend-only purchase, initial subscription,
cancellation, purchase refund, and subscription-period refund authority. It
reuses the canonical BDAG ledger tables and primitives; Premium tables store
commercial facts and immutable financial snapshots, never balances.

Production finance remains disabled. The migration seeds one private policy
row with purchase, subscription, and refund switches set to `false` and a fee
of zero basis points. B4 creates no production fixture and moves no production
BDAG.

## Selected Architecture

The trusted command chain is authenticated client → `bdag-ledger` → a
service-role-only Premium RPC → server-side product, policy, price, account,
and split resolution → `financial_transactions` plus canonical
`ledger_debit`/`ledger_credit` → Premium receipt or subscription period → the
existing B1 entitlement resolver.

The client supplies only a product/relationship UUID and a UUID idempotency
key. It never supplies buyer, subscriber, creator, account, transaction,
price, gross, fee, net, or basis points. PostgreSQL performs every numeric
calculation at eight-decimal precision and owns the transaction boundary.

`public.atomic_ledger_transfer` remains unchanged for existing domains. B4
uses a private Premium composer because the generic operation does not bind
the Premium reference, exact split, creator account, and platform account in
its idempotency identity. The composer still writes only to the canonical
ledger tables and calls the canonical debit/credit primitives.

## Policy and Product Identity

`private.creator_premium_finance_policy` is a forced-RLS singleton with no
direct application-role grants. Its initial state is disabled/disabled/
disabled and `platform_fee_bps=0`; the owner has not chosen a commission.

Plans gain `billing_period_days` constrained to 1–365. Once an offer or plan
is active, its financial identity is immutable; a later price or period
change requires a new version. Active/retired plan-content mappings are also
immutable, and mappings may grant only subscription-capable content.

## Charge Model

For a new charge, PostgreSQL resolves the immutable active offer/plan and the
current policy. It computes `fee = round(gross * bps / 10000, 8)` and
`creator_net = gross - fee`, requiring positive gross/net and nonnegative fee.
It ensures the buyer/subscriber and creator user accounts, resolves exactly
one unfrozen BDAG platform account, then locks all involved accounts in UUID
order.

One generated UUID is both `financial_transactions.id` and every associated
`ledger_entries.txn_id`. A charge debits the payer gross, credits the creator
net, and credits the platform fee only when nonzero. Each entry metadata binds
the financial transaction, Premium reference type/id, and financial leg.

Purchase and subscription RPCs pre-generate the receipt or period reference
and execute financial posting plus fact insertion in the same PostgreSQL
transaction. Any later failure rolls back balances, transaction, ledger
entries, and Premium facts together.

## Idempotency and Concurrency

Commands use transaction-scoped advisory locks over actor plus idempotency
identity, row locks over product/relationship/fact rows, and deterministic
account locks. Request fingerprints bind the authenticated actor and exact
content, plan, subscription, receipt, or period identity.

Same key plus same request replays the existing result without money movement;
same key plus different payload fails. A different purchase key cannot charge
an already active buyer/content receipt. B4 supports only an initial
subscription: active/cancelled relationships do not charge again, while
expired/revoked history returns the stable renewal-not-implemented error.

## Cancellation and Refunds

Cancellation moves no money. It marks an active subscription cancelled while
leaving the current paid period entitled through `paid_through_at`.

Refunds are full reversals only. Before reversal, private validators prove the
original transaction and every ledger leg exactly match the immutable receipt
or period snapshot: operation, reference, payer/from account, creator/to
account, gross, fee, currency, initiator, status, and exact entry count.

The reversal debits the creator's original net, debits the platform's original
fee when nonzero, and credits the payer's original gross. It then marks the
original transaction reversed and the receipt/period refunded atomically. If
either source lacks funds or is frozen, the whole operation fails without any
partial mutation. B4 does not invent escrow, debt, negative balances, partial
refunds, or automatic renewal.

## Entitlement Hardening

The existing resolver continues to own entitlement decisions. Owner access is
unchanged. Paid purchase or subscription access is allowed only when a private
binding validator confirms the complete immutable snapshot, original
financial transaction, and exact ledger legs. A refunded fact and the reversed
original transaction independently deny access.

## Security and ACLs

All new public financial RPCs are `SECURITY DEFINER SET search_path=''`, use
fully qualified names, revoke default execution, and grant only `service_role`.
They additionally reject non-service internal authority. Private helpers are
postgres-only. The client reaches them only through `bdag-ledger`, which
derives the authenticated user from the JWT.

`bdag-ledger` gains only `creator_premium_purchase`,
`creator_premium_subscribe`, and `creator_premium_cancel_subscription`.
Legacy `purchase` and `subscribe` return a stable disabled error instead of
calling absent RPCs. Refund RPCs remain internal and have no mobile Edge
action.

## Test and Deployment Strategy

Implementation is red-green-refactor. Static contract tests precede the one
CLI-generated migration. A disposable PostgreSQL database proves charges,
zero-fee behavior, all authorization failures, concurrency/idempotency,
immutability, exact binding tamper denial, cancellation, full reversals,
insufficient refund source rollback, and a test-only forced failure after
financial posting.

Focused Edge/client tests prove JWT-derived identity and rejection of client
financial fields. Existing B1/B2/B2-C1/B3 and non-Premium finance suites must
retain their baselines. Deployment consists of exactly the one B4 migration
and, only if changed, `bdag-ledger`. Postchecks require policy switches false,
zero Premium production facts, unchanged finance counts/balances/platform
balance, and unchanged `origin/main`.
