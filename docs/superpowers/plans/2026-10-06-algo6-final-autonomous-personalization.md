# ALGO-6 Final Autonomous Personalization — Implementation Plan

## 1. Baseline and TDD harness

- Preserve the exact `d84def7...` source in the isolated macro worktree.
- Record focused ALGO/auth/Ads baseline results.
- Add failing static tests for each new authority and failing client/worker tests before implementation.
- Add disposable integration fixtures that start from the current migration chain.

## 2. Personalization foundation migration

- Generate `algo6_personalization_foundation` with Supabase CLI.
- Add the three FORCE-RLS private tables and bounded indexes.
- Seed the safe V1 parent/child taxonomy with localized labels.
- Add catalog, own-profile, save, completion, creator-recommendation, and bounded embedding lifecycle RPCs with exact ACLs.
- Extend the existing reconciler only with non-duplicate foundation checks.
- Prove auth, age reuse, hierarchy, validation, follow requirements, block/privacy filtering, idempotency, and ACL behavior in disposable Postgres.

## 3. Client onboarding and editable settings

- Add a typed `personalizationService`.
- Add the four-step branded onboarding route and edit-mode reuse.
- Add the authenticated server-backed navigation gate.
- Preserve the sessionless email-confirmation sign-up path.
- Add Settings entry and reuse canonical follow mutations.
- Test validation, route behavior, 0/1/2 creator requirements, and edit epoch updates.

## 4. Taxonomy embedding extension

- Add taxonomy job mode to the existing `video-semantic-index` worker and shared embedding pipeline.
- Reuse the same provider/model/dimension/output validation, bounded batching, retry, and fingerprint idempotency.
- Prove unchanged fingerprints cause zero provider calls.

## 5. Ranker personalization and observation V2

- Generate `algo6_personalization_ranker_v2`.
- Add bounded policy weights without changing candidate authority.
- Extend the same `get_ranked_feed_l1_v1` with explicit centroid, language, region, exact decay, and behavioral adaptation.
- Preserve cold/missing-data eligibility, exploration, and creator diversity.
- Change only new observation rows to feature contract V2 and validate the exact old-plus-six key set.
- Update the thin client only for any new canonical mode/metadata shape required by same-ranker L6.
- Prove identical baseline output when personalization/L6 is inapplicable and exact 0/5/10/15/20 decay.

## 6. Final labels, readiness V2, registry, and dormant inference

- Generate `algo6_l6_training_model_pipeline`.
- Privatize historical readiness V1 and publish only service-role V2.
- Implement point-in-time final labels and paged service-only V2 sample extraction.
- Add the single private registry, dormant policy controls, objective weights, SQL prediction helpers, legal promotion/rollback RPCs, and directed `l6` canary support inside the same ranker.
- Keep L6 disabled with no active/canary model in production.
- Prove large disposable fixtures can cross all gates, while current-sized fixtures remain not ready.

## 7. Offline trainer and automation

- Add pinned Python requirements and deterministic six-head trainer.
- Add temporal split, validation-only calibration, untouched-test metrics/guards, and candidate-only registration.
- Add daily plus manual GitHub workflow; missing secrets remain an operational configuration item, not a code redesign.
- Test deterministic payloads and prove no path auto-activates a model.

## 8. Ads V4 bridge

- Audit all V3 normalize/delivery callers before replacement.
- Generate `ads_v2_personalization_targeting_v4`.
- Add only the interest-target relation, V4 normalization, canonical safe-trait resolver, consent/age enforcement, and existing Business Web UI extensions.
- Preserve every V3 audience and campaign; do not rewrite definitions.
- Prove minors/opt-out adults cannot personalized-match, sensitive/unknown topics fail, broad location remains non-precise, and no raw history leaks.

## 9. Verification and performance

- Run static and disposable integration suites after each boundary.
- Run all ALGO L1–L6, Feed/playback/follow, auth/age, Ads delivery/targeting, and affected Business Web tests.
- Compare exact baseline failure names for broader suites; allow no new failures.
- Run changed-scope ESLint, TypeScript, migration dry-run, security/advisor review, `git diff --check`, and duplicate/orphan searches.
- Benchmark cold start, 10-event and 20+-event users, L5 with L6 disabled, and synthetic L6 inference. Add indexes only after EXPLAIN evidence.

## 10. Controlled deployment and closure

- Confirm only the four intended migrations are pending, then deploy them in order.
- Deploy the updated existing semantic Edge Function.
- Process active taxonomy topics once through its bounded authenticated mode; verify every active fingerprint is READY without repeated provider calls.
- Postcheck observations, readiness V2, reconciler, Ads V3 compatibility, policy flags, zero finance changes, and no active/canary model.
- Commit the cohesive macro (and a separate Ads commit only if the final diff justifies it), push normally, verify remote parity/clean worktree.
- Create one `preview-clean` standalone iOS internal build from the final macro SHA and stop with its installation URL.
