# LB4-F9-A pre-implementation audit

Base: b7c55571628c8af2ac2c846a8f7a1e5f16bd566d. Integration local/upstream/origin/ls-remote match; divergence 0/0. Worktree: C:/Users/andre/ClipDAG-lb4-f9-a, outside the user's checkout. Supabase CLI 2.116.0; top-level and migration/new help inspected. No production queries.

## Existing reaction authority

Both app/live/watch/[streamId].tsx and app/live/broadcast/[streamId].tsx call sendReaction -> services/liveSessionService.ts emitLiveReaction -> public.live_emit_reaction(uuid,text). Watch includes ordinary viewers, Battle viewers and promoted/structured cohosts. Broadcast hosts can react. The callback throttles at 600ms, waits for the RPC, remembers the event ID and adds a floating reaction. Existing clients remain supported without changing this signature.

The LB1 migration 20260823223420 defines the RPC returning live_control_events, owned by postgres, SECURITY DEFINER, search_path='', authenticated execution only. It checks auth.uid(), exact heart emoji, a live session and host/active participant membership. It takes a session/actor advisory transaction lock and limits reactions to eight per five seconds. It inserts an event_type='reaction' control event containing emoji and display username. The control event is ephemeral visual transport, also used for participant controls; it has neither Battle attribution nor competitive idempotency. It cannot safely serve as the durable score journal.

## Competitive authority

F4B defines live_battle_score_events: gift_transaction_id NOT NULL UNIQUE with a restrictive FK, positive/nonnegative integer score contract, immutable journal trigger, RLS and no client grants. Weakening this gift relationship would invalidate historical reconciliation. F4B score_states holds one canonical total/outcome/version per Battle, enforces nonnegative totals and winner consistency; public_states has two session-oriented projections with monotonic projection_version. Existing Realtime subscriptions consume these projections. No second scoreboard or publication is needed.

F4D-A defines immutable rule_sets and the singleton current_rule_set pointer. Versions 1 and 2 are the only versions inserted in repository history. live_battles.battle_rule_set_id defaults to that pointer and cannot change. Version 2 specifies rose 10 units/x2/30 seconds/one activation and glove x3/15 seconds/one use. Each Battle binds challenger_user_id/opponent_user_id and challenger_session_id/opponent_session_id. Sessions provide canonical host_id/status; active participant membership supplies viewer authority.

record_live_battle_score_locked locks the Battle, validates the confirmed gift, resolves an immutable boost, inserts one gift score event, updates score_states and both public projections, then advances the rose mission once. live_battle_score_event_contract_is_valid currently requires base_points = gift.amount_coins and awarded_points = base_points * multiplier. resolve_live_battle_effective_boost_locked resolves x1/x2/x3 using the existing side/window/exclusivity policy. F8-A/C1 calls the recorder only after the financial journal passes fail-closed verification; its replay also checks the existing score event.

reconcile_live_battle_score_locked validates gift journal count and contracts, sums awarded_points, and sets pending/completed/cancelled outcome and winner. Lifecycle/finalization calls it under the Battle lock. It currently has no free-like source. Extending this single reconciliation also extends finalization deterministically without recalculating historical gifts.

Historical protections: F4A directed gifts; F4B score/outcome; F4D-A power engine, F4D-B projection, F4D-C visual realtime; F5-A rematch and C3 leave/locking corrections; F6 catalog/presentation; F7 routing/runtime; F8-A/C1 commission/idempotency/journal and F8-B physical actions. All historical migrations and package manifests must remain byte-identical (LF hashes checked at completion).

## Design decision

Add rule fields with historical defaults 1/0/0, insert immutable version 3 with 10/5/20, move only the pointer. Add exactly one append-only private-access like journal in public with RLS and revoked table grants. Keep the gift journal constraints intact. A dedicated authenticated batch RPC accepts session, Battle identity (context guard only), bounded count and retry key; it derives actor and target from server authority. Lock the Battle before checking replay, deadlines, membership and cap; aggregate accepted likes across both sides for each actor/Battle. Zero-score confirmed batches remain replayable. The existing visual reaction RPC remains unchanged for old clients and normal LIVE.

Use the existing score_states/projections and reconciliation, adding the like journal totals and event count. Likes never call finance, gift, rose or boost functions. Client transport batches taps with stable attempt keys and immediate local animation; successful score confirmations reconcile the existing projection.

## Current documentation consulted

- https://supabase.com/changelog.md (latest index; relevant July 2026 changes reviewed)
- https://supabase.com/changelog/realtime-schema-locked-down-against-modification (no realtime schema changes)
- https://supabase.com/changelog/extension-version-pinning-ignored (no extension pinning)
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/reference/cli/introduction
- https://www.postgresql.org/docs/current/sql-createfunction.html
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://www.postgresql.org/docs/current/sql-insert.html
