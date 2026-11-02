# WEB-CONTROL-CENTERS-B1 Design

Date: 2026-11-02
Authority: owner-approved WEB-CONTROL-CENTERS-B1 specification
Base: `origin/main@a7d93778f94c677440fdfe172dc679b5dd5f1c91`

## Scope

B1 repairs the existing Creator Studio publication seam and adds the smallest
canonical foundation for private, cross-device publication drafts. It does not
add a calendar, scheduler, automatic publication, or a Creator Studio Web UI.
It reuses Auth, R2, Stream, `media_assets`, `media_asset_links`, the existing
photo/carousel/Stream publishers, Feed, Content Safety, and MEDIA-C1.

## Current defects

1. `VideosTab` exports a local URI and passes it to `FeedContext.addVideo` as if
   it were a persisted feed URL.
2. `EffectsTab` does the same for captured photos/videos, and stopped recordings
   may retain the wrong media discriminator.
3. `FeedContext.addVideo` can silently return `undefined`, can report success
   without a canonical post ID, and contains a raw insert fallback.
4. Photo/carousel publishers have no client command receipt, so a lost response
   can create duplicate posts on retry.
5. the existing `DraftManager` is only an AsyncStorage cache whose persistence
   errors are swallowed; it is not a cloud authority.
6. a public-ready `post_image` or `carousel_image` has a directly readable R2
   URL before publication. Linking such an asset to a private draft would hide
   metadata, not bytes, and therefore is not an acceptable private draft.

## Canonical boundaries

### Publication

Direct photo/carousel publication uses one new versioned RPC,
`publish_my_media_post_v1`. It receives a stable UUID command, kind, caption,
music, and ordered public-ready canonical asset IDs. It derives the owner from
`auth.uid()`, calculates a canonical request fingerprint, serializes by owner
and command, and stores an immutable receipt. An exact replay returns the same
post ID; a command reused with different content fails. The RPC delegates to
the existing `create_photo_post_with_media` or `create_carousel_post` authority
inside the same transaction rather than duplicating Feed logic.

Stream publication remains on `publish_stream_video_post` and the existing
`uploadAndPublishStreamVideo` recovery path, which is already idempotent by
canonical Stream asset. B1 does not replace it.

Every client success requires a syntactically valid canonical UUID. Local,
blob, data, relative, and non-HTTPS values are rejected at the persisted-media
boundary. Editor state is cleared only after canonical confirmation.

### Private draft authority

The source of truth is a private database authority, not AsyncStorage:

- `private.publication_drafts` stores owner, stable create command, canonical
  B1 kind (`photo` or `carousel`), normalized composition, caption,
  music, state, revision, and timestamps.
- `private.publication_receipts` stores immutable direct/draft publication
  receipts keyed by owner and client command.
- `private.publication_draft_commands` stores immutable create/update/delete
  mutation results so a lost response can replay the same command without
  applying the mutation twice.
- `public.media_asset_links` is extended with `publication_draft`. These links
  are the durable MEDIA-C1 reservation; no second media reservation inventory
  is introduced.

Draft tables have ENABLE/FORCE RLS and no direct client grants. Authenticated
clients use versioned `SECURITY DEFINER` RPCs with `search_path=''`, fully
qualified identifiers, owner derived from the JWT, bounded keyset pagination,
and stable owner-scoped not-found errors.

Create is idempotent by `(owner_id, client_request_id)`. Update and delete use
an exact `expected_revision` CAS plus a stable mutation command and fingerprint.
An exact command replay returns its recorded result revision/state before CAS;
the same command with a different payload conflicts. Asset locks are acquired
in UUID order. A stale revision, cross-owner asset, non-ready asset, invalid
purpose, duplicated asset, or invalid count fails without partial writes.

Composition is schema/size bounded and contains editor facts only. It never
stores local URIs, browser blob/data URLs, signed URLs, provider object keys, or
public delivery URLs. Media identities are projected from canonical draft
links; previews are resolved to a new short-lived signed URL per access and are
never persisted in the cloud row or durable preview cache. A separate local
recovery record may retain a device-local source URI, but it is explicitly
non-authoritative and is never uploaded as composition or treated as a
persisted/public media URL.

The B1 limits are explicit: caption and music are each at most 300 characters,
composition is a JSON object no larger than 64 KiB, photo has exactly one
asset, carousel has 2–10 distinct ordered assets, and list RPCs accept 1–50
items ordered by `(updated_at DESC, id DESC)` with both fields in the cursor.

### Truly private draft media

B1 deliberately reuses the existing image purposes with private visibility:

- photo draft: `post_image` + `visibility='private'`;
- carousel draft: `carousel_image` + `visibility='private'`.

Those purposes already allow private visibility. The existing create/finalize
authority consequently selects the private R2 bucket, enrolls the asset in
MEDIA-C1, and leaves a READY asset with `public_url IS NULL`. No new purpose,
bucket, or upload authority is needed. Draft links are excluded from both
public and direct link projections. Only the owner can obtain a short-lived
signed URL through the existing `get-media-url` owner branch.

The database never changes READY media identity from private to public.
Publication materializes a separate canonical public asset:

- current-device publish may upload the original local bytes directly;
- cross-device publish may read the owner's short-lived signed draft bytes and
  upload them through the same canonical public R2/Stream path;
- the final server-side publish RPC accepts the resulting public asset IDs,
  validates owner/readiness/kind/count, publishes once, records the receipt,
  marks the draft published, and releases only the draft reservations.

This bounded client-assisted materialization avoids a second media system and
keeps draft bytes private. It also leaves ownership and reservations suitable
for a future B2 server worker, which can materialize the same private sources
without changing the draft schema. B1 does not implement that worker.

Cloud video drafts are not falsely represented as complete in B1. Creator
Studio video publication is repaired through the existing canonical Stream
pipeline, while the private cloud-draft authority is limited to photo/carousel
until a separately reviewed private-R2-to-Stream materialization contract is
added. This avoids misusing Story/Chat media purposes or exposing a public
Stream asset as a supposedly private draft.

### Draft publish contract

`publish_my_publication_draft_v1` receives:

- draft ID;
- expected revision;
- stable publication command UUID;
- ordered public asset IDs created by canonical upload materialization.

Every publication receipt records operation (`direct` or `draft`), kind,
optional draft ID/revision, ordered asset IDs, request fingerprint, post ID,
owner, command ID, and creation time.

It locks the receipt key first, then the draft, then assets in UUID order. An
exact receipt replay verifies that the referenced post still exists and is
owned by the actor, then returns it before CAS/state checks. A missing/deleted
receipt target fails terminally; it is never recreated by replay. For a new
command it validates that the draft is owned, active, and unchanged; that
the public asset list matches draft kind/count; and that all assets are owned,
READY, public, and of the required canonical purpose. It calls the existing
publisher, writes one immutable receipt, transitions the draft to `published`,
increments revision, removes only `publication_draft` links, and commits as one
transaction. Any failure rolls back the post, receipt, state, and links.

The private source object is then unlinked, not synchronously destroyed.
Update, delete, and publish call the existing deletion scheduler for every
source whose draft link was released. `asset_in_use` means preserve and
continue; no B1 function performs provider deletion or fails the content
mutation because another canonical link still exists. MEDIA-C1 remains the
sole provider-deletion authority.

## Client contracts

The media client separates upload source from persisted URL:

```ts
type CanonicalUploadSource =
  | { kind: 'native-uri'; uri: string; mimeType: string; fileName: string; sizeBytes?: number }
  | { kind: 'browser-blob'; blob: Blob; mimeType: string; fileName: string; sizeBytes: number };
```

Browser support in B1 is contractual only: binary body, MIME, filename, size,
abort signal, and canonical create/PUT/finalize behavior. No browser editor or
calendar is introduced.

Publication state is explicit: exporting, uploading, processing, publishing,
confirmation-pending, published, failed, or draft-saved. Export/queue completion
is never publication success. A retry retains editor state and the stable
command ID.

`DraftManager` becomes a cache/facade over the cloud draft service. Local cache
write failure is observable, and cached data is never treated as authoritative
when remote synchronization fails. It does not upload to a new bucket or use a
second draft backend.

## Security

- owner is never accepted from the client;
- private tables are denied to `PUBLIC`, `anon`, `authenticated`, and
  `service_role`; only narrowly granted RPCs are callable;
- functions pin `search_path=''` and are owned by the canonical database owner;
- direct table mutation remains unavailable;
- draft links are invisible through public/owner link policies;
- draft signed access is owner-only and short-lived;
- publication validates canonical purposes and public readiness server-side;
- receipts and published drafts are immutable except lifecycle fields defined
  by the authority;
- no finance, wallet, ledger, Ads, Marketplace, Premium, Stories, or LIVE
  authority is changed.

## Failure and recovery

- upload failure preserves editor/draft state and exposes controlled retry;
- a lost photo/carousel publish response is recovered with the same command ID;
- a command fingerprint mismatch fails closed;
- CAS conflicts require reloading the draft;
- an interrupted public materialization can leave an unlinked public asset,
  which MEDIA-C1 safely reclaims; the private reservation remains intact;
- a failed publish transaction leaves no post or receipt and retains the draft;
- deleting a draft tombstones it and removes reservation links, but never
  directly deletes provider objects or an already published post.

## Release shape

Expected productive delta:

- one forward-only migration;
- zero Edge functions unless the release dependency compiler proves a real
  source dependency;
- mobile/client bundle changes are source changes, not an artificial
  production publication;
- explicit B1 successor governance attestation for new relations, RPCs, ACL,
  policy state, and exact migration/Edge bytes.

The canonical HIGH workflow, postcheck, separate baseline PR, policy digest
readback, and final `NO PRODUCTIVE CHANGES` are mandatory for the database
authority. Mobile source integration is verified by TypeScript/tests/build;
installable mobile bundle delivery and physical QA remain explicitly separate
evidence and are never inferred from a successful Supabase release.

## Non-goals

No scheduler, calendar, automatic publication, bulk ingestion, public Creator
Studio Web UI, new bucket, new Feed table, alternate publisher, alternate
cleanup worker, or financial change is included.
