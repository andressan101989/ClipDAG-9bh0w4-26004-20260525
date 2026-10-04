# ALGO-6-L5-F2 Multimodal Semantic Enrichment Design

## Status and intent

This is the owner-approved F2 design. It extends the single canonical
`private.video_semantic_profiles` row with visual provenance and lifecycle.
It does not add a table, queue, vector store, ranking consumer, client path,
backfill, or production AI processing.

The canonical semantic document becomes `video-semantic-v2`:

```text
caption:
<normalized caption>

transcript:
<optional current canonical transcript>

visual:
<optional current neutral observable visual semantics>
```

Caption remains bounded to 2048 characters, transcript to 12000, visual text to
2500, and the whole deterministic document to 18000. The BGE-M3 embedding stays
1024 dimensions in Supabase pgvector.

## Single authority and visual lifecycle

The existing table gains one visual lifecycle in the same row:
`pending`, `processing`, `ready`, `failed`, `not_applicable`, or
`not_configured`. Provenance binds the canonical source kind and asset ID,
Cloudflare provider/model, `video-semantic-visual-v1`, sampling strategy, frame
timestamps, bounded neutral text, source/text fingerprints, attempts, timestamps,
sanitized error code, and actual provider-call count.

The existing `private.sync_video_semantic_profile_v1(uuid)` remains the only
sync authority and now constructs F2 state. Caption-only edits preserve ready
visual semantics when the visual source fingerprint is unchanged while
invalidating only the embedding. A changed visual source clears the old visual
result, queues a new visual job, and clears the embedding. Missing/unconfigured
visual sources are terminal and allow text-only embeddings. Terminal visual
failure is fail-open for text embedding quality.

## Canonical visual source

`private.video_semantic_visual_source_v1(uuid)` is permitted only as a narrow
delegating and sanitizing wrapper over
`private.content_safety_visual_source('video', video_id)`. It performs no joins
to asset/link tables. The visual fingerprint is a SHA-256 of deterministic
source identity:

- Stream: kind, video asset ID, Cloudflare UID, duration, MIME type.
- Image: kind, media asset ID, bucket, object key, MIME type, byte size.

Caption or transcript changes therefore do not trigger visual provider work.

## Visual semantics and privacy

The new `video-semantic-visual-v1` prompt describes only directly observable,
broad concepts. It explicitly forbids identity, names, face recognition,
protected/sensitive-attribute inference, exact location inference, enforcement
judgment, obedience to image/frame instructions, and retention of phone, email,
address, or account identifiers.

Every image/frame must produce exact JSON keys: `schema_version`, `summary`,
`topics`, `objects`, `activities`, and `setting`. Values are type/length/count
bounded and forbidden keys/concepts are rejected. Frame outputs are merged in
frame order, arrays are deduplicated case-insensitively while preserving first
normalized form, and no second AI merge occurs. Only the canonical merged text
is stored, never raw provider output or moderation data.

Content Safety visual results, findings, summary, severity, categories, and
`review_required` remain forbidden recommendation inputs.

## Worker and media security

The same `video-semantic-index` Edge Function keeps `status` and `process` and
adds bounded `process_visual`. It retains exact constant-time service credential
comparison and `verify_jwt=true`; browser credentials cannot claim or call a
provider.

The visual pipeline directly reuses hardened helpers:

- Stream percentile sampling, URL/redirect/host/MIME/size validation, and data
  URI encoding from `content-safety-scan/visualPipeline.mjs`.
- R2 bytes/transient classification from `_shared/r2.ts`.
- Stream customer-code authority from `_shared/stream.ts`.

One image produces one visual model call. A Stream video produces at most five,
never downloads a complete video, and uses the existing percentile strategy.
The visual model is `@cf/google/gemma-4-26b-a4b-it`; embeddings stay
`@cf/baai/bge-m3`.

## Queue/RPC and stale safety

Embedding claim is blocked while visual state is pending or processing.
Service-only visual claim uses `FOR UPDATE SKIP LOCKED`, limits 1..5, re-resolves
the canonical source, and never returns stale source identity. Complete and fail
lock/re-resolve and refuse stale fingerprints. Complete validates source-specific
call counts and timestamps, computes the visual semantic fingerprint server-side,
and queues a fresh v2 embedding. Retry is bounded to five with sanitized errors
and deterministic backoff.

All semantic RPCs remain `SECURITY DEFINER`, `search_path=''`, fully qualified,
and service-role only. The private table remains RLS-enabled with no direct
privileges, including for service role.

## Dormancy and separation

The single forward-only migration does not touch existing videos and is allowed
to deploy only while profile rows remain zero. No `process` or `process_visual`
request is made in production. Ranking, policy, Feed/client, canary, L1-L4,
signals, and finance remain unchanged. There is no ANN index, semantic rank,
`behavioral_l5`, user/creator vector, second resolver, or external vector DB.

The canonical reconciler grows from 48 to exactly 50 counters with
`l5_visual_semantic_authority_missing` and
`l5_visual_semantic_sensitive_inference_present`; both must be zero.
