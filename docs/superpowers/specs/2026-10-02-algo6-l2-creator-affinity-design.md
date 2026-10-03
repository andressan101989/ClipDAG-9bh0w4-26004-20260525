# ALGO-6-L2 Creator Affinity V1 Design

## Status and intent

This document records the owner-approved design for ALGO-6-L2. L2 extends the
single canonical organic Feed authority with deterministic viewer-to-creator
affinity derived from existing raw signals. The layer is deployed dormant:
`l2_affinity_enabled=false`, `production_rollout_bps=0`, and the directed L1
canary remains disarmed. Production therefore continues chronological delivery.

L2 does not introduce a second Feed RPC, policy, signal table, affinity table,
cache, materialized view, Edge Function, client scorer, native build, Ads input,
financial input, AI, ML, embeddings, topics, collaborative filtering, or L3
quality model.

## Canonical data flow

```text
eligible newest public.videos (bounded to 200)
  -> distinct candidate creators
  -> viewer raw likes/comments/saves/video_views within feed snapshot + 90 days
  -> one bounded contribution per signal type and video
  -> per-video positive cap and qualified short-watch penalty
  -> creator sum clamped to [-12,+18]
  -> exact L1 score + creator affinity points
  -> existing diversity and score/created_at/id cursor
  -> existing organic response
  -> existing sponsored insertion downstream
```

`public.get_ranked_feed_l1_v1` remains the only organic Feed authority. Its
historical name is retained for compatibility. `services/feedRankingService.ts`
continues as the only thin client and adds only the `behavioral_l2` response
mode.

## Policy extension

`private.algo_l1_policy` remains the one policy singleton. L2 adds:

| Parameter | Initial value |
|---|---:|
| l2_affinity_enabled | false |
| l2_affinity_horizon_days | 90 |
| l2_affinity_like_weight | 2.0 |
| l2_affinity_comment_weight | 3.0 |
| l2_affinity_save_weight | 4.0 |
| l2_affinity_completed_weight | 2.0 |
| l2_affinity_long_watch_weight | 1.0 |
| l2_affinity_rewatch_weight | 1.0 |
| l2_affinity_short_watch_penalty | 1.5 |
| l2_affinity_long_watch_ratio_threshold | 0.50 |
| l2_affinity_negative_min_distinct_videos | 2 |
| l2_affinity_per_video_positive_cap | 8.0 |
| l2_affinity_per_video_negative_cap | 2.0 |
| l2_affinity_creator_positive_cap | 18.0 |
| l2_affinity_creator_negative_cap | 12.0 |

All values are constrained. The existing JSON-based policy guard excludes only
operational canary columns, so every L2 field is algorithmic and cannot change
without an atomic `policy_version` change. Deployment keeps
`policy_version=nelyon-algo-l1-v1`; local tests may atomically set
`nelyon-algo-l2-v1` and enable L2.

The migration adds columns with defaults and does not update the policy row, so
historical canary request, timestamps, user, and generation survive unchanged.

## Exact affinity formula

For a qualifying signal timestamp `ts`:

```text
decay(ts) = max(0, 1 - age_days(ts, feed_as_of) / horizon_days)
```

Only signals with `feed_as_of - horizon <= ts <= feed_as_of` qualify.

For each viewer, candidate creator, and distinct video:

- Current like: `2.0 * decay(last_like_at)`.
- Any comments: `3.0 * decay(last_comment_at)`; multiple comments do not stack.
- Current save: `4.0 * decay(last_save_at)`.
- Any completed view: `2.0 * decay(last_completed_at)`.
- Any duration-backed ratio at least `0.50`:
  `1.0 * decay(last_long_watch_at)`.
- Any event with `rewatch_count>0`:
  `1.0 * decay(last_rewatch_at)`; raw loop count does not multiply it.

The positive sum is clamped to `+8` per video.

A short watch requires canonical duration, ratio below the existing L1 `0.20`
threshold, and exit reason `swipe`, `background`, or `unmount`. `unknown` never
counts. Negative affinity is enabled for a creator only after at least two
distinct short-watched videos in the horizon. Each qualifying video contributes
`min(2.0, 1.5 * decay(last_short_watch_at))` as a penalty.

Per-video affinity is capped positive contribution minus qualified negative
contribution. The creator sum is clamped to `[-12,+18]`. A viewer's own creator
ID always receives zero. Anonymous delivery always receives zero. Follow is not
part of affinity because the existing L1 `+20` follow component remains its only
direct boost.

## Snapshot, candidates, scoring, and delivery mode

Affinity reads use `created_at<=feed_as_of`; signals arriving after page one do
not change continuation pages. History is bounded to the configured horizon.
Only creators represented in the eligible newest-200 candidate pool participate,
although their qualifying historical videos may supply affinity. Signals for
other creators cannot alter the page.

When L2 is disabled, affinity is zero and L1 score, ordering, cursor, diversity,
eligibility, cold start, exploration, and penalties are byte-for-byte equivalent
at the response level. When behavioral delivery and authenticated L2 are both
active, mode is `behavioral_l2`; anonymous behavioral delivery remains
`behavioral_l1`. Chronological fallback remains `chronological` with score zero.

## Query and security design

The function derives the viewer from `auth.uid()`, keeps `SECURITY DEFINER` with
empty `search_path`, fully qualifies objects, and preserves anon/authenticated
EXECUTE ACLs with PUBLIC denied. Affinity is computed in set-based CTEs: one
scan per viewer signal authority, a combined per-video row, a creator negative
gate, and one creator aggregate. There is no lateral per-candidate lookup or
client N+1.

Existing viewer indexes are evaluated at representative synthetic volume before
adding any index. No index is added unless EXPLAIN proves a missing access path.
The private policy remains browser-inaccessible, and no new Data API object is
created.

## Reconciliation and acceptance

`public.reconcile_algo_l1_v1()` remains the sole reconciliation authority and
adds checks for invalid L2 policy values, unexpected production enablement,
missing L2 logic, and forbidden affinity materialization. All counters must be
zero after deployment.

Acceptance requires RED-to-GREEN static and disposable tests for L1 parity,
positive/negative contributions, decay, caps, self/anonymous/non-candidate
behavior, follow non-duplication, snapshot pagination, security, performance,
and client validation. Deployment adds exactly one committed migration whose
repository filename/version matches the production ledger, changes no signal or
financial rows, and leaves zero real L2 users.
