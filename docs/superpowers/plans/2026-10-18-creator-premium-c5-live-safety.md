# Creator Premium C5 Live Safety Implementation Plan

> **Execution:** implement in this session with the canonical protected PR and release workflow.

**Goal:** Repair the verified Cloudflare Stream audio redirect mismatch that leaves a technically valid Premium video in `creator_premium_safety_provider_failed`, while preserving strict URL validation, private media, Content Safety fail-closed behavior, and the C4 visual function-calling contract.

**Root cause:** The canonical private signed audio URL returns a legitimate same-origin `302` to the exact video UID at `/dl/audio.m4a` with exactly two non-empty Cloudflare proof parameters, `p` and `s`. `audioPipeline.mjs` currently rejects every query string and requires every private redirect to retain the JWT identity in the path, so it reports `stream_audio_url_untrusted_scheme` before transcription. A second `HEAD` to the provider redirect returns `200` with `audio/mp4`. Production evidence separately proves C4 persisted valid visual analyses for both the QA image and the five sampled video frames.

**Scope:** Change only the existing `content-safety-scan` audio URL adapter and its canonical tests. No SQL, UI, policy activation, data edits, new provider, scanner, uploader, or pipeline.

---

## Task 1: Specify the provider redirect contract with failing tests

**Files:**
- Modify: `tests/adminContentSafetyAudioF6.test.mjs`

1. Add a positive test for the exact same-origin, exact-UID `/dl/audio.m4a?p=...&s=...` redirect observed through a bodyless `HEAD` request.
2. Add negative cases for a different origin, different UID, wrong path/format, missing/duplicate/extra proof keys, empty or malformed proof values, credentials, port, fragment, and overlong values.
3. Extend the bounded download test to cover the legitimate two-step `302 -> 200` flow.
4. Run the focused test and confirm the new positive case fails before implementation.

## Task 2: Implement the minimal fail-closed redirect validator

**Files:**
- Modify: `supabase/functions/content-safety-scan/audioPipeline.mjs`

1. Add one canonical redirect validator shared by public and private Stream audio routes.
2. Require HTTPS, no credentials/port/fragment, the exact original Cloudflare customer origin, the exact requested UID, the exact `/dl/audio.m4a` path, exactly one `p` and one `s` parameter, bounded non-empty base64url values, and no other parameters.
3. Keep the initial provider URL and signed-token URL validators strict and query-free.
4. Use the redirect validator only after the trusted canonical/signed URL returns an HTTP redirect; do not enable automatic redirects or free-form URL following.
5. Run focused tests until all pass.

## Task 3: Verify regressions and release readiness

**Files:**
- No additional production files unless a failing relevant test demonstrates a dependency.

1. Run the audio, Stream, Creator Premium C2/C3/C4, Content Safety, TypeScript/ESLint focal, Release Gate, Snapshot Adapter, and `git diff --check` suites applicable to the changed Edge Function.
2. Confirm no SQL delta, no UI delta, no Finance change, no policy activation, and no new architecture/callers.
3. Commit, push a focal branch, open a protected PR, obtain review, and merge through the permitted protected path.

## Task 4: Canonical deploy and postcheck

1. Reconcile the release baseline if the canonical gate requires it, without weakening controls.
2. Run `plan_only`, `gate_proof`, and `release` with an exact manifest containing only `content-safety-scan` and no migrations.
3. Verify fresh backup/evidence/snapshots, Edge version and digest, Security Advisor delta, Finance OFF, zero approved/active Content Safety rules, legacy data, and no concurrent release.
4. Re-read the two QA contents without mutating them. Do not reset attempts or retry records administratively.
5. Count intentional external inference probes as zero unless Cloudflare exposes verifiable quota/budget; existing physical-QA provider evidence may be used as historical live evidence, but mocks must not be labeled live.

## Task 5: Final independent review

1. Request one fresh-context review of the final diff and verification evidence.
2. Resolve every confirmed issue, rerun affected checks, and report demonstrated, inferred, and pending facts separately.
