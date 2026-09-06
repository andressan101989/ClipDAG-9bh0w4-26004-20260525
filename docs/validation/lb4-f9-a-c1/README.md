# LB4-F9-A-C1 — bounded like journal and retry lifecycle

Base and direct parent: `adb741677a8d80f9bb9d54ba3a0572c22cd4964e`.
Branch: `codex/lb4-f9-a-c1-bounded-like-journal`.
One corrective commit: `fix: bound live battle like scoring retries`.
Integration remains `b7c55571628c8af2ac2c846a8f7a1e5f16bd566d`.

## Preflight and scope

`git fetch --all --prune` completed. Local F9-A, its upstream, origin and
`ls-remote` matched the required base. The isolated worktree is
`C:/Users/andre/ClipDAG-lb4-f9-a-c1`, outside the main checkout. The main
checkout's four modified UI files, `.worktrees/`, and untracked
`tests/liveBattlesLb4Ui1FigmaStage.test.mjs` were preserved. Integration was
not modified.

The official Supabase skill was read at
`C:/Users/andre/.codex/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/supabase/SKILL.md`.
Read-only Supabase `list_migrations` metadata returned 210 migrations, latest
`20260905230823`; F9-A `20260906053652` was absent. See
`production-migration-preflight.json`. No production SQL or RPC was executed.
This permits correcting the existing, undeployed F9-A migration; no new migration.

Consulted current official documentation:

- [Supabase changelog](https://supabase.com/changelog.md): reviewed relevant
  breaking changes, including protected Realtime schema and extension version
  pinning; neither is changed here.
- [Database functions](https://supabase.com/docs/guides/database/functions).
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [API security](https://supabase.com/docs/guides/api/securing-your-api).
- [CLI reference](https://supabase.com/docs/reference/cli/introduction).

Installed CLI: **2.116.0**. Inspected `npx.cmd supabase --version`, `--help`,
`db --help`, `db advisors --help`, and `db lint --help` before use. No push,
deploy, repair, seed, reset, or production query command was used.

## Causes and exact correction

SQL inserted a receipt unconditionally, including zero accepted likes. Its
CHECK constraints admitted zero counts and points. Unique fresh keys therefore
allowed unbounded zero-value rows even after the cap or closure.

The existing migration now requires requested count 1..64, accepted count
1..requested, positive like points and awarded points, and exact integer
`awarded_points = accepted_count * like_points`. A zero outcome returns
`(0, 0)` before INSERT and before reconciliation. The cap is read under the
same canonical Battle lock. Positive replay still precedes mutable session,
participant and active/deadline validation. Conflicting count/session rejects.
Unauthorized nonparticipants retain the existing sanitized rejection contract;
hosts, inactive/time-ineligible and historical-rule attempts return safe zero.

Partial 18+5 acceptance stores one row with accepted=2 and points=10. Original
requested_count=5 is retained solely to detect payload conflicts on replay;
only the accepted count contributes to quota and score. No zero row is created
for the discarded excess.

Not persisting zero is safe because it changes no competitive fact. Consumed
quota only increases, pinned rules do not change, and closed Battles do not
reopen. A pre-start visual attempt can later become eligible, but has no
previously awarded points to duplicate. Positive receipts remain durable.
Each persisted row consumes at least one quota unit: **at most 20 rows per
viewer/Battle under v3**, at most 20 accepted likes and 100 points.

The batcher previously discarded the RPC receipt, cleared only the attempt
on terminal rejection, and allowed `finally`/`schedule` to schedule timers
after `close()`. It now consumes partial/zero receipts, clears queued work,
disables future scoring adds and cancels timers. Terminal rejection does the
same. Mounted ambiguous failures preserve count/key and existing backoff.
Closing cancels the timer immediately, prohibits future adds/flushes/timers,
allows at most one immediate bounded final attempt, and clears queued work.
An in-flight request may finish but cannot notify UI, reconcile, retry or
start another request. A closed ambiguous attempt is not retried.

No screen or RPC service change was necessary: the existing UI animates first
and queues scoring separately, and the service already returns the receipt.
Its stable reconcile callback does not recreate the batcher on score updates.
The actual UI callback is exercised with an exhausted real batcher.

Only runtime/SQL changes: `services/liveBattleLikeBatcher.ts` and
`supabase/migrations/20260906053652_live_battle_gift_like_scoring.sql`.
Tests: new `tests/liveBattlesLb4F9AC1BoundedLikes.test.mjs`, plus three fixture
returns in `tests/liveBattlesLb4F9AScoring.test.mjs`. Those existing mock sends
now return valid complete receipts, required because the batcher consumes them;
no historical assertion was removed or weakened. All other additions are
proofs/evidence in this directory. `files.json` is the exact changed-file list.

## Security and unchanged rules

Public signature stays `send_live_battle_likes(uuid,uuid,integer,text)`, owner
postgres, SECURITY DEFINER, `search_path = ''`, EXECUTE only authenticated.
PUBLIC, anon and service_role cannot execute it. `auth.uid()` remains mandatory.
The journal retains RLS, restrictive deny-all policy, revoked client grants,
append-only triggers and idempotency UNIQUE constraint. Private permissions,
owners and search paths match the base. Numeric relation OIDs differ between
fresh schema bootstraps and are excluded only from the ACL comparison.

Likes remain 5 points each, without multipliers or economic/rose/boost effects.
Gifts remain cost x10 before x2/x3. Pinned historical rules remain unchanged.
Gift transfers, commission half-up 35%, fail-closed journal, prices and catalog
are unchanged. No extra table, journal or financial route was introduced.

## Red evidence

Before implementation, the focal ran against original F9-A code:
**11 tests, 1 pass, 10 fail, 0 cancelled/skipped/todo** (`red-client.tap`).
The later visual-integration test raises the final focal count to 12.
The initial in-flight test harness awaited an unresolved mock on an unintended
second call; it was made deterministic before the complete recorded red run.

Actual PostgreSQL red (`red-postgres.json`):

- 20 positive requests: 20 rows / 20 likes / 100 points.
- 1,000 extra unique keys: **1,020 rows**, same 100 points (defect).
- Closed Battle, 1,000 unique keys: **1,000 zero rows** (defect).
- Red transaction finished with ROLLBACK.

## PostgreSQL proof

`proof.mjs green` passes **18 groups**, listed in `green-postgres.json`:

- 20 individual positives then 1,000 over-cap requests preserve exactly
  20 rows, 20 likes and 100 points; snapshots including public projections and
  economic/rose/boost aggregates are identical before/after the flood.
- 1,000 unique requests each for closed, deadline-expired, historical rule,
  host, nonparticipant and countdown: zero rows/points and no side effects.
- 18+5 partial acceptance, no later rows, positive replay after closure and
  membership/session deactivation, conflicting payload rejection.
- Heart/rose x1/x2/x3: price, journal entry counts, fee, rose progression and
  gift points preserved; free likes stay +5 without economic movement.
- Combined journal determines winner and both public projections.
- CHECK constraints independently reject zero/inconsistent rows; RLS/ACL,
  auth and append-only mutation denials verified.
- Independent sessions exercise same-key replay, distinct-key quota race,
  independent viewers, concurrent gifts+likes, deterministic reconstruction,
  and deadline/finalization locking.

Every sequential case rolls back its entire fixture. True concurrency needs
shared committed fixture setup and visible commits between sessions; every
worker ends with ROLLBACK and the container plus anonymous volumes are destroyed
after verification. No proof connects anywhere except 127.0.0.1:55439.
See `cleanup.json` for destruction evidence.

Reproduction (run from isolated worktree; requires Docker, existing dependencies,
and the sanitized schema-only fixture used in F9-A):

```powershell
docker run --name clipdag-lb4-f9-proof -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55439:5432 -d public.ecr.aws/supabase/postgres:17.6.1.165 -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c listen_addresses=*
$env:LB4_F9_BASE_SCHEMA='C:/Users/andre/AppData/Local/Temp/lb4-f4d-b-validation/f4da-schema-complete.sql'
node docs/validation/lb4-f9-a-c1/bootstrap.mjs bootstrap
node docs/validation/lb4-f9-a-c1/bootstrap.mjs sql supabase/migrations/20260906053652_live_battle_gift_like_scoring.sql green-migration
node docs/validation/lb4-f9-a-c1/proof.mjs green
docker rm -f -v clipdag-lb4-f9-proof
```

As in F9-A, initialize a random **local-only** postgres password and supply it
via the OS temporary `lb4-f9-local-auth` file before the Node proof. Never use
production credentials. The prerequisite schema is not a production data dump;
its hash and bootstrap logs are recorded here. Red used the original F9-A SQL
before editing; green recreated the schema and applied the complete corrected
migration, rather than replacing just the function in the test database.

## Regression results

| Suite | Passed | Failed | Skipped | Cancelled | Todo |
|---|---:|---:|---:|---:|---:|
| C1 | 12 | 0 | 0 | 0 | 0 |
| F9-A | 18 | 0 | 0 | 0 | 0 |
| F8-A/C1/F8-B | 29 | 0 | 0 | 0 | 0 |
| LIVE reactions | 14 | 0 | 0 | 0 | 0 |
| Runtime/rematch | 91 | 0 | 0 | 0 | 0 |
| Live Battles | 446 | 0 | 0 | 0 | 0 |
| Finance/wallet/ledger/gifts | 98 | 0 | 0 | 0 | 0 |
| Global canonical Node | 1588 | 0 | 0 | 0 | 0 |

`node docs/validation/lb4-f9-a-c1/regression.mjs` runs the real canonical
`node --test --test-reporter=tap` command on enumerated `.test.mjs` files.
`suites.json` records every selected file. No direct `.ts` runner workaround,
skip or reduced global scope was used. Global is F9-A 1576 + 12 C1 tests.

`npx.cmd tsc --noEmit --pretty false`: exit **2**, **237 historical, 0 new,
0 removed**. Full output matches the immediate F9-A baseline after normalizing
only absolute worktree prefixes (including node_modules and modules).
The first comparison omitted modules and flagged one path-only difference;
`typescript-initial-path-comparison.json` preserves it. No source line numbers,
diagnostic codes or messages were normalized. TypeScript is not clean.

Local CLI commands, using a temporary in-memory local connection string:
`npx.cmd supabase db advisors --db-url $f9c1Url --output json` and
`npx.cmd supabase db lint --db-url $f9c1Url --schema public,private --level warning --output json`.
The CLI prints “remote database” for an explicit URL, but the target here is
only loopback. Advisors: **88 historical, 0 new, 0 removed**. DB lint:
**25 historical (7 error, 11 warning, 7 warning extra), 0 new, 0 removed**.
Focused Battle/reaction PL/pgSQL lint: zero. Full advisors/lint are not clean.

`git diff --check` passes. The 210 historical migrations and package.json /
package-lock.json all retain their LF hashes (212/212), listed individually in
`protected-lf-hashes.json`. F8-A/C1 commission LF hash remains:
`63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`.
New F9-A LF hash:
`f13de76bb393f7c6e0784badffe9f33c11d7093e689b1dda9e1f4f4d5037a160`.

No integration, migration deployment, production SQL/RPC/write, build, Metro,
physical test, secret, catalog, price, Agora, Media Relay or DeepAR change.
