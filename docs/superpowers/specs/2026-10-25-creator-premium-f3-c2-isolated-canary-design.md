# Creator Premium F3-C2 — Isolated Canary and Governance Hardening Design

## Intent

F3-C2 proves the existing Creator Premium BDAG authority with a complete synthetic 3,000.00000000 BDAG lifecycle in PostgreSQL disposable and fixes the governance gaps found in F3-C1. It does not activate production Finance, seed a production authorization, alter real balances, deploy an Edge Function, or create a second ledger, wallet, escrow, reconciliation system, or charge authority.

## Canonical approach

The existing singleton policy, authorization envelope, charge/refund RPCs, receipts, subscription periods, entitlements and BDAG ledger remain the sole monetary authority. One forward-only migration adds four narrowly scoped controls:

1. deterministic, versioned, length-prefixed UTF-8 serialization for every immutable authorization field and a server-computed `configuration_digest`;
2. an immutable private owner-attestation commitment whose authority comes from a separately reviewed protected migration, not from a caller-supplied SHA-256;
3. a monotonic `OPEN -> CLOSED` transition with policy-first locking, immutable economic scope, charge shutdown, a bounded refund-only state, and final OFF state;
4. F3 provenance reconciliation binding receipts/periods to the exact authorization, original/reversal transactions and balanced ledger entries.

The migration registers no attestation, authorization or financial fact and leaves the F3 foundation OFF constraint and INSERT guard effective. Disposable tests may remove only the named OFF constraint and disable only the named foundation INSERT trigger while keeping digest, attestation, FK, lifecycle, RLS and accounting guards active.

## Canonical digests

Configuration serialization is domain-separated and includes the authorization UUID, client contract, buyer/creator UUIDs, all three account UUIDs, content/offer/plan UUIDs, both fixed-eight-decimal prices, all count and gross caps, the 2,000-bps fee, and charge/refund timestamps encoded as UTC epoch microseconds. Mutable status and closure metadata are excluded. Each scalar is encoded as `key:UTF8-byte-length:value` in fixed order and joined with LF without a trailing LF.

An owner-attestation commitment binds the configuration digest to an immutable approval reference, evidence digest, repository, protected source SHA, environment, approved timestamp and attestation version. The database verifies the commitment bytes. Human authority remains the protected Git/release process: no runtime RPC can mint an attestation, and `PUBLIC`, `anon`, `authenticated` and `service_role` receive no table or helper privileges.

## Lifecycle and refunds

Only `OPEN -> CLOSED` is permitted. Identity, accounts, targets, prices, limits, windows, contract, digests and creation provenance cannot change. `CLOSED -> OPEN`, DELETE and repeated mutations fail.

Closing takes locks in the established order: policy, then active authorization. It atomically disables purchase and subscription. When the refund window and remaining refund allowance are valid, it retains canary mode solely for refunds against already stamped facts. Charges continue to require OPEN. Refund admission accepts OPEN or CLOSED but remains bound to the same active authorization, fee, deadline, count and exact fact provenance. A separate owner-only finalizer returns the singleton policy to OFF after all authorized reversals, or after the immutable refund deadline or count allowance has been exhausted; unreversed canonical facts and their acquired rights remain intact in those terminal cases. Neither helper is executable by client or service roles.

## Disposable proof

Synthetic accounts start at buyer 3,000.00000000, creator 0.00000000 and platform 0.00000000 BDAG. One 1,500.00000000 purchase and one 1,500.00000000 subscription at 2,000 bps yield buyer 0.00000000, creator 2,400.00000000 and platform 600.00000000. Cancellation moves no money. Purchase and period refunds reverse the stored splits exactly and restore 3,000.00000000 / 0.00000000 / 0.00000000. Every transaction has exactly three balanced ledger legs.

Tests exercise replay, duplicate operations, insufficient balance, tampered price/accounts/identities, absent or mismatched attestation, expired windows, exposure caps, `OPEN -> CLOSED`, rejected reopening, refund-only closure, final OFF, two-session races, rollback, RLS/FORCE RLS/ACL and reconciliation before and after every synthetic operation.

## Production invariants

Applying the migration alone leaves Finance `off/false/false/false/0/null`, zero F3 authorizations and zero real Premium money facts. Content Safety P3 and MEDIA-C1 are untouched. No Edge, UI or production data change belongs to this phase. The branch may be pushed and proposed through a protected PR, but must not be merged or deployed in F3-C2.
