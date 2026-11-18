# B2 read-only refresh authorization design

Goal: no Supabase PAT is made available before an authenticated authorization boundary. Existing live revalidation, inventory checks and final production gate remain mandatory.

Approach: add protected preflight-release and authorize-refresh commands. The first verifies exact artifact/source/authority without pretending to observe live inventory. The second verifies policy, environment, approvals, concurrency and artifact binding, producing READ_ONLY_REFRESH_AUTHORIZED rather than GATE_VERIFIED. Only after that boundary does the workflow expose PAT to refresh inventory and run the original revalidate/verify-gate commands. Their full checks are not relaxed and preflight outputs cannot stand in for their outputs.

Rejected: remove PAT from existing live commands (they require live inventory); fabricate inventory from manifest (false provenance); weaken lexical test without adding an authorization gate (no safety improvement).

Constraints: local changes/tests only. No credentials, roles, production, publication or protected pins changed. Preserve existing WIP and closure member lists. A fresh closure/authority review is required before deployment.

## Implementation boundary

The new results are deliberately not production gate proofs. The protected workflow compares the current authority receipt, checks the explicit read-only result/scope, and requires successful cleanup before its first PAT-bearing step. Existing live revalidate and verify-gate still run afterward and remain required before mutation. The runtime rejects a Supabase PAT in either new offline action and verifies fresh private authority before publishing its receipt.

This is a workflow ordering boundary, not a portable capability: generic existing live controller actions do not consume a new refresh-permit token. Do not describe the exported host as incapable of being invoked outside this workflow. Subsequent local integration now routes both migration phases through protected dryrun-migrations/apply-migrations actions and the hermetic transport. Descriptor, authorization, runtime closure pins, real TLS/network behavior and production execution remain external, unperformed work.

Tests distinguish readonly success from GATE_VERIFIED and reject unexpected PAT, expired authority, mismatched policy, enabled auto-deploy and unapproved branch with zero inventory calls. Existing live inventory failure tests remain intact.

## Follow-on local migration integration

Both workflow migration commands now use the authenticated controller. NELYON_SUPABASE_CLI_SHA256 must be a separately approved hash for the official CLI 2.120.0 binary for the runner platform; absence or mismatch blocks before role minting. The workflow does not derive or set this trusted pin from the candidate binary. The host reads the full approved Git config/migration inventory, validates the full pre-snapshot and current gate, uses a private hermetic workspace and fixed endpoint, and rechecks authority, backup, snapshot and inventory freshness around mint/execution. Apply repeats the exact dry-run in its own same workspace before applying. No linked fallback exists.

The apply step retains the existing id but is named B2 protected migrations for exact-attempt proof provenance. Its cleanup must succeed before functions. The first migrations attempt proof persists before the operation, so an uncertain/failed attempt cannot be silently retried. Completion means child exit zero, not post-verification of production. A timeout or kill is indeterminate and requires ledger/postchecks before any new authorized attempt.

Offline real-controller tests exercise synthetic Git commits and complete snapshots with mock HTTP/exec. They do not validate official binary compatibility, real TLS/CA, IPv6 reachability or actual API roles. Subsequent functions still lack full mutation-stage proof integration, so recovery completeness is not claimed. No production, authority, credentials, network controls, remote vars or pins were changed.

Failure-path retention: an always step exports only the strictly validated public migration-attempt proof even if apply fails or times out. Unknown fields, mismatched identity/receipt and non-regular paths reject retention. Missing proofs are not invented; retention is not success or renewed authorization.
