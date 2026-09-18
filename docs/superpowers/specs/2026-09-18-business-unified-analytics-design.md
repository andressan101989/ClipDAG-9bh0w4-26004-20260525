# BW-I Unified Business Analytics Design

## Goal

Add a native Nelyon Business Analytics center that presents server-aggregated commerce, advertising, finance, and payout information for the selected business without introducing a second analytics, attribution, or financial authority.

## Approved authorization model

- `business.analytics.read` authorizes only the general commerce analytics payload and the Analytics route.
- Ads analytics requires `business.ads.read` or `business.ads.manage`.
- The finance snapshot requires `business.finance.read`.
- The payout snapshot requires `business.payouts.read` or `business.payouts.manage`.
- Every check is repeated server-side. React may hide an unauthorized section, but it is never the authority.
- An unauthorized optional section is returned as `{ authorized: false, data: null }`; zero is reserved for an authorized section with no data.
- BW-J1 membership and capability semantics are reused unchanged.

## Existing authorities

- Commerce observations: `public.marketplace_commerce_events` and the existing seller/variant analytics RPCs.
- Merchandise truth: immutable order-item amounts and canonical purchase-completed commerce events.
- Ads: `marketplace_ad_campaigns`, `marketplace_ad_events`, `marketplace_ad_delivery_materializations`, and `marketplace_order_ad_attribution`.
- Finance: canonical `ledger_accounts` and Marketplace settlement data.
- Payouts: `withdrawal_requests` and the existing BW-H payout projection semantics.
- Actor scope: `private.business_actor_has_capability` from BW-J1.

## Chosen architecture

Create one read-only `public.get_my_business_analytics(p_business_owner_id uuid, p_range text default '30d')` RPC. It validates `business.analytics.read`, derives all time bounds in UTC, aggregates server-side, and conditionally includes Ads, Finance, and Payouts sections only after their own capability checks.

This avoids a browser fan-out across owner-only legacy RPCs, prevents inconsistent time windows, and gives request-level cross-business isolation. No analytics table or materialized financial state is created.

## Time semantics

Supported range values are `7d`, `30d`, and `90d`. The current window contains exactly that many UTC calendar days including the current UTC day. The previous window is the immediately preceding equal-length window. Both use half-open boundaries. Daily series are generated server-side and missing days are zero-filled.

## Commerce semantics

- GMV is gross merchandise value from canonical `purchase_completed` commerce observations, using immutable merchandise line totals. It is not seller net, settlement value, or refund-adjusted revenue.
- Orders count distinct canonical order IDs.
- Units sum canonical purchase quantities.
- Product views count canonical `product_view` observations.
- Refund/reversal values, when shown, remain separate and come from canonical payment/allocation authorities.
- Product, variant, and source breakdowns are aggregated server-side. Source values are limited to the existing canonical taxonomy.
- Soft-deleted products remain attributable through stored event/order references; current metadata is joined opportunistically and falls back to a neutral deleted-product label.

## Optional section semantics

- Ads: campaign state from campaigns; impressions/clicks from ad events; spend from canonical delivery materializations; attributed orders/GMV from order attribution. ROAS is calculated server-side and is `null` when spend is zero.
- Finance: current owner ledger balance plus canonical Marketplace settlement summary. Exact numeric values are serialized as strings.
- Payouts: current pending/broadcasting counts and period completed count/value from `withdrawal_requests`.

## API contract

The RPC returns one JSON object containing:

- server-generated UTC window metadata;
- current and previous commerce summaries plus server-derived comparisons;
- an exactly sized daily series;
- bounded product, variant, and source breakdowns with global counts independent of row limits;
- optional `ads`, `finance`, and `payouts` envelopes with `authorized` and nullable `data`;
- exact monetary values as decimal strings.

The browser wrapper validates and normalizes the shape. It never aggregates money.

## Business Web

- Enable the existing Analytics navigation entry for actors with `business.analytics.read`.
- Add `/analytics` behind the existing `BusinessRoute` capability guard.
- Add range controls, KPI cards, a lightweight accessible trend chart, product/source tables, and authorized optional sections using the existing visual system.
- Use the existing `BusinessAuthProvider` active-business authority.
- Protect state with a request identity so an older business/range response cannot overwrite the latest selection.
- Business change immediately clears prior analytics before loading the new scope.

## Security and database posture

- The RPC is `SECURITY DEFINER` with `search_path = ''` and fully qualified objects.
- Revoke `PUBLIC` and `anon`; grant only `authenticated` and `service_role`.
- No direct table grants, RLS weakening, financial mutation, or historical data update.
- No new indexes unless query evidence proves one is required; current seller/time and campaign/time indexes cover the bounded reads.

## Alternatives rejected

1. Browser aggregation of existing RPCs: legacy commerce RPCs are owner-only, optional capabilities differ, and multiple requests cannot guarantee one UTC window.
2. Analytics snapshot/materialization tables: they would duplicate canonical event and financial authorities and add unnecessary lifecycle complexity.
3. Extending every existing domain RPC: it would duplicate range logic and still require client orchestration.

## Verification strategy

- Unit tests for response parsing and exact string money preservation.
- UI tests for ranges, zero states, comparisons, global totals, optional permissions, business switches, and stale response protection.
- Transactional database tests for all approved capability combinations, revoked/cross-business access, UTC buckets, and no financial writes.
- Existing Business, Ads, Seller, Finance/Payout, and Admin regressions.
