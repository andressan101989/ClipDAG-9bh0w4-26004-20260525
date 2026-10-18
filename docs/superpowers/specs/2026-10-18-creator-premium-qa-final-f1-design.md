# Creator Premium QA Final F1 — Design

## Scope and invariants

F1 fixes the five physical-QA findings without introducing a second Premium, media, safety, or finance authority. Finance remains disabled, the P2 safety policy remains fail-closed, private media stays private, the 200 MB limit remains unchanged, and existing historical plan/content versions are preserved.

## Root causes

1. The editor lists only `draft` plans even though the production VIP v2 plan is `active`. Saving also mutates only draft mappings, so the active plan can never be selected for a new subscription publication.
2. Premium mobile video uses Cloudflare's basic one-shot POST. Production evidence contains repeated identical `pendingupload` reservations followed by safe deletion before the same file eventually succeeds. Cloudflare recommends resumable TUS for unreliable connections.
3. The 60-second limit is independently enforced by the client, Stream reservation, database constraints, provider request, playback validation, visual sampling, and semantic indexing.
4. The owner lifecycle has draft deletion, pending-review cancellation, and rejected-content reopening, but no owner withdrawal for a published item.
5. Active-plan retirement exists, but a dependency-safe draft-plan deletion operation and its UI are missing.

## Plan selection

The editor displays only owned `active` plans as eligible choices. Subscription submission uses one new transactional orchestration RPC. It validates the exact active plan IDs server-side, versions only plan families whose membership changes, calls the existing canonical content-submission RPC, then calls the existing activation/retirement RPCs in the same transaction. The operation uses the existing `public.idempotency_keys` authority. A failure rolls back plan versions, mappings, and submission together.

The existing submission, plan clone, mapping, activation, and retirement functions remain the domain authorities. The new RPC coordinates them; it does not reimplement content-safety enqueueing or plan activation rules.

## Video reliability and 180 seconds

Generic feed/business video remains at 60 seconds. `creator_premium_video` becomes the only 180-second Stream purpose.

- The existing `create-stream-upload` function creates Cloudflare's official TUS upload for Premium while retaining basic POST for other purposes.
- The client uses `tus-js-client` against the one-time URL, bounded retry delays, a valid Cloudflare chunk size, progress, cancellation, and cleanup through the existing asset deletion path.
- iOS requests Photos permission explicitly and asks for the current/passthrough representation to avoid unnecessary PhotoKit export/transcoding.
- The DB accepts 180 only for Premium and the reservation stores that per-asset limit.
- Webhook/playback keep using the stored per-asset maximum.
- Safety and semantic analysis take five percentile samples across the full duration (including near 95%) and audio continues through the existing full-track pipeline.

No upload URL, provider token, signed playback URL, or private media content is persisted in logs.

## Content lifecycle

- `draft`: existing irreversible soft delete and safe media cleanup.
- `pending_review` / failed verification: existing cancellation fences workers and returns to draft; the draft can then be deleted.
- `rejected`: existing reopen returns to draft; it can then be deleted.
- `published`: new owner-only withdrawal transitions to canonical `removed`, retires the active offer, preserves media links, plan/version history, receipts, and subscription records, and blocks when any financial history exists pending a separate product decision.
- `deleted` / `removed`: historical, no owner restore.

Published withdrawal is lock-protected and idempotent. It removes catalog/playback availability through the existing lifecycle/entitlement rules without destroying evidence.

## Plan lifecycle

- `draft`: new owner-only hard delete is permitted only with zero mappings, subscriptions, and periods.
- `active`: existing retirement remains the safe operation and preserves all mappings and obligations.
- `retired`: historical, never deleted.

## Verification

Tests start red for active-plan selection, atomic versioning, cross-user denial, idempotency, dependency blocks, 179/180/181-second boundaries, Premium-only DB limits, TUS contract/retry/cancel/progress, five-sample full-duration coverage, picker recovery, lifecycle UI, and finance/safety invariants. SQL runs in the disposable PostgreSQL harness; backend changes use the canonical plan/gate/release workflow with an exact manifest.
