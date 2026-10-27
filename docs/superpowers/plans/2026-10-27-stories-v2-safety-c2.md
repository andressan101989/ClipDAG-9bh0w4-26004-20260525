# Stories V2 Safety C2 Implementation Plan

> Execute with strict TDD, an isolated worktree, protected Git integration, and
> the canonical Supabase release workflow.

## 1. Baseline and RED contracts

- Verify `origin/main`, clean D: worktree, production baseline, C1 policy state,
  existing scanner/cron/admin authorities, and no concurrent release.
- Add C2 static and PostgreSQL disposable tests before production changes.
- Prove RED for immediate follower access, atomic durable enqueue, explicit
  publication/moderation/scan states, no historical backfill, no automatic
  pass/block, admin restrict/remove, stale completion fencing, and private
  question responses.
- Add RED governance tests for a C1-predecessor to C2-successor transition,
  exact manifest closure, policy digest, postcheck, and baseline/recovery.

## 2. Forward-only database change

- Generate the migration with the Supabase CLI.
- Install the exact versioned C2 operating-policy/control artifact.
- Extend `private.story_safety_state` with explicit C2 publication and moderation
  fields while preserving FORCE RLS and all grants.
- Add internal publication fence/runtime projection helpers with owner postgres,
  `SECURITY DEFINER`, empty `search_path`, and no client EXECUTE.
- Recreate all current canonical Story create overloads so enqueue + publication
  marker commit together and replay remains idempotent.
- Replace `private.story_can_access` with publish-first access while preserving
  authentication, audience, blocks, expiry, admin overlay, and owner rules.
- Extend scan synchronization without allowing it to modify publication or human
  moderation decisions.
- Extend the existing admin Story command/projections for sanitized C2 states and
  audited keep/restrict/remove enforcement.
- Add only query-backed indexes and no historical data backfill.

## 3. Client and admin wiring

- Preserve the editor's immediate-success flow without displaying a safety PASS.
- Add bounded store/viewer reconciliation for private moderation invalidation,
  reusing `loadStories` and existing session/generation guards.
- Extend Admin Stories types, validation, detail UI, and actions with sanitized
  publication/moderation/scan states; do not expose evidence or private URLs.
- Preserve private interactive question responses and DM replies.

## 4. Release governance

- Add a separate C2 release transition; do not weaken or rewrite C1 history.
- Make compiler and snapshot adapter phase-aware for C1 pre → C2 post.
- Attest exact migration/policy/helper bytes, RLS/ACL/owner/search-path, control,
  empty historical backfill, scanner/cron identity, and zero automatic rules.
- Update Release Gate and Snapshot Adapter tests with hostile mutation cases.

## 5. GREEN and review

- Run disposable C2 proofs, C1/B1 Stories regressions, admin safety suites,
  scanner audio/visual/text suites, signed-media tests, P3/MEDIA/Finance/LIVE
  preservation suites, focused TypeScript/ESLint, Release Gate, Snapshot Adapter,
  and `git diff --check`.
- Request independent database/security, client/privacy, and governance reviews.
- Fix every Critical or Important finding and rerun affected suites.

## 6. Protected integration and release

- Commit focal changes, push only the feature branch, open/attach protected PR,
  verify exact diff/checks/conflicts/review, and rebase-merge.
- From the integrated SHA run `plan_only`, validate exact HIGH manifest,
  consisting of the C2 migration plus the existing `get-stream-playback` Edge
  Function only. Confirm `content-safety-scan` remains unchanged, then run
  `gate_proof`, backup, snapshot pre, release HIGH, snapshot post, and postcheck.
- Promote the verified production baseline in a separate protected PR, synchronize
  the exact Git-LF policy digest, and require final `NO PRODUCTIVE CHANGES`.
- Do not create Stories, run artificial production inference, or backfill history.

## 7. Closure

- Report exact SHA/PR/migration/Edge versions, policy/control, publication model,
  queue/retry/alerts/admin enforcement, privacy/RLS/ACL, test evidence, release,
  baseline, costs, residual signed-grant TTL, and physical QA still pending.
