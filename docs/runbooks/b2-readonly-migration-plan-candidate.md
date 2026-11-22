# B2 read-only migration plan candidate

## B2-R5-C1 corrective checkpoint (supersedes the status section below)

This checkpoint is local-only on `codex/web-control-centers-b2-r5-c1`. It is
based on remote main `f92f8cbc6b2cdffc2e7688a95545d4b69bdbf56c` and the
reviewed R2 candidate `231eb776ace92407ef7d0709c195b548bef5e59f`. The focal
corrective code and tests are committed locally through
`e70ce5e71b081a11718ae0c32369060643aa144f`. No branch has been pushed, no PR
has been opened, and no release or productive mutation has occurred.

Node 24.21.0 is the validated runtime. Cron reconciliation no longer attempts
to transfer `pg_cron` ownership and has been exercised against real pg_cron
1.6.4 with the hosted-equivalent `postgres` role (`NOSUPERUSER`, `BYPASSRLS`).
The protected release path now produces migration and Edge-function attempt
proofs through the same private runtime and retains only the exact ordered
public prefix. Historical Edge recovery binds the authenticated function
bundle digest, version, status and JWT setting before any recovery mutation.

New releases also require a private Vault/Edge parity attestation for the fixed
`call_dispatch_secret` and `CALL_DISPATCH_SECRET` bindings. The attestation is
checked after the protected provider read and before dispatch; historical
recovery envelopes remain readable but cannot authorize a new operation. This
repository contains only the contract and tests, not productive parity
evidence or secret material.

The 17-member local closure is regenerated from exact Git blob bytes with root
`86136f8847b061af9277eaf35c77dc33a233d3cebb16ed4141fd847472eb736f`.
The public descriptor remains `state=candidate`, `release_ready=false`, with
null reviewed/integration/private-authority pins. B2 is not deployed: its SQL,
Edge worker and cron remain pending. The next permitted action after final
local tests and independent review is a separately authorized protected
integration; authority issuance and production release remain separate gates.

The earlier status and progress notes below are retained only as historical
chronology and do not override this checkpoint.

## Current integration status

The current deliverable is the isolated branch
`candidate/b2-explicit-linux-integration-20261118`, based on remote main
`f92f8cbc6b2cdffc2e7688a95545d4b69bdbf56c`. Earlier progress entries below
are chronological notes, not the current authorization state. The protected
workflow wiring is implemented locally, but nothing has been committed,
published, issued or deployed by this integration task.

PRs #134-137 are preserved, including the renewed public descriptor and the
separate read-only diagnostic. No services/media or productive Supabase files
are changed. The old worktree is retained as WIP and must not be published in
place of this reconciled integration. Candidate parser tests now use a frozen
historical public fixture; an explicit approved-descriptor test still rejects
execution without private authority. Recovery stdout's undefined-variable
regression was fixed with a red-to-green status-rendering test.

Final isolated integration verification on 2026-11-18: 901 tests, 897 passed,
0 failed, 4 expected opt-in skips (QA-C3 capture, two F3 PostgreSQL checks,
and F4 PostgreSQL facts). Candidate descriptor and compiler negatives use the
byte-exact historical fixture; approved metadata still cannot authorize execution
without private authority. Independent review confirmed the fixture-only changes
preserve assertions. Windows Node 24.11.1 was tested here, not the protected
Ubuntu runner with Node 24.21.0. No production validation is implied.

The repository exposes an R2 authority reader (HEAD/GET), not a verified issuer.
`publishVerification` writes a local proof file, not an R2 object. Identifying
and validating the authorized issuer remains a release blocker. Do not use
fixture hashes as protected pins or issue broader write credentials to proceed.


Local candidate only. NOT an active release gate. No production calls.

The pure planner accepts supplied migration bytes, ordered ledger rows, manifest, approved SHA, project ref and explicit migrations-enabled state. It accepts no credentials and performs no filesystem, network or subprocess operations. Output deliberately cannot satisfy the existing CLI dry-run parser and states deployment_authorized=false.

## Semantics

Default Supabase CLI v2.120.0 two-pointer pending reconciliation for valid unique ordered 14-digit Nelyon inventories. Stricter input validation rejects duplicates, disabled/unknown migrations, invalid names and manifest mismatch. No include-all, roles, seeds or vault. Digests bind supplied local bytes, remote versions and full manifest. They do NOT authenticate origin, completeness, freshness or Git membership of supplied input.

## Integration still required

1. Capture ledger through existing snapshot adapter fixed database/query/read-only transport, preserving authentication, timeout, response validation and redaction. No arbitrary SQL or URL inputs.
2. Read complete tracked migrations from approved Git object, not unverified working tree. Validate repository, config and manifest provenance through existing authority checks.
3. Bind project, timestamp, workflow/run, artifact, manifest and approved SHA. Enforce freshness and anti-replay.
4. Add explicit new evidence type with reviewed gate/authorization updates. Never disguise this output as CLI JSON or reuse unchanged gate-proof.
5. Differential-test pinned upstream pure algorithm over accepted domain, transport failures/tampering/replay, and protected workflow integration. Independent review and aggregate tests remain necessary.

## Application remains blocked

Token-only linked db push in CLI v2.120.0 can create a temporary login role and delete network bans on repeated pooler failures. Dry-run does not bypass this resolver. Do NOT run either linked path under no-network/no-credentials-change constraints. Fixing validation alone does not fix application.

Future application needs independently reviewed credential/connection resolution without automatic unban, or a separately reviewed executor preserving transactions and migration-ledger semantics. Neither is implemented here. Arbitrary SQL POST is not a migration executor substitute.

## Verification

Focused test: node --test tests/nelyonB2ReadOnlyMigrationPlan.test.mjs (21 passed).
Syntax: node --check scripts/nelyon-b2-readonly-migration-plan.mjs (passed).
Root package has no npm test script. Attempted npm command was blocked by registry access policy. Existing gate suite was attempted but tooling reported blocked Visual Studio telemetry network access; no completed suite result available. Focused checks are not a full project pass.

## Explicit-connection alternative (second local candidate)

`scripts/nelyon-b2-explicit-connection.mjs` exercises a separate option: token authentication creates a temporary role, then CLI uses a password-free explicit DB URL and child-only PGPASSWORD. It reuses the existing dry-run manifest verifier rather than replacing it with the pure planner. The role creation is a remote mutation and has NOT been performed.

Concrete bounded HTTP/execFile adapters are now provided and tested only with mocks; no CLI entrypoint or live workflow invocation is provided. Transport, execution and protected-context verifier must be injected; tests use mocks only. The workflow was not edited. The context callback is an integration contract, NOT proof of authority. Wiring it to a callback that simply returns true would bypass required gates and is forbidden.

The candidate fixes the direct host to the project's db hostname, requires verify-full TLS, strips all inherited environment from the execution specification, does not give the PAT to the CLI, does not return child output for apply, sanitizes exceptions and performs no retries/fallback/bans requests. Direct IPv6 reachability and server certificate trust remain untested. Do not disable certificate validation or switch hosts on failure.

Before live use: implement bounded HTTP and subprocess adapters; preserve all workflow gates and independently validate their evidence; verify CLI executable/version, immutable migration workdir and no .env files; enforce remotes/base config equivalence, CA trust, clean HOME/PG variables and config resolution; bind/check approved manifest and receipts immediately before every mutation. Add real disposable-database integration tests and full protected workflow tests. No active apply capability is installed by this candidate.

Focused mock checks: 11 wrapper tests plus 21 planner tests passed. Syntax check passed. No live token, login role, database connection or production API used.

Independent review: the protected caller must close TOCTOU between authority verification, role minting and execution, and provide a hermetic workdir excluding .env* and CLI project-env overrides. PGPASSWORD-only child environment does NOT alone prevent project .env loading. The concrete executor must pin absolute executable and verify digest. Apply complete=true means subprocess exit status 0 only, NOT independent production post-verification. Existing postchecks are mandatory. Added mock assertions for shell/redirect/time/output bounds, failed context, invalid role responses and credential-bearing successful output. All remains disconnected from the workflow.

## Local hermetic hardening and authority boundary

Added `nelyon-b2-hermetic-workspace.mjs`: materializes a fresh local directory from exact byte/hash inputs; copies the executable under an absolute path and checks its supplied SHA-256; accepts only migrations and the current functions-only config domain; rejects remotes, env expressions, extra files/directories, symlinks and subsequent byte changes. The creator returns an opaque in-process handle. `runB2HermeticConnection` rechecks that handle around authority verification and immediately before execute. Authority verification is repeated after role minting. This reduces asynchronous mint/revalidation races, but cannot defend a compromised same-user runner replacing bytes between the last check and OS exec. The runner's isolation and trusted caller remain requirements. Input digests must originate from approved source/pins, not be computed from untrusted files and accepted by the same caller.

Fixture: `tests/fixtures/nelyonB2ExplicitConnectionClosureCandidate.json` is explicitly fixture_only and deployment_authorized=false. It records the extended current dirty-worktree closure and new member digests; it is NOT a protected pin or production authority. The compiler and inline bootstrap were subsequently extended locally from 15 to 17 members; tests reject the old member set. Never publish this fixture as authority.

### Required next sequence (not performed)

1. Finish transport and executable adapters and their disposable integration tests. Explicitly ensure bounded IO, no ambient credentials/project env, CA verification and no telemetry secret leakage. Preserve immutable source/manifest checks and postchecks.
2. Independently review the workflow replacement for BOTH dry-run and apply, retaining gate-proof, snapshots/backups, private authority revalidation, receipt comparisons and cleanup. Include new executables/modules in the closure module AND independent inline bootstrap member lists. Existing closure tests enforce byte equivalence of those independent contracts.
3. Freeze approved source SHA and exact reviewed runtime bytes. Build/verify new closure offline using `buildPrivateRuntimeClosureFromExactBytes`, never current mutable checkout authority. Pin the real CLI distribution digest from an independently verified official artifact; fixture executable hashes are not usable.
4. Obtain fresh real backup/advisor/catalog observations and specific release approval. `parseB2PrivateAuthority` requires matching issuedFor SHAs, public contract hash, completed physical-backup evidence and unexpired approval/backup windows (backup no more than 24h from insertion). Do not reuse November 17 receipts or timestamps.
5. Generate matching descriptor/private-authority bytes and exact hashes using the reviewed schema and `createReleaseAuthorityContext`; verify independently. The repository provider is a reader, not an identified issuance/publishing command. No verified issuance CLI was found, so an exact publishing command cannot honestly be supplied here.
6. Authorized publisher would store immutable content-addressed JSON under the R2 provider's internal/release-authority/v1/sha256/<digest>.json layout, then verify readback. Update protected descriptor, authority, runtime-closure and policy pins consistently only through an explicitly authorized security-sensitive configuration change. Requires scoped object-write permission and protected-environment administration, not the read-only runtime credential. Do not grant broad persistent access to enable this.
7. New protected run creates fresh receipts and gate evidence. Fail closed on absent/inconsistent pins, expired authorization or changed bytes. Only a separately authorized production execution may create a temporary role or apply migrations; this task does neither.

Current verified local checks: 55 candidate tests and 20 existing runtime-closure tests passed. No real binary ran, no remote API was called and no workflow/protected variable/R2 object was changed.


## Latest stabilized result

The local closure module and independent workflow bootstrap now both bind 17 members, adding the explicit-connection and hermetic-workspace modules. Only two member-list lines were added to the already modified workflow; existing dry-run/apply commands and guards were NOT replaced. Existing work was preserved. The synthetic known-answer closure digest in tests was updated from the independent expected 17-member calculation, not from a production pin.

The missing-executor bug found in review is fixed: all original adapters must be functions before any request; regression test observed one simulated mint before the fix and zero after it. Fixture hashes were regenerated after that fix. Final focused aggregate: 76 tests passed (including the 20 existing runtime-closure tests), no failures. The full project suite remains unverified.

Protected production still has its old externally configured closure pin. Do not publish or run this local workflow until the new closure has been reviewed and the authority/pins updated through the authorized process above. No external pin, authority object, receipt, credential or production resource was changed. Approved provenance inputs and protected workflow invocation remain unfinished; local closure membership alone does not authorize their execution.


## Concrete adapters and protected bridge

`createB2HttpAdapter` now implements the fixed login-role request with redirect rejection, a 15-second abort signal and a 64-KiB streamed response limit. It returns only validated role/password in memory, hides errors and does not retry. `createB2Executor` implements execFile using the verified absolute workspace executable, exact argv allowlist, child-only PGPASSWORD, no shell, hidden Windows window, 120-second timeout and 1-MiB output cap. Tests inject fetch/execFile; neither real adapter has been invoked against a service or real binary.

`runB2ProtectedMigration` joins the connection to the EXISTING `executeB2ProtectedMutation` primitive without changing its checks or proof writer. A simulated integration test validates expired authority causes zero requests and protected proof exists before the simulated role request. The caller is still the trusted runtime: it must supply independently authenticated operation/closure inputs and a real fresh verifyContext, and must preserve pre-snapshot/dry-run/postcheck workflow ordering. This bridge is not a CLI route and is not wired into the workflow yet.

Broader testing found six failures in recovery tests. Cause was demonstrated: the compiler's THIRD exact member list `B2_RUNTIME_CLOSURE_PATHS` still had15 entries after the closure module/bootstrap moved to17. Added the same2 members there, preserving other edits; did not relax schema or alter fixture data. Complete snapshot/recovery suite then passed27/27. Temporary fixture diagnostics were reverted. Current adapter/closure/planner aggregate passed93/93 and syntax passed. This is not a full repository-suite pass.

## Current hardened adapter result

HTTP success is now strictly201 per the published login-role API contract (Beta, database:write).200 is rejected. Protected bridge no longer trusts a caller's generic verification boolean: it calls `verifyB2ProtectedReleaseMutation` with a fresh protected clock before and after role creation, checking the existing gate, bound backup, descriptor/authority receipts and expiry. The entire local config+migration inventory is authenticated against the approved Git commit using replacement-disabled, lazy-fetch-disabled local Git reads; every blob and path must match, not just pending manifest entries. Extra unapproved files reject before role mint. Pending migration hashes also match the manifest.

Before apply the bridge runs an exact JSON dry-run in the same rechecked workspace and verifies it against the manifest, then revalidates source bytes and current authority again. An extra pending migration rejects before apply while legitimate already-applied history remains available to CLI. Input Git repository, approved manifest/identity, protected pins and clock must still originate in the protected runtime, not candidate JSON. TLS/CA/IPv6 and the actual official CLI artifact have not been tested remotely.

Latest completed focused aggregate:126/126 tests passed. Broader169-test release-gate suite completed168 pass/1 fail: 'release path revalidates before secrets and before every mutation'. This is a real pre-existing WIP order problem: initial revalidation/verify-gate fetch function inventory with PAT before authorization gate. Removing only this task's2 workflow closure lines yields identical failing indices. It is being addressed separately by splitting no-PAT preflight from authorized live refresh, not by relaxing the invariant.

A timeout/kill/nonzero during apply leaves database state potentially indeterminate. Never automatically retry; re-read ledger and perform required postchecks under fresh authority first. No live role, connection or deployment has been attempted.

## Latest local integration checkpoint (supersedes earlier counts/status)

The no-PAT preflight/authorized-refresh split has been implemented and its release-gate suite subsequently passed. A later real-CLI review found that preflight-release and authorize-refresh were missing from the CLI action allowlist even though direct-controller tests passed. This fail-closed parser defect and the actual workflow/controller bridge are being addressed together. Earlier aggregate passes do not establish end-to-end workflow readiness.

The executor now isolates HOME, USERPROFILE and XDG_CONFIG_HOME in an empty managed workspace directory and rejects missing or injected contents before launch and unexpected writes after execution. Compatibility with an actual official CLI invocation remains untested; legitimate CLI writes can fail closed rather than silently expanding the allowlist.

readApprovedMigrationFiles reads the complete config/migration inventory from an explicitly approved local Git commit, validates blob identities, allowed paths and configuration, and returns exact committed bytes plus SHA-256. Dirty working-tree bytes are not used. runB2ProtectedDryRun uses the full protected gate, backup and fresh authority checks plus complete Git provenance, revalidates around role creation and after execution, and does not advance the migration-stage proof. Its role creation still requires mutation authorization despite SQL dry-run semantics.

Latest focused execution for explicit connection, concrete adapters and snapshot/recovery:72 tests passed,0 failed. Two new targeted tests were observed failing before implementation and passing afterward: committed Git reader and protected standalone dry-run. Controller/workflow integration remains in progress; no live adapter, production role, connection, authority issuance or deployment was performed. Full recovery coverage for later function mutations remains a separate boundary; a migration proof alone does not establish those stages.

## Local Windows CLI compatibility check (2026-11-18)

The cached official npm package `@supabase/cli-windows-x64` 2.120.0 contains
`supabase.exe` and `supabase-go.exe`. The former handles `db push` without the
latter present. The tested executable SHA-256 was
`1cbedd6e494581a1c1d90113660113a06798d9967d19c857127b66b8a428e836`.
This is local evidence, NOT an approved production binary pin or Linux artifact.

Real `db push --dry-run --output-format json` was exercised only against
`127.0.0.1:1`, with a synthetic password and no access token. It returned the
expected connection refusal; no database migration was performed. The isolated
binary had no sibling executable. The child environment contained exactly the
seven executor keys: PGPASSWORD, HOME, USERPROFILE, XDG_CONFIG_HOME, DO_NOT_TRACK,
SUPABASE_NO_UPDATE_NOTIFIER, and SUPABASE_TELEMETRY_DISABLED.

The opt-out flags prevent the CLI's configured telemetry sender and update
notifier, but its db-push finalizer still writes legacy telemetry state. An empty
HOME after execution is therefore not a compatible contract. The workspace now
preseeds disabled state with ephemeral workspace-generated device/session IDs.
Only `home/.supabase/telemetry.json` is allowed: <=512 bytes, strict UTF-8 without
BOM, canonical JSON, exactly five fields, enabled=false, schema_version=1,
unchanged IDs, and ISO timestamp bounded by creation time and the current clock.
Symlinks, junctions, hardlinks, extra files/fields and identity changes are rejected.
The metadata has no role in approval, authorization, migration selection or logs.

The real loopback run retained disabled state and both IDs; the final workspace
verification passed. This does not prove successful database execution, remote
TLS/CA compatibility, absence of every possible network packet, Linux binary
compatibility, or production readiness. No security/network permissions were
changed. Production remains blocked pending those separate validations.

## Linux executable provenance and local TLS verification (2026-11-18)

Pinned setup-cli action `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359`
installs the npm package and adds `node_modules/.bin` to PATH. Its `supabase`
entry is a JavaScript symlink, not the executable to copy. The two migration
stages now resolve the fixed `@supabase/cli-linux-x64/bin/supabase` sibling,
verify package name/version, ELF64 little-endian x86-64 header and the independent
protected SHA, and reject redirected parents/binary links. The shim is only a
locator and is never executed by this resolver. Materialization rechecks digest.

Official release tar SHA256:
`7074584113aa00495beeac661c41fb09f1ddd0a483cd7333894b0d080086dc6e`.
Official checksums file SHA256:
`21a47d8e7bafd4e5fd18126e80b56f769ba395448aef1273c045f6f962251b7f`.
The official npm `@supabase/cli-linux-x64@2.120.0` package integrity and registry
signatures were verified. Its executable is identical to the release executable:
`e4e5d910546d7eda3bc3c63affce09a12b9954a00685dce5236080cd45f43eda`.
This digest is evidence for review, NOT an emitted or updated protected pin.

Real binary tests on Debian 13 x86-64, with no sibling executable, exact seven-key
child environment and synthetic loopback server: version 2.120.0; untrusted TLS
certificate rejected; explicit local CA via test-only DSN accepted through TLS
and PostgreSQL startup before authentication; hostname mismatch rejected. The
four runs retained only disabled, schema-valid telemetry metadata and stable IDs.
No production host, credential or database was used. This does not establish
Ubuntu 24.04 Actions runner equivalence or successful migration execution. The
production DSN/allowlist was NOT expanded to include the test CA parameter.

Sources:
- https://raw.githubusercontent.com/supabase/setup-cli/45a513f8c64c0bc8e0e3dfe572b5c95be85f6359/src/main.ts
- https://github.com/supabase/cli/releases/tag/v2.120.0
- https://github.com/supabase/cli/releases/download/v2.120.0/checksums.txt
- https://registry.npmjs.org/@supabase%2fcli-linux-x64/2.120.0

Before any release: review and integrate exact code; validate on the real runner
without production access; independently compute the final closure from committed
bytes; regenerate reviewed descriptor and authority against exact SHAs and fresh
backup/advisor/approval; publish only through authorized protected issuance and
readback; obtain action-specific authorization for protected pin/security changes.
Then produce a new plan and receipts and pass the protected gates. The fixture
JSON and this document must never serve as authority. No verified issuance command
has been identified, so publication remains a separate explicit blocker.

The final workspace/resolver module was transferred PC-to-cloud and byte-verified
(SHA256 `edade583786bd949f2faeff27b5a1da860cf6425409b7961b99401ac3476b0d9`).
With the official npm package layout on Linux, it resolved the expected ELF without
executing the shim, materialized the real isolated workspace, and accepted its
post-loopback-refusal state. Incorrect digest and direct shim/ELF paths were
rejected. The final local aggregate completed 373 tests:372 passed,0 failed,1
QA-C3 opt-in skipped. Six later-added resolver-indirection cases were independently
covered by resolver16/16 and auditor52/52 (resolver plus workflow). No remote pins,
authority object, workflow run or production state was updated.
