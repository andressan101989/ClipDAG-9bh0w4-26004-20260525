# Creator Premium QA Final F1 — Implementation Plan

1. Add failing F1 contract, client, Stream, safety, and disposable PostgreSQL tests for all five findings.
2. Add one forward-only migration that:
   - raises only the Premium Stream duration contract to 180 seconds;
   - preserves 60 seconds for every other Stream purpose;
   - adds the transactional active-plan submission coordinator using existing RPCs and idempotency receipts;
   - adds safe published-content withdrawal and dependency-free draft-plan deletion;
   - grants only `authenticated`, keeps `anon`/`PUBLIC`/`service_role` execution revoked, and uses an empty `search_path`.
3. Update `create-stream-upload` to issue a Premium TUS contract and persist the returned `stream-media-id`; retain the current basic POST contract for non-Premium callers.
4. Add bounded resumable TUS upload to the existing client service, including progress, abort, retry, and existing cleanup behavior.
5. Update Premium picker/validation/UI to 180 seconds, explicit Photos permission, passthrough/current representation, active-plan choices, atomic plan-aware submit, published withdrawal, and contextual plan deletion/retirement.
6. Extend the existing visual/semantic sample validation to 180 seconds while retaining five full-duration percentile samples and fail-closed output validation.
7. Run focused tests repeatedly, then disposable PostgreSQL, relevant Premium/Stream/P2 suites, lint/TypeScript/Metro, Release Gate, Snapshot Adapter, and `git diff --check`.
8. Commit and push the focal branch, create a protected PR, inspect checks/diff, rebase-merge, and verify the remote SHA/tree.
9. Run canonical `plan_only`, `gate_proof`, and release for the single migration plus changed Edge Functions only; verify backup, snapshots, Advisor delta, policy, Finance OFF, P2, migrations, versions/digests, and legacy data.
10. Restart only Nelyon's Expo/Metro tunnel from final `origin/main`, verify external manifest/iOS bundle HTTP 200, keep it running, and report exact iPhone retest steps without declaring `PHYSICAL_PASS`.
