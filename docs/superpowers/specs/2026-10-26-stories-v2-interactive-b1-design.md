# Stories V2 Interactive B1 Design

## Goal and boundaries

Extend the existing Stories authority with one versioned, server-authoritative
interaction engine. Preserve `StoriesProvider`/`StoriesContext`, the existing
editor and native/web viewers, private-media lifecycle, moderation, analytics,
and the single Realtime invalidation channel. Do not create parallel Story,
media, scanner, rate-limit, idempotency, Realtime, or analytics systems.

No normative Stories ALLOW/REVIEW/BLOCK policy is currently owner-approved.
The technical implementation must therefore fail closed (`pending`, `review`,
or `blocked`) and production merge/release must stop until such a policy exists.
An empty ruleset, HTTP 200, or a completed partial scan is never `passed`.

## Interaction authority

`public.stories` remains the lifecycle identity. One private definitions table
is keyed by `(story_id, element_id)` and separates public configuration from a
private quiz answer. One private responses table is unique by Story, element,
and respondent. One private analytics table stores idempotent navigation events.
A public RLS/FORCE-RLS revision table exposes only Story ID, element ID,
revision, and timestamp for invalidation—never responses, identities, totals,
question text, or quiz answers.

Version 1 supports:

- `poll`: 2–6 options, one immutable choice; “multiple” means multiple offered
  options, not multi-select.
- `slider`: normalized `[0,1]`, adjustable until expiry.
- `quiz`: one immutable choice; correct answer private and revealed only after
  the caller responds.
- `question`: one bounded private response, visible to respondent, creator, and
  authorized moderator.
- `reaction`: one positioned emoji response, separate from the legacy bottom
  reaction rail to avoid duplicate logical events.

Creators always see aggregates. Viewers see poll/slider/quiz aggregates only
after their response or expiry. The public composition contains only layout and
stable `element_id` references, never authoritative results or private fields.

One response RPC authenticates, resolves idempotent replay/conflict, consumes
the existing velocity counter only for a new operation, locks Story and element,
checks visibility/block/moderation/safety/expiry, validates the type payload,
writes once, increments sanitized revision, and stores the idempotent response.
Viewer-state, creator-result, question-moderation, and analytics RPCs remain
bounded and least-privilege. Functions use `SECURITY DEFINER`, empty fixed
`search_path`, fully-qualified objects, explicit ACLs, and owner/capability
checks. Private tables expose no client DML.

## Media and safety

Stories gain `pending | review | blocked | passed`; historical rows are never
auto-passed. Third-party visibility and signed-media access require current
`passed` evidence while owners may inspect their own pending draft subject to
admin moderation.

Images remain in private R2 and reuse the existing authorized scanner byte path.
New direct Story videos use the existing private Cloudflare Stream lifecycle,
not a second pipeline. Provider `READY`, trusted duration `>0` and `<=15s`,
current generation/fingerprint, complete visual evidence, complete audio
evidence, and a valid policy decision are mandatory. New direct R2 Story-video
intents are rejected server-side; legacy in-flight rows may finalize for
compatibility but are not publishable through B1. Shared Stories may reuse
source evidence only when policy, fingerprint, generation, and coverage are
current and compatible.

Question text remains private and moderation-pending unless the existing scanner
produces evidence under an approved text policy.

## Rate limits and analytics

Reuse `public.check_velocity_limit` and `public.idempotency_keys`. A Story
operation policy configures conservative initial limits: 25 creates/day, 120
interactions/hour, 50 replies/day, 30 questions/hour, and 20 reports/day.
Replays do not consume another unit.

The existing analytics authority adds idempotent server-time events for
impression, completion, forward, back, exit, and replay. Participation derives
from responses instead of duplicate counters. Views are recorded only after
media readiness.

## Editor, viewer, Realtime

One strict client contract parses legacy v1 and interactive v2 compositions.
Editor and viewers share pure normalized full-media-frame projection/clamp
helpers across safe areas, compact screens, iPad, and split view. The editor
adds bounded create/edit/move/scale/rotate/reorder/delete controls for all types.

Decorative layers remain touch-transparent. Interactive children own accessible
44px targets and gesture capture: focused controls pause, the slider owns its
horizontal gesture, and captured interaction taps never advance the Story.

Viewers anchor by `currentStoryId` and order by `(created_at DESC, id DESC)`.
Realtime inserts cannot change the visible Story, mark another Story viewed, or
reset playback. Deletion chooses a deterministic adjacent Story or closes.

The existing provider channel listens to lifecycle plus sanitized revision
invalidations and always re-queries under authorization. Signals coalesce;
`CHANNEL_ERROR`, `TIMED_OUT`, and `CLOSED` retry with jittered exponential
backoff capped at 30 seconds, bounded fallback polling, and foreground reconcile.

## Release boundary

The likely secure graph is one forward-only migration plus the existing five
functions `create-media-upload`, `create-stream-upload`, `stream-webhook`,
`get-stream-playback`, and `content-safety-scan`; the compiler is authoritative.
Any larger graph must be justified by exact imports.

Version-1 Stories, shared Stories, replies/reactions, admin moderation, cleanup,
and unrelated modules stay compatible. Web video playback remains a documented
pre-existing limitation unless it can reuse the current player without creating
a second authority.

Implementation and isolated verification may complete now. A protected PR may
be reviewed, but it must not merge or release until owner-approved Stories
policy, exact governance attestation, backup, snapshot, plan, and gate proof are
available. Physical QA is required before ROADMAP 4 closure.
