# Stories V2 Final Governance Recovery Design

## Objective

Remove the reproducible `REMOTE_BASELINE_MISMATCH` without weakening the
release gate, then deliver the already-integrated Stories Safety C2 manifest
through the protected production workflow.

## Proven root causes

1. Supabase returns the same Security Advisor facts through two shapes:
   flat Management API lints with a provider `cache_key`, and grouped MCP
   findings without that field. The endpoint is experimental, so the provider
   field cannot be treated as an independently trusted normative identity.
2. `buildProductionBaselineDigests()` filters the static predecessor exception
   set. Runtime capture and RPC attestation correctly use the phase-effective
   set produced by `advisorExceptionsForPhase()`. At the current phase this is
   42 current authorities, not the 34 predecessor records.
3. Two F2 fingerprints are intentionally historical predecessors. Their live
   compatibility RPCs remain secure and are already represented by current
   successor attestations. No SQL, ACL, or Finance change is required.
4. Before the final baseline is promoted, the policy still names C1 as its
   latest migration. Baseline construction must therefore recognize the C2
   state from the observed, complete migration inventory after release.

## Canonical Advisor representation

The snapshot adapter owns one normalizer for both raw and grouped payloads.
It flattens grouped findings, validates declared counts, and projects only:

- lint name;
- severity level;
- facing;
- sorted categories;
- stable metadata after removing observation timestamps;
- a canonical cache identity derived from the same semantic fields rather
  than copied from the provider payload.

The derived cache identity preserves the already-reviewed historical
fingerprints while making them independent of whether Supabase includes,
omits, or changes the transport `cache_key`. Duplicate semantic identities or
malformed grouped counts fail closed; findings are never silently removed.

## Phase-effective baseline

`buildProductionBaselineDigests()` resolves exceptions through
`advisorExceptionsForPhase(policy, null, 'post', { migrations })`. The observed
migration inventory is complete and determines installed transitions. Stories
B1 historical removed findings remain explicit evidence, while current Finance
successors replace predecessor records only when their exact RPC attestations
match.

The two legacy RPCs remain deployed compatibility surfaces with owner
`postgres`, `SECURITY DEFINER`, `search_path=""`, and EXECUTE limited to
`authenticated` and `postgres`. They are not modified.

## Delivery sequence

1. Add RED tests for raw/grouped parity, cache-key independence, malformed
   groups, duplicates, semantic changes, phase-effective exceptions, and
   observed C2 state.
2. Implement the minimal adapter correction and make the targeted plus full
   release-governance suites GREEN.
3. Merge the normalization through its protected PR. This freezes the exact
   adapter bytes and integrated candidate SHA that owner evidence must attest.
4. Run a fresh official `plan_only` from that integrated SHA, then capture
   owner-control-plane evidence through read-only official Supabase APIs using
   the new manifest and adapter. Regenerate all seven baseline digests and
   update the policy in a separate protected pre-release baseline PR. This
   separation avoids a circular attestation that a rebase merge could
   invalidate. The productive baseline identity remains the deployed C1 source
   (`e4c7199...`, 359 migrations); only its corrected evidence metadata and
   digests are promoted before C2.
5. Merge the baseline by rebase, synchronize only
   `NELYON_RELEASE_POLICY_SHA256`, and verify exact readback.
6. Run fresh `plan_only`, `gate_proof`, and `release` for exactly the C2
   migration and `get-stream-playback`.
7. Run postcheck, promote a separate final production baseline, synchronize the
   final policy digest, and require `NO PRODUCTIVE CHANGES`.

## Safety invariants

- No Advisor finding or severity is hidden.
- No Security Advisor scope is reduced.
- No SQL, Edge source, Finance rule, ACL, P3, MEDIA-C1, or LIVE Battles logic is
  changed by the governance correction.
- C2 remains exactly one migration and one Edge Function.
- No synthetic Story, inference, or financial movement is created.
- Physical QA is prepared but never reported as passed without device evidence.
