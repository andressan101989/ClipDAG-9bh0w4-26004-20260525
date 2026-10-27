# Stories V2 Safety C1 — Technical Policy Preparation Design

## Outcome

Install a tamper-evident, Story-specific safety policy candidate and close the
known evidence-identity gaps while preserving the B1 invariant: no non-owner
can see a Story without a current `passed` decision. The release remains
`fail_closed_review`; it does not authorize automatic `ALLOW`, `BLOCK`, or
general publication.

The exact normative artifact is
`docs/stories-v2-content-safety-policy-candidate-v1.json`. Its byte SHA-256 is
bound by the migration and release manifest. Approval requires a subsequent,
explicit owner statement naming that exact digest. This phase never infers
approval from the implementation request.

## Existing architecture reused

- `private.story_safety_state` remains the lifecycle authority.
- `private.content_safety_scans`, transcript evaluation, visual analyses, and
  alerts remain the single evidence pipeline.
- `content-safety-scan` remains the single scanner. No Edge deployment is
  required for the inactive preparation contract.
- `private.story_can_access` remains the single visibility authority.
- MEDIA-C1 retains ownership of private R2/Stream lifecycle and cleanup.
- Creator Premium P3 keeps its policy, contextual schema, prompt, and decision
  functions unchanged.

## Technical changes

1. Add private functions exposing the exact candidate identity, inactive
   control state, and a fail-closed decision-candidate ABI.
2. Build one deterministic Story author-text bundle containing composition
   text plus interactive prompts and option labels; never include a private
   quiz answer.
3. Version the Story evidence fingerprint so historical scans cannot silently
   claim the expanded text coverage.
4. Require completed transcript rule evaluation (or explicit no-audio) before
   audio evidence is complete.
5. Make same-identity create replays preserve their current scan/evidence
   instead of resetting audio and visual work.
6. Require `story_can_access` to match any future `passed` row to an active,
   owner-approved policy digest. The C1 implementation always returns false.
7. Keep all complete evidence in `review` and all incomplete/failed/stale
   evidence in `pending`; write no `passed` or policy digest.

## Policy proposal

The candidate defines the requested ALLOW/REVIEW/BLOCK vocabulary and the
required image, video, audio, text, interactive, and viewer-response evidence.
It deliberately contains no approved numeric confidence threshold. Until the
owner approves the exact artifact and a compatible contextual decision schema,
automatic allow/block are false and every completed Story remains private for
human review.

Viewer question answers remain private/pending under B1. The candidate makes
automatic moderation of those answers an activation blocker rather than
pretending the Story-level scan covers a distinct viewer response.

## Security invariants

- New functions are `SECURITY DEFINER SET search_path=''`, owned by `postgres`,
  and revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- No new public RPC, table grant, provider, secret, or signed-media surface.
- No existing Story row is promoted or reclassified.
- Missing, malformed, failed, or stale evidence cannot publish.
- P3 and MEDIA-C1 function bodies and public ABIs remain unchanged.

## Release shape

The productive manifest is one forward-only migration and zero Edge Functions.
Release governance receives a separate phase transition from the installed B1
fail-closed phase to the C1 technical-prep fail-closed phase. The snapshot
attests exact policy digest, inactive control state, function definitions,
Story counts/decisions, P3, Finance, and the migration inventory.

## Approval boundary

The technical release can be integrated and deployed now because it preserves
fail-closed behavior. Activation is a later step inside this C1 policy process
and requires explicit approval of the exact artifact digest plus verified
contextual model/schema evidence. No automatic inference or Story publication
is run to manufacture that evidence.
