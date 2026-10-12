# Nelyon controlled production release runbook

This runbook operates the single production authority implemented by
`.github/workflows/nelyon-production-release.yml`. It does not grant release
authority by itself. The policy file, GitHub Environment, exact workflow run,
fresh Supabase evidence, owner approval, and postchecks must all agree.

## Single-owner security model

The only authorized human account is `andressan101989`. The same owner may
dispatch and approve a run because there is currently no second GitHub human
administrator. This is not independent two-person review. Compensating
controls bind approval to one run ID, run attempt, Environment ID, release ID,
source SHA, manifest digest, and current auto-deploy evidence digest.

Re-running a workflow creates a new attempt. A prior approval, even from the
owner, is invalid for that attempt. Never bypass the Environment wait or use a
historical approval comment.

## GitHub production configuration

Configure repository **Settings → Environments → production** as follows:

- Required reviewer: `andressan101989`
- Prevent self-review: `OFF`
- Deployment branches and tags: `Selected branches and tags`
- Selected branch: `main`
- Allow administrators to bypass configured protection rules: `OFF`

Confirm the API returns the exact Environment ID, one required-reviewers rule,
`prevent_self_review=false`, one branch policy named `main`, and no bypass.
The workflow rejects any other snapshot.

Create Environment secrets by name only:

- `SUPABASE_READ_ONLY_ACCESS_TOKEN`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

`SUPABASE_READ_ONLY_ACCESS_TOKEN` is a distinct least-privilege Management API
token. It needs only project/database/function metadata read access and the
documented read-only SQL permission. It must not deploy functions, apply
migrations, change configuration, or resolve to the write-capable deployment
token. The workflow exposes it only to the fixed snapshot adapter. Mutation
steps receive only the deployment credentials they require.

Never copy a value into this runbook, the policy, a manifest, an artifact, a
workflow input, or a log. Do not add `service_role`; this gate does not require
it. The `plan` job and `gate_proof` path do not reference deployment secrets.

Set the independently reviewed policy digest in the Environment variable
`NELYON_RELEASE_POLICY_SHA256`. It must be the SHA-256 of the exact reviewed
policy bytes committed to `main`, not a reformatted JSON equivalent.

The redacted automatic-deploy evidence is a non-secret repository variable
named `NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64`. It contains base64-encoded
canonical JSON, not credentials.

Protect `main` with required pull requests, branch integrity controls, no
force pushes, and no unnecessary administrative bypass. With one owner, use
zero required code approvals so the repository remains operable; production
still requires the Environment review.

## Baseline candidate to verified

The current expanded 18-function baseline is `candidate`. Adding
`video-semantic-index` to the governed set invalidated the historical
17-function evidence; equality with GitHub `main` is not enough.
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

Because there is no reliable read API for this switch, the owner must visually
verify **Deploy to production** is OFF and capture redacted evidence. Record a
unique evidence ID, project reference, production branch `main`, state `off`,
UTC observation time, observer `andressan101989`, source `owner-dashboard`, and
a digest. Never include a session token, cookie, credential, or unrelated UI.

Build the evidence digest without a circular hash: first canonicalize the
evidence object without its `sha256` field, then calculate the SHA-256 of `canonicalJson(evidenceWithoutSha256)`. Insert that lowercase digest as the
`sha256` field, canonicalize the complete record again, and base64-encode the complete canonical JSON including `sha256` for
`NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64`. The digest in the policy and approval
token is the digest of the payload without `sha256`, not a hash of the final
base64 text.

Treat that redacted canonical record as one synchronized authority input.
Evidence is valid for at most 15 minutes and permits at most 60 seconds
of future clock skew. Renew it before every future release and every proof that
requires Environment approval. The owner must specifically confirm this fresh
evidence in the approval comment; a general or historical confirmation fails.

Every renewed evidence record must also replace `cutover.auto_deploy_off_evidence`
in `.github/nelyon-production-release-policy.json` with the same evidence ID and
canonical SHA-256. Keep `cutover.state="verified"`, set `verified_by` to the
owner, and set `verified_at` to the current observation time. Then commit that policy transition through the protected Git flow.
Next, update `NELYON_RELEASE_POLICY_SHA256` to the exact new policy bytes before
dispatch.
Finally set `NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64` to the exact canonical record
referenced by the policy. Updating only the variable, only the policy, or only
the protected digest is insufficient and must fail closed.

For the initial C2 cutover, create the cutover policy commit locally only after
the owner has verified the dashboard toggle is OFF. Do not push that commit
until the same toggle has been verified OFF again and the Environment variable
contains the digest of the exact policy bytes to be published.

After the controlled push to `main`, verify in Supabase that no automatic
production deployment started. If any automatic deployment appears, stop,
cancel no unrelated work, preserve evidence, and do not dispatch the gate.

## Run plan_only

Choose **Actions → Nelyon controlled production release → Run workflow** on
`main`. Supply the exact 40-character current `origin/main` SHA, a new release
ID, `PLAN_ONLY`, and mode `plan_only`.

The job must produce a canonical manifest and SHA-256. For the C2 cutover,
whose delta contains governance only, the required result is
`NO PRODUCTIVE CHANGES`. The protected `deploy` job must not be scheduled.
Confirm there are no Supabase migrations, Edge deployments, financial writes,
or BDAG movement attributable to the run.

## Run gate_proof

Renew the automatic-deploy evidence first. Dispatch a new unique release ID,
the exact current main SHA, `GATE_PROOF_NO_MUTATION`, and mode `gate_proof`.
The plan summary prints the only valid Environment approval comment:

```text
NELYON-APPROVE run=<run_id> attempt=<run_attempt> env=<environment_id> release=<release_id> sha=<approved_sha> manifest=<sha256> auto_deploy_evidence=<evidence_id> auto_deploy_sha256=<evidence_sha256>
```

Verify every field, then open **Review deployments**, select `production`,
paste that exact complete token as the review comment, and approve as
`andressan101989`. The protected job must remain waiting until that action.
After approval it re-fetches the approval endpoint for the current run and
attempt, Environment configuration, branch policies, current main, manifest,
active runs, and fresh cutover evidence.

Successful proof ends with `GATE PROOF SUCCESS`. It must not set up the
Supabase CLI, read deployment secrets, apply migrations, deploy functions, or
perform finance operations.

## Future release procedure

`release` is forbidden during C2. Do not use it to test installation or
cutover. It remains fail-closed while the baseline is candidate, the cutover
state is pending, a resource is unreproducible, or the dedicated read-only
credential is not configured. The reviewed adapter is
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
2. renew visual auto-deploy-off evidence within 15 minutes, update the exact
   policy evidence binding through the protected Git flow, update the protected
   policy digest, and set the repository evidence variable to identical bytes;
3. run the plan and inspect every changed file, migration, function,
   transitive `_shared` consumer, risk, and blocker;
4. use `RELEASE_STANDARD` or, only for explicitly reviewed sensitive scope,
   `RELEASE_HIGH_RISK`;
5. paste the exact generated approval token into the current deployment
   review;
6. require post-approval revalidation before every mutation;
7. capture the bound pre-snapshot with the read-only credential and reduce the
   CLI dry-run to an exact timestamp list equal to the manifest;
8. apply only exact forward migrations in the manifest;
9. deploy functions one by one by exact manifest name, never by directory or
   timestamp inference; and
10. capture the bound post-snapshot and require all remote, finance, health,
   cron, and security comparisons before
   success.

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
Preserve the manifest, digest, exact approval, snapshots, and logs.

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
new manual release. Never infer a rollback artifact from a remote bundle hash
or deploy an unlisted local function such as `bdag-economy`.

## Stop conditions

Stop before mutation if any of these occurs:

- actor, triggering actor, repository, workflow ref, SHA, or main differs;
- baseline or policy digest is candidate, unknown, or mismatched;
- Environment reviewer, self-review, branch, ID, or bypass differs;
- the approval is missing, duplicated, rejected, bypassed, historical, or for
  another attempt;
- automatic-deploy evidence is stale, future-dated, mismatched, or not
  specifically owner-confirmed;
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

For C2 `plan_only` and `gate_proof`, record:

- the before/after project health;
- unchanged migration inventory and latest migration;
- unchanged Edge function versions and source hashes;
- unchanged cron/security inventory;
- unchanged Premium Finance policy;
- complete finance reconciliation with zero C2-attributed BDAG movement;
- no new production deployment attributable to the workflow;
- exact GitHub run ID, run attempt, Environment ID, approval comment, SHA,
  manifest digest, and evidence digest; and
- unchanged worktree count, stashes, B5 source, and ROADMAP.

Only this evidence can support a C2 cutover conclusion. It does not authorize a
functional release.
