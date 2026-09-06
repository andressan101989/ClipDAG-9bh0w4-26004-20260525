# LB4-F9-A — Gift and Like Battle Scoring

Base: `b7c55571628c8af2ac2c846a8f7a1e5f16bd566d`.
Branch: `codex/lb4-f9-a-gift-like-scoring`.
Worktree: `C:/Users/andre/ClipDAG-lb4-f9-a` (outside the user's checkout).

## Implementation

The immutable v3 rule pins gift_points_per_coin=10, like_points=5 and max_scoreable_likes_per_viewer=20 for newly created Battles. Historical rows receive metadata defaults 1/0/0; existing Battle rule IDs, journals, outcomes and money remain unchanged. The migration rejects an unexpected rule frontier. All historical migration files are unchanged.

The existing gift recorder and contract validator scale the gross base by the pinned factor before applying the existing boost. No gift RPC, financial transfer, commission function, journal verifier, catalog or price changed. Paid heart costs 1 and scores 10/20/30; rose costs 5 and scores 50/100/150. A rose advances one unit while its mission is open; the existing completed mission remains capped during x2.

One new table, `public.live_battle_like_score_events`, records bounded batches and zero-accepted receipts. The paid journal keeps its NOT NULL/UNIQUE gift FK. RLS, an explicit restrictive deny policy, revoked table grants, immutable update/delete/truncate triggers, rule/identity validation and a unique Battle/actor/key constraint protect the free journal. No IDs or personal fields are added to public projections or RPC responses.

`public.send_live_battle_likes(uuid,uuid,integer,text)` accepts session, Battle context, count (1–64) and key (1–200 restricted characters). Actor is auth.uid(); target is derived from the session/Battle pair. Active membership is required. Both hosts receive zero free points. The canonical Battle row lock serializes gifts, likes and finalization. A confirmed replay is checked before mutable session/participant/deadline authority and rejects a changed session/count. The cap sums accepted likes across both sides for the same viewer/Battle. Count beyond the remaining cap is accepted visually with zero extra points. PostgreSQL alone computes accepted_count and awarded_points.

The existing reconciler adds the like journal to gift totals and uses that combined result for score_states, both public projections and the winner. Only positive accepted batches increment competitive score_version. Likes never call finance, gifts, rose advancement or boosts.

The viewer animates immediately and queues transport batches of at most 16, with a 300ms collection window. Ambiguous retries preserve key/count and use bounded exponential delay. Confirmed batches get a new key; terminal authorization failures stop without intrusive UI feedback. Cleanup drains existing taps under their original context and suppresses stale UI callbacks; effect remount creates a fresh queue. The service verifies the current account before sending a pending batch. The original `live_emit_reaction(uuid,text)` remains unchanged for visual distribution, normal LIVE, hosts/cohosts and older clients. **Older clients remain visual-only; they do not call the new scoring RPC.** No React Native point or economic calculation was introduced.

All changed/new privileged functions are owned by postgres with search_path=''. Only authenticated can execute the new public RPC; PUBLIC, anon and service_role cannot. Private functions have no client execution grants. See security-lint-after.json for exact catalog metadata.

## Evidence

- audit.md, audit-reaction.sql and schema-audit.json: route, original RPC body, structures, constraints and triggers.
- red.tap: original six structural failures, before implementation.
- red-postgres.json: actual original gift scores 1/5 versus required 10/50 and absent like authority.
- migration-before.json / migration-after.json: identical monetary/gift/ledger/rose/boost snapshots and score=1 for a Battle created before migration. It continues scoring at v2 after v3 becomes current.
- green-postgres.json: 27 passed groups covering the 12 gift/boost combinations, legacy rules, likes 1/10/20, cap 21, remainder 18+5, cross-side cap, separate viewers/Battles, duplicate and different-key concurrency, gifts+likes concurrency, deterministic reconstruction, session targets/membership, hosts/auth/count rejection, countdown/prestart/ordinary LIVE, boost isolation, terminal replay, combined winner, lock/deadline/finalization races and ACL/mutation denial.
- regression-c1-postgres.log: all original C1 assertions and 11 named cases passed, ending in ROLLBACK. Its existing zero-platform-balance fixture precondition was prepared inside that same rolled-back transaction; the historical proof file was not edited.
- regression-initial.tap: 21 initial global failures caused by explicit migration-frontier lists. The lists now include exactly F9-A; every historical hash and behavior assertion remains enforced. No failures were converted to skips.
- summary.json: final suite counts. F9-A 18/18; F8-A/C1/F8-B 29/29; reactions 14/14; runtime/rematch 91/91; Battles 434/434; finance/wallet/ledger/gifts 98/98; global 1576/1576. Zero failures, skips, cancellations or todo.
- typescript-comparison.json: 237 historical diagnostics, zero new; full output matches C1 after normalizing worktree paths. TypeScript exits 2 and is not historically clean.
- advisors-before.json / advisors-after.json: 88 historical WARN findings in the disposable schema, zero additions. These are local findings, not production advisor results.
- db-lint-comparison.json: 25 historical issues (11 warning, 7 warning extra, 7 error), zero additions versus C1. The narrower Battle/reaction lint also has zero before/after findings. CLI lint's exit 0 does not mean the historical errors disappeared.
- protected-lf-hashes.json: all 210 historical migrations plus both package manifests match the base (212/212).

## Commands and reproducibility

CLI 2.116.0; --help, migration --help, migration new --help, db --help, db advisors --help and db lint --help were inspected. The new filename came exclusively from:

```powershell
npx.cmd supabase migration new live_battle_gift_like_scoring
```

Created `20260906053652_live_battle_gift_like_scoring.sql`, SHA-256 LF:
`090c86a9d120b4d00ab93ee595460621fbd67ae4eff3a3a56135a3d0ea68cd5e`.
Protected F8-A/C1 commission SHA-256 LF remains:
`63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`.

Local proof uses the existing sanitized schema-only F4D fixture from C1, identified by SHA in bootstrap.json. Set `LB4_F9_BASE_SCHEMA` to that file; it is a prerequisite, not downloaded from production. The bootstrap installs historical migrations and catalog fixtures in dependency order and disables historical cron jobs locally. It never accepts a remote project or database URL.

```powershell
docker run --name clipdag-lb4-f9-proof -d -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55439:5432 public.ecr.aws/supabase/postgres:17.6.1.165 -c listen_addresses=* -c shared_preload_libraries=pg_cron -c cron.database_name=postgres
node scripts/prove-live-battle-f9-local.mjs bootstrap
```

Initialize a random password for the disposable postgres role only and write it to the OS temporary file `lb4-f9-local-auth` (never print or commit it). The proof runner is hardcoded to loopback port 55439. Run advisors **before** applying F9-A, using an in-memory local URL with `sslmode=disable`; this container does not enable TLS. The CLI labels arbitrary --db-url connections "remote", even for 127.0.0.1.

```powershell
npx.cmd supabase db advisors --db-url $f9LocalUrl --output json
node scripts/prove-live-battle-f9-scoring.mjs baseline
node scripts/prove-live-battle-f9-local.mjs sql supabase/migrations/20260906053652_live_battle_gift_like_scoring.sql apply-f9
node scripts/prove-live-battle-f9-scoring.mjs green
npx.cmd supabase db advisors --db-url $f9LocalUrl --output json
npx.cmd supabase db lint --db-url $f9LocalUrl --schema public,private --level warning --output json
docker rm -f -v clipdag-lb4-f9-proof
```

Each fresh bootstrap reproduces the same rule transition. Do not reapply the migration over an already migrated database: its version guard intentionally rejects that state. Green proof fixtures commit only to permit real independent PostgreSQL sessions; the entire disposable container and its anonymous volumes are destroyed afterward. Red and C1 transactional proofs roll back.

Canonical Node suites enumerate `tests/*.test.mjs` and run `node --test --test-reporter=tap` with these filename filters: focal `Lb4F9A`, F8 `Lb4F8`, reactions `reaction|liveLb1`, runtime `Runtime|Series|Rematch`, Battles `liveBattle`, finance `financ|wallet|ledger|gift`, global all files. TypeScript: `npx.cmd tsc --noEmit --pretty false`. Final whitespace check: `git diff --check`.

No production SQL, deployment, Edge Functions, secrets, Agora/Media Relay code, builds, Metro or physical tests. No integration into codex/lb4-integration. User checkout and untracked files are untouched.
