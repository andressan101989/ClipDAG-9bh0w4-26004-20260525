# LB4-F10-A — runtime, relay and post-round lifecycle

Base/direct parent: `cc5ac4766d0a6ba4f9a60f738ea3b7fa2ebe537a`.
Branch: `codex/lb4-f10-a-battle-runtime-lifecycle`.
Commit message: `fix: restore battle relay and post-round lifecycle`.

## What changed

The audit preceding edits is in [AUDIT.md](AUDIT.md). Public projection changes
now wake canonical host reconciliation when the runtime is empty, suspended or
behind the projected lifecycle. A completed projection's Battle ID is reconciled
through the existing host RPC when open discovery returns no rows. Public fields
never replace the private Battle response. Obsolete subscription callbacks are
invalidated when the subscription is replaced or disposed.

The native hook reapplies authority when the engine becomes available or context
recovers, even if the projection object's identity is unchanged. Conversely, a
confirmed lifecycle change in the host runtime refreshes the existing public
snapshot used by Stage. This avoids depending on another successful Realtime
delivery to show the final result. No new authority, subscription or timer was
added. The redundant release immediately before controller.dispose was removed;
dispose already releases synchronously before its asynchronous teardown.

The host's existing LIVE poll now distinguishes a failed read from confirmed
non-live authority. Failed reads do not clear eligibility and unmount the public
projection. Responses from an obsolete polling generation, including late avatar
reads, cannot change the current screen. A successful read confirming ended,
wrong-host or missing sessions still fails closed. No session is reassigned.

Development-only runtime diagnostics report controller instance, abbreviated
session/Battle IDs, versions, all eligibility fields, reconciliation and disposal.
Relay diagnostics now distinguish invocation, authorization, listener/SDK start
and failure. Existing relay/series diagnostic defaults are development-gated.

## Exact runtime files

- `app/live/broadcast/[streamId].tsx`: public refresh callback and guarded existing poll.
- `hooks/live/useLiveBattleRelayRuntime.native.ts`: authority delivery and lifecycle refresh.
- `hooks/live/useLiveBattleRelayRuntime.ts`: compatible optional callback type only.
- `hooks/live/useLiveBattleSpectatorState.ts`: development diagnostics only.
- `services/liveBattleRuntimeController.ts`: bridge, rehydration, stale-subscription guard and diagnostics.
- `services/liveBattleRelayService.native.ts`: diagnostics only; transport algorithm unchanged.

One focal test file and this phase's evidence were added. No existing tests were
edited. Stage, viewer, Agora engine, rematch actions, relay contract/policy, RPC,
gifts, likes, economy, native dependencies and migrations remain unchanged.

## Real red evidence

`red.tap`: 18 tests, 9 pass / 9 fail, zero skipped/cancelled/todo, executed before
runtime edits. Failures cover missing public wakeup, completed rehydration,
pending-to-active bridge, suspended recovery, stale subscription, projection
before engine, context recovery, failed poll and obsolete poll response.

`red-ui-bridge.tap`: additional single failing behavior test before adding the
host-runtime-to-public refresh callback. A confirmed completed round did not
refresh the public screen when a second Realtime delivery was absent.

Existing rematch/single-flight/pair/holding behavior already passed. It is not
represented as newly broken. Six additional final tests exercise actual Stage
rendering, placeholder, clock, rematch touch ancestry, viewer controls, cleanup
and safe development diagnostics. A new test's initial `00:00` expectation was
corrected to the existing display contract `0:00`; no product clock change.
The intermediate Media-F1 failure came from the word `score` in a new explanatory
comment; the comment was reworded and the historical assertion was retained.

## Final validation

Command: `node docs/validation/lb4-f10-a/regression.mjs`.
Exact selections, command arguments and counts: `suites.json`; outputs: `*.tap`.
The global command is the repository's canonical Node suite of `.test.mjs` files.

| Suite | Passed |
|---|---:|
| F10-A | 25/25 |
| Media Relay / post-round | 47/47 |
| Host UI / invitation / rematch controls | 69/69 |
| Realtime / projection | 51/51 |
| Agora / token authorization | 2/2 |
| F9-B | 25/25 |
| Spectator UI | 24/24 |
| LIVE/Battle gifts | 41/41 |
| F9-A/C1 | 12/12 |
| F9-A | 18/18 |
| F8-A/C1/F8-B | 29/29 |
| Reactions | 14/14 |
| Runtime / series / rematch | 116/116 |
| Live Battles | 496/496 |
| Finance / wallet / ledger / gifts | 98/98 |
| Global | 1638/1638 |

Every suite has zero failed, skipped, cancelled and todo tests. Battles/global
grew by exactly 25; no historical count was reduced. F10-A hook/effect tests and
Stage tests run transpiled production code with deterministic native/network
stubs, not a physical device or a running Metro server.

TypeScript (`npx.cmd tsc --noEmit --pretty false`) exits 2 with **237 historical,
0 added, 0 removed**. Full output matches F9-B exactly after LF and absolute
worktree-prefix normalization only. See `typescript-comparison.json`. It is not
a clean TypeScript baseline.

`git diff --check` passes. All 213 protected LF hashes match the base: 211 SQL
migrations plus package.json and package-lock.json. Individual hashes are in
`protected-lf-hashes.json`.

- F8-A/C1: `63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`.
- F9-A/C1: `f13de76bb393f7c6e0784badffe9f33c11d7093e689b1dda9e1f4f4d5037a160`.

## Next physical review — instructions only, not executed

After review/authorization, serve the **F10-A worktree**, not the main checkout:

```powershell
cd C:\Users\andre\ClipDAG-lb4-f10-a
git branch --show-current
git show -s --format="%H %P %s" HEAD
npx.cmd expo start --dev-client --clear
```

Open that Metro project on the two development clients. This phase changes only
TypeScript/JavaScript; no native dependency changes or new EAS build were made.
Keep the main checkout's user edits separate. Record branch/SHA and Metro working
directory with the sanitized log capture.

1. Start each LIVE once. Record only the channel suffix and UID. Invitation,
   acceptance and rematch must not change either original channel suffix.
2. Each host should show one `[LIVE-BATTLE-RUNTIME] controller_created`, then
   `context` / `eligibility_changed`: validSession, validHost, canonicalHost,
   sessionLive, opponentSessionLive, engineReady, joined and foreground true,
   suspended false, eligible true. Normal clock updates must not recreate it.
3. Observe `public_authority` with Battle/session suffixes and version, then
   `reconcile_start`, `authoritative_battle` with the same canonical pair and
   `relay_start_requested`. A private Realtime signal produces `realtime_signal`.
4. Native relay sequence: `start_requested` **before** requesting credentials,
   `authorized`, `start` (source/destination route), `start_result` = 0,
   `state` (Agora running/code 0), then existing `[AGORA-DEBUG] onUserJoined` for
   the other host. Both surfaces should render. Until then Stage stays split
   with the remote placeholder.
5. If only `start_requested` appears, inspect the following `start_failed` state:
   no `authorized` means authorization failed; `authorized` without `start`
   isolates the listener stage. No runtime relay_start_requested means inspect
   the preceding eligibility/context/reconciliation events. Do not log tokens.
6. At server deadline expect `authoritative_battle` completed, `reconcile_result`,
   `post_round` holding_for_rematch and `rematch_available` available=true for
   both eligible hosts during the existing window. Viewers see the result only.
   Both individual LIVE channels must remain joined.
7. Tap REVANCHA twice rapidly: one series request_start/request_result, visible
   pending state. Accept on the other host: one transition to the next round,
   original session pair, relay update/transition through the existing service.
8. Repeat with reject and with window expiry. Server terminal authority closes
   the Battle presentation and relay; each LIVE continues. Test background/
   foreground, reconnect and exit: disposal/stop should correspond to real
   lifecycle changes, no repeated controller creation from clock updates and
   no logs/work from a disposed instance after late responses.

## Physical attribution limits

The 524 raw records and Metro checkout path were not provided during this work.
The missing old `start` log alone cannot establish start() was never invoked,
because it occurred after authorization/listener installation. No code path was
found that creates or switches LIVE sessions on Battle acceptance/rematch.
Therefore the specific 76b2a650 -> 4db8d39a change remains unproven, not silently
"fixed" by reassigning a Battle. The reproducible runtime/projection defects are
fixed and covered; success on two iPhones still requires the above review.

No integration, production SQL/RPC, Supabase change/deployment, EAS build, Metro,
physical test, secrets change or user-file cleanup occurred in F10-A.
