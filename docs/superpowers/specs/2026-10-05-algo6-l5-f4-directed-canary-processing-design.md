# ALGO-6 L5-F4 Directed Canary Processing Design

## Intent

Extend the existing ALGO-6 canary authority to support `arm_l5` without
creating a second controller, ranking RPC, policy row, enrollment path, or
semantic store. Production remains globally dormant and the phase stops before
human enrollment or ARM.

## Database design

- Extend the existing `canary_target_layer` constraint with `l5`.
- Replace `public.manage_algo_l1_canary_v1(text, uuid, integer)` in place so
  `arm_l5` maps to target `l5`, retains all existing gates, and additionally
  rejects any global L2/L3/L4/L5 conflict.
- Replace `public.get_ranked_feed_l1_v1(...)` in place. A directed L5 canary is
  effective only for the enrolled tester and activates L1 + L5, never L2-L4.
- Preserve the existing RPC signature, result shape, cursor, candidate pool,
  and F3 semantic formula.
- Extend `public.reconcile_algo_l1_v1()` from 55 to 57 counters with the two
  approved L5 directed-canary checks.

## Controlled production processing

After migration parity and a clean reconciler, call the existing service-only
refresh RPC exactly once for each approved video ID. Assert that the complete
profile set is exactly those two rows before every Edge processing invocation.
Only the stream-backed video may be claimed by `process_visual`; then the
existing `process` mode may produce the two BGE-M3 embeddings. No third target,
bulk refresh, direct completion, or provider-code change is permitted.

## Human gate

Prepare an isolated Expo worktree with enrollment enabled and leave Metro plus
its tunnel running. Do not open the application, mutate a save, create an
enrollment request, ARM, DISARM, or enable global L5. The owner performs those
actions only after the audit of this phase.

## Verification

Use test-first static and disposable integration coverage for controller
compatibility, L5 isolation, suffixes, global conflict gates, semantic minimum
gate, scoring, reconciler count, and absence of duplicate authorities. Compare
base and branch regressions by exact failed-test name and verify production
dormancy, cohort exactness, signals, finance, Git parity, manifest, and bundle.
