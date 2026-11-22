# WEB-CONTROL-CENTERS-B2-FINAL Production Completion Design

Date: 2026-11-22
Authority: owner-approved B2 correction, protected integration and production release
Initial integrated SHA: `109395035d13ba3db8d338dc3b2524191defe873`
Initial tree: `ee60aae9271a78c6053dce9f3a6bdae617254f29`

## Intent

Complete the already-integrated B2 scheduled photo/carousel publication system
without rebuilding it. The release remains fail-closed until one immutable
eight-function manifest, a fresh physical backup observed as completed, a
point-in-time protected Vault/Edge equality observation, an authenticated
owner approval obtained after those observations, and a content-addressed
private authority object all bind the same integrated source and release
contract.

## Goals

- Preserve the existing B2 scheduler, publisher, receipts, leases, locks,
  generation fences, Content Safety and MEDIA-C1 contracts.
- Redeploy the seven existing Edge Functions whose transitive source closure
  includes the changed `_shared/r2.ts`, and enroll the new canonical scheduler
  worker in one protected batch.
- Make partial Edge deployment observable per slug and ineligible for successful
  recovery until every exact row is reconciled.
- Compare `call_dispatch_secret` with `CALL_DISPATCH_SECRET` inside protected
  provider contexts without logging, exporting or persisting either value or a
  reusable verifier.
- Issue the existing private authority envelope through a separate protected,
  terminal and content-addressed path only after fresh evidence and an
  authenticated owner approval bound to that evidence.
- Run plan-only, gate-proof, release HIGH, postcheck, protected baseline
  promotion and a final no-change plan through the canonical workflow.

## Non-goals

No second scheduler, worker, publisher, draft system, media authority, wallet,
ledger or release system. No UI redesign, finance change, provider-trigger
change, secret rotation, artificial publication, destructive rollback or
manual production deployment outside the protected workflow.

## Canonical eight-function manifest

The release compiler must operate on committed Git-LF blobs, not checkout line
endings. The exact set is:

1. `ai-handoff` (`verify_jwt=false`)
2. `cleanup-stale-media-uploads` (`verify_jwt=false`)
3. `content-safety-scan` (`verify_jwt=true`)
4. `create-media-upload` (`verify_jwt=true`)
5. `finalize-media-upload` (`verify_jwt=true`)
6. `get-media-url` (`verify_jwt=true`)
7. `process-scheduled-publications` (`verify_jwt=false`)
8. `video-semantic-index` (`verify_jwt=true`)

The seven existing functions retain their public contracts and JWT settings.
Every deployment attempt records a private per-function completion row only
after a fresh provider readback proves the expected slug, version/status/JWT
configuration and deployed package identity. A failure or timeout reconciles
the completed prefix and indeterminate slug read-only, but remains ineligible
for successful-stage recovery. Normal postcheck and historical recovery must
consume the exact ordered eight-row proof and distinguish Git source digests
from provider bundle digests.

## Backup and parity observation

The protected observation path is read-only and terminal. It selects the latest
eligible physical Supabase backup for the pinned project, records the real
provider observation time, and emits only the approved canonical candidate
fields and their digest. No quarantined or synthetic evidence is accepted.

For parity, the protected job reads the single Edge secret digest in ephemeral
memory, generates a fresh nonce and asks the read-only SQL API to compute a
one-time keyed tag from the exact Vault value. It compares tags in constant
time, rereads Edge metadata to detect rotation, and discards the digest, nonce,
tags and provider bodies. Public output contains only opaque point-in-time
observation identifiers, pinned resource names, timestamps and a pass/fail
result. Missing, duplicate, malformed, rotated or permission-denied inputs fail
closed. This attests equality at the observed instant; it does not invent a
provider generation or freeze guarantee.

## Specific owner approval

After backup and parity observations, the workflow creates a canonical
pre-issuance digest that binds operation, integrated SHA/tree, public contract,
manifest, backup candidate, parity observation, policy, baseline and runtime
closure. Production Environment automation is not owner approval. The required
specific approval is an authenticated owner action bound to this exact digest
and occurring after both observations. It is one-use and expires with the
evidence. No private authority object may be written before this approval.

## Private authority issuance

Issuance is a mutually exclusive terminal workflow path. It revalidates the
source, observations and one-use owner approval, assembles the existing strict
authority envelope in memory, validates it with the canonical parser, hashes
its exact bytes, and performs one create-only conditional PUT at
`internal/release-authority/v1/sha256/<digest>.json`. Success, an existing
object, or an indeterminate transport result is accepted only after exact
readback through the existing bounded reader. Writer credentials are scoped to
the issuer step; private bytes and provider responses never become job outputs,
artifacts, logs or command arguments. The ordinary release consumer remains
read-only.

## Release identity and ordering

There is no authority/descriptor hash cycle: the private envelope binds the
public contract and integrated source, not the final descriptor digest. The
order is:

1. integrate reviewed code and capture final SHA/tree;
2. compile exact manifest and source/config rows from committed LF blobs;
3. observe backup and Vault/Edge parity;
4. obtain the specific owner approval over the pre-issuance digest;
5. issue/read back private authority and pin its digest in the descriptor;
6. integrate authorization metadata through a protected PR if required;
7. regenerate closure and protected pins for the final integrated identity;
8. plan-only, gate-proof, release HIGH, postcheck, baseline and final plan.

Any source or protected metadata change invalidates downstream observations and
requires recomputation; it never permits reusing an expired authority.

## Safety and recovery

- Migration, function deploy and cron activation occur only in release HIGH.
- The B2 migration remains forward-only and installs exactly one one-minute job.
- Partial function batches are explicitly reconciled and cannot be represented
  as a completed deployment.
- Recovery requires exact migration and eight-function receipts and cannot
  promote a baseline after incomplete recovery.
- Secrets, tokens, private authority bytes and provider bodies are redacted from
  all public surfaces.
- Finance GENERAL, Wallet, ledger, Marketplace, Ads, Creator Premium, Stories,
  LIVE and MEDIA-C1 remain unchanged.

## Verification boundary

RED/GREEN tests cover Git-LF manifest reproduction, all eight deployments,
partial-batch reconciliation, recovery ordering, parity match/mismatch and
rotation, redaction, one-use owner approval, immutable authority publication,
descriptor/closure pins, disposable PostgreSQL/pg_cron, B2 worker behavior,
concurrency/fencing and regression suites. Production success additionally
requires fresh provider evidence, protected GitHub runs and final postcheck; no
mock or HTTP 200 alone constitutes physical or production proof.
