# ALGO-6 L6-F4 Training Readiness Monitoring Design

## Status

Approved design for ALGO-6 L6-F4. This phase installs monitoring for controlled dataset accumulation. It does not create, train, deploy, or invoke a model and does not change Feed ranking.

## Intent and success criteria

Nelyon already has one canonical organic observation chain:

`ranking decision -> returned organic items -> visible impression -> finalized video view -> later engagement event`

L6-F4 adds one service-only, aggregate readiness authority derived directly from that chain. The phase succeeds when operators can determine, conservatively and reproducibly, whether the approved provisional training-entry gates have enough point-in-time-correct evidence, while structural data-quality failures remain distinguishable from ordinary low volume.

Success requires:

- one readiness RPC and one operator report command;
- no new tables, materialized views, snapshots, event identities, cron jobs, model objects, or serving dependencies;
- no client, ranking RPC, candidate, score, order, cursor, L1-L5, canary, or rollout change;
- service-role-only execution with aggregate-only output;
- explicit structural-failure detection;
- every unresolved label contract blocking `training_entry_ready=true`;
- disposable integration, security, regression, and gate-scale performance proof before deployment.

## Existing authorities

L6-F4 reads only these canonical facts:

- `private.organic_ranking_decisions`
- `private.organic_ranking_items`
- `private.organic_ranking_impressions`
- `private.organic_ranking_engagement_events`
- `public.video_views`
- `private.algo_l1_policy` for reporting current rollout/canary state

The online ranker remains `public.get_ranked_feed_l1_v1(...)`. It must not reference the readiness RPC, and the readiness RPC must not participate in online ranking, impression recording, playback, or social actions.

## Chosen architecture

Create exactly one new public RPC:

```sql
public.get_algo6_l6_training_readiness_v1() returns jsonb
```

The function is `SECURITY DEFINER`, has `SET search_path = ''`, uses only schema-qualified static SQL, accepts no arguments, and returns aggregate JSON. Execute is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.

The implementation uses bounded set-based CTEs rather than per-row subqueries:

1. Freeze `clock_timestamp()` once as `generated_at`.
2. Build one impression fact relation by joining impressions to the exact decision item and to `video_views.client_event_id`.
3. Build one engagement fact relation by joining engagement rows to their canonical impression and item.
4. Aggregate decision/item consistency, feature-snapshot validity, continuity, outcomes, and policy independently so joins do not multiply counts.
5. Construct a deterministic JSONB response from those aggregate rows.

No readiness data is persisted. The existing 180-day observation retention job remains the only observation cron.

## Alternatives rejected

### Multiple SQL helpers

Private metric helpers would make individual queries shorter, but add catalog objects, ACL surfaces, and dependency paths without improving the single on-demand report. The v1 contract remains one function.

### Snapshot or materialized monitoring tables

Daily snapshots would duplicate the canonical dataset, add retention and reconciliation responsibilities, and make current truth depend on a second pipeline. They are prohibited.

### Client-side readiness

Client evaluation would expose private data and credentials and create a second interpretation of the contract. Readiness remains service-side.

## Readiness response contract

The exact top-level response is:

```text
contract_version
generated_at
observation_schema_version
feature_contract_version
overall_status
training_entry_ready
blocking_reasons
global_gates
data_quality
observation_continuity
head_monitoring
temporal_split
current_policy_state
```

Exact version values:

- `contract_version = algo6-l6-training-readiness-v1`
- `observation_schema_version = organic-ranking-observation-v1`
- `feature_contract_version = organic-ranking-features-l1-l5-v1`
- `temporal_split.contract_version = PROPOSED_TEMPORAL_SPLIT_V1`

`overall_status` is one of:

- `STRUCTURAL_FAILURE`: at least one structurally impossible condition is nonzero;
- `NOT_READY`: structure is valid but volume, continuity, or final label contracts are incomplete;
- `READY_FOR_TRAINING_PHASE`: structure is valid and every mandatory approved gate and final label contract passes.

L6-F4 v1 intentionally cannot return `READY_FOR_TRAINING_PHASE`, because final objective/label contracts are not yet all approved. Therefore `training_entry_ready` remains false in v1 even if a synthetic fixture exceeds every numeric threshold.

`blocking_reasons` is a deterministic, sorted array of stable machine-readable codes. It contains structural codes first, then failed global gates, then unresolved label-contract and temporal-evaluation codes. It contains no UUIDs or user data.

## Global gates

Each gate reports `current`, `required`, and `status`. Status is `PASS`, `NOT_READY`, `NOT_EVALUABLE`, `PROVISIONAL_LABEL_CONTRACT`, or `STRUCTURAL_FAILURE`.

### Unique visible organic impressions

- Required: `250000`.
- Report both `total_visible_impressions` and `unique_client_event_ids`.
- Compute `unique_client_event_ids` as `count(distinct client_event_id)` over canonical visible organic impressions.
- The gate's `current` is `unique_client_event_ids`.
- Any divergence between total and unique is `STRUCTURAL_FAILURE`, even though `client_event_id` is currently a primary key.
- Returned decision items without a visible impression do not count.

### Valid retention samples

- Required: `100000`.
- Count only mature visible impressions with exactly one `video_views` row linked by the identical `client_event_id`.
- Require `media_duration_ms IS NOT NULL`, `media_duration_ms > 0`, and `completion_ratio IS NOT NULL`.
- Require the linked view's `video_id` and `client_session_id` to match the impression.
- `completion_ratio > 1` is valid and must not be rejected.
- A mature impression without a finalized view is censored/unknown and does not count as a retention negative.

### Population gates

- Distinct authenticated viewers: `2000`, counted from visible impressions whose `viewer_user_id` is non-null.
- Distinct videos: `2000`, counted from visible impressions joined to their canonical item.
- Distinct creators: `200`, counted from visible impressions joined to their canonical item.
- Returned-but-never-visible videos and creators do not inflate readiness.

### Continuous observation

- Required: `84` consecutive UTC calendar days.
- A day is observed when it contains at least one mature visible impression with valid decision/item membership and valid observation/feature contract versions.
- `observed_calendar_days` counts distinct qualifying UTC dates.
- `longest_consecutive_observation_days` is calculated by grouping date islands.
- The response also reports `oldest_mature_impression_at`, `newest_mature_impression_at`, and `required_continuous_days=84`.

## Maturity and attribution

An impression is mature only when:

```sql
created_at <= generated_at - interval '24 hours'
```

This matches `organic-engagement-24h-v1`. Immature impressions may contribute to raw observation totals but never to final retention or engagement label counts.

Engagement monitoring includes only canonical observation events whose impression is mature, whose event is within the inclusive 24-hour attribution window, and whose viewer is not the item's creator. Reversals remain separate raw counts and never become automatic negatives.

## Head monitoring and label boundary

No monitored head contributes to `training_entry_ready` unless its final label contract has been explicitly approved in a future migration.

### Long watch

- Source metric only: mature valid retention rows with `completion_ratio >= 0.50` versus `< 0.50`.
- Required source support: `10000` positive and `10000` negative.
- `label_contract_status = PROVISIONAL`.
- Gate status is `PROVISIONAL_LABEL_CONTRACT`, regardless of counts.

### Completion

- Source metrics: canonical `completed=true` and `completed=false` among mature valid retention rows.
- Required source support: `10000` true and `10000` false.
- Final use as an ML objective is not approved; status remains `PENDING_FINAL_LABEL_CONTRACT`.

### Early exit

- Report exact canonical `exit_reason` distribution only.
- Do not infer an early-exit threshold or classify background/unmount as negative.
- Required future support remains `10000` exits and `10000` non-exits, but current values are `null` and status is `PROVISIONAL_LABEL_CONTRACT` until a final contract defines those sets.

### Rewatch

- Source metric: mature valid retention rows with `rewatch_count > 0`.
- Required source support: `5000` positives.
- Status remains `PENDING_FINAL_LABEL_CONTRACT`.

### Like and save

- Source metric: mature, within-window, external/non-self positive observation events.
- Required source support: `5000` positive events for each head.
- Like/unlike and save/unsave remain separately reported.
- Status remains `PENDING_FINAL_LABEL_CONTRACT` until objective semantics are approved.

### Follow

- Report mature external follow/unfollow counts for integrity and future analysis.
- Follow is informational and has no training-entry threshold in v1.

### Sparse validation and test support

- Required future support: `500` positives per sparse head in validation and `500` in untouched test.
- No rows are copied or split in F4.
- Both gates report `current=null`, `status=NOT_EVALUABLE` while `PROPOSED_TEMPORAL_SPLIT_V1` is not physically evaluable.

## Proposed temporal split

The response documents, but does not execute or materialize:

- train: oldest 8 weeks;
- validation: following 2 weeks;
- untouched test: latest 2 weeks.

The split status is `NOT_EVALUABLE` until continuity and volume are sufficient and a later approved extraction phase defines the exact frozen windows.

## Data-quality contract

The RPC reports at least:

- total visible impressions;
- distinct impression `client_event_id` values;
- duplicate impression identities;
- total and distinct engagement action IDs;
- duplicate engagement identities;
- finalized-view links;
- mature impressions without a finalized view;
- exact view-link coverage ratio;
- multiple finalized views per impression;
- wrong video joins;
- wrong session joins;
- wrong viewer joins when both identities are present;
- malformed feature snapshots;
- unknown feature keys;
- invalid observation schema versions;
- invalid feature contract versions;
- self-authored engagement rows;
- orphan impressions and orphan engagements;
- engagement events outside the 24-hour window;
- future-dated decisions, impressions, or engagement rows;
- decision `returned_count` versus item-count mismatches;
- duplicate decision/video membership;
- authenticated and anonymous impression counts;
- mature and immature impression counts.

The exact feature snapshot allowlist is the 24-key F2 contract:

```text
freshness_points
follow_points
like_points
comment_points
save_points
completion_points
rewatch_points
exploration_points
same_session_points
short_watch_points
completed_points
repeat_points
creator_affinity_points
l3_quality_points
creator_burst_penalty
duplicate_penalty
l3_adjustment
positive_creator_points
negative_creator_penalty
creator_session_repeat_penalty
l4_context_adjustment
l5_semantic_positive_points
l5_semantic_negative_penalty
l5_semantic_adjustment
```

A valid snapshot is a JSON object with exactly those keys, and every value is JSON numeric or null. Missing keys, extra keys, or other value types make the snapshot malformed. Extra keys also increment `unknown_feature_keys`.

Structural failure occurs when any impossible integrity counter is nonzero, including total/unique identity divergence, duplicates, wrong joins, malformed/unknown snapshots, invalid versions, self engagements, orphans, outside-window events, future timestamps, and slate count/membership mismatches. Censored mature impressions are reported but are not by themselves structural failures because missing view finalization is an allowed state.

## Current policy state

The aggregate response reports:

- policy version;
- canary generation and enabled state;
- historical target layer;
- production rollout basis points;
- global L2/L3/L4/L5 flags.

These fields are operational context, not preference features and not training labels. The RPC has no Ads, Marketplace, finance, wallet, ledger, message, location, device, network, moderation, or sensitive-attribute dependency.

## Reconciler extension

Extend `public.reconcile_algo_l1_v1()` with exactly three non-duplicate counters:

1. `l6_training_readiness_authority_missing`
   - the zero-argument JSONB RPC exists;
   - it is `SECURITY DEFINER` with `search_path=''`;
   - only `service_role` has execute among `PUBLIC`, `anon`, `authenticated`, and `service_role`.
2. `l6_training_readiness_contract_invalid`
   - the function definition contains the exact readiness, observation, feature, and temporal-split versions and every approved numeric gate;
   - the function is aggregate-only and has no arguments.
3. `l6_training_readiness_forbidden_dependency_present`
   - catalog dependencies and the function definition contain no Ads, Marketplace, financial, wallet, ledger, message/chat, location/GPS/IP/device/network, moderation-preference, model, prediction, feature-store, or training-table authority.

The existing eight L6 observation counters remain unchanged. Expected reconciler size is `65 -> 68`, with all values zero on a valid deployment.

## Operator report

Add `scripts/report-algo6-l6-training-readiness.mjs` and package command `report:algo6-l6-readiness`.

The script:

- calls only `get_algo6_l6_training_readiness_v1` using a server-side Supabase client;
- obtains the URL and service secret from process environment;
- never prints, hashes, persists, or returns credentials;
- performs no DML and writes no files;
- prints each global and head gate as `CURRENT / REQUIRED / STATUS`;
- prints all structural data-quality counters and blocking reasons;
- prints `TRAINING_ENTRY_READY = false` until the RPC legitimately returns true;
- exits zero for healthy `NOT_READY`, `NOT_EVALUABLE`, and provisional states;
- exits nonzero only for configuration/RPC failure, malformed response, or `STRUCTURAL_FAILURE`.

No new dependency is required because `@supabase/supabase-js` already exists.

## Migration and indexes

Generate exactly one forward-only migration with `supabase migration new algo6_l6_training_readiness_monitoring` during implementation. Never edit the deployed F2 migration.

Expected migration objects:

- create `public.get_algo6_l6_training_readiness_v1()`;
- replace `public.reconcile_algo_l1_v1()` only to append the three counters;
- apply exact function ACLs.

Expected new tables, views, materialized views, cron jobs, triggers, model objects, and event authorities: zero.

The current primary/unique and time indexes cover identity joins and retention-window filters. Add no index by default. A new index is allowed only when gate-scale `EXPLAIN (ANALYZE, BUFFERS)` demonstrates a material bottleneck and the report records before/after evidence.

## Testing strategy

Follow TDD: static tests must fail because the migration/RPC/script are absent before implementation.

Static tests verify exact contract constants, object scope, ACLs, dependencies, no new tables/cron/client/ranker changes, operator behavior, and reconciler keys.

Disposable Postgres tests apply the F2 baseline plus F4 migration and prove:

- empty data returns healthy `NOT_READY`;
- maturity changes only after 24 hours;
- exact view linkage and valid-retention rules;
- censored impressions are not negatives;
- duplicate/wrong identity and corruption detection;
- self events cannot inflate positive counts;
- reversals stay separate;
- outside-window, malformed snapshot, invalid-version, and future-date detection;
- a production-shaped 28/28 fixture;
- numeric gates remain insufficient on tiny data;
- all-large numeric fixtures still cannot set readiness true while label contracts are provisional;
- exact service-role ACL and browser denial;
- reconciler zero on valid data and nonzero on deliberate breakage;
- rollback/teardown leaves the disposable database clean.

Gate-scale performance uses set-based generation for approximately 250,000 visible impressions and at least 100,000 valid finalized views. It records `EXPLAIN (ANALYZE, BUFFERS)` for the readiness call and representative identity/date joins, checks for N+1 or quadratic correlated patterns, records runtime/buffer behavior, and justifies any index change.

Run all ALGO L1-L6, Feed, playback/view, and social observation regressions, changed-scope ESLint, TypeScript baseline comparison, and `git diff --check` before deployment.

## Deployment and rollback posture

Before deployment, verify production migration 324, current reconciler 65/65 zero, observation rows preserved, and exactly one pending F4 migration. Apply only that migration.

After deployment, require migration 325, the generated F4 migration latest, reconciler 68/68 zero, observation counts not decreased, the single retention cron unchanged, policy generation/canary/rollout/global flags unchanged, and readiness `overall_status=NOT_READY`, `training_entry_ready=false`.

The migration is forward-only. Operational rollback is revocation or a later corrective migration; no production rollback, destructive cleanup, or historical migration edit is part of F4.

## Explicit exclusions

F4 creates no model, training job, inference service, model registry, feature store, prediction cache, user vector, dataset table, shadow copy, random split, label builder, second ranker, client API, or synthetic production observation. It does not open the application or generate Feed traffic.
