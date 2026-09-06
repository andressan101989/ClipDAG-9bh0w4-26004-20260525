# LB4-F9-B — spectator icon-first controls and gift-sheet lifecycle

Base/direct parent: `b3bde1c1b92f749515bc4c142949abb12c361df9`.
Branch: `codex/lb4-f9-b-spectator-icon-gifts`.
Worktree: `C:/Users/andre/ClipDAG-lb4-f9-b` (outside the main checkout).
Commit message: `fix: simplify spectator gift controls`.

## Audit and change

The Battle bottom bar had its own gift Pressable with visible `Regalos` text,
minimum width 116px and a purple pill style. Its rail rendered tiny Text labels
under favorite/share/more icons. Normal LIVE already used the canonical
`LiveGiftButton`, a 46x46 circular card-giftcard control with pressed/disabled
styles. The canonical component lacked the requested accessibility hint and
explicit disabled accessibility state.

Battle now reuses `LiveGiftButton` directly, passing onOpenGifts and giftsDisabled.
No duplicate component was created. The canonical button retains its appearance
and adds the hint and accessibility state. The rail keeps favorite, ios-share,
more-horiz, existing handlers, pressed state and 48x48 targets, but removes
visible redundant labels and their unused styles. Labels remain available to
accessibility. Header, host name, LIVE indicator, viewer count, chat, gift
categories/names/prices, balance, send action and errors remain unchanged.

`sendRealGift` already closed the selector only after successful
`sendLiveGiftForContext`, updated returned balance, cleared the pending attempt,
showed feedback and reconciled Battle. That path was retained. Failure already
kept the sheet open and the ambiguous idempotency key. The synchronous
`sendingGiftRef` already prevented double sends. LiveGiftSheet already handled
X/backdrop/Android back, disabled cards/send and spinners, and reset selection
after closure. Those files/behaviors were protected by tests, not rewritten.

The audit did find one genuine lifecycle gap: a network response after screen
unmount could update balance/feedback/spinner and trigger reconciliation.
Four localized guards now use the existing mountedRef: reject a stale callback,
return after await if unmounted, guard catch feedback and guard the finally
state setter. The synchronous sending ref is always released. Existing key,
fingerprint, RPC selection and success behavior are unchanged.

Gift animations remain server-event-driven: the existing reaction subscription
parses confirmed gift events, feeds enqueueGift/useLiveGiftAnimations and renders
the single LiveGiftOverlay/LiveGiftPresentationLayer. No optimistic animation,
second transfer or second presentation route was added. Existing F7-A/F6-B tests
also exercise production-shaped gift events and deduplication.

## Files and justified test adjustments

Runtime files:

- `components/live/LiveBattleViewerChrome.tsx`: canonical button reuse and
  deletion of redundant rail text/unused styles.
- `components/live/gifts/LiveGiftButton.tsx`: accessibility hint and state only.
- `app/live/watch/[streamId].tsx`: four mountedRef guards only.

New focal: `tests/liveBattlesLb4F9BSpectatorControls.test.mjs`.

Two existing tests required narrowly justified updates, announced before edits:

- `liveBattlesLb4F7BViewerUi.test.mjs`: replace the obsolete requirement for
  a `Regalos` source label with an assertion that the canonical gift component
  receives the existing handler and disabled state. New rendered-tree tests
  exercise accessible labels, icon-only appearance, handlers and states.
- `liveBattlesLb4F8BPhysicalUxFixes.test.mjs`: add mountedRef=true to its screen
  callback mock. No routing, error, single-flight or economy assertion changed.

Other additions are this phase's validation evidence. Exact list: `files.json`.
LiveGiftSheet, LiveGiftOverlay, services, hooks, catalog, RPC and migrations are
unchanged. No dependency or manifest changes.

## Red before implementation

Command:

```powershell
node --test --test-reporter=tap tests/liveBattlesLb4F9BSpectatorControls.test.mjs
```

Against the required base, **23 tests: 16 pass / 7 fail / 0 skipped / 0 cancelled
/ 0 todo** (`red.tap`). Real failures:

1. Visible Battle `Regalos` text.
2. Redundant visible rail labels.
3. Battle button lacks compact circular canonical dimensions.
4. Normal LIVE accessibility hint/state missing.
5. Battle does not satisfy icon-only/accessibility contract.
6. Successful response after unmount updates UI/reconciles.
7. Exception after unmount updates feedback/spinner.

The success/error/modal/single-flight/retry tests already passed on the base;
they are protection of existing behavior, not claimed as fixed defects.
`red-initial-harness.tap` preserves an earlier harness run that incorrectly
looked for a hook named useLiveGiftEvents. The actual hook is
useLiveGiftAnimations; that assertion was corrected before recording the
definitive red run, and is not counted as a product defect. Two additional
green tests cover manual-close-in-flight and a stale callback after unmount.

## Final validation

The 25-test focal executes actual transpiled components/handlers with
deterministic native primitive and network stubs. It checks rendered text,
accessibility, dimensions, pressed/disabled styles, actual open handlers,
deferred authoritative success, safe failures, duplicate taps, stable ambiguous
keys, two complete cycles with distinct keys, mounted lifecycle, actual sheet
selection/send/close handlers and spinner/disabled state. No physical-device
or screenshot claim is made.

| Suite | Passed |
|---|---:|
| F9-B | 25/25 |
| Spectator UI | 24/24 |
| LIVE/Battle gifts | 41/41 |
| F9-A-C1 | 12/12 |
| F9-A | 18/18 |
| F8-A/C1/F8-B | 29/29 |
| Reactions | 14/14 |
| Runtime/rematch | 91/91 |
| Live Battles | 471/471 |
| Finance/wallet/ledger/gifts | 98/98 |
| Global canonical Node | 1613/1613 |

All have zero failures, skips, cancellations and todo. Battles/global increase
by the 25 new tests; finance retains 98. Existing test counts were not reduced.

Reproduce with `node docs/validation/lb4-f9-b/regression.mjs` from this worktree.
It runs the canonical `node --test --test-reporter=tap` on enumerated
`tests/*.test.mjs`, then `npx.cmd tsc --noEmit --pretty false` and LF hashes.
Each exact suite selection is recorded in `suites.json`. The script writes only
this phase's evidence, so integration validation should redirect evidence to a
temporary directory instead of rewriting committed logs.

TypeScript: **237 historical / 0 added / 0 removed**, exit 2. Full output is
compared against the immediate F9-A/C1 baseline, normalizing only absolute
worktree prefixes and LF. No line numbers or diagnostic text are removed.
TypeScript remains historically non-clean. See `typescript-comparison.json`.

`git diff --check` passes. All **213 protected files** remain LF-identical to
the base: **211 migrations**, package.json and package-lock.json. Individual
hashes are in `protected-lf-hashes.json`.

- F8-A/C1: `63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`.
- F9-A/C1: `f13de76bb393f7c6e0784badffe9f33c11d7093e689b1dda9e1f4f4d5037a160`.

## Isolation

Fetched all references with prune. Integration HEAD/upstream/origin/ls-remote
matched b3bde1c before editing and integration was clean. The first sandboxed
ls-remote connection failed; the explicit network-enabled retry confirmed the
base before any source edits. All work stayed in the isolated F9-B checkout.

The main checkout's four modified UI files, `.worktrees/`, and untracked
`tests/liveBattlesLb4Ui1FigmaStage.test.mjs` were not touched. Integration
remains b3bde1c. No integration, Supabase command/change, SQL, production RPC,
deployment, build, Metro, physical test, secret, Agora or Media Relay change.
