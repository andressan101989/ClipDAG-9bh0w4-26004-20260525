# ALGO-6 L6-F2 Organic Ranking Observation Design

## Decision

Add one fail-soft observation side channel to the existing canonical organic Feed authority. The online ranker remains `public.get_ranked_feed_l1_v1`; it does not read observation data and its candidate selection, score, ordering, cursor, and fallback behavior remain unchanged.

The immutable chain is:

`ranking decision -> returned organic items -> visible impression -> finalized video view -> later engagement observation`

The existing playback `clientEventId` is the join key between a visible impression and `public.video_views.client_event_id`. No second exposure identity is introduced.

## Database authority

One forward-only migration creates exactly four forced-RLS private tables:

- `private.organic_ranking_decisions`
- `private.organic_ranking_items`
- `private.organic_ranking_impressions`
- `private.organic_ranking_engagement_events`

The ranker calls one private, non-executable helper after final page determination. The helper validates a bounded JSON payload, writes the decision and exact returned slate atomically, catches observation failures, emits only the fixed warning and SQLSTATE, and returns `NULL` on failure.

The ranking RPC keeps its input signature and appends nullable `ranking_decision_id` and `ranking_organic_position` outputs. A zero-row call still records a decision. Feature snapshots contain exactly the allowlisted numeric L1-L5 scalar components and are never queried by online ranking.

Browser clients can execute only the impression RPC (anon/authenticated) and engagement RPC (authenticated). Both derive trusted identity and slate membership server-side, are idempotent, and never mutate canonical social state. A service-only progress RPC returns aggregates without raw identities. A private daily retention function deletes only decisions older than 180 days, cascading through the observation chain.

## Client authority

`feedRankingService` validates page-wide decision metadata and returns a typed observation-item list. `FeedContext` owns the ranked-video metadata map, clears it on replacement generations, appends it on pagination, and provides fail-soft observation methods.

`VideoCard.native` reports the exact ID returned by `playbackSession.start()` once for every new active playback session. The Feed screen supplies the actual mixed-surface `index + 1`; deep-link-only videos have no metadata and produce no ranking impression. Like/save/follow telemetry runs only after existing business actions and may wait for the matching impression write, but telemetry never blocks or reverses the business action.

## Dataset contract

The training unit is one visible organic impression. Retention is joined by the identical client event ID. Missing finalized views are censored/unknown, not automatic negatives. Sparse engagement events are eligible only after their 24-hour attribution window closes; reversal events are retained raw and are not automatically negative labels. Self-authored like/save/follow events are ignored for training observation.

## Boundaries

No model, training, registry, online feature store, prediction cache, new ranker, Edge Function, package, historical backfill, Ads/Marketplace/finance dependency, sensitive attribute, or ranking formula change is introduced.
