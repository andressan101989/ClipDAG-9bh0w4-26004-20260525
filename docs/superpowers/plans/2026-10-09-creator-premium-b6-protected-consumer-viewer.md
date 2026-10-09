# Creator Premium B6 — Protected Consumer Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fail-closed Creator Premium consumer library and protected image/video viewer that reuses B1 entitlement, B2 private-image grants, B3 signed Stream playback, and the B5 catalog without enabling Premium finance or adding a server authority.

**Architecture:** Keep authorization and grant issuance in the existing server authorities. Add a pure in-memory viewer controller, a shared reference-counted app-switcher protection coordinator, focused React hooks/components, and two Expo Router screens. Navigation carries only `contentId`; protected grants live only in memory and are invalidated on background, logout, identity/content change, denial, or unmount.

**Tech Stack:** Expo 54, Expo Router 6, React Native 0.81, TypeScript, `expo-image` 3, `expo-video` 3, `expo-screen-capture` 8, Supabase JS 2, Node test runner, ESLint.

**Spec:** [Creator Premium B6 — Protected Consumer Viewer Design](../specs/2026-10-09-creator-premium-b6-protected-consumer-viewer-design.md) at approved commit `6c0290e29fbb7c91f7f52258b46e484380c97994`.

## Global Constraints

- Work only in `C:\creator-premium-b1-main-integration` on the existing `codex/creator-premium-b5-creator-management-ux` branch. Create no clone, branch, worktree, or dependency tree.
- Revalidate the approved local spec SHA and remote references before implementation; do not rewrite published history or unknown work.
- Do not modify Supabase migrations, database objects, RLS, RPCs, Edge Functions, finance policy, wallets, ledgers, roadmap state, package manifests, or lockfiles.
- Keep `CREATOR_PREMIUM_FINANCE_AVAILABLE = false`; B6 exposes no purchase, subscription, refund, or ledger mutation.
- Reuse canonical B1/B2/B3/B5 APIs through existing services. Add no endpoint, entitlement cache, media provider, or parallel authority.
- Pass only `contentId` through navigation. Never pass or persist private URLs, object keys, asset IDs, Cloudflare UIDs, signed tokens, or provider metadata.
- Keep grants in process memory only. Validate user/content identity, media type, allowed provider/domain, expiry, and maximum lifetime (`now + 315 seconds`, including clock tolerance around the canonical 300-second grant).
- Provider fallback is allowed only after a typed non-security `missing` result. HTTP 401/403, entitlement denial, revocation, moderation/block/security denial, malformed grant, and security-validation failure are terminal.
- Keep an opaque cover mounted until entitlement, grant, and screen protection all succeed. Native protection errors are fail-closed.
- Coordinate iOS app-switcher protection through one process-wide reference-counted coordinator shared by B6 and chat one-time media. A screen releases only its claim; native disable runs only after the last claim is released.
- Images use `expo-image` with `cachePolicy="none"`. Video disables caching, PiP, external playback/AirPlay, fullscreen/native controls, frame analysis, background playback, and Now Playing.
- A generation token and serialized player-command queue prevent late entitlement, grant, load, or play work from restoring media after close, background, logout, identity change, content change, or invalidation.
- Report static/native-contract evidence separately from real-device validation. Only physical Android/iOS testing can validate actual platform capture/app-switcher behavior.
- Preserve the C2 production deploy gate. Do not push if an existing workflow/integration could create a preview or production deployment.
- Finish with one coherent functional commit, `feat(premium): add protected consumer viewer`. Use a second `fix(premium): harden private playback lifecycle` only for a distinct verified defect.

## Review Focus

1. Releasing chat protection must not disable iOS app-switcher protection still owned by B6, and vice versa.
2. A 401/403, revocation, entitlement/security denial, or invalid grant must stop resolution; only explicit `missing` may try the alternate canonical provider.
3. A late `replaceAsync`, play, entitlement, or grant completion must never reveal/restart media after close or session invalidation.
4. Account/content churn must never let an old response populate a new viewer identity.
5. Direct entry without a catalog hint must resolve media conservatively without treating security/network failure as absence.

---

## Planned File Structure

### Create

- `services/creatorPremiumViewerRuntime.mjs` and `.d.mts` — pure authorization/grant state machine, typed safe errors, bounded process-memory media-kind hints, generation invalidation.
- `services/screenProtectionCoordinator.mjs` and `.d.mts` — serialized, reference-counted global app-switcher claims.
- `services/creatorPremiumProtectedVideoRuntime.mjs` and `.d.mts` — serialized player commands with invalidation barriers.
- `hooks/usePremiumScreenProtection.ts` — Expo binding over keyed capture protection and the shared coordinator.
- `hooks/useCreatorPremiumViewer.ts` — session/focus/AppState/grant lifecycle orchestration.
- `components/premium/PremiumWatermark.tsx`, `ProtectedPremiumImage.tsx`, `ProtectedPremiumVideo.tsx`.
- `app/my-premium-library.tsx` and `app/creator-premium-viewer/[contentId].tsx`.
- `tests/creatorPremiumB6ViewerRuntime.test.mjs`, `creatorPremiumB6ScreenProtection.test.mjs`, `creatorPremiumB6ProtectedMedia.test.mjs`, and `creatorPremiumB6ClientUx.test.mjs`.

### Modify

- `services/creatorPremiumService.ts`, `creatorPremiumMediaService.ts`, and `creatorPremiumStreamService.ts`.
- `app/chat/[userId].tsx`, `app/creator/[id].tsx`, `app/(tabs)/profile.tsx`, and `app/_layout.tsx`.

### Explicitly Unchanged

- `app/my-subscriptions.tsx`, `app/creator-monetization.tsx`, `app/creator-premium-editor.tsx`, and `app/(tabs)/upload.tsx`.
- All `supabase/migrations/**`, `supabase/functions/**`, finance/ledger/wallet code, package files, lockfiles, and roadmap files.

---

## Task 1: Establish the Baseline and Build the Pure Viewer Runtime

**Files:** Create `services/creatorPremiumViewerRuntime.mjs`, `.d.mts`, and `tests/creatorPremiumB6ViewerRuntime.test.mjs`; modify the three canonical Creator Premium services.

### Contract

```ts
type GrantErrorCode = 'denied' | 'missing' | 'network' | 'unavailable' | 'invalid';

interface CreatorPremiumViewerController {
  open(input: { userId: string; contentId: string }): Promise<void>;
  revalidate(reason: 'focus' | 'foreground' | 'timer' | 'manual'): Promise<void>;
  invalidate(reason: 'background' | 'logout' | 'identity_change' | 'content_change' | 'close' | 'security'): void;
  getSnapshot(): CreatorPremiumViewerSnapshot;
  dispose(): void;
}
```

The bounded hint store is keyed by `userId + contentId` (maximum 128 entries); it optimizes selection but never grants access.

### Steps

- [ ] Revalidate workspace/branch/SHA/remotes, clean status, disk capacity, and concurrency. Stop rather than mutate on mismatch.
- [ ] Run existing B1–B5 entitlement/grant client suites and record exact baseline totals.
- [ ] Write RED tests for owner/purchase/subscription allow and minor, missing ownership, expiration, reversal, suspension, blocking, and moderation denial.
- [ ] Write RED tests for expired, overlong, malformed, wrong-content, wrong-domain/provider, and cross-user grants.
- [ ] Add mandatory terminal tests: 401, 403, revoked/security denial, and malformed-security grant each make one provider call; only typed `missing` may try the alternate provider.
- [ ] Test direct entry without a hint: one `missing` then one valid succeeds; two `missing` results become media-unavailable; network/5xx/security failure terminates.
- [ ] Test deferred account/content changes, logout, close-during-entitlement, and close-during-grant; stale completions must not update state or restore a URL.
- [ ] Run `node --test tests/creatorPremiumB6ViewerRuntime.test.mjs` and record RED.
- [ ] Implement the pure controller, bounded hints, generations, and classifier: 401/403/security → `denied`; 404/no-link → `missing`; transport → `network`; retryable provider/server → `unavailable`; malformed/unsafe → `invalid`.
- [ ] Adapt only canonical services. Recheck current user before entitlement and after grant; validate exact content, HTTPS, provider/domain, future expiry, and maximum TTL. Never log/include a private URL in errors.
- [ ] Keep finance/public-launch flags false; add only truthful viewer availability/copy if needed.
- [ ] Run runtime plus B2/B3 client grant regressions GREEN and self-review `.mjs`/`.d.mts` consistency.

---

## Task 2: Add the Shared Screen-Protection Coordinator

**Files:** Create coordinator module/types, `hooks/usePremiumScreenProtection.ts`, and its test; modify only app-switcher ownership in `app/chat/[userId].tsx`.

### Contract

```ts
interface AppSwitcherProtectionCoordinator {
  acquire(owner: string): Promise<void>;
  release(owner: string): Promise<void>;
  releaseAllForOwner(owner: string): Promise<void>;
  has(owner: string): boolean;
  claimCount(): number;
}
```

Native calls are serialized; duplicate owner acquisition is idempotent; failed acquisition rolls back; disable runs only on the transition from one claim to zero.

### Steps

- [ ] Write RED pure tests for one/two owners, duplicate acquisition, out-of-order release, concurrent acquire/release, enable rollback, and conservative disable failure.
- [ ] Add the mandatory overlap test: `premium-viewer:*` and `chat-one-time-media:*`; releasing either cannot disable native protection while the other remains.
- [ ] Add hook/source tests proving opaque coverage for `arming`/`failed`/unsupported states, retry, exact cleanup, and no Photos/MediaLibrary permission.
- [ ] Run `node --test tests/creatorPremiumB6ScreenProtection.test.mjs` and record RED.
- [ ] Implement the injected pure coordinator and singleton Expo native adapter.
- [ ] Implement the hook using a unique keyed capture claim plus shared app-switcher claim, returning `arming | protected | failed`.
- [ ] Replace only chat's direct app-switcher calls with shared claims; preserve existing keyed capture protection and all chat behavior.
- [ ] Run GREEN and use `rg` to prove no uncoordinated app-switcher disable remains in B6/chat ownership paths.

---

## Task 3: Build Protected Media, Watermark, and Late-Player Barriers

**Files:** Create `services/creatorPremiumProtectedVideoRuntime.mjs` and `.d.mts`, the three `components/premium/*` files, and `tests/creatorPremiumB6ProtectedMedia.test.mjs`.

### Contract

```ts
interface ProtectedVideoCommandController {
  load(source: { uri: string; contentId: string; expiresAt: string }, generation: number): Promise<boolean>;
  play(generation: number): Promise<boolean>;
  pause(): Promise<void>;
  invalidate(reason: string): Promise<void>;
  dispose(): Promise<void>;
}
```

All player commands use one serialized queue and recheck generation/disposed state before and after awaiting native work. Invalidation advances generation immediately, then queues pause plus `replaceAsync(null)`.

### Steps

- [ ] Write RED source-contract tests: image uses `expo-image`, `cachePolicy="none"`, no Live Text/save/share/download/persistence.
- [ ] Write RED video contracts: `useCaching: false`; PiP, external playback/AirPlay, fullscreen/native controls, frame analysis, background playback, and Now Playing disabled; no public-player fallback.
- [ ] Test watermark is always over ready media and contains only a pseudonymous short user marker, session marker, and timestamp—never full email/phone/token/URL/asset/provider ID.
- [ ] Add mandatory deferred-player tests: close or logout during `replaceAsync(source)` leads to queued `replaceAsync(null)` with no play/reveal; old content cannot replace new content; delayed play after background is rejected; dispose clears state and late callbacks cannot mutate it.
- [ ] Test native protection failure leaves both media components without a source and the opaque cover mounted.
- [ ] Run `node --test tests/creatorPremiumB6ProtectedMedia.test.mjs` and record RED.
- [ ] Implement the serialized command controller; route/hook code must not load/play directly.
- [ ] Implement the protected image with ephemeral props, no persistent cache, and cover-before-source/source-before-cleanup ordering.
- [ ] Implement the protected video with HLS source and minimal custom controls; all unloads go through the command controller.
- [ ] Implement the non-interactive watermark from hook-supplied pseudonymous/session data.
- [ ] Run GREEN and scan components/runtime for persistence, private-URL logs, download, or sharing.
- [ ] Self-review teardown order: opaque cover → invalidate generation → pause/unload → clear grant → release screen claims.

---

## Task 4: Orchestrate Lifecycle and Add the Protected Viewer Route

**Files:** Create `hooks/useCreatorPremiumViewer.ts` and `app/creator-premium-viewer/[contentId].tsx`; extend runtime/client tests.

### Hook Contract

```ts
function useCreatorPremiumViewer(contentId: string): {
  snapshot: CreatorPremiumViewerSnapshot;
  protectionState: 'arming' | 'protected' | 'failed';
  refresh(): Promise<void>;
  markPlaying(): void;
  markPaused(): void;
};
```

Explicit states: `loading`, `locked`, `ready`, `playing`, `paused`, `expired`, `revoked`, `restricted`, `error`, and `offline`. User copy never leaks schema/provider/object/token details.

### Steps

- [ ] Write RED tests for all states, including distinct entitlement denial, missing media, and network failure.
- [ ] Test only `contentId` is accepted; the cover remains during protection arming; open/focus/foreground each recheck current session and server entitlement.
- [ ] Test background immediately covers, invalidates, pauses/unloads, and blocks late results; foreground stays covered until fresh entitlement/grant/protection all pass.
- [ ] Test logout/session invalidation, user/content change, and unmount dispose the old generation with exact listener cleanup.
- [ ] With a fake clock, test expired grants are rejected, entitlement is revalidated before renewal, renewal starts about 15 seconds before expiry only while focused, and denial/background cancels it.
- [ ] Run runtime/client suites and record RED.
- [ ] Implement the hook with `AppState`, navigation focus, Supabase auth-state observation, generation invalidation, and bounded timers. Timers only trigger server checks; they never authorize.
- [ ] Implement viewer route: back navigation, opaque cover, safe states/retry, protected image/video, minimal controls, visible protection status, and watermark.
- [ ] Terminal denial/security errors immediately cover, invalidate, and unload; they never invoke an alternate provider.
- [ ] Run GREEN and inspect params, state, logs, and analytics for private URLs or identity-bearing values.

---

## Task 5: Add Consumer Library and Teaser-Only Profile Entry

**Files:** Create `app/my-premium-library.tsx`; modify creator profile, tab profile, root layout, canonical service, and client tests.

### Steps

- [ ] Write RED tests proving creator catalog uses only canonical teaser projection and never requests originals for locked tiles; entitled navigation carries `{ contentId }` only.
- [ ] Test library initial load, bounded/keyset pagination, deduplication, refresh, empty/retry/offline, expired/revoked states, rapid refresh cancellation, and viewer navigation.
- [ ] Test catalog/library never render or store original URLs, object keys, asset IDs, Cloudflare UIDs, permanent playback URLs, or signed grants.
- [ ] Test profile Premium entry routes to `/my-premium-library`, new routes are registered, and no purchase/subscription/ledger action exists. Keep `app/my-subscriptions.tsx` unchanged.
- [ ] Test truthful locked/finance-disabled copy: no operational buy/subscribe CTA or public-release claim.
- [ ] Run `node --test tests/creatorPremiumB6ClientUx.test.mjs` and record RED.
- [ ] Implement library with canonical `fetchMyCreatorPremiumLibrary`, safe cursors, refresh/retry, stale-request invalidation, teardown on logout/unmount, teaser tiles, and content-ID navigation.
- [ ] Use direct canonical `fetchCreatorPremiumCatalog` handling in creator profile so denials/network errors stay truthful; store only a non-authoritative in-memory content-kind hint on entitled open.
- [ ] Route the existing consumer Premium entry to the library without changing creator management or legacy subscription screens.
- [ ] Register the two routes in `app/_layout.tsx` and preserve privacy-safe parameters.
- [ ] Run GREEN; use `rg` to verify original-grant calls appear only in the viewer flow.
- [ ] Review accessibility, safe area, small-screen behavior, states, and Nelyon tokens without a new design system.

---

## Task 6: Complete Security Coverage and Regress B1–B5

**Files:** Modify only the four B6 test suites if coverage evidence requires it.

### Mandatory Coverage Matrix

The suites must jointly prove: no entitlement/minor/absent purchase/absent subscription denied; owner/valid purchase/valid subscription allowed; expired subscription/refund/suspension/block/moderation denied; expired/altered/wrong-content grants denied; profile teaser-only; library pagination without originals; no signed-URL persistence or download/share; logout/account/content churn safe; background hides; foreground revalidates; video stops; PiP/AirPlay/external playback/cache disabled; watermark visible; native protection error fail-closed; Android and iOS native contracts; B1–B5 unchanged; finance disabled; no B6 payment/ledger; and no public-media regression.

The four audit observations require named tests for overlapping iOS protection owners, terminal 401/403/security denial, late player completion after close/session invalidation, and separate static versus physical validation results.

### Steps

- [ ] Map all 34 approved cases from the specification to named tests. Add real assertions for gaps; never use `.skip`, `.todo`, `.only`, broad snapshots, or trivial filename checks.
- [ ] Run all four B6 suites together and record exact totals.

```powershell
node --test tests/creatorPremiumB6ViewerRuntime.test.mjs tests/creatorPremiumB6ScreenProtection.test.mjs tests/creatorPremiumB6ProtectedMedia.test.mjs tests/creatorPremiumB6ClientUx.test.mjs
```

- [ ] Run the canonical pinned B1/B2/B2-C1/B3 regression and record exact totals.

```powershell
npx --yes --package=@aws-sdk/client-s3@3.637.0 --package=@aws-sdk/s3-request-presigner@3.637.0 -c 'node tests/runCreatorPremiumB2C1AwsSdk.mjs tests/creatorPremiumB1CanonicalFoundation.test.mjs tests/creatorPremiumB1ClientHardening.test.mjs tests/creatorPremiumB2PrivateImageMedia.test.mjs tests/creatorPremiumB2EdgeMedia.test.mjs tests/creatorPremiumB2ClientMedia.test.mjs tests/creatorPremiumB2C1NoStoreHardening.test.mjs tests/creatorPremiumB3SignedStreamDatabase.test.mjs tests/creatorPremiumB3EdgeStream.test.mjs tests/creatorPremiumB3SigningCrypto.test.mjs tests/creatorPremiumB3ClientStream.test.mjs'
```

- [ ] Run B4/B4-C1/B5 regressions plus repository-discovered media deletion/security, Stream, auth-session, and chat one-time-media tests. Record actual commands; do not invent a result for a missing suite.

```powershell
node --test tests/creatorPremiumB4AtomicFinance.test.mjs tests/creatorPremiumB4LedgerBinding.test.mjs tests/creatorPremiumB4ClientFinance.test.mjs tests/creatorPremiumB5Management.test.mjs tests/creatorPremiumB5ClientUx.test.mjs tests/creatorPremiumB5VideoCleanup.test.mjs
```

- [ ] Run the global suite in the same dependency tree/environment as the pre-implementation baseline. Compare named failures, not only counts; require zero B6-caused failures.

```powershell
node --test "tests/*.test.mjs"
```

- [ ] Run TypeScript, ESLint on every changed source/test file, and `git diff --check`. Historical errors outside changed files may be reported but cannot hide a B6 diagnostic.
- [ ] Report `STATIC / NATIVE-CONTRACT VALIDATION` separately from `PHYSICAL ANDROID VALIDATION` and `PHYSICAL IOS VALIDATION`.
- [ ] On a real Android device, record device/OS/build and verify screenshots/screen recording are blocked, Recents never exposes protected media, background/foreground revalidation works, video stops on leave, and logout/account change cannot restore a late frame.
- [ ] On a real iOS device, record device/OS/build and verify the app-switcher cover, capture-response behavior supported by the installed Expo SDK, background/foreground revalidation, video teardown, and overlapping chat/viewer protection ownership. State the platform limitation that iOS cannot guarantee absolute screenshot prevention.
- [ ] If either device test was not actually run on hardware, mark it `PENDING`; never infer PASS. Static success alone cannot produce a production-ready verdict.

---

## Task 7: Final Review, Local Commit, Push Gate, and Postcheck

**Files:** All and only the B6 files listed above.

### Steps

- [ ] Inspect status, diff statistics, full diff, and whitespace. Confirm there is no Supabase, package, lockfile, finance, roadmap, deployment, or unrelated UI change.

```powershell
git status --short
git diff --stat
git diff --check
git diff -- app services hooks components tests
```

- [ ] Re-run the B6 suites from the exact staged tree and confirm the four mandatory corrective tests are present and GREEN.
- [ ] Stage only authorized files; run cached diff/check/stat and secret/private-URL/log scans.
- [ ] Create the single functional commit: `git commit -m "feat(premium): add protected consumer viewer"`.
- [ ] Verify committed SHA, clean worktree, and focused tests before considering push.
- [ ] Audit current workflows and the C2 release gate read-only. At minimum run `node --test tests/nelyonProductionReleaseGate.test.mjs` and inspect workflow triggers/environment/deploy commands.
- [ ] If any automatic preview/deploy risk exists or cannot be verified, preserve the local commit and stop before push. If safe, fetch, require the existing remote B5 branch unchanged, and push normally only to it—never `main`, never force.
- [ ] After an authorized push, fetch and verify local/remote SHA equality, divergence, clean worktree, unchanged `origin/main`, stashes, and worktree inventory. New clones/worktrees remain zero.
- [ ] Read-only postcheck: Supabase still has 336 migrations and latest B5 migration; Premium rows/transactions remain zero; policy stays `false / false / false / 0`; no Edge deploy; no BDAG movement.
- [ ] Produce the required report with exact files/tests, static evidence, separate device statuses, baseline, commit/push status, disk space, zero new clones/worktrees, limitations, and one truthful verdict:
  - `B6 IMPLEMENTED — READY FOR CHATGPT AUDIT` only if every requested implementation and real-device validation is complete;
  - `B6 IMPLEMENTED — PHYSICAL VALIDATION PENDING` when code/static tests pass but Android or iOS hardware validation is pending;
  - `STOP — VERIFIED SECURITY BLOCKER` for a proven fail-open or architectural blocker.

---

## Plan Review Gate

Implementation must not begin until the owner/ChatGPT explicitly approves this plan. Review should focus on the five items under **Review Focus**, the mandatory coverage matrix, the no-server-change boundary, and the strict separation between static and physical validation.
