# Creator Premium Final A2: Security Advisor Remediation and Postcheck Recovery

Date: 2026-10-17
Status: Owner-approved conversational design; written specification pending owner review
Repository: `andressan101989/ClipDAG-9bh0w4-26004-20260525`
Base: `origin/main` at `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb`
Base tree: `d7f9e8ff9b01d4a9c449511faa0786f139110b7d`
Supabase project: `aewwdlvbwpczqyvkwvvj` (`us-east-1`)
Source release run: `39066492485`
Source release ID: `nelyon-b7-autonomous-20261017T202315Z`

## Intent

Creator Premium B7 is already present in production and its twelve authorized
Edge Functions are already deployed. The source release failed only during
its final Security Advisor comparison because B7 introduced eleven new
`security_definer_view`-class fingerprints. This change will determine whether
each affected RPC is actually secure, repair any demonstrated vulnerability
with a forward-only migration, and otherwise register only exact, attested
exceptions. It will then recover the failed postcheck through the existing
release authority in a strictly read-only mode.

The successful outcome is `PREMIUM_B7_READY_FOR_PHYSICAL_QA`. It is not
`PHYSICAL_PASS`; physical-device QA remains an owner activity.

## Verified Starting Evidence

- Remote `main` is `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb` with
  tree `d7f9e8ff9b01d4a9c449511faa0786f139110b7d`.
- The applied B7 migration blob is
  `43f014260e0ecfa6f0634e61e1646594bcf13e1d`.
- Release run `39066492485` completed migration and sequential function
  deployment before its postcheck failed.
- The run's gate artifact is `nelyon-gate-evidence-39066492485-1`, artifact ID
  `12113681896`, digest
  `sha256:6413dc245e07f96266501b784313c26d241868bcefe420ae13db9aad0b16960f`.
- The run's release artifact is `nelyon-release-39066492485-1`, artifact ID
  `12113447451`, digest
  `sha256:c468111c29831e708a6f9545e3276604bc84b879a0a2a01994f1178da3b87099`.
- The original manifest digest is
  `95700e7ad2221bf113b58da0719f41feed40f76389caeba59e3457d603998045`.
- Original pre-snapshot evidence digest:
  `5866d0a628eb390ed47b21b17c0910387274a213a0d70702fd8253cc143aee38`.
- Original post-snapshot evidence digest:
  `0625cc7c5509b1c48b442fca8cab715bbbcd759ea1dc154044cc574a76cf6ad6`.
- Production has 337 migrations and B7 is the latest migration.
- Production has 34 active Edge Functions; all twelve B7 functions are
  already active with their expected `verify_jwt` contracts.
- The historical Security Advisor baseline contains 554 normalized findings.
  Its canonical cron/security digest is
  `65ea13c1598717b143bbf7f1779f729bf2b3cad05938dc4d42ae0af67a6a694a`.
- Current production contains 565 normalized findings. Comparing canonical
  identities gives exactly eleven additions and zero removals. Removing those
  eleven additions reproduces the 554-finding historical digest exactly.
- Two other B7-related RPC warnings were already present in the 554-finding
  baseline and are not new exceptions.
- A fresh independent read-only snapshot at
  `2026-10-17T20:46:54.358Z` produced evidence digest
  `f57325fba930da8cab0d053fe7f3cec71b6cfdb8b38ea88c45a4fdab73d28592`.
- Finance remains `false / false / false / 0`, with 928 transactions, 1,918
  ledger entries, 131 accounts, ten zero-anomaly reconciliations, and no
  release-attributed movement.
- Content Safety has zero approved and zero active rules.
- Legacy state remains two contents, one `pending_review`, and one `deleted`.
- Physical backup `1988056631` is `COMPLETED`, observed at
  `2026-10-17T05:15:56.590Z`.

Implementation must independently re-read these values from the GitHub API
and original artifact bytes before constructing a recovery request. A value
copied from this specification is not sufficient evidence and a prefix match
is never accepted.

## Goals

1. Exercise each of the eleven newly reported RPCs with disposable negative
   authorization tests and the corresponding positive control.
2. Classify each finding as a demonstrated vulnerability, intentional secure
   RPC, preexisting finding, false fingerprint delta, or insufficient
   evidence.
3. Correct every demonstrated vulnerability with a focal, forward-only
   migration and protected release.
4. Register an exception only for an intentional RPC whose exact definition,
   identity, ownership, configuration, ACL, and negative tests establish its
   safety.
5. Extend the canonical Snapshot Adapter to attest those properties from
   production using read-only catalog queries.
6. Extend the canonical workflow and release helper with a
   `postcheck_recovery` mode that verifies the original release and current
   state without mutation.
7. Recover the final B7 postcheck while preserving the historical 554-finding
   baseline, Finance OFF, Content Safety fail-closed, legacy data, and the
   already deployed B7 resources.

## Non-goals

- Reapplying migration B7.
- Redeploying any Edge Function whose live contract matches the original
  manifest.
- Promoting the current set of 565 findings to a new unqualified baseline.
- Ignoring all `SECURITY DEFINER` warnings or all findings of any advisor type.
- Creating another workflow, Release Gate, Snapshot Adapter, exception
  authority, backend, wallet, ledger, escrow, scanner, or financial RPC.
- Activating purchases, subscriptions, refunds, platform fees, Content Safety
  rules, publication, paid inference, or uploads.
- Modifying UI, Figma, mobile builds, or unrelated modules.

## Selected Architecture

The implementation remains inside the existing release system:

1. The release policy stores exact Security Advisor exception records and the
   historical baseline authority.
2. The existing Snapshot Adapter collects normalized advisor findings and a
   new read-only `pg_catalog` attestation for every protected RPC.
3. The existing release helper validates policy schema, exception uniqueness,
   baseline reconstruction, attestation equality, artifact provenance, and
   recovery-mode immutability.
4. The existing workflow exposes `postcheck_recovery` as an additional manual
   mode and runs only its plan and protected read-only verification path.
5. The existing runbook documents preparation, dispatch, failure diagnosis,
   and final evidence.

There is no second release path. Unknown fingerprints, changed protected RPC
properties, mismatched original artifacts, or any attempted mutation cause a
closed failure.

## Security Advisor Identity and Delta

Finding identity is the normalized canonical fingerprint, not a display name.
RPC identity is always:

`schema + function name + ordered argument types`

Overloads therefore remain distinct. The adapter must retain the advisor's
canonical fingerprint plus type, severity, schema, full signature, object
identity, and remediation metadata.

The recovery comparator computes:

1. the exact current normalized finding set;
2. the exact current set minus the policy's approved exception fingerprints;
3. the canonical digest of that remainder; and
4. equality with the historical 554-finding baseline digest.

It also requires that the current-minus-baseline set equal the approved
exception set exactly. A missing approved finding, a removed historical
finding, a changed fingerprint, or an additional unknown finding fails the
recovery. The comparator does not silently advance either baseline.

## RPC Audit Matrix

All observed definitions are owned by `postgres`, are `SECURITY DEFINER`, use
an empty `search_path`, grant execution to `authenticated`, and do not grant
execution to `PUBLIC`, `anon`, or `service_role`. These static properties are
necessary but not sufficient. Every new row remains `PENDING_NEGATIVE_TEST`
until its disposable role, ownership, capability, and invalid-input cases
pass.

| Delta | RPC signature | Fingerprint | Observed definition SHA-256 | Required authority control | Initial classification |
|---|---|---|---|---|---|
| Preexisting | `public.get_my_creator_premium_content_v1(uuid)` | `44c69807ea7e06dadbd8f841ec50a8911c25a76b28ed8096ec6fea66d129b55b` | Not an A2 exception; historical baseline authority applies | `auth.uid()` and caller ownership | Historical baseline; no new exception |
| Preexisting | `public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)` | `92d3ea284e4ee4c77be88f4a3cade83460caa098dbbc3028587388cf0158933b` | Not an A2 exception; historical baseline authority applies | `auth.uid()` and caller-owned result set | Historical baseline; no new exception |
| New | `public.admin_refund_creator_premium_purchase_v1(uuid,uuid,text)` | `ed47c5c8fd92b0a9111c500797b896e5f4adda72528447877e07d3bf7fc976f4` | `13a0a7da560d681b0b04a8505bc09eb1fe12e31cf04779be984872f926ee6d45` | authenticated administrator plus exact refund capability; Finance OFF must deny productive refund | `PENDING_NEGATIVE_TEST` |
| New | `public.admin_refund_creator_premium_subscription_period_v1(uuid,uuid,text)` | `3bafc12c90e4b6b681d940783a2f7c18f4fff412914dfe089273361e4a985a3d` | `592df071aa52e846d7034e79c61f114f00eaf49d24dccd3682536e83377439ca` | authenticated administrator plus exact refund capability; Finance OFF must deny productive refund | `PENDING_NEGATIVE_TEST` |
| New | `public.admin_review_creator_premium_content_v1(uuid,text,text,uuid)` | `818953854378a3580fa558d66b184ae7ceacac35521ce7b31c24c077cf8c5aa4` | `9d2a0fdc8982eb44b9e6e2603938649305446aaf512f4bea9f930ee192d8377f` | authenticated administrator plus exact moderation capability and lifecycle checks | `PENDING_NEGATIVE_TEST` |
| New | `public.get_admin_creator_premium_content_v1(uuid)` | `1e59a5e4beb48d63e41b8f19d6cdff3470ec18e0ca57b3d35348bd2fc0921596` | `2a91f72e122beeee0f3d3c9f59ef99f13d2aefab9bcbc987594a5ac43c40a47e` | authenticated administrator plus exact read capability | `PENDING_NEGATIVE_TEST` |
| New | `public.get_admin_creator_premium_refund_candidates_v1(uuid)` | `bd0ce992865c9e2c34a64970b0c9c0a619a0d604d0a046429ec9c030ccd3d709` | `9f35908f01a3ff9100f0fc2d562d4c2471a33bb15a54d1dbbcf754bacde9ea00` | authenticated administrator plus exact refund/reconciliation capability | `PENDING_NEGATIVE_TEST` |
| New | `public.get_creator_premium_commerce_v1(uuid)` | `00657ba374cdad7085ed6b574482e19d7fa16907edcc701c94fc18c87961edb2` | `30c9a4a75712f74d3d62a39f962f87ce98f22269dd1b46b259b1d15ef89d7e86` | authenticated caller, published-safe visibility, ownership/entitlement checks, and Finance OFF | `PENDING_NEGATIVE_TEST` |
| New | `public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)` | `4840132edacadeb572fa8fd51214941fda033da797e4d60aa6cb1bb1fd7004af` | `1a34a92abe226cdb66b3d8ba95b848d7576fe81e324839c9424582dc44610d05` | `auth.uid()`, caller-only aggregates, validated bounded dates | `PENDING_NEGATIVE_TEST` |
| New | `public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)` | `6c2cb58d906d98f9a58d63890eabe14a123dae7c93c177e131e284b720154c88` | `dddaf6f218f2abe7a24d97dfdd4fc0cb125fed5b7e2088c510bd4f8368124685` | `auth.uid()`, caller-only subscriptions, validated cursor/limit | `PENDING_NEGATIVE_TEST` |
| New | `public.reopen_my_creator_premium_rejected_v1(uuid)` | `977f751ed2fa6c2202aac797ca71df433a804b90a7c6cc667bd2813dd5c33adc` | `091cb8b2f35c9e76f515295e45310bbee9af8e6a1567d26ddfa0be34b5ceba5d` | `auth.uid()`, content ownership, rejected-only lifecycle, no unsafe publication | `PENDING_NEGATIVE_TEST` |
| New | `public.report_creator_premium_content_v1(uuid,text,text)` | `91d927799c49e43c6e0f70e789a71a58ab4d39f10c0704f9aa7bfab2e9da7bcb` | `923bce96a9cc00e71174c1aa811b791ba11710c9b370295f7474729d928d992c` | authenticated reporter, validated reason/details, visibility and idempotency controls | `PENDING_NEGATIVE_TEST` |
| New | `public.search_admin_creator_premium_content_v1(text,text,timestamptz,uuid,integer)` | `67c61f041625ca6c348fdadffed8e2a997e40e1b6a7b6e4005d7e0ca8e7f8720` | `0379d81bef4b106861b9b59962f52e480b7b48cc1205eae938f238d1fd04ece6` | authenticated administrator plus exact search/read capability and bounded filters | `PENDING_NEGATIVE_TEST` |

The two historical rows require no A2 exception record. Any future change to
their definitions remains subject to the existing baseline advancement
process rather than being silently included in this remediation.

## Negative Authorization Test Contract

The PostgreSQL disposable harness must reproduce the B7 schema and execute
each new RPC under the relevant combinations of:

- anonymous caller;
- authenticated caller without the required role or capability;
- legitimate owner;
- authenticated user other than the owner;
- administrator without the exact capability;
- administrator with the exact capability;
- invalid UUIDs, enum values, status transitions, timestamps, cursors,
  limits, text lengths, and foreign object IDs;
- duplicate retry and idempotency identifiers where the contract supports
  them;
- concurrent calls where the RPC uses locks or state transitions;
- invoked helper functions and their effective privileges;
- private-media access and cross-user access;
- publication without valid Content Safety evidence;
- Finance OFF refund and commerce behavior; and
- unauthorized reconciliation.

Every negative case must prove denial and absence of side effects. Every
positive control must prove only the intended minimum result. Production is
never used for destructive or financial test calls.

If a row fails any required negative case, it is classified as
`VULNERABILITY_REAL`; it cannot receive an exception. The correction is a new
forward-only migration that narrows grants, fixes authorization, validates
arguments, or hardens the function without editing B7. The migration must
pass the same disposable suite before a protected corrective release.

## Exact Exception Record

The existing release policy receives one record per demonstrated safe new
finding. The implementation may choose the containing property name to match
the policy's current schema style, but each record must validate the following
logical contract:

| Field | Required value and validation |
|---|---|
| `advisor_fingerprint` | Exact 64-character lowercase SHA-256 from the audit matrix |
| `advisor_type` | Exact normalized value `authenticated_security_definer_function_executable` |
| `advisor_severity` | Exact normalized value `WARN` |
| `object.schema` | Exact value `public` |
| `object.name` | Exact RPC name from the audit matrix |
| `object.argument_types` | Ordered canonical PostgreSQL type array for the complete signature |
| `object.identity_arguments` | Exact `pg_get_function_identity_arguments` output |
| `attestation.security_definer` | Exact boolean `true` |
| `attestation.owner` | Exact observed owner `postgres` |
| `attestation.search_path` | Exact canonical `proconfig` representation observed by the adapter |
| `attestation.acl` | Sorted complete ACL array, including the explicit `authenticated` grant and absence of `PUBLIC`, `anon`, and `service_role` grants |
| `attestation.definition_sha256` | Exact 64-character lowercase definition hash from the audit matrix and fresh adapter evidence |
| `authorization.functional_reason` | Non-empty RPC-specific reason why elevated execution is necessary |
| `authorization.controls` | Non-empty sorted list of the controls demonstrated for that exact RPC |
| `authorization.negative_test_evidence_sha256` | Exact 64-character lowercase digest produced by the completed disposable negative-test evidence |
| `origin.migration` | Exact value `20261010053524_creator_premium_b7_full_functional_commercial_completion` |
| `origin.migration_blob` | Exact value `43f014260e0ecfa6f0634e61e1646594bcf13e1d` |
| `origin.source_sha` | Exact value `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb` |
| `technical_approval` | Exact value `verified`, written only after all required tests pass |

The policy validator requires unique fingerprints and unique complete RPC
identities. It rejects missing properties, prefixes, wildcards, global
advisor-type allowances, duplicate records, unknown technical-approval
states, or any exception whose test evidence is absent.

Changing signature, owner, `SECURITY DEFINER`, `search_path`, ACL, function
definition, origin, or fingerprint invalidates the exception automatically.

## Snapshot Adapter Attestation

The existing adapter will add fixed, parameterized, read-only catalog SQL. It
queries only `pg_proc`, `pg_namespace`, `pg_roles`, and ACL expansion helpers
needed to produce:

- OID used only during collection, never as durable identity;
- schema and function name;
- `pg_get_function_identity_arguments` and canonical ordered argument types;
- `prosecdef`;
- owner role;
- canonical `proconfig`/`search_path` representation;
- canonical ACL entries, including effective handling of null `proacl`;
- normalized full definition from `pg_get_functiondef`; and
- SHA-256 of the exact normalized definition bytes.

The adapter emits records in deterministic identity order and hashes canonical
JSON bytes. It must not call an RPC under a privileged user, change settings,
write a table, or infer safety from `search_path` alone. Collection failure,
an overload mismatch, unexpected duplicate identity, or incomplete ACL data
is a hard failure.

## `postcheck_recovery` Workflow Mode

`postcheck_recovery` is added to the same `workflow_dispatch` interface. It is
available only for a previously failed canonical release whose mutation jobs
completed and whose failure occurred in postcheck.

The request binds all of the following exact identities:

- source run ID `39066492485`;
- source release ID `nelyon-b7-autonomous-20261017T202315Z`;
- source SHA `0560b9e1fdc0869dfcd4d04f081de03ba31b66cb`;
- full gate artifact ID, name, and GitHub digest;
- full release artifact ID, name, and GitHub digest;
- full original manifest digest;
- original pre-snapshot evidence digest; and
- original post-snapshot evidence digest.

The plan job uses `actions: read` to obtain GitHub metadata and artifacts from
that exact run. It verifies artifact names, IDs, full digests, source SHA,
release ID, run attempt, immutable manifest bytes, and original evidence
digests. It rejects artifacts from a different run, re-uploaded content,
prefix-only values, or a request whose original run was not the expected
failed-postcheck shape.

The protected recovery job regenerates current read-only evidence and checks:

1. project identity and health;
2. B7 exists exactly once, there are 337 migrations unless an authorized A2
   corrective migration was applied, and the latest version is justified;
3. the twelve original manifest functions remain active with exact expected
   versions, digests, and `verify_jwt`, and no unlisted function changed as a
   result of the source release;
4. the current advisor set equals the historical baseline plus the exact
   approved exceptions;
5. every exception matches its fresh catalog attestation byte for byte;
6. Finance is still `false / false / false / 0`, all ten reconciliations are
   zero-anomaly, and no source-release-attributed financial movement exists;
7. Content Safety remains fail-closed with no approved or active rules and no
   fabricated scans;
8. legacy content counts and lifecycle privacy remain preserved; and
9. no concurrent production release or unexpected deployment exists.

The recovery job produces a sanitized evidence artifact and conclusion. It
must contain no credential values, database password, token, private row
content, or unredacted owner evidence.

## Read-only Enforcement

Recovery immutability is structural, not a convention:

- `postcheck_recovery` never enters migration dry-run/apply code or Edge
  deployment code.
- Its command dispatcher has no reachable database-push, SQL-mutation,
  function-deploy, secret-rotation, or policy-write action.
- The helper rejects a recovery manifest that contains a productive resource
  or mutation instruction.
- The workflow contains no recovery step invoking `supabase db push`,
  `supabase migration`, `supabase functions deploy`, direct mutating SQL, or
  a generic command supplied by input.
- Tests inspect both runtime dispatch behavior and workflow source to prove
  those constraints.

The production Environment remains the audit boundary for the protected job,
but Environment approval is not accepted as proof of technical state. All
state is re-read after any wait.

## Corrective Migration Path

If negative testing reveals a vulnerability:

1. create exactly one focal migration with `supabase migration new` for the
   demonstrated correction;
2. do not edit or reapply B7;
3. inspect real callers before changing signature or grants;
4. prefer explicit revocation, capability checks, ownership checks, argument
   validation, lifecycle checks, and safe fixed SQL over broader privileges;
5. validate the full negative and positive disposable suite;
6. submit the migration and governance updates through a protected PR;
7. execute a canonical corrective release containing only the migration;
8. do not redeploy Edge unless an independently proven hash divergence
   requires a separately manifested function; and
9. run recovery against the original B7 artifacts plus the justified current
   migration state.

Database rollback remains forward-only. No `DROP TABLE`, `TRUNCATE`, RLS
disablement, destructive restoration, or production test purchase is allowed.

## Failure Behavior

The system fails closed when any of the following occurs:

- incomplete or mismatched original artifact provenance;
- a current finding not in the historical baseline or exact exception set;
- an exception not present in the current advisor set;
- a protected RPC's identity, definition, owner, security mode, search path,
  ACL, origin, or test evidence changes;
- a negative authorization case succeeds or mutates state;
- B7 appears zero or more than one time;
- an unexpected migration or Edge divergence exists;
- Finance, ledger, Content Safety, legacy, project health, or concurrency
  invariants diverge; or
- recovery reaches any mutating command.

Failure cannot update the baseline, approve an exception, or convert the
source release to success manually. Evidence remains available for diagnosis.

## Test Strategy

Implementation follows fail-first tests.

### Snapshot Adapter

`tests/nelyonProductionSnapshotAdapter.test.mjs` will prove:

- deterministic complete RPC identity and overload handling;
- canonical owner, `SECURITY DEFINER`, `search_path`, ACL, and definition
  hashing;
- null/default ACL handling without privilege inference;
- exact baseline reconstruction after exception subtraction;
- failure on unknown, missing, duplicate, wildcard, prefix, or changed
  exception data;
- failure on catalog query or attestation incompleteness; and
- sanitized evidence output.

### Release Gate and Workflow

`tests/nelyonProductionReleaseGate.test.mjs` will prove:

- policy validation for exact exception records;
- rejection of a global type allowlist or baseline promotion to 565;
- exact source run, artifact, SHA, release ID, manifest, and evidence binding;
- rejection of altered, cross-run, abbreviated, missing, or duplicate
  provenance;
- recovery eligibility only for the expected failed-postcheck state;
- recovery manifest contains no productive resources;
- recovery cannot reach database or function deployment commands;
- unknown advisor or attestation drift fails;
- Finance, Content Safety, legacy, concurrency, and Edge divergence fail; and
- successful recovery produces evidence without advancing authority
  implicitly.

Workflow static tests verify trigger scope, permissions, action pinning,
Environment use, artifact permissions, fixed commands, and absence of a
recovery mutation path.

### Disposable PostgreSQL

`tests/creatorPremiumB7Local.integration.mjs` will add the role, ownership,
capability, invalid-input, idempotency, concurrency, private-media,
publication, Finance OFF, refund, and reconciliation cases defined above for
all eleven new RPCs. Tests assert both result and absence of unauthorized side
effects.

### Regression and Release Verification

The completed implementation must also pass:

- complete Release Gate tests;
- complete Snapshot Adapter tests;
- Creator Premium B7 focal tests;
- PostgreSQL disposable integration;
- Finance reconciliation;
- Content Safety fail-closed checks;
- manifest and Git integrity checks; and
- `git diff --check`.

## Files in Scope

Expected files are:

- `.github/nelyon-production-release-policy.json`;
- `.github/workflows/nelyon-production-release.yml`;
- `scripts/nelyon-production-release.mjs`;
- `scripts/nelyon-production-snapshot-adapter.mjs`;
- `tests/nelyonProductionReleaseGate.test.mjs`;
- `tests/nelyonProductionSnapshotAdapter.test.mjs`;
- `tests/creatorPremiumB7Local.integration.mjs`;
- `docs/runbooks/nelyon-production-release.md`;
- this specification; and
- the implementation plan created after specification approval.

One new forward-only migration may be added only if a negative test proves a
real vulnerability. No other file is in scope without a demonstrated direct
dependency and explicit documentation in the implementation diff.

## Rollout

1. Approve this written specification.
2. Write and approve the implementation plan.
3. Add fail-first policy, adapter, workflow, and negative RPC tests.
4. Implement exact exception attestation and read-only recovery in the
   existing system.
5. If a vulnerability is demonstrated, add and validate the focal corrective
   migration before recording any exception for other safe RPCs.
6. Run all required local and disposable tests.
7. Commit only focal files, push the isolated branch, open a protected PR, and
   inspect the GitHub diff and checks.
8. Integrate through the permitted protected linear-history procedure.
9. Verify final remote SHA, tree, policy bytes, critical blobs, and absence of
   concurrent releases.
10. Dispatch `postcheck_recovery` against the exact original run artifacts.
11. After the protected read-only job completes, capture a fresh independent
    production snapshot and compare GitHub and Supabase evidence.
12. Issue the consolidated result without claiming physical-device success.

## Risks and Mitigations

- **Advisor warnings conceal a real authorization flaw.** Negative disposable
  tests and positive controls precede every exception; failures force a
  forward-only correction.
- **A broad allowlist hides future findings.** Records are fingerprint- and
  object-specific, and any unknown delta fails.
- **An unchanged fingerprint masks changed SQL authority.** Fresh catalog
  attestation binds definition, owner, security mode, search path, and ACL.
- **Recovery accidentally redeploys B7 resources.** The mode has a separate
  non-productive manifest and unreachable mutation dispatcher, verified by
  runtime and workflow-source tests.
- **Artifacts are confused across attempts.** Recovery binds full IDs, names,
  digests, run attempt, source SHA, release ID, manifest, and evidence bytes.
- **Historical warnings are reclassified as new.** The 554-finding baseline
  remains immutable; the two preexisting RPC fingerprints stay inside it.
- **Production state drifts while waiting.** Every protected check re-reads
  current state after Environment approval and fails on drift.
- **Corrective SQL changes callers unexpectedly.** Caller analysis and the
  disposable integration suite precede any migration or grant change.

## Acceptance Criteria

`PREMIUM_B7_READY_FOR_PHYSICAL_QA` may be reported only when:

1. all eleven new RPC findings have complete negative and positive test
   evidence;
2. every demonstrated vulnerability has a deployed forward-only correction
   and no vulnerable RPC is exception-listed;
3. every intentional exception matches its exact current advisor and catalog
   attestation;
4. subtracting exact exceptions from current findings reproduces the
   historical 554-finding digest with no additions or removals;
5. the protected PR is integrated and all required tests pass on its final
   tree;
6. `postcheck_recovery` verifies the full original artifacts and succeeds
   without a migration or function deployment;
7. production contains B7 exactly once and only justified later corrective
   migrations, if any;
8. all twelve B7 Edge Functions remain exact and no unnecessary redeployment
   occurred;
9. Finance remains OFF, ledger reconciliation remains clean, and no
   release-attributed BDAG movement exists;
10. Content Safety remains fail-closed with no fabricated evidence;
11. legacy content and privacy states remain preserved;
12. project health, RLS, ACL, protected RPC authority, and concurrency checks
    pass in fresh production evidence; and
13. the final report identifies GitHub runs, artifacts, Supabase evidence,
    tests, PR/merge, any correction, remaining risk, and the next physical QA
    step.

Failure of any condition yields `SECURITY_REMEDIATION_PARTIAL`,
`REQUIRES_CORRECTION`, or `EXTERNAL_ACTION_REQUIRED` as appropriate. It never
yields `PHYSICAL_PASS`.
