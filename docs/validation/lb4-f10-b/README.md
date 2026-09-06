# LB4-F10-B — relay continuity and terminal cleanup

Base/required direct parent: `0d641081bff8f600461c8f73dde9f2098c3fd266`.
Branch: `codex/lb4-f10-b-relay-continuity`.
Isolated worktree: `C:/Users/andre/ClipDAG-lb4-f10-b`.

## Isolation

Verified the base object and message, and absence of both the target branch
(local and remote) and directory before creating:

```powershell
git worktree add -b codex/lb4-f10-b-relay-continuity C:/Users/andre/ClipDAG-lb4-f10-b 0d641081bff8f600461c8f73dde9f2098c3fd266
npm.cmd ci --legacy-peer-deps
```

The new worktree started clean at the exact base. Dependencies are local;
no node_modules link and no environment file copy. The F10-A checkout was
only inspected: `expo-env.d.ts` remains modified and both user-owned untracked
files remain present. No cleanup, restore, stash or changes in that checkout.
No integration, production action, Supabase CLI, deployment, build, Metro or
physical test was performed.

## Demonstrated causes and audit

1. `LiveBattleRuntimeController.applyCompletedBattle()` renews credentials once
   per completed Battle/version/deadline to cover the post-round window.
   `LiveBattleRelayService.transition()` previously always invoked the native
   update after authorizing the next logical Battle, even for an identical route.
2. Local, unchanged `battleRelayAuthorization.ts` computes the token horizon from
   the canonical deadline plus 15 seconds (maximum 360 seconds). For completed
   rounds the deadline is the rematch window, capped by a pending request's
   deadline. A 30-second window can therefore produce only 45 seconds of token
   lifetime; it cannot cover the next countdown plus 300-second round. These two
   updates are sometimes both necessary. Route equality alone is insufficient.
3. The existing Agora hook's `onUserOffline` immediately filtered `remoteUids`.
   Both screen renderers gate the rival `RtcSurfaceView` on membership in that
   array. The reported `state=1 → offline(0) → state=2 → joined` sequence thus
   removed the surface even while the main engine and channels remained stable.
4. `isLiveBattleStageStatus` previously accepted every completed/cancelled Battle
   without consulting its series. Thus relay `stop_terminal` and Stage visibility
   disagreed. The F10-A projection-refresh effect watched only Battle id/version/
   status, missing a series-only terminal change on the same completed Battle.

Agora's official native API contract distinguishes native method success from
the asynchronous running callback:
https://agoraio-extensions.github.io/react-native-agora/classes/IRtcEngine.html#startOrUpdateChannelMediaRelay
https://agoraio-extensions.github.io/react-native-agora/enums/ChannelMediaRelayState.html

## Implemented policy

The existing native service retains a token-free identity containing App ID,
canonical source/destination session/channel/UID, the conservative authorization
request timestamp, expiry, and a separate native-running flag. Logical Battle ID
remains separate. No token comparison, logging or second transport/store exists.

Every new logical transition still obtains fresh server authorization. Reuse
requires exactly the same identity, native running, connected engine, and:

```text
cached_expiry >= monotonic_now + fresh_authorized_expiresIn + 10 seconds
cached_expiry = authorization_request_start + expiresIn - 1 second
```

The subtraction covers whole-second server rounding; starting at request time
is conservative for request latency. The named 10-second margin supplements the
server's horizon, which already covers the authorized operation. Reuse never
extends cached expiry. Reconnect, failure, stop, disposal or route/pair change
invalidates reuse. A reused transition adopts the new Battle ID and running
snapshot, replaces the sole relay handler safely, and emits `transition_reused`
with abbreviated identifiers. A sufficient renewal can serve the next transition;
a short post-round token still requires a native update.

For necessary updates from an actually running relay, the owning runtime sends
a narrow signal to the existing Agora hook for the public authority's expected
incoming rival UID. This is deliberately not the outgoing relay destination UID,
which identifies the local sender in the rival channel. The existing hook alone
continues to own `remoteUids`.

`REMOTE_VIDEO_TRANSITION_GRACE_MS = 1500` bounds retention to the observed subsecond
interruption plus 500 ms of scheduling tolerance. Only reason zero for that UID
during an authorized reconfiguration is delayed. A same-UID join cancels removal;
expiry removes an absent peer. Duplicate signals cannot extend the window.
Other UIDs/reasons remain immediate. Identity and join-generation guards reject
obsolete timers and connection/UID callbacks. Stop overrides grace immediately.
Engine release, session change, unmount and disposal clean up timers/listeners.

Both screens now pass the complete projection to the same visibility predicate.
Canonical series completion/cancellation and rejected/expired/cancelled rematch
requests hide the Stage. Awaiting/pending rematch remains visible until canonical
authority changes, even if the local clock reaches zero. The status-only overload
remains compatible with existing callers; all screen gates use full authority.
The runtime snapshot carries a projection/series decision key and the existing
public reconciliation effect observes it and runtime status. No new subscription
or local competitive/terminal state is introduced. The existing version reducer
rejects stale projections. The unchanged terminal render branch returns the normal
LIVE surface without leaveChannel, navigation, streamId or live_sessions changes.

## Tests and evidence

`red.tap` was captured before production edits by running:

```powershell
node --test --test-reporter=tap tests/liveBattlesLb4F10BRelayContinuity.test.mjs
```

Real red: 3 tests, 0 passed, 3 failed, 0 skipped/cancelled/todo. Assertions observed
terminal visibility `true` instead of `false`, UID list `[]` instead of `[42]`, and
2 native calls instead of 1 for a sufficiently authorized same-route transition.
The PowerShell capture preserves the original output in UTF-16LE.

The final focal test executes the production relay, full Agora hook with a fake
engine/React scheduler/clock, runtime controller, runtime hook, visibility reducer,
actual screen gate/render expressions, and existing rematch single-flight/gate.
No production algorithm is reimplemented in the test. An intermediate test fixture
lacked `maxRounds`; that new fixture was corrected to the real series contract.
No historical test was changed, removed, skipped or weakened.

Run all validation from this worktree:

```powershell
node docs/validation/lb4-f10-b/regression.mjs
```

`suites.json` contains exact commands/file selections/counts; individual TAP files
contain full output. Groups intentionally overlap. `typescript-comparison.json`
compares the committed F10-A baseline, normalizing only absolute worktree prefixes
and line endings. TypeScript is **not clean**: 237 historical diagnostics,
0 added, 0 removed, exact normalized output equality, compiler exit 2.
`protected-lf-hashes.json` verifies all 213 protected files against the exact base:
211 migrations, package.json and package-lock.json. F10-A evidence is unchanged.

Protected commission hash:
`63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`

Protected F9 scoring hash:
`f13de76bb393f7c6e0784badffe9f33c11d7093e689b1dda9e1f4f4d5037a160`

## Ownership and duplicate audit

`rg` confirms one native `remoteUids` useState owner in `useAgoraEngine.native.ts`;
all mutations remain there. One native runtime hook creates one controller and
one relay service per engine. The service retains its single registered relay
handler, now also invalidating credential reuse on connection changes; it does
not register a competing UID listener. The three existing SDK entry points
(start/transition/refresh) remain in that same queued service. The engine hook's
existing listener owns joined/offline handling. There is at most one grace timer.
New callback refs remain owned by the effect and are disabled before async
controller teardown, so an obsolete service cannot clear a newer engine's UID.
The `.ts` implementations remain non-native no-op fallbacks. All new fields,
callbacks/constants have consumers; no unrelated code removal or cleanup occurred.

## Physical verification still required

Repeat with two iPhone after review, without claiming physical success here:

1. Keep both original LIVE channels and joinKey unchanged; verify one initial
   relay start and running result.
2. Complete a round, request/accept rematch. Observe `refresh`/`update` when token
   coverage requires them, or `transition_reused` for sufficiently valid same-route
   credentials. During offline reason zero followed by joined within 1.5 seconds,
   confirm the rival surface remains mounted and visually stable.
3. Let window and pending request expire independently. After canonical terminal
   authority, verify one native stop, no split Stage/result/rematch/placeholder,
   and continuing local LIVE video, without leave/join or engine recreation.
4. Disconnect the rival for longer than 1.5 seconds to confirm the bounded fallback.
   A native SDK can still affect rendered pixels while a surface remains mounted;
   frame-level continuity must be verified on devices before integration.
