# WEB-CONTROL-CENTERS-B1 Client Corrections Plan

**Base:** `30d18bff911885df93565f15d649761ce9e10a62`

**Worktree:** `D:\CodexWorktrees\ClipDAG\web-control-centers-b1-client-corrections`

## Task 1: Pagination contract and inbox

1. Add failing behavioral tests for continuation, deduplication, page-2 retry,
   exact-50 termination, and stale owner/request fencing.
2. Expose page results from `DraftManager` without changing the RPC/service.
3. Add inbox cursor/loading-more/error state and controlled continuation loading.
4. Run the new tests and existing QA-C3 inbox regressions.

## Task 2: Revision-bound draft publication

1. Add failing tests for dirty-caption publish, CAS failure, save/publish/delete
   serialization, revision-bound command reuse, and deterministic conflict reset.
2. Introduce one per-draft mutation gate.
3. Save dirty visible state by CAS before publication and publish the confirmed
   revision snapshot.
4. Correct ambiguous/deterministic classification while retaining same-runtime
   replay through existing commands and receipt contracts.
5. Run the new tests and existing B1 publication regressions.

## Task 3: Upload save/publish exclusion

1. Add failing tests for same-turn Save/Publish in both orders for photo/carousel.
2. Add a synchronous shared mutation gate and consistent disabled states.
3. Run the focused upload tests and B1 client regressions.

## Task 4: Independent review and verification

1. Review the final diff for scope, races, stale responses, security, and duplicate
   authorities.
2. Run all B1 focal tests, focal TypeScript, focal ESLint, and `git diff --check`.
3. Verify the primary checkout and Expo worktree remain unchanged and their
   processes remain untouched.
4. Create no push, PR, merge, deploy, migration, or production mutation.

## Physical QA evidence reported by the owner

**Provenance:** This evidence was reported by Andres through messages and
screenshots relayed by supervision. The screenshots are not attached to this
thread, so Codex records the reported observations without claiming direct
pixel inspection. No exact event time, backend identifier, metric, or response
payload is inferred.

The following narrowly scoped physical cases are confirmed:

1. The existing cloud draft and its photograph opened and reappeared in the
   iPhone application.
2. The owner saved the description `Prueba 2`; the reported screenshot showed
   revision `2`.
3. The owner then changed the visible description to `Prueba 3` and pressed
   **Publish** directly without first pressing **Save changes**. The reported
   captures showed the `Publicado` alert, an empty drafts inbox, and the same
   photograph in the feed with description `Prueba 3`.

These observations are physical PASS evidence only for draft/photo recovery,
the saved revision-2 description, and direct publication of the later visible
edit without a separate save. They do not establish a global physical PASS and
do not by themselves prove pagination beyond one page, concurrent mutations,
ambiguous/lost-response recovery, durable recovery after process restart, or
any unobserved error path.

Codex did not create, modify, publish, hide, or delete the owner's content as
part of recording this evidence. The observed test publication remains
untouched.
