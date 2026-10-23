# Creator Premium media retention v1

## Purpose and authority

This document records the preservation-first retention contract used by Creator Premium Media Lifecycle C1. It does not create a legal retention period, override a legal hold, authorize provider deletion, or replace the canonical server-side media lifecycle.

The read-only inventory tool classifies evidence. It never authorizes automatic deletion and never writes to Supabase, Cloudflare R2, or Cloudflare Stream.

## Retention rules

- Active and referenced media is retained.
- Removed media is retained while receipts, entitlements, subscriptions, disputes, contractual rights, or another valid obligation may depend on it.
- A legal hold always preserves the media. An unknown legal-hold state is treated as a preservation blocker.
- Deleted application content does not by itself prove that its physical media may be deleted.
- A physical deletion is eligible only when canonical links are absent, upload authority has safely expired, retention evidence is complete, no rights or holds require preservation, and the current lifecycle fence authorizes cleanup.
- A provider DELETE response is not absence proof. Independent R2 `HEAD` or Stream metadata evidence is required by the lifecycle authority before a deletion can be recorded as physically verified.
- Initial provider deletion has at most twelve fenced attempts, with exponential backoff capped at six hours. A distinct confirmation fence is used only for the second absence observation; it is not another initial provider-delete attempt. Physical absence must be observed twice before `delete_pending` becomes `deleted`, and the second observation is scheduled no earlier than one hour after the exact persisted upload authorization expiry.
- A confirmed tombstone receives one bounded 24-hour post-delete verification, with at most three attempts for transient verification errors. If the object reappears during that bounded window, the canonical cleanup worker issues a new idempotent DELETE, records its acknowledgement immediately, and verifies absence again. Exhaustion remains visible for manual investigation; it is never reported as verified deletion.
- The bounded observation window is a technical safety control, not a legal-retention period and not a claim that an already issued R2 presigned PUT can be revoked. Long-term drift is detected by the separately controlled read-only inventory reconciliation; it is not an unbounded provider-call loop in the cleanup cron.
- Provider-only findings are preserved for review. They are not automatically classified as disposable or deleted.
- Supabase-only findings remain evidence of drift; the tool does not recreate, publish, or delete anything.
- Missing, contradictory, or partial evidence is classified as indeterminate and resolves to preservation.

## Eleven legacy rows

The eleven (11) legacy, non-Premium, unlinked rows identified in the baseline audit remain preserved. They are outside automatic C1 cleanup enrollment. A count mismatch is a blocking inventory finding, not permission to modify, migrate, or delete any row or provider object.

## Classification contract

- **A — Active and referenced:** canonical database identity, live provider identity, and active references.
- **B — Legitimately retained:** receipts, entitlements, disputes, subscriptions, legal hold, or another explicit retention reason requires preservation.
- **C — Pending cleanup:** canonical lifecycle state schedules a fenced cleanup or absence verification, including a provider-absent asset whose verification has not committed yet.
- **D — Provider-only:** a recognized Creator Premium provider identity has no canonical database identity. Preserve and investigate.
- **E — Supabase-only:** a canonical database identity has no provider inventory match. A matching-fence, verified-absence tombstone is an expected retained audit record; any asset still covered by entitlements, receipts, disputes, subscriptions, or legal hold is missing-provider drift. Preserve the database record and investigate.
- **F — Confirmed physical orphan:** current provider inventory finds a C1-managed tombstone that has a matching-fence prior absence receipt and complete no-retention evidence. Reappearance is derived from those two sources; it is not trusted from a precomputed flag. This is a finding for separately authorized cleanup, not an automatic delete instruction.
- **G — Indeterminate:** scope, pagination, ownership, retention, legacy, or lifecycle evidence is missing or ambiguous. Preserve.

## No invented period

No legal retention period is invented here. Technical authorization-expiry and retry windows belong to the media lifecycle protocol; they are not statements about legal retention. If a legal or product retention decision is missing, the asset remains preserved until an authorized decision is recorded.

## Audit privacy

Artifacts contain aggregate counts and salted hashes only. Object keys, Stream UIDs, internal UUIDs, filenames, signed URLs, tokens, prompts, and private media are never emitted. The hash salt is supplied out-of-band and never appears in the artifact.

## Offline inventory execution

`scripts/audit-creator-premium-media-inventory.mjs` is deliberately offline. It has no network or provider-write client. An authorized operator must first obtain complete JSON page snapshots through separately controlled, read-only Cloudflare R2 Object Read, Cloudflare Stream Read, and Supabase read-only paths.

The script validates the supplied scope evidence contract; it does not introspect a Cloudflare token or independently prove a live provider permission. Artifacts therefore state `liveProviderVerified: false` and `mode: offline_attested_snapshots`. A later controlled run must pair the artifact with the official read-only capture evidence. This offline result must not be reported as live provider verification on its own.

Provider reads are not assumed to be free. A release gate must use current official account/quota evidence before running a live inventory capture. When that evidence is unavailable, the capture remains blocked and the offline classifier cannot be reported as a live reconciliation.

Execution requires all of the following:

- `--confirm-read-only`;
- local database, R2-page, and Stream-page JSON paths;
- exact expected Cloudflare account, R2 bucket, Stream project scope, and Supabase project;
- the name of an environment variable containing a private hash salt;
- one capture identity shared by the database, every R2 page, and every Stream page;
- the expected preserved legacy count, currently `11` for the audited baseline.

Every provider page must repeat its exact read-only scope, declare only the permitted list/metadata operations, carry an official-scope evidence digest, mark itself complete, and provide a terminating pagination cursor contract. A provider-only object also needs verified canonical Creator Premium namespace evidence before it can enter category D. All sources must share the expected capture identity and remain within the bounded capture window. A wrong scope, partial page, repeated cursor, duplicate identity, mixed capture, unknown namespace, retention gap, or legacy-count drift produces an indeterminate artifact. The tool does not fall back to a live request and never turns incomplete evidence into reconciliation success.

CLI exit codes are gate-oriented: `0` only for a reconciled complete snapshot, `3` for indeterminate or incomplete evidence, `4` for drift or pending cleanup, and `2` for invalid/refused execution.
