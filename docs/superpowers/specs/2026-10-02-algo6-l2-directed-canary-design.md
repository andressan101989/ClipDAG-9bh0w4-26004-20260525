# ALGO-6-L2 Directed Canary Design

## Status and intent

This document records the owner-approved design for a directed physical L2
canary. It extends the existing L1 canary controls without creating another
policy, controller, enrollment path, ranking RPC, or Feed authority. Production
remains globally dormant: `policy_version=nelyon-algo-l1-v1`,
`l2_affinity_enabled=false`, `production_rollout_bps=0`, and the canary is
disarmed after deployment.

The migration, tests, and deployment prepare one authenticated enrolled user to
receive `behavioral_l2` later through an explicit service-role `arm_l2` action.
This block never performs that action.

## Canonical control flow

```text
authenticated app session
  -> request_my_algo_l1_canary_v1()
  -> pending request, target reset to l1, disarmed
  -> later service-role manage_algo_l1_canary_v1('arm_l2', request, ttl)
  -> same user + active TTL + target l2
  -> get_ranked_feed_l1_v1 computes the existing L2 formula
  -> behavioral_l2

all other users + rollout zero
  -> chronological
```

`public.get_ranked_feed_l1_v1` remains the sole organic candidate and ranking
authority. `public.request_my_algo_l1_canary_v1` remains the sole enrollment
RPC. `public.manage_algo_l1_canary_v1(text,uuid,integer)` remains the sole
controller and accepts `arm`, `arm_l2`, and `disarm`.

## Policy extension and guard

`private.algo_l1_policy` receives one operational column:

```text
canary_target_layer text not null default 'l1'
check canary_target_layer in ('l1','l2')
```

The migration does not update the singleton row, so historical request/user,
timestamps, and generation survive unchanged and the new target resolves to
`l1`. The policy guard excludes only this new operational field in addition to
the existing canary fields. Every `l2_affinity_*` field remains algorithmic and
still requires an atomic policy-version change.

Fresh enrollment always sets `canary_enabled=false`, target `l1`, and clears
armed/expiry timestamps without changing generation. A stale historical L2
target can therefore never leak into a new pending request.

## Controller contract

`arm` preserves L1 semantics and explicitly sets target `l1`. `arm_l2` uses the
same pending request and validation envelope, additionally requiring global
`l2_affinity_enabled=false`. It sets target `l2`, enables the canary, writes
server timestamps, and increments generation exactly once. Both actions require
an enabled policy, zero rollout, an inactive canary, an exact pending request
younger than 30 minutes, a real auth user, and a TTL from 5 through 60 minutes.

`disarm` works for either target, disables the canary, and increments generation
without deleting signals or historical request evidence. ACLs remain service
role only for management, authenticated only for enrollment, and anon plus
authenticated for ranked delivery. All functions keep an empty `search_path`.

## Ranking and effective version

The canonical RPC derives these effective states server-side:

```text
directed_l2 = directed_canary AND canary_target_layer = 'l2'
l2_effective = authenticated AND (l2_affinity_enabled OR directed_l2)
behavioral = policy.enabled AND (directed_canary OR rollout_bucket)
```

Mode is chronological when behavioral is false, `behavioral_l2` when
`l2_effective` is true, and otherwise `behavioral_l1`. The existing affinity
formula, weights, decay, horizon, negative gate, per-video/creator caps,
self-exclusion, eligibility, candidate pool, diversity, and Ads boundary do not
change. Only the L2 activation gate changes from the global flag to the effective
flag.

Normal and anonymous users keep the global policy version. Historical L1 canary
versions retain their existing format. L2 tester versions additionally encode
generation, layer `l2`, and active/inactive state. That makes pre-arm, disarmed,
and expired tester cursors fail closed while leaving normal-user cursors stable.

## Reconciliation, security, and acceptance

`public.reconcile_algo_l1_v1()` remains the only health authority and adds:

- `canary_target_invalid`;
- `l2_directed_canary_authority_missing`;
- `l2_directed_canary_state_invalid`.

A legitimate active L2 canary must still reconcile to all zeroes, including
`l2_affinity_unexpectedly_enabled=0`. No new table, cache, materialization,
controller, public helper, native dependency, Ads integration, or financial
dependency is permitted.

Acceptance requires RED-to-GREEN static and disposable tests for dormant
migration behavior, L1 arm regression, directed L2 isolation, exact affinity
formula reuse, cursor invalidation/isolation, expiry, enrollment reset, and ACLs.
Production deployment must add exactly one migration with source/ledger parity,
preserve generation 2, keep global L2 and rollout off, and finish before the
human enrollment/ARM gate.
