# WEB-CONTROL-CENTERS-B2 Scheduled Publishing Design

Date: 2026-11-08
Authority: owner-approved local B2 implementation scope
Local base: `840014918979fe62f563f346bd8db5472013a43e`
Integrated tree: `5dbdfecc32d7865eceb1cddefb5519349440a420`
Remote ancestry note: the integrated `main` commit object
`24d56a5d846f1ea0bd292dbf77643ac5711b5517` was not locally available when
the worktree was created; ancestry must be normalized before any future push.

## Intent

B2 adds durable, server-side scheduled publication for the canonical B1
`photo` and `carousel` drafts. Any authenticated owner may schedule their own
draft, close every client, and rely on the server to publish it once. Owners
can list, reschedule, cancel, inspect failures, and request a safe retry.

B2 does not add Creator Web, a calendar, video/Reel/Story scheduling, a new
Feed authority, a new media inventory, or a remote deployment. The local
delivery includes migration source, Edge worker source, client/UI source, and
deterministic tests only.

## Approaches considered

1. **Client timer.** Rejected because publication would stop when the browser
   or app closes and would not satisfy the roadmap.
2. **Pre-materialize public media when scheduling.** Rejected because B1 draft
   bytes must remain private until the due schedule is validly claimed.
3. **Durable database schedule plus a narrow worker.** Selected. PostgreSQL is
   authoritative for ownership, time, state, leases, CAS, retries, and receipts;
   a worker performs the provider copy and invokes the canonical publisher.

## Canonical boundaries

### Draft and publication authority

- `private.publication_drafts` remains the only cloud draft authority.
- `private.publication_receipts` remains the final post idempotency authority.
- Existing B1 photo/carousel publishers remain the only Feed insertion path.
- B2 extracts or wraps the existing draft publication transaction as one
  private canonical core callable both by the owner RPC and by the worker RPC.
  It does not copy publication SQL into a parallel path.
- Existing Content Safety triggers and MEDIA-C1 lifecycle remain authoritative.

### Schedule authority

`private.publication_schedules` stores one active schedule per B1 draft:

- owner and draft identity derived from authenticated state;
- scheduled UTC instant (`timestamptz`);
- requested IANA zone, local wall time, and explicit UTC offset when required;
- state, revision, generation, stable publish command, and request fingerprint;
- bounded attempt count, next attempt, lease owner/token/expiry;
- sanitized error code and retryability;
- final post/receipt identity and audit timestamps.

Append-only command and attempt records make create, reschedule, cancel, retry,
claim, materialization, publication, and recovery auditable without storing
signed URLs, provider credentials, private object URLs, or raw provider errors.

### Owner RPCs

Versioned public RPCs derive the actor from `auth.uid()` and provide:

- schedule with stable command replay;
- bounded keyset list/get;
- reschedule with exact revision CAS and generation increment;
- cancel with CAS;
- retry of a retryable failed schedule without resetting bounded attempts.

All are `SECURITY DEFINER`, use `search_path=''`, fully qualify identifiers,
revoke `PUBLIC`/`anon`/`service_role`, and grant only `authenticated`. Exact
replays return the recorded result; command reuse with different content fails.

### Worker RPCs

Worker RPCs are granted only to `service_role` and accept no owner or draft
identity chosen by the caller. Claim returns a bounded set of due rows under
`FOR UPDATE SKIP LOCKED`, including a random claim token and frozen generation.
Every later operation must present schedule ID, generation, and claim token and
must match the locked schedule. A stale or cancelled claim cannot publish.

The worker contract supports:

1. claim a due schedule;
2. reserve deterministic materialization targets for its private source assets;
3. copy private bytes to deterministic public R2 keys;
4. finalize only the matching target identities;
5. invoke the canonical draft publisher;
6. complete, retry, or fail the matching claim.

### Media privacy and recovery

- Scheduling never creates public media.
- Private B1 draft sources and `publication_draft` links remain unchanged before
  the due time.
- Materialization targets use the existing `media_assets` inventory and R2
  buckets, with deterministic IDs/keys and temporary canonical links so
  MEDIA-C1 cannot reclaim an in-flight target.
- Provider copy is idempotent. A lost provider or database response resumes by
  checking the deterministic target, never by creating another target.
- A public target left after a stale/cancelled claim is unlinked and handed to
  MEDIA-C1; B2 never deletes provider bytes directly.
- On success, the canonical publisher creates one post/receipt and releases
  draft and schedule reservations through existing lifecycle authority.

## Time contract

The client submits a local wall time, an IANA zone, and optionally an explicit
UTC offset in minutes. PostgreSQL resolves and verifies the instant.

- The stored execution authority is UTC `timestamptz`.
- The IANA zone and local wall time are preserved for display/audit.
- Invalid zones are rejected.
- A nonexistent spring-forward time is rejected.
- An ambiguous fall-back time is rejected unless the supplied offset selects
  exactly one valid UTC instant.
- Session timezone never changes eligibility or stored identity.

Configurable conservative defaults are private policy data, not client trust:

- minimum lead time: 2 minutes;
- maximum horizon: 365 days;
- claim batch: 10;
- lease: 2 minutes;
- maximum attempts: 5;
- backoff: 30 seconds exponential, capped at 15 minutes;
- wake precision: one minute.

These defaults are local implementation choices, not a production activation.

## State and concurrency contract

States are `scheduled`, `claimed`, `materializing`, `publishing`, `published`,
`retryable_failed`, `terminal_failed`, and `cancelled`.

- One nonterminal schedule may exist per draft.
- Reschedule and cancel lock schedule then draft in a fixed order, increment
  generation when they invalidate a claim, and use exact revision CAS.
- Manual draft publish, scheduled publish, edit, reschedule, and cancellation
  serialize on the same draft/schedule locks.
- A worker may finish only its frozen generation and claim token.
- Two workers cannot claim the same schedule.
- A timeout after post commit is recovered through the same stable B1
  publication command and receipt.
- Retry never creates a second post or public asset.

Owner cancellation is accepted until the canonical publication transaction
commits. A cancellation that wins the lock invalidates the claim. After
publication, cancel is a no-op conflict and never removes the post.

## Failure policy

Transient provider, network, or lease-expiry errors schedule bounded retry.
Missing ownership, changed draft revision, deleted source, invalid purpose,
blocked source, or command/fingerprint mismatch are terminal. Media not READY
at execution is retryable only while attempts remain. No retry generates debt,
financial movement, signed URL persistence, or unbounded polling.

The UI distinguishes loading, true empty, scheduled, in progress, published,
retryable failure, terminal failure, and request error. It exposes controlled
retry only when the server marks the failure retryable.

## Minimal client/UI scope

`/my-content` reuses the current screen and DraftManager facade:

- schedule a restorable B1 photo/carousel draft;
- choose local date/time and an IANA zone;
- list scheduled/failed items;
- reschedule with CAS;
- cancel with CAS;
- retry a retryable failure;
- display sanitized server errors and refresh without stale-response overwrite.

No second drafts screen, scheduler provider, or analytics system is introduced.

## Security

- owner is never accepted from a client parameter;
- private schedule tables use ENABLE/FORCE RLS and no direct table grants;
- worker functions reject every non-service caller;
- public owner RPCs reject `anon` and cross-owner access;
- worker operations are fenced by schedule ID, generation, and claim token;
- no service key or provider credential enters the client bundle;
- no signed URL, token, raw provider error, or third-party identity is audited;
- no Finance, Wallet, ledger, Ads, Marketplace, Premium, Stories, LIVE, P3, or
  MEDIA-C1 authority is weakened.

## Local verification

The PostgreSQL 17 disposable harness on `D:` proves ownership, ACL/RLS, time
resolution/DST, CAS, claims, leases, two-worker races, cancel/reschedule races,
retry bounds, receipt recovery, privacy, and no duplicate post. Worker tests use
a fake R2 provider and injected database adapter. Client tests prove timezone
payloads, stable commands, list/error/retry behavior, and minimal UI wiring.
The frozen 106-test B1 regression remains green.

## Non-goals and remote boundary

No remote SQL, cron activation, Edge deployment, R2 operation, production data,
credential use, GitHub push/PR/merge, release workflow, policy/baseline edit,
Cloudflare change, Expo process change, or BDAG movement is authorized here.
Video, Reels, Stories, Creator Web, a calendar, and physical browser-closed QA
remain later extensions/evidence.
