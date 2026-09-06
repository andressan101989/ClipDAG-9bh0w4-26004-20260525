# LB4-F10-C — physical continuity and terminal Stage cleanup

Base/parent: `fdee4a8dd7eb34af8632c3e8885f1d9a1d431917`. Isolated branch `codex/lb4-f10-c-physical-continuity`, worktree `C:/Users/andre/ClipDAG-lb4-f10-c`.

## Audit and causes

F10-B's relay bridge does connect `onReconfigure` to the engine's `beginRemoteVideoTransition`. However that signal describes the LOCAL OUTGOING SDK operation. The visible opponent is the INCOMING relay from the other host. The peer's offline/join can arrive after our local grace ends or without our own update. Watchers have no outgoing relay bridge at all. Extending the outgoing timer would not correct that ownership mismatch.

The real owner of the rendered UID array remains `useAgoraEngine.native.ts` (`remoteUids`). Both screen render expressions test that array against `battleState.opponentHostAgoraUid` before creating the remote `RtcSurfaceView`. The new explicit incoming authority uses that same projected numeric UID, scoped by LIVE session and Battle. It is passed to the existing engine hook, not another store. A matching incoming reason=0 offline now arms the existing bounded transition when the local outgoing signal did not cover it. Rejoin cancels removal without changing the UID array. No surface key or native canvas replacement was introduced.

The grace remains 1,500 ms: the observed interruption is below one second, leaving 500 ms scheduling tolerance. Real absence removes the UID at expiry; other UID/reasons are immediate. Duplicate events cannot extend a window. A canonical new round clears the old generation while preserving the same peer and a pending removal deadline; peer/session/terminal changes clear retention. Engine lifecycle cleanup remains the existing owner. Incoming authority does not prove which remote SDK operation emitted an offline, so this bounded tolerance also applies to a genuine reason=0 departure by that canonical peer; it cannot hide it permanently.

Token authorization, expiry, refresh and reuse policy are unchanged. No token is compared for visual identity, and no refresh is suppressed to obtain continuity. F10-B's conservative transport update can still run.

For terminal cleanup, the runtime already validated server authority and chose stop_terminal, but only stopped transport. Stage visibility consumed a public projection which could still say awaiting_rematch. The controller now sends its validated terminal Battle ID through the existing native hook bridge before awaiting relay stop. The public UI hook records suppression for exactly that ID, and the existing shared visibility predicate applies it to host and watcher. Stale/null projections and subscription toggles cannot resurrect that ID. A new canonical countdown/active Battle can clear it. No transport/read failure fabricates terminal authority.

Watchers use the existing Stage clock to request the existing subscription's reconciliation at the public decision horizon. The estimated clock only requests a read: the fresh server timestamp (subtracting the clock anchor's half-RTT visual compensation) and canonical expiry confirm closure. There is no added timeout, interval, subscription, relay, or server mutation. The earlier of request/window deadlines wins. Host scheduling remains owned by the runtime.

## Red and regression validation

The pre-production-edit red run against the base production code produced 2 tests, 0 pass and 2 fail. The failures demonstrated (1) the incoming offline removing UID 42 without a coincident outgoing update, and (2) Stage still visible when validated terminal stop begins against an awaiting_rematch projection.

The focal tests execute actual engine/runtime/public hooks, the actual screen JSX and Stage, with deterministic clocks and SDK boundaries. They cover incoming sequences, bounded expiry, peer/round changes, cleanup, both render paths, server-confirmed terminal suppression, stale callbacks, and five consecutive rematches. They establish the JS surface-selection contract; they cannot prove iOS native pixels.

An intermediate regression caught a newly added spectator timeout and transport-policy import violating the existing architecture tests. Both were removed; the implementation instead uses the Stage's existing clock and a neutral projection deadline helper. No historical tests were changed or weakened.

Run from this worktree:

```cmd
node docs/validation/lb4-f10-c/regression.mjs
```

The runner records exact selected files, counts, exit statuses, complete TAP, TypeScript diagnostics, comparison data and dynamically calculated hashes in a temporary directory below the operating system temp path. It removes that directory in `finally`, including after a failed assertion, so a run does not create evidence files in the worktree. It runs the canonical global `.test.mjs` suite, TypeScript, exact normalized diagnostic comparison against F10-B's tracked baseline, all 213 protected LF hashes calculated from the base commit, and diff check. TypeScript must retain 237 historical diagnostics with no additions or removals and exact normalized output equality; it is not clean.

## Ownership and scope audit

`rg` confirms one native `remoteUids` state owner and one native relay service. Its initial/update/refresh SDK call sites are three operations of that existing service, not separate transports. Existing Agora event handler and relay-specific handler remain registered/unregistered by their owners. No new Agora handler, controller, subscription or recurring timer was added. `.ts` fallbacks only accept matching optional interfaces. The 211 migrations, packages, economic files and F10-A/B evidence are untouched. F10-A user files and F10-B's local expo-env change remain outside this worktree.

## Physical validation required before integration

No build is required by these JavaScript/TypeScript-only changes. Use the existing correct development build on both iPhones; do not interpret automated success as physical acceptance.

```cmd
cd /d C:\Users\andre\ClipDAG-lb4-f10-c
git branch --show-current
git rev-parse HEAD
git status --short
npx expo start --dev-client --clear
```

Connect both devices to this Metro instance using the existing project environment. No environment file was copied by this task. Observe development-only `[LIVE-BATTLE-VIDEO] transition_begin`, `offline_deferred`, `transition_join_cancel`, `transition_expired`, `transition_clear`, alongside existing relay and Agora logs. Check the numeric UID in `offline_deferred` matches incoming `onUserOffline`/`onUserJoined`; scope is abbreviated and no token is logged. `incoming_peer` identifies the path missed by F10-B. A terminal `LIVE-BATTLE-SERIES terminal` validated_authority event must suppress Stage before transport cleanup, even before later Realtime series completion.

Repeat end-of-round, accepted rematch, several consecutive rematches, expiry, automatic normal LIVE return, and a real peer departure. Verify no Conectando during an authorized short transition, no split Stage after terminal authority, and uninterrupted local camera/audio/session. If a native canvas stays mounted but its pixels black out, capture that separately from placeholder/remount; this task introduces no frozen frames or native changes. Integration remains pending this two-device test.

## Final suite results

| Suite | Passed | Failed / skipped / cancelled / todo |
| --- | ---: | --- |
| f10-c | 26/26 | 0 / 0 / 0 / 0 |
| f10-b | 42/42 | 0 / 0 / 0 / 0 |
| f10-a | 25/25 | 0 / 0 / 0 / 0 |
| media-relay | 89/89 | 0 / 0 / 0 / 0 |
| host-ui | 69/69 | 0 / 0 / 0 / 0 |
| realtime | 51/51 | 0 / 0 / 0 / 0 |
| agora-auth | 2/2 | 0 / 0 / 0 / 0 |
| f9-b | 25/25 | 0 / 0 / 0 / 0 |
| viewer-ui | 24/24 | 0 / 0 / 0 / 0 |
| gifts | 41/41 | 0 / 0 / 0 / 0 |
| c1 | 12/12 | 0 / 0 / 0 / 0 |
| f9-a | 18/18 | 0 / 0 / 0 / 0 |
| f8 | 29/29 | 0 / 0 / 0 / 0 |
| reactions | 14/14 | 0 / 0 / 0 / 0 |
| runtime | 116/116 | 0 / 0 / 0 / 0 |
| battles | 564/564 | 0 / 0 / 0 / 0 |
| finance | 98/98 | 0 / 0 / 0 / 0 |
| global | 1706/1706 | 0 / 0 / 0 / 0 |

Final TypeScript: exit 2 (historical debt), 237 baseline / 237 current, 0 added, 0 removed, exact normalized output match. No historical diagnostics were edited. Protected files: 213/213 (211 migrations plus package.json and package-lock.json); F8-A/C1 LF SHA-256 `63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`; F9-A/C1 `f13de76bb393f7c6e0784badffe9f33c11d7093e689b1dda9e1f4f4d5037a160`. `git diff --check` passed.
