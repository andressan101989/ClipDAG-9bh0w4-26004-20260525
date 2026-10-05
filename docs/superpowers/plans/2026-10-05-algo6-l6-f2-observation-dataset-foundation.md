# ALGO-6 L6-F2 Implementation Plan

1. Verify exact Git and production baseline, absence of equivalent authority, canonical RPC dependency safety, 75% viewability, playback identity reuse, and pg_cron availability.
2. Add failing static/client tests for the four-table authority, exact RPC contracts, ranking metadata/parity markers, feature allowlist, ACL/RLS, retention, reconciler counters, and client event flow.
3. Generate exactly one migration with `supabase migration new algo6_l6_observation_dataset_foundation`.
4. Implement private tables, constraints/indexes/RLS/ACL, fail-soft decision helper, impression and engagement RPCs, progress RPC, retention job, same ranking RPC integration, and reconciler 57 -> 65.
5. Implement the thin observation service and client wiring in `feedRankingService`, `FeedContext`, Feed screen, and native/web VideoCard types without changing playback identity or business authorities.
6. Run static tests to green, then disposable database integration tests covering parity, fail-soft behavior, auth, idempotency, view linkage, engagement state/window/self-action, retention, ACL, reconciler, and bounded performance.
7. Run L1-L5, Feed/playback, Ads/social, Stories, Content Safety, lint, TypeScript, full base/branch comparison, and diff checks; audit the exact scope and forbidden dependencies.
8. Re-read production STOP gates, deploy the single migration, verify 324 migrations and 65/65 reconciliation without invoking production Feed, then commit/push and verify local/remote parity and a clean worktree.
