# Creator Premium B7 Physical QA C1 design

## Status and authority

This design implements the owner-approved `CREATOR-PREMIUM-B7-PHYSICAL-QA-C1`
brief. The owner explicitly selected Native execution and authorized implementation,
tests, a protected PR, canonical release, and Expo bundle refresh. That prior approval
is the design gate; no second approval prompt is required.

## Evidence and root causes

- `origin/main` is `9d5afa4dd0eb48040a18b40e53e7dec22ecf2f33`, tree
  `5f43e075965401c682008cf10b251c463a44497e`.
- The hub renders each content card as a non-interactive `View`. Only drafts and
  rejected items receive a button. `pending_review`, published, quarantined,
  removed, and deleted items end in a non-actionable “Solo lectura” row.
- The editor already supports a server-authoritative retry for `failed` and the
  B7 legacy marker, but has no cancellation operation. Production contains no
  creator lifecycle RPC with cancellation semantics.
- The video picker calls `expo-document-picker` directly. The image picker already
  uses the native iOS photo library through `expo-image-picker`.
- Premium screens duplicate decimal presentation and retain all eight stored
  fractional digits. The canonical financial values are strings and must remain
  strings; only rendering changes.
- The production row “Que rico se sintió” failed because its bound scan completed
  text/reports but visual analysis failed once with
  `visual_workers_ai_structured_output_invalid_json`. The row “Prueba” is the
  intentionally preserved B5 legacy row and has no scan. There are zero approved
  and zero active Content Safety rules. Therefore retries may be exposed, but no
  client or migration may claim approval or publication.

## Design

### Card interaction and lifecycle presentation

Every Premium content card becomes an accessible `Pressable` that opens the one
existing editor/detail route with only `contentId`. A pure presentation contract maps
the server lifecycle and verification fields to a stable label, explanatory copy,
tone, polling decision, and allowed commands. It does not authorize state changes.

- `draft`: editable; save/upload/delete remain available.
- `pending_review/pending`: read-only detail, bounded polling, cancel request.
- `pending_review/failed`: read-only detail, explicit cause, retry, cancel request.
- B7 legacy `pending_review/not_requested`: read-only detail, one-time retry, cancel.
- `pending_review/commercial_pending`: read-only detail, no scan spinner, cancel.
- `rejected`: existing authenticated reopen-to-draft action.
- `published`, `quarantined`, `removed`, `deleted`: historical/read-only detail.

Nested card actions stop event propagation so opening a command does not also open
the detail route.

### Cancellation authority

Add one forward-only migration defining
`public.cancel_my_creator_premium_submission_v1(uuid)`. It is the missing narrow
authority, not a second backend. The RPC:

- requires `auth.uid()`, creator age eligibility, and an operational account;
- locks the same content advisory key and owner row used by submit/update/delete;
- accepts `pending_review`; an already-draft replay is a no-op;
- rejects published, rejected, quarantined, removed, and deleted states;
- increments `verification_generation` before clearing the current binding, making
  any in-flight completion stale;
- returns the content to `draft`, clears submission/review/verification binding and
  timestamps, and preserves media, offers, plan mappings, entitlements, and scan
  history;
- is `SECURITY DEFINER SET search_path=''`, owned by `postgres`, revoked from
  PUBLIC/anon/service_role, and granted only to `authenticated`.

The client invokes this RPC through the existing canonical Premium service. Deletion
remains the existing draft-only cleanup authority; a creator cancels a pending
submission before deleting it.

### Native video selection

Replace the default video document-picker action with
`ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] })` after the existing
photo-library permission. Preserve MIME, size, 60-second duration, cancellation,
upload progress, Stream private upload, and cleanup contracts. A separate “Elegir
desde Files” action retains the existing document picker as an explicit fallback.
This is JavaScript-only and needs no new development-client build.

### Exact BDAG presentation

Create one Premium presentation helper that accepts the authoritative decimal string,
rounds for display to two places using string/`BigInt` arithmetic, groups thousands
with `.`, and uses `,` as the decimal separator. It never converts financial strings
to `Number` and never changes values sent to PostgREST. Apply it to content, plans,
offer, subscriptions, gross, fee, creator net, refunds, retained net, and Premium
transaction rows.

### Content Safety states

Keep backend lifecycle and verification fields authoritative. The client presents:
`not_requested`, `pending`, `failed`, `commercial_pending`, `blocked`, `restricted`,
`passed`, plus lifecycle `published` and `deleted`. Policy error codes render as
“awaiting policy” with no spinner. Provider failure renders its real technical retry
state. Retry is shown only for the existing server-supported failed/legacy states.
No policy, provider, scan, fingerprint, or PASS is fabricated.

## Safety and release

Tests cover negative ownership/state behavior, stale-scan invalidation, exact ACL,
picker paths/cancellation/limits, decimal precision preservation, lifecycle action
visibility, and fail-closed copy. The SQL migration is validated in disposable
PostgreSQL. After protected integration, the canonical release workflow may apply
only the new C1 migration; B7 and unchanged Edge Functions must not be replayed.
Production postchecks must retain Finance OFF, Content Safety fail-closed, legacy
rows, 34 active functions, and zero C1-attributable BDAG movement. Expo is restarted
only after final `main` is known, replacing rather than duplicating the existing
tunnel.

