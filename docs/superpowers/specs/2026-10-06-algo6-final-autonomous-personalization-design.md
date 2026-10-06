# ALGO-6 Final Autonomous Personalization — Design

## Scope and invariants

This macro adds cold-start personalization, continuous behavioral adaptation, and dormant L6 ML plumbing without creating a second Feed, event ledger, semantic-video authority, follow authority, Ads audience system, or online inference service.

The following remain canonical:

- `public.get_ranked_feed_l1_v1` is the only online organic Feed ranker.
- `public.video_views`, `public.likes`, `public.video_saves`, and `public.follows` remain behavioral truth.
- `private.video_semantic_profiles` remains the only video-semantic authority.
- the L6 decision/item/impression/engagement chain remains the only observation ledger.
- the existing Ads audience/version system remains the only Ads targeting authority.
- `private.user_age_eligibility` remains the only age authority.

Personalization is additive, bounded, point-in-time observable, and fail-soft. L6 inference is disabled by default. Candidate training can be automated only after all approved gates pass; activation is never automatic.

## Private personalization authority

Three FORCE-RLS tables form one authority:

1. `private.personalization_interest_taxonomy` stores stable topic slugs, localized labels, safe semantic text, hierarchy, minor/Ads eligibility, and BGE-M3 embedding lifecycle state.
2. `private.user_personalization_profiles` stores onboarding state, self-declared content languages and broad content region, organic personalization state, Ads consent, and the preference epoch.
3. `private.user_personalization_interests` stores only explicit topic selections. Behavioral evidence is never copied here.

All browser access is through narrow authenticated RPCs. No browser role receives direct table privileges. A user can read or replace only their own preference contract through those RPCs.

Taxonomy V1 contains the sixteen approved parents and safe child topics. Every parent has a `<parent>_general` child so the explicit General choice is represented by a stable topic, not a display string. Supported localized labels are `es`, `en`, `pt`, and `fr`. Sensitive categories are forbidden.

## Onboarding lifecycle

A server-backed gate is evaluated after authentication and before Feed providers render:

- an eligible authenticated user with incomplete onboarding is routed to `/onboarding/personalization`;
- a completed user may enter Feed;
- an unavailable status check fails open with telemetry-safe UI recovery rather than trapping the account;
- email-confirmation sign-up remains sessionless and is checked on the first successful login.

The four logical steps are language/region, parents, subtopics, and creators. Validation is repeated server-side. Completion requires 3–8 active parent topics, one child or General topic for every selected parent, and existing canonical follows to the required number of currently eligible recommended creators (2, 1, or 0 according to availability; selection is capped at 5).

Settings reuses the same screen in edit mode. Saving explicitly changes `preferences_updated_at`, restarting the seed-decay epoch.

## Creator recommendations

`public.get_my_onboarding_creator_recommendations_v1` produces safe presentation rows only. Its bounded score combines:

- cosine similarity between the selected taxonomy centroid and ready canonical video embeddings;
- content-language match;
- broad, self-declared creator content-region match;
- bounded quality evidence;
- logarithmically capped popularity;
- deterministic diversity.

It excludes self, either-direction blocks, unavailable/private/ineligible profiles, hidden or moderated content, and creators that cannot be followed through the canonical relationship authority. The RPC never mutates follows.

## Cold-start and adaptive ranking

The existing ranker obtains the completed viewer profile and selected ready taxonomy embeddings. It computes:

`behavioral_confidence = least(1, distinct_behavior_signal_videos_since_preferences_updated_at / 20.0)`

`explicit_seed_weight = greatest(0, 1 - behavioral_confidence)`

The exact required milestones are therefore 1.00, 0.75, 0.50, 0.25, and 0.00 at 0, 5, 10, 15, and 20+ distinct evidence videos.

Eligible evidence is external like/save/follow-affinity and valid completion, long-watch, rewatch, or short-swipe evidence. Background, unmount, and missing finalized views are excluded from negative-interest evidence.

The ranker adds bounded features:

- `explicit_interest_similarity`
- `explicit_interest_points`
- `preferred_language_points`
- `content_region_points`
- `explicit_seed_weight`
- `behavioral_confidence`

Interest points decay; language and broad-region boosts do not. Missing taxonomy/video embeddings are neutral. Candidate eligibility, exploration, creator diversity, and all safety/visibility authorities remain intact.

## Observation feature contract V2

New decisions use `organic-ranking-features-personalization-v2`. Their snapshots contain the full legacy V1 numeric allowlist plus the six personalization fields. Historical V1 observations remain valid and immutable. The online ranker never reads observation snapshots.

## Final label contract V1

The training unit is a mature (at least 24 hours old) visible organic impression with an exact `client_event_id` join where a finalized view is required.

- Long watch: valid retention; positive at `completion_ratio >= 0.50`, otherwise negative.
- Completion: valid retention; canonical `completed` boolean.
- Early exit: valid retention; positive only for swipe below the point-in-time policy short-watch threshold. Negative is completion, ended, or swipe at/above threshold. Background, unmount, unknown, and missing views are excluded.
- Rewatch: valid retention; `rewatch_count > 0` versus zero.
- Like/save: mature external impressions; final attributable state within 24 hours after applying ordered action/reversal events. No final retained action is negative.
- Follow: an auxiliary monitored head, not a global readiness gate.

Self-authored engagement is excluded. Raw reversals remain auditable.

## Readiness V2 and temporal evaluation

`public.get_algo6_l6_training_readiness_v2` becomes the sole public readiness authority; V1 is retained privately for history. It is service-role-only, aggregate-only, and dynamically evaluates:

- 250,000 unique compatible V2 visible impressions;
- 100,000 valid retention samples;
- 2,000 authenticated viewers, 2,000 videos, 200 creators;
- 84 consecutive mature observation days;
- all approved per-head support gates;
- at least 500 sparse positives in validation and 500 in untouched test;
- zero structural failures.

The approved time split is oldest 8 weeks for train, next 2 for validation, and latest 2 for untouched test. `training_entry_ready` can become true only when every mandatory condition passes.

## Model pipeline and registry

`private.algo6_model_versions` is the only registry. A service-only paged dataset RPC returns allowlisted numeric V2 snapshots and finalized labels. The Python pipeline:

1. checks readiness V2;
2. exits successfully when not ready;
3. pages samples without logging secrets or identities;
4. performs the fixed temporal split;
5. trains six independent logistic heads;
6. fits sigmoid/Platt calibration on validation scores only;
7. evaluates the untouched test;
8. registers only a deterministic coefficient/calibration payload as `candidate` or a bounded rejection audit.

The daily/manual workflow references repository secrets and never activates a model.

## Same-ranker inference and promotion

Policy gains dormant L6 controls and versioned objective weights. SQL evaluates small logistic payloads inside `get_ranked_feed_l1_v1`; there is no network inference. When L6 is disabled or no compatible selected model exists, output is exactly the non-L6 path. Directed `l6` canary is isolated. Promotion operations are service/admin-only and validate contracts, metrics, reconciler health, legal transitions, and the single-active invariant. Global activation is a separate explicit promotion/policy action; rollback selects a prior compatible model atomically.

## Ads V4 bridge

Ads V4 extends the existing versioned audience definition with safe taxonomy slugs, supported content languages, and broad country/region. It adds only the minimum interest-target relation and reuses canonical profiles/resolution. V3 versions remain immutable and deliverable; no existing campaign changes automatically.

- Minors never use explicit or behavioral interest targeting.
- Adults require `ads_personalization_consent = true` for personalized matching.
- Unknown, inactive, sensitive, or `ads_eligible = false` topics are rejected.
- Precise location remains disabled.
- Advertisers never receive raw history, watched video IDs, embeddings, or private profiles.

## Deployment and rollback

Four forward-only migrations isolate the authority boundaries: personalization foundation, ranker/feature V2, L6 training/model pipeline, and Ads V4. Production deployment occurs only after static, disposable-DB, regression, security, and performance gates. Taxonomy embeddings are processed once through the existing semantic Edge Function and fingerprint protocol. No model is trained from the current tiny production dataset. The final artifact is an internal standalone iOS preview from the macro branch; main is not advanced.
