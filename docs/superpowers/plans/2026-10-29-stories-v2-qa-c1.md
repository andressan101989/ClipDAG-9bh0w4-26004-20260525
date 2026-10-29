# Stories V2 QA C1 — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-29-stories-v2-qa-c1-design.md`

## Global Constraints

- Work only in `D:\CodexWorktrees\ClipDAG\stories-v2-qa-c1` on `codex/stories-v2-qa-c1`, based on exact `origin/main` `10c549ac0dd84d28ccd832264184619ec56ba97f` unless a newly fetched remote SHA is explicitly reconciled.
- Use TDD: add a behavior test, observe the intended failure, implement minimally, then run focused and relevant regression tests.
- Preserve the dirty C checkout, all stashes/worktrees, the active Expo tunnel, and unrelated files. Never use reset, clean, prune, force push, or destructive broad filesystem commands.
- Reuse the canonical StoryEditor, StoryViewer, StoriesProvider, Chat, Content Safety C2, R2/Stream, MEDIA-C1, and release workflow. Do not add parallel authorities.
- Do not create real Stories, send real messages, execute artificial production inference, or modify production outside the canonical authorized release.
- Never expose respondent identity, UUIDs, avatar/username, source tuple, or private response metadata in public composition, Realtime, routes, logs, or safety evidence.
- Preserve Finance GENERAL (purchases/subscriptions/refunds enabled, 2000 bps), Creator Premium P3, MEDIA-C1, and LIVE Battles C1.
- Use committed Git LF bytes for governed SHA-256 identities; do not derive protected hashes from the Windows CRLF checkout.

## Task 1 — Runtime contracts for exclusive composition and opaque handoffs

Create focused runtime modules and tests for:

- exclusive question-composer UI state (hide general rail, pause playback, block gestures);
- short-lived opaque handoffs bound to actor and purpose;
- recipient binding for Chat drafts;
- single consumption, expiry, wrong actor/recipient rejection, and no private text in route parameters;
- deterministic, sanitized public `question_answer` seed without private source metadata.

Use the runtime contracts from the actual components; do not test mocks or source strings. Commit the tests and implementation together after recording RED then GREEN evidence.

## Task 2 — Forward-only database authority and disposable PostgreSQL proof

Generate the migration with `supabase migration new`. Add tests first and demonstrate RED. Implement:

- static `question_answer` composition validation with exact keys and bounded question/answer text;
- a forced-RLS private Story-to-source-response linkage with all direct client/service table privileges revoked;
- a read-only authenticated preflight for inbox actions;
- one authenticated atomic media-Story publication RPC that validates owner/source/question/moderation/lifecycle/blocks, reuses canonical media creation/definitions/safety enqueue/C2 publish, and records the private link;
- exact idempotency/concurrency/rollback behavior;
- updated safety text evidence and fingerprint freshness without private IDs;
- fixed owner, ACL, and empty `search_path` contracts.

The disposable suite must cover authorized publish, spoofing, wrong actor/source/kind, hidden/blocked/expired/deleted/restricted sources, bilateral block, malformed/overlong public card, replay/conflict/concurrency, atomic rollback, public privacy, safety text/fingerprint, RLS/FORCE RLS/ACL, and preservation of C2 publication semantics.

## Task 3 — Canonical question-answer card, editor, feed, and Chat integration

Add RED behavior tests, then:

- extend the existing composition types/parser/renderer with the non-interactive `question_answer` card;
- seed the existing StoryEditor from an actor-bound handoff, keep the source question immutable, and let the creator edit the answer and card transform/layer;
- consume the handoff in the existing feed, require existing camera/gallery media, and publish via the new context/RPC path only after explicit confirmation;
- extend StoriesContext/client parsing for preflight and publication;
- consume a partner-bound Chat draft in the existing chat composer without calling any send function and without replacing user edits;
- preserve existing media upload cleanup and C2 publish-first behavior.

Run focused runtime tests, Stories authoring/viewer/editor regressions, and TypeScript.

## Task 4 — Keyboard-safe exclusive composer and private inbox actions

Add RED behavior tests, then:

- replace the transformed inline question input with a keyboard-safe modal using native keyboard APIs, safe-area insets, dynamic avoidance, scrolling, autofocus, cancel/send dismissal, and no fixed device offset;
- keep exactly one active composer, pause playback, block viewer gestures, and hide the general reply/quick-reaction rail;
- split Story lifecycle reset from Realtime revision refresh so a draft/inbox/idempotency retry is not destroyed;
- add `Responder en historia` and `Responder por privado` to eligible pending inbox responses, with per-row action fencing and actionable errors;
- revalidate through the server preflight, create opaque handoffs, close the viewer, and navigate without publishing/sending;
- implement parity in native and web viewers without disturbing playback, timer, navigation, mute, or Realtime.

Run focused tests, viewer runtime/UI regressions, Stories reply/idempotency regressions, and TypeScript.

## Task 5 — Exact release-governance successor transition

Add Release Gate and Snapshot Adapter tests first and demonstrate RED. Extend the single canonical policy/compiler/adapter to attest only the QA C1 transition:

- exact Git blob/SHA-256 of the new migration and reviewed source SHA;
- one migration and zero Edge Functions unless the real dependency graph proves otherwise;
- exact new/changed helper, relation, trigger, RPC, owner, ACL, RLS/FORCE RLS, and fixed-search-path evidence;
- installed C2 publish-first policy, Finance GENERAL, P3, MEDIA-C1, and baseline invariants unchanged;
- rejection of altered migration/helper/RPC/grant/RLS evidence and replay after baseline promotion.

Run Release Gate, Snapshot Adapter, `git diff --check`, and focused policy tests using Git LF bytes.

## Task 6 — Branch verification, protected integration, release, and baseline

Run the full relevant Stories suites, disposable PostgreSQL suite, TypeScript, lint/focal build where supported, Release Gate, Snapshot Adapter, and diff checks. Obtain task and whole-branch independent reviews with zero open Critical/Important findings.

Then:

1. Push only the focal branch and create a protected PR.
2. Verify exact files, checks, conflict state, review, and current main.
3. Rebase-and-merge through GitHub protection.
4. Dispatch fresh canonical `plan_only` and require the exact manifest.
5. Dispatch fresh `gate_proof`, verify backup/snapshot/baseline/concurrency/security/Finance/P3.
6. Run HIGH release only after all gates pass; apply only the QA C1 migration and compiler-derived Edge set.
7. Run postcheck proving no artificial Story/message, privacy/security invariants, and preserved shared systems.
8. Promote the production baseline in a separate protected PR, synchronize the exact Git-LF policy digest, and require final `NO PRODUCTIVE CHANGES`.
9. Prepare, but do not claim, the physical iOS keyboard and two-user question-response retest.
