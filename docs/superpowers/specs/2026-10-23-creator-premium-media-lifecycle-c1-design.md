# Creator Premium Media Lifecycle C1 — Design

## Scope and non-negotiable invariants

Media Lifecycle C1 hardens the existing R2 and Cloudflare Stream authorities. It does not add a second uploader, scanner, storage backend, deletion pipeline, ledger, or financial authority. It does not bulk-delete historical provider resources. The eleven legacy non-Premium rows remain untouched. Finance stays disabled and Content Safety P3/v2 remains unchanged.

The design preserves these invariants:

- a valid link always wins over deletion;
- `delete_pending` and `deleted` are terminal with respect to upload, webhook, and playback reconciliation;
- only the worker holding the current database attempt fence may finish or fail provider cleanup;
- provider DELETE acceptance is not physical-absence proof;
- R2 upload authorization expiry is durable database state;
- unknown provider-only resources are findings, never automatic deletion targets;
- retention uncertainty resolves to preservation, not deletion;
- provider keys, Stream UIDs, signed URLs, tokens, and private media never enter logs or reports.

## Demonstrated root causes

1. `delete-stream-video` checks links and writes `delete_pending` in separate requests. The existing Premium bind RPC can insert a link between those operations, after which the Edge function deletes the newly linked video.
2. `stream-webhook`, `get-stream-playback`, and the final persistence step of `create-stream-upload` update a row after an external request using only asset identity. A concurrent delete can therefore be overwritten by stale `ready`, `processing`, `failed`, or `uploading` state.
3. R2 PUT URLs are bearer capabilities that remain reusable until expiry. Current deletion removes the object immediately while that capability can still recreate the same key. The expiration is returned to the client but not persisted.
4. A premature R2 finalize marks a missing object `failed`; current cleanup never claims failed rows. A later valid PUT can therefore leave a permanent provider object behind a failed database row.
5. `cleanup-stale-media-uploads` increments `objectsDeleted` without verifying its database update. Stream completion also lacks an attempt fence.
6. The shared Stream client rejects a valid empty `2xx` DELETE response because it requires the normal JSON result envelope.
7. No current completion path independently verifies R2/Stream absence or records a sanitized, immutable receipt. No provider-to-database read-only inventory tool exists.

## Canonical lifecycle authority

The existing rows remain the durable authority:

- `public.media_assets` / `public.media_asset_links` for R2;
- `public.video_assets` / `public.video_asset_links` for Stream;
- the existing scheduling and cleanup RPCs for serialization and bounded claims.

The forward-only migration extends those authorities rather than replacing them:

- persist R2 `upload_authorization_expires_at` before returning a signed PUT;
- mark newly issued assets with a lifecycle contract version so historical rows are not silently swept into new automatic behavior;
- use existing `cleanup_attempts` / `delete_attempts` as monotonically increasing worker fences;
- expose the existing private Premium Stream scheduler through one `service_role`-only public boundary; the private locking function remains the implementation authority;
- add fenced completion/failure RPCs that lock the row, compare the attempt, recheck links and immutable provider identity, and atomically update state plus an audit receipt;
- strengthen the existing identity triggers so terminal states cannot transition back to active states.

Provider deletion receipts reuse `private.admin_action_audit` with `actor_kind='system_workflow'`, a media-lifecycle domain, an internal asset UUID, the attempt fence, provider class, safe outcome, timestamp, and optional sanitized provider request identifier. No key, UID, URL, token, filename, or private content is stored. This reuses the immutable audit authority instead of creating an event ledger.

## Link/delete serialization

All deletion entry points schedule through a row-locking RPC. The scheduler locks the asset first and checks links while holding that lock. Canonical bind RPCs use the same asset lock before validating `ready` and inserting links.

Outcomes are deterministic:

- bind commits first: deletion waits, observes the link, returns `asset_in_use`, and never calls the provider;
- deletion commits first: bind waits, observes `delete_pending`, and rejects the link;
- repeated deletion: `scheduled` or `deleted` is idempotent.

The cleanup claim increments the existing attempt counter. Completion and retry writes must match both `delete_pending` and that exact counter. A stale worker therefore updates zero rows and cannot finalize or overwrite a newer attempt.

## Stream callbacks and allocation

Webhook, playback polling, and upload-allocation persistence use compare-and-set predicates over:

- asset UUID and owner where applicable;
- exact Cloudflare UID when one is already bound;
- eligible source status;
- current immutable generation/fence state.

A zero-row update is a stale/no-op result, never success. Late webhook and polling responses leave deletion tombstones intact. If Stream allocation succeeds after the reservation is canceled, the upload URL is not returned; the newly known UID is durably scheduled/compensated through the same cleanup authority.

Stream DELETE has a dedicated client contract that accepts successful empty responses and treats provider `404` as already absent. A separate metadata GET establishes physical absence. Authentication, rate-limit, network, `401/403`, and `5xx` responses remain retryable failures and never count as absence.

## R2 authorization and late PUT safety

The actual signed PUT expiry is persisted before the URL is returned. Deletion may be scheduled immediately but the worker must not physically delete while the capability remains valid. Claims are delayed until expiry plus the existing bounded stale-upload safety window. Failed, unlinked rows become cleanup candidates under the same fence.

Because a provider does not promise revocation of an already issued URL and does not publish an unlimited in-flight-request bound, the system does not claim that expiry alone is a mathematical revocation. The corrected contract combines:

1. delayed deletion while the issued capability is valid;
2. independent origin `HEAD` verification after DELETE;
3. a second pre-tombstone absence observation no earlier than one hour after the persisted capability expiry;
4. one bounded 24-hour post-delete verification, with at most three attempts for transient read failures;
5. read-only provider inventory that detects any object which reappears after the bounded automatic window.

An object that reappears for a known C1 tombstone during the bounded automatic window is re-deleted under the same canonical fence. Later drift is a read-only inventory finding requiring separately authorized reconciliation. A provider-only object without a canonical identity is classified for review and is never deleted automatically.

## Truthful cleanup telemetry

The worker distinguishes:

- `delete_requested` — request was attempted;
- `delete_accepted` — provider accepted it or returned authoritative not-found;
- `absence_verified` — a separate provider read proves absence;
- `db_finalized` — the fenced database completion committed;
- `stale_claim` — provider work completed but the worker no longer owns the attempt;
- `retry_scheduled` — a fenced failure update committed.

Success counters increment only after `absence_verified` and `db_finalized`. Provider `404` is recorded as `already_absent`, not as proof that this invocation deleted anything. Failed database writes never increment deletion totals.

## Read-only Cloudflare reconciliation

One focal CLI script reuses the existing provider SDK/API contracts and performs no writes. It requires explicitly supplied read-only scope:

- bucket-scoped R2 object read/list credentials;
- account-scoped Stream Read;
- a read-only database snapshot source.

It paginates both providers, compares exact canonical identities in memory, and emits only aggregate counts plus salted/hashed internal references. Classifications are:

A. active and referenced;
B. legitimately retained;
C. pending cleanup;
D. provider-only;
E. Supabase-only;
F. physically orphaned with sufficient evidence;
G. indeterminate.

Unknown account, project, bucket, prefix, partial page, permission failure, or missing retention evidence produces `indeterminate` and a non-success audit verdict. The script never deletes, signs, downloads, or exposes private media.

## Retention

- Active and referenced media is retained.
- Removed media is retained while valid rights, receipts, entitlements, disputes, or holds may require it.
- Deleted media is physically eligible only after all canonical references are absent, the owning operation allows deletion, upload authority is safely expired, and no retention uncertainty exists.
- Provider-only and eleven legacy unlinked rows remain preserved until separately authorized.
- No legal duration is invented. A missing legal/retention decision is an explicit preservation blocker.

## Security and release

All maintenance RPCs use `SECURITY DEFINER`, an empty or explicit safe `search_path`, locked ownership, and `service_role`-only execution. Client roles keep SELECT-only access already constrained by RLS; no `anon`, `PUBLIC`, or direct private-table grants are added. Provider inventory credentials are read-only and never bundled into the application.

Tests begin RED for every demonstrated race and false-success path, then cover disposable PostgreSQL concurrency, provider contracts, ACL/RLS negatives, Finance OFF, Content Safety preservation, Release Gate, and Snapshot Adapter. Production mutation is permitted only after protected merge and canonical `plan_only → gate_proof → release → postcheck`, with fresh backup and auto-deploy-OFF evidence.
