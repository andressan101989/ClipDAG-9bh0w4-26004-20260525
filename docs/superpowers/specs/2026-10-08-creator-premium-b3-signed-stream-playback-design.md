# Creator Premium B3 — Signed Cloudflare Stream Playback Design

Date: 2026-10-08
Status: Proposed for owner review
Base: `origin/main` at `e28399c38ab70b764668a2debe422fe7a0332122`

## Intent

Creator Premium B3 adds private Premium video infrastructure to the existing
Cloudflare Stream domain. A Premium video consists of a public B2 R2 teaser and
a private Cloudflare Stream original. Consumers obtain only a short-lived,
entitlement-gated playback grant; they never receive a video asset ID,
Cloudflare UID, signing key, raw token, or permanent provider URL.

Success means the existing Feed and Business Stream behavior remains unchanged,
while Premium uploads are created with `requireSignedURLs=true`, reconcile only
when that provider protection is proven, and play through locally signed RS256
HLS, DASH, and thumbnail URLs with a maximum 300-second lifetime.

## Scope Boundaries

B3 reuses `public.video_assets`, `public.video_asset_links`, Cloudflare Stream,
the B1 entitlement resolver, B2 teaser media, and existing deletion functions.
It adds one migration, three purpose-aware Edge changes, one focused shared
security helper, one client service, and focused tests.

B3 does not implement finance, purchases, subscriptions, refunds, payouts,
public Premium publishing, a protected viewer, screenshot defenses,
watermarking, final creator UX, Premium DM, or Stream replacement. It does not
modify `main`, begin B4, change the roadmap, create a second provider/table, or
repair pre-existing stale Business Stream uploads.

## Selected Architecture

The approved architecture extends the canonical Stream system in place:

1. The creator uploads a separate public R2 teaser using
   `creator_premium_teaser_image`.
2. `create-stream-upload` authorizes an owned draft video content row and
   reserves a private `creator_premium_video` asset.
3. Cloudflare direct upload is created with `requireSignedURLs=true` and safe
   metadata containing the internal asset/content context.
4. Premium reconciliation verifies provider UID, ready state, duration, and
   signed-URL protection. It stores no HLS, DASH, or provider thumbnail URL.
5. The creator first-binds the teaser and private video to one Premium content
   through a narrow atomic RPC. Same-pair replay is idempotent; replacement is
   rejected in B3.
6. A consumer requests playback by `premium_content_id`. The Edge function
   checks B1 entitlement, resolves the canonical private link server-side,
   signs one 300-second RS256 token locally, and returns signed HLS, DASH, and
   protected thumbnail URLs with no-store headers.

Rejected alternatives are a per-playback Cloudflare `/token` call (avoidable
provider dependency and rate limits), proxying media bytes through Supabase
(duplicate media authority and unnecessary bandwidth), and storing permanent
Premium manifests (breaks the private-original contract).

## Signing-Key Authority

One Cloudflare Stream signing key is provisioned through the official Stream
API. Only these Supabase secret names are used:

- `STREAM_SIGNING_KEY_ID`
- `STREAM_SIGNING_KEY_JWK_B64`

The private JWK, API token, PEM, and derived material are never committed,
logged, returned, or stored in application tables. The Edge helper decodes the
provider's base64 JWK in memory, imports it through Web Crypto, and generates
RS256 tokens locally. Playback performs no Cloudflare API call.

Token header and claims are limited to `alg=RS256`, the configured `kid`,
`sub=<cloudflare_uid>`, the same `kid`, `nbf` with at most 30 seconds of clock
skew, and `exp` at no more than 300 seconds. Download and sharing claims are
absent.

## Database Design

The single forward-only B3 migration will:

- add `creator_premium_video` to the existing video-purpose constraint;
- require that purpose to use `cloudflare_stream` and private visibility;
- extend ready invariants so Premium ready rows require UID, valid duration,
  `ready_at`, and `provider_metadata.require_signed_urls=true` while requiring
  `hls_url`, `dash_url`, and `thumbnail_url` to remain null;
- add `creator_premium_content` to the existing video-link entity constraint
  while preserving legacy `exclusive_content`;
- constrain Premium video links to `slot='original'` and `position=0`;
- add partial uniqueness for one video per content and one Premium content per
  Premium video asset;
- install a narrow Premium video-link guard that validates creator ownership,
  draft lifecycle on initial bind, video kind, provider, purpose, privacy,
  readiness, null permanent URLs, and signed-provider proof;
- extend B2 teaser authorization and link validation so teasers work for image
  or video drafts while R2 originals remain image-only;
- hide Premium video rows and links from generic owner PostgREST policies;
- add authenticated-only `authorize_my_creator_premium_video_upload_v1`,
  `set_my_creator_premium_video_media_v1`, and
  `get_my_creator_premium_video_media_v1` security-definer RPCs with empty
  search paths, caller-derived identity, age/account checks, explicit ACLs, and
  fully qualified references;
- extend the existing owner and catalog projections with safe video flags and
  require a valid protected Stream link for catalog-visible video content.

The bind RPC uses deterministic content-scoped locking. First bind succeeds;
the identical pair replays safely; any different already-bound pair fails with
`creator_premium_video_media_already_bound`. It returns no private identifier.

## Edge Components

### `create-stream-upload`

Adds the exclusive `creator_premium_video` request path. It requires a valid
`premium_content_id`, rejects mixed Business scope, calls the narrow upload
authorization RPC, reserves a private canonical asset, and sends
`requireSignedURLs=true` with safe provider metadata. Feed and Business retain
`requireSignedURLs=false` and their existing public behavior.

### `premiumStreamSecurity.ts`

Contains only Premium-specific reconciliation and local signing. It reuses the
existing Stream client/configuration and does not become a second provider
authority. Premium reconciliation fails closed with
`creator_premium_stream_signed_urls_required` when protection is absent, and
never persists provider playback URLs.

### `stream-webhook`

Selects reconciliation by stored purpose. Premium assets use the protected
path; Feed and Business continue through the existing public reconciler.

### `get-stream-playback`

Keeps `asset_id` as an owner-only processing route. For Premium assets that
route returns status and dimensions but null HLS/DASH/thumbnail fields and no
token. The mutually exclusive `premium_content_id` route performs entitlement,
link, asset, and provider-proof checks, then returns only:

- `contentId`
- `hlsUrl`
- `dashUrl`
- `thumbnailUrl`
- `expiresAt`

Responses include `Cache-Control: private, no-store` and `Pragma: no-cache`.

## Client Design

`creatorPremiumStreamService.ts` orchestrates the existing authorities:

1. upload the B2 public teaser;
2. request the Premium Stream direct-upload contract;
3. POST the video directly to Cloudflare;
4. poll the owner-safe processing route;
5. first-bind the ready pair;
6. return only safe state.

Failure before binding triggers best-effort canonical cleanup through
`deleteMediaAsset` and `deleteStreamVideo`, and returns cleanup diagnostics
without swallowing failures. The playback-grant API validates content identity,
HTTPS manifest/thumbnail shapes, future expiration, and the roughly 300-second
maximum. It keeps grants in memory and never uses AsyncStorage, FileSystem,
MediaLibrary, Share, background download, or global prefetch.

## Error and Concurrency Model

Authorization, entitlement, purpose, privacy, provider-proof, and ambiguity
checks fail closed. No client-provided creator ID, UID, or video asset ID is
trusted for consumer playback. Database uniqueness plus deterministic locks
prevent concurrent double binds. Provider callbacks cannot make a Premium
asset ready unless signed playback is proven. B3 deliberately refuses
replacement so it cannot create provider-side orphans before the later media
management phase.

## Test Strategy

Implementation follows red-green-refactor. Focused tests first establish RED
for the migration contract, teaser authorization, upload creation, protected
reconciliation, webhook routing, RS256 cryptography, entitlement playback,
owner processing state, and client cleanup/grant validation.

Disposable database tests apply the complete migration chain plus B3 and prove
constraints, guards, RLS, ACLs, idempotency, replacement denial, safe
projections, and B2 compatibility. Existing B1/B2/B2-C1, Stream, finance, and
global suites run afterward. TypeScript diagnostics are filtered against B3
changed files, ESLint runs on every changed TS/TSX file, and `git diff --check`
must pass.

## Deployment and Verification

The linked dry-run must show exactly one pending generated B3 migration. The
migration is deployed once, followed only by Edge functions whose source or
dependency bundles changed, expected to be `create-stream-upload`,
`get-stream-playback`, and `stream-webhook`. Image functions,
`delete-stream-video`, finance functions, and all unrelated Stream behavior are
not deployed.

Postchecks prove migration count 333, zero Premium production fixtures, the
four pre-existing video assets unchanged, both stale Business uploads untouched,
financial counts/balance unchanged, signing secret names present, changed Edge
source parity, unrelated Edge hash stability, advisor classification, branch
push parity, and unchanged `origin/main`.
