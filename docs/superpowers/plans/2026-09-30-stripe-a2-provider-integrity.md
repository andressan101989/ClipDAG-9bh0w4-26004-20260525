# STRIPE-A2 Provider Integrity Implementation Plan

> Execution is authorized by the owner. This plan is deliberately limited to Stripe test-mode readiness and never configures a provider or creates a real payment.

## Goal

Harden the existing Stripe provider adapter so provider events are bound to the exact top-up, state transitions are monotonic, USD-to-BDAG conversion is verified by PostgreSQL, refunds/disputes use the canonical ledger, checkout retries reuse a stable browser intent, and Stripe-specific reconciliation detects drift.

## Architecture

- Keep `private.stripe_customers`, `private.stripe_bdag_topups`, and `private.stripe_webhook_events` as the only Stripe persistence.
- Keep `public.financial_transactions`, `public.ledger_accounts`, `public.ledger_entries`, `public.ledger_credit`, and `public.ledger_debit` as the only financial authority.
- Extend the existing top-up and webhook rows with provider-adjustment evidence; do not introduce a Stripe wallet, escrow, or ledger.
- Derive the Stripe conversion in PostgreSQL from one private function returning the owner-approved fixed value of 100 BDAG/USD. Edge may display the shared TypeScript value, but financial writes use the database result.
- Extend the existing service-role adapter for webhook lifecycle state and add one service-role-only adjustment function for exact canonical ledger reversals/reinstatements.
- Add one read-only Stripe reconciliation function.

## Tasks

1. Add failing static and Business Web tests for event binding, state guards, conversion parity, event ordering, reversal evidence, reconciliation, mode isolation, and stable browser retry keys.
2. Implement the single forward migration:
   - extend existing Stripe rows and constraints;
   - replace existing adapter/credit definitions;
   - add canonical adjustment and read-only reconciliation functions;
   - lock down grants and comments.
3. Update checkout Edge to accept only amount/key from the browser and use database-derived amounts.
4. Update webhook Edge for explicit test/live matching, bound provider identifiers, monotonic event handling, and refund/dispute lifecycle events.
5. Update Business Web to persist a short-lived logical checkout intent in session storage and represent refunded states truthfully.
6. Run disposable PostgreSQL lifecycle tests, static tests, Business Web tests/lint/build, and relevant finance regressions.
7. Commit and push one focused change.
8. Recheck production invariants, deploy only the migration and two Stripe Edge functions, verify source parity and zero financial movement, run reconciliation and Supabase advisors.

## Safety invariants

- Test mode only; `livemode=true` is rejected in Edge and database.
- No external Stripe calls in tests.
- No production top-up fixture.
- No negative ledger balance.
- A pending provider reversal remains visible and unreconciled until it can be applied.
- Exact idempotent replay is accepted; conflicting reuse is rejected.
- No Ads, Marketplace, crypto, payout, or unrelated Business code changes.
