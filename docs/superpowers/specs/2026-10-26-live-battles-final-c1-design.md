# LIVE Battles Final C1 design

## Goal

Close only the defects demonstrated by `LIVE-BATTLES-FINAL-AUDIT-R1`: terminal Battle lifecycle gaps, the completion/invite lock-order race, LIVE gift admission races and retained-receipt integrity, strict winner parsing, server-anchored timer presentation, and safe pair-busy errors. Banuba, Agora, Media Relay, Wallet, and the ledger remain unchanged.

## Canonical authorities retained

- Battle state: `public.live_battles`, `private.live_battle_transition`, and the existing reconciliation functions.
- Series state: `private.rebuild_live_battle_series_locked`, `private.reconcile_live_battle_series_locked`, and the existing cron entry point `private.reconcile_due_live_battle_series`.
- Gifts: `public.send_live_gift`, `public.send_live_battle_gift`, `public.atomic_ledger_transfer`, `private.verify_live_gift_journal`, and `private.record_live_battle_score_locked`.
- Presentation: the existing public projection, `LiveBattleSpectatorService` clock anchor, and the current React Native components.

No second reconciler, timer, financial authority, gift pipeline, Agora engine, or relay manager is introduced.

## Lifecycle and lock protocol

`private.rebuild_live_battle_series_locked` keeps its non-blocking `FOR UPDATE SKIP LOCKED` behavior because rematch flows already use series-before-battle locking. Durable recovery is added instead of converting that function into a blocking lock.

The invite path is reordered to use the established lock order:

1. participants ordered by UUID;
2. sessions ordered by UUID;
3. an existing open Battle, reconciled under row lock;
4. an open series, reconciled under row lock.

This prevents invite from holding a series while waiting for a Battle that completion already holds. Terminal `rejected` and `expired` Battle transitions rebuild the series immediately. The existing series sweep is expanded to include an `active` series with terminal children and no open Battle. A skipped rebuild therefore remains eligible for the next cron pass.

The release migration revalidates the one production-shaped orphan using predicates, not a hard-coded ID. It stops if the repair scope is no longer exactly one row or if unresolved gift finance exists, then calls only the canonical series reconciler.

## Gift admission and historical integrity

Normal LIVE gifts lock the target session with `FOR SHARE`; new admissions require `status='live'` and `ended_at IS NULL`. Directed Battle gifts pre-read immutable route identity, take ordered participant/session locks, then lock and re-read the Battle. Eligibility and deadline are evaluated after every potentially blocking lock. Idempotent replay is preserved even after later session closure or catalog disablement.

Both normal and Battle admission require `gift_catalog.active=true AND enabled=true`. Confirmed `live_gift_transactions` become immutable through a private, non-callable trigger, and their user/session foreign keys are changed from cascade deletion to retained-history restrictions. Gifts are final economic facts: ending or cancelling LIVE/Battle state never reverses a confirmed gift. A future reversal would require a separately authorized compensating ledger contract.

The existing 35% LIVE platform split, single debit, creator credit, optional platform credit, score receipt, and replay keys remain unchanged. No speculative ledger expression index is added without plan evidence.

## Winner, timer, and domain errors

The score-state and public-projection winner must exactly match the side named by `outcome`; the existing series champion constraint remains authoritative. The client parser mirrors this rule on either local side.

`LiveBattleHostControls` consumes the existing server clock anchor and monotonic estimator. It never falls back to `Date.now()` and displays an unknown clock until an anchor is available.

Pair-busy admission raises PostgREST `PT409` while retaining the stable domain message. The client recognizes both historical pair-busy messages and renders the existing safe state-changed copy.

## Testing and release

Tests are written RED before implementation, then run unchanged GREEN. PostgreSQL proofs use a disposable database and rollback/synthetic data only. Local multi-connection tests cover both lock winners and delayed durable reconciliation. Existing Agora/Relay/Spectator tests are regression-only; they do not constitute physical QA.

The productive manifest must contain one new SQL migration, no Edge deployment, no Finance/P3/MEDIA-C1 change, and risk HIGH. Release follows plan-only, gate-proof, backup, snapshots, release, postcheck, a separate baseline PR, and a final `NO PRODUCTIVE CHANGES` plan. Physical QA remains a separate three-device activity.
