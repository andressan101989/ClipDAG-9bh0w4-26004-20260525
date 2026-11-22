# WEB-CONTROL-CENTERS-B2-R2 Release Readiness Design

Date: 2026-11-21
Authority: owner-approved local preparation and external read-only verification
Base: `f92f8cbc6b2cdffc2e7688a95545d4b69bdbf56c`
Original candidate: `758d076ab2d79102e7b5d06b932a8d86f0be7baa`

## Intent

Prepare one local, reviewable B2 candidate that retains the existing
photo/carousel scheduler and adds its authorized one-minute server wake. The
candidate must remain impossible to release until fresh integrated identity,
backup evidence, private authority, closure and protected pins exist.

## Goals

- Reuse the existing PostgreSQL schedule authority and Edge worker.
- Activate exactly one server-side wake every minute, independent of clients.
- Reuse the established Vault/dispatch-secret contract without embedding a
  token, service-role key, project URL or credential in Git.
- Keep duplicate wakes safe through the existing claim/generation/token/receipt
  fencing.
- Preserve Finance, MEDIA-C1, Content Safety and every unrelated domain.
- Produce reproducible tests and a clean local commit; do not push or deploy.

## Non-goals

No second scheduler/worker/publisher, UI redesign, production SQL, Edge deploy,
cron activation, secret creation, authority issuance, backup approval, push,
PR, merge, or release is part of R2.

## Approaches considered

1. Store the service-role key in SQL/Vault and keep the current Edge bearer
   check. Rejected: it expands custody of a bypass-RLS credential and conflicts
   with the established dispatch pattern.
2. Make the worker callable with only the publishable key. Rejected: that would
   make `verify_jwt=false` an unauthenticated privileged endpoint.
3. Reuse `pg_cron -> wake function -> Vault -> pg_net` and the existing
   `CALL_DISPATCH_SECRET`. Selected: it matches current Nelyon jobs and keeps
   the database authoritative while the same Edge worker remains the only
   provider adapter.

## Canonical design

The unapplied B2 forward-only migration gains
`public.wake_scheduled_publications_b2_v1()`. It is `SECURITY DEFINER`,
owned by `postgres`, uses `search_path=''`, reads only the three established
Vault names, and makes a bounded `net.http_post` to the existing function.
Execute is revoked from `PUBLIC`, `anon`, `authenticated` and
`service_role`; the cron job runs as `postgres`.

The migration asserts that pg_cron, pg_net and Vault exist, rejects more than
one job with the canonical name, schedules the job if absent, or uses
`cron.alter_job` to restore the exact schedule/command and active state if it
already exists. It never updates `cron.job` directly. The exact job is
`process-scheduled-publications-b2`, schedule `* * * * *`, command
`select public.wake_scheduled_publications_b2_v1()`.

The existing Edge entrypoint accepts either its current exact service-role
bearer or the cron request only when bearer and apikey are the same gateway
credential and `x-scheduled-publications-secret` matches the existing
`CALL_DISPATCH_SECRET` environment value using constant-time comparison.
The Supabase gateway remains responsible for validating the supplied
publishable credential. Publishable-only requests remain unauthorized.

## Release governance

R2 changes the public descriptor to `state=candidate`,
`release_ready=false`, `cron_activation=true`, with integrated SHA,
inventory, function digests and private-authority digest left null. The parser
accepts historical candidate fixtures but requires cron activation for any
approved B2 descriptor. A later protected phase must bind the integrated bytes
and issue fresh authority; R2 never fabricates those facts.

## Safety and rollback

The existing B2 locks, leases, generation/token fences and publication receipt
remain authoritative. Duplicate wakes may race but cannot duplicate the
observable publication. Operational deactivation is a later forward-only
change that asserts exactly one canonical job and calls
`cron.alter_job(..., active := false)`; it does not delete schedules, media,
receipts, secrets or the worker.

## Verification boundary

R2 uses RED/GREEN tests for endpoint authentication, cron source contract,
descriptor fail-closed state, parser compatibility and concurrent wakes.
PostgreSQL disposable tests must exercise migration and ACL behavior. External
checks are read-only. Node 24.21.0 is required for the canonical workflow; if
that exact runtime is unavailable locally, the affected checks are reported as
blocked rather than relabeled PASS.
