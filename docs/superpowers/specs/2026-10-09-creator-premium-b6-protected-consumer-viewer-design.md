# Creator Premium B6 — Protected Consumer Viewer / Anti-Exfiltration Design

Date: 2026-10-09
Status: Proposed for owner review
Working branch: `codex/creator-premium-b5-creator-management-ux`
Starting branch SHA: `7d1a0be11dbacbcbd4dfa0d1de661a0499ed215d`
Canonical main SHA: `65ef157a1ff666b397b059e9aad048201c62068a`
Tree equivalence at precheck: both references resolve to
`2b47ea98846cf43004a59fa31df9e89b14072cce`

## Intent

B6 connects the existing B1–B5 Creator Premium authorities to a real mobile
consumer experience. An authenticated, entitled consumer can browse their
Premium library and open a private image or signed Cloudflare Stream video.
The creator can open their own content through the same B1 owner entitlement.

The viewer is fail-closed. It renders protected bytes only after native screen
protection is armed, the current server session is verified, B1 entitlement is
revalidated, and exactly one canonical B2 or B3 grant is validated. URLs live
only in memory and are removed on background, logout, identity/content change,
expiry, revocation, navigation away, or protection failure.

This is anti-exfiltration hardening, not DRM. B6 reduces ordinary screenshot,
recording, app-switcher, caching, sharing, and stale-grant exposure. It cannot
stop an external camera, a compromised/rooted/jailbroken device, or every
platform/provider-level extraction path. A visual watermark is deterrence and
traceability, not cryptographic protection.

## Scope Boundaries

B6 adds only client UI, client orchestration, focused tests, and this design and
its later implementation plan. It may add these routes when no equivalent
exists:

- `app/my-premium-library.tsx`
- `app/creator-premium-viewer/[contentId].tsx`

It may add one focused screen-protection hook, one in-memory viewer controller,
and small protected-media/watermark components. It reuses:

- `get_my_creator_premium_entitlement_v1`
- `get_my_creator_premium_library_v1`
- `get_creator_premium_catalog_v1`
- `get-media-url`
- `get-stream-playback`
- `creatorPremiumService.ts`
- `creatorPremiumMediaService.ts`
- `creatorPremiumStreamService.ts`
- `expo-screen-capture`
- `expo-image`
- `expo-video`
- `expo-router`

B6 does not add or change database objects, migrations, Edge Functions,
buckets, Stream infrastructure, entitlements, finance, wallets, ledgers,
purchase/subscription flows, public publishing, Premium DM, Marketplace, Ads,
or server deployments. It does not enable Premium finance or public release.

## Existing Authority Audit

The existing architecture is sufficient and remains authoritative:

- B1 resolves owner, purchase, and current subscription entitlement and fails
  closed for age, account, relationship block, lifecycle, refund/reversal, and
  expired-period conditions.
- B1 library rows expose safe metadata only: content identity, creator, title,
  description, kind, access mode, dates, and entitlement source/expiry.
- B2 returns an entitlement-gated, 300-second R2 original-image grant from
  `get-media-url`; the public teaser remains a separate public asset.
- B3 returns entitlement-gated, signed HLS/DASH/thumbnail Stream grants from
  `get-stream-playback`; permanent provider playback URLs remain null.
- B5 catalog rows expose only the public teaser and safe entitlement state.
- The detailed B5 content projection is owner-only and is not a consumer
  content-detail authority.

No existing Premium consumer viewer, Premium library screen, reusable Premium
screen-protection hook, entitlement cache, or alternate grant service exists.
The one-time chat viewer uses screen-capture APIs but is purpose-specific and
currently swallows arming failures; B6 must not reuse that fail-open behavior.

## Selected Architecture

### 1. Public discovery remains teaser-only

`app/creator/[id].tsx` continues to load `fetchCreatorPremiumCatalog`. Cards
render only `teaser_url`, title, content kind, access mode, and a truthful lock
or entitled state. A locked card never requests a private grant and explains
that access is required while purchase/subscription actions remain disabled.

An entitled card navigates with exactly one route parameter, `contentId`. It
does not pass entitlement, content kind, asset ID, provider UID, signed URL, or
expiry as authority. The viewer always revalidates independently.

The profile's own Premium/library entry points are updated minimally to expose
the library and preserve the existing Creator Premium management hub. The
legacy disabled subscription screen is not made a financial authority.

### 2. Premium library

`app/my-premium-library.tsx` uses `fetchMyCreatorPremiumLibrary` with the
canonical keyset cursor. It supports initial loading, pull-to-refresh, bounded
pagination, retry, empty state, and expired/revoked disappearance after server
refresh. It never requests originals for the list and never creates demo or
financial records.

Each row opens the viewer using only `contentId`. Its `content_kind` may be
registered as an untrusted, process-memory routing hint to avoid an unnecessary
provider probe; that hint is never persisted and never grants access.

### 3. Protected viewer session

The viewer is a small state machine with these externally visible states:

- `loading`
- `locked`
- `ready`
- `playing`
- `paused`
- `expired`
- `revoked`
- `restricted`
- `error`
- `offline`

Its protected-media state additionally records the captured user ID,
`contentId`, request generation, grant expiry, and either an image grant or a
video grant. Private URLs never enter navigation, persistent stores, logs,
analytics, crash metadata, or user-facing errors.

Every load follows this order:

1. Validate `contentId` shape.
2. Arm native screen/app-switcher protection.
3. Verify the current Supabase user with a server-backed auth check and capture
   that user ID plus a new request generation.
4. Call `getMyCreatorPremiumEntitlement(contentId)`.
5. Reject denied, expired, restricted, revoked, blocked, unavailable, or
   invalid entitlement before requesting media.
6. Request the canonical B2 or B3 grant.
7. Verify the current user again and reject any stale generation, user change,
   content change, inactive app, unfocused route, or expired/malformed grant.
8. Reveal media only while all guards remain true.

An `AbortController` is used where the current client supports a signal, but a
monotonic generation is the mandatory race boundary because Supabase RPC and
Function calls are not universally abortable. Late results can be received but
cannot repopulate protected UI.

### 4. Media-kind resolution without a new RPC

The consumer entitlement RPC deliberately returns authorization, not media
metadata. B6 does not create a parallel detail RPC.

When opened from catalog/library, the process-memory content-kind hint chooses
the expected endpoint. The endpoint remains authoritative and must validate
content identity, entitlement, canonical link, purpose, provider, privacy, and
ready state.

For a direct/deep-link opening with no hint, or for a stale/mismatched hint,
the controller performs a conservative one-time resolution through the two
existing canonical endpoints after entitlement succeeds. It accepts exactly
one valid grant:

- image only: render protected image;
- video only: render protected video;
- neither: classify safe missing/network/provider state;
- both: fail closed as ambiguous/inconsistent.

The wrong-kind endpoint returns no original because no canonical original link
exists for that provider. This does not create a new media authority and does
not trust the client hint. Safe typed grant errors distinguish HTTP 404 media
absence, 401/403 access loss, provider/unavailable responses, malformed grants,
and network failure without exposing backend/provider detail.

### 5. Grant validation and lifetime

Both services validate the exact requested `contentId`, HTTPS, parseable future
expiry, and a maximum tolerance of 315 seconds for the canonical 300-second
TTL. The image grant gains the same upper-bound check already enforced for
video. Video retains strict Cloudflare Stream hostname, path, token, field-set,
and same-authority checks.

A renewal timer fires before expiry. Renewal always starts with session and
entitlement revalidation; it never refreshes a URL directly. An expired grant
is removed before another is requested. While foregrounded, periodic
entitlement checks bound in-session revocation delay and stop/remove media on a
denial. Previously issued provider URLs cannot be revoked instantaneously by
the client; their maximum server TTL remains the outer technical limit.

Grants are React/controller memory only. Cleanup sets image source and player
source to null and releases references. JavaScript cannot guarantee secure
zeroization of immutable strings, so B6 makes no such claim.

## Native Screen Protection

One focused `usePremiumScreenProtection` hook owns B6 protection. It uses a
stable, B6-specific key so Expo's keyed capture locks do not conflict with
other screens. The hook exposes `arming`, `protected`, and `failed`; protected
media is mounted only in `protected`.

Before any grant request it calls `ScreenCapture.isAvailableAsync()` and
`preventScreenCaptureAsync(key)`. Any unavailable API or rejected arming call
is fatal for media display. It is not implemented with
`usePreventScreenCapture` because that convenience hook does not expose an
arming result suitable for a fail-closed gate.

### Android

The installed `expo-screen-capture` 8.0.9 implementation applies Android
`FLAG_SECURE`, covering ordinary screenshots, screen recording, and recent-app
snapshots on supported devices. B6 scopes the lock to the viewer and releases
the same key on final unmount. It does not request photo/media permissions for
screenshot detection and does not add a second native package.

### iOS

The installed SDK supports capture prevention plus
`enableAppSwitcherProtectionAsync`. B6 enables both before a grant request and
uses an opaque local cover during transitions and inactive/background states.
The app-switcher protection is disabled during final cleanup and the keyed
capture lock is released without affecting unrelated keys.

Expo documents screen-recording prevention on iOS 11+ and screenshot
prevention on iOS 13+. These APIs, app-switcher obscuring, and the local cover
are best-effort platform defenses, not an absolute guarantee. B6 does not ask
for broad photo permissions merely to install a screenshot listener.

### Unsupported surfaces

If native screen protection is unavailable or fails—including an unsupported
web/runtime surface—the viewer displays a safe protection error and never
mounts the private image/video.

## Protected Image Rendering

The image component uses `expo-image` with:

- `cachePolicy="none"`;
- no prefetch;
- no FileSystem, MediaLibrary, sharing, or download path;
- a per-session `recyclingKey`;
- iOS Live Text interaction disabled;
- an opaque cover until load and protection/session checks are current.

The installed `expo-image` 3.0.11 type contract explicitly supports
`cachePolicy="none"` and `enableLiveTextInteraction`.

## Protected Video Rendering

The video component uses `expo-video` 3.0.16 with an initially empty player.
Only a validated HLS grant is passed to `replaceAsync` as a `VideoSource` with
`useCaching=false`. Player properties explicitly disable external playback,
background activity, and Now Playing notification. The `VideoView` disables
native controls, fullscreen, Picture in Picture, automatic PiP, and iOS video
frame analysis. B6 supplies only minimal in-app play/pause controls, with no
download, share, repost, export, AirPlay, or external playback action.

On background, focus loss, logout, identity/content change, expiry, revocation,
or unmount, the controller pauses the player and replaces its source with null.
`useVideoPlayer` owns final native release on component unmount.

## Lifecycle and Race Safety

The route combines Expo Router focus, React Native `AppState`, auth context,
and server session checks:

- `inactive`/`background`: increment generation, abort supported work, pause
  and detach video, clear all grant state, and show an opaque cover;
- foreground: remain covered, re-arm/check protection, verify identity,
  revalidate entitlement, then request a new grant;
- route blur/unmount: perform the same media/grant cleanup and remove listeners;
- logout/session invalidation: clear immediately and remain locked;
- account A to B: the captured user and final server user must match, otherwise
  the result is discarded;
- content A to B: a new generation prevents late A responses from rendering;
- expiry during playback: pause/detach first, then revalidate before renewal;
- native protection error at any point: cover and detach before showing error.

No delayed response can change UI unless its generation, content ID, user ID,
focus state, app state, protection state, and expiry are all still current.

## Watermark

The media surface includes a non-interactive visible overlay containing:

- a bounded public username or stable pseudonymous user marker;
- a random per-viewer-session marker;
- a discreet current timestamp.

It never displays a full email, phone number, auth token, entitlement ID,
financial identifier, signed URL, or provider identifier. The marker is not
burned into or saved with the media and is not described as cryptographic
protection.

## Error Classification and User Copy

Internal codes are mapped to bounded Spanish UI states without raw exception,
URL, asset, account, SQL, or provider detail:

- entitlement absent/not published: `locked`;
- age/account/block/moderation/lifecycle restriction: `restricted`;
- prior access lost, refund/reversal, or server revocation: `revoked`;
- current entitlement period/grant expired: `expired`;
- no canonical ready original: safe media-unavailable `error`;
- confirmed network loss: `offline` with retry;
- invalid/ambiguous/tampered grant or protection failure: fail-closed `error`.

The locked state contains no operational purchase/subscribe button while
`CREATOR_PREMIUM_FINANCE_AVAILABLE` remains false.

## Feature Flags and Product State

B6 adds an explicit viewer capability flag if needed, but preserves:

- `CREATOR_PREMIUM_FINANCE_AVAILABLE = false`;
- no public release;
- no payment/subscription/refund client action;
- no creator self-publish;
- no production data or fixture creation.

Existing copy that says the protected viewer is unavailable is updated to say
that protected viewing exists for already entitled users while sales and
subscriptions remain disabled. B6 does not reinterpret media capability as
finance availability.

## Test Strategy

Implementation follows red-green-refactor. Focused B6 tests first establish
RED for the viewer controller, grant validation, screen-protection gate,
lifecycle/race invalidation, protected media configuration, watermark, library,
profile teaser isolation, navigation, and finance isolation.

Pure controller tests simulate owner, purchase, subscription, expiry,
refund/reversal, age, suspension, block/moderation, logout, account change,
content change, late grants, background/foreground, native-protection failure,
and renewal. Grant tests cover expired, overlong, altered, cross-content,
wrong-domain, ambiguous dual-provider, and missing media responses. Static UI
contracts prove no persistence/download/share path, image no-cache, video
no-cache/no-PiP/no-external-playback, watermark presence, and no private route
parameters.

The B1/B2/B2-C1/B3/B4/B4-C1/B5 focused suites, media deletion/security,
Stream, finance, TypeScript, changed-file ESLint, global comparison, and
`git diff --check` run after B6. No historical failures are rewritten merely
to obtain green.

Android and iOS physical validation is a separate required gate. Without real
devices, the report must say `PHYSICAL B6 UX/PROTECTION VALIDATION: PENDING`;
static/native-source contracts are not reported as physical PASS.

## Git, Deployment, and Verification Boundaries

Work remains in the existing
`codex/creator-premium-b5-creator-management-ux` worktree. No branch, clone,
worktree, migration, package install, dependency copy, or production resource
is created. Commits are local until tests pass and the deployment gate is
rechecked.

Before any branch push, the existing C2 controls and current repository
automation are revalidated. If a push can create an unauthorized preview or
production deployment, the verified commit remains local and the task stops
before push. B6 never pushes `main`.

Postcheck must show unchanged Supabase migration count and policy, no Premium
financial transaction, no BDAG movement, no Edge deployment, no new worktree
or clone, a clean worktree, and exact local/remote branch evidence if push is
authorized.

## Verified SDK References

The selected APIs are present in the installed package types and documented by
Expo SDK 54:

- Screen capture: <https://docs.expo.dev/versions/v54.0.0/sdk/screen-capture/>
- Video: <https://docs.expo.dev/versions/v54.0.0/sdk/video/>
- Image: <https://docs.expo.dev/versions/v54.0.0/sdk/image/>

No SDK, native package, or provider choice is added by B6.
