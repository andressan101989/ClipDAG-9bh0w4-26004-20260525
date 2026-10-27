# Stories V2 Safety C2 — Publish First, Async Review

**Status:** Owner-approved operating model for `STORIES-V2-SAFETY-C2`.

## Intent

Stories that satisfy the existing technical, ownership, audience, media-ready,
composition, duration, rate-limit, and idempotency contracts become visible to
their authorized audience immediately. The same creation transaction must leave
a durable, current Content Safety scan record. Classification is asynchronous
and must never be represented as a prerequisite `PASS` for ordinary publication.

This design does not approve numerical moderation thresholds, automatic ALLOW,
or automatic BLOCK. Findings create deduplicated administrative alerts. A human
Super Admin remains the sanction authority.

## Canonical authorities

- Keep `public.stories` and the existing creation RPC overloads as the only
  Story entity/publication boundary.
- Extend `private.story_safety_state`; do not create a second Stories backend.
- Keep `private.content_safety_scans`, `private.content_safety_alerts`, the
  existing scanner Edge Function, cron dispatcher, visual/audio/text evidence,
  and retry authorities.
- Keep `private.admin_content_moderation_state` and the existing audited Story
  moderation capability as the administrative visibility overlay.
- Keep R2/Stream private and continue to authorize every new signed grant through
  Story RLS.

## Three independent facts

The runtime must expose and enforce three different facts:

1. `publication_status`: whether this exact Story was admitted by the C2
   publication transaction (`unpublished`, `published`, `restricted`, or
   `removed`). Existing rows start `unpublished`; there is no historical
   backfill.
2. `moderation_status`: the human-review state (`unreviewed`, `alerted`,
   `reviewed_keep`, `reviewed_restrict`, or `reviewed_remove`). Scanner retries
   cannot overwrite a human decision.
3. `scan_status`: the current durable scan lifecycle derived from the exact
   generation/fingerprint (`queued`, `processing`, `completed`, or `failed`).

Legacy C1 `state` remains technical evidence compatibility only. C2 never writes
`passed` or `blocked` to manufacture normative approval.

## Atomic publication

Every canonical create wrapper must:

1. create or replay the Story under the existing owner/client-story lock;
2. install the exact interactive definitions;
3. hydrate and enqueue the final media/definition fingerprint;
4. verify that the returned scan belongs to the Story and current fingerprint;
5. set the C2 publication marker to `published` in the same transaction.

If enqueue or the publication fence fails, the transaction rolls back. Retrying
the same client identity is idempotent. A provider timeout after commit cannot
unpublish the Story; the durable queue retains bounded retry responsibility.

## Access and media grants

`private.story_can_access` keeps authentication, expiry, ownership, follow/block
audience rules, and the legacy admin visibility overlay. For non-owners it also
requires C2 `publication_status='published'`. It does not require a Content
Safety `passed` decision. Restricted/removed Stories cannot be read, interacted
with, or receive new R2/Stream grants. Already-issued short-lived grants may
remain valid until their bounded TTL; no public object or persistent signed URL
is introduced.

## Async evidence and alerts

The existing scanner processes text, image/video, audio, stickers, prompts, and
options with generation/fingerprint fencing, idempotency, bounded attempts, and
backoff. A successful provider HTTP response is only evidence, never an ALLOW.
Visual, transcript-rule, text-rule, and report findings continue to create
deduplicated alerts through `private.content_safety_alerts`. No enabled numeric
Story rule or automatic-block mapping is introduced by C2.

Scan synchronization may update technical coverage and `scan_status`; it must
not change `publication_status` or overwrite a human `moderation_status`.
Stale generations, deleted Stories, expired Stories, and removed Stories cannot
be resurrected by late completions.

## Administrative decisions

The existing Story moderation command is extended rather than replaced. C2
adds explicit `keep`, `restrict`, and `remove` decisions with the existing
`stories.items.moderate` capability, idempotency key, immutable audit receipt,
reason, actor, and timestamp. `hide`/`restore` compatibility remains intact.

- `keep`: records the reviewed outcome and preserves publication only when no
  independent admin overlay is hiding the Story.
- `restrict`: changes the C2 publication marker to `restricted` immediately.
- `remove`: changes it to `removed` immediately.

Neither restriction deletes physical media. A later administrative
reconsideration is a new audited decision; scanner replay cannot perform it.
Alert resolution remains evidence review, while the Story moderation command is
the enforcement authority.

## Client and Realtime

The existing editor keeps its immediate-success UX and must not label pending
scan work as PASS. Viewer/store reconciliation stays Story-ID anchored. Because
private moderation changes may not yield a readable Realtime row after access is
revoked, a bounded viewer reconciliation loop reuses `loadStories`; it sends no
private evidence or identities. Removal unmounts media and prevents new grants.

The Super Admin Story view adds sanitized publication, moderation, and scan
status plus the existing audited actions. Private question responses remain
private and are not copied into public Story or Realtime payloads.

## Governance and release

C1 historical attestation remains immutable. C2 introduces a phase-specific
release transition, snapshot query, postcheck, and baseline evidence. The HIGH
manifest may contain only the forward-only C2 migration and the existing
`get-stream-playback` Edge Function. That Edge change is required so an
authorized Super Admin can obtain a short-lived, Story-bound Stream grant for
human review without persisting or exposing a private URL. The scanner source
and configuration remain byte-for-byte unchanged; no other Edge change is in
scope.

The release must preserve Creator Premium P3, MEDIA-C1, Finance GENERAL, LIVE
Battles C1, all RLS/ACL/search-path invariants, and zero artificial Stories or
production inferences.

## Non-goals

- No second scanner, alert system, scheduler, Stories provider, or media store.
- No automatic policy thresholds, automatic sanctions, or fabricated PASS.
- No historical backfill or bulk reprocessing.
- No financial, Creator Premium, LIVE Battles, or unrelated MEDIA-C1 change.
