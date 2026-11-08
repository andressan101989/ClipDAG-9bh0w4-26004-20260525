# WEB-CONTROL-CENTERS-B2 Scheduled Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local, reviewable, durable server-side scheduler for B1
photo/carousel drafts with owner controls, private-until-due media, bounded
retry, and no duplicate publication.

**Architecture:** PostgreSQL owns schedule time, ownership, state, CAS, leases,
commands, attempts, and publication receipts. A narrow Edge worker claims only
due frozen schedules, copies private R2 bytes to deterministic canonical public
assets, and invokes the shared B1 publication core. `/my-content` adds minimal
owner controls without adding another draft or publication authority.

**Tech Stack:** PostgreSQL 17/Supabase, PL/pgSQL, pg_cron/pg_net source contract,
Supabase Edge/Deno TypeScript, Expo/React Native TypeScript, Node test runner,
fake R2 provider, disposable PostgreSQL on `D:`.

**Spec:**
`docs/superpowers/specs/2026-11-08-web-control-centers-b2-scheduled-publishing-design.md`

## Global Constraints

- Scope is B1 `photo` and `carousel` drafts owned by any authenticated user.
- Never create public media before a due schedule is validly claimed.
- Reuse B1 drafts, receipts, publishers, `media_assets`, `media_asset_links`,
  Content Safety, and MEDIA-C1; do not create parallel authorities.
- UTC is execution authority; preserve IANA/local/offset; reject nonexistent DST
  times and ambiguous times without an explicit valid offset.
- Owner RPCs derive `auth.uid()`; worker RPCs are service-only and fenced by a
  locked schedule, generation, and claim token.
- Retry is bounded and idempotent; a lost response cannot duplicate a post or
  public media target.
- All temporary files, caches, logs, clusters, and results live on `D:` using
  process-scoped environment variables only.
- No remote Git, Supabase, Cloudflare, R2, cron, Edge, release, Expo, financial,
  or production mutation is allowed.
- Local base is `840014918979fe62f563f346bd8db5472013a43e`, tree
  `5dbdfecc32d7865eceb1cddefb5519349440a420`; normalize ancestry before a
  future push because integrated `main@24d56a5...` was not locally available.

## Review Focus

- Ambiguous/nonexistent DST input must never silently select an instant; Task 1
  includes both cases and explicit-offset selection.
- A cancellation or reschedule racing an in-flight worker must invalidate the
  stale generation before any canonical publish; Tasks 1 and 2 include races.
- Provider success followed by a lost database response must resume the exact
  deterministic target and B1 receipt; Task 2 includes response-loss recovery.
- A public copy orphaned by stale claim/cancellation must be unlinked for
  MEDIA-C1 without deleting private draft media; Tasks 1 and 2 assert lifecycle.
- UI request failures must not appear as an empty list or overwrite newer data;
  Task 3 includes error/retry and stale-response tests.

---

### Task 1: Durable schedule authority and disposable PostgreSQL proof

**Files:**
- Create: `tests/webControlCentersB2ScheduledPublishing.test.mjs`
- Create: `tests/fixtures/web-control-centers-b2-security.sql`
- Create: `scripts/prove-web-control-centers-b2-disposable.mjs`
- Create with Supabase CLI, then edit:
  `supabase/migrations/<generated>_web_control_centers_b2_scheduled_publishing.sql`

**Interfaces:**
- Consumes: B1 `private.publication_drafts`, `private.publication_receipts`,
  `public.media_assets`, `public.media_asset_links`, and the exact
  `publish_my_publication_draft_v1` signature.
- Produces: owner RPCs `schedule_my_publication_draft_v1`,
  `list_my_publication_schedules_v1`, `reschedule_my_publication_v1`,
  `cancel_my_publication_schedule_v1`, `retry_my_publication_schedule_v1`;
  service-only claim/materialization/publish/fail RPCs; schedule rows carrying
  `id`, `draft_id`, `state`, `revision`, `generation`, `scheduled_for`,
  `timezone_name`, `local_scheduled_at`, `utc_offset_minutes`, `attempt_count`,
  `max_attempts`, `next_attempt_at`, `claim_token`, `claim_expires_at`,
  `retryable`, `last_error_code`, and `post_id`.

- [ ] **Step 1: Write RED source-contract and disposable tests**

  Assert exact schema, FORCE RLS/ACL, owner binding, time resolver, command
  replay/conflict, list pagination, CAS, claim fences, state transitions,
  deterministic materialization identities, canonical publisher delegation,
  no early public assets, and no direct client worker access.

- [ ] **Step 2: Run the focused tests and prove RED**

  Run: `node --test tests/webControlCentersB2ScheduledPublishing.test.mjs`
  Expected: FAIL because the B2 migration and proof harness do not exist.

- [ ] **Step 3: Generate the migration using the pinned Supabase CLI**

  Run the CLI with `NPM_CONFIG_CACHE`, `TMP`, and `TEMP` pointing to a B2 folder
  on `D:`. Use `supabase migration new web_control_centers_b2_scheduled_publishing`.
  Expected: one generated migration filename; no remote project access.

- [ ] **Step 4: Implement the minimal database authority**

  Add the private policy/settings, schedules, command receipts, attempts, and
  deterministic materialization records; fixed-order locks; time resolver;
  owner and service RPCs; B1 shared publication core/wrapper; exact grants,
  owners, RLS, search paths, indexes, and a source-only one-minute cron wake
  contract without enabling remote cron.

- [ ] **Step 5: Implement and run the PostgreSQL 17 disposable proof**

  Cover ordinary/invalid/nonexistent/ambiguous/explicit-offset time, replay,
  cross-owner denial, stale CAS, pagination, two workers, lease expiry,
  reschedule/cancel races, media readiness/privacy, bounded retry, terminal
  failure, rollback, receipt recovery, and B1/MEDIA-C1 preservation.
  Expected: all B2 SQL scenarios PASS on an isolated cluster under `D:`.

- [ ] **Step 6: Run focused and frozen B1 regression tests**

  Run: `node --test tests/webControlCentersB2ScheduledPublishing.test.mjs tests/webControlCentersB1*.test.mjs`
  Expected: B2 GREEN and the pre-existing B1 106-test regression GREEN.

- [ ] **Step 7: Commit Task 1**

  Commit migration, fixture, tests, proof script, spec, and plan only.

### Task 2: Idempotent worker and fake R2 recovery

**Files:**
- Create: `supabase/functions/process-scheduled-publications/index.ts`
- Create: `supabase/functions/process-scheduled-publications/worker.ts`
- Create: `tests/webControlCentersB2Worker.test.mjs`
- Modify: `supabase/config.toml`
- Modify only if needed: `supabase/functions/_shared/r2.ts`

**Interfaces:**
- Consumes: Task 1 claim/materialization/publish/fail RPCs and exact schedule row
  fields; existing R2 signer/client patterns.
- Produces: `processScheduledPublicationBatch(deps, options)` with injected
  database and object-store adapters; deterministic private-to-public copy and
  sanitized worker result `{ claimed, published, retried, terminal, stale }`.

- [ ] **Step 1: Write RED worker tests with fake R2 and fake RPC adapter**

  Cover internal authentication, zero early copies, deterministic keys, partial
  carousel resume, duplicate invocation, cancellation/reschedule generation
  fence, two workers, provider timeout, post-commit response loss, bounded retry,
  terminal failure, and no secret/raw-error leakage.

- [ ] **Step 2: Run worker tests and prove RED**

  Run: `node --test tests/webControlCentersB2Worker.test.mjs`
  Expected: FAIL because the worker module does not exist.

- [ ] **Step 3: Implement minimal injectable worker and Edge entrypoint**

  Parse only the canonical internal request, claim a bounded batch, copy each
  source to its reserved deterministic target, confirm provider metadata, call
  publish, and report complete/retry/terminal through matching claim RPCs. Never
  accept owner/draft/public asset identities directly from request JSON.

- [ ] **Step 4: Run worker and SQL integration tests GREEN**

  Run: `node --test tests/webControlCentersB2Worker.test.mjs tests/webControlCentersB2ScheduledPublishing.test.mjs`
  Expected: all tests PASS with no external network or R2 calls.

- [ ] **Step 5: Commit Task 2**

  Commit only worker, config, shared helper if required, and tests.

### Task 3: Owner service, timezone validation, and minimal My Content UI

**Files:**
- Create: `services/publicationScheduleService.ts`
- Create: `tests/webControlCentersB2Client.test.mjs`
- Modify: `modules/creator/drafts/DraftManager.ts`
- Modify: `app/my-content.tsx`
- Modify only if a direct caller is demonstrated: `app/(tabs)/upload.tsx`

**Interfaces:**
- Consumes: Task 1 owner RPCs and B1 `DraftManager` draft identities/revisions.
- Produces: typed schedule/list/reschedule/cancel/retry service methods;
  `DraftManager` schedule facade; a `scheduled` My Content tab with scheduling,
  status, reschedule, cancel, retry, refresh, true-empty, and error states.

- [ ] **Step 1: Write RED client and UI contract tests**

  Assert stable command reuse, local/IANA/offset payloads, invalid input handling,
  typed sanitized errors, keyset pagination, CAS, list abort/stale-response
  protection, visible schedule tab, retry-only-when-server-authorized, and no
  conversion of request errors into empty lists.

- [ ] **Step 2: Run client tests and prove RED**

  Run: `node --test tests/webControlCentersB2Client.test.mjs`
  Expected: FAIL because the schedule service/UI does not exist.

- [ ] **Step 3: Implement the service and DraftManager facade**

  Validate UUIDs, wall time, IANA name, optional offset, revision/cursor/result
  shapes, and stable command IDs. Delegate all authority to server RPCs.

- [ ] **Step 4: Implement the minimal `/my-content` scheduled UI**

  Reuse current components/styles; preserve drafts/posts/reels/saved/stories;
  show server-derived time/status/errors and controlled owner actions without a
  second screen or provider.

- [ ] **Step 5: Run client and B1 UI regressions GREEN**

  Run: `node --test tests/webControlCentersB2Client.test.mjs tests/webControlCentersB1Client.test.mjs tests/webControlCentersB1QaC2Navigation.test.mjs tests/webControlCentersB1QaC3DraftInbox.test.mjs`
  Expected: all tests PASS.

- [ ] **Step 6: Commit Task 3**

  Commit only service, facade, UI, and tests.

### Task 4: Integrated verification, security review, and local handoff

**Files:**
- Modify only for verified test defects: files owned by Tasks 1–3
- Create/update ignored evidence under `D:` only; do not commit runtime logs.

**Interfaces:**
- Consumes: all Task 1–3 interfaces.
- Produces: reviewed local branch, exact evidence, and an explicit ancestry
  normalization prerequisite before any future remote publication.

- [ ] **Step 1: Run focused B2 suites and disposable proof**

  Expected: SQL, worker, client, DST, races, privacy, recovery, and retry PASS.

- [ ] **Step 2: Run full B1 regression, relevant TypeScript/ESLint, and bundle**

  Install dependencies only in this `D:` worktree using process-scoped cache and
  temp directories. Record every PASS/FAIL/SKIP; distinguish pre-existing failures.

- [ ] **Step 3: Verify repository integrity**

  Run `git diff --check`, exact file inventory, no secrets scan, no remote delta,
  no release-governance edits, and confirm all Expo PIDs/ports remain untouched.

- [ ] **Step 4: Independent whole-branch review**

  Review specification compliance, SQL security, state-machine concurrency,
  provider recovery, MEDIA-C1 behavior, UI truthfulness, duplicates, and test
  quality. Fix every Critical/Important finding with RED→GREEN evidence.

- [ ] **Step 5: Final local report**

  Report branch/SHA/tree, exact files, migration/Edge source, test commands and
  counts, reviewer findings, rulings, deferred minors, no-remote-mutation proof,
  and pending ancestry normalization/remote release/physical QA.
