# Nelyon Production Release Gate Design

Date: 2026-10-09
Status: Owner-approved conversational design; written specification pending owner review
Repository: `andressan101989/ClipDAG-9bh0w4-26004-20260525`
Initial base: `origin/main` at `d02dda37e34493bc73b9f3b34fcd4874ef212911`

## Intent

Nelyon will have one production release authority for Supabase. An ordinary
push to `main` must not deploy migrations or Edge Functions. A production
change must instead pass a manually requested GitHub Actions workflow that
binds one exact commit, one exact manifest, one owner identity, one protected
Environment approval, and successful postchecks.

The current single human owner is `andressan101989`. The `production`
Environment therefore requires that user as its reviewer with
`prevent_self_review=false`. This is deliberate single-owner approval, not
independent two-person review. Technical controls compensate by failing
closed on identity, SHA, baseline, manifest, configuration, reproducibility,
cutover evidence, secrets, concurrency, and postchecks.

This design does not authorize a functional production release. It authorizes
the release gate foundation, its non-mutating proofs, and the controlled
cutover from Supabase's automatic production deployment to the manual gate.

## Verified Starting State

- Workspace: `C:\creator-premium-b1-main-integration`.
- Branch: `codex/creator-premium-b5-creator-management-ux`.
- Local HEAD, `origin/main`, and the remote B5 branch all resolve to
  `d02dda37e34493bc73b9f3b34fcd4874ef212911`.
- The worktree is clean, `git diff --check` passes, 125 worktrees remain
  registered, and the existing stash is untouched.
- GitHub `main` has no branch protection and no ruleset.
- No GitHub Environment named `production` exists.
- Existing workflows are `algo6-model-train.yml` and
  `bdag-monitor-cron.yml`; neither is a Supabase release authority.
- Supabase project `aewwdlvbwpczqyvkwvvj` is `ACTIVE_HEALTHY`.
- Production has 336 migrations. The latest is
  `20261009021414_creator_premium_b5_creator_management_ux`.
- Production has 34 active Edge Functions. The repository has 35 local
  function directories and 17 explicit function declarations in
  `supabase/config.toml`.
- `bdag-economy` exists locally but is neither proof of a remote deployment
  nor authorization to deploy it.
- No `deno.lock`, `deno.json`, `deno.jsonc`, or `import_map.json` exists.
- `https://esm.sh/@supabase/supabase-js@2` is a floating dependency used by
  multiple functions.
- Premium Finance remains disabled:
  `purchase_enabled=false`, `subscription_enabled=false`,
  `refunds_enabled=false`, and `platform_fee_bps=0`.
- Supabase's GitHub integration remains connected and its automatic
  production deployment is the known current production authority.

## Scope

The implementation is limited to:

- `.github/workflows/nelyon-production-release.yml`
- `.github/nelyon-production-release-policy.json`
- `scripts/nelyon-production-release.mjs`
- `tests/nelyonProductionReleaseGate.test.mjs`
- `docs/runbooks/nelyon-production-release.md`
- this specification; and
- the corresponding implementation plan.

The implementation must not modify application code, the roadmap,
`supabase/migrations`, `supabase/functions`, runtime imports, financial
logic, UI, Figma, or production data. It must not create a clone, worktree,
branch, local dependency installation, or parallel deployer.

## Selected Architecture

One `workflow_dispatch` workflow orchestrates a standard-library Node.js
policy compiler. The compiler owns validation and manifest semantics; the
workflow owns GitHub orchestration, checkout, artifact transfer, Environment
gating, and explicitly authorized deployment commands.

The workflow has two principal jobs:

1. `plan` runs without the `production` Environment and without Supabase
   credentials. It validates the request and repository state, generates the
   canonical manifest, publishes its digest and readable summary, and exposes
   only non-secret outputs.
2. `deploy` depends on `plan`, references the `production` Environment, and
   runs only for `gate_proof` or an eligible `release`. It revalidates every
   security boundary after approval. `gate_proof` terminates without loading
   or invoking Supabase deployment commands. `release` may mutate production
   only when every release gate passes.

`plan_only` never schedules `deploy`. A zero-resource manifest returns
`NO PRODUCTIVE CHANGES` and never schedules a release mutation.

## Workflow Interface

The workflow trigger is exclusively `workflow_dispatch`. It has no `push`,
`pull_request`, `schedule`, or `workflow_run` trigger.

Required inputs are:

- `approved_sha`: exactly 40 lowercase or uppercase hexadecimal characters;
- `release_id`: 8–80 characters from `[A-Za-z0-9._-]`, beginning and ending
  with an alphanumeric character;
- `scope_confirmation`: one of the exact confirmation contracts below; and
- `mode`: `plan_only`, `gate_proof`, or `release`.

Confirmation contracts are:

- `plan_only` requires `PLAN_ONLY`.
- `gate_proof` requires `GATE_PROOF_NO_MUTATION`.
- a standard `release` requires `RELEASE_STANDARD`.
- any high-risk `release` requires `RELEASE_HIGH_RISK`.

The Environment approval approves the exact manifest and digest displayed by
`plan`. The confirmation input arms only the corresponding risk class; it
never expands the manifest.

The workflow run name includes the mode and release ID. Reuse of a release ID
found in retained workflow history or release artifacts is denied. Even if
GitHub retention no longer exposes an old identifier, baseline advancement,
the policy's last successful release ID, the exact SHA check, and an empty
delta prevent a completed release from mutating production a second time.

## Identity and Re-run Protection

Every mode requires repository identity
`andressan101989/ClipDAG-9bh0w4-26004-20260525`.

`plan` and `deploy` both require:

- `github.actor == "andressan101989"`; and
- `github.triggering_actor == "andressan101989"`.

The second comparison is mandatory because a re-run can have a different
triggering actor while using the original actor's privileges. Any mismatch is
`DENY — UNAUTHORIZED ACTOR`.

## Exact SHA Contract

`plan` fetches `origin/main` without changing the worktree and requires:

1. `approved_sha` parses as a full SHA;
2. the object exists and is a commit in this repository;
3. `git merge-base --is-ancestor <baseline> <approved_sha>` succeeds;
4. `approved_sha == refs/remotes/origin/main`; and
5. the workflow itself was dispatched from `refs/heads/main` at that SHA.

The artifact records the remote main SHA observed by `plan`. After Environment
approval, `deploy` fetches `origin/main` again and repeats all checks. A main
movement, different commit, changed baseline, or different repository denies
the run before a Supabase command is constructed.

## Release Policy File

`.github/nelyon-production-release-policy.json` is the machine-readable
authority for invariant configuration. It contains:

- schema version;
- repository owner/name;
- authorized actor;
- Supabase project reference;
- Environment name;
- allowed workflow modes and confirmations;
- managed function names taken only from explicit `supabase/config.toml`
  declarations;
- forbidden local-only functions, including `bdag-economy`;
- high-risk resource patterns;
- required secret and Environment variable names, never values;
- pinned tool and action identities;
- candidate or verified baseline evidence;
- cutover evidence state; and
- the last successful release ID and manifest digest once a release exists.

The initial baseline state is `candidate`. `release` is denied while either
the baseline or cutover evidence is not verified. `plan_only` and
`gate_proof` remain available because they cannot mutate Supabase.

The workflow has `contents: read` and never edits the policy. After a future
successful production release, the next release remains denied until the
owner reviews the postcheck evidence and advances the policy baseline in a
normal protected Git commit. That commit records the successful source SHA,
release ID, manifest digest, and evidence digests. The owner must then update
`NELYON_RELEASE_POLICY_SHA256` to the reviewed policy digest. This deliberate
manual checkpoint prevents a workflow from promoting its own authority.

Changing the policy is itself a security-sensitive governance change. Such a
change cannot authorize itself within the same run: the protected job requires
the policy bytes to match the SHA-256 stored independently in the
`production` Environment variable `NELYON_RELEASE_POLICY_SHA256`. A policy
change therefore remains denied until the owner reviews it and deliberately
updates that Environment variable through a separate control-plane action.

## Productive Path Classification

The compiler obtains the exact NUL-delimited Git diff from baseline to
approved SHA and classifies every changed path. Supabase productive paths are:

- `supabase/migrations/*.sql`;
- `supabase/functions/<function>/**`;
- `supabase/functions/_shared/**`;
- `supabase/config.toml`.

The release workflow, policy, helper, and runbook are governance-sensitive
paths. They appear in the manifest and raise its risk classification, but they
are not Supabase resources and never cause a deployment by themselves. This
allows the cutover commit to produce `NO PRODUCTIVE CHANGES` while still
showing the exact governance delta for audit.

Application-only or documentation-only changes outside release-control files
are recorded as non-productive. Unknown paths under `supabase/`, deletions or
renames the classifier does not explicitly support, symlinks, submodules, and
non-regular files are denied rather than ignored.

## Canonical Manifest

The manifest is canonical JSON with recursively sorted object keys, stable
array ordering, UTF-8 encoding, and a trailing newline. The SHA-256 digest is
computed over those exact bytes. The digest is not embedded inside the bytes
it hashes; it is stored in a separate digest file and workflow output.

The manifest includes:

- schema version;
- repository identity;
- workflow run and attempt identity;
- requesting actor and triggering actor;
- release ID, mode, and confirmation class;
- source SHA and baseline SHA;
- observed `origin/main` SHA;
- changed files with Git status;
- new migrations;
- directly changed functions;
- changed shared modules;
- direct and transitive shared-module consumers;
- exact effective function set;
- `supabase/config.toml` changes and old/new `verify_jwt` values;
- external dependencies and reproducibility findings per affected function;
- risk findings and overall risk class;
- exact authorized resources;
- blockers;
- no-change determination; and
- compiler version derived from the policy schema and helper source digest.

`plan` uploads the canonical manifest, digest, and human-readable summary as
one artifact whose name binds release ID, approved SHA, and run ID. `deploy`
downloads only that run's artifact, recomputes the digest, regenerates the
manifest from the freshly fetched repository, and requires byte-for-byte
equality.

## Migration Rules

Only newly added regular `.sql` files directly under `supabase/migrations`
are potentially releasable. The compiler denies:

- modified, deleted, copied, or renamed historical migrations;
- duplicate migration versions;
- filenames outside the repository's timestamped convention;
- a migration set whose order is not strictly after the verified production
  latest migration;
- a remote migration list that does not exactly equal the baseline evidence;
  or
- a CLI dry-run whose pending set differs from the manifest.

Database release is forward-only. A production correction requires a new
migration; the workflow never performs an automatic destructive rollback.

## Edge Function and Shared Dependency Rules

A directly changed function is eligible only when its exact name is declared
in `supabase/config.toml`, exists in the policy managed-function allowlist,
exists in the manifest, and is not forbidden. Local directory existence does
not authorize deployment.

The compiler parses static relative `import`, `export ... from`, and literal
dynamic `import()` specifiers. It constructs a directed graph across
`supabase/functions` and walks reverse edges from every changed `_shared`
module until all consuming functions are found. The effective function set is
the union of direct changes and transitive consumers.

The compiler denies an affected resource when it finds:

- a non-literal dynamic import;
- an unresolved relative import;
- a path escaping `supabase/functions`;
- a symlink or non-regular source entry;
- an affected function missing from `supabase/config.toml` or policy;
- a consumer graph cycle that cannot be represented safely; or
- an external dependency whose version cannot be proven immutable enough for
  the selected deployment mechanism.

The existing floating `https://esm.sh/@supabase/supabase-js@2` dependency is
reported for every affected consumer. F1 does not rewrite it. Any release
whose affected function depends on it is denied until an authorized
reproducibility correction pins and verifies that dependency.

## Configuration and `verify_jwt`

The compiler reads `supabase/config.toml` from both baseline and approved SHA.
It accepts no implicit function configuration. Adding or removing a function
declaration, changing `verify_jwt`, changing an entrypoint, or changing any
other deploy-relevant function option is high risk.

Any transition to `verify_jwt=false` is always high risk and must use
`RELEASE_HIGH_RISK`. The function still must be explicitly managed and
reproducible. Configuration the compiler cannot parse unambiguously is a
blocker, not a warning.

## Risk Model

Overall risk is the maximum risk of any manifest resource.

High-risk resources include:

- Stripe or payment code;
- webhooks;
- BDAG, ledger, wallet, or escrow code;
- finance-related migrations;
- private media and signed-media authorization;
- authentication or authorization;
- moderation and content safety;
- security policy;
- any `verify_jwt=false` function or transition;
- release policy or workflow authority changes; and
- unknown or ambiguous resources.

Unknown and ambiguous resources are blockers even with
`RELEASE_HIGH_RISK`. A high-risk classification permits owner review; it does
not override reproducibility, baseline, configuration, or drift failures.

## Modes

### `plan_only`

`plan_only` executes only the unprivileged plan job. It creates the manifest,
digest, summary, and blockers. It never references `production`, reads
Supabase deployment secrets, or runs a Supabase mutating command.

### `gate_proof`

`gate_proof` runs `plan`, then schedules the protected `deploy` job with
`environment: production`. After the owner approves it, the job verifies
Environment configuration and GitHub approval history, writes proof evidence,
and exits successfully without reading deployment secret values or invoking
Supabase. It proves the gate, not production deployment capability.

### `release`

`release` schedules the protected job only when the manifest is non-empty and
unblocked. Before any mutation it requires:

- verified baseline evidence;
- verified automatic-deploy-off evidence;
- exact Environment configuration;
- exact owner approval evidence;
- exact main SHA and regenerated manifest;
- correct confirmation class;
- non-empty required deployment secrets;
- no concurrent production deployment;
- exact remote migration and function prechecks; and
- a safe rollback or forward-correction strategy for every resource.

Failure of any requirement is `DENY` before mutation.

## GitHub Environment Contract

The `production` Environment must have:

- required reviewer `andressan101989` and no other implied reviewer;
- `prevent_self_review=false`;
- custom deployment branch policy allowing exactly `main`;
- administrative bypass disabled when GitHub supports that control;
- no wait timer required by this design; and
- only the minimum release secrets and variables.

The protected job retrieves the Environment through GitHub's REST API and
verifies the required-reviewer rule, self-review setting, branch policy, and
bypass setting. It also retrieves the workflow-run approval history and
requires an approval by `andressan101989`. API failure or insufficient token
permission is a denial.

Environment secret values are unavailable before approval. `gate_proof` does
not reference them. `release` uses only:

- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`; and
- any additional credential later proven indispensable by the pinned CLI.

No `service_role` credential is part of this design. Non-secret Environment
variables bind the project ref, gate-armed state, the approved release-policy
SHA-256, and the current automatic-deploy-off evidence identifier.

## GitHub Permissions and Supply Chain

The workflow grants `contents: read` globally and adds only job-specific read
permissions needed for Actions artifacts, workflow history, deployments, and
Environment verification. It receives no `contents: write` and cannot push,
tag, merge, or alter branch protection.

Every third-party action is pinned to an immutable full commit SHA. The
Supabase CLI version and its acquisition mechanism are pinned and verified in
the implementation plan before code is written. Floating major action tags,
`latest`, and unpinned CLI installation are forbidden.

Production deployment uses GitHub-hosted ephemeral runners. It creates no
local laptop checkout or dependency copy.

## Concurrency

The workflow uses one fixed production concurrency group with
`cancel-in-progress=false`. This prevents overlapping protected jobs. The
helper also queries active runs and denies a release when another
non-cancelled production-mode run is active. Concurrency serialization is a
safety backstop; it does not silently authorize a queued stale release.

After any wait, all SHA, baseline, manifest, approval, and remote-state checks
run again.

## Supabase Baseline Evidence

The candidate SHA is not verified merely because it equals GitHub `main`.
Verification requires a read-only evidence record covering:

- exact remote migration list and latest version;
- exact set of managed remote functions;
- remote function versions, `verify_jwt`, and source parity when Supabase
  exposes trustworthy source bytes;
- explicit documentation of remote functions not managed by this gate;
- `supabase/config.toml` parity for managed functions;
- cron inventory;
- Premium Finance switches and platform fee;
- zero Premium financial transactions at bootstrap;
- no C2-caused BDAG movement; and
- project health.

If source parity cannot be demonstrated for a managed function, that function
is marked unreproducible and is not releasable. This need not block
`plan_only`, `gate_proof`, or unrelated reproducible resources.

Verified baseline evidence records the observation timestamp, evidence
digests, migration count/latest version, function inventory digest, finance
state digest, and verifier identity in the policy. The baseline advances only
after a successful authorized release and successful postchecks.

## Automatic Deployment Cutover Evidence

Before any push containing the gate reaches `main`, the owner must disable
only Supabase GitHub Integration's `Deploy to production` setting and retain
the GitHub connection. The runbook records authenticated dashboard evidence,
timestamp, project ref, production branch, and a SHA-256 digest of the
redacted evidence.

Because no documented runtime API currently provides this project toggle to
the workflow, every `release` additionally requires a current owner
attestation in the exact scope-confirmation procedure described by the
runbook. The policy and Environment variable must identify the same cutover
evidence. Missing, conflicting, or stale evidence denies release.

The cutover sequence is strict:

1. implement and test locally;
2. configure and verify GitHub Environment and branch protections;
3. verify baseline read-only;
4. disable Supabase automatic production deployment and capture evidence;
5. recheck `origin/main`;
6. push only the approved fast-forward commit or use the protected PR flow;
7. prove no automatic Supabase deployment started; and
8. run `plan_only` and `gate_proof`, never `release`.

## Deployment Semantics

The implementation must discover the pinned Supabase CLI interface using
`--help`; it must not guess flags. The intended release semantics are:

1. capture a read-only production snapshot;
2. compare remote migrations and functions to verified baseline evidence;
3. run a migration dry-run and require its exact pending set to equal the
   manifest;
4. apply only the manifest's forward migrations;
5. deploy functions one at a time by exact manifest name, never with bulk or
   prune behavior;
6. preserve each manifest function's verified JWT configuration;
7. run resource-specific postchecks; and
8. mark success and advance baseline authority only after every postcheck.

No command may infer extra functions, prune remote functions, deploy
`bdag-economy`, redeploy `bdag-ledger` without explicit authorized manifest
scope, or perform destructive database rollback.

## Postchecks and Failure Handling

A release is successful only when all applicable checks pass:

- remote migration set equals baseline plus manifest additions;
- each deployed function exists at the expected version/source state and no
  unlisted function changed;
- project remains healthy;
- cron inventory is unchanged unless explicitly authorized;
- Premium Finance remains disabled unless a future release explicitly and
  separately authorizes a change;
- financial transaction counts and BDAG invariants match predeploy evidence;
- automatic GitHub integration deployment remains off; and
- no unexpected deployment appears.

A failed postcheck produces workflow failure and never advances the baseline.
Edge rollback means redeploying a previously approved, reproducible source
artifact or commit through a new authorized release. Database recovery is a
new forward corrective migration. The workflow performs no automatic
destructive rollback.

## Branch Protection and Single-Owner Operation

After the gate commit is present on `main`, branch protection must require a
pull request while requiring zero approving code reviews, enforce protection
for administrators when operable, require conversation resolution, require
linear history, and block force pushes and deletion. This preserves a usable
single-owner flow without pretending a second reviewer exists.

No CODEOWNERS rule is introduced. Workflow and policy changes remain high
risk in the release manifest and require the protected production approval
before they can affect a later production release.

## Test Strategy

The helper is tested with Node's built-in `node:test` and temporary Git
repositories. Tests use no production credentials and execute no deployment.
The suite must prove:

1. malformed SHA is denied;
2. a commit outside the authorized main lineage is denied;
3. a stale SHA is denied;
4. changed main after planning is denied;
5. unauthorized actor is denied;
6. unauthorized triggering actor on re-run is denied;
7. wrong repository identity is denied;
8. unknown or candidate baseline denies release;
9. altered manifest or digest is denied;
10. reused release ID is denied;
11. an empty productive delta returns `NO PRODUCTIVE CHANGES`;
12. altered, deleted, renamed, duplicate, or out-of-order migrations are
    denied;
13. an undeclared or forbidden function is denied;
14. direct and transitive `_shared` consumers are included;
15. ambiguous or escaping imports are denied;
16. floating dependencies deny affected function release;
17. finance without high-risk confirmation is denied;
18. a `verify_jwt` change is high risk;
19. missing secrets deny release but not `gate_proof`;
20. incorrect Environment reviewer, branch policy, bypass, or self-review
    setting is denied;
21. missing approval history is denied;
22. post-approval SHA or manifest drift is denied;
23. concurrent release is blocked and stale state revalidated;
24. failed postcheck cannot produce success or baseline advancement;
25. `plan_only` cannot reach mutating code;
26. `gate_proof` cannot reach mutating code or secrets; and
27. `release` without every authority is denied.

Workflow verification additionally checks YAML parsing, trigger exclusivity,
minimal permissions, immutable action pins, Environment use, concurrency,
artifact provenance, secret references, and the absence of push-capable or
automatic triggers.

## Cutover Proof

The cutover does not execute a functional release.

`plan_only` runs against the approved main SHA and verified baseline. With no
productive delta it must report `NO PRODUCTIVE CHANGES`.

`gate_proof` must:

1. complete `plan` without Supabase secrets;
2. enter the waiting-for-review state for `production`;
3. be approved by `andressan101989` through GitHub Review deployments;
4. verify Environment configuration and approval history;
5. continue only after approval;
6. produce proof evidence; and
7. exit without any Supabase mutation.

Before and after both proofs, migration count/latest migration, Edge Function
versions, cron state, Premium Finance policy, financial counters, and BDAG
invariants must remain unchanged.

## Operational Documentation

The runbook will cover:

- safe Environment and branch-protection configuration;
- minimum secret names without values;
- candidate-to-verified baseline evidence procedure;
- automatic-deploy-off cutover and evidence capture;
- dispatch inputs and exact confirmation strings;
- interpreting plan blockers and high-risk findings;
- approving or rejecting the protected job;
- non-mutating `plan_only` and `gate_proof` procedures;
- future authorized release and postcheck procedure;
- Edge rollback and forward-only database recovery; and
- emergency stop conditions.

## External Platform References

- GitHub deployment environments and required reviewers:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- GitHub deployment review procedure:
  <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments>
- GitHub Environment REST representation and configuration:
  <https://docs.github.com/en/rest/deployments/environments>
- GitHub workflow-run approval history:
  <https://docs.github.com/en/rest/actions/workflow-runs>
- GitHub triggering actor semantics:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/variables>
- Supabase GitHub integration management:
  <https://supabase.com/docs/guides/troubleshooting/managing-or-disconnecting-github-oauth-connections-e3dc3b>
- Supabase branching deployment troubleshooting:
  <https://supabase.com/docs/guides/deployment/branching/troubleshooting>
- Supabase Edge Functions and CLI changelog:
  <https://supabase.com/changelog?tags=edge+functions>

## Acceptance Criteria

Implementation and cutover are complete only when:

1. the specification and implementation plan have owner approval;
2. the seven authorized repository artifacts exist and all tests pass;
3. the workflow trigger is exclusively manual;
4. `plan` has no production Environment or Supabase secrets;
5. `deploy` cannot start before the configured owner approval;
6. `plan_only` and `gate_proof` prove zero production mutations;
7. `release` is fail-closed on every authority and reproducibility control;
8. the baseline is verified with auditable read-only production evidence;
9. Supabase `Deploy to production` is demonstrably off before main changes;
10. the GitHub integration remains connected without automatic production
    authority;
11. the approved commit reaches `main` without force push or unrelated files;
12. main and `production` protections match this single-owner contract;
13. no automatic Supabase deployment follows the main update;
14. migrations, Edge Functions, cron, Finance, and BDAG remain unchanged by
    the cutover and proofs;
15. no clone, branch, worktree, application change, roadmap change, B6 work,
    or dependency installation is introduced; and
16. the final audit contains exact GitHub, Git, Supabase, manifest, approval,
    and zero-mutation evidence.
