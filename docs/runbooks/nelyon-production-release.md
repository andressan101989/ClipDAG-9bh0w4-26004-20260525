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

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

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

The initial baseline is `candidate`. Equality with GitHub `main` is not enough.
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

Update `NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64` with that redacted canonical
record. Evidence is valid for at most 15 minutes and permits at most 60 seconds
of future clock skew. Renew it before every future release and every proof that
requires Environment approval. The owner must specifically confirm this fresh
evidence in the approval comment; a general or historical confirmation fails.

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
state is pending, a resource is unreproducible, or the reviewed read-only
snapshot adapter is not configured.

For a separately authorized future production release:

1. verify the exact main SHA and unused release ID;
2. renew visual auto-deploy-off evidence within 15 minutes;
3. run the plan and inspect every changed file, migration, function,
   transitive `_shared` consumer, risk, and blocker;
4. use `RELEASE_STANDARD` or, only for explicitly reviewed sensitive scope,
   `RELEASE_HIGH_RISK`;
5. paste the exact generated approval token into the current deployment
   review;
6. require post-approval revalidation before every mutation;
7. apply only exact forward migrations in the manifest;
8. deploy functions one by one by exact manifest name, never by directory or
   timestamp inference; and
9. require all remote, finance, health, cron, and security postchecks before
   success.

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

## Failure recovery and rollback

A failed postcheck is a failed release and never advances baseline authority.
Preserve the manifest, digest, exact approval, snapshots, and logs.

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
