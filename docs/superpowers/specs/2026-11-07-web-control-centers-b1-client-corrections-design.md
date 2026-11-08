# WEB-CONTROL-CENTERS-B1 Client Corrections Design

## Scope

This correction is client-only. It changes no SQL, migration, RPC, Edge Function,
Supabase policy, production data, or deployment artifact. Durable recovery after a
cold restart remains outside this scope.

## Draft inbox pagination

The existing service page contract (`items` plus `nextCursor`) remains canonical.
`DraftManager` will expose that contract to the inbox instead of flattening and
discarding it. The inbox will:

- replace rows on an initial/refocus load;
- append rows for a continuation cursor;
- deduplicate by draft id while preserving server order;
- preserve page 1 when a later page fails and expose a controlled retry;
- fence responses by authenticated owner and request generation;
- avoid concurrent requests for the same continuation cursor.

No RPC or cursor semantics change.

## Revision-bound publication

Publishing a restored draft is an ordered mutation:

1. If the visible caption differs from the restored canonical caption, update the
   draft with the visible revision using the existing CAS contract.
2. Await the confirmed updated draft.
3. Publish exactly that confirmed draft revision.
4. Clear the editor only after confirmed publication.

Save, publish, and delete share one per-draft mutation lock. A publish attempt is
identified by `{commandId, revision}`. The command is reused only for an ambiguous
failure of that same revision. A deterministic conflict clears the attempt so a
fresh revision can start a fresh command.

`draft_publish_command_conflict` is deterministic. Transport loss and provider
timeouts remain ambiguous. Existing receipt replay and in-memory materialization
contracts provide same-runtime lost-response recovery; no durable cold-restart
store is added.

## Upload composer serialization

Photo/carousel draft saving and direct publishing share a synchronous mutation
gate so two taps in the same event turn cannot launch both operations. The UI
disables both actions while either one is in flight and preserves the current
selection on failure.

## Verification

Behavioral tests cover 51+ drafts, continuation retry, stale-owner fencing, dirty
caption publication, CAS failure, operation serialization, revision-bound command
reuse/rotation, deterministic error classification, and same-runtime replay. The
existing B1 regressions, focal TypeScript, focal ESLint, and diff checks must pass.
