# ALGO-6-L1 Behavioral Ranking V1 Design

## Status and intent

This document records the owner-approved design for ALGO-6-L1. L1 replaces the
chronological organic candidate query in FeedContext with one server-side,
auditable behavioral ranking authority. Production rollout remains zero, so
real users continue to receive chronological delivery through that same RPC.

L1 applies only to the organic social Feed. It does not alter Search, Creator
profiles, Stories, LIVE, Marketplace ordering, Ads selection, finance, Stripe,
wallets, rewards, native builds, or any L2/L5 capability.

## Canonical data flow

```text
public.videos
  -> explicit moderation/privacy/block eligibility
  -> newest 200 eligible candidates at one feed_as_of snapshot
  -> set-based raw engagement/watch aggregation
  -> deterministic bounded score or chronological fallback
  -> per-page creator diversity (cap pass, then fill pass)
  -> stable score/created_at/id cursor
  -> organic VideoWithMeta rows
  -> existing Marketplace sponsored mix
  -> existing Ads V2 placement insertion
```

There is one organic Feed candidate authority:
`public.get_ranked_feed_l1_v1`. No ranking rows, cached feeds, per-user score
tables, feature store, recommendation Edge Function, or second Feed service are
introduced.

## Policy

`private.algo_l1_policy` is a one-row table with RLS and FORCE RLS, no browser
policies, and no browser grants. Its initial row is:

| Parameter | Value |
|---|---:|
| policy_version | nelyon-algo-l1-v1 |
| enabled | true |
| production_rollout_bps | 0 |
| candidate_pool_size | 200 |
| max_page_size | 50 |
| freshness_horizon_hours | 168 |
| freshness_weight | 30 |
| follow_weight | 20 |
| like_weight | 8 |
| comment_weight | 10 |
| save_weight | 12 |
| completion_weight | 12 |
| rewatch_weight | 6 |
| exploration_weight | 5 |
| short_watch_ratio_threshold | 0.20 |
| short_watch_penalty | 35 |
| recent_completed_penalty | 25 |
| repeat_view_penalty | 5 |
| repeat_view_penalty_cap | 20 |
| same_session_penalty | 100 |
| minimum_watch_samples | 3 |
| creator_page_cap | 2 |
| cursor_ttl_minutes | 30 |

All numeric values have database constraints. Rollout is bounded to 0..10000,
candidate pool to 1..1000, page size to 1..50, ratios to 0..1, and weights and
penalties to non-negative bounded domains.

## Exact L1 score

All calculations use `numeric` and are rounded to six decimal places.

- Freshness: `30 * max(0, 1 - age_hours / 168)`.
- Follow: `+20` when the authenticated viewer follows the creator as of the
  snapshot.
- Likes: `8 * min(1, ln(1 + raw_likes) / ln(101))`.
- Comments: `10 * min(1, ln(1 + raw_comments) / ln(101))`.
- Saves: `12 * min(1, ln(1 + raw_saves) / ln(101))`.
- Completion: when at least three duration-backed samples exist,
  `12 * completion_rate`; otherwise zero.
- Rewatch: when at least three duration-backed samples exist,
  `6 * min(1, total_rewatches / sample_count)`; otherwise zero.
- Exploration:
  `5 * stable_hash_fraction(seed, video, policy) / sqrt(1 + raw_exposures)`.
  The seed is viewer UUID when authenticated and session UUID otherwise.
- Same-session penalty: `-100` once if the same viewer/session already
  consumed the candidate.
- Short-watch penalty: `-35` once when a recent duration-backed view has
  ratio below 0.20 and exit reason swipe/background/unmount.
- Recent completion penalty: `-25` once for a completion in the last 168
  hours.
- Repeat penalty: `-min(recent_exposures * 5, 20)`.

`videos.views_count`, shares, Ads signals, spend, budgets, semantic data,
creator affinity, topic affinity, embeddings and collaborative filtering are
excluded.

## Candidate generation, snapshots, rollout and pagination

Eligibility is applied before the bounded candidate pool using
`private.admin_content_is_visible('video', id)` and
`private.video_can_view_owner(user_id)`. Candidates are preselected by
`created_at DESC, id DESC`, capped at 200, and restricted to
`created_at <= feed_as_of`.

The first request supplies no cursor; the server fixes `feed_as_of` using
`clock_timestamp()`. Continuations must supply the same as-of, policy version,
score, created_at and id. Future snapshots, snapshots older than 30 minutes,
partial cursors, and policy mismatches fail closed. The behavioral delivery
key is `rank_score - diversity_tier * 10000`, where a tier contains at most
the configured creator cap. The 10,000 separation is larger than the full
score domain allowed by policy constraints, so it deterministically orders
the diversity passes without changing the auditable `rank_score`. Cursor
ordering is `delivery_score DESC, created_at DESC, id DESC`; chronological
fallback emits both scores as zero and therefore preserves
`created_at DESC, id DESC`. OFFSET is absent.

Rollout uses a stable MD5-derived bucket from viewer UUID or anonymous session
UUID plus policy version. Zero basis points always means chronological;
10,000 always means behavioral. Production is deployed at zero.

Creator diversity is deterministic across the snapshot. Pass one consumes the
earliest remaining diversity tier, which contains at most two items per
creator. Pass two fills any remaining slots from the best later-tier
candidates so a small or single-creator catalog is not artificially shortened.
The cursor uses the delivery score rather than the raw rank score, preventing
deferred creator items from being skipped between pages.

## API and client

`public.get_ranked_feed_l1_v1` accepts session UUID, limit and cursor fields.
It never accepts viewer identity, weights or eligibility overrides. It derives
the viewer from `auth.uid()`, uses `SECURITY DEFINER` only to read protected
raw signals, fixes `search_path=''`, revokes PUBLIC and grants execute only to
anon/authenticated.

The response contains the video presentation fields, creator username/avatar,
ranking mode, policy version, rank score, feed as-of and cursor tuple. It does
not expose raw events, other viewer identities, private policy weights or Ads
data.

`services/feedRankingService.ts` only invokes and validates the RPC, maps rows
through the existing presentation mapper and constructs the next cursor.
FeedContext owns refresh/generation fencing and never scores, randomizes, or
falls back to a direct candidate query. Exact-ID deep-link resolution remains a
non-candidate lookup protected by video RLS.

## Index and performance design

The function aggregates signals inside one set-based SQL statement over the
bounded candidate CTE. There are no client per-candidate calls. Bounded lateral
aggregates perform at most one index-backed probe per signal authority for each
of the 200 candidates, preventing an unbounded scan of behavioral history. F0
video and view indexes remain. L1 adds snapshot-aware composite indexes for
likes, comments and saves plus a session/video view index only when the
representative disposable EXPLAIN demonstrates their use.

Performance proof uses thousands of synthetic videos and behavioral rows in a
disposable PostgreSQL database. Production's six videos are not performance
evidence.

## Security, reconciliation and observability

`public.reconcile_algo_l1_v1()` is read-only and service-role only. It checks
the singleton/config domains, zero production rollout, required indexes,
function existence/ACL/search path, raw signal and eligibility authorities,
private policy access, absence of score materialization, and absence of Ads
dependencies in the ranking definition.

Technical observability is the response metadata plus reconciliation; no
viewer-level log or analytics table is added. Production dry-run must report
`chronological` while local policy 10,000 must report `behavioral_l1`.

## Acceptance

Disposable integration tests cover every score component, cold start,
deterministic exploration/rollout, diversity, cursor validation, security and a
representative EXPLAIN. Client tests prove the direct candidate query is gone,
snapshot continuation is stable, auth changes reset delivery, failures
fabricate no content, and Ads remain a downstream insertion layer. Deployment
must add exactly one migration, preserve all production and financial counts,
leave rollout at zero, reconcile to zero, and push a clean branch whose local
and remote SHAs match.
