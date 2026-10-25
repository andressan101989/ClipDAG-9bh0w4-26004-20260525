# Nelyon controlled production release runbook

This runbook operates the single production authority implemented by
`.github/workflows/nelyon-production-release.yml`. It does not grant release
authority by itself. The policy file, GitHub Environment, exact workflow run,
persistent owner declaration, dispatch authorization, and postchecks must all
agree.

## Dormant Creator Premium F3 foundation

`finance_authority_transition` authorizes only the exact foundation delta from
baseline `238e987933c7198400534121e61fb3d2750ba5ba`, descended from immutable
source `27ff8b3861f901c548ee4c6abc054bc805d63f09`. The final approved release SHA
is supplied by the request, must equal fetched protected `main`, and is bound
into the manifest/artifact with the protected policy digest and compiler/adapter
bytes. There is no self-referential future commit pin.

The entire productive closure is one new migration,
`20261025011000_creator_premium_f3_bounded_financial_activation.sql` (Git blob
`8338634c5341fcadd102cdeb34eb1f9dc701af6d`, SHA-256
`1fea4ed72b0aaee90f066e24307547fb0305aa96e597d75c9eb21bb93384aec5`), and the
changed existing `bdag-ledger` source (bundle SHA-256
`8a07c5887d4550e58f554530bcca3dcd84293c074854456fb1c666ad7a73f977`).
The committed config blob is unchanged; config is not a productive resource in
this release. Additional migrations, functions, shared files or config changes,
missing/extra attestations, wrong ancestors, altered bytes and transition reuse
after baseline promotion fail closed. `bdag-ledger` is already managed; no
second function is enrolled. Risk remains HIGH.

The separate versioned `finance_authority` evidence attests relation columns,
constraints and validation, RESTRICT FKs, indexes and validity, enabled trigger
definitions, RLS/FORCE RLS, owners and ACLs, and the canonical function call
closure. FK enforcement evidence includes both referencing and referenced
triggers, even on targets outside the selected finance tables. Stable constraint,
relation, event and function identities bind the exact enabled/deferral state;
generated RI trigger names and OIDs are excluded. Private finance FK evidence
is recorded with the selected private relation, avoiding duplicate entries in
legacy public-ledger comparisons. The canonical function call
closure includes every overload, definition, owner, path and ACL. The two
foundation guards must remain exactly installed:
`creator_premium_finance_policy_f3_foundation_off_check` and
`creator_premium_finance_auth_f3_foundation_insert_guard`. Both v1 read
projections have exact predecessor/successor attestations; the two v2 reads and
separate Admin read are authenticated-only. Purchase has exactly four UUID
arguments; purchase/subscribe/refunds remain service-only and private helpers
remain owner-only. The existing authenticated RPC verifier remains strict.

The adapter selects legacy/F3 fact SQL from the validated migration inventory
before SQL parsing, so the legacy query never references the absent
authorization table. Legacy policy normalization uses `to_jsonb`; installed F3
must contain both activation fields. Query bytes, selection, schema/catalog
phase and snapshot identity are attested. Mutable rows do not enter the static
authority baseline, and the historical owner-reviewed baseline digest is not
reinterpreted. Existing ledger/Admin dependency authority is observed freshly
and must remain byte-for-byte identical across the release; a local fixture's
legacy grants are never an allowlist.

`finance_facts` retains one-way identity hashes, full-row binding digests, exact
decimal strings, targets/accounts/fees/transaction bindings, status/timestamps,
historical gross acquisition exposure and actual binding reconciliation.
Exposure includes refunded, reversed, expired and cancelled history. This
foundation accepts only empty authorization/receipt/period/subscription/Premium
transaction inventories, clean reconciliation and zero release movement, with
Finance false/false/false/0, `activation_mode=off` and null active authorization.
Generic ledger growth remains subject to the existing full finance classifier;
no release-attributed movement is accepted.

Security Advisor permits only the exact phase-approved projection changes and
new owner-only private authorization relation. Every unrelated finding,
exception, relation and cron identity is preserved. P3 and MEDIA-C1 controls are
unchanged. Local clone evidence verifies the catalog contract but is not a
production observation or release authorization. Real pre/post snapshots remain
mandatory, including backup, concurrency, SHA, manifest and policy controls.

Public mode, canary arming, activation and disarm are not accepted by this
foundation policy. A later exact owner-approved activation requires a separate
protected policy/migration replacing both guards. After dormant release, promote
the baseline separately through the protected process and obtain a fresh
`NO PRODUCTIVE CHANGES` plan. No workflow dispatch, protected-variable update,
participant selection or BDAG movement is authorized by these instructions.

G1 remains the persistent owner declaration
`SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF`, with observed state `UNAVAILABLE`
and `independently_verified=false`. No screenshot freshness or automatic
observation claim is restored.

Local governance verification:

```powershell
$env:RUN_F3_GOVERNANCE_LOCAL='1'
node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
```

The opt-in local catalog test clones only the existing
`premium_f2_governance_20261024` fixture in `nelyon-ads-v2-d-compile`, applies the
unchanged F3 migration and tests rolled-back SQL security mutations. It drops
only its generated `premium_f3_governance_<pid>_<time>` database in `finally`.

## Single-owner security model

The only authorized human account is `andressan101989`. A scoped owner prompt
authorizes one defined operation; Codex dispatches the canonical workflow with
the exact SHA, unique release ID, mode, and policy confirmation class. The
Environment uses automatic authorization, so there is no deployment approval comment
and the owner's identity is never reused to simulate a review.

Compensating controls bind the run and attempt to the protected `main` branch,
immutable manifest, policy digest, project, current empty deployment approval
history, the fail-closed auto-deploy expectation, snapshots, backup, and
postchecks. Re-running a workflow creates a new attempt and repeats every
technical gate.

## GitHub production configuration

Configure repository **Settings → Environments → production** as follows:

- Environment ID: `23906772073`
- Required reviewer: `None`
- Authorization mode: `automatic`
- Deployment branches and tags: `Selected branches and tags`
- Selected branch: `main`
- Allow administrators to bypass configured protection rules: `OFF`

Confirm the API returns the exact Environment ID, no human or timed protection
rules, one branch policy named `main`, and no administrative bypass. The
workflow also requires current empty deployment approval history and rejects
any other snapshot.

Create one Environment secret by name only:

- `SUPABASE_ACCESS_TOKEN`

This is the scoped project deployment token. The fixed snapshot adapter uses
the same identity only through an immutable allowlist of Management API GET
endpoints and `/database/query/read-only`; it does not claim that the identity
itself is read-only. Migration dry-run and apply use the pinned official CLI,
which provisions its temporary `cli_login_postgres` role through Supabase's
control plane. The workflow does not store or require the PostgreSQL password.

Never copy a value into this runbook, the policy, a manifest, an artifact, a
workflow input, or a log. Do not add `service_role`; this gate does not require
it. The `plan` job and `gate_proof` path do not reference deployment secrets.

Set the independently reviewed policy digest in the Environment variable
`NELYON_RELEASE_POLICY_SHA256`. It must be the SHA-256 of the exact reviewed
policy bytes committed to `main`, not a reformatted JSON equivalent.

Create one protected Environment variable:

- `SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF`

This is an `OWNER_PERSISTENT_DECLARATION` of the required configuration. It is
not a live provider observation. The gate records `observed_state=UNAVAILABLE`
and `independently_verified=false`; in plain language, the toggle is **not independently verified** because Supabase does not currently document a
reliable API or CLI field for reading **Deploy to production**. Missing, empty,
`ON`, `UNKNOWN`, lowercase, padded, or any other value fails closed. Never
describe this declaration as proof that the current provider setting is OFF.

Protect `main` with required pull requests, branch integrity controls, no
force pushes, and no unnecessary administrative bypass. With one owner, use
zero required code approvals so the repository remains operable. Production
still requires the Environment boundary and every automated technical gate.

## Baseline candidate to verified

The current expanded 18-function baseline is `verified`. A later managed-scope
change returns it to `candidate`; equality with GitHub `main` is not enough.
Capture a complete read-only owner-control-plane snapshot covering:

1. exact remote migration inventory, count, and latest version;
2. managed and unmanaged remote function inventories;
3. function versions, `verify_jwt`, and demonstrable source parity;
4. `supabase/config.toml` parity for every managed function;
5. cron and security inventory;
6. project health;
7. Premium Finance switches and fee; and
8. Premium transaction count and C2-attributed BDAG movement.

Run the pure baseline verifier outside GitHub Actions. It must return separate
digests for migrations, managed functions, unmanaged functions, function
source parity, config/`verify_jwt`, cron/security, and finance. Any incomplete,
ambiguous, or paginated evidence keeps the affected resource blocked.

The owner then reviews the proposal, commits the proposed policy change in a
separate protected Git commit, and updates `NELYON_RELEASE_POLICY_SHA256` to
the exact committed policy bytes. The workflow has `contents: read` and cannot
promote its own baseline. After a future successful release, record the prior
release ID, manifest SHA-256, and postcheck evidence SHA-256 before advancing
the baseline through the same external procedure.

## Supabase automatic-deploy cutover

Before the gate commit reaches `main`, open the Supabase GitHub Integration for
project `aewwdlvbwpczqyvkwvvj` and set **Deploy to production** to **OFF**.
Keep the GitHub integration connected. Do not disable the project or other
services.

The protected policy retains the original owner-bound cutover record only as
historical evidence of the one-time cutover. It must never be presented as a
fresh observation of the current setting.

Supabase currently documents GitHub Integration setup and Management API
resources, but not a reliable read field for this production-deploy toggle.
Until such an official observable exists, the permanent contract is:

- expected state: `OFF`;
- declaration: exact protected variable value `OFF`;
- evidence kind: `OWNER_PERSISTENT_DECLARATION`;
- observed state: `UNAVAILABLE`;
- independent verification: `false`; and
- risk treatment: owner acceptance plus all unchanged compensating controls.

Authoritative references: [GitHub Integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
and [GitHub connections API](https://supabase.com/docs/reference/api/v2-list-organization-github-connections).

If Supabase later publishes a reliable API for the toggle, add its independent
observation through a separately reviewed governance change. Do not infer the
toggle from GitHub connection metadata, action history, HTTP success, or the
historical screenshot.

After the controlled push to `main`, verify in Supabase that no automatic
production deployment started. If any automatic deployment appears, stop,
cancel no unrelated work, preserve evidence, and do not dispatch the gate.

## Run plan_only

Choose **Actions → Nelyon controlled production release → Run workflow** on
`main`. Supply the exact 40-character current `origin/main` SHA, a new release
ID, `PLAN_ONLY`, and mode `plan_only`.

The job must produce a canonical manifest and SHA-256. For a governance-only
delta the required result is `NO PRODUCTIVE CHANGES`. The protected `deploy`
job must not be scheduled.
Confirm there are no Supabase migrations, Edge deployments, financial writes,
or BDAG movement attributable to the run.

## Run gate_proof

Dispatch a new unique release ID, the exact current main SHA,
`GATE_PROOF_NO_MUTATION`, and mode `gate_proof`.
The protected job starts without a human review, then re-fetches the approval
endpoint for the current run and attempt and requires a current empty
deployment approval history. It also re-fetches Environment configuration,
branch policies, current main, manifest, and active runs. Any approval,
bypass, reviewer rule, wait timer, branch drift, or concurrent run fails
closed.

Successful proof ends with `GATE PROOF SUCCESS`. It must not set up the
Supabase CLI, read deployment secrets, apply migrations, deploy functions, or
perform finance operations.

## Future release procedure

`release` remains fail-closed while the baseline is candidate, the cutover
state is pending, a resource is unreproducible, the scoped deployment token is
unavailable, or there is no fresh completed physical backup. The reviewed adapter is
`scripts/nelyon-production-snapshot-adapter.mjs`; it uses only fixed Supabase
Management API endpoints, the read-only SQL endpoint, bounded responses,
disabled redirects, zero retries, and sanitized receipts. Its pre/post
snapshots are bound to the exact request, manifest, SHA, run attempt, adapter,
and query fingerprints.

The manifest binds the adapter's repository-relative path and SHA-256. Verify
both values before resolving credentials or opening any network connection.
The production workflow pins the Supabase CLI to `2.120.0`. Function deploys
use the CLI's API bundler (`--use-api`) one function at a time; the trusted
Supabase control plane therefore performs the final bundle. This is a
reproducible governed-source contract, not a claim that a downloadable remote
archive is byte-for-byte identical to a local bundle.

For a separately authorized future production release:

1. verify the exact main SHA and unused release ID;
2. require `SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF` and record that the actual
   provider state remains unobservable rather than claiming a live check;
3. run the plan and inspect every changed file, migration, function,
   transitive `_shared` consumer, risk, and blocker;
4. use `RELEASE_STANDARD` or, only for explicitly reviewed sensitive scope,
   `RELEASE_HIGH_RISK`;
5. require the automatic Environment snapshot, main-only branch policy, no
   bypass, no human/timed protection rule, and empty current approval history;
6. require authorization-time revalidation before every mutation;
7. capture the bound pre-snapshot through the fixed read-only transport,
   require a fresh completed physical backup, and reduce the CLI dry-run to an
   exact timestamp list equal to the manifest;
8. apply only exact forward migrations in the manifest;
9. deploy functions one by one by exact manifest name, never by directory or
   timestamp inference; and
10. capture the bound post-snapshot and require all remote, finance, health,
   cron, and security comparisons before
   success.

For every protected gate, the exact declaration is validated without a human
deployment comment. It does not replace SHA, manifest, policy digest, backup,
snapshot, concurrency, Finance, Security Advisor, or postcheck controls.

`video-semantic-index` is a governed transitive consumer of the shared visual
pipeline and must be included whenever that pipeline changes. The release
compiler derives the exact function set from direct and transitive imports;
do not add or omit functions manually. Edge imports used by the affected graph
must be version-pinned and reproducible.

The graph verifier fails closed on implicit `deno.json`/`deno.jsonc`
configuration, unsupported source extensions, CommonJS `require(...)`,
TypeScript `import = require`, and triple-slash references. A governed
function's entrypoint or import-map change is a source change; a `verify_jwt`
configuration-only change is not. Immediately before every function deploy,
revalidate its exact entrypoint, transitive graph, source hash, import-map hash,
and JWT contract. The post-snapshot must then prove that every listed function
advanced version, retained the expected `verify_jwt`, and, when source changed,
has a different sanitized remote source fingerprint. Every unlisted function
must remain unchanged.

Stripe, webhooks, BDAG, ledger, wallet, escrow, private media, moderation,
authentication, `verify_jwt=false`, and financial migrations are always high
risk. High-risk confirmation never overrides drift, ambiguity,
non-reproducibility, baseline, or postcheck failures.

## Concurrent finance reconciliation

Capture complete sanitized transaction and ledger inventories immediately
before and after the release, using database `clock_timestamp()` and the
maximum `(created_at,id)` watermark. The watermark assigns newly created
boundary rows exactly once; it is not the sole change detector.

Compare every pre-existing transaction in both snapshots. This detects
transactions confirmed after the pre-snapshot even when created before it.
Only explicit pending/processing-to-terminal status transitions may change,
and only their status and blockchain confirmation field may differ. Completed,
failed, and reversed historical rows, prior ledger entries, amounts, accounts,
currency, references, and idempotency fields remain immutable.

The owner-reviewed finance baseline additionally binds the schema digest,
complete Premium Finance policy (including its version), Premium table/function
bindings, Premium transaction count, all canonical reconciliation counters,
and the constant `c2_attributed_bdag_movement=0`. Every baseline reconciliation
counter must be zero before mutation. Preserve the stable identity of every
pre-existing ledger account (`id`, hashed owner, type, currency, and creation
time); legitimate new concurrent accounts are allowed but mutation or deletion
of an existing identity is not.

Every completed new or newly confirmed transaction must have matching balanced
debit and credit ledger entries tied to its amount and accounts. Reject any
transaction or ledger metadata containing the current release ID or run ID.
Run all canonical reconciliation functions and require zero mismatches.

Legitimate concurrent count or balance growth is reported separately and is
not a failure by itself. Integrity depends on complete inventory comparison,
allowed transitions, balanced ledger legs, absence of release attribution,
and canonical reconciliation—not on static counters.

Premium Finance must remain exactly disabled: purchases false, subscriptions
false, refunds false, and platform fee 0.

## Content Safety and provider activation gates

The Creator Premium policy package remains a candidate. Its twelve ES/EN
rules are draft and disabled; their package fingerprint and F7 canary plan are
review evidence, not normative approval. Before production activation, the
owner must separately approve the policy authority, permitted/restricted
categories, false-positive handling, appeals, retention, and store/payment
constraints. Never autoapprove or enable these rules from the release job.

The local provider adapter and dry-run do not prove real provider behavior.
Real Gemma/Whisper component validation still requires a verified isolated
Cloudflare account or explicitly approved isolation, trusted owner
authorization bound to the exact SHA/fingerprints, confirmed quota and cost,
and a separate nonzero budget. Private R2/Stream end-to-end validation also
requires isolated synthetic media resources and cleanup authority. Until those
gates are complete, keep fail-closed publication semantics and report real
provider/private-media E2E as pending.

## Failure recovery and rollback

A failed postcheck is a failed release and never advances baseline authority.
Preserve the manifest, digest, authorization evidence, snapshots, and logs.

The workflow captures a sanitized release-observation artifact even when a
mutation or postcheck fails. It includes bounded receipts and state summaries,
never raw snapshots, authorization headers, database credentials, private
payloads, or signed media URLs. A numeric run-attempt value is not sufficient
release attribution: reconciliation checks only exact, labeled release/run
identifiers. Advisor fingerprints exclude volatile observation timestamps so
unchanged findings compare deterministically.

Database correction uses a new forward-only corrective migration reviewed in
a later authorized release. Never perform an automatic destructive rollback.
Edge recovery redeploys previously approved reproducible Edge source through a
new explicitly authorized release. Never infer a rollback artifact from a remote bundle hash
or deploy an unlisted local function such as `bdag-economy`.

## Creator Premium postcheck recovery

`postcheck_recovery` is the read-only continuation for an exact failed release
listed in `postcheck_recovery.approved_sources`. Every source is bound to its
run attempt, release ID, source SHA, full artifact IDs and digests, canonical
manifest digest, pre/post evidence digests, migration inventory, Edge
attestations, Premium relation-security digest, and legacy counts. A source is
eligible only when every mutation step and the post-snapshot succeeded and only
the ordinary postcheck failed. Historical artifacts contain sanitized
verification records and evidence digests; they do not contain credentials or
private rows.

Dispatch the canonical workflow from the exact current `main` SHA with:

- `mode`: `postcheck_recovery`;
- `scope_confirmation`: `POSTCHECK_RECOVERY_READ_ONLY`;
- `recovery_source_run_id`: one exact run ID present in the reviewed policy; and
- a new unique recovery release ID.

The plan must contain zero productive resources. After the `production`
Environment boundary, the workflow derives both artifact names from that exact
policy source and downloads them from the selected run. It verifies the full
GitHub artifact IDs/digests, source SHA, request, canonical manifest bytes,
pre/post evidence digests, and the failed-postcheck step shape before opening a
Supabase connection. Caller-supplied artifact names are never accepted.

The fresh capture uses the reviewed Snapshot Adapter with `--phase recovery`.
Its only database calls are the four fixed read-only SQL requests for finance,
cron, protected RPC catalog attestations, and Premium postcheck state. The
remaining reads are fixed Management API health, migration, Edge Function,
Security Advisor, and physical-backup endpoints. Recovery never invokes
Supabase CLI setup, `supabase db push`, migration application, function deploy,
generic SQL, policy writes, secret rotation, or a caller-supplied command.

Success requires the source-specific migration count/latest migration, every
source-pinned Edge version/digest/`verify_jwt` contract, the historical
554-finding Advisor baseline plus the exact individually attested exception
set, exact RPC owner/definer/search-path/ACL/definition evidence, fresh healthy
backup state, Finance OFF with zero canonical reconciliation anomalies and no
source-run attribution, Content Safety fail-closed, the exact Premium relation
security digest, and exact legacy counts. The P2 source `39157300357` requires
341 migrations with `20261018170000_creator_premium_content_safety_p2_evidence_runtime`
latest, `content-safety-scan` v42, relation digest
`055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6`,
and legacy counts `4 / 2 / 2`. Any unknown or missing fingerprint, artifact
drift, RPC attestation change, relation addition or mutation, source-attributed
finance row, missing backup, concurrent release, or production mismatch is a
hard stop.

If an RPC is demonstrated vulnerable, do not add an exception. Create one
focal forward-only corrective migration, prove its negative and positive cases
in the disposable PostgreSQL harness, and use a separately protected canonical
release containing only that correction. Do not reapply B7 or redeploy an
unchanged Edge Function.

The sanitized output artifact is
`nelyon-postcheck-recovery-<run-id>-<run-attempt>` and is retained for 90 days.
`POSTCHECK_RECOVERY_SUCCESS` establishes backend readiness for owner physical
QA; it does not mean `PHYSICAL_PASS`.

## Stop conditions

Stop before mutation if any of these occurs:

- actor, triggering actor, repository, workflow ref, SHA, or main differs;
- baseline or policy digest is candidate, unknown, or mismatched;
- Environment authorization mode, human/timed rules, branch, ID, or bypass
  differs;
- deployment approval history is non-empty, incomplete, historical, or from
  another attempt;
- the persistent owner declaration is missing or differs from expected OFF;
- another production release is active;
- the manifest, artifact, compiler, dependency graph, or source provenance is
  ambiguous;
- required secrets are absent;
- Supabase health, migrations, functions, cron, finance, or security drift;
- any finance write is release-attributed or fails reconciliation; or
- an unexpected automatic deployment starts.

Do not bypass, force, prune, bulk deploy, rewrite history, or weaken a control
to continue.

## Zero-mutation postcheck

For `plan_only` and `gate_proof`, record:

- the before/after project health;
- unchanged migration inventory and latest migration;
- unchanged Edge function versions and source hashes;
- unchanged cron/security inventory;
- unchanged Premium Finance policy;
- complete finance reconciliation with zero release-attributed BDAG movement;
- no new production deployment attributable to the workflow;
- exact GitHub run ID, run attempt, Environment ID, authorization mode, SHA,
  manifest digest, and gate-proof digest; and
- unchanged worktree count, stashes, B5 source, and ROADMAP.

This zero-mutation evidence does not authorize a functional release.
