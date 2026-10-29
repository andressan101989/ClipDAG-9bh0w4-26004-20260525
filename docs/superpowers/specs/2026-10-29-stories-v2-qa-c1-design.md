# Stories V2 QA C1 — Design

## Scope

Fix the iOS keyboard overlap for Story question responses and add the two creator actions requested from the private question inbox: publish a sanitized answer in a new Story, or open the canonical direct Chat with an editable draft. The change extends the existing Stories B1/C2, Chat, media, and moderation authorities. It does not create or send production content during implementation or verification.

## Decisions

### Exclusive question composer

The inline transformed `TextInput` is replaced by one full-screen modal composer owned by `StoryInteractiveLayer`. The modal uses `KeyboardAvoidingView`, safe-area insets, a scroll container, autofocus, and explicit keyboard dismissal. While open it is the only composer: playback is paused, viewer gestures are blocked, and the general reply/quick-reaction rail is not rendered. Story Realtime refreshes update authorized state without destroying the active draft or closing the inbox.

### Public answer card and private source link

The existing composition authority gains one static, non-interactive `question_answer` element. Its public fields are only geometry, question text, and creator answer text. It contains no respondent identity, source Story/element IDs, response state, avatar, username, or other private metadata.

A forward-only migration adds a forced-RLS private linkage table keyed by the newly published Story and the source response tuple. A new authenticated RPC validates source ownership, question type, moderation state, Story lifecycle, bilateral blocks, media readiness, idempotency, and the exact sanitized projection. It then reuses the existing media Story core, interactive definition installer, C2 safety enqueue, and publish-first fence atomically. Source Stories that are expired, deleted, restricted, removed, hidden, or otherwise stale are not eligible.

The existing Stories safety text bundle is extended so both the public question and creator answer are scanned. The full composition remains part of the fingerprint, so stale evidence cannot authorize modified text.

### Canonical editor handoff

The creator action stores a short-lived, actor-bound, single-use opaque handoff in memory and navigates to the existing feed editor using only the opaque token. The feed consumes the token for the authenticated creator, opens the existing camera/gallery choice, and seeds the existing `StoryEditor` with a movable/scalable/rotatable question-answer card. Publication still requires explicit creator confirmation and compatible private R2/Stream media.

### Canonical Chat handoff

The private action first calls a read-only server preflight that revalidates ownership, lifecycle, moderation, and bilateral blocks. It stores an actor/recipient-bound, short-lived, single-use draft and navigates to the existing direct Chat. The route contains only the opaque draft token in addition to the canonical partner route identity. Chat consumes the draft without sending it. Only the existing explicit send action can call the canonical Chat send authority, which remains responsible for final block, audience, membership, and idempotency checks.

### Release governance

Because the migration deliberately changes governed Stories composition and safety helper definitions, the release policy/compiler/snapshot adapter receive one exact successor transition. It attests the committed migration bytes, changed helper definitions, new private relation/RPC security, zero Edge Functions unless the compiler proves otherwise, Finance GENERAL unchanged, and the installed C2 publish-first authority unchanged. Baseline promotion remains a separate protected PR after a verified postcheck.

## Security invariants

- Private response identities never enter public composition, Realtime payloads, logs, route query text, or signed URLs.
- Only the source Story owner can prepare or publish an answer.
- Hidden/blocked/stale responses cannot be published or handed to Chat.
- Client-provided question text is never authoritative; the server verifies it against the private response.
- Publication is atomic with private linkage, safety enqueue, and the C2 publication fence.
- Replays produce one Story; changed input under the same client identity conflicts.
- No message is sent and no Story is published by navigation alone.
- Existing RLS/FORCE RLS, ACL, fixed `search_path`, MEDIA-C1, P3, Finance GENERAL, and LIVE Battles controls remain unchanged.

## Verification

Use TDD with pure runtime tests for exclusive composer and one-shot handoffs, TypeScript checks for both viewers/editor/Chat, PostgreSQL disposable tests for ownership/privacy/idempotency/rollback/RLS/safety, existing Stories regressions, and Release Gate/Snapshot Adapter suites. Physical iOS keyboard placement remains a separate owner retest and is not reported as PASS from mocks.
