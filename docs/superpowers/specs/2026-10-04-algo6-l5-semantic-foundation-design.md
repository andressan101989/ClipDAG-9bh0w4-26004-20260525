# ALGO-6-L5-F1 Semantic Embedding Foundation Design

## Status and intent

This document records the owner-approved design for the first ALGO-6 L5 phase.
F1 establishes one derived semantic authority for organic videos without reading
that authority from Feed ranking. Production is deployed dormant: no existing
video is backfilled, no provider processing is invoked, no L5 mode exists, and
the L1-L4 policy remains unchanged.

The canonical authority is `private.video_semantic_profiles`. One row represents
the current semantic input provenance, finite work lifecycle, and canonical dense
embedding for one `public.videos` row. Supabase PostgreSQL with pgvector is the
only vector store. There is no PGMQ queue, second profile table, Vectorize index,
user-interest vector, semantic rank cache, or alternate ranking RPC.

## Canonical data flow

```text
public.videos semantic content change
  -> private.video_semantic_input_v1(video_id)
  -> caption + optional matching canonical transcript
  -> deterministic semantic fingerprint
  -> private.sync_video_semantic_profile_v1(video_id)
  -> private.video_semantic_profiles pending/not_eligible state
  -> service-only bounded claim with FOR UPDATE SKIP LOCKED
  -> video-semantic-index service-only Cloudflare Workers AI call
  -> stale-safe complete/fail RPC
  -> extensions.vector(1024) in the same canonical row
```

Triggers stop after the sync step. They never perform HTTP, provider, or browser
work. The Edge Function is the only provider adapter and can process only after
an exact constant-time match against the server-side service-role credential.

## Semantic document and provenance

`private.video_semantic_input_v1(uuid)` is a stable, read-only JSONB builder. It
uses `private.content_safety_target_snapshot('video', video_id)` and
`private.content_safety_sha256(text)` so L5 cannot invent a second meaning of
"content version." It returns the video ID, source/content/input fingerprints,
input version, optional transcript provenance, detected language, input text,
component list, eligibility, and reason.

The document is deterministic:

```text
caption:
<trimmed, whitespace-collapsed caption; maximum 2048 characters>

transcript:
<trimmed, whitespace-collapsed transcript; maximum 12000 characters>
```

The transcript block is omitted unless the newest deterministic candidate is
linked through a video Content Safety scan, matches the current source content
fingerprint, is from the canonical Cloudflare Whisper model, has
`no_speech=false`, positive word count, and non-empty text. The total document is
bounded to 15000 characters. If neither component exists the profile is
`not_eligible`; no zero or random vector is manufactured.

The semantic fingerprint binds `video-semantic-v1`, the canonical source content
fingerprint, and the canonical document. Caption and transcript fingerprints are
retained as provenance, but semantic text is not copied into the profile table.

## Lifecycle and idempotency

The only statuses are `pending`, `processing`, `ready`, `failed`, and
`not_eligible`. Attempt count is bounded to five and provider-call count is
non-negative.

- A missing profile is inserted as `pending` or `not_eligible`.
- A changed semantic fingerprint clears the vector and retry state.
- An unchanged `ready` profile preserves its vector exactly.
- An unchanged failed profile may be deliberately requeued by the service-only
  refresh authority; pending, processing, ready, and not-eligible state otherwise
  remains idempotent.
- Claim selects only due pending rows with attempt count below five, locks with
  `FOR UPDATE SKIP LOCKED`, recomputes current input, and skips any row that had
  to be resynchronized during that claim.
- Complete locks and recomputes. A stale result resynchronizes the canonical row
  and returns a deterministic stale receipt without storing the old vector.
- Fail stores only a normalized bounded code, never provider text or a stack, and
  applies bounded exponential retry until five attempts.

## Provider worker

`supabase/functions/video-semantic-index` uses the existing Cloudflare Workers AI
account and token family. The model is `@cf/baai/bge-m3`; dense output must contain
exactly 1024 finite numeric components per claimed input. Batches default to 8
and cannot exceed 25. Provider response count, shape, finiteness, and serialized
size are validated before any completion RPC.

Both `status` and `process` modes require an exact constant-time comparison of the
bearer credential with `SUPABASE_SERVICE_ROLE_KEY`; a decoded role claim is not
sufficient. `status` performs no database mutation, claim, or provider call.
`process` is finite and is not invoked in F1 production.

## Database security

The vector extension is installed in `extensions`; the column type is
`extensions.vector(1024)`. The private table has RLS enabled and no direct table
privileges for `PUBLIC`, `anon`, `authenticated`, or `service_role`. Public
`refresh`, `claim`, `complete`, and `fail` RPCs are `SECURITY DEFINER`, set an
empty search path, fully qualify objects, and grant execute only to
`service_role`. Private helpers are not browser executable.

Only an operational partial index for due pending work is created. No HNSW or
IVFFlat index is justified before L5 has an actual retrieval query.

## Explicit exclusions

F1 does not modify `public.get_ranked_feed_l1_v1`, `private.algo_l1_policy`, the
Feed client, ranking modes, canary controls, or L1-L4 formulas. It does not create
`behavioral_l5`, a semantic score, a user/creator vector, or a browser semantic
read path.

The semantic input has no dependency on reports, alerts, warnings, visual-safety
results, Ads targeting, Marketplace/orders/shipping, finance/wallet/ledger,
messages/chat, location, protected characteristics, or device/network context.
Existing visual analyses are moderation artifacts and remain excluded.

## Dormant deployment and reconciliation

Installing triggers does not fire them for existing rows. Immediately after the
single forward-only migration, all seven preexisting production videos therefore
have zero semantic profile rows. No refresh, claim, process request, or provider
call is made.

The existing reconciler grows from 43 to exactly 48 counters with:

- `l5_vector_extension_missing`
- `l5_semantic_profile_authority_missing`
- `l5_semantic_queue_authority_missing`
- `l5_parallel_semantic_authority_present`
- `l5_sensitive_semantic_source_present`

All must be zero while policy, signals, finance, and chronological Feed output
remain unchanged.
